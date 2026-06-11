// src/event-bridge.js
//
// Step 7 parser <-> renderer handoff, rebuilt on dumpComplete (Phase 3.1,
// C1/#37), now also home to the connect-landing / one-shot-descend state
// machine (C2/#38). midi.js's request-wave tracking is the render clock.
//
// Render triggers — exactly three:
//   1. objectinfo:received with key === currentKey: the PROGRESSIVE
//      structure paint. The menu being navigated to paints the instant its
//      dump lands (values may still be loading).
//   2. dumpComplete: the SETTLED paint + hideLoading. The request wave
//      drained ('all-received') or stalled out ('watchdog'); render the
//      confirmed state once. Value-only waves (meter poll ticks, value
//      refetches) render here — one render per wave, not per message.
//   3. objectinfo:received for a key the tree records as a child of the
//      on-screen menu (R7; condition via T1b tree parentage): a child
//      arrived — repaint so embeds/child data show the moment they land,
//      not on the next unrelated render.
//
// Navigation one-shots (C2 — replaces the PORT_INIT_MS timer and the sticky
// autoLoad flag; see docs/refactor/phase3-state-model.md "C2 design"):
//   - pendingLanding === 'root' + the root dump arrives: adopt the dump's
//     authoritative DSP keys (parser already wrote them), push the root
//     keyStack entry, navigate to the active DSP's preset (A/B chosen by the
//     persisted presetKey prefix — the cached KEY itself is only a hint),
//     prefetch the other DSP, optional screen fetch.
//   - pendingDescend + the currentKey dump arrives: consume the one-shot;
//     if the menu is COL-only with >1 COL children, descend once into the
//     first (the old autoload semantics minus the T1b-removed label gate,
//     triggered by the dump for the navigated-to menu — never by a stale
//     render).
//   - A watchdog dumpComplete clears both one-shots: never land or descend
//     from stale state, and a pending descend must not fire on a much
//     later, unrelated dump.
//
// hideLoading is injected via registerEventBridge({ hideLoading }) rather
// than imported from main.js — that injection severs the would-be
// event-bridge.js -> main.js back-edge (main.js imports registerEventBridge
// from here). The point of Step 7 was killing cycles, not relocating them.
//
// registerEventBridge returns a teardown function. Production calls it once
// at boot and ignores the return; tests call it per-beforeEach and use the
// teardown in afterEach to prevent cross-test subscriber leakage.

import { on } from './events.js';
import { renderScreen, updateScreen } from './renderer.js';
import { renderBitmap } from './bitmap.js';
import { appState } from './state.js';
import { setState } from './store.js';
import { sendObjectInfoDump, sendSysEx } from './midi.js';
import { getNode, parentOf, deriveKeyStack } from './tree.js';
import { startEagerLoad } from './eager-loader.js';
import { CMD, KEY, KEY_PREFIX, PARAM_TYPES } from './sysex-commands.js';
import { log } from './logger.js';

export function registerEventBridge({ hideLoading }) {
  const unsubscribers = [];

  // Armed by the connect landing; consumed by the next drained wave. The
  // eager loader starts only AFTER the landing wave drains so the parser's
  // own fan-out responses are already tree-recorded — starting at landing
  // time would re-request every in-flight child (#106).
  let eagerLoadArmed = false;

  const render = () => {
    // renderScreen no-ops on empty subs itself; the guard here just avoids
    // the call entirely before anything has been parsed (e.g. a watchdog
    // dumpComplete on a wave whose responses never arrived).
    if (appState.currentSubs && appState.currentSubs.length > 0) {
      renderScreen(appState.currentSubs, appState.lastAscii, log);
    }
  };

  unsubscribers.push(
    on('objectinfo:received', ({ key, subs }) => {
      if (key === appState.currentKey) render();
      // Third render trigger (R7, live-validated): a CHILD of the current
      // menu arrived — the TREE says it belongs to the on-screen menu (T1b
      // replaced the childSubs correlation). Without this, slow child dumps
      // (e.g. the multi-second bank list the program menu embeds) land AFTER
      // the wave has already watchdogged and settled, and nothing ever
      // repaints — the embed only appeared after navigating away and back.
      else if (parentOf(key) === appState.currentKey && getNode(key)) render();

      // C2 landing: the root dump arrived while a connect is pending.
      // selectPorts reset currentKey to root, so the progressive root paint
      // above has already happened; now navigate to the active preset. The
      // key === currentKey guard means a background-branch root dump (user
      // navigated away before the dump arrived) cannot land from stale view
      // state; the next reconnect re-arms cleanly (C2 review).
      if (key === KEY.ROOT && key === appState.currentKey && appState.pendingLanding === 'root') {
        const activeIsB = appState.presetKey.startsWith(KEY_PREFIX.DSP_B);
        const landKey = activeIsB ? appState.dspBKey : appState.dspAKey;
        const otherKey = activeIsB ? appState.dspAKey : appState.dspBKey;
        setState(
          {
            pendingLanding: 'preset',
            pendingDescend: true,
            keyStack: deriveKeyStack(landKey), // T1b: [root entry] from the just-recorded root dump
            currentKey: landKey,
            presetKey: landKey,
          },
          'bridge:landing-root'
        );
        updateScreen(log);
        sendObjectInfoDump(otherKey); // other-DSP prefetch (dump-authoritative key)
        if (appState.fetchBitmap) {
          sendSysEx(CMD.GET_SCREEN, []);
          log('Fetched initial preset screen.', 'info', 'general');
        }
        eagerLoadArmed = appState.eagerLoad === true; // start after this wave drains (#106)
        return; // currentKey changed; nothing below applies to this dump
      }

      // C2 one-shot descend: the dump for the menu we navigated to arrived.
      // Uses the dump's own subs (the parser gate guarantees subs[0].key ===
      // currentKey here), so the descend can never read a stale render.
      if (key === appState.currentKey && appState.pendingDescend && subs) {
        setState({ pendingDescend: false, pendingLanding: null }, 'bridge:descend-consume');
        const children = subs.slice(1);
        const hasParams = children.some((s) => PARAM_TYPES.includes(s.type));
        // T1b: every COL child counts (labels no longer gate navigability).
        const colChildren = children.filter((s) => s.type === 'COL');
        if (!hasParams && colChildren.length > 1) {
          log(
            `Auto-loading first menu: ${colChildren[0].key} - ${colChildren[0].tag || colChildren[0].statement}`,
            'info',
            'general'
          );
          setState(
            {
              // The dump just recorded into the tree, so ancestry is fresh.
              keyStack: deriveKeyStack(colChildren[0].key),
              currentKey: colChildren[0].key,
            },
            'bridge:descend'
          );
          updateScreen(log);
        }
      }
    })
  );

  // Faceplate BUSY LED (#131): the hardware semantic is "lit while data
  // moves on the MIDI link" (manual p.10), which maps exactly onto the
  // dump-wave lifecycle — on at wave open, off when the wave settles. This
  // is presentation only; absence of the element (tests, headless) is fine.
  const setBusyLed = (lit) => {
    const led = document.getElementById('busy-led');
    if (led) led.classList.toggle('lit', lit);
  };

  unsubscribers.push(
    on('wave:opened', () => {
      setBusyLed(true);
    })
  );

  unsubscribers.push(
    on('dumpComplete', (payload) => {
      setBusyLed(false);
      render();
      // A stalled wave invalidates any pending one-shot: do not land or
      // descend from stale state (C2 design step 4).
      if (payload?.reason === 'watchdog' && (appState.pendingLanding || appState.pendingDescend)) {
        setState({ pendingLanding: null, pendingDescend: false }, 'bridge:landing-stall-clear');
        log('Wave stalled with a pending landing/descend; cleared.', 'error', 'error');
      }
      // Clear the loading indicator only when the wave carried OBJECTINFO
      // (structure) or GET_SCREEN requests — i.e. it could be the wave a
      // navigation, refresh, or bitmap fetch opened (#3) — or when the
      // watchdog gave up (never strand the spinner on a stall). With meter
      // polling enabled, value-only waves drain every METER_POLL_MS and
      // must not hide an unrelated loading state that was shown for an
      // in-flight navigation (C1 review).
      if (
        payload?.objectinfoSends > 0 ||
        payload?.screenSends > 0 ||
        payload?.reason === 'watchdog'
      ) {
        hideLoading();
      }
      // #106: the first CLEAN drain after the landing starts the background
      // structure warm-up (serialized; see eager-loader.js). A watchdog
      // drain keeps the arm: with fetchBitmap on, the landing wave
      // routinely stalls on the ~1.2s bitmap transfer (R5a) and self-heals
      // on the next wave — live-validated; disarming there would skip the
      // eager load on the most common config. presetKey is read at start
      // time, so a preset switch before the first clean drain warms the
      // NEW active preset.
      if (eagerLoadArmed && payload?.reason === 'all-received') {
        eagerLoadArmed = false;
        startEagerLoad(appState.presetKey);
      } else if (eagerLoadArmed) {
        log(
          'Eager load still armed: landing wave stalled; waiting for a clean drain.',
          'info',
          'general'
        );
      }
    })
  );

  unsubscribers.push(
    on('screen:received', ({ rawBytes }) => {
      renderBitmap('lcd-canvas', rawBytes);
    })
  );

  return function teardown() {
    for (const off of unsubscribers) off();
    unsubscribers.length = 0;
  };
}
