// tests/tree.test.js — the T1b device-tree store (src/tree.js).

import {
  recordDump,
  getNode,
  parentOf,
  ancestorsOf,
  findParamUnder,
  labelFor,
  isFresh,
  markDirtyIfStable,
  markAllStableDirty,
  stampStableRequest,
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
    recordDump([
      col('401000b', '401000b', 'Black Hole', ''),
      col('4040001', '401000b', 'space parameters', 'space'),
    ]);
    recordDump([
      col('401000b', '401000b', 'Wormhole', ''),
      col('4990001', '401000b', 'warp parameters', 'warp'),
    ]);
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
    recordDump([
      col('10030600', '10030600', 'Post D/A Gain', 'outputs'),
      col('10030601', '10030600', 'Post D/A Gain', '', 'c'),
    ]);
    expect(labelFor('10030600')).toBe('outputs');
    expect(labelFor('10030601')).toBe('Post'); // statement-derived via the parent line
    // Fully blank node: labeled by its first labeled child once loaded
    // (device precedent: the physical SETUP row shows 'dsp B').
    recordDump([
      col('100100d0', '100100d0', '', ''),
      col('100100df', '100100d0', 'Dsp B i/p routing', 'dsp B'),
    ]);
    expect(labelFor('100100d0')).toBe('dsp B');
    // Blank node whose children have not loaded: placeholder, never ''.
    recordDump([col('feed0000', 'feed0000', '', ''), col('feed0001', 'feed0000', '', '')]);
    expect(labelFor('feed0000')).toBe('...');
  });

  describe('stable-subtree freshness (#113 — per-key staleness; program prefix 10020)', () => {
    test('isFresh requires cached + stable + not stale; only a RE-RECORD un-stales', () => {
      expect(isFresh('10020010')).toBe(false); // uncached
      recordDump([
        col('10020010', '10020010', 'load new preset', 'load'),
        num('10020011', '10020010', 'program: %s'),
      ]);
      recordDump([col('10020020', '10020020', 'save program', 'save')]);
      expect(isFresh('10020010')).toBe(true); // cached + stable + clean

      // Cached but NOT in a stable subtree: never fresh (per-visit refetch).
      recordDump([col('10010000', '10010000', 'setup functions', 'setup')]);
      expect(isFresh('10010000')).toBe(false);

      // A mutating put anywhere under the prefix stales every cached key
      // under it.
      markDirtyIfStable('1002001c'); // the load trigger
      expect(isFresh('10020010')).toBe(false);
      expect(isFresh('10020020')).toBe(false);

      // Re-recording ONE node un-stales only that node — a deep visit (or
      // a dropped sibling response) can never launder staleness into the
      // rest of the subtree. The re-record must come from a POST-mark
      // request (#121): stamp as sendObjectInfoDump does in production.
      stampStableRequest('10020010');
      recordDump([col('10020010', '10020010', 'load new preset', 'load')]);
      expect(isFresh('10020010')).toBe(true);
      expect(isFresh('10020020')).toBe(false); // sibling stays stale

      // Puts outside any stable subtree mark nothing.
      markDirtyIfStable('4070001');
      expect(isFresh('10020010')).toBe(true);

      // A bank/program SELECT put is a pure view change and stales NOTHING
      // (#138 perf): the 70-name bank list stays cached, so revisiting
      // PROGRAM after a bank-hop or a library sync is instant.
      markDirtyIfStable('10020012'); // BANK_SELECT
      expect(isFresh('10020010')).toBe(true);
      markDirtyIfStable('10020011'); // PROGRAM_SELECT
      expect(isFresh('10020010')).toBe(true);
    });

    test('a response whose request predates the mutation stays stale (#121 race, both variants)', () => {
      // Variant (i): a refetch in flight when the put fires. The request
      // was stamped pre-mark; the put bumps the generation; the arriving
      // pre-mutation dump records but is NOT trusted across visits.
      recordDump([col('10020010', '10020010', 'load new preset', 'load')]);
      markDirtyIfStable('1002001c');
      stampStableRequest('10020010'); // refetch goes out...
      markDirtyIfStable('1002001c'); // ...another put lands mid-flight
      recordDump([col('10020010', '10020010', 'load new preset', 'load')]); // pre-put response
      expect(getNode('10020010')).toBeDefined(); // recorded (newest data we have)
      expect(isFresh('10020010')).toBe(false); // but not trusted

      // A post-mark request -> response cycle restores trust.
      stampStableRequest('10020010');
      recordDump([col('10020010', '10020010', 'load new preset', 'load')]);
      expect(isFresh('10020010')).toBe(true);

      // Variant (ii): a NEVER-cached child requested pre-put, recorded
      // post-put. markDirtyIfStable could not stale it (not cached), but
      // the generation check still refuses trust.
      stampStableRequest('10020020');
      markDirtyIfStable('1002001c');
      recordDump([col('10020020', '10020020', 'save program', 'save')]);
      expect(isFresh('10020020')).toBe(false);
    });

    test('a duplicate response without a new stamp stays TRUSTED (#121 review fix)', () => {
      // Rapid double navigation fans out twice: two responses for one
      // stamped request. Consuming the stamp on the first would flip the
      // second — genuinely post-mark — back to stale.
      recordDump([col('10020010', '10020010', 'load new preset', 'load')]);
      markDirtyIfStable('1002001c'); // gen > 0 (the norm in a live session)
      stampStableRequest('10020010');
      recordDump([col('10020010', '10020010', 'load new preset', 'load')]); // response 1
      expect(isFresh('10020010')).toBe(true);
      recordDump([col('10020010', '10020010', 'load new preset', 'load')]); // duplicate
      expect(isFresh('10020010')).toBe(true); // stamp kept, still trusted

      // A LATER mutation still wins: the kept stamp cannot launder.
      markDirtyIfStable('1002001c');
      recordDump([col('10020010', '10020010', 'load new preset', 'load')]); // old stamp
      expect(isFresh('10020010')).toBe(false);
    });

    test('markAllStableDirty also bumps the generation (#121)', () => {
      recordDump([col('10020010', '10020010', 'load new preset', 'load')]);
      stampStableRequest('10020010'); // request in flight...
      markAllStableDirty(); // ...keypress/Sync lands mid-flight
      recordDump([col('10020010', '10020010', 'load new preset', 'load')]); // pre-mark response
      expect(isFresh('10020010')).toBe(false);
    });

    test('generation 0 trusts unstamped records — seeding before any mutation (#121)', () => {
      // The audit seeds the tree via direct recordDump with no requests;
      // with no mutation ever marked, nothing can be pre-mutation.
      recordDump([col('10020010', '10020010', 'load new preset', 'load')]);
      expect(isFresh('10020010')).toBe(true);
    });

    test('markAllStableDirty (Sync/reconnect/keypress) distrusts every stable cache; reset clears', () => {
      recordDump([col('10020010', '10020010', 'load new preset', 'load')]);
      markAllStableDirty();
      expect(isFresh('10020010')).toBe(false);
      reset();
      recordDump([col('10020010', '10020010', 'load new preset', 'load')]);
      expect(isFresh('10020010')).toBe(true); // reset cleared the marks
    });
  });
});
