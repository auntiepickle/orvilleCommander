// tests/screen-golden.test.js — G2's offline half (#45).
//
// Screenshot regression: every captured 0x17 screen fixture must decode to
// EXACTLY the pixels of its golden PNG (tests/fixtures/golden/ — canonical
// 240x64 renders captured from the physical Orville, 2026-06-08). A diff
// here means the framebuffer decode pipeline (denibble -> parseScreenHeader
// -> computePixels) changed behavior; either it is a regression, or the
// goldens must be intentionally regenerated via
//   node build_tools/render-screen.js tests/fixtures/screen-<name>.txt tests/fixtures/golden/screen-<name>.png 1
// in the same commit (see the golden README).
//
// Comparison is PIXEL-level, not PNG-byte-level: deflate output is not
// stable across Node/zlib versions, so whole-file comparison would be a
// false regression signal. decodePNG throws on anything outside our
// encoder's subset — a golden that fails to decode is itself a failure.

import fs from 'node:fs';
import path from 'node:path';
import { denibble, computePixels, parseScreenHeader } from '../src/framebuffer.js';
import { decodePNG } from '../build_tools/png-codec.js';
import { SCREEN, SYSEX } from '../src/sysex-commands.js';

const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures');
const GOLDEN = path.join(FIXTURES, 'golden');

// The golden set (see golden/README.md). screen-dump-black-hole.txt predates
// the golden capture session and has no golden — it is covered by the replay
// suite's framebuffer-to-ASCII decode instead.
const GOLDEN_SCREENS = ['parameter', 'setup', 'program', 'levels', 'bypass'];

const loadFrame = (file) =>
  fs
    .readFileSync(file, 'utf8')
    .trim()
    .split(/\s+/)
    .map((h) => parseInt(h, 16));

describe('screen-golden regression (G2 offline half, #45)', () => {
  test.each(GOLDEN_SCREENS)('screen-%s decodes to its golden pixels', (name) => {
    const frame = loadFrame(path.join(FIXTURES, `screen-${name}.txt`));
    const rawBytes = denibble(frame.slice(SYSEX.FRAME_PREFIX_LEN, -1));

    // The capture must still be internally sound — a corrupted fixture
    // should fail loudly here, not as a confusing pixel diff.
    const hdr = parseScreenHeader(rawBytes);
    expect(hdr.dimsValid).toBe(true);
    expect(hdr.complete).toBe(true);
    expect(hdr.checksumOk).toBe(true);

    const pixels = computePixels(rawBytes, {
      width: SCREEN.WIDTH,
      height: SCREEN.HEIGHT,
      header: SCREEN.HEADER_BYTES,
    });

    const golden = decodePNG(fs.readFileSync(path.join(GOLDEN, `screen-${name}.png`)));
    expect(golden.width).toBe(SCREEN.WIDTH);
    expect(golden.height).toBe(SCREEN.HEIGHT);

    // Pixel-exact or fail. On mismatch, report WHERE for debuggability
    // instead of dumping two 61KB arrays.
    const a = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength);
    const b = Buffer.from(golden.rgba.buffer, golden.rgba.byteOffset, golden.rgba.byteLength);
    if (!a.equals(b)) {
      let firstDiff = -1;
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
          firstDiff = i;
          break;
        }
      }
      const px = Math.floor(firstDiff / 4);
      throw new Error(
        `screen-${name}: render differs from golden starting at pixel (${px % SCREEN.WIDTH}, ${Math.floor(px / SCREEN.WIDTH)}) ` +
          `(byte ${firstDiff}). If the decoder change is intentional, regenerate the golden ` +
          `(see tests/fixtures/golden/README.md) in the same commit.`
      );
    }
  });
});
