/**
 * Sun-position salah card.
 *  - Since v4.1.1 the card AUTO-resolves location when the geolocation
 *    permission is already granted (no locate CTA, rows render on load).
 *    The e2e context pre-grants geolocation (helpers.openMobilePage), so
 *    every test here starts from the auto-resolved state.
 *  - 6 prayer rows render (Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha).
 *  - Switching fiqh recomputes — Hanafi Asr is later than Shafi'i Asr at
 *    Islamabad's lat/lng (factor 2 vs factor 1).
 *  - Fiqh choice persists across reload.
 *  - Coords persist across reload (no re-prompt on second visit).
 */

const {
  BASE_URL, ISLAMABAD,
  launch, openMobilePage, closePage,
  isVisible, waitVisible,
} = require('./helpers');

describe('Sun-position salah card', () => {
  let browser, page;

  beforeAll(async () => { browser = await launch(); });
  afterAll(async () => { await browser.close(); });
  beforeEach(async () => {
    page = await openMobilePage(browser, ISLAMABAD);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  });
  afterEach(async () => { await closePage(page); });

  const waitForRows = (p) => p.waitForFunction(
    () => document.querySelectorAll('#sun-list .sun-card__row').length === 6,
    { timeout: 10_000 }
  );

  test('card mounts with the fiqh selector and all 8 fiqh options', async () => {
    await waitVisible(page, '#sun-card');
    expect(await isVisible(page, '#sun-fiqh')).toBe(true);

    const optionValues = await page.$$eval('#sun-fiqh option', els => els.map(o => o.value));
    expect(optionValues).toEqual(
      expect.arrayContaining(['hanafi', 'shafi', 'maliki', 'hanbali', 'jafari', 'isna', 'egypt', 'ummalqura'])
    );
  });

  test('granted permission auto-resolves location: no CTA, 6 prayer rows render', async () => {
    await waitVisible(page, '#sun-card');
    await waitForRows(page);

    const rows = await page.$$eval('#sun-list .sun-card__row', els =>
      els.map(r => ({
        name: r.querySelector('.sun-card__row-name')?.textContent.trim(),
        time: r.querySelector('.sun-card__row-time')?.textContent.trim(),
      }))
    );
    expect(rows).toHaveLength(6);
    for (const r of rows) {
      expect(r.name.length).toBeGreaterThan(0);
      // Displayed in 12-hour with am/pm.
      expect(r.time).toMatch(/^\d{1,2}:\d{2}\s+(am|pm)$/i);
    }
    // The locate CTA never shows when the grant is reused automatically.
    expect(await isVisible(page, '#sun-locate')).toBe(false);
  });

  test('switching to Hanafi pushes Asr later than Shafi at northern latitudes', async () => {
    await waitVisible(page, '#sun-card');
    await waitForRows(page);

    // Sample the Asr time directly from sun.js to avoid the row-name lookup
    // (which is locale-dependent).
    const shafiAsr = await page.evaluate(
      () => window.sun.prayerTimesForCoords(33.7295, 73.0372, 'shafi').asr
    );
    const hanafiAsr = await page.evaluate(
      () => window.sun.prayerTimesForCoords(33.7295, 73.0372, 'hanafi').asr
    );
    // Both are HH:MM strings in the browser's local TZ. Hanafi must be later.
    expect(shafiAsr).toMatch(/^\d{2}:\d{2}$/);
    expect(hanafiAsr).toMatch(/^\d{2}:\d{2}$/);
    const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
    expect(toMin(hanafiAsr)).toBeGreaterThan(toMin(shafiAsr));
  });

  test('fiqh choice persists across reload', async () => {
    await waitVisible(page, '#sun-fiqh');
    await page.select('#sun-fiqh', 'jafari');
    expect(await page.evaluate(() => localStorage.getItem('jamat.fiqh'))).toBe('jafari');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitVisible(page, '#sun-fiqh');
    expect(await page.$eval('#sun-fiqh', el => el.value)).toBe('jafari');
  });

  test('rows render again after reload with no re-prompt', async () => {
    await waitVisible(page, '#sun-card');
    await waitForRows(page);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitVisible(page, '#sun-card');
    // Coords are cached (and the grant is reused) — rows render, CTA stays hidden.
    await waitForRows(page);
    expect(await isVisible(page, '#sun-locate')).toBe(false);
  });
});
