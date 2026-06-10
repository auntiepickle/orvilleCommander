// midi.js
import { parseResponse } from './parser.js';
import { appState } from './state.js';
import { setState } from './store.js';
import { log } from './logger.js';
import { emit } from './events.js';
import { CMD, SYSEX } from './sysex-commands.js';
import { TIMING } from './constants.js';
import { markDirtyIfStable } from './tree.js';

let selectedOutput = null;
let selectedInput = null;

// FB7: the input + handler the current 'sysex' listener is attached to, so a
// re-registration can detach the previous one (selectPorts runs both from the
// button and from the cached-config auto-run, and may target a new input).
let sysexListenerInput = null;
let sysexListenerHandler = null;

// Per-wave request counter and idle-reset watchdog. A wave begins when
// outstanding transitions 0->1. The watchdog is an idle/silence timer:
// it is rearmed for WATCHDOG_IDLE_MS on every send AND every received
// response, bounded by an absolute WATCHDOG_MAX_MS ceiling measured from
// wave start. This lets a healthy multi-second tree enumeration complete
// via outstanding returning to 0 (reason='all-received') instead of being
// cut short mid-stream; the watchdog (reason='watchdog') now fires only on
// a genuine stall (silence longer than the idle window) or the absolute
// cap. (Earlier this was a fixed 1500ms hard ceiling set once at wave
// start, which tripped during normal 4-6s enumerations and dropped every
// response that arrived after.) Consumers migrated in Phase 3.1 (C1):
// event-bridge.js renders the settled paint on dumpComplete.
let outstanding = 0;
let waveSends = 0;
let waveObjectinfoSends = 0;
let waveReceives = 0;
let waveStart = 0;
let waveLastKey = null;
let watchdogHandle = null;
// One coalesced GET_SCREEN deferred while a wave is open (#107) — fired by
// finishWave. Multiple requests during one wave collapse into one fetch
// (the newest screen is the only one that matters).
let pendingScreenFetch = false;
const dumpStats = { all: 0, watchdog: 0 };

// (Re)arm the idle watchdog for WATCHDOG_IDLE_MS, never extending past the
// absolute WATCHDOG_MAX_MS ceiling from wave start. Called on every send,
// every received response, AND every raw inbound packet (#107 — a streaming
// bitmap's partial packets are activity, not silence) while a wave is in
// flight.
function rearmWatchdog() {
  if (watchdogHandle !== null) clearTimeout(watchdogHandle);
  const remaining = TIMING.WATCHDOG_MAX_MS - (Date.now() - waveStart);
  const delay = Math.max(0, Math.min(TIMING.WATCHDOG_IDLE_MS, remaining));
  watchdogHandle = setTimeout(forceComplete, delay);
}

function recordRequest(key, isObjectinfo = false) {
  if (outstanding === 0 && watchdogHandle === null) {
    waveStart = Date.now();
    waveSends = 0;
    waveObjectinfoSends = 0;
    waveReceives = 0;
    waveLastKey = null;
  }
  outstanding++;
  waveSends++;
  // Per-type accounting: the bridge clears the loading indicator only on
  // waves that carried OBJECTINFO (structure) requests, so the continuous
  // value-only meter-poll waves cannot hide a navigation's loading state.
  if (isObjectinfo) waveObjectinfoSends++;
  waveLastKey = key;
  rearmWatchdog();
}

/**
 * Decrement the per-wave outstanding-request counter when a response
 * arrives. Called from parser.js at the top of each 0x32 / 0x2e
 * branch (after the minimal parse needed to know the response key,
 * before any setState fan-out). Decrements once per accepted response
 * regardless of which sub-branch handles the data.
 *
 * @param {string} _type - 'objectinfo' | 'valuedump'. Reserved for
 *   future per-type accounting; the current counter does not differentiate
 *   (underscore marks it intentionally unused for now).
 * @param {string} _key - The response's primary key (subs[0].key for
 *   OBJECTINFO, parts[0] for VALUE_DUMP). Reserved for future
 *   request/response correlation; the current counter does not match by key.
 */
export function notifyResponse(_type, _key) {
  if (outstanding === 0) return;
  outstanding--;
  waveReceives++;
  if (outstanding === 0) {
    finishWave('all-received');
  } else {
    rearmWatchdog();
  }
}

function forceComplete() {
  finishWave('watchdog');
}

// #107: the idle watchdog is a SILENCE detector, so any raw inbound packet
// must rearm it — a multi-packet 0x17 bitmap streams continuously for
// ~1.2-1.5s before the complete message parses, and rearm-on-parse-only
// made that look like a stall: the smoke measured the bitmap itself and
// every response queued behind it being watchdogged (recv=0 waves). The
// WATCHDOG_MAX_MS absolute cap still bounds a runaway chatterer.
function noteLinkActivity() {
  if (outstanding > 0 && watchdogHandle !== null) rearmWatchdog();
}

function finishWave(reason) {
  if (watchdogHandle !== null) {
    clearTimeout(watchdogHandle);
    watchdogHandle = null;
  }
  const payload = {
    reason,
    sendCount: waveSends,
    objectinfoSends: waveObjectinfoSends,
    receiveCount: waveReceives,
    durationMs: Date.now() - waveStart,
    lastKey: waveLastKey,
  };
  dumpStats[reason === 'watchdog' ? 'watchdog' : 'all']++;
  outstanding = 0;
  waveSends = 0;
  waveObjectinfoSends = 0;
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
  // Fire the deferred screen fetch via a microtask (review hardening): the
  // wave's FINAL response drains the counter at the top of its parser
  // branch, so a synchronous fire here would launch the bitmap before that
  // response finished parsing — and any fetches its render then sends
  // would collide with the inbound bitmap, the exact device-drop the
  // deferral exists to prevent. The microtask runs after the whole MIDI
  // callback completes; it re-checks the flag and the counter because the
  // handlers above may have opened a new wave (a settled render's value
  // fetches take priority — the bitmap re-defers and goes out on a later
  // drain, alone on the link).
  if (pendingScreenFetch) {
    queueMicrotask(() => {
      if (pendingScreenFetch && outstanding === 0) {
        pendingScreenFetch = false;
        sendSysEx(CMD.GET_SCREEN, []);
      }
    });
  }
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
 * Whether a request wave is currently open (responses outstanding). The
 * meter-poll gate (#107): the live saturation smoke measured poll ticks
 * joining waves faster than the 31250-baud link drains them — outstanding
 * never reached 0, waves merged to the 10s WATCHDOG_MAX_MS ceiling (44%
 * watchdog ratio), and settled renders froze for the duration. Pollers
 * must skip their tick while this is true, which self-paces polling to
 * link capacity.
 *
 * @returns {boolean}
 */
export function isWaveOpen() {
  return outstanding > 0;
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
  // A fetch deferred against the OLD device must not fire at the new one
  // after the stale wave watchdogs out (#107 review).
  pendingScreenFetch = false;
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
    // Deliberately does NOT detach the previous listener here: with no new
    // input to serve, keeping the old one live is the lesser evil, and the
    // tracked pair is not cleared, so the next successful registration still
    // detaches it (no leak).
    log('Error: MIDI input not set; cannot add listener', 'error', 'error');
    return;
  }
  // FB7: detach the previous listener (from whichever input it was attached
  // to) before adding a new one. Without this, every selectPorts run stacked
  // another listener, so parseResponse fired N times per message — each
  // duplicate decremented the dump-wave counter again (premature
  // 'all-received') and re-ran the full parse/state fan-out.
  if (sysexListenerInput && sysexListenerHandler) {
    sysexListenerInput.removeListener('sysex', sysexListenerHandler);
  }
  // Reassemble multi-packet SysEx before parsing. Chrome's Web MIDI normally
  // delivers a complete F0..F7 message in one event, but a long SysEx can be
  // split across packets by the platform/driver (the ~3872-byte 0x17 screen
  // dump and large OBJECTINFO dumps travel over a 31250-baud DIN link from the
  // Orville). Start a new buffer on F0, append continuation packets, and only
  // parse once the F7 terminator arrives. When messages already arrive complete
  // this is a pass-through. (Matches the CLI capture tool; see
  // docs/protocol.md "Capturing screens (HIL)".)
  let sysexBuffer = [];
  const handler = (e) => {
    noteLinkActivity(); // #107: partial packets are not silence
    const data = Array.from(e.data);
    if (data[0] === SYSEX.START) sysexBuffer = data;
    else sysexBuffer = sysexBuffer.concat(data);
    // Flush only a properly framed message (starts F0, ends F7). The F0 guard
    // discards a stray continuation packet that arrives with no header.
    if (sysexBuffer[0] === SYSEX.START && sysexBuffer[sysexBuffer.length - 1] === SYSEX.END) {
      parseResponse(sysexBuffer);
      sysexBuffer = [];
    }
  };
  selectedInput.addListener('sysex', handler);
  sysexListenerInput = selectedInput;
  sysexListenerHandler = handler;
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
  // #107: a GET_SCREEN expects a ~3.9KB 0x17 response (~1.2s of link
  // time). Two rules keep the wave model sane around it (both live-
  // measured): (1) it is wave-COUNTED — the 0x17 branch in parser.js
  // notifyResponse()s it — so the transfer is visible link time; (2) it is
  // SERIALIZED after the open wave (R5's fix): the device drops requests
  // that collide with its own bitmap transmission (send=7 recv=4 waves
  // riding to the 10s cap), so a fetch requested mid-wave is deferred,
  // coalesced, and fired by finishWave once the link is clear.
  // OBJECTINFO/VALUE callers count themselves before calling here, so
  // GET_SCREEN is the only command handled at this layer.
  if (cmd === CMD.GET_SCREEN) {
    if (outstanding > 0) {
      pendingScreenFetch = true;
      log('GET_SCREEN deferred until the open wave drains (#107)', 'debug', 'bitmap');
      return;
    }
    recordRequest('screen');
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
  recordRequest(key, true);
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
  // #113: a put is the single chokepoint every in-app mutating action
  // funnels through (TRG loads/saves/deletes, STR name edits, SET bank
  // selects) — mark the key's stable subtree dirty so the next visit
  // refetches instead of trusting the cache.
  markDirtyIfStable(key);
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
