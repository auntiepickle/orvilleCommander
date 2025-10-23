// state.js

/**
 * Centralized application state object. This serves as the single source of truth for the app's runtime data,
 * including navigation, values, and configurations. It enables reactivity across modules like renderer.js and parser.js.
 * 
 * @type {Object}
 * @property {string} currentKey - The current menu key (e.g., '0' for root).
 * @property {string} presetKey - The key for the current preset (e.g., '401000b').
 * @property {Object} currentValues - Map of key-value pairs for parameter values.
 * @property {number} paramOffset - Offset for parameter scrolling.
 * @property {boolean} autoLoad - Flag to auto-load sub-menus.
 * @property {Array<Object>} keyStack - Stack for navigation history (each entry: {key, tag, subs}).
 * @property {string} dspAKey - Key for DSP A preset.
 * @property {string} dspBKey - Key for DSP B preset.
 * @property {string} dspAName - Name of DSP A preset.
 * @property {string} dspBName - Name of DSP B preset.
 * @property {Array<Object>} currentSubs - Current sub-objects from OBJECTINFO_DUMP.
 * @property {string} lastAscii - Last received ASCII dump for rendering.
 * @property {number} deviceId - MIDI device ID.
 * @property {string} logLevel - Logging level (e.g., 'info').
 * @property {Object} logCategories - Map of log categories to enable/disable.
 * @property {boolean} fetchBitmap - Flag to fetch screen bitmaps.
 * @property {boolean} updateBitmapOnChange - Flag to update bitmap on value changes.
 * @property {Array} currentSoftkeys - Current softkeys (deprecated?).
 * @property {boolean} pollingEnabled - Flag for meter polling.
 * @property {boolean} isLoadingPreset - Flag during preset loading.
 * @property {Array} currentSoftkeys - Duplicate? (Check for removal in refactor).
 * @property {Object} childSubs - Map of child sub-menus by key.
 * 
 * @example
 * // Accessing state in another module
 * import { appState } from './state.js';
 * console.log(appState.currentKey); // '0'
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
  currentSoftkeys: [],
  childSubs: {} // Added for child sub-menu storage
};