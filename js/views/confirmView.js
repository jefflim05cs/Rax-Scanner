// Confirm screen: shows the straightened scan before it is saved.
//
// State consumed by render():
//   {
//     resultUrl: string|null,
//     processing: boolean,   // straightening / rotating in progress
//     saving: boolean,
//   }
//
// Intents emitted: 'adjustCorners', 'retake', 'rotate', 'save'

import { icons } from './icons.js';
import { qs, delegateActions, setSrc, setText } from './dom.js';

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
        <p data-ref="busyText">Straightening…</p>
      </div>
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
  const rotateBtn = qs(root, '[data-action="rotate"]');
  const saveBtn = qs(root, '[data-action="save"]');

  delegateActions(root, onIntent);

  return {
    render(state) {
      setSrc(img, state.resultUrl);
      img.hidden = !state.resultUrl;
      const working = !!state.processing || !!state.saving;
      busy.hidden = !working;
      setText(busyText, state.saving ? 'Saving…' : 'Straightening…');
      rotateBtn.disabled = working || !state.resultUrl;
      saveBtn.disabled = working || !state.resultUrl;
    },
  };
}
