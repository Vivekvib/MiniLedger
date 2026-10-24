/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  // Runs once, before any test file, and refuses to continue unless the target
  // database is provably a disposable test database. See tests/setup/global-setup.ts.
  globalSetup: '<rootDir>/tests/setup/global-setup.ts',
  testTimeout: 20000,
};
