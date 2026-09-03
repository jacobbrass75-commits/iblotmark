#!/usr/bin/env node

import "dotenv/config";
import Database from "better-sqlite3";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const COMPANY_ID = "ibolt-default-company";
const SERIES_DIR = path.resolve("content-output/ibolt-locking-tablet-security-series-2026-08-26");
const REVIEW_DIR = path.join(SERIES_DIR, "shopify-review");
const MANIFEST_PATH = path.join(REVIEW_DIR, "review-manifest.json");
const DRAFT_RESULTS_PATH = path.join(REVIEW_DIR, "shopify-draft-results.json");
const VERIFIER_PATH = path.join(REVIEW_DIR, "verifier-report.json");
const RESULT_PATH = path.join(REVIEW_DIR, "shopify-publish-results.json");
const BACKUP_DIR = path.join(REVIEW_DIR, "publish-backups");
const DB_PATH = path.resolve(process.env.DATABASE_PATH || "data/standalone-blog-writer.db");
const SHOP = (process.env.SHOPIFY_SHOP || "iboltmounts").replace(/\.myshopify\.com$/i, "");
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN || "";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";
const BLOG_ID = Number(process.env.SHOPIFY_NEWS_BLOG_ID || 104843772196);
const SHOULD_PUBLISH = process.argv.includes("--publish");
const VERIFY_EXISTING = process.argv.includes("--verify-existing");
const REVIEW_TAGS = new Set(["review draft", "do not publish"]);

if (!TOKEN) throw new Error("Shopify access token is not configured.");
if (!SHOP) throw new Error("SHOPIFY_SHOP is not configured.");
if (!Number.isFinite(BLOG_ID)) throw new Error("SHOPIFY_NEWS_BLOG_ID must be numeric.");

async function shopify(method, endpoint, body) {
  const response = await fetch(`https://${SHOP}.myshopify.com/admin/api/${API_VERSION}/${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": TOKEN,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const responseText = await response.text();
  let json = {};
  try {
    json = responseText ? JSON.parse(responseText) : {};
  } catch {
    json = { raw: responseText };
  }
  if (!response.ok) {
    throw new Error(`Shopify ${method} ${endpoint} failed: ${response.status} ${responseText.slice(0, 1200)}`);
  }
  return json;
}

async function getArticle(articleId) {
  const result = await shopify("GET", `blogs/${BLOG_ID}/articles/${articleId}.json`);
  return result.article;
}

async function getSeo(articleId) {
  const result = await shopify("GET", `articles/${articleId}/metafields.json?limit=250`);
  return Object.fromEntries(
    (result.metafields || [])
      .filter((field) => field.namespace === "global" && ["title_tag", "description_tag"].includes(field.key))
      .map((field) => [field.key, field.value]),
  );
}

function cleanLiveTags() {
  return "";
}

function publicUrl(slug) {
  return `https://iboltmounts.com/blogs/news/${slug}`;
}

function adminUrl(articleId) {
  return `https://admin.shopify.com/store/${SHOP}/content/articles/${articleId}`;
}

async function fetchLive(url) {
  let last = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    last = await fetch(url, { redirect: "follow", cache: "no-store" });
    if (last.status === 200) return last;
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  return last;
}

const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
const draftResults = JSON.parse(await readFile(DRAFT_RESULTS_PATH, "utf8"));
const verifier = JSON.parse(await readFile(VERIFIER_PATH, "utf8"));

if (manifest.posts?.length !== 5 || draftResults.results?.length !== 5) {
  throw new Error("Expected exactly five approved locking-tablet posts.");
}
if ((!VERIFY_EXISTING && manifest.shopifyPublished !== false) || draftResults.hidden !== true || draftResults.published !== false) {
  throw new Error("The review manifest and draft audit must show a hidden, unpublished batch.");
}
if (verifier.passed !== true || verifier.results?.some((row) => !row.verification?.passesQualityGate)) {
  throw new Error("The article verifier gate is not fully passed.");
}

const sqlite = new Database(DB_PATH);
const readPost = sqlite.prepare(`
  SELECT id, title, slug, meta_title, meta_description, status,
         shopify_article_id, shopify_blog_id, overall_score, word_count
  FROM blog_posts
  WHERE id = ? AND company_id = ?
`);
const markPublished = sqlite.prepare(`
  UPDATE blog_posts
  SET status = 'published', shopify_synced_at = ?, updated_at = ?
  WHERE id = ? AND company_id = ? AND shopify_article_id = ?
`);

const rows = [];
for (const item of manifest.posts) {
  const local = readPost.get(item.id, COMPANY_ID);
  const draft = draftResults.results.find((candidate) => candidate.postId === item.id);
  if (!local || !draft) throw new Error(`Missing local or Shopify draft record for ${item.id}.`);
  if (local.slug !== item.slug || draft.slug !== item.slug) throw new Error(`Slug mismatch for ${item.id}.`);
  if (Number(local.overall_score) < 80) throw new Error(`Verifier score below 80 for ${item.slug}.`);
  if (Number(local.shopify_article_id) !== Number(draft.shopifyArticleId)) {
    throw new Error(`Shopify article ID mismatch for ${item.slug}.`);
  }

  const article = await getArticle(draft.shopifyArticleId);
  const seo = await getSeo(article.id);
  if (!article || article.handle !== item.slug || article.title !== item.title) {
    throw new Error(`Shopify identity mismatch for ${item.slug}.`);
  }
  if (VERIFY_EXISTING && !article.published_at) throw new Error(`${item.slug} is not published.`);
  if (!VERIFY_EXISTING && article.published_at !== null) throw new Error(`${item.slug} is already published.`);
  if (!/cdn\.shopify\.com/.test(article.image?.src || "") || !/cdn\.shopify\.com/.test(article.body_html || "")) {
    throw new Error(`Shopify CDN image verification failed for ${item.slug}.`);
  }
  if (/localhost|127\.0\.0\.1|\/api\/blog\/photos\/serve\//.test(article.body_html || "")) {
    throw new Error(`Unsafe local image URL remains in ${item.slug}.`);
  }
  if (seo.title_tag !== local.meta_title || seo.description_tag !== local.meta_description) {
    throw new Error(`SEO metafield mismatch for ${item.slug}.`);
  }
  const articleTags = String(article.tags || "").toLowerCase();
  if (!VERIFY_EXISTING && (!articleTags.includes("review draft") || !articleTags.includes("do not publish"))) {
    throw new Error(`Review safety tags are missing from ${item.slug}.`);
  }
  rows.push({ item, local, draft, article, seo });
}

const preflight = rows.map(({ item, local, article }) => ({
  title: item.title,
  slug: item.slug,
  articleId: Number(article.id),
  publishedAt: article.published_at,
  verifierScore: Number(local.overall_score),
  wordCount: Number(local.word_count),
  heroUrl: article.image?.src || null,
}));
const mode = VERIFY_EXISTING ? "verify-existing" : SHOULD_PUBLISH ? "publish" : "preflight";
console.log(JSON.stringify({ mode, count: preflight.length, preflight }, null, 2));

if (!SHOULD_PUBLISH && !VERIFY_EXISTING) {
  sqlite.close();
  process.exit(0);
}

let backupPath = null;
if (SHOULD_PUBLISH) {
  await mkdir(BACKUP_DIR, { recursive: true });
  backupPath = path.join(BACKUP_DIR, `pre-publish-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(backupPath, `${JSON.stringify({
    capturedAt: new Date().toISOString(),
    shop: SHOP,
    blogId: BLOG_ID,
    articles: rows.map(({ article, seo }) => ({ article, seo })),
  }, null, 2)}\n`, "utf8");
}

if (SHOULD_PUBLISH) {
  for (const { article } of rows) {
    await shopify("PUT", `blogs/${BLOG_ID}/articles/${article.id}.json`, {
      article: {
        id: article.id,
        published: true,
        tags: cleanLiveTags(),
      },
    });
  }
}

const verified = [];
for (const { item, local, draft } of rows) {
  const article = await getArticle(draft.shopifyArticleId);
  const seo = await getSeo(article.id);
  const url = publicUrl(item.slug);
  const response = await fetchLive(url);
  const liveHtml = response ? await response.text() : "";
  const reviewTagsRemain = String(article.tags || "")
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .some((tag) => REVIEW_TAGS.has(tag));
  const checks = {
    published: Boolean(article.published_at),
    publicHttp200: response?.status === 200,
    expectedFinalUrl: response?.url === url,
    seoTitle: seo.title_tag === local.meta_title,
    seoDescription: seo.description_tag === local.meta_description,
    heroCdn: /cdn\.shopify\.com/.test(article.image?.src || ""),
    bodyCdn: /cdn\.shopify\.com/.test(article.body_html || ""),
    noLocalUrls: !/localhost|127\.0\.0\.1|\/api\/blog\/photos\/serve\//.test(article.body_html || ""),
    reviewTagsRemoved: !reviewTagsRemain,
    allArticleTagsRemoved: String(article.tags || "").trim() === "",
    noNoindex: !/<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(liveHtml),
  };
  if (Object.values(checks).some((value) => value !== true)) {
    throw new Error(`Post-publication verification failed for ${item.slug}: ${JSON.stringify(checks)}`);
  }
  verified.push({
    postId: item.id,
    title: item.title,
    slug: item.slug,
    shopifyArticleId: Number(article.id),
    publishedAt: article.published_at,
    publicUrl: url,
    adminUrl: adminUrl(Number(article.id)),
    heroCdnUrl: article.image?.src || null,
    verifierScore: Number(local.overall_score),
    checks,
  });
}

const completedAt = new Date().toISOString();
const saveAll = sqlite.transaction(() => {
  for (const result of verified) {
    const changes = markPublished.run(completedAt, Date.now(), result.postId, COMPANY_ID, result.shopifyArticleId);
    if (changes.changes !== 1) throw new Error(`Local published-state update failed for ${result.slug}.`);
  }
});
saveAll();
sqlite.close();

manifest.shopifyPublished = true;
manifest.publishedAt = completedAt;
manifest.posts = manifest.posts.map((post) => {
  const result = verified.find((candidate) => candidate.postId === post.id);
  return result ? { ...post, status: "published", shopifyArticleId: result.shopifyArticleId } : post;
});
await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await writeFile(RESULT_PATH, `${JSON.stringify({
  completedAt,
  shop: SHOP,
  blogId: BLOG_ID,
  count: verified.length,
  backupPath,
  results: verified,
}, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ completedAt, backupPath, resultPath: RESULT_PATH, results: verified }, null, 2));
