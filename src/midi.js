// midi.js
import { parseResponse } from './parser.js';
import { appState } from './state.js';
import { setState } from './store.js';
import { log } from './logger.js';
import { emit } from './events.js';
import { CMD, SYSEX } from './sysex-commands.js';
import { TIMING } from './constants.js';

let selectedOutput = null;
let selectedInput = null;

// 7c shadow-fire — per-wave request counter and 1500ms hard-ceiling
// watchdog. A wave begins when outstanding transitions 0->1. The
// watchdog is set once at wave start and is NOT reset on subsequent
// sends within the wave (hard ceiling, not silence detector). The
// wave ends either when outstanding returns to 0
// (reason='all-received') or when the watchdog fires
// (reason='watchdog'). Existing 200ms parser timers remain in place;
// consumer migration is 7d.
let outstanding = 0;
let waveSends = 0;
let waveReceives = 0;
let waveStart = 0;
let waveLastKey = null;
let watchdogHandle = null;
const dumpStats = { all: 0, watchdog: 0 };

function recordRequest(key) {
  if (outstanding === 0 && watchdogHandle === null) {
    waveStart = Date.now();
    waveSends = 0;
    waveReceives = 0;
    waveLastKey = null;
    watchdogHandle = setTimeout(forceComplete, TIMING.WATCHDOG_MS);
  }
  outstanding++;
  waveSends++;
  waveLastKey = key;
}

/**
 * Decrement the per-wave outstanding-request counter when a response
 * arrives. Called from parser.js at the top of each 0x32 / 0x2e
 * branch (after the minimal parse needed to know the response key,
 * before any setState fan-out). Decrements once per accepted response
 * regardless of which sub-branch handles the data.
 *
 * @param {string} type - 'objectinfo' | 'valuedump'. Reserved for
 *   future per-type accounting in 7d; the current counter does not
 *   differentiate.
 * @param {string} key - The response's primary key (subs[0].key for
 *   OBJECTINFO, parts[0] for VALUE_DUMP). Reserved for future
 *   request/response correlation in 7d; the current counter does not
 *   match by key.
 */
export function notifyResponse(type, key) {
  if (outstanding === 0) return;
  outstanding--;
  waveReceives++;
  if (outstanding === 0) {
    finishWave('all-received');
  }
}

function forceComplete() {
  finishWave('watchdog');
}

function finishWave(reason) {
  if (watchdogHandle !== null) {
    clearTimeout(watchdogHandle);
    watchdogHandle = null;
  }
  const payload = {
    reason,
    sendCount: waveSends,
    receiveCount: waveReceives,
    durationMs: Date.now() - waveStart,
    lastKey: waveLastKey,
  };
  dumpStats[reason === 'watchdog' ? 'watchdog' : 'all']++;
  outstanding = 0;
  waveSends = 0;
  waveReceives = 0;
  waveStart = 0;
  waveLastKey = null;
  emit('dumpComplete', payload);
  setState({ lastDumpComplete: payload }, 'midi:dump-complete');
  log(
    `dumpComplete: reason=${reason} send=${payload.sendCount} recv=${payload.receiveCount} dur=${payload.durationMs}ms`,
    'info',
    'general'
  );
}

/**
 * Session-scoped tally of dumpComplete reasons. Escalation criterion
 * for the 7c smoke session: watchdog / (all + watchdog) > 5% over a
 * 30-minute window means the wave-detection mechanism needs redesign
 * before 7d.
 *
 * @returns {{all: number, watchdog: number}} Counter snapshot.
 */
export function getDumpStats() {
  return { ...dumpStats };
}

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
  setState({ deviceId: devId }, 'midi:set-ports');
}

/**
 * Adds a SysEx event listener to the selected MIDI input.
 * Parses incoming SysEx messages and categorizes them (e.g., screenDump for bitmap data).
 *
 * @example
 * // Called after setting ports
 * addSysexListener();
 */
export function addSysexListener() {
  if (!selectedInput) {
    log('Error: MIDI input not set; cannot add listener', 'error', 'error');
    return;
  }
  selectedInput.addListener('sysex', (e) => {
    parseResponse(e.data);
  });
}

/**
 * Sends a SysEx message to the Orville device via the selected MIDI output.
 * Constructs the full SysEx with manufacturer ID (0x1c, 0x70).
 *
 * @param {number} cmd - The command byte (e.g., 0x31 for OBJECTINFO_DUMP).
 * @param {number[]} [dataBytes=[]] - Additional data bytes to include.
 *
 * @example
 * sendSysEx(0x18, []); // Fetch screen bitmap
 */
export function sendSysEx(cmd, dataBytes = []) {
  if (!selectedOutput) {
    log('Error: MIDI output not set', 'error', 'error');
    return;
  }
  try {
    const sysex = [appState.deviceId, cmd, ...dataBytes];
    selectedOutput.sendSysex(SYSEX.MANUFACTURER, sysex);
    const sentMsg = `Sent SysEx: F0 1C 70 ${sysex.map((b) => b.toString(16).padStart(2, '0')).join(' ')} F7`;
    log(sentMsg, 'debug', 'sysexSent');
  } catch (err) {
    log(`SysEx send error: ${err.message}`, 'error', 'error');
  }
}

/**
 * Sends an OBJECTINFO_DUMP request for the given key.
 * Converts the key string to ASCII bytes. Increments the per-wave
 * request counter; counter decrement happens in parser.js when the
 * 0x32 response is received.
 *
 * @param {string} key - The menu key to request info for (e.g., '0' for root).
 *
 * @example
 * sendObjectInfoDump('401000b');
 */
export function sendObjectInfoDump(key) {
  recordRequest(key);
  const keyBytes = key.split('').map((c) => c.charCodeAt(0));
  sendSysEx(CMD.OBJECTINFO_DUMP, keyBytes);
}

/**
 * Sends a VALUE_DUMP request for the given key.
 * Converts the key string to ASCII bytes. Increments the per-wave
 * request counter; counter decrement happens in parser.js when the
 * 0x2e response is received.
 *
 * @param {string} key - The parameter key to request value for.
 *
 * @example
 * sendValueDump('10020011');
 */
export function sendValueDump(key) {
  recordRequest(key);
  const keyBytes = key.split('').map((c) => c.charCodeAt(0));
  sendSysEx(CMD.VALUE, keyBytes);
}

/**
 * Sends a VALUE_PUT command to set a value for the given key.
 * Converts key and value strings to ASCII bytes, separated by space (0x20).
 * Not request-counted: the device does not respond with a VALUE_DUMP
 * for a PUT; the counter tracks request/response pairs only.
 *
 * @param {string} key - The parameter key to set.
 * @param {string} value - The value to set (e.g., '1' for trigger).
 *
 * @example
 * sendValuePut('1002001c', '1'); // Trigger preset load
 */
export function sendValuePut(key, value) {
  const keyBytes = key.split('').map((c) => c.charCodeAt(0));
  const valueBytes = value.split('').map((c) => c.charCodeAt(0));
  sendSysEx(CMD.VALUE, [...keyBytes, SYSEX.VALUE_SEPARATOR, ...valueBytes]);
  log(`Sent VALUE_PUT for key ${key}: ${value}`, 'info', 'general');
}

/**
 * Nibbles a byte mask array into high/low 4-bit nibbles for SysEx transmission.
 * Used internally for keypress masks.
 *
 * @param {number[]} mask - The 4-byte mask array.
 * @returns {number[]} The nibbled array (8 bytes).
 */
function nibble(mask) {
  return mask.flatMap((b) => [(b >> 4) & 0x0f, b & 0x0f]);
}

/**
 * Sends a keypress SysEx command using the nibbled mask.
 *
 * @param {number[]} mask - The keypress mask from keypressMasks.
 *
 * @example
 * sendKeypress(keypressMasks['enter']);
 */
export function sendKeypress(mask) {
  const nibbled = nibble(mask);
  sendSysEx(CMD.KEYPRESS, nibbled);
}
