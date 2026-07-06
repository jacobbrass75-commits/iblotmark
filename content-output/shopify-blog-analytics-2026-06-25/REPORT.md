# Shopify Analytics Snapshot - iBOLT Blog and AI Traffic

Captured: 2026-06-24 7:43-7:56 PM Pacific from Shopify Admin in Brave.

## Method

- Used Shopify Admin > Analytics > Reports with ShopifyQL.
- Blog direct performance range: last 30 days.
- AI-source traffic and sales range: last 365 days.
- Screenshots are stored in this folder because Brave currently blocks JavaScript extraction from Apple Events.

## Blog Landing Pages - Last 30 Days

Query: sessions where `landing_page_path` contains `/blogs/`, grouped by landing page path.

Visible top rows:

| Blog landing page, truncated by Shopify UI | Sessions | Pageviews | Added to cart |
| --- | ---: | ---: | ---: |
| `/blogs/news/what-size-is-th...` | 107 | 180 | 0 |
| `/blogs/news/tips-for-creatin...` | 40 | 74 | 0 |
| `/blogs/how-to-mount-a-fish...` | 34 | 89 | 0 |
| `/blogs/news/best-overhead-...` | 32 | 55 | 0 |
| `/blogs/how-to-mount-a-fish...` | 30 | 60 | 0 |
| `/blogs/news/best-overhead-...` | 26 | 47 | 0 |
| `/blogs/how-to-mount-a-fish...` | 24 | 37 | 0 |
| `/blogs/news/ibolt-vs-ram-fo...` | 20 | 40 | 0 |
| `/blogs/how-to-mount-a-fish...` | 18 | 31 | 0 |
| `/blogs/news/overhead-cam...` | 17 | 33 | 0 |

Read: blogs are getting discoverability traffic, but the visible top rows are not directly creating cart additions in the same landing sessions.

## AI Source Sessions - Last 365 Days

Query: sessions where UTM source contains `chatgpt`, `openai`, `gemini`, `claude`, `perplexity`, or `grok`.

| UTM source | Sessions | Added to cart | Reached checkout | Completed checkout | Approx. conversion |
| --- | ---: | ---: | ---: | ---: | ---: |
| `chatgpt.com` | 3,517 | 29 | 81 | 33 | ~0.94% |
| `perplexity` | 79 | 0 | 0 | 0 | 0% |
| `Perplexity` | 21 | 0 | 0 | 0 | 0% |
| `chatgpt.com 2. https://arkon...` | 1 | 0 | 0 | 0 | 0% |
| `openai` | 1 | 0 | 0 | 0 | 0% |

Read: ChatGPT is already sending commercially meaningful traffic. Perplexity is visible but not converting yet.

## AI Source Sales - Last 365 Days

Query: sales by UTM campaign source with `LAST_CLICK_ATTRIBUTION`.

| UTM campaign source | Orders, last click | Total sales, last click |
| --- | ---: | ---: |
| `chatgpt.com` | 37 | $3,242.67 |

Read: Shopify attributes real revenue to ChatGPT. This is the strongest current proof point for the AI visibility program.

## ChatGPT Sales Since April 1, 2026

Query: sales by UTM campaign source with `LAST_CLICK_ATTRIBUTION`, date range April 1-June 24, 2026.

| UTM campaign source | Orders, last click | Total sales, last click |
| --- | ---: | ---: |
| `chatgpt.com` | 18 | $1,107.97 |

Direct blog landing contribution over the same range:

| Filter | Sessions | Added to cart | Reached checkout | Completed checkout | Conversion rate |
| --- | ---: | ---: | ---: | ---: | ---: |
| `utm_source` contains `chatgpt` and `landing_page_path` contains `/blogs/` | 27 | 0 | 0 | 0 | 0% |

Read: the measurable direct blog last-click contribution is $0 for this period. The blog system should be treated as an assisted/entity-signal layer unless we add first-party tracking for blog-to-product clicks and assisted conversions.

## Did ChatGPT Revenue Increase After the Blog Push?

Working cutoff: May 15, 2026, based on the first visible batch of new blog posts and Shopify article dates.

| Window | Days | Orders, last click | Total sales, last click | Sales/day |
| --- | ---: | ---: | ---: | ---: |
| Apr 1-May 14, 2026 | 44 | 9 | $547.90 | $12.45 |
| May 15-Jun 24, 2026 | 41 | 9 | $560.07 | $13.66 |

Monthly trend from the same ShopifyQL last-click report:

| Month | Total sales, last click |
| --- | ---: |
| Jan 2026 | $257.28 |
| Feb 2026 | $331.32 |
| Mar 2026 | $469.74 |
| Apr 2026 | $239.66 |
| May 2026 | $809.03 |
| Jun 2026 MTD | $59.28 |

Read: ChatGPT revenue is up slightly on a daily-average before/after basis, and May had a clear spike. The increase is not strong enough by itself to claim the blog posts caused it. Treat this as an early positive signal and keep weekly tracking.

## ChatGPT Landing Pages - Last 365 Days

Most ChatGPT traffic lands on product pages and collections, not blogs. Visible top rows include:

| Landing page, truncated by Shopify UI | Sessions | Added to cart | Reached checkout | Completed checkout |
| --- | ---: | ---: | ---: | ---: |
| `/products/tabdock-flexpro-t...` | 191 | 3 | 5 | 1 |
| `/products/livestream-stream...` | 154 | 3 | 7 | 2 |
| `/products/ibolt-stream-cast-...` | 78 | 0 | 0 | 0 |
| `/products/ibolt-lockpro-met...` | 76 | 0 | 0 | 0 |
| `/products/ibolt-tabdock-ma...` | 66 | 0 | 2 | 1 |
| `/products/minipro-amps-drill...` | 59 | 0 | 1 | 1 |
| `/products/livestreaming-ove...` | 59 | 0 | 2 | 1 |
| `/collections/17mm-ball-adap...` | 46 | 0 | 0 | 0 |

## ChatGPT Blog Landing Pages - Last 365 Days

Query: ChatGPT sessions where landing page path contains `/blogs/`.

Visible top rows:

| Blog landing page, truncated by Shopify UI | Sessions | Added to cart | Reached checkout | Completed checkout |
| --- | ---: | ---: | ---: | ---: |
| `/blogs/news/what-size-is-th...` | 14 | 0 | 1 | 0 |
| `/blogs/news/top-5-heavy-d...` | 8 | 0 | 0 | 0 |
| `/blogs/news/what-do-i-need...` | 6 | 0 | 0 | 0 |
| `/blogs/news/restaurant-tabl...` | 4 | 0 | 0 | 0 |
| `/blogs/news/tips-for-creatin...` | 4 | 0 | 0 | 0 |
| `/blogs/news/best-overhead-...` | 4 | 0 | 0 | 0 |
| `/blogs/news/choosing-the-ri...` | 2 | 0 | 0 | 0 |
| `/blogs/news/5-useful-tablet...` | 2 | 0 | 0 | 0 |
| `/blogs/news/managing-multi...` | 2 | 0 | 0 | 0 |
| `/blogs/news/how-to-mount-...` | 2 | 0 | 0 | 0 |

Read: direct ChatGPT-to-blog traffic exists but is still light. The current money signal is ChatGPT-to-product/category pages, while blogs likely contribute more as supporting entity/content signals than direct last-click sales.

## Recommended Next Action

1. Keep building vertical solution hubs and connect each hub to the product pages already receiving ChatGPT traffic.
2. Add stronger internal links from high-session blogs into the relevant product/category hubs.
3. Treat blog success as assisted visibility plus internal-product-click lift, not only same-session blog add-to-cart.
4. Track this same ShopifyQL snapshot weekly so we can see whether AI sessions, ChatGPT sales, and blog-assisted paths improve after hub/schema/content updates.

## Evidence Files

- `blog-sessions-funnel.png`
- `ai-sessions-funnel-compact.png`
- `ai-sales-by-utm-source-last-click.png`
- `chatgpt-sessions-by-landing-page.png`
- `chatgpt-blog-sessions-by-landing-page.png`
