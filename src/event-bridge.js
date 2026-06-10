// src/event-bridge.js
//
// Step 7 parser <-> renderer handoff, rebuilt on dumpComplete (Phase 3.1,
// C1/#37), now also home to the connect-landing / one-shot-descend state
// machine (C2/#38). midi.js's request-wave tracking is the render clock.
//
// Render triggers — exactly two:
//   1. objectinfo:received with key === currentKey: the PROGRESSIVE
//      structure paint. The menu being navigated to paints the instant its
//      dump lands (values may still be loading).
//   2. dumpComplete: the SETTLED paint + hideLoading. The request wave
//      drained ('all-received') or stalled out ('watchdog'); render the
//      confirmed state once. Value-only waves (meter poll ticks, value
//      refetches) render here — one render per wave, not per message.
//
// Navigation one-shots (C2 — replaces the PORT_INIT_MS timer and the sticky
// autoLoad flag; see docs/refactor/phase3-state-model.md "C2 design"):
//   - pendingLanding === 'root' + the root dump arrives: adopt the dump's
//     authoritative DSP keys (parser already wrote them), push the root
//     keyStack entry, navigate to the active DSP's preset (A/B chosen by the
//     persisted presetKey prefix — the cached KEY itself is only a hint),
//     prefetch the other DSP, optional screen fetch.
//   - pendingDescend + the currentKey dump arrives: consume the one-shot;
//     if the menu is COL-only with >1 short-tag children, descend once into
//     the first (the old autoload semantics, but triggered by the dump for
//     the navigated-to menu — never by a stale render).
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
import { makeKeyStackEntry } from './navigation.js';
import { CMD, KEY, KEY_PREFIX, PARAM_TYPES } from './sysex-commands.js';
import { LAYOUT } from './constants.js';
import { log } from './logger.js';

export function registerEventBridge({ hideLoading }) {
  const unsubscribers = [];

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
            keyStack: [...appState.keyStack, makeKeyStackEntry(KEY.ROOT, appState.currentSubs)],
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
        return; // currentKey changed; nothing below applies to this dump
      }

      // C2 one-shot descend: the dump for the menu we navigated to arrived.
      // Uses the dump's own subs (the parser gate guarantees subs[0].key ===
      // currentKey here), so the descend can never read a stale render.
      if (key === appState.currentKey && appState.pendingDescend && subs) {
        setState({ pendingDescend: false, pendingLanding: null }, 'bridge:descend-consume');
        const children = subs.slice(1);
        const hasParams = children.some((s) => PARAM_TYPES.includes(s.type));
        const softSubsLocal = children.filter(
          (s) => s.type === 'COL' && s.tag.trim().length <= LAYOUT.SHORT_TAG_MAX && s.tag.trim()
        );
        if (!hasParams && softSubsLocal.length > 1) {
          log(
            `Auto-loading first menu: ${softSubsLocal[0].key} - ${softSubsLocal[0].tag}`,
            'info',
            'general'
          );
          setState(
            {
              keyStack: [...appState.keyStack, makeKeyStackEntry(appState.currentKey, subs)],
              currentKey: softSubsLocal[0].key,
            },
            'bridge:descend'
          );
          updateScreen(log);
        }
      }
    })
  );

  unsubscribers.push(
    on('dumpComplete', (payload) => {
      render();
      // A stalled wave invalidates any pending one-shot: do not land or
      // descend from stale state (C2 design step 4).
      if (payload?.reason === 'watchdog' && (appState.pendingLanding || appState.pendingDescend)) {
        setState({ pendingLanding: null, pendingDescend: false }, 'bridge:landing-stall-clear');
        log('Wave stalled with a pending landing/descend; cleared.', 'error', 'error');
      }
      // Clear the loading indicator only when the wave carried OBJECTINFO
      // (structure) requests — i.e. it could be the wave a navigation or
      // refresh opened — or when the watchdog gave up (never strand the
      // spinner on a stall). With meter polling enabled, value-only waves
      // drain every METER_POLL_MS and must not hide an unrelated loading
      // state that was shown for an in-flight navigation (C1 review).
      if (payload?.objectinfoSends > 0 || payload?.reason === 'watchdog') {
        hideLoading();
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
