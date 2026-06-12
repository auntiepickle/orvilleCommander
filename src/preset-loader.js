// preset-loader.js
// Single source of truth for the LOAD-MENU dropdowns (#138 redesign).
//
// The program/bank load menu used to reconcile its two dropdowns from five
// competing sources at render time (live dump, optimistic cache, session
// memo, library, a module-state bank index) repainted by several async
// triggers — so the dropdowns "swapped" between intermediate states and
// commits lagged behind device round-trips. This module replaces that with
// one explicit local selection backed by the synced library: picking a
// bank/program is pure LOCAL staging (no device I/O), like scrolling on the
// hardware (manual p.21 — scroll picks, SELECT/<load>/ENT applies). The
// device is touched only when the user hits "load program in A/B"
// (library.js loadProgram). Every async repaint reads this same selection,
// so they are idempotent — nothing swaps.
//
// DOM-free module state (like tree.js/logger.js): the renderer reads it,
// handlers mutate it; it imports only library data + protocol keys.

import { appState } from './state.js';
import { KEY } from './sysex-commands.js';
import { getLibrary, libraryBankOptions, libraryProgramsForBank } from './library.js';

// The user's staged selection (DECIMAL indices). initialized guards the
// one-shot seed from the device's live current bank/program.
let selection = { bankIdx: 0, programIdx: 0 };
let initialized = false;

/** True when the on-screen menu is the program/load menu (#138). */
export function isLoadMenuActive() {
  return appState.currentKey === KEY.PROGRAM || appState.currentKey === KEY.FAVORITES;
}

/**
 * Whether a synced library exists to drive the load menu. A small library
 * is enough to browse/load (canSearch() gates the bigger SEARCH corpus).
 *
 * @returns {boolean}
 */
export function hasLibrary() {
  return getLibrary() != null;
}

/** Bank options for the BANK dropdown (library-sourced, SET-option shape). */
export function bankOptions() {
  return libraryBankOptions();
}

/** Program options for the staged (or given) bank. */
export function programsForBank(bankIdx = selection.bankIdx) {
  return libraryProgramsForBank(bankIdx);
}

/** The staged selection { bankIdx, programIdx } (decimal ints). */
export function getSelection() {
  return { ...selection };
}

/**
 * Stage a bank (decimal). Resets the program to the bank's first entry —
 * the device would show a fresh list. Pure local: no device I/O.
 *
 * @param {number} bankIdx
 */
export function selectBank(bankIdx) {
  const programs = libraryProgramsForBank(bankIdx);
  const firstProgram = programs.length ? parseInt(programs[0].index, 10) : 0;
  selection = { bankIdx, programIdx: firstProgram };
  initialized = true;
}

/**
 * Stage a program (decimal) within the current bank. Pure local.
 *
 * @param {number} programIdx
 */
export function selectProgram(programIdx) {
  selection = { ...selection, programIdx };
  initialized = true;
}

/**
 * One-shot seed from the device's live current bank/program the first time
 * the load menu renders; thereafter the staged selection is authoritative
 * (so async repaints never overwrite the user's pick). Idempotent.
 *
 * @param {number} liveBankIdx
 * @param {number} liveProgramIdx
 */
export function ensureInitialized(liveBankIdx, liveProgramIdx) {
  if (initialized) return;
  selection = {
    bankIdx: isNaN(liveBankIdx) ? 0 : liveBankIdx,
    programIdx: isNaN(liveProgramIdx) ? 0 : liveProgramIdx,
  };
  initialized = true;
}

/**
 * The staged selection with the display names, for loadProgram(). null
 * when the staged bank/program is not in the library.
 *
 * @returns {{bankIdx: string, programIdx: string, programName: string}|null}
 */
export function selectionTarget() {
  const bank = getLibrary()?.banks.find((b) => parseInt(b.idx, 10) === selection.bankIdx);
  if (!bank) return null;
  const program = bank.programs.find((p) => parseInt(p.idx, 10) === selection.programIdx);
  if (!program) return null;
  return { bankIdx: bank.idx, programIdx: program.idx, programName: program.name };
}

/** Resets staged state — disconnect / Sync-to-Hardware / tests. */
export function resetPresetLoader() {
  selection = { bankIdx: 0, programIdx: 0 };
  initialized = false;
}
