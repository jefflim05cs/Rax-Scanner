// Finds the 4 corners of a document in a photo using OpenCV.js.
//
// OpenCV.js (~11 MB) is loaded from a CDN on first use and cached by the browser
// afterwards. If it can't load, or no document is found, detectCorners() returns
// null and the user places the corners by hand.

import { orderCorners, isConvexQuad, quadArea } from './geometry.js';
import { scaleToFit, readPixels, releaseCanvas } from './imageOps.js';

export const OPENCV_URL = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.12.0-release.1/dist/opencv.js';

const LOAD_TIMEOUT_MS = 45_000;
const DETECT_SIDE = 640;       // detection runs on a downscaled copy
const MIN_AREA_RATIO = 0.12;   // ignore shapes smaller than this share of the photo
const MAX_AREA_RATIO = 0.985;  // ignore the photo's own border

let loading = null;

/** Starts downloading OpenCV.js in the background. Safe to call repeatedly. */
export function preloadOpenCV() {
  loadOpenCV().catch(() => {});
}

// Resolves to { cv }. The OpenCV module object has its own `then` method, so
// it must never be passed to resolve() directly: the promise would keep calling
// that `then` forever and freeze the page.
function loadOpenCV() {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    if (globalThis.cv?.Mat) { resolve({ cv: globalThis.cv }); return; }

    const timer = setTimeout(() => fail(new Error('OpenCV took too long to load')), LOAD_TIMEOUT_MS);
    const fail = (error) => {
      clearTimeout(timer);
      loading = null; // allow a retry later
      reject(error);
    };

    const script = document.createElement('script');
    script.src = OPENCV_URL;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onerror = () => fail(new Error('Could not download OpenCV'));
    script.onload = () => {
      onReady(globalThis.cv, (cv) => {
        clearTimeout(timer);
        resolve({ cv });
      }, fail);
    };
    document.head.append(script);
  });
  return loading;
}

// The OpenCV.js build may expose a ready module, a promise-like module, or a
// module that finishes initialising later. Handles all three with callbacks.
function onReady(cv, done, fail) {
  if (!cv) { fail(new Error('OpenCV did not initialise')); return; }
  if (cv.Mat) { done(cv); return; }
  if (typeof cv.then === 'function') {
    cv.then((mod) => {
      const ready = mod?.Mat ? mod : cv;
      globalThis.cv = ready;
      done(ready);
    });
    return;
  }
  cv.onRuntimeInitialized = () => done(cv);
}

/**
 * @param {HTMLCanvasElement} photo full-resolution photo
 * @returns {Promise<{x,y}[] | null>} corners in photo pixels, or null if none found
 */
export async function detectCorners(photo) {
  const { cv } = await loadOpenCV();
  const small = scaleToFit(photo, DETECT_SIDE);
  const k = photo.width / small.width;
  try {
    const quad = findQuad(cv, readPixels(small));
    if (!quad) return null;
    return orderCorners(quad.map((p) => ({ x: p.x * k, y: p.y * k })));
  } finally {
    releaseCanvas(small);
  }
}

function findQuad(cv, imageData) {
  const area = imageData.width * imageData.height;
  const mats = [];
  const track = (m) => { mats.push(m); return m; };

  try {
    const rgba = track(cv.matFromImageData(imageData));
    const gray = track(new cv.Mat());
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    const blur = track(new cv.Mat());
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);

    const kernel = track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)));

    // Edge map 1: Canny edges, thickened so small gaps close.
    const edges = track(new cv.Mat());
    cv.Canny(blur, edges, 40, 120);
    cv.dilate(edges, edges, kernel, new cv.Point(-1, -1), 2);

    // Edge map 2: bright paper against a darker background (Otsu threshold).
    const bright = track(new cv.Mat());
    cv.threshold(blur, bright, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    cv.morphologyEx(bright, bright, cv.MORPH_CLOSE, kernel, new cv.Point(-1, -1), 3);

    let best = null;
    for (const map of [edges, bright]) {
      const found = bestQuadIn(cv, map, area, track);
      if (found && (!best || found.area > best.area)) best = found;
    }
    return best?.points ?? null;
  } finally {
    for (const m of mats) m.delete();
  }
}

function bestQuadIn(cv, binary, imageArea, track) {
  const contours = track(new cv.MatVector());
  const hierarchy = track(new cv.Mat());
  cv.findContours(binary, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

  let best = null;
  for (let i = 0; i < contours.size(); i++) {
    const contour = contours.get(i);
    try {
      const a = cv.contourArea(contour);
      if (a < imageArea * MIN_AREA_RATIO) continue;

      const hull = new cv.Mat();
      cv.convexHull(contour, hull);
      try {
        const points = approxToQuad(cv, hull);
        if (!points) continue;
        const qa = quadArea(points);
        if (qa < imageArea * MIN_AREA_RATIO || qa > imageArea * MAX_AREA_RATIO) continue;
        const ordered = orderCorners(points);
        if (!isConvexQuad(ordered)) continue;
        if (!best || qa > best.area) best = { points: ordered, area: qa };
      } finally {
        hull.delete();
      }
    } finally {
      contour.delete();
    }
  }
  return best;
}

// Simplifies a convex hull with growing tolerance until it has exactly 4 points.
function approxToQuad(cv, hull) {
  const perimeter = cv.arcLength(hull, true);
  for (const eps of [0.02, 0.03, 0.04, 0.06, 0.08]) {
    const approx = new cv.Mat();
    try {
      cv.approxPolyDP(hull, approx, eps * perimeter, true);
      if (approx.rows === 4) {
        const d = approx.data32S;
        return [0, 1, 2, 3].map((i) => ({ x: d[i * 2], y: d[i * 2 + 1] }));
      }
      if (approx.rows < 4) return null;
    } finally {
      approx.delete();
    }
  }
  return null;
}
