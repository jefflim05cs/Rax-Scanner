# Rax Scanner

A mobile document scanner that runs in the browser, built for iOS Safari.

**Version:** 1.0.0
**Author:** Jeff Lim

## Flow

Take a photo → adjust the 4 corners → check the straightened scan → save → repeat → export all scans to Photos.

## Status

The UI is in place and runs with sample data (a "UI preview" badge is shown).
Camera, edge detection, straightening and exporting are not connected yet.

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
