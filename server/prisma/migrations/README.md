# Prisma Migrations

This directory will hold migration files once `npx prisma migrate dev` is run for the first time.

## First-time bootstrap

The schema in `../schema.prisma` is currently the source of truth. No migrations have been committed yet. To bootstrap a real database:

```bash
# 1. Make sure DATABASE_URL points at an empty PostgreSQL database
#    with permission to run CREATE EXTENSION.
export DATABASE_URL="postgresql://jamat:jamat@localhost:5432/jamat?schema=public"

# 2. Generate the initial migration. Prisma will:
#    - diff schema.prisma against the empty DB
#    - emit `prisma/migrations/<timestamp>_init/migration.sql`
#    - apply it
npx prisma migrate dev --name init

# 3. Commit the new migrations folder.
git add prisma/migrations
git commit -m "Add initial Prisma migration"
```

## On subsequent schema changes

```bash
npx prisma migrate dev --name <short_description>
git add prisma/migrations
```

Prisma will refuse to generate a migration that drops data unless you confirm.

## In production / CI

**Never** use `prisma db push` or `migrate dev` against production. Use:

```bash
npx prisma migrate deploy
```

This applies committed migrations and never modifies the schema based on a diff.

## PostGIS-specific notes

- The `Mosque.location` column is `Unsupported("geography(Point, 4326)")` in Prisma. The first migration's SQL must include `CREATE EXTENSION IF NOT EXISTS postgis;` BEFORE the `CREATE TABLE mosques`. Check the generated `migration.sql` and add it if Prisma didn't emit it (it usually does because of `extensions = [postgis(...)]` in `datasource db`).
- If your hosting provider doesn't allow `CREATE EXTENSION` from migrations (some managed Postgres services don't), enable PostGIS via the provider's UI first, then re-run `migrate deploy`.
