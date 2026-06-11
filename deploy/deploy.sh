#!/bin/bash
# Deploy script for the standalone blog writer.
# Usage: APP_DIR=/opt/standalone-blog-writer bash deploy/deploy.sh

set -e

APP_DIR="${APP_DIR:-/opt/standalone-blog-writer}"
PM2_APP_NAME="${PM2_APP_NAME:-standalone-blog-writer}"
PORT="${PORT:-5001}"
DATABASE_PATH="${DATABASE_PATH:-data/standalone-blog-writer.db}"
cd "$APP_DIR"

echo "==> Pulling latest code..."
git pull

echo "==> Installing dependencies..."
npm ci

if [[ ! -f "$DATABASE_PATH" && -f data/sourceannotator.db ]]; then
  DATABASE_PATH="data/sourceannotator.db"
fi

if [[ -f "$DATABASE_PATH" ]]; then
  mkdir -p data/backups
  db_name="$(basename "$DATABASE_PATH" .db)"
  cp "$DATABASE_PATH" "data/backups/${db_name}.$(date +%Y%m%d%H%M%S).db"
fi

echo "==> Typechecking..."
npm run check

echo "==> Building..."
npm run build

echo "==> Running standalone preflight..."
npm run preflight:standalone

echo "==> Running onboarding smoke..."
npm run smoke:onboarding

echo "==> Restarting app..."
DATABASE_PATH="$DATABASE_PATH" pm2 restart "$PM2_APP_NAME" 2>/dev/null || DATABASE_PATH="$DATABASE_PATH" pm2 start deploy/ecosystem.config.js --only "$PM2_APP_NAME"

echo "==> Waiting 3 seconds..."
sleep 3

# Check if it's running
if pm2 list | grep -q "online"; then
  echo "==> Deploy successful! App is running."
  curl -fsS "http://127.0.0.1:${PORT}/api/blog/health"
else
  echo "==> ERROR: App is not running. Check logs:"
  pm2 logs "$PM2_APP_NAME" --lines 10 --nostream
fi
