// tests/parser.test.js

jest.mock('../src/midi.js', () => ({
  sendObjectInfoDump: jest.fn(),
  sendValueDump: jest.fn(),
  sendValuePut: jest.fn(),
  notifyResponse: jest.fn(),
}));

jest.mock('../src/events.js', () => ({
  emit: jest.fn(),
  on: jest.fn(),
}));

jest.mock('../src/logger.js', () => ({
  log: jest.fn(),
}));

import { parseResponse, parseSubObject } from '../src/parser.js';
import { appState } from '../src/state.js';
import { sendObjectInfoDump, sendValueDump, sendValuePut, notifyResponse } from '../src/midi.js';
import { emit } from '../src/events.js';
import { log as mockLog } from '../src/logger.js';

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
    notifyResponse.mockClear();
    emit.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers(); // Reset timers after each test
  });

  test('handles valid OBJECTINFO_DUMP for main menu and updates state', () => {
    // Mock SysEx: device 0, cmd 0x32 (OBJECTINFO_DUMP), ASCII 'COL 0 10010000 0 "Setup" "Setup"'
    const asciiString = 'COL 0 10010000 0 "Setup" "Setup"';
    const asciiData = asciiString.split('').map((c) => c.charCodeAt(0));
    const data = [0xf0, 0x1c, 0x70, 0x00, 0x32, ...asciiData, 0xf7];
    parseResponse(data);
    jest.advanceTimersByTime(300); // Flush any potential timers (safe even if not needed)
    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining('Parsed OBJECTINFO_DUMP for key 10010000'),
      'info',
      'parsedDump'
    );
    expect(appState.currentSubs).toHaveLength(1); // At least the main sub
    expect(appState.currentSubs[0].key).toBe('10010000');
    expect(emit).toHaveBeenCalledWith(
      'objectinfo:received',
      expect.objectContaining({
        key: '10010000',
        subs: expect.any(Array),
        ascii: expect.any(String),
      })
    );
  });

  test('handles valid OBJECTINFO_DUMP for child sub-menu and stores in childSubs', () => {
    appState.currentKey = '10010000'; // Set to parent key
    appState.currentSubs = [
      { key: '10010000', type: 'COL', parent: '0' }, // Main
      { key: '10010010', type: 'COL', parent: '10010000' }, // Child reference in parent menu
    ];
    // Mock SysEx: child sub under current
    const asciiString = 'COL 1 10010010 10010000 "Child" "Child"';
    const asciiData = asciiString.split('').map((c) => c.charCodeAt(0));
    const data = [0xf0, 0x1c, 0x70, 0x00, 0x32, ...asciiData, 0xf7];
    parseResponse(data);
    jest.advanceTimersByTime(300); // Flush any potential timers (safe even if not needed)
    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining('Stored child subs for key 10010010'),
      'debug',
      'parsedDump'
    );
    expect(appState.childSubs['10010010']).toBeDefined();
    expect(emit).toHaveBeenCalledWith('objectinfo:received', { key: '10010010' });
  });

  test('handles valid VALUE_DUMP and updates currentValues', () => {
    appState.currentSubs = [{ key: '10030000', type: 'SET' }];
    // Mock SysEx: device 0, cmd 0x2e (VALUE_DUMP), ASCII '10030000 "42 Some Value"'
    const asciiString = '10030000 "42 Some Value"';
    const asciiData = asciiString.split('').map((c) => c.charCodeAt(0));
    const data = [0xf0, 0x1c, 0x70, 0x00, 0x2e, ...asciiData, 0xf7];
    parseResponse(data);
    jest.advanceTimersByTime(200); // Advance for setTimeout (debounce is synchronous)
    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining('Parsed VALUE_DUMP for key 10030000'),
      'info',
      'parsedDump'
    );
    expect(appState.currentValues['10030000']).toBe('42 Some Value');
    expect(emit).toHaveBeenCalledWith('value:received', { key: '10030000', immediate: false });
  });

  test('handles screen dump (bitmap) and calls renderBitmap', () => {
    // Mock SysEx: device 0, cmd 0x17 (screen dump), some nibbles
    const nibbles = [0x00, 0x01, 0x02, 0x03]; // Simplified even nibbles
    const data = [0xf0, 0x1c, 0x70, 0x00, 0x17, ...nibbles, 0xf7];
    parseResponse(data);
    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining('Denibbled screen data'),
      'debug',
      'bitmap'
    );
    expect(emit).toHaveBeenCalledWith(
      'screen:received',
      expect.objectContaining({ rawBytes: expect.anything() })
    );
  });

  test('catches and logs errors on invalid data', () => {
    const invalidData = [0xf0, 0x1c, 0x70, 0x00, 0x32]; // Incomplete
    parseResponse(invalidData);
    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining('Parse response error'),
      'error',
      'error'
    );
  });

  test('handles Favorites re-ordering fix during preset load', () => {
    appState.currentKey = '10020010';
    appState.isLoadingPreset = true;
    appState.loadingPresetName = 'Target Preset';
    appState.currentValues['10020012'] = '0 Favorites'; // Mock bank value
    // Mock multi-line ASCII for OBJECTINFO_DUMP with subs
    const asciiString =
      'COL 0 10020010 0 "Favs" "Favs"\nSET 1 10020012 10020010 "Bank" "Bank" 0 "0 Favorites" 1 "0 Favorites" "1 Other Bank"\nSET 2 10020011 10020010 "Program" "Prog" 0 "0 Other Preset" 2 "0 Other Preset" "1 Target Preset"';
    const asciiData = asciiString.split('').map((c) => c.charCodeAt(0));
    const data = [0xf0, 0x1c, 0x70, 0x00, 0x32, ...asciiData, 0xf7];
    parseResponse(data);
    jest.advanceTimersByTime(500); // Advance for setTimeout in fix
    expect(sendValuePut).toHaveBeenCalledWith('10020011', '1'); // Correct index (desc match)
    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining('Correcting selection after Favorites re-order'),
      'info',
      'general'
    );
  });

  test('calls notifyResponse on well-formed 0x32 OBJECTINFO_DUMP', () => {
    const asciiString = 'COL 0 10010000 0 "Setup" "Setup"';
    const asciiData = asciiString.split('').map((c) => c.charCodeAt(0));
    const data = [0xf0, 0x1c, 0x70, 0x00, 0x32, ...asciiData, 0xf7];
    parseResponse(data);
    expect(notifyResponse).toHaveBeenCalledWith('objectinfo', '10010000');
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
