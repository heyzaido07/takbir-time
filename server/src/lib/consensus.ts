export interface ScoredSubmission {
  timings: { [prayer: string]: string | undefined };
  upvotes: number;
  downvotes: number;
  createdAt: Date;
  submitter: {
    reputationPoints: number;
    verifiedContributor: boolean;
    isTimeKeeper: boolean;
  };
}

export interface PrayerConsensus {
  time: string | null;
  confidence: number;
  contributors: number;
  supportCount: number;
  hasTimeKeeperSupport?: boolean;
}

export interface CurrentSchedule {
  timings: { [prayer: string]: string | string[] | undefined };
  verificationStatus: 'verified' | 'pending' | string;
  validFrom: Date;
}

export interface PromotionDecision {
  shouldPromote: boolean;
  reason: string;
}

// Tunables — exported so callers (tests, future admin UI) can override.
export const PROMOTION = {
  confidenceFloorPending: 0.65,
  confidenceFloorVerified: 0.80,
  minContributors: 3,
  staleDays: 90,
  burstThreshold48h: 4,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Decide whether a recomputed consensus should replace the current
 * active PrayerSchedule for one prayer. Pure function — tested in isolation.
 *
 * Caller is responsible for fetching the current consensus and the
 * burst count, and applying the result (deactivating old schedule,
 * inserting new one) inside a transaction.
 */
export function shouldPromoteConsensus(
  consensus: PrayerConsensus,
  current: CurrentSchedule | null,
  prayer: string,
  burstCount48h: number,
  now: Date = new Date()
): PromotionDecision {
  if (!consensus.time) {
    return { shouldPromote: false, reason: 'no consensus' };
  }
  if (!current) {
    return { shouldPromote: true, reason: 'no current schedule' };
  }

  const cur = current.timings[prayer];
  const currentTime = Array.isArray(cur) ? cur[0] : cur;
  if (currentTime === consensus.time) {
    return { shouldPromote: false, reason: 'same as current schedule' };
  }

  if (consensus.hasTimeKeeperSupport) {
    return { shouldPromote: true, reason: 'time keeper update' };
  }

  const isVerified = current.verificationStatus === 'verified';

  if (isVerified) {
    if (consensus.confidence < PROMOTION.confidenceFloorVerified) {
      return { shouldPromote: false, reason: `verified schedules require confidence >= ${PROMOTION.confidenceFloorVerified}` };
    }
    if (consensus.contributors < PROMOTION.minContributors) {
      return { shouldPromote: false, reason: 'not enough contributors to override a verified schedule' };
    }
    return { shouldPromote: true, reason: 'consensus exceeds verified threshold' };
  }

  // Pending or unverified schedules — easier to override.
  const ageDays = (now.getTime() - current.validFrom.getTime()) / MS_PER_DAY;
  if (ageDays > PROMOTION.staleDays) {
    return { shouldPromote: true, reason: `stale (>${PROMOTION.staleDays} days)` };
  }
  if (burstCount48h >= PROMOTION.burstThreshold48h) {
    return { shouldPromote: true, reason: `burst (${burstCount48h} new submissions in 48h)` };
  }
  if (consensus.confidence < PROMOTION.confidenceFloorPending) {
    return { shouldPromote: false, reason: `confidence ${consensus.confidence.toFixed(2)} below pending floor (${PROMOTION.confidenceFloorPending})` };
  }
  if (consensus.contributors < PROMOTION.minContributors) {
    return { shouldPromote: false, reason: `only ${consensus.contributors} contributors, need ${PROMOTION.minContributors}` };
  }
  return { shouldPromote: true, reason: 'consensus exceeds pending threshold' };
}

// ─── Time keepers ──────────────────────────────────────────────────
//
// A "time keeper" is a contributor who has submitted timings for a mosque.
// We rank them using the SAME weight formula as the consensus algorithm —
// so the "top-rated" keeper is the one whose submissions carry the most
// weight (votes, recency, verified status, reputation).

export interface KeeperSubmission {
  submissionId: string | null;
  sourceId?: string;
  sourceType?: 'timingSubmission' | 'prayerSchedule';
  submitterId: string;
  submitterName: string;
  timings: { [prayer: string]: string | string[] | number | undefined };
  upvotes: number;
  downvotes: number;
  createdAt: Date;
  activeSchedule?: boolean;
  verifiedSchedule?: boolean;
  submitter: {
    reputationPoints: number;
    verifiedContributor: boolean;
    isTimeKeeper: boolean;
  };
}

export interface RankedKeeper {
  submitterId: string;
  submitterName: string;
  timings: { [prayer: string]: string | string[] | number | undefined };
  rating: number;
  submissionCount: number;
  verifiedContributor: boolean;
  reputationPoints: number;
  followerCount?: number;
  latestSubmissionAt: Date;
  latestSourceId?: string | null;
  latestSourceType?: 'timingSubmission' | 'prayerSchedule';
  activeSchedule?: boolean;
  verifiedSchedule?: boolean;
  /** ID of the keeper's most recent submission for this mosque — clients
   *  use this to vote (POST /api/submissions/:id/vote). */
  latestSubmissionId: string | null;
}

const HALF_LIFE_DAYS = 14;

/** The same per-submission weight the consensus algorithm uses. */
function scoreSubmissionWeight(
  s: { upvotes: number; downvotes: number; createdAt: Date; submitter: KeeperSubmission['submitter'] },
  now: Date
): number {
  const ageDays = Math.max(0, (now.getTime() - s.createdAt.getTime()) / MS_PER_DAY);
  const recencyWeight = Math.exp(-ageDays / HALF_LIFE_DAYS);
  const voteScore = 1 + Math.max(0, s.upvotes - s.downvotes);
  const verifiedBoost = s.submitter.verifiedContributor ? 2.0 : 1.0;
  const repBoost = 1 + Math.log10(1 + s.submitter.reputationPoints / 100);
  const keeperBoost = s.submitter.isTimeKeeper ? 3.0 : 1.0;
  return voteScore * recencyWeight * verifiedBoost * repBoost * keeperBoost;
}

export function rankTimeKeepers(submissions: KeeperSubmission[], now: Date = new Date()): RankedKeeper[] {
  if (submissions.length === 0) return [];

  const bySubmitter = new Map<string, KeeperSubmission[]>();
  for (const s of submissions) {
    const list = bySubmitter.get(s.submitterId) ?? [];
    list.push(s);
    bySubmitter.set(s.submitterId, list);
  }

  const ranked: RankedKeeper[] = [];
  for (const [id, subs] of bySubmitter.entries()) {
    const rating = subs.reduce((sum, s) => sum + scoreSubmissionWeight(s, now), 0);
    const latest = subs.slice().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    const latestVoteable = subs
      .filter(s => !!s.submissionId)
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    ranked.push({
      submitterId: id,
      submitterName: latest.submitterName,
      timings: latest.timings,
      rating,
      submissionCount: subs.length,
      verifiedContributor: latest.submitter.verifiedContributor,
      reputationPoints: latest.submitter.reputationPoints,
      latestSubmissionAt: latest.createdAt,
      latestSourceId: latest.sourceId ?? latest.submissionId,
      latestSourceType: latest.sourceType ?? 'timingSubmission',
      activeSchedule: subs.some(s => !!s.activeSchedule),
      verifiedSchedule: subs.some(s => !!s.verifiedSchedule),
      latestSubmissionId: latestVoteable?.submissionId ?? null,
    });
  }
  return ranked.sort((a, b) => b.rating - a.rating);
}

interface Bucket {
  time: string;
  weighted: number;
  contributors: Set<unknown>;
  supportCount: number;
  hasTimeKeeperSupport: boolean;
}

export function computeConsensus(
  submissions: ScoredSubmission[],
  prayer: string,
  now: Date = new Date()
): PrayerConsensus {
  if (submissions.length === 0) {
    return { time: null, confidence: 0, contributors: 0, supportCount: 0 };
  }

  const HALF_LIFE_DAYS = 14;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  const buckets = new Map<string, Bucket>();
  for (const s of submissions) {
    const t = s.timings[prayer];
    if (!t) continue;
    const ageDays = Math.max(0, (now.getTime() - s.createdAt.getTime()) / MS_PER_DAY);
    const recencyWeight = Math.exp(-ageDays / HALF_LIFE_DAYS);
    const voteScore = 1 + Math.max(0, s.upvotes - s.downvotes);
    const verifiedBoost = s.submitter.verifiedContributor ? 2.0 : 1.0;
    const repBoost = 1 + Math.log10(1 + s.submitter.reputationPoints / 100);
    const keeperBoost = s.submitter.isTimeKeeper ? 3.0 : 1.0;

    const weight = voteScore * recencyWeight * verifiedBoost * repBoost * keeperBoost;

    const b = buckets.get(t) ?? {
      time: t,
      weighted: 0,
      contributors: new Set(),
      supportCount: 0,
      hasTimeKeeperSupport: false,
    };
    b.weighted += weight;
    b.contributors.add(s);
    b.supportCount += 1;
    b.hasTimeKeeperSupport ||= !!s.submitter.isTimeKeeper;
    buckets.set(t, b);
  }

  if (buckets.size === 0) {
    return { time: null, confidence: 0, contributors: 0, supportCount: 0 };
  }

  const sorted = Array.from(buckets.values()).sort((a, b) => b.weighted - a.weighted);
  const top = sorted[0];
  const second = sorted[1]?.weighted ?? 0;
  const confidence = top.weighted / (top.weighted + second);

  return {
    time: top.time,
    confidence,
    contributors: top.contributors.size,
    supportCount: top.supportCount,
    hasTimeKeeperSupport: top.hasTimeKeeperSupport,
  };
}
