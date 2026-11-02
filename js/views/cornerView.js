// Corner adjustment screen: the captured photo with 4 draggable corner handles
// and a magnifier that appears while dragging.
//
// Corners are always expressed in the photo's own pixel coordinates, ordered
// top-left, top-right, bottom-right, bottom-left. This view only converts them
// to and from screen coordinates for display; it does not validate them.
//
// State consumed by render():
//   {
//     imageUrl: string|null,
//     imageWidth: number,
//     imageHeight: number,
//     corners: [{x, y}, {x, y}, {x, y}, {x, y}] | null,
//     cornersValid: boolean,    // false → outline shown in warning colour, Next disabled
//     detecting: boolean,       // edge detection in progress
//     detectionFailed: boolean, // couldn't find the document automatically
//   }
//
// Intents emitted:
//   'retake'
//   'cornersChanged' { corners }   (after each drag ends)
//   'resetCorners'
//   'confirmCorners'

import { icons } from './icons.js';
import { qs, qsa, delegateActions } from './dom.js';

const LOUPE_SIZE = 116;  // CSS px
const LOUPE_ZOOM = 2.5;  // relative to the on-screen photo
const STAGE_PADDING = 28; // keeps handles at the photo's edge reachable

export function createCornerView(root, { onIntent }) {
  root.innerHTML = `
    <header class="topbar">
      <div class="topbar__left">
        <button class="link-btn" data-action="retake">${icons.chevronLeft}Retake</button>
      </div>
      <h1 class="topbar__title">Adjust corners</h1>
      <div class="topbar__right"></div>
    </header>

    <div class="editor">
      <div class="editor__stage">
        <img class="editor__img" alt="Captured photo">
        <svg class="editor__overlay" preserveAspectRatio="none" aria-hidden="true">
          <path class="editor__shade" fill-rule="evenodd"></path>
          <polygon class="editor__outline"></polygon>
        </svg>
        ${[0, 1, 2, 3].map((i) => `
          <div class="handle" data-index="${i}" role="slider" aria-label="${['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left'][i]} corner">
            <span class="handle__dot"></span>
          </div>`).join('')}
      </div>

      <div class="loupe" hidden>
        <canvas class="loupe__canvas"></canvas>
        <span class="loupe__cross" aria-hidden="true"></span>
      </div>

      <div class="busy-overlay" data-ref="detecting" hidden>
        <div class="spinner"></div>
        <p>Finding document edges…</p>
      </div>
    </div>

    <p class="editor__hint" data-ref="hint"></p>

    <footer class="bottombar">
      <button class="tool-btn" data-action="resetCorners">${icons.reset}<span>Reset</span></button>
      <button class="btn btn--primary" data-action="confirmCorners">Next${icons.chevronRight}</button>
    </footer>
  `;

  const editor = qs(root, '.editor');
  const stage = qs(root, '.editor__stage');
  const img = qs(root, '.editor__img');
  const overlay = qs(root, '.editor__overlay');
  const shade = qs(root, '.editor__shade');
  const outline = qs(root, '.editor__outline');
  const handles = qsa(root, '.handle');
  const loupe = qs(root, '.loupe');
  const loupeCanvas = qs(root, '.loupe__canvas');
  const loupeCtx = loupeCanvas.getContext('2d');
  const detectingEl = qs(root, '[data-ref="detecting"]');
  const hint = qs(root, '[data-ref="hint"]');
  const nextBtn = qs(root, '[data-action="confirmCorners"]');
  const resetBtn = qs(root, '[data-action="resetCorners"]');

  let imageUrl = null;
  let imgW = 0;
  let imgH = 0;
  let scale = 1;     // screen px per photo px
  let corners = null; // local copy, photo px
  let drag = null;   // { index, pointerId, startX, startY, origin }

  delegateActions(root, onIntent);

  // ---------- Layout ----------

  function layout() {
    if (!imgW || !imgH) return;
    const box = editor.getBoundingClientRect();
    const availW = box.width - STAGE_PADDING * 2;
    const availH = box.height - STAGE_PADDING * 2;
    if (availW <= 0 || availH <= 0) return;

    scale = Math.min(availW / imgW, availH / imgH);
    const w = Math.round(imgW * scale);
    const h = Math.round(imgH * scale);
    stage.style.width = `${w}px`;
    stage.style.height = `${h}px`;
    overlay.setAttribute('viewBox', `0 0 ${w} ${h}`);
    draw();
  }

  new ResizeObserver(layout).observe(editor);

  function draw() {
    const hasCorners = !!corners && scale > 0;
    for (const h of handles) h.hidden = !hasCorners;
    outline.style.display = hasCorners ? '' : 'none';
    shade.style.display = hasCorners ? '' : 'none';
    if (!hasCorners) return;

    const w = imgW * scale;
    const h = imgH * scale;
    const pts = corners.map((p) => ({ x: p.x * scale, y: p.y * scale }));
    const poly = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

    outline.setAttribute('points', poly);
    shade.setAttribute('d', `M0 0H${w}V${h}H0Z M${pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L')}Z`);
    handles.forEach((el, i) => {
      el.style.transform = `translate(${pts[i].x}px, ${pts[i].y}px)`;
    });
  }

  // ---------- Dragging ----------

  function onPointerDown(event) {
    if (!corners || drag) return;
    const el = event.currentTarget;
    const index = Number(el.dataset.index);
    event.preventDefault();
    el.setPointerCapture(event.pointerId);
    drag = {
      index,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: { ...corners[index] },
    };
    el.classList.add('is-active');
    showLoupe(index);
  }

  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const dx = (event.clientX - drag.startX) / scale;
    const dy = (event.clientY - drag.startY) / scale;
    corners[drag.index] = {
      x: clamp(drag.origin.x + dx, 0, imgW),
      y: clamp(drag.origin.y + dy, 0, imgH),
    };
    draw();
    showLoupe(drag.index);
  }

  function onPointerEnd(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    handles[drag.index].classList.remove('is-active');
    drag = null;
    loupe.hidden = true;
    onIntent('cornersChanged', { corners: corners.map((p) => ({ ...p })) });
  }

  for (const el of handles) {
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerEnd);
    el.addEventListener('pointercancel', onPointerEnd);
  }
  // Stop iOS from scrolling / zooming the page while dragging.
  editor.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  // ---------- Magnifier ----------

  function showLoupe(index) {
    if (!img.complete || !img.naturalWidth) return;
    const dpr = window.devicePixelRatio || 1;
    const size = Math.round(LOUPE_SIZE * dpr);
    if (loupeCanvas.width !== size) {
      loupeCanvas.width = size;
      loupeCanvas.height = size;
    }

    // Region of the photo to magnify, in photo px, centred on the corner.
    const p = corners[index];
    const region = LOUPE_SIZE / (scale * LOUPE_ZOOM);
    const sx = p.x - region / 2;
    const sy = p.y - region / 2;

    loupeCtx.fillStyle = '#000';
    loupeCtx.fillRect(0, 0, size, size);

    // Safari won't draw when the source rectangle leaves the image bounds, so clip it.
    const cx0 = Math.max(0, sx);
    const cy0 = Math.max(0, sy);
    const cx1 = Math.min(img.naturalWidth, sx + region);
    const cy1 = Math.min(img.naturalHeight, sy + region);
    if (cx1 > cx0 && cy1 > cy0) {
      const k = size / region;
      loupeCtx.drawImage(
        img,
        cx0, cy0, cx1 - cx0, cy1 - cy0,
        (cx0 - sx) * k, (cy0 - sy) * k, (cx1 - cx0) * k, (cy1 - cy0) * k,
      );
    }

    // Put the magnifier in the top corner away from the finger.
    const onLeft = p.x < imgW / 2;
    loupe.classList.toggle('loupe--right', onLeft);
    loupe.classList.toggle('loupe--left', !onLeft);
    loupe.hidden = false;
  }

  // ---------- Render ----------

  return {
    render(state) {
      if (state.imageUrl !== imageUrl) {
        imageUrl = state.imageUrl;
        if (imageUrl) img.src = imageUrl;
        else img.removeAttribute('src');
      }
      if (state.imageWidth !== imgW || state.imageHeight !== imgH) {
        imgW = state.imageWidth || 0;
        imgH = state.imageHeight || 0;
        layout();
      }

      // Don't overwrite the corner the user is currently dragging.
      if (!drag) {
        corners = state.corners ? state.corners.map((p) => ({ ...p })) : null;
        draw();
      }

      const detecting = !!state.detecting;
      const valid = state.cornersValid !== false;
      detectingEl.hidden = !detecting;
      overlay.classList.toggle('is-invalid', !valid);
      nextBtn.disabled = detecting || !corners || !valid;
      resetBtn.disabled = detecting || !corners;

      hint.classList.toggle('is-warning', !valid || !!state.detectionFailed);
      if (detecting) hint.textContent = '';
      else if (!valid) hint.textContent = 'The corners cross over. Drag them back into a four-sided shape.';
      else if (state.detectionFailed) hint.textContent = "Couldn't find the document. Drag the corners to its edges.";
      else hint.textContent = 'Drag the corners to the edges of the document.';
    },
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
