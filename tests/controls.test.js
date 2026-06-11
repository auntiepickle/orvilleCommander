// tests/controls.test.js
// Covers the keypress mask table and the button -> SysEx wiring in setupKeypressControls,
// including the 'ab' DSP-toggle and 'parameter' navigation special cases.

jest.mock('../src/midi.js', () => ({
  sendKeypress: jest.fn(),
  sendSysEx: jest.fn(),
  sendValueDump: jest.fn(),
  isWaveOpen: jest.fn(() => false),
}));

jest.mock('../src/renderer.js', () => ({
  updateScreen: jest.fn(),
}));

jest.mock('../src/logger.js', () => ({
  log: jest.fn(),
}));

jest.mock('../src/navigation.js', () => ({
  ...jest.requireActual('../src/navigation.js'),
  toggleDspKey: jest.fn(() => '801000b'),
}));

import {
  keypressMasks,
  setupKeypressControls,
  setupDataKnob,
  meterPollTick,
} from '../src/controls.js';
import { sendKeypress, sendSysEx, sendValueDump, isWaveOpen } from '../src/midi.js';
import { updateScreen } from '../src/renderer.js';
import { toggleDspKey } from '../src/navigation.js';
import { appState } from '../src/state.js';
import { recordDump, reset as treeReset } from '../src/tree.js';

const addButton = (id) => {
  const btn = document.createElement('button');
  btn.id = id;
  document.body.appendChild(btn);
  return btn;
};

describe('controls', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = '';
    appState.currentKey = '0';
    appState.presetKey = '401000b';
    appState.keyStack = [];
    appState.currentSubs = [
      {
        type: 'COL',
        position: '0',
        key: '0',
        parent: '0',
        statement: 'ORVILLE ROOT OBJECT',
        tag: 'ORVILLE',
      },
      {
        type: 'COL',
        position: '1',
        key: '401000b',
        parent: '0',
        statement: 'Black Hole',
        tag: '',
      },
    ];
    treeReset();
    recordDump(appState.currentSubs); // production: the parser recorded the root dump
    appState.pendingDescend = false;
    appState.pendingLanding = null;
    appState.fetchBitmap = true;
    sendKeypress.mockClear();
    sendSysEx.mockClear();
    updateScreen.mockClear();
    toggleDspKey.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('keypressMasks expose the documented 4-byte masks', () => {
    expect(keypressMasks.enter).toEqual([0xff, 0xff, 0xff, 0xef]);
    expect(keypressMasks.up).toEqual([0xfe, 0xff, 0xfd, 0xff]);
    expect(keypressMasks.ab).toEqual([0xfd, 0xff, 0xfd, 0xff]);
    Object.values(keypressMasks).forEach((mask) => expect(mask).toHaveLength(4));
  });

  test('a button click sends the keypress and refreshes after the delay', () => {
    const btn = addButton('up-btn');
    setupKeypressControls();
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(sendKeypress).toHaveBeenCalledWith(keypressMasks.up);
    expect(updateScreen).not.toHaveBeenCalled(); // deferred behind the 200ms settle

    jest.advanceTimersByTime(200);
    expect(updateScreen).toHaveBeenCalled();
    expect(sendSysEx).toHaveBeenCalledWith(0x18, []); // fetchBitmap enabled
  });

  test("'ab' at root toggles the active preset key", () => {
    const btn = addButton('ab-btn');
    setupKeypressControls();
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    jest.advanceTimersByTime(200);

    expect(sendKeypress).toHaveBeenCalledWith(keypressMasks.ab);
    expect(toggleDspKey).toHaveBeenCalledWith('401000b');
    expect(appState.presetKey).toBe('801000b');
  });

  test("'parameter' at root descends into the active preset", () => {
    const btn = addButton('parameter-btn');
    setupKeypressControls();
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    jest.advanceTimersByTime(200);

    expect(appState.currentKey).toBe('401000b');
    expect(appState.pendingDescend).toBe(true);
    // Derived from tree ancestry (T1b/#105), in the canonical {key, tag,
    // subs} shape (C3/#39): tag from the root dump's main line, subs from
    // the recorded root node.
    expect(appState.keyStack).toEqual([{ key: '0', tag: 'ORVILLE', subs: appState.currentSubs }]);
  });

  test('meterPollTick fans VALUE requests for on-screen CONs — but SKIPS while a wave is open (#107)', () => {
    // The saturation gate: without it, ticks join waves faster than the
    // 31250-baud link drains them (measured live: 44% watchdog ratio,
    // settled renders frozen to the 10s ceiling; 3.57% with the gate).
    appState.currentSubs = [
      { type: 'COL', position: '0', key: '10020020', parent: '10020020', statement: 'save' },
      { type: 'CON', position: '1', key: '10020027', parent: '10020020', statement: 'size %5.0f' },
      { type: 'CON', position: '2', key: '10020028', parent: '10020020', statement: 'left %5.0f' },
      { type: 'NUM', position: '3', key: '10020021', parent: '10020020', statement: 'b %2.0f' },
    ];
    sendValueDump.mockClear();

    isWaveOpen.mockReturnValue(true);
    expect(meterPollTick()).toBe(false); // gated
    expect(sendValueDump).not.toHaveBeenCalled();

    isWaveOpen.mockReturnValue(false);
    expect(meterPollTick()).toBe(true);
    expect(sendValueDump.mock.calls.map((c) => c[0])).toEqual(['10020027', '10020028']); // CONs only
  });

  test('every Nth poll tick also refreshes the on-page param values (live-clock fix)', () => {
    // Live-observed under external MIDI clock: the device updates the
    // midiclock-measured Tempo BPM by itself, but CON-only polling left the
    // NUM frozen at its navigation-time value.
    appState.currentSubs = [
      { type: 'COL', position: '0', key: '40090000', parent: '40090000', statement: 'Tempo' },
      { type: 'CON', position: '10', key: '40090004', parent: '40090000', statement: '' },
      { type: 'NUM', position: '0', key: '40090002', parent: '40090000', statement: 'T %4.0f' },
      { type: 'SET', position: '2', key: '40090001', parent: '40090000', statement: 'S %-9s' },
      { type: 'TRG', position: '0', key: '40090009', parent: '40090000', statement: 'go' },
    ];
    isWaveOpen.mockReturnValue(false);
    sendValueDump.mockClear();

    // 20 ticks (the tick counter is module state, so assert on counts, not
    // positions): the CON fans every tick; the NUM/SET ride only the two
    // Nth-tick refreshes; TRG never.
    for (let i = 0; i < 20; i++) meterPollTick();
    const keys = sendValueDump.mock.calls.map((c) => c[0]);
    expect(keys.filter((k) => k === '40090004')).toHaveLength(20); // CON: every tick
    expect(keys.filter((k) => k === '40090002')).toHaveLength(2); // NUM: Nth ticks only
    expect(keys.filter((k) => k === '40090001')).toHaveLength(2); // SET: Nth ticks only
    expect(keys).not.toContain('40090009'); // TRG: never
  });

  test('fetchBitmap disabled skips the screen fetch', () => {
    appState.fetchBitmap = false;
    const btn = addButton('enter-btn');
    setupKeypressControls();
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    jest.advanceTimersByTime(200);

    expect(sendKeypress).toHaveBeenCalledWith(keypressMasks.enter);
    expect(sendSysEx).not.toHaveBeenCalled();
  });

  // The DATA knob (#130/#131 review findings): wheel travel ACCUMULATES into
  // detents (per-event detents burst keypresses from pixel-mode trackpads),
  // zero-delta events never spin (INC/DEC mutate the device), and the
  // screen refresh is one trailing debounce, not per-detent.
  describe('setupDataKnob', () => {
    const setupKnob = () => {
      document.body.innerHTML =
        '<div id="data-knob"><i class="knob-pointer"></i></div>' +
        '<button id="inc-btn"></button><button id="dec-btn"></button>';
      const knob = document.getElementById('data-knob');
      knob.setPointerCapture = jest.fn(); // jsdom lacks pointer capture
      setupDataKnob();
      return knob;
    };
    const wheel = (knob, deltaY) => {
      const e = new Event('wheel', { bubbles: true, cancelable: true });
      e.deltaY = deltaY;
      knob.dispatchEvent(e);
    };

    test('one wheel notch = one detent; small trackpad deltas accumulate', () => {
      const knob = setupKnob();
      wheel(knob, -100); // one Chrome notch up -> one INC
      expect(sendKeypress).toHaveBeenCalledTimes(1);
      expect(sendKeypress).toHaveBeenCalledWith(keypressMasks.inc);

      sendKeypress.mockClear();
      for (let i = 0; i < 10; i++) wheel(knob, 10); // trackpad stream down
      expect(sendKeypress).toHaveBeenCalledTimes(1); // 100 accumulated -> ONE DEC
      expect(sendKeypress).toHaveBeenCalledWith(keypressMasks.dec);
    });

    test('zero-delta wheel events never send a keypress', () => {
      const knob = setupKnob();
      wheel(knob, 0);
      wheel(knob, 0);
      expect(sendKeypress).not.toHaveBeenCalled();
    });

    test('a spin issues ONE trailing screen refresh, debounced', () => {
      const knob = setupKnob();
      wheel(knob, -100);
      wheel(knob, -100);
      wheel(knob, -100);
      expect(sendKeypress).toHaveBeenCalledTimes(3); // detents stream immediately
      expect(updateScreen).not.toHaveBeenCalled(); // refresh waits for the spin to settle

      jest.advanceTimersByTime(300);
      expect(updateScreen).toHaveBeenCalledTimes(1); // one trailing refresh
    });
  });
});
