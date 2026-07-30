import { jest } from '@jest/globals';

jest.mock('../lib/fcm', () => ({
  notifyKeeperUpdate: jest.fn(async () => ({ topic: 'mock', sent: false, reason: 'disabled' as const })),
}));

import request from 'supertest';
import app from '../index';
import { prisma } from '../lib/prisma';

describe('POST /api/submissions active schedule promotion', () => {
  let keeperId: string;
  let otherId: string;
  let mosqueId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    const [keeper, other] = await Promise.all([
      prisma.user.create({ data: { email: `keeper-schedule-${suffix}@local`, fullName: 'Schedule Keeper' } }),
      prisma.user.create({ data: { email: `other-schedule-${suffix}@local`, fullName: 'Other Contributor' } }),
    ]);
    keeperId = keeper.id;
    otherId = other.id;
    const m = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO mosques (name, location, latitude, longitude, city, country, created_at, updated_at)
      VALUES ('Submission Schedule Promotion Test', ST_MakePoint(0, 0)::geography, 0, 0, 'X', 'Y', NOW(), NOW())
      RETURNING id::text
    `;
    mosqueId = m[0].id;
  });

  beforeEach(async () => {
    await prisma.timingSubmission.deleteMany({ where: { mosqueId } });
    await prisma.prayerSchedule.deleteMany({ where: { mosqueId } });
    await prisma.prayerSchedule.create({
      data: {
        mosqueId,
        submittedById: keeperId,
        verifiedById: keeperId,
        verificationStatus: 'verified',
        validFrom: new Date('2026-05-22T00:00:00Z'),
        isActive: true,
        timings: {
          fajr: '04:30',
          dhuhr: '13:30',
          asr: '17:30',
          isha: '21:15',
          jummah: ['13:30'],
          maghribOffset: 3,
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.timingSubmission.deleteMany({ where: { mosqueId } });
    await prisma.prayerSchedule.deleteMany({ where: { mosqueId } });
    await prisma.$executeRaw`DELETE FROM mosques WHERE id::text = ${mosqueId}`;
    await prisma.user.deleteMany({ where: { id: { in: [keeperId, otherId] } } });
    await prisma.$disconnect();
  });

  it('current keeper update changes the canonical active schedule for everyone', async () => {
    const res = await request(app)
      .post('/api/submissions')
      .set('X-Test-User-Id', keeperId)
      .send({ mosqueId, timings: { isha: '21:25' } });

    expect(res.status).toBe(201);
    expect(res.body.scheduleChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ prayer: 'isha', from: '21:15', to: '21:25' }),
    ]));

    const active = await prisma.prayerSchedule.findMany({
      where: { mosqueId, isActive: true, deletedAt: null },
      orderBy: { validFrom: 'desc' },
    });
    expect(active).toHaveLength(1);
    expect(active[0].submittedById).toBe(keeperId);
    expect(active[0].verificationStatus).toBe('verified');
    expect((active[0].timings as any).isha).toBe('21:25');
    expect((active[0].timings as any).fajr).toBe('04:30');
    expect((active[0].timings as any).jummah).toEqual(['13:30']);
  });

  it('a lone non-keeper submission does not overwrite a verified active schedule', async () => {
    const res = await request(app)
      .post('/api/submissions')
      .set('X-Test-User-Id', otherId)
      .send({ mosqueId, timings: { isha: '21:45' } });

    expect(res.status).toBe(201);

    const active = await prisma.prayerSchedule.findFirst({
      where: { mosqueId, isActive: true, deletedAt: null },
      orderBy: { validFrom: 'desc' },
    });
    expect((active!.timings as any).isha).toBe('21:15');
    expect(active!.submittedById).toBe(keeperId);
  });
});
