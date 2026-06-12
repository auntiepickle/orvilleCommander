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
    LIBRARY: {
      ...actual.LIBRARY,
      BANK_SETTLE_MS: 1,
      BANK_DUMP_TIMEOUT_MS: 50,
      LOAD_SETTLE_MS: 1,
      FAVORITES_REFRESH_MS: 1,
    },
  };
});

import {
  setLibrary,
  getLibrary,
  searchLibrary,
  syncLibrary,
  loadSearchHit,
  loadProgram,
  loadProgramToDsp,
  getRememberedProgram,
  resetLibraryLoadMemory,
  isFavoritesBank,
  refreshFavoritesBank,
  libraryBankOptions,
  libraryProgramsForBank,
  canSearch,
  libraryProgramCount,
} from '../src/library.js';
import { sendValuePut, sendObjectInfoDump, sendValueDump } from '../src/midi.js';
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

describe('library load-menu options (#138)', () => {
  beforeEach(() => setLibrary(sampleLibrary));

  test('libraryBankOptions yields SET-option shape with decimal-string index', () => {
    expect(libraryBankOptions()).toEqual([
      { index: '0', desc: '0 Favorites' },
      { index: '50', desc: '50 Reverbs - Unusual' },
    ]);
  });

  test('libraryProgramsForBank returns the bank programs, or [] for an unknown bank', () => {
    expect(libraryProgramsForBank(50)).toEqual([{ index: '12', desc: '12 Black Hole' }]);
    expect(libraryProgramsForBank(99)).toEqual([]);
  });

  test('options are empty with no library', () => {
    setLibrary(null);
    expect(libraryBankOptions()).toEqual([]);
    expect(libraryProgramsForBank(0)).toEqual([]);
  });
});

describe('loadProgram / loadSearchHit', () => {
  test('puts bank, program, then the active-DSP load trigger + optimistic name', async () => {
    jest.clearAllMocks();
    appState.presetKey = '401000b'; // DSP A active
    appState.dspAName = 'Old';
    const done = jest.fn();
    await loadProgram({ bankIdx: '50', programIdx: '12', programName: '12 Black Hole' }, done);
    // Optimistic top-bar name (index token stripped), applied before the puts.
    expect(appState.dspAName).toBe('Black Hole');
    expect(sendValuePut.mock.calls.map((c) => c.join(':'))).toEqual([
      '10020012:50',
      '10020011:12',
      '1002001c:1', // LOAD_TRIGGER_A
    ]);
    expect(done).toHaveBeenCalled();
  });

  test('targets DSP B when B is the active preset', async () => {
    jest.clearAllMocks();
    appState.presetKey = '801000b'; // DSP B active
    await loadProgram({ bankIdx: '0', programIdx: '0', programName: '0 X' });
    expect(appState.dspBName).toBe('X');
    expect(sendValuePut.mock.calls.map((c) => c.join(':')).pop()).toBe('1002001d:1'); // LOAD_TRIGGER_B
  });

  test('loadSearchHit delegates to loadProgram', async () => {
    jest.clearAllMocks();
    appState.presetKey = '401000b';
    await loadSearchHit({ bankIdx: '50', programIdx: '12', programName: '12 Black Hole' });
    expect(sendValuePut.mock.calls.map((c) => c.join(':'))).toEqual([
      '10020012:50',
      '10020011:12',
      '1002001c:1',
    ]);
  });
});

describe('loadProgramToDsp / preview slot targeting (#135)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetLibraryLoadMemory();
  });

  test('targets the CHOSEN slot regardless of the active DSP', async () => {
    appState.presetKey = '401000b'; // DSP A is active...
    await loadProgramToDsp({ bankIdx: '5', programIdx: '0', programName: '0 Mono Delay' }, 'B');
    // ...but the explicit slot B trigger fires, and B's name updates.
    expect(appState.dspBName).toBe('Mono Delay');
    expect(sendValuePut.mock.calls.map((c) => c.join(':'))).toEqual([
      '10020012:5',
      '10020011:0',
      '1002001d:1', // LOAD_TRIGGER_B, not A
    ]);
  });

  test('the program readback fires before the trigger (clamp-catch)', async () => {
    appState.presetKey = '401000b';
    await loadProgramToDsp({ bankIdx: '0', programIdx: '1', programName: '1 X' }, 'A');
    expect(sendValueDump).toHaveBeenCalledWith('10020011');
  });
});

describe('getRememberedProgram (preview restore, #135)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetLibraryLoadMemory();
    setLibrary(sampleLibrary);
  });

  test('after an app load, returns the EXACT indices that slot now holds', async () => {
    await loadProgramToDsp({ bankIdx: '50', programIdx: '12', programName: '12 Black Hole' }, 'A');
    expect(getRememberedProgram('A')).toEqual({
      bankIdx: '50',
      programIdx: '12',
      programName: '12 Black Hole',
    });
    expect(getRememberedProgram('B')).toBeNull(); // nothing loaded into B
  });

  test('cold start falls back to the running name resolved against the library', () => {
    appState.dspAName = 'Techno Rumble'; // running, never loaded by the app
    // Index-based, not the colliding "Black Hole" — exact program in bank 0.
    expect(getRememberedProgram('A')).toEqual({
      bankIdx: '0',
      programIdx: '0',
      programName: '0 Techno Rumble',
    });
  });

  test('null when the slot was never app-loaded and the running name is unknown', () => {
    appState.dspBName = 'Nonexistent Patch';
    expect(getRememberedProgram('B')).toBeNull();
  });
});

describe('Favorites bank is live (#138/#135 follow-up)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('isFavoritesBank only matches bank 0', () => {
    expect(isFavoritesBank(0)).toBe(true);
    expect(isFavoritesBank('0')).toBe(true);
    expect(isFavoritesBank(50)).toBe(false);
  });

  test('refreshFavoritesBank selects bank 0 and re-dumps the load menu', async () => {
    const done = jest.fn();
    await refreshFavoritesBank(done);
    expect(sendValuePut).toHaveBeenCalledWith('10020012', '0'); // select bank 0
    expect(sendObjectInfoDump).toHaveBeenCalledWith('10020010'); // re-fetch live
    expect(sendValueDump).toHaveBeenCalledWith('10020010');
    expect(done).toHaveBeenCalled();
  });
});
