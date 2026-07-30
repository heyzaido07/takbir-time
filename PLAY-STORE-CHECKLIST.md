# Google Play Store Submission Checklist — Takbeer Time

Application: **Takbeer Time**
Package name: **`com.takbeertime.app`** (Capacitor — `mobile/`)
Public web app: **`https://takbeertime.com`**

This checklist mirrors the Play Console listing fields. Values to copy into the console are in **bold** or fenced code. Items marked **HUMAN REVIEW** need confirmation before submission.

---

## 1. Store listing (App information)

| Field | Value |
|---|---|
| App name | `Takbeer Time` |
| Short description (80 chars) | `Crowd-sourced jamat times. Never miss the first takbeer. Free, no ads.` |
| Full description | See **Appendix A** below. |
| App icon | **HUMAN REVIEW** — verify `mobile/android/app/src/main/res/mipmap-*/ic_launcher.png` exist at all densities (mdpi → xxxhdpi). 512×512 PNG also required for the listing itself. |
| Feature graphic | **HUMAN REVIEW** — required 1024×500. Not yet committed; produce one. |
| Phone screenshots (2–8) | **HUMAN REVIEW** — capture from the latest build (home, map, drawer, settings, sign-in, reminder panel). |
| 7" tablet screenshots (optional) | Optional; skip unless tablet UI is being polished. |
| App category | `Lifestyle` (or `Tools` — both are defensible; Lifestyle matches Muslim-prayer apps in the same niche). |
| Tags | `prayer times`, `mosque finder`, `jamat`, `Islamic`, `community`. |
| Contact details — email | `qazi.junaid@gmail.com` |
| Contact details — website | `https://takbeertime.com` |
| Contact details — phone | Optional; leave blank. |

---

## 2. Privacy & policies

| Field | Value |
|---|---|
| Privacy Policy URL | `https://takbeertime.com/privacy.html` |
| Terms of Use URL (in-app and listing) | `https://takbeertime.com/terms.html` |
| **Account deletion URL** (Play Console → Data Safety → "Account deletion") | `https://takbeertime.com/delete-account.html` |
| In-app account deletion | Wired in the footer of `index.html`. Signed-in users see the "Delete account" link, which opens the in-app confirm modal and calls `DELETE /api/users/me`. |

---

## 3. Data Safety form (Play Console)

This is the single most-rejected section. Match it to `privacy.html`.

### Data collection summary

- **Does your app collect or share any of the required user data types?** Yes.
- **Is all of the user data collected by your app encrypted in transit?** Yes (HTTPS, TLS 1.2+).
- **Do you provide a way for users to request that their data is deleted?** Yes — in-app and via `https://takbeertime.com/delete-account.html`.

### Data types — declare each as Collected (or Shared) with purpose + optional/required

| Data type | Collected? | Shared? | Purpose | Required? |
|---|---|---|---|---|
| **Personal info — Email** | Yes | No | Account management | Required for sign-in |
| **Personal info — Name** | Yes (optional) | No | Account management; attribution of submissions | Optional |
| **Personal info — User IDs** (Firebase UID) | Yes | No | Account management | Optional (only Google sign-ins) |
| **Personal info — Other (phone)** | Optional, present in schema, currently unused | No | (None active) | Optional |
| **Financial info** | No | — | — | — |
| **Health & fitness** | No | — | — | — |
| **Messages** | No | — | — | — |
| **Photos & videos** | No | — | — | — |
| **Audio files** | No | — | — | — |
| **Files & docs** | No | — | — | — |
| **Calendar** | No | — | — | — |
| **Contacts** | No | — | — | — |
| **App activity — In-app actions** (favorites, default mosque, reminder prefs, preferred keepers) | Yes | No | App functionality | Optional |
| **App activity — Other user-generated content** (submitted timings, reviews, suggestions, mosque records) | Yes | Yes (publicly via API) | App functionality + community directory | Optional |
| **App info & performance — Crash logs** | **HUMAN REVIEW** — Sentry is referenced in env vars but currently disabled. If you enable Sentry on the production deploy, declare this. | — | Crash diagnostics | Optional |
| **App info & performance — Diagnostics** | No | — | — | — |
| **App info & performance — Other** | No | — | — | — |
| **Device / other IDs** (FCM token managed by Google's SDK) | Yes (collected by FCM, not stored on our backend) | Shared with Google for push delivery | Push notifications | Optional |
| **Location — Approximate location** | Yes (in-memory only) | No | App functionality (find mosques near user) | Optional |
| **Location — Precise location** | Yes (in-memory only — used to compute sun-position prayer times locally) | No | App functionality | Optional |
| **Web browsing** | No | — | — | — |
| **Audio** | No | — | — | — |

### Security practices

- **Data is encrypted in transit:** Yes (TLS).
- **You can request that data be deleted:** Yes (in-app + web form).
- **Committed to follow Play Families Policy if applicable:** Not applicable — app not targeting families/children-under-13 audience.
- **App was independently security-reviewed:** No (declare honestly).

---

## 4. Content rating

Run the Play Console questionnaire. Expected answers (all "No" on violence, sex, drugs, gambling, etc.):

- Violence: No
- Sexuality: No
- Profanity: No
- Drugs/alcohol/tobacco: No
- Gambling/contests: No
- User-generated content: **Yes** — users submit prayer timings, reviews, suggestions. Disclose moderation policy: keepers + admin can remove inappropriate content; spam/abuse triggers ban. Reporting flow: email `qazi.junaid@gmail.com`.
- Shares user location: **Yes** — in-memory, never stored on the server. Disclosed in privacy policy.

Expected rating: **Everyone** (or 3+ in the IARC scale).

---

## 5. Target audience

- **Target age groups:** 13+, 14+, 15+, 16+, 17+, 18+ (deselect "under 13"). The app is generally usable by anyone old enough to use a phone, but we don't market to children.
- **Appeal to children?** No.

---

## 6. App access

- **Restricted parts of your app behind sign-in?** Yes — submitting timings, voting, suggesting updates, favourites, default mosque.
- **Provide test credentials for the review team:** **HUMAN REVIEW** — create a dedicated review-only account and put the credentials in this section. Use a throwaway email (e.g. `play-review@takbeertime.com`).
  - Email/password sign-in: works without Firebase configuration on the device.
  - Google sign-in: also works; either is fine for the reviewer.

---

## 7. Ads declaration

- **Does your app contain ads?** **No.**
- This is a sadqa-jariah project; the lack of ads is a stated design property.

---

## 8. App content — additional declarations

- **News app:** No.
- **COVID-19 contact tracing/status app:** No.
- **Government app:** No.
- **Financial features:** No.

---

## 9. Permissions audit (`mobile/android/app/src/main/AndroidManifest.xml`)

| Permission | Declared? | Justification | Notes |
|---|---|---|---|
| `INTERNET` | Yes | API calls, map tiles, Firebase | Required, no prominent disclosure needed. |
| `ACCESS_COARSE_LOCATION` | Yes | "Find mosques near me" | Disclosed in privacy + on-screen permission prompt. |
| `ACCESS_FINE_LOCATION` | Yes | Sun-position prayer-time calculation | Disclosed in privacy + on-screen permission prompt. |
| `POST_NOTIFICATIONS` | Yes | Prayer reminders + suggestion pushes | Required on Android 13+; user-prompted at runtime. |
| `SCHEDULE_EXACT_ALARM` | Yes | Fire prayer reminders at the exact minute | User-prompted via the OS "Alarms & reminders" toggle. **Note:** we deliberately do NOT declare `USE_EXACT_ALARM` — Play policy (May 2024) restricts that one to alarm/clock/calendar/timer apps. |
| `RECEIVE_BOOT_COMPLETED` | Yes | Re-arm prayer reminders after device reboot | Standard for any reminders app. |
| `VIBRATE` | Yes | Reminder + push haptic | Trivial. |

**Verdict:** all declared permissions are justified by features that are actually wired up. Nothing to remove.

When the Play Console asks about location-permission justification: declare **"App functionality — Find masjids near the user; compute sun-position prayer times."** Confirm "we never store user location on our servers."

---

## 10. Pre-launch report (automated test feedback)

Before final release, run an internal track upload and check the Play Console pre-launch report for:
- Crashes on Android 8 (API 26, our minSdk).
- Permission-related warnings (especially around location and notifications).
- Accessibility warnings (we use Material 3 + content descriptions, but a fresh look helps).

---

## 11. Build / signing

- **Application ID:** `com.takbeertime.app` (Capacitor's `mobile/capacitor.config.ts`).
- **Signing config:** **HUMAN REVIEW** — confirm Play App Signing is enabled and the upload key is stored securely (not in the repo). The first internal upload sets this up automatically.
- **Version code / version name:** **HUMAN REVIEW** — bump in `mobile/android/app/build.gradle` before each internal release.
- **AAB (not APK):** Play requires AAB. `./gradlew bundleRelease` produces it.

---

## 12. Things still open / need human eyes before submission

1. **Server hosting region** — privacy policy currently says "self-hosted server in Pakistan" but flagged as needing operator confirmation. Update `privacy.html` section 5 with the actual region.
2. **Sentry usage** — privacy policy says it's currently disabled. If/when you turn it on, change that paragraph and update the Data Safety declaration's "Crash logs" row.
3. **Listing-side art** — feature graphic (1024×500), at least 2 phone screenshots, app icon at 512×512 PNG.
4. **Test account credentials** — provision and document the play-review login.
5. **Run the deletion-flow once** end-to-end on the staging server, confirming the in-app "Delete my account" actually wipes the test account and that `/delete-account.html` queues the request.
6. **Migration** — apply `server/prisma/migrations/20260429_add_account_deletion_request/migration.sql` to the production DB (add a step to your deploy runbook).

---

## Appendix A — suggested full description (Play Store, ~4000 char max)

```
Takbeer Time helps you find the exact jamat (congregation) prayer times at masjids near you, so you can be in line before the imam says Allahu Akbar.

Free. No ads. Ever. This is a community project — sadqa fe sabilillah.

WHY TAKBEER TIME
Most prayer-time apps show astronomical begin-times — when the prayer time enters. They don't tell you when YOUR masjid actually holds jamat. Jamat times vary masjid-to-masjid (and season-to-season), and missing the takbeer means missing the prayer in jamat. Takbeer Time fixes that.

CROWD-SOURCED, KEEPER-VERIFIED
Anyone can submit a timing. Each masjid has one or more "time-keepers" — community members trusted to maintain accurate times. You can follow a keeper's times, or use the consensus across all submissions. When times change (Ramadan, daylight savings, summer schedule), pushes go out to everyone following.

WHAT YOU GET
- Find masjids near you on the map
- See today's jamat times for each masjid
- Set reminders before each prayer (Fajr, Dhuhr, Asr, Maghrib, Isha, Jummah)
- Track qaza namaz privately on your phone, then mark each one prayed
- Pin a default masjid — its next prayer is always on your home screen
- Save favorites
- Submit timings for masjids you pray at
- Suggest updates to time-keepers when their times need to change
- Sun-position prayer times computed locally for any fiqh (Hanafi, Shafi, Maliki, Hanbali, Jafari, ISNA, Egyptian, Umm al-Qura)
- 10 languages: English, Arabic, Urdu, Indonesian, Bengali, Hindi, Turkish, Persian, Malay, French

PRIVACY
We collect only what's needed to run the app: your email and the times/notes you submit. Your qaza namaz tracker is stored on your device, not published to the community directory. No analytics SDKs. No advertising trackers. No data sales. You can delete your account at any time, in-app or via our web form.

OPEN API
The full directory + jamat times are available via a free public API at takbeertime.com/api-docs. Build a widget for your masjid's website, a Slack bot, a dashboard — anything.

OPEN SOURCE
github.com/mjqazi/Jamat
```

---

## Appendix B — files this submission depends on

- `privacy.html` — Privacy Policy (this commit).
- `terms.html` — Terms of Use (this commit).
- `delete-account.html` — public-form account deletion (this commit).
- `index.html` — footer updated to link Privacy / Terms / Delete account.
- `js/delete-account.js` — in-app account deletion UI hook.
- `server/src/routes/users.ts` — `DELETE /api/users/me` endpoint.
- `server/src/routes/accountDeletion.ts` — `POST /api/account-deletion-request` endpoint.
- `server/prisma/migrations/20260429_add_account_deletion_request/` — DB migration.
- `mobile/scripts/build-web.sh` — copies the new HTML pages into the mobile bundle.
