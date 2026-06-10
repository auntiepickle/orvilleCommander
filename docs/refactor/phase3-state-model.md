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
3. **Request root.** On `rootDumpComplete`, adopt the device's real DSP A/B
   keys + names as authoritative (discard the cache hint if it disagrees).
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
  timer stack; folds in `isLoadingPreset` removal.
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
2. `dumpComplete` — the **settled paint** + `hideLoading()`: the request wave
   drained (or the watchdog gave up on a stall); render the confirmed state
   once. Value-only waves (meter polling, value refetches) render here — one
   render per wave, not per message.

Renders that themselves issue requests (missing values, embed prefetch) start
a new wave, whose drain triggers the next settled paint; the loop converges
when a render issues no new requests.

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

**Test strategy.** Replay/startup suites no longer advance coalesce timers;
where fixture responses are fed without recorded requests (replay), the
parser's own fan-out sends open a wave and the idle watchdog
(`WATCHDOG_IDLE_MS`) closes it — or the suite feeds the wave to drain. The
startup characterization Tier A/B sequences are rewritten in the same commit,
per their own charter, and now pin the race-free landing.

## Validation / open items

- Eager-load throughput on real hardware (many `OBJECTINFO`/`VALUE` round
  trips) — confirm the wave completes promptly; tune depth/bound if needed.
  Hardware-gated; the replay harness can cover the parsing/render half offline.
- Whether any device value key reports the active DSP (would upgrade active-DSP
  from app-guess to device-confirmed). Hardware exploration, optional.
