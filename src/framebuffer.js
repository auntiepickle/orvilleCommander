// framebuffer.js
// Pure decoding of the Orville 240x64 1bpp screen into RGBA pixels. Zero
// dependencies so the canvas renderer (bitmap.js), the replay harness, and
// the offline PNG tool all share one faithful implementation.

const NO_FLIP = true; // Hardcoded, adjust if needed
const ROTATE_COLUMNS = true;

// Bit reverse table (used only when NO_FLIP is false).
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
 * matching the device's LCD).
 *
 * @param {number[]} rawBytes - Denibbled screen-dump bytes (13-byte header + 1920 data).
 * @param {Object} [opts]
 * @param {number} [opts.width=240]
 * @param {number} [opts.height=64]
 * @param {('edge'|'wrap'|'black'|'none')} [opts.shiftMode='edge'] - How to fill
 *   the top pixel vacated by the 1px down-shift that corrects the first 8
 *   (wrapped) columns being delivered 1px high:
 *   'edge'  - clamp: duplicate the row below, so a border stays a border (A2 fix);
 *   'wrap'  - rotate the bottom pixel up (leaves row-63 garbage at the top);
 *   'black' - legacy: zero the vacated top pixel (the top-left black artifact);
 *   'none'  - no shift.
 * @returns {Uint8ClampedArray} width*height*4 RGBA bytes.
 */
export function computePixels(rawBytes, { width = 240, height = 64, shiftMode = 'edge' } = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  const bitmap = rawBytes.slice(13, 13 + 1920);
  const processedBitmap = NO_FLIP ? bitmap : bitmap.map((b) => bit_reverse_table[b]);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let originalX = x;
      if (ROTATE_COLUMNS) {
        originalX = (x + (width - 8)) % width;
      }
      const byteIdx = y * 30 + Math.floor(originalX / 8);
      const byte = processedBitmap[byteIdx];
      const bit = (byte >> (7 - (originalX % 8))) & 1; // MSB-left
      const idx = (y * width + x) * 4;
      data[idx] = 0;
      data[idx + 1] = bit * 255; // Green on
      data[idx + 2] = 0;
      data[idx + 3] = 255; // Alpha
    }
  }
  if (shiftMode !== 'none') {
    const shiftAmount = 1; // Down by 1px
    for (let x = 0; x < 8; x++) {
      // Save the bottom rows that wrap to the top (only used by 'wrap').
      const wrapped = [];
      for (let s = 0; s < shiftAmount; s++) {
        const srcIdx = ((height - shiftAmount + s) * width + x) * 4;
        wrapped.push(data.slice(srcIdx, srcIdx + 4));
      }
      // Shift the column down (bottom-up so reads precede their overwrite).
      for (let y = height - 1; y >= shiftAmount; y--) {
        const fromIdx = ((y - shiftAmount) * width + x) * 4;
        const idx = (y * width + x) * 4;
        data[idx] = data[fromIdx];
        data[idx + 1] = data[fromIdx + 1];
        data[idx + 2] = data[fromIdx + 2];
        data[idx + 3] = data[fromIdx + 3];
      }
      // Fill the vacated top rows.
      for (let s = 0; s < shiftAmount; s++) {
        const idx = (s * width + x) * 4;
        if (shiftMode === 'edge') {
          // Clamp: copy the row just below (now at index shiftAmount), so a
          // continuous border/field stays continuous instead of notching.
          const from = (shiftAmount * width + x) * 4;
          data[idx] = data[from];
          data[idx + 1] = data[from + 1];
          data[idx + 2] = data[from + 2];
          data[idx + 3] = data[from + 3];
        } else if (shiftMode === 'wrap') {
          data[idx] = wrapped[s][0];
          data[idx + 1] = wrapped[s][1];
          data[idx + 2] = wrapped[s][2];
          data[idx + 3] = wrapped[s][3];
        } else {
          // 'black' (legacy): zero the top pixel.
          data[idx] = 0;
          data[idx + 1] = 0;
          data[idx + 2] = 0;
          data[idx + 3] = 255;
        }
      }
    }
  }
  return data;
}
