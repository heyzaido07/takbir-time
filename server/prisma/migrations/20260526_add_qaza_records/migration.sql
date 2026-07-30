CREATE TABLE "qaza_records" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "user_id" UUID NOT NULL,
  "client_id" VARCHAR(160) NOT NULL,
  "prayer" VARCHAR(20) NOT NULL,
  "prayer_date" DATE NOT NULL,
  "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "prayed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "qaza_records_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "qaza_records"
  ADD CONSTRAINT "qaza_records_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "qaza_records_user_id_client_id_key" ON "qaza_records"("user_id", "client_id");
CREATE INDEX "qaza_records_user_id_prayed_at_prayer_date_idx" ON "qaza_records"("user_id", "prayed_at", "prayer_date");
CREATE INDEX "qaza_records_user_id_recorded_at_idx" ON "qaza_records"("user_id", "recorded_at" DESC);
