# Refactor status (as of commit f38111e)

## Branch state
refactor_main, ahead of origin/refactor_main by 1. Unpushed:
  f38111e  Step 8 (partial): extract navigation.js, kill toggleDspKey duplicate
(origin/refactor_main = e5d96c9; 5950b2d, fdfa2a0, e5d96c9 already pushed.)

## Roadmap status
Steps 1–7: done.
Step 8: partial. Navigation extraction landed; cycle 5 closed; toggleDspKey
        duplicate eliminated; dead keypressMasks import dropped.
        Renderer folder-split deliberately deferred per
        docs/refactor/04-roadmap.md L101 exit ramp.

## Closed cycles (per CLAUDE.md canonical numbering)
  Cycle 2 (parser↔renderer): closed by Step 7 (events.js bus)
  Cycle 3 (parser↔main): closed by Steps 2 + 6 + 7
  Cycle 4 (renderer↔main): partial — Step 7 closed the parser↔renderer↔main
        triangle; a 2-node showLoading↔updateScreen cycle remains
        (pre-existing, not roadmapped).
  Cycle 5 (controls↔renderer): closed by Step 8 partial (f38111e)
  (Cycle 1, midi↔parser, never closed — see "Open / not addressed".)

## Open / not addressed
  Cycle 1, midi↔parser coupling (02-top-couplings.md §3) — never on the 8-step
        roadmap; would require a from-scratch scope if ever revisited.
  Residual one-way coupling controls→renderer (updateScreen, post-keypress
        refresh). Not a cycle. Removing it would require routing the
        refresh through events.js. Deferred indefinitely.
  Honorable mentions from 02-top-couplings.md (dom.js id-binding
        extraction) — not roadmapped, not blocking.
  Residual renderer↔main 2-node cycle (renderer.js imports showLoading from
        main.js; main.js imports updateScreen from renderer.js). Pre-dates the
        refactor; never roadmapped.

## Gate gap (precondition for any future renderer folder-split)
The renderer golden-snapshot test (tests/renderer.snapshot.test.js,
landed in fdfa2a0) pins only three branches:
  - root menu (currentKey=0)
  - leaf NUM/SET/TRG with keyStack depth 1
  - leaf CON meter

Unpinned render branches that a renderer split would churn:
  - graphic-EQ position-'a' grouping (special-case row layout)
  - embedded childSubs (inline-expansion branch)
  - keyStack depth >2 (grandparent softkey row)
  - SET hex/dec index path with index ≥10 (formatting branch)
  - INF type (no test coverage at all)

Widening the snapshot to cover these is the prerequisite for any
renderer folder-split, and is itself a session of work — each new case
requires hand-constructing a subs array and verifying the captured
snapshot is actually correct (not just stable).

## What "done" means here
The 8-step roadmap served its stated goal: decouple modules, audit state
writes, make the render pipeline event-driven. The codebase is now in a
state where single-module changes have a small blast radius. Further
refactoring is feature-driven, not architectural — wait for a real bug
or feature to force the next change.
