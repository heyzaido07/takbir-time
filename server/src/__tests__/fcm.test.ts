// Tests for the FCM keeper-update notification path.
//
// Strategy: jest.mock 'firebase-admin' so we capture exactly what would be
// sent without touching the network. Each test resets the captured calls
// via jest.clearAllMocks() in beforeEach.
//
// What we're pinning:
//  1. Topic name format `keeper-<uuid>-mosque-<uuid>`
//  2. Payload shape (notification + data + android.notification.channelId/tag)
//  3. data values are all strings (FCM enforces this)
//  4. FCM_ENABLED!='true' => log, no send call
//  5. Body string varies with prayer count: 1 → "New X at HH:MM",
//     2 → "Updated X (HH:MM) and Y (HH:MM)", 3+ → "Updated N prayer times"
//  6. Failure inside send is caught — caller never throws

import { jest } from '@jest/globals';

// firebase-admin must be mocked BEFORE the module under test imports it.
// Mocked send() always resolves; tests can override per-case.
const mockSend = jest.fn<(msg: any) => Promise<string>>().mockResolvedValue('mock-msg-id');
jest.mock('firebase-admin', () => {
  const mockMessaging = { send: mockSend };
  return {
    __esModule: true,
    default: {
      apps: [{ name: 'mock-app' }],
      messaging: () => mockMessaging,
      // The other surface auth.ts uses — kept stub-safe.
      initializeApp: jest.fn(),
      credential: { cert: jest.fn() },
      auth: () => ({ verifyIdToken: jest.fn() }),
    },
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockResolvedValue('mock-msg-id');
});

const KEEPER = '11111111-1111-1111-1111-111111111111';
const MOSQUE = '22222222-2222-2222-2222-222222222222';
const SUBMISSION = '33333333-3333-3333-3333-333333333333';

const baseArgs = () => ({
  mosqueId: MOSQUE,
  submitterId: KEEPER,
  submissionId: SUBMISSION,
  keeperName: 'Hassan Imam',
  mosqueName: 'Mujaddiya Masjid',
  timings: { fajr: '04:50', dhuhr: '13:30', isha: '20:45' },
  scheduleChanges: [
    { prayer: 'isha', action: 'promoted', reason: '...', from: '20:30', to: '20:45' },
  ],
});

describe('notifyKeeperUpdate', () => {
  it('sends to topic keeper-<keeperId>-mosque-<mosqueId> when FCM_ENABLED=true', async () => {
    process.env.FCM_ENABLED = 'true';
    const { notifyKeeperUpdate } = await import('../lib/fcm');

    await notifyKeeperUpdate(baseArgs());

    expect(mockSend).toHaveBeenCalledTimes(1);
    const payload = mockSend.mock.calls[0][0] as any;
    expect(payload.topic).toBe(`keeper-${KEEPER}-mosque-${MOSQUE}`);
  });

  it('payload carries notification + data + android.channelId + android.tag', async () => {
    process.env.FCM_ENABLED = 'true';
    const { notifyKeeperUpdate } = await import('../lib/fcm');

    await notifyKeeperUpdate(baseArgs());
    const payload = mockSend.mock.calls[0][0] as any;

    expect(payload.notification.title).toContain('Hassan Imam');
    expect(payload.notification.title).toContain('Mujaddiya Masjid');
    expect(payload.notification.body).toBeTruthy();

    expect(payload.data).toEqual({
      type:         'schedule_update',
      mosqueId:     MOSQUE,
      submitterId:  KEEPER,
      submissionId: SUBMISSION,
      ts:           expect.any(String),
    });
    // FCM enforces all data values are strings — assert that.
    for (const v of Object.values(payload.data)) expect(typeof v).toBe('string');

    expect(payload.android.priority).toBe('high');
    expect(payload.android.notification.channelId).toBe('keeper-updates');
    expect(payload.android.notification.tag).toBe(MOSQUE);
  });

  it('body summarizes 1 changed prayer as "New <Prayer> at <12h time>"', async () => {
    process.env.FCM_ENABLED = 'true';
    const { notifyKeeperUpdate } = await import('../lib/fcm');

    await notifyKeeperUpdate({
      ...baseArgs(),
      scheduleChanges: [{ prayer: 'isha', action: 'promoted', reason: '...', to: '20:45' }],
    });
    const payload = mockSend.mock.calls[0][0] as any;
    expect(payload.notification.body).toMatch(/New Isha at 8:45 PM/i);
  });

  it('body summarizes 2 changed prayers as "Updated <X> (...) and <Y> (...)"', async () => {
    process.env.FCM_ENABLED = 'true';
    const { notifyKeeperUpdate } = await import('../lib/fcm');

    await notifyKeeperUpdate({
      ...baseArgs(),
      scheduleChanges: [
        { prayer: 'isha', action: 'promoted', reason: '', to: '20:45' },
        { prayer: 'asr',  action: 'promoted', reason: '', to: '17:30' },
      ],
    });
    const body = (mockSend.mock.calls[0][0] as any).notification.body;
    expect(body).toMatch(/Updated/i);
    expect(body).toMatch(/Isha/i);
    expect(body).toMatch(/Asr/i);
    expect(body).toMatch(/8:45 PM/i);
    expect(body).toMatch(/5:30 PM/i);
  });

  it('body summarizes 3+ changed prayers as "Updated N prayer times"', async () => {
    process.env.FCM_ENABLED = 'true';
    const { notifyKeeperUpdate } = await import('../lib/fcm');

    await notifyKeeperUpdate({
      ...baseArgs(),
      scheduleChanges: [
        { prayer: 'fajr',  action: 'promoted', reason: '', to: '04:50' },
        { prayer: 'dhuhr', action: 'promoted', reason: '', to: '13:30' },
        { prayer: 'asr',   action: 'promoted', reason: '', to: '17:30' },
        { prayer: 'isha',  action: 'promoted', reason: '', to: '20:45' },
      ],
    });
    const body = (mockSend.mock.calls[0][0] as any).notification.body;
    expect(body).toMatch(/Updated 4 prayer times/i);
  });

  it('does NOT call send when FCM_ENABLED is unset/false', async () => {
    process.env.FCM_ENABLED = 'false';
    const { notifyKeeperUpdate } = await import('../lib/fcm');

    await notifyKeeperUpdate(baseArgs());
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('caller does not throw when send rejects (fire-and-forget safe)', async () => {
    process.env.FCM_ENABLED = 'true';
    mockSend.mockRejectedValueOnce(new Error('FCM transient'));
    const { notifyKeeperUpdate } = await import('../lib/fcm');

    // Test passes by virtue of NOT throwing. Result reports the failure
    // so the call site can log it meaningfully.
    const result = await notifyKeeperUpdate(baseArgs()) as any;
    expect(result.sent).toBe(false);
    expect(result.reason).toBe('send-failed');
    expect(result.error).toMatch(/FCM transient/);
  });

  // Result-shape tests — let the call site log "what happened" without
  // having to peek at console output. Crucial for production debugging
  // when the app team says "I didn't get the push" — server log is the
  // only signal we have.
  it('returns { topic, sent: true, messageId } on successful send', async () => {
    process.env.FCM_ENABLED = 'true';
    mockSend.mockResolvedValueOnce('msg-abc-123');
    const { notifyKeeperUpdate } = await import('../lib/fcm');

    const result = await notifyKeeperUpdate(baseArgs()) as any;
    expect(result.topic).toBe(`keeper-${KEEPER}-mosque-${MOSQUE}`);
    expect(result.sent).toBe(true);
    expect(result.messageId).toBe('msg-abc-123');
  });

  it('returns { sent: false, reason: "disabled" } when FCM_ENABLED!=true', async () => {
    process.env.FCM_ENABLED = 'false';
    const { notifyKeeperUpdate } = await import('../lib/fcm');

    const result = await notifyKeeperUpdate(baseArgs()) as any;
    expect(result.topic).toBe(`keeper-${KEEPER}-mosque-${MOSQUE}`);
    expect(result.sent).toBe(false);
    expect(result.reason).toBe('disabled');
    expect(result.messageId).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Edge cases — added during TDD audit. Each describes a real bug or
// fragility surfaced by reading fcm.ts carefully. We deliberately do NOT
// touch jest.resetModules / jest.doMock here so the closure-captured
// mockSend stays the single accumulator across the whole file.
// ─────────────────────────────────────────────────────────────────────

import admin from 'firebase-admin';

describe('notifyKeeperUpdate — body edge cases', () => {
  it('falls back to "New jamat times posted" when scheduleChanges is empty', async () => {
    process.env.FCM_ENABLED = 'true';
    const { notifyKeeperUpdate } = await import('../lib/fcm');
    await notifyKeeperUpdate({ ...baseArgs(), scheduleChanges: [] });
    const body = (mockSend.mock.calls[0][0] as any).notification.body;
    expect(body).toBe('New jamat times posted');
  });

  it('treats empty-string `to` as no-meaningful-change (currently buggy)', async () => {
    process.env.FCM_ENABLED = 'true';
    const { notifyKeeperUpdate } = await import('../lib/fcm');
    await notifyKeeperUpdate({
      ...baseArgs(),
      scheduleChanges: [
        { prayer: 'isha', action: 'promoted', reason: '', to: undefined },
        { prayer: 'asr',  action: 'promoted', reason: '', to: '' },
      ] as any,
    });
    const body = (mockSend.mock.calls[0][0] as any).notification.body;
    expect(body).toBe('New jamat times posted');
  });

  it('handles jummah-style array `to` without throwing (recompute output for jummah is string[])', async () => {
    process.env.FCM_ENABLED = 'true';
    const { notifyKeeperUpdate } = await import('../lib/fcm');
    await expect(notifyKeeperUpdate({
      ...baseArgs(),
      scheduleChanges: [
        { prayer: 'jummah', action: 'promoted', reason: '', to: ['13:30'] as any },
      ],
    })).resolves.toBeDefined();
    const body = (mockSend.mock.calls[0][0] as any).notification.body;
    expect(body).toMatch(/Jummah/);
    expect(body).toMatch(/1:30 PM/);
  });
});

describe('notifyKeeperUpdate — env gate edge cases', () => {
  it('returns admin-not-initialized when firebase-admin has zero apps', async () => {
    process.env.FCM_ENABLED = 'true';
    const originalApps = admin.apps;
    (admin as any).apps = [];
    try {
      const { notifyKeeperUpdate } = await import('../lib/fcm');
      const result = await notifyKeeperUpdate(baseArgs());
      expect(result.sent).toBe(false);
      expect((result as any).reason).toBe('admin-not-initialized');
      expect(mockSend).not.toHaveBeenCalled();
    } finally {
      (admin as any).apps = originalApps;
    }
  });

  it.each([
    ['True', 'capital T'],
    ['TRUE', 'all caps'],
    ['1',    'numeric truthy'],
    ['',     'empty string'],
    ['yes',  'human truthy'],
  ])('treats FCM_ENABLED=%j (%s) as disabled', async (val) => {
    process.env.FCM_ENABLED = val;
    const { notifyKeeperUpdate } = await import('../lib/fcm');
    const result = await notifyKeeperUpdate(baseArgs());
    expect(result.sent).toBe(false);
    expect((result as any).reason).toBe('disabled');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns disabled when FCM_ENABLED is unset entirely', async () => {
    delete process.env.FCM_ENABLED;
    const { notifyKeeperUpdate } = await import('../lib/fcm');
    const result = await notifyKeeperUpdate(baseArgs());
    expect(result.sent).toBe(false);
    expect((result as any).reason).toBe('disabled');
  });
});

describe('fmt12 — time formatter boundaries (probed via 1-prayer body)', () => {
  // Probe through buildBody's "1 prayer" branch. Each call appends to mockSend.
  const probe = async (hhmm: string): Promise<string> => {
    process.env.FCM_ENABLED = 'true';
    const { notifyKeeperUpdate } = await import('../lib/fcm');
    await notifyKeeperUpdate({
      ...baseArgs(),
      scheduleChanges: [{ prayer: 'isha', action: 'promoted', reason: '', to: hhmm }],
    });
    const calls = mockSend.mock.calls;
    return (calls[calls.length - 1][0] as any).notification.body;
  };

  it('renders 00:00 as 12:00 AM (midnight)', async () => {
    expect(await probe('00:00')).toMatch(/12:00 AM/);
  });
  it('renders 12:00 as 12:00 PM (noon)', async () => {
    expect(await probe('12:00')).toMatch(/12:00 PM/);
  });
  it('renders 23:59 as 11:59 PM (last minute of day)', async () => {
    expect(await probe('23:59')).toMatch(/11:59 PM/);
  });
  it('renders 13:05 as 1:05 PM (preserves leading zero on minute)', async () => {
    expect(await probe('13:05')).toMatch(/1:05 PM/);
  });
  it('rejects 24:00 as out-of-range (returns raw, no AM/PM)', async () => {
    const body = await probe('24:00');
    expect(body).toMatch(/24:00/);
    expect(body).not.toMatch(/AM|PM/);
  });
  it('rejects minute > 59 (returns raw, NOT 5:99 AM — currently buggy)', async () => {
    const body = await probe('05:99');
    expect(body).not.toMatch(/AM|PM/);
    expect(body).toMatch(/05:99/);
  });
  it('rejects garbage input (returns raw)', async () => {
    expect(await probe('abc')).toMatch(/abc/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Round 2 — title formatting + input hardening.
// ─────────────────────────────────────────────────────────────────────

describe('notifyKeeperUpdate — title formatting', () => {
  it('trims leading/trailing whitespace on keeperName and mosqueName', async () => {
    process.env.FCM_ENABLED = 'true';
    const { notifyKeeperUpdate } = await import('../lib/fcm');
    await notifyKeeperUpdate({
      ...baseArgs(),
      keeperName: '  Hassan Imam  ',
      mosqueName: ' Mujaddiya Masjid ',
    });
    const title = (mockSend.mock.calls[0][0] as any).notification.title;
    // Currently buggy: title would be "  Hassan Imam   updated  Mujaddiya Masjid ".
    expect(title).toBe('Hassan Imam updated Mujaddiya Masjid');
  });

  it('produces a sensible title even when keeperName is whitespace-only', async () => {
    process.env.FCM_ENABLED = 'true';
    const { notifyKeeperUpdate } = await import('../lib/fcm');
    await notifyKeeperUpdate({
      ...baseArgs(),
      keeperName: '   ',
      mosqueName: 'Mujaddiya Masjid',
    });
    const title = (mockSend.mock.calls[0][0] as any).notification.title;
    // Whitespace-only collapses, so no leading-space title. Fall back to
    // a generic phrasing rather than rendering " updated Mujaddiya Masjid".
    expect(title).not.toMatch(/^\s/);
    expect(title).toMatch(/Mujaddiya Masjid/);
  });

  it('produces a sensible title when mosqueName is missing', async () => {
    process.env.FCM_ENABLED = 'true';
    const { notifyKeeperUpdate } = await import('../lib/fcm');
    await notifyKeeperUpdate({
      ...baseArgs(),
      keeperName: 'Hassan',
      mosqueName: '',
    });
    const title = (mockSend.mock.calls[0][0] as any).notification.title;
    expect(title).not.toMatch(/\s+$/);
    expect(title).toMatch(/Hassan/);
  });
});

describe('notifyKeeperUpdate — payload size sanity', () => {
  it('topic name stays under FCMs 200-char limit and matches allowed charset', async () => {
    process.env.FCM_ENABLED = 'true';
    const { notifyKeeperUpdate } = await import('../lib/fcm');
    const result = await notifyKeeperUpdate(baseArgs());
    expect(result.topic.length).toBeLessThanOrEqual(200);
    expect(result.topic).toMatch(/^[a-zA-Z0-9\-_.~%]+$/);
  });

  it('truncates oversized keeperName/mosqueName so total title fits in FCMs notification.title cap', async () => {
    process.env.FCM_ENABLED = 'true';
    const { notifyKeeperUpdate } = await import('../lib/fcm');
    // FCM allows ~200 chars in notification.title but Android only ever
    // shows ~50 chars in the collapsed banner. Keep the title readable.
    await notifyKeeperUpdate({
      ...baseArgs(),
      keeperName: 'Q'.repeat(500),
      mosqueName: 'M'.repeat(500),
    });
    const title = (mockSend.mock.calls[0][0] as any).notification.title;
    expect(title.length).toBeLessThanOrEqual(180);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Round 3 — maghribOffset is in scheduleChanges but it isn't a HH:mm
// time, it's a minute offset (e.g. "3"). buildBody used to render it
// as "New maghribOffset at 3", which is gibberish to the user.
// ─────────────────────────────────────────────────────────────────────

describe('notifyKeeperUpdate — maghribOffset rendering', () => {
  it('renders a maghribOffset-only change as "Maghrib offset updated to N min"', async () => {
    process.env.FCM_ENABLED = 'true';
    const { notifyKeeperUpdate } = await import('../lib/fcm');
    await notifyKeeperUpdate({
      ...baseArgs(),
      scheduleChanges: [
        { prayer: 'maghribOffset', action: 'promoted', reason: '', from: '0', to: '3' },
      ],
    });
    const body = (mockSend.mock.calls[0][0] as any).notification.body;
    expect(body).not.toMatch(/maghribOffset/i);
    expect(body).toMatch(/Maghrib/);
    expect(body).toMatch(/3/);
    expect(body).toMatch(/min/i);
  });

  it('falls back gracefully when maghribOffset is mixed with prayer-time changes', async () => {
    process.env.FCM_ENABLED = 'true';
    const { notifyKeeperUpdate } = await import('../lib/fcm');
    await notifyKeeperUpdate({
      ...baseArgs(),
      scheduleChanges: [
        { prayer: 'isha', action: 'promoted', reason: '', to: '20:45' },
        { prayer: 'maghribOffset', action: 'promoted', reason: '', from: '0', to: '3' },
      ],
    });
    const body = (mockSend.mock.calls[0][0] as any).notification.body;
    // Whatever phrasing we choose, "maghribOffset" as a label must never
    // leak into the user-facing body.
    expect(body).not.toMatch(/maghribOffset/i);
    expect(body).toMatch(/Isha/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// notifyOnSuggest — pings the keeper when someone files a new
// suggestion via POST /api/suggestions. Topic: suggest-to-<userId>.
// Distinct from keeper-update (which fans out to followers); only the
// keeper themselves subscribes to their own suggest topic.
// ─────────────────────────────────────────────────────────────────────

const SUG_USER  = '44444444-4444-4444-4444-444444444444';
const SUG_ID    = '55555555-5555-5555-5555-555555555555';
const SUG_MOSQUE = '66666666-6666-6666-6666-666666666666';

const baseSuggestArgs = () => ({
  suggestionId: SUG_ID,
  toUserId: SUG_USER,
  mosqueId: SUG_MOSQUE,
  fromUserName: 'Junaid Qazi',
  mosqueName: 'Mujaddiya Masjid',
  timings: { fajr: '04:30' },
});

describe('notifyOnSuggest', () => {
  it('sends to topic suggest-to-<toUserId> when FCM_ENABLED=true', async () => {
    process.env.FCM_ENABLED = 'true';
    const { notifyOnSuggest } = await import('../lib/fcm');
    const result = await notifyOnSuggest(baseSuggestArgs());
    expect(result.sent).toBe(true);
    expect(result.topic).toBe(`suggest-to-${SUG_USER}`);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const message = (mockSend.mock.calls[0][0] as any);
    expect(message.topic).toBe(`suggest-to-${SUG_USER}`);
    expect(message.data.type).toBe('new_suggestion');
    expect(message.data.suggestionId).toBe(SUG_ID);
    expect(message.data.mosqueId).toBe(SUG_MOSQUE);
    // FCM enforces flat string-only data
    for (const v of Object.values(message.data)) expect(typeof v).toBe('string');
    // Reuses the keeper-updates channel; tagged by suggestionId so a
    // re-send replaces rather than stacks.
    expect(message.android.notification.channelId).toBe('keeper-updates');
    expect(message.android.notification.tag).toBe(SUG_ID);
  });

  it('title is "<from> suggests new times for <mosque>"', async () => {
    process.env.FCM_ENABLED = 'true';
    const { notifyOnSuggest } = await import('../lib/fcm');
    await notifyOnSuggest(baseSuggestArgs());
    const title = (mockSend.mock.calls[0][0] as any).notification.title;
    expect(title).toBe('Junaid Qazi suggests new times for Mujaddiya Masjid');
  });

  it('body for 1 prayer is "Suggests <Prayer> at H:MM AM/PM"', async () => {
    process.env.FCM_ENABLED = 'true';
    const { notifyOnSuggest } = await import('../lib/fcm');
    await notifyOnSuggest({ ...baseSuggestArgs(), timings: { fajr: '04:30' } });
    const body = (mockSend.mock.calls[0][0] as any).notification.body;
    expect(body).toBe('Suggests Fajr at 4:30 AM');
  });

  it('body for 2 prayers reads "Suggests <X> (..) and <Y> (..)"', async () => {
    process.env.FCM_ENABLED = 'true';
    const { notifyOnSuggest } = await import('../lib/fcm');
    await notifyOnSuggest({ ...baseSuggestArgs(), timings: { fajr: '04:30', isha: '20:45' } });
    const body = (mockSend.mock.calls[0][0] as any).notification.body;
    expect(body).toMatch(/^Suggests Fajr \(4:30 AM\) and Isha \(8:45 PM\)$/);
  });

  it('body for 3+ prayers collapses to "Suggests N prayer time changes"', async () => {
    process.env.FCM_ENABLED = 'true';
    const { notifyOnSuggest } = await import('../lib/fcm');
    await notifyOnSuggest({
      ...baseSuggestArgs(),
      timings: { fajr: '04:30', dhuhr: '13:30', asr: '17:15', isha: '20:45' },
    });
    const body = (mockSend.mock.calls[0][0] as any).notification.body;
    expect(body).toBe('Suggests 4 prayer time changes');
  });

  it('body special-cases maghribOffset alone', async () => {
    process.env.FCM_ENABLED = 'true';
    const { notifyOnSuggest } = await import('../lib/fcm');
    await notifyOnSuggest({ ...baseSuggestArgs(), timings: { maghribOffset: 5 } });
    const body = (mockSend.mock.calls[0][0] as any).notification.body;
    expect(body).toBe('Suggests Maghrib offset of 5 min');
  });

  it('handles jummah array form without crashing', async () => {
    process.env.FCM_ENABLED = 'true';
    const { notifyOnSuggest } = await import('../lib/fcm');
    await expect(notifyOnSuggest({ ...baseSuggestArgs(), timings: { jummah: ['13:30'] } }))
      .resolves.toBeDefined();
    const body = (mockSend.mock.calls[0][0] as any).notification.body;
    expect(body).toMatch(/Jummah/);
    expect(body).toMatch(/1:30 PM/);
  });

  it('falls through to "New suggestion in your inbox" when timings is empty', async () => {
    process.env.FCM_ENABLED = 'true';
    const { notifyOnSuggest } = await import('../lib/fcm');
    await notifyOnSuggest({ ...baseSuggestArgs(), timings: {} });
    const body = (mockSend.mock.calls[0][0] as any).notification.body;
    expect(body).toBe('New suggestion in your inbox');
  });

  it('returns disabled when FCM_ENABLED!=true (no send)', async () => {
    process.env.FCM_ENABLED = 'false';
    const { notifyOnSuggest } = await import('../lib/fcm');
    const result = await notifyOnSuggest(baseSuggestArgs());
    expect(result.sent).toBe(false);
    expect((result as any).reason).toBe('disabled');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('falls back to "Someone suggests new times for <mosque>" when fromName is whitespace', async () => {
    process.env.FCM_ENABLED = 'true';
    const { notifyOnSuggest } = await import('../lib/fcm');
    await notifyOnSuggest({ ...baseSuggestArgs(), fromUserName: '   ' });
    const title = (mockSend.mock.calls[0][0] as any).notification.title;
    expect(title).toBe('New suggestion for Mujaddiya Masjid');
  });
});
