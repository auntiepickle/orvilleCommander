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
`render:request` indirection) is gone. The bridge now renders on exactly two
signals:

1. `objectinfo:received` with `key === currentKey` — the **progressive
   structure paint**: the menu you navigated to paints the instant its dump
   lands, with values still loading.
2. `dumpComplete` — the **settled paint**: the request wave drained (or the
   watchdog gave up on a stall); render the confirmed state once. Value-only
   waves (meter polling, value refetches) render here — one render per wave,
   not per message. `hideLoading()` fires only when the wave carried
   OBJECTINFO requests (`payload.objectinfoSends > 0` — i.e. it could be the
   wave a navigation/refresh opened) or on a watchdog stall (never strand the
   spinner): with polling enabled, value-only waves drain every
   `METER_POLL_MS` and must not clear an unrelated loading state.

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
   (`makeKeyStackEntry(KEY.ROOT, currentSubs)`), set `currentKey` to the active
   DSP's preset key **from the root dump** (`dspAKey`/`dspBKey`, chosen by the
   app-side active-DSP view state — fold Batch 3.2's "persist active DSP
   (default A)" item in here; the cached `presetKey` becomes a pre-paint hint
   only), advance `pendingLanding = 'preset'`, `updateScreen()`. Then issue
   the other-DSP prefetch and optional `0x18`, as today.
3. On `objectinfo:received` for the preset while `pendingLanding ===
   'preset'`: clear `pendingLanding`; if the preset top has no params and >1
   short-tag COL menus, descend once into the first (exactly what the
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

## Validation / open items

- Eager-load throughput on real hardware (many `OBJECTINFO`/`VALUE` round
  trips) — confirm the wave completes promptly; tune depth/bound if needed.
  Hardware-gated; the replay harness can cover the parsing/render half offline.
- Whether any device value key reports the active DSP (would upgrade active-DSP
  from app-guess to device-confirmed). Hardware exploration, optional.
