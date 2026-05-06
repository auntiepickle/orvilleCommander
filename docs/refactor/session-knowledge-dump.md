# Step 5.5 session knowledge dump

Empirical observations and mental-model traces built during the Step 5.5 Claude Code session. Intended as load-before-tasks context for future sessions — things that would be expensive to rebuild from source alone. Entries distinguish between **verified empirically** (via the startup test passing), **reasoned from code** (read but not exercised), and **unverified** (observed but not characterized).

---

## 1. Parser.js call graph and hot spots

**Fired during startup simulation (verified by Tier A):** deviceId auto-detect (`parser.js:46-49`); OBJECTINFO_DUMP 0x32 branch (`:51`); sub-branches `main.key === '0'` (`:55-62`, fires at root), `main.key.endsWith('000b')` (`:63-70`, fires for 401000b and 801000b), `main.key === appState.currentKey` (`:71-87`, fires at root and 10010000); screen dump 0x17 branch (`:166-174`).

**NOT fired in any startup or prior test (uncharacterized):** `else if (main.key === '0' && appState.currentKey !== '0')` background-root-dump branch (`:88-94`); `isChild` branch (`:97-102`); favorites re-order fix (`:104-126`); entire VALUE_DUMP 0x2e branch (`:127-165`) including CON immediate-render, meter-key `endsWith('0002')` heuristic, program/bank skip at `:139`, child-param detection; catch-all error branch (`:176-179`).

VALUE_DUMP handling is where the most conditional complexity lives and Step 7 risk concentrates — the startup test touches none of it. Before Step 7 rewiring, a second characterization covering VALUE_DUMP paths (preset-load flow, meter polling, SET parameter change) would be valuable.

## 2. Store.js subscriber behavior under load

Reasoned from code, **not empirically verified** (no test registers subscribers on the real store):

- **Synchronous** — `for (const fn of subscribers) fn(appState)` runs inline inside setState.
- **Insertion order** — JS `Set` iterates in insertion order.
- **No batching** — each setState fires all subscribers. Two back-to-back setStates fire subscribers twice.
- **Reentrancy hazard** — a subscriber calling `setState` recursively invokes all subscribers (including itself) again; no guard. A subscriber calling `subscribe`/`unsubscribe` during its callback interacts with `Set`'s live-modification semantics (added entries during iteration are visited; deleted entries not yet visited are skipped).

The startup test captures state writes via the log mock (parsing `[stateWrite]` trace messages), not via store.subscribe. The subscribe path is unexercised.

## 3. Renderer.js seams for Step 7

**Exports (entry points called from outside):**
- `updateScreen(logParam)` — called from main.js (startup and several handlers) and imported by parser.js (likely dead import; grep if removing).
- `renderScreen(subs, ascii, logParam)` — called only from parser.js via debouncedRenderScreen.
- `toggleDspKey(key)` — pure function, called from main.js:147.

**Internal (const arrows, not exported):** `handleLcdClick` (`:47`), `handleSelectChange` (`:99`), `handleParamClick` (declared around the same region). DOM handlers attached inside renderScreen.

**Events-bus subscriber interface (projected for Step 7):** `renderScreen` becomes a subscriber to `render:request(subs, ascii)` events emitted by parser's dump-complete handler. `updateScreen` splits into `navigate(key)` (emits a navigation request event) + a subscriber to `navigation:complete` that clears childSubs/currentValues. Autoload becomes a subscriber to a combined `objectinfo:complete && autoLoadPending` condition, no longer living inside renderScreen's body. `toggleDspKey` stays pure (move to a utils module if splitting renderer into a folder per Step 8).

## 4. Main.js inline logic worth extracting

- **`:133-155` `selectPorts`** — the 500ms race, Step 5.5's central concern. Primary extraction candidate. → `startup/select-ports.js`.
- **`:100-127` `connectMidi`** — WebMIDI enable + port option population, DOM-coupled. → `startup/connect-midi.js`.
- **`:260-310` `testTRateBtn` handler** — a full t_rate test harness with sleeps and assertions embedded in production code. Does not belong in main.js. → `dev-tools/test-t-rate.js` or delete if obsolete.
- **`:211-237` `processDebugFileBtn`** — debug file upload + bitmap decode, duplicates parser's 0x17 logic. → `dev-tools/process-debug-file.js`.
- **`:55-85` `startPolling` / `stopPolling` + `toggleMeterPollingBtn`** — meter polling loop. → `polling/meter-poll.js`.
- **`:170-181` `pollToggle` handler** — a SEPARATE polling concept from meter polling, 500ms updateScreen interval. Confusing overlap; consolidate or delete.

## 5. Debounce/setTimeout patches inventory

**parser.js:**
- `:40` — `debouncedRenderScreen = debounce(..., 200)` (already in future-work).
- `:80` — `renderTimeout = setTimeout(..., 200)` after OBJECTINFO fan-out (same target).
- `:121` — `setTimeout(() => sendValueDump(programSub.key), 200)` — re-fetch after favorites fix. "Wait for device to settle" patch.
- `:158` — `renderTimeout = setTimeout(..., 200)` in VALUE_DUMP branch — render gate for non-CON values.

**main.js:**
- `:142` — `setTimeout(() => {...}, 500)` — selectPorts race (already noted).
- `:57` — `setInterval(..., 100)` — meter polling (legitimate, not a patch).
- `:173` — `setInterval(() => updateScreen(log), 500)` — general polling on pollToggle (legitimate).
- `:266`, `:271`, `:284`, `:286` — `await new Promise(r => setTimeout(r, ...))` in testTRateBtn. Not production; goes away with extraction.

**renderer.js:** renderer.test.js verifies setTimeouts at 200ms (bitmap re-fetch after value change), 300ms (nested auto-load inside handleSelectChange), 500ms (nested post-preset-load root fetch). Same "wait for device" class.

**controls.js:**
- `:124` — `setTimeout(..., 200)` — keypress-settle delay before `updateScreen()` and the optional 0x18 fetch in `setupKeypressControls`. Same "wait for device" class as the parser timers.

## 6. Audit-tool silencer mechanism

On boot, `main.js:314` calls `loadConfig(...)` which reads `localStorage.midiConfig`, parses it, populates UI selects, returns parsed. Then `main.js:316`:
```js
appState.logCategories = cachedConfig?.logCategories || Object.fromEntries(Object.keys(appState.logCategories).map(k => [k, true]));
```
If `cachedConfig.logCategories` exists, it **wholesale replaces** the store.js default. Any category added to store.js's default after a user first saved config is missing from the cached object — `appState.logCategories[newCategory]` is `undefined`.

`logger.js:9` gates: `if (levels[appState.logLevel] < levels[level] || !appState.logCategories[category]) return;`. Two paths to silence:
- **Level gate**: cached `logLevel='info'` + debug-level message → silenced.
- **Category gate**: `!undefined` for any category not in cached object → silenced.

**Defeat for debugging** (in browser devtools console):
```js
const c = JSON.parse(localStorage.midiConfig);
c.logLevel = 'debug';
c.logCategories.stateWrite = true;
localStorage.midiConfig = JSON.stringify(c);
location.reload();
```
Or use the "Apply Log Categories" UI button (index.html:102-103, textarea accepts JSON) + logLevelSelect → "Debug" → Save Config. Clearing localStorage also works but erases port selections.

## 7. Fixture fragility observations

**Option B protects against:** different preset names (single-word or properly-quoted multi-word), different menu counts, different short-tag COL keys and ordering, different device IDs (Tier B hardcoded `deviceId === 1` loudly fails, forcing re-capture awareness).

**Option B does NOT protect against (silent tautology risk):**
- **Multi-word UNQUOTED preset name** — splitLine parses "Space Verb" as two tokens; both parser and helper read first word as statement; Tier B passes with both equal to wrong value.
- **Absent DSP** — device with no DSP B preset; 801000b sub missing; `expectedRoot.dspBKey/dspBName` become undefined; Tier B passes tautologically with both undefined.
- **Firmware adds a field to the COL line format** — both sides mis-position fields, agree on wrong values, tautology passes.
- **Empty root dump** — similar tautology via undefined.

**Loud failures (good):**
- deviceId mismatch.
- Fixture filename doesn't match actual key (capture landed on `40400001` but file is `objectinfo-10010000.txt`) — Tier A fan-out diverges visibly.
- Malformed fixture (missing F0/F7) — parser throws, different error class.

## 8. Test seam fragility (ranked)

1. **renderer.js (HIGHEST)** — partial mock spreads `...actual` and wraps renderScreen. Refactors that change renderScreen's internal code path (especially autoload branch) leave the wrapper calling through, but behavior under the wrap diverges from characterization. Wrap-and-callthrough hides drift.
2. **logger.js** — `{log, levels}`. New logging primitives used elsewhere fail loudly at import. Signature changes to log silently drop info.
3. **main.js** — `{hideLoading, showLoading}`. New exports used elsewhere fail loudly. Low intrinsic drift risk (UI-attachment code, not usually imported from).
4. **midi.js** — full mock. Loud-fail semantics.
5. **bitmap.js** — partial, only renderBitmap mocked. denibble signature changes caught at test time.
6. **controls.js** — just `keypressMasks` data. Negligible.

## 9. Known bugs / oddities not yet surfaced

- **Direct `appState.x = y` writes outside parser.js are orphaned from the Step-5 setState audit.** parser.js:132 (currentValues), :99 (childSubs), :120 (favorites fix), renderer.js updateScreen's cache-clears, renderer.js autoload's keyStack/currentKey/autoLoad, renderer.js handleLcdClick's writes (`:49-90`), midi.js:24 deviceId, main.js:76 pollingEnabled, main.js:163 logLevel, main.js:315-319 startup init. The `[stateWrite]` trace covers a small fraction of actual state mutation.
- **Hardcoded magic keys at parser.js:139** — `'10020011'`, `'10020012'` (program/bank) inline, no named constants.
- **`endsWith('0002')` heuristic at parser.js:152** — meter-key detection. A heuristic masquerading as protocol.
- **Optimistic write at parser.js:119-120** — sets `appState.currentValues[programSub.key]` BEFORE device confirms; if sendValuePut fails or device rejects, appState lies. No rollback.
- **renderer autoload reads global at `:740`** — `parentMain = appState.currentSubs[0]` rather than the `subs` parameter passed to renderScreen. Stale debounced delivery could cause wrong parent lineage in keyStack.
- **parser.js:176-179 catch-all swallows mid-processing exceptions** — no rollback of prior setStates in the same parseResponse.

## 10. Fresh-session reading order (beyond docs)

1. **`src/parser.js`** (full, 217 lines) — densest decision logic. Start here.
2. **`src/store.js` + `src/state.js`** (75 + 7 lines) — state model + setState tripwire docstring.
3. **`src/renderer.js:1-100`** — entry-point overview before the big renderScreen body.
4. **`src/renderer.js:733-748`** (autoload specifically) — load-bearing for landing-page race and Step 7 targets.
5. **`src/main.js:133-155`** (selectPorts) — other half of startup race.
6. **`src/renderer.js:257-748`** (renderScreen body) — 500-line function, do after the context above.
7. **`src/midi.js`** (full, 139 lines) — thin SysEx transmission layer. Last.

Skip on first pass: bitmap.js, logger.js, controls.js, config.js (obvious/isolated).

Also: **`tests/startup.test.js`'s header comment block** is a self-documenting map of the startup flow and pinned behaviors — useful orientation.

## 11. Concerns about the Step 5.5 work

- **Tier A may under-characterize inside renderScreen.** The 62-event sequence is as complete as my mental trace of renderer.js's autoload path. If renderScreen mutates something indirectly via a code path I didn't trace, Step 7 removing it wouldn't fail the test. "Full" is aspirational.
- **log-whitelist boundary is subjective.** 4 substrings. Parser could add a new load-bearing info-level log and the test would silently pass.
- **Option B tautology risk** (per §7) is real but untested. Silent mis-decode on multi-word unquoted preset names would pass Tier B vacuously.
- **bitmap rawByteLen > 1900 floor is hardcoded.** Expected value should be 1933 (13 header + 1920 pixels). If denibble changes, could drift.
- **Step 7 architecture targets in future-work.md are prescriptive.** Event names (`dumpComplete(key, data)` etc.) are my projection, consistent with 04-roadmap.md but not specified there. A future session might land on different shapes; the notes nudge toward the one I imagined.
- **Coalescing rule edge cases untested.** "Intervening non-stateWrite terminates bucket" hasn't been stressed by a more interleaved flow.
- **`simulateSelectPorts()` duplicates `main.js:142-154` inline.** No automated link; a future edit to either must be mirrored.

## 12. Catch-all

- **parser.js ↔ renderer.js circular import is load-tolerated only** (ES modules with late access inside functions). Step 7 must break that edge first.
- **childSubs persists between navigations** except via updateScreen's explicit clear. Long-lived sessions accumulate stale childSubs.
- **Triple duplication: splitLine + request-byte builders.** parser.js, build_tools/capture-fixtures.cjs, tests/helpers/sysex-fixture.js all carry copies. Any protocol format change touches three places. Flagged in the capture script header but not enforced by tooling.
- **jest.config.cjs is two-lines-and-done.** No globalSetup, no moduleFileExtensions override, no transformIgnorePatterns. Works because babel-jest handles everything; surprises may appear if TS or different module resolution is introduced.
- **main.js dead imports:** `extractNibbles` and `exportBMP` are imported from bitmap.js but only denibble/renderBitmap are used. Flagged in Step 6 notes as deferred cleanup.
- **`jest-environment-jsdom` is in `dependencies` not `devDependencies`.** Minor misclassification; harmless.
- **Capture script renames silently on fixture-name mismatch.** If a re-capture with a different device state lands on a different first-short-tag-COL key, `objectinfo-10010000.txt` is semantically wrong. Q9.1 verification in the script prints the actual key for manual rename; not automated.
