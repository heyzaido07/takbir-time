const {
  BASE_URL, launch, openMobilePage, closePage,
  isVisible, textOf, attrOf,
  waitVisible, tap, signIn, waitForDirectoryCards,
  authTest,
} = require('./helpers');

describe('Reminders (jamat alarm)', () => {
  let browser, page;

  beforeAll(async () => { browser = await launch(); });
  afterAll(async () => { await browser.close(); });
  beforeEach(async () => {
    page = await openMobilePage(browser);
    // Pre-grant Notifications so the "Save" path doesn't block on a permission prompt.
    const ctx = page._jamat_context;
    await ctx.overridePermissions(BASE_URL, ['geolocation', 'notifications']);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await waitForDirectoryCards(page);
  });
  afterEach(async () => { await closePage(page); });

  // We need a mosque with active prayer schedule to be the user's default,
  // so the bell button on the hero card has timings to schedule against.
  async function setFaisalAsDefault() {
    await signIn(page);
    const opened = await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('#list-nearby > .card'))
        .find(c => c.querySelector('.card__name')?.textContent?.includes('Faisal Mosque'));
      if (card) { card.click(); return true; }
      return false;
    });
    expect(opened).toBe(true);
    await waitVisible(page, '#drawer[aria-hidden="false"]');
    await tap(page, '#btn-set-default');
    // Wait for the button to flip to "✓ Your default mosque"
    await page.waitForFunction(
      () => document.querySelector('#btn-set-default')?.textContent?.includes('Your default'),
      { timeout: 5_000 }
    );
    // Setting a default auto-navigates home — the drawer closes on its own.
    await page.waitForSelector('#drawer[aria-hidden="false"]', { hidden: true });
  }

  // Note: the bell does NOT appear for an anonymous user with no default
  // mosque — the directory list endpoint doesn't include schedules, so the
  // hero has no fallback "first nearby with timings" to pin to. The bell
  // appears in the next test, after we explicitly set Faisal as default.

  authTest('bell button appears after setting a default with timings', async () => {
    await setFaisalAsDefault();
    await waitVisible(page, '#reminder-toggle-wrap');
    await waitVisible(page, '#next-bell');
    expect(await textOf(page, '#next-bell-label')).toBe('Remind me');
  });

  authTest('tapping bell opens the reminder panel with per-prayer rows', async () => {
    await setFaisalAsDefault();
    await tap(page, '#next-bell');
    await waitVisible(page, '#reminder-panel');
    // Each obligatory prayer + jummah has its own input row
    const inputs = await page.$$eval('[data-prayer-input]', els => els.map(e => e.dataset.prayerInput));
    expect(inputs.sort()).toEqual(['asr', 'dhuhr', 'fajr', 'isha', 'jummah', 'maghrib']);
  });

  authTest('first bell-tap auto-arms all 5 obligatory prayers at 10min; typing one prayer overrides only that prayer', async () => {
    // Per commit 10c72ef ("Reminder bell: icon-only with golden ring + count
    // badge"): tapping the bell from the inactive state auto-arms Fajr,
    // Dhuhr, Asr, Maghrib, Isha at 10 min default with their per-prayer
    // toggles ON and master ON. Jummah stays off (Friday-only). The user
    // can then fine-tune in the panel.
    await setFaisalAsDefault();
    await tap(page, '#next-bell');
    await waitVisible(page, '#reminder-panel');

    // Right after the auto-arm, override Fajr to 7 min.
    await page.click('input[data-prayer-input="fajr"]', { clickCount: 3 });
    await page.type('input[data-prayer-input="fajr"]', '7');
    await page.evaluate(() => document.querySelector('input[data-prayer-input="fajr"]').dispatchEvent(new Event('change', { bubbles: true })));

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('jamat_reminder_prefs') || '{}'));
    // Fajr reflects the user's typed value
    expect(stored.perPrayer.fajr).toBe(7);
    // Other obligatory prayers stay at the 10min auto-arm default
    expect(stored.perPrayer.dhuhr).toBe(10);
    expect(stored.perPrayer.asr).toBe(10);
    expect(stored.perPrayer.maghrib).toBe(10);
    expect(stored.perPrayer.isha).toBe(10);
    // Jummah deliberately not auto-armed (Friday-only)
    expect(stored.perPrayer.jummah).toBeFalsy();
    // All 5 obligatory toggles flipped on by the auto-arm
    for (const k of ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']) {
      expect(stored.prayerEnabled[k]).toBe(true);
    }
    expect(stored.enabled).toBe(true);
  });

  authTest('tapping the bell again when already armed does NOT clobber the typed values', async () => {
    // Regression guard for the second half of the commit 10c72ef contract:
    // "Tap when active: just toggles the panel (no clobbering of existing
    // values)." Without this, a user who carefully set Fajr=4 would lose
    // their value the next time they re-opened the panel.
    await setFaisalAsDefault();

    // First tap: auto-arms all to 10. Override Fajr to 4.
    await tap(page, '#next-bell');
    await waitVisible(page, '#reminder-panel');
    await page.click('input[data-prayer-input="fajr"]', { clickCount: 3 });
    await page.type('input[data-prayer-input="fajr"]', '4');
    await page.evaluate(() => document.querySelector('input[data-prayer-input="fajr"]').dispatchEvent(new Event('change', { bubbles: true })));

    // Close the panel. Confirm Fajr is 4 in storage.
    await tap(page, '#next-bell');
    await page.waitForFunction(() => document.getElementById('reminder-panel')?.hidden === true);
    const beforeReopen = await page.evaluate(() => JSON.parse(localStorage.getItem('jamat_reminder_prefs') || '{}'));
    expect(beforeReopen.perPrayer.fajr).toBe(4);

    // Re-open the panel. The auto-arm code path must NOT run a second time
    // — Fajr stays at 4, not get re-defaulted back to 10.
    await tap(page, '#next-bell');
    await waitVisible(page, '#reminder-panel');
    const afterReopen = await page.evaluate(() => JSON.parse(localStorage.getItem('jamat_reminder_prefs') || '{}'));
    expect(afterReopen.perPrayer.fajr).toBe(4);
    expect(afterReopen.perPrayer.dhuhr).toBe(10); // unchanged from initial auto-arm
  });

  authTest('different minutes for different prayers (Fajr 7 / Dhuhr 5 / Asr 10 / Jummah 15)', async () => {
    await setFaisalAsDefault();
    await tap(page, '#next-bell');
    await waitVisible(page, '#reminder-panel');

    const set = async (prayer, value) => {
      const sel = `input[data-prayer-input="${prayer}"]`;
      await page.click(sel, { clickCount: 3 });
      await page.type(sel, String(value));
      await page.evaluate((s) => document.querySelector(s).dispatchEvent(new Event('change', { bubbles: true })), sel);
    };
    await set('fajr', 7);
    await set('dhuhr', 5);
    await set('asr', 10);
    await set('jummah', 15);

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('jamat_reminder_prefs') || '{}'));
    // Each typed prayer reflects the user's value
    expect(stored.perPrayer.fajr).toBe(7);
    expect(stored.perPrayer.dhuhr).toBe(5);
    expect(stored.perPrayer.asr).toBe(10);
    expect(stored.perPrayer.jummah).toBe(15);
    // Per the auto-arm spec (commit 10c72ef), Maghrib + Isha stay at the
    // 10min default the bell-tap installed, NOT null. The user's untouched
    // means "I haven't set this myself," which now means "use the default."
    expect(stored.perPrayer.maghrib).toBe(10);
    expect(stored.perPrayer.isha).toBe(10);
  });

  authTest('"Turn all off" disables every prayer + flips the bell back', async () => {
    await setFaisalAsDefault();
    await tap(page, '#next-bell');
    // Set one prayer first
    await page.click('input[data-prayer-input="fajr"]', { clickCount: 3 });
    await page.type('input[data-prayer-input="fajr"]', '10');
    await page.evaluate(() => document.querySelector('input[data-prayer-input="fajr"]').dispatchEvent(new Event('change', { bubbles: true })));
    await tap(page, '#reminder-save');
    await page.waitForFunction(
      () => document.querySelector('#next-bell')?.getAttribute('aria-pressed') === 'true'
    );

    await tap(page, '#reminder-off');
    await page.waitForFunction(
      () => document.querySelector('#next-bell')?.getAttribute('aria-pressed') === 'false'
    );
    expect(await textOf(page, '#next-bell-label')).toBe('Remind me');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('jamat_reminder_prefs') || '{}'));
    expect(stored.enabled).toBe(false);
    // Every per-prayer toggle is off (so nothing fires) — but minutes are
    // intentionally PRESERVED so toggling back on restores the user's settings.
    expect(Object.values(stored.prayerEnabled || {}).every(v => v === false)).toBe(true);
    expect(stored.perPrayer.fajr).toBe(10); // value preserved
  });

  authTest('per-prayer toggle disables a prayer without losing its minutes value', async () => {
    await setFaisalAsDefault();
    await tap(page, '#next-bell');
    // Set Fajr to 7
    await page.click('input[data-prayer-input="fajr"]', { clickCount: 3 });
    await page.type('input[data-prayer-input="fajr"]', '7');
    await page.evaluate(() => document.querySelector('input[data-prayer-input="fajr"]').dispatchEvent(new Event('change', { bubbles: true })));

    // Now toggle it off
    const toggleSel = '[data-prayer-toggle="fajr"]';
    await page.waitForSelector(toggleSel, { visible: true });
    expect(await page.$eval(toggleSel, el => el.getAttribute('aria-checked'))).toBe('true');
    await page.click(toggleSel);
    await page.waitForFunction(
      sel => document.querySelector(sel)?.getAttribute('aria-checked') === 'false',
      {}, toggleSel
    );

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('jamat_reminder_prefs') || '{}'));
    expect(stored.prayerEnabled.fajr).toBe(false);
    expect(stored.perPrayer.fajr).toBe(7); // value still preserved
  });
});
