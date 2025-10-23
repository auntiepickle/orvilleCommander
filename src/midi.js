// midi.js
import { parseResponse } from './parser.js';
import { appState } from './state.js';

let selectedOutput = null;
let selectedInput = null;

/**
 * Sets the MIDI output, input ports, and device ID in the application state.
 * This configures the MIDI communication endpoints.
 * 
 * @param {Object} output - The WebMidi output object.
 * @param {Object} input - The WebMidi input object.
 * @param {number} devId - The MIDI device ID (0-127).
 * 
 * @example
 * // In main.js after selecting ports
 * setMidiPorts(WebMidi.getOutputById(outputId), WebMidi.getInputById(inputId), devId);
 */
export function setMidiPorts(output, input, devId) {
  selectedOutput = output;
  selectedInput = input;
  appState.deviceId = devId;
}

/**
 * Adds a SysEx event listener to the selected MIDI input.
 * Parses incoming SysEx messages and categorizes them (e.g., screenDump for bitmap data).
 * 
 * @param {Function} log - The logging function for debug messages.
 * 
 * @example
 * // Called after setting ports
 * addSysexListener(log);
 */
export function addSysexListener(log) {
  selectedInput.addListener('sysex', (e) => {
    const category = (e.data.length > 4 && e.data[4] === 0x17) ? 'screenDump' : 'sysexReceived';
    //log(`Received SysEx: ${e.data.map(b => b.toString(16).padStart(2, '0')).join(' ')}`, 'debug', category);
    parseResponse(e.data, log);
  });
}

/**
 * Sends a SysEx message to the Orville device via the selected MIDI output.
 * Constructs the full SysEx with manufacturer ID (0x1c, 0x70) and logs if provided.
 * 
 * @param {number} cmd - The command byte (e.g., 0x31 for OBJECTINFO_DUMP).
 * @param {number[]} [dataBytes=[]] - Additional data bytes to include.
 * @param {Function} [log=null] - Optional logging function.
 * 
 * @example
 * sendSysEx(0x18, [], log); // Fetch screen bitmap
 */
export function sendSysEx(cmd, dataBytes = [], log = null) {
  const sysex = [appState.deviceId, cmd, ...dataBytes];
  selectedOutput.sendSysex([0x1c, 0x70], sysex);
  const sentMsg = `Sent SysEx: F0 1C 70 ${sysex.map(b => b.toString(16).padStart(2, '0')).join(' ')} F7`;
  if (log) log(sentMsg, 'debug', 'sysexSent');
}

/**
 * Sends an OBJECTINFO_DUMP request for the given key.
 * Converts the key string to ASCII bytes.
 * 
 * @param {string} key - The menu key to request info for (e.g., '0' for root).
 * @param {Function} [log=null] - Optional logging function.
 * 
 * @example
 * sendObjectInfoDump('401000b', log);
 */
export function sendObjectInfoDump(key, log = null) {
  const keyBytes = key.split('').map(c => c.charCodeAt(0));
  sendSysEx(0x31, keyBytes, log);
}

/**
 * Sends a VALUE_DUMP request for the given key.
 * Converts the key string to ASCII bytes.
 * 
 * @param {string} key - The parameter key to request value for.
 * @param {Function} [log=null] - Optional logging function.
 * 
 * @example
 * sendValueDump('10020011', log);
 */
export function sendValueDump(key, log = null) {
  const keyBytes = key.split('').map(c => c.charCodeAt(0));
  sendSysEx(0x2d, keyBytes, log);
}

/**
 * Sends a VALUE_PUT command to set a value for the given key.
 * Converts key and value strings to ASCII bytes, separated by space (0x20).
 * Logs the action if provided.
 * 
 * @param {string} key - The parameter key to set.
 * @param {string} value - The value to set (e.g., '1' for trigger).
 * @param {Function} [log=null] - Optional logging function.
 * 
 * @example
 * sendValuePut('1002001c', '1', log); // Trigger preset load
 */
export function sendValuePut(key, value, log = null) {
  const keyBytes = key.split('').map(c => c.charCodeAt(0));
  const valueBytes = value.split('').map(c => c.charCodeAt(0));
  sendSysEx(0x2d, [...keyBytes, 0x20, ...valueBytes], log);
  if (log) log(`Sent VALUE_PUT for key ${key}: ${value}`, 'info', 'general');
}

/**
 * Nibbles a byte mask array into high/low 4-bit nibbles for SysEx transmission.
 * Used internally for keypress masks.
 * 
 * @param {number[]} mask - The 4-byte mask array.
 * @returns {number[]} The nibbled array (8 bytes).
 */
function nibble(mask) {
  return mask.flatMap(b => [(b >> 4) & 0x0F, b & 0x0F]);
}

/**
 * Sends a keypress SysEx command using the nibbled mask.
 * 
 * @param {number[]} mask - The keypress mask from keypressMasks.
 * @param {Function} [log=null] - Optional logging function.
 * 
 * @example
 * sendKeypress(keypressMasks['enter'], log);
 */
export function sendKeypress(mask, log = null) {
  const nibbled = nibble(mask);
  sendSysEx(0x01, nibbled, log);
}