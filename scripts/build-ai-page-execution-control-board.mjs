import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";
const REPORT_DIR = "page-execution-control-board";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\biBolt\b/g, "iBOLT")
    .replace(/\bIbolt\b/g, "iBOLT")
    .replace(/\bIBOLT\b/g, "iBOLT")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function splitList(value) {
  return normalizeText(value)
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/^\+\d+ more$/i.test(item));
}

function uniq(values) {
  return [...new Set(values.map(normalizeText).filter(Boolean))];
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

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readJsonIfExists(filePath, fallback) {
  try {
    return await readJson(filePath);
  } catch {
    return fallback;
  }
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
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const headers = rows.shift() || [];
  return rows
    .filter((cells) => cells.some((value) => value !== ""))
    .map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

async function readCsv(filePath) {
  return parseCsv(await readFile(filePath, "utf8"));
}

async function readCsvIfExists(filePath) {
  try {
    return await readCsv(filePath);
  } catch {
    return [];
  }
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function indexByUrl(rows) {
  return new Map(rows.map((row) => [row.url, row]));
}

function executionSequence({ citation, conversion, message, dossier }) {
  const lane = normalizeText(citation.lane);
  const actionBucket = normalizeText(dossier.action_bucket);
  const sourceAction = normalizeText(conversion.source_action || dossier.source_next_action);
  if (/Canonical plus mention/i.test(lane) || /canonical/i.test(actionBucket)) {
    return "1. Pick survivor URL; 2. merge answer, product, and comparison blocks onto survivor; 3. retest mapped prompts; 4. start external citations only after survivor is stable.";
  }
  if (/Mention recovery/i.test(lane) || number(citation.competitor_only_answers) > 0 || number(citation.zero_mention_queries) > 0) {
    return "1. Add answer-first block, fair comparison block, exact product module, and FAQ/schema; 2. retest inclusion and top-3; 3. then request citations to the updated URL.";
  }
  if (/cleanup/i.test(lane) || /schema|citation/i.test(sourceAction)) {
    return "1. Add source-ready cleanup: FAQ/schema, Article/BlogPosting, Product/ItemList module, image alt text, and visible specs; 2. retest citation probes; 3. send citation target to contractor.";
  }
  if (/Protect/i.test(actionBucket)) {
    return "1. Preserve current rankings and links; 2. add light schema/proof cleanup; 3. monitor benchmark and Shopify analytics.";
  }
  return "1. Monitor; 2. add cleanup when the page becomes tied to a benchmark prompt or product opportunity.";
}

function ownerLane(row) {
  if (
    /citation outreach|contractor|external citations|send citation target/i.test(row.execution_sequence) &&
    /survivor|merge|answer|product|comparison|schema|cleanup|retest|source-ready|mention|canonical/i.test(row.execution_sequence)
  ) {
    return "Jacob/app first, then SEO contractor";
  }
  if (/send citation target|external citations/i.test(row.execution_sequence)) return "SEO contractor after cleanup";
  return "Jacob/app";
}

function expectedVisibilityMetric(row) {
  if (number(row.competitor_only_answers) > 0) return "Reduce competitor-only answers and move iBOLT into top-3 recommendations.";
  if (number(row.zero_mention_queries) > 0) return "Move zero-mention prompts into iBOLT-mentioned prompts.";
  if (/citation/i.test(row.citation_timing)) return "Raise source/citation rows after schema and external citation work.";
  return "Protect current visibility and monitor provider drift.";
}

function expectedCheckoutMetric(row) {
  if (/Sprint 1/i.test(row.conversion_tier)) return "Track product-card clicks, add-to-cart starts, and assisted checkout from this page.";
  if (number(row.product_entity_targets) > 0 || row.products_to_feature) return "Track View Product clicks on featured modules and product detail page entrances.";
  return "Track organic entrances and next-page product clicks.";
}

function buildRows({ citationRows, conversionRows, messageRows, dossierRows }) {
  const conversionByUrl = indexByUrl(conversionRows);
  const messageByUrl = indexByUrl(messageRows);
  const dossierByUrl = indexByUrl(dossierRows);

  return citationRows.map((citation) => {
    const conversion = conversionByUrl.get(citation.url) || {};
    const message = messageByUrl.get(citation.url) || {};
    const dossier = dossierByUrl.get(citation.url) || {};
    const products = uniq([
      ...splitList(citation.products_to_feature),
      ...splitList(conversion.products_to_feature),
      ...splitList(message.product_module),
      ...splitList(dossier.products_to_feature),
    ]).slice(0, 8);
    const competitors = uniq([
      ...splitList(citation.competitors),
      ...splitList(conversion.competitors),
      ...splitList(message.competitors),
      ...splitList(dossier.competitors),
    ]).slice(0, 10);
    const retestPrompts = uniq([
      ...splitList(citation.retest_prompts),
      ...splitList(conversion.retest_prompts),
      ...splitList(message.retest_prompts),
      ...splitList(dossier.linked_prompts),
    ]).slice(0, 14);
    const messageThemes = uniq(splitList(message.message_themes)).slice(0, 8);
    const proofPoints = uniq(splitList(message.proof_points)).slice(0, 10);
    const editScore =
      number(citation.control_priority_score) +
      number(conversion.priority_score) * 1.2 +
      number(message.priority) * 0.18 +
      number(dossier.priority_score) * 0.7 +
      number(citation.provider_requests_ready) * 0.8 +
      number(citation.competitor_only_answers) * 8 +
      number(citation.zero_mention_queries) * 8 +
      (products.length ? 10 : 0);

    const row = {
      rank: 0,
      execution_score: Math.round(editScore),
      title: normalizeText(citation.title || conversion.title || message.title || dossier.title),
      url: citation.url || conversion.url || message.url || dossier.url,
      category: normalizeText(citation.category || conversion.category || message.category || dossier.category),
      conversion_tier: normalizeText(conversion.conversion_tier || citation.conversion_tier || dossier.conversion_tier),
      execution_lane: normalizeText(citation.lane || dossier.action_bucket),
      citation_necessity: normalizeText(citation.citation_necessity),
      citation_timing: normalizeText(citation.citation_timing),
      ai_visibility_stage: normalizeText(citation.ai_visibility_stage || conversion.replacement_or_mention_state),
      lifecycle_bucket: normalizeText(message.lifecycle_bucket || dossier.lifecycle_bucket),
      product_links: number(dossier.product_links || conversion.product_links),
      product_entity_targets: number(dossier.product_entity_targets || conversion.product_entity_targets),
      provider_requests_ready: number(citation.provider_requests_ready),
      unique_retest_prompts: number(citation.unique_retest_prompts || retestPrompts.length),
      benchmark_query_count: number(citation.benchmark_query_count || conversion.benchmark_query_count),
      zero_mention_queries: number(citation.zero_mention_queries || conversion.zero_mention_queries),
      competitor_only_answers: number(citation.competitor_only_answers || conversion.competitor_only_answers),
      clean_mentions: number(citation.clean_mentions),
      co_mentions: number(citation.co_mentions),
      competitors: competitors.join("; "),
      products_to_feature: products.join("; "),
      message_themes: messageThemes.join("; "),
      proof_points: proofPoints.join("; "),
      first_edit_instruction: normalizeText(message.first_edit_instruction || citation.primary_action || dossier.next_action),
      checkout_action: normalizeText(conversion.checkout_action || citation.primary_action),
      cta_button_guidance: normalizeText(conversion.cta_button_guidance),
      source_or_citation_action: normalizeText(citation.citation_action || conversion.source_action || dossier.source_next_action),
      retest_prompts: retestPrompts.join("; "),
    };
    row.execution_sequence = executionSequence({ citation, conversion, message, dossier });
    row.owner_sequence = ownerLane(row);
    row.expected_visibility_metric = expectedVisibilityMetric(row);
    row.expected_checkout_metric = expectedCheckoutMetric(row);
    return row;
  }).sort((a, b) => b.execution_score - a.execution_score);
}

function buildCategoryRows(workRows) {
  return [...groupBy(workRows, (row) => row.category || "uncategorized").entries()].map(([category, rows]) => {
    const laneCounts = [...groupBy(rows, (row) => row.execution_lane).entries()]
      .map(([lane, laneRows]) => `${lane} ${laneRows.length}`)
      .join("; ");
    const competitorOnly = rows.reduce((sum, row) => sum + number(row.competitor_only_answers), 0);
    const zeroMention = rows.reduce((sum, row) => sum + number(row.zero_mention_queries), 0);
    const providerRequests = rows.reduce((sum, row) => sum + number(row.provider_requests_ready), 0);
    const sprint1 = rows.filter((row) => /Sprint 1/i.test(row.conversion_tier)).length;
    return {
      category,
      pages: rows.length,
      sprint1_pages: sprint1,
      total_execution_score: rows.reduce((sum, row) => sum + number(row.execution_score), 0),
      avg_execution_score: Math.round(rows.reduce((sum, row) => sum + number(row.execution_score), 0) / Math.max(rows.length, 1)),
      competitor_only_answers: competitorOnly,
      zero_mention_queries: zeroMention,
      provider_requests_ready: providerRequests,
      lane_counts: laneCounts,
      top_pages: rows.slice(0, 6).map((row) => row.title).join("; "),
      top_competitors: uniq(rows.flatMap((row) => splitList(row.competitors))).slice(0, 8).join("; "),
      top_products: uniq(rows.flatMap((row) => splitList(row.products_to_feature))).slice(0, 8).join("; "),
    };
  }).sort((a, b) => b.total_execution_score - a.total_execution_score);
}

function buildProductFamilyRows({ familyRows, workRows }) {
  const workTextByCategory = groupBy(workRows, (row) => row.category);
  return familyRows.map((row) => {
    const targetPages = splitList(row.target_pages);
    const matchedWorkRows = workRows.filter((work) => targetPages.includes(work.title));
    return {
      priority: number(row.priority),
      family: normalizeText(row.family),
      unlinked_products: number(row.unlinked_products),
      topics: normalizeText(row.topics),
      target_pages: targetPages.slice(0, 8).join("; "),
      matched_high_priority_pages: matchedWorkRows.slice(0, 6).map((work) => work.title).join("; "),
      category_overlap: [...workTextByCategory.keys()].filter((category) => normalizeText(row.topics).includes(category)).join("; "),
      action: normalizeText(row.action),
    };
  }).sort((a, b) => b.priority - a.priority);
}

function barSvg({ title, subtitle, rows, width = 1040, height = 430, color = "#2563eb" }) {
  const margin = { top: 78, right: 70, bottom: 34, left: 320 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(...rows.map((row) => number(row.value)), 1);
  const rowHeight = chartHeight / Math.max(rows.length, 1);
  const bars = rows.map((row, index) => {
    const y = margin.top + index * rowHeight + 6;
    const h = Math.max(13, rowHeight - 12);
    const w = Math.round((number(row.value) / maxValue) * chartWidth);
    return `
      <text x="${margin.left - 14}" y="${y + h / 2 + 5}" text-anchor="end" font-size="14" fill="#334155">${escapeHtml(row.name)}</text>
      <rect x="${margin.left}" y="${y}" width="${w}" height="${h}" rx="6" fill="${color}"></rect>
      <text x="${margin.left + w + 10}" y="${y + h / 2 + 5}" font-size="14" font-weight="800" fill="#0f172a">${escapeHtml(row.value)}</text>
    `;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <text x="28" y="36" font-size="25" font-weight="900" fill="#0f172a">${escapeHtml(title)}</text>
  <text x="28" y="62" font-size="14" fill="#64748b">${escapeHtml(subtitle)}</text>
  ${bars}
</svg>`;
}

function laneSvg({ rows, width = 1040, height = 360 }) {
  const counts = [...groupBy(rows, (row) => row.execution_lane).entries()]
    .map(([name, laneRows]) => ({ name, count: laneRows.length }))
    .sort((a, b) => b.count - a.count);
  return barSvg({
    title: "Execution Lanes Across All Blog Posts",
    subtitle: "This separates survivor/canonical, mention recovery, and source-cleanup work.",
    rows: counts.map((row) => ({ name: row.name || "Unspecified", value: row.count })),
    width,
    height,
    color: "#7c3aed",
  });
}

function table(rows, columns) {
  const header = columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");
  const body = rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(row[column.key])}</td>`).join("")}</tr>`).join("");
  return `<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
}

function buildMarkdown({ summary, workRows, categoryRows, familyRows }) {
  return `# AI Page Execution Control Board

## Purpose

This joins the blog-post dossier, citation timing, conversion opportunity, message-gap, product-entity, competitor, and expanded benchmark prompt data into one edit queue.

## Summary

- Blog posts ranked: ${summary.pages}.
- Sprint 1 pages: ${summary.sprint1Pages}.
- Canonical or mention-first pages: ${summary.mentionOrCanonicalFirstPages}.
- Source cleanup pages: ${summary.sourceCleanupPages}.
- Provider requests staged for retest: ${summary.providerRequestsReady}.
- Product families needing support: ${summary.productFamilies}.
- Current citation rate remains ${summary.citationRate}; current non-branded mention rate remains ${summary.nonBrandedMentionRate}.

## Top Work Orders

| Rank | Page | Category | Score | Lane | Owner sequence | Visibility metric | Checkout metric |
| ---: | --- | --- | ---: | --- | --- | --- | --- |
${workRows.slice(0, 20).map((row) => `| ${row.rank} | ${row.title} | ${row.category} | ${row.execution_score} | ${row.execution_lane} | ${row.owner_sequence} | ${row.expected_visibility_metric} | ${row.expected_checkout_metric} |`).join("\n")}

## Category Workload

| Category | Pages | Sprint 1 | Score | Competitor-only | Requests | Top pages |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
${categoryRows.map((row) => `| ${row.category} | ${row.pages} | ${row.sprint1_pages} | ${row.total_execution_score} | ${row.competitor_only_answers} | ${row.provider_requests_ready} | ${row.top_pages} |`).join("\n")}

## Product Family Spread

| Family | Priority | Unlinked products | Matched high-priority pages | Action |
| --- | ---: | ---: | --- | --- |
${familyRows.map((row) => `| ${row.family} | ${row.priority} | ${row.unlinked_products} | ${row.matched_high_priority_pages} | ${row.action} |`).join("\n")}

## Operating Rule

Do not send every page to citation outreach at once. The sequence is survivor URL, answer/product/comparison edit, exact prompt retest, then citation outreach to the winning URL.
`;
}

function buildHtml({ summary, workRows, categoryRows, familyRows }) {
  const cards = [
    ["Posts ranked", summary.pages, "all live blog posts"],
    ["Sprint 1 pages", summary.sprint1Pages, "highest checkout/visibility pressure"],
    ["Mention/canonical first", summary.mentionOrCanonicalFirstPages, "fix before citation"],
    ["Source cleanup", summary.sourceCleanupPages, "schema and proof blocks"],
    ["Retest requests", summary.providerRequestsReady, "expanded benchmark"],
    ["Product families", summary.productFamilies, "spread coverage"],
  ].map(([label, value, note]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>iBOLT AI Page Execution Control Board</title>
<style>
body{margin:0;background:#f8fafc;color:#0f172a;font-family:Arial,Helvetica,sans-serif}main{max-width:1260px;margin:0 auto;padding:34px 26px 64px}h1{font-size:34px;margin:0 0 8px}h2{font-size:22px;margin:34px 0 14px}p{color:#334155;line-height:1.55}.note{background:#fff;border-left:6px solid #7c3aed;border-top:1px solid #d7dee8;border-right:1px solid #d7dee8;border-bottom:1px solid #d7dee8;border-radius:10px;padding:16px 18px}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:20px 0}.card{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}.label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:800}.value{font-size:31px;font-weight:900;margin-top:8px}.chart{background:#fff;border:1px solid #d7dee8;border-radius:14px;margin:18px 0;padding:12px;overflow:auto}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden;margin:12px 0 24px}th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
</style></head><body><main>
<h1>iBOLT AI Page Execution Control Board</h1>
<p class="note"><strong>Use this as the edit queue.</strong> It joins AI visibility, competitor replacement, page quality, product modules, conversion opportunities, and retest prompts into a single workflow. The operating rule is still: survivor URL first, edit second, retest third, citation outreach fourth.</p>
<section class="cards">${cards}</section>
<h2>Charts</h2>
<div class="chart"><img src="top-page-work-orders.svg" alt="Top page work orders"/></div>
<div class="chart"><img src="category-workload.svg" alt="Category workload"/></div>
<div class="chart"><img src="execution-lanes.svg" alt="Execution lanes"/></div>
<div class="chart"><img src="product-family-spread.svg" alt="Product family spread"/></div>
<h2>Top Work Orders</h2>
${table(workRows.slice(0, 30), [
  { key: "rank", label: "Rank" },
  { key: "title", label: "Page" },
  { key: "category", label: "Category" },
  { key: "execution_score", label: "Score" },
  { key: "execution_lane", label: "Lane" },
  { key: "owner_sequence", label: "Owner" },
  { key: "execution_sequence", label: "Sequence" },
  { key: "retest_prompts", label: "Retest prompts" },
])}
<h2>Category Workload</h2>
${table(categoryRows, [
  { key: "category", label: "Category" },
  { key: "pages", label: "Pages" },
  { key: "sprint1_pages", label: "Sprint 1" },
  { key: "total_execution_score", label: "Score" },
  { key: "provider_requests_ready", label: "Requests" },
  { key: "top_competitors", label: "Competitors" },
  { key: "top_pages", label: "Top pages" },
])}
<h2>Product Family Spread</h2>
${table(familyRows, [
  { key: "family", label: "Family" },
  { key: "priority", label: "Priority" },
  { key: "unlinked_products", label: "Unlinked" },
  { key: "matched_high_priority_pages", label: "Matched pages" },
  { key: "action", label: "Action" },
])}
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, REPORT_DIR);
  await mkdir(outDir, { recursive: true });

  const citationRows = await readCsv(path.join(benchmarkDir, "citation-vs-mention-control-report", "citation-vs-mention-page-queue.csv"));
  const conversionRows = await readCsv(path.join(benchmarkDir, "blog-conversion-opportunity-map", "page-conversion-priority.csv"));
  const messageRows = await readCsv(path.join(benchmarkDir, "page-message-gap-map", "page-message-gap-actions.csv"));
  const dossierRows = await readCsv(path.join(benchmarkDir, "all-blog-post-dossier", "all-blog-post-dossier.csv"));
  const productFamilyRows = await readCsvIfExists(path.join(benchmarkDir, "blog-conversion-opportunity-map", "product-family-opportunity.csv"));
  const citationData = await readJsonIfExists(path.join(benchmarkDir, "citation-rate-visibility-dashboard", "citation-rate-visibility-data.json"), { summary: {} });

  const workRows = buildRows({ citationRows, conversionRows, messageRows, dossierRows });
  workRows.forEach((row, index) => {
    row.rank = index + 1;
  });
  const categoryRows = buildCategoryRows(workRows);
  const familyRows = buildProductFamilyRows({ familyRows: productFamilyRows, workRows });
  const summary = {
    pages: workRows.length,
    sprint1Pages: workRows.filter((row) => /Sprint 1/i.test(row.conversion_tier)).length,
    mentionOrCanonicalFirstPages: workRows.filter((row) => /canonical|mention/i.test(row.execution_lane)).length,
    sourceCleanupPages: workRows.filter((row) => /source-ready cleanup/i.test(row.execution_lane)).length,
    providerRequestsReady: workRows.reduce((sum, row) => sum + number(row.provider_requests_ready), 0),
    productFamilies: familyRows.length,
    citationRate: `${citationData.summary?.citationRate ?? 0}%`,
    nonBrandedMentionRate: `${citationData.summary?.nonBrandedMentionRate ?? 0}%`,
  };

  await writeFile(path.join(outDir, "page-work-order-queue.csv"), toCsv([
    [
      "rank",
      "execution_score",
      "title",
      "url",
      "category",
      "conversion_tier",
      "execution_lane",
      "owner_sequence",
      "execution_sequence",
      "citation_necessity",
      "citation_timing",
      "ai_visibility_stage",
      "lifecycle_bucket",
      "product_links",
      "product_entity_targets",
      "provider_requests_ready",
      "unique_retest_prompts",
      "benchmark_query_count",
      "zero_mention_queries",
      "competitor_only_answers",
      "clean_mentions",
      "co_mentions",
      "competitors",
      "products_to_feature",
      "message_themes",
      "proof_points",
      "first_edit_instruction",
      "checkout_action",
      "cta_button_guidance",
      "source_or_citation_action",
      "expected_visibility_metric",
      "expected_checkout_metric",
      "retest_prompts",
    ],
    ...workRows.map((row) => [
      row.rank,
      row.execution_score,
      row.title,
      row.url,
      row.category,
      row.conversion_tier,
      row.execution_lane,
      row.owner_sequence,
      row.execution_sequence,
      row.citation_necessity,
      row.citation_timing,
      row.ai_visibility_stage,
      row.lifecycle_bucket,
      row.product_links,
      row.product_entity_targets,
      row.provider_requests_ready,
      row.unique_retest_prompts,
      row.benchmark_query_count,
      row.zero_mention_queries,
      row.competitor_only_answers,
      row.clean_mentions,
      row.co_mentions,
      row.competitors,
      row.products_to_feature,
      row.message_themes,
      row.proof_points,
      row.first_edit_instruction,
      row.checkout_action,
      row.cta_button_guidance,
      row.source_or_citation_action,
      row.expected_visibility_metric,
      row.expected_checkout_metric,
      row.retest_prompts,
    ]),
  ]));

  await writeFile(path.join(outDir, "category-workload.csv"), toCsv([
    ["category", "pages", "sprint1_pages", "total_execution_score", "avg_execution_score", "competitor_only_answers", "zero_mention_queries", "provider_requests_ready", "lane_counts", "top_pages", "top_competitors", "top_products"],
    ...categoryRows.map((row) => [row.category, row.pages, row.sprint1_pages, row.total_execution_score, row.avg_execution_score, row.competitor_only_answers, row.zero_mention_queries, row.provider_requests_ready, row.lane_counts, row.top_pages, row.top_competitors, row.top_products]),
  ]));

  await writeFile(path.join(outDir, "product-family-spread.csv"), toCsv([
    ["priority", "family", "unlinked_products", "topics", "target_pages", "matched_high_priority_pages", "category_overlap", "action"],
    ...familyRows.map((row) => [row.priority, row.family, row.unlinked_products, row.topics, row.target_pages, row.matched_high_priority_pages, row.category_overlap, row.action]),
  ]));

  await writeFile(path.join(outDir, "page-execution-control-data.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    benchmarkDir,
    summary,
    workRows,
    categoryRows,
    familyRows,
  }, null, 2));

  await writeFile(path.join(outDir, "top-page-work-orders.svg"), barSvg({
    title: "Top Page Work Orders",
    subtitle: "Combined AI visibility, conversion, product, competitor, and retest pressure.",
    rows: workRows.slice(0, 12).map((row) => ({ name: row.title.slice(0, 58), value: row.execution_score })),
    color: "#7c3aed",
  }));
  await writeFile(path.join(outDir, "category-workload.svg"), barSvg({
    title: "Category Workload",
    subtitle: "Total execution score by product/topic area.",
    rows: categoryRows.slice(0, 12).map((row) => ({ name: row.category, value: row.total_execution_score })),
    color: "#0f766e",
  }));
  await writeFile(path.join(outDir, "execution-lanes.svg"), laneSvg({ rows: workRows }));
  await writeFile(path.join(outDir, "product-family-spread.svg"), barSvg({
    title: "Product Family Spread Gaps",
    subtitle: "Product families that need stronger modules and internal links in priority posts.",
    rows: familyRows.slice(0, 10).map((row) => ({ name: row.family, value: row.priority })),
    color: "#dc2626",
  }));

  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown({ summary, workRows, categoryRows, familyRows }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({ summary, workRows, categoryRows, familyRows }));

  console.log(`Wrote ${outDir}`);
  console.log(`Work orders: ${summary.pages}`);
  console.log(`Retest requests ready: ${summary.providerRequestsReady}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
