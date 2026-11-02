// Turns a photo plus 4 corners into a straight, top-down scan.
//
// The pixel work runs in a Web Worker (warpWorker.js). If workers are not
// available it runs on the main thread with the same code (warpMath.js).

import { outputSize, isConvexQuad } from './geometry.js';
import { warpPixels } from './warpMath.js';
import { createCanvas, readPixels } from './imageOps.js';

/** Longest side of a scan, in pixels. Keeps memory use safe on iPhones. */
export const MAX_SCAN_SIDE = 3200;

let worker = null;
let workerBroken = false;
let nextJob = 1;
const jobs = new Map();

function getWorker() {
  if (worker || workerBroken) return worker;
  try {
    worker = new Worker(new URL('./warpWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const job = jobs.get(data.id);
      if (!job) return;
      jobs.delete(data.id);
      if (data.error) job.reject(new Error(data.error));
      else job.resolve(data.pixels);
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      workerBroken = true;
      worker?.terminate();
      worker = null;
      for (const job of jobs.values()) job.fallback();
      jobs.clear();
    };
  } catch {
    workerBroken = true;
    worker = null;
  }
  return worker;
}

function warp(src, corners, width, height) {
  const runHere = () => warpPixels(src, corners, width, height);
  const w = getWorker();
  if (!w) return Promise.resolve(runHere());

  return new Promise((resolve, reject) => {
    const id = nextJob++;
    jobs.set(id, {
      resolve,
      reject,
      fallback: () => {
        try { resolve(runHere()); } catch (e) { reject(e); }
      },
    });
    // The source pixels are copied (not transferred) so the fallback can still use them.
    w.postMessage({ id, src: { data: src.data, width: src.width, height: src.height }, corners, width, height });
  });
}

/**
 * @param {HTMLCanvasElement} source  the full-resolution photo
 * @param {{x,y}[]} corners           TL, TR, BR, BL in photo pixels
 * @returns {Promise<HTMLCanvasElement>} the straightened scan
 */
export async function straighten(source, corners, { maxSide = MAX_SCAN_SIDE } = {}) {
  if (!isConvexQuad(corners)) throw new Error('Corners must form a four-sided shape');
  const { width, height } = outputSize(corners, maxSide);
  const src = readPixels(source);
  const pixels = await warp(src, corners, width, height);
  const out = createCanvas(width, height);
  out.getContext('2d').putImageData(new ImageData(pixels, width, height), 0, 0);
  return out;
}
