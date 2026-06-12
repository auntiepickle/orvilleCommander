// tests/backup-ui.test.js
// The Backup & Restore modal (#147): renders the kind buttons + restore row,
// routes a backup through the engine, pauses the host (onBusy) during a
// transfer, downloads on success, and confirms before a replacing restore.
// The engine (backup.js) is mocked at its boundary.

jest.mock('../src/backup.js', () => ({
  requestBackup: jest.fn(),
  restore: jest.fn(),
  frameFromFile: jest.fn(() => [0xf0, 0x1c, 0x70, 1, 0x15, 0xf7]),
  backupFilename: jest.fn(() => 'orville-program-x.syx'),
  BACKUP_KINDS: {
    internal: { want: 0x12, dump: 0x11, label: 'Full unit (internal memory)', replaces: true },
    files: { want: 0x10, dump: 0x0f, label: 'All presets', replaces: true },
    program: { want: 0x06, dump: 0x15, label: 'Current program', replaces: false },
    setup: { want: 0x07, dump: 0x16, label: 'Unit setup', replaces: false },
  },
}));

import { setupBackupUI, openBackup, closeBackup, resetBackupUI } from '../src/backup-ui.js';
import { requestBackup, restore } from '../src/backup.js';

const q = (s) => document.querySelector(s);
const qa = (s) => [...document.querySelectorAll(s)];

beforeAll(() => {
  // jsdom lacks object URLs; the download path needs them.
  global.URL.createObjectURL = jest.fn(() => 'blob:x');
  global.URL.revokeObjectURL = jest.fn();
});

beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
  resetBackupUI();
});

test('opens with a backup button per kind + a restore row', () => {
  setupBackupUI({});
  openBackup();
  expect(q('.bk-modal')).toBeTruthy();
  expect(qa('.bk-grid .bk-btn').map((b) => b.textContent)).toEqual([
    'Full unit (internal memory)',
    'All presets',
    'Current program',
    'Unit setup',
  ]);
  expect(q('.bk-file')).toBeTruthy();
  expect(q('.bk-restore-btn').disabled).toBe(true); // nothing loaded yet
});

test('a backup pauses the host, runs the engine, downloads + reports on success', () => {
  const onBusy = jest.fn();
  setupBackupUI({ onBusy });
  openBackup();
  qa('.bk-grid .bk-btn')
    .find((b) => b.textContent === 'Current program')
    .click();

  expect(requestBackup).toHaveBeenCalledWith('program', expect.any(Object));
  expect(onBusy).toHaveBeenLastCalledWith(true); // host paused
  expect(q('.bk-grid .bk-btn').disabled).toBe(true); // buttons locked during transfer

  // engine reports done with a good checksum
  const cb = requestBackup.mock.calls[0][1];
  cb.onProgress(2048);
  cb.onDone({ frame: new Array(4096).fill(0), checksumOk: true });

  expect(global.URL.createObjectURL).toHaveBeenCalled(); // downloaded
  expect(onBusy).toHaveBeenLastCalledWith(false); // host resumed
  expect(q('.bk-status').textContent).toMatch(/checksum ok/i);
});

test('a failed checksum surfaces a warning', () => {
  setupBackupUI({});
  openBackup();
  qa('.bk-grid .bk-btn')[0].click();
  requestBackup.mock.calls[0][1].onDone({ frame: new Array(10).fill(0), checksumOk: false });
  expect(q('.bk-status').classList.contains('bk-error')).toBe(true);
  expect(q('.bk-status').textContent).toMatch(/checksum failed/i);
});

test('restore is gated until a valid backup is loaded, and never fires unconfirmed', async () => {
  setupBackupUI({});
  openBackup();
  window.confirm = jest.fn(() => false);
  // Nothing loaded -> button disabled, clicking is a no-op.
  expect(q('.bk-restore-btn').disabled).toBe(true);
  q('.bk-restore-btn').click();
  expect(restore).not.toHaveBeenCalled();

  // Load a valid internal-dump backup (frameFromFile is mocked to a 0x15 frame).
  const file = q('.bk-file');
  const f = new File([new Uint8Array([0xf0, 0x1c, 0x70, 1, 0x15, 0xf7])], 'b.syx');
  f.arrayBuffer = () => Promise.resolve(new Uint8Array([0xf0, 0x1c, 0x70, 1, 0x15, 0xf7]).buffer);
  Object.defineProperty(file, 'files', { value: [f], configurable: true });
  file.dispatchEvent(new Event('change'));
  await Promise.resolve(); // let the async change handler settle
  await Promise.resolve();
  expect(q('.bk-restore-btn').disabled).toBe(false);

  // Declining the confirm must NOT call the engine.
  q('.bk-restore-btn').click();
  expect(window.confirm).toHaveBeenCalled();
  expect(restore).not.toHaveBeenCalled();
});

test('closeBackup hides; resetBackupUI removes the modal', () => {
  setupBackupUI({});
  openBackup();
  closeBackup();
  expect(q('.bk-modal').hidden).toBe(true);
  resetBackupUI();
  expect(q('.bk-modal')).toBeNull();
});
