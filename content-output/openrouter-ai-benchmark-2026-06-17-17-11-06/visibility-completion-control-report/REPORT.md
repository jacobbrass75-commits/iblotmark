# iBOLT Visibility Completion Control Report

## Current Decision

Do not claim post-edit visibility lift yet. Baseline analysis is proven, all-blog inspection is proven, and competitor mapping is proven. Expanded live testing is still not run because secure OpenRouter credentials are not available in this shell.

## Status

- Completion verdict: not_complete
- Blocker: OPENROUTER_API_KEY is not set in the local shell.
- Proven rows: 6
- Needs live proof: 2
- OpenRouter key present: no
- Integrity audit: 26/26, broken markers 0
- Priority run: 204 requests, 78 prompts
- Full run: 1449 requests, 483 prompts

## Remaining Proof Gates

- Test more areas: Set OPENROUTER_API_KEY securely in the shell, run the priority packet or full all-blog manifest, then rebuild reports.
- Current visibility baseline: The baseline is proven. Improvement is not proven until post-edit live retest data exists.

## Priority Command

```bash
export OPENROUTER_API_KEY="..."
AI_BENCHMARK_EXPANDED_LIMIT=0 \
AI_BENCHMARK_EXPANDED_MANIFEST=content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/priority-retest-packet/priority-provider-request-manifest.csv \
npx tsx scripts/run-expanded-openrouter-ai-benchmark.ts
```

## Full Command

```bash
export OPENROUTER_API_KEY="..."
AI_BENCHMARK_EXPANDED_LIMIT=0 \
AI_BENCHMARK_EXPANDED_MANIFEST=content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/all-blog-prompt-gap-addendum/all-blog-complete-provider-manifest.csv \
npx tsx scripts/run-expanded-openrouter-ai-benchmark.ts
```
