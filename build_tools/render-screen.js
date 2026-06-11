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
import { denibble, computePixels } from '../src/framebuffer.js';
// Encoder/scaler shared with the screen-golden jest suite (G2/#45).
import { encodePNG, scale } from './png-codec.js';

const SCREEN_W = 240;
const SCREEN_H = 64;

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
