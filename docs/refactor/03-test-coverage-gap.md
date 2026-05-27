# Test Coverage Gap Analysis

## Current state of `tests/`

| Test file | What it covers | Status |
|---|---|---|
| `parser.test.js` | `parseResponse` (5 paths), `parseSubObject` (NUM/SET/CON/unknown) | **Real coverage.** Useful; uses fake timers, mocks renderer/midi/main. |
| `renderer.test.js` | 3 scenarios: SET select change auto-loading program, NUM click prompt validation, TRG click preset load | **Real coverage** of the two most bug-prone event handlers. |
| `main.test.js` | imports `initMidi`, `setupUI`, `togglePolling`, `selectPorts` — **none of which exist** in `src/main.js` | **Broken.** Also uses `@testing-library/dom` + `@testing-library/jest-dom` which aren't in `package.json`. File will not run. |

Run `npm test` today and `main.test.js` will fail at the import step.

## Modules with zero real coverage

### `midi.js` — zero tests

Highest priority after fixing main. This module is the I/O boundary; every SysEx byte on the wire goes through it.

**Characterization tests to write (module-scoped, no browser):**
- `setMidiPorts(output, input, 5)` sets `appState.deviceId = 5`.
- `sendSysEx(cmd, bytes, log)` with no output selected logs `'Error: MIDI output not set'` and does not throw.
- `sendSysEx(0x18, [], log)` calls `output.sendSysex([0x1c, 0x70], [deviceId, 0x18])` — byte-level assertion against a mock output.
- `sendObjectInfoDump('401000b')` encodes the key as ASCII bytes `[0x34, 0x30, 0x31, 0x30, 0x30, 0x30, 0x62]` and prepends `0x31`.
- `sendValuePut('8060001', '3')` encodes key, `0x20` separator, then value ASCII.
- `sendKeypress([0xFE,0xFF,0xFD,0xFF])` produces the nibbled 8-byte sequence `[0x0F,0x0E,0x0F,0x0F,0x0F,0x0D,0x0F,0x0F]` — pin down the `nibble()` helper.
- `addSysexListener` with no input logs error and does not throw.
- `addSysexListener` routes a message whose 5th byte is `0x17` to `parseResponse` and categorizes as `screenDump`. Spy on `parseResponse`.

Bytes are the contract. Lock them.

### `controls.js` — zero tests

**Characterization tests:**
- `keypressMasks` snapshot: compare the full table against the canonical codes in `system_commands.txt` (this catches any accidental edit).
- `setupKeypressControls` wires a click handler to every `*-btn` id present in `index.html`.
- Clicking `up-btn` calls `sendKeypress(keypressMasks['up'])` exactly once.
- Clicking `ab-btn` while `appState.currentKey === '0'` toggles `presetKey` between `'4xxxxxxb'` and `'8xxxxxxb'`; leaves it alone when not at root.
- Clicking `parameter-btn` at root pushes to `keyStack`, sets `currentKey = presetKey`, sets `autoLoad = true`.
- With `appState.fetchBitmap = false`, no `sendSysEx(0x18, ...)` is issued after a button press.

### `config.js` — zero tests

Trivial but worth pinning:
- `loadConfig` with nothing in `localStorage` returns `null`.
- `loadConfig` restores `deviceId`, `logLevel`, `fetchBitmap`, `updateBitmapOnChange` onto the passed DOM elements.
- `saveConfig` round-trips through `localStorage.getItem('midiConfig')`.
- `clearConfig` removes the key.
- Missing fields in stored JSON fall back to documented defaults (`deviceId=0`, `logLevel='info'`, `fetchBitmap=true`, `updateBitmapOnChange=true`).

### `main.js` — tests exist but are broken

**First:** delete or rewrite `main.test.js` — it tests a non-existent API. Before refactoring anything else, the test runner should be green.

**Replacement characterization tests** (against current API — `log`, `showLoading`, `hideLoading`):
- `log('hello', 'info', 'general')` appends a timestamped line to `#log-area`.
- `log('x', 'debug', 'general')` is suppressed when `appState.logLevel === 'info'`.
- `log('x', 'info', 'bitmap')` is suppressed when `appState.logCategories.bitmap === false`.
- `showLoading()` adds class `loading` to `#lcd`; `hideLoading()` removes it.
- Module-load behavior — clicking `copy-log` writes `logArea.value` via `navigator.clipboard.writeText`. (Harder; requires importing `main.js` under jsdom with clipboard mocked. Optional for Phase 1.)

### `state.js` — zero tests, and that's fine

Pure data literal. No behavior to test. Skip until it grows setters.

### Rendering internals in `renderer.js` — partial coverage

`renderScreen` has three covered scenarios but many uncovered cases. Before refactoring the render pipeline, lock these down so behavior changes are caught:
- Root screen (`currentKey === '0'`): renders DSP A/B clickable spans, builds 4-column softkey grid from COL subs with `tag`.
- `formatValue('%3.0f', 5.5)` → `'  6'`.
- `formatValue('%-10s', 'test')` → `'test      '`.
- `formatValue('%%', 0.5, false)` — percent escape behavior.
- Graphic EQ grouping: NUM subs with `position === 'a'` are joined on one line.
- Breadcrumb rendering when `keyStack.length > 0`.
- Ancestor softkey rendering when `keyStack.length > 2` (multi-level breadcrumb).
- CON meter rendering with `meterValue = NaN` clamps to 0.
- `handleLcdClick` on `.back-link` pops the stack and calls `updateScreen`.
- `handleLcdClick` on `.dsp-clickable` pushes current to stack and swaps `presetKey`.

These are the "what does the LCD actually look like for input X" assertions. Pure snapshot tests on `lcdEl.innerHTML` are acceptable for this layer — they'll catch unintended layout drift during the split.

## Recommended ordering

1. **Fix `main.test.js`** so `npm test` runs clean (delete it or rewrite for current API).
2. **Add `midi.js` tests** — lock the on-the-wire byte contract before touching parser.
3. **Add `controls.js` keypress-mask snapshot** — prevents silent mask drift during any refactor.
4. **Add `renderer.js` golden-snapshot tests** for the 8 scenarios above before splitting the file.
5. **Parser tests grow** as parse-vs-side-effect separation happens (Step 3 of the roadmap).

No TypeScript, no new deps — Jest + jsdom handle all of the above.
