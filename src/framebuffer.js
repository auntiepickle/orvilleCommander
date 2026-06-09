// framebuffer.js
// Pure decoding of the Orville 240x64 1bpp screen into RGBA pixels. Zero
// dependencies so the canvas renderer (bitmap.js), the replay harness, and
// the offline PNG tool all share one faithful implementation.
//
// Format (reverse-engineered; not in system_commands.txt, which only documents
// button-press SysEx): a 0x17 screen dump denibbles to a 12-byte header, then
// 1920 bytes of 240x64 1bpp screen data (30 bytes/row, MSB = leftmost pixel),
// then 1 trailing byte. Earlier code used a 13-byte header and compensated for
// the resulting 1-byte misalignment with a column rotate + a 1px shift of the
// first 8 columns; both are unnecessary once the header is counted correctly.

import { SCREEN } from './sysex-commands.js';

const NO_FLIP = true; // bit order is MSB-left as-is; flip path kept for safety

// Bit reverse table (used only if NO_FLIP is ever set false).
const bit_reverse_table = new Array(256);
for (let i = 0; i < 256; i++) {
  bit_reverse_table[i] = parseInt(i.toString(2).padStart(8, '0').split('').reverse().join(''), 2);
}

// Denibble a nibble stream (high/low 4-bit pairs) back into bytes.
export function denibble(nibbles) {
  const rawBytes = [];
  for (let i = 0; i < nibbles.length; i += 2) {
    if (i + 1 < nibbles.length) {
      rawBytes.push((nibbles[i] << 4) | nibbles[i + 1]);
    }
  }
  return rawBytes;
}

// Read a big-endian u32 from a byte array at the given offset.
function readU32BE(bytes, offset) {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

const dimsSane = (w, h) => w > 0 && h > 0 && w <= SCREEN.MAX_DIMENSION && h <= SCREEN.MAX_DIMENSION;

/**
 * Parse and integrity-check a denibbled 0x17 screen dump's 12-byte header.
 *
 * @param {number[]} rawBytes - Denibbled screen-dump bytes.
 * @returns {{
 *   width: number, height: number, size: number, bytesPerRow: number,
 *   expectedLength: number, dimsValid: boolean, complete: boolean, checksumOk: boolean
 * }} width/height/size as reported by the header; bytesPerRow = ceil(width/8);
 *   expectedLength = header + size + checksum; dimsValid = dims within bounds;
 *   complete = buffer holds the full expected length; checksumOk = the
 *   size-field-through-checksum sum is 0 mod 256 (only meaningful when complete).
 */
export function parseScreenHeader(rawBytes) {
  const width = readU32BE(rawBytes, SCREEN.WIDTH_OFFSET);
  const height = readU32BE(rawBytes, SCREEN.HEIGHT_OFFSET);
  const size = readU32BE(rawBytes, SCREEN.SIZE_OFFSET);
  const dimsValid = dimsSane(width, height);
  const bytesPerRow = Math.ceil(width / 8);
  const expectedLength = SCREEN.HEADER_BYTES + size + SCREEN.CHECKSUM_BYTES;
  const complete = rawBytes.length >= expectedLength;
  let checksumOk = false;
  if (complete) {
    let sum = 0;
    for (let i = SCREEN.CHECKSUM_SUM_OFFSET; i < expectedLength; i++) sum += rawBytes[i];
    checksumOk = (sum & 0xff) === 0;
  }
  return { width, height, size, bytesPerRow, expectedLength, dimsValid, complete, checksumOk };
}

/**
 * Decode raw screen-dump bytes into an RGBA pixel buffer (green-on-black,
 * matching the device's LCD). Straight row-major 1bpp decode, no heuristics.
 *
 * @param {number[]} rawBytes - Denibbled screen-dump bytes (12-byte header + data).
 * @param {Object} [opts]
 * @param {number} [opts.width] - Override width. Defaults to the header's width
 *   when sane, else SCREEN.WIDTH.
 * @param {number} [opts.height] - Override height. Defaults to the header's
 *   height when sane, else SCREEN.HEIGHT.
 * @param {number} [opts.header=12] - Bytes to skip before the pixel data.
 *   Exposed for diagnosing future captures; 12 is correct for the 0x17 dump.
 * @returns {Uint8ClampedArray} width*height*4 RGBA bytes.
 */
export function computePixels(rawBytes, opts = {}) {
  const header = opts.header ?? SCREEN.HEADER_BYTES;
  let { width, height } = opts;
  if (width == null || height == null) {
    const hdr = parseScreenHeader(rawBytes);
    if (width == null) width = hdr.dimsValid ? hdr.width : SCREEN.WIDTH;
    if (height == null) height = hdr.dimsValid ? hdr.height : SCREEN.HEIGHT;
  }
  const data = new Uint8ClampedArray(width * height * 4);
  const bytesPerRow = Math.ceil(width / 8);
  const bitmap = rawBytes.slice(header, header + bytesPerRow * height);
  const processed = NO_FLIP ? bitmap : bitmap.map((b) => bit_reverse_table[b]);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const byteIdx = y * bytesPerRow + (x >> 3);
      const byte = processed[byteIdx] || 0;
      const bit = (byte >> (7 - (x & 7))) & 1; // MSB-left
      const idx = (y * width + x) * 4;
      data[idx] = 0;
      data[idx + 1] = bit * 255; // Green on
      data[idx + 2] = 0;
      data[idx + 3] = 255; // Alpha
    }
  }
  return data;
}
