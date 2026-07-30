// ═══════════════════════════════════════════════════════════════════
// In-app account deletion (Google Play compliance + GDPR).
//
// This module is intentionally standalone — it does NOT touch
// js/app.js, js/api.js, or js/auth.js (those are being edited
// concurrently). Once auth is settled, the fetch + signed-in detection
// here can be moved into js/api.js + js/app.js as a follow-up.
//
// Wiring:
//   - The footer has two #foot-delete-* anchors. The signed-in one
//     (#foot-delete-account, data-action="delete-account") is hidden
//     by default; we reveal it when we detect a signed-in user. The
//     other (#foot-delete-request) always links to the public form,
//     which is what signed-out users — and Google Play's "no-login
//     deletion URL" requirement — need.
//   - Clicking the in-app link opens #delete-modal, which explains
//     what's deleted and asks for confirmation. The "Yes, delete"
//     button calls DELETE /api/users/me with the user's bearer token,
//     clears local state, unsubscribes FCM topics, and reloads.
// ═══════════════════════════════════════════════════════════════════

(() => {
  // Mirror the storage key used by js/app.js. Keeping it as a literal
  // (rather than importing from app.js) is intentional — this script
  // is loaded after app.js but doesn't depend on its internals, so a
  // future refactor of app.js doesn't break the deletion flow.
  const EMAIL_KEY = 'jamat_dev_email';

  const links = {
    inApp: document.getElementById('foot-delete-account'),
    public: document.getElementById('foot-delete-request'),
  };
  const modal = document.getElementById('delete-modal');
  const status = document.getElementById('delete-modal-status');
  const confirmBtn = document.getElementById('delete-confirm');

  if (!links.inApp || !links.public || !modal || !confirmBtn) return;

  function devAuthEnabled() {
    const flag = window.JAMAT_CONFIG?.devAuthEnabled;
    if (typeof flag === 'boolean') return flag;
    const h = window.location?.hostname || '';
    return h === 'localhost' || h === '127.0.0.1' || h === '' || h.endsWith('.local') || h.endsWith('.trycloudflare.com');
  }

  function hasAppJwt() {
    try { return !!window.authExchange?.getStoredAppJwt?.(); } catch { return false; }
  }

  function isSignedIn() {
    try {
      return hasAppJwt() || (devAuthEnabled() && !!localStorage.getItem(EMAIL_KEY));
    } catch {
      return false;
    }
  }

  // Show the in-app link when signed in; hide the public-form link in
  // the same state so we don't double up. Polled because app.js drives
  // sign-in state without firing a custom event.
  function refreshLinkVisibility() {
    const signedIn = isSignedIn();
    links.inApp.hidden = !signedIn;
    links.public.hidden = signedIn;
  }
  refreshLinkVisibility();
  // Cheap poll — sign-in is an infrequent action and 1s feels instant.
  setInterval(refreshLinkVisibility, 1000);
  // Also refresh on storage events from other tabs.
  window.addEventListener('storage', (e) => {
    if (e.key === EMAIL_KEY) refreshLinkVisibility();
  });

  // ─── Modal open/close ───
  function openModal() {
    modal.setAttribute('aria-hidden', 'false');
    setStatus('', null);
    confirmBtn.disabled = false;
  }
  function closeModal() {
    modal.setAttribute('aria-hidden', 'true');
  }
  function setStatus(msg, kind) {
    if (!msg) { status.hidden = true; status.textContent = ''; return; }
    status.hidden = false;
    status.textContent = msg;
    status.classList.remove('is-ok', 'is-err');
    if (kind) status.classList.add(kind);
  }

  links.inApp.addEventListener('click', (e) => {
    e.preventDefault();
    if (!isSignedIn()) {
      // Defensive: if somehow the link is visible while signed-out,
      // fall through to the public form rather than open a confirm
      // dialog the user can't act on.
      window.location.href = '/delete-account.html';
      return;
    }
    openModal();
  });

  modal.querySelectorAll('[data-close-modal]').forEach((el) => {
    el.addEventListener('click', closeModal);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') closeModal();
  });

  // ─── DELETE /api/users/me ───
  // We can't go through js/api.js (concurrent edits — see top of file).
  // Build the auth header the same way api.js does: prefer our app JWT,
  // then a live Firebase ID token, then the local/dev-only email header.
  async function callDeleteMe() {
    const apiBase = window.JAMAT_CONFIG?.apiBase || '/api';
    const headers = { 'Content-Type': 'application/json' };

    let token = null;
    try {
      token = window.authExchange?.getStoredAppJwt?.() || null;
    } catch { /* fall through */ }

    // Real Firebase ID token (when auth.js has hydrated).
    try {
      if (!token && window.auth?.getIdToken) token = await window.auth.getIdToken();
    } catch { /* fall through */ }
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    } else {
      // Dev-auth fallback: only local/dev shells can send this.
      const email = localStorage.getItem(EMAIL_KEY);
      if (email && devAuthEnabled()) headers['X-Dev-User-Email'] = email;
    }

    return fetch(apiBase + '/users/me', {
      method: 'DELETE',
      headers,
    });
  }

  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    setStatus('Deleting your account…');

    let res;
    try {
      res = await callDeleteMe();
    } catch (err) {
      confirmBtn.disabled = false;
      setStatus("Network error. Please check your connection and try again.", 'is-err');
      return;
    }

    if (!res.ok && res.status !== 404) {
      // 404 is treated as already-deleted (idempotent re-delete).
      confirmBtn.disabled = false;
      setStatus(`Couldn't delete (status ${res.status}). Please try again, or email qazi.junaid@gmail.com.`, 'is-err');
      return;
    }

    // ─── Local cleanup, regardless of server outcome (the user
    //     intent is "I'm done" — we honour it on the device too). ───

    // 1. Drop FCM topic subscriptions on this device. No-op in browsers
    //    (takbeerPush is only installed by the Capacitor mobile shell).
    try {
      await window.takbeerPush?.unsubscribeAll?.();
    } catch { /* best-effort */ }

    // 2. Sign out of Firebase if it's configured.
    try {
      await window.auth?.signOut?.();
    } catch { /* best-effort */ }

    // 3. Clear the localStorage keys identifying the account on-device.
    //    Any future jamat_app_* keys (a JWT, cached profile) should be
    //    added here when they land.
    try {
      localStorage.removeItem(EMAIL_KEY);
      localStorage.removeItem('jamat_app_jwt');
      localStorage.removeItem('jamat_app_user');
      localStorage.removeItem('jamat_favorites');
      localStorage.removeItem('jamat_default_mosque');
      localStorage.removeItem('jamat_reminder_prefs');
      localStorage.removeItem('jamat_auth');
      localStorage.removeItem('takbeer_fcm_topics_v1');
      localStorage.removeItem('takbeer_fcm_pending_v1');
    } catch { /* best-effort */ }

    setStatus('Account deleted. Reloading…', 'is-ok');
    // Brief pause so the user reads the confirmation, then reload
    // into a clean signed-out state.
    setTimeout(() => { window.location.replace('/'); }, 1200);
  });
})();
