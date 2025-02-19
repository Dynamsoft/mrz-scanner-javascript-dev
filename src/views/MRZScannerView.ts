import { EnumCapturedResultItemType, EnumImagePixelFormat, OriginalImageResultItem } from "dynamsoft-core";
import { CapturedResultReceiver, CapturedResult } from "dynamsoft-capture-vision-router";
import { SharedResources } from "../MRZScanner";
import { EnumResultStatus, UtilizedTemplateNames, EnumMRZScanMode, EnumMRZDocumentType } from "./utils/types";
import { DEFAULT_LOADING_SCREEN_STYLE, showLoadingScreen } from "./utils/LoadingScreen";
import { checkOrientation, createStyle, findClosestResolutionLevel, getElement } from "./utils";
import { MRZData, MRZResult, processMRZData } from "./utils/MRZParser";
import { ParsedResultItem } from "dynamsoft-code-parser";
import { Feedback } from "dynamsoft-camera-enhancer";

export interface MRZScannerViewConfig {
  cameraEnhancerUIPath?: string;
  container?: HTMLElement | string;
  templateFilePath?: string;
  utilizedTemplateNames?: UtilizedTemplateNames;
  mrzFormatType?: EnumMRZDocumentType | Array<EnumMRZDocumentType>;

  // Customize Scanner
  showScanGuide?: boolean;
  showLoadImage?: boolean;
  showFormatSelector?: boolean;
  showSoundToggle?: boolean;
}

const MRZScanGuideRatios: Record<EnumMRZDocumentType, { width: number; height: number }> = {
  [EnumMRZDocumentType.TD1]: { width: 85.6, height: 53.98 },
  [EnumMRZDocumentType.TD2]: { width: 105, height: 74 },
  [EnumMRZDocumentType.Passport]: { width: 125, height: 88 },
};

interface DCEElements {
  selectCameraBtn: HTMLElement | null;
  uploadImageBtn: HTMLElement | null;
  soundFeedbackBtn: HTMLElement | null;
  closeScannerBtn: HTMLElement | null;
  scanModeSelectContainer: HTMLElement | null;
  passportModeOption: HTMLElement | null;
  td1ModeOption: HTMLElement | null;
  td2ModeOption: HTMLElement | null;
  toast: HTMLElement | null;
}

// Implementation
export default class MRZScannerView {
  private isSoundFeedbackOn: boolean = false;

  private scanModeManager: Record<EnumMRZDocumentType, boolean> = {
    [EnumMRZDocumentType.Passport]: true,
    [EnumMRZDocumentType.TD1]: true,
    [EnumMRZDocumentType.TD2]: true,
  };
  private currentScanMode: EnumMRZScanMode = EnumMRZScanMode.All;

  private resizeTimer: number | null = null;

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
    scanModeSelectContainer: null,
    passportModeOption: null,
    td1ModeOption: null,
    td2ModeOption: null,
    toast: null,
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

  private handleResize = () => {
    // Hide all guides first
    this.toggleScanGuide(false);

    // Clear existing timer
    if (this.resizeTimer) {
      window.clearTimeout(this.resizeTimer);
    }

    // Set new timer
    this.resizeTimer = window.setTimeout(() => {
      // Re-show guides and update scan region
      this.toggleScanGuide(true);
    }, 500);
  };

  constructor(private resources: SharedResources, private config: MRZScannerViewConfig) {}

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.initializeScanModeManager();
    this.currentScanMode = this.getScanMode();

    // Create loading screen style
    createStyle("dynamsoft-mrz-loading-screen-style", DEFAULT_LOADING_SCREEN_STYLE);

    try {
      const { cameraView, cameraEnhancer, cvRouter } = this.resources;

      // Set up cameraView styling
      cameraView.setScanRegionMaskStyle({
        strokeStyle: "transparent",
        // fillStyle: "transparent",
        lineWidth: 0,
      } as any);
      cameraView.setVideoFit("cover");

      // Set cameraEnhancer as input for CaptureVisionRouter
      cvRouter.setInput(cameraEnhancer);

      // Initialize the template parameters for mrz scanning
      await cvRouter.initSettings(this.config.templateFilePath);

      const resultReceiver = new CapturedResultReceiver();
      resultReceiver.onCapturedResultReceived = (result) => this.handleMRZResult(result);
      await cvRouter.addResultReceiver(resultReceiver);

      // Set default value for sound feedback
      this.toggleSoundFeedback(false);

      // Set defaults from config TODO not needed?
      if (this.config.showScanGuide === false) {
        this.toggleScanGuide(false);
      }

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

  private initializeElements() {
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
      scanModeSelectContainer: DCEContainer.shadowRoot.querySelector(".dce-mn-scan-mode-select"),
      passportModeOption: DCEContainer.shadowRoot.querySelector(".scan-mode-option-passport"),
      td1ModeOption: DCEContainer.shadowRoot.querySelector(".scan-mode-option-td1"),
      td2ModeOption: DCEContainer.shadowRoot.querySelector(".scan-mode-option-td2"),
      toast: DCEContainer.shadowRoot.querySelector(".dce-mn-toast"),
    };

    this.setupScanModeSelector();
    this.assignDCEClickEvents();

    // Hide toast
    this.DCE_ELEMENTS.toast.style.display = "none";

    // Hide configs

    if (this.config.showLoadImage === false) {
      this.DCE_ELEMENTS.uploadImageBtn.style.display = "none";
    }

    if (this.config.showSoundToggle === false) {
      this.DCE_ELEMENTS.soundFeedbackBtn.style.display = "none";
    }

    this.initializedDCE = true;
  }

  private setupScanModeSelector() {
    if (this.config.showFormatSelector === false) {
      this.DCE_ELEMENTS.scanModeSelectContainer.style.display = "none";
      return;
    }

    switch (this.currentScanMode) {
      case EnumMRZScanMode.PassportAndTD1:
        this.DCE_ELEMENTS.td2ModeOption.style.display = "none";
        break;
      case EnumMRZScanMode.PassportAndTD2:
        this.DCE_ELEMENTS.td1ModeOption.style.display = "none";
        break;
      case EnumMRZScanMode.TD1AndTD2:
        this.DCE_ELEMENTS.passportModeOption.style.display = "none";
        break;
      case EnumMRZScanMode.All:
        break;
      default:
        this.DCE_ELEMENTS.scanModeSelectContainer.style.display = "none";
        break;
    }
  }

  private assignDCEClickEvents() {
    if (!Object.values(this.DCE_ELEMENTS).every(Boolean)) {
      throw new Error("Camera control elements not found");
    }

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

    // Select mode
    this.DCE_ELEMENTS.passportModeOption.addEventListener("click", () => {
      if (this.DCE_ELEMENTS.passportModeOption.style.display !== "none") {
        this.toggleScanDocType(EnumMRZDocumentType.Passport);
      }
    });

    this.DCE_ELEMENTS.td1ModeOption.addEventListener("click", () => {
      if (this.DCE_ELEMENTS.td1ModeOption.style.display !== "none") {
        this.toggleScanDocType(EnumMRZDocumentType.TD1);
      }
    });

    this.DCE_ELEMENTS.td2ModeOption.addEventListener("click", () => {
      if (this.DCE_ELEMENTS.td2ModeOption.style.display !== "none") {
        this.toggleScanDocType(EnumMRZDocumentType.TD2);
      }
    });
  }

  private handleCloseBtn() {
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
      option.addEventListener("click", async () => {
        const deviceId = option.getAttribute("data-davice-id");
        const resHeight = option.getAttribute("data-height");
        const resWidth = option.getAttribute("data-width");
        if (deviceId) {
          await this.resources.cameraEnhancer.selectCamera(deviceId);
        } else if (resHeight && resWidth) {
          await this.resources.cameraEnhancer.setResolution({
            width: parseInt(resWidth),
            height: parseInt(resHeight),
          });
        }

        this.toggleScanGuide();
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

    const heightMap: Record<string, string> = {
      "480p": "480",
      "720p": "720",
      "1080p": "1080",
      "2k": "1440",
      "4k": "2160",
    };
    const resolutionLvl = findClosestResolutionLevel(selectedResolution);

    resOptions.forEach((options) => {
      const o = options as HTMLElement;
      const height = o.getAttribute("data-height");

      if (height === heightMap[resolutionLvl]) {
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
      const templateName = this.config.utilizedTemplateNames[this.currentScanMode];

      const capturedResult = await this.resources.cvRouter.capture(file, templateName);
      this.capturedResultItems = capturedResult.items;
      const originalImage = this.capturedResultItems.filter(
        (item) => item.type === EnumCapturedResultItemType.CRIT_ORIGINAL_IMAGE
      ) as OriginalImageResultItem[];

      this.originalImageData = originalImage.length && originalImage[0].imageData;

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

  private calculateScanRegion(documentType: EnumMRZDocumentType) {
    const { cameraEnhancer, cameraView } = this.resources;

    if (!cameraEnhancer || !cameraEnhancer.isOpen()) return;

    // Get visible region of video considering "cover" fit
    const visibleRegion = cameraView.getVisibleRegionOfVideo({ inPixels: true });
    if (!visibleRegion) return;

    // Get the document ratio for the specific document type
    const targetRatio = MRZScanGuideRatios[documentType];

    // Calculate the base unit to scale the document dimensions
    // This determines how many pixels one unit of document measurement equals
    let baseUnit: number;

    // Get the actual visible dimensions after "cover" fit
    const effectiveWidth = visibleRegion.width;
    const effectiveHeight = visibleRegion.height;

    // Calculate bottom margin of 5rem in pixels (assuming 16px per rem)
    const bottomMarginPx = 5 * 16;
    const effectiveHeightWithMargin = effectiveHeight - bottomMarginPx;

    if (effectiveWidth > effectiveHeight) {
      // Landscape orientation
      // Use 75% of adjusted height as our reference to determine base unit
      const availableHeight = effectiveHeightWithMargin * 0.75;
      baseUnit = availableHeight / targetRatio.height;

      // Check if width would exceed bounds
      const resultingWidth = baseUnit * targetRatio.width;
      if (resultingWidth > effectiveWidth * 0.9) {
        // If too wide, recalculate using width as reference
        baseUnit = (effectiveWidth * 0.9) / targetRatio.width;
      }
    } else {
      // Portrait orientation
      // Use 90% of width as our reference to determine base unit
      const availableWidth = effectiveWidth * 0.9;
      baseUnit = availableWidth / targetRatio.width;

      // Check if height would exceed bounds
      const resultingHeight = baseUnit * targetRatio.height;
      if (resultingHeight > effectiveHeightWithMargin * 0.75) {
        // If too tall, recalculate using height as reference
        baseUnit = (effectiveHeightWithMargin * 0.75) / targetRatio.height;
      }
    }

    // Calculate actual dimensions in pixels
    const actualWidth = baseUnit * targetRatio.width;
    const actualHeight = baseUnit * targetRatio.height;

    // Calculate the offsets to center the region horizontally
    // For vertical positioning, shift up by half the bottom margin
    const leftOffset = (effectiveWidth - actualWidth) / 2;
    const topOffset = (effectiveHeightWithMargin - actualHeight) / 2;

    // Convert to percentages of the visible area
    const left = (leftOffset / effectiveWidth) * 100;
    const right = ((leftOffset + actualWidth) / effectiveWidth) * 100;
    const top = (topOffset / effectiveHeight) * 100;
    const bottom = ((topOffset + actualHeight) / effectiveHeight) * 100;

    // Apply scan region
    const region = {
      left: Math.round(left),
      right: Math.round(right),
      top: Math.round(top),
      bottom: Math.round(bottom),
      isMeasuredInPercentage: true,
    };

    cameraView?.setScanRegionMaskVisible(true);
    cameraEnhancer.setScanRegion(region);
  }

  private toggleScanGuide(enabled?: boolean) {
    const configContainer = getElement(this.config.container);
    const DCEContainer = configContainer.children[configContainer.children.length - 1];
    if (!DCEContainer?.shadowRoot) return;
    const passportGuide = DCEContainer.shadowRoot.querySelector(".dce-scanguide-passport") as HTMLElement;
    const td1Guide = DCEContainer.shadowRoot.querySelector(".dce-scanguide-td1") as HTMLElement;
    const td2Guide = DCEContainer.shadowRoot.querySelector(".dce-scanguide-td2") as HTMLElement;

    if (enabled === false || this.config.showScanGuide === false) {
      passportGuide.style.display = "none";
      td1Guide.style.display = "none";
      td2Guide.style.display = "none";
      return;
    }

    switch (this.currentScanMode) {
      case EnumMRZScanMode.All:
      case EnumMRZScanMode.Passport:
      case EnumMRZScanMode.PassportAndTD1:
      case EnumMRZScanMode.PassportAndTD2:
        passportGuide.style.display = "block";
        td1Guide.style.display = "none";
        td2Guide.style.display = "none";

        this.calculateScanRegion(EnumMRZDocumentType.Passport);
        break;

      case EnumMRZScanMode.TD1:
      case EnumMRZScanMode.TD1AndTD2:
        passportGuide.style.display = "none";
        td1Guide.style.display = "block";
        td2Guide.style.display = "none";

        this.calculateScanRegion(EnumMRZDocumentType.TD1);
        break;

      case EnumMRZScanMode.TD2:
        passportGuide.style.display = "none";
        td1Guide.style.display = "none";
        td2Guide.style.display = "block";

        this.calculateScanRegion(EnumMRZDocumentType.TD2);
        break;

      default:
      // TODO show error
    }
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

      // Assign element
      if (!this.initializedDCE && cameraEnhancer.isOpen()) {
        await this.initializeElements();
      }

      // Add resize
      window.addEventListener("resize", this.handleResize);
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
    // Remove resize event listener
    window.removeEventListener("resize", this.handleResize);
    // Clear any existing resize timer
    if (this.resizeTimer) {
      window.clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }

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

  private initializeScanModeManager() {
    const { mrzFormatType } = this.config;

    // Initialize with all modes enabled by default
    this.scanModeManager = {
      [EnumMRZDocumentType.Passport]: true,
      [EnumMRZDocumentType.TD1]: true,
      [EnumMRZDocumentType.TD2]: true,
    };

    // If no format type specified, keep all enabled
    if (!mrzFormatType || (Array.isArray(mrzFormatType) && mrzFormatType.length === 0)) {
      return;
    }

    // Reset all to false first
    Object.keys(this.scanModeManager).forEach((key) => {
      this.scanModeManager[key as EnumMRZDocumentType] = false;
    });

    // Enable only specified types
    const types = Array.isArray(mrzFormatType) ? mrzFormatType : [mrzFormatType];
    types.forEach((type) => {
      this.scanModeManager[type] = true;
    });
  }

  private getScanMode(): EnumMRZScanMode {
    const enabled = Object.entries(this.scanModeManager)
      .filter(([_, isEnabled]) => isEnabled)
      .map(([type]) => type as EnumMRZDocumentType)
      .sort()
      .join(",");

    const modeMap: Record<string, EnumMRZScanMode> = {
      [EnumMRZDocumentType.Passport]: EnumMRZScanMode.Passport,
      [EnumMRZDocumentType.TD1]: EnumMRZScanMode.TD1,
      [EnumMRZDocumentType.TD2]: EnumMRZScanMode.TD2,
      [`${EnumMRZDocumentType.Passport},${EnumMRZDocumentType.TD1}`]: EnumMRZScanMode.PassportAndTD1,
      [`${EnumMRZDocumentType.Passport},${EnumMRZDocumentType.TD2}`]: EnumMRZScanMode.PassportAndTD2,
      [`${EnumMRZDocumentType.TD1},${EnumMRZDocumentType.TD2}`]: EnumMRZScanMode.TD1AndTD2,
      [`${EnumMRZDocumentType.Passport},${EnumMRZDocumentType.TD1},${EnumMRZDocumentType.TD2}`]: EnumMRZScanMode.All,
      "": EnumMRZScanMode.All, // Handle case when no types are enabled
    };

    return modeMap[enabled];
  }

  private DCEShowToast(info: string, duration: number = 3000) {
    if (!this.DCE_ELEMENTS.toast) {
      return;
    }
    this.DCE_ELEMENTS.toast.textContent = info;
    this.DCE_ELEMENTS.toast.style.display = "";

    setTimeout(() => {
      this.DCE_ELEMENTS.toast.style.display = "none";
    }, duration) as any;
  }

  private toggleScanDocType(docType: EnumMRZDocumentType): void {
    if (
      this.scanModeManager[docType] &&
      Object.entries(this.scanModeManager).filter(([type, enabled]) => enabled && type !== docType).length === 0
    ) {
      console.warn("MRZ Scanner - At least one mode must be enabled");
      this.DCEShowToast("At least one mode must be enabled");
      return;
    }

    // Toggle the mode
    this.scanModeManager[docType] = !this.scanModeManager[docType];

    // Update current scan mode
    this.currentScanMode = this.getScanMode();

    this.toggleScanGuide();

    this.DCE_ELEMENTS.td1ModeOption.classList.toggle("selected", this.scanModeManager[EnumMRZDocumentType.TD1]);
    this.DCE_ELEMENTS.td2ModeOption.classList.toggle("selected", this.scanModeManager[EnumMRZDocumentType.TD2]);
    this.DCE_ELEMENTS.passportModeOption.classList.toggle(
      "selected",
      this.scanModeManager[EnumMRZDocumentType.Passport]
    );
  }

  async launch(): Promise<MRZResult> {
    try {
      await this.initialize();

      const { cvRouter, cameraEnhancer } = this.resources;

      return new Promise(async (resolve) => {
        this.currentScanResolver = resolve;

        // Start capturing
        await this.openCamera();

        await cvRouter.startCapturing(this.config.utilizedTemplateNames[this.currentScanMode]);

        // By default, cameraEnhancer captures grayscale images to optimize performance.
        // To capture RGB Images, we set the Pixel Format to EnumImagePixelFormat.IPF_ABGR_8888
        cameraEnhancer.setPixelFormat(EnumImagePixelFormat.IPF_ABGR_8888);

        //Show scan guide
        this.toggleScanGuide();
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
