import { jest } from '@jest/globals';

jest.mock('../lib/fcm', () => ({ notifyKeeperUpdate: jest.fn(async () => ({ topic: 'x', sent: false, reason: 'disabled' })) }));

import request from 'supertest';
import app from '../index';
import { prisma } from '../lib/prisma';

const stamp = Date.now();
const KEEPER_EMAIL = `withdraw-keeper-${stamp}@local`;
const FOLLOWER_EMAIL = `withdraw-follower-${stamp}@local`;
const REPLACEMENT_EMAIL = `withdraw-replacement-${stamp}@local`;

let keeperId: string;
let followerId: string;
let replacementId: string;
let mosqueId: string;

beforeAll(async () => {
  const [keeper, follower, replacement] = await Promise.all([
    prisma.user.create({ data: { email: KEEPER_EMAIL, fullName: 'Withdraw Keeper' } }),
    prisma.user.create({ data: { email: FOLLOWER_EMAIL, fullName: 'Follower' } }),
    prisma.user.create({ data: { email: REPLACEMENT_EMAIL, fullName: 'Replacement Keeper' } }),
  ]);
  keeperId = keeper.id;
  followerId = follower.id;
  replacementId = replacement.id;

  const m = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO mosques (name, location, latitude, longitude, city, country, created_at, updated_at)
    VALUES ('Withdraw Keeper Test', ST_MakePoint(0, 0)::geography, 0, 0, 'X', 'Y', NOW(), NOW())
    RETURNING id::text
  `;
  mosqueId = m[0].id;

  await prisma.prayerSchedule.createMany({
    data: [
      {
        mosqueId,
        submittedById: keeperId,
        timings: { fajr: '05:00', dhuhr: '13:30', asr: '17:00', isha: '20:30', jummah: ['13:30'] },
        verificationStatus: 'verified',
        validFrom: new Date(),
        isActive: true,
      },
      {
        mosqueId,
        submittedById: replacementId,
        timings: { fajr: '05:15', dhuhr: '13:30', asr: '17:10', isha: '20:45', jummah: ['13:30'] },
        verificationStatus: 'verified',
        validFrom: new Date(),
        isActive: false,
      },
    ],
  });
  await prisma.timingSubmission.create({
    data: {
      mosqueId,
      submittedById: keeperId,
      timings: { fajr: '05:00', dhuhr: '13:30' },
      status: 'pending',
    },
  });
  await prisma.user.update({
    where: { id: followerId },
    data: { notificationPreferences: { preferredKeepers: { [mosqueId]: keeperId } } as any },
  });
});

afterAll(async () => {
  await prisma.timingSubmission.deleteMany({ where: { mosqueId } });
  await prisma.prayerSchedule.deleteMany({ where: { mosqueId } });
  await prisma.activityLog.deleteMany({ where: { entityId: mosqueId } });
  await prisma.user.deleteMany({ where: { email: { in: [KEEPER_EMAIL, FOLLOWER_EMAIL, REPLACEMENT_EMAIL] } } });
  await prisma.$executeRaw`DELETE FROM mosques WHERE id::text = ${mosqueId}`;
  await prisma.$disconnect();
});

describe('POST /api/mosques/:id/keepers/me/withdraw', () => {
  it('withdraws the signed-in keeper and clears followers for that masjid', async () => {
    const res = await request(app)
      .post(`/api/mosques/${mosqueId}/keepers/me/withdraw`)
      .set('X-Test-User-Id', keeperId)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.withdrawn).toBe(true);
    expect(res.body.withdrawnSchedules).toBe(1);
    expect(res.body.withdrawnSubmissions).toBe(1);
    expect(res.body.replacementKeeperId).toBe(replacementId);

    const follower = await prisma.user.findUnique({
      where: { id: followerId },
      select: { notificationPreferences: true },
    });
    expect((follower!.notificationPreferences as any).preferredKeepers?.[mosqueId]).toBeUndefined();

    const submission = await prisma.timingSubmission.findFirst({
      where: { mosqueId, submittedById: keeperId },
      select: { status: true },
    });
    expect(submission?.status).toBe('withdrawn');

    const active = await prisma.prayerSchedule.findFirst({
      where: { mosqueId, isActive: true, deletedAt: null },
      select: { submittedById: true },
    });
    expect(active?.submittedById).toBe(replacementId);

    const keepersRes = await request(app).get(`/api/mosques/${mosqueId}/keepers`);
    expect(keepersRes.status).toBe(200);
    expect(keepersRes.body.keepers.some((k: any) => k.submitterId === keeperId)).toBe(false);
    expect(keepersRes.body.keepers.some((k: any) => k.submitterId === replacementId)).toBe(true);
  });
});
