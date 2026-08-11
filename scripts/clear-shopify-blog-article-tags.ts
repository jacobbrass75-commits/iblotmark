import "dotenv/config";
import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";

const SHOP = process.env.SHOPIFY_SHOP || "iboltmounts";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";
const BLOG_IDS = [104843772196, 110121517348];
const OUT_PATH = "content-output/faq-format-backups-2026-07-06/shopify-blog-tags-cleared.json";

interface ShopifyArticle {
  id: number;
  title: string;
  handle: string;
  tags?: string;
  published_at?: string | null;
}

if (!TOKEN) throw new Error("SHOPIFY_ACCESS_TOKEN is not configured in .env.");

async function shopifyREST(method: string, endpoint: string, body?: unknown): Promise<any> {
  const response = await fetch(`https://${SHOP}.myshopify.com/admin/api/${API_VERSION}/${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": TOKEN,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify ${method} ${endpoint} failed: ${response.status} ${text}`);
  }

  return response.status === 204 ? { success: true } : response.json();
}

function parseTags(tags: string | undefined): string[] {
  return (tags || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

const results: Array<Record<string, unknown>> = [];
let scanned = 0;

for (const blogId of BLOG_IDS) {
  const listed = await shopifyREST("GET", `blogs/${blogId}/articles.json?limit=250`);
  const articles = (listed.articles || []) as ShopifyArticle[];
  scanned += articles.length;

  for (const article of articles) {
    const tags = parseTags(article.tags);
    if (tags.length === 0) continue;

    await shopifyREST("PUT", `blogs/${blogId}/articles/${article.id}.json`, {
      article: {
        id: article.id,
        tags: "",
      },
    });

    results.push({
      blogId,
      articleId: article.id,
      title: article.title,
      handle: article.handle,
      published: Boolean(article.published_at),
      previousTags: tags,
      adminUrl: `https://admin.shopify.com/store/${SHOP}/articles/${article.id}`,
      publicUrl: article.published_at ? `https://${SHOP}.com/blogs/news/${article.handle}` : null,
    });
    console.log(`Cleared ${tags.length} tag(s) from ${article.title}`);
  }
}

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify({
  updatedAt: new Date().toISOString(),
  shop: SHOP,
  scanned,
  changed: results.length,
  results,
}, null, 2));

console.log(`Scanned ${scanned} article(s). Cleared tags from ${results.length} article(s).`);
console.log(`Wrote ${OUT_PATH}`);
