/**
 * ESLint for `apps/web`.
 *
 * A separate config rather than an extension of the root one, for the same reason the app has its
 * own `tsconfig.json`: the frontend needs a Vue parser, DOM globals and a different TypeScript
 * project, and none of that should become visible to the platform-neutral packages. The root config
 * stays about the domain; this one is about the application. `pnpm lint` runs both.
 *
 * The domain rules from the root config are repeated here deliberately — an app is not exempt from
 * "no `any`", "no silent catch" or "no console".
 */
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import vueParser from 'vue-eslint-parser';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  ...pluginVue.configs['flat/recommended'],

  {
    files: ['**/*.ts', '**/*.vue'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.worker },
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      // Mirrors the root config (doc 04 §3): an application is not exempt from the domain rules.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-empty': ['error', { allowEmptyCatch: false }],
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      'no-console': 'error',

      // Vue: components are named in the template by their file name, which is already PascalCase.
      'vue/multi-word-component-names': 'off',
    },
  },

  prettier,
);
