#!/usr/bin/env bash
# Bump version everywhere + rebuild bundle. Usage: scripts/bump.sh 0.1.2
set -euo pipefail
if [ $# -ne 1 ]; then
  echo "Usage: $0 <new-version>" >&2
  exit 1
fi
NEW="$1"
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/.."

sed -i.bak -E "s/(\"version\":[[:space:]]*\")[0-9.]+(\")/\1${NEW}\2/" \
  .claude-plugin/plugin.json package.json
sed -i.bak -E "s/(version:[[:space:]]*\")[0-9.]+(\")/\1${NEW}\2/" src/server.ts
rm -f .claude-plugin/plugin.json.bak package.json.bak src/server.ts.bak

echo "Bumped to ${NEW} in plugin.json, package.json, src/server.ts"
echo "Now rebuilding..."
npm run build

echo ""
echo "Remember to:"
echo "  1. Add a CHANGELOG.md entry for ${NEW}"
echo "  2. git add -A && git commit -m 'release: ${NEW} ...'"
echo "  3. git push origin main"
