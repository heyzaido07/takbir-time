# Deployment

This is the live deployment runbook for Takbeer Time.

The current production setup is:

| Component | Location | Notes |
|---|---|---|
| Public website | `https://takbeertime.com` | Served through the edge Nginx host |
| Edge Nginx | `192.168.18.5` | Proxies all Takbeer traffic to `192.168.18.93` |
| Production app server | `192.168.18.93` | Docker Compose app, API, web, and database |
| Production app path | `/home/junaid/takbeer-time-prod/app` | Current deployed app tree |
| Production Compose path | `/home/junaid/takbeer-time-prod/app/deploy/production` | Run Docker commands here |
| Production database | Docker volume on `192.168.18.93` | PostgreSQL/PostGIS database named `jamat` |
| Android release trigger | `live` branch | Push to `live` uploads the Android AAB to Play internal track |

The production database now lives on the deployment server. Do not copy the
development database from `192.168.18.51` to live during normal deployments.

## Golden Rules

- Never run `docker compose down -v` on production. That removes the live database volume.
- Never overwrite the live database from development unless this is an explicit, approved disaster recovery task.
- Always make a production backup before deploying code that touches the API, Prisma schema, database, auth, or timing submissions.
- Keep secrets only on the server in `deploy/production/.env` and `deploy/production/api.env`.
- Do not commit `.env`, `api.env`, Firebase private keys, service account JSON, database dumps, or passwords.
- Deploy from a committed `main` revision. Do not deploy local uncommitted work.

## Production Files

On `192.168.18.93`:

- `deploy/production/docker-compose.yml` defines the `db`, `api`, and `web` services.
- `deploy/production/.env` contains Compose-level settings:
  - `POSTGRES_DB`
  - `POSTGRES_USER`
  - `POSTGRES_PASSWORD`
  - `WEB_PORT`
- `deploy/production/api.env` contains API runtime settings:
  - Firebase Admin values
  - JWT settings
  - FCM settings
  - `ALLOWED_ORIGINS`
  - `ADMIN_EMAIL`
  - scraper/timekeeper settings

These env files are server-owned and must be copied forward when replacing the
app directory.

## Normal Web/API Deployment

Run these commands from a clean local checkout of this repo.

```powershell
cd D:\MyGitHub\takbeer
git checkout main
git fetch origin
git pull --ff-only origin main
git status --short
```

If `git status --short` shows unrelated local files, do not stage them. The
archive command below deploys only committed files from `HEAD`.

Optionally run local checks before the deploy:

```powershell
npm run test:unit
npm --prefix server test
```

Create and upload an archive of the committed code:

```powershell
$release = Get-Date -Format "yyyyMMdd-HHmmss"
$archive = "$env:TEMP\takbeer-$release.tar"
git archive --format=tar HEAD -o $archive
scp $archive junaid@192.168.18.93:/tmp/takbeer-release.tar
```

Back up the live database on the production server:

```powershell
@'
set -euo pipefail
base=/home/junaid/takbeer-time-prod
cd "$base/app/deploy/production"
mkdir -p "$base/backups"
backup="$base/backups/jamat-$(date +%Y%m%d-%H%M%S).dump"
docker compose exec -T db pg_dump -U takbeer -d jamat -Fc > "$backup"
ls -lh "$backup"
'@ | ssh junaid@192.168.18.93 'bash -s'
```

Deploy the new app tree, preserve production env files, rebuild containers,
apply Prisma migrations, and restart:

```powershell
@'
set -euo pipefail
base=/home/junaid/takbeer-time-prod
stamp=$(date +%Y%m%d-%H%M%S)

rm -rf "$base/app.next"
mkdir -p "$base/app.next"
tar -xf /tmp/takbeer-release.tar -C "$base/app.next"

cp "$base/app/deploy/production/.env" "$base/app.next/deploy/production/.env"
cp "$base/app/deploy/production/api.env" "$base/app.next/deploy/production/api.env"

mv "$base/app" "$base/app.previous-$stamp"
mv "$base/app.next" "$base/app"

cd "$base/app/deploy/production"
docker compose build api web
docker compose up -d db

# Runtime images intentionally omit dev dependencies. Use a one-off Prisma CLI
# for migrations until the API image includes a dedicated migration command.
docker compose run --rm --entrypoint sh api -lc 'npx --yes prisma@5.8.0 migrate deploy'

docker compose up -d
docker compose ps
'@ | ssh junaid@192.168.18.93 'bash -s'
```

## Post-Deploy Verification

Check the Docker services on the production server:

```powershell
ssh junaid@192.168.18.93 'cd /home/junaid/takbeer-time-prod/app/deploy/production && docker compose ps'
```

Check the site through the public domain:

```powershell
curl.exe -I --max-time 30 https://takbeertime.com/
curl.exe -sS --max-time 30 https://takbeertime.com/health
curl.exe -sS --max-time 30 "https://takbeertime.com/api/mosques?limit=1"
```

Expected results:

- `/` returns HTTP `200`.
- `/health` returns JSON with `"status":"ok"` and `"environment":"production"`.
- `/api/mosques?limit=1` returns mosque data from the production database.

If the website loads but API requests fail, check `deploy/production/nginx.conf`
inside this repo and the edge Nginx config on `192.168.18.5`.

## Edge Nginx

The public edge Nginx host is `192.168.18.5`. It terminates HTTPS for
`takbeertime.com` and proxies traffic to the Docker web container on
`192.168.18.93`.

The Nginx config repo is:

```powershell
D:\MyGitHub\nginx
```

The GitHub remote is named `trustaxisinc/nginxx`, but the local folder is
`D:\MyGitHub\nginx`.

The live config file is:

```text
/etc/nginx/sites-available/takbeertime
```

It should route all Takbeer traffic to `192.168.18.93`:

```nginx
location /api/ {
    proxy_pass http://192.168.18.93;
}

location = /health {
    proxy_pass http://192.168.18.93/health;
}

location / {
    proxy_pass http://192.168.18.93;
}
```

After changing the edge config:

```powershell
ssh smnginx-root 'nginx -t && systemctl reload nginx'
curl.exe -sS --max-time 30 https://takbeertime.com/health
```

Only change edge Nginx when the production app server IP, exposed port, domain,
or SSL routing changes. Normal app deployments on `192.168.18.93` do not require
an edge Nginx change.

## Database Policy

The production database is authoritative on `192.168.18.93`.

Normal deployments must not copy data from:

- local development
- `192.168.18.51`
- staging
- another developer machine

The old one-time migration from `192.168.18.51` to `192.168.18.93` is complete.
Future deployments should preserve and migrate the live database in place.

Use this command to check production counts:

```powershell
ssh junaid@192.168.18.93 'cd /home/junaid/takbeer-time-prod/app/deploy/production && docker compose exec -T db psql -U takbeer -d jamat -tAc "select (select count(*) from users) as users, (select count(*) from mosques) as mosques, (select count(*) from timing_submissions) as timing_submissions, (select count(*) from activity_logs) as activity_logs;"'
```

Use `pg_dump` backups from the live server for rollback or audit. Do not store
database dumps in Git.

## Google Places Mosque Name Enrichment

Some imported OpenStreetMap rows have placeholder names such as
`Mosque (OSM way 12345)`. If Google has granted permission for Takbeer Time to
store Google Places mosque names, use the controlled enrichment script instead
of ad-hoc SQL updates.

Prerequisites:

- A Google Maps Platform API key with Places API (New) enabled.
- The key must be allowed to call `https://places.googleapis.com/v1/places:searchNearby`
  from the machine running the script.
- A production DB backup must be created first.

Run a dry-run sample from the production server:

```bash
cd /home/junaid/takbeer-time-prod/app/deploy/production
docker compose exec \
  -e GOOGLE_PLACES_API_KEY='<server-side-places-key>' \
  api node dist/scripts/enrichUnnamedMosquesGoogle.js \
  --limit 25 \
  --report /tmp/google-mosque-enrichment-sample.csv
```

Copy and review the generated CSV report. Only rows marked `accepted` are
eligible for update.

```bash
docker cp "$(docker compose ps -q api):/tmp/google-mosque-enrichment-sample.csv" ./google-mosque-enrichment-sample.csv
```

Apply a small batch:

```bash
cd /home/junaid/takbeer-time-prod/app/deploy/production
docker compose exec \
  -e GOOGLE_PLACES_API_KEY='<server-side-places-key>' \
  api node dist/scripts/enrichUnnamedMosquesGoogle.js \
  --limit 25 \
  --apply \
  --report /tmp/google-mosque-enrichment-applied.csv
```

Scale carefully after reviewing match quality:

```bash
docker compose exec \
  -e GOOGLE_PLACES_API_KEY='<server-side-places-key>' \
  api node dist/scripts/enrichUnnamedMosquesGoogle.js \
  --limit 500 \
  --apply \
  --delay-ms 300
```

Useful options:

| Option | Default | Purpose |
|---|---:|---|
| `--limit` | `25` | Number of placeholder rows to inspect |
| `--country` | none | Restrict to one country name, e.g. `Pakistan` |
| `--radius` | `150` | Google Nearby Search radius in meters |
| `--max-distance` | `100` | Reject matches farther than this from the DB coordinate |
| `--exact-distance` | `20` | Treat very close nearest matches as unambiguous |
| `--ambiguity-gap` | `30` | Reject when the second candidate is too close to the first |
| `--delay-ms` | `300` | Delay between Google calls |
| `--language` | `en` | Google Places response language |
| `--apply` | off | Actually update `mosques.name`; absent means dry-run |

The script updates only rows that are still placeholders at write time. It does
not overwrite community-provided or system-provided mosque names.

## Rollback

Rollback code only if the database schema is still compatible with the previous
release. Prisma migrations are forward-only by default.

List available previous app directories:

```powershell
ssh junaid@192.168.18.93 'ls -dt /home/junaid/takbeer-time-prod/app.previous-* | head'
```

Rollback to the most recent previous app tree:

```powershell
@'
set -euo pipefail
base=/home/junaid/takbeer-time-prod
stamp=$(date +%Y%m%d-%H%M%S)
previous=$(ls -dt "$base"/app.previous-* | head -1)

mv "$base/app" "$base/app.failed-$stamp"
mv "$previous" "$base/app"

cd "$base/app/deploy/production"
docker compose up -d --build
docker compose ps
'@ | ssh junaid@192.168.18.93 'bash -s'
```

If a migration broke data or schema compatibility, restore the database from a
known-good production backup only after confirming the rollback plan. Do not use
the development database as a rollback source.

## Android Release

Website/API deployment is separate from Android deployment.

To release the Android app, merge `main` into the `live` branch and push. The
GitHub Action uploads the signed AAB to the Play Store internal track.

```powershell
cd D:\MyGitHub\takbeer
git checkout main
git pull --ff-only origin main

git checkout live
git pull --ff-only origin live
git merge origin/main --no-ff -m "Merge main into live for release"
git push origin live
```

Then watch the workflow:

```powershell
gh run list --limit 5
gh run watch <run-id>
```

For the full mobile release runbook, see `docs/RELEASE.md` and
`docs/PLAY_AUTO_DEPLOY.md`.

## First-Time Server Setup

This is only for replacing or rebuilding the production server. Do not run this
for normal deploys.

1. Install Docker and the Docker Compose plugin on the new VM.
2. Create `/home/junaid/takbeer-time-prod/app`.
3. Upload a committed app archive and extract it into
   `/home/junaid/takbeer-time-prod/app`.
4. Create `deploy/production/.env` and `deploy/production/api.env` on the
   server. The normal deploy script cannot run until these files exist.
5. Restore production data from the latest production backup, not from a
   development database.
6. Start the stack:

```bash
cd /home/junaid/takbeer-time-prod/app/deploy/production
docker compose up -d --build
docker compose ps
```

7. Point edge Nginx on `192.168.18.5` to the new production server.
8. Verify `https://takbeertime.com/health` and a public API request.

## Troubleshooting

Check service status:

```powershell
ssh junaid@192.168.18.93 'cd /home/junaid/takbeer-time-prod/app/deploy/production && docker compose ps'
```

Check API logs:

```powershell
ssh junaid@192.168.18.93 'cd /home/junaid/takbeer-time-prod/app/deploy/production && docker compose logs --tail=200 api'
```

Check web/Nginx container logs:

```powershell
ssh junaid@192.168.18.93 'cd /home/junaid/takbeer-time-prod/app/deploy/production && docker compose logs --tail=200 web'
```

Check database health:

```powershell
ssh junaid@192.168.18.93 'cd /home/junaid/takbeer-time-prod/app/deploy/production && docker compose exec -T db pg_isready -U takbeer -d jamat'
```

Common issues:

| Symptom | Likely cause | Fix |
|---|---|---|
| Public site is down, direct `http://192.168.18.93/health` works | Edge Nginx or Cloudflare routing issue | Check `192.168.18.5` Nginx config and reload |
| `/health` works, `/api/*` fails | API container or internal web proxy issue | Check `api` logs and `deploy/production/nginx.conf` |
| Login/auth fails after deploy | Firebase env or JWT env missing in `api.env` | Compare API env keys, restart `api` |
| Google sign-in says unauthorized domain | Firebase Auth authorized domains missing `takbeertime.com` | Add the domain in Firebase Console |
| DB is empty after deploy | Wrong Compose project/volume or destructive `down -v` | Stop and inspect volumes before writing more data |
| Migration command cannot find Prisma | Runtime image omits dev dependencies | Use the documented `npx --yes prisma@5.8.0 migrate deploy` one-off command |
