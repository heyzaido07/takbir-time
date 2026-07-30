/**
 * Public API documentation page (/api-docs.html).
 *  - Loads with all the major resource sections present
 *  - Method badges + auth pills render
 *  - Footer link from the home page reaches it
 */

const {
  BASE_URL, launch, openMobilePage, closePage,
  waitVisible,
} = require('./helpers');

describe('API documentation page', () => {
  let browser, page;

  beforeAll(async () => { browser = await launch(); });
  afterAll(async () => { await browser.close(); });
  beforeEach(async () => { page = await openMobilePage(browser); });
  afterEach(async () => { await closePage(page); });

  test('renders intro + every resource section', async () => {
    await page.goto(`${BASE_URL}/api-docs.html`, { waitUntil: 'domcontentloaded' });
    await waitVisible(page, '.docs-main h1');

    // The five resource families must each have a level-2 heading. Use a
    // case-insensitive match so a future translation pass doesn't break.
    const headings = await page.$$eval('.docs-main h2', els => els.map(e => e.textContent.trim().toLowerCase()));
    for (const need of ['authentication', 'rate limits', 'masjids', 'submissions', 'suggestions', 'users', 'schedules']) {
      expect(headings.some(h => h.includes(need))).toBe(true);
    }
  });

  test('every endpoint card has a method badge + a path', async () => {
    await page.goto(`${BASE_URL}/api-docs.html`, { waitUntil: 'domcontentloaded' });
    await waitVisible(page, '.endpoint');

    const cards = await page.$$eval('.endpoint', endpoints => endpoints.map(e => ({
      method: e.querySelector('.method')?.textContent?.trim(),
      path:   e.querySelector('.path')?.textContent?.trim(),
    })));
    expect(cards.length).toBeGreaterThanOrEqual(20); // we document a lot
    for (const c of cards) {
      expect(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).toContain(c.method);
      expect(c.path).toMatch(/^\/[a-z]/);
    }
  });

  test('home page footer links to the docs', async () => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    const apiLink = await page.$eval('.foot__links a[href*="api-docs"]', el => el.getAttribute('href'));
    expect(apiLink).toMatch(/api-docs\.html$/);
  });
});
