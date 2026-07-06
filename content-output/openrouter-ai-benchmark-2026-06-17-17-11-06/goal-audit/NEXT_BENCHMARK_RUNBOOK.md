Do not put the API key in a committed file. Set it only in the local shell, then run:

```bash
export OPENROUTER_API_KEY="..."
AI_BENCHMARK_EXPANDED_LIMIT=0 \
AI_BENCHMARK_EXPANDED_MANIFEST=content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/priority-retest-packet/priority-provider-request-manifest.csv \
npx tsx scripts/run-expanded-openrouter-ai-benchmark.ts
node scripts/build-ai-answer-evidence-pack.mjs
node scripts/build-ai-visibility-deep-dive.mjs
node scripts/build-ai-visibility-competitive-matrix.mjs
node scripts/build-ai-mention-landscape.mjs
node scripts/build-ai-citation-strategy-report.mjs
node scripts/build-ai-content-refresh-roadmap.mjs
node scripts/build-ai-visibility-master-dossier.mjs
```

Expanded dry-run folder: /Users/yakub/Desktop/iblotmark/content-output/openrouter-expanded-ai-benchmark-2026-06-18-15-20-02
