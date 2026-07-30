# Master Feature & Requirements List — Takbeer Time

> Synthesised 2026-05-28 from the canonical `origin/main` history, the canonical docs (`FEATURES.md`, `ARCHITECTURE.md`, `CHANGELOG.md`, `WHATS-NEW.md`, `AGENTS.md`), and all other remote branches available at that review point (each was either fully merged into `main` or a stale predecessor of work already on `main` under a different SHA — no unique features hid elsewhere).
>
> **Revised 2026-05-28** to resolve the requirement conflicts identified in review. Resolution decisions are inlined where they apply; see §10 for the change log.
>
> Status legend: ✅ shipped · 🚧 partially shipped · 📋 planned/deferred · 🔧 resolution decision (this revision) · 🆕 added from the most recent commit

---

## 0. What the app is

Takbeer Time (Urdu/Arabic for "time of takbeer") is a **crowd-sourced jamat-times directory** — a global, multilingual mosque-finder that shows when each masjid actually holds congregational prayer, not just the astronomical times. The data is community-maintained: anyone can submit timings, top contributors per masjid verify, and the canonical schedule converges via a transparent consensus engine. The product surfaces are:

- a **vanilla-JS, build-step-free web app** at `takbeertime.com`,
- an **Android app** (Capacitor wrapper around the same web code, `com.takbeertime.android`),
- and a public **Express/TypeScript backend** with PostgreSQL + PostGIS storing **281,696 mosques across 168 countries** (seeded from OpenStreetMap).

Self-described as "sadqa jariya" — there is a published open API at `/api-docs.html` and the codebase is GitHub-hosted; "there's an angel out there counting every API hit. Not us."

### Macro evolution

1. **Nov 2025** — 4-commit prototype drop (`index.html`, an old Kotlin `android/` shell), then 5 months dormant.
2. **Late Apr 2026 (~50 commits / 10 days)** — explosive build-out via a single mega-commit (`6a6bba7`) plus rapid iteration on top.
3. **Early-mid May 2026 (~45 commits)** — Play Store hardening: auth, signing, FCM push, compliance pages, admin panel, Docker production deploy.
4. **Late May 2026 (~13 commits)** — feature surface (Qaza tracker, Jummah scrapers, drawer redesign) plus v3.x / v4.0 releases.

Most substantive commits are co-authored by Claude Opus 4.7; an autonomous TDD ("Ralph") loop has been driving iteration (frontend e2e suites grew 39 → 45 → 36/36 across 9 suites; backend tests grew 49 → 52 → 62 → 64 → 69+).

---

## 1. Feature catalog (user-facing)

### 1.1 Discovery & search ✅
- Interactive **Google Maps + Leaflet** view with mosque markers (staggered drop animations); GPS-recenter button.
- **Find Nearby**: browser geolocation → `GET /api/mosques/nearby?lat&lng&radius` — PostGIS `find_nearby_mosques(lat, lng, radius_km)`, Redis-cached 5 min.
- **Typeahead search**: instant suggestions, fuzzy matching, categorised results (nearby / favorites / recent), search history.
- **Amenities filter**: 12 amenity types, multi-select chips, live results counter.
- **Sort by distance** (PostGIS `<->` KNN operator); list view + map view.
- **Pan-to-load** on map: `moveend`+`zoomend` debounced 3 s; diagonal radius clamped 5–50 km; **server caps results at 20** (🔧 confirmed; older commit raised this to 50 but canonical-doc 20 is the authoritative value); cache skip when pan < 1 km from last fetch.
- **Pre-locate Browse** list capped at 10 mosques (was 50); after locate, replaced with 25 km radius (100 km fallback).
- **Collapsible map** on mobile (auto-shrinks on scroll to give detail panel more room).
- **Bottom-sheet detail UI** on mobile: collapsed / peek / expanded / full states with swipe gestures + draggable handle.
- 🆕 **Add a masjid** (map "+"): details form + draggable pin / "Use map center"; **city / country / address auto-fill from the pin via reverse geocoding** (direct Nominatim first, backend `/api/geocode/reverse` fallback; user-typed values never overwritten); numeric human-check; on create the app opens the new masjid's drawer with the submit-times form ready.

### 1.2 Prayer timings display ✅
- Per-mosque table: **Fajr, Zuhr, Asr, Maghrib, Isha, Jummah** (+ Jummah 2 & Jummah 3 when present).
- **Live countdown** to next prayer with pulse indicator; auto-advances Asr → Maghrib → Isha → next-day Fajr.
- Home default-masjid card shows all daily takbeer times inline with four columns: prayer, keeper-published **Jamat**, sun-position **Starts**, and sun-position **Ends** for the masjid's coordinates and selected fiqh.
- 🆕 **Date-aware Jummah handling**: on **Fridays**, the next-prayer cycle becomes `Fajr → Jummah → Asr → Maghrib → Isha` (Jummah replaces Dhuhr). On non-Fridays Jummah is **not** treated as a daily prayer — it never reports as "next prayer" before the upcoming Friday.
- 🆕 **7-day look-ahead** in `computeNextPrayer`: a masjid that has only a Jummah time submitted (no daily times) still shows a meaningful countdown pointing at the upcoming Friday's Jummah. Candidates carry an absolute `Date` target (not minutes-since-midnight), so multi-day boundaries and DST transitions are correct by construction.
- 🆕 **No fake Maghrib on Jummah-only masjids**: Maghrib is auto-computed from astronomical sunset **only when** the masjid has at least one daily timing set, OR has no Jummah set. A Jummah-only submission no longer generates a Maghrib row from coordinates alone. `maghribOffset` must be a finite number to fire the computation — no implicit zero default.
- 🆕 **Default-mosque is sticky**: when the user has a `defaultMosqueId` set but the masjid can't be loaded for any reason, the app does **not** silently substitute another favorite/nearby masjid — empty state is shown until the default resolves. (Substitution still applies for guests who have no default.)
- **Adhan + Iqamah** displayed in separate columns where available.
- **Timezone-aware**: mosque timezone stored, rendered in user's local time, DST + offset indicators.
- **Maghrib is computed client-side** from astronomical sunset + per-mosque **takbeer offset** (0–60 min). Submissions accept `maghribOffset`; the field `maghrib` HH:MM is removed.
- `timingsFromMosque` precedence (unified across hero/drawer): `effectiveTimings > defaultJamaatTimings > master schedule`.
- `/nearby` returns effective keeper timings so map popups already carry rendered times.
- **Fiqh selection** for sun-based prayers: Hanafi / Shafi / Maliki / Hanbali / Jafari / ISNA / Egypt / Umm al-Qura.
- **Bidi-isolated time strings** in RTL locales (`direction: ltr; unicode-bidi: isolate`) so "5:24 am" doesn't render as "am 5:24".

### 1.3 Multiple Jummah support ✅
- Up to **3 Jummah slots** (`jummah`, `jummah_2`, `jummah_3`), each with adhan + iqamah.
- Conditional rendering of extra Jummah rows.
- Amenities list shows "2️⃣ Jummah 2" / "3️⃣ Jummah 3" badges.
- Submission form has optional inputs for Jummah 2 and Jummah 3.

### 1.4 Time-keeper system & consensus ✅
- Every submission is attributed to a **time-keeper** (a user) per masjid.
- **Per-mosque keeper ranking** combines recent `TimingSubmission`s (60-day lookback, excludes `rejected`+`withdrawn`) with up to 100 contributor `PrayerSchedule`s — central helper `rankedKeepersForMosque()`.
- **Tiered edit permissions** (`mosqueEditPermission()`):
  - owner = full edit;
  - unnamed/placeholder mosque (e.g. `"Mosque (OSM way 123)"` or `"Unnamed Masjid"`) → anyone signed-in may name it (and claims ownership on rename);
  - top-rated keeper → name-only edit on community-named mosques.
- **Closed-masjid lifecycle**: top keeper can mark a masjid `closed`/`active`; closing **withdraws the closer's keeper sources** and activates the next keeper. Closed masjids stay visible (greyed card, closed map pin) but 🔧 **new timing submissions and timing votes are disabled** — the only action available on a closed masjid is "Request reactivation" (a separate flow). Existing data is read-only.
- **Withdraw-as-keeper**: contributor removes themselves; `withdrawKeeperSources()` marks their submissions `withdrawn`, soft-deletes schedules, prunes followers' `preferredKeepers`, logs to `ActivityLog`.
- **Follow a keeper**: tappable assist chip on hero "Times by [keeper] · top-rated keeper ›"; sign-out unsubscribes from all FCM topics (prevents previous-user pushes on shared device).

### 1.5 Crowd-sourced submissions & verification ✅
- Authenticated users submit new timings (optional notes + "I verified" checkbox); submitter earns **+10 reputation**.
- **Updates** tab on mosque detail shows community submissions sorted pending → active → outdated.
- "Copy to my submission" / "Use these timings" pre-fills the update form.
- **Report** action on suspect submissions.
- **Top-5 contributors per masjid** are notified on every new submission; can Approve / Reject / Copy / Skip.
- **Confidence-score deltas**: +10 approval / −5 rejection / +2 upvote / −3 downvote.
- 🔧 **Initial confidence on a fresh submission = 50** (so three uncontested approvals → 80, exactly the auto-approval threshold).
- **Auto-approval**: ≥3 approvals from top contributors AND confidence **≥ 80** AND submitter trust > 70 → submission becomes mosque default. (🔧 `>= 80` not `> 80`, to make the documented +10×3 path actually fire.)
- 🔧 **Young-masjid fallback** (fewer than 3 top contributors exist for the masjid): submission promotes to `community` status (not `verified`) after **7 days uncontested** AND submitter trust ≥ 70 AND at least 1 approval. Admin can manually promote to `verified`. This unblocks new masjids that can't possibly reach the 3-of-5 quorum.
- **Promotion is server-authoritative.** 🔧 The frontend displays whatever `verificationStatus` the server returns; the previous client-side `verifiedBy >= 3` optimistic promotion is removed (it diverged from the real criteria above).
- **Suggestion-accept (hardened)**: one transaction creates audit submission + merges suggested keys over current schedule + deactivates prior + installs merged as `verificationStatus='verified'` — **partial suggestions preserve non-overlapping prayers**. Authority gate: only the original adder OR a prior non-rejected submitter lands as `verified`; otherwise installs as `community`.
- **Current-keeper direct updates**: when the current active time keeper submits their own timing update, the server merges the submitted keys into the active `PrayerSchedule` immediately and preserves non-overlapping prayers. This keeps the canonical schedule in step with the keeper record so non-followers, list/detail payloads, and reminder users converge on the same time.
- **Disputes**: when two top contributors conflict → `timing_disputes` row → community vote (weighted by trust) → admin escalation after 7 days unresolved.
- Verifier earns **+15 reputation** per approval.

### 1.6 Reputation, trust & badges ✅
- Trust score formula: `50 + approved*5 − rejected*10 + verifications_given*2`, clamped 0–100.
- **Top-5 list** per masjid (`is_top_contributor` flag).
- **Badges**: Bronze (5 approved), Silver (15), Gold (30), Top Contributor (top 5 in a masjid), Trusted Source (≥80 trust), Community Champion (top in 3+ masjids), Early Adopter, Verified Helper.
- Profile view shows totals: favorites, submissions, reputation, badges.

### 1.7 Reminders (local + push) ✅
**Local (per-device):**
- Per-prayer enable/disable (Fajr, Zuhr, Asr, Maghrib, Isha, Jummah). 🔧 **Offset is a free-form integer in minutes that the user types in**, range **1–120 min**, 1-minute increments. **Default = 10 min** when no offset has been set. No preset buttons; typed input only. UI and backend Zod share the same `1–120` range — no gap.
- Channels: Push (FCM) ✅ **— primary, guaranteed**; Email (SendGrid/SES) 📋; SMS (Twilio) 📋 **— best-effort, capped (see §5.10); FCM is the only guaranteed channel.**
- Day filter (`active_days[0..6]`), pause-until date, multi-mosque reminders.
- **Inline SVG clock indicator** next to each prayer in the timings table — click to inline-edit minutes.
- Cross-device sync via `PUT /me/reminder-prefs`.
- Cron worker (every minute): batches 1000/users, dedup via `sent_reminders` table, retries 3× on failure, **rate-limited 10 SMS/hour/user**.
- **Quiet hours / multi-device dedup / push rate limiting** — explicitly **deferred to V1+**.
- Dedicated `prayer-reminders-v2` Android channel (IMPORTANCE_HIGH, sound + heads-up). Bundled `prayer_chime.wav` (0.76 s sine-ADSR chime generated at build time via `gen-chime-wav.js`) survives the user setting system notification sound to "None".
- Repeat-tap Test ring fixed: fresh notification id per call (epoch-seconds % 2e9) avoids `ONLY_ALERT_ONCE`.
- Per-prayer toggle/input gated on notification permission (was only master toggle).
- **Icon-only bell** with golden ring + count badge; first tap auto-arms all 5 obligatory prayers at 10 min before (Jummah deliberately off).
- `Material 3` Switch design (52×32 track, 16→24 dp thumb on activation, RTL mirror).

**Push (FCM):**
- Topic format: `keeper-<keeperUserId>-mosque-<mosqueId>` — per-mosque-per-keeper isolation so a follower of keeper X at masjid A doesn't get pushes for masjid B.
- Client: `@capacitor/push-notifications` + `@capacitor-community/fcm`; channel created eagerly; `POST_NOTIFICATIONS` prompt bundled into first follow.
- Server `notifyKeeperUpdate(args)` — kill-switched by `FCM_ENABLED!=='true'` (logging no-op for dev/staging). **Fire-and-forget AFTER `res.json`** — FCM failures never block / 500 submit.
- `NotifyResult` shape: `{ topic, sent, messageId? | reason }` with stable reason strings (`disabled` / `admin-not-initialized` / `send-failed`).
- Suggestion notifications: topic `suggest-to-<userId>` (single-recipient), `data.type='new_suggestion'`.
- **Foreground tray banner** via LocalNotification mirroring (Capacitor delivers FG messages to JS only; `stableId(key)` so re-sends replace rather than stack).
- Drops `USE_EXACT_ALARM` (Play policy May 2024); `SCHEDULE_EXACT_ALARM` sufficient.
- Drops bogus iOS `NSUserNotificationsUsageDescription` key.

### 1.8 Favorites & default mosque ✅
- Star a mosque → 🔧 **anonymous-first**: stored in `localStorage` for guests; on sign-in, local favorites sync to `user_favorites` server-side (and the server set merges back). Same local-first pattern as default-mosque.
- "Set as Default Mosque" button on mosque detail.
- App-launch: auto-loads default-mosque timings + countdown, centers map on it.
- On set: also adds to favorites + creates prayer-reminder prefs row + records `default_mosque_set_at` for analytics (analytics row created on first sign-in if the default was set anonymously).
- **Local-first**: anonymous users can set a default via `localStorage` (`jamat.localDefaultMosqueId`); `effectiveDefaultMosqueId()` returns server choice when signed-in, else device choice. 🔧 `requireSignIn(actionLabel)` now gates only **submit / suggest / follow / add-masjid** — favorites and default-mosque work anonymously.
- 🆕 **Set-default completes the journey**: picking a default (from a directory/map card pill or the drawer button) auto-navigates back to the home screen (`goHome()` closes map + drawer, collapses the overlay hash) so the hero immediately shows the chosen masjid — no manual backing out.

### 1.9 Sharing & navigation ✅
- **Share App** button in topbar (Web Share API → WhatsApp `wa.me` fallback).
- **Navigate to Masjid** action: per-card + drawer + map-popup. Web → Google Maps directions URL; Android → `intent://` (Capacitor `App.openUrl`).
- Home default-masjid card keeps the directions action inline beside the masjid name as a compact **Go** button when coordinates are available.
- 🆕 Tapping the **brand/logo** in the topbar opens a "No ads. Ever. / sadqa fe sabilillah" pledge modal (the same footer pledge + open-API note), closable via ×, scrim, Esc, or Android back.

### 1.10 Qaza (missed-prayer) tracker ✅ (v3.3, late May 2026)
- Drawer to record missed Fajr/Dhuhr/Asr/Maghrib/Isha by date.
- Pending qaza list with one-tap "Mark prayed".
- Top "Qaza Namaz Tracker" pill with clock icon, pending count, and in-app pending reminder.
- Local-first (`localStorage`); also server-backed via `server/src/routes/qaza.ts` + migration `20260526_add_qaza_records`.
- Records are keyed per owner (`anonymous` while signed out, email once signed in). **Signing in migrates the guest (`anonymous`) records into the account** — they are folded into the signed-in owner's local store (deduped by `clientId` and by open `date+prayer`) and pushed to the server, so missed prayers recorded as a guest never disappear after sign-in.

### 1.11 Multilingual & RTL ✅
- **10 languages**: en (baseline), ar, ur, id, bn, hi, tr, fa, ms, fr.
- Lazy-loaded JSON locale bundles in `i18n/`.
- Custom topbar language menu shows native-script labels plus English labels and supports mouse/keyboard selection.
- RTL CSS for Arabic-script locales; brand name hidden on phone-width RTL (translated "Sign in" wider than English was clipping "Takbeer Time").
- **Toast strings i18n'd** (originally 5 hard-coded English toasts were leaking to Urdu users).
- Frontend-only "Mosque → Masjid" copy pass across all 10 locales (backend routes/model still `Mosque`).

### 1.12 Onboarding ✅
- 4-step wizard: Welcome → Location permission → Select home mosque → Configure reminders.
- Completion flag in `localStorage`.

### 1.13 Account & auth ✅
- **Google Sign-In via Firebase** — web (Firebase JS popup) + native (`@capacitor-firebase/authentication` plugin on Android).
- **Email + password** sign-in modal (`/auth/login` → fallback `/auth/register` on 401).
- "Browse as Guest" — submissions/verifications require sign-in.
- 🆕 **Sign-in gate resumes the interrupted action**: when an action hits `requireSignIn` (submit times, add masjid, suggest, follow, favorite, edit, nudge, close/reactivate, withdraw), the login modal opens *over* the current screen (form state survives) and after any successful sign-in path (email+password, dev email, Google) the original action re-runs via `view.pendingAuthAction` — the user lands back exactly where they started, with their typed values submitted. Cancelling the modal clears the pending action.
- **Account-deletion request flow** (`delete-account.html` → public `POST /api/account-deletion-request`, per-email rate-limit **1/hour**, **generic 202** so endpoint can't enumerate emails). Authenticated `DELETE /api/users/me` soft-deletes + prunes favorites/sent-suggestions/default-FK/prefs JSON — **submitted timings and received suggestions are deliberately retained** ("the community is relying on them").
- 🔧 **Display-name anonymisation on delete**: retained submissions/schedules keep their attribution row, but the deleted user's public `fullName` is replaced with `Former contributor #<short-hash>` and the email/firebaseUid are nulled. Keeper attribution stays visible to the community without exposing residual PII. Users are warned about retention + anonymisation at delete time.

### 1.14 Admin dashboard ✅
- `admin.html` (591 lines, repo root) — gated server-side by `ADMIN_EMAIL`. 🔧 **`ADMIN_EMAIL` is required** — the previous hardcoded source default is removed. If the env var is unset, every `/api/admin/*` route returns 404 and no admin UI works. Operators must set it in `api.env`.
- `GET /api/admin/overview?date=YYYY-MM-DD&tzOffsetMinutes=` — active users, new signups + acquisition source, Google sign-ins, last-known geo location, masjids with times added, timing submissions.
- Returns **404 to non-admins** (not 403) to mask endpoint existence.
- Test-push endpoint `POST /api/admin/test-push` — triple-gated by `ADMIN_TEST_PUSH_ENABLED=true` + `ADMIN_TEST_PUSH_USER_ID=<specific User.id>` + auth (default 404).
- Activity logging via `server/src/lib/activity.ts` (fire-and-forget writes to `activity_logs` for auth events, `authenticated_request` hourly-throttled, `nearby_search` with rounded geo).
- **Timekeeper revoke controls** in the admin panel.

### 1.15 In-app notifications inbox ✅
- Profile → Notifications inbox with unread badge.
- Types: `verification_request`, timing-updated, new-suggestion.
- Clicking marks-read, deep-links to mosque, switches to Updates tab.
- Diff display: changed prayers strike-through old + green new, unchanged prayers neutral.
- Inbox bell goes stale across BG/FG — `takbeer:resumed` event re-polls `refreshInbox()`.

### 1.16 Seasonal modes 🚧
- **Ramadan Mode**: auto-activated, purple+gold theme, Taraweeh section, Suhoor/Iftar countdown, banner.
- **Eid Mode**: Eid banner, special Eid prayer slots, multiple-timing support, outdoor-prayer highlights.

### 1.17 Offline & local-first persistence ✅
- `localStorage` holds: favorites, default mosque, cached prayer schedules (24 h TTL), onboarding flag, reminder prefs, qaza records.
- Android also has a **6-hour refresh throttle** in `MosqueRepository`, merging fresh response over cached fields so partial backend data can't wipe known-good schedules.
- PWA offline browsing implied by architecture diagram.

### 1.18 SEO / discovery (web only) ✅
- Public **API docs at `/api-docs.html`** — every endpoint card shows method badge, auth requirement, rate-limit cap, params, curl example. Maghrib-as-offset convention prominently documented.
- SEO metadata + structured data.
- **Multilingual Jummah discovery blog** (`blog/find-jumma-near-me.html`).
- Google site verification file; **IndexNow** integration.
- Hero "nearby masjid" CTA on the website.
- App download section with 6 screenshots.

---

## 2. Backend / data

### 2.1 Data model (Prisma → PostgreSQL + PostGIS)

| Entity | Purpose / load-bearing fields |
|---|---|
| **User** | Firebase-linked + email/pw account; `firebase_uid`, `password_hash` (bcrypt cost 12, nullable), `email_verified_at`, `default_mosque_id`, `default_mosque_set_at`, `reputation_points`, `verified_contributor`, `preferred_language`, `notification_preferences` JSONB, `created_at`/`updated_at`/`last_login_at`/`deleted_at`. |
| **Mosque** | Core directory: `name`, `address`, city/country, `latitude`/`longitude` (Float, display only), `location` (`geography(Point,4326)`, **drives all proximity queries**), `timezone`, `amenities`, `photos`, `status` (`active`/`closed`), `osm_id`. GIST index on `location` (`idx_mosques_location`). |
| **PrayerSchedule** | Per-mosque current/historical timings; `timings` JSONB (`{fajr,dhuhr,asr,maghribOffset,isha,jummah,jummah_2?,jummah_3?}`); `verificationStatus` (`pending`/`community`/`verified`), `isActive`, ownership FK. |
| **TimingSubmission** | User-submitted timings; `verification_count`, `verified_by_contributors UUID[]`, `confidence_score`, status (`pending`/`active`/`outdated`/`rejected`/`withdrawn`). |
| **VerificationRequest** | Pending review item for a top contributor; status pending/approved/rejected/skipped; can carry `copied_to_own_submission` flag and verification notes. |
| **UserMosqueContribution** | Per (user, mosque): `total_submissions`, `approved_submissions`, `rejected_submissions`, `trust_score`, `is_top_contributor`, `notify_on_updates`. |
| **PrayerReminder** | Per (user, mosque): `enabled_prayers` JSONB, `reminder_offsets` JSONB, `notification_channels` JSONB, `is_active`, `pause_until`, `active_days INTEGER[]`. |
| **SentReminder** | Dedupe log of fired notifications per (user, prayer, date). |
| **UserFavorite** | (user, mosque) + notes + tags; auto-favorite on default-set. |
| **MosqueReview** | Rating (1–5), optional sub-ratings (timing accuracy / cleanliness / accessibility), helpful-count. |
| **Vote** | Up/down votes feeding confidence score. |
| **TimingDispute** | `submission_a_id`, `submission_b_id`, `disputed_prayers TEXT[]`, status active/resolved/admin_review. |
| **ActivityLog** | `activity_type`, optional `entity_type`/`entity_id`, `metadata` JSONB, `ip_address` (Inet), `user_agent`. |
| **Notification** | In-app inbox rows for `verification_request`, timing updates, suggestion notifications. |
| **AccountDeletionRequest** | Public-form requests; rate-limited 1/hour/email. |
| **QazaRecord** | Per-user missed-prayer log (server-side mirror of local data). |

### 2.2 API endpoints (selection)

**Mosques** — `GET /api/mosques/nearby?lat&lng&radius` (PostGIS, **max 20**, Redis-cached 5 min); `GET /api/mosques/:id`; `GET /api/mosques/:id/contributors`; `GET /api/mosques/:id/keepers`; **`POST /api/mosques/:id/status`** (top keeper closes/reactivates); **`POST /api/mosques/:id/keepers/me/withdraw`** (withdraw as keeper).

**Submissions** — `POST /api/submissions` / `POST /api/mosques/:id/submissions`; `POST /api/submissions/:id/verify` (top-contributor only); `recomputeAndPromote` excludes `withdrawn`+`rejected`.

**Verification** — `GET /api/users/me/verification-requests`; `POST /api/verification-requests/:id/respond` body `{ action, notes?, copy_to_my_submission? }`.

**Users / preferences** — `GET|POST /api/users/me/default-mosque`; `GET|POST /api/users/me/reminders`; `PATCH /api/users/me/reminders/:id/pause`; `POST /api/users/me/reminder-preferences`; `GET /api/users/me/notifications`; `PUT /api/users/me/preferred-keeper`; **`DELETE /api/users/me`** (soft delete + selective prune).

**Auth** — `POST /api/auth/register` (constant-time vs account-enumeration); `POST /api/auth/login` (constant-time, dummy bcrypt compare on miss); `POST /api/auth/google` (Firebase ID token → app JWT). 401 client-side clears stored JWT + emits `jamat:auth-expired`.

**Admin** — `GET /api/admin/overview`; `POST /api/admin/test-push` (triple-gated, default 404).

**Account deletion (public)** — `POST /api/account-deletion-request` (1/hour/email, generic 202).

**Qaza** — `qaza.ts` route (CRUD per user).

**Response/pagination contract (hard rule)**:
```ts
{ data, pagination: { page, limit, totalCount, totalPages, hasMore } }
// page = max(1, parseInt||1); limit = min(100, max(1, parseInt||20))
```

### 2.3 Scraper system (Jummah / data import) ✅
- **`server/scripts/import-jummah.ts`** + `server/scripts/lib/jummah-import-core.ts` + 8 source modules in `server/scripts/lib/sources/`.
- **10+ sources**: Mawaqit, Jamaat360, FivePrayers, MosqueHQ, Masjidi API (keyed), individual masjid websites, and 7 national authorities — JAKIM (Malaysia), MUIS (Singapore), Vaktija (Bosnia), IACAD (Dubai), Habous (Morocco), Diyanet (Turkey), Kemenag (Indonesia).
- Scraped data enters as **pending `TimingSubmission` rows under per-source time-keeper accounts** (e.g. `MayAllahRewardMawaqit.net`) — goes through the same consensus pipeline as humans; **never overwrites human-verified schedules**.
- Gated by `JUMMAH_SCRAPER_ENABLED=true`; `--apply` requires it. 🔧 The previous `--force` CLI override is removed — a kill switch that any CLI invocation can bypass isn't a kill switch. To run against a dev DB, set the env var locally.
- **Weekend cron on `.93`** (installed 2026-05-25): Sat 03:30 UTC = 11 non-keyed sources, Sun 03:30 UTC = Mawaqit refresh. Log `/home/junaid/takbeer-time-scraper.log`. (See `MEMORY/weekend-scraper-cron.md` for the operational details.)
- `--refresh` mode only touches mosques already owned by these source's keeper accounts.

### 2.4 Background jobs / cron 🚧
- **Reminder cron worker** (every minute) — see §1.7.
- **Weekend Jummah scraper cron** — see §2.3.
- Data-sync worker (ES indexing, materialised views, analytics) — 📋.

---

## 3. Mobile (Capacitor / Android)

- Capacitor shell around the canonical vanilla-JS web app (`mobile/scripts/build-web.sh` snapshots root web sources into `mobile/www/`).
- **Android package id**: `com.takbeertime.android` (renamed from `com.takbeertime.app` because the original was locked under a developer-only signing key by Android Developer Verification).
- **compile/target SDK 36** (bumped from 35 for Android 15 edge-to-edge).
- Release signing via gitignored `mobile/android/keystore.properties`. Keystore is **RSA 2048 / SHA384, valid until 2053-09-12** — losing it = no path to update the Play listing. 🔧 Keystore file location lives in the private operator runbook, not this doc.
- Firebase has **3 SHA-1s** registered: debug, upload, Play App Signing (the last was a recurring gotcha — Google Sign-In code 10 DEVELOPER_ERROR for Play Store users while debug worked).
- **Hardware-back** routing: drawer → modal → history → minimize via `moveTaskToBack` (Compose Nav 2.7 doesn't forward back at start destination).
- `CapacitorHttp` enabled (without it, calls from `https://localhost` to `https://takbeertime.com/api/*` fail CORS).
- `build-web.sh` patches `i18n/` copy (silent fall-back to English on every non-EN locale otherwise).
- Explicit `Geolocation.requestPermissions` for fine-location (Android was falling back to cell-tower otherwise).
- Launcher icon: refined clock-face mosque logo; `drawable-v24/` robot override deleted (it was winning on API 24+).
- Version cadence: v2.0 → v3.2 → v3.3 (Qaza) → v4.0. `auto-release-to-play.yml` derives `versionCode` as `github.run_number + 100`.
- **The old root `android/` Kotlin app was deprecated and removed** (`31c6268`). Only `mobile/android` is the live target.

---

## 4. Technical stack

| Layer | Tech | Notes |
|---|---|---|
| **Web** | Vanilla JS, no build step | `index.html` is canonical (loads `js/{config,auth,state,api,components,app}.js`). `index-enhanced.html` is a self-contained glassmorphism prototype, not kept in lockstep. |
| **Map** | Google Maps JS + Places API; Leaflet for map list | API key pasted directly into both HTMLs. |
| **Backend** | Node 20 + Express 4 + TypeScript 5 | Entry `server/src/index.ts`, port 3001. |
| **ORM** | Prisma 5.8 | `Mosque.location` declared `Unsupported(...)` — spatial queries via `prisma.$queryRaw`. |
| **DB** | **PostgreSQL + PostGIS 3.4** (only) | Required extensions: `postgis`, `pg_trgm`, `uuid-ossp`. **No SQLite, ever.** |
| **Auth** | Firebase Admin SDK verifies ID tokens; app issues HS256 JWT (30 d) | `JWT_SECRET` ≥ 32 chars or boot fails. |
| **Validation** | Zod on every body/query | 400 with issue list on failure. |
| **Tests** | Jest + Supertest (backend), Puppeteer/Jest (frontend e2e), `npm run test:unit` (mobile/web units) | Backend tests run against a real Postgres+PostGIS — never mock Prisma. |
| **Mobile** | Capacitor on Android (`mobile/android`) | iOS Podfile present; not actively built. |
| **Push** | Firebase Cloud Messaging (FCM) | `@capacitor/push-notifications` + `@capacitor-community/fcm`. |
| **Logging** | `server/src/lib/activity.ts` writes to `activity_logs`; console for runtime; Sentry optional via `SENTRY_DSN` | |
| **Cache** | Redis (sessions, hot mosques, nearby results, schedules, rate-limit counters) | L1 hot mosques 1 h / 50 MB; L2 nearby `nearby:{lat}:{lng}:{radius}` 5 min / 200 MB; L3 schedules `schedule:{mosque_id}:{date}` until midnight / 100 MB. |
| **Deploy (web)** | Cloudflare front → nginx (`192.168.18.5`) → Docker on `192.168.18.93` | Static web + `/api/*` proxied to Express :3001. |
| **Deploy (DB)** | PostgreSQL + PostGIS in `takbeer-time-db-1` container (internal only) | Compose at `~/takbeer-time-prod/app/deploy/production/docker-compose.yml`. |
| **Deploy (Android)** | GitHub Actions → Play Console internal track | 3 workflows: `bootstrap-keystore.yml`, `build-android-aab.yml`, `auto-release-to-play.yml`. |

---

## 5. Cross-cutting requirements & hard rules

### 5.1 Architectural hard rules (from `CLAUDE.md` / `AGENTS.md`)
- **PostGIS only — no SQLite.** Don't change Prisma `provider`.
- **Geospatial queries MUST use PostGIS** (`ST_DWithin`, `ST_Distance`, `<->`). **Haversine in Node is forbidden** (bypasses GIST index).
- Spatial queries go through `prisma.$queryRaw` because `location` is `Unsupported(...)`.
- **No `fetch()` outside `js/api.js`.** Token auto-injected from `js/auth.js`.
- Global state lives only in `js/state.js`.
- Backend URL + feature flags only in `js/config.js`.
- Field-shape translation (backend `latitude/longitude` + `prayerSchedules[0].timings.dhuhr` ↔ frontend `coordinates.{lat,lng}` + `defaultJamaatTimings.zuhr`) lives only in `js/api.js` adapters.
- Migrations through `npm run prisma:migrate`; **never edit a committed migration** — create a new one.
- **No new build step in the web frontend** (no webpack/vite/etc. for `index.html` + `js/` + `css/`) without an explicit decision — "open and run" simplicity is a feature. 🔧 Rule scope clarified: this applies to the web layer only. The backend (`tsc`), the Capacitor mobile shell (`npm run build && npx cap sync`), the production Docker image (multi-stage build), and CI workflows all legitimately have build steps.
- **Multiple HTML entry points, one canonical app.** 🔧 The canonical interactive app is `index.html`. The other top-level HTML files are special-purpose, single-page surfaces and are NOT alternative UIs of the canonical app:
  - `admin.html` — admin dashboard (sign-in + `/api/admin/overview`)
  - `api-docs.html` — public API documentation
  - `delete-account.html` — Play-Store-required account-deletion request
  - `privacy.html`, `terms.html` — legal pages
  - `blog/find-jumma-near-me.html` — SEO blog post (plus per-locale variants)
  - `index-enhanced.html` — **deprecated design prototype.** Not maintained, not served in prod nginx (404'd). Slated for removal; do not add features to it.
- **Don't recreate root `android/`.** Only `mobile/android` (Capacitor, `com.takbeertime.android`).
- Never `killall node` / `pkill node` — would kill the agent's own session.

### 5.2 Auth & security
- Firebase ID token OR app JWT via `Authorization: Bearer`.
- Protected routes verify token; mutating routes check ownership `firebaseUid → User.id`.
- **Bcrypt cost 12** for password hashes.
- **Constant-time login** — dummy bcrypt compare on user miss to prevent account enumeration.
- **JWT_SECRET ≥ 32 chars** or server boot throws.
- JWT default TTL 30 d (`JWT_EXPIRES_IN`).
- **`DEV_AUTH_USER_EMAIL` in prod → refuses boot, exits 1**.
- **Soft-deleted users rejected by every auth path** (app JWT, Firebase, dev-bypass, `X-Test-User-Id`).
- **Public user response** uses explicit `publicUserSelect` — never returns `passwordHash`/raw `firebaseUid`/`deletedAt`; exposes derived `hasGoogleAuth` bool.
- 401 on token → client clears stored JWT + emits `jamat:auth-expired` event.
- **IPv6 rate-limit keys** use `/64` bucket (`ipKeyGenerator`).
- 🔧 **CORS split** to support the published open API without losing write-side abuse protection:
  - **Read endpoints** (`GET /api/mosques/*`, `GET /api/health`, `GET /api-docs.html`) — `Access-Control-Allow-Origin: *`, no credentials. Third-party browser clients can call them. Rate-limited per-IP.
  - **Write endpoints** (every `POST`/`PATCH`/`PUT`/`DELETE`) — origin must be in `ALLOWED_ORIGINS`. Credentials allowed.
- SQL injection prevented via parameterised queries.
- Admin gate: 🔧 **`ADMIN_EMAIL` env is required** — no source-level default. `assertAdmin()` returns **404** to non-admins (and when the env var is unset, returns 404 to everyone).
- Admin test-push triple-gated (env + user id + auth), 404 default.
- Account-deletion request: 1/hour/email, generic 202 (no enumeration oracle).

### 5.3 Validation
- Zod schemas colocated with each route; export named const.
- 🔧 Reminder offset: **1–120 min, 1-minute increments**, same range on UI and backend Zod. UI is a typed integer input (no preset buttons). Default value = **10 min** when no offset has been set.

### 5.4 Geospatial correctness
- Nearby: `ST_DWithin(location, ST_MakePoint($lng,$lat)::geography, $radiusMeters)`.
- Sort by distance: `ORDER BY location <-> ST_MakePoint($lng,$lat)::geography`.
- GIST index gives ~15 ms vs ~45 s full scan on 1 M mosques.

### 5.5 i18n / RTL
- 10 locales (`en, ar, ur, id, bn, hi, tr, fa, ms, fr`); EN baseline + per-locale layer.
- RTL CSS for Arabic-script locales; `direction: ltr; unicode-bidi: isolate` on time strings.
- Map tooltip width `calc(100vw - 32px)` so Arabic names don't clip.

### 5.6 Accessibility
- **Tap-target floor 44 px** on native (Android 15+ edge-to-edge).
- Material 3 component pass (buttons, FABs, chips, switches, text fields).

### 5.7 Performance & caching
- Response targets: nearby cold ≤ 50–100 ms; hot (cached) 5–10 ms; sub-100 ms p50 overall.
- Redis cache tiers as above (§4).
- Frontend client-side cache: schedules in `localStorage` 24 h TTL.
- Android `MosqueRepository` 6-hour refresh throttle merging over cache.

### 5.8 Observability
- Prometheus metrics: `mosque_searches_total`, `timing_submissions_total`, `notification_sends_total`, `api_request_duration_seconds`.
- Postgres: `pg_stat_statements` (>100 ms slow-query alert), index-usage/table-size monitoring.
- Alerts: error_rate > 1% → PagerDuty; p95 > 500 ms → Slack; active_connections > 80 → auto-scale read replicas; FCM failure_rate > 5% → email dev team.
- `ActivityLog` rows carry IP (Inet) + UA + metadata — **no explicit retention policy yet**.

### 5.9 Privacy & retention
- Account deletion soft-deletes; submitted timings + received suggestions deliberately retained.
- No PII in FCM `data` (flat strings only).
- `loadProfile`/`loadFavorites`/`refreshInbox` skip server call when `getEmail()` is null.
- Sign-out unsubscribes from all FCM topics (prevents previous-user pushes on shared device).

### 5.10 Rate limits & numeric thresholds (reference)

| Limit | Value | Source |
|---|---|---|
| Submissions / hour / user | 30 | `RATE_LIMIT_SUBMISSIONS_PER_HOUR` |
| Votes / hour / user | 60 | `RATE_LIMIT_VOTES_PER_HOUR` |
| Suggestions / hour / user | 10 | `RATE_LIMIT_SUGGESTIONS_PER_HOUR` |
| New mosques / hour / user | 5 | `RATE_LIMIT_MOSQUES_PER_HOUR` |
| Account-deletion request / hour / email | 1 | hardcoded |
| SMS reminders / hour / user | 10 (🔧 best-effort; FCM is the guaranteed channel) | cron worker cap |
| Map nearby cap | **20 results** | server-side |
| Map radius clamp | 5–50 km | client + server |
| Pre-locate Browse cap | 10 mosques | client |
| Pan-to-load debounce | 3 s | client |
| Pan-to-load skip threshold | < 1 km from last fetch | client |
| Reminder offset (UI + backend Zod) | 1–120 min, 1-minute increments | client + server |
| Reminder offset default | 10 min | client |
| Auto-approval — top contributors required | ≥ 3 (or young-masjid 7-day fallback) | server |
| Auto-approval — confidence threshold | ≥ 80 (initial 50; +10 per approval) | server |
| Auto-approval — submitter trust threshold | > 70 | server |
| Young-masjid uncontested window | 7 days | server |
| Android refresh throttle | 6 h | `MosqueRepository` |
| Bcrypt cost | 12 | server |
| JWT secret min length | 32 chars | server boot guard |
| JWT default TTL | 30 d | `JWT_EXPIRES_IN` |
| Compile/target Android SDK | 36 | `mobile/android/app/build.gradle` |
| OSM corpus | 281,696 mosques / 168 countries | `6a6bba7` |
| Languages | 10 | en/ar/ur/id/bn/hi/tr/fa/ms/fr |
| Brand cert SHA-256 | `87:7B:19:35:F6:81:3D:2E:D0:7B:43:B8:E6:15:8A:D2:26:B8:B0:01:98:61:A3:60:1E:EA:92:9F:36:5D:80:E9` | `3a2b599` |

---

## 6. Operational / deployment

### 6.1 Production topology (live)

```
takbeertime.com
  ─► Cloudflare (CDN, TLS, masks origin)
  ─► nginx host  192.168.18.5  (Let's Encrypt, see ../nginxx repo)
  ─► Docker stack on 192.168.18.93
       ├─ takbeer-time-web-1   (static + Nginx, host port 80)
       ├─ takbeer-time-api-1   (Express, internal :3001)
       └─ takbeer-time-db-1    (postgis/postgis:18-3.6, internal only)
     Compose: ~/takbeer-time-prod/app/deploy/production/docker-compose.yml
     Env file (mode 0600): api.env  (DB creds, scraper vars, ADMIN_EMAIL, FCM, ...)
     Deploys are copy-based snapshots — ~/takbeer-time-prod/app.previous-<timestamp>/
```

### 6.2 Build / dev

```bash
# Frontend — no build
python -m http.server 8000   # then open / or /index-enhanced.html

# Backend
cd server && npm install && npm run prisma:generate && npm run prisma:migrate && npm run dev

# Android / Capacitor
cd mobile && npm install && npm run build && npx cap sync android && cd android && ./gradlew assembleDebug
```

### 6.3 CI

`.github/workflows/`:
- `bootstrap-keystore.yml` — one-shot upload-key gen.
- `build-android-aab.yml` — manual first-submission AAB.
- `auto-release-to-play.yml` — push to `live` → AAB build → internal Play track via `r0adkll/upload-google-play`.
- `ci.yml` — web unit tests, backend typecheck + Jest against a real PostGIS container, non-mutating browser smoke e2e, and Android debug build.

### 6.4 Weekend scraper cron

Sat 03:30 UTC = 11 non-keyed sources; Sun 03:30 UTC = Mawaqit. Mechanism: `docker exec takbeer-time-api-1 npm run --silent import:jummah:<src>-refresh`. Log `/home/junaid/takbeer-time-scraper.log`. (Dockerfile must include `scripts/` + `ts-node` for this to work — commit `4682117`.)

---

## 7. Documentation hygiene

Maintenance rule: read this file before feature work, and update it in the same change whenever a feature or user-facing workflow is created, changed, removed, renamed, or materially redefined.

Keep these in step with shipped features:
- `ARCHITECTURE.md` — data model / service tiers / deploy topology.
- `FEATURES.md` — full features doc.
- `WHATS-NEW.md`, `CHANGELOG.md` — user-visible feature deltas.
- `IMPLEMENTATION-PLAN.md`, `IMPLEMENTATION-GUIDE.md` — in-flight work.
- `PLAY-STORE-CHECKLIST.md` + `playstore-kit/` — Play compliance kit.
- `DEPLOYMENT.md`, `Takbeer-Time-Auto-Deploy-Handoff.md` — deploy runbooks.
- This file (`MASTER-FEATURES-AND-REQUIREMENTS.md`) — commit-derived master.

---

## 8. Branch / repo state notes (2026-05-28)

- **`origin/main`** — canonical development branch for current app work. Use `git fetch && git log -1 origin/main` for the current tip rather than copying a SHA into this living document.
- **`origin/live`** — deploy branch. Deploys come from `live`; merge `main` into `live` only after the CI gate is green.
- **9 fully-merged branches** (no unique work): `AndroidApp`, `codex`, `release/v2.0`, `merge/androidapp-into-main`, `auto-deploy-package-fix`, `fix/firebase-debug-sha1`, `fix/google-signin-app-signing-sha1`, `fix/per-prayer-toggle-permission-gate`, plus `live`.
- **3 superseded branches** (their unique commits re-applied to main under different SHAs — safe to delete):
  - `rename/takbeertime-android` → landed as `08e2364`.
  - `ci/android-aab-build` → folded into `ci/play-store-pipeline`.
  - `ci/play-store-pipeline` → landed as `df11877`.

**Stale local-only state to clean up** (per earlier work): a stale local checkout had a misleading 58-item dirty diff caused by old HEAD pinning. Now resolved; local `main` is fast-forwarded to `origin/main`.

---

## 9. Planned / deferred work (📋)

- Email + SMS reminder channels (FCM ✅; SendGrid/SES + Twilio still 📋). SMS is best-effort by policy; FCM is the guaranteed channel.
- Quiet hours, multi-device dedup, push rate-limiting (V1+).
- Elasticsearch tier for advanced search + faceted analytics.
- Data-sync worker (ES indexing, materialized views, analytics).
- Geo-sharding (Americas / Europe+ME / Asia / Africa DBs by lat/lng).
- Backend `/api/admin/*` retention policy on `ActivityLog` (TTL job). Currently rows accrue with IP + UA + no TTL — defer until volume warrants.
- Dispute admin-escalation UI after 7-day unresolved window.
- iOS app (Podfile exists; build not active).
- Cron'd Masjidi scraper (needs `MASJIDI_API_KEY`; currently blank).
- Removal of `index-enhanced.html` from the repo (currently 404'd at the edge; tracked for deletion).
- "Request reactivation" flow for closed masjids (lifecycle defined; UI flow 📋).
- Anonymous-favorites → server-merge on sign-in (storage shape defined; merge logic 📋).
- `GET /mosques/nearby` (and the browse list) should resolve effective timings the way the detail endpoint does — today they only include timings when an **active PrayerSchedule** exists, so keeper-submission-only masjids return empty timings in list payloads. The client compensates by hydrating cards from the default-mosque object / on-device mosque cache (v4.1.5), but the server-side effective-keeper fallback is the real fix (needs Postgres-backed tests).

---

---

## 10. Change log — resolutions applied 2026-05-28

Each item below resolves a requirement conflict surfaced during review. Marked 🔧 wherever it appears inline above.

### Resolved doc-internal inconsistencies
- **A. Reminder offset range** — 🔧 typed integer **1–120 min in 1-minute increments**, same range on UI and backend; **default = 10 min**. No preset buttons. §1.7, §5.3, §5.10.
- **B. Browser e2e wiring** — Puppeteer/Jest is wired under `e2e/*`; CI runs a non-mutating production smoke e2e on every push/PR, while the full e2e suite remains available via `npm run test:e2e`. Removed from the "planned / deferred" list. §9.
- **C. Map nearby cap** — set to **20 results** (per your decision; honours the canonical-doc value over commit `d792306`). §1.1, §2.2, §5.10.
- **D. "No build step" rule scope** — scoped explicitly to the web frontend; backend / mobile / Docker / CI legitimately build. §5.1.
- **E. "Two parallel UIs" framing** — rewritten. `index.html` is the canonical interactive app; other HTML files (`admin`, `api-docs`, `delete-account`, `privacy`, `terms`, `blog/*`) are special-purpose surfaces, not alt-UIs. `index-enhanced.html` is **deprecated, 404'd at the edge, slated for removal**. §5.1, §9.
- **F. Keystore path** — Windows file path removed from this doc; it lives in the private operator runbook. Cryptographic attributes (RSA 2048 / SHA384 / 2053-09-12 expiry) kept. §3.

### Resolved product / architecture conflicts
- **1. Frontend optimistic promotion** — removed. Promotion is **server-authoritative**; the client renders whatever `verificationStatus` the server returns. §1.5.
- **2. Young-masjid bootstrapping** — fallback added: with fewer than 3 top contributors, a submission promotes to `community` status (not `verified`) after 7 days uncontested + submitter trust ≥ 70 + ≥ 1 approval. Admin can manually promote to `verified`. §1.5, §5.10.
- **3. Confidence baseline + threshold math** — initial confidence = **50**; auto-approval threshold relaxed to **≥ 80** (not `> 80`); 3 approvals × +10 → 80 ✅. §1.5, §5.10.
- **5. Open API vs CORS** — CORS split: read endpoints allow `*` for third-party browser clients; write endpoints require origin in `ALLOWED_ORIGINS`. §5.2.
- **6. `JUMMAH_SCRAPER_ENABLED` kill-switch** — `--force` CLI override removed. Env var is the only path. §2.3.
- **7. Anonymous favorites** — favorites now anonymous-first (localStorage), with sign-in merge to `user_favorites`. Symmetric with default-mosque. Removed from the `requireSignIn(...)` gate list. §1.8.
- **8. Closed-masjid voting** — new timing submissions and votes **disabled** on closed masjids; only "Request reactivation" remains. Existing data is read-only. §1.4.
- **9. `ADMIN_EMAIL` hardcoded fallback** — removed. Env var is **required**; without it, `/api/admin/*` returns 404 everywhere. §1.14, §5.2.
- **10. Account-deletion + keeper attribution** — display name replaced with `Former contributor #<short-hash>` on delete; email + `firebase_uid` nulled; submission/schedule rows retained. Warning shown at delete time. §1.13.
- **11. SMS rate limit** — kept at 10/hour/user but documented as **best-effort**; FCM is the guaranteed channel for time-critical delivery. §1.7, §5.10, §9.

### Deferred (item 4 in the review)
- **4. Maintenance of `index-enhanced.html`** — resolved by deprecation (see E). No further work required on that surface.

### Added 2026-05-28 — most-current-submission review (`5256255 Fix Jummah next prayer handling`)

Source: commit `5256255` on `origin/main` (2026-05-28 23:09 PKT). Files: `js/__tests__/computeNextPrayer.test.js`, `js/app.js`, `js/components.js`. Tests cover all four behaviours below.

- 🆕 **Date-aware Jummah** in the daily-prayer cycle (Friday only). §1.2.
- 🆕 **7-day look-ahead** in `computeNextPrayer`; candidates use absolute `Date` targets. §1.2.
- 🆕 **No auto-Maghrib for Jummah-only masjids** (`shouldComputeMaghrib = hasDailyTiming || !jummah`); `maghribOffset` must be finite. §1.2.
- 🆕 **Default-mosque stickiness**: don't substitute another mosque when the user's `defaultMosqueId` is set but unresolved. §1.2.

### Added 2026-05-29 — home screen UI handoff

- 🆕 **Home next-card refresh**: masjid name/address/directions now share a compact header row, directions uses a short **Go** button, the keeper assist chip includes an explicit **Switch** affordance, and all daily takbeer times render as an inline Jamat/Starts/Ends panel instead of a collapsed dropdown. §1.2, §1.4, §1.9.
- 🆕 **Topbar control polish**: Qaza pill copy is now **Qaza Namaz Tracker** with a clock icon, reminders use a grouped pill treatment, and the language selector is a custom menu with native + English language labels. §1.10, §1.11.
- 🆕 **Website/app UI parity**: the public web home screen now inherits the app-style compact topbar on phone widths while preserving the wordmark, and desktop web uses a wider premium hero composition with larger branding, stronger headline/share affordance, and better-balanced default-masjid / sun-position cards. §1.2, §1.9, §1.10.

#### Stabilisation pass (2026-05-29, follow-up to the handoff)

- 🆕 **Full locale coverage for the handoff strings**: every new key (`next.colJamat/colStarts/colEnds`, `next.timesCaption`, `next.tag`, `next.prayersWord`, `next.switch`, `next.reminders`, `next.at`, `next.allTimesToday`, `nav.go`, `qaza.pill`, `lang.eyebrow/choose`) is translated across all 10 locales — they no longer fall back to English in ar/ur/id/bn/hi/tr/fa/ms/fr. §1.11.
- 🆕 **RTL-correct clock + times**: the hero "next prayer" name and the "at <time>" prefix are i18n'd (were English-only), and all clock times in the hero panel and drawer table are LTR-isolated so Arabic/Urdu/Persian render "4:30 am", not the bidi-reordered "am 4:30". Drawer prayer-row labels are i18n'd too. §1.2, §1.11.
- 🆕 **Hero ↔ drawer parity**: the hero all-times panel and the drawer timings table now use the **same** ordering (Jummah replaces Dhuhr on Fridays; appended as a traveller row otherwise) and the **same** resolver (`timingsFromMosque`), so a keeper schedule carrying only a `maghribOffset` shows a computed **Maghrib** row in both places instead of silently dropping it from the drawer. §1.2.
- 🆕 **RTL language-menu anchoring**: in the native shell the topbar mirrors for RTL, putting the language trigger on the left; the dropdown now docks to the **left screen edge** (fixed positioning computed from the trigger's real rect, so it survives any status-bar/notch height) instead of opening off toward the right. LTR keeps its right-anchored placement. §1.11.
- 🆕 **First-start permission onboarding (native)**: the app now requests **notifications** and **location** at first launch (once, gated by `takbeer_first_perm_v1`) instead of only lazily on Follow / arm-reminders / first geolocate. Exact-alarm (Android 12+) is surfaced via the in-app banner on first run and deep-linked when a reminder is actually armed. The lazy request paths still short-circuit on an existing grant, so the single up-front grant is **reused everywhere** with no re-prompts. Verified on a physical Android 16 device: notification + location dialogs fire at launch, exact-alarm reports `granted`, and a test reminder delivers through the `prayer-reminders-v2` channel while backgrounded. `mobile/native-bridge.js`.
- 🆕 **Reminder delivery reliability**: confirmed end-to-end that prayer reminders fire on time and reach the device while backgrounded — scheduling uses `setExactAndAllowWhileIdle` (Doze-proof) on the high-importance prayer channel with the bundled chime, contingent on the notification + exact-alarm grants now obtained up front.

#### v4.1.1 bug-fix follow-up (2026-05-29)

- 🆕 **Sun-position card auto-resolves location**: when location permission is already granted, the "Salah by sun position" card fetches coordinates and renders times automatically on load instead of re-showing the "Use my location" button. Reuses the existing grant (native via `takbeerPermissions.check`, web via the Permissions API); never auto-prompts an undecided user. §1.2.
- 🆕 **Exact-alarm is part of the first-start ask**: when notifications are granted but the exact-alarm toggle is not, first-run now deep-links to the OS "Alarms & reminders" screen (no runtime dialog exists for it), so reminders are set up to fire precisely from day one. §1.x reminders.
- 🆕 **Reminders pill polish**: smaller bell + tighter padding for a proportioned pill, and the reminder count badge is now a high-contrast cream chip (was a washed-out brass-on-brass number when armed).

#### Review hardening pass (2026-06-07)

- 🆕 **Qaza guest-to-account migration**: qaza records saved while signed out are folded into the signed-in account bucket on email/dev-auth sign-in, Google sign-in, and app boot with a persisted session. Rows are de-duplicated before server sync so the qaza drawer does not appear empty after login. §1.10.
- 🔧 **Preferred keeper validation**: `PUT /api/users/me/preferred-keeper` now rejects arbitrary UUIDs; the requested keeper must be an existing, non-deleted user with a non-rejected/non-withdrawn timing submission or schedule for that masjid. §1.9, §5.8.
- 🔧 **Locale key coverage audit**: all 9 non-English JSON bundles now contain every `data-i18n` key used by the canonical `index.html` page (`0/201` missing per bundle), avoiding silent missing-key fallback for the current website surface. New bulk-filled strings are seeded from the canonical English baseline pending native translation review. §1.11.
- 🔧 **Browser e2e teardown stability**: Puppeteer launch/close has a bounded close path and the Jest e2e timeout was raised to cover slow Chromium shutdowns, so passing suites do not fail in `afterAll`. §8.

#### UX flow simplification pass (2026-06-12)

Source: js/app.js, index.html, e2e/06|09|14|17|19. Goal: remove dead-ends and re-typing from the three core journeys (find → set default, sign-in mid-action, add masjid → add times).

- 🆕 **Set-default auto-navigates home**: `setDefaultFromCard` / `setDefaultFromDrawer` now call `goHome()` after the optimistic update — map and drawer close, the overlay hash collapses (replaceState, so Back doesn't reopen it), and the hero shows the new default with a confirming toast. §1.8.
- 🆕 **Post-login resume** (`view.pendingAuthAction`): every `requireSignIn` call site passes a resume callback; the shared `afterSignIn()` (email+password, dev email, and Google paths now funnel through one function) re-runs the interrupted action after profile/favorites load. A submission typed while signed out is auto-submitted right after login — no values lost, no landing on the wrong screen. Cancelling the login modal clears the pending action. §1.13.
- 🆕 **Add-masjid reverse geocoding**: placing/dragging the pin (or "Use map center") reverse-geocodes via `api.reverseGeocode()` and auto-fills **city / country / address** (`prefillAddressFromPin`, dragend-only per usage etiquette, stale-response guarded). It tries direct Nominatim first, then backend `/api/geocode/reverse` as a mobile/WebView fallback with a server-side user agent. Fields the user has typed in are never overwritten (`data-user-edited`). Offline/rate-limited lookups silently fall back to manual entry. §1.1.
- 🆕 **Create → times handoff**: after "Add masjid" succeeds the app opens the new masjid's detail drawer with the submit-times form ready (`openDetail` + `openSubmitForm`), replacing the old map-popup dead-end; toast copy now says "Added <name> — now add its jamat times".
- 🔧 e2e suites 06/09/14/17 updated for the auto-close-on-set-default behavior; suite 19 mocks Nominatim (deterministic empty address) and the post-create `GET /mosques/:id`, and asserts the drawer + times form open after create.
- 🆕 **List cards borrow known timings** (v4.1.5 follow-up): `makeCard` merges timing fields from the hydrated default-mosque object or the on-device mosque cache when the list entry has none, so the directory/map card for a masjid with times no longer shows "Be the first to submit times". Root-cause server gap tracked in §9.

These behaviours together support the broader product direction visible across the recent commits (`9493aba`, `25f1aaf`, `5256255`): **Jummah-first low-friction submissions** ("Only know Jummah? Start there — travellers are often looking") with the next-prayer engine and Maghrib computation refined so a Jummah-only masjid renders correctly instead of inventing daily rows.

### Added 2026-05-28 — requirements enforcement audit

Source: commit after `0377aeb` in this working tree. Files: `.github/workflows/ci.yml`, `e2e/00-smoke.test.js`, `server/src/index.ts`, `server/src/routes/admin.ts`, `server/scripts/import-jummah.ts`, `server/scripts/lib/jummah-import-core.ts`, `server/src/routes/mosques.ts`, `server/src/routes/users.ts`, `js/api.js`, `js/reminders.js`, `js/app.js`, and related tests.

- 🆕 **CI regression gate restored**: push/PR now runs web unit tests, backend build + Jest with PostGIS, non-mutating browser smoke e2e, and Android debug build.
- 🔧 **Admin hardening implemented**: `ADMIN_EMAIL` is now required at request time for admin overview access; unset env returns 404.
- 🔧 **Jummah scraper kill switch enforced**: the `--force` write bypass was removed; `--apply` requires `JUMMAH_SCRAPER_ENABLED=true`.
- 🔧 **Open API CORS split implemented**: public read endpoints allow wildcard CORS without credentials; write endpoints remain origin-restricted.
- 🔧 **Nearby result cap enforced at 20** in both frontend query and server validation.
- 🔧 **Reminder offset range aligned** to 1–120 minutes in client clamping and backend Zod validation.

### Added 2026-06-22 — live keeper-update and pin-fill reliability

- 🔧 **Current keeper submissions update the active schedule**: `POST /api/submissions` now detects when the submitter owns the current active `PrayerSchedule` and uses shared merge/install logic to promote the submitted keys immediately. This fixes the live failure mode where a keeper's accepted/manual Isha update appeared in `effectiveTimings` but left `prayerSchedules[0]` stale for other attendees.
- 🔧 **Keeper consensus scoring wired**: `recomputeAndPromote` now marks submissions from the active schedule's `submittedById` as time-keeper submissions, so the documented keeper boost is no longer inert.
- 🆕 **Reverse-geocode backend fallback**: add-masjid pin fill now goes through `api.reverseGeocode()`, with direct Nominatim first and validated backend `/api/geocode/reverse` fallback. Backend tests cover coordinate validation and Nominatim address normalization.

### Added 2026-07-30 — Dars social invitations

- 🆕 **One-tap Dars group invitations**: each group’s invite panel now has dedicated **WhatsApp** and **Facebook** buttons alongside the existing device share sheet. Both share the secure group join link, so invitees land directly on the Dars join flow.

*End of master list. For canonical commit-by-commit history see `git log origin/main`; for per-feature deep-dives see `FEATURES.md`.*
