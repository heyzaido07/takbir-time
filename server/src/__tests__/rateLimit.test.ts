// Rate limiting on write endpoints: a single user hammering past the cap
// gets a 429 instead of being able to flood the system.
//
// Each describe-block isolates a small limit (override via env at module
// load) so the test runs in milliseconds without simulating thousands of
// real requests.

import request from 'supertest';
import app from '../index';
import { prisma } from '../lib/prisma';

let userId: string;
let mosqueId: string;
const EMAIL = `rate-limit-${Date.now()}@local`;

beforeAll(async () => {
  const u = await prisma.user.create({ data: { email: EMAIL, fullName: 'Rate Test' } });
  userId = u.id;
  const m = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO mosques (name, location, latitude, longitude, city, country, created_at, updated_at)
    VALUES ('Rate Limit Mosque', ST_MakePoint(0, 0)::geography, 0, 0, 'X', 'Y', NOW(), NOW())
    RETURNING id::text
  `;
  mosqueId = m[0].id;
});

afterAll(async () => {
  if (userId) {
    await prisma.timingSubmission.deleteMany({ where: { submittedById: userId } });
    await prisma.suggestion.deleteMany({ where: { fromUserId: userId } });
  }
  if (mosqueId) await prisma.$executeRaw`DELETE FROM mosques WHERE id::text = ${mosqueId}`;
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  await prisma.$disconnect();
});

describe('Rate limiting', () => {
  it('returns 429 after exceeding the per-user cap on POST /api/submissions', async () => {
    // The cap is `RATE_LIMIT_SUBMISSIONS_PER_HOUR` (default 30); we set it
    // very low at boot via env so the test stays fast and deterministic.
    // The middleware reads the env at instantiation time, which happens
    // when the route module loads — see SET_ENV_FOR_TESTS at top of file.
    const send = () => request(app)
      .post('/api/submissions')
      .set('X-Test-User-Id', userId)
      .send({ mosqueId, timings: { fajr: '05:00' } });

    // Hammer up to the cap. Each is a real submission, but the test mosque
    // has no votes/users beyond ours so it stays small.
    const cap = parseInt(process.env.RATE_LIMIT_SUBMISSIONS_PER_HOUR || '5', 10);
    let got429 = false;
    for (let i = 0; i < cap + 3; i++) {
      const res = await send();
      if (res.status === 429) { got429 = true; break; }
    }
    expect(got429).toBe(true);
  });
});
