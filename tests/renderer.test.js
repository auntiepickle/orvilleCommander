import { updateScreen, renderScreen, toggleDspKey } from '../src/renderer.js';
import { appState } from '../src/state.js';
import { sendObjectInfoDump, sendValueDump, sendValuePut, sendSysEx } from '../src/midi.js';
import { showLoading, log as mockLog } from '../src/main.js';

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
    appState.isLoadingPreset = false;
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
    appState.presetKey = '401000b';  // → loadKey='1002001c'
    const subs = [
      { type: 'COL', position: '0', key: '10020000', parent: '', statement: 'Program', tag: 'program' },
      {
        type: 'SET',
        position: '1',
        key: '10020011',
        parent: '10020000',
        statement: '%-20s',
        tag: 'Program',
        options: Array.from({ length: 6 }, (_, i) => ({ index: `${i}`, desc: `Preset${i}` })),
        value: '0 Preset0'
      }
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
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Auto-triggered load'), 'info', 'general');

    // Nested timeout 500 (post-load)
    jest.advanceTimersByTime(500);
    expect(sendObjectInfoDump).toHaveBeenCalledWith('0');
    expect(mockLog).toHaveBeenCalledWith('Fetched root after preset load.', 'debug', 'general');
    expect(sendSysEx).toHaveBeenCalledWith(0x18, []);  // 2nd bitmap

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
        step: '1'
      }
    ];
    renderScreen(subs, '', mockLog);
    const paramSpan = document.querySelector('.param-value[data-key="10010011"]');
    expect(paramSpan).toBeTruthy();

    appState.currentSubs = subs;  // For handler sub lookup
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
      { type: 'COL', position: '0', key: '10020000', parent: '', statement: 'Program', tag: 'program' },
      {
        type: 'TRG',
        position: '1',
        key: '1002001c',
        parent: '10020000',
        statement: 'LOAD A'
      }
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
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Triggered TRG for key 1002001c'), 'info', 'general');

    // Timeout 500
    jest.advanceTimersByTime(500);
    expect(sendObjectInfoDump).toHaveBeenCalledWith('0');
    expect(mockLog).toHaveBeenCalledWith('Fetched root after preset load.', 'debug', 'general');
    expect(sendSysEx).toHaveBeenCalledWith(0x18, []);

    jest.useRealTimers();
  });
});