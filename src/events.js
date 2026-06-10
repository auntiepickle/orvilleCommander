// events.js — 7c
//
// Tiny pub/sub for the parse -> render -> navigation handoff that Step 7
// of the roadmap builds toward. emit(type, payload) fires all subscribers
// for the type synchronously in insertion order. on(type, fn) returns an
// unsubscribe function. Unknown event types are a no-op.
//
// Re-entrancy and live-mutation semantics (#106 hardening): emit iterates
// a SNAPSHOT of the subscriber set, so a listener added during an emit is
// NOT called for the in-flight event (the eager loader subscribes from
// inside the bridge's dumpComplete handler — live-set iteration would
// deliver that same dumpComplete to the brand-new listener and skip its
// first fetch). The flip side: a listener removed during an emit still
// receives the in-flight event once — consumers that tear down mid-emit
// must self-guard (the eager loader uses a walk token).

const subscribers = new Map();

export function emit(type, payload) {
  const set = subscribers.get(type);
  if (!set) return;
  for (const fn of [...set]) fn(payload);
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
