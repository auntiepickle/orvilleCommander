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
import { setState } from './store.js';
import { sendValuePut, sendObjectInfoDump, sendValueDump, isOutputConnected } from './midi.js';
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

/** Total program count across the synced library (0 when none). */
export function libraryProgramCount() {
  return library ? library.banks.reduce((n, b) => n + b.programs.length, 0) : 0;
}

/** Whether the corpus is large enough to enable search (#142 follow-up). */
export function canSearch() {
  return libraryProgramCount() >= LIBRARY.SEARCH_MIN_PROGRAMS;
}

/**
 * All bank options for the load-menu BANK select, in SET-option shape
 * ({ index, desc }; index is the decimal-string PUT shape). The
 * preset-loader (#138 redesign) renders the bank dropdown from this
 * instead of the slow per-visit device dump. Empty when unsynced.
 *
 * @returns {Array<{index: string, desc: string}>}
 */
export function libraryBankOptions() {
  return library ? library.banks.map((b) => ({ index: b.idx, desc: b.name })) : [];
}

/**
 * The program options for one bank (decimal index), SET-option shape. The
 * device exposes only one bank's list at a time, so this library lookup is
 * what makes bank-hopping instant and race-free (#138). Empty when the bank
 * is not in the library.
 *
 * @param {number} bankIdx
 * @returns {Array<{index: string, desc: string}>}
 */
export function libraryProgramsForBank(bankIdx) {
  const bank = library?.banks.find((b) => parseInt(b.idx, 10) === bankIdx);
  return bank ? bank.programs.map((p) => ({ index: p.idx, desc: p.name })) : [];
}

/** Hydrates the library from persisted config (boot); null clears (tests). */
export function setLibrary(persisted) {
  if (persisted === null) {
    library = null;
    return;
  }
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
  if (!q || !canSearch()) return [];
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
 * @param {(p: {phase: string, done: number, total: number, name: string,
 *   bankStates: string[], etaMs: number|null}) => void} onProgress Structured
 *   progress payload (the dialog reads p.phase/p.bankStates); phase is
 *   'preparing' while the bank list is fetched, then per-bank during the scan.
 * @returns {Promise<{syncedAt: string, banks: Object[]}|null>} The new
 *   library, or null when no load-menu dump is available / already syncing.
 */
export async function syncLibrary(onProgress) {
  if (syncing) return null;
  if (!isOutputConnected()) {
    log('Library sync: no MIDI output connected', 'error', 'error');
    return null;
  }
  syncing = true;
  cancelRequested = false;
  // Sync-from-anywhere (#142 follow-up): the bank list lives in the
  // load-menu dump, which may not be cached if the user never opened the
  // program page. Fetch it ourselves first instead of demanding they
  // navigate there — onProgress emits phase:'preparing' for this phase.
  let loadMenu = getNode(KEY.FAVORITES);
  let bankSub = loadMenu?.find((s) => s.key === KEY.BANK_SELECT);
  if (!bankSub?.options?.length) {
    // Structured payload, like every other emit (the dialog reads
    // p.phase/p.bankStates — the old positional call threw on the
    // sync-from-anywhere path and killed the whole scan silently).
    onProgress?.({ phase: 'preparing', done: 0, total: 0, name: '', bankStates: [], etaMs: null });
    sendObjectInfoDump(KEY.FAVORITES);
    sendValueDump(KEY.FAVORITES);
    const deadline = Date.now() + LIBRARY.BANK_DUMP_TIMEOUT_MS;
    while (Date.now() < deadline && !cancelRequested) {
      await sleep(200);
      loadMenu = getNode(KEY.FAVORITES);
      bankSub = loadMenu?.find((s) => s.key === KEY.BANK_SELECT);
      if (bankSub?.options?.length) break;
    }
  }
  if (!bankSub?.options?.length) {
    log('Library sync: could not load the bank list', 'error', 'error');
    syncing = false;
    return null;
  }
  const originalBankIdx = parseInt(String(bankSub.value || '0').split(' ')[0], 16);
  const banks = [];
  const total = bankSub.options.length;
  // One cell per bank for the dialog's defrag map: 'pending' | 'current'
  // | 'captured' | 'skipped'. emit() reports the whole scan state plus a
  // rolling ETA (mean elapsed per finished bank * banks remaining).
  const bankStates = new Array(total).fill('pending');
  const startedAt = Date.now();
  const emit = (phase, doneCount, name) => {
    const elapsed = Date.now() - startedAt;
    const etaMs = doneCount > 0 ? Math.round((elapsed / doneCount) * (total - doneCount)) : null;
    onProgress?.({ phase, done: doneCount, total, name, bankStates: [...bankStates], etaMs });
  };
  // The dump's arrival is observed through the tree memo (#141): the scan
  // waits until bankProgramsFor(idx) materializes for the bank it selected.
  try {
    for (let i = 0; i < total; i++) {
      if (cancelRequested) break;
      const option = bankSub.options[i];
      const bankIdx = parseInt(option.index, 10);
      bankStates[i] = 'current';
      emit('scanning', i, option.desc);
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
        bankStates[i] = 'captured';
        banks.push({
          idx: option.index,
          name: option.desc.trim(),
          programs: memo.options.map((o) => ({ idx: o.index, name: o.desc.trim() })),
        });
      } else {
        bankStates[i] = 'skipped';
        if (!cancelRequested) {
          log(`Library sync: no dump for bank ${option.desc} — skipped`, 'error', 'error');
        }
      }
      emit('scanning', i + 1, option.desc);
    }
  } finally {
    // Restore the user's bank and refresh the on-screen list.
    emit('restoring', banks.length, '');
    sendValuePut(KEY.BANK_SELECT, String(originalBankIdx));
    await sleep(LIBRARY.BANK_SETTLE_MS);
    sendObjectInfoDump(KEY.FAVORITES);
    sendValueDump(KEY.FAVORITES);
    syncing = false;
  }
  if (banks.length === 0) return null;
  // MERGE over the existing library (review): a cancel at bank 5/70 or a
  // dropped bank must never replace a previous full library with a
  // partial one — fresh entries overlay, everything else is kept.
  const merged = new Map((library?.banks || []).map((b) => [b.idx, b]));
  for (const bank of banks) merged.set(bank.idx, bank);
  library = {
    syncedAt: new Date().toISOString(),
    banks: [...merged.values()].sort((a, b) => parseInt(a.idx, 10) - parseInt(b.idx, 10)),
  };
  return library;
}

// Per-slot memory of the last program THIS APP loaded into each DSP (#135).
// Preview restore needs the EXACT program a slot held before previewing, and
// program names repeat across banks — so we remember indices, not names. Only
// app-initiated loads are tracked (the device's own front-panel loads are not
// observable here); getRememberedProgram falls back to a best-effort name
// lookup when the app has not loaded into a slot this session.
let lastLoadedBySlot = { A: null, B: null };

/** The DSP slot ('A' | 'B') currently active, from the presetKey prefix. */
function activeSlot() {
  return appState.presetKey.startsWith(KEY_PREFIX.DSP_A) ? 'A' : 'B';
}

/** Strips a leading index token ('16 Black Hole' -> 'Black Hole'). */
function stripIndexToken(name) {
  return String(name)
    .trim()
    .replace(/^\d+\s+/, '');
}

/**
 * Loads a bank+program into a CHOSEN DSP slot: bank PUT, program PUT (with a
 * readback), then that slot's load trigger — each step settled (the device
 * re-lists between steps). The single device-touching apply path, shared by
 * search hits, the preset-loader dropdowns (#138), and the preset browser /
 * preview (#135). Optimistically updates that slot's top-bar name so the
 * load feels immediate; the caller's root refetch (onDone) reconciles the
 * real name (~2s, device-bound). Records the load into lastLoadedBySlot so a
 * later preview of the same slot can restore it exactly.
 *
 * @param {{bankIdx: string, programIdx: string, programName: string}} target
 * @param {'A'|'B'} dspSlot - Which engine to load into, regardless of which
 *   is currently active (preview loads the non-active slot).
 * @param {Function} [onDone] - Called after the load trigger fires (the
 *   caller refreshes the screen / root names).
 */
export async function loadProgramToDsp(target, dspSlot, onDone) {
  if (syncing) {
    // The scan owns the bank selection: a load interleaved with it would
    // land in whatever bank the scan happens to be visiting (review). Still
    // fire onDone — a caller holding a UI lock (the browser's withLoadLock)
    // must unlock on this no-op, or its controls stick disabled (review B1).
    log('Load ignored: library sync in progress', 'error', 'error');
    onDone?.();
    return;
  }
  const isA = dspSlot === 'A';
  log(
    `Load: '${target.programName}' (bank ${target.bankIdx}) -> DSP ${dspSlot}`,
    'info',
    'general'
  );
  // Optimistic top-bar name: show the loaded program on the chosen DSP at
  // once; the root refetch in onDone confirms or corrects it.
  if (target.programName) {
    setState(
      { [isA ? 'dspAName' : 'dspBName']: stripIndexToken(target.programName) },
      'library:load-optimistic-name'
    );
  }
  sendValuePut(KEY.BANK_SELECT, target.bankIdx);
  await sleep(LIBRARY.LOAD_SETTLE_MS);
  sendValuePut(KEY.PROGRAM_SELECT, target.programIdx);
  // Readback before the trigger: the device clamps out-of-range puts, so a
  // stale library target would otherwise load a DIFFERENT program silently
  // — the echo lands in currentValues/the log for the eye to catch.
  sendValueDump(KEY.PROGRAM_SELECT);
  await sleep(LIBRARY.LOAD_SETTLE_MS);
  sendValuePut(isA ? KEY.LOAD_TRIGGER_A : KEY.LOAD_TRIGGER_B, '1');
  await sleep(LIBRARY.LOAD_SETTLE_MS);
  // Remember (exact indices) what this slot now holds, for preview restore.
  lastLoadedBySlot[dspSlot] = {
    bankIdx: target.bankIdx,
    programIdx: target.programIdx,
    programName: target.programName,
  };
  onDone?.();
}

/**
 * Loads a bank+program into the ACTIVE DSP — thin caller over
 * loadProgramToDsp for the search hits and load-menu dropdowns, which always
 * target whichever engine is in focus.
 *
 * @param {{bankIdx: string, programIdx: string, programName: string}} target
 * @param {Function} [onDone]
 */
export function loadProgram(target, onDone) {
  return loadProgramToDsp(target, activeSlot(), onDone);
}

/**
 * The exact program to restore into a slot after a preview (#135). Prefers
 * the indices the app last loaded into that slot this session (exact); falls
 * back to a best-effort lookup of the slot's running name against the
 * library (which can mis-resolve a name shared across banks — the caller
 * surfaces this as best-effort). null when neither is available.
 *
 * @param {'A'|'B'} dspSlot
 * @returns {{bankIdx: string, programIdx: string, programName: string}|null}
 */
export function getRememberedProgram(dspSlot) {
  if (lastLoadedBySlot[dspSlot]) return { ...lastLoadedBySlot[dspSlot] };
  if (!library) return null;
  const runningName = stripIndexToken(dspSlot === 'A' ? appState.dspAName : appState.dspBName);
  if (!runningName) return null;
  for (const bank of library.banks) {
    const program = bank.programs.find((p) => stripIndexToken(p.name) === runningName);
    if (program) {
      return { bankIdx: bank.idx, programIdx: program.idx, programName: program.name };
    }
  }
  return null;
}

/** Clears the per-slot load memory (disconnect / Sync — see resetters). */
export function resetLibraryLoadMemory() {
  lastLoadedBySlot = { A: null, B: null };
}

/** True for the live MRU "Favorites" bank (bank 0), which must be live-read. */
export function isFavoritesBank(bankIdx) {
  return parseInt(bankIdx, 10) === LIBRARY.FAVORITES_BANK_IDX;
}

/**
 * Re-reads the live Favorites bank (bank 0) from the device (#138/#135
 * follow-up). Bank 0 is an auto-generated most-recently-used list that
 * reorders on every load, so its static library snapshot goes stale the
 * moment anything is loaded — both the load menu and the preset browser
 * re-fetch it before showing it. Selects bank 0 and dumps it; the
 * objectinfo:received listener below re-records library.banks[0] from the
 * fresh memo. No-op (just callback) while a full sync owns the bank cursor.
 *
 * @param {Function} [onDone] - Called once the fresh dump has settled.
 */
export async function refreshFavoritesBank(onDone) {
  if (syncing) {
    onDone?.();
    return;
  }
  sendValuePut(KEY.BANK_SELECT, String(LIBRARY.FAVORITES_BANK_IDX));
  await sleep(LIBRARY.BANK_SETTLE_MS);
  sendObjectInfoDump(KEY.FAVORITES);
  sendValueDump(KEY.FAVORITES);
  await sleep(LIBRARY.FAVORITES_REFRESH_MS);
  onDone?.();
}

/**
 * Loads a search hit — thin delegate to loadProgram so search and the
 * preset-loader dropdowns share one apply path.
 *
 * @param {{bankIdx: string, programIdx: string, programName: string}} hit
 * @param {Function} [onDone]
 */
export function loadSearchHit(hit, onDone) {
  return loadProgram(hit, onDone);
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
