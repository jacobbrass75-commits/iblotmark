#!/usr/bin/env node

import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const SHOP = process.env.SHOPIFY_SHOP || "iboltmounts";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";
const BLOG_ID = Number(process.env.SHOPIFY_NEWS_BLOG_ID || 104843772196);
const CAMPAIGN_TAG = "top-10-category-program-2026-08-05";
const TARGET_IDS = new Set([
  635641037092, 635641004324, 635640971556, 635640938788, 635640906020,
  635640873252, 635640840484, 635640807716, 635640774948, 635640742180,
]);
const OUTPUT_DIR = path.resolve("content-output/top-10-category-program-2026-08-05/shopify-backups");

if (!TOKEN) throw new Error("SHOPIFY_ACCESS_TOKEN is required.");

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
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`Shopify ${method} ${endpoint} failed: ${response.status} ${text.slice(0, 500)}`);
  return json;
}

function tagsOf(article) {
  return String(article.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean);
}

function stableArticle(article) {
  const { tags, updated_at, admin_graphql_api_id, ...stable } = article;
  return stable;
}

async function main() {
  const result = await shopify("GET", `blogs/${BLOG_ID}/articles.json?limit=250&published_status=any`);
  const targets = (result.articles || []).filter((article) => {
    const tags = tagsOf(article);
    return TARGET_IDS.has(Number(article.id)) && tags.includes(CAMPAIGN_TAG);
  });

  if (targets.length !== 10) throw new Error(`Expected exactly 10 campaign articles; found ${targets.length}.`);

  const stamp = new Date().toISOString().replaceAll(":", "-");
  const backupPath = path.join(OUTPUT_DIR, `before-remove-commercial-mounts-${stamp}.json`);
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(backupPath, `${JSON.stringify({ createdAt: new Date().toISOString(), articles: targets }, null, 2)}\n`);

  const report = [];
  for (const before of targets) {
    const nextTags = "";
    if (APPLY) {
      await shopify("PUT", `blogs/${BLOG_ID}/articles/${before.id}.json`, {
        article: { id: before.id, tags: nextTags },
      });
    }
    const after = APPLY
      ? (await shopify("GET", `blogs/${BLOG_ID}/articles/${before.id}.json`)).article
      : { ...before, tags: nextTags };
    report.push({
      id: before.id,
      handle: before.handle,
      title: before.title,
      beforeTags: tagsOf(before),
      afterTags: tagsOf(after),
      removed: tagsOf(after).length === 0,
      allOtherArticleFieldsUnchanged: JSON.stringify(stableArticle(before)) === JSON.stringify(stableArticle(after)),
    });
  }

  const verification = {
    mode: APPLY ? "applied" : "dry-run",
    backupPath,
    targetCount: report.length,
    allRemoved: report.every((item) => item.removed),
    allOtherArticleFieldsUnchanged: report.every((item) => item.allOtherArticleFieldsUnchanged),
    articles: report,
  };
  const reportPath = path.join(OUTPUT_DIR, `verify-remove-commercial-mounts-${stamp}.json`);
  await writeFile(reportPath, `${JSON.stringify(verification, null, 2)}\n`);
  console.log(JSON.stringify({ reportPath, ...verification }, null, 2));
}

await main();
