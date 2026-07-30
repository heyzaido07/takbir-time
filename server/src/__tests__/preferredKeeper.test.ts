// PUT /api/users/me/preferred-keeper — pin a time keeper for a masjid.
// The FCM topic subscribe on the device is wired to the result, so this
// route is load-bearing for keeper-update notifications. Until this
// suite landed there were ZERO tests — added during the audit.

import { jest } from '@jest/globals';

// Mock fcm so even if a future change wires this route to fire pushes,
// we never hit the network.
jest.mock('../lib/fcm', () => ({ notifyKeeperUpdate: jest.fn(async () => ({ topic: 'x', sent: false, reason: 'disabled' })) }));

import request from 'supertest';
import app from '../index';
import { prisma } from '../lib/prisma';

const EMAIL = `preferred-keeper-${Date.now()}@local`;
const KEEPER_EMAIL = `pk-keeper-${Date.now()}@local`;
const NON_KEEPER_EMAIL = `pk-non-keeper-${Date.now()}@local`;
let userId: string;
let keeperId: string;
let nonKeeperId: string;
let mosqueId: string;

beforeAll(async () => {
  const u = await prisma.user.create({ data: { email: EMAIL, fullName: 'Pinner' } });
  userId = u.id;
  const k = await prisma.user.create({ data: { email: KEEPER_EMAIL, fullName: 'Keeper' } });
  keeperId = k.id;
  const n = await prisma.user.create({ data: { email: NON_KEEPER_EMAIL, fullName: 'Not A Keeper' } });
  nonKeeperId = n.id;
  const m = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO mosques (name, location, latitude, longitude, city, country, created_at, updated_at)
    VALUES ('Pref-Keeper Test', ST_MakePoint(0, 0)::geography, 0, 0, 'X', 'Y', NOW(), NOW())
    RETURNING id::text
  `;
  mosqueId = m[0].id;
  await prisma.timingSubmission.create({
    data: {
      mosqueId,
      submittedById: keeperId,
      timings: { fajr: '05:00', dhuhr: '13:30' },
      status: 'pending',
    },
  });
});

afterAll(async () => {
  if (!process.env.DATABASE_URL) {
    await prisma.$disconnect();
    return;
  }
  if (mosqueId) {
    await prisma.timingSubmission.deleteMany({ where: { mosqueId } });
    await prisma.$executeRaw`DELETE FROM mosques WHERE id::text = ${mosqueId}`;
  }
  await prisma.user.deleteMany({ where: { email: { in: [EMAIL, KEEPER_EMAIL, NON_KEEPER_EMAIL] } } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Reset the user's preferences between tests
  await prisma.user.update({
    where: { id: userId },
    data: { notificationPreferences: { preferredKeepers: {} } as any },
  });
});

describe('PUT /api/users/me/preferred-keeper', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .put('/api/users/me/preferred-keeper')
      .send({ mosqueId, keeperUserId: keeperId });
    expect(res.status).toBe(401);
  });

  it('returns 400 when mosqueId is not a UUID', async () => {
    const res = await request(app)
      .put('/api/users/me/preferred-keeper')
      .set('X-Test-User-Id', userId)
      .send({ mosqueId: 'not-a-uuid', keeperUserId: keeperId });
    expect(res.status).toBe(400);
  });

  it('returns 400 when keeperUserId is not a UUID and not null', async () => {
    const res = await request(app)
      .put('/api/users/me/preferred-keeper')
      .set('X-Test-User-Id', userId)
      .send({ mosqueId, keeperUserId: 'invalid' });
    expect(res.status).toBe(400);
  });

  it('sets the preferred keeper for a masjid (200 + persists)', async () => {
    const res = await request(app)
      .put('/api/users/me/preferred-keeper')
      .set('X-Test-User-Id', userId)
      .send({ mosqueId, keeperUserId: keeperId });
    expect(res.status).toBe(200);
    expect(res.body.mosqueId).toBe(mosqueId);
    expect(res.body.keeperUserId).toBe(keeperId);
    expect(res.body.preferredKeepers[mosqueId]).toBe(keeperId);

    // Verify persistence by reading back through DB
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { notificationPreferences: true } });
    const stored = (me!.notificationPreferences as any).preferredKeepers;
    expect(stored[mosqueId]).toBe(keeperId);
  });

  it('rejects a user who is not a time keeper for that masjid', async () => {
    const res = await request(app)
      .put('/api/users/me/preferred-keeper')
      .set('X-Test-User-Id', userId)
      .send({ mosqueId, keeperUserId: nonKeeperId });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/active time keeper/i);

    const me = await prisma.user.findUnique({ where: { id: userId }, select: { notificationPreferences: true } });
    const stored = (me!.notificationPreferences as any).preferredKeepers;
    expect(stored[mosqueId]).toBeUndefined();
  });

  it('rejects an unknown masjid before storing a keeper preference', async () => {
    const missingMosqueId = '99999999-9999-9999-9999-999999999999';
    const res = await request(app)
      .put('/api/users/me/preferred-keeper')
      .set('X-Test-User-Id', userId)
      .send({ mosqueId: missingMosqueId, keeperUserId: keeperId });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/mosque not found/i);

    const me = await prisma.user.findUnique({ where: { id: userId }, select: { notificationPreferences: true } });
    const stored = (me!.notificationPreferences as any).preferredKeepers;
    expect(stored[missingMosqueId]).toBeUndefined();
  });

  it('clears the preference when keeperUserId is null', async () => {
    // First set
    await request(app)
      .put('/api/users/me/preferred-keeper')
      .set('X-Test-User-Id', userId)
      .send({ mosqueId, keeperUserId: keeperId });
    // Then clear
    const res = await request(app)
      .put('/api/users/me/preferred-keeper')
      .set('X-Test-User-Id', userId)
      .send({ mosqueId, keeperUserId: null });
    expect(res.status).toBe(200);
    expect(res.body.keeperUserId).toBeNull();
    expect(res.body.preferredKeepers[mosqueId]).toBeUndefined();

    const me = await prisma.user.findUnique({ where: { id: userId }, select: { notificationPreferences: true } });
    const stored = (me!.notificationPreferences as any).preferredKeepers;
    expect(stored[mosqueId]).toBeUndefined();
  });

  it('is idempotent — setting the same keeper twice yields the same result', async () => {
    await request(app)
      .put('/api/users/me/preferred-keeper')
      .set('X-Test-User-Id', userId)
      .send({ mosqueId, keeperUserId: keeperId });
    const res = await request(app)
      .put('/api/users/me/preferred-keeper')
      .set('X-Test-User-Id', userId)
      .send({ mosqueId, keeperUserId: keeperId });
    expect(res.status).toBe(200);
    expect(res.body.preferredKeepers[mosqueId]).toBe(keeperId);
  });

  it('preserves other prefs while updating one masjid', async () => {
    // Seed user with another masjid pinned
    const otherMosqueId = '99999999-9999-9999-9999-999999999999';
    const otherKeeperId = '88888888-8888-8888-8888-888888888888';
    await prisma.user.update({
      where: { id: userId },
      data: { notificationPreferences: { preferredKeepers: { [otherMosqueId]: otherKeeperId } } as any },
    });
    const res = await request(app)
      .put('/api/users/me/preferred-keeper')
      .set('X-Test-User-Id', userId)
      .send({ mosqueId, keeperUserId: keeperId });
    expect(res.status).toBe(200);
    expect(res.body.preferredKeepers[mosqueId]).toBe(keeperId);
    expect(res.body.preferredKeepers[otherMosqueId]).toBe(otherKeeperId);
  });

  it('exposes follower counts on keeper payloads', async () => {
    await request(app)
      .put('/api/users/me/preferred-keeper')
      .set('X-Test-User-Id', userId)
      .send({ mosqueId, keeperUserId: keeperId });

    const keepersRes = await request(app).get(`/api/mosques/${mosqueId}/keepers`);
    expect(keepersRes.status).toBe(200);
    const keeper = keepersRes.body.keepers.find((k: any) => k.submitterId === keeperId);
    expect(keeper).toBeDefined();
    expect(keeper.followerCount).toBe(1);

    const detailRes = await request(app).get(`/api/mosques/${mosqueId}`);
    expect(detailRes.status).toBe(200);
    const detailKeeper = detailRes.body.keepers.find((k: any) => k.submitterId === keeperId);
    expect(detailKeeper.followerCount).toBe(1);
  });

  it('exposes my time-keeper follower count on the profile payload', async () => {
    await request(app)
      .put('/api/users/me/preferred-keeper')
      .set('X-Test-User-Id', userId)
      .send({ mosqueId, keeperUserId: keeperId });

    const res = await request(app)
      .get('/api/users/me')
      .set('X-Test-User-Id', keeperId);

    expect(res.status).toBe(200);
    expect(res.body.timeKeeperFollowerCount).toBe(1);
  });
});
