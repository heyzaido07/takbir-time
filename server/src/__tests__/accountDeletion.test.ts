// Tests for POST /api/account-deletion-request — public-form deletion
// requests for users who can't access the app.
//
// What we verify:
//   - Validation: bad email → 400.
//   - Happy path: valid email → 202, row created, response is generic
//     (does NOT reveal whether the email matches an account).
//   - Non-leakage: same response for emails that don't exist.
//   - Per-email rate limit: a second request within an hour for the
//     same email returns 429.

import request from 'supertest';
import app from '../index';
import { prisma } from '../lib/prisma';

const STAMP = Date.now();
const REAL_USER_EMAIL = `acct-del-real-${STAMP}@local.test`;
const NON_EXISTENT_EMAIL = `acct-del-ghost-${STAMP}@local.test`;
const RATE_LIMITED_EMAIL = `acct-del-rl-${STAMP}@local.test`;

let realUserId: string;

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: REAL_USER_EMAIL, fullName: 'Real Account For Deletion' },
  });
  realUserId = u.id;
});

afterAll(async () => {
  await prisma.accountDeletionRequest.deleteMany({
    where: { email: { in: [REAL_USER_EMAIL, NON_EXISTENT_EMAIL, RATE_LIMITED_EMAIL] } },
  });
  await prisma.user.delete({ where: { id: realUserId } });
  await prisma.$disconnect();
});

describe('POST /api/account-deletion-request', () => {
  it('rejects an obviously invalid email with 400', async () => {
    const res = await request(app)
      .post('/api/account-deletion-request')
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  it('accepts a valid email tied to a real account, stores the request, and returns a generic 202', async () => {
    const res = await request(app)
      .post('/api/account-deletion-request')
      .send({ email: REAL_USER_EMAIL, reason: 'Lost access to my device' });
    expect(res.status).toBe(202);
    expect(res.body.received).toBe(true);
    // Critical: the response MUST NOT contain any signal that the
    // email matched an account. No userId, no "exists" boolean, no
    // count of records, etc.
    expect(res.body.userId).toBeUndefined();
    expect(res.body.exists).toBeUndefined();
    expect(res.body.accountFound).toBeUndefined();

    const stored = await prisma.accountDeletionRequest.findFirst({
      where: { email: REAL_USER_EMAIL },
      orderBy: { createdAt: 'desc' },
    });
    expect(stored).toBeTruthy();
    expect(stored!.status).toBe('pending');
    expect(stored!.reason).toBe('Lost access to my device');
  });

  it('returns the SAME shape for a non-existent email (no enumeration oracle)', async () => {
    const res = await request(app)
      .post('/api/account-deletion-request')
      .send({ email: NON_EXISTENT_EMAIL });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ received: true });

    // Ghost requests are still recorded — the human reviewer discards
    // them on review. Storing them all is safer than branching: a
    // branch on "user exists" could leak via a timing side-channel.
    const stored = await prisma.accountDeletionRequest.findFirst({
      where: { email: NON_EXISTENT_EMAIL },
    });
    expect(stored).toBeTruthy();
  });

  it('rate-limits a second request for the same email within the hour with a 429', async () => {
    // First request — accepted.
    const first = await request(app)
      .post('/api/account-deletion-request')
      .send({ email: RATE_LIMITED_EMAIL });
    expect(first.status).toBe(202);

    // Second request, same email — must be rejected.
    const second = await request(app)
      .post('/api/account-deletion-request')
      .send({ email: RATE_LIMITED_EMAIL, reason: 'second try' });
    expect(second.status).toBe(429);

    // The second request must NOT have been stored (we don't queue
    // duplicates within the rate-limit window — that would let a
    // single hostile submitter swamp the review queue with one
    // email's-worth of pending records).
    const count = await prisma.accountDeletionRequest.count({
      where: { email: RATE_LIMITED_EMAIL },
    });
    expect(count).toBe(1);
  });
});
