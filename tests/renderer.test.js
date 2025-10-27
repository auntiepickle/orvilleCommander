// tests/renderer.test.js
jest.mock('../src/midi.js', () => ({
  sendObjectInfoDump: jest.fn(),
  sendValueDump: jest.fn(),
  sendValuePut: jest.fn(),
  sendSysEx: jest.fn(),
}));

jest.mock('../src/controls.js', () => ({
  keypressMasks: {
    enter: [0xff, 0xff, 0xff, 0xef],
  },
}));

jest.mock('../src/main.js', () => ({
  showLoading: jest.fn(),
  log: jest.fn(),
}));

import { updateScreen, renderScreen, toggleDspKey, handleLcdClick, handleSelectChange, handleParamClick } from '../src/renderer.js';
import { appState } from '../src/state.js';
import { sendObjectInfoDump, sendValueDump, sendValuePut, sendSysEx } from '../src/midi.js';
import { log as mockLog } from '../src/main.js';

// Mock log
const mockSendKeypress = jest.fn();

describe('renderer.js', () => {
  beforeEach(() => {
    appState.currentSubs = [];
    appState.currentValues = {};
    appState.childSubs = {};
    appState.keyStack = [];
    appState.currentKey = '0';
    appState.presetKey = '401000b';
    appState.autoLoad = false;
    appState.isLoadingPreset = false;
    appState.paramOffset = 0; // Reset for param display
    mockLog.mockClear();
    sendObjectInfoDump.mockClear();
    sendValueDump.mockClear();
    sendValuePut.mockClear();
    sendSysEx.mockClear();
    document.body.innerHTML = '<div id="lcd"></div>'; // Mock LCD element
  });

  test('updateScreen clears state and requests dumps for current key', () => {
    updateScreen(mockLog);
    expect(appState.childSubs).toEqual({});
    expect(appState.currentValues).toEqual({});
    expect(sendObjectInfoDump).toHaveBeenCalledWith('0', mockLog);
    expect(sendValueDump).toHaveBeenCalledWith('0', mockLog);
  });

  test('toggleDspKey switches between A and B presets', () => {
    expect(toggleDspKey('401000b')).toBe('801000b');
    expect(toggleDspKey('801000b')).toBe('401000b');
  });

  test('renderScreen generates correct HTML for COL menu with sub params and softkeys', () => {
    appState.currentKey = '10010001'; // COL menu
    appState.currentValues['10010011'] = '50'; // Value not used for sub NUM placeholder
    const subs = [
      { type: 'COL', position: '0', key: '10010001', parent: '10010000', statement: 'SubSetup', tag: 'SubSetup', value: '' },
      { type: 'NUM', position: '1', key: '10010011', parent: '10010001', statement: 'Param', tag: 'Prm', value: '50', min: '0', max: '100', step: '1' },
      { type: 'COL', position: '2', key: '10010012', parent: '10010001', statement: 'Sub Sub', tag: 'SubSub', value: '' },
    ];
    const ascii = 'COL 0 10010001 10010000 "SubSetup" "SubSetup"\nNUM 1 10010011 10010001 "Param" "Prm" 50 0 100 1\nCOL 2 10010012 10010001 "Sub Sub" "SubSub"';
    renderScreen(subs, ascii, mockLog);
    const lcd = document.getElementById('lcd');
    expect(lcd.innerHTML).toContain('SubSetup'); // Title
    expect(lcd.innerHTML).toContain('Param'); // Sub NUM as statement
    expect(lcd.innerHTML).toContain('SubSub '); // Softkey with padding
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Rendered screen'), 'debug', 'renderScreen');
  });

  test('renderScreen generates correct HTML for NUM menu with value', () => {
    appState.currentKey = '10010011'; // NUM param menu
    appState.currentValues['10010011'] = '50'; // Value used
    const subs = [
      { type: 'NUM', position: '0', key: '10010011', parent: '10010001', statement: 'Param', tag: 'Prm', value: '50', min: '0', max: '100', step: '1' },
    ];
    const ascii = 'NUM 0 10010011 10010001 "Param" "Prm" 50 0 100 1';
    renderScreen(subs, ascii, mockLog);
    const lcd = document.getElementById('lcd');
    expect(lcd.innerHTML).toContain('Param'); // Title from statement
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Rendered screen'), 'debug', 'renderScreen');
  });

  // Add more tests: handleLcdClick for navigation, handleSelectChange for SET changes, handleParamClick for NUM editing, etc.
});