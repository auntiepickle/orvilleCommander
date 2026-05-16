// events.js — 7c
//
// Tiny pub/sub for the parse -> render -> navigation handoff that Step 7
// of the roadmap builds toward. emit(type, payload) fires all subscribers
// for the type synchronously in insertion order. on(type, fn) returns an
// unsubscribe function. Unknown event types are a no-op.
//
// Re-entrancy and live-mutation semantics match store.js's subscribers
// Set: a subscriber that calls emit() recursively re-enters the loop; a
// subscriber that subscribes/unsubscribes during its own callback
// interacts with Set's in-flight iteration rules (entries added during
// iteration are visited; entries removed before being visited are
// skipped). No guard rails this step — there are no real subscribers
// yet (consumer migration is 7d).

const subscribers = new Map();

export function emit(type, payload) {
  const set = subscribers.get(type);
  if (!set) return;
  for (const fn of set) fn(payload);
}

export function on(type, fn) {
  let set = subscribers.get(type);
  if (!set) {
    set = new Set();
    subscribers.set(type, set);
  }
  set.add(fn);
  return () => {
    const s = subscribers.get(type);
    if (s) s.delete(fn);
  };
}
