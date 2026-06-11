// tests/preset-loader.test.js
// The load-menu selection model (#138): pure local staging backed by the
// library, idempotent seed, no device I/O.

jest.mock('../src/logger.js', () => ({ log: jest.fn() }));

import {
  isLoadMenuActive,
  hasLibrary,
  bankOptions,
  programsForBank,
  getSelection,
  selectBank,
  selectProgram,
  ensureInitialized,
  selectionTarget,
  resetPresetLoader,
} from '../src/preset-loader.js';
import { setLibrary } from '../src/library.js';
import { appState } from '../src/state.js';

const lib = {
  syncedAt: 'test',
  banks: [
    {
      idx: '0',
      name: '0 Favorites',
      programs: [
        { idx: '0', name: '0 Techno Rumble' },
        { idx: '1', name: '1 Black Hole' },
      ],
    },
    { idx: '50', name: '50 Reverbs', programs: [{ idx: '12', name: '12 Black Hole' }] },
  ],
};

describe('preset-loader', () => {
  beforeEach(() => {
    resetPresetLoader();
    setLibrary(lib);
    appState.currentKey = '10020010'; // KEY.FAVORITES
  });

  test('isLoadMenuActive on PROGRAM / FAVORITES only', () => {
    expect(isLoadMenuActive()).toBe(true);
    appState.currentKey = '10020000'; // KEY.PROGRAM
    expect(isLoadMenuActive()).toBe(true);
    appState.currentKey = '401000b'; // a preset
    expect(isLoadMenuActive()).toBe(false);
  });

  test('hasLibrary reflects the synced library', () => {
    expect(hasLibrary()).toBe(true);
    setLibrary(null);
    expect(hasLibrary()).toBe(false);
  });

  test('bankOptions / programsForBank come from the library', () => {
    expect(bankOptions()).toEqual([
      { index: '0', desc: '0 Favorites' },
      { index: '50', desc: '50 Reverbs' },
    ]);
    expect(programsForBank(50)).toEqual([{ index: '12', desc: '12 Black Hole' }]);
  });

  test('selectBank stages the bank and resets the program to its first', () => {
    selectBank(50);
    expect(getSelection()).toEqual({ bankIdx: 50, programIdx: 12 });
    selectProgram(0); // (no-op-ish; 50 has only idx 12, but the model just stores)
    expect(getSelection().programIdx).toBe(0);
  });

  test('ensureInitialized seeds once, then is authoritative', () => {
    ensureInitialized(50, 12);
    expect(getSelection()).toEqual({ bankIdx: 50, programIdx: 12 });
    // A later seed (e.g. a stale device dump landing) must NOT overwrite.
    ensureInitialized(0, 0);
    expect(getSelection()).toEqual({ bankIdx: 50, programIdx: 12 });
  });

  test('a user pick wins over a subsequent device seed', () => {
    selectBank(0);
    selectProgram(1);
    ensureInitialized(50, 12); // device dump arrives late
    expect(getSelection()).toEqual({ bankIdx: 0, programIdx: 1 });
  });

  test('selectionTarget resolves names, null for an unknown selection', () => {
    selectBank(0);
    selectProgram(1);
    expect(selectionTarget()).toEqual({
      bankIdx: '0',
      programIdx: '1',
      programName: '1 Black Hole',
    });
    selectProgram(99); // not in bank 0
    expect(selectionTarget()).toBeNull();
  });

  test('resetPresetLoader clears the seed flag and selection', () => {
    selectBank(50);
    resetPresetLoader();
    expect(getSelection()).toEqual({ bankIdx: 0, programIdx: 0 });
    ensureInitialized(0, 1); // seeds again after reset
    expect(getSelection()).toEqual({ bankIdx: 0, programIdx: 1 });
  });
});
