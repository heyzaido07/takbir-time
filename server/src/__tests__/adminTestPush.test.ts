// POST /api/admin/test-push — opt-in dev/staging tool to fire a real
// FCM push to a topic without composing a full submission. The endpoint
// is invisible (404) by default; flipping ADMIN_TEST_PUSH_ENABLED=true
// + ADMIN_TEST_PUSH_USER_ID=<uuid-of-trusted-user> in the env makes it
// available to that one specific signed-in user.
//
// Strategy: jest.mock('../lib/fcm') so we capture what the route asks
// the FCM module to do without actually firing.

import { jest } from '@jest/globals';

const notifySpy = jest.fn(async (args: any) => ({
  topic: `keeper-${args.submitterId}-mosque-${args.mosqueId}`,
  sent: true,
  messageId: 'test-msg-id',
}));
jest.mock('../lib/fcm', () => ({
  notifyKeeperUpdate: notifySpy,
}));

import request from 'supertest';
import app from '../index';
import { prisma } from '../lib/prisma';

const EMAIL = `admin-test-push-${Date.now()}@local`;
const STRANGER_EMAIL = `admin-test-push-stranger-${Date.now()}@local`;
let userId: string;
let strangerId: string;

beforeAll(async () => {
  const u = await prisma.user.create({ data: { email: EMAIL, fullName: 'Admin' } });
  userId = u.id;
  const s = await prisma.user.create({ data: { email: STRANGER_EMAIL, fullName: 'Stranger' } });
  strangerId = s.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: [EMAIL, STRANGER_EMAIL] } } });
  await prisma.$disconnect();
});

beforeEach(() => {
  notifySpy.mockClear();
  delete process.env.ADMIN_TEST_PUSH_ENABLED;
  delete process.env.ADMIN_TEST_PUSH_USER_ID;
});

const VALID_BODY = () => ({
  keeperUserId: '11111111-1111-1111-1111-111111111111',
  mosqueId:     '22222222-2222-2222-2222-222222222222',
  keeperName:   'Hassan',
  mosqueName:   'Mujaddiya Masjid',
});

describe('POST /api/admin/test-push', () => {
  it('returns 404 when ADMIN_TEST_PUSH_ENABLED is unset (route invisible by default)', async () => {
    const res = await request(app)
      .post('/api/admin/test-push')
      .set('X-Test-User-Id', userId)
      .send(VALID_BODY());
    expect(res.status).toBe(404);
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('returns 404 when env is enabled but caller is not the configured admin', async () => {
    process.env.ADMIN_TEST_PUSH_ENABLED = 'true';
    process.env.ADMIN_TEST_PUSH_USER_ID = userId; // ONE allowed user
    const res = await request(app)
      .post('/api/admin/test-push')
      .set('X-Test-User-Id', strangerId) // not that user
      .send(VALID_BODY());
    // 404, not 403, so the existence of the endpoint isn't leaked.
    expect(res.status).toBe(404);
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('returns 401 when env is enabled but caller is unauthenticated', async () => {
    process.env.ADMIN_TEST_PUSH_ENABLED = 'true';
    process.env.ADMIN_TEST_PUSH_USER_ID = userId;
    const res = await request(app)
      .post('/api/admin/test-push')
      .send(VALID_BODY());
    expect(res.status).toBe(401);
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('returns 400 when body is missing required fields', async () => {
    process.env.ADMIN_TEST_PUSH_ENABLED = 'true';
    process.env.ADMIN_TEST_PUSH_USER_ID = userId;
    const res = await request(app)
      .post('/api/admin/test-push')
      .set('X-Test-User-Id', userId)
      .send({ keeperUserId: 'not-a-uuid' });
    expect(res.status).toBe(400);
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('returns 200 + the NotifyResult when env enabled, caller is admin, body valid', async () => {
    process.env.ADMIN_TEST_PUSH_ENABLED = 'true';
    process.env.ADMIN_TEST_PUSH_USER_ID = userId;
    const res = await request(app)
      .post('/api/admin/test-push')
      .set('X-Test-User-Id', userId)
      .send(VALID_BODY());

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(true);
    expect(res.body.topic).toBe(
      `keeper-11111111-1111-1111-1111-111111111111-mosque-22222222-2222-2222-2222-222222222222`,
    );
    expect(res.body.messageId).toBe('test-msg-id');

    expect(notifySpy).toHaveBeenCalledTimes(1);
    const args = notifySpy.mock.calls[0][0] as any;
    expect(args.submitterId).toBe('11111111-1111-1111-1111-111111111111');
    expect(args.mosqueId).toBe('22222222-2222-2222-2222-222222222222');
    expect(args.keeperName).toBe('Hassan');
    expect(args.mosqueName).toBe('Mujaddiya Masjid');
    // Synthetic submissionId so server logs distinguish admin tests from real submissions.
    expect(args.submissionId).toMatch(/^admin-test-/);
    // Synthetic scheduleChanges so the body summary code path runs.
    expect(Array.isArray(args.scheduleChanges)).toBe(true);
  });
});
