// sync-dialog.js
// The library-sync progress dialog (#142 follow-up): a blocking overlay
// drawn ON the LCD — a SIBLING of #lcd inside the bezel, UNDER the glass
// pane, so it refracts like real phosphor and never touches the
// renderer-owned #lcd subtree. Pure presentation fed by syncLibrary's
// onProgress; the scan already locks out LCD interaction (renderer
// isSyncing guards), so this makes that lockout legible.
//
// The centerpiece is a defrag-style bank map: one cell per bank, lighting
// in phosphor as each is captured (current pulses, dropped = x), plus a
// character-cell progress bar, the current bank name, and a rolling ETA.

import { LAYOUT } from './constants.js';

const BAR_CELLS = LAYOUT.LCD_COLUMNS - 8; // progress bar width inside the glass margin

let el = null; // the overlay element (created lazily, reused)

function ensureEl() {
  if (el) return el;
  const bezel = document.querySelector('.bezel');
  if (!bezel) return null;
  el = document.createElement('div');
  el.className = 'sync-dialog';
  el.hidden = true;
  // Inserted before .glass so the glass paints over it.
  const glass = bezel.querySelector('.glass');
  bezel.insertBefore(el, glass || null);
  return el;
}

function mmss(ms) {
  if (ms == null || !isFinite(ms)) return '--:--';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// The defrag bank map as rows of cells. captured = lit block, current =
// inverse, skipped = x, pending = dim. cellsPerRow keeps the grid inside
// the 40-column LCD.
function renderBankMap(bankStates) {
  const cellsPerRow = 24;
  const rows = [];
  for (let i = 0; i < bankStates.length; i += cellsPerRow) {
    const slice = bankStates.slice(i, i + cellsPerRow);
    rows.push(
      slice
        .map((st) => {
          if (st === 'captured') return '<span class="cell cell-on">█</span>';
          if (st === 'current') return '<span class="cell cell-cur">█</span>';
          if (st === 'skipped') return '<span class="cell cell-skip">x</span>';
          return '<span class="cell cell-pending">░</span>';
        })
        .join('')
    );
  }
  return rows.join('\n');
}

/**
 * Shows / updates the dialog from a syncLibrary progress payload.
 *
 * @param {{phase: string, done: number, total: number, name: string,
 *   bankStates: string[], etaMs: number|null}} p
 * @param {() => void} onCancel
 */
export function showSyncProgress(p, onCancel) {
  const node = ensureEl();
  if (!node) return;
  node.hidden = false;

  if (p.phase === 'preparing') {
    node.innerHTML =
      '<div class="sync-title">LIBRARY SYNC</div>' +
      '<div class="sync-line">reading bank list ...</div>';
    return;
  }

  const filled = p.total ? Math.round((p.done / p.total) * BAR_CELLS) : 0;
  const bar = '█'.repeat(filled) + '░'.repeat(BAR_CELLS - filled);
  const restoring = p.phase === 'restoring';
  node.innerHTML =
    '<div class="sync-title">LIBRARY SYNC</div>' +
    `<div class="sync-bar">${bar} <span class="sync-count">${p.done}/${p.total}</span></div>` +
    `<div class="sync-line">${restoring ? 'restoring your bank ...' : `<span class="sync-cur">&gt;</span> ${escapeText(p.name)}`}</div>` +
    `<div class="sync-map">${renderBankMap(p.bankStates)}</div>` +
    `<div class="sync-foot"><span class="sync-eta">${restoring ? '' : `est. ${mmss(p.etaMs)} remaining`}</span>` +
    '<button type="button" class="sync-cancel">CANCEL</button></div>';
  const cancelBtn = node.querySelector('.sync-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', onCancel, { once: true });
}

/**
 * Final beat: holds on a completion summary, then dismisses.
 *
 * @param {{banks: number, programs: number}} summary
 */
export function showSyncComplete(summary) {
  const node = ensureEl();
  if (!node) return;
  node.hidden = false;
  node.innerHTML =
    '<div class="sync-title">SYNC COMPLETE</div>' +
    `<div class="sync-line sync-done">${summary.programs} programs &middot; ${summary.banks} banks</div>`;
}

/** Removes the dialog. */
export function hideSyncDialog() {
  if (el) el.hidden = true;
}

// #lcd content is device text; the only interpolations here are bank
// names — escape them, matching the renderer's own caution.
function escapeText(s) {
  const div = document.createElement('div');
  div.textContent = String(s ?? '');
  return div.innerHTML;
}
