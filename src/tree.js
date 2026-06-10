// tree.js — the device object tree (T1b, GH #105).
//
// Every OBJECTINFO dump describes one node and names its direct children, so
// the parser records every dump here unconditionally. Parent linkage comes
// from the PARENT's dump (a dump cannot self-identify its parent — the main
// line echoes its own key in the parent slot, device-model.md §3); every
// click-path navigation has necessarily loaded the parent, so ancestry is
// available wherever the user actually is. Newest dump wins: structure
// changes (e.g. a preset load) are absorbed by the per-visit child refetch.
//
// Module state, like logger.js (see CLAUDE.md "Where state lives"): the tree
// is a cache of device-confirmed structure, not view state — view state
// (currentKey, the derived keyStack) stays on appState.

import { softkeyLabel } from './navigation.js';

// key -> subs array (the node's own dump: main line + direct children).
const nodes = new Map();
// childKey -> { parentKey, sub } where sub is the child's line in the
// parent's dump (carries the authoritative tag/statement for labeling even
// before the child's own dump has loaded).
const parents = new Map();

/**
 * Records an OBJECTINFO dump: stores the node under its own key and links
 * every listed child back to it. Called by the parser for every 0x32.
 *
 * @param {Object[]} subs - Parsed dump (main line + children).
 */
export function recordDump(subs) {
  const main = subs?.[0];
  if (!main?.key) return;
  nodes.set(main.key, subs);
  for (const s of subs.slice(1)) {
    if (s.key) parents.set(s.key, { parentKey: main.key, sub: s });
  }
}

/**
 * The node's own dump, if it has ever been fetched.
 *
 * @param {string} key
 * @returns {Object[]|undefined}
 */
export function getNode(key) {
  return nodes.get(key);
}

/**
 * The key's parent per the tree, or undefined when unknown / at root.
 *
 * @param {string} key
 * @returns {string|undefined}
 */
export function parentOf(key) {
  return parents.get(key)?.parentKey;
}

/**
 * Rootward ancestor chain for a key, nearest-root first (excludes the key
 * itself) — the shape the derived keyStack wants. Empty when ancestry is
 * unknown (e.g. a deep jump before any ancestor's dump loaded).
 *
 * @param {string} key
 * @returns {string[]}
 */
export function ancestorsOf(key) {
  const chain = [];
  let cur = parentOf(key);
  // The visited guard makes a (theoretical) parent cycle terminate; the
  // device's structure is a tree/DAG, but parents holds last-observed links.
  const seen = new Set([key]);
  while (cur !== undefined && !seen.has(cur)) {
    chain.unshift(cur);
    seen.add(cur);
    cur = parentOf(cur);
  }
  return chain;
}

/**
 * Finds a param line by key among the direct children of menuKey's child
 * menus — the tree-derived successor to the childSubs flat scan (embedded
 * child params, C7 CON classification, param-click lookup).
 *
 * @param {string} menuKey - The on-screen menu.
 * @param {string} paramKey - The param being looked up.
 * @returns {Object|undefined} The param's sub line, if known.
 */
export function findParamUnder(menuKey, paramKey) {
  const menu = nodes.get(menuKey);
  if (!menu) return undefined;
  for (const child of menu.slice(1)) {
    if (child.type !== 'COL') continue;
    const childNode = nodes.get(child.key);
    const hit = childNode?.slice(1).find((s) => s.key === paramKey);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Display label for a node (T1b blank-node policy, live-grounded): the
 * softkeyLabel of its own main line or of its line in the parent's dump;
 * when BOTH are blank, the first labeled child's label (the physical SETUP
 * row labels the blank container by its child, 'dsp B'); else a '...'
 * placeholder until the children load. Never returns '' for a known node,
 * so every COL child has a softkey affordance.
 *
 * @param {string} key
 * @returns {string}
 */
export function labelFor(key) {
  const ownLine = nodes.get(key)?.[0];
  const parentLine = parents.get(key)?.sub;
  const direct = (ownLine && softkeyLabel(ownLine)) || (parentLine && softkeyLabel(parentLine));
  if (direct) return direct;
  const node = nodes.get(key);
  if (node) {
    for (const child of node.slice(1)) {
      const childLabel = softkeyLabel(child);
      if (childLabel) return childLabel;
    }
  }
  return '...';
}

/** Clears the tree (tests). */
export function reset() {
  nodes.clear();
  parents.clear();
}
