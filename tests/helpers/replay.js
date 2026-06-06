// Offline replay harness (roadmap future-work: HIL screenshot regression substrate).
//
// Drives the REAL parse -> events -> event-bridge -> renderer pipeline from
// recorded SysEx fixtures, with no MIDI device. It lets tests (and an
// operator debugging offline) replay a captured device response and assert
// on the rendered LCD HTML and the decoded screen framebuffer.
//
// Requirements for the importing test file (jest.mock is hoisted there, not
// here, so it applies across the real module graph this helper pulls in):
//   jest.mock('../src/main.js', () => ({ showLoading: jest.fn(), hideLoading: jest.fn() }));
//   jest.mock('../src/logger.js', () => ({ log: jest.fn() }));
//   jest.mock('lodash.debounce', () => (fn) => fn); // make the bridge's debounce synchronous
//
// renderer.js imports showLoading from main.js (top-level DOM/MIDI wiring),
// so main.js must be mocked. The bridge still emits render:request from a
// 200ms setTimeout, so the test advances fake timers to flush a render.

import { parseResponse } from '../../src/parser.js';
import { registerEventBridge } from '../../src/event-bridge.js';
import { setMidiPorts } from '../../src/midi.js';
import { appState } from '../../src/state.js';

// jsdom has no 2D canvas context. Attach a minimal backing-store stub so the
// real renderBitmap runs headless; we read the green channel back out as ASCII.
function attachFakeCanvas2d(canvas) {
  let store = { width: 0, height: 0, data: new Uint8ClampedArray(0) };
  canvas.getContext = () => ({
    getImageData: (x, y, w, h) => {
      if (store.width !== w || store.height !== h) {
        store = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
      }
      return store;
    },
    putImageData: (img) => {
      store = img;
    },
  });
  return () => store;
}

export function createReplayHarness({ deviceId = 0, hideLoading = () => {} } = {}) {
  document.body.innerHTML = '<div id="lcd"></div><canvas id="lcd-canvas"></canvas>';
  const readStore = attachFakeCanvas2d(document.getElementById('lcd-canvas'));

  // Fake MIDI output so parser/renderer sends do not error; record raw frames.
  const sent = [];
  const output = { sendSysex: (mfr, data) => sent.push([...mfr, ...data]) };
  setMidiPorts(output, { addListener: () => {} }, deviceId);
  // deviceId 0 lets parseResponse adopt the fixture's device id from data[3].

  const teardown = registerEventBridge({ hideLoading });

  return {
    sent,
    feed(bytes) {
      parseResponse(bytes);
    },
    setCurrentKey(key) {
      appState.currentKey = key;
    },
    lcdHtml() {
      return document.getElementById('lcd').innerHTML;
    },
    lcdText() {
      return document.getElementById('lcd').textContent;
    },
    // Decodes the rendered framebuffer (green channel) to an ASCII grid:
    // '#' for a lit pixel, ' ' otherwise. Trailing blanks trimmed per row.
    screenAscii() {
      const { width, height, data } = readStore();
      if (!width) return '';
      const rows = [];
      for (let y = 0; y < height; y++) {
        let row = '';
        for (let x = 0; x < width; x++) {
          row += data[(y * width + x) * 4 + 1] > 0 ? '#' : ' ';
        }
        rows.push(row.replace(/\s+$/, ''));
      }
      return rows.join('\n').replace(/\n+$/, '');
    },
    teardown,
  };
}
