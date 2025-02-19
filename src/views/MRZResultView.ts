import MRZScanner, { SharedResources } from "../MRZScanner";
import MRZScannerView from "./MRZScannerView";
import { NormalizedImageResultItem, OriginalImageResultItem } from "dynamsoft-capture-vision-bundle";
import { createControls, createStyle, getElement, isEmptyObject } from "./utils";
import { EnumResultStatus, ToolbarButton, ToolbarButtonConfig } from "./utils/types";
import { displayMRZDate, EnumMRZData, MRZData, MRZDataLabel, MRZDate, MRZResult } from "./utils/MRZParser";
import { MRZScanner_ICONS } from "./utils/icons";

export interface MRZResultViewToolbarButtonsConfig {
  retake?: ToolbarButtonConfig;

  done?: ToolbarButtonConfig;
}

export interface MRZResultViewConfig {
  container?: HTMLElement | string;
  toolbarButtonsConfig?: MRZResultViewToolbarButtonsConfig;

  showOriginalImage?: boolean;
  onDone?: (result: MRZResult) => Promise<void>;
}

export default class MRZResultView {
  private currentScanResultViewResolver?: (result: MRZResult) => void;

  constructor(
    private resources: SharedResources,
    private config: MRZResultViewConfig,
    private scannerView: MRZScannerView
  ) {}

  async launch(): Promise<MRZResult> {
    try {
      getElement(this.config.container).textContent = "";
      await this.initialize();
      getElement(this.config.container).style.display = "flex";

      // Return promise that resolves when user clicks done
      return new Promise((resolve) => {
        this.currentScanResultViewResolver = resolve;
      });
    } catch (ex: any) {
      let errMsg = ex?.message || ex;
      console.error(errMsg);
      throw errMsg;
    }
  }

  private async handleRetake() {
    try {
      if (!this.scannerView) {
        console.error("Correction View not initialized");
        return;
      }

      this.hideView();
      const result = await this.scannerView.launch();

      if (result?.status?.code === EnumResultStatus.RS_FAILED) {
        if (this.currentScanResultViewResolver) {
          this.currentScanResultViewResolver(result);
        }
        return;
      }

      // Handle success case
      if (this.resources.onResultUpdated) {
        if (result?.status.code === EnumResultStatus.RS_CANCELLED) {
          this.resources.onResultUpdated(this.resources.result);
        } else if (result?.status.code === EnumResultStatus.RS_SUCCESS) {
          this.resources.onResultUpdated(result);
        }
      }

      this.dispose(true);
      await this.initialize();
      getElement(this.config.container).style.display = "flex";
    } catch (error) {
      console.error("Error in retake handler:", error);
      // Make sure to resolve with error if something goes wrong
      if (this.currentScanResultViewResolver) {
        this.currentScanResultViewResolver({
          status: {
            code: EnumResultStatus.RS_FAILED,
            message: error?.message || error,
          },
        });
      }
      throw error;
    }
  }

  private async handleDone() {
    try {
      if (this.config?.onDone) {
        await this.config.onDone(this.resources.result);
      }

      // Resolve with current result
      if (this.currentScanResultViewResolver && this.resources.result) {
        this.currentScanResultViewResolver(this.resources.result);
      }

      // Clean up
      this.hideView();
      this.dispose();
    } catch (error) {
      console.error("Error in done handler:", error);
      // Make sure to resolve with error if something goes wrong
      if (this.currentScanResultViewResolver) {
        this.currentScanResultViewResolver({
          status: {
            code: EnumResultStatus.RS_FAILED,
            message: error?.message || error,
          },
        });
      }
      throw error;
    }
  }

  private createControls(): HTMLElement {
    const { toolbarButtonsConfig } = this.config;

    const buttons: ToolbarButton[] = [
      {
        id: `dynamsoft-mrz-scanResult-retake`,
        icon: toolbarButtonsConfig?.retake?.icon || MRZScanner_ICONS.retake,
        label: toolbarButtonsConfig?.retake?.label || "Re-take",
        onClick: () => this.handleRetake(),
        className: `${toolbarButtonsConfig?.retake?.className || ""}`,
        isHidden: toolbarButtonsConfig?.retake?.isHidden || false,
        isDisabled: !this.scannerView,
      },

      {
        id: `dynamsoft-mrz-scanResult-done`,
        icon: toolbarButtonsConfig?.done?.icon || MRZScanner_ICONS.complete,
        label: toolbarButtonsConfig?.done?.label || "Done",
        className: `${toolbarButtonsConfig?.done?.className || ""}`,
        isHidden: toolbarButtonsConfig?.done?.isHidden || false,
        onClick: () => this.handleDone(),
      },
    ];

    return createControls(buttons);
  }

  private createMRZDataDisplay() {
    const mrzData = this.resources.result?.data || {};

    if (!isEmptyObject(mrzData)) {
      const resultContainer = document.createElement("div");
      resultContainer.className = "dynamsoft-mrz-data-container";

      Object.entries(mrzData).forEach(([key, value]) => {
        if (key === EnumMRZData.InvalidFields || !value) {
          // Dont post invalid fields
          return;
        }

        const result = document.createElement("div");
        result.className = "dynamsoft-mrz-data-row";

        const resultLabel = document.createElement("span");
        resultLabel.className = "dynamsoft-mrz-data-label";
        resultLabel.innerText = MRZDataLabel[key as EnumMRZData];
        // TODO show verification with invalid fields

        const resultValue = document.createElement("span");
        resultValue.className = "dynamsoft-mrz-data-value";
        if (key === EnumMRZData.DateOfBirth || key === EnumMRZData.DateOfExpiry) {
          resultValue.innerText = displayMRZDate(value as MRZDate);
        } else if (key === EnumMRZData.MRZText) {
          resultValue.classList.add("code");
          resultValue.innerText = value as string;
        } else {
          resultValue.innerText = value as string;
        }

        result.appendChild(resultLabel);
        result.appendChild(resultValue);
        resultContainer.appendChild(result);
      });

      return resultContainer;
    }
  }

  async initialize(): Promise<void> {
    try {
      createStyle("dynamsoft-mrz-result-view-style", DEFAULT_RESULT_VIEW_STYLE);

      if (!this.resources.result) {
        throw Error("Captured image is missing. Please capture an image first!");
      }

      if (!this.config.container) {
        throw new Error("Please create a Scan Result View Container element");
      }

      // Create a wrapper div that preserves container dimensions
      const resultViewWrapper = document.createElement("div");
      Object.assign(resultViewWrapper.style, {
        display: "flex",
        width: "100%",
        height: "100%",
        backgroundColor: "#575757",
        fontSize: "12px",
        flexDirection: "column",
        alignItems: "center",
      });

      if (this.config.showOriginalImage !== false && (this.resources.result.originalImageResult as any)?.toCanvas) {
        // Create and add scan result view image container
        const scanResultViewImageContainer = document.createElement("div");
        Object.assign(scanResultViewImageContainer.style, {
          width: "100%",
          height: "200px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#323234",
        });

        // Add scan result image
        const scanResultImg = (this.resources.result.originalImageResult as any)?.toCanvas();
        Object.assign(scanResultImg.style, {
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: "contain",
        });

        scanResultViewImageContainer.appendChild(scanResultImg);
        resultViewWrapper.appendChild(scanResultViewImageContainer);
      }

      const resultContainer = this.createMRZDataDisplay();
      resultViewWrapper.appendChild(resultContainer);

      // Set up controls
      const controlContainer = this.createControls();
      resultViewWrapper.appendChild(controlContainer);

      getElement(this.config.container).appendChild(resultViewWrapper);
    } catch (ex: any) {
      let errMsg = ex?.message || ex;
      console.error(errMsg);
      alert(errMsg);
    }
  }

  hideView(): void {
    getElement(this.config.container).style.display = "none";
  }

  dispose(preserveResolver: boolean = false): void {
    // Clean up the container
    getElement(this.config.container).textContent = "";

    // Clear resolver only if not preserving
    if (!preserveResolver) {
      this.currentScanResultViewResolver = undefined;
    }
  }
}

const DEFAULT_RESULT_VIEW_STYLE = `
.dynamsoft-mrz-data-container {
  font-size: 16px;
  font-family: Verdana;
  color: white;
  overflow: auto;
  width: 100%;
  height: 100%;
  min-height: 0;
  margin: 1rem 0;
}

.dynamsoft-mrz-data-row {
  padding: 0.5rem 2rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.dynamsoft-mrz-data-label {
  color: #aaa;
}

.dynamsoft-mrz-data-value {
  word-wrap: break-word;
}

.dynamsoft-mrz-data-value.code {
  font-family: monospace;
}
.
`;
