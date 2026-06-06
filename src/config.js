// config.js
import { log } from './logger.js';

/**
 * Loads cached MIDI configuration from localStorage and applies it to UI elements.
 * If no config exists, returns null. Logs the loaded config for debugging.
 *
 * @param {HTMLInputElement} deviceIdInput - Input element for device ID.
 * @param {HTMLSelectElement} logLevelSelect - Select element for log level.
 * @param {HTMLInputElement} fetchBitmapCheckbox - Checkbox for bitmap fetching.
 * @param {HTMLInputElement} updateBitmapOnChangeCheckbox - Checkbox for bitmap updates on change.
 * @returns {Object|null} The parsed config object if found, else null.
 *
 * @example
 * // In main.js or similar
 * const cachedConfig = loadConfig(deviceIdInput, logLevelSelect, fetchBitmapCheckbox, updateBitmapOnChangeCheckbox);
 * if (cachedConfig) {
 *   // Use cached ports, etc.
 * }
 */
export function loadConfig(
  deviceIdInput,
  logLevelSelect,
  fetchBitmapCheckbox,
  updateBitmapOnChangeCheckbox
) {
  const config = localStorage.getItem('midiConfig');
  if (config) {
    const parsed = JSON.parse(config);
    deviceIdInput.value = parsed.deviceId || 0;
    logLevelSelect.value = parsed.logLevel || 'info';
    fetchBitmapCheckbox.checked = parsed.fetchBitmap !== false;
    updateBitmapOnChangeCheckbox.checked = parsed.updateBitmapOnChange !== false;
    log(
      `Loaded cached config: Output ID ${parsed.outputId}, Input ID ${parsed.inputId}, Device ID ${parsed.deviceId}, Log Level ${parsed.logLevel}, Log Categories ${JSON.stringify(parsed.logCategories)}, Fetch Bitmap ${parsed.fetchBitmap}, Update Bitmap on Change ${parsed.updateBitmapOnChange}, Preset Key ${parsed.presetKey}`,
      'info',
      'general'
    );
    return parsed;
  }
  return null;
}

/**
 * Saves MIDI configuration to localStorage as a JSON string.
 *
 * @param {string} outputId - MIDI output port ID.
 * @param {string} inputId - MIDI input port ID.
 * @param {number} deviceId - MIDI device ID (0-127).
 * @param {string} logLevel - Logging level (e.g., 'info', 'debug').
 * @param {Object} logCategories - Map of log categories to booleans (enabled/disabled).
 * @param {boolean} fetchBitmap - Flag to enable bitmap fetching.
 * @param {boolean} updateBitmapOnChange - Flag to update bitmap on changes.
 * @param {string} presetKey - Current preset key.
 *
 * @example
 * // Save after user selects ports
 * saveConfig(outputSelect.value, inputSelect.value, parseInt(deviceIdInput.value, 10), logLevelSelect.value, appState.logCategories, fetchBitmapCheckbox.checked, updateBitmapOnChangeCheckbox.checked, appState.presetKey);
 */
export function saveConfig(
  outputId,
  inputId,
  deviceId,
  logLevel,
  logCategories,
  fetchBitmap,
  updateBitmapOnChange,
  presetKey
) {
  const config = {
    outputId,
    inputId,
    deviceId,
    logLevel,
    logCategories,
    fetchBitmap,
    updateBitmapOnChange,
    presetKey,
  };
  localStorage.setItem('midiConfig', JSON.stringify(config));
  log('Config saved to localStorage.', 'info', 'general');
}

/**
 * Merges a user's cached log-category preferences over the current defaults.
 *
 * Defaults supply the full key set; cached values override per category. This
 * is a merge, not a replace (A4): a category added to the defaults later is
 * present (at its default) for users with a pre-existing cache, instead of
 * being silently absent and treated as off by the logger.
 *
 * @param {Object} defaults - The default category map (store.js source of truth).
 * @param {Object} [cached] - The cached category map from localStorage, if any.
 * @returns {Object} The merged category map.
 */
export function mergeLogCategories(defaults, cached) {
  return { ...defaults, ...(cached || {}) };
}

/**
 * Clears the MIDI configuration from localStorage.
 *
 * @example
 * // On clear button click
 * clearConfig();
 */
export function clearConfig() {
  localStorage.removeItem('midiConfig');
  log('Config cleared from localStorage.', 'info', 'general');
}
