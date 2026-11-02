// Small DOM helpers shared by the views. No application logic lives here.

export const qs = (root, selector) => root.querySelector(selector);
export const qsa = (root, selector) => Array.from(root.querySelectorAll(selector));

/**
 * Forwards clicks on any element with a `data-action` attribute inside `root`
 * to `onIntent(action, payload)`. The payload is the element's other data-* values.
 */
export function delegateActions(root, onIntent) {
  root.addEventListener('click', (event) => {
    const el = event.target.closest('[data-action]');
    if (!el || !root.contains(el) || el.disabled) return;
    const { action, ...payload } = el.dataset;
    onIntent(action, payload);
  });
}

/** Sets an element's text only when it changed (avoids needless layout work). */
export function setText(el, text) {
  const value = String(text);
  if (el.textContent !== value) el.textContent = value;
}

/** Sets an <img> src only when it changed (avoids flicker on re-render). */
export function setSrc(img, src) {
  if (!src) {
    if (img.hasAttribute('src')) img.removeAttribute('src');
    return;
  }
  if (img.getAttribute('src') !== src) img.setAttribute('src', src);
}
