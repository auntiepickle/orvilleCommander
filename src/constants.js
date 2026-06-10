// constants.js
// Central home for app-level tunables (timing, layout, canvas, storage). This
// is the obvious place to adjust these as more code is refactored. Protocol
// facts (command bytes, framing, keys, screen geometry) live in
// sysex-commands.js instead.

// Render / MIDI timing, in milliseconds. The render-coalescing timers were
// removed by the Phase 3.1 dumpComplete rework (C1); what remains is outbound
// pacing (device settle/processing time) and the wave watchdog.
export const TIMING = {
  METER_POLL_MS: 100, // meter polling interval
  MIDI_SETTLE_MS: 200, // wait after a send before refreshing the screen
  PROGRAM_SET_MS: 300, // extra wait to ensure a program value is set
  DEVICE_LOAD_MS: 500, // wait for the device to process a preset load
  VALUE_DUMP_WAIT_MS: 500, // wait for a VALUE_DUMP to arrive after a change
  POLL_INTERVAL_MS: 500, // meter-polling re-request interval
  REDUMP_MS: 200, // parser re-dump after the Favorites re-order fix
  WATCHDOG_IDLE_MS: 1500, // dump-complete idle/silence watchdog, rearmed on each send and receive;
  //                         well over the sub-second gap between responses in a healthy wave, so it
  //                         fires only on a genuine stall (see docs/protocol.md "the dump wave")
  WATCHDOG_MAX_MS: 10000, // dump-complete absolute per-wave ceiling regardless of activity; comfortably
  //                         above the slowest observed enumeration (bank list ~4-6s, device-model.md §9)
  SYNC_STEP_MS: 1000, // pause between steps of the dev sync test loop
};

// LCD text layout.
export const LAYOUT = {
  LCD_COLUMNS: 40, // characters across the emulated LCD line
  SOFTKEYS_PER_LINE: 4, // softkeys rendered per row
  SHORT_TAG_MAX: 10, // max tag length treated as a softkey-eligible COL
};

// R3 render guard (#106): pre-paint presentation for nodes whose live dump
// has not landed yet. The placeholder substitutes for every value format
// specifier ('...' matches the tree's blank-label placeholder); the loading
// statement is the synthetic title when the tree has never seen the key.
export const RENDER = {
  VALUE_PLACEHOLDER: '...',
  LOADING_STATEMENT: 'loading ...',
};

// Canvas presentation for the bitmap screen (CSS, cosmetic only).
export const CANVAS = {
  CSS_WIDTH: '480px',
  CSS_HEIGHT: '128px',
  ASPECT_RATIO: '240 / 64',
  IMAGE_RENDERING: 'pixelated',
};

// Persistent config (localStorage).
export const STORAGE_KEY = 'midiConfig';
export const DEFAULT_LOG_LEVEL = 'info';

// Default log-category visibility. Owned here (not on appState) so logger.js can
// hold its own config without importing state.js — see logger.js. stateWrite is
// off by default (verbose per-write tracing); everything else on.
export const DEFAULT_LOG_CATEGORIES = {
  sysexReceived: true,
  sysexSent: true,
  parsedDump: true,
  valueChange: true,
  noChange: true,
  renderScreen: true,
  bitmap: true,
  screenDump: true,
  error: true,
  general: true,
  stateWrite: false,
};
