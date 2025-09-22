import { WebMidi } from 'webmidi';

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
// Soft key buttons
const soft1Btn = document.getElementById('soft1-btn');
const soft2Btn = document.getElementById('soft2-btn');
const soft3Btn = document.getElementById('soft3-btn');
const soft4Btn = document.getElementById('soft4-btn');

let selectedOutput = null;
let selectedInput = null;
let pollInterval = null;
let keyStack = [];
let currentKey = '0'; // Start at root
let isPolling = false;
let deviceId = 0;
let currentValues = {}; // Store fetched values for NUM objects
let lastAscii = ''; // Store last OBJECTINFO_DUMP for re-render
let paramOffset = 0; // For scrolling params if >3
let autoNavigated = false; // Flag for auto drill to first menu

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
    deviceId = config.deviceId;
  } else {
    deviceIdInput.value = 0;
  }
  return config;
}

saveConfigBtn.addEventListener('click', () => {
  const config = { outputId: outputSelect.value, inputId: inputSelect.value, deviceId: parseInt(deviceIdInput.value, 10) };
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
  selectedOutput = WebMidi.getOutputById(outputId);
  selectedInput = WebMidi.getInputById(inputId);
  deviceId = parseInt(deviceIdInput.value, 10);
  selectedInput.addListener('sysex', (e) => {
    log(`Received SysEx: ${e.data.map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    parseResponse(e.data);
  });
  log('Ports selected and listener added. Device ID set to ' + deviceId);
  lcdEl.innerText = 'Connected. Fetching root screen...';
  updateScreen(); // Initial fetch
});

function sendSysEx(cmd, dataBytes = []) {
  const sysex = [deviceId, cmd, ...dataBytes];
  selectedOutput.sendSysex([0x1c, 0x70], sysex);
  log(`Sent SysEx: F0 1C 70 ${sysex.map(b => b.toString(16).padStart(2, '0')).join(' ')} F7`);
}

function sendAsciiSysEx(cmd, asciiStr) {
  const dataBytes = asciiStr.split('').map(c => c.charCodeAt(0));
  sendSysEx(cmd, dataBytes);
}

function sendObjectInfoDump(key) {
  const keyStr = parseInt(key, 16).toString(16).toLowerCase();
  sendAsciiSysEx(0x31, keyStr);
}

function sendValueDump(key) {
  const keyStr = parseInt(key, 16).toString(16).toLowerCase();
  sendAsciiSysEx(0x2d, keyStr);
}

function sendValuePut(key, value) {
  const keyStr = parseInt(key, 16).toString(16).toLowerCase();
  const dataStr = value ? `${keyStr} ${value}` : keyStr;
  sendAsciiSysEx(0x2d, dataStr);
}

function sendKeypress(mask) {
  sendSysEx(0x01, mask);
  log(`Sent keypress code: ${mask.map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
  setTimeout(updateScreen, 200); // Poll after keypress to sync
}

// Keypress masks
const keypressMasks = {
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
  dec: [0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x0B, 0x0F],
  soft1: [0x0F, 0x0F, 0x0F, 0x0F, 0x07, 0x0F, 0x0F, 0x0F],
  soft2: [0x0F, 0x0F, 0x0F, 0x0F, 0x0B, 0x0F, 0x0F, 0x0F],
  soft3: [0x0F, 0x0F, 0x0F, 0x0F, 0x0D, 0x0F, 0x0F, 0x0F],
  soft4: [0x0F, 0x0F, 0x0F, 0x0F, 0x0E, 0x0F, 0x0F, 0x0F]
};

// Attach listeners
upBtn.addEventListener('click', () => {
  sendKeypress(keypressMasks.up);
  if (paramOffset > 0) paramOffset--;
  if (lastAscii) renderScreen(lastAscii); // Local scroll
});
downBtn.addEventListener('click', () => {
  sendKeypress(keypressMasks.down);
  paramOffset++;
  if (lastAscii) renderScreen(lastAscii); // Local scroll
});
leftBtn.addEventListener('click', () => sendKeypress(keypressMasks.left));
rightBtn.addEventListener('click', () => sendKeypress(keypressMasks.right));
enterBtn.addEventListener('click', () => sendKeypress(keypressMasks.enter));
selectBtn.addEventListener('click', () => sendKeypress(keypressMasks.select));
programBtn.addEventListener('click', () => sendKeypress(keypressMasks.program));
parameterBtn.addEventListener('click', () => sendKeypress(keypressMasks.parameter));
levelsBtn.addEventListener('click', () => sendKeypress(keypressMasks.levels));
setupBtn.addEventListener('click', () => sendKeypress(keypressMasks.setup));
bypassBtn.addEventListener('click', () => sendKeypress(keypressMasks.bypass));
incBtn.addEventListener('click', () => sendKeypress(keypressMasks.inc));
decBtn.addEventListener('click', () => sendKeypress(keypressMasks.dec));
// Soft key listeners
soft1Btn.addEventListener('click', () => sendKeypress(keypressMasks.soft1));
soft2Btn.addEventListener('click', () => sendKeypress(keypressMasks.soft2));
soft3Btn.addEventListener('click', () => sendKeypress(keypressMasks.soft3));
soft4Btn.addEventListener('click', () => sendKeypress(keypressMasks.soft4));
syncBtn.addEventListener('click', () => {
  currentKey = '0';
  updateScreen();
  log('Synced to root');
});

function parseResponse(data) {
  if (data.length < 5) return;
  const cmd = data[4];
  let asciiEnd = data.length - 1;
  if (data[asciiEnd - 1] === 0x00) asciiEnd--;
  const ascii = data.slice(5, asciiEnd).map(b => String.fromCharCode(b)).join('');
  if (cmd === 0x32) {
    log(`Parsed OBJECTINFO_DUMP for key ${currentKey}: ${ascii}`);
    paramOffset = 0; // Reset scroll on new dump
    renderScreen(ascii);
    // Auto navigate to first menu on DSP pages
    if ((currentKey.startsWith('4') || currentKey.startsWith('8')) && !autoNavigated) {
      autoNavigated = true;
      if (subs.length > 0 && subs[0].type === 'COL') {
        const firstMenuKey = subs[0].key;
        log(`Auto navigating to first menu: ${firstMenuKey}`);
        currentKey = firstMenuKey;
        updateScreen();
      }
    } else {
      autoNavigated = false;
    }
  } else if (cmd === 0x2e) {
    const valueParts = ascii.split(' ');
    const valueKey = valueParts[0];
    const value = valueParts.slice(1).join(' ');
    currentValues[valueKey] = value;
    log(`Parsed VALUE_DUMP for key ${valueKey}: ${value}`);
    if (lastAscii) renderScreen(lastAscii); // Re-render with new value
  } else if (cmd === 0x0d) {
    log(`Received ERROR: ${ascii}`);
  }
}

function parseColLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const tokens = [];
  let i = 0;
  while (i < trimmed.length) {
    if (trimmed[i] === ' ') i++;
    else if (trimmed[i] === "'") {
      i++;
      let str = '';
      while (i < trimmed.length && trimmed[i] !== "'") str += trimmed[i++];
      i++;
      tokens.push(str);
    } else {
      let tok = '';
      while (i < trimmed.length && trimmed[i] !== ' ') tok += trimmed[i++];
      tokens.push(tok);
    }
  }
  let type = tokens[0];
  if (type === 'COL') {
    return { type, subtype: tokens[1], key: tokens[2], parent: tokens[3], statement: tokens[4], tag: tokens[5], numsub: tokens[6] };
  } else if (type === 'NUM') {
    return { type, subtype: tokens[1], key: tokens[2], parent: tokens[3], statement: tokens[4], tag: tokens[5], value: tokens[6], min: tokens[7], max: tokens[8], res: tokens[9] };
  } else if (!isNaN(parseInt(type))) {
    // Numeric lines like "8 0 10040000 0 '' ''"
    return { type: 'COL', subtype: tokens[0], key: tokens[2], parent: tokens[3], statement: tokens[4], tag: tokens[5], numsub: tokens[6] };
  }
  return null;
}

function renderScreen(ascii) {
  lastAscii = ascii;
  const rawLines = ascii.split('\r\n');
  const objects = rawLines.map(parseColLine).filter(o => o);
  if (objects.length === 0) return;
  const main = objects[0];
  const subs = objects.slice(1);

  let displayLines = [];
  if (currentKey === '0') {
    const progA = subs.find(s => s.key === '401000b') || {statement: 'Program A', key: '401000b'};
    const progB = subs.find(s => s.key === '801000b') || {statement: 'Program B', key: '801000b'};
    displayLines.push(`<span class="softkey" data-key="${progA.key}">A: ${progA.statement}</span> <span class="softkey" data-key="${progB.key}">B: ${progB.statement}</span>`);
    displayLines.push('');
    displayLines.push('');
    const softSubs = subs.filter(s => s.type === 'COL' && s.tag.trim() && s.key !== '401000b' && s.key !== '801000b' && s.key !== '10040000');
    const softTags = softSubs.map(s => (s.tag || '').padEnd(10));
    displayLines.push(softTags.join(''));
  } else {
    displayLines.push(`${main.statement || main.tag || 'Menu'} | Rumble Basics`);
    displayLines.push('--------------------------------');
    let paramLines = [];
    let softTags = [];
    subs.forEach(s => {
      if (s.type === 'NUM') {
        const value = currentValues[s.key] || parseFloat(s.value || 0).toFixed(3);
        let fullText = (s.statement || '').replace(/%f/g, value).replace(/%/g, '%');
        paramLines.push(fullText);
        if (!currentValues[s.key]) sendValueDump(s.key);
      } else if (s.type === 'COL' && s.tag.trim().length <= 10 && s.tag.trim()) {
        softTags.push(s.tag.trim());
      }
    });
    displayLines = displayLines.concat(paramLines.slice(paramOffset, paramOffset + 3));
    while (displayLines.length < 4) displayLines.push('');
    displayLines.push(softTags.map((t, idx) => (idx === 0 ? `[${t}]` : t).padEnd(10)).join(''));
  }

  log(`Rendered screen text: ${displayLines.join('\n')}`); // Log rendered text for debugging

  let htmlLines = displayLines.map((l, index) => {
    if (index === 3) {
      let softHtml = '';
      const softSubs = currentKey === '0' ? subs.filter(s => s.type === 'COL' && s.tag.trim() && s.key !== '401000b' && s.key !== '801000b' && s.key !== '10040000') : subs.filter(s => s.type === 'COL' && s.tag.trim().length <= 10 && s.tag.trim());
      softSubs.forEach((s, idx) => {
        softHtml += `<span class="softkey" data-key="${s.key}" data-index="${idx}">${(idx === 0 ? '[' + (s.tag || '') + ']' : (s.tag || '')).padEnd(10)}</span>`;
      });
      return `<div class="line">${softHtml}</div>`;
    } else if (index > 0 && index < 3 && l.includes(':')) {
      const [tag, val] = l.split(':');
      const paramSub = subs.find(s => s.type === 'NUM' && (s.tag || s.statement) === tag.trim());
      if (paramSub) {
        return `<div class="line">${tag}: <span class="param-value" data-key="${paramSub.key}">${val.trim()}</span></div>`;
      }
    }
    return `<div class="line">${l}</div>`;
  });

  lcdEl.innerHTML = htmlLines.join('');

  lcdEl.querySelectorAll('.softkey').forEach(el => {
    el.addEventListener('click', () => {
      const newKey = el.dataset.key;
      const index = el.dataset.index;
      if (index !== undefined) { // Only send keypress for actual softkeys (not A/B)
        const softMask = keypressMasks[`soft${parseInt(index, 10) + 1}`] || [];
        if (softMask.length > 0) sendKeypress(softMask);
        log(`Clicked softkey for key ${newKey}: ${el.innerText.trim()}, sent press for soft${parseInt(index, 10) + 1}`);
      } else {
        log(`Clicked DSP for key ${newKey}: ${el.innerText.trim()}, navigating without keypress`);
      }
      keyStack.push(currentKey);
      currentKey = newKey;
      paramOffset = 0;
      autoNavigated = false;
      updateScreen();
    });
  });
  lcdEl.querySelectorAll('.param-value').forEach(el => {
    el.addEventListener('click', () => {
      const paramKey = el.dataset.key;
      const newValue = prompt('Enter new value:', el.innerText);
      if (newValue) {
        sendValuePut(paramKey, newValue);
        log(`Set value for param ${paramKey} to ${newValue}`);
        updateScreen();
      }
    });
  });
}

function updateScreen() {
  currentValues = {}; // Clear for fresh poll
  sendObjectInfoDump(currentKey);
  sendValueDump(currentKey);
}

pollToggle.addEventListener('click', () => {
  isPolling = !isPolling;
  if (isPolling) {
    pollInterval = setInterval(updateScreen, 500);
    log('Polling started.');
    pollToggle.innerText = 'Stop Polling';
  } else {
    clearInterval(pollInterval);
    log('Polling stopped.');
    pollToggle.innerText = 'Start Polling';
  }
});

sendRequestBtn.addEventListener('click', () => {
  currentKey = keyInput.value;
  updateScreen();
  log(`Requested object info for key ${currentKey}`);
});

getValueBtn.addEventListener('click', () => {
  sendValueDump(currentKey);
});

setValueBtn.addEventListener('click', () => {
  const value = setValueInput.value;
  sendValuePut(currentKey, value);
});

backBtn.addEventListener('click', () => {
  if (keyStack.length > 0) {
    currentKey = keyStack.pop();
    paramOffset = 0;
    autoNavigated = false;
    updateScreen();
    log(`Back to key ${currentKey}`);
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
  log('Starting keypress test...');
  const tests = Object.entries(keypressMasks);
  tests.forEach(([key, mask], index) => {
    setTimeout(() => {
      sendKeypress(mask);
      log(`Tested ${key} mask: ${mask.map(b => b.toString(16).padStart(2, '0')).join(' ')} - observe hardware response and log any errors`);
      setTimeout(updateScreen, 200); // Poll after each to check if screen changed correctly
    }, index * 500);
  });
});

syncBtn.addEventListener('click', () => {
  currentKey = '0';
  updateScreen();
  log('Synced to root');
});

// Initial load
loadConfig();