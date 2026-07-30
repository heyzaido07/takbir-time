/**
 * Puppeteer test helpers — shared browser launch, mobile emulation,
 * geolocation grant, common selectors / actions, and assertion utilities.
 *
 * Each test file owns one browser instance (via beforeAll/afterAll) and
 * each individual test gets a fresh page (via beforeEach/afterEach), so
 * cookies/localStorage from one test don't leak into the next.
 */

const puppeteer = require('puppeteer');

const BASE_URL = process.env.BASE_URL || 'https://takbeertime.com';
const HEADED = !!process.env.HEADED;

// Production refuses the email-only dev-auth flow that signIn() uses (the
// server requires a real password there, and dev-auth is disabled). Suites
// gate signed-in scenarios behind `authTest`, and suites that depend on
// request-interception mocks bound to the local stack gate themselves
// behind `describeLocal`, so a production run skips them instead of
// failing at the login modal / missing fixtures.
const isProductionBase = /^https:\/\/(www\.)?takbeertime\.com\b/.test(BASE_URL);
const authTest = isProductionBase ? test.skip : test;
const describeLocal = isProductionBase ? describe.skip : describe;

// Pixel-7-ish mobile emulation. The app is mobile-first; we test where it lives.
const MOBILE = {
  viewport: { width: 412, height: 915, isMobile: true, hasTouch: true, deviceScaleFactor: 2.625 },
  userAgent:
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/120.0.0.0 Mobile Safari/537.36',
};

const ISLAMABAD = { latitude: 33.7295, longitude: 73.0372 };

/** Launch the shared browser (call from beforeAll). */
async function launch() {
  const browser = await puppeteer.launch({
    headless: HEADED ? false : 'new',
    protocolTimeout: 120_000,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      // Disable HTTP/3 — Cloudflare advertises it, Puppeteer's bundled
      // Chromium occasionally throws ERR_QUIC_PROTOCOL_ERROR. Force HTTP/2.
      '--disable-features=UseChromeHTTP3,UseDnsHttpsSvcb',
    ],
  });
  const close = browser.close.bind(browser);
  browser.close = async () => {
    const proc = typeof browser.process === 'function' ? browser.process() : null;
    let timer;
    const closePromise = close();
    try {
      await Promise.race([
        closePromise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('browser.close timed out')), 15_000);
        }),
      ]);
    } catch (err) {
      if (proc && !proc.killed) {
        proc.kill();
        await new Promise(resolve => {
          const done = () => resolve();
          const fallback = setTimeout(done, 5_000);
          proc.once?.('exit', () => {
            clearTimeout(fallback);
            done();
          });
          closePromise.catch(() => {}).finally(() => {
            clearTimeout(fallback);
            done();
          });
        });
      }
      console.warn(`[e2e] ${err.message}; killed Chromium child process ${proc?.pid || 'unknown'}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  return browser;
}

/** Open a fresh page with mobile emulation + geolocation grant. */
async function openMobilePage(browser, geo = ISLAMABAD) {
  const ctx = await browser.createBrowserContext();
  await ctx.overridePermissions(BASE_URL, ['geolocation']);
  const page = await ctx.newPage();
  await page.setViewport(MOBILE.viewport);
  await page.setUserAgent(MOBILE.userAgent);
  if (geo) await page.setGeolocation(geo);

  // Surface browser errors / failed requests in test output for debugging.
  page.on('pageerror', err => console.error(`[page error] ${err.message}`));
  page.on('console', msg => {
    if (msg.type() === 'error') console.error(`[console error] ${msg.text()}`);
  });
  page.on('requestfailed', req => {
    const url = req.url();
    // Ignore the noise from Cloudflare/3rd-party assets — only care about our origin.
    let host = '';
    try { host = new URL(url).hostname; } catch {}
    if (host === 'takbeertime.com' || host === 'www.takbeertime.com' || host === 'localhost') {
      console.error(`[req failed] ${req.method()} ${url} → ${req.failure()?.errorText}`);
    }
  });

  // attach the context so callers can close cleanly
  page._jamat_context = ctx;
  return page;
}

async function closePage(page) {
  if (page._jamat_context) await page._jamat_context.close();
  else await page.close();
}

// ─── DOM helpers ────────────────────────────────────────────────────

async function isVisible(page, selector) {
  return page.evaluate(sel => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 &&
      style.display !== 'none' && style.visibility !== 'hidden' &&
      style.opacity !== '0';
  }, selector);
}

async function textOf(page, selector) {
  return page.$eval(selector, el => el.textContent?.trim() ?? '');
}

async function attrOf(page, selector, attr) {
  return page.$eval(selector, (el, a) => el.getAttribute(a), attr);
}

async function exists(page, selector) {
  return (await page.$(selector)) !== null;
}

/** Wait until selector matches AND the element is actually visible. */
async function waitVisible(page, selector, opts = {}) {
  await page.waitForSelector(selector, { visible: true, timeout: 10_000, ...opts });
}

/** Wait until selector either disappears or element is hidden. */
async function waitHidden(page, selector, opts = {}) {
  await page.waitForSelector(selector, { hidden: true, timeout: 10_000, ...opts });
}

/** Tap a selector. Triggers the real click event in-page (via element.click())
 *  which always finds the current element and fires its click handlers,
 *  avoiding clickablePoint flakiness when an element is outside the
 *  viewport, mid-animation, or partially occluded by transitions. */
async function tap(page, selector) {
  await page.waitForSelector(selector, { visible: true });
  await page.evaluate(s => {
    const el = document.querySelector(s);
    if (!el) throw new Error(`tap: ${s} disappeared between waitFor and click`);
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    el.click();
  }, selector);
}

/** Sign in via the email-based dev-auth flow. Returns the email used. */
async function signIn(page, email) {
  email = email || `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@jamat.local`;
  await tap(page, '#auth-btn');
  await waitVisible(page, '#login-modal[aria-hidden="false"]');
  await page.type('#login-modal input[name="email"]', email);
  await Promise.all([
    page.waitForSelector('#login-modal[aria-hidden="false"]', { hidden: true }),
    page.click('#login-modal button[type="submit"]'),
  ]);
  // Wait for the auth-btn to flip to signed-in state
  await page.waitForFunction(
    () => document.getElementById('auth-btn')?.dataset.state === 'signed-in',
    { timeout: 5_000 }
  );
  return email;
}

/** Wait for the directory list to render at least one card. */
async function waitForDirectoryCards(page) {
  await page.waitForSelector('#list-nearby > .card', { visible: true, timeout: 10_000 });
}

module.exports = {
  BASE_URL, ISLAMABAD,
  isProductionBase, authTest, describeLocal,
  launch, openMobilePage, closePage,
  isVisible, textOf, attrOf, exists,
  waitVisible, waitHidden, tap,
  signIn, waitForDirectoryCards,
};
