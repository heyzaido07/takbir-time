# Database Architecture

## Technology Stack

### PostgreSQL 14+ with PostGIS 3+

**Why PostgreSQL + PostGIS?**

✅ **Best Geospatial Support**: PostGIS is the industry standard for location-based queries
✅ **Scalability**: Proven to handle billions of rows (Instagram, Spotify scale)
✅ **ACID Compliance**: Critical for prayer time data integrity
✅ **Flexible JSON**: JSONB for prayer schedules, amenities, metadata
✅ **Full-Text Search**: Built-in powerful search capabilities
✅ **Open Source**: Free, mature, huge community

## Schema Overview

### Core Tables

1. **`users`** - User accounts and profiles
2. **`mosques`** - Global mosque directory with geospatial data
3. **`prayer_schedules`** - Prayer timings (can vary seasonally)
4. **`timing_submissions`** - Community-submitted updates
5. **`user_favorites`** - User's saved mosques
6. **`mosque_reviews`** - Ratings and reviews
7. **`votes`** - Upvotes/downvotes for submissions
8. **`activity_logs`** - Audit trail
9. **`notifications`** - User notifications

### Key Design Decisions

#### 1. Geospatial Data (PostGIS)

```sql
-- Uses GEOGRAPHY type for accurate earth-surface distances
location GEOGRAPHY(POINT, 4326) NOT NULL

-- Find mosques within 5km
SELECT * FROM mosques
WHERE ST_DWithin(
    location,
    ST_MakePoint(user_lng, user_lat)::geography,
    5000  -- 5km in meters
);
```

**Why GEOGRAPHY over GEOMETRY?**
- GEOGRAPHY calculates real distances on earth's surface
- GEOMETRY treats earth as flat (faster but less accurate)
- For global app, accuracy matters more than microseconds

#### 2. Prayer Timings as JSONB

```sql
timings JSONB NOT NULL
-- Example:
{
  "fajr": {"adhan": "05:30", "iqamah": "05:45"},
  "zuhr": {"adhan": "13:00", "iqamah": "13:15"},
  "jummah": [
    {"adhan": "13:00", "iqamah": "13:20"},
    {"adhan": "14:00", "iqamah": "14:20"}  // Multiple Jummah prayers
  ]
}
```

**Why JSONB?**
- Flexible: Handles variations (some mosques have 2-3 Jummah prayers)
- Indexable: Can query inside JSON with GIN indexes
- Extensible: Easy to add new fields without schema changes
- Seasonal: Store Ramadan, DST, winter/summer schedules differently

#### 3. Temporal Prayer Schedules

```sql
valid_from DATE NOT NULL,
valid_until DATE  -- NULL = indefinite
```

**Why separate schedules?**
- Prayer times change seasonally
- Ramadan has special timings
- Daylight saving time adjustments
- Historical data preservation

#### 4. Soft Deletes

```sql
deleted_at TIMESTAMP WITH TIME ZONE
WHERE deleted_at IS NULL  -- Always filter deleted records
```

**Benefits:**
- Data recovery possible
- Audit trail maintained
- Foreign key references don't break

## Performance Optimization

### Critical Indexes

```sql
-- Geospatial index (GIST) for "nearby" queries
CREATE INDEX idx_mosques_location ON mosques USING GIST(location);

-- Trigram index for fuzzy name search
CREATE INDEX idx_mosques_name_trgm ON mosques USING GIN(name gin_trgm_ops);

-- Composite index for common filters
CREATE INDEX idx_mosques_active ON mosques(status, verified);
```

### Materialized View for Aggregations

```sql
CREATE MATERIALIZED VIEW mosque_stats AS
SELECT
    mosque_id,
    COUNT(favorites) AS favorite_count,
    AVG(rating) AS average_rating,
    MAX(last_update) AS last_timing_update
FROM mosques ...
```

**Refresh strategy:**
- Refresh nightly for most data
- Real-time triggers for critical stats (favorites, ratings)

## Scaling Strategy

### Phase 1: Single PostgreSQL Instance (0-100K users)
- Single region deployment
- Vertical scaling (bigger instance)
- Read replicas for read-heavy queries

### Phase 2: Regional Sharding (100K-1M users)
- **Shard by geography**: Americas, Europe, Asia, Africa, Oceania
- Each region has its own database
- Cross-region queries only when needed

```javascript
// Route to correct database based on user location
const db = getUserRegionDB(userCountry);
const mosques = await db.findNearbyMosques(lat, lng);
```

### Phase 3: Hybrid Approach (1M+ users)

**PostgreSQL for:**
- Mosque data
- User accounts
- Prayer schedules
- Transactions requiring ACID

**MongoDB/Elasticsearch for:**
- Activity logs (high-write volume)
- Search indexing (faster full-text)
- Analytics events

**Redis for:**
- Session management
- Rate limiting
- Caching popular mosques
- Real-time prayer time API

**S3/CDN for:**
- Mosque photos
- User profile pictures

## Query Patterns & Optimization

### 1. Find Nearby Mosques (Most Common)

```sql
-- Using PostGIS function (pre-built)
SELECT * FROM find_nearby_mosques(
    31.5204,  -- user latitude
    74.3587,  -- user longitude
    5.0,      -- radius in km
    20        -- limit results
);
```

**Performance:**
- Uses GIST index on location
- Returns results in ~5ms for millions of records
- Distance calculation done in database (faster than app)

### 2. Get Active Prayer Times

```sql
SELECT * FROM get_active_prayer_schedule('mosque-uuid');
```

**Returns:**
- Current valid schedule based on date
- Handles seasonal transitions automatically

### 3. Search Mosques by Name

```sql
-- Fuzzy search using trigram similarity
SELECT name, city, similarity(name, 'central jamia') AS score
FROM mosques
WHERE name % 'central jamia'  -- % is similarity operator
ORDER BY score DESC
LIMIT 10;
```

**Performance:**
- Handles typos ("centrl jama" still finds "Central Jamia")
- GIN index makes it fast

### 4. User's Favorite Mosques

```sql
SELECT m.*, ms.average_rating, ms.favorite_count
FROM mosques m
JOIN user_favorites uf ON m.id = uf.mosque_id
JOIN mosque_stats ms ON m.id = ms.mosque_id
WHERE uf.user_id = 'user-uuid'
ORDER BY uf.created_at DESC;
```

## Data Integrity

### Constraints

```sql
-- Email format validation
CONSTRAINT email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@...')

-- Rating range
CONSTRAINT rating_range CHECK (rating >= 1 AND rating <= 5)

-- Status enum
CONSTRAINT valid_status CHECK (status IN ('active', 'inactive', ...))
```

### Foreign Keys with Cascades

```sql
-- When mosque is deleted, remove all related data
mosque_id UUID REFERENCES mosques(id) ON DELETE CASCADE

-- When user is deleted, keep their contributions but anonymize
added_by UUID REFERENCES users(id) ON DELETE SET NULL
```

### Triggers for Automation

```sql
-- Auto-update favorite count when user favorites/unfavorites
CREATE TRIGGER increment_favorite_count
AFTER INSERT ON user_favorites
FOR EACH ROW EXECUTE increment_favorite_count();

-- Auto-update updated_at timestamp
CREATE TRIGGER update_mosques_updated_at
BEFORE UPDATE ON mosques
FOR EACH ROW EXECUTE update_updated_at_column();
```

## Backup Strategy

### Daily Backups
```bash
pg_dump -Fc jamat_db > backup_$(date +%Y%m%d).dump
```

### Point-in-Time Recovery (PITR)
- Enable WAL archiving
- Keep 7 days of WAL files
- Can restore to any point in last week

### Replication
- 1 primary + 2 read replicas
- Synchronous replication for critical writes
- Asynchronous for read replicas

## Migration Strategy

### Using Flyway or Liquibase

```
migrations/
├── V1__initial_schema.sql
├── V2__add_mosque_photos.sql
├── V3__add_prayer_calculation_methods.sql
└── V4__add_amenities_table.sql
```

**Version control migrations:**
- Every schema change is a new migration
- Never modify existing migrations
- Can rollback to any version

## Cost Estimation

### AWS RDS PostgreSQL (Example)

**Starter (0-10K users):**
- db.t3.medium: $65/month
- 100GB storage: $11.50/month
- **Total: ~$80/month**

**Growth (10K-100K users):**
- db.r6g.xlarge: $220/month
- 500GB storage: $57.50/month
- Read replica: $220/month
- **Total: ~$500/month**

**Scale (100K-1M users):**
- db.r6g.4xlarge: $880/month
- 2TB storage: $230/month
- 2 read replicas: $1,760/month
- **Total: ~$2,870/month**

### Cheaper Alternative: Supabase (Managed PostgreSQL)

- **Free tier**: 500MB database, 50K rows
- **Pro ($25/month)**: 8GB database, unlimited rows
- **Includes:** PostGIS, automatic backups, REST API, auth

## Security

### Row-Level Security (RLS)

```sql
-- Users can only see their own favorites
CREATE POLICY favorites_policy ON user_favorites
    FOR SELECT USING (auth.uid() = user_id);

-- Only verified users can submit timings
CREATE POLICY submit_timings ON timing_submissions
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM users
            WHERE id = auth.uid() AND reputation_points >= 50
        )
    );
```

### Encryption
- **At rest**: AWS RDS encryption enabled
- **In transit**: SSL/TLS required for connections
- **Sensitive data**: Password hashes (bcrypt), email encryption

### Rate Limiting (Application Layer)
```javascript
// Redis-based rate limiting
const MAX_SUBMISSIONS_PER_DAY = 10;
```

## Monitoring

### Key Metrics

1. **Query Performance**
   - Slow query log (queries > 100ms)
   - pg_stat_statements extension

2. **Database Size**
   - Table sizes
   - Index sizes
   - Growth rate

3. **Connection Pool**
   - Active connections
   - Waiting connections
   - Connection errors

4. **Replication Lag**
   - Primary-replica delay
   - Alert if > 10 seconds

### Tools
- **pgAdmin**: Visual query builder
- **pg_stat_statements**: Query analytics
- **pgBadger**: Log analyzer
- **Datadog/NewRelic**: APM monitoring

## API Design (Backend Recommendation)

### Tech Stack Suggestion

**Node.js + Express + Prisma (ORM)**

```javascript
// Example: Find nearby mosques
app.get('/api/mosques/nearby', async (req, res) => {
    const { lat, lng, radius = 5 } = req.query;

    const mosques = await prisma.$queryRaw`
        SELECT * FROM find_nearby_mosques(
            ${lat}::double precision,
            ${lng}::double precision,
            ${radius}::double precision,
            20
        )
    `;

    res.json(mosques);
});
```

**Alternatives:**
- **Python + FastAPI + SQLAlchemy**: Better for data science
- **Go + Gin + GORM**: Best performance
- **Ruby on Rails + ActiveRecord**: Rapid development

## Next Steps

1. **Set up PostgreSQL + PostGIS**
   ```bash
   # Docker
   docker run --name jamat-postgres \
       -e POSTGRES_PASSWORD=password \
       -p 5432:5432 \
       postgis/postgis:14-3.3
   ```

2. **Run schema.sql**
   ```bash
   psql -U postgres -d jamat_db -f schema.sql
   ```

3. **Test geospatial queries**
   ```sql
   SELECT * FROM find_nearby_mosques(31.5204, 74.3587, 10);
   ```

4. **Build REST API** (see `/api` folder for examples)

5. **Connect frontend** to backend API

---

**Questions? Check the main README or open an issue!**
