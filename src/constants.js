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
  DEVICE_LOAD_MS: 500, // wait for the device to process a preset load
  VALUE_DUMP_WAIT_MS: 500, // wait for a VALUE_DUMP to arrive after a change
  POLL_INTERVAL_MS: 500, // meter-polling re-request interval
  PARAM_REFRESH_TICKS: 10, // every Nth meter-poll tick also refreshes the on-page NUM/SET/INF/STR
  //                          values (at METER_POLL_MS=100 -> once per second): the device changes
  //                          values on its own (midiclock-measured Tempo BPM, ganged siblings) and
  //                          CON-only polling left them frozen at navigation time (live-observed
  //                          under external clock). Nth-tick pacing keeps the added traffic far
  //                          below the #107 saturation regime; the wave-open gate still applies.
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
  LOADING_PROGRAMS: 'loading programs ...', // the program field while an unseen
  //                   bank's list is on the wire (#141) — never the old bank's list
  SYNC_TO_BROWSE: 'sync to browse all banks', // load-menu hint when unsynced (#138):
  //                   the device lists only the current bank's programs at a time
  INDICATOR_BAR_CELLS: 8, // max bar width for spec-less indicator CONs: the only live-observed
  //                         case (the Tempo 'Beat' flasher) is binary 0/1, and a full-LCD-width
  //                         flashing slab overwhelmed the page (maintainer report, external-clock
  //                         test); 8 cells reads as a flash block while keeping 8-step resolution
  //                         for a hypothetical fractional indicator
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

// The DATA KNOB (#131; manual p.9 item L). Wheel-scroll and vertical drag
// spin it; each detent is one INC/DEC keypress. The refresh after a spin is
// a single trailing updateScreen, debounced — per-detent refreshes would
// flood the 31250-baud link exactly like the #107 meter-poll saturation.
export const KNOB = {
  DETENT_DEG: 18, // visual pointer step: 20 detents per revolution, encoder-like
  DRAG_PX_PER_DETENT: 12, // vertical drag distance per detent — comfortable mouse travel
  SETTLE_REFRESH_MS: 300, // trailing screen refresh after the last detent (≥ MIDI_SETTLE_MS)
  WHEEL_DELTA_PER_DETENT: 100, // accumulated wheel deltaY per detent: one Chrome mouse-wheel
  //                              notch is deltaY 100; pixel-mode trackpads stream 1-10 per
  //                              event, so accumulation (not per-event detents) keeps a flick
  //                              from bursting keypresses onto the 31250-baud link (review)
};

// Library sync + preset search (#142, src/library.js).
export const LIBRARY = {
  BANK_SETTLE_MS: 600, // wait after a bank PUT before requesting the load-menu
  //                      dump: the device needs to re-list its program SET
  //                      first (the #138 probes showed echoes inside ~100ms;
  //                      600ms is a comfortable multiple, still negligible
  //                      next to the ~4s dump transfer per bank)
  BANK_DUMP_TIMEOUT_MS: 15000, // give up on one bank's dump and move on: well
  //                              past the ~4-5s live-measured transfer, so it
  //                              only fires on a genuinely dropped response
  SEARCH_MAX_RESULTS: 24, // results dropdown cap — about a screenful; typing
  //                         more letters narrows better than scrolling
  SEARCH_MIN_PROGRAMS: 40, // search stays DISABLED below this corpus size: a
  //                          handful of banks gives so little coverage that
  //                          "no results" misleads more than it informs — one
  //                          bank is ~15 programs, so 40 ≈ a few banks synced
  LOAD_SETTLE_MS: 600, // wait between the search-load sequence's puts (bank ->
  //                      program -> load trigger): same settle rationale as
  //                      BANK_SETTLE_MS, applied to each step
  FAVORITES_BANK_IDX: 0, // bank 0 is the device's LIVE most-recently-used
  //                        "Favorites" bank (device-model.md §"Bank 0"): it
  //                        reorders on every load, so its program list is never
  //                        trusted from the static library snapshot — it is
  //                        re-fetched live whenever viewed (#138/#135 follow-up)
  FAVORITES_REFRESH_MS: 1200, // settle after selecting bank 0 + dumping it: the
  //                             MRU list is small (default 8 links, device-model.md
  //                             §"Bank 0") so its dump lands fast, but 2x
  //                             BANK_SETTLE_MS leaves margin for the
  //                             objectinfo:received listener to re-record it
};

// MIDI mapping (#146, src/midi-map.js): device-native modulation config.
export const MIDI_MAP = {
  CAPTURE_SETTLE_MS: 800, // wait after arming Capture Midi before the user/app
  //                         sends the CC to be learned: the device needs to be
  //                         listening; 800ms is comfortably past the ~100ms
  //                         echo seen on the assign Capture probes, still snappy
  UI_REFRESH_MS: 600, // the MIDI modals wait this long after a write/refresh
  //                     before re-reading the device and repainting — long
  //                     enough for the assign/surface OBJECTINFO + VALUE echoes
  //                     to land (PUTs are self-confirming, §9)
  BIND_STEP_MS: 300, // pace between cursor keypresses while binding a parameter
  //                    (driving the device highlight to the target row)
  BIND_SETTLE_MS: 600, // wait after parameter/select-hold before reading the
  //                      bound surface back (the page swap is near-instant but
  //                      the OBJECTINFO round-trip needs room)
  BIND_READ_TRIES: 4, // re-request the bound surface up to this many times if its
  //                     OBJECTINFO hasn't landed yet (a single read sometimes
  //                     came back blank and falsely reported "could not bind")
  LEARN_POLL_TRIES: 20, // how many times the Learn flow polls for a captured
  //                       controller before giving up (x UI_REFRESH_MS ~= 12s)
  // The device's parameter-page grid, probed live (device-model §8b "navigation
  // to a parameter"). A program's params are grouped into blocks (the preset's
  // COL children); the device shows ONE block at a time as a grid of GRID_ROWS x
  // GRID_COLS cells, filled COLUMN-MAJOR in the block's dump order. Pressing the
  // block's softkey selects it (page 0); each FURTHER press of the same softkey
  // advances one page (cursor returns to the page's top-left each press). So a
  // param at dump-index i in block b is reached by:
  //   program -> parameter -> soft(b+1) x (floor(i/PAGE)+1)
  //            -> RIGHT x floor((i%PAGE)/GRID_ROWS) -> DOWN x ((i%PAGE)%GRID_ROWS)
  GRID_ROWS: 4, // params per column on a parameter page (DOWN clamps at row 3)
  GRID_COLS: 2, // columns shown per page (RIGHT clamps at col 1; col 2+ = next page)
  BLOCK_SOFTKEYS: 4, // soft1..soft4 select blocks 0..3; more blocks aren't reachable
};

// Demo mode (src/demo.js): the canned device built from a live capture.
export const DEMO = {
  REPLY_LATENCY_MS: 25, // per-reply delay so the dump-wave lifecycle (BUSY
  //                       LED, progressive paints) behaves like the wire —
  //                       an instant reply would synchronously re-enter the
  //                       parser inside the send call
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
