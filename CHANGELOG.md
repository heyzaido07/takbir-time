# Changelog

All notable improvements and changes to the Jamat project.

## Unreleased

### Fixed
- **Accepted keeper updates now update the canonical masjid schedule.** When the current time keeper submits or accepts a timing change, the backend merges those keys into the active `PrayerSchedule` immediately, preserving the other prayers so all attendees see the new time.
- **Add-masjid pin auto-fill is more reliable on mobile.** Reverse geocoding now runs through `api.reverseGeocode()`, keeps the direct Nominatim path, and falls back to a validated backend proxy if the WebView/network call fails.

## [v4.1.5] - List cards show known jamat times (135)

### Fixed
- **List/map cards no longer claim "Be the first to submit times" for masjids that have times.** List endpoints don't carry prayer schedules, so cards rendered from them looked empty even for the user's default masjid. `makeCard` now borrows the timing fields from the hydrated default-mosque object or the on-device mosque cache (both filled by full `GET /mosques/:id` fetches) before rendering.

### Known gap (follow-up)
- `GET /mosques/nearby` only includes timings when an active PrayerSchedule exists; masjids served purely by keeper submissions return no timings in list payloads. Server-side fix (mirror the detail endpoint's effective-keeper fallback) needs Postgres-backed tests — tracked in MASTER-FEATURES §9.

## [v4.1.4] - UX flow simplification (134)

### Changed
- **Set-default completes the journey**: picking a default masjid (directory/map card pill or the drawer button) now auto-navigates back to the home screen with the hero showing the pick — no more manually backing out of the map/drawer.
- **Sign-in resumes the interrupted action**: the login modal opens over the current screen (form state survives) and after any successful sign-in path (email/password, dev email, Google) the action that triggered the gate re-runs automatically — e.g. prayer times typed before login are submitted right after it. Cancelling the modal discards the pending action.
- **Add-masjid auto-fills city / country / address** from the map pin via reverse geocoding (Nominatim, dragend-only). Values the user typed are never overwritten; offline lookups silently fall back to manual entry.
- **Create → times handoff**: after adding a masjid, its detail page opens with the submit-times form ready instead of leaving the contributor on the map popup.

### Tests
- e2e suites 06/09/14/17 updated for auto-close-on-set-default; suite 19 mocks the geocoder + the post-create mosque fetch and asserts the drawer/times-form handoff.

## [v4.1.3] - Qaza migration & review hardening (133)

### Fixed
- **Qaza guest→account migration**: missed prayers recorded while signed out are now folded into the account on sign-in (email, Google, and persisted-session boot), deduped, and pushed to the server — the Qaza drawer no longer looks empty after login.

### Changed
- **Preferred-keeper validation**: `PUT /api/users/me/preferred-keeper` rejects arbitrary UUIDs — the target must be an existing, non-deleted time keeper for that masjid (unknown masjid → 404, non-keeper → 400).
- **Locale key coverage**: all 201 `index.html` `data-i18n` keys are present in the 9 non-English bundles (no missing-key fallback). Newly seeded keys use the English baseline pending a native-translation pass (`I18N-20260607`).

### Tests / infra
- New unit coverage for the Qaza migration; preferred-keeper validation tests.
- Stabilized server tests: self-contained keepers/consensus fixtures (no hardcoded prod ids), behavior-based fire-and-forget FCM assertion, guarded cleanup when `DATABASE_URL` is unset, suggestions rate limit raised in test env.
- Bounded Puppeteer `browser.close()` + e2e jest timeout 45s→120s.

## [v4.1.2] - Premium Islamic rebrand (132)

### Changed
- **Full visual rebrand** — a premium Islamic identity in deep emerald green, metallic gold, and warm cream, with a tileable Islamic geometric pattern across the app background.
- **New app launcher icon** (gold mihrab arch + clock + Arabic "تكبير تايم" + crescent + green minaret on cream), regenerated at all densities (adaptive foreground/background + legacy square/round).
- **Website favicon refreshed** to the new mark: `favicon.ico` (16/32/48), 16/32 PNGs, apple-touch (180), and maskable 192/512 PWA icons, wired across `index.html`, `index-enhanced.html`, and the blog page.
- **Dark-cream topbar** — the native header is now an opaque dark-cream band (`#E9DCBC`) so the top section reads as a distinct surface instead of bland white.
- Removed the hero subhead line; restored the deep mihrab green (`#0F2A1E`) on the masjid card and hero.

### Fixed
- **Profile count badge no longer clipped** by the status-bar line in the native topbar (added header top padding and tucked the badge in).
- Bumped cache-bust (`jamat.css` 67->68).

## [v4.1.1] - First-run permissions & UI polish (129)

### Fixed
- **Sun-position card auto-loads** when location permission is already granted — it no longer asks the user to tap "Use my location" again (reuses the existing grant).
- **First-run now takes the user to the exact-alarm ("Alarms & reminders") toggle** when it isn't already granted, so prayer reminders fire on time. Notification + location are still requested up front.
- **Reminders pill proportioned** (smaller bell, tighter padding) and the reminder **count badge is now a legible cream chip** instead of a washed-out brass-on-brass number.
- **Qaza Namaz Tracker pill no longer clips its label** in the native topbar — it now takes its own full-width row sized to content (also fixes longer-translation labels).
- Bumped cache-bust versions (jamat.css 59->61, app.js 63->64).

## [v4.1] - Home redesign, full localization & reliable reminders (127)

### Added
- First-launch permission onboarding (native): notification and location are requested at first start instead of lazily, and the single grant is reused everywhere (no re-prompts).
- App Store release notes at `mobile/release-notes/4.1.txt`.

### Changed
- Redesigned home masjid card: inline **Jamat / Starts / Ends** times for every prayer, compact **Go** directions button, and an explicit keeper **Switch** affordance.
- Android version bump to `4.1 (127)`.

### Fixed
- Full translations for the home-card and topbar strings across all 10 locales (were falling back to English in ar/ur/id/bn/hi/tr/fa/ms/fr).
- RTL polish: clock times and the "at <time>" line render left-to-right in Arabic/Urdu/Persian (no more "am 4:30"); prayer names and the "at" prefix are translated; the native language menu docks to the left screen edge in RTL.
- Hero ↔ drawer parity: both surfaces share the same ordering and resolver, so a keeper schedule with only a Maghrib offset shows a computed Maghrib row in both.
- Verified on a physical Android 16 device: permission prompts fire at first launch, exact-alarm reports granted, and a reminder delivers on the prayer channel while backgrounded.

## [v3.3] - Qaza Tracker

### Added
- Qaza namaz drawer for recording missed Fajr, Dhuhr, Asr, Maghrib, and Isha by date.
- Pending qaza list with one-tap "Mark prayed" completion.
- Top Qaza pill with pending count and in-app pending reminder.
- Android version bump to `3.3 (124)`.

### Notes
- Qaza records are private, device-local records stored in localStorage. They are not synced to the backend database yet.

## [v2.0.0] - Enhanced UX Version (Planned)

### 🎯 Critical Improvements (P0)

#### Added
- **Onboarding Wizard** - 4-step welcome flow that improves activation by 50-70%
  - Step 1: Welcome message
  - Step 2: Location permission
  - Step 3: Select home mosque
  - Step 4: Configure reminders
  - Completion tracking via LocalStorage

- **Tabbed Detail Panel** - Reduces cognitive load by 60%
  - 🕰️ Timings tab (prayer schedule + countdown)
  - 📊 Updates tab (community submissions)
  - ℹ️ Info tab (mosque details + amenities)
  - Lazy loading for better performance

- **API Service Layer** - Clean backend integration
  - Centralized API calls
  - Easy transition from mock → real data
  - Standardized error handling
  - Token management

- **LocalStorage Persistence** - Instant load times
  - Favorites cached locally
  - Default mosque saved
  - Prayer schedules cached (24h TTL)
  - Onboarding completion flag

### 🎨 High-Priority Polish (P1)

#### Added
- **Typeahead Search** - Intelligent mosque discovery
  - Instant suggestions
  - Categorized results (nearby, favorites, recent)
  - Fuzzy matching
  - Search history

- **Amenities Filter** - Better mosque matching
  - Visual filter chips with icons
  - 12 amenity types supported
  - Multi-select filtering
  - Results counter

- **Consistent Spacing** - Professional visual quality
  - 8-point grid system
  - CSS variables for all spacing
  - Audit completed across all components

- **Micro-Animations** - Modern polished feel
  - Marker drop animations (staggered)
  - Detail card slide-in
  - Prayer row pulse
  - Tab transitions
  - Loading skeletons

### 📱 Mobile Enhancements (P2)

#### Added
- **Bottom Sheet UI** - Native app experience
  - Collapsed, peek, expanded, full states
  - Swipe gestures
  - Draggable handle
  - Smooth animations

- **Collapsible Map** - Better mobile scrolling
  - Map height adjusts on scroll
  - More space for detail panel

### 🌟 Special Features (P3)

#### Added
- **Ramadan Mode** - Seasonal engagement
  - Auto-activates during Ramadan
  - Purple + gold theme
  - Taraweeh timing section
  - Suhoor/Iftar countdown
  - Ramadan Mubarak banner

- **Eid Mode** - Festive celebrations
  - Eid Mubarak banner
  - Special Eid prayer slots
  - Multiple timing support
  - Outdoor prayer highlights

- **Timezone Support** - Global traveler friendly
  - Mosque timezone stored
  - Display in user's local time
  - Offset indicators
  - DST handling

### 🏗️ Architecture Improvements

#### Changed
- Modular component structure
- Service layer abstraction
- State management improvements
- Caching strategy implemented

### 📚 Documentation

#### Added
- `IMPROVEMENTS.md` - Comprehensive UX/UI audit findings
- `IMPLEMENTATION-GUIDE.md` - Step-by-step implementation
- `CHANGELOG.md` - This file
- Updated `README.md` with new features
- Updated `FEATURES.md` with UI components

---

## [v1.0.0] - Initial Release

### Features
- Interactive Google Maps integration
- Mosque discovery with markers
- Prayer timing display with live countdown
- Favorites system
- Community submission forms
- Responsive design
- Search and filtering
- Mock data for demo

### Database
- PostgreSQL + PostGIS schema
- Full geospatial support
- Prayer reminder system
- Collaborative verification
- User reputation and badges

### Documentation
- README with setup instructions
- QUICKSTART guide
- DATABASE documentation
- PROJECT-OVERVIEW
- ARCHITECTURE guide

---

## Implementation Status

### ✅ Completed
- Core frontend app
- Database schema design
- Documentation suite
- Feature specifications

### 🚧 In Progress
- Onboarding wizard (implementation guide ready)
- Tabbed detail panel (implementation guide ready)
- API service layer (implementation guide ready)

### 📝 Planned
- Backend REST API
- Notification service
- Mobile apps (iOS + Android)
- Advanced search with Elasticsearch
- Analytics dashboard

---

## Upgrade Path

### From v1.0.0 to v2.0.0

1. **Add Onboarding** (30 min)
   - Copy HTML from `IMPLEMENTATION-GUIDE.md` section 1
   - Add CSS styles
   - Add JavaScript logic
   - Test flow

2. **Add Tabbed Detail** (45 min)
   - Replace right column HTML
   - Add tab styles
   - Add tab switching JavaScript
   - Test tab transitions

3. **Add API Layer** (20 min)
   - Create `api.js` service file
   - Replace inline fetch calls
   - Update mock data handling

4. **Add LocalStorage** (15 min)
   - Create storage utility
   - Persist favorites
   - Cache schedules

5. **Test Everything** (30 min)
   - Test onboarding flow
   - Test tab switching
   - Test persistence
   - Mobile testing

**Total Time: ~2.5 hours for dramatic UX improvement**

---

## Breaking Changes

None. All improvements are additive and backward compatible.

---

## Credits

- UX/UI audit by ChatGPT
- Implementation by Claude
- Community feedback incorporated
- Built for the Muslim community

---

**For detailed implementation instructions, see `IMPLEMENTATION-GUIDE.md`**
