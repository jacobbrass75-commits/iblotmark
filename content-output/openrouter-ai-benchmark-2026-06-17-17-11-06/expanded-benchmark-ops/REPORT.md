# Expanded Benchmark Operations Report

This report prepares the remaining live benchmark without exposing or storing any API key. It turns the 207-prompt backlog into provider-level requests, run batches, category coverage, and post-refresh retest targets.

## Summary

- Expanded prompts: 207
- Providers: chatgpt, gemini_plain, claude
- Total one-at-a-time provider requests: 621
- Batches at 20 prompts each: 11
- Prompts tied to refresh/canonical review work: 63
- Prompts without a mapped post: 59
- Source prompt file: /Users/yakub/Desktop/iblotmark/content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/deep-dive/expanded-benchmark-prompts.csv
- Dry-run folder: /Users/yakub/Desktop/iblotmark/content-output/openrouter-expanded-ai-benchmark-2026-06-17-18-27-01

## Run Batches

| Batch | Prompts | Requests | Priority range | Categories | Sources | Purpose |
| --- | --- | --- | --- | --- | --- | --- |
| B01 | 20 | 60 | 96-96 | delivery 5; fishing 5; restaurant 5; fleet 4; tablet 1 | current_visibility_gap 20 | Baseline the worst current zero-mention or low-score prompts. |
| B02 | 20 | 60 | 92-96 | delivery 8; restaurant 5; fleet 4; fishing 2; warehouse 1 | unbranded_existing_topic 11; conversational_gap_variant 5; consumer_buyer_prompt 3; current_visibility_gap 1 | Baseline the worst current zero-mention or low-score prompts. |
| B03 | 20 | 60 | 92-92 | fishing 13; fleet 7 | consumer_buyer_prompt 14; conversational_gap_variant 6 | Test realistic commercial buyer questions across normal consumer models. |
| B04 | 20 | 60 | 90-92 | restaurant 9; amps/modular 4; fleet 3; cycling 2; tablet 1; warehouse 1 | conversational_gap_variant 10; curated_vertical_gap 6; consumer_buyer_prompt 4 | Test realistic commercial buyer questions across normal consumer models. |
| B05 | 20 | 60 | 90-90 | delivery 6; fishing 6; fleet 5; cycling 3 | blog_inventory_title 17; curated_vertical_gap 3 | Check whether existing blog inventory is turning into model memory or recommendations. |
| B06 | 20 | 60 | 90-90 | fleet 13; kitchen/home 5; restaurant 2 | blog_inventory_title 15; curated_vertical_gap 5 | Check whether existing blog inventory is turning into model memory or recommendations. |
| B07 | 20 | 60 | 88-90 | restaurant 8; travel 5; streaming 4; delivery 2; fishing 1 | curated_vertical_gap 9; blog_inventory_title 8; competitor_displacement 3 | Measure whether iBOLT enters competitor consideration sets. |
| B08 | 20 | 60 | 86-88 | fishing 9; fleet 6; delivery 2; amps/modular 1; restaurant 1; warehouse 1 | head_to_head_comparison 10; competitor_displacement 9; unbranded_existing_topic 1 | Measure whether iBOLT enters competitor consideration sets. |
| B09 | 20 | 60 | 82-86 | amps/modular 8; streaming 5; warehouse 5; cycling 1; restaurant 1 | consumer_buyer_prompt 10; blog_inventory_title 7; head_to_head_comparison 2; unbranded_existing_topic 1 | Measure whether iBOLT enters competitor consideration sets. |
| B10 | 20 | 60 | 78-82 | warehouse 7; agriculture 4; education 4; offroad 3; streaming 2 | curated_vertical_gap 11; blog_inventory_title 9 | Check whether existing blog inventory is turning into model memory or recommendations. |
| B11 | 7 | 21 | 72-78 | offroad 5; education 2 | consumer_buyer_prompt 6; curated_vertical_gap 1 | Test realistic commercial buyer questions across normal consumer models. |

## Category Coverage

| Category | Prompts | Requests | Current gaps | Competitor prompts | Mapped pages | Refresh before retest | Top sources |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fleet | 42 | 126 | 4 | 6 | 27 | 14 | blog_inventory_title 18; consumer_buyer_prompt 6; conversational_gap_variant 4; current_visibility_gap 4 |
| fishing | 36 | 108 | 5 | 10 | 16 | 14 | consumer_buyer_prompt 10; blog_inventory_title 6; competitor_displacement 5; conversational_gap_variant 5 |
| restaurant | 31 | 93 | 5 | 2 | 16 | 15 | blog_inventory_title 10; conversational_gap_variant 5; current_visibility_gap 5; unbranded_existing_topic 5 |
| delivery | 23 | 69 | 5 | 4 | 12 | 14 | blog_inventory_title 6; conversational_gap_variant 5; current_visibility_gap 5; competitor_displacement 2 |
| warehouse | 15 | 45 | 1 | 2 | 11 | 3 | blog_inventory_title 7; consumer_buyer_prompt 3; competitor_displacement 1; conversational_gap_variant 1 |
| amps/modular | 13 | 39 | 0 | 0 | 8 | 1 | blog_inventory_title 6; curated_vertical_gap 4; consumer_buyer_prompt 2; unbranded_existing_topic 1 |
| streaming | 11 | 33 | 0 | 0 | 7 | 0 | consumer_buyer_prompt 4; curated_vertical_gap 4; blog_inventory_title 3 |
| offroad | 8 | 24 | 0 | 0 | 4 | 0 | consumer_buyer_prompt 4; curated_vertical_gap 4 |
| cycling | 6 | 18 | 0 | 0 | 1 | 0 | curated_vertical_gap 5; consumer_buyer_prompt 1 |
| education | 6 | 18 | 0 | 0 | 2 | 0 | curated_vertical_gap 4; consumer_buyer_prompt 2 |
| kitchen/home | 5 | 15 | 0 | 0 | 0 | 0 | curated_vertical_gap 5 |
| travel | 5 | 15 | 0 | 0 | 0 | 0 | curated_vertical_gap 5 |

## Source Mix

| Source | Prompts | Requests | Top categories |
| --- | --- | --- | --- |
| blog_inventory_title | 56 | 168 | fleet 18; restaurant 10; warehouse 7; amps/modular 6; delivery 6; fishing 6 |
| consumer_buyer_prompt | 37 | 111 | fishing 10; fleet 6; offroad 4; restaurant 4; streaming 4; warehouse 3 |
| curated_vertical_gap | 35 | 105 | cycling 5; kitchen/home 5; travel 5; agriculture 4; amps/modular 4; education 4 |
| conversational_gap_variant | 21 | 63 | delivery 5; fishing 5; restaurant 5; fleet 4; tablet 1; warehouse 1 |
| current_visibility_gap | 21 | 63 | delivery 5; fishing 5; restaurant 5; fleet 4; tablet 1; warehouse 1 |
| unbranded_existing_topic | 13 | 39 | restaurant 5; fleet 4; delivery 2; amps/modular 1; warehouse 1 |
| competitor_displacement | 12 | 36 | fishing 5; fleet 3; delivery 2; restaurant 1; warehouse 1 |
| head_to_head_comparison | 12 | 36 | fishing 5; fleet 3; delivery 2; restaurant 1; warehouse 1 |

## Post-Retest Targets

| Post | Prompts | Requests | Categories | Refresh state | Products / fixes |
| --- | --- | --- | --- | --- | --- |
| Best Garmin Fish Finder Mount: How to Choose the Right Setup for Your Boat or Kayak | 7 | 21 | fishing | refresh_then_retest | iBOLT™ 25mm / 1 inch Ball Composite Universal Marine Fish Finder Mounting Plate; iBOLT™ 38mm / 1.5 inch Ball Composite Universal Marine Fish Finder Mounting Plate; iBOLT Garmin Striker 4 / Fish Finder Handlebar; Rail Mount; iBOLT Garmin Striker 4 / Fish Finder Dual Arm Handlebar; +3 more |
| Best Restaurant Tablet Mount in 2026: POS Stands, Delivery App Stations, and Multi-Tablet Solutions Compared | 7 | 21 | restaurant; tablet | refresh_then_retest | iBOLT™ 20mm Metal Ball Suction Cup Base; iBOLT™ 20mm to 4 Prong Composite Ball Adapter; iBOLT Dock'n Lock IncrediBOLT™ 360 AMPS Locking Tablet Mount; iBOLT Dock’n Lock IncrediBOLT™ AMPS w/ 2” Single Socket Arm Locking Tablet Drill Base Mount; iBOLT TabDock IncrediBOLT 360 Heavy Duty Dual Suction Cup Mount; +1 more |
| Barcode Scanner Mounts | 3 | 9 | warehouse; amps/modular | refresh_then_retest | iBOLT XL Forklift Barcode Scanner Holder 38mm Mount; iBOLT XL Barcode Scanner triMag Low-Profile Strong Magnetic Mount; iBOLT XL Barcode Scanner BizMount Magnetic Mount; iBOLT XL Barcode Scanner IncrediBOLT 360 Magnetic Mount; iBOLT Dock’n Lock Bizmount™- Forklift Locking Tablet 38mm Mount; +1 more |
| Best Fish Finder Mount for Small Boats: Comparison and Buyer's Guide | 3 | 9 | fishing | canonical_review_before_retest | iBOLT Universal Marine Fish Finder IncrediBOLT™ Clamp / Handlebar/ Rail Mount; iBOLT Garmin Striker 4 / Fish Finder IncrediBOLT™ 360 Clamp / Handlebar / Rail Mount; iBOLT Garmin Striker 4 / Fish Finder Handlebar; Rail Mount; iBOLT Garmin Striker 4 / Fish Finder Dual Arm Handlebar; +3 more |
| Best Locking Tablet Stand for Food Trucks and Quick-Service Restaurants | 3 | 9 | restaurant | canonical_review_before_retest | iBOLT™ LockPro™ Drill Base Locking Tablet Stand- Point of Purchase/POS Mount; iBOLT Dock’n Lock Drill Base Locking Tablet Stand; iBOLT™ LockPro™ Metal Locking Tablet Drill Base Mount; iBOLT 25mm / 1 inch Composite AMPS Adapter Plate; iBOLT 25mm / 1 inch to Dual 17mm Metal Ball Adapter; +1 more |
| Best Tablet and Phone Mounts for Trucks and ELD Compliance (2026) | 3 | 9 | fleet | refresh_then_retest | iBOLT TabDock™ IncrediBOLT™ 360 Suction- Heavy Duty Metal 6 inch Multi-Angle Mount for All 7" - 10" Tablets for Commercial Vehicles; Trucks; and ELD Devices; iBOLT TabDock IncrediBOLT 360 Heavy Duty Triple Suction Cup Mount; iBOLT Dock'n Lock IncrediBOLT™ 360 AMPS Locking Tablet Mount; +3 more |
| Choosing the Best Kayak Fish Finder Mount for Secure and Convenient Fishing | 3 | 9 | fishing | refresh_then_retest | iBOLT Universal Marine & Electronics Mounting Plate; iBOLT Universal Marine Fish Finder IncrediBOLT™ Clamp / Handlebar/ Rail Mount; iBOLT™ 25mm / 1 inch Composite Universal Marine Electronic Fish Finder Drill Base Mount; iBOLT™ 25mm / 1 inch Ball Composite Universal Marine Fish Finder Mounting Plate; iBOLT™ 38mm / 1.5 inch Ball Composite Universal Marine Fish Finder Mounting Plate; +1 more |
| Commercial-Grade Phone Mounts for Delivery Drivers | 3 | 9 | delivery; fleet | canonical_review_before_retest | iBOLT™ xProDock™ Bizmount™ Amps; iBOLT Phone Dock’n Lock IncrediBOLT™ AMPS w/ 4.25” Arm Locking Drill Base Mount for Smartphones; iBOLT™ xProDock™ NFC BizMount™ Suction Cup; iBOLT™ 20mm Metal Ball Suction Cup Base; iBOLT 20mm Metal Ball to Headrest Mounting Bracket; +1 more |
| How to Set Up Multiple Tablets for DoorDash, Uber Eats, and Grubhub | 3 | 9 | restaurant; delivery | refresh_then_retest | iBOLT™ Tablet Tower- TabDock™ POS Clamp Mount - with 3 Tablet Holders; iBOLT Tablet Tower- TabDock™ POS Clamp Mount - with 4 Tablet Holders; iBOLT Tablet Tower- TabDock™ POS Wall Mount - with 3 Tablet Holders; iBOLT 25mm / 1 inch Composite AMPS Adapter Plate; iBOLT 25mm / 1 inch to Dual 17mm Metal Ball Adapter; +1 more |
| Rough Water Phone Mount for Boat: Heavy-Duty Solutions That Handle the Chop | 3 | 9 | fleet; fishing | refresh_then_retest | iBOLT 17mm Dual Ball to “Sticky” Suction Cup Mount Base compatible w/ Garmin GPS and iBOLT Phone Holders; iBOLT™ 17mm Clamp Mount for Handlebars; Poles; Posts; iBOLT 17mm Dual Ball Clamp Mount for Handlebars; +7 more |
| Best Locking Phone Mount for Shared Delivery Vehicles | 2 | 6 | delivery | canonical_review_before_retest | iBOLT Phone Dock'n Lock IncrediBOLT™ 360- Locking Phone Multi-Angle Drill Base Mount; iBOLT Phone Dock’n Lock IncrediBOLT™ AMPS w/ 4.25” Arm Locking Drill Base Mount for Smartphones; iBOLT Phone Dock'n Lock 2" IncrediBOLT™ AMPS Drill Base Mount; iBOLT™ 20mm Metal Ball Suction Cup Base; iBOLT 20mm Metal Ball to Headrest Mounting Bracket; +1 more |
| Best Phone Mount for Amazon Flex and Delivery Vans | 2 | 6 | delivery | canonical_review_before_retest | iBOLT™ xProDock™ NFC BizMount™ Suction Cup; iBOLT™ xProDock™ Bizmount™ Wedge; iBOLT™ xProDock™ Bizmount™ Amps; iBOLT™ 20mm Metal Ball Suction Cup Base; iBOLT 20mm Metal Ball to Headrest Mounting Bracket; +1 more |
| Best Phone Mount for Construction Vehicles and Work Trucks | 2 | 6 | fleet | canonical_review_before_retest | iBOLT™ xProDock™ Bizmount™ Amps; iBOLT Phone Dock’n Lock IncrediBOLT™ AMPS w/ 4.25” Arm Locking Drill Base Mount for Smartphones; iBOLT Phone Dock'n Lock 2" IncrediBOLT™ AMPS Drill Base Mount; iBOLT Moto-Vise™ XL Holder w/ 25mm / 1-inch Ball; iBOLT™ Fixed Install Charger- 30W 2-Port Quick Charge 3.0 and Standard USB-A; +1 more |
| Best Phone Mount for Delivery Drivers | 2 | 6 | fleet | canonical_review_before_retest | iBOLT™ xProDock™ NFC BizMount™ Suction Cup; iBOLT™ xProDock™ Bizmount™ Wedge; iBOLT™ xProDock™ Bizmount™ Console- Phone Cup Holder Mount; iBOLT Dock’n Lock POS Phone Stand; iBOLT Dock’n Lock POS Tablet Stand; +1 more |
| Best Phone Mount for Instacart and Grocery Delivery Drivers | 2 | 6 | delivery | canonical_review_before_retest | iBOLT Moto-Vise™ IncrediBOLT™ Heavy Duty Phone Clamp / Handlebar / Rail Mount; iBOLT 22mm ExtendiBOLT Triple Suction Cup Mount; iBOLT Moto-Vise™ Heavy Duty Phone Dual Arm Handlebar / Rail Mount; iBOLT Moto-Vise™ Heavy Duty Phone Handlebar / Rail Mount; iBOLT Moto-Vise™ IncrediBOLT™ 360 Heavy Duty Phone Clamp / Handlebar / Rail Mount; +1 more |

## Execution Rule

Use the app's existing expanded benchmark runner only after setting `OPENROUTER_API_KEY` in the local shell. Keep `AI_BENCHMARK_EXPANDED_LIMIT=0` to run all 207 prompts, and keep the provider set to ChatGPT, Gemini plain, and Claude so the test reflects normal consumer-accessible model behavior.
