import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { parsePagination, paginated } from '../lib/pagination';
import { authenticate, optionalAuth } from '../middleware/auth';
import { mosquesCreateLimiter } from '../middleware/rateLimit';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { computeConsensus, ScoredSubmission, rankTimeKeepers, KeeperSubmission, RankedKeeper } from '../lib/consensus';
import { trackActivity } from '../lib/activity';

const router = Router();

const CAPTCHA_TTL_MS = 10 * 60 * 1000;
const captchaChallenges = new Map<string, { answer: string; expiresAt: number }>();

function pruneCaptchaChallenges() {
  const now = Date.now();
  for (const [id, challenge] of captchaChallenges) {
    if (challenge.expiresAt <= now) captchaChallenges.delete(id);
  }
}

function createCaptchaChallenge() {
  pruneCaptchaChallenges();
  const a = crypto.randomInt(2, 13);
  const b = crypto.randomInt(2, 13);
  const useMultiply = crypto.randomInt(0, 5) === 0;
  const answer = useMultiply ? a * b : a + b;
  const id = crypto.randomUUID();
  captchaChallenges.set(id, {
    answer: String(answer),
    expiresAt: Date.now() + CAPTCHA_TTL_MS,
  });
  return {
    id,
    question: `What is ${a} ${useMultiply ? 'x' : '+'} ${b}?`,
    expiresInSeconds: Math.floor(CAPTCHA_TTL_MS / 1000),
  };
}

function verifyCaptcha(input: { id: string; answer: string }) {
  pruneCaptchaChallenges();
  const challenge = captchaChallenges.get(input.id);
  if (!challenge) return false;
  captchaChallenges.delete(input.id);
  return input.answer.trim().toLowerCase() === challenge.answer;
}

const captchaSchema = z.object({
  id: z.string().min(10).max(120),
  answer: z.union([z.string(), z.number()]).transform(v => String(v).trim()),
});

const createMosqueSchema = z.object({
  name: z.string().min(1).max(255),
  nameArabic: z.string().max(255).optional(),
  description: z.string().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  addressLine1: z.string().max(255).optional(),
  addressLine2: z.string().max(255).optional(),
  city: z.string().min(1).max(100),
  stateProvince: z.string().max(100).optional(),
  country: z.string().min(1).max(100),
  postalCode: z.string().max(20).optional(),
  phoneNumber: z.string().max(20).optional(),
  email: z.string().email().optional(),
  website: z.string().url().optional(),
  capacity: z.number().int().positive().optional(),
  yearEstablished: z.number().int().min(600).max(new Date().getFullYear()).optional(),
  denomination: z.string().max(50).optional(),
  madhab: z.string().max(50).optional(),
  amenities: z.array(z.string()).optional(),
  captcha: captchaSchema,
});

const updateMosqueSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  nameArabic: z.string().max(255).optional(),
  description: z.string().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  addressLine1: z.string().max(255).optional(),
  addressLine2: z.string().max(255).optional(),
  city: z.string().min(1).max(100).optional(),
  stateProvince: z.string().max(100).optional(),
  country: z.string().min(1).max(100).optional(),
  postalCode: z.string().max(20).optional(),
  phoneNumber: z.string().max(20).optional(),
  email: z.string().email().optional(),
  website: z.string().url().optional(),
  capacity: z.number().int().positive().optional(),
  yearEstablished: z.number().int().min(600).max(new Date().getFullYear()).optional(),
  denomination: z.string().max(50).optional(),
  madhab: z.string().max(50).optional(),
  amenities: z.array(z.string()).optional(),
});

const listQuerySchema = z.object({
  city: z.string().optional(),
  country: z.string().optional(),
  search: z.string().optional(),
  verified: z.enum(['true', 'false']).optional(),
});

const PUBLIC_MOSQUE_STATUSES = ['active', 'closed'] as const;
const mosqueStatusSchema = z.object({
  status: z.enum(PUBLIC_MOSQUE_STATUSES),
});

const nearbyQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  // Radius may widen in sparse regions, but result count remains capped
  // tightly so map labels and mobile list rendering stay predictable.
  radius: z.coerce.number().int().positive().max(200000).default(5000),
  limit: z.coerce.number().int().positive().max(20).default(20),
});

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  timingAccuracyRating: z.number().int().min(1).max(5).optional(),
  cleanlinessRating: z.number().int().min(1).max(5).optional(),
  accessibilityRating: z.number().int().min(1).max(5).optional(),
  title: z.string().max(200).optional(),
  reviewText: z.string().optional(),
});

// `db` lets these helpers run either standalone (default `prisma`) or inside
// a caller's transaction (pass the `tx` client) so multi-step mutations stay
// atomic and reads see the transaction's own uncommitted writes.
type DbClient = Prisma.TransactionClient;

async function countKeeperFollowers(mosqueId: string, db: DbClient = prisma): Promise<Map<string, number>> {
  const rows = await db.$queryRaw<Array<{ keeperId: string | null; count: number }>>`
    SELECT
      jsonb_extract_path_text(notification_preferences, 'preferredKeepers', ${mosqueId}) AS "keeperId",
      COUNT(*)::int AS "count"
    FROM users
    WHERE deleted_at IS NULL
      AND jsonb_extract_path_text(notification_preferences, 'preferredKeepers', ${mosqueId}) IS NOT NULL
    GROUP BY 1
  `;
  return new Map(rows.filter(r => r.keeperId).map(r => [r.keeperId!, Number(r.count) || 0]));
}

function attachFollowerCounts(keepers: RankedKeeper[], followerCounts: Map<string, number>): RankedKeeper[] {
  return keepers.map(k => ({
    ...k,
    followerCount: followerCounts.get(k.submitterId) ?? 0,
  }));
}

function isUnnamedMosqueName(name: string | null | undefined): boolean {
  const trimmed = (name || '').trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  if (lower === 'unnamed masjid' || lower === 'unnamed mosque') return true;
  return /^mosque \(osm (way|node|relation) \d+\)$/i.test(trimmed);
}

const KEEPER_TIMING_LOOKBACK_DAYS = 60;
const KEEPER_SCHEDULE_HISTORY_LIMIT = 100;

async function rankedKeepersForMosque(mosqueId: string, db: DbClient = prisma): Promise<RankedKeeper[]> {
  const since = new Date(Date.now() - KEEPER_TIMING_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const [submissions, schedules, followerCounts] = await Promise.all([
    db.timingSubmission.findMany({
      where: {
        mosqueId,
        createdAt: { gte: since },
        status: { notIn: ['rejected', 'withdrawn'] },
      },
      include: { submittedBy: { select: { id: true, fullName: true, reputationPoints: true, verifiedContributor: true } } },
    }),
    db.prayerSchedule.findMany({
      where: {
        mosqueId,
        deletedAt: null,
        submittedById: { not: null },
      },
      orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
      take: KEEPER_SCHEDULE_HISTORY_LIMIT,
      include: { submittedBy: { select: { id: true, fullName: true, reputationPoints: true, verifiedContributor: true } } },
    }),
    countKeeperFollowers(mosqueId, db),
  ]);

  const keeperSubs: KeeperSubmission[] = [
    ...submissions
      .filter(s => s.submittedBy)
      .map(s => ({
        submissionId: s.id,
        sourceId: s.id,
        sourceType: 'timingSubmission' as const,
        submitterId: s.submittedBy!.id,
        submitterName: s.submittedBy!.fullName || 'Anonymous contributor',
        timings: (s.timings as { [k: string]: string | string[] | number | undefined }) || {},
        upvotes: s.upvotes,
        downvotes: s.downvotes,
        createdAt: s.createdAt,
        submitter: {
          reputationPoints: s.submittedBy!.reputationPoints ?? 0,
          verifiedContributor: !!s.submittedBy!.verifiedContributor,
          isTimeKeeper: false,
        },
      })),
    ...schedules
      .filter(s => s.submittedBy)
      .map(s => {
        const isVerified = s.verificationStatus === 'verified';
        return {
          submissionId: null,
          sourceId: s.id,
          sourceType: 'prayerSchedule' as const,
          submitterId: s.submittedBy!.id,
          submitterName: s.submittedBy!.fullName || 'Anonymous contributor',
          timings: (s.timings as { [k: string]: string | string[] | number | undefined }) || {},
          upvotes: s.upvotes + (s.isActive ? 2 : 0) + (isVerified ? 1 : 0),
          downvotes: s.downvotes,
          createdAt: s.updatedAt ?? s.validFrom ?? s.createdAt,
          activeSchedule: s.isActive,
          verifiedSchedule: isVerified,
          submitter: {
            reputationPoints: s.submittedBy!.reputationPoints ?? 0,
            verifiedContributor: !!s.submittedBy!.verifiedContributor,
            isTimeKeeper: s.isActive,
          },
        };
      }),
  ];

  return attachFollowerCounts(rankTimeKeepers(keeperSubs), followerCounts);
}

async function mosqueEditPermission(
  mosque: { id: string; name: string; addedById: string | null },
  userId: string | undefined,
  ranked?: RankedKeeper[],
) {
  if (!userId) return { allowed: false, reason: 'signed_out', claimOnRename: false, fullEdit: false };
  if (mosque.addedById === userId) {
    return { allowed: true, reason: 'owner', claimOnRename: false, fullEdit: true };
  }

  const unnamed = isUnnamedMosqueName(mosque.name);
  if (unnamed) {
    return { allowed: true, reason: 'unnamed', claimOnRename: true, fullEdit: false };
  }

  // A highest-rated keeper may maintain user-claimed masjid names, but not
  // untouched named imports. That keeps system-provided names protected while
  // still letting the trusted keeper fix community-entered details later.
  if (mosque.addedById) {
    const keepers = ranked ?? await rankedKeepersForMosque(mosque.id);
    if (keepers[0]?.submitterId === userId) {
      return { allowed: true, reason: 'top_keeper', claimOnRename: false, fullEdit: false };
    }
  }

  return { allowed: false, reason: 'not_allowed', claimOnRename: false, fullEdit: false };
}

function mosquePermissionResponse(
  permission: Awaited<ReturnType<typeof mosqueEditPermission>>,
  status: string | null | undefined,
  topKeeperId: string | null,
  userId: string | undefined,
) {
  const isTopKeeper = !!userId && !!topKeeperId && topKeeperId === userId;
  return {
    canEdit: permission.allowed,
    canRename: permission.allowed,
    canEditNameOnly: permission.allowed && !permission.fullEdit,
    editPermission: permission.reason,
    canClose: status !== 'closed' && isTopKeeper,
    canReactivate: status === 'closed' && isTopKeeper,
  };
}

// Body of the keeper withdrawal, run against a transaction client so it can
// either stand alone (withdrawKeeperSources) or be composed into a larger
// atomic operation (e.g. the close flow that immediately activates a
// replacement keeper).
async function withdrawKeeperSourcesTx(
  tx: DbClient,
  mosqueId: string,
  userId: string,
  reason: string,
) {
  const now = new Date();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  {
    const withdrawnSubmissions = await tx.timingSubmission.updateMany({
      where: {
        mosqueId,
        submittedById: userId,
        status: { notIn: ['rejected', 'withdrawn'] },
      },
      data: {
        status: 'withdrawn',
        reviewNotes: reason,
      },
    });

    const withdrawnSchedules = await tx.prayerSchedule.updateMany({
      where: {
        mosqueId,
        submittedById: userId,
        deletedAt: null,
      },
      data: {
        isActive: false,
        validUntil: today,
        deletedAt: now,
        notes: reason,
      },
    });

    await tx.$executeRaw`
      UPDATE users
      SET notification_preferences = jsonb_set(
            COALESCE(notification_preferences, '{}'::jsonb),
            '{preferredKeepers}',
            COALESCE(notification_preferences->'preferredKeepers', '{}'::jsonb) - ${mosqueId},
            true
          ),
          updated_at = NOW()
      WHERE deleted_at IS NULL
        AND jsonb_extract_path_text(notification_preferences, 'preferredKeepers', ${mosqueId}) = ${userId}
    `;

    await tx.activityLog.create({
      data: {
        userId,
        activityType: 'time_keeper_withdrawn',
        entityType: 'Mosque',
        entityId: mosqueId,
        metadata: {
          mosqueId,
          reason,
          withdrawnSubmissions: withdrawnSubmissions.count,
          withdrawnSchedules: withdrawnSchedules.count,
        },
      },
    });

    return {
      withdrawnSubmissions: withdrawnSubmissions.count,
      withdrawnSchedules: withdrawnSchedules.count,
    };
  }
}

async function withdrawKeeperSources(
  mosqueId: string,
  userId: string,
  reason = 'Withdrawn by the time keeper',
) {
  return prisma.$transaction((tx) => withdrawKeeperSourcesTx(tx, mosqueId, userId, reason));
}

async function activateReplacementKeeperIfNeeded(
  mosqueId: string,
  notes: string,
  force = false,
  db: DbClient = prisma,
) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const active = await db.prayerSchedule.findFirst({
    where: { mosqueId, isActive: true, deletedAt: null },
    select: { id: true },
  });
  if (active && !force) return null;
  if (active && force) {
    await db.prayerSchedule.updateMany({
      where: { mosqueId, isActive: true, deletedAt: null },
      data: { isActive: false, validUntil: today },
    });
  }

  const replacementKeeper = (await rankedKeepersForMosque(mosqueId, db))[0] ?? null;
  if (!replacementKeeper) return null;

  await db.prayerSchedule.create({
    data: {
      mosqueId,
      submittedById: replacementKeeper.submitterId,
      timings: replacementKeeper.timings as any,
      verificationStatus: replacementKeeper.verifiedSchedule ? 'verified' : 'pending',
      validFrom: today,
      isActive: true,
      notes,
    },
  });
  return replacementKeeper;
}

interface NearbyMosqueRow {
  id: string;
  name: string;
  name_arabic: string | null;
  latitude: number;
  longitude: number;
  city: string;
  country: string;
  address_line1: string | null;
  verified: boolean;
  status: string;
  view_count: number;
  favorite_count: number;
  distance_meters: number;
}

router.get(
  '/recent',
  asyncHandler(async (_req: Request, res: Response) => {
    const rows = await prisma.mosque.findMany({
      where: { deletedAt: null, status: { in: [...PUBLIC_MOSQUE_STATUSES] } },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: {
        id: true, name: true, nameArabic: true, city: true, country: true,
        latitude: true, longitude: true, verified: true, status: true, addressLine1: true,
        amenities: true, viewCount: true, favoriteCount: true,
      },
    });
    res.json({ data: rows });
  })
);

router.get(
  '/nearby',
  optionalAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { lat, lng, radius, limit } = nearbyQuerySchema.parse(req.query);
    if (req.user) {
      const hourKey = new Date().toISOString().slice(0, 13);
      trackActivity(
        req,
        'nearby_search',
        {
          lat: Number(lat.toFixed(6)),
          lng: Number(lng.toFixed(6)),
          radius,
          limit,
        },
        { throttleKey: `nearby_search:${req.user.id}:${hourKey}`, throttleMs: 60 * 60 * 1000 },
      );
    }

    const rows = await prisma.$queryRaw<NearbyMosqueRow[]>`
      SELECT
        id,
        name,
        name_arabic,
        latitude,
        longitude,
        city,
        country,
        address_line1,
        verified,
        status,
        view_count,
        favorite_count,
        ST_Distance(location, ST_MakePoint(${lng}, ${lat})::geography) AS distance_meters
      FROM mosques
      WHERE
        deleted_at IS NULL
        AND status IN ('active', 'closed')
        AND ST_DWithin(location, ST_MakePoint(${lng}, ${lat})::geography, ${radius})
      ORDER BY location <-> ST_MakePoint(${lng}, ${lat})::geography
      LIMIT ${limit}
    `;

    // Batch-fetch active schedules so the map can label each pin with the
    // next-takbeer time without N+1 detail fetches. Empty if no schedules.
    const ids = rows.map(r => r.id);
    const schedules = ids.length === 0 ? [] : await prisma.prayerSchedule.findMany({
      where: { mosqueId: { in: ids }, isActive: true, deletedAt: null },
      orderBy: { validFrom: 'desc' },
      select: {
        mosqueId: true,
        timings: true,
        verificationStatus: true,
        validFrom: true,
        updatedAt: true,
        submittedById: true,
        submittedBy: { select: { fullName: true } },
      },
    });
    // First-wins per mosque (orderBy validFrom desc above).
    const schedByMosque = new Map<string, typeof schedules[number]>();
    for (const s of schedules) {
      if (!schedByMosque.has(s.mosqueId)) schedByMosque.set(s.mosqueId, s);
    }
    const activeKeeperIds = schedules
      .map(s => s.submittedById)
      .filter((id): id is string => !!id);
    const recentKeeperSubmissions = ids.length === 0 || activeKeeperIds.length === 0 ? [] : await prisma.timingSubmission.findMany({
      where: {
        mosqueId: { in: ids },
        submittedById: { in: activeKeeperIds },
        createdAt: { gte: new Date(Date.now() - KEEPER_TIMING_LOOKBACK_DAYS * 24 * 60 * 60 * 1000) },
        status: { notIn: ['rejected', 'withdrawn'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { mosqueId: true, submittedById: true, timings: true, createdAt: true },
    });
    const latestSubmissionByActiveKeeper = new Map<string, typeof recentKeeperSubmissions[number]>();
    for (const s of recentKeeperSubmissions) {
      const active = schedByMosque.get(s.mosqueId);
      if (!active?.submittedById || active.submittedById !== s.submittedById) continue;
      if (s.createdAt <= active.updatedAt) continue;
      if (!latestSubmissionByActiveKeeper.has(s.mosqueId)) latestSubmissionByActiveKeeper.set(s.mosqueId, s);
    }

    const data = rows.map((r) => {
      const sched = schedByMosque.get(r.id);
      const latest = latestSubmissionByActiveKeeper.get(r.id);
      return {
        id: r.id,
        name: r.name,
        nameArabic: r.name_arabic,
        latitude: r.latitude,
        longitude: r.longitude,
        city: r.city,
        country: r.country,
        addressLine1: r.address_line1,
        verified: r.verified,
        status: r.status,
        viewCount: r.view_count,
        favoriteCount: r.favorite_count,
        distanceMeters: Math.round(Number(r.distance_meters)),
        prayerSchedules: sched ? [sched] : [],
        effectiveTimings: latest?.timings ?? null,
        effectiveKeeperId: latest?.submittedById ?? sched?.submittedById ?? null,
        effectiveKeeperName: sched?.submittedBy?.fullName ?? null,
        effectiveKeeperSource: latest ? 'timingSubmission' : (sched ? 'prayerSchedule' : null),
        effectiveKeeperIsCurrentSchedule: !!sched?.submittedById,
        effectiveKeeperIsVerifiedSchedule: sched?.verificationStatus === 'verified',
        effectiveKeeperUpdatedAt: (latest?.createdAt ?? sched?.updatedAt ?? null)?.toISOString?.() ?? null,
      };
    });

    res.json({ data, count: data.length, radius, center: { lat, lng } });
  })
);

router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const filters = listQuerySchema.parse(req.query);
    const pagination = parsePagination(req);

    const where: any = { deletedAt: null, status: { in: [...PUBLIC_MOSQUE_STATUSES] } };
    if (filters.city) where.city = { equals: filters.city, mode: 'insensitive' };
    if (filters.country) where.country = { equals: filters.country, mode: 'insensitive' };
    if (filters.verified) where.verified = filters.verified === 'true';
    if (filters.search) {
      const term = { contains: filters.search, mode: 'insensitive' as const };
      where.OR = [
        { name: term },
        { nameArabic: term },
        { city: term },
        { addressLine1: term },
      ];
    }

    const [rows, totalCount] = await Promise.all([
      prisma.mosque.findMany({
        where,
        skip: pagination.skip,
        take: pagination.limit,
        orderBy: [{ verified: 'desc' }, { favoriteCount: 'desc' }, { name: 'asc' }],
        select: mosqueListSelect,
      }),
      prisma.mosque.count({ where }),
    ]);

    res.json(paginated(rows, totalCount, pagination));
  })
);

router.get(
  '/captcha',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(createCaptchaChallenge());
  })
);

router.get(
  '/:id',
  optionalAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const mosque = await prisma.mosque.findFirst({
      where: { id: req.params.id, deletedAt: null },
      include: {
        prayerSchedules: {
          where: { isActive: true, deletedAt: null },
          orderBy: { validFrom: 'desc' },
          take: 1,
        },
        _count: { select: { reviews: true, favorites: true } },
      },
    });

    if (!mosque) throw new AppError(404, 'Mosque not found');

    // fire-and-forget view count bump (don't block response)
    prisma.mosque.update({ where: { id: mosque.id }, data: { viewCount: { increment: 1 } } }).catch(() => {});

    let isFavorite = false;
    let preferredKeeperId: string | null = null;
    if (req.user) {
      const [fav, me] = await Promise.all([
        prisma.userFavorite.findUnique({
          where: { userId_mosqueId: { userId: req.user.id, mosqueId: mosque.id } },
        }),
        prisma.user.findUnique({
          where: { id: req.user.id },
          select: { notificationPreferences: true },
        }),
      ]);
      isFavorite = !!fav;
      const prefs = (me?.notificationPreferences as Record<string, unknown>) || {};
      const keepers = (prefs.preferredKeepers as Record<string, string>) || {};
      preferredKeeperId = keepers[mosque.id] ?? null;
    }

    // Compute the keeper-driven view: start from the current active schedule,
    // then include contributor schedule history and recent direct submissions.
    const ranked = await rankedKeepersForMosque(mosque.id);
    const topKeeper = ranked[0] ?? null;
    const userKeeper = preferredKeeperId ? ranked.find(k => k.submitterId === preferredKeeperId) ?? null : null;
    const currentScheduleKeeper = ranked.find(k => k.activeSchedule) ?? null;
    const effectiveKeeper = userKeeper || currentScheduleKeeper || topKeeper;

    const permission = await mosqueEditPermission(
      { id: mosque.id, name: mosque.name, addedById: mosque.addedById },
      req.user?.id,
      ranked,
    );

    res.json({
      ...mosque,
      isFavorite,
      keepers: ranked,
      preferredKeeperId,
      effectiveTimings: effectiveKeeper?.timings ?? null,
      effectiveKeeperId: effectiveKeeper?.submitterId ?? null,
      effectiveKeeperName: effectiveKeeper?.submitterName ?? null,
      effectiveKeeperSource: effectiveKeeper?.latestSourceType ?? null,
      effectiveKeeperIsCurrentSchedule: !!effectiveKeeper?.activeSchedule,
      effectiveKeeperIsVerifiedSchedule: !!effectiveKeeper?.verifiedSchedule,
      effectiveKeeperUpdatedAt: effectiveKeeper?.latestSubmissionAt ?? null,
      ...mosquePermissionResponse(permission, mosque.status, topKeeper?.submitterId ?? null, req.user?.id),
    });
  })
);

router.post(
  '/',
  authenticate,
  mosquesCreateLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const { captcha, ...data } = createMosqueSchema.parse(req.body);
    if (!verifyCaptcha(captcha)) {
      throw new AppError(400, 'Human check failed. Refresh the question and try again.');
    }

    // Insert via raw SQL so we can populate the PostGIS `location` column
    const [created] = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO mosques (
        name, name_arabic, description, location, latitude, longitude,
        address_line1, address_line2, city, state_province, country, postal_code,
        phone_number, email, website, capacity, year_established, denomination, madhab,
        amenities, added_by, created_at, updated_at
      )
      VALUES (
        ${data.name}, ${data.nameArabic ?? null}, ${data.description ?? null},
        ST_MakePoint(${data.longitude}, ${data.latitude})::geography,
        ${data.latitude}, ${data.longitude},
        ${data.addressLine1 ?? null}, ${data.addressLine2 ?? null}, ${data.city},
        ${data.stateProvince ?? null}, ${data.country}, ${data.postalCode ?? null},
        ${data.phoneNumber ?? null}, ${data.email ?? null}, ${data.website ?? null},
        ${data.capacity ?? null}, ${data.yearEstablished ?? null},
        ${data.denomination ?? null}, ${data.madhab ?? null},
        ${data.amenities ?? []}::text[], ${req.user!.id}::uuid,
        NOW(), NOW()
      )
      RETURNING id
    `;

    const mosque = await prisma.mosque.findUnique({ where: { id: created.id } });
    if (!mosque) throw new AppError(500, 'Mosque was created but could not be loaded');
    res.status(201).json({ ...mosque, canEdit: true });
  })
);

router.put(
  '/:id',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const data = updateMosqueSchema.parse(req.body);

    const existing = await prisma.mosque.findFirst({
      where: { id: req.params.id, deletedAt: null },
      select: { id: true, name: true, status: true, addedById: true },
    });
    if (!existing) throw new AppError(404, 'Mosque not found');

    const permission = await mosqueEditPermission(existing, req.user!.id);
    if (!permission.allowed) {
      throw new AppError(403, 'Only the contributor, the first namer of an unnamed masjid, or the highest-rated time keeper can edit this masjid name');
    }

    let updateData: typeof data = data;
    const shouldClaimOwner = permission.claimOnRename;
    if (!permission.fullEdit) {
      const keys = Object.entries(data)
        .filter(([, value]) => value !== undefined)
        .map(([key]) => key);
      const invalidKeys = keys.filter(key => key !== 'name');
      if (invalidKeys.length > 0) {
        throw new AppError(403, 'This permission only allows changing the masjid name');
      }
      if (!data.name || isUnnamedMosqueName(data.name)) {
        throw new AppError(400, 'Please provide the real masjid name');
      }
      updateData = { name: data.name };
    }

    if ((updateData.latitude === undefined) !== (updateData.longitude === undefined)) {
      throw new AppError(400, 'Both latitude and longitude are required to move a mosque pin');
    }

    if (updateData.latitude !== undefined && updateData.longitude !== undefined) {
      await prisma.$executeRaw`
        UPDATE mosques
        SET location = ST_MakePoint(${updateData.longitude}, ${updateData.latitude})::geography,
            latitude = ${updateData.latitude},
            longitude = ${updateData.longitude},
            updated_at = NOW()
        WHERE id = ${req.params.id}::uuid
      `;
    }

    // strip lat/lng from the standard update — already handled above
    const { latitude: _lat, longitude: _lng, ...rest } = updateData;
    const prismaUpdate = shouldClaimOwner ? { ...rest, addedById: req.user!.id } : rest;
    const updated = Object.keys(prismaUpdate).length > 0
      ? await prisma.mosque.update({
          where: { id: req.params.id },
          data: prismaUpdate,
        })
      : await prisma.mosque.findUnique({ where: { id: req.params.id } });
    if (!updated) throw new AppError(404, 'Mosque not found');

    const ranked = await rankedKeepersForMosque(updated.id);
    const nextPermission = await mosqueEditPermission(
      { id: updated.id, name: updated.name, addedById: updated.addedById },
      req.user!.id,
      ranked,
    );

    res.json({
      ...updated,
      ...mosquePermissionResponse(nextPermission, updated.status, ranked[0]?.submitterId ?? null, req.user!.id),
    });
  })
);

router.post(
  '/:id/status',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { status } = mosqueStatusSchema.parse(req.body);
    const mosque = await prisma.mosque.findFirst({
      where: { id: req.params.id, deletedAt: null },
      select: { id: true, name: true, status: true, addedById: true },
    });
    if (!mosque) throw new AppError(404, 'Mosque not found');

    const ranked = await rankedKeepersForMosque(mosque.id);
    const topKeeper = ranked[0] ?? null;
    if (topKeeper?.submitterId !== req.user!.id) {
      throw new AppError(403, 'Only the current highest-rated time keeper can permanently close or reactivate this masjid');
    }

    const isClosing = status === 'closed' && mosque.status !== 'closed';

    // Withdraw the closing keeper, activate any replacement, flip the status,
    // and log it as ONE atomic unit. Previously these were three independent
    // operations — a failure between them could leave a keeper-less masjid
    // with no active schedule and no rollback. The transaction returns the
    // values the response needs so we don't reach into closure-mutated state.
    const { updated, withdrawal, replacementKeeper } = await prisma.$transaction(async (tx) => {
      let withdrawal: Awaited<ReturnType<typeof withdrawKeeperSourcesTx>> | null = null;
      let replacementKeeper: RankedKeeper | null = null;
      if (isClosing) {
        withdrawal = await withdrawKeeperSourcesTx(
          tx,
          mosque.id,
          req.user!.id,
          'Withdrew by marking the masjid permanently closed',
        );
        replacementKeeper = await activateReplacementKeeperIfNeeded(
          mosque.id,
          'Activated after the previous highest-rated time keeper marked the masjid permanently closed',
          true,
          tx,
        );
      }

      const row = mosque.status === status
        ? await tx.mosque.findUnique({ where: { id: mosque.id } })
        : await tx.mosque.update({ where: { id: mosque.id }, data: { status } });
      if (!row) throw new AppError(404, 'Mosque not found');

      await tx.activityLog.create({
        data: {
          userId: req.user!.id,
          activityType: status === 'closed' ? 'mosque_closed' : 'mosque_reactivated',
          entityType: 'Mosque',
          entityId: mosque.id,
          metadata: { mosqueId: mosque.id, previousStatus: mosque.status, status },
        },
      });

      return { updated: row, withdrawal, replacementKeeper };
    });

    const latestRanked = status === 'closed' ? await rankedKeepersForMosque(mosque.id) : ranked;
    const latestTopKeeper = latestRanked[0] ?? null;
    const permission = await mosqueEditPermission(
      { id: updated.id, name: updated.name, addedById: updated.addedById },
      req.user!.id,
      latestRanked,
    );

    res.json({
      ...updated,
      ...mosquePermissionResponse(permission, updated.status, latestTopKeeper?.submitterId ?? null, req.user!.id),
      withdrawnCurrentKeeper: !!withdrawal,
      withdrawnSubmissions: withdrawal?.withdrawnSubmissions ?? 0,
      withdrawnSchedules: withdrawal?.withdrawnSchedules ?? 0,
      replacementKeeperId: replacementKeeper?.submitterId ?? null,
      replacementKeeperName: replacementKeeper?.submitterName ?? null,
    });
  })
);

router.post(
  '/:id/favorite',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const mosque = await prisma.mosque.findFirst({
      where: { id: req.params.id, deletedAt: null },
      select: { id: true },
    });
    if (!mosque) throw new AppError(404, 'Mosque not found');

    const existing = await prisma.userFavorite.findUnique({
      where: { userId_mosqueId: { userId: req.user!.id, mosqueId: mosque.id } },
    });

    if (existing) {
      await prisma.$transaction([
        prisma.userFavorite.delete({ where: { id: existing.id } }),
        prisma.mosque.update({ where: { id: mosque.id }, data: { favoriteCount: { decrement: 1 } } }),
      ]);
      res.json({ favorite: false });
    } else {
      await prisma.$transaction([
        prisma.userFavorite.create({ data: { userId: req.user!.id, mosqueId: mosque.id } }),
        prisma.mosque.update({ where: { id: mosque.id }, data: { favoriteCount: { increment: 1 } } }),
      ]);
      res.status(201).json({ favorite: true });
    }
  })
);

// Time keepers for a mosque — contributors from both active schedule history
// and recent direct timing submissions, ranked by the consensus weight formula.
// The active schedule source is the default; users can override via
// PUT /api/users/me/preferred-keeper to pin a different contributor.
router.get(
  '/:id/keepers',
  asyncHandler(async (req: Request, res: Response) => {
    const mosque = await prisma.mosque.findFirst({
      where: { id: req.params.id, deletedAt: null },
      select: { id: true },
    });
    if (!mosque) throw new AppError(404, 'Mosque not found');

    res.json({
      mosqueId: req.params.id,
      keepers: await rankedKeepersForMosque(req.params.id),
    });
  })
);

// A signed-in contributor can remove themselves as a time keeper for one
// masjid. Time keepers are inferred from their schedules/submissions, so
// withdrawal hides those sources and clears followers who selected them.
router.post(
  '/:id/keepers/me/withdraw',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const mosque = await prisma.mosque.findFirst({
      where: { id: req.params.id, deletedAt: null },
      select: { id: true },
    });
    if (!mosque) throw new AppError(404, 'Mosque not found');

    const result = await withdrawKeeperSources(mosque.id, req.user!.id);

    if (result.withdrawnSubmissions === 0 && result.withdrawnSchedules === 0) {
      throw new AppError(404, 'You are not a time keeper for this masjid');
    }

    const replacementKeeper = await activateReplacementKeeperIfNeeded(
      mosque.id,
      'Activated after the previous time keeper withdrew',
    );

    res.json({
      mosqueId: mosque.id,
      withdrawn: true,
      ...result,
      replacementKeeperId: replacementKeeper?.submitterId ?? null,
      replacementKeeperName: replacementKeeper?.submitterName ?? null,
    });
  })
);

// Per-prayer crowd-sourced consensus for a mosque. See
// docs/CROWD_SOURCED_TIMINGS.md for the algorithm. Read-only Phase 1 — does
// not yet promote the consensus to the active PrayerSchedule.
router.get(
  '/:id/consensus',
  asyncHandler(async (req: Request, res: Response) => {
    const mosque = await prisma.mosque.findFirst({
      where: { id: req.params.id, deletedAt: null },
      select: { id: true },
    });
    if (!mosque) throw new AppError(404, 'Mosque not found');
    // timeKeeperId support arrives in Phase 3 (per docs/CROWD_SOURCED_TIMINGS.md).
    // Phase 1 computes consensus without the keeper boost.
    const timeKeeperId: string | null = null;

    const LOOKBACK_DAYS = 60;
    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

    const submissions = await prisma.timingSubmission.findMany({
      where: {
        mosqueId: req.params.id,
        createdAt: { gte: since },
        status: { notIn: ['rejected', 'withdrawn'] },
      },
      include: {
        submittedBy: { select: { id: true, reputationPoints: true, verifiedContributor: true } },
      },
    });

    const scored: ScoredSubmission[] = submissions.map((s) => ({
      timings: (s.timings as { [k: string]: string }) || {},
      upvotes: s.upvotes,
      downvotes: s.downvotes,
      createdAt: s.createdAt,
      submitter: {
        reputationPoints: s.submittedBy?.reputationPoints ?? 0,
        verifiedContributor: !!s.submittedBy?.verifiedContributor,
        isTimeKeeper: !!(timeKeeperId && s.submittedBy?.id === timeKeeperId),
      },
    }));

    const PRAYERS = ['fajr', 'dhuhr', 'asr', 'isha', 'jummah'];
    const consensus: Record<string, ReturnType<typeof computeConsensus> | null> = {};
    for (const p of PRAYERS) {
      const r = computeConsensus(scored, p);
      consensus[p] = r.time ? r : null;
    }

    // Maghrib follows astronomical sunset; only the takbeer offset is voted on.
    const offsetTallies = new Map<number, number>();
    let offsetContribs = 0;
    for (const s of scored) {
      const off = (s.timings as { maghribOffset?: number }).maghribOffset;
      if (typeof off !== 'number' || !Number.isFinite(off)) continue;
      const w = (s.submitter.verifiedContributor ? 3 : 1) * (1 + Math.log10(Math.max(1, s.submitter.reputationPoints)));
      offsetTallies.set(off, (offsetTallies.get(off) || 0) + w);
      offsetContribs++;
    }
    let maghribOffset: { offset: number; contributors: number } | null = null;
    if (offsetTallies.size > 0) {
      const [winner] = [...offsetTallies.entries()].sort((a, b) => b[1] - a[1]);
      maghribOffset = { offset: winner[0], contributors: offsetContribs };
    }

    res.json({ mosqueId: req.params.id, lookbackDays: LOOKBACK_DAYS, consensus, maghribOffset });
  })
);

router.get(
  '/:id/reviews',
  asyncHandler(async (req: Request, res: Response) => {
    const pagination = parsePagination(req);

    const where = { mosqueId: req.params.id, status: 'published' };
    const [rows, totalCount] = await Promise.all([
      prisma.mosqueReview.findMany({
        where,
        skip: pagination.skip,
        take: pagination.limit,
        orderBy: [{ helpfulCount: 'desc' }, { createdAt: 'desc' }],
        include: { user: { select: { id: true, fullName: true, reputationPoints: true, verifiedContributor: true } } },
      }),
      prisma.mosqueReview.count({ where }),
    ]);

    res.json(paginated(rows, totalCount, pagination));
  })
);

router.post(
  '/:id/reviews',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const data = reviewSchema.parse(req.body);
    const mosque = await prisma.mosque.findFirst({
      where: { id: req.params.id, deletedAt: null },
      select: { id: true },
    });
    if (!mosque) throw new AppError(404, 'Mosque not found');

    const review = await prisma.mosqueReview.upsert({
      where: { userId_mosqueId: { userId: req.user!.id, mosqueId: mosque.id } },
      update: data,
      create: { ...data, userId: req.user!.id, mosqueId: mosque.id },
    });

    res.status(201).json(review);
  })
);

const mosqueListSelect = {
  id: true,
  name: true,
  nameArabic: true,
  latitude: true,
  longitude: true,
  city: true,
  country: true,
  addressLine1: true,
  verified: true,
  status: true,
  viewCount: true,
  favoriteCount: true,
  amenities: true,
} as const;

export default router;
