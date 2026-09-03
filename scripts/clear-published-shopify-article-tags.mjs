#!/usr/bin/env node

import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SHOP = (process.env.SHOPIFY_SHOP || "iboltmounts").replace(/\.myshopify\.com$/i, "");
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN || "";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";
const BLOG_IDS = [104843772196, 110121517348];
const OUTPUT_DIR = path.resolve("content-output/production-blog-tag-cleanup-2026-09-01");
const SHOULD_APPLY = process.argv.includes("--apply");
const expectedArg = process.argv.find((arg) => arg.startsWith("--expected-count="));
const EXPECTED_COUNT = expectedArg ? Number(expectedArg.split("=")[1]) : null;

if (!TOKEN) throw new Error("Shopify access token is not configured.");
if (!SHOP) throw new Error("SHOPIFY_SHOP is not configured.");
if (SHOULD_APPLY && !Number.isInteger(EXPECTED_COUNT)) {
  throw new Error("Apply mode requires --expected-count=<preflight count>.");
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function parseTags(value) {
  return String(value || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function nextLink(value) {
  for (const part of String(value || "").split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/i);
    if (match) return match[1];
  }
  return null;
}

async function shopify(method, endpointOrUrl, body) {
  const url = endpointOrUrl.startsWith("http")
    ? endpointOrUrl
    : `https://${SHOP}.myshopify.com/admin/api/${API_VERSION}/${endpointOrUrl}`;
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": TOKEN,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`Shopify ${method} ${url} failed: ${response.status} ${text.slice(0, 1200)}`);
  }
  return { json, headers: response.headers };
}

async function listArticles(blogId) {
  const rows = [];
  let url = `blogs/${blogId}/articles.json?limit=250&published_status=any&fields=id,title,handle,tags,published_at,updated_at`;
  while (url) {
    const response = await shopify("GET", url);
    rows.push(...(response.json.articles || []).map((article) => ({ ...article, blogId })));
    url = nextLink(response.headers.get("link"));
  }
  return rows;
}

async function getArticle(blogId, articleId) {
  const response = await shopify(
    "GET",
    `blogs/${blogId}/articles/${articleId}.json?fields=id,title,handle,tags,published_at,updated_at`,
  );
  return response.json.article;
}

async function collectState() {
  const groups = await Promise.all(BLOG_IDS.map((blogId) => listArticles(blogId)));
  const articles = groups.flat();
  const ids = new Set(articles.map((article) => String(article.id)));
  if (ids.size !== articles.length) throw new Error("Duplicate Shopify article IDs found during preflight.");
  const publishedTagged = articles.filter(
    (article) => Boolean(article.published_at) && parseTags(article.tags).length > 0,
  );
  return {
    articles,
    publishedTagged,
    hiddenTagged: articles.filter(
      (article) => !article.published_at && parseTags(article.tags).length > 0,
    ),
  };
}

function publicUrl(article) {
  return `https://iboltmounts.com/blogs/news/${article.handle}`;
}

function compactArticle(article) {
  return {
    blogId: article.blogId,
    id: Number(article.id),
    title: article.title,
    handle: article.handle,
    tags: article.tags || "",
    publishedAt: article.published_at,
    updatedAt: article.updated_at,
    publicUrl: article.published_at ? publicUrl(article) : null,
  };
}

async function verifyStorefront() {
  let last = null;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const url = `https://iboltmounts.com/blogs/news?tag_cleanup_verify=${Date.now()}`;
    const response = await fetch(url, {
      redirect: "follow",
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
    const html = await response.text();
    last = {
      attempt,
      status: response.status,
      finalUrl: response.url,
      hasArticleCards: /blog-post-card/.test(html),
      primaryBadgeCount: (html.match(/badge--primary/g) || []).length,
      currentBadgeCount: (html.match(/badge--current/g) || []).length,
      deviceCustodyCount: (html.match(/device custody/gi) || []).length,
    };
    if (
      last.status === 200 &&
      last.hasArticleCards &&
      last.primaryBadgeCount === 0 &&
      last.currentBadgeCount === 0
    ) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
  }
  throw new Error(`Storefront tag verification failed: ${JSON.stringify(last)}`);
}

await mkdir(OUTPUT_DIR, { recursive: true });
const before = await collectState();
const plan = {
  generatedAt: new Date().toISOString(),
  mode: SHOULD_APPLY ? "apply" : "preflight",
  shop: SHOP,
  apiVersion: API_VERSION,
  blogIds: BLOG_IDS,
  scanned: before.articles.length,
  publishedTaggedCount: before.publishedTagged.length,
  hiddenTaggedCount: before.hiddenTagged.length,
  invariant: "Published Shopify articles have blank tags; hidden review drafts retain their workflow tags.",
  targets: before.publishedTagged.map(compactArticle),
};
const preflightPath = path.join(OUTPUT_DIR, `preflight-${timestamp()}.json`);
await writeFile(preflightPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ preflightPath, ...plan }, null, 2));

if (!SHOULD_APPLY) process.exit(0);
if (before.publishedTagged.length !== EXPECTED_COUNT) {
  throw new Error(
    `Published tagged count changed after review: expected ${EXPECTED_COUNT}, found ${before.publishedTagged.length}.`,
  );
}

const results = [];
for (const original of before.publishedTagged) {
  const current = await getArticle(original.blogId, original.id);
  const identityMatches =
    current &&
    String(current.id) === String(original.id) &&
    current.title === original.title &&
    current.handle === original.handle &&
    current.published_at === original.published_at &&
    current.tags === original.tags;
  if (!identityMatches) {
    throw new Error(`Article changed after preflight: ${original.id} ${original.handle}.`);
  }

  await shopify("PUT", `blogs/${original.blogId}/articles/${original.id}.json`, {
    article: { id: original.id, tags: "" },
  });
  const verified = await getArticle(original.blogId, original.id);
  const checks = {
    identityPreserved:
      String(verified.id) === String(original.id) &&
      verified.title === original.title &&
      verified.handle === original.handle,
    publicationPreserved: verified.published_at === original.published_at,
    tagsCleared: parseTags(verified.tags).length === 0,
  };
  if (Object.values(checks).some((value) => value !== true)) {
    throw new Error(`Per-article verification failed for ${original.id}: ${JSON.stringify(checks)}`);
  }
  results.push({
    ...compactArticle(original),
    previousTags: parseTags(original.tags),
    currentTags: parseTags(verified.tags),
    checks,
  });
  console.log(`Cleared and verified tags: ${original.title}`);
}

const after = await collectState();
if (after.publishedTagged.length !== 0) {
  throw new Error(`Final API verification found ${after.publishedTagged.length} published tagged article(s).`);
}
if (after.hiddenTagged.length !== before.hiddenTagged.length) {
  throw new Error("Hidden-review tag count changed unexpectedly.");
}
const storefront = await verifyStorefront();
const completed = {
  completedAt: new Date().toISOString(),
  shop: SHOP,
  scanned: after.articles.length,
  changed: results.length,
  publishedTaggedAfter: after.publishedTagged.length,
  hiddenTaggedBefore: before.hiddenTagged.length,
  hiddenTaggedAfter: after.hiddenTagged.length,
  storefront,
  preflightPath,
  results,
};
const resultPath = path.join(OUTPUT_DIR, `result-${timestamp()}.json`);
await writeFile(resultPath, `${JSON.stringify(completed, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ resultPath, ...completed }, null, 2));
