#!/usr/bin/env node

import "dotenv/config";
import Database from "better-sqlite3";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const COMPANY_ID = "ibolt-default-company";
const SERIES_TAG = "locking-tablet-security-series-2026-08-26";
const SERIES_DIR = path.resolve("content-output/ibolt-locking-tablet-security-series-2026-08-26");
const MANIFEST_PATH = path.join(SERIES_DIR, "shopify-review", "review-manifest.json");
const OUTPUT_PATH = path.join(SERIES_DIR, "shopify-review", "shopify-draft-results.json");
const DB_PATH = path.resolve(process.env.DATABASE_PATH || "data/standalone-blog-writer.db");
const SHOP = (process.env.SHOPIFY_SHOP || "iboltmounts").replace(/\.myshopify\.com$/i, "");
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN || "";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";
const BLOG_ID = Number(process.env.SHOPIFY_NEWS_BLOG_ID || 104843772196);

const tagMap = {
  "locking-pos-mounts-prevent-tablet-theft": ["restaurant", "POS", "restaurant tablet mount"],
  "secure-tablets-retail-kiosks": ["retail", "kiosk", "retail tablet security"],
  "locking-eld-mounts-shared-fleet-tablets": ["fleet", "ELD", "trucking"],
  "locking-forklift-tablet-mount-device-security": ["forklift", "warehouse", "material handling"],
  "secure-tablets-industrial-workstations": ["industrial", "workstation", "device custody"],
};

if (!TOKEN) throw new Error("SHOPIFY_ACCESS_TOKEN or SHOPIFY_ADMIN_API_ACCESS_TOKEN is not configured.");
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
  return { json, headers: Object.fromEntries(response.headers.entries()) };
}

async function listAllArticles() {
  const articles = [];
  let endpoint = `blogs/${BLOG_ID}/articles.json?limit=250&published_status=any`;
  while (endpoint) {
    const result = await shopify("GET", endpoint);
    articles.push(...(result.json.articles || []));
    const next = (result.headers.link || "")
      .split(",")
      .map((part) => part.trim())
      .find((part) => /rel="next"/.test(part))
      ?.match(/<([^>]+)>/)?.[1];
    if (!next) {
      endpoint = "";
      continue;
    }
    const nextUrl = new URL(next);
    endpoint = `${nextUrl.pathname.split(`/admin/api/${API_VERSION}/`)[1]}${nextUrl.search}`;
  }
  return articles;
}

function adminUrl(articleId) {
  return `https://admin.shopify.com/store/${SHOP}/content/articles/${articleId}`;
}

function replaceHeroReferences(html, replacement) {
  let result = html.replace(
    /src="http:\/\/(?:localhost|127\.0\.0\.1):5001\/api\/public\/blog\/photos\/serve\/[^"]+"/g,
    `src="${replacement}"`,
  );
  result = result.replace(
    /"image":\s*"\/api\/blog\/photos\/serve\/[^"]+"/g,
    `"image": "${replacement}"`,
  );
  return result;
}

function buildArticlePayload(post, bodyHtml, imageAttachment) {
  const tags = [
    "iBOLT",
    "locking tablet mount",
    "tablet security",
    "device custody",
    SERIES_TAG,
    "review draft",
    "do not publish",
    ...(tagMap[post.slug] || []),
  ];
  return {
    title: post.title,
    handle: post.slug,
    body_html: bodyHtml,
    published: false,
    author: "iBOLT Mounts",
    tags: tags.join(", "),
    ...(imageAttachment ? { image: imageAttachment } : {}),
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
}

async function ensureSeoMetafields(articleId, post) {
  const definitions = [
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
  ];
  const currentResult = await shopify("GET", `articles/${articleId}/metafields.json`);
  const current = currentResult.json.metafields || [];
  for (const definition of definitions) {
    const existing = current.find((field) => field.namespace === definition.namespace && field.key === definition.key);
    if (existing) {
      await shopify("PUT", `metafields/${existing.id}.json`, {
        metafield: { id: existing.id, value: definition.value, type: definition.type },
      });
    } else {
      await shopify("POST", `articles/${articleId}/metafields.json`, { metafield: definition });
    }
  }
  const verifiedResult = await shopify("GET", `articles/${articleId}/metafields.json`);
  return (verifiedResult.json.metafields || []).filter(
    (field) => field.namespace === "global" && ["title_tag", "description_tag"].includes(field.key),
  );
}

const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
if (manifest.shopifyPublished !== false || manifest.posts?.length !== 5) {
  throw new Error("Expected a five-post unpublished review manifest.");
}

const sqlite = new Database(DB_PATH);
const readPost = sqlite.prepare(`
  SELECT id, company_id, title, slug, meta_title, meta_description, status,
         shopify_article_id, shopify_blog_id, overall_score, word_count
  FROM blog_posts
  WHERE id = ? AND company_id = ?
`);
const saveSync = sqlite.prepare(`
  UPDATE blog_posts
  SET html = ?, status = 'approved', shopify_article_id = ?, shopify_blog_id = ?,
      shopify_synced_at = ?, updated_at = ?
  WHERE id = ? AND company_id = ?
`);

const localPosts = manifest.posts.map((item) => {
  const post = readPost.get(item.id, COMPANY_ID);
  if (!post) throw new Error(`Local post not found: ${item.id}`);
  if (post.slug !== item.slug) throw new Error(`Slug mismatch for ${item.id}`);
  if (post.status === "published") throw new Error(`Refusing to sync published local post: ${item.slug}`);
  if (Number(post.overall_score) < 80) throw new Error(`Verifier score below gate for ${item.slug}`);
  return { item, post };
});

const articles = await listAllArticles();
for (const { post } of localPosts) {
  const existing = articles.find((article) => article.handle === post.slug || Number(article.id) === Number(post.shopify_article_id));
  if (existing?.published_at) {
    throw new Error(`Refusing to overwrite published Shopify article ${existing.id} for ${post.slug}`);
  }
}

const results = [];
for (const { item, post } of localPosts) {
  const sourceHtml = await readFile(item.htmlPath, "utf8");
  if (!/localhost|127\.0\.0\.1/.test(sourceHtml) || !/\/api\/blog\/photos\/serve\//.test(sourceHtml)) {
    throw new Error(`Expected local hero references were not found in ${post.slug}`);
  }
  const imageBytes = await readFile(item.heroAsset);
  const imageAttachment = {
    attachment: imageBytes.toString("base64"),
    filename: path.basename(item.heroAsset),
    alt: item.slug === "locking-pos-mounts-prevent-tablet-theft"
      ? "Locking POS tablet stand on a restaurant counter with controlled key access"
      : item.slug === "secure-tablets-retail-kiosks"
        ? "Fixed locking tablet stand at a customer-facing retail kiosk"
        : item.slug === "locking-eld-mounts-shared-fleet-tablets"
          ? "Compact locking ELD tablet mount below the windshield in a parked fleet van"
          : item.slug === "locking-forklift-tablet-mount-device-security"
            ? "Supervisor checking a locking forklift tablet mount before a warehouse shift"
            : "Key-controlled locking tablet mount at an industrial quality workstation",
  };
  const temporaryHtml = replaceHeroReferences(sourceHtml, "");
  let article = articles.find((candidate) => candidate.handle === post.slug || Number(candidate.id) === Number(post.shopify_article_id));
  let action = "created";

  if (article) {
    const updated = await shopify("PUT", `blogs/${BLOG_ID}/articles/${article.id}.json`, {
      article: { id: article.id, ...buildArticlePayload(post, temporaryHtml, imageAttachment) },
    });
    article = updated.json.article;
    action = "updated";
  } else {
    const created = await shopify("POST", `blogs/${BLOG_ID}/articles.json`, {
      article: buildArticlePayload(post, temporaryHtml, imageAttachment),
    });
    article = created.json.article;
    articles.push(article);
  }

  if (!article?.id) throw new Error(`Shopify did not return an article ID for ${post.slug}`);
  let heroCdnUrl = article.image?.src || "";
  if (!heroCdnUrl) {
    const fetched = await shopify("GET", `blogs/${BLOG_ID}/articles/${article.id}.json`);
    article = fetched.json.article;
    heroCdnUrl = article?.image?.src || "";
  }
  if (!heroCdnUrl) throw new Error(`Shopify did not return a CDN URL for ${post.slug}`);

  const finalHtml = replaceHeroReferences(sourceHtml, heroCdnUrl);
  if (/localhost|127\.0\.0\.1|\/api\/blog\/photos\/serve\//.test(finalHtml)) {
    throw new Error(`Local photo URL remained after replacement for ${post.slug}`);
  }
  const finalUpdate = await shopify("PUT", `blogs/${BLOG_ID}/articles/${article.id}.json`, {
    article: { id: article.id, ...buildArticlePayload(post, finalHtml) },
  });
  article = finalUpdate.json.article;

  const verified = await shopify("GET", `blogs/${BLOG_ID}/articles/${article.id}.json`);
  const verifiedArticle = verified.json.article;
  if (verifiedArticle.published_at !== null) throw new Error(`Safety check failed: ${post.slug} is published.`);
  if (verifiedArticle.handle !== post.slug) throw new Error(`Handle mismatch for ${post.slug}: ${verifiedArticle.handle}`);
  if (/localhost|127\.0\.0\.1|\/api\/blog\/photos\/serve\//.test(verifiedArticle.body_html || "")) {
    throw new Error(`Local image URL remained in Shopify body for ${post.slug}`);
  }
  if (!/cdn\.shopify\.com/.test(verifiedArticle.body_html || "") || !/cdn\.shopify\.com/.test(verifiedArticle.image?.src || "")) {
    throw new Error(`Shopify CDN image verification failed for ${post.slug}`);
  }
  if (!String(verifiedArticle.tags || "").includes("do not publish")) {
    throw new Error(`Draft safety tag is missing for ${post.slug}`);
  }

  const seoMetafields = await ensureSeoMetafields(article.id, post);
  const seoKeys = new Set(seoMetafields.map((field) => field.key));
  if (!seoKeys.has("title_tag") || !seoKeys.has("description_tag")) {
    throw new Error(`SEO metafield verification failed for ${post.slug}`);
  }

  const syncedAt = new Date().toISOString();
  saveSync.run(
    verifiedArticle.body_html,
    Number(article.id),
    BLOG_ID,
    syncedAt,
    Date.now(),
    post.id,
    COMPANY_ID,
  );
  results.push({
    postId: post.id,
    title: post.title,
    slug: post.slug,
    action,
    overallScore: Number(post.overall_score),
    wordCount: Number(post.word_count),
    shopifyArticleId: Number(article.id),
    shopifyBlogId: BLOG_ID,
    hidden: true,
    published: false,
    publishedAt: null,
    heroCdnUrl,
    seoMetafields: Array.from(seoKeys).sort(),
    tags: verifiedArticle.tags,
    localStatus: "approved",
    adminUrl: adminUrl(Number(article.id)),
    syncedAt,
  });
  console.log(`${action.toUpperCase()}: ${post.title} -> ${adminUrl(Number(article.id))}`);
}

await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  shop: SHOP,
  blogId: BLOG_ID,
  hidden: true,
  published: false,
  count: results.length,
  results,
}, null, 2)}\n`, "utf8");
console.log(`Wrote ${OUTPUT_PATH}`);
