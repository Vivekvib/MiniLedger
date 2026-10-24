/** @type {import('jest').Config} */
module.exports = {
  // Android first: Platform.OS is "android" in tests, so the Android date picker path is the one exercised.
  preset: 'jest-expo/android',
  // setup-env runs before the framework (pins the time zone); setup runs after it (shared mocks).
  setupFiles: ['<rootDir>/tests/setup-env.ts'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  testMatch: ['<rootDir>/tests/**/*.test.ts?(x)'],
};
