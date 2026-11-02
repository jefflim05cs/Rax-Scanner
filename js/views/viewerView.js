// Viewer screen: one saved scan full-screen, with Rotate and Delete.
// Swipe left / right to move between scans.
//
// State consumed by render():
//   {
//     scan: { id: string, url: string } | null,
//     index: number,   // 0-based position of this scan
//     total: number,
//     busy: boolean,   // rotating in progress
//   }
//
// Intents emitted: 'closeViewer', 'prevScan', 'nextScan', 'rotateScan' { id }, 'deleteScan' { id }

import { icons } from './icons.js';
import { qs, setText, setSrc } from './dom.js';

const SWIPE_DISTANCE = 50;

export function createViewerView(root, { onIntent, confirm }) {
  root.innerHTML = `
    <header class="topbar">
      <div class="topbar__left">
        <button class="link-btn" data-action="closeViewer">${icons.chevronLeft}Scans</button>
      </div>
      <h1 class="topbar__title" data-ref="title"></h1>
      <div class="topbar__right"></div>
    </header>

    <div class="viewer">
      <img class="viewer__img" alt="Scanned document">
      <button class="viewer__nav viewer__nav--prev" data-action="prevScan" aria-label="Previous scan">${icons.chevronLeft}</button>
      <button class="viewer__nav viewer__nav--next" data-action="nextScan" aria-label="Next scan">${icons.chevronRight}</button>
      <div class="busy-overlay" data-ref="busy" hidden><div class="spinner"></div></div>
    </div>

    <footer class="bottombar bottombar--center">
      <button class="tool-btn" data-action="rotateScan">${icons.rotate}<span>Rotate</span></button>
      <button class="tool-btn tool-btn--danger" data-action="deleteScan">${icons.trash}<span>Delete</span></button>
    </footer>
  `;

  const title = qs(root, '[data-ref="title"]');
  const viewer = qs(root, '.viewer');
  const img = qs(root, '.viewer__img');
  const busy = qs(root, '[data-ref="busy"]');
  const prevBtn = qs(root, '[data-action="prevScan"]');
  const nextBtn = qs(root, '[data-action="nextScan"]');
  const rotateBtn = qs(root, '[data-action="rotateScan"]');
  const deleteBtn = qs(root, '[data-action="deleteScan"]');

  let currentId = null;

  root.addEventListener('click', async (event) => {
    const el = event.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const action = el.dataset.action;

    if (action === 'deleteScan') {
      const ok = await confirm({
        title: 'Delete this scan?',
        message: "It hasn't been exported yet. This can't be undone.",
        confirmLabel: 'Delete',
        destructive: true,
      });
      if (ok && currentId) onIntent('deleteScan', { id: currentId });
      return;
    }
    if (action === 'rotateScan') {
      if (currentId) onIntent('rotateScan', { id: currentId });
      return;
    }
    onIntent(action, {});
  });

  // Swipe between scans.
  let swipe = null;
  viewer.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    swipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  viewer.addEventListener('pointerup', (e) => {
    if (!swipe || e.pointerId !== swipe.id) return;
    const dx = e.clientX - swipe.x;
    const dy = e.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0 && !nextBtn.hidden) onIntent('nextScan', {});
    if (dx > 0 && !prevBtn.hidden) onIntent('prevScan', {});
  });
  viewer.addEventListener('pointercancel', () => { swipe = null; });
  viewer.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  return {
    render(state) {
      const scan = state.scan;
      currentId = scan?.id ?? null;
      setSrc(img, scan?.url);

      const total = state.total ?? 0;
      const index = state.index ?? 0;
      setText(title, total ? `${index + 1} of ${total}` : '');
      prevBtn.hidden = index <= 0;
      nextBtn.hidden = index >= total - 1;

      busy.hidden = !state.busy;
      rotateBtn.disabled = !scan || !!state.busy;
      deleteBtn.disabled = !scan || !!state.busy;
    },
  };
}
