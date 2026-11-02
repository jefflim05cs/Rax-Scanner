// Off-screen canvas helpers. These never touch the visible page.
//
// iOS Safari caps total canvas memory, so canvases that are no longer needed
// should be passed to releaseCanvas() rather than left for garbage collection.

/** Largest canvas area iOS Safari will reliably allocate (16.7 megapixels). */
export const MAX_CANVAS_AREA = 16_777_216;

export function createCanvas(width, height) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(width));
  c.height = Math.max(1, Math.round(height));
  return c;
}

/** Frees a canvas's pixel memory immediately (works around iOS Safari holding on to it). */
export function releaseCanvas(canvas) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

/** Returns a new canvas scaled so its longest side is at most `maxSide` (never upscales). */
export function scaleToFit(source, maxSide) {
  const w = source.width;
  const h = source.height;
  const k = Math.min(1, maxSide / Math.max(w, h));
  const out = createCanvas(w * k, h * k);
  const g = out.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, 0, 0, out.width, out.height);
  return out;
}

/** Returns a new canvas rotated clockwise by 0, 90, 180 or 270 degrees. */
export function rotate(source, degrees) {
  const d = ((degrees % 360) + 360) % 360;
  const w = source.width;
  const h = source.height;
  const turned = d === 90 || d === 270;
  const out = createCanvas(turned ? h : w, turned ? w : h);
  const g = out.getContext('2d');
  g.translate(out.width / 2, out.height / 2);
  g.rotate((d * Math.PI) / 180);
  g.drawImage(source, -w / 2, -h / 2);
  return out;
}

/** Decodes an image Blob into a new canvas. */
export async function canvasFromBlob(blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const out = createCanvas(bitmap.width, bitmap.height);
    out.getContext('2d').drawImage(bitmap, 0, 0);
    return out;
  } finally {
    bitmap.close?.();
  }
}

/** Reads all pixels of a canvas. */
export function readPixels(canvas) {
  const g = canvas.getContext('2d', { willReadFrequently: true });
  return g.getImageData(0, 0, canvas.width, canvas.height);
}
