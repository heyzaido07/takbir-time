const {
  BASE_URL, authTest, launch, openMobilePage, closePage,
  isVisible, textOf, attrOf, signIn, waitForDirectoryCards,
} = require('./helpers');

describe('Home page', () => {
  let browser, page;

  beforeAll(async () => { browser = await launch(); });
  afterAll(async () => { await browser.close(); });
  beforeEach(async () => { page = await openMobilePage(browser); });
  afterEach(async () => { await closePage(page); });

  test('renders the Takbeer Time brand and headline', async () => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

    const title = await page.title();
    expect(title).toMatch(/Takbeer Time/);

    expect(await textOf(page, '.brand__name')).toBe('Takbeer Time');

    const headline = await textOf(page, '#hero-headline');
    expect(headline).toContain('Never miss the first');
    expect(await textOf(page, '#hero-headline em')).toBe('takbeer');
  });

  test('shows the sadqa pledge in the footer', async () => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    expect(await textOf(page, '.foot__pledge')).toContain('No ads. Ever.');
    expect(await textOf(page, '.foot__pledge [lang="ar"]')).toContain('صدقة في سبيل الله');
  });

  test('"Recently added" section is no longer on the home page', async () => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    // The removed feature was the HOME page strip. The detail drawer's
    // "Recent submissions" block legitimately reuses the #recent-section
    // id, so only matches outside the drawer count as a regression.
    const present = await page.evaluate(() =>
      [...document.querySelectorAll('#recent-section, #recent-strip')]
        .some(el => !el.closest('#drawer'))
    );
    expect(present).toBe(false);
  });

  test('populates the directory', async () => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await waitForDirectoryCards(page);
    const cards = await page.$$('#list-nearby > .card');
    expect(cards.length).toBeGreaterThan(0);
    expect(await isVisible(page, '#list-nearby > .card .card__name')).toBe(true);
  });

  authTest('login button shows "Sign in" until signed in', async () => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    expect(await textOf(page, '#auth-btn .auth-btn__label')).toBe('Sign in');

    const email = await signIn(page);
    const localPart = email.split('@')[0];
    expect(await textOf(page, '#auth-btn .auth-btn__label')).toBe(localPart);
    expect(await attrOf(page, '#auth-btn', 'data-state')).toBe('signed-in');
  });
});
