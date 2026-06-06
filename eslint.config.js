import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['node_modules/**', 'combine/**', 'dist/**', '**/__snapshots__/**'] },
  js.configs.recommended,
  {
    // Project-wide defaults: surface dead code and stray console use as warnings
    // (these are cleaned up in the Phase 1 prune batches; warnings keep CI green meanwhile).
    rules: {
      'no-unused-vars': 'warn',
      'no-console': 'warn',
      // Flagged spots are cleaned up in the Phase 1 prune batches; keep as warnings
      // until then, then promote back to error once the code is clean.
      'no-useless-assignment': 'warn',
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
