// Camera screen: live preview, shutter button, saved-scans shortcut.
//
// State consumed by render():
//   {
//     status: 'starting' | 'ready' | 'denied' | 'error',
//     message: string,          // shown when status is 'denied' or 'error'
//     scanCount: number,
//     lastThumbUrl: string|null,
//     capturing: boolean,
//   }
//
// Intents emitted: 'capture', 'openScans', 'retryCamera'

import { icons } from './icons.js';
import { qs, delegateActions, setText, setSrc } from './dom.js';

export function createCameraView(root, { onIntent }) {
  root.classList.add('camera-screen');
  root.innerHTML = `
    <div class="camera">
      <video class="camera__video" playsinline muted autoplay></video>
      <div class="camera__frame" aria-hidden="true">
        <span></span><span></span><span></span><span></span>
      </div>
      <div class="camera__flash" aria-hidden="true"></div>

      <div class="camera__status" data-ref="starting" hidden>
        <div class="spinner"></div>
        <p>Starting camera…</p>
      </div>

      <div class="camera__status" data-ref="problem" hidden>
        <div class="camera__status-icon">${icons.alert}</div>
        <p class="camera__status-title">Camera unavailable</p>
        <p class="camera__status-text" data-ref="message"></p>
        <button class="btn" data-action="retryCamera">Try again</button>
      </div>
    </div>

    <header class="camera__top">
      <span class="camera__brand">Rax Scanner</span>
    </header>

    <footer class="camera__controls">
      <div class="camera__slot">
        <button class="scans-btn" data-action="openScans" aria-label="Saved scans" disabled>
          <img class="scans-btn__img" alt="">
          <span class="scans-btn__empty">${icons.scans}</span>
          <span class="scans-btn__badge" hidden></span>
        </button>
      </div>
      <div class="camera__slot">
        <button class="shutter" data-action="capture" aria-label="Take photo">
          <span class="shutter__inner"></span>
        </button>
      </div>
      <div class="camera__slot"></div>
    </footer>
  `;

  const video = qs(root, '.camera__video');
  const flash = qs(root, '.camera__flash');
  const starting = qs(root, '[data-ref="starting"]');
  const problem = qs(root, '[data-ref="problem"]');
  const message = qs(root, '[data-ref="message"]');
  const shutter = qs(root, '.shutter');
  const scansBtn = qs(root, '.scans-btn');
  const scansImg = qs(root, '.scans-btn__img');
  const scansEmpty = qs(root, '.scans-btn__empty');
  const badge = qs(root, '.scans-btn__badge');

  delegateActions(root, (action, payload) => {
    if (action === 'capture') {
      // Purely visual feedback; the capture itself is handled elsewhere.
      flash.classList.remove('is-on');
      void flash.offsetWidth; // restart the animation
      flash.classList.add('is-on');
    }
    onIntent(action, payload);
  });

  return {
    /** The <video> element the camera stream should be attached to. */
    get videoElement() {
      return video;
    },

    render(state) {
      const status = state.status ?? 'starting';
      starting.hidden = status !== 'starting';
      problem.hidden = status !== 'denied' && status !== 'error';
      video.classList.toggle('is-live', status === 'ready');
      setText(message, state.message ?? '');

      shutter.disabled = status !== 'ready' || !!state.capturing;

      const count = state.scanCount ?? 0;
      scansBtn.disabled = count === 0;
      badge.hidden = count === 0;
      setText(badge, count);
      setSrc(scansImg, state.lastThumbUrl);
      scansImg.hidden = !state.lastThumbUrl;
      scansEmpty.hidden = !!state.lastThumbUrl;
    },
  };
}
