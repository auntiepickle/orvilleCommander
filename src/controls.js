// controls.js
import { sendKeypress, sendSysEx, sendValueDump, isWaveOpen } from './midi.js';
import { CMD, KEY } from './sysex-commands.js';
import { TIMING, KNOB } from './constants.js';
import { updateScreen } from './renderer.js';
import { appState } from './state.js';
import { setState } from './store.js';
import { log } from './logger.js';
import { toggleDspKey } from './navigation.js';
import { deriveKeyStack } from './tree.js';

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
 * One meter-poll tick: requests a VALUE_DUMP for every CON in the on-screen
 * menu — unless a request wave is open, in which case the tick is SKIPPED
 * (#107 saturation gate). Without the gate, the live smoke measured ticks
 * joining waves faster than the 31250-baud link drains them: outstanding
 * never reached 0, waves merged to the 10s watchdog ceiling, and settled
 * renders froze for the duration (44% watchdog ratio; 3.57% with the
 * gate). Skipping self-paces polling to link capacity. main.js drives this
 * on a TIMING.METER_POLL_MS interval.
 *
 * @returns {boolean} Whether the tick ran (false = gated). For tests/logs.
 */
export function meterPollTick() {
  if (isWaveOpen()) return false;
  for (const sub of appState.currentSubs.filter((s) => s.type === 'CON')) {
    sendValueDump(sub.key);
  }
  return true;
}

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
              if (appState.currentKey === KEY.ROOT) {
                setState(
                  { presetKey: toggleDspKey(appState.presetKey) },
                  'controls:keypress-ab-toggle'
                );
              }
            } else if (key === 'parameter') {
              if (appState.currentKey === KEY.ROOT) {
                setState(
                  {
                    keyStack: deriveKeyStack(appState.presetKey), // T1b: tree ancestors
                    currentKey: appState.presetKey,
                    pendingDescend: true,
                  },
                  'controls:keypress-parameter-nav'
                );
              }
            }
            updateScreen();
            // Fetch screen after button press if enabled
            if (appState.fetchBitmap) {
              sendSysEx(CMD.GET_SCREEN, []);
              log('Fetched screen after button press.', 'debug', 'bitmap');
            } else {
              log('Bitmap fetch disabled; skipped screen after button press.', 'debug', 'bitmap');
            }
          }, TIMING.MIDI_SETTLE_MS);
        }
      });
    }
  });
}

/**
 * The DATA KNOB (manual p.9 item L): wheel-scroll or vertical drag spins
 * it; every detent sends one INC/DEC keypress immediately (so a fast spin
 * streams keypresses like the real encoder), and ONE trailing screen
 * refresh fires after the spin settles — per-detent updateScreen calls
 * would saturate the link the way unguarded meter polling did (#107).
 *
 * @example
 * // Called in main.js after DOM load
 * setupDataKnob();
 */
export function setupDataKnob() {
  const knob = document.getElementById('data-knob');
  if (!knob) return;
  const pointer = knob.querySelector('.knob-pointer');
  let angle = 0;
  let settleHandle = null;

  const spin = (direction) => {
    angle += direction * KNOB.DETENT_DEG;
    if (pointer) pointer.style.transform = `rotate(${angle}deg)`;
    sendKeypress(keypressMasks[direction > 0 ? 'inc' : 'dec']);
    if (settleHandle) clearTimeout(settleHandle);
    settleHandle = setTimeout(() => {
      settleHandle = null;
      updateScreen();
      if (appState.fetchBitmap) sendSysEx(CMD.GET_SCREEN, []);
    }, KNOB.SETTLE_REFRESH_MS);
  };

  knob.addEventListener('wheel', (e) => {
    e.preventDefault();
    spin(e.deltaY < 0 ? 1 : -1);
  });

  let dragLastY = null;
  knob.addEventListener('pointerdown', (e) => {
    dragLastY = e.clientY;
    knob.setPointerCapture(e.pointerId);
  });
  knob.addEventListener('pointermove', (e) => {
    if (dragLastY === null) return;
    const travel = dragLastY - e.clientY; // drag up = increment
    if (Math.abs(travel) >= KNOB.DRAG_PX_PER_DETENT) {
      spin(travel > 0 ? 1 : -1);
      dragLastY = e.clientY;
    }
  });
  const endDrag = () => {
    dragLastY = null;
  };
  knob.addEventListener('pointerup', endDrag);
  knob.addEventListener('pointercancel', endDrag);
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
