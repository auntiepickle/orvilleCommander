/**
 * Startup characterization — roadmap step 5.5.
 *
 * Pins the observable state writes, MIDI outbound calls, render/bitmap
 * calls, and terminal appState that result from a cached-config startup
 * (Connect MIDI → Select Ports → cached preset autoload).
 *
 * Primary use: feedback loop during refactor work. If a later session's
 * diff changes this test's output, the divergence is signal — decide
 * whether the change is intentional (update expectations in the same
 * commit) or accidental (revert the code change). Wide assertion surface
 * is deliberate; narrower tests would miss incidental behavior shifts.
 *
 * Known bugs pinned as current behavior, NOT fixed by this test:
 *   - (RESOLVED by C1/#37) the autoload-vs-401000b landing-page race is
 *     gone: the bridge renders the root dump synchronously on arrival —
 *     BEFORE select-ports-init flips autoLoad — so the flag is consumed by
 *     the PRESET render, which descends into the preset's first menu (the
 *     intended landing). Previously the timer-delayed root render consumed
 *     the flag and landed on the first ROOT menu (setup) while the
 *     401000b/801000b dumps were silently dropped.
 *   - (RESOLVED by C3/#39) keyStack used to hold mixed types: main.js
 *     pushed a raw string while the renderer autoload pushed a {key, tag,
 *     subs} object. All pushes now go through makeKeyStackEntry
 *     (navigation.js) and every entry is {key, tag, subs}.
 *   - type=8 sub in root dump (key 10040000, empty tag) lands in
 *     currentSubs via parseSubObject; filtered out of autoload by the
 *     type==='COL' check
 *
 * Out of scope for this test:
 *   - SHIFT_FIRST_COLUMN top-left artifact (bitmap mocked at renderBitmap
 *     boundary; pixel output not asserted)
 *   - Fan-out response dumps (childSubs population); childSubs stays {}
 *   - Audit-tool cache-overwrite bug (test uses fresh defaults)
 *
 * Full rationale and seam design are documented inline in this file (the
 * header above and the Tier A/B comments below).
 */

jest.mock('../src/midi.js', () => {
  const recorder = jest.requireActual('./helpers/startup-recorder.js');
  return {
    sendObjectInfoDump: jest.fn((key) => recorder.recordMidiSend('objectinfo', key)),
    sendValueDump: jest.fn((key) => recorder.recordMidiSend('valuedump', key)),
    sendValuePut: jest.fn((key, value) => recorder.recordMidiSend('valueput', `${key}=${value}`)),
    notifyResponse: jest.fn(),
    sendSysEx: jest.fn((cmd, bytes) =>
      recorder.recordMidiSend('sysex', `cmd=0x${cmd.toString(16)},len=${bytes?.length ?? 0}`)
    ),
    setMidiPorts: jest.fn(),
    addSysexListener: jest.fn(),
  };
});

jest.mock('../src/main.js', () => {
  const recorder = jest.requireActual('./helpers/startup-recorder.js');
  return {
    hideLoading: jest.fn(() => recorder.recordHideLoading()),
    showLoading: jest.fn(() => recorder.recordShowLoading()),
  };
});

// Logger mock is INTENTIONALLY ungated. The real logger silences debug-level
// traces when its logLevel === 'info' (the default) and filters by its own
// logCategories (logger.js module state since C6). The mock records every log() call regardless, which
// lets Tier A assert on the [stateWrite] trace that store.setState emits at
// debug level under a category that defaults false. This is a deliberate
// divergence from the real app's log-visibility behavior; it lets us
// characterize parser writes without mutating config.
jest.mock('../src/logger.js', () => {
  const recorder = jest.requireActual('./helpers/startup-recorder.js');
  return {
    log: jest.fn((msg, level, category) => recorder.recordLog(msg, level, category)),
    levels: { error: 0, info: 1, debug: 2 },
  };
});

jest.mock('../src/controls.js', () => ({
  keypressMasks: { enter: [0xff, 0xff, 0xff, 0xef] },
}));

// bitmap partial mock: denibble real (pure function, exercised end-to-end
// from captured nibbles), renderBitmap replaced with a recording spy.
jest.mock('../src/bitmap.js', () => {
  const actual = jest.requireActual('../src/bitmap.js');
  const recorder = jest.requireActual('./helpers/startup-recorder.js');
  return {
    ...actual,
    renderBitmap: jest.fn((canvasId, rawBytes) => recorder.recordBitmap(rawBytes.length)),
  };
});

// renderer partial mock: everything real except renderScreen, which is wrapped
// to snapshot appState.autoLoad/currentKey at call time (pins the landing-page
// race's precondition). The wrapper calls through to the real renderScreen so
// the autoload branch still fires and exercises the real update path.
jest.mock('../src/renderer.js', () => {
  const actual = jest.requireActual('../src/renderer.js');
  const stateModule = jest.requireActual('../src/state.js');
  const recorder = jest.requireActual('./helpers/startup-recorder.js');
  return {
    ...actual,
    renderScreen: jest.fn((subs, ascii, logParam) => {
      recorder.recordRenderScreenCall({
        autoLoad: stateModule.appState.autoLoad,
        currentKey: stateModule.appState.currentKey,
        subsCount: subs?.length,
        subsFirstKey: subs?.[0]?.key,
      });
      return actual.renderScreen(subs, ascii, logParam);
    }),
  };
});

import { parseResponse } from '../src/parser.js';
import { updateScreen } from '../src/renderer.js';
import { sendObjectInfoDump, sendSysEx } from '../src/midi.js';
import { appState } from '../src/state.js';
import { setState } from '../src/store.js';
import { hideLoading } from '../src/main.js';
import { makeKeyStackEntry } from '../src/navigation.js';
import { registerEventBridge } from '../src/event-bridge.js';
import { emit } from '../src/events.js';
import {
  loadFixture,
  extractExpectedFromRoot,
  extractExpectedFromPreset,
  extractParamKeysFromDump,
} from './helpers/sysex-fixture.js';
import {
  resetRecorder,
  getEvents,
  getRenderScreenSnapshots,
  drainAndSort,
} from './helpers/startup-recorder.js';

// Duplicated from renderer.js so the simulation's toggleDspKey call does not
// route through the mocked renderer module. Keeps the inline main.js:147
// reproduction self-contained.
function toggleDspKey(key) {
  return key.startsWith('4') ? '8' + key.slice(1) : '4' + key.slice(1);
}

// Log substrings that are semantically load-bearing for startup ordering.
// All other log messages are non-whitelisted and get filtered out of the
// Tier A normalized sequence so incidental log additions in unrelated code
// don't break this test.
const WHITELISTED_LOG_TOPICS = [
  'Detected device ID',
  'Parsed OBJECTINFO_DUMP',
  'Auto-loading first menu',
  'Denibbled screen data',
];

// Normalize an event to a short string so the full Tier A sequence can be
// compared with a single toEqual against an array of strings. The diff on
// failure is readable; a toMatchObject over a 60+ element array would not be.
function normalize(e) {
  switch (e.kind) {
    case 'stateWrite':
      return `state:${e.origin}:${e.keys.join(',')}`;
    case 'midiSend':
      return `midi:${e.op}:${e.arg}`;
    case 'renderScreen':
      return `render:autoLoad=${e.autoLoad},key=${e.currentKey},subsCount=${e.subsCount},subsFirst=${e.subsFirstKey}`;
    case 'bitmap':
      return 'bitmap';
    case 'hideLoading':
      return 'hideLoading';
    case 'showLoading':
      return 'showLoading';
    case 'log': {
      const topic = WHITELISTED_LOG_TOPICS.find((t) => e.msg.includes(t));
      return topic ? `log:${e.category}:${e.level}:${topic}` : null;
    }
    default:
      return `unknown:${e.kind}`;
  }
}

let teardownEventBridge = null;

describe('startup characterization (roadmap step 5.5)', () => {
  let rootBytes;
  let preset401Bytes;
  let preset801Bytes;
  let landedMenuBytes;
  let bitmapBytes;
  let expectedRoot;
  let expected401;
  let expected801;
  let expectedLanded;
  let landedParamKeys;

  beforeAll(() => {
    rootBytes = loadFixture('objectinfo-root.txt');
    preset401Bytes = loadFixture('objectinfo-401000b.txt');
    preset801Bytes = loadFixture('objectinfo-801000b.txt');
    bitmapBytes = loadFixture('screen-dump-black-hole.txt');
    expectedRoot = extractExpectedFromRoot(rootBytes);
    expected401 = extractExpectedFromPreset(preset401Bytes);
    expected801 = extractExpectedFromPreset(preset801Bytes);
    // The landed menu since C1: the preset's first short-tag COL. The
    // captured dump for it ships as a fixture, so the flow can be fed to a
    // realistic terminal state (Option B: all values fixture-derived).
    landedMenuBytes = loadFixture('objectinfo-4040001-spaceparams.txt');
    expectedLanded = extractExpectedFromPreset(landedMenuBytes);
    landedParamKeys = extractParamKeysFromDump(landedMenuBytes);
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    resetRecorder();
    document.body.innerHTML =
      '<div id="lcd"></div><canvas id="lcd-canvas"></canvas><textarea id="log-area"></textarea>';
    // Reset appState to defaults — mirrors store.js's initial state.
    Object.assign(appState, {
      currentKey: '0',
      presetKey: '401000b',
      currentValues: {},
      paramOffset: 0,
      autoLoad: false,
      keyStack: [],
      dspAKey: '401000b',
      dspBKey: '801000b',
      dspAName: '',
      dspBName: '',
      currentSubs: [],
      lastAscii: '',
      deviceId: 0,
      // logLevel + logCategories now live in logger.js (C6), not appState.
      fetchBitmap: true,
      updateBitmapOnChange: true,
      currentSoftkeys: [],
      pollingEnabled: false,
      childSubs: {},
    });
    // menusA/menusB may exist from a prior test; blow them away.
    delete appState.menusA;
    delete appState.menusB;
    // Wire the production parser->renderer dispatch via event-bridge.js. The
    // mocked main.js (lines 51-57) supplies hideLoading as a recording stub;
    // the bridge gets it via DI so this harness exercises real bridge code,
    // not a copy. Teardown in afterEach prevents cross-test subscriber leakage.
    teardownEventBridge = registerEventBridge({ hideLoading });
  });

  afterEach(() => {
    if (teardownEventBridge) {
      teardownEventBridge();
      teardownEventBridge = null;
    }
    jest.useRealTimers();
  });

  // Replays the cached-config startup flow. Since C1 the bridge renders the
  // root dump SYNCHRONOUSLY inside step (c)'s parseResponse — before step
  // (d) flips autoLoad — so the root render consumes nothing and the preset
  // render at step (f) takes the autoload descend into the preset's first
  // menu. The 200ms render timers this simulation used to advance are gone.
  function simulateSelectPorts() {
    // (b) updateScreen('0') — reproduces main.js:141
    updateScreen();
    // (c) feed root fixture — bridge renders the root menu on arrival
    //     (objectinfo:received key === currentKey '0', autoLoad still false).
    parseResponse(rootBytes);
    // (d) inline main.js select-ports-init mirror — sets autoLoad=true and
    //     lands currentKey on the cached preset. Mirrors the production
    //     module's combined-per-cluster setState.
    setState(
      {
        keyStack: [
          ...appState.keyStack,
          makeKeyStackEntry(appState.currentKey, appState.currentSubs),
        ],
        currentKey: appState.presetKey,
        autoLoad: true,
      },
      'main:select-ports-init'
    );
    updateScreen();
    sendObjectInfoDump(toggleDspKey(appState.presetKey));
    if (appState.fetchBitmap) sendSysEx(0x18, []);
    // (e) advance 500ms — pins that NO render timers are pending since C1.
    jest.advanceTimersByTime(500);
    // (f) feed 401000b — currentKey now matches, so the full path runs:
    //     preset-meta + presetKey writes, child fan-out, render with
    //     autoLoad=true -> autoload descend into the preset's first
    //     short-tag COL menu (the C1 race-free landing).
    parseResponse(preset401Bytes);
    // (g) advance 200ms — still nothing pending.
    jest.advanceTimersByTime(200);
    // (h) feed 801000b — background dump: preset-meta only (gate fails on
    //     currentKey, and the C8 child-store guard drops it silently).
    parseResponse(preset801Bytes);
    // (i) feed 0x17 bitmap — denibble real, renderBitmap mocked.
    parseResponse(bitmapBytes);
    // (j) feed the landed menu's dump (the preset's first short-tag COL) —
    //     currentKey matches; params render and their values are fetched.
    parseResponse(landedMenuBytes);
    // (k) the wave the fan-outs opened would drain on a real device;
    //     midi.js is mocked here (no wave counting), so fire the bridge's
    //     settled-render path directly: one render + hideLoading.
    emit('dumpComplete', { reason: 'all-received' });
    // (l) flush — pins that no timers remain.
    jest.runAllTimers();
  }

  // Pins the C1 race-free landing directly. Pre-C1, the root render was
  // timer-delayed past select-ports-init, so the FIRST render observed
  // autoLoad=true with currentKey already flipped to the preset — the
  // landing-page race precondition. Since C1 the root dump renders
  // synchronously on arrival: the first render observes autoLoad=false at
  // root, and the autoload flag is consumed by the PRESET render instead.
  test('root renders before select-ports-init; autoload is consumed by the preset render (C1/#37)', () => {
    simulateSelectPorts();
    const snapshots = getRenderScreenSnapshots();
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    expect(snapshots[0]).toMatchObject({
      autoLoad: false,
      currentKey: '0',
      subsFirstKey: '0',
    });
    expect(snapshots[1]).toMatchObject({
      autoLoad: true,
      currentKey: '401000b',
      subsFirstKey: '401000b',
    });
  });

  // Tier B: terminal appState after the full flow. A failure here usually
  // means a state write was dropped, added, or rewired — narrow it down by
  // cross-referencing Tier A, which pins the write ORDER not just the
  // terminal value.
  test('Tier B: terminal appState after cached-config startup', () => {
    simulateSelectPorts();

    // Flow-dependent (hardcoded): these values are about app-flow invariants
    // (defaults in main.js/store.js, which branches fire, which gates fail).
    expect(appState.deviceId).toBe(1);
    expect(appState.presetKey).toBe('401000b');
    expect(appState.autoLoad).toBe(false);
    expect(appState.childSubs).toEqual({});

    // keyStack normalized to a single shape (C3/#39): every entry is
    // {key, tag, subs}, including the root entry main.js pushes at
    // select-ports time. Entry 0's tag derives from the root dump's main
    // line (loaded by the time the push happens in this flow).
    expect(appState.keyStack).toHaveLength(2);
    expect(appState.keyStack[0]).toMatchObject({ key: '0' });
    expect(typeof appState.keyStack[0]).toBe('object');
    expect(Array.isArray(appState.keyStack[0].subs)).toBe(true);
    expect(appState.keyStack[1]).toMatchObject({ key: '401000b' });
    for (const entry of appState.keyStack) {
      expect(typeof entry.key).toBe('string');
      expect(typeof entry.tag).toBe('string');
      expect(Array.isArray(entry.subs)).toBe(true);
    }

    // Device-state-dependent (fixture-derived): values read from the
    // fixtures so this assertion stays valid when fixtures are regenerated
    // against a different device state. The landing since C1 is the
    // preset's first short-tag COL menu, not the first root menu.
    expect(appState.dspAName).toBe(expectedRoot.dspAName);
    expect(appState.dspBName).toBe(expectedRoot.dspBName);
    expect(appState.currentKey).toBe(expected401.shortTagKeys[0]);

    // menusA/menusB set by the `endsWith('000b')` branches regardless of
    // the currentKey gate — they fire even though 401000b/801000b are
    // otherwise silently dropped.
    expect(appState.menusA).toHaveLength(expected401.menusCount);
    expect(appState.menusB).toHaveLength(expected801.menusCount);

    // currentSubs last written by the landed menu's dump (step j), which
    // passed the gate after the preset autoload descended onto it.
    expect(appState.currentSubs[0].key).toBe(expected401.shortTagKeys[0]);
    expect(appState.lastAscii.length).toBeGreaterThan(0);

    // Bitmap raw-byte length sanity: 13-byte header + 1920 pixel bytes per
    // parser.js:174. A drastically smaller value means denibble returned
    // junk or the bitmap fixture is malformed.
    const bitmapEvent = getEvents().find((e) => e.kind === 'bitmap');
    expect(bitmapEvent).toBeDefined();
    expect(bitmapEvent.rawByteLen).toBeGreaterThan(1900);
  });

  // Tier A: full ordered event log. A failure here typically points at
  // parser.js's 0x32/0x2e/0x17 branch structure (origin tags, setState
  // grouping, fan-out filter) or at the startup step ordering in main.js.
  // Read the diff carefully — the normalized form is lossy, but matching
  // failures against the full expected array makes the reordering visible.
  test('Tier A: ordered event log (coalesced, normalized)', () => {
    simulateSelectPorts();

    const landedKey = expected401.shortTagKeys[0];
    const landedRender = `render:autoLoad=false,key=${landedKey},subsCount=${expectedLanded.subsCount},subsFirst=${landedKey}`;
    const expected = [
      // Step (b) updateScreen('0') from main.js. currentKey === '0' hits
      // the renderer conditional, so all three keys (childSubs,
      // currentValues, currentSoftkeys) appear in the patch. Two MIDI sends
      // follow. If these move or disappear, selectPorts' initial screen
      // fetch was reordered or dropped.
      'state:renderer:update-screen-clear:childSubs,currentSoftkeys,currentValues',
      'midi:objectinfo:0',
      'midi:valuedump:0',

      // Step (c) root OBJECTINFO_DUMP parseResponse. deviceId auto-detect
      // fires alone (parser:device-id-detect cluster) because 'Detected
      // device ID' log breaks the bucket. Root-DSP metadata is one combined
      // setState (parser:root-dsp-meta) over the 4 keys.
      'state:parser:device-id-detect:deviceId',
      'log:general:info:Detected device ID',
      'log:parsedDump:info:Parsed OBJECTINFO_DUMP',
      'state:parser:root-dsp-meta:dspAKey,dspAName,dspBKey,dspBName',

      // Root fan-out (short-tag COLs × 2 MIDI calls each). Order follows
      // fixture order; derived from rootShortTagKeys for Option B robustness.
      ...expectedRoot.rootShortTagKeys.flatMap((k) => [
        `midi:objectinfo:${k}`,
        `midi:valuedump:${k}`,
      ]),
      'state:parser:current-key-ascii:lastAscii',
      'state:parser:current-subs:currentSubs',

      // C1: the bridge renders the root menu SYNCHRONOUSLY on
      // objectinfo:received (key === currentKey '0') — inside step (c),
      // BEFORE select-ports-init flips autoLoad. The root branch pins only
      // currentSubs (no currentSoftkeys write on the root layout), and the
      // autoload block is a no-op because autoLoad is still false. This is
      // the race-elimination moment: pre-C1 this render happened 200ms
      // later with autoLoad=true and descended into the first ROOT menu.
      `render:autoLoad=false,key=0,subsCount=${expectedRoot.subsCount},subsFirst=0`,
      'state:renderer:render-pin:currentSubs',

      // Step (d) inline main.js select-ports-init mirror — one combined
      // setState. Then the second updateScreen() runs with currentKey ===
      // '401000b' (NOT in the renderer conditional list), so currentSoftkeys
      // is omitted from the patch — 2 keys, not 3.
      'state:main:select-ports-init:autoLoad,currentKey,keyStack',
      'state:renderer:update-screen-clear:childSubs,currentValues',
      'midi:objectinfo:401000b',
      'midi:valuedump:401000b',
      'midi:objectinfo:801000b',
      'midi:sysex:cmd=0x18,len=0',

      // Step (f) 401000b dump arrives and currentKey now MATCHES (pre-C1
      // the race had already flipped currentKey away and this dump was
      // silently dropped). Full processing: preset-meta, the presetKey
      // write, child fan-out, lastAscii/currentSubs, then the synchronous
      // render with autoLoad=true — whose autoload branch descends into the
      // preset's first short-tag COL menu (the intended landing).
      'log:parsedDump:info:Parsed OBJECTINFO_DUMP',
      'state:parser:preset-meta:dspAName,menusA',
      'state:parser:preset-key:presetKey',
      ...expected401.shortTagKeys.flatMap((k) => [`midi:objectinfo:${k}`, `midi:valuedump:${k}`]),
      'state:parser:current-key-ascii:lastAscii',
      'state:parser:current-subs:currentSubs',
      `render:autoLoad=true,key=401000b,subsCount=${expected401.subsCount},subsFirst=401000b`,
      'state:renderer:render-pin:currentSoftkeys,currentSubs',
      'state:renderer:autoload-clear:autoLoad',
      'log:general:info:Auto-loading first menu',
      'state:renderer:autoload-descend:currentKey,keyStack',
      'state:renderer:update-screen-clear:childSubs,currentValues',
      `midi:objectinfo:${landedKey}`,
      `midi:valuedump:${landedKey}`,

      // Step (h) 801000b dump — background: preset-meta only. The gate
      // fails on currentKey and the C8 child-store guard drops it silently.
      'log:parsedDump:info:Parsed OBJECTINFO_DUMP',
      'state:parser:preset-meta:dspBName,menusB',

      // Step (i) bitmap. denibble is real; renderBitmap is mocked and only
      // records rawByteLen (asserted separately in Tier B).
      'log:bitmap:debug:Denibbled screen data',
      'bitmap',

      // Step (j) the landed menu's dump — currentKey matches; its children
      // are all params (no COL fan-out), so the parser goes straight to
      // lastAscii/currentSubs and the synchronous render. The render
      // fetches a value for every param (none cached yet) between its two
      // render-pin writes, which is why the pins do NOT coalesce here.
      'log:parsedDump:info:Parsed OBJECTINFO_DUMP',
      'state:parser:current-key-ascii:lastAscii',
      'state:parser:current-subs:currentSubs',
      landedRender,
      'state:renderer:render-pin:currentSubs',
      ...landedParamKeys.map((k) => `midi:valuedump:${k}`),
      'state:renderer:render-pin:currentSoftkeys',

      // Step (k) dumpComplete — the settled render + hideLoading. The
      // param values never arrive in this simulation, so the settled render
      // re-issues the same value fetches: that is the C1 wave-driven
      // refetch loop, which converges live once values land.
      landedRender,
      'state:renderer:render-pin:currentSubs',
      ...landedParamKeys.map((k) => `midi:valuedump:${k}`),
      'state:renderer:render-pin:currentSoftkeys',
      'hideLoading',
    ];

    const actual = drainAndSort(getEvents()).map(normalize).filter(Boolean);
    expect(actual).toEqual(expected);
  });
});
