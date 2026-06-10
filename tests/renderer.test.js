import { renderScreen } from '../src/renderer.js';
import { appState } from '../src/state.js';
import { sendObjectInfoDump, sendValueDump, sendValuePut, sendSysEx } from '../src/midi.js';
import { showLoading } from '../src/main.js';
import { log as mockLog } from '../src/logger.js';

jest.mock('../src/midi.js', () => ({
  sendObjectInfoDump: jest.fn(),
  sendValueDump: jest.fn(),
  sendValuePut: jest.fn(),
  sendSysEx: jest.fn(),
}));

jest.mock('../src/controls.js', () => ({
  keypressMasks: { enter: [0xff, 0xff, 0xff, 0xef] },
}));

jest.mock('../src/main.js', () => ({
  showLoading: jest.fn(),
}));

jest.mock('../src/logger.js', () => ({
  log: jest.fn(),
}));

describe('renderer.js', () => {
  let consoleLogSpy;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    appState.currentSubs = [];
    appState.currentValues = {};
    appState.childSubs = {};
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
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  // ... **UNCHANGED: all prior passing tests** ...

  test('select change updates SET value and triggers auto-load for program select', () => {
    appState.currentKey = '10020000';
    appState.presetKey = '401000b'; // → loadKey='1002001c'
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
        key: '10020011',
        parent: '10020000',
        statement: '%-20s',
        tag: 'Program',
        options: Array.from({ length: 6 }, (_, i) => ({ index: `${i}`, desc: `Preset${i}` })),
        value: '0 Preset0',
      },
    ];
    renderScreen(subs, '', mockLog);
    const select = document.querySelector('select[data-key="10020011"]');
    expect(select).toBeTruthy();

    select.value = '5';
    jest.useFakeTimers();
    select.dispatchEvent(new Event('change', { bubbles: true }));

    // Immediate
    expect(showLoading).toHaveBeenCalled();
    expect(sendValuePut).toHaveBeenCalledWith('10020011', '5');
    expect(appState.currentValues['10020011']).toBe('5 Preset5');

    // Timeout 200
    jest.advanceTimersByTime(200);
    expect(sendSysEx).toHaveBeenCalledWith(0x18, []);

    // Nested timeout 300 (auto-load)
    jest.advanceTimersByTime(300);
    expect(sendValuePut).toHaveBeenCalledWith('1002001c', '1');
    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining('Auto-triggered load'),
      'info',
      'general'
    );

    // Nested timeout 500 (post-load)
    jest.advanceTimersByTime(500);
    expect(sendObjectInfoDump).toHaveBeenCalledWith('0');
    expect(mockLog).toHaveBeenCalledWith('Fetched root after preset load.', 'debug', 'general');
    expect(sendSysEx).toHaveBeenCalledWith(0x18, []); // 2nd bitmap

    jest.useRealTimers();
  });

  test('param click edits NUM value with validation', () => {
    window.prompt = jest.fn(() => '75');
    window.alert = jest.fn(() => {});
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
    paramSpan.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Immediate
    expect(showLoading).toHaveBeenCalled();
    expect(sendValuePut).toHaveBeenCalledWith('10010011', '75');
    expect(appState.currentValues['10010011']).toBe('75');
    expect(window.prompt).toHaveBeenCalledWith(expect.stringContaining('Param'), '50');

    // Timeout 200
    jest.advanceTimersByTime(200);
    expect(sendSysEx).toHaveBeenCalledWith(0x18, []);

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

  test('STR field renders the formatted value and edits via prompt -> string PUT (R8)', () => {
    // Live-discovered type (device-model §3): the save program/bank name
    // editors. String PUTs verified on hardware (echoed as a 0x2e).
    window.prompt = jest.fn(() => 'NewName');
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
    field.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(window.prompt).toHaveBeenCalledWith(expect.stringContaining('name'), 'Favorites');
    expect(sendValuePut).toHaveBeenCalledWith('10020052', 'NewName');
    expect(appState.currentValues['10020052']).toBe('NewName');
    jest.useRealTimers();
  });

  test('lcd click on back-link pops keyStack and refreshes', () => {
    appState.currentKey = '10010001';
    appState.keyStack = [
      {
        key: '10010000',
        tag: 'setup',
        subs: [
          {
            type: 'COL',
            position: '0',
            key: '10010000',
            parent: '0',
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
        ],
      },
    ];
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
    appState.childSubs = { 10010011: [{ key: '10010011', type: 'NUM' }] };

    const back = document.querySelector('.back-link');
    expect(back).toBeTruthy();
    expect(back.dataset.key).toBe('10010000');

    back.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(appState.currentKey).toBe('10010000');
    expect(appState.keyStack.length).toBe(0);
    expect(appState.pendingDescend).toBe(true);
    expect(appState.currentSoftkeys).toEqual([]);
    expect(appState.childSubs).toEqual({}); // single clear point in updateScreen (C8/#44)
    expect(sendObjectInfoDump).toHaveBeenCalledWith('10010000', null);
    expect(sendValueDump).toHaveBeenCalledWith('10010000', null);
  });

  test('softkey descend clears childSubs via the updateScreen single clear point (C8/#44)', () => {
    appState.currentKey = '10010000';
    appState.childSubs = { stale: [{ key: 'stale', type: 'NUM' }] };
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
    renderScreen(subs, '', mockLog);

    const softkey = document.querySelector('.softkey[data-key="10010010"]');
    expect(softkey).toBeTruthy();
    softkey.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(appState.currentKey).toBe('10010010');
    expect(appState.keyStack.length).toBe(1);
    expect(appState.childSubs).toEqual({});
  });

  test('sibling softkey navigation clears childSubs via the updateScreen single clear point (C8/#44)', () => {
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
    appState.keyStack = [{ key: '10010000', tag: 'setup', subs: parentSubs }];
    appState.childSubs = { stale: [{ key: 'stale', type: 'NUM' }] };
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
    expect(appState.keyStack.length).toBe(1); // sibling nav does not push
    expect(appState.childSubs).toEqual({});
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
    // run to run. Pin: a later sibling with loaded childSubs must NOT embed
    // while the first candidate's data is absent.
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
    appState.childSubs = {
      // Only the LATER sibling has arrived.
      10020080: [
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
      ],
    };
    renderScreen(subs, '', mockLog);
    const lcd = document.getElementById('lcd');
    expect(lcd.textContent).not.toContain('<- link'); // later sibling must not embed
    expect(document.querySelector('.softkey[data-key="10020080"]')).toBeTruthy(); // stays a softkey

    // Once the FIRST candidate's data arrives, it embeds (and leaves the row).
    appState.childSubs = {
      10020010: [
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
      ],
    };
    renderScreen(subs, '', mockLog);
    expect(lcd.textContent).toContain('<- load program in A'); // first candidate embeds
    expect(document.querySelector('.softkey[data-key="10020010"]')).toBeFalsy(); // excluded from row
  });

  test('static root softkeys jump (reset the stack), never descend (R2)', () => {
    // Live-validated: descending grew the keyStack without bound (2 -> 6 in
    // one walk) and duplicated the previous menu's COL row set.
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
    ];
    renderScreen(subs, '', mockLog);

    // The uncached param is fetched; the confirmed-empty one is not.
    expect(sendValueDump).toHaveBeenCalledWith('10010012');
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

  test('lcd click on dsp-clickable swaps active preset and pushes keyStack', () => {
    appState.currentKey = '0';
    appState.dspAName = 'Reverb';
    appState.dspBName = 'Delay';
    appState.dspAKey = '401000b';
    appState.dspBKey = '801000b';
    appState.presetKey = '401000b';
    const subs = [
      { type: 'COL', position: '0', key: '0', parent: '', statement: 'Root', tag: 'root' },
      {
        type: 'COL',
        position: '1',
        key: '10020000',
        parent: '0',
        statement: 'Program',
        tag: 'program',
      },
    ];
    renderScreen(subs, '', mockLog);
    // Seed stale entries so the clear assertion below is not vacuous (C8/#44).
    appState.childSubs = { stale: [{ key: 'stale', type: 'NUM' }] };

    const dspB = document.querySelector('.dsp-clickable[data-key="801000b"]');
    expect(dspB).toBeTruthy();

    dspB.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(appState.presetKey).toBe('801000b');
    expect(appState.currentKey).toBe('801000b');
    expect(appState.pendingDescend).toBe(true);
    expect(appState.childSubs).toEqual({});
    expect(appState.keyStack.length).toBe(1);
    expect(appState.keyStack[0].key).toBe('0');
    expect(sendObjectInfoDump).toHaveBeenCalledWith('801000b', null);
  });
});
