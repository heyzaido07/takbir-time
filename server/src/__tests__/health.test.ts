import request from 'supertest';
import app from '../index';

describe('GET /health', () => {
  it('returns ok status with timestamp and environment', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
    expect(res.body.timestamp).toBeDefined();
    expect(res.body.environment).toBeDefined();
  });
});

describe('GET /api', () => {
  it('returns API discovery metadata', async () => {
    const res = await request(app).get('/api');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Takbeer Time API',
      baseUrl: 'https://takbeertime.com/api',
      docsUrl: 'https://takbeertime.com/api-docs.html',
    });
    expect(res.body.endpoints.mosques).toContain('GET /api/mosques/nearby');
  });
});

describe('404 handler', () => {
  it('returns 404 with method + path for unknown routes', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not Found');
    expect(res.body.message).toContain('GET /api/nope');
  });
});
