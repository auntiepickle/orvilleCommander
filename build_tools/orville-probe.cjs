/**
 * Interactive Orville SysEx probe — drives a connected unit to answer spec
 * questions (active DSP, bank taxonomy, error behavior) and capture fixtures.
 *
 * Unlike capture-fixtures.cjs (a fixed fixture list), this sends ONE request
 * and reports EVERY Eventide SysEx that comes back in a window — so we can see
 * SYSEXC_OK (0x00) / SYSEXC_ERROR (0x0D) replies to bad requests, not just the
 * expected dump.
 *
 * Usage:
 *   node build_tools/orville-probe.cjs ports
 *   node build_tools/orville-probe.cjs autodetect
 *   node build_tools/orville-probe.cjs obj 10020000
 *   node build_tools/orville-probe.cjs val 8060001
 *   node build_tools/orville-probe.cjs put 1002001c 1
 *   node build_tools/orville-probe.cjs screen
 *   node build_tools/orville-probe.cjs raw F0 1C 70 01 31 30 F7
 *
 * Options (before the action): --in <substr> --out <substr> --dev <n> --win <ms>
 */

const CMD = {
  OBJ: 0x31,
  OBJ_RESP: 0x32,
  VAL: 0x2d,
  VAL_RESP: 0x2e,
  SCREEN_REQ: 0x18,
  SCREEN: 0x17,
};
const NAME = {
  0x00: 'OK',
  0x0d: 'ERROR',
  0x17: 'SCREEN_DUMP',
  0x2e: 'VALUE_DUMP',
  0x32: 'OBJECTINFO_DUMP',
  0x19: 'INFO_DUMP',
};

function parse(argv) {
  const o = {
    in: 'MIDIIN3 (U6MIDI Pro)',
    out: 'MIDIOUT2 (U6MIDI Pro)',
    dev: 1,
    win: 1500,
    save: null,
    rest: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in') o.in = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--dev') o.dev = parseInt(argv[++i], 10);
    else if (a === '--win') o.win = parseInt(argv[++i], 10);
    else if (a === '--save')
      o.save = argv[++i]; // fixture name -> tests/fixtures/<name>.txt
    else o.rest.push(a);
  }
  return o;
}

// Front-panel keypress masks (4 bytes, active-low), mirrored from controls.js.
// A keypress is cmd 0x01 with the mask split into 8 nibbles (MSN first).
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
const nibble = (mask) => mask.flatMap((b) => [(b >> 4) & 0x0f, b & 0x0f]);

const midi = require('@julusian/midi');
const ascii = (k) => k.split('').map((c) => c.charCodeAt(0));
const hex = (b) => b.map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ');

function findPort(inst, sub) {
  for (let i = 0; i < inst.getPortCount(); i++) if (inst.getPortName(i).includes(sub)) return i;
  return -1;
}
function listPorts(inst, label) {
  const n = inst.getPortCount();
  console.log(`${label} (${n}):`);
  for (let i = 0; i < n; i++) console.log(`  [${i}] ${inst.getPortName(i)}`);
}
// Collect every Eventide (F0 1C 70 ...) sysex received within `win` ms.
function collect(input, win) {
  return new Promise((resolve) => {
    const msgs = [];
    const h = (_dt, m) => {
      if (m.length >= 5 && m[0] === 0xf0 && m[1] === 0x1c && m[2] === 0x70)
        msgs.push(Array.from(m));
    };
    input.on('message', h);
    setTimeout(() => {
      input.removeListener('message', h);
      resolve(msgs);
    }, win);
  });
}

function decode(msg) {
  const cmd = msg[4];
  const name = NAME[cmd] || `0x${cmd.toString(16)}`;
  const dev = msg[3];
  const body = msg.slice(5, -1);
  let text = '';
  if (cmd === CMD.OBJ_RESP || cmd === CMD.VAL_RESP || cmd === 0x0d || cmd === 0x19) {
    text = String.fromCharCode(...body)
      .replace(/\0+$/, '')
      .replace(/\r/g, '');
  } else if (cmd === CMD.SCREEN) {
    text = `[screen dump] ${body.length} nibble-bytes`;
  }
  return { cmd, name, dev, len: msg.length, text };
}

async function main() {
  const o = parse(process.argv.slice(2));
  const action = o.rest[0];
  const input = new midi.Input();
  const output = new midi.Output();

  if (!action || action === 'ports') {
    listPorts(input, 'INPUT');
    listPorts(output, 'OUTPUT');
    return;
  }

  if (action === 'autodetect') {
    // Try each (output, input) pair: send OBJECTINFO('0'), see who answers 0x32.
    console.log('Probing every output->input pair with OBJECTINFO(0)...');
    for (let oi = 0; oi < output.getPortCount(); oi++) {
      const oname = output.getPortName(oi);
      if (/wavetable/i.test(oname)) continue;
      for (let ii = 0; ii < input.getPortCount(); ii++) {
        const out = new midi.Output();
        const inp = new midi.Input();
        try {
          out.openPort(oi);
          inp.openPort(ii);
          inp.ignoreTypes(false, true, true);
          const p = collect(inp, 600);
          out.sendMessage([0xf0, 0x1c, 0x70, o.dev, CMD.OBJ, ...ascii('0'), 0xf7]);
          const msgs = await p;
          if (msgs.length) {
            console.log(
              `  RESPONSE: out[${oi}] "${oname}" -> in[${ii}] "${inp.getPortName(ii)}" (${msgs.length} msg, cmd 0x${msgs[0][4].toString(16)})`
            );
          }
        } catch {
          /* ignore unopenable ports */
        } finally {
          try {
            out.closePort();
          } catch {
            /* ignore */
          }
          try {
            inp.closePort();
          } catch {
            /* ignore */
          }
        }
      }
    }
    console.log('done. Use the matching --in/--out names with other actions.');
    return;
  }

  const inIdx = findPort(input, o.in);
  const outIdx = findPort(output, o.out);
  if (inIdx === -1 || outIdx === -1) {
    console.error(`port not found (in='${o.in}' -> ${inIdx}, out='${o.out}' -> ${outIdx})`);
    listPorts(input, 'INPUT');
    listPorts(output, 'OUTPUT');
    process.exit(1);
  }
  input.openPort(inIdx);
  output.openPort(outIdx);
  input.ignoreTypes(false, true, true);
  console.error(
    `in[${inIdx}]=${input.getPortName(inIdx)}  out[${outIdx}]=${output.getPortName(outIdx)}  dev=${o.dev}`
  );

  let req;
  if (action === 'obj') req = [0xf0, 0x1c, 0x70, o.dev, CMD.OBJ, ...ascii(o.rest[1]), 0xf7];
  else if (action === 'val') req = [0xf0, 0x1c, 0x70, o.dev, CMD.VAL, ...ascii(o.rest[1]), 0xf7];
  else if (action === 'put')
    req = [0xf0, 0x1c, 0x70, o.dev, CMD.VAL, ...ascii(o.rest[1]), 0x20, ...ascii(o.rest[2]), 0xf7];
  else if (action === 'screen') req = [0xf0, 0x1c, 0x70, o.dev, CMD.SCREEN_REQ, 0xf7];
  else if (action === 'key') {
    const mask = KEYS[o.rest[1]];
    if (!mask) {
      console.error(`unknown key '${o.rest[1]}'. known: ${Object.keys(KEYS).join(', ')}`);
      process.exit(1);
    }
    req = [0xf0, 0x1c, 0x70, o.dev, 0x01, ...nibble(mask), 0xf7];
  } else if (action === 'raw') req = o.rest.slice(1).map((h) => parseInt(h, 16));
  else {
    console.error(`unknown action: ${action}`);
    process.exit(1);
  }

  const p = collect(input, o.win);
  output.sendMessage(req);
  console.error(`sent: ${hex(req)}`);
  const msgs = await p;
  console.log(`\n${msgs.length} Eventide sysex reply(ies) in ${o.win}ms:`);
  for (const m of msgs) {
    const d = decode(m);
    console.log(`\n  cmd=0x${d.cmd.toString(16)} (${d.name}) dev=${d.dev} len=${d.len}`);
    if (d.text)
      console.log(
        d.text
          .split('\n')
          .map((l) => '    ' + l)
          .join('\n')
      );
    else console.log('    raw: ' + hex(m.slice(0, 24)) + (m.length > 24 ? ' ...' : ''));
  }
  if (o.save) {
    // Save the first dump-type reply (0x32 / 0x2e / 0x17) in fixture hex format.
    const dump = msgs.find((m) => [0x32, 0x2e, 0x17].includes(m[4])) || msgs[0];
    if (dump) {
      const fs = require('node:fs');
      const path = require('node:path');
      const dir = path.join(__dirname, '..', 'tests', 'fixtures');
      fs.mkdirSync(dir, { recursive: true });
      const out = path.join(dir, `${o.save}.txt`);
      fs.writeFileSync(out, hex(dump) + '\n');
      console.log(`\nsaved ${dump.length} bytes -> tests/fixtures/${o.save}.txt`);
    } else {
      console.log('\n(--save: no reply to save)');
    }
  }
  input.closePort();
  output.closePort();
}

main().catch((e) => {
  console.error('error:', e);
  process.exit(1);
});
