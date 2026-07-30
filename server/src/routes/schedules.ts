import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { parsePagination, paginated } from '../lib/pagination';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

const listSchedulesSchema = z.object({
  mosqueId: z.string().uuid().optional(),
  active: z.enum(['true', 'false']).optional(),
});

router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const filters = listSchedulesSchema.parse(req.query);
    const pagination = parsePagination(req);

    const where: any = { deletedAt: null };
    if (filters.mosqueId) where.mosqueId = filters.mosqueId;
    if (filters.active) where.isActive = filters.active === 'true';

    const [rows, totalCount] = await Promise.all([
      prisma.prayerSchedule.findMany({
        where,
        skip: pagination.skip,
        take: pagination.limit,
        orderBy: [{ isActive: 'desc' }, { validFrom: 'desc' }],
        include: { mosque: { select: { id: true, name: true, city: true } } },
      }),
      prisma.prayerSchedule.count({ where }),
    ]);

    res.json(paginated(rows, totalCount, pagination));
  })
);

router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const schedule = await prisma.prayerSchedule.findFirst({
      where: { id: req.params.id, deletedAt: null },
      include: {
        mosque: { select: { id: true, name: true, city: true, country: true } },
        submittedBy: { select: { id: true, fullName: true } },
        verifiedBy: { select: { id: true, fullName: true } },
      },
    });
    if (!schedule) throw new AppError(404, 'Schedule not found');
    res.json(schedule);
  })
);

router.get(
  '/mosque/:mosqueId/active',
  asyncHandler(async (req: Request, res: Response) => {
    const schedule = await prisma.prayerSchedule.findFirst({
      where: { mosqueId: req.params.mosqueId, isActive: true, deletedAt: null },
      orderBy: { validFrom: 'desc' },
    });
    if (!schedule) throw new AppError(404, 'No active schedule for this mosque');
    res.json(schedule);
  })
);

export default router;
