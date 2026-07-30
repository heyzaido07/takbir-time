// Global setup runs once before any test file. Used to make sure the
// target deploy is reachable before we waste CI cycles on browser launches.

const BASE_URL = process.env.BASE_URL || 'https://takbeertime.com';
// HEALTH_URL lets local runs point at the actual backend (e.g. localhost:6001/api/users/me),
// since the static frontend at localhost:6002 doesn't proxy /health.
const HEALTH_URL = process.env.HEALTH_URL || `${BASE_URL}/health`;

module.exports = async () => {
  if (process.env.SKIP_HEALTH === '1') {
    console.log(`✓ Skipping health check (SKIP_HEALTH=1)`);
    return;
  }
  const res = await fetch(HEALTH_URL).catch(err => {
    throw new Error(`Cannot reach ${HEALTH_URL}: ${err.message}`);
  });
  if (!res.ok) {
    throw new Error(`${HEALTH_URL} returned ${res.status} — backend unreachable, aborting tests.`);
  }
  console.log(`✓ Backend reachable at ${HEALTH_URL}`);
};
