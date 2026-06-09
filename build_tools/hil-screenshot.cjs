/**
 * Hardware-in-the-loop screenshot: drive the Orville and capture what it shows.
 *
 * Opens the MIDI ports ONCE (gentle on the USB driver — separate-process probing
 * destabilized the U6MIDI Pro), optionally presses a sequence of front-panel
 * keys, requests a screen dump (0x18 -> 0x17), saves the raw capture, and
 * renders it to a PNG via build_tools/render-screen.js (the canonical decoder).
 *
 * Usage:
 *   node build_tools/hil-screenshot.cjs --png logs/shot.png
 *   node build_tools/hil-screenshot.cjs --press setup --png logs/setup.png
 *   node build_tools/hil-screenshot.cjs --press ab,parameter --png logs/b-params.png
 *
 * Options: --in <substr> --out <substr> --dev <n> --win <ms>
 *          --press <k1,k2,...>  keys to send before capturing (see KEYS)
 *          --name <fixtureName> raw capture file (default _hil-shot) in tests/fixtures/
 *          --png <path>         output PNG (default logs/hil-shot.png)
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const CAPTURE_ATTEMPTS = 3; // retries if a capture comes back incomplete
const RETRY_BACKOFF_MS = 300; // pause between capture retries
const KEYPRESS_PACE_MS = 300; // pace between front-panel keypresses (and post-press settle)
// Local mirrors of the src/ ES-module constants this .cjs build tool can't import.
const FRAME_PREFIX_LEN = 5; // F0 1C 70 <dev> <cmd> before the payload (SYSEX.FRAME_PREFIX_LEN)
const SCREEN_HEADER_BYTES = 12; // 3x u32 header before pixel data (SCREEN.HEADER_BYTES)
const SCREEN_SIZE_OFFSET = 8; // u32 bitmap-size field within the header (SCREEN.SIZE_OFFSET)

const KEYS = {
  up: [0xfe, 0xff, 0xfd, 0xff],
  down: [0xff, 0xfe, 0xfd, 0xff],
  left: [0xff, 0xfe, 0xff, 0xff],
  right: [0xfe, 0xff, 0xff, 0xff],
  enter: [0xff, 0xff, 0xff, 0xef],
  select: [0xff, 0xff, 0xfe, 0xff],
  program: [0xf7, 0xff, 0xff, 0xff],
  parameter: [0xff, 0xf7, 0xff, 0xff],
  levels: [0xff, 0xff, 0xff, 0xfd],
  setup: [0xff, 0xff, 0xf7, 0xff],
  bypass: [0xff, 0xff, 0xfd, 0xff],
  inc: [0xff, 0xff, 0xff, 0x7f],
  dec: [0xff, 0xff, 0xff, 0xbf],
  soft1: [0xfb, 0xff, 0xff, 0xff],
  soft2: [0xff, 0xfb, 0xff, 0xff],
  soft3: [0xff, 0xff, 0xfb, 0xff],
  soft4: [0xff, 0xff, 0xff, 0xfb],
  ab: [0xfd, 0xff, 0xfd, 0xff],
};

function parse(argv) {
  const o = {
    in: 'MIDIIN3 (U6MIDI Pro)',
    out: 'MIDIOUT2 (U6MIDI Pro)',
    dev: 1,
    // The Orville talks to the U6MIDI Pro over a 31250-baud DIN link, so a
    // ~3872-byte screen dump takes ~1.2s to transmit and the binding delivers
    // it as multiple 2048-byte buffers. Wait long enough to reassemble all of
    // them (see captureScreen).
    win: 4000,
    press: [],
    name: '_hil-shot',
    png: 'logs/hil-shot.png',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in') o.in = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--dev') o.dev = parseInt(argv[++i], 10);
    else if (a === '--win') o.win = parseInt(argv[++i], 10);
    else if (a === '--press') o.press = argv[++i].split(',').filter(Boolean);
    else if (a === '--name') o.name = argv[++i];
    else if (a === '--png') o.png = argv[++i];
  }
  return o;
}

const nibble = (mask) => mask.flatMap((b) => [(b >> 4) & 0x0f, b & 0x0f]);
const hex = (b) => b.map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findPort(inst, sub) {
  for (let i = 0; i < inst.getPortCount(); i++) if (inst.getPortName(i).includes(sub)) return i;
  return -1;
}

// Request a screen dump (0x18) and reassemble the 0x17 reply. @julusian/midi on
// WinMM delivers a long SysEx as multiple 2048-byte buffer chunks: the first
// starts with F0 1C 70 dev 17, the rest are raw continuation bytes, and the last
// ends with F7. Accumulate from the header chunk until we see F7. Returns the
// full SysEx byte array, or whatever arrived before the window elapsed (the
// caller validates completeness). Resolves once the stream terminates so a
// complete capture does not wait out the whole window.
function captureScreen(input, output, o) {
  return new Promise((resolve) => {
    let done = false;
    let started = false;
    const chunks = [];
    const finish = (val) => {
      if (done) return;
      done = true;
      input.removeListener('message', h);
      resolve(val);
    };
    const h = (_dt, m) => {
      const arr = Array.from(m);
      if (!started) {
        const isScreen =
          arr.length > 5 &&
          arr[0] === 0xf0 &&
          arr[1] === 0x1c &&
          arr[2] === 0x70 &&
          arr[4] === 0x17;
        if (!isScreen) return; // ignore unrelated SysEx until the screen header
        started = true;
      }
      chunks.push(arr);
      if (arr[arr.length - 1] === 0xf7) finish([].concat(...chunks)); // complete SysEx
    };
    input.on('message', h);
    output.sendMessage([0xf0, 0x1c, 0x70, o.dev, 0x18, 0xf7]);
    setTimeout(() => finish(chunks.length ? [].concat(...chunks) : null), o.win);
  });
}

const denibbleBytes = (n) => {
  const out = [];
  for (let i = 0; i + 1 < n.length; i += 2) out.push((n[i] << 4) | n[i + 1]);
  return out;
};

// A complete screen SysEx ends with F7 and denibbles to header + size + checksum.
function isCompleteScreen(sysex) {
  if (!sysex || sysex[sysex.length - 1] !== 0xf7) return false;
  const raw = denibbleBytes(sysex.slice(FRAME_PREFIX_LEN, sysex.length - 1));
  if (raw.length < SCREEN_HEADER_BYTES) return false; // not even a full header
  const o = SCREEN_SIZE_OFFSET;
  const size = ((raw[o] << 24) | (raw[o + 1] << 16) | (raw[o + 2] << 8) | raw[o + 3]) >>> 0;
  return raw.length >= SCREEN_HEADER_BYTES + size + 1; // header + pixels + checksum
}

async function main() {
  const o = parse(process.argv.slice(2));
  const midi = require('@julusian/midi');
  const input = new midi.Input();
  const output = new midi.Output();

  const inIdx = findPort(input, o.in);
  const outIdx = findPort(output, o.out);
  if (inIdx === -1 || outIdx === -1) {
    console.error(`MIDI port not found (in=${inIdx}, out=${outIdx}). Is the interface up?`);
    process.exit(1);
  }
  input.openPort(inIdx);
  output.openPort(outIdx);
  input.ignoreTypes(false, true, true);

  // Close both ports on every exit path (a clean teardown keeps the WinMM USB
  // driver stable — abrupt teardown is what destabilized it during probing).
  try {
    // 1. Drive any requested keypresses (single open port, paced).
    for (const k of o.press) {
      const mask = KEYS[k];
      if (!mask) {
        throw new Error(`unknown key '${k}'. known: ${Object.keys(KEYS).join(', ')}`);
      }
      output.sendMessage([0xf0, 0x1c, 0x70, o.dev, 0x01, ...nibble(mask), 0xf7]);
      console.error(`pressed ${k}`);
      await sleep(KEYPRESS_PACE_MS);
    }
    if (o.press.length) await sleep(KEYPRESS_PACE_MS); // settle

    // 2. Request a screen dump and reassemble the 0x17 reply, retrying if a
    //    capture comes back truncated (a slow/partial DIN transmission).
    let got = null;
    for (let attempt = 1; attempt <= CAPTURE_ATTEMPTS; attempt++) {
      got = await captureScreen(input, output, o);
      if (isCompleteScreen(got)) break;
      console.error(
        `attempt ${attempt}: ${got ? `incomplete capture (${got.length} bytes)` : 'no 0x17 reply'}; retrying`
      );
      await sleep(RETRY_BACKOFF_MS);
    }

    if (!got) {
      throw new Error(`no 0x17 screen reply within ${o.win}ms`);
    }
    if (!isCompleteScreen(got)) {
      console.error(
        `WARNING: screen capture is incomplete after retries (${got.length} bytes saved)`
      );
    }

    // 3. Save the raw capture and render it to PNG via the canonical decoder.
    const dir = path.join(__dirname, '..', 'tests', 'fixtures');
    fs.mkdirSync(dir, { recursive: true });
    const fixture = path.join(dir, `${o.name}.txt`);
    fs.writeFileSync(fixture, hex(got) + '\n');
    console.log(`captured ${got.length} bytes -> ${fixture}`);

    fs.mkdirSync(path.dirname(o.png), { recursive: true });
    execFileSync('node', [path.join(__dirname, 'render-screen.js'), fixture, o.png, '6'], {
      stdio: 'inherit',
    });
    console.log(`rendered -> ${o.png}`);
  } finally {
    input.closePort();
    output.closePort();
  }
}

main().catch((e) => {
  console.error('error:', e);
  process.exit(1);
});
