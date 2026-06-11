// tree.js — the device object tree (T1b, GH #105).
//
// Every OBJECTINFO dump describes one node and names its direct children, so
// the parser records every dump here unconditionally. Parent linkage comes
// from the PARENT's dump (a dump cannot self-identify its parent — the main
// line echoes its own key in the parent slot, device-model.md §3); every
// click-path navigation has necessarily loaded the parent, so ancestry is
// available wherever the user actually is. Newest dump wins: structure
// changes (e.g. a preset load) are absorbed by the per-visit child refetch
// — except in stable subtrees (#113), where the refetch is skipped for
// fresh keys and mutation chokepoints mark staleness instead.
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
  // #121 generation check: a stable-subtree dump may be trusted across
  // visits only if its REQUEST was stamped after the latest mutation mark
  // — an in-flight dump racing a put would otherwise record pre-mutation
  // structure as fresh (both race variants: a stale refetch overtaken by a
  // put, and a never-cached child whose pre-put request lands post-mark).
  // Generation 0 (no mutation ever marked since reset) trusts everything:
  // nothing can predate a mutation that never happened — this keeps
  // seeding (audit phase 1) and cold caches trusted without stamps.
  const p = stablePrefixOf(main.key);
  if (p) {
    if (markGeneration === 0 || requestGeneration.get(main.key) === markGeneration) {
      staleKeys.delete(main.key);
    } else {
      // Recorded (newest data we have, labels/embeds may use it) but NOT
      // trusted across visits: the next visit refetches.
      staleKeys.add(main.key);
    }
    // The stamp is NOT consumed (review finding): a double-requested key
    // (rapid double navigation fans out twice) gets two responses, and
    // consuming on the first would flip the second — genuinely post-mark —
    // back to stale, silently defeating the warm path. The stamp stays
    // until the next stampStableRequest overwrites it or reset() clears;
    // a later mutation bumps the generation, so the kept stamp can never
    // launder a pre-mutation response. Memory is bounded by the stable
    // key count.
  }
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
// Per-KEY staleness for nodes under CACHE.STABLE_SUBTREE_PREFIXES. Marking
// stales every CACHED key under the prefix; a key becomes fresh again only
// when recordDump actually re-records IT (the delete in recordDump). This
// is drop-tolerant by construction: a refetch whose response never arrives
// leaves the key stale, so the next visit retries — and a deep visit can
// never launder staleness into siblings it did not re-record.
const staleKeys = new Set();

// #121 mutation generations. Every mutation mark bumps the generation;
// sendObjectInfoDump stamps a stable key's request with the generation
// current AT REQUEST TIME. recordDump trusts the response only when the
// stamp matches — a response whose request predates the latest mutation
// may carry pre-mutation structure, so it records but stays stale.
let markGeneration = 0;
const requestGeneration = new Map(); // stable key -> generation when requested

const stablePrefixOf = (key) => CACHE.STABLE_SUBTREE_PREFIXES.find((p) => key.startsWith(p));

/**
 * Stamps a stable-subtree OBJECTINFO request with the current mutation
 * generation (#121). Called by sendObjectInfoDump for every request; a
 * no-op for keys outside stable subtrees. Tests simulating the
 * request->response cycle must stamp before recordDump, as production does.
 *
 * @param {string} key
 */
export function stampStableRequest(key) {
  if (stablePrefixOf(key)) requestGeneration.set(key, markGeneration);
}

/**
 * Whether a key's cached dump may be trusted across visits: tree-cached,
 * under a stable prefix, and not marked stale. The parser's per-visit
 * child fan-out skips the OBJECTINFO refetch for fresh keys (#113) —
 * param VALUES are still refreshed every visit.
 *
 * @param {string} key
 * @returns {boolean}
 */
export function isFresh(key) {
  return stablePrefixOf(key) !== undefined && nodes.has(key) && !staleKeys.has(key);
}

/**
 * Stales every cached key under the given key's stable prefix, if any.
 * Called by sendValuePut (every in-app put — TRG/STR/SET/NUM, including
 * bank selects, which change the device's program list) — one of the two
 * in-app mutation chokepoints (the other is sendKeypress).
 *
 * @param {string} key
 */
export function markDirtyIfStable(key) {
  const p = stablePrefixOf(key);
  if (!p) return;
  markGeneration++; // #121: in-flight requests are now pre-mutation
  for (const k of nodes.keys()) {
    if (k.startsWith(p)) staleKeys.add(k);
  }
}

/**
 * Stales every cached key under every stable prefix — explicit re-reads
 * (Sync-to-Hardware, reconnect) and virtual front-panel keypresses (which
 * drive the real device UI, so any press could be part of a mutating
 * sequence the app cannot interpret).
 */
export function markAllStableDirty() {
  markGeneration++; // #121: in-flight requests are now pre-mutation
  for (const p of CACHE.STABLE_SUBTREE_PREFIXES) {
    for (const k of nodes.keys()) {
      if (k.startsWith(p)) staleKeys.add(k);
    }
  }
}

/** Clears the tree (tests). */
export function reset() {
  nodes.clear();
  parents.clear();
  staleKeys.clear();
  requestGeneration.clear();
  markGeneration = 0;
}
