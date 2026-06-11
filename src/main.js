// main.js
import { WebMidi } from 'webmidi';
import { CMD, KEY } from './sysex-commands.js';
import { TIMING, DEFAULT_LOG_CATEGORIES } from './constants.js';
import {
  loadConfig,
  saveConfig,
  saveThemeConfig,
  clearConfig,
  mergeLogCategories,
} from './config.js';
import { setupThemeEditor } from './theme.js';
import { setupKeypressControls, setupDataKnob, testKeypress, meterPollTick } from './controls.js';
import {
  setMidiPorts,
  addSysexListener,
  sendSysEx,
  sendValueDump,
  sendValuePut,
  isOutputConnected,
} from './midi.js';
import { updateScreen } from './renderer.js';
import { appState } from './state.js';
import { setState } from './store.js';
import { denibble, renderBitmap } from './bitmap.js';
import { log, setLogLevel, setLogCategories, getLogCategories } from './logger.js';
import { registerEventBridge } from './event-bridge.js';
import { extractNibblesFromHex } from './hex-extract.js';
import { deriveKeyStack, markAllStableDirty } from './tree.js';

const lcdEl = document.getElementById('lcd');
const logArea = document.getElementById('log-area');
const connectBtn = document.getElementById('connect');
const outputSelect = document.getElementById('output-select');
const inputSelect = document.getElementById('input-select');
const deviceIdInput = document.getElementById('device-id');
const logLevelSelect = document.getElementById('log-level');
const fetchBitmapCheckbox = document.getElementById('fetch-bitmap');
const updateBitmapOnChangeCheckbox = document.getElementById('update-bitmap-on-change');
const eagerLoadCheckbox = document.getElementById('eager-load');
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
  // The tick body (CON fan + the #107 wave-open gate) lives in controls.js
  // as meterPollTick so the gate is test-pinned; main.js owns the timer.
  pollingInterval = setInterval(meterPollTick, TIMING.METER_POLL_MS);
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
  showLoading();
  // NOTE: this reset block is hand-mirrored in build_tools/live-app.mjs and
  // build_tools/tree-audit.mjs (selectPorts is not exported) - update those
  // when changing it.
  // C2 (#38): reset the view to root BEFORE requesting, then arm the one-shot
  // landing. selectPorts is re-runnable (button + cached-config auto-run);
  // the reset forces the parser's full root branch on reconnect (background
  // root dumps do not update currentSubs, so landing from a navigated-deep
  // state would pair the root keyStack entry with stale subs). The landing
  // itself — adopt DSP keys/names, navigate to the active preset, prefetch
  // the other DSP, optional screen fetch — fires in event-bridge.js when the
  // root dump arrives. No timer, no autoLoad flag.
  // A (re)connect is an explicit re-read: distrust every stable-subtree
  // cache (#113 — front-panel changes may have happened while disconnected).
  markAllStableDirty();
  setState(
    {
      currentKey: KEY.ROOT,
      keyStack: [],
      currentSubs: [],
      pendingLanding: 'root',
      pendingDescend: false,
    },
    'main:select-ports-reset'
  );
  updateScreen(log);
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
    appState.presetKey,
    eagerLoadCheckbox.checked
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
  // Root has no ancestors, so the derived stack is [] by definition; set it
  // explicitly so a sync never leaves a previous menu's stack behind (T1b).
  // Sync is the explicit "re-read the device" affordance: distrust every
  // stable-subtree cache (#113 — the front-panel-changes answer).
  markAllStableDirty();
  setState({ currentKey: KEY.ROOT, keyStack: [] }, 'main:sync-root');
  updateScreen(log);
  log('Synced to root', 'info', 'general');
});

getScreenBtn.addEventListener('click', () => {
  if (appState.fetchBitmap) {
    // #3: show progress for the multi-second bitmap transfer. The screen
    // request is wave-counted (#107) and screen waves hide loading on
    // their drain, so this clears itself — but only if the request can
    // actually go out: with no output selected, sendSysEx early-returns
    // BEFORE the wave accounting (review finding), so showing the spinner
    // first would strand it with no wave to drain it.
    if (!isOutputConnected()) {
      log('No MIDI output selected; skipped Get Screen request.', 'info', 'bitmap');
      return;
    }
    showLoading();
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
    setState(
      { currentKey: KEY.DSP_B_PRESET, keyStack: deriveKeyStack(KEY.DSP_B_PRESET) },
      'main:test-trate-nav'
    );
    updateScreen(log);
    await new Promise((r) => setTimeout(r, TIMING.SYNC_STEP_MS));
    log('Navigated to Auto Tape Flanger', 'info', 'general');
    // Navigate to delay parameters
    setState(
      { currentKey: KEY.DELAY_PARAMS, keyStack: deriveKeyStack(KEY.DELAY_PARAMS) },
      'main:test-trate-nav'
    );
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
setupDataKnob();

// Glass specular tracking: the pane's key light follows the pointer
// (maintainer ask). Presentation only — rAF-throttled pointermove writes
// the highlight position as custom properties the .glass gradient reads.
// Values run past 0-100% on purpose: the reflection slides off the pane
// naturally instead of pinning at the edge.
const glassEl = document.querySelector('.glass');
if (glassEl && typeof requestAnimationFrame === 'function') {
  let specFrame = null;
  document.addEventListener('pointermove', (e) => {
    if (specFrame !== null) return;
    specFrame = requestAnimationFrame(() => {
      specFrame = null;
      const r = glassEl.getBoundingClientRect();
      if (!r.width || !r.height) return;
      glassEl.style.setProperty(
        '--spec-x',
        `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`
      );
      glassEl.style.setProperty(
        '--spec-y',
        `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`
      );
    });
  });
}

const cachedConfig = loadConfig(
  deviceIdInput,
  logLevelSelect,
  fetchBitmapCheckbox,
  updateBitmapOnChangeCheckbox,
  eagerLoadCheckbox
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
    eagerLoad: eagerLoadCheckbox.checked,
    presetKey: cachedConfig?.presetKey || KEY.DSP_A_PRESET,
  },
  'main:boot-init'
);
// Theme editor (theme.js): applies the persisted theme at boot, then saves
// on every preset/swatch change — independent of the Save Config button.
setupThemeEditor(
  {
    presetSelect: document.getElementById('theme-preset'),
    resetButton: document.getElementById('theme-reset'),
    tokensContainer: document.getElementById('theme-tokens'),
  },
  cachedConfig?.theme,
  saveThemeConfig
);
// #48: the settings checkboxes sync to appState LIVE — previously the sync
// happened only at boot-init, so toggling mid-session was a silent no-op
// until Save Config + reload. Every runtime read already goes through
// appState, so the change listeners are the whole fix. (Persistence still
// requires Save Config, as before.)
fetchBitmapCheckbox.addEventListener('change', () =>
  setState({ fetchBitmap: fetchBitmapCheckbox.checked }, 'main:checkbox-sync')
);
updateBitmapOnChangeCheckbox.addEventListener('change', () =>
  setState({ updateBitmapOnChange: updateBitmapOnChangeCheckbox.checked }, 'main:checkbox-sync')
);
eagerLoadCheckbox.addEventListener('change', () =>
  setState({ eagerLoad: eagerLoadCheckbox.checked }, 'main:checkbox-sync')
);
connectMidi(cachedConfig);
