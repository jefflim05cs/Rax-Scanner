// Document enhancement on raw pixels. Pure function: runs in the worker, or on
// the main thread as a fallback.
//
//   'enhanced'  even, white paper and dark text, colours kept (stamps, pen, highlighter)
//   'bw'        black text on white paper
//   'original'  unchanged

const WHITE_POINT = 0.9;   // paper at ≥ 90% of its local brightness becomes pure white
const BLACK_POINT = 0.22;  // ink at ≤ 22% of the local paper brightness becomes black
const SHARPEN = 0.6;       // unsharp-mask strength
const GRID = 48;           // paper colour is measured in about GRID × GRID cells

/**
 * @param {{data: Uint8ClampedArray, width: number, height: number}} src RGBA
 * @param {'enhanced'|'bw'|'original'} mode
 * @returns {Uint8ClampedArray} RGBA output (same size)
 */
export function enhancePixels(src, mode) {
  const { data, width: W, height: H } = src;
  if (mode === 'original') return new Uint8ClampedArray(data);

  const bg = paperColour(data, W, H);
  const out = new Uint8ClampedArray(data.length);
  const range = WHITE_POINT - BLACK_POINT;

  // Normalise each pixel by the paper colour around it, then stretch contrast.
  for (let y = 0; y < H; y++) {
    const gy = Math.min(Math.max((y + 0.5) / bg.cell - 0.5, 0), bg.gh - 1);
    const y0 = Math.floor(gy);
    const y1 = Math.min(y0 + 1, bg.gh - 1);
    const fy = gy - y0;
    for (let x = 0; x < W; x++) {
      const gx = Math.min(Math.max((x + 0.5) / bg.cell - 0.5, 0), bg.gw - 1);
      const x0 = Math.floor(gx);
      const x1 = Math.min(x0 + 1, bg.gw - 1);
      const fx = gx - x0;
      const i = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        const p = bilinear(bg.rgb, bg.gw, c, x0, x1, y0, y1, fx, fy);
        let v = (data[i + c] / p - BLACK_POINT) / range;
        v = v <= 0 ? 0 : v >= 1 ? 1 : v ** 1.1;
        out[i + c] = v * 255;
      }
      out[i + 3] = 255;
    }
  }

  if (mode === 'bw') {
    for (let i = 0; i < out.length; i += 4) {
      const l = (0.299 * out[i] + 0.587 * out[i + 1] + 0.114 * out[i + 2]) / 255;
      // Soft threshold keeps letter edges smooth.
      const t = Math.min(1, Math.max(0, (l - 0.5) / 0.22));
      const v = t * t * (3 - 2 * t) * 255;
      out[i] = v;
      out[i + 1] = v;
      out[i + 2] = v;
    }
    return out;
  }

  sharpen(out, W, H, SHARPEN);
  return out;
}

/**
 * Estimates the paper colour across the page on a coarse grid: in each cell,
 * the average colour of its brightest pixels (ignoring text), then smoothed so
 * cells covered by pictures or dense text borrow from their neighbours.
 */
function paperColour(data, W, H) {
  const cell = Math.max(8, Math.round(Math.max(W, H) / GRID));
  const gw = Math.ceil(W / cell);
  const gh = Math.ceil(H / cell);
  const cells = gw * gh;

  // Pass 1: brightness histogram per cell (32 bins).
  const hist = new Uint32Array(cells * 32);
  const lum = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const row = Math.floor(y / cell) * gw;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const l = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
      lum[y * W + x] = l;
      hist[(row + Math.floor(x / cell)) * 32 + (l >> 3)]++;
    }
  }
  // The brightest 25% of each cell is taken to be paper.
  const cut = new Uint8Array(cells);
  for (let c = 0; c < cells; c++) {
    let total = 0;
    for (let b = 0; b < 32; b++) total += hist[c * 32 + b];
    let remaining = total * 0.25;
    let b = 31;
    while (b > 0 && remaining > hist[c * 32 + b]) remaining -= hist[c * 32 + b--];
    cut[c] = b << 3;
  }

  // Pass 2: average colour of those pixels.
  const sum = new Float64Array(cells * 4);
  for (let y = 0; y < H; y++) {
    const row = Math.floor(y / cell) * gw;
    for (let x = 0; x < W; x++) {
      const c = row + Math.floor(x / cell);
      const p = y * W + x;
      if (lum[p] < cut[c]) continue;
      const i = p * 4;
      sum[c * 4] += data[i];
      sum[c * 4 + 1] += data[i + 1];
      sum[c * 4 + 2] += data[i + 2];
      sum[c * 4 + 3]++;
    }
  }
  let rgb = new Float32Array(cells * 3);
  const cellLum = new Float32Array(cells);
  for (let c = 0; c < cells; c++) {
    const n = Math.max(1, sum[c * 4 + 3]);
    for (let k = 0; k < 3; k++) rgb[c * 3 + k] = sum[c * 4 + k] / n;
    cellLum[c] = 0.299 * rgb[c * 3] + 0.587 * rgb[c * 3 + 1] + 0.114 * rgb[c * 3 + 2];
  }

  // Decide which cells show paper: bright enough (shadows are allowed) and the
  // same colour as the paper overall. Other cells are pictures, logos or heavy
  // ink; they are filled in from the surrounding paper, working inwards.
  const order = Array.from(cellLum.keys()).sort((a, b) => cellLum[b] - cellLum[a]);
  const top = order.slice(0, Math.max(1, Math.floor(cells * 0.25)));
  const paperLevel = cellLum[top[top.length - 1]] || 255;
  const tint = [0, 0, 0];
  for (const c of top) for (let k = 0; k < 3; k++) tint[k] += rgb[c * 3 + k] / Math.max(1, cellLum[c]);
  for (let k = 0; k < 3; k++) tint[k] /= top.length;

  const isPaper = new Uint8Array(cells);
  for (let c = 0; c < cells; c++) {
    const l = Math.max(1, cellLum[c]);
    let colourDiff = 0;
    for (let k = 0; k < 3; k++) colourDiff += Math.abs(rgb[c * 3 + k] / l - tint[k]);
    isPaper[c] = cellLum[c] >= paperLevel * 0.5 && colourDiff < 0.2 ? 1 : 0;
  }
  if (!isPaper.some(Boolean)) isPaper.fill(1);

  for (let pass = 0; pass < gw + gh; pass++) {
    const filled = [];
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const c = y * gw + x;
        if (isPaper[c]) continue;
        const acc = [0, 0, 0];
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
            const m = ny * gw + nx;
            if (!isPaper[m]) continue;
            for (let k = 0; k < 3; k++) acc[k] += rgb[m * 3 + k];
            n++;
          }
        }
        if (n) filled.push([c, acc[0] / n, acc[1] / n, acc[2] / n]);
      }
    }
    if (!filled.length) break;
    for (const [c, r, g, b] of filled) {
      rgb[c * 3] = r;
      rgb[c * 3 + 1] = g;
      rgb[c * 3 + 2] = b;
      isPaper[c] = 1;
    }
  }

  // Smooth twice with a 3×3 average so the correction has no visible blocks.
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(rgb.length);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        for (let k = 0; k < 3; k++) {
          let s = 0;
          let n = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
              s += rgb[(ny * gw + nx) * 3 + k];
              n++;
            }
          }
          next[(y * gw + x) * 3 + k] = s / n;
        }
      }
    }
    rgb = next;
  }
  for (let i = 0; i < rgb.length; i++) rgb[i] = Math.max(rgb[i], 24);

  return { rgb, gw, gh, cell };
}

function bilinear(rgb, gw, c, x0, x1, y0, y1, fx, fy) {
  const a = rgb[(y0 * gw + x0) * 3 + c];
  const b = rgb[(y0 * gw + x1) * 3 + c];
  const d = rgb[(y1 * gw + x0) * 3 + c];
  const e = rgb[(y1 * gw + x1) * 3 + c];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
}

/** Unsharp mask with a 3×3 box blur. */
function sharpen(px, W, H, amount) {
  const blur = new Uint8ClampedArray(px.length);
  const tmp = new Uint16Array(px.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const l = x > 0 ? i - 4 : i;
      const r = x < W - 1 ? i + 4 : i;
      for (let c = 0; c < 3; c++) tmp[i + c] = px[l + c] + px[i + c] + px[r + c];
    }
  }
  for (let y = 0; y < H; y++) {
    const up = y > 0 ? -W * 4 : 0;
    const down = y < H - 1 ? W * 4 : 0;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) blur[i + c] = (tmp[i + up + c] + tmp[i + c] + tmp[i + down + c]) / 9;
    }
  }
  for (let i = 0; i < px.length; i += 4) {
    for (let c = 0; c < 3; c++) px[i + c] = px[i + c] + amount * (px[i + c] - blur[i + c]);
  }
}
