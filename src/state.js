// state.js
//
// Backwards-compatibility re-export. The appState object now lives in
// store.js (roadmap step 4). Existing `import { appState } from './state.js'`
// callers continue to work unchanged.

export { appState } from './store.js';
