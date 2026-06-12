// tests/preset-browser.test.js
// The preset browser (#153) + preview (#135): render (browse/search/empty),
// the remember-and-restore preview safety, no-auto-preview, the live
// Favorites re-fetch, and reset. Device I/O is mocked at the library.js
// boundary — this pins the panel's sequencing, not the wire.

const mockLoadProgramToDsp = jest.fn((target, slot, onDone) => {
  onDone?.();
  return Promise.resolve();
});
const mockRefreshFavoritesBank = jest.fn((onDone) => {
  onDone?.();
  return Promise.resolve();
});
const mockGetRememberedProgram = jest.fn();
let mockLibrary = null;
let mockCanSearch = true;
let mockHits = [];

jest.mock('../src/library.js', () => ({
  getLibrary: () => mockLibrary,
  searchLibrary: () => mockHits,
  canSearch: () => mockCanSearch,
  libraryProgramCount: () => (mockLibrary ? 99 : 0),
  loadProgramToDsp: (...a) => mockLoadProgramToDsp(...a),
  getRememberedProgram: (...a) => mockGetRememberedProgram(...a),
  isFavoritesBank: (idx) => parseInt(idx, 10) === 0,
  refreshFavoritesBank: (...a) => mockRefreshFavoritesBank(...a),
}));

jest.mock('../src/logger.js', () => ({ log: jest.fn() }));

import {
  setupPresetBrowser,
  openPresetBrowser,
  resetPresetBrowser,
  renderBrowser,
} from '../src/preset-browser.js';
import { appState } from '../src/state.js';

const sampleLibrary = {
  syncedAt: 'test',
  banks: [
    {
      idx: '0',
      name: '0 Favorites',
      programs: [{ idx: '0', name: '0 Recently Used' }],
    },
    {
      idx: '5',
      name: '5 Delays',
      programs: [
        { idx: '0', name: '0 Mono Delay' },
        { idx: '1', name: '1 PingPong' },
      ],
    },
  ],
};

const q = (sel) => document.querySelector(sel);
const qa = (sel) => [...document.querySelectorAll(sel)];
const rowByName = (name) =>
  qa('.pb-prog').find((li) => li.querySelector('.pb-prog-name').textContent.includes(name));

describe('preset-browser', () => {
  let onLoadComplete;

  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '';
    resetPresetBrowser();
    mockLibrary = sampleLibrary;
    mockCanSearch = true;
    mockHits = [];
    appState.presetKey = '401000b'; // DSP A active -> preview auditions on B
    appState.dspAName = '';
    appState.dspBName = '';
    onLoadComplete = jest.fn();
    setupPresetBrowser({ onLoadComplete });
  });

  test('renders bank list + programs, defaulting to the first STATIC bank', () => {
    openPresetBrowser();
    // Both banks listed; Favorites flagged live.
    expect(qa('.pb-bank').map((b) => b.textContent.replace('live', '').trim())).toEqual([
      '0 Favorites',
      '5 Delays',
    ]);
    expect(q('.pb-bank-live')).toBeTruthy();
    // Default selection skipped Favorites (the live bank) -> bank 5's programs.
    expect(qa('.pb-prog-name').map((n) => n.textContent)).toEqual(['0 Mono Delay', '1 PingPong']);
  });

  test('unsynced shows a sync prompt, no panes', () => {
    mockLibrary = null;
    openPresetBrowser();
    expect(q('.pb-unsynced')).toBeTruthy();
    expect(q('.pb-banks')).toBeNull();
  });

  test('search filters to hits across banks; gated when the corpus is small', () => {
    openPresetBrowser();
    mockHits = [{ bankIdx: '5', bankName: '5 Delays', programIdx: '1', programName: '1 PingPong' }];
    const search = q('.pb-search');
    search.value = 'ping';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(qa('.pb-prog-name').map((n) => n.textContent)).toEqual(['5 Delays › 1 PingPong']);

    // Below the search threshold: a sync-first note, no rows.
    mockCanSearch = false;
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(q('.pb-empty').textContent).toMatch(/sync the library first/i);
  });

  test('selecting a bank or program never loads (no auto-preview)', () => {
    openPresetBrowser();
    q('.pb-bank').click(); // select Favorites
    expect(mockLoadProgramToDsp).not.toHaveBeenCalled();
  });

  test('Preview captures the restore point, then auditions on the idle DSP (B)', () => {
    mockGetRememberedProgram.mockReturnValue({
      bankIdx: '5',
      programIdx: '0',
      programName: '0 Mono Delay',
    });
    openPresetBrowser();
    rowByName('1 PingPong').querySelector('.pb-preview').click();

    // Restore captured for the idle slot (B) BEFORE the load.
    expect(mockGetRememberedProgram).toHaveBeenCalledWith('B');
    // Loaded onto B (the non-active engine).
    expect(mockLoadProgramToDsp).toHaveBeenCalledWith(
      expect.objectContaining({ programIdx: '1', programName: '1 PingPong' }),
      'B',
      expect.any(Function)
    );
    // Banner reflects the live preview with Keep + Cancel.
    expect(q('.pb-banner-live').textContent).toMatch(/Previewing.*1 PingPong.*DSP B/);
    expect(q('.pb-keep')).toBeTruthy();
    expect(q('.pb-cancel')).toBeTruthy();
  });

  test('Cancel restores the remembered program into the same slot', () => {
    const restore = { bankIdx: '5', programIdx: '0', programName: '0 Mono Delay' };
    mockGetRememberedProgram.mockReturnValue(restore);
    openPresetBrowser();
    rowByName('1 PingPong').querySelector('.pb-preview').click();
    mockLoadProgramToDsp.mockClear();

    q('.pb-cancel').click();
    expect(mockLoadProgramToDsp).toHaveBeenCalledWith(restore, 'B', expect.any(Function));
    // Banner cleared back to idle.
    expect(q('.pb-banner-live')).toBeNull();
  });

  test('Keep leaves the preview in place — no further device load', () => {
    mockGetRememberedProgram.mockReturnValue({ bankIdx: '5', programIdx: '0', programName: '0 X' });
    openPresetBrowser();
    rowByName('1 PingPong').querySelector('.pb-preview').click();
    mockLoadProgramToDsp.mockClear();

    q('.pb-keep').click();
    expect(mockLoadProgramToDsp).not.toHaveBeenCalled();
    expect(q('.pb-banner-live')).toBeNull();
  });

  test('with no restore point, Cancel is replaced by a note', () => {
    mockGetRememberedProgram.mockReturnValue(null);
    openPresetBrowser();
    rowByName('1 PingPong').querySelector('.pb-preview').click();
    expect(q('.pb-cancel')).toBeNull();
    expect(q('.pb-banner-note').textContent).toMatch(/no saved state for DSP B/i);
  });

  test('selecting the live Favorites bank re-fetches it from the device', () => {
    openPresetBrowser();
    q('.pb-bank-live').click();
    expect(mockRefreshFavoritesBank).toHaveBeenCalled();
  });

  test('load-to-A / load-to-B target the explicit slot', () => {
    openPresetBrowser();
    rowByName('0 Mono Delay').querySelector('.pb-load-b').click();
    expect(mockLoadProgramToDsp).toHaveBeenCalledWith(
      expect.objectContaining({ programIdx: '0' }),
      'B',
      expect.any(Function)
    );
  });

  test('resetPresetBrowser hides the panel and clears preview state', () => {
    mockGetRememberedProgram.mockReturnValue({ bankIdx: '5', programIdx: '0', programName: '0 X' });
    openPresetBrowser();
    rowByName('1 PingPong').querySelector('.pb-preview').click();
    expect(q('.pb-banner-live')).toBeTruthy();

    resetPresetBrowser();
    expect(q('.preset-browser')).toBeNull(); // removed, not just hidden
    // Reopening shows no stale preview banner.
    openPresetBrowser();
    expect(q('.pb-banner-live')).toBeNull();
  });

  test('renderBrowser is a no-op while the panel is closed', () => {
    renderBrowser(); // never opened
    expect(q('.preset-browser')).toBeNull();
  });
});
