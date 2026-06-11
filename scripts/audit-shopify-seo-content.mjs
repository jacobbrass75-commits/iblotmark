import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const SHOPIFY_SHOP = (process.env.SHOPIFY_SHOP || "iboltmounts").replace(/\.myshopify\.com$/i, "");
const SHOPIFY_TOKEN =
  process.env.SHOPIFY_ACCESS_TOKEN ||
  process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN ||
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";
const STORE_ORIGIN = process.env.IBOLT_STORE_ORIGIN || "https://iboltmounts.com";
const MAX_PUBLIC_FETCHES = Number(process.env.SEO_AUDIT_MAX_PUBLIC_FETCHES || "0");
const PUBLIC_CONCURRENCY = Number(process.env.SEO_AUDIT_PUBLIC_CONCURRENCY || "2");
const PUBLIC_FETCH_RETRIES = Number(process.env.SEO_AUDIT_PUBLIC_FETCH_RETRIES || "5");

if (!SHOPIFY_TOKEN) {
  throw new Error("SHOPIFY_ACCESS_TOKEN or SHOPIFY_ADMIN_API_ACCESS_TOKEN is required.");
}

const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.join("content-output", "shopify-seo-audit", runStamp);
fs.mkdirSync(outputDir, { recursive: true });

const ARTICLE_MIN_WORDS = 750;
const PAGE_MIN_WORDS = 450;
const COLLECTION_MIN_WORDS = 180;
const PRODUCT_WARN_WORDS = 80;
const PRODUCT_MIN_WORDS = 40;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shopifyAdminUrl(endpoint) {
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  return `https://${SHOPIFY_SHOP}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/${endpoint}`;
}

async function shopifyFetch(method, endpoint, body) {
  const response = await fetch(shopifyAdminUrl(endpoint), {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_TOKEN,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Shopify ${method} ${endpoint} failed: ${response.status} ${text.slice(0, 800)}`);
  }

  return {
    data: text ? JSON.parse(text) : {},
    link: response.headers.get("link") || "",
  };
}

function nextPageUrl(linkHeader) {
  if (!linkHeader) return null;
  const match = linkHeader
    .split(",")
    .map((part) => part.trim())
    .find((part) => /rel="next"/.test(part))
    ?.match(/<([^>]+)>/);
  return match?.[1] || null;
}

async function paginate(endpoint, key) {
  const rows = [];
  let next = endpoint;
  while (next) {
    const { data, link } = await shopifyFetch("GET", next);
    rows.push(...(data[key] || []));
    next = nextPageUrl(link);
    await sleep(175);
  }
  return rows;
}

async function publicJsonPaginate(pathname, key) {
  const rows = [];
  let page = 1;
  while (true) {
    const url = `${STORE_ORIGIN}/${pathname}.json?limit=250&page=${page}`;
    let response;
    let text = "";
    for (let attempt = 1; attempt <= PUBLIC_FETCH_RETRIES; attempt += 1) {
      response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 SEO audit bot for iBOLT content review",
        },
      });
      text = await response.text();
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === PUBLIC_FETCH_RETRIES) break;
      const retryAfter = Number(response.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500 * attempt);
    }
    if (!response.ok) {
      throw new Error(`Public GET ${url} failed: ${response.status} ${text.slice(0, 500)}`);
    }
    const data = JSON.parse(text);
    const batch = data[key] || [];
    rows.push(...batch);
    if (batch.length < 250) break;
    page += 1;
    await sleep(150);
  }
  return rows;
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripHtml(html) {
  return decodeHtml(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function wordCount(html) {
  const text = stripHtml(html);
  if (!text) return 0;
  return (text.match(/[A-Za-z0-9][A-Za-z0-9'’+-]*/g) || []).length;
}

function tagMatches(html, tag) {
  return [...String(html || "").matchAll(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"))].map((match) => match[0]);
}

function tagText(tagHtml) {
  return stripHtml(tagHtml);
}

function attr(tag, name) {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*([\"'])([\\s\\S]*?)\\1`, "i");
  return decodeHtml(tag.match(pattern)?.[2] || "");
}

function metaContent(html, names) {
  const tags = String(html || "").match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const name = (attr(tag, "name") || attr(tag, "property")).toLowerCase();
    if (names.includes(name)) return attr(tag, "content");
  }
  return "";
}

function firstTagText(html, tag) {
  const match = String(html || "").match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? stripHtml(match[1]) : "";
}

function canonicalUrl(html) {
  const tags = String(html || "").match(/<link\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if ((attr(tag, "rel") || "").toLowerCase() === "canonical") return attr(tag, "href");
  }
  return "";
}

function parseJsonLd(html) {
  const scripts = [...String(html || "").matchAll(/<script\b[^>]*type=(["'])application\/ld\+json\1[^>]*>([\s\S]*?)<\/script>/gi)];
  const parsed = [];
  const errors = [];

  for (const script of scripts) {
    const raw = decodeHtml(script[2]).trim();
    if (!raw) continue;
    try {
      parsed.push(JSON.parse(raw));
    } catch (error) {
      errors.push({ message: error.message, preview: raw.slice(0, 180) });
    }
  }

  return { parsed, errors };
}

function collectSchemaTypes(value, types = []) {
  if (!value) return types;
  if (Array.isArray(value)) {
    for (const item of value) collectSchemaTypes(item, types);
    return types;
  }
  if (typeof value !== "object") return types;
  const type = value["@type"];
  if (Array.isArray(type)) types.push(...type.map(String));
  else if (type) types.push(String(type));
  if (value["@graph"]) collectSchemaTypes(value["@graph"], types);
  if (value.mainEntity) collectSchemaTypes(value.mainEntity, types);
  if (value.itemListElement) collectSchemaTypes(value.itemListElement, types);
  if (value.item) collectSchemaTypes(value.item, types);
  if (value.offers) collectSchemaTypes(value.offers, types);
  return types;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function linksInHtml(html) {
  const links = [];
  const matches = String(html || "").matchAll(/<a\b[^>]*\bhref=([\"'])([\s\S]*?)\1[^>]*>/gi);
  for (const match of matches) {
    const href = decodeHtml(match[2]).trim();
    if (!href || href.startsWith("#") || /^mailto:|^tel:/i.test(href)) continue;
    try {
      const url = new URL(href.startsWith("//") ? `https:${href}` : href, STORE_ORIGIN);
      const storeHost = new URL(STORE_ORIGIN).hostname.replace(/^www\./, "");
      const host = url.hostname.replace(/^www\./, "");
      links.push({
        href: url.toString(),
        internal: host === storeHost || host === `${SHOPIFY_SHOP}.myshopify.com`,
        product: /^\/products\//i.test(url.pathname),
        collection: /^\/collections\//i.test(url.pathname),
      });
    } catch {
      links.push({ href, internal: false, product: false, collection: false });
    }
  }
  return links;
}

function imageStats(html) {
  const tags = String(html || "").match(/<img\b[^>]*>/gi) || [];
  const missingAlt = tags.filter((tag) => !attr(tag, "alt").trim()).length;
  const lazy = tags.filter((tag) => /loading=(["'])lazy\1/i.test(tag)).length;
  return {
    total: tags.length,
    missingAlt,
    lazy,
  };
}

function contentKindThreshold(type) {
  if (type === "article") return ARTICLE_MIN_WORDS;
  if (type === "page") return PAGE_MIN_WORDS;
  if (type === "collection") return COLLECTION_MIN_WORDS;
  if (type === "product") return PRODUCT_WARN_WORDS;
  return 0;
}

function publicUrlFor(target) {
  if (target.type === "article") return `${STORE_ORIGIN}/blogs/${target.blog.handle}/${target.item.handle}`;
  if (target.type === "page") return `${STORE_ORIGIN}/pages/${target.item.handle}`;
  if (target.type === "collection") return `${STORE_ORIGIN}/collections/${target.item.handle}`;
  if (target.type === "product") return `${STORE_ORIGIN}/products/${target.item.handle}`;
  return STORE_ORIGIN;
}

function adminUrlFor(target) {
  if (target.type === "article") return `https://admin.shopify.com/store/${SHOPIFY_SHOP}/articles/${target.item.id}`;
  if (target.type === "page") return `https://admin.shopify.com/store/${SHOPIFY_SHOP}/pages/${target.item.id}`;
  if (target.type === "collection") return `https://admin.shopify.com/store/${SHOPIFY_SHOP}/collections/${target.item.id}`;
  if (target.type === "product") return `https://admin.shopify.com/store/${SHOPIFY_SHOP}/products/${target.item.id}`;
  return `https://admin.shopify.com/store/${SHOPIFY_SHOP}`;
}

function bodyHtmlFor(target) {
  return target.item.body_html || target.item.description || "";
}

function titleFor(target) {
  return target.item.title || target.item.name || target.item.handle || String(target.item.id);
}

function visibleFaqIn(html) {
  return /frequently asked questions|<h[23][^>]*>\s*faq\b|<strong>\s*q[:.]/i.test(String(html || ""));
}

function analyzeTarget(target, publicResult) {
  const bodyHtml = bodyHtmlFor(target);
  const publicHtml = publicResult.html || "";
  const bodyWords = wordCount(bodyHtml);
  const publicWords = wordCount(publicHtml);
  const h1 = tagMatches(publicHtml, "h1").map(tagText).filter(Boolean);
  const h2 = tagMatches(publicHtml, "h2").map(tagText).filter(Boolean);
  const h3 = tagMatches(publicHtml, "h3").map(tagText).filter(Boolean);
  const { parsed: schema, errors: schemaErrors } = parseJsonLd(publicHtml);
  const schemaTypes = unique(schema.flatMap((entry) => collectSchemaTypes(entry)));
  const bodyLinks = linksInHtml(bodyHtml);
  const publicLinks = linksInHtml(publicHtml);
  const bodyImages = imageStats(bodyHtml);
  const publicImages = imageStats(publicHtml);
  const metaTitle = firstTagText(publicHtml, "title");
  const metaDescription = metaContent(publicHtml, ["description", "og:description"]);
  const canonical = canonicalUrl(publicHtml);
  const hasVisibleFaq = visibleFaqIn(bodyHtml) || visibleFaqIn(publicHtml);
  const issues = [];

  function issue(severity, code, message) {
    issues.push({ severity, code, message });
  }

  const publicFetched = publicResult.status === 200;
  if (!publicFetched) {
    const severity = publicResult.status === 429 ? "low" : "critical";
    issue(severity, "public_fetch", `Public URL returned ${publicResult.status || "no response"} after ${publicResult.attempts || 1} attempt(s).`);
  }
  if (publicFetched) {
    if (!metaTitle) issue("high", "missing_meta_title", "Missing public <title>.");
    else if (metaTitle.length > 70) issue("medium", "long_meta_title", `Public title is ${metaTitle.length} characters.`);
    if (!metaDescription) issue("high", "missing_meta_description", "Missing meta description.");
    else if (metaDescription.length < 70) issue("medium", "short_meta_description", `Meta description is only ${metaDescription.length} characters.`);
    else if (metaDescription.length > 170) issue("medium", "long_meta_description", `Meta description is ${metaDescription.length} characters.`);
    if (!canonical) issue("medium", "missing_canonical", "Missing canonical URL.");
    if (h1.length !== 1) issue(h1.length === 0 ? "high" : "medium", "h1_count", `Expected one H1, found ${h1.length}.`);
  }

  const threshold = contentKindThreshold(target.type);
  if (threshold && bodyWords < threshold) {
    const severity = target.type === "product" && bodyWords >= PRODUCT_MIN_WORDS ? "medium" : "high";
    issue(severity, "thin_content", `${target.type} body has ${bodyWords} words; target is at least ${threshold}.`);
  }
  if (["article", "page", "collection"].includes(target.type) && h2.length < 2) {
    issue("medium", "weak_heading_structure", `Only ${h2.length} H2 headings found.`);
  }
  if (publicFetched && target.type === "article" && !schemaTypes.some((type) => /^(Article|BlogPosting|NewsArticle)$/i.test(type))) {
    issue("high", "missing_article_schema", "Article page does not expose Article or BlogPosting JSON-LD.");
  }
  if (publicFetched && target.type === "product" && !schemaTypes.includes("Product")) {
    issue("critical", "missing_product_schema", "Product page does not expose Product JSON-LD.");
  }
  if (publicFetched && target.type === "product" && !schemaTypes.some((type) => /Offer|AggregateOffer/i.test(type))) {
    issue("high", "missing_offer_schema", "Product page does not expose Offer schema.");
  }
  if (publicFetched && hasVisibleFaq && !schemaTypes.includes("FAQPage")) {
    issue("high", "missing_faq_schema", "Visible FAQ content exists without FAQPage JSON-LD.");
  }
  if (publicFetched && !hasVisibleFaq && ["article", "page", "collection"].includes(target.type)) {
    issue("medium", "missing_visible_faq", "No visible FAQ section detected.");
  }
  if (publicFetched && schemaErrors.length) issue("high", "invalid_json_ld", `${schemaErrors.length} JSON-LD block(s) failed to parse.`);
  if (bodyImages.total > 0 && bodyImages.missingAlt > 0) {
    issue("medium", "body_images_missing_alt", `${bodyImages.missingAlt} of ${bodyImages.total} body images are missing alt text.`);
  }
  if (target.type === "article" && bodyLinks.filter((link) => link.product).length === 0) {
    issue("medium", "article_no_product_links", "Article body has no product links.");
  }
  if (target.type === "article" && !/\/cart\/add\?id=/i.test(bodyHtml)) {
    issue("low", "article_no_add_to_cart", "Article body has no direct add-to-cart link.");
  }
  if (target.type === "product") {
    const product = target.item;
    if (!product.images?.length) issue("high", "product_no_images", "Product has no images in Shopify Admin.");
    if (!product.product_type) issue("medium", "missing_product_type", "Product type is empty.");
    if (!String(product.tags || "").trim()) issue("medium", "missing_product_tags", "Product tags are empty.");
    if (!product.variants?.some((variant) => Number(variant.price) > 0)) issue("high", "missing_variant_price", "No variant has a positive price.");
  }

  const severityScore = issues.reduce((sum, item) => {
    if (item.severity === "critical") return sum + 10;
    if (item.severity === "high") return sum + 5;
    if (item.severity === "medium") return sum + 2;
    return sum + 1;
  }, 0);

  return {
    type: target.type,
    id: target.item.id,
    blogId: target.blog?.id || null,
    blogTitle: target.blog?.title || null,
    title: titleFor(target),
    handle: target.item.handle,
    status: target.item.status || (target.item.published_at ? "published" : "unpublished"),
    publishedAt: target.item.published_at || target.item.published_at,
    updatedAt: target.item.updated_at,
    publicUrl: publicUrlFor(target),
    adminUrl: adminUrlFor(target),
    publicStatus: publicResult.status,
    publicError: publicResult.error || null,
    bodyWords,
    publicWords,
    metaTitle,
    metaTitleLength: metaTitle.length,
    metaDescription,
    metaDescriptionLength: metaDescription.length,
    canonical,
    h1,
    h2Count: h2.length,
    h2: h2.slice(0, 12),
    h3Count: h3.length,
    schemaTypes,
    schemaErrorCount: schemaErrors.length,
    hasVisibleFaq,
    hasFaqSchema: schemaTypes.includes("FAQPage"),
    bodyImages,
    publicImages,
    bodyLinkCount: bodyLinks.length,
    internalBodyLinkCount: bodyLinks.filter((link) => link.internal).length,
    externalBodyLinkCount: bodyLinks.filter((link) => !link.internal).length,
    productBodyLinkCount: bodyLinks.filter((link) => link.product).length,
    collectionBodyLinkCount: bodyLinks.filter((link) => link.collection).length,
    publicLinkCount: publicLinks.length,
    addToCartLinks: (bodyHtml.match(/\/cart\/add\?id=/gi) || []).length,
    issues,
    severityScore,
  };
}

async function fetchPublic(url) {
  for (let attempt = 1; attempt <= PUBLIC_FETCH_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 SEO audit bot for iBOLT content review",
          "Cache-Control": "no-cache",
        },
      });
      const html = await response.text();
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === PUBLIC_FETCH_RETRIES) {
        return { status: response.status, finalUrl: response.url, html, attempts: attempt };
      }
      const retryAfter = Number(response.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1250 * attempt);
    } catch (error) {
      if (attempt === PUBLIC_FETCH_RETRIES) {
        return { status: 0, finalUrl: url, html: "", error: error.message, attempts: attempt };
      }
      await sleep(1250 * attempt);
    }
  }
}

async function mapConcurrent(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function issueRollup(rows) {
  const items = rows.flatMap((row) =>
    row.issues.map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      type: row.type,
      title: row.title,
      url: row.publicUrl,
      message: issue.message,
    })),
  );
  const byCode = {};
  for (const item of items) {
    byCode[item.code] ||= { code: item.code, severity: item.severity, count: 0, examples: [] };
    byCode[item.code].count += 1;
    if (byCode[item.code].examples.length < 6) byCode[item.code].examples.push(item);
  }
  return Object.values(byCode).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

function pct(part, total) {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

function markdownTable(rows, headers) {
  if (!rows.length) return "_None._";
  const lines = [
    `| ${headers.map((header) => header.label).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
  ];
  for (const row of rows) {
    lines.push(
      `| ${headers
        .map((header) =>
          String(header.value(row) ?? "")
            .replace(/\|/g, "\\|")
            .replace(/\n/g, " ")
            .slice(0, 220),
        )
        .join(" | ")} |`,
    );
  }
  return lines.join("\n");
}

function buildReport({ inventory, analyses, rollups }) {
  const total = analyses.length;
  const issueRows = analyses.filter((row) => row.issues.length);
  const criticalHighRows = analyses.filter((row) => row.issues.some((issue) => ["critical", "high"].includes(issue.severity)));
  const articles = analyses.filter((row) => row.type === "article");
  const pages = analyses.filter((row) => row.type === "page");
  const products = analyses.filter((row) => row.type === "product");
  const collections = analyses.filter((row) => row.type === "collection");
  const topIssueRows = analyses
    .filter((row) => row.severityScore > 0)
    .sort((a, b) => b.severityScore - a.severityScore || a.title.localeCompare(b.title))
    .slice(0, 25);
  const thinProducts = products
    .filter((row) => row.issues.some((issue) => issue.code === "thin_content"))
    .sort((a, b) => a.bodyWords - b.bodyWords)
    .slice(0, 25);
  const missingFaq = [...articles, ...pages, ...collections]
    .filter((row) => row.issues.some((issue) => issue.code === "missing_visible_faq" || issue.code === "missing_faq_schema"))
    .sort((a, b) => b.severityScore - a.severityScore)
    .slice(0, 25);
  const schemaGaps = analyses
    .filter((row) =>
      row.issues.some((issue) =>
        ["missing_article_schema", "missing_product_schema", "missing_offer_schema", "missing_faq_schema", "invalid_json_ld"].includes(issue.code),
      ),
    )
    .sort((a, b) => b.severityScore - a.severityScore)
    .slice(0, 25);

  const issueSummary = rollups.issueRollup.slice(0, 20).map((issue) => ({
    ...issue,
    examplesText: issue.examples.map((example) => `[${example.title}](${example.url})`).join("<br>"),
  }));

  return `# Shopify SEO Content Audit: iBOLT Mounts

Generated: ${new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} PT  
Store: ${STORE_ORIGIN}

## Executive Summary

I audited live Shopify content across blog articles, Shopify pages, collection pages, and product pages. The site has a strong content foundation: the recent AEO blog work has useful FAQs, product links, add-to-cart CTAs, and practical comparison-style topics. The largest remaining SEO upside is not more generic blogging. It is tightening commercial page metadata, strengthening product descriptions, adding consistent schema coverage, and turning the best blog topics into connected solution/category hubs.

## Inventory Audited

| Type | Count | With Issues | With Critical/High Issues | FAQ Schema Coverage | Median Body Words |
| --- | ---: | ---: | ---: | ---: | ---: |
| Articles | ${articles.length} | ${articles.filter((row) => row.issues.length).length} | ${articles.filter((row) => row.issues.some((issue) => ["critical", "high"].includes(issue.severity))).length} | ${pct(articles.filter((row) => row.hasFaqSchema).length, articles.length)} | ${rollups.medians.articleWords} |
| Pages | ${pages.length} | ${pages.filter((row) => row.issues.length).length} | ${pages.filter((row) => row.issues.some((issue) => ["critical", "high"].includes(issue.severity))).length} | ${pct(pages.filter((row) => row.hasFaqSchema).length, pages.length)} | ${rollups.medians.pageWords} |
| Collections | ${collections.length} | ${collections.filter((row) => row.issues.length).length} | ${collections.filter((row) => row.issues.some((issue) => ["critical", "high"].includes(issue.severity))).length} | ${pct(collections.filter((row) => row.hasFaqSchema).length, collections.length)} | ${rollups.medians.collectionWords} |
| Products | ${products.length} | ${products.filter((row) => row.issues.length).length} | ${products.filter((row) => row.issues.some((issue) => ["critical", "high"].includes(issue.severity))).length} | n/a | ${rollups.medians.productWords} |

Total URLs audited: ${total}  
URLs with at least one issue: ${issueRows.length}  
URLs with critical or high-priority issues: ${criticalHighRows.length}

## What Is Working Well

- The blog library now has real product paths into the store. ${articles.filter((row) => row.productBodyLinkCount > 0).length} of ${articles.length} articles include product links, and ${articles.filter((row) => row.addToCartLinks > 0).length} articles include direct add-to-cart CTAs.
- The newest AEO refresh articles are structurally useful: they answer buyer questions, compare alternatives, include FAQs, and point readers to commercial products.
- Product pages generally expose product URLs and images through Shopify, which gives us a usable base for Product schema and shopping discovery.
- Dedicated solution pages now exist for the major weak/missing terms we identified, including restaurant tablet mounts, AMPS mounting, forklift tablet mounting, fleet/ELD, live streaming, and phone clamp/ball/socket guides.
- The site has broad topical coverage across fleet, delivery, restaurant, forklift/warehouse, boating, and mounting-system education.

## Main SEO Gaps

${markdownTable(issueSummary, [
    { label: "Issue", value: (row) => row.code },
    { label: "Severity", value: (row) => row.severity },
    { label: "Count", value: (row) => row.count },
    { label: "Examples", value: (row) => row.examplesText },
  ])}

## Highest-Priority URLs

${markdownTable(topIssueRows, [
    { label: "Type", value: (row) => row.type },
    { label: "Score", value: (row) => row.severityScore },
    { label: "URL", value: (row) => `[${row.title}](${row.publicUrl})` },
    { label: "Top Issues", value: (row) => row.issues.slice(0, 4).map((issue) => issue.code).join(", ") },
  ])}

## Product Page Gaps

Many product pages are the final conversion destination for the blog strategy, so thin descriptions are a direct SEO and conversion problem. Expand these first with use cases, compatibility, install guidance, materials, dimensions, warranty, and FAQ-like buying guidance.

${markdownTable(thinProducts, [
    { label: "Words", value: (row) => row.bodyWords },
    { label: "Product", value: (row) => `[${row.title}](${row.publicUrl})` },
    { label: "Issues", value: (row) => row.issues.map((issue) => issue.code).join(", ") },
  ])}

## FAQ And Schema Gaps

FAQ content is one of the better AEO/GEO signals on the site, but it is not consistent across all pages. The priority is to make FAQ visible on user-facing pages and ensure matching FAQPage JSON-LD exists where the FAQ is visible.

${markdownTable(missingFaq, [
    { label: "Type", value: (row) => row.type },
    { label: "URL", value: (row) => `[${row.title}](${row.publicUrl})` },
    { label: "FAQ", value: (row) => (row.hasVisibleFaq ? "visible" : "missing") },
    { label: "FAQ Schema", value: (row) => (row.hasFaqSchema ? "present" : "missing") },
  ])}

## Structured Data Gaps

${markdownTable(schemaGaps, [
    { label: "Type", value: (row) => row.type },
    { label: "URL", value: (row) => `[${row.title}](${row.publicUrl})` },
    { label: "Schema Types Found", value: (row) => row.schemaTypes.join(", ") || "none" },
    { label: "Issues", value: (row) => row.issues.filter((issue) => issue.code.includes("schema")).map((issue) => issue.code).join(", ") },
  ])}

## Recommended Work Plan

### 1. Fix template-level schema first

Add or validate template-level JSON-LD so every article emits BlogPosting or Article schema, every product emits Product plus Offer, and visible FAQ sections emit FAQPage. Template fixes scale better than editing one page at a time.

### 2. Expand thin product descriptions

Prioritize the product pages listed above. Each important product page should include: what it is, compatible devices, surface/base type, ball size or AMPS pattern, materials, best use cases, what is included, installation notes, and internal links to the relevant solution page.

### 3. Turn solution pages into commercial hubs

Add prominent links from collections, top products, and relevant blogs into the six solution pages. The new solution pages should not sit isolated. They should become the bridge between informational blog traffic and product/category pages.

### 4. Standardize FAQ blocks

Use 4 to 6 buyer questions on major articles, pages, and collections. Good FAQ targets: compatibility, install method, device fit, locking/security, AMPS/RAM compatibility, commercial use, shipping/warranty, and which product to choose.

### 5. Clean metadata at scale

Fix missing, too-short, and too-long meta descriptions. Use a repeatable rule: primary keyword plus use case plus soft CTA in 130 to 155 characters.

### 6. Improve internal linking clusters

Build internal link clusters around:

- Restaurant tablet mount, multiple tablet holder, POS tablet stand
- AMPS mounting plate, AMPS mounting system, ball mount sizes
- Forklift tablet mount, barcode scanner mount, warehouse tablet holder
- Fleet phone mount, ELD tablet mount, delivery driver phone mount
- Live streaming phone stand, table camera mount, overhead camera mount
- Clamp mount, phone clamp, clip-on phone mount, screw-down mount

## Files

- Raw audit JSON: [audit.json](audit.json)
- Top issues CSV: [top-issues.csv](top-issues.csv)
`;
}

function median(numbers) {
  const values = numbers.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!values.length) return 0;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : Math.round((values[mid - 1] + values[mid]) / 2);
}

async function main() {
  const blogs = await paginate("blogs.json?limit=250", "blogs");
  const articles = [];
  for (const blog of blogs) {
    const rows = await paginate(
      `blogs/${blog.id}/articles.json?limit=250&fields=id,title,handle,body_html,published_at,updated_at,author,image,summary_html,tags`,
      "articles",
    );
    articles.push(...rows.map((item) => ({ type: "article", blog, item })));
  }

  const pages = (await paginate("pages.json?limit=250&fields=id,title,handle,body_html,published_at,updated_at,author", "pages")).map((item) => ({
    type: "page",
    item,
  }));

  const publicCollections = (await publicJsonPaginate("collections", "collections")).map((item) => ({
    type: "collection",
    item: {
      ...item,
      body_html: item.body_html || item.description || "",
      collectionKind: "public",
      published_at: item.published_at || item.updated_at || true,
    },
  }));

  const products = (await publicJsonPaginate("products", "products")).map((item) => ({
    type: "product",
    item: {
      ...item,
      status: item.status || "active",
      published_at: item.published_at || item.updated_at || true,
      tags: Array.isArray(item.tags) ? item.tags.join(", ") : item.tags,
    },
  }));

  let targets = [...articles, ...pages, ...publicCollections, ...products].filter((target) => {
    if (target.type === "product") return target.item.status === "active" || target.item.published_at;
    return target.item.published_at !== null;
  });

  if (MAX_PUBLIC_FETCHES > 0) targets = targets.slice(0, MAX_PUBLIC_FETCHES);

  const publicResults = await mapConcurrent(targets, PUBLIC_CONCURRENCY, async (target) => {
    const result = await fetchPublic(publicUrlFor(target));
    await sleep(50);
    return result;
  });

  const analyses = targets.map((target, index) => analyzeTarget(target, publicResults[index]));
  const rollups = {
    byType: countBy(analyses, (row) => row.type),
    issueRollup: issueRollup(analyses),
    medians: {
      articleWords: median(analyses.filter((row) => row.type === "article").map((row) => row.bodyWords)),
      pageWords: median(analyses.filter((row) => row.type === "page").map((row) => row.bodyWords)),
      collectionWords: median(analyses.filter((row) => row.type === "collection").map((row) => row.bodyWords)),
      productWords: median(analyses.filter((row) => row.type === "product").map((row) => row.bodyWords)),
    },
  };

  const inventory = {
    blogs: blogs.length,
    articles: articles.length,
    pages: pages.length,
    customCollections: null,
    smartCollections: null,
    collections: publicCollections.length,
    products: products.length,
    auditedTargets: analyses.length,
  };

  const audit = {
    generatedAt: new Date().toISOString(),
    shop: SHOPIFY_SHOP,
    storeOrigin: STORE_ORIGIN,
    outputDir: path.resolve(outputDir),
    inventory,
    thresholds: {
      ARTICLE_MIN_WORDS,
      PAGE_MIN_WORDS,
      COLLECTION_MIN_WORDS,
      PRODUCT_WARN_WORDS,
      PRODUCT_MIN_WORDS,
    },
    rollups,
    analyses,
  };

  fs.writeFileSync(path.join(outputDir, "audit.json"), JSON.stringify(audit, null, 2));

  const issueRows = analyses
    .flatMap((row) =>
      row.issues.map((issue) => ({
        type: row.type,
        severityScore: row.severityScore,
        severity: issue.severity,
        issue: issue.code,
        title: row.title,
        publicUrl: row.publicUrl,
        message: issue.message,
      })),
    )
    .sort((a, b) => b.severityScore - a.severityScore || a.type.localeCompare(b.type));

  const csv = [
    ["type", "severity_score", "severity", "issue", "title", "public_url", "message"].join(","),
    ...issueRows.map((row) =>
      [row.type, row.severityScore, row.severity, row.issue, row.title, row.publicUrl, row.message]
        .map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`)
        .join(","),
    ),
  ].join("\n");
  fs.writeFileSync(path.join(outputDir, "top-issues.csv"), csv);
  fs.writeFileSync(path.join(outputDir, "REPORT.md"), buildReport({ inventory, analyses, rollups }));

  console.log(
    JSON.stringify(
      {
        outputDir: path.resolve(outputDir),
        inventory,
        issueCounts: {
          urlsWithIssues: analyses.filter((row) => row.issues.length).length,
          urlsWithCriticalHigh: analyses.filter((row) => row.issues.some((issue) => ["critical", "high"].includes(issue.severity))).length,
          totalIssues: issueRows.length,
        },
        topIssues: rollups.issueRollup.slice(0, 10).map(({ code, severity, count }) => ({ code, severity, count })),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
