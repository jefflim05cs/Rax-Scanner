// Rax Scanner — entry point. Creates the UI and connects it to the app layer.
//
// For now the UI is driven by a temporary preview controller with sample data.
// It will be replaced by app/controller.js once core/ and services/ exist.

import { createUI } from './views/index.js';
import { startPreview } from './app/previewController.js';

const ui = createUI(document);
startPreview(ui);
