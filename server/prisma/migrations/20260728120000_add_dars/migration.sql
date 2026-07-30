-- CreateTable
CREATE TABLE "dars_groups" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "share_code" VARCHAR(32) NOT NULL,
    "admin_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "dars_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dars_group_members" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "group_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" VARCHAR(20) NOT NULL DEFAULT 'member',
    "joined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dars_group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dars_sessions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "group_id" UUID NOT NULL,
    "title" VARCHAR(160),
    "scheduled_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dars_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dars_groups_share_code_key" ON "dars_groups"("share_code");

-- CreateIndex
CREATE INDEX "dars_groups_admin_id_idx" ON "dars_groups"("admin_id");

-- CreateIndex
CREATE UNIQUE INDEX "dars_group_members_group_id_user_id_key" ON "dars_group_members"("group_id", "user_id");

-- CreateIndex
CREATE INDEX "dars_group_members_user_id_idx" ON "dars_group_members"("user_id");

-- CreateIndex
CREATE INDEX "dars_sessions_group_id_scheduled_at_idx" ON "dars_sessions"("group_id", "scheduled_at");

-- AddForeignKey
ALTER TABLE "dars_groups" ADD CONSTRAINT "dars_groups_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dars_group_members" ADD CONSTRAINT "dars_group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "dars_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dars_group_members" ADD CONSTRAINT "dars_group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dars_sessions" ADD CONSTRAINT "dars_sessions_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "dars_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dars_sessions" ADD CONSTRAINT "dars_sessions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
