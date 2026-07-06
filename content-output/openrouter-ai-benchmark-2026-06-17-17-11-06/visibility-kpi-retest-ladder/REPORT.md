# AI Visibility KPI Retest Ladder

## Bottom Line

The next benchmark needs hard pass/fail counts. Current baseline is 24% mention, 5% non-branded mention, 16% top-3, 0% citation, and 73% competitor-only. The next target is not abstract: iBOLT needs 11 additional mentions, 9 additional top-3 recommendations, 8 additional non-branded mentions, and 8 citations on the saved 93-answer baseline.

Live retest is not run yet because OPENROUTER_API_KEY is missing in this shell.

## KPI Count Targets

| Metric | Current | Denom | Current % | Target % | Target count | Lift needed | Why |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Mention rate | 22 | 93 | 24 | 35 | 33 | 11 | Baseline inclusion. AI cannot cite or recommend iBOLT if it does not mention iBOLT first. |
| Non-branded mention | 4 | 75 | 5 | 15 | 12 | 8 | New-customer visibility. These are buyer questions that do not already name iBOLT. |
| Top-3 recommendation | 15 | 93 | 16 | 25 | 24 | 9 | Recommendation strength. Mentioned at the bottom is weaker than included in the recommendation set. |
| Citation rate | 0 | 93 | 0 | 8 | 8 | 8 | Source trust for search-connected AI, AI Overviews, Perplexity, Gemini with search, and shopping assistants. |
| Competitor-only answer rate | 68 | 93 | 73 | 55 | 52 | 16 | Displacement. This should go down as mention and top-3 rates rise. |

## Retest Wave Gates

| Batch | Wave | Requests | Prompts | Pages | Pass gate |
| --- | --- | --- | --- | --- | --- |
| R01 | W1 Sprint 1 edit validation | 27 | 9 | 3 | At least 10 iBOLT-included answers, at least 7 top-3 answers, and no more than 14 competitor-only answers. |
| R02 | W2 top-page mention recovery | 66 | 29 | 13 | At least 24 iBOLT-included answers, at least 17 top-3 answers, and no more than 36 competitor-only answers. |
| R03 | W3 citation probe | 24 | 10 | 10 | At least 3 target-domain citations or source-url rows. |
| R04 | W4 product entity recognition | 33 | 11 | 11 | At least 12 exact iBOLT product/entity mentions without hallucinated aliases. |
| R05 | W5 non-branded buyer coverage | 54 | 19 | 13 | At least 19 iBOLT-included answers, at least 14 top-3 answers, and no more than 29 competitor-only answers. |

## Category Targets

| Category | Priority | Queries | Mention lift | Top-3 lift | Competitors | Move |
| --- | --- | --- | --- | --- | --- | --- |
| delivery | 1050 | 7 | 2 | 2 | RAM Mounts 13; iOttie 12; Garmin 8; Arkon 6; ProClip 6; Scosche 4; Belkin 2; Peak Design 2 | Lead with commercial delivery phone mounting, shared-route durability, suction/drill-base choices, xProDock/Dock'n Lock names, and a fair RAM Mounts comparison. |
| restaurant | 1028 | 8 | 2 | 1 | RAM Mounts 19; Garmin 15; Mount-It 14; Arkon 13; CTA Digital 10; Square 9; Bouncepad 8; Heckler 4 | Lead with multi-tablet restaurant workflow proof: Tablet Tower, LockPro, Dock'n Lock, delivery app stations, keyed security, and a fair RAM Mounts comparison. |
| fleet | 1020 | 6 | 3 | 2 | RAM Mounts 19; Garmin 16; Arkon 11; ProClip 9; iOttie 7; Tackform 6; Scosche 3; Square 2 | Lead with fleet-standard install repeatability, ELD/tablet fit, AMPS plates, drill bases, charging, and a fair RAM Mounts comparison. |
| fishing | 841 | 5 | 6 | 4 | Garmin 17; RAM Mounts 17; Humminbird 8; Lowrance 8; Scotty 8; YakAttack 8; Arkon 2; iOttie 2 | Lead with marine electronics fit, Garmin/Lowrance/Humminbird context, rail/clamp/drill installs, 25mm/38mm ball options, and rough-water stability. |
| warehouse | 763 | 3 | 2 | 2 | Garmin 17; RAM Mounts 14; Square 6; Arkon 5; Havis 5; ProClip 4; Zebra 4; Bouncepad 3 | Lead with forklift tablet and barcode scanner workflows, no-drill cage/pillar options, vibration resistance, Zebra/Honeywell context, and a fair RAM Mounts or Havis comparison. |
| amps/modular | 713 | 0 | 2 | 1 | Garmin 26; RAM Mounts 7; Square 3; Arkon 2; iOttie 2; ProClip 2; Tackform 2; Belkin 1 | Lead with AMPS pattern clarity, ball-size compatibility, part-to-part modularity, configurator paths, and exact plate/base/arm examples. |
| streaming | 524 | 0 | 2 | 1 | Garmin 15; RAM Mounts 2; Tackform 1 | Add a concise answer-first block, named product module, fair comparison language, FAQ/article schema, and a retest prompt tied to the buyer query. |
| education | 453 | 0 | 2 | 1 | Garmin 4; iOttie 1 | Add a concise answer-first block, named product module, fair comparison language, FAQ/article schema, and a retest prompt tied to the buyer query. |
| agriculture | 425 | 0 | 2 | 1 | Garmin 2 | Add a concise answer-first block, named product module, fair comparison language, FAQ/article schema, and a retest prompt tied to the buyer query. |
| offroad | 414 | 0 | 2 | 1 | Garmin 4; RAM Mounts 3; ProClip 1; Tackform 1 | Add a concise answer-first block, named product module, fair comparison language, FAQ/article schema, and a retest prompt tied to the buyer query. |

## Intent Targets

| Intent | Priority | Baseline queries | Priority requests | Mention lift | Top-3 lift | Move |
| --- | --- | --- | --- | --- | --- | --- |
| best/recommendation | 2621 | 22 | 71 | 20 | 16 | Add answer-first blocks that directly name iBOLT, the best-fit product family, ideal buyer, and why it belongs in the recommendation set. |
| category discovery | 255 | 1 | 0 | 2 | 1 | Create clearer category answer blocks and map the prompt to the closest live page before retesting. |
| setup/how-to | 238 | 1 | 9 | 2 | 1 | Add installation steps, mount pattern/ball-size clarity, compatibility notes, and HowTo-style structure where appropriate. |
| competitor comparison | 212 | 5 | 36 | 0 | 0 | Add fair comparison sections beside RAM, Arkon, iOttie, CTA Digital, ProClip, or Mount-It without budget framing. |
| product recall | 84 | 0 | 42 | 2 | 1 | Add exact product names, model/fit details, specs, product modules, and internal links from the relevant guide to the product page. |
| citation/source | 48 | 0 | 24 | 2 | 1 | After page edits, add FAQ/Article/Product schema, concise source-ready answer blocks, and off-site citations to the exact page. |
| shopping advice | 44 | 0 | 22 | 2 | 1 | Add decision trees by use case, surface one primary recommendation, and keep product modules clear without repeated cart CTAs. |
| brand/direct | 0 | 2 | 0 | 0 | 0 | Make branded pages reinforce iBOLT's specialist position: 300+ modular parts, AMPS compatibility, industrial materials, and workflow-specific kits. |
