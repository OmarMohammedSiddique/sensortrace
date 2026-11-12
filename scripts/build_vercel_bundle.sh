#!/usr/bin/env bash
# Assemble a self-contained directory for deployment to Vercel (web + API as two services).
#
# The repository keeps the engine as a separate package; Vercel builds each service from its own
# root, so this script places the engine source next to the API code and writes a flat
# requirements file. Output: .vercel-bundle/ (never committed).
#
# Usage: scripts/build_vercel_bundle.sh   then   (cd .vercel-bundle && npx vercel deploy --prod)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/.vercel-bundle"
mkdir -p "$OUT"
# keep .vercel/ (project link) across rebuilds; replace everything else
find "$OUT" -mindepth 1 -maxdepth 1 ! -name .vercel -exec rm -r {} +

mkdir -p "$OUT/api" "$OUT/web"
cp -R "$ROOT/backend/app" "$OUT/api/app"
cp -R "$ROOT/backend/policies" "$OUT/api/policies"
cp -R "$ROOT/engine/src/sensortrace_engine" "$OUT/api/sensortrace_engine"
find "$OUT/api" -name __pycache__ -type d -prune -exec rm -r {} +
(cd "$ROOT/backend" && uv export --no-dev --no-emit-project --no-hashes --format requirements-txt 2>/dev/null \
  | grep -v -E '^(-e |\.\./|sensortrace-engine)' > "$OUT/api/requirements.txt")
echo "3.12" > "$OUT/api/.python-version"

rsync -a --exclude node_modules --exclude .next --exclude e2e --exclude playwright-report \
  --exclude test-results --exclude tsconfig.tsbuildinfo "$ROOT/frontend/" "$OUT/web/"

cat > "$OUT/vercel.json" <<'JSON'
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "services": {
    "web": { "root": "web", "framework": "nextjs" },
    "api": {
      "root": "api",
      "entrypoint": "app.main:app",
      "functions": { "app/main.py": { "maxDuration": 300 } }
    }
  },
  "rewrites": [
    { "source": "/api/v1/(.*)", "destination": { "service": "api" } },
    { "source": "/(.*)", "destination": { "service": "web" } }
  ],
  "crons": [{ "path": "/api/v1/internal/maintenance", "schedule": "0 3 * * *" }]
}
JSON
echo "bundle ready: $OUT ($(du -sh "$OUT" | cut -f1))"
