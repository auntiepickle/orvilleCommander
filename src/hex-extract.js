// Extract nibble bytes from a hex-text dump between the 0x17 screen-capture
// start marker and the trailing 0xF7 SysEx terminator. Pure, DOM-free,
// import-safe — kept separate from main.js (which has top-level DOM access)
// so it can be unit-tested in isolation.
//
// Mirrors the slice logic in bitmap.js for the device-emitted bitmap path;
// here we apply it to user-uploaded debug capture files.
// Returns null if either the 0x17 start marker is absent or if no hex
// digits were found at all.
// bitmap.js retains its own inline copy for now (two callsites isn't worth
// a shared dependency); if a third callsite appears, consolidate then.
import { CMD, SYSEX } from './sysex-commands.js';

const SCREEN_MARKER = CMD.SCREEN_BITMAP.toString(16); // '17'
const END_MARKER = SYSEX.END.toString(16); // 'f7'

export function extractNibblesFromHex(content) {
  const hexPattern = /[0-9a-f]{1,2}/g;
  const hexMatches = content.toLowerCase().match(hexPattern);
  if (!hexMatches) return null;
  const startMarker = hexMatches.indexOf(SCREEN_MARKER);
  if (startMarker === -1) return null;
  const startIdx = startMarker + 1;
  const f7Idx = hexMatches.indexOf(END_MARKER, startIdx);
  const endIdx = f7Idx !== -1 ? f7Idx : hexMatches.length;
  const nibblesStr = hexMatches.slice(startIdx, endIdx);
  return nibblesStr.map((h) => parseInt(h, 16));
}
