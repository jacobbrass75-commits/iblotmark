# Shopify Blog Analytics Access Attempt

Generated: 2026-06-24

## Status

Actual Shopify report analytics were not extracted in this run.

The in-app browser reached Shopify login, which means it does not share the user's logged-in Brave session. Opening the Shopify analytics reports URL in Brave confirmed the real browser session is logged in and on:

`https://admin.shopify.com/store/iboltmounts/analytics/reports`

However, Brave blocks JavaScript extraction from Apple Events unless the browser setting `View > Developer > Allow JavaScript from Apple Events` is enabled. The current Shopify API token available to the repo also does not expose report analytics such as sessions, add-to-cart, checkout, sales, or referrer detail.

## Baseline Workaround

The unanswered-question scanner still saved a structural baseline for the top refresh pages:

`content-output/unanswered-question-scanner-2026-06-24/baseline-performance-snapshot.csv`

That baseline includes:

- Shopify article IDs
- Live URLs
- Published and updated dates
- Product-link counts
- Add-to-cart link counts
- Image counts
- Body size
- Known benchmark gaps
- Refresh priority

Analytics fields remain blank until a Shopify, GA4, or GSC report export is supplied.

## Needed To Complete Analytics Pull

Any one of these will unblock the next step:

1. Enable Brave `Allow JavaScript from Apple Events`, then I can read the visible Shopify report text from the logged-in tab.
2. Export Shopify blog/report analytics as CSV and put the file in the repo or Downloads.
3. Provide/report a Shopify Admin API token with report/analytics access where available.
4. Provide GA4/Search Console exports for blog URLs and ChatGPT/referral traffic.

## Metrics To Capture

For the top refresh pages, capture before/after:

- Sessions
- Visitors
- Referrer/source, especially ChatGPT, Perplexity, Gemini, Claude, and AI search surfaces
- Add-to-cart events
- Reached checkout
- Orders and revenue where attribution is available
- Assisted conversions
