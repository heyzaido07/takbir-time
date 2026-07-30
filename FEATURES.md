# New Features Documentation

## Overview

This document describes the three major features added to enhance user engagement and data accuracy:

1. **Default Mosque** - Personal home mosque that opens automatically
2. **Prayer Reminders** - Customizable notifications before jamaat times
3. **Collaborative Verification** - Top contributors verify and validate timing updates

---

## Feature 1: Default Mosque

### User Story
> "As a user, I want to set my regular mosque as my default, so when I open the app, I immediately see my mosque's prayer timings without searching."

### How It Works

1. **Setting Default Mosque**
   - User selects a mosque from map or list
   - Clicks "Set as Default Mosque"
   - App stores this preference in `users.default_mosque_id`

2. **App Launch Behavior**
   - User opens app → API call to `get_user_default_mosque(user_id)`
   - App displays default mosque timings immediately
   - Shows live countdown to next prayer
   - Map centers on default mosque location

3. **Auto-Setup**
   When user sets a default mosque, system automatically:
   - ✅ Adds mosque to favorites
   - ✅ Creates prayer reminder preferences
   - ✅ Tracks when default was set (analytics)

### Database Schema

```sql
-- Added to users table
ALTER TABLE users
    ADD COLUMN default_mosque_id UUID REFERENCES mosques(id),
    ADD COLUMN default_mosque_set_at TIMESTAMP;
```

### API Endpoints (Backend TODO)

```javascript
// GET /api/users/me/default-mosque
// Returns user's default mosque with current timings
{
  "mosque": {
    "id": "uuid",
    "name": "Central Jamia Masjid",
    "address": "Main Boulevard",
    "city": "Lahore",
    "distance_km": 1.2
  },
  "current_schedule": {
    "fajr": {"adhan": "05:30", "iqamah": "05:45"},
    "zuhr": {"adhan": "13:00", "iqamah": "13:15"},
    // ...
  },
  "next_prayer": {
    "name": "Maghrib",
    "time": "18:05",
    "countdown": "02:34:18"
  }
}

// POST /api/users/me/default-mosque
{
  "mosque_id": "uuid"
}
```

### Frontend Implementation

```javascript
// On app load
async function loadDefaultMosque() {
  const response = await fetch('/api/users/me/default-mosque');
  if (response.ok) {
    const data = await response.json();
    selectMosque(data.mosque.id);
    centerMapOn(data.mosque.location);
    showTimings(data.current_schedule);
    startCountdown(data.next_prayer);
  }
}

// Set default mosque
async function setDefaultMosque(mosqueId) {
  await fetch('/api/users/me/default-mosque', {
    method: 'POST',
    body: JSON.stringify({ mosque_id: mosqueId })
  });
  showToast('Default mosque set!');
}
```

### UI/UX

**Detail Panel - Add Button:**
```
┌────────────────────────────────┐
│ 🕌 Central Jamia Masjid       │
│ Main Boulevard, Lahore         │
│                                │
│ [⭐ Favorite] [🏠 Set Default]│
└────────────────────────────────┘
```

**If Already Default:**
```
┌────────────────────────────────┐
│ 🕌 Central Jamia Masjid       │
│ ✅ Your Default Mosque         │
│                                │
│ [Remove as Default]            │
└────────────────────────────────┘
```

---

## Feature 2: Prayer Reminders

### User Story
> "As a user, I want to receive notifications 15 minutes before Fajr and 10 minutes before Maghrib at my default mosque, so I don't miss jamaat."

### How It Works

1. **User Configuration**
   - Choose which prayers to get notified for (Fajr, Zuhr, Asr, Maghrib, Isha, Jummah)
   - Set custom time offsets (5, 10, 15, 20, 30 minutes before)
   - Select notification channels (Push, Email, SMS)
   - Optionally pause during travel

2. **Reminder Scheduling**
   - Backend cron job runs every minute
   - Queries `prayer_reminders` for active users
   - Calculates next prayer time from mosque's schedule
   - Sends notification at `prayer_time - offset_minutes`

3. **Smart Features**
   - **No Duplicates**: Tracks sent reminders to avoid spam
   - **Day Filter**: Only send on selected days (e.g., skip weekends)
   - **Pause Function**: Disable during vacation without deleting settings
   - **Multi-Mosque**: Can set reminders for multiple mosques

### Database Schema

```sql
CREATE TABLE prayer_reminders (
    user_id UUID,
    mosque_id UUID,

    -- Which prayers to notify
    enabled_prayers JSONB DEFAULT '{
        "fajr": true,
        "maghrib": true,
        "jummah": true
    }',

    -- Minutes before jamaat
    reminder_offsets JSONB DEFAULT '{
        "fajr": 15,
        "maghrib": 10,
        "jummah": 30
    }',

    -- Channels
    notification_channels JSONB DEFAULT '{
        "push": true,
        "email": false,
        "sms": false
    }',

    -- Control
    is_active BOOLEAN DEFAULT TRUE,
    pause_until TIMESTAMP,
    active_days INTEGER[] DEFAULT ARRAY[0,1,2,3,4,5,6]
);
```

### Notification Flow

```
┌─────────────────────────────────────────────────┐
│ CRON JOB (Every Minute)                         │
└─────────────────┬───────────────────────────────┘
                  │
                  ↓
┌─────────────────────────────────────────────────┐
│ Query: SELECT * FROM prayer_reminders           │
│ WHERE is_active = TRUE                          │
│   AND (pause_until IS NULL                      │
│        OR pause_until < NOW())                  │
└─────────────────┬───────────────────────────────┘
                  │
                  ↓
┌─────────────────────────────────────────────────┐
│ For Each Reminder:                              │
│  1. Get mosque's current schedule               │
│  2. Find next prayer time                       │
│  3. Calculate: send_at = prayer_time - offset   │
│  4. Check if already sent today                 │
│  5. If not sent, queue notification             │
└─────────────────┬───────────────────────────────┘
                  │
                  ↓
┌─────────────────────────────────────────────────┐
│ NOTIFICATION SERVICE                            │
│  - Push: Firebase Cloud Messaging (FCM)        │
│  - Email: SendGrid / AWS SES                    │
│  - SMS: Twilio                                  │
└─────────────────────────────────────────────────┘
```

### API Endpoints (Backend TODO)

```javascript
// GET /api/users/me/reminders
// Returns all reminder configurations
[
  {
    "id": "uuid",
    "mosque": {
      "id": "uuid",
      "name": "Central Jamia Masjid"
    },
    "enabled_prayers": {
      "fajr": true,
      "maghrib": true
    },
    "reminder_offsets": {
      "fajr": 15,
      "maghrib": 10
    },
    "channels": {
      "push": true,
      "email": false
    },
    "is_active": true
  }
]

// POST /api/users/me/reminders
// Create or update reminder for a mosque
{
  "mosque_id": "uuid",
  "enabled_prayers": {
    "fajr": true,
    "zuhr": false,
    "asr": false,
    "maghrib": true,
    "isha": true,
    "jummah": true
  },
  "reminder_offsets": {
    "fajr": 15,
    "maghrib": 10,
    "isha": 15,
    "jummah": 30
  },
  "channels": {
    "push": true,
    "email": false,
    "sms": false
  }
}

// PATCH /api/users/me/reminders/:id/pause
// Temporarily pause reminders
{
  "pause_until": "2025-12-01T00:00:00Z"  // Resume after this date
}
```

### Frontend Implementation

```javascript
// Reminder Settings Component
function ReminderSettings({ mosque }) {
  const [enabled, setEnabled] = useState({
    fajr: true,
    zuhr: false,
    asr: false,
    maghrib: true,
    isha: false,
    jummah: true
  });

  const [offsets, setOffsets] = useState({
    fajr: 15,
    zuhr: 10,
    asr: 10,
    maghrib: 10,
    isha: 15,
    jummah: 30
  });

  async function saveReminder() {
    await fetch('/api/users/me/reminders', {
      method: 'POST',
      body: JSON.stringify({
        mosque_id: mosque.id,
        enabled_prayers: enabled,
        reminder_offsets: offsets,
        channels: { push: true, email: false, sms: false }
      })
    });
  }

  return (
    <div>
      <h3>Prayer Reminders for {mosque.name}</h3>
      {['fajr', 'zuhr', 'asr', 'maghrib', 'isha', 'jummah'].map(prayer => (
        <div key={prayer}>
          <label>
            <input
              type="checkbox"
              checked={enabled[prayer]}
              onChange={(e) => setEnabled({...enabled, [prayer]: e.target.checked})}
            />
            {prayer.charAt(0).toUpperCase() + prayer.slice(1)}
          </label>
          {enabled[prayer] && (
            <select
              value={offsets[prayer]}
              onChange={(e) => setOffsets({...offsets, [prayer]: parseInt(e.target.value)})}
            >
              <option value={5}>5 min before</option>
              <option value={10}>10 min before</option>
              <option value={15}>15 min before</option>
              <option value={20}>20 min before</option>
              <option value={30}>30 min before</option>
            </select>
          )}
        </div>
      ))}
      <button onClick={saveReminder}>Save Reminders</button>
    </div>
  );
}
```

### Notification Examples

**Push Notification:**
```
┌────────────────────────────────────┐
│ 🕌 Prayer Reminder                 │
│ Central Jamia Masjid               │
│                                    │
│ Fajr jamaat starts in 15 minutes  │
│ Iqamah at 5:45 AM                 │
│                                    │
│ [Open App] [Dismiss]               │
└────────────────────────────────────┘
```

**Email:**
```
Subject: Fajr Prayer Reminder - Central Jamia Masjid

As-salamu alaykum,

This is a reminder that Fajr jamaat at Central Jamia Masjid
starts in 15 minutes.

Adhan: 5:30 AM
Iqamah: 5:45 AM

[View in App] [Manage Reminders]
```

---

## Feature 3: Collaborative Verification

### User Story
> "As a top contributor to my mosque, when someone submits new prayer timings, I want to be notified so I can verify they're correct and keep our data accurate."

### How It Works

1. **Becoming a Top Contributor**
   - User submits prayer timings for a mosque
   - System tracks: total submissions, approved count, rejection count
   - Calculates trust score: `50 + (approved * 5) - (rejected * 10)`
   - Top 5 contributors per mosque get "Top Contributor" badge

2. **Submission & Verification Flow**

```
User A submits new timings
         ↓
System creates verification requests
         ↓
Notification sent to Top Contributors
         ↓
Top Contributor reviews submission
         ↓
Options:
  ✓ Approve (agrees with timings)
  ✗ Reject (disagrees)
  📋 Copy (update their own submission)
  ⏭️ Skip
```

3. **Verification Workflow**

```
NEW SUBMISSION
├─ Auto-notify Top 5 Contributors
├─ Each can: Approve / Reject / Copy / Skip
├─ Confidence Score Updates:
│  - +10 for each approval
│  - -5 for each rejection
│  - +2 for each upvote
│  - -3 for each downvote
└─ Auto-approve if:
   - 3+ approvals from top contributors
   - Confidence score > 80
   - Submitter trust score > 70
```

### Database Schema

```sql
-- Track contribution history
CREATE TABLE user_mosque_contributions (
    user_id UUID,
    mosque_id UUID,
    total_submissions INTEGER,
    approved_submissions INTEGER,
    rejected_submissions INTEGER,
    trust_score INTEGER,  -- 0-100
    is_top_contributor BOOLEAN,
    notify_on_updates BOOLEAN DEFAULT TRUE
);

-- Verification requests
CREATE TABLE verification_requests (
    timing_submission_id UUID,
    requested_from UUID,  -- Top contributor
    submitted_by UUID,
    submitted_timings JSONB,
    status VARCHAR,  -- pending, approved, rejected, skipped
    verified_at TIMESTAMP,
    verification_notes TEXT,
    copied_to_own_submission BOOLEAN
);

-- Enhanced timing_submissions
ALTER TABLE timing_submissions
    ADD COLUMN verification_count INTEGER,
    ADD COLUMN verified_by_contributors UUID[],
    ADD COLUMN confidence_score INTEGER;
```

### Notification Types

**1. New Submission Notification**
```
┌────────────────────────────────────┐
│ 🔔 New Timing Update               │
│ Central Jamia Masjid               │
│                                    │
│ Ahmed R. submitted new timings:    │
│ Fajr: 5:30 → 5:25 AM              │
│ Note: "Winter schedule started"    │
│                                    │
│ [Review] [Approve] [Dismiss]       │
└────────────────────────────────────┘
```

**2. Verification Request**
```
┌────────────────────────────────────┐
│ ✓ Verify Timing Update             │
│ Central Jamia Masjid               │
│                                    │
│ Current: Fajr 5:30 AM              │
│ Proposed: Fajr 5:25 AM             │
│                                    │
│ Submitted by: Ahmed R. (85% trust) │
│ Note: "Winter schedule started"    │
│                                    │
│ [✓ Approve] [✗ Reject] [📋 Copy]  │
└────────────────────────────────────┘
```

### API Endpoints (Backend TODO)

```javascript
// GET /api/users/me/verification-requests
// Get pending verification requests for user
[
  {
    "id": "uuid",
    "mosque": {
      "id": "uuid",
      "name": "Central Jamia Masjid"
    },
    "submitted_by": {
      "name": "Ahmed R.",
      "trust_score": 85,
      "total_submissions": 12
    },
    "current_timings": {
      "fajr": {"adhan": "05:30", "iqamah": "05:45"}
    },
    "proposed_timings": {
      "fajr": {"adhan": "05:25", "iqamah": "05:40"}
    },
    "changes": ["fajr"],
    "notes": "Winter schedule started",
    "submitted_at": "2025-11-15T10:30:00Z",
    "expires_at": "2025-11-22T10:30:00Z"
  }
]

// POST /api/verification-requests/:id/respond
{
  "action": "approve",  // or "reject", "skip"
  "notes": "Verified at mosque today",
  "copy_to_my_submission": true
}

// GET /api/mosques/:id/contributors
// Get top contributors for a mosque
{
  "top_contributors": [
    {
      "user_id": "uuid",
      "name": "Ahmed R.",
      "approved_submissions": 12,
      "trust_score": 85,
      "is_top_contributor": true
    },
    // ... top 5
  ],
  "total_contributors": 28
}
```

### Frontend Implementation

```javascript
// Verification Review Component
function VerificationReview({ request }) {
  async function respond(action, copyToOwn = false) {
    await fetch(`/api/verification-requests/${request.id}/respond`, {
      method: 'POST',
      body: JSON.stringify({
        action,
        copy_to_my_submission: copyToOwn
      })
    });
    showToast(`Submission ${action}d`);
  }

  return (
    <div className="verification-card">
      <h3>{request.mosque.name}</h3>
      <p>Submitted by: {request.submitted_by.name}</p>

      <div className="timing-comparison">
        <div>
          <h4>Current</h4>
          {Object.entries(request.current_timings).map(([prayer, time]) => (
            <div key={prayer}>{prayer}: {time.iqamah}</div>
          ))}
        </div>
        <div>
          <h4>Proposed</h4>
          {Object.entries(request.proposed_timings).map(([prayer, time]) => (
            <div key={prayer} className={request.changes.includes(prayer) ? 'changed' : ''}>
              {prayer}: {time.iqamah}
            </div>
          ))}
        </div>
      </div>

      {request.notes && <p className="notes">"{request.notes}"</p>}

      <div className="actions">
        <button onClick={() => respond('approve')}>
          ✓ Approve
        </button>
        <button onClick={() => respond('approve', true)}>
          📋 Approve & Copy to My Submission
        </button>
        <button onClick={() => respond('reject')}>
          ✗ Reject
        </button>
        <button onClick={() => respond('skip')}>
          ⏭️ Skip
        </button>
      </div>
    </div>
  );
}
```

### Gamification & Badges

**Badges for Contributors:**

- 🥉 **Bronze Contributor**: 5 approved submissions
- 🥈 **Silver Contributor**: 15 approved submissions
- 🥇 **Gold Contributor**: 30 approved submissions
- ⭐ **Top Contributor**: Top 5 for a mosque
- ✅ **Trusted Source**: 80+ trust score
- 🏆 **Community Champion**: Top contributor for 3+ mosques

### Trust Score Calculation

```javascript
function calculateTrustScore(user, mosque) {
  const baseScore = 50;
  const approvalBonus = user.approved_submissions * 5;
  const rejectionPenalty = user.rejected_submissions * 10;
  const verificationBonus = user.verifications_given * 2;

  const score = baseScore
    + approvalBonus
    - rejectionPenalty
    + verificationBonus;

  return Math.max(0, Math.min(100, score));
}
```

### Dispute Resolution

When two top contributors submit conflicting timings:

1. **Auto-create Dispute**
   ```sql
   CREATE TABLE timing_disputes (
       mosque_id UUID,
       submission_a_id UUID,
       submission_b_id UUID,
       disputed_prayers TEXT[],
       status VARCHAR  -- active, resolved, admin_review
   );
   ```

2. **Community Voting**
   - Show both submissions to other contributors
   - Let community vote on which is correct
   - Higher trust score contributors have more weight

3. **Admin Escalation**
   - If dispute unresolved after 7 days
   - Notify mosque admin/moderators
   - Manual review and decision

---

## Implementation Checklist

### Phase 1: Database (Week 1)
- [x] Run `schema.sql` to create base tables
- [x] Run `features-schema-update.sql` for new features
- [ ] Test all functions and triggers
- [ ] Seed with sample data

### Phase 2: Backend API (Week 2-3)
- [ ] Build REST API (Node.js + Express + Prisma)
- [ ] Implement authentication (JWT)
- [ ] Create endpoints for all features
- [ ] Set up notification service (FCM, SendGrid)
- [ ] Build cron job for reminder scheduling

### Phase 3: Frontend (Week 4-5)
- [ ] Update UI with default mosque selection
- [ ] Add reminder settings panel
- [ ] Build verification request inbox
- [ ] Add contributor badges/profile
- [ ] Implement notification handling

### Phase 4: Testing & Polish (Week 6)
- [ ] End-to-end testing
- [ ] Load testing (simulate 10K users)
- [ ] Mobile responsiveness testing
- [ ] Security audit
- [ ] Performance optimization

---

## Cost Estimation

### Notification Services

**Firebase Cloud Messaging (Push):**
- Free up to unlimited messages
- Best for mobile apps

**SendGrid (Email):**
- Free: 100 emails/day
- $15/month: 50K emails/month
- $90/month: 1.5M emails/month

**Twilio (SMS):**
- $0.0079 per SMS (US)
- 1000 reminders/day = $240/month
- **Recommendation**: Start with Push + Email, add SMS later

### Infrastructure

**Backend Hosting (Railway/Render):**
- $5-20/month for API server

**Database (Supabase/Render):**
- Free tier: 500MB, enough for MVP
- Pro: $25/month for 8GB

**Total MVP Cost: ~$50/month**

---

## Next Steps

1. **Set up development database**
   ```bash
   docker run -d --name jamat-postgres \
     -e POSTGRES_PASSWORD=password \
     -p 5432:5432 \
     postgis/postgis:14-3.3

   psql -U postgres -d jamat_db -f database/schema.sql
   psql -U postgres -d jamat_db -f database/features-schema-update.sql
   ```

2. **Build backend API** (see `/api` folder for starter code)

3. **Integrate with frontend** (update `index.html` or migrate to React/Next.js)

4. **Set up notification services** (FCM, SendGrid accounts)

5. **Deploy and test!**

---

## Current Frontend Implementation (index-enhanced.html)

### IMPLEMENTED: Prayer Reminder UI Flow

The prayer reminder system is **fully implemented** in the frontend with visual clock indicators and editable reminder times.

#### User Journey

**1. Onboarding (Step 4) - Initial Setup**
```
User Flow:
┌─────────────────────────────────────────────┐
│ Step 4: Turn on prayer reminders?          │
│                                             │
│ ☑ Fajr    [15 min before ▼]               │
│ ☑ Maghrib [10 min before ▼]               │
│ ☐ Isha    [15 min before ▼]               │
│ ☑ Jummah  [30 min before ▼]               │
│                                             │
│ [✓ Enable Reminders] [Skip for Now]       │
└─────────────────────────────────────────────┘
```

**What Happens:**
- User selects which prayers to get reminders for
- Sets custom minutes (5, 10, 15, 20, 30, 45, 60)
- Data saved to localStorage as:
  ```javascript
  {
    "fajr": { "enabled": true, "minutes": 15 },
    "maghrib": { "enabled": true, "minutes": 10 },
    "isha": { "enabled": false, "minutes": 15 },
    "jummah": { "enabled": true, "minutes": 30 }
  }
  ```

**2. Prayer Timings Display - Clock Indicators**

When viewing a mosque's timings, enabled reminders show as **interactive clock icons**:

```
Prayer Timings
┌────────────────────────────────────┐
│ Prayer    │ Jamaat  │ Status      │
├───────────┼─────────┼─────────────┤
│ Fajr ⏰15 │ 05:15   │ Next prayer │ ← Clock shows 15 min
│ Zuhr      │ 13:30   │ –           │
│ Asr       │ 16:15   │ –           │
│ Maghrib⏰10│ 17:10   │ –           │ ← Clock shows 10 min
│ Isha      │ 19:30   │ –           │
│ Jummah ⏰30│ 13:45   │ –           │ ← Clock shows 30 min
└────────────────────────────────────┘
```

**Clock Design (SVG-based):**
- ⭕ **Dotted circle** border (green)
- ⬆️ **Arrow hand** pointing clockwise
- 🔢 **Number** in center showing minutes
- 📍 **12 o'clock = 0 min** (top)
- 📍 **3 o'clock = 15 min** (right)
- 📍 **6 o'clock = 30 min** (bottom)
- 📍 **9 o'clock = 45 min** (left)

**3. Editing Reminders - Click to Change**

```
User Action: Clicks on ⏰15 next to Fajr

┌─────────────────────────────────────┐
│ Set reminder minutes before fajr:   │
│ ┌─────────────────────────────────┐ │
│ │ 15                              │ │
│ └─────────────────────────────────┘ │
│                                     │
│ [OK] [Cancel]                       │
└─────────────────────────────────────┘

User enters: 20
Result: Clock icon updates to ⏰20
Toast: "Reminder updated: 20 min before fajr"
```

#### Technical Implementation

```javascript
// 1. Create clock SVG with arrow pointing based on minutes
function createReminderClock(minutes, prayerKey) {
  // Calculate angle: 0 min = top (12 o'clock)
  const angle = (minutes / 60) * 360 - 90;

  return `
    <span class="reminder-timer" onclick="editReminderMinutes('${prayerKey}', ${minutes})">
      <svg viewBox="0 0 32 32">
        <!-- Dashed circle -->
        <circle cx="16" cy="16" r="14"
                fill="rgba(16,185,129,0.08)"
                stroke="#10b981"
                stroke-dasharray="2,2" />

        <!-- Arrow hand rotated clockwise -->
        <g transform="rotate(${angle} 16 16)">
          <line x1="16" y1="16" x2="16" y2="6" stroke="#10b981" />
          <path d="M 16 6 L 14 9 L 18 9 Z" fill="#10b981" />
        </g>

        <!-- Center dot -->
        <circle cx="16" cy="16" r="2" fill="#10b981" />
      </svg>
      <span class="minutes-label">${minutes}</span>
    </span>
  `;
}

// 2. Edit reminder minutes
function editReminderMinutes(prayerKey, currentMinutes) {
  const newMinutes = prompt(\`Set reminder minutes before ${prayerKey}:\`, currentMinutes);
  if (!newMinutes) return;

  const minutes = parseInt(newMinutes);
  if (isNaN(minutes) || minutes < 1 || minutes > 120) {
    showToast('Please enter 1-120 minutes');
    return;
  }

  // Update localStorage
  const prefs = JSON.parse(localStorage.getItem('reminder_preferences') || '{}');
  prefs[prayerKey].minutes = minutes;
  localStorage.setItem('reminder_preferences', JSON.stringify(prefs));

  // Re-render table
  renderTimingsTable(mosque.defaultJamaatTimings);
  showToast(\`Reminder updated: ${minutes} min before ${prayerKey}\`);
}

// 3. Render timings with clock indicators
function renderTimingsTable(timings) {
  const reminderPrefs = JSON.parse(localStorage.getItem('reminder_preferences') || '{}');

  entries.forEach(entry => {
    const reminder = reminderPrefs[entry.key];
    const reminderIndicator = (reminder && reminder.enabled)
      ? createReminderClock(reminder.minutes, entry.key)
      : '';

    row.innerHTML = \`
      <td>${entry.label}${reminderIndicator}</td>
      <td>${timings[entry.key]}</td>
    \`;
  });
}
```

#### Key Features

✅ **Visual Clock Design**: SVG-based clock with rotating arrow
✅ **Click to Edit**: Inline editing without going to settings
✅ **Persistent Storage**: Saved to localStorage
✅ **Live Updates**: Changes reflect immediately
✅ **Validation**: 1-120 minutes range enforced
✅ **Tooltip**: Hover shows "Reminder X min before"
✅ **Responsive**: Works on mobile and desktop

#### Backend Integration (TODO)

To activate actual notifications, the backend needs to:

1. **Sync reminder preferences** from frontend to database
   ```javascript
   POST /api/users/me/reminder-preferences
   {
     "fajr": { "enabled": true, "minutes": 15 },
     "maghrib": { "enabled": true, "minutes": 10 },
     "jummah": { "enabled": true, "minutes": 30 }
   }
   ```

2. **Schedule notifications** using the cron job described in Feature 2

3. **Send push notifications** via FCM when prayer time - offset is reached

---

### IMPLEMENTED: Contribution & Verification Flow

The complete crowd-sourced timing system is **fully functional** in the frontend with submission, verification, reputation, and notifications.

#### User Journey

**1. Guest User → Must Sign In**

```
Guest tries to update timings:
┌────────────────────────────────────┐
│ 🕌 Central Jamia Masjid            │
│                                    │
│ [✏️ Update Timings] ← Clicks here │
└────────────────────────────────────┘
         ↓
┌────────────────────────────────────┐
│ 🔒 Sign in to Jamat                │
│                                    │
│ Sign in to submit prayer timings  │
│                                    │
│ [Continue with Google]             │
│ [Browse as Guest]                  │
└────────────────────────────────────┘
```

**2. Logged-In User → Submit Timings**

```
User Flow:
1. Select mosque → Click "✏️ Update"
2. Fill form with prayer times
3. Add optional notes
4. Check "I verified these timings"
5. Click "📤 Submit"

Result:
┌────────────────────────────────────┐
│ ✅ Success!                        │
│                                    │
│ Timings submitted!                 │
│ Waiting for community verification│
│ +10 reputation                     │
└────────────────────────────────────┘

Auto-switches to Updates tab to show submission
```

**3. Updates Tab - Community Submissions**

```
📊 Updates Tab
┌────────────────────────────────────────────┐
│ Ahmed Khan ⭐ Top Contributor             │
│ Reputation: 450 · 2 hours ago             │
│ ✓ Active                                  │
│ ┌──────────────────────────────────────┐ │
│ │ Fajr: 05:15  │ Zuhr: 13:30  │ Asr: … │ │
│ │ Maghrib: 17:10  │ Isha: 19:30 │ … │ │
│ └──────────────────────────────────────┘ │
│ 📝 "Verified from mosque board"           │
│ ✓ Verified by 5 contributors              │
│ [📋 Use These Timings]                    │
├────────────────────────────────────────────┤
│ Omar Hassan                               │
│ Reputation: 120 · 30 min ago             │
│ ⏳ Pending Verification                  │
│ ┌──────────────────────────────────────┐ │
│ │ Fajr: 05:20  │ Zuhr: 13:35  │ Asr: … │ │
│ └──────────────────────────────────────┘ │
│ ⏳ Needs verification                     │
│ [✓ Verify] [📋 Copy] [🚫 Report] ← Top contributor actions
└────────────────────────────────────────────┘
```

**4. Top Contributor → Verify Submission**

```
Top Contributor clicks "✓ Verify":

Action:
1. Submission.verifiedBy += 1
2. If verifiedBy >= 3 → becomes mosque default
3. User earns +15 reputation
4. Status changes from "Pending" → "Active"

Result:
┌────────────────────────────────────┐
│ ✅ Submission verified!            │
│ You earned +15 reputation          │
└────────────────────────────────────┘
```

**5. Copy Timings Feature**

```
Any user clicks "📋 Copy to My Submission":

Action:
1. Pre-fills update form with all timings
2. Opens modal automatically
3. User can modify before submitting

┌────────────────────────────────────┐
│ 📤 Update jamaat timings           │
│                                    │
│ Fajr:    [05:15] ← Pre-filled     │
│ Zuhr:    [13:30]                   │
│ Asr:     [16:15]                   │
│ Maghrib: [17:10]                   │
│ Isha:    [19:30]                   │
│ Jummah:  [13:45]                   │
│                                    │
│ Notes: [Optional]                  │
│ ☑ I verified these timings         │
│                                    │
│ [📤 Submit] [✕ Cancel]            │
└────────────────────────────────────┘

Toast: "📋 Timings copied! Review and submit"
```

**6. Notifications System**

```
Profile View → 🔔 Notifications

┌────────────────────────────────────────────┐
│ 🔔 Notifications                    Badge: 2│
├────────────────────────────────────────────┤
│ ⏳ Omar Hassan submitted new timings       │
│    for Central Jamia Masjid.              │
│    Review and verify?                      │
│    30 min ago                              │
│ [Click to review]                          │
├────────────────────────────────────────────┤
│ 🔄 Prayer timings updated by Aisha         │
│    Rahman at Jamia Masjid Noor            │
│    2 hours ago                             │
│ [Click to view]                            │
└────────────────────────────────────────────┘

Clicking notification:
- Marks as read
- Navigates to mosque
- Switches to Updates tab
- Shows submission ready for verification
```

**7. Profile - Reputation & Badges**

```
Profile View (Logged In)

┌────────────────────────────────────┐
│ 👤 Ahmed Khan                      │
│ ahmed.khan@gmail.com               │
│ [Sign Out]                         │
├────────────────────────────────────┤
│ Favorites: 3 │ Submissions: 17 │  │
│ Reputation: 485                    │
├────────────────────────────────────┤
│ 🏆 Your Badges                     │
│ ⭐ Top Contributor                 │
│ 🚀 Early Adopter                   │
│ ✓ Verified Helper                  │
└────────────────────────────────────┘
```

#### Technical Implementation

```javascript
// 1. Submission State (Mock Data)
state.submissions = {
  m1: [  // mosque ID
    {
      id: "sub1",
      userId: "user123",
      userName: "Ahmed Khan",
      userReputation: 450,
      isTopContributor: true,
      submittedAt: "2025-11-16T07:30:00Z",
      timings: { fajr: "05:15", /* ... */ },
      notes: "Verified from mosque board",
      verified: true,
      verifiedBy: 5,
      status: "active"  // active | pending_verification | outdated
    }
  ]
};

// 2. User Contribution Stats
state.userContributions = {
  m1: {
    totalSubmissions: 12,
    approvedSubmissions: 10,
    trustScore: 85,
    isTopContributor: true
  }
};

// 3. Submit New Timings
document.getElementById("update-form").addEventListener("submit", (e) => {
  e.preventDefault();

  // Require login
  if (!state.auth.isLoggedIn) {
    showToast("Please sign in to submit timing updates");
    showSignInModal();
    return;
  }

  // Create submission
  const newSubmission = {
    id: 'sub' + Date.now(),
    userId: state.auth.user.id,
    userName: state.auth.user.name,
    userReputation: state.user.reputation,
    isTopContributor: state.userContributions[mosqueId]?.isTopContributor || false,
    submittedAt: new Date().toISOString(),
    timings: { /* from form */ },
    notes: form.notes.value,
    verified: false,
    verifiedBy: 0,
    status: 'pending_verification'
  };

  state.submissions[mosqueId].unshift(newSubmission);

  // Create notification for top contributors
  state.notifications.push({
    type: 'verification_request',
    mosqueId: mosqueId,
    mosqueName: mosque.name,
    submissionId: newSubmission.id,
    submitterName: state.auth.user.name
  });

  // Update stats
  state.user.totalSubmissions += 1;
  state.user.reputation += 10;

  showToast("Timings submitted! +10 reputation");

  // Auto-switch to Updates tab
  document.querySelector('.detail-tab[data-tab="updates"]').click();
});

// 4. Verify Submission (Top Contributors Only)
function verifySubmission(submissionId, mosqueId) {
  const submission = state.submissions[mosqueId].find(s => s.id === submissionId);

  submission.verified = true;
  submission.verifiedBy += 1;
  submission.status = 'active';

  // Update mosque default if enough verifications
  if (submission.verifiedBy >= 3) {
    mosque.defaultJamaatTimings = { ...submission.timings };
    renderTimingsTable(mosque.defaultJamaatTimings);
  }

  state.user.reputation += 15;
  renderSubmissions(mosqueId);
  showToast('✓ Submission verified! +15 reputation');
}

// 5. Copy Timings
function copyTimings(submissionId, mosqueId) {
  const submission = state.submissions[mosqueId].find(s => s.id === submissionId);

  // Pre-fill form
  form.fajr.value = submission.timings.fajr;
  form.zuhr.value = submission.timings.zuhr;
  // ... etc

  // Open modal
  document.getElementById("update-modal").style.display = "flex";
  showToast('📋 Timings copied! Review and submit');
}

// 6. Render Submissions in Updates Tab
function renderSubmissions(mosqueId) {
  const submissions = state.submissions[mosqueId] || [];

  // Sort: pending first, then active, then outdated
  const sorted = [...submissions].sort((a, b) => {
    const order = { pending_verification: 0, active: 1, outdated: 2 };
    return order[a.status] - order[b.status];
  });

  sorted.forEach(sub => {
    // Check if current user is top contributor
    const canVerify = state.userContributions[mosqueId]?.isTopContributor
                      && sub.status === 'pending_verification';

    // Render card with action buttons
    card.innerHTML = `
      <!-- User info, timings, notes -->
      ${canVerify ? `
        <button onclick="verifySubmission('${sub.id}', '${mosqueId}')">
          ✓ Verify
        </button>
        <button onclick="copyTimings('${sub.id}', '${mosqueId}')">
          📋 Copy to My Submission
        </button>
        <button onclick="reportSubmission('${sub.id}')">
          🚫 Report
        </button>
      ` : `
        <button onclick="copyTimings('${sub.id}', '${mosqueId}')">
          📋 Use These Timings
        </button>
      `}
    `;
  });
}
```

#### Key Features

✅ **Google Authentication**: Sign in required for submissions
✅ **Submission System**: Create new timing entries with notes
✅ **Verification Flow**: Top contributors approve submissions
✅ **Reputation Points**: +10 submit, +15 verify
✅ **Status Badges**: Active, Pending, Outdated
✅ **Copy Timings**: Use anyone's submission as template
✅ **Notifications**: Alert top contributors of new submissions
✅ **Top Contributor Powers**: Verify, approve, report
✅ **Auto-Default**: 3+ verifications → becomes mosque default
✅ **Time Ago**: "2 hours ago", "1 day ago" timestamps
✅ **Profile Stats**: Track submissions, reputation, badges

#### Backend Integration (TODO)

To persist submissions to database:

1. **POST /api/mosques/:id/submissions**
   ```javascript
   {
     "timings": { "fajr": "05:15", ... },
     "notes": "Verified from mosque board",
     "verified": true
   }
   ```

2. **POST /api/submissions/:id/verify** (Top contributors only)
   ```javascript
   { "action": "approve" }
   ```

3. **GET /api/users/me/notifications**
   ```javascript
   [
     {
       "type": "verification_request",
       "mosque_id": "uuid",
       "submission_id": "uuid"
     }
   ]
   ```

---

---

## Feature 4: Multiple Jummah Support

### User Story
> "As a user, I want to see all Jummah prayer times (1st, 2nd, 3rd) for my mosque so I can choose the one that fits my schedule."

### How It Works

1. **Data Structure Update**
   - Mosques can now store multiple Jummah timings: `jummah`, `jummah_2`, `jummah_3`.
   - Each timing has its own Adhan and Iqamah times.

2. **Display Logic**
   - **Timings Table**: Shows "Jummah 1", "Jummah 2", "Jummah 3" rows if data exists.
   - **Amenities**: Shows "2️⃣ Jummah 2" and "3️⃣ Jummah 3" badges if available.
   - **Contributor Cards**: Lists all Jummah times submitted by contributors.

3. **Submission Flow**
   - The "Submit Timings" form now includes optional fields for Jummah 2 and Jummah 3.
   - Users can enter times for these additional prayers.

### Database Schema

```sql
-- Update mosques table or timings JSON structure
-- Example JSON structure for timings:
{
  "fajr": "05:15",
  "zuhr": "13:30",
  "asr": "16:15",
  "maghrib": "17:10",
  "isha": "19:30",
  "jummah": "13:15",
  "jummah_2": "14:15",  -- Optional
  "jummah_3": "15:15"   -- Optional
}
```

### Frontend Implementation

```javascript
// Rendering Jummah rows in Timings Table
const jummahPrayers = [
    { key: 'jummah', label: 'Jummah' },
    { key: 'jummah_2', label: 'Jummah 2' },
    { key: 'jummah_3', label: 'Jummah 3' }
];

jummahPrayers.forEach(p => {
    if (timings[p.key]) {
        // Render row
        // ...
    }
});
```

### UI Updates

- **Timings Table**: Conditionally renders extra rows.
- **Amenities List**: Adds badges for multiple Jummahs.
- **Submission Form**: Expandable/Optional inputs for extra Jummahs.

---

**Questions? Check the database README or open an issue!**
