// tests/logger.test.js
// Direct coverage of the logger's own level/category gating and accessors,
// which moved off appState into logger.js (C6). Every other suite mocks the
// logger, so this is the only place the real gate is exercised.
//
// logger.js resolves #log-area at module load and log() writes to it, so the
// DOM must exist before the module is required. resetModules + require per test
// gives each case fresh module state (setters don't leak between tests).

describe('logger gating and accessors', () => {
  let logger;
  const logText = () => document.getElementById('log-area').value;

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '<textarea id="log-area"></textarea>';
    logger = require('../src/logger.js');
  });

  test('defaults match the former appState defaults', () => {
    expect(logger.getLogLevel()).toBe('info');
    expect(logger.getLogCategories().general).toBe(true);
    expect(logger.getLogCategories().stateWrite).toBe(false);
  });

  test('an info message in an enabled category is written', () => {
    logger.log('hello', 'info', 'general');
    expect(logText()).toContain('hello');
  });

  test('a debug message is suppressed at the default info level', () => {
    logger.log('verbose', 'debug', 'general');
    expect(logText()).toBe('');
  });

  test('setLogLevel(debug) lets debug messages through', () => {
    logger.setLogLevel('debug');
    logger.log('verbose', 'debug', 'general');
    expect(logText()).toContain('verbose');
  });

  test('a disabled category is suppressed even at a passing level', () => {
    logger.setLogCategories({ general: false });
    logger.log('nope', 'info', 'general');
    expect(logText()).toBe('');
  });

  test('setLogCategories copies its argument (no shared reference)', () => {
    const cats = { general: true };
    logger.setLogCategories(cats);
    cats.general = false; // mutate the caller's object after the fact
    logger.log('still-on', 'info', 'general');
    expect(logText()).toContain('still-on');
  });
});
