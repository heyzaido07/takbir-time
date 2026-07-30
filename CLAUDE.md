# Takbeer Time — Project Instructions

A crowd-sourced jamat-times directory: vanilla JS web app + Capacitor mobile app + Express/TypeScript backend, all backed by PostgreSQL with PostGIS for geospatial queries.

> Important: the old root `android/` Kotlin app was deprecated and removed. The only Android app to build, test, or deploy is the Capacitor project under `mobile/android` with package `com.takbeertime.android`.
>
> Some internal identifiers still use the original "jamat" name (for example `css/jamat.css`, localStorage keys, npm package `jamat-server`, Postgres DB `jamat`, repo dir `Jamat`). Those names are historical and do not indicate a separate active app.

---

## 🚨 MANDATORY: READ BEFORE WRITING ANY CODE 🚨

### ⛔ NO DUPLICATE CODE - SEARCH BEFORE CREATING ⛔

**BEFORE writing ANY code (functions, components, modules, types, queries):**

1. **SEARCH FIRST** — `grep -rn "function\|const\|export" js/ server/src/ mobile/` for web/backend/mobile shell
2. **USE EXISTING** — import and reuse, never recreate
3. **NEW SHARED CODE** — add to the right location, export from the index

**VIOLATION = duplicate logic anywhere in the codebase.**

---

### Pre-Code Checklist (MANDATORY)

| Creating... | Search Location | Command |
|---|---|---|
| Map / marker / search behavior | `js/app.js`, `js/components.js` | `grep -n "function\|const" js/app.js js/components.js` |
| State / favorites / filters | `js/state.js` | `grep -n "function\|const" js/state.js` |
| API call from web | `js/api.js` | `grep -n "function\|export" js/api.js` |
| Express route | `server/src/routes/` | `ls server/src/routes/ 2>/dev/null && grep -rn "router\." server/src/routes/` |
| Express middleware | `server/src/middleware/` | `ls server/src/middleware/` |
| Prisma model / migration | `server/prisma/schema.prisma` | `grep -n "^model" server/prisma/schema.prisma` |
| Zod schema (validation) | `server/src/` (search by use site) | `grep -rn "z\.\(object\|string\|number\)" server/src/` |
| Capacitor native bridge | `mobile/native-bridge.js` | `grep -n "Capacitor\|nativeReminders\|Firebase" mobile/native-bridge.js` |
| Android package config | `mobile/android/app/build.gradle`, `mobile/capacitor.config.ts` | `grep -n "applicationId\|versionName\|appId" mobile/android/app/build.gradle mobile/capacitor.config.ts` |
| Android manifest/resources | `mobile/android/app/src/main/` | `grep -rn "permission\|MainActivity\|ic_launcher" mobile/android/app/src/main/` |

---

### Where to Add NEW Shared Code

| Type of Code | Add To | Then Export From |
|---|---|---|
| Browser-side helper (formatting, time math) | new file under `js/utils.js` | `<script>` include in `index.html` + `index-enhanced.html` |
| API call from web | `js/api.js` | re-export at bottom of `js/api.js` |
| Global app state | `js/state.js` | same file |
| Express route handler | `server/src/routes/<resource>.ts` | mount in `server/src/index.ts` |
| Express middleware | `server/src/middleware/<name>.ts` | import at use site |
| Validation schema | colocate with the route that uses it | export named const |
| Prisma model change | `server/prisma/schema.prisma` | run `npm run prisma:migrate` (creates migration file) |
| Capacitor/native wrapper behavior | `mobile/native-bridge.js` or `mobile/capacitor.config.ts` | run `npm run build && npx cap sync android` from `mobile/` |
| Android native config/resource | `mobile/android/app/src/main/` or `mobile/android/app/build.gradle` | build from `mobile/android/` |

**When extending instead of creating:** if a function/component does 80% of what you need, modify it (with care for callers) instead of forking a near-duplicate.

---

### Post-Implementation Checklist

After completing ANY task, verify:
- [ ] No duplicate function created (searched first, reused or extended)
- [ ] If `index.html` script tags changed, considered whether `index-enhanced.html` (a separate self-contained UI) needs the same treatment
- [ ] If a feature was created, changed, removed, renamed, or behaviorally redefined, updated `MASTER-FEATURES-AND-REQUIREMENTS.md` in the same change
- [ ] Backend changes have a Zod schema validating request inputs
- [ ] Geospatial queries use PostGIS functions (`ST_DWithin`, `ST_Distance`), not haversine in JS
- [ ] Prisma schema change has a migration committed (`server/prisma/migrations/`)
- [ ] Capacitor changes are validated through `mobile`: web snapshot rebuilt, `npx cap sync android` run, Android build checked when native/mobile packaging is touched
- [ ] If new shared code added: placed correctly, documented in `ARCHITECTURE.md` if it's load-bearing

---

## Tech Stack

### Web (frontend)
- Vanilla JavaScript (no framework, no build step)
- Google Maps JavaScript API + Places API
- **Two parallel UIs (not variants of each other):**
  - `index.html` — modular, loads `js/{config,auth,state,api,components,app}.js`. **This is the canonical app.** All ongoing frontend work goes here.
  - `index-enhanced.html` — self-contained glassmorphism UI with one inline `<script>`. Does **not** load the `js/` modules. Treat as a design prototype; don't try to keep it in lockstep.
- Files: `js/config.js` (backend URL, feature flags), `js/auth.js` (Firebase web auth wrapper), `js/state.js` (state + localStorage), `js/api.js` (real fetch client w/ mock fallback), `js/components.js`, `js/app.js`, `css/styles.css`

### Backend (`server/`)
- Node.js + Express 4 + TypeScript 5
- Prisma 5.8 ORM
- Firebase Admin SDK for auth (verifies Firebase ID tokens)
- Zod for request validation
- Jest + Supertest for tests
- Entry: `server/src/index.ts` (port 3001 by default)

### Database
- **PostgreSQL with PostGIS 3.4.0** (also `pg_trgm`, `uuid-ossp`)
- Geospatial column: `Mosque.location` is `geography(Point, 4326)` (defined as `Unsupported(...)` in Prisma — write raw SQL for spatial queries)
- `Mosque.latitude` / `longitude` mirrored as Float for easy app-side use, but **distance queries must use PostGIS** for correctness and index usage

### Mobile (`mobile/`)
- Capacitor shell around the canonical vanilla-JS web app
- Android package: `com.takbeertime.android`
- Web sources remain at repo root (`index.html`, `js/`, `css/`, `i18n/`)
- `mobile/scripts/build-web.sh` snapshots those sources into `mobile/www/`
- `mobile/native-bridge.js` wires native geolocation, notifications, auth, status bar, and splash behavior

---

## Run / Build

### Frontend (no build)
```bash
# from repo root
python -m http.server 8000
# then open http://localhost:8000  (or /index-enhanced.html)
```
First-time setup: paste your Google Maps API key into the `<script src="https://maps.googleapis.com/...key=YOUR_API_KEY...">` line in **both** `index.html` and `index-enhanced.html`.

### Backend
```bash
cd server
npm install
npm run prisma:generate
npm run prisma:migrate     # creates/applies migrations
npm run dev                # nodemon, port 3001
npm test                   # jest with coverage
```

### Android / Capacitor
```bash
cd mobile
npm install
npm run build
npx cap sync android
cd android
./gradlew assembleDebug
```

---

## Environment Variables

| File | Purpose |
|---|---|
| `.env.example` (root) | Documents the Google Maps API key (the key itself goes into `index.html`, not a runtime env) |
| `server/.env.example` | Backend env: `DATABASE_URL`, `FIREBASE_*`, `ALLOWED_ORIGINS`, optional `SENTRY_DSN`, `EMAIL_API_KEY` |
| `mobile/android/app/google-services.json` | Firebase config for `com.takbeertime.android` |
| `mobile/android/keystore.properties` (gitignored) | Release signing config for local builds |

**Critical backend vars:**
- `DATABASE_URL` — must point at a PostgreSQL with PostGIS available (`CREATE EXTENSION postgis;`)
- `FIREBASE_PROJECT_ID`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL` — required to verify auth tokens
- `ALLOWED_ORIGINS` — CORS whitelist; must include the web app's origin

---

## ⛔ Database Rules

### PostgreSQL + PostGIS only — no SQLite, ever

- The schema depends on PostGIS (`geography(Point, 4326)`), `pg_trgm` (fuzzy search), and `uuid-ossp` — none of these exist in SQLite
- Do not propose SQLite as a "fallback for local dev." Run Postgres locally (Docker is fine) and `CREATE EXTENSION postgis;`
- Do not change `provider` in `schema.prisma`

### Geospatial query rules

- "Mosques near me" → `ST_DWithin(location, ST_MakePoint($lng, $lat)::geography, $radiusMeters)`
- "Sort by distance" → `ORDER BY location <-> ST_MakePoint($lng, $lat)::geography`
- Do **not** load all mosques and compute haversine in Node — it bypasses the GiST index and won't scale
- Because `location` is `Unsupported(...)` in Prisma, use `prisma.$queryRaw` for spatial queries

### Migrations

- Schema changes must go through `npm run prisma:migrate` so a migration file is generated and committed
- Never edit a committed migration; create a new one

---

## API Conventions

### Response format

Paginated endpoints return:
```ts
{
  data: T[],
  pagination: {
    page: number,        // 1-indexed
    limit: number,
    totalCount: number,  // not "total"
    totalPages: number,  // Math.ceil(totalCount / limit)
    hasMore: boolean,
  }
}
```

### Pagination param parsing (always validate)
```ts
const page  = Math.max(1, parseInt(req.query.page  as string ?? '1',  10) || 1)
const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string ?? '20', 10) || 20))
```

### Validation
Every route that accepts a body or query params must validate with Zod before touching Prisma. Errors → 400 with the Zod issue list.

### Auth
Protected routes verify a Firebase ID token via the auth middleware in `server/src/middleware/`. Routes that mutate user-owned data must check ownership against the verified `firebaseUid` → `User.id`.

---

## Frontend Conventions

- **`index.html` is canonical.** `index-enhanced.html` is a parallel self-contained UI; don't assume changes propagate.
- **No build step.** Don't introduce webpack/vite/etc. without an explicit decision — the project's "open and run" simplicity is a feature.
- **State lives in `js/state.js`.** Don't sprinkle global mutable state across `app.js` / `components.js`.
- **API calls go through `js/api.js`.** No `fetch()` directly inside `app.js` or `components.js`. The client auto-injects the Firebase ID token from `js/auth.js`.
- **Backend URL & feature flags live in `js/config.js`.** Toggle `useMockData` to false once a backend is reachable; until then `js/api.js` falls back to the seed data in `js/state.js`.
- **Map markers/icons** are created in `app.js` — extend the existing factory functions, don't write parallel ones.
- **Field-shape contract.** Backend returns `latitude`/`longitude`, `prayerSchedules[0].timings.dhuhr`. Frontend code expects `coordinates.{lat,lng}` and `defaultJamaatTimings.zuhr`. The translation lives in `js/api.js` (`adaptMosque`/`extractTimings`) — change it there, not at every call site.

---

## Mobile / Capacitor Conventions

- **Do not edit or recreate a root `android/` project.** The old Kotlin app is gone; all Android work belongs under `mobile/android`.
- **UI changes usually belong in the canonical web app** (`index.html`, `js/`, `css/`, `i18n/`). Capacitor packages those files into the native app.
- **Native behavior belongs in the wrapper** (`mobile/native-bridge.js`, `mobile/capacitor.config.ts`, `mobile/android/app/src/main/`).
- **After mobile-facing changes:** run `cd mobile && npm run build && npx cap sync android`; run Gradle from `mobile/android` when native packaging or Android behavior is affected.

---

## Testing

### Backend
- `cd server && npm test` runs Jest with coverage
- New routes: add a Supertest spec that exercises happy path + validation failure + auth-required path
- Tests run against a real Postgres (PostGIS required) — do not mock Prisma to avoid the dependency

### Frontend
- `npm run test:unit` runs the browser-side Jest unit suite
- `npm run test:e2e` runs the Puppeteer/Jest browser regression suite
- Add or update e2e coverage for user-visible workflow changes so regressions are caught before merge

### Android / Capacitor
- Web/mobile unit tests: `npm run test:unit` from repo root
- Android build: `cd mobile/android && ./gradlew assembleDebug`
- Instrumented tests, if needed: `cd mobile/android && ./gradlew connectedAndroidTest`

---

## Documentation Hygiene

- `MASTER-FEATURES-AND-REQUIREMENTS.md` — canonical product requirements and feature inventory. Always read it before feature work, and update it in the same change whenever you create, change, remove, rename, or materially redefine a feature or user-facing workflow.
- `ARCHITECTURE.md` — read before significant changes; update if you alter the data model, add a new service tier, or change the deploy topology
- `FEATURES.md` / `WHATS-NEW.md` / `CHANGELOG.md` — keep in step when shipping user-visible features
- `IMPLEMENTATION-PLAN.md` / `IMPLEMENTATION-GUIDE.md` — living docs for in-flight work; mark items done as you ship them

---

## Working Style

- **Bug fixes are autonomous.** Logs, errors, failing tests → fix them without asking how. Don't pause for confirmation on routine work (file edits, bash commands, migrations against a local dev DB).
- **Risky actions still need confirmation.** Anything destructive on shared state — production DB, force pushes, removing migrations, dropping data — ask first.
- **Never use `killall node` / `pkill node`.** It will kill the agent's own session. Kill specific PIDs.
- **Verify before claiming done.** Run the relevant test command, hit the endpoint with `curl`, or load the page in a browser. "It compiles" is not "it works."
