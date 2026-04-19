# Top 5 Tightest Couplings (ranked by refactor payoff)

Payoff score = (blast radius if we untangle) × (frequency of bugs the coupling causes) ÷ (cost to fix).

---

## 1. `parser.js` ↔ `renderer.js` ↔ `main.js` — the render pipeline triangle

**What's tangled.** `parser.js` directly calls `renderScreen`, `updateScreen`, and `hideLoading`; `renderer.js` calls back into `parser.js` for `parseSubObject` and into `main.js` for `showLoading`/`log`; `main.js` in turn imports bitmap helpers from `parser.js`. The ASCII → parsed-subs → DOM path is threaded through three files with bidirectional imports.

**Symptoms visible in code.**
- `parser.js:2-7` — imports from `renderer.js` *and* `main.js` in a module that should be pure transform.
- `parser.js:223-246` — parsing triggers `renderTimeout` + `debouncedRenderScreen` + `hideLoading` + conditional re-renders, all in one try block.
- `renderer.js:5` imports `parseSubObject` from parser because `renderScreen` re-parses ASCII when subs aren't supplied.

**Payoff.** Highest. Decoupling parse → dispatch → render would fix most of the "why did the screen re-render three times" and "why is loading state stuck" classes of bugs, and make both modules testable in isolation. Parser becomes pure; renderer becomes a pure view over a known-shape input.

**Refactor sketch.** Introduce a thin event bus (or a `dispatch(type, payload)` function in a new `events.js`). `parser.js` emits `ObjectInfoReceived` / `ValueReceived` / `ScreenDumpReceived`; `main.js` subscribes and calls into `renderer.js`. `parseSubObject` moves into `parser.js`'s public API only (renderer stops re-parsing — it always receives subs).

---

## 2. `appState` as a shared mutable global

**What's tangled.** Every module except `config.js` imports `appState` and writes to it directly: `parser.js` mutates `currentSubs`, `currentValues`, `childSubs`, `isLoadingPreset`, `dspAName`, `dspBName`, etc.; `renderer.js` mutates `currentSoftkeys`, `keyStack`, `presetKey`, `currentKey`; `controls.js` mutates `presetKey`, `keyStack`, `currentKey`, `autoLoad`; `main.js` mutates `logLevel`, `logCategories`, `fetchBitmap`, `updateBitmapOnChange`, `presetKey`, `pollingEnabled`, `deviceId`. 30+ write sites across the codebase.

**Symptoms visible in code.**
- `state.js:65,68` — `currentSoftkeys` is declared twice in the literal (harmless but tells the story).
- `renderer.js:266` — `appState.currentSubs = subs` inside the render function; parser also sets this at `parser.js:230`. Two writers, easy race.
- The "Favorites re-order fix" at `parser.js:248-268` exists because parser reads state that renderer is actively mutating.

**Payoff.** High. State writes from render paths are the single biggest source of "why does clicking twice behave differently than clicking once" bugs. A wrapper with setters (or a proper reducer) makes every mutation auditable.

**Refactor sketch.** Keep the object, but expose it only through a `store.js` with `getState()` / `setState(partial)` / `subscribe(fn)`. Mechanical find-and-replace of direct mutations, zero behavior change. Later: convert to a reducer.

---

## 3. `midi.js` ↔ `parser.js` — I/O and parsing in one loop

**What's tangled.** `midi.js` imports `parseResponse` to invoke inside its SysEx listener (`midi.js:44`). `parser.js` imports three `send*` functions from `midi.js` (`parser.js:5`) to re-request child subs and correct Favorites ordering from inside the parse path.

**Symptoms visible in code.**
- `parser.js:217-220` — during parse, fires off `sendObjectInfoDump` + `sendValueDump` for every local COL child. Parsing should not do I/O.
- `parser.js:261-264` — parse sends `sendValuePut` + schedules another `sendValueDump` when fixing Favorites ordering.
- `midi.js:41-45` — listener hard-codes `parseResponse` as the single handler; no way to test MIDI in isolation.

**Payoff.** Medium-high. Once `parser.js` is pure (returns parsed subs + a list of follow-up commands), both modules become trivially testable and the "parser causes side effects that cause re-parse" feedback loop disappears.

**Refactor sketch.** Make `parseResponse` return `{ kind, payload, followups: [{ cmd, key }] }`. A dispatcher in `main.js` consumes followups and calls `midi.js`. MIDI listener in `midi.js` becomes: `(data) => dispatcher.handle(parseResponse(data))`.

---

## 4. `controls.js` ↔ `renderer.js` — keypresses and DSP toggling

**What's tangled.** `controls.js` imports `updateScreen` from `renderer.js` (to refresh after a keypress) and also owns `keypressMasks` which `renderer.js` imports back. Additionally, `toggleDspKey` is defined in **both** `controls.js:63` and `renderer.js:37` — duplicated logic.

**Symptoms visible in code.**
- `controls.js:126-137` — after every button press, `controls.js` reaches into `appState` to mutate `presetKey`, `keyStack`, `currentKey`, `autoLoad`, then calls `updateScreen()`. This is navigation logic wedged into the input handler.
- `renderer.js:4` imports `keypressMasks` but never actually uses them in the file I audited — likely dead import.

**Payoff.** Medium. `toggleDspKey` duplication is a ticking bomb; navigation logic leaking into `controls.js` makes keyboard support (when added) harder.

**Refactor sketch.** Move `toggleDspKey` and the `keyStack` push/pop to a `navigation.js`. `controls.js` shrinks to: map DOM id → mask, send, dispatch a `KeyPressed` event. `renderer.js` stops importing `keypressMasks`.

---

## 5. `log()` defined in `main.js`, imported by `renderer.js`, passed as a parameter everywhere else

**What's tangled.** `log` lives in `main.js:61` but is imported directly by `renderer.js:7`, and passed as a positional argument through `midi.js`, `parser.js`, `config.js`, and `controls.js`. Every `send*` function takes an optional `log` parameter. The same function travels through the call graph both as a closure and as an argument.

**Symptoms visible in code.**
- `renderer.js:7` — imports `log`; `renderer.js:18` `updateScreen(logParam = null)` also accepts log as a param. Inconsistent.
- `midi.js:59,99,116,143` — every send function takes `log = null` and conditionally calls it.
- `parser.js:187` — `parseResponse(data, log)` forwards `log` into at least eight sites within parse.

**Payoff.** Medium. Low risk, high mechanical-cleanup value. Once centralized, filtering by level/category and pluggable sinks (e.g. remote log) become trivial.

**Refactor sketch.** Extract `log` + `levels` + `appState.logCategories` filtering into `logger.js`. Every module imports `log` from there. Remove the `log` parameter from all function signatures.

---

## Honourable mentions (not top 5, but worth noting)

- `renderer.js` is 749 lines and mixes five responsibilities: event handlers, screen layout, value formatting, softkey rendering, autoload logic. Splitting is Step 7+ territory.
- `index.html` binds 30+ `getElementById` calls in `main.js:10-46`. A small `dom.js` map would let the rest of the code stop caring about ids.
- Bitmap code in `parser.js` (denibble, renderBitmap, exportBMP) has nothing to do with sub/value parsing and belongs in its own `bitmap.js`.
