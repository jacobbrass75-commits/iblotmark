# ScholarMark Changelog — March 2026

## March 14
- **Sonnet 4.6 model upgrade** — all Sonnet calls updated from `claude-sonnet-4-5-20250929` to `claude-sonnet-4-6` (1M context support)
- **MCP OAuth fixes** (13 commits over ~4 hours):
  - Restored missing `authorize.html` template that caused "Failed to render authorization page" error
  - Fixed metadata client persistence, resource discovery, auth challenge ordering
  - Deduplicated OAuth approval submissions
  - JSON-RPC parse error handling for MCP
  - Canonicalized MCP resource metadata URLs
  - **Known issue:** `onclose` infinite recursion still crashes MCP server when sessions disconnect

## March 13
- **Database schema fixes** — OCR tables (`ocr_jobs`, `ocr_page_results`) registered in Drizzle, unique constraints added, API key schema aligned with production
- **Production deploy pipeline** — `scripts/bootstrap-db.ts` for schema sync on every deploy
- **Batch analysis** — dynamic import fix for batch analysis dependencies
- **ARCHITECTURE.md** updated for March 2026 deployment milestone

## March 11
- **Dev → master merge** — major merge bringing in:
  - Clerk authentication with tier-based access control
  - Dynamic context escalation (XML tags: `<chunk_request>`, `<context_request>`)
  - Writing model selection (precision vs extended tiers)
  - Research agent (`server/researchAgent.ts`)
- **Context optimization suite** added:
  - Source roles (`server/sourceRoles.ts`) — Haiku-powered role classification
  - Evidence clipboard (`server/evidenceClipboard.ts`) — quote extraction
  - Haiku gatherer (`server/gatherer.ts`) — lightweight context collection
  - Context compaction (`server/contextCompaction.ts`) — Haiku-powered summarization
- **Production infrastructure** — PM2 ecosystem config, `deploy/refresh-prod.sh` script
- **MCP quote lookup + annotation jump links** deployed

## March 5
- **MCP server launched** — live at `https://mcp.scholarmark.ai`
  - Source retrieval tools for Claude integration
  - Deployment config added (`mcp-server/deploy/`)

## March 4
- **OAuth routes and storage** added (`server/oauthRoutes.ts`, `server/oauthStorage.ts`)
- **Writing chat dashboard** with analytics tracking (`analytics_context_snapshots`, `analytics_tool_calls` tables)

## March 2
- **Writing chat refactored** to native Anthropic `tool_use` (replaced XML tag parsing)
- **Streamed tool-step progress UI** — real-time tool execution feedback in writing chat
- **Chrome extension auth** switched from Clerk to per-account API key auth flow
- **P0 fixes** — safer streaming behavior, TypeScript error cleanup for Clerk + Express typing
- **Project picker** added to ChatSidebar with conversation badges and project context header

## March 1
- **4-phase interactive writing flow** merged from dev (Planner → Writer → Stitcher pipeline)
- **Clerk authentication** integrated with tier system (all users defaulted to max tier for testing)
- **Dynamic context escalation** and writing model selection implemented
- **Humanizer system** (`server/humanizer.ts`) documented in ARCHITECTURE.md
- **Error handling** — malformed URI/URL requests handled gracefully (400 instead of crash)

---

## Current Model Configuration
| Role | Model |
|------|-------|
| Chat / Compile / Verify (precision) | `claude-opus-4-6` |
| Chat / Compile / Verify (extended) | `claude-sonnet-4-6` |
| Research agent | `claude-sonnet-4-6` |
| Deep write (pipeline) | `claude-sonnet-4-6` |
| Pipeline default | `claude-haiku-4-5-20251001` |
| Context compaction / gatherer / source roles / clipboard | `claude-haiku-4-5-20251001` |

## Production Infrastructure
- **Server:** Hetzner cx23, `89.167.10.34`, Ubuntu
- **Main app:** PM2 `sourceannotator`, port 5001, `https://app.scholarmark.ai`
- **MCP server:** PM2 `scholarmark-mcp`, port 5002, `https://mcp.scholarmark.ai`
- **Database:** SQLite at `/opt/app/data/sourceannotator.db` (~780 MB)
- **Deploy:** `ssh root@89.167.10.34 "cd /opt/app && bash deploy/refresh-prod.sh"`

## Known Issues
1. **MCP `onclose` stack overflow** — `transport.onclose` → `server.close()` → `transport.close()` → infinite recursion → crash. PM2 restarts the process but Claude sees "credentials reverted."
2. **Batch analysis 500s** — Zod validation fails on null `type` and `adjustedNote` fields in annotation verdicts
3. **28 documents in error state** — visible in `/api/system/status`
