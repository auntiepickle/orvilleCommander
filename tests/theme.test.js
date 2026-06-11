// tests/theme.test.js
// Pins the theme engine: token precedence (override > preset > stylesheet),
// applyTheme's set/remove contract on :root, and the editor's
// preset-switch / override / reset flows including persistence.

jest.mock('../src/logger.js', () => ({
  log: jest.fn(),
}));

import {
  THEME_TOKENS,
  THEMES,
  DEFAULT_THEME,
  applyTheme,
  effectiveTokenValue,
  setupThemeEditor,
} from '../src/theme.js';

describe('theme engine', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style');
    document.body.innerHTML =
      '<select id="theme-preset"></select>' +
      '<button id="theme-reset"></button>' +
      '<div id="theme-tokens"></div>';
  });

  const editorEls = () => ({
    presetSelect: document.getElementById('theme-preset'),
    resetButton: document.getElementById('theme-reset'),
    tokensContainer: document.getElementById('theme-tokens'),
  });

  test('every synthwave token is a registered token', () => {
    const registered = new Set(THEME_TOKENS.map((t) => t.cssVar));
    for (const cssVar of Object.keys(THEMES.synthwave)) {
      expect(registered.has(cssVar)).toBe(true);
    }
  });

  test('effective value precedence: override > preset > stylesheet (empty)', () => {
    expect(effectiveTokenValue(DEFAULT_THEME, '--lcd-px')).toBe(''); // stylesheet
    expect(effectiveTokenValue({ preset: 'synthwave', overrides: {} }, '--lcd-px')).toBe('#ff71ce');
    expect(
      effectiveTokenValue({ preset: 'synthwave', overrides: { '--lcd-px': '#123456' } }, '--lcd-px')
    ).toBe('#123456');
  });

  test('applyTheme sets preset values inline and factory removes them', () => {
    applyTheme({ preset: 'synthwave', overrides: {} });
    expect(document.documentElement.style.getPropertyValue('--lcd-px')).toBe('#ff71ce');
    expect(document.documentElement.style.getPropertyValue('--rack-bg')).toBe('#0d0a1a');

    applyTheme(DEFAULT_THEME);
    // Factory = the stylesheet's own values: nothing inline.
    expect(document.documentElement.style.getPropertyValue('--lcd-px')).toBe('');
  });

  test('editor builds one swatch per registry token and persists overrides', () => {
    const onChange = jest.fn();
    setupThemeEditor(editorEls(), DEFAULT_THEME, onChange);

    const swatches = document.querySelectorAll('#theme-tokens input[type="color"]');
    expect(swatches).toHaveLength(THEME_TOKENS.length);

    const phosphor = document.querySelector('input[data-css-var="--lcd-px"]');
    phosphor.value = '#ff0000';
    phosphor.dispatchEvent(new Event('input', { bubbles: true }));

    expect(document.documentElement.style.getPropertyValue('--lcd-px')).toBe('#ff0000');
    expect(onChange).toHaveBeenCalledWith({
      preset: 'factory',
      overrides: { '--lcd-px': '#ff0000' },
    });
  });

  test('preset switch applies the palette and clears overrides; reset clears overrides only', () => {
    const onChange = jest.fn();
    setupThemeEditor(
      editorEls(),
      { preset: 'factory', overrides: { '--lcd-px': '#ff0000' } },
      onChange
    );
    expect(document.documentElement.style.getPropertyValue('--lcd-px')).toBe('#ff0000');

    const preset = document.getElementById('theme-preset');
    preset.value = 'synthwave';
    preset.dispatchEvent(new Event('change', { bubbles: true }));
    expect(document.documentElement.style.getPropertyValue('--lcd-px')).toBe('#ff71ce');
    expect(onChange).toHaveBeenLastCalledWith({ preset: 'synthwave', overrides: {} });

    // Override on top of synthwave, then reset back to the pure preset.
    const phosphor = document.querySelector('input[data-css-var="--lcd-px"]');
    phosphor.value = '#00ff00';
    phosphor.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.documentElement.style.getPropertyValue('--lcd-px')).toBe('#00ff00');

    document.getElementById('theme-reset').click();
    expect(document.documentElement.style.getPropertyValue('--lcd-px')).toBe('#ff71ce');
    expect(onChange).toHaveBeenLastCalledWith({ preset: 'synthwave', overrides: {} });
  });

  test('boot restore: a persisted theme applies as saved', () => {
    setupThemeEditor(
      editorEls(),
      { preset: 'synthwave', overrides: { '--led-red': '#ffffff' } },
      jest.fn()
    );
    expect(document.documentElement.style.getPropertyValue('--lcd-bg')).toBe('#14061e');
    expect(document.documentElement.style.getPropertyValue('--led-red')).toBe('#ffffff');
  });
});
