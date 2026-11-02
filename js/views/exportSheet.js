// Export sheet: slides up over the Scans screen to pick JPG or PNG, then export.
//
// Exporting takes two taps because iOS only opens the share menu directly from
// a tap: the first tap prepares the files, the second opens the share menu.
//
// State consumed by render():
//   {
//     open: boolean,
//     format: 'jpg' | 'png',
//     count: number,
//     phase: 'idle' | 'preparing' | 'ready' | 'sharing',
//     progress: number,   // files prepared so far (while preparing)
//   }
//
// Intents emitted: 'closeExport', 'selectFormat' { format }, 'export', 'share'

import { icons } from './icons.js';
import { qs, qsa, delegateActions, setText } from './dom.js';

export function createExportSheet(root, { onIntent }) {
  root.innerHTML = `
    <div class="sheet" hidden>
      <div class="sheet__backdrop" data-action="closeExport"></div>
      <div class="sheet__panel" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <div class="sheet__grabber" aria-hidden="true"></div>
        <h2 class="sheet__title" id="export-title">Export scans</h2>
        <p class="sheet__subtitle" data-ref="subtitle"></p>

        <div class="format-picker" role="radiogroup" aria-label="File format">
          <button class="format-option" role="radio" data-action="selectFormat" data-format="jpg">
            <span class="format-option__name">JPG</span>
            <span class="format-option__desc">Smaller files. Best for most documents.</span>
          </button>
          <button class="format-option" role="radio" data-action="selectFormat" data-format="png">
            <span class="format-option__name">PNG</span>
            <span class="format-option__desc">Full quality, no compression. Larger files.</span>
          </button>
        </div>

        <p class="sheet__note" data-ref="note"></p>

        <div class="sheet__actions">
          <button class="btn btn--primary btn--block" data-ref="main">
            <span class="spinner spinner--s" data-ref="spinner" hidden></span>
            <span data-ref="icon">${icons.share}</span><span data-ref="mainLabel"></span>
          </button>
          <button class="btn btn--block" data-action="closeExport" data-ref="cancel">Cancel</button>
        </div>
      </div>
    </div>
  `;

  const sheet = qs(root, '.sheet');
  const subtitle = qs(root, '[data-ref="subtitle"]');
  const note = qs(root, '[data-ref="note"]');
  const options = qsa(root, '.format-option');
  const main = qs(root, '[data-ref="main"]');
  const mainLabel = qs(root, '[data-ref="mainLabel"]');
  const spinner = qs(root, '[data-ref="spinner"]');
  const icon = qs(root, '[data-ref="icon"]');
  const cancel = qs(root, '[data-ref="cancel"]');
  let busy = false;

  delegateActions(root, (action, payload) => {
    if (action === 'closeExport' && busy) return; // can't dismiss mid-export
    onIntent(action, payload);
  });

  return {
    render(state) {
      sheet.hidden = !state.open;
      if (!state.open) return;

      const count = state.count ?? 0;
      const phase = state.phase ?? 'idle';
      const name = state.format === 'png' ? 'PNG' : 'JPG';
      busy = phase === 'preparing' || phase === 'sharing';

      setText(subtitle, count === 1 ? '1 scan from this session' : `${count} scans from this session`);

      for (const opt of options) {
        const selected = opt.dataset.format === state.format;
        opt.classList.toggle('is-selected', selected);
        opt.setAttribute('aria-checked', String(selected));
        opt.disabled = busy;
      }

      main.dataset.action = phase === 'ready' ? 'share' : 'export';
      main.disabled = busy || count === 0;
      spinner.hidden = !busy;
      icon.hidden = busy;
      cancel.disabled = busy;

      if (phase === 'preparing') {
        setText(mainLabel, `Preparing ${Math.min((state.progress ?? 0) + 1, count)} of ${count}…`);
      } else if (phase === 'ready' || phase === 'sharing') {
        setText(mainLabel, 'Save to Photos');
      } else {
        setText(mainLabel, `Export as ${name}`);
      }

      note.innerHTML = phase === 'ready' || phase === 'sharing'
        ? `${count === 1 ? 'Your scan is' : `All ${count} scans are`} ready. In the share menu, choose <strong>Save ${count === 1 ? 'Image' : `${count} Images`}</strong>.`
        : 'The share menu will open. Choose <strong>Save Images</strong> to add them to Photos.';
    },
  };
}
