import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";

const CATEGORY_INTENT = new Map([
  ["delivery", 96],
  ["restaurant", 94],
  ["fleet", 92],
  ["warehouse", 90],
  ["tablet", 88],
  ["amps/modular", 84],
  ["streaming", 80],
  ["fishing", 78],
  ["travel", 74],
  ["education", 70],
  ["cycling", 68],
  ["other", 55],
]);

const HIGH_INTENT_TERMS = [
  "best",
  "mount",
  "stand",
  "holder",
  "tablet",
  "phone",
  "delivery",
  "restaurant",
  "pos",
  "forklift",
  "warehouse",
  "scanner",
  "eld",
  "fleet",
  "truck",
  "locking",
  "clamp",
  "drill",
  "amps",
  "camera",
  "streaming",
  "fish finder",
];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (cell.length || row.length) row.push(cell);
  if (row.length) rows.push(row);
  if (!rows.length) return [];
  const [headers, ...records] = rows;
  return records
    .filter((record) => record.some((value) => String(value ?? "").trim()))
    .map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""])));
}

async function readCsv(filePath) {
  try {
    return parseCsv(await readFile(filePath, "utf8"));
  } catch {
    return [];
  }
}

async function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
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

function num(value) {
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/^\+\d+\s+more$/i.test(item));
}

function normalizeUrl(value) {
  return String(value ?? "").replace(/\/+$/, "");
}

function keyForUrl(value) {
  return normalizeUrl(value).toLowerCase();
}

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function addToCounter(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function firstCounterItems(map, count = 6) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, count)
    .map(([name, value]) => `${name} ${value}`);
}

function rowByUrl(rows, field = "url") {
  const map = new Map();
  for (const row of rows) {
    const url = keyForUrl(row[field] || row.page_url || row.url);
    if (url && !map.has(url)) map.set(url, row);
  }
  return map;
}

function rowsByUrl(rows, field = "url") {
  const map = new Map();
  for (const row of rows) {
    const url = keyForUrl(row[field] || row.page_url || row.url || row.pageUrl);
    if (!url) continue;
    if (!map.has(url)) map.set(url, []);
    map.get(url).push(row);
  }
  return map;
}

function issueSet(...values) {
  const issues = new Set();
  for (const value of values) {
    for (const item of splitList(value)) {
      const clean = item.toLowerCase().replace(/^missing\s+/, "").trim();
      if (clean) issues.add(clean);
    }
  }
  return issues;
}

function titleIntentScore(title, prompts) {
  const text = `${title} ${prompts}`.toLowerCase();
  let score = 0;
  for (const term of HIGH_INTENT_TERMS) {
    if (text.includes(term)) score += term.includes(" ") ? 6 : 4;
  }
  return clamp(score, 0, 100);
}

function categoryIntentScore(category) {
  const normalized = String(category || "").toLowerCase();
  if (CATEGORY_INTENT.has(normalized)) return CATEGORY_INTENT.get(normalized);
  for (const [key, value] of CATEGORY_INTENT.entries()) {
    if (normalized.includes(key)) return value;
  }
  return 58;
}

function aiPressureScore(row) {
  const benchmark = num(row.benchmark_query_count || row.query_count || row.prompt_count);
  const zero = num(row.zero_mention_queries);
  const competitorOnly = num(row.competitor_only_answers);
  const opportunity = num(row.avg_opportunity || row.benchmark_avg_score);
  return clamp(benchmark * 11 + zero * 18 + competitorOnly * 13 + opportunity * 0.45);
}

function productDepthScore(row, productRows) {
  const productLinks = num(row.product_links);
  const productTargets = num(row.product_entity_targets);
  const productsToFeature = splitList(row.product_module || row.products_to_add || row.products_to_feature).length;
  const entityRows = productRows.length;
  return clamp(productLinks * 3 + productTargets * 8 + productsToFeature * 8 + entityRows * 4);
}

function readinessScore(row, issues) {
  let score = 100;
  if (issues.has("quick answer")) score -= 20;
  if (issues.has("faq schema")) score -= 18;
  if (issues.has("article/blogposting schema")) score -= 14;
  if (issues.has("comparison block") || issues.has("comparison signals")) score -= 16;
  if (issues.has("image alt") || issues.has("image alt text")) score -= 8;
  if (/canonical|duplicate/i.test(`${row.action || ""} ${row.action_bucket || ""} ${row.triage_action || ""} ${row.duplicate_risk || ""}`)) score -= 12;
  return clamp(score);
}

function citationFixScore(issues) {
  let score = 0;
  if (issues.has("quick answer")) score += 22;
  if (issues.has("faq schema")) score += 24;
  if (issues.has("article/blogposting schema")) score += 16;
  if (issues.has("comparison block") || issues.has("comparison signals")) score += 18;
  if (issues.has("image alt") || issues.has("image alt text")) score += 8;
  return clamp(score);
}

function recommendedAction(row, issues, score) {
  const actionText = `${row.action || ""} ${row.action_bucket || ""} ${row.triage_action || ""}`.toLowerCase();
  const duplicateRisk = /canonical|duplicate|consolidat|merge/.test(actionText) || /yes/i.test(row.duplicate_risk || "");
  if (duplicateRisk) return "Canonical review, then checkout-oriented refresh";
  if (score >= 80 && num(row.benchmark_query_count || row.query_count) > 0) return "High-priority checkout-oriented AI refresh";
  if (issues.has("faq schema") || issues.has("article/blogposting schema") || issues.has("quick answer")) return "Citation and schema cleanup";
  if (num(row.product_links) < 3 && num(row.product_entity_targets) > 0) return "Add product module and internal links";
  return "Protect, measure, and retest";
}

function checkoutAction(row, issues, productRows) {
  const products = splitList(row.product_module || row.products_to_add || row.products_to_feature);
  const firstProducts = products.length ? products.slice(0, 3) : productRows.slice(0, 3).map((item) => item.title);
  const actions = [];
  if (issues.has("quick answer")) actions.push("add a 40 to 70 word buyer-answer block near the top");
  if (issues.has("comparison block") || issues.has("comparison signals")) actions.push("add a fair comparison table beside the competitor set");
  if (issues.has("faq schema")) actions.push("add visible FAQs and FAQPage schema");
  if (issues.has("article/blogposting schema")) actions.push("add Article or BlogPosting schema");
  if (firstProducts.length) actions.push(`feature ${firstProducts.join("; ")}`);
  actions.push("use one clean product module per major decision section, not repeated add-to-cart buttons after every link");
  return actions.join("; ");
}

function ctaGuidance(row) {
  const productLinks = num(row.product_links);
  if (productLinks >= 20) {
    return "Too many inline product opportunities already. Use section-level product cards and one clear View Product CTA per product module.";
  }
  if (productLinks >= 8) {
    return "Keep inline links, then add compact product cards for the top 2 to 4 products. Avoid button clusters.";
  }
  return "Add product cards with product image, exact name, price when known, View Product CTA, and optional Add to Cart only for the primary pick.";
}

function conversionTier(score) {
  if (score >= 85) return "Sprint 1";
  if (score >= 70) return "Sprint 2";
  if (score >= 55) return "Sprint 3";
  return "Monitor";
}

function productFamilyForRows(productRows) {
  const counter = new Map();
  for (const row of productRows) {
    for (const family of splitList(row.families)) addToCounter(counter, family);
  }
  return firstCounterItems(counter, 3);
}

function buildSvgBarChart({ title, rows, labelField, valueField, outputPath, width = 1100, height = 560 }) {
  const margin = { top: 70, right: 40, bottom: 60, left: 330 };
  const barHeight = 30;
  const gap = 16;
  const chartRows = rows.slice(0, 10);
  const max = Math.max(...chartRows.map((row) => num(row[valueField])), 1);
  const chartHeight = chartRows.length * (barHeight + gap);
  const actualHeight = Math.max(height, margin.top + chartHeight + margin.bottom);
  const chartWidth = width - margin.left - margin.right;
  const bars = chartRows
    .map((row, index) => {
      const y = margin.top + index * (barHeight + gap);
      const value = num(row[valueField]);
      const barWidth = Math.max(4, Math.round((value / max) * chartWidth));
      const label = String(row[labelField] || "").slice(0, 54);
      return `
        <text x="${margin.left - 16}" y="${y + 21}" text-anchor="end" font-size="15" fill="#172033">${escapeHtml(label)}</text>
        <rect x="${margin.left}" y="${y}" width="${barWidth}" height="${barHeight}" rx="6" fill="#0b5cab"/>
        <text x="${margin.left + barWidth + 10}" y="${y + 21}" font-size="15" fill="#172033">${escapeHtml(value)}</text>`;
    })
    .join("\n");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${actualHeight}" viewBox="0 0 ${width} ${actualHeight}">
  <rect width="100%" height="100%" fill="#f7f9fc"/>
  <text x="${margin.left}" y="38" font-size="24" font-weight="700" fill="#111827">${escapeHtml(title)}</text>
  <text x="${margin.left}" y="62" font-size="14" fill="#4b5563">Higher scores combine AI visibility pressure, commercial intent, product readiness, and missing citation fixes.</text>
  ${bars}
</svg>`;
  return writeFile(outputPath, svg);
}

function buildTwoMetricSvg({ title, rows, outputPath, width = 1100, height = 560 }) {
  const margin = { top: 76, right: 50, bottom: 60, left: 280 };
  const rowGap = 48;
  const chartRows = rows.slice(0, 10);
  const max = Math.max(...chartRows.flatMap((row) => [num(row.ai_pressure_score), num(row.commercial_intent_score)]), 1);
  const chartWidth = width - margin.left - margin.right;
  const actualHeight = Math.max(height, margin.top + chartRows.length * rowGap + margin.bottom);
  const bars = chartRows
    .map((row, index) => {
      const y = margin.top + index * rowGap;
      const aiWidth = Math.max(4, Math.round((num(row.ai_pressure_score) / max) * chartWidth));
      const intentWidth = Math.max(4, Math.round((num(row.commercial_intent_score) / max) * chartWidth));
      return `
        <text x="${margin.left - 16}" y="${y + 22}" text-anchor="end" font-size="14" fill="#172033">${escapeHtml(String(row.title || "").slice(0, 45))}</text>
        <rect x="${margin.left}" y="${y}" width="${aiWidth}" height="16" rx="4" fill="#0b5cab"/>
        <rect x="${margin.left}" y="${y + 20}" width="${intentWidth}" height="16" rx="4" fill="#19a974"/>
        <text x="${margin.left + aiWidth + 8}" y="${y + 13}" font-size="12" fill="#172033">AI ${escapeHtml(row.ai_pressure_score)}</text>
        <text x="${margin.left + intentWidth + 8}" y="${y + 33}" font-size="12" fill="#172033">Intent ${escapeHtml(row.commercial_intent_score)}</text>`;
    })
    .join("\n");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${actualHeight}" viewBox="0 0 ${width} ${actualHeight}">
  <rect width="100%" height="100%" fill="#f7f9fc"/>
  <text x="${margin.left}" y="38" font-size="24" font-weight="700" fill="#111827">${escapeHtml(title)}</text>
  <text x="${margin.left}" y="62" font-size="14" fill="#4b5563">Blue = AI replacement pressure. Green = buyer/commercial intent.</text>
  ${bars}
</svg>`;
  return writeFile(outputPath, svg);
}

function buildMarkdown({ summary, topPages, topicRows, familyRows }) {
  const pageLines = topPages
    .slice(0, 12)
    .map(
      (row, index) =>
        `${index + 1}. ${row.title} (${row.category}) - score ${row.priority_score}, action: ${row.recommended_action}.`,
    )
    .join("\n");
  const topicLines = topicRows
    .slice(0, 8)
    .map((row) => `- ${row.category}: ${row.pages} pages, ${row.total_priority_score} total priority, ${row.competitor_only_answers} competitor-only answers.`)
    .join("\n");
  const familyLines = familyRows
    .slice(0, 8)
    .map((row) => `- ${row.family}: ${row.priority}, ${row.unlinked_products} unlinked products. ${row.action}`)
    .join("\n");

  return `# Blog Conversion Opportunity Map

This is an opportunity proxy, not a Shopify revenue attribution report. It ranks blog and solution pages by AI visibility pressure, commercial buyer intent, product-module readiness, and citation/schema gaps.

## Summary

- Pages scored: ${summary.pagesScored}
- Sprint 1 pages: ${summary.sprint1Pages}
- Benchmark-pressure pages: ${summary.benchmarkPressurePages}
- Citation/schema cleanup pages: ${summary.citationCleanupPages}
- Canonical-review-first pages: ${summary.canonicalReviewPages}
- Average opportunity score: ${summary.avgPriorityScore}
- Top topics: ${summary.topTopics.join(", ")}
- Top product families: ${summary.topProductFamilies.join(", ")}

## Should We Chase Citation Rate?

Yes, but not by itself. The current target-domain citation baseline is ${summary.targetDomainCitationRate}; the stronger near-term KPI is to raise non-branded mentions and top-3 recommendations first, then citations should follow when pages are structured as useful sources. Citation work matters most for Google AI Overviews, Perplexity, Gemini with search, and other answer engines that expose source links.

## First Pages To Work

${pageLines}

## Topic Priority

${topicLines}

## Product Families To Support

${familyLines}

## CTA Rule

Use product cards and restrained CTAs. Earlier button clusters were too dense, so the recommendation is one section-level product module per decision point, with a clear View Product CTA and optional Add to Cart only for the primary pick.
`;
}

function buildHtml({ markdown, summary, topPages, topicRows, familyRows }) {
  const pageRows = topPages
    .slice(0, 20)
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.priority_score)}</td>
        <td><a href="${escapeHtml(row.url)}">${escapeHtml(row.title)}</a></td>
        <td>${escapeHtml(row.category)}</td>
        <td>${escapeHtml(row.recommended_action)}</td>
        <td>${escapeHtml(row.checkout_action)}</td>
      </tr>`,
    )
    .join("\n");
  const topicCards = topicRows
    .slice(0, 8)
    .map(
      (row) => `<div class="card"><strong>${escapeHtml(row.category)}</strong><span>${escapeHtml(row.pages)} pages</span><span>${escapeHtml(row.total_priority_score)} priority pts</span><span>${escapeHtml(row.competitor_only_answers)} competitor-only answers</span></div>`,
    )
    .join("\n");
  const familyCards = familyRows
    .slice(0, 8)
    .map(
      (row) => `<div class="card"><strong>${escapeHtml(row.family)}</strong><span>${escapeHtml(row.unlinked_products)} unlinked products</span><span>${escapeHtml(row.action)}</span></div>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Blog Conversion Opportunity Map</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f5f7fb; color: #121826; }
    main { max-width: 1160px; margin: 0 auto; padding: 32px 20px 56px; }
    h1 { font-size: 34px; margin: 0 0 8px; }
    h2 { margin-top: 34px; font-size: 23px; }
    p, li { line-height: 1.55; }
    .muted { color: #5a6475; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; margin: 22px 0; }
    .metric, .card { background: #fff; border: 1px solid #dbe3ef; border-radius: 8px; padding: 16px; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04); }
    .metric strong { display: block; font-size: 25px; margin-bottom: 4px; }
    .card strong, .card span { display: block; margin-bottom: 7px; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #dbe3ef; border-radius: 8px; overflow: hidden; }
    th, td { padding: 11px 12px; border-bottom: 1px solid #e6edf7; text-align: left; vertical-align: top; font-size: 14px; }
    th { background: #eaf1fb; }
    a { color: #0b5cab; }
    img { max-width: 100%; background: #fff; border: 1px solid #dbe3ef; border-radius: 8px; margin: 10px 0 20px; }
    code { background: #eaf1fb; padding: 2px 5px; border-radius: 4px; }
  </style>
</head>
<body>
  <main>
    <h1>Blog Conversion Opportunity Map</h1>
    <p class="muted">Opportunity proxy built from AI visibility pressure, competitor replacement, page structure, product modules, and commercial buyer intent. It is not direct Shopify sales attribution.</p>
    <div class="grid">
      <div class="metric"><strong>${summary.pagesScored}</strong><span>pages scored</span></div>
      <div class="metric"><strong>${summary.sprint1Pages}</strong><span>Sprint 1 pages</span></div>
      <div class="metric"><strong>${summary.targetDomainCitationRate}</strong><span>target-domain citation baseline</span></div>
      <div class="metric"><strong>${summary.avgPriorityScore}</strong><span>average opportunity score</span></div>
    </div>
    <h2>What This Means</h2>
    <p>Yes, citation rate should go up, but the first job is still inclusion and top-3 recommendation on non-branded buyer prompts. The current baseline shows iBOLT is being replaced by competitor sets on too many generic questions, so citation work should be attached to pages that also improve buyer intent, product clarity, and answer structure.</p>
    <h2>Charts</h2>
    <img src="conversion-priority-by-topic.svg" alt="Conversion priority by topic">
    <img src="first-pages-for-checkout-lift.svg" alt="First pages for checkout lift">
    <h2>First Pages To Work</h2>
    <table>
      <thead><tr><th>Score</th><th>Page</th><th>Topic</th><th>Action</th><th>Checkout/Citation Task</th></tr></thead>
      <tbody>${pageRows}</tbody>
    </table>
    <h2>Topic Priority</h2>
    <div class="grid">${topicCards}</div>
    <h2>Product Family Support</h2>
    <div class="grid">${familyCards}</div>
    <h2>Markdown Summary</h2>
    <pre>${escapeHtml(markdown)}</pre>
  </main>
</body>
</html>`;
}

async function main() {
  const baseDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(baseDir, "blog-conversion-opportunity-map");
  await mkdir(outDir, { recursive: true });

  const pageMessageRows = await readCsv(path.join(baseDir, "page-message-gap-map", "page-message-gap-actions.csv"));
  const portfolioRows = await readCsv(path.join(baseDir, "blog-portfolio-map", "blog-page-portfolio-ledger.csv"));
  const pageActionRows = await readCsv(path.join(baseDir, "query-page-matrix", "page-action-matrix.csv"));
  const topRefreshRows = await readCsv(path.join(baseDir, "visibility-scorecard", "top-page-refresh-scorecard.csv"));
  const productEntityRows = await readCsv(path.join(baseDir, "product-entity-coverage-plan", "product-entity-work-queue.csv"));
  const productFamilyRows = await readCsv(path.join(baseDir, "product-entity-coverage-plan", "product-family-coverage-summary.csv"));
  const topicProductRows = await readCsv(path.join(baseDir, "blog-inventory-audit", "topic-product-spread.csv"));
  const queryCoMentionRows = await readCsv(path.join(baseDir, "co-mention-network", "query-co-mention-ledger.csv"));
  const summaryJson = await readJsonIfExists(path.join(baseDir, "summary.json"), {});

  const portfolioByUrl = rowByUrl(portfolioRows);
  const pageActionByUrl = rowByUrl(pageActionRows, "page_url");
  const topRefreshByUrl = rowByUrl(topRefreshRows, "page_url");
  const productRowsByUrl = rowsByUrl(productEntityRows, "target_pages");

  // product-entity rows can contain many semicolon-separated target pages, so index them explicitly too.
  for (const row of productEntityRows) {
    for (const target of splitList(row.target_pages)) {
      const key = keyForUrl(target);
      if (!key) continue;
      if (!productRowsByUrl.has(key)) productRowsByUrl.set(key, []);
      if (!productRowsByUrl.get(key).includes(row)) productRowsByUrl.get(key).push(row);
    }
  }

  const coMentionByPrompt = new Map();
  for (const row of queryCoMentionRows) {
    coMentionByPrompt.set(String(row.query || "").toLowerCase(), row);
  }

  const allUrls = new Set([
    ...pageMessageRows.map((row) => keyForUrl(row.url)),
    ...portfolioRows.map((row) => keyForUrl(row.url)),
    ...pageActionRows.map((row) => keyForUrl(row.page_url)),
    ...topRefreshRows.map((row) => keyForUrl(row.page_url)),
  ].filter(Boolean));

  const pageRows = [];
  for (const urlKey of allUrls) {
    const message = pageMessageRows.find((row) => keyForUrl(row.url) === urlKey) || {};
    const portfolio = portfolioByUrl.get(urlKey) || {};
    const pageAction = pageActionByUrl.get(urlKey) || {};
    const topRefresh = topRefreshByUrl.get(urlKey) || {};
    const productRows = productRowsByUrl.get(urlKey) || [];
    const row = { ...portfolio, ...pageAction, ...message, ...topRefresh };
    const title = row.title || row.page_title;
    const url = row.url || row.page_url;
    const category = row.category || portfolio.category || pageAction.category || "other";
    const issues = issueSet(row.issues, row.missing_fixes, row.structural_issues);
    const commercialIntent = clamp(categoryIntentScore(category) * 0.65 + titleIntentScore(title, row.linked_prompts || row.retest_prompts) * 0.35);
    const aiPressure = aiPressureScore(row);
    const productDepth = productDepthScore(row, productRows);
    const readiness = readinessScore(row, issues);
    const citationFix = citationFixScore(issues);
    const score = clamp(aiPressure * 0.35 + commercialIntent * 0.25 + productDepth * 0.18 + citationFix * 0.14 + (100 - readiness) * 0.08);
    const linkedPrompts = splitList(row.linked_prompts || row.retest_prompts);
    const coMentionRows = linkedPrompts.map((prompt) => coMentionByPrompt.get(prompt.toLowerCase())).filter(Boolean);
    const replacementState = coMentionRows
      .map((item) => `${item.query}: ${item.outcome}`)
      .slice(0, 4)
      .join("; ");

    pageRows.push({
      priority_score: score,
      conversion_tier: conversionTier(score),
      recommended_action: recommendedAction(row, issues, score),
      title,
      url,
      category,
      commercial_intent_score: commercialIntent,
      ai_pressure_score: aiPressure,
      product_depth_score: productDepth,
      conversion_readiness_score: readiness,
      citation_fix_score: citationFix,
      product_links: num(row.product_links),
      product_entity_targets: num(row.product_entity_targets),
      benchmark_query_count: num(row.benchmark_query_count || row.query_count || row.prompt_count),
      zero_mention_queries: num(row.zero_mention_queries),
      competitor_only_answers: num(row.competitor_only_answers),
      competitors: row.competitors,
      replacement_or_mention_state: replacementState,
      missing_fixes: [...issues].join("; "),
      products_to_feature: splitList(row.product_module || row.products_to_add || row.products_to_feature).slice(0, 8).join("; "),
      product_families_to_support: productFamilyForRows(productRows).join("; "),
      checkout_action: checkoutAction(row, issues, productRows),
      cta_button_guidance: ctaGuidance(row),
      retest_prompts: row.retest_prompts || row.linked_prompts,
      source_action: row.action || row.action_bucket || row.triage_action,
    });
  }

  pageRows.sort((a, b) => b.priority_score - a.priority_score || b.ai_pressure_score - a.ai_pressure_score || a.title.localeCompare(b.title));

  const topicMap = new Map();
  for (const row of pageRows) {
    if (!topicMap.has(row.category)) {
      topicMap.set(row.category, {
        category: row.category,
        pages: 0,
        sprint1_pages: 0,
        total_priority_score: 0,
        avg_priority_score: 0,
        benchmark_pressure_pages: 0,
        zero_mention_queries: 0,
        competitor_only_answers: 0,
        product_links: 0,
        product_entity_targets: 0,
        common_actions: new Map(),
        top_pages: [],
      });
    }
    const topic = topicMap.get(row.category);
    topic.pages += 1;
    topic.total_priority_score += row.priority_score;
    if (row.conversion_tier === "Sprint 1") topic.sprint1_pages += 1;
    if (row.benchmark_query_count > 0 || row.competitor_only_answers > 0) topic.benchmark_pressure_pages += 1;
    topic.zero_mention_queries += row.zero_mention_queries;
    topic.competitor_only_answers += row.competitor_only_answers;
    topic.product_links += row.product_links;
    topic.product_entity_targets += row.product_entity_targets;
    addToCounter(topic.common_actions, row.recommended_action);
    topic.top_pages.push(row.title);
  }
  const topicRows = [...topicMap.values()]
    .map((row) => ({
      ...row,
      avg_priority_score: clamp(row.total_priority_score / Math.max(1, row.pages)),
      total_priority_score: Math.round(row.total_priority_score),
      common_actions: firstCounterItems(row.common_actions, 3).join("; "),
      top_pages: row.top_pages.slice(0, 5).join("; "),
    }))
    .sort((a, b) => b.total_priority_score - a.total_priority_score || b.avg_priority_score - a.avg_priority_score);

  const familyRows = productFamilyRows
    .map((row) => {
      const topicBoost = splitList(row.topics)
        .map((topic) => CATEGORY_INTENT.get(topic.replace(/\s+\d+$/, "").toLowerCase()) || 55)
        .reduce((sum, value) => sum + value / 20, 0);
      return {
        priority: Math.round(num(row.priority) + topicBoost),
        family: row.family,
        unlinked_products: num(row.unlinked_products),
        topics: row.topics,
        sample_products: row.sample_products,
        target_pages: row.target_pages,
        action: row.action,
      };
    })
    .sort((a, b) => b.priority - a.priority);

  const checkoutRows = pageRows
    .filter((row) => row.priority_score >= 65 || row.benchmark_query_count > 0 || row.citation_fix_score >= 30)
    .slice(0, 60)
    .map((row, index) => ({
      queue_rank: index + 1,
      page: row.title,
      url: row.url,
      tier: row.conversion_tier,
      action: row.recommended_action,
      checkout_action: row.checkout_action,
      cta_button_guidance: row.cta_button_guidance,
      products_to_feature: row.products_to_feature,
      retest_prompts: row.retest_prompts,
    }));

  const providerSummaries = summaryJson.current?.providerSummaries || summaryJson.current?.run?.summary?.providerSummaries || [];
  const totalResults = num(summaryJson.current?.run?.resultCount) || providerSummaries.reduce((sum, item) => sum + num(item.completedCount), 0);
  const citationRate = providerSummaries.length
    ? `${Math.round(providerSummaries.reduce((sum, item) => sum + num(item.citationRate), 0) / providerSummaries.length)}%`
    : "0%";

  const topicCounter = new Map();
  for (const row of topicRows) addToCounter(topicCounter, row.category, row.total_priority_score);
  const familyCounter = new Map();
  for (const row of familyRows) addToCounter(familyCounter, row.family, row.priority);

  const summary = {
    sourceBenchmarkDir: baseDir,
    pagesScored: pageRows.length,
    sprint1Pages: pageRows.filter((row) => row.conversion_tier === "Sprint 1").length,
    sprint2Pages: pageRows.filter((row) => row.conversion_tier === "Sprint 2").length,
    benchmarkPressurePages: pageRows.filter((row) => row.benchmark_query_count > 0 || row.competitor_only_answers > 0).length,
    citationCleanupPages: pageRows.filter((row) => row.citation_fix_score >= 30).length,
    canonicalReviewPages: pageRows.filter((row) => /canonical|duplicate|consolidation/i.test(row.recommended_action)).length,
    avgPriorityScore: clamp(pageRows.reduce((sum, row) => sum + row.priority_score, 0) / Math.max(1, pageRows.length)),
    targetDomainCitationRate: citationRate,
    totalBenchmarkAnswers: totalResults,
    topTopics: firstCounterItems(topicCounter, 6),
    topProductFamilies: firstCounterItems(familyCounter, 6),
    topicProductSpreadRows: topicProductRows.length,
    topPages: pageRows.slice(0, 10).map((row) => `${row.title} ${row.priority_score}`),
  };

  const pageCsv = [
    [
      "priority_score",
      "conversion_tier",
      "recommended_action",
      "title",
      "url",
      "category",
      "commercial_intent_score",
      "ai_pressure_score",
      "product_depth_score",
      "conversion_readiness_score",
      "citation_fix_score",
      "product_links",
      "product_entity_targets",
      "benchmark_query_count",
      "zero_mention_queries",
      "competitor_only_answers",
      "competitors",
      "replacement_or_mention_state",
      "missing_fixes",
      "products_to_feature",
      "product_families_to_support",
      "checkout_action",
      "cta_button_guidance",
      "retest_prompts",
      "source_action",
    ],
    ...pageRows.map((row) => [
      row.priority_score,
      row.conversion_tier,
      row.recommended_action,
      row.title,
      row.url,
      row.category,
      row.commercial_intent_score,
      row.ai_pressure_score,
      row.product_depth_score,
      row.conversion_readiness_score,
      row.citation_fix_score,
      row.product_links,
      row.product_entity_targets,
      row.benchmark_query_count,
      row.zero_mention_queries,
      row.competitor_only_answers,
      row.competitors,
      row.replacement_or_mention_state,
      row.missing_fixes,
      row.products_to_feature,
      row.product_families_to_support,
      row.checkout_action,
      row.cta_button_guidance,
      row.retest_prompts,
      row.source_action,
    ]),
  ];

  const topicCsv = [
    [
      "category",
      "pages",
      "sprint1_pages",
      "total_priority_score",
      "avg_priority_score",
      "benchmark_pressure_pages",
      "zero_mention_queries",
      "competitor_only_answers",
      "product_links",
      "product_entity_targets",
      "common_actions",
      "top_pages",
    ],
    ...topicRows.map((row) => [
      row.category,
      row.pages,
      row.sprint1_pages,
      row.total_priority_score,
      row.avg_priority_score,
      row.benchmark_pressure_pages,
      row.zero_mention_queries,
      row.competitor_only_answers,
      row.product_links,
      row.product_entity_targets,
      row.common_actions,
      row.top_pages,
    ]),
  ];

  const familyCsv = [
    ["priority", "family", "unlinked_products", "topics", "sample_products", "target_pages", "action"],
    ...familyRows.map((row) => [
      row.priority,
      row.family,
      row.unlinked_products,
      row.topics,
      row.sample_products,
      row.target_pages,
      row.action,
    ]),
  ];

  const checkoutCsv = [
    ["queue_rank", "page", "url", "tier", "action", "checkout_action", "cta_button_guidance", "products_to_feature", "retest_prompts"],
    ...checkoutRows.map((row) => [
      row.queue_rank,
      row.page,
      row.url,
      row.tier,
      row.action,
      row.checkout_action,
      row.cta_button_guidance,
      row.products_to_feature,
      row.retest_prompts,
    ]),
  ];

  const markdown = buildMarkdown({ summary, topPages: pageRows, topicRows, familyRows });
  const html = buildHtml({ markdown, summary, topPages: pageRows, topicRows, familyRows });

  await writeFile(path.join(outDir, "blog-conversion-opportunity-data.json"), JSON.stringify({ summary, pageRows, topicRows, familyRows, checkoutRows }, null, 2));
  await writeFile(path.join(outDir, "page-conversion-priority.csv"), csv(pageCsv));
  await writeFile(path.join(outDir, "topic-conversion-summary.csv"), csv(topicCsv));
  await writeFile(path.join(outDir, "product-family-opportunity.csv"), csv(familyCsv));
  await writeFile(path.join(outDir, "checkout-action-queue.csv"), csv(checkoutCsv));
  await writeFile(path.join(outDir, "REPORT.md"), markdown);
  await writeFile(path.join(outDir, "REPORT.html"), html);
  await buildSvgBarChart({
    title: "Conversion Opportunity Priority By Topic",
    rows: topicRows,
    labelField: "category",
    valueField: "total_priority_score",
    outputPath: path.join(outDir, "conversion-priority-by-topic.svg"),
  });
  await buildTwoMetricSvg({
    title: "First Pages For Likely Checkout Lift",
    rows: pageRows,
    outputPath: path.join(outDir, "first-pages-for-checkout-lift.svg"),
  });

  console.log(`Wrote ${path.relative(process.cwd(), outDir)}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
