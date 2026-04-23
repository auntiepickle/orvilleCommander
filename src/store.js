// store.js

/**
 * Façade over the legacy appState singleton.
 *
 * Step 4 of the refactor roadmap: introduces an auditable write path
 * (setState) and a subscription hook without forcing any caller to
 * migrate. state.js re-exports appState from here so direct
 * `appState.x = y` writes keep working — they hit the same object that
 * getState() returns and that subscribers see.
 */

export const appState = {
  currentKey: '0',
  presetKey: '401000b',
  currentValues: {},
  paramOffset: 0,
  autoLoad: false,
  keyStack: [],
  dspAKey: '401000b',
  dspBKey: '801000b',
  dspAName: '',
  dspBName: '',
  currentSubs: [],
  lastAscii: '',
  deviceId: 0,
  logLevel: 'info',
  logCategories: {
    sysexReceived: true,
    sysexSent: true,
    parsedDump: true,
    valueChange: true,
    noChange: true,
    renderScreen: true,
    bitmap: true,
    screenDump: true,
    error: true,
    general: true
  },
  fetchBitmap: true,
  updateBitmapOnChange: true,
  currentSoftkeys: [],
  pollingEnabled: false,
  isLoadingPreset: false,
  childSubs: {} // Added for child sub-menu storage
};

const subscribers = new Set();

export function getState() {
  return appState;
}

export function setState(partial) {
  Object.assign(appState, partial);
  for (const fn of subscribers) fn(appState);
}

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
