// state.js
export const appState = {
  currentKey: '0',
  presetKey: '401000b',
  currentValues: {},
  paramOffset: 0,
  menusA: [],
  menusB: [],
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
  isLoadingPreset: false
};