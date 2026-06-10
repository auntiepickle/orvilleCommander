// tests/event-bridge.test.js
// Pins the C1 (#37) bridge contract directly: exactly two render triggers
// (objectinfo:received for the current key; dumpComplete), hideLoading driven
// solely by dumpComplete (C4/#40), and teardown unsubscribing everything.

jest.mock('../src/renderer.js', () => ({
  renderScreen: jest.fn(),
}));

jest.mock('../src/bitmap.js', () => ({
  renderBitmap: jest.fn(),
}));

jest.mock('../src/logger.js', () => ({
  log: jest.fn(),
}));

import { registerEventBridge } from '../src/event-bridge.js';
import { renderScreen } from '../src/renderer.js';
import { renderBitmap } from '../src/bitmap.js';
import { appState } from '../src/state.js';
import { emit } from '../src/events.js';

describe('event-bridge (C1: dumpComplete-driven rendering)', () => {
  let hideLoading;
  let teardown;

  beforeEach(() => {
    renderScreen.mockClear();
    renderBitmap.mockClear();
    hideLoading = jest.fn();
    appState.currentKey = '10010000';
    appState.currentSubs = [{ key: '10010000', type: 'COL', parent: '10010000' }];
    appState.lastAscii = 'COL 0 10010000 10010000 setup setup';
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

  test('objectinfo:received for another key does not render', () => {
    emit('objectinfo:received', { key: '801000b' });
    expect(renderScreen).not.toHaveBeenCalled();
  });

  test('dumpComplete renders the settled state and hides loading', () => {
    emit('dumpComplete', { reason: 'all-received' });
    expect(renderScreen).toHaveBeenCalledTimes(1);
    expect(hideLoading).toHaveBeenCalledTimes(1);
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

  test('teardown unsubscribes all listeners', () => {
    teardown();
    teardown = null;
    emit('objectinfo:received', { key: '10010000' });
    emit('dumpComplete', { reason: 'all-received' });
    expect(renderScreen).not.toHaveBeenCalled();
    expect(hideLoading).not.toHaveBeenCalled();
  });
});
