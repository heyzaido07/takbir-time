import { Router, Request, Response } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { notifyKeeperUpdate, notifyOnSuggest } from '../lib/fcm';
import { suggestionsLimiter } from '../middleware/rateLimit';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { installMergedActiveSchedule } from '../lib/schedulePromotion';

const router = Router();

const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm');

// Same shape as the submissions Zod schema, minus the proof/photo fields.
const timingsSchema = z.object({
  fajr: timeString.optional(),
  dhuhr: timeString.optional(),
  asr: timeString.optional(),
  maghribOffset: z.number().int().min(0).max(60).optional(),
  isha: timeString.optional(),
  jummah: z.array(timeString).max(5).optional(),
});

const createSuggestionSchema = z.object({
  toUserId: z.string().uuid(),
  mosqueId: z.string().uuid(),
  timings: timingsSchema,
  notes: z.string().max(2000).optional(),
});

const declineSchema = z.object({
  note: z.string().max(2000).optional(),
});

type KeeperStandingClient = Pick<Prisma.TransactionClient, 'mosque' | 'timingSubmission' | 'user'>;

async function hasKeeperStanding(db: KeeperStandingClient, mosqueId: string, userId: string): Promise<boolean> {
  const [mosque, recipient, priorSubmission] = await Promise.all([
    db.mosque.findFirst({
      where: { id: mosqueId, deletedAt: null },
      select: { id: true, addedById: true },
    }),
    db.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true },
    }),
    db.timingSubmission.findFirst({
      where: {
        mosqueId,
        submittedById: userId,
        status: { not: 'rejected' },
      },
      select: { id: true },
    }),
  ]);

  if (!mosque || !recipient) return false;
  return !!priorSubmission || mosque.addedById === userId;
}

router.use(authenticate);

// Send a suggestion to a keeper. The keeper sees it in their inbox top-bar.
router.post(
  '/',
  suggestionsLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = createSuggestionSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, `Validation Error: ${parsed.error.issues.map(i => i.message).join('; ')}`);
    const { toUserId, mosqueId, timings, notes } = parsed.data;

    if (toUserId === req.user!.id) {
      throw new AppError(400, "Can't send a suggestion to yourself");
    }

    if (!(await hasKeeperStanding(prisma, mosqueId, toUserId))) {
      throw new AppError(400, 'Recipient is not a time keeper for this mosque');
    }

    const suggestion = await prisma.suggestion.create({
      data: {
        fromUserId: req.user!.id,
        toUserId,
        mosqueId,
        timings,
        notes: notes ?? null,
      },
    });
    res.status(201).json({ suggestion });

    // Fire-and-forget push to the keeper's "suggest-to-<id>" topic so
    // their device pings them rather than waiting on next app launch.
    // Same contract as the submissions hook: failures log but never
    // bubble into the user's response. See docs/PUSH_NOTIFICATIONS.md.
    Promise.all([
      prisma.user.findUnique({ where: { id: req.user!.id }, select: { fullName: true, email: true } }),
      prisma.mosque.findUnique({ where: { id: mosqueId }, select: { name: true } }),
    ]).then(([fromUser, mosque]) => {
      return notifyOnSuggest({
        suggestionId: suggestion.id,
        toUserId,
        mosqueId,
        fromUserName: fromUser?.fullName || fromUser?.email || 'Someone',
        mosqueName:   mosque?.name || 'a masjid',
        timings:      timings as Record<string, unknown>,
        notes:        notes ?? undefined,
      });
    }).then((r) => {
      // eslint-disable-next-line no-console
      console.info('[suggestions] suggest fcm result', { suggestionId: suggestion.id, ...r });
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[suggestions] notifyOnSuggest failed', { err: (err as Error).message });
    });
  })
);

// Inbox: pending suggestions sent TO the authenticated user. Joined with
// fromUser + mosque so the UI can show "X (city) suggested fajr 04:50…".
router.get(
  '/inbox',
  asyncHandler(async (req: Request, res: Response) => {
    const suggestions = await prisma.suggestion.findMany({
      where: { toUserId: req.user!.id, status: 'pending' },
      include: {
        fromUser: { select: { id: true, fullName: true, email: true, reputationPoints: true, verifiedContributor: true } },
        mosque: { select: { id: true, name: true, city: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Pull the current active timings for each unique mosque so the UI can
    // render an old → new diff per prayer. One query, indexed by mosqueId.
    const mosqueIds = [...new Set(suggestions.map(s => s.mosqueId))];
    const schedules = mosqueIds.length === 0 ? [] : await prisma.prayerSchedule.findMany({
      where: { mosqueId: { in: mosqueIds }, isActive: true, deletedAt: null },
      orderBy: { validFrom: 'desc' },
      select: { mosqueId: true, timings: true },
    });
    const currentByMosque = new Map<string, unknown>();
    for (const s of schedules) {
      if (!currentByMosque.has(s.mosqueId)) currentByMosque.set(s.mosqueId, s.timings);
    }

    const enriched = suggestions.map(s => ({
      ...s,
      currentTimings: currentByMosque.get(s.mosqueId) ?? {},
    }));

    res.json({ suggestions: enriched });
  })
);

async function findOwnedSuggestion(id: string, userId: string) {
  const s = await prisma.suggestion.findUnique({ where: { id } });
  if (!s) throw new AppError(404, 'Suggestion not found');
  if (s.toUserId !== userId) throw new AppError(403, 'Not your suggestion to act on');
  return s;
}

// Accept: mark accepted, create a TimingSubmission as the keeper for the
// audit trail, AND directly install the suggested timings on the mosque's
// active schedule. The keeper is authoritative over their own record — we
// don't gate this on the consensus floor or min-contributor thresholds,
// because the keeper deliberately said "yes, these are my times now".
router.post(
  '/:id/accept',
  asyncHandler(async (req: Request, res: Response) => {
    const s = await findOwnedSuggestion(req.params.id, req.user!.id);
    if (s.status !== 'pending') throw new AppError(400, `Already ${s.status}`);

    const result = await prisma.$transaction(async (tx) => {
      // SECURITY: an old/stale suggestion row must not become a shortcut
      // to schedule authority. Create-time validation should already have
      // targeted an established keeper, but accept enforces the invariant
      // again because the row may predate this check or have been inserted
      // outside the route.
      if (!(await hasKeeperStanding(tx, s.mosqueId, s.toUserId))) {
        throw new AppError(403, 'Recipient is not a time keeper for this mosque');
      }

      // Audit trail: the keeper's own submission with the accepted values.
      const submission = await tx.timingSubmission.create({
        data: {
          mosqueId: s.mosqueId,
          submittedById: s.toUserId,
          timings: s.timings as any,
          notes: `Accepted suggestion from user ${s.fromUserId}`,
        },
      });

      const updated = await tx.suggestion.update({
        where: { id: s.id },
        data: { status: 'accepted', respondedAt: new Date() },
      });

      const changes = await installMergedActiveSchedule(tx, {
        mosqueId: s.mosqueId,
        submittedById: s.toUserId,
        verifiedById: s.toUserId,
        timings: s.timings,
        verificationStatus: 'verified',
        reason: 'accepted suggestion',
      });

      return { updated, submission, changes };
    });

    res.json({ suggestion: result.updated });

    // Fire-and-forget keeper-update push to followers of (keeper, masjid).
    // Identical contract to POST /submissions: a failure must NOT bubble
    // into the user's accept response. See docs/PUSH_NOTIFICATIONS.md.
    Promise.all([
      prisma.user.findUnique({ where: { id: s.toUserId }, select: { fullName: true, email: true } }),
      prisma.mosque.findUnique({ where: { id: s.mosqueId }, select: { name: true } }),
    ]).then(([keeper, masjid]) => {
      return notifyKeeperUpdate({
        mosqueId: s.mosqueId,
        submitterId: s.toUserId,
        submissionId: result.submission.id,
        keeperName: keeper?.fullName || keeper?.email || 'A time keeper',
        mosqueName: masjid?.name || 'a masjid',
        timings: s.timings as Record<string, unknown>,
        scheduleChanges: result.changes,
      });
    }).then((r) => {
      // eslint-disable-next-line no-console
      console.info('[suggestions] fcm result', { suggestionId: s.id, ...r });
    }).catch(err => {
      // eslint-disable-next-line no-console
      console.error('[suggestions] FCM notify failed', { err: (err as Error).message });
    });
  })
);

// Decline: just mark the suggestion declined. No submission created.
router.post(
  '/:id/decline',
  asyncHandler(async (req: Request, res: Response) => {
    const s = await findOwnedSuggestion(req.params.id, req.user!.id);
    if (s.status !== 'pending') throw new AppError(400, `Already ${s.status}`);

    const parsed = declineSchema.safeParse(req.body || {});
    if (!parsed.success) throw new AppError(400, `Validation Error: ${parsed.error.issues.map(i => i.message).join('; ')}`);

    const updated = await prisma.suggestion.update({
      where: { id: s.id },
      data: {
        status: 'declined',
        respondedAt: new Date(),
        respondedNote: parsed.data.note ?? null,
      },
    });
    res.json({ suggestion: updated });
  })
);

export default router;
