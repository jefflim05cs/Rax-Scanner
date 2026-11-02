// TEMPORARY — UI preview only.
//
// Drives the views with sample data so every screen can be tried on a phone
// before the real logic exists. No camera, edge detection, straightening or
// exporting happens here: photos and scans are drawn placeholders.
//
// This file will be replaced by app/controller.js, which connects the same
// intents to core/ and services/. The views do not change.

const PHOTO_W = 900;
const PHOTO_H = 1200;
const SAMPLE_CORNERS = [
  { x: 175, y: 215 },
  { x: 735, y: 255 },
  { x: 800, y: 1005 },
  { x: 110, y: 960 },
];

export function startPreview(ui) {
  showBanner();

  const state = {
    screen: 'camera',
    capturing: false,
    photo: null,          // { url, width, height }
    detectedCorners: null,
    corners: null,
    detecting: false,
    rotation: 0,
    resultUrl: null,
    processing: false,
    scans: [],            // { id, rotation, url }
    viewerIndex: 0,
    exportOpen: false,
    format: 'jpg',
    exporting: false,
  };

  let nextId = 1;
  const scenePoster = drawScene(false);

  // Show the sample scene behind the shutter instead of a live camera.
  ui.camera.videoElement.poster = scenePoster;

  function render() {
    ui.screens.show(state.screen);

    const last = state.scans[state.scans.length - 1];
    ui.camera.render({
      status: 'ready',
      scanCount: state.scans.length,
      lastThumbUrl: last?.url ?? null,
      capturing: state.capturing,
    });

    ui.corners.render({
      imageUrl: state.photo?.url ?? null,
      imageWidth: state.photo?.width ?? 0,
      imageHeight: state.photo?.height ?? 0,
      corners: state.corners,
      cornersValid: state.corners ? isConvex(state.corners) : true,
      detecting: state.detecting,
      detectionFailed: false,
    });

    ui.confirmScan.render({
      resultUrl: state.resultUrl,
      processing: state.processing,
    });

    ui.scans.render({
      scans: state.scans.map((s) => ({ id: s.id, thumbUrl: s.url })),
    });

    const scan = state.scans[state.viewerIndex] ?? null;
    ui.viewer.render({
      scan: scan && { id: scan.id, url: scan.url },
      index: state.viewerIndex,
      total: state.scans.length,
    });

    ui.exportSheet.render({
      open: state.exportOpen,
      format: state.format,
      count: state.scans.length,
      exporting: state.exporting,
    });
  }

  const set = (patch) => {
    Object.assign(state, patch);
    render();
  };

  const intents = {
    // Camera
    capture() {
      set({ capturing: true });
      setTimeout(() => {
        set({
          capturing: false,
          screen: 'corners',
          photo: { url: drawScene(true), width: PHOTO_W, height: PHOTO_H },
          corners: null,
          detecting: true,
          rotation: 0,
        });
        setTimeout(() => {
          const detected = SAMPLE_CORNERS.map((p) => ({ ...p }));
          set({ detecting: false, detectedCorners: detected, corners: detected.map((p) => ({ ...p })) });
        }, 700);
      }, 150);
    },
    openScans: () => set({ screen: 'scans' }),
    retryCamera: () => {},

    // Corners
    retake: () => set({ screen: 'camera', photo: null, corners: null, resultUrl: null }),
    cornersChanged: ({ corners }) => set({ corners }),
    resetCorners: () => set({ corners: state.detectedCorners.map((p) => ({ ...p })) }),
    confirmCorners() {
      set({ screen: 'confirm', processing: true, resultUrl: null });
      setTimeout(() => set({ processing: false, resultUrl: drawPage(state.rotation) }), 500);
    },

    // Confirm
    adjustCorners: () => set({ screen: 'corners' }),
    rotate() {
      const rotation = (state.rotation + 90) % 360;
      set({ rotation, resultUrl: drawPage(rotation) });
    },
    save() {
      state.scans.push({ id: String(nextId++), rotation: state.rotation, url: state.resultUrl });
      set({ screen: 'camera', photo: null, corners: null, resultUrl: null });
      ui.toast(`Saved · ${state.scans.length} ${state.scans.length === 1 ? 'scan' : 'scans'}`);
    },

    // Scans
    backToCamera: () => set({ screen: 'camera' }),
    openScan: ({ id }) => set({ screen: 'viewer', viewerIndex: state.scans.findIndex((s) => s.id === id) }),
    openExport: () => set({ exportOpen: true }),

    // Viewer
    closeViewer: () => set({ screen: 'scans' }),
    prevScan: () => set({ viewerIndex: Math.max(0, state.viewerIndex - 1) }),
    nextScan: () => set({ viewerIndex: Math.min(state.scans.length - 1, state.viewerIndex + 1) }),
    rotateScan({ id }) {
      const scan = state.scans.find((s) => s.id === id);
      scan.rotation = (scan.rotation + 90) % 360;
      scan.url = drawPage(scan.rotation);
      render();
    },
    deleteScan({ id }) {
      const scans = state.scans.filter((s) => s.id !== id);
      const screen = scans.length ? 'viewer' : 'scans';
      set({ scans, screen, viewerIndex: Math.min(state.viewerIndex, scans.length - 1) });
      ui.toast('Scan deleted');
    },

    // Export
    closeExport: () => set({ exportOpen: false }),
    selectFormat: ({ format }) => set({ format }),
    export() {
      set({ exporting: true });
      setTimeout(() => {
        set({ exporting: false, exportOpen: false });
        ui.toast('Preview only — exporting is not connected yet');
      }, 900);
    },
  };

  ui.setIntentHandler((name, payload) => {
    const fn = intents[name];
    if (fn) fn(payload);
    else console.warn(`[preview] unhandled intent: ${name}`, payload);
  });

  render();
}

// ---------- Placeholder drawings ----------

function showBanner() {
  const el = document.createElement('div');
  el.className = 'preview-banner';
  el.textContent = 'UI preview · sample data';
  document.body.append(el);
}

/** A photo of a sheet of paper on a desk, seen at an angle. */
function drawScene(withPaper) {
  const c = document.createElement('canvas');
  c.width = PHOTO_W;
  c.height = PHOTO_H;
  const g = c.getContext('2d');

  const desk = g.createLinearGradient(0, 0, PHOTO_W, PHOTO_H);
  desk.addColorStop(0, '#5a4231');
  desk.addColorStop(1, '#2e2018');
  g.fillStyle = desk;
  g.fillRect(0, 0, PHOTO_W, PHOTO_H);
  g.strokeStyle = 'rgba(0,0,0,0.12)';
  g.lineWidth = 3;
  for (let y = 40; y < PHOTO_H; y += 70) {
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(PHOTO_W * 0.3, y + 20, PHOTO_W * 0.6, y - 20, PHOTO_W, y + 10);
    g.stroke();
  }
  if (!withPaper) return c.toDataURL('image/jpeg', 0.8);

  const [tl, tr, br, bl] = SAMPLE_CORNERS;
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.5)';
  g.shadowBlur = 30;
  g.shadowOffsetY = 12;
  g.fillStyle = '#f3f1ec';
  g.beginPath();
  g.moveTo(tl.x, tl.y);
  g.lineTo(tr.x, tr.y);
  g.lineTo(br.x, br.y);
  g.lineTo(bl.x, bl.y);
  g.closePath();
  g.fill();
  g.restore();

  // "Text" lines following the paper's perspective.
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const at = (u, v) => lerp(lerp(tl, tr, u), lerp(bl, br, u), v);
  g.lineCap = 'round';
  g.strokeStyle = '#2b2b2b';
  g.lineWidth = 9;
  let p = at(0.1, 0.09), q = at(0.6, 0.09);
  g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke();
  g.strokeStyle = '#8a8a8a';
  g.lineWidth = 4;
  for (let v = 0.18; v < 0.92; v += 0.045) {
    const end = 0.9 - ((v * 37) % 0.25);
    p = at(0.1, v);
    q = at(end, v);
    g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke();
  }
  return c.toDataURL('image/jpeg', 0.85);
}

/** A flat, straightened page, rotated by `rotation` degrees. */
function drawPage(rotation) {
  const w = 850;
  const h = 1100;
  const page = document.createElement('canvas');
  page.width = w;
  page.height = h;
  const g = page.getContext('2d');
  g.fillStyle = '#f7f6f2';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#2b2b2b';
  g.fillRect(85, 90, 420, 26);
  g.fillStyle = '#8a8a8a';
  for (let y = 180, i = 0; y < h - 90; y += 46, i++) {
    const len = 680 - ((i * 97) % 220);
    g.fillRect(85, y, len, 10);
  }

  const turned = rotation % 180 !== 0;
  const out = document.createElement('canvas');
  out.width = turned ? h : w;
  out.height = turned ? w : h;
  const o = out.getContext('2d');
  o.translate(out.width / 2, out.height / 2);
  o.rotate((rotation * Math.PI) / 180);
  o.drawImage(page, -w / 2, -h / 2);
  return out.toDataURL('image/jpeg', 0.85);
}

function isConvex(points) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = points[i];
    const b = points[(i + 1) % 4];
    const c = points[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-6) return false;
    const s = Math.sign(cross);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}
