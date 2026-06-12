# Orville Commander

A web-based remote interface for viewing and controlling the Eventide Orville effects processor screen via MIDI. Built with WebMIDI, JavaScript, and HTML/CSS. The goal is to enable remote access on devices like browsers, with future cross-platform potential once a prototype is complete.

## Table of Contents
- [Overview](#overview)
- [Setup and Installation](#setup-and-installation)
- [Architecture](#architecture)
- [Key Modules](#key-modules)
- [Data Flow](#data-flow)
- [Known Issues and Refactoring Opportunities](#known-issues-and-refactoring-opportunities)
- [Contributing](#contributing)

## Overview
This project emulates the Orville's LCD screen and controls in a browser, using SysEx MIDI messages for communication. It parses responses, renders the screen as text/HTML (with optional bitmap canvas), and handles user interactions like keypresses and value changes.

- **Core Features**:
  - MIDI connection and SysEx handling.
  - Screen rendering (text-based with params, softkeys, and breadcrumbs) plus an optional pixel-accurate bitmap canvas.
  - Virtual rack-unit faceplate with a phosphor LCD and a tokenized theme engine (theme presets + per-token color overrides, persisted).
  - Virtual controls (buttons, keypad, data knob) and in-glass inline parameter editing (no browser prompt/alert dialogs).
  - State management for navigation (key stack, values) backed by a persistent device object tree.
  - Synced preset library with name search and a per-program Favorites list, with an on-LCD sync progress dialog.
  - Preset browser modal: search, preview a program on the idle DSP (auto-restored on dismiss), and load to A/B.
  - Device-native MIDI mapping: assign MIDI controllers to any parameter (source/range/type) running in the DSP itself, with persisted mapped-param badges.
  - Demo Mode: a captured device tree for offline, hardware-free browsing of the full UI.
  - Debugging tools (logs, meter polling, config saving, debug-file processing).

- **Tech Stack**:
  - JavaScript (ES modules).
  - WebMIDI API for MIDI.
  - HTML/CSS for UI.
  - Runtime dep: `webmidi` only. Dev: Vite, Jest, ESLint, Prettier.

## Setup and Installation
1. Clone the repo: `git clone <repo-url>`.
2. Install dependencies: `npm install`.
3. Start the dev server: `npm run dev` (Vite), then open the printed URL in Chrome, Edge, or Opera (WebMIDI support; Firefox/Safari silently fail).
4. Connect MIDI devices via the UI (select input/output ports).
5. Configure device ID (default: 0) and other settings (log level, bitmap fetching).
6. Use the virtual panel to navigate and interact.

**Dependencies**: `webmidi` (runtime); requires browser MIDI access.

## Architecture
The app follows a modular structure with separation of concerns:
- **State Management**: Centralized in `state.js`/`store.js` (appState object behind an audited `setState`).
- **MIDI Communication**: Handled in `midi.js` (send/receive SysEx, inbound reassembly).
- **Parsing**: In `parser.js` (processes responses, emits events).
- **Rendering**: In `renderer.js` (LCD HTML) and `bitmap.js`/`framebuffer.js` (screen-capture canvas), driven by `event-bridge.js` off the `events.js` bus.
- **Controls/UI**: In `controls.js` and `index.html` (button events).
- **Config/Persistence**: In `config.js` (localStorage).
- **Entry Point**: `main.js` (initializes everything, event listeners).

High-level diagram:
```mermaid
graph TD
    A["User Input (Buttons/Keypad)"] --> B["controls.js"]
    B --> C["midi.js: Send SysEx/Keypress"]
    C --> D["Orville Device"]
    D --> E["midi.js: Receive + reassemble SysEx"]
    E --> F["parser.js: Parse Response"]
    F --> G["store.js: Update appState"]
    F --> K["events.js: Emit events"]
    K --> L["event-bridge.js: Render on parser/midi events"]
    L --> H["renderer.js: Render LCD"]
    H --> I["index.html: Display"]
    J["main.js: Init & Config"] --> G
```

## Key Modules

* state.js / store.js: Holds global appState (e.g., currentKey, values, stack) behind `setState`. Why? Single source of truth for reactivity.

* midi.js: Manages ports, listeners, SysEx commands (e.g., sendObjectInfoDump), and inbound multi-packet reassembly. Key functions: setMidiPorts, sendSysEx, addSysexListener.

* parser.js: Parses ASCII dumps into subs/objects and emits events. Exports: parseResponse.

* event-bridge.js / events.js: Pub/sub bus + event-driven render triggers between parser and renderer (renders on dump arrival, child arrival, and dumpComplete — no timers or debounce).

* tree.js: Persistent device object tree; the parser records every OBJECTINFO dump, and navigation (keyStack ancestry, child lookups, softkey labels) derives from it (T1b).

* eager-loader.js: Background structure warm-up for the active preset tree after the connect landing — serialized breadth-first OBJECTINFO walk, one request in flight (#106).

* navigation.js: toggleDspKey (A/B preset key prefix flip).

* renderer.js: Builds HTML for LCD (params, softkeys, breadcrumbs). Handles clicks/changes. Exports: updateScreen, renderScreen.

* bitmap.js / framebuffer.js: Decode the `0x17` screen dump and paint the capture canvas. Exports: renderBitmap, computePixels.

* controls.js: Maps buttons to keypress masks; sets up event listeners and the meter-poll tick. Exports: setupKeypressControls, meterPollTick.

* library.js: Synced preset library (full bank scan + name search) and the device-touching load path (loadProgram / loadProgramToDsp). Backs the load menu, preset browser, and preview.

* preset-loader.js: DOM-free single source of truth for the load-menu dropdowns — local staging backed by the library (#138).

* preset-browser.js: Top-level modal to browse/search the library, preview a program on the idle DSP (remember-and-restore), and load to A/B (#153/#135).

* sync-dialog.js: Library-sync progress overlay drawn on the LCD (defrag-style bank map).

* midi-map.js / midi-map-ui.js: Device-native MIDI mapping — assign controllers, per-parameter source/range/type, tree-derived parameter binding, and the two themed modals (#146).

* theme.js: Tokenized theme engine — presets + per-token overrides on `:root`, with the service-panel editor.

* demo.js / demo-data.js: Demo Mode — a captured device tree (an ES module) served through the real midi.js port contract for offline use.

* sysex-commands.js / constants.js: Protocol constants (CMD / KEY / MOD / MOD_SOURCES) and named app constants (timing, cache prefixes, MIDI_MAP grid, storage key) — the no-magic-numbers home.

* logger.js: Gated `log()` that owns its own log level and per-category visibility.

* main.js: Bootstraps app, connects MIDI, adds listeners. Exports: showLoading, hideLoading.

* config.js: Loads/saves config to `localStorage.midiConfig` (ports, logs, theme, synced library, MIDI-map badges). Exports: loadConfig, saveConfig, saveThemeConfig, saveLibraryConfig, saveMidiMappings.

* index.html: UI layout (faceplate, LCD, buttons, service panel, debug tools).

## Data Flow

1. User clicks button → controls.js sends keypress via midi.js.

2. Device responds with SysEx → midi.js listener reassembles it → parser.js processes.

3. parser.js updates appState (store.js) and emits events on events.js.

4. event-bridge.js renders on dump arrival / dumpComplete and renderer.js re-renders the LCD (index.html).

5. For values: Similar flow with VALUE_DUMP/PUT.

Polling (e.g., meters) runs intervals in main.js.

## Known Issues and Refactoring Opportunities

The eight-step decoupling refactor that resolved the original tight-coupling,
testing, and render-pipeline items is complete (merged in PR #23). Active
production-readiness work is tracked in the checked-in ledger
[`docs/issue-tracker.md`](docs/issue-tracker.md) (mirrored to
[GitHub Issues](https://github.com/auntiepickle/orvilleCommander/issues)), with
the Phase 3 design in
[`docs/refactor/phase3-state-model.md`](docs/refactor/phase3-state-model.md).

The SysEx wire format is in [`docs/protocol.md`](docs/protocol.md) and the
device behaviour spec in [`docs/device-model.md`](docs/device-model.md).

## Contributing

* Fork and PR changes.

* Focus on one feature/fix per PR (e.g., "Add JSDoc to midi.js").

* Use git commit messages like: "docs: add initial README structure for overview and architecture".
