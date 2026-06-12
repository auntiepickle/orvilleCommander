// midi-map-ui.js
// The MIDI-mapping UI (#146): two themed modals over the device-native engine
// in midi-map.js. Device I/O goes through that module; this file only renders
// and sequences, and injects a post-change refresh (onChange) so the rest of
// the app re-reads the device — the modules never send SysEx themselves beyond
// midi-map's calls.
//
//   1. CONTROLLERS panel — the 8 global assign sources (read / Learn / clear).
//      Pure object access, no parameter binding.
//   2. Per-parameter CARD — opened from a parameter's MIDI badge: binds the
//      modulation surface to that parameter (the one keypress step) then edits
//      source / range / type / Learn as plain object writes.

import {
  enableSequenceOut,
  readAssign,
  refreshAssign,
  captureAssign,
  clearAssign,
  bindParam,
  readParamSetup,
  refreshParamSetup,
  setParamSource,
  setParamRange,
  setParamType,
  captureParam,
  sourceOptions,
  recordParamMapping,
  resetParamMappings,
} from './midi-map.js';
import { MOD } from './sysex-commands.js';
import { MIDI_MAP } from './constants.js';

const REFRESH = MIDI_MAP.UI_REFRESH_MS; // device-echo settle before re-read/repaint
const ASSIGN_COUNT = 8; // global assign slots (device-model §8b)
const TYPE_OPTIONS = ['absolute', 'unipolar', 'bipolar']; // MOD.TYPE indices 0-2

let onChange = null; // injected: re-read device + repaint after a write
let panelEl = null; // controllers modal
let cardEl = null; // per-parameter modal
let card = null; // { paramName, rowIndex, bound, loading, learning }

/**
 * Wires the post-change refresh once at boot (kept out of this module so it
 * never sends SysEx). Also turns on sequence-out so live monitors update.
 *
 * @param {{onChange: () => void}} cfg
 */
export function setupMidiMapUI(cfg) {
  onChange = cfg?.onChange || null;
}

/** Closes both modals + clears card state (disconnect / Sync). */
export function resetMidiMapUI() {
  card = null;
  resetParamMappings(); // the badge state is per-program; clear on reconnect/Sync
  document.querySelector('.mm-learn-overlay')?.remove();
  if (panelEl) {
    panelEl.remove();
    panelEl = null;
  }
  if (cardEl) {
    cardEl.remove();
    cardEl = null;
  }
}

// --- shared helpers -------------------------------------------------------

function makeButton(label, className, onClick, disabled) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = label;
  if (disabled) b.disabled = true;
  else b.addEventListener('click', onClick);
  return b;
}

function modalShell(className) {
  const el = document.createElement('div');
  el.className = className;
  el.hidden = true;
  document.body.appendChild(el);
  return el;
}

// "midi double · con 42" — appends the con# (the actual CC number) when the
// source reveals one (MIDI single/double); otherwise just the source name.
function sourceLabel(state) {
  const con = (state.details || []).find((d) => /con/i.test(d.label));
  const base = state.source || 'off';
  return con ? `${base} · ${con.label} ${con.value}` : base;
}

// --- 1. Controllers panel -------------------------------------------------

/** Opens the global MIDI controllers panel. */
export function openControllers() {
  if (!panelEl) panelEl = modalShell('mm-modal');
  enableSequenceOut(); // live monitors
  for (let i = 0; i < ASSIGN_COUNT; i++) refreshAssign(i);
  panelEl.hidden = false;
  // The assign dumps land async; repaint shortly after.
  renderControllers();
  setTimeout(renderControllers, REFRESH);
}

export function closeControllers() {
  if (panelEl) panelEl.hidden = true;
}

function renderControllers() {
  if (!panelEl || panelEl.hidden) return;
  panelEl.innerHTML = '';
  const panel = document.createElement('div');
  panel.className = 'mm-panel';

  const head = document.createElement('header');
  head.className = 'mm-head';
  const title = document.createElement('span');
  title.className = 'mm-title';
  title.textContent = 'MIDI CONTROLLERS';
  head.append(title, makeButton('refresh', 'mm-btn', openControllers, false));
  head.append(makeButton('✕', 'mm-close', closeControllers, false));
  panel.append(head);

  const note = document.createElement('div');
  note.className = 'mm-note';
  note.textContent =
    '8 reusable sources. Learn, then move your controller. Used by params as "assign N".';
  panel.append(note);

  const list = document.createElement('ul');
  list.className = 'mm-list';
  for (let i = 0; i < ASSIGN_COUNT; i++) {
    const a = readAssign(i);
    const li = document.createElement('li');
    li.className = 'mm-row';

    const label = document.createElement('span');
    label.className = 'mm-row-label';
    label.textContent = `assign ${i + 1}`;
    const src = document.createElement('span');
    src.className = 'mm-row-src';
    src.textContent = sourceLabel(a);
    const mon = document.createElement('span');
    mon.className = 'mm-row-mon';
    mon.textContent = a.monitor ? `${Math.round(parseFloat(a.monitor))}%` : '';

    const actions = document.createElement('span');
    actions.className = 'mm-row-actions';
    actions.append(
      makeButton('Learn', 'mm-btn mm-learn', () => learnAssign(i), false),
      makeButton(
        'clear',
        'mm-btn',
        () => {
          clearAssign(i);
          refreshAssignThenRender(i);
        },
        false
      )
    );
    li.append(label, src, mon, actions);
    list.append(li);
  }
  panel.append(list);
  panelEl.append(panel);
}

// Re-fetch an assign slot, then repaint once its echo has had time to land.
function refreshAssignThenRender(i) {
  refreshAssign(i);
  setTimeout(renderControllers, REFRESH);
}

// Learn: arm Capture, then POLL the device until it reports a captured source,
// showing it live (the device gives no "done" signal, so we watch its readback).
function learnAssign(i) {
  captureAssign(i, () =>
    startLearnPoll(
      () => refreshAssign(i),
      () => readAssign(i).source,
      () => renderControllers(),
      `assign ${i + 1}`
    )
  );
}

// True once the slot/surface reports a real source (not off, not the "CAPTURE"
// armed-but-waiting placeholder).
function isCaptured(src) {
  return !!src && src !== 'off' && src.toUpperCase() !== 'CAPTURE';
}

// A live Learn overlay: prompt to move a controller, poll `read` (after each
// `refresh`) until it returns a captured source, show it, then `onClose`
// re-reads + repaints behind the dismissed overlay. Appended to <body> (not the
// panel/card) so a deferred repaint of the modal cannot wipe it mid-Learn.
function startLearnPoll(refresh, read, onClose, label) {
  document.querySelector('.mm-learn-overlay')?.remove(); // never stack two
  const ov = document.createElement('div');
  ov.className = 'mm-learn-overlay';
  const msg = document.createElement('div');
  msg.className = 'mm-learn-msg';
  msg.textContent = `Move your controller for ${label}…`;
  let stopped = false;
  const finish = () => {
    stopped = true;
    ov.remove();
    onClose();
  };
  const btn = makeButton('Cancel', 'mm-btn mm-learn', finish, false);
  ov.append(msg, btn);
  document.body.append(ov);

  let tries = 0;
  const poll = () => {
    if (stopped) return;
    refresh();
    setTimeout(() => {
      if (stopped) return;
      const src = read();
      if (isCaptured(src)) {
        msg.textContent = `Captured: ${src}`;
        btn.textContent = 'Done';
        return; // stop polling; Done dismisses + repaints with the result
      }
      if (++tries >= MIDI_MAP.LEARN_POLL_TRIES) {
        msg.textContent = 'No controller heard. Move it and retry (check the MIDI channel / omni).';
        btn.textContent = 'Close';
        return;
      }
      poll();
    }, REFRESH);
  };
  poll();
}

// --- 2. Per-parameter mapping card ---------------------------------------

/**
 * Opens the mapping card for a parameter and BINDS the modulation surface to
 * it (the one keypress step). rowIndex is the parameter's 0-based row on the
 * active DSP's main parameter page; paramName is its label for the bind check.
 *
 * @param {{name: string, rowIndex: number}} param
 */
export function openParamMapping(param) {
  if (!cardEl) cardEl = modalShell('mm-modal');
  enableSequenceOut();
  card = {
    key: param.key,
    paramName: param.name,
    rowIndex: param.rowIndex,
    bound: null,
    loading: true,
  };
  cardEl.hidden = false;
  renderCard();
  bindParam(param.rowIndex, (setup) => {
    card.loading = false;
    // The surface title ("<param> setup") is the binding proof. Match the WHOLE
    // first token + a trailing space, not just a prefix — a short name like
    // "in" must NOT match "input gain setup" (review), or a wrong-row bind
    // could write the mapping to the wrong parameter.
    const want = strip(param.name) + ' ';
    card.bound = setup && setup.title && setup.title.startsWith(want) ? setup : null;
    if (!card.bound) card.error = `Could not bind "${param.name}" (got "${setup?.title || '?'}")`;
    // Record what the bind read so the LCD badge reflects the real state.
    if (card.bound) recordParamMapping(card.key, card.bound.source);
    renderCard();
  });
}

export function closeParamMapping() {
  card = null;
  if (cardEl) cardEl.hidden = true;
}

// "level  : %4.0f dB" -> "level"
function strip(label) {
  return String(label).split(/[: ]/)[0];
}

function renderCard() {
  if (!cardEl || cardEl.hidden) return;
  cardEl.innerHTML = '';
  const panel = document.createElement('div');
  panel.className = 'mm-panel mm-card';

  const head = document.createElement('header');
  head.className = 'mm-head';
  const title = document.createElement('span');
  title.className = 'mm-title';
  title.textContent = `MAP ${strip(card?.paramName || '')}`.toUpperCase();
  head.append(title, makeButton('✕', 'mm-close', closeParamMapping, false));
  panel.append(head);

  if (card?.loading) {
    panel.append(note('binding to the parameter…'));
    cardEl.append(panel);
    return;
  }
  if (!card?.bound) {
    panel.append(note(card?.error || 'not bound'));
    panel.append(makeButton('Close', 'mm-btn', closeParamMapping, false));
    cardEl.append(panel);
    return;
  }

  const s = readParamSetup();
  const body = document.createElement('div');
  body.className = 'mm-card-body';

  // Source picker (set by index; degenerate device options, so we own the list).
  body.append(field('source', sourceSelect(s.source)));
  // Sub-fields the source reveals: channel, and the con# for MIDI single/double
  // (this is where the actual CC number shows). Read-only info for now.
  for (const d of s.details || []) {
    const v = document.createElement('span');
    v.className = 'mm-mon';
    v.textContent = d.value;
    body.append(field(d.label, v));
  }
  // Range (depth) — the parameter's display units.
  const range = document.createElement('input');
  range.type = 'number';
  range.className = 'mm-input';
  range.value = parseFloat(s.range) || 0;
  range.addEventListener('change', () => {
    setParamRange(range.value);
    afterWrite();
  });
  body.append(field('range', range));
  const hint = document.createElement('div');
  hint.className = 'mm-note';
  hint.textContent =
    'range = how far the parameter moves across the full controller sweep, in its own units (e.g. dB / ms / %). Negative inverts.';
  body.append(hint);
  // Type.
  body.append(field('type', typeSelect(s.type)));
  // Live monitor.
  const mon = document.createElement('span');
  mon.className = 'mm-mon';
  mon.textContent = s.monitor ? `${Math.round(parseFloat(s.monitor))}%` : '—';
  body.append(field('monitor', mon));
  panel.append(body);

  const foot = document.createElement('div');
  foot.className = 'mm-card-foot';
  foot.append(
    makeButton('Learn', 'mm-btn mm-learn', learnParam, false),
    makeButton(
      'clear',
      'mm-btn',
      () => {
        setParamSource(0);
        afterWrite();
      },
      false
    ),
    makeButton('Done', 'mm-btn', closeParamMapping, false)
  );
  panel.append(foot);
  cardEl.append(panel);
}

function sourceSelect(currentName) {
  const sel = document.createElement('select');
  sel.className = 'mm-input';
  for (const { index, name } of sourceOptions()) {
    const o = document.createElement('option');
    o.value = String(index);
    o.textContent = name;
    if (name === currentName) o.selected = true;
    sel.append(o);
  }
  sel.addEventListener('change', () => {
    setParamSource(parseInt(sel.value, 10));
    afterWrite();
  });
  return sel;
}

function typeSelect(currentValue) {
  const sel = document.createElement('select');
  sel.className = 'mm-input';
  TYPE_OPTIONS.forEach((name, index) => {
    const o = document.createElement('option');
    o.value = String(index);
    o.textContent = name;
    if (currentValue.includes(name)) o.selected = true;
    sel.append(o);
  });
  sel.addEventListener('change', () => {
    setParamType(parseInt(sel.value, 10));
    afterWrite();
  });
  return sel;
}

function learnParam() {
  captureParam(() =>
    startLearnPoll(
      () => refreshParamSetup(),
      () => readParamSetup().source,
      syncBoundMapping, // record + repaint so the LCD badge lights after Learn
      strip(card?.paramName || 'this parameter')
    )
  );
}

// Re-read the bound surface, RECORD the mapping for the LCD badge, then repaint
// the card AND the LCD behind it. Order matters: onChange (the LCD re-render)
// runs LAST, after recordParamMapping — re-rendering before recording left the
// badge unlit even though the mapping had been applied (maintainer report).
function syncBoundMapping() {
  if (card) {
    card.bound = readParamSetup();
    recordParamMapping(card.key, card.bound.source);
  }
  renderCard();
  onChange?.();
}

// A write to the bound surface settles, then we re-read + record + repaint.
function afterWrite() {
  refreshParamSetup();
  setTimeout(syncBoundMapping, REFRESH);
}

function field(label, control) {
  const row = document.createElement('label');
  row.className = 'mm-field';
  const l = document.createElement('span');
  l.className = 'mm-field-label';
  l.textContent = label;
  row.append(l, control);
  return row;
}

function note(text) {
  const d = document.createElement('div');
  d.className = 'mm-note';
  d.textContent = text;
  return d;
}

// Re-export the surface key for callers that need it (e.g. tests).
export const PARAM_SURFACE_KEY = MOD.PARAM_SETUP;
