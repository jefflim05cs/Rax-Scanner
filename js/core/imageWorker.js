// Runs heavy pixel work off the main thread so the UI stays responsive.

import { OPERATIONS } from './operations.js';

self.onmessage = (event) => {
  const { id, op, args } = event.data;
  try {
    const pixels = OPERATIONS[op](...args);
    self.postMessage({ id, pixels }, [pixels.buffer]);
  } catch (error) {
    self.postMessage({ id, error: String(error?.message ?? error) });
  }
};
