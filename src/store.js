// store.js

/**
 * Façade over the legacy appState singleton.
 *
 * Step 4 of the refactor roadmap: introduces an auditable write path
 * (setState) without forcing any caller to migrate. state.js re-exports
 * appState from here so direct `appState.x = y` writes keep working —
 * they hit the same mutated object every reader holds.
 *
 * TRIPWIRE: setState uses Object.assign to mutate appState in place.
 * Callers in parser.js (and elsewhere) read appState.x after calling
 * setState({ x: ... }) and rely on the same module-level binding
 * resolving to the mutated object. Do not rewrite setState to replace
 * the binding (e.g. appState = { ...appState, ...partial }) — it will
 * silently desync every existing direct-mutation caller and every
 * post-setState read in parser.js.
 */

import { log } from './logger.js';

export const appState = {
  currentKey: '0',
  presetKey: '401000b',
  currentValues: {},
  paramOffset: 0,
  // C2 (#38): one-shot navigation state replacing the sticky autoLoad flag.
  // pendingLanding: null | 'root' | 'preset' — connect-flow landing machine.
  // Only 'root' gates behavior (the bridge's landing block); 'preset' is a
  // breadcrumb for observability/tests — the post-landing descend rides the
  // generic pendingDescend below, and the watchdog clear sweeps both.
  // pendingDescend: consume on the next currentKey dump; descend once if the
  // menu is COL-only with >1 short-tag children (old autoload semantics).
  pendingLanding: null,
  pendingDescend: false,
  keyStack: [],
  dspAKey: '401000b',
  dspBKey: '801000b',
  dspAName: '',
  dspBName: '',
  currentSubs: [],
  lastAscii: '',
  deviceId: 0,
  // logLevel + logCategories moved into logger.js (C6) to break the
  // store -> logger -> state import cycle.
  fetchBitmap: true,
  updateBitmapOnChange: true,
  currentSoftkeys: [],
  pollingEnabled: false,
  // isLoadingPreset deleted (C4/#40): hideLoading is driven by dumpComplete.
  childSubs: {}, // Added for child sub-menu storage
  lastDumpComplete: null, // 7c shadow-fire breadcrumb; written by midi:dump-complete
};

export function setState(partial, origin) {
  Object.assign(appState, partial);
  log(`[stateWrite] ${origin}: ${Object.keys(partial).join(', ')}`, 'debug', 'stateWrite');
}
