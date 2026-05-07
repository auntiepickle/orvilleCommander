# Refactor review notes

Observations and decisions captured during review of each roadmap step. Terse — the "why" that doesn't fit in a commit body.

## Cross-cutting findings

- **Cached-config overrides make new state fields invisible to existing users.** Any new field added to the `appState` defaults in `store.js` is silently overridden at boot by `config.js`'s `loadConfig`, which replaces cached-object subtrees (e.g. `logCategories`, `logLevel`) wholesale from `localStorage.midiConfig` rather than merging. Result: the field lives on fresh installs only — a user who ran the app before the field was added will never see it until they clear or hand-edit their cache. This is a landmine for Steps 6/7/8: every step that touches store.js defaults needs either (a) config.js migrated to merge instead of replace (logged in future-work.md), or (b) an explicit rollout note telling existing users to clear localStorage. Surfaced twice during Step 5 (stateWrite category absent from cached logCategories; trace silenced by cached logLevel=info even if the category had been present).

## Step 5 — parser.js setState migration

- Batching rejected in favor of 1:1 to preserve reversibility before any subscribers exist
- Option A (import log in store.js) chosen over B to avoid two log sinks; new load-tolerated cycle store→logger→state→store accepted
- origin param on setState is optional with no default — missing origin logs as undefined, intentional signal that a caller forgot to tag
- stateWrite logCategory defaults to false; enable locally during audit work
- Tripwire docstring in store.js documents Object.assign identity-preservation; parser reads at 193/196/272/311 (deviceId), 235/246/304 (lastAscii), 235/242/246/287/288/295/299 (currentSubs), 250/305 (isLoadingPreset) rely on it
- setState builds trace string unconditionally before logger gates on category; cheap today, wrap in `if (appState.logCategories.stateWrite)` if it ever shows up in a profile
- Hunk-count from Claude Code does not match plan's table row count; invariant is "no multi-key coalescing into one setState call," verified per-hunk
- logCategories on appState is what creates the store↔logger↔state cycle; moving it off would collapse the cycle (entry in future-work.md)

### Post-commit diagnostic: startup landing-page regression (setup vs Black Hole)

- Symptom: post-Step-5 fresh-boot LCD lands on the setup menu; user recalls pre-Step-5 landing on Black Hole (the cached presetKey).
- Ran a live capture with stateWrite trace enabled (localStorage.midiConfig hand-edited to add stateWrite: true; store.js trace level bumped from debug to info for the capture; both reverted after). Trace showed:
  - Root dump at t+0 writes dspA/BKey, dspA/BName, then lastAscii + currentSubs (the root-dump `main.key === appState.currentKey` branch fires because both are '0' at boot).
  - renderer.js autoload fires at ~t+510 and flips currentKey to '10010000' via a direct write (not parser.js, so no trace line).
  - 401000b dump arrives at ~t+763 — 253ms after autoload already claimed currentKey. parser.js:212 gate (`main.key === appState.currentKey`) now fails, so presetKey is NOT updated, lastAscii/currentSubs are NOT updated, and the 401000b data lands only in menusA/dspAName. It becomes an orphaned fetch.
  - Setup menu's own follow-up dump arrives at t+3228 and populates the visible screen.
- Diagnosis: pre-existing race in the renderer-autoload vs. preset-fetch ordering. Step 5 exposed but did not cause it — the gate line (parser.js:212) is textually unchanged, currentKey is written by renderer.js (untouched by Step 5), and Step 5's per-call overhead is sub-millisecond against a 253ms device round trip.
- No fix in Step 5. Fix belongs post-Step-6 or folded into Step 7's event-bus rewiring, where the parse → render → navigation handoff is being reshaped anyway.

### Audit-tool bug exposed during the diagnostic

- Two independent silencers for new audit traces on existing users, either one alone enough:
  - **Level gate.** logger.js:9 checks `levels[appState.logLevel] < levels[level]`. Cached `logLevel=info` plus a trace emitted at `'debug'` drops the line before the category check even runs.
  - **Category gate.** logger.js:9 also checks `!appState.logCategories[category]`. Cached `logCategories` from localStorage lacks any field added after the cache was first written; `undefined` is treated as off.
- Burned two capture cycles during the Step 5 post-mortem: first run at `'debug'` with default category yielded an empty trace (level gate won); second run required both a source change (trace level → `'info'`) AND a manual localStorage edit to inject `stateWrite: true` into the cached `logCategories`.
- Each future step that adds a new audit trace needs to think through both gates.
- Not a Step 5 regression — both gates predate Step 5. Fix out of scope here; logged in future-work.md.

## Step 6 — bitmap.js extraction

- Cycle accounting: closes the parser.js ↔ main.js cycle (cycle #3 in 01-dependency-graph.md) that existed solely for bitmap helpers — after the move, main.js no longer imports anything from parser.js. The parser.js → main.js edge for `hideLoading` remains but is one-way and doesn't form a cycle. Cycle count: 6 → 5.
- Dead imports in main.js preserved, not cleaned up. `extractNibbles` has no caller anywhere in the repo; `exportBMP` is called only from inside `renderBitmap` under `SAVE_MONO_BMP` (hardcoded false). Both are still imported by main.js at the new `./bitmap.js` path and remain unused at any call site. Strict move-fidelity kept the import line symmetric; deletion deferred to a standalone cleanup commit or folded into Step 8 (which will churn the main.js import block anyway).
- Constants ordering: `NO_FLIP` / `ROTATE_COLUMNS` / `SHIFT_FIRST_COLUMN` / `SAVE_MONO_BMP` moved from tail-of-file in parser.js to top-of-file in bitmap.js. Pure ordering change, no behavior delta — they were only referenced inside called functions, so hoist-vs-tail was irrelevant at runtime. Flagged so a future bisect doesn't misread the const position as a semantic edit.
- Unused local `let row = 0;` inside `exportBMP`'s outer y-loop (bitmap.js:125). Declared, never read or written. Pre-existing dead code in parser.js, preserved verbatim. Candidate for the same standalone cleanup commit as the dead imports above.
- Indentation inside the moved block is inconsistent. Verified via `cat -A`: `denibble` is 2-space outer with +4-space-jump nesting (function body 2-space, for-body 6-space, if-body 10-space — internally inconsistent, not cleanly 2-space); `extractNibbles` is 4-space; `renderBitmap` is 4-space; `exportBMP` is 2-space. Preserved verbatim from parser.js. A prettier/format pass is explicitly out of Step 6 scope; deferred to future-work.md.
- Renderer bug observed during smoke but not caused by Step 6: top-left corner of rendered bitmap shows black pixels not present in the source data. Consistent with the `SHIFT_FIRST_COLUMN` non-wrapping shift in `renderBitmap` that zeroes the top `shiftAmount` pixels of the first 8 columns. Pre-existing behavior preserved by the move. Tracked separately in future-work.md.

## Follow-up: smoke capture promoted to tests/fixtures/

Step 6's live-smoke SysEx capture was promoted into the first project fixture at `tests/fixtures/screen-dump-black-hole.txt` — captured via MIDI-OX as the `0x17` screen bitmap response to a `0x18` Get Screen Request (Orville at device ID 1), saved as space-separated ASCII hex in the format `Process Debug File` expects.

Establishes `tests/fixtures/` as the home for canned SysEx inputs that future characterization tests (roadmap Step 5.5) will consume; `MIDI_Captures/` is now gitignored so raw captures stay out of git until explicitly promoted.

## Step 5.5 — startup characterization test

- Test at `tests/startup.test.js`; fixtures under `tests/fixtures/` are captured OBJECTINFO_DUMP (0x32) responses for keys `'0'`, `'401000b'`, `'801000b'`, `'10010000'`; VALUE_DUMP (0x2e) responses for `'0'` and `'401000b'` (captured for reference, not fed into the test flow); the existing `screen-dump-black-hole.txt` for the 0x17 path. Fixtures captured against the U6MIDI Pro interface with DSP A on `'Black Hole'` (quoted statement in the dump) and DSP B on `MetallicChamber` (unquoted).
- Seam: main.js is never imported. Harness `simulateSelectPorts()` in the test reproduces the inline `selectPorts()` body. Mocks: `midi.js` (capture sends), `main.js` (hideLoading/showLoading), `controls.js` (keypressMasks stub), `logger.js` (ungated capture), `bitmap.renderBitmap` (via partial mock with `denibble` real), `renderer.renderScreen` (via partial mock wrapping a real-call-through with an autoLoad/currentKey snapshot for the landing-page invariant). Real: `store.js`, `state.js`, `parser.js`, `renderer.updateScreen`/`toggleDspKey`, `bitmap.denibble`.
- Assertions tiered: (A) full ordered event log, coalesced, normalized to short strings and compared as a single array; log events filtered to a whitelist of load-bearing substrings (`Detected device ID`, `Parsed OBJECTINFO_DUMP`, `Auto-loading first menu`, `Denibbled screen data`). (B) terminal appState subset. Plus one direct assertion: first `renderScreen` call sees `autoLoad=true` (the landing-page race precondition).
- Step ordering swap vs the original plan's Q2: the inline `main.js:142-154` block runs BEFORE the 500ms timer advance, so that when root's `setTimeout(200)` fires, `appState.autoLoad` is already true and the renderer autoload fires on root's render (flipping `currentKey` to the first short-tag COL). Without the swap, fake-timer sequencing would fire the root render with `autoLoad=false` and the autoload would fire on 401000b instead — producing a final `currentKey` of `'4040001'` (Black Hole's first short-tag child) rather than `'10010000'` (root's first short-tag child). The swap reproduces the live diagnostic's landing-on-setup behavior under fake timers.
- Fixture-vs-device-state coupling: Option B chosen. Device-state-dependent assertions (dspAName, dspBName, menusA.length, menusB.length, terminal currentKey, fan-out keys, currentSubs[0].key) derive from the captured fixtures via `extractExpectedFromRoot`/`extractExpectedFromPreset` in `tests/helpers/sysex-fixture.js`. Flow-dependent assertions (presetKey='401000b', autoLoad=false, isLoadingPreset=false, keyStack mixed-types shape, childSubs={}) stay hardcoded. Fixtures remain freely regenerable via `npm run capture:fixtures`; the test stays valid across device-state changes as long as the mechanics (autoload picks the first short-tag COL, gate failures silently drop dumps, etc.) don't change.
- Known bugs pinned, not fixed: autoload-vs-401000b landing-page race; keyStack mixed types (main.js:143 pushes a string, renderer autoload pushes `{key, tag, subs}`); type=8 sub at position 3 of the root dump (key `10040000`, empty tag) lands in `currentSubs` via `parseSubObject` but is filtered out of autoload by the `type === 'COL'` check. All three remain in `future-work.md`, now with this test as their guardrail.
- Out of scope: SHIFT_FIRST_COLUMN pixel artifact (bitmap mocked at renderBitmap boundary); fan-out response fixtures (childSubs stays `{}` at test end); audit-tool cache-overwrite bug (test uses fresh default logCategories).
- Logger mock is deliberately ungated — captures every `log()` call regardless of `appState.logLevel` / `logCategories`. This lets Tier A assert on `[stateWrite]` traces that the real app silences under the default `logCategories.stateWrite: false`. Not a behavior divergence; a test-instrumentation choice to avoid mutating config in the simulation.
- Coalescing rule for Tier A stateWrite events: consecutive same-origin stateWrites collapse into one bucket with a sorted key-set. Bucket boundaries are event-stream-scoped — any intervening non-stateWrite event (midiSend, log, renderScreen, bitmap, hideLoading) terminates the bucket. The per-parseResponse grouping seen in the expected Tier A array is emergent from those intervening events, not a parseResponse-aware check in the recorder. Rationale: Step 7 should be free to collapse adjacent `setState({a:x}); setState({b:y})` into `setState({a:x, b:y})` without false-positive failures. Sufficient as-is for 7a.3+: when renderer/main/controls origins begin going through `setState`, the same-origin termination surfaces each non-parser origin as its own Tier A entry — no rule extension required.

### Capture workflow — standing instruction

- Capture automation established at `build_tools/capture-fixtures.cjs` (`npm run capture:fixtures`). `@julusian/midi` is the devDep; `--port-in` and `--port-out` flags default to the U6MIDI Pro's enumerated names (`MIDIIN3 (U6MIDI Pro)` / `MIDIOUT2 (U6MIDI Pro)`). The split flags handle interfaces whose input and output ports enumerate under different names — a single `--port` substring could not disambiguate the U6MIDI Pro's four ports.
- Replaces the MIDI-OX GUI path for all future fixture work. Any future step that needs Orville-hardware-sourced fixtures goes through a script like this one, not a GUI workflow. If the capture script can't handle a scenario, Claude surfaces the concrete reason and proposes a script change — manual capture is not the fallback.
- Commit 1 of Step 5.5 was amended post-initial-commit to add the `--port-in`/`--port-out` split (original SHA `c724f74` → amended `1b2da74`). Original commit used a single `--port Orville` default that failed against the U6MIDI Pro interface.

### Oddity-reporting standing instruction

When the startup test surfaces something unexpected during later refactor work — either a failure whose cause isn't obvious, or a passing test alongside suspect behavior elsewhere — the report back to the human must include, in order:

1. **Plain-language description of the oddity.** What specifically is unexpected. Not a paste of Jest's raw diff; a sentence or two stating the observed behavior.
2. **Best hypothesis about what changed and why.** Given the current session's diff and any context from memory or prior commits, what's the most likely proximate cause. If multiple hypotheses are plausible, list them ranked.
3. **Concrete verification steps on the Orville hardware.** Specific UI actions, expected screen content, observable device responses. The human should be able to follow the steps without reinterpreting the test output.
4. **Classification.** One of: (a) pre-existing bug newly exposed by the refactor; (b) regression introduced by the current change; (c) expected behavior shift requiring updated test expectations.

Do not dump Jest failure output and ask for interpretation. The test surfaces signal; initial triage happens before escalation.

### Implementation notes

- Fan-out response fixtures (childSubs population) deliberately not captured. Test's Tier B pins `childSubs === {}` as a consequence; if Step 7 regression ever requires childSubs coverage, expand the fixture set and the simulation's step list.
- Tier A normalized format is lossy by design. Full event objects are available via `getEvents()` in `tests/helpers/startup-recorder.js` if a failure needs deeper inspection than the normalized diff shows.
- `tests/helpers/sysex-fixture.js` duplicates `splitLine` from `parser.js` (same duplication pattern as `build_tools/capture-fixtures.cjs`). Both places would update if the ASCII sub-object format ever changed — low risk, external device contract.
- Setup menu's short-tag COL children include two 4-prefixed keys (`40090000` tempo, `40090100` timer — DSP A scope) in addition to setup-scope keys; surfaced by the Tier A fan-out assertion. Pre-existing, expected (setup menu legitimately references DSP A config), mentioned here as reader context for anyone puzzled by the key mixture.
- Commit body formatting reminder: when composing commit messages via heredoc, preserve blank lines between the subject and body and between body paragraphs. Earlier commit 1 work had the appearance of collapsed blanks in a diff-viewer tool output but the actual `%B` output retained them — display artifact, not content bug. Worth knowing when reviewing commit bodies via secondary tooling.

## Step 6 cleanup commit (post-Step 5.5)

One commit on refactor_main beyond the prior tip (9f3b2a7). Three mechanical changes from deferred Step 6 work:

- src/main.js: removed `extractNibbles` and `exportBMP` from the `./bitmap.js` import. Both names had zero callers in main.js. `extractNibbles` has zero callers anywhere in the repo; `exportBMP` is called only from inside `renderBitmap` (same file) via the `SAVE_MONO_BMP` gated branch.
- src/bitmap.js:97: dropped the `export` keyword on `exportBMP`. Same-file caller still resolves; module-internal visibility now matches the actual call graph.
- src/bitmap.js:125: removed unused `let row = 0;` local at the top of `exportBMP`'s outer y-loop. Declared, never read or written. No closure capture (synchronous nested-loop body, no callbacks).

Closes deferred items previously flagged at the `## Step 6 — bitmap.js extraction` section above (dead main.js imports; unused `let row = 0;`).

16/16 tests passing across 3 suites with zero expected-value updates. This validated that the Step 5.5 startup test holds under "refactor that shouldn't change behavior" — Tier A (event log) and Tier B (terminal appState subset) both unchanged, which is the signal we wanted from a no-behavior-change cleanup.

Indentation normalization, `extractNibbles` delete-vs-leave, and the `SAVE_MONO_BMP=false` dead branch were deliberately deferred. See future-work.md `## Bitmap.js residual cleanup`.

## Audit trail coverage gap (post-Step-5 finding)

Step 5's `setState(partial, origin)` was introduced to establish an audit tripwire for state mutations — the `[stateWrite]` trace category records every call's origin and key-set. In practice, only `parser.js`'s OBJECTINFO branch honors this path. Every other direct `appState.x = y` write (and `keyStack.push`/`pop` mutation) across the codebase bypasses the audit. Concrete inventory across the five source modules, against `refactor_main` tip `d2693f4`:

- **parser.js — 3 unmigrated direct writes.** `:99` writes `childSubs[main.key] = subs` in the isChild branch; `:120` writes `currentValues[programSub.key]` as the favorites-fix optimistic write; `:132` writes `currentValues[key]` in the VALUE_DUMP branch. All three are pending migration in 7a.3.
- **renderer.js — 32 sites, split into handler-path (26) and render-path (6).** Handler-path: `updateScreen` clears `childSubs`/`currentValues`/conditional `currentSoftkeys` at `:19`/`:20`/`:22`; `handleLcdClick` writes 19 fields across its four branches — dsp-clickable at `:49-58`, softkey-sibling at `:66-69`, softkey-new at `:77-81` (with `keyStack.push` at `:53` and `:77`), and back-link at `:85-88` (with `keyStack.pop` at `:85`); `handleSelectChange` writes `currentValues` and `isLoadingPreset` at `:107` and `:126`; `handleParamClick` writes `currentValues` and `isLoadingPreset` at `:167` and `:183`. Render-path: `renderScreen` re-pins `currentSubs = subs` at `:266` on every render call (including debounced re-renders), conditionally re-pins `currentSoftkeys` at `:529`, and the autoload tail mutates `autoLoad`/`keyStack`/`currentKey` at `:736`/`:742`/`:743`/`:747`. The render-path sites fire as a side effect of rendering rather than in response to user input, which is why the prior version of this section missed them.
- **main.js — 13 sites across six clusters.** `toggleMeterPollingBtn` toggles `pollingEnabled` at `:76`; the `selectPorts` 500ms startup race writes `keyStack`/`currentKey`/`autoLoad` at `:143`-`:145`; `saveConfigBtn` writes `logLevel` at `:163`; `syncBtn` resets `currentKey` to `'0'` at `:197`; `testTRateBtn` dev-only writes `currentKey` at `:264` and `:269`; module-init at boot writes `logLevel`/`logCategories`/`fetchBitmap`/`updateBitmapOnChange`/`presetKey` at `:315`-`:319`. The `:316` line in module-init is the cached-config-replace landmine — `appState.logCategories = cachedConfig?.logCategories || ...` wholesale-replaces the defaults with whatever was in `localStorage.midiConfig`, which is the mechanism behind the cross-cutting "new state field invisible to existing users" finding at the top of this file. Foreshadows the merge-don't-replace work targeted by 7e2.
- **controls.js — 4 sites, all inside the keypress-settle 200ms `setTimeout` body in `setupKeypressControls`.** `:127` toggles `presetKey` via `toggleDspKey` for the 'ab' (DSP-toggle) button; `:131`-`:133` writes `keyStack`/`currentKey`/`autoLoad` for the 'parameter' (return-to-preset) button. This module was entirely absent from the prior version of this section; including it is half the point of the present correction.
- **midi.js — 1 site.** `:24`'s `setMidiPorts` writes `appState.deviceId` directly when the user picks ports.

**Total: 53 direct writes across 5 modules.** (Counting `keyStack.push`/`pop` as state mutations alongside assignments, since they mutate observable state that downstream consumers read and the Step 5.5 test asserts on the resulting shape; six of the 53 are `push`/`pop` method calls if subtracted.)

**keyStack mixed-types symmetry.** `main.js:143` and `controls.js:131` are the two string-push sites — both push `appState.currentKey` as a raw string before navigating. The three object-push sites at `renderer.js:53`, `:77`, and `:742` push `{key, tag, subs}` objects. The Step 5.5 startup test pinned this mixed shape at Tier B (`keyStack[0]` string, `keyStack[1]` object); 7e1 unifies the type.

**Implication for Step 7.** The events-bus migration is the natural completion point for the audit. Every direct write in the inventory above is a candidate for migration to `setState(patch, origin)` as part of Step 7's rewiring — not just the writes inside parser.js. The Step 5.5 startup test's Tier A sequence catches parser-origin writes only; the other 50 sites remain invisible to the characterization test, which means Step 7 can remove or rewire them without the test objecting. Reviewers of Step 7 diffs should cross-check against the inventory above rather than relying on the test alone.

## 7c.0 — populated VALUE_DUMP fixture capture

One commit on `refactor_main` beyond the 7a.3 tip (`fe9e198`), at SHA `15f62a1`. Fixture-only — no `src/` changes.

- Target: `8060001` (t_rate, SET-type) accessible from current device state via the `testTRateBtn` harness path at `main.js:264-312` with Auto Tape Flanger loaded into DSP B.
- Captured fixture: `tests/fixtures/valuedump-8060001.txt`, 21 bytes. Payload after the `0x20` separator decodes as `"1b off "` — option index `0x1b` ("off") for t_rate.
- NUL-trailer asymmetry empirically observed: VALUE_DUMP responses end `... 20 F7` (no NUL), OBJECTINFO_DUMP responses end `... 20 00 F7` (NUL present, stripped by `parser.js:50` since 7a.2). Cross-ref: `session-knowledge-dump.md` §13. Implication for 7c proper: the dumpComplete request-counter mechanism does not need NUL handling for VALUE_DUMP fan-out.
- Capture-script change: option (b) chosen over option (a) — `--only <name>` flag added to `build_tools/capture-fixtures.cjs` plus a permanent FIXTURES entry. Fail-fasts with known-name listing if `--only` doesn't match. Existing fixtures untouched, so Tier B of the Step 5.5 startup test cannot drift from a recapture-induced device-state shift.
- Tests: 16/16 unchanged across parser, renderer, and startup suites. The new fixture is unreferenced by any test (`tests/startup.test.js:183-187` covers the four objectinfo fixtures and `screen-dump-black-hole.txt` only).
