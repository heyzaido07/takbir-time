import type { Prisma } from '@prisma/client';

export interface ScheduleChange {
  prayer: string;
  action: string;
  reason: string;
  from?: string;
  to?: string;
}

type DbClient = Prisma.TransactionClient;

function plainTimings(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.some(v => v !== undefined && v !== null && v !== '');
  return true;
}

function sameTimingValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function changeValue(value: unknown): string | undefined {
  if (!hasMeaningfulValue(value)) return undefined;
  if (Array.isArray(value)) return value.filter(hasMeaningfulValue).join(', ');
  return String(value);
}

export function cleanedTimingPatch(timings: unknown): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(plainTimings(timings)).filter(([, value]) => hasMeaningfulValue(value)),
  );
}

export async function installMergedActiveSchedule(
  tx: DbClient,
  args: {
    mosqueId: string;
    submittedById: string;
    verifiedById?: string | null;
    timings: unknown;
    verificationStatus: string;
    reason: string;
    notes?: string | null;
  },
): Promise<ScheduleChange[]> {
  const current = await tx.prayerSchedule.findFirst({
    where: { mosqueId: args.mosqueId, isActive: true, deletedAt: null },
    orderBy: { validFrom: 'desc' },
  });
  const cur = plainTimings(current?.timings);
  const patch = cleanedTimingPatch(args.timings);
  const merged = { ...cur, ...patch };
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (Object.keys(patch).length === 0) return [];

  const changes: ScheduleChange[] = [];
  for (const [prayer, value] of Object.entries(patch)) {
    if (sameTimingValue(cur[prayer], value)) continue;
    const to = changeValue(value);
    if (!to) continue;
    changes.push({
      prayer,
      action: 'promoted',
      reason: args.reason,
      from: changeValue(cur[prayer]),
      to,
    });
  }

  if (changes.length === 0 && current) return [];

  if (current) {
    await tx.prayerSchedule.update({
      where: { id: current.id },
      data: { isActive: false, validUntil: today },
    });
  }

  await tx.prayerSchedule.create({
    data: {
      mosqueId: args.mosqueId,
      timings: merged as any,
      verificationStatus: args.verificationStatus,
      submittedById: args.submittedById,
      verifiedById: args.verifiedById ?? null,
      validFrom: today,
      isActive: true,
      notes: args.notes ?? null,
    },
  });

  return changes;
}

export async function installIfActiveKeeperSubmission(
  db: DbClient,
  args: {
    mosqueId: string;
    submittedById: string;
    timings: unknown;
  },
): Promise<ScheduleChange[] | null> {
  const current = await db.prayerSchedule.findFirst({
    where: { mosqueId: args.mosqueId, isActive: true, deletedAt: null },
    orderBy: { validFrom: 'desc' },
    select: {
      submittedById: true,
      verificationStatus: true,
      verifiedById: true,
    },
  });

  if (!current?.submittedById || current.submittedById !== args.submittedById) {
    return null;
  }

  return installMergedActiveSchedule(db, {
    mosqueId: args.mosqueId,
    submittedById: args.submittedById,
    verifiedById: current.verifiedById ?? args.submittedById,
    timings: args.timings,
    verificationStatus: current.verificationStatus || 'verified',
    reason: 'time keeper update',
  });
}
