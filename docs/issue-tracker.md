# Issue Tracker — Ready-for-Prime-Time

Single source of truth for driving every logged issue to zero. This file is committed to the repo so
any session (including a freshly reset one) can resume with zero re-briefing. Full rationale and batch
design live in the plan; this file is the operational ledger.

## How to use this file

**Status legend:** `[ ]` todo · `[~]` in progress (has a one-line **NEXT:**) · `[x]` done (with PR ref).
A `[ ]` item marked **PARKED** is deliberately deferred — skip it when scanning for the next item.

**Gate tags:** `needs-hardware` = fix is coded + replay-tested but final confirmation needs the
physical Orville. `needs-decision` = a product/UX or irreversible call for the maintainer.

### Resume protocol (what a fresh session does)
1. Read this file. Find the first `[~]`, else the first `[ ]` in batch order.
2. `git status` and `git branch --show-current` to confirm working state. All work happens on a
   branch — never commit to `main`. The git repo is this `orvilleCommander/` directory.
3. Do the item's **NEXT:** action. Run `npm test` and report raw output. Add a snapshot test first if
   touching render logic.
4. Update this ledger (status + NEXT), commit (conventional-commit message, no AI-attribution, no
   emoji), push, open/append the batch PR. If the item has a matching GitHub issue, put `Closes #N`
   in the PR body so it auto-closes on merge. Spawn reviewer agents (correctness + docs) before merge.
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
- [ ] F3  PARKED (not a resume point — Phase 3 work takes precedence; the [~] NEXT item governs): major
      upgrades each on own branch, tested (Vite 8, Jest 30, archiver 8)   -> Batches 0.2a/0.2b/0.2c
- [x] F4  (branch chore/actions-node24, PR #92) Bumped ci.yml ahead of GitHub's Node-24 forced default
      (2026-06-16; Node 20 leaves runners 2026-09-16): actions/checkout v4 -> v6, actions/setup-node
      v4 -> v6 (latest majors, Node-24 runtimes — no deprecation warnings), and `node-version` 20 -> 24
      (Node 20 reached end-of-life 2026-04-30; 24 is the current LTS). CI green on the PR is the
      verification — the same lint/format/test suite now runs on Node 24.
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
      [V]/[I]/[?]. Grounded in all tests/fixtures + parser/framebuffer.
      Drives phase3-state-model.md. LIVING DOC — extend as hardware answers §12.
- [x] B10e Reconciled the spec against the official Eventide Tech Note 34 ("MIDI Sysex Messages on the
      DSP4000", URL the user supplied). Confirmed/upgraded: id=0=broadcast, MSN-first nibbling, and the
      0x17 screen header = width(u32)+height(u32)+size(u32) all nibbled + a 1-byte sum-to-zero CHECKSUM
      (verified: our fixture's header decodes to 240x64). Boundary finding: the object protocol
      (0x2d/0x2e/0x31/0x32) is NOT in TN34 — it's an undocumented Orville extension; our docs are its only
      spec. Added [D] confidence marker + a Sources section to device-model.md; updated protocol.md screen
      layout + framing notes. TN34 PDF kept locally in logs/ (gitignored; copyright) — cited by URL only.

### Device-research follow-ups (from Tech Note 34)
- [x] FB1 RESOLVED (branch fix/framebuffer-header-checksum, PR #77): parseScreenHeader() reads width/height/size from
      the three big-endian u32 header fields; computePixels derives dims from the header (fallback 240x64 if
      missing/insane); renderBitmap logs an error on truncation / checksum-mismatch / bad-dims instead of
      silently painting a partial screen. CHECKSUM ALGORITHM confirmed against a full hardware capture: the
      sum of every byte from the size field (offset 8) through the trailing checksum byte is 0 mod 256 (TN34's
      "all bytes incl. size sum to 0" = from the size field). Tests pin it against screen-dump-black-hole.txt.
- [x] FB5 RESOLVED (branch fix/hil-sysex-reassembly, PR #78): HIL screen captures were truncated. ROOT CAUSE: the
      Orville drives the U6MIDI Pro over a 31250-baud DIN link, so a ~3872-byte 0x17 dump takes ~1.2s to
      transmit and @julusian/midi (WinMM) delivers it as multiple 2048-byte buffer chunks (first chunk starts
      F0 1C 70 dev 17 with no F7; continuation chunks are raw bytes; the last ends F7). The old tool resolved
      on the first 0x17 message (the header chunk) and discarded the rest -> 2048 bytes / 1021 denibbled /
      top ~34 rows. NOT a device or
      buffer-size bug (setBufferSize proved unreliable here). FIX: hil-screenshot.cjs now reassembles chunks
      from the header chunk until F7, waits a 4s window for the slow transmission, retries on incomplete, and
      validates completeness. The five golden captures were RECAPTURED full (3872 bytes each, 1933 denibbled,
      complete && checksumOk) and re-rendered. Verified against the device. SCOPE: only hil-screenshot.cjs
      (the golden-capture path) was fixed; orville-probe.cjs's diagnostic `screen` action still keeps only the
      first chunk, which is fine for a quick diagnostic dump — fix it there too only if it ever needs full screens.
- [x] FB6 RESOLVED (branch fix/app-sysex-reassembly, PR #79): the SAME multi-packet truncation could hit the BROWSER
      APP, not just the CLI. midi.js addSysexListener handed a single WebMIDI `e.data` straight to parseResponse
      with no reassembly, so if Chrome ever delivers a long SysEx split across packets, the app would render a
      truncated screen (0x17) OR a truncated/corrupt OBJECTINFO menu (e.g. the ~70-name bank list). FIX:
      addSysexListener now buffers — starts a new buffer on F0 (SYSEX.START), appends continuation packets, and
      only calls parseResponse on the F7 terminator; a pass-through when messages already arrive complete.
      Covers every inbound SysEx type, not just the screen. Tested (complete pass-through, split reassembly,
      buffer reset on new F0, Uint8Array data). NOT yet verified whether Chrome actually chunks on this device
      (would need an in-browser test against the unit); the fix is correct either way (defensive + matches FB5).
- [x] FB7 RESOLVED (branch fix/sysex-listener-reregister, PR #88): midi.js addSysexListener now tracks the input +
      handler it attached and removes the previous 'sysex' listener (from whichever input it was on) before
      adding a new one, so repeated selectPorts runs (button + cached-config auto-run) and input switches
      can no longer stack listeners -> parseResponse fires exactly once per message and the dump-wave
      counter decrements once per response (no premature all-received). Done ahead of C1 because C1's
      dumpComplete consumers depend on accurate wave counting. Tests: re-registration replaces (not stacks)
      + input-switch detaches from the old input; both fail pre-fix (verified). midi.test mock input now
      tracks add/removeListener.
- [x] FB4 RESOLVED (branch fix/dump-watchdog-idle-reset, PR #76): the midi.js dump watchdog was a fixed 1500ms hard
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
- [x] B10g.4 HIL screenshot loop tool:
      * build_tools/hil-screenshot.cjs (npm `screenshot`): single long-lived process — opens MIDI
        once, optional `--press k1,k2`, sends 0x18, captures 0x17, saves raw fixture, renders PNG via
        render-screen.js. Implemented + lint/`node --check` clean.
      * PROVEN end-to-end live: baseline capture (A: Black Hole / space params), `--press ab`
        drive+capture (B: MetallicChamber / detune params), then restored A. Renders faithful PNGs;
        A2 bitmap fix confirmed clean on real hardware. G2 live loop works.
      * CORRECTION (maintainer-confirmed): an earlier diagnosis here blamed RDP session redirection
        for intermittent "no MIDI input devices currently available" and claimed live HIL required
        the physical console. That conclusion was wrong and has been retracted — live MIDI works
        over RDP. If the no-devices symptom recurs, re-diagnose from scratch (the prior write-up is
        in git history) rather than assuming a session-type cause.

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
- [x] C1  (branch refactor/dump-complete-render, GH #37, PR #89) Render timing is now event-driven. The substrate
      (midi.js per-wave outstanding counter + idle watchdog emitting dumpComplete; FB4) predated this batch
      and FB7 secured its exactly-once decrement; C1 is the consumer migration. event-bridge.js rebuilt:
      the per-message timer stack (RENDER_COALESCE_MS setTimeout chains + shared lodash debounce + the
      render:request indirection) is GONE; the bridge renders on two signals (a third, child-of-current-menu
      arrival, was added by R7 after live validation) — objectinfo:received
      for the CURRENT key (progressive structure paint, synchronous on arrival) and dumpComplete (settled
      paint + hideLoading; one render per wave for value-only waves like meter ticks). Renders that issue
      requests open a new wave whose drain triggers the next settled paint (converges when nothing is
      missing). RENDER_DEBOUNCE_MS/RENDER_COALESCE_MS deleted from constants.js; lodash.debounce removed
      from package.json (webmidi is now the only runtime dep). NOTE vs the original sketch: events are
      wave-level (the design said dumpComplete(key,data); lastKey rides the payload) — per-key correlation
      lands with 3.3's eager loader if needed. SIDE EFFECT (intentional, characterized): the autoload
      landing-page race (#38's bug) is ELIMINATED — the root dump now renders synchronously BEFORE
      select-ports-init flips autoLoad, so the flag is consumed by the PRESET render and startup lands on
      the preset's first menu (the intended landing). #38/C2 stays OPEN: the PORT_INIT_MS timer and the
      autoLoad flag mechanism remain in main.js — C1 removed the wrong-landing symptom, not the timer-driven
      flow; landing explicitly via the root dump is still 3.3's work. startup.test rewritten per its charter
      to pin the race-free flow end-to-end (root render -> preset render -> autoload descend -> landed-menu
      render -> settled dumpComplete render + hideLoading). Renderer's MIDI_SETTLE/PROGRAM_SET/DEVICE_LOAD chains
      KEPT: they are outbound device-settle pacing (when to re-request after a PUT/load), not render
      coalescing — replacing the load flow is 3.3's C2 (rootDumpComplete landing). New
      tests/event-bridge.test.js pins the bridge contract; full design in
      docs/refactor/phase3-state-model.md "Implementation notes — 3.1 as built".
      REVIEW ADDENDUM (correctness reviewer, both fixed in-branch): (1) the NUM refetch predicate was
      falsy-based, so a confirmed-empty VALUE ('' — legal per device-model §6) would have become an
      UNTHROTTLED infinite request loop once the timer throttle was gone; the three NUM sites now check
      === undefined (matching SET/INF) and a renderer test pins no-refetch-on-empty. (2) hideLoading on
      every dumpComplete let value-only meter-poll waves (every METER_POLL_MS) clear the loading
      indicator mid-navigation; midi.js now counts OBJECTINFO sends per wave (payload.objectinfoSends)
      and the bridge hides loading only on structure waves or watchdog stalls.
- [x] NEW (C1 review, GH #107; branch fix/poll-wave-gate) Wave-saturation smoke RUN + SATURATION FIXED.
      The hypothesis was real and worse: 3min of meter polling + a 0x18 every 2s measured 44% watchdog
      ratio (criterion >5%), waves merged to the 10s WATCHDOG_MAX_MS ceiling, settled renders frozen
      for the duration. Five defect classes isolated by iterating the live smoke
      (build_tools/live-app.mjs smoke mode; logs/live-smoke-107*.log):
      (1) poll ticks joined waves faster than the link drains -> ticks now SKIP while a wave is open
      (midi.js isWaveOpen; the ledger's own named fix);
      (2) GET_SCREEN was not wave-counted -> its ~1.2s 0x17 transfer was invisible link time that
      watchdogged poll ticks; now counted (parser 0x17 notifyResponse);
      (3) the idle watchdog rearmed only on complete parsed messages -> a STREAMING bitmap's partial
      packets read as silence; now rearms on every raw inbound packet (it is a silence detector);
      (4) the device DROPS requests that collide with its own bitmap transmission (send=7 recv=4
      waves riding to the 10s cap) -> GET_SCREEN now defers + coalesces while a wave is open and
      fires on the drain (R5's "serialize bitmap requests after waves");
      (5) NUM value fetches lacked the !s.value guard SET/INF/STR always had -> every settled render
      resent dump-valued NUMs and each solo wave's watchdog render resent again (self-perpetuating
      refetch loop); NUM/graphic-EQ now follow the same rule (dump value suffices; per-visit menu
      refetch covers freshness, same as SET).
      ACCEPTANCE (2026-06-10, logs/live-smoke-107h.log): 168 waves/180s, watchdog 3.57% (<5%), avg
      wave 1037ms, max 4146ms — vs baseline 36 waves, 44%, max 10021ms. The residual watchdogs are
      isolated slow device responses, no systemic class. All five fixes test-pinned (152 suite).
- [x] NEW (C1 review, minor) RESOLVED BY C2: the autoload branch is deleted, so a watchdog-stall render can
      no longer descend from stale subs; the bridge additionally clears any pending landing/descend
      one-shot on a watchdog dumpComplete (pinned by event-bridge tests).
- [x] C4  (same branch, GH #40, PR #89) isLoadingPreset deleted: store default, both renderer writes, and the
      event-bridge gating/clear are gone — hideLoading is driven solely by dumpComplete. The parser's
      Favorites re-order fix now gates on loadingPresetName alone; FINDING: no production code writes
      loadingPresetName (pre-existing — the path was already unreachable live since the gate required both),
      so the Favorites fix is characterization-only until a writer exists. startup.test Tier A/B updated.
HUMAN-GATE: none

### Batch 3.2 — State-shape hardening
- [x] C3  (branch refactor/keystack-normalize, GH #39, PR #87) Normalized keyStack to always-objects: every entry is
      {key, tag, subs}, built by the new navigation.js makeKeyStackEntry(key, subs) (superseded by T1b/#105:
      entries are now built by tree.js deriveKeyStack — the {key, tag, subs} shape is unchanged) (tag derived the way the
      renderer always derived parent tags — sub tag, else first statement word — falling back to the key
      when subs aren't loaded). All five push sites converted: renderer dsp-toggle/softkey-descend/
      autoload-descend (autoload keeps the C5 sourcing from the render's `subs` param), controls.js
      parameter-nav and main.js select-ports-init (the two former raw-string '0' pushes). FIXES the latent
      length-1-stack bugs those strings caused: "[undefined]" breadcrumb + back-link to key undefined on the
      first preset render after parameter-nav/connect, and a TypeError in the sibling-softkey check
      (parentEntry.subs.some on undefined) when a preset top menu has params (no autoload re-push).
      startup.test's mixed-types known-bug pin updated to assert the normalized shape (header note marked
      RESOLVED); controls.test asserts the normalized entry (fails pre-C3); new tests/navigation.test.js
      covers the helper; new renderer test pins the real breadcrumb + working back-link. 111 tests / 13
      suites green; snapshots unchanged (10). REVIEW ADDENDUM: a third (desirable) behavior change — a
      depth-1 leaf menu now falls back to the root entry's tagged COLs as its softkey row (the raw-string
      entry used to yield none) — pinned by an added renderer assertion; clicking the highlighted current
      softkey can now self-push at depth 1 (pre-existing flaw at depth >=2, reach widened; logged as the
      item below).
- [x] NEW (from C3 review; branch fix/softkey-self-push) Softkey re-click of the CURRENT menu used to
      self-push a duplicate keyStack entry (descend branch did not skip newKey === currentKey) and render
      the menu "inside itself". The softkey handler now no-ops on the current key before either branch
      (also skips the pointless refetch). Renderer test pins no-self-push/no-refetch; fails pre-fix
      (verified).
- [x] C5  (branch fix/autoload-subs-param, GH #41, PR #82) renderer autoload-descend now sources the keyStack parent
      entry from the `subs` param it was invoked with, not the global appState.currentSubs. NOTE (from review):
      renderScreen re-pins currentSubs=subs at its top (render-pin), so global==param today and this was NOT an
      observable bug — the fix is correct-by-construction / defensive (robust if the pin is ever moved/removed).
      currentKey stays global (it is the loaded key, distinct from subs[0]; startup.test pins this). New
      renderer.test forces a divergent stale global (no-op setter) to prove the descend reads the param —
      verified fail-on-old / pass-on-fix. RESIDUAL (minor, follow-up): the entry's `key` still reads the global
      appState.currentKey, the same staleness class, but no param carries the loaded key.
- [x] C8  (branch fix/childsubs-nav-clear, GH #44, PR #85) FINDING: the filed premise ("some nav paths bypass the
      clear") no longer holds — every nav path (LCD clicks, keypress controls, sync, connect, polling)
      funnels through updateScreen(), which clears childSubs+currentValues unconditionally and predates the
      refactor (superseded by T1b/#105: childSubs is deleted, updateScreen clears only currentValues, and
      the parser guard below is now tree parentage — parentOf(key) === currentKey). Cross-menu stale stores were also already blocked by the parser guard, but only implicitly
      (a child entry's parent always equals the dump's main key, so the membership check can only pass when
      currentSubs IS currentKey's dump). Shipped: removed the three redundant childSubs:{} patches in the
      renderer click handlers (updateScreen documented as the single clear point); made the parser guard's
      consistency precondition explicit (currentSubs[0].key === currentKey — fail-closed for late dumps
      after navigation; new test proven fail-on-old); pinned the clear with stale-seeded childSubs across
      descend/sibling/back paths (the pre-existing DSP-toggle test also asserts childSubs is empty after
      nav, but starts from empty childSubs, so that path alone would not catch a clear regression);
      documented the main-line PARENT self-echo in device-model.md §3 (a dump cannot self-identify
      its parent — verified across all 8 OBJECTINFO fixtures). RESIDUAL (defer to C1): a VALID child dump
      can be dropped if a stale re-render re-pins currentSubs before it lands — harmless (next updateScreen
      refetch self-heals); request-correlated dumpComplete events are the real fix.
- [x] C7  (branch refactor/meter-con-type-check, GH #43, PR #86) Replaced the endsWith('0002') meter heuristic with
      a type-based check: a VALUE_DUMP takes the CON immediate-render path iff the loaded subs type the key
      CON — looked up in currentSubs or any stored childSubs (since T1b/#105: tree.js findParamUnder)
      (the type comes from OBJECTINFO; non-CON child
      params keep their separate immediate fallback). Behavior change confined to 0002-suffixed keys that
      are neither typed CON in a loaded dump nor stored child params — chiefly keys absent from every
      loaded dump, which now coalesce (an unknown key has no on-screen line an immediate render could
      update, and menu keys can end 0002 too — the snapshot suite itself uses 10010002 as a COL key), plus
      the narrow case of a top-level non-CON key ending 0002, which now coalesces with its menu instead of
      rendering immediately on the suffix alone. Loaded meters keep identical behavior: top-level CONs hit
      the CON branch as before; child-menu CONs were already immediate via the child-param fallback and now
      classify as CON proper. KEY_SUFFIX.METER removed from sysex-commands.js (the suffix no longer drives
      logic); the observed 0002 naming convention stays documented in device-model.md §4/§5 (downgraded to
      [I]: naming convention, not a type guarantee) and protocol.md. Tests: child-CON immediate +
      unknown-key coalesce pinned (the latter fails pre-C7). VALUE_DUMP-coverage precondition was met by
      Batch 0.3's 0x2e characterization.
- [x] NEW Persist active DSP (A/B) app-side as view state (default A) — SHIPPED WITH C2 (Batch 3.3): the
      landing chooses the root dump's dspAKey/dspBKey by the persisted presetKey's A/B prefix (the cached
      key itself is only a hint; store default presetKey is the A preset).
HUMAN-GATE: none

### Batch 3.3 — Connect handshake + eager loader + landing  (replaces the autoLoad timer mechanism)
DECISION RESOLVED (see phase3-state-model.md): land on the last-active DSP's preset, read authoritatively
from the root dump (device boots into last-used preset). Cache is a provisional structure-only pre-paint.
- [x] C2  (branch refactor/c2-landing, GH #38, PR #94) Implemented per phase3-state-model.md "C2 design": the
      PORT_INIT_MS timer and the sticky autoLoad flag are DELETED. selectPorts resets the view to root
      (re-runnable: forces the parser's full root branch on reconnect) and arms a one-shot
      pendingLanding='root'; the bridge lands when the root dump ARRIVES — keyStack root entry,
      currentKey -> the dump's authoritative dspA/dspBKey (A/B chosen by the persisted presetKey prefix,
      folding in 3.2's persist-active-DSP), other-DSP prefetch + optional 0x18 — then a one-shot
      pendingDescend, consumed by the dump for the navigated-to menu, descends once into a COL-only
      menu's first child (old autoload semantics, but never triggerable by a stale render — retires the
      C5/#41 staleness class; that defensive test removed with the branch it guarded). All six former
      autoLoad writers migrated (4 renderer click handlers, controls PARAMETER keypress, store default);
      renderer's autoload branch deleted; PARAM_TYPES extracted to sysex-commands.js. Watchdog clears
      pending one-shots (no stale landing/descend; closes the Batch 3.1 watchdog-mid-nav item). Startup
      characterization rewritten per its charter — the simulation now mirrors only the reset, with
      landing + descend exercised through the real bridge. 126 tests / 14 suites green. Hardware
      validation deferred to the consolidated session after 3.3 (landing timing on the real link +
      wave-saturation smoke + eager-load throughput).
MAINTAINER DIRECTIVE (2026-06-10, governs the rest of Phase 3): "we should be rendering what exists in
a tree... make sure we have good tree navigation since we are navigating a tree of states from the
unit" — not one-off handler fixes. R1/R2/R6 were symptoms of view state assembled from click history
and arrival races; the cure is view DERIVED from the device tree.
- [x] T1  (GH #105 for the (b) half; closed) Tree audit + tree-derived navigation (the maintainer's audit ask: "render the html and audit
      whether we have odd behavior that doesn't get us the full state of a tree and its leaves").
      (a) DONE — TREE AUDITOR SHIPPED: build_tools/tree-audit.mjs (npm run tree-audit) on the headless
      harness build_tools/live-app.mjs (both promoted from prototypes). Phase 1 fetches the ground-truth
      tree raw (sequential OBJECTINFO, one in flight); phase 2 navigates the real app to every COL node
      with TREE-COMPUTED ancestors and diffs the DOM against the node's dump (child reachability, params
      rendered exactly once, duplicate softkeys, breadcrumb vs tree parent), draining the link between
      nodes so backlog can't starve the next audit. Detector exceptions: blank spacers skipped;
      pure-format INFs match on value; bar CONs match on tag. FIRST FULL RUN (depth 2, 42 nodes,
      41 audited): 4 violations, all real, 0 false positives -> R8 + R9 below. Report:
      logs/tree-audit-report.json (gitignored; rerun to regenerate).
      (b) SHIPPED (PR #109, squash-merged to main 2026-06-10 with maintainer approval after the
      device-on acceptance run): src/tree.js persistent tree (recordDump on EVERY 0x32; parents map
      from the parent's dump — a dump cannot self-identify its parent, device-model §3). keyStack is
      now DERIVED (tree.js:deriveKeyStack from tree ancestry, canonical {key, tag, subs} entries) at
      every navigation site (renderer x4, bridge landing/descend, controls parameter-nav, main sync +
      t_rate debug; ONE deliberate exception — the static bottom-row jump keeps its R2 stack RESET,
      since the bottom row is itself the root affordance and a derived [root] entry would re-render
      root's children above the identical static row); childSubs
      DELETED from appState (embeds/param lookups read getNode/findParamUnder); parser fan-out widened
      short-tag -> ALL COLs (presets still excluded at root); C8 correlation guard replaced by tree
      parentage (parentOf === currentKey); R6 renderer embed prefetch deleted (fan-out covers it);
      navigation.js makeKeyStackEntry + softkeyLabel deleted -> tree.js labelFor/labelForSub (every
      COL child gets a softkey affordance; blank nodes label from first labeled child per the
      physical SETUP precedent — 100100d0 shows 'dsp B'-derived label — else '...' placeholder, so
      'unreachable-child' is structurally impossible). Renderer snapshots byte-identical (render
      preservation proof); replay snapshot updated intentionally (100100d0 now reachable — the
      board's last violation). Auditor updated: phase 2 uses the production deriveKeyStack (app tree
      seeded with phase-1 dumps), embed check reads getNode. ACCEPTANCE PASSED (device-on,
      2026-06-10): npm run tree-audit depth 2 at STOCK DEFAULTS — 42 nodes fetched, 41 COL nodes
      audited, ZERO violations. (A first run flagged one spurious no-render at 10030000: the old
      fixed 15s wall-clock settle cap expired while the link was still draining the program
      subtree's bank-list backlog — the R5 congestion class, not a reachability bug. Fixed
      structurally in the auditor: settling is now bounded by link IDLENESS — while messages keep
      arriving the window stays open; give up only after 8s of total silence without the node
      pinning (GIVE_UP_IDLE_MS), with capMs demoted to a 120s runaway ceiling. Verified: defaults
      now pass clean, no hand-tuned caps.) The auditor stays the standing regression loop (merges
      with G2). App-side request scheduling for the backlog itself stays with #106 (R5's data
      feeds it).
- [x] R8  (branch feat/str-rendering) STR string-edit fields RENDERED + EDITABLE: put semantics
      confirmed live first (put 10020052 'TestName' -> 0x2e echo + readback; restored after). Renderer
      STR branches (top-level + embedded child): formatted value as a clickable param-value; click
      prompts for free text and PUTs the string (mirrors the NUM edit flow). STR added to PARAM_TYPES
      (descend predicate counts it). ACCEPTANCE: tree audit rerun — both STR param-missing violations
      GONE; the board is down to ONE violation (the fully-blank 100100d0 label policy, T1b).
      HARDWARE QUESTIONS RESOLVED (probed live, same session): multi-word puts WORK — put 'Two Words'
      echoed "10020052 'Two Words'" (the device quotes multi-word values in the dump, so splitLine
      readback is safe end to end); empty-string puts are IGNORED by the device (value unchanged), so
      the handler's empty-rejection matches hardware semantics exactly. The handler also rejects
      non-ASCII (7-bit SysEx) and clamps to the declared field width.
- [x] R9  (branch fix/empty-tag-softkey-labels) Empty-tag children UNREACHABLE — FIXED with derived
      labels: probing showed 10030601 is position 'c' (a new position code, like 'e'), so it was never
      an embed candidate, and the tag-only softkey filter dropped it; its children (the per-output gain
      NUM pages, 1003006b/1003006c) were unreachable — the maintainer's missing level params. PHYSICAL
      GROUND TRUTH: the LEVELS and SETUP screens both show these pages as softkeys (the device derives
      labels). New navigation.js:softkeyLabel — tag, else first statement word ('Post D/A Gain' ->
      'Post'); used by the renderer's softkey filters/labels, the bridge descend predicate, the parser
      fan-out (lockstep: prefetch = navigability), and the fixture helper (Option B expectations track
      the rule). (Superseded by T1b/#105: softkeyLabel deleted — labels via tree.js labelFor/labelForSub,
      the filters/predicates/fan-out no longer gate on labels, and root's fan-out excludes the presets.)
      Side effect at the time: root's fan-out also prefetched the two presets (statement-labeled).
      ACCEPTANCE: tree audit rerun — the 10030601 violation is GONE (4 -> 3 violations). RESIDUAL:
      fully-blank nodes (setup's 100100d0 — statement AND tag empty, children are DSP A/B i/p routing)
      stay unlabeled and audit-flagged; label policy (derive from children? device shows 'dsp B') is a
      T1b question. Position 'c' added to device-model §3.
- [x] NEW (GH #106) (branch feat/eager-loader) Eager loader SHIPPED as a serialized STRUCTURE walk:
      src/eager-loader.js traverses the active preset tree breadth-first (OBJECTINFO each COL),
      bounded by EAGER.MAX_DEPTH=3 + a visited set, exactly ONE request in flight — the
      R5-constrained scheduling. ADVANCE SIGNAL (review blocker, fixed): the parser emits
      objectinfo:received only for on-screen-related keys, so background fetches are silently
      tree-recorded; the loader therefore advances at WAVE BOUNDARIES — every dumpComplete is a
      decision point: tree knows the pending node (even after a watchdog — late response behind a
      bitmap, R5a) -> advance + enqueue children; tree doesn't -> the response is not coming, skip.
      events.js emit hardened to snapshot iteration so the walk's own just-added listener never
      receives the in-flight dumpComplete that started it (walk token guards the removal flip side).
      Cached nodes cost no request, so the parser's per-menu fan-out (depth 1) is never duplicated:
      the bridge arms the load at the C2 landing and starts it on the first CLEAN drain after it
      (live finding: with fetchBitmap on the landing wave routinely watchdogs on the ~1.2s bitmap
      transfer, R5a — the arm survives stalls and fires on the self-healed next wave).
      DEVIATION (decided with T1b in place): VALUE_DUMP prefetch dropped — currentValues is
      per-visit volatile by design (updateScreen clears it, C8), so eager values would be discarded
      unseen; structure is the durable half and is what R3 pre-paints. No loading UX: the walk is
      background traffic behind the connect overlay the landing already shows.
      LIVE ACCEPTANCE (2026-06-10): production trigger (logs/live-eager-acceptance2.log) — armed
      through the R5a stall (watchdog send=21 recv=13), started on the next clean drain, 4 nodes
      walked 0 fetched (fan-out had cached the shallow Black Hole subtree — zero duplicate
      requests), warmth 3/3 children; cold-click pre-paint then served structure from cache
      mid-flight. STRESS (forced deep walk from ROOT, logs/live-eager-acceptance4.log — not a
      production path): 75 nodes walked, 79 fetched, self-terminated cleanly in ~37s; slow program
      dumps outlast the 1.5s wave watchdog and the backlog cascades, so misses RETRY ONCE at the
      queue tail (usually free — the late response is tree-recorded by then); 6 nodes whose retry
      also raced the backlog stayed un-walked (their own late dumps still land in the tree; only
      their children go unwalked — per-visit refetch covers correctness). KNOWN LIMIT, acceptable:
      the production trigger walks only the preset subtree, where dumps are small and the cascade
      does not occur; revisit pacing only if a root-wide eager walk ever ships (G2 idea). Startup
      Tier A pins the one-in-flight scheduling; 8 unit tests cover
      skip/serial/depth/watchdog-advance/retry/dead-node/supersede/stop.
- [x] NEW (GH #106) (same branch) `eagerLoad` config flag: persisted in midiConfig (default on,
      pre-#106 caches stay eager), checkbox in index.html, appState.eagerLoad gates the bridge arm.
- [x] NEW (GH #106) Render guard enforcing the invariant: unconfirmed values render as a loading placeholder, never a stale cached number — shipped with R3 below (branch fix/r3-render-guard)
HUMAN-GATE: none remaining (eager-load throughput validated live 2026-06-10)

### Batch 3.3b — Live-loop findings (headless live session, 2026-06-09; maintainer-confirmed symptoms)
Discovered by running the REAL app module graph headless (jsdom + @julusian/midi adapters feeding the
real parser/bridge/renderer) against the powered Orville — no browser. Harness prototype:
logs/live-app.mjs (gitignored); promote to build_tools/ as part of G2. Physical ground-truth captures
in logs/ (program-screen.png).
- [x] R1  (branch fix/softkey-position-filter) CRITICAL UX FIXED (maintainer: "can't set the machine's
      program"): deleted the holdover that dropped ALL position-0 COL children from the softkey row
      whenever the menu had any param — 'program functions' (one TRG + 8 position-0 COLs) rendered with
      no access to its own children. The embed flow's own embeddedKey filter is the only exclusion needed.
      VERIFIED LIVE with the headless harness: program menu now shows load/save/update/card/delete/
      savebank/del bank/link (matching the physical PROGRAM screen capture), and descending into 'load
      new preset' renders BOTH SET dropdowns (70 banks / 28 programs) + the load-into-A/B TRGs — the
      full program-set UI works end to end on hardware. Renderer test pins the shape (fails pre-fix);
      no existing snapshot changed (none covered the mixed shape).
- [x] R2  (branch fix/deterministic-embed-root-jump) Duplicate softkey row sets FIXED: the static bottom
      root softkeys now JUMP — reset the keyStack — instead of descending (which grew the stack without
      bound, 2 -> 6 in one walk, and rendered the previous menu's COL row set twice). pendingDescend
      stays set on the jump (matches the front panel: function keys land on a parameter page, not a bare
      listing). NOTE (review): after a jump the root view has no breadcrumb — root is reachable via
      Sync/reconnect and everything it offers stays docked (A/B tabs + static row); revisit if root
      needs a first-class affordance. Test pins jump-resets-stack (fails pre-fix).
- [x] R6  (same branch; maintainer screenshots) NONDETERMINISTIC EMBED FIXED: the embed loop took
      whichever position-0 child's dump had arrived first — on 'program functions' the first child's
      response (the giant bank list) is slowest, so 'link program' won the race and the embedded UI
      varied run to run (sometimes nothing, sometimes the wrong child's selectors). Only the FIRST
      position-0 child in subs order may embed now (the physical PROGRAM page shows 'load new preset' as
      the menu's default view); while its dump is in flight the children stay navigable softkeys (R1).
      Review hardening: the embed prefetch fires only when the parser's short-tag fan-out will NOT fetch
      the candidate (long/empty tag) — the unconditional version duplicated the heaviest dump on the
      wire once per navigation (prefetch since deleted by T1b/#105 — the all-COL fan-out covers it).
      Two-phase test pins arrival-order independence (fails pre-fix).
- [x] R7  (branch fix/render-on-child-arrival; maintainer live repro "not seeing the embed until I
      navigate elsewhere and come back") MISSING RENDER TRIGGER FIXED: C1's bridge rendered only on the
      current menu's own dump and on wave end — a slow CHILD dump (the multi-second bank list the
      program menu embeds) lands after the wave has watchdogged and settled, so nothing ever repainted.
      Third trigger added: objectinfo:received for a key present in childSubs (the C8 guard guarantees
      it belongs to the on-screen menu; condition since T1b/#105: tree parentage, parentOf(key) ===
      currentKey) repaints. The embed now appears the moment its data arrives.
      Bridge test pins it (fails pre-fix).
- [x] R3  (branch fix/r3-render-guard; the GH #106 render-guard half) Stale-menu render FIXED: clicking a
      menu rendered the OLD menu under the NEW key (wrong title and breadcrumb, e.g. "[program]
      program functions" while currentKey=10030000) until the new dump landed — seconds on a backed-up
      link. renderScreen now guards: when subs[0].key !== currentKey it never paints those subs;
      instead it PRE-PAINTS the tree's cached structure for the navigated-to key (params as inert
      placeholder lines — format specifiers -> '...', no clickables, no value refetches; COL children
      stay live softkeys; embeds deferred to the real render), or an honest 'loading ...' title when
      the tree has never seen the key. The pre-paint pass writes NO state (currentSubs/currentSoftkeys
      pins stay device-confirmed — also keeps the tree-audit settle honest: it waits for the real
      dump, never a cache paint). Renderer tests pin both guard paths (fail pre-fix); snapshots
      unchanged. The eager loader + eagerLoad flag remain the open #106 half.
- [x] R4  NEW PROTOCOL TYPE observed live: `STR` (string-edit field) — `STR 0 10020052 10020050
      name:%-22s name Favorites` under 'save bank'. SPEC HALF DONE: device-model §3 TYPE table documents
      STR (shipped with the T1a harness PR). The rendering half is R8 below.
- [x] R5  ABSORBED (data item, purpose fulfilled): link-contention measurements that constrained the
      #106 eager-loader scheduling (one request in flight, start after the landing drain, arm
      survives the R5a stall) — shipped in PR #112. The data, kept for reference: (a) a 0x18 bitmap
      fetch mid-wave stalls the wave past WATCHDOG_IDLE_MS (observed watchdog dumpComplete send=21
      recv=13 dur=2489ms at connect with fetchBitmap on) — bitmap transfer is ~1.2s of link time;
      (b) the parser's unbounded child fan-out on menu entry is expensive — 'program functions'
      prefetches 9 children including 'load new preset', whose response (the ~70-bank + ~28-program
      SETs) monopolizes the link for seconds and starves subsequent navigation (watchdog send=2
      recv=0). System self-heals in all observed cases (next wave drains all-received). The (b)
      per-visit-refetch cost is now the subject of #113 below (program-subtree caching).
- [x] NEW (GH #113) (branch feat/program-subtree-cache) Program-subtree caching SHIPPED
      (maintainer report, 2026-06-10 hands-on: "loading program takes a ton of time... only a
      handful of actions can cause a change to program"). Stable-subtree freshness policy
      (design: phase3-state-model.md "Stable-subtree caching"): CACHE.STABLE_SUBTREE_PREFIXES
      (program prefix 10020) — the parser's per-visit child fan-out skips the STRUCTURE refetch
      for tree.js isFresh() children; the visited menu's OWN dump always refetches, and a skipped
      child's PARAM VALUES still refresh (small VALUE requests over its cached lines), so value
      volatility holds on the warm path — only the heavy OBJECTINFO option lists are trusted.
      Staleness is PER-KEY (review-hardened): marking stales every cached key under the prefix;
      a key is fresh again only when recordDump re-records IT — drop-tolerant (a lost refetch
      response leaves the key stale and the next visit retries) and launder-proof by construction.
      Invalidation chokepoints: sendValuePut (TRG/STR/SET/NUM puts incl. bank selects, which
      change the device's program list) + sendKeypress (virtual front-panel keys drive the real
      device UI — any press may be a mutating sequence) + Sync/selectPorts markAllStableDirty
      (device-side mutations the app cannot observe: physical panel, card swap, external MIDI
      program changes). FUTURE HOOK: the device's uncaptured bank-change SysEx (§12) would give
      automatic invalidation. RESIDUAL (GH #121, low): an in-flight dump racing a mutating put can
      record pre-mutation structure as fresh — FIXED (branch fix/stale-mark-generation): mutation
      marks bump a generation; sendObjectInfoDump stamps each stable-key request with the
      generation at request time; recordDump trusts the response only when the stamp is current
      (else recorded — newest data for labels/embeds — but kept stale, so the next visit
      refetches). Generation 0 trusts unstamped records (seeding/cold caches: nothing can predate
      a mutation that never happened). Both race variants test-pinned; warm-path skip re-verified
      live (logs/live-prog-121.log).
      LIVE ACCEPTANCE (2026-06-10, logs/live-prog-113b.log, live-app 'prog' mode): COLD visit
      (stale = pre-#113 behavior) 17 waves / 41 sends / settled 17919ms; WARM visit 1 wave /
      27 sends (1 objectinfo + the small per-param VALUE refreshes) / settled 646ms — ~28x,
      embeds render identically from cache. Tree audit: zero violations. 7 new tests (per-key
      freshness semantics incl. re-record-only un-staling, parser skip + value-refresh +
      stale-retry-until-rerecord + non-stable scope, sendValuePut + sendKeypress chokepoints).
      Original report context:
      every visit re-fans-out all 8 program children incl. the bank-list dump (multi-second on the
      31250-baud link) even though the tree already holds them — structure renders from cache
      (T1b/R3) but the refetch wave keeps the loading state + link busy. Design sketch (in the GH
      issue): per-subtree freshness policy — skip fan-out OBJECTINFO for tree-cached children of
      the STABLE program subtree (values stay per-visit); invalidate on the enumerable mutating
      actions (save/delete program/bank, card ops, link, STR name edits — TRG/STR puts under
      10020xxx); known gap: front-panel changes outside the app (mitigate via Sync button /
      reconnect refetch). Possibly also clear hideLoading earlier when content is cache-served.
- [x] R10 (GH #116; branch fix/con-format-in-tag) CON DISPLAY SEMANTICS FIXED + §12 'CON range'
      RESOLVED (live probe 2026-06-10): CON values arrive in DISPLAY units, not 0-1 fractions —
      assign/MIDI monitors 0-100 against '%%' formats, file sizes raw bytes, sample rate Hz — and
      the format spec may live in the TAG when the statement is blank (pedal monitors: '' +
      '%2.1f%%'). Two renderer bugs fell out of the old assumptions: format-in-tag CONs went down
      the bar path (literal '%2.1f%%' as label + pegged-full bar from 70.7 clamped into 0-1), and
      the *100 'percent inflation' rendered 'monitor = 10003.00%'. Fix in both CON render sites
      (top-level + embed): format detection falls back to the tag; *100 deleted; bar path remains
      for spec-less indicator CONs only (Tempo 'Beat'). Review hardening: '%%' now collapses to '%'
      via FORMAT_SPEC_RE's leading alternative on EVERY param path — the live LCD used to show
      'mod rate :  60 %%' because only the CON branch collapsed post-hoc; CON format detection uses
      the tight CON_FORMAT_RE (a literal '%' can't be misread as a format). Audit detector: format-
      only CONs are checked against a PATTERN derived from their format (specs -> a number) instead
      of skipped blind, so total disappearance still flags. device-model §3 + §12 updated; CON
      snapshot input corrected to display units. NOTE: audio LEVEL meters are NOT tree CONs (device draws them
      into the LCD framebuffer; bitmap path only — probed to depth 3).
NOTE: C2 landing validated LIVE end to end on this session: root dump -> landing -> descend ->
'space parameters' with values matching the physical LCD capture (logs/hil-shot.png). Perf reported
good by the maintainer. The B10g.3 §12 item "CON range" RESOLVED by R10 above.
HUMAN-GATE: none (all reproducible offline or with the harness)

### Batch 3.4 — Cycle cleanup   [branch: refactor/logcategories-off-appstate]  (GH #42)
- [x] C6  (PR #81) Moved logLevel + logCategories off appState into logger.js (its own module state, defaults from
      constants.DEFAULT_LOG_CATEGORIES). logger.js no longer imports state.js -> the store->logger->state->store
      cycle is collapsed. parser.js bitmap-log guard dropped (log() gates the category itself); main.js sets log
      prefs via setLogLevel/setLogCategories at boot + save; config @example updated. Tests updated (replay,
      startup). 92 green, lint+format clean.
HUMAN-GATE: none

### Batch 3.5 — Renderer folder-split (optional)
- [ ] (optional) Split renderer.js if judged worth it; unblocked by 0.3
HUMAN-GATE: none

---

## Phase 4 — Parser quirks & edge hardening

### Batch 4.1   [branch: fix/parser-hardening-d1-d2]
- [x] D1  (GH #118) RESOLVED as document + assert — the invariant is PROVEN, not patched around:
      the device quotes any value containing a space, and quotes empty values ('Black Hole'
      quoted, MetallicChamber bare, '' for blank tags; verified across all 52 captured fixture
      lines and hardware multi-word STR-put echoes #104), so positional splitLine parsing is safe.
      ASSERT: parseSubObject gains a field-shift canary — a COL line's trailing field is its HEX
      child count on every observed line (e.g. setup's 'f' = 15, a discovery of this batch), so a
      non-hex OR MISSING token there logs loudly (review hardening: the empty case catches the
      two-word-name + quoted-empty-tag shift, the exact 'Black Hole' shape D1 is about). HONEST
      SCOPE (review): the canary detects COL-line breaks only — a break confined to a param line
      is not detected. device-model line-grammar + §8 updated; tests pin quoted/bare parsing, the
      real 'f' count passing, and the canary firing on both shifted shapes.
- [x] D2  (GH #119) RESOLVED with live evidence: probed 10040000 directly — its OBJECTINFO returns
      only its own line (8 0 10040000 10040000 '' '': no children, no count field) and its VALUE
      returns empty. Type 8 = an empty/reserved leaf; render-skip is correct and now DEFINED:
      sysex-commands.js TYPE_EMPTY names it with the probe evidence, and every ad-hoc '8' literal
      (renderer pre-paint, parser warm-path value filter, audit detector, fixture helper) now
      references the constant. The '8' lines stay in subs (subsCount semantics unchanged).
      device-model §8 type-8 entry updated with the probe.
HUMAN-GATE: none

---

## Phase 5 — Features

### Batch 5.1 — Preset taxonomy cache
- [x] G1  SUPERSEDED by the T1b tree (#105) + eager loader (#106): the persistent tree IS the
      device-built cache (recordDump on every OBJECTINFO; eager loader warms the active preset
      subtree at connect; no hand-curated JSON anywhere). Smarter retention policy continues as
      #113 (program-subtree caching).
HUMAN-GATE: none

### Batch 5.2 — HIL screenshot regression + live self-loop   (GH #45)
- [x] G2a (branch feat/golden-screen-regression) Offline golden screenshot regression SHIPPED:
      tests/screen-golden.test.js decodes each captured 0x17 fixture (denibble -> parseScreenHeader
      integrity -> computePixels) and compares PIXEL-EXACT against the 5 hardware-captured golden
      PNGs (tests/fixtures/golden/, physical Orville 2026-06-08). Comparison is pixel-level, not
      PNG-byte-level — deflate output is not stable across Node/zlib versions. The PNG codec is
      extracted to build_tools/png-codec.js (encode + a strict subset decoder that throws on
      foreign shapes), shared by render-screen.js (verified: refactored CLI output byte-identical
      to the committed goldens) and the test. Fail-on-mutation verified (a flipped pixel-data byte
      fails exactly that screen, with a pixel-coordinate error message + regeneration pointer;
      chunk CRCs are deliberately not validated — pixels are the contract).
- [ ] G2b Live loop: drive Orville via MIDI masks -> 0x18 screengrab -> diff against golden.
      Substrate already shipped: build_tools/live-app.mjs (real app headless against the device,
      walk/load/eager/smoke/prog modes) + tree-audit (per-node DOM diffing) + hil-screenshot.cjs
      (capture). What remains is the drive-grab-diff loop itself.
HUMAN-GATE: needs-decision — live drive-the-physical-machine loop (G2b) held until maintainer go signal

### Batch 5.3 — Small UX fixes (legacy GH issues)   [branch: fix/small-ux-3-48]
- [x] GH #3  Loading indicator for bitmap fetches: the Get Screen button now shows the loading
      overlay, and the bridge's hideLoading gate accepts SCREEN waves (per-kind wave accounting:
      recordRequest kinds objectinfo/value/screen; payload gains screenSends) — the multi-second
      0x17 transfer clears its own spinner on drain. Value-only meter-poll waves still cannot
      clear an unrelated loading state (C1 semantics preserved, test-pinned).
- [x] GH #48 Settings checkboxes (fetch-bitmap, update-bitmap-on-change, eager-load) sync to
      appState LIVE via change listeners — previously boot-init-only, so a mid-session toggle was
      a silent no-op until Save Config + reload (the defect characterized in the #48 status
      comment). Persistence still requires Save Config, as before.
- [x] GH #47 (branch fix/inbound-length-validation-2, stacked on the #3/#48 branch) Inbound frame
      validation at the boundary: midi.js inboundFrameError rejects — with a logged reason —
      before parseResponse sees the bytes: non-Eventide manufacturer/product bytes (previously
      NEVER checked; a foreign device sharing the port could half-parse — rejected at debug
      severity, not error: sharing a port is not a malfunction), empty 0x32/0x2e payloads, and
      0x17 dumps with odd nibble counts or shorter than the 12-byte header (so parseScreenHeader
      cannot read garbage). Device-id matching stays in the parser (it ADOPTS the id when
      configured 0); unknown commands pass through (rejecting would outlaw discovery captures).
      A rejected frame never reaches notifyResponse — the wave watchdog self-heals. The FB6/FB7
      reassembly was the other half of the original #47 scope, long shipped.
HUMAN-GATE: none

---

## Phase 6 — Performance & fidelity validation

### Batch 6.1 — Close-out
- [ ] Measure render latency, MIDI outbound throughput, meter-polling cost — SUBSTANTIALLY DONE by
      the #107 saturation smoke (PR #115, logs/live-smoke-107*.log): meter-polling cost measured
      under combined load (155 waves/180s, avg wave 1127ms, watchdog 3.87%), wave durations
      characterized before/after the scheduling fixes. needs-decision: whether a dedicated
      render-latency number is still wanted or the smoke data closes this.
- [ ] Validate machine fidelity end-to-end via live self-loop (if enabled — merges with G2/#45)
- [ ] Final ledger sweep: every item [x]
HUMAN-GATE: none

---

## GitHub reconciliation log

2026-06-10 full sweep (every open GH issue adjudicated against shipped work):
- CLOSED as shipped, with evidence comments: #2 (A/B render race — C1/C2/T1b/R3 arc), #5 (virtual/
  screen sync — resolved by tree-derived render + audited equivalence; verification continues as
  #45), #8 (inc/dec — wired in controls.js + index.html), #51 (bitmap start-marker guard — code
  replaced by framebuffer header validation). Earlier same day: #105, #106, #107, #116 closed via
  PRs #109/#111/#112/#115/#117.
- STATUS COMMENTS posted (still open, scoped against current main): #3 (loading UX for bitmap-only
  waves — now trivial post-#115), #9 (settings snapshot — infrastructure now exists), #10 (audio
  meters — framebuffer-only, path is bitmap polling), #47 (framing validation — reassembly half
  shipped as FB6/FB7; per-command length checks remain), #48 (checkbox->appState sync is boot-only —
  defect characterized).
- FILED: #113 (program-subtree caching, maintainer report), #116 (CON semantics, fixed same day),
  #118 (D1), #119 (D2).
- OPEN BOARD after sweep: #3, #9, #10, #12, #14, #45 (G2), #47, #48, #113, #118 (D1), #119 (D2).
  Every open issue now maps to a ledger item or carries a current-state comment; #12/#14 are
  UI-polish enhancements with no ledger batch (schedule ad hoc).

2026-06-11 update — BUG BOARD AT ZERO. Shipped since the sweep: #113 (PR #122, program-subtree
caching), #118/#119 (PR #123, D1/D2 parser hardening), G2a (PR #124, golden screenshot
regression), #3/#48 (PR #125), #47 (PR #126), #121 (PR #128; #127 was its stacked predecessor,
auto-closed by GitHub when the base branch merged). #45 (G2b live loop) remains open behind its
needs-decision gate. OPEN BOARD: #9, #10, #12, #14 — all four are feature enhancements; every
bug-class issue ever logged is closed.

2026-06-11 later — UI MILESTONE MERGED (PR #133, squash d6635e3; auto-closed #130/#131/#132):
virtual rack faceplate (Option A green phosphor; true 6x8 LCD font PxPlus HP 100LX, CC BY-SA;
panel fidelity from the unit manual p.8-11 incl. wired BUSY LED + DATA knob), #131 loading
visibility (deferred repaints while a SET dropdown is focused + BUSY LED on the dump-wave
lifecycle), #132 routing matrix editable (gang COL subtrees [blank tag, non-'0' position] render
INLINE as the hardware's one-page matrix — tree.js isGangCol/withinGangOf + recursive
findParamUnder, parser gang fan-out with per-visit dedupe, R7 gang-grandchild repaint,
renderGangInline, audit reachability updated), and live-external-clock fixes (slow poll lane
keeps on-page values like the midiclock-measured Tempo BPM current; compact 8-cell indicator
flasher). Reviewed pre-merge (correctness + docs agents; 2 blockers fixed). Deepest-ever audit
(depth 4, 98 COL nodes): zero violations. Tests 190/190. OPEN BOARD unchanged: #9, #10, #12,
#14, #45 (gated).

2026-06-11 evening — DISPLAY POLISH + THEME + DEMO MERGED (PR #136, squash 81ca3dd), all
maintainer-driven same-day iteration: tempered-glass pane with backdrop-filter refraction +
pointer key light; row leading (+6px, 25%) and bezel diffusion analysis/fix; in-glass inline
editing replaces every browser prompt()/alert(); tokenized theme engine (src/theme.js — 16-token
registry, 6 presets incl. synthwave/amber/vfd/redline/stealth, IDE-style editor pane, persisted
via config.saveThemeConfig; styles.css alpha literals converted to color-mix so one token retints
its family); theme-colored bitmap canvas (framebuffer computePixels injectable colors +
rerenderBitmap); demo mode (src/demo.js over src/demo-data.json — 98 live-captured dumps + a real
screen frame served through the midi.js port contract; refresh recipe in CLAUDE.md). Reviewed
pre-merge (no blockers; 5 should-fixes + nits fixed, incl. inline-editor lifecycle gaps, demo
device-ID poisoning, corrupt-localStorage hardening, demo SET hex echo). Tests 205/205. FILED:
#135 (program preview via idle DSP, enhancement). KNOWN-OPEN from maintainer report, probe
blocked on the WinMM port: bank select does not refilter the program list (probe ready at
logs/probe-bank.mjs). OPEN BOARD: #9, #10, #12, #14, #45 (gated), #135.

2026-06-11 night — LOAD-MENU ARCHITECTURE REDESIGN (branch feat/preset-loader, PR open).
Maintainer report: "lots of race conditions ... the dropdowns keep swapping themselves and
things take a while to commit." ROOT CAUSE: the program/load-menu bank+program dropdowns were
reconciled at RENDER time from five competing sources (live dump, optimistic hex cache, session
memo, synced library, a module-state bank index) and repainted by several async triggers, so any
repaint could resolve a different source (swap) and every commit waited on a device round-trip
(slow). FIX: a single source of truth — new DOM-free src/preset-loader.js holds one local
{bankIdx, programIdx} selection backed by the synced library. Picking a bank/program is PURE LOCAL
staging (no device I/O), like scrolling on the hardware; the device is touched ONLY when the user
hits "load program in A/B" (library.js loadProgram: bank->program->trigger PUTs + optimistic
top-bar name). Every async repaint reads the same selection, so repaints are idempotent — nothing
swaps. renderer.js: renderLoadMenuSelect sources options/selection from the loader+library and
seeds once from the live dump (ensureInitialized); handleSelectChange routes the load menu to local
staging; the LOAD_TRIGGER routes through loadProgram. UNSYNCED fallback: the legacy dump-driven
current-bank path plus a "sync to browse all banks" hint (RENDER.SYNC_TO_BROWSE). tree.js/parser.js/
event-bridge.js unchanged (the memo, stale-exemptions, and 0x2e early-return still back the scan,
the load PUT sequence, and the fallback). main.js resetPresetLoader() on reconnect + Sync so the
next open re-seeds. VALIDATED LIVE against the powered Orville (logs/probe-loadmenu.mjs, raw output
in session): [1] no-swap — staged bank held through 3 repaints; [2] instant — bank/program picks
emit zero PUT/bank/program traffic; [3] load — ordered bank->program->trigger PUTs, optimistic name
same-tick, device-confirmed after settle (load persisted: device reported the new DSP-A program);
[4] fallback — legacy put+targeted-fetch fires with no library. Tests 234/234, lint clean. New
coverage: tests/preset-loader.test.js (8), library.js helpers + loadProgram, renderer load-menu
library/fallback paths. Foundation for #153 (preset browser) and #152 (inbound Program Change),
which can reuse the DOM-free loader. MERGED to main (PR #155, squash 44e40c3; #145 sync-dialog
merged first as bf60326 — the stacked #154 auto-closed when its base branch was deleted, rebased +
reopened as #155).

2026-06-12 — PRESET BROWSER + PREVIEW + LIVE FAVORITES (#153/#135, branch feat/preset-browser-153-135,
PR open). Built on the #138 preset-loader foundation. NEW src/preset-browser.js: a top-level modal
(theme-tokened, modeled on sync-dialog) browsing the synced library — bank list + program list +
name search (reuses searchLibrary/canSearch), with per-program Preview / load-to-A / load-to-B.
PREVIEW (#135) is remember-and-restore: the Orville runs BOTH DSPs, so auditioning necessarily
overwrites the target engine — preview captures the slot's EXACT current program (indices, since
names repeat across banks) BEFORE loading onto the IDLE engine, and offers Keep (leave it) vs Cancel
(reload the remembered program). Explicit action only (no auto-preview — the ~2s DSP rebuild),
controls lock during a load. library.js: loadProgramToDsp(target, dspSlot, onDone) generalizes
loadProgram (slot-chosen trigger + optimistic name by slot; loadProgram is now a thin active-slot
caller); lastLoadedBySlot + getRememberedProgram (exact app-load memory, best-effort running-name
fallback) + resetLibraryLoadMemory. LIVE FAVORITES (maintainer report "favorites gets out of sync
since that's a live menu"): bank 0 is the device's auto-generated MRU that reorders on every load,
so its static library snapshot is always stale — isFavoritesBank + refreshFavoritesBank re-read it
live whenever viewed (load menu bank-0 select + browser bank-0 select), while the 70 static banks
stay on the race-free library path. main.js: BROWSE button, setupPresetBrowser({onLoadComplete}),
resetPresetBrowser() next to both resetPresetLoader() seams. Tests 253/253 (+19: loadProgramToDsp
slot targeting/order, getRememberedProgram exact/fallback/null, isFavoritesBank, refreshFavoritesBank,
new tests/preset-browser.test.js render/search/empty/preview-remember-restore/keep/no-auto-preview/
live-favorites/reset), lint clean. VALIDATED LIVE against the powered Orville
(logs/probe-preview-135.mjs, raw output in session): with DSP A active, loaded '10 Delaytaps' into
the IDLE slot B (explicit-slot targeting — idle name changed); getRememberedProgram returned the
EXACT {bank 5, prog 0} just loaded (not a name guess); previewed '11 Delaytaps 2' onto B (overwrite);
restored -> idle name back to '10 Delaytaps' (RESTORE-ROUND-TRIP PASS). Reviewed (correctness + docs);
fixed one blocker (loadProgramToDsp now fires onDone on its sync-guard early-return so a browser load
during a sync cannot stick the control lock — regression-tested).

2026-06-12 — MIDI MAPPING, device-native (#146, branch feat/midi-mapping-146 stacked on the browser
branch, PR open). The flagship: map any MIDI source to any parameter, run IN THE DEVICE DSP (zero app
latency, persists in the preset; the app is only a configurator). Phase 0 mapped the whole system
live (device-model.md §8b): the per-parameter modulation surface is fully OBJECTINFO/VALUE-addressable
under "remote control" (10030400 -> <param> setup 10030401; mode 10030402, range 10030408, type
10030409, Capture 10030406) — an earlier draft wrongly thought it un-addressable; key discovery via
`sequence out = new` (10010016) and the internet research (Eventide Programming Manual + userobj.pdf +
forums) corrected it. The mode index->source table (off/low/mid/high, assign 1-8, trig 1-2, pedals,
named MIDI CCs) is set by index; the device echoes the name. NEW src/midi-map.js (DOM-free engine:
assign read/Capture/clear, per-param set source/range/type + Capture, bindParam = the one keypress
step [program->parameter->DOWN x row->select-hold], OBJECTINFO-verified by surface title). NEW
src/midi-map-ui.js (two themed modals: a CONTROLLERS panel over the 8 global assigns with one-click
Learn, and a per-parameter CARD opened from a "MIDI" badge the renderer adds to DSP-preset NUM/SET
rows). renderer.js: the badge (DSP-keys only) + handleLcdClick branch. main.js: MIDI Map button,
setupMidiMapUI, resetMidiMapUI at both reset seams. sysex-commands.js: MOD keys + MOD_SOURCES;
constants.js: MIDI_MAP timings. Tests 280/280 (+27: midi-map ops/sources/bind, midi-map-ui modals,
renderer badge), lint+format clean. VALIDATED LIVE end-to-end through the shipped module
(logs/probe-midimap-e2e.mjs): bindParam('level') -> "level setup", set source=volume(CC7) via the
module, then CC#7 drove level -100->0 dB with the app out of the runtime path. NEEDS browser smoke:
the full UI click-through (badge -> card -> device) against the unit; the engine + bind are
hardware-proven, the UI is jsdom-tested. Pre-merge reviewer pass pending. Foundation note: bindParam
reaches params on a preset's MAIN param page; deeply-nested sub-page params need extra navigation (a
follow-up). Also delivers #152 (inbound Program Change loads) — confirmed live.
CONFIRMED LIVE BY MAINTAINER: bound a real controller and saw modulation on hardware. Polish batch
(A/B sync, CC/con display, mapped badge, DSP-B/embedded params, range hint) + the completed 52-entry
mode source table all hardware-verified (logs/probe-verify-batch.mjs): MIDI double surfaces the con
(CC number); the A/B keypress toggles the DSP so a bind lands on the right engine; DSP-B params bind.

## Done (verified merged — do not redo)
- A1  main.js debug-upload slice bounds — PR #24
- 8-step decoupling refactor — PR #23
