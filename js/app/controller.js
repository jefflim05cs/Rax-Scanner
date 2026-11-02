// The app's user flow. This is the only module that talks to both the views and
// the core/services layers: it receives user intents, does the work, updates
// the state, and renders the views from that state.

import { createState } from './state.js';
import { defaultCorners, isConvexQuad } from '../core/geometry.js';
import { straighten } from '../core/perspective.js';
import { detectCorners, preloadOpenCV } from '../core/edgeDetector.js';
import { scaleToFit, rotate, canvasFromBlob, releaseCanvas } from '../core/imageOps.js';
import { encode, fileName, FORMATS } from '../core/encoder.js';
import { applyFilter, FILTERS } from '../core/filters.js';

const DISPLAY_SIDE = 2400;  // photo copy shown on the corners screen
const PREVIEW_SIDE = 1600;  // straightened preview on the check screen
const THUMB_SIDE = 360;     // saved-scan thumbnails

export function createController({ ui, session, camera, exporter, leaveGuard }) {
  const state = createState({
    screen: 'camera',
    cameraStatus: 'starting',
    cameraMessage: '',
    capturing: false,

    photo: null,            // { url, width, height }
    corners: null,
    detectedCorners: null,
    detecting: false,
    detectionFailed: false,

    resultUrl: null,
    rotation: 0,
    filter: 'enhanced',     // kept between scans
    processing: false,
    saving: false,

    scans: [],              // snapshot of session.all()
    viewerId: null,
    viewerBusy: false,

    exportOpen: false,
    format: 'jpg',
    exportPhase: 'idle',    // idle | preparing | ready | sharing
    exportProgress: 0,
  });

  // Large objects kept out of the state.
  let photoCanvas = null;
  let warpedCanvas = null;
  let preparedFiles = null;
  let job = 0; // increments to cancel stale async work

  const set = (patch) => state.set(patch);
  const get = () => state.get();
  const syncScans = () => {
    set({ scans: session.all() });
    leaveGuard.setActive(session.hasUnexported);
  };

  // ---------- Camera ----------

  async function startCamera() {
    if (camera.isLive) {
      await camera.start();
      set({ cameraStatus: 'ready' });
      return;
    }
    set({ cameraStatus: 'starting', cameraMessage: '' });
    try {
      await camera.start();
      set({ cameraStatus: 'ready' });
      preloadOpenCV();
    } catch (error) {
      set({ cameraStatus: error.kind === 'denied' ? 'denied' : 'error', cameraMessage: error.message });
    }
  }

  async function capture() {
    if (get().capturing || get().cameraStatus !== 'ready') return;
    set({ capturing: true });
    const myJob = ++job;
    let canvas;
    try {
      canvas = camera.capture();
    } catch (error) {
      set({ capturing: false });
      ui.toast(error.message);
      return;
    }
    camera.pause();

    try {
      const display = scaleToFit(canvas, DISPLAY_SIDE);
      const blob = await encode(display, 'jpg', 0.9);
      releaseCanvas(display);
      if (myJob !== job) { releaseCanvas(canvas); set({ capturing: false }); return; }

      discardCapture();
      photoCanvas = canvas;
      set({
        capturing: false,
        screen: 'corners',
        photo: { url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height },
        corners: null,
        detectedCorners: null,
        detecting: true,
        detectionFailed: false,
        rotation: 0,
      });
    } catch {
      releaseCanvas(canvas);
      set({ capturing: false });
      ui.toast("Couldn't process the photo. Please try again.");
      startCamera();
      return;
    }

    let found = null;
    try {
      found = await detectCorners(photoCanvas);
    } catch {
      found = null; // OpenCV unavailable: fall back to manual corners
    }
    if (myJob !== job) return;
    const corners = found ?? defaultCorners(photoCanvas.width, photoCanvas.height);
    set({
      detecting: false,
      detectionFailed: !found,
      detectedCorners: corners,
      corners: corners.map((p) => ({ ...p })),
    });
  }

  /** Throws away the current photo and anything made from it. */
  function discardCapture() {
    const s = get();
    if (s.photo?.url) URL.revokeObjectURL(s.photo.url);
    if (s.resultUrl) URL.revokeObjectURL(s.resultUrl);
    releaseCanvas(photoCanvas);
    releaseCanvas(warpedCanvas);
    photoCanvas = null;
    warpedCanvas = null;
    set({ photo: null, corners: null, detectedCorners: null, resultUrl: null, rotation: 0 });
  }

  function backToCamera() {
    set({ screen: 'camera' });
    startCamera();
  }

  // ---------- Straightening ----------

  async function confirmCorners() {
    const { corners } = get();
    if (!photoCanvas || !corners || !isConvexQuad(corners)) return;
    const myJob = ++job;
    set({ screen: 'confirm', processing: true, rotation: 0 });
    clearResult();
    try {
      const warped = await straighten(photoCanvas, corners);
      if (myJob !== job) { releaseCanvas(warped); return; }
      releaseCanvas(warpedCanvas);
      warpedCanvas = warped;
      await updatePreview(myJob);
    } catch {
      if (myJob !== job) return;
      ui.toast("Couldn't straighten the scan. Check the corners and try again.");
      set({ screen: 'corners' });
    } finally {
      if (myJob === job) set({ processing: false });
    }
  }

  async function updatePreview(myJob) {
    const small = scaleToFit(warpedCanvas, PREVIEW_SIDE);
    let filtered;
    try {
      filtered = await applyFilter(small, get().filter);
    } finally {
      releaseCanvas(small);
    }
    if (myJob !== job) { releaseCanvas(filtered); return; }
    const turned = rotate(filtered, get().rotation);
    releaseCanvas(filtered);
    const blob = await encode(turned, 'jpg', 0.85);
    releaseCanvas(turned);
    if (myJob !== job) return;
    clearResult();
    set({ resultUrl: URL.createObjectURL(blob) });
  }

  function clearResult() {
    const { resultUrl } = get();
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    set({ resultUrl: null });
  }

  async function rotatePreview() {
    if (!warpedCanvas || get().processing) return;
    await refreshPreview({ rotation: (get().rotation + 90) % 360 });
  }

  async function selectFilter(filter) {
    if (!FILTERS.includes(filter) || filter === get().filter || get().saving) return;
    if (!warpedCanvas) { set({ filter }); return; }
    await refreshPreview({ filter });
  }

  async function refreshPreview(patch) {
    const myJob = ++job;
    set({ ...patch, processing: true });
    try {
      await updatePreview(myJob);
    } catch {
      if (myJob === job) ui.toast("Couldn't update the preview. Please try again.");
    } finally {
      if (myJob === job) set({ processing: false });
    }
  }

  function adjustCorners() {
    ++job;
    releaseCanvas(warpedCanvas);
    warpedCanvas = null;
    clearResult();
    set({ screen: 'corners', processing: false });
  }

  async function save() {
    if (!warpedCanvas || get().saving) return;
    const myJob = ++job;
    set({ saving: true });
    try {
      const filtered = await applyFilter(warpedCanvas, get().filter);
      const turned = rotate(filtered, get().rotation);
      releaseCanvas(filtered);
      const { blob, thumb, width, height } = await finishImage(turned);
      if (myJob !== job) return;
      session.add({ blob, thumb, width, height });
      syncScans();
      discardCapture();
      set({ saving: false });
      backToCamera();
      const n = session.count;
      ui.toast(`Saved · ${n} ${n === 1 ? 'scan' : 'scans'}`);
    } catch {
      set({ saving: false });
      ui.toast("Couldn't save the scan. Please try again.");
    }
  }

  /** Encodes a finished scan canvas (and releases it). */
  async function finishImage(canvas) {
    try {
      const blob = await encode(canvas, 'png');
      const small = scaleToFit(canvas, THUMB_SIDE);
      const thumb = await encode(small, 'jpg', 0.8);
      releaseCanvas(small);
      return { blob, thumb, width: canvas.width, height: canvas.height };
    } finally {
      releaseCanvas(canvas);
    }
  }

  // ---------- Saved scans ----------

  function openScan(id) {
    if (session.get(id)) set({ screen: 'viewer', viewerId: id });
  }

  function stepScan(delta) {
    const scans = session.all();
    const i = session.indexOf(get().viewerId) + delta;
    if (i >= 0 && i < scans.length) set({ viewerId: scans[i].id });
  }

  async function rotateScan(id) {
    const scan = session.get(id);
    if (!scan || get().viewerBusy) return;
    set({ viewerBusy: true });
    try {
      const canvas = await canvasFromBlob(scan.blob);
      const turned = rotate(canvas, 90);
      releaseCanvas(canvas);
      session.replace(id, await finishImage(turned));
      syncScans();
      resetExport();
    } catch {
      ui.toast("Couldn't rotate the scan.");
    } finally {
      set({ viewerBusy: false });
    }
  }

  function deleteScan(id) {
    const i = session.indexOf(id);
    if (i < 0) return;
    session.remove(id);
    syncScans();
    resetExport();
    const scans = session.all();
    if (!scans.length) {
      set({ screen: 'scans', viewerId: null });
    } else {
      set({ viewerId: scans[Math.min(i, scans.length - 1)].id });
    }
    ui.toast('Scan deleted');
  }

  // ---------- Export ----------

  function resetExport() {
    preparedFiles = null;
    set({ exportPhase: 'idle', exportProgress: 0 });
  }

  async function prepareExport() {
    const scans = session.all();
    if (!scans.length || get().exportPhase !== 'idle') return;
    const { format } = get();
    const date = new Date();
    set({ exportPhase: 'preparing', exportProgress: 0 });
    try {
      const files = [];
      for (let i = 0; i < scans.length; i++) {
        set({ exportProgress: i });
        const blob = format === 'png' ? scans[i].blob : await toJpg(scans[i].blob);
        files.push(new File([blob], fileName(date, i, format), { type: FORMATS[format].mime }));
      }
      // Ignore the result if the sheet was closed or the format changed meanwhile.
      if (get().exportPhase !== 'preparing' || get().format !== format) return;
      preparedFiles = files;
      set({ exportPhase: 'ready' });
    } catch {
      resetExport();
      ui.toast("Couldn't prepare the files. Please try again.");
    }
  }

  async function toJpg(pngBlob) {
    const canvas = await canvasFromBlob(pngBlob);
    try {
      return await encode(canvas, 'jpg');
    } finally {
      releaseCanvas(canvas);
    }
  }

  async function share() {
    if (!preparedFiles || get().exportPhase !== 'ready') return;
    set({ exportPhase: 'sharing' });
    try {
      // Must run straight from the tap, with no awaits before it.
      const result = await exporter.exportFiles(preparedFiles);
      if (result === 'cancelled') {
        set({ exportPhase: 'ready' });
        return;
      }
      const n = preparedFiles.length;
      session.markAllExported();
      syncScans();
      preparedFiles = null;
      set({ exportOpen: false, exportPhase: 'idle' });
      ui.toast(result === 'shared'
        ? `Exported ${n} ${n === 1 ? 'scan' : 'scans'}`
        : `Downloaded ${n} ${n === 1 ? 'file' : 'files'}`);
    } catch {
      set({ exportPhase: 'ready' });
      ui.toast("Couldn't open the share menu. Please try again.");
    }
  }

  // ---------- Intents ----------

  const intents = {
    // Camera
    capture,
    retryCamera: startCamera,
    openScans: () => set({ screen: 'scans' }),

    // Corners
    retake() {
      ++job;
      discardCapture();
      set({ detecting: false, processing: false });
      backToCamera();
    },
    cornersChanged: ({ corners }) => set({ corners }),
    resetCorners() {
      const { detectedCorners } = get();
      if (detectedCorners) set({ corners: detectedCorners.map((p) => ({ ...p })) });
    },
    confirmCorners,

    // Confirm
    adjustCorners,
    rotate: rotatePreview,
    selectFilter: ({ filter }) => selectFilter(filter),
    save,

    // Scans
    backToCamera,
    openScan: ({ id }) => openScan(id),
    openExport() {
      if (!session.count) return;
      resetExport();
      set({ exportOpen: true });
    },

    // Viewer
    closeViewer: () => set({ screen: 'scans' }),
    prevScan: () => stepScan(-1),
    nextScan: () => stepScan(1),
    rotateScan: ({ id }) => rotateScan(id),
    deleteScan: ({ id }) => deleteScan(id),

    // Export
    closeExport() {
      if (get().exportPhase === 'preparing' || get().exportPhase === 'sharing') return;
      resetExport();
      set({ exportOpen: false });
    },
    selectFormat({ format }) {
      if (!FORMATS[format] || format === get().format) return;
      resetExport();
      set({ format });
    },
    export: prepareExport,
    share,
  };

  ui.setIntentHandler((name, payload) => {
    const fn = intents[name];
    if (fn) fn(payload);
    else console.warn(`Unhandled intent: ${name}`, payload);
  });

  // ---------- Rendering ----------

  function render(s) {
    ui.screens.show(s.screen);

    const scans = s.scans;
    const last = scans[scans.length - 1];
    ui.camera.render({
      status: s.cameraStatus,
      message: s.cameraMessage,
      scanCount: scans.length,
      lastThumbUrl: last?.thumbUrl ?? null,
      capturing: s.capturing,
    });

    ui.corners.render({
      imageUrl: s.photo?.url ?? null,
      imageWidth: s.photo?.width ?? 0,
      imageHeight: s.photo?.height ?? 0,
      corners: s.corners,
      cornersValid: s.corners ? isConvexQuad(s.corners, 100) : true,
      detecting: s.detecting,
      detectionFailed: s.detectionFailed,
    });

    ui.confirmScan.render({
      resultUrl: s.resultUrl,
      filter: s.filter,
      processing: s.processing,
      saving: s.saving,
    });

    ui.scans.render({
      scans: scans.map((scan) => ({ id: scan.id, thumbUrl: scan.thumbUrl })),
    });

    const index = scans.findIndex((scan) => scan.id === s.viewerId);
    const current = scans[index];
    ui.viewer.render({
      scan: current ? { id: current.id, url: current.url } : null,
      index: Math.max(0, index),
      total: scans.length,
      busy: s.viewerBusy,
    });

    ui.exportSheet.render({
      open: s.exportOpen,
      format: s.format,
      count: scans.length,
      phase: s.exportPhase,
      progress: s.exportProgress,
    });
  }

  state.subscribe(render);

  return {
    start() {
      render(get());
      startCamera();

      // iOS stops the camera when the page is hidden; restart it on return.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && get().screen === 'camera') startCamera();
      });
    },
  };
}
