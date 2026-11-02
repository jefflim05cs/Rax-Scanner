// Confirm screen: shows the straightened scan before it is saved, with a choice
// of filter.
//
// State consumed by render():
//   {
//     resultUrl: string|null,
//     filter: 'enhanced' | 'bw' | 'original',
//     processing: boolean,   // straightening, filtering or rotating in progress
//     saving: boolean,
//   }
//
// Intents emitted: 'adjustCorners', 'retake', 'rotate', 'save', 'selectFilter' { filter }

import { icons } from './icons.js';
import { qs, qsa, delegateActions, setSrc, setText } from './dom.js';

const FILTERS = [
  ['enhanced', 'Enhanced'],
  ['bw', 'B&W'],
  ['original', 'Original'],
];

export function createConfirmView(root, { onIntent }) {
  root.innerHTML = `
    <header class="topbar">
      <div class="topbar__left">
        <button class="link-btn" data-action="adjustCorners">${icons.chevronLeft}Corners</button>
      </div>
      <h1 class="topbar__title">Check scan</h1>
      <div class="topbar__right"></div>
    </header>

    <div class="preview">
      <img class="preview__img" alt="Scanned document">
      <div class="busy-overlay" data-ref="busy" hidden>
        <div class="spinner"></div>
        <p data-ref="busyText"></p>
      </div>
    </div>

    <div class="filter-bar" role="radiogroup" aria-label="Filter">
      ${FILTERS.map(([id, label]) => `
        <button class="filter-option" role="radio" data-action="selectFilter" data-filter="${id}">${label}</button>`).join('')}
    </div>

    <footer class="bottombar">
      <div class="toolrow">
        <button class="tool-btn" data-action="retake">${icons.retake}<span>Retake</span></button>
        <button class="tool-btn" data-action="rotate">${icons.rotate}<span>Rotate</span></button>
      </div>
      <button class="btn btn--primary" data-action="save">${icons.check}Save</button>
    </footer>
  `;

  const img = qs(root, '.preview__img');
  const busy = qs(root, '[data-ref="busy"]');
  const busyText = qs(root, '[data-ref="busyText"]');
  const filterBtns = qsa(root, '.filter-option');
  const rotateBtn = qs(root, '[data-action="rotate"]');
  const saveBtn = qs(root, '[data-action="save"]');

  delegateActions(root, onIntent);

  return {
    render(state) {
      setSrc(img, state.resultUrl);
      img.hidden = !state.resultUrl;
      const working = !!state.processing || !!state.saving;
      busy.hidden = !working;
      setText(busyText, state.saving ? 'Saving…' : 'Processing…');

      for (const btn of filterBtns) {
        const selected = btn.dataset.filter === state.filter;
        btn.classList.toggle('is-selected', selected);
        btn.setAttribute('aria-checked', String(selected));
        btn.disabled = !!state.saving;
      }
      rotateBtn.disabled = working || !state.resultUrl;
      saveBtn.disabled = working || !state.resultUrl;
    },
  };
}
