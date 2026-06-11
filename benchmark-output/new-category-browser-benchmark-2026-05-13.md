# New Category AI Visibility Benchmark

Date: 2026-05-13

Source of truth: browser-based Computer Use runs in logged-in consumer UIs. This file summarizes observed model output from ChatGPT Pro, Claude Sonnet 4.6 with web search, and Gemini with Google Search. Rankings are directional because AI answers vary by location, personalization, shopping modules, and retrieval timing.

## Executive Read

The new 20-prompt expansion is mostly white space for iBOLT. ChatGPT saw iBOLT in 7 of 20 prompts; Claude saw stronger or marginal presence in 8 of 20; Gemini was more generous, seeing yes/marginal presence in 13 of 20. Treat Gemini's higher scores cautiously: it named some generic or fuzzy iBOLT product labels, but its direction still confirms that iBOLT is strongest in forklift VESA, school/fleet-adjacent tablet mounts, marine AMPS, creator mounts, and multi-camera streaming. All three platforms agree that Jeep/off-road, agriculture, kayak fishing, fitness, and several recreation-specific searches are weak or competitor-owned.

## Browser Benchmark Summary

| # | Query | ChatGPT Pro | Claude Web | Gemini + Search | Current Read |
|---:|---|---|---|---|---|
| 1 | best VESA monitor mount for forklift | Present, rank 2 | Present, approx. rank 2 | Present, rank 1 to 2 | Strong. Publish candidate, push past Arkon/RAM with comparison and proof. |
| 2 | best rugged tablet mount for field service vans | Not present | Marginal, rank 5 to 6 | Marginal, rank 5+ | Content gap. Needs field-service van landing/post and product proof. |
| 3 | best tablet mount for utility truck crews | Present, rank 5 | Marginal, rank 5 | Not present | Existing visibility is dated/generic. Fix-first post. |
| 4 | best locking tablet mount for classrooms | Present, rank 5 | Present, approx. rank 2 | Marginal, rank 4 | Strong enough to publish after anti-theft/spec review. |
| 5 | best tablet mount for school bus or transportation fleet | Present, rank 3 | Not present | Present, rank 3 | Disagreement. Hold because safety/install proof is weak. |
| 6 | best tablet mount for tractor cab precision agriculture | Not present | Not present | Not present | Product/fitment gap. Hold pending tractor-cab proof. |
| 7 | best Garmin Striker 4 mount for kayak fishing | Not present | Not present | Not present | Product exists but kayak-specific retrieval missing. Publish candidate only with device-specific proof. |
| 8 | best fish finder mount for pontoon boat rail | Not present | Present, approx. rank 3 | Not present | Fix-first. Add pontoon rail diameter/use-case proof. |
| 9 | best marine electronics AMPS mounting plate | Present, rank 4 | Not present | Present, rank 2 | Technical content gap. Publish candidate with exact plate patterns. |
| 10 | best boat phone mount for rough water | Not present | Marginal, Amazon-only | Marginal, rank 6 | Hold. Needs saltwater/rough-water proof before claims. |
| 11 | best phone mount for Jeep Wrangler off road trails | Not present | Not present | Not present | High-opportunity product/content gap. Hold until fitment proof. |
| 12 | best tablet mount for overlanding navigation | Not present | Marginal, rank 4 via third-party blog | Present, rank 4 | Fix-first. Strong content opportunity. |
| 13 | best GoPro mount for UTV roll bar | Not present | Not present | Marginal, rank 5 | Fix-first. Needs UTV/roll-bar diameter content and exact product naming. |
| 14 | best overhead phone mount for cooking videos | Not present | Not present | Present, rank 1 to 3 | Fix-first. Stream-Cast exists, but ChatGPT/Claude did not retrieve it. |
| 15 | best overhead camera rig for product photography | Not present | Not present | Marginal, rank 4 | Fix-first. Stream-Cast exists but studio/product-photo language is weak. |
| 16 | best multi camera phone mount for live streaming | Present, rank 1 | Present, approx. rank 3 | Present, rank 2 | Strongest creator category. Publish/refresh to defend. |
| 17 | best tablet mount for trade show kiosk booth | Not present | Not present | Marginal, rank 5 | Fix-first. Good B2B fit, no durable query ownership. |
| 18 | best Nintendo Switch headrest mount for road trips | Not present | Present, approx. rank 2 to 3 | Marginal, rank 3 | Fix-first. Product exists, exact query/title language needed. |
| 19 | best phone mount for exercise bike or treadmill | Not present | Not present | Not present | Fix-first. Likely fast content win if product fit is verified. |
| 20 | best wheelchair tablet mount for communication device | Present, rank 2 | Not present | Marginal, rank 4 | Sensitive category. Fix-first with manual AAC/accessibility review. |

## Draft Generation Status

All 20 local review drafts were regenerated in the app database after the audit pass. The current fallback generator strips internal process copy, links 3 visible products per article, populates verification scores, and records publish/fix/hold decisions in `verification_notes`.

| Decision | Count | Drafts |
|---|---:|---|
| Publish candidate | 5 | VESA forklift monitor, classroom locking tablet, Garmin Striker 4 kayak, marine AMPS plate, multi-camera live streaming |
| Fix-first | 11 | field service vans, utility truck crews, pontoon fish finder, overlanding navigation, GoPro UTV, cooking videos, product photography, trade-show kiosk, Switch headrest, exercise bike/treadmill, wheelchair communication device |
| Hold | 4 | school bus transportation fleet, tractor cab precision agriculture, boat phone mount for rough water, Jeep Wrangler off-road trails |

## ChatGPT Pro Execution Plan

Captured in browser from the logged-in ChatGPT Pro thread after feeding it the benchmark table, local draft status, and product-proof constraints.

Operating rule: generated posts are local review drafts, not live Shopify posts. Publish only where the product or collection proof is already strong. For fix-first items, update the product or collection proof page first, then publish the draft and link into that proof. For hold items, keep the draft local until product fit can be proven without stretching the catalog.

| Priority | Draft query | ChatGPT Pro action | Why |
|---:|---|---|---|
| 1 | best multi camera phone mount for live streaming | Publish now | iBOLT already ranked #1 and has clear 3-camera / Stream-Cast proof. Defend the win. |
| 2 | best VESA monitor mount for forklift | Publish now | Strong B2B fit, rank 2 visibility, and clear VESA forklift monitor product proof. |
| 3 | best wheelchair tablet mount for communication device | Publish now with manual review | Strong niche fit and rank 2 visibility, but AAC/accessibility language needs careful review. |
| 4 | best Garmin Striker 4 mount for kayak fishing | Publish now if product page names the device/use case | iBOLT was absent, but exact product proof appears unusually specific and creates a tight long-tail opening. |
| 5 | best marine electronics AMPS mounting plate | Publish now | iBOLT appeared at rank 4 and has AMPS plates/adapters/backing plates. Product-card/schema work can move this. |
| 6 | best locking tablet mount for classrooms | Publish now after anti-theft/spec pass | iBOLT appeared but weakly; LockPro and Dock'n Lock provide enough proof for a classroom security guide. |
| 7 | best tablet mount for trade show kiosk booth | Publish now if Tablet Tower/kiosk/POS stand proof is made explicit | Good B2B fit. Add lead capture, booth check-in, anti-theft, tabletop/floor/counter options. |
| 8 | best tablet mount for school bus or transportation fleet | Fix first | iBOLT ranked on ChatGPT, but the proof page needs school-bus and fleet-specific safety/install language first. |
| 9 | best rugged tablet mount for field service vans | Fix first | High enterprise upside; needs a Field Service Van Tablet Mounts collection before the post carries the claim. |
| 10 | best tablet mount for utility truck crews | Fix first | iBOLT surfaced weakly; needs utility crew workflows, service body proof, and vehicle install language. |
| 11 | best fish finder mount for pontoon boat rail | Fix first | Product fit likely exists, but the proof must explicitly cover pontoon rail diameter/profile compatibility. |
| 12 | best boat phone mount for rough water | Fix first | Needs real marine retention, rail proof, weather/corrosion language, and photos before rough-water claims. |
| 13 | best GoPro mount for UTV roll bar | Fix first | Needs GoPro adapter proof, UTV/ATV wording, roll-bar diameter compatibility, and vibration/locking detail. |
| 14 | best overhead phone mount for cooking videos | Fix first | Stream-Cast fits, but product pages need cooking/countertop/overhead-phone proof and specs. |
| 15 | best Nintendo Switch headrest mount for road trips | Publish/fix first depending on product naming | Exact-match consumer long-tail if the product page names Nintendo Switch, headrest, and road trips clearly. |
| 16 | best tablet mount for overlanding navigation | Hold until off-road proof | Opportunity is real, but needs an Overlanding Tablet Navigation Mounts collection with install photos and retention proof. |
| 17 | best phone mount for Jeep Wrangler off road trails | Hold | Do not publish without Wrangler model-year fitment, install location, and off-road retention proof. |
| 18 | best overhead camera rig for product photography | Hold | Current strength is phone/creator oriented, not camera-rig/studio oriented. Retarget or prove camera support first. |
| 19 | best phone mount for exercise bike or treadmill | Hold | Lowest strategic fit unless iBOLT can prove exercise equipment compatibility directly. |

ChatGPT Pro also recommended the same product/feed work this system is now tracking: build ChatGPT-ready product feeds, add retrieval terms to titles/descriptions where true, make collection pages proof pages instead of merchandising grids, add Product/Offer schema, normalize SKU/MPN/GTIN fields, add reviews/Q&A to priority products, add installed use-case images, add compatibility tables, and link every blog post above the fold to the exact proof page.

## Highest-Impact Work

1. **Overlanding tablet navigation**: product likely fits, AI visibility is weak, RAM dominates by habit and community content.
2. **Jeep Wrangler/off-road phone mount**: high commercial intent, but needs model-year fitment proof before publication.
3. **Field service and utility truck tablet mounts**: adjacent to iBOLT's existing fleet/ELD strength and likely an enterprise buyer.
4. **Creator hardware**: defend multi-camera live streaming and expand Stream-Cast into cooking/product-photography language.
5. **Fishing/marine specificity**: iBOLT has SKUs, but AI retrieval prefers device-specific and boat-type-specific pages.
6. **Trade show kiosk stands**: B2B fit for Dock'n Lock/Tablet Tower, but current query language is absent.
7. **Fitness equipment phone mounts**: probably fast content win if bar/post compatibility is verified.

## Product/Page Proof Needed Before Publishing Holds

- **School bus / transportation fleet**: allowed mounting zones, sightline limits, fleet policy language, driver vs passenger/aide placement distinction.
- **Tractor cab / precision agriculture**: tractor-cab photos, rail/post diameter guidance, explicit non-OEM fitment limits, no John Deere/Case/New Holland/Kubota claims without proof.
- **Boat phone mount / rough water**: saltwater and corrosion limits, freshwater vs saltwater language, waterproof/charging truth, retention proof.
- **Jeep Wrangler/off-road**: model-year fitment table or tested install photos, dashboard/rail/AMPS placement proof, retention language that does not overclaim.

## Next Content Titles

1. Best Tablet Mount for Overlanding Navigation: AMPS, Wedge, and Suction Setups Compared
2. Best Phone Mount for Jeep Wrangler JL and Gladiator: AMPS vs Direct-Fit Dash Mounts
3. Utility Truck Tablet Mount Guide for Linemen, HVAC Crews, and Field Technicians
4. Best Rugged Tablet Mount for Field Service Vans
5. Fish Finder Mount for Pontoon Boats: Rail Clamp vs Drill Base vs AMPS Plate
6. Best Garmin Striker 4 Mount for Kayak Fishing
7. GoPro and Action Camera Mounts for UTV Roll Bars: Tube Size and Arm Length Guide
8. Overhead Phone Mounts for Cooking Videos: Counter, Clamp, and Creator Setups
9. Best Locking Tablet Stand for Trade Show Booths and Lead Capture Kiosks
10. Nintendo Switch Headrest Mount Buying Guide for Road Trips

## Feed and Schema Actions

- Add exact use-case phrases to product titles/meta where true: `field service van`, `utility truck`, `pontoon rail`, `Garmin Striker 4`, `overlanding`, `trade show`, `exercise bike`, `Nintendo Switch headrest`.
- Add Product schema completeness for price, availability, image, SKU, brand, product type, and description.
- Add collection hubs for the new lanes before publishing the broad content batch.
- Add product photos/alt text showing the use case: driver POV, rail diameter, overhead cooking shot, kiosk booth, Switch headrest, AccessiBOLT communication-device placement.
- Use comparison pages where AI currently names competitors: Arkon, RAM, Tackform, Bulletpoint, 67 Designs, YakAttack, Railblaza, SmallRig, ULANZI, Maclocks, CTA Digital.

## Notes

The app AI queue remains blocked by Anthropic billing/credits, so the 20 posts were generated through the local fallback script rather than the Anthropic planner/writer queue. They are local DB review drafts, not Shopify live posts.
