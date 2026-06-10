// eager-loader.js — background structure warm-up for the active preset
// subtree (#106, the second half of T1's tree model).
//
// After the connect landing's wave drains, the loader walks the active
// preset's COL tree breadth-first and fetches each unvisited node's
// OBJECTINFO dump, so the persistent tree (tree.js) knows every menu before
// the user navigates: the R3 pre-paint then always has structure to show,
// and embeds appear instantly.
//
// Request scheduling (per the R5 link-contention data): exactly ONE request
// in flight at a time. The advance signal is the TREE at wave boundaries,
// not an event-per-response: the parser emits objectinfo:received only for
// keys related to the on-screen menu, and the loader's background fetches
// are by construction NOT that (review finding) — they are silently
// tree-recorded. But every request joins the single global wave, so each
// dumpComplete (drained or watchdogged) is a decision point: if the tree
// now knows the pending node, advance and enqueue its children; if not,
// the response is not coming — skip it and keep walking. In the common
// background case the loader's request is its own wave of one, so the
// advance is immediate.
//
// The serialized walk adds at most one response of latency to any user
// navigation — unlike the blast-everything fan-out R5 measured, where the
// program menu's 9-child prefetch starved navigation for seconds behind the
// ~70-name bank list. The preset subtree contains no bank lists, but the
// loader does not rely on that. Already-cached nodes are skipped without a
// request (the parser's own per-menu fan-out covers depth 1, so the loader
// mostly fetches depth 2+).
//
// Values are deliberately NOT prefetched (deviation from the original #106
// sketch, decided with T1b in place): currentValues is per-visit volatile by
// design — renderer.js:updateScreen clears it on every navigation (C8) — so
// eagerly fetched values would be discarded before the user ever saw them.
// Structure is durable (the tree persists); values are fetched fresh per
// visit, which is also the staleness guarantee.

import { on } from './events.js';
import { sendObjectInfoDump } from './midi.js';
import { getNode } from './tree.js';
import { EAGER } from './constants.js';
import { log } from './logger.js';

// Walk state. One load at a time; a new start resets and supersedes.
let queue = []; // [{ key, depth }]
let visited = new Set();
let pendingKey = null; // the single in-flight OBJECTINFO key
let pendingDepth = 0; // its depth, for bounding the children it reveals
let fetched = 0;
let unsubscribers = [];
// Stale-handler guard: events.js emits over a snapshot, so a handler torn
// down DURING an emit still receives that in-flight event once; a handler
// whose token no longer matches belongs to a superseded walk and must
// no-op (module state is shared across walks).
let walkId = 0;

function teardown() {
  for (const off of unsubscribers) off();
  unsubscribers = [];
  queue = [];
  visited = new Set();
  pendingKey = null;
  pendingDepth = 0;
  fetched = 0;
}

function enqueueChildren(key, depth) {
  if (depth >= EAGER.MAX_DEPTH) return;
  const node = getNode(key);
  if (!node) return;
  for (const s of node.slice(1)) {
    if (s.type === 'COL' && s.key && !visited.has(s.key)) {
      queue.push({ key: s.key, depth: depth + 1 });
    }
  }
}

// Advance the walk: drain cached nodes synchronously (no request), send for
// the first uncached one, or finish when the queue is empty.
function step() {
  while (queue.length > 0) {
    const { key, depth } = queue.shift();
    if (visited.has(key)) continue;
    visited.add(key);
    if (getNode(key)) {
      enqueueChildren(key, depth);
      continue;
    }
    pendingKey = key;
    pendingDepth = depth;
    fetched++;
    sendObjectInfoDump(key);
    return;
  }
  log(`Eager load complete: ${visited.size} nodes walked, ${fetched} fetched`, 'info', 'general');
  teardown();
}

/**
 * Starts (or restarts) the eager structure walk from a root key — the
 * active preset after a connect landing. Each node is visited once; cached
 * nodes cost no request. Call AFTER the landing wave drains so the
 * parser's fan-out responses are already tree-recorded (the bridge gates
 * this on the all-received dumpComplete). Safe to call from inside a
 * dumpComplete handler: events.js emits over a snapshot, so the in-flight
 * event never reaches the walk's own just-added listener.
 *
 * @param {string} rootKey - Subtree root (e.g. '401000b').
 */
export function startEagerLoad(rootKey) {
  teardown();
  if (!rootKey) return;
  const token = ++walkId;
  log(`Eager load starting from ${rootKey} (depth <= ${EAGER.MAX_DEPTH})`, 'info', 'general');
  unsubscribers.push(
    on('dumpComplete', () => {
      if (token !== walkId || pendingKey === null) return;
      // Decision point: the wave that carried our request either drained
      // (the response is tree-recorded by now — recordDump runs for every
      // 0x32 even when no event is emitted) or stalled. Advance on a known
      // node — INCLUDING after a watchdog, where the response often arrived
      // late behind a bitmap transfer (R5a) — else skip: it is not coming.
      const key = pendingKey;
      const depth = pendingDepth;
      pendingKey = null;
      if (getNode(key)) {
        enqueueChildren(key, depth);
      } else {
        log(`Eager load: no dump recorded for ${key}; skipping`, 'info', 'general');
      }
      step();
    })
  );
  queue.push({ key: rootKey, depth: 0 });
  step();
}

/** Cancels an in-progress eager load (teardown/tests). */
export function stopEagerLoad() {
  teardown();
}
