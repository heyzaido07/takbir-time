/**
 * E2E for the "All takbeer times" panel on the hero card.
 *   - Hidden until a default mosque with timings is picked
 *   - Timings render inline without a disclosure toggle
 *   - List shows multiple prayer rows (label + HH:MM)
 *   - The next prayer is marked .is-next
 */

const {
  BASE_URL, launch, openMobilePage, closePage,
  isVisible, textOf, waitVisible, tap, signIn,
  authTest,
} = require('./helpers');

describe('All takbeer times panel', () => {
  let browser, page;

  beforeAll(async () => { browser = await launch(); });
  afterAll(async () => { await browser.close(); });
  beforeEach(async () => {
    page = await openMobilePage(browser);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  });
  afterEach(async () => { await closePage(page); });

  // Wait for the directory to populate. Lifted from helpers but with a longer
  // window because the backend may be under load (OSM bulk import contention).
  async function waitForCards() {
    await page.waitForSelector('#list-nearby > .card', { visible: true, timeout: 30_000 });
  }

  // Pick the first mosque that the directory says has timings, set it as default.
  // This guarantees the hero will hydrate timings, which is what gates the dropdown.
  async function pickAnyDefaultWithTimings() {
    await waitForCards();
    await signIn(page);
    // Open the first card; if it has no times the dropdown stays hidden,
    // so we'll fall back to the next one.
    const cards = await page.$$('#list-nearby > .card');
    expect(cards.length).toBeGreaterThan(0);

    for (let i = 0; i < Math.min(cards.length, 6); i++) {
      await page.evaluate(idx => {
        const c = document.querySelectorAll('#list-nearby > .card')[idx];
        c?.click();
      }, i);
      await waitVisible(page, '#drawer[aria-hidden="false"]');

      // Try to set as default. If it works and timings hydrate, we're done.
      await tap(page, '#btn-set-default');
      try {
        await page.waitForFunction(
          () => document.querySelector('#btn-set-default')?.textContent?.toLowerCase().includes('default'),
          { timeout: 3_000 }
        );
      } catch { /* button copy didn't flip — keep going */ }

      // Setting a default auto-navigates home — the drawer closes on its own.
      await page.waitForSelector('#drawer[aria-hidden="false"]', { hidden: true });

      // Has the hero hydrated with timings (clock visible)?
      const hasTimings = await isVisible(page, '#next-clock');
      if (hasTimings) return;
    }
    throw new Error('Could not find any directory mosque with active timings to use as default');
  }

  test('dropdown is hidden when no default mosque is selected', async () => {
    // No sign-in, no default. The hero card has rendered (visible) but the
    // all-times wrap stays [hidden] because there's no mosque to draw from.
    await waitVisible(page, '#next-card');
    expect(await isVisible(page, '#next-all-wrap')).toBe(false);
  });

  authTest('dropdown appears after picking a default with timings', async () => {
    await pickAnyDefaultWithTimings();
    await waitVisible(page, '#next-all-wrap');
    expect(await isVisible(page, '#next-all-wrap')).toBe(true);

    // The handoff changed this from a collapsed dropdown to an inline panel.
    expect(await page.$('#next-all-toggle')).toBeNull();
    expect(await isVisible(page, '#next-all-list')).toBe(true);
    expect(await textOf(page, '#next-all-count')).toMatch(/\d+\s+\w+/);
  });

  authTest('the inline panel renders prayer rows', async () => {
    await pickAnyDefaultWithTimings();
    await waitVisible(page, '#next-all-list');

    // At least 4 daily prayers should render (mosque might lack maghrib offset, but Fajr/Dhuhr/Asr/Isha at minimum).
    const rows = await page.$$('#next-all-list .next-card__all-row');
    expect(rows.length).toBeGreaterThanOrEqual(4);

    // Each row has prayer name, jamat, and sun-window start/end cells.
    const cells = await page.$$eval('#next-all-list .next-card__all-row', rows =>
      rows.map(r => ({
        name: r.querySelector('.next-card__all-name')?.textContent?.trim() || '',
        jamat: r.querySelector('.next-card__jamat')?.textContent?.trim() || '',
        starts: r.querySelector('.next-card__sun--starts')?.textContent?.trim() || '',
        ends: r.querySelector('.next-card__sun--ends')?.textContent?.trim() || '',
      }))
    );
    for (const { name, jamat, starts, ends } of cells) {
      expect(name.length).toBeGreaterThan(0);
      expect(jamat).toMatch(/^\d{1,2}:\d{2}\s+(am|pm)$/i);
      expect(starts).toMatch(/^(\d{1,2}:\d{2}\s+(am|pm)|—)$/i);
      expect(ends).toMatch(/^(\d{1,2}:\d{2}\s+(am|pm)|—)$/i);
    }
  });

  authTest('the next-prayer row gets the .is-next highlight', async () => {
    await pickAnyDefaultWithTimings();
    await waitVisible(page, '#next-all-list');

    // Exactly one .is-next row at any time (or zero, if "no upcoming today" — but the dropdown wraps to tomorrow, so we expect 1).
    const nextCount = await page.$$eval('#next-all-list .next-card__all-row.is-next', els => els.length);
    expect(nextCount).toBe(1);

    // The .is-next row name should match the hero's "next prayer" label.
    const heroNext = await page.$eval('#next-prayer', el => el.textContent.trim());
    const dropdownNext = await page.$eval('#next-all-list .is-next .next-card__all-name', el =>
      Array.from(el.childNodes).find(n => n.nodeType === Node.TEXT_NODE)?.textContent.trim() || el.textContent.trim()
    );
    expect(dropdownNext).toBe(heroNext);
  });
});
