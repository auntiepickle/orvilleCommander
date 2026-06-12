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
import { KEY } from './sysex-commands.js';

// key -> subs array (the node's own dump: main line + direct children).
const nodes = new Map();
// Per-bank program lists (#141): bankIdx (int) -> { options, value } from
// the load-menu dump taken while that bank was selected. The device only
// exposes ONE bank's program list at a time, so this session memo is the
// only way a revisited bank can render instantly. Cleared by every
// mutation chokepoint (program saves/deletes change the lists).
const bankProgramLists = new Map();
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
  // #141: memoize the program list under the bank it was listed FOR —
  // gated by the SAME #121 generation trust as the structure check above
  // (review): an in-flight pre-mutation dump (e.g. racing a program-load
  // trigger that reorders Favorites) must not launder a pre-load list
  // into the memo.
  if (
    main.key === KEY.FAVORITES &&
    (markGeneration === 0 || requestGeneration.get(main.key) === markGeneration)
  ) {
    const bankSub = subs.find((s) => s.key === KEY.BANK_SELECT);
    const progSub = subs.find((s) => s.key === KEY.PROGRAM_SELECT);
    const bankIdx = parseInt(String(bankSub?.value || '').split(' ')[0], 16);
    if (!isNaN(bankIdx) && progSub?.options?.length) {
      // Shallow copy: the memo must hold its own snapshot, independent of
      // the treat-as-read-only tree node it came from.
      bankProgramLists.set(bankIdx, { options: [...progSub.options], value: progSub.value });
    }
  }
}

/**
 * The memoized program list for a bank index, if this session has seen it
 * (#141). { options, value } as captured from the load-menu dump.
 *
 * @param {number} bankIdx
 * @returns {{options: Object[], value: string}|undefined}
 */
export function bankProgramsFor(bankIdx) {
  return bankProgramLists.get(bankIdx);
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

// How deep a gang chain can nest below a menu before the search/fan-out/
// render gives up — the ONE depth bound every gang consumer shares
// (renderer inline walk, audit reachability walk, ancestry checks here).
// Live ground truth (#132 probe): the routing matrix is the deepest
// observed — menu -> 'Source 1-4' -> 'Source 1/2' -> SET, i.e. 3 levels;
// 4 leaves one level of margin without letting a malformed parent loop
// walk far.
export const GANG_MAX_DEPTH = 4;

/**
 * Is this sub line a "gang group" COL (#132)? Live ground truth from the
 * routing matrix probe: the device expresses the manual's ganged-parameter
 * pages (manual p.20) as COL subtrees whose group nodes carry a BLANK tag
 * and a non-'0' position ('Source 1-4' pos 0x13, 'In 1-4' pos 0xc, the
 * pair nodes likewise). Ordinary navigable menus always carry a tag or
 * position '0' (the blank setup container 100100d0 is pos 0 — not a gang).
 * Gang groups are presentation grouping, not navigation targets: the
 * renderer inlines their subtree instead of emitting softkeys.
 *
 * @param {Object} line - A sub line (from a dump or a tree node).
 * @returns {boolean}
 */
export function isGangCol(line) {
  return !!line && line.type === 'COL' && line.position !== '0' && (line.tag || '') === '';
}

/**
 * Does key sit inside a gang subtree of menuKey (#132)? True when the
 * parent chain from key reaches menuKey within GANG_MAX_DEPTH hops with
 * every INTERMEDIATE node being a gang COL (a direct child qualifies
 * trivially). Drives the parser's gang fan-out and the bridge's
 * child-arrival repaint for gang grandchildren.
 *
 * @param {string} key
 * @param {string} menuKey
 * @returns {boolean}
 */
export function withinGangOf(key, menuKey) {
  let cur = parentOf(key);
  const seen = new Set([key]);
  for (let hops = 0; hops < GANG_MAX_DEPTH && cur !== undefined && !seen.has(cur); hops++) {
    if (cur === menuKey) return true;
    const node = nodes.get(cur);
    if (!node || !isGangCol(node[0])) return false;
    seen.add(cur);
    cur = parentOf(cur);
  }
  return false;
}

/**
 * Finds a param line by key among the children of menuKey's child menus —
 * the tree-derived successor to the childSubs flat scan (embedded child
 * params, C7 CON classification, param-click lookup). Recurses through
 * gang COL subtrees (#132: the routing matrix leaves sit two gang levels
 * below the menu), bounded by GANG_MAX_DEPTH.
 *
 * @param {string} menuKey - The on-screen menu.
 * @param {string} paramKey - The param being looked up.
 * @returns {Object|undefined} The param's sub line, if known.
 */
export function findParamUnder(menuKey, paramKey, depth = 0, seen = new Set()) {
  if (depth > GANG_MAX_DEPTH || seen.has(menuKey)) return undefined;
  seen.add(menuKey);
  const menu = nodes.get(menuKey);
  if (!menu) return undefined;
  for (const child of menu.slice(1)) {
    if (child.type !== 'COL') continue;
    const childNode = nodes.get(child.key);
    const hit = childNode?.slice(1).find((s) => s.key === paramKey);
    if (hit) return hit;
    if (isGangCol(child)) {
      const deep = findParamUnder(child.key, paramKey, depth + 1, seen);
      if (deep) return deep;
    }
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
 * Called by sendValuePut (every in-app put — TRG/STR/SET/NUM) — one of the
 * two in-app mutation chokepoints (the other is sendKeypress).
 *
 * @param {string} key
 */
export function markDirtyIfStable(key) {
  // #138: puts that do NOT change the program/bank LISTS or the menu
  // structure are pure view/runtime changes and must not stale the
  // subtree (else the next PROGRAM visit refetches the multi-second
  // 70-name bank list from cache for nothing):
  //   - BANK_SELECT / PROGRAM_SELECT: pick which list shows.
  //   - LOAD_TRIGGER_A/B: load a program into a DSP — changes the running
  //     preset (root names + the preset param subtree, fetched separately)
  //     but leaves every bank/program list intact. Live finding: staling
  //     here made the post-load refetch reload the bank list WHILE the
  //     device was busy loading, cascading watchdog stalls (~2s of dead
  //     wait). Saves/deletes/renames (other TRG/STR puts) DO rewrite lists
  //     and still stale below.
  if (
    key === KEY.BANK_SELECT ||
    key === KEY.PROGRAM_SELECT ||
    key === KEY.LOAD_TRIGGER_A ||
    key === KEY.LOAD_TRIGGER_B
  ) {
    return;
  }
  const p = stablePrefixOf(key);
  if (!p) return;
  markGeneration++; // #121: in-flight requests are now pre-mutation
  for (const k of nodes.keys()) {
    if (k.startsWith(p)) staleKeys.add(k);
  }
  bankProgramLists.clear(); // a save/delete/rename may rewrite lists
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
  bankProgramLists.clear(); // #141: explicit re-read distrusts the memo too
}

/** Clears the tree (tests). */
export function reset() {
  nodes.clear();
  parents.clear();
  staleKeys.clear();
  requestGeneration.clear();
  bankProgramLists.clear();
  markGeneration = 0;
}
