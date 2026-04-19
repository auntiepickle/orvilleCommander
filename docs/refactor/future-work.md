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

## (add more ideas here as they come up)