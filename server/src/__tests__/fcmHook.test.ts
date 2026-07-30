// Integration: POST /api/submissions fires the FCM keeper-update hook
// after responding 201 — fire-and-forget, never blocking the response.
//
// Strategy: jest.mock the fcm module so the route's import resolves to a
// spy. Submit a timing, assert the spy was called with the right keeper +
// masjid + scheduleChanges. Also assert the response went out before the
// hook resolved (the response is what the user feels — FCM should never
// block it).

import { jest } from '@jest/globals';

// Spy on notifyKeeperUpdate. The factory must return a thenable so the
// route's `.then(...).catch(...)` chain doesn't break.
const fcmCalls: any[] = [];
let fcmDelay = 0;
const notifySpy = jest.fn(async (args: any) => {
  fcmCalls.push(args);
  if (fcmDelay) await new Promise(r => setTimeout(r, fcmDelay));
});
jest.mock('../lib/fcm', () => ({
  notifyKeeperUpdate: notifySpy,
}));

import request from 'supertest';
import app from '../index';
import { prisma } from '../lib/prisma';

let userId: string;
let mosqueId: string;
const EMAIL = `fcm-hook-${Date.now()}@local`;

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: EMAIL, fullName: 'FCM Hook Tester' },
  });
  userId = u.id;
  const m = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO mosques (name, location, latitude, longitude, city, country, created_at, updated_at)
    VALUES ('FCM Hook Test Mosque', ST_MakePoint(0, 0)::geography, 0, 0, 'X', 'Y', NOW(), NOW())
    RETURNING id::text
  `;
  mosqueId = m[0].id;
});

afterAll(async () => {
  await prisma.timingSubmission.deleteMany({ where: { submittedById: userId } });
  await prisma.prayerSchedule.deleteMany({ where: { mosqueId } });
  await prisma.$executeRaw`DELETE FROM mosques WHERE id::text = ${mosqueId}`;
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  await prisma.$disconnect();
});

beforeEach(() => {
  fcmCalls.length = 0;
  notifySpy.mockClear();
  fcmDelay = 0;
});

describe('POST /api/submissions → FCM keeper-update hook', () => {
  it('fires notifyKeeperUpdate with the submitter as keeper after the 201 response', async () => {
    const res = await request(app)
      .post('/api/submissions')
      .set('X-Test-User-Id', userId)
      .send({ mosqueId, timings: { fajr: '05:30', isha: '20:45' } });

    expect(res.status).toBe(201);
    // Give the fire-and-forget Promise.all chain a tick to resolve.
    await new Promise(r => setTimeout(r, 30));

    expect(notifySpy).toHaveBeenCalledTimes(1);
    const args = fcmCalls[0];
    expect(args.mosqueId).toBe(mosqueId);
    expect(args.submitterId).toBe(userId);
    expect(args.submissionId).toBe(res.body.submission.id);
    expect(args.keeperName).toBe('FCM Hook Tester');
    expect(args.mosqueName).toBe('FCM Hook Test Mosque');
    expect(args.timings.fajr).toBe('05:30');
    expect(Array.isArray(args.scheduleChanges)).toBe(true);
  });

  it('responds 201 before the slow notifyKeeperUpdate resolves (fire-and-forget)', async () => {
    // Behavior-based and machine-speed independent: the hook flips
    // `fcmResolved` only after a delay measured from when the hook STARTS
    // (i.e. after res.json). A fire-and-forget route returns 201 while the
    // hook is still pending; a blocking route would only return after it
    // resolved. (The old absolute-ms threshold was flaky on slow CI/dev
    // machines where the route's own DB work alone exceeds the bound.)
    let fcmResolved = false;
    notifySpy.mockImplementationOnce(async (args: any) => {
      fcmCalls.push(args);
      await new Promise(r => setTimeout(r, 300));
      fcmResolved = true;
    });

    const res = await request(app)
      .post('/api/submissions')
      .set('X-Test-User-Id', userId)
      .send({ mosqueId, timings: { fajr: '05:31' } });

    expect(res.status).toBe(201);
    expect(fcmResolved).toBe(false); // response went out before the hook finished

    // Let the fire-and-forget hook settle so its timer doesn't leak.
    await new Promise(r => setTimeout(r, 350));
    expect(fcmResolved).toBe(true);
  });

  it('responds 201 even when notifyKeeperUpdate throws', async () => {
    notifySpy.mockImplementationOnce(async () => { throw new Error('FCM down'); });
    const res = await request(app)
      .post('/api/submissions')
      .set('X-Test-User-Id', userId)
      .send({ mosqueId, timings: { fajr: '05:32' } });
    expect(res.status).toBe(201);
    // No unhandled-rejection — the test passing is the proof.
  });
});

// ─────────────────────────────────────────────────────────────────────
// Robustness — what if the user or mosque vanishes between submission
// creation and the FCM hook's lookup? The hook runs after res.json so
// the user has already been told their submission succeeded. The push
// path must not crash and must fall back to generic copy.
// ─────────────────────────────────────────────────────────────────────

import { prisma as prismaForRobust } from '../lib/prisma';

describe('POST /api/submissions → FCM hook robustness', () => {
it('falls back to email when fullName is null but email exists', async () => {
    // User with no fullName, only email
    const u2 = await prismaForRobust.user.create({
      data: { email: `no-name-${Date.now()}@local`, fullName: null },
    });
    try {
      const res = await request(app)
        .post('/api/submissions')
        .set('X-Test-User-Id', u2.id)
        .send({ mosqueId, timings: { fajr: '05:34' } });
      expect(res.status).toBe(201);
      await new Promise(r => setTimeout(r, 50));

      const args = fcmCalls[fcmCalls.length - 1];
      expect(args.keeperName).toBe(u2.email);
    } finally {
      await prismaForRobust.timingSubmission.deleteMany({ where: { submittedById: u2.id } });
      await prismaForRobust.user.delete({ where: { id: u2.id } });
    }
  });
});
