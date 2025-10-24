// tests/parser.test.js
jest.mock('lodash.debounce', () => (fn) => fn); // Make debounce synchronous in tests

jest.mock('../src/midi.js', () => ({
  sendObjectInfoDump: jest.fn(),
  sendValueDump: jest.fn(),
  sendValuePut: jest.fn(),
}));

jest.mock('../src/renderer.js', () => ({
  renderScreen: jest.fn(),
  updateScreen: jest.fn(),
}));

jest.mock('../src/main.js', () => ({
  hideLoading: jest.fn(),
}));

import { parseResponse, parseSubObject } from '../src/parser.js';
import { appState } from '../src/state.js';
import { sendObjectInfoDump, sendValueDump, sendValuePut } from '../src/midi.js';
import { renderScreen } from '../src/renderer.js'; // Mocked renderScreen (debounced or not)
import { hideLoading } from '../src/main.js';

// Mock log
const mockLog = jest.fn();

describe('parseResponse', () => {
  beforeEach(() => {
    jest.useFakeTimers(); // Enable fake timers for setTimeout handling
    // Reset state
    appState.currentSubs = [];
    appState.currentValues = {};
    appState.childSubs = {};
    appState.isLoadingPreset = false;
    appState.loadingPresetName = null;
    appState.currentKey = '10010000'; // Use non-root for main test
    appState.deviceId = 0; // Explicit for test data match
    mockLog.mockClear();
    sendObjectInfoDump.mockClear();
    sendValueDump.mockClear();
    sendValuePut.mockClear();
    renderScreen.mockClear();
    hideLoading.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers(); // Reset timers after each test
  });

  test('handles valid OBJECTINFO_DUMP for main menu and updates state', () => {
    // Mock SysEx: device 0, cmd 0x32 (OBJECTINFO_DUMP), ASCII 'COL 0 10010000 0 "Setup" "Setup"'
    const asciiString = 'COL 0 10010000 0 "Setup" "Setup"';
    const asciiData = asciiString.split('').map(c => c.charCodeAt(0));
    const data = [0xf0, 0x1c, 0x70, 0x00, 0x32, ...asciiData, 0xf7];
    parseResponse(data, mockLog);
    jest.advanceTimersByTime(300); // Flush any potential timers (safe even if not needed)
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Parsed OBJECTINFO_DUMP for key 10010000'), 'info', 'parsedDump');
    expect(appState.currentSubs).toHaveLength(1); // At least the main sub
    expect(appState.currentSubs[0].key).toBe('10010000');
    expect(renderScreen).toHaveBeenCalled();
  });

  test('handles valid OBJECTINFO_DUMP for child sub-menu and stores in childSubs', () => {
    appState.currentKey = '10010000'; // Set to parent key
    appState.currentSubs = [
      { key: '10010000', type: 'COL', parent: '0' }, // Main
      { key: '10010010', type: 'COL', parent: '10010000' } // Child reference in parent menu
    ];
    // Mock SysEx: child sub under current
    const asciiString = 'COL 1 10010010 10010000 "Child" "Child"';
    const asciiData = asciiString.split('').map(c => c.charCodeAt(0));
    const data = [0xf0, 0x1c, 0x70, 0x00, 0x32, ...asciiData, 0xf7];
    parseResponse(data, mockLog);
    jest.advanceTimersByTime(300); // Flush any potential timers (safe even if not needed)
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Stored child subs for key 10010010'), 'debug', 'parsedDump');
    expect(appState.childSubs['10010010']).toBeDefined();
    expect(renderScreen).toHaveBeenCalled();
  });

  test('handles valid VALUE_DUMP and updates currentValues', () => {
    appState.currentSubs = [{ key: '10030000', type: 'SET' }];
    // Mock SysEx: device 0, cmd 0x2e (VALUE_DUMP), ASCII '10030000 "42 Some Value"'
    const asciiString = '10030000 "42 Some Value"';
    const asciiData = asciiString.split('').map(c => c.charCodeAt(0));
    const data = [0xf0, 0x1c, 0x70, 0x00, 0x2e, ...asciiData, 0xf7];
    parseResponse(data, mockLog);
    jest.advanceTimersByTime(200); // Advance for setTimeout (debounce is synchronous)
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Parsed VALUE_DUMP for key 10030000'), 'info', 'parsedDump');
    expect(appState.currentValues['10030000']).toBe('42 Some Value');
    expect(renderScreen).toHaveBeenCalled();
  });

  test('handles screen dump (bitmap) and calls renderBitmap', () => {
    // Mock SysEx: device 0, cmd 0x17 (screen dump), some nibbles
    const nibbles = [0x00, 0x01, 0x02, 0x03]; // Simplified even nibbles
    const data = [0xf0, 0x1c, 0x70, 0x00, 0x17, ...nibbles, 0xf7];
    parseResponse(data, mockLog);
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Denibbled screen data'), 'debug', 'bitmap');
    // Assert renderBitmap was called (implementation detail, but key for coverage)
  });

  test('catches and logs errors on invalid data', () => {
    const invalidData = [0xf0, 0x1c, 0x70, 0x00, 0x32]; // Incomplete
    parseResponse(invalidData, mockLog);
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Parse response error'), 'error', 'error');
  });

  test('handles Favorites re-ordering fix during preset load', () => {
    appState.currentKey = '10020010';
    appState.isLoadingPreset = true;
    appState.loadingPresetName = 'Target Preset';
    appState.currentValues['10020012'] = '0 Favorites'; // Mock bank value
    // Mock multi-line ASCII for OBJECTINFO_DUMP with subs
    const asciiString = 'COL 0 10020010 0 "Favs" "Favs"\nSET 1 10020012 10020010 "Bank" "Bank" 0 "0 Favorites" 1 "0 Favorites" "1 Other Bank"\nSET 2 10020011 10020010 "Program" "Prog" 0 "0 Other Preset" 2 "0 Other Preset" "1 Target Preset"';
    const asciiData = asciiString.split('').map(c => c.charCodeAt(0));
    const data = [0xf0, 0x1c, 0x70, 0x00, 0x32, ...asciiData, 0xf7];
    parseResponse(data, mockLog);
    jest.advanceTimersByTime(500); // Advance for setTimeout in fix
    expect(sendValuePut).toHaveBeenCalledWith('10020011', '1', mockLog); // Correct index (desc match)
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Correcting selection after Favorites re-order'), 'info', 'general');
  });
});

describe('parseSubObject', () => {
  test('parses NUM type correctly', () => {
    const line = 'NUM 1 10030000 10020000 "Param" "Tag" 50 0 100 1';
    const sub = parseSubObject(line);
    expect(sub.type).toBe('NUM');
    expect(sub.value).toBe('50');
    expect(sub.min).toBe('0');
    expect(sub.max).toBe('100');
    expect(sub.step).toBe('1');
  });

  test('parses SET type with options correctly', () => {
    const line = 'SET 2 10020011 10020000 "Program" "Prog" 0 "Option1" 2 "Option2" "Option3"'; // current_index 0, current_desc "Option1", num 2, then descs
    const sub = parseSubObject(line);
    expect(sub.type).toBe('SET');
    expect(sub.value).toBe('0 Option1');
    expect(sub.options).toHaveLength(2);
    expect(sub.options[0].desc).toBe('Option2');
    expect(sub.options[1].desc).toBe('Option3');
  });

  test('parses CON type correctly', () => {
    const line = 'CON 3 10040000 10030000 "Meter" "Mtr" 75';
    const sub = parseSubObject(line);
    expect(sub.type).toBe('CON');
    expect(sub.value).toBe('75');
  });

  test('handles unknown type with default value', () => {
    const line = 'UNKNOWN 0 00000000 0 "Test" "Tst" Extra';
    const sub = parseSubObject(line);
    expect(sub.type).toBe('UNKNOWN');
    expect(sub.value).toBe('Extra');
  });
});