# iBolt Blog Generator — Current State (April 2, 2026)

For handoff context. Copy into Notion or share with collaborators.

---

## What Is This?

An autonomous SEO blog post generator for **iBolt Mounts** (iboltmounts.com). Takes keyword data, industry context, and product catalog → generates Shopify-ready blog posts with a 4-phase AI pipeline.

Built as a fork of ScholarMark (academic annotation platform). The ScholarMark features still work but aren't being developed further.

**Repo**: `git@github.com:jacobbrass75-commits/iblotmark.git`
**Stack**: Express + TypeScript + React 18 + SQLite + Anthropic Claude API
**Runs on**: Port 5001 locally, production at Hetzner (89.167.10.34)

---

## What's Built and Working

### Blog Generation Pipeline (Complete)
- **4-phase AI pipeline**: Planner → Section Writer → Stitcher → Verifier
- Uses Claude Sonnet for all generation phases
- Brand voice baked directly into prompts (no separate humanizer)
- Quality scoring: brand consistency, SEO optimization, natural language, factual accuracy
- Auto-retries if quality score < 70
- Real-time SSE streaming shows progress in the UI

### Keyword System (Complete)
- CSV import from Ubersuggest/SEMrush
- Automatic opportunity scoring (volume + difficulty + position)
- AI-powered keyword clustering into topic groups
- Auto-mapping keywords to industry verticals

### 12 Industry Verticals (Complete)
Pre-seeded with industry-specific context:
1. Fishing/Boating, 2. Forklifts/Warehousing, 3. Trucking/Fleet, 4. Offroading/Jeep, 5. Restaurants/Food Delivery, 6. Education/Schools, 7. Content Creation/Streaming, 8. Agriculture/Farming, 9. Kitchen/Home, 10. Road Trips/Travel, 11. Mountain Biking/Cycling, 12. General Mounting

### Research Agent System (Complete)
- Parallel agents search Reddit, YouTube, and web for industry context
- Up to 50 concurrent agents
- Auto-extracts terminology, pain points, user language, trends
- Findings stored for human review/verification

### Product Management (Complete)
- Scrapes iboltmounts.com/products.json (full Shopify catalog)
- AI maps products to relevant verticals
- PDF catalog import with AI product extraction
- Photo bank with GPT-4V image analysis
- Deterministic photo selection for blog posts

### HTML Rendering (Complete)
- Markdown to Shopify-ready HTML
- Auto-links product mentions to Shopify URLs
- FAQ schema (JSON-LD structured data)
- SEO meta tags
- Responsive Shopify-compatible formatting

### Full UI (Complete)
7 blog-specific pages:
- Dashboard with stats and quick actions
- Keyword manager with CSV import and clustering
- Batch generator with queue and competitor scraper
- Post review with editor, scores, and HTML export
- Industry context browser with research triggers
- Product catalog with scrape and mapping
- Photo bank with vision analysis

### MCP Server (Complete)
- Live at https://mcp.scholarmark.ai
- 10 tools for projects, sources, conversations
- OAuth flow for external integrations

---

## Content Generated So Far

**24 blog posts** across 4 phases:
- 5 collection pages (barcode scanner, forklift, restaurant, truck, modularity)
- 6 comparison posts (best-of lists, iBolt vs RAM)
- 3 updated pillar guides
- 10 brand-specific posts (products, events, use cases)

**84 product photos** from Shopify CDN embedded across all posts.

**19 posts published as Shopify drafts** to the News blog (April 1, 2026).

---

## Database

31 tables in SQLite via Drizzle ORM. Key blog tables:
- `industry_verticals` — 12 verticals with terminology, pain points, use cases
- `context_entries` — Knowledge bank entries from research
- `keywords` / `keyword_clusters` — Imported and clustered keywords
- `ibolt_products` — Scraped product catalog
- `blog_posts` — Generated posts with verification scores
- `product_photos` — Photos with AI analysis
- `research_jobs` — Research agent job tracking

---

## Tech Dependencies

- **AI**: Anthropic Claude (Sonnet for generation, Opus for precision tasks), OpenAI GPT-4V (photo analysis)
- **UI**: React 18, shadcn/ui, Tailwind CSS, TanStack React Query, wouter routing
- **Backend**: Express, Drizzle ORM, better-sqlite3
- **Media**: sharp (image processing), pdf-parse, multer
- **Research**: youtube-transcript, Reddit public JSON API

---

## What's NOT Built Yet

- **Shopify auto-upload** — Posts are generated but must be manually uploaded or exported as HTML. The Shopify API config exists (`shopify-api-config.md`) with client credentials grant flow ready to integrate.
- **MCP blog tools** — Current MCP server only has ScholarMark tools. No blog generation or Shopify publishing tools exposed.
- **Competitor product database** — `competitorScraper.ts` exists for blog URL analysis but no structured competitor product database.
- **Inventory management** — No inventory tracking or stock level integration.
- **Non-technical user workflow** — Currently requires running the app locally. No Claude skill for one-shot blog creation.

---

## Known Issues

1. MCP `onclose` stack overflow — session disconnect can crash the server
2. Batch analysis 500 errors — Zod validation on null fields
3. 28 documents in error state (ScholarMark side)
4. No `.env.example` — users must know which env vars to set

---

## Infrastructure

| Service | Location |
|---------|----------|
| Main app | PM2 `sourceannotator`, port 5001 |
| MCP server | PM2 `scholarmark-mcp`, port 5002 |
| Production | Hetzner cx23, 89.167.10.34 |
| Database | SQLite at `/opt/app/data/sourceannotator.db` (~780 MB) |
| Main app URL | https://app.scholarmark.ai |
| MCP URL | https://mcp.scholarmark.ai |
| Shopify store | iboltmounts.myshopify.com |
| Shopify app | `iboltblog` (client credentials grant, 24h token expiry) |

---

## Key Numbers

| Metric | Count |
|--------|-------|
| Server files | 55+ |
| Server lines | 22,079 |
| Client pages | 21 |
| Client hooks | 18 |
| UI components | 50 shadcn + 19 custom |
| Database tables | 31 |
| Industry verticals | 12 |
| Generated posts | 24 |
| Product photos | 84 |
| Shopify drafts | 19 |
