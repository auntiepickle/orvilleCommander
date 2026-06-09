// tests/framebuffer.test.js
// Direct coverage of the pure framebuffer decoder.

import { denibble, computePixels, parseScreenHeader } from '../src/framebuffer.js';
import { loadFixture } from './helpers/sysex-fixture.js';

// A minimal but well-formed screen dump: 16x2 (bytesPerRow=2, size=4),
// top-left pixel lit, with a valid checksum (sum of size field..checksum == 0).
// header: width=16, height=2, size=4 (each big-endian u32); then 4 pixel
// bytes; then the checksum. sum(bytes[8..end]) = 4 + 0x80 + 0x7c = 256 -> 0.
const tinyScreen = [0, 0, 0, 16, 0, 0, 0, 2, 0, 0, 0, 4, 0x80, 0, 0, 0, 0x7c];

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

  test('derives dimensions from the header when not overridden (FB1)', () => {
    const px = computePixels(tinyScreen);
    expect(px.length).toBe(16 * 2 * 4); // header-reported 16x2, not 240x64
    expect(px[(0 * 16 + 0) * 4 + 1]).toBe(255); // top-left lit
    expect(px[(0 * 16 + 1) * 4 + 1]).toBe(0); // next pixel off
  });

  test('explicit width/height override the header', () => {
    const px = computePixels(tinyScreen, { width: 240, height: 64 });
    expect(px.length).toBe(240 * 64 * 4);
  });

  test('falls back to 240x64 when the header dims are insane', () => {
    const px = computePixels(new Array(13 + 1920).fill(0xff)); // width parses as 0xffffffff
    expect(px.length).toBe(240 * 64 * 4);
  });
});

describe('parseScreenHeader (FB1)', () => {
  test('reads width/height/size and validates a well-formed dump', () => {
    const h = parseScreenHeader(tinyScreen);
    expect(h).toMatchObject({
      width: 16,
      height: 2,
      size: 4,
      bytesPerRow: 2,
      expectedLength: 17, // 12 header + 4 pixels + 1 checksum
      dimsValid: true,
      complete: true,
      checksumOk: true,
    });
  });

  test('flags a checksum mismatch', () => {
    const bad = tinyScreen.slice();
    bad[bad.length - 1] = 0x00; // break the trailing checksum
    const h = parseScreenHeader(bad);
    expect(h.complete).toBe(true);
    expect(h.checksumOk).toBe(false);
  });

  test('flags a truncated dump (the 2048-byte capture failure mode)', () => {
    const truncated = tinyScreen.slice(0, 15); // missing last pixel byte + checksum
    const h = parseScreenHeader(truncated);
    expect(h.expectedLength).toBe(17);
    expect(h.complete).toBe(false);
    expect(h.checksumOk).toBe(false); // not evaluated on an incomplete buffer
  });

  test('reports dims invalid for an all-0xff (garbage) header', () => {
    const h = parseScreenHeader(new Array(20).fill(0xff));
    expect(h.dimsValid).toBe(false);
  });

  test('bytesPerRow rounds up for non-multiple-of-8 widths', () => {
    // width=20 -> ceil(20/8)=3 bytes/row
    const h = parseScreenHeader([0, 0, 0, 20, 0, 0, 0, 1, 0, 0, 0, 3]);
    expect(h.bytesPerRow).toBe(3);
  });

  test('validates a real full-screen hardware capture (240x64, checksum ok)', () => {
    // screen-dump-black-hole.txt is a complete 0x17 capture (1933 denibbled
    // bytes). Pins the real-hardware header + checksum algorithm.
    const msg = loadFixture('screen-dump-black-hole.txt'); // F0 1C 70 dev 17 ... F7
    const raw = denibble(msg.slice(5, msg.length - 1));
    const h = parseScreenHeader(raw);
    expect(h).toMatchObject({
      width: 240,
      height: 64,
      size: 1920,
      expectedLength: 1933,
      dimsValid: true,
      complete: true,
      checksumOk: true,
    });
  });
});
