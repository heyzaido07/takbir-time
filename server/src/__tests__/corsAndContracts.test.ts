import request from 'supertest';
import app from '../index';

describe('cross-cutting API contracts', () => {
  it('allows public browser reads with wildcard CORS and no credentials', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', 'https://third-party.example');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('does not allow arbitrary origins on write endpoints', async () => {
    const res = await request(app)
      .post('/api/mosques')
      .set('Origin', 'https://third-party.example')
      .send({});

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('enforces the nearby endpoint 20-result cap at validation time', async () => {
    const res = await request(app)
      .get('/api/mosques/nearby?lat=33.7&lng=73.0&radius=5000&limit=21');

    expect(res.status).toBe(400);
  });
});
