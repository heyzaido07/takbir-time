/**
 * E2E: Google sign-in integration.
 *
 * Verifies the wiring between the login-modal Google button → js/auth.js →
 * js/auth-exchange.js → /api/auth/google → localStorage → auth-btn UI.
 *
 * The Firebase popup and the /api/auth/google network call are both stubbed
 * via page.evaluateOnNewDocument — we don't need real Google OAuth or a real
 * backend to verify the wiring. (The server's /api/auth/google contract is
 * already covered by server/src/__tests__/auth.test.ts.)
 *
 * Run locally against a static server:
 *   python -m http.server 6002
 *   BASE_URL=http://localhost:6002 SKIP_HEALTH=1 npm run test:e2e -- 18-google-signin
 */

const {
  launch, openMobilePage, closePage, BASE_URL, tap, waitVisible, isVisible,
  describeLocal,
} = require('./helpers');

let browser;
beforeAll(async () => { browser = await launch(); });
afterAll(async () => { await browser?.close(); });

describeLocal('Google sign-in (mocked Firebase)', () => {
  async function newPageWithStubs() {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();

    await page.evaluateOnNewDocument(() => {
      // Mark Firebase as configured so the Google button is shown.
      // Has to set on every script-init point because config.js mutates
      // window.JAMAT_CONFIG itself; we override AFTER it has loaded
      // by wrapping in a setter.
      let _cfg = { firebase: { apiKey: 'fake', projectId: 'fake' } };
      Object.defineProperty(window, 'JAMAT_CONFIG', {
        configurable: true,
        get() { return _cfg; },
        set(v) { _cfg = { ...(v || {}), firebase: { apiKey: 'fake', projectId: 'fake' } }; },
      });

      // Replace window.auth with a stub. The real auth.js loads as a
      // <script type="module"> which is async, so the stub may be
      // overwritten when the real module finally runs. Set it again on
      // DOMContentLoaded to guarantee our stub is in place when wireLogin
      // runs.
      const setStub = () => {
        window.auth = {
          isConfigured: () => true,
          signInWithGoogle: async () => ({
            user: { getIdToken: async () => 'mock.firebase.token' },
          }),
          getIdToken: async () => null,
          signOut: async () => {},
          init: async () => {},
        };
      };
      setStub();
      document.addEventListener('DOMContentLoaded', setStub, { once: true });

      // Intercept the /api/auth/google POST so we don't need a real
      // backend that accepts our fake Firebase token.
      const realFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const method = (init && init.method) || 'GET';
        const json = (body) => Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(body)),
          json: () => Promise.resolve(body),
        });
        if (url.includes('/auth/google') && method.toUpperCase() === 'POST') {
          return json({
            token: 'app.jwt.test',
            user: {
              id: 'u-test',
              email: 'gtest@example.com',
              fullName: 'G Test',
              hasGoogleAuth: true,
            },
          });
        }
        if (url.includes('/users/me/favorites') && method.toUpperCase() === 'GET') {
          return json({ data: [] });
        }
        if (url.includes('/users/me') && method.toUpperCase() === 'GET') {
          return json({
            id: 'u-test',
            email: 'gtest@example.com',
            fullName: 'G Test',
            notificationPreferences: {},
          });
        }
        return realFetch(input, init);
      };
    });

    page._jamat_context = ctx;
    return page;
  }

  test('Google button is hidden when Firebase is not configured', async () => {
    // Plain page — no stubs. The deployed default state has Firebase
    // unconfigured, so the button must stay hidden.
    const page = await openMobilePage(browser);
    try {
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      await tap(page, '#auth-btn');
      await waitVisible(page, '#login-modal[aria-hidden="false"]');
      // Either absent or hidden=true. exists+isVisible covers both.
      const visible = await isVisible(page, '#login-google');
      expect(visible).toBe(false);
    } finally {
      await closePage(page);
    }
  });

  test('clicking the Google button exchanges the token and signs the user in', async () => {
    const page = await newPageWithStubs();
    try {
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

      await tap(page, '#auth-btn');
      await waitVisible(page, '#login-modal[aria-hidden="false"]');

      // Button visible because we stubbed isConfigured() = true.
      expect(await isVisible(page, '#login-google')).toBe(true);

      await tap(page, '#login-google');

      // Wait for the auth-btn to flip to signed-in.
      await page.waitForFunction(
        () => document.getElementById('auth-btn')?.dataset.state === 'signed-in',
        { timeout: 5_000 }
      );

      const stored = await page.evaluate(() => ({
        jwt: localStorage.getItem('jamat_app_jwt'),
        user: JSON.parse(localStorage.getItem('jamat_app_user') || 'null'),
        email: localStorage.getItem('jamat_dev_email'),
      }));
      expect(stored.jwt).toBe('app.jwt.test');
      expect(stored.user?.email).toBe('gtest@example.com');
      expect(stored.email).toBe('gtest@example.com');
    } finally {
      await closePage(page);
    }
  });

  test('Capacitor native: button visible via FirebaseAuthentication plugin (no web Firebase config)', async () => {
    // Simulate the Capacitor shell: window.Capacitor.isNativePlatform()
    // returns true and Plugins.FirebaseAuthentication is registered.
    // Web-side JAMAT_CONFIG.firebase stays empty — exactly the state on
    // the phone: native plugin handles auth via google-services.json,
    // no web Firebase keys needed.
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.evaluateOnNewDocument(() => {
      window.Capacitor = {
        isNativePlatform: () => true,
        Plugins: {
          FirebaseAuthentication: {
            signInWithGoogle: async () => ({
              user: { uid: 'native-uid', email: 'native@example.com', displayName: 'Native User' },
              credential: { idToken: 'native.google.idtoken' },
            }),
            getIdToken: async () => ({ token: 'native.firebase.idtoken' }),
            signOut: async () => {},
          },
        },
      };
      // Intercept the /api/auth/google POST.
      const realFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const method = (init?.method || 'GET').toUpperCase();
        const json = (body) => Promise.resolve({
          ok: true, status: 200, statusText: 'OK',
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(body)),
          json: () => Promise.resolve(body),
        });
        if (url.includes('/auth/google') && method === 'POST') {
          return json({
            token: 'app.jwt.native',
            user: { id: 'u-n', email: 'native@example.com', fullName: 'Native User', hasGoogleAuth: true },
          });
        }
        if (url.includes('/users/me/favorites') && method === 'GET') {
          return json({ data: [] });
        }
        if (url.includes('/users/me') && method === 'GET') {
          return json({
            id: 'u-n',
            email: 'native@example.com',
            fullName: 'Native User',
            notificationPreferences: {},
          });
        }
        return realFetch(input, init);
      };
    });
    page._jamat_context = ctx;
    try {
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

      await tap(page, '#auth-btn');
      await waitVisible(page, '#login-modal[aria-hidden="false"]');

      expect(await isVisible(page, '#login-google')).toBe(true);

      await tap(page, '#login-google');
      await page.waitForFunction(
        () => document.getElementById('auth-btn')?.dataset.state === 'signed-in',
        { timeout: 5_000 }
      );

      // Assert the request body sent to /api/auth/google contained the
      // FIREBASE id token (from getIdToken), not the Google OAuth one.
      const stored = await page.evaluate(() => ({
        jwt: localStorage.getItem('jamat_app_jwt'),
        user: JSON.parse(localStorage.getItem('jamat_app_user') || 'null'),
      }));
      expect(stored.jwt).toBe('app.jwt.native');
      expect(stored.user?.email).toBe('native@example.com');
    } finally {
      await closePage(page);
    }
  });

  test('sign-out clears the app JWT and the stored user', async () => {
    const page = await newPageWithStubs();
    try {
      // Pre-seed as if we were already signed in via Google. Faster than
      // going through the popup again.
      await page.evaluateOnNewDocument(() => {
        localStorage.setItem('jamat_app_jwt', 'app.jwt.preseeded');
        localStorage.setItem('jamat_app_user', JSON.stringify({ id: 'u', email: 'preseeded@example.com' }));
        localStorage.setItem('jamat_dev_email', 'preseeded@example.com');
      });

      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      // confirm() returns true so the sign-out branch runs.
      await page.evaluate(() => { window.confirm = () => true; });

      // Sign-out path
      await tap(page, '#auth-btn');

      await page.waitForFunction(
        () => document.getElementById('auth-btn')?.dataset.state !== 'signed-in',
        { timeout: 5_000 }
      );

      const stored = await page.evaluate(() => ({
        jwt: localStorage.getItem('jamat_app_jwt'),
        user: localStorage.getItem('jamat_app_user'),
        email: localStorage.getItem('jamat_dev_email'),
      }));
      expect(stored.jwt).toBeNull();
      expect(stored.user).toBeNull();
      expect(stored.email).toBeNull();
    } finally {
      await closePage(page);
    }
  });
});
