// tests/event-bridge.test.js
// Pins the C1 (#37) bridge contract directly: exactly three render triggers
// (current-key dump; child-of-current-menu arrival, R7; dumpComplete), hideLoading
// driven solely by dumpComplete (C4/#40), teardown unsubscribing everything, and the
// C2 (#38) landing / one-shot-descend state machine.

jest.mock('../src/renderer.js', () => ({
  renderScreen: jest.fn(),
  updateScreen: jest.fn(),
}));

jest.mock('../src/bitmap.js', () => ({
  renderBitmap: jest.fn(),
}));

jest.mock('../src/midi.js', () => ({
  sendObjectInfoDump: jest.fn(),
  sendSysEx: jest.fn(),
}));

jest.mock('../src/logger.js', () => ({
  log: jest.fn(),
}));

jest.mock('../src/eager-loader.js', () => ({
  startEagerLoad: jest.fn(),
}));

import { registerEventBridge } from '../src/event-bridge.js';
import { renderScreen, updateScreen } from '../src/renderer.js';
import { renderBitmap } from '../src/bitmap.js';
import { sendObjectInfoDump, sendSysEx } from '../src/midi.js';
import { startEagerLoad } from '../src/eager-loader.js';
import { CMD } from '../src/sysex-commands.js';
import { appState } from '../src/state.js';
import { emit } from '../src/events.js';
import { recordDump, reset as treeReset } from '../src/tree.js';

describe('event-bridge (C1: dumpComplete-driven rendering)', () => {
  let hideLoading;
  let teardown;

  beforeEach(() => {
    renderScreen.mockClear();
    renderBitmap.mockClear();
    updateScreen.mockClear();
    sendObjectInfoDump.mockClear();
    sendSysEx.mockClear();
    hideLoading = jest.fn();
    appState.currentKey = '10010000';
    appState.currentSubs = [{ key: '10010000', type: 'COL', parent: '10010000' }];
    appState.lastAscii = 'COL 0 10010000 10010000 setup setup';
    treeReset();
    appState.pendingLanding = null;
    appState.pendingDescend = false;
    appState.keyStack = [];
    appState.presetKey = '401000b';
    appState.dspAKey = '401000b';
    appState.dspBKey = '801000b';
    appState.fetchBitmap = true;
    appState.eagerLoad = true;
    startEagerLoad.mockClear();
    teardown = registerEventBridge({ hideLoading });
  });

  afterEach(() => {
    if (teardown) teardown();
  });

  test('objectinfo:received for the current key renders immediately (progressive paint)', () => {
    emit('objectinfo:received', { key: '10010000' });
    expect(renderScreen).toHaveBeenCalledTimes(1);
    expect(renderScreen).toHaveBeenCalledWith(
      appState.currentSubs,
      appState.lastAscii,
      expect.any(Function)
    );
    expect(hideLoading).not.toHaveBeenCalled();
  });

  test('objectinfo:received for an unrelated key does not render', () => {
    emit('objectinfo:received', { key: '801000b' });
    expect(renderScreen).not.toHaveBeenCalled();
  });

  test('a stored CHILD of the current menu repaints it on arrival (R7)', () => {
    // Live-validated: the program menu's embedded 'load new preset' dump
    // (the multi-second bank list) arrives after the wave has watchdogged;
    // without this trigger nothing ever repainted and the embed appeared
    // only after navigating away and back. T1b: the TREE proves the child
    // belongs to the on-screen menu (parentage from the menu's own dump).
    appState.currentKey = '10020000';
    appState.currentSubs = [
      {
        type: 'COL',
        position: '0',
        key: '10020000',
        parent: '10020000',
        statement: 'program functions',
        tag: 'program',
      },
    ];
    recordDump([
      {
        type: 'COL',
        position: '0',
        key: '10020000',
        parent: '10020000',
        statement: 'program functions',
        tag: 'program',
      },
      {
        type: 'COL',
        position: '0',
        key: '10020010',
        parent: '10020000',
        statement: 'load new preset',
        tag: 'load',
      },
    ]);
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
    emit('objectinfo:received', { key: '10020010' }); // bare child emit (parser's shape)
    expect(renderScreen).toHaveBeenCalledTimes(1);
  });

  test('dumpComplete for a structure wave renders the settled state and hides loading', () => {
    emit('dumpComplete', { reason: 'all-received', objectinfoSends: 2 });
    expect(renderScreen).toHaveBeenCalledTimes(1);
    expect(hideLoading).toHaveBeenCalledTimes(1);
  });

  test('a value-only wave renders but does NOT hide loading (meter polling must not clear it)', () => {
    emit('dumpComplete', { reason: 'all-received', objectinfoSends: 0 });
    expect(renderScreen).toHaveBeenCalledTimes(1);
    expect(hideLoading).not.toHaveBeenCalled();
  });

  test('a watchdog dumpComplete still hides loading even with nothing to render', () => {
    appState.currentSubs = [];
    emit('dumpComplete', { reason: 'watchdog' });
    expect(renderScreen).not.toHaveBeenCalled(); // empty-subs guard
    expect(hideLoading).toHaveBeenCalledTimes(1); // never leave the spinner up
  });

  test('value:received is not consumed by the bridge (renders ride the wave)', () => {
    emit('value:received', { key: '10010011', immediate: true });
    emit('value:received', { key: '10010011', immediate: false });
    expect(renderScreen).not.toHaveBeenCalled();
    expect(hideLoading).not.toHaveBeenCalled();
  });

  test('screen:received forwards raw bytes to renderBitmap', () => {
    const rawBytes = [1, 2, 3];
    emit('screen:received', { rawBytes });
    expect(renderBitmap).toHaveBeenCalledWith('lcd-canvas', rawBytes);
  });

  test('landing: the root dump navigates to the active preset (C2/#38)', () => {
    appState.currentKey = '0';
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
    appState.pendingLanding = 'root';
    // T1b: in production the parser records the root dump before emitting;
    // the bridge derives the landing keyStack from that tree state.
    recordDump([
      ...appState.currentSubs,
      { type: 'COL', position: '1', key: '401000b', parent: '0', statement: 'Black Hole', tag: '' },
    ]);
    emit('objectinfo:received', { key: '0', subs: appState.currentSubs });

    expect(appState.currentKey).toBe('401000b'); // presetKey prefix '4' -> dspAKey
    expect(appState.presetKey).toBe('401000b');
    expect(appState.pendingLanding).toBe('preset');
    expect(appState.pendingDescend).toBe(true);
    expect(appState.keyStack).toHaveLength(1);
    expect(appState.keyStack[0]).toMatchObject({ key: '0', tag: 'ORVILLE' });
    expect(updateScreen).toHaveBeenCalledTimes(1);
    expect(sendObjectInfoDump).toHaveBeenCalledWith('801000b'); // other-DSP prefetch
    expect(sendSysEx).toHaveBeenCalledWith(CMD.GET_SCREEN, []); // fetchBitmap on
  });

  test('landing honors the persisted DSP B choice via the presetKey prefix', () => {
    appState.currentKey = '0';
    appState.presetKey = '801000b'; // cached hint: B was active
    appState.pendingLanding = 'root';
    emit('objectinfo:received', { key: '0', subs: appState.currentSubs });

    expect(appState.currentKey).toBe('801000b'); // landed on the dump's dspBKey
    expect(sendObjectInfoDump).toHaveBeenCalledWith('401000b'); // prefetch A
  });

  // Drives the C2 landing (root dump arrival with pendingLanding armed) so
  // the #106 eager-load arming can be exercised.
  const land = () => {
    appState.currentKey = '0';
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
    appState.pendingLanding = 'root';
    recordDump([
      ...appState.currentSubs,
      { type: 'COL', position: '1', key: '401000b', parent: '0', statement: 'Black Hole', tag: '' },
    ]);
    emit('objectinfo:received', { key: '0', subs: appState.currentSubs });
  };

  test('eager load starts when the landing wave drains cleanly (#106)', () => {
    land();
    expect(startEagerLoad).not.toHaveBeenCalled(); // armed, not started

    emit('dumpComplete', { reason: 'all-received', objectinfoSends: 3 });
    expect(startEagerLoad).toHaveBeenCalledTimes(1);
    expect(startEagerLoad).toHaveBeenCalledWith('401000b');

    // One-shot: later drains do not restart it.
    emit('dumpComplete', { reason: 'all-received', objectinfoSends: 1 });
    expect(startEagerLoad).toHaveBeenCalledTimes(1);
  });

  test('eager load does not start when the flag is off (#106)', () => {
    appState.eagerLoad = false;
    land();
    emit('dumpComplete', { reason: 'all-received', objectinfoSends: 3 });
    expect(startEagerLoad).not.toHaveBeenCalled();
  });

  test('eager load stays armed through a stalled wave and starts on the next clean drain (#106)', () => {
    // Live-validated: with fetchBitmap on, the landing wave routinely
    // watchdogs on the ~1.2s bitmap transfer (R5a) and self-heals on the
    // next wave — disarming on the stall would skip the eager load on the
    // most common config.
    land();
    emit('dumpComplete', { reason: 'watchdog', objectinfoSends: 3 });
    expect(startEagerLoad).not.toHaveBeenCalled(); // not yet — but still armed

    emit('dumpComplete', { reason: 'all-received', objectinfoSends: 1 });
    expect(startEagerLoad).toHaveBeenCalledTimes(1);
    expect(startEagerLoad).toHaveBeenCalledWith('401000b');
  });

  test('dumpComplete without a prior landing never starts an eager load (#106)', () => {
    emit('dumpComplete', { reason: 'all-received', objectinfoSends: 1 });
    expect(startEagerLoad).not.toHaveBeenCalled();
  });

  test('descend one-shot: a COL-only menu dump descends once into its first child', () => {
    appState.currentKey = '401000b';
    appState.pendingDescend = true;
    const subs = [
      {
        type: 'COL',
        position: '0',
        key: '401000b',
        parent: '401000b',
        statement: 'Black Hole',
        tag: '',
      },
      {
        type: 'COL',
        position: '0',
        key: '4040001',
        parent: '401000b',
        statement: 'space parameters',
        tag: 'space',
      },
      {
        type: 'COL',
        position: '0',
        key: '4050001',
        parent: '401000b',
        statement: 'in eq parameters',
        tag: 'in eq',
      },
    ];
    // Divergent global: the descend's keyStack derives from the TREE (which
    // the parser fed from the dump itself in production), never from a
    // stale appState.currentSubs (successor to the C5/#41 staleness pin).
    appState.currentSubs = [
      {
        type: 'COL',
        position: '0',
        key: 'STALE',
        parent: 'STALE',
        statement: 'Stale',
        tag: 'stale',
      },
    ];
    recordDump(subs); // production: the parser records before emitting
    emit('objectinfo:received', { key: '401000b', subs });

    expect(appState.currentKey).toBe('4040001');
    expect(appState.pendingDescend).toBe(false);
    expect(appState.pendingLanding).toBe(null);
    expect(appState.keyStack).toHaveLength(1);
    expect(appState.keyStack[0]).toMatchObject({ key: '401000b' });
    expect(appState.keyStack[0].subs.map((s) => s.key)).not.toContain('STALE'); // tree, not global
    expect(updateScreen).toHaveBeenCalledTimes(1);

    // One-shot: the same dump arriving again must not descend further.
    updateScreen.mockClear();
    appState.currentSubs = subs;
    emit('objectinfo:received', { key: appState.currentKey, subs });
    expect(updateScreen).not.toHaveBeenCalled();
  });

  test('descend consumes without descending when the menu has params', () => {
    appState.currentKey = '10010001';
    appState.pendingDescend = true;
    const subs = [
      {
        type: 'COL',
        position: '0',
        key: '10010001',
        parent: '10010001',
        statement: 'Input',
        tag: 'input',
      },
      {
        type: 'NUM',
        position: '1',
        key: '10010011',
        parent: '10010001',
        statement: 'lvl %3.0f',
        tag: '',
        value: '5',
      },
      {
        type: 'COL',
        position: '2',
        key: '10010012',
        parent: '10010001',
        statement: 'Sub',
        tag: 'sub',
      },
    ];
    emit('objectinfo:received', { key: '10010001', subs });

    expect(appState.pendingDescend).toBe(false);
    expect(appState.currentKey).toBe('10010001'); // no descend
    expect(updateScreen).not.toHaveBeenCalled();
  });

  test('a watchdog dumpComplete clears pending one-shots (no stale landing/descend)', () => {
    appState.pendingLanding = 'root';
    appState.pendingDescend = true;
    emit('dumpComplete', { reason: 'watchdog' });

    expect(appState.pendingLanding).toBe(null);
    expect(appState.pendingDescend).toBe(false);

    // A later dump for the current key must not land or descend.
    emit('objectinfo:received', { key: appState.currentKey, subs: appState.currentSubs });
    expect(updateScreen).not.toHaveBeenCalled();
  });

  test('teardown unsubscribes all listeners', () => {
    teardown();
    teardown = null;
    emit('objectinfo:received', { key: '10010000' });
    emit('dumpComplete', { reason: 'all-received' });
    expect(renderScreen).not.toHaveBeenCalled();
    expect(hideLoading).not.toHaveBeenCalled();
  });
});
