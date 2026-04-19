# Refactor docs — session 1 output

Read in order:

1. [`01-dependency-graph.md`](./01-dependency-graph.md) — who imports what, plus the five real cycles.
2. [`02-top-couplings.md`](./02-top-couplings.md) — top 5 tightest couplings ranked by refactor payoff.
3. [`03-test-coverage-gap.md`](./03-test-coverage-gap.md) — what's untested and the exact characterization tests to add first.
4. [`04-roadmap.md`](./04-roadmap.md) — eight commits, each with a rollback plan.
5. [`CLAUDE.md.draft`](./CLAUDE.md.draft) — draft `CLAUDE.md` for the repo root. Review, then move to `/CLAUDE.md` when ready.

No code was changed in this session.

## Fastest next actions

- **Before anything else:** fix `tests/main.test.js` so `npm test` runs green (Step 1 of the roadmap).
- Then add the `midi.js` byte-contract tests from `03-test-coverage-gap.md` — they lock the wire format before any parser refactor touches I/O.
- Review and promote the draft `CLAUDE.md` to the repo root so the next session starts with shared context.
