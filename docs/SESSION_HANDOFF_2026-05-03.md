# Session Handoff - 2026-05-03

This note records the work done in the Codex session on 2026-05-03, the local test setup discovered, and the remaining blockers. It intentionally does not record plaintext passwords or private key material.

## Starting Request

The user provided a security/reliability audit list and asked to fix every issue except the first registration takeover finding. The excluded item was:

- `POST /api/auth/register` can claim existing no-password Google/dev-auth rows by setting a password.

The user explicitly chose not to spend effort on that first issue because only a handful of accounts exist.

## Pre-Existing State

At the start of the worktree inspection, the repo was already dirty. These unrelated changes were present and were not reverted:

- `.claude/settings.local.json`
- `.claude/worktrees/agent-afd5bea8fdf67f7e5`
- `js/reminders.js`
- `mobile/android/app/capacitor.build.gradle`
- `mobile/android/capacitor.settings.gradle`
- `mobile/ios/App/Podfile`
- `mobile/native-bridge.js`
- `screenshots/2026-05-03-verify/`

Git also repeatedly warned:

```text
warning: unable to access 'C:\Users\Junaid/.config/git/ignore': Permission denied
```

## Code Changes Made

### Deleted users and auth

Files:

- `server/src/middleware/auth.ts`
- `server/src/routes/users.ts`

Changes:

- Confirmed existing JWT/password/Google paths reject users with `deletedAt`.
- Added an explicit production guard inside `devAuthBypass`:

```ts
if (process.env.NODE_ENV === 'production') return false;
```

- Updated the `DELETE /api/users/me` route comment to match current behavior: public requests do not reach the route again after deletion because `authenticate` rejects deleted users.

### Suggestion security

Files:

- `server/src/routes/suggestions.ts`
- `server/src/__tests__/suggestions.test.ts`

Changes:

- Added `hasKeeperStanding(db, mosqueId, userId)`.
- A suggestion recipient now must be an active user and an established keeper for the mosque.
- Keeper standing is currently defined as either:
  - the user added the mosque, or
  - the user has at least one non-rejected timing submission for that mosque.
- `POST /api/suggestions` now rejects non-keeper recipients with `400`.
- `POST /api/suggestions/:id/accept` re-checks keeper standing inside the transaction and rejects stale/manually inserted rows with `403`.
- Accepted suggestions now write a verified schedule only after that standing check.
- Tests were updated to seed keeper standing where needed and to cover rejected non-keeper targeting and stale-row accept rejection.

### Production login/dev-auth hardening

Files:

- `js/config.js`
- `js/api.js`
- `js/app.js`
- `js/delete-account.js`
- `js/i18n.js`
- `index.html`
- `js/__tests__/apiAuthHeader.test.js`
- `i18n/*.json`

Changes:

- Added `window.JAMAT_CONFIG.devAuthEnabled`.
- Default dev-auth is enabled only for:
  - `localhost`
  - `127.0.0.1`
  - empty hostname
  - `*.local`
  - `*.trycloudflare.com`
- `api.js` sends `X-Dev-User-Email` only when dev-auth is enabled and no bearer token exists.
- Protected client requests now throw `401` before fetch when no token exists and dev-auth is disabled.
- `app.js` treats a stored email as signed-in only when an app JWT is present or dev-auth is enabled.
- The production login form requires a password. Email-only sign-in is local/dev only.
- `delete-account.js` now prefers the stored app JWT, then a live Firebase token, then the dev-only email header.
- Login copy was changed from email-only/dev wording to password/Google wording.
- Translation JSON files received English fallback strings for the new auth copy. This keeps behavior correct without relying on missing-key fallback.
- Client unit test coverage was added for "do not send X-Dev-User-Email when dev auth is disabled".

### Native Android stale app

Files:

- `android/app/build.gradle`
- `android/app/src/main/java/com/jamat/mosquelocator/data/remote/dto/MosqueDto.kt`
- `android/app/src/main/java/com/jamat/mosquelocator/data/remote/RemoteMosqueDataSource.kt`
- `DEPLOYMENT.md`

Changes:

- Release API base URL changed from:

```text
https://api.jamat.app/api/
```

to:

```text
https://takbeertime.com/api/
```

- `TimingsDto` now includes:

```kotlin
val maghribOffset: Int? = null
```

- Remote mapping now preserves legacy concrete `maghrib`, but displays current `maghribOffset` as:
  - `Sunset`
  - `Sunset + N min`
- Deployment docs were updated to the current production API URL.

## Validation Completed

The following checks passed:

```powershell
npm run build
```

from `server/`.

```powershell
npx tsc -p tsconfig.test.json --noEmit
```

from `server/`.

```powershell
npm run test:unit -- --runInBand
```

from repo root.

Result:

```text
Test Suites: 3 passed, 3 total
Tests: 28 passed, 28 total
```

```powershell
$env:DATABASE_URL='postgresql://user:pass@localhost:5432/db'; npx prisma validate
```

from `server/`.

```powershell
npx jest src/__tests__/consensus.test.ts --runInBand
```

from `server/`.

Result:

```text
Test Suites: 1 passed, 1 total
Tests: 24 passed, 24 total
```

```powershell
node -e "for (const f of require('fs').readdirSync('i18n').filter(f=>f.endsWith('.json'))) JSON.parse(require('fs').readFileSync('i18n/'+f,'utf8')); console.log('i18n json ok')"
```

from repo root.

```powershell
git diff --check
```

No whitespace errors. The command still printed the global git-ignore permission warning and CRLF conversion warnings.

## Tooling Installed or Discovered

### Node/npm

Installed before this session:

```text
node v22.19.0
npm 11.13.0
```

Root, server, and mobile `node_modules/` were already present.

### JDK 17

Installed during this session with winget:

```powershell
winget install --id EclipseAdoptium.Temurin.17.JDK --exact --accept-package-agreements --accept-source-agreements
```

Installed Java path discovered:

```text
C:\Program Files\Eclipse Adoptium\jdk-17.0.18.8-hotspot\bin\java.exe
```

### Gradle

`winget install --id Gradle.Gradle --exact ...` did not find a package.

However, a Gradle distribution is already cached locally:

```text
C:\Users\Junaid\.gradle\wrapper\dists\gradle-8.11.1-all\2qik7nd48slq1ooc2496ixf4i\gradle-8.11.1\bin\gradle.bat
```

The Android SDK is present:

```text
C:\Users\Junaid\AppData\Local\Android\Sdk
```

`android/local.properties` points at that SDK.

### WSL/Bash

Windows `bash.exe` exists, but WSL launch is denied:

```text
Error code: Bash/Service/CreateInstance/E_ACCESSDENIED
```

Git Bash exists and can be used instead:

```text
C:\Program Files\Git\bin\bash.exe
C:\Program Files\Git\usr\bin\bash.exe
```

This matters because `mobile/package.json` uses:

```json
"build": "bash scripts/build-web.sh"
```

On this shell, plain `bash` resolves to blocked WSL. Use Git Bash explicitly for the mobile web build.

## Docker/PostGIS Attempt

Docker Desktop was present and was started once. `docker ps` initially worked after Docker Desktop startup, but later Docker CLI access required elevation and hit permission warnings around `C:\Users\Junaid\.docker\config.json`.

An attempt to create/start a local PostGIS container named `takbeer-test-postgis` was aborted by the user. The user then clarified that an operational server already exists and should be used instead.

No local PostGIS container setup should be assumed complete.

## Existing Operational Server

The user clarified:

- Web/static server: `192.168.18.51:6002`
- Backend/API server: discovered at `192.168.18.51:6001`
- SSH host: `junaid@192.168.18.51`

Checks:

```powershell
Invoke-WebRequest http://192.168.18.51:6002/
```

returned `200`.

```powershell
Invoke-WebRequest http://192.168.18.51:6002/health
```

returned `404`, confirming port `6002` is static web, not Express.

```powershell
Invoke-WebRequest http://192.168.18.51:6001/health
```

returned:

```json
{"status":"ok","timestamp":"2026-05-03T14:26:39.626Z","environment":"development"}
```

```powershell
Invoke-WebRequest "http://192.168.18.51:6001/api/mosques?limit=1"
```

returned a valid mosque response.

Port `3001` on that host refused connections.

Postgres port `5432` on that host is not exposed externally.

## SSH Discovery

Passwordless SSH works from this machine:

```powershell
ssh junaid@192.168.18.51 "pwd; hostname"
```

Result:

```text
/home/junaid
jqworkhorse
```

SSH debug showed authentication uses the local RSA key:

```text
Offering public key: C:\Users\Junaid/.ssh/id_rsa RSA SHA256:jZjsSmDcJOMmgGLKD572Kw5THXN6vlR0pexUzanzG5o
Server accepts key: C:\Users\Junaid/.ssh/id_rsa RSA SHA256:jZjsSmDcJOMmgGLKD572Kw5THXN6vlR0pexUzanzG5o
Authenticated to 192.168.18.51 ([192.168.18.51]:22) using "publickey".
```

The repo note in `docs/PUSH_NOTIFICATIONS.md` says the backend repo on the server is:

```text
~/Documents/GitHub/Jamat
```

Recommended server command shape:

```powershell
ssh junaid@192.168.18.51 "cd ~/Documents/GitHub/Jamat && <command>"
```

Do not commit plaintext passwords. SSH key auth is already sufficient.

## Local E2E Harness Setup Attempt

The local static server on `127.0.0.1:6002` was already running but served stale files: `js/config.js` did not include the new `devAuthEnabled` code.

The stale server was stopped and restarted from this workspace:

```powershell
node scripts/static-server.js 6002 .
```

After restart:

```powershell
Invoke-WebRequest http://127.0.0.1:6002/js/config.js
```

confirmed `devAuthEnabled` was present.

A local API proxy was started on `127.0.0.1:6001` to forward to `192.168.18.51:6001`, because local `js/config.js` points local builds at `http://localhost:6001/api`.

The proxy health check worked:

```powershell
Invoke-WebRequest http://127.0.0.1:6001/health
```

returned the remote backend health JSON.

## E2E Test Attempts

First e2e run:

```powershell
$env:BASE_URL='http://127.0.0.1:6002'
$env:HEALTH_URL='http://127.0.0.1:6001/health'
npm run test:e2e
```

failed with:

```text
spawn EPERM
```

Cause: Puppeteer could not launch Chromium inside the sandbox. Rerun with elevated command execution.

Second e2e run with elevated execution did launch Chromium, reached health, but failed due CORS:

```text
The 'Access-Control-Allow-Origin' header contains multiple values 'http://127.0.0.1:6002, http://127.0.0.1:6002'
```

Cause: the local proxy added `Access-Control-Allow-Origin` while the backend also returned one. The browser rejects duplicate ACAO values.

Fix for next attempt: update the local proxy to remove upstream `access-control-*` headers before writing the response headers, then add exactly one `Access-Control-Allow-Origin`.

Also note that browser requests used `http://localhost:6001/api/...`, while `BASE_URL` was `http://127.0.0.1:6002`. The proxy must allow both possible origins:

- `http://127.0.0.1:6002`
- `http://localhost:6002`

## Server Tests

Full server Jest tests were not completed in this session.

Reason:

- Local PostGIS setup was aborted.
- Remote Postgres is not exposed on port `5432`.
- SSH is available, so the right path is to run server integration tests directly on `192.168.18.51` in `~/Documents/GitHub/Jamat/server`, where the backend and database environment already exist.

Suggested command:

```powershell
ssh junaid@192.168.18.51 "cd ~/Documents/GitHub/Jamat/server && npm test -- --runInBand"
```

If that server repo is stale relative to this local workspace, push/sync the branch first or run only environment diagnostics there.

## Mobile Build

The mobile Capacitor build was not rerun successfully in this session.

Known issue:

- `npm run build` in `mobile/` calls `bash scripts/build-web.sh`.
- On this machine, plain `bash` launches WSL, and WSL is denied.

Suggested command using Git Bash:

```powershell
& "C:\Program Files\Git\bin\bash.exe" scripts/build-web.sh
```

from `mobile/`.

Then:

```powershell
npx cap sync
```

## Native Android Build

JDK 17 is now installed. Gradle can be invoked from the cached distribution:

```powershell
$env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-17.0.18.8-hotspot'
$env:ANDROID_HOME='C:\Users\Junaid\AppData\Local\Android\Sdk'
& "C:\Users\Junaid\.gradle\wrapper\dists\gradle-8.11.1-all\2qik7nd48slq1ooc2496ixf4i\gradle-8.11.1\bin\gradle.bat" -p android assembleDebug
```

This was not completed after the user redirected focus to the existing server/SSH path.

## Current Useful Commands

Static web server from current workspace:

```powershell
node scripts/static-server.js 6002 .
```

Backend health through remote server:

```powershell
Invoke-WebRequest http://192.168.18.51:6001/health
```

SSH into operational server:

```powershell
ssh junaid@192.168.18.51
```

Run a command in the server repo:

```powershell
ssh junaid@192.168.18.51 "cd ~/Documents/GitHub/Jamat && git status --short"
```

Root unit tests:

```powershell
npm run test:unit -- --runInBand
```

Server build:

```powershell
cd server
npm run build
```

Server type-check tests:

```powershell
cd server
npx tsc -p tsconfig.test.json --noEmit
```

Prisma validate without a real DB:

```powershell
cd server
$env:DATABASE_URL='postgresql://user:pass@localhost:5432/db'
npx prisma validate
```

## Remaining Follow-Ups

1. Fix the local API proxy CORS behavior and rerun full root e2e tests.
2. Run full server Jest tests on the operational server via SSH, or expose/use a proper PostGIS test database locally.
3. Run mobile web build with Git Bash rather than WSL Bash.
4. Run native Android build with the installed JDK and cached Gradle.
5. Decide whether the intentionally skipped register takeover issue should still be tracked in a backlog/security doc.

## Continuation Update

The next Codex session resumed from this handoff and completed the following:

- Added `scripts/api-proxy.js`, a dependency-free local proxy for forwarding `localhost:6001` to the operational backend while stripping upstream `Access-Control-*` headers and writing exactly one local CORS origin.
- Replaced the old inline local proxy process with:

```powershell
node scripts/api-proxy.js 6001 http://192.168.18.51:6001
```

- Verified the proxy returns a single `Access-Control-Allow-Origin` for both:
  - `http://127.0.0.1:6002`
  - `http://localhost:6002`
- Ran full root e2e against the local static server and new proxy. The previous duplicate-CORS blocker is gone, but the full suite still fails because the remote backend has no `DEV_AUTH_USER_EMAIL` configured, so auth-dependent e2e flows that send `X-Dev-User-Email` receive `401 No authentication token provided`.
- Confirmed this directly with a `PUT /api/users/me/reminder-prefs` request through the proxy using `X-Dev-User-Email`, which returned `401`.
- Fixed `e2e/18-google-signin.test.js` so the mocked Google sign-in flow also stubs the post-login `/users/me` and `/users/me/favorites` calls; otherwise the fake JWT is correctly rejected by the real backend and cleared by the app.
- Verified:

```powershell
$env:BASE_URL='http://127.0.0.1:6002'
$env:SKIP_HEALTH='1'
npm run test:e2e -- --runTestsByPath e2e/18-google-signin.test.js
```

passed with 4/4 tests.

- Ran the server Jest suite over SSH on `~/Documents/GitHub/Jamat/server`. It tests the remote `main` checkout, not this local dirty `AndroidApp` workspace. Result: 10 suites passed, 2 failed, 139 tests passed, 4 failed.
- The remote failures were:
  - `auth.test.ts`: expected mixed-case email preservation although the API lowercases emails.
  - `accountDeletion.test.ts`: test emails used `@local`, which current email validation rejects.
- Updated the local versions of those tests to use lowercase bearer emails and `@local.test` addresses.
- Ran the mobile web build with Git Bash:

```powershell
& "C:\Program Files\Git\bin\bash.exe" scripts/build-web.sh
```

from `mobile/`; it passed.

- Ran `npx cap sync` from `mobile/`; it passed. iOS pod/xcode steps were skipped because CocoaPods and Xcode are not installed on Windows.
- Ran the root native Android build. First run failed because `android/app/src/main/AndroidManifest.xml` referenced missing launcher resources:
  - `@mipmap/ic_launcher`
  - `@mipmap/ic_launcher_round`
- Copied the existing launcher resources from `mobile/android/app/src/main/res` into `android/app/src/main/res`.
- Re-ran:

```powershell
$env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-17.0.18.8-hotspot'
$env:ANDROID_HOME='C:\Users\Junaid\AppData\Local\Android\Sdk'
& "C:\Users\Junaid\.gradle\wrapper\dists\gradle-8.11.1-all\2qik7nd48slq1ooc2496ixf4i\gradle-8.11.1\bin\gradle.bat" -p android assembleDebug
```

and it passed.

Additional local checks passed:

```powershell
cd server
npm run build
npx tsc -p tsconfig.test.json --noEmit
```

```powershell
npm run test:unit -- --runInBand
node --check scripts/api-proxy.js
git diff --check
```

`git diff --check` still prints CRLF warnings but exits successfully with no whitespace errors.

## Files Touched By This Session

Intended changes:

- `DEPLOYMENT.md`
- `android/app/build.gradle`
- `android/app/src/main/java/com/jamat/mosquelocator/data/remote/RemoteMosqueDataSource.kt`
- `android/app/src/main/java/com/jamat/mosquelocator/data/remote/dto/MosqueDto.kt`
- `i18n/ar.json`
- `i18n/bn.json`
- `i18n/fa.json`
- `i18n/fr.json`
- `i18n/hi.json`
- `i18n/id.json`
- `i18n/ms.json`
- `i18n/tr.json`
- `i18n/ur.json`
- `index.html`
- `js/__tests__/apiAuthHeader.test.js`
- `js/api.js`
- `js/app.js`
- `js/config.js`
- `js/delete-account.js`
- `js/i18n.js`
- `server/src/__tests__/suggestions.test.ts`
- `server/src/middleware/auth.ts`
- `server/src/routes/suggestions.ts`
- `server/src/routes/users.ts`
- `docs/SESSION_HANDOFF_2026-05-03.md`

Pre-existing unrelated changes still present:

- `.claude/settings.local.json`
- `.claude/worktrees/agent-afd5bea8fdf67f7e5`
- `js/reminders.js`
- `mobile/android/app/capacitor.build.gradle`
- `mobile/android/capacitor.settings.gradle`
- `mobile/ios/App/Podfile`
- `screenshots/2026-05-03-verify/`

## Capacitor Android Continuation

The user clarified that this is a Capacitor app, so verification moved from the root `android/` project to `mobile/android`.

- Used Android Studio's bundled Java 21 runtime:

```powershell
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME='C:\Users\Junaid\AppData\Local\Android\Sdk'
```

- Rebuilt the Capacitor web bundle from `mobile/`:

```powershell
& "C:\Program Files\Git\bin\bash.exe" scripts/build-web.sh
```

- Re-synced Capacitor from `mobile/`:

```powershell
npx cap sync
```

- Rebuilt the Android APK from `mobile/android`:

```powershell
.\gradlew.bat assembleDebug
```

The build passed. Gradle printed the existing warning that Android Gradle Plugin 8.7.2 was tested up to compileSdk 35 while this project uses compileSdk 36.

### Native Auth Fix

Found and fixed a Capacitor-specific production-auth issue in `mobile/native-bridge.js`:

- In the native shell, `location.hostname` is `localhost`.
- The shared web config could therefore enable dev auth in the packaged app.
- `mobile/native-bridge.js` now forces:

```javascript
window.JAMAT_CONFIG.apiBase = 'https://takbeertime.com/api';
window.JAMAT_CONFIG.devAuthEnabled = false;
window.JAMAT_CONFIG.isNative = true;
```

After this fix, `node --check mobile/native-bridge.js`, `scripts/build-web.sh`, `npx cap sync`, and `mobile/android` `assembleDebug` all passed.

### Device Status

The physical phone was reported by the user as connected. Initially ADB did not enumerate it; after restarting ADB, `adb devices -l` showed only:

```text
emulator-5554 device
```

Later in the session the physical phone appeared:

```text
RFCX308Z3NB device product:dm3quew model:SM_S918U1 device:dm3q
emulator-5554 device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64xa
```

Installed the rebuilt debug APK on the phone without uninstalling or clearing data:

```powershell
adb -s RFCX308Z3NB install -r mobile/android/app/build/outputs/apk/debug/app-debug.apk
adb -s RFCX308Z3NB shell am start -n com.takbeertime.app/.MainActivity
```

The install succeeded and the app launched on the physical phone. Screenshot: `screenshots/2026-05-03-verify/capacitor-phone-launch.png`.

The phone kept its existing signed-in/default-masjid app data. No destructive phone actions were taken.

### Emulator Runtime Verification

Installed and launched the rebuilt Capacitor APK on emulator serial `emulator-5554`:

```powershell
adb -s emulator-5554 install -r mobile/android/app/build/outputs/apk/debug/app-debug.apk
adb -s emulator-5554 shell pm clear com.takbeertime.app
adb -s emulator-5554 shell am start -n com.takbeertime.app/.MainActivity
```

Representative runtime checks passed on the emulator:

- App launched past the splash screen and rendered the home screen.
- The home screen loaded live mosque list data, including Faisal Mosque.
- The sign-in modal showed production behavior: Google sign-in plus email/password, with no email-only dev-auth path.
- Location permission flow opened the Android system prompt and returned to the app.
- The native geolocation path updated the "Salah by sun position" panel with calculated prayer times.
- Browse/Favorites tabs switched correctly.
- Favorites showed the signed-out empty state.
- Search for `Faisal` filtered the mosque list.
- Recent log samples showed no fatal app exceptions.

Screenshots were saved under `screenshots/2026-05-03-verify/`, including:

- `capacitor-current.png`
- `capacitor-signin.png`
- `capacitor-nearby.png`
- `capacitor-favorites-scrolled.png`
- `capacitor-search.png`

Important caveat: this is representative emulator verification, not a complete certification that every function in the app works. Authenticated production flows, real Google sign-in, real physical-device GPS behavior, notification scheduling on device hardware, and server-side write paths still need device/account-backed verification.

### Physical Phone Runtime Verification

Representative physical-device checks:

- APK install/update succeeded on `RFCX308Z3NB` (`SM_S918U1`).
- App launched and rendered on the phone.
- Existing signed-in/default-masjid state loaded.
- `dumpsys window` showed `com.takbeertime.app/.MainActivity` as the focused activity.
- Recent phone `logcat` sample showed no fatal app exceptions.

### Final Local Test Notes

Passed after the Capacitor native fix:

```powershell
node --check mobile/native-bridge.js
npm run test:unit -- --runInBand
cd server; npm run build
cd server; npx tsc -p tsconfig.test.json --noEmit
git diff --check
```

`git diff --check` exits 0 and prints only CRLF warnings.

Full local server Jest was attempted from `server/`:

```powershell
npm test -- --runInBand
```

It failed because local `server/.env` is missing and `DATABASE_URL` is not set in this PowerShell environment. The failures were Prisma initialization failures, not assertion failures from the code change.

### Reminder Sleep Test Attempt

A reminder notification test was run on the physical phone through the WebView debug protocol, using the same Capacitor `LocalNotifications.schedule` path and `prayer-reminders-v2` channel as real reminders.

Observed:

- `POST_NOTIFICATIONS` was granted.
- `LocalNotifications.checkExactNotificationSetting()` returned `{ exact_alarm: "denied" }`.
- The app scheduled test notification ID `1900803371` for `2026-05-03 21:34:24.985`.
- `dumpsys notification --noredact` later showed `StatusBarNotification(pkg=com.takbeertime.app ... id=1900803371 ... channel=prayer-reminders-v2)`.
- `dumpsys alarm` showed the alarm delivered at about `2026-05-03 21:34:58.736`, roughly 34 seconds after the requested time.

Caveat: this was not a clean full asleep/doze proof. The phone was active/charging and later showed an active WhatsApp call screen. The result proves the native notification scheduling path posts through Android, but exact-alarm permission is currently denied, so Android may delay reminders while asleep. For a stronger proof, enable the app's Android "Alarms & reminders" permission, then rerun with the phone idle and forced screen-off via `cmd power sleep`.

### Reminder Sleep Test Success

The stronger physical-phone sleep test was rerun after enabling the app's exact-alarm app-op:

```powershell
adb -s RFCX308Z3NB shell cmd appops set com.takbeertime.app SCHEDULE_EXACT_ALARM allow
```

The app then reported exact alarms as granted:

```text
exact_alarm: granted
```

Test notification:

- ID: `1901777001`
- Title: `Sleep reminder verification 2`
- Scheduled fire time: `2026-05-03 21:50:31.974`
- Channel: `prayer-reminders-v2`
- Sound: `prayer_chime`
- Schedule: `allowWhileIdle: true`

After scheduling, the phone was forced back to sleep:

```powershell
adb -s RFCX308Z3NB shell cmd power sleep
```

At verification time, Android still reported the screen off:

```text
mScreenOn=false
```

`dumpsys notification --noredact` showed the notification posted:

```text
pkg=com.takbeertime.app id=1901777001
android.title=Sleep reminder verification 2
android.text=This reminder fired while the phone was asleep.
mSound=android.resource://com.takbeertime.app/raw/prayer_chime
mInterruptionTimeMs=2026-05-03 21:50:32.490+0500
```

The user also confirmed the phone woke and made a bing sound. This verifies the native reminder path can fire while the phone is asleep when notification permission and exact-alarm permission are granted.

### Sun Fiqh Timing Fix

Issue: the sun-position card's fiqh dropdown visually defaulted to Hanafi, but `renderSunTimes()` fell back to Shafi'i when no saved fiqh existed. That made the first Hanafi-to-Shafi'i change appear unchanged.

Fix:

- `js/app.js` now uses `DEFAULT_SUN_FIQH = 'hanafi'`.
- `wireSunCard()` sets the select to Hanafi when no valid saved fiqh exists.
- `renderSunTimes()` reads the live `#sun-fiqh` select value before falling back to storage/default.
- Added `js/__tests__/sunFiqh.test.js` to prove Hanafi Asr differs from Shafi-style presets and angle-based methods change Fajr/Isha.

Verification:

```powershell
node --check js/app.js
npm run test:unit -- --runInBand js/__tests__/sunFiqh.test.js
```

The Capacitor Android APK was rebuilt/synced before install, then installed on the physical Samsung device `RFCX308Z3NB`. WebView CDP verification against the running phone app showed:

```text
Hanafi Asr: 4:53 pm
Shafi Asr: 3:47 pm
asrChangedOnDropdownChange: true
```

Note: Shafi'i, Maliki, and Hanbali currently share the same Asr-shadow preset in `js/sun.js`, so those three will not differ from each other. Hanafi differs from those; ISNA/Egypt/Umm al-Qura differ through Fajr/Isha angle/rule settings.
