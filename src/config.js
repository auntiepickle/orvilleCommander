// config.js
import { log } from './logger.js';
import { STORAGE_KEY, DEFAULT_LOG_LEVEL } from './constants.js';

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
 * const cachedConfig = loadConfig(deviceIdInput, logLevelSelect, fetchBitmapCheckbox, updateBitmapOnChangeCheckbox, eagerLoadCheckbox);
 * if (cachedConfig) {
 *   // Use cached ports, etc.
 * }
 */
export function loadConfig(
  deviceIdInput,
  logLevelSelect,
  fetchBitmapCheckbox,
  updateBitmapOnChangeCheckbox,
  eagerLoadCheckbox
) {
  const config = localStorage.getItem(STORAGE_KEY);
  if (config) {
    let parsed;
    try {
      parsed = JSON.parse(config);
    } catch {
      log('Corrupt midiConfig in localStorage; ignoring cached config', 'error', 'error');
      return null;
    }
    deviceIdInput.value = parsed.deviceId || 0;
    logLevelSelect.value = parsed.logLevel || DEFAULT_LOG_LEVEL;
    fetchBitmapCheckbox.checked = parsed.fetchBitmap !== false;
    updateBitmapOnChangeCheckbox.checked = parsed.updateBitmapOnChange !== false;
    if (eagerLoadCheckbox) eagerLoadCheckbox.checked = parsed.eagerLoad !== false; // default on (#106)
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
 * saveConfig(outputSelect.value, inputSelect.value, parseInt(deviceIdInput.value, 10), logLevelSelect.value, getLogCategories(), fetchBitmapCheckbox.checked, updateBitmapOnChangeCheckbox.checked, appState.presetKey, eagerLoadCheckbox.checked);
 */
export function saveConfig(
  outputId,
  inputId,
  deviceId,
  logLevel,
  logCategories,
  fetchBitmap,
  updateBitmapOnChange,
  presetKey,
  eagerLoad
) {
  // Preserve keys other writers own (the theme editor persists via
  // saveThemeConfig) — a positional full save must not drop them.
  const existing = readStoredConfig();
  const config = {
    ...existing,
    outputId,
    inputId,
    deviceId,
    logLevel,
    logCategories,
    fetchBitmap,
    updateBitmapOnChange,
    presetKey,
    eagerLoad,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  log('Config saved to localStorage.', 'info', 'general');
}

/**
 * Persists the theme (preset + per-token overrides) into midiConfig
 * without touching the rest of the config — the theme editor saves on
 * every change, independent of the Save Config button.
 *
 * @param {{preset: string, overrides: Object}} theme
 */
export function saveThemeConfig(theme) {
  const existing = readStoredConfig();
  existing.theme = theme;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  log(`Theme saved: ${theme.preset}`, 'debug', 'general');
}

/**
 * Persists the synced preset library (#142) into midiConfig without
 * touching the rest — banks/programs change rarely, so the library lives
 * until the user re-syncs.
 *
 * @param {{banks: Object[], syncedAt: string}} library
 */
export function saveLibraryConfig(library) {
  const existing = readStoredConfig();
  existing.presetLibrary = library;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  log(`Preset library saved (${library.banks.length} banks)`, 'info', 'general');
}

// Stored config, tolerating corruption (review): the read-modify-write
// savers must remain the self-healing path — a corrupt midiConfig string
// becomes an empty object and the next save overwrites it, instead of
// every save (including each theme swatch drag) throwing.
function readStoredConfig() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
  } catch {
    log('Corrupt midiConfig in localStorage; starting fresh on next save', 'error', 'error');
    return {};
  }
}

/**
 * Merges a user's cached log-category preferences over the current defaults.
 *
 * Defaults supply the full key set; cached values override per category. This
 * is a merge, not a replace (A4): a category added to the defaults later is
 * present (at its default) for users with a pre-existing cache, instead of
 * being silently absent and treated as off by the logger.
 *
 * @param {Object} defaults - The default category map (constants.DEFAULT_LOG_CATEGORIES source of truth).
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
  localStorage.removeItem(STORAGE_KEY);
  log('Config cleared from localStorage.', 'info', 'general');
}
