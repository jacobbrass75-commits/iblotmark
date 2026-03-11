#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/app}"
APP_REF="${APP_REF:-origin/master}"
MCP_DIR="${MCP_DIR:-/opt/app/mcp-server}"

cd "$APP_DIR"

echo "[deploy] fetching latest code"
git fetch origin
git reset --hard "$APP_REF"

echo "[deploy] installing app deps"
npm install

echo "[deploy] building app"
npm run build

echo "[deploy] reloading built web app"
pm2 startOrReload deploy/pm2.ecosystem.cjs

if [[ -d "$MCP_DIR" ]]; then
  echo "[deploy] ensuring MCP deps"
  cd "$MCP_DIR"
  npm install
  pm2 startOrReload deploy/pm2.ecosystem.cjs
fi

echo "[deploy] saving PM2 process list"
pm2 save
