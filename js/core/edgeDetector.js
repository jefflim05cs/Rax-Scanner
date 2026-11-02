// Finds the 4 corners of a document in a photo.
//
// How it works:
//   1. On a small copy of the photo, blur away the text so only large shapes remain.
//   2. Collect candidate four-sided shapes in two ways: from outlines of regions
//      (brightness, colour and edges) and from combinations of long straight lines.
//      The line method still works when a corner is covered or a shadow crosses the page.
//   3. Score every candidate by how much of its outline lies on a real edge in the
//      photo, preferring larger shapes, and keep the best.
//   4. Fine-tune each side on a larger copy of the photo (cornerRefine.js).
//
// OpenCV.js (~11 MB) is loaded from a CDN on first use and cached by the browser
// afterwards. If it can't load, or no document is found, detectCorners() returns
// null and the user places the corners by hand.

import { orderCorners, isConvexQuad, quadArea } from './geometry.js';
import { scaleToFit, readPixels, releaseCanvas } from './imageOps.js';
import { refineCorners } from './cornerRefine.js';

export const OPENCV_URL = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.12.0-release.1/dist/opencv.js';

const LOAD_TIMEOUT_MS = 45_000;
const DETECT_SIDE = 640;        // detection runs on a downscaled copy
const MIN_AREA_RATIO = 0.02;    // ignore shapes smaller than this share of the photo
const MAX_LINES = 20;           // strongest straight lines combined into candidates
const MIN_COVERAGE = 0.65;      // share of the outline that must lie on real edges
const MIN_SIDE_SUPPORT = 0.3;   // ...and of each individual side
const MIN_VISIBLE = 0.75;       // share of the outline that must be inside the frame (not along its border)
const EDGE_THRESHOLD = 16;      // minimum gradient strength counted as an edge

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
  let quad;
  try {
    quad = findQuad(cv, readPixels(small));
  } finally {
    releaseCanvas(small);
  }
  if (!quad) return null;
  const rough = quad.map((p) => ({ x: p.x * k, y: p.y * k }));
  return refineCorners(photo, rough);
}

// ---------------------------------------------------------------------------
// Candidate search
// ---------------------------------------------------------------------------

function findQuad(cv, imageData) {
  const W = imageData.width;
  const H = imageData.height;
  const mats = [];
  const track = (m) => { mats.push(m); return m; };

  try {
    const rgba = track(cv.matFromImageData(imageData));
    const rgb = track(new cv.Mat());
    cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);

    // Brightness, with text and fine detail removed (dark strokes are closed over).
    const gray = track(new cv.Mat());
    cv.cvtColor(rgb, gray, cv.COLOR_RGB2GRAY);
    const textKernel = track(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(9, 9)));
    cv.morphologyEx(gray, gray, cv.MORPH_CLOSE, textKernel);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);

    // Colour saturation: separates white paper from coloured surfaces.
    const hsv = track(new cv.Mat());
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
    const channels = track(new cv.MatVector());
    cv.split(hsv, channels);
    const sat = track(channels.get(1).clone());
    cv.morphologyEx(sat, sat, cv.MORPH_OPEN, textKernel);
    cv.GaussianBlur(sat, sat, new cv.Size(5, 5), 0);

    const grad = gradients(cv, [gray, sat], track);

    // Edge maps.
    const kernel3 = track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)));
    const edgeMaps = [];
    for (const [src, lo, hi] of [[gray, 15, 45], [gray, 40, 110], [sat, 20, 60]]) {
      const e = track(new cv.Mat());
      cv.Canny(src, e, lo, hi);
      cv.dilate(e, e, kernel3);
      edgeMaps.push(e);
    }
    const regionMaps = [];
    {
      const b = track(new cv.Mat());
      cv.threshold(gray, b, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      regionMaps.push(b);
      const s = track(new cv.Mat());
      cv.threshold(sat, s, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
      regionMaps.push(s);
    }

    const imageArea = W * H;
    const candidates = [];
    const add = (pts) => {
      const q = validQuad(pts, W, H, imageArea);
      if (q) candidates.push(q);
    };

    for (const map of [...edgeMaps, ...regionMaps]) contourCandidates(cv, map, imageArea, add, track);
    lineCandidates(cv, edgeMaps[0], W, H, add, track);
    lineCandidates(cv, edgeMaps[2], W, H, add, track);

    const grayData = gray.data;
    const bright = percentile(grayData, 0.9);
    const passing = [];
    for (const quad of candidates) {
      const fit = edgeCoverage(quad, grad, W, H);
      if (fit.coverage < MIN_COVERAGE || fit.minSide < MIN_SIDE_SUPPORT || fit.visible < MIN_VISIBLE) continue;
      passing.push({ quad, fit, area: quadArea(quad) });
    }
    if (!passing.length) return null;

    // Prefer: edges along the whole outline, the outer shape over shapes printed
    // inside the page, light paper over dark objects, and the shape nearest the
    // centre (where people aim the camera).
    const maxArea = Math.max(...passing.map((c) => c.area));
    const halfDiag = Math.hypot(W, H) / 2;
    let best = null;
    for (const { quad, fit, area } of passing) {
      const cx = quad.reduce((s, p) => s + p.x, 0) / 4;
      const cy = quad.reduce((s, p) => s + p.y, 0) / 4;
      const offCentre = Math.hypot(cx - W / 2, cy - H / 2) / halfDiag;
      const score = fit.coverage
        * (0.6 + 0.4 * fit.minSide)
        * (0.55 + 0.45 * Math.sqrt(area / maxArea))
        * (1 - 0.25 * offCentre)
        * paperLikeness(quad, grayData, W, H, bright);
      if (!best || score > best.score) best = { quad, score };
    }
    return best.quad;
  } finally {
    for (const m of mats) m.delete();
  }
}

/** Combined gradient (strongest of the given single-channel images) as JS arrays. */
function gradients(cv, sources, track) {
  let gx = null;
  let gy = null;
  for (const src of sources) {
    const dx = track(new cv.Mat());
    const dy = track(new cv.Mat());
    cv.Sobel(src, dx, cv.CV_32F, 1, 0, 3);
    cv.Sobel(src, dy, cv.CV_32F, 0, 1, 3);
    const ax = dx.data32F;
    const ay = dy.data32F;
    if (!gx) {
      gx = Float32Array.from(ax);
      gy = Float32Array.from(ay);
      continue;
    }
    for (let i = 0; i < gx.length; i++) {
      if (ax[i] * ax[i] + ay[i] * ay[i] > gx[i] * gx[i] + gy[i] * gy[i]) {
        gx[i] = ax[i];
        gy[i] = ay[i];
      }
    }
  }
  return { gx, gy };
}

/** Rejects shapes that can't be a photographed page. Returns ordered corners or null. */
function validQuad(points, W, H, imageArea) {
  if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const mx = W * 0.04;
  const my = H * 0.04;
  if (points.some((p) => p.x < -mx || p.x > W + mx || p.y < -my || p.y > H + my)) return null;
  const q = orderCorners(points).map((p) => ({
    x: Math.min(W, Math.max(0, p.x)),
    y: Math.min(H, Math.max(0, p.y)),
  }));
  if (!isConvexQuad(q)) return null;
  const area = quadArea(q);
  if (area < imageArea * MIN_AREA_RATIO || area > imageArea * 0.995) return null;
  const minSide = Math.min(W, H) * 0.08;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 3) % 4];
    if (Math.hypot(b.x - a.x, b.y - a.y) < minSide) return null;
    // Interior angle between 25° and 155°.
    const v1x = b.x - a.x, v1y = b.y - a.y, v2x = c.x - a.x, v2y = c.y - a.y;
    const cos = (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y));
    if (cos > 0.906 || cos < -0.906) return null;
  }
  return q;
}

/** Candidates from region outlines: convex hull simplified to 4–6 sides. */
function contourCandidates(cv, binary, imageArea, add, track) {
  const contours = track(new cv.MatVector());
  const hierarchy = track(new cv.Mat());
  cv.findContours(binary, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

  for (let i = 0; i < contours.size(); i++) {
    const contour = contours.get(i);
    const hull = new cv.Mat();
    try {
      if (cv.contourArea(contour) < imageArea * MIN_AREA_RATIO) continue;
      cv.convexHull(contour, hull);
      const poly = approxPolygon(cv, hull);
      if (!poly) continue;
      if (poly.length === 4) {
        add(poly);
      } else {
        // 5 or 6 sides: a corner is cut off (finger, fold, shadow). Extend 4 of the
        // sides until they meet to recover the hidden corners.
        const lines = poly.map((p, j) => lineThrough(p, poly[(j + 1) % poly.length]));
        for (const combo of combinations(lines.length, 4)) {
          const ls = combo.map((j) => lines[j]);
          const pts = [];
          for (let j = 0; j < 4; j++) pts.push(intersect(ls[j], ls[(j + 1) % 4]));
          if (pts.every(Boolean)) add(pts);
        }
      }
    } finally {
      hull.delete();
      contour.delete();
    }
  }
}

function approxPolygon(cv, hull) {
  const perimeter = cv.arcLength(hull, true);
  for (const eps of [0.01, 0.02, 0.03, 0.045, 0.06]) {
    const approx = new cv.Mat();
    try {
      cv.approxPolyDP(hull, approx, eps * perimeter, true);
      const n = approx.rows;
      if (n < 4) return null;
      if (n <= 6) {
        const d = approx.data32S;
        return Array.from({ length: n }, (_, i) => ({ x: d[i * 2], y: d[i * 2 + 1] }));
      }
    } finally {
      approx.delete();
    }
  }
  return null;
}

/** Candidates from combinations of the strongest straight lines. */
function lineCandidates(cv, edges, W, H, add, track) {
  const segs = track(new cv.Mat());
  const minDim = Math.min(W, H);
  cv.HoughLinesP(edges, segs, 1, Math.PI / 180, 40, minDim * 0.12, minDim * 0.05);

  // Merge segments that lie on the same line.
  const groups = [];
  const d = segs.data32S;
  const list = [];
  for (let i = 0; i < segs.rows; i++) {
    const x1 = d[i * 4], y1 = d[i * 4 + 1], x2 = d[i * 4 + 2], y2 = d[i * 4 + 3];
    list.push({ x1, y1, x2, y2, len: Math.hypot(x2 - x1, y2 - y1) });
  }
  list.sort((a, b) => b.len - a.len);
  for (const s of list) {
    const line = lineThrough({ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 });
    const g = groups.find((g) => sameLine(g.line, line, minDim * 0.015));
    if (g) g.len += s.len;
    else groups.push({ line, len: s.len });
  }
  groups.sort((a, b) => b.len - a.len);
  const lines = groups.slice(0, MAX_LINES).map((g) => g.line);

  for (const [a, b, c, e] of combinations(lines.length, 4)) {
    const L = [lines[a], lines[b], lines[c], lines[e]];
    // Three ways to split 4 lines into two pairs of opposite sides.
    for (const [p1, p2, q1, q2] of [[0, 1, 2, 3], [0, 2, 1, 3], [0, 3, 1, 2]]) {
      if (angleBetween(L[p1], L[p2]) > 40 || angleBetween(L[q1], L[q2]) > 40) continue;
      if (angleBetween(L[p1], L[q1]) < 35) continue;
      const pts = [
        intersect(L[p1], L[q1]),
        intersect(L[q1], L[p2]),
        intersect(L[p2], L[q2]),
        intersect(L[q2], L[p1]),
      ];
      if (pts.every(Boolean)) add(pts);
    }
  }
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * How well the outline lies on real edges running in the same direction as each side.
 *   coverage: share of the visible outline on an edge (weighted by side length)
 *   minSide:  the weakest visible side's share
 *   visible:  share of the outline not running along the photo border
 */
function edgeCoverage(quad, { gx, gy }, W, H) {
  let supported = 0;
  let total = 0;
  let perimeter = 0;
  let minSide = 1;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const samples = Math.max(12, Math.round(len / 4));
    let hits = 0;
    let counted = 0;
    for (let s = 0; s < samples; s++) {
      const t = 0.04 + (0.92 * s) / (samples - 1);
      const px = a.x + (b.x - a.x) * t;
      const py = a.y + (b.y - a.y) * t;
      // Sides running along the photo border have no visible edge; don't count them.
      if (px < 3 || py < 3 || px > W - 4 || py > H - 4) continue;
      counted++;
      for (let o = -2; o <= 2; o++) {
        const x = Math.round(px + nx * o);
        const y = Math.round(py + ny * o);
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const j = y * W + x;
        const ex = gx[j];
        const ey = gy[j];
        const mag = Math.hypot(ex, ey);
        if (mag > EDGE_THRESHOLD && Math.abs(ex * nx + ey * ny) > 0.8 * mag) { hits++; break; }
      }
    }
    const weight = len * (counted / samples);
    perimeter += len;
    if (counted >= samples * 0.3) minSide = Math.min(minSide, hits / counted);
    if (counted) supported += (hits / counted) * weight;
    total += weight;
  }
  return {
    coverage: total ? supported / total : 0,
    minSide,
    visible: perimeter ? total / perimeter : 0,
  };
}

/**
 * 0.25–1: penalises dark shapes (keyboards, phones, books). Paper is rarely much
 * darker than the lightest parts of the photo, and seldom darker than its surroundings.
 */
function paperLikeness(quad, gray, W, H, bright) {
  const [tl, tr, br, bl] = quad;
  const at = (u, v) => {
    const top = { x: tl.x + (tr.x - tl.x) * u, y: tl.y + (tr.y - tl.y) * u };
    const bottom = { x: bl.x + (br.x - bl.x) * u, y: bl.y + (br.y - bl.y) * u };
    return { x: top.x + (bottom.x - top.x) * v, y: top.y + (bottom.y - top.y) * v };
  };
  const lum = (p) => {
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    return x >= 0 && y >= 0 && x < W && y < H ? gray[y * W + x] : NaN;
  };
  const mean = (values) => {
    const v = values.filter((n) => !Number.isNaN(n));
    return v.length ? v.reduce((s, n) => s + n, 0) / v.length : NaN;
  };

  const inside = [];
  for (let i = 1; i < 10; i++) for (let j = 1; j < 10; j++) inside.push(lum(at(i / 10, j / 10)));
  // A ring just outside the shape: extend each sample point beyond the edge.
  const outside = [];
  for (let i = 0; i <= 10; i++) {
    const u = i / 10;
    outside.push(lum(at(u, -0.06)), lum(at(u, 1.06)), lum(at(-0.06, u)), lum(at(1.06, u)));
  }
  // Typical paper brightness: the 75th percentile, so printed photos and dark
  // areas on the page don't make it look dark.
  const inValues = inside.filter((n) => !Number.isNaN(n)).sort((x, y) => x - y);
  const paper = inValues[Math.floor(inValues.length * 0.75)] ?? 0;
  const outMean = mean(outside);
  const contrast = Number.isNaN(outMean) ? 0 : paper - outMean;
  const lighter = clamp(1 + contrast / 100, 0.7, 1);
  const light = clamp(paper / (bright * 0.5), 0.35, 1);
  return lighter * light;
}

function percentile(values, p) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < values.length; i++) hist[values[i]]++;
  let target = values.length * p;
  for (let v = 0; v < 256; v++) {
    target -= hist[v];
    if (target <= 0) return Math.max(1, v);
  }
  return 255;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// ---------------------------------------------------------------------------
// Line helpers (lines as a·x + b·y = c with a² + b² = 1)
// ---------------------------------------------------------------------------

function lineThrough(p, q) {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  const a = -dy / len;
  const b = dx / len;
  return { a, b, c: a * p.x + b * p.y };
}

function intersect(l1, l2) {
  const det = l1.a * l2.b - l2.a * l1.b;
  if (Math.abs(det) < 1e-6) return null;
  return { x: (l1.c * l2.b - l2.c * l1.b) / det, y: (l1.a * l2.c - l2.a * l1.c) / det };
}

function angleBetween(l1, l2) {
  const cos = Math.abs(l1.a * l2.a + l1.b * l2.b);
  return (Math.acos(Math.min(1, cos)) * 180) / Math.PI;
}

function sameLine(l1, l2, maxDist) {
  if (angleBetween(l1, l2) > 3) return false;
  const sign = l1.a * l2.a + l1.b * l2.b < 0 ? -1 : 1;
  return Math.abs(l1.c - sign * l2.c) < maxDist;
}

function* combinations(n, k) {
  if (n < k) return;
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield idx.slice();
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}
