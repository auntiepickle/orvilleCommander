// sysex-commands.js
// Named constants for the Eventide Orville SysEx protocol. system_commands.txt
// at the repo root is the canonical source for button presses; the rest is
// reverse-engineered. All frames are F0 1C 70 <deviceId> <cmd> ... F7.

// SysEx framing bytes.
export const SYSEX = {
  END: 0xf7, // F7 SysEx end (used as a text marker when scanning hex dumps)
  MANUFACTURER: [0x1c, 0x70], // Eventide ID + DSP4000 product ID
  VALUE_SEPARATOR: 0x20, // space between key and value in a VALUE_PUT
  FRAME_PREFIX_LEN: 5, // F0 1C 70 <deviceId> <cmd> before the payload
};

// Screen-dump (0x17) geometry, after denibbling.
export const SCREEN = {
  WIDTH: 240,
  HEIGHT: 64,
  HEADER_BYTES: 12, // header bytes before the 1bpp pixel data
};

export const CMD = {
  KEYPRESS: 0x01, // out: 4-byte button mask, nibbled to 8 bytes
  SCREEN_BITMAP: 0x17, // in:  screen bitmap (nibbled header + 240x64 1bpp)
  GET_SCREEN: 0x18, // out: request a screen bitmap
  VALUE: 0x2d, // out: VALUE_DUMP request, and VALUE_PUT (with 0x20 + value)
  VALUE_DUMP: 0x2e, // in:  VALUE_DUMP response
  OBJECTINFO_DUMP: 0x31, // out: OBJECTINFO_DUMP request
  OBJECTINFO: 0x32, // in:  OBJECTINFO_DUMP response (ASCII sub-object lines)
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

// First-char prefix and suffix tests on dynamically-discovered keys.
export const KEY_PREFIX = {
  DSP_A: '4', // keys under DSP A start with '4'
  DSP_B: '8', // keys under DSP B start with '8'
};
export const KEY_SUFFIX = {
  PRESET: '000b', // a preset/DSP root key ends with '000b'
  METER: '0002', // meter parameter keys end with '0002'
};

// Root-level menus, in softkey order, used both as a "is this a top-level menu"
// set and as the static bottom softkey row.
export const ROOT_SOFTKEYS = [
  { key: KEY.PROGRAM, tag: 'program' },
  { key: KEY.SETUP, tag: 'setup' },
  { key: KEY.LEVELS, tag: 'levels' },
  { key: KEY.BYPASS, tag: 'bypass' },
];
