/**
 * Capture Orville SysEx response fixtures for tests/fixtures/.
 *
 * One-shot developer tool for the Step 5.5 startup characterization
 * test. Not run by Jest. Sends OBJECTINFO_DUMP and VALUE_DUMP requests
 * to a connected Orville and writes the responses to disk in the
 * space-separated ASCII-hex format Process Debug File expects (same
 * format as tests/fixtures/screen-dump-black-hole.txt).
 *
 * Usage:
 *   npm run capture:fixtures
 *   node build_tools/capture-fixtures.cjs --port-in "MIDIIN3 (U6MIDI Pro)" --port-out "MIDIOUT2 (U6MIDI Pro)" --device-id 1
 *   npm run capture:fixtures -- --only valuedump-8060001
 *
 * Flags:
 *   --port-in <substring>   match on MIDI input port name (default: "MIDIIN3 (U6MIDI Pro)")
 *   --port-out <substring>  match on MIDI output port name (default: "MIDIOUT2 (U6MIDI Pro)")
 *   --device-id <n>         Orville device ID (default: 1)
 *   --only <name>           capture only the named fixture (must match a FIXTURES entry)
 *
 * Exit: 0 if every fixture captured, 1 if any timed out, no port, or --only name unknown.
 */

const fs = require('node:fs');
const path = require('node:path');

// ----- request builders -----------------------------------------------
// Duplicated from src/midi.js (canonical source). Roadmap step 5.5
// decision: no production extraction of src/sysex-requests.js; if the
// protocol changes, update both places. Extraction is deferred to a
// dedicated refactor with the startup characterization test as its
// guardrail.

function buildObjectInfoRequest(key, deviceId) {
  const keyBytes = key.split('').map(c => c.charCodeAt(0));
  return [0xF0, 0x1C, 0x70, deviceId, 0x31, ...keyBytes, 0xF7];
}

function buildValueDumpRequest(key, deviceId) {
  const keyBytes = key.split('').map(c => c.charCodeAt(0));
  return [0xF0, 0x1C, 0x70, deviceId, 0x2D, ...keyBytes, 0xF7];
}

// ----- fixture table --------------------------------------------------

const FIXTURES = [
  { name: 'objectinfo-root',     build: d => buildObjectInfoRequest('0', d),        expectCmd: 0x32 },
  { name: 'objectinfo-401000b',  build: d => buildObjectInfoRequest('401000b', d),  expectCmd: 0x32 },
  { name: 'objectinfo-801000b',  build: d => buildObjectInfoRequest('801000b', d),  expectCmd: 0x32 },
  { name: 'objectinfo-10010000', build: d => buildObjectInfoRequest('10010000', d), expectCmd: 0x32 },
  { name: 'valuedump-root',      build: d => buildValueDumpRequest('0', d),         expectCmd: 0x2e },
  { name: 'valuedump-401000b',   build: d => buildValueDumpRequest('401000b', d),   expectCmd: 0x2e },
  { name: 'valuedump-8060001',   build: d => buildValueDumpRequest('8060001', d),   expectCmd: 0x2e },
];

const RESPONSE_TIMEOUT_MS = 1500;
const INTER_REQUEST_DELAY_MS = 100;

// ----- CLI parsing ----------------------------------------------------

function parseArgs(argv) {
  const out = {
    portIn: 'MIDIIN3 (U6MIDI Pro)',
    portOut: 'MIDIOUT2 (U6MIDI Pro)',
    deviceId: 1,
    only: null,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port-in') out.portIn = argv[++i];
    else if (argv[i] === '--port-out') out.portOut = argv[++i];
    else if (argv[i] === '--device-id') out.deviceId = parseInt(argv[++i], 10);
    else if (argv[i] === '--only') out.only = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Usage: node build_tools/capture-fixtures.cjs [--port-in <substring>] [--port-out <substring>] [--device-id <n>] [--only <name>]');
      process.exit(0);
    }
  }
  return out;
}

// ----- MIDI helpers ---------------------------------------------------

function findPort(instance, substring) {
  const count = instance.getPortCount();
  for (let i = 0; i < count; i++) {
    if (instance.getPortName(i).includes(substring)) return i;
  }
  return -1;
}

function enumeratePorts(instance) {
  const n = instance.getPortCount();
  if (n === 0) {
    console.error('  (none)');
    return;
  }
  for (let i = 0; i < n; i++) {
    console.error(`  [${i}] ${instance.getPortName(i)}`);
  }
}

function waitForResponse(input, expectCmd, timeoutMs) {
  return new Promise((resolve, reject) => {
    let handler;
    const timer = setTimeout(() => {
      input.removeListener('message', handler);
      reject(new Error(`timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    handler = (_deltaTime, message) => {
      // Accept: F0 1C 70 <anyDevId> <expectCmd> ... F7
      if (
        message.length >= 6 &&
        message[0] === 0xF0 &&
        message[1] === 0x1C &&
        message[2] === 0x70 &&
        message[4] === expectCmd
      ) {
        clearTimeout(timer);
        input.removeListener('message', handler);
        resolve(Array.from(message));
      }
    };
    input.on('message', handler);
  });
}

function hexFormat(bytes) {
  return bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ----- root-dump self-verification ------------------------------------
// Decodes a captured root OBJECTINFO_DUMP and returns the first
// short-tag COL sub the renderer autoload (renderer.js:733-748) will
// land on, so the developer can confirm the planned fixture #4
// filename (objectinfo-10010000.txt) matches reality. Mirrors the
// filter at renderer.js:737 and parser.js:splitLine - duplicated here
// because this script deliberately does not import from src/.

function splitLine(line) {
  const parts = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';
  for (const char of line) {
    if ((char === "'" || char === '"') && !inQuote) {
      inQuote = true;
      quoteChar = char;
      if (current.trim()) parts.push(current.trim());
      current = '';
    } else if (char === quoteChar && inQuote) {
      inQuote = false;
      parts.push(current.trim());
      current = '';
    } else if (char === ' ' && !inQuote) {
      if (current.trim()) parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function extractFirstShortTagCOL(rawBytes) {
  const ascii = String.fromCharCode(...rawBytes.slice(5, -1)).trim();
  const subs = ascii
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(line => {
      const parts = splitLine(line);
      return {
        type: parts[0] || '',
        key: parts[2] || '',
        tag: parts[5] || '',
      };
    });
  const softSubs = subs
    .slice(1)
    .filter(s => s.type === 'COL' && s.tag.trim().length <= 10 && s.tag.trim());
  return softSubs[0] || null;
}

// ----- main -----------------------------------------------------------

async function main() {
  const { portIn, portOut, deviceId, only } = parseArgs(process.argv.slice(2));

  let fixtures = FIXTURES;
  if (only) {
    fixtures = FIXTURES.filter(fx => fx.name === only);
    if (fixtures.length === 0) {
      console.error(`ERROR: --only '${only}' did not match any FIXTURES entry`);
      console.error('Known names:');
      for (const fx of FIXTURES) console.error(`  ${fx.name}`);
      process.exit(1);
    }
  }

  let midiLib;
  try {
    midiLib = require('@julusian/midi');
  } catch (err) {
    console.error('ERROR: failed to load @julusian/midi');
    console.error(err.message);
    console.error('Did you run `npm install`?');
    process.exit(1);
  }

  const input = new midiLib.Input();
  const output = new midiLib.Output();

  const inIdx = findPort(input, portIn);
  const outIdx = findPort(output, portOut);

  if (inIdx === -1 || outIdx === -1) {
    if (inIdx === -1) {
      console.error(`ERROR: no MIDI input port matching '${portIn}' found`);
    }
    if (outIdx === -1) {
      console.error(`ERROR: no MIDI output port matching '${portOut}' found`);
    }
    console.error('');
    console.error('Available inputs:');
    enumeratePorts(input);
    console.error('');
    console.error('Available outputs:');
    enumeratePorts(output);
    console.error('');
    console.error('Rerun with --port-in <substring> and/or --port-out <substring> to match your device.');
    process.exit(1);
  }

  input.openPort(inIdx);
  output.openPort(outIdx);
  // (sysex, timing, activeSensing) - receive SysEx, ignore the others
  input.ignoreTypes(false, true, true);

  console.log(`opened input  [${inIdx}] ${input.getPortName(inIdx)}`);
  console.log(`opened output [${outIdx}] ${output.getPortName(outIdx)}`);
  console.log(`device ID: ${deviceId}`);
  console.log('');

  const fixturesDir = path.join(__dirname, '..', 'tests', 'fixtures');
  fs.mkdirSync(fixturesDir, { recursive: true });

  let rootDumpBytes = null;
  let timedOutCount = 0;

  for (const fx of fixtures) {
    const req = fx.build(deviceId);
    const expectedCmdHex = fx.expectCmd.toString(16).padStart(2, '0');
    try {
      const responsePromise = waitForResponse(input, fx.expectCmd, RESPONSE_TIMEOUT_MS);
      output.sendMessage(req);
      const response = await responsePromise;
      const outPath = path.join(fixturesDir, `${fx.name}.txt`);
      fs.writeFileSync(outPath, hexFormat(response) + '\n');
      console.log(`captured: ${outPath} (${response.length} bytes, cmd 0x${expectedCmdHex})`);
      if (fx.name === 'objectinfo-root') rootDumpBytes = response;
    } catch (err) {
      console.warn(`WARN: ${fx.name} - ${err.message}, skipping`);
      timedOutCount++;
    }
    await sleep(INTER_REQUEST_DELAY_MS);
  }

  input.closePort();
  output.closePort();

  console.log('');
  if (rootDumpBytes) {
    const first = extractFirstShortTagCOL(rootDumpBytes);
    if (first) {
      console.log(`root dump first short-tag COL: ${first.key} (tag="${first.tag}") - confirm fixture #4 filename matches`);
    } else {
      console.log('root dump has no short-tag COLs - autoload will not fire on root');
    }
  } else {
    console.log('(root dump not captured - first-short-tag-COL summary skipped)');
  }

  if (timedOutCount > 0) {
    console.log('');
    console.warn(`done with ${timedOutCount} fixture(s) skipped`);
    process.exit(1);
  }
  console.log('');
  console.log('done');
}

main().catch(err => {
  console.error('unexpected error:', err);
  process.exit(1);
});
