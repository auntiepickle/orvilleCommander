# Refactor review notes

Observations and decisions captured during review of each roadmap step. Terse — the "why" that doesn't fit in a commit body.

## Cross-cutting findings

- **Cached-config overrides make new state fields invisible to existing users.** Any new field added to the `appState` defaults in `store.js` is silently overridden at boot by `config.js`'s `loadConfig`, which replaces cached-object subtrees (e.g. `logCategories`, `logLevel`) wholesale from `localStorage.midiConfig` rather than merging. Result: the field lives on fresh installs only — a user who ran the app before the field was added will never see it until they clear or hand-edit their cache. This is a landmine for Steps 6/7/8: every step that touches store.js defaults needs either (a) config.js migrated to merge instead of replace (logged in future-work.md), or (b) an explicit rollout note telling existing users to clear localStorage. Surfaced twice during Step 5 (stateWrite category absent from cached logCategories; trace silenced by cached logLevel=info even if the category had been present).

## Step 5 — parser.js setState migration

- Batching rejected in favor of 1:1 to preserve reversibility before any subscribers exist
- Option A (import log in store.js) chosen over B to avoid two log sinks; new load-tolerated cycle store→logger→state→store accepted
- origin param on setState is optional with no default — missing origin logs as undefined, intentional signal that a caller forgot to tag
- stateWrite logCategory defaults to false; enable locally during audit work
- Tripwire docstring in store.js documents Object.assign identity-preservation; parser reads at 193/196/272/311 (deviceId), 235/246/304 (lastAscii), 235/242/246/287/288/295/299 (currentSubs), 250/305 (isLoadingPreset) rely on it
- setState builds trace string unconditionally before logger gates on category; cheap today, wrap in `if (appState.logCategories.stateWrite)` if it ever shows up in a profile
- Hunk-count from Claude Code does not match plan's table row count; invariant is "no multi-key coalescing into one setState call," verified per-hunk
- logCategories on appState is what creates the store↔logger↔state cycle; moving it off would collapse the cycle (entry in future-work.md)

### Post-commit diagnostic: startup landing-page regression (setup vs Black Hole)

- Symptom: post-Step-5 fresh-boot LCD lands on the setup menu; user recalls pre-Step-5 landing on Black Hole (the cached presetKey).
- Ran a live capture with stateWrite trace enabled (localStorage.midiConfig hand-edited to add stateWrite: true; store.js trace level bumped from debug to info for the capture; both reverted after). Trace showed:
  - Root dump at t+0 writes dspA/BKey, dspA/BName, then lastAscii + currentSubs (the root-dump `main.key === appState.currentKey` branch fires because both are '0' at boot).
  - renderer.js autoload fires at ~t+510 and flips currentKey to '10010000' via a direct write (not parser.js, so no trace line).
  - 401000b dump arrives at ~t+763 — 253ms after autoload already claimed currentKey. parser.js:212 gate (`main.key === appState.currentKey`) now fails, so presetKey is NOT updated, lastAscii/currentSubs are NOT updated, and the 401000b data lands only in menusA/dspAName. It becomes an orphaned fetch.
  - Setup menu's own follow-up dump arrives at t+3228 and populates the visible screen.
- Diagnosis: pre-existing race in the renderer-autoload vs. preset-fetch ordering. Step 5 exposed but did not cause it — the gate line (parser.js:212) is textually unchanged, currentKey is written by renderer.js (untouched by Step 5), and Step 5's per-call overhead is sub-millisecond against a 253ms device round trip.
- No fix in Step 5. Fix belongs post-Step-6 or folded into Step 7's event-bus rewiring, where the parse → render → navigation handoff is being reshaped anyway.

### Audit-tool bug exposed during the diagnostic

- Two independent silencers for new audit traces on existing users, either one alone enough:
  - **Level gate.** logger.js:9 checks `levels[appState.logLevel] < levels[level]`. Cached `logLevel=info` plus a trace emitted at `'debug'` drops the line before the category check even runs.
  - **Category gate.** logger.js:9 also checks `!appState.logCategories[category]`. Cached `logCategories` from localStorage lacks any field added after the cache was first written; `undefined` is treated as off.
- Burned two capture cycles during the Step 5 post-mortem: first run at `'debug'` with default category yielded an empty trace (level gate won); second run required both a source change (trace level → `'info'`) AND a manual localStorage edit to inject `stateWrite: true` into the cached `logCategories`.
- Each future step that adds a new audit trace needs to think through both gates.
- Not a Step 5 regression — both gates predate Step 5. Fix out of scope here; logged in future-work.md.

## Step 6 — bitmap.js extraction

- Cycle accounting: closes the parser.js ↔ main.js cycle (cycle #3 in 01-dependency-graph.md) that existed solely for bitmap helpers — after the move, main.js no longer imports anything from parser.js. The parser.js → main.js edge for `hideLoading` remains but is one-way and doesn't form a cycle. Cycle count: 6 → 5.
- Dead imports in main.js preserved, not cleaned up. `extractNibbles` has no caller anywhere in the repo; `exportBMP` is called only from inside `renderBitmap` under `SAVE_MONO_BMP` (hardcoded false). Both are still imported by main.js at the new `./bitmap.js` path and remain unused at any call site. Strict move-fidelity kept the import line symmetric; deletion deferred to a standalone cleanup commit or folded into Step 8 (which will churn the main.js import block anyway).
- Constants ordering: `NO_FLIP` / `ROTATE_COLUMNS` / `SHIFT_FIRST_COLUMN` / `SAVE_MONO_BMP` moved from tail-of-file in parser.js to top-of-file in bitmap.js. Pure ordering change, no behavior delta — they were only referenced inside called functions, so hoist-vs-tail was irrelevant at runtime. Flagged so a future bisect doesn't misread the const position as a semantic edit.
- Unused local `let row = 0;` inside `exportBMP`'s outer y-loop (bitmap.js:125). Declared, never read or written. Pre-existing dead code in parser.js, preserved verbatim. Candidate for the same standalone cleanup commit as the dead imports above.
- Indentation inside the moved block is inconsistent: `denibble` is 2-space; `renderBitmap`, `extractNibbles`, `exportBMP` are 4-space. Preserved verbatim from parser.js. A prettier/format pass is explicitly out of Step 6 scope.
- Renderer bug observed during smoke but not caused by Step 6: top-left corner of rendered bitmap shows black pixels not present in the source data. Consistent with the `SHIFT_FIRST_COLUMN` non-wrapping shift in `renderBitmap` that zeroes the top `shiftAmount` pixels of the first 8 columns. Pre-existing behavior preserved by the move. Tracked separately in future-work.md.
