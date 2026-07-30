/**
 * E2E for the Maghrib-offset submission UX.
 *
 *   - The submit form has NO `input[name="maghrib"]` — Maghrib is
 *     astronomical, not contributor-set.
 *   - It has a `select[name="maghribOffset"]` with options 0..15 and
 *     `+3 min` selected by default.
 *   - Submitting the form sends `timings.maghribOffset` (a number) to the
 *     API and the resulting active schedule includes it.
 *   - The hero card's Maghrib row reflects the chosen offset (sunset + N).
 */

const {
  BASE_URL, ISLAMABAD,
  launch, openMobilePage, closePage,
  isVisible, waitVisible, tap, signIn,
  authTest,
} = require('./helpers');

describe('Maghrib offset (sunset + N min)', () => {
  let browser, page;

  beforeAll(async () => { browser = await launch(); });
  afterAll(async () => { await browser.close(); });
  beforeEach(async () => {
    page = await openMobilePage(browser, ISLAMABAD);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  });
  afterEach(async () => { await closePage(page); });

  // Create a fresh mosque via API + open via hash routing — gives us a
  // deterministic empty mosque to submit timings to.
  async function createFreshMosqueAndOpenForm() {
    await signIn(page);
    const mosqueId = await page.evaluate(async () => {
      const email = localStorage.getItem('jamat_dev_email');
      // Use the same apiBase the frontend uses — works for local-dev (cross-origin
      // localhost:6001) and prod (same-origin /api) without per-env knobs.
      const base = window.JAMAT_CONFIG.apiBase;
      const r = await fetch(`${base}/mosques`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-User-Email': email },
        body: JSON.stringify({
          name: `Offset E2E ${Date.now()}`,
          latitude: 33.7295, longitude: 73.0372,
          city: 'Islamabad', country: 'Pakistan',
        }),
      });
      const m = await r.json();
      return m.id;
    });
    expect(mosqueId).toMatch(/^[0-9a-f-]{36}$/);

    await page.goto(`${BASE_URL}/#mosque/${mosqueId}`, { waitUntil: 'domcontentloaded' });
    await waitVisible(page, '#drawer[aria-hidden="false"]');
    await tap(page, '#btn-submit-from-empty');
    await waitVisible(page, '#submit-form');
    return mosqueId;
  }

  authTest('submit form has no Maghrib HH:MM input', async () => {
    await createFreshMosqueAndOpenForm();
    const hasOldInput = await page.evaluate(
      () => !!document.querySelector('#submit-form input[name="maghrib"]')
    );
    expect(hasOldInput).toBe(false);
  });

  authTest('submit form has a Maghrib offset selector with +3 min as the default', async () => {
    await createFreshMosqueAndOpenForm();
    expect(await isVisible(page, '#submit-form select[name="maghribOffset"]')).toBe(true);

    const optionValues = await page.$$eval(
      '#submit-form select[name="maghribOffset"] option',
      els => els.map(o => o.value)
    );
    expect(optionValues).toEqual(expect.arrayContaining(['0', '1', '2', '3', '5', '10', '15']));

    const defaultValue = await page.$eval(
      '#submit-form select[name="maghribOffset"]',
      el => el.value
    );
    expect(defaultValue).toBe('3');
  });

  authTest('submitting the form persists maghribOffset on the active schedule', async () => {
    const mosqueId = await createFreshMosqueAndOpenForm();

    // Pick +5 min so we can verify it survives the round-trip.
    await page.select('#submit-form select[name="maghribOffset"]', '5');
    // Also set Fajr so the submission isn't all-empty.
    await page.evaluate(() => {
      const el = document.querySelector('#submit-form input[name="fajr"]');
      el.value = '04:55';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await tap(page, '#btn-submit-confirm');
    // The submit handler hides the form on success.
    await page.waitForSelector('#submit-form', { hidden: true, timeout: 5_000 });

    // Pull the active schedule via API and verify maghribOffset === 5.
    const schedule = await page.evaluate(async (id) => {
      const email = localStorage.getItem('jamat_dev_email');
      const base = window.JAMAT_CONFIG.apiBase;
      const r = await fetch(`${base}/mosques/${id}`, {
        headers: { 'X-Dev-User-Email': email },
      });
      const m = await r.json();
      return m.prayerSchedules?.[0]?.timings;
    }, mosqueId);

    if (!schedule || schedule.maghribOffset !== 5) {
      console.log('[debug schedule]', JSON.stringify(schedule));
      // Also dump the latest submission to see what reached the backend.
      const sub = await page.evaluate(async (id) => {
        const email = localStorage.getItem('jamat_dev_email');
        const base = window.JAMAT_CONFIG.apiBase;
        const r = await fetch(`${base}/submissions?mosqueId=${id}`, { headers: { 'X-Dev-User-Email': email } });
        return r.json();
      }, mosqueId);
      console.log('[debug submissions]', JSON.stringify(sub));
    }
    expect(schedule).toBeDefined();
    expect(schedule.maghribOffset).toBe(5);
    expect(schedule.fajr).toBe('04:55');
  });

  authTest('hero Maghrib row uses computed sunset + offset (no contributor HH:MM)', async () => {
    const mosqueId = await createFreshMosqueAndOpenForm();
    await page.select('#submit-form select[name="maghribOffset"]', '7');
    // Also set a Fajr so consensus has at least one prayer to work with.
    await page.evaluate(() => {
      const el = document.querySelector('#submit-form input[name="fajr"]');
      el.value = '04:55';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await tap(page, '#btn-submit-confirm');
    await page.waitForSelector('#submit-form', { hidden: true, timeout: 5_000 });

    // Make this the user's default so the hero hydrates.
    await tap(page, '#btn-set-default');
    await page.waitForFunction(
      () => document.querySelector('#btn-set-default')?.textContent?.toLowerCase().includes('your default'),
      { timeout: 5_000 }
    );

    // Reload so the hero re-fetches the mosque (now with the active schedule
    // including maghribOffset that was posted via the form submit).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitVisible(page, '#next-all-list');

    // Find the Maghrib row and pull its time + the sun.js sunset for these coords.
    // The displayed Maghrib should be sunset + 7 minutes (within 1-min rounding).
    const debug = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('#next-all-list .next-card__all-row'));
      const dump = rows.map(r => ({
        name: r.querySelector('.next-card__all-name')?.textContent?.trim(),
        time: r.querySelector('.next-card__jamat')?.textContent?.trim(),
      }));
      const sunset = window.sun.maghribForMosque({ latitude: 33.7295, longitude: 73.0372 }, undefined, 7);
      // Identify the Maghrib row by index in PRAYER_ORDER among the visible rows.
      // The PRAYER_ORDER is fajr, dhuhr, asr, maghrib, isha, jummah. We submitted
      // only fajr (and maghribOffset → maghrib computed), so the rendered rows
      // should be exactly [fajr, maghrib].
      // Format expected through the same fmt12 helper the UI uses, so the
      // assertion matches whatever the dropdown renders ("5:30 am" etc.).
      const expectedFmt = window.JAMAT_RENDER.fmt12(sunset);
      return { rows: dump, expected: expectedFmt };
    });
    const maghribCell = debug.rows.find(r => r.time === debug.expected);
    // Surface the row dump in the assertion message so a failure tells us why.
    if (!maghribCell) {
      throw new Error(
        `No row matched expected sunset+offset time "${debug.expected}". Rendered rows: ${JSON.stringify(debug.rows)}`
      );
    }
    expect(maghribCell.time).toMatch(/^\d{1,2}:\d{2}\s+(am|pm)$/i);
  });
});
