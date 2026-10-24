import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'migrations/**', 'jest.config.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      // ignoreRestSiblings allows `const { DROPPED: _omit, ...rest } = obj`, the idiomatic way to omit a key.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
      'no-console': 'error',
    },
  },
  {
    // Command-line helper scripts talk to the terminal and use Node's globals.
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly' } },
    rules: { 'no-console': 'off' },
  },
  {
    // The dev OTP sender and the process entrypoint are the only places allowed to
    // write directly to the terminal.
    files: ['src/modules/auth/otp-sender.ts'],
    rules: { 'no-console': 'off' },
  },
);
