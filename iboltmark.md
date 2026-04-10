# iBolt MCP Skills Guide

## Quick Reference — 33 Tools

Use `ibolt-generator` MCP server. Backend must be running on port 5001.

---

## Common Workflows

### Generate a blog post end-to-end
1. `list_keyword_clusters` → pick a cluster ID
2. `generate_blog_post` with that cluster ID (takes 1-3 min)
3. `get_blog_post` to review the result
4. `get_blog_post_html` to see Shopify-ready HTML
5. `publish_to_shopify` to push as draft

### Batch generate multiple posts
1. `list_keyword_clusters` → pick cluster IDs
2. `add_batch_to_queue` with array of cluster IDs
3. `start_scheduler` to process the queue
4. `get_queue` to monitor progress
5. `scheduler_status` to check overall state

### Import and prepare photos
1. `import_photos` with directory path (e.g. `/Users/yakub/Desktop/product-photos`)
2. `photo_stats` to see how many imported
3. `batch_analyze_photos` to run GPT-4V on all (limit 20 per call)
4. `auto_associate_photos` to match photos to products
5. `list_photos` to verify assignments

### Review a single photo
1. `get_photo` with photo ID → see analysis, quality score, angle type, vertical relevance

### Manage the photo bank
- `list_photos` — see all, or filter with `productId`
- `photo_stats` — quick count: total, analyzed, unanalyzed, unassigned
- `analyze_photo` — run vision AI on one photo
- `delete_photo` — remove a photo

### Import keywords from CSV
1. `import_keywords` with absolute path to Ubersuggest CSV
2. `cluster_keywords` to group them into blog topics
3. `list_keyword_clusters` to see the groups

### Research an industry vertical
1. `list_verticals` to see all 12 with entry counts
2. `run_research` with a vertical ID (or omit for all)
3. `get_context_entries` to review what was found
4. `add_context_entry` to manually add knowledge

### Check Shopify status
1. `shopify_status` → connection check
2. `list_shopify_articles` → see published articles

### Analyze competitors
1. `analyze_competitor` with array of blog URLs
2. This auto-queues matching topics for generation

---

## Tool Cheat Sheet

| Task | Tool | Key Params |
|------|------|-----------|
| See all posts | `list_blog_posts` | `status`: draft/approved/published |
| Read a post | `get_blog_post` | `id` |
| Edit a post | `update_blog_post` | `id`, `title`, `content`, `status`, `metaTitle`, `metaDescription` |
| Generate post | `generate_blog_post` | `clusterId`, optional `verticalId` |
| Get HTML | `get_blog_post_html` | `id` |
| Publish | `publish_to_shopify` | `id` |
| List photos | `list_photos` | optional `productId` |
| Photo stats | `photo_stats` | — |
| Import photos | `import_photos` | `dirPath` (absolute path) |
| Analyze 1 photo | `analyze_photo` | `id` |
| Analyze batch | `batch_analyze_photos` | optional `limit` (default 20) |
| Match photos | `auto_associate_photos` | — |
| Delete photo | `delete_photo` | `id` |
| List keywords | `list_keywords` | `status`: unclustered/clustered/used/all |
| Cluster keywords | `cluster_keywords` | — |
| Import CSV | `import_keywords` | `filePath` |
| List verticals | `list_verticals` | — |
| Run research | `run_research` | optional `verticalId`, `sources` |
| Queue jobs | `add_to_queue` | `clusterId`, optional `priority` |
| Batch queue | `add_batch_to_queue` | `clusterIds` array |
| Check queue | `get_queue` | — |
| Start auto mode | `start_scheduler` | — |
| Stop auto mode | `stop_scheduler` | — |
| Trigger action | `trigger_scheduler_action` | `action`: research/products/generate/photos/chunks |
| Scrape products | `scrape_products` | — |
| List products | `list_products` | optional `verticalId` |
| Competitor scan | `analyze_competitor` | `urls` array |

---

## Tips

- **Photos in posts**: The pipeline auto-selects photos during generation. Import and analyze photos BEFORE generating posts so the selector has images to work with.
- **Photo URLs**: Local `/api/blog/photos/serve/{id}` URLs are auto-converted to the public URL when rendering Shopify HTML. No manual URL editing needed.
- **Scheduler**: Once started, it auto-runs research, product scraping, and blog generation on a loop. Use `trigger_scheduler_action` for one-off runs without starting the full loop.
- **Post editing**: Use `update_blog_post` to fix content, then `publish_to_shopify` to re-sync. If the post was already published, it updates the existing Shopify article.
- **Vertical context**: Richer context banks = better blog posts. Run research on verticals before generating posts for that industry.
