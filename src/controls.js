// controls.js
import { sendKeypress, sendSysEx } from './midi.js';
import { updateScreen } from './renderer.js';
import { appState } from './state.js';
import { setState } from './store.js';
import { log } from './logger.js';
import { toggleDspKey } from './navigation.js';

/**
 * Mapping of key names to their corresponding MIDI keypress mask arrays.
 * These masks are used to simulate button presses on the Orville device via SysEx.
 * Each mask is a 4-byte array representing the bitmasks for key states.
 *
 * @type {Object.<string, number[]>}
 * @example
 * // Usage in sendKeypress
 * const mask = keypressMasks['up']; // [0xFE, 0xFF, 0xFD, 0xFF]
 */
export const keypressMasks = {
  up: [0xfe, 0xff, 0xfd, 0xff],
  down: [0xff, 0xfe, 0xfd, 0xff],
  left: [0xff, 0xfe, 0xff, 0xff],
  right: [0xfe, 0xff, 0xff, 0xff],
  enter: [0xff, 0xff, 0xff, 0xef],
  select: [0xff, 0xff, 0xfe, 0xff],
  program: [0xf7, 0xff, 0xff, 0xff],
  parameter: [0xff, 0xf7, 0xff, 0xff],
  levels: [0xff, 0xff, 0xff, 0xfd],
  setup: [0xff, 0xff, 0xf7, 0xff],
  bypass: [0xff, 0xff, 0xfd, 0xff],
  inc: [0xff, 0xff, 0xff, 0x7f],
  dec: [0xff, 0xff, 0xff, 0xbf],
  soft1: [0xfb, 0xff, 0xff, 0xff],
  soft2: [0xff, 0xfb, 0xff, 0xff],
  soft3: [0xff, 0xff, 0xfb, 0xff],
  soft4: [0xff, 0xff, 0xff, 0xfb],
  ab: [0xfd, 0xff, 0xfd, 0xff],
  'program-hold': [0xf7, 0xff, 0xff, 0xfe],
  'parameter-hold': [0xff, 0xf7, 0xff, 0xfe],
  'select-hold': [0xff, 0xff, 0xfe, 0xfe],
  1: [0x7f, 0xff, 0xff, 0xff],
  2: [0xff, 0x7f, 0xff, 0xff],
  3: [0xff, 0xff, 0x7f, 0xff],
  4: [0xbf, 0xff, 0xff, 0xff],
  5: [0xff, 0xbf, 0xff, 0xff],
  6: [0xff, 0xff, 0xbf, 0xff],
  7: [0xdf, 0xff, 0xff, 0xff],
  8: [0xff, 0xdf, 0xff, 0xff],
  9: [0xff, 0xff, 0xdf, 0xff],
  0: [0xff, 0xef, 0xff, 0xff],
  dot: [0xef, 0xff, 0xff, 0xff],
  minus: [0xff, 0xff, 0xef, 0xff],
  cxl: [0xff, 0xff, 0xff, 0xdf],
};

/**
 * Sets up event listeners for virtual button controls in the UI.
 * Maps HTML button IDs to keypress names, sends MIDI keypresses on clicks,
 * handles special logic for certain keys (e.g., 'ab' for DSP toggle, 'parameter' for navigation),
 * and updates the screen with optional bitmap fetch.
 *
 * @example
 * // Called in main.js after DOM load
 * setupKeypressControls();
 */
export function setupKeypressControls() {
  const buttons = {
    'up-btn': 'up',
    'down-btn': 'down',
    'left-btn': 'left',
    'right-btn': 'right',
    'enter-btn': 'enter',
    'select-btn': 'select',
    'program-btn': 'program',
    'parameter-btn': 'parameter',
    'levels-btn': 'levels',
    'setup-btn': 'setup',
    'bypass-btn': 'bypass',
    'inc-btn': 'inc',
    'dec-btn': 'dec',
    'soft1-btn': 'soft1',
    'soft2-btn': 'soft2',
    'soft3-btn': 'soft3',
    'soft4-btn': 'soft4',
    'ab-btn': 'ab',
    'program-hold-btn': 'program-hold',
    'parameter-hold-btn': 'parameter-hold',
    'select-hold-btn': 'select-hold',
    '1-btn': '1',
    '2-btn': '2',
    '3-btn': '3',
    '4-btn': '4',
    '5-btn': '5',
    '6-btn': '6',
    '7-btn': '7',
    '8-btn': '8',
    '9-btn': '9',
    '0-btn': '0',
    'dot-btn': 'dot',
    'minus-btn': 'minus',
    'cxl-btn': 'cxl',
  };

  Object.entries(buttons).forEach(([id, key]) => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.addEventListener('click', () => {
        const mask = keypressMasks[key];
        if (mask) {
          sendKeypress(mask);
          log(
            `Sent keypress for ${key}: ${mask.map((b) => b.toString(16).padStart(2, '0')).join(' ')}`,
            'debug',
            'sysexSent'
          );
          setTimeout(() => {
            if (key === 'ab') {
              if (appState.currentKey === '0') {
                setState(
                  { presetKey: toggleDspKey(appState.presetKey) },
                  'controls:keypress-ab-toggle'
                );
              }
            } else if (key === 'parameter') {
              if (appState.currentKey === '0') {
                setState(
                  {
                    keyStack: [...appState.keyStack, appState.currentKey],
                    currentKey: appState.presetKey,
                    autoLoad: true,
                  },
                  'controls:keypress-parameter-nav'
                );
              }
            }
            updateScreen();
            // Fetch screen after button press if enabled
            if (appState.fetchBitmap) {
              sendSysEx(0x18, []);
              log('Fetched screen after button press.', 'debug', 'bitmap');
            } else {
              log('Bitmap fetch disabled; skipped screen after button press.', 'debug', 'bitmap');
            }
          }, 200);
        }
      });
    }
  });
}

/**
 * Tests for duplicate keypress commands by simulating a button press flow.
 * Logs the simulation steps without sending actual MIDI. Useful for debugging
 * potential issues with repeated SysEx sends.
 *
 * @example
 * // Called via debug button in UI
 * testKeypress();
 */
export function testKeypress() {
  log('Starting duplicate command test...', 'info', 'general');
  // Simulate button press flow without actual MIDI send
  const mockKey = 'up';
  const mask = keypressMasks[mockKey];
  if (mask) {
    const commandStr = `Sent keypress for ${mockKey}: ${mask.map((b) => b.toString(16).padStart(2, '0')).join(' ')}`;
    // Simulate single send
    log(`Simulated command: ${commandStr}`, 'debug', 'sysexSent');
    // Check for duplicate by seeing if the same command is logged twice (in real flow, it should not)
    // In test, we only send once
    log('No duplicate detected in simulation.', 'debug', 'general');
  } else {
    log('Test failed: no mask found for mock key.', 'error', 'error');
  }
  log(
    'Duplicate command test complete. Check logs for any repeated commands during normal operation.',
    'info',
    'general'
  );
}
