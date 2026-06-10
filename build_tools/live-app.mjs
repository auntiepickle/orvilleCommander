// Headless live-app harness (T1/G2 substrate).
// Runs the REAL app module graph (main/bridge/parser/renderer) in jsdom
// against the REAL Orville over @julusian/midi — no browser. The session
// drives navigation by dispatching clicks on the rendered LCD and reads the
// virtual render back. This is the G2 "live self-loop" substrate.
//
// Usage: node build_tools/live-app.mjs [walk|stay|load|eager] [settleMs]

import { JSDOM } from 'jsdom';
import midi from '@julusian/midi';
import fs from 'node:fs';

const MODE = process.argv[2] || 'walk';
const SETTLE = parseInt(process.argv[3] || '2500', 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- DOM up first: src modules touch document at import time -------------
const html = fs.readFileSync('src/index.html', 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
});
globalThis.localStorage = dom.window.localStorage;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.Event = dom.window.Event;
globalThis.prompt = () => null;
globalThis.alert = () => {};

// jsdom has no 2d canvas; minimal store so renderBitmap runs (same trick as
// tests/helpers/replay.js).
const canvas = document.getElementById('lcd-canvas');
if (canvas) {
  let store = { width: 0, height: 0, data: new Uint8ClampedArray(0) };
  canvas.getContext = () => ({
    getImageData: (x, y, w, h) => {
      if (store.width !== w || store.height !== h) {
        store = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
      }
      return store;
    },
    putImageData: (img) => {
      store = img;
    },
  });
}

// --- real app modules (main.js wires DOM + registers the event bridge) ---
const { setMidiPorts, addSysexListener } = await import('../src/midi.js');
await import('../src/main.js'); // connectMidi(null) fails harmlessly (no WebMIDI in jsdom)
const { appState } = await import('../src/state.js');
const { setState } = await import('../src/store.js');
const { updateScreen } = await import('../src/renderer.js');
const { KEY, SYSEX } = await import('../src/sysex-commands.js');
const { log } = await import('../src/logger.js');

// --- real MIDI via @julusian/midi, adapted to midi.js's port contract ----
const input = new midi.Input();
const output = new midi.Output();
const findPort = (dev, name) => {
  for (let i = 0; i < dev.getPortCount(); i++) if (dev.getPortName(i).includes(name)) return i;
  return -1;
};
const inIdx = findPort(input, 'MIDIIN3');
const outIdx = findPort(output, 'MIDIOUT2');
if (inIdx < 0 || outIdx < 0) {
  console.error('U6MIDI Pro ports not found (in MIDIIN3 / out MIDIOUT2). Port busy?');
  process.exit(1);
}
input.openPort(inIdx);
output.openPort(outIdx);
input.ignoreTypes(false, true, true); // sysex on, timing/active-sense off

const inAdapter = {
  listeners: [],
  addListener(type, cb) {
    if (type === 'sysex') this.listeners.push(cb);
  },
  removeListener(type, cb) {
    const i = this.listeners.indexOf(cb);
    if (i !== -1) this.listeners.splice(i, 1);
  },
};
input.on('message', (dt, msg) => {
  for (const cb of inAdapter.listeners) cb({ data: msg });
});
const outAdapter = {
  sendSysex: (mfr, data) => output.sendMessage([SYSEX.START, ...mfr, ...data, SYSEX.END]),
};

// --- connect: mirror main.js selectPorts (not exported) ------------------
setMidiPorts(outAdapter, inAdapter, 1);
addSysexListener();
document.getElementById('lcd').innerText = 'Connected. Fetching root screen...';
setState(
  {
    currentKey: KEY.ROOT,
    keyStack: [],
    currentSubs: [],
    pendingLanding: 'root',
    pendingDescend: false,
  },
  'live-app:select-ports-reset'
);
updateScreen(log);
console.log('[live] connected; landing armed');

const lcdText = () => document.getElementById('lcd').textContent;
const dump = (label) => {
  console.log(
    `\n===== ${label} | key=${appState.currentKey} stack=${appState.keyStack.length} =====`
  );
  console.log(lcdText());
};
const click = (selector) => {
  const el = document.querySelector(selector);
  if (!el) return false;
  el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  return true;
};

await sleep(SETTLE + 1500); // landing: root wave + preset wave + descend wave
dump('LANDING');

if (MODE === 'walk') {
  for (const [key, name] of [
    ['10020000', 'program'],
    ['10010000', 'setup'],
    ['10030000', 'levels'],
    ['10030500', 'bypass'],
  ]) {
    const ok = click(`.softkey[data-key="${key}"]`);
    if (!ok) {
      console.log(`\n===== ${name}: NO SOFTKEY ${key} in current render =====`);
      continue;
    }
    await sleep(SETTLE);
    dump(name);
  }
} else if (MODE === 'load') {
  // The "set the machine's program" flow: program menu -> load new preset.
  // Long settles so the giant bank-list dump can drain the link.
  click('.softkey[data-key="10020000"]');
  await sleep(SETTLE);
  dump('program');
  const ok = click('.softkey[data-key="10020010"]');
  console.log('[live] clicked load softkey:', ok);
  await sleep(SETTLE * 2);
  dump('load new preset');
  const selects = document.querySelectorAll('select.param-select').length;
  const trgs = [...document.querySelectorAll('.param-value')].map((e) => e.textContent.trim());
  console.log(`[live] SET dropdowns rendered: ${selects}; TRGs: ${JSON.stringify(trgs)}`);
} else if (MODE === 'eager') {
  // #106 acceptance: the landing armed the eager loader and the drained
  // wave started it (the 'Eager load complete' log above is its own
  // receipt). Quantify tree warmth, then prove the R3 pre-paint serves a
  // cold click from cache by forcing a render while the dump is in flight.
  const { getNode } = await import('../src/tree.js');
  const { renderScreen } = await import('../src/renderer.js');
  await sleep(15000); // generous: the preset subtree is a handful of nodes
  const preset = appState.presetKey;
  const children = (getNode(preset) || []).slice(1).filter((s) => s.type === 'COL');
  let warm = 0;
  let grandTotal = 0;
  let grandWarm = 0;
  for (const c of children) {
    const node = getNode(c.key);
    if (node) warm++;
    for (const g of (node || []).slice(1).filter((s) => s.type === 'COL')) {
      grandTotal++;
      if (getNode(g.key)) grandWarm++;
    }
  }
  console.log(
    `[live] eager warmth for ${preset}: children cached ${warm}/${children.length}; grandchildren cached ${grandWarm}/${grandTotal}`
  );
  // Cold click: navigate to a preset menu the session has never visited,
  // then render IMMEDIATELY (mid-flight, as a busy link's settled render
  // would) — the R3 guard must pre-paint the eager-cached structure, not
  // the old menu.
  const target = children[children.length - 1];
  if (target && click(`.softkey[data-key="${target.key}"]`)) {
    renderScreen(appState.currentSubs, appState.lastAscii, log);
    console.log(`\n===== PRE-PAINT (immediately after clicking ${target.key}, no settle) =====`);
    console.log(lcdText());
    await sleep(SETTLE);
    dump('after settle (live dump landed)');
  } else {
    console.log(`[live] no clickable softkey for ${target?.key}`);
  }

  // Phase 2: force a DEEP walk from root. The preset subtree is shallow
  // enough that the landing fan-out covers it (0 fetched), so this is the
  // live exercise of the serialized FETCH-ADVANCE path (the review-blocker
  // regression check: background fetches advance at wave boundaries, not
  // via objectinfo:received). Includes the program subtree's bank-list
  // dump — the worst case a single serialized fetch can hit.
  const { startEagerLoad } = await import('../src/eager-loader.js');
  console.log('[live] phase 2: forcing a deep eager walk from root...');
  startEagerLoad(KEY.ROOT);
  await sleep(90000);
  console.log('[live] deep-walk window closed (see Eager load complete above for the receipt)');
}

console.log('\n===== last dumpComplete =====');
console.log(JSON.stringify(appState.lastDumpComplete));
input.closePort();
output.closePort();
process.exit(0);
