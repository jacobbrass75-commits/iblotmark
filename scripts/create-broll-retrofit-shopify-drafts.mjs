#!/usr/bin/env node

import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const SHOP = (process.env.SHOPIFY_SHOP || "iboltmounts").replace(/\.myshopify\.com$/i, "");
const TOKEN =
  process.env.SHOPIFY_ACCESS_TOKEN ||
  process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN ||
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ||
  "";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";
const APPLY = process.argv.includes("--apply");
const MAX_ARTICLES_ARG = process.argv.find((arg) => arg.startsWith("--max="));
const MAX_ARTICLES = MAX_ARTICLES_ARG ? Number(MAX_ARTICLES_ARG.split("=")[1]) : 0;
const REVIEW_SUFFIX = "broll-review-2026-08-27";
const REVIEW_TAG = "broll retrofit review";
const DO_NOT_PUBLISH_TAG = "do not publish";
const LABELS_PATH = path.resolve(process.env.IBOLT_BROLL_LABELS_INDEX || "assets/broll/labels-index.json");
const CATALOG_PATH = path.resolve(process.env.IBOLT_BROLL_CATALOG || "assets/broll/catalog.json");
const APPLE_VISION_PATH = path.resolve(
  process.env.IBOLT_BROLL_APPLE_VISION || "assets/broll/apple-vision-labels.ndjson",
);
const OUTPUT_DIR = path.resolve(
  process.env.IBOLT_BROLL_SHOPIFY_REVIEW_OUTPUT || "content-output/broll-shopify-review-2026-08-27",
);
const DERIVATIVES_DIR = path.resolve("assets/broll/derivatives/shopify-review");

const HARD_BLOCK_FLAGS = new Set([
  "third-party-logo",
  "driver-distraction-context",
  "unsafe-installation-geometry",
  "installation-safety-review",
  "dirty-windshield",
  "overexposed-background",
  "unreadable-screen",
  "low-light",
]);
const REVIEW_ONLY_FLAGS = new Set([
  "rights-unverified",
  "product-identity-uncertain",
  "people-privacy",
  "visible-person",
  "visible-screen-content",
  "detail-composition",
  "water-adjacent-use",
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normalizeTags(value) {
  return String(value || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function uniqueTags(tags) {
  return [...new Map(tags.map((tag) => [tag.toLowerCase(), tag])).values()];
}

function tokenSet(values) {
  const aliases = new Map([
    ["trucking", "fleet"],
    ["truck", "fleet"],
    ["restaurant", "restaurant"],
    ["kitchen", "restaurant"],
    ["forklift", "warehouse"],
    ["warehousing", "warehouse"],
    ["boating", "marine"],
    ["boat", "marine"],
    ["fishing", "marine"],
    ["creator", "content"],
    ["streaming", "content"],
    ["offroading", "offroad"],
    ["overlanding", "offroad"],
  ]);
  const output = new Set();
  for (const token of values.join(" ").toLowerCase().split(/[^a-z0-9]+/).filter((item) => item.length >= 4)) {
    output.add(token);
    if (aliases.has(token)) output.add(aliases.get(token));
  }
  return output;
}

function verticalKeys(values) {
  const text = values.join(" ").toLowerCase();
  const keys = new Set();
  if (/fish|boat|marine|kayak|sonar|pontoon|garmin|lowrance|humminbird/.test(text)) keys.add("marine");
  if (/forklift|warehouse|scanner|inventory|pallet/.test(text)) keys.add("warehouse");
  if (/truck|fleet|\beld\b|semi|commercial vehicle|work vehicle/.test(text)) keys.add("fleet");
  if (/jeep|off[- ]?road|overland|\butv\b|trail/.test(text)) keys.add("offroad");
  if (/restaurant|kitchen|\bpos\b|delivery app|doordash|uber ?eats|expo|counter/.test(text)) keys.add("restaurant");
  if (/school|classroom|student|education|teacher/.test(text)) keys.add("education");
  if (/stream|creator|content creation|camera|recording|overhead|podcast/.test(text)) keys.add("content");
  if (/farm|tractor|agricultur/.test(text)) keys.add("agriculture");
  if (/road trip|travel|\brv\b|camper|vanlife/.test(text)) keys.add("travel");
  if (/bike|bicycle|cycling|mountain biking/.test(text)) keys.add("cycling");
  if (/kitchen|home|countertop/.test(text)) keys.add("home");
  return keys;
}

function assetVerticalKeys(asset) {
  const source = asset.sourcePath.toLowerCase();
  const keys = new Set();
  if (source.includes("commercial trucking")) keys.add("fleet");
  if (source.includes("creator series mounts")) keys.add("content");
  if (source.includes("restaurants mounts")) keys.add("restaurant");
  if (source.includes("kitchen baking")) {
    keys.add("home");
    keys.add("content");
  }
  if (source.includes("outdoor enthusiasts")) {
    keys.add("marine");
    keys.add("offroad");
    keys.add("travel");
  }
  return keys;
}

function verticalCompatible(article, asset) {
  const articleKeys = verticalKeys([article.title, article.handle, article.tags || "", article.blog_title || ""]);
  if (!articleKeys.size) return false;
  if (["education", "warehouse", "agriculture", "cycling"].some((key) => articleKeys.has(key))) return false;
  const assetKeys = assetVerticalKeys(asset);
  return [...articleKeys].some((key) => assetKeys.has(key));
}

function hasUnsafeSourceUrls(article) {
  return /localhost|127\.0\.0\.1|(?:https?:\/\/[^"'\s>]+)?\/api\/(?:public\/)?blog\/photos\//i.test(
    article.body_html || "",
  );
}

function scoreLabel(label, article, asset, vision, useCount) {
  const query = tokenSet([article.title, article.handle, article.tags || "", article.blog_title || "", article.body_html || ""]);
  const metadata = tokenSet([
    asset.sourcePath,
    ...(vision.classifications || []).slice(0, 15).map((item) => item.identifier),
  ]);
  let overlap = 0;
  for (const token of query) if (metadata.has(token)) overlap += 1;
  const articleKeys = verticalKeys([article.title, article.handle, article.tags || "", article.blog_title || ""]);
  const assetKeys = assetVerticalKeys(asset);
  const verticalBoost = [...articleKeys].some((key) => assetKeys.has(key)) ? 3 : 0;
  const heroBoost = label.cropSuitability?.hero ? 0.5 : 0;
  const reusePenalty = (useCount.get(label.sha256) || 0) * 0.35;
  return overlap * 0.25 + verticalBoost + heroBoost + Number(label.quality?.score || 0) - reusePenalty;
}

function copyForAsset(asset) {
  const keys = assetVerticalKeys(asset);
  if (keys.has("fleet")) return {
    altText: "iBOLT device mounting setup inside a commercial vehicle",
    caption: "A practical iBOLT mounting setup positions a device inside a commercial vehicle workspace.",
  };
  if (keys.has("marine")) return {
    altText: "iBOLT mounting setup used in an outdoor boating environment",
    caption: "An iBOLT mounting setup keeps a device positioned for practical use near the water.",
  };
  if (keys.has("restaurant")) return {
    altText: "iBOLT device mounting setup in a restaurant workspace",
    caption: "A practical iBOLT mounting setup keeps a device accessible in a restaurant workflow.",
  };
  if (keys.has("content")) return {
    altText: "iBOLT mounting setup in a content creation workspace",
    caption: "An iBOLT mounting setup positions a device for filming, streaming, or hands-free content work.",
  };
  return {
    altText: "iBOLT device mounting setup in use",
    caption: "A practical iBOLT mounting setup positions a device for hands-free use.",
  };
}

function eligibleLabel(label, catalogByHash, visionByHash) {
  const asset = catalogByHash.get(label.sha256);
  const vision = visionByHash.get(label.sha256);
  if (!asset || !existsSync(asset.localPath)) return false;
  if (!vision || vision.status !== "ok" || Number(vision.faceCount || 0) > 0) return false;
  if (!label.cropSuitability?.inline || !label.quality?.sharp || !label.quality?.usableComposition) return false;
  if (Number(label.quality.score || 0) < 0.72 || Number(label.confidence || 0) < 0.5) return false;
  const flags = label.reviewFlags || [];
  if (flags.some((flag) => HARD_BLOCK_FLAGS.has(flag))) return false;
  return flags.every((flag) => REVIEW_ONLY_FLAGS.has(flag));
}

function reviewHandle(handle) {
  const maxBase = Math.max(1, 255 - REVIEW_SUFFIX.length - 1);
  return `${String(handle).slice(0, maxBase).replace(/-+$/g, "")}-${REVIEW_SUFFIX}`;
}

function marker(sourceId) {
  return `ibolt-broll-review:${sourceId}`;
}

function removeExistingBlock(html, sourceId) {
  const escaped = String(sourceId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(html || "").replace(
    new RegExp(`\\s*<!-- ${marker(escaped)}:start -->[\\s\\S]*?<!-- ${marker(escaped)}:end -->\\s*`, "g"),
    "\n",
  );
}

function insertAfterOpening(html, block) {
  const body = String(html || "");
  const match = body.match(/<\/p>/i);
  if (match?.index !== undefined) {
    const end = match.index + match[0].length;
    return `${body.slice(0, end)}${block}${body.slice(end)}`;
  }
  const h2 = body.search(/<h2[\s>]/i);
  return h2 >= 0 ? `${body.slice(0, h2)}${block}${body.slice(h2)}` : `${block}${body}`;
}

function brollBlock(article, label, imageUrl, copy) {
  return `\n<!-- ${marker(article.id)}:start -->\n<figure class="ibolt-broll-image" data-broll-sha256="${label.sha256}" style="margin: 32px 0;">\n  <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(copy.altText)}" loading="lazy" style="width: 100%; height: auto; border-radius: 6px;" />\n  <figcaption style="font-size: 0.95rem; color: #5f6368; margin-top: 8px;">${escapeHtml(copy.caption)}</figcaption>\n</figure>\n<!-- ${marker(article.id)}:end -->\n`;
}

async function shopify(method, endpoint, body, attempt = 1) {
  const url = /^https?:\/\//i.test(endpoint)
    ? endpoint
    : `https://${SHOP}.myshopify.com/admin/api/${API_VERSION}/${endpoint}`;
  const response = await fetch(url, {
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
    await sleep(Math.max(750, retryAfter * 1000));
    return shopify(method, endpoint, body, attempt + 1);
  }
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text.slice(0, 1000) }; }
  if (!response.ok) throw new Error(`Shopify ${method} ${endpoint} failed: ${response.status} ${JSON.stringify(json).slice(0, 1200)}`);
  return { json, link: response.headers.get("link") || "" };
}

function nextPage(link) {
  return link.split(",").map((item) => item.trim()).find((item) => /rel="next"/.test(item))?.match(/<([^>]+)>/)?.[1] || "";
}

async function paginate(endpoint, key) {
  const rows = [];
  let next = endpoint;
  while (next) {
    const result = await shopify("GET", next);
    rows.push(...(result.json[key] || []));
    next = nextPage(result.link);
    await sleep(110);
  }
  return rows;
}

async function listArticles() {
  const blogs = await paginate("blogs.json?limit=250&fields=id,title,handle", "blogs");
  const articles = [];
  for (const blog of blogs) {
    const rows = await paginate(
      `blogs/${blog.id}/articles.json?limit=250&published_status=any&fields=id,title,handle,body_html,summary_html,published_at,tags,author,image`,
      "articles",
    );
    articles.push(...rows.map((article) => ({ ...article, blog_id: blog.id, blog_title: blog.title, blog_handle: blog.handle })));
  }
  return articles;
}

async function derivativeFor(label, asset) {
  const destination = path.join(DERIVATIVES_DIR, `${label.sha256}.jpg`);
  if (!existsSync(destination)) {
    await mkdir(path.dirname(destination), { recursive: true });
    await sharp(asset.localPath)
      .rotate()
      .resize({ width: 1800, height: 1200, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 84, mozjpeg: true })
      .toFile(destination);
  }
  return destination;
}

async function articleMetafields(articleId) {
  const listed = await shopify("GET", `articles/${articleId}/metafields.json?limit=250`);
  return (listed.json.metafields || []).filter(
    (field) => field.namespace === "global" && ["title_tag", "description_tag"].includes(field.key),
  );
}

async function syncMetafields(articleId, fields) {
  const desired = new Map(fields.map((field) => [field.key, field.value]));
  const listed = await articleMetafields(articleId);
  for (const [key, value] of desired) {
    const current = listed.find((field) => field.key === key);
    if (current?.value === value) continue;
    if (current) {
      await shopify("PUT", `metafields/${current.id}.json`, { metafield: { id: current.id, value, type: "single_line_text_field" } });
    } else {
      await shopify("POST", `articles/${articleId}/metafields.json`, {
        metafield: { namespace: "global", key, value, type: "single_line_text_field" },
      });
    }
  }
}

function adminUrl(articleId) {
  return `https://admin.shopify.com/store/${SHOP}/content/articles/${articleId}`;
}

async function main() {
  if (!TOKEN) throw new Error("SHOPIFY_ACCESS_TOKEN or SHOPIFY_ADMIN_API_ACCESS_TOKEN is required.");
  const [labelsFile, catalogFile, visionText, allArticles] = await Promise.all([
    readFile(LABELS_PATH, "utf8").then(JSON.parse),
    readFile(CATALOG_PATH, "utf8").then(JSON.parse),
    readFile(APPLE_VISION_PATH, "utf8"),
    listArticles(),
  ]);
  const catalogByHash = new Map(catalogFile.assets.map((asset) => [asset.sha256, asset]));
  const visionRows = visionText.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const visionByHash = new Map(visionRows.map((row) => [row.sha256, row]));
  const eligible = labelsFile.labels.filter((label) => eligibleLabel(label, catalogByHash, visionByHash));
  if (!eligible.length) throw new Error("No reviewed B-roll labels are currently eligible for Shopify drafts.");

  const byHandle = new Map(allArticles.map((article) => [`${article.blog_id}:${article.handle}`, article]));
  const published = allArticles
    .filter((article) => article.published_at)
    .filter((article) => !String(article.handle).endsWith(`-${REVIEW_SUFFIX}`))
    .filter((article) => !normalizeTags(article.tags).some((tag) => tag.toLowerCase() === REVIEW_TAG));
  const selected = MAX_ARTICLES > 0 ? published.slice(0, MAX_ARTICLES) : published;
  const useCount = new Map();
  const plan = selected.map((article) => {
    const sourceUrlBlocker = hasUnsafeSourceUrls(article);
    const ranked = sourceUrlBlocker ? [] : eligible
      .filter((label) => verticalCompatible(article, catalogByHash.get(label.sha256)))
      .map((label) => ({
        label,
        score: scoreLabel(
          label,
          article,
          catalogByHash.get(label.sha256),
          visionByHash.get(label.sha256),
          useCount,
        ),
      }))
      .sort((a, b) => b.score - a.score || b.label.quality.score - a.label.quality.score);
    const candidate = ranked[0];
    if (candidate && candidate.score >= 2.25) useCount.set(candidate.label.sha256, (useCount.get(candidate.label.sha256) || 0) + 1);
    const handle = reviewHandle(article.handle);
    return {
      article,
      reviewHandle: handle,
      existingDraft: byHandle.get(`${article.blog_id}:${handle}`) || null,
      candidate: candidate?.score >= 2.25 ? candidate : null,
      blockerReason: sourceUrlBlocker ? "source-contains-unsafe-local-photo-url" : null,
    };
  });

  const preflight = {
    generatedAt: new Date().toISOString(),
    shop: SHOP,
    mode: APPLY ? "apply" : "dry-run",
    sourcePublishedArticles: published.length,
    selectedArticles: selected.length,
    eligibleLabels: eligible.length,
    appleVisionLabels: visionRows.length,
    faceFreeEligibleLabels: eligible.length,
    rightsBasis: "User supplied this iBOLT B-roll library for use in iBOLT blogs; Shopify review drafts remain unpublished pending approval.",
    matchedArticles: plan.filter((item) => item.candidate).length,
    unmatchedArticles: plan.filter((item) => !item.candidate).length,
    existingReviewDrafts: plan.filter((item) => item.existingDraft).length,
    unsafeExistingReviewDrafts: plan.filter((item) => item.existingDraft?.published_at).map((item) => item.existingDraft.id),
    items: plan.map((item) => ({
      sourceArticleId: item.article.id,
      blogId: item.article.blog_id,
      title: item.article.title,
      sourceHandle: item.article.handle,
      reviewHandle: item.reviewHandle,
      existingReviewDraftId: item.existingDraft?.id || null,
      matchedAssetId: item.candidate?.label.assetId || null,
      matchedSha256: item.candidate?.label.sha256 || null,
      matchedSourcePath: item.candidate ? catalogByHash.get(item.candidate.label.sha256)?.sourcePath : null,
      score: item.candidate ? Number(item.candidate.score.toFixed(2)) : null,
      blockerReason: item.blockerReason,
    })),
  };
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(path.join(OUTPUT_DIR, "preflight.json"), `${JSON.stringify(preflight, null, 2)}\n`);
  if (preflight.unsafeExistingReviewDrafts.length) {
    throw new Error(`Refusing to continue: review handles are published: ${preflight.unsafeExistingReviewDrafts.join(", ")}`);
  }
  if (!APPLY) {
    console.log(JSON.stringify({ ...preflight, items: undefined }, null, 2));
    return;
  }

  const results = [];
  for (const [index, item] of plan.entries()) {
    if (!item.candidate) {
      results.push({
        sourceArticleId: item.article.id,
        title: item.article.title,
        skipped: true,
        reason: item.blockerReason || "no-safe-relevant-image",
      });
      continue;
    }
    const { label } = item.candidate;
    const asset = catalogByHash.get(label.sha256);
    const copy = copyForAsset(asset);
    const derivative = await derivativeFor(label, asset);
    const sourceSeo = await articleMetafields(item.article.id);
    const sourceTags = normalizeTags(item.article.tags).filter((tag) => ![REVIEW_TAG, DO_NOT_PUBLISH_TAG].includes(tag.toLowerCase()));
    const tags = uniqueTags([
      ...sourceTags,
      REVIEW_TAG,
      DO_NOT_PUBLISH_TAG,
      `broll source article ${item.article.id}`,
      `broll sha ${label.sha256.slice(0, 12)}`,
    ]).join(", ");
    const basePayload = {
      title: `${item.article.title} [B-roll Review]`,
      handle: item.reviewHandle,
      author: item.article.author || "iBOLT Mounts",
      summary_html: item.article.summary_html || "",
      published: false,
      tags,
    };
    let saved;
    const existingShaTag = normalizeTags(item.existingDraft?.tags).find((tag) => /^broll sha /i.test(tag));
    const canReuseImage = item.existingDraft?.image?.src && existingShaTag === `broll sha ${label.sha256.slice(0, 12)}`;
    if (item.existingDraft) {
      const payload = { article: { id: item.existingDraft.id, ...basePayload } };
      if (!canReuseImage) {
        payload.article.image = { attachment: (await readFile(derivative)).toString("base64"), filename: path.basename(derivative), alt: copy.altText };
      }
      saved = (await shopify("PUT", `blogs/${item.article.blog_id}/articles/${item.existingDraft.id}.json`, payload)).json.article;
    } else {
      saved = (await shopify("POST", `blogs/${item.article.blog_id}/articles.json`, {
        article: {
          ...basePayload,
          body_html: item.article.body_html || "",
          image: { attachment: (await readFile(derivative)).toString("base64"), filename: path.basename(derivative), alt: copy.altText },
        },
      })).json.article;
    }
    const fetchedImage = (await shopify("GET", `blogs/${item.article.blog_id}/articles/${saved.id}.json`)).json.article;
    const imageUrl = fetchedImage.image?.src || fetchedImage.image?.url || "";
    if (!imageUrl.includes("cdn.shopify.com")) throw new Error(`${saved.id}: Shopify CDN image URL missing after upload.`);
    const cleanBody = removeExistingBlock(item.article.body_html || "", item.article.id);
    const bodyHtml = insertAfterOpening(cleanBody, brollBlock(item.article, label, imageUrl, copy));
    await shopify("PUT", `blogs/${item.article.blog_id}/articles/${saved.id}.json`, {
      article: { id: saved.id, ...basePayload, body_html: bodyHtml, image: { src: imageUrl, alt: copy.altText } },
    });
    await syncMetafields(saved.id, sourceSeo);
    const verified = (await shopify("GET", `blogs/${item.article.blog_id}/articles/${saved.id}.json`)).json.article;
    const checks = {
      isDraft: verified.published_at === null,
      sourceStillPublished: Boolean(item.article.published_at),
      handle: verified.handle === item.reviewHandle,
      hasReviewTag: normalizeTags(verified.tags).some((tag) => tag.toLowerCase() === REVIEW_TAG),
      hasDoNotPublishTag: normalizeTags(verified.tags).some((tag) => tag.toLowerCase() === DO_NOT_PUBLISH_TAG),
      hasMarker: String(verified.body_html || "").includes(`${marker(item.article.id)}:start`),
      hasCdnImage: String(verified.body_html || "").includes(imageUrl) && imageUrl.includes("cdn.shopify.com"),
      noLocalUrls: !/localhost|127\.0\.0\.1|\/api\/blog\/photos\//i.test(verified.body_html || ""),
    };
    const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
    if (failed.length) throw new Error(`${saved.id}: verification failed: ${failed.join(", ")}`);
    results.push({
      sourceArticleId: item.article.id,
      sourceUrl: `https://iboltmounts.com/blogs/${item.article.blog_handle}/${item.article.handle}`,
      draftArticleId: saved.id,
      adminUrl: adminUrl(saved.id),
      title: item.article.title,
      imageUrl,
      assetId: label.assetId,
      sha256: label.sha256,
      score: Number(item.candidate.score.toFixed(2)),
      checks,
    });
    console.log(`[${index + 1}/${plan.length}] draft ${saved.id} ${item.article.title}`);
    await sleep(180);
  }
  const report = {
    generatedAt: new Date().toISOString(),
    shop: SHOP,
    mode: "apply",
    summary: {
      sourcePublishedArticles: published.length,
      processed: results.filter((item) => !item.skipped).length,
      skipped: results.filter((item) => item.skipped).length,
      allDraftChecksPassed: results.filter((item) => !item.skipped).every((item) => Object.values(item.checks).every(Boolean)),
    },
    results,
  };
  await writeFile(path.join(OUTPUT_DIR, "shopify-draft-results.json"), `${JSON.stringify(report, null, 2)}\n`);
  const rows = results.filter((item) => !item.skipped).map((item) => `| ${item.title.replaceAll("|", "\\|")} | [Open draft](${item.adminUrl}) | [Image](${item.imageUrl}) |`).join("\n");
  await writeFile(path.join(OUTPUT_DIR, "SHOPIFY_REVIEW.md"), `# Shopify B-roll Review Drafts\n\nGenerated ${report.generatedAt}. Live source articles were not changed.\n\n- Drafts created or updated: ${report.summary.processed}\n- Skipped without a safe relevant match: ${report.summary.skipped}\n\n| Article | Shopify draft | B-roll image |\n|---|---|---|\n${rows}\n`);
  console.log(JSON.stringify(report.summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
