// config.js
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

export function saveConfig(outputId, inputId, deviceId, logLevel, logCategories, fetchBitmap, updateBitmapOnChange, presetKey, log) {
  const config = { outputId, inputId, deviceId, logLevel, logCategories, fetchBitmap, updateBitmapOnChange, presetKey };
  localStorage.setItem('midiConfig', JSON.stringify(config));
  if (log) log('Config saved to localStorage.', 'info', 'general');
}

export function clearConfig(log) {
  localStorage.removeItem('midiConfig');
  if (log) log('Config cleared from localStorage.', 'info', 'general');
}