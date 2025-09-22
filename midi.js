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

export function sendSysEx(cmd, dataBytes = []) {
  const sysex = [deviceId, cmd, ...dataBytes];
  selectedOutput.sendSysex([0x1c, 0x70], sysex);
  console.log(`Sent SysEx: F0 1C 70 ${sysex.map(b => b.toString(16).padStart(2, '0')).join(' ')} F7`);
}

export function sendObjectInfoDump(key) {
  const keyBytes = key.split('').map(c => c.charCodeAt(0));
  sendSysEx(0x31, keyBytes);
}

export function sendValueDump(key) {
  const keyBytes = key.split('').map(c => c.charCodeAt(0));
  sendSysEx(0x2d, keyBytes);
}

export function sendValuePut(key, value) {
  const keyBytes = key.split('').map(c => c.charCodeAt(0));
  const valueBytes = value.split(' ').map(v => parseFloat(v));
  sendSysEx(0x2f, [...keyBytes, ...valueBytes]);
}

function nibble(mask) {
  return mask.flatMap(b => [(b >> 4) & 0x0F, b & 0x0F]);
}

export function sendKeypress(mask) {
  const nibbled = nibble(mask);
  sendSysEx(0x01, nibbled);
}