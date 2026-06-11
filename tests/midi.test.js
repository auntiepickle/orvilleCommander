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
  isWaveOpen,
  setMidiPorts,
  sendSysEx,
  sendValuePut,
  sendKeypress,
  addSysexListener,
  inboundFrameError,
} from '../src/midi.js';
import { parseResponse } from '../src/parser.js';
import { on } from '../src/events.js';
import { appState } from '../src/state.js';
import { recordDump, isFresh, reset as treeReset } from '../src/tree.js';

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
      objectinfoSends: 1, // the OBJECTINFO request only; the VALUE one is not counted
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

  test('raw inbound packets rearm the idle watchdog — partial packets are not silence (#107)', () => {
    // A streaming multi-packet bitmap must keep the wave alive: the idle
    // watchdog is a silence detector, and rearm-on-parse-only watchdogged
    // the bitmap itself plus everything queued behind it (measured live).
    let handler;
    const input = {
      addListener: (type, fn) => {
        handler = fn;
      },
      removeListener: jest.fn(),
    };
    setMidiPorts({ sendSysex: jest.fn() }, input, 0);
    addSysexListener();

    sendObjectInfoDump('a'); // idle watchdog armed: would fire at t=1500
    jest.advanceTimersByTime(1000); // t=1000
    handler({ data: [0x01, 0x02, 0x03] }); // partial packet (no F0/F7): rearm -> t=2500
    jest.advanceTimersByTime(1400); // t=2400
    expect(received).toHaveLength(0); // still alive
    jest.advanceTimersByTime(100); // t=2500: genuine silence since the packet
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ reason: 'watchdog' });
  });

  test('isWaveOpen tracks outstanding across send/receive/watchdog (#107 poll gate)', () => {
    expect(isWaveOpen()).toBe(false);
    sendObjectInfoDump('a');
    expect(isWaveOpen()).toBe(true);
    sendValueDump('b');
    notifyResponse('objectinfo', 'a');
    expect(isWaveOpen()).toBe(true); // b still outstanding
    notifyResponse('valuedump', 'b');
    expect(isWaveOpen()).toBe(false); // drained
    sendObjectInfoDump('c');
    jest.advanceTimersByTime(1500); // idle watchdog force-completes
    expect(isWaveOpen()).toBe(false); // watchdog resets outstanding too
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
    setMidiPorts(output, { addListener: jest.fn(), removeListener: jest.fn() }, 0);
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
    setMidiPorts(output, { addListener: jest.fn(), removeListener: jest.fn() }, 7);
    sendSysEx(0x18, []);
    expect(output.sendSysex).toHaveBeenCalledWith([0x1c, 0x70], [0x07, 0x18]);
  });

  test('sendObjectInfoDump emits cmd 0x31 with the key as ASCII bytes', () => {
    sendObjectInfoDump('0');
    expect(output.sendSysex).toHaveBeenCalledWith([0x1c, 0x70], [0x00, 0x31, 0x30]);
  });

  test('sendValuePut marks the stable subtree dirty — the invalidation chokepoint (#113)', () => {
    treeReset();
    recordDump([
      {
        type: 'COL',
        position: '0',
        key: '10020010',
        parent: '10020010',
        statement: 'load new preset',
        tag: 'load',
      },
    ]);
    expect(isFresh('10020010')).toBe(true);
    sendValuePut('1002001c', '1'); // the load trigger — any program-subtree put
    expect(isFresh('10020010')).toBe(false);
    treeReset();
  });

  test('sendKeypress distrusts the stable caches — the other mutation chokepoint (#113)', () => {
    // Virtual front-panel keys drive the REAL device UI; a save/delete
    // sequence can mutate the program subtree without any put.
    treeReset();
    recordDump([
      {
        type: 'COL',
        position: '0',
        key: '10020010',
        parent: '10020010',
        statement: 'load new preset',
        tag: 'load',
      },
    ]);
    expect(isFresh('10020010')).toBe(true);
    sendKeypress([0xff, 0xff, 0xff, 0xef]); // any press
    expect(isFresh('10020010')).toBe(false);
    treeReset();
  });

  test('GET_SCREEN (0x18) is wave-counted; the 0x17 response drains it (#107)', () => {
    // The ~1.2s bitmap transfer must keep the wave open so poll ticks gate
    // behind it instead of watchdogging into invisible link time.
    expect(isWaveOpen()).toBe(false);
    sendSysEx(0x18, []);
    expect(isWaveOpen()).toBe(true);
    notifyResponse('screen', null); // parser's 0x17 branch
    expect(isWaveOpen()).toBe(false);
  });

  test('screen sends are counted per-kind in the dumpComplete payload (#3)', () => {
    const received = [];
    const off = on('dumpComplete', (p) => received.push(p));
    sendSysEx(0x18, []);
    notifyResponse('screen', null);
    expect(received[0]).toMatchObject({
      reason: 'all-received',
      screenSends: 1,
      objectinfoSends: 0,
    });
    off();
  });

  test('GET_SCREEN mid-wave is deferred, coalesced, and fired after the drain (#107)', async () => {
    // The device drops requests that collide with its own bitmap
    // transmission (measured live: send=7 recv=4 waves riding to the 10s
    // cap), so bitmap fetches serialize after the open wave — R5's fix.
    // The fire rides a microtask so the wave's final response finishes
    // parsing first; flush with an await before asserting.
    sendObjectInfoDump('a'); // wave open
    output.sendSysex.mockClear();
    sendSysEx(0x18, []);
    sendSysEx(0x18, []); // coalesces with the first
    expect(output.sendSysex).not.toHaveBeenCalled(); // deferred, not sent
    notifyResponse('objectinfo', 'a'); // wave drains
    expect(output.sendSysex).not.toHaveBeenCalled(); // not synchronously...
    jest.runAllTicks(); // ...but on the microtask (fake timers intercept it)
    expect(output.sendSysex).toHaveBeenCalledTimes(1); // exactly one
    expect(output.sendSysex).toHaveBeenCalledWith([0x1c, 0x70], [0x00, 0x18]);
    expect(isWaveOpen()).toBe(true); // the fired fetch is its own counted wave
    notifyResponse('screen', null);
    expect(isWaveOpen()).toBe(false);
  });

  test('a deferred GET_SCREEN re-defers behind requests a dumpComplete handler sends (#107)', async () => {
    // The collision-avoidance core: handler requests (settled-render value
    // fetches, eager-loader steps) must never join a wave whose bitmap is
    // about to be inbound. The deferred fetch yields to them and goes out
    // on a LATER drain, alone on the link.
    let handlerFired = false;
    const off = on('dumpComplete', () => {
      if (!handlerFired) {
        handlerFired = true;
        sendValueDump('x'); // a settled render's fetch opens a new wave
      }
    });
    sendObjectInfoDump('a');
    output.sendSysex.mockClear();
    sendSysEx(0x18, []); // deferred behind the open wave
    notifyResponse('objectinfo', 'a'); // drain -> handler opens a NEW wave
    jest.runAllTicks();
    // The microtask saw outstanding > 0 and kept the fetch deferred.
    const screenSends = output.sendSysex.mock.calls.filter((c) => c[1][1] === 0x18);
    expect(screenSends).toHaveLength(0);
    notifyResponse('valuedump', 'x'); // the handler wave drains
    jest.runAllTicks();
    expect(output.sendSysex.mock.calls.filter((c) => c[1][1] === 0x18)).toHaveLength(1);
    off();
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

// Listener-tracking input mock: stacks every added 'sysex' callback and
// supports removal, so the FB7 re-registration guard is observable.
const makeInput = () => {
  const listeners = [];
  return {
    listeners,
    addListener: (type, cb) => {
      if (type === 'sysex') listeners.push(cb);
    },
    removeListener: (type, cb) => {
      const i = listeners.indexOf(cb);
      if (i !== -1) listeners.splice(i, 1);
    },
  };
};

describe('addSysexListener multi-packet reassembly', () => {
  let input;
  let handler;

  beforeEach(() => {
    parseResponse.mockClear();
    input = makeInput();
    setMidiPorts({ sendSysex: jest.fn() }, input, 1);
    addSysexListener();
    handler = input.listeners[0];
  });

  test('passes a complete single-packet SysEx straight through', () => {
    const msg = [0xf0, 0x1c, 0x70, 1, 0x2e, 0x41, 0xf7];
    handler({ data: msg });
    expect(parseResponse).toHaveBeenCalledTimes(1);
    expect(parseResponse).toHaveBeenCalledWith(msg);
  });

  test('reassembles a SysEx split across packets and parses once on F7', () => {
    // 0x32 fixture: reassembly mechanics are command-agnostic, and a tiny
    // 0x17 payload would now (correctly) be rejected by the #47 boundary
    // validation as shorter than the screen header.
    handler({ data: [0xf0, 0x1c, 0x70, 1, 0x32, 0x41, 0x42] }); // header packet, no F7
    expect(parseResponse).not.toHaveBeenCalled();
    handler({ data: [0x43, 0x44, 0xf7] }); // continuation + terminator
    expect(parseResponse).toHaveBeenCalledTimes(1);
    expect(parseResponse).toHaveBeenCalledWith([
      0xf0, 0x1c, 0x70, 1, 0x32, 0x41, 0x42, 0x43, 0x44, 0xf7,
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
    // 0x32 fixture for the same reason as above (#47 boundary validation).
    handler({ data: [0xf0, 0x1c, 0x70, 1, 0x32] }); // header
    handler({ data: [0x41, 0x42] }); // middle continuation
    expect(parseResponse).not.toHaveBeenCalled();
    handler({ data: [0x43, 0xf7] }); // final continuation + terminator
    expect(parseResponse).toHaveBeenCalledTimes(1);
    expect(parseResponse).toHaveBeenCalledWith([0xf0, 0x1c, 0x70, 1, 0x32, 0x41, 0x42, 0x43, 0xf7]);
  });

  test('ignores a stray continuation packet (no F0 header) ending in F7', () => {
    handler({ data: [0x03, 0x04, 0xf7] }); // headerless fragment that happens to end in F7
    expect(parseResponse).not.toHaveBeenCalled(); // F0 guard rejects it
    handler({ data: [0xf0, 0x1c, 0x70, 1, 0x2e, 0x41, 0xf7] }); // then a real message
    expect(parseResponse).toHaveBeenCalledTimes(1);
    expect(parseResponse).toHaveBeenCalledWith([0xf0, 0x1c, 0x70, 1, 0x2e, 0x41, 0xf7]);
  });

  test('re-registration replaces the listener instead of stacking (FB7)', () => {
    // selectPorts runs from both the button and the cached-config auto-run;
    // pre-FB7 each run stacked another listener and parseResponse fired
    // once per stacked copy, over-decrementing the dump-wave counter.
    addSysexListener();
    expect(input.listeners).toHaveLength(1);

    const msg = [0xf0, 0x1c, 0x70, 1, 0x2e, 0x41, 0xf7];
    input.listeners.forEach((cb) => cb({ data: msg }));
    expect(parseResponse).toHaveBeenCalledTimes(1);
  });

  test('selecting a different input detaches the listener from the old one (FB7)', () => {
    const newInput = makeInput();
    setMidiPorts({ sendSysex: jest.fn() }, newInput, 1);
    addSysexListener();

    expect(input.listeners).toHaveLength(0); // detached from the old input
    expect(newInput.listeners).toHaveLength(1);

    const msg = [0xf0, 0x1c, 0x70, 1, 0x2e, 0x41, 0xf7];
    newInput.listeners.forEach((cb) => cb({ data: msg }));
    expect(parseResponse).toHaveBeenCalledTimes(1);
  });
});

describe('inbound frame validation (#47)', () => {
  const F = (bytes) => [0xf0, ...bytes, 0xf7];

  test('accepts every known-good frame shape', () => {
    expect(inboundFrameError(F([0x1c, 0x70, 1, 0x32, 0x43, 0x4f, 0x4c]))).toBeNull(); // OBJECTINFO 'COL'
    expect(inboundFrameError(F([0x1c, 0x70, 1, 0x2e, 0x41]))).toBeNull(); // VALUE_DUMP
    // Screen dump: header-sized even nibble payload.
    expect(inboundFrameError(F([0x1c, 0x70, 1, 0x17, ...new Array(24).fill(0)]))).toBeNull();
    // Unknown command: passes through (the parser ignores it; rejecting
    // would outlaw discovery captures).
    expect(inboundFrameError(F([0x1c, 0x70, 1, 0x99, 0x01]))).toBeNull();
  });

  test('rejects malformed Eventide frames at error severity', () => {
    expect(inboundFrameError([0xf0, 0x1c, 0x70, 0xf7])).toMatchObject({ severity: 'error' }); // too short
    expect(inboundFrameError(F([0x1c, 0x70, 1, 0x32]))).toMatchObject({
      reason: expect.stringContaining('empty OBJECTINFO'),
      severity: 'error',
    });
    expect(inboundFrameError(F([0x1c, 0x70, 1, 0x2e]))).toMatchObject({
      reason: expect.stringContaining('empty VALUE_DUMP'),
      severity: 'error',
    });
    expect(inboundFrameError(F([0x1c, 0x70, 1, 0x17, ...new Array(25).fill(0)]))).toMatchObject({
      reason: expect.stringContaining('odd screen-dump nibble count'),
      severity: 'error',
    });
    expect(inboundFrameError(F([0x1c, 0x70, 1, 0x17, ...new Array(22).fill(0)]))).toMatchObject({
      reason: expect.stringContaining('shorter than its header'),
      severity: 'error',
    });
  });

  test('foreign-manufacturer frames reject at debug severity (shared port is not a malfunction)', () => {
    expect(inboundFrameError(F([0x43, 0x10, 1, 0x32, 0x41]))).toMatchObject({
      reason: expect.stringContaining('not an Eventide frame'),
      severity: 'debug',
    });
    // Even a TOO-SHORT foreign frame is debug, not error (review fix:
    // manufacturer is checked before length).
    expect(inboundFrameError([0xf0, 0x7d, 0x01, 0xf7])).toMatchObject({
      reason: expect.stringContaining('not an Eventide frame'),
      severity: 'debug',
    });
  });

  test('the listener drops rejected frames before parseResponse and keeps accepting after', () => {
    let handler;
    const input = {
      addListener: (type, fn) => {
        handler = fn;
      },
      removeListener: jest.fn(),
    };
    setMidiPorts({ sendSysex: jest.fn() }, input, 0);
    addSysexListener();
    parseResponse.mockClear();

    handler({ data: [0xf0, 0x43, 0x10, 1, 0x32, 0x41, 0xf7] }); // foreign: dropped
    expect(parseResponse).not.toHaveBeenCalled();

    handler({ data: [0xf0, 0x1c, 0x70, 1, 0x32, 0x41, 0xf7] }); // valid: parsed
    expect(parseResponse).toHaveBeenCalledTimes(1);
  });
});
