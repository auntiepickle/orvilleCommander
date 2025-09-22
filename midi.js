// midi.js
import { parseResponse } from './parser.js';

let selectedOutput = null;
let selectedInput = null;
let deviceId = 0;

export function setMidiPorts(output, input, devId) {
  selectedOutput = output;
  selectedInput = input;
  deviceId = devId;
}

export function addSysexListener(log) {
  selectedInput.addListener('sysex', (e) => {
    log(`Received SysEx: ${e.data.map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    parseResponse(e.data, log);
  });
}

export function sendSysEx(cmd, dataBytes = [], log = null) {
  const sysex = [deviceId, cmd, ...dataBytes];
  selectedOutput.sendSysex([0x1c, 0x70], sysex);
  const sentMsg = `Sent SysEx: F0 1C 70 ${sysex.map(b => b.toString(16).padStart(2, '0')).join(' ')} F7`;
  console.log(sentMsg);
  if (log) log(sentMsg);
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
}

function nibble(mask) {
  return mask.flatMap(b => [(b >> 4) & 0x0F, b & 0x0F]);
}

export function sendKeypress(mask, log = null) {
  const nibbled = nibble(mask);
  sendSysEx(0x01, nibbled, log);
}