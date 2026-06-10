import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['node_modules/**', 'combine/**', 'dist/**', '**/__snapshots__/**', 'logs/**'] },
  js.configs.recommended,
  {
    // Phase 1 cleanup is complete, so these are hard errors now. Prefix an
    // intentionally-unused var/arg with _ to opt out (e.g. reserved params).
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'error',
      'no-useless-assignment': 'error',
    },
  },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
  },
  {
    // logger.js intentionally mirrors output to the devtools console.
    files: ['src/logger.js'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.jest, ...globals.browser },
    },
  },
  {
    files: ['build_tools/**/*.js', 'vite.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: { 'no-console': 'off' },
  },
  prettier,
];
