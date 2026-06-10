// tests/navigation.test.js
// Covers toggleDspKey. The C3/#39 keyStack-entry helper (makeKeyStackEntry)
// and the R9 label rule (softkeyLabel) were replaced by the tree-derived
// equivalents in src/tree.js (T1b/#105) — see tests/tree.test.js.

import { toggleDspKey } from '../src/navigation.js';

describe('toggleDspKey', () => {
  test('flips the DSP prefix both ways', () => {
    expect(toggleDspKey('401000b')).toBe('801000b');
    expect(toggleDspKey('801000b')).toBe('401000b');
  });
});
