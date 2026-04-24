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

## Move logCategories out of appState

Move logCategories out of appState so logger.js doesn't need to import state. Would collapse the store↔logger↔state cycle introduced in Step 5.

## Step 5.5 — close startup coverage gap

Characterization test for the startup sequence, driven by canned SysEx bytes instead of a live Orville. Asserts final appState.currentKey / appState.currentSubs / appState.presetKey and (if worth the effort) the rendered LCD text. jest.useFakeTimers() is needed for parser.js's 200ms setTimeout and the lodash.debounce wrapper.

Also ship a baseline-trace artifact under docs/refactor/traces/ capturing the [stateWrite] trace from a known-good startup (ideally both a cached-preset boot and a first-run boot). Future startup-timing changes can diff against it. Baseline will need to be recaptured after the autoload-race fix in Step 7; that's fine, intentional.

Driven by: post-Step-5 live-capture diagnostic where we had no pre-Step-5 trace to compare against and could only argue by mechanism about whether Step 5 changed startup ordering. A trace-level regression test closes that gap.

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

## (add more ideas here as they come up)