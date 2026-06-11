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

// Stable-subtree cache policy (#113). Subtrees whose STRUCTURE rarely
// changes may trust cached child dumps across visits; the parser skips
// their per-visit child OBJECTINFO fan-out for keys tree.js deems fresh
// (param VALUES are still refreshed every visit). The program subtree is
// the one entry: its dumps are the heaviest on the link (the ~70-name bank
// list is multi-second at 31250 baud). In-app mutations are caught at two
// chokepoints (every VALUE_PUT under the prefix; every virtual front-panel
// keypress, which drives the real device UI); device-side mutations the app
// cannot observe (physical front panel, card swap, external MIDI program
// changes) are covered by Sync-to-Hardware / reconnect distrusting all
// stable caches. Staleness is per-KEY (tree.js staleKeys): a node becomes
// fresh again only when ITS dump is actually re-recorded, so dropped
// responses and deep visits can never launder staleness.
export const CACHE = {
  STABLE_SUBTREE_PREFIXES: ['10020'],
};

// Eager structure loader (#106). MAX_DEPTH bounds the breadth-first walk
// from the active preset: the deepest observed preset menu nesting is 2
// (menu -> sub-page, e.g. levels -> Post D/A Gain pages); 3 adds one level
// of margin. The visited set, not this bound, is the cycle guard.
export const EAGER = {
  MAX_DEPTH: 3,
};

// Canvas presentation for the bitmap screen (CSS, cosmetic only).
// x3 integer scale (240x64 -> 720x192) so the bitmap mirror and the virtual
// #lcd are the SAME physical size — one display, two modes (#130; the
// pixel font is likewise locked to x3, fractional scales smear it).
export const CANVAS = {
  CSS_WIDTH: '720px',
  CSS_HEIGHT: '192px',
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
