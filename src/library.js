// library.js
// The preset library (#142): a user-triggered full sync over every bank,
// and name search across the result. The device only exposes ONE bank's
// program list at a time, so global search needs this scan — serialized
// like the eager loader (one bank in flight), restoring the originally
// selected bank when done. The library persists in midiConfig (the
// maintainer's freshness model: banks/programs change rarely; re-sync is
// explicit), so search works across sessions without re-scanning.
//
// Library shape: { syncedAt, banks: [{ idx, name, programs: [{ idx,
// name }] }] } — idx is the SET option index (decimal string, the PUT
// wire shape), name is the option desc as listed.

import { appState } from './state.js';
import { sendValuePut, sendObjectInfoDump, sendValueDump } from './midi.js';
import { KEY, KEY_PREFIX } from './sysex-commands.js';
import { LIBRARY } from './constants.js';
import { getNode, bankProgramsFor } from './tree.js';
import { on } from './events.js';
import { log } from './logger.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The current library: hydrated from persisted config at boot
// (setLibrary), replaced by a completed sync.
let library = null;

/** @returns {{syncedAt: string, banks: Object[]}|null} */
export function getLibrary() {
  return library;
}

/** Hydrates the library from persisted config (boot). */
export function setLibrary(persisted) {
  if (persisted?.banks?.length) library = persisted;
}

/**
 * Case-insensitive substring search over every synced program name.
 *
 * @param {string} query
 * @returns {Array<{bankIdx: string, bankName: string, programIdx: string, programName: string}>}
 */
export function searchLibrary(query) {
  const q = query.trim().toLowerCase();
  if (!q || !library) return [];
  const hits = [];
  for (const bank of library.banks) {
    for (const program of bank.programs) {
      if (program.name.toLowerCase().includes(q)) {
        hits.push({
          bankIdx: bank.idx,
          bankName: bank.name,
          programIdx: program.idx,
          programName: program.name,
        });
        if (hits.length >= LIBRARY.SEARCH_MAX_RESULTS) return hits;
      }
    }
  }
  return hits;
}

let syncing = false;
let cancelRequested = false;

/** Requests cancellation of a running sync (finishes the current bank). */
export function cancelSync() {
  cancelRequested = true;
}

/** @returns {boolean} */
export function isSyncing() {
  return syncing;
}

/**
 * Full library sync: for every bank listed in the load menu's bank SET,
 * select it (PUT), fetch the load-menu dump (which memoizes that bank's
 * program list via tree.js recordDump), and collect the result. Restores
 * the originally selected bank afterward. Serialized — exactly one bank
 * in flight; ~70 banks at the ~4-5s wire floor each is a several-minute
 * scan, hence onProgress for UI.
 *
 * @param {(done: number, total: number, bankName: string) => void} onProgress
 * @returns {Promise<{syncedAt: string, banks: Object[]}|null>} The new
 *   library, or null when no load-menu dump is available / already syncing.
 */
export async function syncLibrary(onProgress) {
  if (syncing) return null;
  const loadMenu = getNode(KEY.FAVORITES);
  const bankSub = loadMenu?.find((s) => s.key === KEY.BANK_SELECT);
  if (!bankSub?.options?.length) {
    log('Library sync: no load-menu dump yet — visit the program page first', 'error', 'error');
    return null;
  }
  syncing = true;
  cancelRequested = false;
  const originalBankIdx = parseInt(String(bankSub.value || '0').split(' ')[0], 16);
  const banks = [];
  // The dump's arrival is observed through the tree memo (#141): the scan
  // waits until bankProgramsFor(idx) materializes for the bank it selected.
  try {
    for (let i = 0; i < bankSub.options.length; i++) {
      if (cancelRequested) break;
      const option = bankSub.options[i];
      const bankIdx = parseInt(option.index, 10);
      onProgress?.(i, bankSub.options.length, option.desc);
      if (!bankProgramsFor(bankIdx)) {
        sendValuePut(KEY.BANK_SELECT, option.index);
        await sleep(LIBRARY.BANK_SETTLE_MS);
        sendObjectInfoDump(KEY.FAVORITES);
        sendValueDump(KEY.FAVORITES);
        const deadline = Date.now() + LIBRARY.BANK_DUMP_TIMEOUT_MS;
        while (!bankProgramsFor(bankIdx) && Date.now() < deadline && !cancelRequested) {
          await sleep(200);
        }
      }
      const memo = bankProgramsFor(bankIdx);
      if (memo) {
        banks.push({
          idx: option.index,
          name: option.desc.trim(),
          programs: memo.options.map((o) => ({ idx: o.index, name: o.desc.trim() })),
        });
      } else if (!cancelRequested) {
        log(`Library sync: no dump for bank ${option.desc} — skipped`, 'error', 'error');
      }
    }
  } finally {
    // Restore the user's bank and refresh the on-screen list.
    sendValuePut(KEY.BANK_SELECT, String(originalBankIdx));
    await sleep(LIBRARY.BANK_SETTLE_MS);
    sendObjectInfoDump(KEY.FAVORITES);
    sendValueDump(KEY.FAVORITES);
    syncing = false;
  }
  if (banks.length === 0) return null;
  library = { syncedAt: new Date().toISOString(), banks };
  return library;
}

/**
 * Loads a search hit into the ACTIVE DSP: bank PUT, program PUT, load
 * trigger — each step settled (the device re-lists between steps).
 *
 * @param {{bankIdx: string, programIdx: string, programName: string}} hit
 * @param {Function} [onDone] - Called after the load trigger fires (the
 *   caller refreshes the screen / root names).
 */
export async function loadSearchHit(hit, onDone) {
  log(`Search load: '${hit.programName}' (bank ${hit.bankIdx})`, 'info', 'general');
  sendValuePut(KEY.BANK_SELECT, hit.bankIdx);
  await sleep(LIBRARY.LOAD_SETTLE_MS);
  sendValuePut(KEY.PROGRAM_SELECT, hit.programIdx);
  await sleep(LIBRARY.LOAD_SETTLE_MS);
  const trigger = appState.presetKey.startsWith(KEY_PREFIX.DSP_A)
    ? KEY.LOAD_TRIGGER_A
    : KEY.LOAD_TRIGGER_B;
  sendValuePut(trigger, '1');
  await sleep(LIBRARY.LOAD_SETTLE_MS);
  onDone?.();
}

// Keep the library's bank entries refreshed from live memo updates: when a
// visit (or the scan) re-records a bank's list, a synced library entry for
// that bank follows it. Registered once at module load; events.js handlers
// live for the session.
on('objectinfo:received', ({ key }) => {
  if (key !== KEY.FAVORITES || !library) return;
  const loadMenu = getNode(KEY.FAVORITES);
  const bankSub = loadMenu?.find((s) => s.key === KEY.BANK_SELECT);
  const bankIdx = parseInt(String(bankSub?.value || '').split(' ')[0], 16);
  if (isNaN(bankIdx)) return;
  const memo = bankProgramsFor(bankIdx);
  const entry = library.banks.find((b) => parseInt(b.idx, 10) === bankIdx);
  if (memo && entry) {
    entry.programs = memo.options.map((o) => ({ idx: o.index, name: o.desc.trim() }));
  }
});
