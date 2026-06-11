# Feature pass from the operating manual

A scan of the Orville operating manual (`logs/orville-manual.txt`) for control
surfaces the app does not yet expose, given how much of the unit we can already
drive over SysEx. Each item cites the manual and notes whether it is
**device-native** (the unit already does it; we surface/orchestrate it) or
**app-layer** (new capability we build on top of the tree + MIDI).

The unifying observation: almost every "feature" in the manual is just another
addressable object subtree — menu pages with `SET`/`NUM`/`TRG` children we
already render and edit. So most of this is UX orchestration, not new protocol.

---

## Flagship: MIDI mapping to any parameter (#143-adjacent) — device-native

**Manual:** "Remote Controlling Parameters" (p.83), "External Modulation and
Trigger Menu Pages" (p.70-78), "Automatically Selecting a MIDI External
Controller" / Capture MIDI (p.76).

The unit already maps any MIDI source to any parameter. Holding **SELECT** on a
highlighted parameter brings up its **external-modulation page**, whose children
are ordinary objects we can already render and edit:

- `mode` (SET): the controller — `off`, `mod wheel`, `pitch wheel`, `breath`,
  `foot con`, `expression`, `general 1-4`, `MIDI single` / `MIDI double` (with a
  `con` controller-number param that appears), pedals/tip/ring, note, MIDI
  clock, etc.
- `channel` (SET): base + offset (or omni, set globally on SETUP/midi).
- `con` (NUM): controller number, for MIDI single/double.
- `scale` (NUM): maps the controller's range onto the parameter's range — the
  manual gives the exact equation `(max - min) / full-range = scale` (p.78).
- **Capture Midi** (TRG): the device's own "MIDI learn" — arm it, move a
  controller, and the unit fills in mode/channel/con (p.76).

**What we build** (all primitives already exist — cursor keys, SELECT-hold via
`controls.js` `select-hold` mask, SET/NUM editing, TRG click):

1. A **"MIDI Map" affordance** on every editable parameter (a small badge/right-
   click): it moves the cursor onto that parameter, sends SELECT-hold, and opens
   the rendered modulation page as a focused card in our UI.
2. A **"Learn" button** that fires the on-screen Capture Midi TRG, then shows the
   captured controller — the modern one-click learn.
3. A **scale calculator** helper: the user types the desired min/max parameter
   range, we apply the manual's equation and write `scale` (no more trial and
   error — the manual literally walks through guessing 100% -> 10% -> 0.62%).
4. A **"Mappings" overview** panel: remote-controlled params are flagged on the
   device (blinking underline); we surface a list of every mapped parameter in
   the current preset with its source, and a one-click unmap (`mode: off`).
5. **MIDI Group** quick-setup (p.78a): a contiguous block of CCs (e.g. 70-77)
   auto-maps to whatever 8 params are on screen — one-screen setup for fader
   boxes. The group config is the last page of SETUP/midi; we expose it with a
   Capture for the first controller and the `sticky` toggle.

**Why device-native over a browser MIDI layer:** the unit's mapping is stored in
the preset and works standalone after the app disconnects; a browser-side
CC->VALUE_PUT bridge would only work while the tab is open and duplicates a
capability the hardware already has. (A browser bridge is still worth offering
as an *option* for controllers the unit can't natively use, or for mapping to
app-only actions — see "App-layer MIDI bridge" below.)

---

## High-value, app-layer

### Full unit backup & restore to a file — `Dumping Data` (p.95) [needs-probe]
The unit stores everything in **battery-backed RAM** (p.79) — a dead battery
loses every user program, bank, routing, and setup. The unit can dump programs,
banks, setups, and routing as SysEx (SETUP/dump area). A one-click **"Back up
this unit to a file"** (and restore) is arguably the single most valuable thing
a modern companion app can add: capture the dump stream, write `.syx`/`.json`,
restore by replaying it. Pairs naturally with the library sync (#142) we just
built — we already walk the whole unit.

### Snapshots / scenes — app-layer
Capture every current parameter value across both DSPs (we already hold the tree
+ values) as a named, timestamped **snapshot**, and restore it by replaying
VALUE_PUTs. Instant A/B of whole-unit states, mix recall, "save where I was
before I started tweaking." Persisted in `midiConfig` like the theme/library.

### Real level metering — #10 (already logged)
The LEVELS area + the front-panel meters (manual A, p.8) measure analog/digital
in, DSP A/B in/out, analog/digital out. Path is the bitmap-screen poll or the
`CON` monitors; drive the decorative meter ladders we already drew.

### Preset & bank management — builds on #142
Save / update / rename / delete programs; create / delete / reorder banks
(manual "PROGRAM LOAD, SAVE, DELETE", p.79). We can load (search) today; full
management makes the app a real librarian. The STR name editor and the program
TRGs already exist.

### Parameter automation record / playback — `Sequence out` (p.68, p.97)
With `sequence out` on, the unit emits a SysEx on **every** parameter change. We
can **record** a timestamped stream of changes (a mixdown automation pass) and
**play it back** by replaying the puts — browser-side, no sequencer needed.

---

## Medium / smaller

- **Routing storage & Setup storage** (p.16, p.40, p.92): save/load whole routing
  configs (PROGRAM-hold) and full setups (PROGRAM-hold-hold). Keys exist; it's a
  storage-area UI like the program loader.
- **Tap tempo / BPM entry** (Tempo page, already rendered): a tap button and
  direct BPM field; we already track the live Beat/Tempo (external-clock fix).
- **Foot-pedal calibration** (p.66): the pedals page (Calibrate TRG, heel/toe) —
  surface the calibration flow with a live position bar.
- **A/B copy & compare**: copy DSP A's program+params to B (or swap); compare a
  preset's edited vs. saved state.
- **Display brightness/contrast** (display page, p.59): trivial, rounds out SETUP.
- **App-layer MIDI bridge** (optional companion to the flagship): listen to
  WebMIDI input in the browser and translate CC/note to VALUE_PUTs or app
  actions (load preset, snapshot recall) — for mapping the unit to things it
  can't natively target, and for driving the *app* from a controller.

---

## Out of scope (note only)
- **Patch Editor** (p.83, separate Programmer's Manual): the modular
  signal-flow editor. Enormous surface; a separate initiative if ever.
- **Relay control**, **serial port**, **Orville-to-Orville control**: niche.

---

## Suggested order
1. **MIDI mapping** (flagship) — device-native, high impact, all primitives ready.
2. **Backup/restore to file** — protects against the battery-RAM failure mode.
3. **Snapshots/scenes** — cheap, high delight, pure app-layer.
4. **Real metering (#10)** — finishes the faceplate's promise.
5. Preset/bank management, automation record, storage areas — as appetite allows.
