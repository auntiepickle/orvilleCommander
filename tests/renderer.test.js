import { renderScreen } from '../src/renderer.js';
import { appState } from '../src/state.js';
import {
  sendObjectInfoDump,
  sendValueDump,
  sendValuePut,
  sendSysEx,
  sendKeypress,
} from '../src/midi.js';
import { recordParamMapping, resetParamMappings } from '../src/midi-map.js';
import { showLoading } from '../src/main.js';
import { log as mockLog } from '../src/logger.js';
import { recordDump, reset as treeReset } from '../src/tree.js';
import { setLibrary } from '../src/library.js';
import { resetPresetLoader } from '../src/preset-loader.js';

jest.mock('../src/midi.js', () => ({
  sendObjectInfoDump: jest.fn(),
  sendValueDump: jest.fn(),
  sendValuePut: jest.fn(),
  sendSysEx: jest.fn(),
  sendKeypress: jest.fn(),
}));

jest.mock('../src/controls.js', () => ({
  keypressMasks: { enter: [0xff, 0xff, 0xff, 0xef], ab: [0xfd, 0xff, 0xfd, 0xff] },
}));

jest.mock('../src/main.js', () => ({
  showLoading: jest.fn(),
}));

jest.mock('../src/logger.js', () => ({
  log: jest.fn(),
}));

jest.mock('../src/midi-map-ui.js', () => ({
  openParamMapping: jest.fn(),
}));

import { openParamMapping } from '../src/midi-map-ui.js';

describe('renderer.js', () => {
  let consoleLogSpy;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    appState.currentSubs = [];
    appState.currentValues = {};
    treeReset();
    appState.keyStack = [];
    appState.currentKey = '0';
    appState.presetKey = '401000b';
    appState.pendingDescend = false;
    appState.pendingLanding = null;
    appState.paramOffset = 0;
    appState.dspAName = '';
    appState.dspBName = '';
    appState.lastAscii = '';
    appState.updateBitmapOnChange = true;

    mockLog.mockClear();
    sendObjectInfoDump.mockClear();
    sendValueDump.mockClear();
    sendValuePut.mockClear();
    sendSysEx.mockClear();
    showLoading.mockClear();
    consoleLogSpy.mockClear();

    document.body.innerHTML = '<div id="lcd"></div>';
    resetPresetLoader();
    setLibrary(null); // default: no library -> fallback path (most tests)
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  // ... **UNCHANGED: all prior passing tests** ...

  test('choosing a program HIGHLIGHTS it but never auto-loads (load is the explicit TRG)', () => {
    appState.currentKey = '10020000';
    appState.presetKey = '401000b';
    const subs = [
      {
        type: 'COL',
        position: '0',
        key: '10020000',
        parent: '',
        statement: 'Program',
        tag: 'program',
      },
      {
        type: 'SET',
        position: '1',
        key: '10020011', // KEY.PROGRAM_SELECT
        parent: '10020000',
        statement: '%-20s',
        tag: 'Program',
        options: Array.from({ length: 6 }, (_, i) => ({ index: `${i}`, desc: `Preset${i}` })),
        value: '0 Preset0',
      },
    ];
    renderScreen(subs, '', mockLog);
    const select = document.querySelector('select[data-key="10020011"]');
    select.value = '5';
    jest.useFakeTimers();
    select.dispatchEvent(new Event('change', { bubbles: true }));

    // The selection is put (highlights the slot) and cached in HEX shape.
    expect(sendValuePut).toHaveBeenCalledWith('10020011', '5');
    expect(appState.currentValues['10020011']).toBe('5 Preset5');

    // No loading dim: a program select is instant and confirms with a
    // VALUE dump only, which never fires hideLoading — so showing the dim
    // would strand the screen dimmed forever (regression).
    expect(showLoading).not.toHaveBeenCalled();

    // Run every timer to completion — the load trigger must NEVER fire,
    // and root must not be refetched as a post-load step (maintainer:
    // selecting a program should not apply it).
    jest.runOnlyPendingTimers();
    expect(sendValuePut).not.toHaveBeenCalledWith('1002001c', '1'); // LOAD_TRIGGER_A
    expect(sendValuePut).not.toHaveBeenCalledWith('1002001d', '1'); // LOAD_TRIGGER_B
    // No full-menu refetch either (the "syncing" lag) — only the targeted
    // program-value confirm.
    expect(sendObjectInfoDump).not.toHaveBeenCalled();
    expect(sendValueDump).toHaveBeenCalledWith('10020011');
    jest.useRealTimers();
  });

  test('a bank change fetches ONLY the load menu, not the whole program subtree (#138)', () => {
    appState.currentKey = '10020000';
    const subs = [
      {
        type: 'COL',
        position: '0',
        key: '10020000',
        parent: '10020000',
        statement: 'Program',
        tag: 'program',
      },
      {
        type: 'SET',
        position: '1',
        key: '10020012', // KEY.BANK_SELECT
        parent: '10020010',
        statement: 'Bank: %-20s',
        tag: 'Bank',
        options: [
          { index: '0', desc: '0 Favorites' },
          { index: '50', desc: '50 Reverbs - Unusual' },
        ],
        // Starts on a DIFFERENT bank than the one the test selects, so the
        // mid-transfer repaint assertion below can actually discriminate
        // kept-cache vs old-tree-value (review: with old === chosen the
        // pin was vacuous).
        value: '0 0 Favorites',
      },
    ];
    renderScreen(subs, '', mockLog);
    const select = document.querySelector('select[data-key="10020012"]');
    expect(select).toBeTruthy();

    // Warm-path cache state: a prior visit cached the OLD bank's program
    // value — it must be pruned, or it shadows the fresh dump's value in
    // the render precedence (review blocker).
    appState.currentValues['10020011'] = 'c Old Bank Program';

    jest.useFakeTimers();
    select.value = '50'; // a HIGH index: decimal/hex diverge (the user's failing case)
    select.dispatchEvent(new Event('change', { bubbles: true }));
    // The put sends the DECIMAL index (the device parses puts decimal —
    // probed live, logs/probe-bank-radix.mjs)...
    expect(sendValuePut).toHaveBeenCalledWith('10020012', '50');
    // ...while the optimistic cache holds the device's value shape: HEX
    // index + desc. Caching decimal mis-selected options >= 10 on every
    // repaint until the echo corrected it.
    expect(appState.currentValues['10020012']).toBe('32 50 Reverbs - Unusual');

    jest.advanceTimersByTime(200);
    // Targeted: the load menu's dump + values (it carries both re-listed
    // SETs)...
    expect(sendObjectInfoDump).toHaveBeenCalledWith('10020010');
    expect(sendValueDump).toHaveBeenCalledWith('10020010');
    // ...and NOT the generic full-menu refresh that refetched the whole
    // staled program subtree (13.3s measured live before the fix) —
    // first-arg sweep, so a one-arg regression cannot slip past.
    expect(sendObjectInfoDump.mock.calls.map((c) => c[0])).not.toContain('10020000');
    // The stale program cache entry is pruned so the fresh dump's value
    // renders; the BANK key is KEPT — the user's choice must stay on
    // screen through the ~5s dump transfer (pruning it made the dropdown
    // visibly snap back to the old bank — live-reproduced regression).
    expect(appState.currentValues['10020011']).toBeUndefined();
    expect(appState.currentValues['10020012']).toBe('32 50 Reverbs - Unusual');

    // A mid-transfer repaint from the OLD tree state still shows the
    // user's chosen bank (the optimistic cache shadows the old s.value).
    renderScreen(subs, '', mockLog);
    const repainted = document.querySelector('select[data-key="10020012"]');
    expect(repainted.options[repainted.selectedIndex].text).toBe('50 Reverbs - Unusual');
    jest.useRealTimers();
  });

  // #138: the load menu renders from the library-backed preset-loader (the
  // single source of truth) — picking is pure local staging, instant and
  // race-free. These replace the old #141 memo/optimistic reconciliation.
  const loadMenuDump = (bankValue, programs) => [
    {
      type: 'COL',
      position: '0',
      key: '10020010',
      parent: '10020010',
      statement: 'load new preset',
      tag: 'load',
    },
    {
      type: 'SET',
      position: '1',
      key: '10020012',
      parent: '10020010',
      statement: 'Bank: %-20s',
      tag: 'Bank',
      options: [
        { index: '0', desc: '0 Favorites' },
        { index: '5', desc: '5 Delays' },
        { index: '50', desc: '50 Reverbs - Unusual' },
      ],
      value: bankValue,
    },
    {
      type: 'SET',
      position: '2',
      key: '10020011',
      parent: '10020010',
      statement: '%-20s',
      tag: 'Program',
      options: programs.map((desc, i) => ({ index: `${i}`, desc })),
      value: `0 ${programs[0]}`,
    },
  ];
  const programMenu = [
    {
      type: 'COL',
      position: '0',
      key: '10020000',
      parent: '10020000',
      statement: 'program functions',
      tag: 'program',
    },
    {
      type: 'COL',
      position: '0',
      key: '10020010',
      parent: '10020000',
      statement: 'load new preset',
      tag: 'load',
    },
  ];

  // The synced library used for the load-menu tests below.
  const presetLibrary = {
    syncedAt: 'test',
    banks: [
      {
        idx: '0',
        name: '0 Favorites',
        programs: [
          { idx: '0', name: '0 Techno Rumble' },
          { idx: '1', name: '1 St DistortionTwo' },
        ],
      },
      { idx: '5', name: '5 Delays', programs: [{ idx: '0', name: '0 Mono Delay' }] },
      {
        idx: '50',
        name: '50 Reverbs - Unusual',
        programs: [
          { idx: '10', name: '10 Adaptive Reverb' },
          { idx: '11', name: '11 AlienShift' },
        ],
      },
    ],
  };

  test('load menu renders bank + program dropdowns from the library (#138)', () => {
    setLibrary(presetLibrary);
    appState.currentKey = '10020000';
    recordDump(programMenu);
    recordDump(loadMenuDump('0 0 Favorites', ['0 Techno Rumble', '1 St DistortionTwo']));
    renderScreen(programMenu, '', mockLog);

    const bankSel = document.querySelector('select[data-key="10020012"]');
    const progSel = document.querySelector('select[data-key="10020011"]');
    // ALL banks from the library (not just the device's current one).
    expect([...bankSel.options].map((o) => o.text)).toEqual([
      '0 Favorites',
      '5 Delays',
      '50 Reverbs - Unusual',
    ]);
    // The seeded bank's programs from the library.
    expect([...progSel.options].map((o) => o.text)).toEqual([
      '0 Techno Rumble',
      '1 St DistortionTwo',
    ]);
  });

  test('picking a bank refills the program list from the library, sending NOTHING (#138)', () => {
    setLibrary(presetLibrary);
    appState.currentKey = '10020000';
    recordDump(programMenu);
    recordDump(loadMenuDump('0 0 Favorites', ['0 Techno Rumble', '1 St DistortionTwo']));
    renderScreen(programMenu, '', mockLog);

    const bankSel = document.querySelector('select[data-key="10020012"]');
    bankSel.value = '50'; // a high bank — decimal/hex diverge
    bankSel.dispatchEvent(new Event('change', { bubbles: true }));

    // Synchronous: the program list refilled from the library this tick...
    const progSel = document.querySelector('select[data-key="10020011"]');
    expect([...progSel.options].map((o) => o.text)).toEqual([
      '10 Adaptive Reverb',
      '11 AlienShift',
    ]);
    // ...and the device was NOT touched (pure local staging).
    expect(sendValuePut).not.toHaveBeenCalled();
    expect(sendObjectInfoDump).not.toHaveBeenCalled();
    expect(sendValueDump).not.toHaveBeenCalled();
  });

  test('picking a program is pure local staging — no device traffic (#138)', () => {
    setLibrary(presetLibrary);
    appState.currentKey = '10020000';
    recordDump(programMenu);
    recordDump(loadMenuDump('0 0 Favorites', ['0 Techno Rumble', '1 St DistortionTwo']));
    renderScreen(programMenu, '', mockLog);

    const progSel = document.querySelector('select[data-key="10020011"]');
    progSel.value = '1';
    progSel.dispatchEvent(new Event('change', { bubbles: true }));
    const repainted = document.querySelector('select[data-key="10020011"]');
    expect(repainted.options[repainted.selectedIndex].text).toBe('1 St DistortionTwo');
    expect(sendValuePut).not.toHaveBeenCalled();
  });

  test('async repaints are idempotent — the staged selection never swaps (#138)', () => {
    setLibrary(presetLibrary);
    appState.currentKey = '10020000';
    recordDump(programMenu);
    recordDump(loadMenuDump('0 0 Favorites', ['0 Techno Rumble']));
    renderScreen(programMenu, '', mockLog);

    // Stage bank 50 / program 11.
    const bankSel = document.querySelector('select[data-key="10020012"]');
    bankSel.value = '50';
    bankSel.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('select[data-key="10020011"]').value = '11';
    document
      .querySelector('select[data-key="10020011"]')
      .dispatchEvent(new Event('change', { bubbles: true }));

    // A late device dump for the OLD bank lands and triggers repaints —
    // the staged selection must hold (no swap).
    recordDump(loadMenuDump('0 0 Favorites', ['0 Techno Rumble']));
    renderScreen(programMenu, '', mockLog);
    renderScreen(programMenu, '', mockLog);
    const bank = document.querySelector('select[data-key="10020012"]');
    const prog = document.querySelector('select[data-key="10020011"]');
    expect(bank.options[bank.selectedIndex].text).toBe('50 Reverbs - Unusual');
    expect(prog.options[prog.selectedIndex].text).toBe('11 AlienShift');
  });

  test('unsynced load menu falls back to the current bank + a sync hint (#138)', () => {
    setLibrary(null);
    appState.currentKey = '10020000';
    recordDump(programMenu);
    renderScreen(
      loadMenuDump('5 5 Delays', ['0 Mono Delay', '1 PingPong']).slice(0, 1),
      '',
      mockLog
    );
    appState.currentKey = '10020010'; // render the load menu directly
    renderScreen(loadMenuDump('5 5 Delays', ['0 Mono Delay', '1 PingPong']), '', mockLog);
    // The current bank's programs from the dump, plus the hint.
    const progSel = document.querySelector('select[data-key="10020011"]');
    expect([...progSel.options].map((o) => o.text)).toEqual(['0 Mono Delay', '1 PingPong']);
    expect(document.getElementById('lcd').textContent).toContain('sync to browse all banks');
  });

  test('a DSP preset NUM gets a MIDI badge that opens the mapping card (#146)', () => {
    appState.currentKey = '401000b';
    const subs = [
      {
        type: 'COL',
        position: '0',
        key: '401000b',
        parent: '401000b',
        statement: 'Black Hole',
        tag: '',
      },
      {
        type: 'NUM',
        position: '0',
        key: '4070001', // DSP A preset param
        parent: '401000b',
        statement: 'diff/time : %3.0f %%',
        tag: '',
        value: '50',
      },
      {
        type: 'NUM',
        position: '0',
        key: '4060001',
        parent: '401000b',
        statement: 'size : %3.0f %%',
        tag: '',
        value: '50',
      },
    ];
    renderScreen(subs, '', mockLog);
    const badges = document.querySelectorAll('.lcd-midi-badge');
    expect(badges).toHaveLength(2); // one per modulatable param
    // The badge carries the param's block (parent COL) + key — the bind derives
    // the device keypath from those (midi-map.paramCoords), not a flat row.
    expect(badges[0].dataset.midiBlock).toBe('401000b');
    expect(badges[0].dataset.midiKey).toBe('4070001');
    expect(badges[1].dataset.midiKey).toBe('4060001');

    badges[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openParamMapping).toHaveBeenCalledWith(
      expect.objectContaining({ key: '4060001', block: '401000b' })
    );
  });

  test('non-DSP params (load menu / setup) get NO MIDI badge (#146)', () => {
    appState.currentKey = '10010001';
    const subs = [
      {
        type: 'COL',
        position: '0',
        key: '10010001',
        parent: '10010001',
        statement: 'Input',
        tag: 'input',
      },
      {
        type: 'NUM',
        position: '0',
        key: '10010011', // setup key, not a preset param
        parent: '10010001',
        statement: 'lvl %3.0f',
        tag: '',
        value: '5',
      },
    ];
    renderScreen(subs, '', mockLog);
    expect(document.querySelector('.lcd-midi-badge')).toBeNull();
  });

  // #131: progressive paints during a wave must not destroy an open SET
  // dropdown — repaints park while a select inside #lcd is focused.
  const dropdownGuardSubs = (title) => [
    {
      type: 'COL',
      position: '0',
      key: '10020000',
      parent: '',
      statement: title,
      tag: 'program',
    },
    {
      type: 'SET',
      position: '1',
      key: '10020011',
      parent: '10020000',
      statement: '%-20s',
      tag: 'Program',
      options: [{ index: '0', desc: 'Preset0' }],
      value: '0 Preset0',
    },
  ];

  test('a focused-but-CLOSED dropdown never parks repaints (live bug: frozen program list)', () => {
    // Chrome keeps focus on a select after its popup closes (after picking,
    // after Esc, after a look) — parking on mere focus froze every repaint
    // until a blur that never came (reproduced: logs/probe-bank-focus.mjs).
    appState.currentKey = '10020000';
    renderScreen(dropdownGuardSubs('Program'), '', mockLog);
    const select = document.querySelector('select[data-key="10020011"]');
    select.focus(); // focused, but no mousedown = popup never opened
    expect(document.activeElement).toBe(select);

    renderScreen(dropdownGuardSubs('ProgramRepainted'), '', mockLog);
    expect(document.getElementById('lcd').innerHTML).toContain('ProgramRepainted');
  });

  test('repaint defers while a SET dropdown is OPEN and flushes on blur (#131)', () => {
    jest.useFakeTimers();
    appState.currentKey = '10020000';
    renderScreen(dropdownGuardSubs('Program'), '', mockLog);
    const select = document.querySelector('select[data-key="10020011"]');
    select.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); // popup opens
    select.focus();
    expect(document.activeElement).toBe(select);

    renderScreen(dropdownGuardSubs('ProgramRepainted'), '', mockLog);
    // Deferred: same DOM, the select the user is holding open survives.
    expect(document.querySelector('select[data-key="10020011"]')).toBe(select);
    expect(document.getElementById('lcd').innerHTML).not.toContain('ProgramRepainted');

    // The flush replays one tick after blur (it must not run synchronously
    // inside the blur of a click elsewhere — review SF4).
    select.blur();
    expect(document.getElementById('lcd').innerHTML).not.toContain('ProgramRepainted');
    jest.runOnlyPendingTimers();
    expect(document.getElementById('lcd').innerHTML).toContain('ProgramRepainted');
    jest.useRealTimers();
  });

  test('a change discards the parked repaint instead of replaying it (#131)', () => {
    jest.useFakeTimers();
    appState.currentKey = '10020000';
    renderScreen(dropdownGuardSubs('Program'), '', mockLog);
    const select = document.querySelector('select[data-key="10020011"]');
    select.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); // popup opens
    select.focus();

    renderScreen(dropdownGuardSubs('StaleParkedPaint'), '', mockLog);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    select.blur();
    // The parked paint is stale relative to the change's own refresh flow;
    // the (tick-deferred) blur flush must not replay it — the change
    // discard cleared the slot before the flush fired.
    jest.runOnlyPendingTimers();
    expect(document.getElementById('lcd').innerHTML).not.toContain('StaleParkedPaint');
    jest.useRealTimers();
  });

  // #132: the routing matrix — gang COL subtrees (blank tag, non-'0'
  // position; live-probed structure, logs/probe-routing2-132.log) render
  // INLINE as the hardware's one-page ganged-parameter screen, with the
  // leaves fully editable. Fixture data is the real DSP A i/p routing
  // subtree as probed.
  const gangSet = (key, parent, stmt, value) => ({
    type: 'SET',
    position: '2',
    key,
    parent,
    statement: stmt,
    tag: 'Source',
    value,
    options: [
      { index: '4', desc: 'AES/EBU in 1' },
      { index: '5', desc: 'AES/EBU in 2' },
      { index: '16', desc: '----------' },
    ],
  });
  const gangNum = (key, parent, stmt, value) => ({
    type: 'NUM',
    position: '0',
    key,
    parent,
    statement: stmt,
    tag: 'inlevel',
    value,
    min: '',
    max: '',
  });
  const recordRoutingSubtree = () => {
    const menuSubs = [
      {
        type: 'COL',
        position: '0',
        key: '1001008f',
        parent: '1001008f',
        statement: 'Dsp A i/p routing',
        tag: 'dsp A',
      },
      {
        type: 'COL',
        position: '13',
        key: '1001008c',
        parent: '1001008f',
        statement: 'Source 1-4',
        tag: '',
      },
      {
        type: 'COL',
        position: 'c',
        key: '1001008b',
        parent: '1001008f',
        statement: 'In 1-4',
        tag: '',
      },
    ];
    recordDump(menuSubs);
    recordDump([
      {
        type: 'COL',
        position: '13',
        key: '1001008c',
        parent: '1001008c',
        statement: 'Source 1-4',
        tag: '',
      },
      {
        type: 'COL',
        position: '13',
        key: '1001008d',
        parent: '1001008c',
        statement: 'Source 1/2',
        tag: '',
      },
      {
        type: 'COL',
        position: '13',
        key: '1001008e',
        parent: '1001008c',
        statement: 'Source 3/4',
        tag: '',
      },
    ]);
    recordDump([
      {
        type: 'COL',
        position: '13',
        key: '1001008d',
        parent: '1001008d',
        statement: 'Source 1/2',
        tag: '',
      },
      gangSet('10010081', '1001008d', '%-12s -> IN1', '4 AES/EBU in 1'),
      gangSet('10010082', '1001008d', '%-12s -> IN2', '5 AES/EBU in 2'),
    ]);
    recordDump([
      {
        type: 'COL',
        position: '13',
        key: '1001008e',
        parent: '1001008e',
        statement: 'Source 3/4',
        tag: '',
      },
      gangSet('10010083', '1001008e', '%-12s -> IN3', '10 ----------'),
      gangSet('10010084', '1001008e', '%-12s -> IN4', '10 ----------'),
    ]);
    recordDump([
      {
        type: 'COL',
        position: 'c',
        key: '1001008b',
        parent: '1001008b',
        statement: 'In 1-4',
        tag: '',
      },
      {
        type: 'COL',
        position: 'c',
        key: '10010089',
        parent: '1001008b',
        statement: 'In 1/2',
        tag: '',
      },
      {
        type: 'COL',
        position: 'c',
        key: '1001008a',
        parent: '1001008b',
        statement: 'In 3/4',
        tag: '',
      },
    ]);
    recordDump([
      {
        type: 'COL',
        position: 'c',
        key: '10010089',
        parent: '10010089',
        statement: 'In 1/2',
        tag: '',
      },
      gangNum('10010085', '10010089', 'A IN1 Gain: %2.1f dB', '-6'),
      gangNum('10010086', '10010089', 'A IN2 Gain: %2.1f dB', '-6'),
    ]);
    recordDump([
      {
        type: 'COL',
        position: 'c',
        key: '1001008a',
        parent: '1001008a',
        statement: 'In 3/4',
        tag: '',
      },
      gangNum('10010087', '1001008a', 'A IN3 Gain: %2.1f dB', '-6'),
      gangNum('10010088', '1001008a', 'A IN4 Gain: %2.1f dB', '-6'),
    ]);
    return menuSubs;
  };

  test('gang COL subtrees render inline as the one-page routing matrix (#132)', () => {
    appState.currentKey = '1001008f';
    const menuSubs = recordRoutingSubtree();
    renderScreen(menuSubs, '', mockLog);
    const lcd = document.getElementById('lcd');

    // Group headers render; pair headers are skipped because the leaf
    // statements self-describe ('-> IN1' / 'A IN1 Gain' differ per row).
    expect(lcd.textContent).toContain('Source 1-4');
    expect(lcd.textContent).toContain('In 1-4');
    expect(lcd.textContent).not.toContain('Source 1/2');

    // The whole matrix is on this page and editable: 4 source dropdowns,
    // 4 clickable gain values.
    expect(lcd.querySelectorAll('select[data-key]').length).toBe(4);
    expect(lcd.querySelectorAll('.param-value').length).toBe(4);
    expect(lcd.textContent).toContain('AES/EBU in 1');
    expect(lcd.textContent).toContain('A IN4 Gain');

    // Gang groups are presentation, not navigation: no softkeys for them.
    expect(lcd.querySelector('.softkey[data-key="1001008c"]')).toBeNull();
    expect(lcd.querySelector('.softkey[data-key="1001008b"]')).toBeNull();
  });

  // Shared inline-editor driver: click the value, type, Enter.
  const inlineEdit = (span, text) => {
    span.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const input = document.querySelector('#lcd input.lcd-edit');
    expect(input).toBeTruthy();
    input.value = text;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return input;
  };

  test('gang leaf NUM is editable through the recursive param lookup (#132)', () => {
    jest.useFakeTimers();
    appState.currentKey = '1001008f';
    const menuSubs = recordRoutingSubtree();
    renderScreen(menuSubs, '', mockLog);

    const gain = document.querySelector('.param-value[data-key="10010085"]');
    expect(gain).toBeTruthy();
    inlineEdit(gain, '-3');
    expect(sendValuePut).toHaveBeenCalledWith('10010085', '-3');
    jest.useRealTimers();
  });

  test('gang pair headers render when leaf statements are ambiguous (#132)', () => {
    // The OutSource rows are bare '%12s  (+)' lines — identical statements
    // mean the pair label is the only thing identifying the rows.
    appState.currentKey = '10010090';
    const menuSubs = [
      {
        type: 'COL',
        position: '0',
        key: '10010090',
        parent: '10010090',
        statement: 'Output Routing',
        tag: 'analog',
      },
      {
        type: 'COL',
        position: '13',
        key: '100100b0',
        parent: '10010090',
        statement: 'OutSource 1-4',
        tag: '',
      },
    ];
    recordDump(menuSubs);
    recordDump([
      {
        type: 'COL',
        position: '13',
        key: '100100b0',
        parent: '100100b0',
        statement: 'OutSource 1-4',
        tag: '',
      },
      {
        type: 'COL',
        position: '13',
        key: '100100b1',
        parent: '100100b0',
        statement: 'OutSource 1/2',
        tag: '',
      },
    ]);
    recordDump([
      {
        type: 'COL',
        position: '13',
        key: '100100b1',
        parent: '100100b1',
        statement: 'OutSource 1/2',
        tag: '',
      },
      gangSet('10010091', '100100b1', '%12s  (+)', '10 ----------'),
      gangSet('10010093', '100100b1', '%12s  (+)', '10 ----------'),
    ]);
    renderScreen(menuSubs, '', mockLog);
    const lcd = document.getElementById('lcd');
    expect(lcd.textContent).toContain('OutSource 1-4');
    expect(lcd.textContent).toContain('OutSource 1/2');
    expect(lcd.querySelectorAll('select[data-key]').length).toBe(2);
  });

  test('device labels with < are escaped, not parsed as HTML (live bug: fb<tap)', () => {
    // The multitap delay's feedback label 'fb<tap1' rendered as just 'fb'
    // and its phantom <tap1> tag wrapped every line below, so one hover lit
    // the whole screen.
    appState.currentKey = '8040001';
    const subs = [
      { type: 'COL', position: '0', key: '8040001', parent: '', statement: 'Delay', tag: 'delay' },
      {
        type: 'NUM',
        position: '1',
        key: '8040002',
        parent: '8040001',
        statement: 'fb<tap1: %4.0f',
        tag: 'fb',
        value: '50',
        min: '0',
        max: '100',
      },
      {
        type: 'NUM',
        position: '2',
        key: '8040003',
        parent: '8040001',
        statement: 'fb>tap2: %4.0f',
        tag: 'fb',
        value: '60',
        min: '0',
        max: '100',
      },
    ];
    renderScreen(subs, '', mockLog);
    const lcd = document.getElementById('lcd');
    // The full label survives as text...
    expect(lcd.textContent).toContain('fb<tap1');
    expect(lcd.textContent).toContain('fb>tap2');
    // ...with no phantom <tap1> element, and the escaped entity in the HTML.
    expect(lcd.querySelector('tap1')).toBeNull();
    expect(lcd.innerHTML).toContain('fb&lt;tap1');
    // Both NUM values stay independently clickable (no wrapping bleed).
    expect(lcd.querySelectorAll('.param-value')).toHaveLength(2);
  });

  test('NUM edits inline in the glass — valid commits, invalid flashes, never a browser box', () => {
    appState.currentKey = '10010001';
    const subs = [
      { type: 'COL', position: '0', key: '10010001', parent: '', statement: 'Setup', tag: 'setup' },
      {
        type: 'NUM',
        position: '1',
        key: '10010011',
        parent: '10010001',
        statement: 'Param %3.1f',
        tag: 'Prm',
        value: '50',
        min: '0',
        max: '100',
        step: '1',
      },
    ];
    renderScreen(subs, '', mockLog);
    const paramSpan = document.querySelector('.param-value[data-key="10010011"]');
    expect(paramSpan).toBeTruthy();

    appState.currentSubs = subs; // For handler sub lookup
    jest.useFakeTimers();

    // Out-of-range input flashes invalid IN the field and does not send.
    paramSpan.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const editor = document.querySelector('#lcd input.lcd-edit');
    expect(editor).toBeTruthy();
    expect(editor.value).toBe('50'); // seeded with the current value
    editor.value = '200';
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(sendValuePut).not.toHaveBeenCalled();
    expect(editor.classList.contains('lcd-edit-invalid')).toBe(true);
    expect(editor.isConnected).toBe(true); // stays open for correction

    // Correcting and committing sends the put and repaints.
    editor.value = '75';
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(showLoading).toHaveBeenCalled();
    expect(sendValuePut).toHaveBeenCalledWith('10010011', '75');
    expect(appState.currentValues['10010011']).toBe('75');
    expect(document.querySelector('#lcd input.lcd-edit')).toBeNull(); // editor closed

    // Timeout 200: settled refresh + bitmap
    jest.advanceTimersByTime(200);
    expect(sendSysEx).toHaveBeenCalledWith(0x18, []);
    jest.useRealTimers();
  });

  test('clicking a second value closes the first editor immediately (review)', () => {
    appState.currentKey = '10010001';
    const subs = [
      { type: 'COL', position: '0', key: '10010001', parent: '', statement: 'Setup', tag: 'setup' },
      {
        type: 'NUM',
        position: '1',
        key: '10010011',
        parent: '10010001',
        statement: 'A %3.1f',
        tag: 'A',
        value: '50',
        min: '0',
        max: '100',
      },
      {
        type: 'NUM',
        position: '2',
        key: '10010012',
        parent: '10010001',
        statement: 'B %3.1f',
        tag: 'B',
        value: '10',
        min: '0',
        max: '100',
      },
    ];
    renderScreen(subs, '', mockLog);
    appState.currentSubs = subs;
    jest.useFakeTimers();

    document
      .querySelector('.param-value[data-key="10010011"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const editorA = document.querySelector('#lcd input.lcd-edit');
    expect(editorA.dataset.key).toBe('10010011');

    // Abandoning A for B: A must leave the DOM at once, not strand behind
    // B's #131 guard, and A's detached editor must never commit.
    editorA.blur();
    document
      .querySelector('.param-value[data-key="10010012"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    jest.runOnlyPendingTimers();
    const editors = document.querySelectorAll('#lcd input.lcd-edit');
    expect(editors).toHaveLength(1);
    expect(editors[0].dataset.key).toBe('10010012');

    editorA.value = '99';
    editorA.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(sendValuePut).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  test('Escape cancels the inline editor without sending', () => {
    appState.currentKey = '10010001';
    const subs = [
      { type: 'COL', position: '0', key: '10010001', parent: '', statement: 'Setup', tag: 'setup' },
      {
        type: 'NUM',
        position: '1',
        key: '10010011',
        parent: '10010001',
        statement: 'Param %3.1f',
        tag: 'Prm',
        value: '50',
        min: '0',
        max: '100',
        step: '1',
      },
    ];
    renderScreen(subs, '', mockLog);
    appState.currentSubs = subs;
    jest.useFakeTimers();
    document
      .querySelector('.param-value[data-key="10010011"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const editor = document.querySelector('#lcd input.lcd-edit');
    editor.value = '99';
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    jest.runOnlyPendingTimers(); // the cancel repaint is tick-deferred (SF4)
    expect(sendValuePut).not.toHaveBeenCalled();
    expect(document.querySelector('#lcd input.lcd-edit')).toBeNull();
    expect(document.querySelector('.param-value[data-key="10010011"]')).toBeTruthy();
    jest.useRealTimers();
  });

  test('param click triggers TRG and fetches root if preset load', () => {
    appState.currentKey = '10020000';
    appState.presetKey = '401000b';
    const subs = [
      {
        type: 'COL',
        position: '0',
        key: '10020000',
        parent: '',
        statement: 'Program',
        tag: 'program',
      },
      {
        type: 'TRG',
        position: '1',
        key: '1002001c',
        parent: '10020000',
        statement: 'LOAD A',
      },
    ];
    renderScreen(subs, '', mockLog);
    const paramSpan = document.querySelector('.param-value[data-key="1002001c"]');
    expect(paramSpan).toBeTruthy();

    appState.currentSubs = subs;
    jest.useFakeTimers();
    paramSpan.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Immediate
    expect(showLoading).toHaveBeenCalled();
    expect(sendValuePut).toHaveBeenCalledWith('1002001c', '1');
    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining('Triggered TRG for key 1002001c'),
      'info',
      'general'
    );

    // Timeout 500
    jest.advanceTimersByTime(500);
    expect(sendObjectInfoDump).toHaveBeenCalledWith('0');
    expect(mockLog).toHaveBeenCalledWith('Fetched root after preset load.', 'debug', 'general');
    expect(sendSysEx).toHaveBeenCalledWith(0x18, []);

    jest.useRealTimers();
  });

  test('STR field renders the formatted value and edits inline -> string PUT (R8)', () => {
    // Live-discovered type (device-model §3): the save program/bank name
    // editors. String PUTs verified on hardware (echoed as a 0x2e).
    appState.currentKey = '10020050';
    const subs = [
      {
        type: 'COL',
        position: '0',
        key: '10020050',
        parent: '10020050',
        statement: 'save bank',
        tag: 'savebank',
      },
      {
        type: 'STR',
        position: '0',
        key: '10020052',
        parent: '10020050',
        statement: 'name:%-22s',
        tag: 'name',
        value: 'Favorites',
      },
    ];
    renderScreen(subs, '', mockLog);

    const field = document.querySelector('.param-value[data-key="10020052"]');
    expect(field).toBeTruthy();
    expect(field.textContent).toContain('Favorites');

    appState.currentSubs = subs;
    jest.useFakeTimers();

    // Empty input is invalid (the device ignores empty-string puts, #104).
    field.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const editor = document.querySelector('#lcd input.lcd-edit');
    expect(editor.value).toBe('Favorites'); // seeded with the current value
    editor.value = '';
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(sendValuePut).not.toHaveBeenCalled();
    expect(editor.classList.contains('lcd-edit-invalid')).toBe(true);

    editor.value = 'NewName';
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(sendValuePut).toHaveBeenCalledWith('10020052', 'NewName');
    expect(appState.currentValues['10020052']).toBe('NewName');
    jest.useRealTimers();
  });

  test('lcd click on back-link navigates to the tree parent with a derived stack (T1b)', () => {
    appState.currentKey = '10010001';
    const setupSubs = [
      {
        type: 'COL',
        position: '0',
        key: '10010000',
        parent: '10010000',
        statement: 'Setup',
        tag: 'setup',
      },
      {
        type: 'COL',
        position: '1',
        key: '10010001',
        parent: '10010000',
        statement: 'Input',
        tag: 'input',
      },
    ];
    // The tree knows setup (and that root lists it) — as it would after a
    // real click path through those menus.
    recordDump([
      { type: 'COL', position: '0', key: '0', parent: '0', statement: 'ORVILLE', tag: 'ORVILLE' },
      {
        type: 'COL',
        position: '1',
        key: '10010000',
        parent: '0',
        statement: 'Setup',
        tag: 'setup',
      },
    ]);
    recordDump(setupSubs);
    appState.keyStack = [{ key: '10010000', tag: 'setup', subs: setupSubs }];
    const subs = [
      {
        type: 'COL',
        position: '0',
        key: '10010001',
        parent: '10010000',
        statement: 'Input',
        tag: 'input',
      },
      {
        type: 'NUM',
        position: '1',
        key: '10010011',
        parent: '10010001',
        statement: 'Param %3.0f',
        tag: 'prm',
        value: '5',
        options: [],
      },
    ];
    renderScreen(subs, '', mockLog);

    const back = document.querySelector('.back-link');
    expect(back).toBeTruthy();
    expect(back.dataset.key).toBe('10010000');

    back.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(appState.currentKey).toBe('10010000');
    // T1b: the stack is DERIVED from tree ancestry, not popped history.
    expect(appState.keyStack.map((e) => e.key)).toEqual(['0']);
    expect(appState.pendingDescend).toBe(true);
    expect(appState.currentSoftkeys).toEqual([]);
    expect(sendObjectInfoDump).toHaveBeenCalledWith('10010000', null);
    expect(sendValueDump).toHaveBeenCalledWith('10010000', null);
  });

  test('softkey descend derives the keyStack from tree ancestry (T1b)', () => {
    appState.currentKey = '10010000';
    const subs = [
      {
        type: 'COL',
        position: '0',
        key: '10010000',
        parent: '10010000',
        statement: 'Setup',
        tag: 'setup',
      },
      {
        type: 'COL',
        position: '1',
        key: '10010010',
        parent: '10010000',
        statement: 'Input',
        tag: 'input',
      },
      {
        type: 'COL',
        position: '2',
        key: '10010020',
        parent: '10010000',
        statement: 'Output',
        tag: 'output',
      },
    ];
    // The tree learns the menu's structure as its dump arrives (the parser
    // calls recordDump in production; tests do it directly).
    recordDump(subs);
    renderScreen(subs, '', mockLog);

    const softkey = document.querySelector('.softkey[data-key="10010010"]');
    expect(softkey).toBeTruthy();
    softkey.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(appState.currentKey).toBe('10010010');
    // T1b: ancestors computed from the tree, not pushed history.
    expect(appState.keyStack.map((e) => e.key)).toEqual(['10010000']);
    expect(appState.keyStack[0].tag).toBe('setup');
  });

  test('sibling softkey navigation keeps the derived parent (T1b)', () => {
    const parentSubs = [
      {
        type: 'COL',
        position: '0',
        key: '10010000',
        parent: '10010000',
        statement: 'Setup',
        tag: 'setup',
      },
      {
        type: 'COL',
        position: '1',
        key: '10010010',
        parent: '10010000',
        statement: 'Input',
        tag: 'input',
      },
      {
        type: 'COL',
        position: '2',
        key: '10010020',
        parent: '10010000',
        statement: 'Output',
        tag: 'output',
      },
    ];
    appState.currentKey = '10010010';
    recordDump(parentSubs); // tree knows the parent and its children
    appState.keyStack = [{ key: '10010000', tag: 'setup', subs: parentSubs }];
    // Leaf menu: params only, so the parent's COLs render as the softkeys.
    const subs = [
      {
        type: 'COL',
        position: '0',
        key: '10010010',
        parent: '10010010',
        statement: 'Input',
        tag: 'input',
      },
      {
        type: 'NUM',
        position: '1',
        key: '10010011',
        parent: '10010010',
        statement: 'lvl %3.0f',
        tag: '',
        value: '5',
      },
    ];
    renderScreen(subs, '', mockLog);

    const sibling = document.querySelector('.softkey[data-key="10010020"]');
    expect(sibling).toBeTruthy();
    sibling.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(appState.currentKey).toBe('10010020');
    expect(appState.keyStack.map((e) => e.key)).toEqual(['10010000']); // same derived parent
  });

  test('re-clicking the current softkey is a no-op, not a self-push (C3 review)', () => {
    appState.currentKey = '10010010';
    appState.keyStack = [
      {
        key: '10010000',
        tag: 'setup',
        subs: [
          {
            type: 'COL',
            position: '0',
            key: '10010000',
            parent: '10010000',
            statement: 'Setup',
            tag: 'setup',
          },
          {
            type: 'COL',
            position: '1',
            key: '10010010',
            parent: '10010000',
            statement: 'Input',
            tag: 'input',
          },
          {
            type: 'COL',
            position: '2',
            key: '10010020',
            parent: '10010000',
            statement: 'Output',
            tag: 'output',
          },
        ],
      },
    ];
    // Leaf menu: parent's COLs render as softkeys, current one highlighted.
    const subs = [
      {
        type: 'COL',
        position: '0',
        key: '10010010',
        parent: '10010010',
        statement: 'Input',
        tag: 'input',
      },
      {
        type: 'NUM',
        position: '1',
        key: '10010011',
        parent: '10010010',
        statement: 'lvl %3.0f',
        tag: '',
        value: '5',
      },
    ];
    renderScreen(subs, '', mockLog);
    sendObjectInfoDump.mockClear();

    const current = document.querySelector('.softkey[data-key="10010010"]');
    expect(current).toBeTruthy();
    current.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(appState.currentKey).toBe('10010010'); // unchanged
    expect(appState.keyStack).toHaveLength(1); // no duplicate self-entry
    expect(sendObjectInfoDump).not.toHaveBeenCalled(); // no refetch churn
  });

  test('a menu with params keeps its position-0 COL softkeys (R1: program functions navigable)', () => {
    // Live-validated bug: 'program functions' is one TRG + eight position-0
    // COL children. A holdover filter dropped ALL position-0 COLs from the
    // softkey row whenever any param was present, leaving the menu with no
    // navigation at all — the load-new-preset UI (bank/program selection)
    // was unreachable. The physical PROGRAM screen shows those softkeys
    // (load/save/update/delete...). Embedding still excludes only the
    // actually-embedded child, handled separately by the embeddedKey filter.
    appState.currentKey = '10020000';
    const subs = [
      {
        type: 'COL',
        position: '0',
        key: '10020000',
        parent: '10020000',
        statement: 'program functions',
        tag: 'program',
      },
      {
        type: 'COL',
        position: '0',
        key: '10020010',
        parent: '10020000',
        statement: 'load new preset',
        tag: 'load',
      },
      {
        type: 'COL',
        position: '0',
        key: '10020020',
        parent: '10020000',
        statement: 'save program',
        tag: 'save',
      },
      {
        type: 'TRG',
        position: '0',
        key: '10020090',
        parent: '10020000',
        statement: '<- compare program',
        tag: 'compare',
      },
    ];
    renderScreen(subs, '', mockLog);

    expect(document.querySelector('.softkey[data-key="10020010"]')).toBeTruthy(); // load
    expect(document.querySelector('.softkey[data-key="10020020"]')).toBeTruthy(); // save
    expect(document.querySelector('.param-value[data-key="10020090"]')).toBeTruthy(); // TRG still renders
  });

  test('only the FIRST position-0 child may embed, regardless of arrival order (R6)', () => {
    // Live-validated: on 'program functions' the first child's dump (the
    // giant bank list) arrives last, so the old first-loaded-wins loop
    // embedded a later sibling ('link program') and the embedded UI varied
    // run to run. Pin: a later sibling with a tree-recorded dump must NOT
    // embed while the first candidate's data is absent.
    appState.currentKey = '10020000';
    const subs = [
      {
        type: 'COL',
        position: '0',
        key: '10020000',
        parent: '10020000',
        statement: 'program functions',
        tag: 'program',
      },
      {
        type: 'COL',
        position: '0',
        key: '10020010',
        parent: '10020000',
        statement: 'load new preset',
        tag: 'load',
      },
      {
        type: 'COL',
        position: '0',
        key: '10020080',
        parent: '10020000',
        statement: 'link program',
        tag: 'link',
      },
    ];
    // Only the LATER sibling's dump has arrived (in the tree, T1b).
    recordDump([
      {
        type: 'COL',
        position: '0',
        key: '10020080',
        parent: '10020080',
        statement: 'link program',
        tag: 'link',
      },
      {
        type: 'TRG',
        position: '1',
        key: '10020081',
        parent: '10020080',
        statement: '<- link',
        tag: 'link',
      },
    ]);
    renderScreen(subs, '', mockLog);
    const lcd = document.getElementById('lcd');
    expect(lcd.textContent).not.toContain('<- link'); // later sibling must not embed
    expect(document.querySelector('.softkey[data-key="10020080"]')).toBeTruthy(); // stays a softkey

    // Once the FIRST candidate's data arrives, it embeds (and leaves the row).
    recordDump([
      {
        type: 'COL',
        position: '0',
        key: '10020010',
        parent: '10020010',
        statement: 'load new preset',
        tag: 'load',
      },
      {
        type: 'TRG',
        position: '1',
        key: '1002001c',
        parent: '10020010',
        statement: '<- load program in A',
        tag: 'load',
      },
    ]);
    renderScreen(subs, '', mockLog);
    expect(lcd.textContent).toContain('<- load program in A'); // first candidate embeds
    expect(document.querySelector('.softkey[data-key="10020010"]')).toBeFalsy(); // excluded from row
  });

  test('static root softkeys jump (reset the stack), never descend (R2)', () => {
    // Live-validated: descending grew the keyStack without bound (2 -> 6 in
    // one walk) and duplicated the previous menu's COL row set. T1b keeps
    // this as the one non-derived navigation: the tree is seeded with root
    // here exactly so the assertion proves the jump RESETS instead of
    // deriving [root] (which would re-render root's children as crumb rows
    // above the identical static row).
    recordDump([
      { type: 'COL', position: '0', key: '0', parent: '0', statement: 'ORVILLE ROOT', tag: '' },
      {
        type: 'COL',
        position: '0',
        key: '10030000',
        parent: '0',
        statement: 'levels menus',
        tag: 'levels',
      },
    ]);
    appState.currentKey = '10010010';
    appState.keyStack = [
      { key: '0', tag: 'ORVILLE', subs: [] },
      { key: '10010000', tag: 'setup', subs: [] },
    ];
    const subs = [
      {
        type: 'COL',
        position: '0',
        key: '10010010',
        parent: '10010010',
        statement: 'MIDI configuration',
        tag: 'midi',
      },
      {
        type: 'NUM',
        position: '1',
        key: '10010011',
        parent: '10010010',
        statement: 'ch %2.0f',
        tag: '',
        value: '1',
      },
    ];
    renderScreen(subs, '', mockLog);

    const levels = document.querySelector('.softkey[data-key="10030000"]'); // static row
    expect(levels).toBeTruthy();
    levels.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(appState.currentKey).toBe('10030000');
    expect(appState.keyStack).toEqual([]); // jump resets, not push to length 3
    expect(appState.pendingDescend).toBe(true);
  });

  test('a confirmed-empty NUM value is not refetched on render (C1 refetch convergence)', () => {
    // The device can answer a VALUE request with an empty value, which the
    // parser caches as ''. The render-driven refetch must treat that as
    // confirmed-absent (=== undefined check), not retry forever: post-C1
    // each retry would open a wave whose drain re-renders, making a falsy
    // check an unthrottled infinite request loop.
    appState.currentKey = '10010001';
    appState.currentValues = { 10010011: '' };
    const subs = [
      {
        type: 'COL',
        position: '0',
        key: '10010001',
        parent: '10010001',
        statement: 'Input',
        tag: 'input',
      },
      {
        type: 'NUM',
        position: '1',
        key: '10010011',
        parent: '10010001',
        statement: 'lvl %3.0f',
        tag: '',
        value: '5',
      },
      {
        type: 'NUM',
        position: '2',
        key: '10010012',
        parent: '10010001',
        statement: 'pan %3.0f',
        tag: '',
        value: '0',
      },
      {
        type: 'NUM',
        position: '3',
        key: '10010013',
        parent: '10010001',
        statement: 'trim %3.0f',
        tag: '',
        value: '',
      },
    ];
    renderScreen(subs, '', mockLog);

    // Only the param with NEITHER a cached nor a dump value is fetched
    // (#107: NUM now follows the same !s.value rule as SET/INF/STR — a
    // dump-valued NUM rendering its own line must not open refetch waves
    // on every settled render). The confirmed-empty cached one is not.
    expect(sendValueDump).toHaveBeenCalledWith('10010013');
    expect(sendValueDump).not.toHaveBeenCalledWith('10010012'); // dump value '0' suffices
    expect(sendValueDump).not.toHaveBeenCalledWith('10010011');
  });

  test('normalized root entry renders a real breadcrumb and a working back-link (C3/#39)', () => {
    // Pre-C3, main.js/controls.js pushed the raw string '0' here, so a
    // length-1 stack rendered "[undefined]" and the back-link's data-key was
    // undefined. With every entry normalized to {key, tag, subs}, the
    // breadcrumb shows the root tag and back navigates to '0'.
    appState.currentKey = '401000b';
    appState.keyStack = [
      {
        key: '0',
        tag: 'ORVILLE',
        subs: [
          {
            type: 'COL',
            position: '0',
            key: '0',
            parent: '0',
            statement: 'ORVILLE ROOT OBJECT',
            tag: 'ORVILLE',
          },
          {
            type: 'COL',
            position: '1',
            key: '10010000',
            parent: '0',
            statement: 'setup functions',
            tag: 'setup',
          },
          {
            type: 'COL',
            position: '2',
            key: '10020000',
            parent: '0',
            statement: 'program functions',
            tag: 'program',
          },
        ],
      },
    ];
    const subs = [
      {
        type: 'COL',
        position: '0',
        key: '401000b',
        parent: '401000b',
        statement: 'Black Hole',
        tag: '',
      },
      {
        type: 'NUM',
        position: '1',
        key: '4070001',
        parent: '401000b',
        statement: 'mix %3.0f',
        tag: '',
        value: '50',
      },
    ];
    renderScreen(subs, '', mockLog);

    const lcd = document.getElementById('lcd');
    expect(lcd.innerHTML).toContain('[ORVILLE]');
    expect(lcd.innerHTML).not.toContain('undefined');
    const back = document.querySelector('.back-link');
    expect(back.dataset.key).toBe('0');

    // Behavior change vs the raw-string entry (which yielded no parent
    // softkeys): a depth-1 leaf menu now falls back to the root entry's
    // tagged COLs as its softkey row, mirroring the device display.
    expect(document.querySelector('.softkey[data-key="10010000"]')).toBeTruthy();
    expect(document.querySelector('.softkey[data-key="10020000"]')).toBeTruthy();

    back.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(appState.currentKey).toBe('0');
  });

  test('CON values render in display units; the format spec may live in the tag (live-probed)', () => {
    // Live ground truth: pedal monitors are statement '' / tag '%2.1f%%' /
    // value 70.705 (percent, NOT a 0-1 fraction), and assign monitors
    // report 0-100 against a '%%' statement format. The old renderer sent
    // pedal CONs down the bar path with the literal format string as their
    // label, and *100-inflated percent values ('monitor = 10003.00%').
    appState.currentKey = '10030301';
    const subs = [
      {
        type: 'COL',
        position: '0',
        key: '10030301',
        parent: '10030301',
        statement: 'Pedal 1 setup',
        tag: 'pedals',
      },
      {
        type: 'CON',
        position: '10',
        key: '1003030a',
        parent: '10030301',
        statement: '',
        tag: '%2.1f%%',
        value: '70.705',
      },
      {
        type: 'CON',
        position: '1',
        key: '1001007a',
        parent: '10030301',
        statement: 'monitor = %2.2f%%',
        tag: '%2.1f%%',
        value: '100.03',
      },
      {
        type: 'CON',
        position: '2',
        key: '40090004',
        parent: '10030301',
        statement: '',
        tag: 'Beat',
        value: '0',
      },
      {
        type: 'NUM',
        position: '3',
        key: '40a0001',
        parent: '10030301',
        statement: 'mod rate  : %3.0f %%',
        tag: '',
        value: '60',
      },
    ];
    renderScreen(subs, '', mockLog);

    const text = document.getElementById('lcd').textContent;
    expect(text).toContain('70.7%'); // tag format applied to the display-unit value
    expect(text).not.toContain('%2.1f'); // the format string is never a label
    expect(text).toContain('monitor = 100.03%'); // no *100 inflation
    expect(text).not.toContain('10003');
    // '%%' collapses on EVERY param path now (the live LCD used to show
    // 'mod rate :  60 %%' — the collapse lived only in the CON branch).
    expect(text).toContain('60 %');
    expect(text).not.toContain('%%');
    // A spec-less indicator CON still gets the bar.
    expect(document.querySelector('.meter-bar')).toBeTruthy();
    expect(text).toContain('Beat');
  });

  test('render guard: a stale dump never paints under the new key — cached pre-paint (R3/#106)', () => {
    // Live bug: clicking levels while the link is backed up rendered the OLD
    // program menu titled/breadcrumbed as levels for seconds. The guard
    // pre-paints the tree's cached structure for the navigated-to key:
    // params as inert placeholder lines, COL children as live softkeys.
    appState.currentKey = '10030000';
    recordDump([
      {
        type: 'COL',
        position: '0',
        key: '10030000',
        parent: '10030000',
        statement: 'level functions',
        tag: 'level',
      },
      {
        type: 'NUM',
        position: '1',
        key: '10030001',
        parent: '10030000',
        statement: 'in gain %3.0f dB',
        tag: '',
        value: '6',
      },
      {
        type: 'COL',
        position: '2',
        key: '10030045',
        parent: '10030000',
        statement: 'meter setup',
        tag: 'meter',
      },
      {
        type: 'CON',
        position: '3',
        key: '10030002',
        parent: '10030000',
        statement: 'wet %3.0f%%',
        tag: 'wet',
        value: '56',
      },
      {
        type: 'NUM',
        position: 'a',
        key: '10030003',
        parent: '10030000',
        statement: '',
        tag: 'v1:%3.0f',
        value: '2',
      },
      {
        type: 'NUM',
        position: 'a',
        key: '10030004',
        parent: '10030000',
        statement: '',
        tag: 'v2:%3.0f',
        value: '5',
      },
    ]);
    const staleSubs = [
      {
        type: 'COL',
        position: '0',
        key: '10020000',
        parent: '10020000',
        statement: 'program functions',
        tag: 'program',
      },
      {
        type: 'TRG',
        position: '1',
        key: '10020001',
        parent: '10020000',
        statement: '<- load program in A',
        tag: 'load',
      },
    ];
    appState.currentSubs = staleSubs;
    renderScreen(staleSubs, '', mockLog);

    const lcd = document.getElementById('lcd');
    // The old menu's content is nowhere in the paint.
    expect(lcd.textContent).not.toContain('program functions');
    expect(lcd.textContent).not.toContain('load program');
    // The cached structure is: title, placeholder param (stale cached value
    // 6 must NOT render as if confirmed), navigable COL softkey.
    expect(lcd.textContent).toContain('level functions');
    expect(lcd.textContent).toContain('in gain ... dB');
    expect(lcd.textContent).not.toMatch(/in gain\s+6/);
    // '%%' collapses to a literal '%' in placeholder lines (reviewer fix).
    expect(lcd.textContent).toContain('wet ...%');
    expect(lcd.textContent).not.toContain('%%');
    // 'a'-positioned NUMs keep the grouped one-line graphic-EQ layout.
    expect(lcd.textContent).toContain('v1: ... v2: ...');
    expect(document.querySelector('.softkey[data-key="10030045"]')).toBeTruthy();
    // Placeholder params are inert: no clickable value span for the NUM.
    expect(document.querySelector('.param-value[data-key="10030001"]')).toBeFalsy();
    // The pre-paint pass writes no state and fetches nothing: currentSubs
    // stays device-confirmed (the stale dump) and no value refetch fires.
    expect(appState.currentSubs).toBe(staleSubs);
    expect(sendValueDump).not.toHaveBeenCalled();
  });

  test('render guard: an unknown key pre-paints an honest loading view, never the old menu (R3/#106)', () => {
    appState.currentKey = '10030000'; // tree has never seen this key
    const staleSubs = [
      {
        type: 'COL',
        position: '0',
        key: '10020000',
        parent: '10020000',
        statement: 'program functions',
        tag: 'program',
      },
    ];
    renderScreen(staleSubs, '', mockLog);

    const lcd = document.getElementById('lcd');
    expect(lcd.textContent).not.toContain('program functions');
    expect(lcd.textContent).toContain('loading ...');
  });

  test('lcd click on dsp-clickable swaps active preset with a derived stack (T1b)', () => {
    appState.currentKey = '0';
    appState.dspAName = 'Reverb';
    appState.dspBName = 'Delay';
    appState.dspAKey = '401000b';
    appState.dspBKey = '801000b';
    appState.presetKey = '401000b';
    const subs = [
      { type: 'COL', position: '0', key: '0', parent: '0', statement: 'Root', tag: 'root' },
      {
        type: 'COL',
        position: '1',
        key: '801000b',
        parent: '0',
        statement: 'Delay',
        tag: '',
      },
      {
        type: 'COL',
        position: '2',
        key: '10020000',
        parent: '0',
        statement: 'Program',
        tag: 'program',
      },
    ];
    recordDump(subs); // tree: root lists the B preset
    renderScreen(subs, '', mockLog);

    const dspB = document.querySelector('.dsp-clickable[data-key="801000b"]');
    expect(dspB).toBeTruthy();

    dspB.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(appState.presetKey).toBe('801000b');
    expect(appState.currentKey).toBe('801000b');
    expect(appState.pendingDescend).toBe(true);
    // T1b: ancestry derived from the tree — root is the preset's parent.
    expect(appState.keyStack.map((e) => e.key)).toEqual(['0']);
    expect(sendObjectInfoDump).toHaveBeenCalledWith('801000b', null);
    // #146: the view switch also presses the device A/B so the unit follows,
    // keeping a MIDI-map bind on the right DSP.
    expect(sendKeypress).toHaveBeenCalledWith([0xfd, 0xff, 0xfd, 0xff]); // keypressMasks.ab
  });

  test('a mapped DSP param shows its source lit on the badge (#146)', () => {
    resetParamMappings();
    recordParamMapping('4070001', 'pan'); // app has mapped this knob
    appState.currentKey = '401000b';
    const subs = [
      {
        type: 'COL',
        position: '0',
        key: '401000b',
        parent: '401000b',
        statement: 'Black Hole',
        tag: '',
      },
      {
        type: 'NUM',
        position: '0',
        key: '4070001',
        parent: '401000b',
        statement: 'diff/time : %3.0f %%',
        tag: '',
        value: '50',
      },
    ];
    renderScreen(subs, '', mockLog);
    const badge = document.querySelector('.lcd-midi-badge');
    expect(badge.classList.contains('lcd-midi-mapped')).toBe(true);
    expect(badge.textContent).toBe('pan'); // mapped source shown, not "MIDI"
    resetParamMappings();
  });
});
