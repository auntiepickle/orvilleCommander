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
      { key: '10010000', type: 'COL', parent: '10010000' }, // Main (own line echoes own key in parent slot)
      { key: '10010010', type: 'COL', parent: '10010000' }, // Child reference in parent menu
    ];
    // Mock SysEx: child sub under current. The dump's own line echoes its own
    // key in the parent slot (device-model.md §3), matching hardware captures.
    const asciiString = 'COL 1 10010010 10010010 "Child" "Child"';
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

  test('late child OBJECTINFO arriving after navigation is dropped, not stored (C8/#44)', () => {
    // User navigated to the B preset; currentSubs still describes the old
    // setup menu (it is only replaced when the new menu's dump lands). The
    // old menu's in-flight child dump must not be stored under the new view.
    appState.currentKey = '801000b';
    appState.currentSubs = [
      { key: '10010000', type: 'COL', parent: '10010000' },
      { key: '10010010', type: 'COL', parent: '10010000' },
    ];
    const asciiString = 'COL 1 10010010 10010010 "Child" "Child"';
    const asciiData = asciiString.split('').map((c) => c.charCodeAt(0));
    parseResponse([0xf0, 0x1c, 0x70, 0x00, 0x32, ...asciiData, 0xf7]);
    expect(appState.childSubs).toEqual({});
    expect(emit).not.toHaveBeenCalledWith('objectinfo:received', { key: '10010010' });
  });

  test('child store requires currentSubs to describe the current menu (C8/#44)', () => {
    // Defensive pin: even if view state were inconsistent (an entry matching
    // key+parent inside subs whose own line is NOT the current key — e.g. a
    // stale re-pin), the guard must fail closed rather than trust it.
    appState.currentKey = '10010000';
    appState.currentSubs = [
      { key: 'deadbeef', type: 'COL', parent: 'deadbeef' },
      { key: '10010010', type: 'COL', parent: '10010000' },
    ];
    const asciiString = 'COL 1 10010010 10010010 "Child" "Child"';
    const asciiData = asciiString.split('').map((c) => c.charCodeAt(0));
    parseResponse([0xf0, 0x1c, 0x70, 0x00, 0x32, ...asciiData, 0xf7]);
    expect(appState.childSubs).toEqual({});
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

  // Helper for the VALUE_DUMP (0x2e) branch characterization below.
  const valueDump = (ascii) => {
    const asciiData = ascii.split('').map((c) => c.charCodeAt(0));
    return [0xf0, 0x1c, 0x70, 0x00, 0x2e, ...asciiData, 0xf7];
  };

  test('VALUE_DUMP for a CON sub emits an immediate render', () => {
    appState.currentSubs = [{ key: '10030011', type: 'CON' }];
    parseResponse(valueDump('10030011 0.5'));
    expect(appState.currentValues['10030011']).toBe('0.5');
    expect(emit).toHaveBeenCalledWith('value:received', { key: '10030011', immediate: true });
    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining('Immediate re-rendered screen for CON value change on key 10030011'),
      'debug',
      'renderScreen'
    );
  });

  test('VALUE_DUMP for a CON sub stored in childSubs emits an immediate render (C7/#43)', () => {
    appState.currentSubs = []; // meter lives in an embedded child menu, not the top level
    appState.childSubs = {
      4040002: [
        { key: '4040002', type: 'COL' },
        { key: '4070002', type: 'CON' },
      ],
    };
    parseResponse(valueDump('4070002 0.5'));
    expect(emit).toHaveBeenCalledWith('value:received', { key: '4070002', immediate: true });
    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining('Immediate re-rendered screen for CON value change on key 4070002'),
      'debug',
      'renderScreen'
    );
  });

  test('VALUE_DUMP for an unknown key coalesces — 0002 suffix alone is not a meter (C7/#43)', () => {
    // Pre-C7 the endsWith('0002') heuristic forced an immediate render here.
    // A key absent from every loaded dump has no on-screen line an immediate
    // render could update, and menu keys can end 0002 too; type is the truth.
    appState.currentSubs = [];
    appState.childSubs = {};
    parseResponse(valueDump('10030002 0.8'));
    expect(appState.currentValues['10030002']).toBe('0.8');
    expect(emit).toHaveBeenCalledWith('value:received', { key: '10030002', immediate: false });
  });

  test('VALUE_DUMP for a non-CON child param takes the immediate fallback', () => {
    appState.currentSubs = [];
    appState.childSubs = { 10010071: [{ key: '10010711', type: 'NUM' }] };
    parseResponse(valueDump('10010711 7'));
    expect(emit).toHaveBeenCalledWith('value:received', { key: '10010711', immediate: true });
    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining('Fallback triggered for child param key 10010711'),
      'debug',
      'general'
    );
  });

  test('VALUE_DUMP for program/bank keys updates cache but skips render', () => {
    for (const key of ['10020011', '10020012']) {
      emit.mockClear();
      parseResponse(valueDump(`${key} 3 SomePreset`));
      expect(appState.currentValues[key]).toBe('3 SomePreset');
      expect(emit).not.toHaveBeenCalled();
    }
  });

  test('VALUE_DUMP logs a value change and a no-change', () => {
    appState.currentSubs = [{ key: '10030011', type: 'NUM' }];
    appState.currentValues['10030011'] = 'old';
    parseResponse(valueDump('10030011 new'));
    expect(mockLog).toHaveBeenCalledWith('Value changed from old to new', 'info', 'valueChange');
    expect(emit).toHaveBeenCalledWith('value:received', { key: '10030011', immediate: false });

    mockLog.mockClear();
    parseResponse(valueDump('10030011 new'));
    expect(mockLog).toHaveBeenCalledWith('Value did not change, still new', 'debug', 'noChange');
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
    // A3: no optimistic cache write — the value is not set synchronously.
    expect(appState.currentValues['10020011']).toBeUndefined();
    jest.advanceTimersByTime(500); // Advance for setTimeout in fix
    expect(sendValuePut).toHaveBeenCalledWith('10020011', '1'); // Correct index (desc match)
    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining('Correcting selection after Favorites re-order'),
      'info',
      'general'
    );
    // A3: the re-dump is the single source of truth that reconciles the value.
    expect(sendValueDump).toHaveBeenCalledWith('10020011');
  });

  test('A5: a throw mid-parse reverts all state writes from that call', () => {
    appState.deviceId = 0; // will be detected/written before the throw
    // Well-framed OBJECTINFO for device 5 but with empty ASCII payload, so
    // subs is [] and main.key access throws after deviceId was written.
    const data = [0xf0, 0x1c, 0x70, 0x05, 0x32, 0x20, 0xf7];
    parseResponse(data);
    expect(appState.deviceId).toBe(0); // rolled back, not left at 5
    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining('Parse response error'),
      'error',
      'error'
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
