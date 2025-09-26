// main.js
import { WebMidi } from 'webmidi';
import { loadConfig, saveConfig, clearConfig } from './config.js';
import { setupKeypressControls, testKeypress } from './controls.js';
import { setMidiPorts, addSysexListener, sendSysEx, sendValueDump, sendValuePut } from './midi.js';
import { updateScreen } from './renderer.js';
import { appState } from './state.js';
import { denibble, renderBitmap, extractNibbles, exportBMP } from './parser.js'; // Updated imports

const lcdEl = document.getElementById('lcd');
const logArea = document.getElementById('log-area');
const connectBtn = document.getElementById('connect');
const outputSelect = document.getElementById('output-select');
const inputSelect = document.getElementById('input-select');
const deviceIdInput = document.getElementById('device-id');
const logLevelSelect = document.getElementById('log-level');
const logCategoriesJson = document.getElementById('log-categories-json');
const applyLogCategoriesBtn = document.getElementById('apply-log-categories');
const fetchBitmapCheckbox = document.getElementById('fetch-bitmap');
const updateBitmapOnChangeCheckbox = document.getElementById('update-bitmap-on-change');
const selectPortsBtn = document.getElementById('select-ports');
const saveConfigBtn = document.getElementById('save-config');
const clearConfigBtn = document.getElementById('clear-config');
const keyInput = document.getElementById('key-input');
const sendRequestBtn = document.getElementById('send-request');
const getValueBtn = document.getElementById('get-value');
const setValueInput = document.getElementById('set-value-input');
const setValueBtn = document.getElementById('set-value');
const backBtn = document.getElementById('back-btn');
const pollToggle = document.getElementById('poll-toggle');
const customSysexInput = document.getElementById('custom-sysex');
const sendCustomBtn = document.getElementById('send-custom');
const copyLogBtn = document.getElementById('copy-log');
const testKeypressBtn = document.getElementById('test-keypress');
const syncBtn = document.getElementById('sync-btn');
const getScreenBtn = document.getElementById('get-screen-btn');
const uploadDebugFile = document.getElementById('upload-debug-file');
const processDebugFileBtn = document.getElementById('process-debug-file');
const exportConfigBtn = document.getElementById('export-config');
const importConfigInput = document.getElementById('import-config');
const importConfigBtn = document.getElementById('import-config-btn');
const testTRateBtn = document.getElementById('test-t-rate');

let pollInterval = null;
let isPolling = false;
const levels = { error: 0, info: 1, debug: 2 };

function log(message, level = 'info', category = 'general') {
  if (levels[appState.logLevel] < levels[level] || !appState.logCategories[category]) return;
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${message}\n`;
  logArea.value += entry;
  logArea.scrollTop = logArea.scrollHeight;
  console.log(entry);
}

copyLogBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(logArea.value).then(() => log('Log copied to clipboard.', 'info', 'general'));
});

async function connectMidi(cachedConfig = null) {
  try {
    await WebMidi.enable({ sysex: true });
    log('WebMidi enabled.', 'info', 'general');
    outputSelect.innerHTML = '';
    WebMidi.outputs.forEach(output => {
      const option = document.createElement('option');
      option.value = output.id;
      option.textContent = output.name;
      if (cachedConfig && output.id === cachedConfig.outputId) option.selected = true;
      outputSelect.appendChild(option);
    });
    inputSelect.innerHTML = '';
    WebMidi.inputs.forEach(input => {
      const option = document.createElement('option');
      option.value = input.id;
      option.textContent = input.name;
      if (cachedConfig && input.id === cachedConfig.inputId) option.selected = true;
      inputSelect.appendChild(option);
    });
    log('Ports populated. Choose and click "Select Ports". If cached, already pre-selected.', 'info', 'general');
    if (cachedConfig && cachedConfig.outputId && cachedConfig.inputId) {
      selectPorts();
    }
  } catch (err) {
    log(`Error: ${err}`, 'error', 'error');
  }
}

function selectPorts() {
  const outputId = outputSelect.value;
  const inputId = inputSelect.value;
  const devId = parseInt(deviceIdInput.value, 10);
  setMidiPorts(WebMidi.getOutputById(outputId), WebMidi.getInputById(inputId), devId);
  addSysexListener(log);
  log('Ports selected and listener added. Device ID set to ' + devId, 'info', 'general');
  lcdEl.innerText = 'Connected. Fetching root screen...';
  updateScreen(log);
  // Fetch screen after connecting if enabled
  if (appState.fetchBitmap) {
    sendSysEx(0x18, [], log);
    log('Fetched initial screen after connecting.', 'info', 'general');
  } else {
    log('Bitmap fetch disabled; skipped initial screen dump.', 'info', 'bitmap');
  }
}

connectBtn.addEventListener('click', () => connectMidi());

selectPortsBtn.addEventListener('click', selectPorts);

saveConfigBtn.addEventListener('click', () => {
  saveConfig(outputSelect.value, inputSelect.value, parseInt(deviceIdInput.value, 10), logLevelSelect.value, appState.logCategories, fetchBitmapCheckbox.checked, updateBitmapOnChangeCheckbox.checked, log);
  appState.logLevel = logLevelSelect.value;
});

clearConfigBtn.addEventListener('click', () => {
  clearConfig(outputSelect, inputSelect, deviceIdInput, logLevelSelect, fetchBitmapCheckbox, updateBitmapOnChangeCheckbox, log);
  appState.logLevel = 'info';
  appState.logCategories = Object.fromEntries(Object.keys(appState.logCategories).map(k => [k, true]));
  appState.fetchBitmap = true;
  appState.updateBitmapOnChange = true;
});

logLevelSelect.addEventListener('change', () => {
  appState.logLevel = logLevelSelect.value;
  log(`Log level changed to ${appState.logLevel}.`, 'info', 'general');
});

applyLogCategoriesBtn.addEventListener('click', () => {
  try {
    const json = logCategoriesJson.value;
    const newCategories = JSON.parse(json);
    appState.logCategories = { ...appState.logCategories, ...newCategories };
    saveConfig(outputSelect.value || '', inputSelect.value || '', parseInt(deviceIdInput.value, 10) || 0, appState.logLevel, appState.logCategories, appState.fetchBitmap, appState.updateBitmapOnChange, log);
    log('Applied and saved log categories: ' + JSON.stringify(appState.logCategories), 'info', 'general');
  } catch (err) {
    log(`Error applying log categories: ${err}`, 'error', 'error');
  }
});

fetchBitmapCheckbox.addEventListener('change', () => {
  appState.fetchBitmap = fetchBitmapCheckbox.checked;
  saveConfig(outputSelect.value || '', inputSelect.value || '', parseInt(deviceIdInput.value, 10) || 0, appState.logLevel, appState.logCategories, appState.fetchBitmap, appState.updateBitmapOnChange, log);
  log(`Bitmap fetch ${appState.fetchBitmap ? 'enabled' : 'disabled'}.`, 'info', 'general');
  if (!appState.fetchBitmap) {
    const canvas = document.getElementById('lcd-canvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  } else {
    updateScreen(log); // Refetch if enabled
  }
});

updateBitmapOnChangeCheckbox.addEventListener('change', () => {
  appState.updateBitmapOnChange = updateBitmapOnChangeCheckbox.checked;
  saveConfig(outputSelect.value || '', inputSelect.value || '', parseInt(deviceIdInput.value, 10) || 0, appState.logLevel, appState.logCategories, appState.fetchBitmap, appState.updateBitmapOnChange, log);
  log(`Update Bitmap on Virtual Change ${appState.updateBitmapOnChange ? 'enabled' : 'disabled'}.`, 'info', 'general');
});

exportConfigBtn.addEventListener('click', () => {
  const configStr = localStorage.getItem('orvilleConfig');
  if (configStr) {
    const blob = new Blob([configStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'orvilleConfig.json';
    a.click();
    URL.revokeObjectURL(url);
    log('Config exported to file.', 'info', 'general');
  } else {
    log('No config to export.', 'info', 'general');
  }
});

importConfigBtn.addEventListener('click', () => {
  const file = importConfigInput.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const config = JSON.parse(e.target.result);
        localStorage.setItem('orvilleConfig', JSON.stringify(config));
        loadConfig(log, deviceIdInput, logLevelSelect, fetchBitmapCheckbox, updateBitmapOnChangeCheckbox);
        appState.logLevel = config.logLevel || 'info';
        appState.logCategories = config.logCategories || Object.fromEntries(Object.keys(appState.logCategories).map(k => [k, true]));
        appState.fetchBitmap = config.fetchBitmap !== false;
        fetchBitmapCheckbox.checked = appState.fetchBitmap;
        appState.updateBitmapOnChange = config.updateBitmapOnChange !== false;
        updateBitmapOnChangeCheckbox.checked = appState.updateBitmapOnChange;
        log('Config imported from file.', 'info', 'general');
        // Re-connect with new config
        connectMidi(config);
      } catch (err) {
        log(`Error importing config: ${err}`, 'error', 'error');
      }
    };
    reader.readAsText(file);
  } else {
    log('No file selected for import.', 'info', 'general');
  }
});

sendRequestBtn.addEventListener('click', () => {
  appState.currentKey = keyInput.value;
  updateScreen(log);
  log(`Requested object info for key ${appState.currentKey}`, 'info', 'general');
});

getValueBtn.addEventListener('click', () => {
  sendValueDump(appState.currentKey, log);
});

setValueBtn.addEventListener('click', () => {
  const value = setValueInput.value;
  sendValuePut(appState.currentKey, value, log);
  if (appState.updateBitmapOnChange) {
    setTimeout(() => {
      sendSysEx(0x18, [], log);
      log('Triggered bitmap update after value change.', 'debug', 'bitmap');
    }, 200); // Delay to allow device update
  }
});

backBtn.addEventListener('click', () => {
  if (appState.keyStack.length > 0) {
    appState.currentKey = appState.keyStack.pop();
    appState.paramOffset = 0;
    appState.autoNavigated = false;
    updateScreen(log);
    log(`Back to key ${appState.currentKey}`, 'info', 'general');
  }
});

pollToggle.addEventListener('click', () => {
  isPolling = !isPolling;
  if (isPolling) {
    pollInterval = setInterval(() => updateScreen(log), 500);
    log('Polling started.', 'info', 'general');
    pollToggle.innerText = 'Stop Polling';
  } else {
    clearInterval(pollInterval);
    log('Polling stopped.', 'info', 'general');
    pollToggle.innerText = 'Start Polling';
  }
});

sendCustomBtn.addEventListener('click', () => {
  const hex = customSysexInput.value.replace(/\s/g, '');
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16));
  }
  sendSysEx(bytes[0], bytes.slice(1), log);
});

testKeypressBtn.addEventListener('click', () => {
  testKeypress(log);
});

syncBtn.addEventListener('click', () => {
  appState.currentKey = '0';
  updateScreen(log);
  log('Synced to root', 'info', 'general');
});

getScreenBtn.addEventListener('click', () => {
  if (appState.fetchBitmap) {
    sendSysEx(0x18, [], log);
    log('Sent Get Screen request (0x18)', 'info', 'general');
  } else {
    log('Bitmap fetch disabled; skipped Get Screen request.', 'info', 'bitmap');
  }
});

// Handle file upload and processing
processDebugFileBtn.addEventListener('click', () => {
  const file = uploadDebugFile.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function(e) {
      const content = e.target.result.toLowerCase();
      const hexPattern = /[0-9a-f]{1,2}/g;
      const hexMatches = content.match(hexPattern);
      if (hexMatches) {
        const startIdx = hexMatches.indexOf('17') + 1;
        const endIdx = hexMatches.indexOf('f7', startIdx) || hexMatches.length;
        const nibblesStr = hexMatches.slice(startIdx, endIdx);
        const nibbles = nibblesStr.map(h => parseInt(h, 16));
        log(`[LOG] Extracted ${nibbles.length} nibbles from uploaded file`, 'debug', 'general');
        const rawBytes = denibble(nibbles);
        log(`[LOG] Denibbled to ${rawBytes.length} bytes`, 'debug', 'general');
        renderBitmap('lcd-canvas', rawBytes, log);
      } else {
        log('[ERROR] No hex data found in file', 'error', 'error');
      }
    };
    reader.readAsText(file);
  } else {
    log('[ERROR] No file uploaded', 'error', 'error');
  }
});

// Function to show loading indicator
function showLoading() {
  const canvas = document.getElementById('lcd-canvas');
  if (canvas) {
    canvas.classList.add('loading');
  }
  log('Loading new screen...', 'debug', 'general');
}

// Function to hide loading indicator
function hideLoading() {
  const canvas = document.getElementById('lcd-canvas');
  if (canvas) {
    canvas.classList.remove('loading');
  }
  log('Screen loaded.', 'debug', 'general');
}

// New testing feature
if (testTRateBtn) {
  testTRateBtn.addEventListener('click', async () => {
    log('Starting t_rate test...', 'info', 'general');
    // Navigate to Auto Tape Flanger
    appState.currentKey = '801000b';
    updateScreen(log);
    await new Promise(r => setTimeout(r, 1000));
    log('Navigated to Auto Tape Flanger', 'info', 'general');
    // Navigate to delay parameters
    appState.currentKey = '8040001';
    updateScreen(log);
    await new Promise(r => setTimeout(r, 1000));
    log('Navigated to delay parameters', 'info', 'general');

    // Get the SET sub for t_rate
    const setSub = appState.currentSubs.find(s => s.type === 'SET' && s.key === '8060001');
    if (!setSub) {
      log('Test failed: t_rate SET not found', 'error', 'error');
      return;
    }
    log('Found t_rate with options: ' + setSub.options.length, 'info', 'general');
    for (let opt of setSub.options) { // Test all, but can limit if too long
      log(`Testing option: ${opt.index} ${opt.desc}`, 'info', 'general');
      sendValuePut('8060001', opt.index, log);
      await new Promise(r => setTimeout(r, 500));
      sendValueDump('8060001', log);
      await new Promise(r => setTimeout(r, 500));
      const currentValue = appState.currentValues['8060001'];
      const expected = `${opt.index} ${opt.desc}`;
      if (currentValue === expected) {
        log('Value match', 'info', 'general');
      } else {
        log(`Value mismatch: expected ${expected}, got ${currentValue}`, 'error', 'error');
      }
      // Check UI
      const select = document.querySelector(`select[data-key="8060001"]`);
      if (select) {
        const selectedValue = select.value;
        const selectedText = select.options[select.selectedIndex].text;
        if (selectedValue === opt.index && selectedText === opt.desc) {
          log('UI match', 'info', 'general');
        } else {
          log(`UI mismatch: selected value ${selectedValue}, text ${selectedText}, expected ${opt.index} ${opt.desc}`, 'error', 'error');
        }
      } else {
        log('Select not found in UI', 'error', 'error');
      }
    }
    log('t_rate test complete', 'info', 'general');
  });
}

setupKeypressControls(log);

const cachedConfig = loadConfig(log, deviceIdInput, logLevelSelect, fetchBitmapCheckbox, updateBitmapOnChangeCheckbox);
appState.logLevel = logLevelSelect.value;
appState.logCategories = cachedConfig?.logCategories || Object.fromEntries(Object.keys(appState.logCategories).map(k => [k, true]));
appState.fetchBitmap = fetchBitmapCheckbox.checked;
appState.updateBitmapOnChange = updateBitmapOnChangeCheckbox.checked;
connectMidi(cachedConfig);