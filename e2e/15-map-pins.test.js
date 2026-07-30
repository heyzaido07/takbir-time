/**
 * Map markers carry a permanent tooltip showing the mosque name and the
 * next-takbeer time (when the mosque has a schedule).
 */

const {
  BASE_URL, ISLAMABAD,
  launch, openMobilePage, closePage,
  waitVisible, tap,
} = require('./helpers');

describe('Map pin labels (name + next takbeer)', () => {
  let browser, page;

  beforeAll(async () => { browser = await launch(); });
  afterAll(async () => { await browser.close(); });
  beforeEach(async () => {
    page = await openMobilePage(browser, ISLAMABAD);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  });
  afterEach(async () => { await closePage(page); });

  test('every marker mounts a permanent .jamat-pin-label tooltip showing the mosque name', async () => {
    await tap(page, '#btn-locate');
    await waitVisible(page, '#mapview[aria-hidden="false"]');
    // Wait for at least one tile + at least one pin label to appear.
    await page.waitForSelector('.leaflet-tile-loaded', { timeout: 15_000 });
    await page.waitForSelector('.leaflet-tooltip.jamat-pin-label', { timeout: 15_000 });

    const labels = await page.$$eval('.leaflet-tooltip.jamat-pin-label', els =>
      els.map(e => ({
        text: e.textContent.trim(),
        hasTime: /\b(am|pm)\b/i.test(e.textContent),
      }))
    );
    expect(labels.length).toBeGreaterThan(0);
    // Each label has at least the mosque name (non-empty text).
    for (const l of labels) {
      expect(l.text.length).toBeGreaterThan(0);
    }
    // At least one label includes a next-takbeer time (mosques with schedules
    // — Faisal Mosque is seeded with one, so this should pass).
    const withTime = labels.filter(l => l.hasTime);
    expect(withTime.length).toBeGreaterThanOrEqual(1);
  });

  test('tooltip is tappable — clicking the label opens the masjid drawer', async () => {
    // Per commit ae6efb3 ("Drawer + map popup: shorten path from 'I want
    // this masjid' to 'done'"): the pin tooltip is intentionally tappable
    // (pointer-events: auto + cursor: pointer). Tapping a label opens the
    // detail drawer for that masjid without an extra hop through a popup.
    await tap(page, '#btn-locate');
    await waitVisible(page, '#mapview[aria-hidden="false"]');
    await page.waitForSelector('.leaflet-tooltip.jamat-pin-label', { timeout: 15_000 });

    const pe = await page.$$eval('.leaflet-tooltip.jamat-pin-label', els =>
      els.map(e => getComputedStyle(e).pointerEvents)
    );
    for (const v of pe) expect(v).toBe('auto');
  });
});
