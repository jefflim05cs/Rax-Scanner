// Minimal state container: holds one plain object and notifies listeners when it changes.

export function createState(initial) {
  let state = { ...initial };
  const listeners = new Set();
  let scheduled = false;

  const notify = () => {
    scheduled = false;
    for (const fn of listeners) fn(state);
  };

  return {
    get() {
      return state;
    },

    /** Merges `patch` into the state. Several set() calls in a row notify listeners once. */
    set(patch) {
      state = { ...state, ...patch };
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(notify);
      }
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
