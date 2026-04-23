# Refactor review notes

Observations and decisions captured during review of each roadmap step. Terse — the "why" that doesn't fit in a commit body.

## Step 5 — parser.js setState migration

- Batching rejected in favor of 1:1 to preserve reversibility before any subscribers exist
- Option A (import log in store.js) chosen over B to avoid two log sinks; new load-tolerated cycle store→logger→state→store accepted
- origin param on setState is optional with no default — missing origin logs as undefined, intentional signal that a caller forgot to tag
- stateWrite logCategory defaults to false; enable locally during audit work
- Tripwire docstring in store.js documents Object.assign identity-preservation; parser reads at 193/196/272/311 (deviceId), 235/246/304 (lastAscii), 235/242/246/287/288/295/299 (currentSubs), 250/305 (isLoadingPreset) rely on it
- setState builds trace string unconditionally before logger gates on category; cheap today, wrap in `if (appState.logCategories.stateWrite)` if it ever shows up in a profile
- Hunk-count from Claude Code does not match plan's table row count; invariant is "no multi-key coalescing into one setState call," verified per-hunk
- logCategories on appState is what creates the store↔logger↔state cycle; moving it off would collapse the cycle (entry in future-work.md)
