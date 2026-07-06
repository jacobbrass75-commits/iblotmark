#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";
const REPORT_DIR = "portfolio-product-spread-analysis";

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

async function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function csv(rows) {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toNumber(value) {
  if (typeof value === "number") return value;
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(numerator, denominator) {
  return denominator ? Math.round((Number(numerator || 0) / Number(denominator || 1)) * 100) : 0;
}

function splitList(value) {
  return String(value ?? "")
    .split(/;|,/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/^\+\d+\s+more$/i.test(item));
}

function short(value, length = 88) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function normalizeKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

function addCounter(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function topCounter(map, limit = 6) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, value]) => `${name} ${value}`)
    .join("; ");
}

function categoryIndex(rows) {
  return new Map(rows.map((row) => [normalizeKey(row.category), row]));
}

function buildPageRows({ blogRows, heatmapRows, conversionRows, actionFirst30 }) {
  const heatmapByUrl = new Map(heatmapRows.map((row) => [normalizeKey(row.url), row]));
  const conversionByUrl = new Map(conversionRows.map((row) => [normalizeKey(row.url), row]));
  const actionByUrl = new Map(actionFirst30.map((row) => [normalizeKey(row.url), row]));
  return blogRows.map((row) => {
    const heatmap = heatmapByUrl.get(normalizeKey(row.url)) || {};
    const conversion = conversionByUrl.get(normalizeKey(row.url)) || {};
    const action = actionByUrl.get(normalizeKey(row.url)) || {};
    const competitorOnly = toNumber(row.competitor_only_answers);
    const zeroMentions = toNumber(row.zero_mention_queries);
    const productLinks = toNumber(row.product_links);
    const productTargets = toNumber(row.product_entity_targets);
    const queueRows = toNumber(row.product_entity_queue_rows);
    const queryCount = toNumber(row.benchmark_query_count);
    const issueCount = toNumber(action.issue_count);
    const spreadScore = Math.min(250, Math.round(
      competitorOnly * 14
      + zeroMentions * 16
      + queryCount * 9
      + queueRows * 7
      + issueCount * 5
      + toNumber(row.conversion_priority_score) * 0.25
      + toNumber(row.citation_priority) * 0.2
      + (productLinks === 0 ? 24 : 0)
      + (productTargets > 0 ? 12 : 0)
    ));
    let lane = "Monitor";
    if (/canonical|survivor|consolidation/i.test(`${row.action_bucket} ${row.portfolio_action}`)) lane = "Consolidate before expanding";
    else if (competitorOnly || zeroMentions) lane = "Mention recovery page";
    else if (/Citation|schema/i.test(row.action_bucket || "")) lane = "Source cleanup page";
    else if (/Conversion/i.test(row.action_bucket || "") || toNumber(conversion.bridge_score) >= 70) lane = "Conversion bridge page";
    else if (/Protect|amplify/i.test(row.action_bucket || "")) lane = "Protect and amplify";

    return {
      spread_score: spreadScore,
      lane,
      title: row.title,
      url: row.url,
      category: row.category,
      action_bucket: row.action_bucket,
      lifecycle_bucket: row.lifecycle_bucket,
      conversion_tier: row.conversion_tier || conversion.conversion_tier || heatmap.conversion_tier || "",
      ai_citability_score: row.ai_citability_score,
      product_links: productLinks,
      product_entity_targets: productTargets,
      product_entity_queue_rows: queueRows,
      benchmark_query_count: queryCount,
      zero_mention_queries: zeroMentions,
      competitor_only_answers: competitorOnly,
      competitors: row.competitors || action.competitors || conversion.competitors || "",
      products_to_feature: row.products_to_feature || action.products_to_feature || conversion.products_to_feature || "",
      linked_prompts: row.linked_prompts || action.losing_queries || conversion.retest_prompts || "",
      top_fix: action.top_fix || "",
      next_action: row.next_action || action.immediate_action || conversion.product_module_action || "",
      release_gate: action.release_gate || "Retest mapped prompts after page changes are live.",
    };
  }).sort((a, b) => b.spread_score - a.spread_score || a.title.localeCompare(b.title));
}

function buildFamilyRows({ testFamilies, productFamilies, conversionFamilies }) {
  const productByFamily = new Map(productFamilies.map((row) => [normalizeKey(row.family), row]));
  const conversionByFamily = new Map(conversionFamilies.map((row) => [normalizeKey(row.family), row]));
  const families = new Map();
  for (const row of [...testFamilies, ...productFamilies, ...conversionFamilies]) {
    const key = normalizeKey(row.family);
    if (!key) continue;
    families.set(key, row.family);
  }
  return [...families.entries()].map(([key, family]) => {
    const test = testFamilies.find((row) => normalizeKey(row.family) === key) || {};
    const product = productByFamily.get(key) || {};
    const conversion = conversionByFamily.get(key) || {};
    const unlinked = Math.max(toNumber(test.unlinked_products), toNumber(product.unlinked_products), toNumber(conversion.unlinked_products));
    const promptCoverage = toNumber(test.prompt_coverage);
    const topicCoverage = toNumber(test.topic_prompt_coverage);
    const competitorOnly = toNumber(conversion.competitor_only_answers);
    const gapScore = Math.max(toNumber(test.family_gap_score), toNumber(product.priority), toNumber(conversion.bridge_priority));
    const priority = Math.round(gapScore + unlinked * 2 + competitorOnly * 5 + Math.max(0, 12 - promptCoverage) * 4);
    let lane = "Retest after modules";
    if (unlinked >= 20 || gapScore >= 100) lane = "Product linking sprint";
    if (/AMPS|adapter|ball|base/i.test(family)) lane = "Core entity reinforcement";
    if (/Creator|streaming|camera/i.test(family)) lane = "Under-covered growth lane";
    return {
      priority,
      family,
      lane,
      family_gap_score: gapScore,
      prompt_coverage: promptCoverage,
      topic_prompt_coverage: topicCoverage,
      unlinked_products: unlinked,
      competitor_only_answers: competitorOnly,
      matching_keywords: test.matching_keywords || "",
      topics: product.topics || test.topics || conversion.topics || "",
      sample_products: product.sample_products || test.sample_products || conversion.sample_products || "",
      target_pages: product.target_pages || test.target_pages || conversion.target_pages || "",
      product_action: product.action || test.product_action || conversion.action || "",
      test_action: test.test_action || "Retest product-family prompts after product modules and links are live.",
    };
  }).sort((a, b) => b.priority - a.priority || a.family.localeCompare(b.family));
}

function buildCategoryRows({ blogTopics, testCategories, contentCategories, conversionCategories, actionCategories }) {
  const testByCategory = categoryIndex(testCategories);
  const contentByCategory = categoryIndex(contentCategories);
  const conversionByCategory = categoryIndex(conversionCategories);
  const actionByCategory = categoryIndex(actionCategories);
  const categories = new Map();
  for (const row of [...blogTopics, ...testCategories, ...contentCategories, ...conversionCategories, ...actionCategories]) {
    const key = normalizeKey(row.category);
    if (key) categories.set(key, row.category);
  }
  return [...categories.entries()].map(([key, category]) => {
    const blog = blogTopics.find((row) => normalizeKey(row.category) === key) || {};
    const test = testByCategory.get(key) || {};
    const content = contentByCategory.get(key) || {};
    const conversion = conversionByCategory.get(key) || {};
    const action = actionByCategory.get(key) || {};
    const pages = Math.max(toNumber(blog.pages), toNumber(test.pages), toNumber(conversion.pages), toNumber(action.pages));
    const competitorOnly = Math.max(toNumber(blog.competitor_only_answers), toNumber(test.competitor_only_answers), toNumber(conversion.competitor_only_answers), toNumber(action.competitor_only_answers));
    const zeroMentions = Math.max(toNumber(blog.zero_mention_queries), toNumber(test.zero_mention_queries), toNumber(action.zero_mention_queries));
    const productFamilyPriority = toNumber(test.product_family_priority);
    const noMappedPrompts = Math.max(toNumber(test.no_mapped_prompts), toNumber(content.noMappedPrompts || content.no_mapped_prompts));
    const priority = Math.round(
      toNumber(blog.priority_total) * 0.2
      + toNumber(action.priority) * 0.18
      + toNumber(conversion.bridge_priority) * 0.16
      + competitorOnly * 10
      + zeroMentions * 12
      + noMappedPrompts * 9
      + productFamilyPriority * 0.08
    );
    let lane = "Monitor";
    if (toNumber(content.canonicalHub || content.canonical_hub) > 0 || /consolidate/i.test(content.topMove || content.top_move || "")) lane = "Consolidate/refine existing hubs";
    if (toNumber(content.netNew || content.net_new) > 0) lane = "Net-new content candidate";
    if (competitorOnly || zeroMentions) lane = "AI recovery category";
    if (/streaming/i.test(category) && noMappedPrompts) lane = "Growth content gap";
    return {
      priority,
      category,
      lane,
      pages,
      prompts: toNumber(test.prompts),
      requests: toNumber(test.requests),
      competitor_only_answers: competitorOnly,
      zero_mention_queries: zeroMentions,
      no_mapped_prompts: noMappedPrompts,
      product_family_priority: productFamilyPriority,
      product_families: test.product_families || "",
      top_competitors: action.top_competitors || test.top_competitors || blog.competitors || conversion.top_competitors || "",
      top_pages: action.first_pages || blog.top_pages || conversion.top_pages || "",
      main_move: action.top_fixes || content.topMove || content.top_move || conversion.main_move || test.top_actions || "",
    };
  }).sort((a, b) => b.priority - a.priority || a.category.localeCompare(b.category));
}

function buildDecisionRows(gapRows, categoryRows) {
  const categoryByName = categoryIndex(categoryRows);
  return gapRows.map((row) => {
    const category = categoryByName.get(normalizeKey(row.category)) || {};
    const existingPressure = toNumber(row.benchmarkPressurePages) || toNumber(row.benchmark_pressure_pages) || toNumber(category.competitor_only_answers);
    const canonicalReview = toNumber(row.canonicalReviewPages) || toNumber(row.canonical_review_pages);
    const decision = row.decision || (canonicalReview || existingPressure ? "Refresh or consolidate existing page first" : "Create net-new supporting content");
    const priority = Math.round(toNumber(row.priority) + existingPressure * 15 + canonicalReview * 10 + toNumber(row.providerRequestCount) * 2);
    return {
      priority,
      decision,
      stage: row.stage || "",
      category: row.category,
      title: row.title,
      slug: row.slug,
      primary_keyword: row.primaryKeyword || row.primary_keyword,
      prompt_count: row.promptCount || row.prompt_count,
      provider_request_count: row.providerRequestCount || row.provider_request_count,
      existing_pages: row.existingPages || row.existing_pages,
      benchmark_pressure_pages: existingPressure,
      canonical_review_pages: canonicalReview,
      competitors: Array.isArray(row.competitors) ? row.competitors.join("; ") : row.competitors,
      suggested_products: Array.isArray(row.suggestedProducts) ? row.suggestedProducts.join("; ") : row.suggestedProducts,
      action: row.action || row.existingRecommendation || "",
    };
  }).sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title));
}

function barSvg({ title, subtitle, rows, labelKey, valueKey, width = 940, rowHeight = 34, color = "#0f766e" }) {
  const chartRows = rows.slice(0, 12);
  const height = 82 + chartRows.length * rowHeight;
  const max = Math.max(1, ...chartRows.map((row) => toNumber(row[valueKey])));
  const body = chartRows.map((row, index) => {
    const y = 64 + index * rowHeight;
    const value = toNumber(row[valueKey]);
    const barWidth = Math.round((value / max) * (width - 370));
    return `<g>
      <text x="24" y="${y + 17}" font-size="13" font-weight="800" fill="#111827">${escapeHtml(short(row[labelKey], 39))}</text>
      <rect x="312" y="${y}" width="${width - 370}" height="21" rx="10" fill="#e5e7eb"/>
      <rect x="312" y="${y}" width="${barWidth}" height="21" rx="10" fill="${row.color || color}"/>
      <text x="${width - 32}" y="${y + 16}" text-anchor="end" font-size="13" font-weight="900" fill="#111827">${escapeHtml(value)}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#fff"/>
    <text x="24" y="32" font-size="21" font-weight="900" fill="#111827">${escapeHtml(title)}</text>
    <text x="24" y="53" font-size="13" fill="#64748b">${escapeHtml(subtitle)}</text>
    ${body}
  </svg>`;
}

function table(headers, rows, limit = 20) {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header.label)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.slice(0, limit).map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header.key])}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table>${head}${body}</table>`;
}

function card(label, value, note) {
  return `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`;
}

function renderHtml({ summary, pageRows, familyRows, categoryRows, decisionRows }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT Portfolio Product Spread Analysis</title>
  <style>
    body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1220px;margin:0 auto;padding:34px 24px 70px}
    h1{font-size:36px;margin:0 0 8px}
    h2{font-size:22px;margin:34px 0 12px}
    p,li{line-height:1.55;color:#334155;font-size:15px}
    .note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #0f766e;border-radius:12px;padding:16px 18px;margin:20px 0}
    .warn{border-left-color:#f97316}
    .cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:22px 0}
    .card{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:15px}
    .label{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:900}
    .value{font-size:28px;font-weight:900;margin:8px 0;color:#0f172a}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
    .chart{background:#fff;border:1px solid #dbe3ef;border-radius:18px;padding:10px;overflow:auto}
    .chart svg{width:100%;height:auto;display:block}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 24px}
    th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    a{color:#0f766e;overflow-wrap:anywhere}
    @media(max-width:900px){.cards,.grid{grid-template-columns:1fr}h1{font-size:30px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT Portfolio Product Spread Analysis</h1>
  <p>This report connects all live blog pages, product-family coverage, benchmark gaps, and content decisions so the next work improves visibility and product spread instead of adding isolated posts.</p>
  <div class="note">
    <strong>Readout:</strong> the portfolio has ${summary.pages} pages, but ${summary.consolidate_pages} pages still need consolidation before expansion and ${summary.mention_recovery_pages} pages carry AI mention recovery work. Product spread is most constrained by ${escapeHtml(summary.top_family)} and the highest-priority category is ${escapeHtml(summary.top_category)}.
  </div>
  <section class="cards">
    ${card("Pages analyzed", summary.pages, "All blog pages in the current dossier.")}
    ${card("Consolidate first", summary.consolidate_pages, "Pages where survivor/canonical work should precede more content.")}
    ${card("Mention recovery", summary.mention_recovery_pages, "Pages tied to zero-mention or competitor-only prompts.")}
    ${card("Zero product links", summary.zero_product_link_pages, "Pages with no detected product links.")}
    ${card("Weak families", summary.weak_product_families, "Product families with weak prompt/product coverage.")}
  </section>
  <section class="grid">
    <div class="chart"><img src="product-family-spread.svg" alt="Product family spread priorities"/></div>
    <div class="chart"><img src="category-portfolio-priority.svg" alt="Category portfolio priorities"/></div>
  </section>
  <h2>Product-Family Spread</h2>
  ${table([
    { label: "Priority", key: "priority" },
    { label: "Family", key: "family" },
    { label: "Lane", key: "lane" },
    { label: "Unlinked products", key: "unlinked_products" },
    { label: "Prompt coverage", key: "prompt_coverage" },
    { label: "Target pages", key: "target_pages" },
    { label: "Action", key: "product_action" },
  ], familyRows, 12)}
  <h2>Category Portfolio Priorities</h2>
  ${table([
    { label: "Priority", key: "priority" },
    { label: "Category", key: "category" },
    { label: "Lane", key: "lane" },
    { label: "Pages", key: "pages" },
    { label: "No mapped prompts", key: "no_mapped_prompts" },
    { label: "Competitor-only", key: "competitor_only_answers" },
    { label: "Main move", key: "main_move" },
  ], categoryRows, 14)}
  <h2>First Page Portfolio Queue</h2>
  ${table([
    { label: "Score", key: "spread_score" },
    { label: "Lane", key: "lane" },
    { label: "Page", key: "title" },
    { label: "Category", key: "category" },
    { label: "Product links", key: "product_links" },
    { label: "Competitor-only", key: "competitor_only_answers" },
    { label: "Products to feature", key: "products_to_feature" },
    { label: "Next action", key: "next_action" },
  ], pageRows, 25)}
  <h2>Refresh Vs Net-New Decisions</h2>
  ${table([
    { label: "Priority", key: "priority" },
    { label: "Decision", key: "decision" },
    { label: "Category", key: "category" },
    { label: "Title", key: "title" },
    { label: "Prompts", key: "prompt_count" },
    { label: "Pressure pages", key: "benchmark_pressure_pages" },
    { label: "Action", key: "action" },
  ], decisionRows, 18)}
  <h2>Files</h2>
  <ul>
    <li><a href="portfolio-product-spread-data.json">portfolio-product-spread-data.json</a></li>
    <li><a href="page-portfolio-product-spread.csv">page-portfolio-product-spread.csv</a></li>
    <li><a href="product-family-spread-priority.csv">product-family-spread-priority.csv</a></li>
    <li><a href="category-portfolio-priority.csv">category-portfolio-priority.csv</a></li>
    <li><a href="refresh-vs-net-new-decisions.csv">refresh-vs-net-new-decisions.csv</a></li>
  </ul>
</main>
</body>
</html>`;
}

function renderMarkdown({ summary, pageRows, familyRows, categoryRows, decisionRows }) {
  return `# iBOLT Portfolio Product Spread Analysis

## Summary

- Pages analyzed: ${summary.pages}
- Consolidate-first pages: ${summary.consolidate_pages}
- Mention-recovery pages: ${summary.mention_recovery_pages}
- Source-cleanup pages: ${summary.source_cleanup_pages}
- Zero-product-link pages: ${summary.zero_product_link_pages}
- Pages with product entity targets: ${summary.product_entity_pages}
- Weak product families: ${summary.weak_product_families}
- Top product family: ${summary.top_family}
- Top category: ${summary.top_category}
- Refresh-first decisions: ${summary.refresh_first_decisions}
- Net-new content decisions: ${summary.net_new_decisions}

## Product-Family Spread

${familyRows.slice(0, 10).map((row) => `- ${row.family}: priority ${row.priority}, ${row.unlinked_products} unlinked products. Lane: ${row.lane}.`).join("\n")}

## Category Priorities

${categoryRows.slice(0, 10).map((row) => `- ${row.category}: priority ${row.priority}, ${row.competitor_only_answers} competitor-only answers, ${row.no_mapped_prompts} no-mapped prompts. Move: ${row.main_move || "monitor"}.`).join("\n")}

## First Page Queue

${pageRows.slice(0, 12).map((row) => `- ${row.title}: ${row.lane}, score ${row.spread_score}. ${row.next_action}`).join("\n")}

## Refresh Vs Net-New

${decisionRows.slice(0, 12).map((row) => `- ${row.title}: ${row.decision}. ${row.action}`).join("\n")}
`;
}

async function main() {
  const benchmarkDir = process.argv[2] ? path.resolve(process.argv[2]) : await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, REPORT_DIR);
  await mkdir(outDir, { recursive: true });

  const allBlog = await readJsonIfExists(path.join(benchmarkDir, "all-blog-post-dossier", "all-blog-post-dossier-data.json"), { summary: {}, pageRows: [], topicRows: [] });
  const actionControl = await readJsonIfExists(path.join(benchmarkDir, "all-blog-action-control-sheet", "all-blog-action-control-data.json"), { summary: {}, first30: [], categoryRows: [] });
  const testCoverage = await readJsonIfExists(path.join(benchmarkDir, "test-area-coverage-audit", "test-area-coverage-data.json"), { summary: {}, categoryRows: [], familyRows: [], promptRows: [] });
  const productEntity = await readJsonIfExists(path.join(benchmarkDir, "product-entity-coverage-plan", "product-entity-data.json"), { summary: {}, familyRows: [] });
  const contentGaps = await readJsonIfExists(path.join(benchmarkDir, "content-gap-decision-matrix", "content-gap-decision-data.json"), { summary: {}, gapRows: [], categoryRows: [] });
  const heatmap = await readJsonIfExists(path.join(benchmarkDir, "blog-page-opportunity-heatmap", "blog-page-opportunity-data.json"), { summary: {}, rows: [] });
  const conversion = await readJsonIfExists(path.join(benchmarkDir, "product-conversion-visibility-bridge", "product-conversion-visibility-data.json"), { summary: {}, pageBridge: [], categoryBridge: [], familyBridge: [] });

  const pageRows = buildPageRows({
    blogRows: allBlog.pageRows || [],
    heatmapRows: heatmap.rows || [],
    conversionRows: conversion.pageBridge || [],
    actionFirst30: actionControl.first30 || [],
  });
  const familyRows = buildFamilyRows({
    testFamilies: testCoverage.familyRows || [],
    productFamilies: productEntity.familyRows || [],
    conversionFamilies: conversion.familyBridge || [],
  });
  const categoryRows = buildCategoryRows({
    blogTopics: allBlog.topicRows || [],
    testCategories: testCoverage.categoryRows || [],
    contentCategories: contentGaps.categoryRows || [],
    conversionCategories: conversion.categoryBridge || [],
    actionCategories: actionControl.categoryRows || [],
  });
  const decisionRows = buildDecisionRows(contentGaps.gapRows || [], categoryRows);

  const summary = {
    generated_at: new Date().toISOString(),
    benchmark_dir: benchmarkDir,
    pages: pageRows.length,
    consolidate_pages: pageRows.filter((row) => row.lane === "Consolidate before expanding").length,
    mention_recovery_pages: pageRows.filter((row) => row.competitor_only_answers > 0 || row.zero_mention_queries > 0).length,
    source_cleanup_pages: pageRows.filter((row) => row.lane === "Source cleanup page").length,
    conversion_bridge_pages: pageRows.filter((row) => row.lane === "Conversion bridge page").length,
    zero_product_link_pages: pageRows.filter((row) => row.product_links === 0).length,
    product_entity_pages: pageRows.filter((row) => row.product_entity_targets > 0 || row.product_entity_queue_rows > 0).length,
    benchmark_pressure_pages: pageRows.filter((row) => row.competitor_only_answers > 0 || row.zero_mention_queries > 0).length,
    avg_product_links: pageRows.length ? Math.round(pageRows.reduce((sum, row) => sum + row.product_links, 0) / pageRows.length) : 0,
    product_families: familyRows.length,
    weak_product_families: familyRows.filter((row) => row.priority >= 75 || row.unlinked_products >= 8).length,
    top_family: familyRows[0]?.family || "",
    top_family_priority: familyRows[0]?.priority || 0,
    categories: categoryRows.length,
    top_category: categoryRows[0]?.category || "",
    top_category_priority: categoryRows[0]?.priority || 0,
    refresh_first_decisions: decisionRows.filter((row) => /Refresh|consolidate/i.test(row.decision)).length,
    net_new_decisions: decisionRows.filter((row) => /net-new|supporting content|Create/i.test(row.decision)).length,
    canonical_hub_decisions: decisionRows.filter((row) => /canonical solution hub/i.test(row.decision)).length,
  };

  await writeFile(path.join(outDir, "portfolio-product-spread-data.json"), JSON.stringify({ summary, pageRows, familyRows, categoryRows, decisionRows }, null, 2));
  await writeFile(path.join(outDir, "page-portfolio-product-spread.csv"), csv([
    ["spread_score", "lane", "title", "url", "category", "action_bucket", "lifecycle_bucket", "conversion_tier", "ai_citability_score", "product_links", "product_entity_targets", "product_entity_queue_rows", "benchmark_query_count", "zero_mention_queries", "competitor_only_answers", "competitors", "products_to_feature", "linked_prompts", "top_fix", "next_action", "release_gate"],
    ...pageRows.map((row) => [row.spread_score, row.lane, row.title, row.url, row.category, row.action_bucket, row.lifecycle_bucket, row.conversion_tier, row.ai_citability_score, row.product_links, row.product_entity_targets, row.product_entity_queue_rows, row.benchmark_query_count, row.zero_mention_queries, row.competitor_only_answers, row.competitors, row.products_to_feature, row.linked_prompts, row.top_fix, row.next_action, row.release_gate]),
  ]));
  await writeFile(path.join(outDir, "product-family-spread-priority.csv"), csv([
    ["priority", "family", "lane", "family_gap_score", "prompt_coverage", "topic_prompt_coverage", "unlinked_products", "competitor_only_answers", "matching_keywords", "topics", "sample_products", "target_pages", "product_action", "test_action"],
    ...familyRows.map((row) => [row.priority, row.family, row.lane, row.family_gap_score, row.prompt_coverage, row.topic_prompt_coverage, row.unlinked_products, row.competitor_only_answers, row.matching_keywords, row.topics, row.sample_products, row.target_pages, row.product_action, row.test_action]),
  ]));
  await writeFile(path.join(outDir, "category-portfolio-priority.csv"), csv([
    ["priority", "category", "lane", "pages", "prompts", "requests", "competitor_only_answers", "zero_mention_queries", "no_mapped_prompts", "product_family_priority", "product_families", "top_competitors", "top_pages", "main_move"],
    ...categoryRows.map((row) => [row.priority, row.category, row.lane, row.pages, row.prompts, row.requests, row.competitor_only_answers, row.zero_mention_queries, row.no_mapped_prompts, row.product_family_priority, row.product_families, row.top_competitors, row.top_pages, row.main_move]),
  ]));
  await writeFile(path.join(outDir, "refresh-vs-net-new-decisions.csv"), csv([
    ["priority", "decision", "stage", "category", "title", "slug", "primary_keyword", "prompt_count", "provider_request_count", "existing_pages", "benchmark_pressure_pages", "canonical_review_pages", "competitors", "suggested_products", "action"],
    ...decisionRows.map((row) => [row.priority, row.decision, row.stage, row.category, row.title, row.slug, row.primary_keyword, row.prompt_count, row.provider_request_count, row.existing_pages, row.benchmark_pressure_pages, row.canonical_review_pages, row.competitors, row.suggested_products, row.action]),
  ]));

  await writeFile(path.join(outDir, "product-family-spread.svg"), barSvg({
    title: "Product-Family Spread Priorities",
    subtitle: "Higher means the family needs internal links, product modules, or retest coverage.",
    rows: familyRows,
    labelKey: "family",
    valueKey: "priority",
  }));
  await writeFile(path.join(outDir, "category-portfolio-priority.svg"), barSvg({
    title: "Category Portfolio Priorities",
    subtitle: "Combines competitor pressure, no-mapped prompts, product-family gaps, and page priority.",
    rows: categoryRows,
    labelKey: "category",
    valueKey: "priority",
    color: "#2563eb",
  }));
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml({ summary, pageRows, familyRows, categoryRows, decisionRows }));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown({ summary, pageRows, familyRows, categoryRows, decisionRows }));

  console.log(`Wrote ${outDir}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
