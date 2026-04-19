# Orville Commander

A browser front-end for the Eventide Orville: WebMIDI in, SysEx out, emulated LCD screen rendered from text dumps. Vanilla ES modules, no framework.

## How to run

```
npm run dev     # Vite dev server, src/ as root
npm test        # Jest + jsdom
npm run combine # Concatenate src/ into combine/ (LLM pasting aid)
npm run zip     # Archive repo into orvilleCommander.zip
```

Open the dev URL in Chrome, Edge, or Opera (WebMIDI requirement — Firefox and Safari will silently fail to connect). Grant MIDI permissions, pick input/output ports, set device ID (default 0).

## Architecture (current, not aspirational)

```
index.html
  └─ main.js        entry point, DOM wiring, connectMidi, log()
      ├─ config.js          localStorage load/save/clear
      ├─ controls.js        keypress masks + button → SysEx mapping
      ├─ midi.js            WebMIDI send, SysEx encoding, listener
      ├─ parser.js          SysEx byte stream → structured subs & values
      ├─ renderer.js        subs → LCD HTML, event handlers
      └─ state.js           appState singleton (shared mutable)
```

Data flow: user clicks → `controls.js` sends SysEx via `midi.js` → Orville responds → `midi.js` listener → `parser.js` mutates `appState` → `renderer.js` paints `#lcd`. Bitmap path: `0x17` SysEx → `parser.js` denibbles → canvas.

## Known structural issues (refactor in flight)

Five import cycles exist and must be dismantled in the order specified in `docs/refactor/04-roadmap.md`. They are currently load-tolerated by ES modules because everything across the cycles is accessed late (function calls, not top-level reads) — but that is not license to 'fix' them opportunistically. Order matters.

1. `midi.js` ↔ `parser.js`
2. `parser.js` ↔ `renderer.js`
3. `parser.js` ↔ `main.js`
4. `renderer.js` ↔ `main.js`
5. `controls.js` ↔ `renderer.js`

See `docs/refactor/` for the dependency graph, coupling analysis, and the eight-step roadmap. See `docs/refactor/future-work.md` for ideas explicitly deferred past the roadmap. **Check the roadmap before proposing structural changes** — work happens in a specific order to keep each commit shippable.

`appState` (in `state.js`) is a shared mutable object every module writes to directly. Treat it as legacy; Step 4 of the roadmap introduces a `store.js` façade.

`toggleDspKey` is defined twice (`controls.js:63` and `renderer.js:37`). Don't fix it in isolation — it dies in Step 8.

## Testing

Jest config: `jest.config.cjs` → babel-jest transform, jsdom environment.

- `tests/parser.test.js` — real coverage of `parseResponse` and `parseSubObject`.
- `tests/renderer.test.js` — covers SET change, NUM click, TRG click flows.
- `tests/main.test.js` — removed in roadmap step 1 (it imported functions that didn't exist in main.js and pulled in missing devDependencies). Real coverage for main.js can be added later if needed.

When writing new tests:
- Mock `webmidi`, `./src/midi.js`, and `./src/main.js` per the patterns already in `parser.test.js`.
- Use `jest.useFakeTimers()` — parser and renderer both schedule via `setTimeout` + debounce.
- `jest.mock('lodash.debounce', () => (fn) => fn)` makes the debounce synchronous.

## Protocol quick reference

All SysEx is framed `F0 1C 70 <deviceId> <cmd> ... F7`. Commands seen in code:

| Cmd | Direction | Meaning |
|---|---|---|
| `0x01` | out | Keypress (4-byte mask nibbled to 8 bytes) |
| `0x17` | in | Screen bitmap (nibbled 13-byte header + 1920 bytes of 240×64 1bpp) |
| `0x18` | out | Request screen bitmap |
| `0x2d` | out | VALUE_DUMP request / VALUE_PUT (with `0x20` separator + value) |
| `0x2e` | in | VALUE_DUMP response |
| `0x31` | out | OBJECTINFO_DUMP request |
| `0x32` | in | OBJECTINFO_DUMP response (ASCII sub-object lines) |

Keypress masks are hex-encoded button state; `system_commands.txt` at the repo root is the canonical source — `controls.js:keypressMasks` must match it. If they diverge, `system_commands.txt` wins.

Sub-object types in the ASCII dump: `COL` (column/menu), `NUM`, `SET`, `CON` (continuous/meter), `TRG`, `INF`. See `parseSubObject` for field order.

## Conventions

- ES modules only (`"type": "module"`).
- No TypeScript. No JSX. No React.
- `lodash.debounce` and `webmidi` are the only runtime deps — don't add more without discussion.
- No emoji in code or logs.
- Prefer editing existing files; this repo is small enough that splitting should be deliberate (roadmap Step 6+).
- Keep comments minimal — the JSDoc on existing exports is fine; don't narrate new code unless the *why* is non-obvious.
- When touching render logic, add a renderer snapshot test first (see `03-test-coverage-gap.md`).
- Before claiming a task complete, run `npm test` and report the output. Do not declare success based on reading the diff.
- Commit messages follow conventional commits (`fix:`, `refactor:`, `test:`, `docs:`, `chore:`). Reference the roadmap step in the body when relevant.
- If a task grows beyond its stated scope mid-session, stop and ask rather than expanding. Mechanically necessary follow-throughs (e.g., updating a test mock after an import change) are in-scope and do not require asking.
- Refactor work happens on the `refactor_main` branch. Never commit directly to `main`. If `git branch --show-current` shows `main`, stop and ask.

## Build tools (repo root, not src/)

- `build_tools/combine.cjs` — concatenates `src/*.js` (no CSS) into 20KB chunks under `combine/`. Output is for pasting into LLM contexts.
- `build_tools/zip.js` — archives the working tree (minus `.git`, `node_modules`, zips) via `archiver`. Used by `npm run push`.
- `build_tools/apply_diff.js` — applies a named `.diff` with `git apply --reject`; falls back to a hand-rolled hunk parser. Creates a `.bak` before applying.

## Where state lives

Everything runtime is on `appState` (state.js). Everything persistent is in `localStorage.midiConfig` (config.js). There is no other store. If you need durable state, add it to `midiConfig` via `saveConfig`.

## Dev server quirks

`vite.config.js` forces `usePolling: true` and explicit HMR host — this is intentional for WSL2/Windows. Don't remove unless you know the reviewer's OS.

## Smoke test before merging

1. `npm test` passes.
2. `npm run dev` — connect to real Orville (or, if offline, upload a known-good debug file via the "Process Debug File" button and confirm the bitmap renders).
3. Navigate into a preset, change a SET parameter, confirm the LCD updates and the device reflects the change.
4. Toggle A/B; confirm the clicked preset name highlights and both DSPs still render.
