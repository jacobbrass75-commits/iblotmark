# Metrics Access Note

I did not generate ranking or traffic numbers because the required page-level data is not reachable from the current local setup.

What I checked:

- Local environment files expose Shopify content credentials, but no Google Search Console or GA4 credentials.
- Available connectors in this session do not include a Search Console or GA4 connector.
- Existing Shopify access checks at `content-output/shopify-blog-analytics-access-2026-06-21/analytics-access-status.csv` and `content-output/shopify-blog-inventory-refresh-2026-06-23/analytics-access-status.csv` show ShopifyQL analytics is blocked by missing `read_reports` and protected customer data access.
- The Downloads rank tracker export `/Users/yakub/Downloads/position_tracking_report.csv (3).csv` has keyword, position, search volume, URL, and location, but it does not include clicks, impressions, CTR, or average position from Search Console.

To produce the requested before and after metrics and chart, connect one of these:

1. Google Search Console export for `https://iboltmounts.com/` with columns `Date`, `Page`, `Query`, `Clicks`, `Impressions`, `CTR`, and `Position`, filtered or filterable to the generated blog URLs in `upwork/case-study-ibolt.md`.
2. Search Console API credentials through a service account or OAuth client with access to the iBolt property. Store the credential path in `.env` as `GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json` or provide OAuth client credentials and refresh token.
3. GA4 page performance export with `Date`, `Page path`, `Sessions`, `Engaged sessions`, `Conversions`, and `Revenue`, if conversion evidence is needed in addition to Search Console ranking evidence.
4. Shopify Admin token with `read_reports` scope and the required protected customer data access if ShopifyQL session and sales reporting should be joined to the blog URLs.

Once connected, save exports under `upwork/metrics/source/` or expose the API credentials, then rerun the metrics pull. No clicks, impressions, or average position values have been fabricated.
