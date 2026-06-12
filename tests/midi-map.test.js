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
    'select-hold': ['select-hold'],
  },
}));

jest.mock('../src/tree.js', () => ({
  getNode: jest.fn(),
}));

jest.mock('../src/constants.js', () => {
  const actual = jest.requireActual('../src/constants.js');
  return {
    ...actual,
    MIDI_MAP: {
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
} from '../src/midi-map.js';
import { sendValuePut, sendObjectInfoDump, sendValueDump, sendKeypress } from '../src/midi.js';
import { getNode } from '../src/tree.js';
import { bindParam } from '../src/midi-map.js';

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
    expect(readAssign(0)).toEqual({
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
});

test('enableSequenceOut sets the setup toggle to new', () => {
  enableSequenceOut();
  expect(sendValuePut).toHaveBeenCalledWith('10010016', '2');
});

describe('bindParam (the one keypress step)', () => {
  test('drives program->parameter->DOWN x row->select-hold, then reads the surface', async () => {
    getNode.mockReturnValue([
      { key: '10030401', type: 'COL', statement: 't_delay setup' },
      { key: '10030402', value: '0 off' },
    ]);
    let result;
    await bindParam(1, (s) => (result = s)); // row 1 = second param
    expect(sendKeypress.mock.calls.map((c) => c[0])).toEqual([
      ['program'],
      ['parameter'],
      ['down'], // one DOWN for row index 1
      ['select-hold'],
    ]);
    // The surface is read back; its title is the binding proof.
    expect(result.title).toBe('t_delay setup');
    expect(sendObjectInfoDump).toHaveBeenCalledWith('10030401');
  });

  test('row 0 binds with no DOWN presses', async () => {
    getNode.mockReturnValue([{ key: '10030401', type: 'COL', statement: 'level setup' }]);
    await bindParam(0);
    expect(sendKeypress.mock.calls.map((c) => c[0])).toEqual([
      ['program'],
      ['parameter'],
      ['select-hold'],
    ]);
  });
});
