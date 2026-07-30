# What's still required (you must produce these yourself)

This kit covers the **text + policy + icon** part of the Play Store
submission. The items below are NOT in the zip because they have to come
from a built/designed/captured artifact — Claude can't generate them
from documentation alone.

## 1. Signed Android App Bundle (.aab) — REQUIRED

Play requires AAB (not APK).

```bash
cd mobile
npm run build              # snapshot index.html + js/ + css/ into www/
npx cap sync android       # copy www/ + plugins into android/
cd android
./gradlew bundleRelease    # produces app/build/outputs/bundle/release/app-release.aab
```

You'll need:
- JDK 17 (`sudo apt install openjdk-17-jdk` or Windows JDK 17 installer)
- Android SDK (install via Android Studio)
- A signing keystore. Per `DEPLOYMENT.md`:
  ```bash
  keytool -genkey -v -keystore takbeertime-release.keystore \
    -alias takbeertime -keyalg RSA -keysize 2048 -validity 10000
  ```
  Then wire the signing config into `mobile/android/app/build.gradle`
  with env vars `JAMAT_KEYSTORE_PATH`, `JAMAT_KEYSTORE_PASSWORD`,
  `JAMAT_KEY_PASSWORD`.

⚠️ NEVER bundle the keystore into the zip you upload anywhere. Keep it
private. Play App Signing (set up at first internal-track upload) holds
the upload key for you.

Also: bump `versionCode` (currently 1) in
`mobile/android/app/build.gradle` BEFORE each upload. Play rejects
re-uploads of the same versionCode.

## 2. Feature graphic — 1024 × 500 PNG/JPG — REQUIRED

Designed banner for the listing. Not in the repo. Brand colors per
the Capacitor splash config:
- Background: `#0d2818` (dark green)
- Accent: `#d6b266` (brass)

## 3. Phone screenshots — 2 to 8 PNG/JPG — REQUIRED

Capture from the latest installed build:
- Home (map view)
- Masjid drawer with prayer times
- Settings drawer
- Sign-in screen
- Reminder panel / clock indicators
- Profile / submissions

Use a real device or emulator at a phone resolution (16:9 or 9:16,
e.g. 1080×1920 or 1080×2400). Avoid status-bar clutter.

## 4. Test account credentials — REQUIRED

Provision a dedicated review-only account (e.g. `play-review@takbeertime.com`)
with a known password. Enter the email + password in:
**Play Console → App content → App access → Provide credentials.**

Both Email/password sign-in and Google sign-in work; either is fine for
the reviewer.

## 5. Privacy policy — content review needed

Open `policies/privacy.html` and confirm:

- **Section 5 — server hosting region.** The current text says
  "self-hosted server in Pakistan" but is flagged for operator
  confirmation. Update with the actual region of your production server
  before submitting.
- **Sentry.** The policy says crash logging is currently disabled.
  If you turn Sentry on in production, update the policy paragraph AND
  set the "Crash logs" row in `compliance/data-safety.md` to Yes.

## 6. Tablet screenshots (optional) — skip unless polishing tablet UI

## 7. One-time prod-DB step

Apply the account-deletion-request migration on the prod DB before
relying on `https://takbeertime.com/delete-account.html` queue:

```bash
DATABASE_URL=<prod-direct-url> npx prisma migrate deploy
```

Migration file:
`server/prisma/migrations/20260429_add_account_deletion_request/migration.sql`

## 8. Smoke-test the deletion flow end-to-end

Sign in with a throwaway account, hit "Delete account" in the app
footer, confirm the row is removed and a deletion-request row is queued.
Then open `https://takbeertime.com/delete-account.html`, fill the form,
confirm a queue row is created. This is a checklist item Play Review
can validate by spot-checking.
