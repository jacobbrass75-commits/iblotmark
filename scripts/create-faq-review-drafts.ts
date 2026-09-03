import "dotenv/config";
import Database from "better-sqlite3";
import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

const DB_PATH = process.env.DATABASE_PATH || "./data/standalone-blog-writer.db";
const SHOP = process.env.SHOPIFY_SHOP || "iboltmounts";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";
const DEFAULT_BLOG_ID = 104843772196;
const TITLE_PREFIX = "[FAQ Review Draft] ";
const REVIEW_TAGS = ["codex-faq-review-draft", "faq-schema-review", "do-not-publish"];
const OUT_PATH = "content-output/faq-format-backups-2026-07-06/shopify-faq-review-drafts.json";

interface BlogPostRow {
  id: string;
  title: string;
  slug: string;
  meta_title: string | null;
  meta_description: string | null;
  html: string | null;
  shopify_blog_id: number | null;
  shopify_article_id: number | null;
}

interface ShopifyArticle {
  id: number;
  title: string;
  handle?: string;
  admin_graphql_api_id?: string;
  published_at?: string | null;
  tags?: string;
}

function assertConfig(): void {
  if (!TOKEN) {
    throw new Error("SHOPIFY_ACCESS_TOKEN is not configured in .env.");
  }
  if (!SHOP) {
    throw new Error("SHOPIFY_SHOP is not configured.");
  }
}

async function shopifyREST(method: string, endpoint: string, body?: unknown): Promise<any> {
  const url = `https://${SHOP}.myshopify.com/admin/api/${API_VERSION}/${endpoint}`;
  const response = await fetch(url, {
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

async function listArticles(blogId: number): Promise<ShopifyArticle[]> {
  const result = await shopifyREST("GET", `blogs/${blogId}/articles.json?limit=250`);
  return result.articles || [];
}

function buildTags(post: BlogPostRow): string {
  return [...REVIEW_TAGS, `source-post-${post.id}`, `source-slug-${post.slug}`].join(", ");
}

function adminUrl(articleId: number): string {
  return `https://admin.shopify.com/store/${SHOP}/articles/${articleId}`;
}

assertConfig();

const sqlite = new Database(DB_PATH, { readonly: true });
const posts = sqlite.prepare(`
  SELECT id, title, slug, meta_title, meta_description, html, shopify_blog_id, shopify_article_id
  FROM blog_posts
  WHERE (markdown LIKE '%Frequently Asked Questions%' OR html LIKE '%Frequently Asked Questions%' OR markdown LIKE '%FAQ%' OR html LIKE '%FAQ%')
    AND html LIKE '%FAQPage%'
  ORDER BY title
`).all() as BlogPostRow[];

const articlesByBlog = new Map<number, ShopifyArticle[]>();
const results: Array<Record<string, unknown>> = [];

for (const post of posts) {
  const blogId = post.shopify_blog_id || DEFAULT_BLOG_ID;
  if (!post.html) {
    results.push({ postId: post.id, title: post.title, success: false, error: "Missing rendered HTML" });
    continue;
  }

  if (!articlesByBlog.has(blogId)) {
    articlesByBlog.set(blogId, await listArticles(blogId));
  }
  const existing = articlesByBlog.get(blogId)?.find((article) => article.title === `${TITLE_PREFIX}${post.title}`);

  const articlePayload = {
    title: `${TITLE_PREFIX}${post.title}`,
    body_html: post.html,
    published: false,
    tags: buildTags(post),
    metafields: [
      {
        namespace: "global",
        key: "title_tag",
        value: post.meta_title || post.title,
        type: "single_line_text_field",
      },
      {
        namespace: "global",
        key: "description_tag",
        value: post.meta_description || "",
        type: "single_line_text_field",
      },
    ],
  };

  if (existing) {
    if (existing.published_at) {
      results.push({
        postId: post.id,
        title: post.title,
        success: false,
        skipped: true,
        reason: "Existing review-title article is published, refusing to overwrite it.",
        shopifyArticleId: existing.id,
        adminUrl: adminUrl(existing.id),
      });
      continue;
    }

    await shopifyREST("PUT", `blogs/${blogId}/articles/${existing.id}.json`, {
      article: { id: existing.id, ...articlePayload },
    });
    results.push({
      postId: post.id,
      title: post.title,
      slug: post.slug,
      sourceShopifyArticleId: post.shopify_article_id,
      shopifyArticleId: existing.id,
      shopifyBlogId: blogId,
      action: "updated",
      published: false,
      adminUrl: adminUrl(existing.id),
    });
  } else {
    const created = await shopifyREST("POST", `blogs/${blogId}/articles.json`, {
      article: articlePayload,
    });
    const articleId = Number(created.article.id);
    articlesByBlog.get(blogId)?.push(created.article);
    results.push({
      postId: post.id,
      title: post.title,
      slug: post.slug,
      sourceShopifyArticleId: post.shopify_article_id,
      shopifyArticleId: articleId,
      shopifyBlogId: blogId,
      action: "created",
      published: false,
      adminUrl: adminUrl(articleId),
    });
  }
}

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify({
  createdAt: new Date().toISOString(),
  shop: SHOP,
  titlePrefix: TITLE_PREFIX,
  count: results.length,
  results,
}, null, 2));

for (const result of results) {
  const marker = result.success === false ? "SKIP" : String(result.action || "done").toUpperCase();
  console.log(`${marker}: ${result.title} -> ${result.adminUrl || result.error || result.reason}`);
}
console.log(`Wrote ${OUT_PATH}`);
