// constants.js
// Central home for app-level tunables (timing, layout, canvas, storage). This
// is the obvious place to adjust these as more code is refactored. Protocol
// facts (command bytes, framing, keys, screen geometry) live in
// sysex-commands.js instead.

// Render / MIDI timing, in milliseconds. Several of these are interim timers
// that the planned dumpComplete-event rework (Phase 3.1) is expected to remove;
// naming them here keeps the current code readable and tunable in one place.
export const TIMING = {
  METER_POLL_MS: 100, // meter polling interval
  RENDER_DEBOUNCE_MS: 200, // event-bridge render debounce
  RENDER_COALESCE_MS: 200, // objectinfo/value -> render setTimeout
  MIDI_SETTLE_MS: 200, // wait after a send before refreshing the screen
  PROGRAM_SET_MS: 300, // extra wait to ensure a program value is set
  DEVICE_LOAD_MS: 500, // wait for the device to process a preset load
  VALUE_DUMP_WAIT_MS: 500, // wait for a VALUE_DUMP to arrive after a change
  PORT_INIT_MS: 500, // delay after auto-selecting cached ports at boot
  POLL_INTERVAL_MS: 500, // meter-polling re-request interval
  REDUMP_MS: 200, // parser re-dump after the Favorites re-order fix
  WATCHDOG_MS: 1500, // per-wave dump-complete hard ceiling
  SYNC_STEP_MS: 1000, // pause between steps of the dev sync test loop
};

// LCD text layout.
export const LAYOUT = {
  LCD_COLUMNS: 40, // characters across the emulated LCD line
  SOFTKEYS_PER_LINE: 4, // softkeys rendered per row
  SHORT_TAG_MAX: 10, // max tag length treated as a softkey-eligible COL
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
