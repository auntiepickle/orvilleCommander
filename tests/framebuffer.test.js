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
    const idx = (10 * 240 + 100) * 4;
    expect([px[idx], px[idx + 1], px[idx + 2], px[idx + 3]]).toEqual([0, 255, 0, 255]);
  });

  test('row-major MSB-left decode with the default 12-byte header', () => {
    // header(12) zeros, then row 0's first byte = 0x80 (only the top-left pixel lit).
    const bytes = new Array(12).fill(0);
    bytes.push(0x80); // row 0, byte 0
    while (bytes.length < 12 + 1920) bytes.push(0);
    const px = computePixels(bytes);
    expect(px[(0 * 240 + 0) * 4 + 1]).toBe(255); // (0,0) lit
    expect(px[(0 * 240 + 1) * 4 + 1]).toBe(0); // (1,0) off
  });

  test('header offset shifts where pixel data starts', () => {
    // Same byte placed for a 13-byte header should NOT light (0,0).
    const bytes = new Array(13).fill(0);
    bytes.push(0x80);
    while (bytes.length < 13 + 1920) bytes.push(0);
    expect(computePixels(bytes, { header: 12 })[(0 * 240 + 0) * 4 + 1]).toBe(0);
    expect(computePixels(bytes, { header: 13 })[(0 * 240 + 0) * 4 + 1]).toBe(255);
  });
});
