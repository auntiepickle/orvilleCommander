// tests/navigation.test.js
// Covers toggleDspKey and the C3/#39 keyStack-entry normalization helper.

import { toggleDspKey, makeKeyStackEntry } from '../src/navigation.js';

describe('toggleDspKey', () => {
  test('flips the DSP prefix both ways', () => {
    expect(toggleDspKey('401000b')).toBe('801000b');
    expect(toggleDspKey('801000b')).toBe('401000b');
  });
});

describe('makeKeyStackEntry', () => {
  const setupSubs = [
    {
      type: 'COL',
      position: '0',
      key: '10010000',
      parent: '10010000',
      statement: 'setup functions',
      tag: 'setup',
    },
    {
      type: 'COL',
      position: '1',
      key: '10010010',
      parent: '10010000',
      statement: 'MIDI configuration',
      tag: 'midi',
    },
  ];

  test('derives the tag from the main sub tag and snapshots subs', () => {
    const entry = makeKeyStackEntry('10010000', setupSubs);
    expect(entry).toEqual({ key: '10010000', tag: 'setup', subs: setupSubs });
    expect(entry.subs).not.toBe(setupSubs); // defensive copy, not the live array
  });

  test('falls back to the first statement word when the tag is blank', () => {
    const subs = [
      {
        type: 'COL',
        position: '0',
        key: '0',
        parent: '0',
        statement: 'ORVILLE ROOT OBJECT',
        tag: '',
      },
    ];
    expect(makeKeyStackEntry('0', subs).tag).toBe('ORVILLE');
  });

  test('falls back to the key when subs are not loaded yet', () => {
    expect(makeKeyStackEntry('0', [])).toEqual({ key: '0', tag: '0', subs: [] });
    expect(makeKeyStackEntry('0', undefined)).toEqual({ key: '0', tag: '0', subs: [] });
  });

  test('every entry has the canonical {key, tag, subs} shape', () => {
    for (const entry of [
      makeKeyStackEntry('10010000', setupSubs),
      makeKeyStackEntry('0', []),
      makeKeyStackEntry('401000b', undefined),
    ]) {
      expect(typeof entry.key).toBe('string');
      expect(typeof entry.tag).toBe('string');
      expect(Array.isArray(entry.subs)).toBe(true);
    }
  });
});
