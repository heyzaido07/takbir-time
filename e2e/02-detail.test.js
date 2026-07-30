const {
  BASE_URL, launch, openMobilePage, closePage,
  isVisible, textOf, exists,
  waitVisible, waitHidden, tap, signIn, waitForDirectoryCards,
  authTest,
} = require('./helpers');

// Create a fresh mosque via the API so empty-state tests don't depend on
// directory ordering (the "first card" used to be a no-schedule OSM import,
// but the directory now mixes seeded + OSM and order isn't guaranteed).
async function createEmptyMosque(page) {
  await signIn(page);
  const id = await page.evaluate(async () => {
    const email = localStorage.getItem('jamat_dev_email');
    const r = await fetch(`${window.JAMAT_CONFIG.apiBase}/mosques`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Dev-User-Email': email },
      body: JSON.stringify({
        name: `Empty-State E2E ${Date.now()}`,
        latitude: 0.3, longitude: 0.3, city: 'TestCity', country: 'TestCountry',
      }),
    });
    const m = await r.json();
    return m.id;
  });
  return id;
}

describe('Mosque detail drawer', () => {
  let browser, page;

  beforeAll(async () => { browser = await launch(); });
  afterAll(async () => { await browser.close(); });
  beforeEach(async () => {
    page = await openMobilePage(browser);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await waitForDirectoryCards(page);
  });
  afterEach(async () => { await closePage(page); });

  test('opens when a directory card is tapped', async () => {
    const name = await textOf(page, '#list-nearby > .card .card__name');
    await tap(page, '#list-nearby > .card');
    await waitVisible(page, '#drawer[aria-hidden="false"]');
    expect(await textOf(page, '#drawer-title')).toBe(name);
  });

  test('opening a mosque pushes the URL hash for back-button support', async () => {
    await tap(page, '#list-nearby > .card');
    await waitVisible(page, '#drawer[aria-hidden="false"]');
    expect(page.url()).toContain('#mosque/');
  });

  test('back button closes the drawer instead of leaving the site', async () => {
    await tap(page, '#list-nearby > .card');
    await waitVisible(page, '#drawer[aria-hidden="false"]');
    await page.goBack();
    await waitHidden(page, '#drawer[aria-hidden="false"]');
    expect(page.url()).not.toContain('#mosque/');
    // still on the site
    expect(await textOf(page, '.brand__name')).toBe('Takbeer Time');
  });

  test('drawer X button closes the drawer', async () => {
    await tap(page, '#list-nearby > .card');
    await waitVisible(page, '#drawer[aria-hidden="false"]');
    await tap(page, '.drawer__close');
    await waitHidden(page, '#drawer[aria-hidden="false"]');
    expect(page.url()).not.toContain('#mosque/');
  });

  authTest('OSM-imported mosque (no schedule) shows the empty-state CTA', async () => {
    const id = await createEmptyMosque(page);
    await page.goto(`${BASE_URL}/#mosque/${id}`, { waitUntil: 'domcontentloaded' });
    await waitVisible(page, '#drawer[aria-hidden="false"]');

    expect(await isVisible(page, '#times-empty')).toBe(true);
    expect(await isVisible(page, '#btn-submit-from-empty')).toBe(true);
    expect(await textOf(page, '#btn-submit-from-empty')).toContain('Be the first');
  });

  authTest('clicking "Be the first" opens the submit form, focused', async () => {
    const id = await createEmptyMosque(page);
    await page.goto(`${BASE_URL}/#mosque/${id}`, { waitUntil: 'domcontentloaded' });
    await waitVisible(page, '#times-empty');
    await tap(page, '#btn-submit-from-empty');
    await waitVisible(page, '#submit-form');

    // form should be visible AND fajr input focused. The handler defers
    // focus by 280ms (after the smooth-scroll animation), so wait for it.
    await page.waitForFunction(
      () => document.activeElement?.getAttribute('name') === 'fajr',
      { timeout: 5_000 }
    );
  });

  test('seeded mosque with schedule shows the times table, not the empty state', async () => {
    // Find Faisal Mosque (hand-seeded with verified schedule, sorted near top).
    const opened = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('#list-nearby > .card'));
      const faisal = cards.find(c => c.querySelector('.card__name')?.textContent?.includes('Faisal Mosque'));
      if (faisal) { faisal.click(); return true; }
      return false;
    });
    expect(opened).toBe(true);
    await waitVisible(page, '#drawer[aria-hidden="false"]');
    expect(await isVisible(page, '#times-empty')).toBe(false);
    const rowCount = await page.$$eval('#drawer-times tbody tr', rs => rs.length);
    expect(rowCount).toBeGreaterThan(0);
  });
});
