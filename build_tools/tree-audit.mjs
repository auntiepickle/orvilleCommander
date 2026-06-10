// Tree auditor (T1). Validates the app render against the device tree.
// Phase 1: fetch the device's object tree directly (sequential OBJECTINFO,
//   one in flight, parsed with the real parseSubObject) — ground truth.
// Phase 2: boot the REAL app headless (jsdom + midi adapters) and, for every
//   COL node, navigate to it with tree-computed ancestors, wait for quiet,
//   and diff the rendered LCD against the node's own dump.
// Violations are emitted as JSON lines and summarized; report saved to
// logs/tree-audit-report.json.
//
// Usage: node build_tools/tree-audit.mjs [maxDepth=2] [quietMs=1500] [capMs=15000]

import { JSDOM } from 'jsdom';
import midi from '@julusian/midi';
import fs from 'node:fs';

const MAX_DEPTH = parseInt(process.argv[2] || '2', 10);
const QUIET_MS = parseInt(process.argv[3] || '1500', 10);
const CAP_MS = parseInt(process.argv[4] || '15000', 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- DOM + app boot (same recipe as live-app.mjs) ------------------
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
const canvas = document.getElementById('lcd-canvas');
if (canvas) {
  let store = { width: 0, height: 0, data: new Uint8ClampedArray(0) };
  canvas.getContext = () => ({
    getImageData: (x, y, w, h) => {
      if (store.width !== w || store.height !== h)
        store = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
      return store;
    },
    putImageData: (img) => {
      store = img;
    },
  });
}

const { parseSubObject } = await import('../src/parser.js');
const { setMidiPorts, addSysexListener } = await import('../src/midi.js');
await import('../src/main.js');
const { appState } = await import('../src/state.js');
const { setState } = await import('../src/store.js');
const { updateScreen } = await import('../src/renderer.js');
const { deriveKeyStack, getNode, recordDump } = await import('../src/tree.js');
const { KEY, CMD, SYSEX } = await import('../src/sysex-commands.js');
const { log } = await import('../src/logger.js');

// ---------- real MIDI ------------------------------------------------------
const input = new midi.Input();
const output = new midi.Output();
const findPort = (dev, name) => {
  for (let i = 0; i < dev.getPortCount(); i++) if (dev.getPortName(i).includes(name)) return i;
  return -1;
};
const inIdx = findPort(input, 'MIDIIN3');
const outIdx = findPort(output, 'MIDIOUT2');
if (inIdx < 0 || outIdx < 0) {
  console.error('U6MIDI Pro ports not found (MIDIIN3 in / MIDIOUT2 out). Port busy?');
  process.exit(1);
}
input.openPort(inIdx);
output.openPort(outIdx);
input.ignoreTypes(false, true, true);
let lastMsgAt = Date.now();
input.on('message', () => {
  lastMsgAt = Date.now();
});

// ---------- Phase 1: raw sequential tree fetch -----------------------------
const DEV = 1;
function requestObjectinfo(key) {
  const ascii = key.split('').map((c) => c.charCodeAt(0));
  output.sendMessage([
    SYSEX.START,
    ...SYSEX.MANUFACTURER,
    DEV,
    CMD.OBJECTINFO_DUMP,
    ...ascii,
    SYSEX.END,
  ]);
}
function awaitDump(forKey, timeoutMs = 12000) {
  return new Promise((resolve) => {
    let buf = [];
    const onMsg = (dt, msg) => {
      const data = Array.from(msg);
      if (data[0] === SYSEX.START) buf = data;
      else buf = buf.concat(data);
      if (buf[0] === SYSEX.START && buf[buf.length - 1] === SYSEX.END) {
        const frame = buf;
        buf = [];
        if (frame[4] !== CMD.OBJECTINFO) return; // not an OBJECTINFO dump
        const ascii = String.fromCharCode(...frame.slice(SYSEX.FRAME_PREFIX_LEN, -1))
          .replace(/\0+$/, '')
          .trim();
        const subs = ascii
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .map(parseSubObject);
        if (subs[0]?.key === forKey) {
          cleanup();
          resolve(subs);
        }
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      input.off('message', onMsg);
    };
    input.on('message', onMsg);
  });
}

console.log(`[audit] phase 1: fetching tree (depth <= ${MAX_DEPTH})...`);
const tree = new Map(); // key -> { subs, depth, parentKey }
const queue = [{ key: KEY.ROOT, depth: 0, parentKey: null }];
const visited = new Set();
while (queue.length) {
  const { key, depth, parentKey } = queue.shift();
  if (visited.has(key)) continue;
  visited.add(key);
  requestObjectinfo(key);
  const subs = await awaitDump(key);
  if (!subs) {
    console.log(`[audit] WARN no dump for ${key} (timeout)`);
    continue;
  }
  tree.set(key, { subs, depth, parentKey });
  if (depth < MAX_DEPTH) {
    for (const s of subs.slice(1)) {
      if (s.type === 'COL' && !visited.has(s.key)) {
        queue.push({ key: s.key, depth: depth + 1, parentKey: key });
      }
    }
  }
  await sleep(120); // polite gap; keeps the link drained between nodes
}
console.log(`[audit] phase 1 done: ${tree.size} nodes fetched`);

// ---------- Phase 2: boot the app and audit each COL node ------------------
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
setMidiPorts(outAdapter, inAdapter, DEV);
addSysexListener();

// Seed the app's tree with the phase-1 dumps (production equivalence: a user
// reaching any audited node has necessarily loaded its ancestors' dumps,
// which the parser tree-records). Phase 2's live dumps keep updating it.
for (const [, n] of tree) recordDump(n.subs);

async function settleOn(key) {
  const start = Date.now();
  while (Date.now() - start < CAP_MS) {
    const onNode = appState.currentSubs?.[0]?.key === key;
    const quiet = Date.now() - lastMsgAt >= QUIET_MS;
    if (onNode && quiet) return true;
    await sleep(150);
  }
  return appState.currentSubs?.[0]?.key === key;
}

const violations = [];
const flag = (nodeKey, type, detail) => {
  violations.push({ nodeKey, name: tree.get(nodeKey)?.subs?.[0]?.statement || '', type, detail });
};

const colNodes = [...tree.entries()].filter(
  ([k, n]) => n.subs[0]?.type === 'COL' && k !== KEY.ROOT
);
console.log(`[audit] phase 2: auditing ${colNodes.length} COL nodes...`);

for (const [key, node] of colNodes) {
  // Drain the link BEFORE navigating so the previous node's backlog (e.g.
  // the program fan-out's bank list, or a no-render timeout's stragglers)
  // cannot starve this node's settle window (R5).
  {
    const t0 = Date.now();
    while (Date.now() - lastMsgAt < QUIET_MS && Date.now() - t0 < CAP_MS) await sleep(150);
  }
  // Navigate with the APP's tree-derived stack (T1b/#105): phase 2 visits
  // nodes in BFS order, so every ancestor's dump has already been received
  // and tree-recorded by the app — the production derivation is exercised,
  // and violation 4 checks it against the auditor's independent ground truth.
  const keyStack = deriveKeyStack(key);
  setState(
    { currentKey: key, keyStack, currentSubs: [], pendingLanding: null, pendingDescend: false },
    'audit:navigate'
  );
  updateScreen(log);
  const settled = await settleOn(key);
  if (!settled) {
    flag(key, 'no-render', 'node dump never became the rendered menu within cap');
    continue;
  }

  const main = document.querySelector('.main-content');
  const mainText = main?.textContent || '';
  const mainKeys = [...(main?.querySelectorAll('[data-key]') || [])].map((e) => e.dataset.key);
  const children = node.subs.slice(1);

  // 1. Child reachability: every COL child needs a UI affordance.
  const embedCandidate = children.find((s) => s.type === 'COL' && s.position === '0');
  for (const c of children.filter((s) => s.type === 'COL')) {
    const asSoftkey = mainKeys.includes(c.key);
    const asEmbed = c.key === embedCandidate?.key && (getNode(c.key)?.length || 0) > 0;
    if (!asSoftkey && !asEmbed) {
      flag(
        key,
        'unreachable-child',
        `${c.key} '${c.statement}': absent despite the all-COL softkey rule (T1b)`
      );
    }
  }

  // 2. Params rendered exactly once.
  for (const p of children.filter((s) => s.type !== 'COL' && s.type !== '8')) {
    const keyCount = mainKeys.filter((k) => k === p.key).length;
    const stmtFrag = p.statement ? p.statement.replace(/%.*$/, '').trim() : '';
    const tagFrag = (p.tag || '').trim();
    const valFrag = (p.value || '').trim().slice(0, 20);
    if (!stmtFrag && !tagFrag && !valFrag) continue; // blank spacers: render-skip by design
    if (p.type === 'INF' && !stmtFrag && !valFrag) continue; // pure-format INF, value arrives later
    const textHit =
      (stmtFrag && mainText.includes(stmtFrag)) ||
      (p.type === 'INF' && valFrag && mainText.includes(valFrag)) || // INF renders its value
      (tagFrag && mainText.includes(tagFrag)); // blanket short-text fallback (bar CONs render tag-only, no data-key)
    if (keyCount === 0 && !textHit) {
      flag(key, 'param-missing', `${p.type} ${p.key} '${p.statement}' not rendered`);
    } else if (keyCount > 1) {
      flag(key, 'param-duplicated', `${p.type} ${p.key} rendered ${keyCount}x`);
    }
  }

  // 3. No duplicate softkeys inside main-content (R2's signature).
  const softkeyKeys = [...(main?.querySelectorAll('.softkey') || [])].map((e) => e.dataset.key);
  const dupes = softkeyKeys.filter((k, i) => softkeyKeys.indexOf(k) !== i);
  if (dupes.length) flag(key, 'duplicate-softkeys', [...new Set(dupes)].join(','));

  // 4. Breadcrumb = real tree parent.
  const back = document.querySelector('.back-link');
  const treeParent = node.parentKey;
  if (treeParent && back && back.dataset.key !== treeParent) {
    flag(key, 'wrong-breadcrumb', `back-link -> ${back.dataset.key}, tree parent is ${treeParent}`);
  } else if (treeParent && !back) {
    flag(key, 'no-breadcrumb', `expected back-link to ${treeParent}`);
  }
}

// ---------- report ----------------------------------------------------------
const byType = {};
for (const v of violations) byType[v.type] = (byType[v.type] || 0) + 1;
fs.writeFileSync(
  'logs/tree-audit-report.json',
  JSON.stringify(
    { depth: MAX_DEPTH, nodes: tree.size, audited: colNodes.length, byType, violations },
    null,
    2
  )
);
console.log(`\n[audit] ===== REPORT (depth ${MAX_DEPTH}) =====`);
console.log(`[audit] nodes fetched: ${tree.size}; COL nodes audited: ${colNodes.length}`);
console.log(`[audit] violations by type: ${JSON.stringify(byType)}`);
for (const v of violations.slice(0, 40)) {
  console.log(`  ${v.type} @ ${v.nodeKey} '${v.name}': ${v.detail}`);
}
if (violations.length > 40) console.log(`  ... +${violations.length - 40} more (see report json)`);
console.log('[audit] full report -> logs/tree-audit-report.json');
input.closePort();
output.closePort();
process.exit(0);
