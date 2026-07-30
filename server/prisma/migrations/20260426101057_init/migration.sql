-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis" WITH VERSION "3.4.0";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "email" VARCHAR(255) NOT NULL,
    "firebase_uid" VARCHAR(255),
    "full_name" VARCHAR(255),
    "phone_number" VARCHAR(20),
    "reputation_points" INTEGER NOT NULL DEFAULT 0,
    "verified_contributor" BOOLEAN NOT NULL DEFAULT false,
    "preferred_language" VARCHAR(10) NOT NULL DEFAULT 'en',
    "notification_preferences" JSONB NOT NULL DEFAULT '{"prayer_reminders": true, "timing_updates": true}',
    "default_mosque_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "last_login_at" TIMESTAMPTZ,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mosques" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "name" VARCHAR(255) NOT NULL,
    "name_arabic" VARCHAR(255),
    "description" TEXT,
    "location" geography(Point, 4326) NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "address_line1" VARCHAR(255),
    "address_line2" VARCHAR(255),
    "city" VARCHAR(100) NOT NULL,
    "state_province" VARCHAR(100),
    "country" VARCHAR(100) NOT NULL,
    "postal_code" VARCHAR(20),
    "phone_number" VARCHAR(20),
    "email" VARCHAR(255),
    "website" VARCHAR(500),
    "capacity" INTEGER,
    "year_established" INTEGER,
    "denomination" VARCHAR(50),
    "madhab" VARCHAR(50),
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "photos" JSONB NOT NULL DEFAULT '[]',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "favorite_count" INTEGER NOT NULL DEFAULT 0,
    "contributor_count" INTEGER NOT NULL DEFAULT 0,
    "added_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "mosques_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prayer_schedules" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "mosque_id" UUID NOT NULL,
    "schedule_name" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "valid_from" DATE NOT NULL,
    "valid_until" DATE,
    "timings" JSONB NOT NULL,
    "calculation_method" VARCHAR(50),
    "calculation_params" JSONB,
    "notes" TEXT,
    "submitted_by" UUID,
    "verified_by" UUID,
    "verification_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "upvotes" INTEGER NOT NULL DEFAULT 0,
    "downvotes" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "prayer_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timing_submissions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "mosque_id" UUID NOT NULL,
    "submitted_by" UUID NOT NULL,
    "timings" JSONB NOT NULL,
    "notes" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "is_verified_onsite" BOOLEAN NOT NULL DEFAULT false,
    "proof_photos" JSONB NOT NULL DEFAULT '[]',
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "reviewed_by" UUID,
    "review_notes" TEXT,
    "upvotes" INTEGER NOT NULL DEFAULT 0,
    "downvotes" INTEGER NOT NULL DEFAULT 0,
    "reports" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "timing_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_favorites" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "mosque_id" UUID NOT NULL,
    "notes" TEXT,
    "tags" TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_favorites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mosque_reviews" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "mosque_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "timing_accuracy_rating" INTEGER,
    "cleanliness_rating" INTEGER,
    "accessibility_rating" INTEGER,
    "title" VARCHAR(200),
    "review_text" TEXT,
    "helpful_count" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'published',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "mosque_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "votes" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "votable_type" VARCHAR(50) NOT NULL,
    "votable_id" UUID NOT NULL,
    "vote_type" VARCHAR(10) NOT NULL,
    "report_reason" VARCHAR(100),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID,
    "activity_type" VARCHAR(50) NOT NULL,
    "entity_type" VARCHAR(50),
    "entity_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip_address" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "message" TEXT,
    "entity_type" VARCHAR(50),
    "entity_id" UUID,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMPTZ,
    "sent_via" JSONB NOT NULL DEFAULT '{"push": false, "email": false, "sms": false}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_firebase_uid_key" ON "users"("firebase_uid");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_reputation_points_idx" ON "users"("reputation_points" DESC);

-- CreateIndex
CREATE INDEX "idx_mosques_location" ON "mosques" USING GIST ("location");

-- CreateIndex
CREATE INDEX "idx_mosques_name_trgm" ON "mosques" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "mosques_city_idx" ON "mosques"("city");

-- CreateIndex
CREATE INDEX "mosques_country_idx" ON "mosques"("country");

-- CreateIndex
CREATE INDEX "mosques_status_verified_idx" ON "mosques"("status", "verified");

-- CreateIndex
CREATE INDEX "prayer_schedules_mosque_id_is_active_idx" ON "prayer_schedules"("mosque_id", "is_active");

-- CreateIndex
CREATE INDEX "prayer_schedules_valid_from_valid_until_idx" ON "prayer_schedules"("valid_from", "valid_until");

-- CreateIndex
CREATE INDEX "timing_submissions_mosque_id_status_idx" ON "timing_submissions"("mosque_id", "status");

-- CreateIndex
CREATE INDEX "timing_submissions_submitted_by_idx" ON "timing_submissions"("submitted_by");

-- CreateIndex
CREATE INDEX "timing_submissions_status_created_at_idx" ON "timing_submissions"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "user_favorites_user_id_created_at_idx" ON "user_favorites"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "user_favorites_mosque_id_idx" ON "user_favorites"("mosque_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_favorites_user_id_mosque_id_key" ON "user_favorites"("user_id", "mosque_id");

-- CreateIndex
CREATE INDEX "mosque_reviews_mosque_id_status_created_at_idx" ON "mosque_reviews"("mosque_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "mosque_reviews_rating_idx" ON "mosque_reviews"("rating" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "mosque_reviews_user_id_mosque_id_key" ON "mosque_reviews"("user_id", "mosque_id");

-- CreateIndex
CREATE INDEX "votes_votable_type_votable_id_idx" ON "votes"("votable_type", "votable_id");

-- CreateIndex
CREATE INDEX "votes_user_id_idx" ON "votes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "votes_user_id_votable_type_votable_id_key" ON "votes"("user_id", "votable_type", "votable_id");

-- CreateIndex
CREATE INDEX "activity_logs_user_id_created_at_idx" ON "activity_logs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "activity_logs_activity_type_created_at_idx" ON "activity_logs"("activity_type", "created_at" DESC);

-- CreateIndex
CREATE INDEX "activity_logs_created_at_idx" ON "activity_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_user_id_read_created_at_idx" ON "notifications"("user_id", "read", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_default_mosque_id_fkey" FOREIGN KEY ("default_mosque_id") REFERENCES "mosques"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mosques" ADD CONSTRAINT "mosques_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prayer_schedules" ADD CONSTRAINT "prayer_schedules_mosque_id_fkey" FOREIGN KEY ("mosque_id") REFERENCES "mosques"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prayer_schedules" ADD CONSTRAINT "prayer_schedules_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prayer_schedules" ADD CONSTRAINT "prayer_schedules_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timing_submissions" ADD CONSTRAINT "timing_submissions_mosque_id_fkey" FOREIGN KEY ("mosque_id") REFERENCES "mosques"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timing_submissions" ADD CONSTRAINT "timing_submissions_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timing_submissions" ADD CONSTRAINT "timing_submissions_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_favorites" ADD CONSTRAINT "user_favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_favorites" ADD CONSTRAINT "user_favorites_mosque_id_fkey" FOREIGN KEY ("mosque_id") REFERENCES "mosques"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mosque_reviews" ADD CONSTRAINT "mosque_reviews_mosque_id_fkey" FOREIGN KEY ("mosque_id") REFERENCES "mosques"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mosque_reviews" ADD CONSTRAINT "mosque_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "votes" ADD CONSTRAINT "votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

