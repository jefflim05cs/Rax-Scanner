// Applies a scan filter to a canvas.

import { createCanvas, readPixels } from './imageOps.js';
import { run, pixelsOf } from './workerClient.js';

export const FILTERS = ['enhanced', 'bw', 'original'];

/** Returns a new canvas with `filter` applied. */
export async function applyFilter(canvas, filter) {
  if (!FILTERS.includes(filter)) throw new Error(`Unknown filter: ${filter}`);
  const { width, height } = canvas;
  const out = createCanvas(width, height);
  const g = out.getContext('2d');
  if (filter === 'original') {
    g.drawImage(canvas, 0, 0);
    return out;
  }
  const pixels = await run('enhance', pixelsOf(readPixels(canvas)), filter);
  g.putImageData(new ImageData(pixels, width, height), 0, 0);
  return out;
}
