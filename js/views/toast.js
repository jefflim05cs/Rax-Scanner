// Short, self-dismissing message shown above the bottom controls.

const DURATION_MS = 2200;

export function createToast(root) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.hidden = true;
  root.append(el);
  let timer = null;

  return function show(message) {
    el.textContent = message;
    el.hidden = false;
    el.classList.remove('is-on');
    void el.offsetWidth; // restart the animation
    el.classList.add('is-on');
    clearTimeout(timer);
    timer = setTimeout(() => {
      el.classList.remove('is-on');
      el.hidden = true;
    }, DURATION_MS);
  };
}
