# iBOLT Mark API and MCP Handoff

This runbook is based on the checked-in scripts, environment examples, routes, and MCP entrypoints. It distinguishes what works now from Phase 8 plans that are not wired into the remote MCP service.

## Current Runtime Surfaces

| Surface | Entrypoint | Default address | Actual capability |
| --- | --- | --- | --- |
| iBOLT Mark app | `server/index.ts` | `http://127.0.0.1:5001` | Blog UI and `/api/blog/*` REST APIs |
| Local iBOLT MCP | `mcp-server/ibolt-stdio.mjs` | stdio, proxying port `5001` | 50 blog, keyword, research, benchmark, product, Shopify, scheduler, competitor, and photo tools |
| Remote MCP | `mcp-server/server.mjs` | `http://127.0.0.1:5002/mcp` | 12 legacy ScholarMark project, source, chat, compile, and verification tools |

The important limitation is that the remote HTTP MCP server imports `registerScholarMarkTools`; it does not import or expose the iBOLT stdio tools. Phase 8's remote iBOLT workflow is therefore not complete, despite the roadmap's current-state summary. See [`ROADMAP.md`](../ROADMAP.md), [`mcp-server/server.mjs`](../mcp-server/server.mjs), and [`mcp-server/ibolt-stdio.mjs`](../mcp-server/ibolt-stdio.mjs).

## Local Setup

### Prerequisites

- Node.js 20 or newer. The MCP package explicitly requires `node >=20`.
- npm.
- A writable SQLite location configured by `DATABASE_PATH`.
- Provider and authentication credentials described below.

### Install and run the app

1. Create `.env` from [`.env.example`](../.env.example) and replace placeholders. Do not commit `.env`.
2. Install dependencies and push the Drizzle schema:

   ```bash
   npm run setup
   ```

3. Start development mode:

   ```bash
   npm run dev
   ```

4. Verify app liveness:

   ```bash
   curl -fsS http://127.0.0.1:5001/api/blog/health
   ```

The expected response contains `"ok":true`, `"product":"standalone-blog-writer"`, and the legacy-mode state. This is a liveness check only; it does not test SQLite, AI providers, OAuth, or Shopify.

### Repository checks

Use the checked-in scripts before deployment:

```bash
npm run check
npm run build
npm run preflight:standalone
npm run smoke:onboarding
```

`smoke:onboarding` creates and deletes a disposable company and tests company setup, brand guidance, a manual product, encrypted Shopify integration data, and company context.

## API and Credential Configuration

### Standalone production requirements

Set the following names from [`.env.example`](../.env.example) and [`docs/STANDALONE_PRODUCTION.md`](STANDALONE_PRODUCTION.md):

```text
NODE_ENV=production
PORT=5001
DATABASE_PATH=./data/standalone-blog-writer.db
JWT_SECRET
INTEGRATION_ENCRYPTION_KEY
PUBLIC_ASSET_SIGNING_SECRET
PUBLIC_BASE_URL or APP_BASE_URL
CLERK_SECRET_KEY
VITE_CLERK_PUBLISHABLE_KEY
ANTHROPIC_API_KEY or OPENAI_API_KEY
SHOPIFY_CLIENT_ID
SHOPIFY_CLIENT_SECRET
SHOPIFY_API_VERSION=2026-04
SHOPIFY_OAUTH_SCOPES=read_products,read_content,write_content
```

Generate each random application secret with:

```bash
openssl rand -base64 48
```

Production validation requires HTTPS public origins, non-placeholder secrets of at least 32 characters, live Clerk keys, and at least one generation provider. `npm run preflight:standalone` additionally checks Shopify credentials/scopes and database integrity.

Keep these values false in standalone production:

```text
BLOG_SEED_IBOLT_DEMO=false
ENABLE_LEGACY_SCHOLARMARK=false
VITE_ENABLE_LEGACY_SCHOLARMARK=false
IBOLT_BLOG_ALLOW_UNAUTHENTICATED=false
BLOG_ALLOW_UNVALIDATED_COMPANY_SELECTION=false
IBOLT_INTERNAL_AUTH_BYPASS=false
BLOG_ALLOW_UNSIGNED_PUBLIC_PHOTOS=false
ALLOW_IBOLT_DEMO_SCRIPTS=false
ALLOW_CHROME_EXTENSION_ORIGINS=false
BLOG_ALLOW_LOCAL_FILE_IMPORTS=false
BLOG_ALLOW_LOCAL_PHOTO_IMPORTS=false
BLOG_ALLOW_LEGACY_CONTENT_IMPORT=false
BLOG_ALLOW_SHOPIFY_COLLECTION_MUTATION=false
```

### Calling the REST API

`GET /api/blog/health` is public. Other `/api/blog/*` operations require:

- A Clerk session, a valid `Authorization: Bearer sk_sm_...` API key, an `mcp_sm_...` OAuth token, or a valid legacy JWT.
- A selected company via `x-company-id: <company-id>` or `companyId` query parameter.
- Active company membership. Write operations require at least the `reviewer` role.

Create a long-lived API key with `POST /api/auth/api-keys`; that request itself requires an existing authenticated user. The raw `sk_sm_...` value is returned by the create response, while later list responses expose only metadata and the prefix.

Example authenticated read:

```bash
curl -fsS \
  -H 'Authorization: Bearer sk_sm_REPLACE_WITH_CREATED_KEY' \
  -H 'x-company-id: REPLACE_WITH_COMPANY_ID' \
  http://127.0.0.1:5001/api/blog/posts
```

Useful verified route families include:

```text
/api/blog/company
/api/blog/posts
/api/blog/generate
/api/blog/keywords
/api/blog/context
/api/blog/research
/api/blog/products
/api/blog/queue
/api/blog/shopify
/api/blog/scheduler
/api/blog/benchmark
/api/blog/competitor
/api/blog/photos
```

Use encrypted per-company Shopify OAuth integrations for publishing. Do not add global Shopify access tokens for tenant publishing.

## Local iBOLT MCP Setup

The iBOLT tool server is stdio-only and is intended to run beside the app.

1. Install its separate package dependencies:

   ```bash
   cd mcp-server
   npm install
   cd ..
   ```

2. Start the app in another terminal:

   ```bash
   npm run dev
   ```

3. The checked-in Claude configuration at [`.claude/settings.json`](../.claude/settings.json) is:

   ```json
   {
     "mcpServers": {
       "ibolt-generator": {
         "command": "node",
         "args": ["mcp-server/ibolt-stdio.mjs"],
         "cwd": "/Users/yakub/Desktop/iblotmark",
         "env": {
           "IBOLT_BACKEND_URL": "http://127.0.0.1:5001"
         }
       }
     }
   }
   ```

4. For a direct process check, run:

   ```bash
   IBOLT_BACKEND_URL=http://127.0.0.1:5001 node mcp-server/ibolt-stdio.mjs
   ```

The process waits for MCP messages on stdin, so no terminal output is expected after a successful start.

### Local authentication constraint

`ibolt-stdio.mjs` currently sends neither `Authorization` nor `x-company-id` to the app. It can only reach protected blog routes when the app uses development-only bypass behavior and `DEFAULT_COMPANY_ID` identifies an existing company. The repository's onboarding smoke uses:

```text
NODE_ENV=development
IBOLT_INTERNAL_AUTH_BYPASS=true
BLOG_ALLOW_UNVALIDATED_COMPANY_SELECTION=true
```

These bypasses are forbidden by production validation. Do not use this stdio server as a production authentication pattern. Production-safe iBOLT MCP requires code changes to pass the bearer token and company context, or to register company-aware blog tools in the remote OAuth MCP server.

### Known Shopify tool failure

The stdio tool `publish_to_shopify` calls the nonexistent route:

```text
POST /api/blog/shopify/publish/:id
```

The implemented route is:

```text
POST /api/blog/shopify/posts/:id/publish
```

Until the tool is fixed, call the implemented REST endpoint with valid authentication and company headers.

## ChatGPT and Claude Connections

### Claude Code or another local stdio client

Use the checked-in `ibolt-generator` configuration above. The companion skill is [`.claude/skills/blog-writer/SKILL.md`](../.claude/skills/blog-writer/SKILL.md). The Phase 8 path `.claude/skills/ibolt-blog/SKILL.md` does not exist.

### Claude.ai remote integration

The documented OAuth/PKCE remote endpoint is:

```text
https://mcp.scholarmark.ai/mcp
```

The flow discovers OAuth metadata from the app, opens Clerk-backed consent, exchanges a PKCE code for an `mcp_sm_...` bearer token, and then lists tools. This endpoint currently exposes only ScholarMark academic tools, not the iBOLT blog tools.

### ChatGPT remote connection

The repository contains no ChatGPT connector configuration, callback registration, or verified end-to-end ChatGPT test. A standards-compatible remote client would need a public HTTPS `/mcp` endpoint plus the checked-in OAuth discovery flow, but the current endpoint would still expose only ScholarMark tools. Treat ChatGPT access to iBOLT generation as blocked until the iBOLT tools are added to the remote server and the ChatGPT OAuth flow is tested.

## Remote MCP Service

Install and run the existing remote ScholarMark service with:

```bash
cd mcp-server
npm install
npm start
```

Its verified environment names are:

```text
MCP_SERVER_PORT=5002
SCHOLARMARK_BACKEND_URL=http://127.0.0.1:5001
MCP_AUTHORIZATION_SERVER
MCP_RESOURCE_URL
```

`MCP_RESOURCE_URL` must be the public resource origin without a `/mcp` suffix according to [`mcp-server/MCP-AUTH-GUIDE.md`](../mcp-server/MCP-AUTH-GUIDE.md):

```text
MCP_RESOURCE_URL=https://mcp.scholarmark.ai
```

The following endpoints are implemented:

```text
GET              /healthz
GET              /.well-known/oauth-protected-resource
GET              /.well-known/oauth-protected-resource/mcp
GET|POST|DELETE  /mcp
GET              /sse
POST             /messages
```

`initialize` is intentionally allowed without authentication. `tools/*` methods require a bearer token and return a `WWW-Authenticate` resource-metadata challenge when it is absent.

## Deployment and Health Checks

### Main app with PM2

Standard deploy:

```bash
APP_DIR=/opt/standalone-blog-writer bash deploy/deploy.sh
```

Destructive refresh from a selected ref:

```bash
APP_DIR=/opt/standalone-blog-writer \
APP_REF=origin/master \
bash deploy/refresh-prod.sh
```

`refresh-prod.sh` runs `git reset --hard "$APP_REF"`, so it removes uncommitted server-side changes. Both deployment scripts install, check, build, preflight, smoke, start/restart the PM2 app, and call the app health endpoint. The refresh script also bootstraps the schema and saves the PM2 process list.

Checks:

```bash
curl -fsS http://127.0.0.1:5001/api/blog/health
curl -fsS http://127.0.0.1:5002/healthz
pm2 logs standalone-blog-writer --lines 10 --nostream
```

For the remote MCP reverse proxy, the checked-in nginx configuration proxies `/mcp` to port `5002`, disables buffering/cache, sets 300-second read/send timeouts, and forces `Accept: application/json, text/event-stream`. It contains no TLS certificate configuration; HTTPS termination must be provided elsewhere.

### Deployment documentation conflicts

- Both checked-in MCP PM2 files set `MCP_RESOURCE_URL=https://mcp.scholarmark.ai/mcp`, contrary to the auth guide's no-suffix requirement. Correct this operationally before relying on OAuth discovery.
- The MCP auth guide invokes the root `deploy/refresh-prod.sh`, but that script replaces only the web app process and does not start or restart `scholarmark-mcp`.
- Standalone production requires `ENABLE_LEGACY_SCHOLARMARK=false`, while the existing remote OAuth routes are registered only when legacy mode is enabled. The current standalone and historical remote-MCP deployment modes are not a single verified production topology.

## Security Cautions

- Never commit `.env`; it is ignored because it contains secrets.
- Keep all unauthenticated, unvalidated-company, unsigned-photo, local-import, demo, and extension-origin bypasses disabled in production.
- Treat `x-company-id` as tenant selection, not authentication; membership validation must remain enabled.
- Do not paste API/provider keys into chat or logs.
- The remote MCP server currently logs the first 12 characters of bearer tokens. Remove or review that behavior before hardened deployment.
- The auth guide's SQLite cleanup deletes all rows from `mcp_tokens` and `mcp_auth_codes`; back up the database and understand the multi-user impact before using it.
- Both health endpoints are shallow liveness checks. Run preflight/smoke and exercise an authenticated tool before declaring the system ready.

## Troubleshooting

| Symptom | Verified check or action |
| --- | --- |
| Production exits during startup | Run `npm run preflight:standalone`; verify HTTPS origins, live Clerk keys, 32+ character secrets, an AI key, Shopify credentials/scopes, and tenant integrity. |
| API returns `401` | Supply a valid Clerk session or `Authorization: Bearer sk_sm_...`/`mcp_sm_...` token. |
| API returns `400` asking for a company workspace | Supply `x-company-id` for a company where the authenticated user has active membership. |
| Local iBOLT MCP tools return `401` or company-selection errors | Confirm the app is on `IBOLT_BACKEND_URL`; then account for the stdio auth/company limitation above. Bypasses are development-only. |
| `publish_to_shopify` returns route-not-found | Use `POST /api/blog/shopify/posts/:id/publish` directly until the stdio tool path is corrected. |
| Claude says credentials were rejected | Disconnect and reconnect the remote integration to clear client OAuth state. Only clear server OAuth tables after a database backup and with awareness that the documented SQL affects every user. |
| Claude lists no tools | Preserve session reuse before the auth gate so `notifications/initialized` can complete; `tools/list` should then trigger OAuth. |
| PM2 keeps stale MCP environment values | Delete and recreate the `scholarmark-mcp` process with explicit `MCP_SERVER_PORT`, `SCHOLARMARK_BACKEND_URL`, `MCP_AUTHORIZATION_SERVER`, and suffix-free `MCP_RESOURCE_URL`, then run `pm2 save`. |
| Health is green but tools fail | Test OAuth, an authenticated API call with `x-company-id`, AI generation, and Shopify separately; health does not cover dependencies. |

## Blockers Before Remote iBOLT MCP Is Ready

1. Register the iBOLT blog tools in the streamable HTTP server; `mcp-server/dist/blog-tools.js` from Phase 8 is absent.
2. Add production-safe bearer-token forwarding and company selection to every blog tool call.
3. Correct the Shopify publish tool route.
4. Resolve `MCP_RESOURCE_URL`, legacy-mode, PM2, and deployment-script contradictions.
5. Test and document separate Claude.ai and ChatGPT OAuth/connector flows over public HTTPS.
6. Replace shallow health checks with dependency readiness checks or add a deployment smoke that calls authenticated MCP tools.
