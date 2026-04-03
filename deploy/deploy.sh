#!/bin/bash
# Deploy script for ibolt-blog
# Usage: bash /opt/ibolt-blog/deploy/deploy.sh

set -e

APP_DIR="/opt/ibolt-blog"
cd "$APP_DIR"

echo "==> Pulling latest code..."
git pull

echo "==> Installing dependencies..."
npm install --production=false

echo "==> Building..."
npm run build

echo "==> Restarting app..."
pm2 restart ibolt 2>/dev/null || pm2 start npm --name ibolt -- run start

echo "==> Waiting 3 seconds..."
sleep 3

# Check if it's running
if pm2 list | grep -q "online"; then
  echo "==> Deploy successful! App is running."
  curl -s http://127.0.0.1/api/system/status || echo "(status endpoint not available)"
else
  echo "==> ERROR: App is not running. Check logs:"
  pm2 logs ibolt --lines 10 --nostream
fi
