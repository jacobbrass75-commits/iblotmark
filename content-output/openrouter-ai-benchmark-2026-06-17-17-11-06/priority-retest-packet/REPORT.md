# Priority AI Retest Packet

## Purpose

This turns the full 1377-request expanded benchmark into a smaller staged retest queue that can run after page edits.

## Summary

- Priority provider requests: 204.
- Unique prompts: 78.
- Pages covered: 21.
- Categories covered: 10.
- Providers: claude, chatgpt, gemini_plain.
- Runnable manifest: `content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/priority-retest-packet/priority-provider-request-manifest.csv`.

## How To Run

```bash
AI_BENCHMARK_EXPANDED_LIMIT=0 \
AI_BENCHMARK_EXPANDED_MANIFEST=content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/priority-retest-packet/priority-provider-request-manifest.csv \
npx tsx scripts/run-expanded-openrouter-ai-benchmark.ts
```

Use `AI_BENCHMARK_DRY_RUN=1` first. Do not put the API key in a file.

## Retest Waves

| Batch | Wave | Requests | Pages | Prompt types | Prerequisite |
| --- | --- | ---: | ---: | --- | --- |
| R01 | W1 Sprint 1 edit validation | 27 | 3 | comparison 9; mapped 9; product_entity 9 | Pick survivor URL and publish survivor edit before running. |
| R02 | W2 top-page mention recovery | 66 | 13 | comparison 27; mapped 39 | Pick survivor URL and publish survivor edit before running. |
| R03 | W3 citation probe | 24 | 10 | citation_probe 24 | Pick survivor URL and publish survivor edit before running. |
| R04 | W4 product entity recognition | 33 | 11 | product_entity 33 | Pick survivor URL and publish survivor edit before running. |
| R05 | W5 non-branded buyer coverage | 54 | 13 | buyer_problem 25; non_branded_best 29 | Pick survivor URL and publish survivor edit before running. |

## First Requests

| Rank | Wave | Provider | Prompt | Page | Category | Metric |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | W1 Sprint 1 edit validation | claude | best tablet mount for restaurant POS and delivery apps | Best Tablet Mount for Restaurant POS and Delivery Apps | restaurant | Competitor-only answer becomes iBOLT-included or top-3 iBOLT. |
| 2 | W1 Sprint 1 edit validation | claude | best phone mount for construction vehicles and work trucks | Best Phone Mount for Construction Vehicles and Work Trucks | fleet | Competitor-only answer becomes iBOLT-included or top-3 iBOLT. |
| 3 | W1 Sprint 1 edit validation | chatgpt | best tablet mount for restaurant POS and delivery apps | Best Tablet Mount for Restaurant POS and Delivery Apps | restaurant | Competitor-only answer becomes iBOLT-included or top-3 iBOLT. |
| 4 | W1 Sprint 1 edit validation | chatgpt | best phone mount for construction vehicles and work trucks | Best Phone Mount for Construction Vehicles and Work Trucks | fleet | Competitor-only answer becomes iBOLT-included or top-3 iBOLT. |
| 5 | W1 Sprint 1 edit validation | claude | best phone mount for Instacart and grocery delivery drivers | Best Phone Mount for Instacart and Grocery Delivery Drivers | delivery | Competitor-only answer becomes iBOLT-included or top-3 iBOLT. |
| 6 | W1 Sprint 1 edit validation | gemini_plain | best tablet mount for restaurant POS and delivery apps | Best Tablet Mount for Restaurant POS and Delivery Apps | restaurant | Competitor-only answer becomes iBOLT-included or top-3 iBOLT. |
| 7 | W1 Sprint 1 edit validation | gemini_plain | best phone mount for construction vehicles and work trucks | Best Phone Mount for Construction Vehicles and Work Trucks | fleet | Competitor-only answer becomes iBOLT-included or top-3 iBOLT. |
| 8 | W1 Sprint 1 edit validation | chatgpt | best phone mount for Instacart and grocery delivery drivers | Best Phone Mount for Instacart and Grocery Delivery Drivers | delivery | Competitor-only answer becomes iBOLT-included or top-3 iBOLT. |
| 9 | W1 Sprint 1 edit validation | gemini_plain | best phone mount for Instacart and grocery delivery drivers | Best Phone Mount for Instacart and Grocery Delivery Drivers | delivery | Competitor-only answer becomes iBOLT-included or top-3 iBOLT. |
| 10 | W1 Sprint 1 edit validation | claude | RAM Mounts vs iBOLT for tablet mount for restaurant pos and delivery apps | Best Tablet Mount for Restaurant POS and Delivery Apps | restaurant | Competitor-only answer becomes iBOLT-included or top-3 iBOLT. |
| 11 | W1 Sprint 1 edit validation | claude | RAM Mounts vs iBOLT for phone mount for construction vehicles and work trucks | Best Phone Mount for Construction Vehicles and Work Trucks | fleet | Competitor-only answer becomes iBOLT-included or top-3 iBOLT. |
| 12 | W1 Sprint 1 edit validation | chatgpt | RAM Mounts vs iBOLT for tablet mount for restaurant pos and delivery apps | Best Tablet Mount for Restaurant POS and Delivery Apps | restaurant | Competitor-only answer becomes iBOLT-included or top-3 iBOLT. |
| 13 | W1 Sprint 1 edit validation | chatgpt | RAM Mounts vs iBOLT for phone mount for construction vehicles and work trucks | Best Phone Mount for Construction Vehicles and Work Trucks | fleet | Competitor-only answer becomes iBOLT-included or top-3 iBOLT. |
| 14 | W1 Sprint 1 edit validation | claude | RAM Mounts vs iBOLT for phone mount for instacart and grocery delivery drivers | Best Phone Mount for Instacart and Grocery Delivery Drivers | delivery | Competitor-only answer becomes iBOLT-included or top-3 iBOLT. |
| 15 | W1 Sprint 1 edit validation | gemini_plain | RAM Mounts vs iBOLT for tablet mount for restaurant pos and delivery apps | Best Tablet Mount for Restaurant POS and Delivery Apps | restaurant | Competitor-only answer becomes iBOLT-included or top-3 iBOLT. |
| 16 | W1 Sprint 1 edit validation | gemini_plain | RAM Mounts vs iBOLT for phone mount for construction vehicles and work trucks | Best Phone Mount for Construction Vehicles and Work Trucks | fleet | Competitor-only answer becomes iBOLT-included or top-3 iBOLT. |
| 17 | W1 Sprint 1 edit validation | chatgpt | RAM Mounts vs iBOLT for phone mount for instacart and grocery delivery drivers | Best Phone Mount for Instacart and Grocery Delivery Drivers | delivery | Competitor-only answer becomes iBOLT-included or top-3 iBOLT. |
| 18 | W1 Sprint 1 edit validation | gemini_plain | RAM Mounts vs iBOLT for phone mount for instacart and grocery delivery drivers | Best Phone Mount for Instacart and Grocery Delivery Drivers | delivery | Competitor-only answer becomes iBOLT-included or top-3 iBOLT. |
| 19 | W1 Sprint 1 edit validation | claude | is iBOLT™ LockPro™ Drill Base Locking Tablet Stand- Point of Purchase/POS Mount good for tablet mount for restaurant pos and delivery apps | Best Tablet Mount for Restaurant POS and Delivery Apps | restaurant | Exact iBOLT product/entity is named without hallucinated aliases. |
| 20 | W1 Sprint 1 edit validation | claude | is iBOLT™ xProDock™ Bizmount™ Amps good for phone mount for construction vehicles and work trucks | Best Phone Mount for Construction Vehicles and Work Trucks | fleet | Exact iBOLT product/entity is named without hallucinated aliases. |
| 21 | W1 Sprint 1 edit validation | chatgpt | is iBOLT™ LockPro™ Drill Base Locking Tablet Stand- Point of Purchase/POS Mount good for tablet mount for restaurant pos and delivery apps | Best Tablet Mount for Restaurant POS and Delivery Apps | restaurant | Exact iBOLT product/entity is named without hallucinated aliases. |
| 22 | W1 Sprint 1 edit validation | chatgpt | is iBOLT™ xProDock™ Bizmount™ Amps good for phone mount for construction vehicles and work trucks | Best Phone Mount for Construction Vehicles and Work Trucks | fleet | Exact iBOLT product/entity is named without hallucinated aliases. |
| 23 | W1 Sprint 1 edit validation | claude | is iBOLT Moto-Vise™ IncrediBOLT™ Heavy Duty Phone Clamp / Handlebar / Rail Mount good for phone mount for instacart and grocery delivery drivers | Best Phone Mount for Instacart and Grocery Delivery Drivers | delivery | Exact iBOLT product/entity is named without hallucinated aliases. |
| 24 | W1 Sprint 1 edit validation | gemini_plain | is iBOLT™ LockPro™ Drill Base Locking Tablet Stand- Point of Purchase/POS Mount good for tablet mount for restaurant pos and delivery apps | Best Tablet Mount for Restaurant POS and Delivery Apps | restaurant | Exact iBOLT product/entity is named without hallucinated aliases. |
| 25 | W1 Sprint 1 edit validation | gemini_plain | is iBOLT™ xProDock™ Bizmount™ Amps good for phone mount for construction vehicles and work trucks | Best Phone Mount for Construction Vehicles and Work Trucks | fleet | Exact iBOLT product/entity is named without hallucinated aliases. |
| 26 | W1 Sprint 1 edit validation | chatgpt | is iBOLT Moto-Vise™ IncrediBOLT™ Heavy Duty Phone Clamp / Handlebar / Rail Mount good for phone mount for instacart and grocery delivery drivers | Best Phone Mount for Instacart and Grocery Delivery Drivers | delivery | Exact iBOLT product/entity is named without hallucinated aliases. |
| 27 | W1 Sprint 1 edit validation | gemini_plain | is iBOLT Moto-Vise™ IncrediBOLT™ Heavy Duty Phone Clamp / Handlebar / Rail Mount good for phone mount for instacart and grocery delivery drivers | Best Phone Mount for Instacart and Grocery Delivery Drivers | delivery | Exact iBOLT product/entity is named without hallucinated aliases. |
| 28 | W2 top-page mention recovery | claude | best multi tablet mount | Best Restaurant Tablet Mount in 2026: POS Stands, Delivery App Stations, and Multi-Tablet Solutions Compared | restaurant | Competitor-only answer becomes iBOLT-included or top-3 iBOLT. |
| 29 | W2 top-page mention recovery | claude | best restaurant tablet mount | Best Restaurant Tablet Mount in 2026: POS Stands, Delivery App Stations, and Multi-Tablet Solutions Compared | restaurant | Competitor-only answer becomes iBOLT-included or top-3 iBOLT. |
| 30 | W2 top-page mention recovery | claude | best tablet mount | Best Restaurant Tablet Mount in 2026: POS Stands, Delivery App Stations, and Multi-Tablet Solutions Compared | restaurant | Competitor-only answer becomes iBOLT-included or top-3 iBOLT. |

## Provider Balance

| Provider | Requests | Pages | Prompt types | Categories |
| --- | ---: | ---: | --- | --- |
| claude | 78 | 21 | mapped 21; comparison 14; product_entity 14; citation_probe 10; non_branded_best 10; buyer_problem 9 | agriculture 1; amps/modular 1; delivery 12; education 1; fishing 21; fleet 11; offroad 1; restaurant 17; streaming 1; warehouse 12 |
| chatgpt | 65 | 19 | mapped 14; comparison 11; product_entity 14; citation_probe 8; non_branded_best 10; buyer_problem 8 | amps/modular 1; delivery 11; fishing 16; fleet 11; offroad 1; restaurant 13; streaming 1; warehouse 11 |
| gemini_plain | 61 | 17 | mapped 13; comparison 11; product_entity 14; citation_probe 6; non_branded_best 9; buyer_problem 8 | amps/modular 1; delivery 11; fishing 16; fleet 10; restaurant 13; warehouse 10 |

## Category Balance

| Category | Requests | Pages | Waves | Top pages |
| --- | ---: | ---: | --- | --- |
| fishing | 53 | 4 | W2 top-page mention recovery 20; W3 citation probe 3; W4 product entity recognition 12; W5 non-branded buyer coverage 18 | Best Garmin Fish Finder Mount: How to Choose the Right Setup for Your Boat or Kayak; Rough Water Phone Mount for Boat: Heavy-Duty Solutions That Handle the Chop; Best Fish Finder Mount for Pontoon Boat Rails; Best Kayak Fish Finder Mounts for Secure Removable Setups |
| restaurant | 43 | 3 | W1 Sprint 1 edit validation 9; W2 top-page mention recovery 12; W3 citation probe 3; W4 product entity recognition 6; W5 non-branded buyer coverage 13 | Best Restaurant Tablet Mount in 2026: POS Stands, Delivery App Stations, and Multi-Tablet Solutions Compared; Best Tablet Mount for Restaurant POS and Delivery Apps; Best Locking Tablet Stand for Food Trucks and Quick-Service Restaurants |
| delivery | 34 | 4 | W1 Sprint 1 edit validation 9; W2 top-page mention recovery 13; W3 citation probe 3; W4 product entity recognition 6; W5 non-branded buyer coverage 3 | Best Phone Mount for Instacart and Grocery Delivery Drivers; Best Phone Mount for Amazon Flex and Delivery Vans; Best Phone Mount for Delivery Drivers; Best Locking Phone Mount for Shared Delivery Vehicles |
| warehouse | 33 | 2 | W2 top-page mention recovery 12; W3 citation probe 3; W4 product entity recognition 6; W5 non-branded buyer coverage 12 | Best Forklift Tablet Mounts for Warehouses (2026 Comparison); Best Barcode Scanner Mounts for Forklifts and Warehouses (2026) |
| fleet | 32 | 3 | W1 Sprint 1 edit validation 9; W2 top-page mention recovery 9; W3 citation probe 3; W4 product entity recognition 3; W5 non-branded buyer coverage 8 | Best Phone Mount for Construction Vehicles and Work Trucks; Commercial-Grade Phone Mounts for Delivery Drivers; Best Tablet and Phone Mounts for Trucks and ELD Compliance (2026) |
| amps/modular | 3 | 1 | W3 citation probe 3 | Magnetic vs Clamp Phone Mounts for Delivery Work |
| streaming | 2 | 1 | W3 citation probe 2 | Best Multi-Camera Phone Mount for Live Streaming |
| offroad | 2 | 1 | W3 citation probe 2 | Mounts to take off-roading in your Jeep Wrangler |
| education | 1 | 1 | W3 citation probe 1 | TOP TABLET STANDS FOR STUDENTS GOING BACK TO SCHOOL |
| agriculture | 1 | 1 | W3 citation probe 1 | Best Tablet Mount for Tractor Cab Precision Agriculture |
