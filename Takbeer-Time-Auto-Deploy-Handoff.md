# Takbeer Time — Auto-Deploy Pipeline Handoff

> **For Claude / Claude Code (read this first if you're an AI assistant):**
>
> The user is the boss / owner of the GitHub repo `mjqazi/Jamat` and the Step Robotics Google Play Console developer account. He's been handed this document by his project lead (Haris), who already wired up the auto-deploy infrastructure — three GitHub Actions workflows are merged on `main` and four signing-related secrets are set on the repo. Your job is to walk the boss through Phase 1–4 below and execute everything you can autonomously on his behalf.
>
> **What you should be able to do autonomously (using his local environment):**
> - Use `gh` CLI to verify the workflows exist on `main`, list current secrets, read run history.
> - After he downloads the Service Account JSON to a path he tells you, run `gh secret set PLAY_SERVICE_ACCOUNT_JSON --body @<path> --repo mjqazi/Jamat`.
> - Trigger the auto-release workflow on his behalf via `gh workflow run` for verification.
> - Watch run progress with `gh run watch`.
> - If `gh` is not authenticated, instruct him to run `gh auth login` (interactive — he must run it himself).
>
> **What he MUST do himself in a browser (no CLI exists for these):**
> - Phase 1 — GCP project + Service Account creation + JSON key download (Cloud Console UI only).
> - Phase 2 — Linking the GCP project in Play Console + granting Service Account permissions (Play Console UI only — Google has no API for this).
>
> **Critical safety rules:**
> - The keystore secrets (`ANDROID_KEYSTORE_*`) are already set. **Do NOT regenerate the keystore** — the existing one is the only key that can sign updates to the live app.
> - The Service Account JSON is sensitive. Tell the boss not to commit it. After you `gh secret set` it, the local file can be moved to a password manager.
> - Default workflow target is the `internal` track (safe — auto-promotes nothing to public users). Production rollouts are still manual unless he explicitly chooses `track=production` via `workflow_dispatch`.
>
> **Verify state before instructing him:** run `gh secret list --repo mjqazi/Jamat` to confirm the four `ANDROID_*` secrets are there. Run `gh api repos/mjqazi/Jamat/contents/.github/workflows | jq '.[].name'` to confirm the three workflow files are on `main`. If anything is missing, ask Haris to re-run prior setup before continuing.
>
> Begin by greeting the boss, summarizing what's already done (in 2–3 sentences), then asking which Phase he wants to start with.

---

## TL;DR

The Takbeer Time Android app (`com.takbeertime.android`) is live on Google Play Store. Three GitHub Actions workflows are already merged to the `main` branch of `mjqazi/Jamat` and will automatically build and release new versions when code is pushed — but the pipeline needs a Google Cloud Service Account JSON file to authenticate with the Play Store API. You (the boss) have push access to the repo and admin access to the Play Console account "Step Robotics". This document walks you through the three one-time setup phases (~20 min total) to wire everything together.

---

## Current State

**Already done:**

1. **Three GitHub Actions workflows** are merged and active in `mjqazi/Jamat`:
   - `.github/workflows/bootstrap-keystore.yml` — generates the signing keystore (one-time, already run).
   - `.github/workflows/build-android-aab.yml` — manual builder for debugging / first-time builds.
   - `.github/workflows/auto-release-to-play.yml` — the main pipeline: **any push to `main` triggers an automatic build and uploads a new AAB to Play Store**.

2. **GitHub secrets** are already configured on the repo:
   - `ANDROID_KEYSTORE_BASE64` — the keystore bytes (generated once, safe).
   - `ANDROID_KEYSTORE_PASSWORD` — keystore password.
   - `ANDROID_KEY_PASSWORD` — signing key password.
   - `ANDROID_KEY_ALIAS` — value: `upload`.

3. **Recovery folder** (your backup):
   - Path: `C:\Users\harri\Downloads\Takbeer Time\_recovery\`
   - Contains: keystore file (`takbeertime-upload.jks`), password file, fingerprints, and built AAB/APK samples.
   - **This is irreplaceable.** Guard the keystore password.

4. **App is live on Play Store**:
   - App ID: `com.takbeertime.android`
   - App name: "Takbeer Time"
   - Category: Lifestyle
   - Live in production across 177 countries as of 2026-05-03.
   - Public link: `https://play.google.com/store/apps/details?id=com.takbeertime.android`

5. **Firebase currently disabled** (by design):
   - The original package `com.takbeertime.app` was registered in Firebase with the original developer's keystore. The package was renamed to `com.takbeertime.android` when the repo was transferred because the old keystore was only on the original developer's local machine.
   - Google Sign-In and FCM push notifications are **off** in shipped builds.
   - Email/password auth, mosque map, prayer times, and reminders all work.
   - **Firebase can be re-enabled later** (see the "Re-enabling Firebase" section below).

---

## What You Need to Do

### Phase 1 — Create Google Cloud Service Account

This phase sets up a Service Account on Google Cloud that will authenticate the auto-deploy workflow with the Play Store API.

**Estimated time:** 10 minutes.

#### Step 1: Enable 2-Step Verification (if not already active)

1. **Go to** `https://console.cloud.google.com`
2. **Sign in** with the Gmail account that owns the "Step Robotics" Play Console developer account.
3. **Check 2-Step Verification status**:
   - Click your profile picture (top right) → **Google Account**.
   - Left sidebar → **Security**.
   - Look for "2-Step Verification" — if it says "Off" or "Not set up", click it.
   - **Turn on** 2-Step Verification using SMS or Google Prompt on your phone.
   - (This is mandatory for Cloud Console access since 2025.)

#### Step 2: Create a new GCP Project

1. **Return to** `https://console.cloud.google.com`
2. **Click the project picker** (top left, near the Google Cloud logo).
3. **Click "New Project"**.
4. **Enter project name:** `takbeer-time-play`
5. **Click "Create"** (location defaults to "No organization" which is fine).
6. Wait ~30 seconds for the project to initialize.
7. **Switch to the new project** — the project picker should show `takbeer-time-play` in the list; click it to activate.

#### Step 3: Enable Google Play Android Developer API

1. **In the search bar** (top of Cloud Console), type: `Google Play Android Developer API`
2. **Click the first result** → "Google Play Android Developer API".
3. **Click "Enable"** (blue button on the API page).
4. Wait for the API to enable (~10 seconds).

#### Step 4: Create a Service Account

1. **Search bar:** type `Service Accounts` → **Click "Service Accounts"** (under "APIs & Services").
2. **Click "Create Service Account"** (blue button, top left).
3. **Service account name:** `play-publisher`
4. **Click "Create and Continue"**.
5. On the "Grant this service account access to project" page:
   - You can leave "Grant roles to this service account" blank (no roles needed for now).
   - **Click "Continue"**.
6. On the "Grant users access to this service account" page:
   - **Click "Done"** (you'll manage permissions in Play Console, not here).

#### Step 5: Create and Download the JSON Key

1. **Click on the new Service Account** (`play-publisher@takbeer-time-play.iam.gserviceaccount.com`).
2. **Click the "Keys" tab** (top menu).
3. **Click "Add Key"** → **"Create new key"**.
4. **Select "JSON"** (radio button).
5. **Click "Create"**.
   - A JSON file will download to your computer (usually `takbeer-time-play-*.json`).
6. **Save this file somewhere safe**:
   - Recommended: a password manager (1Password, Bitwarden) or encrypted folder on your machine.
   - **DO NOT commit it to the repo.**
   - **DO NOT share it publicly.**
   - This file grants full release authority on your Play Store account — treat it like a password.

---

### Phase 2 — Link Service Account in Play Console

This phase grants the Service Account permission to build and release updates to your app.

**Estimated time:** 5 minutes.

#### Step 1: Open API Access Settings in Play Console

1. **Go to** `https://play.google.com/console`
2. **Sign in** with the same Gmail account (Step Robotics owner).
3. **Left sidebar** → **Setup** (scroll down if needed).
4. **Click "API access"**.

#### Step 2: Link the GCP Project

1. **Look for** "Link a Google Cloud project" or "Link an existing Google Cloud project" section.
2. **Click the button** (text varies, but it's a link action).
3. **In the dropdown**, select `takbeer-time-play` (the project you just created).
4. **Click "Link"** or **"Confirm"**.

#### Step 3: Grant App-Level Permissions to the Service Account

1. **After linking**, you should see the service account `play-publisher@takbeer-time-play.iam.gserviceaccount.com` in the list.
2. **Click on it** → **"Grant access"** (button or link).
3. **Switch to the "App permissions" tab** (if not already there).
4. **Click "Add app"** (or "Select an app").
5. **Find and select** "Takbeer Time" (the app `com.takbeertime.android`).
6. **Click "Add"** or **"Confirm"**.

#### Step 4: Grant Account-Level Permissions

1. **Switch to the "Account permissions" tab** (in the same dialog).
2. **Check (tick) the following:**
   - `Release apps to testing tracks`
   - `Release to production, exclude devices, and use Play App Signing`
   - `View app information and download bulk reports`
3. **Click "Invite user"** or **"Save"** (button text depends on Play Console UI version).
4. **Done.** The service account now has permission to build and release your app.

---

### Phase 3 — Add Service Account JSON to GitHub

This phase securely stores the Service Account credentials in GitHub so the workflow can authenticate with Play Store.

**Estimated time:** 2 minutes.

#### Step 1: Add the Secret to GitHub

1. **Go to** `https://github.com/mjqazi/Jamat/settings/secrets/actions`
2. **Click "New repository secret"** (green button, top right).
3. **Name field:** `PLAY_SERVICE_ACCOUNT_JSON`
4. **Value field:**
   - Open the JSON file you downloaded in Phase 1 (use Notepad or any text editor).
   - Select all text (Ctrl+A).
   - Copy (Ctrl+C).
   - Paste the entire contents into the "Value" field on GitHub.
5. **Click "Add secret"**.

**Done.** GitHub now has the credentials to authenticate with Play Store.

---

### Phase 4 — Verify Auto-Deploy Works

This phase confirms the entire pipeline is wired correctly end-to-end.

**Estimated time:** 10 minutes.

#### Step 1: Make a Test Commit

1. **Clone or pull the latest `main` branch** of `mjqazi/Jamat` (if you haven't already).
2. **Make a tiny test change** — something harmless that won't affect the app:
   - Example: edit `.github/workflows/auto-release-to-play.yml` and add a comment at the top: `# Auto-deploy verified on <today's date>`
   - Or edit `mobile/capacitor.config.ts` and add a comment.
   - Or edit the root `index.html` and change a comment.
3. **Commit:** `git commit -m "Test: verify auto-deploy pipeline is working"`
4. **Push to main:** `git push origin main`

#### Step 2: Watch the Workflow Trigger

1. **Go to** `https://github.com/mjqazi/Jamat/actions`
2. **Look for a workflow run** labeled "Auto-release to Play Store" (it should appear within ~30 seconds of your push).
3. **Click on it** to see the build progress.
4. **Workflow typically takes 6–8 minutes.** You should see:
   - ✅ `Build Android AAB`
   - ✅ `Upload AAB to Play Store (internal track)`
   - ✅ Workflow completes green.

#### Step 3: Confirm the Release in Play Console

1. **Go to** `https://play.google.com/console` → **Takbeer Time app**.
2. **Left sidebar** → **Test and release** → **Internal testing**.
3. **Look for a new release** with a version code higher than the current production version.
   - Example: if production is versionCode `200`, the internal release should be `201`, `202`, etc.
4. **Within minutes**, the internal testers should have access to the new build.

#### Step 4: Success!

If all steps above show green checkmarks and a new release appears in Play Console, **auto-deploy is fully functional.** You can now update the app by simply pushing code to `main`.

---

## How the Pipeline Works

### Triggers and Paths

- **Trigger:** Any push to the `main` branch.
- **Path filters:** Changes to these folders/files **trigger** a release:
  - `mobile/**` (Android code, resources, manifests)
  - `js/**` (JavaScript/logic shared with web)
  - `css/**` (styles)
  - `i18n/**` (translations)
  - Root HTML files (`index.html`, `app.html`, etc.)
- **Ignored paths:** Changes to docs, backend configs, or GitHub workflows themselves do **not** trigger auto-release (use manual workflow_dispatch instead).

### Version Numbering

- **versionCode** (internal build number):
  - Formula: `base (100) + GitHub run number`
  - Auto-increments with every workflow run.
  - Example: run #5 = versionCode 105, run #150 = versionCode 250.
  - **You don't need to manually bump it.**

- **versionName** (user-facing version):
  - Default: `1.0.<run_number>` (e.g., `1.0.42`)
  - Can be overridden via workflow_dispatch input if needed.
  - **Change only if you intentionally want a custom version name.**

### Build Steps

1. **Checkout code** from `main`.
2. **Restore the keystore** from `ANDROID_KEYSTORE_BASE64` secret.
3. **Build the AAB** (Android App Bundle) using Gradle.
4. **Sign the AAB** with the keystore (fully signed and ready for Play Store).
5. **Authenticate** with Play Store using `PLAY_SERVICE_ACCOUNT_JSON`.
6. **Upload the AAB** to the **internal testing track** (by default).
7. **Retain artifacts** in GitHub for 30 days (useful for debugging).

### Default Track: Internal

- **By default**, every push uploads to `internal` testing track.
- This lets internal testers preview the build before it goes to production.
- **No Play Review delay** for internal releases (instant).

### Override to Production (Manual)

- To release directly to **production** (and trigger Play Review):
  1. **Go to** `https://github.com/mjqazi/Jamat/actions`
  2. **Click "Auto-release to Play Store"** (left sidebar, under "Workflows").
  3. **Click "Run workflow"** (top right).
  4. **Set `track` input to:** `production`
  5. **Click "Run workflow"**.
  - Workflow builds and uploads to production track (Play Review takes 4–24 hours, usually ~2 hours for established accounts).
  - **Use sparingly** — every production release should be intentional.

### Concurrency Control

- **Workflow group:** `play-release` with `cancel-in-progress: false`
- **Effect:** If you push twice in quick succession, the second workflow will **wait** for the first to finish before uploading.
- **Prevents:** Race conditions / simultaneous edits to Play Store (API would reject).

---

## Day-to-Day Usage

### Normal Update — Code Push to Main

1. **Make changes** to mobile UI, backend, or translations.
2. **Test locally** (build APK locally if needed).
3. **Commit and push to `main`:**
   ```bash
   git commit -m "Feature: add new mosque in Lagos"
   git push origin main
   ```
4. **Within 30 seconds**, the auto-deploy workflow triggers.
5. **Within 6–8 minutes**, a new AAB is on Play Store (internal testing track).
6. **Internal testers** can install the new version immediately.
7. **When ready**, promote to production via Play Console UI (no Play Review delay for updates from established accounts, but can take a few hours to roll out).

### Emergency Hotfix — Direct Production Release

1. **Make the fix** and push to `main` (or a hotfix branch, then merge to `main`).
2. **Go to** `https://github.com/mjqazi/Jamat/actions`.
3. **Click "Auto-release to Play Store"** workflow.
4. **Click "Run workflow"** (top right).
5. **Set `track` to:** `production`
6. **Click "Run workflow"**.
7. **Workflow builds and uploads directly to production.**
8. **Play Review triggers** (usually 2–4 hours for established accounts; may be instant if no sensitive changes).
9. **Monitor Play Console** for review status and rollout percentage.

### Rolling Back a Bad Release

If a release shipped with a bug:

1. **Revert the commit** in Git:
   ```bash
   git revert <commit-hash>
   git push origin main
   ```
2. **Auto-deploy triggers** — a new build with the revert is uploaded to internal testing.
3. **Promote to production** via Play Console UI once verified.

Alternatively:

1. **In Play Console**, go to **Test and release** → **Production** → **Releases** (or **Manage release**).
2. **Halt the rollout** (set percentage to 0%) if it's in progress.
3. **Rollback** to a previous release (Play Console UI varies; look for "Rollback" or "Previous release" option).

---

## Re-enabling Firebase (Optional — Later)

**Context:** The original Firebase project was registered with the original developer's keystore and the old package name `com.takbeertime.app`. When the repo was transferred, the package was renamed to `com.takbeertime.android` to use the new upload keystore (managed in GitHub Actions).

**Current state:**
- Google Sign-In is **disabled**.
- FCM push notifications are **disabled**.
- Email/password auth works.
- Mosque map, prayer times, and reminders all work.

**To re-enable Firebase in the future:**

1. **Register the app in Firebase Console**:
   - Go to `https://console.firebase.google.com`
   - **Create a new project** or use an existing one.
   - **Add an app** → **Android**.
   - **Package name:** `com.takbeertime.android`
   - **App nickname:** "Takbeer Time"
   - **SHA-1 fingerprint of your upload keystore:**
     ```
     A9:78:E4:B2:A4:DF:BA:3A:C2:AD:A5:A5:A8:D1:EE:02:7C:00:8B:CA
     ```
     (This fingerprint is in your recovery folder: `android-keystore/fingerprints.txt`.)
   - **Register app** → **Download `google-services.json`**.

2. **Replace the placeholder**:
   - Replace `mobile/android/app/google-services.json.bak` with the newly downloaded `google-services.json`.
   - (Or rename the .bak file if it's just a placeholder.)

3. **Enable Firebase features in code**:
   - In the mobile Android code, uncomment or enable Firebase initialization.
   - (Specifics depend on your codebase — check the `MainActivity.kt` or main Activity for Firebase initialization blocks.)

4. **Commit and push to main**:
   ```bash
   git add mobile/android/app/google-services.json
   git commit -m "Enable Firebase push notifications and Google Sign-In"
   git push origin main
   ```

5. **Auto-deploy triggers** — next build will include Firebase support.

---

## Recovery & Disaster Scenarios

### Scenario 1: Keystore Secret Lost or Corrupted

**Problem:** `ANDROID_KEYSTORE_BASE64` secret was deleted or is corrupted.

**Solution:**
1. **Retrieve the backup keystore** from your recovery folder:
   - Path: `C:\Users\harri\Downloads\Takbeer Time\_recovery\android-keystore\takbeertime-upload.jks`
   - Also have the password: `C:\Users\harri\Downloads\Takbeer Time\_recovery\keystore-password.txt`
2. **Re-add the secret to GitHub**:
   - Convert the `.jks` file to base64: `cat takbeertime-upload.jks | base64`
   - Go to `https://github.com/mjqazi/Jamat/settings/secrets/actions`
   - Update `ANDROID_KEYSTORE_BASE64` with the base64 string.
3. **Next push to main** will rebuild and upload successfully.

**Important:** This keystore is **irreplaceable**. If you lose both the GitHub secret and the local backup, you **cannot build signed APKs/AABs** for this app and will be locked out of Play Store releases. Guard the recovery folder.

### Scenario 2: Service Account JSON Leaked

**Problem:** The `PLAY_SERVICE_ACCOUNT_JSON` secret was accidentally committed to the repo or shared.

**Solution:**
1. **Immediately revoke the old Service Account**:
   - Go to `https://console.cloud.google.com` → project `takbeer-time-play`.
   - **Search:** "Service Accounts" → click the `play-publisher` account.
   - **Delete the service account** (⋮ menu → Delete).
2. **Create a new Service Account** (repeat Phase 1, Steps 4–5).
3. **Re-grant permissions in Play Console** (repeat Phase 2, Steps 3–4).
4. **Update the GitHub secret** (repeat Phase 3, Step 1 with the new JSON).
5. **Next push** will use the new credentials.

The leaked JSON is now useless and can't access your Play Store account.

### Scenario 3: Workflow Stuck or Failed

**Problem:** A workflow run is in progress and won't finish, or completed with an error.

**Solution:**
1. **If in progress:** go to `https://github.com/mjqazi/Jamat/actions`, find the run, click "⋯" → **"Cancel workflow"**.
2. **Check the error log:**
   - Click the failed run → **"Build Android AAB"** or **"Upload AAB to Play Store"** job → read the error.
   - Common errors:
     - **"Account not authorized"** (403) → wait 5 min, re-run. Service Account permissions may not have propagated.
     - **"Keystore verification failed"** → `ANDROID_KEYSTORE_BASE64` or password is wrong. Verify against recovery folder.
     - **"Failed to build AAB"** → there may be a syntax error in the Android code. Check the build log for details.
3. **After fixing**, **commit a tiny change and push again** to re-trigger the workflow.

### Scenario 4: Bad Release Shipped to Production

**Problem:** An update went to production with a critical bug.

**Solution:**
1. **Immediate:** Halt further rollout:
   - Go to `https://play.google.com/console` → **Takbeer Time** → **Test and release** → **Production**.
   - Find the buggy release → **Manage release** → **Pause rollout** or set rollout percentage to **0%**.
2. **Fix the bug**:
   - Commit the fix to `main`.
   - Either: (a) push to `main` (auto-deploy to internal), test, then manually promote to production, or (b) run workflow_dispatch with `track=production` once fixed.
3. **Rollback (if user-facing crash)**:
   - In Play Console, find the **previous working release** → **Promote to production** or set as active release.
   - Users auto-update to the older version.

---

## Reference Links

| Item | Link |
|------|------|
| **GitHub Repo** | `https://github.com/mjqazi/Jamat` |
| **GitHub Actions** | `https://github.com/mjqazi/Jamat/actions` |
| **GitHub Secrets** | `https://github.com/mjqazi/Jamat/settings/secrets/actions` |
| **Play Store App** | `https://play.google.com/store/apps/details?id=com.takbeertime.android` |
| **Play Console** | `https://play.google.com/console` |
| **Play Console API Access** | `https://play.google.com/console` → Setup → API access |
| **Google Cloud Console** | `https://console.cloud.google.com` |
| **Firebase Console** | `https://console.firebase.google.com` |

### Workflow Files

All workflows are in `.github/workflows/`:

- **`bootstrap-keystore.yml`** — generates keystore (run once, already done).
- **`build-android-aab.yml`** — manual builder, good for first-time / debugging.
- **`auto-release-to-play.yml`** — the main auto-deploy pipeline (triggered on push to `main`).

---

## Success Checklist

After completing all phases, verify:

- [ ] 2-Step Verification is enabled on the Gmail account.
- [ ] GCP project `takbeer-time-play` exists and is active.
- [ ] "Google Play Android Developer API" is enabled in the project.
- [ ] Service Account `play-publisher@takbeer-time-play.iam.gserviceaccount.com` exists with a JSON key downloaded and saved securely.
- [ ] Service Account is linked in Play Console (Setup → API access).
- [ ] Service Account has app permissions for "Takbeer Time" and account permissions for releasing.
- [ ] GitHub secret `PLAY_SERVICE_ACCOUNT_JSON` is added to `mjqazi/Jamat`.
- [ ] A test push to `main` triggered the "Auto-release to Play Store" workflow.
- [ ] Workflow completed in ~6–8 minutes with no errors.
- [ ] A new release appeared in Play Console (internal testing track) with a higher versionCode.
- [ ] Recovery folder `C:\Users\harri\Downloads\Takbeer Time\_recovery\` is backed up and safe (contains irreplaceable keystore).

**All green?** You're done. Auto-deploy is live. Every future push to `main` will automatically build and release to Play Store.
