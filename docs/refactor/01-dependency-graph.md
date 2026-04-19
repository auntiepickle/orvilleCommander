# Module Dependency Graph

Source of truth: the `import` statements in every file under `src/`.

## Raw import table

| Module | Internal imports | External imports |
|---|---|---|
| `main.js` | `config.js` (loadConfig, saveConfig, clearConfig), `controls.js` (setupKeypressControls, testKeypress), `midi.js` (setMidiPorts, addSysexListener, sendSysEx, sendValueDump, sendValuePut, sendObjectInfoDump), `renderer.js` (updateScreen, toggleDspKey), `state.js` (appState), `parser.js` (denibble, renderBitmap, extractNibbles, exportBMP) | `webmidi` (WebMidi) |
| `state.js` | — | — |
| `config.js` | — | — |
| `midi.js` | `parser.js` (parseResponse), `state.js` (appState) | — |
| `parser.js` | `renderer.js` (renderScreen, updateScreen), `state.js` (appState), `main.js` (hideLoading), `midi.js` (sendValuePut, sendValueDump, sendObjectInfoDump) | `lodash.debounce` |
| `renderer.js` | `state.js` (appState), `midi.js` (sendObjectInfoDump, sendValueDump, sendValuePut, sendSysEx), `controls.js` (keypressMasks), `parser.js` (parseSubObject), `main.js` (showLoading, log) | — |
| `controls.js` | `midi.js` (sendKeypress, sendSysEx), `renderer.js` (updateScreen), `state.js` (appState) | — |

## ASCII graph (internal edges)

```
               ┌──────────┐
               │ state.js │◄──────── imported by all others
               └──────────┘
                    ▲
                    │
  ┌────────┐   ┌────▼────┐   ┌──────────┐
  │config  │   │ main.js │──►│controls  │
  │.js     │◄──│         │──►│.js       │
  └────────┘   │         │   └────┬─────┘
               │         │        │
               │         ▼        ▼
               │     ┌────────┐  ┌────────┐
               └────►│parser  │◄─│renderer│
                     │.js     │─►│.js     │
                     └────┬───┘  └────┬───┘
                          ▲           ▲
                          │           │
                          └────┬──────┘
                               ▼
                           ┌───────┐
                           │midi.js│
                           └───────┘
```

## Cycles (confirmed)

All five are real — each side imports a named symbol from the other.

1. **`midi.js` ↔ `parser.js`** — `midi.js` imports `parseResponse`; `parser.js` imports `sendValuePut`/`sendValueDump`/`sendObjectInfoDump`.
2. **`parser.js` ↔ `renderer.js`** — `parser.js` imports `renderScreen`/`updateScreen`; `renderer.js` imports `parseSubObject`.
3. **`parser.js` ↔ `main.js`** — `parser.js` imports `hideLoading`; `main.js` imports `denibble`/`renderBitmap`/`extractNibbles`/`exportBMP`.
4. **`renderer.js` ↔ `main.js`** — `renderer.js` imports `showLoading`/`log`; `main.js` imports `updateScreen`/`toggleDspKey`.
5. **`controls.js` ↔ `renderer.js`** — `controls.js` imports `updateScreen`; `renderer.js` imports `keypressMasks`.

ES modules tolerate cycles at load time, but any of these would break if someone accessed the imported binding at module top level. Today everything imported across a cycle is either a function called later or the mutable `appState` object, so it works by luck, not design.

## Fan-in / fan-out

| Module | In-degree (imported by) | Out-degree (imports) |
|---|---|---|
| `state.js` | 5 | 0 |
| `midi.js` | 4 | 2 |
| `renderer.js` | 3 | 5 |
| `parser.js` | 3 | 4 |
| `main.js` | 2 | 6 |
| `controls.js` | 1 | 3 |
| `config.js` | 1 | 0 |

`state.js` and `midi.js` are the hubs; `renderer.js` and `parser.js` are the most entangled.
