// tests/backup.test.js
// Backup/restore engine (#147): the Tech Note 34 dump wire format (nibble pack,
// 4-byte size header, sum-to-zero checksum), the want->capture->parse flow, and
// restore re-framing. Device I/O is mocked at the midi.js boundary.

jest.mock('../src/midi.js', () => ({
  sendSysEx: jest.fn(),
  setBackupCapture: jest.fn(),
}));

jest.mock('../src/constants.js', () => {
  const actual = jest.requireActual('../src/constants.js');
  return { ...actual, BACKUP: { START_TIMEOUT_MS: 50, STALL_MS: 50, RESTORE_SETTLE_MS: 20 } };
});

import {
  denibble,
  renibble,
  parseDumpFrame,
  requestBackup,
  restore,
  frameFromFile,
  backupFilename,
  BACKUP_KINDS,
} from '../src/backup.js';
import { sendSysEx, setBackupCapture } from '../src/midi.js';
import { CMD } from '../src/sysex-commands.js';

beforeEach(() => jest.clearAllMocks());

// Build a valid dump frame for `cmd` carrying `block` bytes: 4-byte big-endian
// size header + block + 1-byte sum-to-zero checksum, all nibble-packed.
function makeDumpFrame(cmd, block, dev = 1) {
  const size = block.length;
  const body = [
    (size >>> 24) & 0xff,
    (size >>> 16) & 0xff,
    (size >>> 8) & 0xff,
    size & 0xff,
    ...block,
  ];
  let sum = 0;
  for (const b of body) sum = (sum + b) & 0xff;
  const checksum = (256 - sum) & 0xff; // makes the grand total 0 mod 256
  const data = [...body, checksum];
  return [0xf0, 0x1c, 0x70, dev, cmd, ...renibble(data), 0xf7];
}

describe('nibble codec', () => {
  test('renibble/denibble round-trip (MS nibble first)', () => {
    const bytes = [0x00, 0x01, 0x1b, 0x58, 0xff, 0xa5];
    expect(renibble([0x1b])).toEqual([0x1, 0xb]); // high nibble first
    expect(Array.from(denibble(renibble(bytes)))).toEqual(bytes);
  });
});

describe('parseDumpFrame', () => {
  test('decodes size header + verifies a good checksum', () => {
    const block = [10, 20, 30, 40, 50];
    const frame = makeDumpFrame(CMD.PROGRAM_DUMP, block);
    const p = parseDumpFrame(frame);
    expect(p.cmd).toBe(CMD.PROGRAM_DUMP);
    expect(p.declaredSize).toBe(block.length);
    expect(p.checksumOk).toBe(true);
    // decoded data is size(4) + block + checksum(1)
    expect(p.data.length).toBe(4 + block.length + 1);
  });

  test('flags a bad checksum (corrupted block)', () => {
    const frame = makeDumpFrame(CMD.SETUP_DUMP, [1, 2, 3]);
    frame[frame.length - 3] ^= 0x0f; // corrupt a data nibble near the end
    expect(parseDumpFrame(frame).checksumOk).toBe(false);
  });
});

describe('requestBackup', () => {
  test('sends the want, captures the matching dump, resolves with parsed result', () => {
    const onDone = jest.fn();
    requestBackup('program', { onDone });
    // armed capture + sent the PROGRAM want
    expect(setBackupCapture).toHaveBeenCalledWith(
      expect.objectContaining({ onFrame: expect.any(Function) })
    );
    expect(sendSysEx).toHaveBeenCalledWith(CMD.PROGRAM_WANT, []);
    // feed the captured dump frame
    const cap = setBackupCapture.mock.calls[0][0];
    const frame = makeDumpFrame(CMD.PROGRAM_DUMP, [7, 7, 7]);
    cap.onFrame(frame);
    expect(onDone).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'program', checksumOk: true, declaredSize: 3 })
    );
    // capture disarmed on completion
    expect(setBackupCapture).toHaveBeenLastCalledWith(null);
  });

  test('reports a device ERROR frame as a failure', () => {
    const onError = jest.fn();
    requestBackup('internal', { onError });
    const cap = setBackupCapture.mock.calls[0][0];
    cap.onFrame([0xf0, 0x1c, 0x70, 1, CMD.ERROR, 0xf7]);
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/error/i));
  });

  test('times out when the device never replies', () => {
    jest.useFakeTimers(); // modern fake timers also advance Date.now()
    const onError = jest.fn();
    requestBackup('setup', { onError });
    // the idle watchdog polls every 1s; advance past one tick so the elapsed
    // idle (Date.now-based) exceeds the mocked START_TIMEOUT_MS (50).
    jest.advanceTimersByTime(1100);
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/no response/i));
    jest.useRealTimers();
  });

  test('rejects an unknown kind', () => {
    const onError = jest.fn();
    requestBackup('nope', { onError });
    expect(onError).toHaveBeenCalled();
    expect(sendSysEx).not.toHaveBeenCalled();
  });
});

describe('restore', () => {
  test('re-sends the dump opcode + payload under the current device id', () => {
    jest.useFakeTimers();
    const onDone = jest.fn();
    const frame = makeDumpFrame(CMD.PROGRAM_DUMP, [1, 2], 9); // captured at dev 9
    restore(frame, { onDone });
    // re-framed via sendSysEx(cmd, nibbles) so the CURRENT device id is used
    expect(sendSysEx).toHaveBeenCalledWith(CMD.PROGRAM_DUMP, frame.slice(5, -1));
    jest.advanceTimersByTime(25); // settle (no ack expected)
    expect(onDone).toHaveBeenCalled();
    jest.useRealTimers();
  });

  test('an OK ack finishes restore immediately', () => {
    const onDone = jest.fn();
    restore(makeDumpFrame(CMD.SETUP_DUMP, [1]), { onDone });
    const cap = setBackupCapture.mock.calls[0][0];
    cap.onFrame([0xf0, 0x1c, 0x70, 1, CMD.OK, 0xf7]);
    expect(onDone).toHaveBeenCalled();
  });
});

describe('file helpers', () => {
  test('frameFromFile extracts an Eventide frame, rejects foreign bytes', () => {
    const frame = makeDumpFrame(CMD.INTERNAL_DUMP, [5, 6, 7]);
    const padded = [0x00, 0x00, ...frame, 0x00]; // leading/trailing junk
    expect(frameFromFile(padded)).toEqual(frame);
    expect(frameFromFile([0xf0, 0x42, 0x00, 0xf7])).toBeNull(); // not 1C 70
  });

  test('backupFilename is timestamped + filesystem-safe', () => {
    expect(backupFilename('internal', '2026-06-12 20:01:02')).toBe(
      'orville-internal-2026-06-12-20-01-02.syx'
    );
  });

  test('BACKUP_KINDS flags the wide-blast restores', () => {
    expect(BACKUP_KINDS.internal.replaces).toBe(true);
    expect(BACKUP_KINDS.files.replaces).toBe(true);
    expect(BACKUP_KINDS.program.replaces).toBe(false);
  });
});
