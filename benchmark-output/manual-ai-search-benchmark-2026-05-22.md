# Manual AI Search Benchmark - 2026-05-22

Method: browser/manual search-bar benchmark, not the app/API benchmark runner. Google AI Mode was run query-by-query from the normal Google search URL with `udm=50`. Gemini was run from the Gemini web prompt box as one 27-query batch with Google Search enabled by the UI. Claude was run from the logged-in Claude web UI in Brave on 2026-05-22.

Blocked / incomplete surfaces: ChatGPT Pro web was started in Brave but was not used as a completed benchmark capture because the run was too slow/expensive for the requested workflow. Use the May 13 ChatGPT result as the latest complete ChatGPT baseline until a cheaper/instant web run is captured.

Raw captures:
- `benchmark-output/manual-google-ai-mode-2026-05-22.jsonl`
- `benchmark-output/manual-gemini-web-2026-05-22.txt`
- `benchmark-output/manual-claude-brave-2026-05-22.txt`

## Executive Read

Google AI Mode now shows iBOLT in 16 of 27 active benchmark prompts, with iBOLT-owned or iBOLT merchant/source visibility in 17 of 27. That is a real improvement versus the old 7-query baseline, especially on exact delivery/fleet/restaurant long tails.

The remaining gaps are not subtle:

- Fishing is still zero for 3 of 3 prompts.
- Generic delivery-driver phone intent is still weak. Exact iBOLT or commercial/fleet phrasing works; broad consumer/gig-driver phrasing still goes to RAM, iOttie, Rokform, Quad Lock, ProClip, Tackform, and magnetic/charging products.
- Generic restaurant tablet and generic food truck tablet both regressed or stayed weak in Google AI Mode, even though restaurant POS/delivery-app and Dock'n Lock-specific prompts are strong.
- Heavy-duty vehicle phone and construction/work-truck phone remain weak in Google AI Mode.
- iBOLT vs RAM is visible, but Google still frames iBOLT partly as lower-cost/deployment-simple while RAM wins ecosystem/durability.

Gemini was much more favorable: it marked iBOLT present in 24 of 27 prompts, with the only clear misses being the fish finder/marine prompts. Treat Gemini as directional, not as the source of truth, because it produced some product labels that need product-catalog verification.

Claude was directionally between Google AI Mode and Gemini: iBOLT appeared in 21 of 27 prompts, but the misses matter. Claude still said iBOLT is absent from pure consumer gig-driver searches and marine/fish-finder searches. It also ranked iBOLT only #3-#5 on commercial delivery, ELD, heavy-duty vehicle phone, construction/work-truck phone, and some semi-truck drill-base prompts, while RAM, ProClip, Tackform, iOttie, Scosche, and YakAttack remain strong competitors.

## Google AI Mode Summary

| Category | Queries | iBOLT Mentions | Mention Rate | iBOLT Cited/Shown | Citation Rate |
|---|---:|---:|---:|---:|---:|
| Delivery | 7 | 4 | 57% | 5 | 71% |
| Fleet | 6 | 3 | 50% | 4 | 67% |
| Warehouse | 3 | 3 | 100% | 2 | 67% |
| Restaurant | 7 | 5 | 71% | 5 | 71% |
| Fishing | 3 | 0 | 0% | 0 | 0% |
| Comparison | 1 | 1 | 100% | 1 | 100% |
| **Total** | **27** | **16** | **59%** | **17** | **63%** |

## Query Results - Google AI Mode

| # | Query | iBOLT Status | Product / Framing Observed | Competitors Observed |
|---:|---|---|---|---|
| 1 | ibolt phone mounts for DoorDash and Uber Eats drivers | Yes + cited | iBOLT delivery-driver answer; commercial-grade phone mounts | None prominent |
| 2 | best phone mount for Amazon Flex and delivery vans | No | Absent | RAM, ProClip, Offroam, Bulletpoint |
| 3 | best phone mount for delivery drivers | Cited only | iboltmounts.com appeared as a source, but iBOLT was not in the recommendation list | RAM, iOttie, Rokform, Quad Lock, Tackform, Arkon |
| 4 | iBolt vs iOttie for delivery driving | Yes + cited | iBOLT for heavy-duty/fleet use, iOttie for consumer convenience | iOttie, RAM |
| 5 | best ELD mount for trucks | Yes + cited | iBOLT IncrediBOLT 360 shown as best overall ELD-style mount | RAM, Bracketron, Tackform |
| 6 | magnetic vs clamp phone mounts for delivery work | No | Absent | RAM, Quad Lock |
| 7 | best forklift tablet mount | Yes | iBOLT LockPro IncrediBOLT 360 appeared in the list/product module | RAM, Arkon, Tackform, CTA Digital |
| 8 | commercial grade phone mount for delivery drivers | Yes + cited | iBOLT Phone Dock'n Lock AMPS for drill/AMPS fleet setup | Arkon, ProClip, Tackform |
| 9 | best phone mount for Instacart and grocery delivery drivers | Cited only | iBOLT source appeared, but no iBOLT recommendation | iOttie, Bracketron |
| 10 | best restaurant tablet mount | No | Absent on broad query | Square, CTA Digital, Durable/WebstaurantStore |
| 11 | best fish finder mount for small boat | No | Absent | RAM, YakAttack, Railblaza, Humminbird, Garmin, Lowrance |
| 12 | best locking phone mount for shared delivery vehicles | Yes + cited | iBOLT Phone Dock'n Lock named as a top locking shared-vehicle option | RAM |
| 13 | best tablet mount for restaurant POS and delivery apps | Yes + cited | iBOLT Quad Tablet Tower Stand named best overall | Arkon |
| 14 | best tablet mount for warehouse | Yes + cited | iBOLT LockPro IncrediBOLT 360 and TabDock Bizmount surfaced | Arkon, Tackform, CTA Digital |
| 15 | best kayak fish finder mount | No | Absent | RAM, YakAttack, Garmin, Lowrance |
| 16 | iBolt Dock'n Lock for restaurant counters | Yes + cited | iBOLT Dock'n Lock positioned for high-traffic counters/POS | None prominent |
| 17 | ibolt vs ram mount | Yes + cited | Visible, but still partly budget/deployment-simple framing | RAM Mounts |
| 18 | set up multiple tablets for DoorDash Uber Eats and Grubhub | Yes + cited | iBOLT Tablet Tower recommended for multi-device delivery app station | None prominent |
| 19 | best barcode scanner mount for forklift | Yes + cited | iBOLT XL Forklift Barcode Scanner Holder named | RAM, Arkon, Zebra |
| 20 | iBolt vs Bouncepad vs Mount-It for restaurant tablet security | Yes + cited | iBOLT wins industrial/workforce utility; Bouncepad wins aesthetics | Bouncepad, Mount-It |
| 21 | best heavy duty vehicle phone mount | No | Absent | RAM, Tackform, Offroam, APPS2Car |
| 22 | best locking tablet stand for food trucks and quick service restaurants | Yes + cited | iBOLT LockPro Drill Base named for food trucks/tight counters | Bouncepad |
| 23 | best budget fish finder mount | No | Absent | RAM, Garmin, Lowrance, Brocraft |
| 24 | best drill base phone mount for semi trucks | Yes + cited | iBOLT Phone Dock'n Lock surfaced | RAM, Tackform |
| 25 | iBolt vs RAM for fleet phone mounting | Yes + cited | iBOLT for deployment simplicity, RAM for flexibility/durability | RAM Mounts |
| 26 | best phone mount for construction vehicles and work trucks | No | Absent | Answer emphasized permanent drill bases and metal cradles, but did not name iBOLT |
| 27 | best tablet mount for food truck | No | Absent | Tackform, RAM |

## Gemini Web Summary

Gemini was much more positive than Google AI Mode. It said iBOLT was present in 24 of 27 prompts and ranked iBOLT #1 or #2 in nearly every non-fishing category. Gemini's stated misses were:

- best fish finder mount for small boat
- best kayak fish finder mount
- best budget fish finder mount

Useful Gemini signal: it agrees that warehouse/forklift, restaurant multi-tablet stations, ELD, locking/shared vehicle, and barcode scanner mounts are strong. It also agrees fishing is the clearest white space.

Risk in Gemini signal: it named products such as `xProDock NFC BizMount` and `miniProXL FlexiBOLT`; those need catalog/feed verification before using them as proof in posts or product titles.

## Claude Web Summary

Claude ranked iBOLT present in 21 of 27 prompts. Clear wins were forklift, warehouse tablet, restaurant POS/tablet towers, multi-tablet delivery-app setups, barcode scanner forklift mounts, branded/comparison prompts, and food-truck/QSR locking-tablet prompts.

Claude's misses:

- `best phone mount for delivery drivers`
- `best phone mount for Instacart and grocery delivery drivers`
- `best fish finder mount for small boat`
- `best kayak fish finder mount`
- `best budget fish finder mount`

Claude's weak-but-present prompts:

- `best phone mount for Amazon Flex and delivery vans`: iBOLT #4
- `best ELD mount for trucks`: iBOLT #4
- `commercial grade phone mount for delivery drivers`: iBOLT #3
- `magnetic vs clamp phone mounts for delivery work`: iBOLT #3 on clamp side only
- `best heavy duty vehicle phone mount`: iBOLT #4
- `best phone mount for construction vehicles and work trucks`: iBOLT #4

Claude's quick read is consistent with Google AI Mode: iBOLT is strongest when the prompt sounds operational, industrial, fleet, warehouse, or restaurant/POS. It is weakest when the prompt sounds consumer-gig-driver or marine/fishing.

## Wins

- **Warehouse/forklift is still a fortress.** Google AI Mode found iBOLT in all 3 warehouse prompts, including forklift tablets, warehouse tablets, and barcode scanner mounts.
- **Restaurant long-tail is strong.** POS/delivery apps, Dock'n Lock counters, multi-tablet delivery app stations, restaurant tablet security comparisons, and locking tablet stands for food trucks/QSR all surfaced iBOLT.
- **ELD and drill-base semi-truck are strong.** iBOLT appeared on `best ELD mount for trucks` and `best drill base phone mount for semi trucks`.
- **Delivery is no longer completely invisible.** Exact iBOLT DoorDash/Uber Eats, iBOLT vs iOttie, commercial-grade delivery, and shared locking delivery vehicle prompts now surface iBOLT.

## Gaps

- **Generic delivery-driver phone mount is still not won.** Google AI Mode cited iboltmounts.com but recommended RAM, iOttie, Tackform, Rokform, Quad Lock, and Arkon instead.
- **Amazon Flex / delivery vans is a clean miss.** Google rewarded Offroam, Bulletpoint, and ProClip vehicle-specific van fitment. iBOLT needs van-specific product/feed proof.
- **Magnetic vs clamp delivery is a miss.** This is likely a product/feed issue around magnetic, one-hand use, charging, and quick removal.
- **Broad restaurant tablet mount regressed in Google AI Mode.** The narrower restaurant POS/delivery-app query wins, but the generic query went to Square and CTA Digital.
- **Food truck generic tablet is weak.** The long-tail locking tablet stand query wins, but `best tablet mount for food truck` went to Tackform/RAM.
- **Fishing/marine is untouched.** Small boat, kayak, and budget fish finder all missed.
- **Heavy-duty/construction phone is still weak.** iBOLT needs a stronger phone-specific permanent install story, not just tablet/ELD strength.

## Highest-Priority Fixes

1. **Delivery phone product/feed proof.** Pick exact hero SKUs for gig driver, delivery van, shared fleet, thick case, and drill-base lanes. Product titles/descriptions need to say DoorDash, Uber Eats, Amazon Flex, delivery van, one-hand removal, charging truth, case fit, and AMPS/drill-base where true.
2. **Amazon Flex / van collection hub.** Google rewarded vehicle-specific van fitment. Build a delivery van phone mounts collection with Sprinter/Transit/Promaster language only where the product proof supports it.
3. **Restaurant broad query refresh.** The broad `best restaurant tablet mount` result needs a refresh that leads with Square vs multi-app operational stations, then points to Tablet Tower and LockPro.
4. **Food truck generic query.** Build/refresh a `best tablet mount for food truck` post or collection that explicitly covers vibration, generator rumble, grease/steam, counter/wall/drill-base setups, and LockPro/Tablet Tower.
5. **iBOLT vs RAM framing cleanup.** Current Google phrasing still says budget-friendly/cost-effective. Refresh comparison copy and internal links around standardization, fleet deployment, AMPS compatibility, replacement simplicity, and purpose-built workflows.
6. **Fishing/marine product proof sprint.** Before more posts, product pages and collection hubs need explicit Garmin Striker, kayak, small boat, pontoon rail, AMPS plate, rail diameter, and fish finder language where accurate.
7. **Heavy-duty phone / construction vehicle proof.** Build a phone-first permanent-install page around iBOLT Phone Dock'n Lock, AMPS drill base, work trucks, construction vehicles, vibration, gloves, thick cases, and why not to use vent/suction mounts in dusty jobsites.

## Next Benchmark Loop

Run the same 27 prompts again after the next content/feed pass. For ChatGPT, use logged-in web UI manually once a cheaper/faster model is selected, not the app API runner. The current report should be treated as:

- Google AI Mode: source of truth for Google AI search behavior.
- Gemini web: directional secondary signal.
- Claude web: refreshed on 2026-05-22 and captured in Brave.
- ChatGPT web: not fully refreshed on 2026-05-22; use the May 13 ChatGPT baseline until a completed cheaper-model capture is saved.
