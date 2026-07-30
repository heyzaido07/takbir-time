/**
 * Unit-test config for client-side JS modules under js/.
 * Separate from jest.config.js (which runs Puppeteer E2E against a deployed app)
 * so we can run fast jsdom-based logic tests without a backend.
 */
module.exports = {
  testEnvironment: 'jsdom',
  testMatch: ['<rootDir>/js/__tests__/**/*.test.js'],
  testTimeout: 5_000,
  // Don't try to run the e2e setup/teardown that depend on a live backend.
  reporters: ['default'],
  // .claude/worktrees/ holds agent-specific copies of the repo, each with
  // its own package.json. Haste-map flags those as duplicate-name
  // collisions if not excluded.
  modulePathIgnorePatterns: ['<rootDir>/.claude/'],
  watchPathIgnorePatterns: ['<rootDir>/.claude/'],
};
