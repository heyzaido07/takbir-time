# Releasing Takbeer Time to the Play Store

This is the operator runbook — the steps **you** run to cut a release.
For CI internals (workflow file, required secrets), see
[`PLAY_AUTO_DEPLOY.md`](./PLAY_AUTO_DEPLOY.md).

## TL;DR — happy-path release

```bash
# 1. Branch off latest main
git fetch origin && git checkout -b release/vX.Y origin/main

# 2. Bump user-visible versions (3 files, must agree)
#    mobile/android/app/build.gradle    → versionName "X.Y"
#    mobile/ios/App/App.xcodeproj/project.pbxproj → CURRENT_PROJECT_VERSION = N+1, MARKETING_VERSION = X.Y (4 occurrences total: 2 debug + 2 release)
#    mobile/package.json                → "version": "X.Y.Z"

# 3. Make whatever code/asset changes belong in this release. Sync + smoke-test:
cd mobile && npm run sync                           # build web, copy to android+ios
./android/gradlew.bat -p android assembleDebug       # local sanity build
adb -s <device> install -r android/app/build/outputs/apk/debug/app-debug.apk

# 4. Commit + push the release branch
#    Stage only the intended release files; do not sweep local agent artifacts.
git add <changed-release-files>
git commit -m "Release vX.Y: <one-line summary>"
git push -u origin release/vX.Y

# 5. Fast-forward main and push
git checkout main && git merge --ff-only release/vX.Y && git push origin main

# 6. Merge main into live (this triggers the Play Store auto-deploy)
#    Use the live worktree at D:/MyGitHub/takbeer-auto-deploy-fix
cd /d/MyGitHub/takbeer-auto-deploy-fix
git pull origin live --ff-only
git merge origin/main --no-ff -m "Merge main into live for vX.Y"
git push origin live

# 7. Watch the workflow finish
gh run list --limit 1
gh run watch <run-id>
```

Total time end-to-end: ~5 min of typing + ~5 min of CI.

---

## Branch model

| Branch | Purpose |
|---|---|
| `main` | Source of truth. PRs land here. Tag releases from here. |
| `live` | Production trigger. Pushing to `live` runs `auto-release-to-play.yml` and uploads the AAB to the **internal** Play track. |
| `release/vX.Y` | Short-lived branch where you stage version bump + release commit before fast-forwarding main. |
| `fix/<topic>` | Short-lived branch for hotfixes (same flow as release branches, just no version bump if it's a debug-only fix). |

`AndroidApp` is **legacy** — the package was renamed `com.takbeertime.app → com.takbeertime.android` on main long ago. Do not merge AndroidApp into anything; it will drag the old package back. If you need code from there, cherry-pick or patch by hand.

---

## Versioning rules

Android Play Store **rejects re-uploads with the same `versionCode`**. The GitHub release workflow patches Android `versionCode` during CI to a strictly increasing value based on the workflow run number. `versionName` is the user-visible string and comes from `mobile/android/app/build.gradle` unless you manually override it in workflow_dispatch.

| File | Field | Bump every release |
|---|---|---|
| `mobile/android/app/build.gradle` | `versionCode` | Optional locally — CI patches this upward before Play upload |
| `mobile/android/app/build.gradle` | `versionName` | Yes (matches the X.Y you announce) |
| `mobile/ios/App/App.xcodeproj/project.pbxproj` | `CURRENT_PROJECT_VERSION` (×2) | Yes |
| `mobile/ios/App/App.xcodeproj/project.pbxproj` | `MARKETING_VERSION` (×2) | Yes |
| `mobile/package.json` | `version` | Yes (semver, optional but keep aligned) |

Keep the four numbers in sync — the iOS pbxproj has 2 build configurations (Debug + Release), so `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` each appear twice; `replace_all` is safe in `Edit`.

---

## What triggers the Play Store deploy

A push to the `live` branch that touches mobile/web app files runs `.github/workflows/auto-release-to-play.yml`, which:

1. Builds a signed AAB (uses the keystore secrets — see `PLAY_AUTO_DEPLOY.md`).
2. Uploads to the Play Console **internal** track via the `play-store-deployer@takbeerapp.iam.gserviceaccount.com` service account.
3. From there, you promote internal → alpha → beta → production manually in Play Console UI.

`internal` is intentional: it gates risky pushes behind a human "promote" click. Don't try to skip it from CI.

`gh run list --limit 5` shows recent runs; `gh run watch <id>` tails one.

---

## App icons

The launcher icon comes from `playstore-kit/icons/source-icon-1024.png` (master). To regenerate the per-density Android mipmap PNGs at the right safe-zone scale (so Android's adaptive mask doesn't clip the logo):

```powershell
cd mobile
pwsh scripts/regen-icons.ps1
```

Generates `mipmap-{m,h,x,xx,xxx}hdpi/ic_launcher{,_foreground,_round}.png`. The script puts the logo at 60% of the 108dp adaptive canvas (matches Material's 66dp safe-zone diameter for round masks). Tweak `$FG_SCALE` in the script to dial up or down.

After regen: `npm run sync` (copies to native projects) → rebuild → install → eyeball on a real device. **Do not** rely on Android Studio's emulator for icon QA — masks differ.

---

## Google Sign-In + SHA-1 fingerprint management

This is the most common deploy footgun. Symptoms:
- Sign-in fails with `error code 10` (`DEVELOPER_ERROR`) → SHA-1 mismatch.
- Works on Play Store builds but not on local debug → debug keystore SHA-1 isn't registered.
- Worked yesterday, broken today → someone re-keyed.

### What needs to be registered in Firebase

For **`com.takbeertime.android`** (the production package), at minimum:

| SHA-1 | Source | Why |
|---|---|---|
| Play App Signing SHA-1 | Play Console → Setup → App integrity → App signing | Required for users who download from Play Store (Play re-signs the AAB) |
| Each developer's debug keystore SHA-1 | `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android` | Required for `gradlew assembleDebug` builds installed via adb |

Add new fingerprints at **Firebase Console** → takbeerapp → ⚙️ Settings → Your apps → `com.takbeertime.android` → Add fingerprint → paste with colons (Firebase normalizes). Then **Download `google-services.json`** and replace the one in `mobile/android/app/`.

After replacing, sync + rebuild + reinstall. The new file will list multiple `oauth_client` entries with different `certificate_hash` values under `com.takbeertime.android` — that's correct, Firebase accepts whichever signed the running APK.

### Get this machine's debug SHA-1

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
keytool -list -v -keystore "$env:USERPROFILE\.android\debug.keystore" -alias androiddebugkey -storepass android -keypass android | Select-String "SHA1"
```

Output looks like `SHA1: 2B:7E:27:2E:42:35:40:1A:5D:21:08:D5:15:69:E9:CB:3C:2A:92:AF`.

### Don't confuse files

- `mobile/android/app/google-services.json` — **Firebase Android config.** Includes OAuth allowlist. Lives in the repo. Replace from Firebase Console after fingerprint changes.
- `Google-Takbeer-AppKey.json` (or similar service-account JSONs) — **Play Store deployer key.** Used by GitHub Actions only. Lives as a CI secret (`PLAY_SERVICE_ACCOUNT_JSON`). Never commit.

---

## Doze / battery optimization (prayer reminders)

Reminders use `LocalNotifications.schedule({ at, allowWhileIdle: true })`. The `allowWhileIdle` flag plus `SCHEDULE_EXACT_ALARM` in `AndroidManifest.xml` is the only thing keeping reminders from being silently held back through Doze on Android 8+.

If you ever change reminder scheduling code in `mobile/native-bridge.js`, **always preserve `allowWhileIdle: true`**. Without it, the symptom is "reminder didn't ring at 5:00 PM, but fired the moment I opened the app at 5:30 PM" — and it's invisible to QA unless the test scenario actually backgrounds the app for ≥10 minutes through a real prayer-time crossing.

`mobile/native-bridge.js` also runs a stale-cleanup sweep on launch + resume, scoped to `extra.type === 'prayer_reminder'`. Don't widen that scope or you'll start cancelling keeper-update push banners by mistake.

---

## Pre-flight checklist (before pushing to live)

- [ ] CI workflow will produce a `versionCode` strictly higher than the last AAB on Play Console
- [ ] `versionName` follows your scheme
- [ ] iOS pbxproj versions match (even if you're not shipping iOS this round)
- [ ] Local `gradlew assembleDebug` succeeds
- [ ] Installed debug APK on a real device, signed in with Google, scrolled the masjid list, fired a test reminder
- [ ] If Firebase config changed: confirmed the new `google-services.json` has both your debug SHA-1 and Play App Signing SHA-1 under the right package
- [ ] Working tree is clean except for the intended release diff (`git diff --stat origin/main`)
- [ ] No `com.takbeertime.app` strings in tracked sources (`git grep com.takbeertime.app -- ':!docs' ':!screenshots' ':!playstore-kit'` should be empty)

---

## Common pitfalls

| Symptom | Likely cause | Fix |
|---|---|---|
| Sign-in error 10 on debug build | Debug SHA-1 not in Firebase for the new package | Add SHA-1 → re-download `google-services.json` → rebuild |
| CI workflow fails at "Upload to Play Console" | versionCode already exists on Play | Re-run after the workflow run number advances, or set a higher `versionCode` in Gradle before pushing to `live` |
| Reminder fires at app-open time, body says "in 10 minutes" but prayer was 30 min ago | Doze suppressed the alarm; OS catches up at unlock | Confirm `allowWhileIdle: true` and `SCHEDULE_EXACT_ALARM` permission granted on Android 12+ |
| Launcher icon clipped by round mask | Logo art exceeds 66dp safe zone on the 108dp canvas | Re-run `mobile/scripts/regen-icons.ps1` (uses 60% scale) |
| Two app icons on home screen after deploy | Old `com.takbeertime.app` debug install lingering alongside new `com.takbeertime.android` | Long-press old icon → uninstall |
| Merge into main bringing back `com.takbeertime.app` | Merging AndroidApp branch (legacy) | Don't. Cherry-pick from main forward instead. |

---

## Rollback

If a release breaks production:

1. **Halt rollout in Play Console** — App → Production → halt rollout (only works if rollout % < 100). This stops new users from getting the broken build.
2. **Revert forward** — create a normal revert commit for the bad change on `main`, then merge that commit into `live`.
   ```bash
   git checkout main
   git pull origin main --ff-only
   git revert <bad-commit-sha>
   git push origin main

   git checkout live
   git pull origin live --ff-only
   git merge origin/main --no-ff -m "Merge main into live for rollback"
   git push origin live
   ```
   This triggers another Play Store deploy containing the reverted code with a **new higher** CI-generated versionCode.
3. **Cut a follow-up `vX.Y.1` patch from main** that fixes the bug forward — don't leave `live` permanently behind `main`.

For server-side issues (Express backend), Play Store rollback doesn't help — the backend deploy is separate. See `DEPLOYMENT.md`.

---

## See also

- [`PLAY_AUTO_DEPLOY.md`](./PLAY_AUTO_DEPLOY.md) — workflow file, required secrets, keystore bootstrap
- [`ANDROID_FIREBASE.md`](./ANDROID_FIREBASE.md) — Firebase project setup, OAuth client structure
- [`PUSH_NOTIFICATIONS.md`](./PUSH_NOTIFICATIONS.md) — FCM topics, server contract for keeper-update banners
- `../PLAY-STORE-CHECKLIST.md` — initial submission checklist (data safety, screenshots, age rating)
- `../playstore-kit/` — generated assets for Play Console listing (icon, copy, policies)
