# iBolt Mark Current State

Updated August 11, 2026. This document reflects the checked-in code, the active
`data/standalone-blog-writer.db` database, live local API checks, and the public
iBOLT Shopify catalog.

## Runtime status

- Local app: healthy on `http://127.0.0.1:5001`.
- Stack: Express, TypeScript, React, Vite, SQLite/Drizzle, Anthropic with OpenAI fallback.
- TypeScript check: passing.
- Production build: passing.
- Test suite: 32 files and 104 tests passing sequentially.
- Browser checks: dashboard, setup, generation, keywords, posts, products, assets,
  context, and benchmark pages render without page errors or failed requests.
- Setup checklist: 5 of 7 complete. Managed assets and Shopify OAuth publishing remain.

## Content inventory

- 21 published legacy posts plus one new four-phase pilot draft in the active database.
- 46 imported keywords organized into 12 keyword clusters: 11 pending and one generated.
- 21 active content verticals with 246 verified context entries.
- 345 product records after the August 11 public-catalog refresh: 343 live Shopify
  products plus two obsolete `cpb-order-*` configurator records retained for safety.
- 342 healthy live product cover images. The only live product without a cover is the
  intentional **Build Your Own Mount** configurator.
- All 21 stored posts contain two or three healthy Shopify CDN images. There are 47
  placements using 25 unique current product images.

The 21 published posts were produced by an earlier Claude Sonnet 4.6 rewrite workflow,
not by the current four-phase pipeline. Their stored score of 86 is therefore not a
fresh independent verifier result.

The August 11 forklift pilot exercised the current planner, seven section writers,
stitcher, verifier, corrective pass, renderer, and three catalog-image insertions. It
scored 91 but remained a draft because the deterministic gate found excessive length,
title/keyword, punctuation, and product-link issues, while the verifier flagged five
unsupported product-detail claims. Nothing was published. Follow-up fixes now provide
more structured product facts, recognize exact Unicode Shopify handles, allow a final
lint correction after verifier revision, require exact title keywords, and separate the
conclusion from the final FAQ answer.

## How new blog posts are written

1. **Planner** reads a keyword cluster, company brand profile, a bounded Writing V3
   evidence packet, and ranked product facts. The evidence packet is selected directly
   from current verified context-bank records, carries source IDs, URLs, confidence,
   and content hashes, and is treated as untrusted data rather than instructions. The
   planner creates the title, metadata, slug, outline, keyword plan, product mentions,
   and word targets.
2. **Section Writer** retrieves a fresh, query-specific evidence packet for every
   planned section instead of depending on the old prebuilt chunk cache. Exact and
   rare terms influence ranking, Reddit/user-language and pain-point records receive
   a controlled relevance boost, source/category diversity is capped, and an adaptive
   6-12 KB UTF-8 budget never cuts a record in half. The iBOLT voice is present in every
   prompt: conversational expertise, education before sales, real specifications,
   multiple options, no hype phrases, and invitational CTAs.
3. **Stitcher** adds the scenario-led introduction, transitions, FAQ, conclusion, links,
   and product images. Only the 12 most relevant products are sent to the prompt.
4. **Verifier** scores brand consistency, SEO, natural language, and factual accuracy.
   The quality gate is 70. A below-gate post gets one feedback-based rewrite and is
   rechecked. A deterministic linter separately blocks banned phrases, bad structure,
   unsupported product details, and other mechanical quality failures. A final V3
   grounding audit also rejects unsupported long quotations and high-risk prices,
   measurements, percentages, or model claims unless one approved evidence or catalog
   record supports the complete claim. Retrieval or audit failure keeps the post in
   draft, and the evidence IDs, hashes, retrieval diagnostics, and final audit are saved
   in `verificationNotes` for review.
5. **Renderer and review** produce Shopify-ready HTML, FAQ and Article schema, signed
   asset URLs, metadata, and preview output. Editing markdown or photo placement now
   regenerates stored HTML. Publishing always renders the current markdown, preventing
   stale review HTML from reaching Shopify. The server also refuses single or batch
   publishing unless each post is approved, meets the active quality gate, and passes
   the current deterministic lint checks.

## Benchmark standard

The canonical trend benchmark is `ibolt-ai-visibility-top10-v1`, stored at
`benchmarks/ai-visibility-top10-v1.json` and documented in
`docs/BENCHMARK_STANDARD.md`.

It fixes ten unaided buyer queries, four provider lanes, prompt text, scorer version,
model recording, and a complete 40-cell matrix. The comparator refuses headline
deltas when queries, providers, prompts, models, scoring, or cell completion differ.

Historical audit findings:

- 24 database runs and 1,267 stored provider-query results were reviewed across the
  standalone and legacy databases.
- The two complete August 5 Top-10 runs are the strongest provisional historical pair.
- The latest preserved baseline contains 13/40 iBOLT mentions (32.5%), 0/40 target-domain
  citations, 7/40 top-three placements (17.5%), and a 20.48/100 mean coverage score.
- Those two runs occurred only about 98 minutes apart, so differences show model
  variance, not demonstrated SEO lift.
- July 28 is incomplete at 279/312 cells. June provider subsets, forced brand-comparison
  prompts, browser captures, Google AI Mode captures, SEO workbooks, and dry runs are
  useful diagnostics but are not part of the canonical trend line.

Run the next canonical benchmark with:

```text
node scripts/run-top-10-benchmark.mjs --output=content-output/ai-visibility-standard/YYYY-MM-DD
```

Use the same versioned panel at 7-day and 28-day intervals. A new paid-provider run was
not started during setup, so existing API quota was not spent without approval.

## Asset status

The product catalog and existing posts have the product covers needed for current
rendering. The governed Asset Bank is separate and currently empty: no uploaded assets
have been analyzed, rights-approved, or selected through `product_photos`.

Automatic selection and public serving now require both:

- asset status `approved`; and
- rights status `owned` or `licensed`.

There are 675 media files elsewhere in the repository, including 196 downloaded Shopify
blog covers. They were not silently bulk-imported because ownership, licensing, and
curation decisions have not been recorded.

## Required next inputs

1. Confirm which local/Shopify images iBOLT owns or licenses for reusable blog content.
   Then import, approve, and tag that curated set in the Asset Bank.
2. Add `OPENAI_API_KEY` if AI vision analysis is desired. Blog text generation can use
   the configured Anthropic provider, but Asset Bank vision specifically uses OpenAI.
3. Review or regenerate the forklift pilot, then run one more controlled cluster through
   the updated prompts before enabling batch scheduling.
4. Complete the company-level Shopify OAuth connection. Client credentials in `.env`
   do not replace the tenant OAuth access token used by publishing.
5. Before production deployment, set the live Clerk keys, public HTTPS origin,
   `JWT_SECRET`, `INTEGRATION_ENCRYPTION_KEY`, `PUBLIC_ASSET_SIGNING_SECRET`, and Shopify
   OAuth scopes described in `.env.example` and `docs/STANDALONE_PRODUCTION.md`.

## Project tasks

Three persistent Codex tasks were created in the saved **Ibolt Project** workspace:

- **iBolt Benchmark Standardization**
- **iBolt Blog Generator Operations**
- **iBolt System QA and Asset Library**

They preserve the benchmark, content-operations, and QA/asset work as separate organized
follow-up threads.
