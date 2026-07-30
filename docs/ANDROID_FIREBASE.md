# Android Firebase Identity

This is the canonical identity for the Capacitor Android app.

## Current App

- Firebase project ID: `takbeerapp`
- Android package name: `com.takbeertime.android`
- App nickname: `Takbeer Time`
- Local config file: `mobile/android/app/google-services.json`
- Play Store package: `com.takbeertime.android`
- Play Store URL: `https://play.google.com/store/apps/details?id=com.takbeertime.android`

## Local Workspace

- Main repository: `D:\MyGitHub\takbeer`
- Android package-fix worktree: `D:\MyGitHub\takbeer-auto-deploy-fix`
- Active branch for this setup: `auto-deploy-package-fix`
- Capacitor app root: `D:\MyGitHub\takbeer-auto-deploy-fix\mobile`
- Native Android project: `D:\MyGitHub\takbeer-auto-deploy-fix\mobile\android`
- Capacitor config: `mobile/capacitor.config.ts`
- Web app source: repository root plus `js/` and `css/`
- Generated mobile web bundle: `mobile/www/`

The physical Android test device used during setup was serial `RFCX308Z3NB`.
Because an emulator may also be connected, target the phone explicitly with
`adb -s RFCX308Z3NB ...`. On Junaid's Windows machine, `adb` is at
`%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`.

The checked-in `google-services.json` must include a Firebase Android client
whose `package_name` is `com.takbeertime.android`. Files for
`com.takbeertime.app` are for the old app identity and must not replace the
current config.

## SHA-1 Fingerprints

Firebase Google sign-in needs SHA-1 fingerprints for every signing key used by
an installed build.

- Release/upload SHA-1:
  `A9:78:E4:B2:A4:DF:BA:3A:C2:AD:A5:A5:A8:D1:EE:02:7C:00:8B:CA`
- Junaid Windows debug SHA-1:
  `2B:7E:27:2E:42:35:40:1A:5D:21:08:D5:15:69:E9:CB:3C:2A:92:AF`

The Firebase Android app for `com.takbeertime.android` must contain both
fingerprints if we want Google sign-in to work in both Play/release builds and
local debug installs. On May 4, 2026, the provided
`C:\Users\Junaid\Downloads\google-services (4).json` contained the release
fingerprint for `com.takbeertime.android`, but the debug fingerprint was still
attached to the old `com.takbeertime.app` client. That makes local debug Google
sign-in fail with Google's OAuth package/SHA mismatch error.

If Google sign-in works in Play builds but fails in a local debug install, add
that machine's Android debug keystore SHA-1 in Firebase, download a fresh
`google-services.json`, and replace `mobile/android/app/google-services.json`.

## Related Deploy Credential

The Play deploy workflow uses a different credential:
`PLAY_SERVICE_ACCOUNT_JSON` in GitHub Actions secrets. That service account
JSON is for Google Play uploads only and must not be confused with Firebase's
`google-services.json`. See `docs/PLAY_AUTO_DEPLOY.md` for the GitHub Actions
deployment flow.
