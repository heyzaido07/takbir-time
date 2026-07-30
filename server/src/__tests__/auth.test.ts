// Tests for /api/auth — register, login, google sign-in.
//
// Strategy: hit the real Express app via supertest, real Postgres
// (test setup forces FCM_ENABLED=false so no actual push). For the
// /google branch we mock firebase-admin's verifyIdToken since we
// can't generate a real signed Firebase token in unit tests.

import { jest } from '@jest/globals';

// Mock firebase-admin BEFORE importing the app (which imports auth.ts
// which imports firebase-admin). The mock must satisfy both:
//   - middleware/auth.ts does `if (!admin.apps.length)` and reads creds
//   - routes/auth.ts uses `admin.auth().verifyIdToken(...)`
const mockVerifyIdToken = jest.fn<(t: string) => Promise<any>>();
jest.mock('firebase-admin', () => {
  const auth = () => ({ verifyIdToken: mockVerifyIdToken });
  return {
    __esModule: true,
    default: {
      apps: [{ name: 'mock-app' }],
      auth,
      messaging: () => ({ send: jest.fn() }),
      initializeApp: jest.fn(),
      credential: { cert: jest.fn() },
    },
    auth,
  };
});

import request from 'supertest';
import { prisma } from '../lib/prisma';

// JWT_SECRET is required by the routes; set before importing app.
process.env.JWT_SECRET = 'test-jwt-secret-must-be-at-least-32-chars-long-xyz';
import app from '../index';

const STAMP = Date.now();
const NEW_EMAIL = `auth-newuser-${STAMP}@local.test`;
const EXISTING_EMAIL = `auth-existing-${STAMP}@local.test`;
const GOOGLE_EMAIL = `auth-google-${STAMP}@local.test`;
const GOOGLE_UID = `google-uid-${STAMP}`;
const PASSWORD = 'sup3r-secret-pw';

beforeAll(async () => {
  // Pre-create one user so we can test the "already exists" + login paths.
  // NB: no passwordHash yet → first /register against this email is the
  // "claim existing account" branch.
  await prisma.user.create({
    data: { email: EXISTING_EMAIL, fullName: 'Existing No-Password' },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({
    where: { email: { in: [NEW_EMAIL, EXISTING_EMAIL, GOOGLE_EMAIL] } },
  });
  await prisma.$disconnect();
});

describe('POST /api/auth/register', () => {
  it('creates a new user and returns a token', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: NEW_EMAIL,
      password: PASSWORD,
      fullName: 'New User',
    });
    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/); // 3-part JWT
    expect(res.body.user.email).toBe(NEW_EMAIL);
    expect(res.body.user.fullName).toBe('New User');
    expect(res.body.user.id).toMatch(/^[0-9a-f-]{36}$/);
    // hasGoogleAuth=false for password-registered users (no firebaseUid)
    expect(res.body.user.hasGoogleAuth).toBe(false);
    // Password is never returned
    expect(res.body.user.passwordHash).toBeUndefined();
    // DB has hash, not the plaintext
    const db = await prisma.user.findUnique({ where: { email: NEW_EMAIL } });
    expect(db?.passwordHash).toBeTruthy();
    expect(db?.passwordHash).not.toBe(PASSWORD);
    expect(db?.passwordHash?.startsWith('$2b$')).toBe(true);
  });

  it('claims an existing email-only account (no passwordHash) by setting one', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: EXISTING_EMAIL,
      password: PASSWORD,
    });
    expect(res.status).toBe(200); // 200 for claim, 201 for true new
    expect(res.body.user.email).toBe(EXISTING_EMAIL);
    const db = await prisma.user.findUnique({ where: { email: EXISTING_EMAIL } });
    expect(db?.passwordHash).toBeTruthy();
  });

  it('rejects registration when password is already set (409 conflict)', async () => {
    // Run the claim test first effect: EXISTING_EMAIL now has passwordHash
    const res = await request(app).post('/api/auth/register').send({
      email: EXISTING_EMAIL,
      password: 'different-password',
    });
    expect(res.status).toBe(409);
  });

  it('rejects passwords shorter than 8 chars', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: `short-${Date.now()}@local.test`,
      password: 'short',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 8/i);
  });

  it('rejects malformed email', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'not-an-email',
      password: PASSWORD,
    });
    expect(res.status).toBe(400);
  });

  it('lowercases email so two casings are the same account', async () => {
    const upper = `Mixed.Case-${Date.now()}@LOCAL.TEST`;
    const res = await request(app).post('/api/auth/register').send({
      email: upper,
      password: PASSWORD,
    });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(upper.toLowerCase());
    await prisma.user.delete({ where: { email: upper.toLowerCase() } });
  });

  // SECURITY: a Google-only user (firebaseUid set, passwordHash null)
  // must NOT be hijackable by /register. Without the firebaseUid gate
  // the password-claim path overwrote the row's passwordHash with the
  // attacker's chosen value, handing over login. The 409 response is
  // shape-identical to the "already claimed by password" case so it
  // can't be used to enumerate which accounts are Google-only.
  it('refuses to claim a Google-only account with /register', async () => {
    const googleEmail = `google-only-${Date.now()}@local.test`;
    const googleUid = `g-uid-${Date.now()}`;
    await prisma.user.create({
      data: {
        email: googleEmail,
        firebaseUid: googleUid,
        passwordHash: null, // Google-only: no password set
      },
    });
    try {
      const res = await request(app).post('/api/auth/register').send({
        email: googleEmail,
        password: 'attacker-chosen-strong-pw',
      });
      expect(res.status).toBe(409);
      // The original row must be untouched — passwordHash still null,
      // firebaseUid still the original.
      const after = await prisma.user.findUnique({ where: { email: googleEmail } });
      expect(after?.passwordHash).toBeNull();
      expect(after?.firebaseUid).toBe(googleUid);
    } finally {
      await prisma.user.delete({ where: { email: googleEmail } });
    }
  });
});

describe('POST /api/auth/login', () => {
  it('returns a token for valid credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: NEW_EMAIL,
      password: PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe(NEW_EMAIL);
  });

  it('returns 401 with constant-time error for wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: NEW_EMAIL,
      password: 'wrong-password',
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid email or password/i);
  });

  it('returns 401 (same message) for unknown email — no enumeration', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: `nobody-${Date.now()}@local.test`,
      password: PASSWORD,
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid email or password/i);
  });

  it('returns 401 for an account with no password (Google-only user)', async () => {
    // Create a user with firebaseUid but no passwordHash, simulating a
    // Google-only account that someone tries to password-login into.
    const u = await prisma.user.create({
      data: {
        email: `google-only-${Date.now()}@local.test`,
        firebaseUid: `g-uid-${Date.now()}`,
        fullName: 'Google Only',
      },
    });
    try {
      const res = await request(app).post('/api/auth/login').send({
        email: u.email,
        password: PASSWORD,
      });
      expect(res.status).toBe(401);
    } finally {
      await prisma.user.delete({ where: { id: u.id } });
    }
  });
});

describe('POST /api/auth/google', () => {
  beforeEach(() => mockVerifyIdToken.mockReset());

  it('creates a new user from a verified Google ID token', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: GOOGLE_UID,
      email: GOOGLE_EMAIL,
      name: 'Google User',
    });
    const res = await request(app).post('/api/auth/google').send({ idToken: 'mock-google-id-token' });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(GOOGLE_EMAIL);
    expect(res.body.user.hasGoogleAuth).toBe(true);
    const db = await prisma.user.findUnique({ where: { email: GOOGLE_EMAIL } });
    expect(db?.firebaseUid).toBe(GOOGLE_UID);
    expect(db?.emailVerifiedAt).toBeTruthy();
  });

  it('returns the same user on subsequent sign-ins (no duplicate)', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: GOOGLE_UID,
      email: GOOGLE_EMAIL,
      name: 'Google User',
    });
    const first = await request(app).post('/api/auth/google').send({ idToken: 'mock-google-id-token' });
    const second = await request(app).post('/api/auth/google').send({ idToken: 'mock-google-id-token' });
    expect(first.body.user.id).toBe(second.body.user.id);
    const count = await prisma.user.count({ where: { email: GOOGLE_EMAIL } });
    expect(count).toBe(1);
  });

  it('upgrades an existing email-only user by linking firebaseUid in place', async () => {
    // Pre-create an email-only user (no firebaseUid, no passwordHash).
    // /auth/google should LINK the firebaseUid onto this row, not create
    // a duplicate. This is the migration story for existing dev-auth users.
    const upgradeEmail = `upgrade-${Date.now()}@local.test`;
    const upgradeUid = `g-uid-upgrade-${Date.now()}`;
    const original = await prisma.user.create({
      data: { email: upgradeEmail, fullName: 'Pre-existing' },
    });
    mockVerifyIdToken.mockResolvedValue({
      uid: upgradeUid,
      email: upgradeEmail,
      name: 'Now via Google',
    });
    try {
      const res = await request(app).post('/api/auth/google').send({ idToken: 'mock-google-id-token' });
      expect(res.status).toBe(200);
      expect(res.body.user.id).toBe(original.id); // SAME row, not a duplicate
      const db = await prisma.user.findUnique({ where: { id: original.id } });
      expect(db?.firebaseUid).toBe(upgradeUid);
      // fullName preserved; we don't overwrite an existing one
      expect(db?.fullName).toBe('Pre-existing');
    } finally {
      await prisma.user.delete({ where: { id: original.id } });
    }
  });

  it('rejects an invalid Google ID token (401)', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('Token has been revoked.'));
    const res = await request(app).post('/api/auth/google').send({ idToken: 'fake' });
    expect(res.status).toBe(401);
  });

  it('rejects when token has no email claim', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'has-no-email' });
    const res = await request(app).post('/api/auth/google').send({ idToken: 'no-email' });
    expect(res.status).toBe(401);
  });

  it('rejects empty idToken (validation)', async () => {
    const res = await request(app).post('/api/auth/google').send({ idToken: '' });
    expect(res.status).toBe(400);
  });
});

describe('Authenticated request with our app JWT', () => {
  it('the token returned by /register works as Bearer for protected routes', async () => {
    // Use a fresh user so this test is independent.
    const email = `bearer-${Date.now()}@local.test`;
    const reg = await request(app).post('/api/auth/register').send({
      email,
      password: PASSWORD,
    });
    expect(reg.status).toBe(201);
    const token = reg.body.token;

    // /api/users/me is a typical authenticated endpoint.
    const me = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(email);

    await prisma.user.delete({ where: { email } });
  });

  // Regression test for the production foot-gun discovered on 2026-04-29:
  // a misconfigured DEV_AUTH_USER_EMAIL on the production server caused
  // every authenticated request to be silently re-attributed to the
  // env-var user, because devAuthBypass ran before the Bearer-token check.
  // The fix in middleware/auth.ts makes the bypass yield to a real Bearer
  // token. We model the same precedence here using X-Test-User-Id (the
  // test-mode analogue of the dev bypass): when a Bearer is present the
  // bypass header must be ignored.
  it('Bearer token wins over X-Test-User-Id (bypass yields to real auth)', async () => {
    // Two distinct users.
    const aEmail = `bearer-precedes-a-${Date.now()}@local.test`;
    const bEmail = `bearer-precedes-b-${Date.now()}@local.test`;
    const userA = await prisma.user.create({ data: { email: aEmail } });
    const regB = await request(app).post('/api/auth/register').send({
      email: bEmail,
      password: PASSWORD,
    });
    expect(regB.status).toBe(201);
    const tokenB = regB.body.token;

    try {
      // Send BOTH a Bearer token (userB) and X-Test-User-Id (userA).
      // The Bearer must win — userA must NOT be returned as the caller.
      const me = await request(app)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${tokenB}`)
        .set('X-Test-User-Id', userA.id);
      expect(me.status).toBe(200);
      expect(me.body.email).toBe(bEmail);
      expect(me.body.email).not.toBe(aEmail);
      expect(me.body.id).toBe(regB.body.user.id);
      expect(me.body.id).not.toBe(userA.id);
    } finally {
      await prisma.user.deleteMany({ where: { email: { in: [aEmail, bEmail] } } });
    }
  });
});
