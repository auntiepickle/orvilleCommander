/**
 * Startup characterization — roadmap step 5.5.
 *
 * Pins the observable state writes, MIDI outbound calls, render/bitmap
 * calls, and terminal appState that result from a cached-config startup
 * (Connect MIDI → Select Ports → landing on the active preset).
 *
 * Primary use: feedback loop during refactor work. If a later session's
 * diff changes this test's output, the divergence is signal — decide
 * whether the change is intentional (update expectations in the same
 * commit) or accidental (revert the code change). Wide assertion surface
 * is deliberate; narrower tests would miss incidental behavior shifts.
 *
 * Known bugs pinned as current behavior, NOT fixed by this test:
 *   - (RESOLVED: race by C1/#37, mechanism by C2/#38) the autoload-vs-401000b
 *     landing-page race is gone, and the mechanism it rode on is deleted:
 *     there is no select-ports timer and no autoLoad flag. The bridge lands
 *     on the root dump's arrival and a one-shot pendingDescend lands on the
 *     preset's first menu. Previously the timer-delayed root render consumed
 *     the sticky flag and landed on the first ROOT menu (setup) while the
 *     401000b/801000b dumps were silently dropped.
 *   - (RESOLVED by C3/#39, mechanism replaced by T1b/#105) keyStack used to
 *     hold mixed types: main.js pushed a raw string while the renderer
 *     autoload pushed a {key, tag, subs} object. Every entry is {key, tag,
 *     subs}; since T1b the stack is DERIVED from tree ancestry
 *     (tree.js:deriveKeyStack), not maintained as click history.
 *   - type=8 sub in root dump (key 10040000, empty tag) lands in
 *     currentSubs via parseSubObject; filtered out of autoload by the
 *     type==='COL' check
 *
 * Out of scope for this test:
 *   - SHIFT_FIRST_COLUMN top-left artifact (bitmap mocked at renderBitmap
 *     boundary; pixel output not asserted)
 *   - Fan-out response dumps (they would populate the tree; only the dumps
 *     this flow feeds are recorded — tree reset per test)
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
// to snapshot the landing one-shots + currentKey at call time (pins the C2
// race's precondition). The wrapper calls through to the real renderScreen so
// the real render path is exercised end to end.
jest.mock('../src/renderer.js', () => {
  const actual = jest.requireActual('../src/renderer.js');
  const stateModule = jest.requireActual('../src/state.js');
  const recorder = jest.requireActual('./helpers/startup-recorder.js');
  return {
    ...actual,
    renderScreen: jest.fn((subs, ascii, logParam) => {
      recorder.recordRenderScreenCall({
        pendingLanding: stateModule.appState.pendingLanding,
        pendingDescend: stateModule.appState.pendingDescend,
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
import { appState } from '../src/state.js';
import { setState } from '../src/store.js';
import { hideLoading, showLoading } from '../src/main.js';
import { registerEventBridge } from '../src/event-bridge.js';
import { emit } from '../src/events.js';
import { KEY } from '../src/sysex-commands.js';
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
import { reset as treeReset } from '../src/tree.js';
import { stopEagerLoad } from '../src/eager-loader.js';

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
      return `render:land=${e.pendingLanding ?? '-'},desc=${e.pendingDescend},key=${e.currentKey},subsCount=${e.subsCount},subsFirst=${e.subsFirstKey}`;
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
      pendingLanding: null,
      pendingDescend: false,
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
      eagerLoad: true, // #106: the post-landing eager fetch is part of the pinned flow
    });
    treeReset(); // child structure lives in the persistent tree (T1b/#105)
    // menusA/menusB may exist from a prior test; blow them away.
    delete appState.menusA;
    delete appState.menusB;
    // Wire the production parser->renderer dispatch via event-bridge.js. The
    // mocked main.js (top of this file) supplies hideLoading as a recording stub;
    // the bridge gets it via DI so this harness exercises real bridge code,
    // not a copy. Teardown in afterEach prevents cross-test subscriber leakage.
    teardownEventBridge = registerEventBridge({ hideLoading });
  });

  afterEach(() => {
    if (teardownEventBridge) {
      teardownEventBridge();
      teardownEventBridge = null;
    }
    stopEagerLoad(); // the real loader subscribes to the shared event bus
    jest.useRealTimers();
  });

  // Replays the cached-config startup flow. Since C2 the simulation no
  // longer mirrors a select-ports timer step: it reproduces only main.js
  // selectPorts' reset (showLoading + view-to-root + pendingLanding +
  // updateScreen); the LANDING — adopt DSP keys, navigate to the active
  // preset, prefetch the other DSP, screen fetch — fires inside step (c)'s
  // parseResponse via the real event-bridge, and the one-shot descend fires
  // inside step (f)'s. No timers anywhere in the connect flow.
  function simulateSelectPorts() {
    // (b) main.js selectPorts mirror: loading UX + reset + root request.
    showLoading();
    setState(
      {
        currentKey: KEY.ROOT,
        keyStack: [],
        currentSubs: [],
        pendingLanding: 'root',
        pendingDescend: false,
      },
      'main:select-ports-reset'
    );
    updateScreen();
    // (c) feed root fixture — bridge renders the root menu on arrival, then
    //     LANDS: keyStack root entry, currentKey -> active preset (dspAKey,
    //     chosen by the cached presetKey's 'A' prefix), updateScreen,
    //     other-DSP prefetch, 0x18 screen fetch. All recorded.
    parseResponse(rootBytes);
    // (e) advance 500ms — pins that NO connect timers exist since C2.
    jest.advanceTimersByTime(500);
    // (f) feed 401000b — currentKey matches: preset-meta + presetKey writes,
    //     child fan-out, render, then the bridge consumes pendingDescend and
    //     descends into the preset's first short-tag COL menu.
    parseResponse(preset401Bytes);
    // (g) advance 200ms — still nothing pending.
    jest.advanceTimersByTime(200);
    // (h) feed 801000b — background dump: preset-meta only (gate fails on
    //     currentKey; the dump is tree-recorded silently — T1b).
    parseResponse(preset801Bytes);
    // (i) feed 0x17 bitmap — denibble real, renderBitmap mocked.
    parseResponse(bitmapBytes);
    // (j) feed the landed menu's dump (the preset's first short-tag COL) —
    //     currentKey matches; params render and their values are fetched.
    //     pendingDescend was already consumed at (f), so no further descend.
    parseResponse(landedMenuBytes);
    // (k) the wave the fan-outs opened would drain on a real device;
    //     midi.js is mocked here (no wave counting), so fire the bridge's
    //     settled-render path directly: one render + hideLoading. The wave
    //     conceptually carried OBJECTINFO requests (the fan-outs), so the
    //     payload says so — the bridge gates hideLoading on that.
    emit('dumpComplete', { reason: 'all-received', objectinfoSends: 1 });
    // (l) flush — pins that no timers remain.
    jest.runAllTimers();
  }

  // Pins the C2 landing machine directly: the root render happens while the
  // landing is still pending ('root', no descend armed), and the preset
  // render happens with the landing advanced to 'preset' + the descend
  // one-shot armed — which the bridge then consumes to land on the preset's
  // first menu. No timer, no autoLoad flag (deleted in C2/#38).
  test('landing fires on the root dump; descend is consumed by the preset dump (C2/#38)', () => {
    simulateSelectPorts();
    const snapshots = getRenderScreenSnapshots();
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    expect(snapshots[0]).toMatchObject({
      pendingLanding: 'root',
      pendingDescend: false,
      currentKey: '0',
      subsFirstKey: '0',
    });
    expect(snapshots[1]).toMatchObject({
      pendingLanding: 'preset',
      pendingDescend: true,
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
    expect(appState.pendingLanding).toBe(null);
    expect(appState.pendingDescend).toBe(false);

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
    expect(appState.currentKey).toBe(expected401.navColKeys[0]);

    // menusA/menusB set by the `endsWith('000b')` branches regardless of
    // the currentKey gate — they fire even though 401000b/801000b are
    // otherwise silently dropped.
    expect(appState.menusA).toHaveLength(expected401.menusCount);
    expect(appState.menusB).toHaveLength(expected801.menusCount);

    // currentSubs last written by the landed menu's dump (step j), which
    // passed the gate after the bridge descend landed onto it.
    expect(appState.currentSubs[0].key).toBe(expected401.navColKeys[0]);
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

    const landedKey = expected401.navColKeys[0];
    const landedRender = `render:land=-,desc=false,key=${landedKey},subsCount=${expectedLanded.subsCount},subsFirst=${landedKey}`;
    const expected = [
      // Step (b) main.js selectPorts mirror (C2): loading UX, view reset to
      // root + landing armed (one combined setState), then updateScreen —
      // currentKey === '0' hits the renderer conditional, so currentSoftkeys
      // joins currentValues in the clear (childSubs deleted by T1b/#105).
      'showLoading',
      'state:main:select-ports-reset:currentKey,currentSubs,keyStack,pendingDescend,pendingLanding',
      'state:renderer:update-screen-clear:currentSoftkeys,currentValues',
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

      // Root fan-out (every COL child × 2 MIDI calls each, presets excluded
      // — T1b/#105). Order follows fixture order for Option B robustness.
      ...expectedRoot.rootFanOutKeys.flatMap((k) => [
        `midi:objectinfo:${k}`,
        `midi:valuedump:${k}`,
      ]),
      'state:parser:current-key-ascii:lastAscii',
      'state:parser:current-subs:currentSubs',

      // The bridge renders the root menu SYNCHRONOUSLY on arrival (C1) —
      // the root branch pins only currentSubs — and then the C2 LANDING
      // fires in the same handler: one combined setState (keyStack root
      // entry, currentKey -> dspAKey, presetKey, landing advanced to
      // 'preset', descend armed), updateScreen for the preset (currentKey
      // '401000b' is NOT in the renderer conditional list — 2 keys), the
      // other-DSP prefetch, and the 0x18 screen fetch. No timer step.
      `render:land=root,desc=false,key=0,subsCount=${expectedRoot.subsCount},subsFirst=0`,
      'state:renderer:render-pin:currentSubs',
      'state:bridge:landing-root:currentKey,keyStack,pendingDescend,pendingLanding,presetKey',
      'state:renderer:update-screen-clear:currentValues',
      'midi:objectinfo:401000b',
      'midi:valuedump:401000b',
      'midi:objectinfo:801000b',
      'midi:sysex:cmd=0x18,len=0',

      // Step (f) 401000b dump arrives and currentKey matches. Full
      // processing: preset-meta, the presetKey write, child fan-out,
      // lastAscii/currentSubs, the synchronous render (landing 'preset',
      // descend armed), then the bridge consumes the one-shot and descends
      // into the preset's first short-tag COL menu (the intended landing).
      'log:parsedDump:info:Parsed OBJECTINFO_DUMP',
      'state:parser:preset-meta:dspAName,menusA',
      'state:parser:preset-key:presetKey',
      ...expected401.navColKeys.flatMap((k) => [`midi:objectinfo:${k}`, `midi:valuedump:${k}`]),
      'state:parser:current-key-ascii:lastAscii',
      'state:parser:current-subs:currentSubs',
      `render:land=preset,desc=true,key=401000b,subsCount=${expected401.subsCount},subsFirst=401000b`,
      // T1b: the parser's all-COL fan-out covers every embed candidate (the
      // R6 renderer prefetch is deleted), so no duplicate request appears
      // and the render-pins coalesce as before.
      'state:renderer:render-pin:currentSoftkeys,currentSubs',
      'state:bridge:descend-consume:pendingDescend,pendingLanding',
      'log:general:info:Auto-loading first menu',
      'state:bridge:descend:currentKey,keyStack',
      'state:renderer:update-screen-clear:currentValues',
      `midi:objectinfo:${landedKey}`,
      `midi:valuedump:${landedKey}`,

      // Step (h) 801000b dump — background: preset-meta only. The gate
      // fails on currentKey; the dump is still tree-recorded (T1b), with no
      // observable state write or render.
      'log:parsedDump:info:Parsed OBJECTINFO_DUMP',
      'state:parser:preset-meta:dspBName,menusB',

      // Step (i) bitmap. denibble is real; renderBitmap is mocked and only
      // records rawByteLen (asserted separately in Tier B).
      'log:bitmap:debug:Denibbled screen data',
      'bitmap',

      // Step (j) the landed menu's dump — currentKey matches; its children
      // are all params (no COL fan-out), so the parser goes straight to
      // lastAscii/currentSubs and the synchronous render. The params all
      // carry dump values, so NO per-param value fetches fire (#107: NUM
      // follows the same !s.value rule as SET/INF/STR — the old
      // fetch-every-render behavior was the measured self-perpetuating
      // refetch loop) and the two render-pins coalesce.
      'log:parsedDump:info:Parsed OBJECTINFO_DUMP',
      'state:parser:current-key-ascii:lastAscii',
      'state:parser:current-subs:currentSubs',
      landedRender,
      'state:renderer:render-pin:currentSoftkeys,currentSubs',

      // Step (k) dumpComplete — the settled render + hideLoading. Again no
      // value refetches (#107): dump values suffice.
      landedRender,
      'state:renderer:render-pin:currentSoftkeys,currentSubs',
      'hideLoading',

      // #106/#138: the landing armed the eager loader; the clean drain
      // starts it, now warming the PROGRAM menu (10020000) alongside the
      // preset subtree. The preset and landed menu are already tree-cached,
      // and the program-warm key was queued right after the preset root, so
      // it is the serialized walk's first uncached request (its ~70-name
      // bank-list dump is the slowest on the link — warming it makes the
      // first PROGRAM visit instant). No response arrives in this
      // simulation, so the walk holds at one in-flight request.
      'midi:objectinfo:10020000',
    ];

    const actual = drainAndSort(getEvents()).map(normalize).filter(Boolean);
    expect(actual).toEqual(expected);
  });
});
