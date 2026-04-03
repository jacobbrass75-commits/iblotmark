# iBolt Blog Generator — Roadmap & Development Plan

Last updated: April 2, 2026

---

## Current State Summary

**Complete**: 4-phase blog pipeline, keyword system, 12 industry verticals, research agents, product scraper, photo bank, full UI (7 blog pages), HTML renderer, 24 generated posts, 19 Shopify drafts published.

**Not yet built**: Shopify auto-upload, MCP blog tools, Claude skill for non-technical users, competitor product database, inventory management, Shopify design templates.

---

## Phase 6: Shopify Auto-Upload Integration

**Goal**: One-click publish from the app directly to Shopify, no manual HTML copy-paste.

### What We Have
- Shopify API credentials configured (client credentials grant, 24h token expiry)
- Shop: `iboltmounts.myshopify.com`
- App: `iboltblog` with scopes: `read_content`, `write_content`, `read_products`, `write_products`, `read_online_store_pages`, `write_online_store_pages`
- Blog IDs: News (104843772196), Fish Finder (110121517348)
- `htmlRenderer.ts` already outputs Shopify-ready HTML with meta tags

### Build Plan

1. **Create `server/shopifyPublisher.ts`**
   - Token management: auto-request via client credentials grant (tokens expire every 24h)
   - `createArticle(blogId, article)` — POST to Shopify REST API
   - `updateArticle(articleId, article)` — PUT to update existing
   - `publishArticle(articleId)` — Set published=true
   - `getArticle(articleId)` — Fetch current state
   - Rate limiting: 40 req/min bucket, 1-second delays for bulk operations

2. **Add `shopify_article_id` column to `blog_posts` table**
   - Tracks which Shopify article corresponds to each generated post
   - Enables update-in-place instead of creating duplicates

3. **Add API routes**
   - `POST /api/blog/posts/:id/publish-shopify` — Create or update Shopify article
   - `POST /api/blog/posts/batch-publish-shopify` — Bulk publish approved posts
   - `GET /api/blog/posts/:id/shopify-status` — Check if synced

4. **Add UI**
   - "Publish to Shopify" button in PostReview.tsx
   - Status indicator showing Shopify sync state (not synced / draft / live)
   - Batch publish button in BlogDashboard.tsx for all approved posts

5. **Add Shopify design documentation to publisher**
   - Include Shopify theme CSS class references in HTML output
   - Ensure generated HTML uses consistent heading hierarchy, image sizing, and spacing that matches the iboltmounts.com theme
   - Add section templates (hero, product spotlight, FAQ) that match store design

---

## Phase 7: Competitor Product Database & Knowledge Base

**Goal**: Structured database of our products AND competitor products with photos, specs, and comparison data. Powers smarter blog generation.

### Build Plan

1. **New database tables**
   ```
   competitor_brands:       id, name, website, logo_url, description, strengths, weaknesses
   competitor_products:     id, brand_id, name, description, price, specs (JSON), image_urls (JSON), 
                           source_url, category, comparable_ibolt_product_id, comparison_notes
   product_knowledge_base:  id, product_id (ibolt), category (spec/feature/use_case/limitation/faq),
                           content, source, verified, created_at
   ```

2. **Competitor scraping system**
   - Extend `competitorScraper.ts` to extract structured product data
   - Support scraping: RAM Mounts, Arkon, Heckler Design product pages
   - AI extraction: product name, price, specs, images, key features
   - Store comparison notes linking to equivalent iBolt products

3. **iBolt product knowledge base**
   - Deep product profiles beyond basic Shopify data
   - Spec sheets, installation guides, compatibility info, customer FAQs
   - Photo gallery per product (hero, angles, installed, lifestyle)
   - Link to catalog PDF extractions for detailed specs

4. **Integration with blog pipeline**
   - Planner phase gets competitor context for comparison posts
   - Section Writer can reference specific competitor weaknesses
   - Verifier checks competitor claims for accuracy
   - Auto-generate comparison tables in blog posts

5. **UI pages**
   - `/blog/competitors` — Competitor brand list, product browser
   - `/blog/knowledge` — Product knowledge base editor
   - Product detail pages with photos, specs, competitor mapping

---

## Phase 8: MCP Blog Tools + Claude Skill (Non-Technical User Workflow)

**Goal**: A non-technical team member (e.g., marketing person) can open Claude, connect to the iBolt MCP server, and one-shot blog posts by describing what they want. Posts auto-upload to Shopify as drafts.

### Architecture

```
User (Claude Desktop/Web)
    ↓ natural language request
Claude + MCP Tools
    ↓ tool calls
iBolt MCP Server (port 5002)
    ↓ HTTP requests
iBolt App Server (port 5001)
    ↓ 
Blog Pipeline → Shopify Auto-Upload
```

### MCP Tools to Add

| Tool | Purpose | Example Usage |
|------|---------|---------------|
| `generate_blog_post` | Generate a post from a topic/keyword | "Write a post about forklift tablet mounts" |
| `list_keyword_clusters` | Browse available keyword clusters | "What topics haven't been covered yet?" |
| `generate_from_cluster` | Generate from a specific cluster | "Generate post for cluster #12" |
| `list_blog_posts` | Browse generated posts | "Show me all draft posts" |
| `get_blog_post` | Read a specific post | "Show me the forklift post" |
| `edit_blog_post` | Update post content | "Change the intro paragraph to..." |
| `publish_to_shopify` | Push to Shopify as draft | "Publish this to the News blog" |
| `list_products` | Browse iBolt products | "What products do we have for restaurants?" |
| `get_product_details` | Deep product info | "Tell me about the Tablet Tower" |
| `list_verticals` | Browse industry contexts | "What verticals do we target?" |
| `research_topic` | Trigger research agents | "Research what truckers say about tablet mounts on Reddit" |
| `get_competitor_comparison` | Get comparison data | "How do we compare to RAM for forklift mounts?" |

### Claude Skill

Create a Claude skill (`.claude/skills/ibolt-blog/SKILL.md`) that:
- Connects to the MCP server
- Understands iBolt brand voice
- Knows the 12 verticals and product catalog
- Can guide non-technical users through the blog creation process
- Handles the full workflow: research → generate → review → publish

### User Experience (Non-Technical Person)

```
User: "I need a blog post about how restaurants use tablet mounts for POS systems"

Claude (with skill + MCP):
1. Checks existing keyword clusters for restaurant/POS topics
2. If no cluster exists, suggests relevant keywords
3. Pulls restaurant vertical context + relevant products (Tablet Tower, LockPro)
4. Generates post via blog pipeline
5. Shows preview to user
6. User says "looks good, publish it"
7. Pushes to Shopify as draft
8. Returns Shopify preview link
```

### Build Plan

1. **Extend MCP server** (`mcp-server/dist/mcp-tools.js`)
   - Add blog generation tools alongside existing ScholarMark tools
   - Authentication: same bearer token flow
   - Streaming: SSE for long-running generation

2. **Create blog-specific tool handlers**
   - New file: `mcp-server/dist/blog-tools.js`
   - Each tool maps to existing `/api/blog/*` endpoints
   - Add convenience wrappers (e.g., "generate from topic" does keyword lookup + cluster creation + generation)

3. **Create Claude skill**
   - Brand voice context in system prompt
   - Product catalog summary
   - Vertical descriptions
   - Example interactions
   - Error handling (what to do if generation fails)

4. **Add Shopify design context to skill**
   - CSS class reference for the iboltmounts.com theme
   - Image sizing guidelines
   - Section templates that match store design
   - Heading hierarchy rules
   - Mobile-responsive patterns

---

## Phase 9: Inventory & Stock Integration

**Goal**: Track product availability so blog posts don't promote out-of-stock items.

### Build Plan

1. **New table: `product_inventory`**
   - product_id, sku, quantity_available, restock_date, status (in_stock/low/out_of_stock)
   - Synced from Shopify inventory API

2. **Shopify inventory sync**
   - Use `read_inventory` scope (may need to add to app)
   - Periodic sync via scheduler
   - Track inventory levels per variant

3. **Pipeline integration**
   - Planner phase filters out products with quantity=0
   - Verifier flags posts promoting out-of-stock items
   - Auto-update posts when products go out of stock

4. **UI**: Inventory status indicators in ProductCatalog.tsx

---

## Phase 10: Shopify Design System Documentation

**Goal**: Ensure generated blog posts always look good on the live site by encoding the store's design patterns.

### Build Plan

1. **Create `server/shopifyDesignSystem.ts`**
   - HTML templates for common blog sections
   - Image sizing rules (max-width, aspect ratios)
   - Heading hierarchy (h2 for sections, h3 for subsections)
   - Product spotlight card template
   - FAQ accordion template
   - Comparison table template
   - Call-to-action button styles

2. **Update `htmlRenderer.ts`**
   - Use design system templates instead of raw HTML
   - Add Shopify theme CSS classes
   - Responsive image handling
   - Consistent spacing and typography

3. **Store design audit**
   - Scrape current iboltmounts.com blog styles
   - Document CSS classes, fonts, colors, spacing
   - Create visual reference (screenshots + CSS)

---

## Implementation Priority & Order

### Immediate (Phase 6) — Shopify Auto-Upload
**Why first**: Biggest time-saver. 24 posts already generated, manual upload is painful.
- 1-2 sessions to build
- Unblocks publishing workflow

### Next (Phase 8) — MCP Tools + Claude Skill
**Why second**: Enables the non-technical team member to create content independently.
- 2-3 sessions to build MCP tools
- 1 session for Claude skill
- Requires Phase 6 (Shopify upload) to be complete

### Then (Phase 7) — Competitor Database
**Why third**: Makes generated content significantly better with real comparison data.
- 2-3 sessions to build scraper + database
- 1 session for pipeline integration
- Can be incrementally populated

### Then (Phase 10) — Design System
**Why fourth**: Improves visual quality of all future posts.
- 1-2 sessions to audit + build templates
- Retrofit into existing htmlRenderer

### Later (Phase 9) — Inventory Integration
**Why last**: Lower urgency, depends on Shopify scope expansion.
- 1 session to build
- Requires Shopify app scope update

---

## Future Ideas (Backlog)

- **Content calendar**: Schedule posts by date, auto-publish on schedule
- **A/B testing**: Generate multiple versions, track performance
- **Analytics integration**: Pull Shopify blog analytics to measure post performance
- **Social media**: Auto-generate social posts (Twitter/Instagram/LinkedIn) from blog content
- **Email newsletter**: Auto-generate email digest from recent posts
- **Multi-language**: Generate posts in Spanish for expanding markets
- **Video content**: Generate video scripts from blog posts
- **Customer reviews**: Pull and integrate customer reviews into posts
- **Seasonal automation**: Auto-trigger research + generation based on seasonal relevance data in verticals
