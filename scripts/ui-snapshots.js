/**
 * UI/UX snapshot harness.
 *
 * Renders the canonical web app (the same sources Capacitor packages) at a
 * mobile viewport against a fully-mocked backend, so every populated state
 * (hero with timings, keeper chip, all-times panel, drawer, qaza, language
 * menu) can be screenshotted without a live server. Mirrors the request mock
 * used by e2e/20-critical-regressions.test.js.
 *
 * Usage:
 *   BASE_URL=http://localhost:6002 node scripts/ui-snapshots.js [outDir] [lang]
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const BASE_URL = process.env.BASE_URL || 'http://localhost:6002';
const OUT_DIR = path.resolve(process.argv[2] || '.tmp-ui-snapshots');
const ISLAMABAD = { latitude: 33.7295, longitude: 73.0372 };

const MOBILE = {
  viewport: { width: 412, height: 915, isMobile: true, hasTouch: true, deviceScaleFactor: 2.625 },
  userAgent:
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/120.0.0.0 Mobile Safari/537.36',
};

const MOSQUE_ID = '11111111-1111-4111-8111-111111111111';
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

function fixtureMosque() {
  const staleDate = new Date(Date.now() - 47 * 24 * 60 * 60 * 1000).toISOString();
  const timings = { fajr: '04:30', dhuhr: '13:30', asr: '17:30', maghribOffset: 3, isha: '21:00', jummah: ['13:30'] };
  return {
    id: MOSQUE_ID,
    name: 'Masjid Bilal',
    latitude: ISLAMABAD.latitude,
    longitude: ISLAMABAD.longitude,
    coordinates: { lat: ISLAMABAD.latitude, lng: ISLAMABAD.longitude },
    city: 'Islamabad',
    country: 'Pakistan',
    addressLine1: 'Street 12, F-8 Markaz',
    address: 'Street 12, F-8 Markaz',
    verified: true,
    status: 'active',
    distanceKm: 1.2,
    viewCount: 0,
    favoriteCount: 3,
    amenities: ['parking', 'wudu_facilities', 'womens_section'],
    amenityRatings: { size: { avg: 4, count: 2 }, wudu: { avg: 3.5, count: 2 } },
    defaultJamaatTimings: timings,
    effectiveTimings: timings,
    effectiveKeeperId: KEEPER_ID,
    effectiveKeeperName: 'Junaid Qazi',
    effectiveKeeperUpdatedAt: staleDate,
    preferredKeeperId: null,
    keepers: [
      { submitterId: KEEPER_ID, submitterName: 'Junaid Qazi', rating: 4.9, followerCount: 2, latestSubmissionId: '55555555-5555-4555-8555-555555555555', updatedAt: staleDate, timings },
      { submitterId: OTHER_KEEPER_ID, submitterName: 'Junaid Ahmed', rating: 4.3, followerCount: 1, latestSubmissionId: '66666666-6666-4666-8666-666666666666', updatedAt: staleDate, timings: { ...timings, fajr: '04:40', dhuhr: '13:20' } },
    ],
    prayerSchedules: [{ id: 'schedule-1', timings, isActive: true, createdAt: staleDate }],
  };
}

async function mockApi(page) {
  const mosque = fixtureMosque();
  const qazaRows = [];
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    let url;
    try { url = new URL(req.url()); } catch { return req.continue(); }
    if (/\/js\/config\.js$/.test(url.pathname)) {
      const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'config.js'), 'utf8')
        .replace(/apiKey:\s*'[^']*'/, "apiKey: ''");
      return req.respond({ status: 200, contentType: 'application/javascript', body: source });
    }
    const isApi = url.pathname.startsWith('/api') ||
      (url.hostname === 'localhost' && url.port === '6001' && url.pathname.startsWith('/api'));
    if (!isApi) return req.continue();
    if (req.method() === 'OPTIONS') return req.respond(json({}, 204));
    const p = url.pathname.replace(/^\/api/, '');
    const body = () => JSON.parse(req.postData() || '{}');

    if (req.method() === 'GET' && p === '/users/me') {
      return req.respond(json({ id: USER_ID, email: 'snap@jamat.local', fullName: 'Snapshot User', defaultMosqueId: MOSQUE_ID, notificationPreferences: {} }));
    }
    if (req.method() === 'GET' && p === '/users/me/favorites') return req.respond(json({ data: [] }));
    if (req.method() === 'PUT' && p === '/users/me/default-mosque') return req.respond(json({ defaultMosqueId: body().mosqueId || null }));
    if (req.method() === 'GET' && p === '/mosques/nearby') return req.respond(json({ data: [mosque], count: 1, radius: 5000, center: ISLAMABAD }));
    if (req.method() === 'GET' && p === '/mosques') return req.respond(json({ data: [mosque], pagination: { page: 1, limit: 20, totalCount: 1, totalPages: 1, hasMore: false } }));
    if (req.method() === 'GET' && p === `/mosques/${MOSQUE_ID}`) return req.respond(json(mosque));
    if (req.method() === 'GET' && p === `/mosques/${MOSQUE_ID}/keepers`) return req.respond(json({ keepers: mosque.keepers }));
    if (req.method() === 'GET' && p === '/qaza') return req.respond(json({ records: qazaRows }));
    if (req.method() === 'POST' && p === '/qaza') {
      const row = { id: `77777777-7777-4777-8777-${String(qazaRows.length + 1).padStart(12, '0')}`, ...body() };
      qazaRows.push(row);
      return req.respond(json({ record: row, created: true }, 201));
    }
    if (req.method() === 'GET' && p === '/suggestions/inbox') return req.respond(json({ suggestions: [] }));
    return req.respond(json({ error: `unhandled ${req.method()} ${p}` }, 404));
  });
}

async function newPage(browser, lang) {
  const ctx = await browser.createBrowserContext();
  await ctx.overridePermissions(BASE_URL, ['geolocation']);
  const page = await ctx.newPage();
  await page.setCacheEnabled(false);
  await page.setViewport(MOBILE.viewport);
  await page.setUserAgent(MOBILE.userAgent);
  await page.setGeolocation(ISLAMABAD);
  page.on('pageerror', err => console.error(`[page error] ${err.message}`));
  page.on('console', msg => { if (msg.type() === 'error') console.error(`[console error] ${msg.text()}`); });
  await page.evaluateOnNewDocument((lng) => {
    localStorage.setItem('takbeer_keeper_intro_seen_v2', 'true');
    localStorage.setItem('jamat_dev_email', 'snap@jamat.local');
    localStorage.setItem('jamat_default_mosque', '11111111-1111-4111-8111-111111111111');
    if (lng) localStorage.setItem('jamat.lang', lng);
  }, lang);
  await mockApi(page);
  page._ctx = ctx;
  return page;
}

async function shoot(page, name) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  saved ${path.relative(process.cwd(), file)}`);
}

async function settle(page, ms = 900) { await new Promise(r => setTimeout(r, ms)); }

async function captureFor(browser, lang, suffix) {
  console.log(`\n=== language: ${lang} ===`);
  const page = await newPage(browser, lang === 'en' ? null : lang);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { if (window.JAMAT_CONFIG) window.JAMAT_CONFIG.firebase = {}; });
  await settle(page, 1500);
  await shoot(page, `home${suffix}`);

  if (process.env.PROBE) {
    const probe = await page.evaluate(() => {
      const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { text: e.textContent.trim(), left: Math.round(b.left), right: Math.round(b.right), dir: getComputedStyle(e).direction }; };
      return {
        htmlDir: document.documentElement.dir,
        prayer: r('#next-prayer'),
        at: r('#next-at'),
        atTime: r('#next-at .next-card__at-time'),
        share: r('.hero__share, #hero-share, [data-i18n="share.button"], .hero-share'),
      };
    });
    console.log('PROBE', JSON.stringify(probe, null, 2));
  }

  // Full hero card close-up
  const heroBox = await page.$('#next-card');
  if (heroBox) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    await heroBox.screenshot({ path: path.join(OUT_DIR, `hero-card${suffix}.png`) });
    console.log(`  saved hero-card${suffix}.png`);
  }

  // Language menu open (only worth capturing once, in en)
  if (lang === 'en') {
    await page.evaluate(() => document.getElementById('lang-trigger')?.click());
    await settle(page, 500);
    await shoot(page, `lang-menu${suffix}`);
    await page.evaluate(() => document.getElementById('lang-trigger')?.click());

    // Qaza drawer
    await page.evaluate(() => document.getElementById('qaza-pill')?.click());
    await settle(page, 700);
    await shoot(page, `qaza-drawer${suffix}`);
    await page.evaluate(() => document.querySelector('#qaza-drawer .drawer__close')?.click());
    await settle(page, 400);

    // Mosque drawer (timings table)
    await page.goto(`${BASE_URL}/#mosque/${MOSQUE_ID}`, { waitUntil: 'domcontentloaded' });
    await settle(page, 1200);
    await shoot(page, `mosque-drawer${suffix}`);
  }

  await page._ctx.close();
}

(async () => {
  console.log(`Snapshotting ${BASE_URL} → ${OUT_DIR}`);
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-features=UseChromeHTTP3,UseDnsHttpsSvcb'],
  });
  try {
    const langs = (process.argv[3] ? [process.argv[3]] : ['en', 'ur', 'ar']);
    for (const lang of langs) {
      await captureFor(browser, lang, `-${lang}`);
    }
  } finally {
    await browser.close();
  }
  console.log('\nDone.');
})();
