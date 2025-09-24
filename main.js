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
const processDebugFileBtn = document.getElementById('process-debug-file'); // New button

let pollInterval = null;
let isPolling = false;

function log(message) {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${message}\n`;
  logArea.value += entry;
  logArea.scrollTop = logArea.scrollHeight;
  console.log(entry);
}

copyLogBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(logArea.value).then(() => log('Log copied to clipboard.'));
});

connectBtn.addEventListener('click', async () => {
  try {
    await WebMidi.enable({ sysex: true });
    log('WebMidi enabled.');
    const cachedConfig = loadConfig(log, deviceIdInput);
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
    log('Ports populated. Choose and click "Select Ports". If cached, already pre-selected.');
  } catch (err) {
    log(`Error: ${err}`);
  }
});

selectPortsBtn.addEventListener('click', () => {
  const outputId = outputSelect.value;
  const inputId = inputSelect.value;
  const devId = parseInt(deviceIdInput.value, 10);
  setMidiPorts(WebMidi.getOutputById(outputId), WebMidi.getInputById(inputId), devId);
  addSysexListener(log);
  log('Ports selected and listener added. Device ID set to ' + devId);
  lcdEl.innerText = 'Connected. Fetching root screen...';
  updateScreen(log);
  // Fetch screen after connecting
  sendSysEx(0x18, [], log);
  log('Fetched initial screen after connecting.');
});

saveConfigBtn.addEventListener('click', () => {
  saveConfig(outputSelect.value, inputSelect.value, parseInt(deviceIdInput.value, 10), log);
});

clearConfigBtn.addEventListener('click', () => {
  clearConfig(outputSelect, inputSelect, deviceIdInput, log);
});

sendRequestBtn.addEventListener('click', () => {
  appState.currentKey = keyInput.value;
  updateScreen(log);
  log(`Requested object info for key ${appState.currentKey}`);
});

getValueBtn.addEventListener('click', () => {
  sendValueDump(appState.currentKey, log);
});

setValueBtn.addEventListener('click', () => {
  const value = setValueInput.value;
  sendValuePut(appState.currentKey, value, log);
});

backBtn.addEventListener('click', () => {
  if (appState.keyStack.length > 0) {
    appState.currentKey = appState.keyStack.pop();
    appState.paramOffset = 0;
    appState.autoNavigated = false;
    updateScreen(log);
    log(`Back to key ${appState.currentKey}`);
  }
});

pollToggle.addEventListener('click', () => {
  isPolling = !isPolling;
  if (isPolling) {
    pollInterval = setInterval(() => updateScreen(log), 500);
    log('Polling started.');
    pollToggle.innerText = 'Stop Polling';
  } else {
    clearInterval(pollInterval);
    log('Polling stopped.');
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
  log('Synced to root');
});

getScreenBtn.addEventListener('click', () => {
  sendSysEx(0x18, [], log);
  log('Sent Get Screen request (0x18)');
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
        log(`[LOG] Extracted ${nibbles.length} nibbles from uploaded file`);
        const rawBytes = denibble(nibbles);
        log(`[LOG] Denibbled to ${rawBytes.length} bytes`);
        renderBitmap('lcd-canvas', rawBytes, log);
      } else {
        log('[ERROR] No hex data found in file');
      }
    };
    reader.readAsText(file);
  } else {
    log('[ERROR] No file uploaded');
  }
});

// Function to show loading indicator
function showLoading() {
  const canvas = document.getElementById('lcd-canvas');
  if (canvas) {
    canvas.classList.add('loading');
  }
  log('Loading new screen...');
}

// Function to hide loading indicator
function hideLoading() {
  const canvas = document.getElementById('lcd-canvas');
  if (canvas) {
    canvas.classList.remove('loading');
  }
  log('Screen loaded.');
}

setupKeypressControls(log);

loadConfig(log, deviceIdInput);