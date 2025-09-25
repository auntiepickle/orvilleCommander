// midi.js
import { parseResponse } from './parser.js';
import { appState } from './state.js';

let selectedOutput = null;
let selectedInput = null;

export function setMidiPorts(output, input, devId) {
  selectedOutput = output;
  selectedInput = input;
  appState.deviceId = devId;
}

export function addSysexListener(log) {
  selectedInput.addListener('sysex', (e) => {
    const category = (e.data.length > 4 && e.data[4] === 0x17) ? 'screenDump' : 'sysexReceived';
    log(`Received SysEx: ${e.data.map(b => b.toString(16).padStart(2, '0')).join(' ')}`, 'debug', category);
    parseResponse(e.data, log);
  });
}

export function sendSysEx(cmd, dataBytes = [], log = null) {
  if (cmd === 0x18 && !appState.fetchBitmap) {
    if (log) log('Skipped SysEx screen dump (0x18) as fetchBitmap disabled.', 'debug', 'bitmap');
    return;
  }
  const sysex = [appState.deviceId, cmd, ...dataBytes];
  selectedOutput.sendSysex([0x1c, 0x70], sysex);
  const sentMsg = `Sent SysEx: F0 1C 70 ${sysex.map(b => b.toString(16).padStart(2, '0')).join(' ')} F7`;
  if (log) log(sentMsg, 'debug', 'sysexSent');
}

export function sendObjectInfoDump(key, log = null) {
  const keyBytes = key.split('').map(c => c.charCodeAt(0));
  sendSysEx(0x31, keyBytes, log);
}

export function sendValueDump(key, log = null) {
  const keyBytes = key.split('').map(c => c.charCodeAt(0));
  sendSysEx(0x2d, keyBytes, log);
}

export function sendValuePut(key, value, log = null) {
  const keyBytes = key.split('').map(c => c.charCodeAt(0));
  const valueBytes = value.split('').map(c => c.charCodeAt(0));
  sendSysEx(0x2d, [...keyBytes, 0x20, ...valueBytes], log);
  if (log) log(`Sent VALUE_PUT for key ${key}: ${value}`, 'info', 'general');
}

function nibble(mask) {
  return mask.flatMap(b => [(b >> 4) & 0x0F, b & 0x0F]);
}

export function sendKeypress(mask, log = null) {
  const nibbled = nibble(mask);
  sendSysEx(0x01, nibbled, log);
}