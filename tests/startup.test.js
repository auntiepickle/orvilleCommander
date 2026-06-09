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
 *   - autoload-vs-401000b landing-page race (renderer autoload on root
 *     flips currentKey to first short-tag COL before 401000b arrives; the
 *     401000b and 801000b dumps are silently dropped by parser gate)
 *   - keyStack holds mixed types: main.js:143 pushes a raw string, the
 *     renderer autoload pushes a {key, tag, subs} object
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

// Lodash debounce collapses to identity so render timing is deterministic
// under jest.useFakeTimers(). Matches the pattern in tests/parser.test.js.
jest.mock('lodash.debounce', () => (fn) => fn);

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
import { registerEventBridge } from '../src/event-bridge.js';
import {
  loadFixture,
  extractExpectedFromRoot,
  extractExpectedFromPreset,
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
  let preset10010000Bytes;
  let bitmapBytes;
  let expectedRoot;
  let expected401;
  let expected801;
  let expected10010000;

  beforeAll(() => {
    rootBytes = loadFixture('objectinfo-root.txt');
    preset401Bytes = loadFixture('objectinfo-401000b.txt');
    preset801Bytes = loadFixture('objectinfo-801000b.txt');
    preset10010000Bytes = loadFixture('objectinfo-10010000.txt');
    bitmapBytes = loadFixture('screen-dump-black-hole.txt');
    expectedRoot = extractExpectedFromRoot(rootBytes);
    expected401 = extractExpectedFromPreset(preset401Bytes);
    expected801 = extractExpectedFromPreset(preset801Bytes);
    expected10010000 = extractExpectedFromPreset(preset10010000Bytes);
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
      isLoadingPreset: false,
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

  // Replays the cached-config startup flow with step ordering per roadmap
  // step 5.5 Q2 (swapped per the plan-vs-reality mismatch resolution): the
  // inline main.js:142-154 code runs BEFORE the 500ms timer advance so that
  // when root's setTimeout(200) fires, appState.autoLoad is true. This
  // reproduces the live autoload-on-root → landing-page race behavior that
  // fake timers would otherwise elide.
  function simulateSelectPorts() {
    // (b) updateScreen('0') — reproduces main.js:141
    updateScreen();
    // (c) feed root fixture — parseResponse schedules setTimeout(200)
    parseResponse(rootBytes);
    // (d) inline main.js:142-154 — BEFORE advance, sets autoLoad=true.
    //     Mirrors main:select-ports-init's combined-per-cluster setState
    //     so this simulation tracks the production module.
    setState(
      {
        keyStack: [...appState.keyStack, appState.currentKey],
        currentKey: appState.presetKey,
        autoLoad: true,
      },
      'main:select-ports-init'
    );
    updateScreen();
    sendObjectInfoDump(toggleDspKey(appState.presetKey));
    if (appState.fetchBitmap) sendSysEx(0x18, []);
    // (e) advance 500ms — fires root's setTimeout(200); renderScreen sees
    //     autoLoad=true and the autoload branch flips currentKey.
    jest.advanceTimersByTime(500);
    // (f) feed 401000b — gate fails because currentKey is now the first
    //     short-tag COL. Dump is silently absorbed into menusA/dspAName only.
    parseResponse(preset401Bytes);
    // (g) advance 200ms — no pending timers at this point.
    jest.advanceTimersByTime(200);
    // (h) feed 801000b — same silent-drop path as 401000b.
    parseResponse(preset801Bytes);
    // (i) feed 0x17 bitmap — denibble real, renderBitmap mocked.
    parseResponse(bitmapBytes);
    // (j) feed 10010000 — currentKey now matches main.key; full processing.
    parseResponse(preset10010000Bytes);
    // (k) flush any remaining timers (10010000's setTimeout).
    jest.runAllTimers();
  }

  // Pins the autoload-on-root invariant directly. The landing-page race is
  // only possible because the root dump's renderScreen sees autoLoad=true.
  // If Step 7 reorders initialization such that autoLoad is still false when
  // root renders, this assertion fails and the race disappears silently —
  // exactly the kind of behavior shift the test is here to catch.
  test('first renderScreen call observes autoLoad=true (landing-page race precondition)', () => {
    simulateSelectPorts();
    const snapshots = getRenderScreenSnapshots();
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    expect(snapshots[0]).toMatchObject({
      autoLoad: true,
      currentKey: '401000b',
      subsFirstKey: '0',
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
    expect(appState.isLoadingPreset).toBe(false);
    expect(appState.childSubs).toEqual({});

    // keyStack mixed-types bug pinned. If a future refactor normalizes
    // keyStack entries to a single shape, this assertion is what breaks —
    // update expectations in the same commit that does the normalization.
    expect(appState.keyStack).toHaveLength(2);
    expect(appState.keyStack[0]).toBe('0');
    expect(typeof appState.keyStack[1]).toBe('object');
    expect(appState.keyStack[1]).toMatchObject({ key: '401000b' });

    // Device-state-dependent (fixture-derived): values read from the root
    // dump so this assertion stays valid when fixtures are regenerated
    // against a different device state.
    expect(appState.dspAName).toBe(expectedRoot.dspAName);
    expect(appState.dspBName).toBe(expectedRoot.dspBName);
    expect(appState.currentKey).toBe(expectedRoot.firstShortTagCOLKey);

    // menusA/menusB set by the `endsWith('000b')` branches regardless of
    // the currentKey gate — they fire even though 401000b/801000b are
    // otherwise silently dropped.
    expect(appState.menusA).toHaveLength(expected401.menusCount);
    expect(appState.menusB).toHaveLength(expected801.menusCount);

    // currentSubs last written by the 10010000 dump (step j), which passed
    // the gate after the autoload flipped currentKey onto it.
    expect(appState.currentSubs[0].key).toBe(expectedRoot.firstShortTagCOLKey);
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

    const expected = [
      // Step (b) updateScreen('0') from main.js:141. The first event is
      // R1's combined-per-cluster setState — currentKey === '0' (default
      // from beforeEach) hits the renderer.js:21 conditional, so all three
      // keys (childSubs, currentValues, currentSoftkeys) appear in the
      // patch. Two MIDI sends follow. If these move or disappear,
      // selectPorts' initial screen fetch was reordered or dropped.
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

      // Root fan-out (4 short-tag COLs × 2 MIDI calls each). Order follows
      // fixture order; derived from rootShortTagKeys for Option B robustness.
      ...expectedRoot.rootShortTagKeys.flatMap((k) => [
        `midi:objectinfo:${k}`,
        `midi:valuedump:${k}`,
      ]),
      // 7a.3 split: lastAscii (parser.js:79) and currentSubs (parser.js:87)
      // now have different origin strings (parser:current-key-ascii vs
      // parser:current-subs), so same-origin coalescing breaks. The two
      // entries used to be one bucket pre-7a.3.
      'state:parser:current-key-ascii:lastAscii',
      'state:parser:current-subs:currentSubs',

      // Step (d) inline main.js:142-154 mirror — simulateSelectPorts
      // emits one combined setState tagged main:select-ports-init.
      // Then the second updateScreen() runs with currentKey === '401000b'
      // (NOT in renderer.js:21's conditional list), so currentSoftkeys is
      // omitted from the patch — bucket has 2 keys, not 3. The conditional-
      // omit asymmetry between this entry and step (b)'s is what pins the
      // updateScreen conditional behavior.
      'state:main:select-ports-init:autoLoad,currentKey,keyStack',
      'state:renderer:update-screen-clear:childSubs,currentValues',
      'midi:objectinfo:401000b',
      'midi:valuedump:401000b',
      'midi:objectinfo:801000b',
      'midi:sysex:cmd=0x18,len=0',

      // Step (e) root's setTimeout fires, renderScreen runs with autoLoad=
      // true. The renderScreen call is recorded with snapshot. Inside the
      // real renderScreen body: :266 currentSubs and :529 currentSoftkeys
      // both setState with origin renderer:render-pin and coalesce because
      // no intervening non-stateWrite events fire on the root render path
      // (root has no NUM/SET/CON params triggering sendValueDump and no
      // matching potentialEmbedSubs). Then autoload branch fires:
      // autoload-clear flag, log breaks the bucket, autoload-descend
      // (currentKey + keyStack), inner updateScreen with currentKey now
      // '10010000' which IS in the conditional list (3 keys in patch).
      `render:autoLoad=true,key=401000b,subsCount=${expectedRoot.subsCount},subsFirst=0`,
      'state:renderer:render-pin:currentSoftkeys,currentSubs',
      'state:renderer:autoload-clear:autoLoad',
      'log:general:info:Auto-loading first menu',
      'state:renderer:autoload-descend:currentKey,keyStack',
      'state:renderer:update-screen-clear:childSubs,currentSoftkeys,currentValues',
      `midi:objectinfo:${expectedRoot.firstShortTagCOLKey}`,
      `midi:valuedump:${expectedRoot.firstShortTagCOLKey}`,
      'hideLoading',

      // Step (f) 401000b dump arrives. Gate fails (currentKey is now
      // firstShortTagCOLKey, not '401000b'), so ONLY the endsWith('000b')
      // branch runs — menusA + dspAName written via parser:preset-meta,
      // no presetKey/currentSubs/lastAscii updates. If presetKey appears
      // in this bucket, the race was fixed without updating expectations.
      'log:parsedDump:info:Parsed OBJECTINFO_DUMP',
      'state:parser:preset-meta:dspAName,menusA',

      // Step (h) 801000b dump — same silent-drop pattern as 401000b.
      'log:parsedDump:info:Parsed OBJECTINFO_DUMP',
      'state:parser:preset-meta:dspBName,menusB',

      // Step (i) bitmap. denibble is real; renderBitmap is mocked and only
      // records rawByteLen (asserted separately in Tier B).
      'log:bitmap:debug:Denibbled screen data',
      'bitmap',

      // Step (j) 10010000 dump — currentKey === main.key, so full
      // processing fires: 14 short-tag COL fan-outs, then split lastAscii
      // and currentSubs (same mechanism as in step (c)).
      'log:parsedDump:info:Parsed OBJECTINFO_DUMP',
      ...expected10010000.shortTagKeys.flatMap((k) => [
        `midi:objectinfo:${k}`,
        `midi:valuedump:${k}`,
      ]),
      'state:parser:current-key-ascii:lastAscii',
      'state:parser:current-subs:currentSubs',

      // Step (k) 10010000's setTimeout fires. renderScreen runs with
      // autoLoad=false (root's autoload already cleared it), so no
      // autoload branch fires (no autoload-clear/descend entries). Inside
      // renderScreen, :266 and :529 same-origin coalesce as in step (e).
      // hideLoading completes the flow.
      `render:autoLoad=false,key=${expectedRoot.firstShortTagCOLKey},subsCount=${expected10010000.subsCount},subsFirst=${expectedRoot.firstShortTagCOLKey}`,
      'state:renderer:render-pin:currentSoftkeys,currentSubs',
      'hideLoading',
    ];

    const actual = drainAndSort(getEvents()).map(normalize).filter(Boolean);
    expect(actual).toEqual(expected);
  });
});
