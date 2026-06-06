// tests/config.test.js
// Covers the localStorage load/save/clear round trip and loadConfig's defaulting.

jest.mock('../src/logger.js', () => ({
  log: jest.fn(),
}));

import { loadConfig, saveConfig, clearConfig } from '../src/config.js';

// Minimal stand-ins for the DOM elements loadConfig writes into.
const makeUi = () => ({
  deviceIdInput: { value: '' },
  logLevelSelect: { value: '' },
  fetchBitmapCheckbox: { checked: null },
  updateBitmapOnChangeCheckbox: { checked: null },
});

describe('config', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('saveConfig then loadConfig round-trips the values and applies them to the UI', () => {
    saveConfig('out-1', 'in-1', 5, 'debug', { sysexSent: true }, true, false, '801000b');
    const ui = makeUi();
    const parsed = loadConfig(
      ui.deviceIdInput,
      ui.logLevelSelect,
      ui.fetchBitmapCheckbox,
      ui.updateBitmapOnChangeCheckbox
    );

    expect(parsed).toMatchObject({
      outputId: 'out-1',
      inputId: 'in-1',
      deviceId: 5,
      logLevel: 'debug',
      logCategories: { sysexSent: true },
      fetchBitmap: true,
      updateBitmapOnChange: false,
      presetKey: '801000b',
    });
    expect(ui.deviceIdInput.value).toBe(5);
    expect(ui.logLevelSelect.value).toBe('debug');
    expect(ui.fetchBitmapCheckbox.checked).toBe(true);
    expect(ui.updateBitmapOnChangeCheckbox.checked).toBe(false);
  });

  test('loadConfig returns null when nothing is stored', () => {
    const ui = makeUi();
    expect(
      loadConfig(
        ui.deviceIdInput,
        ui.logLevelSelect,
        ui.fetchBitmapCheckbox,
        ui.updateBitmapOnChangeCheckbox
      )
    ).toBeNull();
  });

  test('loadConfig applies defaults for missing fields', () => {
    localStorage.setItem('midiConfig', JSON.stringify({ outputId: 'out' }));
    const ui = makeUi();
    loadConfig(
      ui.deviceIdInput,
      ui.logLevelSelect,
      ui.fetchBitmapCheckbox,
      ui.updateBitmapOnChangeCheckbox
    );
    expect(ui.deviceIdInput.value).toBe(0);
    expect(ui.logLevelSelect.value).toBe('info');
    // Absent flags default to checked (only an explicit false unchecks them).
    expect(ui.fetchBitmapCheckbox.checked).toBe(true);
    expect(ui.updateBitmapOnChangeCheckbox.checked).toBe(true);
  });

  test('clearConfig removes the stored config', () => {
    saveConfig('o', 'i', 0, 'info', {}, true, true, '401000b');
    expect(localStorage.getItem('midiConfig')).not.toBeNull();
    clearConfig();
    expect(localStorage.getItem('midiConfig')).toBeNull();
  });
});
