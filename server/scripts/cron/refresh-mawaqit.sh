#!/usr/bin/env bash
#
# Weekly refresh of all prayer timings (Friday + every namaz) for the masjids
# that are on mawaqit.net. Re-pulls each Mawaqit-sourced mosque's current
# config and writes a fresh pending PrayerSchedule under the time keeper
# "MayAllahRewardMawaqit.net".
#
# Respects the kill-switch: if server/.env does not have
# JUMMAH_SCRAPER_ENABLED=true, this exits cleanly without writing anything
# (so it can be disabled once there is a critical mass of real users).
#
# Install (runs every Sunday at 03:30 — i.e. on the weekend):
#   crontab -e
#   30 3 * * 0  /home/junaid/Documents/GitHub/Jamat/server/scripts/cron/refresh-mawaqit.sh >> /home/junaid/Documents/GitHub/Jamat/server/jummah-mawaqit-cron.log 2>&1
#
set -euo pipefail

SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$SERVER_DIR"

if ! grep -qE '^[[:space:]]*JUMMAH_SCRAPER_ENABLED[[:space:]]*=[[:space:]]*true' .env 2>/dev/null; then
  echo "[$(date -Is)] JUMMAH_SCRAPER_ENABLED is not true in server/.env — skipping Mawaqit refresh."
  exit 0
fi

echo "[$(date -Is)] Starting weekly Mawaqit prayer-time refresh"
npm run --silent import:jummah:mawaqit-refresh
echo "[$(date -Is)] Weekly Mawaqit prayer-time refresh complete"
