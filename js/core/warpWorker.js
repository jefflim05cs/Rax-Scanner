// Runs the perspective warp off the main thread so the UI stays responsive.

import { warpPixels } from './warpMath.js';

self.onmessage = (event) => {
  const { id, src, corners, width, height } = event.data;
  try {
    const pixels = warpPixels(src, corners, width, height);
    self.postMessage({ id, pixels }, [pixels.buffer]);
  } catch (error) {
    self.postMessage({ id, error: String(error?.message ?? error) });
  }
};
