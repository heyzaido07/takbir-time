# Jamat App - MVP Implementation Plan

## Executive Summary

**Goal**: Ship production-ready MVP with real backend in 8-10 weeks
**Team**: 1-2 full-time developers
**Approach**: Pragmatic backend-first with balanced quality improvements
**Key Decision**: Keep vanilla JavaScript frontend, no React migration for MVP

---

## Strategic Overview

### Why This Plan?

Based on analysis of your codebase and priorities:

1. **26 features already implemented on frontend** - Don't rebuild, integrate
2. **Zero backend exists** - This is the critical blocker
3. **Quality gaps manageable** - Add validation/error handling incrementally
4. **React migration = 9 weeks overhead** - Not justified for MVP

### What This Plan Delivers

✅ **Fully functional backend** with PostgreSQL + PostGIS + Firebase Auth
✅ **All 26 frontend features** connected to real data
✅ **Production deployment** on Vercel + Render
✅ **Essential quality** - validation, error handling, critical tests
✅ **Community features** - submissions, verification, notifications

---

## Phase 1: Backend Foundation (Weeks 1-2)

### Week 1: Infrastructure Setup

**Backend Stack**
```
Node.js + Express
Prisma ORM
PostgreSQL (Supabase) with PostGIS extension
Firebase Admin SDK (server-side auth)
```

**Tasks**:
1. Initialize Express project with TypeScript
2. Set up Supabase PostgreSQL instance with PostGIS
3. Configure Prisma schema based on `database/schema.sql`
4. Implement Firebase Admin SDK for token verification
5. Create middleware: auth, error handling, request validation
6. Set up environment configuration (dev/staging/prod)

**Deliverable**: Backend server running locally with database connection

**Files to Create**:
- `server/package.json` - Dependencies
- `server/prisma/schema.prisma` - Database schema
- `server/src/index.ts` - Express app entry point
- `server/src/middleware/auth.ts` - Firebase token verification
- `server/src/middleware/errorHandler.ts` - Centralized error handling
- `server/.env.example` - Environment template

### Week 2: Core Data Models & Seed Data

**Tasks**:
1. Run Prisma migrations to create tables
2. Add PostGIS spatial indexes for geoqueries
3. Create seed script with 20-30 real mosques (expand from current 6)
4. Implement data validation schemas (Zod)
5. Write database utilities for spatial queries
6. Basic health check endpoint

**Deliverable**: Database populated with realistic data, ready for API development

**Files to Create**:
- `server/prisma/migrations/` - Database migrations
- `server/prisma/seed.ts` - Seed data script
- `server/src/validation/schemas.ts` - Zod validation schemas
- `server/src/utils/spatial.ts` - PostGIS query helpers

---

## Phase 2: Core API Development (Weeks 3-4)

### Week 3: Discovery & Details APIs

**Endpoints to Build**:

```typescript
GET  /api/mosques/nearby
  ? lat={number}&lng={number}&radiusKm={number}
  → Returns mosques within radius, sorted by distance

GET  /api/mosques/:id
  → Returns full mosque details with prayer times

GET  /api/mosques/:id/prayer-times
  ? date={ISO-date}
  → Returns prayer schedule for specific date
```

**Tasks**:
1. Implement spatial query: `ST_DWithin` for radius search
2. Calculate distances with `ST_Distance`
3. Join with prayer schedules
4. Add pagination (limit/offset)
5. Add response caching headers
6. Write input validation for all endpoints
7. Add error handling for invalid coordinates

**Deliverable**: Frontend can discover mosques and view details with real data

**Files to Create**:
- `server/src/routes/mosques.ts` - Mosque endpoints
- `server/src/controllers/mosqueController.ts` - Business logic
- `server/src/services/mosqueService.ts` - Database queries

### Week 4: User Features APIs

**Endpoints to Build**:

```typescript
POST   /api/auth/verify
  → Verify Firebase token, create/update user

GET    /api/users/favorites
  → Get user's favorite mosques

POST   /api/users/favorites/:mosqueId
  → Add mosque to favorites

DELETE /api/users/favorites/:mosqueId
  → Remove from favorites

POST   /api/users/default-mosque
  { mosqueId: string }
  → Set default mosque

GET    /api/users/reminders
  → Get prayer reminder preferences

PUT    /api/users/reminders
  → Update reminder settings
```

**Tasks**:
1. Implement user authentication middleware
2. Create user on first Firebase sign-in
3. CRUD operations for favorites
4. Reminder preferences storage
5. Add authorization checks (user can only modify own data)

**Deliverable**: User authentication, favorites, and reminders fully functional

**Files to Create**:
- `server/src/routes/users.ts` - User endpoints
- `server/src/controllers/userController.ts` - User logic
- `server/src/services/authService.ts` - Auth utilities

---

## Phase 3: Frontend Integration (Weeks 5-6)

### Week 5: API Integration Layer

**Tasks**:
1. Update `js/api.js` to replace ALL mock data with real API calls
2. Add fetch wrapper with:
   - Firebase ID token injection
   - Error handling with user-friendly messages
   - Retry logic for network failures
   - Loading states
3. Update `js/state.js` to work with API data
4. Add form validation to all user inputs:
   - Radius slider (1-50km)
   - Location inputs (valid coordinates)
   - Reminder minutes (1-120)
5. Add comprehensive error handling:
   - Network errors → "Check your connection"
   - Auth errors → Redirect to sign-in
   - Not found → "Mosque not found"
   - Server errors → "Something went wrong"
6. Add loading spinners for async operations

**Deliverable**: Frontend fully integrated with backend, no more mock data

**Files to Modify**:
- `js/api.js` - Complete rewrite with real fetch calls
- `js/state.js` - Remove mock data, use API responses
- `js/app.js` - Add loading states, error handling
- `css/styles.css` - Add loading spinner styles

### Week 6: Quality & Polish

**Tasks**:
1. **Input Validation**:
   - Validate all form inputs before submission
   - Show inline validation errors
   - Prevent invalid API requests

2. **Error States**:
   - Empty states for no results
   - Error messages for failed requests
   - Retry buttons for recoverable errors

3. **Loading States**:
   - Skeleton screens for mosque list
   - Spinners for button actions
   - Disable buttons during async operations

4. **Edge Cases**:
   - Handle GPS permission denied
   - Handle no mosques in radius
   - Handle expired auth tokens
   - Handle offline mode gracefully

5. **Performance**:
   - Add request debouncing for search
   - Implement response caching
   - Lazy load Google Maps only when needed

**Deliverable**: Production-ready frontend with robust error handling

**Files to Create**:
- `js/validation.js` - Client-side validation utilities
- `js/errors.js` - Error handling and user messages

---

## Phase 4: Community Features (Weeks 7-8)

### Week 7: Timing Submissions

**Endpoints to Build**:

```typescript
POST /api/mosques/:id/submissions
  { prayerName, timingType, proposedTime, evidence?, notes? }
  → Submit new timing

GET /api/mosques/:id/submissions
  → View pending submissions for mosque

POST /api/submissions/:id/vote
  { vote: 'approve' | 'reject' }
  → Vote on submission (requires verification rights)
```

**Tasks**:
1. Implement submission creation with validation
2. Add evidence upload (optional images/documents)
3. Build voting system with reputation checks
4. Auto-approve logic: 3+ approvals from verified users
5. Send email notifications to mosque contributors
6. Add rate limiting (5 submissions per user per day)

**Deliverable**: Users can submit and vote on prayer time corrections

**Files to Create**:
- `server/src/routes/submissions.ts` - Submission endpoints
- `server/src/services/votingService.ts` - Voting logic
- `server/src/services/notificationService.ts` - Email notifications

### Week 8: Verification System

**Endpoints to Build**:

```typescript
POST /api/verification/request
  { mosqueId, evidenceUrls[], notes }
  → Request verification rights for mosque

GET /api/verification/requests
  → Admin view of pending requests

POST /api/verification/requests/:id/approve
  → Approve verification request
```

**Tasks**:
1. Implement verification request flow
2. Evidence validation (photos of official schedules)
3. Admin approval interface (basic)
4. Grant verification rights on approval
5. Track reputation scores (approve/reject ratio)
6. Add verified badge to user contributions

**Deliverable**: Community-driven verification system functional

**Files to Create**:
- `server/src/routes/verification.ts` - Verification endpoints
- `server/src/services/reputationService.ts` - Reputation tracking

---

## Phase 5: Testing & Deployment (Weeks 9-10)

### Week 9: Critical Path Testing

**Not comprehensive test coverage** - Focus on critical user flows only:

**Backend Tests** (Jest + Supertest):
1. Auth flow: Token verification, user creation
2. Mosque discovery: Radius search with various coordinates
3. Favorites: Add/remove, prevent duplicates
4. Submissions: Create, vote, auto-approve logic
5. Validation: Reject invalid inputs

**Target**: ~60% coverage on critical paths only

**Frontend Tests** (Cypress E2E):
1. User can sign in with Google
2. User can discover nearby mosques
3. User can add/remove favorites
4. User can view prayer times
5. User can submit timing correction
6. Responsive layout works on mobile

**Target**: 6-8 critical user journeys tested

**Tasks**:
1. Set up Jest for backend unit tests
2. Write tests for critical endpoints
3. Set up Cypress for E2E tests
4. Write smoke tests for main features
5. Fix any bugs discovered during testing

**Deliverable**: Core functionality verified with automated tests

**Files to Create**:
- `server/tests/` - Backend test suite
- `cypress/e2e/` - Frontend E2E tests

### Week 10: Deployment & Launch Prep

**Infrastructure**:
- **Frontend**: Vercel (free tier)
  - Automatic HTTPS
  - Global CDN
  - Deploy from Git main branch

- **Backend**: Render (free tier initially, $7/mo for production)
  - API endpoint: `https://jamat-api.onrender.com`
  - Auto-deploy from Git
  - Environment variables managed in dashboard

- **Database**: Supabase (free tier, 500MB)
  - Automatic backups
  - PostGIS enabled
  - Connection pooling

**Tasks**:
1. Set up Vercel project, connect to GitHub repo
2. Set up Render web service for backend
3. Configure Supabase production database
4. Run migrations on production DB
5. Seed production database with real data
6. Configure environment variables in all platforms
7. Set up Firebase project for production
8. Add custom domain (optional)
9. Configure CORS for production domains
10. Set up error monitoring (Sentry free tier)
11. Create deployment checklist
12. Perform production smoke test
13. Write deployment documentation

**Deliverable**: App live in production, accessible to users

**Files to Create**:
- `vercel.json` - Vercel configuration
- `server/Dockerfile` - Render deployment config
- `DEPLOYMENT.md` - Deployment guide

---

## Risk Mitigation

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| PostGIS queries slow with scale | Medium | High | Add spatial indexes, implement caching, pagination |
| Firebase costs exceed budget | Low | Medium | Use free tier (10K users/month), monitor usage |
| API rate limits hit | Medium | Low | Implement rate limiting early, add caching |
| Third-party service downtime | Low | High | Add fallback for maps, graceful degradation |

### Schedule Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Integration bugs delay timeline | High | Medium | Budget week 6 for bug fixing, daily testing |
| Developer availability issues | Medium | High | Document everything, modular architecture |
| Scope creep from new features | High | Medium | Strict "MVP only" rule, defer enhancements |

---

## What's NOT in MVP (Defer to v1.1+)

To ship in 10 weeks, these features are explicitly deferred:

❌ **Push notifications** - Use email for now
❌ **Offline mode** - Require internet connection
❌ **Advanced search filters** - Just radius + text search
❌ **Mosque admin dashboard** - Manual verification for MVP
❌ **Multi-language support** - English only
❌ **Mobile apps** - PWA only
❌ **Social features** - No user profiles, comments, or follows
❌ **Analytics dashboard** - Basic logging only
❌ **Automated tests for all edge cases** - Critical paths only

These can be added after MVP launch based on user feedback.

---

## Success Metrics

### Week 10 Launch Criteria

Must have ALL of these to launch:

✅ User can sign in with Google
✅ User can discover mosques within custom radius
✅ User can view prayer times for any date
✅ User can favorite mosques
✅ User can set default mosque
✅ User can configure prayer reminders
✅ User can submit timing corrections
✅ Verified users can vote on submissions
✅ No critical bugs in production
✅ All endpoints have error handling
✅ All forms have validation
✅ Site loads in <3 seconds
✅ Works on mobile browsers

### Post-Launch (First Month)

Track these to measure success:

- **50+ users** signed in
- **200+ mosques** in database (expand beyond mock 6)
- **10+ timing submissions** from community
- **<5 critical bugs** reported
- **<500ms** average API response time
- **99% uptime** for backend

---

## Resource Requirements

### Development Tools (All Free Tier)

- **Code**: VS Code + Git + GitHub
- **Backend**: Node.js 18+, PostgreSQL 14+
- **Frontend**: Current setup (no build tools needed)
- **Testing**: Jest, Cypress, Supertest
- **Deployment**: Vercel, Render, Supabase
- **Monitoring**: Sentry (free tier)
- **Auth**: Firebase Authentication (free tier)

### Estimated Costs (Monthly)

- **Render**: $0 (free tier) → $7/mo when scaling
- **Supabase**: $0 (free tier up to 500MB)
- **Vercel**: $0 (free tier)
- **Firebase**: $0 (under 10K users/month)
- **Total**: **$0/month** for MVP, **~$25/month** at scale

---

## Daily Workflow (Recommended)

For 1-2 developer team:

### Developer 1 (Backend Focus)
- **Weeks 1-4**: Build all API endpoints
- **Weeks 5-6**: Support frontend integration, fix bugs
- **Weeks 7-8**: Community features
- **Weeks 9-10**: Backend tests, deployment

### Developer 2 (Frontend Focus)
- **Weeks 1-4**: Start with design polish, prepare integration plan
- **Weeks 5-6**: API integration, validation, error handling
- **Weeks 7-8**: Community feature UI
- **Weeks 9-10**: E2E tests, documentation

### Daily Standup (15 min)
1. What did I complete yesterday?
2. What am I working on today?
3. Any blockers?

### Weekly Review (30 min)
1. Demo completed features
2. Review code quality
3. Adjust timeline if needed

---

## Code Quality Standards (Balanced)

Not over-engineering, but maintaining good practices:

### Must Have
✅ Meaningful variable/function names
✅ Error handling for all async operations
✅ Input validation on all endpoints
✅ No hardcoded credentials (use env vars)
✅ Git commits with clear messages
✅ Basic comments for complex logic

### Nice to Have (Not Required for MVP)
⚠️ Comprehensive JSDoc comments
⚠️ 100% test coverage
⚠️ Extensive refactoring of existing code
⚠️ Strict TypeScript (backend only)
⚠️ Code reviews (if solo developer)

### Never
❌ Premature abstraction
❌ Unused helper functions
❌ Over-designed architecture
❌ Feature flags for simple toggles

---

## Migration from Mock to Real Data

### Current State Analysis

**6 hardcoded mosques** in `js/state.js`:
- Al-Falah Islamic Centre, Brampton
- Toronto Masjid, Toronto
- Islamic Foundation of Toronto
- Masjid Dar-us-Salaam, North York
- Islamic Society of York Region, Richmond Hill
- Local Musalla, Oakville

**Current features using mock data**:
1. Mosque discovery by radius
2. Prayer times display
3. Favorites
4. Default mosque
5. Reminders
6. Distance calculations
7. Ratings (fake data)
8. Amenities (partially accurate)

### Migration Steps

**Week 5 Priority 1**: Replace mock data
1. Update `fetchNearbyMosques()` to call `GET /api/mosques/nearby`
2. Update `fetchMosqueDetails()` to call `GET /api/mosques/:id`
3. Remove `state.mosques` hardcoded array
4. Update `state.selectedMosque` to come from API

**Week 5 Priority 2**: User features
1. Replace `toggleFavorite()` to call `POST /api/users/favorites/:id`
2. Replace `setAsDefaultMosque()` to call `POST /api/users/default-mosque`
3. Store user data in `state.user` from API responses

**Week 5 Priority 3**: Prayer times
1. Replace `getPrayerScheduleForDate()` to call API
2. Update countdown timer to use real data

---

## File Structure (After Implementation)

```
Jamat/
├── index.html                     [Modified: API integration]
├── css/
│   └── styles.css                 [Modified: Loading states, error states]
├── js/
│   ├── app.js                     [Modified: Error handling, loading states]
│   ├── components.js              [Modified: Error states UI]
│   ├── state.js                   [Modified: Remove mock data]
│   ├── api.js                     [Rewritten: Real API calls]
│   ├── validation.js              [New: Client validation]
│   └── errors.js                  [New: Error handling utils]
├── server/                        [New: Backend]
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── seed.ts
│   │   └── migrations/
│   ├── src/
│   │   ├── index.ts               [Express app entry]
│   │   ├── middleware/
│   │   │   ├── auth.ts            [Firebase verification]
│   │   │   ├── errorHandler.ts
│   │   │   └── validation.ts
│   │   ├── routes/
│   │   │   ├── mosques.ts
│   │   │   ├── users.ts
│   │   │   ├── submissions.ts
│   │   │   └── verification.ts
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── utils/
│   │   └── validation/
│   └── tests/
├── cypress/                       [New: E2E tests]
│   └── e2e/
├── IMPLEMENTATION-PLAN.md         [This file]
├── DEPLOYMENT.md                  [New: Week 10]
└── README.md                      [Updated: Setup instructions]
```

---

## Getting Started (Week 1, Day 1)

### Step 1: Backend Setup

```bash
# Create server directory
mkdir server
cd server

# Initialize Node.js project
npm init -y

# Install dependencies
npm install express @prisma/client firebase-admin cors dotenv
npm install -D typescript @types/express @types/node prisma ts-node nodemon

# Initialize TypeScript
npx tsc --init

# Initialize Prisma
npx prisma init
```

### Step 2: Database Setup

1. Go to [supabase.com](https://supabase.com)
2. Create new project
3. Enable PostGIS extension in SQL editor:
   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   ```
4. Copy connection string to `.env`:
   ```
   DATABASE_URL="postgresql://..."
   ```

### Step 3: First API Endpoint

Create `server/src/index.ts`:

```typescript
import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
```

Run it:
```bash
npx ts-node src/index.ts
```

Visit: `http://localhost:3001/health`

**If you see `{"status":"ok"}` → You're on track!** 🎉

---

## Support & Questions

As you implement this plan:

1. **Stuck on PostGIS queries?** → Check `database/schema.sql` for examples
2. **API design questions?** → Review existing `js/api.js` for expected responses
3. **Frontend integration issues?** → Console log state changes
4. **Deployment problems?** → Vercel/Render have excellent docs

---

## Conclusion

This plan balances your priorities:

✅ **Quick to market**: 10 weeks to production
✅ **Real backend**: No more mock data
✅ **Quality where it matters**: Validation, error handling, tests
✅ **Pragmatic**: No over-engineering, no React migration overhead
✅ **Scalable foundation**: Can add features post-launch

**Next Steps**:
1. Review and approve this plan
2. Set up development environment (Week 1, Day 1 instructions above)
3. Start building backend foundation
4. Ship MVP in 10 weeks! 🚀
