#!/usr/bin/env bash
#
# Weekend refresh for all credited public scraper sources. Each source runs in
# its own --refresh pass, so it only revisits mosques whose active schedule is
# already owned by that source.
#
# Install (runs every Saturday at 03:30, i.e. on the weekend):
#   crontab -e
#   30 3 * * 6  /home/junaid/Documents/GitHub/Jamat/server/scripts/cron/refresh-weekend-scrapers.sh >> /home/junaid/Documents/GitHub/Jamat/server/jummah-weekend-scrapers-cron.log 2>&1
#
set -euo pipefail

SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$SERVER_DIR"

if ! grep -qE '^[[:space:]]*JUMMAH_SCRAPER_ENABLED[[:space:]]*=[[:space:]]*true' .env 2>/dev/null; then
  echo "[$(date -Is)] JUMMAH_SCRAPER_ENABLED is not true in server/.env - skipping weekend scraper refresh."
  exit 0
fi

failures=0
for source in mawaqit jamaat360 fiveprayers mosquehq websites jakim muis vaktija iacad habous diyanet kemenag; do
  echo "[$(date -Is)] Starting ${source} weekend refresh"
  if npm run --silent "import:jummah:${source}-refresh"; then
    echo "[$(date -Is)] ${source} weekend refresh complete"
  else
    failures=$((failures + 1))
    echo "[$(date -Is)] ${source} weekend refresh failed"
  fi
done

if [ "$failures" -gt 0 ]; then
  echo "[$(date -Is)] Weekend scraper refresh completed with ${failures} failed source(s)."
  exit 1
fi

echo "[$(date -Is)] Weekend scraper refresh complete"
