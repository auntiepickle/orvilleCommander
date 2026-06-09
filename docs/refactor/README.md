# docs/refactor

The eight-step decoupling refactor that broke the original import cycles is
**complete** (merged in PR #23). Its design notes — dependency graph, coupling
analysis, the step-by-step roadmap, per-step review notes, and the session
knowledge dump — have been removed from the tree; they remain in git history if
needed.

What lives here now:

- [`phase3-state-model.md`](./phase3-state-model.md) — the **active** Phase 3
  state-model design (connect/eager-load flow, the three state domains, and the
  "never render an unconfirmed value" invariant). Referenced by the live ledger.

For everything current, see:

- [`../issue-tracker.md`](../issue-tracker.md) — the production-readiness ledger (source of truth).
- [`../protocol.md`](../protocol.md) and [`../device-model.md`](../device-model.md) — the device spec.
- [`../../CLAUDE.md`](../../CLAUDE.md) — current architecture and conventions.
