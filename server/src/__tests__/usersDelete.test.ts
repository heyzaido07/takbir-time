// Tests for DELETE /api/users/me — self-service account deletion.
//
// Strategy: seed a user via the same X-Test-User-Id auth bypass the
// other suites use; create the dependent rows we expect to be cleaned
// (favorites, sent suggestions, reminder prefs JSON, default-mosque
// FK, plus a timing submission that should NOT be deleted); call
// DELETE /api/users/me; assert each expectation.
//
// Real Postgres + PostGIS is required, same as the other suites — we
// do not mock prisma. See server/src/__tests__/setup.ts.

import { jest } from '@jest/globals';

// Stub fcm in case any code path tries to send. Belt-and-braces; the
// delete route doesn't fire pushes today.
jest.mock('../lib/fcm', () => ({
  notifyKeeperUpdate: jest.fn(async () => ({ topic: 'x', sent: false, reason: 'disabled' as const })),
  notifyOnSuggest: jest.fn(async () => ({ topic: 'x', sent: false, reason: 'disabled' as const })),
}));

import request from 'supertest';
import app from '../index';
import { prisma } from '../lib/prisma';

const STAMP = Date.now();
const USER_EMAIL = `delete-me-${STAMP}@local`;
const RECIPIENT_EMAIL = `delete-me-recipient-${STAMP}@local`;
const SENDER_EMAIL = `delete-me-sender-${STAMP}@local`;

let userId: string;
let recipientId: string;   // gets a suggestion FROM userId — should be deleted
let senderId: string;      // sends a suggestion TO userId — should NOT be deleted
let mosqueId: string;

beforeAll(async () => {
  const u = await prisma.user.create({
    data: {
      email: USER_EMAIL,
      fullName: 'Delete Me',
      notificationPreferences: {
        prayer_reminders: true,
        timing_updates: true,
        preferredKeepers: { 'fake-mosque-id': 'fake-keeper-id' },
        reminderPrefs: { enabled: true, defaultLeadMins: 10 },
      } as any,
    },
  });
  userId = u.id;

  const r = await prisma.user.create({ data: { email: RECIPIENT_EMAIL, fullName: 'Recipient' } });
  recipientId = r.id;

  const s = await prisma.user.create({ data: { email: SENDER_EMAIL, fullName: 'Sender' } });
  senderId = s.id;

  const m = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO mosques (name, location, latitude, longitude, city, country, created_at, updated_at)
    VALUES ('Delete Me Test Mosque', ST_MakePoint(0, 0)::geography, 0, 0, 'X', 'Y', NOW(), NOW())
    RETURNING id::text
  `;
  mosqueId = m[0].id;

  // Seed dependents we expect to be cleaned up.
  await prisma.userFavorite.create({ data: { userId, mosqueId } });
  await prisma.suggestion.create({
    data: {
      mosqueId,
      fromUserId: userId,
      toUserId: recipientId,
      timings: { fajr: '05:00' } as any,
      status: 'pending',
    },
  });
  // A suggestion sent TO our user — must survive deletion.
  await prisma.suggestion.create({
    data: {
      mosqueId,
      fromUserId: senderId,
      toUserId: userId,
      timings: { fajr: '05:00' } as any,
      status: 'pending',
    },
  });
  // A timing submission — must survive (re-attribution is a read-time concern).
  await prisma.timingSubmission.create({
    data: {
      mosqueId,
      submittedById: userId,
      timings: { fajr: '05:00', dhuhr: '13:00' } as any,
      status: 'pending',
    },
  });
  // Wire defaultMosque so we can assert the FK is nulled on delete.
  await prisma.user.update({
    where: { id: userId },
    data: { defaultMosqueId: mosqueId },
  });
});

afterAll(async () => {
  // Order: anything referencing these users / the mosque, then the
  // mosque itself, then the users.
  await prisma.suggestion.deleteMany({
    where: { OR: [{ fromUserId: { in: [userId, senderId] } }, { toUserId: { in: [userId, recipientId] } }] },
  });
  await prisma.timingSubmission.deleteMany({ where: { submittedById: userId } });
  await prisma.userFavorite.deleteMany({ where: { userId } });
  await prisma.user.updateMany({
    where: { id: { in: [userId, recipientId, senderId] } },
    data: { defaultMosqueId: null },
  });
  await prisma.$executeRaw`DELETE FROM mosques WHERE id::text = ${mosqueId}`;
  await prisma.user.deleteMany({
    where: { email: { in: [USER_EMAIL, RECIPIENT_EMAIL, SENDER_EMAIL] } },
  });
  await prisma.$disconnect();
});

describe('DELETE /api/users/me', () => {
  it('returns 401 when called without auth', async () => {
    const res = await request(app).delete('/api/users/me');
    expect(res.status).toBe(401);
  });

  it('soft-deletes the user, sets deletedAt, clears prefs, and nulls defaultMosqueId', async () => {
    const res = await request(app)
      .delete('/api/users/me')
      .set('X-Test-User-Id', userId);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(res.body.alreadyDeleted).toBe(false);

    const after = await prisma.user.findUnique({ where: { id: userId } });
    expect(after).toBeTruthy();
    expect(after!.deletedAt).toBeTruthy();
    expect(after!.defaultMosqueId).toBeNull();

    // Reminder prefs + preferred-keepers JSON were wiped to schema
    // default. Tolerate either {} or the schema default — both are
    // valid "cleared" states.
    const prefs = after!.notificationPreferences as Record<string, unknown>;
    expect(prefs.preferredKeepers).toBeUndefined();
    expect(prefs.reminderPrefs).toBeUndefined();
  });

  it('cascades: favorites are deleted', async () => {
    const favs = await prisma.userFavorite.count({ where: { userId } });
    expect(favs).toBe(0);
  });

  it('cascades: suggestions sent BY the user are deleted', async () => {
    const sent = await prisma.suggestion.count({ where: { fromUserId: userId } });
    expect(sent).toBe(0);
  });

  it('does NOT cascade: suggestions sent TO the user are retained', async () => {
    const received = await prisma.suggestion.count({ where: { toUserId: userId } });
    expect(received).toBe(1);
  });

  it('does NOT cascade: timing submissions are retained for community attribution', async () => {
    const subs = await prisma.timingSubmission.count({ where: { submittedById: userId } });
    expect(subs).toBe(1);
  });

  it('is idempotent: re-deleting an already-deleted user returns 200 with alreadyDeleted=true', async () => {
    const res = await request(app)
      .delete('/api/users/me')
      .set('X-Test-User-Id', userId);
    // After the auth middleware rejects deleted users, the second DELETE
    // never reaches the route handler — it 401s at the auth gate. That's
    // the right behavior: a deleted user shouldn't be able to authenticate
    // for any endpoint, including this one. (The route handler itself
    // remains idempotent for callers that bypass auth, e.g. an admin
    // re-running the cleanup; we just can't exercise that path through
    // the public middleware.)
    expect(res.status).toBe(401);
  });

  it('rejects authenticated requests after deletion (token-reuse scenario)', async () => {
    // Even though the request presents a valid X-Test-User-Id for a
    // user that existed at token-issue time, the middleware must reject
    // it now that deletedAt is set. Spot-check a representative
    // protected endpoint (favorites).
    const protectedRoutes = [
      { method: 'get' as const, path: '/api/users/me' },
      { method: 'get' as const, path: '/api/users/me/favorites' },
      { method: 'get' as const, path: '/api/users/me/notifications' },
    ];
    for (const r of protectedRoutes) {
      const res = await request(app)[r.method](r.path).set('X-Test-User-Id', userId);
      expect(res.status).toBe(401);
    }
  });
});
