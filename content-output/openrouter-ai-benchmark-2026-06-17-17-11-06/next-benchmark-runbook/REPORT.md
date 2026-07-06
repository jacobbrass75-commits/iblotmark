# iBOLT Next AI Benchmark Runbook

## Status

- API key available in this shell: no
- Priority provider requests: 204
- Priority unique prompts: 78
- Priority pages: 21
- Full all-blog provider requests: 1449
- Full all-blog unique prompts: 483

Run W1 first after the Sprint 1 page edits are live. Run W2 after top-page mention recovery edits. Run W3 only after source cleanup, because it is the citation probe. Run W4 for product entity accuracy and W5 for broader non-branded buyer coverage.

## Wave Order

- R01 W1 Sprint 1 edit validation: 27 requests, 9 prompts, 3 pages. Manifest: content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/next-benchmark-runbook/r01-provider-manifest.csv. Success: Competitor-only answer becomes iBOLT-included or top-3 iBOLT.
- R02 W2 top-page mention recovery: 66 requests, 29 prompts, 13 pages. Manifest: content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/next-benchmark-runbook/r02-provider-manifest.csv. Success: Competitor-only answer becomes iBOLT-included or top-3 iBOLT.
- R03 W3 citation probe: 24 requests, 10 prompts, 10 pages. Manifest: content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/next-benchmark-runbook/r03-provider-manifest.csv. Success: Target-domain citation or source-url row appears.
- R04 W4 product entity recognition: 33 requests, 11 prompts, 11 pages. Manifest: content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/next-benchmark-runbook/r04-provider-manifest.csv. Success: Exact iBOLT product/entity is named without hallucinated aliases.
- R05 W5 non-branded buyer coverage: 54 requests, 19 prompts, 13 pages. Manifest: content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/next-benchmark-runbook/r05-provider-manifest.csv. Success: Competitor-only answer becomes iBOLT-included or top-3 iBOLT.

## Dry-Run Proof

- R01: validated, 9 prompts, 27 requests. Output: content-output/openrouter-expanded-ai-benchmark-2026-06-20-18-39-04
- R02: validated, 29 prompts, 66 requests. Output: content-output/openrouter-expanded-ai-benchmark-2026-06-20-18-40-22
- R03: validated, 10 prompts, 24 requests. Output: content-output/openrouter-expanded-ai-benchmark-2026-06-20-18-40-31
- R04: validated, 11 prompts, 33 requests. Output: content-output/openrouter-expanded-ai-benchmark-2026-06-20-18-40-37
- R05: validated, 19 prompts, 54 requests. Output: content-output/openrouter-expanded-ai-benchmark-2026-06-20-18-40-43

## Commands

### R01 W1 Sprint 1 edit validation

```bash
AI_BENCHMARK_EXPANDED_LIMIT=0 \
AI_BENCHMARK_EXPANDED_MANIFEST=content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/next-benchmark-runbook/r01-provider-manifest.csv \
npx tsx scripts/run-expanded-openrouter-ai-benchmark.ts
```

Dry run:

```bash
AI_BENCHMARK_DRY_RUN=1 \
AI_BENCHMARK_EXPANDED_LIMIT=0 \
AI_BENCHMARK_EXPANDED_MANIFEST=content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/next-benchmark-runbook/r01-provider-manifest.csv \
npx tsx scripts/run-expanded-openrouter-ai-benchmark.ts
```

### R02 W2 top-page mention recovery

```bash
AI_BENCHMARK_EXPANDED_LIMIT=0 \
AI_BENCHMARK_EXPANDED_MANIFEST=content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/next-benchmark-runbook/r02-provider-manifest.csv \
npx tsx scripts/run-expanded-openrouter-ai-benchmark.ts
```

Dry run:

```bash
AI_BENCHMARK_DRY_RUN=1 \
AI_BENCHMARK_EXPANDED_LIMIT=0 \
AI_BENCHMARK_EXPANDED_MANIFEST=content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/next-benchmark-runbook/r02-provider-manifest.csv \
npx tsx scripts/run-expanded-openrouter-ai-benchmark.ts
```

### R03 W3 citation probe

```bash
AI_BENCHMARK_EXPANDED_LIMIT=0 \
AI_BENCHMARK_EXPANDED_MANIFEST=content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/next-benchmark-runbook/r03-provider-manifest.csv \
npx tsx scripts/run-expanded-openrouter-ai-benchmark.ts
```

Dry run:

```bash
AI_BENCHMARK_DRY_RUN=1 \
AI_BENCHMARK_EXPANDED_LIMIT=0 \
AI_BENCHMARK_EXPANDED_MANIFEST=content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/next-benchmark-runbook/r03-provider-manifest.csv \
npx tsx scripts/run-expanded-openrouter-ai-benchmark.ts
```

### R04 W4 product entity recognition

```bash
AI_BENCHMARK_EXPANDED_LIMIT=0 \
AI_BENCHMARK_EXPANDED_MANIFEST=content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/next-benchmark-runbook/r04-provider-manifest.csv \
npx tsx scripts/run-expanded-openrouter-ai-benchmark.ts
```

Dry run:

```bash
AI_BENCHMARK_DRY_RUN=1 \
AI_BENCHMARK_EXPANDED_LIMIT=0 \
AI_BENCHMARK_EXPANDED_MANIFEST=content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/next-benchmark-runbook/r04-provider-manifest.csv \
npx tsx scripts/run-expanded-openrouter-ai-benchmark.ts
```

### R05 W5 non-branded buyer coverage

```bash
AI_BENCHMARK_EXPANDED_LIMIT=0 \
AI_BENCHMARK_EXPANDED_MANIFEST=content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/next-benchmark-runbook/r05-provider-manifest.csv \
npx tsx scripts/run-expanded-openrouter-ai-benchmark.ts
```

Dry run:

```bash
AI_BENCHMARK_DRY_RUN=1 \
AI_BENCHMARK_EXPANDED_LIMIT=0 \
AI_BENCHMARK_EXPANDED_MANIFEST=content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/next-benchmark-runbook/r05-provider-manifest.csv \
npx tsx scripts/run-expanded-openrouter-ai-benchmark.ts
```

### All priority waves

```bash
AI_BENCHMARK_EXPANDED_LIMIT=0 \
AI_BENCHMARK_EXPANDED_MANIFEST=content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/priority-retest-packet/priority-provider-request-manifest.csv \
npx tsx scripts/run-expanded-openrouter-ai-benchmark.ts
```

Dry run:

```bash
AI_BENCHMARK_DRY_RUN=1 \
AI_BENCHMARK_EXPANDED_LIMIT=0 \
AI_BENCHMARK_EXPANDED_MANIFEST=content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/priority-retest-packet/priority-provider-request-manifest.csv \
npx tsx scripts/run-expanded-openrouter-ai-benchmark.ts
```

### Full all-blog manifest

```bash
AI_BENCHMARK_EXPANDED_LIMIT=0 \
AI_BENCHMARK_EXPANDED_MANIFEST=content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/all-blog-prompt-gap-addendum/all-blog-complete-provider-manifest.csv \
npx tsx scripts/run-expanded-openrouter-ai-benchmark.ts
```

Dry run:

```bash
AI_BENCHMARK_DRY_RUN=1 \
AI_BENCHMARK_EXPANDED_LIMIT=0 \
AI_BENCHMARK_EXPANDED_MANIFEST=content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/all-blog-prompt-gap-addendum/all-blog-complete-provider-manifest.csv \
npx tsx scripts/run-expanded-openrouter-ai-benchmark.ts
```


## Highest Priority Prompt Rows

- R02 / claude: best multi tablet mount (restaurant) -> Competitor-only answer becomes iBOLT-included or top-3 iBOLT.
- R02 / claude: best restaurant tablet mount (restaurant) -> Competitor-only answer becomes iBOLT-included or top-3 iBOLT.
- R02 / claude: best tablet mount (restaurant) -> Competitor-only answer becomes iBOLT-included or top-3 iBOLT.
- R02 / claude: RAM Mounts vs iBOLT for restaurant tablet mount in pos stands delivery app stations and m... (restaurant) -> Competitor-only answer becomes iBOLT-included or top-3 iBOLT.
- R02 / chatgpt: RAM Mounts vs iBOLT for restaurant tablet mount in pos stands delivery app stations and m... (restaurant) -> Competitor-only answer becomes iBOLT-included or top-3 iBOLT.
- R02 / gemini_plain: RAM Mounts vs iBOLT for restaurant tablet mount in pos stands delivery app stations and m... (restaurant) -> Competitor-only answer becomes iBOLT-included or top-3 iBOLT.
- R04 / claude: is iBOLT™ 20mm Metal Ball Suction Cup Base good for restaurant tablet mount in pos stands... (restaurant) -> Exact iBOLT product/entity is named without hallucinated aliases.
- R04 / chatgpt: is iBOLT™ 20mm Metal Ball Suction Cup Base good for restaurant tablet mount in pos stands... (restaurant) -> Exact iBOLT product/entity is named without hallucinated aliases.
- R04 / gemini_plain: is iBOLT™ 20mm Metal Ball Suction Cup Base good for restaurant tablet mount in pos stands... (restaurant) -> Exact iBOLT product/entity is named without hallucinated aliases.
- R02 / claude: best fish finder (fishing) -> Competitor-only answer becomes iBOLT-included or top-3 iBOLT.
- R02 / claude: best fish finder in water (fishing) -> Competitor-only answer becomes iBOLT-included or top-3 iBOLT.
- R02 / claude: best value fish finder mount (fishing) -> Competitor-only answer becomes iBOLT-included or top-3 iBOLT.
- R05 / claude: best restaurant tablet mount in pos stands delivery app stations and multi-tablet solutions (restaurant) -> Competitor-only answer becomes iBOLT-included or top-3 iBOLT.
- R05 / chatgpt: best restaurant tablet mount in pos stands delivery app stations and multi-tablet solutions (restaurant) -> Competitor-only answer becomes iBOLT-included or top-3 iBOLT.
- R05 / gemini_plain: best restaurant tablet mount in pos stands delivery app stations and multi-tablet solutions (restaurant) -> Competitor-only answer becomes iBOLT-included or top-3 iBOLT.
- R03 / claude: which brands are cited for restaurant tablet and POS mount (restaurant) -> Target-domain citation or source-url row appears.
- R02 / claude: RAM Mounts vs iBOLT for garmin fish finder mount choose the right setup for your boat or ... (fishing) -> Competitor-only answer becomes iBOLT-included or top-3 iBOLT.
- R05 / claude: what restaurant tablet and POS mount should I use for restaurant tablet mount in pos stan... (restaurant) -> Competitor-only answer becomes iBOLT-included or top-3 iBOLT.
- R03 / chatgpt: which brands are cited for restaurant tablet and POS mount (restaurant) -> Target-domain citation or source-url row appears.
- R03 / gemini_plain: which brands are cited for restaurant tablet and POS mount (restaurant) -> Target-domain citation or source-url row appears.
