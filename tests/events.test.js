// tests/events.test.js
//
// 7c — cover events.js emit/on minimally. Module is dependency-free; no
// mocks needed. Subscribers fire synchronously in insertion order; unknown
// event types are a no-op; unsubscribe stops delivery.

import { emit, on } from '../src/events.js';

describe('events.js emit/on (7c)', () => {
  test('emit with no subscribers is a no-op', () => {
    expect(() => emit('nothing', { x: 1 })).not.toThrow();
  });

  test('emit with one subscriber delivers the payload', () => {
    const received = [];
    const off = on('hello', (p) => received.push(p));
    emit('hello', { v: 42 });
    expect(received).toEqual([{ v: 42 }]);
    off();
  });

  test('multiple subscribers all receive in registration order', () => {
    const order = [];
    const off1 = on('multi', () => order.push('a'));
    const off2 = on('multi', () => order.push('b'));
    const off3 = on('multi', () => order.push('c'));
    emit('multi', null);
    expect(order).toEqual(['a', 'b', 'c']);
    off1();
    off2();
    off3();
  });

  test('unsubscribe stops delivery to that subscriber', () => {
    let count = 0;
    const off = on('drop', () => count++);
    emit('drop', null);
    off();
    emit('drop', null);
    expect(count).toBe(1);
  });

  test('emit after the last subscriber unsubscribes is a no-op', () => {
    const off = on('gone', () => {});
    off();
    expect(() => emit('gone', null)).not.toThrow();
  });

  test('a subscriber added DURING an emit does not receive the in-flight event (#106)', () => {
    // Load-bearing for the eager loader: it subscribes to dumpComplete from
    // inside the bridge's dumpComplete handler; live-set iteration would
    // deliver that same event to the brand-new listener and skip the
    // walk's first fetch.
    const calls = [];
    const offs = [];
    offs.push(
      on('snap', () => {
        calls.push('outer');
        offs.push(on('snap', () => calls.push('inner')));
      })
    );
    emit('snap', null);
    expect(calls).toEqual(['outer']); // inner deferred to the NEXT emit
    emit('snap', null);
    expect(calls).toEqual(['outer', 'outer', 'inner']);
    offs.forEach((off) => off());
  });

  test('a subscriber removed DURING an emit still receives that event once (#106 snapshot semantics)', () => {
    // The flip side of snapshot iteration: consumers that tear down
    // mid-emit must self-guard (the eager loader uses a walk token).
    const calls = [];
    const offA = on('snap2', () => {
      calls.push('a');
      offB();
    });
    const offB = on('snap2', () => calls.push('b'));
    emit('snap2', null);
    expect(calls).toEqual(['a', 'b']); // b was in the snapshot
    emit('snap2', null);
    expect(calls).toEqual(['a', 'b', 'a']); // and is gone afterward
    offA();
  });
});
