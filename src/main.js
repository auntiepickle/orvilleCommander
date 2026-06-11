// main.js
import { WebMidi } from 'webmidi';
import { CMD, KEY } from './sysex-commands.js';
import { TIMING, LIBRARY, DEFAULT_LOG_CATEGORIES } from './constants.js';
import {
  loadConfig,
  saveConfig,
  saveThemeConfig,
  saveLibraryConfig,
  clearConfig,
  mergeLogCategories,
} from './config.js';
import { setupThemeEditor } from './theme.js';
import { createDemoPorts, DEMO_NODE_COUNT } from './demo.js';
import {
  getLibrary,
  setLibrary,
  searchLibrary,
  syncLibrary,
  isSyncing,
  cancelSync,
  loadSearchHit,
  libraryProgramCount,
  canSearch,
} from './library.js';
import { showSyncProgress, showSyncComplete, hideSyncDialog } from './sync-dialog.js';
import { setupKeypressControls, setupDataKnob, testKeypress, meterPollTick } from './controls.js';
import {
  setMidiPorts,
  addSysexListener,
  sendSysEx,
  sendObjectInfoDump,
  sendValueDump,
  sendValuePut,
  isOutputConnected,
} from './midi.js';
import { updateScreen } from './renderer.js';
import { appState } from './state.js';
import { setState } from './store.js';
import { denibble, renderBitmap, rerenderBitmap } from './bitmap.js';
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
// The connect/landing reset shared by real ports and demo mode.
// NOTE: this reset block is hand-mirrored in build_tools/live-app.mjs and
// build_tools/tree-audit.mjs (not exported) - update those when changing it.
// C2 (#38): reset the view to root BEFORE requesting, then arm the one-shot
// landing. Re-runnable (button + cached-config auto-run); the reset forces
// the parser's full root branch on reconnect (background root dumps do not
// update currentSubs, so landing from a navigated-deep state would pair the
// root keyStack entry with stale subs). The landing itself — adopt DSP
// keys/names, navigate to the active preset, prefetch the other DSP,
// optional screen fetch — fires in event-bridge.js when the root dump
// arrives. No timer, no autoLoad flag.
// A (re)connect is an explicit re-read: distrust every stable-subtree
// cache (#113 — front-panel changes may have happened while disconnected).
function resetAndLand() {
  lcdEl.innerText = 'Connected. Fetching root screen...';
  showLoading();
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

function selectPorts() {
  const outputId = outputSelect.value;
  const inputId = inputSelect.value;
  const devId = parseInt(deviceIdInput.value, 10);
  setMidiPorts(WebMidi.getOutputById(outputId), WebMidi.getInputById(inputId), devId);
  addSysexListener();
  log('Ports selected and listener added. Device ID set to ' + devId, 'info', 'general');
  resetAndLand();
}

/**
 * Demo mode: swap the MIDI ports for the canned device (src/demo.js — a
 * live-captured tree) and run the normal connect landing. No WebMIDI, no
 * unit, no permissions needed; everything downstream of the port adapters
 * is the real app.
 */
function enterDemoMode() {
  const { outAdapter, inAdapter, deviceId } = createDemoPorts();
  // The DEV ID input is deliberately NOT touched (review): writing the
  // demo capture's ID there would poison the next real Select Ports (the
  // parser drops frames whose device byte mismatches) and could be saved
  // over the user's real ID by Save Config.
  setMidiPorts(outAdapter, inAdapter, deviceId);
  addSysexListener();
  log(`Demo mode: serving a captured device tree (${DEMO_NODE_COUNT} nodes)`, 'info', 'general');
  resetAndLand();
}

connectBtn.addEventListener('click', () => connectMidi());

selectPortsBtn.addEventListener('click', selectPorts);

const demoModeBtn = document.getElementById('demo-mode');
if (demoModeBtn) demoModeBtn.addEventListener('click', enterDemoMode);

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
  let pointerX = 0;
  let pointerY = 0;
  document.addEventListener('pointermove', (e) => {
    // Track every move; render the LATEST position once per frame (the
    // first-event-wins shape lagged the highlight a frame behind).
    pointerX = e.clientX;
    pointerY = e.clientY;
    if (specFrame !== null) return;
    specFrame = requestAnimationFrame(() => {
      specFrame = null;
      const r = glassEl.getBoundingClientRect();
      if (!r.width || !r.height) return;
      glassEl.style.setProperty(
        '--spec-x',
        `${(((pointerX - r.left) / r.width) * 100).toFixed(1)}%`
      );
      glassEl.style.setProperty(
        '--spec-y',
        `${(((pointerY - r.top) / r.height) * 100).toFixed(1)}%`
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
// Preset library + search (#142). The library hydrates from persisted
// config; Sync Library runs the full bank scan (several minutes, progress
// on the button, click again to cancel); search results load into the
// active DSP.
function setupLibraryUI() {
  const searchInput = document.getElementById('preset-search');
  const resultsEl = document.getElementById('search-results');
  const syncBtn = document.getElementById('sync-library');
  if (!searchInput || !resultsEl || !syncBtn) return;

  const statusEl = document.getElementById('sync-status');
  setLibrary(cachedConfig?.presetLibrary);

  // "12m ago" style relative time from an ISO stamp.
  const timeAgo = (iso) => {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  };

  // Search is gated on a decent corpus (#142 follow-up): below the
  // minimum, "no results" misleads, so the input is disabled with a
  // sync-first hint. The status chip always states where things stand.
  const refreshLibraryUI = () => {
    const count = libraryProgramCount();
    const lib = getLibrary();
    const enabled = canSearch();
    searchInput.disabled = !enabled;
    searchInput.placeholder = enabled
      ? `Search ${count} presets`
      : count > 0
        ? `Sync more to search (${count})`
        : 'Sync library to enable search';
    if (statusEl) {
      statusEl.classList.toggle('synced', !!lib);
      statusEl.textContent = lib ? `${count} presets · ${timeAgo(lib.syncedAt)}` : 'not synced';
      if (lib) statusEl.title = `Last synced ${new Date(lib.syncedAt).toLocaleString()}`;
    }
  };
  refreshLibraryUI();

  const hideResults = () => {
    resultsEl.hidden = true;
  };
  const renderResults = () => {
    const query = searchInput.value;
    if (!query.trim()) {
      hideResults();
      return;
    }
    const hits = searchLibrary(query);
    resultsEl.innerHTML = '';
    if (!canSearch()) {
      const empty = document.createElement('div');
      empty.className = 'search-empty';
      empty.textContent = 'Sync the library first to search.';
      resultsEl.appendChild(empty);
    } else if (hits.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'search-empty';
      empty.textContent = 'No matching presets.';
      resultsEl.appendChild(empty);
    } else {
      for (const hit of hits) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'search-hit';
        // textContent, never innerHTML: program/bank names are
        // device-supplied strings (review).
        const bankSpan = document.createElement('span');
        bankSpan.className = 'hit-bank';
        bankSpan.textContent = `${hit.bankName} › `;
        row.append(bankSpan, document.createTextNode(hit.programName));
        row.addEventListener('mousedown', () => {
          hideResults();
          searchInput.value = '';
          loadSearchHit(hit, () => {
            sendObjectInfoDump(KEY.ROOT); // refresh the DSP preset names
            updateScreen(log);
            if (appState.fetchBitmap) sendSysEx(CMD.GET_SCREEN, []);
          });
        });
        resultsEl.appendChild(row);
      }
    }
    resultsEl.hidden = false;
  };
  // preventDefault on the CONTAINER's mousedown (review): a mousedown on
  // the scrollbar or between rows must not blur the input and close the
  // dropdown mid-scroll — only the input keeps focus.
  resultsEl.addEventListener('mousedown', (ev) => ev.preventDefault());
  searchInput.addEventListener('input', renderResults);
  searchInput.addEventListener('focus', renderResults);
  searchInput.addEventListener('blur', hideResults);
  searchInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      searchInput.value = '';
      hideResults();
    }
  });

  syncBtn.addEventListener('click', async () => {
    if (isSyncing()) {
      cancelSync();
      syncBtn.textContent = 'Cancelling...';
      return;
    }
    syncBtn.textContent = 'Syncing...';
    const library = await syncLibrary((p) => {
      showSyncProgress(p, () => {
        cancelSync();
        syncBtn.textContent = 'Cancelling...';
      });
    });
    if (library) {
      saveLibraryConfig(library);
      log(`Library synced: ${library.banks.length} banks`, 'info', 'general');
      // Completion beat on the LCD, then dismiss.
      showSyncComplete({
        banks: library.banks.length,
        programs: library.banks.reduce((n, b) => n + b.programs.length, 0),
      });
      setTimeout(hideSyncDialog, LIBRARY.COMPLETE_HOLD_MS);
    } else {
      hideSyncDialog();
      if (!getLibrary()) {
        log('Library sync produced nothing — is a MIDI output connected?', 'error', 'error');
      }
    }
    syncBtn.textContent = 'Sync Library';
    refreshLibraryUI();
  });
}
setupLibraryUI();

// Theme editor (theme.js): applies the persisted theme at boot, then saves
// on every preset/swatch change — independent of the Save Config button.
setupThemeEditor(
  {
    presetSelect: document.getElementById('theme-preset'),
    resetButton: document.getElementById('theme-reset'),
    tokensContainer: document.getElementById('theme-tokens'),
  },
  cachedConfig?.theme,
  (theme) => {
    saveThemeConfig(theme);
    // The true-screen canvas renders in theme pixel colors — recolor the
    // last captured frame immediately instead of waiting for a new fetch.
    rerenderBitmap();
  }
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
