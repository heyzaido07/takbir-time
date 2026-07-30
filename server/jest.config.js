/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/index.ts'],
  testTimeout: 15000,
  // tsconfig.test.json includes src/__tests__/, which the production
  // tsconfig.json now excludes (so `npm run build` doesn't try to
  // compile test code).
  globals: { 'ts-jest': { isolatedModules: true, tsconfig: 'tsconfig.test.json' } },
  setupFiles: ['<rootDir>/src/__tests__/setup.ts'],
};
