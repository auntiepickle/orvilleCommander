# Feature pass from the operating manual

A scan of the Orville operating manual (`logs/orville-manual.txt`) for control
surfaces the app does not yet expose, given how much of the unit we can already
drive over SysEx. Each item cites the manual and notes whether it is
**device-native** (the unit already does it; we surface/orchestrate it) or
**app-layer** (new capability we build on top of the tree + MIDI).

The unifying observation: almost every "feature" in the manual is just another
addressable object subtree — menu pages with `SET`/`NUM`/`TRG` children we
already render and edit. So most of this is UX orchestration, not new protocol.

> **Status (2026-06-12):** the flagship (MIDI mapping) and the two browse/load
> features below it are **shipped**; the rest is the open backlog, each item
> tagged with its tracking issue. This doc is the manual-grounded roadmap; the
> operational status lives in [`../issue-tracker.md`](../issue-tracker.md).

---

## Shipped

- **MIDI mapping to any parameter** — device-native (#146/#152, PR #157/#158).
  Map any MIDI source to any parameter, running in the DSP. Per-parameter card
  (source/range/type), one-click Learn over the device's Capture-Midi, the 8
  global assign controllers, a lit mapped-param badge (program-scoped, persisted),
  range shown in the parameter's own units, and generic tree-derived binding that
  reaches any parameter across a program's blocks/pages. As-built model in
  [`../device-model.md`](../device-model.md) §8b. Open edges: M1/M2/M3 below.
- **Synced preset library + name search** (#142/#144) — a full bank scan with
  name search, backing the load menu and browser.
- **Preset browser + program preview** (#153/#135, PR #156) — browse/search the
  library, preview a program on the idle DSP (remember-and-restore), load to A/B;
  live Favorites (bank 0 MRU) stays in sync.

---

## High-value, app-layer (open)

### Full unit backup & restore to a file — `Dumping Data` (p.95) — #147
The unit stores everything in **battery-backed RAM** (p.79) — a dead battery
loses every user program, bank, routing, and setup. The unit can dump programs,
banks, setups, and routing as SysEx (SETUP/dump area). A one-click **"Back up
this unit to a file"** (and restore) is arguably the single most valuable thing
a modern companion app can add: capture the dump stream, write `.syx`/`.json`,
restore by replaying it. Pairs naturally with the library sync (#142) we built —
we already walk the whole unit.

### Snapshots / scenes — app-layer — #148
Capture every current parameter value across both DSPs (we already hold the tree
+ values) as a named, timestamped **snapshot**, and restore it by replaying
VALUE_PUTs. Instant A/B of whole-unit states, mix recall, "save where I was
before I started tweaking." Persisted in `midiConfig` like the theme/library.
(Related: #9 "cache an effects settings".)

### Real level metering — #10
The LEVELS area + the front-panel meters (manual A, p.8) measure analog/digital
in, DSP A/B in/out, analog/digital out. Path is the bitmap-screen poll or the
`CON` monitors; drive the decorative meter ladders we already drew.

### Preset & bank management — builds on #142 — #149
Save / update / rename / delete programs; create / delete / reorder banks
(manual "PROGRAM LOAD, SAVE, DELETE", p.79). We can load (search) today; full
management makes the app a real librarian. The STR name editor and the program
TRGs already exist.

### Parameter automation record / playback — `Sequence out` (p.68, p.97) — #150
With `sequence out` on, the unit emits a SysEx (`0x3C`) on **every** parameter
change. We can **record** a timestamped stream of changes (a mixdown automation
pass) and **play it back** by replaying the puts — browser-side, no sequencer
needed. (Consuming `0x3C` live is the shared primitive — see M3 / #168.)

---

## Medium / smaller (open)

- **Routing storage & Setup storage** (p.16, p.40, p.92) — #160: save/load whole
  routing configs (PROGRAM-hold) and full setups (PROGRAM-hold-hold). Keys exist;
  it's a storage-area UI like the program loader.
- **Tap tempo / BPM entry** (Tempo page, already rendered) — #161: a tap button
  and direct BPM field; we already track the live Beat/Tempo (external-clock fix).
- **Foot-pedal calibration** (p.66) — #162: the pedals page (Calibrate TRG,
  heel/toe) — surface the calibration flow with a live position bar.
- **A/B copy & compare** — #163: copy DSP A's program+params to B (or swap);
  compare a preset's edited vs. saved state.
- **Display brightness/contrast** (display page, p.59) — #164: trivial, rounds
  out SETUP.
- **App-layer MIDI bridge** (optional companion to the flagship) — #165: listen
  to WebMIDI input in the browser and translate CC/note to VALUE_PUTs or app
  actions (load preset, snapshot recall) — for mapping the unit to things it
  can't natively target, and for driving the *app* from a controller.

---

## MIDI-mapping follow-ups (open)

- **M1 — programs with >4 blocks** — #166: `bindParam` selects blocks via
  `soft1..soft4` only, so a 5th+ block's params report a clean "not mappable yet".
  Needs the device's block-paging-beyond-soft4 navigation probed.
- **M2 — non-grid / 'a'-position block layouts** — #167: `bindParam` assumes a
  4-row × 2-col column-major grid; non-grid pages safe-abort via the title check.
  Generalize the coord derivation.
- **M3 — live value mirroring from `0x3C`** — #168: consume the sequence-out
  emits (#158 already keeps them from starving polling) to mirror live device-side
  changes into the UI. Overlaps #150.

---

## Out of scope (note only)
- **Patch Editor** (p.83, separate Programmer's Manual): the modular
  signal-flow editor. Enormous surface; a separate initiative if ever.
- **Relay control**, **serial port**, **Orville-to-Orville control**: niche.

---

## Suggested order
1. **Backup/restore to file** (#147) — protects against the battery-RAM failure
   mode; reuses the library walk.
2. **Snapshots/scenes** (#148) — cheap, high delight, pure app-layer.
3. **Real metering** (#10) — finishes the faceplate's promise.
4. Preset/bank management (#149), automation record (#150), storage areas (#160)
   — as appetite allows.
