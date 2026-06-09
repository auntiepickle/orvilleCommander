# Golden screen captures

Canonical 240x64 (1bpp, 1x) renders of real Orville LCD states, captured live
over MIDI from the physical unit on 2026-06-08 via `build_tools/hil-screenshot.cjs`.

Each `screen-<name>.png` here is the expected render of the raw `0x17` capture in
`tests/fixtures/screen-<name>.txt`, decoded by `build_tools/render-screen.js`
(which shares `computePixels` from `src/framebuffer.js`). They are the reference
set for the offline screenshot-regression net (issue G2): render the `.txt`
fixture and byte-compare the PNG against the golden here.

Device state at capture: DSP A running **Black Hole**, DSP B **MetallicChamber**,
device id 1, internal clock 48 kHz.

| Golden | Front-panel key | What it shows |
|---|---|---|
| `screen-parameter` | `parameter` | Home param page — "space parameters" (diff/time, size/decay, spread, glide) |
| `screen-setup`     | `setup`     | "Sample Rates" — source/rate, DIN lock states |
| `screen-program`   | `program`   | Bank/program browser — "50 Reverbs - Unusual (28)" / "12 Black Hole" |
| `screen-levels`    | `levels`    | "Machine A Levels" — OUT Wet/Dry, OUT Level dB |
| `screen-bypass`    | `bypass`    | "bypass options" — system / machine dsp bypass |

To regenerate a golden after an intentional decoder change:

    node build_tools/render-screen.js tests/fixtures/screen-<name>.txt tests/fixtures/golden/screen-<name>.png 1

To recapture from hardware (must be on the physical console, not RDP — see
issue-tracker.md B10g.4):

    node build_tools/hil-screenshot.cjs --press <key> --name screen-<name> --png logs/<name>.png
