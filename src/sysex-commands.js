// sysex-commands.js
// Named constants for the Eventide Orville SysEx protocol. system_commands.txt
// at the repo root is the canonical source; these mirror the subset the app
// references directly. All frames are F0 1C 70 <deviceId> <cmd> ... F7.

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
  T_RATE: '8060001', // tempo rate (sync test loop)
  PROGRAM_SELECT: '10020011', // program SET within the load menu
  BANK_SELECT: '10020012', // bank SET within the load menu
  LOAD_TRIGGER_A: '1002001c', // TRG that loads the selected program into DSP A
  LOAD_TRIGGER_B: '1002001d', // TRG that loads the selected program into DSP B
};
