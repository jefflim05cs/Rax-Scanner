// Pixel operations available to the worker (and to the main-thread fallback).

import { warpPixels } from './warpMath.js';
import { enhancePixels } from './enhance.js';

export const OPERATIONS = {
  warp: warpPixels,
  enhance: enhancePixels,
};
