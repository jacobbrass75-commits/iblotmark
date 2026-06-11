# Codex Implementation Brief — iBoltMark Quality + Research Upgrade

This is a complete, ordered work plan. Execute the tasks in order (T1 → T9). Each task has exact file targets, implementation requirements, and acceptance criteria. Commit after each task with a message like `T3: grounded verifier with product catalog facts`.

## GOAL & COMPLETION LOOP (read this first)

**Definition of done:** `node scripts/verify-plan.mjs` exits with code 0.

The verifier mechanically checks all 56 completion criteria for tasks T1–T9 plus the TypeScript build and the new test suites. Run it in a loop until completion:

1. Run `node scripts/verify-plan.mjs --static` (fast mode, skips build/tests).
2. Find the first task with failing checks. Open that task's section in this document and implement it **fully as specified** — the checks are heuristics; the plan text is the real spec. Passing a check without doing what the task says is a failure.
3. Commit (`T<n>: <summary>`).
4. Go to step 1. When all static checks pass, run the full `node scripts/verify-plan.mjs` (no flag) — this also runs `npm run check` and the new vitest suites. Fix anything it reports.
5. You are done only when the full run prints `PLAN COMPLETE` and exits 0.

**Hard rules for the loop:**
- **Never modify `scripts/verify-plan.mjs`**, never delete or weaken tests, never stub a function just to satisfy a grep check. If a check appears wrong or impossible, implement what the task section says and note the discrepancy in the commit message.
- If `npm install` is needed (fresh clone, new deps like `marked`/`papaparse`), run it.
- Pre-existing test failures outside the five new test files are not your problem; do not chase them.

## Mission

Upgrade the blog engine in three ways:

1. **Research coverage** — the company has expanded into new product categories. The research system must stop relying on a hardcoded 12-vertical subreddit map, store research sources per vertical in the database, prioritize stale/thin verticals, and make it easy to spin up new verticals (with research sources) on demand.
2. **Content quality** — replace "LLM grades its own homework" with a deterministic linter + a verifier grounded in real product data, and fix known pipeline bugs.
3. **SEO/GEO output** — internal links between posts, full structured data (Article/Breadcrumb/ItemList), and proper table rendering.

## Ground rules

- **Do not touch ScholarMark-side code**: `server/chatRoutes.ts`, `server/projectRoutes.ts`, `server/routes.ts`, `server/ocrProcessor.ts`, `server/ocrQueue.ts`, `server/citationGenerator.ts`, `server/writingPipeline.ts`, `server/pipelineV2.ts`, `server/openai.ts`, `server/humanizer*.ts`, `server/webClipRoutes.ts`, `server/extensionRoutes.ts`, `server/oauthRoutes.ts`, anything under `client/src` that isn't a blog page. The blog engine lives in: `blogPipeline.ts`, `brandVoice.ts`, `keywordManager.ts`, `iboltResearchAgent.ts`, `verticalCreator.ts`, `scheduler.ts`, `htmlRenderer.ts`, `shopifyPublisher.ts`, `photoBank.ts`, `photoSelector.ts`, `aiBenchmark.ts`, `contextChunker.ts`, `contextBanks.ts`, plus `blogRoutes.ts`, `benchmarkRoutes.ts`, `schedulerRoutes.ts`, `contextRoutes.ts`, `keywordRoutes.ts`, `productRoutes.ts`, `shopifyRoutes.ts`, `photoRoutes.ts`, `shared/schema.ts`, and `mcp-server/ibolt-stdio.mjs`.
- **Type check must pass** after every task: `npm run check`.
- **New tests must pass**: `npx vitest run tests/<new-file>`. Some pre-existing tests may fail for unrelated reasons; do not break tests that currently pass, but you are not required to fix ones that already fail.
- **No live API calls in tests.** You may not have `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` at runtime. All new tests must be pure-function tests or use mocks.
- **Schema changes**: add columns in `shared/schema.ts` AND add idempotent `ALTER TABLE ... ADD COLUMN` guards following the existing pattern used for support tables in `server/db.ts` (search for how columns/tables are ensured at boot; replicate that pattern so production SQLite upgrades in place without `drizzle-kit push`).
- **Keep all existing MCP tool names and route paths stable.** Only add.
- When a task says "expose as MCP tool", add it to `mcp-server/ibolt-stdio.mjs` following the existing `server.tool(...)` pattern (proxy to the HTTP API on port 5001), and update the tool list in `CLAUDE.md`.

---

## T1 — Pipeline bug fixes (small, do first)

**File: `server/blogPipeline.ts`**

1. **Temperature is silently ignored on Anthropic.** `generateText()` accepts `temperature` but only passes it to the OpenAI fallback. Add `temperature` to the `anthropic.messages.create({...})` call.
2. **Remove the fishing bias.** In `getClusterData()`, the fallback product scorer contains:
   ```ts
   if (/fish|marine|boat|kayak|garmin|humminbird|lowrance/i.test(haystack)) score += 6;
   ```
   Delete this line. It skews product selection toward fishing gear for every cluster that lacks vertical mappings (restaurant posts, forklift posts, all of them). Keyword-token overlap scoring alone is correct.
3. **Record which provider/model generated each post.** Add two columns to `blog_posts` in `shared/schema.ts`: `generationProvider: text("generation_provider")` and `generationModel: text("generation_model")`. Refactor `generateText()` to also report `{ provider: "anthropic" | "openai", model: string }` (e.g., return an object, or accept a recorder callback — your choice, keep it simple). Track per-run: if ANY phase fell back to OpenAI, store `generationProvider = "mixed"` and log a warning line via the SSE `status` event (`message: "WARNING: provider fallback occurred during <phase>"`). Persist provider/model in the `db.insert(blogPosts)` call.
4. **Keep the better version after re-stitch.** In `runBlogPipeline()`, the re-stitch-with-feedback block re-verifies but keeps the new markdown unconditionally. Snapshot `markdown` and `verification` before re-stitching; after re-verification, if `newVerification.overallScore < originalVerification.overallScore`, revert to the original markdown and verification, and emit a status event saying the revision was discarded.

**Acceptance:** `npm run check` passes; `blog_posts` has the two new columns with boot-time ALTER guards; re-stitch logic provably keeps the higher-scoring draft (add a small unit test for the comparison helper if you extract one).

---

## T2 — Deterministic content linter

**New file: `server/contentLinter.ts`**

Export:

```ts
export interface LintIssue { rule: string; severity: "error" | "warning"; message: string; excerpt?: string; }
export interface LintReport { errors: LintIssue[]; warnings: LintIssue[]; passed: boolean; } // passed = zero errors
export function lintContent(input: {
  markdown: string;
  title?: string;
  metaTitle?: string;
  metaDescription?: string;
  primaryKeyword?: string;
  products: Array<{ title: string; handle: string; price: number | null }>;
}): LintReport;
```

Rules (import `BRAND_VOICE` from `server/brandVoice.ts` — single source of truth, do NOT copy the lists):

| Rule | Severity | Check |
|---|---|---|
| `banned-phrase` | error | Any of `BRAND_VOICE.bannedPhrases` present (case-insensitive, word-boundary match) |
| `dash` | error | Any em dash `—` or en dash `–` in the markdown |
| `word-count` | error | Word count outside `BRAND_VOICE.targetWordCount` min/max ±10% |
| `meta-title-length` | error | metaTitle missing or > 60 chars |
| `meta-description-length` | error | metaDescription missing or > 155 chars |
| `keyword-in-title` | error | primaryKeyword (case-insensitive) absent from title |
| `keyword-in-meta` | warning | primaryKeyword absent from metaTitle or metaDescription |
| `h1-in-body` | error | Markdown contains an `# ` H1 (Shopify renders the title as H1; body must start at H2) |
| `min-sections` | warning | Fewer than 3 `## ` H2 headings |
| `dead-product-link` | error | Any link to `iboltmounts.com/products/<handle>` where `<handle>` is not in the provided products list |
| `price-mismatch` | warning | Any `$NN.NN` figure within 120 chars of a known product title that doesn't match that product's catalog price |
| `missing-alt` | error | Any `<img` tag without a non-empty `alt` attribute |
| `faq-section` | warning | No `## Frequently Asked Questions` section, or fewer than 3 `**Q:` entries within it |
| `brand-casing` | error | `ibolt` or `Ibolt` or `IBOLT` appearing as a standalone word in prose (correct form is `iBOLT`; ignore URLs/handles/code) |

**Integrate into the pipeline** (`server/blogPipeline.ts`): after the stitcher produces markdown (and after `injectProductImages`), run `lintContent`. If there are errors, do ONE corrective LLM pass: call `generateText` with the stitcher system prompt and a user prompt listing each lint error with its excerpt, instructing it to fix exactly those problems without otherwise rewriting. Re-lint. Persist the final `LintReport` inside `verificationNotes` JSON (add a `lint` key alongside `issues`/`suggestions`). A post may only get `status: "review"` if `lint.passed === true` AND the verifier gate passes; otherwise `status: "draft"`. Emit SSE status events for lint results (`phase: "linter"`).

**Expose it:**
- Route: `POST /api/blog/lint` in `server/blogRoutes.ts` — body `{ markdown, title?, metaTitle?, metaDescription?, primaryKeyword? }`; loads products from DB; returns the `LintReport`.
- MCP tool: `lint_content` in `mcp-server/ibolt-stdio.mjs` proxying that route. Description: "Run the deterministic brand/SEO linter on blog markdown. Returns errors and warnings. Use before publishing anything."

**Test: `tests/contentLinter.test.ts`** — fixtures covering: a clean post (passes), a post with a banned phrase + em dash + H1 + dead link (each rule fires), brand-casing detection that does NOT fire on URLs like `iboltmounts.com`, word-count bounds.

**Acceptance:** all linter tests pass; pipeline integration compiles; lint report visible in `verificationNotes`.

---

## T3 — Ground the verifier in real product data

**Files: `server/brandVoice.ts`, `server/blogPipeline.ts`**

1. Change `buildVerifierPrompt()` to accept a `productFacts: string` parameter and include a new section:
   ```
   ### Product Catalog Facts (ground truth — verify all product claims against this)
   <productFacts>
   Any product name, price, spec, or URL in the post that contradicts or does not appear in this catalog must be listed in "issues" with the exact incorrect claim.
   ```
2. In `runVerifier()` (blogPipeline), build `productFacts` from `relevantProducts`: one line per product — `title | handle | $price | productType | url`. Cap at ~30 products / 4000 chars. Pass `relevantProducts` into `runVerifier` from the main pipeline (it currently only gets `plan` and `markdown`).
3. Raise the quality gate: replace the hardcoded `>= 70` with `const QUALITY_GATE = Number(process.env.BLOG_QUALITY_GATE || 80);` used in both `runVerifier` and anywhere else 70 appears.

**Acceptance:** `npm run check` passes; verifier prompt contains catalog facts; gate is env-overridable and defaults to 80.

---

## T4 — Research system expansion (HIGH PRIORITY — new categories)

The company now operates in categories beyond the original 12 verticals. The research system must scale to any vertical without code edits.

### 4a. Per-vertical research sources in the DB

**Schema (`shared/schema.ts`, table `industry_verticals`)** — add columns (with boot-time ALTER guards per ground rules):
- `researchSubreddits: text("research_subreddits", { mode: "json" })` — string array
- `researchYoutubeQueries: text("research_youtube_queries", { mode: "json" })` — string array
- `researchWebQueries: text("research_web_queries", { mode: "json" })` — string array
- `lastResearchedAt: integer("last_researched_at", { mode: "timestamp" })`

**Seed migration:** on boot (in `server/db.ts` or a one-time seed function), for each existing vertical whose `researchSubreddits` is null/empty, populate it from the current `REDDIT_SUBREDDITS` map in `server/iboltResearchAgent.ts` (match by slug). Leave the constant in place only as this seed source; the runtime must read from the DB.

### 4b. Auto-discovery of research sources

**File: `server/iboltResearchAgent.ts`**

When research runs for a vertical with empty `researchSubreddits` (a newly created category), call Claude once to propose sources, then persist them on the vertical row before proceeding:

```
Prompt: For the industry vertical "<name>" (<description>), propose research sources for discovering how real customers talk about device/equipment mounting needs. Return JSON: { "subreddits": ["5-8 real, active subreddit names without r/"], "youtubeQueries": ["4-6 search queries"], "webQueries": ["4-6 search queries"] }
```

Validate subreddit names (`/^[A-Za-z0-9_]{2,21}$/`). Use model `claude-sonnet-4-20250514` (same as the rest of the file).

**File: `server/verticalCreator.ts`** — extend the JSON schema in `createVerticalFromDescription` to also request `"researchSubreddits"`, `"researchYoutubeQueries"`, `"researchWebQueries"` and store them on the new vertical row. New verticals must be born research-ready.

### 4c. Staleness-prioritized scheduling

**File: `server/scheduler.ts`**

- Add config fields: `maxVerticalsPerResearchRun: number` (default 4) and change the default `researchSources` from `["reddit"]` to `["reddit", "youtube", "web"]`.
- Change `runResearch()`: instead of researching everything, select the `maxVerticalsPerResearchRun` verticals that are most in need, ranked by: (1) zero non-seed context entries first, (2) oldest `lastResearchedAt` (null = oldest), (3) fewest total context entries. Pass the selected vertical IDs into `ResearchOrchestrator` (check its options in `iboltResearchAgent.ts`; add a `verticalIds` filter option if it doesn't have one). After each vertical's agents complete, set its `lastResearchedAt = new Date()`.
- Reduce default `researchIntervalMs` from 24h to **6h** (with staleness rotation, each cycle only touches the thinnest 4 verticals, so this is safe for rate limits — the existing `redditLimiter`/`youtubeLimiter`/`anthropicLimiter` in `apiCache.ts` still apply).

### 4d. Coverage visibility + new-category detection

**New function in `server/iboltResearchAgent.ts` (or a new `server/researchCoverage.ts`):**

```ts
export async function getResearchCoverage(): Promise<Array<{
  verticalId: string; name: string; slug: string;
  totalEntries: number; entriesByCategory: Record<string, number>;
  seedOnlyEntries: boolean; lastResearchedAt: Date | null;
  staleness: "fresh" | "aging" | "stale" | "never"; // fresh < 7d, aging < 30d, stale >= 30d
  hasResearchSources: boolean;
}>>;
```

**New function `suggestMissingVerticals()` in `server/verticalCreator.ts`:** gather (a) keyword clusters mapped to the `general-mounting` vertical or with null vertical, and (b) `ai_benchmark_queries` with null `verticalId`; send the list to Claude asking whether any represent product categories not covered by the existing verticals; return `Array<{ suggestedName, suggestedSlug, rationale, evidence: string[] }>`. Do NOT auto-create — suggestions only.

**Routes (`server/contextRoutes.ts` or `blogRoutes.ts`):**
- `GET /api/blog/research/coverage` → `getResearchCoverage()`
- `POST /api/blog/verticals/suggest` → `suggestMissingVerticals()`
- `POST /api/blog/verticals/create` → `createVerticalFromDescription(body.description)` (check whether a create route already exists in `contextRoutes.ts`; if so, reuse it for the MCP tool)

**MCP tools (`mcp-server/ibolt-stdio.mjs`):**
- `get_research_coverage` — "Show research coverage per industry vertical: entry counts, staleness, missing research sources. Use to decide where to run research."
- `suggest_verticals` — "Analyze unmapped keywords and benchmark queries to detect new product categories that need a vertical."
- `create_vertical` — "Create a complete new industry vertical (terminology, pain points, use cases, research sources) from a short description. Use when entering a new product category." Input: `{ description: string }`.

**Test: `tests/researchCoverage.test.ts`** — staleness bucketing logic (pure function: extract the date→staleness mapping into an exported helper).

**Acceptance:** new verticals created via `create_vertical` come with research sources; scheduler research targets thin/stale verticals first and stamps `lastResearchedAt`; coverage is queryable via HTTP and MCP.

---

## T5 — Internal linking

**New file: `server/internalLinker.ts`**

```ts
export async function addInternalLinks(postId: string): Promise<{ added: number; markdown: string }>;
```

1. **Candidate selection (deterministic):** load all other posts with status `review|approved|published`. Score each candidate: +3 same `verticalId`, +1 per shared keyword between the two posts' clusters (load via `clusterId` → `keywords`), +1 if candidate title shares a non-stopword token with the post's primary keyword. Take the top 3 with score ≥ 2.
2. **Build target URLs:** `https://iboltmounts.com/blogs/<blogHandle>/<slug>`. Resolve `blogHandle` from `shopifyBlogId` via env `SHOPIFY_BLOG_HANDLES` (JSON, default `{"104843772196":"news","110121517348":"fish-finder-mounts"}`); fall back to `news`.
3. **LLM insertion pass:** one `generateText` call — give it the post markdown and the candidates (title, URL, primary keyword, first 150 chars), instruct: "Insert 2-4 contextual internal links to these related articles at natural anchor phrases. Do not add new sentences solely for linking unless necessary; never change any other text; return the complete markdown."
4. **Safety validation (mandatory):** strip all markdown link syntax from both versions (`[text](url)` → `text`), normalize whitespace, and compare. If the non-link text changed, **discard the LLM output** and return the original markdown with `added: 0`. Also reject if any inserted URL is not in the candidate list.
5. **Pipeline integration:** in `runBlogPipeline`, after verification (and the lint/fix pass), call `addInternalLinks` for the saved post and update the row if links were added. Wrap in try/catch — link failure must never fail generation.
6. **Route + MCP tool:** `POST /api/blog/posts/:id/internal-links` and MCP tool `add_internal_links` ("Insert links to related iBOLT blog posts into an existing post. Use to retrofit older posts when new related content is published.").

**Test: `tests/internalLinker.test.ts`** — the safety validator: identical-except-links passes; altered prose is rejected; foreign URL is rejected. Export the validator as a pure function to make this testable.

**Acceptance:** generated posts contain internal links when related posts exist; the validator provably blocks prose mutation.

---

## T6 — Structured data + real markdown rendering

**File: `server/htmlRenderer.ts`**

1. **Replace the hand-rolled markdown parser with `marked`** (add dependency). The current parser cannot render markdown tables — comparison posts (a core content type) lose their tables. Requirements:
   - Tables, nested lists, bold/italic/links/images all render correctly.
   - Preserve the existing post-processing behaviors as separate passes over the HTML: auto-linking product mentions to iboltmounts.com, rewriting `/api/blog/photos/serve/` URLs to `PUBLIC_BASE_URL`, and FAQ extraction (below).
   - Raw HTML blocks already in the markdown (product image `<div>`s) must pass through untouched (`marked` does this by default).
2. **JSON-LD.** Keep the existing FAQPage extraction. Add:
   - `Article`: headline (title), description (metaDescription), datePublished (generatedAt), dateModified (updatedAt), author + publisher = `{"@type":"Organization","name":"iBOLT Mounts","url":"https://iboltmounts.com"}`, image = first image URL in the post if any.
   - `BreadcrumbList`: Home (`https://iboltmounts.com`) → Blog (`https://iboltmounts.com/blogs/news`) → post title.
   - `ItemList` for listicles: if the title matches `/^(best|top)\b/i`, emit an ItemList of the product links that appear in the body, in order of first appearance (name = link text, url = href).
   - All JSON-LD goes in `<script type="application/ld+json">` blocks appended the same way FAQPage currently is.
3. **`PUBLIC_BASE_URL` default:** keep reading from env, but log a boot warning if it still points at `scholarmark.ai` (blog images should be served from a brand-appropriate domain; flag, don't break).

**Test: `tests/htmlRenderer.test.ts`** — fixture markdown containing: H2/H3, a table, a nested list, a product markdown link, an `<img>` HTML block, and an FAQ section. Assert: `<table>` present, FAQPage + Article + BreadcrumbList JSON-LD present, raw HTML preserved, a `/^Best /` titled fixture emits ItemList.

**Acceptance:** tables render; three JSON-LD types emitted; renderer tests pass.

---

## T7 — MCP tools for the full benchmark loop

**File: `mcp-server/ibolt-stdio.mjs`** (+ check `server/benchmarkRoutes.ts` for the exact existing routes; add routes only if a capability has no route yet — `aiBenchmark.ts` already exports `runAiBenchmark`, `getLatestBenchmarkRunSummary`, `getBenchmarkRunSummary`, `listBenchmarkQueries`, `createBenchmarkQuery`, `generateContentPlan`, `materializeContentPlanItem`).

Add tools:

| Tool | Maps to | Description for the tool |
|---|---|---|
| `run_ai_benchmark` | benchmark run endpoint | "Run the AI visibility benchmark: queries ChatGPT, Claude, Gemini, and Google with buyer-style questions and measures whether iBOLT is mentioned/ranked/cited. Long-running." |
| `get_benchmark_summary` | latest (or by runId) summary | "Get provider-level and query-level results from the latest benchmark run, including biggest gaps and top wins." |
| `list_benchmark_queries` | query list | "List the tracked buyer-style benchmark queries." |
| `add_benchmark_query` | createBenchmarkQuery | "Add a buyer-style query to track (e.g. 'best forklift tablet mount'). Use when entering a new category." |
| `generate_content_plan` | generateContentPlan | "Turn the weakest benchmark queries into a deduplicated content plan (titles, keywords, angles, gap scores)." |
| `materialize_content_plan` | materializeContentPlanItem | "Convert a content-plan item into a keyword cluster; optionally queue it for generation (generateNow flag)." |

Plus the tools already specified in T2 (`lint_content`), T4 (`get_research_coverage`, `suggest_verticals`, `create_vertical`), T5 (`add_internal_links`), and T8 (`refresh_post`).

Update the MCP tool table in `CLAUDE.md` to list every tool.

**Acceptance:** `node mcp-server/ibolt-stdio.mjs` starts cleanly (it proxies HTTP, so tools just need to register); CLAUDE.md is current.

---

## T8 — Content refresh job

**Files: `server/scheduler.ts`, `server/blogRoutes.ts`, `mcp-server/ibolt-stdio.mjs`**

1. New scheduler task `runContentRefresh()` with config: `refreshIntervalMs` (default 7d), `autoRefresh: boolean` (default **false**), `maxRefreshPerRun` (default 2), `refreshAgeDays` (default 60).
2. Selection: published posts (`shopifyArticleId` not null) whose `updatedAt` is older than `refreshAgeDays`, oldest first.
3. Refresh procedure per post: re-fetch its `relevantProducts` (same logic as `getClusterData`, via its cluster), then one `generateText` call with the stitcher system prompt: "Update this published post: refresh any dates/years to current, correct any product names/prices/links against the catalog below, improve clarity. Do not change the structure, headings, or core content. Return complete markdown." Then: lint (T2) → verify (T3) → only if lint passes AND score ≥ previous `overallScore` do you save, re-render HTML, and push the update through the existing Shopify update path in `server/shopifyPublisher.ts`. Otherwise skip and log.
4. Route `POST /api/blog/posts/:id/refresh` for manual triggering; MCP tool `refresh_post` ("Refresh a published post: update dates, prices, and product links against the current catalog, then sync to Shopify. Only saves if quality does not regress.").

**Acceptance:** refresh respects the quality-no-regression rule; disabled by default; manually triggerable per post.

---

## T9 — Hygiene

1. **`.env.example`** at repo root listing every env var the blog engine reads, with comments: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` (benchmark), `SHOPIFY_SHOP`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `PUBLIC_BASE_URL`, `BLOG_ANTHROPIC_MODEL`, `BLOG_OPENAI_MODEL`, `BLOG_QUALITY_GATE`, `SHOPIFY_BLOG_HANDLES`, `PORT`.
2. **CSV parsing**: replace the hand-rolled parser in `server/keywordManager.ts` with `papaparse` (keep `parseKeywordCSV`'s signature and return shape). Add `tests/keywordManager.test.ts`: quoted fields containing commas, "Not ranked" position, thousands-separator volumes, missing optional columns.
3. **Batch the keyword import**: `importKeywordCSV` currently does a SELECT + INSERT per row. Load all existing keywords once into a Map, then batch-insert new rows with a single `db.insert(keywords).values([...])` (chunk at 100 rows).
4. **Clustering scale guard**: `clusterKeywords()` sends every unclustered keyword in one prompt with `max_tokens: 4096`. Chunk input at 150 keywords per call and loop; merge results.
5. Update `CLAUDE.md` and `ROADMAP.md` to reflect everything shipped in T1–T8 (tool list, linter, research scheduling behavior, refresh job).

**Acceptance:** `npm run check` passes; all new test files pass via `npx vitest run`.

---

## Final verification checklist

Run in order, all must pass:

1. `npm run check` — zero TypeScript errors.
2. `npx vitest run tests/contentLinter.test.ts tests/htmlRenderer.test.ts tests/internalLinker.test.ts tests/keywordManager.test.ts tests/researchCoverage.test.ts` — all green.
3. `node -e "require('child_process')"`-style smoke: `npm run dev` boots without crashing and `GET /api/blog/research/coverage` returns JSON (no API keys needed for that route).
4. `node mcp-server/ibolt-stdio.mjs` starts and registers all tools without error.
5. Grep sanity: `grep -n "fish|marine|boat" server/blogPipeline.ts` returns nothing; `grep -n "70" server/blogPipeline.ts` shows no remaining hardcoded quality gate.

## Out of scope (do NOT do in this run)

- Multi-tenant / brand-as-config extraction (planned separately).
- Google Search Console integration (needs OAuth credentials that don't exist yet).
- Any changes to ScholarMark features, auth, or the Chrome extension.
- Database engine changes (stay on SQLite).
- UI redesigns — only add UI if a task strictly requires it (none do; all new capabilities are API + MCP).
