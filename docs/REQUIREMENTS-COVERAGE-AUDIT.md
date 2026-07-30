# Requirements Coverage Audit

Date: 2026-05-28

Source of truth: `MASTER-FEATURES-AND-REQUIREMENTS.md`

## Summary

The project has useful coverage, but before this audit it did not have a CI workflow enforcing it on every change. Several requirements were documented as resolved while the code still carried the older behavior. This audit fixed the highest-risk mismatches and added a CI gate.

## Fixed During This Audit

| Requirement | Prior state | Change |
|---|---|---|
| CI runs on feature changes | `.github/workflows/ci.yml` was absent | Added CI for web unit tests, backend build/tests with PostGIS, browser smoke e2e, and Android debug build |
| `ADMIN_EMAIL` required | `server/src/routes/admin.ts` defaulted to a hardcoded email | Removed fallback; unset env returns 404 |
| Jummah scraper kill switch | `--force` still allowed writes without `JUMMAH_SCRAPER_ENABLED=true` | Removed the flag and help text; `--apply` now requires env |
| Open API CORS split | Global CORS used an allow-list with credentials | Public reads now get `Access-Control-Allow-Origin: *` without credentials; writes remain origin-restricted |
| Nearby result cap | Frontend requested 50 and server allowed 100 | Frontend requests 20 and server validates max 20 |
| Reminder offset range | Backend allowed 0-180 and client did not clamp | Backend validates 1-120, client clamps typed values to 1-120 |
| Browser smoke e2e | Existing e2e suite includes mutating prod tests | Added a non-mutating smoke test for CI |

## Current Automated Coverage

| Area | Existing coverage |
|---|---|
| Prayer timing calculation | Unit tests for next prayer, Jummah Friday replacement, Jummah-only lookahead, Maghrib offset behavior |
| Auth token handling | Unit tests for app JWT, Firebase fallback, dev auth gating, auth exchange |
| Local reminders | Unit tests for scheduling and offset range, e2e for reminder panel behavior |
| Qaza local ownership | Unit tests; backend API tests |
| Home/drawer/map/contribution/favorites/reminders/keepers/i18n/suggestions/API docs/add masjid | Puppeteer e2e suites under `e2e/` |
| Backend auth, admin, account deletion, FCM, consensus, mosques, keepers, qaza, suggestions | Jest/Supertest suites under `server/src/__tests__/` |
| Android packaging | CI debug build plus existing local Gradle build path |

## Remaining High-Risk Gaps

| Requirement area | Gap |
|---|---|
| Full e2e on every feature | The full `npm run test:e2e` suite currently targets the live site and includes mutating flows. CI therefore runs a non-mutating smoke test by default. The next step is a disposable local/staging backend fixture so the full suite can safely run on every PR. |
| Closed masjid lifecycle | Backend and UI paths exist, but there is no focused e2e proving closed masjids block submissions/votes and expose only reactivation. |
| Anonymous favorites sign-in merge | The master doc marks sign-in merge as planned/deferred; keep it out of "shipped" claims until implemented. |
| Dispute workflow | Backend model/requirements exist, but admin escalation UI remains deferred. |
| Observability and Redis claims | The master doc describes Redis, Prometheus, and alerting targets. This audit did not verify production infrastructure or code-level metrics emitters. |
| Seasonal modes | Marked partially shipped/deferred; no regression tests should treat them as complete until requirements are narrowed. |
| Accessibility | There is no automated tap-target/layout regression suite yet. Add browser screenshots or accessibility assertions for mobile critical screens. |

## Recommended Test Gate

Every feature PR should pass:

1. `npm run test:unit -- --runInBand`
2. `cd server && npm run build`
3. `cd server && npm test -- --runInBand` against PostGIS
4. `npm run test:e2e -- --runInBand e2e/00-smoke.test.js`
5. `cd mobile && npm run build && npx cap sync android && cd android && ./gradlew --no-daemon assembleDebug`

For changes touching core flows, additionally run the relevant full e2e file, for example:

- Prayer/timing changes: `e2e/09-all-times-dropdown.test.js`, `e2e/10-maghrib-offset.test.js`, `e2e/14-am-pm.test.js`
- Submissions: `e2e/04-contribute.test.js`
- Keepers/suggestions: `e2e/07-keepers.test.js`, `e2e/12-suggestions.test.js`
- Reminders: `e2e/06-reminders.test.js`, `e2e/13-reminder-sync.test.js`
- Mobile packaging: Android build plus on-device smoke when available
