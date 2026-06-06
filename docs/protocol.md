# Eventide Orville SysEx protocol

A working reference for the SysEx dialect OrvilleCommander speaks to the Eventide
Orville. Only the button-press table is from an Eventide source
(`system_commands.txt` at the repo root); everything else here was
reverse-engineered from the device's responses and is documented from the code.
Named constants live in [`src/sysex-commands.js`](../src/sysex-commands.js)
(protocol) and [`src/constants.js`](../src/constants.js) (timing/layout).

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

The denibbled stream is **1933 bytes**:

| Bytes        | Meaning                                  |
| ------------ | ---------------------------------------- |
| 0–11         | header (`SCREEN.HEADER_BYTES` = 12)      |
| 12–1931      | 1920 bytes of pixel data                 |
| 1932         | 1 trailing byte (checksum/terminator)    |

Pixels are **240×64, 1 bit per pixel, 30 bytes/row, MSB = leftmost pixel**, a
plain row-major decode (`framebuffer.js:computePixels`). A set bit is a lit
(green) pixel.

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

## Request/response tracking (app-side)

Not part of the wire protocol, but relevant when reading the code: `midi.js`
counts outstanding requests per "wave" and emits a `dumpComplete` event when the
count returns to zero or a `WATCHDOG_MS` (1500 ms) ceiling fires. This backs the
render-coalescing in `event-bridge.js`.

## Sources

- `system_commands.txt` — Eventide's button-press table (canonical for `0x01`).
- `src/sysex-commands.js`, `src/parser.js`, `src/framebuffer.js`, `src/midi.js` —
  the reverse-engineered remainder, from which this document is derived.
