-- Account-deletion requests submitted via the public web form at
-- /delete-account.html. These are reviewed manually and turned into
-- soft-deletes on the matching User row (or discarded if no match).
-- The endpoint is rate-limited and never reveals whether the email
-- exists, so this table can also receive requests for non-existent
-- emails — that's fine, we just discard them on review.
CREATE TABLE "account_deletion_requests" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "email" VARCHAR(255) NOT NULL,
    "reason" TEXT,
    "ip_address" INET,
    "user_agent" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "processed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_deletion_requests_pkey" PRIMARY KEY ("id")
);

-- Look up recent requests by email for the per-email rate-limit check.
CREATE INDEX "account_deletion_requests_email_created_at_idx"
    ON "account_deletion_requests"("email", "created_at" DESC);

-- Inbox sort: review the oldest pending requests first.
CREATE INDEX "account_deletion_requests_status_created_at_idx"
    ON "account_deletion_requests"("status", "created_at");
