// src/event-bridge.js
//
// Step 7 parser <-> renderer handoff, rebuilt on dumpComplete (Phase 3.1,
// C1/#37). The old per-message timer stack (RENDER_COALESCE_MS setTimeout
// chains + a shared lodash debounce + the render:request indirection) is
// gone; midi.js's request-wave tracking is the render clock now.
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
// A render that itself issues requests (missing values, embed prefetch)
// opens a new wave whose drain triggers the next settled paint; the loop
// converges when a render issues no new requests. value:received is still
// emitted by the parser (C7 classification, pinned by tests) but the bridge
// no longer consumes it; isLoadingPreset is deleted (C4/#40) — hideLoading
// is driven solely by dumpComplete.
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
import { renderScreen } from './renderer.js';
import { renderBitmap } from './bitmap.js';
import { appState } from './state.js';
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
    on('objectinfo:received', ({ key }) => {
      if (key === appState.currentKey) render();
    })
  );

  unsubscribers.push(
    on('dumpComplete', (payload) => {
      render();
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
