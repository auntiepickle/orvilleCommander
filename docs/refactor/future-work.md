# Future work (not in the current refactor roadmap)

## Hardware-in-the-loop screenshot regression tests

The Orville's 0x17 SysEx command returns a bitmap of whatever is
currently on the LCD. This opens a real integration test loop:

1. Send a keypress (via the existing `sendKeypress` / button mask path)
2. Wait N ms for the device to settle
3. Request a screenshot (cmd 0x18) and capture the returned bitmap
4. Compare against a golden PNG

Captures every layer the unit tests can't reach: the full SysEx
round trip, actual device timing, the real parser on real bytes,
the renderer's bitmap pipeline end to end.

Prerequisites: characterization tests from roadmap step 1
extended; a checked-in set of golden PNGs per navigation state;
a CI machine with a real Orville on USB-MIDI (or a recorded-SysEx
replay harness for offline runs). The replay harness is probably
the first build — real hardware in CI is expensive and flaky.

Priority: after the refactor roadmap. The current architecture
makes this hard because the parser and renderer are coupled to
main.js; post-step-7 (events bus) it becomes straightforward —
a test subscribes to the same bitmap events the renderer does.

Noted during step 2 by auntiepickle.

Magic protocol constants. Two related issues:
SysEx command bytes. 0x01, 0x17, 0x18, 0x2d, 0x2e, 0x31, 0x32 appear inline as magic numbers across midi.js, main.js, controls.js, parser.js. Closed set defined by the Orville protocol. Extract to named constants — candidate home: a src/sysex-commands.js module, or alongside keypressMasks as a shared protocol-constants file. Reference system_commands.txt as the canonical source.
Hardcoded parameter keys. Specific parameter keys appear as magic strings at call sites: '8060001' (t_rate, in the sync test loop), '10020011' (in tests), '1002001c' and '401000b' (in JSDoc examples). Parameter keys are normally discovered dynamically from OBJECTINFO dumps, so only the handful hardcoded for application logic need constants. Extract these specific ones and name them for what they are (e.g. T_RATE_KEY, PRESET_LOAD_TRIGGER_KEY).
Both are low-risk, mechanical, and deliberately off the 8-step roadmap. Do as standalone refactors between steps.

## Move logCategories out of appState (resolved in C6)

Move logCategories out of appState so logger.js doesn't need to import state. Would collapse the store↔logger↔state cycle introduced in Step 5.

Resolved in C6 (branch `refactor/logcategories-off-appstate`): logLevel + logCategories now live in logger.js as private module state, defaulting from `constants.DEFAULT_LOG_CATEGORIES`. logger.js no longer imports state.js, so the store → logger → state → store cycle is collapsed. See the issue-tracker C6 entry.

## Step 5.5 — close startup coverage gap (complete)

Characterization test landed at `tests/startup.test.js`, driven by canned SysEx fixtures captured via `npm run capture:fixtures` against a live Orville. Pinned observable state writes, MIDI outbound calls, render/bitmap calls, and terminal appState for the cached-config startup flow. Tier A (62 events under the current fixture set) and Tier B (terminal appState subset) both green on first run. Full design, rationale, and oddity-reporting protocol in `docs/refactor/review-notes.md` under the Step 5.5 section.

Outstanding follow-ups deferred from Step 5.5 scope:

- Fan-out response fixtures (childSubs population) not captured. Test's Tier B pins `childSubs === {}` at terminal state as a consequence. Expand fixture capture if a specific Step 7 regression demands childSubs coverage.
- Standalone baseline-trace artifact under `docs/refactor/traces/` not shipped. The test now serves the regression-net function, but a checked-in trace artifact remains useful for manual diffs during Step 7 development. Low priority.

## Audit-tool cache-overwrite bug (two gates)

Two independent mechanisms silence new audit traces for users with pre-existing cached config:

1. **Category gate.** config.js's loadConfig replaces appState.logCategories with the cached object from localStorage.midiConfig at boot, so any new category added to store.js defaults is silently absent for existing users. logger.js gates on `!appState.logCategories[category]`, and undefined keys are treated as off.
2. **Level gate.** The cached logLevel (typically `'info'` for most users) overrides the store default, so any trace emitted at `'debug'` is suppressed regardless of whether the category is enabled.

Fix candidates:
- config.js should merge cached config over defaults rather than replacing subtrees. This collapses the category gate for all future additions without requiring migration hooks.
- The level gate is by design — traces emitted at `'debug'` are meant to be opt-in. But it interacts badly with the category gate: a step that adds a debug trace AND a new category defaulting false needs users to flip two things. Consider documenting the emit-level choice (`'info'` for audit aids that should be visible whenever the category is on; `'debug'` only when the category is already a known-verbose firehose).
- Check for the same replace-don't-merge pattern on other cached subtrees in localStorage.midiConfig, not just logCategories.

Surfaced during the Step 5 diagnostic — burned two capture cycles before the trace survived both gates. Out of scope for Step 5 itself.

## Bitmap renderer: top-left-corner black-pixel artifact

Rendered bitmaps show black pixels in the top-left corner that are not present in the source SysEx data. Symptom observed during Step 6 smoke testing against both a real 0x17 screen capture (via Process Debug File) and a live 0x18 Get Screen round-trip — same artifact in both paths.

Likely origin: the `SHIFT_FIRST_COLUMN` post-processing block in `renderBitmap` (now in `bitmap.js`). The block performs a non-wrapping shift that zeroes the top `shiftAmount` pixels of the first 8 columns regardless of source content. If the goal is to correct a 1px vertical offset in the Orville framebuffer output, the zeroing should probably wrap pixels from the bottom or preserve source data at the top.

Pre-existing behavior — not caused by Step 6, preserved verbatim by the extraction. No owner, no priority assigned.

## Bitmap.js residual cleanup

Three deferred items from the Step 6 cleanup commit (see review-notes.md `## Step 6 cleanup commit (post-Step 5.5)`).

**Indentation normalization.** bitmap.js is internally inconsistent: `extractNibbles` and `renderBitmap` are 4-space, `exportBMP` is 2-space, and `denibble` (lines 27-35) has a 2/6/10-space pattern (function body 2-space, for-body 6-space, if-body 10-space). Verified genuine via `cat -A` — not a tab artifact. Best handled in a project-wide formatter pass rather than per-file, since the project lacks a prettier config and other files (e.g. parser.js) likely have their own inherited inconsistencies. Don't normalize bitmap.js alone in a behavior-preserving commit; that imposes a convention without project-wide buy-in.

**`extractNibbles` is a fully-dead exported function.** src/bitmap.js:16. Zero callers across src/, tests/, build_tools/, and HTML. No dynamic references (eval, import(), property access). Delete-or-leave decision deferred. Recommend bundling into a Step 8 prune pass alongside other dead-export audits across the codebase, to keep blame contiguous and avoid one-off "delete this function" commits.

**`SAVE_MONO_BMP` flag and gated `exportBMP` call.** src/bitmap.js:7 hardcodes `SAVE_MONO_BMP = false`, gating the only call to `exportBMP` (line 94, now module-internal post-Step-6-cleanup). Reads more like a feature-flag-held-off (a developer-only escape hatch for dumping mono BMPs during bitmap-rendering debugging) than dead code in the same sense as truly orphaned functions. Needs intentionality check before pruning:

- If intentional: add a comment marking it as a dev-only debug hatch, leave the flag and call path in place.
- If unintentional / forgotten: remove the flag, the gated call at line 94, and `exportBMP` outright as a single coherent commit.

Either resolution is fine; just don't half-prune (e.g. removing the flag while keeping the function, or vice versa).

## Root OBJECTINFO_DUMP contains type=8 sub entries

Observed during Step 5.5 capture: the root dump contains a sub at position 3 with `type=8`, `key=10040000`, empty statement and empty tag. Filtered out of the renderer autoload correctly by the `type === 'COL'` check at `renderer.js:737`, and lands in `currentSubs` via `parseSubObject` (which accepts any type). The `8` type is undocumented; `system_commands.txt` does not enumerate non-letter type tokens.

Low priority. Investigate if any Step 7+ refactor touches `parseSubObject`'s type dispatch or the autoload filter — the type=8 entry's behavior is pinned by the Step 5.5 test's Tier B `currentSubs[0].key` assertion only insofar as it affects the subs array length.

## Preset name quoting inconsistency in OBJECTINFO_DUMP responses

Observed during Step 5.5 capture: DSP A preset name is quoted in the OBJECTINFO_DUMP response (`'Black Hole'`), DSP B preset name is not (`MetallicChamber`). `splitLine` in `parser.js` handles both because unquoted single tokens are parsed as one word, but a multi-word unquoted preset name would break — `splitLine` would parse it as two separate tokens and parseSubObject would pick up only the first word as `statement`.

Pre-existing parser quirk, currently unobservable under realistic device state (Orville's own preset editor always quotes multi-word names when saving). Flag if it ever causes a test or production parse failure.

## Step 7 architecture targets

Architectural opinions consolidated during Step 5.5's development. Each item is a symptom of missing primitives that Step 7's events-bus rewrite should address. The Step 5.5 characterization test at `tests/startup.test.js` is effectively a machine-readable inventory of these patches; diffs against its pinned Tier A sequence during Step 7 are a map of what the cleanup changed.

- **parser.js:78-87 debounce + setTimeout wrappers are patches for missing "dump complete" semantics.** The 200ms `setTimeout` plus the `lodash.debounce(..., 200)` wrapper together approximate "the device finished sending a dump" by waiting for silence. Step 7 should replace with explicit `dumpComplete(key, data)` events that the renderer subscribes to, eliminating both timer layers. The characterization test will fail loudly on this change — update the Tier A expected array in the same commit to reflect the new event shape.

- **`isLoadingPreset` boolean is a patch for "when is it safe to render" semantics.** Guards `hideLoading()` calls and a secondary render path in parser.js's background-root-dump branch. Deletable once events-bus exposes dump-complete events natively. `tests/startup.test.js` pins `isLoadingPreset === false` at terminal state; update that assertion when the flag is removed.

- **`autoLoad` flag + main.js:142-154 500ms setTimeout pattern is the landing-page race's mechanism.** Step 7 should replace with "autoload is an explicit subscriber to `rootDumpComplete && cachedPresetKey` condition." This deliberately changes the landing-page destination from `10010000` (setup, the current race outcome) to the cached preset (`401000b` = DSP A preset, the user's actual expectation). `tests/startup.test.js`'s Tier A sequence AND Tier B terminal state both change substantially; update in the same commit as the fix.

- **keyStack mixed-types is a type-smell.** Index 0 is a raw string (pushed by `main.js:143`); index 1+ is a `{key, tag, subs}` object (pushed by the renderer autoload at `renderer.js:742`). Normalize to always-objects, or deliberately split into two separate data structures for different navigation contexts. The characterization test pins the current mixed shape at Tier B (`keyStack[0]` is string, `keyStack[1]` is object); update those assertions when normalization lands.

- **Audit-tool two-gate silencer (config.js cache overwrite + cached 'info' logLevel) is contributor UX debt.** Currently hides the `[stateWrite]` debug output that a developer debugging startup actually wants to see. The startup test mocks logger ungated to sidestep this; real-app debugging still requires manually editing `localStorage.midiConfig`. Low priority but track as UX debt alongside the structural debt above.

- **The Step 5.5 characterization test itself is a map of current timing-workaround patches.** Every Tier A entry mentioning `autoLoad`, `hideLoading`, post-autoload fan-out, or the 200ms render latency is a symptom of debounce-based rendering. Step 7's cleanup reshapes the sequence substantially; treat Tier A divergences during Step 7 as *expected and informative*, not as regressions. Read the diff against `tests/startup.test.js`'s pinned sequence as the inventory of what got cleaned up, not as a failure log.

- **Expanded timing-patch inventory in `docs/refactor/session-knowledge-dump.md` question 5.** Beyond the two patches already listed above, additional `setTimeout(200)` instances exist at `parser.js:121` (favorites re-fetch) and `parser.js:158` (VALUE_DUMP render gate), plus the 200/300/500ms chains on the renderer side verified by `renderer.test.js`. Step 7's "eliminate timing patches" scope should cover all of these, not just the startup-flow ones pinned by the characterization test.

## Orville preset taxonomy cache

Updated 2026-05-13 (not resolved): scope and source understanding revised; cache itself deferred until after the refactor.

Surfaced during 7c.0 fixture capture. The commit's brief named "Auto Tape Flanger" without specifying its bank, but Orville presets are organized into ~70 banks (Auto Tape Flanger lives in "Delays - Modulated", bankIndex 8). The bank/preset taxonomy is firmware-defined and effectively immutable per device, but is not currently cached anywhere in the repo — every preset lookup either requires consulting an external reference or traversing the device's program-bank menu via OBJECTINFO_DUMP fan-out.

Authoritative source is the device's own OBJECTINFO_DUMP fan-out across all program-bank menus, captured at connect time and held in-memory by the running app. A previously-considered off-repo hand-curated JSON (an Ableton program-change control map) has known issues and one-off indices baked in for its PC-message use case; caching it would bake in those issues and overclaim what the file represents. The cache, if built, should be derived programmatically from a captured device dump rather than hand-curated.

The right time to build the cache is after the refactor, when Step 7's events.js and dumpComplete subscriber model provide the substrate a capture-derived cache would lean on. Before that, no commit is blocked by the cache's absence; preset lookups today rely on external reference or live device traversal.

Out of scope for the current refactor — doesn't block any of Steps 7-8. Useful for any future fixture-capture or harness work that needs to name a preset by bank.

## (add more ideas here as they come up)