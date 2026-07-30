// ═══════════════════════════════════════════════════════════════════
// Jamat — App
// Wires DOM, real geolocation, Leaflet map, default-mosque persistence,
// and a simple email-as-identity login (server uses dev-auth bypass).
// ═══════════════════════════════════════════════════════════════════

(() => {
  const R = window.JAMAT_RENDER;
  const $ = (sel) => document.querySelector(sel);
  const STORAGE_EMAIL = 'jamat_dev_email';

  // ───── DOM refs ─────
  const tabs = document.querySelectorAll('.dir-tab');
  const panels = {
    nearby: $('#list-nearby'),
    favorites: $('#list-favorites'),
  };
  const heroEls = {
    eyebrow: $('#next-eyebrow'),
    mosque: $('#next-mosque'),
    sub: $('#next-sub'),
    clock: $('#next-clock'),
    prayer: $('#next-prayer'),
    at: $('#next-at'),
    h: $('#cd-h'),
    m: $('#cd-m'),
    s: $('#cd-s'),
    change: $('#next-change'),
    navigate: $('#next-navigate'),
    locate: $('#next-locate'),
    refresh: $('#next-refresh'),
    allWrap: $('#next-all-wrap'),
    allCount: $('#next-all-count'),
    allList: $('#next-all-list'),
  };
  const qazaDrawer = $('#qaza-drawer');
  const qazaEls = {
    pill: $('#qaza-pill'),
    pillCount: $('#qaza-pill-count'),
    summary: $('#qaza-summary'),
    date: $('#qaza-date'),
    prayers: $('#qaza-prayers'),
    recordBtn: $('#qaza-record-btn'),
    todayBtn: $('#qaza-today-btn'),
    list: $('#qaza-list'),
    empty: $('#qaza-empty'),
    nextHint: $('#qaza-next-hint'),
  };
  const drawer = $('#drawer');
  const drawerEls = {
    status: $('#drawer-status'),
    title: $('#drawer-title'),
    addr: $('#drawer-addr'),
    distance: $('#drawer-distance'),
    renameBtn: $('#btn-rename-masjid'),
    times: document.querySelector('#drawer-times tbody'),
    timesUpdated: $('#drawer-times-updated'),
    stalePill: $('#stale-pill'),
    staleKeeperName: $('#stale-keeper-name'),
    staleNudgeBtn: $('#btn-open-nudge'),
    amenities: $('#drawer-amenities'),
    rateBtn: $('#btn-rate-masjid'),
    contributors: $('#drawer-contributors'),
    favoriteBtn: $('#btn-favorite'),
    navigateBtn: $('#btn-navigate'),
    setDefaultBtn: $('#btn-set-default'),
    editBtn: $('#btn-edit-mosque'),
    editForm: $('#edit-mosque-form'),
    editHint: $('#edit-mosque-hint'),
    editConfirm: $('#btn-edit-confirm'),
    editCancel: $('#btn-edit-cancel'),
    closeBtn: $('#btn-close-mosque'),
    reactivateBtn: $('#btn-reactivate-mosque'),
    submitToggleBtn: $('#btn-submit-update'),
    submitForm: $('#submit-form'),
    submitConfirm: $('#btn-submit-confirm'),
    submitCancel: $('#btn-submit-cancel'),
  };
  const ratingEls = {
    modal: $('#rating-modal'),
    target: $('#rating-target'),
    kind: $('#rating-kind'),
    stars: $('#rating-stars'),
    save: $('#rating-save'),
  };
  const nudgeEls = {
    sheet: $('#nudge-sheet'),
    list: $('#nudge-prayer-list'),
    summary: $('#nudge-summary'),
    count: $('#nudge-count'),
    avatar: $('#nudge-keeper-avatar'),
    keeperName: $('#nudge-keeper-name'),
    masjidName: $('#nudge-masjid-name'),
    sendBtn: $('#btn-send-nudge'),
    becomeBtn: $('#btn-nudge-become-keeper'),
  };
  const nudgeTimeEls = {
    popup: $('#nudge-time-popup'),
    title: $('#nudge-time-title'),
    current: $('#nudge-time-current'),
    input: $('#nudge-time-input'),
    applyBtn: $('#btn-nudge-time-apply'),
    clearBtn: $('#btn-nudge-time-clear'),
  };
  const authBtn = $('#auth-btn');
  const shareAppBtn = $('#share-app-btn');
  const accountMenu = $('#account-menu');
  const accountEmail = $('#account-email');
  const accountFollowersCount = $('#account-followers-count');
  const accountFollowersLabel = $('#account-followers-label');
  const accountLogout = $('#account-logout');
  const loginModal = $('#login-modal');
  const loginForm = $('#login-form');
  const mapview = $('#mapview');
  const QAZA_PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
  const QAZA_LABELS = { fajr: 'Fajr', dhuhr: 'Dhuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha' };
  const AMENITY_KINDS = ['size', 'wudu', 'washrooms', 'accessibility'];
  const AMENITY_LABELS = {
    size: 'Size',
    wudu: 'Wudu area',
    washrooms: 'Washrooms',
    accessibility: 'Accessibility',
  };
  const AMENITY_RATING_STORAGE = 'takbeer_amenity_ratings_v1';
  let qazaServerSyncInFlight = null;
  let qazaLastServerOwner = null;
  let pendingAmenityRating = 0;
  let nudgeState = { keeper: null, currentTimes: {}, proposed: {} };
  let nudgeEditingPrayer = null;

  // ───── State ─────
  // Exposed on window so e2e tests can introspect during diagnostics.
  // (No production code reads window.__jamatView.)
  window.__jamatView = null;
  const view = {
    activeTab: 'nearby',
    nearby: [],
    favorites: [],
    filter: '',
    selected: null,
    me: null,                // /users/me payload (incl. defaultMosque)
    defaultMosqueObj: null,  // hydrated mosque used for the hero
    countdownTimer: null,
    map: null,
    userMarker: null,
    mosqueMarkers: [],
    lastUserPos: null,    // remembered so map repaints (e.g. after add) can re-center
    addMode: false,       // true while user is dropping a pin to add a mosque
    pendingMarker: null,  // L.marker for the temp brass pin
    pendingPin: null,     // {lat,lng} of the temp pin
    addCaptcha: null,     // {id, question} for the server-side human check
    suppressNextHashChange: false, // avoid re-applying state when WE pushed it
  };
  window.__jamatView = view;

  // ───── Boot ─────
  document.addEventListener('DOMContentLoaded', async () => {
    // i18n must run BEFORE the rest so all the data-i18n strings get
    // their initial pass before app code starts toggling visibility.
    if (window.i18n) {
      await window.i18n.init();
      wireLangPicker();
    }
    renderAppVersion();
    refreshAuthBtn();
    // Skeleton on the hero until the first render lands. Avoids the brief
    // flash of "Find a masjid nearby" / placeholder copy on cold loads with
    // a slow network. renderHero() removes the class as soon as it paints
    // anything (real data OR a deliberate empty-state).
    document.querySelector('.next-card')?.classList.add('is-loading');
    wireHistory();
    wireTabs();
    wireSearch();
    wireDrawer();
    wireMasjidRating();
    wireNudgeSheet();
    wireQaza();
    wireLocate();
    wireMapToggle();
    wireLogin();
    wireShareApp();
    wireReminders();
    wireRefreshButton();
    wirePullToRefresh();
    wirePushUpdates();
    wireSuggestions();
    wireSunCard();
    wirePermissionRevocationBanner();
    wireAuthExpired();
    wireKeeperIntro();
    wirePledgeModal();
    renderQazaSummary();

    await loadProfile();
    await loadFavorites();
    await loadInitialList();
    hydrateDefaultMosque();
    refreshInbox();
    applyHashState();
  });

  async function renderAppVersion() {
    // Two surfaces show this: the footer (#app-version) on the home view,
    // and the login modal (#login-version) so users can read the version
    // on the very first screen they see — useful for support handoffs and
    // for telling Internal-track installs apart from Production.
    const targets = ['#app-version', '#login-version']
      .map(sel => $(sel))
      .filter(Boolean);
    if (!targets.length) return;

    try {
      const info = await window.Capacitor?.Plugins?.App?.getInfo?.();
      if (!info) return;

      const version = info.version || 'unknown';
      const build = info.build ? ` (${info.build})` : '';
      const text = `Version ${version}${build}`;
      for (const el of targets) {
        el.textContent = text;
        el.hidden = false;
      }
    } catch (err) {
      console.debug('Native app version unavailable:', err);
    }
  }

  // ─── History API: keep the back button INSIDE the app ───
  // Each overlay (map, drawer, login) pushes a hash state when it opens.
  // When the user hits the browser's back button, we close the topmost
  // overlay instead of leaving the site.
  function wireHistory() {
    window.addEventListener('popstate', () => {
      // popstate means the URL changed (back/forward). Re-derive UI state
      // from the URL — close any overlay that's no longer represented.
      applyHashState();
    });
    window.addEventListener('hashchange', () => {
      if (view.suppressNextHashChange) {
        view.suppressNextHashChange = false;
        return;
      }
      applyHashState();
    });
  }

  function pushHash(name, replace = false) {
    view.suppressNextHashChange = true;
    const url = name ? `#${name}` : location.pathname + location.search;
    if (replace) history.replaceState({ overlay: name }, '', url);
    else history.pushState({ overlay: name }, '', url);
  }

  // Read the current hash and reconcile the UI against it.
  // Does NOT push new history entries — only opens/closes overlays.
  function applyHashState() {
    const hash = location.hash.replace(/^#/, '');
    const isMap = hash === 'map' || hash.startsWith('mosque/');
    const mosqueId = hash.startsWith('mosque/') ? hash.slice('mosque/'.length) : null;
    const isLogin = hash === 'login';
    // #inbox is the deep-link target for the new-suggestion push (and
    // anywhere else that wants to open the inbox programmatically).
    const isInbox = hash === 'inbox';
    const isQaza = hash === 'qaza';

    // Map
    if (isMap && mapview.getAttribute('aria-hidden') !== 'false') {
      openMapInternal(view.lastUserPos);
    } else if (!isMap && mapview.getAttribute('aria-hidden') === 'false') {
      closeMapInternal();
    }

    // Drawer
    if (mosqueId && (!view.selected || view.selected.id !== mosqueId)) {
      openDetailInternal(mosqueId);
    } else if (!mosqueId && drawer.getAttribute('aria-hidden') === 'false') {
      closeDrawerInternal();
    }

    // Personal qaza drawer
    if (isQaza && qazaDrawer?.getAttribute('aria-hidden') !== 'false') {
      openQazaInternal();
    } else if (!isQaza && qazaDrawer?.getAttribute('aria-hidden') === 'false') {
      closeQazaInternal();
    }

    // Login
    if (isLogin && loginModal.getAttribute('aria-hidden') !== 'false') {
      openLoginInternal();
    } else if (!isLogin && loginModal.getAttribute('aria-hidden') === 'false') {
      closeLoginInternal();
    }

    // Inbox (suggestion deep-link). Refresh first so the latest suggestion
    // is rendered when the modal opens — the user just got a push for
    // something the local state may not know about yet.
    const inboxModal = document.getElementById('inbox-modal');
    if (isInbox && inboxModal && inboxModal.getAttribute('aria-hidden') !== 'false') {
      refreshInbox().finally(() => {
        if (typeof openInboxModal === 'function') openInboxModal();
      });
    } else if (!isInbox && inboxModal && inboxModal.getAttribute('aria-hidden') === 'false') {
      // Don't auto-close on hash change — user may have opened it via the
      // bell, then navigated. The X / Esc / [data-close-modal] handlers
      // own the close path.
    }
  }

  // ─── Auth ───
  function devAuthEnabled() {
    const flag = window.JAMAT_CONFIG?.devAuthEnabled;
    if (typeof flag === 'boolean') return flag;
    const h = window.location?.hostname || '';
    return h === 'localhost' || h === '127.0.0.1' || h === '' || h.endsWith('.local') || h.endsWith('.trycloudflare.com');
  }
  function hasStoredAppJwt() {
    try { return !!window.authExchange?.getStoredAppJwt?.(); } catch { return false; }
  }
  function getEmail() {
    const email = localStorage.getItem(STORAGE_EMAIL);
    if (!email) return null;
    // In production the mirrored email is only a display hint; a real
    // app JWT must also be present. Local dev can still use email-only
    // identity through the explicit dev-auth fallback.
    if (hasStoredAppJwt() || devAuthEnabled()) return email;
    return null;
  }
  function setEmail(e) {
    if (e) localStorage.setItem(STORAGE_EMAIL, e);
    else localStorage.removeItem(STORAGE_EMAIL);
  }

  function qazaOwnerKey() {
    return getEmail() || 'anonymous';
  }

  function isSignedInForServerSync() {
    return !!getEmail();
  }

  // ─── Local-first preferences (work without an account) ───
  // Anonymous / signed-out users can still pick a default mosque, set
  // reminders, etc. Their preferences live in localStorage on this device
  // only. Signing in is an *upgrade* that mirrors prefs to the server so
  // they sync across devices — it's not a gate for using the app.
  const STORAGE_LOCAL_DEFAULT = 'jamat.localDefaultMosqueId';
  function getLocalDefaultMosqueId() {
    return localStorage.getItem(STORAGE_LOCAL_DEFAULT);
  }
  function setLocalDefaultMosqueId(id) {
    if (id) localStorage.setItem(STORAGE_LOCAL_DEFAULT, id);
    else localStorage.removeItem(STORAGE_LOCAL_DEFAULT);
  }
  // Effective default. The server's defaultMosqueId is only trusted when
  // we *know* we're signed in (have an email in localStorage) — otherwise
  // it could be a leaked/cached server response (cookie auth, dev fallback,
  // proxy caching) and we'd mislabel a stranger's pick as "your default."
  // The localStorage value is always trusted: it's per-device.
  function effectiveDefaultMosqueId() {
    if (getEmail() && view.me?.defaultMosqueId) return view.me.defaultMosqueId;
    return getLocalDefaultMosqueId();
  }
  function userPickedDefault() {
    if (getEmail() && view.me?.defaultMosqueId) return true;
    if (getLocalDefaultMosqueId()) return true;
    return false;
  }

  // Gate for actions that write to other users' data on the server
  // (submitting times, suggesting updates, following keepers). These
  // change shared records, so they require an account. Reading mosques,
  // setting your own local default / reminders does NOT — those work
  // anonymously on this device.
  // Returns true if the user is signed-in (action can proceed).
  // Returns false if signed-out and shows the login modal — the caller
  // should bail out.
  // Pass `resumeAfterLogin` to continue the interrupted flow once sign-in
  // succeeds: the login modal sits on top of whatever screen the user was
  // on, so their form state survives, and the callback re-runs the action
  // they originally tapped instead of dumping them on a reset screen.
  function requireSignIn(actionLabel, resumeAfterLogin = null) {
    if (getEmail()) return true;
    view.pendingAuthAction = typeof resumeAfterLogin === 'function' ? resumeAfterLogin : null;
    toast(`Sign in to ${actionLabel}`);
    pushHash('login');
    openLoginInternal();
    return false;
  }

  // Return to the home base view (hero + directory list) from any overlay.
  // Used after actions that complete a journey — e.g. picking a default
  // masjid from the map or detail drawer — so the user lands back on the
  // screen that reflects the result instead of having to back out manually.
  function goHome() {
    closeDrawerInternal();
    closeMapInternal();
    if (location.hash) {
      // Collapse the current overlay's history entry rather than pushing a
      // new one, so pressing Back doesn't reopen the overlay we just closed.
      history.replaceState({ overlay: '' }, '', location.pathname + location.search);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function refreshAuthBtn() {
    const email = getEmail();
    const label = authBtn.querySelector('.auth-btn__label');
    const avatar = authBtn.querySelector('.auth-btn__avatar');
    const followers = authBtn.querySelector('.auth-btn__followers');
    if (email) {
      authBtn.dataset.state = 'signed-in';
      authBtn.setAttribute('aria-expanded', accountMenu && !accountMenu.hidden ? 'true' : 'false');
      authBtn.setAttribute('aria-controls', 'account-menu');
      authBtn.setAttribute('aria-label', window.i18n?.t('account.openAria') ?? 'Open account menu');
      label.textContent = email.split('@')[0];
      avatar.textContent = email[0]?.toUpperCase() || '·';
      const followerCount = Number(view.me?.timeKeeperFollowerCount) || 0;
      if (followers && followerCount > 0) {
        followers.hidden = false;
        followers.textContent = String(followerCount);
        followers.title = followerCount === 1 ? '1 follower' : `${followerCount} followers`;
        followers.setAttribute('aria-label', followers.title);
      } else if (followers) {
        followers.hidden = true;
        followers.textContent = '';
        followers.removeAttribute('aria-label');
        followers.removeAttribute('title');
      }
    } else {
      delete authBtn.dataset.state;
      authBtn.removeAttribute('aria-expanded');
      authBtn.removeAttribute('aria-controls');
      authBtn.setAttribute('aria-label', window.i18n?.t('auth.signIn') ?? 'Sign in');
      label.textContent = window.i18n?.t('auth.signIn') ?? 'Sign in';
      avatar.textContent = '?';
      if (followers) {
        followers.hidden = true;
        followers.textContent = '';
        followers.removeAttribute('aria-label');
        followers.removeAttribute('title');
      }
      closeAccountMenu();
    }
    refreshAccountMenu();
  }

  function wireKeeperIntro() {
    const modal = document.getElementById('keeper-intro-modal');
    if (!modal) return;
    const storageKey = 'takbeer_keeper_intro_seen_v2';
    const close = () => {
      modal.setAttribute('aria-hidden', 'true');
      try { localStorage.setItem(storageKey, 'true'); } catch {}
    };
    modal.querySelectorAll('[data-close-keeper-intro]').forEach(el => {
      el.addEventListener('click', close);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') close();
    });
    let seen = false;
    try { seen = localStorage.getItem(storageKey) === 'true'; } catch {}
    if (!seen) {
      setTimeout(() => modal.setAttribute('aria-hidden', 'false'), 650);
    }
  }

  function wireShareApp() {
    if (!shareAppBtn) return;
    shareAppBtn.addEventListener('click', async () => {
      const websiteUrl = 'http://takbeertime.com';
      const appUrl = 'https://play.google.com/store/apps/details?id=com.takbeertime.android';
      const title = window.i18n?.t('share.title') ?? 'Takbeer Time';
      const text = window.i18n?.t('share.message')
        ?? `Assalamu alaikum, I use Takbeer Time to find exact jamaat and Jummah times near masjids.\nWebsite: ${websiteUrl}\nInstall the app: ${appUrl}`;
      try {
        if (navigator.share) {
          await navigator.share({ title, text });
          return;
        }
      } catch (err) {
        if (err?.name === 'AbortError') return;
      }
      const messageParts = [text];
      if (!text.includes(websiteUrl)) messageParts.push(websiteUrl);
      if (!text.includes(appUrl)) messageParts.push(appUrl);
      const message = messageParts.join('\n');
      const target = `https://wa.me/?text=${encodeURIComponent(message)}`;
      const opened = window.open(target, '_blank', 'noopener,noreferrer');
      if (!opened) window.location.href = target;
    });
  }

  function refreshAccountMenu() {
    if (!accountMenu) return;
    const email = getEmail();
    const followerCount = Number(view.me?.timeKeeperFollowerCount) || 0;
    if (accountEmail) accountEmail.textContent = email || '';
    if (accountFollowersCount) accountFollowersCount.textContent = String(followerCount);
    if (accountFollowersLabel) {
      accountFollowersLabel.textContent = followerCount === 1
        ? (window.i18n?.t('account.follower') ?? 'follower')
        : (window.i18n?.t('account.followers') ?? 'followers');
    }
  }

  function openAccountMenu() {
    if (!accountMenu || !getEmail()) return;
    refreshAccountMenu();
    accountMenu.hidden = false;
    authBtn.setAttribute('aria-expanded', 'true');
  }

  function closeAccountMenu() {
    if (!accountMenu) return;
    accountMenu.hidden = true;
    if (authBtn?.dataset?.state === 'signed-in') authBtn.setAttribute('aria-expanded', 'false');
  }

  function toggleAccountMenu() {
    if (!accountMenu) return;
    if (accountMenu.hidden) openAccountMenu();
    else closeAccountMenu();
  }

  async function signOutCurrentUser() {
    const wasEmail = getEmail();
    closeAccountMenu();
    // Drop FCM topic subscriptions before clearing identity. Without this,
    // the device keeps receiving keeper-update pushes for the signed-out user.
    window.takbeerPush?.unsubscribeAll?.().catch(() => {});
    window.authExchange?.clearStoredAppJwt?.();
    await window.auth?.signOut?.().catch(() => {});
    setEmail(null);
    view.me = null;
    refreshAuthBtn();
    renderQazaDrawer();
    renderQazaSummary();
    refreshQazaFromServer();
    await loadProfile().then(loadFavorites).then(renderActivePanel);
    hydrateDefaultMosque();
    toast(window.i18n?.t('toast.signedOut') ?? (wasEmail ? `Signed out ${wasEmail}` : 'Signed out'));
  }

  // Listen for the api.js "your token went stale" signal. This fires
  // when a 401 comes back from a request that DID carry a bearer token
  // (token expired, account soft-deleted server-side, secret rotated).
  // api.js already wiped the token+user from localStorage; we just need
  // to refresh the UI so the auth button stops claiming we're signed in
  // and the next protected action prompts the login modal.
  function wireAuthExpired() {
    let lastToastAt = 0;
    window.addEventListener('jamat:auth-expired', () => {
      try { setEmail(null); } catch {}
      try { refreshAuthBtn(); } catch {}
      try { renderQazaDrawer(); renderQazaSummary(); } catch {}
      // Throttle the toast so a burst of parallel 401s (favorites +
      // notifications + profile firing on boot) doesn't spam the user.
      const now = Date.now();
      if (now - lastToastAt > 5000) {
        lastToastAt = now;
        toast(window.i18n?.t('toast.sessionExpired') ?? 'Your session expired. Please sign in again.');
      }
    });
  }

  function wireLogin() {
    const canUseDevAuth = devAuthEnabled();
    const passwordInput = loginForm.elements['password'];
    const passwordHint = loginForm.querySelector('.login-form__hint');
    if (passwordInput) {
      passwordInput.required = !canUseDevAuth;
    }
    if (passwordHint && !canUseDevAuth) {
      passwordHint.textContent = window.i18n?.t('login.passwordHintProd') ?? 'Use your password, or continue with Google if available.';
    }

    authBtn.addEventListener('click', () => {
      if (getEmail()) {
        toggleAccountMenu();
        return;
      }
      pushHash('login');
      openLoginInternal();
    });

    accountLogout?.addEventListener('click', () => {
      signOutCurrentUser().catch((err) => toast(`Sign-out error: ${err.message || err}`));
    });

    document.addEventListener('click', (e) => {
      if (!accountMenu || accountMenu.hidden) return;
      const target = e.target;
      if (accountMenu.contains(target) || authBtn.contains(target)) return;
      closeAccountMenu();
    });

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(loginForm);
      const email = fd.get('email')?.toString().trim().toLowerCase();
      const password = fd.get('password')?.toString() || '';
      if (!email) return;

      // Three sign-in modes, in order of preference:
      //   1. email + password → /api/auth/login (existing account) with
      //      auto-fallback to /api/auth/register on 401 (server returns
      //      identical 401 for "wrong password" vs "no such user", so we
      //      try register only when the user typed a strong-enough
      //      password — minlength=8 on the input enforces this).
      //   2. email only → local/dev-auth flow. We just stash the email
      //      and rely on the X-Dev-User-Email header (api.js handles it)
      //      when the client and server are both configured for dev-auth.
      //   3. Google sign-in → see handleGoogleSignIn() below; doesn't
      //      go through this form.
      try {
        if (password) {
          const exch = window.authExchange;
          if (!exch) throw new Error('Auth exchange module not loaded');
          let res;
          try {
            res = await api.authLogin(email, password);
          } catch (err) {
            // Treat "Invalid email or password" as either wrong credentials
            // OR a brand-new account; try register, which 409s if the
            // account already exists (genuine wrong-password case).
            if (err.status === 401) {
              try {
                res = await api.authRegister(email, password);
              } catch (err2) {
                if (err2.status === 409) {
                  toast('That email already has an account. Check your password and try again.');
                  return;
                }
                throw err2;
              }
            } else {
              throw err;
            }
          }
          // /auth/login + /auth/register both return { token, user }.
          // Persist the JWT so subsequent api.js requests carry it.
          exch.storeAppJwt(res.token, res.user);
          setEmail(res.user.email);
        } else {
          if (!canUseDevAuth) {
            toast(window.i18n?.t('login.passwordRequired') ?? 'Enter your password to sign in.');
            return;
          }
          // Email-only fallback (local/dev-auth path).
          setEmail(email);
        }
        await afterSignIn(email);
      } catch (err) {
        toast(`Sign-in error: ${err.message || 'unknown'}`);
      }
    });

    // Google sign-in button. Hidden unless Firebase web config is filled
    // in (config.js → JAMAT_CONFIG.firebase). When visible, clicking it:
    //   1. opens the Firebase popup (handled by js/auth.js)
    //   2. exchanges the resulting Firebase ID token for our app JWT via
    //      POST /api/auth/google (handled by js/auth-exchange.js)
    //   3. mirrors the email into local state so the rest of the app
    //      (auth-btn label, dev-auth header for endpoints not yet behind
    //      the JWT, getEmail() checks) keeps working unchanged.
    const googleBtn = document.getElementById('login-google');
    const loginDivider = document.getElementById('login-divider');
    if (googleBtn) {
      const fbConfigured = !!window.auth?.isConfigured?.();
      googleBtn.hidden = !fbConfigured;
      if (loginDivider) loginDivider.hidden = !fbConfigured;
      googleBtn.addEventListener('click', handleGoogleSignIn);
    }

    document.querySelectorAll('[data-close-modal]').forEach(el =>
      el.addEventListener('click', closeLogin)
    );
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && accountMenu && !accountMenu.hidden) closeAccountMenu();
      if (e.key === 'Escape' && loginModal.getAttribute('aria-hidden') === 'false') closeLogin();
    });
  }

  async function handleGoogleSignIn() {
    if (!window.auth?.signInWithGoogle || !window.authExchange?.exchangeFirebaseToken) {
      toast('Google sign-in is not available');
      return;
    }
    const btn = document.getElementById('login-google');
    if (btn) btn.disabled = true;
    try {
      const credential = await window.auth.signInWithGoogle();
      // Firebase popup result has .user with getIdToken().
      const idToken = await credential.user.getIdToken();
      const data = await window.authExchange.exchangeFirebaseToken(idToken);
      // Mirror the email into the existing dev-auth slot so getEmail()
      // and the auth-btn UI both keep working without a refactor. The
      // app JWT in localStorage is what api.js actually sends.
      setEmail(data.user.email);
      await afterSignIn(data.user.email);
    } catch (err) {
      // Cancellation isn't an error — the user just dismissed the picker.
      // Web (Firebase JS SDK popup) uses err.code; native (Capacitor
      // Firebase Authentication plugin → Android Credentials Manager)
      // surfaces it via err.message containing "cancel" (no code).
      const code = err?.code || '';
      const msg = String(err?.message || err || '');
      if (
        code === 'auth/popup-closed-by-user' ||
        code === 'auth/cancelled-popup-request' ||
        /cancel(l)?ed|canceled|cancelled/i.test(msg)
      ) return;
      if (/not registered to use OAuth2\.0|package name and SHA-1/i.test(msg)) {
        console.error('Google sign-in Android OAuth configuration failed:', err);
        toast('Google sign-in is not configured for this Android build. Add this app signing SHA-1 in Firebase and reinstall.');
        return;
      }
      toast(`Google sign-in failed: ${err?.message || err}`);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // Shared post-auth sequence for every sign-in path (email+password,
  // dev email-only, Google). Syncs local state with the account, then
  // resumes the action that triggered the sign-in gate (if any) so the
  // user continues exactly where they left off — same screen, same form
  // values — instead of being dropped back on a reset view.
  async function afterSignIn(email) {
    // Capture the interrupted action BEFORE closing the modal: the close
    // path clears view.pendingAuthAction (that's the user-cancel path).
    const resume = view.pendingAuthAction;
    view.pendingAuthAction = null;
    refreshAuthBtn();
    migrateAnonymousQazaToOwner();
    renderQazaDrawer();
    renderQazaSummary();
    refreshQazaFromServer();
    closeLogin();
    await loadProfile();
    await loadFavorites();
    renderActivePanel();
    hydrateDefaultMosque();
    toast(window.i18n?.t('toast.signedIn', { name: email }) ?? `Signed in as ${email}`);
    if (resume) {
      try { await resume(); } catch { /* the action surfaces its own errors */ }
    }
  }

  function openLoginInternal() {
    loginModal.setAttribute('aria-hidden', 'false');
    setTimeout(() => loginForm.querySelector('input')?.focus(), 60);
  }
  function closeLoginInternal() {
    loginModal.setAttribute('aria-hidden', 'true');
    // Closing without signing in abandons the interrupted action — don't
    // let it fire on a later, unrelated sign-in.
    view.pendingAuthAction = null;
  }
  function closeLogin() {
    if (location.hash === '#login') history.back();
    else closeLoginInternal();
  }

  // ─── Data loading ───
  async function loadProfile() {
    // Don't make /users/me calls when we don't have credentials. The server
    // *should* 401 anonymous calls but a misconfigured server / proxy /
    // cache could return another user's data. Belt-and-braces: if we
    // know we're not signed in, skip the call entirely and force view.me
    // to null. The signed-out UI then has no chance of showing leaked
    // user data.
    if (!getEmail()) {
      view.me = null;
      refreshAuthBtn();
      return;
    }
    try {
      view.me = await api.getMyProfile();
      refreshAuthBtn();
      // Reminder prefs live server-side under notificationPreferences.reminderPrefs
      // so the same user on a second browser inherits the same config.
      // Server is the source of truth; we hydrate localStorage on sign-in.
      const np = view.me?.notificationPreferences;
      if (np && typeof np === 'object' && np.reminderPrefs && window.reminders?.hydrateFromServer) {
        window.reminders.hydrateFromServer(np.reminderPrefs);
      }
      // Subscribe this device to the user's per-account inbox topic so
      // server-side notifyOnSuggest pushes actually land. Use the
      // permitted-only variant: if the user hasn't granted notification
      // permission yet, queue the topic and subscribe once they grant
      // (typically via a Follow tap). This preserves the "ask only when
      // the value is obvious" rule — signin alone won't prompt.
      // No-op in the browser shell (takbeerPush is only installed by
      // native-bridge in the Capacitor wrapper).
      if (view.me?.id) {
        ensureInboxPushSubscription({ prompt: false }).catch(() => {});
      }
    } catch {
      view.me = null;
      refreshAuthBtn();
    }
  }

  async function loadFavorites() {
    // Skip /favorites for signed-out users — they have no account so
    // there's nothing to fetch. Same defensive pattern as loadProfile.
    if (!getEmail()) {
      view.favorites = [];
      return;
    }
    try {
      const list = await api.listFavorites();
      view.favorites = (list || []).filter(m => !R.isTestFixture(m));
    } catch { view.favorites = []; }
  }

  async function loadInitialList() {
    try {
      // Small preview only — this list is unfiltered (no geo context yet),
      // so 50 entries is mostly noise to a user who hasn't tapped "Find
      // masjids near me". Show ~10 as a directory teaser; the locate flow
      // replaces this with the real geo-bounded set.
      const res = await api.listMosques({ limit: 10 });
      // Hide automated-test fixtures (e.g. "E2E Test Masjid …") that
      // leak from the test DB into the user-visible list.
      view.nearby = (res.data || []).filter(m => !R.isTestFixture(m));
      renderActivePanel();
    } catch (err) {
      toast(`Couldn't load masjids: ${err.message}`);
    }
  }

  // After mosques + profile are loaded, find the user's default and use it
  // for the hero. If none chosen, fall back to first nearby with timings.
  async function hydrateDefaultMosque() {
    // Effective default: server choice (when signed-in) takes priority,
    // then the device's localStorage choice (works for signed-out users
    // who picked a mosque on this device). Only fall through to "nearest
    // with timings" when the user has explicitly chosen nothing.
    const defaultId = effectiveDefaultMosqueId();
    const signedInServerDefaultId = getEmail() && view.me?.defaultMosqueId
      ? view.me.defaultMosqueId
      : null;
    if (signedInServerDefaultId && view.defaultMosqueObj?.id !== signedInServerDefaultId) {
      view.defaultMosqueObj = null;
      renderHero();
      renderActivePanel();
    }
    let m = null;
    if (defaultId) {
      // Paint from the on-device cache first so the hero renders the
      // user's masjid times immediately, even on a cold page load with
      // a slow network. The fresh fetch below replaces it if the
      // server returns something better.
      const cached = storage.getMosqueCache?.(defaultId);
      if (cached) {
        view.defaultMosqueObj = cached;
        renderHero();
        renderActivePanel();
      }
      m = view.nearby.find(x => x.id === defaultId)
        || view.favorites.find(x => x.id === defaultId);
      if (!m || (!R.timingsFromMosque(m) && !m.effectiveTimings)) {
        try { m = await api.getMosque(defaultId); } catch {}
      }
    }
    if (!m && !defaultId) {
      m = view.favorites.find(x => R.timingsFromMosque(x))
        || view.nearby.find(x => R.timingsFromMosque(x));
    }
    // Only replace what we already painted from cache if the new
    // candidate actually has timings — otherwise a partial response
    // (e.g. /favorites without schedules) would clear the hero.
    if (m && (R.timingsFromMosque(m) || m.effectiveTimings)) {
      const needsDetail = !Object.prototype.hasOwnProperty.call(m, 'effectiveTimings')
        || !Object.prototype.hasOwnProperty.call(m, 'effectiveKeeperName')
        || !Object.prototype.hasOwnProperty.call(m, 'effectiveKeeperId');
      if (needsDetail) {
        try { m = { ...m, ...(await api.getMosque(m.id)) }; } catch {}
      }
      view.defaultMosqueObj = m;
    } else if (!view.defaultMosqueObj) {
      view.defaultMosqueObj = m || null;
    }
    renderHero();
    renderActivePanel(); // re-mark default card
  }

  // ─── Hero ───
  function scheduleDefaultMosqueReminders() {
    const m = view.defaultMosqueObj;
    const timings = m ? R.timingsFromMosque(m) : null;
    if (!timings || !window.reminders) return [];
    const scheduled = window.reminders.schedule(timings, m?.name || 'your masjid');
    refreshReminderUi();
    return scheduled || [];
  }

  function renderHero() {
    // First paint always clears the skeleton — empty-state copy is
    // legitimate content (signed-out user prompted to find a mosque),
    // not a "still loading" state.
    const card = document.querySelector('.next-card');
    if (card) card.classList.remove('is-loading');
    const m = view.defaultMosqueObj;
    if (!m) {
      card?.classList.remove('is-closed');
      // Two empty-state shapes to keep the eyebrow and body coherent:
      //  - Signed-in (no default picked): "YOUR DEFAULT MOSQUE / No mosque
      //    selected yet — tap one and Make this my default."
      //  - Signed-out (no data yet): "FIND A MOSQUE / Tap 'Find mosques
      //    near me' below to see your local options."
      // Without this, the eyebrow said "SHOWING NEAREST MOSQUE" while the
      // body said "no mosque selected yet" — contradictory.
      const signedIn = !!getEmail();
      if (signedIn) {
        heroEls.eyebrow.textContent = window.i18n?.t('next.eyebrow') ?? 'Your default masjid';
        heroEls.mosque.textContent = window.i18n?.t('next.empty') ?? 'No masjid selected yet';
        heroEls.sub.textContent = window.i18n?.t('next.emptyHint') ?? 'Tap a masjid below and choose “Make this my default”.';
      } else {
        heroEls.eyebrow.textContent = window.i18n?.t('next.eyebrowNearest') ?? 'Showing nearest masjid';
        heroEls.mosque.textContent = window.i18n?.t('next.emptyAnonName') ?? 'Find a masjid nearby';
        heroEls.sub.textContent = window.i18n?.t('next.emptyAnonHint') ?? 'Tap “Find masjids near me” below to see your local options.';
      }
      heroEls.clock.hidden = true;
      heroEls.change.hidden = true;
      if (heroEls.navigate) heroEls.navigate.hidden = true;
      if (heroEls.locate) heroEls.locate.hidden = false;
      if (heroEls.refresh) heroEls.refresh.hidden = true;
      if (heroEls.allWrap) heroEls.allWrap.hidden = true;
      document.getElementById('next-keeper')?.setAttribute('hidden', '');
      renderQazaSummary();
      stopCountdown();
      return;
    }

    // Only call it "your default" if the user is actually signed in AND
    // they explicitly picked one. The server can return user data even
    // when we don't think we're authenticated (cookie, dev fallback,
    // cached identity), so gate on the *client's* known auth state too.
    // Without this, signed-out users saw "YOUR DEFAULT MOSQUE" labelled
    // over a nearby mosque, which makes it look like they share an
    // account globally.
    // "User picked it" includes both a server-side default (signed-in)
    // and a localStorage default (signed-out, device-only). Either way
    // it's the user's choice, so the eyebrow says "Your default mosque".
    const isFromUserChoice = userPickedDefault();
    const isClosed = m.status === 'closed';
    card?.classList.toggle('is-closed', isClosed);
    heroEls.eyebrow.textContent = window.i18n?.t(isFromUserChoice ? 'next.eyebrow' : 'next.eyebrowNearest')
      ?? (isFromUserChoice ? 'Your default masjid' : 'Showing nearest masjid');
    heroEls.mosque.textContent = R.prettifyMosqueName(m.name);
    if (isClosed) {
      heroEls.sub.textContent = 'Shown as permanently closed. You can still review time keepers, vote, and choose a trusted keeper if the community needs to correct this.';
    } else {
      renderLocation(heroEls.sub, [m.city, m.country]);
    }
    const navTarget = navigationTarget(m);
    if (heroEls.navigate) {
      heroEls.navigate.hidden = !navTarget;
      if (navTarget) {
        heroEls.navigate.onclick = () => openNavigation(m);
        heroEls.navigate.setAttribute('aria-label',
          window.i18n?.t('nav.navigateTo', { name: R.prettifyMosqueName(m.name) })
            ?? `Open directions to ${R.prettifyMosqueName(m.name)} in Google Maps`);
      }
    }
    if (heroEls.locate) heroEls.locate.hidden = true;
    // The fallback button is shown only when no keeper line is rendered;
    // when there IS a keeper, that whole line becomes the tap target
    // (see the keeper-line setup further down). Both routes call
    // openDetail() — same drawer, same actions, just different anchors.
    heroEls.change.onclick = () => openDetail(m.id);
    if (heroEls.refresh) heroEls.refresh.hidden = false;

    const timings = R.timingsFromMosque(m);
    const next = isClosed ? null : R.computeNextPrayer(timings);
    if (next) {
      heroEls.clock.hidden = false;
      setHeroNextLabel(next);
      // Pass `timings` (not the static `next`) so the countdown's tick
      // can re-run computeNextPrayer when a prayer time passes — Maghrib
      // becomes "next" after Asr passes, instead of the countdown rolling
      // Asr forward 24h.
      startCountdown(timings);
      // Keep a rolling queue of reminders for the default mosque.
      scheduleDefaultMosqueReminders();
    } else {
      heroEls.clock.hidden = true;
      heroEls.sub.textContent = window.i18n?.t('next.noTimes') ?? 'No timings recorded yet — be the first to submit.';
      stopCountdown();
      window.reminders?.cancel();
      refreshReminderUi();
    }

    renderAllTimingsDropdown(timings, next);

    // Show whose times are powering the countdown — keeper credit on hero.
    // The line is a <button> that opens the detail drawer (see other
    // keepers, switch preferred, suggest times). When no keeper exists
    // the line stays hidden and the standalone "See time keepers"
    // fallback in the header takes its place.
    const keeperEl = document.getElementById('next-keeper');
    const keeperNameEl = document.getElementById('next-keeper-name');
    const keeperHintEl = document.getElementById('next-keeper-hint');
    if (keeperEl && m.effectiveKeeperName) {
      keeperEl.hidden = false;
      keeperEl.onclick = () => openDetail(m.id);
      keeperNameEl.textContent = R.prettifyPersonName(m.effectiveKeeperName);
      keeperHintEl.textContent = keeperSourceHint(m);
      // Keeper line is the primary tap target; hide the fallback button.
      heroEls.change.hidden = true;
    } else if (keeperEl) {
      keeperEl.hidden = true;
      // No keeper line → expose the fallback so the user still has a way
      // into the detail drawer.
      heroEls.change.hidden = false;
    }

    renderQazaSummary(next);
  }

  // Populate the always-visible "all takbeer times" panel under the hero clock.
  // Hidden only when the mosque has no timings at all.
  function renderAllTimingsDropdown(timings, next) {
    if (!heroEls.allWrap || !heroEls.allList) return;
    if (!timings) { heroEls.allWrap.hidden = true; return; }

    // Mirror the drawer's renderTimingsTable ordering exactly so the two
    // surfaces never disagree: on Friday Jummah replaces Dhuhr; on other
    // days Jummah is appended as a traveller row when the masjid has one.
    const todaysOrder = typeof R.prayerOrderForDate === 'function'
      ? R.prayerOrderForDate(new Date(), timings)
      : ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
    const order = todaysOrder.includes('jummah')
      ? todaysOrder
      : [...todaysOrder, ...(R.timingForPrayer(timings, 'jummah') ? ['jummah'] : [])];
    const sunWindows = sunWindowsForMosque(view.defaultMosqueObj);
    const rows = order.map(key => {
      const t = timings[key === 'dhuhr' ? 'zuhr' : key] || timings[key];
      if (!t) return null;
      const isNext = next && next.key === key;
      const win = sunWindows?.[key] || {};
      const nameChildren = [window.i18n?.t(`prayer.${key}`) ?? R.PRAYER_LABEL[key]];
      if (isNext) {
        nameChildren.push(R.el('span', { class: 'next-card__all-next-tag' }, window.i18n?.t('next.tag') ?? 'Next'));
      }
      return R.el('li', { class: 'next-card__all-row' + (isNext ? ' is-next' : '') }, [
        R.el('span', { class: 'next-card__all-name' }, nameChildren),
        R.el('span', { class: 'next-card__jamat' }, R.fmt12(Array.isArray(t) ? t[0] : t)),
        R.el('span', { class: 'next-card__sun next-card__sun--starts' }, win.start ? R.fmt12(win.start) : '—'),
        R.el('span', { class: 'next-card__sun next-card__sun--ends' }, win.end ? R.fmt12(win.end) : '—'),
      ]);
    }).filter(Boolean);

    if (rows.length === 0) { heroEls.allWrap.hidden = true; return; }

    heroEls.allWrap.hidden = false;
    heroEls.allList.hidden = false;
    if (heroEls.allCount) {
      heroEls.allCount.textContent = `${rows.length} ${window.i18n?.t('next.prayersWord') ?? 'prayers'}`;
    }
    heroEls.allList.innerHTML = '';
    rows.forEach(r => heroEls.allList.appendChild(r));
  }

  function sunWindowsForMosque(mosque) {
    if (!mosque || !window.sun?.prayerTimesForCoords) return null;
    const lat = mosque.coordinates?.lat ?? mosque.latitude;
    const lng = mosque.coordinates?.lng ?? mosque.longitude;
    if (!Number.isFinite(+lat) || !Number.isFinite(+lng)) return null;
    const fiqh = localStorage.getItem(SUN_FIQH_KEY) || DEFAULT_SUN_FIQH;
    const today = window.sun.prayerTimesForCoords(+lat, +lng, fiqh);
    if (!today) return null;
    let nextDay = null;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    try { nextDay = window.sun.prayerTimesForCoords(+lat, +lng, fiqh, tomorrow); } catch {}
    return {
      fajr: { start: today.fajr, end: today.sunrise },
      dhuhr: { start: today.dhuhr, end: today.asr },
      asr: { start: today.asr, end: today.maghrib },
      maghrib: { start: today.maghrib, end: today.isha },
      // Isha lasts until the NEXT day's Fajr. If tomorrow's Fajr can't be
      // computed (e.g. high-latitude polar dates where the angle has no
      // solution), leave the end blank ("—") rather than falling back to
      // *today's* morning Fajr, which would render an end ~16h before start.
      isha: { start: today.isha, end: nextDay?.fajr || null },
      jummah: { start: today.dhuhr, end: today.asr },
    };
  }

  // ─── Qaza namaz ────────────────────────────────────────────────
  function wireQaza() {
    if (!qazaDrawer || !qazaEls.pill) return;
    qazaEls.date.value = localDateInputValue(new Date());
    renderQazaPrayerButtons();
    qazaEls.pill.addEventListener('click', openQaza);
    qazaEls.todayBtn?.addEventListener('click', () => {
      qazaEls.date.value = localDateInputValue(new Date());
      clearQazaPrayerSelection();
    });
    qazaEls.recordBtn?.addEventListener('click', recordSelectedQaza);
    document.querySelectorAll('[data-close-qaza]').forEach(el =>
      el.addEventListener('click', closeQaza)
    );
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && qazaDrawer.getAttribute('aria-hidden') === 'false') closeQaza();
    });
    // Fold in any guest rows left under 'anonymous' when booting already
    // signed in (e.g. recorded as a guest, closed the app before the first
    // post-sign-in sync, reopened with a persisted session).
    migrateAnonymousQazaToOwner();
    renderQazaDrawer();
    refreshQazaFromServer();
  }

  function openQaza() {
    if (location.hash !== '#qaza') pushHash('qaza');
    openQazaInternal();
  }

  function openQazaInternal() {
    if (!qazaDrawer) return;
    renderQazaDrawer();
    refreshQazaFromServer();
    qazaDrawer.setAttribute('aria-hidden', 'false');
    qazaEls.pill?.setAttribute('aria-expanded', 'true');
    setTimeout(() => qazaEls.date?.focus(), 120);
  }

  function closeQaza() {
    if (location.hash === '#qaza') pushHash('', true);
    closeQazaInternal();
  }

  function closeQazaInternal() {
    if (!qazaDrawer) return;
    qazaDrawer.setAttribute('aria-hidden', 'true');
    qazaEls.pill?.setAttribute('aria-expanded', 'false');
  }

  function renderQazaPrayerButtons() {
    if (!qazaEls.prayers) return;
    qazaEls.prayers.innerHTML = '';
    QAZA_PRAYERS.forEach((key) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'qaza-prayer';
      btn.dataset.prayer = key;
      btn.setAttribute('aria-pressed', 'false');
      btn.textContent = QAZA_LABELS[key];
      btn.addEventListener('click', () => {
        const selected = btn.getAttribute('aria-pressed') !== 'true';
        btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
      });
      qazaEls.prayers.appendChild(btn);
    });
  }

  function clearQazaPrayerSelection() {
    qazaEls.prayers?.querySelectorAll('.qaza-prayer[aria-pressed="true"]').forEach(btn => {
      btn.setAttribute('aria-pressed', 'false');
    });
  }

  async function recordSelectedQaza() {
    const date = qazaEls.date?.value || localDateInputValue(new Date());
    const selected = Array.from(qazaEls.prayers?.querySelectorAll('.qaza-prayer[aria-pressed="true"]') || [])
      .map(btn => btn.dataset.prayer)
      .filter(Boolean);
    if (!selected.length) {
      toast('Select at least one namaz to record as qaza.');
      return;
    }

    const now = new Date().toISOString();
    const records = storage.getQazaRecords(qazaOwnerKey());
    const addedRows = [];
    let added = 0;
    selected.forEach((prayer) => {
      const alreadyOpen = records.some(r => r.date === date && r.prayer === prayer && !r.prayedAt);
      if (alreadyOpen) return;
      const row = {
        id: `${date}:${prayer}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        clientId: `${date}:${prayer}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        date,
        prayer,
        recordedAt: now,
        prayedAt: null,
      };
      records.push(row);
      addedRows.push(row);
      added += 1;
    });

    storage.saveQazaRecords(records, qazaOwnerKey());
    clearQazaPrayerSelection();
    renderQazaDrawer();
    renderQazaSummary();
    toast(added
      ? `Recorded ${added} qaza namaz.`
      : 'Those qaza namaz are already pending.');
    if (addedRows.length) {
      await pushQazaRowsToServer(addedRows);
      refreshQazaFromServer({ syncLocal: false });
    }
  }

  async function markQazaPrayed(id) {
    const records = storage.getQazaRecords(qazaOwnerKey());
    const row = records.find(r => r.id === id);
    if (!row) return;
    const prayedAt = new Date().toISOString();
    row.prayedAt = prayedAt;
    storage.saveQazaRecords(records, qazaOwnerKey());
    renderQazaDrawer();
    renderQazaSummary();
    toast(`${QAZA_LABELS[row.prayer] || 'Namaz'} marked prayed.`);
    if (!isSignedInForServerSync() || !window.api?.markQazaRecordPrayed) return;
    try {
      if (isUuid(row.id)) {
        await api.markQazaRecordPrayed(row.id, prayedAt);
      } else {
        await pushQazaRowsToServer([row]);
      }
      refreshQazaFromServer({ syncLocal: false });
    } catch (err) {
      console.warn('Could not sync qaza prayed state yet', err);
    }
  }

  function openQazaRecords() {
    return storage.getQazaRecords(qazaOwnerKey())
      .filter(r => r && r.date && r.prayer && !r.prayedAt)
      .sort((a, b) => {
        const byDate = String(a.date).localeCompare(String(b.date));
        if (byDate) return byDate;
        return QAZA_PRAYERS.indexOf(a.prayer) - QAZA_PRAYERS.indexOf(b.prayer);
      });
  }

  function normalizeQazaRecord(row) {
    const id = row.id || row.clientId;
    return {
      id,
      clientId: row.clientId || id,
      date: row.date,
      prayer: row.prayer,
      recordedAt: row.recordedAt || new Date().toISOString(),
      prayedAt: row.prayedAt || null,
    };
  }

  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
  }

  async function pushQazaRowsToServer(rows) {
    if (!isSignedInForServerSync() || !window.api?.createQazaRecord) return false;
    const validRows = rows
      .map(normalizeQazaRecord)
      .filter(r => r.date && QAZA_PRAYERS.includes(r.prayer));
    for (const row of validRows) {
      await api.createQazaRecord({
        date: row.date,
        prayer: row.prayer,
        clientId: row.clientId || row.id,
        recordedAt: row.recordedAt,
        prayedAt: row.prayedAt || null,
      });
    }
    return true;
  }

  // Merge qaza rows, de-duplicating by clientId/id and (for still-open rows)
  // by date+prayer — mirroring the "one open row per date+prayer" rule in
  // recordSelectedQaza so a migrated guest row never doubles up an account row.
  function mergeQazaRecords(base, incoming) {
    const out = (base || []).map(normalizeQazaRecord);
    const ids = new Set(out.map(r => r.clientId || r.id));
    const openByDatePrayer = new Set(
      out.filter(r => !r.prayedAt).map(r => `${r.date}:${r.prayer}`)
    );
    for (const raw of incoming || []) {
      const r = normalizeQazaRecord(raw);
      if (!r.date || !QAZA_PRAYERS.includes(r.prayer)) continue;
      if (ids.has(r.clientId || r.id)) continue;
      if (!r.prayedAt && openByDatePrayer.has(`${r.date}:${r.prayer}`)) continue;
      out.push(r);
      ids.add(r.clientId || r.id);
      if (!r.prayedAt) openByDatePrayer.add(`${r.date}:${r.prayer}`);
    }
    return out;
  }

  // When a guest records qaza and then signs in, qazaOwnerKey() flips from
  // 'anonymous' to their email — which would orphan the guest rows under the
  // old key and show an empty drawer. Fold the anonymous bucket into the
  // signed-in owner's local store (deduped) so the subsequent
  // refreshQazaFromServer({ syncLocal: true }) pushes them up to the account.
  // Idempotent: clears the anonymous bucket once merged, so later calls no-op.
  function migrateAnonymousQazaToOwner() {
    const owner = qazaOwnerKey();
    if (!owner || owner === 'anonymous') return false;
    const anon = storage.getQazaRecords('anonymous');
    if (!anon.length) return false;
    const merged = mergeQazaRecords(storage.getQazaRecords(owner), anon);
    storage.saveQazaRecords(merged, owner);
    storage.saveQazaRecords([], 'anonymous');
    return true;
  }

  async function refreshQazaFromServer({ syncLocal = true } = {}) {
    const owner = qazaOwnerKey();
    if (!isSignedInForServerSync() || !window.api?.listQazaRecords) {
      qazaLastServerOwner = null;
      return;
    }
    if (qazaServerSyncInFlight && qazaLastServerOwner === owner) return qazaServerSyncInFlight;
    qazaLastServerOwner = owner;
    qazaServerSyncInFlight = (async () => {
      try {
        const localRows = storage.getQazaRecords(owner).map(normalizeQazaRecord);
        if (syncLocal && localRows.length) {
          await pushQazaRowsToServer(localRows);
        }
        const res = await api.listQazaRecords({ status: 'all' });
        const rows = (res.records || []).map(normalizeQazaRecord);
        storage.saveQazaRecords(rows, owner);
        renderQazaDrawer();
        renderQazaSummary();
      } catch (err) {
        console.warn('Could not refresh qaza records from server', err);
      } finally {
        qazaServerSyncInFlight = null;
      }
    })();
    return qazaServerSyncInFlight;
  }

  function renderQazaDrawer() {
    const rows = openQazaRecords();
    const count = rows.length;
    if (qazaEls.summary) {
      qazaEls.summary.textContent = count
        ? `${count} qaza namaz pending. Mark them prayed as you complete them.`
        : 'No qaza namaz pending. Record missed namaz here when needed.';
    }
    if (qazaEls.nextHint) {
      const hint = qazaReminderText(count);
      qazaEls.nextHint.hidden = !hint;
      qazaEls.nextHint.textContent = hint || '';
    }
    if (!qazaEls.list || !qazaEls.empty) return;
    qazaEls.list.innerHTML = '';
    qazaEls.empty.hidden = rows.length > 0;
    rows.forEach((row) => {
      const li = document.createElement('li');
      li.className = 'qaza-row';
      const recorded = row.recordedAt
        ? `Recorded ${formatShortDate(row.recordedAt)}`
        : 'Recorded in this app';
      li.innerHTML = `
        <span class="qaza-row__text">
          <strong>${escapeHtml(QAZA_LABELS[row.prayer] || row.prayer)}</strong>
          <span>${escapeHtml(formatQazaDate(row.date))} · ${escapeHtml(recorded)}</span>
        </span>
        <button class="btn btn--small" type="button">Mark prayed</button>
      `;
      li.querySelector('button')?.addEventListener('click', () => markQazaPrayed(row.id));
      qazaEls.list.appendChild(li);
    });
  }

  function renderQazaSummary(nextPrayer) {
    const count = openQazaRecords().length;
    if (qazaEls.pillCount) {
      qazaEls.pillCount.hidden = count === 0;
      qazaEls.pillCount.textContent = String(count);
    }
  }

  function qazaReminderText(count, nextPrayer = null) {
    if (!count) return '';
    const next = nextPrayer || nextPrayerForDefaultMosque();
    const suffix = next?.label ? ` · remember one around ${next.label}` : '';
    return `${count} qaza pending${suffix}`;
  }

  function nextPrayerForDefaultMosque() {
    const m = view.defaultMosqueObj;
    const timings = m ? R.timingsFromMosque(m) : null;
    return timings ? R.computeNextPrayer(timings) : null;
  }

  function localDateInputValue(date) {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }

  function formatQazaDate(value) {
    return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  function formatShortDate(value) {
    return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // Set the hero clock's "next prayer" name + "at <time>" line. Both the
  // prayer name and the "at" prefix are i18n'd (they were English-only and
  // leaked into RTL locales), and the time is wrapped in an LTR-isolated
  // span so Arabic/Urdu/Persian don't bidi-reorder "4:30 am" into "am 4:30".
  function setHeroNextLabel(next) {
    if (heroEls.prayer) {
      heroEls.prayer.textContent = window.i18n?.t(`prayer.${next.key}`) ?? next.label;
    }
    if (heroEls.at) {
      const prefix = window.i18n?.t('next.at') ?? 'at';
      heroEls.at.textContent = '';
      heroEls.at.append(`${prefix} `);
      const span = document.createElement('span');
      span.className = 'next-card__at-time';
      span.dir = 'ltr';
      span.textContent = R.fmt12(next.time);
      heroEls.at.append(span);
    }
  }

  function renderLocation(el, parts) {
    if (!el) return;
    const visible = (parts || []).filter(Boolean);
    if (!visible.length) {
      el.textContent = '';
      return;
    }
    el.innerHTML = visible
      .map(part => `<span class="loc-part">${escapeHtml(part)}</span>`)
      .join('<span class="loc-sep"> · </span>');
  }

  // ─── Language picker ───────────────────────────────────────────
  function wireLangPicker() {
    const root = document.getElementById('langmenu');
    const trigger = document.getElementById('lang-trigger');
    const currentLabel = document.getElementById('lang-current');
    const pop = document.getElementById('lang-pop');
    const list = document.getElementById('lang-list');
    if (!root || !trigger || !pop || !list || !window.i18n) return;

    const supported = window.i18n.supported();
    const renderOptions = () => {
      const current = window.i18n.current();
      if (currentLabel) currentLabel.textContent = window.i18n.label(current);
      list.innerHTML = '';
      supported.forEach(code => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'langmenu__opt langmenu__option';
        btn.id = `lang-option-${code}`;
        btn.setAttribute('role', 'option');
        btn.setAttribute('aria-selected', code === current ? 'true' : 'false');
        btn.dataset.lang = code;
        btn.dir = window.i18n.isRTLCode?.(code) ? 'rtl' : 'ltr';
        btn.innerHTML = `
          <span class="langmenu__native">${escapeHtml(window.i18n.label(code))}</span>
          <span class="langmenu__en langmenu__english">${escapeHtml(window.i18n.labelEn?.(code) ?? code)}</span>
          <span class="langmenu__check" aria-hidden="true">✓</span>
        `;
        list.appendChild(btn);
      });
      trigger.setAttribute('aria-activedescendant', `lang-option-${current}`);
    };

    const options = () => Array.from(list.querySelectorAll('.langmenu__option'));
    const open = () => {
      renderOptions();
      pop.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      positionPop();
      const active = list.querySelector('[aria-selected="true"]') || options()[0];
      setTimeout(() => active?.focus(), 0);
    };
    // In the native shell the topbar mirrors for RTL, so the language
    // trigger sits on the LEFT. Absolute positioning relative to the small
    // trigger then pushes the wide dropdown off toward the right. Anchor it
    // to the left screen edge with fixed positioning, reading the trigger's
    // real bottom so it survives any status-bar / notch height. LTR keeps
    // the CSS-driven absolute placement.
    const positionPop = () => {
      const native = document.body.classList.contains('is-native');
      const rtl = document.documentElement.dir === 'rtl';
      if (native && rtl) {
        const tb = trigger.getBoundingClientRect();
        pop.style.position = 'fixed';
        pop.style.top = `${Math.round(tb.bottom + 8)}px`;
        pop.style.left = '0.7rem';
        pop.style.right = 'auto';
      } else {
        pop.style.position = '';
        pop.style.top = '';
        pop.style.left = '';
        pop.style.right = '';
      }
    };
    const close = () => {
      pop.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    };
    const choose = async (code) => {
      await window.i18n.set(code);
      // Some labels live in JS (next-bell, keepers credit, etc) — re-render.
      // Also need to put the dynamic "N reminders" count back where i18n.apply
      // overwrote it with the static "Remind me" translation.
      renderOptions();
      refreshAuthBtn();
      renderHero();
      refreshReminderUi();
      renderInboxBanner();
      if (view.selected) renderActiveDrawer?.();
      close();
      trigger.focus();
    };
    const moveFocus = (delta) => {
      const opts = options();
      if (!opts.length) return;
      const index = Math.max(0, opts.indexOf(document.activeElement));
      opts[(index + delta + opts.length) % opts.length].focus();
    };

    renderOptions();
    trigger.addEventListener('click', () => {
      if (pop.hidden) open();
      else close();
    });
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('.langmenu__option');
      if (btn) choose(btn.dataset.lang);
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        close();
        trigger.focus();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (pop.hidden) open();
        else moveFocus(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (pop.hidden) open();
        else moveFocus(-1);
      } else if ((e.key === 'Enter' || e.key === ' ') && document.activeElement?.classList?.contains('langmenu__option')) {
        e.preventDefault();
        choose(document.activeElement.dataset.lang);
      }
    });
    document.addEventListener('click', (e) => {
      if (!root.contains(e.target)) close();
    });
    // The native RTL menu is pinned with fixed coords computed at open time;
    // a rotate / viewport resize would leave it detached from the trigger, so
    // just close it and let the next open reposition.
    const closeOnViewportChange = () => { if (!pop.hidden) close(); };
    window.addEventListener('resize', closeOnViewportChange);
    window.addEventListener('orientationchange', closeOnViewportChange);
  }

  // ─── Reminders ─────────────────────────────────────────────────
  // ─── Sun-position salah card ───────────────────────────────────
  // Computes Fajr/Sunrise/Dhuhr/Asr/Maghrib/Isha from the user's GPS coords
  // using the selected fiqh's angle conventions. Coords cached in localStorage
  // so subsequent loads don't re-prompt; fiqh choice persists too.
  const SUN_FIQH_KEY = 'jamat.fiqh';
  const SUN_COORDS_KEY = 'jamat.userCoords';
  const DEFAULT_SUN_FIQH = 'hanafi';

  function getStoredCoords() {
    try {
      const raw = localStorage.getItem(SUN_COORDS_KEY);
      const c = raw ? JSON.parse(raw) : null;
      if (c && Number.isFinite(c.lat) && Number.isFinite(c.lng)) return c;
    } catch {}
    return null;
  }

  // Tapping the brand / logo opens the "No ads. Ever." sadqa-jaria pledge —
  // the same message shown in the footer, surfaced where people look first.
  function wirePledgeModal() {
    const brand = document.querySelector('.brand');
    const modal = document.getElementById('pledge-modal');
    if (!brand || !modal) return;
    const close = () => modal.setAttribute('aria-hidden', 'true');
    brand.addEventListener('click', (e) => {
      e.preventDefault();
      modal.setAttribute('aria-hidden', 'false');
    });
    modal.querySelectorAll('[data-close-pledge]').forEach(el => el.addEventListener('click', close));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') close();
    });
  }

  function wireSunCard() {
    const card = document.getElementById('sun-card');
    const sel = document.getElementById('sun-fiqh');
    const locateBtn = document.getElementById('sun-locate');
    if (!card || !sel || !locateBtn) return;
    card.hidden = false;

    // Restore fiqh choice. Keep the visual select and calculation default in
    // sync; otherwise the UI can show Hanafi while calculations use Shafi'i.
    const storedFiqh = localStorage.getItem(SUN_FIQH_KEY);
    if (storedFiqh && [...sel.options].some(o => o.value === storedFiqh)) {
      sel.value = storedFiqh;
    } else {
      sel.value = DEFAULT_SUN_FIQH;
    }
    sel.addEventListener('change', () => {
      localStorage.setItem(SUN_FIQH_KEY, sel.value);
      renderSunTimes();
    });

    locateBtn.addEventListener('click', () => requestSunLocation());

    // Initial render — uses cached coords if available, otherwise prompts the
    // "Use my location" button.
    renderSunTimes();
    // If location permission is ALREADY granted but we don't have coords cached
    // yet, resolve them automatically so the card shows sun-position times
    // immediately. The user already granted location — don't make them tap
    // "Use my location" again (reuse the grant everywhere).
    if (!getStoredCoords()) {
      locationPermissionGranted().then((granted) => {
        if (granted) requestSunLocation({ silent: true });
      });
    }
    // Re-render across language changes (prayer names + fiqh option labels).
    document.addEventListener('i18n:change', renderSunTimes);
  }

  // True when we can read location WITHOUT triggering a fresh prompt: native
  // uses the Capacitor-backed permission snapshot, web uses the Permissions
  // API. Returns false when undetermined so we never auto-prompt a user who
  // hasn't opted in.
  async function locationPermissionGranted() {
    try {
      if (window.takbeerPermissions?.check) {
        const p = await window.takbeerPermissions.check();
        if (p?.location === 'granted') return true;
        if (p?.location === 'denied') return false;
      }
    } catch {}
    try {
      if (navigator.permissions?.query) {
        const st = await navigator.permissions.query({ name: 'geolocation' });
        return st.state === 'granted';
      }
    } catch {}
    return false;
  }

  function requestSunLocation({ silent = false } = {}) {
    if (!navigator.geolocation) {
      if (!silent) toast(window.i18n.t('toast.locateFail'));
      return;
    }
    if (!silent) toast(window.i18n.t('toast.locating'));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        localStorage.setItem(SUN_COORDS_KEY, JSON.stringify(coords));
        renderSunTimes();
      },
      () => { if (!silent) toast(window.i18n.t('toast.locateFail')); },
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  }

  function renderSunTimes() {
    const list = document.getElementById('sun-list');
    const sub = document.getElementById('sun-loc-sub');
    const locateBtn = document.getElementById('sun-locate');
    if (!list) return;

    const coords = getStoredCoords();
    if (!coords) {
      list.innerHTML = '';
      if (locateBtn) locateBtn.hidden = false;
      if (sub) sub.textContent = window.i18n.t('sun.locHint');
      return;
    }
    if (locateBtn) locateBtn.hidden = true;

    const sel = document.getElementById('sun-fiqh');
    const fiqh = sel?.value || localStorage.getItem(SUN_FIQH_KEY) || DEFAULT_SUN_FIQH;
    const times = window.sun.prayerTimesForCoords(coords.lat, coords.lng, fiqh);
    if (!times) {
      if (sub) sub.textContent = window.i18n.t('sun.locHint');
      return;
    }
    if (sub) sub.textContent = window.i18n.t('sun.coordsHint', {
      lat: coords.lat.toFixed(2), lng: coords.lng.toFixed(2),
    });

    const ROWS = [
      ['fajr',    'prayer.fajr'],
      ['sunrise', 'sun.sunrise'],
      ['dhuhr',   'prayer.dhuhr'],
      ['asr',     'prayer.asr'],
      ['maghrib', 'prayer.maghrib'],
      ['isha',    'prayer.isha'],
    ];
    list.innerHTML = '';
    for (const [key, i18nKey] of ROWS) {
      if (!times[key]) continue;
      list.appendChild(R.el('li', { class: 'sun-card__row' }, [
        R.el('span', { class: 'sun-card__row-name' }, window.i18n.t(i18nKey)),
        R.el('span', { class: 'sun-card__row-time' }, R.fmt12(times[key])),
      ]));
    }
  }

  // ─── Suggestions: inbox banner + suggest-update modal ──────────
  // Banner above the topbar: "N suggestions waiting" with a Review button.
  // Click Review (or the banner row) → opens the inbox modal listing each
  // pending suggestion with from-user, mosque, proposed times, accept/decline.
  // Compose modal (#suggest-modal) is opened from the keeper card in the drawer.
  let suggestState = { pending: [], composeTarget: null, pushStatus: null, pushTopic: null };

  function wireSuggestions() {
    const banner = document.getElementById('inbox-banner');
    const inboxBtn = document.getElementById('inbox-banner-btn');
    const inboxModal = document.getElementById('inbox-modal');
    const suggestModal = document.getElementById('suggest-modal');
    if (!banner || !inboxBtn || !inboxModal || !suggestModal) return;

    inboxBtn.addEventListener('click', () => openInboxModal());
    banner.addEventListener('click', (e) => { if (e.target === banner || e.target.classList.contains('inbox-banner__text')) openInboxModal(); });

    // Wire the suggest-modal send button.
    document.getElementById('suggest-send').addEventListener('click', sendSuggestion);
    document.getElementById('inbox-alerts-enable')?.addEventListener('click', enableInboxAlerts);

    // Modal close buttons (scrim + ×) — both modals share data-close-modal.
    [inboxModal, suggestModal].forEach(m => {
      m.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', () => closeModal(m)));
    });
    // Escape key closes whichever modal is currently open. The drawer has
    // its own Escape handler in wireDrawer; modals were missing this.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      [inboxModal, suggestModal].forEach(m => {
        if (m.getAttribute('aria-hidden') === 'false') closeModal(m);
      });
    });
  }

  function openInboxModal() {
    const m = document.getElementById('inbox-modal');
    renderInbox();
    renderInboxAlerts();
    refreshInboxPushStatus();
    m.setAttribute('aria-hidden', 'false');
  }
  function closeModal(m) { m.setAttribute('aria-hidden', 'true'); }

  function inboxPushTopic() {
    return view.me?.id ? `suggest-to-${view.me.id}` : null;
  }

  async function refreshInboxPushStatus() {
    const topic = inboxPushTopic();
    const push = window.takbeerPush;
    if (!topic || !push?.status) {
      suggestState.pushStatus = null;
      suggestState.pushTopic = topic;
      renderInboxAlerts();
      return null;
    }
    try {
      suggestState.pushTopic = topic;
      suggestState.pushStatus = await push.status(topic);
    } catch {
      suggestState.pushStatus = null;
    }
    renderInboxAlerts();
    return suggestState.pushStatus;
  }

  async function ensureInboxPushSubscription({ prompt = false } = {}) {
    const topic = inboxPushTopic();
    const push = window.takbeerPush;
    if (!topic || !push) {
      suggestState.pushStatus = null;
      renderInboxAlerts();
      return false;
    }
    let ok = false;
    try {
      if (prompt && push.subscribe) {
        ok = await push.subscribe(topic);
      } else if (push.subscribeWhenPermitted) {
        ok = await push.subscribeWhenPermitted(topic);
      }
    } catch {
      ok = false;
    }
    await refreshInboxPushStatus();
    return ok;
  }

  async function enableInboxAlerts() {
    const btn = document.getElementById('inbox-alerts-enable');
    if (!btn) return;
    const prior = suggestState.pushStatus;
    btn.disabled = true;
    try {
      if (prior?.permission === 'denied' && window.takbeerPermissions?.openAppSettings) {
        const opened = await window.takbeerPermissions.openAppSettings();
        if (!opened) toast(window.i18n.t('inbox.alertsSettingsHint'));
        return;
      }
      const ok = await ensureInboxPushSubscription({ prompt: true });
      if (ok) {
        toast(window.i18n.t('inbox.alertsEnabledToast'));
      } else {
        const next = suggestState.pushStatus;
        if (next?.permission === 'denied') toast(window.i18n.t('inbox.alertsDeniedToast'));
        else toast(window.i18n.t('inbox.alertsQueuedToast'));
      }
    } finally {
      btn.disabled = false;
      renderInboxAlerts();
    }
  }

  function renderInboxAlerts() {
    const box = document.getElementById('inbox-alerts');
    const title = document.getElementById('inbox-alerts-title');
    const body = document.getElementById('inbox-alerts-body');
    const btn = document.getElementById('inbox-alerts-enable');
    if (!box || !title || !body || !btn) return;

    const push = window.takbeerPush;
    const status = suggestState.pushStatus;
    const shouldShow = !!view.me?.id && !!push && (!status || status.supported !== false) && !status?.subscribed;
    if (!shouldShow) {
      box.hidden = true;
      return;
    }

    box.hidden = false;
    const denied = status?.permission === 'denied';
    title.textContent = window.i18n.t(denied ? 'inbox.alertsDeniedTitle' : 'inbox.alertsTitle');
    body.textContent = window.i18n.t(denied ? 'inbox.alertsDeniedBody' : 'inbox.alertsBody');
    btn.textContent = window.i18n.t(denied ? 'inbox.alertsSettings' : 'inbox.alertsEnable');
  }

  async function refreshInbox() {
    // Hard gate: signed-out users should never trigger a server call for
    // "my inbox" — defends against server leaks like loadProfile above.
    if (!getEmail()) {
      suggestState.pending = [];
      renderInboxBanner();
      return;
    }
    if (!view.me) return; // only signed-in users have an inbox
    try {
      const res = await api.listSuggestionInbox();
      suggestState.pending = res.suggestions || [];
    } catch {
      suggestState.pending = [];
    }
    renderInboxBanner();
    if (suggestState.pending.length > 0) refreshInboxPushStatus();
  }

  function renderInboxBanner() {
    const banner = document.getElementById('inbox-banner');
    const text = document.getElementById('inbox-banner-text');
    if (!banner || !text) return;
    const n = suggestState.pending.length;
    if (n === 0) { banner.hidden = true; return; }
    banner.hidden = false;
    text.textContent = window.i18n.t(n === 1 ? 'inbox.bannerOne' : 'inbox.bannerMany', { n });
  }

  function renderInbox() {
    const list = document.getElementById('inbox-list');
    if (!list) return;
    list.innerHTML = '';
    if (suggestState.pending.length === 0) {
      list.appendChild(R.el('li', { class: 'muted' }, window.i18n.t('inbox.empty')));
      return;
    }
    for (const s of suggestState.pending) {
      const t = s.timings || {};
      const cur = s.currentTimings || {};
      // Render an "old → new" diff per prayer so the keeper sees exactly
      // what's being changed. If there's no current value we just show the
      // proposed time. If suggestion matches current, we still show that
      // prayer (unchanged) but greyed — it's part of the proposal.
      const flat = (v) => Array.isArray(v) ? v[0] : v;
      const buildRow = (key, label, oldVal, newVal) => {
        const oldFmt = oldVal != null ? R.fmt12(oldVal) : null;
        const newFmt = newVal != null ? R.fmt12(newVal) : null;
        const changed = oldFmt !== newFmt;
        const children = [
          R.el('span', { class: 'inbox-row__time-name' }, label + ': '),
        ];
        if (oldFmt && changed) {
          children.push(R.el('span', { class: 'inbox-row__time-old' }, oldFmt));
          children.push(R.el('span', { class: 'inbox-row__time-arrow', 'aria-hidden': 'true' }, ' → '));
          children.push(R.el('span', { class: 'inbox-row__time-new' }, newFmt));
        } else if (newFmt) {
          children.push(R.el('span', { class: 'inbox-row__time-new' }, newFmt));
        } else {
          return null;
        }
        return R.el('li', { class: 'inbox-row__time' + (changed ? ' is-changed' : ' is-same') }, children);
      };

      const rows = ['fajr', 'dhuhr', 'asr', 'isha', 'jummah']
        .map(k => buildRow(k, window.i18n.t('prayer.' + k), flat(cur[k]), flat(t[k])))
        .filter(Boolean);
      if (typeof t.maghribOffset === 'number' || typeof cur.maghribOffset === 'number') {
        const oldOff = typeof cur.maghribOffset === 'number'
          ? window.i18n.t('submit.offsetPlus', { n: cur.maghribOffset })
          : null;
        const newOff = typeof t.maghribOffset === 'number'
          ? window.i18n.t('submit.offsetPlus', { n: t.maghribOffset })
          : null;
        const changed = oldOff !== newOff;
        const children = [
          R.el('span', { class: 'inbox-row__time-name' }, window.i18n.t('prayer.maghrib') + ': '),
        ];
        if (oldOff && changed) {
          children.push(R.el('span', { class: 'inbox-row__time-old' }, oldOff));
          children.push(R.el('span', { class: 'inbox-row__time-arrow', 'aria-hidden': 'true' }, ' → '));
          children.push(R.el('span', { class: 'inbox-row__time-new' }, newOff));
        } else {
          children.push(R.el('span', { class: 'inbox-row__time-new' }, newOff || oldOff));
        }
        rows.push(R.el('li', { class: 'inbox-row__time' + (changed ? ' is-changed' : ' is-same') }, children));
      }

      const acceptBtn = R.el('button', {
        class: 'btn btn--primary btn--small',
        onclick: () => actOnSuggestion(s.id, 'accept'),
      }, window.i18n.t('inbox.accept'));
      const declineBtn = R.el('button', {
        class: 'btn btn--ghost btn--small',
        onclick: () => actOnSuggestion(s.id, 'decline'),
      }, window.i18n.t('inbox.decline'));

      list.appendChild(R.el('li', { class: 'inbox-row' }, [
        R.el('p', { class: 'inbox-row__head' }, [
          R.el('strong', {}, R.prettifyPersonName(s.fromUser?.fullName || s.fromUser?.email) || 'Anonymous'),
          ` · ${window.i18n.t('inbox.at')} ${s.mosque?.name || '—'}`,
        ]),
        s.notes ? R.el('p', { class: 'inbox-row__note' }, `“${s.notes}”`) : null,
        R.el('ul', { class: 'inbox-row__times' }, rows),
        R.el('div', { class: 'inbox-row__actions' }, [acceptBtn, declineBtn]),
      ]));
    }
  }

  async function actOnSuggestion(id, action) {
    // Keep the suggestion's data so we can post-process by mosque/keeper
    // even after we strip it from the local pending list.
    const sug = suggestState.pending.find(s => s.id === id);
    try {
      if (action === 'accept') await api.acceptSuggestion(id);
      else await api.declineSuggestion(id);
      suggestState.pending = suggestState.pending.filter(s => s.id !== id);
      renderInboxBanner();
      renderInbox();
      toast(window.i18n?.t?.(action === 'accept' ? 'inbox.acceptedToast' : 'inbox.declinedToast')
        ?? (action === 'accept' ? 'Accepted' : 'Declined'));

      // After accept the keeper's active schedule changed. Refresh every
      // surface that might be showing it: an open drawer for THIS mosque,
      // and the hero card if it's the user's default. The previous code
      // called a phantom `loadKeepersForMosque(...)` that does not exist
      // (silently caught by the surrounding try/catch, surfacing as a
      // misleading "loadKeepersForMosque is not defined" toast).
      if (action === 'accept' && sug) {
        try {
          if (view.selected?.id === sug.mosqueId) {
            await openDetailInternal(sug.mosqueId);
          }
          if (view.defaultMosqueObj?.id === sug.mosqueId) {
            view.defaultMosqueObj = await api.getMosque(sug.mosqueId);
            renderHero();
          }
        } catch { /* UI catches up on next interaction */ }
      }

      // Auto-close the inbox modal once the queue empties so the keeper
      // isn't left looking at an empty list with a stale modal frame.
      if (suggestState.pending.length === 0) {
        const inboxModal = document.getElementById('inbox-modal');
        if (inboxModal) closeModal(inboxModal);
      }
    } catch (err) {
      toast(err?.message || (action === 'accept' ? 'Accept failed' : 'Decline failed'));
    }
  }

  // Open the compose modal targeting a specific keeper for the current mosque.
  function openSuggestModal(keeper) {
    if (!view.selected) return;
    const m = document.getElementById('suggest-modal');
    suggestState.composeTarget = keeper;
    document.getElementById('suggest-target').textContent = window.i18n.t('suggest.target', {
      name: R.prettifyPersonName(keeper.submitterName) || '—',
    });
    // Prefill from the keeper's current times.
    const eff = keeper.timings || {};
    ['fajr', 'dhuhr', 'asr', 'isha', 'jummah'].forEach(name => {
      const v = Array.isArray(eff[name]) ? eff[name][0] : eff[name];
      const input = m.querySelector(`input[name="${name}"]`);
      if (input) input.value = v || '';
    });
    const off = m.querySelector('select[name="maghribOffset"]');
    if (off) off.value = Number.isFinite(+eff.maghribOffset) ? String(+eff.maghribOffset) : '3';
    m.querySelector('textarea[name="notes"]').value = '';
    window.simpleTime?.sync(m);
    m.setAttribute('aria-hidden', 'false');
  }

  async function sendSuggestion() {
    if (!requireSignIn('suggest a timing update', () => sendSuggestion())) return;
    const m = document.getElementById('suggest-modal');
    const keeper = suggestState.composeTarget;
    if (!keeper || !view.selected) return;
    const get = (n) => {
      const value = m.querySelector(`[name="${n}"]`)?.value || undefined;
      return value && R.normalizeSubmittedPrayerTime ? R.normalizeSubmittedPrayerTime(n, value) : value;
    };
    const offRaw = get('maghribOffset');
    const timings = {
      fajr: get('fajr'), dhuhr: get('dhuhr'),
      asr: get('asr'), isha: get('isha'), jummah: get('jummah'),
      maghribOffset: offRaw != null ? parseInt(offRaw, 10) : undefined,
    };
    if (!Object.values(timings).some(v => v !== undefined && v !== '')) {
      return toast(window.i18n.t('toast.atLeastOne'));
    }
    try {
      await api.createSuggestion({
        toUserId: keeper.submitterId,
        mosqueId: view.selected.id,
        timings,
        notes: get('notes'),
      });
      closeModal(m);
      try { await refreshOpenDrawer({ silent: true }); } catch {}
      toast(window.i18n.t('suggest.toastSent', { name: R.prettifyPersonName(keeper.submitterName) || '' }));
    } catch (err) {
      toast(window.i18n.t('suggest.toastFail', { err: err.message }));
    }
  }

  // "Next reminder fires" status line at the top of the reminder panel.
  // Computed from the same scheduling logic the bell click + Save use,
  // so it always reflects what's actually queued. Hidden when nothing
  // upcoming today (panel can show the configuration explainers below
  // without an awkward empty status line on top).
  function updateNextReminderLine() {
    const lineEl = document.getElementById('reminder-next-line');
    if (!lineEl) return;
    const prefs = window.reminders?.getPrefs?.();
    const m = view.defaultMosqueObj;
    const timings = m ? R.timingsFromMosque(m) : null;
    if (!prefs?.enabled || !timings) {
      lineEl.hidden = true;
      lineEl.style.display = 'none';
      lineEl.textContent = '';
      return;
    }
    // Recompute next-fire inline (rather than calling reminders.schedule())
    // so this function has no side effects — schedule() cancels and
    // re-installs timers, which we don't want from a status-render call.
    //
    // Two-day search: when the user opens the panel late at night every
    // remaining prayer for today has already passed; we then look at
    // tomorrow's same schedule. Friday/Jummah swap is applied per the
    // target date's day-of-week so a Friday-night open correctly shows
    // tomorrow's Fajr (Saturday → Dhuhr regular, no Jummah).
    const PRAYER_KEYS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha', 'jummah'];
    const PRETTY = { fajr: 'Fajr', dhuhr: 'Dhuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha', jummah: 'Jummah' };
    const now = new Date();
    let best = null;
    for (const dayOffset of [0, 1]) {
      const day = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);
      const isFri = day.getDay() === 5;
      for (const key of PRAYER_KEYS) {
        if (!prefs.prayerEnabled?.[key]) continue;
        const minutesBefore = prefs.perPrayer?.[key];
        if (typeof minutesBefore !== 'number' || minutesBefore <= 0) continue;
        if (isFri && key === 'dhuhr') continue;
        if (!isFri && key === 'jummah') continue;
        let t = timings[key === 'dhuhr' ? 'zuhr' : key] || timings[key];
        if (Array.isArray(t)) t = t[0];
        if (!t || typeof t !== 'string') continue;
        const [h, mm] = t.split(':').map(Number);
        if (Number.isNaN(h) || Number.isNaN(mm)) continue;
        const target = new Date(day); target.setHours(h, mm, 0, 0);
        const fireAt = target.getTime() - minutesBefore * 60_000;
        if (fireAt <= now.getTime()) continue;
        if (!best || fireAt < best.fireAt) {
          best = { key, time: t, minutesBefore, fireAt, dayOffset };
        }
      }
      if (best) break; // earliest hit found on day 0; only fall through to day 1 when day 0 was empty
    }
    if (!best) {
      lineEl.hidden = true;
      lineEl.style.display = 'none';
      lineEl.textContent = '';
      return;
    }
    const fireDate = new Date(best.fireAt);
    const hh = String(fireDate.getHours()).padStart(2, '0');
    const mm = String(fireDate.getMinutes()).padStart(2, '0');
    const whenLabel = best.dayOffset === 0 ? '' : ' tomorrow';
    // Use innerHTML so the strong tag renders. Interpolated values come
    // from a fixed enum (PRETTY) + zero-padded numerics + a literal string
    // — no XSS surface.
    lineEl.innerHTML = `Next reminder: <strong>${PRETTY[best.key]}${whenLabel} at ${R.fmt12(best.time)}</strong> · rings at ${hh}:${mm} (${best.minutesBefore} min before)`;
    lineEl.removeAttribute('hidden');
    lineEl.hidden = false;
    lineEl.style.display = 'block';
  }

  function wireReminders() {
    const bell = document.getElementById('next-bell');
    const panel = document.getElementById('reminder-panel');
    const flip = document.getElementById('reminder-flip');
    if (!bell || !panel) return;

    bell.addEventListener('click', async () => {
      const isOpening = panel.hidden;
      panel.hidden = !panel.hidden;
      bell.setAttribute('aria-expanded', panel.hidden ? 'false' : 'true');
      if (!panel.hidden) {
        hydratePrayerInputs();
        updateNextReminderLine();
      }

      // First-time arming: if the user is opening the panel and nothing
      // is configured yet, arm sensible defaults (10 min before each
      // obligatory prayer, all per-prayer toggles on, master on). The
      // bell flips to its golden / pulsing state immediately so the
      // user gets visual feedback that one tap = "reminders are on now".
      // They can fine-tune in the panel that just opened.
      if (isOpening) {
        const prefs = window.reminders.getPrefs();
        const noneArmed = !Object.values(prefs.prayerEnabled || {}).some(Boolean);
        if (noneArmed) {
          const ok = await window.reminders.ensurePermission();
          if (ok) {
            const defaults = { fajr: 10, dhuhr: 10, asr: 10, maghrib: 10, isha: 10, jummah: null };
            prefs.perPrayer = { ...defaults, ...(prefs.perPrayer || {}) };
            // Use existing minutes when present; otherwise fall back to 10.
            for (const k of ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']) {
              if (!(prefs.perPrayer[k] > 0)) prefs.perPrayer[k] = 10;
              prefs.prayerEnabled[k] = true;
            }
            prefs.enabled = true;
            window.reminders.savePrefs(prefs);
            const m = view.defaultMosqueObj;
            const timings = m ? R.timingsFromMosque(m) : null;
            window.reminders.schedule(timings, m?.name || 'your masjid');
            hydratePrayerInputs();
            updateNextReminderLine();
            refreshReminderUi();
          }
        }
      }
    });

    flip?.addEventListener('click', async () => {
      const prefs = window.reminders.getPrefs();
      const isOn = prefs.enabled;
      if (isOn) {
        // Turning off: disable but preserve per-prayer values so flip-on restores them
        prefs.enabled = false;
        window.reminders.savePrefs(prefs);
        window.reminders.cancel();
      } else {
        // Turning on: needs notification permission. If no per-prayer offsets
        // are set yet, default to 10 min before each obligatory prayer.
        const ok = await window.reminders.ensurePermission();
        if (!ok) {
          toast('Browser blocked notifications. Enable them in site settings.');
          return;
        }
        const noneSet = Object.values(prefs.perPrayer || {}).every(v => !v);
        if (noneSet) {
          prefs.perPrayer = { fajr: 10, dhuhr: 10, asr: 10, maghrib: 10, isha: 10, jummah: null };
        }
        prefs.enabled = true;
        window.reminders.savePrefs(prefs);
        const m = view.defaultMosqueObj;
        const timings = m ? R.timingsFromMosque(m) : null;
        const scheduled = window.reminders.schedule(timings, m?.name || 'your masjid');
        toast(scheduled.length
          ? `Reminders on — ${scheduled.length} queued for today`
          : 'Reminders on — they activate at the next prayer');
      }
      refreshReminderUi();
    });

    // Shared helper: re-install the schedule for the current default
    // mosque. Called from every per-prayer control so the user doesn't
    // have to also tap Save for a toggle/input change to take effect.
    function rescheduleForDefaultMosque() {
      scheduleDefaultMosqueReminders();
    }

    window.addEventListener('takbeer:exact-alarm-denied', (e) => {
      const msg = 'Android may delay reminders. Turn on Alarms & reminders for Takbeer Time to make them ring on time.';
      setReminderStatus(msg);
      // Suppress the toast during the first-run onboarding (e.detail.firstRun):
      // the user hasn't armed a reminder yet and we're already opening the
      // Settings page, so a "reminders may be delayed" toast there is noise.
      if (!e?.detail?.firstRun) toast(msg);
    });

    window.addEventListener('takbeer:resumed', () => {
      const prefs = window.reminders?.getPrefs?.();
      if (prefs?.enabled) {
        scheduleDefaultMosqueReminders();
        updateNextReminderLine();
      }
    });

    // Each per-prayer input updates its own minutes on change.
    // setPrayerOffset auto-enables a prayer that was off when a
    // positive value is typed in, so this path needs the same
    // permission gate the toggle does — otherwise the user thinks
    // they've armed the reminder but the OS will silently drop
    // anything we schedule (POST_NOTIFICATIONS not granted) or fail
    // to ring through Doze (SCHEDULE_EXACT_ALARM not granted).
    document.querySelectorAll('[data-prayer-input]').forEach(input => {
      input.addEventListener('change', async () => {
        const prayer = input.dataset.prayerInput;
        const v = parseInt(input.value, 10);
        const minutes = Number.isNaN(v) || v <= 0 ? null : Math.min(120, Math.max(1, v));
        if (minutes != null && String(minutes) !== input.value) input.value = String(minutes);

        if (minutes != null) {
          const prefs = window.reminders.getPrefs();
          if (!prefs.prayerEnabled[prayer]) {
            const ok = await window.reminders.ensurePermission();
            if (!ok) {
              toast('Notification permission needed for reminders');
              input.value = '';
              return;
            }
          }
        }

        window.reminders.setPrayerOffset(prayer, minutes);
        rescheduleForDefaultMosque();
        hydratePrayerInputs(); // refresh the toggle that just auto-enabled
        refreshReminderUi();
        updateNextReminderLine();
      });
    });

    // Per-prayer on/off toggle. Preserves the minutes value when off.
    // Turning ON without notification permission would persist the
    // enabled flag but the OS would silently drop scheduled alarms —
    // exactly what bit users in the v2.0 Play Store release. Now we
    // mirror the master-flip flow: prompt on enable, then schedule
    // immediately so the change is live without a separate Save tap.
    document.querySelectorAll('[data-prayer-toggle]').forEach(toggle => {
      toggle.addEventListener('click', async () => {
        const prayer = toggle.dataset.prayerToggle;
        const isOn = toggle.getAttribute('aria-checked') === 'true';

        if (!isOn) {
          const ok = await window.reminders.ensurePermission();
          if (!ok) {
            toast('Notification permission needed for reminders');
            return;
          }
        }

        window.reminders.setPrayerEnabled(prayer, !isOn);
        rescheduleForDefaultMosque();
        hydratePrayerInputs();
        refreshReminderUi();
        updateNextReminderLine();
      });
    });

    document.getElementById('reminder-save')?.addEventListener('click', async () => {
      const ok = await window.reminders.ensurePermission();
      if (!ok) {
        setReminderStatus('Browser blocked notifications. Enable them in site settings.');
        return;
      }
      const prefs = window.reminders.getPrefs();
      // Make sure enabled flag reflects what's actually set.
      prefs.enabled = Object.keys(prefs.perPrayer || {}).some(k =>
        prefs.prayerEnabled?.[k] && typeof prefs.perPrayer[k] === 'number' && prefs.perPrayer[k] > 0);
      window.reminders.savePrefs(prefs);
      const m = view.defaultMosqueObj;
      const timings = m ? R.timingsFromMosque(m) : null;
      const scheduled = window.reminders.schedule(timings, m?.name || 'your masjid');
      setReminderStatus(scheduled.length
        ? `${scheduled.length} reminder${scheduled.length === 1 ? '' : 's'} queued for the coming days.`
        : 'No future jamat times match your current reminder settings.');
      updateNextReminderLine();
      refreshReminderUi();
      // Collapse the panel after Save so the user knows their settings were saved
      // and can see the rest of the hero card. The bell label updates to reflect.
      setTimeout(() => {
        panel.hidden = true;
        bell.setAttribute('aria-expanded', 'false');
      }, 600);
    });

    let testCountdownTimer = null;
    document.getElementById('reminder-test')?.addEventListener('click', async () => {
      const ok = await window.reminders.ensurePermission();
      // In the Capacitor shell, fire a real LocalNotification through the
      // same channel a scheduled reminder uses — that's the only way to
      // actually test what the user will hear. The Web Audio chime alone
      // doesn't exercise the OS notification path (channel, sound, vibration,
      // heads-up display) and so misses bugs like a silenced channel.
      // In the plain web build there's no native path, so we fall back to
      // the chime + Web Notification we always had.
      if (window.nativeReminders?.fireTest) {
        try { await window.nativeReminders.fireTest(); } catch {}
        // Live countdown — overwrites itself each second so the user
        // sees "3s … 2s … 1s …" tick down to the actual ring instead
        // of staring at a stale "fire in 3 seconds" message.
        if (testCountdownTimer) clearInterval(testCountdownTimer);
        let secsLeft = 3;
        const tick = () => {
          if (secsLeft > 0) {
            setReminderStatus(ok
              ? `Test reminder fires in ${secsLeft}s…`
              : `Test queued (${secsLeft}s) — notification permission denied, you may not hear it.`);
            secsLeft -= 1;
          } else {
            clearInterval(testCountdownTimer);
            testCountdownTimer = null;
            setReminderStatus(ok ? 'Test reminder fired — listen for the ring.' : 'Test attempted; check OS notification permissions.');
          }
        };
        tick();
        testCountdownTimer = setInterval(tick, 1000);
      } else {
        window.reminders.playChime();
        if (ok && 'Notification' in window) {
          new Notification('Test ring', { body: 'This is what a reminder will sound like.', silent: false });
        }
        setReminderStatus(ok ? 'Played the chime.' : 'Played the chime (notification permission denied).');
      }
    });

    document.getElementById('reminder-off')?.addEventListener('click', () => {
      const prefs = window.reminders.getPrefs();
      // Preserve minutes; just flip every per-prayer toggle off + master off.
      for (const k of Object.keys(prefs.prayerEnabled || {})) prefs.prayerEnabled[k] = false;
      prefs.enabled = false;
      window.reminders.savePrefs(prefs);
      window.reminders.cancel();
      hydratePrayerInputs();
      setReminderStatus('All reminders off (minutes preserved — toggle any prayer back on to restore).');
      refreshReminderUi();
    });
  }

  function hydratePrayerInputs() {
    const prefs = window.reminders.getPrefs();
    document.querySelectorAll('[data-prayer-input]').forEach(input => {
      const prayer = input.dataset.prayerInput;
      const v = prefs.perPrayer[prayer];
      input.value = (typeof v === 'number' && v > 0) ? String(v) : '';
    });
    document.querySelectorAll('[data-prayer-toggle]').forEach(toggle => {
      const prayer = toggle.dataset.prayerToggle;
      const on = !!prefs.prayerEnabled[prayer];
      toggle.setAttribute('aria-checked', on ? 'true' : 'false');
      // Dim the row when disabled so the user sees what's off at a glance
      const li = toggle.closest('li');
      if (li) li.setAttribute('data-enabled', on ? 'true' : 'false');
    });
  }

  function setReminderStatus(text) {
    const el = document.getElementById('reminder-status');
    if (el) el.textContent = text || '';
  }

  async function refreshOpenDrawer({ silent = false } = {}) {
    if (!view.selected || drawer.getAttribute('aria-hidden') !== 'false') return null;
    const mosqueId = view.selected.id;
    const fresh = await api.getMosque(mosqueId);
    replaceMosqueEverywhere(fresh);
    loadContributors(mosqueId);
    if (!silent) {
      toast(fresh.fromCache
        ? (window.i18n?.t('next.refreshOffline') ?? "Offline — couldn't reach the server.")
        : (window.i18n?.t('next.refreshOk') ?? 'Times updated.'));
    }
    return fresh;
  }

  // Manual refresh from the masjid card. Bypasses the read-from-list
  // shortcut in hydrateDefaultMosque and goes straight to /mosques/:id
  // so users can pull a just-updated schedule on demand. The api layer
  // already falls back to the localStorage cache when the network
  // fails — we surface that as an "offline" toast so the press still
  // feels acknowledged instead of silently doing nothing.
  function wireRefreshButton() {
    const btn = heroEls.refresh;
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const m = view.defaultMosqueObj;
      if (!m || btn.disabled) return;
      btn.disabled = true;
      btn.classList.add('is-spinning');
      try {
        const fresh = await api.getMosque(m.id);
        view.defaultMosqueObj = fresh;
        // Keep the in-memory list rows in sync so the directory card
        // reflects the same fresh times the hero just got.
        const replaceIn = (arr) => {
          const i = arr.findIndex(x => x.id === fresh.id);
          if (i >= 0) arr[i] = { ...arr[i], ...fresh };
        };
        replaceIn(view.nearby);
        replaceIn(view.favorites);
        renderHero();
        renderActivePanel();
        if (fresh.fromCache) {
          toast(window.i18n?.t('next.refreshOffline') ?? "Offline — couldn't reach the server.");
        } else {
          toast(window.i18n?.t('next.refreshOk') ?? 'Times updated.');
        }
      } catch (err) {
        const tpl = window.i18n?.t('next.refreshFail', { err: err.message });
        toast(tpl && !tpl.includes('{err}') ? tpl : `Couldn't refresh: ${err.message}`);
      } finally {
        btn.classList.remove('is-spinning');
        btn.disabled = false;
      }
    });
  }

  // Pull-to-refresh, mobile only. If a drawer is open, refresh that masjid
  // from /mosques/:id so the timing table + keeper list repaint from the
  // latest server state. Otherwise reuse the hero refresh button for the
  // default masjid.
  // Coarse-pointer gate keeps desktop mice / trackpads out (no accidental
  // swipe-down on a laptop touchpad). Browser-native PTR is suppressed
  // via overscroll-behavior in CSS so the page doesn't reload underneath us.
  function wirePullToRefresh() {
    if (typeof matchMedia !== 'function' || !matchMedia('(pointer: coarse)').matches) return;

    const THRESHOLD = 70;   // px past which the release commits a refresh
    const MAX_PULL  = 120;  // visual cap so the indicator can't run away
    let startY = 0;
    let pulling = false;
    let armed = false;
    let indicator = null;
    let refreshTarget = null;

    function ensureIndicator() {
      if (indicator) return indicator;
      indicator = document.createElement('div');
      indicator.id = 'ptr-indicator';
      indicator.setAttribute('aria-hidden', 'true');
      indicator.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      document.body.appendChild(indicator);
      return indicator;
    }

    function reset() {
      if (!indicator) return;
      indicator.style.transform = '';
      indicator.style.opacity = '';
      indicator.classList.remove('is-armed', 'is-loading');
    }

    function drawerPanelFromPath(path) {
      return path.find(n => n && n.classList && n.classList.contains('drawer__panel')) || null;
    }

    function openDrawerRefreshTarget(path) {
      if (!view.selected || drawer.getAttribute('aria-hidden') !== 'false') return null;
      const panel = drawerPanelFromPath(path);
      if (!panel || panel.scrollTop > 0) return null;
      return { type: 'drawer', panel };
    }

    document.addEventListener('touchstart', (e) => {
      const path = (typeof e.composedPath === 'function' ? e.composedPath() : []) || [];
      refreshTarget = openDrawerRefreshTarget(path);
      if (!refreshTarget) {
        // Only act when the page is scrolled to the very top; otherwise
        // a normal upward swipe (to scroll content) would be hijacked.
        if (window.scrollY > 0) return;
        // No refresh button surfaced (no default mosque) → no point.
        if (!heroEls.refresh || heroEls.refresh.hidden) return;
        refreshTarget = { type: 'hero' };
      }
      // Multi-touch (pinch zoom on the map etc.) is never a pull gesture.
      if (e.touches.length !== 1) { refreshTarget = null; return; }
      // Don't capture taps that begin inside the map — Leaflet handles
      // its own pan gestures and the user isn't trying to refresh.
      if (refreshTarget.type !== 'drawer' && path.some(n => n && n.classList && (n.classList.contains('leaflet-container') || n.id === 'map' || n.id === 'map-overlay'))) {
        refreshTarget = null;
        return;
      }
      startY = e.touches[0].clientY;
      pulling = true;
      armed = false;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (!pulling) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0) return; // upward / horizontal — ignore
      // If the user has somehow scrolled away from the top mid-gesture,
      // bail out (e.g. they started the gesture, paused, then scrolled).
      if (refreshTarget?.type === 'drawer') {
        if (refreshTarget.panel?.scrollTop > 0) { pulling = false; refreshTarget = null; reset(); return; }
      } else if (window.scrollY > 0) {
        pulling = false; refreshTarget = null; reset(); return;
      }
      const ind = ensureIndicator();
      const drag = Math.min(dy, MAX_PULL);
      // Fade in over the first ~60px and translate down at 1:1 with finger
      // up to MAX_PULL. The CSS resting position is just above the viewport
      // (top: -40px) so we add the drag distance to bring it on-screen.
      ind.style.transform = `translate(-50%, ${drag}px)`;
      ind.style.opacity = String(Math.min(1, drag / 60));
      const nextArmed = drag >= THRESHOLD;
      if (nextArmed !== armed) {
        armed = nextArmed;
        ind.classList.toggle('is-armed', armed);
        // Tactile confirmation when the user crosses the commit threshold —
        // matches native pull-to-refresh feel. navigator.vibrate is available
        // in Capacitor's WebView (VIBRATE permission already declared) and on
        // mobile browsers; no-op on desktop. 15ms is short enough to read as
        // a tap rather than a buzz. Only fire on false→true; not on the
        // way back so a finger jittering at the threshold doesn't strobe.
        if (armed && typeof navigator.vibrate === 'function') {
          try { navigator.vibrate(15); } catch {}
        }
      }
    }, { passive: true });

    document.addEventListener('touchend', () => {
      if (!pulling) return;
      pulling = false;
      if (!indicator) return;
      if (armed) {
        // Hold the indicator at its dragged position and switch to the
        // spinner state while the click handler does its work. The
        // refresh button itself emits the toast, so we only need to
        // tear down our own visual after a comfortable beat.
        indicator.classList.add('is-loading');
        indicator.classList.remove('is-armed');
        const done = refreshTarget?.type === 'drawer'
          ? refreshOpenDrawer().catch(err => toast(`Couldn't refresh: ${err.message}`))
          : Promise.resolve().then(() => { try { heroEls.refresh && heroEls.refresh.click(); } catch {} });
        done.finally(() => { refreshTarget = null; });
        setTimeout(reset, 1200);
      } else {
        refreshTarget = null;
        reset();
      }
    });

    document.addEventListener('touchcancel', () => {
      pulling = false;
      refreshTarget = null;
      reset();
    });
  }

  // Foreground push handler. native-bridge.js dispatches this CustomEvent
  // when an FCM "schedule_update" notification arrives while the app is
  // open — instead of letting the OS show a notification banner the user
  // has to tap, we silently re-fetch the affected masjid and let the
  // existing render path update the hero / drawer / directory rows.
  // See docs/PUSH_NOTIFICATIONS.md.
  // Permission-revocation banner: native-bridge dispatches a CustomEvent
  // when the user revokes notifications or location via OS settings while
  // the app was backgrounded. Surface a sticky banner with a "Re-enable"
  // button that deep-links to the app's OS settings page so the user
  // doesn't have to hunt through Android's settings UI.
  function wirePermissionRevocationBanner() {
    let banner = document.getElementById('perm-banner');
    // Inject the banner element above the topbar if the markup didn't
    // include one yet — keeps this fix self-contained in app.js.
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'perm-banner';
      banner.className = 'inbox-banner';   // reuse styling
      banner.style.background = 'var(--brass)'; // honour native safe-area via .inbox-banner rule
      banner.setAttribute('role', 'alert');
      banner.hidden = true;
      banner.innerHTML = `
        <span class="inbox-banner__icon" aria-hidden="true">⚠</span>
        <span class="inbox-banner__text" id="perm-banner-text"></span>
        <button class="inbox-banner__btn" id="perm-banner-btn" type="button">Open Settings</button>
        <button class="inbox-banner__btn" id="perm-banner-dismiss" type="button" aria-label="Dismiss"
                style="background:transparent;color:var(--ink);border-color:transparent;font-size:1.1rem">×</button>
      `;
      document.body.insertBefore(banner, document.body.firstChild);
    }
    const text = document.getElementById('perm-banner-text');
    const openBtn = document.getElementById('perm-banner-btn');
    const dismissBtn = document.getElementById('perm-banner-dismiss');

    const phrase = (which) => {
      if (which.includes('notifications') && which.includes('location')) {
        return 'Notifications and location are off — re-enable to keep getting prayer reminders and find masjids near you.';
      }
      if (which.includes('notifications')) {
        return 'Notifications are off — re-enable to keep getting prayer reminders and keeper updates.';
      }
      if (which.includes('location')) {
        return 'Location is off — re-enable to find masjids near you.';
      }
      return 'A permission was turned off — open Settings to re-enable.';
    };

    window.addEventListener('takbeer:permission-revoked', (e) => {
      const which = e?.detail?.which || [];
      if (!which.length) return;
      text.textContent = phrase(which);
      banner.hidden = false;
    });

    openBtn?.addEventListener('click', async () => {
      const ok = await window.takbeerPermissions?.openAppSettings?.();
      if (!ok) {
        toast('Open Android Settings → Apps → Takbeer Time → Permissions to re-enable.');
      }
      // Don't auto-hide the banner — wait until the user comes back and
      // a fresh resume tick reads the now-granted state, OR they dismiss.
    });
    dismissBtn?.addEventListener('click', async () => {
      banner.hidden = true;
      // Refresh the watcher's baseline so we don't immediately re-show
      // on the next resume tick.
      try { await window.takbeerPermissions?.refresh?.(); } catch {}
    });
  }

  function wirePushUpdates() {
    // Coalesce concurrent pushes for the same masjid. If the keeper fires
    // 5 submissions in quick succession (or FCM dedupes a retry), we'd
    // otherwise issue 5 parallel `getMosque` calls. The Map holds the
    // in-flight promise per mosqueId; the second-through-Nth callers wait
    // on the same promise instead of starting a new fetch.
    const inflight = new Map();
    window.addEventListener('takbeer:schedule-update', async (e) => {
      const mosqueId = e?.detail?.mosqueId;
      if (!mosqueId) return;
      let p = inflight.get(mosqueId);
      if (!p) {
        p = api.getMosque(mosqueId).finally(() => inflight.delete(mosqueId));
        inflight.set(mosqueId, p);
      }
      try {
        const fresh = await p;
        const replaceIn = (arr) => {
          const i = arr.findIndex(x => x.id === fresh.id);
          if (i >= 0) arr[i] = { ...arr[i], ...fresh };
        };
        replaceIn(view.nearby);
        replaceIn(view.favorites);
        if (view.selected?.id === fresh.id) {
          view.selected = fresh;
          paintDrawer(fresh);
        }
        if (view.defaultMosqueObj?.id === fresh.id) {
          view.defaultMosqueObj = fresh;
          renderHero();
        }
        renderActivePanel();
      } catch { /* push arrived but server unreachable; UI catches up next interaction */ }
    });

    // Inbox refresh triggers. Two distinct paths feed the same handler:
    //   - takbeer:new-suggestion: server sent a new-suggestion FCM and
    //     the device received it in foreground (native-bridge dispatches
    //     the event from the Push.pushNotificationReceived listener).
    //   - takbeer:resumed: the user switched away and back. The inbox
    //     could have changed while we weren't looking, so re-poll. This
    //     fixes the long-standing bug where the bell badge stayed stale
    //     after foreground resume — refreshInbox previously only ran
    //     once during init().
    // Coalesce: a single in-flight refresh is enough; if a second event
    // fires while we're mid-fetch, drop it (refresh is idempotent and
    // re-runs on the next event anyway).
    let inboxInflight = false;
    const refreshInboxOnce = async () => {
      if (inboxInflight) return;
      inboxInflight = true;
      try { await refreshInbox(); } finally { inboxInflight = false; }
    };
    window.addEventListener('takbeer:new-suggestion', refreshInboxOnce);
    window.addEventListener('takbeer:resumed', () => {
      refreshInboxOnce();
      refreshInboxPushStatus();
    });
  }

  function refreshReminderUi() {
    const wrap = document.getElementById('reminder-toggle-wrap');
    const bell = document.getElementById('next-bell');
    const label = document.getElementById('next-bell-label');
    const badge = document.getElementById('next-bell-count');
    const flip = document.getElementById('reminder-flip'); // legacy; may be removed
    if (!wrap || !bell || !label) return;
    // Show the bell only when a default mosque is set with timings.
    const hasTimings = !!view.defaultMosqueObj && !!R.timingsFromMosque(view.defaultMosqueObj);
    wrap.hidden = !hasTimings;
    if (!hasTimings) return;
    const prefs = window.reminders?.getPrefs?.() || { perPrayer: {}, prayerEnabled: {} };
    // A prayer is "active" only if BOTH its per-prayer toggle is on AND its
    // minutes are > 0. Otherwise toggling a prayer off without zeroing the
    // minutes leaves it counted, which is what the user just hit.
    const enabled = prefs.prayerEnabled || {};
    const per = prefs.perPrayer || {};
    const activeCount = Object.keys(per).filter(k => enabled[k] && typeof per[k] === 'number' && per[k] > 0).length;
    const on = !!(prefs.enabled && activeCount > 0);
    bell.setAttribute('aria-pressed', on ? 'true' : 'false');
    flip?.setAttribute('aria-checked', on ? 'true' : 'false');
    // Badge shows the count of armed prayers when the bell is active. Hidden
    // when no prayers are armed (the icon alone reads as "no reminders").
    if (badge) {
      if (on) {
        badge.textContent = String(activeCount);
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
    }
    // a11y label still describes state; keep it for screen readers.
    const isNative = document.body.classList.contains('is-native');
    label.textContent = on
      ? (isNative
          ? String(activeCount)
          : (window.i18n ? window.i18n.t('next.bellCount', { n: activeCount }) : `${activeCount} reminder${activeCount === 1 ? '' : 's'}`))
      : (window.i18n ? window.i18n.t('next.bell') : 'Remind me');
  }

  // Tick once a second; re-resolve which prayer is "next" each tick so
  // the hero advances Asr → Maghrib → Isha → tomorrow-Fajr automatically
  // as each prayer time passes. The previous version captured a single
  // `next` at start, which made the countdown stuck on the original
  // prayer and roll forward 24h after it passed (so right after Asr it'd
  // show "Asr 23h" instead of "Maghrib 46m"). Recomputing is cheap —
  // computeNextPrayer iterates ≤ 6 prayers.
  function startCountdown(timings) {
    stopCountdown();
    let currentKey = null;
    const tick = () => {
      const next = R.computeNextPrayer(timings);
      if (!next) {
        heroEls.clock.hidden = true;
        stopCountdown();
        return;
      }
      if (next.key !== currentKey) {
        currentKey = next.key;
        setHeroNextLabel(next);
      }
      const now = new Date();
      const target = next.target ? new Date(next.target) : new Date();
      if (!next.target) {
        const [hh, mm] = next.time.split(':').map(Number);
        target.setHours(hh, mm, 0, 0);
      }
      let diffSec = Math.floor((target - now) / 1000);
      if (diffSec < 0) diffSec += 24 * 3600;
      heroEls.h.textContent = String(Math.floor(diffSec / 3600)).padStart(2, '0');
      heroEls.m.textContent = String(Math.floor((diffSec % 3600) / 60)).padStart(2, '0');
      heroEls.s.textContent = String(diffSec % 60).padStart(2, '0');
    };
    tick();
    view.countdownTimer = setInterval(tick, 1000);
  }
  function stopCountdown() {
    if (view.countdownTimer) clearInterval(view.countdownTimer);
    view.countdownTimer = null;
  }

  // ─── Tabs / Directory ───
  function wireTabs() {
    tabs.forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  }
  function switchTab(key) {
    view.activeTab = key;
    tabs.forEach(t => {
      const active = t.dataset.tab === key;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    Object.entries(panels).forEach(([k, p]) => p.classList.toggle('is-hidden', k !== key));
    renderActivePanel();
  }

  function wireSearch() {
    let timer;
    $('#search').addEventListener('input', (e) => {
      clearTimeout(timer);
      const q = e.target.value.trim().toLowerCase();
      timer = setTimeout(() => { view.filter = q; renderActivePanel(); }, 120);
    });
  }

  function renderActivePanel() {
    const source = view.activeTab === 'favorites' ? view.favorites : view.nearby;
    const filtered = view.filter
      ? source.filter(m =>
          (m.name || '').toLowerCase().includes(view.filter) ||
          (m.city || '').toLowerCase().includes(view.filter) ||
          (m.address || '').toLowerCase().includes(view.filter))
      : source;

    const target = panels[view.activeTab];
    target.innerHTML = '';
    filtered.forEach(m => target.appendChild(makeCard(m)));

    $('#empty-state').hidden = filtered.length > 0;
  }

  function makeCard(m) {
    // List endpoints (browse directory, favorites) don't carry prayer
    // schedules, so a masjid that HAS times can render as "Be the first
    // to submit times". If a hydrated copy exists — the default-mosque
    // object or the on-device mosque cache, both filled by full
    // GET /mosques/:id fetches — merge its timing fields in before
    // rendering. The list entry's own fields (name, distance, counts)
    // still win; only the missing schedule data is borrowed.
    if (!R.timingsFromMosque(m) && !m.effectiveTimings) {
      const hydrated = (view.defaultMosqueObj?.id === m.id ? view.defaultMosqueObj : null)
        || storage.getMosqueCache?.(m.id);
      if (hydrated && (R.timingsFromMosque(hydrated) || hydrated.effectiveTimings)) {
        m = {
          ...hydrated,
          ...m,
          effectiveTimings: hydrated.effectiveTimings,
          defaultJamaatTimings: m.defaultJamaatTimings ?? hydrated.defaultJamaatTimings,
          prayerSchedules: m.prayerSchedules?.length ? m.prayerSchedules : hydrated.prayerSchedules,
          keepers: m.keepers?.length ? m.keepers : hydrated.keepers,
        };
      }
    }
    const isDefault = effectiveDefaultMosqueId() === m.id;
    const card = R.renderCard(m, { isDefault });
    if (isDefault) card.classList.add('is-default');
    card.addEventListener('click', (e) => {
      const nav = e.target.closest('[data-navigate]');
      if (nav && card.contains(nav)) {
        e.stopPropagation();
        e.preventDefault();
        openNavigation(m);
        return;
      }
      // Pill click flow: the "Set as default" button on the card is a
      // real <button> with data-set-default. Intercept here so the click
      // doesn't bubble to the card's openDetail handler — otherwise
      // tapping the pill would set the default AND open the drawer,
      // which feels like the user did two things by mistake.
      const pill = e.target.closest('[data-set-default]');
      if (pill && card.contains(pill)) {
        e.stopPropagation();
        e.preventDefault();
        if (pill.getAttribute('aria-pressed') === 'true') return; // already default
        setDefaultFromCard(m, pill);
        return;
      }
      openDetail(m.id);
    });
    card.addEventListener('keydown', (e) => {
      if (e.target.closest('[data-set-default], [data-navigate]')) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(m.id); }
    });
    return card;
  }

  // Card-level "Set as default" — same server contract as
  // setDefaultFromDrawer, just driven from the list view. Updates the
  // pill state in place, recomputes the hero, and refreshes any other
  // cards in the same list that previously held the default badge so
  // only one card shows "✓ Default" at a time.
  async function setDefaultFromCard(m, pillEl) {
    const id = m.id;
    setLocalDefaultMosqueId(id);
    view.defaultMosqueObj = m;
    if (getEmail()) {
      view.me = { ...(view.me || {}), defaultMosqueId: id };
    }

    // Optimistic UI: clear is-default off other cards, mark this one.
    document.querySelectorAll('.card.is-default').forEach(c => {
      if (c.dataset.id !== id) {
        c.classList.remove('is-default');
        const otherPill = c.querySelector('[data-set-default]');
        if (otherPill) {
          otherPill.classList.remove('is-default');
          otherPill.setAttribute('aria-pressed', 'false');
          otherPill.setAttribute('aria-label', `Set ${otherPill.closest('.card')?.querySelector('.card__name')?.textContent || 'this masjid'} as your default masjid`);
          otherPill.textContent = window.i18n?.t('card.makeDefault') ?? 'Set as default';
        }
      }
    });
    const card = pillEl.closest('.card');
    if (card) card.classList.add('is-default');
    pillEl.classList.add('is-default');
    pillEl.setAttribute('aria-pressed', 'true');
    pillEl.setAttribute('aria-label', `${R.prettifyMosqueName(m.name)} is your default masjid`);
    pillEl.textContent = window.i18n?.t('card.isDefault') ?? '✓ Default';

    renderHero();
    renderActivePanel();
    // Picking a default completes the "find my masjid" journey — take the
    // user straight home so they see the hero card showing their pick,
    // instead of leaving them on the map/list to back out manually.
    goHome();

    if (getEmail()) {
      try {
        const updated = await api.updateMyProfile({ defaultMosqueId: id });
        view.me = { ...(view.me || {}), ...updated, defaultMosqueId: id };
        renderActivePanel();
        toast(`${m.name} is now your default`);
      } catch (err) {
        toast(`${m.name} set locally — server sync failed: ${err.message}`);
      }
    } else {
      toast(`${m.name} is now your default on this device`);
    }
  }

  // One-time hint when the browser hands us a coarse (network/IP-level)
  // fix instead of GPS. The usual cause on Android is Chrome itself only
  // holding the "approximate location" OS grant — nothing a website can
  // upgrade programmatically, so tell the user where the switch lives.
  // Web-only: the native app requests precise location via the OS dialog.
  // Delayed so it doesn't fight the "N mosques within…" result toast.
  const STORAGE_COARSE_HINT = 'jamat.coarseLocationHintShown';
  function maybeHintCoarseLocation(accuracyMeters) {
    if (!Number.isFinite(accuracyMeters) || accuracyMeters <= 500) return;
    if (document.body.classList.contains('is-native')) return;
    try {
      if (localStorage.getItem(STORAGE_COARSE_HINT)) return;
      localStorage.setItem(STORAGE_COARSE_HINT, '1');
    } catch { return; }
    const km = Math.max(1, Math.round(accuracyMeters / 1000));
    setTimeout(() => {
      toast(
        `Your location looks approximate (~${km} km), so distances may be off. For exact results, allow "Precise location" for your browser in your phone's app settings.`,
        9000
      );
    }, 4000);
  }

  // ─── Locate ───
  function wireLocate() {
    const handle = async () => {
      // 1) Open the map view immediately. The user clicked "find mosques",
      //    they should see a map. Geolocation is enhancement, not gate.
      await openMap(null);

      // 2) Try to get their location in parallel. If we can't, the map is
      //    still useful — it shows all known mosques.
      if (!navigator.geolocation) {
        return toast('Your browser doesn\'t support location. Showing all masjids.');
      }

      // 3) Detect insecure-context up front so the toast is honest.
      const insecure = location.protocol !== 'https:'
        && !['localhost', '127.0.0.1'].includes(location.hostname);
      if (insecure) {
        toast('Mobile browsers need HTTPS for location. Showing all masjids.');
      } else {
        toast(window.i18n?.t('toast.locating') ?? 'Locating you…');
      }

      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const { latitude: lat, longitude: lng } = pos.coords;
          maybeHintCoarseLocation(pos.coords.accuracy);
          try {
            // Progressive radius expansion: try 25km, then 100km if empty.
            // Real users in well-populated areas hit the small radius;
            // testers and remote areas fall through to the wider one.
            let mosques = await api.getNearbyMosques(lat, lng, 25);
            let radiusUsed = 25;
            if (mosques.length === 0) {
              mosques = await api.getNearbyMosques(lat, lng, 100);
              radiusUsed = 100;
            }
            // Drop e2e test fixtures that share the same DB.
            view.nearby = mosques.filter(m => !R.isTestFixture(m));
            switchTab('nearby');
            populateMap({ lat, lng });
            populateMapList();
            // NOTE: do NOT call setView here — populateMap already fitBounds
            //       around user + mosques. Forcing setView would undo it.
            if (mosques.length === 0) {
              toast(`No mosques in our directory within 100km. Add one via "Submit a timing update".`);
            } else {
              toast(`${mosques.length} mosque${mosques.length === 1 ? '' : 's'} within ${radiusUsed}km`);
            }
          } catch (err) {
            toast(`Search failed: ${err.message}`);
          }
        },
        (err) => {
          // err.code: 1=PERMISSION_DENIED, 2=POSITION_UNAVAILABLE, 3=TIMEOUT
          const reasons = {
            1: 'Location permission was blocked.',
            2: 'Couldn\'t determine your location.',
            3: 'Location lookup timed out.',
          };
          toast(reasons[err.code] || `Location error: ${err.message}`);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    };

    $('#btn-locate').addEventListener('click', handle);
    $('#next-locate')?.addEventListener('click', handle);
    $('#empty-locate')?.addEventListener('click', handle);
  }

  // ─── Map view ───
  function wireMapToggle() {
    // The standalone "Open map" button is gone; map opens via the Locate flow.
    // We still wire the close-button + Escape so the user can dismiss the map.
    $('#map-close').addEventListener('click', closeMap);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && mapview.getAttribute('aria-hidden') === 'false') {
        if (view.addMode) exitAddMode();
        else closeMap();
      }
    });
    wireMapAdd();
    // GPS recenter button is added as a Leaflet control inside initMap;
    // no separate HTML element to wire here.
  }

  // ─── Click-to-add-a-mosque flow ───
  function wireMapAdd() {
    const addBtn = $('#map-add');
    const addHint = $('#map-addhint');
    const addForm = $('#map-addform');
    const cancelHint = $('#map-addhint-cancel');
    const cancelForm = $('#map-addform-cancel');
    const centerForm = $('#map-addform-center');
    const captchaRefresh = $('#map-addform-captcha-refresh');

    addBtn?.addEventListener('click', () => {
      if (view.addMode) exitAddMode();
      else enterAddMode();
    });
    cancelHint?.addEventListener('click', exitAddMode);
    cancelForm?.addEventListener('click', exitAddMode);
    centerForm?.addEventListener('click', setPendingPinFromMapCenter);
    $('#map-addform-gps')?.addEventListener('click', useMyLocationForAdd);
    captchaRefresh?.addEventListener('click', refreshAddCaptcha);
    // City/country/address auto-fill from the pin (reverse geocoding), but
    // a field the user typed in is theirs — stop auto-filling it.
    addForm?.querySelectorAll('[name="city"], [name="country"], [name="addressLine1"]').forEach(input => {
      input.addEventListener('input', () => { input.dataset.userEdited = 'true'; });
    });
    if (window.L && addForm) {
      L.DomEvent.disableClickPropagation(addForm);
      L.DomEvent.disableScrollPropagation(addForm);
    }
    if (window.L && addHint) L.DomEvent.disableClickPropagation(addHint);

    addForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      syncPendingPinFromMarker();
      if (!view.pendingPin) {
        toast('Place the pin on the map before adding the masjid.');
        $('#addform-help')?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        return;
      }
      if (!requireSignIn('add a masjid', () => addForm.requestSubmit())) return;
      const submitBtn = addForm.querySelector('button[type="submit"]');
      const fd = new FormData(addForm);
      const captchaAnswer = fd.get('captchaAnswer')?.toString().trim();
      if (!view.addCaptcha?.id || !captchaAnswer) {
        toast('Answer the human check before adding the masjid.');
        addForm.querySelector('[name="captchaAnswer"]')?.focus();
        return;
      }
      const payload = {
        name: fd.get('name')?.toString().trim(),
        city: fd.get('city')?.toString().trim(),
        country: fd.get('country')?.toString().trim(),
        addressLine1: fd.get('addressLine1')?.toString().trim() || undefined,
        latitude: view.pendingPin.lat,
        longitude: view.pendingPin.lng,
        captcha: { id: view.addCaptcha.id, answer: captchaAnswer },
      };
      if (!Number.isFinite(payload.latitude) || !Number.isFinite(payload.longitude)) {
        toast('Drop the pin again; the map did not give a valid location.');
        return;
      }
      try {
        if (submitBtn) submitBtn.disabled = true;
        const placed = { ...view.pendingPin };
        const created = await api.createMosque(payload);
        const createdLatLng = latLngFromMosque(created) || placed;
        // Refresh the visible list with the new mosque included.
        view.nearby = [created, ...view.nearby.filter(m => m.id !== created.id)];
        renderActivePanel();
        exitAddMode();
        addMosqueMarker(created);
        populateMapList();
        if (createdLatLng && view.map) {
          const zoom = Math.max(view.map.getZoom() || 16, 18);
          view.map.setView([createdLatLng.lat, createdLatLng.lng], zoom, { animate: true });
        }
        // Adding a masjid is almost always followed by adding its jamat
        // times — open the new masjid's page with the times form ready
        // instead of leaving the contributor parked on the map.
        toast(`Added ${created.name} — now add its jamat times`);
        await openDetail(created.id);
        openSubmitForm({ scroll: true });
      } catch (err) {
        toast(`Couldn't add masjid: ${err.message}`);
        if (/human check|captcha/i.test(err.message || '')) refreshAddCaptcha();
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  function enterAddMode() {
    if (!view.map) return toast('Open the map first');
    // The full-screen map can be opened from a hidden state. Refresh
    // Leaflet's cached size before converting taps into lat/lng values.
    view.map.invalidateSize();
    setTimeout(() => view.map?.invalidateSize(), 80);
    setTimeout(() => view.map?.invalidateSize(), 240);
    view.addMode = true;
    mapview.classList.add('is-adding');
    $('#map-add').setAttribute('aria-pressed', 'true');
    $('#map-addhint').hidden = true;
    const form = $('#map-addform');
    form.hidden = false;
    refreshAddCaptcha();
    focusAddModeOnGps();
    updatePendingPinCoords();
    view.map.off('click', onMapClickForAdd);
    view.map.on('click', onMapClickForAdd);
  }

  function exitAddMode() {
    view.addMode = false;
    mapview.classList.remove('is-adding');
    $('#map-add')?.setAttribute('aria-pressed', 'false');
    $('#map-addhint').hidden = true;
    $('#map-addform').hidden = true;
    if (view.pendingMarker) {
      view.map.removeLayer(view.pendingMarker);
      view.pendingMarker = null;
    }
    view.pendingPin = null;
    view.addCaptcha = null;
    view.map?.off('click', onMapClickForAdd);
    const addForm = $('#map-addform');
    addForm.reset?.();
    addForm?.querySelectorAll('[data-user-edited]').forEach(i => { delete i.dataset.userEdited; });
    updatePendingPinCoords();
  }

  async function refreshAddCaptcha() {
    const q = $('#addform-captcha-question');
    const input = $('#map-addform [name="captchaAnswer"]');
    if (q) q.textContent = 'Loading question...';
    if (input) input.value = '';
    view.addCaptcha = null;
    try {
      const challenge = await api.getMosqueCaptcha();
      view.addCaptcha = { id: challenge.id, question: challenge.question };
      if (q) q.textContent = challenge.question || 'Answer the question';
    } catch {
      if (q) q.textContent = 'Could not load. Tap Refresh.';
    }
  }

  function focusAddModeOnGps() {
    if (!view.map) return;
    if (view.lastUserPos) {
      setUserLocationOnMap(view.lastUserPos.lat, view.lastUserPos.lng, 17);
      return;
    }
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!view.addMode || !view.map) return;
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setUserLocationOnMap(lat, lng, 17);
        toast('Map centered on your location. Tap the exact masjid spot.');
      },
      () => {},
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  }

  function onMapClickForAdd(e) {
    if (!e?.latlng) return;
    setPendingPin(e.latlng.lat, e.latlng.lng);
    // Keep the details form visible while the location status changes.
    $('#map-addhint').hidden = true;
    const form = $('#map-addform');
    form.hidden = false;
    updatePendingPinCoords();
  }

  function setPendingPin(lat, lng) {
    lat = Number(lat);
    lng = Number(lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    view.pendingPin = { lat, lng };

    if (!view.pendingMarker) {
      const icon = makePinIcon('jamat-pin--temp');
      view.pendingMarker = L.marker([lat, lng], {
        icon,
        draggable: true,
        autoPan: true,
        riseOnHover: true,
        zIndexOffset: 1200,
        title: 'New masjid location',
      }).addTo(view.map);
      view.pendingMarker.on('drag dragend', () => {
        const p = view.pendingMarker.getLatLng();
        view.pendingPin = { lat: p.lat, lng: p.lng };
        updatePendingPinCoords();
      });
      // Geocode on dragend only (not during drag) — Nominatim etiquette
      // is ~1 request/second.
      view.pendingMarker.on('dragend', prefillAddressFromPin);
    } else {
      view.pendingMarker.setLatLng([lat, lng]);
    }
    updatePendingPinCoords();
    prefillAddressFromPin();
  }

  // Reverse-geocode the pending pin so the user doesn't have to type the
  // city/country the GPS position already implies. Best-effort: offline or
  // rate-limited lookups silently leave the fields for manual entry, and a
  // field the user already typed in is never overwritten.
  let addGeocodeSeq = 0;
  async function prefillAddressFromPin() {
    const pin = view.pendingPin;
    const form = $('#map-addform');
    if (!pin || !form || !view.addMode) return;
    const seq = ++addGeocodeSeq;
    try {
      const statusEl = $('#addform-location-status');
      if (statusEl) statusEl.textContent = 'Looking up location...';
      const data = await api.reverseGeocode(pin.lat, pin.lng);
      // A newer pin placement superseded this lookup, or the flow closed.
      if (seq !== addGeocodeSeq || !view.addMode) return;
      const setIfUntouched = (name, value) => {
        const input = form.querySelector(`[name="${name}"]`);
        if (!input || !value) return;
        if (input.dataset.userEdited === 'true' && input.value) return;
        input.value = value;
      };
      setIfUntouched('city', data.city || '');
      setIfUntouched('country', data.country || '');
      setIfUntouched('addressLine1', data.addressLine1 || '');
      if (statusEl) {
        statusEl.textContent = (data.city || data.country) ? 'Location details filled' : 'Pin selected';
      }
    } catch { /* offline — manual entry still works */ }
  }

  function setPendingPinFromMapCenter() {
    if (!view.map) return;
    view.map.invalidateSize();
    const center = view.map.getCenter();
    setPendingPin(center.lat, center.lng);
    $('#map-addhint').hidden = true;
  }

  // One-tap "Use my location" for the add-masjid form. Grabs GPS, drops the
  // pin there (which reverse-geocodes city/country), and centres the map so
  // the user sees it — the simplest possible path for someone standing at
  // the masjid, no map reading required.
  function useMyLocationForAdd() {
    const btn = $('#map-addform-gps');
    const statusEl = $('#addform-location-status');
    if (!navigator.geolocation) {
      toast('Location is not available on this device — tap the map instead.');
      return;
    }
    if (btn) { btn.disabled = true; btn.classList.add('is-busy'); }
    if (statusEl) statusEl.textContent = 'Finding your location…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (btn) { btn.disabled = false; btn.classList.remove('is-busy'); }
        const { latitude, longitude } = pos.coords;
        setPendingPin(latitude, longitude);
        try { view.map?.setView([latitude, longitude], 16); } catch {}
        $('#map-addhint').hidden = true;
      },
      (err) => {
        if (btn) { btn.disabled = false; btn.classList.remove('is-busy'); }
        if (statusEl) statusEl.textContent = 'No location selected';
        toast(err && err.code === 1
          ? 'Location permission denied — tap the map to place the pin instead.'
          : 'Could not get your location — tap the map instead.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  function syncPendingPinFromMarker() {
    if (!view.pendingMarker) return;
    const p = view.pendingMarker.getLatLng();
    if (p) view.pendingPin = { lat: p.lat, lng: p.lng };
  }

  function updatePendingPinCoords() {
    const coordsEl = $('#addform-coords');
    const statusEl = $('#addform-location-status');
    const form = $('#map-addform');
    if (!coordsEl) return;
    if (!view.pendingPin) {
      form?.classList.remove('has-pin');
      if (statusEl) statusEl.textContent = 'No location selected';
      coordsEl.textContent = 'Tap map or use center';
      return;
    }
    form?.classList.add('has-pin');
    if (statusEl) statusEl.textContent = 'Pin selected';
    coordsEl.textContent = `${view.pendingPin.lat.toFixed(6)}, ${view.pendingPin.lng.toFixed(6)}`;
  }

  async function openMap(userPos) {
    if (!location.hash.startsWith('#map') && !location.hash.startsWith('#mosque/')) {
      pushHash('map');
    }
    openMapInternal(userPos);
  }
  function openMapInternal(userPos) {
    mapview.setAttribute('aria-hidden', 'false');
    if (!view.map) initMap(userPos);
    populateMap(userPos);
    populateMapList();
    // Leaflet needs a size invalidate after the container becomes visible
    setTimeout(() => view.map?.invalidateSize(), 320);
  }
  function closeMap() {
    if (location.hash === '#map') history.back();
    else closeMapInternal();
  }
  function closeMapInternal() { mapview.setAttribute('aria-hidden', 'true'); }

  function initMap(userPos) {
    const start = userPos || (view.nearby[0]
      ? { lat: view.nearby[0].coordinates?.lat ?? view.nearby[0].latitude,
          lng: view.nearby[0].coordinates?.lng ?? view.nearby[0].longitude }
      : { lat: 33.7295, lng: 73.0372 }); // Faisal Mosque fallback
    view.map = L.map('map', { zoomControl: true, attributionControl: true })
      .setView([start.lat, start.lng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(view.map);

    // Auto-load mosques for whatever region the user pans/zooms to.
    // Debounced 1.5s so we don't fire on every panning frame; tracked
    // last-loaded center skips the fetch if the user only nudged.
    let panLoadTimer = null;
    view.map.on('moveend zoomend', () => {
      clearTimeout(panLoadTimer);
      panLoadTimer = setTimeout(loadMosquesForCurrentBounds, 1500);
    });

    // GPS recenter button — added as a Leaflet control so its stacking
    // and position are managed by Leaflet itself. Sits above the zoom
    // controls in the top-left. Tap = re-acquire location and zoom in.
    const GpsControl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd() {
        const btn = L.DomUtil.create('button', 'leaflet-bar mapview__gps');
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Recenter on my location');
        btn.title = 'Recenter on my location';
        btn.innerHTML =
          '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' +
            '<circle cx="12" cy="12" r="3" fill="currentColor"/>' +
            '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.7"/>' +
            '<path d="M12 1v3M12 20v3M1 12h3M20 12h3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
          '</svg>';
        L.DomEvent.disableClickPropagation(btn);
        L.DomEvent.on(btn, 'click', recenterOnGps);
        return btn;
      }
    });
    new GpsControl().addTo(view.map);
  }

  function recenterOnGps() {
    if (!navigator.geolocation || !view.map) return;
    const btn = document.querySelector('.mapview__gps');
    btn?.classList.add('is-locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        btn?.classList.remove('is-locating');
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        setUserLocationOnMap(lat, lng, 16);
      },
      () => {
        btn?.classList.remove('is-locating');
        toast('Couldn\'t get your location');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  }

  function setUserLocationOnMap(lat, lng, zoom = 16) {
    if (!view.map || !window.L) return;
    view.lastUserPos = { lat, lng };
    if (view.userMarker) view.map.removeLayer(view.userMarker);
    const userIcon = L.divIcon({
      className: '',
      html: '<div class="jamat-pin jamat-pin--user"></div>',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
    view.userMarker = L.marker([lat, lng], { icon: userIcon, title: 'You are here' }).addTo(view.map);
    view.map.setView([lat, lng], zoom);
  }

  // Track where we last loaded so a small jiggle doesn't trigger a refetch.
  let lastLoadedCenter = null;

  async function loadMosquesForCurrentBounds() {
    if (!view.map) return;
    const center = view.map.getCenter();

    // Skip if the user hasn't moved more than ~500 m since the last load
    // (under that, the result set will be the same anyway).
    if (lastLoadedCenter && lastLoadedCenter.distanceTo(center) < 500) return;

    // Radius = distance from center to a corner of the visible viewport,
    // clamped: at least 5 km (so a tight zoom still covers the obvious
    // surroundings) and at most 50 km (server caps results at 50 anyway).
    const bounds = view.map.getBounds();
    const radiusMeters = center.distanceTo(bounds.getNorthEast());
    const radiusKm = Math.min(Math.max(radiusMeters / 1000, 5), 50);

    let fetched;
    try {
      fetched = await api.getNearbyMosques(center.lat, center.lng, radiusKm);
    } catch (e) {
      toast(`Couldn't load: ${e?.message || 'network error'}`);
      return;
    }
    lastLoadedCenter = center;

    const existingIds = new Set(view.nearby.map(m => m.id));
    const newOnes = (fetched || [])
      .filter(m => !R.isTestFixture(m))
      .filter(m => !existingIds.has(m.id));

    if (newOnes.length > 0) {
      view.nearby = [...view.nearby, ...newOnes];
      newOnes.forEach(addMosqueMarker);
    }
    // Bound memory: a long panning session would otherwise accumulate markers
    // (DOM nodes + tooltip/popup listeners) and an ever-growing nearby list,
    // since this path only ever appended. Drop everything that has panned well
    // out of view. Only runs on map move/zoom, so the list view is untouched.
    pruneNearbyToViewport();
    populateMapList();
    if (newOnes.length > 0) {
      toast(`+${newOnes.length} mosque${newOnes.length === 1 ? '' : 's'} in this area`);
    }
  }

  // Remove markers + nearby entries outside an expanded viewport so the map
  // and the nearby list stay bounded while panning. Keeps a generous buffer
  // (no pop-in on small nudges) and always preserves the default/selected
  // masjid wherever they sit. Tooltips/popups/handlers are unbound before the
  // layer is removed so Leaflet doesn't retain them.
  function pruneNearbyToViewport() {
    if (!view.map || !Array.isArray(view.mosqueMarkers)) return;
    const keepBounds = view.map.getBounds().pad(0.75);
    const protectedIds = new Set(
      [effectiveDefaultMosqueId(), view.selected?.id].filter(Boolean)
    );

    const keptMarkers = [];
    for (const marker of view.mosqueMarkers) {
      const inView = keepBounds.contains(marker.getLatLng());
      if (inView || protectedIds.has(marker._jamatMosqueId)) {
        keptMarkers.push(marker);
        continue;
      }
      try {
        marker.unbindTooltip();
        marker.unbindPopup();
        marker.off();
        view.map.removeLayer(marker);
      } catch {}
    }
    view.mosqueMarkers = keptMarkers;

    // Mirror the prune into the data list so populateMap()/the list view don't
    // re-inflate the set we just dropped.
    view.nearby = view.nearby.filter((m) => {
      if (protectedIds.has(m.id)) return true;
      const pos = latLngFromMosque(m);
      if (!pos) return true; // keep unplaceable entries rather than silently drop
      return keepBounds.contains([pos.lat, pos.lng]);
    });
  }

  // Single-mosque marker creation, factored out of populateMap so both
  // the initial render and the pan-to-load path can share it without
  // wiping markers the user is already looking at.
  function addMosqueMarker(m) {
    const pos = latLngFromMosque(m);
    if (!pos) return null;
    const isDefault = effectiveDefaultMosqueId() === m.id;
    const icon = makePinIcon([
      isDefault ? 'jamat-pin--default' : '',
      m.status === 'closed' ? 'jamat-pin--closed' : '',
    ].filter(Boolean).join(' '));
    const marker = L.marker([pos.lat, pos.lng], { icon, title: m.name }).addTo(view.map);
    marker._jamatMosqueId = m.id;

    // Permanent label under the pin: name + next-takbeer time.
    const timings = R.timingsFromMosque(m);
    const next = timings ? R.computeNextPrayer(timings) : null;
    const labelLines = [escapeHtml(R.prettifyMosqueName(m.name))];
    if (m.status === 'closed') {
      labelLines.push(`<small>${escapeHtml(window.i18n?.t('card.closed') ?? 'Closed masjid')}</small>`);
    } else if (next) {
      labelLines.push(`<small>${escapeHtml(next.label)} · ${R.fmt12(next.time)}</small>`);
    }
    const tooltip = marker.bindTooltip(labelLines.join('<br/>'), {
      permanent: true,
      direction: 'bottom',
      offset: [0, 4],
      className: 'jamat-pin-label',
      interactive: true,
    });
    tooltip.on('click', () => openDetail(m.id));

    const dist = m.distanceKm != null ? `<div style="margin-top:4px;color:#76716A;font-family:JetBrains Mono,monospace;font-size:0.78rem">${R.fmtDistance(m.distanceKm)}</div>` : '';
    const cleanCity = R.isPlaceholderField(m.city) ? '' : m.city;
    const cleanCountry = R.isPlaceholderField(m.country) ? '' : m.country;
    const addr = [cleanCity, cleanCountry].filter(Boolean).join(', ');
    const cta = window.i18n?.t('map.popupOpen') ?? 'Open details →';
    const navTarget = navigationTarget(m);
    const navigateLabel = window.i18n?.t('nav.navigate') ?? 'Navigate to Masjid';
    marker.bindPopup(
      `<div class="jamat-popup">` +
        `<a href="#" data-open="${escapeHtml(m.id)}" class="jamat-popup-link">` +
          `<b>${escapeHtml(R.prettifyMosqueName(m.name))}</b>` +
          (m.status === 'closed' ? `<div class="jamat-popup-status">${escapeHtml(window.i18n?.t('card.closed') ?? 'Closed masjid')}</div>` : '') +
          (addr ? `<div>${escapeHtml(addr)}</div>` : '') +
          dist +
          `<span class="jamat-popup-cta">${escapeHtml(cta)}</span>` +
        `</a>` +
        (navTarget ? `<button class="jamat-popup-nav" type="button" data-navigate="${escapeHtml(m.id)}">${escapeHtml(navigateLabel)}</button>` : '') +
      `</div>`
    );
    marker.on('popupopen', (e) => {
      const popupEl = e.popup.getElement();
      popupEl.querySelector('[data-open]')?.addEventListener('click', (ev) => {
        ev.preventDefault();
        openDetail(m.id);
      });
      popupEl.querySelector('[data-navigate]')?.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        openNavigation(m);
      });
    });
    view.mosqueMarkers.push(marker);
    return marker;
  }

  function makePinIcon(modifier = '') {
    const isDefault = modifier.includes('jamat-pin--default');
    const size = isDefault ? 30 : 26;
    const iconWidth = size + 8;
    const tipY = Math.ceil(size * (0.5 + Math.SQRT1_2));
    const classes = ['jamat-pin', modifier].filter(Boolean).join(' ');
    return L.divIcon({
      className: 'jamat-pin-icon',
      html: `<div class="jamat-pin-wrap"><div class="${classes}"></div></div>`,
      iconSize: [iconWidth, tipY + 2],
      iconAnchor: [Math.round(iconWidth / 2), tipY],
      popupAnchor: [0, -tipY + 7],
      tooltipAnchor: [0, 4],
    });
  }

  function latLngFromMosque(m) {
    const lat = Number(m?.coordinates?.lat ?? m?.latitude);
    const lng = Number(m?.coordinates?.lng ?? m?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }

  function navigationTarget(m) {
    const pos = latLngFromMosque(m);
    if (!pos) return null;
    const destination = `${pos.lat},${pos.lng}`;
    const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
    const fallback = encodeURIComponent(webUrl);
    const intentUrl = `intent://maps.google.com/maps?daddr=${encodeURIComponent(destination)}&directionsmode=driving#Intent;scheme=https;package=com.google.android.apps.maps;S.browser_fallback_url=${fallback};end`;
    return { pos, webUrl, intentUrl };
  }

  async function openNavigation(m) {
    const target = navigationTarget(m);
    if (!target) {
      toast(window.i18n?.t('nav.unavailable') ?? 'Location is unavailable for this masjid.');
      return;
    }

    const isNative = window.Capacitor?.isNativePlatform?.();
    const nativeOpenUrl = window.Capacitor?.Plugins?.App?.openUrl;
    if (isNative && nativeOpenUrl) {
      try {
        const res = await nativeOpenUrl({ url: target.intentUrl });
        if (res?.completed) return;
      } catch {}
    }

    const opened = window.open(target.webUrl, '_blank', 'noopener,noreferrer');
    if (!opened) window.location.href = target.webUrl;
  }

  function populateMap(userPos) {
    if (userPos) view.lastUserPos = userPos;

    // Clear old mosque markers
    view.mosqueMarkers.forEach(m => view.map.removeLayer(m));
    view.mosqueMarkers = [];

    // User pin
    if (userPos) {
      const userIcon = L.divIcon({ className: '', html: '<div class="jamat-pin jamat-pin--user"></div>', iconSize: [16, 16], iconAnchor: [8, 8] });
      if (view.userMarker) view.map.removeLayer(view.userMarker);
      view.userMarker = L.marker([userPos.lat, userPos.lng], { icon: userIcon, title: 'You are here' }).addTo(view.map);
    }

    // Mosque pins
    const bounds = userPos ? [[userPos.lat, userPos.lng]] : [];
    view.nearby.forEach(m => {
      const pos = latLngFromMosque(m);
      if (!pos) return;
      addMosqueMarker(m);
      bounds.push([pos.lat, pos.lng]);
    });

    // Zoom logic — strictly user-first:
    //  - With GPS: always center on the user at street zoom (16). Don't
    //    fitBounds — in dense cities (Lahore, Cairo, Istanbul) there might
    //    be dozens of mosques within 1km, and fitBounds would zoom out to
    //    fit them all. The user wants to see what's near them right now.
    //    Distant pins stay on the map; pan/zoom-out to see them.
    //  - Without GPS: fit all returned mosques into view (browse mode).
    if (userPos) {
      view.map.setView([userPos.lat, userPos.lng], 16);
    } else if (view.mosqueMarkers.length > 0 && bounds.length > 1) {
      try { view.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 }); } catch {}
    }
  }

  function populateMapList() {
    const list = $('#mapview-list');
    list.innerHTML = '';
    view.nearby.forEach(m => {
      const card = makeCard(m);
      list.appendChild(card);
    });
  }

  // ─── Drawer / detail ───
  function wireDrawer() {
    document.querySelectorAll('[data-close-drawer]').forEach(el =>
      el.addEventListener('click', closeDrawer)
    );
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawer.getAttribute('aria-hidden') === 'false') closeDrawer();
    });
    drawerEls.favoriteBtn.addEventListener('click', toggleFavoriteFromDrawer);
    drawerEls.navigateBtn?.addEventListener('click', () => openNavigation(view.selected));
    drawerEls.setDefaultBtn.addEventListener('click', setDefaultFromDrawer);
    drawerEls.editBtn?.addEventListener('click', () => {
      if (!view.selected) return;
      drawerEls.submitForm.hidden = true;
      drawerEls.editForm.hidden = !drawerEls.editForm.hidden;
      if (!drawerEls.editForm.hidden) {
        prefillEditForm();
        drawerEls.editForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => drawerEls.editForm.querySelector('input[name="name"]')?.focus(), 240);
      }
    });
    drawerEls.renameBtn?.addEventListener('click', () => drawerEls.editBtn?.click());
    document.getElementById('keeper-credit-switch')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openKeeperScreen();
    });
    document.getElementById('keeper-credit')?.addEventListener('click', () => {
      openKeeperScreen();
    });
    document.getElementById('btn-close-keeper-screen')?.addEventListener('click', closeKeeperScreen);
    drawerEls.staleNudgeBtn?.addEventListener('click', openStaleNudge);
    drawerEls.rateBtn?.addEventListener('click', () => {
      if (!view.selected) return;
      openRatingModal(firstUnratedAmenityKind(view.selected));
    });
    drawerEls.editCancel?.addEventListener('click', () => { drawerEls.editForm.hidden = true; });
    drawerEls.editConfirm?.addEventListener('click', saveMosqueDetails);
    drawerEls.closeBtn?.addEventListener('click', () => setMosqueOpenStatus('closed'));
    drawerEls.reactivateBtn?.addEventListener('click', () => setMosqueOpenStatus('active'));
    drawerEls.submitToggleBtn.addEventListener('click', () => {
      toggleSubmitForm();
    });
    // Same effect, but from the prominent CTA inside the empty-times card.
    document.getElementById('btn-submit-from-empty')?.addEventListener('click', () => {
      openSubmitForm({ scroll: true });
    });
    document.getElementById('btn-submit-jumma-only')?.addEventListener('click', () => {
      openSubmitForm({ scroll: true, focusPrayer: 'jummah' });
    });
    drawerEls.submitCancel.addEventListener('click', () => { drawerEls.submitForm.hidden = true; });
    drawerEls.submitConfirm.addEventListener('click', submitTimings);
    wirePrayerTimeInputDefaults();
  }

  function wireMasjidRating() {
    if (!ratingEls.modal) return;
    ratingEls.modal.querySelectorAll('[data-close-rating]').forEach(el =>
      el.addEventListener('click', closeRatingModal)
    );
    ratingEls.kind?.addEventListener('change', () => {
      const saved = localAmenityRatings(view.selected)[ratingEls.kind.value] || 0;
      setPendingAmenityRating(saved);
    });
    ratingEls.stars?.querySelectorAll('[data-rating-value]').forEach(btn => {
      btn.addEventListener('click', () => setPendingAmenityRating(Number(btn.dataset.ratingValue) || 0));
    });
    ratingEls.save?.addEventListener('click', saveAmenityRating);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && ratingEls.modal.getAttribute('aria-hidden') === 'false') closeRatingModal();
    });
  }

  function wireNudgeSheet() {
    if (!nudgeEls.sheet) return;
    nudgeEls.sheet.querySelectorAll('[data-close-nudge]').forEach(el =>
      el.addEventListener('click', closeNudgeSheet)
    );
    nudgeEls.sendBtn?.addEventListener('click', sendNudge);
    nudgeEls.becomeBtn?.addEventListener('click', () => {
      closeNudgeSheet();
      openSubmitForm({ scroll: true });
    });
    nudgeTimeEls.popup?.querySelectorAll('[data-close-nudge-time]').forEach(el =>
      el.addEventListener('click', closeNudgeTimePopup)
    );
    nudgeTimeEls.applyBtn?.addEventListener('click', applyNudgeTimeEdit);
    nudgeTimeEls.clearBtn?.addEventListener('click', clearNudgeTimeEdit);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && nudgeEls.sheet.getAttribute('aria-hidden') === 'false') closeNudgeSheet();
      if (e.key === 'Escape' && nudgeTimeEls.popup?.getAttribute('aria-hidden') === 'false') closeNudgeTimePopup();
    });
  }

  function nudgeCurrentTimesFor(m, keeper) {
    const source = keeperWithComputedMaghrib(m, keeper).timings || {};
    return {
      fajr: source.fajr || null,
      dhuhr: source.dhuhr || source.zuhr || null,
      asr: source.asr || null,
      maghrib: source.maghrib || null,
      isha: source.isha || null,
      jummah: Array.isArray(source.jummah) ? source.jummah[0] : (source.jummah || null),
    };
  }

  function openNudgeSheet(keeper) {
    if (!nudgeEls.sheet || !view.selected || !keeper) return;
    const keeperName = R.prettifyPersonName(keeper.submitterName) || 'Time keeper';
    nudgeState = {
      keeper,
      currentTimes: nudgeCurrentTimesFor(view.selected, keeper),
      proposed: {},
    };
    if (nudgeEls.avatar) nudgeEls.avatar.textContent = keeperInitials(keeperName);
    if (nudgeEls.keeperName) nudgeEls.keeperName.textContent = keeperName;
    if (nudgeEls.masjidName) nudgeEls.masjidName.textContent = R.prettifyMosqueName(view.selected.name);
    renderNudgeRows();
    nudgeEls.sheet.setAttribute('aria-hidden', 'false');
  }

  function closeNudgeSheet() {
    nudgeEls.sheet?.setAttribute('aria-hidden', 'true');
    closeNudgeTimePopup();
  }

  function renderNudgeRows() {
    if (!nudgeEls.list) return;
    nudgeEls.list.innerHTML = '';
    const rows = [
      ['fajr', 'prayer.fajr', 'Fajr'],
      ['dhuhr', 'prayer.dhuhr', 'Dhuhr'],
      ['asr', 'prayer.asr', 'Asr'],
      ['maghrib', 'prayer.maghrib', 'Maghrib'],
      ['isha', 'prayer.isha', 'Isha'],
      ['jummah', 'prayer.jummah', 'Jummah'],
    ];
    rows.forEach(([key, i18nKey, fallback]) => {
      const current = nudgeState.currentTimes[key] || '';
      const proposed = nudgeState.proposed[key] || '';
      const edited = !!proposed && proposed !== current;
      const btn = R.el('button', {
        class: 'nudge-row' + (edited ? ' is-edited' : ''),
        type: 'button',
        onclick: () => openNudgeTimePopup(key, window.i18n?.t(i18nKey) ?? fallback),
      }, [
        R.el('span', { class: 'nudge-row__name' + (key === 'jummah' ? ' nudge-row__jummah' : '') }, window.i18n?.t(i18nKey) ?? fallback),
        R.el('span', { class: 'nudge-row__times' }, edited
          ? [
              R.el('span', { class: 'nudge-row__cur' }, current ? R.fmt12(current) : '—'),
              R.el('span', { class: 'nudge-row__arrow', 'aria-hidden': 'true' }, '→'),
              R.el('span', { class: 'nudge-row__new' }, R.fmt12(proposed)),
            ]
          : [R.el('span', { class: 'nudge-row__cur' }, current ? R.fmt12(current) : '—')]),
        R.el('span', { class: 'nudge-row__chip', 'aria-hidden': 'true' }, edited ? '✓' : '✎'),
      ]);
      nudgeEls.list.appendChild(R.el('li', {}, btn));
    });
    const count = Object.keys(nudgeState.proposed).length;
    if (nudgeEls.count) nudgeEls.count.textContent = String(count);
    if (nudgeEls.summary) nudgeEls.summary.hidden = count === 0;
  }

  function openNudgeTimePopup(key, label) {
    if (!nudgeTimeEls.popup || !key) return;
    nudgeEditingPrayer = key;
    const current = nudgeState.currentTimes[key] || '';
    const proposed = nudgeState.proposed[key] || '';
    if (nudgeTimeEls.title) nudgeTimeEls.title.textContent = label || key;
    if (nudgeTimeEls.current) nudgeTimeEls.current.textContent = current ? R.fmt12(current) : '—';
    if (nudgeTimeEls.input) nudgeTimeEls.input.value = proposed || current || '';
    nudgeTimeEls.popup.setAttribute('aria-hidden', 'false');
    setTimeout(() => nudgeTimeEls.input?.focus(), 60);
  }

  function closeNudgeTimePopup() {
    if (!nudgeTimeEls.popup) return;
    nudgeTimeEls.popup.setAttribute('aria-hidden', 'true');
    nudgeEditingPrayer = null;
  }

  function applyNudgeTimeEdit() {
    if (!nudgeEditingPrayer || !nudgeTimeEls.input) return;
    const key = nudgeEditingPrayer;
    const value = nudgeTimeEls.input.value;
    const current = nudgeState.currentTimes[key] || '';
    if (!value || value === current) delete nudgeState.proposed[key];
    else nudgeState.proposed[key] = value;
    closeNudgeTimePopup();
    renderNudgeRows();
  }

  function clearNudgeTimeEdit() {
    if (nudgeEditingPrayer) delete nudgeState.proposed[nudgeEditingPrayer];
    closeNudgeTimePopup();
    renderNudgeRows();
  }

  function proposedMaghribOffset(value) {
    if (!view.selected || !value || !window.sun?.sunsetForCoords) return null;
    const lat = view.selected.coordinates?.lat ?? view.selected.latitude;
    const lng = view.selected.coordinates?.lng ?? view.selected.longitude;
    const sunset = window.sun.sunsetForCoords(lat, lng);
    const match = String(value).match(/^(\d{1,2}):(\d{2})$/);
    const parsed = match ? { h: Number(match[1]), min: Number(match[2]) } : null;
    if (!sunset || !parsed) return null;
    const proposed = new Date(sunset);
    proposed.setHours(parsed.h, parsed.min, 0, 0);
    const offset = Math.round((proposed.getTime() - sunset.getTime()) / 60_000);
    return Math.max(0, Math.min(60, offset));
  }

  async function sendNudge() {
    if (!view.selected || !nudgeState.keeper) return;
    if (!requireSignIn('send a timing nudge', () => sendNudge())) return;
    const proposed = nudgeState.proposed || {};
    const keeper = nudgeState.keeper;
    const timings = Object.keys(proposed).reduce((acc, key) => {
      if (key === 'maghrib') {
        const offset = proposedMaghribOffset(proposed[key]);
        if (offset != null) acc.maghribOffset = offset;
      } else {
        acc[key] = proposed[key];
      }
      return acc;
    }, {});
    nudgeEls.sendBtn.disabled = true;
    try {
      await api.createSuggestion({
        toUserId: keeper.submitterId,
        mosqueId: view.selected.id,
        timings,
        notes: Object.keys(timings).length
          ? 'Timing nudge from stale-times flow.'
          : 'Please refresh these masjid timings when you can.',
      });
      closeNudgeSheet();
      toast(window.i18n?.t('nudge.sentBody', { name: R.prettifyPersonName(keeper.submitterName) || 'The time keeper' }) ?? 'Nudge sent.');
    } catch (err) {
      toast(err?.message || 'Could not send nudge');
    } finally {
      nudgeEls.sendBtn.disabled = false;
    }
  }

  function amenityRatingStorageKey(m) {
    return m?.id ? `${AMENITY_RATING_STORAGE}:${m.id}` : null;
  }

  function localAmenityRatings(m) {
    const key = amenityRatingStorageKey(m);
    if (!key) return {};
    try {
      const rows = JSON.parse(localStorage.getItem(key) || '{}');
      return rows && typeof rows === 'object' ? rows : {};
    } catch {
      return {};
    }
  }

  function saveLocalAmenityRatings(m, rows) {
    const key = amenityRatingStorageKey(m);
    if (!key) return;
    localStorage.setItem(key, JSON.stringify(rows || {}));
  }

  function mergedAmenityRatings(m) {
    const base = m?.amenityRatings || {};
    const mine = localAmenityRatings(m);
    const out = { ...base };
    AMENITY_KINDS.forEach(kind => {
      const own = Number(mine[kind]) || 0;
      if (!own) return;
      const existing = base[kind] || {};
      const count = Number(existing.count) || 0;
      const avg = Number(existing.avg) || 0;
      if (count > 0) {
        out[kind] = {
          ...existing,
          avg: (avg * count + own) / (count + 1),
          count: count + 1,
          myRating: own,
        };
      } else {
        out[kind] = { ...existing, avg: own, count: 1, myRating: own };
      }
    });
    return out;
  }

  function firstUnratedAmenityKind(m) {
    const mine = localAmenityRatings(m);
    return AMENITY_KINDS.find(kind => !mine[kind]) || 'size';
  }

  function openRatingModal(kind = 'size') {
    if (!ratingEls.modal || !view.selected) return;
    const selectedKind = AMENITY_KINDS.includes(kind) ? kind : 'size';
    if (ratingEls.target) ratingEls.target.textContent = R.prettifyMosqueName(view.selected.name);
    if (ratingEls.kind) ratingEls.kind.value = selectedKind;
    setPendingAmenityRating(localAmenityRatings(view.selected)[selectedKind] || 0);
    ratingEls.modal.setAttribute('aria-hidden', 'false');
  }

  function closeRatingModal() {
    ratingEls.modal?.setAttribute('aria-hidden', 'true');
  }

  function setPendingAmenityRating(value) {
    pendingAmenityRating = Math.max(0, Math.min(5, Number(value) || 0));
    ratingEls.stars?.querySelectorAll('[data-rating-value]').forEach(btn => {
      const active = Number(btn.dataset.ratingValue) <= pendingAmenityRating;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-checked', Number(btn.dataset.ratingValue) === pendingAmenityRating ? 'true' : 'false');
    });
  }

  function buildMosqueReviewPayload(rows) {
    const values = AMENITY_KINDS
      .map(kind => Number(rows[kind]) || 0)
      .filter(Boolean);
    const overall = Number(rows.size) || Math.round(values.reduce((sum, n) => sum + n, 0) / Math.max(1, values.length)) || 5;
    const cleanlinessValues = [Number(rows.wudu) || 0, Number(rows.washrooms) || 0].filter(Boolean);
    const payload = { rating: Math.max(1, Math.min(5, overall)) };
    if (cleanlinessValues.length) {
      payload.cleanlinessRating = Math.round(cleanlinessValues.reduce((sum, n) => sum + n, 0) / cleanlinessValues.length);
    }
    if (Number(rows.accessibility)) payload.accessibilityRating = Number(rows.accessibility);
    return payload;
  }

  async function saveAmenityRating() {
    if (!view.selected) return;
    if (!pendingAmenityRating) {
      toast('Choose a rating first.');
      return;
    }
    const kind = ratingEls.kind?.value || 'size';
    const rows = localAmenityRatings(view.selected);
    rows[kind] = pendingAmenityRating;
    saveLocalAmenityRatings(view.selected, rows);
    renderAmenitySection(view.selected);
    closeRatingModal();
    if (isSignedInForServerSync() && window.api?.submitMosqueReview) {
      try {
        await api.submitMosqueReview(view.selected.id, buildMosqueReviewPayload(rows));
        toast(`${AMENITY_LABELS[kind] || 'Masjid detail'} rating published.`);
        return;
      } catch (err) {
        toast(`Saved on this device. Publish failed: ${err.message}`);
        return;
      }
    }
    toast(`${AMENITY_LABELS[kind] || 'Masjid detail'} rating saved on this device.`);
  }

  function wirePrayerTimeInputDefaults() {
    const seed = (target) => {
      if (!target?.matches?.('input[type="time"][name]') || target.value) return;
      const defaultValue = R.defaultSubmittedPrayerTime?.(target.name);
      if (defaultValue) target.value = defaultValue;
    };
    document.addEventListener('pointerdown', (e) => seed(e.target), { capture: true });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') seed(e.target);
    }, { capture: true });
  }

  async function openDetail(id) {
    if (!location.hash.startsWith(`#mosque/${id}`)) {
      pushHash(`mosque/${id}`);
    }
    return openDetailInternal(id);
  }

  function keeperSourceHint(m) {
    if (!m?.effectiveKeeperId) return '';
    const updated = m.effectiveKeeperUpdatedAt
      ? new Date(m.effectiveKeeperUpdatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : '';
    if (m.preferredKeeperId === m.effectiveKeeperId) {
      return updated ? `Tap to change · Updated ${updated}` : 'Tap to change keeper';
    }
    if (m.effectiveKeeperIsCurrentSchedule) {
      const label = m.effectiveKeeperIsVerifiedSchedule
        ? 'Verified schedule'
        : 'Current schedule';
      return updated ? `${label} · Updated ${updated}` : label;
    }
    if (m.effectiveKeeperSource === 'prayerSchedule') {
      return updated ? `Schedule history · Updated ${updated}` : 'Schedule history';
    }
    return updated ? `Top trusted · Updated ${updated}` : 'Top trusted';
  }

  function effectiveKeeperForMosque(m) {
    if (!m?.keepers?.length) return null;
    return m.keepers.find(k => k.submitterId === m.effectiveKeeperId)
      || m.keepers[0]
      || null;
  }

  function daysSince(value) {
    if (!value) return null;
    const ms = Date.now() - new Date(value).getTime();
    if (!Number.isFinite(ms)) return null;
    return Math.max(0, Math.floor(ms / 86_400_000));
  }

  function keeperInitials(name) {
    return (R.prettifyPersonName(name) || 'TK')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0]?.toUpperCase())
      .join('') || 'TK';
  }

  function keeperStarRating(keeper) {
    const raw = Number(keeper?.rating) || 0;
    const stars = raw <= 5 ? raw : Math.min(5, raw / 4);
    return stars.toFixed(1);
  }

  function keeperWithComputedMaghrib(m, keeper) {
    const timings = { ...(keeper?.timings || {}) };
    if (!timings.maghrib && window.sun?.maghribForMosque) {
      const offset = timings.maghribOffset
        ?? m?.effectiveTimings?.maghribOffset
        ?? m?.defaultJamaatTimings?.maghribOffset
        ?? 0;
      const maghrib = window.sun.maghribForMosque(m, undefined, offset);
      if (maghrib) timings.maghrib = maghrib;
    }
    return { ...keeper, timings };
  }

  function renderAmenitySection(m) {
    if (!drawerEls.amenities) return;
    drawerEls.amenities.innerHTML = '';
    const ratedMosque = { ...m, amenityRatings: mergedAmenityRatings(m) };
    R.renderAmenities(ratedMosque).forEach(li => {
      const open = () => openRatingModal(li.dataset.kind);
      li.addEventListener('click', open);
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      });
      drawerEls.amenities.appendChild(li);
    });
  }

  function openStaleNudge() {
    if (!view.selected) return;
    const keeper = effectiveKeeperForMosque(view.selected);
    if (keeper) {
      openNudgeSheet(keeper);
    } else {
      openSubmitForm({ scroll: true });
    }
  }

  function paintDrawer(m) {
    view.selected = m;
    closeKeeperScreen();
    const isClosed = m.status === 'closed';
    const isDefault = effectiveDefaultMosqueId() === m.id;
    const editable = canEditMosque(m);
    const displayName = R.prettifyMosqueName(m.name);
    drawer.classList.toggle('is-closed', isClosed);
    drawerEls.title.textContent = displayName;
    // Filter out OSM placeholders ("Unknown") in addition to falsy values
    // so the drawer doesn't show "Unknown · Unknown · Pakistan".
    drawerEls.addr.textContent = [m.address, m.city, m.country]
      .filter(v => v && !R.isPlaceholderField(v))
      .join(' · ') || (window.i18n?.t('drawer.distanceUnknown') ?? 'nearby');
    if (drawerEls.status) {
      const unnamedLabel = window.i18n?.t('mosque.unnamed') ?? 'Unnamed masjid';
      const isUnnamed = displayName === unnamedLabel || R.isPlaceholderField(m.name);
      drawerEls.status.textContent = isClosed
        ? 'Closed masjid'
        : isDefault
          ? (window.i18n?.t('drawer.statusDefault') ?? 'Your default')
          : isUnnamed
            ? (window.i18n?.t('drawer.statusCommunity') ?? 'Community masjid')
            : (window.i18n?.t('drawer.statusMasjid') ?? 'Masjid');
    }
    drawerEls.distance.textContent = isClosed
      ? 'Times kept for community review'
      : (m.distanceKm != null ? R.fmtDistance(m.distanceKm) : (window.i18n?.t('drawer.distanceUnknown') ?? 'nearby'));
    if (drawerEls.renameBtn) {
      const unnamedLabel = window.i18n?.t('mosque.unnamed') ?? 'Unnamed masjid';
      drawerEls.renameBtn.hidden = !(editable && (displayName === unnamedLabel || m.canEditNameOnly));
    }
    const navTarget = navigationTarget(m);
    if (drawerEls.navigateBtn) {
      drawerEls.navigateBtn.hidden = !navTarget;
      drawerEls.navigateBtn.disabled = !navTarget;
      if (navTarget) {
        drawerEls.navigateBtn.setAttribute('aria-label',
          window.i18n?.t('nav.navigateTo', { name: R.prettifyMosqueName(m.name) })
            ?? `Open directions to ${R.prettifyMosqueName(m.name)} in Google Maps`);
      }
    }

    drawerEls.times.innerHTML = '';
    // Use the same resolver as the hero so the two surfaces never drift:
    // timingsFromMosque() prefers the effective (preferred/top keeper)
    // schedule, falls back to the master record per-prayer, AND computes
    // Maghrib from the keeper's sunset offset. The drawer previously read
    // effectiveTimings raw, which silently dropped the computed Maghrib row.
    const timings = R.timingsFromMosque(m);
    refreshSubmitCopy(m);
    const timesEmpty = document.getElementById('times-empty');
    const timesTable = drawerEls.times.parentElement;
    const credit = document.getElementById('keeper-credit');
    const creditAvatar = document.getElementById('keeper-credit-avatar');
    const creditName = document.getElementById('keeper-credit-name');
    const creditRating = document.getElementById('keeper-credit-rating');
    const creditHint = document.getElementById('keeper-credit-hint');
    const creditCount = document.getElementById('keeper-credit-count');
    const effectiveKeeper = effectiveKeeperForMosque(m);
    const updatedDays = daysSince(m.effectiveKeeperUpdatedAt || effectiveKeeper?.updatedAt || effectiveKeeper?.submittedAt || effectiveKeeper?.latestSubmittedAt);
    if (timings) {
      R.renderTimingsTable(timings).forEach(row => drawerEls.times.appendChild(row));
      timesTable.style.display = '';
      if (timesEmpty) timesEmpty.hidden = true;
      if (drawerEls.timesUpdated) {
        drawerEls.timesUpdated.hidden = updatedDays == null;
        drawerEls.timesUpdated.textContent = updatedDays == null
          ? ''
          : updatedDays === 0
            ? 'updated today'
            : `updated ${updatedDays} days ago`;
      }
      if (m.effectiveKeeperName && credit) {
        credit.hidden = false;
        const keeperName = R.prettifyPersonName(m.effectiveKeeperName);
        creditName.textContent = keeperName;
        if (creditAvatar) creditAvatar.textContent = keeperInitials(keeperName);
        if (creditRating) creditRating.textContent = `★ ${keeperStarRating(effectiveKeeper)}`;
        creditHint.textContent = keeperSourceHint(m);
        if (creditCount) {
          const otherCount = Math.max(0, (m.keepers?.length || 0) - 1);
          creditCount.textContent = otherCount ? ` · ${otherCount} other keeper${otherCount === 1 ? '' : 's'}` : '';
        }
      } else if (credit) {
        credit.hidden = true;
      }
      const isStale = updatedDays != null && updatedDays > 30;
      credit?.classList.toggle('is-stale', isStale);
      if (drawerEls.stalePill) {
        const keeperName = m.effectiveKeeperName || effectiveKeeper?.submitterName;
        drawerEls.stalePill.hidden = !keeperName;
        if (drawerEls.staleKeeperName) {
          drawerEls.staleKeeperName.textContent = keeperName ? R.prettifyPersonName(keeperName) : 'the keeper';
        }
      }
    } else {
      timesTable.style.display = 'none';
      if (timesEmpty) timesEmpty.hidden = false;
      if (credit) credit.hidden = true;
      credit?.classList.remove('is-stale');
      if (drawerEls.timesUpdated) drawerEls.timesUpdated.hidden = true;
      if (drawerEls.stalePill) drawerEls.stalePill.hidden = true;
    }

    // Keeper list
    const keepers = m.keepers || [];
    const keepersSection = document.getElementById('keepers-section');
    const keepersList = document.getElementById('keepers-list');
    if (keepers.length > 0 && keepersSection && keepersList) {
      keepersSection.hidden = false;
      keepersList.innerHTML = '';
      const topKeeperId = keepers[0].submitterId;
      keepers.forEach(k => {
        const keeperForRender = keeperWithComputedMaghrib(m, k);
        const node = R.renderKeeper(keeperForRender, {
          effectiveKeeperId: m.effectiveKeeperId,
          preferredKeeperId: m.preferredKeeperId,
          topKeeperId,
          currentUserId: view.me?.id,
          onFollow: (keeper) => followKeeper(m.id, keeper.submitterId),
          onVote: (keeper, voteType) => voteOnKeeper(m.id, keeper, voteType),
          onSuggest: (keeper) => openSuggestModal(keeper),
          onSelfUpdate: () => openOwnTimingUpdateForm(),
          onWithdraw: (keeper) => withdrawKeeper(m.id, keeper),
        });
        keepersList.appendChild(node);
      });
    } else if (keepersSection) {
      keepersSection.hidden = true;
    }

    renderAmenitySection(m);

    const isFav = !!m.isFavorite;
    drawerEls.favoriteBtn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
    drawerEls.favoriteBtn.querySelector('span').textContent = isFav ? 'Saved' : 'Save to favorites';

    drawerEls.setDefaultBtn.setAttribute('aria-pressed', isDefault ? 'true' : 'false');
    const defaultLabel = drawerEls.setDefaultBtn.querySelector('span:last-child') || drawerEls.setDefaultBtn;
    defaultLabel.textContent = isDefault
      ? (window.i18n?.t('drawer.defaultActive') ?? '✓ Your default masjid')
      : (window.i18n?.t('drawer.makeDefault') ?? 'Make this my default');

    if (drawerEls.editBtn) drawerEls.editBtn.hidden = !editable;
    if (drawerEls.editBtn) {
      const unnamedLabel = window.i18n?.t('mosque.unnamed') ?? 'Unnamed masjid';
      drawerEls.editBtn.textContent = m.canEditNameOnly
        ? (R.prettifyMosqueName(m.name) === unnamedLabel ? 'Name this masjid' : 'Rename masjid')
        : 'Edit masjid details';
    }
    if (drawerEls.closeBtn) {
      drawerEls.closeBtn.hidden = !m.canClose;
      drawerEls.closeBtn.textContent = window.i18n?.t('drawer.closedForever') ?? 'This masjid has closed forever';
    }
    if (drawerEls.reactivateBtn) drawerEls.reactivateBtn.hidden = !m.canReactivate;
    if (!editable && drawerEls.editForm) drawerEls.editForm.hidden = true;
  }

  function canEditMosque(m) {
    if (!getEmail() || !m) return false;
    if (m.canEdit === true) return true;
    if (m.canRename === true) return true;
    return !!(view.me?.id && m.addedById && m.addedById === view.me.id);
  }

  function openOwnTimingUpdateForm() {
    if (!drawerEls.submitForm) return;
    closeKeeperScreen();
    openSubmitForm({ scroll: true });
  }

  function openKeeperScreen() {
    const section = document.getElementById('keepers-section');
    const list = document.getElementById('keepers-list');
    if (!section || !list || section.hidden || !list.children.length) return;
    const name = document.getElementById('keepers-screen-masjid');
    if (name) name.textContent = view.selected ? R.prettifyMosqueName(view.selected.name) : '';
    drawer.classList.add('is-keeper-screen');
    drawerEls.submitForm.hidden = true;
    drawerEls.editForm.hidden = true;
    const panel = drawer.querySelector('.drawer__panel');
    if (panel) panel.scrollTop = 0;
  }

  function closeKeeperScreen() {
    drawer.classList.remove('is-keeper-screen');
  }

  function prefillEditForm() {
    if (!view.selected || !drawerEls.editForm) return;
    const form = drawerEls.editForm;
    const nameOnly = !!view.selected.canEditNameOnly;
    const set = (name, value) => {
      const input = form.querySelector(`[name="${name}"]`);
      if (input) input.value = value || '';
    };
    const setDisabled = (name, disabled) => {
      const input = form.querySelector(`[name="${name}"]`);
      if (!input) return;
      input.disabled = disabled;
      input.closest('label')?.classList.toggle('is-disabled', disabled);
    };
    set('name', view.selected.name);
    set('city', view.selected.city);
    set('country', view.selected.country);
    set('addressLine1', view.selected.address || view.selected.addressLine1);
    setDisabled('city', nameOnly);
    setDisabled('country', nameOnly);
    setDisabled('addressLine1', nameOnly);
    if (drawerEls.editHint) {
      drawerEls.editHint.textContent = nameOnly
        ? 'This masjid is unnamed or community-named. You can update only its name here. The first person who gives an unnamed masjid a real name becomes the future name editor; the highest-rated time keeper can also rename it.'
        : 'You can edit the masjid details you added.';
    }
  }

  async function saveMosqueDetails() {
    if (!view.selected || !drawerEls.editForm) return;
    if (!requireSignIn('edit this masjid', () => saveMosqueDetails())) return;
    if (!canEditMosque(view.selected)) return toast('Only the contributor, first namer, or highest-rated time keeper can edit this masjid name.');

    const form = drawerEls.editForm;
    const get = (name) => form.querySelector(`[name="${name}"]`)?.value?.trim() || '';
    const nameOnly = !!view.selected.canEditNameOnly;
    const payload = nameOnly
      ? { name: get('name') }
      : {
          name: get('name'),
          city: get('city'),
          country: get('country'),
          addressLine1: get('addressLine1') || undefined,
        };
    if (!payload.name || (!nameOnly && (!payload.city || !payload.country))) {
      return toast(nameOnly ? 'Please enter the real masjid name.' : 'Name, city, and country are required.');
    }

    const saveBtn = drawerEls.editConfirm;
    try {
      if (saveBtn) saveBtn.disabled = true;
      const updated = await api.updateMosque(view.selected.id, payload);
      replaceMosqueEverywhere({ ...view.selected, ...updated });
      drawerEls.editForm.hidden = true;
      toast(`Updated ${updated.name}`);
    } catch (err) {
      toast(`Update failed: ${err.message}`);
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  async function setMosqueOpenStatus(status) {
    if (!view.selected) return;
    const isClosing = status === 'closed';
    const allowed = isClosing ? view.selected.canClose : view.selected.canReactivate;
    if (!requireSignIn(
      isClosing ? 'mark this masjid as permanently closed' : 'reactivate this masjid',
      () => setMosqueOpenStatus(status)
    )) return;
    if (!allowed) {
      return toast('Only the current highest-rated time keeper can permanently close or reactivate this masjid.');
    }
    if (isClosing) {
      const first = window.prompt(
        `This action says "${R.prettifyMosqueName(view.selected.name)}" has closed forever.\n\nType CLOSED to continue.`
      );
      if (first === null) return;
      if (first.trim() !== 'CLOSED') {
        return toast('Permanent closure cancelled. You must type CLOSED exactly.');
      }
      const second = window.prompt(
        'The masjid will be shown as permanently closed. Are you sure? This is a major step.\n\nType sure to confirm.'
      );
      if (second === null) return;
      if (second.trim() !== 'sure') {
        return toast('Permanent closure cancelled. You must type sure exactly.');
      }
    } else if (!window.confirm('This will show the masjid as open again. Continue?')) {
      return;
    }

    const btn = isClosing ? drawerEls.closeBtn : drawerEls.reactivateBtn;
    try {
      if (btn) btn.disabled = true;
      const statusResult = await api.setMosqueStatus(view.selected.id, status);
      let updated = statusResult;
      try {
        updated = {
          ...(await api.getMosque(view.selected.id)),
          replacementKeeperName: statusResult.replacementKeeperName,
        };
      } catch {
        // The status change already succeeded; keep the partial response
        // rather than leaving the drawer stale.
      }
      replaceMosqueEverywhere({ ...view.selected, ...updated });
      const replacement = statusResult.replacementKeeperName ? ` ${R.prettifyPersonName(statusResult.replacementKeeperName)} is now the default time keeper.` : '';
      toast(isClosing ? `Masjid marked permanently closed.${replacement} People can still vote/select time keepers.` : 'Masjid reactivated.');
    } catch (err) {
      toast(`Status update failed: ${err.message}`);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function replaceMosqueEverywhere(m) {
    const merge = (x) => x.id === m.id ? { ...x, ...m } : x;
    view.nearby = view.nearby.map(merge);
    view.favorites = view.favorites.map(merge);
    if (view.selected?.id === m.id) view.selected = { ...view.selected, ...m };
    if (view.defaultMosqueObj?.id === m.id) {
      view.defaultMosqueObj = { ...view.defaultMosqueObj, ...m };
      renderHero();
    }
    try { storage.saveMosqueCache?.(view.selected?.id === m.id ? view.selected : m); } catch {}
    if (view.selected?.id === m.id) paintDrawer(view.selected);
    renderActivePanel();
    populateMapList();
    refreshMosqueMarker(m);
  }

  function refreshMosqueMarker(m) {
    if (!view.map || !Array.isArray(view.mosqueMarkers)) return;
    const keep = [];
    for (const marker of view.mosqueMarkers) {
      if (marker._jamatMosqueId === m.id) {
        try { view.map.removeLayer(marker); } catch {}
      } else {
        keep.push(marker);
      }
    }
    view.mosqueMarkers = keep;
    if (latLngFromMosque(m)) addMosqueMarker(m);
  }

  async function openDetailInternal(id) {
    // Paint the cached version immediately so the drawer never blanks
    // out on slow networks or transient API failures. The fresh fetch
    // below will repaint over it once it lands.
    const cached = storage.getMosqueCache?.(id);
    if (cached) {
      paintDrawer(cached);
      drawerEls.submitForm.hidden = true;
      drawerEls.editForm.hidden = true;
      drawer.setAttribute('aria-hidden', 'false');
    }
    try {
      const m = await api.getMosque(id);
      replaceMosqueEverywhere(m);
      paintDrawer(m);
      drawerEls.submitForm.hidden = true;
      drawerEls.editForm.hidden = true;
      drawerEls.contributors.innerHTML = '<li class="muted">Loading…</li>';
      drawer.setAttribute('aria-hidden', 'false');
      loadContributors(id);
    } catch (err) {
      if (cached) {
        // Keep the cached drawer up; just let the user know we're offline.
        toast(`Showing saved data — couldn't refresh: ${err.message}`);
        loadContributors(id);
      } else {
        toast(`Couldn't load masjid: ${err.message}`);
      }
    }
  }
  function closeDrawer() {
    if (location.hash.startsWith('#mosque/')) history.back();
    else closeDrawerInternal();
  }
  function closeDrawerInternal() {
    closeKeeperScreen();
    drawer.setAttribute('aria-hidden', 'true');
    view.selected = null;
  }

  async function loadContributors(mosqueId) {
    try {
      const submissions = await api.listSubmissionsForMosque(mosqueId);
      drawerEls.contributors.innerHTML = '';
      if (!submissions.length) {
        drawerEls.contributors.appendChild(R.el('li', { class: 'muted' }, 'No submissions yet.'));
        return;
      }
      submissions.forEach(s => {
        const when = new Date(s.createdAt || s.created_at);
        drawerEls.contributors.appendChild(R.el('li', {}, [
          R.el('span', { class: 'who' }, R.prettifyPersonName(s.submittedBy?.fullName) || 'Anonymous'),
          R.el('span', { class: 'when' }, isNaN(+when) ? '' : when.toLocaleDateString()),
          s.notes ? R.el('span', { class: 'note' }, `“${s.notes}”`) : null,
        ]));
      });
    } catch {
      drawerEls.contributors.innerHTML = '<li class="muted">Couldn\'t load submissions.</li>';
    }
  }

  async function toggleFavoriteFromDrawer() {
    if (!view.selected) return;
    // Favorites currently live server-side only — gate them. (Future:
    // refactor to local-first like default mosque + reminders.)
    if (!requireSignIn('save favorites', () => toggleFavoriteFromDrawer())) return;
    try {
      const res = await api.toggleFavorite(view.selected.id);
      const saved = !!res.favorite;
      view.selected.isFavorite = saved;
      drawerEls.favoriteBtn.setAttribute('aria-pressed', saved ? 'true' : 'false');
      drawerEls.favoriteBtn.querySelector('span').textContent = saved ? 'Saved' : 'Save to favorites';
      await loadFavorites();
      renderActivePanel();
      toast(saved ? `Saved ${view.selected.name}` : 'Removed from favorites');
    } catch (err) {
      toast(`Favorite failed: ${err.message}`);
    }
  }

  // Adapt the backend's timings shape to the frontend's expected shape.
  // Backend uses `dhuhr`, frontend expects `zuhr` mirror; jummah may be array.
  async function voteOnKeeper(mosqueId, keeper, voteType) {
    if (!keeper.latestSubmissionId) return toast('No submission to vote on');
    try {
      const res = await api.voteSubmission(keeper.latestSubmissionId, voteType);
      // Re-fetch the mosque so keeper ratings + ordering reflect the vote
      await openDetailInternal(mosqueId);
      toast(res.voted
        ? (voteType === 'upvote' ? `Upvoted ${R.prettifyPersonName(keeper.submitterName)}` : `Downvoted ${R.prettifyPersonName(keeper.submitterName)}`)
        : 'Vote removed');
    } catch (err) {
      // Server returns 400 if you try to vote on your own submission; surface that.
      toast(err.status === 400 && /own submission/i.test(err.message)
        ? "Can't vote on your own submission"
        : `Vote failed: ${err.message}`);
    }
  }

  // In-flight guard so a double-tap on the Follow button doesn't issue
  // two concurrent PUTs (server is idempotent but we still want a single
  // FCM subscribe and a single toast).
  let followInFlight = false;
  async function followKeeper(mosqueId, keeperUserId) {
    if (followInFlight) return;
    if (!view.selected) return;
    if (!requireSignIn("choose which time keeper's timings to use", () => followKeeper(mosqueId, keeperUserId))) return;
    const wasFollowing = view.selected.preferredKeeperId === keeperUserId;
    const priorKeeperId = view.selected.preferredKeeperId;
    followInFlight = true;
    try {
      const next = wasFollowing ? null : keeperUserId;
      await api.setPreferredKeeper(mosqueId, next);

      // FCM topic management — fire BEFORE the UI re-fetch. If the re-
      // fetch fails (network blip), we still want the device subscribed
      // so the user gets the next push from this keeper. The first
      // subscribe also triggers the Android 13+ POST_NOTIFICATIONS
      // prompt; we only ask at that moment so the value is obvious
      // ("you wanted updates from this keeper") — never on cold launch.
      // No-op in the browser — takbeerPush is only installed by
      // native-bridge.js inside the Capacitor shell.
      // See docs/PUSH_NOTIFICATIONS.md for the topic naming contract.
      const push = window.takbeerPush;
      if (push) {
        // Switching keepers: unsubscribe from the old one's topic at
        // this masjid, otherwise we'd keep receiving updates from the
        // keeper we just stopped following.
        if (priorKeeperId && priorKeeperId !== next) {
          push.unsubscribe(`keeper-${priorKeeperId}-mosque-${mosqueId}`).catch(() => {});
        }
        if (next) {
          push.subscribe(`keeper-${next}-mosque-${mosqueId}`).catch(() => {});
        }
      }

      // Re-fetch so effective timings + keeper highlights are correct.
      // Don't let a re-fetch failure void the toast — the server save
      // already succeeded, that's the user's source of truth.
      try {
        await openDetailInternal(mosqueId);
        if (view.defaultMosqueObj?.id === mosqueId) {
          view.defaultMosqueObj = await api.getMosque(mosqueId);
          renderHero();
        }
      } catch { /* UI catches up on next interaction */ }

      toast(wasFollowing
        ? "Stopped using this time keeper's timings"
        : "Your app now uses this time keeper's timings");
    } catch (err) {
      toast(`Couldn't update: ${err.message}`);
    } finally {
      followInFlight = false;
    }
  }

  let withdrawInFlight = false;
  async function withdrawKeeper(mosqueId, keeper) {
    if (withdrawInFlight) return;
    if (!view.selected) return;
    if (!requireSignIn('stop being a time keeper for this masjid', () => withdrawKeeper(mosqueId, keeper))) return;
    const name = R.prettifyPersonName(keeper?.submitterName) || 'this time keeper';
    const message = window.i18n?.t('keeper.withdrawConfirm')
      ?? 'This will remove your timings from this masjid and people will no longer be able to follow you here. Continue?';
    if (!window.confirm(message)) return;
    withdrawInFlight = true;
    try {
      const priorKeeperId = keeper?.submitterId || view.me?.id;
      const result = await api.withdrawAsKeeper(mosqueId);
      window.takbeerPush?.unsubscribe?.(`keeper-${priorKeeperId}-mosque-${mosqueId}`).catch(() => {});
      await openDetailInternal(mosqueId);
      if (view.defaultMosqueObj?.id === mosqueId) {
        view.defaultMosqueObj = await api.getMosque(mosqueId);
        renderHero();
      }
      toast(result?.replacementKeeperName
        ? `You are no longer a time keeper here. The masjid now uses ${R.prettifyPersonName(result.replacementKeeperName)}.`
        : 'You are no longer a time keeper for this masjid.');
    } catch (err) {
      toast(`Could not withdraw ${name}: ${err.message}`);
    } finally {
      withdrawInFlight = false;
    }
  }

  async function setDefaultFromDrawer() {
    if (!view.selected) return;
    const id = view.selected.id;
    // Always save locally first — this is the source of truth for
    // signed-out users on this device, and a useful cache for signed-in
    // users while the server round-trip completes.
    setLocalDefaultMosqueId(id);
    if (getEmail()) {
      view.me = { ...(view.me || {}), defaultMosqueId: id };
    }
    drawerEls.setDefaultBtn.setAttribute('aria-pressed', 'true');
    const defaultLabel = drawerEls.setDefaultBtn.querySelector('span:last-child') || drawerEls.setDefaultBtn;
    defaultLabel.textContent = window.i18n?.t('drawer.defaultActive') ?? '✓ Your default masjid';
    if (drawerEls.status) drawerEls.status.textContent = window.i18n?.t('drawer.statusDefault') ?? 'Your default';
    view.defaultMosqueObj = view.selected;
    const mosqueName = view.selected.name;
    renderHero();
    renderActivePanel();
    // Same as setDefaultFromCard: the journey is complete, land the user
    // on the home hero showing their new default. (goHome() clears
    // view.selected, so the name is captured above for the toasts.)
    goHome();

    // Best-effort server sync — only meaningful when signed-in. Failure
    // is fine: the localStorage value remains the working default.
    if (getEmail()) {
      try {
        const updated = await api.updateMyProfile({ defaultMosqueId: id });
        view.me = { ...(view.me || {}), ...updated, defaultMosqueId: id };
        toast(`${mosqueName} is now your default`);
      } catch (err) {
        toast(`${mosqueName} set locally — server sync failed: ${err.message}`);
      }
    } else {
      toast(`${mosqueName} is now your default on this device`);
    }
  }

  function selectedHasSubmitTimings() {
    return mosqueHasSubmitTimings(view.selected);
  }

  function mosqueHasSubmitTimings(m) {
    return !!(m && (m.effectiveTimings || m.defaultJamaatTimings || R.timingsFromMosque(m)));
  }

  function refreshSubmitCopy(m = view.selected) {
    const hasTimings = mosqueHasSubmitTimings(m);
    const title = drawerEls.submitForm?.querySelector('.section-title');
    const note = drawerEls.submitForm?.querySelector('.muted');
    if (drawerEls.submitToggleBtn) {
      drawerEls.submitToggleBtn.textContent = window.i18n?.t(hasTimings ? 'drawer.submitUpdate' : 'drawer.submitTimes')
        ?? (hasTimings ? 'Submit a timing update' : 'Submit Jamat times');
    }
    if (title) {
      title.dataset.i18n = hasTimings ? 'submit.titleUpdate' : 'submit.titleNew';
      title.textContent = window.i18n?.t(title.dataset.i18n)
        ?? (hasTimings ? 'Submit a timing update' : 'Submit Jamat times');
    }
    if (note) {
      note.dataset.i18n = hasTimings ? 'submit.noteUpdate' : 'submit.noteNew';
      note.textContent = window.i18n?.t(note.dataset.i18n)
        ?? (hasTimings
          ? 'Maghrib follows local sunset - pick the takbeer offset. Other times in 24-hour HH:mm'
          : 'Leave unknown times blank. If you know Jummah, submit it - travellers are often looking for Jummah times nearby.');
    }
  }

  async function ensureSelectedSubmitTimings() {
    if (!view.selected || selectedHasSubmitTimings()) return;
    try {
      const fresh = await api.getMosque(view.selected.id);
      replaceMosqueEverywhere(fresh);
      paintDrawer(fresh);
    } catch (err) {
      toast(`Couldn't refresh current times: ${err.message}`);
    }
  }

  async function openSubmitForm({ scroll = false, focusPrayer = null } = {}) {
    if (!view.selected) return;
    drawerEls.editForm.hidden = true;
    drawerEls.submitForm.hidden = false;
    await ensureSelectedSubmitTimings();
    drawerEls.submitForm.hidden = false;
    prefillSubmitForm();
    if (scroll) drawerEls.submitForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => {
      const target = focusPrayer
        ? drawerEls.submitForm.querySelector(`[name="${focusPrayer}"]`)
        : drawerEls.submitForm.querySelector('input');
      target?.focus();
      if (focusPrayer && target?.matches?.('input[type="time"]')) {
        const defaultValue = R.defaultSubmittedPrayerTime?.(focusPrayer);
        if (!target.value && defaultValue) target.value = defaultValue;
      }
    }, scroll ? 280 : 0);
  }

  async function toggleSubmitForm() {
    if (!view.selected) return;
    if (!drawerEls.submitForm.hidden) {
      drawerEls.submitForm.hidden = true;
      return;
    }
    await openSubmitForm();
  }

  // Pre-populate the submit form with the mosque's current times so the
  // user only edits the prayer that changed instead of re-typing all six.
  // Sources, in priority order:
  //   1. effectiveTimings — the active keeper's most recent submission.
  //      For a self-keeper updating their own time, this IS their last
  //      submission, but it only carries the prayers they last touched.
  //      A keeper who only ever updates Isha has fajr/dhuhr/asr empty
  //      here, which is why we fall through to (2).
  //   2. defaultJamaatTimings — the master/active PrayerSchedule for the
  //      mosque. Carries the full set of prayers.
  //   3. blank — only when neither source has the prayer.
  // Backend uses `dhuhr`; some legacy master records use `zuhr`. Handle
  // both on each side.
  function prefillSubmitForm() {
    if (!view.selected) return;
    const eff = view.selected.effectiveTimings || {};
    const def = view.selected.defaultJamaatTimings || {};
    const rendered = R.timingsFromMosque(view.selected) || {};
    const toTimeInputValue = (v) => {
      const raw = Array.isArray(v) ? v[0] : v;
      if (typeof raw !== 'string') return '';
      const m = raw.match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return '';
      const h = parseInt(m[1], 10);
      const min = parseInt(m[2], 10);
      if (h < 0 || h > 23 || min < 0 || min > 59) return '';
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    };
    const pick = (k) => {
      const alt = k === 'dhuhr' ? 'zuhr' : (k === 'zuhr' ? 'dhuhr' : null);
      const v = eff[k] ?? (alt ? eff[alt] : undefined)
              ?? def[k] ?? (alt ? def[alt] : undefined)
              ?? rendered[k] ?? (alt ? rendered[alt] : undefined);
      return toTimeInputValue(v);
    };
    ['fajr', 'dhuhr', 'asr', 'isha', 'jummah'].forEach(name => {
      const input = drawerEls.submitForm.querySelector(`[name="${name}"]`);
      if (input) input.value = pick(name);
    });
    // Maghrib is sunset + offset — prefill the offset selector, not a HH:MM.
    const offsetSel = drawerEls.submitForm.querySelector('[name="maghribOffset"]');
    if (offsetSel) {
      const offRaw = eff.maghribOffset ?? def.maghribOffset;
      const off = Number.isFinite(+offRaw) ? String(+offRaw) : '3';
      offsetSel.value = offsetSel.querySelector(`option[value="${off}"]`) ? off : '3';
    }
    // Repaint the tap-friendly time picker from the values we just set.
    window.simpleTime?.sync(drawerEls.submitForm);
  }

  async function submitTimings() {
    if (!view.selected) return;
    if (!requireSignIn('submit prayer times', () => submitTimings())) return;
    const form = drawerEls.submitForm;
    const get = (n) => {
      const value = form.querySelector(`[name="${n}"]`)?.value || undefined;
      return value && R.normalizeSubmittedPrayerTime ? R.normalizeSubmittedPrayerTime(n, value) : value;
    };
    const offRaw = get('maghribOffset');
    const timings = {
      fajr: get('fajr'), dhuhr: get('dhuhr'), zuhr: get('dhuhr'),
      asr: get('asr'), isha: get('isha'), jummah: get('jummah'),
      maghribOffset: offRaw != null ? parseInt(offRaw, 10) : undefined,
    };
    if (!Object.values(timings).some(v => v !== undefined && v !== '')) {
      return toast(window.i18n?.t('toast.atLeastOne') ?? 'Enter at least one timing');
    }
    try {
      await api.submitTimings({ mosqueId: view.selected.id, timings, notes: get('notes') });
      toast(window.i18n?.t('toast.submissionReceived') ?? 'Submission received — thank you');
      form.hidden = true;
      form.querySelectorAll('input, textarea').forEach(i => { i.value = ''; });
      window.simpleTime?.sync(form);

      // Re-fetch so the new effective timings (when the submitter is the
      // active keeper, the new schedule applies immediately) flow into
      // the drawer, the hero card's "all takbeer times" list, and the
      // directory cards. Without this the user only sees their update
      // after they tap Manage, which round-trips on its own.
      const submittedId = view.selected.id;
      try {
        const fresh = await api.getMosque(submittedId);
        view.selected = fresh;
        paintDrawer(fresh);
        const replaceIn = (arr) => {
          const i = arr.findIndex(x => x.id === fresh.id);
          if (i >= 0) arr[i] = { ...arr[i], ...fresh };
        };
        replaceIn(view.nearby);
        replaceIn(view.favorites);
        if (view.defaultMosqueObj?.id === fresh.id) {
          view.defaultMosqueObj = fresh;
          renderHero();
        }
        renderActivePanel();
      } catch { /* network blip — server has the submission, UI will catch up next reload */ }

      loadContributors(submittedId);
    } catch (err) {
      toast(`Submission failed: ${err.message}`);
    }
  }

  // ─── Toast ───
  let toastTimer;
  function toast(msg, durationMs = 3500) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, durationMs);
  }

  function escapeHtml(s = '') {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  // Test-only hook (no effect in the browser beyond attaching a namespaced
  // object): exposes the guest→account qaza migration helpers so the unit
  // suite can lock in the behavior. Mirrors components.js's window.JAMAT_RENDER.
  if (typeof window !== 'undefined') {
    window.__takbeerQazaTest = {
      mergeQazaRecords,
      migrateAnonymousQazaToOwner,
      qazaOwnerKey,
      setEmail,
    };
  }
})();
