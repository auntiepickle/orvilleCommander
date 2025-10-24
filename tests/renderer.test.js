// tests/renderer.test.js
jest.mock('../src/midi.js', () => ({
  sendObjectInfoDump: jest.fn(),
  sendValueDump: jest.fn(),
  sendValuePut: jest.fn(),
  sendSysEx: jest.fn(),
}));

jest.mock('../src/main.js', () => ({
  showLoading: jest.fn(),
  log: jest.fn(),
}));

jest.mock('../src/controls.js', () => ({
  keypressMasks: {
    enter: [0xff, 0xff, 0xff, 0xef],
  },
}));

import { updateScreen, renderScreen, toggleDspKey } from '../src/renderer.js';
import { appState } from '../src/state.js';
import { sendObjectInfoDump, sendValueDump } from '../src/midi.js';

// Mock log
const mockLog = jest.fn();

describe('renderer.js', () => {
  beforeEach(() => {
    appState.currentSubs = [];
    appState.currentValues = {};
    appState.childSubs = {};
    appState.keyStack = [];
    appState.currentKey = '10010000'; // Non-root to trigger param/softkey rendering
    appState.presetKey = '401000b';
    appState.autoLoad = false;
    appState.isLoadingPreset = false;
    mockLog.mockClear();
    sendObjectInfoDump.mockClear();
    sendValueDump.mockClear();
    document.body.innerHTML = '<div id="lcd"></div>'; // Mock LCD element
  });

  test('updateScreen clears state and requests dumps for current key', () => {
    updateScreen(mockLog);
    expect(appState.childSubs).toEqual({});
    expect(appState.currentValues).toEqual({});
    expect(sendObjectInfoDump).toHaveBeenCalledWith(appState.currentKey, mockLog);
    expect(sendValueDump).toHaveBeenCalledWith(appState.currentKey, mockLog);
  });

  test('toggleDspKey switches between A and B presets', () => {
    expect(toggleDspKey('401000b')).toBe('801000b');
    expect(toggleDspKey('801000b')).toBe('401000b');
  });

  test('renderScreen generates correct HTML for params and softkeys', () => {
    const subs = [
      { type: 'COL', position: '0', key: '10010000', parent: '0', statement: 'Setup', tag: 'Setup', value: '' },
      { type: 'NUM', position: '1', key: '10010001', parent: '10010000', statement: 'Param', tag: 'Prm', value: '50', min: '0', max: '100', step: '1' },
      { type: 'COL', position: '2', key: '10010002', parent: '10010000', statement: 'Sub Menu', tag: 'Sub', value: '' },
    ];
    renderScreen(subs, null, mockLog); // ascii null to test subs-based rendering
    const lcd = document.getElementById('lcd');
    expect(lcd.innerHTML).toContain('Setup'); // Title from main COL statement
    expect(lcd.innerHTML).toContain('Param'); // Param statement displayed
    expect(lcd.innerHTML).toContain('data-key="10010002"'); // Softkey structure
    expect(lcd.innerHTML).toContain('Sub'); // Softkey tag
  });
});