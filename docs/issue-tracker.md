# Issue Tracker — Ready-for-Prime-Time

Single source of truth for driving every logged issue to zero. This file is committed to the repo so
any session (including a freshly reset one) can resume with zero re-briefing. Full rationale and batch
design live in the plan; this file is the operational ledger.

## How to use this file

**Status legend:** `[ ]` todo · `[~]` in progress (has a one-line **NEXT:**) · `[x]` done (with PR ref).

**Gate tags:** `needs-hardware` = fix is coded + replay-tested but final confirmation needs the
physical Orville. `needs-decision` = a product/UX or irreversible call for the maintainer.

### Resume protocol (what a fresh session does)
1. Read this file. Find the first `[~]`, else the first `[ ]` in batch order.
2. `git status` and `git branch --show-current` to confirm working state. All work happens on a
   branch — never commit to `main`. The git repo is this `orvilleCommander/` directory.
3. Do the item's **NEXT:** action. Run `npm test` and report raw output. Add a snapshot test first if
   touching render logic.
4. Update this ledger (status + NEXT), commit (conventional-commit message, no AI-attribution, no
   emoji), push, open/append the batch PR.
5. On a gate, mark the item with its gate tag, write the exact validation steps under the batch, and
   move to the next non-blocked item.

### Conventions
Conventional commits (`fix:`/`refactor:`/`test:`/`docs:`/`chore:`); one branch + PR per batch; CI must
be green; `npm test` green before marking `[x]`. Keep all written output factual and neutral.

---

## Phase 0 — Foundation & safety net

### Batch 0.1 — Ledger + method   [branch: docs/issue-tracker]
- [x] Create this ledger + document resume/human-gate protocol   PR #52
HUMAN-GATE: none

### Batch 0.2 — CI + tooling
- [x] F1  GitHub Actions CI running `npm ci` + `npm test` on push/PR to main
- [x] F2  ESLint flat config (no-unused-vars / no-console / no-useless-assignment warn) + `npm run lint`
- [x] F2  Prettier config + project-wide format pass over code (markdown excluded); `format`/`format:check` scripts; .git-blame-ignore-revs
- [x] F3  In-range dependency refresh (npm update) — cleared baseline-browser-mapping warning + all vulnerabilities
- [ ] F3  Major upgrades each on own branch, tested (Vite 8, Jest 30, archiver 8)   -> Batches 0.2a/0.2b/0.2c
- [x] B9  Moved `jest-environment-jsdom` to devDependencies
NOTE: ESLint warnings are the live Phase 1 prune worklist (`npm run lint`); promote no-* rules back to error at end of Phase 1.
HUMAN-GATE: none

### Batch 0.3 — Test-net widening   [branch: test/widen-coverage]  [PR: #54]   (gates all render/arch work)
- [x] E  Widened renderer snapshot: graphic-EQ pos-`a`, embedded childSubs, keyStack depth 3,
        SET hex idx >=10, INF type, formatValue `%3.0f`/`%-10s`/`%%`; handleLcdClick back-link + dsp-clickable (renderer.test.js)
- [x] E  Characterized VALUE_DUMP 0x2e branch (CON immediate-render, meter heuristic, program/bank skip, child-param, value-change logging)
- [x] E  Added coverage for midi.js byte-contract (sendSysEx/ObjectInfo/ValueDump/ValuePut/Keypress), controls.js, config.js
NOTE: test count 36 -> 64; snapshots 3 -> 8. Each new snapshot inspected for correctness, not just stability.
HUMAN-GATE: none

### Batch 0.4 — Offline replay harness   [branch: test/replay-harness]  [PR: #55]
- [x] H  Recorded-SysEx replay through the real parser/events/bridge/renderer (tests/helpers/replay.js + replay.test.js)
- [x] H  Framebuffer screengrab decode to ASCII (headless canvas stub) — already surfaces the A2 artifact; this is the offline validator for Batch 2.3
NOTE: test count 64 -> 66, 10 suites. Phase 0 (foundation) complete.
HUMAN-GATE: none

---

## Phase 1 — Cleanup (no behavior change)

### Batch 1.1 — Dead-code prune   [branch: chore/prune-dead-code]  [PR: #56]
- [x] B1  Removed dead exports: extractNibbles (bitmap.js), getState/subscribe + store subscriber Set/notify loop (store.js)
- [x] B3  Routed renderer select-change console.logs through gated log()
- [x] B4  Removed commented-out code (renderer assignment, midi SysEx log + unused category local)
- [x] B2  Removed SAVE_MONO_BMP flag + gated call + unreachable exportBMP (bitmap.js)
- [x] (bonus) Removed unused isPreset local + unused test imports
NOTE: ESLint warnings 26 -> 19. Remaining deferred to end-of-Phase-1 lint-zeroing: main.js unused DOM consts (~11),
      midi notifyResponse type/key params (intentional 7d API — will _-prefix or document), parser/renderer no-useless-assignment (~5).
FINDING (investigate later, possible bug): main.js grabs button refs that are never wired
      (backBtn, exportConfigBtn, importConfigInput, importConfigBtn, sendRequestBtn, getValueBtn, setValueInput, setValueBtn,
      applyLogCategoriesBtn, keyInput, logCategoriesJson). Either dead lookups or buttons in index.html missing handlers.
HUMAN-GATE: none

### Batch 1.2 — Magic-constant extraction   [branch: chore/sysex-constants]  [PR: #57]
- [x] B5  New src/sysex-commands.js CMD constants for command bytes; wired into midi/parser/renderer/controls/main
- [x] B6  KEY constants for app-logic param keys (T_RATE, PROGRAM_SELECT, BANK_SELECT, LOAD_TRIGGER_A/B)
NOTE: DSP preset keys 401000b/801000b left as store.js defaults + startsWith('4'/'8') checks — naming adds little, high churn. JSDoc @example literals left as-is.
HUMAN-GATE: none

### Batch 1.3 — Dedup + stale docs   [branch: chore/dedup-and-docs]  [PR: #58]
- [x] B7  Extracted canonical splitLine to src/sysex-split.js (leaf); parser + test helper import it. capture-fixtures.cjs (CJS build tool, not in test/runtime path) keeps a hand-synced copy with a pointer comment.
- [x] B8  parser comment corrected (isLoadingPreset clear is in event-bridge.js); CLAUDE.md architecture + module-structure sections refreshed for the completed refactor; toggleDspKey single-definition note.
HUMAN-GATE: none

### Phase 1 closeout   [branch: chore/phase1-closeout]  [PR: #66]   (complete)
- [x] Lint-zeroing: no-unused-vars / no-console / no-useless-assignment promoted to ERROR (with `^_`
      opt-out for intentionally-reserved args, e.g. notifyResponse(_type,_key)). All 19 warnings cleared:
      parser value init, renderer graphic-EQ inits + dead ancestorSeparatorAdded stores, apply_diff catch.
      CI now runs `npm run lint` + `npm run format:check` so it can't regress.
- [x] FINDING resolved (decision: remove): the 11 unwired Debug-Tools controls were real but handler-less.
      Removed from index.html (key-input/send-request/get-value/set-value-input/set-value/back-btn,
      export-config/import-config/import-config-btn, log-categories-json/apply-log-categories) and the
      matching dead consts from main.js. Nothing functional lost (they did nothing). Can be built properly later if wanted.

### Batch 1.4 — No magic numbers: audit + document (B10)  [requested]   [branch: chore/extract-constants]  [PR: #64]
Principle (now a CLAUDE.md convention): no unexplained literal constants anywhere — name and justify
them. The MIDI/SysEx protocol is the flagship offender but this is a codebase-wide audit. Three
reviewer agents swept all of src/; findings consolidated below.
- [x] B10a Protocol/MIDI literals extended in sysex-commands.js: SYSEX framing (END, MANUFACTURER,
      VALUE_SEPARATOR, FRAME_PREFIX_LEN), SCREEN geometry (WIDTH/HEIGHT/HEADER_BYTES), KEY additions
      (ROOT, SETUP, PROGRAM, LEVELS, BYPASS, FAVORITES, ROOT_META, DSP_A/B_PRESET, DELAY_PARAMS),
      KEY_PREFIX (DSP_A/B), KEY_SUFFIX (PRESET/METER), ROOT_SOFTKEYS. Wired through all callers.
- [x] B10b Non-protocol literals in new src/constants.js: TIMING (all render/poll/watchdog ms),
      LAYOUT (LCD_COLUMNS, SOFTKEYS_PER_LINE, SHORT_TAG_MAX), CANVAS (css), STORAGE_KEY,
      DEFAULT_LOG_LEVEL. Wired through midi/parser/renderer/controls/event-bridge/main/config/bitmap/framebuffer.
      Deliberately left as self-evident (per the principle — naming would hurt readability): nibble math
      (0x0f/>>4), RGBA stride (4), bit positions (7/8/255), quote/space chars, position '0', `|| 10` min-width guard.
- [x] B10c Wrote docs/protocol.md: framing, device-id, full command table, keypress nibbling, screen
      bitmap (nibbled; 12-byte header + 1920 1bpp + 1 trailing; row-major MSB-left), OBJECTINFO
      sub-object field order per type, VALUE request/put/dump (no PUT ack), key conventions. CLAUDE.md
      protocol table now links to it.
- [x] B10d docs/device-model.md is now a DURABLE FROM-SCRATCH SPEC (not just a reference): transport/
      framing incl. the OBJECTINFO-vs-VALUE response-framing difference, command table, full object-line
      grammar (child-count-in-hex, variable-length keys, position codes), per-type field grammar, key
      conventions, value semantics, screen format, dual-DSP/presets, behavioral contract, a
      "reimplement from scratch" checklist, and a §12 open-questions hardware backlog. Confidence-marked
      [V]/[I]/[?]. Grounded in all tests/fixtures + parser/framebuffer + session-knowledge-dump §13.
      Drives phase3-state-model.md. LIVING DOC — extend as hardware answers §12.
- [x] B10e Reconciled the spec against the official Eventide Tech Note 34 ("MIDI Sysex Messages on the
      DSP4000", URL the user supplied). Confirmed/upgraded: id=0=broadcast, MSN-first nibbling, and the
      0x17 screen header = width(u32)+height(u32)+size(u32) all nibbled + a 1-byte sum-to-zero CHECKSUM
      (verified: our fixture's header decodes to 240x64). Boundary finding: the object protocol
      (0x2d/0x2e/0x31/0x32) is NOT in TN34 — it's an undocumented Orville extension; our docs are its only
      spec. Added [D] confidence marker + a Sources section to device-model.md; updated protocol.md screen
      layout + framing notes. TN34 PDF kept locally in logs/ (gitignored; copyright) — cited by URL only.

### Device-research follow-ups (from Tech Note 34)
- [x] FB1 RESOLVED (branch fix/framebuffer-header-checksum): parseScreenHeader() reads width/height/size from
      the three big-endian u32 header fields; computePixels derives dims from the header (fallback 240x64 if
      missing/insane); renderBitmap logs an error on truncation / checksum-mismatch / bad-dims instead of
      silently painting a partial screen. CHECKSUM ALGORITHM confirmed against a full hardware capture: the
      sum of every byte from the size field (offset 8) through the trailing checksum byte is 0 mod 256 (TN34's
      "all bytes incl. size sum to 0" = from the size field). Tests pin it against screen-dump-black-hole.txt.
- [x] FB5 RESOLVED (branch fix/hil-sysex-reassembly): HIL screen captures were truncated. ROOT CAUSE: the
      Orville drives the U6MIDI Pro over a 31250-baud DIN link, so a ~3872-byte 0x17 dump takes ~1.2s to
      transmit and @julusian/midi (WinMM) delivers it as multiple 2048-byte buffer chunks (first chunk starts
      F0 1C 70 dev 17 with no F7; continuation chunks are raw bytes; the last ends F7). The old tool grabbed
      only the first chunk within a 1.5s window -> 2048 bytes / 1021 denibbled / top ~34 rows. NOT a device or
      buffer-size bug (setBufferSize proved unreliable here). FIX: hil-screenshot.cjs now reassembles chunks
      from the header chunk until F7, waits a 4s window for the slow transmission, retries on incomplete, and
      validates completeness. The five golden captures were RECAPTURED full (3872 bytes each, 1933 denibbled,
      complete && checksumOk) and re-rendered. Verified against the device.
- [x] FB4 RESOLVED (branch fix/dump-watchdog-idle-reset): the midi.js dump watchdog was a fixed 1500ms hard
      ceiling that fired mid-response on large enumerations like the bank list (OBJECTINFO 10020012, ~70 names,
      ~4-6s). Replaced with an idle/silence watchdog (WATCHDOG_IDLE_MS 1500, rearmed on every send and receive)
      bounded by an absolute WATCHDOG_MAX_MS (10000) ceiling, so a healthy slow wave drains to all-received.
      Documented in protocol.md ("Request/response tracking — the dump wave"); device-model.md §9 updated.
- [x] FB2 RESOLVED via the Programming Manual: a sigfile (0x08/0x09) is the ASCII module netlist (the .sig
      design/transport form); loading it makes the unit compile+load a whole program and does NOT expose
      live menu-tree values. So it's NOT a shortcut for the eager loader — keep walking OBJECTINFO. (Only
      useful for whole-preset backup/restore.) Documented in device-model.md §12.
- [x] FB3 DONE: verified controls.js keypressMasks against TN34 Appendix A — every single-key mask matches
      exactly (our up/down = CURSOR-UP/DOWN; inc/dec = data UP/DOWN). Only 'ab' is an Orville combo. No bug,
      no fix needed. Documented in device-model.md §9.

### Manual-deepening (B10f)
- [x] B10f Mined the Orville User Manual (v3.0) + Programming Manual for Harmonizers via agents and folded
      into device-model.md: object-types <-> documented interface modules (knob/textknob/menupage/monitor/
      meter) mapping; %Y.Xf format grammar + 20-char statement; NUM min/max/step = physical units + knob
      resolution; SET index 0-based; banks (100x128, bank 0 = Favorites/MRU); per-DSP current bank; MIDI
      Program Change / omni / base+0/+1/+2 DSP targeting; device-id default 1; dual-DSP both-always-running.
      Many §4-§8 claims upgraded [V]->[D]. Manuals cited in Sources; PDFs kept local (gitignored, copyright).

NOTE: Batch 1.4 (B10) complete.

### Hardware capture session (B10g)  [branch: chore/hardware-capture]
- [x] B10g Drove the live unit over MIDI (build_tools/orville-probe.cjs, U6MIDI Pro, dev 1) and resolved
      multiple §12 unknowns:
      * type 8 = EMPTY/nonexistent object (OBJECTINFO ffffffff -> "8 0 ffffffff ..."); root 10040000 is an empty slot.
      * Bad reads return empty (type-8 obj / empty value), NOT SYSEXC_ERROR.
      * Full factory bank taxonomy: 70 banks (0-80 with gaps), bank 0 = Favorites. Bank SET 10020012 / program
        SET 10020011 enumerate names with slot numbers, reflecting the displayed DSP.
      * NUM grammar confirmed live (space params: value/min/max/step in physical units, %3.0f/%3.1f).
      * Latency: bank list takes ~4-6s -> FB4 (watchdog too short).
      * OBJECTINFO confirmed context-free (load-menu keys answer un-navigated, just slow).
      New fixtures: objectinfo-{10020012-banks,10020011-programs,10020000-program,4040001-spaceparams},
      valuedump-4070001. New tool build_tools/orville-probe.cjs (interactive probe with --save).
- [x] B10g.2 active-DSP RESOLVED by DRIVING the unit: added a `key` action to orville-probe.cjs (sends
      keypress 0x01 with the controls.js masks) and toggled A/B over MIDI myself. Confirmed the program/bank
      selectors (10020011/10020012) are scoped to the DISPLAYED DSP and show the CUED program (can differ
      from the running preset; B cued 'Auto Tape Flanger'/bank 8 while running MetallicChamber). Active DSP
      is app-controllable (drive A/B) and detectable (toggle + re-read). Restored display to A afterward.
      Also PROVES the full HIL loop (drive a button over MIDI -> read state/screen) works from here —
      unblocks the deferred G2 live screenshot-regression loop.
      STILL OPEN (minor): dedicated active-DSP read key; CON value range; bank-change SysEx format.
- [x] B10g.3 More live probes (drove PUTs over MIDI; reversible, restored after):
      * CORRECTION — PUTs ARE acknowledged: a VALUE_PUT echoes a VALUE_DUMP of the resulting value, even
        on no-change (50->50 echoed 50). The app's parser already ingests this 0x2e echo. Earlier "no PUT
        ack" was wrong. Relevant to A3 + Phase 3 render flow. device-model.md §6/§9 corrected.
      * Out-of-range writes CLAMP to min/max, no SYSEXC_ERROR (diff/time put 999 -> 100). §12 resolved.
      * CON range still [?] (live meters read ~0 without an audio signal). 
      * #2 live screenshot-after-keypress demo NOT completed: the U6MIDI Pro USB intermittently drops under
        rapid probe open/close (recovers on its own). The HIL loop itself is already proven (drove A/B +
        read live; render-screen.js renders captured screens). For long live sessions use one long-lived
        process. Noted in device-model.md §12.
- [x] B10g.4 HIL screenshot loop tool + RDP root-cause for "no MIDI devices":
      * build_tools/hil-screenshot.cjs (npm `screenshot`): single long-lived process — opens MIDI
        once, optional `--press k1,k2`, sends 0x18, captures 0x17, saves raw fixture, renders PNG via
        render-screen.js. Implemented + lint/`node --check` clean.
      * PROVEN end-to-end live (after the RDP fix below): baseline capture (A: Black Hole / space
        params), `--press ab` drive+capture (B: MetallicChamber / detune params), then restored A.
        Renders faithful PNGs; A2 bitmap fix confirmed clean on real hardware. G2 live loop works.
      * ROOT CAUSE of the intermittent "no MIDI input devices currently available": RDP, not USB
        churn or the device. Proven: Get-PnpDevice (system-global) shows U6MIDI Pro + all 6 ports OK,
        but BOTH node's @julusian/midi AND raw WinMM midiInGetNumDevs() (per-session) return 0 in/
        1 out (GS Wavetable only). RDP redirects the audio/MIDI stack; the physical interface stays
        bound to the CONSOLE session and is invisible to the remote session's WinMM. Captures worked
        earlier because the active session was the console. => Live HIL (G2, hil-screenshot) must run
        from the physical console, OR mstsc Remote audio = "Play on remote computer" (unreliable for
        MIDI in). Offline work (replay fixtures) is unaffected by RDP.

---

## Phase 2 — Correctness bugs

### Batch 2.1 — Parser correctness   [branch: fix/parser-correctness]  [PR: #59]
- [x] A5  parseResponse is now atomic: snapshots appState on entry, reverts (incl. deleting added keys) on any throw; error log includes the stack
- [x] A3  Removed the optimistic currentValues write in the Favorites re-order fix; the Orville does not ack PUTs, so the existing re-dump is the single source of truth (PUT + re-dump retained)
HUMAN-GATE: none

### Batch 2.2 — Config correctness   [branch: fix/config-merge]  [PR: #60]
- [x] A4  Added config.mergeLogCategories(defaults, cached); boot-init now merges cached prefs over store defaults so new categories survive for existing users. Audited other cached fields — logCategories was the only object subtree (rest are scalars with fallbacks).
HUMAN-GATE: none

### Batch 2.3 — Bitmap artifact   [branch: fix/bitmap-shift]  [PR: #61]
- [x] A2  Fixed via edge-clamp. The first 8 columns arrive 1px high; we shift down 1px and fill the vacated top by duplicating the row below (not black = the artifact, not wrap = row-63 garbage). VALIDATED OFFLINE by rendering the recorded capture to PNG (`npm run screen`) and inspecting: green title-bar top border now continuous, no notch/specks.
- [x] (capability) Offline screen-to-PNG renderer: src/framebuffer.js (pure decode) + build_tools/render-screen.js. Lets a session SEE any captured screen dump without the device — the analysis half of the self-validation loop.
GATE RESOLVED OFFLINE: device spot-check still welcome but no longer blocking — the rendered image is ground-truth-equivalent for the recorded fixture. For NEW screens, drop a screen-dump fixture and run `npm run screen <fixture> <out.png> [scale] [header]`.

### Batch 2.3b — Bitmap decoder root-cause   [branch: fix/screen-header]  [PR: #62]
- [x] A2-root  Found the real cause of the artifact: the decoder skipped a 13-byte header when the 0x17 dump is 12 header + 1920 data + 1 trailing. The extra byte forced the ROTATE_COLUMNS + SHIFT_FIRST_COLUMN heuristics (and my edge-clamp was a third patch). Corrected header to 12 and DELETED all three heuristics — straight row-major MSB-left decode. Verified clean via `npm run screen` (full screen pixel-perfect) + framebuffer unit tests + replay snapshot.
NOTE: screen format is NOT in system_commands.txt (only button SysEx is) — the decoder is fully reverse-engineered. See [[B10]] below.

---

## Phase 3 — Architecture (behavior-affecting; needs 0.3 test-net + 0.4 replay first)

DESIGN: see docs/refactor/phase3-state-model.md. Driving invariant — never render an unconfirmed
value as current (show a loading placeholder, not a stale number). Three state domains: device model
(authoritative, dump-confirmed), app view (local; includes active DSP A/B, persisted app-side, default A),
physical LCD (independent mirror). Connect = pre-paint structure from cache (hint) -> root dump
authoritative -> land on last-active DSP's preset -> EAGER-load that preset's tree (default; `eagerLoad`
config toggles lazy) -> render on dumpComplete.

### Batch 3.1 — dumpComplete events (headline perf + correctness; the substrate)
- [ ] C1  Replace stacked 200ms setTimeout + debounce with explicit dumpComplete(key,data) events (event-bridge.js, parser.js, renderer 200/300/500ms chains). Drives both the connect handshake and eager-load completion.
- [ ] C4  Delete isLoadingPreset boolean once events expose dump-complete; update startup.test.js Tier A/B
HUMAN-GATE: none

### Batch 3.2 — State-shape hardening
- [ ] C3  Normalize keyStack mixed types (string@0, objects@1+) to always-objects or split structures
- [ ] C5  Renderer autoload: use `subs` param instead of global appState.currentSubs[0]
- [ ] C8  Clear childSubs on navigation
- [ ] C7  Replace endsWith('0002') meter heuristic with a defined check (KEY_SUFFIX.METER)
- [ ] NEW Persist active DSP (A/B) app-side as view state (default A)
HUMAN-GATE: none

### Batch 3.3 — Connect handshake + eager loader + landing  (replaces the autoLoad race)
DECISION RESOLVED (see phase3-state-model.md): land on the last-active DSP's preset, read authoritatively
from the root dump (device boots into last-used preset). Cache is a provisional structure-only pre-paint.
- [ ] C2  Remove the 500ms autoLoad race (main.js); land via rootDumpComplete -> active preset
- [ ] NEW Eager loader: traverse active preset tree (OBJECTINFO each COL + VALUE_DUMP each param), bounded by depth + visited set, completion via dumpComplete; show loading UX
- [ ] NEW `eagerLoad` config flag (default on; persisted in midiConfig) toggles eager vs lazy
- [ ] NEW Render guard enforcing the invariant: unconfirmed values render as a loading placeholder, never a stale cached number
HUMAN-GATE: needs-hardware (eager-load throughput on the real unit; offline parse/render half covered by replay harness)

### Batch 3.4 — Cycle cleanup
- [ ] C6  Move logCategories off appState so logger.js no longer imports state.js (collapses store-logger-state cycle)
HUMAN-GATE: none

### Batch 3.5 — Renderer folder-split (optional)
- [ ] (optional) Split renderer.js if judged worth it; unblocked by 0.3
HUMAN-GATE: none

---

## Phase 4 — Parser quirks & edge hardening

### Batch 4.1
- [ ] D1  Make splitLine robust to multi-word unquoted preset names (parser.js:9-33), or document + assert
- [ ] D2  Handle/define root OBJECTINFO type=8 entry (key=10040000) in parseSubObject dispatch
HUMAN-GATE: none

---

## Phase 5 — Features

### Batch 5.1 — Preset taxonomy cache
- [ ] G1  Build cache from device OBJECTINFO_DUMP fan-out at connect (not hand-curated JSON); leans on 3.1 substrate
HUMAN-GATE: none

### Batch 5.2 — HIL screenshot regression + live self-loop
- [ ] G2  Offline golden-PNG screenshot regression on the 0.4 replay harness
- [ ] G2  Live loop: drive Orville via MIDI masks -> 0x18 screengrab -> diff against golden
HUMAN-GATE: needs-decision — live drive-the-physical-machine loop held until maintainer go signal

---

## Phase 6 — Performance & fidelity validation

### Batch 6.1 — Close-out
- [ ] Measure render latency (target: ~400ms stall gone post-3.1), MIDI outbound throughput, meter-polling cost
- [ ] Validate machine fidelity end-to-end via live self-loop (if enabled)
- [ ] Final ledger sweep: every item [x]
HUMAN-GATE: none

---

## Done (verified merged — do not redo)
- A1  main.js debug-upload slice bounds — PR #24
- 8-step decoupling refactor — PR #23
