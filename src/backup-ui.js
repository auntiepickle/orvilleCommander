// backup-ui.js
// The Backup & Restore modal (#147) over the DOM-free engine in backup.js.
// Backup reads a dump from the unit and downloads a .syx; restore replays a .syx
// back to the unit. Device I/O lives in backup.js; this file renders + sequences
// and tells the host when it's busy (onBusy) so meter polling can pause — the
// dump saturates the 31250-baud link for minutes.

import { requestBackup, restore, frameFromFile, backupFilename, BACKUP_KINDS } from './backup.js';

let modalEl = null;
let onBusy = null; // injected: (busy:boolean) => void — host pauses polling while true
let busy = false;
let pickedFrame = null; // the dump frame parsed from an uploaded .syx

/** Wires the host hooks once at boot. @param {{onBusy?:(b:boolean)=>void}} cfg */
export function setupBackupUI(cfg) {
  onBusy = cfg?.onBusy || null;
}

function setBusy(b) {
  busy = b;
  onBusy?.(b);
  render();
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** Opens the modal (idempotent). */
export function openBackup() {
  if (!modalEl) {
    modalEl = el('div', 'bk-modal');
    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl && !busy) closeBackup();
    });
    document.body.appendChild(modalEl);
  }
  modalEl.hidden = false;
  render();
}

export function closeBackup() {
  if (busy) return; // never tear down mid-transfer
  if (modalEl) modalEl.hidden = true;
}

/** Closes + clears (disconnect / Sync). */
export function resetBackupUI() {
  busy = false;
  pickedFrame = null;
  if (modalEl) {
    modalEl.remove();
    modalEl = null;
  }
}

let status = { msg: '', kind: '', error: false, bytes: 0, running: false };

function startBackup(kind) {
  if (busy) return;
  setBusy(true);
  status = {
    msg: `Reading ${BACKUP_KINDS[kind].label.toLowerCase()} from the unit…`,
    kind,
    error: false,
    bytes: 0,
    running: true,
  };
  render();
  requestBackup(kind, {
    onProgress: (bytes) => {
      status.bytes = bytes;
      renderStatusOnly();
    },
    onError: (e) => {
      status = { msg: e, kind, error: true, bytes: status.bytes, running: false };
      setBusy(false);
    },
    onDone: (r) => {
      download(r.frame, backupFilename(kind, new Date().toISOString().slice(0, 19)));
      status = {
        msg: r.checksumOk
          ? `Saved ${(r.frame.length / 1024).toFixed(0)} KB. Checksum OK.`
          : `Saved ${(r.frame.length / 1024).toFixed(0)} KB — WARNING: checksum FAILED, the backup may be corrupt.`,
        kind,
        error: !r.checksumOk,
        bytes: r.frame.length,
        running: false,
      };
      setBusy(false);
    },
  });
}

function startRestore() {
  if (busy || !pickedFrame) return;
  const kind = Object.keys(BACKUP_KINDS).find((k) => BACKUP_KINDS[k].dump === pickedFrame[4]);
  const spec = kind ? BACKUP_KINDS[kind] : null;
  const what = spec ? spec.label.toLowerCase() : 'this data';
  const warn = spec?.replaces
    ? `This will REPLACE ${what} on the unit, overwriting what's there now. This cannot be undone. Continue?`
    : `Load ${what} onto the unit? Continue?`;
  if (!window.confirm(warn)) return;
  setBusy(true);
  status = {
    msg: `Restoring ${what} to the unit…`,
    kind: kind || '',
    error: false,
    bytes: 0,
    running: true,
  };
  render();
  restore(pickedFrame, {
    onError: (e) => {
      status = { msg: e, kind: kind || '', error: true, bytes: 0, running: false };
      setBusy(false);
    },
    onDone: () => {
      status = {
        msg: `Restore sent. The unit may take a moment to reload.`,
        kind: kind || '',
        error: false,
        bytes: 0,
        running: false,
      };
      setBusy(false);
    },
  });
}

function download(frame, filename) {
  const blob = new Blob([new Uint8Array(frame)], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = el('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function renderStatusOnly() {
  const s = modalEl?.querySelector('.bk-status');
  if (s)
    s.textContent = status.running
      ? `${status.msg}  (${status.bytes.toLocaleString()} bytes)`
      : status.msg;
  const bar = modalEl?.querySelector('.bk-bar');
  if (bar) bar.classList.toggle('bk-bar-active', status.running);
}

function render() {
  if (!modalEl || modalEl.hidden) return;
  modalEl.innerHTML = '';
  const panel = el('div', 'bk-panel');

  const head = el('div', 'bk-head');
  head.append(el('div', 'bk-title', 'Backup & Restore'));
  const close = el('button', 'bk-close', '✕');
  close.disabled = busy;
  close.addEventListener('click', closeBackup);
  head.append(close);
  panel.append(head);

  // Backup section
  panel.append(el('div', 'bk-section-h', 'Back up'));
  panel.append(
    el(
      'div',
      'bk-note',
      'Reads data from the unit and downloads a .syx file. The full unit and all presets take several minutes — keep the unit connected.'
    )
  );
  const grid = el('div', 'bk-grid');
  for (const [kind, spec] of Object.entries(BACKUP_KINDS)) {
    const b = el('button', 'bk-btn', spec.label);
    b.disabled = busy;
    b.addEventListener('click', () => startBackup(kind));
    grid.append(b);
  }
  panel.append(grid);

  // Restore section
  panel.append(el('div', 'bk-section-h', 'Restore'));
  panel.append(
    el(
      'div',
      'bk-note',
      'Replays a .syx backup to the unit. Full-unit / all-presets restores OVERWRITE the unit and are confirmed first.'
    )
  );
  const restoreRow = el('div', 'bk-restore-row');
  const file = el('input', 'bk-file');
  file.type = 'file';
  file.accept = '.syx';
  file.disabled = busy;
  file.addEventListener('change', async () => {
    pickedFrame = null;
    const f = file.files?.[0];
    if (!f) return render();
    const bytes = new Uint8Array(await f.arrayBuffer());
    pickedFrame = frameFromFile(bytes);
    status = pickedFrame
      ? {
          msg: `Loaded ${f.name} (${pickedFrame.length.toLocaleString()} bytes).`,
          kind: '',
          error: false,
          bytes: 0,
          running: false,
        }
      : {
          msg: `${f.name} is not a valid Eventide .syx backup.`,
          kind: '',
          error: true,
          bytes: 0,
          running: false,
        };
    render();
  });
  const restoreBtn = el('button', 'bk-btn bk-restore-btn', 'Restore to unit');
  restoreBtn.disabled = busy || !pickedFrame;
  restoreBtn.addEventListener('click', startRestore);
  restoreRow.append(file, restoreBtn);
  panel.append(restoreRow);

  // Status + progress
  const bar = el('div', 'bk-bar');
  if (status.running) bar.classList.add('bk-bar-active');
  panel.append(bar);
  const st = el('div', `bk-status${status.error ? ' bk-error' : ''}`);
  st.textContent = status.running
    ? `${status.msg}  (${status.bytes.toLocaleString()} bytes)`
    : status.msg;
  panel.append(st);

  modalEl.append(panel);
}
