-- ============================================
-- JAMAT - New Features Schema Updates
-- Prayer Reminders & Collaborative Verification
-- ============================================

-- ============================================
-- FEATURE 0: DEFAULT MOSQUE
-- ============================================

-- Add default mosque to users table
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS default_mosque_id UUID REFERENCES mosques(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS default_mosque_set_at TIMESTAMP WITH TIME ZONE;

-- Index for quick lookup
CREATE INDEX idx_users_default_mosque ON users(default_mosque_id) WHERE default_mosque_id IS NOT NULL;

COMMENT ON COLUMN users.default_mosque_id IS 'User''s primary/home mosque - shown by default on app open';
COMMENT ON COLUMN users.default_mosque_set_at IS 'When user set their default mosque (for analytics)';

-- Function to set default mosque for a user
CREATE OR REPLACE FUNCTION set_default_mosque(
    p_user_id UUID,
    p_mosque_id UUID
)
RETURNS VOID AS $$
BEGIN
    UPDATE users
    SET
        default_mosque_id = p_mosque_id,
        default_mosque_set_at = NOW(),
        updated_at = NOW()
    WHERE id = p_user_id;

    -- Auto-create prayer reminders for default mosque if not exists
    INSERT INTO prayer_reminders (user_id, mosque_id, is_active)
    VALUES (p_user_id, p_mosque_id, TRUE)
    ON CONFLICT (user_id, mosque_id) DO NOTHING;

    -- Auto-favorite the default mosque
    INSERT INTO user_favorites (user_id, mosque_id)
    VALUES (p_user_id, p_mosque_id)
    ON CONFLICT (user_id, mosque_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Function to get user's default mosque with timings
CREATE OR REPLACE FUNCTION get_user_default_mosque(p_user_id UUID)
RETURNS TABLE (
    mosque_id UUID,
    mosque_name VARCHAR,
    address VARCHAR,
    city VARCHAR,
    distance_km DOUBLE PRECISION,
    current_schedule JSONB,
    next_prayer VARCHAR,
    next_prayer_time TIME,
    time_until_prayer INTERVAL
) AS $$
DECLARE
    v_mosque_id UUID;
    v_user_location GEOGRAPHY;
BEGIN
    -- Get user's default mosque
    SELECT default_mosque_id INTO v_mosque_id
    FROM users
    WHERE id = p_user_id;

    IF v_mosque_id IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        m.id,
        m.name,
        m.address_line1,
        m.city,
        CASE
            WHEN v_user_location IS NOT NULL
            THEN ST_Distance(m.location, v_user_location) / 1000.0
            ELSE NULL
        END AS distance_km,
        ps.timings AS current_schedule,
        np.prayer_name::VARCHAR,
        np.prayer_time,
        (np.full_datetime - NOW())::INTERVAL AS time_until
    FROM mosques m
    LEFT JOIN LATERAL get_active_prayer_schedule(m.id) ps ON TRUE
    LEFT JOIN LATERAL get_next_prayer_for_reminder(m.id) np ON TRUE
    WHERE m.id = v_mosque_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- FEATURE 1: PRAYER REMINDERS
-- ============================================

-- Prayer reminder preferences for each user
CREATE TABLE prayer_reminders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mosque_id UUID NOT NULL REFERENCES mosques(id) ON DELETE CASCADE,

    -- Which prayers to get notified for
    enabled_prayers JSONB NOT NULL DEFAULT '{
        "fajr": true,
        "zuhr": false,
        "asr": false,
        "maghrib": true,
        "isha": false,
        "jummah": true
    }'::jsonb,

    -- Minutes before jamaat to send notification
    -- Can be different for each prayer
    reminder_offsets JSONB NOT NULL DEFAULT '{
        "fajr": 15,
        "zuhr": 10,
        "asr": 10,
        "maghrib": 10,
        "isha": 15,
        "jummah": 20
    }'::jsonb,

    -- Notification channels
    notification_channels JSONB NOT NULL DEFAULT '{
        "push": true,
        "email": false,
        "sms": false
    }'::jsonb,

    -- Active status
    is_active BOOLEAN DEFAULT TRUE,

    -- Temporary disable (e.g., during travel)
    pause_until TIMESTAMP WITH TIME ZONE,

    -- Days of week to send reminders (for working schedule)
    active_days INTEGER[] DEFAULT ARRAY[0,1,2,3,4,5,6],
    -- 0 = Sunday, 1 = Monday, etc.

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- One reminder config per mosque per user
    UNIQUE(user_id, mosque_id)
);

CREATE INDEX idx_prayer_reminders_user ON prayer_reminders(user_id, is_active);
CREATE INDEX idx_prayer_reminders_mosque ON prayer_reminders(mosque_id);

-- Table to track sent reminders (prevent duplicates)
CREATE TABLE sent_reminders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    prayer_reminder_id UUID NOT NULL REFERENCES prayer_reminders(id) ON DELETE CASCADE,
    mosque_id UUID NOT NULL REFERENCES mosques(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- What reminder was sent
    prayer_name VARCHAR(20) NOT NULL,
    prayer_time TIME NOT NULL,
    scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Delivery status
    channels_sent JSONB, -- {"push": true, "email": false, "sms": false}
    delivery_status VARCHAR(20) DEFAULT 'sent' CHECK (delivery_status IN ('sent', 'failed', 'delivered', 'read')),

    -- Engagement tracking
    opened_at TIMESTAMP WITH TIME ZONE,
    clicked_at TIMESTAMP WITH TIME ZONE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_sent_reminders_user_date ON sent_reminders(user_id, sent_at DESC);
CREATE INDEX idx_sent_reminders_prayer ON sent_reminders(prayer_reminder_id, scheduled_for);

-- ============================================
-- FEATURE 2: COLLABORATIVE VERIFICATION
-- ============================================

-- Track which mosques each user has contributed to
-- This determines who gets notified about updates
CREATE TABLE user_mosque_contributions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mosque_id UUID NOT NULL REFERENCES mosques(id) ON DELETE CASCADE,

    -- Contribution stats
    total_submissions INTEGER DEFAULT 0,
    approved_submissions INTEGER DEFAULT 0,
    rejected_submissions INTEGER DEFAULT 0,

    -- Last contribution
    last_submission_at TIMESTAMP WITH TIME ZONE,
    last_approved_at TIMESTAMP WITH TIME ZONE,

    -- Trust level for this specific mosque (0-100)
    trust_score INTEGER DEFAULT 50,

    -- Notification preferences for this mosque
    notify_on_updates BOOLEAN DEFAULT TRUE,
    notify_on_disputes BOOLEAN DEFAULT TRUE,

    -- Status
    is_top_contributor BOOLEAN DEFAULT FALSE,
    -- Auto-set to TRUE if user is in top 5 contributors for this mosque

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(user_id, mosque_id)
);

CREATE INDEX idx_user_contributions_user ON user_mosque_contributions(user_id);
CREATE INDEX idx_user_contributions_mosque ON user_mosque_contributions(mosque_id, approved_submissions DESC);
CREATE INDEX idx_user_contributions_top ON user_mosque_contributions(mosque_id, is_top_contributor) WHERE is_top_contributor = TRUE;

-- Verification requests for timing submissions
CREATE TABLE verification_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    timing_submission_id UUID NOT NULL REFERENCES timing_submissions(id) ON DELETE CASCADE,
    mosque_id UUID NOT NULL REFERENCES mosques(id) ON DELETE CASCADE,

    -- Who is requested to verify
    requested_from UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Submission details for quick reference
    submitted_by UUID NOT NULL REFERENCES users(id),
    submitted_timings JSONB NOT NULL,

    -- Verification response
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'skipped')),
    verified_at TIMESTAMP WITH TIME ZONE,
    verification_notes TEXT,

    -- Did they copy the timings to their own submission?
    copied_to_own_submission BOOLEAN DEFAULT FALSE,

    -- Notification tracking
    notification_sent_at TIMESTAMP WITH TIME ZONE,
    notification_read_at TIMESTAMP WITH TIME ZONE,

    -- Expiry (auto-skip after 7 days)
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '7 days'),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_verification_requests_user ON verification_requests(requested_from, status);
CREATE INDEX idx_verification_requests_submission ON verification_requests(timing_submission_id);
CREATE INDEX idx_verification_requests_expires ON verification_requests(expires_at) WHERE status = 'pending';

-- Timing disputes (when contributors disagree)
CREATE TABLE timing_disputes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mosque_id UUID NOT NULL REFERENCES mosques(id) ON DELETE CASCADE,

    -- Competing submissions
    submission_a_id UUID NOT NULL REFERENCES timing_submissions(id),
    submission_b_id UUID NOT NULL REFERENCES timing_submissions(id),

    -- Which timings differ
    disputed_prayers TEXT[], -- e.g., ['fajr', 'zuhr']

    -- Community resolution
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'admin_review')),
    winning_submission_id UUID REFERENCES timing_submissions(id),

    -- Community votes
    votes_for_a INTEGER DEFAULT 0,
    votes_for_b INTEGER DEFAULT 0,

    -- Resolution
    resolved_by UUID REFERENCES users(id),
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolution_notes TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_timing_disputes_mosque ON timing_disputes(mosque_id, status);
CREATE INDEX idx_timing_disputes_active ON timing_disputes(status) WHERE status = 'active';

-- ============================================
-- UPDATED TIMING SUBMISSIONS TABLE
-- Add fields for verification workflow
-- ============================================

ALTER TABLE timing_submissions
    ADD COLUMN IF NOT EXISTS verification_count INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS verified_by_contributors UUID[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS auto_approved BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS confidence_score INTEGER DEFAULT 50;
    -- Confidence increases with verifications, decreases with rejections

COMMENT ON COLUMN timing_submissions.verification_count IS 'Number of other contributors who verified this submission';
COMMENT ON COLUMN timing_submissions.verified_by_contributors IS 'Array of user IDs who verified this';
COMMENT ON COLUMN timing_submissions.confidence_score IS 'Score 0-100 based on verifications and submitter reputation';

-- ============================================
-- FUNCTIONS
-- ============================================

-- Function to get next prayer time for reminder scheduling
CREATE OR REPLACE FUNCTION get_next_prayer_for_reminder(
    p_mosque_id UUID,
    p_current_time TIMESTAMP WITH TIME ZONE DEFAULT NOW()
)
RETURNS TABLE (
    prayer_name VARCHAR,
    prayer_time TIME,
    full_datetime TIMESTAMP WITH TIME ZONE
) AS $$
DECLARE
    v_schedule RECORD;
    v_today DATE := p_current_time::DATE;
    v_current_time TIME := p_current_time::TIME;
BEGIN
    -- Get active prayer schedule
    SELECT timings INTO v_schedule
    FROM prayer_schedules
    WHERE mosque_id = p_mosque_id
        AND is_active = TRUE
        AND deleted_at IS NULL
        AND valid_from <= v_today
        AND (valid_until IS NULL OR valid_until >= v_today)
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_schedule IS NULL THEN
        RETURN;
    END IF;

    -- Return next upcoming prayer
    RETURN QUERY
    WITH prayer_times AS (
        SELECT 'fajr' AS name, (v_schedule.timings->>'fajr')::TIME AS time
        UNION ALL SELECT 'zuhr', (v_schedule.timings->>'zuhr')::TIME
        UNION ALL SELECT 'asr', (v_schedule.timings->>'asr')::TIME
        UNION ALL SELECT 'maghrib', (v_schedule.timings->>'maghrib')::TIME
        UNION ALL SELECT 'isha', (v_schedule.timings->>'isha')::TIME
    )
    SELECT
        pt.name::VARCHAR,
        pt.time,
        (v_today || ' ' || pt.time)::TIMESTAMP WITH TIME ZONE
    FROM prayer_times pt
    WHERE pt.time > v_current_time
    ORDER BY pt.time ASC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Function to schedule reminders for a user
CREATE OR REPLACE FUNCTION schedule_user_reminders(p_user_id UUID)
RETURNS TABLE (
    reminder_id UUID,
    mosque_name VARCHAR,
    prayer_name VARCHAR,
    send_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    WITH user_reminders AS (
        SELECT
            pr.id,
            pr.mosque_id,
            m.name AS mosque_name,
            pr.enabled_prayers,
            pr.reminder_offsets,
            pr.is_active,
            pr.pause_until
        FROM prayer_reminders pr
        JOIN mosques m ON pr.mosque_id = m.id
        WHERE pr.user_id = p_user_id
            AND pr.is_active = TRUE
            AND (pr.pause_until IS NULL OR pr.pause_until < NOW())
    ),
    next_prayers AS (
        SELECT
            ur.id AS reminder_id,
            ur.mosque_name,
            np.prayer_name,
            np.full_datetime,
            ur.reminder_offsets
        FROM user_reminders ur
        CROSS JOIN LATERAL get_next_prayer_for_reminder(ur.mosque_id) AS np
    )
    SELECT
        np.reminder_id::UUID,
        np.mosque_name::VARCHAR,
        np.prayer_name::VARCHAR,
        (np.full_datetime - ((np.reminder_offsets->>np.prayer_name)::INTEGER || ' minutes')::INTERVAL)::TIMESTAMP WITH TIME ZONE
    FROM next_prayers np;
END;
$$ LANGUAGE plpgsql;

-- Function to get top contributors for a mosque
CREATE OR REPLACE FUNCTION get_top_contributors(
    p_mosque_id UUID,
    p_limit INTEGER DEFAULT 5
)
RETURNS TABLE (
    user_id UUID,
    full_name VARCHAR,
    approved_submissions INTEGER,
    trust_score INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        u.id,
        u.full_name,
        umc.approved_submissions,
        umc.trust_score
    FROM user_mosque_contributions umc
    JOIN users u ON umc.user_id = u.id
    WHERE umc.mosque_id = p_mosque_id
        AND u.deleted_at IS NULL
    ORDER BY umc.approved_submissions DESC, umc.trust_score DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to create verification requests when timing is submitted
CREATE OR REPLACE FUNCTION create_verification_requests_for_submission(
    p_submission_id UUID
)
RETURNS INTEGER AS $$
DECLARE
    v_submission RECORD;
    v_contributor RECORD;
    v_count INTEGER := 0;
BEGIN
    -- Get submission details
    SELECT mosque_id, submitted_by, timings
    INTO v_submission
    FROM timing_submissions
    WHERE id = p_submission_id;

    -- Create verification requests for top contributors
    FOR v_contributor IN
        SELECT user_id
        FROM user_mosque_contributions
        WHERE mosque_id = v_submission.mosque_id
            AND user_id != v_submission.submitted_by
            AND is_top_contributor = TRUE
            AND notify_on_updates = TRUE
    LOOP
        INSERT INTO verification_requests (
            timing_submission_id,
            mosque_id,
            requested_from,
            submitted_by,
            submitted_timings
        ) VALUES (
            p_submission_id,
            v_submission.mosque_id,
            v_contributor.user_id,
            v_submission.submitted_by,
            v_submission.timings
        );

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Function to update contribution stats
CREATE OR REPLACE FUNCTION update_contribution_stats(
    p_user_id UUID,
    p_mosque_id UUID
)
RETURNS VOID AS $$
DECLARE
    v_stats RECORD;
BEGIN
    -- Calculate stats
    SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'approved') AS approved,
        COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
        MAX(created_at) FILTER (WHERE status = 'approved') AS last_approved
    INTO v_stats
    FROM timing_submissions
    WHERE submitted_by = p_user_id
        AND mosque_id = p_mosque_id;

    -- Upsert contribution record
    INSERT INTO user_mosque_contributions (
        user_id,
        mosque_id,
        total_submissions,
        approved_submissions,
        rejected_submissions,
        last_submission_at,
        last_approved_at,
        trust_score
    ) VALUES (
        p_user_id,
        p_mosque_id,
        v_stats.total,
        v_stats.approved,
        v_stats.rejected,
        NOW(),
        v_stats.last_approved,
        50 + (v_stats.approved * 5) - (v_stats.rejected * 10)
    )
    ON CONFLICT (user_id, mosque_id)
    DO UPDATE SET
        total_submissions = v_stats.total,
        approved_submissions = v_stats.approved,
        rejected_submissions = v_stats.rejected,
        last_submission_at = NOW(),
        last_approved_at = COALESCE(v_stats.last_approved, user_mosque_contributions.last_approved_at),
        trust_score = GREATEST(0, LEAST(100, 50 + (v_stats.approved * 5) - (v_stats.rejected * 10))),
        updated_at = NOW();

    -- Update top contributor flag
    UPDATE user_mosque_contributions
    SET is_top_contributor = (
        approved_submissions >= (
            SELECT COALESCE(MIN(approved_submissions), 0)
            FROM (
                SELECT approved_submissions
                FROM user_mosque_contributions
                WHERE mosque_id = p_mosque_id
                ORDER BY approved_submissions DESC
                LIMIT 5
            ) top5
        )
    )
    WHERE user_id = p_user_id AND mosque_id = p_mosque_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TRIGGERS
-- ============================================

-- Auto-create verification requests when submission is created
CREATE OR REPLACE FUNCTION trigger_create_verification_requests()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM create_verification_requests_for_submission(NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER after_timing_submission_insert
AFTER INSERT ON timing_submissions
FOR EACH ROW
EXECUTE FUNCTION trigger_create_verification_requests();

-- Auto-update contribution stats when submission status changes
CREATE OR REPLACE FUNCTION trigger_update_contribution_stats()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status != OLD.status THEN
        PERFORM update_contribution_stats(NEW.submitted_by, NEW.mosque_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER after_timing_submission_status_update
AFTER UPDATE OF status ON timing_submissions
FOR EACH ROW
EXECUTE FUNCTION trigger_update_contribution_stats();

-- Auto-update confidence score based on verifications
CREATE OR REPLACE FUNCTION update_submission_confidence()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE timing_submissions
    SET
        verification_count = array_length(verified_by_contributors, 1),
        confidence_score = LEAST(100, 50 + (array_length(verified_by_contributors, 1) * 10) + (upvotes * 2) - (downvotes * 3))
    WHERE id = NEW.timing_submission_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER after_verification_response
AFTER UPDATE OF status ON verification_requests
FOR EACH ROW
WHEN (NEW.status = 'approved')
EXECUTE FUNCTION update_submission_confidence();

-- ============================================
-- SAMPLE DATA
-- ============================================

-- Add prayer reminders for demo user
INSERT INTO prayer_reminders (user_id, mosque_id, enabled_prayers, reminder_offsets)
SELECT
    (SELECT id FROM users LIMIT 1),
    id,
    '{"fajr": true, "zuhr": false, "asr": false, "maghrib": true, "isha": true, "jummah": true}'::jsonb,
    '{"fajr": 15, "maghrib": 10, "isha": 15, "jummah": 30}'::jsonb
FROM mosques
LIMIT 2;

-- Create some contribution history
INSERT INTO user_mosque_contributions (user_id, mosque_id, total_submissions, approved_submissions, trust_score, is_top_contributor, last_submission_at)
SELECT
    (SELECT id FROM users LIMIT 1),
    id,
    5,
    4,
    70,
    TRUE,
    NOW() - INTERVAL '2 days'
FROM mosques;

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

-- Composite index for reminder scheduling
CREATE INDEX idx_prayer_reminders_active_mosques
ON prayer_reminders(is_active, mosque_id)
WHERE is_active = TRUE AND (pause_until IS NULL OR pause_until < NOW());

-- Index for pending verification requests
CREATE INDEX idx_verification_pending
ON verification_requests(requested_from, status, expires_at)
WHERE status = 'pending';

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE prayer_reminders IS 'User preferences for prayer time notifications with customizable offsets';
COMMENT ON TABLE verification_requests IS 'Requests sent to top contributors to verify new timing submissions';
COMMENT ON TABLE user_mosque_contributions IS 'Tracks user contribution history per mosque to determine notification recipients';
COMMENT ON TABLE timing_disputes IS 'Handles conflicts when multiple trusted contributors submit different timings';
COMMENT ON FUNCTION get_next_prayer_for_reminder IS 'Calculates next upcoming prayer for a mosque based on current schedule';
COMMENT ON FUNCTION schedule_user_reminders IS 'Generates list of upcoming reminders to send for a user';
