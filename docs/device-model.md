# Orville SysEx device specification

A durable, reverse-engineered specification of how the Eventide Orville behaves
over SysEx — intended to be complete enough to **reimplement this app from
scratch**. It is the conceptual + behavioral spec; [`protocol.md`](protocol.md)
is the byte-level wire companion. Only the button-press table is vendor-supplied
(`system_commands.txt`); everything else here was derived from captured dumps
(`tests/fixtures/`) and the parsing code.

**Living document** — extend it as hardware exploration answers the open
questions in §12.

**Confidence legend:** `[V]` verified from captures/code · `[I]` inferred but
unconfirmed · `[?]` unknown, needs a hardware session.

---

## 1. Transport & framing `[V]`

Every message: `F0 1C 70 <deviceId> <cmd> <payload…> F7`.

- `1C 70` = Eventide + DSP4000 manufacturer/product id.
- `deviceId` 1–63. This app uses `0` as an auto-detect sentinel: it adopts the
  first inbound message's id byte, then matches on it.
- Outbound payloads that carry a key send the **ASCII bytes of the hex key
  string** (e.g. key `0` → `0x30`; key `401000b` → `34 30 31 30 30 30 62`).
- **Response framing differs by command** `[V]`:
  - `OBJECTINFO (0x32)` payload ends `0D 0A 20 00 F7` — sub-object lines are
    **CRLF-separated**, and there is a trailing space + **NUL** before `F7`.
    Parsers must strip the trailing NUL.
  - `VALUE_DUMP (0x2e)` payload ends `<value> 20 F7` — a trailing space, **no
    NUL**.

## 2. Commands `[V]`

| Cmd    | Dir | Name              | Payload                                  |
| ------ | --- | ----------------- | ---------------------------------------- |
| `0x01` | out | Keypress          | 4-byte button mask, nibbled to 8 bytes   |
| `0x31` | out | OBJECTINFO request| key as ASCII                             |
| `0x32` | in  | OBJECTINFO dump   | CRLF-separated object lines (see §3)      |
| `0x2d` | out | Value request /put| key as ASCII; PUT adds `0x20` + value     |
| `0x2e` | in  | Value dump        | `"<key> <value…>"` (see §6)               |
| `0x18` | out | Request screen    | (none)                                   |
| `0x17` | in  | Screen bitmap     | nibbled framebuffer (see §7)              |

Full byte tables and the keypress nibbling are in `protocol.md`.

## 3. Object model `[V]`

The UI is a tree of **objects**, each addressed by a **variable-length hex
key**. `OBJECTINFO(key)` returns the object's own line followed by one line per
**direct child**. Navigation is random-access by key — no need to move the front
panel, and querying never changes device state.

### Line grammar `[V]`

```
TYPE  POSITION  KEY  PARENT  STATEMENT  TAG  [type-specific…]
```

Tokenized like a shell line: whitespace-separated, single/double quotes group a
multi-word field (so `'space parameters'` is one token). This is `splitLine` in
`src/sysex-split.js`.

The object's **own** line ends with its **child count in hex**; child lines show
`0` for that field until you query them. Verified across fixtures:

| Object                    | Children (hex) | Listed |
| ------------------------- | -------------- | ------ |
| root `0`                  | `7`            | 7      |
| setup `10010000`          | `f`            | 15     |
| `Black Hole` `401000b`    | `3`            | 3      |
| `MetallicChamber` `801000b` | `4`          | 4      |

### TYPE `[V]`

| Type  | Meaning              |
| ----- | -------------------- |
| `COL` | column / sub-menu (has children) |
| `NUM` | numeric parameter    |
| `SET` | enumerated parameter |
| `CON` | continuous / meter   |
| `TRG` | trigger / action     |
| `INF` | info / read-only     |
| `8`   | undocumented meta `[I]` — one seen at root (`10040000`), empty statement/tag; the app filters it |

### POSITION `[V/I]`

A hex digit giving ordering, with special codes seen in captures: `'a'` marks
graphic-EQ band NUMs that the UI groups onto one line `[V]`; `'e'` appears on the
`info` child of presets `[V]`. Other hex values `[I]`.

### STATEMENT / TAG `[V]`

`STATEMENT` is display text and may embed a printf-style format (`%3.0f`,
`%-10s`, `%%`). `TAG` is a short label and may itself carry `label:format`
(e.g. `v1:%3.0f` for a graphic-EQ band). Either may be empty (`''`).

## 4. Sub-object field grammar `[V/I]`

After the six common fields, trailing fields depend on TYPE:

- **COL** — `childCount` (hex). `[V]`
- **NUM** — `value min max step`. Units/semantics of min/max/step `[?]`. `[V order]`
- **SET** — `currentIndex "currentDesc" optionCount(hex) "opt0" "opt1" …`. The
  options become the choice list; `currentIndex` is **hex**. `[V]`
- **CON** — `value` (continuous; rendered as a bar; meter keys end `0002`). Range
  ≈0..1 `[I]`.
- **TRG** — no value field; fire by `VALUE_PUT <key> 1`. `[V]`
- **INF** — `value` (read-only). `[V order]`

## 5. Keys & conventions `[V]`

Keys are firmware-defined and stable per object; discover them dynamically
(don't hardcode beyond the handful named in `src/sysex-commands.js`).

- `0` — root (`'ORVILLE ROOT OBJECT'`).
- First char selects the DSP: `4…` = DSP A, `8…` = DSP B.
- Suffix `000b` — a preset/DSP root (`401000b` A, `801000b` B).
- Suffix `0002` — a meter parameter.
- Function menus: setup `10010000`, program `10020000`, level `10030000`,
  bypass `10030500`.
- Load menu: program select `10020011`, bank select `10020012`, load triggers
  `1002001c` (A) / `1002001d` (B), favorites bank `10020010`.
- Root meta entry: `10040000` (type `8`, filtered).

Example — the real `setup` menu (`OBJECTINFO 10010000`) lists 15 children incl.
`Sample Rates` (`10010050`), `Select Inputs` (`10010818`), an unnamed `100100d0`
(empty statement/tag), `Tempo` (`40090000`), `MIDI configuration` (`10010010`),
etc. Note function menus can contain DSP-prefixed keys (`Tempo` is `40090000`).

## 6. Values `[V/I]`

- **Read:** `VALUE_DUMP` → `"<key> <value…>"`. The value may be **empty** (the
  preset roots and root return just the key: `401000b ` / `0`). `[V]`
- **SET value:** `"<indexHex> <desc>"`, e.g. `8060001 1b off` = index `0x1b`,
  desc `off`. `[V]`
- **Write:** `VALUE_PUT` (`0x2d <key> 0x20 <value>`). **Not acknowledged** — the
  device sends no confirmation; re-read via `VALUE_DUMP` to confirm. `[V]`
- A TRG is fired by putting `1`.

## 7. Screen bitmap `[V]`

`0x18` requests; `0x17` returns a **nibble-encoded** payload. Denibbled (high
nibble then low) it is **1933 bytes**: 12-byte header + 1920 bytes of pixels +
1 trailing byte. Pixels are **240×64, 1bpp, 30 bytes/row, MSB = leftmost**, a
plain row-major decode. The trailing byte's meaning is `[?]` (checksum?). This is
the physical LCD, independent of app navigation. Decoder: `src/framebuffer.js`;
render any capture with `npm run screen <fixture> out.png`.

## 8. Dual DSP & presets `[V]`

Two independent engines, A and B, each running a preset that is its own object
subtree (`preset root → category COLs → params`, e.g. `Black Hole` → `space`,
`in eq`, `info`). The unit **boots into the last-used preset** per DSP, so the
root dump is the authoritative current state at connect. The **active DSP** (the
one the front-panel A/B button drives) is **not** reported anywhere observed
`[V that root omits it]` — treat it as app-side state.

## 9. Behavioral contract & quirks

- **No PUT acknowledgement** `[V]` — keep no optimistic value; reconcile by
  re-dumping.
- **Boots into last-used preset** `[V]` — read current state from root.
- **Active DSP not on the wire** `[V]` — app-side view state.
- **Favorites re-order** `[V]` — loading from the favorites bank can shift the
  program index; correct the selection then re-dump (`parser.js`).
- **Root `type=8` entry** `[V]` — `10040000`, filtered from menus.
- **Preset-name quoting inconsistent** `[V]` — DSP A quoted (`'Black Hole'`),
  DSP B unquoted (`MetallicChamber`); a multi-word *unquoted* name would
  mis-tokenize (latent).
- **Framing** `[V]` — OBJECTINFO uses CRLF lines + trailing NUL; VALUE_DUMP does
  not (see §1).

## 10. Reimplementing from scratch — checklist

1. Open MIDI I/O; frame per §1; auto-detect device id from the first reply.
2. `OBJECTINFO 0` → parse the tree (§3 grammar, §4 fields) → you have root, both
   DSP presets, and the function menus.
3. Walk any key with `OBJECTINFO` to descend; read params with `VALUE_DUMP`
   (§6). Render per the type table.
4. Write with `VALUE_PUT`; never trust it — re-dump to confirm (§9).
5. Fire actions (TRG) with a PUT of `1`; load a preset via `1002001c`/`d`.
6. Mirror the LCD with `0x18`/`0x17` (§7) if desired; it's independent of (2)–(4).
7. Drive physical buttons with `0x01` masks (`system_commands.txt`) — a separate
   path from the query model.

## 11. Implications for the app state model

This spec drives [`refactor/phase3-state-model.md`](refactor/phase3-state-model.md):
the eager loader walks the §3 object tree of the active preset and confirms every
§6 value before render (the "never show an unconfirmed value" invariant); the
connect handshake reads current presets from the §8 root dump; active DSP is the
§8 app-side view concern.

## 12. Open questions (hardware backlog) `[?]`

- Does any value key report the **active DSP**? (Would upgrade §8 from guess to
  fact.)
- The full **bank/preset taxonomy** (~70 firmware banks) — names, indices,
  how the program/bank SETs enumerate them.
- The `0x17` **trailing byte** — checksum, terminator, or status?
- Exhaustive **TYPE** list and the meaning of the `8` meta type; any types beyond
  COL/NUM/SET/CON/TRG/INF.
- **NUM** units and the exact role of `min/max/step`; **CON** value range.
- Are there **error/NAK** responses (malformed request, out-of-range PUT)?
- Is `OBJECTINFO`/`VALUE_DUMP` truly context-free for **every** key regardless of
  front-panel position? (Assumed; spot-check edge menus.)
