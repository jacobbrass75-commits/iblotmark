# iBOLT AI visibility benchmark standard

The canonical trend benchmark is `ibolt-ai-visibility-top10-v1`, defined in `benchmarks/ai-visibility-top10-v1.json`. It preserves the exact ten-query panel used in the two complete August 5 runs so future results can extend the strongest existing baseline instead of starting another incompatible series.

## What a canonical run holds constant

- Ten exact unaided Top-10 buyer queries, identified by normalized query text rather than database IDs.
- Four exact provider lanes: `chatgpt`, `claude`, `gemini_plain`, and `gemini_google_search`.
- The `buyer-style-v1` prompt text and `coverage-v1` scorer declaration.
- One result per provider-query cell: 40 completed, unique cells. Failed, skipped, missing, or duplicate cells invalidate headline deltas.
- Provider model names are recorded. Two runs must have the same provider-model set to be compared.
- The manifest, query, provider, and prompt hashes are stored with new runs.

The standard intentionally does not claim that a single stochastic model response is a stable SEO effect. A run is one observation. Use the same panel after 7 and 28 days and interpret sustained movement, not minute-to-minute changes.

## Run it

With the app running on port 5001 and all four provider credentials configured:

```text
node scripts/run-top-10-benchmark.mjs --output=content-output/ai-visibility-standard/YYYY-MM-DD
```

The runner refuses partial provider overrides. It writes the manifest snapshot, selected query records, raw SSE events, and a summary containing the standard metadata and a completed-matrix check.

## Compare it

```text
node scripts/compare-top-10-benchmark-runs.mjs --previous=<run-id> --current=<run-id> --output=content-output/ai-visibility-standard/comparison
```

The comparator stops instead of calculating deltas when query, provider, prompt, model, scorer, or completion matrices differ. It matches queries by normalized text, so portable database copies with different row IDs remain comparable.

Comparison grades:

- `strict`: every observable input matches and both runs store the same standard/scorer version.
- `provisional`: every observable input matches, but one or both historical runs predate stored protocol metadata.
- `incompatible`: at least one required input or completed result cell differs; no headline delta should be reported.

## Metrics

- Mention rate: completed cells that mention the configured target brand.
- Citation rate: completed cells whose captured sources cite the configured target domain.
- Top-three rate: completed cells that explicitly rank the target brand from one through three.
- Average coverage score: mean `coverage-v1` score. If the scorer changes, rescore both raw-response sets before comparison.

Manual browser surfaces, forced brand-comparison prompts, expanded research prompts, public Google AI Mode checks, and site/SEO audits remain valuable diagnostics. They are separate series and must not be blended into this benchmark's trend line.
