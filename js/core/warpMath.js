// Perspective warp on raw pixels. Pure function: usable on the main thread or in a worker.

import { homography } from './geometry.js';

/**
 * Maps the quadrilateral `corners` of `src` onto a straight `width` x `height` image.
 *
 * @param {{data: Uint8ClampedArray, width: number, height: number}} src  RGBA pixels
 * @param {{x:number,y:number}[]} corners  TL, TR, BR, BL in source pixel coordinates
 * @returns {Uint8ClampedArray} RGBA pixels of the output
 */
export function warpPixels(src, corners, width, height) {
  // Homography from output space to source space, so every output pixel is sampled once.
  const H = homography(
    [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }],
    corners,
  );
  const sd = src.data;
  const sw = src.width;
  const sh = src.height;
  const maxX = sw - 1;
  const maxY = sh - 1;
  const out = new Uint8ClampedArray(width * height * 4);

  let o = 0;
  for (let y = 0; y < height; y++) {
    const py = y + 0.5;
    // Numerators and denominator are linear in x, so step them instead of recomputing.
    let X = H[0] * 0.5 + H[1] * py + H[2];
    let Y = H[3] * 0.5 + H[4] * py + H[5];
    let W = H[6] * 0.5 + H[7] * py + H[8];
    for (let x = 0; x < width; x++) {
      let sx = X / W - 0.5;
      let sy = Y / W - 0.5;
      if (sx < 0) sx = 0; else if (sx > maxX) sx = maxX;
      if (sy < 0) sy = 0; else if (sy > maxY) sy = maxY;

      const x0 = sx | 0;
      const y0 = sy | 0;
      const x1 = x0 < maxX ? x0 + 1 : x0;
      const y1 = y0 < maxY ? y0 + 1 : y0;
      const fx = sx - x0;
      const fy = sy - y0;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;

      out[o]     = sd[i00]     * w00 + sd[i10]     * w10 + sd[i01]     * w01 + sd[i11]     * w11;
      out[o + 1] = sd[i00 + 1] * w00 + sd[i10 + 1] * w10 + sd[i01 + 1] * w01 + sd[i11 + 1] * w11;
      out[o + 2] = sd[i00 + 2] * w00 + sd[i10 + 2] * w10 + sd[i01 + 2] * w01 + sd[i11 + 2] * w11;
      out[o + 3] = 255;
      o += 4;

      X += H[0];
      Y += H[3];
      W += H[6];
    }
  }
  return out;
}
