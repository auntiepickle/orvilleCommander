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

import { keypressMasks, setupKeypressControls, meterPollTick } from '../src/controls.js';
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

  test('fetchBitmap disabled skips the screen fetch', () => {
    appState.fetchBitmap = false;
    const btn = addButton('enter-btn');
    setupKeypressControls();
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    jest.advanceTimersByTime(200);

    expect(sendKeypress).toHaveBeenCalledWith(keypressMasks.enter);
    expect(sendSysEx).not.toHaveBeenCalled();
  });
});
