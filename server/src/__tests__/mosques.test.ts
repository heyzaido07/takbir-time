import request from 'supertest';
import app from '../index';
import { prisma } from '../lib/prisma';

describe('GET /api/mosques/nearby - validation', () => {
  it('rejects missing lat/lng with 400', async () => {
    const res = await request(app).get('/api/mosques/nearby');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation Error');
  });

  it('rejects out-of-range latitude', async () => {
    const res = await request(app).get('/api/mosques/nearby?lat=200&lng=10');
    expect(res.status).toBe(400);
  });

  it('rejects out-of-range radius', async () => {
    const res = await request(app).get('/api/mosques/nearby?lat=0&lng=0&radius=999999');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/mosques - auth', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app)
      .post('/api/mosques')
      .send({ name: 'Test', latitude: 0, longitude: 0, city: 'X', country: 'Y' });
    expect(res.status).toBe(401);
  });
});

describe('POST/PUT /api/mosques - captcha and creator edits', () => {
  const stamp = Date.now();
  const creatorEmail = `mosque-creator-${stamp}@local`;
  const strangerEmail = `mosque-stranger-${stamp}@local`;
  let creatorId: string;
  let strangerId: string;
  let mosqueId: string | undefined;

  function solve(question: string) {
    const match = question.match(/(\d+)\s*([+x])\s*(\d+)/i);
    if (!match) throw new Error(`Unexpected captcha question: ${question}`);
    const a = Number(match[1]);
    const b = Number(match[3]);
    return match[2].toLowerCase() === 'x' ? String(a * b) : String(a + b);
  }

  beforeAll(async () => {
    const [creator, stranger] = await Promise.all([
      prisma.user.create({ data: { email: creatorEmail, fullName: 'Mosque Creator' } }),
      prisma.user.create({ data: { email: strangerEmail, fullName: 'Mosque Stranger' } }),
    ]);
    creatorId = creator.id;
    strangerId = stranger.id;
  });

  afterAll(async () => {
    if (mosqueId) {
      await prisma.userFavorite.deleteMany({ where: { mosqueId } });
      await prisma.timingSubmission.deleteMany({ where: { mosqueId } });
      await prisma.prayerSchedule.deleteMany({ where: { mosqueId } });
      await prisma.$executeRaw`DELETE FROM mosques WHERE id::text = ${mosqueId}`;
    }
    await prisma.user.deleteMany({ where: { email: { in: [creatorEmail, strangerEmail] } } });
    await prisma.$disconnect();
  });

  it('issues a captcha challenge for the add-masjid form', async () => {
    const res = await request(app).get('/api/mosques/captcha');
    expect(res.status).toBe(200);
    expect(res.body.id).toBeTruthy();
    expect(res.body.question).toMatch(/What is \d+ ([+x]) \d+\?/);
  });

  it('rejects authenticated creation without a solved human check', async () => {
    const res = await request(app)
      .post('/api/mosques')
      .set('X-Test-User-Id', creatorId)
      .send({ name: 'Captcha Missing Mosque', latitude: 0, longitude: 0, city: 'X', country: 'Y' });
    expect(res.status).toBe(400);
  });

  it('creates a mosque with a solved captcha and only lets the creator edit it', async () => {
    const challenge = await request(app).get('/api/mosques/captcha');
    const create = await request(app)
      .post('/api/mosques')
      .set('X-Test-User-Id', creatorId)
      .send({
        name: 'Creator Edit Test Mosque',
        latitude: 0,
        longitude: 0,
        city: 'X',
        country: 'Y',
        captcha: { id: challenge.body.id, answer: solve(challenge.body.question) },
      });
    expect(create.status).toBe(201);
    mosqueId = create.body.id;
    expect(create.body.canEdit).toBe(true);

    const strangerEdit = await request(app)
      .put(`/api/mosques/${mosqueId}`)
      .set('X-Test-User-Id', strangerId)
      .send({ name: 'Bad Rename' });
    expect(strangerEdit.status).toBe(403);

    const creatorEdit = await request(app)
      .put(`/api/mosques/${mosqueId}`)
      .set('X-Test-User-Id', creatorId)
      .send({ name: 'Creator Renamed Mosque', city: 'Islamabad', country: 'Pakistan' });
    expect(creatorEdit.status).toBe(200);
    expect(creatorEdit.body.name).toBe('Creator Renamed Mosque');
    expect(creatorEdit.body.canEdit).toBe(true);
  });
});

describe('POST /api/mosques/:id/favorite - auth', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).post('/api/mosques/00000000-0000-0000-0000-000000000000/favorite');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/mosques/:id/keepers', () => {
  // Self-contained fixture (don't depend on a hardcoded production mosque
  // id, which doesn't exist in a fresh/CI database): a contributor with a
  // recent, non-rejected timing submission is what rankedKeepersForMosque
  // surfaces as a keeper.
  const stamp = Date.now();
  const keeperEmail = `keepers-contributor-${stamp}@local`;
  let keeperContributorId: string;
  let keepersMosqueId: string;

  beforeAll(async () => {
    const contributor = await prisma.user.create({
      data: { email: keeperEmail, fullName: 'Keepers Contributor', reputationPoints: 50 },
    });
    keeperContributorId = contributor.id;

    const mosque = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO mosques (name, location, latitude, longitude, city, country, created_at, updated_at)
      VALUES ('Keepers Fixture Mosque', ST_MakePoint(0, 0)::geography, 0, 0, 'X', 'Y', NOW(), NOW())
      RETURNING id::text
    `;
    keepersMosqueId = mosque[0].id;

    await prisma.timingSubmission.create({
      data: {
        mosqueId: keepersMosqueId,
        submittedById: keeperContributorId,
        timings: { fajr: '05:10', dhuhr: '13:15', asr: '16:45', isha: '20:15', maghribOffset: 5 },
        status: 'pending',
      },
    });
  });

  afterAll(async () => {
    if (keepersMosqueId) {
      await prisma.timingSubmission.deleteMany({ where: { mosqueId: keepersMosqueId } });
      await prisma.prayerSchedule.deleteMany({ where: { mosqueId: keepersMosqueId } });
      await prisma.$executeRaw`DELETE FROM mosques WHERE id::text = ${keepersMosqueId}`;
    }
    await prisma.user.deleteMany({ where: { email: keeperEmail } });
  });

  it('returns 404 for an unknown mosque id', async () => {
    const res = await request(app).get('/api/mosques/00000000-0000-0000-0000-000000000000/keepers');
    expect(res.status).toBe(404);
  });

  it('returns 200 with a ranked keeper array for a known mosque', async () => {
    const res = await request(app).get(`/api/mosques/${keepersMosqueId}/keepers`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.keepers)).toBe(true);
    expect(res.body.keepers.length).toBeGreaterThanOrEqual(1);
    const top = res.body.keepers[0];
    expect(top).toHaveProperty('submitterId');
    expect(top).toHaveProperty('submitterName');
    expect(top).toHaveProperty('rating');
    expect(top).toHaveProperty('timings');
    expect(top).toHaveProperty('submissionCount');
  });
});

describe('GET /api/mosques/:id/consensus', () => {
  const stamp = Date.now();
  const contributorEmail = `consensus-contributor-${stamp}@local`;
  let contributorId: string;
  let consensusMosqueId: string;

  beforeAll(async () => {
    const contributor = await prisma.user.create({
      data: {
        email: contributorEmail,
        fullName: 'Consensus Contributor',
        reputationPoints: 100,
      },
    });
    contributorId = contributor.id;

    const mosque = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO mosques (name, location, latitude, longitude, city, country, created_at, updated_at)
      VALUES ('Consensus Fixture Mosque', ST_MakePoint(0, 0)::geography, 0, 0, 'X', 'Y', NOW(), NOW())
      RETURNING id::text
    `;
    consensusMosqueId = mosque[0].id;

    await prisma.timingSubmission.create({
      data: {
        mosqueId: consensusMosqueId,
        submittedById: contributorId,
        timings: { fajr: '04:50', dhuhr: '13:30', asr: '17:00', isha: '20:30', maghribOffset: 5 },
        status: 'pending',
      },
    });
  });

  afterAll(async () => {
    if (consensusMosqueId) {
      await prisma.timingSubmission.deleteMany({ where: { mosqueId: consensusMosqueId } });
      await prisma.prayerSchedule.deleteMany({ where: { mosqueId: consensusMosqueId } });
      await prisma.$executeRaw`DELETE FROM mosques WHERE id::text = ${consensusMosqueId}`;
    }
    await prisma.user.deleteMany({ where: { email: contributorEmail } });
    await prisma.$disconnect();
  });

  it('returns 404 for an unknown mosque id', async () => {
    const res = await request(app).get('/api/mosques/00000000-0000-0000-0000-000000000000/consensus');
    expect(res.status).toBe(404);
  });

  it('returns 200 with a per-prayer consensus object for a known mosque', async () => {
    const res = await request(app).get(`/api/mosques/${consensusMosqueId}/consensus`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('mosqueId', consensusMosqueId);
    expect(res.body.consensus).toBeDefined();
    // Each prayer key returns a {time, confidence, contributors, supportCount} or null
    for (const prayer of ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha', 'jummah']) {
      const c = res.body.consensus[prayer];
      if (c) {
        expect(c).toHaveProperty('time');
        expect(c).toHaveProperty('confidence');
        expect(c).toHaveProperty('contributors');
        expect(c).toHaveProperty('supportCount');
      }
    }
  });

  it('returns at least the fajr time for a mosque with a submission', async () => {
    const res = await request(app).get(`/api/mosques/${consensusMosqueId}/consensus`);
    expect(res.status).toBe(200);
    expect(res.body.consensus.fajr).toBeTruthy();
    expect(res.body.consensus.fajr.time).toBe('04:50');
    expect(res.body.consensus.fajr.contributors).toBeGreaterThanOrEqual(1);
  });
});
