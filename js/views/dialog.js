// Confirmation dialog in the iOS alert style. Resolves true (confirmed) or false.

import { qs } from './dom.js';

export function createDialog(root) {
  root.innerHTML = `
    <div class="dialog" hidden>
      <div class="dialog__box" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-message">
        <div class="dialog__body">
          <h2 class="dialog__title" id="dialog-title"></h2>
          <p class="dialog__message" id="dialog-message"></p>
        </div>
        <div class="dialog__actions">
          <button class="dialog__btn" data-result="cancel">Cancel</button>
          <button class="dialog__btn dialog__btn--confirm" data-result="confirm"></button>
        </div>
      </div>
    </div>
  `;

  const dialog = qs(root, '.dialog');
  const title = qs(root, '.dialog__title');
  const message = qs(root, '.dialog__message');
  const confirmBtn = qs(root, '[data-result="confirm"]');
  let resolvePending = null;

  root.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-result]');
    if (!btn || !resolvePending) return;
    const resolve = resolvePending;
    resolvePending = null;
    dialog.hidden = true;
    resolve(btn.dataset.result === 'confirm');
  });

  return function confirm({ title: t, message: m = '', confirmLabel = 'OK', destructive = false }) {
    if (resolvePending) resolvePending(false);
    title.textContent = t;
    message.textContent = m;
    message.hidden = !m;
    confirmBtn.textContent = confirmLabel;
    confirmBtn.classList.toggle('is-destructive', destructive);
    dialog.hidden = false;
    return new Promise((resolve) => { resolvePending = resolve; });
  };
}
