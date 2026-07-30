// ═══════════════════════════════════════════════════════════════════
// Admin tools — operational endpoints for the website admin panel.
//
// Why 404 instead of 403: hides the existence of the endpoint from scanners.
// Admin routes require a real bearer-authenticated request from the configured
// admin email. Test auth is allowed only under NODE_ENV=test.
// ═══════════════════════════════════════════════════════════════════

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { notifyKeeperUpdate } from '../lib/fcm';
import { prisma } from '../lib/prisma';

const router = Router();
const INTERNAL_TEST_USER_EMAIL_FILTERS = [
  { email: { endsWith: '@takbeertime.test' } },
  { email: { endsWith: '@jamat.local' } },
  { email: { endsWith: '@local.test' } },
  { email: { endsWith: '@example.com' } },
  { email: { startsWith: 'qa-' } },
  { email: { startsWith: 'e2e-' } },
  { email: { startsWith: 'bearer-precedes-' } },
  { email: { startsWith: 'admin-overview-' } },
  { email: { contains: '+e2e' } },
];
const realUserWhere = {
  deletedAt: null,
  NOT: INTERNAL_TEST_USER_EMAIL_FILTERS,
};

function configuredAdminEmail(): string | null {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  return email || null;
}

function assertAdmin(req: Request): void {
  const authHeader = req.headers.authorization;
  if (process.env.NODE_ENV !== 'test' && !authHeader?.startsWith('Bearer ')) {
    throw new AppError(404, 'Not Found');
  }

  const adminEmail = configuredAdminEmail();
  if (!adminEmail) {
    throw new AppError(404, 'Not Found');
  }

  const email = req.user?.email?.trim().toLowerCase();
  if (email !== adminEmail) {
    throw new AppError(404, 'Not Found');
  }
}

const overviewQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // JavaScript Date#getTimezoneOffset convention: UTC - local, in minutes.
  tzOffsetMinutes: z.coerce.number().int().min(-840).max(840).default(0),
});

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

function localDateString(timeMs: number, tzOffsetMinutes: number): string {
  const offsetMs = tzOffsetMinutes * 60 * 1000;
  return new Date(timeMs - offsetMs).toISOString().slice(0, 10);
}

function rangeStart(date: string, tzOffsetMinutes: number) {
  const offsetMs = tzOffsetMinutes * 60 * 1000;
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + offsetMs);
}

function selectedRange(query: z.infer<typeof overviewQuerySchema>) {
  const { tzOffsetMinutes } = query;
  let startDate = query.startDate;
  let endDate = query.endDate;

  if (query.date && !startDate && !endDate) {
    startDate = query.date;
    endDate = query.date;
  }
  if (!startDate && !endDate) {
    endDate = localDateString(Date.now() - 24 * 60 * 60 * 1000, tzOffsetMinutes);
    startDate = addDays(endDate, -6);
  }
  if (startDate && !endDate) endDate = startDate;
  if (!startDate && endDate) startDate = endDate;

  const start = rangeStart(startDate!, tzOffsetMinutes);
  const end = rangeStart(addDays(endDate!, 1), tzOffsetMinutes);
  const days = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) throw new AppError(400, 'endDate must be on or after startDate');
  if (days > 366) throw new AppError(400, 'Date range cannot exceed 366 days');

  return {
    date: startDate === endDate ? startDate : undefined,
    startDate: startDate!,
    endDate: endDate!,
    start,
    end,
    days,
    tzOffsetMinutes,
  };
}

const userSelect = {
  id: true,
  email: true,
  firebaseUid: true,
  fullName: true,
  createdAt: true,
  lastLoginAt: true,
  defaultMosque: {
    select: {
      id: true,
      name: true,
      city: true,
      country: true,
      latitude: true,
      longitude: true,
    },
  },
  _count: {
    select: {
      favorites: true,
      timingSubmissions: true,
    },
  },
} as const;

type AdminUserRow = {
  id: string;
  email: string;
  firebaseUid: string | null;
  fullName: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
  defaultMosque: {
    id: string;
    name: string;
    city: string;
    country: string;
    latitude: number;
    longitude: number;
  } | null;
  _count?: {
    favorites: number;
    timingSubmissions: number;
  };
};

function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
}

function readGeo(metadata: unknown): { lat: number; lng: number } | null {
  const m = metadata as { lat?: unknown; lng?: unknown } | null;
  const lat = Number(m?.lat);
  const lng = Number(m?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function acquisitionSource(metadata: unknown): string {
  const m = metadata as { referer?: unknown; origin?: unknown; provider?: unknown } | null;
  const referer = typeof m?.referer === 'string' ? m.referer : '';
  try {
    if (referer) {
      const url = new URL(referer);
      const source = url.searchParams.get('utm_source');
      if (source) return source.toLowerCase();
      const host = url.hostname.replace(/^www\./, '').toLowerCase();
      if (host.includes('google.')) return 'google';
      if (host.includes('bing.')) return 'bing';
      if (host.includes('duckduckgo.')) return 'duckduckgo';
      if (host.includes('yahoo.')) return 'yahoo';
      if (host.includes('reddit.')) return 'reddit';
      if (host.includes('quora.')) return 'quora';
      if (host.includes('github.')) return 'github';
      if (host.includes('takbeertime.com')) return 'website';
      return host;
    }
  } catch {}
  return typeof m?.provider === 'string' ? m.provider : 'direct';
}

function userPayload(
  user: AdminUserRow,
  extras: { lastSeenAt?: Date | null; lastActivityType?: string | null; requestCount?: number; location?: any; authProvider?: string | null } = {},
) {
  const fallbackLocation = !extras.location && user.defaultMosque
    ? {
      source: 'default_masjid',
      label: user.defaultMosque.name,
      lat: user.defaultMosque.latitude,
      lng: user.defaultMosque.longitude,
      mapsUrl: mapsUrl(user.defaultMosque.latitude, user.defaultMosque.longitude),
      at: null,
    }
    : null;

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    lastSeenAt: extras.lastSeenAt || user.lastLoginAt,
    lastActivityType: extras.lastActivityType || null,
    authProvider: extras.authProvider || null,
    requestCount: extras.requestCount || 0,
    favoritesCount: user._count?.favorites ?? 0,
    timingSubmissionCount: user._count?.timingSubmissions ?? 0,
    defaultMosque: user.defaultMosque,
    location: extras.location || fallbackLocation,
  };
}

function countBySource(rows: Array<{ metadata: unknown }>) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const source = acquisitionSource(row.metadata);
    counts.set(source, (counts.get(source) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => ({ source, count }));
}

async function lastKnownLocations(userIds: string[]) {
  if (!userIds.length) return new Map<string, any>();
  const rows = await prisma.activityLog.findMany({
    where: {
      userId: { in: userIds },
      activityType: 'nearby_search',
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(userIds.length * 5, 100), 1000),
    select: { userId: true, createdAt: true, metadata: true },
  });

  const byUser = new Map<string, any>();
  for (const row of rows) {
    if (!row.userId || byUser.has(row.userId)) continue;
    const geo = readGeo(row.metadata);
    if (!geo) continue;
    byUser.set(row.userId, {
      source: 'last_nearby_search',
      lat: geo.lat,
      lng: geo.lng,
      mapsUrl: mapsUrl(geo.lat, geo.lng),
      at: row.createdAt,
    });
  }
  return byUser;
}

// GET /api/admin/overview?date=YYYY-MM-DD&tzOffsetMinutes=-300
// Admin-only operational dashboard data for the website admin panel.
// The route intentionally returns 404 for non-admin users so the endpoint
// is not discoverable as an authorization oracle.
router.get(
  '/overview',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    assertAdmin(req);
    const parsed = overviewQuerySchema.parse(req.query);
    const range = selectedRange(parsed);

    const [activityRows, loginUsers, newUsers, signupActivities, googleActivities, googleLinkedLoginUsers, submissions] = await Promise.all([
      prisma.activityLog.findMany({
        where: {
          userId: { not: null },
          user: { is: realUserWhere },
          createdAt: { gte: range.start, lt: range.end },
        },
        orderBy: { createdAt: 'desc' },
        take: 1000,
        include: { user: { select: userSelect } },
      }),
      prisma.user.findMany({
        where: {
          ...realUserWhere,
          lastLoginAt: { gte: range.start, lt: range.end },
        },
        orderBy: { lastLoginAt: 'desc' },
        take: 500,
        select: userSelect,
      }),
      prisma.user.findMany({
        where: {
          ...realUserWhere,
          createdAt: { gte: range.start, lt: range.end },
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: userSelect,
      }),
      prisma.activityLog.findMany({
        where: {
          activityType: {
            in: ['auth_register_created', 'auth_register_claimed', 'auth_google_created', 'auth_google_linked'],
          },
          user: { is: realUserWhere },
          createdAt: { gte: range.start, lt: range.end },
        },
        orderBy: { createdAt: 'desc' },
        take: 1000,
        select: { userId: true, createdAt: true, metadata: true },
      }),
      prisma.activityLog.findMany({
        where: {
          activityType: {
            in: ['auth_google_created', 'auth_google_linked', 'auth_google_login'],
          },
          user: { is: realUserWhere },
          createdAt: { gte: range.start, lt: range.end },
        },
        orderBy: { createdAt: 'desc' },
        take: 1000,
        include: { user: { select: userSelect } },
      }),
      prisma.user.findMany({
        where: {
          ...realUserWhere,
          firebaseUid: { not: null },
          lastLoginAt: { gte: range.start, lt: range.end },
        },
        orderBy: { lastLoginAt: 'desc' },
        take: 500,
        select: userSelect,
      }),
      prisma.timingSubmission.findMany({
        where: {
          createdAt: { gte: range.start, lt: range.end },
          submittedBy: realUserWhere,
        },
        orderBy: { createdAt: 'desc' },
        take: 1000,
        include: {
          mosque: {
            select: {
              id: true,
              name: true,
              city: true,
              country: true,
              latitude: true,
              longitude: true,
            },
          },
          submittedBy: {
            select: { id: true, email: true, fullName: true },
          },
        },
      }),
    ]);

    const active = new Map<string, { user: AdminUserRow; lastSeenAt: Date; lastActivityType: string; requestCount: number }>();
    for (const row of activityRows) {
      if (!row.user) continue;
      const existing = active.get(row.user.id);
      if (!existing) {
        active.set(row.user.id, {
          user: row.user,
          lastSeenAt: row.createdAt,
          lastActivityType: row.activityType,
          requestCount: 1,
        });
      } else {
        existing.requestCount += 1;
      }
    }
    for (const user of loginUsers) {
      const existing = active.get(user.id);
      if (!existing) {
        active.set(user.id, {
          user,
          lastSeenAt: user.lastLoginAt || range.start,
          lastActivityType: 'login',
          requestCount: 0,
        });
      } else if (user.lastLoginAt && user.lastLoginAt > existing.lastSeenAt) {
        existing.lastSeenAt = user.lastLoginAt;
        existing.lastActivityType = 'login';
      }
    }

    const userIds = [...new Set([
      ...Array.from(active.keys()),
      ...newUsers.map(u => u.id),
      ...googleActivities.map(row => row.userId).filter((id): id is string => !!id),
      ...googleLinkedLoginUsers.map(u => u.id),
    ])];
    const locations = await lastKnownLocations(userIds);
    const signupActivityByUser = new Map<string, typeof signupActivities[number]>();
    for (const row of signupActivities) {
      if (row.userId && !signupActivityByUser.has(row.userId)) signupActivityByUser.set(row.userId, row);
    }

    const activeUsers = Array.from(active.values())
      .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())
      .map(row => userPayload(row.user, {
        lastSeenAt: row.lastSeenAt,
        lastActivityType: row.lastActivityType,
        requestCount: row.requestCount,
        location: locations.get(row.user.id),
      }));

    const newSignups = newUsers.map(user => userPayload(user, {
      lastSeenAt: user.lastLoginAt,
      lastActivityType: user.lastLoginAt ? 'signup_login' : null,
      authProvider: user.firebaseUid ? 'google' : 'password',
      location: locations.get(user.id),
    })).map(user => {
      const activity = signupActivityByUser.get(user.id);
      return {
        ...user,
        acquisitionSource: activity ? acquisitionSource(activity.metadata) : 'unknown',
      };
    });

    const googleUserMap = new Map<string, { user: AdminUserRow; lastSeenAt: Date; lastActivityType: string; signInCount: number }>();
    for (const row of googleActivities) {
      if (!row.user) continue;
      const existing = googleUserMap.get(row.user.id);
      if (!existing) {
        googleUserMap.set(row.user.id, {
          user: row.user,
          lastSeenAt: row.createdAt,
          lastActivityType: row.activityType,
          signInCount: 1,
        });
      } else {
        existing.signInCount += 1;
        if (row.createdAt > existing.lastSeenAt) {
          existing.lastSeenAt = row.createdAt;
          existing.lastActivityType = row.activityType;
        }
      }
    }
    for (const user of googleLinkedLoginUsers) {
      if (googleUserMap.has(user.id)) continue;
      googleUserMap.set(user.id, {
        user,
        lastSeenAt: user.lastLoginAt || range.start,
        lastActivityType: 'google_linked_login',
        signInCount: 0,
      });
    }
    const googleUsers = Array.from(googleUserMap.values())
      .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())
      .map(row => ({
        ...userPayload(row.user, {
          lastSeenAt: row.lastSeenAt,
          lastActivityType: row.lastActivityType,
          requestCount: row.signInCount,
          authProvider: 'google',
          location: locations.get(row.user.id),
        }),
        googleSignInCount: row.signInCount,
      }));

    const mosqueMap = new Map<string, any>();
    for (const submission of submissions) {
      const mosque = submission.mosque;
      const row = mosqueMap.get(mosque.id) || {
        mosque: {
          ...mosque,
          mapsUrl: mapsUrl(mosque.latitude, mosque.longitude),
        },
        submissionCount: 0,
        latestAt: submission.createdAt,
        submitters: new Map<string, any>(),
        submissions: [],
      };
      row.submissionCount += 1;
      if (submission.createdAt > row.latestAt) row.latestAt = submission.createdAt;
      row.submitters.set(submission.submittedBy.id, submission.submittedBy);
      row.submissions.push({
        id: submission.id,
        createdAt: submission.createdAt,
        status: submission.status,
        timings: submission.timings,
        submittedBy: submission.submittedBy,
      });
      mosqueMap.set(mosque.id, row);
    }

    const mosquesWithTimes = Array.from(mosqueMap.values())
      .sort((a, b) => b.latestAt.getTime() - a.latestAt.getTime())
      .map(row => ({
        ...row,
        submitters: Array.from(row.submitters.values()),
      }));

    res.json({
      range: {
        date: range.date,
        startDate: range.startDate,
        endDate: range.endDate,
        start: range.start,
        end: range.end,
        days: range.days,
        tzOffsetMinutes: range.tzOffsetMinutes,
      },
      summary: {
        activeUsers: activeUsers.length,
        newSignups: newSignups.length,
        googleUsers: googleUsers.length,
        googleSignIns: googleActivities.length,
        masjidsWithTimesAdded: mosquesWithTimes.length,
        timingSubmissions: submissions.length,
        acquisitionSources: countBySource(signupActivities),
      },
      activeUsers,
      newSignups,
      googleUsers,
      mosquesWithTimes,
    });
  }),
);

// Returns true if (a) ADMIN_TEST_PUSH_ENABLED='true' AND (b) the caller's
// id matches ADMIN_TEST_PUSH_USER_ID. Reads env at call time so flipping
// it on/off doesn't need a server restart.
function isAdminTestPushAllowed(req: Request): boolean {
  if (process.env.ADMIN_TEST_PUSH_ENABLED !== 'true') return false;
  const allowed = process.env.ADMIN_TEST_PUSH_USER_ID;
  if (!allowed) return false;
  return req.user?.id === allowed;
}

const testPushSchema = z.object({
  keeperUserId: z.string().uuid(),
  mosqueId:     z.string().uuid(),
  keeperName:   z.string().min(1).max(255).optional(),
  mosqueName:   z.string().min(1).max(255).optional(),
});

// POST /api/admin/test-push
//   Fire a single FCM keeper-update push to the topic
//   keeper-<keeperUserId>-mosque-<mosqueId> with synthetic schedule changes.
//   Used by the app team during initial integration to verify topic
//   subscription + channel + payload without composing a full submission.
//
//   404 by default. To enable for one trusted user during a testing window:
//     ADMIN_TEST_PUSH_ENABLED=true
//     ADMIN_TEST_PUSH_USER_ID=<their User.id>
//   Unset both when done.
router.post(
  '/test-push',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    if (!isAdminTestPushAllowed(req)) throw new AppError(404, 'Not Found');

    const parsed = testPushSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, `Validation Error: ${parsed.error.issues.map(i => i.message).join('; ')}`);
    }
    const { keeperUserId, mosqueId, keeperName, mosqueName } = parsed.data;

    // Synthetic payload that exercises the body-summary "1 prayer" branch
    // so the device-side renders a realistic title + body.
    const result = await notifyKeeperUpdate({
      mosqueId,
      submitterId:  keeperUserId,
      submissionId: `admin-test-${Date.now()}`,
      keeperName:   keeperName  || 'Test Keeper',
      mosqueName:   mosqueName  || 'Test Masjid',
      timings:      { isha: '20:45' },
      scheduleChanges: [{
        prayer: 'isha', action: 'promoted', reason: 'admin test', from: '20:30', to: '20:45',
      }],
    });

    res.json(result);
  })
);

export default router;
