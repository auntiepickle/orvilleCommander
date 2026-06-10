// tests/eager-loader.test.js
// Covers the #106 eager structure loader: serialized walk (one request in
// flight), cached-node skipping, the tree-at-wave-boundary advance signal
// (the parser does NOT emit objectinfo:received for background fetches —
// review finding), depth bound, watchdog/late-response handling,
// supersession, stop.

jest.mock('../src/midi.js', () => ({
  sendObjectInfoDump: jest.fn(),
}));

jest.mock('../src/logger.js', () => ({
  log: jest.fn(),
}));

import { startEagerLoad, stopEagerLoad } from '../src/eager-loader.js';
import { sendObjectInfoDump } from '../src/midi.js';
import { emit } from '../src/events.js';
import { recordDump, reset as treeReset } from '../src/tree.js';

const col = (key, parent, statement, tag = '') => ({
  type: 'COL',
  position: '0',
  key,
  parent,
  statement,
  tag,
});
const num = (key, parent) => ({
  type: 'NUM',
  position: '1',
  key,
  parent,
  statement: 'x %3.0f',
  tag: '',
  value: '0',
});

const sentKeys = () => sendObjectInfoDump.mock.calls.map((c) => c[0]);

describe('eager-loader', () => {
  beforeEach(() => {
    stopEagerLoad();
    treeReset();
    sendObjectInfoDump.mockClear();
  });

  afterEach(() => {
    stopEagerLoad();
  });

  test('skips cached nodes without requests and fetches uncached ones one at a time', () => {
    // Preset and its first child are already tree-cached (the landing wave's
    // fan-out); the second child is not.
    recordDump([
      col('401000b', '401000b', 'Black Hole'),
      col('4040001', '401000b', 'space parameters', 'space'),
      col('4050001', '401000b', 'in eq parameters', 'in eq'),
    ]);
    recordDump([col('4040001', '4040001', 'space parameters', 'space'), num('4070001', '4040001')]);

    startEagerLoad('401000b');
    // Exactly ONE request in flight: the uncached child. Cached nodes cost
    // nothing.
    expect(sentKeys()).toEqual(['4050001']);

    // The response is silently tree-recorded by the parser (no
    // objectinfo:received for background keys); the wave drain is the
    // advance signal, and the revealed sub-page is fetched next —
    // serialized.
    recordDump([
      col('4050001', '4050001', 'in eq parameters', 'in eq'),
      col('4051000', '4050001', 'eq sub page'),
    ]);
    emit('dumpComplete', { reason: 'all-received' });
    expect(sentKeys()).toEqual(['4050001', '4051000']);

    recordDump([col('4051000', '4051000', 'eq sub page'), num('4052000', '4051000')]);
    emit('dumpComplete', { reason: 'all-received' });
    // Params only — walk complete, no further requests.
    expect(sendObjectInfoDump).toHaveBeenCalledTimes(2);

    // Post-completion drains are no-ops.
    emit('dumpComplete', { reason: 'all-received' });
    expect(sendObjectInfoDump).toHaveBeenCalledTimes(2);
  });

  test('a missing dump is retried at the queue tail — free when the response landed late', () => {
    // Live finding: slow dumps outlast the wave watchdog and the backlog
    // cascades; the late responses are still tree-recorded, so the tail
    // retry usually hits the cache without a second request.
    recordDump([
      col('401000b', '401000b', 'Black Hole'),
      col('4040001', '401000b', 'space'),
      col('4050001', '401000b', 'in eq'),
    ]);
    startEagerLoad('401000b');
    expect(sentKeys()).toEqual(['4040001']);

    // Drain with nothing recorded: 4040001 is re-queued at the tail and the
    // walk moves on.
    emit('dumpComplete', { reason: 'all-received' });
    expect(sentKeys()).toEqual(['4040001', '4050001']);

    // 4040001's LATE response lands (tree-recorded) while 4050001 is in
    // flight; when the retry comes up it costs no second request and its
    // children still get walked.
    recordDump([col('4040001', '4040001', 'space'), col('4041000', '4040001', 'late sub')]);
    recordDump([col('4050001', '4050001', 'in eq'), num('40c0001', '4050001')]);
    emit('dumpComplete', { reason: 'all-received' });
    expect(sentKeys()).toEqual(['4040001', '4050001', '4041000']); // retry was free
  });

  test('a dead node is fetched twice, then permanently skipped', () => {
    recordDump([col('401000b', '401000b', 'Black Hole'), col('4040001', '401000b', 'space')]);
    startEagerLoad('401000b');
    expect(sentKeys()).toEqual(['4040001']);

    emit('dumpComplete', { reason: 'all-received' }); // miss -> retry: second send
    expect(sentKeys()).toEqual(['4040001', '4040001']);

    emit('dumpComplete', { reason: 'all-received' }); // miss again -> skip, complete
    expect(sendObjectInfoDump).toHaveBeenCalledTimes(2);
    emit('dumpComplete', { reason: 'all-received' }); // post-completion no-op
    expect(sendObjectInfoDump).toHaveBeenCalledTimes(2);
  });

  test('a watchdog WITH the dump recorded still advances and enqueues its children (no coverage loss)', () => {
    recordDump([col('401000b', '401000b', 'Black Hole'), col('4040001', '401000b', 'space')]);
    startEagerLoad('401000b');
    expect(sentKeys()).toEqual(['4040001']);

    // The response arrived but the wave stalled later (R5a: a bitmap
    // transfer in the same wave). The tree knows the node, so the walk
    // advances into its children instead of dropping the subtree.
    recordDump([col('4040001', '4040001', 'space'), col('4041000', '4040001', 'sub page')]);
    emit('dumpComplete', { reason: 'watchdog' });
    expect(sentKeys()).toEqual(['4040001', '4041000']);
  });

  test('the depth bound stops the walk (visited set is the cycle guard)', () => {
    // Cached chain root(0) -> a(1) -> b(2) -> c(3) -> d(4): children of a
    // depth-MAX node are not enqueued, so d is never requested even though
    // it is uncached.
    recordDump([col('r', 'r', 'root'), col('a', 'r', 'level 1')]);
    recordDump([col('a', 'a', 'level 1'), col('b', 'a', 'level 2')]);
    recordDump([col('b', 'b', 'level 2'), col('c', 'b', 'level 3')]);
    recordDump([col('c', 'c', 'level 3'), col('d', 'c', 'level 4')]);

    startEagerLoad('r');
    expect(sendObjectInfoDump).not.toHaveBeenCalled(); // d stays unfetched
  });

  test('a new start supersedes the previous walk', () => {
    recordDump([
      col('401000b', '401000b', 'Black Hole'),
      col('4040001', '401000b', 'space'),
      col('4050001', '401000b', 'in eq'),
    ]);
    recordDump([col('801000b', '801000b', 'Tape Flanger'), col('8040001', '801000b', 'flange')]);

    startEagerLoad('401000b');
    expect(sentKeys()).toEqual(['4040001']);

    startEagerLoad('801000b'); // preset switch: restart on the new subtree
    expect(sentKeys()).toEqual(['4040001', '8040001']);

    // The old walk's pending response landing must advance ONLY the new
    // walk's own pending decision — and never resurrect the old subtree.
    recordDump([col('4040001', '4040001', 'space'), col('4041000', '4040001', 'old sub')]);
    recordDump([col('8040001', '8040001', 'flange'), col('8041000', '8040001', 'new sub')]);
    emit('dumpComplete', { reason: 'all-received' });
    expect(sentKeys()).toEqual(['4040001', '8040001', '8041000']); // no 4041000
  });

  test('stopEagerLoad halts the walk', () => {
    recordDump([col('401000b', '401000b', 'Black Hole'), col('4040001', '401000b', 'space')]);
    startEagerLoad('401000b');
    stopEagerLoad();

    recordDump([col('4040001', '4040001', 'space'), col('4041000', '4040001', 'sub')]);
    emit('dumpComplete', { reason: 'all-received' });
    expect(sendObjectInfoDump).toHaveBeenCalledTimes(1); // nothing after stop
  });
});
