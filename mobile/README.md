# Takbeer Time — Capacitor mobile shell

Wraps the existing vanilla-JS web app in a Capacitor shell so it can ship to
the App Store and Google Play with native plugins for geolocation and prayer
reminders.

## Layout

```
mobile/
├── capacitor.config.ts      # appId, name, webDir, plugin config
├── native-bridge.js         # JS shim — picks native plugins when running in Capacitor
├── scripts/build-web.sh     # Snapshots ../index.html ../js ../css → www/
├── www/                     # Build output (gitignored). Regenerated each `npm run build`.
├── android/                 # Native Android project — open in Android Studio
└── ios/                     # Native Xcode project — open on macOS only
```

The web app sources stay in the repo root. The build script copies them into
`www/` and patches the `<script>` order to load `native-bridge.js` first.

## One-time host setup

| Need        | Where to install                                                    |
| ----------- | ------------------------------------------------------------------- |
| Node 20+    | already installed (nvm)                                              |
| JDK 21      | required for the current Android Gradle/Capacitor build |
| Android SDK | install via Android Studio (handles SDK + platform tools + emulator) |
| macOS + Xcode | only for iOS builds — Linux box can't build iOS                    |
| CocoaPods   | `sudo gem install cocoapods` on the macOS host                       |

## Daily workflow

```bash
cd mobile

npm run build       # snapshot the web app into www/
npx cap sync        # copy www/ + plugins into android/ and ios/

# Android (needs JDK + Android SDK)
npx cap open android   # opens Android Studio

# iOS (needs macOS + Xcode + CocoaPods)
npx cap open ios       # opens Xcode
```

The `npm run android:open` and `ios:open` scripts chain build + sync + open.

## What `native-bridge.js` does

Loaded only inside the Capacitor shell (early-returns in a regular browser):

1. **API base URL** — pins to `https://takbeertime.com` so `fetch('/api/...')`
   resolves correctly when the app is loaded from `capacitor://localhost`.
2. **Geolocation** — wraps `navigator.geolocation.getCurrentPosition` with the
   Capacitor Geolocation plugin (Core Location / FusedLocationProvider).
3. **Local notifications** — exposes `window.nativeReminders` so reminders.js
   can prefer it over `setTimeout` + Web Notifications. Native notifications
   fire even when the app is backgrounded or closed — the web version doesn't.
4. **Status bar + splash** — sets brand colors and hides the splash on first
   paint.

## Phase status

- **Phase 0 — Scaffold (done):** mobile/ initialized, both platforms added,
  permissions set, native bridge in place.
- **Phase 1 — Native polish (next):** wire `js/reminders.js` to use
  `window.nativeReminders` when present; generate icons + splash assets; test
  on a real device.
- **Phase 2 — App identity:** signing keys, app icons, store listings, privacy
  policy, screenshots.
- **Phase 3 — Distribute:** Play Console upload, App Store Connect upload.

## What's still on you

- Apple Developer Program membership ($99/yr) — required to distribute on iOS.
- Google Play Console account ($25 one-time) — required to distribute on
  Android.
- A privacy policy URL — both stores require one. Even a single page is fine.
- 1024×1024 source icon and a launch image. Once you have those, run
  `npx capacitor-assets generate` to produce all the platform-specific sizes.

## Android identity

The Android package shipped to Google Play is `com.takbeertime.android`.
Firebase/Google sign-in configuration lives at
`mobile/android/app/google-services.json`. See `../docs/ANDROID_FIREBASE.md` before
changing the package name, Firebase app, signing fingerprints, or local Android
workspace path.

The old root-level `android/` Kotlin project is deprecated and removed. Use
this `mobile/` directory for all Android builds, installs, and Play Store
uploads.
