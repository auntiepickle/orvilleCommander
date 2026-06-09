// tests/midi.test.js
//
// Covers the per-wave request counter, the idle-reset watchdog, and
// getDumpStats. The byte-level contract suite for sendSysEx /
// sendObjectInfoDump / sendValuePut / sendKeypress lives in the second
// describe below. The counter/watchdog cases mirror its actual contract:
//
//   1. 0->1 transition arms the idle watchdog.
//   2. all-received fires when outstanding returns to 0.
//   3. the idle watchdog is rearmed by mid-wave sends and receives
//      (it is a silence timer, not a fixed hard ceiling).
//   4. the absolute WATCHDOG_MAX_MS cap fires under continuous activity.
//   5. notifyResponse with outstanding===0 is a no-op.
//   6. getDumpStats returns a snapshot copy, not a live reference.
//
// midi.js's finishWave touches a single appState key (lastDumpComplete)
// via the real store.setState. The real store/state are safe under jest
// because store.js's only side-effect import is logger.js (mocked here)
// and we register no store subscribers in this file. The beforeEach reset
// covers only lastDumpComplete; if a future test asserts on another
// appState field, expand the reset in lockstep.

jest.mock('../src/logger.js', () => ({
  log: jest.fn(),
}));

// parser.js is mocked to keep the import graph confined to midi.js. The
// real parser.js loads renderer.js / main.js transitively, which have
// top-level DOM and module wiring not needed for the counter contract.
// midi.js only references parseResponse from inside addSysexListener,
// which is never invoked by these tests.
jest.mock('../src/parser.js', () => ({
  parseResponse: jest.fn(),
}));

import {
  sendObjectInfoDump,
  sendValueDump,
  notifyResponse,
  getDumpStats,
  setMidiPorts,
  sendSysEx,
  sendValuePut,
  sendKeypress,
  addSysexListener,
} from '../src/midi.js';
import { parseResponse } from '../src/parser.js';
import { on } from '../src/events.js';
import { appState } from '../src/state.js';

describe('midi.js per-wave counter and watchdog (7c)', () => {
  let received;
  let unsubscribe;

  beforeEach(() => {
    jest.useFakeTimers();
    received = [];
    unsubscribe = on('dumpComplete', (p) => received.push(p));
    appState.lastDumpComplete = null;
  });

  afterEach(() => {
    if (unsubscribe) unsubscribe();
    jest.useRealTimers();
  });

  test('first send (0->1 transition) arms the idle watchdog', () => {
    sendObjectInfoDump('a');
    jest.advanceTimersByTime(1499);
    expect(received).toHaveLength(0);
    jest.advanceTimersByTime(1);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ reason: 'watchdog', sendCount: 1 });
  });

  test('all-received fires once when outstanding returns to 0', () => {
    sendObjectInfoDump('a');
    sendValueDump('b');
    expect(received).toHaveLength(0);
    notifyResponse('objectinfo', 'a');
    expect(received).toHaveLength(0);
    notifyResponse('valuedump', 'b');
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      reason: 'all-received',
      sendCount: 2,
      receiveCount: 2,
      lastKey: 'b',
    });
    expect(appState.lastDumpComplete).toMatchObject({ reason: 'all-received' });
  });

  test('idle watchdog is rearmed by mid-wave sends and receives (not a hard ceiling)', () => {
    sendObjectInfoDump('a'); // armed at t=0, would fire t=1500
    jest.advanceTimersByTime(1000); // t=1000
    sendObjectInfoDump('b'); // send rearms -> would fire t=2500
    jest.advanceTimersByTime(1000); // t=2000, outstanding=2
    notifyResponse('objectinfo', 'a'); // receive rearms -> would fire t=3500, outstanding=1
    jest.advanceTimersByTime(1499); // t=3499
    expect(received).toHaveLength(0);
    jest.advanceTimersByTime(1); // t=3500
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      reason: 'watchdog',
      sendCount: 2,
      receiveCount: 1,
      lastKey: 'b',
    });
  });

  test('absolute WATCHDOG_MAX_MS cap fires even under continuous activity', () => {
    sendObjectInfoDump('a'); // waveStart t=0, outstanding stays >0 throughout
    // Rearm the idle window every second so only the absolute cap can end
    // the wave. WATCHDOG_MAX_MS is 10000 and WATCHDOG_IDLE_MS is 1500.
    for (let t = 1000; t < 10000; t += 1000) {
      jest.advanceTimersByTime(1000);
      sendObjectInfoDump('x');
      expect(received).toHaveLength(0);
    }
    jest.advanceTimersByTime(1000); // reach t=10000, the absolute cap
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ reason: 'watchdog' });
  });

  test('notifyResponse with outstanding===0 is a no-op', () => {
    notifyResponse('objectinfo', 'nothing');
    expect(received).toHaveLength(0);
    sendObjectInfoDump('a');
    notifyResponse('objectinfo', 'a');
    expect(received).toHaveLength(1);
    notifyResponse('objectinfo', 'a');
    expect(received).toHaveLength(1);
  });

  test('getDumpStats returns a snapshot copy, not a live reference', () => {
    const before = getDumpStats();
    sendObjectInfoDump('a');
    notifyResponse('objectinfo', 'a');
    const after = getDumpStats();
    expect(after).not.toBe(before);
    expect(after.all - before.all).toBe(1);
    after.all = 9999;
    const fresh = getDumpStats();
    expect(fresh.all).not.toBe(9999);
  });
});

describe('midi.js SysEx byte contract', () => {
  let output;

  beforeEach(() => {
    jest.useFakeTimers();
    output = { sendSysex: jest.fn() };
    setMidiPorts(output, { addListener: jest.fn() }, 0);
  });

  afterEach(() => {
    // Drain any open request wave so its watchdog timer does not leak.
    jest.advanceTimersByTime(1500);
    jest.useRealTimers();
  });

  test('sendSysEx frames the Eventide manufacturer id and device/cmd/data', () => {
    sendSysEx(0x18, [0x01, 0x02]);
    expect(output.sendSysex).toHaveBeenCalledWith([0x1c, 0x70], [0x00, 0x18, 0x01, 0x02]);
  });

  test('sendSysEx uses the configured device id', () => {
    setMidiPorts(output, { addListener: jest.fn() }, 7);
    sendSysEx(0x18, []);
    expect(output.sendSysex).toHaveBeenCalledWith([0x1c, 0x70], [0x07, 0x18]);
  });

  test('sendObjectInfoDump emits cmd 0x31 with the key as ASCII bytes', () => {
    sendObjectInfoDump('0');
    expect(output.sendSysex).toHaveBeenCalledWith([0x1c, 0x70], [0x00, 0x31, 0x30]);
  });

  test('sendValueDump emits cmd 0x2d with the key as ASCII bytes', () => {
    sendValueDump('1');
    expect(output.sendSysex).toHaveBeenCalledWith([0x1c, 0x70], [0x00, 0x2d, 0x31]);
  });

  test('sendValuePut emits cmd 0x2d with key, 0x20 separator, then value bytes', () => {
    sendValuePut('1c', '1');
    expect(output.sendSysex).toHaveBeenCalledWith(
      [0x1c, 0x70],
      [0x00, 0x2d, 0x31, 0x63, 0x20, 0x31]
    );
  });

  test('sendKeypress emits cmd 0x01 with the mask split into nibbles', () => {
    sendKeypress([0xff, 0xff, 0xff, 0xef]);
    expect(output.sendSysex).toHaveBeenCalledWith(
      [0x1c, 0x70],
      [0x00, 0x01, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0e, 0x0f]
    );
  });

  test('sendSysEx with no output logs an error and does not throw', () => {
    setMidiPorts(null, null, 0);
    expect(() => sendSysEx(0x18, [])).not.toThrow();
  });
});

describe('addSysexListener multi-packet reassembly', () => {
  let handler;

  beforeEach(() => {
    parseResponse.mockClear();
    handler = null;
    const input = {
      addListener: (type, cb) => {
        if (type === 'sysex') handler = cb;
      },
    };
    setMidiPorts({ sendSysex: jest.fn() }, input, 1);
    addSysexListener();
  });

  test('passes a complete single-packet SysEx straight through', () => {
    const msg = [0xf0, 0x1c, 0x70, 1, 0x2e, 0x41, 0xf7];
    handler({ data: msg });
    expect(parseResponse).toHaveBeenCalledTimes(1);
    expect(parseResponse).toHaveBeenCalledWith(msg);
  });

  test('reassembles a SysEx split across packets and parses once on F7', () => {
    handler({ data: [0xf0, 0x1c, 0x70, 1, 0x17, 0x01, 0x02] }); // header packet, no F7
    expect(parseResponse).not.toHaveBeenCalled();
    handler({ data: [0x03, 0x04, 0xf7] }); // continuation + terminator
    expect(parseResponse).toHaveBeenCalledTimes(1);
    expect(parseResponse).toHaveBeenCalledWith([
      0xf0, 0x1c, 0x70, 1, 0x17, 0x01, 0x02, 0x03, 0x04, 0xf7,
    ]);
  });

  test('a new F0 packet resets the buffer (no leakage between messages)', () => {
    handler({ data: [0xf0, 0x1c, 0x70, 1, 0x17, 0x01] }); // incomplete, no F7
    handler({ data: [0xf0, 0x1c, 0x70, 1, 0x2e, 0x41, 0xf7] }); // fresh complete message
    expect(parseResponse).toHaveBeenCalledTimes(1);
    expect(parseResponse).toHaveBeenCalledWith([0xf0, 0x1c, 0x70, 1, 0x2e, 0x41, 0xf7]);
  });

  test('accepts Uint8Array event data', () => {
    handler({ data: Uint8Array.from([0xf0, 0x1c, 0x70, 1, 0x2e, 0x41, 0xf7]) });
    expect(parseResponse).toHaveBeenCalledWith([0xf0, 0x1c, 0x70, 1, 0x2e, 0x41, 0xf7]);
  });

  test('reassembles a SysEx split across three packets', () => {
    handler({ data: [0xf0, 0x1c, 0x70, 1, 0x17] }); // header
    handler({ data: [0x01, 0x02] }); // middle continuation
    expect(parseResponse).not.toHaveBeenCalled();
    handler({ data: [0x03, 0xf7] }); // final continuation + terminator
    expect(parseResponse).toHaveBeenCalledTimes(1);
    expect(parseResponse).toHaveBeenCalledWith([0xf0, 0x1c, 0x70, 1, 0x17, 0x01, 0x02, 0x03, 0xf7]);
  });

  test('ignores a stray continuation packet (no F0 header) ending in F7', () => {
    handler({ data: [0x03, 0x04, 0xf7] }); // headerless fragment that happens to end in F7
    expect(parseResponse).not.toHaveBeenCalled(); // F0 guard rejects it
    handler({ data: [0xf0, 0x1c, 0x70, 1, 0x2e, 0x41, 0xf7] }); // then a real message
    expect(parseResponse).toHaveBeenCalledTimes(1);
    expect(parseResponse).toHaveBeenCalledWith([0xf0, 0x1c, 0x70, 1, 0x2e, 0x41, 0xf7]);
  });
});
