import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { parsePagination, paginated } from '../lib/pagination';
import { authenticate, optionalAuth } from '../middleware/auth';
import { submissionsLimiter, votesLimiter } from '../middleware/rateLimit';
import { notifyKeeperUpdate } from '../lib/fcm';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { computeConsensus, shouldPromoteConsensus, ScoredSubmission, CurrentSchedule } from '../lib/consensus';
import { installIfActiveKeeperSubmission } from '../lib/schedulePromotion';

// Maghrib is excluded — it's astronomical (sunset + per-mosque offset),
// not a clock time we run consensus on. The offset is consensus'd separately.
const PRAYERS = ['fajr', 'dhuhr', 'asr', 'isha', 'jummah'];

/**
 * After a new submission, recompute per-prayer consensus across recent
 * submissions and decide whether to promote the active schedule.
 *
 * Returns the list of prayers whose times changed (for logging / response).
 */
export async function recomputeAndPromote(mosqueId: string): Promise<Array<{ prayer: string; action: string; reason: string; from?: string; to?: string }>> {
  const LOOKBACK_DAYS = 60;
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const burst48hSince = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const [submissions, current] = await Promise.all([
    prisma.timingSubmission.findMany({
      where: {
        mosqueId,
        createdAt: { gte: since },
        status: { notIn: ['rejected', 'withdrawn'] },
      },
      include: { submittedBy: { select: { id: true, reputationPoints: true, verifiedContributor: true } } },
    }),
    prisma.prayerSchedule.findFirst({
      where: { mosqueId, isActive: true, deletedAt: null },
      orderBy: { validFrom: 'desc' },
    }),
  ]);

  const burst48hCount = submissions.filter(s => s.createdAt >= burst48hSince).length;

  const scored: ScoredSubmission[] = submissions.map(s => ({
    timings: (s.timings as { [k: string]: string }) || {},
    upvotes: s.upvotes,
    downvotes: s.downvotes,
    createdAt: s.createdAt,
    submitter: {
      reputationPoints: s.submittedBy?.reputationPoints ?? 0,
      verifiedContributor: !!s.submittedBy?.verifiedContributor,
      isTimeKeeper: !!current?.submittedById && s.submittedById === current.submittedById,
    },
  }));

  const currentTimings = (current?.timings as { [k: string]: string | string[] }) || {};
  const currentForLib: CurrentSchedule | null = current
    ? { timings: currentTimings, verificationStatus: current.verificationStatus, validFrom: current.validFrom }
    : null;

  const newTimings: { [k: string]: string | string[] } = { ...currentTimings };
  const changes: Array<{ prayer: string; action: string; reason: string; from?: string; to?: string }> = [];

  for (const prayer of PRAYERS) {
    const consensus = computeConsensus(scored, prayer);
    const decision = shouldPromoteConsensus(consensus, currentForLib, prayer, burst48hCount);
    if (decision.shouldPromote && consensus.time) {
      const cur = currentTimings[prayer];
      const fromTime = Array.isArray(cur) ? cur[0] : cur;
      newTimings[prayer] = consensus.time;
      changes.push({ prayer, action: 'promoted', reason: decision.reason, from: fromTime, to: consensus.time });
    }
  }

  // Maghrib offset: simple weighted-mode across submissions that set it.
  // Weight by submitter (verified ×3, reputation log-bumped) so a troll
  // can't drag the offset around. Fall back to current value.
  const offsetTallies = new Map<number, number>();
  for (const s of submissions) {
    const off = (s.timings as { maghribOffset?: number })?.maghribOffset;
    if (typeof off !== 'number' || !Number.isFinite(off)) continue;
    const verifiedW = s.submittedBy?.verifiedContributor ? 3 : 1;
    const repW = 1 + Math.log10(Math.max(1, s.submittedBy?.reputationPoints ?? 0));
    offsetTallies.set(off, (offsetTallies.get(off) || 0) + verifiedW * repW);
  }
  if (offsetTallies.size > 0) {
    const winner = [...offsetTallies.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const cur = (currentTimings as { maghribOffset?: number }).maghribOffset;
    if (cur !== winner) {
      (newTimings as { maghribOffset?: number }).maghribOffset = winner;
      changes.push({ prayer: 'maghribOffset', action: 'promoted', reason: 'weighted-mode of recent submissions', from: cur != null ? String(cur) : undefined, to: String(winner) });
    }
  }

  if (changes.length === 0) return [];

  // Deactivate current pending schedule, install new one with updated timings.
  // Verified schedules: when overridden, the new one is `pending` (the
  // override needs human re-verification before claiming the verified label).
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const newStatus = current?.verificationStatus === 'verified' && changes.length > 0
    ? 'pending' // change to verified schedule → new schedule is pending re-verification
    : 'pending';

  await prisma.$transaction(async (tx) => {
    if (current) {
      await tx.prayerSchedule.update({
        where: { id: current.id },
        data: { isActive: false, validUntil: today },
      });
    }
    await tx.prayerSchedule.create({
      data: {
        mosqueId,
        timings: newTimings,
        verificationStatus: newStatus,
        validFrom: today,
        isActive: true,
      },
    });
  });

  return changes;
}

const router = Router();

const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm');

const timingsSchema = z.object({
  fajr: timeString.optional(),
  dhuhr: timeString.optional(),
  asr: timeString.optional(),
  // No maghrib HH:MM — Maghrib follows astronomical sunset at the mosque's
  // coordinates. Contributors set the takbeer offset (minutes after sunset).
  maghribOffset: z.number().int().min(0).max(60).optional(),
  isha: timeString.optional(),
  jummah: z.array(timeString).max(5).optional(),
});

const createSubmissionSchema = z.object({
  mosqueId: z.string().uuid(),
  timings: timingsSchema,
  notes: z.string().max(2000).optional(),
  isVerifiedOnsite: z.boolean().default(false),
  proofPhotos: z.array(z.string().url()).max(5).default([]),
});

const voteSchema = z.object({
  voteType: z.enum(['upvote', 'downvote', 'report']),
  reportReason: z.string().max(100).optional(),
});

const reviewSubmissionSchema = z.object({
  action: z.enum(['approve', 'reject']),
  reviewNotes: z.string().max(2000).optional(),
});

const REPUTATION_REWARD = {
  newSubmission: 5,
  approved: 10,
} as const;

router.post(
  '/',
  authenticate,
  submissionsLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const data = createSubmissionSchema.parse(req.body);

    const mosque = await prisma.mosque.findFirst({
      where: { id: data.mosqueId, deletedAt: null },
      select: { id: true },
    });
    if (!mosque) throw new AppError(404, 'Mosque not found');

    const submission = await prisma.$transaction(async (tx) => {
      const created = await tx.timingSubmission.create({
        data: {
          mosqueId: data.mosqueId,
          submittedById: req.user!.id,
          timings: data.timings,
          notes: data.notes,
          isVerifiedOnsite: data.isVerifiedOnsite,
          proofPhotos: data.proofPhotos,
        },
      });
      await tx.user.update({
        where: { id: req.user!.id },
        data: { reputationPoints: { increment: REPUTATION_REWARD.newSubmission } },
      });
      await tx.activityLog.create({
        data: {
          userId: req.user!.id,
          activityType: 'timing_submission_created',
          entityType: 'TimingSubmission',
          entityId: undefined,
          metadata: { mosqueId: data.mosqueId },
        },
      });
      return created;
    });

    // A current time keeper is authoritative over their own active record:
    // merge their submitted keys over the canonical schedule immediately so
    // every attendee sees the update, not only followers reading the keeper
    // submission fallback. Non-keeper submissions still flow through consensus.
    const activeKeeperChanges = await prisma.$transaction(tx => installIfActiveKeeperSubmission(tx, {
      mosqueId: data.mosqueId,
      submittedById: req.user!.id,
      timings: data.timings,
    }));
    const changes = activeKeeperChanges ?? await recomputeAndPromote(data.mosqueId);

    res.status(201).json({ submission, scheduleChanges: changes });

    // Fire-and-forget: ping every device that follows THIS keeper at THIS
    // masjid via FCM topic `keeper-<keeperId>-mosque-<mosqueId>`. Send
    // regardless of whether `changes` is empty — followers of this keeper
    // still want to know when their keeper submitted, even if the new
    // values matched what was already active. See docs/PUSH_NOTIFICATIONS.md.
    //
    // We need the keeper's name + the masjid's name for the notification
    // copy, so look both up in parallel after the response is sent. A
    // failure here MUST NOT bubble into the user's submission flow.
    Promise.all([
      prisma.user.findUnique({ where: { id: req.user!.id }, select: { fullName: true, email: true } }),
      prisma.mosque.findUnique({ where: { id: data.mosqueId }, select: { name: true } }),
    ]).then((args) => {
      const [keeper, masjid] = args;
      return notifyKeeperUpdate({
        mosqueId: data.mosqueId,
        submitterId: req.user!.id,
        submissionId: submission.id,
        keeperName: keeper?.fullName || keeper?.email || 'A time keeper',
        mosqueName: masjid?.name || 'a masjid',
        timings: data.timings as Record<string, unknown>,
        scheduleChanges: changes,
      });
    }).then((result) => {
      // Single visible trail for ops: was a push attempted, what topic,
      // and did it land. When the app team says "I didn't get the push,"
      // the answer is one log query on submissionId away.
      // eslint-disable-next-line no-console
      console.info('[submissions] fcm result', {
        submissionId: submission.id,
        ...result,
      });
    }).catch(err => {
      // eslint-disable-next-line no-console
      console.error('[submissions] FCM notify failed', { err: (err as Error).message });
    });
  })
);

const listSubmissionsQuery = z.object({
  status: z.enum(['pending', 'verified', 'approved', 'rejected', 'withdrawn']).default('pending'),
  mosqueId: z.string().uuid().optional(),
});

router.get(
  '/',
  optionalAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const pagination = parsePagination(req);
    // Validate before touching Prisma: a non-uuid mosqueId would otherwise
    // reach the uuid column and surface as a 500 instead of a clean 400.
    const { status, mosqueId } = listSubmissionsQuery.parse(req.query);

    const where: any = { status };
    if (mosqueId) where.mosqueId = mosqueId;

    const [rows, totalCount] = await Promise.all([
      prisma.timingSubmission.findMany({
        where,
        skip: pagination.skip,
        take: pagination.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          mosque: { select: { id: true, name: true, city: true } },
          submittedBy: { select: { id: true, fullName: true, reputationPoints: true } },
        },
      }),
      prisma.timingSubmission.count({ where }),
    ]);

    res.json(paginated(rows, totalCount, pagination));
  })
);

router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const submission = await prisma.timingSubmission.findUnique({
      where: { id: req.params.id },
      include: {
        mosque: { select: { id: true, name: true, city: true, country: true } },
        submittedBy: { select: { id: true, fullName: true, reputationPoints: true, verifiedContributor: true } },
        reviewedBy: { select: { id: true, fullName: true } },
      },
    });
    if (!submission) throw new AppError(404, 'Submission not found');
    res.json(submission);
  })
);

router.post(
  '/:id/vote',
  authenticate,
  votesLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const { voteType, reportReason } = voteSchema.parse(req.body);

    const submission = await prisma.timingSubmission.findUnique({
      where: { id: req.params.id },
      select: { id: true, submittedById: true },
    });
    if (!submission) throw new AppError(404, 'Submission not found');
    if (submission.submittedById === req.user!.id) {
      throw new AppError(400, 'Cannot vote on your own submission');
    }

    const existing = await prisma.vote.findUnique({
      where: {
        userId_votableType_votableId: {
          userId: req.user!.id,
          votableType: 'TimingSubmission',
          votableId: submission.id,
        },
      },
    });

    if (existing && existing.voteType === voteType) {
      // toggle off
      await prisma.$transaction([
        prisma.vote.delete({ where: { id: existing.id } }),
        prisma.timingSubmission.update({
          where: { id: submission.id },
          data: { [columnForVote(voteType)]: { decrement: 1 } } as any,
        }),
      ]);
      res.json({ voted: false, voteType });
      return;
    }

    if (existing) {
      // change vote type
      await prisma.$transaction([
        prisma.vote.update({
          where: { id: existing.id },
          data: { voteType, reportReason: voteType === 'report' ? reportReason : null },
        }),
        prisma.timingSubmission.update({
          where: { id: submission.id },
          data: {
            [columnForVote(existing.voteType)]: { decrement: 1 },
            [columnForVote(voteType)]: { increment: 1 },
          } as any,
        }),
      ]);
    } else {
      await prisma.$transaction([
        prisma.vote.create({
          data: {
            userId: req.user!.id,
            votableType: 'TimingSubmission',
            votableId: submission.id,
            voteType,
            reportReason: voteType === 'report' ? reportReason : null,
          },
        }),
        prisma.timingSubmission.update({
          where: { id: submission.id },
          data: { [columnForVote(voteType)]: { increment: 1 } } as any,
        }),
      ]);
    }

    res.json({ voted: true, voteType });
  })
);

router.post(
  '/:id/review',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { action, reviewNotes } = reviewSubmissionSchema.parse(req.body);

    const reviewer = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { verifiedContributor: true },
    });
    if (!reviewer?.verifiedContributor) {
      throw new AppError(403, 'Only verified contributors can review submissions');
    }

    const submission = await prisma.timingSubmission.findUnique({
      where: { id: req.params.id },
      select: { id: true, status: true, submittedById: true, mosqueId: true, timings: true },
    });
    if (!submission) throw new AppError(404, 'Submission not found');
    if (submission.status !== 'pending') throw new AppError(400, 'Submission already reviewed');

    if (action === 'reject') {
      const updated = await prisma.timingSubmission.update({
        where: { id: submission.id },
        data: {
          status: 'rejected',
          reviewedById: req.user!.id,
          reviewNotes,
          verified: false,
        },
      });
      res.json(updated);
      return;
    }

    // approve: write timings into a new active PrayerSchedule, deactivate prior
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const result = await prisma.$transaction(async (tx) => {
      await tx.prayerSchedule.updateMany({
        where: { mosqueId: submission.mosqueId, isActive: true },
        data: { isActive: false, validUntil: today },
      });

      await tx.prayerSchedule.create({
        data: {
          mosqueId: submission.mosqueId,
          timings: submission.timings as any,
          submittedById: submission.submittedById,
          verifiedById: req.user!.id,
          verificationStatus: 'verified',
          validFrom: today,
          isActive: true,
        },
      });

      const updated = await tx.timingSubmission.update({
        where: { id: submission.id },
        data: {
          status: 'approved',
          reviewedById: req.user!.id,
          reviewNotes,
          verified: true,
        },
      });

      await tx.user.update({
        where: { id: submission.submittedById },
        data: { reputationPoints: { increment: REPUTATION_REWARD.approved } },
      });

      return updated;
    });

    res.json(result);
  })
);

function columnForVote(voteType: string): 'upvotes' | 'downvotes' | 'reports' {
  if (voteType === 'upvote') return 'upvotes';
  if (voteType === 'downvote') return 'downvotes';
  return 'reports';
}

export default router;
