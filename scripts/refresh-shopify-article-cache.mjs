#!/usr/bin/env node

import "dotenv/config";

const execute = process.argv.includes("--execute");
const articleId = process.argv.find((arg) => arg.startsWith("--article-id="))?.slice("--article-id=".length);
const expectedHandle = process.argv.find((arg) => arg.startsWith("--handle="))?.slice("--handle=".length);
const shop = process.env.SHOPIFY_SHOP || "iboltmounts";
const token = process.env.SHOPIFY_ACCESS_TOKEN || "";
const version = process.env.SHOPIFY_API_VERSION || "2026-04";
const blogId = Number(process.env.SHOPIFY_NEWS_BLOG_ID || 104843772196);

if (!articleId || !/^\d+$/.test(articleId)) throw new Error("Pass --article-id=<numeric Shopify article ID>.");
if (!expectedHandle) throw new Error("Pass --handle=<current expected handle>.");
if (!token) throw new Error("SHOPIFY_ACCESS_TOKEN is required.");

const headers = { "Content-Type": "application/json", "X-Shopify-Access-Token": token };
const base = `https://${shop}.myshopify.com/admin/api/${version}`;

async function restArticle() {
  const response = await fetch(`${base}/blogs/${blogId}/articles/${articleId}.json`, { headers });
  const json = await response.json();
  if (!response.ok) throw new Error(`Article read failed: ${response.status} ${JSON.stringify(json)}`);
  return json.article;
}

async function updateHandle(handle) {
  const query = `mutation UpdateArticle($id: ID!, $article: ArticleUpdateInput!) {
    articleUpdate(id: $id, article: $article) {
      article { id title handle }
      userErrors { code field message }
    }
  }`;
  const response = await fetch(`${base}/graphql.json`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query,
      variables: {
        id: `gid://shopify/Article/${articleId}`,
        article: { handle, redirectNewHandle: false },
      },
    }),
  });
  const json = await response.json();
  const errors = [...(json.errors || []), ...(json.data?.articleUpdate?.userErrors || [])];
  if (!response.ok || errors.length) throw new Error(`Article handle update failed: ${response.status} ${JSON.stringify(errors)}`);
  return json.data.articleUpdate.article;
}

const before = await restArticle();
if (before.handle !== expectedHandle) {
  throw new Error(`Refusing cache refresh: expected ${expectedHandle}, found ${before.handle}.`);
}

const tempHandle = `${expectedHandle}-cache-refresh-${Date.now()}`;
console.log(JSON.stringify({ mode: execute ? "execute" : "dry-run", articleId, expectedHandle, tempHandle }, null, 2));
if (!execute) process.exit(0);

let moved = false;
try {
  await updateHandle(tempHandle);
  moved = true;
  await updateHandle(expectedHandle);
  moved = false;
} finally {
  if (moved) await updateHandle(expectedHandle);
}

const after = await restArticle();
if (after.handle !== expectedHandle) throw new Error(`Handle restoration failed: ${after.handle}`);
console.log(JSON.stringify({ success: true, articleId: after.id, title: after.title, handle: after.handle, updatedAt: after.updated_at }, null, 2));
