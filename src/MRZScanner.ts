import { LicenseManager } from "dynamsoft-license";
import { CoreModule, EngineResourcePaths } from "dynamsoft-core";
import { CaptureVisionRouter } from "dynamsoft-capture-vision-router";
import { CameraEnhancer, CameraView } from "dynamsoft-camera-enhancer";
import { CodeParserModule } from "dynamsoft-code-parser";
import { LabelRecognizerModule } from "dynamsoft-label-recognizer";
import {
  DEFAULT_TEMPLATE_NAMES,
  EnumMRZDocumentType,
  EnumMRZScanMode,
  EnumMRZScannerViews,
  EnumResultStatus,
  UtilizedTemplateNames,
} from "./views/utils/types";
import { getElement, isEmptyObject } from "./views/utils";
import MRZScannerView, { MRZScannerViewConfig } from "./views/MRZScannerView";
import { MRZResult } from "./views/utils/MRZParser";

// Default DCE UI path
const DEFAULT_DCE_UI_PATH = "../dist/mrz-scanner.ui.html";
// "https://cdn.jsdelivr.net/npm/dynamsoft-mrz-scanner@2.0.0/dist/mrz-scanner.ui.html"; TODO
const DEFAULT_MRZ_SCANNER_TEMPLATE_PATH = "../dist/mrz-scanner.template.json";
// "https://cdn.jsdelivr.net/npm/dynamsoft-mrz-scanner@2.0.0/dist/mrz-scanner.template.json"; TODO

const DEFAULT_DCV_ENGINE_RESOURCE_PATHS = { rootDirectory: "https://cdn.jsdelivr.net/npm/" };
const DEFAULT_CONTAINER_HEIGHT = "100dvh";

export interface MRZScannerConfig {
  license?: string;
  container?: HTMLElement | string;

  // DCV specific configs
  templateFilePath?: string;
  utilizedTemplateNames?: UtilizedTemplateNames;
  engineResourcePaths?: EngineResourcePaths;

  // Views Config
  scannerViewConfig?: Omit<MRZScannerViewConfig, "templateFilePath" | "utilizedTemplateNames">;

  mrzFormatType?: Array<EnumMRZDocumentType>;
  showResultView?: boolean;
}

export interface SharedResources {
  cvRouter?: CaptureVisionRouter;
  cameraEnhancer?: CameraEnhancer;
  cameraView?: CameraView;
  result?: MRZResult;
  onResultUpdated?: (result: MRZResult) => void;
}

class MRZScanner {
  private scannerView?: MRZScannerView;
  private resources: Partial<SharedResources> = {};
  private isInitialized = false;
  private isCapturing = false;

  constructor(private config: MRZScannerConfig) {}

  async initialize(): Promise<{
    resources: SharedResources;
    components: {
      scannerView?: MRZScannerView;
    };
  }> {
    if (this.isInitialized) {
      return {
        resources: this.resources as SharedResources,
        components: {
          scannerView: this.scannerView,
        },
      };
    }

    try {
      this.initializeMRZScannerConfig();

      await this.initializeDCVResources();

      this.resources.onResultUpdated = (result) => {
        this.resources.result = result;
      };

      const components: {
        scannerView?: MRZScannerView;
      } = {};

      // Only initialize components that are configured
      if (this.config.scannerViewConfig) {
        this.scannerView = new MRZScannerView(this.resources, this.config.scannerViewConfig);
        components.scannerView = this.scannerView;
        await this.scannerView.initialize();
      }

      // if (this.config.resultViewConfig) {
      //   this.scanResultView = new DocumentResultView(
      //     this.resources,
      //     this.config.resultViewConfig,
      //     this.scannerView,
      //     this.correctionView
      //   );
      //   components.scanResultView = this.scanResultView;
      // }

      this.isInitialized = true;

      return { resources: this.resources, components };
    } catch (ex: any) {
      this.isInitialized = false;

      let errMsg = ex?.message || ex;
      throw new Error(`Initialization Failed: ${errMsg}`);
    }
  }

  private async initializeDCVResources(): Promise<void> {
    try {
      LicenseManager.initLicense(this.config?.license || "", true);

      //The following code uses the jsDelivr CDN, feel free to change it to your own location of these files
      CoreModule.engineResourcePaths = isEmptyObject(this.config?.engineResourcePaths)
        ? DEFAULT_DCV_ENGINE_RESOURCE_PATHS
        : this.config.engineResourcePaths;

      // Optional. Used to load wasm resources in advance, reducing latency between video playing and document modules.

      // Can add other specs. Please check https://www.dynamsoft.com/code-parser/docs/core/code-types/mrtd.html
      CoreModule.loadWasm(["DLR", "DCP"]);
      CodeParserModule.loadSpec("MRTD_TD3_PASSPORT");
      CodeParserModule.loadSpec("MRTD_TD1_ID");
      CodeParserModule.loadSpec("MRTD_TD2_ID");
      LabelRecognizerModule.loadRecognitionData("MRZ");

      this.resources.cameraView = await CameraView.createInstance(this.config.scannerViewConfig?.cameraEnhancerUIPath);
      this.resources.cameraEnhancer = await CameraEnhancer.createInstance(this.resources.cameraView);
      this.resources.cvRouter = await CaptureVisionRouter.createInstance();
    } catch (ex: any) {
      let errMsg = ex?.message || ex;
      throw new Error(`Resource Initialization Failed: ${errMsg}`);
    }
  }

  private shouldCreateDefaultContainer(): boolean {
    const hasNoMainContainer = !this.config.container;
    const hasNoViewContainers =
      !(
        this.config.scannerViewConfig?.container
        // || this.config.resultViewConfig?.container
      );
    return hasNoMainContainer && hasNoViewContainers;
  }

  private createDefaultMRZScannerContainer(): HTMLElement {
    const container = document.createElement("div");
    container.className = "mrz-scanner-main-container";
    Object.assign(container.style, {
      display: "none",
      height: DEFAULT_CONTAINER_HEIGHT,
      width: "100%",
      /* Adding the following CSS rules to make sure the "default" container appears on top and over other elements. */
      position: "absolute",
      left: "0",
      top: "0",
      zIndex: "999",
    });
    document.body.append(container);
    return container;
  }

  private checkForTemporaryLicense(license?: string) {
    return !license?.length ||
      license?.startsWith("A") ||
      license?.startsWith("L") ||
      license?.startsWith("P") ||
      license?.startsWith("Y")
      ? "DLS2eyJvcmdhbml6YXRpb25JRCI6IjIwMDAwMSJ9"
      : license;
  }

  private validateViewConfigs() {
    // Only validate if there's no main container
    if (!this.config.container) {
      // Check correction view
      // // Check result view
      // if (this.config.showResultView && !this.config.resultViewConfig?.container) {
      //   throw new Error(
      //     "ResultView container is required when showResultView is true and no main container is provided"
      //   );
      // }
    }
  }

  // private showResultView() {
  //   if (this.config.showResultView === false) return false;

  //   // If we have a main container, follow existing logic
  //   if (this.config.container) {
  //     if (
  //       this.config.showResultView === undefined &&
  //       (this.config.resultViewConfig?.container || this.config.container)
  //     ) {
  //       return true;
  //     }
  //     return !!this.config.showResultView;
  //   }

  //   // Without main container, require specific container
  //   return this.config.showResultView && !!this.config.resultViewConfig?.container;
  // }

  private initializeMRZScannerConfig() {
    this.validateViewConfigs();

    if (this.shouldCreateDefaultContainer()) {
      this.config.container = this.createDefaultMRZScannerContainer();
    } else if (this.config.container) {
      this.config.container = getElement(this.config.container);
    }
    const viewContainers = this.config.container ? this.createViewContainers(getElement(this.config.container)) : {};

    const baseConfig = {
      license: this.checkForTemporaryLicense(this.config.license),
      utilizedTemplateNames: Object.fromEntries(
        Object.values(EnumMRZScanMode).map((val) => [
          val,
          this.config.utilizedTemplateNames?.[val] || DEFAULT_TEMPLATE_NAMES[val],
        ])
      ) as Record<EnumMRZScanMode, string>,
      templateFilePath: this.config?.templateFilePath || DEFAULT_MRZ_SCANNER_TEMPLATE_PATH,
    };

    // Views Config
    const scannerViewConfig = {
      ...this.config.scannerViewConfig,
      container: viewContainers[EnumMRZScannerViews.Scanner] || this.config.scannerViewConfig?.container || null,
      cameraEnhancerUIPath: this.config.scannerViewConfig?.cameraEnhancerUIPath || DEFAULT_DCE_UI_PATH,
      templateFilePath: baseConfig.templateFilePath,
      utilizedTemplateNames: baseConfig.utilizedTemplateNames,
      mrzFormatType: this.config.mrzFormatType,
    };

    // const resultViewConfig = this.showResultView()
    //   ? {
    //       ...this.config.resultViewConfig,
    //       container: viewContainers[EnumDDSViews.Result] || this.config.resultViewConfig?.container || null,
    //     }
    //   : undefined;

    Object.assign(this.config, {
      ...baseConfig,
      scannerViewConfig,
      // correctionViewConfig,
      // resultViewConfig,
    });
  }

  private createViewContainers(mainContainer: HTMLElement): Record<string, HTMLElement> {
    mainContainer.textContent = "";

    const views: EnumMRZScannerViews[] = [EnumMRZScannerViews.Scanner];

    // if (this.showCorrectionView()) views.push(EnumDDSViews.Correction);
    // if (this.showResultView()) views.push(EnumDDSViews.Result);

    return views.reduce((containers, view) => {
      const viewContainer = document.createElement("div");
      viewContainer.className = `mrz-scanner-${view}-view-container`;

      Object.assign(viewContainer.style, {
        height: "100%",
        width: "100%",
        display: "none",
        position: "relative",
      });

      mainContainer.append(viewContainer);
      containers[view] = viewContainer;
      return containers;
    }, {} as Record<string, HTMLElement>);
  }

  dispose(): void {
    // if (this.scanResultView) {
    //   this.scanResultView.dispose();
    //   this.scanResultView = null;
    // }

    // if (this.correctionView) {
    //   this.correctionView.dispose();
    //   this.correctionView = null;
    // }

    this.scannerView = null;

    // Dispose resources
    if (this.resources.cameraEnhancer) {
      this.resources.cameraEnhancer.dispose();
      this.resources.cameraEnhancer = null;
    }

    if (this.resources.cameraView) {
      this.resources.cameraView.dispose();
      this.resources.cameraView = null;
    }

    if (this.resources.cvRouter) {
      this.resources.cvRouter.dispose();
      this.resources.cvRouter = null;
    }

    this.resources.result = null;
    this.resources.onResultUpdated = null;

    // Hide and clean containers
    const cleanContainer = (container?: HTMLElement | string) => {
      const element = getElement(container);
      if (element) {
        element.style.display = "none";
        element.textContent = "";
      }
    };

    cleanContainer(this.config.container);
    cleanContainer(this.config.scannerViewConfig?.container);
    // cleanContainer(this.config.correctionViewConfig?.container);
    // cleanContainer(this.config.resultViewConfig?.container);

    this.isInitialized = false;
  }

  async launch(): Promise<MRZResult> {
    if (this.isCapturing) {
      throw new Error("Capture session already in progress");
    }

    try {
      this.isCapturing = true;
      const { components } = await this.initialize();

      if (this.config.container) {
        getElement(this.config.container).style.display = "block";
      }

      // Special case handling for direct views with existing results
      // if (!components.scannerView && this.resources.result) {
      //   if (components.correctionView) return await components.correctionView.launch();
      //   if (components.scanResultView) return await components.scanResultView.launch();
      // }

      // Scanner view is required if no existing result
      if (!components.scannerView && !this.resources.result) {
        throw new Error("Scanner view is required when no previous result exists");
      }

      // Main Flow
      if (components.scannerView) {
        const scanResult = await components.scannerView.launch();

        if (scanResult?.status.code !== EnumResultStatus.RS_SUCCESS) {
          return {
            status: {
              code: scanResult?.status.code,
              message: scanResult?.status.message || "Failed to capture image",
            },
          };
        }

        // Route based on capture method
        // if (components.correctionView && components.scanResultView) {
        //   if (shouldCorrectImage(scanResult._flowType)) {
        //     await components.correctionView.launch();
        //     return await components.scanResultView.launch();
        //   }
        // }

        // Default routing
        // if (components.correctionView && !components.scanResultView) {
        //   return await components.correctionView.launch();
        // }
        // if (components.scanResultView) {
        //   return await components.scanResultView.launch();
        // }
      }

      // If no additional views, return current result
      return this.resources.result;
    } catch (error) {
      console.error("MRZ Scanner failed:", error?.message || error);
      return {
        status: {
          code: EnumResultStatus.RS_FAILED,
          message: `MRZ Scanner failed. ${error?.message || error}`,
        },
      };
    } finally {
      this.isCapturing = false;
      this.dispose();
    }
  }
}

export default MRZScanner;
