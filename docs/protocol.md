# Eventide Orville SysEx protocol

A working reference for the SysEx dialect OrvilleCommander speaks to the Eventide
Orville. Framing, the keypress table, and the screen dump are documented in
Eventide **Tech Note 34** ("MIDI Sysex Messages on the DSP4000"; see
[`device-model.md`](device-model.md) §Sources). The **object protocol** the app
relies on (`0x2d`/`0x2e`/`0x31`/`0x32`) is **not** in any Eventide document —
it's reverse-engineered from the device's responses and the code. Named
constants live in [`src/sysex-commands.js`](../src/sysex-commands.js) (protocol)
and [`src/constants.js`](../src/constants.js) (timing/layout).

For the conceptual model — the object tree, presets/dual-DSP, value semantics,
and behavioral quirks — see [`device-model.md`](device-model.md). This file is
the wire format; that one is how the device behaves.

## Framing

Every message is:

```
F0 1C 70 <deviceId> <cmd> <payload...> F7
```

| Byte    | Value     | Meaning                          |
| ------- | --------- | -------------------------------- |
| 0       | `F0`      | SysEx start (added by WebMIDI)   |
| 1–2     | `1C 70`   | Manufacturer: Eventide + DSP4000 (`SYSEX.MANUFACTURER`) |
| 3       | `01`–`3F` | Device ID (1–63)                 |
| 4       | `<cmd>`   | Command byte (see table)         |
| 5 …     | payload   | Command-specific                 |
| last    | `F7`      | SysEx end (`SYSEX.END`)          |

The five bytes before the payload are `SYSEX.FRAME_PREFIX_LEN`; inbound parsing
slices `data.slice(5, -1)` to get the payload.

**Device ID.** The hardware uses 1–63. OrvilleCommander treats `0` as an
auto-detect sentinel: on the first inbound message it adopts `data[3]` as the
device ID, then matches on it thereafter.

## Commands

| Cmd    | Dir | Name            | Constant            |
| ------ | --- | --------------- | ------------------- |
| `0x01` | out | Keypress        | `CMD.KEYPRESS`        |
| `0x17` | in  | Screen bitmap   | `CMD.SCREEN_BITMAP`   |
| `0x18` | out | Request screen  | `CMD.GET_SCREEN`      |
| `0x2d` | out | Value request / put | `CMD.VALUE`       |
| `0x2e` | in  | Value dump      | `CMD.VALUE_DUMP`      |
| `0x31` | out | Object-info request | `CMD.OBJECTINFO_DUMP` |
| `0x32` | in  | Object-info dump | `CMD.OBJECTINFO`     |

### Keypress — `0x01` (out)

A button is a 4-byte mask (active-low: a pressed button clears its bit). Each
byte is split into two nibbles — high then low — so the 4-byte mask becomes 8
payload bytes. `<ENTER>` (`FF FF FF EF`):

```
F0 1C 70 01 01  0F 0F 0F 0F 0F 0F 0E 0F  F7
```

The full mask table is in `system_commands.txt` and mirrored in
`controls.js:keypressMasks` (that file must match the canonical table). Nibbling
is `midi.js:nibble()`.

### Screen bitmap — request `0x18` (out), response `0x17` (in)

`0x18` has no payload. The device replies with `0x17` whose payload is
**nibble-encoded** (every byte ≤ `0x0F`); pairs are recombined high-then-low by
`framebuffer.js:denibble()`.

The denibbled stream is **1933 bytes**, and Tech Note 34 specifies its layout:

| Bytes        | Meaning                                          |
| ------------ | ------------------------------------------------ |
| 0–3          | width in pixels (u32) — `0x000000F0` = 240        |
| 4–7          | height in pixels (u32) — `0x00000040` = 64        |
| 8–11         | bitmap size in bytes (u32) — 1920                 |
| 12–1931      | 1920 bytes of pixel data                          |
| 1932         | 1-byte checksum (all bytes incl. size sum to 0)   |

So `SCREEN.HEADER_BYTES = 12` is really three u32 fields (width/height/size).
Pixels are **`ceil(width/8) × height`, 1 bit per pixel, MSB = leftmost** — for
240×64 that's 30 bytes/row — a plain row-major decode
(`framebuffer.js:computePixels`). A set bit is a lit (green) pixel. The decoder
hardcodes 240×64 today; per the spec it could read the dimensions from the
header and verify the checksum (tracker follow-up).

> Historical note: earlier code used a 13-byte header and compensated for the
> resulting 1-byte misalignment with a column rotate + a 1px shift of the first
> 8 columns. The header is 12; those heuristics were removed. See the tracker
> (A2 / A2-root) and `build_tools/render-screen.js` (`npm run screen`) to render
> a captured dump to PNG.

### Object-info — request `0x31` (out), response `0x32` (in)

Request payload is the menu key as ASCII bytes (e.g. `'0'` → `30`). The response
payload is ASCII: one **sub-object per line**, parsed by
`parser.js:parseSubObject` after tokenizing with `sysex-split.js:splitLine`
(splits on spaces outside quotes; quotes group multi-word fields like preset
names).

Field order per line — `type position key parent statement tag …`:

| Type  | Meaning            | Trailing fields                                             |
| ----- | ------------------ | ---------------------------------------------------------- |
| `COL` | column / sub-menu  | —                                                          |
| `NUM` | numeric param      | `value min max step`                                       |
| `SET` | enumerated param   | `index "current" <count(hex)> "opt0" "opt1" …`            |
| `CON` | continuous / meter | `value`                                                    |
| `TRG` | trigger / action   | —                                                          |
| `INF` | info / read-only   | `value`                                                    |

For `SET`, the option count is hex; the named options follow and become the
dropdown choices.

### Value — request/put `0x2d` (out), dump `0x2e` (in)

`0x2d` serves two outbound roles:

- **Value request:** payload is the key as ASCII bytes.
- **Value put:** payload is `key` ASCII + `SYSEX.VALUE_SEPARATOR` (`0x20`,
  space) + `value` ASCII. Example — load DSP A (`sendValuePut('1002001c','1')`):
  `... 2D  31 30 30 32 30 30 31 63  20  31  F7`.

The device does **not** acknowledge a put. The only confirmation is a subsequent
`0x2e` dump, so the app issues a value request after a put to reconcile rather
than trusting an optimistic local write.

`0x2e` response payload is ASCII `"<key> <value…>"`; `parser.js` caches it under
the key. `CON` values and meter keys trigger an immediate re-render; others are
coalesced.

## Key conventions

Most keys are discovered dynamically from object-info dumps. A few are referenced
by name in app logic (`KEY` in `sysex-commands.js`): `ROOT` (`'0'`), the menu
roots (`SETUP`, `PROGRAM`, `LEVELS`, `BYPASS`), `FAVORITES`, the DSP preset roots
(`DSP_A_PRESET` `401000b`, `DSP_B_PRESET` `801000b`), the load triggers, etc.

Structural patterns on otherwise-dynamic keys:

- `KEY_PREFIX.DSP_A` (`'4'`) / `KEY_PREFIX.DSP_B` (`'8'`) — first char selects the DSP.
- `KEY_SUFFIX.PRESET` (`'000b'`) — a preset/DSP root key.
- `KEY_SUFFIX.METER` (`'0002'`) — a meter parameter (immediate re-render).

## Request/response tracking — the dump wave (app-side)

Not part of the wire protocol, but relevant when reading the code: `midi.js`
groups request/response activity into **dump waves** and emits a `dumpComplete`
event when a wave finishes. This is the substrate the Phase 3.1 eager loader and
render-coalescing build on (see
[`refactor/phase3-state-model.md`](refactor/phase3-state-model.md)).

**Wave lifecycle:**

- A wave **starts** when the `outstanding` request counter transitions `0 → 1`.
- Each `OBJECTINFO_DUMP` (`0x31`) and `VALUE_DUMP` request (`0x2d`) increments
  `outstanding` (via `recordRequest`). `VALUE_PUT` is **not** counted — the
  device sends no response to a put (see the `0x2d` section above).
- Each matching `0x32` / `0x2e` response decrements `outstanding`, via
  `notifyResponse`, which `parser.js` calls at the top of each branch. The
  counter is a pure count — it does not yet correlate responses to requests by
  key or type.
- A wave **ends** one of two ways, both emitting `dumpComplete` with a `reason`:
  - `all-received` — `outstanding` returns to `0` (the healthy path).
  - `watchdog` — the timeout fires (a stall or a runaway wave).

The `dumpComplete` payload is
`{ reason, sendCount, receiveCount, durationMs, lastKey }`; it is also written to
`appState.lastDumpComplete` and logged. `getDumpStats()` exposes a session tally
of `all` vs `watchdog` reasons.

**Watchdog (idle/silence timer, not a hard ceiling).** Two timing constants in
[`src/constants.js`](../src/constants.js) bound a wave:

- `WATCHDOG_IDLE_MS` (1500 ms) — the watchdog is **rearmed for this interval on
  every send and every received response** while a wave is in flight. It fires
  only after this much *silence*, i.e. a genuine stall.
- `WATCHDOG_MAX_MS` (10000 ms) — an absolute per-wave ceiling measured from wave
  start; a rearm never extends the timer past this, so a pathological wave that
  keeps producing traffic still terminates.

The idle design replaced an earlier fixed 1500 ms ceiling set once at wave start.
That ceiling tripped during normal large enumerations — the bank list
(`OBJECTINFO 10020012`, ~70 names) takes ~4–6 s on real hardware (see
[`device-model.md`](device-model.md) §9, "Large enumerations are slow") — cutting
the wave short and dropping every response that arrived after. The idle window
lets a healthy multi-second enumeration drain to `all-received`; the absolute cap
is the backstop.

## Sources

- `system_commands.txt` — Eventide's button-press table (canonical for `0x01`).
- `src/sysex-commands.js`, `src/parser.js`, `src/framebuffer.js`, `src/midi.js` —
  the reverse-engineered remainder, from which this document is derived.
