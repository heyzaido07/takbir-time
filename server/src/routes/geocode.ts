import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { geocodeLimiter } from '../middleware/rateLimit';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

const reverseQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function normalizeNominatimAddress(data: any) {
  const a = data?.address || {};
  const city = firstString(
    a.city,
    a.town,
    a.village,
    a.municipality,
    a.city_district,
    a.state_district,
    a.suburb,
    a.county,
    a.state,
  );
  const country = firstString(a.country);
  const street = [a.house_number, a.road].filter(Boolean).join(' ').trim();
  const addressLine1 = firstString(street, data?.name, String(data?.display_name || '').split(',')[0]);
  return { city, country, addressLine1 };
}

router.get(
  '/reverse',
  geocodeLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const { lat, lng } = reverseQuerySchema.parse(req.query);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    try {
      const url = new URL('https://nominatim.openstreetmap.org/reverse');
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('lat', String(lat));
      url.searchParams.set('lon', String(lng));
      url.searchParams.set('addressdetails', '1');
      url.searchParams.set('zoom', '16');
      url.searchParams.set('accept-language', 'en');

      const upstream = await fetch(url.toString(), {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'TakbeerTime/1.0 (+https://takbeertime.com)',
        },
      });
      if (!upstream.ok) {
        throw new AppError(502, 'Location lookup failed');
      }
      const data = await upstream.json();
      res.json(normalizeNominatimAddress(data));
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(502, 'Location lookup failed');
    } finally {
      clearTimeout(timer);
    }
  }),
);

export default router;
