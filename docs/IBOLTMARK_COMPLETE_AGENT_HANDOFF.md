# iBOLTMark Complete Agent Handoff

> Share this document with an authorized iBOLT team member or their coding agent. It explains how to obtain the code, supply private access, locate the knowledge and media assets, run the application, and work with Shopify safely. Live secrets are intentionally not stored in this file.

## Mission

iBOLTMark is an autonomous SEO content and operations application for [iBOLT Mounts](https://iboltmounts.com). It began as a ScholarMark fork and now includes company onboarding, brand context, keyword ingestion and clustering, product catalog ingestion, industry research, a four-phase blog-writing pipeline, photo selection, Shopify-ready HTML, review, scheduling, AI-visibility benchmarking, and Shopify publishing.

The primary objective for an incoming agent is to preserve the existing iBOLT functionality, understand the company-specific data boundary, and make changes without publishing or modifying Shopify unless a human explicitly authorizes that action.

## Repository Access

| Item | Value |
| --- | --- |
| GitHub repository | `git@github.com:jacobbrass75-commits/iblotmark.git` |
| Current working branch | `codex/standalone-blog-product` |
| Original handoff snapshot | `af9fb6d` (`Add service ops inventory and SEO outputs`); run `git log -1` for the current checkpoint |
| Local project path used by the owner | `/Users/yakub/Desktop/iblotmark` |
| Development URL | `http://127.0.0.1:5001` |
| Production URL documented in the repository | `https://app.scholarmark.ai` |

The GitHub repository is public as of 2026-09-02. Reading/cloning it does not grant access to private application data or integrations. Write access still requires the owner's permission. SSH access requires a configured GitHub account and SSH key; public HTTPS cloning is also available.

```bash
git clone git@github.com:jacobbrass75-commits/iblotmark.git
cd iblotmark
git switch codex/standalone-blog-product
```

### Git does not currently contain every local asset

At the time this handoff was prepared, the local working tree had modified files and numerous untracked output, research, script, and transfer folders. A fresh clone only receives committed files. In particular:

- `.env` is ignored and must be transferred securely.
- `data/` is ignored and contains the working SQLite databases.
- `uploads/` is ignored and is the intended home of the photo bank.
- Several recent `content-output/`, `outputs/`, `research/`, `scripts/`, `tmp/`, and `transfer/` items were untracked.
- `iboltmark.db` in Git is an empty placeholder; it is not the working application database.

The 2026-09-02 source checkpoint includes the inventory workflow, read-only Shopify inventory synchronization, and current application/scripts. Private outputs, media inventories, and working data remain excluded. Local SQLite backups are kept outside the repository under `~/Documents/iBoltMark Backups/`; use a consistent SQLite backup rather than copying an open database file. The product-weight workbook must also be transferred privately if needed for reimport.

Before handing the project to another person, provide an approved private transfer of the required database, media, and source documents. Do not assume that GitHub alone reproduces the owner's current machine. See `ARCHITECTURE.md` for the inventory schema and runtime configuration. Never run publishing or paid-generation scripts merely to restore a checkpoint.

## Private Access Package

Do not paste these values into Git, tickets, chat logs, or this Markdown file. Transfer them through the company's password manager or an expiring encrypted secret link. The recipient should create a local `.env` from `.env.example` and insert the authorized values.

The current local environment uses these secret/configuration names:

```text
ANTHROPIC_API_KEY
SHOPIFY_SHOP
SHOPIFY_CLIENT_ID
SHOPIFY_CLIENT_SECRET
SHOPIFY_ACCESS_TOKEN
OPENROUTER_API_KEY
AI_BENCHMARK_FORCE_OPENROUTER
AI_BENCHMARK_OPENROUTER_CHATGPT_MODEL
AI_BENCHMARK_OPENROUTER_CLAUDE_MODEL
AI_BENCHMARK_OPENROUTER_GEMINI_MODEL
GEMINI_API_KEY
GOOGLE_AI_API_KEY
```

The standalone application may additionally require the following, depending on environment and authentication mode:

```text
APP_BASE_URL
PUBLIC_BASE_URL
DATABASE_PATH
JWT_SECRET
INTEGRATION_ENCRYPTION_KEY
PUBLIC_ASSET_SIGNING_SECRET
CLERK_SECRET_KEY
CLERK_PUBLISHABLE_KEY
VITE_CLERK_PUBLISHABLE_KEY
OPENAI_API_KEY
DEFAULT_COMPANY_ID
BLOG_QUALITY_GATE
SHOPIFY_API_VERSION
SHOPIFY_OAUTH_SCOPES
SHOPIFY_BLOG_HANDLES
```

Use `.env.example` as the authoritative configuration template. Production secrets should be unique, at least 32 characters where applicable, and different from development values. Prefer the per-company encrypted Shopify OAuth integration in the application over sharing a permanent Admin API token.

### Access the owner must explicitly grant

- GitHub access to `jacobbrass75-commits/iblotmark`.
- Shopify Partner/app access and the correct iBOLT store role.
- Clerk access if the recipient will manage authentication or production users.
- Anthropic, OpenAI, Gemini/Google AI, and OpenRouter access as required by the enabled workflows.
- Production server/PM2 access if deployment or production logs are in scope.
- A secure copy of the working SQLite database if existing local records are required.
- A secure copy of original photo assets if they are not already in Shopify or committed output folders.

Possession of this file does not itself grant any of those permissions.

## First-Time Setup

Prerequisites: Node.js 20 or newer, npm, Git, and a writable local directory.

```bash
cp .env.example .env
npm run setup
npm run dev
```

Verify liveness:

```bash
curl -fsS http://127.0.0.1:5001/api/blog/health
```

The response should include `"ok": true` and `"product": "standalone-blog-writer"`. This proves the web process is alive; it does not prove that the database, AI providers, authentication, photos, or Shopify connection work.

Run repository checks before deployment or a major handoff:

```bash
npm run check
npm run build
npm run preflight:standalone
npm run smoke:onboarding
```

## System Map

| Capability | Main locations |
| --- | --- |
| App and API startup | `server/index.ts`, `server/routes.ts` |
| Database schema | `shared/schema.ts` |
| Company/tenant context | `server/companyContext.ts`, `server/companyRoutes.ts`, `server/companyDefaults.ts` |
| Brand voice and prompts | `server/brandVoice.ts` |
| Four-phase generation | `server/blogPipeline.ts`, `server/blogRoutes.ts` |
| Shopify HTML | `server/htmlRenderer.ts` |
| Shopify connection/publishing | `server/shopifyRoutes.ts`, `server/shopifyPublisher.ts` |
| Keyword import/clustering | `server/keywordManager.ts`, `server/keywordRoutes.ts` |
| Knowledge/context banks | `server/contextBanks.ts`, `server/contextSeeds.ts`, `server/contextEnrichmentSeeds.ts`, `server/contextRoutes.ts` |
| Research | `server/researchAgent.ts`, `server/researchCoverage.ts` |
| Products and catalogs | `server/productScraper.ts`, `server/productImporter.ts`, `server/productRoutes.ts`, `server/catalogImporter.ts`, `server/catalogRoutes.ts` |
| Photo bank | `server/photoBank.ts`, `server/photoSelector.ts`, `server/photoRoutes.ts`, `server/publicPhotoRoutes.ts` |
| Scheduling and queue | `server/scheduler.ts`, `server/schedulerRoutes.ts`, `server/schedulerJobStore.ts` |
| AI-visibility benchmark | `server/benchmarkRoutes.ts`, `server/benchmarkSeeds.ts` |
| Browser application | `client/src/App.tsx`, `client/src/pages/`, `client/src/hooks/` |
| Local iBOLT MCP server | `mcp-server/ibolt-stdio.mjs` |
| Legacy remote MCP server | `mcp-server/server.mjs` |

## Four-Phase Blog Pipeline

1. **Planner** creates a structured outline, SEO metadata, section plan, and keyword distribution.
2. **Section Writer** writes each section using the iBOLT brand voice and available company, industry, product, and photo context.
3. **Stitcher** combines the sections, improves transitions, maintains voice, and places images/internal links.
4. **Verifier** scores brand consistency, SEO optimization, natural language, and factual accuracy. The quality threshold is controlled by `BLOG_QUALITY_GATE` and defaults to 80 in the current documentation.

The pipeline records model/provider metadata, runs a deterministic content linter, supports provider fallback, adds safe internal links, and avoids accepting refresh/restitch results that reduce quality.

## iBOLT Brand Knowledge

The generation prompts encode these core rules:

- Conversational expertise: friendly, credible, and practical.
- Education first and selling second.
- Industry terminology used naturally.
- Relatable, context-setting openings.
- Specific model numbers, dimensions, materials, compatibility, and technical details when verified.
- Multiple relevant product options rather than a forced single recommendation.
- Invitational calls to action such as “explore our selection.”
- Typical target length of 800–1,400 words.
- Avoid generic AI language including “game-changer,” “revolutionize,” “seamless,” and “cutting-edge.”

The seeded verticals are Fishing/Boating, Forklifts/Warehousing, Trucking/Fleet, Offroading/Jeep, Restaurants/Food Delivery, Education/Schools, Content Creation/Streaming, Agriculture/Farming, Kitchen/Home, Road Trips/Travel, Mountain Biking/Cycling, and General Mounting Solutions. The current standalone architecture also supports company-configurable verticals.

### Where knowledge is stored

Knowledge is not a single folder. It is distributed across:

- Seed definitions in `server/contextSeeds.ts`, `server/contextEnrichmentSeeds.ts`, and related seed files.
- Company and brand records in SQLite.
- `industry_verticals` and `context_entries` database tables.
- Research records and coverage metadata in SQLite.
- Local research artifacts under `research/`.
- Brand and system instructions in `AGENTS.md`, `CLAUDE.md`, `CODEBASE.md`, `ARCHITECTURE.md`, and `CURRENT-STATE.md`.
- Generated and reviewed content under `content-output/` and `outputs/`.

Important database tables include `companies`, `brand_profiles`, `company_integrations`, `industry_verticals`, `context_entries`, `keyword_imports`, `keyword_clusters`, `keywords`, `ibolt_products`, `product_verticals`, `generation_batches`, `blog_posts`, `blog_post_products`, `research_jobs`, and `product_photos`.

## Photos and Media

The intended photo-bank storage location is:

```text
uploads/product-photos/
uploads/product-photos/thumbs/
```

This directory is ignored by Git. In the inspected checkout it contained no files, so an incoming agent will need a private photo archive, a fresh import, or Shopify-hosted image URLs. Do not claim that the Git repository contains the original photo bank.

Other image and presentation artifacts currently exist under locations such as:

```text
content-output/**/assets/
content-output/**/images/
content-output/**/source-images/
content-output/**/photo-bank-review/
outputs/**/*.{png,jpg,jpeg,webp,pptx}
tmp/
transfer/
```

Some of those paths are untracked and may not appear in a clone.

The photo workflow supports import, AI vision analysis, product association, quality/angle/vertical metadata, deterministic section selection, and serving through `/api/blog/photos/serve/{id}`. Shopify rendering converts local photo routes to the configured public base URL.

## Shopify Integration

The current application supports Shopify OAuth, encrypted per-company integration configuration, product access, blog discovery, draft publishing, synchronization, status checks, and SEO metafields.

Relevant settings include:

```text
SHOPIFY_SHOP
SHOPIFY_CLIENT_ID
SHOPIFY_CLIENT_SECRET
SHOPIFY_API_VERSION=2026-04
SHOPIFY_OAUTH_SCOPES=read_products,read_content,write_content
SHOPIFY_BLOG_HANDLES={"104843772196":"news"}
```

Known blog IDs documented in the codebase:

- News: `104843772196`
- Fish Finder: `110121517348`

Publishing route:

```text
POST /api/blog/shopify/posts/:id/publish
```

Publishing is a consequential external action. Unless the user explicitly asks for a live publish, generate/review locally and leave the Shopify article as a draft. Never expose access tokens in logs or generated content.

## Application Routes

The browser application includes routes/pages for the blog dashboard, keywords, batch generation, post review, industry context, products, photo bank, catalog imports, AI benchmarks, setup, service operations, and inventory.

The REST API is organized under these route families:

```text
/api/blog/company
/api/blog/posts
/api/blog/generate
/api/blog/keywords
/api/blog/context
/api/blog/research
/api/blog/products
/api/blog/catalog
/api/blog/queue
/api/blog/shopify
/api/blog/scheduler
/api/blog/benchmark
/api/blog/competitor
/api/blog/photos
```

Except for the health endpoint and signed/public photo surfaces, blog routes require valid authentication, company selection, membership, and sufficient role permissions.

## Agent/MCP Access

The local iBOLT MCP entrypoint is:

```bash
cd mcp-server
npm install
cd ..
IBOLT_BACKEND_URL=http://127.0.0.1:5001 node mcp-server/ibolt-stdio.mjs
```

It exposes tools for posts, keywords, industry context, research, benchmarking, products, queues, Shopify, scheduling, competitors, and photos. The backend application must already be running on port 5001.

The local stdio MCP currently has authentication limitations in secure standalone mode. The separate remote HTTP MCP currently exposes legacy ScholarMark tools rather than the complete iBOLT toolset. Read `docs/IBOLT_MARK_API_MCP_HANDOFF.md` before promising remote ChatGPT/Claude access or production MCP support.

## Recommended Agent Operating Brief

The following block can be pasted into the incoming agent's task after the repository and private credentials have been made available:

```text
<role>
You are working on iBOLTMark, the iBOLT Mounts autonomous SEO content and operations application.
</role>

<authoritative_context>
Read AGENTS.md first and follow it. Then read docs/IBOLTMARK_COMPLETE_AGENT_HANDOFF.md, CLAUDE.md, docs/STANDALONE_PRODUCTION.md, and docs/IBOLT_MARK_API_MCP_HANDOFF.md. Inspect the current branch and working tree before changing files. Treat checked-in code as more authoritative than roadmap prose when they conflict.
</authoritative_context>

<data_boundaries>
Keep every company-scoped record isolated by companyId. Never print, commit, or copy secrets. Do not assume ignored databases, uploads, or untracked output folders are included in Git. Do not modify production or Shopify unless explicitly authorized for that exact action.
</data_boundaries>

<quality_bar>
Preserve iBOLT's education-first brand voice, verified product specifications, deterministic linting, verification scoring, internal-link safety, and human review. Run proportionate type checks, tests, builds, and smoke checks for every implementation change.
</quality_bar>
```

## Safe Handoff Checklist

- [ ] Grant the recipient GitHub repository access.
- [ ] Commit/push the intended code and non-sensitive assets, or clearly identify what remains local.
- [ ] Transfer `.env` values through an approved secret manager, not Git or chat.
- [ ] Transfer the required SQLite database through encrypted storage if historical records are needed.
- [ ] Transfer original photos separately or confirm that Shopify CDN images are sufficient.
- [ ] Confirm the recipient's Shopify role and whether they may create drafts, publish, edit, or only inspect.
- [ ] Confirm access to Clerk and each AI provider.
- [ ] Run the local health, type-check, build, preflight, and onboarding smoke checks.
- [ ] Verify the selected company and role before any write operation.
- [ ] Test Shopify with a draft-only workflow before considering live publication.
- [ ] Rotate any credential that was ever pasted into an insecure channel.

## Authoritative Follow-Up Documents

- `AGENTS.md` — repository rules and product requirements.
- `CLAUDE.md` — current application architecture and local MCP tool summary.
- `.env.example` — supported environment-variable template.
- `docs/STANDALONE_PRODUCTION.md` — production configuration and deployment checks.
- `docs/IBOLT_MARK_API_MCP_HANDOFF.md` — verified API/MCP behavior, authentication, and known limitations.
- `ARCHITECTURE.md`, `CODEBASE.md`, `CODEBASE_REFERENCE.md`, and `CURRENT-STATE.md` — broader codebase orientation.
- `iboltmark.md` — compact local MCP workflow cheat sheet; verify its tool count and routes against current code before relying on it.

## Handoff Owner Notes

Before sharing, add the recipient's name, the date, and the approved permission level below. Do not add passwords or tokens.

```text
Recipient:
Handoff date:
Approved GitHub role:
Approved Shopify role:
Production server access: yes/no
May create Shopify drafts: yes/no
May publish live: yes/no
Data/archive package location:
Secret-manager item or collection name:
```
