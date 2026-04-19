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

## (add more ideas here as they come up)