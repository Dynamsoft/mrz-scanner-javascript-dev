import MRZScanner from "./MRZScanner";
import MRZResultView from "./views/MRZResultView";
import MRZScannerView from "./views/MRZScannerView";
import { MRZDataLabel } from "./views/utils/MRZParser";

export const DynamsoftMRZScanner = {
  MRZScanner,
  MRZScannerView,
  MRZResultView,
};

export { MRZScanner, MRZScannerView, MRZResultView, MRZDataLabel };
export default DynamsoftMRZScanner;
