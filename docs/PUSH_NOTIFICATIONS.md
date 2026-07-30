# Push Notifications — Keeper-Update Notifications

Spec for the server-side implementation. The mobile/Capacitor side is being built in parallel against this same contract; both halves only need to agree on **topic naming** and **payload shape** to interoperate.

---

## ✅ Status

- **Server-side:** Implemented as of commit [`7facc7d`](../../../commit/7facc7d). Module at `server/src/lib/fcm.ts`, hook in `POST /api/submissions`. 10 tests pin the behavior (7 unit, 3 integration).
- **Mobile side:** Per `AndroidApp` branch (`@capacitor/push-notifications` plugin, channel creation, subscribe-on-follow, deep-link on tap, foreground silent re-fetch).
- **To go live in production:**
  1. Set `FCM_ENABLED=true` in the production env (see `server/.env.production.example`).
  2. Confirm the 5 manual Firebase Console items in the *Setup checklist* below.
  3. Verify `mobile/android/app/google-services.json` is present in the APK build for `com.takbeertime.app`.
  4. Smoke test: `curl POST /api/submissions` as a keeper → tail server logs → look for `[fcm]` line. With `FCM_ENABLED=true` the device subscribed to that topic should ping within seconds.

### Verification log

What's been confirmed end-to-end at the time of writing:

| Check | Result |
|---|---|
| `server/src/lib/fcm.ts` matches the spec contract | ✅ Topic `keeper-${keeperId}-mosque-${mosqueId}`, payload fields all string, `FCM_ENABLED` gate, fire-and-forget try/catch, body formatter for 1 / 2 / 3+ prayer counts |
| `POST /api/admin/test-push` route gating | ✅ Returns 404 for: no auth, fake bearer, GET method. Endpoint masks itself completely from probing — by design (no leak that the endpoint exists when ADMIN_TEST_PUSH_ENABLED is unset or auth is invalid) |
| Mujaddiya Masjid + Junaid keeper IDs reachable via public API | ✅ `mosqueId=9e81a260-7f28-4b2a-9e8f-1613e45a85ed`, `keeperUserId=c974fd26-eb98-411d-a5d1-3bcd836d99cd`, so the canonical topic for live testing is `keeper-c974fd26-eb98-411d-a5d1-3bcd836d99cd-mosque-9e81a260-7f28-4b2a-9e8f-1613e45a85ed` |
| Android build with `google-services.json` baked in | ✅ Release APK installs and `FirebaseInitProvider: FirebaseApp initialization successful` logged on launch |

What still needs a live device + an active Firebase ID token to confirm:

- `window.takbeerPush.subscribe(topic)` actually completes the FCM topic subscription (depends on `Push.register()` succeeding on the specific device)
- Foreground push receipt → `takbeer:schedule-update` CustomEvent → silent re-fetch of `/mosques/:id` → hero re-paints
- Background push tap → `location.hash = mosque/<id>` → drawer opens deep-linked

Live test recipe (run when phone is plugged in over ADB):

```bash
# Step 1 — subscribe the device to the test topic. On the phone:
#   open the masjid drawer → unfollow the keeper → follow them again.
# This calls window.takbeerPush.subscribe with the topic name, which
# triggers Push.register() (FCM token issued) and FCM.subscribeTo.

# Step 2 — fire the test push from a dev machine that's signed in.
# The Firebase ID token is on you; pull it from your auth session
# (localStorage > firebase:authUser:<...> > stsTokenManager.accessToken).

curl -X POST https://takbeertime.com/api/admin/test-push \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-firebase-id-token>" \
  -d '{
    "keeperUserId": "c974fd26-eb98-411d-a5d1-3bcd836d99cd",
    "mosqueId":     "9e81a260-7f28-4b2a-9e8f-1613e45a85ed",
    "keeperName":   "junaid.qazi.veemed",
    "mosqueName":   "Mujaddiya Masjid"
  }'

# Expected: {"topic":"keeper-...-mosque-...","sent":true,"messageId":"projects/..."}
# Expected on phone (foreground): no banner, but hero silently re-fetches.
# Expected on phone (background): "junaid.qazi.veemed updated Mujaddiya
# Masjid" notification, tap → drawer opens.
```

### Live test session — 2026-04-28 (in progress)

Snapshot of what was attempted, what landed, and what's still pending so the next agent (or the same agent post-compaction) can pick up without re-deriving context.

**Confirmed locally:**
- `main` carries the full client + server stack: client wiring (`d57e71d`, `10e3194`), server FCM module (`7facc7d`), observability (`261c7f9`), admin test endpoint (`56f83a1`), production handoff (`f67e3b6`), test reconciliation (`8c686af`), and this verification log (`0741cfc`).
- Release APK with `mobile/android/app/google-services.json` baked in installs and reports `FirebaseInitProvider: FirebaseApp initialization successful` in logcat.
- Public API surfaces the live test IDs:
  - `mosqueId = 9e81a260-7f28-4b2a-9e8f-1613e45a85ed` (Mujaddiya Masjid)
  - `keeperUserId = c974fd26-eb98-411d-a5d1-3bcd836d99cd` (Junaid)
  - Therefore the canonical live topic is `keeper-c974fd26-eb98-411d-a5d1-3bcd836d99cd-mosque-9e81a260-7f28-4b2a-9e8f-1613e45a85ed`.
- `POST /api/admin/test-push` is fully gated: returns 404 for no-auth, fake bearer, and GET — endpoint does not leak its own existence when auth/env gate is off.

**Blocker hit during automation attempt:**
- The Capacitor release WebView surfaces as a single NAF (Not Accessibility Friendly) root in `uiautomator dump` — none of the inner DOM (drawer chips, follow button) is exposed to the accessibility tree.
- Coordinate-based `adb shell input tap` against eyeballed positions in screencaps did not register on the "✓ Following" button. Show-touches setting flipped on but pointer indicators didn't render in screencap.
- Net effect: I cannot reliably trigger `window.takbeerPush.subscribe(...)` from the host machine alone. A human tap on the device, or a server-side workaround that doesn't depend on the device subscribing first, is needed to close the loop.

**Next steps now that backend SSH is available** (`junaid@192.168.18.51`, repo at `~/Documents/GitHub/Jamat`):
1. Confirm the production env on the server has `FCM_ENABLED=true`, `ADMIN_TEST_PUSH_ENABLED=true`, and `ADMIN_TEST_PUSH_USER_ID=c974fd26-eb98-411d-a5d1-3bcd836d99cd` set wherever the Express process reads its env (PM2 ecosystem file, systemd unit, or `.env`).
2. Tail the server logs (`pm2 logs` / `journalctl -u <unit>`) while concurrently driving the phone via ADB so we can correlate `[fcm] sent { topic, messageId }` with device-side receipt.
3. Have the user perform the unfollow → re-follow tap on the keeper card *once* manually (UI-automation dead-end documented above). Watch logcat for `Push.register()` success and the FCM token line.
4. Fire the test push either via `curl POST /api/admin/test-push` (with a fresh Firebase ID token from the web app's localStorage) or — easier from the server box — via a small one-off Node script that calls `notifyKeeperUpdate(...)` directly, bypassing the admin route entirely.
5. Verify foreground path: phone in foreground, no banner, hero silently refetches and repaints with the new times.
6. Force-stop the app, fire again, verify the OS notification banner shows and tapping deep-links to `#mosque/9e81a260-...`.
7. Round-trip: submit a real timing change as Junaid via `POST /api/submissions` and confirm the same flow fires end-to-end (i.e. the submission hook actually calls `notifyKeeperUpdate`, not just the admin test endpoint).

**Untracked test artifacts** (not committed, can be deleted): `after_tap.png`, `closetest.png`, `drawer.png`, `holding.png`, `refollowed.png`, `screen.png`, `scrolled.png`, `showtouch.png`, `tap2.png`, `unfollowed.png`, `ui.xml`, `nul`. These were dumped during the automation attempt and have no value once live testing succeeds.

#### ✅ Verified end-to-end on 2026-04-28

Full live device round-trip succeeded. Both halves run together:

| Path | Evidence |
|---|---|
| `notifyKeeperUpdate` actually sends via firebase-admin | server logs `[fcm] sent { topic, messageId: 'projects/takbeerapp/messages/<id>' }` |
| FCM topic delivers to subscribed device | `FirebaseMessaging` log line in app's PID at the moment server fires |
| `Push.register()` + `FCM.subscribeTo()` succeed on the device | document.title sentinel `[QA] subscribed keeper-c974fd26-...` (verified during testing, sentinel since reverted) |
| Foreground: `pushNotificationReceived` → `takbeer:schedule-update` CustomEvent | document.title sentinel `[QA] received schedule_update 9e81a260` flipped on push |
| Background: keeper-updates channel banner in tray | `dumpsys notification` shows `pkg=com.takbeertime.app channel=keeper-updates tag=<mosqueId> importance=4` |
| Background tap → deep-link to masjid drawer | tapping the tray notification opened the Mujaddiya Masjid drawer (`location.hash=mosque/9e81a260...`); Isha row showed the new 8:45 PM and FOLLOWING badge was active |
| Real `POST /api/submissions` triggers the hook end-to-end | submission `eeb8ed98-6693-...` returned 201, server's submissions.ts hook called `notifyKeeperUpdate`, tray notification appeared on the device |

Workarounds adopted during the session, in case anyone hits them again:
- Capacitor release WebViews collapse to a single NAF (Not Accessibility Friendly) node in `uiautomator dump`. Inner DOM elements report `[0,0][0,0]` bounds, so coordinate-based `adb shell input tap` against in-WebView buttons is unreliable. To exercise `followKeeper()` from a host machine, the workable approach is a temporary auto-subscribe in `native-bridge.js` (rebuild + reinstall), not UI automation. The auto-subscribe block was removed before the final clean APK was installed.
- Release builds suppress JS `console.log` from logcat. Use `document.title` as a sentinel — uiautomator dumps the WebView's page title via the `text=` attribute on its root node, so any string written to `document.title` is readable from the host without DevTools.

#### Server config that powers this

The dev backend at `~/Documents/GitHub/Jamat/server/.env` was extended (committed only as keys-without-values; secrets stay on the box):

```
FIREBASE_PROJECT_ID=takbeerapp
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-fbsvc@takbeerapp.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FCM_ENABLED=true
ADMIN_TEST_PUSH_ENABLED=true
ADMIN_TEST_PUSH_USER_ID=c974fd26-eb98-411d-a5d1-3bcd836d99cd
```

A one-off script at `server/scripts/fire-test-push.ts` stays in the repo for ad-hoc topic-fire tests:
```
cd server && npx ts-node scripts/fire-test-push.ts
```
It loads dotenv, imports `auth.ts` to trigger `admin.initializeApp`, then calls `notifyKeeperUpdate` directly with the canonical Mujaddiya/Junaid args.

---

## TDD audit — round 2 (2026-04-28)

Server tests grew from 69 → **99** across **9 suites**, all green. Round 2 fixes (after the initial nine in the first audit):

| Bug surfaced by failing test | Fix |
|---|---|
| `notifyKeeperUpdate` title leaked whitespace from `keeperName`/`mosqueName` (e.g. `"  Hassan   updated  Mujaddiya "` if either field had stray spaces) | New `composeTitle()` helper trims, falls back when whitespace-only, and caps total title length at 180 chars / 80 per name. |
| Title would render as `" updated <mosque>"` with a leading space when `keeperName` was whitespace-only | `composeTitle` falls back to `"New times for <mosque>"` when keeper is empty after trim, and `"<keeper> posted new times"` when mosque is empty. Both empty → `"New jamat times posted"`. |
| Oversized `keeperName`/`mosqueName` could blow FCM's `notification.title` cap (~200 chars) and have the whole send rejected | Per-side `cap()` to 80 chars + total cap to 180 with ellipsis. |
| `PUT /api/users/me/preferred-keeper` had **zero test coverage**. Auth gating, validation edges, idempotency, multi-masjid pref preservation were all untested. | New `preferredKeeper.test.ts` — 7 tests covering 401, 400 (bad uuid for either field), 200 set, 200 clear-with-null, idempotent set-twice, preserves other masjid prefs. |
| Submission hook fallback chain `keeper?.fullName \|\| keeper?.email \|\| 'A time keeper'` had no test for the `fullName-null, email-set` middle branch | New `fcmHook.test.ts` case using a real DB row with `fullName: null` confirms the title uses the email. |

### Client-side round-2 fixes

| Bug | Fix |
|---|---|
| Sign-out left FCM topic subscriptions intact — a different user signing in on the same device would receive pushes for the previous user's followed keepers (privacy bleed) | `window.takbeerPush.unsubscribeAll()` iterates the local topic registry (`takbeer_fcm_topics_v1` in localStorage) and tells FCM to drop each. The sign-out flow in `js/app.js` calls it before clearing the email. |
| Subscribed topics were ephemeral — no way to enumerate them for cleanup | `subscribe()` and `unsubscribe()` now mirror their state into `localStorage` (`takbeer_fcm_topics_v1`). |
| Push storm: 5 rapid pushes for the same masjid caused 5 parallel `getMosque(id)` calls | `wirePushUpdates` coalesces by mosqueId via an in-flight `Map`. Concurrent listeners for the same mosqueId share one fetch. |

### Round-2 cache busters
- `js/app.js?v=38`
- `js/native-bridge.js?v=20`

(`components.js` unchanged from round 1 at v=37.)

---

## TDD audit — round 3 (2026-04-28)

Server tests: 99 → **101**. Smaller round — the previous two passes covered most of the surface, but one real bug remained.

| Bug | Fix |
|---|---|
| `recomputeAndPromote` emits `{ prayer: 'maghribOffset', to: '3' }` (a minute count, not an HH:mm time) when consensus shifts the Maghrib offset. `buildBody` rendered this as `"New maghribOffset at 3"` — gibberish to the user. With a 2-change body containing offset + a real prayer, it was `"Updated Isha (8:45 PM) and maghribOffset (3)"`. | `buildBody` now special-cases `prayer === 'maghribOffset'`. Single offset change → `"Maghrib offset updated to 3 min"`. Mixed offset + prayer → `"Updated Isha (8:45 PM) and Maghrib offset (+3 min)"`. The string `"maghribOffset"` can never reach the user-visible body now (test asserts it). |

After this round, continuing to add tests passes the threshold of useful coverage. The remaining items in the spec's "open questions" list (quiet hours, multi-device de-dupe, rate limiting, localization) are V2 product decisions, not robustness bugs.

### Cumulative state across all three audit rounds

| | Round 1 | Round 2 | Round 3 | Total |
|---|---|---|---|---|
| Server tests added | 17 | 13 | 2 | **32 since feature shipped (69 → 101)** |
| Production bugs surfaced + fixed (server) | 4 | 5 | 1 | **10** |
| Production bugs surfaced + fixed (client) | 5 | 3 | 0 | **8** |
| Live-device verifications | 1 | 1 | 0 | **2** |

Test suites: 7 → **9** (added `fcmHook.test.ts` mid-feature, plus `preferredKeeper.test.ts` in round 2).

---

## Round 4 — Suggestion notifications (2026-04-28)

User-reported gap: keepers had no way to learn that a new suggestion
landed in their inbox until they manually opened the app. The inbox
bell only refreshed during `init()` — not on app foreground, not on
any server event. A suggestion sat invisible until the recipient
relaunched, even with the app installed.

The fix mirrors the keeper-update architecture but uses a per-user
inbox topic instead of a per-(keeper, masjid) topic.

### Topic

`suggest-to-<userId>`. Only the keeper themselves subscribes — no
fan-out, single recipient by design.

### Server (`server/src/lib/fcm.ts`)

New `notifyOnSuggest({ suggestionId, toUserId, mosqueId,
fromUserName, mosqueName, timings })` returns the same `NotifyResult`
discriminated union as `notifyKeeperUpdate`. Title via
`composeSuggestTitle`: `"<from> suggests new times for <mosque>"`.
Body via `buildSuggestBody`: per-prayer summary with "Suggests"
verb (vs. keeper-update's "Updated"). Tag = `suggestionId` so a
re-send replaces rather than stacks. Reuses the `keeper-updates`
channel for v1; channel separation is a polish item.

### Server (`server/src/routes/suggestions.ts`)

After `prisma.suggestion.create()` in `POST /api/suggestions`,
fire-and-forget `notifyOnSuggest` with the from-user name + mosque
name looked up in parallel. Same fire-and-forget contract as the
submissions hook: failures log but never bubble into the user's
response.

### Mobile shell (`mobile/native-bridge.js`)

- New `takbeerPush.subscribeWhenPermitted(topic)`: subscribes
  immediately if `Push.checkPermissions()` reports granted; otherwise
  stores the topic in `localStorage.takbeer_fcm_pending_v1` to drain
  later. Drained inside `subscribe()` and `ensureRegistered()` success
  paths. Preserves the "ask only when value is obvious" rule —
  signin alone never triggers the prompt.
- `pushNotificationReceived` now routes `data.type === 'new_suggestion'`
  → `takbeer:new-suggestion` CustomEvent → app refreshes the inbox.
- `pushNotificationActionPerformed` (background tap) → deep-link to
  `#inbox` (vs `#mosque/<id>` for schedule_update) so the keeper sees
  the diff context they need to act.
- `App.appStateChange.isActive` now also dispatches `takbeer:resumed`
  so the inbox gets re-polled on foreground (fixes the stale-bell
  bug that existed before round 4).

### Client (`js/app.js`)

- After `loadProfile()` resolves, calls `takbeerPush?.subscribeWhenPermitted(
  ` + ` `suggest-to-${view.me.id}` ` + `)`.
- `applyHashState` now handles `#inbox` as a deep-link route. Refreshes
  the inbox first, then opens the modal (the user just got a push for
  something local state may not know about yet).
- `wirePushUpdates` listens for `takbeer:new-suggestion` and
  `takbeer:resumed` and calls `refreshInbox()` (coalesced to one
  in-flight request).

### Tests

- `fcm.test.ts`: 9 new cases for `notifyOnSuggest` — topic format,
  title/body variations (1/2/3+ prayers, maghribOffset alone, jummah
  array, empty timings), env gate, whitespace fromName fallback.
- `suggestions.test.ts`: hook fires on create with correct args; hook
  does NOT fire when validation rejects (e.g. self-target).

### Cache busters

`js/app.js?v=42`, `js/native-bridge.js?v=23`.

---

## Intent

When a time keeper submits new jamat times for a masjid, every user who has explicitly chosen to follow that keeper at that masjid should receive a push notification. Tapping the notification deep-links to the masjid drawer. The app foreground also silently re-fetches the masjid so the hero card updates without user action.

This replaces the current "user has to reopen the app or tap refresh to see updates" UX without introducing client-side polling.

## Non-goals (V1)

- iOS push (APNs config) — punted; Android-only first.
- Notifying users who are on the *top-rated keeper fallback* (no explicit follow). They'll continue to pick up updates on next refresh / app open. Adding them later is a refinement, not a contract change.
- Email / SMS — out of scope.

---

## Architecture: FCM topics keyed by `(keeper, masjid)` pair

We use Firebase Cloud Messaging **topics**, not per-device tokens. The topic name carries the precision we need:

```
keeper-<keeperUserId>-mosque-<mosqueId>
```

- Both UUIDs are the canonical lowercase UUID v4 form (no braces).
- 50 chars total — well under FCM's 200-char topic limit.
- Allowed characters: `a-zA-Z0-9-_.~%` — UUIDs + `-` are safe.

**Why per-(keeper, masjid):** A user can follow keeper X at masjid A and keeper Y at masjid B. We only want them notified when X submits *for masjid A* — not when X submits for some other masjid where they've chosen Y instead.

**Why topics over per-user device tokens:**
- No `(userId, fcmToken)` table to maintain on the server.
- Subscribe/unsubscribe is a single client-side call to FCM; no server round-trip.
- Fan-out happens inside FCM — server sends one message regardless of follower count.
- Postgres schema is unchanged.

Client-side responsibility (handled separately, just for context): when the user follows or unfollows a keeper at a masjid (`POST /mosques/:id/preferred-keeper`), the mobile app calls FCM `subscribeToTopic` / `unsubscribeFromTopic` with the corresponding topic name. The server doesn't need to know who's subscribed — that lives entirely in FCM.

---

## Server-side work

### 1. FCM Admin initialization

Add `server/src/lib/fcm.ts`:

- Initialize Firebase Admin's messaging client. The same service account already used for auth (`FIREBASE_PROJECT_ID`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL`) works for FCM — no new credentials.
- Export a single function: `notifyKeeperUpdate(args)` (signature in the next section). All FCM details stay inside this module so route handlers don't import `firebase-admin/messaging`.
- Must be safe to call when `FCM_ENABLED !== 'true'` — in that case it should log the intended payload at info level and return without sending. This lets the rest of the system run identically in dev/staging without firing real pushes.

### 2. Hook into `POST /submissions`

In `server/src/routes/submissions.ts`, the create handler currently ends with:

```ts
const changes = await recomputeAndPromote(data.mosqueId);
res.status(201).json({ submission, scheduleChanges: changes });
```

Add a fire-and-forget call **after `res.status(201).json(...)`** so the user's request isn't blocked on FCM:

```ts
// fire-and-forget: notify followers of this keeper at this masjid
notifyKeeperUpdate({
  mosqueId: data.mosqueId,
  submitterId: req.user!.id,
  submissionId: submission.id,
  timings: data.timings,
  scheduleChanges: changes,
}).catch(err => logger.error('FCM notify failed', { err, submissionId: submission.id }));
```

Important: send to followers regardless of whether `recomputeAndPromote` produced changes. Even when the new submission doesn't promote to the active schedule (e.g. it equals the previous one), followers of *this specific keeper* still want to know "their keeper just submitted." If you want to suppress no-op submissions, do it via a content equality check inside `notifyKeeperUpdate`, not by tying it to `changes.length`.

### 3. Notification payload contract

This is the bit both sides must agree on. The mobile app will parse exactly these fields.

```jsonc
{
  "topic": "keeper-<keeperUserId>-mosque-<mosqueId>",

  "notification": {
    "title": "<Keeper full name> updated <masjid name>",
    "body":  "<short summary, see below>"
  },

  "data": {
    "type":         "schedule_update",
    "mosqueId":     "<masjid uuid>",
    "submitterId":  "<keeper user uuid>",
    "submissionId": "<submission uuid>",
    "ts":           "<ISO-8601 timestamp>"
  },

  "android": {
    "priority": "high",
    "notification": {
      "channelId": "keeper-updates",
      "tag":       "<masjid uuid>"
    }
  }
}
```

Notes:
- All `data` values must be strings — FCM enforces this. Don't put numbers, booleans, or objects in `data`.
- `tag` set to the masjid UUID means a second update at the same masjid replaces the first in the user's notification tray (good for keepers who fix a typo right after submitting). The client creates the `keeper-updates` channel.
- `body` content suggestion (server-generated, since the server has the keeper name and prayer labels):
  - Single prayer changed: `"New Isha at 8:45 PM"`
  - Two changed: `"Updated Isha (8:45 PM) and Asr (5:30 PM)"`
  - 3+ changed: `"Updated 4 prayer times"`
  - Times rendered in 12-hour with localized AM/PM. Use the masjid's timezone if you have one; otherwise UTC offset is fine for V1.
- Don't include the prayer name list in `data` — keep `data` flat and small. The client will re-fetch the masjid anyway to get authoritative state.

### 4. Schema changes

**None.** No new tables, no migration. Topic subscriptions live in FCM.

If you later want a fallback "direct send to specific user devices" path (e.g. for personal reminders rather than topic broadcasts), add a `UserPushToken` model at that point. Don't add it preemptively for this feature.

### 5. Environment variables

Add to `server/.env.example`:

```bash
# Push notifications via FCM. Defaults to false so dev/staging don't accidentally
# fire real pushes. Production sets this to "true".
FCM_ENABLED=false
```

The existing `FIREBASE_PROJECT_ID`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL` already work for FCM — same service account, same credentials.

### 6. Credentials reference (which file goes where)

There are **two different Firebase credential artifacts** in play. Don't mix them up:

| File | Where it lives | Purpose | Who reads it |
|---|---|---|---|
| `mobile/android/app/google-services.json` | Checked into the repo (public, but the API key inside is restricted to package + SHA-1 in Cloud Console) | Embedded into the APK at build time so the device knows which Firebase project to register with FCM | Capacitor Android build only. **The server does not use this file.** |
| Service account credentials (`FIREBASE_PROJECT_ID`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL` in `server/.env`) | Never in git — present only in the deploy environment | Lets `firebase-admin` on the server send pushes (and verify ID tokens, which is what they're already used for) | The Express backend only. |

If you're the server-side Claude Code agent reading this: you do **not** need `google-services.json`. Use `firebase-admin` initialized from the existing env vars exactly as auth already does (`server/src/middleware/` already initializes the Admin SDK — reuse that init or factor it into a shared module). FCM `messaging()` works off the same Admin app instance. No new credentials, no new files, no migration.

If you're a human onboarding to ops: regenerate the service account key via Firebase Console → Project Settings → Service accounts → "Generate new private key," then drop the values into the deployment environment. The Firebase project itself is administered by `qazi.junaid@gmail.com` (see Setup checklist below).

### 7. (Optional) Token register endpoint

Skip for V1. The topics-based design doesn't need it. If you later add direct messaging, the endpoint is `POST /users/me/push-tokens` with `{ token, platform }`.

---

## Setup checklist (manual, one-time)

**Firebase project ownership:** the Firebase project that backs both auth and FCM is administered by **qazi.junaid@gmail.com**. To make any console-side changes (add an app, rotate a key, change permissions, see usage metrics) you need access to that Google account.

Items the project owner needs to do in the Firebase Console once before push works in production:

1. **Confirm Android app is registered.** Console → Project Settings → "Your apps" tab → there should be an Android app with package name `com.takbeertime.app`. If not, click "Add app" → Android → enter the package name. Nickname is cosmetic; SHA-1 isn't needed for FCM (only for Sign-In / Dynamic Links).
2. **Enable Cloud Messaging API.** Console → Project Settings → "Cloud Messaging" tab → "Firebase Cloud Messaging API (V1)" should show **Enabled**. If "Disabled," click the three-dot menu and enable.
3. **Verify the service account has FCM permissions.** Console → Project Settings → "Service accounts" tab → the existing service account (the one whose email is in `FIREBASE_CLIENT_EMAIL`) should have the **Firebase Admin SDK Administrator Service Agent** role. The same role used for auth covers FCM.
4. **Download `google-services.json`.** From the Android app's settings, download the file. The mobile build needs it at `mobile/android/app/google-services.json`. **This file is not gitignored** — it's checked into the repo so the Android build is reproducible. It's safe to publish *only if* the API key inside is restricted in Google Cloud Console (APIs & Services → Credentials → Android key → Application restrictions → Android apps → `com.takbeertime.app` + the release SHA-1). If the restriction isn't set, treat the file as a credential and gitignore it instead.
5. **Restrict the Android API key** (one-time, in Google Cloud Console → APIs & Services → Credentials → "Android key (auto created by Firebase)" → Application restrictions → "Android apps"). Add `com.takbeertime.app` plus the SHA-1 of your release keystore (`keytool -list -v -keystore C:\Users\Junaid\takbeertime-keystore\release.keystore -alias takbeertime`).

The mobile side won't work without (4); the server can be developed and tested without it (steps 1-3 are server-relevant). Step (5) is a security-hardening step required *before* you publish a build whose `google-services.json` is in a public repo.

---

## Testing recipe

### Unit / integration on the server

1. Mock `firebase-admin/messaging.send` and assert that `POST /submissions` calls it with the expected topic name and payload shape, without slowing the response.
2. With `FCM_ENABLED=false`, assert that submission flow logs the intended payload and never calls `send`.
3. With `FCM_ENABLED=true` but a malformed topic (e.g. injected non-UUID), assert that the failure is caught and doesn't 500 the user's submit.

### End-to-end with a real device

The mobile app will provide a debug screen (or just observable behavior) for this. Rough flow:

1. Sign in as User A on Device A. Submit a timing for masjid M. Confirm a log entry shows the topic send.
2. Sign in as User B on Device B. Set User A as preferred keeper for masjid M. Verify (via FCM Console → Cloud Messaging → "Send test message") that B's device receives a push to `keeper-<A>-mosque-<M>`.
3. Now submit a new timing as A → confirm B's device gets the push within a few seconds, the masjid hero updates without user action, and tapping the notification opens the masjid drawer.

A handy debug tool while building: **FCM Console → Cloud Messaging → New Campaign → Notification → Target: Topic** lets you fire test messages to any topic name without going through `POST /submissions`. Use this to verify the client subscribes correctly before the server send is wired up.

---

## What the mobile side is doing (FYI, not server work)

So the server team has the full picture:

1. Install `@capacitor/push-notifications` plugin.
2. On app start, request notification permission (lazy — only when the user first follows a keeper, so we're not asking before the value is obvious).
3. On `setPreferredKeeper(mosqueId, keeperUserId)`:
   - If `keeperUserId` is non-null, call `FCM.subscribeToTopic("keeper-<keeperUserId>-mosque-<mosqueId>")`.
   - If switching keepers (replacing an existing preference), unsubscribe from the old topic first.
4. On unfollow / clear preference, unsubscribe from the topic.
5. On notification received in foreground: silently call `getMosque(mosqueId)`, update `view.defaultMosqueObj` if it matches, re-render hero. Don't show the OS notification when foregrounded — we already have the user's attention.
6. On notification tapped (background → foreground): deep-link to `#mosque/<mosqueId>` so the drawer opens.
7. Create the `keeper-updates` Android notification channel on first launch.

The mobile side does NOT call any server endpoint to register interest — subscription is entirely client-to-FCM. The server only sends; FCM handles fan-out.

---

## Open questions worth noting

- **Quiet hours.** Do we want to suppress pushes during the user's local night (e.g. 10pm-5am)? Easy to add later as a client-side filter; for V1, deliver always.
- **De-dupe across devices.** If a user is signed in on phone + tablet, both devices will subscribe to the same topic and both will receive the push. FCM has no native "this user already saw it" concept. Acceptable for V1 since each device shows its own notification.
- **Rate limiting.** A keeper could in theory submit 100 times in a minute. The mobile `tag: <mosqueId>` collapses these in the tray, but we still send 100 FCM messages. If this becomes a problem, debounce server-side (only fire if no other submission for this `(keeper, masjid)` in the last 30 seconds). Skip for V1.
- **Localization.** `notification.title` / `body` are server-rendered, so they're in English by default. Long-term: client-side rendering via `data` only (no `notification` block) so each device formats in the user's language. For V1, English is fine.
