import "dotenv/config";
import Database from "better-sqlite3";
import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";

const DB_PATH = process.env.DATABASE_PATH || "./data/standalone-blog-writer.db";
const SHOP = process.env.SHOPIFY_SHOP || "iboltmounts";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";
const OUT_PATH = "content-output/faq-format-backups-2026-07-06/shopify-live-faq-publish.json";

interface BlogPostRow {
  id: string;
  title: string;
  slug: string;
  html: string | null;
  shopify_blog_id: number | null;
  shopify_article_id: number | null;
}

function assertConfig(): void {
  if (!TOKEN) throw new Error("SHOPIFY_ACCESS_TOKEN is not configured in .env.");
  if (!SHOP) throw new Error("SHOPIFY_SHOP is not configured.");
}

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

function adminUrl(articleId: number): string {
  return `https://admin.shopify.com/store/${SHOP}/articles/${articleId}`;
}

assertConfig();

const sqlite = new Database(DB_PATH, { readonly: true });
const posts = sqlite.prepare(`
  SELECT id, title, slug, html, shopify_blog_id, shopify_article_id
  FROM blog_posts
  WHERE (markdown LIKE '%Frequently Asked Questions%' OR html LIKE '%Frequently Asked Questions%' OR markdown LIKE '%FAQ%' OR html LIKE '%FAQ%')
    AND html LIKE '%FAQPage%'
    AND html LIKE '%ibolt-faq-row%'
    AND shopify_article_id IS NOT NULL
    AND shopify_blog_id IS NOT NULL
  ORDER BY title
`).all() as BlogPostRow[];

const results: Array<Record<string, unknown>> = [];

for (const post of posts) {
  const blogId = Number(post.shopify_blog_id);
  const articleId = Number(post.shopify_article_id);

  if (!post.html) {
    results.push({ postId: post.id, title: post.title, success: false, error: "Missing local rendered HTML" });
    continue;
  }

  const current = await shopifyREST("GET", `blogs/${blogId}/articles/${articleId}.json`);
  const article = current.article;
  if (!article?.published_at) {
    results.push({
      postId: post.id,
      title: post.title,
      success: false,
      error: "Refusing to update source article because it is not currently published.",
      shopifyArticleId: articleId,
      adminUrl: adminUrl(articleId),
    });
    continue;
  }

  await shopifyREST("PUT", `blogs/${blogId}/articles/${articleId}.json`, {
    article: {
      id: articleId,
      body_html: post.html,
    },
  });

  const updated = await shopifyREST("GET", `blogs/${blogId}/articles/${articleId}.json`);
  const updatedHtml = updated.article?.body_html || "";
  const stillPublished = Boolean(updated.article?.published_at);
  const hasFaqSchema = /"@type"\s*:\s*"FAQPage"/.test(updatedHtml);
  const hasAccordion = updatedHtml.includes("ibolt-faq-row") && updatedHtml.includes("ibolt-faq-toggle");

  results.push({
    postId: post.id,
    title: post.title,
    slug: post.slug,
    success: stillPublished && hasFaqSchema && hasAccordion,
    shopifyArticleId: articleId,
    shopifyBlogId: blogId,
    adminUrl: adminUrl(articleId),
    publicUrl: `https://${SHOP}.com/blogs/news/${post.slug}`,
    remainedPublished: stillPublished,
    hasFaqSchema,
    hasAccordion,
    previous: {
      title: article.title,
      handle: article.handle,
      publishedAt: article.published_at,
      updatedAt: article.updated_at,
      bodyHtml: article.body_html,
    },
  });
}

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify({
  publishedAt: new Date().toISOString(),
  shop: SHOP,
  count: results.length,
  results,
}, null, 2));

for (const result of results) {
  const marker = result.success ? "UPDATED" : "FAILED";
  console.log(`${marker}: ${result.title} -> ${result.adminUrl || result.error}`);
}
console.log(`Wrote ${OUT_PATH}`);
