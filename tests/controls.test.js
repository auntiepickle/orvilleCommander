// tests/controls.test.js
// Covers the keypress mask table and the button -> SysEx wiring in setupKeypressControls,
// including the 'ab' DSP-toggle and 'parameter' navigation special cases.

jest.mock('../src/midi.js', () => ({
  sendKeypress: jest.fn(),
  sendSysEx: jest.fn(),
}));

jest.mock('../src/renderer.js', () => ({
  updateScreen: jest.fn(),
}));

jest.mock('../src/logger.js', () => ({
  log: jest.fn(),
}));

jest.mock('../src/navigation.js', () => ({
  // Real makeKeyStackEntry so the 'parameter' nav test exercises the actual
  // keyStack normalization (C3/#39); only toggleDspKey is stubbed.
  ...jest.requireActual('../src/navigation.js'),
  toggleDspKey: jest.fn(() => '801000b'),
}));

import { keypressMasks, setupKeypressControls } from '../src/controls.js';
import { sendKeypress, sendSysEx } from '../src/midi.js';
import { updateScreen } from '../src/renderer.js';
import { toggleDspKey } from '../src/navigation.js';
import { appState } from '../src/state.js';

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
    ];
    appState.autoLoad = false;
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
    expect(appState.autoLoad).toBe(true);
    // Normalized entry, not a raw string (C3/#39): tag derived from the
    // root dump's main line, subs snapshotted for breadcrumb/sibling logic.
    expect(appState.keyStack).toEqual([{ key: '0', tag: 'ORVILLE', subs: appState.currentSubs }]);
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
