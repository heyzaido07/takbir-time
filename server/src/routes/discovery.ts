import { Router, Request, Response } from 'express';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'Takbeer Time API',
    version: '1.0.0',
    description: 'Public REST API for masjid jamat, jamaat, and iqamah times.',
    baseUrl: 'https://takbeertime.com/api',
    docsUrl: 'https://takbeertime.com/api-docs.html',
    healthUrl: 'https://takbeertime.com/health',
    capabilities: [
      'Find nearby masjids by latitude and longitude',
      'Search masjids by city, country, and name',
      'Read active jamat and iqamah timings',
      'Submit and review crowd-sourced time updates',
      'Follow timekeepers and receive timing-change notifications',
    ],
    endpoints: {
      auth: [
        'POST /api/auth/register',
        'POST /api/auth/login',
        'POST /api/auth/google',
      ],
      mosques: [
        'GET /api/mosques/recent',
        'GET /api/mosques/nearby',
        'GET /api/mosques',
        'GET /api/mosques/:id',
        'GET /api/mosques/:id/keepers',
        'GET /api/mosques/:id/consensus',
        'GET /api/mosques/:id/reviews',
        'POST /api/mosques',
        'PUT /api/mosques/:id',
        'POST /api/mosques/:id/reviews',
        'POST /api/mosques/:id/favorite',
      ],
      submissions: [
        'GET /api/submissions',
        'GET /api/submissions/:id',
        'POST /api/submissions',
        'POST /api/submissions/:id/vote',
        'POST /api/submissions/:id/review',
      ],
      suggestions: [
        'POST /api/suggestions',
        'GET /api/suggestions/inbox',
        'POST /api/suggestions/:id/accept',
        'POST /api/suggestions/:id/decline',
      ],
      users: [
        'GET /api/users/me',
        'PUT /api/users/me',
        'GET /api/users/me/favorites',
        'GET /api/users/me/notifications',
        'PATCH /api/users/me/notifications/:id/read',
        'POST /api/users/me/notifications/read-all',
        'PUT /api/users/me/preferred-keeper',
        'PUT /api/users/me/reminder-prefs',
        'DELETE /api/users/me',
      ],
      schedules: [
        'GET /api/schedules',
        'GET /api/schedules/:id',
        'GET /api/schedules/mosque/:mosqueId/active',
      ],
      accountDeletion: [
        'POST /api/account-deletion-request',
      ],
    },
  });
});

export default router;
