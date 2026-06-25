# iBOLT Unanswered Question Scanner

Generated: 2026-06-25T02:35:18.545Z

## What This Does

This scanner turns benchmark misses, page refresh queues, enriched buyer questions, and thin vertical coverage into a repeatable content backlog. It also records a safe baseline for the top refresh pages so later edits can be compared against the current state.

## Inputs

- Benchmark rows: 204
- Blog action rows: 142
- Shopify inventory rows: 211
- Buyer-question rows: 49
- Subject coverage rows: 21
- Analytics status: analytics not supplied; Shopify API/UI access required for sessions, add-to-cart, checkout, and revenue

## Top 10 Pages To Refresh First

| rank | title | category | top_fix | losing_queries |
| --- | --- | --- | --- | --- |
| 1 | Best Restaurant Tablet Mount in 2026: POS Stands, Delivery App Stations, and Multi-Tablet Solutions Compared | restaurant | missing early quick answer | best tablet mount; best multi tablet mount; best restaurant tablet mount |
| 2 | Best Phone Mount for Construction Vehicles and Work Trucks | fleet | missing early quick answer | best phone mount for construction vehicles and work trucks |
| 3 | Best Garmin Fish Finder Mount: How to Choose the Right Setup for Your Boat or Kayak | fishing | missing early quick answer | best budget fish finder mount; best fish finder in water; best fish finder |
| 4 | Best Tablet Mount for Restaurant POS and Delivery Apps | restaurant | missing early quick answer | best tablet mount for restaurant POS and delivery apps |
| 5 | Best Locking Tablet Stand for Food Trucks and Quick-Service Restaurants | restaurant | missing early quick answer | best locking tablet stand for food trucks and quick service restaurants |
| 6 | Best Phone Mount for Amazon Flex and Delivery Vans | delivery | missing early quick answer | best phone mount for Amazon Flex and delivery vans |
| 7 | Commercial-Grade Phone Mounts for Delivery Drivers | fleet | too many cart CTAs | commercial grade phone mount for delivery drivers |
| 8 | Best Locking Phone Mount for Shared Delivery Vehicles | delivery | missing early quick answer | best locking phone mount for shared delivery vehicles |
| 9 | Best Phone Mount for Instacart and Grocery Delivery Drivers | delivery | missing early quick answer | best phone mount for Instacart and grocery delivery drivers |
| 10 | Best Fish Finder Mount for Pontoon Boat Rails | fishing | missing early quick answer | best fish finder mount for small boat |

## Top 15 Unanswered Or Weakly Answered Questions

| score | query | category | recommended_action | existing_page_title |
| --- | --- | --- | --- | --- |
| 196 | which brands are cited for fleet and ELD vehicle mount | fleet | comparison_or_source_page | Best Phone Mount for Construction Vehicles and Work Trucks |
| 186 | best commercial-grade phone mount for delivery drivers | fleet | refresh_existing_page | Commercial-Grade Phone Mounts for Delivery Drivers |
| 186 | best ELD mount for trucks | fleet | refresh_existing_page | Best ELD Mount for Trucks: Complete Guide to Heavy-Duty Tablet Holders for Commercial Fleets |
| 186 | best fish finder mount for pontoon boat rails | fishing | refresh_existing_page | Best Fish Finder Mount for Pontoon Boat Rails |
| 186 | best fish finder mount for small boat | fishing | refresh_existing_page | Best Fish Finder Mount for Small Boats: Comparison and Buyer's Guide |
| 186 | best forklift tablet mount for warehouses | warehouse | refresh_existing_page | Tablet Mount for Forklift: Complete Guide to Forklift Mounted Tablet Solutions |
| 186 | best garmin fish finder mount choose the right setup for your boat or kayak | fishing | refresh_existing_page | Best Garmin Fish Finder Mount: How to Choose the Right Setup for Your Boat or Kayak |
| 186 | best kayak fish finder mount for secure removable setups | fishing | refresh_existing_page | Best Kayak Fish Finder Mounts for Secure Removable Setups |
| 186 | best locking phone mount for shared delivery vehicles | delivery | refresh_existing_page | Best Locking Phone Mount for Shared Delivery Vehicles |
| 186 | best phone mount for Amazon Flex and delivery vans | delivery | refresh_existing_page | Best Phone Mount for Amazon Flex and Delivery Vans |
| 186 | best phone mount for construction vehicles and work trucks | fleet | refresh_existing_page | Best Phone Mount for Construction Vehicles and Work Trucks |
| 186 | best phone mount for delivery drivers | delivery | refresh_existing_page | Best Phone Mount for Delivery Drivers |
| 186 | best phone mount for Instacart and grocery delivery drivers | delivery | refresh_existing_page | Best Phone Mount for Instacart and Grocery Delivery Drivers |
| 186 | best rough water phone mount for boat heavy-duty solutions that handle the chop | fishing | refresh_existing_page | Rough Water Phone Mount for Boat: Heavy-Duty Solutions That Handle the Chop |
| 186 | best tablet and phone mount for trucks and eld compliance | fleet | refresh_existing_page | Best Tablet and Phone Mounts for Trucks and ELD Compliance (2026) |

## A/B Baseline Note

The baseline files in this folder intentionally preserve the current article IDs, URLs, product-link counts, add-to-cart link counts, image counts, body size, benchmark priority, and known AI query gaps before edits. Traffic, add-to-cart, checkout, and revenue fields are left blank unless a Shopify/GSC/GA4 export is supplied, because the current Shopify content token does not expose report analytics.

## Output Files

- unanswered-question-candidates.csv
- unanswered-question-candidates.json
- top-10-refresh-candidates.csv
- top-10-refresh-candidates.json
- baseline-performance-snapshot.csv
- baseline-performance-snapshot.json
- inputs-manifest.json
