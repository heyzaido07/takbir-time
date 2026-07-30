import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

const prayers = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;

const qazaRecordSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  prayer: z.enum(prayers),
  clientId: z.string().min(1).max(160).optional(),
  recordedAt: z.string().datetime().optional(),
  prayedAt: z.string().datetime().nullable().optional(),
});

const markPrayedSchema = z.object({
  prayedAt: z.string().datetime().optional(),
});

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function recordResponse(row: any) {
  return {
    id: row.id,
    clientId: row.clientId,
    date: dateOnly(row.prayerDate),
    prayer: row.prayer,
    recordedAt: row.recordedAt?.toISOString?.() ?? row.recordedAt,
    prayedAt: row.prayedAt?.toISOString?.() ?? row.prayedAt ?? null,
    createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
    updatedAt: row.updatedAt?.toISOString?.() ?? row.updatedAt,
  };
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

router.get(
  '/',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const status = req.query.status === 'all' ? 'all' : 'open';
    const rows = await prisma.qazaRecord.findMany({
      where: {
        userId: req.user!.id,
        ...(status === 'open' ? { prayedAt: null } : {}),
      },
      orderBy: [{ prayerDate: 'asc' }, { prayer: 'asc' }, { recordedAt: 'asc' }],
    });

    res.json({ records: rows.map(recordResponse) });
  })
);

router.post(
  '/',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const data = qazaRecordSchema.parse(req.body);
    const prayerDate = parseDate(data.date);
    const clientId = data.clientId || `${data.date}:${data.prayer}:${Date.now()}`;

    const existingByClientId = await prisma.qazaRecord.findUnique({
      where: { userId_clientId: { userId: req.user!.id, clientId } },
    });
    if (existingByClientId) {
      res.json({ record: recordResponse(existingByClientId), alreadyExists: true });
      return;
    }

    const existingOpen = await prisma.qazaRecord.findFirst({
      where: {
        userId: req.user!.id,
        prayerDate,
        prayer: data.prayer,
        prayedAt: null,
      },
    });
    if (existingOpen) {
      res.json({ record: recordResponse(existingOpen), alreadyOpen: true });
      return;
    }

    const record = await prisma.qazaRecord.create({
      data: {
        userId: req.user!.id,
        clientId,
        prayer: data.prayer,
        prayerDate,
        recordedAt: data.recordedAt ? new Date(data.recordedAt) : new Date(),
        prayedAt: data.prayedAt ? new Date(data.prayedAt) : null,
      },
    });

    res.status(201).json({ record: recordResponse(record), created: true });
  })
);

router.patch(
  '/:id/prayed',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const data = markPrayedSchema.parse(req.body);
    const existing = await prisma.qazaRecord.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      select: { id: true, prayedAt: true },
    });
    if (!existing) throw new AppError(404, 'Qaza record not found');

    const record = await prisma.qazaRecord.update({
      where: { id: existing.id },
      data: { prayedAt: existing.prayedAt || (data.prayedAt ? new Date(data.prayedAt) : new Date()) },
    });
    res.json({ record: recordResponse(record) });
  })
);

export default router;
