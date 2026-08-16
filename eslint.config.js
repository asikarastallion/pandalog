import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '.vscode/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // doc 04 §3: no `any` without an inline justification comment.
      '@typescript-eslint/no-explicit-any': 'error',
      // doc 04 §3: a switch over a union must handle every member.
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      // doc 04 §3: verbatimModuleSyntax requires type-only imports to be marked.
      '@typescript-eslint/consistent-type-imports': 'error',
      // doc 04 §3: no silent `catch {}`.
      'no-empty': ['error', { allowEmptyCatch: false }],
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      'no-console': 'error',
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettier,
);
