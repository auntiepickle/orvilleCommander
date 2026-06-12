# MIDI Mapping (#146) — Implementation Plan

Device-native MIDI mapping: an app UI over the Orville's own modulation system,
so mappings live in the preset and keep working after the app disconnects.
Grounded in live hardware probing (June 2026; harnesses in `logs/probe-midi-146*.mjs`,
screenshots `logs/mod-before.png` / `logs/mod-after.png`).

## Architecture decision: device-native

The Orville already maps any MIDI source to any parameter, stored in the preset.
A browser-side `CC -> VALUE_PUT` bridge would only work while the tab is open and
would duplicate hardware capability. So the feature is a modern UI over the
native system, with an optional app-layer bridge later for app-only actions /
sources the unit can't use.

## Confirmed live (hardware)

- **Per-parameter modulation page.** Holding **SELECT** on a highlighted
  parameter opens its modulation page — screenshotted as `level setup` with:
  `mode` (source SET), `Capture Midi` (learn TRG), `range` (depth NUM),
  `type: absolute` (SET), the live parameter value, and a controller monitor
  bar. `select-hold` mask already exists in `controls.js`
  (`[0xff,0xff,0xfe,0xfe]`).
- **Global external controllers** (`10010100`): 8 `assign` slots + 2 `trig`
  slots, each fully OBJECTINFO-addressable with children `mode` / `channel` /
  two sub-params / `monitor` CON / `Capture Midi` TRG. Keys: assign 1 =
  `10010110` (mode `…111`, channel `…112`, sub `…113`, monitor `…114`,
  capture `…115`); assigns 2-8 at `…120/130/140/170/180/190/1a0`.
- **Capture-learn works over emulated MIDI.** Armed `Capture Midi` on assign 1,
  sent CC#7 -> the device captured it as `mode='1e volume'`, revealed a
  `channel: base+N` sub-param (17 options base+0..base+15), and the monitor
  tracked the live value (62.5% for value 0x50). The mode SET's 52 "options"
  are degenerate placeholders (all `off`, then all the captured name) — the
  source is set by **Capture**, not by picking from a list.
- **Inbound MIDI works.** CC#0=5 changed the bank to `5 Delays`; Program Change
  #2 loaded slot 2 into DSP A (`MonoDelay` -> `1x4 Delay`). This also delivers
  **#152** (Program-Change loads).
- **The app can emit raw CC / PC** from its output port — a "test this mapping"
  button and an app-driven learn sweep need no physical hardware.
- **MIDI configuration** (`10010010`): `global configure` (`1001001c`),
  `MIDI setup` (`1001001b`, channels/omni), `serial setup` (`10010070`),
  `MIDI group setup` (`10010076`).
- **Scale equation** (manual p.78): `(max - min) / full-range = scale` — replace
  the manual's trial-and-error with a calculator.

## The two-layer model (Phase 0 spike — RESOLVED)

The Orville's mapping is **two layers**, and the spike settled how each is
configured:

1. **Global assign controllers** (`10010100`) — the 8 reusable MIDI sources.
   **Fully OBJECTINFO-addressable**: I dumped and edited their objects, and the
   `Capture Midi` TRG (`…115`) learns a CC end-to-end over emulated MIDI. The
   app configures these **directly by object** (fire Capture + emit/await a CC,
   set channel via the `channel` SET).
2. **Per-parameter modulation page** (SELECT-hold) — picks which assign drives
   *this* parameter, plus `range` / `type`. **NOT cleanly object-addressable.**

Resolution evidence (`logs/probe-midi-146c/d/e.mjs`, `logs/mod-activated.png`):

- `OBJECTINFO` is **context-free**: `OBJECTINFO(4050001)` returns the plain
  `level` NUM before *and* after SELECT-hold — the page is not at the param key.
- Every guessed mirror key (the hidden `14030400` under the preset; `1`-prefixed
  and low-digit param keys) returns **type-8 EMPTY** — and the device returns
  type-8 for *any* unallocated key, so a scan yields **no discovery signal**.
- Activating a real mapping confirmed the model but populated **no** candidate
  key: `parameter -> SELECT-hold -> INC` cycled `level`'s `mode`
  `off -> assign 1 -> assign 2 -> assign 3`, and the level value moved
  `-9 dB -> 0 dB` (modulation live, driving the parameter) — yet every candidate
  stayed type-8. So the per-parameter page's key is not derivable/scannable.

**Consequence (runtime unaffected):** per-parameter assignment is written by
**driving the device UI** (position the cursor on the target param, SELECT-hold,
set `mode = assign N` + `range`/`type`, `*done*`). The app is a configurator
only; **at runtime the Orville does MIDI -> parameter entirely in its DSP — zero
app latency, works after the app disconnects.** This is the explicit goal: no app
middleman in the signal path.

**Needed primitive — a cursor-control layer** in `controls.js`: drive the device
highlight to a chosen parameter (the dump's `position` field gives in-menu
ordering), then SELECT-hold. This is the one genuinely new capability (the app
currently navigates by key, not by driving the physical cursor). Add the `-hold`
keys to `build_tools/hil-screenshot.cjs` as well.

## Build phases

0. **Cursor-control layer** in `controls.js`: drive the device highlight to a
   parameter by its menu `position`, then SELECT-hold to open its modulation
   page. The one new primitive everything else builds on.
1. **Global controllers panel** (the addressable layer first — highest value,
   lowest risk): a panel over the 8 assigns (`10010100`) showing each source +
   live monitor, with a one-click **Learn** (fire `Capture Midi` TRG + emit/await
   a CC) and clear. All object-addressable, proven end-to-end.
2. **Per-parameter mapping** (the keypress-driven layer): a "MIDI Map" badge on
   every editable NUM/SET that positions the cursor, SELECT-holds, and presents
   the modulation page. Since the page is not object-addressable, drive its
   fields by keypress (set `mode = assign N`, `range`, `type`) and mirror the
   captured screen bitmap (we already decode/render it) for confirmation.
   Read-back of the chosen assign closes the loop visually.
3. **Scale calculator** — user types desired min/max parameter range -> apply
   the manual's equation -> write `scale`.
4. **Mappings overview** — list every mapped parameter (`mode != off`), with
   quick clear/edit; optionally surface the 8 global assigns as a "controllers"
   panel.
5. **(bonus, nearly free) #152** — a Program-Change / CC sender, since inbound
   MIDI is proven.

## Testing

Every layer is emulatable without hardware: the app emits CC / Program-Change
from its output port, drives Capture, and reads back the captured mode/monitor.
`hil-screenshot.cjs` gives device-side visual regression (used to confirm the
modulation page). Unit tests mock the SysEx boundary like the rest of the suite.

## Risks

- **Cursor-drive correctness** — per-parameter config is keypress-driven, so the
  app must reliably land the device cursor on the intended parameter before
  SELECT-hold. Mitigated by the dump `position` field for ordering + a
  screen-capture read-back after each step to confirm the right page/field.
  Keypress sequences proved reliable in the `hil-screenshot` captures.
- **Source enumeration** — the `mode` SET options are degenerate placeholders;
  set the source via Capture (proven), not a 127-entry CC dropdown. The
  per-parameter `mode` enumerates the 8 assigns (off / assign 1-8) — a clean,
  short list.
- **Leaving the device modified** — driving config changes device state; the app
  must read-back and let the user confirm/undo, and never leave a half-written
  mapping.

## Out of scope

The modular **Patch Editor** (separate Programmer's Manual) — enormous surface,
a separate initiative if ever. Relay/serial/Orville-to-Orville control — niche.
