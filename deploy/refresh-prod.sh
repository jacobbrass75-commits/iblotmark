#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/standalone-blog-writer}"
APP_REF="${APP_REF:-origin/master}"
PM2_APP_NAME="${PM2_APP_NAME:-standalone-blog-writer}"
PORT="${PORT:-5001}"
DATABASE_PATH="${DATABASE_PATH:-data/standalone-blog-writer.db}"

cd "$APP_DIR"

echo "[deploy] fetching latest code"
git fetch origin
git reset --hard "$APP_REF"

echo "[deploy] installing app deps"
npm ci

if [[ ! -f "$DATABASE_PATH" && -f data/sourceannotator.db ]]; then
  DATABASE_PATH="data/sourceannotator.db"
fi

if [[ -f "$DATABASE_PATH" ]]; then
  echo "[deploy] backing up database"
  mkdir -p data/backups
  db_name="$(basename "$DATABASE_PATH" .db)"
  cp "$DATABASE_PATH" "data/backups/${db_name}.$(date +%Y%m%d%H%M%S).db"
fi

echo "[deploy] bootstrapping database schema"
NODE_ENV=production BLOG_SEED_IBOLT_DEMO=false npx tsx scripts/bootstrap-db.ts

echo "[deploy] typechecking"
npm run check

echo "[deploy] building app"
npm run build

echo "[deploy] running standalone preflight"
npm run preflight:standalone

echo "[deploy] running onboarding smoke"
npm run smoke:onboarding

echo "[deploy] replacing web app with built production process"
pm2 delete "$PM2_APP_NAME" >/dev/null 2>&1 || true
PORT="$PORT" DATABASE_PATH="$DATABASE_PATH" pm2 start deploy/ecosystem.config.js --only "$PM2_APP_NAME"

echo "[deploy] checking standalone health"
curl -fsS "http://127.0.0.1:${PORT}/api/blog/health"

echo "[deploy] saving PM2 process list"
pm2 save
