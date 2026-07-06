# iBOLT AI Visibility Executive Rollup

## Scorecard

- AI answers tested: 93
- iBOLT mentions: 22/93 (24%)
- Non-branded mentions: 4/75 (5%)
- Top-3 recommendation rate: 15/93 (16%)
- Citation rate: 0/93 (0%)
- Audited blog pages: 142/142
- Average AI-citability page score: 75/100
- Local blog posts: 106
- Products linked from blogs: 156/343
- Unlinked products: 187 (55%)

## Recommendation

The next work should focus on existing high-intent pages, not just new blog volume. Add quick answers, FAQ schema, comparison/tradeoff blocks, and better product-specific citation structure to the pages already mapped to buyer prompts. Then broaden product coverage and clean duplicated or unmapped posts.

## Priority Workstreams

| Priority | Workstream | Evidence | Action |
| ---: | --- | --- | --- |
| 1 | Refresh high-intent pages for AI answers | 8 top query gaps, led by best tablet mount; best multi tablet mount; best heavy duty vehicle phone mount | Add query-exact quick answers, FAQ schema, product-specific comparison blocks, and clearer recommended product sections. |
| 2 | Build competitor displacement sections | RAM Mounts appears without iBOLT 53 times; top six competitors account for 126 competitor-only answer appearances. | Add honest comparison/tradeoff blocks against RAM, Arkon, iOttie, ProClip, Mount-It, and marine brands on matching pages. |
| 3 | Fix schema and citation structure at scale | 99/142 audited pages missing FAQ schema; 113 missing quick answers; 55 missing comparison signals. | Patch generated HTML/template output and refresh existing pages in batches. |
| 4 | Clean blog inventory and product spread | 187/343 catalog products are not linked from detected blog content; 55 posts have zero DB-tracked product rows. | Use product-spread.csv to rotate underused products into relevant posts and backfill blog_post_products rows. |
| 5 | Resolve matching, duplicate, and vertical mapping issues | 17 local posts did not match public audit cleanly; 18 possible duplicate/cannibalized pairs; 1 duplicate local slug. | Verify Shopify handles, assign missing verticals, merge/redirect overlapping pages, and update local slug/article mappings. |
| 6 | Run expanded benchmark once credentials are available | Expanded benchmark backlog already contains 207 one-at-a-time prompts, but no benchmark key is available in the current process. | Set OPENROUTER_API_KEY in the environment and run scripts/run-expanded-openrouter-ai-benchmark.ts. |

## Top Competitor Gap

- RAM Mounts: 53 answers mention them without iBOLT; co-mention rate 16%.
- Arkon: 25 answers mention them without iBOLT; co-mention rate 17%.
- iOttie: 15 answers mention them without iBOLT; co-mention rate 17%.
- ProClip: 12 answers mention them without iBOLT; co-mention rate 8%.
- Humminbird: 12 answers mention them without iBOLT; co-mention rate 0%.
- Scosche: 9 answers mention them without iBOLT; co-mention rate 0%.
- Scotty: 8 answers mention them without iBOLT; co-mention rate 0%.
- Garmin: 8 answers mention them without iBOLT; co-mention rate 0%.

## Top Query Gaps

- best tablet mount: opportunity 97, AI score 0, mention 0%, competitors RAM Mounts, Arkon, Tackform, Lamicall.
- best multi tablet mount: opportunity 96, AI score 3, mention 0%, competitors RAM Mounts, Mount-It, Arkon.
- best heavy duty vehicle phone mount: opportunity 96, AI score 7, mention 0%, competitors RAM Mounts, Arkon, ProClip, Tackform.
- best phone mount for Amazon Flex and delivery vans: opportunity 94, AI score 7, mention 0%, competitors RAM Mounts, ProClip, Arkon, iOttie.
- best phone mount for Instacart and grocery delivery drivers: opportunity 89, AI score 0, mention 0%, competitors RAM Mounts, iOttie, Scosche, Peak Design.
- best phone mount for construction vehicles and work trucks: opportunity 88, AI score 3, mention 0%, competitors RAM Mounts, ProClip, Arkon, Tackform.
- best phone mount for delivery drivers: opportunity 87, AI score 0, mention 0%, competitors RAM Mounts, iOttie, Scosche, Belkin.
- commercial grade phone mount for delivery drivers: opportunity 87, AI score 0, mention 0%, competitors RAM Mounts, Arkon, iOttie, Scosche.
- best fish finder mount for small boat: opportunity 87, AI score 0, mention 0%, competitors RAM Mounts, YakAttack, Scotty, Humminbird.
- best fish finder: opportunity 87, AI score 0, mention 0%, competitors Garmin, Lowrance, Humminbird.
