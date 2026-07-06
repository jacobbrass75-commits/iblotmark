#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";
const REPORT_DIR = "blog-body-inspection";
const STORE_ORIGIN = "https://iboltmounts.com";
const DB_PATH = process.env.DATABASE_PATH || "data/sourceannotator.db";
const LIVE_AUDIT_PREFIX = "live-blog-ai-citability-merged-";
const CONCURRENCY = Number(process.env.BLOG_BODY_INSPECTION_CONCURRENCY || "4");
const MAX_URLS = Number(process.env.BLOG_BODY_INSPECTION_MAX_URLS || "0");
const USE_PUBLIC_FETCH = process.env.BLOG_BODY_INSPECTION_PUBLIC_FETCH !== "0";
const DELAY_MS = Number(process.env.BLOG_BODY_INSPECTION_DELAY_MS || "0");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
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

function attr(tag, name) {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*([\"'])([\\s\\S]*?)\\1`, "i");
  return decodeHtml(tag.match(pattern)?.[2] || "");
}

function tagTexts(html, tag) {
  return [...String(html || "").matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))]
    .map((match) => stripHtml(match[1]))
    .filter(Boolean);
}

function firstTagText(html, tag) {
  return tagTexts(html, tag)[0] || "";
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function csv(rows) {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted && char === '"' && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some((value) => value.trim())) rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows.shift();
  return rows.map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""])));
}

async function latestDir(prefix) {
  const entries = await readdir(path.join(process.cwd(), OUTPUT_ROOT), { withFileTypes: true });
  const name = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  if (!name) throw new Error(`No ${prefix} directory found in ${OUTPUT_ROOT}.`);
  return path.join(process.cwd(), OUTPUT_ROOT, name);
}

async function readCsv(filePath) {
  try {
    return parseCsv(await readFile(filePath, "utf8"));
  } catch {
    return [];
  }
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function num(value) {
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function wordCount(textOrHtml) {
  const text = /<[^>]+>/.test(String(textOrHtml || "")) ? stripHtml(textOrHtml) : String(textOrHtml || "");
  return (text.match(/[A-Za-z0-9][A-Za-z0-9'’+-]*/g) || []).length;
}

function normalizeUrl(value) {
  return String(value ?? "").trim().replace(/\/$/, "");
}

function splitList(value) {
  return String(value ?? "")
    .split(/[;|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function short(value, length = 100) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 3).trim()}...` : text;
}

function extractArticleHtml(html) {
  const text = String(html || "");
  const h1Index = text.search(/<h1\b/i);
  const start = h1Index >= 0 ? h1Index : 0;
  const footerMarkers = [
    /<h2\b[^>]*>\s*Reading next/i,
    /<h2\b[^>]*>\s*Leave a comment/i,
    /<footer\b/i,
    /<div\b[^>]*id=["']shopify-section-footer/i,
  ];
  const endCandidates = footerMarkers
    .map((pattern) => {
      const match = pattern.exec(text.slice(start));
      return match ? start + match.index : -1;
    })
    .filter((index) => index > start);
  const end = endCandidates.length ? Math.min(...endCandidates) : text.length;
  return text.slice(start, end);
}

function getLinks(html) {
  const links = [];
  for (const match of String(html || "").matchAll(/<a\b[^>]*\bhref=([\"'])([\s\S]*?)\1[^>]*>/gi)) {
    const href = decodeHtml(match[2]).trim();
    if (!href || href.startsWith("#") || /^mailto:|^tel:/i.test(href)) continue;
    try {
      const url = new URL(href.startsWith("//") ? `https:${href}` : href, STORE_ORIGIN);
      const host = url.hostname.replace(/^www\./, "");
      const storeHost = new URL(STORE_ORIGIN).hostname.replace(/^www\./, "");
      links.push({
        href: url.toString(),
        internal: host === storeHost || host.endsWith(".myshopify.com"),
        product: /^\/products\//i.test(url.pathname),
        collection: /^\/collections\//i.test(url.pathname),
        blog: /^\/blogs\//i.test(url.pathname),
        cart: /^\/cart\/add/i.test(url.pathname),
      });
    } catch {
      links.push({ href, internal: false, product: false, collection: false, blog: false, cart: false });
    }
  }
  return links;
}

function countImagesMissingAlt(html) {
  const tags = String(html || "").match(/<img\b[^>]*>/gi) || [];
  return {
    images: tags.length,
    missingAlt: tags.filter((tag) => !attr(tag, "alt").trim()).length,
  };
}

function hasSchema(html, type) {
  return new RegExp(`"@type"\\s*:\\s*"?${type}"?`, "i").test(String(html || ""));
}

function fetchText(url) {
  return fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 iBOLT blog body inspection" },
    signal: AbortSignal.timeout(30000),
  }).then(async (response) => {
    const text = await response.text();
    if (!response.ok) throw new Error(`GET ${url} failed: ${response.status}`);
    return text;
  });
}

function sqliteJson(sql) {
  try {
    const output = execFileSync("sqlite3", ["-json", DB_PATH, sql], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 80 * 1024 * 1024,
    }).trim();
    return output ? JSON.parse(output) : [];
  } catch {
    return [];
  }
}

function loadLocalPostsBySlug() {
  const posts = sqliteJson(`
    SELECT title, slug, html, markdown, shopify_article_id, shopify_blog_id
    FROM blog_posts
    WHERE status='published'
  `);
  return new Map(posts.map((post) => [post.slug, post]));
}

async function loadLiveAuditByUrl() {
  let auditDir = "";
  try {
    const entries = await readdir(path.join(process.cwd(), OUTPUT_ROOT), { withFileTypes: true });
    auditDir = entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(LIVE_AUDIT_PREFIX))
      .map((entry) => entry.name)
      .sort()
      .at(-1) || "";
  } catch {
    auditDir = "";
  }
  if (!auditDir) return new Map();
  const data = await readJson(path.join(process.cwd(), OUTPUT_ROOT, auditDir, "live-blog-page-audit.merged.json"), { rows: [] });
  return new Map((data.rows || []).map((row) => [normalizeUrl(row.url), { ...row, auditDir }]));
}

function slugFromUrl(url) {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).pop() || "";
  } catch {
    return "";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, limit) }, worker));
  return results;
}

function inspectBody({ page, html }) {
  const articleHtml = extractArticleHtml(html);
  const bodyText = stripHtml(articleHtml);
  const fullText = stripHtml(html);
  const title = firstTagText(articleHtml, "h1") || page.title;
  const headings = [...tagTexts(articleHtml, "h2"), ...tagTexts(articleHtml, "h3")];
  const links = getLinks(articleHtml);
  const productLinks = links.filter((link) => link.product).length;
  const cartLinks = links.filter((link) => link.cart).length;
  const blogLinks = links.filter((link) => link.blog && normalizeUrl(link.href) !== normalizeUrl(page.url)).length;
  const collectionLinks = links.filter((link) => link.collection).length;
  const externalLinks = links.filter((link) => !link.internal).length;
  const imageStats = countImagesMissingAlt(articleHtml);
  const words = wordCount(bodyText);
  const first300 = bodyText.split(/\s+/).slice(0, 300).join(" ");
  const lower = `${bodyText}\n${articleHtml}`.toLowerCase();
  const quickAnswerNearTop = /quick answer|short answer|bottom line|best overall|at a glance|tl;dr|answer first/.test(first300.toLowerCase());
  const faqPresent = /frequently asked questions|\bfaq\b|q:\s|q\.\s/i.test(bodyText);
  const faqNearBottom = faqPresent && bodyText.toLowerCase().lastIndexOf("frequently asked questions") > Math.round(bodyText.length * 0.45);
  const comparisonPresent = /\bvs\.?\b|versus|compared|comparison|tradeoff|pros and cons|which.*better/i.test(bodyText);
  const productModuleLikely = /view product|add to cart|add this product to cart|product options/i.test(bodyText);
  const productLinkDensity = words ? Math.round((productLinks / words) * 1000) : 0;
  const addToCartDensity = words ? Math.round((cartLinks / words) * 1000) : 0;
  const aiExplainerSections = [
    "what ai search systems need to understand",
    "why this page is built for ai search",
    "common setup mistakes to avoid",
  ].filter((phrase) => lower.includes(phrase));
  const markdownTableLeak = /\|\s*[-:]{3,}\s*\|/.test(bodyText) || /\|\s*Feature\s*\|/i.test(bodyText);
  const repeatedProductCtas = cartLinks >= 4 || /add to cart(\s+add to cart){2,}/i.test(bodyText);
  const noIntroAnswer = !quickAnswerNearTop;
  const weakInternalLinks = blogLinks < 2;
  const weakShoppingPath = productLinks === 0 && collectionLinks === 0;
  const tooManyProductLinks = productLinkDensity > 18 || productLinks > 24;
  const tooLong = words > 2600;
  const tooShort = words > 0 && words < 700;
  const missingFaqSchema = !hasSchema(html, "FAQPage");
  const missingArticleSchema = !hasSchema(html, "Article") && !hasSchema(html, "BlogPosting");
  const issues = [
    noIntroAnswer && "missing early quick answer",
    weakInternalLinks && "weak internal blog links",
    weakShoppingPath && "weak shopping path",
    productLinks > 0 && !productModuleLikely && "product links lack visible module language",
    repeatedProductCtas && "too many cart CTAs",
    tooManyProductLinks && "product links may be over-concentrated",
    !comparisonPresent && "missing comparison/tradeoff language",
    !faqPresent && "missing visible FAQ",
    faqPresent && !faqNearBottom && "FAQ placement may be too high or unclear",
    missingFaqSchema && "missing FAQPage schema",
    missingArticleSchema && "missing Article/BlogPosting schema",
    imageStats.images > 0 && imageStats.missingAlt > 0 && "missing image alt text",
    aiExplainerSections.length > 0 && "old AI-search explainer section remains",
    markdownTableLeak && "markdown table appears unrendered",
    tooLong && "possibly too long for buyer task",
    tooShort && "possibly too thin",
  ].filter(Boolean);
  const score = Math.max(0, 100 - issues.length * 6 - (noIntroAnswer ? 8 : 0) - (weakShoppingPath ? 10 : 0) - (aiExplainerSections.length ? 12 : 0));
  return {
    url: normalizeUrl(page.url),
    title,
    category: page.category,
    opportunityScore: num(page.opportunity_score),
    opportunityBand: page.opportunity_band,
    bodyScore: score,
    wordCount: words,
    headings: headings.length,
    productLinks,
    cartLinks,
    productLinkDensity,
    addToCartDensity,
    blogLinks,
    collectionLinks,
    externalLinks,
    images: imageStats.images,
    missingAlt: imageStats.missingAlt,
    quickAnswerNearTop,
    faqPresent,
    faqNearBottom,
    comparisonPresent,
    productModuleLikely,
    hasFaqSchema: !missingFaqSchema,
    hasArticleSchema: !missingArticleSchema,
    aiExplainerSections,
    markdownTableLeak,
    primaryCompetitor: page.primary_competitor,
    retestWave: page.retest_wave,
    issues,
    topFix: issues[0] || "monitor",
    h2Preview: headings.slice(0, 8).join("; "),
    sourceStatus: "public",
    fullTextLength: fullText.length,
  };
}

function failedRow(page, error) {
  return {
    url: normalizeUrl(page.url),
    title: page.title,
    category: page.category,
    opportunityScore: num(page.opportunity_score),
    opportunityBand: page.opportunity_band,
    bodyScore: 0,
    wordCount: 0,
    headings: 0,
    productLinks: 0,
    cartLinks: 0,
    productLinkDensity: 0,
    addToCartDensity: 0,
    blogLinks: 0,
    collectionLinks: 0,
    externalLinks: 0,
    images: 0,
    missingAlt: 0,
    quickAnswerNearTop: false,
    faqPresent: false,
    faqNearBottom: false,
    comparisonPresent: false,
    productModuleLikely: false,
    hasFaqSchema: false,
    hasArticleSchema: false,
    aiExplainerSections: [],
    markdownTableLeak: false,
    primaryCompetitor: page.primary_competitor,
    retestWave: page.retest_wave,
    issues: [`fetch failed: ${error.message}`],
    topFix: "fetch failed",
    h2Preview: "",
    sourceStatus: "failed",
    fullTextLength: 0,
  };
}

function liveAuditMetricFallbackRow(page, auditRow, error) {
  const productLinks = num(auditRow.productLinks);
  const collectionLinks = num(auditRow.collectionLinks);
  const blogLinks = num(auditRow.internalBlogLinks);
  const words = num(auditRow.wordCount);
  const missingAlt = num(auditRow.missingAlt);
  const images = num(auditRow.images);
  const missingArticleSchema = !auditRow.hasArticleSchema && !auditRow.hasBlogPostingSchema;
  const missingFaqSchema = !auditRow.hasFaqSchema;
  const noIntroAnswer = !auditRow.hasQuickAnswer;
  const weakInternalLinks = blogLinks < 2;
  const weakShoppingPath = productLinks === 0 && collectionLinks === 0;
  const tooLong = words > 2600;
  const tooShort = words > 0 && words < 700;
  const issues = [
    noIntroAnswer && "missing early quick answer",
    weakInternalLinks && "weak internal blog links",
    weakShoppingPath && "weak shopping path",
    !auditRow.hasComparisonSignals && "missing comparison/tradeoff language",
    !auditRow.hasFaqSection && "missing visible FAQ",
    missingFaqSchema && "missing FAQPage schema",
    missingArticleSchema && "missing Article/BlogPosting schema",
    images > 0 && missingAlt > 0 && "missing image alt text",
    tooLong && "possibly too long for buyer task",
    tooShort && "possibly too thin",
  ].filter(Boolean);
  return {
    url: normalizeUrl(page.url),
    title: auditRow.title || page.title,
    category: page.category || auditRow.category,
    opportunityScore: num(page.opportunity_score),
    opportunityBand: page.opportunity_band,
    bodyScore: num(auditRow.aiCitabilityScore),
    wordCount: words,
    headings: num(auditRow.headings),
    productLinks,
    cartLinks: 0,
    productLinkDensity: words ? Math.round((productLinks / words) * 1000) : 0,
    addToCartDensity: 0,
    blogLinks,
    collectionLinks,
    externalLinks: num(auditRow.externalLinks),
    images,
    missingAlt,
    quickAnswerNearTop: Boolean(auditRow.hasQuickAnswer),
    faqPresent: Boolean(auditRow.hasFaqSection),
    faqNearBottom: Boolean(auditRow.hasFaqSection),
    comparisonPresent: Boolean(auditRow.hasComparisonSignals),
    productModuleLikely: productLinks > 0,
    hasFaqSchema: Boolean(auditRow.hasFaqSchema),
    hasArticleSchema: !missingArticleSchema,
    aiExplainerSections: [],
    markdownTableLeak: false,
    primaryCompetitor: page.primary_competitor,
    retestWave: page.retest_wave,
    issues,
    topFix: issues[0] || "monitor",
    h2Preview: Array.isArray(auditRow.h2) ? auditRow.h2.slice(0, 8).join("; ") : "",
    sourceStatus: "live_audit_metric_fallback",
    publicFetchError: error?.message || "",
    sourceNote: `metrics from ${auditRow.auditDir || "merged live citability audit"}`,
    fullTextLength: 0,
  };
}

function summarize(rows) {
  const okRows = rows.filter((row) => row.sourceStatus !== "failed");
  const fallbackRows = rows.filter((row) => row.sourceStatus === "local_db_fallback");
  const auditFallbackRows = rows.filter((row) => row.sourceStatus === "live_audit_metric_fallback");
  const failedRows = rows.filter((row) => row.sourceStatus === "failed");
  const average = (values) => Math.round(values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length));
  const issueCounts = new Map();
  for (const row of okRows) {
    for (const issue of row.issues) issueCounts.set(issue, (issueCounts.get(issue) || 0) + 1);
  }
  const categoryMap = new Map();
  for (const row of okRows) {
    const category = row.category || "unknown";
    if (!categoryMap.has(category)) categoryMap.set(category, { category, pages: 0, avgBodyScore: 0, avgOpportunityScore: 0, urgentPages: 0, topIssues: new Map(), topPages: [] });
    const item = categoryMap.get(category);
    item.pages += 1;
    item.avgBodyScore += row.bodyScore;
    item.avgOpportunityScore += row.opportunityScore;
    if (row.opportunityScore >= 70 || row.bodyScore < 55) item.urgentPages += 1;
    item.topPages.push(row.title);
    for (const issue of row.issues) item.topIssues.set(issue, (item.topIssues.get(issue) || 0) + 1);
  }
  const categoryRows = [...categoryMap.values()].map((row) => ({
    ...row,
    avgBodyScore: Math.round(row.avgBodyScore / Math.max(1, row.pages)),
    avgOpportunityScore: Math.round(row.avgOpportunityScore / Math.max(1, row.pages)),
    topIssues: [...row.topIssues.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([issue, count]) => `${issue} ${count}`).join("; "),
    topPages: row.topPages.slice(0, 5).join("; "),
  })).sort((a, b) => b.urgentPages - a.urgentPages || a.avgBodyScore - b.avgBodyScore);
  return {
    pages: rows.length,
    fetched: okRows.length,
    publicFetched: rows.filter((row) => row.sourceStatus === "public").length,
    fallbackFetched: fallbackRows.length,
    auditFallbackFetched: auditFallbackRows.length,
    failed: rows.length - okRows.length,
    avgBodyScore: average(okRows.map((row) => row.bodyScore)),
    missingQuickAnswer: rows.filter((row) => row.issues.includes("missing early quick answer")).length,
    weakShoppingPath: rows.filter((row) => row.issues.includes("weak shopping path")).length,
    weakInternalLinks: rows.filter((row) => row.issues.includes("weak internal blog links")).length,
    repeatedCartCtas: rows.filter((row) => row.issues.includes("too many cart CTAs")).length,
    oldAiSections: rows.filter((row) => row.issues.includes("old AI-search explainer section remains")).length,
    markdownLeaks: rows.filter((row) => row.markdownTableLeak).length,
    issueRows: [...issueCounts.entries()].sort((a, b) => b[1] - a[1]).map(([issue, count]) => ({ issue, count })),
    categoryRows,
    topBodyProblems: [...okRows].sort((a, b) => a.bodyScore - b.bodyScore || b.opportunityScore - a.opportunityScore).slice(0, 30),
    topCombinedProblems: [...okRows].sort((a, b) => (b.opportunityScore - b.bodyScore) - (a.opportunityScore - a.bodyScore)).slice(0, 30),
    unavailableRows: failedRows.slice(0, 30),
  };
}

function chart(title, rows, valueKey, labelKey = "title", color = "#0f766e") {
  const chartRows = rows.slice(0, 14);
  const width = 920;
  const rowHeight = 36;
  const height = 72 + chartRows.length * rowHeight;
  const max = Math.max(1, ...chartRows.map((row) => num(row[valueKey])));
  const bars = chartRows.map((row, index) => {
    const y = 54 + index * rowHeight;
    const barWidth = Math.round((num(row[valueKey]) / max) * 470);
    return `<g>
      <text x="22" y="${y + 17}" font-size="13" font-weight="800" fill="#0f172a">${escapeHtml(short(row[labelKey], 40))}</text>
      <rect x="340" y="${y}" width="470" height="22" rx="11" fill="#e5e7eb"/>
      <rect x="340" y="${y}" width="${barWidth}" height="22" rx="11" fill="${color}"/>
      <text x="862" y="${y + 16}" font-size="13" font-weight="900" text-anchor="end" fill="#0f172a">${escapeHtml(row[valueKey])}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#fff"/>
    <text x="22" y="34" font-size="20" font-weight="900" fill="#111827">${escapeHtml(title)}</text>
    ${bars}
  </svg>`;
}

function renderTable(headers, rows) {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header.label)}</th>`).join("")}</tr></thead>`;
  const body = rows.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header.key])}</td>`).join("")}</tr>`).join("");
  return `<table>${head}<tbody>${body}</tbody></table>`;
}

function card(label, value, note) {
  return `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`;
}

function renderHtml({ summary }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT Blog Body Inspection</title>
  <style>
    body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1240px;margin:0 auto;padding:34px 24px 64px}
    h1{font-size:36px;margin:0 0 8px;letter-spacing:0}
    h2{font-size:23px;margin:34px 0 12px}
    p,li{line-height:1.55;color:#334155;font-size:15px}
    .note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #0f766e;border-radius:12px;padding:16px 18px;margin:20px 0}
    .cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:22px 0}
    .card{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:16px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:900}
    .value{font-size:28px;font-weight:900;margin:8px 0;color:#0f172a}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
    .chart{background:#fff;border:1px solid #dbe3ef;border-radius:18px;padding:10px;overflow:auto}
    .chart svg{width:100%;height:auto;display:block}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 22px}
    th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    a{color:#0f766e;overflow-wrap:anywhere}
    @media(max-width:960px){.cards,.grid{grid-template-columns:1fr}h1{font-size:30px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT Blog Body Inspection</h1>
  <p>This checks the live Shopify article body, not just benchmark metadata. It flags whether each post has a clear answer near the top, visible product path, internal links, FAQ/schema, comparison language, and old AI-explainer leftovers.</p>
  <div class="note"><strong>Execution read:</strong> use this after the heatmap. The heatmap tells which page to edit first; this body inspection tells what to fix inside the post.</div>
  <section class="cards">
    ${card("Pages inspected", summary.pages, `${summary.publicFetched} public, ${summary.fallbackFetched} local fallback, ${summary.auditFallbackFetched} audit fallback, ${summary.failed} failed.`)}
    ${card("Avg body score", summary.avgBodyScore, "Body-level readiness score.")}
    ${card("Missing quick answer", summary.missingQuickAnswer, "No early direct answer block.")}
    ${card("Weak shopping path", summary.weakShoppingPath, "No product or collection link in article body.")}
    ${card("Weak internal links", summary.weakInternalLinks, "Fewer than two in-body blog links.")}
  </section>
  <section class="grid">
    <div class="chart">${chart("Most common body issues", summary.issueRows, "count", "issue", "#ef4444")}</div>
    <div class="chart">${chart("Lowest body scores", summary.topBodyProblems.map((row) => ({ ...row, inverseScore: 100 - row.bodyScore })), "inverseScore", "title", "#f97316")}</div>
  </section>
  <h2>Top Combined Body Problems</h2>
  ${renderTable([
    { label: "Body score", key: "bodyScore" },
    { label: "Opportunity", key: "opportunityScore" },
    { label: "Page", key: "title" },
    { label: "Category", key: "category" },
    { label: "Top fix", key: "topFix" },
    { label: "Issues", key: "issuesText" },
  ], summary.topCombinedProblems.slice(0, 20).map((row) => ({ ...row, issuesText: row.issues.slice(0, 6).join("; ") })))}
  <h2>Category Body Rollup</h2>
  ${renderTable([
    { label: "Category", key: "category" },
    { label: "Pages", key: "pages" },
    { label: "Avg body score", key: "avgBodyScore" },
    { label: "Urgent pages", key: "urgentPages" },
    { label: "Top issues", key: "topIssues" },
    { label: "Top pages", key: "topPages" },
  ], summary.categoryRows)}
  <h2>Unavailable Public-Only Rows</h2>
  <p>These URLs were not inspected in the local fallback run because they are not present in the local published-post table and public fetching was disabled or blocked.</p>
  ${renderTable([
    { label: "Opportunity", key: "opportunityScore" },
    { label: "Page", key: "title" },
    { label: "Category", key: "category" },
    { label: "URL", key: "url" },
  ], summary.unavailableRows || [])}
</main>
</body>
</html>`;
}

function renderMarkdown({ summary }) {
  return `# iBOLT Blog Body Inspection

## Bottom Line

This is the body-level pass after the page opportunity heatmap. It inspects live Shopify article bodies for answer placement, product path, internal links, FAQ/schema, comparison language, and old AI-explainer leftovers.

- Pages inspected: ${summary.pages}
- Fetched successfully: ${summary.fetched}
- Public fetches: ${summary.publicFetched}
- Local DB fallbacks: ${summary.fallbackFetched}
- Live-audit metric fallbacks: ${summary.auditFallbackFetched}
- Failed fetches: ${summary.failed}
- Average body score: ${summary.avgBodyScore}
- Missing early quick answer: ${summary.missingQuickAnswer}
- Weak shopping path: ${summary.weakShoppingPath}
- Weak internal links: ${summary.weakInternalLinks}
- Repeated cart CTA issue: ${summary.repeatedCartCtas}
- Old AI-explainer sections still present: ${summary.oldAiSections}

## Most Common Body Issues

${summary.issueRows.slice(0, 12).map((row) => `- ${row.issue}: ${row.count}`).join("\n")}

## Top Combined Body Problems

${summary.topCombinedProblems.slice(0, 15).map((row, index) => `${index + 1}. ${row.title}: body ${row.bodyScore}, opportunity ${row.opportunityScore}, top fix: ${row.topFix}`).join("\n")}

## Category Rollup

${summary.categoryRows.map((row) => `- ${row.category}: avg body ${row.avgBodyScore}, urgent pages ${row.urgentPages}, top issues: ${row.topIssues}`).join("\n")}

## Unavailable Public-Only Rows

These URLs were not inspected in the local fallback run because they are not present in the local published-post table and public fetching was disabled or blocked.

${(summary.unavailableRows || []).slice(0, 20).map((row, index) => `${index + 1}. ${row.title}: opportunity ${row.opportunityScore}, ${row.url}`).join("\n")}
`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, REPORT_DIR);
  const pageRows = await readCsv(path.join(benchmarkDir, "blog-page-opportunity-heatmap", "page-opportunity-heatmap.csv"));
  const pages = MAX_URLS > 0 ? pageRows.slice(0, MAX_URLS) : pageRows;
  const localPostsBySlug = loadLocalPostsBySlug();
  const liveAuditByUrl = await loadLiveAuditByUrl();
  await mkdir(outDir, { recursive: true });
  console.log(`Inspecting ${pages.length} live blog bodies...`);

  const rows = await mapLimit(pages, CONCURRENCY, async (page, index) => {
    if (DELAY_MS > 0) await sleep(DELAY_MS);
    const fallbackPost = localPostsBySlug.get(slugFromUrl(page.url));
    const liveAuditFallback = liveAuditByUrl.get(normalizeUrl(page.url));
    try {
      const html = USE_PUBLIC_FETCH ? await fetchText(page.url) : fallbackPost?.html || fallbackPost?.markdown || "";
      if (!html) throw new Error("No public HTML or local fallback body available");
      const inspected = inspectBody({ page, html });
      if (!USE_PUBLIC_FETCH && fallbackPost) {
        inspected.sourceStatus = "local_db_fallback";
        inspected.title = inspected.title || fallbackPost.title;
        inspected.shopifyArticleId = fallbackPost.shopify_article_id;
        inspected.shopifyBlogId = fallbackPost.shopify_blog_id;
      }
      console.log(`${index + 1}/${pages.length} body ${inspected.bodyScore} ${inspected.title}`);
      return inspected;
    } catch (error) {
      if (fallbackPost?.html || fallbackPost?.markdown) {
        const inspected = inspectBody({ page: { ...page, title: page.title || fallbackPost.title }, html: fallbackPost.html || fallbackPost.markdown });
        inspected.sourceStatus = "local_db_fallback";
        inspected.publicFetchError = error.message;
        inspected.shopifyArticleId = fallbackPost.shopify_article_id;
        inspected.shopifyBlogId = fallbackPost.shopify_blog_id;
        console.log(`${index + 1}/${pages.length} fallback body ${inspected.bodyScore} ${inspected.title}`);
        return inspected;
      }
      if (liveAuditFallback) {
        const inspected = liveAuditMetricFallbackRow(page, liveAuditFallback, error);
        console.log(`${index + 1}/${pages.length} audit fallback body ${inspected.bodyScore} ${inspected.title}`);
        return inspected;
      }
      console.log(`${index + 1}/${pages.length} failed ${page.url}: ${error.message}`);
      return failedRow(page, error);
    }
  });
  const summary = summarize(rows);

  await writeFile(path.join(outDir, "blog-body-inspection.csv"), csv([
    ["body_score", "opportunity_score", "opportunity_band", "title", "url", "category", "word_count", "headings", "product_links", "cart_links", "product_link_density", "add_to_cart_density", "blog_links", "collection_links", "external_links", "images", "missing_alt", "quick_answer_near_top", "faq_present", "faq_near_bottom", "comparison_present", "product_module_likely", "has_faq_schema", "has_article_schema", "ai_explainer_sections", "markdown_table_leak", "primary_competitor", "retest_wave", "top_fix", "issues", "h2_preview", "source_status", "public_fetch_error", "source_note"],
    ...rows.map((row) => [
      row.bodyScore,
      row.opportunityScore,
      row.opportunityBand,
      row.title,
      row.url,
      row.category,
      row.wordCount,
      row.headings,
      row.productLinks,
      row.cartLinks,
      row.productLinkDensity,
      row.addToCartDensity,
      row.blogLinks,
      row.collectionLinks,
      row.externalLinks,
      row.images,
      row.missingAlt,
      row.quickAnswerNearTop,
      row.faqPresent,
      row.faqNearBottom,
      row.comparisonPresent,
      row.productModuleLikely,
      row.hasFaqSchema,
      row.hasArticleSchema,
      row.aiExplainerSections,
      row.markdownTableLeak,
      row.primaryCompetitor,
      row.retestWave,
      row.topFix,
      row.issues,
      row.h2Preview,
      row.sourceStatus,
      row.publicFetchError || "",
      row.sourceNote || "",
    ]),
  ]));
  await writeFile(path.join(outDir, "body-issue-summary.csv"), csv([
    ["issue", "pages"],
    ...summary.issueRows.map((row) => [row.issue, row.count]),
  ]));
  await writeFile(path.join(outDir, "body-category-rollup.csv"), csv([
    ["category", "pages", "avg_body_score", "avg_opportunity_score", "urgent_pages", "top_issues", "top_pages"],
    ...summary.categoryRows.map((row) => [row.category, row.pages, row.avgBodyScore, row.avgOpportunityScore, row.urgentPages, row.topIssues, row.topPages]),
  ]));
  await writeFile(path.join(outDir, "body-first-fix-queue.csv"), csv([
    ["rank", "body_score", "opportunity_score", "title", "url", "category", "top_fix", "issues", "retest_wave"],
    ...summary.topCombinedProblems.map((row, index) => [index + 1, row.bodyScore, row.opportunityScore, row.title, row.url, row.category, row.topFix, row.issues, row.retestWave]),
  ]));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown({ summary }));
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml({ summary }));
  await writeFile(path.join(outDir, "blog-body-inspection-data.json"), JSON.stringify({ summary, rows }, null, 2));

  console.log(`Wrote ${outDir}`);
  console.log(`Pages: ${summary.pages}; avg body score: ${summary.avgBodyScore}; missing quick answer: ${summary.missingQuickAnswer}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
