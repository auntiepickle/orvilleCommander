// tests/tree.test.js — the T1b device-tree store (src/tree.js).

import {
  recordDump,
  getNode,
  parentOf,
  ancestorsOf,
  findParamUnder,
  labelFor,
  reset,
} from '../src/tree.js';

const col = (key, parent, statement, tag, position = '0') => ({
  type: 'COL',
  position,
  key,
  parent,
  statement,
  tag,
});
const num = (key, parent, statement) => ({
  type: 'NUM',
  position: '0',
  key,
  parent,
  statement,
  tag: '',
  value: '0',
});

describe('tree store (T1b)', () => {
  beforeEach(() => reset());

  test('recordDump stores the node and links children to it', () => {
    const rootDump = [
      col('0', '0', 'ORVILLE ROOT OBJECT', 'ORVILLE'),
      col('10010000', '0', 'setup functions', 'setup'),
      col('401000b', '0', 'Black Hole', ''),
    ];
    recordDump(rootDump);
    expect(getNode('0')).toBe(rootDump);
    expect(parentOf('10010000')).toBe('0');
    expect(parentOf('401000b')).toBe('0');
    expect(parentOf('0')).toBeUndefined(); // root has no parent
  });

  test('ancestorsOf walks rootward, nearest-root first', () => {
    recordDump([col('0', '0', 'root', 'root'), col('10030000', '0', 'level functions', 'level')]);
    recordDump([
      col('10030000', '10030000', 'level functions', 'level'),
      col('10030600', '10030000', 'Post D/A Gain', 'outputs'),
    ]);
    recordDump([
      col('10030600', '10030600', 'Post D/A Gain', 'outputs'),
      col('10030601', '10030600', 'Post D/A Gain', '', 'c'),
    ]);
    expect(ancestorsOf('10030601')).toEqual(['0', '10030000', '10030600']);
    expect(ancestorsOf('0')).toEqual([]);
    expect(ancestorsOf('unknown-key')).toEqual([]); // unknown ancestry = empty
  });

  test('newest dump wins (preset-load structure changes absorbed)', () => {
    recordDump([col('401000b', '401000b', 'Black Hole', ''), col('4040001', '401000b', 'space parameters', 'space')]);
    recordDump([col('401000b', '401000b', 'Wormhole', ''), col('4990001', '401000b', 'warp parameters', 'warp')]);
    expect(getNode('401000b')[0].statement).toBe('Wormhole');
    expect(parentOf('4990001')).toBe('401000b');
    // The old child's linkage survives until overwritten elsewhere — the
    // tree is last-observed structure, not a garbage-collected mirror.
    expect(parentOf('4040001')).toBe('401000b');
  });

  test('findParamUnder locates an embedded child param (childSubs successor)', () => {
    recordDump([
      col('10020000', '10020000', 'program functions', 'program'),
      col('10020010', '10020000', 'load new preset', 'load'),
    ]);
    recordDump([
      col('10020010', '10020010', 'load new preset', 'load'),
      num('10020011', '10020010', 'programs: %s'),
    ]);
    expect(findParamUnder('10020000', '10020011')).toMatchObject({ key: '10020011' });
    expect(findParamUnder('10020000', 'nope')).toBeUndefined();
    expect(findParamUnder('nope', '10020011')).toBeUndefined();
  });

  test('labelFor: own tag, else parent-listing line, else first labeled child, else placeholder', () => {
    // Parent's listing carries the tag before the node's own dump loads.
    recordDump([col('10030600', '10030600', 'Post D/A Gain', 'outputs'), col('10030601', '10030600', 'Post D/A Gain', '', 'c')]);
    expect(labelFor('10030600')).toBe('outputs');
    expect(labelFor('10030601')).toBe('Post'); // statement-derived via the parent line
    // Fully blank node: labeled by its first labeled child once loaded
    // (device precedent: the physical SETUP row shows 'dsp B').
    recordDump([col('100100d0', '100100d0', '', ''), col('100100df', '100100d0', 'Dsp B i/p routing', 'dsp B')]);
    expect(labelFor('100100d0')).toBe('dsp B');
    // Blank node whose children have not loaded: placeholder, never ''.
    recordDump([col('feed0000', 'feed0000', '', ''), col('feed0001', 'feed0000', '', '')]);
    expect(labelFor('feed0000')).toBe('...');
  });
});
