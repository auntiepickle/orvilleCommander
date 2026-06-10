// main.js
import { WebMidi } from 'webmidi';
import { CMD, KEY } from './sysex-commands.js';
import { TIMING, DEFAULT_LOG_CATEGORIES } from './constants.js';
import { loadConfig, saveConfig, clearConfig, mergeLogCategories } from './config.js';
import { setupKeypressControls, testKeypress } from './controls.js';
import {
  setMidiPorts,
  addSysexListener,
  sendSysEx,
  sendValueDump,
  sendValuePut,
  sendObjectInfoDump,
} from './midi.js';
import { updateScreen } from './renderer.js';
import { toggleDspKey, makeKeyStackEntry } from './navigation.js';
import { appState } from './state.js';
import { setState } from './store.js';
import { denibble, renderBitmap } from './bitmap.js';
import { log, setLogLevel, setLogCategories, getLogCategories } from './logger.js';
import { registerEventBridge } from './event-bridge.js';
import { extractNibblesFromHex } from './hex-extract.js';

const lcdEl = document.getElementById('lcd');
const logArea = document.getElementById('log-area');
const connectBtn = document.getElementById('connect');
const outputSelect = document.getElementById('output-select');
const inputSelect = document.getElementById('input-select');
const deviceIdInput = document.getElementById('device-id');
const logLevelSelect = document.getElementById('log-level');
const fetchBitmapCheckbox = document.getElementById('fetch-bitmap');
const updateBitmapOnChangeCheckbox = document.getElementById('update-bitmap-on-change');
const selectPortsBtn = document.getElementById('select-ports');
const saveConfigBtn = document.getElementById('save-config');
const clearConfigBtn = document.getElementById('clear-config');
const pollToggle = document.getElementById('poll-toggle');
const customSysexInput = document.getElementById('custom-sysex');
const sendCustomBtn = document.getElementById('send-custom');
const copyLogBtn = document.getElementById('copy-log');
const testKeypressBtn = document.getElementById('test-keypress');
const syncBtn = document.getElementById('sync-btn');
const getScreenBtn = document.getElementById('get-screen-btn');
const uploadDebugFile = document.getElementById('upload-debug-file');
const processDebugFileBtn = document.getElementById('process-debug-file');
const testTRateBtn = document.getElementById('test-t-rate');

let pollInterval = null;
let isPolling = false;
const toggleMeterPollingBtn = document.getElementById('toggle-meter-polling');
const pollingIndicator = document.getElementById('polling-indicator');
let pollingInterval = null;

/**
 * Starts polling for CON-type subs (e.g., meters) by requesting VALUE_DUMP at intervals.
 * Clears any existing interval before starting.
 */
function startPolling() {
  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = setInterval(() => {
    const conSubs = appState.currentSubs.filter((s) => s.type === 'CON');
    conSubs.forEach((sub) => {
      const key = sub.key;
      sendValueDump(key);
    });
  }, TIMING.METER_POLL_MS);
}

/**
 * Stops the active polling interval if running.
 */
function stopPolling() {
  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = null;
}

if (toggleMeterPollingBtn) {
  toggleMeterPollingBtn.addEventListener('click', () => {
    setState({ pollingEnabled: !appState.pollingEnabled }, 'main:polling-toggle');
    pollingIndicator.style.display = appState.pollingEnabled ? 'inline' : 'none';
    if (appState.pollingEnabled) {
      startPolling();
    } else {
      stopPolling();
    }
    log(`Meter polling ${appState.pollingEnabled ? 'enabled' : 'disabled'}`, 'info', 'general');
  });
}

copyLogBtn.addEventListener('click', () => {
  navigator.clipboard
    .writeText(logArea.value)
    .then(() => log('Log copied to clipboard.', 'info', 'general'));
});

/**
 * Enables WebMIDI, populates input/output select options, and auto-selects ports if cached.
 * If cached ports are available, calls selectPorts automatically.
 *
 * @param {Object} [cachedConfig=null] - Cached config from localStorage.
 *
 * @example
 * connectMidi(cachedConfig);
 */
async function connectMidi(cachedConfig = null) {
  try {
    await WebMidi.enable({ sysex: true });
    log('WebMidi enabled.', 'info', 'general');
    outputSelect.innerHTML = '';
    WebMidi.outputs.forEach((output) => {
      const option = document.createElement('option');
      option.value = output.id;
      option.textContent = output.name;
      if (cachedConfig && output.id === cachedConfig.outputId) option.selected = true;
      outputSelect.appendChild(option);
    });
    inputSelect.innerHTML = '';
    WebMidi.inputs.forEach((input) => {
      const option = document.createElement('option');
      option.value = input.id;
      option.textContent = input.name;
      if (cachedConfig && input.id === cachedConfig.inputId) option.selected = true;
      inputSelect.appendChild(option);
    });
    log(
      'Ports populated. Choose and click "Select Ports". If cached, already pre-selected.',
      'info',
      'general'
    );
    if (cachedConfig && cachedConfig.outputId && cachedConfig.inputId) {
      selectPorts();
    }
  } catch (err) {
    log(`Error: ${err}`, 'error', 'error');
  }
}

/**
 * Sets MIDI ports based on selected values, adds SysEx listener, and initializes the screen.
 * Fetches root and initial preset data with optional bitmap.
 */
function selectPorts() {
  const outputId = outputSelect.value;
  const inputId = inputSelect.value;
  const devId = parseInt(deviceIdInput.value, 10);
  setMidiPorts(WebMidi.getOutputById(outputId), WebMidi.getInputById(inputId), devId);
  addSysexListener();
  log('Ports selected and listener added. Device ID set to ' + devId, 'info', 'general');
  lcdEl.innerText = 'Connected. Fetching root screen...';
  updateScreen(log);
  setTimeout(() => {
    setState(
      {
        keyStack: [
          ...appState.keyStack,
          makeKeyStackEntry(appState.currentKey, appState.currentSubs),
        ],
        currentKey: appState.presetKey,
        autoLoad: true,
      },
      'main:select-ports-init'
    );
    updateScreen(log);
    sendObjectInfoDump(toggleDspKey(appState.presetKey));
    if (appState.fetchBitmap) {
      sendSysEx(CMD.GET_SCREEN, []);
      log('Fetched initial preset screen.', 'info', 'general');
    } else {
      log('Bitmap fetch disabled; skipped initial preset screen dump.', 'info', 'bitmap');
    }
  }, TIMING.PORT_INIT_MS);
}

connectBtn.addEventListener('click', () => connectMidi());

selectPortsBtn.addEventListener('click', selectPorts);

saveConfigBtn.addEventListener('click', () => {
  saveConfig(
    outputSelect.value,
    inputSelect.value,
    parseInt(deviceIdInput.value, 10),
    logLevelSelect.value,
    getLogCategories(),
    fetchBitmapCheckbox.checked,
    updateBitmapOnChangeCheckbox.checked,
    appState.presetKey
  );
  setLogLevel(logLevelSelect.value);
});

clearConfigBtn.addEventListener('click', () => {
  clearConfig();
});

pollToggle.addEventListener('click', () => {
  isPolling = !isPolling;
  if (isPolling) {
    pollInterval = setInterval(() => updateScreen(log), TIMING.POLL_INTERVAL_MS);
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
  sendSysEx(bytes[0], bytes.slice(1));
});

testKeypressBtn.addEventListener('click', () => {
  testKeypress();
});

syncBtn.addEventListener('click', () => {
  setState({ currentKey: KEY.ROOT }, 'main:sync-root');
  updateScreen(log);
  log('Synced to root', 'info', 'general');
});

getScreenBtn.addEventListener('click', () => {
  if (appState.fetchBitmap) {
    sendSysEx(CMD.GET_SCREEN, []);
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
    reader.onload = function (e) {
      const nibbles = extractNibblesFromHex(e.target.result);
      if (nibbles) {
        log(`[LOG] Extracted ${nibbles.length} nibbles from uploaded file`, 'debug', 'general');
        const rawBytes = denibble(nibbles);
        log(`[LOG] Denibbled to ${rawBytes.length} bytes`, 'debug', 'general');
        renderBitmap('lcd-canvas', rawBytes);
      } else {
        log('[ERROR] No hex data found in file', 'error', 'error');
      }
    };
    reader.readAsText(file);
  } else {
    log('[ERROR] No file uploaded', 'error', 'error');
  }
});

/**
 * Shows a loading indicator on the LCD element during async operations.
 */
export function showLoading() {
  if (lcdEl) {
    lcdEl.classList.add('loading');
  }
  log('Loading new screen...', 'debug', 'general');
}

/**
 * Hides the loading indicator on the LCD element after operations complete.
 */
export function hideLoading() {
  if (lcdEl) {
    lcdEl.classList.remove('loading');
  }
  log('Screen loaded.', 'debug', 'general');
}

registerEventBridge({ hideLoading });

// New testing feature
if (testTRateBtn) {
  testTRateBtn.addEventListener('click', async () => {
    log('Starting t_rate test...', 'info', 'general');
    // Navigate to Auto Tape Flanger
    setState({ currentKey: KEY.DSP_B_PRESET }, 'main:test-trate-nav');
    updateScreen(log);
    await new Promise((r) => setTimeout(r, TIMING.SYNC_STEP_MS));
    log('Navigated to Auto Tape Flanger', 'info', 'general');
    // Navigate to delay parameters
    setState({ currentKey: KEY.DELAY_PARAMS }, 'main:test-trate-nav');
    updateScreen(log);
    await new Promise((r) => setTimeout(r, TIMING.SYNC_STEP_MS));
    log('Navigated to delay parameters', 'info', 'general');

    // Get the SET sub for t_rate
    const setSub = appState.currentSubs.find((s) => s.type === 'SET' && s.key === KEY.T_RATE);
    if (!setSub) {
      log('Test failed: t_rate SET not found', 'error', 'error');
      return;
    }
    log('Found t_rate with options: ' + setSub.options.length, 'info', 'general');
    for (let opt of setSub.options) {
      // Test all, but can limit if too long
      log(`Testing option: ${opt.index} ${opt.desc}`, 'info', 'general');
      sendValuePut(KEY.T_RATE, opt.index);
      await new Promise((r) => setTimeout(r, TIMING.DEVICE_LOAD_MS));
      sendValueDump(KEY.T_RATE);
      await new Promise((r) => setTimeout(r, TIMING.DEVICE_LOAD_MS));
      const currentValue = appState.currentValues[KEY.T_RATE];
      const expected = `${opt.index} ${opt.desc}`;
      if (currentValue === expected) {
        log('Value match', 'info', 'general');
      } else {
        log(`Value mismatch: expected ${expected}, got ${currentValue}`, 'error', 'error');
      }
      // Check UI
      const select = document.querySelector(`select[data-key="${KEY.T_RATE}"]`);
      if (select) {
        const selectedValue = select.value;
        const selectedText = select.options[select.selectedIndex].text;
        if (selectedValue === opt.index && selectedText === opt.desc) {
          log('UI match', 'info', 'general');
        } else {
          log(
            `UI mismatch: selected value ${selectedValue}, text ${selectedText}, expected ${opt.index} ${opt.desc}`,
            'error',
            'error'
          );
        }
      } else {
        log('Select not found in UI', 'error', 'error');
      }
    }
    log('t_rate test complete', 'info', 'general');
  });
}

setupKeypressControls();

const cachedConfig = loadConfig(
  deviceIdInput,
  logLevelSelect,
  fetchBitmapCheckbox,
  updateBitmapOnChangeCheckbox
);
setLogLevel(logLevelSelect.value);
// Merge cached prefs over the defaults so new categories are not lost for
// existing users (A4). With no cache at all, fresh users start all-on.
setLogCategories(
  cachedConfig
    ? mergeLogCategories(DEFAULT_LOG_CATEGORIES, cachedConfig.logCategories)
    : Object.fromEntries(Object.keys(DEFAULT_LOG_CATEGORIES).map((k) => [k, true]))
);
setState(
  {
    fetchBitmap: fetchBitmapCheckbox.checked,
    updateBitmapOnChange: updateBitmapOnChangeCheckbox.checked,
    presetKey: cachedConfig?.presetKey || KEY.DSP_A_PRESET,
  },
  'main:boot-init'
);
connectMidi(cachedConfig);
