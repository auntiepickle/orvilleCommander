// tests/midi-map-ui.test.js
// The MIDI-mapping UI (#146): the controllers panel + per-parameter card.
// Device I/O is mocked at the midi-map.js boundary — this pins the modal
// rendering and that edits route to clean object writes (no keypress beyond
// the bind).

jest.mock('../src/midi-map.js', () => ({
  enableSequenceOut: jest.fn(),
  readAssign: jest.fn((i) => ({ index: i, source: i === 0 ? 'volume' : 'off', monitor: '50' })),
  refreshAssign: jest.fn(),
  captureAssign: jest.fn((i, onDone) => onDone?.()),
  clearAssign: jest.fn(),
  bindParam: jest.fn((row, onDone) =>
    onDone?.({
      title: 'level setup',
      source: 'off',
      range: '100',
      type: '0 absolute',
      monitor: '0',
    })
  ),
  readParamSetup: jest.fn(() => ({
    title: 'level setup',
    source: 'off',
    range: '100',
    type: '0 absolute',
    monitor: '0',
  })),
  refreshParamSetup: jest.fn(),
  setParamSource: jest.fn(),
  setParamRange: jest.fn(),
  setParamType: jest.fn(),
  captureParam: jest.fn((onDone) => onDone?.()),
  sourceOptions: jest.fn(() => [
    { index: 0, name: 'off' },
    { index: 30, name: 'volume' },
  ]),
  rangeForSpan: jest.fn((d) => Math.round(d)),
  recordParamMapping: jest.fn(),
  resetParamMappings: jest.fn(),
}));

import {
  setupMidiMapUI,
  openControllers,
  closeControllers,
  openParamMapping,
  resetMidiMapUI,
} from '../src/midi-map-ui.js';
import {
  enableSequenceOut,
  captureAssign,
  clearAssign,
  bindParam,
  setParamSource,
  setParamRange,
  captureParam,
} from '../src/midi-map.js';

import { MIDI_MAP } from '../src/constants.js';

const q = (sel) => document.querySelector(sel);
const qa = (sel) => [...document.querySelectorAll(sel)];

describe('midi-map-ui', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers(); // the Learn poll + repaint use setTimeout
    document.body.innerHTML = '';
    resetMidiMapUI();
    setupMidiMapUI({ onChange: jest.fn() });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('controllers panel', () => {
    test('renders 8 assign rows and turns on sequence-out', () => {
      openControllers();
      expect(enableSequenceOut).toHaveBeenCalled();
      expect(qa('.mm-row')).toHaveLength(8);
      // assign 1 shows its captured source.
      expect(q('.mm-row .mm-row-src').textContent).toBe('volume');
    });

    test('Learn arms Capture and shows the "move your controller" prompt', () => {
      openControllers();
      q('.mm-row .mm-learn').click();
      expect(captureAssign).toHaveBeenCalledWith(0, expect.any(Function));
      expect(q('.mm-learn-overlay')).toBeTruthy();
      expect(q('.mm-learn-msg').textContent).toMatch(/move your controller/i);
      // Cancel dismisses the prompt.
      q('.mm-learn-overlay .mm-learn').click();
      expect(q('.mm-learn-overlay')).toBeNull();
    });

    test('Learn polls the device and shows the captured source (live feedback)', () => {
      openControllers(); // mock readAssign(0).source === 'volume'
      q('.mm-row .mm-learn').click();
      expect(q('.mm-learn-msg').textContent).toMatch(/move your controller/i);
      // One poll cycle later, the device reports a captured source.
      jest.advanceTimersByTime(MIDI_MAP.UI_REFRESH_MS + 20);
      expect(q('.mm-learn-msg').textContent).toMatch(/captured: volume/i);
      // and the button becomes Done.
      expect(q('.mm-learn-overlay .mm-learn').textContent).toBe('Done');
    });

    test('clear clears the assign source', () => {
      openControllers();
      const clearBtn = qa('.mm-row .mm-btn').find((b) => b.textContent === 'clear');
      clearBtn.click();
      expect(clearAssign).toHaveBeenCalledWith(0);
    });

    test('close hides the panel', () => {
      openControllers();
      closeControllers();
      expect(q('.mm-modal').hidden).toBe(true);
    });
  });

  describe('per-parameter card', () => {
    test('binds the surface then renders source / range / type from the bound setup', () => {
      openParamMapping({ name: 'level  : %4.0f dB', rowIndex: 0 });
      expect(bindParam).toHaveBeenCalledWith(0, expect.any(Function));
      // The card shows the editable fields (bind succeeded — title matched).
      expect(q('.mm-card')).toBeTruthy();
      expect(qa('.mm-field')).toHaveLength(4); // source, range, type, monitor
      expect(q('.mm-title').textContent).toContain('LEVEL');
    });

    test('changing the source writes it by index (clean object PUT)', () => {
      openParamMapping({ name: 'level  : %4.0f dB', rowIndex: 0 });
      const sourceSel = q('.mm-card-body select');
      sourceSel.value = '30'; // volume / CC7
      sourceSel.dispatchEvent(new Event('change', { bubbles: true }));
      expect(setParamSource).toHaveBeenCalledWith(30);
    });

    test('changing the range writes it', () => {
      openParamMapping({ name: 'level  : %4.0f dB', rowIndex: 0 });
      const range = q('.mm-card-body input[type="number"]');
      range.value = '50';
      range.dispatchEvent(new Event('change', { bubbles: true }));
      expect(setParamRange).toHaveBeenCalledWith('50');
    });

    test('Learn on the card arms Capture for the bound param', () => {
      openParamMapping({ name: 'level  : %4.0f dB', rowIndex: 0 });
      q('.mm-card-foot .mm-learn').click();
      expect(captureParam).toHaveBeenCalled();
    });

    test('a bind whose title does NOT match the param aborts with an error (no mis-write)', () => {
      bindParam.mockImplementationOnce((row, onDone) => onDone({ title: 'something else' }));
      openParamMapping({ name: 'level  : %4.0f dB', rowIndex: 0 });
      // No editable fields; an error + Close instead.
      expect(qa('.mm-field')).toHaveLength(0);
      expect(q('.mm-card .mm-note').textContent).toMatch(/could not bind/i);
    });
  });

  test('resetMidiMapUI removes both modals', () => {
    openControllers();
    openParamMapping({ name: 'level  : %4.0f dB', rowIndex: 0 });
    expect(qa('.mm-modal').length).toBeGreaterThan(0);
    resetMidiMapUI();
    expect(qa('.mm-modal')).toHaveLength(0);
  });
});
