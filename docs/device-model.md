# How the Orville works (as seen over SysEx)

Companion to [`protocol.md`](protocol.md). That document is the **wire format**
(bytes, framing, commands); this one is the **conceptual model** — what the data
means and how the unit behaves. Almost all of it is reverse-engineered:
`system_commands.txt` documents only the button-press SysEx.

This is a **living document** — extend it as hardware exploration reveals more.

## The object tree

The Orville exposes its UI as a tree of **objects**, each addressed by a hex
**key**. You read an object with `OBJECTINFO_DUMP (0x31)` and get back one line
per the object and its immediate children. Navigation is just querying keys —
random access, no need to move the front panel.

Root (`OBJECTINFO 0`) looks like:

```
COL 0 0        0 'ORVILLE ROOT OBJECT' ORVILLE 7
 COL 0 401000b 0 'Black Hole'        '' 0     ← DSP A preset
 COL 0 801000b 0 MetallicChamber     '' 0     ← DSP B preset
 COL 0 10010000 0 'setup functions'  setup 0
  8   0 10040000 0 '' ''                       ← undocumented meta entry (filtered)
 COL 0 10020000 0 'program functions' program 0
 COL 0 10030000 0 'level functions'   level 0
 COL 0 10030500 0 'bypass functions'  bypass 0
```

### Object (sub-object) types

Each line is `type position key parent statement tag [type-specific fields]`
(field order parsed in `parser.js:parseSubObject`).

| Type  | Meaning              | Notes                                        |
| ----- | -------------------- | -------------------------------------------- |
| `COL` | column / sub-menu    | has children; query its key to descend       |
| `NUM` | numeric parameter    | `value min max step`                         |
| `SET` | enumerated parameter | `index "current" <count hex> "opt0" "opt1" …`|
| `CON` | continuous / meter   | `value` (≈0..1, drawn as a bar)              |
| `TRG` | trigger / action     | fire with a VALUE_PUT of `1`                 |
| `INF` | info / read-only     | `value`                                      |
| `8`   | undocumented meta    | seen once at root (`10040000`); filtered out |

- **statement** is the display text and may carry a printf-style format
  (`%3.0f`, `%-10s`, `%%`). **tag** is a short label and can also carry a format
  (e.g. `v1:%3.0f` for graphic-EQ bands).
- **position** is usually numeric, but: `'a'` marks graphic-EQ band NUMs that
  group onto one line; non-numeric positions (`'e'`, hex) also appear.

## Keys

Firmware-defined and stable per object; discovered dynamically (don't hardcode
beyond the handful named in `sysex-commands.js`). Conventions:

- `'0'` — root.
- First char selects the DSP: `'4…'` = DSP A, `'8…'` = DSP B.
- Suffix `000b` — a preset/DSP root (`401000b` DSP A, `801000b` DSP B).
- Suffix `0002` — a meter parameter.
- Function menus: setup `10010000`, program `10020000`, level `10030000`,
  bypass `10030500`.
- Load menu: program select `10020011`, bank select `10020012`, load triggers
  `1002001c` (A) / `1002001d` (B), favorites bank `10020010`.

## Dual DSP and presets

Two independent engines, **A** and **B**, each running a preset. The root dump
reports both currently-loaded presets (above: `Black Hole` on A,
`MetallicChamber` on B). Each preset is its own object subtree:

```
COL 0 401000b 401000b 'Black Hole' '' 3
 COL 0 4040001 401000b 'space parameters' space 0
 COL 0 4050001 401000b 'in eq parameters' 'in eq ' 0
 COL e 4020004 401000b info info 0
```

i.e. preset root → category COLs → parameters. The trailing number on a COL is
its child count.

- The unit **boots into the last-used preset** per DSP, so the root dump is the
  authoritative "current state" at connect.
- **Active DSP** (which the front-panel A/B button controls) is **not** reported
  in the root dump — track it app-side if you need it.

## Values

- **Read:** `VALUE_DUMP` — request `0x2d <key>`, response `0x2e "<key> <value…>"`.
- **Write:** `VALUE_PUT` — `0x2d <key> 0x20 <value>`. **Not acknowledged**; the
  only confirmation is a subsequent dump, so always re-read rather than trust an
  optimistic local write.
- **SET value format:** `"<indexHex> <desc>"` — the index is **hex**
  (`0a manual` = index 10). Options are listed in the object's OBJECTINFO line.
- **TRG:** fire by putting `1` to its key (e.g. load a preset via `1002001c`).

## Screen bitmap

`0x18` requests a screen capture; `0x17` returns a nibble-encoded dump =
12-byte header + 1920 bytes (240×64, 1bpp, 30 bytes/row, MSB-left) + 1 trailing
byte. This is the physical front-panel LCD and is **independent** of where the
app is navigating. Full decode in `protocol.md` / `framebuffer.js`;
`npm run screen <fixture> out.png` renders one.

## Behavioral quirks (empirical)

- **No PUT acknowledgement** → the app keeps no optimistic value; it reconciles
  by re-dumping after a write.
- **Boots into last-used preset** → read current state from root, don't rely on
  cached app state.
- **Active DSP isn't on the wire** → it's app-side view state.
- **Favorites re-order:** after loading from the favorites bank the program
  index can shift; the parser corrects the selection (`parser.js`).
- **Root `type=8` entry** (`10040000`, empty statement/tag) — undocumented;
  filtered from menus.
- **Preset-name quoting is inconsistent:** DSP A came back quoted
  (`'Black Hole'`), DSP B unquoted (`MetallicChamber`). `splitLine` handles
  quoted multi-word names; an unquoted multi-word name would mis-tokenize
  (latent).

## How to learn more

- **Capture live:** `npm run capture:fixtures` against a connected unit writes
  dumps into `tests/fixtures/`.
- **Render a screen:** `npm run screen <fixture> out.png`.
- **Decode logic:** `parser.js` (object/value parsing), `framebuffer.js` (screen).
- **Raw reasoning log:** `docs/refactor/session-knowledge-dump.md`.

Open questions worth a hardware session: does any value key report the active
DSP? what is the full bank/preset taxonomy (≈70 banks)? what is the `0x17`
trailing byte (checksum?)?
