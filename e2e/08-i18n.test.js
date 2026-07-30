/**
 * E2E coverage for the multi-language system:
 *   - Language menu is in the top bar and lists all supported languages
 *   - First visit: <html lang> matches the browser's navigator.language
 *   - Picking Arabic flips the document into RTL and translates UI
 *   - Choice persists across reload via localStorage
 *   - Picking back to English restores LTR + English UI
 */

const {
  BASE_URL, launch, openMobilePage, closePage,
  isVisible, textOf, waitVisible,
} = require('./helpers');

describe('Multi-language', () => {
  let browser, page;

  beforeAll(async () => { browser = await launch(); });
  afterAll(async () => { await browser.close(); });
  afterEach(async () => { if (page) await closePage(page); });

  async function chooseLanguage(code) {
    await waitVisible(page, '#lang-trigger');
    await page.click('#lang-trigger');
    await waitVisible(page, '#lang-pop');
    await page.click(`#lang-option-${code}`);
  }

  async function suppressKeeperIntro() {
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('takbeer_keeper_intro_seen_v2', 'true');
    });
  }

  test('language picker appears in the top bar with the supported languages', async () => {
    page = await openMobilePage(browser);
    await suppressKeeperIntro();
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await waitVisible(page, '#lang-trigger');

    expect(await isVisible(page, '#lang-trigger')).toBe(true);

    // The picker should expose every supported language so a non-English
    // speaker can find their language by native script.
    await page.click('#lang-trigger');
    await waitVisible(page, '#lang-pop');
    const optionValues = await page.$$eval('#lang-list .langmenu__option', els => els.map(o => o.dataset.lang));
    expect(optionValues).toEqual(
      expect.arrayContaining(['en', 'ar', 'ur', 'id', 'bn', 'hi', 'tr', 'fa', 'ms', 'fr'])
    );

    // Native-script labels — pick a couple to verify the option text isn't blank/English.
    const optionTexts = await page.$$eval('#lang-list .langmenu__option', els => Object.fromEntries(els.map(o => [o.dataset.lang, o.querySelector('.langmenu__native')?.textContent.trim()])));
    expect(optionTexts.ar).toBe('العربية');
    expect(optionTexts.ur).toBe('اردو');
    expect(optionTexts.hi).toBe('हिन्दी');
  });

  test('selecting Arabic flips the document to RTL and translates the hero', async () => {
    page = await openMobilePage(browser);
    await suppressKeeperIntro();
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

    await chooseLanguage('ar');

    // Wait until the i18n change event has propagated (lang attribute flips).
    await page.waitForFunction(() => document.documentElement.lang === 'ar', { timeout: 5_000 });

    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');

    // The kicker is one of the most prominent translated strings; it must
    // no longer be its English form once Arabic is loaded.
    const kicker = await textOf(page, '.kicker');
    expect(kicker).not.toMatch(/crowd-sourced jamat times/i);
    expect(kicker).toMatch(/[؀-ۿ]/); // contains Arabic-block characters

    // Prayer name in the reminder list flips too — sanity check.
    const fajrName = await textOf(page, 'li[data-prayer="fajr"] .rpl__name');
    expect(fajrName).toBe('الفجر');
  });

  test('language choice persists across reload', async () => {
    page = await openMobilePage(browser);
    await suppressKeeperIntro();
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

    await chooseLanguage('tr');
    await page.waitForFunction(() => document.documentElement.lang === 'tr', { timeout: 5_000 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.lang === 'tr', { timeout: 5_000 });

    expect(await page.evaluate(() => localStorage.getItem('jamat.lang'))).toBe('tr');
    // Turkish translation of the eyebrow.
    expect(await textOf(page, '.kicker')).toMatch(/cemaat/i);
  });

  test('first visit auto-detects from navigator.language', async () => {
    // Explicitly request French as the only Accept-Language → navigator.language
    // becomes "fr" → i18n should pick fr.json on first load (no localStorage yet).
    page = await openMobilePage(browser);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'fr-FR,fr;q=0.9' });
    // Override the JS-level navigator.language too — Accept-Language alone
    // doesn't always flow through to navigator.language in headless Chrome.
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('takbeer_keeper_intro_seen_v2', 'true');
      Object.defineProperty(navigator, 'language', { get: () => 'fr-FR' });
      Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr'] });
    });
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

    await page.waitForFunction(() => document.documentElement.lang === 'fr', { timeout: 5_000 });
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('ltr');
    expect(await textOf(page, '.kicker')).toMatch(/jamâa|jamaa/i);
  });

  test('switching back to English restores LTR and English copy', async () => {
    page = await openMobilePage(browser);
    await suppressKeeperIntro();
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

    await chooseLanguage('ar');
    await page.waitForFunction(() => document.documentElement.lang === 'ar', { timeout: 5_000 });

    await chooseLanguage('en');
    await page.waitForFunction(() => document.documentElement.lang === 'en', { timeout: 5_000 });

    expect(await page.evaluate(() => document.documentElement.dir)).toBe('ltr');
    expect(await textOf(page, '.kicker')).toBe('A crowd-sourced jamat times directory');
  });
});
