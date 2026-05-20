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
