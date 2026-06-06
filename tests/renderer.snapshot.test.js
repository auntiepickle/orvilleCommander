// Golden-snapshot tests for renderScreen. This is the regression gate the
// roadmap names for Step 7 (originally promised by Step 4; never landed).
// Pins lcd outerHTML for three representative render branches so the
// upcoming parser <-> renderer cut can be verified to preserve output.

import { renderScreen } from '../src/renderer.js';
import { appState } from '../src/state.js';
import { sendObjectInfoDump, sendValueDump, sendValuePut, sendSysEx } from '../src/midi.js';
import { showLoading } from '../src/main.js';
import { log as mockLog } from '../src/logger.js';

jest.mock('../src/midi.js', () => ({
  sendObjectInfoDump: jest.fn(),
  sendValueDump: jest.fn(),
  sendValuePut: jest.fn(),
  sendSysEx: jest.fn(),
}));

jest.mock('../src/controls.js', () => ({
  keypressMasks: { enter: [0xff, 0xff, 0xff, 0xef] },
}));

jest.mock('../src/main.js', () => ({
  showLoading: jest.fn(),
}));

jest.mock('../src/logger.js', () => ({
  log: jest.fn(),
}));

describe('renderScreen golden snapshots', () => {
  let consoleLogSpy;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    appState.currentSubs = [];
    appState.currentValues = {};
    appState.childSubs = {};
    appState.keyStack = [];
    appState.currentKey = '0';
    appState.presetKey = '401000b';
    appState.dspAKey = '401000b';
    appState.dspBKey = '801000b';
    appState.dspAName = '';
    appState.dspBName = '';
    appState.autoLoad = false;
    appState.isLoadingPreset = false;
    appState.paramOffset = 0;
    appState.lastAscii = '';
    appState.updateBitmapOnChange = true;
    appState.currentSoftkeys = [];

    mockLog.mockClear();
    sendObjectInfoDump.mockClear();
    sendValueDump.mockClear();
    sendValuePut.mockClear();
    sendSysEx.mockClear();
    showLoading.mockClear();
    consoleLogSpy.mockClear();

    document.body.innerHTML = '<div id="lcd"></div>';
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  test('root menu (currentKey=0) with DSP tab line and root softkey grid', () => {
    appState.currentKey = '0';
    appState.dspAName = 'Reverb';
    appState.dspBName = 'Delay';
    appState.presetKey = '401000b';
    appState.keyStack = [];

    const subs = [
      {
        type: 'COL',
        position: '0',
        key: '0',
        parent: '',
        statement: 'Root',
        tag: 'root',
        value: '',
        min: '',
        max: '',
        step: '',
        options: [],
      },
      {
        type: 'COL',
        position: '1',
        key: '10020000',
        parent: '0',
        statement: 'Program',
        tag: 'program',
        value: '',
        min: '',
        max: '',
        step: '',
        options: [],
      },
      {
        type: 'COL',
        position: '2',
        key: '10010000',
        parent: '0',
        statement: 'Setup',
        tag: 'setup',
        value: '',
        min: '',
        max: '',
        step: '',
        options: [],
      },
      {
        type: 'COL',
        position: '3',
        key: '10030000',
        parent: '0',
        statement: 'Levels',
        tag: 'levels',
        value: '',
        min: '',
        max: '',
        step: '',
        options: [],
      },
      {
        type: 'COL',
        position: '4',
        key: '10030500',
        parent: '0',
        statement: 'Bypass',
        tag: 'bypass',
        value: '',
        min: '',
        max: '',
        step: '',
        options: [],
      },
    ];

    renderScreen(subs, '', mockLog);
    expect(document.getElementById('lcd').outerHTML).toMatchSnapshot();
  });

  test('leaf menu with NUM + SET + TRG params and keyStack depth 1', () => {
    appState.currentKey = '10010001';
    appState.keyStack = [
      {
        key: '10010000',
        tag: 'setup',
        subs: [
          {
            type: 'COL',
            position: '0',
            key: '10010000',
            parent: '0',
            statement: 'Setup',
            tag: 'setup',
            value: '',
            min: '',
            max: '',
            step: '',
            options: [],
          },
          {
            type: 'COL',
            position: '1',
            key: '10010001',
            parent: '10010000',
            statement: 'Input',
            tag: 'input',
            value: '',
            min: '',
            max: '',
            step: '',
            options: [],
          },
          {
            type: 'COL',
            position: '2',
            key: '10010002',
            parent: '10010000',
            statement: 'Output',
            tag: 'output',
            value: '',
            min: '',
            max: '',
            step: '',
            options: [],
          },
          {
            type: 'COL',
            position: '3',
            key: '10010003',
            parent: '10010000',
            statement: 'Midi',
            tag: 'midi',
            value: '',
            min: '',
            max: '',
            step: '',
            options: [],
          },
        ],
      },
    ];

    const subs = [
      {
        type: 'COL',
        position: '0',
        key: '10010001',
        parent: '10010000',
        statement: 'Input',
        tag: 'input',
        value: '',
        min: '',
        max: '',
        step: '',
        options: [],
      },
      {
        type: 'NUM',
        position: '1',
        key: '10010011',
        parent: '10010001',
        statement: 'Param %3.1f',
        tag: 'Prm',
        value: '50',
        min: '0',
        max: '100',
        step: '1',
        options: [],
      },
      {
        type: 'SET',
        position: '2',
        key: '10010012',
        parent: '10010001',
        statement: 'Mode %-10s',
        tag: 'mode',
        value: '1 manual',
        min: '',
        max: '',
        step: '',
        options: [
          { index: '0', desc: 'auto' },
          { index: '1', desc: 'manual' },
        ],
      },
      {
        type: 'TRG',
        position: '3',
        key: '10010013',
        parent: '10010001',
        statement: 'Reset',
        tag: 'rst',
        value: '',
        min: '',
        max: '',
        step: '',
        options: [],
      },
    ];

    renderScreen(subs, '', mockLog);
    expect(document.getElementById('lcd').outerHTML).toMatchSnapshot();
  });

  test('leaf menu with CON meter subs (bar rendering branch)', () => {
    appState.currentKey = '10030001';
    appState.keyStack = [
      {
        key: '10030000',
        tag: 'levels',
        subs: [
          {
            type: 'COL',
            position: '0',
            key: '10030000',
            parent: '0',
            statement: 'Levels',
            tag: 'levels',
            value: '',
            min: '',
            max: '',
            step: '',
            options: [],
          },
          {
            type: 'COL',
            position: '1',
            key: '10030001',
            parent: '10030000',
            statement: 'Meters',
            tag: 'meters',
            value: '',
            min: '',
            max: '',
            step: '',
            options: [],
          },
        ],
      },
    ];

    const subs = [
      {
        type: 'COL',
        position: '0',
        key: '10030001',
        parent: '10030000',
        statement: 'Meters',
        tag: 'meters',
        value: '',
        min: '',
        max: '',
        step: '',
        options: [],
      },
      {
        type: 'CON',
        position: '1',
        key: '10030011',
        parent: '10030001',
        statement: '',
        tag: 'L',
        value: '0.5',
        min: '',
        max: '',
        step: '',
        options: [],
      },
      {
        type: 'CON',
        position: '2',
        key: '10030012',
        parent: '10030001',
        statement: '',
        tag: 'R',
        value: '0.75',
        min: '',
        max: '',
        step: '',
        options: [],
      },
    ];

    renderScreen(subs, '', mockLog);
    expect(document.getElementById('lcd').outerHTML).toMatchSnapshot();
  });
});
