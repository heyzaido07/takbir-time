// ========================================
// Takbeer Time — App-JWT exchange
// ========================================
// Bridges Firebase Google sign-in (Firebase ID token, ~1h lifetime) and
// our backend's /api/auth/google endpoint (returns a 30-day app JWT).
//
// Why store our own JWT instead of just refreshing the Firebase token?
//   - The Firebase token expires hourly; rotating it client-side is its
//     own mini-feature.
//   - Email/password users (also served by the same /api/auth endpoints)
//     have no Firebase identity at all, so the client needs *some*
//     bearer token. Unifying both flows under one storage key keeps
//     api.js dead-simple.
//
// Loaded as a plain <script> after config.js and before api.js.

(function () {
  const STORAGE_TOKEN = 'jamat_app_jwt';
  const STORAGE_USER = 'jamat_app_user';

  // Best-effort ApiError that doesn't depend on api.js having loaded
  // first. If api.js is already on the page we re-use its class so an
  // `instanceof ApiError` check works the same regardless of which
  // module produced the error.
  function ApiErrorCtor(status, message) {
    const Cls = (typeof window !== 'undefined' && window.ApiError) || null;
    if (Cls) return new Cls(status, message);
    const err = new Error(message);
    err.status = status;
    return err;
  }

  function getApiBase() {
    return (typeof window !== 'undefined' && window.JAMAT_CONFIG?.apiBase) || null;
  }

  async function exchangeFirebaseToken(idToken) {
    if (!idToken) {
      throw ApiErrorCtor(0, 'idToken is required');
    }
    const apiBase = getApiBase();
    if (!apiBase) {
      throw ApiErrorCtor(0, 'JAMAT_CONFIG.apiBase is not configured');
    }

    let res;
    try {
      res = await fetch(apiBase + '/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
    } catch (err) {
      throw ApiErrorCtor(0, `Network error: ${err && err.message ? err.message : err}`);
    }

    const text = await res.text().catch(() => '');
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); } catch { /* leave null */ }
    }

    if (!res.ok) {
      const message = (payload && (payload.error || payload.message)) || res.statusText || 'Google sign-in failed';
      throw ApiErrorCtor(res.status, message);
    }

    if (!payload || !payload.token) {
      throw ApiErrorCtor(res.status, 'Google sign-in response missing token');
    }

    storeAppJwt(payload.token, payload.user || null);
    return payload;
  }

  function storeAppJwt(token, user) {
    try {
      if (token) localStorage.setItem(STORAGE_TOKEN, token);
      if (user) localStorage.setItem(STORAGE_USER, JSON.stringify(user));
    } catch {
      // localStorage may throw in private-mode Safari etc. — swallow so
      // the in-memory caller still gets the {token, user} return value.
    }
  }

  function getStoredAppJwt() {
    try {
      return localStorage.getItem(STORAGE_TOKEN);
    } catch {
      return null;
    }
  }

  function getStoredUser() {
    try {
      const raw = localStorage.getItem(STORAGE_USER);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function clearStoredAppJwt() {
    try {
      localStorage.removeItem(STORAGE_TOKEN);
      localStorage.removeItem(STORAGE_USER);
    } catch {
      // Same swallow as storeAppJwt — never let storage errors bubble.
    }
  }

  window.authExchange = {
    exchangeFirebaseToken,
    storeAppJwt,
    getStoredAppJwt,
    getStoredUser,
    clearStoredAppJwt,
  };
})();
