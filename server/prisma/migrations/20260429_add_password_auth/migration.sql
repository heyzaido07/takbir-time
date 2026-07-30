-- AlterTable: add nullable email/password auth fields
ALTER TABLE "users" ADD COLUMN "password_hash" VARCHAR(200);
ALTER TABLE "users" ADD COLUMN "email_verified_at" TIMESTAMPTZ;
