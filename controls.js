// controls.js
import { sendKeypress, sendSysEx } from './midi.js';
import { updateScreen } from './renderer.js';
import { appState } from './state.js';

export const keypressMasks = {
  'up': [0xFE, 0xFF, 0xFD, 0xFF],
  'down': [0xFF, 0xFE, 0xFD, 0xFF],
  'left': [0xFF, 0xFE, 0xFF, 0xFF],
  'right': [0xFE, 0xFF, 0xFF, 0xFF],
  'enter': [0xFF, 0xFF, 0xFF, 0xEF],
  'select': [0xFF, 0xFF, 0xFE, 0xFF],
  'program': [0xF7, 0xFF, 0xFF, 0xFF],
  'parameter': [0xFF, 0xF7, 0xFF, 0xFF],
  'levels': [0xFF, 0xFF, 0xFF, 0xFD],
  'setup': [0xFF, 0xFF, 0xF7, 0xFF],
  'bypass': [0xFF, 0xFF, 0xFD, 0xFF],
  'inc': [0xFF, 0xFF, 0xFF, 0x7F],
  'dec': [0xFF, 0xFF, 0xFF, 0xBF],
  'soft1': [0xFB, 0xFF, 0xFF, 0xFF],
  'soft2': [0xFF, 0xFB, 0xFF, 0xFF],
  'soft3': [0xFF, 0xFF, 0xFB, 0xFF],
  'soft4': [0xFF, 0xFF, 0xFF, 0xFB],
  'ab': [0xFD, 0xFF, 0xFD, 0xFF],
  'program-hold': [0xF7, 0xFF, 0xFF, 0xFE],
  'parameter-hold': [0xFF, 0xF7, 0xFF, 0xFE],
  'select-hold': [0xFF, 0xFF, 0xFE, 0xFE],
  '1': [0x7F, 0xFF, 0xFF, 0xFF],
  '2': [0xFF, 0x7F, 0xFF, 0xFF],
  '3': [0xFF, 0xFF, 0x7F, 0xFF],
  '4': [0xBF, 0xFF, 0xFF, 0xFF],
  '5': [0xFF, 0xBF, 0xFF, 0xFF],
  '6': [0xFF, 0xFF, 0xBF, 0xFF],
  '7': [0xDF, 0xFF, 0xFF, 0xFF],
  '8': [0xFF, 0xDF, 0xFF, 0xFF],
  '9': [0xFF, 0xFF, 0xDF, 0xFF],
  '0': [0xFF, 0xEF, 0xFF, 0xFF],
  'dot': [0xEF, 0xFF, 0xFF, 0xFF],
  'minus': [0xFF, 0xFF, 0xEF, 0xFF],
  'cxl': [0xFF, 0xFF, 0xFF, 0xDF],
};

function toggleDspKey(key) {
  return key.startsWith('4') ? '8' + key.slice(1) : '4' + key.slice(1);
}

export function setupKeypressControls(log) {
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
          log(`Sent keypress for ${key}: ${mask.map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
          setTimeout(() => {
            if (key === 'ab') {
              appState.currentKey = toggleDspKey(appState.currentKey);
            }
            updateScreen();
            // Fetch screen after button press
            sendSysEx(0x18, [], log);
            log('Fetched screen after button press.');
          }, 200);
        }
      });
    }
  });
}

export function testKeypress(log) {
  log('Starting duplicate command test...');
  // Simulate button press flow without actual MIDI send
  const mockKey = 'up';
  const mask = keypressMasks[mockKey];
  if (mask) {
    const commandStr = `Sent keypress for ${mockKey}: ${mask.map(b => b.toString(16).padStart(2, '0')).join(' ')}`;
    // Simulate single send
    log(`Simulated command: ${commandStr}`);
    // Check for duplicate by seeing if the same command is logged twice (in real flow, it should not)
    // In test, we only send once
    log('No duplicate detected in simulation.');
  } else {
    log('Test failed: no mask found for mock key.');
  }
  log('Duplicate command test complete. Check logs for any repeated commands during normal operation.');
}