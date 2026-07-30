import { computeConsensus, ScoredSubmission, shouldPromoteConsensus, CurrentSchedule, PrayerConsensus, rankTimeKeepers, KeeperSubmission, RankedKeeper } from '../lib/consensus';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function makeSubmission(overrides: Partial<ScoredSubmission> = {}): ScoredSubmission {
  return {
    timings: { fajr: '05:00' },
    upvotes: 0,
    downvotes: 0,
    createdAt: new Date(),
    submitter: { reputationPoints: 0, verifiedContributor: false, isTimeKeeper: false },
    ...overrides,
  };
}

function makeKeeperSubmission(overrides: Partial<KeeperSubmission> = {}): KeeperSubmission {
  return {
    submissionId: `sub-${Math.random().toString(36).slice(2, 8)}`,
    submitterId: 'user-1',
    submitterName: 'Hassan',
    timings: { fajr: '05:00', dhuhr: '13:30', asr: '17:00', maghrib: '18:30', isha: '20:00' },
    upvotes: 0,
    downvotes: 0,
    createdAt: new Date(),
    submitter: { reputationPoints: 0, verifiedContributor: false, isTimeKeeper: false },
    ...overrides,
  };
}

describe('computeConsensus', () => {
  test('returns null time and zero confidence when no submissions', () => {
    const result = computeConsensus([], 'fajr');
    expect(result.time).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.contributors).toBe(0);
    expect(result.supportCount).toBe(0);
  });

  test('a single submission wins with confidence 1.0', () => {
    const result = computeConsensus(
      [makeSubmission({ timings: { fajr: '05:15' } })],
      'fajr'
    );
    expect(result.time).toBe('05:15');
    expect(result.confidence).toBe(1.0);
    expect(result.contributors).toBe(1);
    expect(result.supportCount).toBe(1);
  });

  test('two submissions agreeing on the same time', () => {
    const result = computeConsensus(
      [
        makeSubmission({ timings: { fajr: '05:15' } }),
        makeSubmission({ timings: { fajr: '05:15' } }),
      ],
      'fajr'
    );
    expect(result.time).toBe('05:15');
    expect(result.contributors).toBe(2);
    expect(result.supportCount).toBe(2);
    expect(result.confidence).toBe(1.0); // no second bucket
  });

  test('a fresh single submission outweighs an equal but ancient one', () => {
    const now = new Date('2026-04-26T12:00:00Z');
    const ancient = new Date(now.getTime() - 60 * DAY); // 60 days ago — should weigh ~1.5%
    const fresh = new Date(now.getTime() - 1 * DAY);
    const result = computeConsensus(
      [
        makeSubmission({ timings: { fajr: '05:00' }, createdAt: ancient }),
        makeSubmission({ timings: { fajr: '05:30' }, createdAt: fresh }),
      ],
      'fajr',
      now
    );
    expect(result.time).toBe('05:30');
    // The fresh one should dominate the confidence number too — fresh weight ~0.93,
    // ancient weight ~0.015, so confidence ~ 0.93 / (0.93 + 0.015) > 0.95
    expect(result.confidence).toBeGreaterThan(0.95);
  });

  test('two submissions disagreeing — the more-supported time wins', () => {
    const result = computeConsensus(
      [
        makeSubmission({ timings: { fajr: '05:15' } }),
        makeSubmission({ timings: { fajr: '05:15' } }),
        makeSubmission({ timings: { fajr: '05:30' } }),
      ],
      'fajr'
    );
    expect(result.time).toBe('05:15');
    // 2 weighted vs 1 weighted → 2/3
    expect(result.confidence).toBeCloseTo(2 / 3, 2);
    expect(result.contributors).toBe(2);
    expect(result.supportCount).toBe(2);
  });

  test('an upvoted submission outweighs an equally-fresh non-voted competitor', () => {
    const now = new Date('2026-04-26T12:00:00Z');
    const recent = new Date(now.getTime() - 1 * DAY);
    const result = computeConsensus(
      [
        makeSubmission({ timings: { fajr: '05:15' }, createdAt: recent, upvotes: 5 }),
        makeSubmission({ timings: { fajr: '05:30' }, createdAt: recent }),
      ],
      'fajr',
      now
    );
    expect(result.time).toBe('05:15');
  });

  test('a verified contributor outweighs a fresh anonymous submitter', () => {
    const now = new Date('2026-04-26T12:00:00Z');
    const recent = new Date(now.getTime() - 1 * DAY);
    const result = computeConsensus(
      [
        makeSubmission({
          timings: { fajr: '05:15' },
          createdAt: recent,
          submitter: { reputationPoints: 0, verifiedContributor: true, isTimeKeeper: false },
        }),
        makeSubmission({ timings: { fajr: '05:30' }, createdAt: recent }),
      ],
      'fajr',
      now
    );
    expect(result.time).toBe('05:15');
  });

  test('a time keeper outweighs five anonymous submitters disagreeing', () => {
    const now = new Date('2026-04-26T12:00:00Z');
    const recent = new Date(now.getTime() - 1 * DAY);
    const fiveAnon = Array.from({ length: 5 }, () =>
      makeSubmission({ timings: { fajr: '05:30' }, createdAt: recent })
    );
    const keeper = makeSubmission({
      timings: { fajr: '05:15' },
      createdAt: recent,
      submitter: { reputationPoints: 0, verifiedContributor: true, isTimeKeeper: true },
    });
    const result = computeConsensus([...fiveAnon, keeper], 'fajr', now);
    expect(result.time).toBe('05:15');
  });

  test('promote when there is no current schedule and a consensus exists', () => {
    const consensus: PrayerConsensus = { time: '05:15', confidence: 1.0, contributors: 1, supportCount: 1 };
    const decision = shouldPromoteConsensus(consensus, null, 'fajr', 1);
    expect(decision.shouldPromote).toBe(true);
    expect(decision.reason).toMatch(/no current/i);
  });

  test('do not promote when consensus matches the current schedule (no-op)', () => {
    const current: CurrentSchedule = {
      timings: { fajr: '05:15' },
      verificationStatus: 'pending',
      validFrom: new Date('2026-04-20'),
    };
    const consensus: PrayerConsensus = { time: '05:15', confidence: 1.0, contributors: 5, supportCount: 5 };
    const decision = shouldPromoteConsensus(consensus, current, 'fajr', 1);
    expect(decision.shouldPromote).toBe(false);
  });

  test('do not promote when confidence is below the threshold', () => {
    const current: CurrentSchedule = {
      timings: { fajr: '05:15' },
      verificationStatus: 'pending',
      validFrom: new Date('2026-04-20'),
    };
    const consensus: PrayerConsensus = { time: '05:30', confidence: 0.55, contributors: 5, supportCount: 5 };
    const decision = shouldPromoteConsensus(consensus, current, 'fajr', 1);
    expect(decision.shouldPromote).toBe(false);
    expect(decision.reason).toMatch(/confidence/i);
  });

  test('do not promote when contributor count is below the threshold', () => {
    const current: CurrentSchedule = {
      timings: { fajr: '05:15' },
      verificationStatus: 'pending',
      validFrom: new Date('2026-04-20'),
    };
    const consensus: PrayerConsensus = { time: '05:30', confidence: 0.9, contributors: 2, supportCount: 2 };
    const decision = shouldPromoteConsensus(consensus, current, 'fajr', 1);
    expect(decision.shouldPromote).toBe(false);
    expect(decision.reason).toMatch(/contributor/i);
  });

  test('promote when confidence > 0.65 AND contributors >= 3', () => {
    const current: CurrentSchedule = {
      timings: { fajr: '05:15' },
      verificationStatus: 'pending',
      validFrom: new Date('2026-04-20'),
    };
    const consensus: PrayerConsensus = { time: '05:30', confidence: 0.7, contributors: 3, supportCount: 3 };
    const decision = shouldPromoteConsensus(consensus, current, 'fajr', 1);
    expect(decision.shouldPromote).toBe(true);
  });

  test('verified schedule needs higher confidence (>= 0.80) to be overridden', () => {
    const current: CurrentSchedule = {
      timings: { fajr: '05:15' },
      verificationStatus: 'verified',
      validFrom: new Date('2026-04-20'),
    };
    // 0.70 confidence is enough for pending, NOT enough for verified
    const lowConsensus: PrayerConsensus = { time: '05:30', confidence: 0.7, contributors: 5, supportCount: 5 };
    expect(shouldPromoteConsensus(lowConsensus, current, 'fajr', 1).shouldPromote).toBe(false);

    const highConsensus: PrayerConsensus = { time: '05:30', confidence: 0.85, contributors: 5, supportCount: 5 };
    expect(shouldPromoteConsensus(highConsensus, current, 'fajr', 1).shouldPromote).toBe(true);
  });

  test('a current time keeper can update a verified schedule without waiting for three contributors', () => {
    const current: CurrentSchedule = {
      timings: { isha: '21:15' },
      verificationStatus: 'verified',
      validFrom: new Date('2026-04-20'),
    };
    const consensus: PrayerConsensus = {
      time: '21:25',
      confidence: 1,
      contributors: 1,
      supportCount: 1,
      hasTimeKeeperSupport: true,
    };
    const decision = shouldPromoteConsensus(consensus, current, 'isha', 1);
    expect(decision.shouldPromote).toBe(true);
    expect(decision.reason).toMatch(/time keeper/i);
  });

  test('burst condition: 4+ submissions in 48h agreeing override normal thresholds', () => {
    const current: CurrentSchedule = {
      timings: { fajr: '05:15' },
      verificationStatus: 'pending',
      validFrom: new Date('2026-04-20'),
    };
    // Below normal thresholds...
    const consensus: PrayerConsensus = { time: '05:30', confidence: 0.4, contributors: 1, supportCount: 1 };
    // ...but 4 submissions in 48h flip it anyway
    const decision = shouldPromoteConsensus(consensus, current, 'fajr', 4);
    expect(decision.shouldPromote).toBe(true);
    expect(decision.reason).toMatch(/burst/i);
  });

  test('burst condition does NOT bypass the verified-schedule confidence floor', () => {
    const current: CurrentSchedule = {
      timings: { fajr: '05:15' },
      verificationStatus: 'verified',
      validFrom: new Date('2026-04-20'),
    };
    // 4-submission burst, but confidence < 0.80 → still don't override verified
    const consensus: PrayerConsensus = { time: '05:30', confidence: 0.5, contributors: 1, supportCount: 1 };
    const decision = shouldPromoteConsensus(consensus, current, 'fajr', 6);
    expect(decision.shouldPromote).toBe(false);
  });

  test('a schedule older than 90 days is refreshed even at modest confidence', () => {
    const ancientCurrent: CurrentSchedule = {
      timings: { fajr: '05:15' },
      verificationStatus: 'pending',
      validFrom: new Date('2025-01-01'), // > 90d before any reasonable "now"
    };
    const consensus: PrayerConsensus = { time: '05:30', confidence: 0.55, contributors: 1, supportCount: 1 };
    const now = new Date('2026-04-26T12:00:00Z');
    const decision = shouldPromoteConsensus(consensus, ancientCurrent, 'fajr', 1, now);
    expect(decision.shouldPromote).toBe(true);
    expect(decision.reason).toMatch(/stale|90/i);
  });

  // ─── rankTimeKeepers ──────────────────────────────────────────────

  test('rankTimeKeepers: empty input returns empty list', () => {
    expect(rankTimeKeepers([])).toEqual([]);
  });

  test('rankTimeKeepers: single submitter shows up as the only keeper', () => {
    const subs = [makeKeeperSubmission({ submitterId: 'a', submitterName: 'Hassan' })];
    const ranked = rankTimeKeepers(subs);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].submitterId).toBe('a');
    expect(ranked[0].submitterName).toBe('Hassan');
    expect(ranked[0].submissionCount).toBe(1);
  });

  test('rankTimeKeepers: groups multiple submissions from the same submitter', () => {
    const subs = [
      makeKeeperSubmission({ submitterId: 'a', submitterName: 'Hassan' }),
      makeKeeperSubmission({ submitterId: 'a', submitterName: 'Hassan' }),
      makeKeeperSubmission({ submitterId: 'b', submitterName: 'Bilal' }),
    ];
    const ranked = rankTimeKeepers(subs);
    expect(ranked).toHaveLength(2);
    const hassan = ranked.find(k => k.submitterId === 'a')!;
    expect(hassan.submissionCount).toBe(2);
  });

  test('rankTimeKeepers: orders highest-rating first', () => {
    const now = new Date('2026-04-26T12:00:00Z');
    const recent = new Date(now.getTime() - 1 * DAY);
    const subs = [
      makeKeeperSubmission({
        submitterId: 'b', submitterName: 'Bilal',
        createdAt: recent,
        submitter: { reputationPoints: 0, verifiedContributor: false, isTimeKeeper: false },
      }),
      makeKeeperSubmission({
        submitterId: 'a', submitterName: 'Hassan',
        createdAt: recent,
        submitter: { reputationPoints: 5000, verifiedContributor: true, isTimeKeeper: false },
      }),
    ];
    const ranked = rankTimeKeepers(subs, now);
    expect(ranked[0].submitterId).toBe('a'); // Hassan has higher rating
    expect(ranked[1].submitterId).toBe('b');
    expect(ranked[0].rating).toBeGreaterThan(ranked[1].rating);
  });

  test('rankTimeKeepers: returns the latest submission per submitter for the timings', () => {
    const earlier = new Date('2026-04-01T00:00:00Z');
    const later = new Date('2026-04-25T00:00:00Z');
    const ranked = rankTimeKeepers([
      makeKeeperSubmission({ submitterId: 'a', timings: { fajr: '05:00' }, createdAt: earlier }),
      makeKeeperSubmission({ submitterId: 'a', timings: { fajr: '05:30' }, createdAt: later }),
    ]);
    expect(ranked[0].timings.fajr).toBe('05:30');
  });

  test('rankTimeKeepers: exposes the latestSubmissionId for voting', () => {
    const earlier = new Date('2026-04-01T00:00:00Z');
    const later = new Date('2026-04-25T00:00:00Z');
    const ranked = rankTimeKeepers([
      makeKeeperSubmission({ submissionId: 'old-sub', submitterId: 'a', createdAt: earlier }),
      makeKeeperSubmission({ submissionId: 'new-sub', submitterId: 'a', createdAt: later }),
    ]);
    expect(ranked[0].latestSubmissionId).toBe('new-sub');
  });

  test('reputation has a sublinear effect — 10k rep gives roughly 3x boost, not 100x', () => {
    const now = new Date('2026-04-26T12:00:00Z');
    const recent = new Date(now.getTime() - 1 * DAY);
    const highRep = makeSubmission({
      timings: { fajr: '05:15' },
      createdAt: recent,
      submitter: { reputationPoints: 10_000, verifiedContributor: false, isTimeKeeper: false },
    });
    // Four anonymous opponents each weighing 1 → total weight 4.
    // High-rep alone should beat them: rep 10k → ~3x boost, that's still 3 < 4.
    // So this test asserts: 4 anons CAN outvote a high-rep individual (no
    // single-account dominance), but a high-rep + 1 ally can win.
    const fourAnon = Array.from({ length: 4 }, () =>
      makeSubmission({ timings: { fajr: '05:30' }, createdAt: recent })
    );
    const losing = computeConsensus([...fourAnon, highRep], 'fajr', now);
    expect(losing.time).toBe('05:30');

    const ally = makeSubmission({ timings: { fajr: '05:15' }, createdAt: recent });
    const winning = computeConsensus([...fourAnon, highRep, ally], 'fajr', now);
    expect(winning.time).toBe('05:15');
  });
});
