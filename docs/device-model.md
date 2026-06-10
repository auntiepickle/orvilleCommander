# Orville SysEx device specification

A durable specification of how the Eventide Orville behaves over SysEx —
intended to be complete enough to **reimplement this app from scratch**. It is
the conceptual + behavioral spec; [`protocol.md`](protocol.md) is the byte-level
wire companion.

**Documented vs. reverse-engineered — read this first.** Eventide's *Tech Note
34 / Technical Note #94, "MIDI Sysex Messages on the DSP4000"* (see §Sources) is
the authoritative reference for the **legacy** protocol: framing, the keypress
table, the screen dump, and the program/setup/sigfile/info commands
(opcodes `0x00`–`0x1A`). **However, the object protocol this app actually relies
on — `OBJECTINFO`/`VALUE` (`0x2d`, `0x2e`, `0x31`, `0x32`) — is NOT in Tech Note
34 or any other Eventide document we have.** It is an undocumented Orville/7000
extension, reverse-engineered here from captured dumps (`tests/fixtures/`) and
the parsing code. So: trust Tech Note 34 for §1/§2-legacy/§7/keypress; this
document is the *only* spec for §3–§6 (the object/value model).

**Living document** — extend it as hardware exploration answers the open
questions in §12.

**Confidence legend:** `[V]` verified from captures/code · `[D]` documented in
Tech Note 34 · `[I]` inferred but unconfirmed · `[?]` unknown, needs a hardware
session.

---

## 1. Transport & framing `[D]`

Every message: `F0 1C 70 <deviceId> <cmd> <payload…> F7` (Tech Note 34).

- `1C` = Eventide, `70` = the 4000-family (`H4000`) product id.
- `deviceId`: per Tech Note 34, **`0` means broadcast — all units listen**. This
  app instead uses `0` locally as an auto-detect sentinel: it adopts the first
  inbound message's id byte and matches on it thereafter (so it talks to one
  unit by id rather than broadcasting).
- **Nibbling** `[D]`: many payloads split each 8-bit byte into two 4-bit
  nibbles (MIDI data bytes are 7-bit), **most-significant nibble first**.
- Outbound payloads that carry a key send the **ASCII bytes of the hex key
  string** (e.g. key `0` → `0x30`; key `401000b` → `34 30 31 30 30 30 62`).
  Note this ASCII-key addressing is part of the undocumented object protocol,
  not Tech Note 34.
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

`0x01`, `0x17`, `0x18` are documented in Tech Note 34 `[D]`. **`0x2d`/`0x2e`/
`0x31`/`0x32` are NOT** — they're the reverse-engineered object protocol `[V]`.
Full byte tables and the keypress nibbling are in `protocol.md`.

### Documented legacy commands not used by this app `[D]`

Tech Note 34 defines opcodes `0x00`–`0x1A`. The app ignores most, but they're
worth knowing — especially the alternative ways to read a preset and the
ack/error replies:

| Cmd    | Name                  | Notes                                            |
| ------ | --------------------- | ------------------------------------------------ |
| `0x00` | `SYSEXC_OK`           | "last command was OK" ack (for assorted commands) |
| `0x0D` | `SYSEXC_ERROR`        | error reply; may carry an ASCII message           |
| `0x06`/`0x15` | PROGRAM want/dump | current program in binary                       |
| `0x07`/`0x16` | SETUP want/dump   | unit setup state                                |
| `0x08`/`0x09` | SIGFILE dump/want | **preset as a human-readable operator netlist** (HEAD…TAIL); a different representation than the §3 OBJECTINFO menu tree |
| `0x0A`/`0x0B` | SIGFILE remote/quick | remote-editor variants; `0x0A` replies `OK`/`ERROR` |
| `0x19`/`0x1A` | INFO dump/want    | ASCII system info (ROM name/revision/time/size) |

Whether the object commands (`0x2d`, etc.) ever reply with `OK`/`ERROR` is
unknown — see §12.

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

On the object's **own** line, the `PARENT` field echoes the object's **own key**
(self-referential), not its real parent — verified across every captured dump,
e.g. setup (`COL 0 10010000 10010000 …`, real parent `0`) and `space parameters`
(`COL 0 4040001 4040001 …`, real parent `401000b`); root's `COL 0 0 0 …` is
consistent but trivially so (key and parent are both `0` either way). `[V]` Only
the child lines carry a real parent (the dump's main key). Consequence: a dump
does not identify where it sits in the tree, so a consumer correlating an
unsolicited or late `OBJECTINFO` reply to a parent menu must use its own
request/view state — the dump itself cannot be trusted for that.

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
| `STR` | **string-edit field** `[V]` — observed live (2026-06-10) under 'save program'/'save bank': `STR 0 10020023 10020020 name:%-19s name <value>`. The name editor for saves. Parser: default branch (value = field 7). Renderer: clickable editor; a string `VALUE_PUT` is echoed as a `0x2e` (confirmed live; multi-word values work and come back QUOTED in dumps; an empty-string put is ignored — no clear-to-empty semantic). |
| `8`   | **empty / nonexistent object** `[V]` — returned for an unknown key and for empty slots (e.g. root's `10040000`); empty statement/tag. Probed live: `OBJECTINFO ffffffff` → `8 0 ffffffff ffffffff '' ''`. The app filters it. |

### POSITION `[V/I]`

A hex digit giving ordering, with special codes seen in captures: `'a'` marks
graphic-EQ band NUMs that the UI groups onto one line `[V]`; `'e'` appears on the
`info` child of presets `[V]`; `'c'` appears on empty-tag page/wrapper COLs
(probed live 2026-06-10: the `Post D/A Gain` chain `10030601` -> `1003006b`/
`1003006c`, whose statements carry the page names) `[V]`. Other hex values `[I]`.

### STATEMENT / TAG `[V]`

`STATEMENT` is display text and may embed a printf-style format (`%3.0f`,
`%-10s`, `%%`). `TAG` is a short label and may itself carry `label:format`
(e.g. `v1:%3.0f` for a graphic-EQ band). Either may be empty (`''`).

## 4. Sub-object field grammar `[V/D]`

After the six common fields, trailing fields depend on TYPE:

- **COL** — `childCount` (hex). `[V]`
- **NUM** — `value min max step`. `[V order]` Per the Programming Manual `[D]`,
  these are a `knob`'s lower/upper limits and **resolution** (the minimum change
  per knob step), in the parameter's **own physical units** (e.g. a delay knob
  ranges 0–10000 with resolution 0.1). So min/max/step are real units, not
  normalized.
- **SET** — `currentIndex "currentDesc" optionCount(hex) "opt0" "opt1" …`. The
  options become the choice list; `currentIndex` is **hex** and **0-based** —
  the Programming Manual's `textknob`: "if the 1st selection is made the output
  = 0, if the 3rd, = 2". `[V/D]`
- **CON** — `value` (continuous; rendered as a bar; meter keys observed to end
  `0002` — naming convention only, see §5).
  Maps to the documented `monitor`/`hmonitor`/`vmonitor`/`meter` modules, which
  have their own min/max display specifiers `[D]`; the absolute value range is
  still `[?]` (we treat ≈0..1).
- **TRG** — no value field; fire by `VALUE_PUT <key> 1`. `[V]` (no direct
  documented module — a runtime momentary).
- **INF** — `value` (read-only). Maps to `monitor`/`tmonitor`/`textblock`. `[V/D]`

### Object types ↔ documented modules `[D]`

The OBJECTINFO `0x32` **command** is undocumented, but the object *types* it
returns are the runtime form of the sigfile **interface modules** documented in
the Programming Manual — so their field semantics are authoritative, not guessed:

| OBJECTINFO type | Documented module(s)                          |
| --------------- | --------------------------------------------- |
| `COL`           | `menupage` (parameter container) / `head` (defines the SOFT-KEY set & order) |
| `NUM`           | `knob`, `tapknob`, `percentknob`, `rfader`/`hfader`/`vfader` |
| `SET`           | `textknob`                                     |
| `CON`           | `monitor`/`hmonitor`/`vmonitor`/`meter` (graphical control-signal monitors) |
| `INF`           | `monitor`/`tmonitor`/`textblock`               |
| `TRG`           | (not in the manual)                            |
| `8`             | (not in the manual)                            |

### Display formats `[D]`

The `STATEMENT`/`TAG` format specifiers are documented (Programming Manual):
a numeric field is `%Y.Xf` — `Y` = total display width, `X` = digits after the
decimal (omit the `.` → 6 decimals); a `textknob`/string field uses `%s`. The
**menu statement is ≤ 20 characters including the value.** Our renderer also
handles `%-Ns` (left-justified) and `%%` (literal percent) — consistent with
this family. (Updates the `[V]` in §3 STATEMENT/TAG to `[D]`.)

## 5. Keys & conventions `[V/I]`

Keys are firmware-defined and stable per object; discover them dynamically
(don't hardcode beyond the handful named in `src/sysex-commands.js`). Items
below are `[V]` unless marked otherwise.

- `0` — root (`'ORVILLE ROOT OBJECT'`).
- First char selects the DSP: `4…` = DSP A, `8…` = DSP B.
- Suffix `000b` — a preset/DSP root (`401000b` A, `801000b` B).
- Suffix `0002` — observed on meter parameters `[I]` (naming convention, not a
  type guarantee: non-meter keys can end `0002` — e.g. menu keys at child slot
  2. The app classifies meters by `CON` type from dumps, not by suffix).
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
- **Write:** `VALUE_PUT` (`0x2d <key> 0x20 <value>`). **The device echoes a
  `VALUE_DUMP` of the resulting value** `[V]` (live-probed) — i.e. a PUT *is*
  acknowledged with the effective value, **even when unchanged** (put `50`→`50`
  still echoed `50`). Out-of-range values are **clamped** to min/max, not
  rejected (`diff/time` put `999`, max 100 → echoed `100`); no `SYSEXC_ERROR`.
  Because the app's parser handles inbound `0x2e`, this echo already updates the
  cache — a separate re-read isn't strictly required (relevant to the A3
  optimistic-write decision and the Phase 3 render flow).
- A TRG is fired by putting `1`.

## 7. Screen bitmap `[D]`

`0x18` requests; `0x17` returns a **nibble-encoded** payload. Tech Note 34
specifies the denibbled layout exactly:

| Bytes | Field      | Meaning                                              |
| ----- | ---------- | --------------------------------------------------- |
| 0–3   | width      | screen width in pixels (8 nibbles, MSN-first)        |
| 4–7   | height     | screen height in pixels                              |
| 8–11  | dumpSize   | bitmap size in bytes                                 |
| 12 …  | bitmap     | `ceil(width/8) * height` bytes, 1bpp, MSB = leftmost |
| last  | checksum   | 1 byte (2 nibbles); see checksum note below          |

For the Orville (240×64) this is the **1933-byte** stream we observe: 12 header
+ 1920 pixels + 1 checksum. **Verified against `screen-dump-black-hole.txt`**:
the header decodes to width `0x000000F0` = 240, height `0x00000040` = 64. So the
12-byte header we'd been treating as opaque is really three u32 fields, and the
trailing byte is the documented **checksum** (not a mystery).

**Checksum, exactly** `[V]`: the sum of every byte from the **size field
(offset 8) through the checksum byte**, inclusive, is `0 mod 256` — confirmed
against the full `screen-dump-black-hole.txt` capture. It does not include the
width/height fields. (Tech Note 34's "all bytes incl. size sum to 0" means
*from* the size field; see `protocol.md` §Screen bitmap and
`SCREEN.CHECKSUM_SUM_OFFSET`.)

Pixels are row-major, MSB = leftmost (`src/framebuffer.js`). The decoder
**reads** width/height/size from the header (`parseScreenHeader`/`computePixels`,
falling back to 240×64 only when the header dims are missing/insane) and
`renderBitmap` flags truncated, bad-checksum, or insane-dimension dumps instead
of silently rendering them (FB1, resolved). This is the physical LCD, independent
of app navigation. Render any capture with `npm run screen <fixture> out.png`.

**Capturing from hardware** `[V]`: the dump arrives over the U6MIDI Pro's slow
31250-baud DIN link as several 2048-byte buffer chunks (~1.2 s for the full
~3872-byte SysEx), so `npm run screenshot`
(`build_tools/hil-screenshot.cjs`) reassembles chunks until `F7` before
decoding — see `protocol.md` §Screen bitmap "Capturing screens (HIL)" and
tracker FB5. (Reassembling inbound SysEx until `F7` is general to every inbound
type; the browser app does it too in `midi.js:addSysexListener` — tracker FB6.)

## 8. Dual DSP & presets `[V/D]`

Two independent engines, A and B, **both always running**; the front panel only
*displays* one at a time (the A/B toggle) `[D]`. Each runs a preset that is its
own object subtree (`preset root → category COLs → params`, e.g. `Black Hole` →
`space`, `in eq`, `info`). The unit **boots into the last-used preset** per DSP,
so the root dump is the authoritative current state at connect. The **active
DSP** is **not** reported on the wire as a value — but it is **controllable and
observable** `[V]` (live-probed): sending the **A/B keypress** (`0x01`, mask
`FDFFFDFF`) toggles the displayed DSP, and the shared load-menu selectors
(`10020011`/`10020012`) then reflect the other DSP (verified A→B→A: program
selector went `' 12 Black Hole'` → `' 12 Auto Tape Flanger'` → back). So the app
both *controls* the active DSP (drive A/B) and can *detect* it (toggle and
observe), and otherwise tracks it as app-side view state.

### Banks & program loading `[D]` (Orville User Manual)

- **Banks & slots:** up to **100 internal banks**, each with **128 program
  slots** (0–127). Banks are named "manila folders." Banks can also live on a
  Memory Card (a unified namespace — scroll past internal banks, or `-` + number;
  a `C` marks card banks).
- **Bank 0 is the Favorites bank** `[D]` — auto-generated most-recently-used
  links (default 8 shown), created by the unit, not user-editable. This is what
  our `KEY.FAVORITES` (`10020010`) menu and the "favorites re-order" quirk (§9)
  are about: loading from it shifts the MRU order.
- **Each DSP tracks its own current bank** (the one shown in PROGRAM, usually the
  last loaded). A MIDI **Program Change** loads that slot number from the
  **current bank of the target DSP** (no bank in the message); if the slot is
  empty, nothing loads.
- **DSP targeting over MIDI:** with omni **on**, actions hit the current DSP;
  with omni **off**, base channel = DSP A, **base+1** = DSP B, **base+2** =
  routings. Bank changes use **MIDI Controller #0**, or a SysEx message (the
  User Manual defers its format to the Programming Manual — we have not captured
  it; see §12).
- **Bank & program names are read from two SETs** `[V]` (live-probed): the
  **bank SET `10020012`** (`'bank: %s'`) enumerates banks; the **program SET
  `10020011`** (`'programs: %s'`) enumerates the presets in the *current* bank.
  Each option is `'<slot> <name>'` with the slot number space-padded (e.g.
  `' 12 Black Hole'` = slot 12). These selectors are **scoped to the displayed
  DSP** (see §8 active-DSP) and show the DSP's **cued** program — what a load
  trigger would load — which can differ from the **running** preset name in the
  root dump (e.g. B's selector cued `Auto Tape Flanger` while B was running
  `MetallicChamber`). So load operations via these selectors target whichever
  DSP is currently displayed; switch with the A/B keypress first if needed.
- **Factory bank taxonomy `[V]`** — captured live: **70 named banks**, numbered
  **0–80 with gaps** (empty slots skipped, e.g. 25, 33–41, 60). Full list in
  `tests/fixtures/objectinfo-10020012-banks.txt`; highlights: `0 Favorites`,
  `5 Delays`, `8 Delays - Modulated`, `30 Phasers`, `31 Pitchtime`,
  `43–50 Reverbs - …`, `54–57 Shifters - …`, `69 Eventide Users`,
  `70 Programming`, `71–80 Px - …`. (User banks live in the same numbering.)

The factory default **device ID is 1** `[D]`; multiple units share a chain via
distinct ids; id 0 = broadcast (§1).

## 9. Behavioral contract & quirks

- **PUTs are echoed** `[V]` (corrected) — a `VALUE_PUT` triggers a `VALUE_DUMP`
  of the resulting (possibly clamped) value, even on no-change. So writes are
  self-confirming; out-of-range clamps to min/max (no error). (Earlier this was
  recorded as "no ack" — live probing showed otherwise.)
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
- **Screen dump carries a checksum** `[V]` — the trailing byte is a sum-to-zero
  checksum over the size field through the checksum byte (§7); the decoder now
  verifies it and flags a mismatch (FB1, resolved).
- **Bad reads degrade to empty, not error** `[V]` (live-probed) — `OBJECTINFO`
  on an unknown key returns a **type-8 empty object**; `VALUE_DUMP` on an unknown
  key returns the key with an **empty value**. No `SYSEXC_ERROR` for reads. So a
  consumer should treat type-8 / empty-value as "absent," not retry. (Whether a
  bad *write* errors is still untested.) `SYSEXC_OK`/`SYSEXC_ERROR` remain tied to
  the legacy commands; no `OK` is seen after a `VALUE_PUT`, hence reconcile-by-redump.
- **Large enumerations are slow** `[V]` (live-probed) — most dumps reply in well
  under a second, but the bank list (`OBJECTINFO 10020012`, ~70 names) takes
  **~4–6 s**. Implication: a fixed per-wave watchdog would fire mid-enumeration.
  The `midi.js` watchdog is therefore an idle/silence timer (`WATCHDOG_IDLE_MS`,
  rearmed on each send, each receive, and each raw inbound packet — #107; see
  [`protocol.md`](protocol.md)) bounded by an absolute `WATCHDOG_MAX_MS` cap, so a
  healthy slow enumeration drains to completion rather than being cut short (FB4,
  resolved; see [`protocol.md`](protocol.md) "Request/response tracking — the dump
  wave"). `OBJECTINFO` is otherwise context-free
  — load-menu keys (`10020011`/`10020012`) answer without navigating there, just
  slowly.
- **Keypress table** `[D]` — verified `controls.js:keypressMasks` against Tech
  Note 34 Appendix A: every single-key mask matches exactly. Naming differs —
  our `up`/`down` are TN34's `CURSOR-UP`/`CURSOR-DOWN` (`FEFFFDFF`/`FFFEFDFF`),
  and our `inc`/`dec` are TN34's data-entry `UP`/`DOWN` (`FFFFFF7F`/`FFFFFFBF`).
  The only non-single-key entry is `ab` (`FDFFFDFF`), an Orville-specific
  **combo** (two bits cleared at once) with no single-key DSP4000 equivalent.
  No discrepancies/bugs (FB3). `system_commands.txt` is the canonical Orville
  table and matches Appendix A for the shared keys.

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

Resolved by Tech Note 34 (no longer open): the `0x17` trailing byte (checksum);
the 12-byte screen header (width/height/size); MSN-first nibbling; `id=0`
semantics (broadcast).

Also resolved by the manuals (no longer open): bank/program **structure**
(100 banks × 128 slots, bank 0 = Favorites), NUM `min/max/step` semantics
(physical units + knob resolution), SET index 0-based, the display format
grammar (`%Y.Xf` / `%s`, ≤20 chars), and **FB2 (sigfile)** — see below.

**FB2 resolved:** a sigfile (`0x08`/`0x09`) is the ASCII **module netlist** (the
`.sig` design/transport form); loading one makes the unit *compile and load* a
whole program (Tech Note 34: "encode, compile, load … takes time"). It does
**not** expose the live menu-tree parameter *values* for display, so it is **not**
a shortcut for the eager loader — keep walking the OBJECTINFO tree. (It would
matter only for whole-preset backup/restore.)

Resolved by the live hardware session (no longer open): the **`8` type** =
empty/nonexistent object; **bad reads** return empty (no error); the full
**factory bank taxonomy** (70 banks, captured); **OBJECTINFO is context-free**
(load-menu keys answer without navigating, just slowly); large enumerations are
**slow (~4–6 s)**; **active DSP** is drivable (A/B keypress) and detectable
(toggle + re-read the display-scoped selectors) — see §8; **keypress (`0x01`)
works live** — we toggled A/B over MIDI; **PUTs are echoed** and **out-of-range
writes clamp** (no error) — see §6/§9.

Still open — needs a hardware session or more captures (all minor):

- A *dedicated* read for the active DSP (we can drive/detect it via §8, but no
  single "which DSP" value key has been found).
- **CON** absolute value range — live meters read ~0 at rest (need an audio
  signal through the unit to see a non-zero meter), so the wire range is still
  unconfirmed (we treat ≈0..1).
- The **bank-change SysEx** message format (deferred to the Programming Manual,
  which doesn't spell it out) — capture by watching what the unit emits.

> Live-session note: the U6MIDI Pro USB interface intermittently drops under
> rapid repeated port open/close (each probe is a fresh process). It recovers on
> its own. For long live sessions, prefer a single long-lived process that opens
> the port once.

## Sources

- **Eventide Tech Note 34 / Technical Note #94 — "MIDI Sysex Messages on the
  DSP4000"** (applies to Orville and the 7000 family): the authoritative legacy
  protocol (framing, nibbling, keypress Appendix A, screen dump, program/setup/
  sigfile/info, OK/ERROR). PDF:
  `https://s3.amazonaws.com/com.eventide.downloads/Discontinued+products/Tech_Note_34_MIDISysex.pdf`
- **Eventide Orville User Manual (v3.0)** — front-panel/operation reference;
  source for the bank/program model (§8), device-id default, dual-DSP display,
  and external-controller indirection. Index entry:
  `https://www.eventideaudio.com/downloads/orville-user-manual`
- **Eventide Programming Manual for Harmonizers** — the sigfile / module
  (operator) reference; source for the §4 object↔module mapping, the `%Y.Xf`
  format grammar, knob min/max/resolution semantics, and the sigfile definition
  (FB2). PDF:
  `https://s3.amazonaws.com/com.eventide.downloads/Product+Manuals/ProgrammingManual.pdf`
- **Eventide Orville documentation index**:
  `https://www.eventideaudio.com/downloads/?product=Orville&download_type=documentation`
  — also lists the Presets Manual, Orville/R addendum, and the Pedal/Switch
  tutorial.
- `system_commands.txt` (repo root) — the Orville keypress table this app uses.
- `tests/fixtures/` — captured OBJECTINFO/VALUE/screen dumps the object-protocol
  sections (§3–§7) are reverse-engineered from.
- The object protocol (`0x2d`/`0x2e`/`0x31`/`0x32`) is **not** in any Eventide
  document we have; §3–§6 here are the only spec for it.
