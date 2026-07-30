// ========================================
// Jamat Frontend Config
// ========================================
// Single place to configure backend URL, feature flags, and Firebase.
// Loaded before all other js/ files via <script src="js/config.js">.

window.JAMAT_CONFIG = {
  // Where the Express backend lives. Auto-detects the deployment context:
  //   - production (served via nginx at takbeertime.*): same-origin /api
  //   - cloudflared tunnel (testing on phone): the api tunnel URL
  //   - local dev (python http.server on 6002): direct backend URL
  apiBase: (() => {
    const h = location.hostname;
    // Production / staging via nginx — same-origin /api
    if (h === 'takbeertime.com' || h === 'www.takbeertime.com') return '/api';
    // Cloudflared tunnel for phone testing
    if (h.endsWith('.trycloudflare.com')) return 'https://thumb-directly-raised-experiences.trycloudflare.com/api';
    // Direct production/staging IP or LAN host served by the Docker nginx
    // container. Use same-origin so the browser can reach /api through nginx.
    if (
      h === '192.168.18.93' ||
      (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) && h !== '127.0.0.1') ||
      (!['localhost', '127.0.0.1', ''].includes(h) && !h.endsWith('.local'))
    ) return '/api';
    // Local dev (python http.server on 6002, Express on 6001)
    return 'http://localhost:6001/api';
  })(),

  // While the backend is offline / unreachable, fall back to the hardcoded
  // mosques in state.js. Flip to false once the backend is reachable.
  // Non-destructive dev override: append ?mock=1 to the URL (or set
  // localStorage.jamat_force_mock='1') to force mock mode for a no-backend
  // walkthrough — handy for demoing UI like Dars without Postgres running.
  useMockData: (() => {
    try {
      if (new URLSearchParams(location.search).has('mock')) return true;
      if (localStorage.getItem('jamat_force_mock') === '1') return true;
    } catch {}
    return false;
  })(),

  // Local/test-only email impersonation fallback. Production must use a
  // bearer token from email/password or Google sign-in; the server also
  // refuses to boot with DEV_AUTH_USER_EMAIL set in NODE_ENV=production.
  devAuthEnabled: (() => {
    const h = location.hostname;
    return (
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h === '' ||
      h.endsWith('.local') ||
      h.endsWith('.trycloudflare.com')
    );
  })(),

  // Default search radius in meters for "mosques near me".
  defaultRadiusMeters: 5000,

  // Firebase web SDK config — fill in from your Firebase Console.
  // Auth stays disabled until apiKey + projectId are populated.
  firebase: {
    apiKey: 'AIzaSyAJxvymGOB0c_AqXy7stOM1LzS53thUR_Y',
    authDomain: 'takbeerapp.firebaseapp.com',
    projectId: 'takbeerapp',
    storageBucket: 'takbeerapp.firebasestorage.app',
    messagingSenderId: '797230147137',
    appId: '',
  },
};
