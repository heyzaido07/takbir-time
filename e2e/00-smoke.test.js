const {
  BASE_URL, launch, openMobilePage, closePage,
  isVisible, textOf, waitVisible, tap, waitForDirectoryCards,
} = require('./helpers');

describe('Non-mutating production smoke', () => {
  let browser, page;

  beforeAll(async () => { browser = await launch(); });
  afterAll(async () => { await browser.close(); });
  beforeEach(async () => { page = await openMobilePage(browser); });
  afterEach(async () => { await closePage(page); });

  test('home, directory, drawer, and language switch are functional', async () => {
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('takbeer_keeper_intro_seen_v2', 'true');
    });
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

    expect(await textOf(page, '.brand__name')).toBe('Takbeer Time');
    expect(await textOf(page, '#hero-headline')).toContain('Never miss the first');

    await waitForDirectoryCards(page);
    expect(await isVisible(page, '#list-nearby > .card .card__name')).toBe(true);

    const cardName = await textOf(page, '#list-nearby > .card .card__name');
    await tap(page, '#list-nearby > .card');
    await waitVisible(page, '#drawer[aria-hidden="false"]');
    expect(await textOf(page, '#drawer-title')).toBe(cardName);

    await tap(page, '.drawer__close');
    await page.waitForSelector('#drawer[aria-hidden="false"]', { hidden: true });

    await tap(page, '#lang-trigger');
    await waitVisible(page, '#lang-pop');
    await tap(page, '#lang-option-ur');
    await page.waitForFunction(() => document.documentElement.dir === 'rtl');
    expect(await textOf(page, '#hero-headline')).toContain('تکبیر');
  });
});
