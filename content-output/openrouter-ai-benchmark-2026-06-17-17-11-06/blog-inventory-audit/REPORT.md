# iBOLT Blog Inventory And Product Spread Audit

## Summary

- Local published posts: 106
- Posts synced to Shopify: 106
- Public sitemap pages: 142
- Audited pages available: 113
- Local posts matched to audit: 89/106
- Catalog products: 343
- Products linked from at least one blog post: 156/343
- Unlinked products: 187 (55%)
- Average detected products per local post: 5.2
- Posts with zero DB-tracked product rows: 55
- Posts with zero detected catalog product links: 0
- Products without vertical mappings: 2
- Unknown product handles found in post bodies: 9
- Duplicate local slugs: 1
- Possible duplicate/cannibalized page pairs: 18

## Main Takeaways

The blog system is large enough to support AI visibility work, but the product spread is concentrated. The audit detected 156 linked products out of 343, so future refreshes should intentionally cover more products rather than reusing the same hero SKUs. The local-to-live matching also needs cleanup because 17 local posts did not match the public audit cleanly. Product data also needs cleanup: 343 products are missing availability, 343 are missing specs, and 343 are missing compatibility fields.

## Priority Files

- post-inventory.csv
- product-spread.csv
- unlinked-product-opportunities.csv
- possible-duplicate-pages.csv
- topic-product-spread.csv
- product-readiness-summary.csv
