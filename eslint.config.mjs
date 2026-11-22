import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2025, sourceType: 'module' },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  // Shared core: runs in Node (main, tests) and the browser (renderer).
  { files: ['src/core/**/*.js'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  { files: ['src/main/**/*.js', 'scripts/**/*.mjs', 'test/**/*.mjs', 'eslint.config.mjs'], languageOptions: { globals: globals.node } },
  { files: ['src/preload.cjs'], languageOptions: { sourceType: 'commonjs', globals: globals.node } },
  { files: ['src/ui/**/*.js'], languageOptions: { globals: globals.browser } },
];
