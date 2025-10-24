// tests/parser.test.js
import { parseResponse } from '../src/parser.js';
import { appState } from '../src/state.js';

// Mock log and other deps
const mockLog = jest.fn();
const mockSendObjectInfoDump = jest.fn();
const mockSendValueDump = jest.fn();
const mockSendValuePut = jest.fn();
const mockDebouncedRenderScreen = jest.fn();
const mockHideLoading = jest.fn();

// Setup mocks (replace actual imports if needed via jest.mock)
jest.mock('../src/midi.js', () => ({
  sendObjectInfoDump: mockSendObjectInfoDump,
  sendValueDump: mockSendValueDump,
  sendValuePut: mockSendValuePut,
}));
jest.mock('../src/renderer.js', () => ({
  renderScreen: mockDebouncedRenderScreen, // Assuming debounced wrapper
}));

describe('parseResponse', () => {
  beforeEach(() => {
    // Reset state
    appState.currentSubs = [];
    appState.currentValues = {};
    appState.childSubs = {};
    appState.isLoadingPreset = false;
    appState.loadingPresetName = null;
    mockLog.mockClear();
    mockSendObjectInfoDump.mockClear();
    mockSendValueDump.mockClear();
    mockSendValuePut.mockClear();
    mockDebouncedRenderScreen.mockClear();
    mockHideLoading.mockClear();
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