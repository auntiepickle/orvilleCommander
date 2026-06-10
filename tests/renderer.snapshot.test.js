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

  test('leaf menu with INF param and formatValue width / percent branches', () => {
    // Pins: INF type rendering, %3.0f (NUM), %-10s (INF), and the CON %% percent path.
    appState.currentKey = '10010001';
    appState.keyStack = [];

    const subs = [
      {
        type: 'COL',
        position: '0',
        key: '10010001',
        parent: '0',
        statement: 'Audio',
        tag: 'audio',
      },
      {
        type: 'NUM',
        position: '1',
        key: '10010011',
        parent: '10010001',
        statement: 'Gain %3.0f dB',
        tag: 'gain',
        value: '5.4',
        options: [],
      },
      {
        type: 'INF',
        position: '2',
        key: '10010012',
        parent: '10010001',
        statement: 'Mode: %-10s',
        tag: 'mode',
        value: 'active',
        options: [],
      },
      {
        type: 'CON',
        position: '3',
        key: '10010013',
        parent: '10010001',
        statement: 'Level %3.0f%%',
        tag: 'lvl',
        value: '0.5',
        options: [],
      },
    ];

    renderScreen(subs, '', mockLog);
    expect(document.getElementById('lcd').outerHTML).toMatchSnapshot();
  });

  test('SET param with hex index >= 10 selects the right option', () => {
    appState.currentKey = '10010002';
    appState.keyStack = [];

    const subs = [
      {
        type: 'COL',
        position: '0',
        key: '10010002',
        parent: '0',
        statement: 'Routing',
        tag: 'route',
      },
      {
        type: 'SET',
        position: '1',
        key: '10010021',
        parent: '10010002',
        statement: 'Type %-8s',
        tag: 'type',
        value: '0a Chorus',
        options: [
          { index: '0', desc: 'Off' },
          { index: '9', desc: 'Flange' },
          { index: '10', desc: 'Chorus' },
          { index: '11', desc: 'Phaser' },
        ],
      },
    ];

    renderScreen(subs, '', mockLog);
    expect(document.getElementById('lcd').outerHTML).toMatchSnapshot();
  });

  test('graphic-EQ position-a NUMs grouped onto one line', () => {
    appState.currentKey = '10010003';
    appState.keyStack = [];

    const subs = [
      { type: 'COL', position: '0', key: '10010003', parent: '0', statement: 'EQ', tag: 'eq' },
      {
        type: 'NUM',
        position: 'a',
        key: '100100a1',
        parent: '10010003',
        statement: '',
        tag: 'v1:%3.0f',
        value: '3',
        options: [],
      },
      {
        type: 'NUM',
        position: 'a',
        key: '100100a2',
        parent: '10010003',
        statement: '',
        tag: 'v2:%3.0f',
        value: '-2',
        options: [],
      },
      {
        type: 'NUM',
        position: 'a',
        key: '100100a3',
        parent: '10010003',
        statement: '',
        tag: 'v3:%3.0f',
        value: '0',
        options: [],
      },
    ];

    renderScreen(subs, '', mockLog);
    expect(document.getElementById('lcd').outerHTML).toMatchSnapshot();
  });

  test('keyStack depth 3 renders grandparent softkey row', () => {
    appState.currentKey = '10010051';
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
          },
          {
            type: 'COL',
            position: '1',
            key: '10010001',
            parent: '10010000',
            statement: 'Input',
            tag: 'input',
          },
          {
            type: 'COL',
            position: '2',
            key: '10010002',
            parent: '10010000',
            statement: 'Output',
            tag: 'output',
          },
        ],
      },
      {
        key: '10010001',
        tag: 'input',
        subs: [
          {
            type: 'COL',
            position: '0',
            key: '10010001',
            parent: '10010000',
            statement: 'Input',
            tag: 'input',
          },
          {
            type: 'COL',
            position: '1',
            key: '10010005',
            parent: '10010001',
            statement: 'Gain',
            tag: 'gain',
          },
          {
            type: 'COL',
            position: '2',
            key: '10010006',
            parent: '10010001',
            statement: 'Pan',
            tag: 'pan',
          },
        ],
      },
      {
        key: '10010005',
        tag: 'gain',
        subs: [
          {
            type: 'COL',
            position: '0',
            key: '10010005',
            parent: '10010001',
            statement: 'Gain',
            tag: 'gain',
          },
          {
            type: 'COL',
            position: '1',
            key: '10010051',
            parent: '10010005',
            statement: 'Fine',
            tag: 'fine',
          },
          {
            type: 'COL',
            position: '2',
            key: '10010052',
            parent: '10010005',
            statement: 'Coarse',
            tag: 'coarse',
          },
        ],
      },
    ];

    const subs = [
      {
        type: 'COL',
        position: '0',
        key: '10010051',
        parent: '10010005',
        statement: 'Fine',
        tag: 'fine',
      },
      {
        type: 'NUM',
        position: '1',
        key: '10010511',
        parent: '10010051',
        statement: 'Amt %3.0f',
        tag: 'amt',
        value: '10',
        options: [],
      },
      {
        type: 'COL',
        position: '1',
        key: '10010055',
        parent: '10010051',
        statement: 'Extra',
        tag: 'extra',
        options: [],
      },
    ];

    renderScreen(subs, '', mockLog);
    expect(document.getElementById('lcd').outerHTML).toMatchSnapshot();
  });

  test('embedded childSubs are expanded inline under the parent menu', () => {
    appState.currentKey = '10010007';
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
          },
          {
            type: 'COL',
            position: '1',
            key: '10010007',
            parent: '10010000',
            statement: 'Wrap',
            tag: 'wrap',
          },
        ],
      },
    ];
    appState.childSubs = {
      10010071: [
        {
          type: 'COL',
          position: '0',
          key: '10010071',
          parent: '10010007',
          statement: 'Inner',
          tag: 'inner',
        },
        {
          type: 'NUM',
          position: '1',
          key: '10010711',
          parent: '10010071',
          statement: 'Depth %3.0f',
          tag: 'depth',
          value: '7',
          options: [],
        },
      ],
    };

    const subs = [
      {
        type: 'COL',
        position: '0',
        key: '10010007',
        parent: '10010000',
        statement: 'Wrap',
        tag: 'wrap',
      },
      {
        type: 'COL',
        position: '0',
        key: '10010071',
        parent: '10010007',
        statement: 'Inner',
        tag: 'inner',
      },
    ];

    renderScreen(subs, '', mockLog);
    expect(document.getElementById('lcd').outerHTML).toMatchSnapshot();
  });
});
