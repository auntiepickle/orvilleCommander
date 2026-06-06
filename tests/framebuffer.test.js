// tests/framebuffer.test.js
// Direct coverage of the pure framebuffer decoder.

import { denibble, computePixels } from '../src/framebuffer.js';

describe('denibble', () => {
  test('combines high/low nibble pairs into bytes', () => {
    expect(denibble([0x0f, 0x0f, 0x0a, 0x05])).toEqual([0xff, 0xa5]);
  });

  test('drops a trailing unpaired nibble', () => {
    expect(denibble([0x01, 0x02, 0x03])).toEqual([0x12]);
  });
});

describe('computePixels', () => {
  // 13-byte header + 1920 data bytes, all 0xff (every pixel lit).
  const allOn = new Array(13 + 1920).fill(0xff);

  test('returns a full RGBA buffer of the right size', () => {
    const px = computePixels(allOn, { width: 240, height: 64 });
    expect(px).toBeInstanceOf(Uint8ClampedArray);
    expect(px.length).toBe(240 * 64 * 4);
  });

  test('lit pixels are green with full alpha', () => {
    const px = computePixels(allOn);
    // Sample a pixel away from the shifted first 8 columns.
    const idx = (10 * 240 + 100) * 4;
    expect([px[idx], px[idx + 1], px[idx + 2], px[idx + 3]]).toEqual([0, 255, 0, 255]);
  });

  test('shiftMode controls the vacated top pixel of the first 8 columns', () => {
    // Header all 0, data all lit, so row 0 of the first columns is lit pre-shift.
    const bytes = new Array(13).fill(0).concat(new Array(1920).fill(0xff));
    const topGreen = (px) => px[(0 * 240 + 0) * 4 + 1]; // col 0, row 0 green channel
    expect(topGreen(computePixels(bytes, { shiftMode: 'black' }))).toBe(0); // zeroed
    expect(topGreen(computePixels(bytes, { shiftMode: 'edge' }))).toBe(255); // clamped to lit row below
  });
});
