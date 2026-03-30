# iBolt Blog Generator - Claude Code Instructions

## What This Repo Is

This is a fork of **ScholarMark**, an academic source annotator built with Express + React (Vite) + SQLite/Drizzle ORM. We are converting it into an **autonomous SEO blog post generator for iBolt Mounts** (iboltmounts.com).

The existing ScholarMark features (citations, annotations, OCR, academic writing) remain intact but are NOT being developed further. All new work adds the blog generation system alongside.

## Current State

- The repo is the **original ScholarMark codebase** — no iBolt blog features have been built yet
- The app runs locally on port 5001: `npm run dev`
- Auth uses Clerk (but for local dev, the existing setup works)
- The existing writing pipeline at `server/writingPipeline.ts` is the template to adapt

## What To Build

An autonomous blog post generator that:
1. Ingests keyword data from Ubersuggest CSV exports
2. Smart-clusters keywords and prioritizes by opportunity score
3. Pulls industry context from pre-built knowledge banks + web research (YouTube transcripts, Reddit, web)
4. Scrapes product catalog from iboltmounts.com (Shopify JSON API at `/products.json`)
5. Generates SEO-optimized blog posts using a 4-phase pipeline
6. Outputs Shopify-ready HTML with meta tags
7. Supports batch generation with human review

## Architecture: 4-Phase Blog Pipeline

Adapt from `server/writingPipeline.ts` (3-phase: Planner → Writer → Stitcher). Add a 4th phase:

1. **Planner** — Takes keyword cluster + industry context + products → JSON outline with SEO meta tags, sections, keyword distribution
2. **Section Writer** — Writes each section with iBolt brand voice baked directly into prompts (NO separate humanizer pass)
3. **Stitcher** — Combines sections, smooths transitions, ensures consistent voice + SEO keyword placement
4. **Verifier** (NEW) — Quality gate scoring: brandConsistency, seoOptimization, naturalLanguage, factualAccuracy (0-100). Re-runs stitcher if overall < 70

## iBolt Brand Voice (bake into ALL writing prompts)

From analysis of https://iboltmounts.com/blogs/news:
- **Conversational expertise** — friendly but credible, like a knowledgeable friend
- **Education-first, sales-second** — lead with helpful info, products are solutions to articulated problems
- **Industry terminology** — use naturally without over-explaining (ELD Mandate, AMPS plates, etc.)
- **Context-setting openings** — relatable scenarios that make readers feel understood
- **Specific tech specs** — model numbers, dimensions, materials, compatibility info
- **Multiple product options** — not pushy, present alternatives so readers feel informed
- **Invitational CTAs** — "explore our selection" not "buy now"
- **800-1400 words** per post
- No AI buzzwords: avoid "game-changer", "revolutionize", "seamless", "cutting-edge"

## 12 Industry Verticals (Context Banks)

Each needs a context bank with terminology, use cases, pain points, compatible devices, regulations, seasonal relevance:

1. Fishing/Boating
2. Forklifts/Warehousing
3. Trucking/Fleet
4. Offroading/Jeep
5. Restaurants/Food Delivery
6. Education/Schools
7. Content Creation/Streaming
8. Agriculture/Farming
9. Kitchen/Home
10. Road Trips/Travel
11. Mountain Biking/Cycling
12. General Mounting Solutions

## Database Tables Needed (add to `shared/schema.ts`)

- `industryVerticals` — 12 vertical categories
- `contextEntries` — industry knowledge bank entries (category, content, sourceType, confidence)
- `keywords` — from Ubersuggest CSV (keyword, volume, difficulty, CPC, opportunityScore, status)
- `keywordClusters` — groups of related keywords for comprehensive posts
- `keywordImports` — CSV upload batch tracking
- `products` — scraped from iboltmounts.com
- `productVerticals` — many-to-many product-to-vertical mapping
- `blogPosts` — generated posts (markdown, html, status, verification scores)
- `blogPostProducts` — products mentioned in posts
- `generationBatches` — batch job tracking
- `researchJobs` — research agent job tracking

## Server Modules To Create

| File | Purpose |
|---|---|
| `server/brandVoice.ts` | Brand voice constants and prompt builders |
| `server/contextBanks.ts` | Context bank CRUD + `formatContextForPrompt()` |
| `server/contextSeeds.ts` | Initial seed data for 12 verticals |
| `server/contextRoutes.ts` | Context bank API routes |
| `server/keywordManager.ts` | CSV parsing (papaparse), scoring, LLM clustering |
| `server/keywordRoutes.ts` | Keyword API routes |
| `server/productScraper.ts` | Fetch iboltmounts.com/products.json, parse, map to verticals |
| `server/productRoutes.ts` | Product API routes |
| `server/blogPipeline.ts` | 4-phase blog generation engine (adapt from writingPipeline.ts) |
| `server/blogRoutes.ts` | Blog generation API routes (SSE streaming) |
| `server/htmlRenderer.ts` | Markdown → Shopify-ready HTML with SEO meta |
| `server/iboltResearchAgent.ts` | YouTube/Reddit/web research → context bank population |

## Client Pages To Create

| Page | Route | Purpose |
|---|---|---|
| `BlogDashboard.tsx` | `/blog` | Overview, stats, recent posts, quick actions |
| `KeywordManager.tsx` | `/blog/keywords` | CSV upload, keyword table, cluster view, content calendar |
| `BatchGenerator.tsx` | `/blog/generate` | Select clusters, configure, generate with SSE progress |
| `PostReview.tsx` | `/blog/posts/:id` | Markdown editor + HTML preview, verification scores, export |
| `IndustryContext.tsx` | `/blog/context` | Context bank viewer/editor, research agent trigger |
| `ProductCatalog.tsx` | `/blog/products` | Product grid, vertical mapping, scrape trigger |

## Client Hooks To Create

- `useBlogPipeline.ts` — adapt from `client/src/hooks/useWriting.ts` (SSE streaming)
- `useKeywords.ts`, `useVerticals.ts`, `useProducts.ts`, `useBlogPosts.ts` — React Query CRUD hooks

## Autonomous Research Agent (`server/iboltResearchAgent.ts`)

Runs independently from blog generation. Populates context banks:

- **YouTube**: YouTube Data API v3 → `youtube-transcript` package → Claude extracts industry context
- **Reddit**: `reddit.com/r/{subreddit}/search.json` (public JSON API, no auth) → Claude extracts user language + pain points
- **Web**: Web fetch → Claude extracts industry context
- All findings stored as `contextEntries` with `isVerified: false` for human review

## Ruflo Integration

Clone https://github.com/ruvnet/ruflo.git and integrate its autonomous agent capabilities for:
- Automated research workflows
- Scheduled context bank population
- Autonomous batch generation orchestration

## Key Patterns To Follow (from existing codebase)

- **SSE streaming**: See `server/writingRoutes.ts` for the pattern
- **Drizzle ORM tables**: See `shared/schema.ts` for table definition patterns
- **React Query hooks**: See `client/src/hooks/useProjects.ts` for the pattern
- **Lazy page loading**: See `client/src/App.tsx` for route registration
- **AI calls**: Use Anthropic SDK (already configured in the project)

## Implementation Order

1. Schema + brand voice + context banks + seed data
2. Keyword manager + product scraper
3. Blog pipeline (4-phase) + HTML renderer + blog routes
4. Client UI (dashboard, keyword manager, batch generator, post review)
5. Research agent + context/product management UI
6. Ruflo integration for autonomous orchestration

## Dependencies To Add

```
npm install papaparse marked youtube-transcript cheerio
```

## Quick Verification

After each phase, verify:
- `npm run dev` still starts without errors
- New API endpoints respond (test with curl)
- New UI pages render at their routes
- Blog pipeline generates actual HTML output
