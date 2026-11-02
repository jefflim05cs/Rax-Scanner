// Builds every view and exposes a single UI object to the app layer.
//
// The views never import anything from app/, core/ or services/. They report
// what the user did through one intent handler, set with setIntentHandler().

import { createViewManager } from './viewManager.js';
import { createCameraView } from './cameraView.js';
import { createCornerView } from './cornerView.js';
import { createConfirmView } from './confirmView.js';
import { createScansView } from './scansView.js';
import { createViewerView } from './viewerView.js';
import { createExportSheet } from './exportSheet.js';
import { createDialog } from './dialog.js';
import { createToast } from './toast.js';

export function createUI(doc = document) {
  let handler = () => {};
  const onIntent = (name, payload = {}) => handler(name, payload);

  const screens = createViewManager(doc.getElementById('app'));
  const confirm = createDialog(doc.getElementById('dialog-root'));
  const toast = createToast(doc.getElementById('toast-root'));

  return {
    screens,
    confirm,
    toast,
    camera: createCameraView(screens.root('camera'), { onIntent }),
    corners: createCornerView(screens.root('corners'), { onIntent }),
    confirmScan: createConfirmView(screens.root('confirm'), { onIntent }),
    scans: createScansView(screens.root('scans'), { onIntent }),
    viewer: createViewerView(screens.root('viewer'), { onIntent, confirm }),
    exportSheet: createExportSheet(doc.getElementById('sheet-root'), { onIntent }),

    /** Sets the function that receives every user intent: fn(name, payload). */
    setIntentHandler(fn) {
      handler = fn;
    },
  };
}
