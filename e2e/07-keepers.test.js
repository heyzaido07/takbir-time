const {
  BASE_URL, launch, openMobilePage, closePage,
  isVisible, textOf,
  waitVisible, tap, signIn, waitForDirectoryCards,
} = require('./helpers');

describe('Time keepers', () => {
  let browser, page;
  const isProductionBase = /^https:\/\/(www\.)?takbeertime\.com\b/.test(BASE_URL);
  const authTest = isProductionBase ? test.skip : test;

  beforeAll(async () => { browser = await launch(); });
  afterAll(async () => { await browser.close(); });
  beforeEach(async () => {
    page = await openMobilePage(browser);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await waitForDirectoryCards(page);
  });
  afterEach(async () => { await closePage(page); });

  // We need a mosque that has at least one keeper. The seeded "Mujaddiya
  // Masjid" has a real submission from junaid.qazi.veemed@gmail.com; we
  // open it via its known ID through the same hash-routing the app uses.
  const MUJADDIYA_ID = '9e81a260-7f28-4b2a-9e8f-1613e45a85ed';
  async function openMujaddiya() {
    await page.goto(`${BASE_URL}/#mosque/${MUJADDIYA_ID}`, { waitUntil: 'domcontentloaded' });
    await waitVisible(page, '#drawer[aria-hidden="false"]');
  }

  // The drawer uses a two-screen layout: keepers live on a second screen
  // (#keepers-section) that opens from the keeper credit line, and the
  // list renders .keeper-card items (components.js renderKeeper).
  async function openKeeperScreen() {
    await openMujaddiya();
    await waitVisible(page, '#keeper-credit');
    await tap(page, '#keeper-credit');
    await page.waitForFunction(
      () => document.getElementById('drawer')?.classList.contains('is-keeper-screen'),
      { timeout: 5_000 }
    );
    await waitVisible(page, '#keepers-list .keeper-card');
  }

  test('keeper screen opens from the keeper credit with at least one keeper', async () => {
    await openKeeperScreen();
    const count = await page.$$eval('#keepers-list .keeper-card', els => els.length);
    expect(count).toBeGreaterThan(0);
  });

  test('the top keeper card carries name, star rating, followers, and a follow button', async () => {
    await openKeeperScreen();
    const data = await page.$eval('#keepers-list .keeper-card:first-child', el => ({
      name: el.querySelector('.keeper-card__name')?.textContent?.trim(),
      rating: el.querySelector('.keeper-card__rating')?.textContent?.trim(),
      meta: el.querySelector('.keeper-card__meta')?.textContent?.trim(),
      hasFollowBtn: !!el.querySelector('.keeper-card__primary'),
    }));
    expect(data.name?.length).toBeGreaterThan(0);
    expect(data.rating).toMatch(/★\s*\d(\.\d)?/);
    expect(data.meta).toMatch(/follower/i);
    expect(data.hasFollowBtn).toBe(true);
  });

  test('keeper screen explains the default keeper rule', async () => {
    await openKeeperScreen();
    const copy = await textOf(page, '.keepers-banner');
    expect(copy).toContain('highest-rated keeper');
    expect(copy).toContain('by default');
  });

  test('keeper card shows labelled times for all six prayers', async () => {
    await openKeeperScreen();
    const labels = await page.$$eval(
      '#keepers-list .keeper-card:first-child .keeper-card__time span:first-child',
      els => els.map(el => el.textContent?.trim())
    );
    expect(labels).toEqual(['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha', 'Jummah']);
    const values = await page.$$eval(
      '#keepers-list .keeper-card:first-child .keeper-card__time strong',
      els => els.map(el => el.textContent?.trim()).filter(Boolean)
    );
    expect(values).toHaveLength(6);
  });

  test('keeper cards render vote buttons only as matched up/down pairs', async () => {
    await openKeeperScreen();
    const cards = await page.$$eval('#keepers-list .keeper-card', els => els.map(el => ({
      up: el.querySelectorAll('.keeper-card__vote--up').length,
      down: el.querySelectorAll('.keeper-card__vote--down').length,
    })));
    expect(cards.length).toBeGreaterThan(0);
    for (const counts of cards) {
      expect(counts.up).toBe(counts.down);
      expect([0, 1]).toContain(counts.up);
    }
  });

  test('"Times by [name]" credit appears above the times table', async () => {
    await openMujaddiya();
    await waitVisible(page, '#keeper-credit');
    const credit = await textOf(page, '#keeper-credit');
    expect(credit).toMatch(/Times by/);
  });

  authTest('choosing a non-default keeper marks their timings as in use', async () => {
    // Sign in so PUT /preferred-keeper has identity
    await signIn(page);
    await openKeeperScreen();

    // Click the first keeper's follow button
    const firstFollow = await page.$('#keepers-list .keeper-card:first-child .keeper-card__primary');
    await firstFollow.evaluate(b => b.click());

    // After following, the card gets the .is-effective class
    await page.waitForFunction(
      () => document.querySelector('#keepers-list .keeper-card:first-child')?.getAttribute('aria-current') === 'true',
      { timeout: 5_000 }
    );

    // The action button now explains the active state instead of saying "Following".
    const text = await textOf(page, '#keepers-list .keeper-card:first-child .keeper-card__primary');
    expect(text).toMatch(/Stop using this time keeper's timings/);
  });

  authTest('keeper credit on the drawer reflects the followed keeper', async () => {
    // Capture all PUT/GET to /preferred-keeper or /mosques/:id while the
    // test runs so we can see what actually went over the wire.
    const wire = [];
    page.on('response', async resp => {
      const u = resp.url();
      if (/preferred-keeper|\/api\/mosques\/[a-f0-9-]+(?:\?|$)/.test(u)) {
        const text = await resp.text().catch(() => '');
        wire.push({ method: resp.request().method(), url: u, status: resp.status(), body: text.slice(0, 200) });
      }
    });

    await signIn(page);
    await openKeeperScreen();

    const keeperName = await textOf(page, '#keepers-list .keeper-card:first-child .keeper-card__name');
    const followBtn = await page.$('#keepers-list .keeper-card:first-child .keeper-card__primary');
    await followBtn.evaluate(b => b.click());

    // Wait for the re-fetch to land. The credit hint flips to the explicit
    // "using this keeper's timings" copy once the new GET completes.
    await page.waitForFunction(
      () => /using this time keeper's timings/i.test(document.querySelector('#keeper-credit')?.textContent ?? ''),
      { timeout: 5_000 }
    ).catch(() => {});

    const credit = await textOf(page, '#keeper-credit');
    if (!/using this time keeper's timings/i.test(credit)) {
      console.log('=== WIRE TRACE ===');
      wire.forEach(w => console.log(`  ${w.method} ${w.status} ${w.url}\n    ${w.body}`));
    }
    expect(credit).toContain(keeperName);
    expect(credit).toMatch(/Using this time keeper's timings/i);
  });
});
