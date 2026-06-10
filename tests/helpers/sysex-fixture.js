// Test helpers for loading captured Orville SysEx fixtures and deriving
// expected values from them per the roadmap step 5.5 Option B decision:
// device-state-dependent assertions read from the fixture so the test
// stays valid across fixture regenerations with different device state.

import fs from 'node:fs';
import path from 'node:path';
import { splitLine } from '../../src/sysex-split.js';

const FIXTURES_DIR = path.join(process.cwd(), 'tests', 'fixtures');

export function loadFixture(filename) {
  const raw = fs.readFileSync(path.join(FIXTURES_DIR, filename), 'utf8');
  return raw
    .trim()
    .split(/\s+/)
    .map((h) => parseInt(h, 16));
}

// Non-load-bearing reference: the bytes the capture script sends to request
// a given dump. Exposed for inline documentation only — the test does not
// assert against these.
export function hexRequest(key, cmd, deviceId = 1) {
  const keyBytes = key.split('').map((c) => c.charCodeAt(0));
  return [0xf0, 0x1c, 0x70, deviceId, cmd, ...keyBytes, 0xf7];
}

// ----- fixture decoders (Option B) ------------------------------------
// decodeSubs mirrors parser.js:parseSubObject. splitLine is imported from the
// shared src/sysex-split.js leaf module (no module-graph drag), so the parser
// and this decoder can no longer diverge.

function decodeSubs(rawBytes) {
  const ascii = String.fromCharCode(...rawBytes.slice(5, -1))
    .replace(/\0+$/, '')
    .trim();
  return ascii
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = splitLine(line);
      return {
        type: parts[0] || '',
        position: parts[1] || '',
        key: parts[2] || '',
        parent: parts[3] || '',
        statement: parts[4] || '',
        tag: parts[5] || '',
      };
    });
}

export function extractExpectedFromRoot(rootBytes) {
  const subs = decodeSubs(rootBytes);
  const children = subs.slice(1);
  const dspASub = children.find((s) => s.key.startsWith('4'));
  const dspBSub = children.find((s) => s.key.startsWith('8'));
  const shortTagCols = children.filter(
    (s) => s.type === 'COL' && s.tag.trim().length <= 10 && s.tag.trim()
  );
  return {
    dspAKey: dspASub?.key,
    dspBKey: dspBSub?.key,
    dspAName: dspASub?.statement,
    dspBName: dspBSub?.statement,
    firstShortTagCOLKey: shortTagCols[0]?.key,
    rootShortTagKeys: shortTagCols.map((s) => s.key),
    // Full subs array length including main and any non-COL entries (e.g.,
    // the type=8 sub in the current Black Hole/MetallicChamber capture).
    // This is what parser.js passes to renderScreen, so it matches the
    // recorder's captured subsCount field on render events.
    subsCount: subs.length,
  };
}

// Non-COL children (params) in fixture order — the keys renderScreen fetches
// values for when it paints the menu (Option B: fixture-derived).
export function extractParamKeysFromDump(bytes) {
  const subs = decodeSubs(bytes);
  return subs
    .slice(1)
    .filter((s) => !['COL', '8'].includes(s.type))
    .map((s) => s.key);
}

export function extractExpectedFromPreset(presetBytes) {
  const subs = decodeSubs(presetBytes);
  const children = subs.slice(1);
  const menusCols = children.filter((s) => s.type === 'COL');
  const shortTagCols = children.filter(
    (s) => s.type === 'COL' && s.tag.trim().length <= 10 && s.tag.trim()
  );
  return {
    mainKey: subs[0]?.key,
    mainStatement: subs[0]?.statement,
    menusCount: menusCols.length,
    shortTagKeys: shortTagCols.map((s) => s.key),
    // Full subs array length including main and any non-COL entries. Differs
    // from menusCount, which filters to COL type and excludes the main.
    subsCount: subs.length,
  };
}
