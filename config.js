// config.js
export function loadConfig(log, deviceIdInput, logLevelSelect, fetchBitmapCheckbox, updateBitmapOnChangeCheckbox) {
  const configStr = localStorage.getItem('orvilleConfig');
  const config = configStr ? JSON.parse(configStr) : null;
  if (config) {
    log('Loaded cached config: Output ID ' + config.outputId + ', Input ID ' + config.inputId + ', Device ID ' + config.deviceId + ', Log Level ' + config.logLevel + ', Log Categories ' + JSON.stringify(config.logCategories) + ', Fetch Bitmap ' + config.fetchBitmap + ', Update Bitmap on Change ' + config.updateBitmapOnChange, 'info');
    deviceIdInput.value = config.deviceId || 0;
    logLevelSelect.value = config.logLevel || 'info';
    fetchBitmapCheckbox.checked = config.fetchBitmap !== false;
    updateBitmapOnChangeCheckbox.checked = config.updateBitmapOnChange !== false; // Default true if missing
  } else {
    deviceIdInput.value = 0;
    logLevelSelect.value = 'info';
    fetchBitmapCheckbox.checked = true;
    updateBitmapOnChangeCheckbox.checked = true;
  }
  return config;
}

export function saveConfig(outputId, inputId, deviceId, logLevel, logCategories, fetchBitmap, updateBitmapOnChange, log) {
  const config = { outputId, inputId, deviceId, logLevel, logCategories, fetchBitmap, updateBitmapOnChange };
  localStorage.setItem('orvilleConfig', JSON.stringify(config));
  log('Saved config to localStorage.', 'info');
}

export function clearConfig(outputSelect, inputSelect, deviceIdInput, logLevelSelect, fetchBitmapCheckbox, updateBitmapOnChangeCheckbox, log) {
  localStorage.removeItem('orvilleConfig');
  outputSelect.value = '';
  inputSelect.value = '';
  deviceIdInput.value = 0;
  logLevelSelect.value = 'info';
  fetchBitmapCheckbox.checked = true;
  updateBitmapOnChangeCheckbox.checked = true;
  log('Cleared cached config and reset selections.', 'info');
}