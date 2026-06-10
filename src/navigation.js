import { LAYOUT } from './constants.js';

/**
 * Toggles a DSP key between '4' (A) and '8' (B) prefixes.
 *
 * @param {string} key - The DSP key to toggle (e.g., '401000b').
 * @returns {string} The toggled key (e.g., '801000b').
 *
 * @example
 * toggleDspKey('401000b'); // '801000b'
 */
export function toggleDspKey(key) {
  return key.startsWith('4') ? '8' + key.slice(1) : '4' + key.slice(1);
}

/**
 * Builds a keyStack entry in the canonical shape (C3/#39): every entry is
 * `{ key, tag, subs }` — no raw-string entries. The tag is derived the same
 * way the renderer always derived parent tags (sub tag, else first word of
 * the statement), falling back to the key itself when the menu's subs are
 * not loaded yet (e.g. pushing root before its dump has arrived), so a
 * breadcrumb always has something meaningful to show.
 *
 * @param {string} key - The menu key being pushed (the menu navigated away from).
 * @param {Object[]} [subs] - That menu's parsed subs, if loaded.
 * @returns {{key: string, tag: string, subs: Object[]}} Normalized entry.
 *
 * @example
 * makeKeyStackEntry('10010000', setupSubs); // { key: '10010000', tag: 'setup', subs: [...] }
 * makeKeyStackEntry('0', []); // { key: '0', tag: '0', subs: [] }
 */
/**
 * Softkey label for a COL child (R9, live-validated): its tag, else the
 * first word of its statement. Empty-tag children are real, navigable pages
 * on the device — the physical LEVELS screen shows the Post D/A Gain pages
 * the old tag-only filter dropped, which made the gain params unreachable in
 * the app. A long tag (over the softkey column budget) still excludes the
 * child, as before. Returns '' when nothing can be derived (fully blank
 * nodes like setup's 100100d0 — a T1b policy question; the tree audit keeps
 * flagging those).
 *
 * @param {Object} s - A parsed sub-object.
 * @returns {string} Display label, or '' when the child has no usable label.
 */
export function softkeyLabel(s) {
  const tag = (s.tag || '').trim();
  if (tag) return tag.length <= LAYOUT.SHORT_TAG_MAX ? tag : '';
  return ((s.statement || '').trim().split(' ')[0] || '').slice(0, LAYOUT.SHORT_TAG_MAX);
}

export function makeKeyStackEntry(key, subs) {
  const main = (subs && subs[0]) || null;
  const tag =
    (main && ((main.tag || '').trim() || (main.statement || '').split(' ')[0].trim())) || key;
  return { key, tag, subs: (subs || []).slice() };
}
