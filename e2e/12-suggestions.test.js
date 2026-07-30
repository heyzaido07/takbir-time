/**
 * Suggest-update flow end-to-end:
 *  - User A submits timings on a fresh mosque (becomes the keeper)
 *  - User B opens the mosque, follows that keeper, sees a "Suggest update" button
 *  - User B opens the suggest modal and sends new times
 *  - Backend records a Suggestion row addressed to User A
 *  - Browser session as User A: inbox banner shows "1 timing suggestion…",
 *    inbox modal lists it, accepting it creates a TimingSubmission as User A
 *    with the proposed values
 */

const {
  BASE_URL, ISLAMABAD,
  launch, openMobilePage, closePage,
  isVisible, waitVisible, tap, signIn,
  authTest,
} = require('./helpers');

describe('Suggest-update flow', () => {
  let browser;

  beforeAll(async () => { browser = await launch(); });
  afterAll(async () => { await browser.close(); });

  // Open one isolated browser context per actor so localStorage / signed-in
  // state stays separate. Returns {page, email}.
  async function newActor(emailHint) {
    const page = await openMobilePage(browser, ISLAMABAD);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    const email = await signIn(page, `${emailHint}-${Date.now()}@jamat.local`);
    return { page, email };
  }

  // Create a fresh mosque + initial submission so there's a known keeper to
  // suggest *to*. Returns {mosqueId, keeperEmail}.
  async function seedMosqueWithKeeper() {
    const keeper = await newActor('keeper');
    const mosqueId = await keeper.page.evaluate(async () => {
      const email = localStorage.getItem('jamat_dev_email');
      const base = window.JAMAT_CONFIG.apiBase;
      const r = await fetch(`${base}/mosques`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-User-Email': email },
        body: JSON.stringify({
          name: `Suggest E2E ${Date.now()}`,
          latitude: 33.7295, longitude: 73.0372,
          city: 'Islamabad', country: 'Pakistan',
        }),
      });
      const m = await r.json();
      // Submit baseline timings *as the keeper* so they appear in the keeper list.
      await fetch(`${base}/submissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-User-Email': email },
        body: JSON.stringify({
          mosqueId: m.id,
          timings: { fajr: '05:00', dhuhr: '13:30', asr: '17:00', isha: '20:00', maghribOffset: 3 },
        }),
      });
      return m.id;
    });
    expect(mosqueId).toMatch(/^[0-9a-f-]{36}$/);
    return { keeper, mosqueId };
  }

  authTest('suggest modal opens from a followed keeper and sends', async () => {
    const { keeper, mosqueId } = await seedMosqueWithKeeper();

    // User B follows the keeper, then sees "Suggest update" on the keeper row.
    const suggester = await newActor('suggester');
    await suggester.page.goto(`${BASE_URL}/#mosque/${mosqueId}`, { waitUntil: 'domcontentloaded' });
    await waitVisible(suggester.page, '#drawer[aria-hidden="false"]');
    await waitVisible(suggester.page, '#keepers-list .keeper');

    // Click the keeper's "Follow these times" button.
    await suggester.page.evaluate(() => {
      const btn = document.querySelector('#keepers-list .keeper .keeper__follow-btn');
      btn.click();
    });
    // Wait for the row to flip to is-effective AND for the suggest button to appear.
    await suggester.page.waitForFunction(
      () => !!document.querySelector('#keepers-list .keeper.is-effective .keeper__suggest-btn'),
      { timeout: 5_000 }
    );

    // Open the suggest modal + change Fajr to 04:50 + send.
    await suggester.page.evaluate(() => {
      document.querySelector('#keepers-list .keeper.is-effective .keeper__suggest-btn').click();
    });
    await waitVisible(suggester.page, '#suggest-modal[aria-hidden="false"]');
    await suggester.page.evaluate(() => {
      const f = document.querySelector('#suggest-modal input[name="fajr"]');
      f.value = '04:50';
      f.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await suggester.page.click('#suggest-modal #suggest-send');
    await suggester.page.waitForFunction(
      () => document.getElementById('suggest-modal').getAttribute('aria-hidden') === 'true',
      { timeout: 5_000 }
    );

    // Switch to the keeper's session and verify the inbox banner shows up.
    await keeper.page.reload({ waitUntil: 'domcontentloaded' });
    await waitVisible(keeper.page, '#inbox-banner');
    expect(await keeper.page.$eval('#inbox-banner-text', el => el.textContent)).toMatch(/timing|suggestion|تذكير|تجویز|saran|cadangan|öneri|वक्त|समय|sugges|suger|пе/i);
    // Open inbox + accept.
    await tap(keeper.page, '#inbox-banner-btn');
    await waitVisible(keeper.page, '#inbox-modal[aria-hidden="false"]');
    const inboxRows = await keeper.page.$$('#inbox-list .inbox-row');
    expect(inboxRows.length).toBeGreaterThanOrEqual(1);

    // Accept the first row's accept button.
    await keeper.page.evaluate(() => {
      const acceptBtn = document.querySelector('#inbox-list .inbox-row__actions button.btn--primary');
      acceptBtn.click();
    });
    // Banner disappears (no more pending) — wait for hidden flip.
    await keeper.page.waitForFunction(
      () => document.getElementById('inbox-banner')?.hidden === true,
      { timeout: 5_000 }
    );

    // Verify a TimingSubmission was created as the keeper with the suggested fajr.
    const subs = await keeper.page.evaluate(async (mid) => {
      const email = localStorage.getItem('jamat_dev_email');
      const base = window.JAMAT_CONFIG.apiBase;
      const r = await fetch(`${base}/submissions?mosqueId=${mid}`, {
        headers: { 'X-Dev-User-Email': email },
      });
      const j = await r.json();
      return j.data;
    }, mosqueId);
    // The keeper's seed submission was 05:00. The only way an 04:50 submission
    // exists in this fresh mosque is via the accept handler creating one as
    // the keeper using the suggested timings.
    const ours = subs.find(s => s.timings?.fajr === '04:50');
    expect(ours).toBeDefined();
    expect(ours.submittedById).toBeTruthy();

    await closePage(keeper.page);
    await closePage(suggester.page);
  });

  authTest('inbox prompts keepers to enable suggestion alerts when this device is not subscribed', async () => {
    const { keeper, mosqueId } = await seedMosqueWithKeeper();
    const suggester = await newActor('alert-suggester');

    await keeper.page.evaluateOnNewDocument(() => {
      window.__mockPushState = {
        permission: 'prompt',
        subscribed: false,
        pending: false,
        subscribedTopic: null,
      };
      window.takbeerPush = {
        subscribeWhenPermitted: async (topic) => {
          window.__mockPushState.pending = true;
          window.__mockPushState.queuedTopic = topic;
          return false;
        },
        subscribe: async (topic) => {
          window.__mockPushState.subscribed = true;
          window.__mockPushState.pending = false;
          window.__mockPushState.subscribedTopic = topic;
          return true;
        },
        status: async (topic) => ({
          supported: true,
          permission: window.__mockPushState.permission,
          registered: window.__mockPushState.subscribed,
          subscribed: window.__mockPushState.subscribed,
          pending: window.__mockPushState.pending && window.__mockPushState.queuedTopic === topic,
        }),
      };
    });

    await suggester.page.evaluate(async (mid) => {
      const fromEmail = localStorage.getItem('jamat_dev_email');
      const base = window.JAMAT_CONFIG.apiBase;
      const k = await fetch(`${base}/mosques/${mid}/keepers`).then(r => r.json());
      const target = k.keepers[0];
      await fetch(`${base}/suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-User-Email': fromEmail },
        body: JSON.stringify({
          toUserId: target.submitterId,
          mosqueId: mid,
          timings: { fajr: '05:12' },
          notes: 'Alert prompt coverage',
        }),
      });
    }, mosqueId);

    await keeper.page.reload({ waitUntil: 'domcontentloaded' });
    await waitVisible(keeper.page, '#inbox-banner');
    await tap(keeper.page, '#inbox-banner-btn');
    await waitVisible(keeper.page, '#inbox-modal[aria-hidden="false"]');
    await waitVisible(keeper.page, '#inbox-alerts');

    const promptText = await keeper.page.$eval('#inbox-alerts', el => el.textContent);
    expect(promptText).toMatch(/suggestion alerts|enable alerts/i);

    await tap(keeper.page, '#inbox-alerts-enable');
    await keeper.page.waitForFunction(
      () => window.__mockPushState?.subscribed === true && document.getElementById('inbox-alerts')?.hidden === true,
      { timeout: 5_000 }
    );
    const subscribedTopic = await keeper.page.evaluate(() => window.__mockPushState.subscribedTopic);
    expect(subscribedTopic).toMatch(/^suggest-to-[0-9a-f-]{36}$/);

    await closePage(keeper.page);
    await closePage(suggester.page);
  });

  authTest('signed-in header shows my time-keeper follower count', async () => {
    const { keeper, mosqueId } = await seedMosqueWithKeeper();
    const keeperId = await keeper.page.evaluate(async (mid) => {
      const base = window.JAMAT_CONFIG.apiBase;
      const data = await fetch(`${base}/mosques/${mid}/keepers`).then(r => r.json());
      return data.keepers[0].submitterId;
    }, mosqueId);

    const followerA = await newActor('follower-a');
    const followerB = await newActor('follower-b');
    for (const actor of [followerA, followerB]) {
      await actor.page.evaluate(async ({ mid, kid }) => {
        const email = localStorage.getItem('jamat_dev_email');
        const base = window.JAMAT_CONFIG.apiBase;
        await fetch(`${base}/users/me/preferred-keeper`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-Dev-User-Email': email },
          body: JSON.stringify({ mosqueId: mid, keeperUserId: kid }),
        });
      }, { mid: mosqueId, kid: keeperId });
    }

    await keeper.page.reload({ waitUntil: 'domcontentloaded' });
    await waitVisible(keeper.page, '#auth-followers');
    await keeper.page.waitForFunction(
      () => document.querySelector('#auth-followers')?.textContent?.trim() === '2',
      { timeout: 5_000 }
    );

    await closePage(followerA.page);
    await closePage(followerB.page);
    await closePage(keeper.page);
  });

  authTest('every keeper card renders thumbs-up, thumbs-down, and suggest-update controls', async () => {
    const { keeper, mosqueId } = await seedMosqueWithKeeper();

    // Add a second keeper so the list has > 1 row, and we can verify the
    // controls appear on a row that ISN'T the viewer's own.
    const otherKeeper = await newActor('keeper-b');
    await otherKeeper.page.evaluate(async (mid) => {
      const email = localStorage.getItem('jamat_dev_email');
      const base = window.JAMAT_CONFIG.apiBase;
      await fetch(`${base}/submissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-User-Email': email },
        body: JSON.stringify({
          mosqueId: mid,
          timings: { fajr: '05:10', dhuhr: '13:35', maghribOffset: 5 },
        }),
      });
    }, mosqueId);

    // Third user views the mosque — they're not a keeper of it, so BOTH
    // keeper rows should show all three controls.
    const viewer = await newActor('viewer');
    await viewer.page.goto(`${BASE_URL}/#mosque/${mosqueId}`, { waitUntil: 'domcontentloaded' });
    await waitVisible(viewer.page, '#drawer[aria-hidden="false"]');
    await viewer.page.waitForFunction(
      () => document.querySelectorAll('#keepers-list .keeper').length >= 2,
      { timeout: 5_000 }
    );

    const summary = await viewer.page.$$eval('#keepers-list .keeper', rows => rows.map(r => ({
      hasUp:      !!r.querySelector('.keeper__vote-btn--up'),
      hasDown:    !!r.querySelector('.keeper__vote-btn--down'),
      hasSuggest: !!r.querySelector('.keeper__suggest-btn'),
      hasFollow:  !!r.querySelector('.keeper__follow-btn'),
    })));
    expect(summary.length).toBeGreaterThanOrEqual(2);
    for (const row of summary) {
      expect(row.hasUp).toBe(true);
      expect(row.hasDown).toBe(true);
      expect(row.hasFollow).toBe(true);
      expect(row.hasSuggest).toBe(true);
    }

    // And on a keeper's OWN row (themselves viewing the mosque), suggest
    // button must NOT appear.
    await keeper.page.goto(`${BASE_URL}/#mosque/${mosqueId}`, { waitUntil: 'domcontentloaded' });
    await waitVisible(keeper.page, '#drawer[aria-hidden="false"]');
    await keeper.page.waitForFunction(
      () => document.querySelectorAll('#keepers-list .keeper').length >= 1,
      { timeout: 5_000 }
    );
    const ownRow = await keeper.page.evaluate(() => {
      // Locate the row whose data-id matches the signed-in user — index 0
      // would be wrong if a higher-rated submitter sits above us.
      const myId = window.__jamatView?.me?.id;
      const r = document.querySelector(`#keepers-list .keeper[data-id="${myId}"]`);
      return r ? {
        found:      true,
        hasSuggest: !!r.querySelector('.keeper__suggest-btn'),
        hasUp:      !!r.querySelector('.keeper__vote-btn--up'),
      } : { found: false };
    });
    expect(ownRow.found).toBe(true);
    expect(ownRow.hasUp).toBe(true);          // votes still shown (backend rejects self-vote)
    expect(ownRow.hasSuggest).toBe(false);    // can't suggest to yourself

    await closePage(viewer.page);
    await closePage(otherKeeper.page);
    await closePage(keeper.page);
  });

  authTest('inbox shows old → new diff for prayers whose values changed', async () => {
    // Seed: keeper has Fajr=05:00 active. Suggester sends Fajr=05:16, Dhuhr=14:00.
    // Inbox row should render "Fajr: 5:00 am → 5:16 am" with the old struck.
    const { keeper, mosqueId } = await seedMosqueWithKeeper();
    const suggester = await newActor('diff-suggester');
    await suggester.page.evaluate(async (mid) => {
      const fromEmail = localStorage.getItem('jamat_dev_email');
      const base = window.JAMAT_CONFIG.apiBase;
      const k = await fetch(`${base}/mosques/${mid}/keepers`).then(r => r.json());
      const target = k.keepers[0];
      await fetch(`${base}/suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-User-Email': fromEmail },
        body: JSON.stringify({
          toUserId: target.submitterId,
          mosqueId: mid,
          timings: { fajr: '05:16', dhuhr: '14:00' },
          notes: 'Slight Fajr shift + new Dhuhr',
        }),
      });
    }, mosqueId);

    await keeper.page.reload({ waitUntil: 'domcontentloaded' });
    await waitVisible(keeper.page, '#inbox-banner');
    await tap(keeper.page, '#inbox-banner-btn');
    await waitVisible(keeper.page, '#inbox-modal[aria-hidden="false"]');

    const rowsByPrayer = await keeper.page.evaluate(() => {
      const out = {};
      for (const r of document.querySelectorAll('#inbox-list .inbox-row__time')) {
        const name = r.querySelector('.inbox-row__time-name')?.textContent?.trim().replace(':', '').toLowerCase();
        out[name] = {
          old: r.querySelector('.inbox-row__time-old')?.textContent?.trim() || null,
          new: r.querySelector('.inbox-row__time-new')?.textContent?.trim() || null,
          isChanged: r.classList.contains('is-changed'),
        };
      }
      return out;
    });

    // Fajr changed: old 05:00 → new 05:16 (in 12h format).
    const fajrKey = Object.keys(rowsByPrayer).find(k => /fajr|الفجر|فجر/i.test(k));
    expect(fajrKey).toBeDefined();
    const fajr = rowsByPrayer[fajrKey];
    expect(fajr.isChanged).toBe(true);
    expect(fajr.old).toMatch(/5:00\s*am/i);
    expect(fajr.new).toMatch(/5:16\s*am/i);

    // Dhuhr is new (suggested but no current value yet on this fresh mosque),
    // so it should NOT show "old →" — just the new value.
    const dhuhrKey = Object.keys(rowsByPrayer).find(k => /dhuhr|zuhr|الظهر|ظہر|ظهر/i.test(k));
    if (dhuhrKey) {
      const dhuhr = rowsByPrayer[dhuhrKey];
      expect(dhuhr.new).toMatch(/2:00\s*pm/i);
    }

    await closePage(keeper.page);
    await closePage(suggester.page);
  });

  authTest('accepting a suggestion immediately updates the mosque\'s active timings', async () => {
    const { keeper, mosqueId } = await seedMosqueWithKeeper();
    const suggester = await newActor('apply-suggester');
    await suggester.page.evaluate(async (mid) => {
      const fromEmail = localStorage.getItem('jamat_dev_email');
      const base = window.JAMAT_CONFIG.apiBase;
      const k = await fetch(`${base}/mosques/${mid}/keepers`).then(r => r.json());
      const target = k.keepers[0];
      await fetch(`${base}/suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-User-Email': fromEmail },
        body: JSON.stringify({
          toUserId: target.submitterId,
          mosqueId: mid,
          timings: { fajr: '05:16' },
        }),
      });
    }, mosqueId);

    // Capture the active fajr BEFORE accept.
    const before = await keeper.page.evaluate(async (mid) => {
      const email = localStorage.getItem('jamat_dev_email');
      const base = window.JAMAT_CONFIG.apiBase;
      const m = await fetch(`${base}/mosques/${mid}`, { headers: { 'X-Dev-User-Email': email } }).then(r => r.json());
      return m.prayerSchedules?.[0]?.timings?.fajr;
    }, mosqueId);
    expect(before).toBe('05:00'); // seedMosqueWithKeeper baseline

    await keeper.page.reload({ waitUntil: 'domcontentloaded' });
    await waitVisible(keeper.page, '#inbox-banner');
    await tap(keeper.page, '#inbox-banner-btn');
    await waitVisible(keeper.page, '#inbox-modal[aria-hidden="false"]');
    await keeper.page.evaluate(() => {
      document.querySelector('#inbox-list .inbox-row__actions button.btn--primary').click();
    });
    // Banner clears.
    await keeper.page.waitForFunction(
      () => document.getElementById('inbox-banner')?.hidden === true,
      { timeout: 5_000 }
    );

    const after = await keeper.page.evaluate(async (mid) => {
      const email = localStorage.getItem('jamat_dev_email');
      const base = window.JAMAT_CONFIG.apiBase;
      const m = await fetch(`${base}/mosques/${mid}`, { headers: { 'X-Dev-User-Email': email } }).then(r => r.json());
      return m.prayerSchedules?.[0]?.timings?.fajr;
    }, mosqueId);
    expect(after).toBe('05:16');

    await closePage(keeper.page);
    await closePage(suggester.page);
  });

  authTest('declining removes the suggestion from the inbox without creating a submission', async () => {
    const { keeper, mosqueId } = await seedMosqueWithKeeper();
    const suggester = await newActor('decline-suggester');

    // Send a suggestion via the API directly (modal flow already covered above).
    await suggester.page.evaluate(async (toEmail, mid) => {
      const fromEmail = localStorage.getItem('jamat_dev_email');
      const base = window.JAMAT_CONFIG.apiBase;
      // Look up the keeper's user id via the keepers endpoint.
      const k = await fetch(`${base}/mosques/${mid}/keepers`).then(r => r.json());
      const target = k.keepers.find(x => true); // only one keeper present
      await fetch(`${base}/suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-User-Email': fromEmail },
        body: JSON.stringify({
          toUserId: target.submitterId,
          mosqueId: mid,
          timings: { fajr: '06:00' },
          notes: 'Wrong times please re-check',
        }),
      });
    }, keeper.email, mosqueId);

    const subsBefore = await keeper.page.evaluate(async (mid) => {
      const email = localStorage.getItem('jamat_dev_email');
      const base = window.JAMAT_CONFIG.apiBase;
      const r = await fetch(`${base}/submissions?mosqueId=${mid}`, { headers: { 'X-Dev-User-Email': email } });
      return (await r.json()).data.length;
    }, mosqueId);

    await keeper.page.reload({ waitUntil: 'domcontentloaded' });
    await waitVisible(keeper.page, '#inbox-banner');
    await tap(keeper.page, '#inbox-banner-btn');
    await waitVisible(keeper.page, '#inbox-modal[aria-hidden="false"]');

    await keeper.page.evaluate(() => {
      const declineBtn = document.querySelector('#inbox-list .inbox-row__actions button.btn--ghost');
      declineBtn.click();
    });
    await keeper.page.waitForFunction(
      () => document.getElementById('inbox-banner')?.hidden === true,
      { timeout: 5_000 }
    );

    const subsAfter = await keeper.page.evaluate(async (mid) => {
      const email = localStorage.getItem('jamat_dev_email');
      const base = window.JAMAT_CONFIG.apiBase;
      const r = await fetch(`${base}/submissions?mosqueId=${mid}`, { headers: { 'X-Dev-User-Email': email } });
      return (await r.json()).data.length;
    }, mosqueId);
    expect(subsAfter).toBe(subsBefore);

    await closePage(keeper.page);
    await closePage(suggester.page);
  });
});
