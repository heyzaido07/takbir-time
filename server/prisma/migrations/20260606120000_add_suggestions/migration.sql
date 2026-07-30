-- CreateTable
CREATE TABLE "suggestions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "mosque_id" UUID NOT NULL,
    "from_user_id" UUID NOT NULL,
    "to_user_id" UUID NOT NULL,
    "timings" JSONB NOT NULL,
    "notes" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "responded_at" TIMESTAMPTZ,
    "responded_note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suggestions_to_user_id_status_created_at_idx" ON "suggestions"("to_user_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "suggestions_from_user_id_idx" ON "suggestions"("from_user_id");

-- CreateIndex
CREATE INDEX "suggestions_mosque_id_idx" ON "suggestions"("mosque_id");

-- AddForeignKey
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_mosque_id_fkey" FOREIGN KEY ("mosque_id") REFERENCES "mosques"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
