// tests/eager-loader.test.js
// Covers the #106 eager structure loader: serialized walk (one request in
// flight), cached-node skipping, depth bound, watchdog skip, supersession.

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

    // Its response (parser records before emitting) reveals a sub-page; the
    // walk advances to it only after the response arrives — serialized.
    recordDump([
      col('4050001', '4050001', 'in eq parameters', 'in eq'),
      col('4051000', '4050001', 'eq sub page'),
    ]);
    emit('objectinfo:received', { key: '4050001' });
    expect(sentKeys()).toEqual(['4050001', '4051000']);

    recordDump([col('4051000', '4051000', 'eq sub page'), num('4052000', '4051000')]);
    emit('objectinfo:received', { key: '4051000' });
    // Params only — walk complete, no further requests.
    expect(sendObjectInfoDump).toHaveBeenCalledTimes(2);
  });

  test('unrelated objectinfo events do not advance the walk', () => {
    recordDump([col('401000b', '401000b', 'Black Hole'), col('4040001', '401000b', 'space')]);
    startEagerLoad('401000b');
    expect(sentKeys()).toEqual(['4040001']);

    // A user navigation's dump for some other key lands mid-walk.
    recordDump([col('10010000', '10010000', 'setup functions', 'setup')]);
    emit('objectinfo:received', { key: '10010000' });
    expect(sentKeys()).toEqual(['4040001']); // still waiting on its own key
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

  test('a watchdog dumpComplete skips the pending node and keeps walking', () => {
    recordDump([
      col('401000b', '401000b', 'Black Hole'),
      col('4040001', '401000b', 'space'),
      col('4050001', '401000b', 'in eq'),
    ]);
    startEagerLoad('401000b');
    expect(sentKeys()).toEqual(['4040001']);

    emit('dumpComplete', { reason: 'watchdog' });
    expect(sentKeys()).toEqual(['4040001', '4050001']); // moved on

    // An all-received drain while idle is a no-op for the loader.
    emit('dumpComplete', { reason: 'all-received' });
    expect(sendObjectInfoDump).toHaveBeenCalledTimes(2);
  });

  test('a new start supersedes the previous walk', () => {
    recordDump([col('401000b', '401000b', 'Black Hole'), col('4040001', '401000b', 'space')]);
    recordDump([col('801000b', '801000b', 'Tape Flanger'), col('8040001', '801000b', 'flange')]);

    startEagerLoad('401000b');
    expect(sentKeys()).toEqual(['4040001']);

    startEagerLoad('801000b'); // preset switch: restart on the new subtree
    expect(sentKeys()).toEqual(['4040001', '8040001']);

    // The OLD pending key's late response must not advance the new walk.
    recordDump([col('4040001', '4040001', 'space'), col('4041000', '4040001', 'sub')]);
    emit('objectinfo:received', { key: '4040001' });
    expect(sentKeys()).toEqual(['4040001', '8040001']);
  });

  test('stopEagerLoad halts the walk', () => {
    recordDump([col('401000b', '401000b', 'Black Hole'), col('4040001', '401000b', 'space')]);
    startEagerLoad('401000b');
    stopEagerLoad();

    recordDump([col('4040001', '4040001', 'space'), col('4041000', '4040001', 'sub')]);
    emit('objectinfo:received', { key: '4040001' });
    expect(sendObjectInfoDump).toHaveBeenCalledTimes(1); // nothing after stop
  });
});
