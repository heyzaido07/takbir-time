import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.takbeertime.android',
  appName: 'Takbeer Time',
  webDir: 'www',
  // No `server.url` — we ship the bundled web assets. (Pointing server.url
  // at takbeertime.com would make the whole thing a thin browser tab,
  // which Apple Review will reject. We bundle and use native plugins for
  // the bits that need to feel native.)
  bundledWebRuntime: false,
  android: {
    allowMixedContent: false,
  },
  ios: {
    contentInset: 'automatic',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false, // we hide it manually after first paint
      backgroundColor: '#0d2818',
      androidScaleType: 'CENTER_CROP',
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_icon',
      iconColor: '#d6b266', // brass
      sound: 'default',
    },
    // The WebView serves the app from https://localhost, which is not in
    // takbeertime.com's CORS allowlist — every fetch() preflight fails.
    // Enabling CapacitorHttp patches fetch/XHR to go through the native
    // HTTP client (no CORS). Server-side CORS for https://localhost is
    // the proper long-term fix; this unblocks us until that ships.
    CapacitorHttp: {
      enabled: true,
    },
    // @capacitor-firebase/authentication v7 requires providers to be
    // declared explicitly — otherwise GoogleAuthProviderHandler stays
    // null and signInWithGoogle() throws an NPE. Listing google.com is
    // what makes the plugin's GoogleAuthProviderHandler get instantiated
    // at plugin init.
    FirebaseAuthentication: {
      providers: ['google.com'],
      skipNativeAuth: false,
    },
  },
};

export default config;
