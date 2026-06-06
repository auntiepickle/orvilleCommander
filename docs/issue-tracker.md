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

### Phase 1 closeout — deferred
- [ ] Lint-zeroing: promote no-unused-vars / no-console / no-useless-assignment to error once 19 remaining warnings cleared.
      Blocked on the main.js unwired-button finding (below) + ~5 no-useless-assignment in parser/renderer (some resolve naturally in Phase 3).
- [ ] FINDING (possible UX bug): main.js grabs ~11 button/input refs never wired to handlers
      (backBtn, exportConfigBtn, importConfigInput, importConfigBtn, sendRequestBtn, getValueBtn, setValueInput, setValueBtn,
      applyLogCategoriesBtn, keyInput, logCategoriesJson). Determine: dead lookups (remove) vs buttons in index.html missing handlers (wire or remove from UI).

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
- [~] A2  Fixed: SHIFT_FIRST_COLUMN now wraps the bottom pixel to the top instead of blacking it. Offline replay snapshot confirms the forced-blank top-left is gone (first 8 cols now carry wrapped content). NEXT: device confirmation.
HUMAN-GATE: needs-hardware — PR #61 open, NOT merged. Run the app, render a 0x18 screen capture, confirm the top-left corner is clean (no stray black row) and the first 8 columns align with the rest. If wrong, fallback is option (b) preserve-source-top.

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
