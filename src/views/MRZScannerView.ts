import { EnumCapturedResultItemType, EnumImagePixelFormat, OriginalImageResultItem } from "dynamsoft-core";
import { CapturedResultReceiver, CapturedResult } from "dynamsoft-capture-vision-router";
import { SharedResources } from "../MRZScanner";
import { EnumResultStatus, UtilizedTemplateNames, EnumMRZScanMode } from "./utils/types";
import { DEFAULT_LOADING_SCREEN_STYLE, showLoadingScreen } from "./utils/LoadingScreen";
import { createStyle, getElement } from "./utils";
import { MRZData, MRZResult, processMRZData } from "./utils/MRZScannerParser";
import { ParsedResultItem } from "dynamsoft-code-parser";
import { Feedback } from "dynamsoft-camera-enhancer";

export interface MRZScannerViewConfig {
  defaultScanMode?: EnumMRZScanMode;
  cameraEnhancerUIPath?: string;

  container?: HTMLElement | string;
  templateFilePath?: string;
  utilizedTemplateNames?: UtilizedTemplateNames;
}

interface DCEElements {
  selectCameraBtn: HTMLElement | null;
  uploadImageBtn: HTMLElement | null;
  soundFeedbackBtn: HTMLElement | null;
  closeScannerBtn: HTMLElement | null;
}

// Implementation
export default class MRZScannerView {
  private isSoundFeedbackOn: boolean = false;

  private scanMode: EnumMRZScanMode = EnumMRZScanMode.All;

  private capturedResultItems: CapturedResult["items"] = [];
  private originalImageData: OriginalImageResultItem["imageData"] | null = null;

  private initialized: boolean = false;
  private initializedDCE: boolean = false;

  // Elements
  private DCE_ELEMENTS: DCEElements = {
    selectCameraBtn: null,
    uploadImageBtn: null,
    soundFeedbackBtn: null,
    closeScannerBtn: null,
  };

  // Scan Resolve
  private currentScanResolver?: (result: MRZResult) => void;

  private loadingScreen: ReturnType<typeof showLoadingScreen> | null = null;

  private showScannerLoadingOverlay(message?: string) {
    const configContainer = getElement(this.config.container);
    this.loadingScreen = showLoadingScreen(configContainer, { message });
    configContainer.style.display = "block";
    configContainer.style.position = "relative";
  }

  private hideScannerLoadingOverlay(hideContainer: boolean = false) {
    if (this.loadingScreen) {
      this.loadingScreen.hide();
      this.loadingScreen = null;

      if (hideContainer) {
        getElement(this.config.container).style.display = "none";
      }
    }
  }

  constructor(private resources: SharedResources, private config: MRZScannerViewConfig) {}

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Create loading screen style
    createStyle("dynamsoft-mrz-loading-screen-style", DEFAULT_LOADING_SCREEN_STYLE);

    try {
      const { cameraView, cameraEnhancer, cvRouter } = this.resources;

      // Set up cameraView styling
      cameraView.setScanRegionMaskStyle({
        ...cameraView.getScanRegionMaskStyle(),
        strokeStyle: "transparent",
      });

      // Set cameraEnhancer as input for CaptureVisionRouter
      cvRouter.setInput(cameraEnhancer);

      // Initialize the template parameters for mrz scanning
      await cvRouter.initSettings(this.config.templateFilePath);

      const resultReceiver = new CapturedResultReceiver();
      resultReceiver.onCapturedResultReceived = (result) => this.handleMRZResult(result);
      await cvRouter.addResultReceiver(resultReceiver);

      // Set default value for sound feedback
      this.toggleSoundFeedback(false);

      this.initialized = true;
    } catch (ex: any) {
      let errMsg = ex?.message || ex;
      console.error(errMsg);
      alert(errMsg);
      this.closeCamera();
      const result = {
        status: {
          code: EnumResultStatus.RS_FAILED,
          message: "Dynamsoft MRZ Scanner initialize error",
        },
      };
      this.currentScanResolver(result);
    }
  }

  private async initializeElements() {
    const configContainer = getElement(this.config.container);

    const DCEContainer = configContainer.children[configContainer.children.length - 1];

    if (!DCEContainer?.shadowRoot) {
      throw new Error("Shadow root not found");
    }

    this.DCE_ELEMENTS = {
      selectCameraBtn: DCEContainer.shadowRoot.querySelector(".dce-mn-select-camera-icon"),
      uploadImageBtn: DCEContainer.shadowRoot.querySelector(".dce-mn-upload-image-icon"),
      soundFeedbackBtn: DCEContainer.shadowRoot.querySelector(".dce-mn-sound-feedback"),
      closeScannerBtn: DCEContainer.shadowRoot.querySelector(".dce-mn-close"),
    };

    this.assignDCEClickEvents();

    this.initializedDCE = true;
  }

  private assignDCEClickEvents() {
    if (!Object.values(this.DCE_ELEMENTS).every(Boolean)) {
      throw new Error("Camera control elements not found");
    }

    // Use passive event listeners for better performance
    const eventOptions = { passive: true };

    this.closeCamera = this.closeCamera.bind(this);

    this.DCE_ELEMENTS.uploadImageBtn.addEventListener("click", () => this.uploadImage(), eventOptions);
    this.DCE_ELEMENTS.soundFeedbackBtn.addEventListener("click", () => this.toggleSoundFeedback(), eventOptions);
    this.DCE_ELEMENTS.closeScannerBtn.addEventListener("click", () => this.handleCloseBtn(), eventOptions);

    this.DCE_ELEMENTS.selectCameraBtn.addEventListener(
      "click",
      (event) => {
        event.stopPropagation();
        this.toggleSelectCameraBox();
      },
      eventOptions
    );
  }

  async handleCloseBtn() {
    this.closeCamera();

    if (this.currentScanResolver) {
      this.currentScanResolver({
        status: {
          code: EnumResultStatus.RS_CANCELLED,
          message: "Cancelled",
        },
      });
    }
  }

  private attachOptionClickListeners() {
    const configContainer = getElement(this.config.container);
    const DCEContainer = configContainer.children[configContainer.children.length - 1];
    if (!DCEContainer?.shadowRoot) return;

    const settingsContainer = DCEContainer.shadowRoot.querySelector(
      ".dce-mn-camera-and-resolution-settings"
    ) as HTMLElement;

    const cameraOptions = DCEContainer.shadowRoot.querySelectorAll(".dce-mn-camera-option");
    const resolutionOptions = DCEContainer.shadowRoot.querySelectorAll(".dce-mn-resolution-option");

    // Add click handlers to all options
    [...cameraOptions, ...resolutionOptions].forEach((option) => {
      option.addEventListener("click", () => {
        if (settingsContainer.style.display !== "none") {
          this.toggleSelectCameraBox();
        }
      });
    });
  }

  private highlightCameraAndResolutionOption() {
    const configContainer = getElement(this.config.container);
    const DCEContainer = configContainer.children[configContainer.children.length - 1];
    if (!DCEContainer?.shadowRoot) return;

    const settingsContainer = DCEContainer.shadowRoot.querySelector(
      ".dce-mn-camera-and-resolution-settings"
    ) as HTMLElement;
    const cameraOptions = settingsContainer.querySelectorAll(".dce-mn-camera-option");
    const resOptions = settingsContainer.querySelectorAll(".dce-mn-resolution-option");

    const selectedCamera = this.resources.cameraEnhancer.getSelectedCamera();
    const selectedResolution = this.resources.cameraEnhancer.getResolution();

    cameraOptions.forEach((options) => {
      const o = options as HTMLElement;
      if (o.getAttribute("data-davice-id") === selectedCamera?.deviceId) {
        o.style.border = "2px solid #fe814a";
      } else {
        o.style.border = "none";
      }
    });

    resOptions.forEach((options) => {
      const o = options as HTMLElement;
      if (o.getAttribute("data-height") === `${selectedResolution.height}`) {
        o.style.border = "2px solid #fe814a";
      } else {
        o.style.border = "none";
      }
    });
  }

  private toggleSelectCameraBox() {
    const configContainer = getElement(this.config.container);
    const DCEContainer = configContainer.children[configContainer.children.length - 1];

    if (!DCEContainer?.shadowRoot) return;

    const settingsBox = DCEContainer.shadowRoot.querySelector(".dce-mn-resolution-box") as HTMLElement;

    // Highlight current camera and resolution
    this.highlightCameraAndResolutionOption();

    // Attach highlighting camera and resolution options on option click
    this.attachOptionClickListeners();

    settingsBox.click();
  }

  private async uploadImage() {
    // Create hidden file input
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.display = "none";
    document.body.appendChild(input);

    try {
      this.showScannerLoadingOverlay("Processing image...");

      // Get file from input
      const file = await new Promise<File>((resolve, reject) => {
        input.onchange = (e: Event) => {
          const f = (e.target as HTMLInputElement).files?.[0];
          if (!f?.type.startsWith("image/")) {
            reject(new Error("Please select an image file"));
            return;
          }
          resolve(f);
        };

        input.addEventListener("cancel", () => this.hideScannerLoadingOverlay(false));
        input.click();
      });

      if (!file) {
        this.hideScannerLoadingOverlay(false);
        return;
      }

      this.closeCamera(false);

      // Convert file to blob
      const { blob } = await this.fileToBlob(file);

      const capturedResult = await this.resources.cvRouter.capture(blob, this.scanMode);
      this.capturedResultItems = capturedResult.items;
      this.originalImageData = (this.capturedResultItems[0] as OriginalImageResultItem)?.imageData;

      const textLineResultItems = capturedResult?.textLineResultItems;
      const parsedResultItems = capturedResult?.parsedResultItems;

      let processedData = {} as MRZData;

      if (textLineResultItems?.length) {
        const mrzText = textLineResultItems[0]?.text || "";
        const parsedResult = parsedResultItems[0] as ParsedResultItem;

        processedData = processMRZData(mrzText, parsedResult);
      }

      const mrzResult = {
        status: {
          code: EnumResultStatus.RS_SUCCESS,
          message: "Success",
        },
        originalImageResult: this.originalImageData,
        data: processedData,
      };
      // Emit result through shared resources
      this.resources.onResultUpdated?.(mrzResult);

      // Resolve scan promise
      this.currentScanResolver(mrzResult);

      // Done processing
      this.hideScannerLoadingOverlay(true);
    } catch (ex: any) {
      let errMsg = ex?.message || ex;
      console.error(errMsg);
      alert(errMsg);
      this.closeCamera();

      const result = {
        status: {
          code: EnumResultStatus.RS_FAILED,
          message: "Error processing uploaded image",
        },
      };
      this.currentScanResolver(result);
    } finally {
      document.body.removeChild(input);
    }
  }

  private async fileToBlob(file: File): Promise<{ blob: Blob; width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) {
            resolve({ blob, width: img.width, height: img.height });
          } else {
            reject(new Error("Failed to create blob"));
          }
        }, file.type);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  private toggleSoundFeedback(enabled?: boolean) {
    this.isSoundFeedbackOn = enabled !== undefined ? enabled : !this.isSoundFeedbackOn;

    const configContainer = getElement(this.config.container);
    const DCEContainer = configContainer.children[configContainer.children.length - 1];
    if (!DCEContainer?.shadowRoot) return;

    const soundFeedbackContainer = DCEContainer.shadowRoot.querySelector(".dce-mn-sound-feedback") as HTMLElement;

    const onIcon = soundFeedbackContainer.querySelector(".dce-mn-sound-feedback-on") as HTMLElement;
    const offIcon = soundFeedbackContainer.querySelector(".dce-mn-sound-feedback-off") as HTMLElement;

    offIcon.style.display = this.isSoundFeedbackOn ? "none" : "block";
    onIcon.style.display = this.isSoundFeedbackOn ? "block" : "none";
  }

  async openCamera(): Promise<void> {
    try {
      this.showScannerLoadingOverlay("Initializing camera...");

      const { cameraEnhancer, cameraView } = this.resources;

      const configContainer = getElement(this.config.container);
      configContainer.style.display = "block";

      if (!cameraEnhancer.isOpen()) {
        const currentCameraView = cameraView.getUIElement();
        if (!currentCameraView.parentElement) {
          configContainer.append(currentCameraView);
        }

        await cameraEnhancer.open();
      } else if (cameraEnhancer.isPaused()) {
        await cameraEnhancer.resume();
      }

      // Assign boundsDetection, smartCapture, and takePhoto element
      if (!this.initializedDCE && cameraEnhancer.isOpen()) {
        await this.initializeElements();
      }
    } catch (ex: any) {
      let errMsg = ex?.message || ex;
      console.error(errMsg);
      alert(errMsg);
      this.closeCamera();
      const result = {
        status: {
          code: EnumResultStatus.RS_FAILED,
          message: "MRZ Scanner Open Camera Error",
        },
      };
      this.currentScanResolver(result);
    } finally {
      this.hideScannerLoadingOverlay();
    }
  }

  closeCamera(hideContainer: boolean = true) {
    const { cameraEnhancer, cameraView } = this.resources;

    const configContainer = getElement(this.config.container);
    configContainer.style.display = hideContainer ? "none" : "block";

    if (cameraView.getUIElement().parentElement) {
      configContainer.removeChild(cameraView.getUIElement());
    }

    cameraEnhancer.close();
    this.stopCapturing();
  }

  pauseCamera() {
    const { cameraEnhancer } = this.resources;
    cameraEnhancer.pause();
  }

  stopCapturing() {
    const { cameraView, cvRouter } = this.resources;

    cvRouter.stopCapturing();
    cameraView.clearAllInnerDrawingItems();
  }

  async handleMRZResult(result: CapturedResult) {
    this.capturedResultItems = result.items;

    // If only original image is returned in result.items (i.e. no text line or parsed result items), skip processing result
    if (result.items.length <= 1) {
      return;
    }

    try {
      const { onResultUpdated } = this.resources;

      const originalImage = result.items.filter(
        (item) => item.type === EnumCapturedResultItemType.CRIT_ORIGINAL_IMAGE
      ) as OriginalImageResultItem[];
      this.originalImageData = originalImage.length && originalImage[0].imageData;

      const textLineResultItems = result?.textLineResultItems;
      const parsedResultItems = result?.parsedResultItems;

      if (textLineResultItems) {
        if (this.isSoundFeedbackOn) {
          Feedback.beep();
        }
        const mrzText = textLineResultItems?.[0]?.text || "";
        const parsedResult = parsedResultItems[0] as ParsedResultItem;

        const processedData = processMRZData(mrzText, parsedResult);

        // Clean up camera and capture
        this.closeCamera();

        const mrzResult: MRZResult = {
          status: {
            code: EnumResultStatus.RS_SUCCESS,
            message: "Success",
          },
          originalImageResult: this.originalImageData,
          data: processedData,
        };

        // Emit result through shared resources
        onResultUpdated?.(mrzResult);

        // Resolve scan promise
        this.currentScanResolver(mrzResult);
      }
    } catch (ex: any) {
      let errMsg = ex?.message || ex;
      console.error(errMsg);
      alert(errMsg);

      this.closeCamera();
      const result = {
        status: {
          code: EnumResultStatus.RS_FAILED,
          message: "Error capturing image",
        },
      };
      this.currentScanResolver(result);
    }
  }

  async launch(): Promise<MRZResult> {
    try {
      await this.initialize();

      const { cvRouter, cameraEnhancer } = this.resources;

      return new Promise(async (resolve) => {
        this.currentScanResolver = resolve;

        // Start capturing
        await this.openCamera();

        await cvRouter.startCapturing(this.config.utilizedTemplateNames.all);

        // By default, cameraEnhancer captures grayscale images to optimize performance.
        // To capture RGB Images, we set the Pixel Format to EnumImagePixelFormat.IPF_ABGR_8888
        cameraEnhancer.setPixelFormat(EnumImagePixelFormat.IPF_ABGR_8888);
      });
    } catch (ex: any) {
      let errMsg = ex?.message || ex;
      console.error("MRZ Scanner launch error: ", errMsg);
      this.closeCamera();
      const result = {
        status: {
          code: EnumResultStatus.RS_FAILED,
          message: "MRZ Scanner launch error",
        },
      };
      this.currentScanResolver(result);
    }
  }
}
