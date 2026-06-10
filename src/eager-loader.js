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
// in flight at a time, advanced by its own objectinfo:received response.
// The serialized walk adds at most one response of latency to any user
// navigation — unlike the blast-everything fan-out R5 measured, where the
// program menu's 9-child prefetch starved navigation for seconds behind the
// ~70-name bank list. The preset subtree contains no bank lists, but the
// loader does not rely on that. Already-cached nodes are skipped without a
// request (the parser's own per-menu fan-out covers depth 1, so the loader
// mostly fetches depth 2+); a wave watchdog while a fetch is pending skips
// that node and moves on.
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
 * active preset after a connect landing. Idempotent per response: each
 * node is visited once; cached nodes cost no request. Call AFTER the
 * landing wave drains so the parser's fan-out responses are already
 * tree-recorded (the bridge gates this on the all-received dumpComplete).
 *
 * @param {string} rootKey - Subtree root (e.g. '401000b').
 */
export function startEagerLoad(rootKey) {
  teardown();
  if (!rootKey) return;
  log(`Eager load starting from ${rootKey} (depth <= ${EAGER.MAX_DEPTH})`, 'info', 'general');
  unsubscribers.push(
    on('objectinfo:received', ({ key }) => {
      if (pendingKey === null || key !== pendingKey) return;
      const depth = pendingDepth;
      pendingKey = null;
      enqueueChildren(key, depth);
      step();
    })
  );
  unsubscribers.push(
    on('dumpComplete', (payload) => {
      // A stalled wave means the pending response is not coming (or came
      // late and will be tree-recorded anyway); skip the node, keep walking.
      if (payload?.reason === 'watchdog' && pendingKey !== null) {
        log(`Eager load: no dump for ${pendingKey} (wave stalled); skipping`, 'info', 'general');
        pendingKey = null;
        step();
      }
    })
  );
  queue.push({ key: rootKey, depth: 0 });
  step();
}

/** Cancels an in-progress eager load (teardown/tests). */
export function stopEagerLoad() {
  teardown();
}
