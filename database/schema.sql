-- ============================================
-- JAMAT - Database Schema
-- PostgreSQL 14+ with PostGIS 3+
-- ============================================

-- Enable PostGIS extension for geospatial queries
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm; -- For fuzzy text search
CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; -- For UUID generation

-- ============================================
-- USERS TABLE
-- ============================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    phone_number VARCHAR(20),

    -- Reputation system
    reputation_points INTEGER DEFAULT 0,
    verified_contributor BOOLEAN DEFAULT FALSE,

    -- Settings
    preferred_language VARCHAR(10) DEFAULT 'en',
    notification_preferences JSONB DEFAULT '{"prayer_reminders": true, "timing_updates": true}'::jsonb,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login_at TIMESTAMP WITH TIME ZONE,

    -- Soft delete
    deleted_at TIMESTAMP WITH TIME ZONE,

    CONSTRAINT email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

CREATE INDEX idx_users_email ON users(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_reputation ON users(reputation_points DESC);

-- ============================================
-- MOSQUES TABLE
-- ============================================
CREATE TABLE mosques (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Basic Information
    name VARCHAR(255) NOT NULL,
    name_arabic VARCHAR(255),
    description TEXT,

    -- Location
    location GEOGRAPHY(POINT, 4326) NOT NULL, -- PostGIS geography type for accurate distance calculations
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    city VARCHAR(100) NOT NULL,
    state_province VARCHAR(100),
    country VARCHAR(100) NOT NULL,
    postal_code VARCHAR(20),

    -- Contact
    phone_number VARCHAR(20),
    email VARCHAR(255),
    website VARCHAR(500),

    -- Metadata
    capacity INTEGER, -- Number of worshippers
    year_established INTEGER,
    denomination VARCHAR(50), -- Sunni, Shia, etc.
    madhab VARCHAR(50), -- Hanafi, Shafi, Maliki, Hanbali

    -- Features & Amenities (stored as array)
    amenities TEXT[] DEFAULT '{}',
    -- Example: ['parking', 'wudu_facilities', 'womens_section', 'wheelchair_accessible', 'library', 'school']

    -- Images
    photos JSONB DEFAULT '[]'::jsonb,
    -- Example: [{"url": "https://...", "caption": "Main hall", "uploaded_by": "uuid"}]

    -- Status
    verified BOOLEAN DEFAULT FALSE,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending_review', 'closed')),

    -- Statistics
    view_count INTEGER DEFAULT 0,
    favorite_count INTEGER DEFAULT 0,
    contributor_count INTEGER DEFAULT 0,

    -- Contribution tracking
    added_by UUID REFERENCES users(id),

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Critical geospatial index for "find nearby" queries
CREATE INDEX idx_mosques_location ON mosques USING GIST(location) WHERE deleted_at IS NULL AND status = 'active';

-- Text search indexes
CREATE INDEX idx_mosques_name_trgm ON mosques USING GIN(name gin_trgm_ops);
CREATE INDEX idx_mosques_city ON mosques(city) WHERE deleted_at IS NULL;
CREATE INDEX idx_mosques_country ON mosques(country) WHERE deleted_at IS NULL;

-- Composite index for common filters
CREATE INDEX idx_mosques_active ON mosques(status, verified) WHERE deleted_at IS NULL;

-- ============================================
-- PRAYER TIMINGS TABLE
-- ============================================
-- Stores prayer schedules that can change seasonally
CREATE TABLE prayer_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mosque_id UUID NOT NULL REFERENCES mosques(id) ON DELETE CASCADE,

    -- Schedule metadata
    schedule_name VARCHAR(100), -- e.g., "Winter 2025", "Ramadan 1446", "Standard"
    is_active BOOLEAN DEFAULT TRUE,

    -- Date range this schedule is valid
    valid_from DATE NOT NULL,
    valid_until DATE, -- NULL means indefinite

    -- Prayer times stored as time without timezone (local mosque time)
    -- Using JSONB for flexibility to handle variations
    timings JSONB NOT NULL,
    /* Example structure:
    {
        "fajr": {"adhan": "05:30", "iqamah": "05:45"},
        "sunrise": {"time": "07:00"},
        "zuhr": {"adhan": "13:00", "iqamah": "13:15"},
        "asr": {"adhan": "16:30", "iqamah": "16:45"},
        "maghrib": {"adhan": "18:00", "iqamah": "18:05"},
        "isha": {"adhan": "19:30", "iqamah": "19:45"},
        "jummah": [
            {"adhan": "13:00", "iqamah": "13:20"},
            {"adhan": "14:00", "iqamah": "14:20"}
        ]
    }
    */

    -- Calculation method for automated times
    calculation_method VARCHAR(50), -- ISNA, MWL, Egypt, Makkah, Karachi, Tehran, Jafari
    calculation_params JSONB, -- Custom parameters if needed

    -- Notes
    notes TEXT,

    -- Contribution tracking
    submitted_by UUID REFERENCES users(id),
    verified_by UUID REFERENCES users(id),
    verification_status VARCHAR(20) DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected')),

    -- Community feedback
    upvotes INTEGER DEFAULT 0,
    downvotes INTEGER DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_prayer_schedules_mosque ON prayer_schedules(mosque_id, is_active) WHERE deleted_at IS NULL;
CREATE INDEX idx_prayer_schedules_dates ON prayer_schedules(valid_from, valid_until) WHERE deleted_at IS NULL;

-- ============================================
-- PRAYER TIMING SUBMISSIONS TABLE
-- ============================================
-- Community-submitted timing updates (before they become official schedules)
CREATE TABLE timing_submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mosque_id UUID NOT NULL REFERENCES mosques(id) ON DELETE CASCADE,
    submitted_by UUID NOT NULL REFERENCES users(id),

    -- Submitted timings
    timings JSONB NOT NULL,
    notes TEXT,

    -- Verification
    verified BOOLEAN DEFAULT FALSE,
    is_verified_onsite BOOLEAN DEFAULT FALSE, -- Did submitter physically verify at mosque?

    -- Photos as proof
    proof_photos JSONB DEFAULT '[]'::jsonb,

    -- Status
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'merged')),
    reviewed_by UUID REFERENCES users(id),
    review_notes TEXT,

    -- Community voting
    upvotes INTEGER DEFAULT 0,
    downvotes INTEGER DEFAULT 0,
    reports INTEGER DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_timing_submissions_mosque ON timing_submissions(mosque_id, status);
CREATE INDEX idx_timing_submissions_user ON timing_submissions(submitted_by);
CREATE INDEX idx_timing_submissions_status ON timing_submissions(status, created_at DESC);

-- ============================================
-- USER FAVORITES TABLE
-- ============================================
CREATE TABLE user_favorites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mosque_id UUID NOT NULL REFERENCES mosques(id) ON DELETE CASCADE,

    -- Custom notes/tags for this favorite
    notes TEXT,
    tags TEXT[],

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(user_id, mosque_id)
);

CREATE INDEX idx_user_favorites_user ON user_favorites(user_id, created_at DESC);
CREATE INDEX idx_user_favorites_mosque ON user_favorites(mosque_id);

-- ============================================
-- MOSQUE REVIEWS/RATINGS TABLE
-- ============================================
CREATE TABLE mosque_reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mosque_id UUID NOT NULL REFERENCES mosques(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),

    -- Rating (1-5 stars)
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),

    -- Detailed ratings
    timing_accuracy_rating INTEGER CHECK (timing_accuracy_rating >= 1 AND timing_accuracy_rating <= 5),
    cleanliness_rating INTEGER CHECK (cleanliness_rating >= 1 AND cleanliness_rating <= 5),
    accessibility_rating INTEGER CHECK (accessibility_rating >= 1 AND accessibility_rating <= 5),

    -- Review text
    title VARCHAR(200),
    review_text TEXT,

    -- Helpful votes
    helpful_count INTEGER DEFAULT 0,

    -- Status
    status VARCHAR(20) DEFAULT 'published' CHECK (status IN ('published', 'flagged', 'removed')),

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(user_id, mosque_id) -- One review per user per mosque
);

CREATE INDEX idx_mosque_reviews_mosque ON mosque_reviews(mosque_id, status, created_at DESC);
CREATE INDEX idx_mosque_reviews_rating ON mosque_reviews(rating DESC);

-- ============================================
-- VOTING TABLE (for submissions and reviews)
-- ============================================
CREATE TABLE votes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Polymorphic reference (can vote on submissions, reviews, etc.)
    votable_type VARCHAR(50) NOT NULL CHECK (votable_type IN ('timing_submission', 'review', 'mosque')),
    votable_id UUID NOT NULL,

    -- Vote type
    vote_type VARCHAR(10) NOT NULL CHECK (vote_type IN ('upvote', 'downvote', 'report')),

    -- Report reason (if vote_type = 'report')
    report_reason VARCHAR(100),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(user_id, votable_type, votable_id)
);

CREATE INDEX idx_votes_votable ON votes(votable_type, votable_id);
CREATE INDEX idx_votes_user ON votes(user_id);

-- ============================================
-- ACTIVITY LOG TABLE
-- ============================================
CREATE TABLE activity_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,

    -- Activity details
    activity_type VARCHAR(50) NOT NULL,
    -- Examples: 'mosque_added', 'timing_submitted', 'review_posted', 'favorite_added'

    entity_type VARCHAR(50), -- 'mosque', 'submission', 'review'
    entity_id UUID,

    metadata JSONB DEFAULT '{}'::jsonb,

    -- IP and user agent for security
    ip_address INET,
    user_agent TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_activity_logs_user ON activity_logs(user_id, created_at DESC);
CREATE INDEX idx_activity_logs_type ON activity_logs(activity_type, created_at DESC);
CREATE INDEX idx_activity_logs_created ON activity_logs(created_at DESC);

-- ============================================
-- NOTIFICATIONS TABLE
-- ============================================
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Notification details
    type VARCHAR(50) NOT NULL,
    -- Examples: 'timing_updated', 'submission_approved', 'prayer_reminder'

    title VARCHAR(255) NOT NULL,
    message TEXT,

    -- Related entity
    entity_type VARCHAR(50),
    entity_id UUID,

    -- Status
    read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP WITH TIME ZONE,

    -- Delivery
    sent_via JSONB DEFAULT '{"push": false, "email": false, "sms": false}'::jsonb,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_unread ON notifications(user_id, read, created_at DESC);

-- ============================================
-- MATERIALIZED VIEW: Mosque Statistics
-- ============================================
-- Pre-computed statistics for faster queries
CREATE MATERIALIZED VIEW mosque_stats AS
SELECT
    m.id AS mosque_id,
    m.name,
    m.city,
    m.country,
    COUNT(DISTINCT uf.user_id) AS favorite_count,
    COUNT(DISTINCT ts.id) AS submission_count,
    COUNT(DISTINCT mr.id) AS review_count,
    AVG(mr.rating) AS average_rating,
    AVG(mr.timing_accuracy_rating) AS avg_timing_accuracy,
    MAX(ts.created_at) AS last_timing_update
FROM mosques m
LEFT JOIN user_favorites uf ON m.id = uf.mosque_id
LEFT JOIN timing_submissions ts ON m.id = ts.mosque_id AND ts.status = 'approved'
LEFT JOIN mosque_reviews mr ON m.id = mr.mosque_id AND mr.status = 'published'
WHERE m.deleted_at IS NULL AND m.status = 'active'
GROUP BY m.id, m.name, m.city, m.country;

CREATE UNIQUE INDEX idx_mosque_stats_id ON mosque_stats(mosque_id);
CREATE INDEX idx_mosque_stats_rating ON mosque_stats(average_rating DESC NULLS LAST);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Function to find nearby mosques
CREATE OR REPLACE FUNCTION find_nearby_mosques(
    user_lat DOUBLE PRECISION,
    user_lng DOUBLE PRECISION,
    radius_km DOUBLE PRECISION DEFAULT 5.0,
    result_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
    mosque_id UUID,
    name VARCHAR,
    city VARCHAR,
    distance_km DOUBLE PRECISION,
    average_rating NUMERIC,
    favorite_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        m.id,
        m.name,
        m.city,
        ST_Distance(
            m.location,
            ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography
        ) / 1000.0 AS distance_km,
        ms.average_rating,
        ms.favorite_count
    FROM mosques m
    LEFT JOIN mosque_stats ms ON m.id = ms.mosque_id
    WHERE
        m.deleted_at IS NULL
        AND m.status = 'active'
        AND ST_DWithin(
            m.location,
            ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography,
            radius_km * 1000
        )
    ORDER BY distance_km ASC
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to get active prayer schedule for a mosque
CREATE OR REPLACE FUNCTION get_active_prayer_schedule(p_mosque_id UUID)
RETURNS TABLE (
    schedule_id UUID,
    timings JSONB,
    schedule_name VARCHAR,
    valid_from DATE,
    valid_until DATE
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ps.id,
        ps.timings,
        ps.schedule_name,
        ps.valid_from,
        ps.valid_until
    FROM prayer_schedules ps
    WHERE
        ps.mosque_id = p_mosque_id
        AND ps.is_active = TRUE
        AND ps.deleted_at IS NULL
        AND ps.valid_from <= CURRENT_DATE
        AND (ps.valid_until IS NULL OR ps.valid_until >= CURRENT_DATE)
    ORDER BY ps.created_at DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Function to update user reputation
CREATE OR REPLACE FUNCTION update_user_reputation(
    p_user_id UUID,
    p_points INTEGER,
    p_reason VARCHAR DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
    UPDATE users
    SET
        reputation_points = reputation_points + p_points,
        updated_at = NOW()
    WHERE id = p_user_id;

    -- Check for verified contributor status (500+ points)
    UPDATE users
    SET verified_contributor = TRUE
    WHERE id = p_user_id AND reputation_points >= 500;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TRIGGERS
-- ============================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_mosques_updated_at BEFORE UPDATE ON mosques
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Auto-increment favorite count when favorite is added
CREATE OR REPLACE FUNCTION increment_favorite_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE mosques
    SET favorite_count = favorite_count + 1
    WHERE id = NEW.mosque_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_increment_favorite_count AFTER INSERT ON user_favorites
    FOR EACH ROW EXECUTE FUNCTION increment_favorite_count();

-- Auto-decrement favorite count when favorite is removed
CREATE OR REPLACE FUNCTION decrement_favorite_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE mosques
    SET favorite_count = favorite_count - 1
    WHERE id = OLD.mosque_id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_decrement_favorite_count AFTER DELETE ON user_favorites
    FOR EACH ROW EXECUTE FUNCTION decrement_favorite_count();

-- ============================================
-- SAMPLE DATA
-- ============================================

-- Insert sample user
INSERT INTO users (email, password_hash, full_name, reputation_points)
VALUES ('demo@jamat.app', '$2b$10$demo_hash', 'Demo User', 100);

-- Insert sample mosques
INSERT INTO mosques (name, name_arabic, location, city, country, phone_number, amenities, added_by)
VALUES
    (
        'Central Jamia Masjid',
        'جامع مسجد مرکزی',
        ST_SetSRID(ST_MakePoint(74.3587, 31.5204), 4326)::geography,
        'Lahore',
        'Pakistan',
        '+92-300-1234567',
        ARRAY['parking', 'wudu_facilities', 'womens_section', 'wheelchair_accessible'],
        (SELECT id FROM users LIMIT 1)
    ),
    (
        'Jamia Masjid Noor',
        'جامع مسجد نور',
        ST_SetSRID(ST_MakePoint(74.3327, 31.5044), 4326)::geography,
        'Lahore',
        'Pakistan',
        NULL,
        ARRAY['wudu_facilities', 'womens_section', 'library'],
        (SELECT id FROM users LIMIT 1)
    ),
    (
        'Masjid Bilal',
        'مسجد بلال',
        ST_SetSRID(ST_MakePoint(74.3487, 31.5304), 4326)::geography,
        'Lahore',
        'Pakistan',
        '+92-333-9876543',
        ARRAY['parking', 'wudu_facilities', 'womens_section', 'wheelchair_accessible', 'school'],
        (SELECT id FROM users LIMIT 1)
    );

-- Insert sample prayer schedules
INSERT INTO prayer_schedules (mosque_id, schedule_name, valid_from, timings, submitted_by, verification_status)
SELECT
    id,
    'Winter 2025',
    '2025-01-01',
    '{"fajr": {"adhan": "05:30", "iqamah": "05:45"}, "zuhr": {"adhan": "13:00", "iqamah": "13:15"}, "asr": {"adhan": "16:30", "iqamah": "16:45"}, "maghrib": {"adhan": "18:00", "iqamah": "18:05"}, "isha": {"adhan": "19:30", "iqamah": "19:45"}}'::jsonb,
    (SELECT id FROM users LIMIT 1),
    'verified'
FROM mosques;

-- Refresh materialized view
REFRESH MATERIALIZED VIEW mosque_stats;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE mosques IS 'Global directory of mosques with geospatial data';
COMMENT ON COLUMN mosques.location IS 'PostGIS geography point (longitude, latitude) for accurate distance calculations';
COMMENT ON TABLE prayer_schedules IS 'Prayer timing schedules that can vary seasonally';
COMMENT ON TABLE timing_submissions IS 'Community-submitted timing updates pending review';
COMMENT ON FUNCTION find_nearby_mosques IS 'Find mosques within specified radius of user location';
