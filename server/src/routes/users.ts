import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { parsePagination, paginated } from '../lib/pagination';
import { authenticate } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

// Public-facing user shape. Excludes passwordHash, firebaseUid, deletedAt,
// and any other column that is internal to the auth/identity layer.
// Use this `select` for any endpoint that returns a user the client owns.
const publicUserSelect = {
  id: true,
  email: true,
  fullName: true,
  phoneNumber: true,
  preferredLanguage: true,
  notificationPreferences: true,
  defaultMosqueId: true,
  emailVerifiedAt: true,
  createdAt: true,
  updatedAt: true,
  lastLoginAt: true,
} as const;

async function countFollowerUsersForKeeper(keeperUserId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(DISTINCT u.id)::int AS "count"
    FROM users u
    CROSS JOIN LATERAL jsonb_each_text(COALESCE(u.notification_preferences->'preferredKeepers', '{}'::jsonb)) AS pk("mosqueId", "keeperId")
    WHERE u.deleted_at IS NULL
      AND pk."keeperId" = ${keeperUserId}
  `;
  return Number(rows[0]?.count) || 0;
}

const updateProfileSchema = z.object({
  fullName: z.string().min(1).max(255).optional(),
  phoneNumber: z.string().max(20).optional(),
  preferredLanguage: z.string().max(10).optional(),
  notificationPreferences: z
    .object({
      prayer_reminders: z.boolean().optional(),
      timing_updates: z.boolean().optional(),
    })
    .optional(),
  defaultMosqueId: z.string().uuid().nullable().optional(),
});

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const [row, timeKeeperFollowerCount] = await Promise.all([
      prisma.user.findUnique({
        where: { id: req.user!.id },
        select: {
          ...publicUserSelect,
          // Pulled to derive `hasGoogleAuth`, then dropped before responding.
          firebaseUid: true,
          defaultMosque: { select: { id: true, name: true, city: true } },
          _count: {
            select: {
              favorites: true,
              timingSubmissions: true,
              reviews: true,
            },
          },
        },
      }),
      countFollowerUsersForKeeper(req.user!.id),
    ]);
    if (!row) throw new AppError(404, 'User not found');
    const { firebaseUid, ...rest } = row;
    res.json({ ...rest, hasGoogleAuth: !!firebaseUid, timeKeeperFollowerCount });
  })
);

router.put(
  '/me',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const data = updateProfileSchema.parse(req.body);

    if (data.defaultMosqueId) {
      const mosque = await prisma.mosque.findFirst({
        where: { id: data.defaultMosqueId, deletedAt: null },
        select: { id: true },
      });
      if (!mosque) throw new AppError(400, 'defaultMosqueId references a non-existent mosque');
    }

    // notificationPreferences is a shared JSON blob: this endpoint owns
    // prayer_reminders/timing_updates, but other endpoints store
    // preferredKeepers and reminderPrefs in the same column. A bare Prisma
    // update replaces the whole value, silently wiping those nested keys, so
    // merge onto the existing blob (mirrors the preferred-keeper handler).
    let updateData: typeof data = data;
    if (data.notificationPreferences) {
      const existing = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { notificationPreferences: true },
      });
      const prev = (existing?.notificationPreferences as Record<string, unknown>) || {};
      updateData = {
        ...data,
        notificationPreferences: { ...prev, ...data.notificationPreferences } as any,
      };
    }

    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data: updateData,
      select: publicUserSelect,
    });
    res.json(updated);
  })
);

router.get(
  '/me/favorites',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const pagination = parsePagination(req);
    const where = { userId: req.user!.id };

    const [rows, totalCount] = await Promise.all([
      prisma.userFavorite.findMany({
        where,
        skip: pagination.skip,
        take: pagination.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          mosque: {
            select: {
              id: true,
              name: true,
              nameArabic: true,
              city: true,
              country: true,
              latitude: true,
              longitude: true,
              verified: true,
              status: true,
              addressLine1: true,
              amenities: true,
            },
          },
        },
      }),
      prisma.userFavorite.count({ where }),
    ]);

    res.json(paginated(rows, totalCount, pagination));
  })
);

router.get(
  '/me/notifications',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const pagination = parsePagination(req);
    const unreadOnly = req.query.unread === 'true';

    const where: any = { userId: req.user!.id };
    if (unreadOnly) where.read = false;

    const [rows, totalCount, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        skip: pagination.skip,
        take: pagination.limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId: req.user!.id, read: false } }),
    ]);

    res.json({ ...paginated(rows, totalCount, pagination), unreadCount });
  })
);

router.patch(
  '/me/notifications/:id/read',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const notification = await prisma.notification.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      select: { id: true, read: true },
    });
    if (!notification) throw new AppError(404, 'Notification not found');

    if (notification.read) {
      res.json({ id: notification.id, read: true, alreadyRead: true });
      return;
    }

    const updated = await prisma.notification.update({
      where: { id: notification.id },
      data: { read: true, readAt: new Date() },
    });
    res.json(updated);
  })
);

// Set (or clear) the user's preferred time keeper for a specific mosque.
// Storage: User.notificationPreferences.preferredKeepers[mosqueId] = keeperUserId
const preferredKeeperSchema = z.object({
  mosqueId: z.string().uuid(),
  keeperUserId: z.string().uuid().nullable(),
});

async function validatePreferredKeeperTarget(mosqueId: string, keeperUserId: string) {
  const [mosque, keeper, timingSubmission, prayerSchedule] = await Promise.all([
    prisma.mosque.findFirst({
      where: { id: mosqueId, deletedAt: null },
      select: { id: true },
    }),
    prisma.user.findFirst({
      where: { id: keeperUserId, deletedAt: null },
      select: { id: true },
    }),
    prisma.timingSubmission.findFirst({
      where: {
        mosqueId,
        submittedById: keeperUserId,
        status: { notIn: ['rejected', 'withdrawn'] },
      },
      select: { id: true },
    }),
    prisma.prayerSchedule.findFirst({
      where: {
        mosqueId,
        submittedById: keeperUserId,
        deletedAt: null,
      },
      select: { id: true },
    }),
  ]);

  if (!mosque) throw new AppError(404, 'Mosque not found');
  if (!keeper) throw new AppError(404, 'Keeper user not found');
  if (!timingSubmission && !prayerSchedule) {
    throw new AppError(400, 'Preferred keeper must be an active time keeper for this masjid');
  }
}

router.put(
  '/me/preferred-keeper',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { mosqueId, keeperUserId } = preferredKeeperSchema.parse(req.body);

    const me = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { notificationPreferences: true },
    });
    if (!me) throw new AppError(404, 'User not found');

    const prefs = (me.notificationPreferences as Record<string, unknown>) || {};
    const keepers = (prefs.preferredKeepers as Record<string, string>) || {};
    if (keeperUserId === null) {
      delete keepers[mosqueId];
    } else {
      await validatePreferredKeeperTarget(mosqueId, keeperUserId);
      keepers[mosqueId] = keeperUserId;
    }

    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data: { notificationPreferences: { ...prefs, preferredKeepers: keepers } as any },
      select: { notificationPreferences: true },
    });

    res.json({
      mosqueId,
      keeperUserId,
      preferredKeepers: (updated.notificationPreferences as Record<string, unknown>)?.preferredKeepers ?? {},
    });
  })
);

// Cross-device reminder-pref sync. The full pref blob lives in the browser's
// localStorage as the source of truth for the active session, but we mirror
// it server-side so signing in on a second device pulls the same config.
// Schema is intentionally permissive — clients evolve faster than this route.
const reminderPrefsSchema = z.object({
  enabled: z.boolean().optional(),
  perPrayer: z.record(z.string(), z.number().int().min(1).max(120).nullable()).optional(),
  prayerEnabled: z.record(z.string(), z.boolean()).optional(),
  defaultLeadMins: z.number().int().min(1).max(120).optional(),
}).passthrough();

router.put(
  '/me/reminder-prefs',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const incoming = reminderPrefsSchema.parse(req.body);

    const me = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { notificationPreferences: true },
    });
    if (!me) throw new AppError(404, 'User not found');
    const prefs = (me.notificationPreferences as Record<string, unknown>) || {};

    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data: { notificationPreferences: { ...prefs, reminderPrefs: incoming } as any },
      select: { notificationPreferences: true },
    });
    res.json({
      reminderPrefs: (updated.notificationPreferences as Record<string, unknown>)?.reminderPrefs ?? {},
    });
  })
);

router.post(
  '/me/notifications/read-all',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const result = await prisma.notification.updateMany({
      where: { userId: req.user!.id, read: false },
      data: { read: true, readAt: new Date() },
    });
    res.json({ marked: result.count });
  })
);

// ─── Self-service account deletion (Google Play 2024+ requirement) ───
// Soft-deletes the user row (sets deletedAt) and prunes the bits of
// state that only matter to a present, signed-in user:
//   - favorites: clear (the user no longer has anyone to follow)
//   - reminder + preferred-keeper prefs: cleared via JSON wipe of
//     notificationPreferences (those settings live there as JSON; see
//     the put /me/preferred-keeper and /me/reminder-prefs handlers)
//   - sent suggestions: deleted (recipient inbox should not keep
//     showing pending items from a now-deleted user)
//   - default mosque: cleared (FK is nullable; otherwise it'd block
//     a future hard-delete)
//
// What we do NOT delete:
//   - timing_submissions: kept and re-attributed anonymously when
//     the response layer surfaces them. Other users in the
//     community are relying on these times right now to know when
//     to be at jamat — pulling them on account-delete punishes
//     people who weren't even involved in the deletion. This is
//     disclosed in the privacy policy and in the in-app
//     confirmation dialog.
//   - mosque_reviews / votes: same reasoning (community state).
//     If the user wants those gone too, they can email us
//     for a manual wipe.
//   - suggestions sent TO the user: those belong to the senders
//     (they should still see what they sent and that this recipient
//     is gone).
//   - mosques the user added: addedBy is nullable; we leave the
//     mosque + null the user FK via the schema's SET NULL behavior
//     when we eventually hard-delete. Soft-delete keeps the FK,
//     so this is a no-op until then.
//
// The handler keeps an alreadyDeleted branch for internal/admin callers,
// but public requests normally won't reach it after the first deletion:
// authenticate rejects deleted users so old JWTs cannot keep working.
router.delete(
  '/me',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;

    const existing = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, deletedAt: true },
    });
    if (!existing) throw new AppError(404, 'User not found');

    if (existing.deletedAt) {
      return res.json({ id: userId, deleted: true, alreadyDeleted: true });
    }

    // Order matters: delete dependents first so a future hard-delete
    // doesn't break on FK constraints. Wrap in a transaction so a
    // partial failure rolls back rather than half-deleting the user.
    await prisma.$transaction(async (tx) => {
      // 1) favorites
      await tx.userFavorite.deleteMany({ where: { userId } });

      // 1b) private personal prayer debt records. These are user-owned,
      // not community state, so remove them during account deletion.
      await tx.qazaRecord.deleteMany({ where: { userId } });

      // 2) suggestions sent BY the user (recipient inbox). Suggestions
      //    received are intentionally retained — see header comment.
      await tx.suggestion.deleteMany({ where: { fromUserId: userId } });

      // 3) clear the JSON prefs blob (reminder prefs + preferred-keeper
      //    map both live in notificationPreferences). Setting it back
      //    to the schema default means subsequent /me/* writes from a
      //    re-registration on the same email start fresh.
      // 4) null the default-mosque FK so a future Mosque delete
      //    isn't blocked by this orphan reference.
      // 5) flip the soft-delete tombstone.
      await tx.user.update({
        where: { id: userId },
        data: {
          deletedAt: new Date(),
          defaultMosqueId: null,
          notificationPreferences: { prayer_reminders: true, timing_updates: true } as any,
        },
      });
    });

    res.json({ id: userId, deleted: true, alreadyDeleted: false });
  })
);

export default router;
