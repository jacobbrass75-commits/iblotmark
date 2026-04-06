# iBolt Blog Generator — Architecture Reference

Last verified against the live codebase on 2026-04-06 (Phase 5 complete, 24 AI Search Optimization posts with product photos published as Shopify drafts. Stdio MCP server added for Claude Code integration).

## Overview

Fork of **ScholarMark** (academic annotation platform) extended with an autonomous SEO blog generation system for **iBolt Mounts** (iboltmounts.com). Generates 800-1400 word, SEO-optimized blog posts targeting 12 industry verticals through a 4-phase AI pipeline: Planner → Section Writer → Stitcher → Verifier.

**Stack**: Express + TypeScript + SQLite/Drizzle ORM + React 18/Vite + Anthropic SDK
**Port**: 5001 (main app), 5002 (MCP server)
**Auth**: Disabled (internal tool, Clerk removed)
**Production**: Hetzner cx23 (89.167.10.34), PM2, https://app.scholarmark.ai

---

## Project Structure

```
iblotmark/
├── server/                     # Express backend (55+ files, 22,079 lines)
│   ├── index.ts                # App bootstrap, CORS, middleware chain
│   ├── routes.ts               # Route registration → sub-routers (877 lines)
│   ├── db.ts                   # SQLite + Drizzle init, table creation, seeding (464 lines)
│   ├── auth.ts                 # Clerk + API key + JWT auth (disabled)
│   │
│   ├── # ── ScholarMark (Original) ──
│   ├── storage.ts              # Document CRUD
│   ├── projectStorage.ts       # Project/folder CRUD
│   ├── projectRoutes.ts        # /api/projects/*
│   ├── projectSearch.ts        # Semantic search across annotations
│   ├── chatRoutes.ts           # /api/chat/* (SSE streaming, 60KB)
│   ├── chatStorage.ts          # Conversation persistence
│   ├── writingPipeline.ts      # 3-phase: Planner → Writer → Stitcher (18KB)
│   ├── writingRoutes.ts        # /api/write (SSE)
│   ├── humanizer.ts            # Post-write voice transformation (Gemini/Anthropic)
│   ├── humanizerRoutes.ts      # /api/humanize (SSE)
│   ├── pipelineV2.ts           # Annotation pipeline: Generator → Verifier → Refiner (32KB)
│   ├── citationGenerator.ts    # Chicago/MLA/APA formatting (28KB)
│   ├── sourceRoles.ts          # Source classification
│   ├── webClipRoutes.ts        # /api/web-clips (browser extension)
│   ├── ocrProcessor.ts         # PDF/image OCR (43KB)
│   ├── ocrQueue.ts             # Persistent OCR job queue with retry
│   ├── openai.ts               # OpenAI embeddings + legacy AI helpers (27KB)
│   ├── contextGenerator.ts     # ScholarMark context utilities
│   ├── contextCompaction.ts    # Context window optimization
│   ├── evidenceClipboard.ts    # Evidence copy/paste for chat
│   ├── analyticsLogger.ts      # Usage analytics
│   ├── analyticsRoutes.ts      # /api/admin/analytics/*
│   ├── oauthRoutes.ts          # MCP OAuth flow (32KB)
│   ├── oauthStorage.ts         # OAuth state persistence
│   ├── extensionRoutes.ts      # Chrome extension API
│   ├── static.ts               # Production static file serving
│   ├── vite.ts                 # Dev server Vite integration
│   │
│   ├── # ── iBolt Blog Generation ──
│   ├── brandVoice.ts           # Brand voice constants + 4 prompt builders (9.5KB)
│   ├── seoStrategy.ts          # SEO positioning, focus areas, competitor specs
│   ├── contextBanks.ts         # Context entry CRUD + formatContextForPrompt() (4.8KB)
│   ├── contextSeeds.ts         # 12 vertical seed data, 48 initial entries (26KB)
│   ├── contextRoutes.ts        # /api/blog/context/* with SSE streaming (9.3KB)
│   ├── contextChunker.ts       # Smart context retrieval + token budgets (7.4KB)
│   ├── keywordManager.ts       # CSV import, opportunity scoring, LLM clustering (9.9KB)
│   ├── keywordRoutes.ts        # /api/blog/keywords/*
│   ├── iboltResearchAgent.ts   # Reddit/YouTube/web research orchestrator (18KB)
│   ├── blogPipeline.ts         # 4-phase: Planner → Writer → Stitcher → Verifier (18KB)
│   ├── blogRoutes.ts           # /api/blog/generate, /posts, /export, /queue (15KB)
│   ├── htmlRenderer.ts         # Markdown → Shopify HTML + FAQ schema + auto-links (10KB)
│   ├── productScraper.ts       # iboltmounts.com/products.json scraper + mapping (7.3KB)
│   ├── productRoutes.ts        # /api/blog/products/*
│   ├── photoBank.ts            # Photo storage, thumbnails, GPT-4V analysis (12KB)
│   ├── photoSelector.ts        # Deterministic photo scoring for posts (5.9KB)
│   ├── photoRoutes.ts          # /api/blog/photos/*
│   ├── catalogImporter.ts      # PDF catalog → product enrichment, 3-tier matching (8.5KB)
│   ├── catalogRoutes.ts        # /api/blog/catalog/*
│   ├── competitorScraper.ts    # Competitor URL analysis + auto-queue (7.6KB)
│   ├── verticalCreator.ts      # AI-generate verticals from description
│   ├── writingQueue.ts         # Queue management (max 3 concurrent, SSE)
│   ├── scheduler.ts            # Autonomous batch: research/sync/generate/photos/chunks
│   └── schedulerRoutes.ts      # /api/blog/scheduler/* (start/stop/trigger/config)
│
├── client/src/                 # React 18 frontend
│   ├── App.tsx                 # wouter router + lazy routes
│   ├── main.tsx                # React DOM render
│   ├── index.css               # Tailwind + Eva theme (dual light/dark)
│   ├── pages/                  # 21 route pages
│   │   ├── Home.tsx            # Dashboard
│   │   ├── BlogDashboard.tsx   # /blog — stats, recent posts, quick actions
│   │   ├── KeywordManager.tsx  # /blog/keywords — CSV import, table, clustering
│   │   ├── BatchGenerator.tsx  # /blog/generate — cluster queue, SSE progress, competitor scraper
│   │   ├── PostReview.tsx      # /blog/posts/:id — editor, scores, HTML export
│   │   ├── IndustryContext.tsx  # /blog/context — vertical browser, research triggers
│   │   ├── ProductCatalog.tsx  # /blog/products — product grid, scrape, vertical mapping
│   │   ├── CatalogImport.tsx   # /blog/catalog — PDF catalog upload
│   │   ├── PhotoBank.tsx       # /blog/photos — photo management, vision analysis
│   │   ├── Chat.tsx            # Multi-conversation chat
│   │   ├── WritingPage.tsx     # Academic writing workspace
│   │   ├── Projects.tsx        # Project list
│   │   ├── ProjectWorkspace.tsx # Project hub (51KB)
│   │   ├── ProjectDocument.tsx # Document annotator (42KB)
│   │   ├── WebClips.tsx        # Web clip manager
│   │   ├── AdminAnalytics.tsx  # Analytics dashboard
│   │   └── [Login, Register, Pricing, ExtensionAuth, not-found]
│   ├── components/
│   │   ├── ui/                 # 50 shadcn/ui primitives (Radix UI + Tailwind)
│   │   ├── chat/               # Chat sub-components
│   │   ├── analytics/          # Admin dashboard charts (Recharts)
│   │   ├── WritingChat.tsx     # AI writing interface with SSE
│   │   ├── BootSequence.tsx    # NERV-style animated boot
│   │   ├── ThemeToggle.tsx     # Eva/Darling theme switcher
│   │   └── [19 more custom components]
│   ├── hooks/                  # 18 React hooks
│   │   ├── useBlogPipeline.ts  # SSE streaming for 4-phase generation
│   │   ├── useBlogPosts.ts     # Blog post CRUD queries
│   │   ├── useKeywords.ts      # Keyword/cluster/import queries + mutations
│   │   ├── useVerticals.ts     # Vertical/context entry queries + mutations
│   │   ├── useProducts.ts      # Product queries + scrape/map mutations
│   │   ├── usePhotoBank.ts     # Photo management
│   │   ├── useCatalogImport.ts # Catalog upload
│   │   └── [11 ScholarMark hooks]
│   └── lib/
│       ├── queryClient.ts      # TanStack React Query (staleTime: 5min)
│       ├── markdownConfig.tsx   # Markdown rendering config
│       └── [export utils, clipboard, auth]
│
├── shared/
│   ├── schema.ts               # All 31 database tables + Zod validation (1,222 lines)
│   └── annotationLinks.ts      # Quote fingerprinting utilities
│
├── mcp-server/                 # MCP server (port 5002)
│   ├── server.mjs              # StreamableHTTP + SSE transports
│   ├── dist/mcp-tools.js       # 10 tools (projects, sources, conversations, compile)
│   ├── deploy/                 # nginx + PM2 configs
│   └── README.md               # Live at https://mcp.scholarmark.ai
│
├── chrome-extension/           # Web clipper browser extension
├── content-output/             # 24 generated blog posts (4 phases)
├── scripts/                    # Build, migrate, test utilities
├── .claude/                    # Claude Code skills, commands, hooks
├── .claude-docs/               # Internal documentation (10 files)
├── changelog/                  # MARCH-2026.md development history
├── tests/                      # Vitest test suite
├── prompts/                    # Prompt templates
└── deploy/                     # Production deployment scripts
```

---

## Database Schema (31 Tables)

**SQLite via Drizzle ORM** — File: `./data/sourceannotator.db`

### iBolt Blog Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `industry_verticals` | 12 industry categories | name, slug, terminology[], painPoints[], useCases[], regulations[], seasonalRelevance, compatibleDevices[] |
| `context_entries` | Industry knowledge bank | vertical_id, category (terminology/use_case/pain_point/regulation/trend/competitor/user_language), content, source_type, confidence, is_verified |
| `keywords` | From Ubersuggest CSV | keyword, volume, difficulty, cpc, opportunity_score, status, cluster_id |
| `keyword_imports` | CSV upload batch tracking | filename, total_keywords, new_keywords, duplicate_keywords |
| `keyword_clusters` | Grouped keywords for posts | name, primary_keyword, vertical_id, total_volume, avg_difficulty, priority, status |
| `ibolt_products` | Scraped from iboltmounts.com | shopify_id, title, handle, description, product_type, vendor, tags, image_url, price, url, catalog_description |
| `product_verticals` | Product ↔ vertical mapping | product_id, vertical_id, relevance_score |
| `blog_posts` | Generated posts | title, slug, meta_title, meta_description, markdown, html, status, word_count, verification scores (brand/seo/language/accuracy/overall), batch_id |
| `blog_post_products` | Products mentioned in posts | blog_post_id, product_id, mention_context |
| `generation_batches` | Batch job tracking | name, total_posts, completed_posts, failed_posts, status |
| `research_jobs` | Research agent tracking | vertical_id, source_type (reddit/youtube/web), query, status, entries_found, error |

### Photo & Catalog Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `product_photos` | Product images + AI analysis | product_id, filename, file_path, thumbnail_path, angle_type, context_type, setting_description, quality_score, is_hero, vertical_relevance, ai_analysis |
| `blog_post_photos` | Photos selected for posts | blog_post_id, photo_id, section_index, placement (inline/product-spotlight/hero), alt_text, caption, selection_reason |
| `product_catalog_imports` | PDF catalog import tracking | filename, total_pages, extracted_products, matched_products, status |
| `product_catalog_extractions` | AI-extracted from PDFs | import_id, extracted_name, extracted_description, page_number, confidence, matched_product_id, match_status |
| `pipeline_context_chunks` | Pre-chunked context for retrieval | source_type, source_id, chunk_text, token_estimate, vertical_id |

### ScholarMark Tables

| Table | Purpose |
|-------|---------|
| `documents` | Uploaded PDFs/text with fullText, summary, embeddings |
| `text_chunks` | Document segments with embedding vectors |
| `annotations` | AI-generated highlights (category, confidence, multi-prompt) |
| `users` | Auth + usage tracking (tier-based) |
| `projects` | Workspaces with thesis, scope, context |
| `folders` | Nested project folder hierarchy |
| `project_documents` | Document ↔ project links with sourceRole |
| `project_annotations` | Project-scoped annotations |
| `prompt_templates` | Saved multi-prompt sets |
| `conversations` | Chat threads |
| `messages` | Chat messages with token tracking |
| `web_clips` | Browser extension clips |

### Infrastructure Tables

| Table | Purpose |
|-------|---------|
| `api_keys` | API key management |
| `mcp_oauth_clients` / `mcp_auth_codes` / `mcp_tokens` | MCP OAuth flow |
| `analytics_tool_calls` / `analytics_context_snapshots` | Usage analytics |
| `ocr_jobs` / `ocr_page_results` | OCR processing queue |

---

## Blog Generation Pipeline (4 Phases)

**Entry point**: `server/blogPipeline.ts` → `runBlogPipeline()`
**LLM Model**: `claude-sonnet-4-20250514`
**Streaming**: SSE events (status, plan, section, stitched, verified, complete, error)

### Phase 1: Planner
- **Input**: Keyword cluster + industry context + product catalog
- **Output**: JSON outline with SEO meta tags, sections[], keyword distribution, productMentions[]
- **Prompt**: `buildPlannerPrompt()` from `brandVoice.ts`
- **Context**: Top-K relevant chunks from `contextChunker.ts` (budget: 3000 tokens)

### Phase 2: Section Writer
- **Input**: Plan outline + per-section context
- **Output**: Individual section markdown with product mentions
- **Prompt**: `buildSectionWriterPrompt()` with brand voice baked in
- **Context**: Section-specific chunks (budget: 1500 tokens per section)
- **Photos**: `photoSelector.ts` scores and selects 1 photo per section

### Phase 3: Stitcher
- **Input**: All sections + photo placements + plan metadata
- **Output**: Complete markdown document with smooth transitions
- **Prompt**: `buildStitcherPrompt()` ensures voice consistency
- **Context**: Compact overview (budget: 800 tokens)

### Phase 4: Verifier
- **Input**: Final markdown + original plan + keyword targets
- **Output**: Quality scores (0-100 each):
  - `brandConsistency` — matches iBolt voice guidelines
  - `seoOptimization` — keyword placement, meta tags, structure
  - `naturalLanguage` — reads like human expert, no AI patterns
  - `factualAccuracy` — product specs, claims, pricing correct
  - `overall` — weighted average
- **Action**: If overall < 70, re-runs Stitcher with verifier feedback
- **Non-fatal**: Pipeline continues even if verifier fails

### Post-Pipeline Processing
- `htmlRenderer.ts` → Markdown to Shopify-ready HTML
  - `autoLinkProducts()` — links product mentions to Shopify URLs
  - `extractFaqSchema()` — generates JSON-LD FAQ structured data
  - `renderShopifyHtml()` — full HTML with meta tags + schema markup
- Status set to "draft" → ready for human review

---

## Brand Voice System

**File**: `server/brandVoice.ts` (9.5KB)

**BRAND_VOICE constant** injected into ALL 4 pipeline phases:
- **Tone**: Conversational expertise — friendly but credible
- **Approach**: Education-first, sales-second
- **Word count**: 800-1400 words
- **Key messaging**: 300+ modular parts, industry-standard ball sizes (17mm/20mm/25mm/38mm/57mm), cross-compatible with RAM, industrial-grade materials, 24hr shipping, 2-yr warranty
- **Unique products**: Tablet Tower (restaurants), XL Barcode Scanner Mount, LockPro security, Mount Configurator

**Banned phrases**: "game-changer", "seamless", "cutting-edge", "next-level", "empower", "revolutionize"
**No em dashes / en dashes** — use commas or periods instead

---

## SEO Strategy

**File**: `server/seoStrategy.ts`

**Repositioning**:
- OLD: "iBOLT = cheaper/easier alternative to RAM"
- NEW: "iBOLT = modular, industrial-grade, purpose-built for warehouses, forklifts, restaurants, commercial fleets"

**5 Priority Focus Areas**:
1. Restaurant Mounts (Tablet Tower angle)
2. Forklift Mounts (industrial vs car adaptation)
3. Modularity / Build-Your-Own
4. Barcode Scanner Holders
5. Truck / ELD Mounts

**Comparison posts** planned vs RAM, Arkon, Heckler Design

---

## Research Agent System

**File**: `server/iboltResearchAgent.ts` (18KB)

Ruflo-inspired parallel agent system that auto-populates context banks:

| Agent | Source | Method |
|-------|--------|--------|
| RedditAgent | `/r/{subreddit}/search.json` | Public JSON API, no auth. Pre-configured subreddit lists per vertical |
| YouTubeAgent | YouTube Data API v3 | Search + `youtube-transcript` for transcript extraction |
| WebAgent | Web fetch | URL scraping + Claude extraction |

**Orchestrator**: Up to 50 concurrent agents, reports progress via SSE callbacks
**Extraction**: Claude extracts terminology, pain_points, user_language, trends from raw content
**Output**: `contextEntries` with `isVerified: false` for human review

---

## Product Management

### Product Scraper (`server/productScraper.ts`)
- Hits `iboltmounts.com/products.json` (public Shopify endpoint, paginated 250/page)
- Strips HTML, deduplicates, upserts to DB
- `mapProductsToVerticals()` — Claude assigns products to verticals with relevance scores

### Catalog Importer (`server/catalogImporter.ts`)
- PDF upload → `pdf-parse` text extraction
- Smart chunking on page boundaries
- Claude extracts product names/descriptions per chunk
- 3-tier matching: exact title → fuzzy match → LLM similarity

### Photo Bank (`server/photoBank.ts`)
- File upload with `sharp` normalization + thumbnail generation
- Batch import from directory, auto-associates via filename
- GPT-4V analysis: angle_type, context_type, quality_score, vertical_relevance

### Photo Selector (`server/photoSelector.ts`)
- **Deterministic scoring** (no AI, reproducible):
  - Product mention in section: +3
  - Context type match: +0.5 to +2
  - Vertical relevance: +2
  - Quality score: +0 to +1
  - Diversity penalty: -2 (avoid repeats)
- Selects 1 photo per section + hero photo

---

## Context Banking

### Context Seeds (`server/contextSeeds.ts`)
12 pre-seeded verticals with 48 initial entries covering terminology, pain points, use cases, regulations, seasonal relevance, compatible devices.

### Context Chunker (`server/contextChunker.ts`)
Token budget management for prompt injection:

| Phase | Budget |
|-------|--------|
| Planner | 3,000 tokens |
| Section Writer | 1,500 tokens |
| Stitcher | 800 tokens |
| Verifier | 500 tokens |

- `rebuildContextChunks()` — pre-chunks context entries and product descriptions
- `getRelevantChunks()` — scores by keyword relevance, returns top-K within budget
- `compactContext()` — truncates preserving sentence boundaries

---

## Keyword System

**File**: `server/keywordManager.ts`

1. **Import**: Parse Ubersuggest/SEMrush CSV → deduplicate → store
2. **Score**: `opportunityScore = volume(0.4) + difficulty(0.3) + position(0.3)`
3. **Cluster**: Claude groups keywords semantically (batch 10 at a time)
4. **Map**: `autoMapKeywordsToVerticals()` assigns to best-matching vertical
5. **Status flow**: `new → clustered → draft → published`

---

## API Routes

### Blog Routes (`/api/blog/*`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/blog/generate` | Single post generation (SSE streaming) |
| POST | `/blog/generate/batch` | Batch generation from cluster IDs |
| GET | `/blog/posts` | List posts (filter: status, verticalId, limit) |
| GET | `/blog/posts/:id` | Single post with all metadata |
| PATCH | `/blog/posts/:id` | Update post (status, markdown) |
| DELETE | `/blog/posts/:id` | Delete post |
| POST | `/blog/posts/:id/publish` | Mark as published |
| GET | `/blog/batches` | Generation batch history |
| POST | `/blog/keywords/import` | CSV file upload |
| POST | `/blog/keywords/cluster` | Run AI clustering |
| GET | `/blog/keywords` | List keywords (filter: status) |
| GET | `/blog/keywords/clusters` | List clusters with counts |
| GET/POST | `/blog/context/verticals` | CRUD verticals |
| GET/POST | `/blog/context/entries/:verticalId` | CRUD context entries |
| POST | `/blog/context/research` | Trigger research orchestrator (SSE) |
| POST | `/blog/products/scrape` | Scrape iboltmounts.com |
| POST | `/blog/products/map-verticals` | AI vertical mapping |
| GET | `/blog/products` | List products (filter: verticalId) |
| POST | `/blog/photos/upload` | Batch photo upload |
| POST | `/blog/photos/batch-analyze` | GPT-4V analysis (SSE) |
| POST | `/blog/catalog/import` | PDF catalog upload (SSE) |
| GET/POST | `/blog/scheduler/*` | Autonomous scheduler control |

### ScholarMark Routes (Legacy, intact)

| Prefix | Purpose |
|--------|---------|
| `/api/projects/*` | Project/folder/document CRUD |
| `/api/chat/*` | Conversation streaming |
| `/api/write` | Academic writing pipeline |
| `/api/humanize` | Post-write humanization |
| `/api/web-clips` | Browser extension clips |
| `/api/admin/analytics/*` | Usage analytics |

---

## AI Model Configuration

| Use Case | Model |
|----------|-------|
| Blog pipeline (plan, write, stitch, verify) | `claude-sonnet-4-20250514` |
| Keyword clustering, product mapping | `claude-sonnet-4-20250514` |
| Research extraction | `claude-sonnet-4-20250514` |
| Chat/Compile/Verify (precision) | `claude-opus-4-6` |
| Context optimization | `claude-haiku-4-5-20251001` |
| Photo analysis | `gpt-4o` (OpenAI) |
| Document embeddings | `text-embedding-3-small` (OpenAI) |
| Humanizer fallback | Gemini |

---

## MCP Servers

### Remote MCP Server (ScholarMark)

**Location**: `/mcp-server/server.mjs`
**Live**: https://mcp.scholarmark.ai (port 5002)
**Transports**: StreamableHTTPServerTransport + SSEServerTransport (legacy)

**11 Tools**:
- `get_projects`, `get_project_sources`, `get_source_summary`, `get_source_annotations`, `get_source_chunks`
- `get_web_clips`
- `start_conversation`, `get_conversations`, `send_message`
- `compile_paper`, `verify_paper`

### Stdio MCP Server (iBolt Blog Generator)

**Location**: `/mcp-server/ibolt-stdio.mjs`
**Transport**: StdioServerTransport (for Claude Code local integration)
**Backend**: Proxies to main app at `http://127.0.0.1:5001`
**Requires**: Main app running (`npm run dev` in repo root)

**25 Tools** across 7 domains:

| Domain | Tools |
|--------|-------|
| Blog Posts | `list_blog_posts`, `get_blog_post`, `get_blog_post_html`, `update_blog_post`, `generate_blog_post` |
| Keywords | `list_keywords`, `list_keyword_clusters`, `import_keywords`, `cluster_keywords` |
| Industry Context | `list_verticals`, `get_context_entries`, `add_context_entry`, `run_research` |
| Products | `list_products`, `scrape_products` |
| Queue | `get_queue`, `add_to_queue`, `add_batch_to_queue` |
| Shopify | `publish_to_shopify`, `shopify_status`, `list_shopify_articles` |
| Scheduler | `scheduler_status`, `start_scheduler`, `stop_scheduler`, `trigger_scheduler_action` |
| Competitor | `analyze_competitor` |

**Configuration**: Registered in `.claude/settings.json` for automatic loading in Claude Code sessions within this project.

---

## Environment Variables

```
ANTHROPIC_API_KEY          # Required — Claude API key
OPENAI_API_KEY             # Required — GPT-4V photo analysis + embeddings
YOUTUBE_API_KEY            # Optional — research agent video search
PORT                       # Default 5001
NODE_ENV                   # production or development
ALLOWED_ORIGINS            # Comma-separated CORS whitelist
```

---

## Build & Development

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start Express + Vite dev server (HMR) |
| `npm run build` | Production build → `dist/index.cjs` + `dist/public/` |
| `npm run start` | Run production bundle |
| `npm run check` | TypeScript strict check |
| `npm run test` | Sequential vitest (SQLite limitation) |
| `npm run db:push` | Drizzle schema push to SQLite |
| `npm run db:generate` | Generate Drizzle migrations |
| `npm run setup` | `npm install && npm run db:push` |

---

## Content Output (24 Posts)

Generated and stored in `/content-output/`:

| Phase | Posts | Focus |
|-------|-------|-------|
| Phase 1 | 5 collection pages | Barcode Scanner, Forklift, Restaurant POS, Truck Fleet, Modularity |
| Phase 2 | 6 comparison posts | Best-of lists, iBolt vs RAM, modular systems |
| Phase 3 | 3 updated guides | Forklift pillar, modular system, restaurant tablet |
| Phase 4 | 10 brand posts | Specific products, events (NRA 2026), use cases |

All 24 include: Markdown + HTML, Shopify CDN product photos (84 total), FAQ schema, JSON-LD, meta tags.

**Shopify Status**: 19 posts published as drafts to News blog (April 1, 2026).

---

## Architectural Patterns

1. **SSE Streaming** — All long-running operations stream real-time progress
2. **Token Budgeting** — Context injection sized per pipeline phase
3. **Deterministic Photo Selection** — Scoring function (no AI) for reproducibility
4. **Database-Centric** — All state persisted; re-runnable at any pipeline step
5. **Vertical Context Banking** — Research agents auto-populate; humans verify
6. **Product Enrichment** — PDF catalogs + Shopify scraping → extended descriptions
7. **Brand Voice Injection** — Baked into ALL prompts (no separate humanizer pass)
8. **Ruflo-Inspired Agents** — Parallel concurrent research (up to 50 agents)
9. **Lazy Route Loading** — Client pages loaded on-demand via React.lazy()
10. **TanStack React Query** — Server state with 5-minute stale time
11. **Dual MCP Transports** — Remote HTTP/SSE for web clients + local stdio for Claude Code

---

## Claude Code Integration

### Skills

**Blog Writer** (`.claude/skills/blog-writer/SKILL.md`):
One-shot blog post generation from a topic idea. Uses ibolt MCP tools to pull industry context, products, and photos, then generates a complete Shopify-ready blog post following brand voice guidelines. Invoked via `/blog-writer` or naturally when asking to write a blog post.

### Agents
34 reusable agents in `.claude/agents/` covering code review, testing, debugging, SEO, design, and more.

### Commands
23 slash commands in `.claude/commands/` for workflows like multi-review, issue resolution, PR management, and session handoffs.
