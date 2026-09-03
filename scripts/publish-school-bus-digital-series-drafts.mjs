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
const OUTPUT_PATH = path.join(SERIES_DIR, "shopify-review", "shopify-draft-publish-results.json");

const ITEMS = [
  {
    postId: "808dbfee-bcea-4e75-b599-cd315938b7c4",
    slug: "school-bus-driver-tablet-uses",
    html: "shopify-review/body-html/school-bus-driver-tablet-uses.shopify.html",
    image: "assets/school-bus-tablet-workflows-hero.png",
    imageAlt: "Mounted tablet in a parked school bus driver area at a fleet depot",
  },
  {
    postId: "f95e6feb-4607-471a-88fa-28b62ca2e4a1",
    slug: "school-bus-tablet-mount-requirements",
    html: "shopify-review/body-html/school-bus-tablet-mount-requirements.shopify.html",
    image: "assets/school-bus-tablet-mount-options-hero.png",
    imageAlt: "iBOLT style TabDock AMPS tablet mount installed low in a parked school bus",
  },
  {
    postId: "86da84aa-5a6c-42dc-ad6d-a851b2c1a05b",
    slug: "ibolt-school-bus-mounts-digital-fleet",
    html: "shopify-review/body-html/ibolt-school-bus-mounts-digital-fleet.shopify.html",
    image: "assets/ibolt-digital-school-bus-hero.png",
    imageAlt: "School bus fleet coordinator checking a mounted tablet in a parked bus",
  },
];

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

function replaceLocalHeroUrl(html, cdnUrl) {
  const replaced = html.replace(
    /src="http:\/\/(?:localhost|127\.0\.0\.1):5001\/api\/public\/blog\/photos\/serve\/[^\"]+"/,
    `src="${cdnUrl}"`,
  );
  if (replaced === html) {
    throw new Error("Could not find the local hero image URL in rendered article HTML.");
  }
  return replaced;
}

function buildArticlePayload(post, html, imageAttachment) {
  return {
    title: post.title,
    handle: post.slug,
    body_html: html,
    published: false,
    author: "iBOLT Mounts",
    tags: [
      "school bus",
      "tablet mount",
      "school transportation",
      "iBOLT",
      "school-bus-digital-series-2026-08-25",
      "review draft",
      "do not publish",
    ].join(", "),
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

const sqlite = new Database(DB_PATH);
const readPost = sqlite.prepare(`
  SELECT id, company_id, title, slug, meta_title, meta_description, status,
         shopify_article_id, shopify_blog_id
  FROM blog_posts
  WHERE id = ? AND company_id = ?
`);
const saveSync = sqlite.prepare(`
  UPDATE blog_posts
  SET html = ?, status = 'approved', shopify_article_id = ?, shopify_blog_id = ?,
      shopify_synced_at = ?, updated_at = ?
  WHERE id = ? AND company_id = ?
`);

const localPosts = ITEMS.map((item) => {
  const post = readPost.get(item.postId, COMPANY_ID);
  if (!post) throw new Error(`Local post not found: ${item.postId}`);
  if (post.slug !== item.slug) throw new Error(`Slug mismatch for ${item.postId}`);
  if (post.status === "published") throw new Error(`Refusing to sync published local post: ${item.slug}`);
  return { item, post };
});

const articles = await listAllArticles();
for (const { item, post } of localPosts) {
  const existing = articles.find((article) => article.handle === item.slug || Number(article.id) === Number(post.shopify_article_id));
  if (existing?.published_at) {
    throw new Error(`Refusing to overwrite published Shopify article ${existing.id} for ${item.slug}`);
  }
}

const results = [];
for (const { item, post } of localPosts) {
  const sourceHtml = await readFile(path.join(SERIES_DIR, item.html), "utf8");
  const imageBytes = await readFile(path.join(SERIES_DIR, item.image));
  const filename = path.basename(item.image);
  const imageAttachment = {
    attachment: imageBytes.toString("base64"),
    filename,
    alt: item.imageAlt,
  };
  const temporaryHtml = sourceHtml.replace(
    /src="http:\/\/(?:localhost|127\.0\.0\.1):5001\/api\/public\/blog\/photos\/serve\/[^\"]+"/,
    "src=\"\"",
  );
  let article = articles.find((candidate) => candidate.handle === item.slug || Number(candidate.id) === Number(post.shopify_article_id));
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

  if (!article?.id) throw new Error(`Shopify did not return an article ID for ${item.slug}`);
  let heroCdnUrl = article.image?.src || "";
  if (!heroCdnUrl) {
    const fetched = await shopify("GET", `blogs/${BLOG_ID}/articles/${article.id}.json`);
    article = fetched.json.article;
    heroCdnUrl = article?.image?.src || "";
  }
  if (!heroCdnUrl) throw new Error(`Shopify did not return a CDN URL for ${item.slug}`);

  const finalHtml = replaceLocalHeroUrl(sourceHtml, heroCdnUrl);
  const finalUpdate = await shopify("PUT", `blogs/${BLOG_ID}/articles/${article.id}.json`, {
    article: {
      id: article.id,
      ...buildArticlePayload(post, finalHtml),
    },
  });
  article = finalUpdate.json.article;

  const verified = await shopify("GET", `blogs/${BLOG_ID}/articles/${article.id}.json`);
  const verifiedArticle = verified.json.article;
  if (verifiedArticle.published_at !== null) {
    throw new Error(`Safety check failed: ${item.slug} is published instead of draft.`);
  }
  if (verifiedArticle.handle !== item.slug) {
    throw new Error(`Handle mismatch for ${item.slug}: ${verifiedArticle.handle}`);
  }
  if (/localhost|127\.0\.0\.1/.test(verifiedArticle.body_html || "")) {
    throw new Error(`Localhost image URL remained in Shopify body for ${item.slug}`);
  }
  if (!/cdn\.shopify\.com/.test(verifiedArticle.body_html || "")) {
    throw new Error(`Shopify CDN image URL was not found in the article body for ${item.slug}`);
  }

  const metafieldsResult = await shopify("GET", `articles/${article.id}/metafields.json`);
  const seoMetafields = (metafieldsResult.json.metafields || []).filter(
    (field) => field.namespace === "global" && ["title_tag", "description_tag"].includes(field.key),
  );
  const syncedAt = new Date().toISOString();
  saveSync.run(
    verifiedArticle.body_html,
    Number(article.id),
    BLOG_ID,
    syncedAt,
    Date.now(),
    item.postId,
    COMPANY_ID,
  );
  results.push({
    postId: item.postId,
    title: post.title,
    slug: item.slug,
    action,
    shopifyArticleId: Number(article.id),
    shopifyBlogId: BLOG_ID,
    published: false,
    publishedAt: null,
    heroCdnUrl,
    seoMetafields: seoMetafields.map((field) => field.key),
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
  published: false,
  count: results.length,
  results,
}, null, 2)}\n`);
console.log(`Wrote ${OUTPUT_PATH}`);
