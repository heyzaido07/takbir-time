# User Flows - Jamat App

Complete step-by-step user flows for the Jamat mosque finder app.

## Table of Contents

1. [Prayer Reminder Flow](#prayer-reminder-flow)
2. [Contribution & Verification Flow](#contribution--verification-flow)
3. [Authentication Flow](#authentication-flow)
4. [Default Mosque Flow](#default-mosque-flow)

---

## Prayer Reminder Flow

### Overview
Users can set customizable prayer reminders with visual clock indicators showing minutes before jamaat.

### Step-by-Step Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    PRAYER REMINDER FLOW                         │
└─────────────────────────────────────────────────────────────────┘

1. INITIAL SETUP (Onboarding - Optional)
   ┌──────────────────────────────────────┐
   │ Step 4: Turn on prayer reminders?   │
   │                                      │
   │ ☑ Fajr    [15 min before ▼]        │
   │ ☑ Maghrib [10 min before ▼]        │
   │ ☐ Isha    [15 min before ▼]        │
   │ ☑ Jummah  [30 min before ▼]        │
   │                                      │
   │ [✓ Enable Reminders] [Skip]         │
   └──────────────────────────────────────┘
            │
            ↓
   Data saved to localStorage:
   {
     "fajr": { "enabled": true, "minutes": 15 },
     "maghrib": { "enabled": true, "minutes": 10 },
     "isha": { "enabled": false, "minutes": 15 },
     "jummah": { "enabled": true, "minutes": 30 }
   }

2. VIEWING REMINDERS ON TIMINGS TABLE
   ┌──────────────────────────────────────┐
   │ Prayer Timings                       │
   ├──────────┬─────────┬─────────────────┤
   │ Prayer   │ Jamaat  │ Status          │
   ├──────────┼─────────┼─────────────────┤
   │ Fajr ⏰15│ 05:15   │ Next prayer     │ ← Clock indicator
   │ Zuhr     │ 13:30   │ –               │
   │ Asr      │ 16:15   │ –               │
   │ Maghrib⏰10│ 17:10   │ –               │ ← Clock indicator
   │ Isha     │ 19:30   │ –               │
   │ Jummah⏰30│ 13:45   │ –               │ ← Clock indicator
   └──────────┴─────────┴─────────────────┘

   Legend:
   ⏰15 = Dotted circle clock with arrow pointing at 3 o'clock (15 min)
   ⏰10 = Dotted circle clock with arrow between 12 and 3 (10 min)
   ⏰30 = Dotted circle clock with arrow pointing at 6 o'clock (30 min)

3. EDITING REMINDER (Click on clock icon)
   User clicks: ⏰15 next to Fajr
            │
            ↓
   ┌──────────────────────────────────────┐
   │ Set reminder minutes before fajr:    │
   │ ┌──────────────────────────────────┐ │
   │ │ 15                               │ │ ← User edits
   │ └──────────────────────────────────┘ │
   │                                      │
   │ [OK] [Cancel]                        │
   └──────────────────────────────────────┘
            │
            ↓ User enters: 20
   ┌──────────────────────────────────────┐
   │ ✓ Reminder updated: 20 min before    │
   │   fajr                                │
   └──────────────────────────────────────┘
            │
            ↓
   Clock icon updates to ⏰20 (arrow moves to 4 o'clock position)
   localStorage updated immediately

4. CLOCK VISUAL DESIGN

   12 o'clock (0 min)
        ↑
        │
   9 ←──⊚──→ 3 o'clock (15 min)
        │
        ↓
   6 o'clock (30 min)

   Examples:
   - 15 min: Arrow points right (3 o'clock)  →
   - 30 min: Arrow points down (6 o'clock)   ↓
   - 45 min: Arrow points left (9 o'clock)   ←
   - 60 min: Arrow points up (12 o'clock)    ↑

5. BACKEND INTEGRATION (Future)
   When backend is ready:

   Frontend → POST /api/users/me/reminder-preferences
   {
     "fajr": { "enabled": true, "minutes": 20 },
     "maghrib": { "enabled": true, "minutes": 10 },
     "jummah": { "enabled": true, "minutes": 30 }
   }
            ↓
   Backend saves to database
            ↓
   Cron job schedules notifications
            ↓
   FCM sends push notification:
   "Fajr jamaat starts in 20 minutes at Central Jamia Masjid"
```

### Key Features

- ✅ **Visual Indicators**: SVG clock with rotating arrow
- ✅ **Inline Editing**: Click clock to change minutes
- ✅ **Persistent**: Saved to localStorage
- ✅ **Real-time Updates**: Changes reflect immediately
- ✅ **Validation**: 1-120 minutes range
- ✅ **Multiple Prayers**: Fajr, Zuhr, Asr, Maghrib, Isha, Jummah
- ⏳ **Push Notifications**: Requires backend integration

---

## Contribution & Verification Flow

### Overview
Community-driven system where users submit prayer timings and top contributors verify them for accuracy.

### Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│               CONTRIBUTION & VERIFICATION FLOW                  │
└─────────────────────────────────────────────────────────────────┘

════════════════════════════════════════════════════════════════
PHASE 1: AUTHENTICATION
════════════════════════════════════════════════════════════════

Guest User                        Logged-In User
     │                                  │
     ↓                                  ↓
┌─────────────┐                  ┌─────────────┐
│ Browsing OK │                  │ Full Access │
│ Can't submit│                  │ Can submit  │
└─────────────┘                  └─────────────┘
     │                                  │
     │ Clicks "Update"                  │
     ↓                                  │
┌──────────────────────┐                │
│ 🔒 Sign in required  │                │
│                      │                │
│ [Continue w/ Google] │                │
│ [Browse as Guest]    │                │
└──────────────────────┘                │
     │                                  │
     ↓ Signs in                         │
┌──────────────────────┐                │
│ Welcome, Ahmed Khan! │                │
└──────────────────────┘                │
     │                                  │
     └──────────────┬───────────────────┘
                    ↓

════════════════════════════════════════════════════════════════
PHASE 2: SUBMISSION
════════════════════════════════════════════════════════════════

User selects mosque → Clicks "✏️ Update Timings"
            │
            ↓
┌─────────────────────────────────────────────┐
│ 📤 Update jamaat timings                    │
│                                             │
│ Fajr:    [05:15]                           │
│ Zuhr:    [13:30]                           │
│ Asr:     [16:15]                           │
│ Maghrib: [17:10]                           │
│ Isha:    [19:30]                           │
│ Jummah:  [13:45]                           │
│                                             │
│ Notes: [Verified from mosque board]        │
│ ☑ I verified these timings                 │
│                                             │
│ [📤 Submit]                                 │
└─────────────────────────────────────────────┘
            │
            ↓ Submits
┌─────────────────────────────────────────────┐
│ ✅ Timings submitted!                       │
│ Waiting for community verification          │
│ +10 reputation                              │
└─────────────────────────────────────────────┘
            │
            ↓
   Creates submission object:
   {
     id: "sub123",
     userName: "Ahmed Khan",
     userReputation: 485,
     isTopContributor: true,
     submittedAt: "2025-11-16T10:30:00Z",
     timings: { fajr: "05:15", ... },
     notes: "Verified from mosque board",
     verified: false,
     verifiedBy: 0,
     status: "pending_verification"
   }
            │
            ↓
   Auto-switches to "Updates" tab
            │
            ↓

════════════════════════════════════════════════════════════════
PHASE 3: NOTIFICATION
════════════════════════════════════════════════════════════════

System creates notifications for Top Contributors:
            │
            ↓
   state.notifications.push({
     type: "verification_request",
     mosqueId: "m1",
     mosqueName: "Central Jamia Masjid",
     submissionId: "sub123",
     submitterName: "Ahmed Khan"
   });
            │
            ↓
┌─────────────────────────────────────────────┐
│ Profile Button Shows: 🔴 Badge (2)          │
└─────────────────────────────────────────────┘
            │
            ↓ Top Contributor clicks Profile
┌─────────────────────────────────────────────┐
│ 🔔 Notifications                    Badge: 2│
├─────────────────────────────────────────────┤
│ ⏳ Ahmed Khan submitted new timings         │
│    for Central Jamia Masjid.               │
│    Review and verify?                       │
│    30 min ago                               │
│ [Click to review]                           │
└─────────────────────────────────────────────┘
            │
            ↓ Clicks notification
   - Navigates to mosque
   - Switches to Updates tab
   - Shows submission ready for review
            │
            ↓

════════════════════════════════════════════════════════════════
PHASE 4: VERIFICATION (Top Contributors Only)
════════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────┐
│ 📊 Updates Tab                              │
├─────────────────────────────────────────────┤
│ Ahmed Khan ⭐ Top Contributor              │
│ Reputation: 485 · 30 min ago               │
│ ⏳ Pending Verification                    │
│ ┌─────────────────────────────────────────┐│
│ │ Fajr: 05:15  │ Zuhr: 13:30  │ Asr: … ││
│ │ Maghrib: 17:10  │ Isha: 19:30 │ …  ││
│ └─────────────────────────────────────────┘│
│ 📝 "Verified from mosque board"            │
│ ⏳ Needs verification                      │
│                                             │
│ [✓ Verify] [📋 Copy] [🚫 Report] ← Actions│
└─────────────────────────────────────────────┘
            │
            │ Top Contributor reviews timings
            │
            ├──→ Option 1: VERIFY
            │         │
            │         ↓
            │    ┌──────────────────────────┐
            │    │ ✅ Submission verified!  │
            │    │ You earned +15 reputation│
            │    └──────────────────────────┘
            │         │
            │         ↓
            │    submission.verifiedBy += 1
            │    submission.status = "active"
            │    user.reputation += 15
            │         │
            │         ↓ If verifiedBy >= 3
            │    mosque.defaultJamaatTimings = submission.timings
            │    Status badge: ✓ Active
            │
            ├──→ Option 2: COPY TIMINGS
            │         │
            │         ↓
            │    Pre-fills update form
            │    Opens modal
            │    User can modify & submit
            │         │
            │         ↓
            │    ┌──────────────────────────┐
            │    │ 📋 Timings copied!       │
            │    │ Review and submit        │
            │    └──────────────────────────┘
            │
            └──→ Option 3: REPORT
                      │
                      ↓
                 ┌──────────────────────────┐
                 │ 🚫 Submission reported   │
                 │ Our team will review it  │
                 └──────────────────────────┘

════════════════════════════════════════════════════════════════
PHASE 5: REPUTATION & BADGES
════════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────┐
│ 👤 Profile                                  │
├─────────────────────────────────────────────┤
│ Ahmed Khan                                  │
│ ahmed.khan@gmail.com                        │
│ [Sign Out]                                  │
├─────────────────────────────────────────────┤
│ Favorites: 3 │ Submissions: 18 │           │
│ Reputation: 500                             │ ← Updated!
├─────────────────────────────────────────────┤
│ 🏆 Your Badges                              │
│ ⭐ Top Contributor                          │
│ 🚀 Early Adopter                            │
│ ✓ Verified Helper                           │
└─────────────────────────────────────────────┘

Reputation Earning:
- Submit timing: +10 points
- Verify submission: +15 points
- Submission gets verified by others: +5 points

Badges Unlocked:
- Top Contributor: Top 5 for a mosque
- Verified Helper: 10+ submissions
- Early Adopter: First 100 users
- Community Champion: Top contributor for 3+ mosques
```

### Status Flow Chart

```
┌──────────────────────┐
│ User Submits Timings │
└──────────┬───────────┘
           │
           ↓
┌─────────────────────────────┐
│ Status: ⏳ Pending          │
│ verifiedBy: 0               │
│ Actions: [Verify] [Copy]    │
└──────────┬──────────────────┘
           │
           ↓ Top Contributor clicks "Verify"
┌─────────────────────────────┐
│ Status: ⏳ Pending          │
│ verifiedBy: 1               │
│ Actions: [Verify] [Copy]    │
└──────────┬──────────────────┘
           │
           ↓ 2nd verification
┌─────────────────────────────┐
│ Status: ⏳ Pending          │
│ verifiedBy: 2               │
│ Actions: [Verify] [Copy]    │
└──────────┬──────────────────┘
           │
           ↓ 3rd verification (THRESHOLD REACHED!)
┌─────────────────────────────┐
│ Status: ✓ Active            │
│ verifiedBy: 3               │
│ ⚡ BECOMES MOSQUE DEFAULT!  │
│ Actions: [Copy]             │
└─────────────────────────────┘
```

### User Roles & Permissions

```
┌───────────────┬──────────┬──────────┬──────────┬─────────┐
│ Action        │ Guest    │ User     │ Top Cont │ Admin   │
├───────────────┼──────────┼──────────┼──────────┼─────────┤
│ Browse        │ ✓        │ ✓        │ ✓        │ ✓       │
│ View Timings  │ ✓        │ ✓        │ ✓        │ ✓       │
│ View Updates  │ ✓        │ ✓        │ ✓        │ ✓       │
│ Submit        │ ✗ Login  │ ✓        │ ✓        │ ✓       │
│ Verify        │ ✗        │ ✗        │ ✓        │ ✓       │
│ Copy Timings  │ ✗ Login  │ ✓        │ ✓        │ ✓       │
│ Report        │ ✗        │ ✓        │ ✓        │ ✓       │
│ Delete Sub    │ ✗        │ Own only │ Own only │ ✓       │
└───────────────┴──────────┴──────────┴──────────┴─────────┘

Becoming a Top Contributor:
1. Submit timings regularly
2. Earn reputation (50+ points)
3. Have high approval rate (80%+)
4. Be in Top 5 contributors for that mosque
```

---

## Authentication Flow

### Sign-In Flow

```
┌─────────────────────────────────────────────┐
│ Guest User on Homepage                      │
│ [Sign In] button in header                  │
└──────────────┬──────────────────────────────┘
               │
               ↓ Clicks "Sign In"
┌─────────────────────────────────────────────┐
│ 🔒 Sign in to Jamat                         │
│                                             │
│ Sign in to submit prayer timings,          │
│ save favorites, and help the community      │
│                                             │
│ [Continue with Google]                      │
│                                             │
│ By signing in, you agree to our             │
│ Terms of Service and Privacy Policy         │
│                                             │
│ [Browse as Guest]                           │
└──────────────┬──────────────────────────────┘
               │
               ↓ Clicks "Continue with Google"
┌─────────────────────────────────────────────┐
│ ⏳ Signing in...                            │
└──────────────┬──────────────────────────────┘
               │
               ↓ OAuth Process (simulated in demo)
┌─────────────────────────────────────────────┐
│ ✅ Welcome, Ahmed Khan! 👋                  │
└──────────────┬──────────────────────────────┘
               │
               ↓
   User object saved:
   {
     id: "google_123456",
     name: "Ahmed Khan",
     email: "ahmed.khan@gmail.com",
     picture: "https://..."
   }
               │
               ↓
   localStorage.setItem('jamat_auth', JSON.stringify(user))
               │
               ↓
┌─────────────────────────────────────────────┐
│ Header Updates:                             │
│ - "Sign In" button → Hidden                 │
│ - Avatar + "Ahmed" → Shown                  │
└─────────────────────────────────────────────┘
```

### Persistent Login

```
User returns to app:
        │
        ↓
┌───────────────────────┐
│ Check localStorage    │
│ for 'jamat_auth'      │
└──────────┬────────────┘
           │
           ├──→ Found?
           │    state.auth.isLoggedIn = true
           │    state.auth.user = savedUser
           │    updateAuthUI()
           │    → User stays logged in
           │
           └──→ Not Found?
                state.auth.isLoggedIn = false
                → Show "Sign In" button
```

---

## Default Mosque Flow

### Setting Default

```
User Journey:
1. User selects mosque from list/map
2. Views timings
3. During onboarding Step 3:
   ┌──────────────────────────────────┐
   │ Pick your home mosque            │
   │                                  │
   │ [Central Jamia Masjid] ← Selects │
   │ [Jamia Masjid Noor]              │
   │ [Masjid Bilal]                   │
   └──────────────────────────────────┘
            │
            ↓
   localStorage.setItem('jamat_default_mosque', mosqueId)
            │
            ↓

App Launch Next Time:
        │
        ↓
┌─────────────────────────────┐
│ Check for default mosque    │
└──────────┬──────────────────┘
           │
           ↓ Found: "m1"
┌─────────────────────────────┐
│ Auto-load mosque details    │
│ Show timings immediately    │
│ Start countdown             │
└─────────────────────────────┘
```

---

## Summary

### Complete User Journey

```
1. App Opens
   └→ Default mosque loads automatically (if set)
       └→ Shows timings with reminder clock indicators

2. User Interaction
   ├→ Guest: Browse, view timings
   │   └→ Can't submit → Sign in required
   │
   └→ Logged In: Full access
       ├→ Submit timings → +10 reputation
       ├→ Verify submissions (if top contributor) → +15 reputation
       └→ Edit reminders → Click clock icon

3. Notifications
   └→ Top contributors get alerts for verification requests
       └→ Click → Navigate to Updates tab → Verify

4. Reputation Growth
   └→ Earn points → Unlock badges → Become top contributor
       └→ Gain verification powers
```

### Technology Stack

**Frontend (Current):**
- Vanilla JavaScript
- LocalStorage for persistence
- SVG for clock graphics
- Modal-based UI

**Backend (Planned):**
- REST API endpoints
- PostgreSQL + PostGIS
- FCM for push notifications
- Cron jobs for scheduled reminders

---

**For implementation details, see `FEATURES.md`**
**For database schema, see `database/schema.sql` and `database/features-schema-update.sql`**
