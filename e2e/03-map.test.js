const {
  BASE_URL, ISLAMABAD,
  launch, openMobilePage, closePage,
  isVisible, exists,
  waitVisible, waitHidden, tap,
} = require('./helpers');

describe('Map view + find mosques near me', () => {
  let browser, page;

  beforeAll(async () => { browser = await launch(); });
  afterAll(async () => { await browser.close(); });
  beforeEach(async () => {
    page = await openMobilePage(browser, ISLAMABAD);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  });
  afterEach(async () => { await closePage(page); });

  test('"Find mosques near me" opens the map view and drops the user pin', async () => {
    await tap(page, '#btn-locate');
    await waitVisible(page, '#mapview[aria-hidden="false"]');
    // The user pin appears only after geolocation resolves and populateMap runs.
    await page.waitForSelector('.jamat-pin--user', { visible: true, timeout: 15_000 });
  });

  test('mosque pins are dropped into the map', async () => {
    await tap(page, '#btn-locate');
    await waitVisible(page, '#mapview[aria-hidden="false"]');
    // wait for pins
    await page.waitForSelector('.jamat-pin', { visible: true, timeout: 15_000 });
    const pinCount = await page.$$eval('.jamat-pin', pins => pins.length);
    // user pin + at least one mosque pin (Pakistan has thousands)
    expect(pinCount).toBeGreaterThan(1);
  });

  test('opening the map via #map hash works without geolocation', async () => {
    // The standalone "Open map" button (#btn-toggle-map) was removed when
    // the home-screen UX collapsed to a single "Find masjids near me" CTA.
    // The hash-based map open path (#mosque/... and #map) is still the
    // canonical entry point — exercise it directly so this no-geo path
    // stays covered.
    await page.evaluate(() => { location.hash = 'map'; });
    await waitVisible(page, '#mapview[aria-hidden="false"]');
    // Map opens; user pin won't appear without geolocation flow
    // Just confirm the leaflet container rendered
    await page.waitForSelector('.leaflet-container', { visible: true, timeout: 10_000 });
  });

  test('back button closes the map (does NOT leave the site)', async () => {
    await tap(page, '#btn-locate');
    await waitVisible(page, '#mapview[aria-hidden="false"]');
    await page.goBack();
    await waitHidden(page, '#mapview[aria-hidden="false"]');
    // Still on home
    expect(await isVisible(page, '#hero-headline')).toBe(true);
  });

  test('X button closes the map', async () => {
    await page.evaluate(() => { location.hash = 'map'; });
    await waitVisible(page, '#mapview[aria-hidden="false"]');
    await tap(page, '#map-close');
    await waitHidden(page, '#mapview[aria-hidden="false"]');
  });

  test('clicking a mosque pin opens its drawer (without leaving the map)', async () => {
    await tap(page, '#btn-locate');
    await waitVisible(page, '#mapview[aria-hidden="false"]');
    await page.waitForSelector('.jamat-pin:not(.jamat-pin--user)', { visible: true, timeout: 15_000 });

    // Click the first non-user pin (its parent is a leaflet-marker-icon)
    await page.evaluate(() => {
      const pin = document.querySelector('.jamat-pin:not(.jamat-pin--user)');
      const marker = pin?.closest('.leaflet-marker-icon');
      marker?.click();
    });
    await page.waitForSelector('.leaflet-popup-content', { visible: true, timeout: 5_000 });
    // The popup has a "data-open" link to open detail
    await page.evaluate(() => document.querySelector('.leaflet-popup-content [data-open]')?.click());
    await waitVisible(page, '#drawer[aria-hidden="false"]');
    expect(page.url()).toContain('#mosque/');
  });
});
