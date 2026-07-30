-- AlterTable: add OSM-import dedup column.
-- Postgres allows multiple NULLs in a UNIQUE constraint, so existing
-- hand-seeded rows (with osm_id IS NULL) won't conflict with each other.
ALTER TABLE "mosques" ADD COLUMN "osm_id" BIGINT;
CREATE UNIQUE INDEX "mosques_osm_id_key" ON "mosques"("osm_id");
