// build_tools/render-screen.js
// Render a captured Orville screen dump to a PNG so it can be viewed directly
// (no device, no canvas). Uses the same framebuffer decoder as the app.
//
// Usage:
//   node build_tools/render-screen.js <fixture.txt> <out.png> [scale=6] [header=12]
//
// <fixture.txt> is a full SysEx frame as space-separated hex bytes
// (F0 1C 70 <dev> 17 ... F7), e.g. tests/fixtures/screen-dump-black-hole.txt.
// header is the byte offset before pixel data (12 is correct; exposed for
// diagnosing future captures).

import fs from 'node:fs';
import zlib from 'node:zlib';
import { denibble, computePixels } from '../src/framebuffer.js';

const SCREEN_W = 240;
const SCREEN_H = 64;

// ----- minimal PNG encoder (RGBA, 8-bit) -----------------------------------
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

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
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

function scale(rgba, w, h, factor) {
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

// ----- main ----------------------------------------------------------------
const [inFile, outFile, scaleArg, headerArg] = process.argv.slice(2);
if (!inFile || !outFile) {
  console.error(
    'Usage: node build_tools/render-screen.js <fixture.txt> <out.png> [scale=6] [header=12]'
  );
  process.exit(1);
}
const factor = parseInt(scaleArg || '6', 10);
const header = parseInt(headerArg || '12', 10);

const frame = fs
  .readFileSync(inFile, 'utf8')
  .trim()
  .split(/\s+/)
  .map((h) => parseInt(h, 16));
const rawBytes = denibble(frame.slice(5, -1)); // strip F0 1C 70 dev 17 ... F7
const pixels = computePixels(rawBytes, { width: SCREEN_W, height: SCREEN_H, header });
const scaled = scale(pixels, SCREEN_W, SCREEN_H, factor);
fs.writeFileSync(outFile, encodePNG(scaled.width, scaled.height, scaled.rgba));
console.log(`Wrote ${outFile} (${scaled.width}x${scaled.height}, header=${header})`);
