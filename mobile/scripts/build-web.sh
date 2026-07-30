#!/usr/bin/env bash
# Snapshot the web app into mobile/www/ for Capacitor to package.
# Capacitor copies whatever is in webDir at `cap copy` time, so we keep
# www/ as a build output (gitignored) and rebuild it from the web sources.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$MOBILE_DIR")"
WWW="$MOBILE_DIR/www"

rm -rf "$WWW"
mkdir -p "$WWW"

# Copy the canonical web app (index.html only — index-enhanced.html is a
# design prototype, not the live UI). Bring js/, css/, and any static assets.
cp "$REPO_ROOT/index.html" "$WWW/"
# Legal + compliance pages (Google Play requires the privacy URL and the
# auth-less account-deletion form to be reachable; users should be able
# to read terms in-app too). They're plain static HTML — copying them
# into the bundle means they work offline as well.
[ -f "$REPO_ROOT/privacy.html" ] && cp "$REPO_ROOT/privacy.html" "$WWW/"
[ -f "$REPO_ROOT/terms.html" ] && cp "$REPO_ROOT/terms.html" "$WWW/"
[ -f "$REPO_ROOT/delete-account.html" ] && cp "$REPO_ROOT/delete-account.html" "$WWW/"
[ -f "$REPO_ROOT/api-docs.html" ] && cp "$REPO_ROOT/api-docs.html" "$WWW/"
[ -f "$REPO_ROOT/robots.txt" ] && cp "$REPO_ROOT/robots.txt" "$WWW/"
[ -f "$REPO_ROOT/sitemap.xml" ] && cp "$REPO_ROOT/sitemap.xml" "$WWW/"
[ -f "$REPO_ROOT/site.webmanifest" ] && cp "$REPO_ROOT/site.webmanifest" "$WWW/"
cp -r "$REPO_ROOT/js" "$WWW/"
cp -r "$REPO_ROOT/css" "$WWW/"
# Translation bundles — js/i18n.js fetches `i18n/<lang>.json` at runtime
# (relative path resolves to https://localhost/i18n/...). Without this,
# every non-English language silently 404s and the catch block reverts
# to English — which manifests as "language switching is broken."
cp -r "$REPO_ROOT/i18n" "$WWW/"
[ -d "$REPO_ROOT/assets" ] && cp -r "$REPO_ROOT/assets" "$WWW/" || true

# Drop the native bridge in alongside the other JS modules. It's loaded
# via the index.html include (added by the patch step below).
cp "$MOBILE_DIR/native-bridge.js" "$WWW/js/native-bridge.js"

# Insert the native-bridge script tag right before sun.js if it isn't there.
if ! grep -q 'native-bridge.js' "$WWW/index.html"; then
  sed -i 's|<script src="js/sun.js|<script src="js/native-bridge.js?v=24"></script>\n  <script src="js/sun.js|' "$WWW/index.html"
fi

echo "✅ Web snapshot ready at: $WWW"
echo "   Next: cd $MOBILE_DIR && npx cap sync"
