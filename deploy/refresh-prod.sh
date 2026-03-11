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

echo "[deploy] replacing web app with built production process"
pm2 delete sourceannotator >/dev/null 2>&1 || true
NODE_ENV=production PORT=5001 pm2 start dist/index.cjs --name sourceannotator --cwd "$APP_DIR" --interpreter /usr/bin/node

if [[ -d "$MCP_DIR" ]]; then
  echo "[deploy] ensuring MCP deps"
  cd "$MCP_DIR"
  npm install
  pm2 delete scholarmark-mcp >/dev/null 2>&1 || true
  MCP_SERVER_PORT=5002 \
  SCHOLARMARK_BACKEND_URL=http://127.0.0.1:5001 \
  MCP_AUTHORIZATION_SERVER=https://app.scholarmark.ai \
  MCP_RESOURCE_URL=https://mcp.scholarmark.ai \
  pm2 start server.mjs --name scholarmark-mcp --cwd "$MCP_DIR" --interpreter /usr/bin/node
fi

echo "[deploy] saving PM2 process list"
pm2 save
