# Orville Commander

A browser front-end for viewing and controlling the Eventide Orville over MIDI.
It talks to the unit's SysEx interface, reconstructs the LCD from the device's
text dumps, and renders it as HTML (plus an optional 1bpp screen-capture canvas),
so the device can be driven from a browser instead of the front panel.

Vanilla ES modules, no UI framework.

## Quick start

```
npm install
npm run dev      # Vite dev server, src/ as root — open the printed URL
```

Use **Chrome, Edge, or Opera** — WebMIDI is required, and Firefox/Safari will
silently fail to connect. Grant MIDI permission, pick the input/output ports,
set the device ID (default 0), then navigate with the on-screen panel.

Other scripts:

```
npm test           # Jest + jsdom
npm run lint       # ESLint (flat config)
npm run format     # Prettier
npm run screenshot # Hardware-in-the-loop: capture the live screen to a PNG (needs the device)
```

**Dependencies:** runtime — `webmidi` and `lodash.debounce` only. Dev toolchain —
Vite, Jest, ESLint, Prettier, Babel.

## Architecture

User input → `controls.js` sends SysEx via `midi.js` → the Orville replies →
`midi.js`'s inbound listener reassembles multi-packet SysEx and hands complete
messages to `parser.js` → the parser writes state via `store.setState` and emits
events on the `events.js` bus → `event-bridge.js` coalesces those and calls the
renderer → `renderer.js` paints the LCD (and `bitmap.js`/`framebuffer.js` paint
the screen-capture canvas).

| Module | Role |
|---|---|
| `main.js` | Entry point: DOM wiring, connect flow, event-bridge registration |
| `controls.js` | Front-panel keypress masks + button → SysEx mapping |
| `midi.js` | WebMIDI send, SysEx framing, inbound reassembly, dump-wave counter |
| `parser.js` | SysEx byte stream → structured sub-objects & values; emits events |
| `event-bridge.js` | Subscribes to parser events; owns render timing |
| `renderer.js` | Sub-objects → LCD HTML; click/change handlers |
| `bitmap.js` / `framebuffer.js` | `0x17` screen-dump decode + canvas render |
| `store.js` / `state.js` | `appState` singleton behind an audited `setState` |
| `events.js` | Tiny pub/sub bus (`emit` / `on`) |
| `sysex-commands.js` | `CMD` / `KEY` / `SYSEX` / `SCREEN` protocol constants |
| `sysex-split.js` | Shared ASCII dump tokenizer |
| `navigation.js` | `toggleDspKey` |
| `logger.js` | Gated `log()` + its own log-level/category config |
| `hex-extract.js` | Debug-file hex parsing |

The eight-step decoupling refactor that broke the original import cycles is
complete (merged in PR #23). `CLAUDE.md` has the authoritative, current
architecture and conventions.

## How the device works

The SysEx wire format is in [`docs/protocol.md`](docs/protocol.md); the device's
behaviour (object tree, presets, value semantics, screen format, quirks) is in
[`docs/device-model.md`](docs/device-model.md) — a from-scratch spec built by
reverse-engineering plus live hardware capture. All frames are
`F0 1C 70 <deviceId> <cmd> … F7`.

## Status & contributing

Production-readiness work is tracked in two places that mirror each other:
[GitHub Issues](https://github.com/auntiepickle/orvilleCommander/issues) and the
checked-in ledger [`docs/issue-tracker.md`](docs/issue-tracker.md) (the
resumable source of truth). The active Phase 3 design is in
[`docs/refactor/phase3-state-model.md`](docs/refactor/phase3-state-model.md).

- One feature/fix per PR; conventional-commit messages (`fix:`, `refactor:`,
  `test:`, `docs:`, `chore:`).
- `npm test`, `npm run lint`, and `npm run format:check` must pass; CI enforces them.
- When a PR resolves a tracked GitHub issue, put `Closes #N` in the body.
- See `CLAUDE.md` for the full conventions and the smoke-test checklist.
