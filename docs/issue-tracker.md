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
- [ ] F1  Add GitHub Actions CI running `npm test` on push/PR to main
- [ ] F2  Add ESLint flat config (no-unused-vars; no-console warn)
- [ ] F2  Add Prettier + one project-wide format pass (fixes bitmap.js mixed indent)
- [ ] F3  Dependency upgrades — patch-safe now (babel, webmidi, nodemon, babel-jest, jsdom)
- [ ] F3  Major upgrades each on own branch, tested (Vite 8, Jest 30, archiver 8)
- [ ] B9  Move `jest-environment-jsdom` to devDependencies; clear baseline-browser-mapping warning
HUMAN-GATE: none

### Batch 0.3 — Test-net widening   (gates all render/arch work)
- [ ] E  Widen renderer snapshot: graphic-EQ pos-`a`, embedded childSubs, keyStack depth >2,
        SET hex/dec idx >=10, INF type, formatValue `%3.0f`/`%-10s`/`%%`, handleLcdClick back-link + dsp-clickable
- [ ] E  Characterize VALUE_DUMP 0x2e branch (CON immediate-render, meter heuristic, program/bank skip, child-param)
- [ ] E  Add coverage for midi.js request-building, controls.js, config.js
HUMAN-GATE: none

### Batch 0.4 — Offline replay harness
- [ ] H  Recorded-SysEx replay + bitmap screengrab-diff scaffolding (no device); subscribes to events.js bus
HUMAN-GATE: none

---

## Phase 1 — Cleanup (no behavior change)

### Batch 1.1 — Dead-code prune
- [ ] B1  Remove dead exports: `extractNibbles` (bitmap.js:16), `getState`/`subscribe` (store.js:62,72)
- [ ] B3  Remove stray `console.log` (renderer.js:99,113,115)
- [ ] B4  Remove commented-out code (renderer.js:102, midi.js:141)
- [ ] B2  Resolve `SAVE_MONO_BMP`/`exportBMP` (bitmap.js:7,94,97) — keep as commented dev hatch OR remove flag+call+fn
HUMAN-GATE: none

### Batch 1.2 — Magic-constant extraction
- [ ] B5  New `src/sysex-commands.js` for command bytes (0x01,0x17,0x18,0x2d,0x2e,0x31,0x32) per system_commands.txt
- [ ] B6  Name application-logic param keys (T_RATE_KEY 8060001; program/bank 10020011/10020012; 1002001c; PRESET_LOAD_TRIGGER_KEY 401000b)
HUMAN-GATE: none

### Batch 1.3 — Dedup + stale docs
- [ ] B7  Collapse triplicated splitLine/request-byte builders (parser.js, build_tools/capture-fixtures.cjs, tests/helpers/sysex-fixture.js)
- [ ] B8  Fix stale docs/comments (CLAUDE.md toggleDspKey claim; parser.js:79 isLoadingPreset comment)
HUMAN-GATE: none

---

## Phase 2 — Correctness bugs

### Batch 2.1 — Parser correctness
- [ ] A5  Stop swallowing mid-parse errors (parser.js:156-159): preserve stack, roll back same-call setStates
- [ ] A3  Optimistic write (parser.js:119-120): roll back currentValues[key] if PUT not confirmed
HUMAN-GATE: none

### Batch 2.2 — Config correctness
- [ ] A4  Merge cached config OVER defaults instead of replacing subtrees (config.js, main.js:324); audit all cached subtrees
HUMAN-GATE: none

### Batch 2.3 — Bitmap artifact
- [ ] A2  Fix SHIFT_FIRST_COLUMN top-left black-pixel (bitmap.js:72-91); verify via replay harness
HUMAN-GATE: needs-hardware — render a 0x18 capture on the device, confirm top-left corner is clean

---

## Phase 3 — Architecture (behavior-affecting; needs 0.3 test-net + 0.4 replay first)

### Batch 3.1 — dumpComplete events (headline perf + correctness)
- [ ] C1  Replace stacked 200ms setTimeout + debounce with explicit dumpComplete(key,data) events (event-bridge.js, parser.js:121,158, renderer 200/300/500ms chains)
- [ ] C4  Delete isLoadingPreset boolean once events expose dump-complete; update startup.test.js Tier A/B
HUMAN-GATE: none

### Batch 3.2 — State-shape hardening
- [ ] C3  Normalize keyStack mixed types (string@0, objects@1+) to always-objects or split structures
- [ ] C5  Renderer autoload: use `subs` param instead of global appState.currentSubs[0] (renderer.js:740)
- [ ] C8  Clear childSubs on navigation
- [ ] C7  Replace endsWith('0002') meter heuristic with a defined check (parser.js:152)
HUMAN-GATE: none

### Batch 3.3 — autoLoad race
- [ ] C2  Remove 500ms race (main.js:145-159); subscribe to rootDumpComplete && cachedPresetKey
HUMAN-GATE: needs-decision — landing page: cached preset (401000b) vs setup menu (10010000)?

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
