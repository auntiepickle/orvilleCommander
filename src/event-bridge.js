// src/event-bridge.js
//
// Step 7 parser <-> renderer handoff. Parser emits objectinfo:received,
// value:received, screen:received; this bridge owns the coalescing
// (renderTimeout + shared debounce) and the isLoadingPreset/hideLoading
// invariants that used to be inlined in parser.js.
//
// hideLoading is injected via the registerEventBridge({ hideLoading })
// parameter rather than imported from main.js. That injection is what
// severs the would-be event-bridge.js -> main.js back-edge (main.js
// imports registerEventBridge from here). Without DI, this module would
// create a new event-bridge.js <-> main.js cycle. The point of Step 7 is
// killing cycles, not relocating them.
//
// ONE debouncedRenderRequest instance is constructed per registerEventBridge
// call and closed over by all four on(...) registrations. Per-emit
// construction would silently break the 200ms coalescing. renderTimeout is
// shared between the objectinfo and value subscribers so an A-then-F
// cross-event sequence clears as it did when both lived in parser.
//
// registerEventBridge returns a teardown function. Production calls it once
// at boot and ignores the return; the startup characterization test calls
// it per-beforeEach and uses the teardown in afterEach to prevent
// cross-test subscriber leakage.

import { emit, on } from './events.js';
import { renderScreen } from './renderer.js';
import { parseSubObject } from './parser.js';
import { renderBitmap } from './bitmap.js';
import { appState } from './state.js';
import { setState } from './store.js';
import { log } from './logger.js';
import debounce from 'lodash.debounce';

export function registerEventBridge({ hideLoading }) {
  let renderTimeout = null;
  const unsubscribers = [];

  const debouncedRenderRequest = debounce(({ subs, ascii }) => {
    let subsToUse = subs;
    if (!subsToUse && ascii) {
      subsToUse = ascii.split('\n').map(line => line.trim()).filter(line => line).map(parseSubObject);
    }
    renderScreen(subsToUse, ascii, log);
  }, 200);

  unsubscribers.push(on('render:request', debouncedRenderRequest));

  unsubscribers.push(on('objectinfo:received', ({ key, subs, ascii }) => {
    if (key === appState.currentKey) {
      if (renderTimeout) clearTimeout(renderTimeout);
      renderTimeout = setTimeout(() => {
        emit('render:request', { subs, ascii });
        if (!appState.isLoadingPreset) hideLoading();
        renderTimeout = null;
      }, 200);
    } else if (key === '0' && appState.currentKey !== '0') {
      emit('render:request', { subs: appState.currentSubs, ascii: appState.lastAscii });
      if (appState.isLoadingPreset) {
        hideLoading();
        setState({ isLoadingPreset: false }, 'main:objectinfo-loading-preset-clear');
      }
    } else {
      emit('render:request', { subs: appState.currentSubs, ascii: appState.lastAscii });
    }
  }));

  unsubscribers.push(on('value:received', ({ immediate }) => {
    if (immediate) {
      emit('render:request', { subs: appState.currentSubs, ascii: null });
    } else {
      if (renderTimeout) clearTimeout(renderTimeout);
      renderTimeout = setTimeout(() => {
        emit('render:request', { subs: null, ascii: appState.lastAscii });
        if (!appState.isLoadingPreset) hideLoading();
        renderTimeout = null;
      }, 200);
    }
  }));

  unsubscribers.push(on('screen:received', ({ rawBytes }) => {
    renderBitmap('lcd-canvas', rawBytes);
  }));

  return function teardown() {
    for (const off of unsubscribers) off();
    unsubscribers.length = 0;
    if (renderTimeout) {
      clearTimeout(renderTimeout);
      renderTimeout = null;
    }
  };
}
