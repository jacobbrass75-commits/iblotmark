# Schema Implementation Notes

Generated: 2026-06-08T23:44:26.999Z

These solution pages include JSON-LD @graph blocks with:

- Organization, with iBOLT specialty categories such as phone mounts, tablet mounts, ELD mounts, forklift tablet mounts, AMPS mounting plates, restaurant tablet mounts, and live streaming camera mounts.
- WebPage and BreadcrumbList for each proposed /pages URL.
- FAQPage for every visible FAQ section.
- HowTo for every visible step-by-step selection/setup section.
- Product nodes with Offer data only for products fetched from current Shopify product JSON or backed by the local product catalog.

## Blog Article Schema

Existing Shopify blog posts should use Article or BlogPosting schema in the article template or the app renderer. Use the blog title, canonical article URL, published date, modified date, author/publisher, and the hero image when available. Do not add fake ratings or reviews.

## Product and Offer Schema Validation

Product page Product/Offer schema should be validated in the Shopify theme, not duplicated inside these solution pages. Validate that every product page exposes:

- Product name, image, brand, SKU when available, and canonical URL.
- Offer price, priceCurrency USD, availability, and itemCondition.
- AggregateRating or Review only when real review data exists.

## Shopify Placement

These files are review-only. If approved, create unpublished Shopify Pages using the payloads in payloads/*.shopify-page-payload.json, then publish after visual review. If Shopify strips script tags from page body content, move the schema block into a page template/snippet and render by page handle.
