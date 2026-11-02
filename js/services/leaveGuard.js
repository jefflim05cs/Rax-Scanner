// Asks the browser to confirm before leaving or reloading while scans haven't
// been exported. Browsers decide whether to show the prompt; iOS Safari often
// skips it (for example when the tab is closed from the tab switcher).

export function createLeaveGuard() {
  let active = false;

  const onBeforeUnload = (event) => {
    event.preventDefault();
    event.returnValue = ''; // required by Safari to show the prompt
    return '';
  };

  return {
    setActive(value) {
      const next = !!value;
      if (next === active) return;
      active = next;
      if (active) window.addEventListener('beforeunload', onBeforeUnload);
      else window.removeEventListener('beforeunload', onBeforeUnload);
    },
  };
}
