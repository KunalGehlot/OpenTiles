import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      'target/**',
      '**/node_modules/**',
      'apps/web/public/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Sharing, publishing or URL import of library items is a legal guardrail (docs/legal-guardrails.md).
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='share'][callee.object.name='navigator']",
          message: 'Library items must never be shared. See docs/legal-guardrails.md.',
        },
      ],
    },
  },
  {
    // The classic hook rules. The React-Compiler rules in the plugin's recommended set would forbid
    // the deliberate pattern of a mutable controller (PracticeSession) driving the canvas outside
    // React; the app does not use the React Compiler.
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
