import request from 'supertest';
import app from '../index';
import { prisma } from '../lib/prisma';

const EMAIL = `qaza-${Date.now()}@local`;
const OTHER_EMAIL = `qaza-other-${Date.now()}@local`;
let userId: string;
let otherUserId: string;

beforeAll(async () => {
  const [user, otherUser] = await Promise.all([
    prisma.user.create({ data: { email: EMAIL, fullName: 'Qaza User' } }),
    prisma.user.create({ data: { email: OTHER_EMAIL, fullName: 'Other Qaza User' } }),
  ]);
  userId = user.id;
  otherUserId = otherUser.id;
});

afterAll(async () => {
  const ids = [userId, otherUserId].filter(Boolean);
  if (ids.length) {
    await prisma.qazaRecord.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.$disconnect();
});

describe('Qaza records API', () => {
  beforeEach(async () => {
    const ids = [userId, otherUserId].filter(Boolean);
    if (ids.length) await prisma.qazaRecord.deleteMany({ where: { userId: { in: ids } } });
  });

  it('requires auth', async () => {
    const res = await request(app).get('/api/qaza');
    expect(res.status).toBe(401);
  });

  it('validates prayer and date input', async () => {
    const res = await request(app)
      .post('/api/qaza')
      .set('X-Test-User-Id', userId)
      .send({ date: 'not-a-date', prayer: 'sunrise' });
    expect(res.status).toBe(400);
  });

  it('creates and lists only the authenticated user records', async () => {
    const createRes = await request(app)
      .post('/api/qaza')
      .set('X-Test-User-Id', userId)
      .send({ date: '2026-05-26', prayer: 'fajr', clientId: 'local-fajr' });
    expect(createRes.status).toBe(201);
    expect(createRes.body.record.date).toBe('2026-05-26');
    expect(createRes.body.record.prayer).toBe('fajr');

    await request(app)
      .post('/api/qaza')
      .set('X-Test-User-Id', otherUserId)
      .send({ date: '2026-05-26', prayer: 'isha', clientId: 'other-isha' });

    const listRes = await request(app)
      .get('/api/qaza')
      .set('X-Test-User-Id', userId);
    expect(listRes.status).toBe(200);
    expect(listRes.body.records).toHaveLength(1);
    expect(listRes.body.records[0].clientId).toBe('local-fajr');
  });

  it('does not duplicate repeated sync of the same local record', async () => {
    const body = { date: '2026-05-26', prayer: 'dhuhr', clientId: 'same-local-id' };
    const first = await request(app).post('/api/qaza').set('X-Test-User-Id', userId).send(body);
    const second = await request(app).post('/api/qaza').set('X-Test-User-Id', userId).send(body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.alreadyExists).toBe(true);

    const count = await prisma.qazaRecord.count({ where: { userId, clientId: 'same-local-id' } });
    expect(count).toBe(1);
  });

  it('marks a record prayed and removes it from the open list', async () => {
    const created = await request(app)
      .post('/api/qaza')
      .set('X-Test-User-Id', userId)
      .send({ date: '2026-05-26', prayer: 'asr', clientId: 'asr-local' });

    const mark = await request(app)
      .patch(`/api/qaza/${created.body.record.id}/prayed`)
      .set('X-Test-User-Id', userId)
      .send({ prayedAt: '2026-05-26T18:00:00.000Z' });
    expect(mark.status).toBe(200);
    expect(mark.body.record.prayedAt).toBe('2026-05-26T18:00:00.000Z');

    const open = await request(app).get('/api/qaza').set('X-Test-User-Id', userId);
    expect(open.body.records).toHaveLength(0);

    const all = await request(app).get('/api/qaza?status=all').set('X-Test-User-Id', userId);
    expect(all.body.records).toHaveLength(1);
  });
});
