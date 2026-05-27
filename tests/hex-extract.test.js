import { extractNibblesFromHex } from '../src/hex-extract.js';

describe('extractNibblesFromHex', () => {
  test('returns null when input has no hex digits at all', () => {
    // Note: a-f are valid hex digits, so test strings must avoid them.
    // Using only 'g-z' chars and punctuation guarantees no regex matches.
    expect(extractNibblesFromHex('zzz wrong junk!!!')).toBeNull();
    expect(extractNibblesFromHex('')).toBeNull();
  });

  test('returns null when the 0x17 start marker is absent', () => {
    // Input has hex digits but no 17 byte — formerly returned all hex
    // from index 0 onward because indexOf returns -1 and -1 + 1 = 0.
    const input = 'aa bb cc dd';
    expect(extractNibblesFromHex(input)).toBeNull();
  });

  test('extracts nibbles between 0x17 and 0xF7 markers', () => {
    // 17 = start marker, then payload nibbles, then f7 = end marker
    const input = 'aa 17 01 02 03 04 f7 ff';
    const result = extractNibblesFromHex(input);
    expect(result).toEqual([0x01, 0x02, 0x03, 0x04]);
  });

  test('handles 17 at index 0 — regression for the || falsy bug', () => {
    // Old code: startIdx = indexOf('17') + 1 = 1; endIdx = indexOf('f7', 1).
    // If f7 was at index 0 this would have returned 0, which `|| length`
    // would silently replace with length. Symmetric concern: this test
    // ensures the start case at index 0 still works.
    const input = '17 0a 0b 0c f7';
    const result = extractNibblesFromHex(input);
    expect(result).toEqual([0x0a, 0x0b, 0x0c]);
  });

  test('handles missing 0xF7 terminator by taking the rest of the input', () => {
    // This is the bug. Old code: indexOf returns -1, `-1 || length` is -1,
    // slice(startIdx, -1) silently DROPS THE LAST element. The fix should
    // take everything from startIdx to end.
    const input = '17 0a 0b 0c';
    const result = extractNibblesFromHex(input);
    expect(result).toEqual([0x0a, 0x0b, 0x0c]);
  });

  test('is case-insensitive on input', () => {
    const input = '17 AB CD f7';
    const result = extractNibblesFromHex(input);
    expect(result).toEqual([0xab, 0xcd]);
  });
});
