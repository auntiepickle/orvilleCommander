// Event recorder for the startup characterization test (roadmap step 5.5).
//
// Shared module-scope state: the mocks in tests/startup.test.js import the
// record* functions via jest.requireActual, and the test body imports
// getEvents/drainAndSort via normal ESM. Both see the same events array.
// resetRecorder() is called in beforeEach.

const events = [];
const renderScreenCallSnapshots = [];
let nextSeq = 0;

function push(event) {
  events.push({ seq: nextSeq++, ...event });
}

// ----- entry points called from mocks ---------------------------------

// Translates setState-origin [stateWrite] trace messages emitted by
// store.setState back into structured stateWrite events. Non-stateWrite
// log calls are kept as log events for category/level/substring matching.
// Format (from store.js): `[stateWrite] ${origin}: ${Object.keys(partial).join(', ')}`
export function recordLog(msg, level, category) {
  if (category === 'stateWrite') {
    const match = /^\[stateWrite\] (\S+): (.*)$/.exec(msg);
    if (match) {
      const [, origin, keysStr] = match;
      const keys = keysStr
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      push({ kind: 'stateWrite', origin, keys });
      return;
    }
  }
  push({ kind: 'log', msg, level, category });
}

export function recordMidiSend(op, arg) {
  push({ kind: 'midiSend', op, arg });
}

export function recordBitmap(rawByteLen) {
  push({ kind: 'bitmap', rawByteLen });
}

export function recordHideLoading() {
  push({ kind: 'hideLoading' });
}

export function recordShowLoading() {
  push({ kind: 'showLoading' });
}

export function recordRenderScreenCall(snapshot) {
  renderScreenCallSnapshots.push(snapshot);
  push({ kind: 'renderScreen', ...snapshot });
}

// ----- test-facing API -----------------------------------------------

export function resetRecorder() {
  events.length = 0;
  renderScreenCallSnapshots.length = 0;
  nextSeq = 0;
}

export function getEvents() {
  return events;
}

export function getRenderScreenSnapshots() {
  return renderScreenCallSnapshots;
}

// Coalesces consecutive stateWrite events with the same origin into one
// bucket.
//
// Coalescing rule (roadmap step 5.5 Q9.3): the invariant this test
// characterizes is "the SET of keys written in any run of consecutive
// same-origin stateWrites", not "the exact number of setState calls
// within such a run, nor the intra-run ordering of keys". Bucket
// boundaries are event-stream-scoped (see next paragraph), not
// parseResponse-scoped — the per-parseResponse grouping in expected
// Tier A is emergent from intervening non-stateWrite events, not a
// parseResponse-aware check. Step 7's event-bus refactor should be
// free to collapse adjacent `setState({a:x}); setState({b:y})` into
// one `setState({a:x, b:y})` without failing the test — the bucket's
// sorted key-set is unchanged.
//
// An intervening non-stateWrite event (midiSend, log, renderScreen,
// bitmap, hideLoading) TERMINATES the bucket. If parser writes A, then
// sends MIDI, then writes B, Step 7 cannot validly coalesce A and B
// without reordering the MIDI send relative to the state writes — which
// IS a behavior change we want the test to catch.
export function drainAndSort(rawEvents) {
  const out = [];
  for (const e of rawEvents) {
    const last = out[out.length - 1];
    if (e.kind === 'stateWrite' && last?.kind === 'stateWrite' && last.origin === e.origin) {
      const merged = new Set([...last.keys, ...e.keys]);
      last.keys = [...merged].sort();
    } else if (e.kind === 'stateWrite') {
      out.push({ ...e, keys: [...e.keys].sort() });
    } else {
      out.push(e);
    }
  }
  return out;
}
