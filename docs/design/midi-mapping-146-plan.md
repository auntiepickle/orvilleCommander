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

## RESOLVED: fully object-addressable, no keypress automation

The whole modulation system is configured with the app's existing
`OBJECTINFO` / `VALUE_PUT` machinery. (An earlier draft of this plan wrongly
concluded the per-parameter page was not addressable — that was a key-guessing
failure: the objects live in the `1003…` "remote control" region, **not**
derivable from the parameter's `405…` key.)

**The "remote control" menu** (`10030400`, manual: "Remote Controlling
Parameters") holds a per-parameter **setup page** — e.g. `level setup` at
`10030401` — whose fields are ordinary addressable objects:

| key | obj | meaning |
|-----|-----|---------|
| `10030402` | SET `mode` | the source: off / low / high / assign 1-8 / … (set by index) |
| `10030403/404` | SET | sub-params (channel, controller #) — populate by mode |
| `10030405` | CON `monitor` | live controller value (%) |
| `10030406` | TRG `Capture Midi` | one-click learn |
| `10030408` | NUM `range` (tag `scale`) | modulation depth |
| `10030409` | SET `type` | absolute / relative (3 opts) |

**Direct SysEx writes work with ZERO keypresses** (probe-midi-confirm.mjs):
`VALUE_PUT(10030402, 3)` flipped the mode `low -> high` over SysEx alone, and the
parameter value moved in response — verdict *"DIRECTLY ADDRESSABLE."* The 8
**global assign controllers** (`10010100`) are likewise addressable, with a
working `Capture Midi` learn.

Two enablers (both from the internet research):

- **`sequence out = new`** (key `10010016`, options off/old/new): the unit
  **emits the key of any field touched** — `F0 1C 70 <dev> 3C <ascii-hex key> 20
  <ascii value> F7`. This is the discovery mechanism that located `10030402`
  after blind key-guessing failed. The app can use it to map a parameter's
  setup-page key by touching it once, or to mirror live changes.
- **Degenerate `mode` options don't matter** — set the source by *index* via
  `VALUE_PUT`; the device echoes the real name (`3 high`), so the app can
  enumerate the index->source map once (PUT 0..N, read echoes).

**Binding model (RESOLVED, 2026-06-12):** `10030401` is a SINGLE context-bound
editing surface, not per-param keys (`10030400` has one child). SELECT-hold on a
parameter binds it — confirmed it rebinds `level setup` -> `t_delay setup` with
the same field keys. So mapping a parameter is: **bind** (drive the device cursor
to the param — `program`->`parameter`->`CURSOR-DOWN`×n then SELECT-hold, verified
by the screen title `<param> setup`) then **configure** by clean `VALUE_PUT` to
the fixed keys (`10030402` mode, `10030408` range, `10030409` type, `10030406`
Capture). Bind is one short verified keypress sequence; config is pure object
writes. Full `mode` index->source table + field keys: `device-model.md` §8b.

**Runtime is pure device, zero app latency** — the app only writes config; the
Orville does MIDI -> parameter in its DSP, persisted in the preset.

## Build phases

0. **Map the remote-control region** (`10030400`): enumerate the per-parameter
   setup-page keys for a preset (via sequence-out + OBJECTINFO walk) and the
   `mode` index->source table. Record in `device-model.md`. No new control
   primitive needed — it is all object access.
1. **Global controllers panel** — a panel over the 8 assigns (`10010100`):
   each source + live monitor, one-click **Learn** (fire `Capture Midi` +
   emit/await a CC), clear. All object-addressable, proven end-to-end.
2. **Per-parameter mapping** — a "MIDI Map" badge on every editable NUM/SET that
   opens that parameter's setup page (`10030401`-style) as a focused card,
   rendered from objects and edited by `VALUE_PUT`: pick `mode` (assign/source),
   set `range`/`type`, fire `Capture Midi`. The live `monitor` CON shows it
   working. No keypress automation.
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

- **Per-parameter setup-key reachability** (the one open detail above) — confirm
  every parameter's setup page has a directly addressable key vs. needing a
  one-time OBJECTINFO navigate to populate `10030400`. Either way it is object
  access, not keypress automation; resolved by a short sequence-out enumeration
  in Phase 0.
- **Source enumeration** — the `mode` SET options are degenerate placeholders, so
  set by index and read the echo for the real name; enumerate the index->source
  table once. (Not a 127-entry dropdown.)
- **Leaving the device modified** — writes change preset state; the app should
  read-back, let the user confirm/undo, and never leave a half-written mapping.
  Note: enabling `sequence out = new` is itself a device setting the app turns
  on (and should restore) when it wants live-change mirroring.

## Out of scope

The modular **Patch Editor** (separate Programmer's Manual) — enormous surface,
a separate initiative if ever. Relay/serial/Orville-to-Orville control — niche.
