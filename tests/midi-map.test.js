// tests/midi-map.test.js
// Device-native MIDI mapping (#146): the clean VALUE_PUT/OBJECTINFO operations
// on the global assigns and the per-parameter modulation surface. Pins the key
// math, the source table, and that config is plain object writes (no keypress).

jest.mock('../src/midi.js', () => ({
  sendValuePut: jest.fn(),
  sendObjectInfoDump: jest.fn(),
  sendValueDump: jest.fn(),
  sendKeypress: jest.fn(),
}));

jest.mock('../src/controls.js', () => ({
  keypressMasks: {
    program: ['program'],
    parameter: ['parameter'],
    down: ['down'],
    right: ['right'],
    'select-hold': ['select-hold'],
    soft1: ['soft1'],
    soft2: ['soft2'],
    soft3: ['soft3'],
    soft4: ['soft4'],
  },
}));

jest.mock('../src/tree.js', () => ({
  getNode: jest.fn(),
  parentOf: jest.fn(),
}));

jest.mock('../src/constants.js', () => {
  const actual = jest.requireActual('../src/constants.js');
  return {
    ...actual,
    MIDI_MAP: {
      ...actual.MIDI_MAP, // keep the real grid geometry (GRID_ROWS/COLS, BLOCK_SOFTKEYS)
      CAPTURE_SETTLE_MS: 1,
      UI_REFRESH_MS: 1,
      BIND_STEP_MS: 1,
      BIND_SETTLE_MS: 1,
      BIND_READ_TRIES: 4,
      LEARN_POLL_TRIES: 3,
    },
  };
});

import {
  childKey,
  sourceName,
  sourceIndex,
  sourceOptions,
  enableSequenceOut,
  assignSlot,
  readAssign,
  refreshAssign,
  captureAssign,
  clearAssign,
  setParamSource,
  setParamRange,
  setParamType,
  captureParam,
  readParamSetup,
  rangeForSpan,
  recordParamMapping,
  paramMappingOf,
  resetParamMappings,
} from '../src/midi-map.js';
import { sendValuePut, sendObjectInfoDump, sendValueDump, sendKeypress } from '../src/midi.js';
import { getNode, parentOf } from '../src/tree.js';
import { bindParam, paramCoords } from '../src/midi-map.js';
import { emit } from '../src/events.js';
import { appState } from '../src/state.js';

beforeEach(() => jest.clearAllMocks());

describe('source table + key math', () => {
  test('childKey does hex addition on the base', () => {
    expect(childKey('10010110', 1)).toBe('10010111');
    expect(childKey('10010110', 5)).toBe('10010115');
    expect(childKey('100101a0', 5)).toBe('100101a5'); // carries within the nibble
  });

  test('sourceName / sourceIndex map the documented list', () => {
    expect(sourceName(0)).toBe('off');
    expect(sourceName(4)).toBe('assign 1');
    expect(sourceName(30)).toBe('volume'); // CC7
    expect(sourceIndex('volume')).toBe(30);
    expect(sourceIndex('assign 3')).toBe(6);
  });

  test('sourceOptions yields { index, name } pairs', () => {
    const opts = sourceOptions();
    expect(opts[0]).toEqual({ index: 0, name: 'off' });
    expect(opts.find((o) => o.name === 'pan')).toEqual({ index: 32, name: 'pan' });
  });

  test('rangeForSpan rounds the desired delta', () => {
    expect(rangeForSpan(12.4)).toBe(12);
  });
});

describe('global assign controllers', () => {
  test('assignSlot computes the non-contiguous slot keys', () => {
    expect(assignSlot(0)).toMatchObject({
      base: '10010110',
      mode: '10010111',
      channel: '10010112',
      monitor: '10010114',
      capture: '10010115',
    });
    // slot 5 base is 10010180 (the bases are not contiguous)
    expect(assignSlot(5).base).toBe('10010180');
    expect(assignSlot(5).capture).toBe('10010185');
  });

  test('readAssign pulls source/channel/monitor from the tree', () => {
    getNode.mockReturnValue([
      { key: '10010110', type: 'COL', statement: 'assign 1 setup' },
      { key: '10010111', value: '1e volume' },
      { key: '10010112', value: '0 base + 0' },
      { key: '10010114', value: '62.5' },
    ]);
    expect(readAssign(0)).toMatchObject({
      index: 0,
      source: 'volume',
      channel: '0 base + 0',
      monitor: '62.5',
    });
  });

  test('captureAssign arms the slot Capture TRG; clearAssign sets mode off', async () => {
    await captureAssign(2, () => {});
    expect(sendValuePut).toHaveBeenCalledWith('10010135', '1'); // assign 3 capture
    clearAssign(2);
    expect(sendValuePut).toHaveBeenCalledWith('10010131', '0'); // assign 3 mode off
  });

  test('refreshAssign re-fetches the slot subtree', () => {
    refreshAssign(0);
    expect(sendObjectInfoDump).toHaveBeenCalledWith('10010110');
    expect(sendValueDump).toHaveBeenCalledWith('10010110');
  });
});

describe('per-parameter modulation (bound surface)', () => {
  test('source/range/type are plain VALUE_PUTs to the fixed surface keys', () => {
    setParamSource(30); // volume / CC7
    setParamRange(100);
    setParamType(2); // bipolar
    expect(sendValuePut.mock.calls).toEqual([
      ['10030402', '30'],
      ['10030408', '100'],
      ['10030409', '2'],
    ]);
  });

  test('captureParam arms the surface Capture TRG', async () => {
    await captureParam(() => {});
    expect(sendValuePut).toHaveBeenCalledWith('10030406', '1');
  });

  test('readParamSetup reflects the bound param (title proves the binding)', () => {
    getNode.mockReturnValue([
      { key: '10030401', type: 'COL', statement: 't_delay setup' },
      { key: '10030402', value: '4 assign 1' },
      { key: '10030408', value: '100' },
      { key: '10030409', value: '0 absolute' },
      { key: '10030405', value: '50.0' },
    ]);
    expect(readParamSetup()).toMatchObject({
      title: 't_delay setup',
      source: 'assign 1',
      range: '100',
      type: '0 absolute',
      monitor: '50.0',
    });
  });

  test('readParamSetup surfaces the bound parameter span + unit (range context)', () => {
    getNode.mockReturnValue([
      { key: '10030401', type: 'COL', statement: 'level setup' },
      { key: '10030402', value: '0 off' },
      // the range NUM itself — must NOT be mistaken for the value mirror
      {
        key: '10030408',
        type: 'NUM',
        statement: 'range: +%4.0f dB',
        value: '200',
        min: '-32767',
        max: '32767',
      },
      // the bound parameter's value mirror: its unit + full span live here
      {
        key: '50001',
        type: 'NUM',
        statement: 'level : %4.0f dB',
        value: '-12',
        min: '-100',
        max: '0',
      },
    ]);
    expect(readParamSetup().param).toEqual({ unit: 'dB', min: -100, max: 0, span: 100 });
  });

  test('readParamSetup collapses the printf %% escape to a single % unit', () => {
    getNode.mockReturnValue([
      { key: '10030401', type: 'COL', statement: 'size setup' },
      {
        key: '10030408',
        type: 'NUM',
        statement: 'range: +%4.0f %%',
        value: '50',
        min: '-100',
        max: '100',
      },
      {
        key: '50001',
        type: 'NUM',
        statement: 'size/decay: %3.0f %%',
        value: '70',
        min: '0',
        max: '100',
      },
    ]);
    expect(readParamSetup().param).toEqual({ unit: '%', min: 0, max: 100, span: 100 });
  });
});

test('enableSequenceOut sets the setup toggle to new', () => {
  enableSequenceOut();
  expect(sendValuePut).toHaveBeenCalledWith('10010016', '2');
});

describe('param mapping state (the LCD "mapped" badge, #146)', () => {
  beforeEach(() => {
    appState.dspAName = '';
    appState.dspBName = '';
    resetParamMappings();
  });

  test('record / read / off-clears / reset', () => {
    expect(paramMappingOf('4050001')).toBeNull();
    recordParamMapping('4050001', 'pan');
    expect(paramMappingOf('4050001')).toBe('pan');
    recordParamMapping('4050001', 'off'); // off (or empty) un-marks it
    expect(paramMappingOf('4050001')).toBeNull();
    recordParamMapping('4060001', 'volume');
    resetParamMappings();
    expect(paramMappingOf('4060001')).toBeNull();
  });

  test('scoped by program: a slot program change hides the old badge, each sticks', () => {
    appState.dspAName = 'MonoDelay';
    recordParamMapping('4050001', 'pan');
    expect(paramMappingOf('4050001')).toBe('pan');
    // a different program in the same slot -> its own set; no stale 'pan'
    appState.dspAName = '1x4 Delay';
    expect(paramMappingOf('4050001')).toBeNull();
    // back to the mapped program -> the badge returns (stuck through the switch)
    appState.dspAName = 'MonoDelay';
    expect(paramMappingOf('4050001')).toBe('pan');
  });

  test('persists to midiConfig so a reload restores it', () => {
    recordParamMapping('4050001', 'pan'); // dspAName '' -> slot fallback '4'
    const stored = JSON.parse(localStorage.getItem('midiConfig')).midiMappings;
    expect(stored['4']['4050001']).toBe('pan');
  });

  test('a program:loaded event no longer clears the badges (program-scoped + persisted)', () => {
    recordParamMapping('4050001', 'pan');
    emit('program:loaded', { dspSlot: 'A' });
    expect(paramMappingOf('4050001')).toBe('pan'); // sticks through the load
  });
});

test('readParamSetup surfaces the con# (CC number) for MIDI single/double', () => {
  getNode.mockReturnValue([
    { key: '10030401', type: 'COL', statement: 'level setup' },
    { key: '10030402', value: '1f midi double' },
    { key: '10030403', statement: 'channel: %-11s', tag: 'channel', value: '0 base + 0' },
    { key: '10030404', statement: 'con: %2.0f', tag: 'con', value: '42' },
  ]);
  const s = readParamSetup();
  expect(s.source).toBe('midi double');
  // the channel + the actual CC number, presentable.
  expect(s.details).toEqual([
    { label: 'channel', value: 'base + 0' },
    { label: 'con', value: '42' },
  ]);
});

describe('bindParam (generic block + grid navigation)', () => {
  // A program (preset PRE) with three blocks; reverb is block index 2 -> soft3.
  const PRE = '401000b';
  const REVERB = '41e0001';
  const presetNode = [
    { key: PRE, type: 'COL', parent: '0', statement: 'Horrors' },
    { key: '4040001', type: 'COL', parent: PRE, statement: 'pitch params' },
    { key: '40f0001', type: 'COL', parent: PRE, statement: 'chorus params' },
    { key: REVERB, type: 'COL', parent: PRE, statement: 'reverb params' },
  ];
  // reverb block: header (parent = preset) + 9 params, lowfreq at dump index 8.
  const reverbNode = [
    { key: REVERB, type: 'COL', parent: PRE, statement: 'reverb params' },
    { key: '42e0001', type: 'NUM' }, // 0 level
    { key: '41f0001', type: 'SET' }, // 1 t_rdecay
    { key: '4220001', type: 'NUM' }, // 2 rdecay
    { key: '42c0001', type: 'NUM' }, // 3 rsize
    { key: '4270001', type: 'NUM' }, // 4 predly
    { key: '4280001', type: 'NUM' }, // 5 hicut
    { key: '4290001', type: 'NUM' }, // 6 lowcut
    { key: '42a0001', type: 'NUM' }, // 7 hifreq
    { key: '42b0001', type: 'NUM' }, // 8 lowfreq
  ];
  const surface = (title) => [{ key: '10030401', type: 'COL', statement: title }];

  function mockTree(preset, surfaceTitle) {
    getNode.mockImplementation((k) => {
      if (k === PRE) return preset;
      if (k === REVERB) return reverbNode;
      if (k === '10030401') return surface(surfaceTitle);
      return null;
    });
    // The block's true parent (preset) comes from the tree's child->parent map.
    parentOf.mockImplementation((k) => (k === REVERB ? PRE : undefined));
  }

  test('paramCoords derives block index (softkey) + dump index from the tree', () => {
    mockTree(presetNode, 'lowfreq setup');
    expect(paramCoords(REVERB, '42b0001')).toEqual({ blockIndex: 2, paramIndex: 8 });
    expect(paramCoords(REVERB, '42e0001')).toEqual({ blockIndex: 2, paramIndex: 0 });
  });

  test('lowfreq (block 2, idx 8 = page 1 top-left) binds via soft3 x2, no RIGHT/DOWN', async () => {
    mockTree(presetNode, 'lowfreq setup');
    let result;
    await bindParam(REVERB, '42b0001', (s) => (result = s));
    expect(sendKeypress.mock.calls.map((c) => c[0])).toEqual([
      ['program'],
      ['parameter'],
      ['soft3'], // select reverb (page 0)
      ['soft3'], // page to page 1
      ['select-hold'],
    ]);
    expect(result.title).toBe('lowfreq setup');
    expect(sendObjectInfoDump).toHaveBeenCalledWith('10030401');
  });

  test('a page-0 grid cell (idx 5 = col 1 row 1) uses RIGHT then DOWN', async () => {
    mockTree(presetNode, 'hicut setup');
    await bindParam(REVERB, '4280001'); // idx 5
    expect(sendKeypress.mock.calls.map((c) => c[0])).toEqual([
      ['program'],
      ['parameter'],
      ['soft3'], // select reverb (page 0)
      ['right'], // col 1
      ['down'], // row 1
      ['select-hold'],
    ]);
  });

  test('a block past the 4 softkeys reports unreachable and sends no keypress', async () => {
    const sixBlocks = [
      presetNode[0],
      { key: 'b0', type: 'COL', parent: PRE },
      { key: 'b1', type: 'COL', parent: PRE },
      { key: 'b2', type: 'COL', parent: PRE },
      { key: 'b3', type: 'COL', parent: PRE },
      { key: REVERB, type: 'COL', parent: PRE }, // index 4 -> soft5, unreachable
    ];
    mockTree(sixBlocks, 'x');
    let result;
    await bindParam(REVERB, '42b0001', (s) => (result = s));
    expect(result.unreachable).toBe(true);
    expect(sendKeypress).not.toHaveBeenCalled();
  });
});
