const {
  BASE_URL, ISLAMABAD,
  launch, openMobilePage, closePage,
  waitVisible, tap,
  describeLocal,
} = require('./helpers');

const fixtureMosque = {
  id: 'fixture-masjid',
  name: 'Fixture Masjid',
  latitude: ISLAMABAD.latitude,
  longitude: ISLAMABAD.longitude,
  city: 'Islamabad',
  country: 'Pakistan',
  addressLine1: 'Fixture address',
  verified: true,
  viewCount: 0,
  favoriteCount: 0,
  amenities: [],
  prayerSchedules: [],
  addedById: 'e2e-user',
  canEdit: true,
};

function json(body, status = 200) {
  return {
    status,
    contentType: 'application/json',
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Dev-User-Email',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    },
    body: JSON.stringify(body),
  };
}

async function mockApi(page, { onCreate, onUpdate } = {}) {
  let lastCreated = null;
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = new URL(req.url());
    // Keep the reverse-geocode lookup deterministic: respond with an empty
    // address so the city/country fields stay blank for the test to type in.
    if (url.hostname === 'nominatim.openstreetmap.org') {
      req.respond(json({ address: {} }));
      return;
    }
    if (!(url.hostname === 'localhost' && url.port === '6001' && url.pathname.startsWith('/api'))) {
      req.continue();
      return;
    }

    if (req.method() === 'OPTIONS') {
      req.respond(json({}, 204));
      return;
    }

    const path = url.pathname.replace(/^\/api/, '');
    if (req.method() === 'GET' && path === '/mosques') {
      req.respond(json({
        data: [fixtureMosque],
        pagination: { page: 1, limit: 10, totalCount: 1, totalPages: 1, hasMore: false },
      }));
      return;
    }
    if (req.method() === 'GET' && path === '/mosques/nearby') {
      req.respond(json({ data: [fixtureMosque], count: 1, radius: 5000, center: ISLAMABAD }));
      return;
    }
    if (req.method() === 'GET' && path === '/mosques/captcha') {
      req.respond(json({ id: 'captcha-e2e-12345', question: 'What is 4 + 5?', expiresInSeconds: 600 }));
      return;
    }
    if (req.method() === 'GET' && path === '/mosques/fixture-masjid') {
      req.respond(json(fixtureMosque));
      return;
    }
    if (req.method() === 'GET' && path === '/users/me') {
      req.respond(json({
        id: 'e2e-user',
        email: 'add-flow-e2e@jamat.local',
        fullName: 'Add Flow E2E',
        defaultMosqueId: null,
        notificationPreferences: {},
      }));
      return;
    }
    if (req.method() === 'GET' && path === '/users/me/favorites') {
      req.respond(json({ data: [] }));
      return;
    }
    if (req.method() === 'POST' && path === '/mosques') {
      const payload = JSON.parse(req.postData() || '{}');
      onCreate?.(payload);
      lastCreated = {
        id: 'created-e2e-masjid',
        ...payload,
        verified: false,
        viewCount: 0,
        favoriteCount: 0,
        amenities: [],
        prayerSchedules: [],
        addedById: 'e2e-user',
        canEdit: true,
      };
      req.respond(json(lastCreated, 201));
      return;
    }
    // After creating, the app opens the new masjid's drawer to collect times.
    if (req.method() === 'GET' && path === '/mosques/created-e2e-masjid' && lastCreated) {
      req.respond(json(lastCreated));
      return;
    }
    if (req.method() === 'PUT' && path === '/mosques/fixture-masjid') {
      const payload = JSON.parse(req.postData() || '{}');
      onUpdate?.(payload);
      req.respond(json({
        ...fixtureMosque,
        ...payload,
        updatedAt: new Date().toISOString(),
        canEdit: true,
      }));
      return;
    }

    req.respond(json({ error: `Unhandled mock route ${req.method()} ${path}` }, 404));
  });
}

describeLocal('Add masjid map flow', () => {
  let browser, page;
  let createdPayload;
  let updatedPayload;

  beforeAll(async () => { browser = await launch(); });
  afterAll(async () => { await browser.close(); });
  beforeEach(async () => {
    createdPayload = null;
    updatedPayload = null;
    page = await openMobilePage(browser, ISLAMABAD);
    await mockApi(page, {
      onCreate: (payload) => { createdPayload = payload; },
      onUpdate: (payload) => { updatedPayload = payload; },
    });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('jamat_dev_email', 'add-flow-e2e@jamat.local');
    });
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  });
  afterEach(async () => { await closePage(page); });

  test('shows name fields immediately, places an anchored pin, and submits selected coordinates', async () => {
    await page.evaluate(() => { location.hash = 'map'; });
    await waitVisible(page, '#mapview[aria-hidden="false"]');
    await page.waitForFunction(() => {
      const transform = getComputedStyle(document.getElementById('mapview')).transform;
      return transform === 'none' || Math.abs(new DOMMatrixReadOnly(transform).m42) < 1;
    }, { timeout: 5_000 });
    await page.waitForSelector('.leaflet-container', { visible: true, timeout: 10_000 });

    await tap(page, '#map-add');
    await waitVisible(page, '#map-addform');
    await waitVisible(page, '#map-addform input[name="name"]');
    await page.waitForFunction(
      () => document.getElementById('addform-captcha-question')?.textContent.includes('4 + 5'),
      { timeout: 5_000 },
    );
    await page.waitForFunction(() => window.__jamatView?.map?.getZoom() >= 17, { timeout: 10_000 });
    const addCenter = await page.evaluate(() => {
      const c = window.__jamatView.map.getCenter();
      return { lat: c.lat, lng: c.lng, zoom: window.__jamatView.map.getZoom() };
    });
    expect(addCenter.zoom).toBeGreaterThanOrEqual(17);
    expect(Math.abs(addCenter.lat - ISLAMABAD.latitude)).toBeLessThan(0.005);
    expect(Math.abs(addCenter.lng - ISLAMABAD.longitude)).toBeLessThan(0.005);

    const initialStatus = await page.$eval('#addform-location-status', (el) => el.textContent.trim());
    expect(initialStatus).toBe('No location selected');

    const clickPoint = await page.evaluate(() => {
      const map = document.getElementById('map').getBoundingClientRect();
      const form = document.getElementById('map-addform').getBoundingClientRect();
      const belowForm = form.bottom + 48 <= map.bottom - 42 ? form.bottom + 48 : null;
      const aboveForm = form.top - 48 >= map.top + 42 ? form.top - 48 : null;
      return {
        x: map.left + map.width * 0.58,
        y: belowForm || aboveForm || (map.top + map.height * 0.5),
      };
    });
    await page.mouse.click(clickPoint.x, clickPoint.y);
    await page.waitForSelector('.jamat-pin--temp', { visible: true, timeout: 5_000 });

    const pinMetrics = await page.evaluate((clicked) => {
      const icon = document.querySelector('.jamat-pin--temp')?.closest('.leaflet-marker-icon');
      const rect = icon.getBoundingClientRect();
      const tip = { x: rect.left + rect.width / 2, y: rect.top + rect.height - 2 };
      return {
        dx: Math.abs(tip.x - clicked.x),
        dy: Math.abs(tip.y - clicked.y),
        status: document.getElementById('addform-location-status').textContent.trim(),
        coords: document.getElementById('addform-coords').textContent.trim(),
      };
    }, clickPoint);
    expect(pinMetrics.dx).toBeLessThanOrEqual(3);
    expect(pinMetrics.dy).toBeLessThanOrEqual(3);
    expect(pinMetrics.status).toBe('Pin selected');
    expect(pinMetrics.coords).toMatch(/^-?\d+\.\d{6}, -?\d+\.\d{6}$/);

    await page.type('#map-addform input[name="name"]', 'E2E Add Flow Masjid');
    await page.type('#map-addform input[name="city"]', 'Islamabad');
    await page.type('#map-addform input[name="country"]', 'Pakistan');
    await page.type('#map-addform input[name="addressLine1"]', 'E2E marker address');
    await page.type('#map-addform input[name="captchaAnswer"]', '9');
    await page.click('#map-addform button[type="submit"]');

    await page.waitForFunction(
      () => document.getElementById('toast')?.textContent.includes('Added E2E Add Flow Masjid'),
      { timeout: 5_000 },
    );

    expect(createdPayload).toMatchObject({
      name: 'E2E Add Flow Masjid',
      city: 'Islamabad',
      country: 'Pakistan',
      addressLine1: 'E2E marker address',
      captcha: { id: 'captcha-e2e-12345', answer: '9' },
    });
    expect(typeof createdPayload.latitude).toBe('number');
    expect(typeof createdPayload.longitude).toBe('number');

    // The flow continues straight into entering jamat times: the new
    // masjid's drawer opens with the submit form visible.
    await waitVisible(page, '#drawer[aria-hidden="false"]');
    await waitVisible(page, '#submit-form');
  });

  test('lets the creator edit masjid details from the detail drawer', async () => {
    await page.evaluate(() => { location.hash = 'mosque/fixture-masjid'; });
    await waitVisible(page, '#drawer[aria-hidden="false"]');
    await waitVisible(page, '#btn-edit-mosque');

    await tap(page, '#btn-edit-mosque');
    await waitVisible(page, '#edit-mosque-form');
    await page.$eval('#edit-mosque-form input[name="name"]', (el) => { el.value = ''; });
    await page.type('#edit-mosque-form input[name="name"]', 'Renamed Fixture Masjid');
    await page.$eval('#edit-mosque-form input[name="addressLine1"]', (el) => { el.value = ''; });
    await page.type('#edit-mosque-form input[name="addressLine1"]', 'Updated fixture address');
    await tap(page, '#btn-edit-confirm');

    await page.waitForFunction(
      () => document.getElementById('toast')?.textContent.includes('Updated'),
      { timeout: 5_000 },
    );

    expect(updatedPayload).toMatchObject({
      name: 'Renamed Fixture Masjid',
      city: 'Islamabad',
      country: 'Pakistan',
      addressLine1: 'Updated fixture address',
    });
    await expect(page.$eval('#drawer-title', el => el.textContent.trim())).resolves.toBe('Renamed Fixture Masjid');
  });
});
