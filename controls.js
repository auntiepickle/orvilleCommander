// controls.js
import { sendKeypress } from './midi.js';
import { updateScreen } from './renderer.js';

export const keypressMasks = {
  up: [0xFE, 0xFF, 0xFD, 0xFF],
  down: [0xFF, 0xFE, 0xFD, 0xFF],
  left: [0xFF, 0xFE, 0xFF, 0xFF],
  right: [0xFE, 0xFF, 0xFF, 0xFF],
  enter: [0xFF, 0xFF, 0xFF, 0xEF],
  select: [0xFF, 0xFF, 0xFE, 0xFF],
  program: [0xF7, 0xFF, 0xFF, 0xFF],
  parameter: [0xFF, 0xF7, 0xFF, 0xFF],
  levels: [0xFF, 0xFF, 0xFF, 0xFD],
  setup: [0xFF, 0xFF, 0xF7, 0xFF],
  bypass: [0xFF, 0xFF, 0xFD, 0xFF],
  inc: [0xFF, 0xFF, 0xFF, 0x7F],
  dec: [0xFF, 0xFF, 0xFF, 0xBF],
  soft1: [0xFB, 0xFF, 0xFF, 0xFF],
  soft2: [0xFF, 0xFB, 0xFF, 0xFF],
  soft3: [0xFF, 0xFF, 0xFB, 0xFF],
  soft4: [0xFF, 0xFF, 0xFF, 0xFB],
};

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
  };

  Object.entries(buttons).forEach(([id, key]) => {
    document.getElementById(id).addEventListener('click', () => {
      const mask = keypressMasks[key];
      if (mask) {
        sendKeypress(mask);
        log(`Sent keypress for ${key}: ${mask.map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
        setTimeout(updateScreen, 200);
      }
    });
  });
}

export function testKeypress(log) {
  log('Starting keypress test...');
  const tests = Object.entries(keypressMasks);
  tests.forEach(([key, mask], index) => {
    setTimeout(() => {
      sendKeypress(mask);
      log(`Tested ${key} mask: ${mask.map(b => b.toString(16).padStart(2, '0')).join(' ')} - observe hardware response and log any errors`);
      setTimeout(updateScreen, 200);
    }, index * 500);
  });
}