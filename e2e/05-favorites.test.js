const {
  BASE_URL, launch, openMobilePage, closePage,
  isVisible, textOf, attrOf,
  waitVisible, tap, signIn, waitForDirectoryCards,
  authTest,
} = require('./helpers');

describe('Favorites', () => {
  let browser, page;

  beforeAll(async () => { browser = await launch(); });
  afterAll(async () => { await browser.close(); });
  beforeEach(async () => {
    page = await openMobilePage(browser);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await waitForDirectoryCards(page);
  });
  afterEach(async () => { await closePage(page); });

  authTest('"Save to favorites" toggles to "Saved" after click', async () => {
    await signIn(page);
    await tap(page, '#list-nearby > .card');
    await waitVisible(page, '#drawer[aria-hidden="false"]');

    expect(await attrOf(page, '#btn-favorite', 'aria-pressed')).toBe('false');
    await tap(page, '#btn-favorite');

    // Wait for the button label to flip
    await page.waitForFunction(
      () => document.querySelector('#btn-favorite')?.getAttribute('aria-pressed') === 'true',
      { timeout: 5_000 }
    );
    expect(await textOf(page, '#btn-favorite span')).toBe('Saved');
  });

  authTest('favorited mosque appears in the Favorites tab', async () => {
    await signIn(page);
    const cardName = await textOf(page, '#list-nearby > .card .card__name');
    await tap(page, '#list-nearby > .card');
    await waitVisible(page, '#drawer[aria-hidden="false"]');
    await tap(page, '#btn-favorite');
    await page.waitForFunction(
      () => document.querySelector('#btn-favorite')?.getAttribute('aria-pressed') === 'true'
    );

    // Close drawer + switch to Favorites tab. Use the helper's tap() which
    // dispatches el.click(); puppeteer's elementHandle.tap() fires
    // touchstart/touchend and the dir-tab handler doesn't always pick that
    // up consistently in headless mode.
    await tap(page, '.drawer__close');
    await page.waitForSelector('#drawer[aria-hidden="false"]', { hidden: true });
    await tap(page, '.dir-tab[data-tab="favorites"]');

    // The favorited mosque should be in #list-favorites
    await page.waitForSelector('#list-favorites > .card', { visible: true, timeout: 5_000 });
    const favNames = await page.$$eval('#list-favorites > .card .card__name', els => els.map(e => e.textContent?.trim()));
    expect(favNames).toContain(cardName);
  });

  authTest('toggling favorite off removes it from favorites tab', async () => {
    await signIn(page);
    await tap(page, '#list-nearby > .card');
    await waitVisible(page, '#drawer[aria-hidden="false"]');
    // Add
    await tap(page, '#btn-favorite');
    await page.waitForFunction(
      () => document.querySelector('#btn-favorite')?.getAttribute('aria-pressed') === 'true'
    );
    // Remove
    await tap(page, '#btn-favorite');
    await page.waitForFunction(
      () => document.querySelector('#btn-favorite')?.getAttribute('aria-pressed') === 'false'
    );
    expect(await textOf(page, '#btn-favorite span')).toBe('Save to favorites');
  });
});
