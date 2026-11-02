// Export sheet: slides up over the Scans screen to pick JPG or PNG, then export.
//
// State consumed by render():
//   {
//     open: boolean,
//     format: 'jpg' | 'png',
//     count: number,
//     exporting: boolean,
//   }
//
// Intents emitted: 'closeExport', 'selectFormat' { format }, 'export'

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

        <p class="sheet__note">
          The share menu will open. Choose <strong>Save Images</strong> to add them to Photos.
        </p>

        <div class="sheet__actions">
          <button class="btn btn--primary btn--block" data-action="export">
            <span class="spinner spinner--s" data-ref="spinner" hidden></span>
            ${icons.share}<span data-ref="exportLabel">Export</span>
          </button>
          <button class="btn btn--block" data-action="closeExport">Cancel</button>
        </div>
      </div>
    </div>
  `;

  const sheet = qs(root, '.sheet');
  const subtitle = qs(root, '[data-ref="subtitle"]');
  const options = qsa(root, '.format-option');
  const exportBtn = qs(root, '[data-action="export"]');
  const exportLabel = qs(root, '[data-ref="exportLabel"]');
  const spinner = qs(root, '[data-ref="spinner"]');
  const exportIcon = exportBtn.querySelector('svg');
  const cancelBtns = qsa(root, '[data-action="closeExport"]');

  delegateActions(root, (action, payload) => {
    if (action === 'closeExport' && exportBtn.disabled) return; // can't dismiss mid-export
    onIntent(action, payload);
  });

  return {
    render(state) {
      sheet.hidden = !state.open;
      if (!state.open) return;

      const count = state.count ?? 0;
      const exporting = !!state.exporting;
      setText(subtitle, count === 1 ? '1 scan from this session' : `${count} scans from this session`);

      for (const opt of options) {
        const selected = opt.dataset.format === state.format;
        opt.classList.toggle('is-selected', selected);
        opt.setAttribute('aria-checked', String(selected));
        opt.disabled = exporting;
      }

      exportBtn.disabled = exporting || count === 0;
      spinner.hidden = !exporting;
      exportIcon.style.display = exporting ? 'none' : '';
      setText(exportLabel, exporting ? 'Preparing…' : `Export as ${state.format === 'png' ? 'PNG' : 'JPG'}`);
      for (const b of cancelBtns) if (b.tagName === 'BUTTON') b.disabled = exporting;
    },
  };
}
