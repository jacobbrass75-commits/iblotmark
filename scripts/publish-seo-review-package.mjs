#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE_DIR = path.resolve("content-output/seo-review-package-2026-06-10");
const API_VERSION = getEnv("SHOPIFY_API_VERSION", "2026-04");
const SHOP = getEnv("SHOPIFY_SHOP", "iboltmounts").replace(/\.myshopify\.com$/i, "");
const TOKEN =
  getEnv("SHOPIFY_ACCESS_TOKEN") ||
  getEnv("SHOPIFY_ADMIN_API_ACCESS_TOKEN") ||
  getEnv("SHOPIFY_ADMIN_ACCESS_TOKEN");
const REST_BASE = `https://${SHOP}.myshopify.com/admin/api/${API_VERSION}`;
const PUBLIC_BASE = "https://iboltmounts.com";
const NEWS_BLOG_ID = 104843772196;
const DRY_RUN = process.argv.includes("--dry-run");

function getEnv(key, fallback = "") {
  if (process.env[key]) return process.env[key];
  const envPath = path.resolve(".env");
  if (!existsSync(envPath)) return fallback;
  const match = readFileSync(envPath, "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!match) return fallback;
  return match[1].trim().replace(/^["']|["']$/g, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function shopifyRest(method, endpoint, body, attempt = 1) {
  const response = await fetch(`${REST_BASE}/${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": TOKEN,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if ((response.status === 429 || response.status >= 500) && attempt < 5) {
    const retryAfter = Number(response.headers.get("retry-after") || "1");
    await sleep(Math.max(1000, retryAfter * 1000));
    return shopifyRest(method, endpoint, body, attempt + 1);
  }
  if (!response.ok) {
    throw new Error(`Shopify REST ${method} ${endpoint} failed: ${response.status} ${text}`);
  }
  return { json, headers: response.headers };
}

async function publicJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Public fetch failed ${url}: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

function handleFromTarget(target) {
  const url = new URL(target);
  const pieces = url.pathname.split("/").filter(Boolean);
  return pieces.at(-1);
}

function payloadFiles() {
  const dir = path.join(BASE_DIR, "shopify-ready/payloads");
  return JSON.parse(readFileSync(path.join(BASE_DIR, "shopify-ready-manifest.json"), "utf8"))
    .map((item) => ({
      ...item,
      payloadPath: path.join(dir, `${item.id}.json`),
      payload: JSON.parse(readFileSync(path.join(dir, `${item.id}.json`), "utf8")),
      bodyHtml: readFileSync(path.join(BASE_DIR, item.bodyFile), "utf8"),
    }));
}

function metaFields(payload) {
  const seo = payload.suggestedFields?.seo || {};
  return {
    title: seo.title_tag || "",
    description: seo.description_tag || "",
  };
}

async function listCollections(endpoint) {
  const out = [];
  let next = `${endpoint}?limit=250`;
  while (next) {
    const { json, headers } = await shopifyRest("GET", next);
    out.push(...(json?.custom_collections || json?.smart_collections || []));
    const link = headers.get("link") || "";
    const match = link.match(/<https:\/\/[^/]+\/admin\/api\/[^/]+\/([^>]+)>;\s*rel="next"/);
    next = match ? match[1] : "";
  }
  return out;
}

async function listArticles(blogId) {
  const out = [];
  let next = `blogs/${blogId}/articles.json?limit=250`;
  while (next) {
    const { json, headers } = await shopifyRest("GET", next);
    out.push(...(json?.articles || []));
    const link = headers.get("link") || "";
    const match = link.match(/<https:\/\/[^/]+\/admin\/api\/[^/]+\/([^>]+)>;\s*rel="next"/);
    next = match ? match[1] : "";
  }
  return out;
}

async function publishProduct(item, backupDir) {
  const handle = handleFromTarget(item.sourceUrl);
  const publicProduct = await publicJson(`${PUBLIC_BASE}/products/${handle}.js`);
  const productId = publicProduct.id;
  const { json: before } = await shopifyRest("GET", `products/${productId}.json`);
  await writeFile(path.join(backupDir, `product-${handle}.before.json`), JSON.stringify(before, null, 2));
  const seo = metaFields(item.payload);
  const fields = item.payload.suggestedFields;
  const tags = Array.isArray(fields.tags) ? fields.tags.join(", ") : fields.tags || before.product.tags || "";
  const update = {
    product: {
      id: productId,
      body_html: fields.body_html,
      product_type: fields.product_type || before.product.product_type || "",
      tags,
      ...(seo.title ? { metafields_global_title_tag: seo.title } : {}),
      ...(seo.description ? { metafields_global_description_tag: seo.description } : {}),
    },
  };
  if (DRY_RUN) {
    return { type: "product", handle, id: productId, action: "would_update", url: item.sourceUrl };
  }
  const { json } = await shopifyRest("PUT", `products/${productId}.json`, update);
  return {
    type: "product",
    handle,
    id: productId,
    action: "updated",
    updatedAt: json.product.updated_at,
    url: item.sourceUrl,
  };
}

async function publishCollection(item, collectionMaps, backupDir) {
  const handle = handleFromTarget(item.sourceUrl);
  const match =
    collectionMaps.custom.get(handle)
    || collectionMaps.smart.get(handle);
  if (!match) throw new Error(`Collection not found: ${handle}`);
  const endpointBase = match.kind === "custom" ? "custom_collections" : "smart_collections";
  const { json: before } = await shopifyRest("GET", `${endpointBase}/${match.collection.id}.json`);
  await writeFile(
    path.join(backupDir, `collection-${handle}.before.json`),
    JSON.stringify(before, null, 2),
  );
  const seo = metaFields(item.payload);
  const resourceKey = match.kind === "custom" ? "custom_collection" : "smart_collection";
  const update = {
    [resourceKey]: {
      id: match.collection.id,
      body_html: item.payload.suggestedFields.body_html,
      ...(seo.title ? { metafields_global_title_tag: seo.title } : {}),
      ...(seo.description ? { metafields_global_description_tag: seo.description } : {}),
    },
  };
  if (DRY_RUN) {
    return {
      type: "collection",
      kind: match.kind,
      handle,
      id: match.collection.id,
      action: "would_update",
      url: item.sourceUrl,
    };
  }
  const { json } = await shopifyRest("PUT", `${endpointBase}/${match.collection.id}.json`, update);
  const updated = json[resourceKey];
  return {
    type: "collection",
    kind: match.kind,
    handle,
    id: match.collection.id,
    action: "updated",
    updatedAt: updated.updated_at,
    url: item.sourceUrl,
  };
}

async function publishArticle(item, articleMap, backupDir) {
  const handle = handleFromTarget(item.sourceUrl);
  const article = articleMap.get(handle);
  if (!article) throw new Error(`Article not found: ${handle}`);
  const { json: before } = await shopifyRest("GET", `blogs/${NEWS_BLOG_ID}/articles/${article.id}.json`);
  await writeFile(path.join(backupDir, `article-${handle}.before.json`), JSON.stringify(before, null, 2));
  const fields = item.payload.suggestedFields;
  const update = {
    article: {
      id: article.id,
      title: fields.title,
      body_html: fields.body_html,
      summary_html: fields.summary_html,
      tags: Array.isArray(fields.tags) ? fields.tags.join(", ") : fields.tags || article.tags || "",
      published: true,
    },
  };
  if (DRY_RUN) {
    return { type: "article", handle, id: article.id, action: "would_update", url: item.sourceUrl };
  }
  const { json } = await shopifyRest("PUT", `blogs/${NEWS_BLOG_ID}/articles/${article.id}.json`, update);
  return {
    type: "article",
    handle,
    id: article.id,
    action: "updated",
    updatedAt: json.article.updated_at,
    url: item.sourceUrl,
  };
}

async function verifyPublic(results) {
  const checks = [];
  for (const result of results.filter((item) => item.action === "updated")) {
    try {
      const response = await fetch(result.url, {
        headers: { "User-Agent": "Mozilla/5.0 iBOLT SEO verification" },
      });
      const html = await response.text();
      checks.push({
        ...result,
        publicStatus: response.status,
        hasFaq: /Frequently Asked Questions/i.test(html),
        hasAddToCart: /cart\/add\?id=/i.test(html),
        hasRemovedHeadings:
          /What AI Search Systems Need To Understand|Why This Page Is Built For AI Search/i.test(html),
      });
    } catch (error) {
      checks.push({ ...result, publicError: error.message });
    }
  }
  return checks;
}

async function main() {
  if (!TOKEN) throw new Error("SHOPIFY_ACCESS_TOKEN or SHOPIFY_ADMIN_API_ACCESS_TOKEN is required.");
  const liveDir = path.join(BASE_DIR, "live-shopify-ready");
  const backupDir = path.join(liveDir, "backups");
  await mkdir(liveDir, { recursive: true });
  await mkdir(backupDir, { recursive: true });

  const items = payloadFiles();
  const products = items.filter((item) => item.targetType === "product");
  const collections = items.filter((item) => item.targetType === "collection");
  const articles = items.filter((item) => item.targetType === "article_refresh");

  let collectionMaps = { custom: new Map(), smart: new Map() };
  let collectionScopeError = "";
  try {
    const customCollections = await listCollections("custom_collections.json");
    const smartCollections = await listCollections("smart_collections.json");
    collectionMaps = {
      custom: new Map(customCollections.map((collection) => [collection.handle, { kind: "custom", collection }])),
      smart: new Map(smartCollections.map((collection) => [collection.handle, { kind: "smart", collection }])),
    };
  } catch (error) {
    collectionScopeError = error.message;
  }
  const articleMap = new Map((await listArticles(NEWS_BLOG_ID)).map((article) => [article.handle, article]));

  const results = [];
  for (const item of products) {
    try {
      results.push(await publishProduct(item, backupDir));
    } catch (error) {
      results.push({
        type: "product",
        handle: handleFromTarget(item.sourceUrl),
        action: "blocked",
        url: item.sourceUrl,
        error: error.message,
      });
    }
  }
  for (const item of collections) {
    try {
      if (collectionScopeError) throw new Error(collectionScopeError);
      results.push(await publishCollection(item, collectionMaps, backupDir));
    } catch (error) {
      results.push({
        type: "collection",
        handle: handleFromTarget(item.sourceUrl),
        action: "blocked",
        url: item.sourceUrl,
        error: error.message,
      });
    }
  }
  for (const item of articles) {
    try {
      results.push(await publishArticle(item, articleMap, backupDir));
    } catch (error) {
      results.push({
        type: "article",
        handle: handleFromTarget(item.sourceUrl),
        action: "blocked",
        url: item.sourceUrl,
        error: error.message,
      });
    }
  }

  const publicChecks = DRY_RUN ? [] : await verifyPublic(results);
  const summary = {
    dryRun: DRY_RUN,
    generatedAt: new Date().toISOString(),
    results,
    publicChecks,
  };
  await writeFile(path.join(liveDir, DRY_RUN ? "dry-run-results.json" : "publish-results.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
