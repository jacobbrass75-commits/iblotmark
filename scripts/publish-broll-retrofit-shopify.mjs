#!/usr/bin/env node

import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SHOP = (process.env.SHOPIFY_SHOP || "iboltmounts").replace(/\.myshopify\.com$/i, "");
const TOKEN =
  process.env.SHOPIFY_ACCESS_TOKEN ||
  process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN ||
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ||
  "";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";
const APPLY = process.argv.includes("--apply");
const VERIFY_EXISTING = process.argv.includes("--verify-existing");
const REVIEW_DIR = path.resolve("content-output/broll-shopify-review-2026-08-27");
const REPORT_PATH = path.join(REVIEW_DIR, "shopify-draft-results.json");
const PREFLIGHT_PATH = path.join(REVIEW_DIR, "preflight.json");
const RESULT_PATH = path.join(REVIEW_DIR, "shopify-publish-results.json");
const DERIVATIVES_DIR = path.resolve("assets/broll/derivatives/shopify-review");
const EXPECTED_COUNT = 123;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeTags(value) {
  return String(value || "").split(",").map((tag) => tag.trim()).filter(Boolean);
}

function marker(sourceId) {
  return `ibolt-broll-review:${sourceId}`;
}

function stripBroll(html, sourceId) {
  const escaped = String(sourceId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(html || "").replace(
    new RegExp(`\\s*<!-- ${marker(escaped)}:start -->[\\s\\S]*?<!-- ${marker(escaped)}:end -->\\s*`, "g"),
    "\n",
  ).trim();
}

function brollImageUrl(html, sourceId) {
  const escaped = String(sourceId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = String(html || "").match(
    new RegExp(`<!-- ${marker(escaped)}:start -->([\\s\\S]*?)<!-- ${marker(escaped)}:end -->`, "i"),
  )?.[1] || "";
  return block.match(/<img\b[^>]*src=["']([^"']+)["']/i)?.[1] || "";
}

function brollBlock(html, sourceId) {
  const escaped = String(sourceId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(html || "").match(
    new RegExp(`<!-- ${marker(escaped)}:start -->[\\s\\S]*?<!-- ${marker(escaped)}:end -->`, "i"),
  )?.[0] || "";
}

function insertAfterOpening(html, block) {
  const body = String(html || "");
  const match = body.match(/<\/p>/i);
  if (match?.index !== undefined) {
    const end = match.index + match[0].length;
    return `${body.slice(0, end)}\n${block}\n${body.slice(end)}`;
  }
  const h2 = body.search(/<h2[\s>]/i);
  return h2 >= 0 ? `${body.slice(0, h2)}${block}\n${body.slice(h2)}` : `${block}\n${body}`;
}

function canonicalHtml(html) {
  return String(html || "").replace(/\s+/g, " ").trim();
}

function unsafeUrl(html) {
  return /localhost|127\.0\.0\.1|(?:https?:\/\/[^"'\s>]+)?\/api\/(?:public\/)?blog\/photos\//i.test(html || "");
}

async function shopify(method, endpoint, body, attempt = 1) {
  const response = await fetch(`https://${SHOP}.myshopify.com/admin/api/${API_VERSION}/${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": TOKEN,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if ((response.status === 429 || response.status >= 500) && attempt < 6) {
    const retryAfter = Number(response.headers.get("retry-after") || "1");
    await sleep(Math.max(800, retryAfter * 1000));
    return shopify(method, endpoint, body, attempt + 1);
  }
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text.slice(0, 1000) }; }
  if (!response.ok) throw new Error(`Shopify ${method} ${endpoint} failed: ${response.status} ${JSON.stringify(json).slice(0, 1200)}`);
  return json;
}

async function getArticle(blogId, articleId) {
  return (await shopify(
    "GET",
    `blogs/${blogId}/articles/${articleId}.json?fields=id,title,handle,author,body_html,summary_html,published_at,created_at,updated_at,tags,image`,
  )).article;
}

async function publicCheck(url, imageUrl) {
  let last = { status: 0, hasImage: false };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, { redirect: "follow" });
    const html = await response.text();
    last = { status: response.status, hasImage: html.includes(imageUrl) };
    if (response.status === 200 && last.hasImage) return last;
    await sleep(1200 * (attempt + 1));
  }
  return last;
}

async function loadItems() {
  const [draftReport, preflight] = await Promise.all([
    readFile(REPORT_PATH, "utf8").then(JSON.parse),
    readFile(PREFLIGHT_PATH, "utf8").then(JSON.parse),
  ]);
  const active = draftReport.results.filter((row) => !row.skipped);
  if (active.length !== EXPECTED_COUNT || draftReport.summary?.processed !== EXPECTED_COUNT) {
    throw new Error(`Expected exactly ${EXPECTED_COUNT} approved drafts, found ${active.length}.`);
  }
  const planBySource = new Map(preflight.items.map((row) => [String(row.sourceArticleId), row]));
  const items = active.map((row) => {
    const plan = planBySource.get(String(row.sourceArticleId));
    if (!plan || !plan.blogId) throw new Error(`Missing preflight mapping for source ${row.sourceArticleId}.`);
    return { ...row, blogId: plan.blogId, reviewHandle: plan.reviewHandle };
  });
  if (new Set(items.map((row) => row.sourceArticleId)).size !== EXPECTED_COUNT) throw new Error("Duplicate source article IDs detected.");
  if (new Set(items.map((row) => row.draftArticleId)).size !== EXPECTED_COUNT) throw new Error("Duplicate draft article IDs detected.");
  return items;
}

async function preflight(items) {
  const rows = [];
  for (const [index, item] of items.entries()) {
    const [source, draft] = await Promise.all([
      getArticle(item.blogId, item.sourceArticleId),
      getArticle(item.blogId, item.draftArticleId),
    ]);
    const draftTags = normalizeTags(draft.tags).map((tag) => tag.toLowerCase());
    const featuredImageUrl = draft.image?.src || draft.image?.url || "";
    const imageUrl = brollImageUrl(draft.body_html, source.id);
    const checks = {
      sourcePublished: Boolean(source.published_at),
      draftHidden: draft.published_at === null,
      draftHandle: draft.handle === item.reviewHandle,
      draftTitle: draft.title === `${source.title} [B-roll Review]`,
      reviewTag: draftTags.includes("broll retrofit review"),
      doNotPublishTag: draftTags.includes("do not publish"),
      sourceReferenceTag: draftTags.includes(`broll source article ${source.id}`),
      bodyBaseMatches: canonicalHtml(stripBroll(draft.body_html, source.id)) === canonicalHtml(stripBroll(source.body_html, source.id)),
      marker: String(draft.body_html || "").includes(`${marker(source.id)}:start`),
      cdnImage: imageUrl.includes("cdn.shopify.com") && featuredImageUrl.includes("cdn.shopify.com"),
      noUnsafeDraftUrls: !unsafeUrl(draft.body_html),
      noUnsafeSourceUrls: !unsafeUrl(source.body_html),
    };
    const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
    if (failed.length) throw new Error(`${source.id} ${source.title}: preflight failed: ${failed.join(", ")}`);
    const approvedBlock = brollBlock(draft.body_html, source.id);
    const approvedBody = insertAfterOpening(stripBroll(source.body_html, source.id), approvedBlock);
    rows.push({ ...item, source, draft, imageUrl, approvedBody, checks, alreadyApplied: source.body_html === approvedBody });
    if ((index + 1) % 20 === 0 || index + 1 === items.length) console.log(`preflight ${index + 1}/${items.length}`);
  }
  return rows;
}

async function verifyRow(row) {
  const [source, draft] = await Promise.all([
    getArticle(row.blogId, row.sourceArticleId),
    getArticle(row.blogId, row.draftArticleId),
  ]);
  const imageUrl = brollImageUrl(source.body_html, source.id);
  const checks = {
    sourcePublished: Boolean(source.published_at),
    sourceTitlePreserved: source.title === row.source.title,
    sourceHandlePreserved: source.handle === row.source.handle,
    sourcePublishedAtPreserved: source.published_at === row.source.published_at,
    sourceTagsPreserved: source.tags === row.source.tags,
    sourceBodyBasePreserved:
      canonicalHtml(stripBroll(source.body_html, source.id)) ===
      canonicalHtml(stripBroll(draft.body_html, source.id)),
    sourceCdnImage: String(source.image?.src || source.image?.url || "").includes("cdn.shopify.com"),
    sourceHasMarker: String(source.body_html || "").includes(`${marker(source.id)}:start`),
    sourceHasApprovedImage:
      imageUrl.includes("cdn.shopify.com") && imageUrl.includes(row.sha256),
    noUnsafeUrls: !unsafeUrl(source.body_html),
    draftStillHidden: draft.published_at === null,
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length) throw new Error(`${source.id} ${source.title}: admin verification failed: ${failed.join(", ")}`);
  const storefront = await publicCheck(row.sourceUrl, imageUrl);
  if (storefront.status !== 200 || !storefront.hasImage) {
    throw new Error(`${source.id} ${source.title}: storefront verification failed: ${JSON.stringify(storefront)}`);
  }
  return { source, draft, imageUrl, checks, storefront };
}

async function main() {
  if (!TOKEN) throw new Error("SHOPIFY_ACCESS_TOKEN or SHOPIFY_ADMIN_API_ACCESS_TOKEN is required.");
  if (!APPLY && !VERIFY_EXISTING) throw new Error("Use --apply to publish or --verify-existing to verify the approved batch.");
  const items = await loadItems();
  const rows = await preflight(items);
  await mkdir(path.join(REVIEW_DIR, "publish-backups"), { recursive: true });
  const timestamp = new Date().toISOString().replace(/[.:]/g, "-");
  const backupPath = path.join(REVIEW_DIR, "publish-backups", `pre-publish-${timestamp}.json`);
  await writeFile(backupPath, `${JSON.stringify({ createdAt: new Date().toISOString(), shop: SHOP, rows: rows.map((row) => ({
    blogId: row.blogId,
    source: row.source,
    draft: row.draft,
  })) }, null, 2)}\n`);

  const results = [];
  for (const [index, row] of rows.entries()) {
    if (APPLY && !row.alreadyApplied) {
      const derivativePath = path.join(DERIVATIVES_DIR, `${row.sha256}.jpg`);
      const attachment = (await readFile(derivativePath)).toString("base64");
      await shopify("PUT", `blogs/${row.blogId}/articles/${row.sourceArticleId}.json`, {
        article: {
          id: row.sourceArticleId,
          body_html: row.approvedBody,
          image: {
            attachment,
            filename: path.basename(derivativePath),
            alt: row.draft.image?.alt || "iBOLT mounting setup in use",
          },
        },
      });
    }
    const verified = await verifyRow(row);
    results.push({
      blogId: row.blogId,
      sourceArticleId: row.sourceArticleId,
      draftArticleId: row.draftArticleId,
      title: row.source.title,
      handle: row.source.handle,
      publicUrl: row.sourceUrl,
      adminUrl: `https://admin.shopify.com/store/${SHOP}/content/articles/${row.sourceArticleId}`,
      imageUrl: verified.imageUrl,
      applied: APPLY && !row.alreadyApplied,
      checks: verified.checks,
      storefront: verified.storefront,
    });
    console.log(`${APPLY ? "published" : "verified"} ${index + 1}/${rows.length} ${row.sourceArticleId} ${row.source.title}`);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    shop: SHOP,
    mode: APPLY ? "apply" : "verify-existing",
    backupPath,
    summary: {
      expected: EXPECTED_COUNT,
      verified: results.length,
      updatedThisRun: results.filter((row) => row.applied).length,
      allPublicHttp200: results.every((row) => row.storefront.status === 200),
      allPublicContainApprovedImage: results.every((row) => row.storefront.hasImage),
      allReviewDraftsRemainHidden: results.every((row) => row.checks.draftStillHidden),
    },
    results,
  };
  await writeFile(RESULT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
