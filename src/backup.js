// backup.js
// Full-unit backup & restore (#147) over the Tech Note 34 dump protocol. DOM-free
// like library.js: it sends "want" opcodes, captures the (large, slow) dump frame
// via midi.js's raw-capture hook, verifies the checksum, and hands back the raw
// SysEx frame for download. Restore sends a captured/loaded dump frame back to
// the unit. See docs/device-model.md §2 + logs/tn34.txt.
//
// All dumps share the FILES_DUMP wire format: an 8-nibble (4-byte) block size,
// the nibbled data block, then a 1-byte checksum — the sum of every decoded byte
// (size + block + checksum) is 0 mod 256. Bytes travel as MS-nibble-first pairs.

import { sendSysEx, setBackupCapture } from './midi.js';
import { CMD } from './sysex-commands.js';
import { BACKUP } from './constants.js';

/**
 * The backup targets. `want` requests the dump; `dump` is both the inbound dump
 * opcode and the opcode to send back to restore. `replaces` flags the wide-blast
 * restores (whole presets / all NV RAM) that need a strong confirmation.
 */
export const BACKUP_KINDS = {
  internal: {
    want: CMD.INTERNAL_WANT,
    dump: CMD.INTERNAL_DUMP,
    label: 'Full unit (internal memory)',
    replaces: true,
  },
  files: { want: CMD.FILES_WANT, dump: CMD.FILES_DUMP, label: 'All presets', replaces: true },
  program: {
    want: CMD.PROGRAM_WANT,
    dump: CMD.PROGRAM_DUMP,
    label: 'Current program',
    replaces: false,
  },
  setup: { want: CMD.SETUP_WANT, dump: CMD.SETUP_DUMP, label: 'Unit setup', replaces: false },
};

/** Decode MS-nibble-first pairs into bytes. */
export function denibble(nibbles) {
  const out = new Uint8Array(nibbles.length >> 1);
  for (let i = 0; i < out.length; i++)
    out[i] = ((nibbles[2 * i] & 0x0f) << 4) | (nibbles[2 * i + 1] & 0x0f);
  return out;
}

/** Encode bytes into MS-nibble-first pairs (for restore framing). */
export function renibble(bytes) {
  const out = new Array(bytes.length * 2);
  for (let i = 0; i < bytes.length; i++) {
    out[2 * i] = (bytes[i] >> 4) & 0x0f;
    out[2 * i + 1] = bytes[i] & 0x0f;
  }
  return out;
}

/**
 * Parse a dump frame (`F0 1C 70 dev cmd <nibbles…> F7`) into its decoded block,
 * declared size, and checksum validity. INFO dumps are ASCII (not nibbled) and
 * are not parsed here — they are not a backup target.
 *
 * @param {number[]} frame
 */
export function parseDumpFrame(frame) {
  const cmd = frame[4];
  const nibbles = frame.slice(5, frame.length - 1);
  const data = denibble(nibbles); // 4-byte size header + block + 1-byte checksum
  const declaredSize =
    data.length >= 4 ? ((data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]) >>> 0 : 0;
  let sum = 0;
  for (const b of data) sum = (sum + b) & 0xff;
  const checksumOk = data.length > 0 && sum === 0;
  return { cmd, data, declaredSize, checksumOk };
}

/**
 * Requests a backup of `kind`, capturing the dump frame. Reports byte progress
 * through the transfer; resolves via onDone with `{ kind, label, frame, data,
 * declaredSize, checksumOk }` or onError. Returns a cancel function.
 *
 * @param {string} kind - a key of BACKUP_KINDS
 * @param {{onProgress?:(bytes:number)=>void, onDone?:(r:object)=>void, onError?:(msg:string)=>void}} cb
 */
export function requestBackup(kind, { onProgress, onDone, onError } = {}) {
  const spec = BACKUP_KINDS[kind];
  if (!spec) {
    onError?.(`Unknown backup kind: ${kind}`);
    return () => {};
  }
  let started = false;
  let lastBytes = 0;
  let lastAt = Date.now();
  let done = false;
  let idleTimer = null;
  const finish = (result, err) => {
    if (done) return;
    done = true;
    if (idleTimer) clearInterval(idleTimer);
    setBackupCapture(null);
    if (err) onError?.(err);
    else onDone?.(result);
  };
  setBackupCapture({
    onProgress: (bytes) => {
      started = true;
      lastBytes = bytes;
      lastAt = Date.now();
      onProgress?.(bytes);
    },
    onFrame: (frame) => {
      if (frame[4] === CMD.ERROR) {
        finish(null, 'The device reported an error.');
        return;
      }
      if (frame[4] === CMD.OK) return; // an ack, not the dump — keep waiting
      // Any other (non-object-protocol) frame the capture routes here IS the
      // dump — its opcode varies across the unit's dump types (TN34 vs Orville),
      // so don't gate on a specific one.
      const parsed = parseDumpFrame(frame);
      finish({ kind, label: spec.label, frame, ...parsed });
    },
  });
  // Idle watchdog: never started -> no device / wrong reply; started then silent
  // for STALL_MS -> the (terminator-less so far) frame finished or stalled.
  idleTimer = setInterval(() => {
    const idle = Date.now() - lastAt;
    if (!started && idle > BACKUP.START_TIMEOUT_MS) finish(null, 'No response from the device.');
    else if (started && idle > BACKUP.STALL_MS)
      finish(null, `Transfer stalled at ${lastBytes} bytes.`);
  }, 1000);
  sendSysEx(spec.want, []);
  return () => finish(null, 'Cancelled.');
}

/**
 * Restores by sending a dump frame back to the unit. The frame is re-sent under
 * the CURRENTLY connected device id (via sendSysEx), so a backup taken at one id
 * restores at another. Most dumps ack nothing (Tech Note 34 "Response: none"),
 * so it settles after a grace period unless an OK/ERROR arrives first.
 *
 * @param {number[]} frame - a dump frame (F0 1C 70 dev cmd … F7)
 * @param {{onDone?:()=>void, onError?:(msg:string)=>void}} cb
 */
export function restore(frame, { onDone, onError } = {}) {
  const cmd = frame[4];
  const nibbles = frame.slice(5, frame.length - 1);
  let done = false;
  let settle = null;
  const finish = (err) => {
    if (done) return;
    done = true;
    if (settle) clearTimeout(settle);
    setBackupCapture(null);
    if (err) onError?.(err);
    else onDone?.();
  };
  setBackupCapture({
    onProgress: () => {},
    onFrame: (f) => {
      if (f[4] === CMD.ERROR) finish('The device reported an error during restore.');
      else if (f[4] === CMD.OK) finish();
    },
  });
  sendSysEx(cmd, nibbles); // re-frames as F0 1C 70 <current-dev> <cmd> <nibbles> F7
  settle = setTimeout(() => finish(), BACKUP.RESTORE_SETTLE_MS);
}

/** A timestamped, filesystem-safe default filename for a backup of `kind`. */
export function backupFilename(kind, stamp) {
  const safe = String(stamp || '').replace(/[: ]/g, '-');
  return `orville-${kind}-${safe}.syx`;
}

/**
 * Extracts the dump frame from uploaded file bytes (a raw .syx). Returns the
 * `F0 … F7` frame as a number[], or null if no Eventide dump frame is present.
 *
 * @param {Uint8Array|number[]} bytes
 */
export function frameFromFile(bytes) {
  const a = Array.from(bytes);
  const start = a.indexOf(0xf0);
  const end = a.lastIndexOf(0xf7);
  if (start < 0 || end <= start) return null;
  const frame = a.slice(start, end + 1);
  if (frame[1] !== 0x1c || frame[2] !== 0x70) return null; // not an Eventide frame
  return frame;
}
