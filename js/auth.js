// ========================================
// Takbeer Time — Auth Layer
// ========================================
// Two execution targets, one API:
//
//   1. Browser:  Firebase JS SDK (loaded from CDN via dynamic import)
//                drives signInWithPopup. Active only when
//                window.JAMAT_CONFIG.firebase is filled in.
//
//   2. Capacitor (native shell): @capacitor-firebase/authentication's
//                signInWithGoogle uses the native Google Sign-In SDK
//                via google-services.json. No web Firebase config
//                required; no popup; OAuth redirect issues that plague
//                the JS SDK inside a WebView don't apply.
//
// Both paths produce the same shape — `signInWithGoogle()` resolves to
// `{ user: { getIdToken() } }` so the caller (js/app.js → handleGoogleSignIn)
// doesn't need to branch.

const auth = (() => {
  let firebaseAuth = null;
  let currentUser = null;
  const listeners = new Set();

  function isNative() {
    return !!(
      typeof window !== 'undefined' &&
      window.Capacitor &&
      window.Capacitor.isNativePlatform &&
      window.Capacitor.isNativePlatform()
    );
  }

  function getNativePlugin() {
    return window.Capacitor?.Plugins?.FirebaseAuthentication || null;
  }

  function isWebFirebaseConfigured() {
    const cfg = window.JAMAT_CONFIG?.firebase;
    return !!(cfg && cfg.apiKey && cfg.projectId);
  }

  // Configured = either native plugin available OR web Firebase config
  // present. The login modal uses this to decide whether to render the
  // Google button (it stays hidden when no Google flow can run).
  function isConfigured() {
    if (isNative()) return !!getNativePlugin();
    return isWebFirebaseConfigured();
  }

  async function init() {
    // No-op on native — the plugin manages its own auth state.
    if (isNative()) return;
    if (!isWebFirebaseConfigured()) return;
    if (firebaseAuth) return;

    // Dynamic import keeps Firebase out of the bundle when not configured.
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
    const { getAuth, onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');

    const app = initializeApp(window.JAMAT_CONFIG.firebase);
    firebaseAuth = getAuth(app);

    onAuthStateChanged(firebaseAuth, (user) => {
      currentUser = user;
      listeners.forEach((fn) => fn(user));
    });
  }

  async function signInWithGoogle() {
    if (isNative()) {
      const plugin = getNativePlugin();
      if (!plugin) {
        throw new Error(
          'FirebaseAuthentication plugin missing — install @capacitor-firebase/authentication and run `npx cap sync`'
        );
      }
      // Native path. signInWithGoogle:
      //   - opens the OS Google account picker
      //   - on success, signs into Firebase Auth
      //   - returns { user, credential, ... } with the Firebase user info
      let result;
      try {
        result = await plugin.signInWithGoogle();
      } catch (err) {
        if (
          window.Capacitor?.getPlatform?.() !== 'android' ||
          !/no credentials available|nocredential/i.test(err?.message || err?.code || '')
        ) {
          throw err;
        }
        result = await plugin.signInWithGoogle({ useCredentialManager: false });
      }
      // Firebase ID token is fetched separately. The credential.idToken
      // returned from the plugin is the *Google* OAuth ID token; our
      // backend's firebase-admin.verifyIdToken expects the Firebase one.
      const tokenRes = await plugin.getIdToken();
      const idToken = tokenRes?.token || result?.credential?.idToken || null;
      currentUser = result?.user || null;
      // Mirror the user object onto the same shape the web popup returns
      // so callers don't branch on platform.
      return {
        user: {
          uid: result?.user?.uid || null,
          email: result?.user?.email || null,
          displayName: result?.user?.displayName || null,
          getIdToken: async () => idToken,
        },
        credential: result?.credential || null,
      };
    }

    if (!isWebFirebaseConfigured()) throw new Error('Firebase is not configured');
    await init();
    const { GoogleAuthProvider, signInWithPopup } = await import(
      'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js'
    );
    return signInWithPopup(firebaseAuth, new GoogleAuthProvider());
  }

  async function signOut() {
    if (isNative()) {
      const plugin = getNativePlugin();
      if (plugin) {
        try { await plugin.signOut(); } catch { /* best-effort */ }
      }
      currentUser = null;
      listeners.forEach((fn) => fn(null));
      return;
    }
    if (!firebaseAuth) return;
    const { signOut: fbSignOut } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
    await fbSignOut(firebaseAuth);
  }

  async function getIdToken() {
    if (isNative()) {
      const plugin = getNativePlugin();
      if (!plugin) return null;
      try {
        const { token } = await plugin.getIdToken();
        return token || null;
      } catch {
        return null;
      }
    }
    if (!firebaseAuth || !currentUser) return null;
    return currentUser.getIdToken();
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return {
    init,
    signInWithGoogle,
    signOut,
    getIdToken,
    onChange,
    isConfigured,
    isNative,
    get user() { return currentUser; },
  };
})();

// Expose globally so non-module scripts (api.js, app.js) can access it.
window.auth = auth;

// Kick off initialization (no-op if Firebase isn't configured / on native).
auth.init();
