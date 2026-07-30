# Required App Improvements

Last reviewed: 2026-05-01

This document lists the required improvements found during the repository review. It is organized by priority so the work can be triaged into security, release-blocking, product correctness, and maintenance tracks.

## P0 - Release Blockers

### Reject deleted users in authentication

Deleted users can still authenticate if they retain a valid app JWT. The auth middleware resolves users by `id` only and does not reject rows with `deletedAt` set.

Required changes:
- Update app-JWT and Firebase-token auth paths to reject users where `deletedAt` is not null.
- Ensure deleted users cannot call protected endpoints, create submissions, manage favorites, or update preferences.
- Add tests covering an already-issued token after `DELETE /api/users/me`.

Relevant files:
- `server/src/middleware/auth.ts`
- `server/src/routes/users.ts`
- `server/src/__tests__/usersDelete.test.ts`

### Stop returning sensitive user fields

`GET /api/users/me` returns the full Prisma user object. That can expose internal and sensitive fields such as `passwordHash`, `firebaseUid`, soft-delete state, and other implementation details.

Required changes:
- Replace broad Prisma return values with explicit `select` objects.
- Return a stable public user DTO.
- Audit other user-returning endpoints for the same pattern.

Relevant files:
- `server/src/routes/users.ts`
- `server/src/routes/auth.ts`

### Remove or lock down tracked Firebase Android config

`mobile/android/app/google-services.json` is tracked and contains a live-looking Firebase API key and OAuth client metadata. Firebase client keys are not equivalent to server secrets, but they must still be restricted and treated as environment-specific release config.

Required changes:
- Confirm whether this file is intended to be public.
- Restrict the key in Google Cloud/Firebase by Android package name and SHA certificate fingerprints.
- Rotate the key if this repository has been shared publicly or the key restrictions were absent.
- Replace the committed file with a template if local/release variants differ.
- Ensure `.gitignore` policy matches the chosen approach.

Relevant files:
- `mobile/android/app/google-services.json`
- `.gitignore`
- `android/.gitignore`

## P1 - Build, Test, And Deployment Reliability

### Fix server TypeScript build

`npm run build` in `server/` currently compiles `src/__tests__`, causing test-only TypeScript errors to block production builds.

Required changes:
- Exclude `src/__tests__` from the production TypeScript build.
- Keep tests type-checked through Jest or a separate test `tsconfig` if desired.
- Re-run `npm run build` after `prisma generate`.

Relevant files:
- `server/tsconfig.json`
- `server/src/__tests__/fcm.test.ts`

### Make dependency installation reproducible

Server tests failed locally because installed dependencies were incomplete (`bcrypt` and `express-rate-limit` were missing from `server/node_modules` even though they are declared).

Required changes:
- Run `npm ci` in `server/` on clean machines/CI.
- Add CI checks for root unit tests, server tests, server build, and mobile web build.
- Document setup commands in one authoritative quickstart.

Relevant files:
- `server/package.json`
- `server/package-lock.json`
- `README.md`
- `QUICKSTART.md`

### Ignore local Claude worktrees in Jest

Root unit tests pass but Jest reports haste-map collisions because `.claude/worktrees` contains copied `package.json` files.

Required changes:
- Add `.claude/` or `.claude/worktrees/` to Jest ignore patterns.
- Ensure test discovery only scans app source and tests.

Relevant files:
- `jest.unit.config.js`
- `jest.config.js`

### Keep Prisma client generation in the workflow

The Prisma schema includes newer models and fields, but generated client types can become stale.

Required changes:
- Run `npx prisma generate` after schema or migration changes.
- Add `prisma generate` before server build in CI.
- Consider a postinstall script if it does not slow local installs too much.

Relevant files:
- `server/prisma/schema.prisma`
- `server/package.json`
- `server/Dockerfile`

## P1 - Backend Correctness

### Make optional auth truly optional

Routes using `optionalAuth` can fail public reads when a stale or invalid bearer token is present, because the helper delegates to `authenticate`, which can forward errors to Express.

Required changes:
- Refactor optional auth so invalid tokens are ignored for public endpoints.
- Keep real errors for protected endpoints.
- Add tests for public mosque detail/list requests with invalid, expired, and missing tokens.

Relevant files:
- `server/src/middleware/auth.ts`
- `server/src/routes/mosques.ts`
- `server/src/routes/submissions.ts`

### Add stronger account deletion semantics

Account deletion is currently a soft delete plus cleanup of some dependent state. The policy and code should be made fully consistent.

Required changes:
- Reject future sign-ins for deleted users.
- Decide whether email/password re-registration should restore, recreate, or block deleted accounts.
- Ensure public attribution uses "Deleted user" and never leaks deleted profile details.
- Add tests for sign-in, protected requests, submissions, suggestions, and favorites after deletion.

Relevant files:
- `server/src/routes/users.ts`
- `server/src/routes/auth.ts`
- `privacy.html`
- `delete-account.html`

### Add rate limits to auth and account recovery surfaces

Auth and account-deletion request endpoints should have explicit abuse controls.

Required changes:
- Add rate limits for register, login, Google exchange, and account deletion requests.
- Prefer per-email plus per-IP limits where appropriate.
- Ensure rate limit responses do not enable account enumeration.

Relevant files:
- `server/src/routes/auth.ts`
- `server/src/routes/accountDeletion.ts`
- `server/src/middleware/rateLimit.ts`

### Audit raw SQL and geospatial assumptions

Nearby search depends on PostGIS functions and a populated `location` column.

Required changes:
- Confirm migrations always create the PostGIS extension and geospatial indexes.
- Add tests or migration checks for `location` population.
- Document the production database requirements clearly.

Relevant files:
- `server/src/routes/mosques.ts`
- `server/prisma/migrations/`
- `database/schema.sql`

## P1 - Mobile And Release Readiness

### Verify Android release signing and versioning

The mobile Android app is configured with `versionCode 1` and `versionName 1.0`.

Required changes:
- Define release versioning rules.
- Ensure Play Store builds use a real release keystore from gitignored config.
- Document the exact build command for AAB generation.
- Add a pre-release checklist item for incrementing `versionCode`.

Relevant files:
- `mobile/android/app/build.gradle`
- `PLAY-STORE-CHECKLIST.md`
- `mobile/README.md`

### Revisit exact alarm permission

The Android app declares `SCHEDULE_EXACT_ALARM`. This may require careful Play policy justification and user-facing behavior.

Required changes:
- Confirm whether prayer reminders require exact alarms or can use inexact notifications.
- Document the permission rationale for Play review.
- Test behavior when the user denies alarms/reminders.

Relevant files:
- `mobile/android/app/src/main/AndroidManifest.xml`
- `playstore-kit/compliance/permissions-audit.md`

### Replace hard-coded tunnel configuration

The frontend config hard-codes a Cloudflare tunnel URL for `trycloudflare.com` hosts. That URL is likely temporary and environment-specific.

Required changes:
- Move tunnel/API endpoint configuration to an environment-specific file or documented local override.
- Avoid committing personal or expired tunnel URLs.
- Ensure mobile native bridge and web config agree on production API routing.

Relevant files:
- `js/config.js`
- `mobile/native-bridge.js`
- `mobile/capacitor.config.ts`

## P2 - Frontend Product Correctness

### Finish email/password UI

The server supports email/password registration and login, but the main login modal still presents a one-field email form with copy implying "No password" local-deploy mode.

Required changes:
- Add complete email/password register and login flows.
- Update validation, error messages, and copy.
- Decide whether dev-auth email-only mode should remain visible outside local development.

Relevant files:
- `index.html`
- `js/app.js`
- `js/api.js`
- `server/src/routes/auth.ts`

### Improve auth state handling

The frontend stores app JWTs in `localStorage`. This is simple but increases exposure if an XSS bug is introduced.

Required changes:
- Audit all DOM rendering for XSS risk.
- Consider shorter token lifetimes plus refresh, or secure cookie auth if the deployment model supports it.
- Clear stale tokens when protected requests return 401.

Relevant files:
- `js/auth-exchange.js`
- `js/api.js`
- `js/app.js`

### Harden dynamic rendering

Most modern component rendering uses text nodes, but there are still several `innerHTML` assignments across active and legacy frontend files.

Required changes:
- Confirm every `innerHTML` assignment uses static markup only.
- Replace dynamic HTML interpolation with DOM node creation or text assignment.
- Consider removing or clearly freezing legacy frontend files if they are not shipped.

Relevant files:
- `js/app.js`
- `js/components.js`
- `js/app.legacy.js`
- `js/components.legacy.js`

### Improve offline and cache behavior

The app opportunistically caches mosque data, but offline behavior is not documented as a complete product capability.

Required changes:
- Define what should work offline: recent mosque detail, favorite mosques, reminders, language, and cached schedules.
- Add stale-data indicators where cached timings are shown.
- Add tests for network failure and fallback cache behavior.

Relevant files:
- `js/api.js`
- `js/state.js`
- `js/reminders.js`

## P2 - Documentation

### Rewrite README and Quickstart

The root README and quickstart describe an older frontend-only Google Maps demo. The current app uses Leaflet, a backend API, Prisma/PostGIS, auth, mobile shells, push notifications, and Play Store compliance assets.

Required changes:
- Replace frontend-only setup with current web, server, database, and mobile setup.
- Document ports consistently.
- Document required environment variables.
- Move outdated demo content to an archive if still useful.

Relevant files:
- `README.md`
- `QUICKSTART.md`
- `DEPLOYMENT.md`
- `PROJECT-OVERVIEW.md`

### Align policy pages with actual behavior

Policy pages are mostly detailed, but they should stay aligned with code as deletion and auth behavior changes.

Required changes:
- Update privacy wording after deleted-user auth is fixed.
- Clarify retained vs deleted data in account deletion flows.
- Ensure Play Store data safety documentation matches implementation.

Relevant files:
- `privacy.html`
- `terms.html`
- `delete-account.html`
- `PLAY-STORE-CHECKLIST.md`
- `playstore-kit/`

### Separate historical plans from current required work

The repository has multiple planning and implementation documents from different stages. Some conflict with the current app state.

Required changes:
- Mark historical documents as archived or superseded.
- Keep one current architecture document and one current release checklist.
- Link this required improvements document from the main README.

Relevant files:
- `IMPLEMENTATION-PLAN.md`
- `IMPLEMENTATION-GUIDE.md`
- `IMPROVEMENTS.md`
- `FEATURES.md`
- `ARCHITECTURE.md`

## P3 - Codebase Hygiene

### Decide which app shells are active

The repo contains a native Compose Android app under `android/` and a Capacitor mobile app under `mobile/`. It is not immediately clear which is the primary product.

Required changes:
- Declare the active mobile target in README and architecture docs.
- Archive or clearly label inactive shells.
- Avoid maintaining duplicated app concepts without ownership.

Relevant directories:
- `android/`
- `mobile/`

### Keep generated artifacts out of review scope

Generated files and build output are present locally, including Gradle output, coverage reports, `node_modules`, play store zip assets, and `.claude/worktrees`.

Required changes:
- Confirm generated files are ignored.
- Remove generated artifacts from commits unless intentionally versioned.
- Add cleanup instructions for local review/build output.

Relevant paths:
- `node_modules/`
- `server/coverage/`
- `android/.gradle/`
- `android/app/build/`
- `mobile/android/app/build/`
- `.claude/worktrees/`
- `takbeertime-playstore-kit.zip`

### Standardize naming

The codebase uses both "Jamat" and "Takbeer Time" naming. Some package descriptions still use older wording.

Required changes:
- Define the product name and internal package naming conventions.
- Update docs, package descriptions, comments, and visible UI copy where needed.
- Avoid renaming stable Android package IDs unless intentionally doing a store migration.

Relevant files:
- `package.json`
- `server/package.json`
- `mobile/package.json`
- `README.md`
- `ARCHITECTURE.md`

## Suggested Execution Order

1. Fix deleted-user auth and sensitive `/users/me` response.
2. Fix server build/test reliability and CI.
3. Rotate/restrict Firebase config and document release secrets.
4. Update README/quickstart so future setup is reproducible.
5. Finish email/password UI and stale-token handling.
6. Complete mobile release checklist and permission review.
7. Archive or mark superseded historical docs.
