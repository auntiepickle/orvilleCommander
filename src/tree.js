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

import { LAYOUT, CACHE } from './constants.js';

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
 * The node's own dump, if it has ever been fetched. Returns the stored
 * array itself — treat it as read-only; mutating it corrupts the tree.
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
 * clipped label of its own main line or of its line in the parent's dump;
 * when BOTH are blank, the first labeled child's label (the physical SETUP
 * row labels the blank container by its child, 'dsp B'); else a '...'
 * placeholder until the children load. Never returns '' for a known node,
 * so every COL child has a softkey affordance.
 *
 * @param {string} key
 * @returns {string}
 */
// Label from a single sub line: tag, else first statement word — and unlike
// the old navigation.js softkeyLabel rule (deleted in T1b), a LONG tag
// clips instead of excluding. With the tree, the label is presentation
// only: every known COL gets an affordance, so 'unreachable-child' is
// structurally impossible (T1b).
const clipLine = (line) => {
  if (!line) return '';
  const lbl = (line.tag || '').trim() || ((line.statement || '').trim().split(' ')[0] || '').trim();
  return lbl.slice(0, LAYOUT.SHORT_TAG_MAX);
};

export function labelFor(key) {
  const direct = clipLine(nodes.get(key)?.[0]) || clipLine(parents.get(key)?.sub);
  if (direct) return direct;
  const node = nodes.get(key);
  if (node) {
    for (const child of node.slice(1)) {
      const childLabel = clipLine(child);
      if (childLabel) return childLabel;
    }
  }
  return '...';
}

/**
 * Label for a sub line the caller already holds (a child listed in the menu
 * being rendered): the line itself is authoritative when it carries a
 * tag/statement; the tree is consulted only for blank lines (child-derived
 * label per the physical SETUP precedent, else the '...' placeholder).
 *
 * @param {Object} line - A child sub line from the rendered menu's dump.
 * @returns {string} Non-empty display label.
 */
export function labelForSub(line) {
  return clipLine(line) || labelFor(line?.key);
}

/**
 * The derived keyStack for a key (T1b): ancestors computed from tree parent
 * relations, in the canonical C3 {key, tag, subs} entry shape so every
 * existing consumer (breadcrumb, sibling check, parent/grandparent rows)
 * keeps working. Replaces hand-maintained click history; empty when
 * ancestry is unknown (deep jump before any ancestor's dump loaded).
 *
 * @param {string} key - The key being navigated to.
 * @returns {Array<{key: string, tag: string, subs: Object[]}>}
 */
export function deriveKeyStack(key) {
  return ancestorsOf(key).map((aKey) => ({
    key: aKey,
    tag: labelFor(aKey),
    subs: (nodes.get(aKey) || []).slice(),
  }));
}

// --- Stable-subtree freshness (#113) -------------------------------------
// Prefixes from CACHE.STABLE_SUBTREES currently marked dirty (a mutating
// put happened, or an explicit re-read was requested). While a prefix is
// dirty, isFresh() is false for everything under it — visits refetch as if
// the policy did not exist — until the subtree ROOT's fan-out re-requests
// the heavy children and clears it.
const dirtyStablePrefixes = new Set();

const stableSubtreeOf = (key) => CACHE.STABLE_SUBTREES.find((t) => key.startsWith(t.prefix));

/**
 * Whether a key's cached dump may be trusted across visits: tree-cached,
 * under a stable subtree, and that subtree not marked dirty. The parser's
 * per-visit child fan-out skips OBJECTINFO+VALUE for fresh keys (#113).
 *
 * @param {string} key
 * @returns {boolean}
 */
export function isFresh(key) {
  const t = stableSubtreeOf(key);
  return t !== undefined && !dirtyStablePrefixes.has(t.prefix) && nodes.has(key);
}

/**
 * Marks the key's stable subtree dirty, if it is in one. Called by
 * sendValuePut — the single chokepoint every in-app mutating action
 * (TRG/STR/SET/NUM puts) funnels through.
 *
 * @param {string} key
 */
export function markDirtyIfStable(key) {
  const t = stableSubtreeOf(key);
  if (t) dirtyStablePrefixes.add(t.prefix);
}

/** Marks every stable subtree dirty — explicit re-reads (Sync, reconnect). */
export function markAllStableDirty() {
  for (const t of CACHE.STABLE_SUBTREES) dirtyStablePrefixes.add(t.prefix);
}

/**
 * Clears the dirty mark for the subtree whose ROOT menu this is — called by
 * the parser right after that root's child fan-out goes out (the heavy
 * children are now being re-fetched; newest-dump-wins records them). A
 * non-root key clears nothing: a deep visit while dirty must not launder
 * staleness into the rest of the subtree.
 *
 * @param {string} key - The menu whose fan-out just ran.
 */
export function clearDirtyOnRootRefetch(key) {
  const t = CACHE.STABLE_SUBTREES.find((s) => s.rootKey === key);
  if (t) dirtyStablePrefixes.delete(t.prefix);
}

/** Clears the tree (tests). */
export function reset() {
  nodes.clear();
  parents.clear();
  dirtyStablePrefixes.clear();
}
