process.env.ADMIN_EMAIL = `overviewtest-admin-${Date.now()}@fixture.dev`;

const request = require('supertest');
const app = require('../index').default;
const { prisma } = require('../lib/prisma');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL!;
const STRANGER_EMAIL = `overviewtest-stranger-${Date.now()}@fixture.dev`;
const ACTIVE_EMAIL = `overviewtest-active-${Date.now()}@fixture.dev`;
const NEW_EMAIL = `overviewtest-new-${Date.now()}@fixture.dev`;
const GOOGLE_EMAIL = `overviewtest-google-${Date.now()}@fixture.dev`;
const SUBMITTER_EMAIL = `overviewtest-submitter-${Date.now()}@fixture.dev`;
const DATE = '2026-01-15';
const inside = new Date('2026-01-15T10:00:00.000Z');

let adminId: string;
let strangerId: string;
let activeId: string;
let newUserId: string;
let googleId: string;
let submitterId: string;
let mosqueId: string;
const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;

if (process.env.DATABASE_URL) beforeAll(async () => {
  const [admin, stranger, active, newUser, googleUser, submitter] = await Promise.all([
    prisma.user.create({ data: { email: ADMIN_EMAIL, fullName: 'Junaid Admin' } }),
    prisma.user.create({ data: { email: STRANGER_EMAIL, fullName: 'Stranger' } }),
    prisma.user.create({
      data: { email: ACTIVE_EMAIL, fullName: 'Active User', lastLoginAt: inside },
    }),
    prisma.user.create({
      data: { email: NEW_EMAIL, firebaseUid: `google-created-${Date.now()}`, fullName: 'New User', createdAt: inside, lastLoginAt: inside },
    }),
    prisma.user.create({
      data: {
        email: GOOGLE_EMAIL,
        firebaseUid: `google-login-${Date.now()}`,
        fullName: 'Google User',
        createdAt: new Date('2026-01-10T10:00:00.000Z'),
        lastLoginAt: inside,
      },
    }),
    prisma.user.create({ data: { email: SUBMITTER_EMAIL, fullName: 'Submitter' } }),
  ]);
  adminId = admin.id;
  strangerId = stranger.id;
  activeId = active.id;
  newUserId = newUser.id;
  googleId = googleUser.id;
  submitterId = submitter.id;

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO mosques (name, location, latitude, longitude, city, country, created_at, updated_at)
    VALUES (
      'Admin Overview Masjid',
      ST_MakePoint(74.3587, 31.5204)::geography,
      31.5204,
      74.3587,
      'Lahore',
      'Pakistan',
      ${inside},
      ${inside}
    )
    RETURNING id
  `;
  mosqueId = rows[0].id;

  await prisma.activityLog.createMany({
    data: [
      {
        userId: activeId,
        activityType: 'authenticated_request',
        metadata: { path: '/api/users/me' },
        createdAt: inside,
      },
      {
        userId: activeId,
        activityType: 'nearby_search',
        metadata: { lat: 31.5204, lng: 74.3587, radius: 25000 },
        createdAt: new Date('2026-01-15T11:00:00.000Z'),
      },
      {
        userId: newUserId,
        activityType: 'auth_google_created',
        metadata: { provider: 'google', referer: 'https://www.google.com/search?q=find+jumma+near+me' },
        createdAt: inside,
      },
      {
        userId: googleId,
        activityType: 'auth_google_login',
        metadata: { provider: 'google' },
        createdAt: new Date('2026-01-15T12:00:00.000Z'),
      },
    ],
  });

  await prisma.timingSubmission.create({
    data: {
      mosqueId,
      submittedById: submitterId,
      timings: { fajr: '05:10', dhuhr: '13:20', jummah: ['13:30'] },
      status: 'pending',
      createdAt: inside,
    },
  });
});

if (process.env.DATABASE_URL) afterAll(async () => {
  const userIds = [adminId, strangerId, activeId, newUserId, googleId, submitterId].filter(Boolean);
  if (mosqueId) await prisma.timingSubmission.deleteMany({ where: { mosqueId } });
  if (userIds.length) await prisma.activityLog.deleteMany({ where: { userId: { in: userIds } } });
  if (mosqueId) await prisma.mosque.deleteMany({ where: { id: mosqueId } });
  await prisma.user.deleteMany({ where: { email: { in: [ADMIN_EMAIL, STRANGER_EMAIL, ACTIVE_EMAIL, NEW_EMAIL, GOOGLE_EMAIL, SUBMITTER_EMAIL] } } });
  await prisma.$disconnect();
});

describeWithDatabase('GET /api/admin/overview', () => {
  it('requires authentication', async () => {
    const res = await request(app).get(`/api/admin/overview?startDate=${DATE}&endDate=${DATE}`);
    expect(res.status).toBe(401);
  });

  it('hides the endpoint when ADMIN_EMAIL is not configured', async () => {
    const prior = process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_EMAIL;
    let res;
    try {
      res = await request(app)
        .get(`/api/admin/overview?startDate=${DATE}&endDate=${DATE}`)
        .set('X-Test-User-Id', adminId);
    } finally {
      process.env.ADMIN_EMAIL = prior;
    }
    expect(res.status).toBe(404);
  });

  it('hides the endpoint from non-admin users', async () => {
    const res = await request(app)
      .get(`/api/admin/overview?startDate=${DATE}&endDate=${DATE}`)
      .set('X-Test-User-Id', strangerId);
    expect(res.status).toBe(404);
  });

  it('returns usage, signup, geo, and timing-submission stats to the configured admin', async () => {
    const res = await request(app)
      .get(`/api/admin/overview?startDate=${DATE}&endDate=${DATE}&tzOffsetMinutes=0`)
      .set('X-Test-User-Id', adminId);

    expect(res.status).toBe(200);
    expect(res.body.range.startDate).toBe(DATE);
    expect(res.body.range.endDate).toBe(DATE);
    expect(res.body.range.days).toBe(1);
    expect(res.body.summary.activeUsers).toBeGreaterThanOrEqual(2);
    expect(res.body.summary.newSignups).toBe(1);
    expect(res.body.summary.googleUsers).toBe(2);
    expect(res.body.summary.googleSignIns).toBe(2);
    expect(res.body.summary.masjidsWithTimesAdded).toBe(1);
    expect(res.body.summary.timingSubmissions).toBe(1);
    expect(res.body.summary.acquisitionSources).toContainEqual({ source: 'google', count: 1 });

    const active = res.body.activeUsers.find((u: any) => u.email === ACTIVE_EMAIL);
    expect(active.location.source).toBe('last_nearby_search');
    expect(active.location.lat).toBe(31.5204);
    expect(active.location.mapsUrl).toContain('google.com/maps');

    const signup = res.body.newSignups[0];
    expect(signup.email).toBe(NEW_EMAIL);
    expect(signup.acquisitionSource).toBe('google');
    expect(signup.authProvider).toBe('google');

    const google = res.body.googleUsers.find((u: any) => u.email === GOOGLE_EMAIL);
    expect(google.lastActivityType).toBe('auth_google_login');
    expect(google.authProvider).toBe('google');
    expect(google.googleSignInCount).toBe(1);

    const masjid = res.body.mosquesWithTimes[0];
    expect(masjid.mosque.name).toBe('Admin Overview Masjid');
    expect(masjid.submissionCount).toBe(1);
    expect(masjid.submissions[0].timings.fajr).toBe('05:10');
  });
});
