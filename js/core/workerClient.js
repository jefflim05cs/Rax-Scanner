// Sends pixel operations to the background worker (imageWorker.js). If workers
// aren't available the same code runs on the main thread instead.

import { OPERATIONS } from './operations.js';

let worker = null;
let workerBroken = false;
let nextJob = 1;
const jobs = new Map();

function getWorker() {
  if (worker || workerBroken) return worker;
  try {
    worker = new Worker(new URL('./imageWorker.js', import.meta.url), { type: 'module' });
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

/**
 * Runs OPERATIONS[op](...args) and resolves with the resulting pixels.
 * Arguments are copied to the worker, so callers keep their own data.
 */
export function run(op, ...args) {
  const runHere = () => OPERATIONS[op](...args);
  const w = getWorker();
  if (!w) return Promise.resolve().then(runHere);

  return new Promise((resolve, reject) => {
    const id = nextJob++;
    jobs.set(id, {
      resolve,
      reject,
      fallback: () => {
        try { resolve(runHere()); } catch (e) { reject(e); }
      },
    });
    w.postMessage({ id, op, args });
  });
}

/** ImageData → plain object that can be sent to the worker. */
export function pixelsOf(imageData) {
  return { data: imageData.data, width: imageData.width, height: imageData.height };
}
