// Shows exactly one screen at a time. Screens are <section data-screen="name">.

export function createViewManager(appRoot) {
  const screens = new Map();
  for (const el of appRoot.querySelectorAll('[data-screen]')) {
    screens.set(el.dataset.screen, el);
  }

  let current = null;

  return {
    /** Returns the root element for a screen, for the view to build into. */
    root(name) {
      const el = screens.get(name);
      if (!el) throw new Error(`Unknown screen: ${name}`);
      return el;
    },

    /** Shows the named screen and hides every other one. */
    show(name) {
      if (name === current) return;
      if (!screens.has(name)) throw new Error(`Unknown screen: ${name}`);
      for (const [key, el] of screens) el.hidden = key !== name;
      current = name;
    },

    get current() {
      return current;
    },
  };
}
