# Refactor Roadmap

Eight steps. Each step = one commit, one shippable change, one rollback plan. Green tests and a manually-verified LCD between every step.

**Ground rules:**
- No behavior change unless a step explicitly says so.
- Tests are added *before* the code move when practical (the characterization tests in `03-test-coverage-gap.md`).
- Every step ends with `npm test` green and a smoke test: connect to a real Orville (or the debug file upload path if no hardware) and confirm the LCD renders.

---

## Step 1 — Repair the test runner

**Change.** Delete (or gut and rewrite for the current API) `tests/main.test.js`. Add `@testing-library/dom` + `@testing-library/jest-dom` to `devDependencies` only if we keep the rewrite; otherwise drop the imports. Add a `tests/midi.test.js` that asserts the byte-level contract of `sendSysEx`, `sendObjectInfoDump`, `sendValuePut`, `sendKeypress` (see `03-test-coverage-gap.md`). Add a snapshot test for `keypressMasks` against `system_commands.txt`.

**Why first.** Every later step needs `npm test` to be meaningful. The current state is "tests pass because the broken file errors out before assertions" — we cannot trust it.

**Rollback.** `git revert`. No production code touched.

---

## Step 2 — Extract `logger.js`

**Change.** Create `src/logger.js` exporting `log(message, level, category)` and the `levels` map. Move the body of `log` out of `main.js`. `main.js` re-exports `log` for a transition period. Every module that currently takes `log` as a parameter starts importing it from `logger.js`; function signatures keep the param for now (we delete it in Step 3). `renderer.js`'s existing `import { log } from './main.js'` switches to `./logger.js`.

**Why now.** Smallest possible coupling reduction, unblocks removing `log` as a pass-through parameter everywhere, and eliminates one cycle (`parser.js`/`renderer.js` → `main.js` for log).

**Rollback.** `git revert` — `main.js` still re-exports `log`, so any stale caller keeps working even mid-revert.

---

## Step 3 — Remove `log` as a function parameter

**Change.** Drop the `log` parameter from every signature in `midi.js`, `parser.js`, `controls.js`, `config.js`. Callers inside use the module-level import from `logger.js`. Tests update to remove the `mockLog` positional arg.

**Why now.** Pure mechanical cleanup, straightforward diff, shrinks every signature. Must follow Step 2.

**Rollback.** `git revert`. Tests pin the behavior, so any mistaken drop is caught.

---

## Step 4 — Introduce a `store.js` façade over `appState`

**Change.** Add `src/store.js` exporting `getState()`, `setState(partial)`, `subscribe(fn)` and an internal `appState`. `state.js` re-exports `appState` from `store.js` for backwards compatibility. No mutations change shape — every `appState.x = y` keeps working. The façade only adds the option to write through `setState`.

**Why now.** We need an auditable write path before untangling the parser/renderer render loop. This step adds the seam without forcing migration.

**Rollback.** `git revert`. Nothing forced to use the new API yet.

---

## Step 5 — Migrate `parser.js` writes to go through `setState`

**Change.** Inside `parser.js` only, replace direct `appState.x = y` writes with `setState({ x: y })`. No other module changes. Add a logger trace at `setState` so every mutation appears in the log with its origin.

**Why now.** `parser.js` is the noisiest writer and the one where "who changed state mid-render" bugs live. Migrating it first gives us the clearest audit trail and unblocks Step 6. Renderer and controls migrate in a later, off-roadmap cleanup pass.

**Rollback.** `git revert`. Other modules untouched, so partial rollback is safe.

---

## Step 6 — Extract `bitmap.js`

**Change.** Move `extractNibbles`, `denibble`, `renderBitmap`, `exportBMP`, the `bit_reverse_table`, and the `NO_FLIP`/`ROTATE_COLUMNS`/`SHIFT_FIRST_COLUMN`/`SAVE_MONO_BMP` constants from `parser.js` into `src/bitmap.js`. `parser.js` imports `renderBitmap` from there; `main.js` updates its debug-file-upload handler import. Remove the `denibble`/`renderBitmap`/`extractNibbles`/`exportBMP` re-exports from `parser.js`.

**Why now.** The bitmap code has nothing to do with sub/value parsing. Two modules, each smaller and focused. Closes one import cycle (`main.js` → `parser.js` for bitmap helpers).

**Rollback.** `git revert`. Self-contained file move.

---

## Step 7 — Break the parser→renderer→main triangle with an `events.js` bus

**Change.** Add `src/events.js` with `emit(type, payload)` / `on(type, fn)` — tiny, ~20 lines, no deps. `parser.js` stops importing `renderer.js` and `main.js`. Instead: parser emits `objectinfo:received`, `value:received`, `screen:received`, and `render:request`. `main.js` wires subscribers that call into `renderer.js` and `bitmap.js`. The existing `debouncedRenderScreen` and `renderTimeout` logic moves into the subscriber.

**Also:** `renderer.js` stops importing `parseSubObject` from `parser.js` — `renderScreen` requires `subs`; the old ASCII fallback path moves into the event subscriber which parses first and passes subs in.

**Why now.** This is the big one — three of the five cycles (1, 2, 3 from `02-top-couplings.md`) die in one step. Must come after Steps 5 and 6 so parser is already smaller and state writes are auditable.

**Risk.** Highest in the roadmap. The parse→render timing (renderTimeout + debounce) is behavioral; getting it wrong manifests as "screen flashes old data". Mitigation: Step 4's renderer golden-snapshot tests run before and after.

**Rollback.** `git revert`. The prior import topology is restored; events.js file is orphaned but harmless.

---

## Step 8 — Extract `navigation.js` and split `renderer.js`

**Change.** Create `src/navigation.js` owning `toggleDspKey`, `keyStack` push/pop, `currentKey` transitions, and the autoload logic currently at `renderer.js:733-748`. `controls.js` and `renderer.js` both call into it. Delete the duplicate `toggleDspKey` in `controls.js:63`. Then split `renderer.js` into `renderer/screen.js` (renderScreen orchestration), `renderer/format.js` (formatValue + NUM/SET/CON/TRG/INF cell builders), `renderer/softkeys.js` (all softkey-row logic), `renderer/handlers.js` (handleLcdClick, handleSelectChange, handleParamClick). Public API of the folder is re-exported from `renderer/index.js`.

**Why now.** Kills cycle 5 (controls↔renderer); the toggleDspKey duplicate is the concrete symptom removed. Must come last — file splits churn every import line, and doing this before the event bus exists would force redundant rewiring.

**Rollback.** `git revert`. File moves are the riskiest-to-merge kind of change, so this step belongs on its own branch and lands only after tests for every handler pass.

**Status as of f38111e:** Partial — navigation extraction landed. Renderer folder-split deferred per L101 exit ramp; see docs/refactor/05-status.md for details.

---

## Checkpoints & exit ramps

- After **Step 3** you have: green tests, centralized logging, no new architecture. Fine place to pause.
- After **Step 6** you have: logger + store façade + bitmap split. Parser is noticeably smaller. Fine place to pause for a week of real-world testing.
- After **Step 7** the parse pipeline is event-driven. Before this step, everything is a safe mechanical cleanup; at and after this step, behavior parity requires the test suite to be trustworthy.
- **Step 8** can be skipped indefinitely — the navigation extraction is valuable, the renderer-folder split is optional if the team is comfortable with a ~750-line file.

## What's explicitly *not* on this roadmap

- TypeScript migration (separate, later decision).
- Framework (React/Svelte/etc.) adoption (separate, later decision).
- Rewriting the SysEx protocol layer (contract is external; locked by `system_commands.txt`).
- The root HTML id binding in `main.js` (cosmetic — can be a one-off `dom.js` extraction whenever).
