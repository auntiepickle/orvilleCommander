// tests/parser.test.js
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

import { parseResponse } from '../src/parser.js';
import { appState } from '../src/state.js';
import { sendObjectInfoDump, sendValueDump, sendValuePut } from '../src/midi.js';
import { renderScreen } from '../src/renderer.js'; // Mocked renderScreen (debounced or not)
import { hideLoading } from '../src/main.js';

// Mock log
const mockLog = jest.fn();

describe('parseResponse', () => {
  beforeEach(() => {
    // Reset state
    appState.currentSubs = [];
    appState.currentValues = {};
    appState.childSubs = {};
    appState.isLoadingPreset = false;
    appState.loadingPresetName = null;
    mockLog.mockClear();
    sendObjectInfoDump.mockClear();
    sendValueDump.mockClear();
    sendValuePut.mockClear();
    renderScreen.mockClear();
    hideLoading.mockClear();
  });

  test('handles valid OBJECTINFO_DUMP and updates state', () => {
    const data = [0xf0, 0x1c, 0x70, 0x00, 0x32, 0x41, 0x42, 0x43, 0xf7]; // Mock SysEx: device 0, cmd 0x32, ASCII 'ABC'
    parseResponse(data, mockLog);
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Parsed OBJECTINFO_DUMP'), 'info', 'parsedDump');
    // Add more assertions based on expected state changes
  });

  test('catches and logs errors on invalid data', () => {
    const invalidData = [0xf0, 0x1c, 0x70, 0x00, 0x32]; // Incomplete
    parseResponse(invalidData, mockLog);
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Parse response error'), 'error', 'error');
  });

  // Add more tests: e.g., VALUE_DUMP, screen dump, Favorites fix
});