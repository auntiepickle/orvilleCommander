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
  - Screen rendering (text-based with params, softkeys, and breadcrumbs).
  - Virtual controls (buttons, keypad).
  - State management for navigation (key stack, values).
  - Debugging tools (logs, polling, config saving).

- **Tech Stack**:
  - JavaScript (ES modules).
  - WebMIDI API for MIDI.
  - HTML/CSS for UI.
  - No external libraries beyond WebMIDI.

## Setup and Installation
1. Clone the repo: `git clone <repo-url>`.
2. Open `index.html` in a modern browser (Chrome recommended for WebMIDI support).
3. Connect MIDI devices via the UI (select input/output ports).
4. Configure device ID (default: 0) and other settings (log level, bitmap fetching).
5. Use the virtual panel to navigate and interact.

**Dependencies**: None (vanilla JS), but requires browser MIDI access.

## Architecture
The app follows a modular structure with separation of concerns:
- **State Management**: Centralized in `state.js` (appState object).
- **MIDI Communication**: Handled in `midi.js` (send/receive SysEx).
- **Parsing**: In `parser.js` (processes responses, bitmap rendering).
- **Rendering**: In `renderer.js` (updates LCD with HTML/text).
- **Controls/UI**: In `controls.js` and `index.html` (button events).
- **Config/Persistence**: In `config.js` (localStorage).
- **Entry Point**: `main.js` (initializes everything, event listeners).

High-level diagram (Mermaid syntax—render in tools like GitHub or Mermaid Live):
```mermaid
graph TD
    A["User Input (Buttons/Keypad)"] --> B["controls.js"]
    B --> C["midi.js: Send SysEx/Keypress"]
    C --> D["Orville Device"]
    D --> E["midi.js: Receive SysEx"]
    E --> F["parser.js: Parse Response"]
    F --> G["state.js: Update appState"]
    G --> H["renderer.js: Render LCD"]
    H --> I["index.html: Display"]
    J["main.js: Init & Config"] --> G