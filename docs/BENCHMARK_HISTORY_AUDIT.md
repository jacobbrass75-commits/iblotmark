# Benchmark history audit

Audit scope: both live SQLite histories, every benchmark-named folder under `content-output`, manual captures in `benchmark-output`, and the later research/workbook outputs. No historical result was rewritten.

## Database run ledger

`data/sourceannotator.db` contains 12 runs and 324 result rows.

| Run | Panel / providers | Completion | Comparability decision |
|---|---|---:|---|
| `f56fa284...` Smoke Test 2026-04-10T21:43 | 1 query, 4 legacy lanes | 1 recorded completed of 4 rows | Smoke only; partial. |
| `65e0c2cc...` Smoke Test 2026-04-10T21:45 | Same 1 query and lanes | 1 of 4 | Smoke only; partial. |
| `aac5673e...` Smoke Test 2026-04-10T21:46 | Same 1 query and lanes | 0 of 4; failed | Invalid run. |
| `7dd2c465...` Smoke Test Benchmark | Same query, newer ChatGPT/Gemini models | 3 of 4 | Smoke only; model set differs from prior smoke runs. |
| `7aa1bd1a...` Initial Baseline 2026-04-10 | 12 queries, 3 lanes | 32 of 36 | Directional baseline; incomplete and Google lane used mixed models. |
| `78142972...` AI Benchmark 2026-04-29 | 12 queries, 4 normalized lanes | 0 of 48; failed | Invalid run. |
| `6b456000...` AI Benchmark 2026-04-29 | Same as above | 0 of 48; failed | Invalid run. |
| `ed1847b0...` Complete Claude benchmark 2026-05-22 | 27 queries, Claude | 2 of 27; left running | Partial capture only. |
| `8077b851...` Claude AI Benchmark 2026-05-30 | Fixed 27, Claude Sonnet 4 | 27 of 27 | Provisional member of the Claude-27 series. |
| `4a05da08...` Claude Search Visibility 2026-06-11 | Same fixed 27/model/prompts | 27 of 27 | Provisional comparison to May 30. |
| `c212707d...` Claude 27 one-at-a-time 2026-06-11 | Same fixed 27/model/prompts | 27 of 27 | Provisional repeat; best evidence of within-day model variance. |
| `3417c271...` OpenRouter Consumer 2026-06-17 | 31 queries, ChatGPT/Claude/plain Gemini | 93 of 93 | Complete one-off; changed panel and routed models, so not a continuation of Claude-27. |

`data/standalone-blog-writer.db` contains 12 runs and 943 result rows.

| Run | Panel / providers | Completion | Comparability decision |
|---|---|---:|---|
| `6e088f48...` June 21 priority Claude | 4 prompts | 4 of 4 | Provider-specific shard, not a full panel. |
| `3000ada2...` June 21 priority ChatGPT | 2 prompts | 2 of 2 | Provider-specific shard. |
| `6accc891...` June 21 expanded Claude | 78 prompts | 78 of 78 | Full Claude lane only. |
| `37467a63...` June 21 expanded ChatGPT | 65 prompts | 65 of 65 | Different prompt subset from Claude. |
| `82ee7a20...` June 21 expanded plain Gemini | 61 prompts | 61 of 61 | Different prompt subset from both. |
| `60e942ce...` June 29 forced RAM-vs-iBOLT Claude | 11 prompts | 11 of 11 | Forced brand mention; diagnostic, never an unaided mention benchmark. |
| `c491d4e1...` June 29 forced RAM-vs-iBOLT ChatGPT | 9 prompts | 9 of 9 | Forced brand mention and smaller subset. |
| `a406a278...` June 29 forced RAM-vs-iBOLT Gemini | 9 prompts | 9 of 9 | Forced brand mention and smaller subset. |
| `27eb5dbc...` AI Visibility 2026-07-13 | 78 queries, 4 lanes | 312 of 312 | Complete expanded-panel observation. |
| `50db89ce...` AI Visibility 2026-07-28 | Same 78 and 4 lanes | 279 completed of 312 rows | Same panel but incomplete; do not report full-run deltas without an intersection analysis or rerun. |
| `93998d83...` Top 10 Category 2026-08-05 21:35Z | Fixed 10, 4 lanes | 40 of 40 | Canonical v1 continuity baseline; provisional because version metadata was not stored yet. |
| `d807b06c...` Top 10 Category 2026-08-05 23:13Z | Exact same panel, prompts, models, lanes | 40 of 40 | Canonical v1 repeat; provisionally comparable to `93998d83...`. |

## File artifact ledger

Manual/browser captures:

- `benchmark-output/manual-ai-search-benchmark-2026-05-13.md`: multi-surface manual test with four core queries on some surfaces; useful qualitative evidence, not a fixed matrix.
- `benchmark-output/manual-ai-search-benchmark-2026-05-22.md` plus the Google JSONL, Gemini text, and Claude text captures: 27-query browser research, but Google was query-by-query while Gemini used one batch and Claude used a logged-in UI. Surface and batching differences prevent cross-provider rate comparisons.
- `benchmark-output/claude-27-one-at-a-time-20260611-154759.sse`: raw event capture for DB run `c212707d...`.
- The remaining May files are prompt candidates, category research, blog ideas, attack plans, or a generation smoke capture—not completed benchmark runs.

Completed report bundles under `content-output`:

- `ai-benchmark-2026-06-11-12-35-36`: report/export of the complete Claude-27 run.
- `openrouter-ai-benchmark-2026-06-17-17-11-06`: report/export of the complete 31-by-3 OpenRouter run. The sibling `...11-06` folder has no completed report.
- `openrouter-expanded-ai-benchmark-2026-06-21-18-43-26`: six raw provider requests over a four-prompt priority slice.
- `openrouter-expanded-ai-benchmark-2026-06-21-18-46-34`: 204 raw results across unequal 78/65/61 provider panels; useful coverage research, not one balanced matrix.
- `openrouter-expanded-ai-benchmark-2026-06-29-13-29-35`: 29 raw forced RAM-vs-iBOLT results across unequal 11/9/9 panels. Its 100% mention result is by construction.
- `top-10-category-program-2026-08-05/benchmark` and `benchmark-post-ai-pickup`: the only preserved pair with exact query, provider, prompt, model, and 40-cell completion equality.

Manifest/plan-only expanded folders (no raw-results/summary/report, therefore not runs):

- June 17: `17-30-56`, `18-26-27`, `18-27-01`.
- June 18: `14-17-11`, `14-17-39`, `15-00-29`, `15-08-05`, `15-20-02`, `17-56-14`.
- June 20: `18-39-04`, `18-40-06`, `18-40-22`, `18-40-31`, `18-40-37`, `18-40-43`.
- June 21: `18-43-01`.
- June 29: `13-12-01`, `13-12-07`, plus `ram-openrouter-benchmark-manifest-2026-06-29`.

Later research series are deliberately separate:

- `research/google-ai-mode-citations-2026-07-28`: 13 live Google AI Mode answers; current-surface citation study, not the API/provider panel.
- `research/competitive-seo-benchmark/2026-07-29` and `outputs/seo-benchmark-history-2026-07-28`: public site, sitemap, schema, web-search, and historical AI ledger workbooks. These compare site/SEO evidence, not repeated model answers.
- `research/expanded-competitor-benchmark-2026-07-29` and its workbook output: Bracketron/Tackform/category expansion; separate competitor-scope research.

## Why historical numbers diverged

1. Query panels grew from 1 to 12 to 27 to 31 to 78, then changed to 11 forced comparisons and 10 Top-10 prompts.
2. Provider names and access surfaces changed: browser UI, direct APIs, legacy aliases, OpenRouter models, and Google-search-grounded Gemini were mixed in reports.
3. Some providers received different query subsets, especially the June 21 and June 29 expanded runs.
4. Failed cells were sometimes excluded from rate denominators while run-level tables still implied a complete panel.
5. Model versions changed or were mixed inside a lane.
6. Prompt/scorer protocol versions were not persisted, and reanalysis can change scores from the same raw answer.
7. Forced brand-comparison prompts guarantee a mention and cannot measure unaided visibility.
8. The old comparator joined on query row ID and defaulted missing baselines to zero, which could manufacture deltas across portable databases or partial panels.

## Preserved baseline interpretation

The August pair is the continuity baseline, not proof of post-publication lift: it was repeated about 98 minutes later, too soon for reliable indexing effects.

- ChatGPT mention rate held at 50%; average score moved 23 to 24.
- Claude held at 0% mentions and score 6.
- Plain Gemini held at 0% mentions; average score moved 5 to 4.
- Search-grounded Gemini moved from 90% to 80% mentions, top-three rate from 30% to 50%, and score 51 to 48.
- Citation rate was 0% in every provider lane in both runs.
- The bike/handlebar query had no iBOLT mention in the second run.

Those small and internally mixed movements demonstrate response variance. The next meaningful data points are strict v1 reruns at 7 and 28 days with all 40 cells complete.
