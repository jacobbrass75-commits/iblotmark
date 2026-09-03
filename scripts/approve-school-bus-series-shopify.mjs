#!/usr/bin/env node

import "dotenv/config";
import Database from "better-sqlite3";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const COMPANY_ID = "ibolt-default-company";
const SERIES_DIR = path.resolve("content-output/ibolt-school-bus-digital-series-2026-08-25");
const DB_PATH = path.resolve(process.env.DATABASE_PATH || "data/standalone-blog-writer.db");
const SHOP = process.env.SHOPIFY_SHOP || "iboltmounts";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";
const BLOG_ID = Number(process.env.SHOPIFY_NEWS_BLOG_ID || 104843772196);
const MIDDLE_IMAGE_PATH = path.join(SERIES_DIR, "assets/school-bus-tablet-mount-options-hero-v2.png");
const RESULT_PATH = path.join(SERIES_DIR, "shopify-review", "shopify-approval-results.json");
const BACKUP_PATH = path.join(SERIES_DIR, "shopify-review", "backups", "before-first-third-live-middle-image-v2.json");

const FIRST = {
  postId: "808dbfee-bcea-4e75-b599-cd315938b7c4",
  articleId: 635890696484,
  slug: "school-bus-driver-tablet-uses",
};
const MIDDLE = {
  postId: "f95e6feb-4607-471a-88fa-28b62ca2e4a1",
  articleId: 635890729252,
  slug: "school-bus-tablet-mount-requirements",
};
const LAST = {
  postId: "86da84aa-5a6c-42dc-ad6d-a851b2c1a05b",
  articleId: 635890762020,
  slug: "ibolt-school-bus-mounts-digital-fleet",
};

if (!TOKEN) throw new Error("SHOPIFY_ACCESS_TOKEN is not configured in .env.");
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
  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`Shopify ${method} ${endpoint} failed: ${response.status} ${text.slice(0, 1200)}`);
  }
  return json;
}

async function getArticle(articleId) {
  const result = await shopify("GET", `blogs/${BLOG_ID}/articles/${articleId}.json`);
  return result.article;
}

async function updateArticle(articleId, updates) {
  const result = await shopify("PUT", `blogs/${BLOG_ID}/articles/${articleId}.json`, {
    article: { id: articleId, ...updates },
  });
  return result.article;
}

function publicUrl(slug) {
  return `https://iboltmounts.com/blogs/news/${slug}`;
}

function adminUrl(articleId) {
  return `https://admin.shopify.com/store/${SHOP}/content/articles/${articleId}`;
}

function cleanLiveTags() {
  return "";
}

function replaceFirstImageSrc(html, newUrl) {
  const replaced = String(html || "").replace(/(<img\s+[^>]*?src=")[^"]+("[^>]*>)/i, `$1${newUrl}$2`);
  if (replaced === html) throw new Error("Could not replace the middle article hero image URL.");
  return replaced;
}

const originals = {};
for (const item of [FIRST, MIDDLE, LAST]) {
  const article = await getArticle(item.articleId);
  if (!article || article.handle !== item.slug) {
    throw new Error(`Shopify article identity mismatch for ${item.slug}`);
  }
  originals[item.slug] = article;
}
if (originals[MIDDLE.slug].published_at) {
  throw new Error("The middle article is already live. Refusing to replace its image without a fresh published-page review.");
}

await mkdir(path.dirname(BACKUP_PATH), { recursive: true });
await writeFile(BACKUP_PATH, `${JSON.stringify({
  capturedAt: new Date().toISOString(),
  shop: SHOP,
  blogId: BLOG_ID,
  articles: originals,
}, null, 2)}\n`);

const imageBytes = await readFile(MIDDLE_IMAGE_PATH);
let middleUpdated = await updateArticle(MIDDLE.articleId, {
  published: false,
  image: {
    attachment: imageBytes.toString("base64"),
    filename: path.basename(MIDDLE_IMAGE_PATH),
    alt: "Compact iBOLT TabDock Bizmount AMPS tablet mount installed low in a parked school bus cockpit",
  },
});
if (!middleUpdated.image?.src) middleUpdated = await getArticle(MIDDLE.articleId);
const middleHeroUrl = middleUpdated.image?.src || "";
if (!middleHeroUrl) throw new Error("Shopify did not return a CDN URL for the replacement middle image.");

const middleBody = replaceFirstImageSrc(originals[MIDDLE.slug].body_html, middleHeroUrl)
  .replace(
    "iBOLT style TabDock AMPS tablet mount installed low in a parked school bus",
    "Compact iBOLT TabDock Bizmount AMPS tablet mount installed low in a parked school bus cockpit",
  )
  .replace(
    "A low, fixed AMPS-style installation concept based on the actual iBOLT TabDock Bizmount AMPS. Editorial B-roll. Use official product photos below for definitive product details.",
    "A compact fixed tablet mount installed low in a parked school bus driver area. Editorial B-roll. Use official product photos below for definitive product details.",
  )
  .replace(
    /"image":\s*"(?:\/api\/blog\/photos\/serve\/[^\"]+|https:\/\/cdn\.shopify\.com\/s\/files\/[^\"]+)"/,
    `"image": "${middleHeroUrl}"`,
  );
middleUpdated = await updateArticle(MIDDLE.articleId, {
  published: false,
  body_html: middleBody,
});

for (const item of [FIRST, LAST]) {
  const original = originals[item.slug];
  await updateArticle(item.articleId, {
    published: true,
    tags: cleanLiveTags(),
  });
}

const verified = {};
for (const item of [FIRST, MIDDLE, LAST]) {
  verified[item.slug] = await getArticle(item.articleId);
}
if (!verified[FIRST.slug].published_at || !verified[LAST.slug].published_at) {
  throw new Error("Approval verification failed: first and last articles are not both live.");
}
if (String(verified[FIRST.slug].tags || "").trim() || String(verified[LAST.slug].tags || "").trim()) {
  throw new Error("Approval verification failed: a published school-bus article still has visible tags.");
}
if (verified[MIDDLE.slug].published_at !== null) {
  throw new Error("Approval verification failed: middle article is not hidden.");
}
if (!verified[MIDDLE.slug].body_html.includes(middleHeroUrl)) {
  throw new Error("Approval verification failed: middle article body does not use the replacement image.");
}
if (!verified[MIDDLE.slug].image?.src?.includes("school-bus-tablet-mount-options-hero-v2")) {
  throw new Error("Approval verification failed: middle article featured image was not replaced.");
}

const sqlite = new Database(DB_PATH);
const updateLocal = sqlite.prepare(`
  UPDATE blog_posts
  SET status = ?, html = COALESCE(?, html), shopify_synced_at = ?, updated_at = ?
  WHERE id = ? AND company_id = ? AND shopify_article_id = ?
`);
const syncedAt = new Date().toISOString();
const updateMany = sqlite.transaction(() => {
  updateLocal.run("published", null, syncedAt, Date.now(), FIRST.postId, COMPANY_ID, FIRST.articleId);
  updateLocal.run("approved", verified[MIDDLE.slug].body_html, syncedAt, Date.now(), MIDDLE.postId, COMPANY_ID, MIDDLE.articleId);
  updateLocal.run("published", null, syncedAt, Date.now(), LAST.postId, COMPANY_ID, LAST.articleId);
});
updateMany();

const results = [FIRST, MIDDLE, LAST].map((item) => ({
  postId: item.postId,
  title: verified[item.slug].title,
  slug: item.slug,
  shopifyArticleId: item.articleId,
  status: verified[item.slug].published_at ? "published" : "hidden",
  publishedAt: verified[item.slug].published_at,
  adminUrl: adminUrl(item.articleId),
  publicUrl: verified[item.slug].published_at ? publicUrl(item.slug) : null,
  featuredImageUrl: verified[item.slug].image?.src || null,
}));

await writeFile(RESULT_PATH, `${JSON.stringify({
  completedAt: syncedAt,
  shop: SHOP,
  blogId: BLOG_ID,
  middleReplacementPhotoId: "3a29e824-8924-4181-984f-d3d4425d0b13",
  middleReplacementAsset: MIDDLE_IMAGE_PATH,
  results,
}, null, 2)}\n`);

for (const result of results) {
  console.log(`${result.status.toUpperCase()}: ${result.title} -> ${result.publicUrl || result.adminUrl}`);
}
console.log(`Wrote ${RESULT_PATH}`);
console.log(`Backup ${BACKUP_PATH}`);
