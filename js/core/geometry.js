// Pure geometry helpers for document corners. No DOM, no browser APIs.
//
// A "corner set" is an array of 4 points {x, y} ordered
// top-left, top-right, bottom-right, bottom-left.

/** Corners inset from the photo edges, used when detection finds nothing. */
export function defaultCorners(width, height, inset = 0.1) {
  const dx = width * inset;
  const dy = height * inset;
  return [
    { x: dx, y: dy },
    { x: width - dx, y: dy },
    { x: width - dx, y: height - dy },
    { x: dx, y: height - dy },
  ];
}

/** Puts 4 arbitrary points into top-left, top-right, bottom-right, bottom-left order. */
export function orderCorners(points) {
  if (points.length !== 4) throw new Error('Expected 4 points');
  const cx = points.reduce((s, p) => s + p.x, 0) / 4;
  const cy = points.reduce((s, p) => s + p.y, 0) / 4;
  // Sort clockwise (screen coordinates: y grows downwards) starting from the top-left.
  const sorted = [...points].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  );
  let start = 0;
  let best = Infinity;
  sorted.forEach((p, i) => {
    const score = p.x + p.y; // top-left has the smallest x + y
    if (score < best) { best = score; start = i; }
  });
  return [0, 1, 2, 3].map((i) => ({ ...sorted[(start + i) % 4] }));
}

/** True when the 4 corners form a convex, non-degenerate four-sided shape. */
export function isConvexQuad(corners, minArea = 1) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const c = corners[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross === 0) return false;
    const s = Math.sign(cross);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return quadArea(corners) >= minArea;
}

/** Area of a simple polygon (shoelace formula). */
export function quadArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Size of the straightened output: the longer of each pair of opposite edges,
 * scaled down so neither side exceeds `maxSide`.
 */
export function outputSize(corners, maxSide = Infinity) {
  const [tl, tr, br, bl] = corners;
  let width = Math.max(dist(tl, tr), dist(bl, br));
  let height = Math.max(dist(tl, bl), dist(tr, br));
  const k = Math.min(1, maxSide / Math.max(width, height));
  width = Math.max(1, Math.round(width * k));
  height = Math.max(1, Math.round(height * k));
  return { width, height };
}

/**
 * 3x3 homography (row-major array of 9) mapping each `from[i]` onto `to[i]`.
 * Solves the standard 8-equation linear system with h33 = 1.
 */
export function homography(from, to) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solveLinear(A, b);
  return [...h, 1];
}

/** Applies a homography to a point. */
export function project(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
}

/** Snaps any angle to 0, 90, 180 or 270. */
export function normalizeRotation(degrees) {
  return ((Math.round(degrees / 90) * 90) % 360 + 360) % 360;
}

// Gaussian elimination with partial pivoting.
function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) throw new Error('Corners are degenerate');
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      if (!f) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}
