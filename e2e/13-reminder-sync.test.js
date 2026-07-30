/**
 * Cross-device reminder sync.
 *  - Saving prefs in one browser fires PUT /api/users/me/reminder-prefs
 *    (mirrored on the user record).
 *  - Signing in as the same user in a second browser context hydrates
 *    localStorage from the server, so the prefs survive across devices.
 */

const {
  BASE_URL, ISLAMABAD,
  launch, openMobilePage, closePage,
  signIn,
  authTest,
} = require('./helpers');

describe('Reminder pref cross-device sync', () => {
  let browser;

  beforeAll(async () => { browser = await launch(); });
  afterAll(async () => { await browser.close(); });

  authTest('savePrefs in one browser propagates to a second browser session for the same user', async () => {
    // Browser 1: sign in, save a known prefs blob via the public API.
    const email = `reminder-sync-${Date.now()}@jamat.local`;
    const a = await openMobilePage(browser, ISLAMABAD);
    await a.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await signIn(a, email);

    const knownPrefs = {
      enabled: true,
      perPrayer: { fajr: 7, dhuhr: 0, asr: 12, maghrib: 0, isha: 5, jummah: 15 },
      prayerEnabled: { fajr: true, dhuhr: false, asr: true, maghrib: false, isha: true, jummah: false },
    };
    // Drive savePrefs directly — that's what the bell/panel UI does internally.
    await a.evaluate(p => window.reminders.savePrefs(p), knownPrefs);

    // Wait for the server PUT to complete by polling the profile endpoint
    // until reminderPrefs reflects the change. (savePrefs is fire-and-forget.)
    await a.waitForFunction(async () => {
      const base = window.JAMAT_CONFIG.apiBase;
      const e = localStorage.getItem('jamat_dev_email');
      const r = await fetch(`${base}/users/me`, { headers: { 'X-Dev-User-Email': e } });
      const me = await r.json();
      return me?.notificationPreferences?.reminderPrefs?.perPrayer?.fajr === 7;
    }, { timeout: 5_000 });

    // Browser 2: fresh context (separate localStorage), sign in as the SAME user.
    const b = await openMobilePage(browser, ISLAMABAD);
    await b.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await signIn(b, email);

    // After loadProfile() runs, localStorage should mirror the server prefs.
    await b.waitForFunction(() => {
      const raw = localStorage.getItem('jamat_reminder_prefs');
      if (!raw) return false;
      const p = JSON.parse(raw);
      return p?.perPrayer?.fajr === 7
          && p?.prayerEnabled?.asr === true
          && p?.prayerEnabled?.dhuhr === false;
    }, { timeout: 5_000 });

    const restored = await b.evaluate(() => JSON.parse(localStorage.getItem('jamat_reminder_prefs')));
    expect(restored.perPrayer.fajr).toBe(7);
    expect(restored.perPrayer.asr).toBe(12);
    expect(restored.prayerEnabled.fajr).toBe(true);
    expect(restored.prayerEnabled.dhuhr).toBe(false);
    expect(restored.enabled).toBe(true);

    await closePage(a);
    await closePage(b);
  });
});
