// Turns a photo plus 4 corners into a straight, top-down scan with the
// document's real proportions.

import { outputSize, isConvexQuad } from './geometry.js';
import { createCanvas, readPixels } from './imageOps.js';
import { run, pixelsOf } from './workerClient.js';

/** Longest side of a scan, in pixels. Keeps memory use safe on iPhones. */
export const MAX_SCAN_SIDE = 3200;

/**
 * @param {HTMLCanvasElement} source  the full-resolution photo
 * @param {{x,y}[]} corners           TL, TR, BR, BL in photo pixels
 * @returns {Promise<HTMLCanvasElement>} the straightened scan
 */
export async function straighten(source, corners, { maxSide = MAX_SCAN_SIDE } = {}) {
  if (!isConvexQuad(corners)) throw new Error('Corners must form a four-sided shape');
  const { width, height } = outputSize(corners, source.width, source.height, maxSide);
  const pixels = await run('warp', pixelsOf(readPixels(source)), corners, width, height);
  const out = createCanvas(width, height);
  out.getContext('2d').putImageData(new ImageData(pixels, width, height), 0, 0);
  return out;
}
