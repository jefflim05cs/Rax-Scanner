// Rax Scanner — entry point. Creates every part of the app and connects them.

import { createUI } from './views/index.js';
import { createController } from './app/controller.js';
import { createScanSession } from './core/scanSession.js';
import { createCamera } from './services/camera.js';
import * as exporter from './services/exporter.js';
import { createLeaveGuard } from './services/leaveGuard.js';

const ui = createUI(document);

const controller = createController({
  ui,
  session: createScanSession(),
  camera: createCamera(ui.camera.videoElement),
  exporter,
  leaveGuard: createLeaveGuard(),
});

controller.start();
