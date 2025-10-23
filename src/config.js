// config.js

/**
 * Loads cached MIDI configuration from localStorage and applies it to UI elements.
 * If no config exists, returns null. Logs the loaded config for debugging.
 * 
 * @param {Function} log - The logging function to output info/debug messages.
 * @param {HTMLInputElement} deviceIdInput - Input element for device ID.
 * @param {HTMLSelectElement} logLevelSelect - Select element for log level.
 * @param {HTMLInputElement} fetchBitmapCheckbox - Checkbox for bitmap fetching.
 * @param {HTMLInputElement} updateBitmapOnChangeCheckbox - Checkbox for bitmap updates on change.
 * @returns {Object|null} The parsed config object if found, else null.
 * 
 * @example
 * // In main.js or similar
 * const cachedConfig = loadConfig(log, deviceIdInput, logLevelSelect, fetchBitmapCheckbox, updateBitmapOnChangeCheckbox);
 * if (cachedConfig) {
 *   // Use cached ports, etc.
 * }
 */
export function loadConfig(log, deviceIdInput, logLevelSelect, fetchBitmapCheckbox, updateBitmapOnChangeCheckbox) {
  const config = localStorage.getItem('midiConfig');
  if (config) {
    const parsed = JSON.parse(config);
    deviceIdInput.value = parsed.deviceId || 0;
    logLevelSelect.value = parsed.logLevel || 'info';
    fetchBitmapCheckbox.checked = parsed.fetchBitmap !== false;
    updateBitmapOnChangeCheckbox.checked = parsed.updateBitmapOnChange !== false;
    log(`Loaded cached config: Output ID ${parsed.outputId}, Input ID ${parsed.inputId}, Device ID ${parsed.deviceId}, Log Level ${parsed.logLevel}, Log Categories ${JSON.stringify(parsed.logCategories)}, Fetch Bitmap ${parsed.fetchBitmap}, Update Bitmap on Change ${parsed.updateBitmapOnChange}, Preset Key ${parsed.presetKey}`, 'info', 'general');
    return parsed;
  }
  return null;
}

/**
 * Saves MIDI configuration to localStorage as a JSON string.
 * Optionally logs the save action.
 * 
 * @param {string} outputId - MIDI output port ID.
 * @param {string} inputId - MIDI input port ID.
 * @param {number} deviceId - MIDI device ID (0-127).
 * @param {string} logLevel - Logging level (e.g., 'info', 'debug').
 * @param {Object} logCategories - Map of log categories to booleans (enabled/disabled).
 * @param {boolean} fetchBitmap - Flag to enable bitmap fetching.
 * @param {boolean} updateBitmapOnChange - Flag to update bitmap on changes.
 * @param {string} presetKey - Current preset key.
 * @param {Function} [log] - Optional logging function.
 * 
 * @example
 * // Save after user selects ports
 * saveConfig(outputSelect.value, inputSelect.value, parseInt(deviceIdInput.value, 10), logLevelSelect.value, appState.logCategories, fetchBitmapCheckbox.checked, updateBitmapOnChangeCheckbox.checked, appState.presetKey, log);
 */
export function saveConfig(outputId, inputId, deviceId, logLevel, logCategories, fetchBitmap, updateBitmapOnChange, presetKey, log) {
  const config = { outputId, inputId, deviceId, logLevel, logCategories, fetchBitmap, updateBitmapOnChange, presetKey };
  localStorage.setItem('midiConfig', JSON.stringify(config));
  if (log) log('Config saved to localStorage.', 'info', 'general');
}

/**
 * Clears the MIDI configuration from localStorage.
 * Optionally logs the clear action.
 * 
 * @param {Function} [log] - Optional logging function.
 * 
 * @example
 * // On clear button click
 * clearConfig(log);
 */
export function clearConfig(log) {
  localStorage.removeItem('midiConfig');
  if (log) log('Config cleared from localStorage.', 'info', 'general');
}