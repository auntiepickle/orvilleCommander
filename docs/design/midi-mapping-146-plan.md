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

## The decisive open question (Phase 0 spike)

`OBJECTINFO` stays **context-free**: `OBJECTINFO(4050001)` returned the plain
`level` NUM both before and after SELECT-hold. The modulation page is therefore
**not** at the param key. Guessed mirror keys — the hidden type-8 node
`14030400` under the preset, and `1`-prefixed param keys (`14050001`, …) — all
returned **type-8 EMPTY placeholders** (`8 0 <key> … '' ''`). All params are
currently `mode: off`, so those slots may simply be empty until a mapping is
active.

**Spike to resolve (first implementation step):** activate a mapping on one
parameter (drive cursor onto it, SELECT-hold, fire `Capture Midi`, emit a CC),
then re-scan the candidate keys.

- If a `<param> setup` COL **materializes** at a discoverable key -> **render
  the page as ordinary objects** (the clean path; the rest of this plan).
- If nothing materializes -> the page is a **transient UI overlay**, and the
  feature becomes a **remote-control** model: drive the device cursor by
  keypress and mirror its screen bitmap (we already capture + render the
  bitmap). More limited, more fragile — fall back only if forced.

Either way the app needs a small **cursor-control layer** (cursor up/down/
left/right + the `-hold` keys) to drive SELECT-hold onto a chosen parameter,
since SELECT-hold is cursor-position dependent. (Add the `-hold` keys to
`build_tools/hil-screenshot.cjs` too — they were used for the screenshots and
are generally useful.)

## Build phases

0. **Addressing spike** (above) + the cursor-control layer in `controls.js`
   (drive the device highlight to a parameter by position; the dump's
   `position` field gives ordering).
1. **Modulation card** — a "MIDI Map" badge on every editable NUM/SET; clicking
   it positions the cursor, SELECT-holds, and opens the modulation page as a
   focused card (render-as-objects path) — `mode` / `channel` / `con` /
   `range` / `type` / live monitor, all existing renderers.
2. **One-click Learn** — a button that fires the on-screen `Capture Midi` TRG,
   then waits for the user's controller OR emits an app CC sweep, and shows the
   captured source. (Proven end-to-end on the global assigns.)
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

- **Page addressability** (the Phase 0 spike) — the whole "render-as-objects"
  shape depends on it; the remote-control fallback exists but is weaker.
- **Cursor-drive fragility** — SELECT-hold is position-dependent; mitigated by
  the dump `position` field + screen-capture verification.
- **Source enumeration** — the `mode` SET options are degenerate; set the source
  via Capture (proven) or by index once the index->source map is derived. Do not
  build a 127-entry CC dropdown.

## Out of scope

The modular **Patch Editor** (separate Programmer's Manual) — enormous surface,
a separate initiative if ever. Relay/serial/Orville-to-Orville control — niche.
