// sysex-commands.js
// Named constants for the Eventide Orville SysEx protocol. system_commands.txt
// at the repo root is the canonical source for button presses; the rest is
// reverse-engineered. All frames are F0 1C 70 <deviceId> <cmd> ... F7.

// SysEx framing bytes.
export const SYSEX = {
  START: 0xf0, // F0 SysEx start (first byte of every inbound message)
  END: 0xf7, // F7 SysEx end (inbound reassembly terminator; also a text marker when scanning hex dumps)
  MANUFACTURER: [0x1c, 0x70], // Eventide ID + DSP4000 product ID
  VALUE_SEPARATOR: 0x20, // space between key and value in a VALUE_PUT
  FRAME_PREFIX_LEN: 5, // F0 1C 70 <deviceId> <cmd> before the payload
};

// Screen-dump (0x17) geometry, after denibbling. The 12-byte header is three
// big-endian u32 fields (width, height, bitmap size in bytes), followed by the
// 1bpp pixel data and a 1-byte checksum. See docs/protocol.md "Screen bitmap".
export const SCREEN = {
  WIDTH: 240, // fallback width if the header is missing/insane
  HEIGHT: 64, // fallback height if the header is missing/insane
  HEADER_BYTES: 12, // header bytes before the 1bpp pixel data
  WIDTH_OFFSET: 0, // u32 width field
  HEIGHT_OFFSET: 4, // u32 height field
  SIZE_OFFSET: 8, // u32 bitmap-size field
  CHECKSUM_BYTES: 1, // trailing checksum byte after the pixel data
  // The checksum is set so that the sum of every byte from the size field
  // (SIZE_OFFSET) through the checksum byte, inclusive, is 0 mod 256. Verified
  // against hardware captures; TN34 phrases it "all bytes incl. size sum to 0".
  CHECKSUM_SUM_OFFSET: 8,
  MAX_DIMENSION: 4096, // sanity bound for a header-reported width/height
};

export const CMD = {
  KEYPRESS: 0x01, // out: 4-byte button mask, nibbled to 8 bytes
  SCREEN_BITMAP: 0x17, // in:  screen bitmap (nibbled header + 240x64 1bpp)
  GET_SCREEN: 0x18, // out: request a screen bitmap
  VALUE: 0x2d, // out: VALUE_DUMP request, and VALUE_PUT (with 0x20 + value)
  VALUE_DUMP: 0x2e, // in:  VALUE_DUMP response
  OBJECTINFO_DUMP: 0x31, // out: OBJECTINFO_DUMP request
  OBJECTINFO: 0x32, // in:  OBJECTINFO_DUMP response (ASCII sub-object lines)
  SEQUENCE_OUT: 0x3c, // in:  UNSOLICITED emit of a changed field's key+value when
  //                     `sequence out = new` is set (device-model §8b). Not a
  //                     response to any request — see midi.js watchdog handling.
  // Backup/restore — the Tech Note 34 want/dump pairs (#147; logs/tn34.txt). A
  // "want" is sent to request the matching "dump"; the same "dump" opcode sent
  // BACK TO the unit loads/replaces that data. All dumps share the FILES_DUMP
  // wire format: 8-nibble block size + nibbled data + a 1-byte sum-to-zero
  // checksum. These are large, slow single frames (~1.6 KB/s over the DIN link).
  PROGRAM_WANT: 0x06, // out: request the current program -> PROGRAM_DUMP
  PROGRAM_DUMP: 0x15, // in/out: current program (binary); sent back, it loads it
  SETUP_WANT: 0x07, // out: request unit setup -> SETUP_DUMP
  SETUP_DUMP: 0x16, // in/out: unit setup; sent back, it loads it
  FILES_WANT: 0x10, // out: request the current presets -> FILES_DUMP
  FILES_DUMP: 0x0f, // in/out: the preset files; sent back, it replaces them
  INTERNAL_WANT: 0x12, // out: request ALL internal NV RAM -> INTERNAL_DUMP (full backup)
  INTERNAL_DUMP: 0x11, // in/out: complete internal NV RAM; sent back, it REPLACES it
  CARD_WANT: 0x14, // out: request the memory card -> CARD_DUMP
  CARD_DUMP: 0x13, // in/out: memory-card contents
  INFO_WANT: 0x1a, // out: request system info -> INFO_DUMP (ASCII)
  INFO_DUMP: 0x19, // in:  system info (ROM name/revision/time/size), ASCII
  OK: 0x00, // in:  "last command OK" ack (assorted commands)
  ERROR: 0x0d, // in:  error reply; may carry an ASCII message
};

// Parameter keys referenced directly in application logic. Most keys are
// discovered dynamically from OBJECTINFO dumps; only this handful is named.
export const KEY = {
  ROOT: '0', // root menu
  SETUP: '10010000', // setup menu root
  PROGRAM: '10020000', // program/load menu root
  LEVELS: '10030000', // levels menu root
  BYPASS: '10030500', // bypass menu root
  FAVORITES: '10020010', // favorites bank menu (preset re-order fix)
  ROOT_META: '10040000', // undocumented type=8 entry in the root dump (filtered out)
  DSP_A_PRESET: '401000b', // DSP A preset root (default)
  DSP_B_PRESET: '801000b', // DSP B preset root (default)
  DELAY_PARAMS: '8040001', // delay parameters (sync test loop)
  T_RATE: '8060001', // tempo rate (sync test loop)
  PROGRAM_SELECT: '10020011', // program SET within the load menu
  BANK_SELECT: '10020012', // bank SET within the load menu
  LOAD_TRIGGER_A: '1002001c', // TRG that loads the selected program into DSP A
  LOAD_TRIGGER_B: '1002001d', // TRG that loads the selected program into DSP B
};

// MIDI modulation / remote control (#146, device-model.md §8b). The whole
// system is ordinary userobjects — the app reads/writes them with the normal
// OBJECTINFO/VALUE machinery (no special command, no keypress for the config).
export const MOD = {
  // Per-parameter modulation: a SINGLE context-bound editing surface. SELECT-
  // hold a parameter to bind it; then these FIXED keys edit it (verified live —
  // the same keys read 'level setup' then 't_delay setup' after each bind).
  REMOTE_CONTROL: '10030400', // the "remote control" COL (holds the bound setup)
  PARAM_SETUP: '10030401', // the bound "<param> setup" surface
  MODE: '10030402', // SET: the source (set by index; see MOD_SOURCES)
  CHANNEL: '10030403', // SET: MIDI channel (base+0..15) for a MIDI source
  SUB2: '10030404', // SET: second sub-param (controller #, when needed)
  MONITOR: '10030405', // CON: live source value (%)
  CAPTURE: '10030406', // TRG: one-click MIDI learn
  RANGE: '10030408', // NUM: modulation depth (tag 'scale')
  TYPE: '10030409', // SET: absolute / unipolar / bipolar
  // SETUP -> ext controllers (10010100): 8 reusable 'assign' source slots + 2
  // 'trig' slots. Bases are NON-CONTIGUOUS (probed). Each slot's children are
  // base + OFF_* below.
  ASSIGN_BASES: [
    '10010110',
    '10010120',
    '10010130',
    '10010140',
    '10010170',
    '10010180',
    '10010190',
    '100101a0',
  ],
  TRIG_BASES: ['10010150', '10010160'],
  OFF_MODE: 1, // base+1: mode SET (the captured source)
  OFF_CHANNEL: 2, // base+2: channel SET
  OFF_SUB: 3, // base+3: sub SET
  OFF_MONITOR: 4, // base+4: monitor CON
  OFF_CAPTURE: 5, // base+5: Capture Midi TRG
  SEQ_OUT: '10010016', // sequence-out setting SET (0 off / 1 old / 2 new): when
  //                      'new' the unit emits the key of any changed field
  //                      (F0 1C 70 dev 3C <ascii key> 20 <ascii value> F7).
  SEQ_OUT_NEW: 2, // the 'new' option index
};

// The per-parameter `mode` SET source list, by DECIMAL index (device-model
// §8b). The SET's own option list is degenerate (it repeats the current value),
// so sources MUST be set by index, not picked from the dump. Indices 4-13
// reference the global assign/trig slots above; "MIDI single"/"MIDI double" are
// a raw CC by number (the con sub-field carries the CC). All 52 indices probed
// live (logs/probe-midi-phase0.mjs + probe-verify-batch.mjs, 2026-06-12).
export const MOD_SOURCES = [
  'off',
  'low',
  'mid',
  'high',
  'assign 1',
  'assign 2',
  'assign 3',
  'assign 4',
  'assign 5',
  'assign 6',
  'assign 7',
  'assign 8',
  'trig 1',
  'trig 2',
  'pedal 1',
  'pedal 2',
  'tip 1',
  'ring 1',
  'tip & ring 1',
  'tip 2',
  'ring 2',
  'tip & ring 2',
  'mod wheel',
  'breath con',
  'foot con',
  'damper',
  'portamento',
  'sostenuto',
  'soft',
  'hold 2',
  'volume',
  'balance',
  'pan',
  'expression',
  'general 1',
  'general 2',
  'general 3',
  'general 4',
  'general 5',
  'general 6',
  'general 7',
  'general 8',
  'MIDI single', // a raw 7-bit CC by number (con sub-field = the CC number)
  'MIDI double', // a 14-bit CC pair by number (con sub-field = the CC number)
  'chan pressure',
  'pitch wheel',
  'note on',
  'note switch',
  'MIDI program',
  'MIDI clock',
  'MIDI start',
  'MIDI stop',
];

// First-char prefix and suffix tests on dynamically-discovered keys.
export const KEY_PREFIX = {
  DSP_A: '4', // keys under DSP A start with '4'
  DSP_B: '8', // keys under DSP B start with '8'
};
export const KEY_SUFFIX = {
  PRESET: '000b', // a preset/DSP root key ends with '000b'
  // (the observed '0002' meter-key naming convention is documented in
  // docs/device-model.md §5; the app detects meters by CON type, not by
  // suffix — C7/#43)
};

// Sub-object types that render as parameters (vs COL menus / type-8 empties).
// Shared by the renderer's param loops and the bridge's descend predicate (C2).
// STR = string-edit field, observed live under save program/bank (R8).
export const PARAM_TYPES = ['NUM', 'SET', 'CON', 'TRG', 'INF', 'STR'];

// The EMPTY object type (D2/#119, probed live 2026-06-10): the root dump
// carries an `8 0 10040000 0 '' ''` line. Its own OBJECTINFO returns only
// that line (no children, no trailing count field) and its VALUE returns an
// empty value — an empty/reserved leaf the device exposes but gives no
// content for. Correct handling everywhere is render-skip; consumers
// reference this constant instead of a bare '8' literal.
export const TYPE_EMPTY = '8';

// Root-level menus, in softkey order, used both as a "is this a top-level menu"
// set and as the static bottom softkey row.
export const ROOT_SOFTKEYS = [
  { key: KEY.PROGRAM, tag: 'program' },
  { key: KEY.SETUP, tag: 'setup' },
  { key: KEY.LEVELS, tag: 'levels' },
  { key: KEY.BYPASS, tag: 'bypass' },
];
