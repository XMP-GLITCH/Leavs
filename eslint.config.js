import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

// Lint config exists for exactly one rule: react-hooks/exhaustive-deps.
//
// This codebase leans hard on refs that shadow reactive values, because native
// addEventListener closures and Media Session handlers register once and would
// otherwise capture stale state. That is deliberate and hard-won — several
// commits went into it. exhaustive-deps flags those patterns, which is useful:
// each warning is either a real stale-closure bug or a place that deserves a
// disable comment saying why it is intentional.
//
// Everything is a warning. Nothing here should ever block a build.
export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'dist/**', 'client/dist/**'],
  },

  // ── Browser: the React app ────────────────────────────────────────────────
  {
    files: ['client/src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // Injected by vite.config.js at build time
        __BUILD_COMMIT__: 'readonly',
        __BUILD_TIME__: 'readonly',
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // Without these, every component reads as an unused variable — JSX
      // references are invisible to the base no-unused-vars rule.
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': 'off',
      // Empty catch blocks are used throughout as deliberate "this is optional"
      // markers — metadata parsing, storage estimates, AudioContext teardown.
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // ── Node: serverless handlers and the dev host ────────────────────────────
  {
    files: ['client/api/**/*.js', 'server/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
]
