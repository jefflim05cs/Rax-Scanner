# Rax Scanner

A mobile document scanner that runs in the browser, built for iOS Safari.

**Version:** 1.0.0
**Author:** Jeff Lim

## Flow

Take a photo → adjust the 4 corners → check the straightened scan → save → repeat → export all scans to Photos.

## Features

- **Camera:** live back-camera preview at the highest resolution Safari offers.
- **Edge detection:** finds the document's 4 corners automatically with OpenCV.js
  (loaded from jsDelivr on first use). If it can't load or finds nothing, you place the corners by hand.
- **Corner adjustment:** drag the corners, with a magnifier for precision.
- **Straightening:** perspective correction runs in a Web Worker, up to 3200 px on the long side.
- **Saved scans:** kept in memory only (lost on refresh). View, rotate and delete them.
- **Export:** JPG or PNG through the iOS share menu ("Save Images" adds them to Photos).
  Falls back to downloads where file sharing isn't supported.
- **Leave warning:** asks before leaving with unexported scans, where the browser allows it.

## Running

No build step. Serve the folder over HTTPS (the camera requires it), for example with GitHub Pages, and open it in Safari on an iPhone.

For local testing:

```bash
python3 -m http.server 8000
```

## Structure

```
index.html            Page shell, one <section> per screen
css/
  base.css            Colours, reset, shared components
  views.css           Per-screen styles
js/
  main.js             Entry point: creates the UI and connects it to the app layer
  app/                App flow (state + controller)
  core/               Pure logic: geometry, straightening, edge detection, encoding
  services/           Browser features: camera, export, leave warning
  views/              Screens — display only, report user intents
```

The views never import from `app/`, `core/` or `services/`. They render the state they are given and report what the user did through a single intent handler.

## License

© 2026 Jeff Lim. All rights reserved.
