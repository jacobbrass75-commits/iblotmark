# iBolt Blog Generator - Claude Code Instructions

## What This Is

Autonomous SEO blog generator for **iBolt Mounts** (iboltmounts.com), forked from ScholarMark. Full-stack Express + React + SQLite/Drizzle ORM + Anthropic Claude + OpenAI GPT-4V.

- **Local dev**: `npm run dev` → port 5001
- **Production**: Hetzner cx23 at https://app.scholarmark.ai
- **MCP Server**: `node mcp-server/ibolt-stdio.mjs` (stdio transport, proxies to port 5001)

## System Architecture

### 4-Phase Blog Pipeline (`server/blogPipeline.ts`)
1. **Planner** → JSON outline with SEO meta, sections, keyword distribution
2. **Section Writer** → per-section markdown with brand voice + photo scoring
3. **Stitcher** → combines sections + image placements into cohesive markdown
4. **Verifier** → quality scores (brand, SEO, language, accuracy); retries if < 70

### Photo Bank (`server/photoBank.ts`, `server/photoSelector.ts`)
- Photos stored in `./uploads/product-photos/` with thumbnails in `./uploads/product-photos/thumbs/`
- GPT-4V analyzes: product identification, angle type, context, quality score, vertical relevance
- Deterministic photo scoring selects best images per section (no AI at selection time)
- Photos served at `/api/blog/photos/serve/{id}` — converted to production URL for Shopify

### Shopify Publishing (`server/shopifyPublisher.ts`)
- Client credentials auth (env: `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`)
- News Blog ID: `104843772196`, Fish Finder Blog ID: `110121517348`
- API version: 2025-01
- Publishes as draft by default, sets SEO metafields

### HTML Rendering (`server/htmlRenderer.ts`)
- Markdown → HTML with headings, lists, bold/italic, links, images
- Auto-links product mentions to iboltmounts.com
- Extracts FAQ sections into JSON-LD FAQPage schema
- Converts local `/api/blog/photos/serve/` URLs to `PUBLIC_BASE_URL` for Shopify

## MCP Server — 33 Tools (`mcp-server/ibolt-stdio.mjs`)

### Blog Posts
`list_blog_posts`, `get_blog_post`, `get_blog_post_html`, `update_blog_post`, `generate_blog_post`

### Keywords
`list_keywords`, `list_keyword_clusters`, `import_keywords`, `cluster_keywords`

### Industry Context (12 verticals)
`list_verticals`, `get_context_entries`, `add_context_entry`, `run_research`

### Products
`list_products`, `scrape_products`

### Queue
`get_queue`, `add_to_queue`, `add_batch_to_queue`

### Shopify
`publish_to_shopify`, `shopify_status`, `list_shopify_articles`

### Scheduler
`scheduler_status`, `start_scheduler`, `stop_scheduler`, `trigger_scheduler_action`

### Competitor
`analyze_competitor`

### Photo Bank
`list_photos`, `get_photo`, `photo_stats`, `import_photos`, `analyze_photo`, `batch_analyze_photos`, `auto_associate_photos`, `delete_photo`

## Key Files

| File | Purpose |
|------|---------|
| `server/blogPipeline.ts` | 4-phase generation orchestrator |
| `server/htmlRenderer.ts` | Markdown → Shopify HTML + FAQ schema |
| `server/shopifyPublisher.ts` | Shopify REST API publishing |
| `server/photoBank.ts` | Photo storage, import, GPT-4V analysis |
| `server/photoSelector.ts` | Deterministic photo scoring for posts |
| `server/photoRoutes.ts` | Photo API endpoints (11 routes) |
| `server/brandVoice.ts` | Brand voice constants for prompts |
| `server/keywordManager.ts` | CSV parsing, scoring, AI clustering |
| `server/iboltResearchAgent.ts` | Reddit/YouTube/web → context banks |
| `shared/schema.ts` | 31 Drizzle ORM tables |
| `mcp-server/ibolt-stdio.mjs` | MCP stdio server (33 tools) |

## Brand Voice (baked into all generation prompts)

- Conversational expertise — friendly but credible
- Education-first, sales-second — products are solutions to stated problems
- Industry terminology used naturally
- 800-1400 words per post
- No AI buzzwords: avoid "game-changer", "revolutionize", "seamless", "cutting-edge"
- Invitational CTAs: "explore our selection" not "buy now"

## 12 Industry Verticals

Fishing/Boating, Forklifts/Warehousing, Trucking/Fleet, Offroading/Jeep, Restaurants/Food Delivery, Education/Schools, Content Creation/Streaming, Agriculture/Farming, Kitchen/Home, Road Trips/Travel, Mountain Biking/Cycling, General Mounting Solutions

## Environment Variables

```
SHOPIFY_SHOP=iboltmounts
SHOPIFY_CLIENT_ID=...
SHOPIFY_CLIENT_SECRET=...
PUBLIC_BASE_URL=https://app.scholarmark.ai
OPENAI_API_KEY=... (for GPT-4V photo analysis)
ANTHROPIC_API_KEY=... (for blog generation)
```
