// Fine-tunes roughly detected document corners on a larger copy of the photo.
//
// For each side, the exact position of the page edge is measured at many points
// along it, a straight line is fitted through those points (ignoring outliers),
// and neighbouring lines are intersected to give the corners.

import { isConvexQuad } from './geometry.js';
import { scaleToFit, readPixels, releaseCanvas } from './imageOps.js';

const REFINE_SIDE = 1600;     // working resolution
const SEARCH_RATIO = 0.012;   // search distance either side of the rough edge, × diagonal
const SAMPLES = 64;           // measurements per side
const MIN_STEP = 6;           // minimum brightness step that counts as an edge
const TEXT_RADIUS = 3;        // dark strokes thinner than this are removed first

/**
 * @param {HTMLCanvasElement} photo
 * @param {{x,y}[]} corners  rough corners in photo pixels (TL, TR, BR, BL)
 * @returns {{x,y}[]} refined corners, or the input if refinement isn't reliable
 */
export function refineCorners(photo, corners) {
  const small = scaleToFit(photo, REFINE_SIDE);
  const W = small.width;
  const H = small.height;
  const k = W / photo.width;
  const q = corners.map((p) => ({ x: p.x * k, y: p.y * k }));
  const reach = Math.hypot(W, H) * SEARCH_RATIO;

  let gray;
  try {
    gray = toGray(readPixels(small));
  } finally {
    releaseCanvas(small);
  }
  // Only the area around the page outline is measured, so only clean that.
  const pad = Math.ceil(reach + TEXT_RADIUS * 2 + 4);
  const box = {
    x0: Math.max(0, Math.floor(Math.min(...q.map((p) => p.x)) - pad)),
    y0: Math.max(0, Math.floor(Math.min(...q.map((p) => p.y)) - pad)),
    x1: Math.min(W - 1, Math.ceil(Math.max(...q.map((p) => p.x)) + pad)),
    y1: Math.min(H - 1, Math.ceil(Math.max(...q.map((p) => p.y)) + pad)),
  };
  closeDarkStrokes(gray, W, box, TEXT_RADIUS);

  const lines = [];
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    lines.push(fitSide(gray, W, H, a, b, reach) ?? lineThrough(a, b));
  }

  const refined = [];
  for (let i = 0; i < 4; i++) {
    const p = intersect(lines[(i + 3) % 4], lines[i]);
    if (!p || Math.hypot(p.x - q[i].x, p.y - q[i].y) > reach * 2) return corners;
    refined.push({
      x: Math.min(photo.width, Math.max(0, p.x / k)),
      y: Math.min(photo.height, Math.max(0, p.y / k)),
    });
  }
  return isConvexQuad(refined) ? refined : corners;
}

function toGray({ data, width, height }) {
  const g = new Float32Array(width * height);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) {
    g[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
  }
  return g;
}

/**
 * Morphological closing (max filter, then min filter) inside `box`: removes thin
 * dark strokes such as text while keeping the page edge in place.
 */
function closeDarkStrokes(g, W, box, r) {
  const tmp = new Float32Array(g.length);
  filterPass(g, tmp, W, box, r, 1, 0, true);
  filterPass(tmp, g, W, box, r, 0, 1, true);
  filterPass(g, tmp, W, box, r, 1, 0, false);
  filterPass(tmp, g, W, box, r, 0, 1, false);
}

function filterPass(src, dst, W, { x0, y0, x1, y1 }, r, dx, dy, takeMax) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const lo = dx ? Math.max(x0, x - r) : Math.max(y0, y - r);
      const hi = dx ? Math.min(x1, x + r) : Math.min(y1, y + r);
      let v = src[y * W + x];
      if (dx) {
        const row = y * W;
        for (let i = lo; i <= hi; i++) {
          const s = src[row + i];
          if (takeMax ? s > v : s < v) v = s;
        }
      } else {
        for (let i = lo; i <= hi; i++) {
          const s = src[i * W + x];
          if (takeMax ? s > v : s < v) v = s;
        }
      }
      dst[y * W + x] = v;
    }
  }
}

function sample(g, W, H, x, y) {
  if (x < 0 || y < 0 || x > W - 1 || y > H - 1) return NaN;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, W - 1);
  const y1 = Math.min(y0 + 1, H - 1);
  const fx = x - x0;
  const fy = y - y0;
  const top = g[y0 * W + x0] * (1 - fx) + g[y0 * W + x1] * fx;
  const bottom = g[y1 * W + x0] * (1 - fx) + g[y1 * W + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Measures the edge along one side and fits a line. Returns null if unreliable. */
function fitSide(g, W, H, a, b, reach) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 10) return null;
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  const steps = Math.ceil(reach);
  const points = [];

  // First pass: find which way brightness steps across this edge (usually
  // darker desk → brighter paper), so later measurements only accept that direction.
  const raw = [];
  for (let s = 0; s < SAMPLES; s++) {
    const t = 0.06 + (0.88 * s) / (SAMPLES - 1);
    const px = a.x + (b.x - a.x) * t;
    const py = a.y + (b.y - a.y) * t;
    const profile = [];
    for (let o = -steps - 1; o <= steps + 1; o++) profile.push(sample(g, W, H, px + nx * o, py + ny * o));
    raw.push({ px, py, profile });
  }
  let pos = 0;
  let neg = 0;
  for (const { profile } of raw) {
    const best = strongestStep(profile, 0);
    if (best && best.d > 0) pos++;
    else if (best) neg++;
  }
  const polarity = pos >= neg ? 1 : -1;

  for (const { px, py, profile } of raw) {
    const best = strongestStep(profile, polarity);
    if (!best) continue;
    const o = best.i - steps - 1;
    points.push({ x: px + nx * o, y: py + ny * o });
  }
  if (points.length < SAMPLES * 0.35) return null;
  return robustLine(points, SAMPLES * 0.3);
}

/** Position (with sub-pixel accuracy) of the largest brightness step in a profile. */
function strongestStep(profile, polarity) {
  let bestI = -1;
  let bestD = 0;
  const d = new Array(profile.length).fill(0);
  for (let i = 1; i < profile.length - 1; i++) {
    const v = profile[i + 1] - profile[i - 1];
    if (Number.isNaN(v)) continue;
    d[i] = v;
    const score = polarity === 0 ? Math.abs(v) : v * polarity;
    if (score > bestD) { bestD = score; bestI = i; }
  }
  if (bestI < 0 || bestD < MIN_STEP * 2) return null;
  // Parabola through the peak and its neighbours.
  const l = Math.abs(d[bestI - 1] ?? 0);
  const c = Math.abs(d[bestI]);
  const r = Math.abs(d[bestI + 1] ?? 0);
  const den = l - 2 * c + r;
  const shift = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / den)) : 0;
  return { i: bestI + shift, d: d[bestI] };
}

/** Total-least-squares line fit, repeatedly dropping outliers. */
function robustLine(points, minPoints) {
  let pts = points;
  let line = null;
  for (let iter = 0; iter < 4; iter++) {
    line = fitLine(pts);
    if (!line) return null;
    const res = pts.map((p) => Math.abs(line.a * p.x + line.b * p.y - line.c));
    const sorted = [...res].sort((x, y) => x - y);
    const median = sorted[Math.floor(sorted.length / 2)];
    const limit = Math.max(1.0, median * 2.5);
    const kept = pts.filter((_, i) => res[i] <= limit);
    if (kept.length < minPoints) return iter === 0 ? null : line;
    if (kept.length === pts.length) break;
    pts = kept;
  }
  return line;
}

function fitLine(pts) {
  const n = pts.length;
  if (n < 2) return null;
  let mx = 0;
  let my = 0;
  for (const p of pts) { mx += p.x; my += p.y; }
  mx /= n;
  my /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  // Direction of the line = main axis of the point cloud.
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const a = -Math.sin(theta);
  const b = Math.cos(theta);
  return { a, b, c: a * mx + b * my };
}

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
