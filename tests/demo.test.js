// tests/demo.test.js
// Pins the demo-mode port adapters: framed replies from the captured tree,
// value get/put semantics, the honest placeholder for uncaptured keys, and
// the screen-frame replay.

jest.mock('../src/midi.js', () => ({
  sendObjectInfoDump: jest.fn(),
  sendValueDump: jest.fn(),
  sendValuePut: jest.fn(),
  sendSysEx: jest.fn(),
  notifyResponse: jest.fn(),
}));

jest.mock('../src/logger.js', () => ({
  log: jest.fn(),
}));

import { createDemoPorts, DEMO_NODE_COUNT } from '../src/demo.js';
import { SYSEX, CMD, KEY } from '../src/sysex-commands.js';
import demoData from '../src/demo-data.js';

const asciiOf = (frame) => String.fromCharCode(...frame.slice(SYSEX.FRAME_PREFIX_LEN, -1)).trim();

describe('demo mode ports', () => {
  let ports;
  let frames;

  beforeEach(() => {
    jest.useFakeTimers();
    ports = createDemoPorts();
    frames = [];
    ports.inAdapter.addListener('sysex', (e) => frames.push(e.data));
  });
  afterEach(() => jest.useRealTimers());

  const send = (cmd, ascii) =>
    ports.outAdapter.sendSysex(SYSEX.MANUFACTURER, [
      ports.deviceId,
      cmd,
      ...[...ascii].map((c) => c.charCodeAt(0)),
    ]);

  test('captured dataset is substantial and includes the root', () => {
    expect(DEMO_NODE_COUNT).toBeGreaterThan(50);
    expect(demoData.objectinfo[KEY.ROOT]).toContain('ORVILLE ROOT OBJECT');
  });

  test('OBJECTINFO request answers with the captured framed dump', () => {
    send(CMD.OBJECTINFO_DUMP, KEY.ROOT);
    expect(frames).toHaveLength(0); // async like the wire
    jest.runOnlyPendingTimers();
    expect(frames).toHaveLength(1);
    const frame = frames[0];
    expect(frame[0]).toBe(SYSEX.START);
    expect(frame[3]).toBe(ports.deviceId);
    expect(frame[4]).toBe(CMD.OBJECTINFO);
    expect(frame[frame.length - 1]).toBe(SYSEX.END);
    expect(asciiOf(frame)).toContain('ORVILLE ROOT OBJECT');
  });

  test('uncaptured keys get an honest placeholder node, never silence', () => {
    send(CMD.OBJECTINFO_DUMP, 'deadbeef');
    jest.runOnlyPendingTimers();
    expect(asciiOf(frames[0])).toContain("deadbeef 'not in demo capture'");
  });

  test('value get serves the dump-embedded value; a put overlays and echoes', () => {
    // 40090002 is the Tempo NUM (value captured live).
    send(CMD.VALUE, '40090002');
    jest.runOnlyPendingTimers();
    expect(asciiOf(frames[0])).toMatch(/^40090002 \d+/);

    frames.length = 0;
    send(CMD.VALUE, '40090002 142'); // PUT (0x20 separator)
    jest.runOnlyPendingTimers();
    expect(asciiOf(frames[0])).toBe('40090002 142'); // echo

    frames.length = 0;
    send(CMD.VALUE, '40090002'); // session persistence
    jest.runOnlyPendingTimers();
    expect(asciiOf(frames[0])).toBe('40090002 142');
  });

  test('GET_SCREEN replays the captured frame verbatim', () => {
    send(CMD.GET_SCREEN, '');
    jest.runOnlyPendingTimers();
    expect(frames).toHaveLength(1);
    expect(frames[0]).toBe(demoData.screenFrame);
    expect(frames[0][4]).toBe(CMD.SCREEN_BITMAP);
  });

  test('keypresses are accepted silently', () => {
    send(CMD.KEYPRESS, '');
    jest.runOnlyPendingTimers();
    expect(frames).toHaveLength(0);
  });
});
