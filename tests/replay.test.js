// tests/replay.test.js
// Exercises the offline replay harness end to end against recorded fixtures:
// recorded SysEx -> real parser/events/bridge/renderer -> rendered LCD HTML
// and decoded screen framebuffer. This is the substrate the deferred HIL
// screenshot-regression tests build on.

jest.mock('../src/main.js', () => ({ showLoading: jest.fn(), hideLoading: jest.fn() }));
jest.mock('../src/logger.js', () => ({ log: jest.fn() }));

import { createReplayHarness } from './helpers/replay.js';
import { loadFixture } from './helpers/sysex-fixture.js';
import { appState } from '../src/state.js';

describe('offline replay harness', () => {
  let h;

  beforeEach(() => {
    jest.useFakeTimers();
    appState.currentSubs = [];
    appState.currentValues = {};
    appState.childSubs = {};
    appState.keyStack = [];
    appState.deviceId = 0;
    appState.currentKey = '10010000';
    appState.presetKey = '401000b';
    appState.dspAKey = '401000b';
    appState.dspBKey = '801000b';
    appState.dspAName = '';
    appState.dspBName = '';
    appState.pendingDescend = false;
    appState.pendingLanding = null;
    appState.paramOffset = 0;
    appState.lastAscii = '';
    appState.updateBitmapOnChange = false;
    h = createReplayHarness({ deviceId: 0 });
  });

  afterEach(() => {
    h.teardown();
    jest.useRealTimers();
  });

  test('replays an OBJECTINFO_DUMP fixture and renders the LCD', () => {
    h.setCurrentKey('10010000');
    // Since C1 the bridge renders synchronously on objectinfo:received for
    // the current key — no timer advance needed for the structure paint.
    // (The render's own child/value fan-out opens a wave that this test
    // leaves open; midi.js wave state resets per fresh wave start.)
    h.feed(loadFixture('objectinfo-10010000.txt'));

    const html = h.lcdHtml();
    expect(appState.currentSubs.length).toBeGreaterThan(0);
    expect(appState.currentSubs[0].key).toBe('10010000');
    expect(html).toContain('main-content');
    expect(h.lcdText().length).toBeGreaterThan(0);
    expect(html).toMatchSnapshot();
  });

  test('replays a screen-dump fixture and decodes the framebuffer to ASCII', () => {
    h.feed(loadFixture('screen-dump-black-hole.txt'));

    const ascii = h.screenAscii();
    expect(ascii.length).toBeGreaterThan(0);
    // 64-row framebuffer; at least one row must contain a lit pixel.
    expect(ascii).toContain('#');
    expect(ascii).toMatchSnapshot();
  });
});
