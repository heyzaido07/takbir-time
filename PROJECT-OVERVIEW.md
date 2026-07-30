# Jamat - Complete Project Overview

## 🎯 Vision

A community-driven platform to help Muslims worldwide find accurate prayer timings for their local mosques, with real-time updates powered by the community itself.

## 📊 Project Status

**Current Phase:** Frontend Prototype Complete ✅
**Next Phase:** Backend Development & Database Setup

## 🏗️ Architecture

### Technology Stack

**Frontend** (✅ Complete)
- Pure HTML5, CSS3, JavaScript (ES6+)
- Google Maps JavaScript API
- Responsive design (mobile-first)
- Progressive Web App ready

**Backend** (🚧 To Build)
- **Recommended**: Node.js + Express + Prisma
- **Alternatives**: Python + FastAPI, Go + Gin
- RESTful API design
- JWT authentication

**Database** (📝 Schema Ready)
- PostgreSQL 14+ with PostGIS 3+
- Geospatial indexing for location queries
- JSONB for flexible prayer timing schemas
- Materialized views for performance

**Infrastructure** (🔜 To Deploy)
- **Database**: Supabase / AWS RDS / Railway
- **API**: Render / Railway / Vercel
- **CDN**: CloudFront / Cloudflare
- **Notifications**: Firebase (Push), SendGrid (Email)
- **Caching**: Redis (optional for scale)

## 🎨 Features

### ✅ Implemented (Frontend Only)

1. **Interactive Map**
   - Google Maps integration with custom mosque markers
   - Click markers to view details
   - Location search and autocomplete
   - My Location button

2. **Mosque Discovery**
   - List view with search and filters
   - Sort by distance, rating, recent updates
   - Mosque detail panel with full information

3. **Prayer Timings**
   - Table view of all 5 daily prayers
   - Live countdown to next prayer (updates every second)
   - Highlight upcoming prayer

4. **Favorites System**
   - Save frequently visited mosques
   - Quick access favorites tab
   - One-click favoriting

5. **Community Features (UI Only)**
   - Submit timing updates form
   - View community submissions
   - Rating and voting placeholders

6. **Responsive Design**
   - Desktop, tablet, mobile optimized
   - Touch-friendly interface
   - Adaptive layout

### 📝 Designed (Database Ready)

7. **Default Mosque**
   - Set personal home mosque
   - Auto-load on app open
   - Auto-favorite and reminder setup

8. **Prayer Reminders**
   - Customizable alerts (5-30 min before)
   - Per-prayer configuration
   - Multiple notification channels (Push, Email, SMS)
   - Pause during travel
   - Day-of-week filtering

9. **Collaborative Verification**
   - Top contributor system
   - Verification requests for new submissions
   - Trust scoring (0-100)
   - Copy-to-own-submission feature
   - Dispute resolution
   - Contributor badges

10. **User Profiles**
    - Reputation points
    - Contribution history
    - Badges and achievements
    - Activity feed

11. **Advanced Search**
    - Full-text search with typo tolerance
    - Filter by amenities
    - Filter by denomination/madhab

### 🔜 Future Roadmap

**Phase 3: Enhanced Features**
- [ ] Photo uploads for mosques
- [ ] Opening hours and special events
- [ ] Tarawih schedules during Ramadan
- [ ] Eid prayer announcements
- [ ] Qibla direction overlay

**Phase 4: Mobile Apps**
- [ ] React Native iOS app
- [ ] React Native Android app
- [ ] Offline mode with service workers
- [ ] Background geofencing (auto-detect nearby mosques)

**Phase 5: Advanced Features**
- [ ] Prayer time calculation API (auto-calculate from location)
- [ ] Integration with mosque management systems
- [ ] Analytics dashboard for mosque admins
- [ ] Multi-language support (Arabic, Urdu, Turkish, etc.)
- [ ] Social features (check-ins, prayer logs)

## 📁 Project Structure

```
Jamat/
├── index.html                    # Main app (frontend prototype)
├── README.md                     # Setup instructions
├── QUICKSTART.md                 # 5-minute setup guide
├── FEATURES.md                   # Detailed feature docs
├── PROJECT-OVERVIEW.md           # This file
│
├── database/
│   ├── schema.sql               # Core database schema
│   ├── features-schema-update.sql  # New features schema
│   ├── README.md                # Database documentation
│   └── database-comparison.md   # DB technology comparison
│
├── api/ (to be created)
│   ├── server.js                # Express server
│   ├── routes/
│   ├── controllers/
│   ├── middleware/
│   └── prisma/
│       └── schema.prisma        # ORM schema
│
└── docs/
    └── API.md                   # API documentation
```

## 🗄️ Database Design

### Core Tables

| Table | Purpose | Key Features |
|-------|---------|--------------|
| `users` | User accounts | Email, reputation, default_mosque_id |
| `mosques` | Global mosque directory | PostGIS location, amenities, photos |
| `prayer_schedules` | Seasonal prayer times | JSONB timings, date ranges |
| `timing_submissions` | Community updates | Pending/approved status, voting |
| `user_favorites` | Saved mosques | Quick access |
| `prayer_reminders` | Notification prefs | Per-prayer offsets, channels |
| `verification_requests` | Peer review system | Top contributor workflow |
| `user_mosque_contributions` | Contribution tracking | Trust scores, badges |
| `mosque_reviews` | Ratings & reviews | 1-5 stars, helpful votes |

### Key Database Features

✅ **Geospatial Queries** (PostGIS)
```sql
-- Find mosques within 5km
SELECT * FROM find_nearby_mosques(31.5204, 74.3587, 5.0);
-- Returns results in ~5ms for millions of records
```

✅ **Flexible Timings** (JSONB)
```json
{
  "fajr": {"adhan": "05:30", "iqamah": "05:45"},
  "jummah": [
    {"adhan": "13:00", "iqamah": "13:20"},
    {"adhan": "14:00", "iqamah": "14:20"}
  ]
}
```

✅ **Full-Text Search** (Trigram)
```sql
-- Fuzzy search with typo tolerance
SELECT * FROM mosques
WHERE name % 'centrl jama'  -- Finds "Central Jamia"
ORDER BY similarity(name, 'centrl jama') DESC;
```

✅ **Materialized Views** (Performance)
```sql
-- Pre-computed statistics
CREATE MATERIALIZED VIEW mosque_stats AS
SELECT mosque_id, COUNT(favorites), AVG(rating)...
-- Refresh nightly for fast queries
```

## 🔌 API Design

### Core Endpoints (To Be Built)

**Authentication**
```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/refresh
GET    /api/auth/me
```

**Mosques**
```
GET    /api/mosques/nearby?lat=31.5204&lng=74.3587&radius=5
GET    /api/mosques/search?q=central
GET    /api/mosques/:id
GET    /api/mosques/:id/schedule
POST   /api/mosques (admin only)
```

**User Features**
```
GET    /api/users/me/favorites
POST   /api/users/me/favorites
DELETE /api/users/me/favorites/:mosque_id

GET    /api/users/me/default-mosque
POST   /api/users/me/default-mosque

GET    /api/users/me/reminders
POST   /api/users/me/reminders
PATCH  /api/users/me/reminders/:id/pause
```

**Community**
```
POST   /api/submissions
GET    /api/submissions/:id
POST   /api/submissions/:id/vote

GET    /api/users/me/verification-requests
POST   /api/verification-requests/:id/respond
```

## 🚀 Deployment Strategy

### MVP (0-10K Users)

**Architecture:**
```
Frontend: Vercel (free)
Backend: Render ($7/month)
Database: Supabase (free tier)
Total: ~$10/month
```

**Features:**
- Core mosque discovery
- Basic prayer timings
- User accounts and favorites
- Simple notifications (email only)

### Growth (10K-100K Users)

**Architecture:**
```
Frontend: Vercel Pro ($20/month)
Backend: Render Standard ($25/month) + autoscaling
Database: Supabase Pro ($25/month)
Redis: Upstash ($10/month)
CDN: Cloudflare (free)
Total: ~$80/month
```

**Features:**
- Add push notifications (Firebase)
- Redis caching for popular mosques
- Read replicas for database
- Real-time updates via WebSockets

### Scale (100K-1M Users)

**Architecture:**
```
Frontend: Cloudflare Pages (free)
Backend: AWS ECS or GCP Cloud Run (~$200/month)
Database: AWS RDS PostgreSQL (~$300/month)
Redis: ElastiCache (~$50/month)
Elasticsearch: AWS OpenSearch (~$150/month)
CDN: CloudFront (~$50/month)
Notifications: FCM + SendGrid (~$100/month)
Total: ~$850/month
```

**Features:**
- Geographic sharding (Americas, Europe, Asia)
- Advanced search with Elasticsearch
- SMS notifications (Twilio)
- Analytics and reporting
- Mobile apps (iOS + Android)

## 💰 Monetization Strategy (Optional)

**Free Tier** (Always Free)
- Find nearby mosques
- View prayer timings
- Basic notifications
- Up to 3 favorites

**Premium** ($2.99/month or $24.99/year)
- Unlimited favorites
- SMS notifications
- Priority support
- Ad-free experience
- Custom prayer reminders

**Mosque Admin** ($9.99/month per mosque)
- Official mosque account
- Direct timing updates
- Analytics dashboard
- Event announcements
- Verified badge

**Alternative: Donation-Based**
- Keep all features free
- Accept voluntary donations
- Transparency in costs
- Community-supported

## 📈 Success Metrics

### User Engagement
- Daily Active Users (DAU)
- Monthly Active Users (MAU)
- Average session duration
- Favorite mosques per user
- Contribution rate (% of users submitting timings)

### Data Quality
- Timing accuracy (verified vs. disputed)
- Update frequency (days since last update)
- Contributor trust scores
- Verification response rate

### Business
- User acquisition cost
- Retention rate (Day 1, Day 7, Day 30)
- Notification open rates
- Premium conversion (if applicable)

## 🤝 Contributing

### How to Contribute

1. **For Developers**
   - Set up local environment
   - Pick an issue from GitHub
   - Submit PR with tests
   - Follow code style guide

2. **For Designers**
   - Improve UI/UX
   - Create icons and illustrations
   - Design mobile app mockups

3. **For Community**
   - Add mosques in your area
   - Submit accurate prayer timings
   - Verify other submissions
   - Report bugs

4. **For Translators**
   - Translate app to your language
   - Localize content
   - Review translations

## 📞 Support & Community

- **GitHub Issues**: Bug reports and feature requests
- **Discussions**: General questions and ideas
- **Discord** (to be created): Real-time chat
- **Twitter** (to be created): Updates and announcements

## 📜 License

MIT License - Free to use, modify, and distribute

## 🙏 Acknowledgments

- PostGIS for excellent geospatial support
- Google Maps for mapping infrastructure
- Muslim community for inspiration
- Open source contributors

---

## Quick Links

📖 [Full Documentation](README.md)
⚡ [Quick Start Guide](QUICKSTART.md)
✨ [Feature Details](FEATURES.md)
🗄️ [Database Schema](database/README.md)
🔍 [Database Comparison](database/database-comparison.md)

---

**Built with ❤️ for the Muslim community**

*Last Updated: November 2025*
