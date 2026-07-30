import { Request } from 'express';
import { prisma } from './prisma';

const throttle = new Map<string, number>();

function clientIp(req: Request): string | null {
  const forwarded = (req.headers['x-forwarded-for'] as string | undefined)
    ?.split(',')[0]
    ?.trim();
  return forwarded || req.ip || req.socket.remoteAddress || null;
}

function requestContext(req: Request): Record<string, unknown> {
  return {
    referer: req.headers.referer || req.headers.referrer || null,
    origin: req.headers.origin || null,
  };
}

function shouldSkipThrottle(key: string, intervalMs: number): boolean {
  const now = Date.now();
  const last = throttle.get(key) || 0;
  if (now - last < intervalMs) return true;
  throttle.set(key, now);
  return false;
}

export function trackActivity(
  req: Request,
  activityType: string,
  metadata: Record<string, unknown> = {},
  options: { entityType?: string; entityId?: string; throttleKey?: string; throttleMs?: number } = {},
): void {
  const userId = req.user?.id;
  if (!userId) return;

  const throttleKey = options.throttleKey;
  if (throttleKey && shouldSkipThrottle(throttleKey, options.throttleMs ?? 60 * 60 * 1000)) {
    return;
  }

  prisma.activityLog.create({
    data: {
      userId,
      activityType,
      entityType: options.entityType,
      entityId: options.entityId,
      metadata: metadata as any,
      ipAddress: clientIp(req),
      userAgent: (req.headers['user-agent'] as string | undefined) || null,
    },
  }).catch((err) => {
    // Activity tracking should never break product traffic.
    // eslint-disable-next-line no-console
    console.warn('[activity] failed to record activity', {
      activityType,
      userId,
      err: (err as Error).message,
    });
  });
}

export function trackUserActivity(
  req: Request,
  userId: string,
  activityType: string,
  metadata: Record<string, unknown> = {},
): void {
  prisma.activityLog.create({
    data: {
      userId,
      activityType,
      metadata: { ...requestContext(req), ...metadata } as any,
      ipAddress: clientIp(req),
      userAgent: (req.headers['user-agent'] as string | undefined) || null,
    },
  }).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn('[activity] failed to record user activity', {
      activityType,
      userId,
      err: (err as Error).message,
    });
  });
}

export function trackAuthenticatedRequest(req: Request): void {
  if (!req.user?.id) return;
  const hourKey = new Date().toISOString().slice(0, 13);
  trackActivity(
    req,
    'authenticated_request',
    { ...requestContext(req), method: req.method, path: req.path },
    { throttleKey: `authenticated_request:${req.user.id}:${hourKey}` },
  );
}
