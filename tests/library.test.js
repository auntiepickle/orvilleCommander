// tests/library.test.js
// Pins the preset library (#142): search semantics, the serialized bank
// scan (memo-driven arrival detection, cancel, original-bank restore),
// and the search-hit load sequence.

jest.mock('../src/midi.js', () => ({
  sendValuePut: jest.fn(),
  sendObjectInfoDump: jest.fn(),
  sendValueDump: jest.fn(),
  isOutputConnected: jest.fn(() => true),
}));

jest.mock('../src/logger.js', () => ({
  log: jest.fn(),
}));

jest.mock('../src/tree.js', () => ({
  getNode: jest.fn(),
  bankProgramsFor: jest.fn(),
}));

jest.mock('../src/constants.js', () => {
  const actual = jest.requireActual('../src/constants.js');
  return {
    ...actual,
    // Millisecond-scale waits so the serialized scan runs in test time.
    LIBRARY: { ...actual.LIBRARY, BANK_SETTLE_MS: 1, BANK_DUMP_TIMEOUT_MS: 50, LOAD_SETTLE_MS: 1 },
  };
});

import {
  setLibrary,
  getLibrary,
  searchLibrary,
  syncLibrary,
  loadSearchHit,
  canSearch,
  libraryProgramCount,
} from '../src/library.js';
import { sendValuePut, sendObjectInfoDump } from '../src/midi.js';
import { getNode, bankProgramsFor } from '../src/tree.js';
import { appState } from '../src/state.js';

// Padded so the corpus clears LIBRARY.SEARCH_MIN_PROGRAMS (search gating).
const filler = (n) => Array.from({ length: n }, (_, i) => ({ idx: `${i}`, name: `${i} Filler` }));
const sampleLibrary = {
  syncedAt: 'test',
  banks: [
    {
      idx: '0',
      name: '0 Favorites',
      programs: [
        { idx: '0', name: '0 Techno Rumble' },
        { idx: '1', name: '1 Black Hole' },
        ...filler(40),
      ],
    },
    {
      idx: '50',
      name: '50 Reverbs - Unusual',
      programs: [{ idx: '12', name: '12 Black Hole' }],
    },
  ],
};

describe('library search', () => {
  beforeEach(() => setLibrary(sampleLibrary));

  test('case-insensitive substring search across all banks', () => {
    const hits = searchLibrary('black hole');
    expect(hits).toHaveLength(2);
    expect(hits[0]).toEqual({
      bankIdx: '0',
      bankName: '0 Favorites',
      programIdx: '1',
      programName: '1 Black Hole',
    });
    expect(hits[1].bankIdx).toBe('50');
  });

  test('empty query returns nothing', () => {
    expect(searchLibrary('   ')).toEqual([]);
  });

  test('search is gated on a minimum corpus (#142 follow-up)', () => {
    setLibrary({
      syncedAt: 'test',
      banks: [{ idx: '0', name: '0 Tiny', programs: [{ idx: '0', name: '0 Black Hole' }] }],
    });
    expect(libraryProgramCount()).toBe(1);
    expect(canSearch()).toBe(false);
    expect(searchLibrary('black hole')).toEqual([]); // below the minimum
    setLibrary(sampleLibrary);
    expect(canSearch()).toBe(true);
  });
});

describe('syncLibrary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLibrary(null);
  });

  const loadMenuNode = [
    { type: 'COL', key: '10020010' },
    {
      type: 'SET',
      key: '10020012',
      value: '0 0 Favorites', // originally on bank 0
      options: [
        { index: '0', desc: '0 Favorites' },
        { index: '1', desc: '1 A Taste' },
      ],
    },
  ];

  test('scans every bank via the memo and restores the original bank', async () => {
    getNode.mockReturnValue(loadMenuNode);
    // Bank 0 already memoized (no fetch needed); bank 1 memoizes after
    // the scan requests it.
    const memos = {
      0: { options: [{ index: '0', desc: '0 Techno Rumble' }], value: '0' },
    };
    bankProgramsFor.mockImplementation((idx) => memos[idx]);
    setTimeout(() => {
      memos[1] = { options: [{ index: '0', desc: '0 Delaytaps' }], value: '0' };
    }, 5);

    const progress = jest.fn();
    const library = await syncLibrary(progress);

    expect(library.banks.map((b) => b.name)).toEqual(['0 Favorites', '1 A Taste']);
    expect(library.banks[1].programs).toEqual([{ idx: '0', name: '0 Delaytaps' }]);
    // Bank 0 was memoized — no PUT for it; bank 1 was selected; the
    // original bank (0) was restored at the end.
    const puts = sendValuePut.mock.calls.map((c) => c.join(':'));
    expect(puts).toContain('10020012:1');
    expect(puts[puts.length - 1]).toBe('10020012:0'); // restore
    expect(sendObjectInfoDump).toHaveBeenCalledWith('10020010');
    // Structured progress: the bank-map defrag state for the dialog.
    const lastScan = progress.mock.calls
      .map((c) => c[0])
      .filter((p) => p.phase === 'scanning')
      .pop();
    expect(lastScan).toMatchObject({ done: 2, total: 2 });
    expect(lastScan.bankStates).toEqual(['captured', 'captured']);
    expect(getLibrary()).toBe(library);
  });

  test('returns null without a load-menu dump', async () => {
    getNode.mockReturnValue(undefined);
    expect(await syncLibrary()).toBeNull();
  });

  test('a partial scan MERGES over the existing library, never replaces it (review)', async () => {
    setLibrary(sampleLibrary); // a previous full sync, incl. bank 50
    getNode.mockReturnValue(loadMenuNode);
    const memos = {
      0: { options: [{ index: '0', desc: '0 Fresh Favorites' }], value: '0' },
      1: { options: [{ index: '0', desc: '0 Delaytaps' }], value: '0' },
    };
    bankProgramsFor.mockImplementation((idx) => memos[idx]);

    const library = await syncLibrary();
    // Banks 0 and 1 refreshed; bank 50 (not in this scan's bank list)
    // survives from the previous sync.
    expect(library.banks.map((b) => b.idx)).toEqual(['0', '1', '50']);
    expect(library.banks[0].programs[0].name).toBe('0 Fresh Favorites');
    expect(library.banks[2].programs[0].name).toBe('12 Black Hole');
  });

  test('the original bank restore uses the value token as HEX (review radix pin)', async () => {
    // Originally on bank 50: the dump's value token is hex '32'; the
    // restore PUT must be decimal '50' (the device parses puts decimal).
    getNode.mockReturnValue([
      { type: 'COL', key: '10020010' },
      {
        type: 'SET',
        key: '10020012',
        value: '32 50 Reverbs - Unusual',
        options: [{ index: '0', desc: '0 Favorites' }],
      },
    ]);
    bankProgramsFor.mockReturnValue({ options: [{ index: '0', desc: '0 X' }], value: '0' });
    await syncLibrary();
    const puts = sendValuePut.mock.calls.map((c) => c.join(':'));
    expect(puts[puts.length - 1]).toBe('10020012:50');
  });
});

describe('loadSearchHit', () => {
  test('puts bank, program, then the active-DSP load trigger', async () => {
    jest.clearAllMocks();
    appState.presetKey = '401000b'; // DSP A active
    const done = jest.fn();
    await loadSearchHit({ bankIdx: '50', programIdx: '12', programName: '12 Black Hole' }, done);
    expect(sendValuePut.mock.calls.map((c) => c.join(':'))).toEqual([
      '10020012:50',
      '10020011:12',
      '1002001c:1', // LOAD_TRIGGER_A
    ]);
    expect(done).toHaveBeenCalled();
  });
});
