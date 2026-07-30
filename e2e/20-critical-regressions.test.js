const {
  BASE_URL, ISLAMABAD,
  launch, openMobilePage, closePage,
  isVisible, textOf, waitVisible, tap,
  describeLocal,
} = require('./helpers');
const fs = require('fs');
const path = require('path');

const MOSQUE_ID = '11111111-1111-4111-8111-111111111111';
const LOCAL_DEFAULT_ID = '99999999-9999-4999-8999-999999999999';
const KEEPER_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_KEEPER_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';

function json(body, status = 200) {
  return {
    status,
    contentType: 'application/json',
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Dev-User-Email',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, OPTIONS',
    },
    body: JSON.stringify(body),
  };
}

function makeFixtureMosque(overrides = {}) {
  const staleDate = new Date(Date.now() - 47 * 24 * 60 * 60 * 1000).toISOString();
  const timings = {
    fajr: '04:30',
    dhuhr: '13:30',
    asr: '17:30',
    maghribOffset: 3,
    isha: '21:00',
    jummah: ['13:30'],
  };
  return {
    id: MOSQUE_ID,
    name: 'Regression Fixture Masjid',
    latitude: ISLAMABAD.latitude,
    longitude: ISLAMABAD.longitude,
    coordinates: { lat: ISLAMABAD.latitude, lng: ISLAMABAD.longitude },
    city: 'Islamabad',
    country: 'Pakistan',
    addressLine1: 'Fixture Road',
    address: 'Fixture Road',
    verified: true,
    status: 'active',
    distanceKm: 1.2,
    viewCount: 0,
    favoriteCount: 0,
    amenities: ['parking', 'wudu_facilities', 'womens_section'],
    amenityRatings: {
      size: { avg: 4, count: 2 },
      wudu: { avg: 3.5, count: 2 },
    },
    defaultJamaatTimings: timings,
    effectiveTimings: timings,
    effectiveKeeperId: KEEPER_ID,
    effectiveKeeperName: 'Junaid Qazi',
    effectiveKeeperUpdatedAt: staleDate,
    preferredKeeperId: null,
    keepers: [
      {
        submitterId: KEEPER_ID,
        submitterName: 'Junaid Qazi',
        rating: 4.9,
        followerCount: 2,
        latestSubmissionId: '55555555-5555-4555-8555-555555555555',
        updatedAt: staleDate,
        timings,
      },
      {
        submitterId: OTHER_KEEPER_ID,
        submitterName: 'Junaid Ahmed',
        rating: 4.3,
        followerCount: 1,
        latestSubmissionId: '66666666-6666-4666-8666-666666666666',
        updatedAt: staleDate,
        timings: { ...timings, fajr: '04:40', dhuhr: '13:20' },
      },
    ],
    prayerSchedules: [{ id: 'schedule-1', timings, isActive: true, createdAt: staleDate }],
    ...overrides,
  };
}

async function mockApi(page, hooks = {}) {
  let mosque = makeFixtureMosque(hooks.mosque || {});
  const localDefaultMosque = makeFixtureMosque({
    id: LOCAL_DEFAULT_ID,
    name: 'Local Device Masjid',
    effectiveKeeperName: 'Local Keeper',
    ...(hooks.localDefaultMosque || {}),
  });
  const submissions = [];
  const qazaRows = [];
  const suggestions = [];
  const reviews = [];
  const preferredKeepers = [];

  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (/\/js\/config\.js$/.test(url.pathname)) {
      const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'config.js'), 'utf8')
        .replace(/apiKey:\s*'[^']*'/, "apiKey: ''");
      req.respond({
        status: 200,
        contentType: 'application/javascript',
        body: source,
      });
      return;
    }
    const isApi =
      (url.hostname === 'localhost' && url.port === '6001' && url.pathname.startsWith('/api')) ||
      ((url.hostname === 'takbeertime.com' || url.hostname === 'www.takbeertime.com') && url.pathname.startsWith('/api'));
    if (!isApi) {
      req.continue();
      return;
    }
    if (req.method() === 'OPTIONS') {
      req.respond(json({}, 204));
      return;
    }

    const apiPath = url.pathname.replace(/^\/api/, '');
    const body = () => JSON.parse(req.postData() || '{}');

    if (req.method() === 'GET' && apiPath === '/users/me') {
      req.respond(json({
        id: USER_ID,
        email: 'critical-e2e@jamat.local',
        fullName: 'Critical E2E',
        defaultMosqueId: hooks.userDefaultMosqueId === undefined ? null : hooks.userDefaultMosqueId,
        notificationPreferences: {},
      }));
      return;
    }
    if (req.method() === 'GET' && apiPath === '/users/me/favorites') {
      req.respond(json({ data: hooks.favorites === undefined ? [] : hooks.favorites }));
      return;
    }
    if (req.method() === 'PUT' && apiPath === '/users/me/default-mosque') {
      req.respond(json({ defaultMosqueId: body().mosqueId || null }));
      return;
    }
    if (req.method() === 'PUT' && apiPath === '/users/me/preferred-keeper') {
      const payload = body();
      preferredKeepers.push(payload);
      mosque = { ...mosque, preferredKeeperId: payload.keeperUserId, effectiveKeeperId: payload.keeperUserId || KEEPER_ID };
      req.respond(json({ preferredKeepers: { [payload.mosqueId]: payload.keeperUserId } }));
      return;
    }
    if (req.method() === 'GET' && apiPath === '/mosques/nearby') {
      req.respond(json({ data: [mosque], count: 1, radius: 5000, center: ISLAMABAD }));
      return;
    }
    if (req.method() === 'GET' && apiPath === '/mosques') {
      req.respond(json({
        data: hooks.listMosques === undefined ? [mosque] : hooks.listMosques,
        pagination: { page: 1, limit: 20, totalCount: 1, totalPages: 1, hasMore: false },
      }));
      return;
    }
    if (req.method() === 'GET' && apiPath === `/mosques/${MOSQUE_ID}`) {
      req.respond(json(mosque));
      return;
    }
    if (req.method() === 'GET' && apiPath === `/mosques/${LOCAL_DEFAULT_ID}`) {
      req.respond(json(localDefaultMosque));
      return;
    }
    if (req.method() === 'GET' && apiPath === `/mosques/${MOSQUE_ID}/keepers`) {
      req.respond(json({ keepers: mosque.keepers }));
      return;
    }
    if (req.method() === 'POST' && apiPath === '/submissions') {
      const payload = body();
      submissions.push(payload);
      req.respond(json({ id: `submission-${submissions.length}`, ...payload, status: 'active' }, 201));
      return;
    }
    if (req.method() === 'GET' && apiPath === '/submissions') {
      req.respond(json({ data: submissions, pagination: { page: 1, limit: 20, totalCount: submissions.length, totalPages: 1, hasMore: false } }));
      return;
    }
    if (req.method() === 'POST' && apiPath === '/suggestions') {
      const payload = body();
      suggestions.push(payload);
      req.respond(json({ id: `suggestion-${suggestions.length}`, ...payload }, 201));
      return;
    }
    if (req.method() === 'GET' && apiPath === '/suggestions/inbox') {
      req.respond(json({ suggestions: [] }));
      return;
    }
    if (req.method() === 'GET' && apiPath === '/qaza') {
      req.respond(json({ records: qazaRows }));
      return;
    }
    if (req.method() === 'POST' && apiPath === '/qaza') {
      const payload = { id: `77777777-7777-4777-8777-${String(qazaRows.length + 1).padStart(12, '0')}`, ...body() };
      qazaRows.push(payload);
      req.respond(json({ record: payload, created: true }, 201));
      return;
    }
    const qazaPrayed = apiPath.match(/^\/qaza\/([^/]+)\/prayed$/);
    if (req.method() === 'PATCH' && qazaPrayed) {
      const row = qazaRows.find(r => r.id === qazaPrayed[1]);
      if (row) row.prayedAt = body().prayedAt || new Date().toISOString();
      req.respond(json({ record: row || { id: qazaPrayed[1], prayedAt: body().prayedAt } }));
      return;
    }
    if (req.method() === 'POST' && apiPath === `/mosques/${MOSQUE_ID}/reviews`) {
      const payload = body();
      reviews.push(payload);
      req.respond(json({ id: `review-${reviews.length}`, ...payload }, 201));
      return;
    }

    req.respond(json({ error: `Unhandled mock route ${req.method()} ${apiPath}` }, 404));
  });

  await page.exposeFunction('__criticalE2EState', () => ({
    submissions,
    suggestions,
    reviews,
    qazaRows,
    preferredKeepers,
  }));
}

async function openFixtureDrawer(page) {
  await page.goto(`${BASE_URL}/#mosque/${MOSQUE_ID}`, { waitUntil: 'domcontentloaded' });
  await waitVisible(page, '#drawer[aria-hidden="false"]');
  await page.waitForFunction(() => document.querySelector('#drawer-title')?.textContent?.includes('Regression Fixture'));
  await disableFirebaseAuthGate(page);
}

async function seedSignedIn(page) {
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('jamat_dev_email', 'critical-e2e@jamat.local');
  });
}

async function disableFirebaseAuthGate(page) {
  await page.evaluate(() => {
    if (window.JAMAT_CONFIG) window.JAMAT_CONFIG.firebase = {};
  });
}

describeLocal('Critical feature regressions', () => {
  let browser, page;

  beforeAll(async () => { browser = await launch(); });
  afterAll(async () => { await browser.close(); });
  beforeEach(async () => {
    page = await openMobilePage(browser, ISLAMABAD);
    await seedSignedIn(page);
  });
  afterEach(async () => { await closePage(page); });

  test('drawer keeps the stale nudge directly below Jummah and the button is fully visible', async () => {
    await mockApi(page);
    await openFixtureDrawer(page);
    await waitVisible(page, '#stale-pill');

    const layout = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('#drawer-times tbody tr')).map(row => ({
        label: row.querySelector('th, td:first-child')?.textContent?.trim() || row.textContent.trim(),
        bottom: row.getBoundingClientRect().bottom,
      }));
      const jummah = rows.find(r => /jum/i.test(r.label));
      const stale = document.getElementById('stale-pill').getBoundingClientRect();
      const btn = document.getElementById('btn-open-nudge').getBoundingClientRect();
      const panel = document.querySelector('#drawer .drawer__panel').getBoundingClientRect();
      return {
        rowLabels: rows.map(r => r.label),
        staleBelowJummah: !!jummah && stale.top >= jummah.bottom - 1,
        buttonInsidePill: btn.left >= stale.left && btn.right <= stale.right && btn.top >= stale.top && btn.bottom <= stale.bottom,
        buttonInsideViewport: btn.right <= panel.right && btn.bottom <= panel.bottom,
      };
    });

    expect(layout.rowLabels.join(' ')).toMatch(/Jummah/i);
    expect(layout.staleBelowJummah).toBe(true);
    expect(layout.buttonInsidePill).toBe(true);
    expect(layout.buttonInsideViewport).toBe(true);
  });

  test('nudge sheet edits prayers in a popup and sends only the proposed diff', async () => {
    await mockApi(page);
    await openFixtureDrawer(page);
    await tap(page, '#btn-open-nudge');
    await waitVisible(page, '#nudge-sheet[aria-hidden="false"]');

    const labels = await page.$$eval('#nudge-prayer-list .nudge-row__name', els => els.map(el => el.textContent.trim()));
    expect(labels).toEqual(['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha', 'Jummah']);

    await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll('#nudge-prayer-list .nudge-row'))
        .find(el => /maghrib/i.test(el.textContent));
      row.click();
    });
    await waitVisible(page, '#nudge-time-popup[aria-hidden="false"]');
    await page.$eval('#nudge-time-input', el => {
      el.value = '18:42';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await tap(page, '#btn-nudge-time-apply');
    await page.waitForFunction(() => document.querySelector('#nudge-summary')?.hidden === false);
    expect(await textOf(page, '#nudge-count')).toBe('1');

    await tap(page, '#btn-send-nudge');
    await page.waitForFunction(() => document.getElementById('nudge-sheet')?.getAttribute('aria-hidden') === 'true');
    const state = await page.evaluate(() => window.__criticalE2EState());
    expect(state.suggestions).toHaveLength(1);
    expect(state.suggestions[0]).toMatchObject({
      toUserId: KEEPER_ID,
      mosqueId: MOSQUE_ID,
      notes: 'Timing nudge from stale-times flow.',
    });
    expect(state.suggestions[0].timings.maghribOffset).toEqual(expect.any(Number));
    expect(state.suggestions[0].timings.fajr).toBeUndefined();
  });

  test('keeper screen lets a signed-in user switch to another keeper without losing the main drawer', async () => {
    await mockApi(page);
    await openFixtureDrawer(page);
    await tap(page, '#keeper-credit-switch');
    await page.waitForFunction(() => document.getElementById('drawer')?.classList.contains('is-keeper-screen'));
    await page.waitForFunction(() => document.querySelectorAll('#keepers-list .keeper-card').length === 2);

    await page.evaluate(() => {
      document.querySelectorAll('#keepers-list .keeper-card')[1].querySelector('.keeper-card__primary').click();
    });
    await page.waitForFunction(() => document.querySelectorAll('#keepers-list .keeper-card')[1].getAttribute('aria-current') === 'true');

    const state = await page.evaluate(() => window.__criticalE2EState());
    expect(state.preferredKeepers).toContainEqual({ mosqueId: MOSQUE_ID, keeperUserId: OTHER_KEEPER_ID });
    expect(await isVisible(page, '#drawer[aria-hidden="false"]')).toBe(true);
  });

  test('masjid rating modal saves category ratings locally and publishes signed-in review payload', async () => {
    await mockApi(page);
    await openFixtureDrawer(page);
    await waitVisible(page, '#drawer-amenities .amenity-row');
    await tap(page, '#drawer-amenities .amenity-row[data-kind="wudu"]');
    await waitVisible(page, '#rating-modal[aria-hidden="false"]');
    expect(await page.$eval('#rating-kind', el => el.value)).toBe('wudu');

    await tap(page, '#rating-stars [data-rating-value="4"]');
    await tap(page, '#rating-save');
    await page.waitForFunction(() => document.getElementById('rating-modal')?.getAttribute('aria-hidden') === 'true');

    const state = await page.evaluate(() => window.__criticalE2EState());
    expect(state.reviews).toHaveLength(1);
    expect(state.reviews[0]).toMatchObject({ rating: 4, cleanlinessRating: 4 });

    const saved = await page.evaluate((id) => JSON.parse(localStorage.getItem(`takbeer_amenity_ratings_v1:${id}`)), MOSQUE_ID);
    expect(saved.wudu).toBe(4);
  });

  test('qaza drawer records selected prayers, shows the pill count, and marks rows prayed', async () => {
    await mockApi(page);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await disableFirebaseAuthGate(page);
    await tap(page, '#qaza-pill');
    await waitVisible(page, '#qaza-drawer[aria-hidden="false"]');
    await page.$eval('#qaza-date', el => { el.value = '2026-05-27'; });
    await tap(page, '.qaza-prayer[data-prayer="fajr"]');
    await tap(page, '.qaza-prayer[data-prayer="isha"]');
    await tap(page, '#qaza-record-btn');
    await page.waitForFunction(() => document.querySelectorAll('#qaza-list .qaza-row').length === 2);
    expect(await textOf(page, '#qaza-pill-count')).toBe('2');

    await tap(page, '#qaza-list .qaza-row:first-child button');
    await page.waitForFunction(() => document.querySelectorAll('#qaza-list .qaza-row').length === 1);
    expect(await textOf(page, '#qaza-pill-count')).toBe('1');
  });

  test('submit timing form defaults Fajr to AM, other namaz to PM, and keeps Maghrib as offset', async () => {
    await mockApi(page, { mosque: { effectiveTimings: null, defaultJamaatTimings: null, prayerSchedules: [], keepers: [] } });
    await openFixtureDrawer(page);
    await waitVisible(page, '#times-empty');
    await tap(page, '#btn-submit-from-empty');
    await waitVisible(page, '#submit-form');

    const defaults = {};
    for (const name of ['fajr', 'dhuhr', 'asr', 'isha', 'jummah']) {
      await page.evaluate((n) => {
        const el = document.querySelector(`#submit-form input[name="${n}"]`);
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      }, name);
      defaults[name] = await page.$eval(`#submit-form input[name="${name}"]`, el => el.value);
    }

    expect(defaults).toEqual({
      fajr: '05:00',
      dhuhr: '13:00',
      asr: '17:00',
      isha: '20:00',
      jummah: '13:00',
    });
    expect(await page.$('#submit-form input[name="maghrib"]')).toBeNull();
    expect(await page.$eval('#submit-form select[name="maghribOffset"]', el => el.value)).toBe('3');
  });

  test('Jummah replaces Dhuhr in the drawer only on Friday', async () => {
    await page.evaluateOnNewDocument(() => {
      const FixedDate = class extends Date {
        constructor(...args) {
          super(...(args.length ? args : ['2026-05-29T10:00:00+05:00']));
        }
        static now() { return new Date('2026-05-29T10:00:00+05:00').getTime(); }
      };
      FixedDate.UTC = Date.UTC;
      FixedDate.parse = Date.parse;
      window.Date = FixedDate;
    });
    await mockApi(page);
    await openFixtureDrawer(page);
    const fridayLabels = await page.$$eval('#drawer-times tbody tr', rows => rows.map(row => row.textContent));
    expect(fridayLabels.join(' ')).toMatch(/Jummah/i);
    expect(fridayLabels.join(' ')).not.toMatch(/Dhuhr/i);

    await closePage(page);
    page = await openMobilePage(browser, ISLAMABAD);
    await seedSignedIn(page);
    await page.evaluateOnNewDocument(() => {
      const FixedDate = class extends Date {
        constructor(...args) {
          super(...(args.length ? args : ['2026-05-28T10:00:00+05:00']));
        }
        static now() { return new Date('2026-05-28T10:00:00+05:00').getTime(); }
      };
      FixedDate.UTC = Date.UTC;
      FixedDate.parse = Date.parse;
      window.Date = FixedDate;
    });
    await mockApi(page);
    await openFixtureDrawer(page);
    const thursdayLabels = await page.$$eval('#drawer-times tbody tr', rows => rows.map(row => row.textContent));
    expect(thursdayLabels.join(' ')).toMatch(/Dhuhr/i);
    expect(thursdayLabels.join(' ')).toMatch(/Jummah/i);
  });

  test('sign-in switches from anonymous local default to account default even when the list row is partial', async () => {
    await closePage(page);
    page = await openMobilePage(browser, ISLAMABAD);
    const partialAccountDefault = {
      id: MOSQUE_ID,
      name: 'Regression Fixture Masjid',
      latitude: ISLAMABAD.latitude,
      longitude: ISLAMABAD.longitude,
      city: 'Islamabad',
      country: 'Pakistan',
      status: 'active',
      amenities: [],
    };
    await mockApi(page, {
      userDefaultMosqueId: MOSQUE_ID,
      listMosques: [partialAccountDefault],
      localDefaultMosque: { name: 'Ayub Local Masjid' },
    });
    await page.evaluateOnNewDocument((id) => {
      localStorage.setItem('jamat.localDefaultMosqueId', id);
      localStorage.setItem('jamat_default_mosque', id);
    }, LOCAL_DEFAULT_ID);

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await disableFirebaseAuthGate(page);
    await page.waitForFunction(() => document.body.innerText.includes('Ayub Local Masjid'));

    await tap(page, '#auth-btn');
    await waitVisible(page, '#login-modal[aria-hidden="false"]');
    await page.type('#login-modal input[name="email"]', 'critical-e2e@jamat.local');
    await tap(page, '#login-modal button[type="submit"]');
    await page.waitForFunction(() => document.getElementById('login-modal')?.getAttribute('aria-hidden') === 'true');
    await page.waitForFunction(() => window.__jamatView?.defaultMosqueObj?.id === '11111111-1111-4111-8111-111111111111');

    const heroText = await page.$eval('.next-card', el => el.textContent);
    expect(heroText).toContain('Regression Fixture Masjid');
    expect(heroText).not.toContain('Ayub Local Masjid');
  });

  test('drawer timings table shows Maghrib computed from the keeper offset', async () => {
    // The drawer used to read effectiveTimings raw (no Maghrib resolution),
    // so a keeper schedule carrying only a maghribOffset rendered without a
    // Maghrib row while the hero (which uses timingsFromMosque) showed one.
    // Both surfaces now share timingsFromMosque — Maghrib must appear.
    await mockApi(page);
    await openFixtureDrawer(page);
    await waitVisible(page, '#drawer-times tbody tr');
    const labels = await page.$$eval('#drawer-times tbody tr', rows => rows.map(r => r.textContent));
    expect(labels.join(' ')).toMatch(/Maghrib/i);
  });

  test('prayer times stay left-to-right in RTL locales', async () => {
    // Arabic/Urdu/Persian bidi used to reorder "4:30 am" into "am 4:30".
    // The time cells are LTR-isolated; assert the computed direction holds
    // even when the document flips to RTL.
    await page.evaluateOnNewDocument((id) => {
      localStorage.setItem('jamat.lang', 'ar');
      localStorage.setItem('jamat.localDefaultMosqueId', id);
    }, MOSQUE_ID);
    await mockApi(page);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await disableFirebaseAuthGate(page);
    await page.waitForFunction(() => document.documentElement.dir === 'rtl');
    await waitVisible(page, '#next-all-list .next-card__jamat');
    const dir = await page.$eval('#next-all-list .next-card__jamat', el => getComputedStyle(el).direction);
    expect(dir).toBe('ltr');
    // The new column headers and Switch affordance must be translated, not English.
    expect(await textOf(page, '.next-card__col-jamat')).not.toMatch(/^Jamat$/);
    expect(await textOf(page, '#next-keeper .next-card__keeper-switch')).not.toMatch(/Switch/);
  });

  test('native RTL language menu docks to the left screen edge', async () => {
    // In the native shell the topbar mirrors for RTL so the language trigger
    // sits on the left; the dropdown must dock to the left screen edge rather
    // than open off toward the right.
    await page.evaluateOnNewDocument(() => localStorage.setItem('jamat.lang', 'ar'));
    await mockApi(page);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await disableFirebaseAuthGate(page);
    await page.evaluate(() => document.body.classList.add('is-native'));
    await page.waitForFunction(() => document.documentElement.dir === 'rtl');
    await tap(page, '#lang-trigger');
    await waitVisible(page, '#lang-pop');
    const geo = await page.evaluate(() => {
      const pop = document.getElementById('lang-pop');
      const b = pop.getBoundingClientRect();
      return { vw: window.innerWidth, left: b.left, right: b.right, position: getComputedStyle(pop).position };
    });
    expect(geo.position).toBe('fixed');
    // Left edge near the screen margin, and clearly closer to the left than the right.
    expect(geo.left).toBeLessThan(24);
    expect(geo.left).toBeLessThan(geo.vw - geo.right);
  });
});
