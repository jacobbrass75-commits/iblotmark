# iBOLT AI Benchmark History And Readiness

## Bottom Line

The completed benchmark history has mixed surfaces, so it should not be read as a clean trendline. The most comparable current baseline is the June 17 OpenRouter run: 93 saved answers across 31 queries and chatgpt; gemini_plain; claude providers, with 24% mention rate, 16% top-3 rate, and 0% target-domain citation rate.

Search-connected/manual captures show iBOLT can be cited when Google AI Mode finds the right iBOLT pages. API-style consumer model runs still miss iBOLT heavily on generic buyer prompts. That means the next benchmark should keep the provider/query set stable and distinguish search-connected results from non-search consumer model results.

## Completed Run Ledger

| Date | Kind | Surface | Queries | Results | Mention | Citation | Top-3 | Comparable |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-05-22 | Manual Google AI Mode | google_ai_mode_browser | 27 | 27 | 59 | 63 |  | search-connected only |
| 2026-06-11 | App benchmark | claude | 27 | 27 | 7 | 70 | 4 | single-provider historical |
| 2026-06-17 | OpenRouter API | chatgpt; gemini_plain; claude | 31 | 93 | 24 | 0 | 16 | current baseline |

## Manual Google AI Mode Category Readout

| Category | Queries | Mention rate | Citation rate | Top competitors |
| --- | --- | --- | --- | --- |
| delivery | 7 | 57 | 71 | RAM 4; ProClip 2; ProClip USA 2; iOttie 2; RAM Mounts 1; Quad Lock 1; Arkon 1; Tackform 1 |
| restaurant | 7 | 71 | 71 | RAM 2; Bouncepad 2; Square 1; CTA Digital 1; Arkon 1; Mount-It 1; Tackform 1 |
| fleet | 6 | 50 | 67 | RAM 5; RAM Mounts 5; Tackform 4; iOttie 1; ROKFORM 1; Rokform 1; Arkon 1; Quad Lock 1 |
| fishing | 3 | 0 | 0 | RAM 3; Garmin 3; Lowrance 3; YakAttack 2; Railblaza 1; Humminbird 1; RAM Mounts 1; Square 1 |
| warehouse | 3 | 100 | 67 | Arkon 3; RAM 2; RAM Mounts 2; Square 2; Tackform 2; CTA Digital 2 |
| comparison | 1 | 100 | 100 | RAM 1; RAM Mounts 1 |

## Live Blog Audit Timeline

| Snapshot | Pages | OK | Failed | Avg score | Public | Fallback | Missing FAQ | Missing quick answer | Missing comparison |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-06-18T00-34-43-343Z | 142 | 113 | 29 | 73 | 93 | 20 | 95 | 88 | 52 |
| 2026-06-18T02-05-49-531Z | 142 | 113 | 29 | 73 | 94 | 19 | 95 | 88 | 52 |
| 2026-06-18T03-51-44-273Z | 142 | 113 | 29 | 73 | 94 | 19 | 95 | 88 | 52 |
| 2026-06-18T03-53-47-265Z | 142 | 142 | 0 | 75 | 123 | 19 | 99 | 113 | 55 |
| 2026-06-18T03-54-14-604Z | 142 | 142 | 0 | 75 | 123 | 19 | 99 | 113 | 55 |

## Expanded Benchmark Readiness

| Snapshot | Prompts | Provider requests | Status | Top categories | Prompt sources |
| --- | --- | --- | --- | --- | --- |
| 2026-06-17-17-30-56 | 24 | 72 | dry run only | fleet 6; restaurant 6; fishing 5; delivery 5; warehouse 1; tablet 1 | current_visibility_gap 21; unbranded_existing_topic 3 |
| 2026-06-17-18-26-27 | 36 | 108 | dry run only | fleet 10; restaurant 10; fishing 7; delivery 7; warehouse 1; tablet 1 | current_visibility_gap 21; unbranded_existing_topic 11; consumer_buyer_prompt 4 |
| 2026-06-17-18-27-01 | 207 | 621 | dry run only | fleet 42; fishing 36; restaurant 31; delivery 23; warehouse 15; amps/modular 13; streaming 11; offroad 8 | blog_inventory_title 56; consumer_buyer_prompt 37; curated_vertical_gap 35; current_visibility_gap 21; conversational_gap_variant 21; unbranded_existing_topic 13; competitor_displacement 12; head_to_head_comparison 12 |
| 2026-06-18-14-17-11 | 36 | 108 | dry run only | fishing 12; restaurant 11; delivery 5; warehouse 4; fleet 4 | mapped_existing_prompt 20; competitor_comparison_prompt 8; product_entity_prompt 2; page_title_nonbranded 2; buyer_problem_prompt 2; citation_probe_prompt 2 |
| 2026-06-18-14-17-39 | 459 | 1377 | dry run only | amps/modular 82; fleet 79; restaurant 60; fishing 57; warehouse 57; streaming 49; delivery 42; education 13 | competitor_comparison_prompt 135; buyer_problem_prompt 133; page_title_nonbranded 124; mapped_existing_prompt 31; product_entity_prompt 26; citation_probe_prompt 10 |
| 2026-06-18-15-00-29 | 78 | 234 | dry run only | fishing 21; restaurant 17; delivery 12; warehouse 12; fleet 11; amps/modular 1; streaming 1; offroad 1 | mapped_existing_prompt 21; competitor_comparison_prompt 14; product_entity_prompt 14; page_title_nonbranded 10; citation_probe_prompt 10; buyer_problem_prompt 9 |
| 2026-06-18-15-08-05 | 78 | 204 | dry run only | fishing 21; restaurant 17; delivery 12; warehouse 12; fleet 11; amps/modular 1; streaming 1; offroad 1 | mapped_existing_prompt 21; competitor_comparison_prompt 14; product_entity_prompt 14; page_title_nonbranded 10; citation_probe_prompt 10; buyer_problem_prompt 9 |
| 2026-06-18-15-20-02 | 78 | 204 | dry run only | fishing 21; restaurant 17; delivery 12; warehouse 12; fleet 11; amps/modular 1; streaming 1; offroad 1 | mapped_existing_prompt 21; competitor_comparison_prompt 14; product_entity_prompt 14; page_title_nonbranded 10; citation_probe_prompt 10; buyer_problem_prompt 9 |
| 2026-06-18-17-56-14 | 483 | 1449 | dry run only | amps/modular 90; fleet 87; restaurant 64; fishing 61; warehouse 57; streaming 49; delivery 42; education 13 | competitor_comparison_prompt 135; buyer_problem_prompt 133; page_title_nonbranded 124; mapped_existing_prompt 31; product_entity_prompt 26; all_blog_prompt_gap_addendum 24; citation_probe_prompt 10 |
| 2026-06-20-18-39-04 | 9 | 27 | dry run only | fleet 3; restaurant 3; delivery 3 | mapped_existing_prompt 3; competitor_comparison_prompt 3; product_entity_prompt 3 |
| 2026-06-20-18-40-06 | 19 | 54 | dry run only | fishing 6; restaurant 5; warehouse 4; fleet 3; delivery 1 | page_title_nonbranded 10; buyer_problem_prompt 9 |
| 2026-06-20-18-40-22 | 29 | 66 | dry run only | fishing 10; restaurant 6; warehouse 5; delivery 5; fleet 3 | mapped_existing_prompt 18; competitor_comparison_prompt 11 |
| 2026-06-20-18-40-31 | 10 | 24 | dry run only | restaurant 1; fishing 1; fleet 1; delivery 1; warehouse 1; amps/modular 1; streaming 1; offroad 1 | citation_probe_prompt 10 |
| 2026-06-20-18-40-37 | 11 | 33 | dry run only | fishing 4; restaurant 2; warehouse 2; delivery 2; fleet 1 | product_entity_prompt 11 |
| 2026-06-20-18-40-43 | 19 | 54 | dry run only | fishing 6; restaurant 5; warehouse 4; fleet 3; delivery 1 | page_title_nonbranded 10; buyer_problem_prompt 9 |
| 2026-06-21-18-43-01 | 4 | 6 | dry run only | streaming 1; offroad 1; education 1; agriculture 1 | citation_probe_prompt 4 |
| 2026-06-21-18-43-26 | 4 | 6 | dry run only | streaming 1; offroad 1; education 1; agriculture 1 | citation_probe_prompt 4 |
| 2026-06-21-18-46-34 | 78 | 204 | dry run only | fishing 21; restaurant 17; delivery 12; warehouse 12; fleet 11; amps/modular 1; streaming 1; offroad 1 | mapped_existing_prompt 21; competitor_comparison_prompt 14; product_entity_prompt 14; page_title_nonbranded 10; citation_probe_prompt 10; buyer_problem_prompt 9 |

## Interpretation

- Use the June 17 OpenRouter run as the stable baseline for ChatGPT, Claude, and Gemini API-style consumer models.
- Use the May 22 Google AI Mode manual capture as proof that search-connected AI can cite iBOLT when the right pages are retrievable.
- Do not blend the 70% Claude citation rate from June 11 with the June 17 OpenRouter citation rate as a direct trend. The source behavior and benchmark surface are different.
- The latest expanded benchmark is ready as a 78-prompt, 204-request run, but it has not executed live because the OpenRouter key is not present in this shell.
