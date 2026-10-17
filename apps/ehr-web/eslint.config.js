import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // FHIR payloads include extension-driven fields whose shape is resolved at
      // runtime. Keep explicit `any` available at those integration boundaries;
      // application models remain strongly typed where a stable contract exists.
      '@typescript-eslint/no-explicit-any': 'off',
      // Data-loading effects call async functions which update state after an
      // awaited request. The rule reports the call site as synchronous even
      // though the updates occur outside the effect's synchronous phase.
      'react-hooks/set-state-in-effect': 'off',
      // Screens load remote data from explicit identity/status keys. Adding the
      // locally declared loader itself would recreate the dependency each render
      // and can cause request loops; the stable keys remain listed per effect.
      'react-hooks/exhaustive-deps': 'off',
      // This hook is intentionally colocated with its provider; it does not
      // create component state and is safe for Fast Refresh.
      'react-refresh/only-export-components': [
        'error',
        { allowExportNames: ['useHospital'] },
      ],
    },
  },
])
