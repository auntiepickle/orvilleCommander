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

/**
 * Decode raw screen-dump bytes into an RGBA pixel buffer (green-on-black,
 * matching the device's LCD). Straight row-major 1bpp decode, no heuristics.
 *
 * @param {number[]} rawBytes - Denibbled screen-dump bytes (12-byte header + data).
 * @param {Object} [opts]
 * @param {number} [opts.width=240]
 * @param {number} [opts.height=64]
 * @param {number} [opts.header=12] - Bytes to skip before the pixel data.
 *   Exposed for diagnosing future captures; 12 is correct for the 0x17 dump.
 * @returns {Uint8ClampedArray} width*height*4 RGBA bytes.
 */
export function computePixels(rawBytes, { width = 240, height = 64, header = 12 } = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  const bytesPerRow = width / 8;
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
