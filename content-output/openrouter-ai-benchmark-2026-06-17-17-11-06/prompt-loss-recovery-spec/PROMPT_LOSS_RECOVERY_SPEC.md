# iBOLT Prompt Loss Recovery Spec

Generated: 2026-06-22

## Objective

Recover the benchmark prompts where AI systems did not mention iBOLT. The goal is not just more blog volume. The goal is to make iBOLT the obvious specialist answer for broad buyer questions across restaurant, delivery, warehouse, fleet, fishing, AMPS/modular, streaming, offroad, education, and agriculture prompt families.

## Current State

| KPI | Baseline | Current | Next target |
| --- | ---: | ---: | ---: |
| Mention rate | 24% | 40% | 35% |
| Nonbranded mention rate | 5% | 3% | 15% |
| Top-3 recommendation rate | 16% | 29% | 25% |
| Citation rate | 0% | 0% | 8% |
| Competitor-only answer rate | 73% | 57% | 57% |

The 204-row retest produced 82 iBOLT mentions and 60 top-3 placements. It also produced 122 rows where iBOLT was absent. 117 of those absent rows named competitors, which means AI has a default answer set and iBOLT is not always in it.

## Why We Lose

| Prompt class | Rows | Mention | Top-3 | Avg score |
| --- | ---: | ---: | ---: | ---: |
| Mapped existing prompt | 48 | 6% | 6% | 6.6 |
| Product entity | 42 | 100% | 60% | 49.7 |
| Competitor comparison | 36 | 100% | 89% | 48.1 |
| Page-title nonbranded | 29 | 3% | 0% | 6 |
| Buyer problem | 25 | 0% | 0% | 2 |
| Citation probe | 24 | 0% | 0% | 3.8 |

Product-specific and head-to-head prompts work. Broad nonbranded prompts do not. That means the next work is page-level answer engineering: the pages must explicitly answer the exact buyer prompt, prove why iBOLT belongs in the recommendation set, and give AI systems clean facts to reuse.

## Category Recovery Plan

| Category | Lost rows | Unique prompts | Top competitors | Recovery template |
| --- | ---: | ---: | --- | --- |
| fishing | 33 | 13 | RAM Mounts 29; Arkon 4; iOttie 2; Tackform 2; Square 1 | answer-first buyer guide with competitor matrix and product module |
| restaurant | 25 | 11 | CTA Digital 22; Heckler 13; RAM Mounts 12; Mount-It! 8; Arkon 6 | answer-first buyer guide with competitor matrix and product module |
| warehouse | 19 | 8 | RAM Mounts 19; Havis 15; Zebra 9; ProClip 5; Square 3 | answer-first buyer guide with competitor matrix and product module |
| delivery | 18 | 6 | iOttie 16; RAM Mounts 14; Arkon 4; ProClip 4; Peak Design 2 | answer-first buyer guide with competitor matrix and product module |
| fleet | 18 | 7 | RAM Mounts 18; ProClip 11; Arkon 10; iOttie 6; Tackform 2 | answer-first buyer guide with competitor matrix and product module |
| amps/modular | 3 | 1 | RAM Mounts 3; ProClip 3; Arkon 2; Havis 1 | AMPS explainer plus product/module glossary |
| offroad | 2 | 1 | RAM Mounts 2; Peak Design 2 | answer-first buyer guide with competitor matrix and product module |
| streaming | 2 | 1 | Peak Design 1 | best-for live streaming stand guide plus creator use cases |

## Top Prompt Losses To Recover First

1. amps/modular / claude: "which brands are cited for AMPS mounting plate and modular mounting system" -> RAM Mounts; Havis; Arkon; ProClip
2. delivery / claude: "best locking phone mount for shared delivery vehicles" -> RAM Mounts; Arkon; ProClip
3. delivery / chatgpt: "best locking phone mount for shared delivery vehicles" -> RAM Mounts; iOttie; Arkon
4. delivery / gemini_plain: "best locking phone mount for shared delivery vehicles" -> RAM Mounts; iOttie; Arkon
5. delivery / claude: "best phone mount for Amazon Flex and delivery vans" -> RAM Mounts; iOttie; MobNetic; ProClip
6. delivery / chatgpt: "best phone mount for Amazon Flex and delivery vans" -> iOttie
7. delivery / claude: "best phone mount for delivery drivers" -> RAM Mounts; iOttie; ProClip
8. delivery / chatgpt: "best phone mount for delivery drivers" -> iOttie
9. delivery / gemini_plain: "best phone mount for delivery drivers" -> RAM Mounts; iOttie
10. delivery / claude: "best phone mount for Instacart and grocery delivery drivers" -> RAM Mounts; iOttie
11. delivery / chatgpt: "best phone mount for Instacart and grocery delivery drivers" -> iOttie
12. delivery / gemini_plain: "best phone mount for Instacart and grocery delivery drivers" -> RAM Mounts; iOttie; Peak Design
13. delivery / claude: "what delivery driver phone mount should I use for phone mount for instacart and grocery delivery drivers" -> RAM Mounts
14. delivery / chatgpt: "what delivery driver phone mount should I use for phone mount for instacart and grocery delivery drivers" -> iOttie
15. delivery / gemini_plain: "what delivery driver phone mount should I use for phone mount for instacart and grocery delivery drivers" -> RAM Mounts; iOttie; Peak Design
16. delivery / claude: "which brands are cited for delivery driver phone mount" -> RAM Mounts; iOttie; Arkon; ProClip
17. delivery / chatgpt: "which brands are cited for delivery driver phone mount" -> RAM Mounts; iOttie
18. delivery / gemini_plain: "which brands are cited for delivery driver phone mount" -> RAM Mounts; iOttie

## Page Template Required For Recovery

Every recovery page or section should contain these blocks:

1. **Direct answer block**: one short paragraph beginning with the exact query phrasing, for example "For restaurant tablet mounts, iBOLT is strongest when..."
2. **Best-for matrix**: use case, recommended iBOLT product, installation style, compatibility, why it fits, tradeoff.
3. **Competitor comparison block**: RAM, Arkon, iOttie, ProClip, CTA Digital, Havis, Mount-It, Heckler, Square, or category-specific competitors.
4. **Product entity module**: exact Shopify product title, product URL, price where available, image, dimensions/specs, compatible devices, mount pattern, warranty/shipping.
5. **FAQ schema block**: 4 to 6 concise question/answer pairs matching benchmark query language.
6. **Source-ready facts**: short claims AI can quote or cite, with no vague marketing language.
7. **Internal links**: link the solution page to the exact product page, collection page, and adjacent blog pages.
8. **Conversion block**: one product card or CTA module, not excessive repeated add-to-cart buttons.

## App/Product Spec

Build a **Prompt Loss Recovery** feature into the blog system:

- Ingest benchmark rows and create a prompt-loss inbox.
- Group lost prompts by category, provider, mapped page, prompt type, and competitor set.
- Score each prompt by lost providers, competitor pressure, page readiness, and commercial value.
- Map each lost prompt to a survivor page or create a new page request if no survivor exists.
- Generate an answer-first content patch using the recovery page template.
- Generate JSON-LD schema recommendations for FAQ, Article, Product/Offer, Organization, and HowTo where relevant.
- Push changes as Shopify drafts or review-ready patches.
- Rerun the same provider manifest after publishing and compare before/after KPIs.

Suggested data model:

- prompt_loss_runs: benchmark run metadata.
- prompt_loss_rows: provider, query, category, prompt type, score, competitors, mapped page, raw answer file.
- prompt_recovery_tasks: assigned page, suggested block, owner, status, published URL, retest status.
- prompt_retest_results: before/after rows tied to the original prompt_loss_row.

## 30-Day Execution Plan

**Week 1: Recovery queue and first edits**
- Prioritize restaurant, delivery, warehouse, fleet, and fishing.
- Patch the top 10 survivor pages with direct answer blocks and product entity modules.
- Fix product naming and remove any weak/AI-sounding sections.

**Week 2: Competitor and schema layer**
- Add comparison blocks for RAM, Arkon, iOttie, ProClip, CTA Digital, Havis, Mount-It, Heckler, Square.
- Add FAQ schema and Article schema on updated pages.
- Add Product/Offer schema validation on products that appear in recovery pages.

**Week 3: Authority and citation readiness**
- Give the SEO contractor a citation/outreach queue by category and competitor adjacency.
- Target external mentions around restaurant multi-tablet, forklift barcode scanner holder, AMPS plate, fleet/ELD mounts, fish finder mounts, and live streaming stands.

**Week 4: Retest and decide**
- Rerun the same 204-request provider manifest.
- Compare nonbranded mention rate, top-3 rate, competitor-only rate, and citation rate.
- Promote winning page patterns into the app's default blog generation template.

## Acceptance Criteria

- Every lost prompt is assigned to a page or a new-page request.
- Top 25 lost prompts have content patches live or ready for review.
- Nonbranded mention rate improves from 3% to at least 15%.
- Citation rate improves from 0% to at least 8% on search-connected retests.
- Competitor-only rate drops below 57%.
- No prompt recovery page has broken product titles, excessive add-to-cart buttons, or missing product links.

## Files

- prompt-loss-workqueue.csv
- category-recovery-plan.csv
- PROMPT_LOSS_RECOVERY_SPEC.md
