/**
 * Tests for js/api.js — Authorization-header selection.
 *
 * The contract we want:
 *   1. If we have an app JWT (post-Google-exchange), send THAT as Bearer.
 *      The app JWT is long-lived (30d) and unifies the email/password +
 *      Google flows under one token format.
 *   2. Otherwise, fall back to a live Firebase ID token if one is
 *      available (legacy clients that haven't gone through /auth/google).
 *   3. Otherwise, fall back to the X-Dev-User-Email header for dev/local only.
 *   4. With no credentials at all, the request goes anonymous.
 */

const path = require('path');
const fs = require('fs');

function loadAuthExchange() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'auth-exchange.js'), 'utf8');
  // eslint-disable-next-line no-eval
  window.eval(src);
}

function loadApi() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');
  // eslint-disable-next-line no-eval
  window.eval(src);
  return window.api;
}

function fakeResponse(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    text: () => Promise.resolve(text),
  };
}

describe('js/api.js — Authorization header', () => {
  let api;
  let fetchMock;

  beforeEach(() => {
    localStorage.clear();
    window.JAMAT_CONFIG = { apiBase: 'http://localhost:6001/api', useMockData: false };
    // state.js / storage.js dependencies api.js touches in some paths.
    window.state = { user: { favoriteMosques: [] }, mosques: [], submissions: {}, notifications: [] };
    window.storage = { saveMosqueCache: jest.fn(), getMosqueCache: jest.fn(() => null), saveFavorites: jest.fn() };
    // Default fetch response is shaped to satisfy both `/users/me`
    // (returns the user object directly) and `/mosques/nearby` (returns
    // a paginated `{ data, pagination }` envelope). Tests don't care
    // about the body — only the request headers.
    fetchMock = jest.fn().mockResolvedValue(fakeResponse(200, { id: 'u1', email: 'me@example.com', data: [] }));
    window.fetch = fetchMock;

    loadAuthExchange();
    api = loadApi();
  });

  afterEach(() => {
    localStorage.clear();
    delete window.api;
    delete window.ApiError;
    delete window.authExchange;
    delete window.JAMAT_CONFIG;
    delete window.state;
    delete window.storage;
    delete window.auth;
    delete window.fetch;
  });

  it('uses the stored app JWT as Bearer token when one is present', async () => {
    localStorage.setItem('jamat_app_jwt', 'app.jwt.token');
    // No Firebase, no dev email.
    delete window.auth;

    await api.getMyProfile();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer app.jwt.token');
    // Dev-auth header must NOT also be set when we have a real token.
    expect(init.headers['X-Dev-User-Email']).toBeUndefined();
  });

  it('prefers the app JWT over a live Firebase ID token', async () => {
    localStorage.setItem('jamat_app_jwt', 'app.jwt.token');
    // Pretend Firebase is also signed in. The app JWT must win — it's
    // the long-lived token and api.js shouldn't waste a getIdToken()
    // round-trip on every request when we already have a valid bearer.
    window.auth = {
      isConfigured: () => true,
      getIdToken: jest.fn(async () => 'firebase.id.token'),
    };

    await api.getMyProfile();

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer app.jwt.token');
  });

  it('falls back to the Firebase ID token when no app JWT is stored', async () => {
    window.auth = {
      isConfigured: () => true,
      getIdToken: jest.fn(async () => 'firebase.id.token'),
    };

    await api.getMyProfile();

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer firebase.id.token');
  });

  it('falls back to X-Dev-User-Email when no token is available', async () => {
    localStorage.setItem('jamat_dev_email', 'dev@local.test');
    window.JAMAT_CONFIG.devAuthEnabled = true;
    delete window.auth;

    await api.getMyProfile();

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.headers['X-Dev-User-Email']).toBe('dev@local.test');
  });

  it('does not send X-Dev-User-Email when dev auth is disabled', async () => {
    localStorage.setItem('jamat_dev_email', 'dev@local.test');
    window.JAMAT_CONFIG.devAuthEnabled = false;
    delete window.auth;

    await expect(api.getMyProfile()).rejects.toMatchObject({ status: 401 });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends no auth header at all when fully anonymous', async () => {
    delete window.auth;

    // requireAuth is false on getNearbyMosques (public endpoint).
    await api.getNearbyMosques(33.7295, 73.0372, 5);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.headers['X-Dev-User-Email']).toBeUndefined();
  });

  it('reverseGeocode normalizes a direct Nominatim response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        name: 'Park Road',
        display_name: 'Park Road, F-8, Islamabad, Pakistan',
        address: { road: 'Park Road', city: 'Islamabad', country: 'Pakistan' },
      }),
    });

    const result = await api.reverseGeocode(33.7115207, 73.033076);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('nominatim.openstreetmap.org/reverse');
    expect(result).toEqual({
      city: 'Islamabad',
      country: 'Pakistan',
      addressLine1: 'Park Road',
    });
  });

  it('reverseGeocode falls back to the backend proxy when direct lookup fails', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('direct lookup failed'))
      .mockResolvedValueOnce(fakeResponse(200, {
        city: 'Islamabad',
        country: 'Pakistan',
        addressLine1: 'Park Road',
      }));

    const result = await api.reverseGeocode(33.7115207, 73.033076);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('http://localhost:6001/api/geocode/reverse?lat=33.7115207&lng=73.033076');
    expect(result).toEqual({
      city: 'Islamabad',
      country: 'Pakistan',
      addressLine1: 'Park Road',
    });
  });
});
