import { jest } from '@jest/globals';
const fcmCalls: any[] = [];
const notifySpy = jest.fn(async (args: any) => { fcmCalls.push(args); return { topic: 'mock', sent: false, reason: 'disabled' as const }; });
const suggestCalls: any[] = [];
const suggestSpy = jest.fn(async (args: any) => { suggestCalls.push(args); return { topic: 'mock-suggest', sent: false, reason: 'disabled' as const }; });
jest.mock('../lib/fcm', () => ({ notifyKeeperUpdate: notifySpy, notifyOnSuggest: suggestSpy }));

import request from 'supertest';
import app from '../index';
import { prisma } from '../lib/prisma';

// Test users + mosque are seeded inline so this suite is independent of
// whatever happens to be in the dev DB. Cleaned up in afterAll.
let mosqueId: string;
let keeperId: string;
let suggesterId: string;
const KEEPER_EMAIL = `e2e-keeper-${Date.now()}@local`;
const SUGGESTER_EMAIL = `e2e-suggester-${Date.now()}@local`;

beforeAll(async () => {
  // Create both users via the dev-auth /me touch (bypass disabled in test env,
  // so we have to insert directly).
  const keeper = await prisma.user.create({ data: { email: KEEPER_EMAIL, fullName: 'Test Keeper' } });
  const suggester = await prisma.user.create({ data: { email: SUGGESTER_EMAIL, fullName: 'Test Suggester' } });
  keeperId = keeper.id;
  suggesterId = suggester.id;

  // Create a mosque the suggester can target.
  const m = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO mosques (name, location, latitude, longitude, city, country, created_at, updated_at)
    VALUES ('Suggestion Test Mosque', ST_MakePoint(0, 0)::geography, 0, 0, 'X', 'Y', NOW(), NOW())
    RETURNING id::text
  `;
  mosqueId = m[0].id;

  await prisma.timingSubmission.create({
    data: {
      mosqueId,
      submittedById: keeperId,
      timings: { fajr: '04:50', dhuhr: '13:30' },
      status: 'pending',
    },
  });
});

afterAll(async () => {
  // Strict ordering: anything referencing the test users must be deleted
  // first (timing_submissions, prayer_schedules, suggestions) before the
  // users themselves can go.
  await prisma.suggestion.deleteMany({ where: { OR: [{ fromUserId: suggesterId }, { toUserId: keeperId }] } });
  await prisma.timingSubmission.deleteMany({ where: { OR: [{ submittedById: keeperId }, { submittedById: suggesterId }] } });
  await prisma.prayerSchedule.deleteMany({ where: { mosqueId } });
  await prisma.$executeRaw`DELETE FROM mosques WHERE id::text = ${mosqueId}`;
  await prisma.user.deleteMany({ where: { email: { in: [KEEPER_EMAIL, SUGGESTER_EMAIL] } } });
  await prisma.$disconnect();
});

describe('POST /api/suggestions', () => {
  it('rejects unauthenticated', async () => {
    const res = await request(app)
      .post('/api/suggestions')
      .send({ toUserId: keeperId, mosqueId, timings: { fajr: '05:00' } });
    expect(res.status).toBe(401);
  });

  it('creates a pending suggestion for the keeper', async () => {
    // Use the test-only dev-auth bypass via a special header that test-mode
    // accepts. Since NODE_ENV=test disables the normal bypass, we authenticate
    // by directly inserting a Firebase UID + using authorization header.
    // For this test suite we instead authenticate via the X-Test-User-Id
    // header, which the auth middleware should accept in test mode only.
    const res = await request(app)
      .post('/api/suggestions')
      .set('X-Test-User-Id', suggesterId)
      .send({
        toUserId: keeperId,
        mosqueId,
        timings: { fajr: '05:00', dhuhr: '13:30', maghribOffset: 5 },
        notes: 'Ramadan schedule starts tomorrow',
      });
    expect(res.status).toBe(201);
    expect(res.body.suggestion).toBeDefined();
    expect(res.body.suggestion.fromUserId).toBe(suggesterId);
    expect(res.body.suggestion.toUserId).toBe(keeperId);
    expect(res.body.suggestion.status).toBe('pending');
    expect(res.body.suggestion.timings.fajr).toBe('05:00');
    expect(res.body.suggestion.timings.maghribOffset).toBe(5);
  });

  it('rejects sending to oneself', async () => {
    const res = await request(app)
      .post('/api/suggestions')
      .set('X-Test-User-Id', suggesterId)
      .send({
        toUserId: suggesterId, // same as auth user
        mosqueId,
        timings: { fajr: '05:00' },
      });
    expect(res.status).toBe(400);
  });

  it('rejects invalid timings shape', async () => {
    const res = await request(app)
      .post('/api/suggestions')
      .set('X-Test-User-Id', suggesterId)
      .send({
        toUserId: keeperId,
        mosqueId,
        timings: { fajr: 'not-a-time' },
      });
    expect(res.status).toBe(400);
  });

  it('rejects a recipient who is not a keeper for that mosque', async () => {
    const m = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO mosques (name, location, latitude, longitude, city, country, created_at, updated_at)
      VALUES ('Suggestion Non-Keeper Target Test', ST_MakePoint(0, 0)::geography, 0, 0, 'X', 'Y', NOW(), NOW())
      RETURNING id::text
    `;
    const localId = m[0].id;
    try {
      const res = await request(app)
        .post('/api/suggestions')
        .set('X-Test-User-Id', suggesterId)
        .send({
          toUserId: keeperId,
          mosqueId: localId,
          timings: { fajr: '05:00' },
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/time keeper/i);
    } finally {
      await prisma.suggestion.deleteMany({ where: { mosqueId: localId } });
      await prisma.$executeRaw`DELETE FROM mosques WHERE id::text = ${localId}`;
    }
  });
});

describe('GET /api/suggestions/inbox', () => {
  it('rejects unauthenticated', async () => {
    const res = await request(app).get('/api/suggestions/inbox');
    expect(res.status).toBe(401);
  });

  it('returns pending suggestions sent TO the authenticated user', async () => {
    const res = await request(app)
      .get('/api/suggestions/inbox')
      .set('X-Test-User-Id', keeperId);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.suggestions)).toBe(true);
    // At least one — the one we created in the POST test above.
    expect(res.body.suggestions.length).toBeGreaterThanOrEqual(1);

    const s = res.body.suggestions[0];
    expect(s.status).toBe('pending');
    expect(s.toUserId).toBe(keeperId);
    expect(s.fromUser).toBeDefined();
    expect(s.fromUser.fullName).toBe('Test Suggester');
    expect(s.mosque).toBeDefined();
    expect(s.mosque.name).toBe('Suggestion Test Mosque');
  });

  it('includes the mosque\'s current active timings so the UI can show a diff', async () => {
    // Seed an active schedule for our test mosque so the inbox has something
    // to diff against. Use raw SQL because schema has the `location` column.
    await prisma.prayerSchedule.create({
      data: {
        mosqueId,
        timings: { fajr: '04:55', dhuhr: '13:30' },
        verificationStatus: 'pending',
        validFrom: new Date(),
        isActive: true,
      },
    });

    const res = await request(app)
      .get('/api/suggestions/inbox')
      .set('X-Test-User-Id', keeperId);
    expect(res.status).toBe(200);
    const s = res.body.suggestions[0];
    expect(s.currentTimings).toBeDefined();
    // The "current" times on the mosque are what's in the active schedule.
    expect(s.currentTimings.fajr).toBe('04:55');
    expect(s.currentTimings.dhuhr).toBe('13:30');
  });

  it('does NOT return suggestions for other users', async () => {
    const res = await request(app)
      .get('/api/suggestions/inbox')
      .set('X-Test-User-Id', suggesterId);
    expect(res.status).toBe(200);
    // Suggester sent one TO the keeper — they shouldn't see it as their own inbox.
    expect(res.body.suggestions.every((s: any) => s.toUserId === suggesterId)).toBe(true);
  });
});

describe('POST /api/suggestions/:id/accept', () => {
  let suggestionId: string;

  beforeAll(async () => {
    const s = await prisma.suggestion.create({
      data: {
        mosqueId, fromUserId: suggesterId, toUserId: keeperId,
        timings: { fajr: '04:55', dhuhr: '13:25', maghribOffset: 7 },
      },
    });
    suggestionId = s.id;
  });

  it('rejects unauthenticated', async () => {
    const res = await request(app).post(`/api/suggestions/${suggestionId}/accept`);
    expect(res.status).toBe(401);
  });

  it('rejects when caller is not the recipient', async () => {
    const res = await request(app)
      .post(`/api/suggestions/${suggestionId}/accept`)
      .set('X-Test-User-Id', suggesterId); // not the keeper
    expect(res.status).toBe(403);
  });

  it('marks accepted and creates a TimingSubmission as the keeper', async () => {
    const res = await request(app)
      .post(`/api/suggestions/${suggestionId}/accept`)
      .set('X-Test-User-Id', keeperId);
    expect(res.status).toBe(200);
    expect(res.body.suggestion.status).toBe('accepted');
    expect(res.body.suggestion.respondedAt).toBeTruthy();

    // The keeper's submission should now exist with the suggested timings.
    const subs = await prisma.timingSubmission.findMany({
      where: { mosqueId, submittedById: keeperId },
      orderBy: { createdAt: 'desc' },
    });
    expect(subs.length).toBeGreaterThanOrEqual(1);
    const latest = subs[0];
    expect((latest.timings as any).fajr).toBe('04:55');
    expect((latest.timings as any).maghribOffset).toBe(7);
  });

  it('the active prayer schedule reflects the new times right after accept', async () => {
    // Fresh mosque + suggestion targeted at the keeper, accepted by them.
    // After accept the mosque's ACTIVE schedule should carry the suggested
    // values — without that, the keeper accepts but nothing visibly changes.
    const m = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO mosques (name, location, latitude, longitude, city, country, created_at, updated_at)
      VALUES ('Accept-Applies Test', ST_MakePoint(0, 0)::geography, 0, 0, 'X', 'Y', NOW(), NOW())
      RETURNING id::text
    `;
    const localMosqueId = m[0].id;
    await prisma.timingSubmission.create({
      data: { mosqueId: localMosqueId, submittedById: keeperId, timings: { fajr: '05:10' }, status: 'pending' },
    });
    // Seed an existing active schedule so we can prove it gets superseded.
    await prisma.prayerSchedule.create({
      data: {
        mosqueId: localMosqueId,
        timings: { fajr: '05:15' },
        verificationStatus: 'pending',
        validFrom: new Date(),
        isActive: true,
      },
    });

    const sug = await prisma.suggestion.create({
      data: {
        mosqueId: localMosqueId,
        fromUserId: suggesterId,
        toUserId: keeperId,
        timings: { fajr: '05:16', dhuhr: '13:30' },
      },
    });

    const res = await request(app)
      .post(`/api/suggestions/${sug.id}/accept`)
      .set('X-Test-User-Id', keeperId);
    expect(res.status).toBe(200);

    // Fetch the active schedule for this mosque — it must now reflect 05:16.
    const active = await prisma.prayerSchedule.findFirst({
      where: { mosqueId: localMosqueId, isActive: true, deletedAt: null },
      orderBy: { validFrom: 'desc' },
    });
    expect(active).toBeDefined();
    expect((active!.timings as any).fajr).toBe('05:16');
    expect((active!.timings as any).dhuhr).toBe('13:30');

    // Cleanup
    await prisma.timingSubmission.deleteMany({ where: { mosqueId: localMosqueId } });
    await prisma.prayerSchedule.deleteMany({ where: { mosqueId: localMosqueId } });
    await prisma.suggestion.deleteMany({ where: { mosqueId: localMosqueId } });
    await prisma.$executeRaw`DELETE FROM mosques WHERE id::text = ${localMosqueId}`;
  });

  it('returns 404 for a missing suggestion id', async () => {
    const res = await request(app)
      .post('/api/suggestions/00000000-0000-0000-0000-000000000000/accept')
      .set('X-Test-User-Id', keeperId);
    expect(res.status).toBe(404);
  });

  // SECURITY: a stale row targeted at a stranger must not become schedule
  // authority when accepted. Create-time validation rejects this now, but
  // accept enforces the invariant too for rows that predate the check or
  // were inserted outside the route.
  it('rejects accept when recipient has no prior keeper standing', async () => {
    // Fresh mosque with no prior history for either party.
    const m = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO mosques (name, location, latitude, longitude, city, country, created_at, updated_at)
      VALUES ('Stranger-Accept Test', ST_MakePoint(0, 0)::geography, 0, 0, 'X', 'Y', NOW(), NOW())
      RETURNING id::text
    `;
    const localId = m[0].id;
    // Suggester (stranger) sends to keeperId (also stranger to this mosque).
    const sug = await prisma.suggestion.create({
      data: { mosqueId: localId, fromUserId: suggesterId, toUserId: keeperId, timings: { fajr: '04:30' } },
    });
    try {
      const res = await request(app)
        .post(`/api/suggestions/${sug.id}/accept`)
        .set('X-Test-User-Id', keeperId);
      expect(res.status).toBe(403);
      const active = await prisma.prayerSchedule.findFirst({
        where: { mosqueId: localId, isActive: true, deletedAt: null },
        orderBy: { validFrom: 'desc' },
      });
      expect(active).toBeNull();
      const acceptedSubmissions = await prisma.timingSubmission.count({
        where: { mosqueId: localId, submittedById: keeperId },
      });
      expect(acceptedSubmissions).toBe(0);
    } finally {
      await prisma.timingSubmission.deleteMany({ where: { mosqueId: localId } });
      await prisma.prayerSchedule.deleteMany({ where: { mosqueId: localId } });
      await prisma.suggestion.deleteMany({ where: { mosqueId: localId } });
      await prisma.$executeRaw`DELETE FROM mosques WHERE id::text = ${localId}`;
    }
  });

  // Counterpart: when the recipient HAS standing (prior submission or
  // mosque ownership), accept correctly promotes to 'verified'.
  it('schedule from accept is verified when recipient has prior keeper standing', async () => {
    const m = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO mosques (name, location, latitude, longitude, city, country, created_at, updated_at)
      VALUES ('Established-Keeper Accept Test', ST_MakePoint(0, 0)::geography, 0, 0, 'X', 'Y', NOW(), NOW())
      RETURNING id::text
    `;
    const localId = m[0].id;
    // Seed a prior submission so keeperId is an established keeper here.
    await prisma.timingSubmission.create({
      data: { mosqueId: localId, submittedById: keeperId, timings: { fajr: '04:50' }, status: 'pending' },
    });
    const sug = await prisma.suggestion.create({
      data: { mosqueId: localId, fromUserId: suggesterId, toUserId: keeperId, timings: { fajr: '04:55' } },
    });
    try {
      const res = await request(app)
        .post(`/api/suggestions/${sug.id}/accept`)
        .set('X-Test-User-Id', keeperId);
      expect(res.status).toBe(200);
      const active = await prisma.prayerSchedule.findFirst({
        where: { mosqueId: localId, isActive: true, deletedAt: null },
        orderBy: { validFrom: 'desc' },
      });
      expect(active!.verificationStatus).toBe('verified');
      expect(active!.verifiedById).toBe(keeperId);
    } finally {
      await prisma.timingSubmission.deleteMany({ where: { mosqueId: localId } });
      await prisma.prayerSchedule.deleteMany({ where: { mosqueId: localId } });
      await prisma.suggestion.deleteMany({ where: { mosqueId: localId } });
      await prisma.$executeRaw`DELETE FROM mosques WHERE id::text = ${localId}`;
    }
  });
});

describe('POST /api/suggestions/:id/decline', () => {
  let suggestionId: string;

  beforeAll(async () => {
    const s = await prisma.suggestion.create({
      data: {
        mosqueId, fromUserId: suggesterId, toUserId: keeperId,
        timings: { fajr: '06:00' },
      },
    });
    suggestionId = s.id;
  });

  it('rejects when caller is not the recipient', async () => {
    const res = await request(app)
      .post(`/api/suggestions/${suggestionId}/decline`)
      .set('X-Test-User-Id', suggesterId);
    expect(res.status).toBe(403);
  });

  it('marks declined and does NOT create a TimingSubmission', async () => {
    const subsBefore = await prisma.timingSubmission.count({
      where: { mosqueId, submittedById: keeperId },
    });
    const res = await request(app)
      .post(`/api/suggestions/${suggestionId}/decline`)
      .set('X-Test-User-Id', keeperId)
      .send({ note: 'These times are wrong, please re-check' });
    expect(res.status).toBe(200);
    expect(res.body.suggestion.status).toBe('declined');
    expect(res.body.suggestion.respondedNote).toBe('These times are wrong, please re-check');

    const subsAfter = await prisma.timingSubmission.count({
      where: { mosqueId, submittedById: keeperId },
    });
    expect(subsAfter).toBe(subsBefore);
  });
});


// ─────────────────────────────────────────────────────────────────────
// Audit gap: when a keeper accepts a suggestion, the active schedule
// changes — functionally identical to the keeper submitting directly
// via POST /submissions. Followers of this (keeper, masjid) pair must
// be notified on the same FCM topic.
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/suggestions/:id/accept → FCM keeper-update hook', () => {
  it('fires notifyKeeperUpdate with the keeper as submitter after accept', async () => {
    notifySpy.mockClear();
    fcmCalls.length = 0;

    // Fresh mosque + suggestion so we don't entangle with earlier tests
    const m = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO mosques (name, location, latitude, longitude, city, country, created_at, updated_at)
      VALUES ('Suggestion-FCM-Hook Test', ST_MakePoint(0, 0)::geography, 0, 0, 'X', 'Y', NOW(), NOW())
      RETURNING id::text
    `;
    const localMosqueId = m[0].id;
    await prisma.timingSubmission.create({
      data: { mosqueId: localMosqueId, submittedById: keeperId, timings: { isha: '20:30' }, status: 'pending' },
    });
    const sug = await prisma.suggestion.create({
      data: {
        mosqueId: localMosqueId,
        fromUserId: suggesterId,
        toUserId: keeperId,
        timings: { isha: '20:45' },
      },
    });
    try {
      const res = await request(app)
        .post(`/api/suggestions/${sug.id}/accept`)
        .set('X-Test-User-Id', keeperId);
      expect(res.status).toBe(200);
      // Give the fire-and-forget tick to resolve, same pattern as fcmHook.test.ts
      await new Promise(r => setTimeout(r, 30));

      expect(notifySpy).toHaveBeenCalledTimes(1);
      const args = fcmCalls[0];
      // submitterId is the keeper because they own the schedule mutation
      expect(args.submitterId).toBe(keeperId);
      expect(args.mosqueId).toBe(localMosqueId);
      expect(args.timings.isha).toBe('20:45');
      // The hook receives synthetic scheduleChanges so the body summary
      // code path runs — at minimum, isha should appear with to=20:45.
      expect(Array.isArray(args.scheduleChanges)).toBe(true);
      expect(args.scheduleChanges.some((c: any) => c.prayer === 'isha' && c.to === '20:45')).toBe(true);
    } finally {
      await prisma.timingSubmission.deleteMany({ where: { mosqueId: localMosqueId } });
      await prisma.prayerSchedule.deleteMany({ where: { mosqueId: localMosqueId } });
      await prisma.suggestion.deleteMany({ where: { mosqueId: localMosqueId } });
      await prisma.$executeRaw`DELETE FROM mosques WHERE id::text = ${localMosqueId}`;
    }
  });
});


// ─────────────────────────────────────────────────────────────────────
// Audit gap (round 4): the create-suggestion path silently dropped the
// recipient on the floor. The keeper had no way to learn about a new
// suggestion until they happened to open the app — the inbox bell only
// refreshes on init/foreground, not on any server-side event. Now we
// fire notifyOnSuggest to a per-user "suggest-to-<id>" topic so their
// device pings them immediately.
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/suggestions → FCM new-suggestion hook', () => {
  it('fires notifyOnSuggest with the recipient as toUserId', async () => {
    suggestSpy.mockClear();
    suggestCalls.length = 0;

    const m = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO mosques (name, location, latitude, longitude, city, country, created_at, updated_at)
      VALUES ('New-Suggestion-Hook Test', ST_MakePoint(0, 0)::geography, 0, 0, 'X', 'Y', NOW(), NOW())
      RETURNING id::text
    `;
    const localMosqueId = m[0].id;
    await prisma.timingSubmission.create({
      data: { mosqueId: localMosqueId, submittedById: keeperId, timings: { fajr: '04:25' }, status: 'pending' },
    });

    try {
      const res = await request(app)
        .post('/api/suggestions')
        .set('X-Test-User-Id', suggesterId)
        .send({
          toUserId: keeperId,
          mosqueId: localMosqueId,
          timings: { fajr: '04:30', isha: '20:30' },
          notes: 'Got these from the printout in the lobby',
        });
      expect(res.status).toBe(201);
      // Give the fire-and-forget tick to resolve.
      await new Promise(r => setTimeout(r, 40));

      expect(suggestSpy).toHaveBeenCalledTimes(1);
      const args = suggestCalls[0];
      expect(args.toUserId).toBe(keeperId);
      expect(args.mosqueId).toBe(localMosqueId);
      expect(args.suggestionId).toBe(res.body.suggestion.id);
      // fromUserName falls back through fullName -> email -> 'Someone'.
      // 'Test Suggester' is the seed value; either name or email is fine.
      expect(args.fromUserName).toBeTruthy();
      expect(args.mosqueName).toBe('New-Suggestion-Hook Test');
      expect(args.timings.fajr).toBe('04:30');
      expect(args.timings.isha).toBe('20:30');
    } finally {
      await prisma.suggestion.deleteMany({ where: { mosqueId: localMosqueId } });
      await prisma.$executeRaw`DELETE FROM mosques WHERE id::text = ${localMosqueId}`;
    }
  });

  it('does NOT fire notifyOnSuggest when the request is rejected (validation, self-target)', async () => {
    suggestSpy.mockClear();

    // Self-target — the route throws AppError(400) before reaching prisma.create.
    const res = await request(app)
      .post('/api/suggestions')
      .set('X-Test-User-Id', suggesterId)
      .send({
        toUserId: suggesterId, // sending to self
        mosqueId,
        timings: { fajr: '04:30' },
      });
    expect(res.status).toBe(400);
    await new Promise(r => setTimeout(r, 30));
    expect(suggestSpy).not.toHaveBeenCalled();
  });
});
