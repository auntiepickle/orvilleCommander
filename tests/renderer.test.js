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
    appState.autoLoad = false;
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
    expect(appState.autoLoad).toBe(true);
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

  test('autoload-descend sources the keyStack entry from the param subs, not the global (#41)', () => {
    appState.autoLoad = true;
    appState.currentKey = '401000b'; // the key being loaded (stays global)
    // The subs THIS render was invoked with: two short-tag COL children, no params.
    const subs = [
      { type: 'COL', position: '0', key: '0', parent: '', statement: 'Real Root', tag: 'realroot' },
      {
        type: 'COL',
        position: '1',
        key: '10010000',
        parent: '0',
        statement: 'Setup',
        tag: 'setup',
      },
      { type: 'COL', position: '2', key: '10020000', parent: '0', statement: 'Prog', tag: 'prog' },
    ];
    // renderScreen re-pins appState.currentSubs = subs at its top, which normally
    // keeps global == param and masks the divergence. Pin the global to a STALE
    // value with a no-op setter so it survives that re-pin — simulating stale
    // debounced delivery. This makes the test fail on the old code (which read
    // appState.currentSubs[0]) and pass on the fix (which reads subs[0]).
    const stale = [
      { type: 'COL', position: '0', key: 'STALE', parent: '', statement: 'Stale', tag: 'stale' },
    ];
    Object.defineProperty(appState, 'currentSubs', {
      configurable: true,
      get: () => stale,
      set: () => {}, // swallow renderScreen's render-pin write
    });
    try {
      renderScreen(subs, '', mockLog);
    } finally {
      // Restore currentSubs as a normal data property for subsequent tests.
      Object.defineProperty(appState, 'currentSubs', {
        configurable: true,
        enumerable: true,
        writable: true,
        value: [],
      });
    }

    expect(appState.keyStack).toHaveLength(1);
    const entry = appState.keyStack[0];
    expect(entry.tag).toBe('realroot'); // from param subs[0], not the stale 'stale'
    expect(entry.subs[0].key).toBe('0');
    expect(entry.subs.map((s) => s.key)).not.toContain('STALE');
    expect(entry.key).toBe('401000b'); // currentKey (loaded key) stays global
    expect(appState.currentKey).toBe('10010000'); // descended to first child
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
    expect(appState.autoLoad).toBe(true);
    expect(appState.childSubs).toEqual({});
    expect(appState.keyStack.length).toBe(1);
    expect(appState.keyStack[0].key).toBe('0');
    expect(sendObjectInfoDump).toHaveBeenCalledWith('801000b', null);
  });
});
