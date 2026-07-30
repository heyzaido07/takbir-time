import request from 'supertest';
import app from '../index';

describe('GET /api/geocode/reverse', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('normalizes city, country, and address from Nominatim', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        name: 'Park Road',
        display_name: 'Park Road, F-8, Islamabad, Pakistan',
        address: {
          road: 'Park Road',
          suburb: 'F-8',
          city: 'Islamabad',
          country: 'Pakistan',
        },
      }),
    }) as any);

    const res = await request(app).get('/api/geocode/reverse?lat=33.7115207&lng=73.033076');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      city: 'Islamabad',
      country: 'Pakistan',
      addressLine1: 'Park Road',
    });
  });

  it('validates coordinates before calling upstream geocoding', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as any;

    const res = await request(app).get('/api/geocode/reverse?lat=200&lng=73');

    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
