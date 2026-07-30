/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/e2e/**/*.test.js'],
  testTimeout: 120_000, // browser launches + page navigations need headroom
  // Run suites SEQUENTIALLY: shared backend / shared DB makes parallel
  // suites race-y (especially favorites + contribute, which mutate state).
  maxWorkers: 1,
  reporters: ['default'],
  // Quiet down Puppeteer's experimental warnings
  setupFiles: [],
  globalSetup: '<rootDir>/e2e/global-setup.js',
  globalTeardown: '<rootDir>/e2e/global-teardown.js',
  // Jest's haste-map crawls the whole repo for a virtual module map. The
  // .claude/worktrees/ directory contains agent-specific copies of this
  // repo (each with its own package.json), and haste-map flags those
  // duplicate names as collisions. They aren't part of the app — exclude
  // them from any crawl.
  modulePathIgnorePatterns: ['<rootDir>/.claude/'],
  watchPathIgnorePatterns: ['<rootDir>/.claude/'],
};
