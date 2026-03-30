# iBolt Blog Generator — Architecture Reference

Last verified against the live codebase on 2026-03-30.

## Overview

Fork of **ScholarMark** (academic annotation platform) extended with an autonomous SEO blog generation system for **iBolt Mounts** (iboltmounts.com).

**Stack**: Express + TypeScript + SQLite/Drizzle ORM + React 18/Vite + Anthropic SDK + Clerk Auth
**Port**: 5001 (development)

---

## Project Structure

```
ibolt-blog-generator/
├── server/                     # Express backend (43 files)
│   ├── index.ts                # App startup, CORS, middleware chain
│   ├── routes.ts               # Main route registration → sub-routers (877 lines)
│   ├── db.ts                   # SQLite + Drizzle init, table creation, seeding
│   ├── auth.ts                 # Clerk + API key + JWT auth, /api/blog bypass
│   │
│   ├── # ── Original ScholarMark ──
│   ├── storage.ts              # Document CRUD
│   ├── projectStorage.ts       # Project/folder CRUD
│   ├── projectRoutes.ts        # /api/projects/*
│   ├── projectSearch.ts        # Semantic search across annotations
│   ├── chatRoutes.ts           # /api/chat/* (SSE streaming)
│   ├── chatStorage.ts          # Conversation persistence
│   ├── writingPipeline.ts      # 3-phase: Planner → Writer → Stitcher
│   ├── writingRoutes.ts        # /api/write (SSE)
│   ├── humanizer.ts            # Post-write voice transformation
│   ├── humanizerRoutes.ts      # /api/humanize (SSE)
│   ├── pipelineV2.ts           # Annotation pipeline: Generator → Verifier → Refiner
│   ├── citationGenerator.ts    # Chicago/MLA/APA formatting
│   ├── sourceRoles.ts          # Source classification (primary/secondary/tertiary)
│   ├── webClipRoutes.ts        # /api/web-clips (browser extension)
│   ├── ocrProcessor.ts         # PDF/image OCR (pdf-parse + vision API)
│   ├── ocrQueue.ts             # Persistent OCR job queue with retry
│   ├── openai.ts               # OpenAI embeddings + legacy AI helpers
│   ├── contextGenerator.ts     # ScholarMark context utilities
│   ├── contextCompaction.ts    # Context window optimization
│   ├── evidenceClipboard.ts    # Evidence copy/paste for chat
│   ├── analyticsLogger.ts      # Usage analytics
│   ├── analyticsRoutes.ts      # /api/admin/analytics/*
│   ├── authRoutes.ts           # /api/auth/*
│   ├── authStorage.ts          # User DB management
│   ├── extensionRoutes.ts      # Chrome extension API
│   ├── oauthRoutes.ts          # MCP OAuth flow
│   ├── static.ts               # Production static serving
│   ├── vite.ts                 # Dev server Vite integration
│   │
│   ├── # ── iBolt Blog Generation ──
│   ├── brandVoice.ts           # Brand voice constants + 4 prompt builders
│   ├── contextBanks.ts         # Context entry CRUD + formatContextForPrompt()
│   ├── contextSeeds.ts         # 12 vertical seed data (48 initial entries)
│   ├── contextRoutes.ts        # /api/blog/context/* (SSE streaming)
│   ├── keywordManager.ts       # CSV import, scoring, LLM clustering
│   ├── keywordRoutes.ts        # /api/blog/keywords/*
│   └── iboltResearchAgent.ts   # Reddit/YouTube/web research orchestrator
│
├── shared/
│   ├── schema.ts               # ALL Drizzle table definitions + Zod schemas (1081 lines)
│   └── annotationLinks.ts      # Position mapping utilities
│
├── client/src/
│   ├── App.tsx                 # Wouter routes, lazy page loading, ProtectedRoute
│   ├── main.tsx                # React entry + QueryClient + ClerkProvider
│   ├── pages/                  # Home, Chat, WritingPage, Projects, WebClips, etc.
│   ├── components/             # 60+ shadcn/ui + feature components
│   ├── hooks/                  # React Query hooks (useProjects, useChat, useWriting, etc.)
│   └── lib/                    # Auth helpers, queryClient, documentExport
│
├── data/
│   └── sourceannotator.db      # SQLite database file
│
├── CLAUDE.md                   # Claude Code instructions
├── ARCHITECTURE.md             # This file
└── .env                        # ANTHROPIC_API_KEY (gitignored)
```

---

## Startup Sequence

```
index.ts
  ├── Load .env (dotenv/config)
  ├── Create Express app + HTTP server
  ├── CORS (localhost, claude.ai, claude.com, custom ALLOWED_ORIGINS)
  ├── JSON parser (with rawBody capture for Clerk webhooks)
  ├── URL-encoded parser
  ├── Malformed URI guard (rejects bad percent-encoding)
  ├── configureClerk(app) — global Clerk middleware with bypass logic
  ├── Request logger (method, path, status, duration, response preview)
  ├── registerOAuthRoutes(app)
  ├── registerAuthRoutes(app)
  ├── registerRoutes(httpServer, app) ──→ routes.ts
  │     ├── Multer upload config (50MB limit)
  │     ├── initializeOcrQueue()
  │     ├── Document upload/CRUD/search routes (inline in routes.ts)
  │     ├── Annotation batch routes (inline)
  │     ├── registerProjectRoutes(app)
  │     ├── registerWebClipRoutes(app)
  │     ├── registerChatRoutes(app)
  │     ├── registerWritingRoutes(app)
  │     ├── registerHumanizerRoutes(app)
  │     ├── registerExtensionRoutes(app)
  │     ├── registerKeywordRoutes(app)     ← iBolt
  │     └── registerContextRoutes(app)     ← iBolt
  ├── initAnalytics()
  ├── Global error handler (malformed URI, 500s)
  ├── Vite dev server (dev) or serveStatic (prod)
  └── Listen on 0.0.0.0:5001
```

---

## Database (23 Tables)

### SQLite + Drizzle ORM

**Connection**: `./data/sourceannotator.db` via better-sqlite3
**Foreign keys**: Enabled via pragma
**Schema definition**: `shared/schema.ts` (Drizzle table definitions + Zod insert schemas + TypeScript types)
**Table creation**: `server/db.ts` uses `CREATE TABLE IF NOT EXISTS` SQL (safe for repeated runs)
**Column migrations**: `ensureColumn()` — adds columns if missing without breaking existing data

### ScholarMark Tables (12)

| Table | Purpose | Key Columns |
|---|---|---|
| documents | Uploaded PDFs/text | fullText, summary, mainArguments, keyConcepts, status |
| text_chunks | Document chunks | text, startPosition, endPosition, embedding |
| annotations | AI-generated highlights | highlightedText, category, note, confidence |
| users | Auth + usage | email, tier (free/pro/max), tokensUsed, storageUsed |
| projects | Workspaces | name, thesis, scope, contextSummary, contextEmbedding |
| folders | Nested project folders | projectId, parentFolderId, name |
| project_documents | Links docs to projects | citationData, sourceRole, styleAnalysis |
| project_annotations | Project-scoped annotations | highlightedText, category, promptText, promptColor |
| prompt_templates | Saved multi-prompt sets | prompts (JSON array of {text, color}) |
| conversations | Chat threads | model, writingModel, citationStyle, tone, compactionSummary |
| messages | Chat messages | role (user/assistant/system), content, tokensUsed |
| web_clips | Browser extension clips | highlightedText, sourceUrl, pageTitle, citationData |

### iBolt Blog Tables (11)

| Table | Purpose | Key Columns |
|---|---|---|
| industry_verticals | 12 categories | name, slug, terminology[], painPoints[], useCases[], regulations[], seasonalRelevance |
| context_entries | Knowledge bank | verticalId, category, content, sourceType, confidence, isVerified |
| keyword_imports | CSV upload tracking | filename, totalKeywords, newKeywords, duplicateKeywords |
| keyword_clusters | Keyword groups | name, primaryKeyword, verticalId, totalVolume, avgDifficulty, priority |
| keywords | From Ubersuggest CSV | keyword, volume, difficulty, cpc, opportunityScore, status, clusterId |
| ibolt_products | Shopify scraped | shopifyId, title, handle, description, productType, tags[], price, imageUrl |
| product_verticals | Product ↔ vertical | productId, verticalId, relevanceScore |
| generation_batches | Batch job tracking | totalPosts, completedPosts, failedPosts, status |
| blog_posts | Generated posts | title, slug, markdown, html, verification scores (0-100), status |
| blog_post_products | Products in posts | blogPostId, productId, mentionContext |
| research_jobs | Research agent tracking | verticalId, sourceType, query, status, entriesFound, error |

### Infrastructure Tables

api_keys, mcp_oauth_clients, mcp_auth_codes, mcp_tokens, analytics_tool_calls, analytics_context_snapshots, ocr_jobs, ocr_page_results

---

## Authentication

### 3 Auth Methods

1. **Clerk OAuth** — Primary. Global middleware extracts userId → resolves to local DB user with tier
2. **API Key** (`sk_sm_*` prefix) — SHA256 hashed, validated against api_keys table
3. **JWT** — Signed with JWT_SECRET, contains userId + email + tier

### Auth Bypass (auth.ts:shouldBypassClerk)

| Condition | Bypasses Clerk? |
|---|---|
| `/api/blog/*` routes | Yes — iBolt blog routes are a local tool |
| `sk_sm_*` / `mcp_sm_*` bearer token | Yes — API key auth handled separately |
| Valid JWT structure | Yes — JWT auth handled separately |
| Everything else | No — Clerk middleware runs |

### Tier System

| Tier | Tokens/mo | Storage | Access |
|---|---|---|---|
| free | 50K | 50 MB | Documents, annotations |
| pro | 500K | 500 MB | + Chat, writing pipeline |
| max | 2M | 5 GB | Full access |

---

## AI Integration

### Anthropic SDK (Claude)

| Module | Model | Purpose |
|---|---|---|
| writingPipeline.ts | claude-haiku-4-5 / claude-sonnet-4-6 | Writing phases (plan/write/stitch) |
| chatRoutes.ts | claude-opus-4-6 | Conversation AI |
| humanizer.ts | claude-sonnet-4-6 | Voice transformation |
| keywordManager.ts | claude-sonnet-4-6 | Keyword clustering |
| iboltResearchAgent.ts | claude-sonnet-4-6 | Context extraction from Reddit/YouTube/web |
| contextCompaction.ts | claude-haiku-4-5 | Context window optimization |

### OpenAI SDK (Legacy ScholarMark)

| Module | Model | Purpose |
|---|---|---|
| pipelineV2.ts | gpt-4o-mini | Annotation generation/verification/refinement |
| openai.ts | text-embedding-3-small | Semantic search embeddings |

---

## iBolt Blog Pipeline (4 Phases)

```
Keyword Cluster + Industry Context + Products
  ↓
Phase 1: PLANNER (brandVoice.ts:buildPlannerPrompt)
  → JSON outline: title, metaTitle, metaDescription, slug
  → sections[]: title, description, keywords[], productMentions[], targetWords
  ↓
Phase 2: SECTION WRITER (brandVoice.ts:buildSectionWriterPrompt, runs per section)
  → Markdown for each section with brand voice baked in
  → Integrates industry context + product details naturally
  ↓
Phase 3: STITCHER (brandVoice.ts:buildStitcherPrompt)
  → Combines sections into cohesive post
  → Adds intro (relatable scenario) + conclusion (invitational CTA)
  → Smooths transitions, verifies keyword placement
  → 800-1400 word target
  ↓
Phase 4: VERIFIER (brandVoice.ts:buildVerifierPrompt)
  → Scores: brandConsistency, seoOptimization, naturalLanguage, factualAccuracy (0-100)
  → overallScore < 70 → re-runs stitcher
  → Passes → blog post saved as "review" status
```

### Brand Voice Rules (injected into ALL phase prompts)

- Conversational expertise — friendly but credible, like a knowledgeable friend
- Education-first, sales-second — products are solutions to articulated problems
- Industry terminology used naturally (ELD Mandate, AMPS plates, etc.)
- Context-setting openings — relatable scenarios
- Specific tech specs — model numbers, dimensions, materials, compatibility
- Multiple product options — not pushy, present alternatives
- Invitational CTAs — "explore our selection" not "buy now"
- 800-1400 words per post
- **Banned phrases**: game-changer, revolutionize, seamless, cutting-edge, next-level, state-of-the-art, paradigm shift, etc.

---

## Research Agent System

### Architecture

```
ResearchOrchestrator (iboltResearchAgent.ts)
  ├── Configurable concurrency (default 3-5 parallel agents)
  ├── SSE progress streaming to client
  │
  ├── Reddit Agent
  │     ├── Predefined subreddit mapping per vertical
  │     ├── Public JSON API — no auth needed
  │     ├── Multiple search queries per vertical
  │     └── Claude extracts: user_language, pain_point, use_case, terminology, trend, competitor
  │
  ├── YouTube Agent (requires YOUTUBE_API_KEY)
  │     ├── YouTube Data API v3 search
  │     ├── Transcript extraction (youtube-transcript package)
  │     └── Claude extracts context entries from transcripts
  │
  └── Web Agent
        ├── Predefined industry URLs per vertical
        ├── HTML → text extraction
        └── Claude extracts context entries
```

### Subreddit Mapping

| Vertical | Subreddits |
|---|---|
| fishing-boating | r/fishing, r/kayakfishing, r/boating, r/bassfishing, r/Fishfinder |
| trucking-fleet | r/Truckers, r/trucking, r/FreightBrokers |
| offroading-jeep | r/Jeep, r/4x4, r/overlanding, r/Wrangler, r/offroad |
| restaurants-food-delivery | r/KitchenConfidential, r/doordash_drivers, r/UberEATS |
| content-creation-streaming | r/Twitch, r/NewTubers, r/videography, r/streaming |
| agriculture-farming | r/farming, r/agriculture, r/tractors, r/homestead |
| mountain-biking-cycling | r/MTB, r/cycling, r/ebikes, r/bikepacking |
| road-trips-travel | r/roadtrip, r/CarHacks, r/uberdrivers, r/GoRVing |
| education-schools | r/Teachers, r/edtech, r/k12sysadmin |
| kitchen-home | r/Cooking, r/HomeImprovement, r/homeautomation |
| forklifts-warehousing | r/warehouse, r/forklift, r/logistics |
| general-mounting | r/gadgets, r/DIY, r/CarAV, r/techsupport |

### Context Entry Categories

| Category | What It Captures |
|---|---|
| terminology | Industry jargon and technical terms |
| use_case | Real-world scenarios where mounting is needed |
| pain_point | Customer frustrations and problems |
| regulation | Compliance requirements (ELD, OSHA, ADA, etc.) |
| trend | Emerging patterns and market shifts |
| competitor | Mentions of RAM Mount, ProClip, etc. |
| user_language | Exact phrases and slang real people use |

---

## SSE Streaming Pattern

Used across writing pipeline, chat, research agents, and blog generation.

### Server

```typescript
res.writeHead(200, {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
});
const sendEvent = (event: string, data: any) => {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};
sendEvent("started", { message: "Processing..." });
// ... work ...
sendEvent("completed", { result });
res.end();
```

### Client

```typescript
const response = await fetch(url, { method: "POST", signal });
const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value);
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";
  for (const line of lines) {
    if (line.startsWith("data: ")) handleEvent(JSON.parse(line.slice(6)));
  }
}
```

---

## Client Architecture

### Routing (wouter)

Lazy-loaded pages with ProtectedRoute wrapper:
- `/` — Home (project list)
- `/projects/:id` — ProjectWorkspace
- `/projects/:id/documents/:docId` — Document viewer + annotation sidebar
- `/chat/:conversationId` — Chat AI
- `/write` — Writing pipeline
- `/web-clips` — Web clip manager
- `/admin/analytics` — Analytics dashboard
- `/blog/*` — iBolt blog pages (Phase 4+)

### Component Library

**shadcn/ui** — 60+ components built on Radix primitives + Tailwind CSS:
Button, Dialog, Tabs, Select, Accordion, Toast, Tooltip, ScrollArea, Sheet, etc.

### React Query Hooks Pattern

```typescript
// Query hook
export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: () => fetch("/api/projects", { headers: getAuthHeaders() }).then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  });
}
// Mutation hook
export function useCreateProject() {
  return useMutation({
    mutationFn: (data) => fetch("/api/projects", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });
}
```

---

## API Endpoints

### ScholarMark (Original)

| Method | Path | Purpose |
|---|---|---|
| POST | /api/upload | Upload document (PDF/text) |
| GET | /api/documents | List documents |
| GET | /api/documents/:id | Get document with full text |
| POST | /api/documents/:id/search | Semantic search within doc |
| POST | /api/documents/:id/annotations | Create annotations |
| GET/POST/PATCH/DELETE | /api/projects/* | Project CRUD |
| GET/POST/DELETE | /api/projects/:id/documents | Project documents |
| GET/POST/PATCH/DELETE | /api/projects/:id/folders | Folder management |
| GET/POST | /api/chat/conversations | Conversation CRUD |
| POST | /api/chat/conversations/:id/messages | Send message (SSE) |
| POST | /api/write | Writing pipeline (SSE) |
| POST | /api/humanize | Voice transformation (SSE) |
| GET/POST/DELETE | /api/web-clips | Browser clips |
| GET | /api/auth/me | Current user + usage |

### iBolt Blog Generation

| Method | Path | Purpose |
|---|---|---|
| POST | /api/blog/keywords/import | Upload keyword CSV (multipart) |
| POST | /api/blog/keywords/import-file | Import CSV by file path |
| POST | /api/blog/keywords/cluster | AI-cluster unclustered keywords |
| GET | /api/blog/keywords | List all keywords (?status=) |
| GET | /api/blog/keywords/clusters | List clusters with keywords |
| GET | /api/blog/keywords/imports | Import history |
| GET | /api/blog/context/verticals | List 12 industry verticals |
| GET | /api/blog/context/verticals/:id | Get vertical with context stats |
| GET | /api/blog/context/entries/:verticalId | List context entries (?category=&includeUnverified=) |
| POST | /api/blog/context/entries | Add manual context entry |
| PATCH | /api/blog/context/entries/:id/verify | Verify/unverify entry |
| DELETE | /api/blog/context/entries/:id | Delete entry |
| GET | /api/blog/context/prompt/:verticalId | Get formatted prompt context |
| POST | /api/blog/context/research/run | Launch research agents (SSE) |
| POST | /api/blog/context/research/reddit | Reddit swarm all verticals (SSE) |
| POST | /api/blog/context/research/vertical/:id | Research single vertical (SSE) |
| GET | /api/blog/context/research/jobs | Research job history |

### Planned (Phase 3+)

| Method | Path | Purpose |
|---|---|---|
| POST | /api/blog/generate | Generate post from cluster (SSE) |
| POST | /api/blog/generate/batch | Batch generate multiple posts |
| GET | /api/blog/posts | List generated posts |
| GET/PATCH | /api/blog/posts/:id | Get/update post |
| POST | /api/blog/products/scrape | Scrape iboltmounts.com catalog |
| GET | /api/blog/products | List products |

---

## Key Dependencies

| Package | Purpose |
|---|---|
| express | HTTP server |
| better-sqlite3 | SQLite database driver |
| drizzle-orm + drizzle-zod | Type-safe ORM + validation |
| @anthropic-ai/sdk | Claude AI (writing, clustering, research extraction) |
| openai | Legacy GPT-4o-mini annotations + embeddings |
| @clerk/express | Authentication |
| multer | File upload handling |
| pdf-parse | PDF text extraction |
| youtube-transcript | YouTube transcript fetching |
| zod | Runtime type validation |
| react + react-dom | Frontend framework |
| @tanstack/react-query | Server state management |
| wouter | Client-side routing |
| tailwindcss | Utility CSS |
| @radix-ui/* | Accessible UI primitives |
| vite | Build tool + dev server |

---

## Current State (Phase 2 complete)

- **46 keywords** imported, scored, and clustered into **13 blog topics**
- **299 context entries** across all 12 verticals (48 seeds + 251 from Reddit research)
- **36 research jobs** completed, 0 failures
- **4 prompt builders** ready for the blog generation pipeline
- **All API endpoints** live on port 5001
- **Next**: Phase 3 — blogPipeline.ts, htmlRenderer.ts, productScraper.ts
