import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const STORE_ORIGIN = process.env.IBOLT_STORE_ORIGIN || "https://iboltmounts.com";
const BLOG_SITEMAP_URL = process.env.BLOG_SITEMAP_URL || `${STORE_ORIGIN}/sitemap_blogs_1.xml`;
const OUTPUT_ROOT = "content-output";
const DB_PATH = process.env.DATABASE_PATH || "data/sourceannotator.db";
const CONCURRENCY = Number(process.env.AI_CITABILITY_AUDIT_CONCURRENCY || "4");
const MAX_URLS = Number(process.env.AI_CITABILITY_AUDIT_MAX_URLS || "0");
const USE_PUBLIC_FETCH = process.env.AI_CITABILITY_AUDIT_PUBLIC_FETCH !== "0";
const URL_FILE = process.env.AI_CITABILITY_AUDIT_URL_FILE || "";
const DELAY_MS = Number(process.env.AI_CITABILITY_AUDIT_DELAY_MS || "0");

const BRANDS = [
  "RAM Mounts",
  "RAM",
  "Arkon",
  "iOttie",
  "ProClip",
  "Tackform",
  "Mount-It",
  "Bouncepad",
  "Square",
  "Scosche",
  "YakAttack",
  "Scotty",
  "Garmin",
  "Lowrance",
  "Humminbird",
  "Railblaza",
  "Quad Lock",
  "Belkin",
  "Peak Design",
];

const CATEGORIES = [
  { name: "delivery", terms: ["delivery", "doordash", "uber eats", "grubhub", "instacart", "amazon flex", "grocery"] },
  { name: "restaurant", terms: ["restaurant", "pos", "tablet tower", "multi tablet", "food truck", "quick service", "square", "toast"] },
  { name: "fishing", terms: ["fish finder", "kayak", "boat", "marine", "garmin striker", "pontoon", "rough water"] },
  { name: "fleet", terms: ["fleet", "eld", "truck", "trucking", "commercial vehicle", "work truck", "van"] },
  { name: "warehouse", terms: ["forklift", "warehouse", "material handling", "vesa", "barcode scanner"] },
  { name: "streaming", terms: ["stream", "livestream", "camera", "overhead", "content creator", "product photography", "cooking"] },
  { name: "amps/modular", terms: ["amps", "modular", "ball mount", "mounting plate", "clamp", "clip", "screw", "socket"] },
  { name: "offroad", terms: ["jeep", "utv", "off-road", "offroad", "overlanding", "gopro"] },
  { name: "education", terms: ["school", "classroom", "student", "bus"] },
  { name: "agriculture", terms: ["tractor", "farm", "agriculture"] },
];

function stamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function tagTexts(html, tag) {
  return [...String(html || "").matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))]
    .map((match) => stripHtml(match[1]))
    .filter(Boolean);
}

function wordCount(textOrHtml) {
  const text = /<[^>]+>/.test(textOrHtml) ? stripHtml(textOrHtml) : String(textOrHtml || "");
  return (text.match(/[A-Za-z0-9][A-Za-z0-9'’+-]*/g) || []).length;
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
      errors.push(error.message);
    }
  }
  return { parsed, errors };
}

function collectSchemaTypes(value, out = []) {
  if (!value) return out;
  if (Array.isArray(value)) {
    for (const item of value) collectSchemaTypes(item, out);
    return out;
  }
  if (typeof value !== "object") return out;
  const type = value["@type"];
  if (Array.isArray(type)) out.push(...type.map(String));
  else if (type) out.push(String(type));
  for (const key of ["@graph", "mainEntity", "itemListElement", "item", "offers"]) {
    if (value[key]) collectSchemaTypes(value[key], out);
  }
  return out;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function linksInHtml(html) {
  const links = [];
  for (const match of String(html || "").matchAll(/<a\b[^>]*\bhref=([\"'])([\s\S]*?)\1[^>]*>/gi)) {
    const href = decodeHtml(match[2]).trim();
    if (!href || href.startsWith("#") || /^mailto:|^tel:/i.test(href)) continue;
    try {
      const url = new URL(href.startsWith("//") ? `https:${href}` : href, STORE_ORIGIN);
      const storeHost = new URL(STORE_ORIGIN).hostname.replace(/^www\./, "");
      const host = url.hostname.replace(/^www\./, "");
      links.push({
        href: url.toString(),
        internal: host === storeHost || host.endsWith(".myshopify.com"),
        product: /^\/products\//i.test(url.pathname),
        collection: /^\/collections\//i.test(url.pathname),
        blog: /^\/blogs\//i.test(url.pathname),
      });
    } catch {
      links.push({ href, internal: false, product: false, collection: false, blog: false });
    }
  }
  return links;
}

function imageStats(html) {
  const tags = String(html || "").match(/<img\b[^>]*>/gi) || [];
  return {
    total: tags.length,
    missingAlt: tags.filter((tag) => !attr(tag, "alt").trim()).length,
  };
}

function detectBrands(text) {
  const lower = String(text || "").toLowerCase();
  return unique(BRANDS.filter((brand) => {
    const pattern = brand.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\ ram\\ /g, "\\s+ram\\s+");
    if (brand === "RAM") return /\bram\b/i.test(text);
    return new RegExp(`\\b${pattern}\\b`, "i").test(lower);
  }).map((brand) => brand === "RAM" ? "RAM Mounts" : brand));
}

function classifyCategory(text, title = "") {
  const lower = String(text || "").toLowerCase();
  const primary = String(title || "").toLowerCase();
  const scored = CATEGORIES.map((category) => ({
    category: category.name,
    score: category.terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0) + (primary.includes(term) ? 4 : 0), 0),
  })).filter((row) => row.score > 0).sort((a, b) => b.score - a.score);
  return scored[0]?.category || "other";
}

function parseSitemapUrls(xml) {
  return [...String(xml || "").matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => match[1])
    .filter((url) => /\/blogs\/[^/]+\/[^/?#]+/i.test(url));
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

function slugFromUrl(url) {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).pop() || "";
  } catch {
    return "";
  }
}

function hasQuickAnswer(text, html) {
  return /quick answer|short answer|bottom line|best overall|at a glance|answer first|tl;dr/i.test(`${text}\n${html}`);
}

function hasFaqSection(text) {
  return /frequently asked questions|FAQ|Q:\s|Q\.\s|questions\s+about/i.test(text);
}

function hasComparisonSignals(text, html) {
  return /\bvs\.?\b|versus|compared|comparison|alternative|better than|tradeoff|pros and cons|which.*better/i.test(`${text}\n${html}`);
}

function scorePage(row) {
  let score = 0;
  const reasons = [];
  const add = (points, ok, reason) => {
    if (ok) score += points;
    else reasons.push(reason);
  };
  add(14, row.wordCount >= 750, "Increase body depth to at least ~750 words or ensure the article has enough answer detail.");
  add(12, row.productLinks >= 1, "Add direct product links to the specific iBOLT products recommended.");
  add(8, row.collectionLinks >= 1, "Add a supporting collection link for broader shopping context.");
  add(12, row.hasArticleSchema || row.hasBlogPostingSchema, "Add or validate Article/BlogPosting schema.");
  add(12, row.hasFaqSchema || row.hasFaqSection, "Add FAQ section and FAQ schema for AI-readable Q&A.");
  add(10, row.hasQuickAnswer, "Add a concise quick-answer block near the top.");
  add(8, row.hasComparisonSignals, "Add comparison/tradeoff language against alternatives.");
  add(8, row.headings >= 4, "Add more descriptive H2/H3 sections.");
  add(6, row.images > 0 && row.missingAlt === 0, "Add descriptive alt text to all article images.");
  add(5, row.metaDescription.length >= 110 && row.metaDescription.length <= 165, "Tighten meta description to roughly 110-165 characters.");
  add(5, row.iboltMentions >= 2, "Mention iBOLT naturally in the answer body and recommendation sections.");
  return { score: Math.min(100, score), fixes: reasons };
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 iBOLT AI citability audit" },
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status} ${text.slice(0, 200)}`);
  return text;
}

function analyzePage(url, html) {
  const text = stripHtml(html);
  const title = firstTagText(html, "h1") || metaContent(html, ["og:title"]) || firstTagText(html, "title");
  const metaDescription = metaContent(html, ["description", "og:description"]);
  const h2 = tagTexts(html, "h2");
  const h3 = tagTexts(html, "h3");
  const links = linksInHtml(html);
  const images = imageStats(html);
  const jsonLd = parseJsonLd(html);
  const schemaTypes = unique(collectSchemaTypes(jsonLd.parsed));
  const detectedBrands = detectBrands(`${title}\n${text}`);
  const category = classifyCategory(`${url}\n${text}`, title);
  const row = {
    url,
    title,
    category,
    status: "ok",
    wordCount: wordCount(text),
    metaDescription,
    headings: h2.length + h3.length,
    h2: h2.slice(0, 8),
    hasQuickAnswer: hasQuickAnswer(text, html),
    hasFaqSection: hasFaqSection(text),
    hasComparisonSignals: hasComparisonSignals(text, html),
    hasTable: /<table\b/i.test(html),
    hasArticleSchema: schemaTypes.includes("Article"),
    hasBlogPostingSchema: schemaTypes.includes("BlogPosting"),
    hasFaqSchema: schemaTypes.includes("FAQPage"),
    hasProductSchema: schemaTypes.includes("Product"),
    hasOrganizationSchema: schemaTypes.includes("Organization"),
    schemaTypes,
    jsonLdErrors: jsonLd.errors,
    productLinks: links.filter((link) => link.product).length,
    collectionLinks: links.filter((link) => link.collection).length,
    internalBlogLinks: links.filter((link) => link.blog && link.href !== url).length,
    internalLinks: links.filter((link) => link.internal).length,
    externalLinks: links.filter((link) => !link.internal).length,
    images: images.total,
    missingAlt: images.missingAlt,
    iboltMentions: (text.match(/\bi[\s-]?bolt\b/gi) || []).length,
    competitorBrands: detectedBrands.filter((brand) => brand !== "iBOLT"),
  };
  const scored = scorePage(row);
  return {
    ...row,
    source: "public",
    aiCitabilityScore: scored.score,
    recommendedFixes: scored.fixes,
  };
}

function analyzeLocalFallback(url, post, publicError) {
  const html = post.html || post.markdown || "";
  const analyzed = analyzePage(url, html);
  return {
    ...analyzed,
    title: analyzed.title || post.title,
    source: "local_db_fallback",
    status: "fallback_local",
    publicFetchError: publicError,
    shopifyArticleId: post.shopify_article_id,
    shopifyBlogId: post.shopify_blog_id,
  };
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = Array.isArray(value) ? value.join("; ") : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function csv(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function mdTable(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map((cell) => String(cell ?? "").replace(/\|/g, "\\|")).join(" | ")} |`),
  ].join("\n");
}

function barChart({ title, subtitle, rows, color = "#2563eb", width = 1160 }) {
  const rowH = 43;
  const height = 126 + rows.length * rowH + 34;
  const left = 470;
  const barW = width - left - 120;
  const top = 108;
  const max = Math.max(1, ...rows.map((row) => Number(row.value || 0)));
  const bars = rows.map((row, index) => {
    const y = top + index * rowH;
    const w = Math.max(3, Math.round((Number(row.value || 0) / max) * barW));
    return `
      <text class="label" x="52" y="${y + 15}">${escapeHtml(row.label)}</text>
      <text class="small" x="52" y="${y + 33}">${escapeHtml(row.note || "")}</text>
      <rect x="${left}" y="${y}" width="${barW}" height="24" rx="8" fill="#e2e8f0"/>
      <rect x="${left}" y="${y}" width="${w}" height="24" rx="8" fill="${color}"/>
      <text class="value" x="${left + barW + 14}" y="${y + 17}">${escapeHtml(row.display ?? row.value)}</text>
    `;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    .bg{fill:#f8fafc}.panel{fill:#fff;stroke:#d7dee8;stroke-width:1}.title{font:700 24px Arial,sans-serif;fill:#111827}.subtitle{font:400 14px Arial,sans-serif;fill:#64748b}.label{font:700 13px Arial,sans-serif;fill:#111827}.small{font:400 12px Arial,sans-serif;fill:#475569}.value{font:700 13px Arial,sans-serif;fill:#0f172a}
  </style>
  <rect class="bg" width="${width}" height="${height}"/>
  <rect class="panel" x="28" y="24" width="${width - 56}" height="${height - 48}" rx="14"/>
  <text class="title" x="52" y="64">${escapeHtml(title)}</text>
  <text class="subtitle" x="52" y="87">${escapeHtml(subtitle)}</text>
  ${bars}
</svg>`;
}

function summarize(rows) {
  const ok = rows.filter((row) => row.status !== "failed");
  const avg = Math.round(ok.reduce((sum, row) => sum + row.aiCitabilityScore, 0) / Math.max(1, ok.length));
  const byCategory = new Map();
  for (const row of ok) {
    const bucket = byCategory.get(row.category) || { category: row.category, count: 0, avgScore: 0 };
    bucket.count += 1;
    bucket.avgScore += row.aiCitabilityScore;
    byCategory.set(row.category, bucket);
  }
  const categories = [...byCategory.values()]
    .map((bucket) => ({ ...bucket, avgScore: Math.round(bucket.avgScore / bucket.count) }))
    .sort((a, b) => b.count - a.count);
  return {
    total: rows.length,
    ok: ok.length,
    failed: rows.length - ok.length,
    publicFetched: ok.filter((row) => row.source === "public").length,
    localFallback: ok.filter((row) => row.source === "local_db_fallback").length,
    avgScore: avg,
    missingFaqSchema: ok.filter((row) => !row.hasFaqSchema).length,
    missingArticleSchema: ok.filter((row) => !row.hasArticleSchema && !row.hasBlogPostingSchema).length,
    noProductLinks: ok.filter((row) => row.productLinks === 0).length,
    noQuickAnswer: ok.filter((row) => !row.hasQuickAnswer).length,
    noComparisonSignals: ok.filter((row) => !row.hasComparisonSignals).length,
    categories,
    lowest: [...ok].sort((a, b) => a.aiCitabilityScore - b.aiCitabilityScore).slice(0, 25),
  };
}

function buildMarkdown(summary, rows, sourceLabel = BLOG_SITEMAP_URL) {
  const issueRows = [
    ["Issue", "Pages affected"],
    ["No FAQ schema", summary.missingFaqSchema],
    ["No Article/BlogPosting schema", summary.missingArticleSchema],
    ["No direct product links", summary.noProductLinks],
    ["No quick-answer block", summary.noQuickAnswer],
    ["No comparison/tradeoff signals", summary.noComparisonSignals],
  ];
  return `# Live Blog AI-Citability Audit

Source: ${sourceLabel}

## Summary

- Pages audited: ${summary.ok}/${summary.total}
- Public pages fetched: ${summary.publicFetched}
- Local DB fallbacks used: ${summary.localFallback}
- Average AI-citability score: ${summary.avgScore}/100
- Failed fetches: ${summary.failed}

## Most Common Issues

${mdTable(issueRows[0], issueRows.slice(1))}

## Topic Inventory

${mdTable(
  ["Topic", "Pages", "Avg AI-citability score"],
  summary.categories.map((row) => [row.category, row.count, row.avgScore]),
)}

## Lowest-Scoring Live Blog Pages

${mdTable(
  ["Score", "Title", "Topic", "Product links", "FAQ schema", "Article schema", "Top fix"],
  summary.lowest.slice(0, 20).map((row) => [
    row.aiCitabilityScore,
    `[${row.title || row.url}](${row.url})`,
    row.category,
    row.productLinks,
    row.hasFaqSchema ? "yes" : "no",
    row.hasArticleSchema || row.hasBlogPostingSchema ? "yes" : "no",
    row.recommendedFixes[0] || "Monitor",
  ]),
)}

## Action Interpretation

For AI visibility, the highest-leverage updates are the ones that make a page easy to quote and trust: a short direct answer near the top, FAQ schema, Article schema, comparison/tradeoff sections, direct product links, and externally recognizable competitor/category language.
`;
}

function buildHtml(summary) {
  const issueCards = [
    ["No FAQ schema", summary.missingFaqSchema],
    ["No Article schema", summary.missingArticleSchema],
    ["No product links", summary.noProductLinks],
    ["No quick answer", summary.noQuickAnswer],
    ["No comparison language", summary.noComparisonSignals],
  ].map(([label, value]) => `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${value}</div></div>`).join("");
  const lowRows = summary.lowest.slice(0, 25).map((row) => `
    <tr>
      <td>${row.aiCitabilityScore}</td>
      <td><a href="${escapeHtml(row.url)}">${escapeHtml(row.title || row.url)}</a></td>
      <td>${escapeHtml(row.category)}</td>
      <td>${row.productLinks}</td>
      <td>${row.hasFaqSchema ? "yes" : "no"}</td>
      <td>${row.hasArticleSchema || row.hasBlogPostingSchema ? "yes" : "no"}</td>
      <td>${escapeHtml(row.recommendedFixes[0] || "Monitor")}</td>
    </tr>
  `).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Live Blog AI-Citability Audit</title>
<style>
body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}main{max-width:1220px;margin:0 auto;padding:34px 26px 60px}h1{font-size:34px;margin:0 0 8px}h2{font-size:22px;margin:34px 0 14px}p{color:#334155;line-height:1.55}.meta{color:#64748b;font-size:14px}.cards{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}.k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700}.v{font-size:30px;font-weight:800;margin-top:8px}figure{background:#fff;border:1px solid #d7dee8;border-radius:14px;margin:14px 0;padding:10px;overflow:auto}figure img{display:block;width:100%;height:auto}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden}th,td{text-align:left;vertical-align:top;padding:11px 12px;border-bottom:1px solid #edf2f7;font-size:14px}th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:12px;letter-spacing:.04em}a{color:#1d4ed8}.takeaway{border-left:6px solid #2563eb;background:#fff;border-radius:10px;padding:16px 18px;border-top:1px solid #d7dee8;border-right:1px solid #d7dee8;border-bottom:1px solid #d7dee8}
</style></head><body><main>
<div class="meta">Sitemap: ${escapeHtml(BLOG_SITEMAP_URL)}</div>
<h1>Live Blog AI-Citability Audit</h1>
<p class="takeaway"><strong>Readout:</strong> The live blog has useful coverage, but pages need more quote-ready answer blocks, FAQ/schema, direct product links, and comparison language to increase AI mentions and citations. Public fetches are preferred; local DB fallback is used when the store returns bot-verification pages.</p>
<section class="cards">
  <div class="card"><div class="k">Pages audited</div><div class="v">${summary.ok}</div></div>
  <div class="card"><div class="k">Avg score</div><div class="v">${summary.avgScore}</div></div>
  <div class="card"><div class="k">Public fetched</div><div class="v">${summary.publicFetched}</div></div>
  <div class="card"><div class="k">DB fallback</div><div class="v">${summary.localFallback}</div></div>
  ${issueCards}
</section>
<h2>Charts</h2>
<figure><img src="lowest-pages.svg" alt="Lowest-scoring pages"/></figure>
<figure><img src="topic-scores.svg" alt="Topic scores"/></figure>
<h2>Lowest-Scoring Pages</h2>
<table><thead><tr><th>Score</th><th>Title</th><th>Topic</th><th>Product links</th><th>FAQ schema</th><th>Article schema</th><th>Top fix</th></tr></thead><tbody>${lowRows}</tbody></table>
</main></body></html>`;
}

async function main() {
  const outputDir = path.join(OUTPUT_ROOT, `live-blog-ai-citability-${stamp()}`);
  await mkdir(outputDir, { recursive: true });
  let sourceLabel = BLOG_SITEMAP_URL;
  let urls;
  if (URL_FILE) {
    sourceLabel = path.resolve(URL_FILE);
    const lines = (await readFile(URL_FILE, "utf8"))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => /^https?:\/\//i.test(line));
    urls = [...new Set(lines)];
  } else {
    const sitemap = await fetchText(BLOG_SITEMAP_URL);
    urls = parseSitemapUrls(sitemap);
  }
  if (MAX_URLS > 0) urls = urls.slice(0, MAX_URLS);
  const localPostsBySlug = loadLocalPostsBySlug();
  console.log(`Auditing ${urls.length} blog URLs from ${sourceLabel}`);

  const rows = await mapLimit(urls, CONCURRENCY, async (url, index) => {
    try {
      if (DELAY_MS > 0 && index > 0) await sleep(DELAY_MS);
      if (!USE_PUBLIC_FETCH) throw new Error("Public fetch disabled by AI_CITABILITY_AUDIT_PUBLIC_FETCH=0.");
      const html = await fetchText(url);
      const analyzed = analyzePage(url, html);
      console.log(`${index + 1}/${urls.length} ${analyzed.aiCitabilityScore} ${analyzed.title || url}`);
      return analyzed;
    } catch (error) {
      const fallback = localPostsBySlug.get(slugFromUrl(url));
      if (fallback) {
        const analyzed = analyzeLocalFallback(url, fallback, error.message);
        console.log(`${index + 1}/${urls.length} ${analyzed.aiCitabilityScore} fallback ${analyzed.title || url}`);
        return analyzed;
      }
      console.log(`${index + 1}/${urls.length} failed ${url}: ${error.message}`);
      return { url, status: "failed", error: error.message, aiCitabilityScore: 0, recommendedFixes: ["Fetch failed."] };
    }
  });

  const summary = summarize(rows);
  await writeFile(path.join(outputDir, "live-blog-page-audit.json"), JSON.stringify({ summary, rows }, null, 2));
  await writeFile(path.join(outputDir, "live-blog-page-audit.csv"), csv([
    [
      "score", "url", "title", "category", "word_count", "product_links", "collection_links", "internal_blog_links",
      "has_quick_answer", "has_faq_section", "has_faq_schema", "has_article_schema", "has_product_schema",
      "has_comparison_signals", "has_table", "images", "missing_alt", "ibolt_mentions", "competitor_brands", "source", "top_fixes",
    ],
    ...rows.map((row) => [
      row.aiCitabilityScore,
      row.url,
      row.title,
      row.category,
      row.wordCount,
      row.productLinks,
      row.collectionLinks,
      row.internalBlogLinks,
      row.hasQuickAnswer,
      row.hasFaqSection,
      row.hasFaqSchema,
      row.hasArticleSchema || row.hasBlogPostingSchema,
      row.hasProductSchema,
      row.hasComparisonSignals,
      row.hasTable,
      row.images,
      row.missingAlt,
      row.iboltMentions,
      row.competitorBrands || [],
      row.source || row.status,
      row.recommendedFixes || [],
    ]),
  ]));
  await writeFile(path.join(outputDir, "REPORT.md"), buildMarkdown(summary, rows, sourceLabel));
  await writeFile(path.join(outputDir, "REPORT.html"), buildHtml(summary));
  await writeFile(path.join(outputDir, "lowest-pages.svg"), barChart({
    title: "Lowest AI-Citability Scores",
    subtitle: "Pages most in need of answer/schema/product-link refreshes.",
    color: "#dc2626",
    rows: summary.lowest.slice(0, 16).map((row) => ({
      label: row.title || row.url,
      note: row.category,
      value: 100 - row.aiCitabilityScore,
      display: row.aiCitabilityScore,
    })),
  }));
  await writeFile(path.join(outputDir, "topic-scores.svg"), barChart({
    title: "Live Blog Topic Inventory",
    subtitle: "Page count by inferred topic; number labels show average AI-citability score.",
    color: "#16a34a",
    rows: summary.categories.map((row) => ({
      label: row.category,
      note: `${row.count} pages`,
      value: row.count,
      display: `${row.avgScore}`,
    })),
  }));

  console.log(outputDir);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
