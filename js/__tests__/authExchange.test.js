/**
 * Tests for js/auth-exchange.js
 *
 * The auth-exchange module is the bridge between Firebase Google sign-in
 * (which gives us a Firebase ID token) and our backend's /api/auth/google
 * endpoint (which gives us a long-lived app JWT). Once we have the app
 * JWT we store it in localStorage and api.js sends it on every request,
 * so the user stays signed in even after the Firebase ID token expires.
 *
 * These tests run in jsdom — no real network, no real Firebase. We mock
 * fetch() and assert on what the module sends + stores.
 */

const path = require('path');
const fs = require('fs');

function loadModule() {
  // Re-evaluate the script in the current jsdom window so each test gets
  // a fresh module state. The module is an IIFE that exposes itself on
  // window.authExchange — running it twice is harmless (it just rebinds).
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'auth-exchange.js'),
    'utf8'
  );
  // eslint-disable-next-line no-eval
  window.eval(src);
  return window.authExchange;
}

/** Build a fetch-Response-shaped object that auth-exchange consumes.
 *  We can't use the real Response constructor — jsdom doesn't expose it. */
function fakeResponse(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 401 ? 'Unauthorized' : status === 500 ? 'Server Error' : 'OK',
    text: () => Promise.resolve(text),
  };
}

describe('js/auth-exchange.js', () => {
  let authExchange;
  let fetchMock;

  beforeEach(() => {
    localStorage.clear();
    window.JAMAT_CONFIG = { apiBase: 'http://localhost:6001/api' };
    fetchMock = jest.fn();
    window.fetch = fetchMock;
    authExchange = loadModule();
  });

  afterEach(() => {
    localStorage.clear();
    delete window.authExchange;
    delete window.JAMAT_CONFIG;
    delete window.fetch;
  });

  describe('exchangeFirebaseToken', () => {
    it('POSTs the idToken to /api/auth/google as JSON', async () => {
      fetchMock.mockResolvedValueOnce(
        fakeResponse(200, {
          token: 'app.jwt.value',
          user: { id: 'u1', email: 'u1@example.com', fullName: 'U One', hasGoogleAuth: true },
        })
      );

      await authExchange.exchangeFirebaseToken('firebase-id-token');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://localhost:6001/api/auth/google');
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(init.body)).toEqual({ idToken: 'firebase-id-token' });
    });

    it('stores the app JWT and user payload in localStorage on success', async () => {
      const user = { id: 'u1', email: 'u1@example.com', fullName: 'U One', hasGoogleAuth: true };
      fetchMock.mockResolvedValueOnce(fakeResponse(200, { token: 'app.jwt.value', user }));

      const result = await authExchange.exchangeFirebaseToken('firebase-id-token');

      expect(result.token).toBe('app.jwt.value');
      expect(result.user).toEqual(user);
      expect(localStorage.getItem('jamat_app_jwt')).toBe('app.jwt.value');
      expect(JSON.parse(localStorage.getItem('jamat_app_user'))).toEqual(user);
    });

    it('throws when idToken is empty without making a request', async () => {
      await expect(authExchange.exchangeFirebaseToken('')).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws when API base is not configured', async () => {
      delete window.JAMAT_CONFIG;
      await expect(authExchange.exchangeFirebaseToken('x')).rejects.toThrow();
    });

    it('throws on non-OK response and does not store anything', async () => {
      fetchMock.mockResolvedValueOnce(
        fakeResponse(401, { error: 'Google sign-in failed: invalid token' })
      );

      await expect(authExchange.exchangeFirebaseToken('bad-token')).rejects.toMatchObject({
        status: 401,
        message: expect.stringMatching(/invalid token/i),
      });
      expect(localStorage.getItem('jamat_app_jwt')).toBeNull();
      expect(localStorage.getItem('jamat_app_user')).toBeNull();
    });

    it('throws on a 5xx with the server error message when present', async () => {
      fetchMock.mockResolvedValueOnce(fakeResponse(500, { error: 'Server misconfigured' }));
      await expect(authExchange.exchangeFirebaseToken('x')).rejects.toMatchObject({
        status: 500,
        message: expect.stringMatching(/misconfigured/i),
      });
    });
  });

  describe('getStoredAppJwt', () => {
    it('returns null when nothing has been stored', () => {
      expect(authExchange.getStoredAppJwt()).toBeNull();
    });

    it('returns the JWT string when one is stored', () => {
      localStorage.setItem('jamat_app_jwt', 'my.jwt.token');
      expect(authExchange.getStoredAppJwt()).toBe('my.jwt.token');
    });
  });

  describe('getStoredUser', () => {
    it('returns null when nothing has been stored', () => {
      expect(authExchange.getStoredUser()).toBeNull();
    });

    it('returns the parsed user object when one is stored', () => {
      const u = { id: 'u1', email: 'u1@example.com' };
      localStorage.setItem('jamat_app_user', JSON.stringify(u));
      expect(authExchange.getStoredUser()).toEqual(u);
    });

    it('returns null gracefully when stored user is malformed', () => {
      localStorage.setItem('jamat_app_user', '{ not json');
      expect(authExchange.getStoredUser()).toBeNull();
    });
  });

  describe('clearStoredAppJwt', () => {
    it('removes both jamat_app_jwt and jamat_app_user', () => {
      localStorage.setItem('jamat_app_jwt', 'x');
      localStorage.setItem('jamat_app_user', '{}');
      authExchange.clearStoredAppJwt();
      expect(localStorage.getItem('jamat_app_jwt')).toBeNull();
      expect(localStorage.getItem('jamat_app_user')).toBeNull();
    });

    it('does not crash when nothing is stored', () => {
      expect(() => authExchange.clearStoredAppJwt()).not.toThrow();
    });
  });
});
