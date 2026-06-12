// midi-map.js
// Device-native MIDI mapping (#146): configures the Orville's own modulation
// system so a MIDI source drives a parameter IN THE DSP — the app is only a
// configurator, never in the runtime signal path (zero latency, persists in the
// preset). See docs/device-model.md §8b for the full model.
//
// Two layers, both ordinary userobjects edited with VALUE_PUT/OBJECTINFO:
//   - 8 global "assign" controllers (reusable MIDI sources) under ext
//     controllers; each has a Capture-Midi learn.
//   - a per-parameter modulation surface (mode/range/type/capture) bound to a
//     parameter by SELECT-hold (the one keypress step, handled by the caller).
//
// DOM-free like library.js: it reads the tree + sends SysEx, nothing else.

import { sendValuePut, sendObjectInfoDump, sendValueDump, sendKeypress } from './midi.js';
import { keypressMasks } from './controls.js';
import { MOD, MOD_SOURCES, KEY_PREFIX } from './sysex-commands.js';
import { MIDI_MAP } from './constants.js';
import { getNode } from './tree.js';
import { saveMidiMappings, loadMidiMappings } from './config.js';
import { appState } from './state.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Observed per-parameter mapping state, so the renderer can flag mapped knobs
// WITHOUT re-binding each one. The device stores the truth in the preset; this
// records what the app has set or read so far, and persists it to midiConfig so
// the badges survive a page reload (the dev server's HMR reload included).
//
// Keyed by PROGRAM: { [programId]: { [paramKey]: sourceName } }. A param key
// lives in one DSP slot, and that slot's loaded program name identifies which
// preset it is — so loading a different program naturally shows ITS badges and
// never the previous program's stale ones (no blunt clear-on-load needed; the
// lookup is self-correcting). Cleared wholesale only on an explicit reset.
let mappedParams = loadMidiMappings();

// The program a param key belongs to: its DSP slot's loaded program name. The
// key prefix names the slot (A/B); appState holds each slot's program name. When
// a slot's name is not yet known, fall back to the slot letter so a mapping set
// before the name resolves is still recoverable. Null for non-preset keys (the
// load menu / setup / gangs — never badged).
function progIdOf(key) {
  if (key?.startsWith(KEY_PREFIX.DSP_A)) return appState.dspAName || KEY_PREFIX.DSP_A;
  if (key?.startsWith(KEY_PREFIX.DSP_B)) return appState.dspBName || KEY_PREFIX.DSP_B;
  return null;
}

/** Records (or clears, when source is off/empty) a param's mapping for the badge. */
export function recordParamMapping(key, source) {
  const prog = progIdOf(key);
  if (!prog) return;
  const forProg = mappedParams[prog] || (mappedParams[prog] = {});
  if (!source || source === 'off') delete forProg[key];
  else forProg[key] = source;
  if (!Object.keys(forProg).length) delete mappedParams[prog]; // don't leave empty buckets
  saveMidiMappings(mappedParams);
}

/** The source name a param is mapped to (for the lit badge), or null. */
export function paramMappingOf(key) {
  const prog = progIdOf(key);
  return (prog && mappedParams[prog]?.[key]) || null;
}

/** Clears ALL observed mappings (explicit reset only — tests, hard reset). */
export function resetParamMappings() {
  mappedParams = {};
  saveMidiMappings(mappedParams);
}

/** The child key at `offset` within a slot/surface base key (hex math). */
export function childKey(base, offset) {
  return (parseInt(base, 16) + offset).toString(16);
}

/** Display name for a `mode` source index (device-model §8b). */
export function sourceName(index) {
  return MOD_SOURCES[index] ?? `source ${index}`;
}

/** The index for a source name, or -1. The names are unique in MOD_SOURCES. */
export function sourceIndex(name) {
  return MOD_SOURCES.indexOf(name);
}

/** The full source list as { index, name } for a picker. */
export function sourceOptions() {
  return MOD_SOURCES.map((name, index) => ({ index, name }));
}

/**
 * Enables `sequence out = new` so the unit echoes the key of any changed field
 * (live monitors + change mirroring; also the key-discovery channel). One-time.
 */
export function enableSequenceOut() {
  sendValuePut(MOD.SEQ_OUT, String(MOD.SEQ_OUT_NEW));
}

// --- Global assign controllers (the 8 reusable MIDI sources) --------------

/** The child keys for global assign slot `i` (0-7). */
export function assignSlot(i) {
  const base = MOD.ASSIGN_BASES[i];
  return {
    base,
    mode: childKey(base, MOD.OFF_MODE),
    channel: childKey(base, MOD.OFF_CHANNEL),
    monitor: childKey(base, MOD.OFF_MONITOR),
    capture: childKey(base, MOD.OFF_CAPTURE),
  };
}

// A modulation sub-field (channel / con#) made presentable, or null when it is
// the blank "-----" placeholder. For "MIDI single"/"MIDI double" sources the
// device reveals a `con` (controller-number) sub here — this is how the actual
// CC number surfaces. Strips the format spec from the label and the leading
// index token from a SET value: { label: 'con', value: '42' }.
function subDetail(o) {
  if (!o || o.tag === '-----') return null;
  const label = String(o.statement || '')
    .replace(/\s*:?\s*%[-0-9.]*[a-z%].*$/i, '')
    .trim();
  if (!label || /^[-\s]+$/.test(label)) return null;
  const raw = String(o.value ?? '');
  const value = raw.replace(/^[0-9a-f]+\s/i, '') || raw;
  if (/^[-\s]*$/.test(value)) return null; // an unset value placeholder ("-----")
  return { label, value };
}

/** Reads assign slot `i`'s current state from the tree (after a refresh). */
export function readAssign(i) {
  const s = assignSlot(i);
  const node = getNode(s.base);
  const find = (k) => node?.find((o) => o.key === k);
  return {
    index: i,
    source: (find(s.mode)?.value || '').replace(/^\w+\s/, '') || 'off',
    channel: find(s.channel)?.value || '',
    monitor: find(s.monitor)?.value || '',
    // channel + the con# (for MIDI single/double) as presentable detail.
    details: [subDetail(find(s.channel)), subDetail(find(childKey(s.base, MOD.OFF_SUB)))].filter(
      Boolean
    ),
  };
}

/** Re-fetches assign slot `i` (structure + values) into the tree. */
export function refreshAssign(i) {
  const s = assignSlot(i);
  sendObjectInfoDump(s.base);
  sendValueDump(s.base);
}

/**
 * Arms Capture-Midi on assign slot `i`; the caller then has the user move a
 * controller (or emits a CC) and the unit captures it. Calls onDone after the
 * arm settles so a UI can prompt "move your controller now".
 */
export async function captureAssign(i, onDone) {
  sendValuePut(assignSlot(i).capture, '1');
  await sleep(MIDI_MAP.CAPTURE_SETTLE_MS);
  onDone?.();
}

/** Clears assign slot `i` (source -> off). */
export function clearAssign(i) {
  sendValuePut(assignSlot(i).mode, '0');
}

// --- Per-parameter modulation ---------------------------------------------
// Binding is the one keypress step: drive the device highlight to the target
// parameter and SELECT-hold. After that, config is pure VALUE_PUT/OBJECTINFO on
// the fixed surface keys, and the bind is verified by the surface's OBJECTINFO
// title (no bitmap scraping).

/**
 * Binds the per-parameter modulation surface to the parameter at `rowIndex` on
 * the active DSP's main parameter page (0-based, in dump order). Drives the
 * device cursor there (program -> parameter resets to the top row, then DOWN x
 * rowIndex) and SELECT-holds, then reads the bound surface back. The returned
 * setup's `title` is the binding proof ("<param> setup") — the caller compares
 * it to the expected parameter and aborts on mismatch rather than writing to
 * the wrong target.
 *
 * @param {number} rowIndex
 * @param {(setup: object) => void} [onDone] - called with readParamSetup()
 */
export async function bindParam(rowIndex, onDone) {
  sendKeypress(keypressMasks.program); // reset to a known page...
  await sleep(MIDI_MAP.BIND_STEP_MS);
  sendKeypress(keypressMasks.parameter); // ...then the param page (cursor at top)
  await sleep(MIDI_MAP.BIND_SETTLE_MS);
  for (let i = 0; i < rowIndex; i++) {
    sendKeypress(keypressMasks.down);
    await sleep(MIDI_MAP.BIND_STEP_MS);
  }
  sendKeypress(keypressMasks['select-hold']);
  await sleep(MIDI_MAP.BIND_SETTLE_MS);
  // The bound surface OBJECTINFO can lag the page swap — poll it a few times
  // rather than reading once (a single short wait reported a blank title and
  // "could not bind" even when the bind had landed; review).
  let setup = { title: '' };
  for (let i = 0; i < MIDI_MAP.BIND_READ_TRIES; i++) {
    refreshParamSetup();
    await sleep(MIDI_MAP.BIND_SETTLE_MS);
    setup = readParamSetup();
    if (setup.title) break;
  }
  onDone?.(setup);
}

/** Sets the bound parameter's modulation source by index (MOD_SOURCES). */
export function setParamSource(index) {
  sendValuePut(MOD.MODE, String(index));
}

/** Sets the bound parameter's modulation depth/range. */
export function setParamRange(value) {
  sendValuePut(MOD.RANGE, String(value));
}

/** Sets the bound parameter's response type (0 absolute / 1 unipolar / 2 bipolar). */
export function setParamType(index) {
  sendValuePut(MOD.TYPE, String(index));
}

/** Arms Capture-Midi on the bound parameter's surface. */
export async function captureParam(onDone) {
  sendValuePut(MOD.CAPTURE, '1');
  await sleep(MIDI_MAP.CAPTURE_SETTLE_MS);
  onDone?.();
}

/** Re-fetches the bound modulation surface (structure + values). */
export function refreshParamSetup() {
  sendObjectInfoDump(MOD.PARAM_SETUP);
  sendValueDump(MOD.PARAM_SETUP);
}

// The display unit trailing a printf statement, e.g. 'level : %4.0f dB' -> 'dB',
// 'con: %2.0f' -> ''. Used to give the bare `range` number its parameter units.
// The device escapes a literal percent as '%%' (printf), e.g. 'size/decay: %3.0f
// %%' — collapse it back to a single '%' so percent params don't read "%%".
function unitOf(statement) {
  const m = String(statement || '').match(/%[-+ 0-9.]*[a-zA-Z](.*)$/);
  return m ? m[1].replace(/%%/g, '%').trim() : '';
}

/** Reads the bound modulation surface from the tree (title proves the binding). */
export function readParamSetup() {
  const node = getNode(MOD.PARAM_SETUP);
  const find = (k) => node?.find((o) => o.key === k);
  // The bound parameter's own value mirror (device-model §8b): the surface's NUM
  // that ISN'T the `range` NUM. It carries the parameter's display unit + its
  // full span (min..max) — the reference that makes a `range` value meaningful
  // (e.g. range 200 on a 100 dB-span parameter = twice its span).
  const mirror = node?.find((o) => o.type === 'NUM' && o.key !== MOD.RANGE);
  const param =
    mirror && mirror.min !== '' && mirror.max !== ''
      ? {
          unit: unitOf(mirror.statement),
          min: Number(mirror.min),
          max: Number(mirror.max),
          span: Number(mirror.max) - Number(mirror.min),
        }
      : null;
  return {
    title: node?.[0]?.statement || '',
    source: (find(MOD.MODE)?.value || '').replace(/^\w+\s/, '') || 'off',
    channel: find(MOD.CHANNEL)?.value || '',
    range: find(MOD.RANGE)?.value || '',
    type: find(MOD.TYPE)?.value || '',
    monitor: find(MOD.MONITOR)?.value || '',
    param,
    // channel + the con# (for MIDI single/double, this is the actual CC number).
    details: [subDetail(find(MOD.CHANNEL)), subDetail(find(MOD.SUB2))].filter(Boolean),
  };
}

/**
 * The manual's scale equation (p.78): the `range` value that maps a controller's
 * full sweep onto a desired parameter span. `(spanMax - spanMin)` over the
 * parameter's full range, times the device's full-scale range unit. We expose
 * the simple linear case: the desired parameter delta IS the range value (the
 * device's `range` NUM is already in the parameter's display units, e.g. dB).
 *
 * @param {number} desiredDelta - parameter change across the controller's sweep
 * @returns {number} the value to write to MOD.RANGE
 */
export function rangeForSpan(desiredDelta) {
  return Math.round(desiredDelta);
}
