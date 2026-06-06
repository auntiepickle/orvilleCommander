// tests/midi.test.js
//
// 7c-scoped: covers the per-wave request counter, 1500ms hard-ceiling
// watchdog, and getDumpStats added in this step. The byte-level contract
// suite for sendSysEx / sendObjectInfoDump / sendValuePut / sendKeypress
// (CLAUDE.md "Testing", originally planned for roadmap step 1) is still
// pending and is not in scope for this file. The 5 cases below mirror
// the counter's actual contract as approved in 7c plan review:
//
//   1. 0->1 transition starts the watchdog.
//   2. all-received fires when outstanding returns to 0.
//   3. watchdog fires at the ceiling and is NOT reset by mid-wave sends.
//   4. notifyResponse with outstanding===0 is a no-op.
//   5. getDumpStats returns a snapshot copy, not a live reference.
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
} from '../src/midi.js';
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

  test('first send (0->1 transition) starts the watchdog', () => {
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

  test('watchdog is per-wave hard ceiling: subsequent sends within the wave do NOT reset it', () => {
    sendObjectInfoDump('a');
    jest.advanceTimersByTime(1000);
    sendObjectInfoDump('b');
    jest.advanceTimersByTime(499);
    expect(received).toHaveLength(0);
    jest.advanceTimersByTime(1);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      reason: 'watchdog',
      sendCount: 2,
      lastKey: 'b',
    });
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
