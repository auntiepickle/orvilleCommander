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
export function makeKeyStackEntry(key, subs) {
  const main = (subs && subs[0]) || null;
  const tag =
    (main && ((main.tag || '').trim() || (main.statement || '').split(' ')[0].trim())) || key;
  return { key, tag, subs: (subs || []).slice() };
}
