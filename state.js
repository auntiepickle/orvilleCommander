// state.js
export const appState = {
  currentKey: '0',
  presetKey: null,
  currentValues: {},
  paramOffset: 0,
  menus: [],
  autoLoad: false,
  autoNavigated: false,
  keyStack: [],
  dspAKey: '401000b',
  dspBKey: '801000b',
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
    error: true,
    general: true
  }
};