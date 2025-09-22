// config.js
export function loadConfig(log, deviceIdInput) {
  const config = JSON.parse(localStorage.getItem('orvilleConfig'));
  if (config) {
    log('Loaded cached config: Output ID ' + config.outputId + ', Input ID ' + config.inputId + ', Device ID ' + config.deviceId);
    deviceIdInput.value = config.deviceId;
  } else {
    deviceIdInput.value = 0;
  }
  return config;
}

export function saveConfig(outputId, inputId, deviceId, log) {
  const config = { outputId, inputId, deviceId };
  localStorage.setItem('orvilleConfig', JSON.stringify(config));
  log('Saved config to localStorage.');
}

export function clearConfig(outputSelect, inputSelect, deviceIdInput, log) {
  localStorage.removeItem('orvilleConfig');
  outputSelect.value = '';
  inputSelect.value = '';
  deviceIdInput.value = 0;
  log('Cleared cached config and reset selections.');
}