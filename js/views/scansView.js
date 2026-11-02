// Saved scans screen: grid of everything scanned this session, plus Export.
//
// State consumed by render():
//   {
//     scans: [{ id: string, thumbUrl: string }],
//   }
//
// Intents emitted: 'backToCamera', 'openScan' { id }, 'openExport'

import { icons } from './icons.js';
import { qs, delegateActions, setText } from './dom.js';

export function createScansView(root, { onIntent }) {
  root.innerHTML = `
    <header class="topbar">
      <div class="topbar__left">
        <button class="link-btn" data-action="backToCamera">${icons.chevronLeft}Camera</button>
      </div>
      <h1 class="topbar__title" data-ref="title">Scans</h1>
      <div class="topbar__right"></div>
    </header>

    <div class="scans">
      <ol class="scans__grid"></ol>
      <div class="scans__empty" hidden>
        ${icons.document}
        <p>No scans yet</p>
        <button class="btn" data-action="backToCamera">Scan a document</button>
      </div>
    </div>

    <footer class="bottombar">
      <button class="btn btn--primary btn--block" data-action="openExport">${icons.share}<span data-ref="exportLabel">Export</span></button>
    </footer>
  `;

  const title = qs(root, '[data-ref="title"]');
  const grid = qs(root, '.scans__grid');
  const empty = qs(root, '.scans__empty');
  const exportBtn = qs(root, '[data-action="openExport"]');
  const exportLabel = qs(root, '[data-ref="exportLabel"]');

  // Remembered so the grid is only rebuilt when the list actually changes.
  let signature = '';

  delegateActions(root, onIntent);

  return {
    render(state) {
      const scans = state.scans ?? [];
      const count = scans.length;

      setText(title, count ? `Scans (${count})` : 'Scans');
      setText(exportLabel, count === 1 ? 'Export 1 scan' : `Export ${count} scans`);
      exportBtn.disabled = count === 0;
      empty.hidden = count > 0;

      const next = scans.map((s) => `${s.id}|${s.thumbUrl}`).join(',');
      if (next === signature) return;
      signature = next;

      grid.replaceChildren(...scans.map((scan, i) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.className = 'scan-tile';
        btn.dataset.action = 'openScan';
        btn.dataset.id = scan.id;
        btn.setAttribute('aria-label', `Scan ${i + 1}`);

        const img = document.createElement('img');
        img.className = 'scan-tile__img';
        img.alt = '';
        img.src = scan.thumbUrl;

        const num = document.createElement('span');
        num.className = 'scan-tile__num';
        num.textContent = String(i + 1);

        btn.append(img, num);
        li.append(btn);
        return li;
      }));
    },
  };
}
