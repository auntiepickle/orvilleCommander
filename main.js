import { WebMidi } from 'webmidi';

const screenEl = document.getElementById('screen');
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

// Keypress buttons
const upBtn = document.getElementById('up-btn');
const downBtn = document.getElementById('down-btn');
const leftBtn = document.getElementById('left-btn');
const rightBtn = document.getElementById('right-btn');
const enterBtn = document.getElementById('enter-btn');
const selectBtn = document.getElementById('select-btn');
const programBtn = document.getElementById('program-btn');
const parameterBtn = document.getElementById('parameter-btn');
const levelsBtn = document.getElementById('levels-btn');
const setupBtn = document.getElementById('setup-btn');
const bypassBtn = document.getElementById('bypass-btn');
const incBtn = document.getElementById('inc-btn');
const decBtn = document.getElementById('dec-btn');

let selectedOutput = null;
let selectedInput = null;
let pollInterval = null;
let keyStack = []; // For back navigation

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

function loadConfig() {
  const config = JSON.parse(localStorage.getItem('orvilleConfig'));
  if (config) {
    deviceIdInput.value = config.deviceId;
    log('Loaded cached config: Output ID ' + config.outputId + ', Input ID ' + config.inputId + ', Device ID ' + config.deviceId);
    return config;
  }
  return null;
}

saveConfigBtn.addEventListener('click', () => {
  const config = {
    outputId: outputSelect.value,
    inputId: inputSelect.value,
    deviceId: parseInt(deviceIdInput.value, 10)
  };
  localStorage.setItem('orvilleConfig', JSON.stringify(config));
  log('Saved config to localStorage.');
});

clearConfigBtn.addEventListener('click', () => {
  localStorage.removeItem('orvilleConfig');
  outputSelect.value = '';
  inputSelect.value = '';
  deviceIdInput.value = 0;
  log('Cleared cached config and reset selections.');
});

connectBtn.addEventListener('click', async () => {
  try {
    await WebMidi.enable({ sysex: true });
    log('WebMidi enabled.');

    const cachedConfig = loadConfig();

    outputSelect.innerHTML = '<option value="">-- Select Output --</option>';
    WebMidi.outputs.forEach(output => {
      const option = document.createElement('option');
      option.value = output.id;
      option.textContent = output.name;
      if (cachedConfig && output.id === cachedConfig.outputId) {
        option.selected = true;
      }
      outputSelect.appendChild(option);
    });

    inputSelect.innerHTML = '<option value="">-- Select Input --</option>';
    WebMidi.inputs.forEach(input => {
      const option = document.createElement('option');
      option.value = input.id;
      option.textContent = input.name;
      if (cachedConfig && input.id === cachedConfig.inputId) {
        option.selected = true;
      }
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
  const deviceId = parseInt(deviceIdInput.value, 10);

  if (!outputId || !inputId) {
    log('Please select both input and output ports.');
    return;
  }

  if (isNaN(deviceId) || deviceId < 0 || deviceId > 127) {
    log('Invalid Device ID (0-127).');
    return;
  }

  selectedOutput = WebMidi.getOutputById(outputId);
  selectedInput = WebMidi.getInputById(inputId);

  log(`Selected Output: ${selectedOutput.name}, Input: ${selectedInput.name}, Device ID: ${deviceId}`);

  selectedInput.removeListener('sysex');
  selectedInput.addListener('sysex', e => {
    const dataHex = e.data.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    log(`Received sysex: ${dataHex}`);

    if (e.data[0] === 0xF0 && e.data[1] === 0x1C && e.data[2] === 0x70) {
      const code = e.data[4];
      const asciiData = String.fromCharCode(...e.data.slice(5, -1)).trim();
      if (code === 0x32) { // OBJECTINFO_DUMP
        log('Success: Received object info dump reply.');
        log(`Decoded ASCII: ${asciiData}`);
        const formatted = parseAsciiData(asciiData);
        screenEl.innerHTML = formatted; // Use innerHTML for links
        addKeyLinks();
      } else if (code === 0x2E) { // VALUE_DUMP
        log('Success: Received value dump reply.');
        log(`Decoded value: ${asciiData}`);
        screenEl.innerHTML += `<br>Current Value: ${asciiData.split(' ')[1] || 'triggered'}`;
      } else {
        log('Received sysex, but unrecognized code.');
      }
    }
  });
});

function parseAsciiData(asciiData) {
  const lines = asciiData.split(/\r?\n/).map(line => line.trim()).filter(line => line);
  let formatted = '';
  lines.forEach(line => {
    if (line.startsWith('COL')) {
      const parts = line.match(/COL\s+(\d+)\s+(\w+)\s+\w+\s+'([^']*)'\s+'?([^']*)'?\s+(\d+)/);
      if (parts) formatted += `- Menu: <span class="key-link" data-key="${parts[2]}">Key ${parts[2]}, Label: ${parts[3]}, Tag: ${parts[4]}, Items: ${parts[5]}</span>\n`;
    } else if (line.startsWith('SET')) {
      const parts = line.match(/SET\s+(\d+)\s+(\w+)\s+\w+\s+'([^']*)'\s+(\w+)\s+(\d+)\s+'([^']*)'\s+(\d+)/);
      if (parts) formatted += `- Set: <span class="key-link" data-key="${parts[2]}">Key ${parts[2]}, Label: ${parts[3]}, Current: ${parts[5]} ('${parts[6]}'), Options: ${parts[7]}</span>\n`;
    } else if (line.startsWith('NUM')) {
      const parts = line.match(/NUM\s+(\d+)\s+(\w+)\s+\w+\s+'([^']*)'\s+(\w+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
      if (parts) formatted += `- Num: <span class="key-link" data-key="${parts[2]}">Key ${parts[2]}, Label: ${parts[3]}, Value: ${parts[5]}, Range: ${parts[6]}-${parts[7]}, Step: ${parts[8]}</span>\n`;
    } else {
      formatted += line + '\n';
    }
  });
  return formatted || asciiData;
}

function addKeyLinks() {
  screenEl.querySelectorAll('.key-link').forEach(link => {
    link.addEventListener('click', () => {
      keyStack.push(keyInput.value);
      keyInput.value = link.dataset.key;
      sendObjectRequest();
      if (pollToggle.checked) getValueBtn.click();
    });
  });
}

backBtn.addEventListener('click', () => {
  if (keyStack.length) {
    keyInput.value = keyStack.pop();
    sendObjectRequest();
    if (pollToggle.checked) getValueBtn.click();
  }
});

sendRequestBtn.addEventListener('click', sendObjectRequest);

function sendObjectRequest() {
  if (!selectedOutput || !selectedInput) {
    log('Select ports first.');
    return;
  }
  const deviceId = parseInt(deviceIdInput.value, 10);
  const key = keyInput.value.trim();
  const keyBytes = Array.from(key).map(char => char.charCodeAt(0));
  selectedOutput.sendSysex(0x1C, [0x70, deviceId, 0x31, ...keyBytes]);
  log(`Sent object info request for key '${key}'. Waiting for response...`);
}

getValueBtn.addEventListener('click', () => {
  if (!selectedOutput || !selectedInput) {
    log('Select ports first.');
    return;
  }
  const deviceId = parseInt(deviceIdInput.value, 10);
  const key = keyInput.value.trim();
  const keyBytes = Array.from(key).map(char => char.charCodeAt(0));
  selectedOutput.sendSysex(0x1C, [0x70, deviceId, 0x2D, ...keyBytes]);
  log(`Sent value request for key '${key}'. Waiting for response...`);
});

setValueBtn.addEventListener('click', () => {
  if (!selectedOutput || !selectedInput) {
    log('Select ports first.');
    return;
  }
  const deviceId = parseInt(deviceIdInput.value, 10);
  const key = keyInput.value.trim();
  const value = setValueInput.value.trim();
  if (!value) {
    log('Enter a new value to set.');
    return;
  }
  const keyBytes = Array.from(key).map(char => char.charCodeAt(0));
  const spaceByte = 0x20;
  const valueBytes = Array.from(value).map(char => char.charCodeAt(0));
  selectedOutput.sendSysex(0x1C, [0x70, deviceId, 0x2D, ...keyBytes, spaceByte, ...valueBytes]);
  log(`Sent set value for key '${key}' to '${value}'. Waiting for acknowledgement...`);
  if (pollToggle.checked) {
    setTimeout(sendObjectRequest, 200);
  }
  setValueInput.value = '';
});

pollToggle.addEventListener('change', () => {
  if (pollToggle.checked) {
    pollInterval = setInterval(() => {
      sendObjectRequest();
      getValueBtn.click();
    }, 1000);
    log('Auto-polling enabled for current key (info + value).');
  } else {
    clearInterval(pollInterval);
    log('Auto-polling disabled.');
  }
});

sendCustomBtn.addEventListener('click', () => {
  if (!selectedOutput) {
    log('Select ports first.');
    return;
  }
  const hexString = customSysexInput.value.trim();
  if (!hexString) {
    log('Enter hex bytes for custom SysEx.');
    return;
  }
  const bytes = hexString.split(' ').map(h => parseInt(h, 16));
  selectedOutput.sendSysex(0x1C, bytes);
  log(`Sent custom SysEx: ${hexString}`);
});

// Keypress handlers
const keyMasks = {
  up: [0x0F, 0x0E, 0x0F, 0x0F, 0x0F, 0x0D, 0x0F, 0x0F],
  down: [0x0F, 0x0F, 0x0F, 0x0E, 0x0F, 0x0D, 0x0F, 0x0F],
  left: [0x0F, 0x0F, 0x0F, 0x0E, 0x0F, 0x0F, 0x0F, 0x0F],
  right: [0x0F, 0x0E, 0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x0F],
  enter: [0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x0E, 0x0F],
  select: [0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x0E, 0x0F, 0x0F],
  program: [0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x07],
  parameter: [0x0F, 0x0F, 0x0F, 0x07, 0x0F, 0x0F, 0x0F, 0x0F],
  levels: [0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x0D],
  setup: [0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x07, 0x0F, 0x0F],
  bypass: [0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x0D, 0x0F, 0x0F],
  inc: [0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x07, 0x0F],
  dec: [0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x0B, 0x0F]
};

function sendKeypress(mask) {
  if (!selectedOutput) {
    log('Select ports first.');
    return;
  }
  const deviceId = parseInt(deviceIdInput.value, 10);
  selectedOutput.sendSysex(0x1C, [0x70, deviceId, 0x01, ...mask]);
  log(`Sent keypress SysEx with mask: ${mask.map(b => b.toString(16).toUpperCase()).join(' ')}`);
  if (pollToggle.checked) {
    setTimeout(sendObjectRequest, 200);
  }
}

upBtn.addEventListener('click', () => sendKeypress(keyMasks.up));
downBtn.addEventListener('click', () => sendKeypress(keyMasks.down));
leftBtn.addEventListener('click', () => sendKeypress(keyMasks.left));
rightBtn.addEventListener('click', () => sendKeypress(keyMasks.right));
enterBtn.addEventListener('click', () => sendKeypress(keyMasks.enter));
selectBtn.addEventListener('click', () => sendKeypress(keyMasks.select));
programBtn.addEventListener('click', () => sendKeypress(keyMasks.program));
parameterBtn.addEventListener('click', () => sendKeypress(keyMasks.parameter));
levelsBtn.addEventListener('click', () => sendKeypress(keyMasks.levels));
setupBtn.addEventListener('click', () => sendKeypress(keyMasks.setup));
bypassBtn.addEventListener('click', () => sendKeypress(keyMasks.bypass));
incBtn.addEventListener('click', () => sendKeypress(keyMasks.inc));
decBtn.addEventListener('click', () => sendKeypress(keyMasks.dec));