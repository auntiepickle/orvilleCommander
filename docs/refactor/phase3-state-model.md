# Phase 3 design — state model & connect flow

Design agreed before implementing Phase 3. The architecture batches
(`dumpComplete` events, autoLoad, keyStack) are reorganized around this model.

## Driving invariant

**Never render an unconfirmed value as if it were current.** Showing wrong
information is the one thing we refuse to do. Cache and pre-paint may fill
*structure* (menu names, layout) so the UI is never blank, but a parameter
*value* is shown only after a `VALUE_DUMP` confirms it from the device.
Anything unconfirmed renders as a loading placeholder, not a stale number.

Eager-on-connect (the default) is simply how we satisfy this invariant up front
for the active preset.

## Three state domains

| Domain            | Source of truth | Synced?                  |
| ----------------- | --------------- | ------------------------ |
| **Device model**  | the hardware    | yes — confirmed via dumps |
| **App view**      | the app         | no — local, free to roam |
| **Physical LCD**  | the hardware    | independent mirror (0x17) |

- **Device model:** per-DSP loaded preset (key + name), parameter values.
- **App view:** `currentKey` / `keyStack` / `paramOffset`, plus the **active DSP
  (A/B)**. Navigation is random-access by key (`OBJECTINFO`/`VALUE_DUMP`) and
  sends no keypresses, so it never moves the front panel.
- **Physical LCD:** what the unit is showing; we never force it to follow the
  app, and the app never assumes it.

Principle: **reconcile the model, not the view.**

## Active DSP

The root dump lists both presets but does **not** flag which DSP is active
(verified against `tests/fixtures/objectinfo-root.txt`). So active-DSP is **app
view state**: persisted app-side (last A/B used), default **A** on first run.
Which DSP you're looking at is a view concern, not a device-model fact. (If a
device value key ever turns out to report it, revisit — hardware exploration.)

## Connect flow

The Orville boots into its last-used preset, so the device's *current* state at
connect already *is* the last-used preset — we read it rather than remember it.

1. **Connect** ports + listener.
2. **Pre-paint (provisional)** from cached `presetKey` — structure only, to
   avoid a blank screen. Values render as loading until confirmed.
3. **Request root.** Adopt the device's real DSP A/B keys + names as
   authoritative (discard the cache hint if it disagrees). (The C2 design
   below refines this: landing fires on the root dump's *arrival* — the
   progressive paint — not on the wave's drain.)
4. **Choose landing** = active preset for the app-side last-active DSP (default A).
5. **Eager load (default):** traverse the active preset's tree —
   `OBJECTINFO` each child COL, `VALUE_DUMP` each param — bounded by depth and a
   visited set, issued as one request wave. Show a loading state.
6. On `dumpComplete` (wave drained) → hide loading → render the fully-confirmed
   preset. Browsing within it is now instant and correct.

`eagerLoad` config flag (default **on**, persisted in `midiConfig`) flips step 5
to **lazy**: fetch-on-navigate (today's behavior), with the same
loading-placeholder-until-confirmed rule for anything not yet fetched.

Eager scope: the **active preset tree only**. The other DSP and the
setup/program/levels menus stay lazy (fetched + loading-gated on navigation).

## How this maps to the Phase 3 batches

- **3.1 `dumpComplete` events** — the substrate. Replace the stacked
  200ms `setTimeout`/`debounce` with explicit `dumpComplete(key, data)` events;
  these drive both the connect handshake and eager-load completion. Removes the
  timer stack; folds in `isLoadingPreset` removal. (Implemented — see
  "Implementation notes — 3.1 as built" below.)
- **3.2 State-shape hardening** — normalize `keyStack`; persist active DSP
  app-side; the "view" is now built deterministically from the tree.
- **3.3 Connect handshake + eager loader + landing** — replaces the 500ms
  autoLoad race entirely with the root-dump-driven flow above; adds the
  eager-loader module, the `eagerLoad` config toggle, and the loading UX. Adds
  the render guard that enforces the driving invariant (placeholder for
  unconfirmed values).
- **3.4 Cycle cleanup** — move `logCategories` off `appState` (logger↔state).

## Implementation notes — 3.1 as built (C1/#37 + C4/#40)

The substrate predated this batch: `midi.js` counts every `OBJECTINFO`/`VALUE`
request into a **wave** (`recordRequest`/`notifyResponse`, FB4 idle watchdog)
and emits `dumpComplete` when the wave drains (`reason='all-received'`) or
stalls out (`reason='watchdog'`). FB7 secured the exactly-once decrement this
relies on. C1 is the consumer migration.

**Render triggers (event-bridge.js).** The per-message timer stack
(`RENDER_COALESCE_MS` setTimeout chains + the shared lodash debounce + the
`render:request` indirection) is gone. The bridge now renders on these
signals (a third was added by R7 — child-of-current-menu arrival — after live
validation showed slow child dumps landing after the wave had settled):

1. `objectinfo:received` with `key === currentKey` — the **progressive
   structure paint**: the menu you navigated to paints the instant its dump
   lands, with values still loading.
2. `dumpComplete` — the **settled paint**: the request wave drained (or the
   watchdog gave up on a stall); render the confirmed state once. Value-only
   waves (meter polling, value refetches) render here — one render per wave,
   not per message. `hideLoading()` fires only when the wave carried
   OBJECTINFO requests (`payload.objectinfoSends > 0` — i.e. it could be the
   wave a navigation/refresh opened) or GET_SCREEN requests
   (`payload.screenSends > 0`, #3 — a bitmap fetch shows its own progress)
   or on a watchdog stall (never strand the spinner): with polling enabled,
   value-only waves drain every `METER_POLL_MS` and must not clear an
   unrelated loading state.

Renders that themselves issue requests (missing values, embed prefetch) start
a new wave, whose drain triggers the next settled paint; the loop converges
when a render issues no new requests. Convergence requires every refetch
predicate to treat a **confirmed-empty value** (`''` — the device may answer a
VALUE request with an empty value, device-model.md §6) as *present*: the NUM
refetch sites check `=== undefined`, not falsiness, since post-C1 a retry is
self-clocking at link speed instead of timer-throttled (C1 review finding).

**Consequences (intentional behavior changes):**

- The ~400ms render stall (coalesce + debounce) is gone; `RENDER_DEBOUNCE_MS`
  and `RENDER_COALESCE_MS` are deleted from constants.js, and the
  `lodash.debounce` runtime dependency is removed.
- **The autoload landing-page race is eliminated as a side effect.** The race
  existed because root's render was timer-delayed past `select-ports-init`
  (which sets `autoLoad=true`), so the root render consumed the flag and
  descended into the first *root* menu (setup) instead of the preset. With the
  root dump rendering synchronously on arrival — before the
  `PORT_INIT_MS`-delayed `select-ports-init` — root renders with
  `autoLoad=false`, and the flag is consumed by the *preset* render, which
  descends into the preset's first menu. This is the landing 3.3 wants
  (C2/#38 still owns removing the `PORT_INIT_MS` timer itself and landing via
  the root dump explicitly).
- Mid-wave CON updates no longer trigger per-message immediate renders;
  meters render once per poll-tick wave (drain follows the tick's last
  response). The parser still classifies and emits
  `value:received {immediate}` (C7-pinned); the bridge no longer consumes it.
- `isLoadingPreset` is deleted (C4): `hideLoading` is driven solely by
  `dumpComplete`, so the "don't hide early while a preset loads" interim
  gating falls away. The parser's Favorites re-order fix now gates on
  `loadingPresetName` alone — which **no production code writes** (pre-existing;
  the path is characterized by tests only — see the ledger).

**Test strategy.** `tests/event-bridge.test.js` pins the bridge contract
directly. The startup characterization Tier A/B sequences are rewritten in the
same commit, per their own charter, and now pin the race-free landing; their
remaining timer advances exist only to assert that nothing is pending. In
replay, a fixture response arrives without a recorded request
(`notifyResponse` no-ops at zero outstanding) while the render's own fan-out
sends open a wave; closing it takes a `WATCHDOG_IDLE_MS` advance or feeding
the wave to drain. The replay test asserts the synchronous structure paint
and deliberately leaves its wave open (wave state resets on the next fresh
wave start).

## C2 design — connect/landing without timers (implemented — branch refactor/c2-landing)

What C2 replaces (main.js `selectPorts` today): request root, then a
`PORT_INIT_MS` (500ms) `setTimeout` that blindly flips `currentKey` to the
*cached* preset and sets the sticky global `autoLoad=true` flag, which the
renderer's autoload branch later consumes to descend one menu. C1 removed the
wrong-landing symptom; C2 removes the mechanism — both the timer and the flag.

**Landing flow (event-driven, one-shot):**

1. `selectPorts`: set ports + listener, `showLoading`, then **reset the view
   to root before requesting** — `currentKey = KEY.ROOT`, clear `keyStack` and
   `currentSubs` — and request root (`OBJECTINFO(KEY.ROOT)` +
   `VALUE(KEY.ROOT)`). Set a one-shot app-view landing state (e.g.
   `pendingLanding = 'root'`). No timer, no `autoLoad` write. The reset
   matters because `selectPorts` is re-runnable (button + cached-config
   auto-run): without it, a reconnect while navigated deep would take the
   parser's *background*-root branch — `currentSubs` never updated to root —
   so the landing would pair key `KEY.ROOT` with the old menu's subs (wrong
   breadcrumb/sibling list) and a stale settled render could overwrite the
   connecting text. Resetting forces the full root branch every time.
2. On `objectinfo:received` with `key === KEY.ROOT` while `pendingLanding ===
   'root'`: the parser has already adopted authoritative DSP keys/names from
   the dump. Land: push the root keyStack entry
   (`makeKeyStackEntry(KEY.ROOT, currentSubs)` — since T1b:
   `deriveKeyStack(landKey)`), set `currentKey` to the active
   DSP's preset key **from the root dump** (`dspAKey`/`dspBKey`, chosen by the
   app-side active-DSP view state — fold Batch 3.2's "persist active DSP
   (default A)" item in here; the cached `presetKey` becomes a pre-paint hint
   only), advance `pendingLanding = 'preset'`, `updateScreen()`. Then issue
   the other-DSP prefetch and optional `0x18`, as today.
3. On `objectinfo:received` for the preset while `pendingLanding ===
   'preset'`: clear `pendingLanding`; if the preset top has no params and >1
   COL menus (short-tag-gated until T1b removed the label gate), descend
   once into the first (exactly what the
   autoload branch did, but triggered by explicit landing state, not a sticky
   flag read by every render). The renderer autoload branch and the
   `autoLoad` field are then deleted — every writer migrates to the same
   one-shot descend-on-next-current-key-dump state: the four renderer LCD
   click handlers (dsp-toggle, sibling-softkey, descend, back-link), the
   controls.js PARAMETER keypress handler, and the store.js default. The
   migration is behavior-preserving because the flag's only reader is the
   renderScreen autoload branch and every writer sets it immediately before
   `updateScreen()`.
4. Failure path (folds in the C1-review watchdog item): if `dumpComplete`
   fires `reason='watchdog'` while a landing — or a click handler's one-shot
   descend — is pending, clear that one-shot state too; do NOT land/descend
   from stale state (a pending descend surviving a stall would otherwise fire
   on a much later, unrelated dump). On a stalled fresh boot the settled
   render no-ops (step 1's reset left `currentSubs` empty), so the
   "Connected. Fetching root…" text stays; log the stall; sync/reconnect
   retries. With no sticky `autoLoad` flag there is nothing for a stall
   render to mis-consume; this subsumes the "watchdog dumpComplete
   mid-navigation autoload" ledger item once the flag is gone.
5. Out of scope for C2 (stays in 3.3): the cached structure-only pre-paint,
   the eager loader, `eagerLoad` flag, and the unconfirmed-value render
   guard.

**Tests:** startup characterization updated in the same commit — its inline
select-ports simulation loses the 500ms advance entirely (feed root → landing
fires synchronously → feed preset → explicit descend → feed landed menu →
`dumpComplete`); the `autoLoad` snapshot field in the recorder is replaced by
the landing state. Renderer tests for the descend-state replacement of the
autoload branch (fail-on-old via the deleted flag).

**Hardware validation (one consolidated session, after 3.3 is also coded):**
live connect on the real 31250-baud link (root dump arrival time vs the old
500ms guess; landing correctness), the wave-saturation smoke (polling +
bitmap-on-change vs the 10s watchdog ceiling), and eager-load throughput.

## T1b design — tree-derived navigation (SHIPPED: PR #109 merged 2026-06-10; GH #105 closed; device-on acceptance passed with zero audit violations)

The cure for the R-series bug class: the view derives from the device's
object tree, not from recorded click history or message-arrival races.

**Tree store (`src/tree.js`, module state like logger.js).** Every OBJECTINFO
dump describes one node and names its direct children, so the parser records
every dump unconditionally: `nodes[key] = subs`, and for each child line
`parents[childKey] = { parentKey: main.key, sub: childLine }`. The parent
linkage comes from the PARENT's dump (a dump cannot self-identify its parent —
§3), which every click-path navigation has necessarily loaded. Newest dump
wins (structure changes on preset load are absorbed by the per-visit
refetch). API: `recordDump(subs)`, `getNode(key)`, `parentOf(key)`,
`ancestorsOf(key)`, `findParamUnder(menuKey, paramKey)`, `labelFor(key)`,
`labelForSub(line)`, `deriveKeyStack(key)`, `reset()` (tests).

**What derives from the tree:**

- **keyStack becomes a derived view** (same `{key, tag, subs}` C3 shape, so
  renderer consumers and test shapes hold): every navigation sets
  `keyStack: deriveKeyStack(newKey)` = `ancestorsOf(newKey)` mapped through
  `labelFor`/`getNode`. No handler pushes or pops history; the back-link
  targets `parentOf(currentKey)`. Unknown ancestry (deep jump before the
  parent's dump ever loaded) renders no breadcrumb — honest, and click paths
  always have it. One deliberate exception (R2, live-validated): the static
  bottom-row jump RESETS the stack to `[]` instead of deriving — the bottom
  row is itself the root affordance, and a derived `[root]` entry would
  re-render root's children (presets included) as crumb/fallback rows above
  the identical static row, the duplicate-row class R2 removed.
- **childSubs is deleted.** Its three read sites move to the tree: the embed
  reads `getNode(candidate)`; the param-click lookup and the parser's C7
  CON-classification use `findParamUnder(currentKey, key)`; the R7 bridge
  trigger becomes `parentOf(key) === currentKey && getNode(key)`. The C8
  correlation guard — childSubs' reason to exist — is replaced by tree
  parentage: a dump is "a child of the current menu" iff the tree says so.
  updateScreen stops clearing structure (the tree persists as a cache;
  freshness comes from the per-visit child refetch); it still clears
  currentValues (volatile).
- **Labels:** `labelFor(key)` = the clipped label of the node's own main line
  or of its line in the parent's dump; when BOTH are blank, derive from the
  first labeled child (device precedent: the physical SETUP row labels the
  blank container by its child, 'dsp B'), else a `...` placeholder until the
  children load. Long tags CLIP to the column budget instead of excluding
  the child. Implementation refinement: the renderer labels children it is
  already holding via `labelForSub(line)` — the in-hand line IS the parent
  listing, so it is preferred and the tree is consulted only when the line
  is blank (keeps direct renders tree-independent; snapshots byte-identical).
  Softkey filters drop label gating entirely (`type === 'COL'`), so every
  COL child has an affordance — `unreachable-child` becomes structurally
  impossible. The parser fan-out fetches ALL COL children (presets excluded
  at root — they render as header tabs and the landing fetches the active
  one; labels no longer gate fetching, and blank nodes need their children
  loaded to be labeled);
  `navigation.js` keeps only `toggleDspKey` (`makeKeyStackEntry` and
  `softkeyLabel` are deleted, replaced by the tree equivalents).

**Out of scope (stays #106):** cache pre-paint on navigation, the
unconfirmed-value render guard (R3), the eager loader, and request
scheduling. Known open notes (#105): duplicate derived sibling labels
('Post'/'Post'), clipped-label bracket overflow.

**Acceptance:** offline suite green; then a device-on `npm run tree-audit`
reporting ZERO violations (the last standing class — blank-node reachability
— is resolved by the label policy). PASSED 2026-06-10: depth 2 at stock
defaults, 42 nodes fetched, 41 audited, zero violations. (The auditor's
settle window is now bounded by link idleness rather than wall-clock — the
old fixed 15s cap flagged one spurious no-render while the program
subtree's bank-list backlog was still draining, the R5 congestion class;
app-side request scheduling stays with #106.)

## R3 render guard — pre-paint from the tree (#106 first half; branch fix/r3-render-guard)

The "never render unconfirmed state as confirmed" invariant, made concrete:
`renderScreen` refuses to paint subs whose main key differs from
`currentKey` (a stale dump while the navigated-to key's response is in
flight). It pre-paints instead: the tree's cached node for `currentKey` —
title + breadcrumb real, COL children as live softkeys, every param line
inert with format specifiers replaced by `RENDER.VALUE_PLACEHOLDER` (no
clickable spans/selects, no value refetches — the real render owns those) —
or a synthetic `RENDER.LOADING_STATEMENT` node when the tree has never seen
the key. Pre-paint passes write no state: the `currentSubs`/
`currentSoftkeys` render-pins record device-confirmed renders only, which
also keeps the tree-audit settle condition honest (it waits for the real
dump, never a cache paint). Embeds are deferred to the real render (their
child params would also be unconfirmed). The other #106 half — eager
loader, `eagerLoad` flag, request scheduling from R5's data — builds on the
same tree (next section).

## Eager loader — background structure warm-up (#106 second half; branch feat/eager-loader)

`src/eager-loader.js`: a breadth-first walk of the active preset's COL
subtree, fetching OBJECTINFO for nodes the tree does not know, bounded by
`EAGER.MAX_DEPTH` (3) plus a visited set (the actual cycle guard). The
scheduling is the R5 lesson made code: exactly ONE request in flight.
The advance signal is the TREE at wave boundaries, not an event-per-response
(review blocker, fixed): the parser emits `objectinfo:received` only for
on-screen-related keys, so the loader's background fetches are silently
tree-recorded; every `dumpComplete` is therefore a decision point — tree
knows the pending node (including after a watchdog, where the response
often arrived late behind a bitmap transfer, R5a) → advance and enqueue
its children; tree does not → the response is not coming, skip. `events.js`
emit was hardened to snapshot iteration so the walk's own just-added
listener never receives the in-flight `dumpComplete` that started it (a
walk token guards the removed-during-emit flip side). Tree-cached nodes are
walked synchronously at zero request cost, which is what makes the loader
compose with the parser's per-menu fan-out instead of duplicating it — the
bridge arms the load at the C2 landing and starts it on the first CLEAN
(`all-received`) drain afterward, when the fan-out's responses are already
recorded. Watchdog drains keep the arm: live-validated, the landing wave
routinely stalls on the ~1.2s bitmap transfer (R5a) and self-heals on the
next wave.

Two deliberate deviations from the original #106 sketch, decided with T1b
in place: (1) no VALUE_DUMP prefetch — `currentValues` is per-visit
volatile (`updateScreen` clears it, C8), so eager values would be discarded
unseen; structure is the durable half, and it is exactly what the R3
pre-paint consumes. (2) No dedicated loading UX — the walk is background
traffic behind the connect overlay the landing already shows, and blocking
the UI on a warm-up would invert its purpose. `appState.eagerLoad`
(midiConfig-persisted, default on) gates the arm.

## Stable-subtree caching — #113 (branch feat/program-subtree-cache)

Maintainer report: "loading program takes a ton of time... only a handful
of actions can cause a change to program." The program subtree's dumps are
the heaviest on the link (the ~70-name bank list is multi-second at 31250
baud) yet its STRUCTURE changes only via an enumerable set of actions — so
per-visit child refetch (the default freshness policy) is almost always
wasted there.

**Policy (lives with the cache, `tree.js`):**
`CACHE.STABLE_SUBTREE_PREFIXES` (one entry today: the program prefix
`10020`) declares subtrees whose cached child dumps may be trusted across
visits. Staleness is **per-key** (review-hardened design): marking stales
every CACHED key under the prefix, and a key becomes fresh again only when
`recordDump` actually re-records IT. Drop-tolerant by construction — a
refetch whose response never arrives leaves the key stale and the next
visit retries — and a deep visit can never launder staleness into siblings
it did not re-record. The parser's per-visit child fan-out skips the
STRUCTURE refetch for `isFresh(key)` children; the visited menu's OWN dump
always refetches (`updateScreen` untouched), and a skipped child's **param
values are still refreshed** (small VALUE requests over its cached lines),
so the per-visit value-volatility contract holds on the warm path too —
only the heavy OBJECTINFO option lists are trusted.

**Invalidation (two in-app chokepoints + explicit re-reads):**

- `sendValuePut` stales the key's stable prefix: TRG loads/saves/deletes/
  card ops, STR name edits, AND SET selects — bank selection matters
  because changing the bank changes the program list the device returns.
- `sendKeypress` stales ALL stable caches: the virtual front-panel keys
  drive the real device UI, and the app cannot interpret which presses are
  part of a mutating sequence. Conservative; costs at most one refetch.
- Sync-to-Hardware and selectPorts (reconnect) stale ALL stable caches —
  the answer to device-side mutations the app cannot observe: physical
  front panel, card insertion/removal, external MIDI program changes.
  (Future structural hook: the device emits a bank-change SysEx whose
  format is uncaptured — device-model §12; capturing it would give an
  automatic invalidation signal.)

Eager loader unaffected (it already skips cached nodes). Acceptance: live
before/after of a program-menu visit (cold 41 sends / 17.9s settled vs
warm 27 sends / 646ms — 1 OBJECTINFO plus the small per-param VALUE
refreshes; logs/live-prog-113b.log) plus a zero-violation tree audit.

## Validation / open items

- (RESOLVED 2026-06-10) Eager-load throughput on real hardware: production
  trigger validated live (logs/live-eager-acceptance2.log) — armed through
  the R5a landing stall, started on the next clean drain, zero duplicate
  requests against the fan-out's cache. A forced deep walk from ROOT (a
  stress path production does not take; logs/live-eager-acceptance4.log)
  walked 75 nodes / 79 fetches in ~37s with one-retry-at-tail absorbing the
  slow-dump backlog cascade; 6 nodes whose retry also raced the backlog
  stay un-walked (their late dumps still tree-record; children only —
  per-visit refetch covers correctness). Revisit pacing only if a root-wide
  eager walk ever ships.
- Whether any device value key reports the active DSP (would upgrade active-DSP
  from app-guess to device-confirmed). Hardware exploration, optional.
