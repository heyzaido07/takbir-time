// Runs before every test suite. Forces NODE_ENV=test so the dev-auth
// bypass turns off and our 401 assertions actually fire.
process.env.NODE_ENV = 'test';

// Tiny rate-limit caps so the test that proves limits work doesn't have
// to fire 30+ real requests (each of which writes to Postgres). Real
// production caps live in route files; these env overrides only apply
// while NODE_ENV=test.
process.env.RATE_LIMIT_SUBMISSIONS_PER_HOUR = '5';
// Keep suggestion functional tests out of the limiter. The dedicated
// rate-limit test currently covers submissions; suggestion tests create
// enough valid/invalid requests that a tiny shared cap masks validation
// assertions with 429s.
process.env.RATE_LIMIT_SUGGESTIONS_PER_HOUR = '1000';
process.env.RATE_LIMIT_VOTES_PER_HOUR = '5';
process.env.RATE_LIMIT_MOSQUES_PER_HOUR = '5';

// Auth limiters: production caps would trip during the auth test suite
// (which fires many register/login/google calls back-to-back from the
// same test IP). Set generous caps here so functional tests pass; a
// dedicated suite asserting the limiters fire is still possible by
// setting these to small values inside that file.
process.env.RATE_LIMIT_LOGIN_PER_15MIN = '1000';
process.env.RATE_LIMIT_REGISTER_PER_HOUR = '1000';
process.env.RATE_LIMIT_GOOGLE_PER_15MIN = '1000';

// Hard-disable FCM during tests. The rateLimit suite hits POST /api/submissions
// without mocking the fcm module, so without this guard each accepted submission
// fires a real Firebase send (we caught this in CI logs after wiring up the
// production credentials). Tests that DO want to assert on the hook (fcmHook,
// adminTestPush) jest.mock('../lib/fcm') themselves — this gate just prevents
// the unmocked path from reaching the real network.
process.env.FCM_ENABLED = 'false';

// JWT secret needed for the auth routes to load. Tests don't issue
// real signed JWTs against any external system; this is just to keep
// the missing-secret error from firing during route module load.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-must-be-at-least-32-chars-long-xyz';
