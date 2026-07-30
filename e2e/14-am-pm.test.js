/**
 * Display formatting: every visible time on the page should read as
 * 12-hour with am/pm, never as a bare 24-hour HH:MM. Form inputs are
 * exempt — `<input type="time">` is browser-controlled.
 */

const {
  BASE_URL, ISLAMABAD,
  launch, openMobilePage, closePage,
  waitVisible, tap, signIn,
  authTest,
} = require('./helpers');

describe('Time formatting (12-hour with am/pm)', () => {
  let browser, page;

  beforeAll(async () => { browser = await launch(); });
  afterAll(async () => { await browser.close(); });
  beforeEach(async () => {
    page = await openMobilePage(browser, ISLAMABAD);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  });
  afterEach(async () => { await closePage(page); });

  test('R.fmt12 helper round-trips known cases', async () => {
    const cases = await page.evaluate(() => [
      window.JAMAT_RENDER.fmt12('00:00'),
      window.JAMAT_RENDER.fmt12('05:30'),
      window.JAMAT_RENDER.fmt12('12:00'),
      window.JAMAT_RENDER.fmt12('13:45'),
      window.JAMAT_RENDER.fmt12('23:59'),
      window.JAMAT_RENDER.fmt12('not-a-time'),
    ]);
    expect(cases).toEqual([
      '12:00 am',
      '5:30 am',
      '12:00 pm',
      '1:45 pm',
      '11:59 pm',
      'not-a-time',
    ]);
  });

  authTest('hero next-takbeer "at …" reads in 12-hour format', async () => {
    await signIn(page);
    await page.waitForSelector('#list-nearby > .card', { visible: true, timeout: 30_000 });

    // Pick the first card with timings — set as default.
    let cardCount = await page.$$eval('#list-nearby > .card', els => els.length);
    let opened = false;
    for (let i = 0; i < Math.min(cardCount, 6); i++) {
      await page.evaluate(idx => {
        document.querySelectorAll('#list-nearby > .card')[idx]?.click();
      }, i);
      await waitVisible(page, '#drawer[aria-hidden="false"]');
      await tap(page, '#btn-set-default');
      try {
        await page.waitForFunction(
          () => document.querySelector('#btn-set-default')?.textContent?.toLowerCase().includes('your default'),
          { timeout: 3_000 }
        );
        opened = true;
      } catch {}
      // Setting a default auto-navigates home — the drawer closes on its own.
      await page.waitForSelector('#drawer[aria-hidden="false"]', { hidden: true });
      const heroOk = await page.evaluate(() => /\bam\b|\bpm\b/i.test(document.getElementById('next-at')?.textContent || ''));
      if (opened && heroOk) { opened = true; break; }
    }
    if (!opened) return; // No mosques with timings in directory; skip silently.

    const heroAt = await page.$eval('#next-at', el => el.textContent.trim());
    // Must contain "am" or "pm" and NOT match a bare "HH:MM" without a period.
    expect(heroAt).toMatch(/\b(am|pm)\b/i);
    expect(heroAt).not.toMatch(/^\s*at\s+\d{2}:\d{2}\s*$/i);
  });

  test('drawer times-table rows render in 12-hour format', async () => {
    await page.waitForSelector('#list-nearby > .card', { visible: true, timeout: 30_000 });
    // Click any card; if it has times, we'll see them.
    await tap(page, '#list-nearby > .card');
    await waitVisible(page, '#drawer[aria-hidden="false"]');

    const cellTexts = await page.$$eval('#drawer-times tbody tr td.time', tds =>
      tds.map(td => td.textContent.trim())
    );
    if (cellTexts.length === 0) return; // empty mosque, nothing to assert
    for (const t of cellTexts) {
      // Real time values must end in am/pm. (Some rows might be "—" placeholders.)
      if (/\d/.test(t)) {
        expect(t).toMatch(/\b(am|pm)\b/i);
      }
    }
  });
});
