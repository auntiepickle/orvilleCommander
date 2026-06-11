// theme.js
// Tokenized theme engine: every uniquely-identifiable color in the UI is a
// CSS custom property on :root (styles.css carries the factory values; all
// alpha/glow variants derive via color-mix, so retinting a token retints
// its whole family). A theme is { preset, overrides } — preset values come
// from THEMES, per-token overrides sit on top, and application is inline
// style on the root element so the stylesheet stays the single source of
// truth and "reset" is just removeProperty. Persisted in midiConfig
// (config.js saveThemeConfig); the editor pane in the service panel is
// built by setupThemeEditor.

import { log } from './logger.js';

// The registry: every themable color token, in editor display order.
// cssVar doubles as the unique ID end to end (stylesheet, override map,
// persistence, editor DOM).
export const THEME_TOKENS = [
  { cssVar: '--lcd-px', label: 'Phosphor' },
  { cssVar: '--lcd-px-dim', label: 'Phosphor dim' },
  { cssVar: '--lcd-bg', label: 'Display background' },
  { cssVar: '--bezel', label: 'Bezel' },
  { cssVar: '--rack-bg', label: 'Room background' },
  { cssVar: '--faceplate', label: 'Faceplate' },
  { cssVar: '--faceplate-hi', label: 'Faceplate highlight' },
  { cssVar: '--panel-line', label: 'Panel lines' },
  { cssVar: '--legend', label: 'Legend text' },
  { cssVar: '--legend-dim', label: 'Legend dim' },
  { cssVar: '--btn-cap', label: 'Key cap' },
  { cssVar: '--btn-cap-hi', label: 'Key cap highlight' },
  { cssVar: '--btn-edge', label: 'Key edge' },
  { cssVar: '--led-green', label: 'LED primary' },
  { cssVar: '--led-red', label: 'LED alert' },
  { cssVar: '--led-amber', label: 'LED warn' },
];

// Named presets. factory = empty (the stylesheet's own values); other
// presets override every token they care about and inherit the rest.
export const THEMES = {
  factory: {},
  synthwave: {
    '--lcd-px': '#ff71ce',
    '--lcd-px-dim': '#8a3d78',
    '--lcd-bg': '#14061e',
    '--bezel': '#0a0716',
    '--rack-bg': '#0d0a1a',
    '--faceplate': '#1a1430',
    '--faceplate-hi': '#261d45',
    '--panel-line': '#3d2e66',
    '--legend': '#e8d9ff',
    '--legend-dim': '#8f7fb8',
    '--btn-cap': '#251c40',
    '--btn-cap-hi': '#322657',
    '--btn-edge': '#0a0716',
    '--led-green': '#00f0c8',
    '--led-red': '#ff2975',
    '--led-amber': '#ff9e64',
  },
};

export const DEFAULT_THEME = { preset: 'factory', overrides: {} };

/**
 * Effective value for one token under a theme: override beats preset
 * beats the stylesheet (empty string = stylesheet default, i.e. nothing
 * to apply inline).
 *
 * @param {{preset: string, overrides: Object}} theme
 * @param {string} cssVar
 * @returns {string}
 */
export function effectiveTokenValue(theme, cssVar) {
  const preset = THEMES[theme?.preset] || THEMES.factory;
  return theme?.overrides?.[cssVar] ?? preset[cssVar] ?? '';
}

/**
 * Applies a theme to :root. Tokens with no preset/override value get their
 * inline property REMOVED so the stylesheet's factory value shows through.
 *
 * @param {{preset: string, overrides: Object}} theme
 */
export function applyTheme(theme) {
  const root = document.documentElement;
  for (const { cssVar } of THEME_TOKENS) {
    const value = effectiveTokenValue(theme, cssVar);
    if (value) root.style.setProperty(cssVar, value);
    else root.style.removeProperty(cssVar);
  }
}

// '#rrggbb' for an <input type="color"> from whatever the token resolves
// to right now (inline value, else computed stylesheet value). Color
// inputs only accept 6-digit hex; non-hex resolutions (rgb()) convert.
function tokenHexForEditor(theme, cssVar) {
  // window.getComputedStyle, not the bare global: the headless harnesses
  // (live-app, tree-audit, render-preview) define window/document but no
  // top-level getComputedStyle.
  const value =
    effectiveTokenValue(theme, cssVar) ||
    window.getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  const rgbMatch = value.match(/^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (rgbMatch) {
    return `#${rgbMatch
      .slice(1, 4)
      .map((c) => parseInt(c, 10).toString(16).padStart(2, '0'))
      .join('')}`;
  }
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000';
}

/**
 * Builds the theme editor inside the given container (the service panel's
 * THEME column): a preset selector, a reset-overrides button, and one
 * swatch row per registry token — an IDE-style theme editor over the
 * token registry. Mutates and persists via the injected callback.
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.presetSelect - The preset <select>.
 * @param {HTMLElement} opts.resetButton - The reset-overrides button.
 * @param {HTMLElement} opts.tokensContainer - Host for the swatch rows.
 * @param {{preset: string, overrides: Object}} initialTheme
 * @param {(theme: Object) => void} onThemeChange - Persistence hook.
 */
export function setupThemeEditor(
  { presetSelect, resetButton, tokensContainer },
  initialTheme,
  onThemeChange
) {
  const theme = {
    preset: initialTheme?.preset || DEFAULT_THEME.preset,
    overrides: { ...(initialTheme?.overrides || {}) },
  };

  const commit = () => {
    applyTheme(theme);
    onThemeChange({ preset: theme.preset, overrides: { ...theme.overrides } });
  };

  const rebuildSwatches = () => {
    tokensContainer.innerHTML = '';
    for (const { cssVar, label } of THEME_TOKENS) {
      const row = document.createElement('label');
      row.className = 'theme-token';
      const swatch = document.createElement('input');
      swatch.type = 'color';
      swatch.dataset.cssVar = cssVar;
      swatch.value = tokenHexForEditor(theme, cssVar);
      swatch.addEventListener('input', () => {
        theme.overrides[cssVar] = swatch.value;
        commit();
      });
      const name = document.createElement('span');
      name.textContent = label;
      const varName = document.createElement('code');
      varName.textContent = cssVar;
      row.append(swatch, name, varName);
      tokensContainer.appendChild(row);
    }
  };

  presetSelect.innerHTML = '';
  for (const name of Object.keys(THEMES)) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    if (name === theme.preset) option.selected = true;
    presetSelect.appendChild(option);
  }
  presetSelect.addEventListener('change', () => {
    theme.preset = presetSelect.value;
    theme.overrides = {}; // overrides are relative to a preset
    commit();
    rebuildSwatches();
    log(`Theme preset: ${theme.preset}`, 'info', 'general');
  });

  resetButton.addEventListener('click', () => {
    theme.overrides = {};
    commit();
    rebuildSwatches();
    log('Theme overrides reset to preset values', 'info', 'general');
  });

  applyTheme(theme);
  rebuildSwatches();
}
