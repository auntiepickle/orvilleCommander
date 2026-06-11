// build_tools/png-codec.js
// Minimal PNG encode/decode for the screen-golden pipeline (G2/#45) —
// extracted from render-screen.js so the CLI and the jest golden test share
// one implementation. Scope: exactly the subset our encoder emits (8-bit
// RGBA, no interlace, filter type 0 on every row); decodePNG throws on
// anything else rather than guessing. Pixel-level comparison is the golden
// contract — deflate output is NOT stable across Node/zlib versions, so
// byte-comparing whole PNG files would be a false regression signal.

import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Encodes 8-bit RGBA pixels as a PNG (filter 0, no interlace).
 *
 * @param {number} width
 * @param {number} height
 * @param {Uint8ClampedArray} rgba - width*height*4 bytes.
 * @returns {Buffer}
 */
export function encodePNG(width, height, rgba) {
  const sig = Buffer.from(PNG_SIG);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // 10,11,12 = compression, filter, interlace = 0
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 (none)
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Decodes a PNG produced by encodePNG back to pixels. Throws on any shape
 * outside our encoder's subset (bit depth 8, RGBA, no interlace, filter 0
 * rows) — a golden that fails to decode is itself a regression signal.
 *
 * @param {Buffer} buf
 * @returns {{width: number, height: number, rgba: Uint8ClampedArray}}
 */
export function decodePNG(buf) {
  for (let i = 0; i < PNG_SIG.length; i++) {
    if (buf[i] !== PNG_SIG[i]) throw new Error('not a PNG (bad signature)');
  }
  let off = PNG_SIG.length;
  let width = 0;
  let height = 0;
  const idatParts = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) {
        throw new Error('unsupported PNG shape (want 8-bit RGBA, no interlace)');
      }
    } else if (type === 'IDAT') {
      idatParts.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len; // len + type + data + crc
  }
  const raw = zlib.inflateSync(Buffer.concat(idatParts));
  const stride = width * 4;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter !== 0) throw new Error(`unsupported PNG row filter ${filter} (want 0)`);
    rgba.set(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride);
  }
  return { width, height, rgba };
}

/**
 * Nearest-neighbor integer upscale.
 *
 * @param {Uint8ClampedArray} rgba
 * @param {number} w
 * @param {number} h
 * @param {number} factor
 * @returns {{rgba: Uint8ClampedArray, width: number, height: number}}
 */
export function scale(rgba, w, h, factor) {
  const sw = w * factor;
  const sh = h * factor;
  const out = new Uint8ClampedArray(sw * sh * 4);
  for (let y = 0; y < sh; y++) {
    const sy = Math.floor(y / factor);
    for (let x = 0; x < sw; x++) {
      const sx = Math.floor(x / factor);
      const src = (sy * w + sx) * 4;
      const dst = (y * sw + x) * 4;
      out[dst] = rgba[src];
      out[dst + 1] = rgba[src + 1];
      out[dst + 2] = rgba[src + 2];
      out[dst + 3] = rgba[src + 3];
    }
  }
  return { rgba: out, width: sw, height: sh };
}
