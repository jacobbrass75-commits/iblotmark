#!/usr/bin/env node

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const seriesDir = path.join(
  repoRoot,
  "content-output",
  "forklift-mount-history-series-2026-08-25",
);
const reviewDir = path.join(seriesDir, "shopify-review");
const manifestPath = path.join(reviewDir, "review-manifest.json");
const resultsPath = path.join(reviewDir, "shopify-draft-results.json");

const shop = (process.env.SHOPIFY_SHOP || "iboltmounts").replace(/\.myshopify\.com$/i, "");
const token = process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN || "";
const apiVersion = process.env.SHOPIFY_API_VERSION || "2026-04";
const blogId = Number(process.env.SHOPIFY_NEWS_BLOG_ID || 104843772196);
const seriesTag = "forklift-mount-history-series-2026-08-25";

if (!token) throw new Error("SHOPIFY_ACCESS_TOKEN or SHOPIFY_ADMIN_API_ACCESS_TOKEN is required.");
if (!Number.isFinite(blogId)) throw new Error("SHOPIFY_NEWS_BLOG_ID must be numeric.");
if (!fs.existsSync(manifestPath)) throw new Error(`Missing review manifest: ${manifestPath}`);

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

function reviewHandle(article) {
  return article.contentAction === "NEW"
    ? article.handle
    : `${article.handle}-review-draft-2026-08-25`;
}

function adminUrl(articleId) {
  return `https://admin.shopify.com/store/${shop}/content/articles/${articleId}`;
}

function heroAlt(bodyHtml, heroFilename) {
  const escaped = heroFilename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = bodyHtml.match(
    new RegExp(`<img\\b[^>]*src=["'][^"']*${escaped}["'][^>]*alt=["']([^"']+)["']`, "i"),
  );
  return match?.[1] || articleTitleFromFilename(heroFilename);
}

function articleTitleFromFilename(filename) {
  return filename
    .replace(/\.[^.]+$/, "")
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

async function shopify(method, endpoint, body) {
  const response = await fetch(
    `https://${shop}.myshopify.com/admin/api/${apiVersion}/${endpoint}`,
    {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text.slice(0, 1000) };
  }
  if (!response.ok) {
    throw new Error(
      `Shopify ${method} ${endpoint} failed (${response.status}): ${JSON.stringify(json).slice(0, 1400)}`,
    );
  }
  return { json, headers: Object.fromEntries(response.headers.entries()) };
}

async function listAllArticles() {
  const articles = [];
  let endpoint = `blogs/${blogId}/articles.json?limit=250&published_status=any&fields=id,title,handle,published_at,tags,image`;
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
    endpoint = `${nextUrl.pathname.split(`/admin/api/${apiVersion}/`)[1]}${nextUrl.search}`;
  }
  return articles;
}

function plannedItems(articles) {
  const byHandle = new Map(articles.map((article) => [article.handle, article]));
  return manifest.articles.map((article) => {
    const draftHandle = reviewHandle(article);
    const existingDraft = byHandle.get(draftHandle) || null;
    const targetHandle = article.handle;
    const target = byHandle.get(targetHandle) || null;
    const ownedDraft = Boolean(existingDraft)
      && String(existingDraft.tags || "").toLowerCase().includes(seriesTag.toLowerCase());

    let safe = true;
    let action = existingDraft ? "update_owned_draft" : "create_draft";
    let blocker = null;

    if (existingDraft?.published_at) {
      safe = false;
      blocker = `Review handle is already published as article ${existingDraft.id}.`;
    } else if (existingDraft && !ownedDraft) {
      safe = false;
      blocker = `Review handle belongs to an unrecognized draft ${existingDraft.id}.`;
    } else if (article.contentAction === "REFRESH" && !target?.published_at) {
      safe = false;
      blocker = "Refresh target is missing or not published.";
    } else if (article.contentAction === "NEW" && target?.published_at) {
      safe = false;
      blocker = `New-article handle is already published as article ${target.id}.`;
    }

    return {
      article,
      draftHandle,
      existingDraft,
      target,
      action,
      safe,
      blocker,
    };
  });
}

function loadArticleFiles(article) {
  const bodyPath = path.join(reviewDir, article.bodyHtml);
  const heroPath = path.resolve(reviewDir, article.heroAsset);
  if (!fs.existsSync(bodyPath)) throw new Error(`Missing Shopify body: ${bodyPath}`);
  if (!fs.existsSync(heroPath)) throw new Error(`Missing hero image: ${heroPath}`);
  const bodyHtml = fs.readFileSync(bodyPath, "utf8");
  const heroBytes = fs.readFileSync(heroPath);
  const heroFilename = path.basename(heroPath);
  const placeholder = `__UPLOAD_TO_SHOPIFY_CDN__/${heroFilename}`;
  if (!bodyHtml.includes(placeholder)) {
    throw new Error(`${article.handle}: hero upload placeholder is missing.`);
  }
  return { bodyHtml, heroBytes, heroFilename, placeholder };
}

function articlePayload(article, draftHandle, bodyHtml, image) {
  return {
    title: article.title,
    handle: draftHandle,
    author: "iBOLT Mounts",
    body_html: bodyHtml,
    summary_html: `<p>${article.metaDescription}</p>`,
    published: false,
    tags: [
      "iBOLT",
      "forklift mounts",
      "warehouse",
      seriesTag,
      "review draft",
      "do not publish",
      article.contentAction === "REFRESH" ? `refresh target ${article.handle}` : "new article review",
    ].join(", "),
    ...(image ? { image } : {}),
  };
}

async function syncSeoMetafields(articleId, article) {
  const desired = new Map([
    ["title_tag", article.metaTitle],
    ["description_tag", article.metaDescription],
  ]);
  const listed = await shopify("GET", `articles/${articleId}/metafields.json?limit=250`);
  const existing = (listed.json.metafields || []).filter(
    (field) => field.namespace === "global" && desired.has(field.key),
  );

  for (const [key, value] of desired) {
    const current = existing.find((field) => field.key === key);
    if (current?.value === value) continue;
    if (current) {
      await shopify("PUT", `metafields/${current.id}.json`, {
        metafield: { id: current.id, value, type: "single_line_text_field" },
      });
    } else {
      await shopify("POST", `articles/${articleId}/metafields.json`, {
        metafield: {
          namespace: "global",
          key,
          value,
          type: "single_line_text_field",
        },
      });
    }
  }
}

async function verifyDraft(articleId, item, expectedHeroUrl) {
  const fetched = await shopify(
    "GET",
    `blogs/${blogId}/articles/${articleId}.json?fields=id,title,handle,body_html,published_at,tags,image,summary_html`,
  );
  const verified = fetched.json.article;
  const metafields = await shopify("GET", `articles/${articleId}/metafields.json?limit=250`);
  const seo = Object.fromEntries(
    (metafields.json.metafields || [])
      .filter((field) => field.namespace === "global" && ["title_tag", "description_tag"].includes(field.key))
      .map((field) => [field.key, field.value]),
  );

  const checks = {
    unpublished: verified.published_at === null,
    handle: verified.handle === item.draftHandle,
    seriesTag: String(verified.tags || "").toLowerCase().includes(seriesTag.toLowerCase()),
    noUploadPlaceholder: !String(verified.body_html || "").includes("__UPLOAD_TO_SHOPIFY_CDN__"),
    noLocalhost: !/localhost|127\.0\.0\.1/.test(verified.body_html || ""),
    heroInBody: String(verified.body_html || "").includes(expectedHeroUrl),
    featuredImage: String(verified.image?.src || "").includes("cdn.shopify.com"),
    faqSchema: String(verified.body_html || "").includes('"@type": "FAQPage"'),
    seoTitle: seo.title_tag === item.article.metaTitle,
    seoDescription: seo.description_tag === item.article.metaDescription,
  };
  const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  if (failed.length) {
    throw new Error(`${item.draftHandle}: verification failed: ${failed.join(", ")}`);
  }
  return { verified, checks, seo };
}

async function preflight() {
  const articles = await listAllArticles();
  const items = plannedItems(articles);
  const result = {
    shop,
    apiVersion,
    blogId,
    safe: items.every((item) => item.safe),
    items: items.map((item) => ({
      title: item.article.title,
      contentAction: item.article.contentAction,
      targetHandle: item.article.handle,
      targetStatus: item.target ? (item.target.published_at ? "published" : "draft") : "missing",
      reviewHandle: item.draftHandle,
      reviewStatus: item.existingDraft
        ? (item.existingDraft.published_at ? "published" : "draft")
        : "missing",
      action: item.action,
      safe: item.safe,
      blocker: item.blocker,
    })),
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.safe) process.exitCode = 2;
}

async function createDrafts() {
  const articles = await listAllArticles();
  const items = plannedItems(articles);
  const unsafe = items.filter((item) => !item.safe);
  if (unsafe.length) {
    throw new Error(`Draft safety preflight failed: ${unsafe.map((item) => item.blocker).join(" | ")}`);
  }

  const results = [];
  for (const item of items) {
    const { article } = item;
    const files = loadArticleFiles(article);
    const existingHeroCdnUrl = item.existingDraft?.image?.src || "";
    const canReuseHero = existingHeroCdnUrl.includes(`/${files.heroFilename}`);
    const initialBody = files.bodyHtml.replace(
      files.placeholder,
      canReuseHero ? existingHeroCdnUrl : "",
    );
    const image = canReuseHero ? undefined : {
      attachment: files.heroBytes.toString("base64"),
      filename: files.heroFilename,
      alt: heroAlt(files.bodyHtml, files.heroFilename),
    };

    let saved;
    let action;
    if (item.existingDraft) {
      const updated = await shopify(
        "PUT",
        `blogs/${blogId}/articles/${item.existingDraft.id}.json`,
        {
          article: {
            id: item.existingDraft.id,
            ...articlePayload(article, item.draftHandle, initialBody, image),
          },
        },
      );
      saved = updated.json.article;
      action = "updated";
    } else {
      const created = await shopify("POST", `blogs/${blogId}/articles.json`, {
        article: articlePayload(article, item.draftHandle, initialBody, image),
      });
      saved = created.json.article;
      action = "created";
    }

    if (!saved?.id) throw new Error(`${item.draftHandle}: Shopify returned no article ID.`);
    if (!saved.image?.src) {
      const fetched = await shopify("GET", `blogs/${blogId}/articles/${saved.id}.json`);
      saved = fetched.json.article;
    }
    const heroCdnUrl = canReuseHero ? existingHeroCdnUrl : saved.image?.src || "";
    if (!heroCdnUrl.includes("cdn.shopify.com")) {
      throw new Error(`${item.draftHandle}: Shopify returned no CDN hero URL.`);
    }

    const finalBody = files.bodyHtml.replace(files.placeholder, heroCdnUrl);
    await shopify("PUT", `blogs/${blogId}/articles/${saved.id}.json`, {
      article: {
        id: saved.id,
        ...articlePayload(article, item.draftHandle, finalBody),
      },
    });
    await syncSeoMetafields(saved.id, article);
    const verification = await verifyDraft(saved.id, item, heroCdnUrl);

    results.push({
      title: article.title,
      contentAction: article.contentAction,
      action,
      articleId: Number(saved.id),
      blogId,
      targetHandle: article.handle,
      reviewHandle: item.draftHandle,
      adminUrl: adminUrl(Number(saved.id)),
      published: false,
      publishedAt: null,
      heroCdnUrl,
      wordCount: article.wordCount,
      faqCount: article.faqCount,
      productImageCount: article.productImageCount,
      checks: verification.checks,
    });
    console.log(`${action.toUpperCase()}: ${article.title} -> ${adminUrl(Number(saved.id))}`);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    shop,
    blogId,
    publicationStatus: "unpublished_review_drafts",
    liveArticlesModified: false,
    count: results.length,
    results,
  };
  fs.writeFileSync(resultsPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));
}

const args = new Set(process.argv.slice(2));
if (args.has("--preflight")) await preflight();
else if (args.has("--create-drafts")) await createDrafts();
else {
  console.error("Use --preflight or --create-drafts.");
  process.exitCode = 1;
}
