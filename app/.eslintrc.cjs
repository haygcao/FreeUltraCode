module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs', 'vite.config.ts'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    // The *Actions modules (generationActions/historyActions/promptLibraryActions)
    // form a deliberate, single-edge import cycle with store/useStore.ts. They must
    // only be imported by useStore.ts (see the constraint header in each file).
    // Importing them elsewhere would spread the cycle and risk module-eval-time
    // access to a partially-initialized store. (Overridden for useStore.ts below.)
    'no-restricted-imports': ['error', {
      patterns: [{
        group: [
          '**/store/generationActions',
          '**/store/historyActions',
          '**/store/promptLibraryActions',
          './generationActions',
          './historyActions',
          './promptLibraryActions',
        ],
        message:
          'These are call-time action modules in a single-edge cycle with useStore.ts; only useStore.ts may import them. See the constraint header in the file.',
      }],
    }],
  },
  overrides: [
    {
      // useStore.ts is the one permitted importer of the *Actions cycle modules.
      files: ['src/store/useStore.ts'],
      rules: { 'no-restricted-imports': 'off' },
    },
  ],
};
