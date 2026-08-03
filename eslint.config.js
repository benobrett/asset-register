import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
    },
  },
  {
    files: ['vite.config.js', 'eslint.config.js', 'playwright.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // Specs run under Node (Playwright's test runner), but also pass
    // callbacks to page.evaluate() that execute in the browser instead -
    // both sets of globals apply here, same reasoning as tests/**/*.js.
    files: ['e2e/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
    },
  },
  {
    // The pure half of the Storage cleanup function. Plain ESM with no
    // platform globals at all, deliberately - it's imported by Deno in the
    // Edge Function and by Vitest in tests/, so it can't lean on either.
    // The Deno entry point beside it is .ts and isn't linted here; this
    // project has no TypeScript toolchain, and adding one for a single
    // out-of-band file isn't worth it.
    files: ['supabase/functions/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {},
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
];
