#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";
const REPORT_DIR = "blog-page-opportunity-heatmap";

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

function num(value) {
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeUrl(value) {
  return String(value ?? "").trim().replace(/\/$/, "");
}

function byUrl(rows, urlKey = "url") {
  return new Map(rows.map((row) => [normalizeUrl(row[urlKey]), row]).filter(([url]) => url));
}

function splitList(value) {
  return String(value ?? "")
    .split(/[;|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstSentence(value, max = 180) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3).trim()}...`;
}

function opportunityBand(score) {
  if (score >= 85) return "A: edit first";
  if (score >= 70) return "B: high-value refresh";
  if (score >= 55) return "C: citation or structure cleanup";
  if (score >= 40) return "D: maintain and retest";
  return "E: monitor";
}

function ownerFor(row) {
  if (/Canonical/i.test(row.page_status) || /Canonical/i.test(row.batch)) return "Jacob/app";
  if (num(row.zero_mention_queries) || num(row.competitor_only_answers)) return "Jacob/app first";
  if (/Citation/i.test(row.citation_action) || /citation/i.test(row.citation_readiness_bucket)) return "SEO contractor after edit";
  return "Maintain";
}

function buildRows({ drilldownRows, conversionRows, visibilityRows, counterRows, plannerRows }) {
  const conversionByUrl = byUrl(conversionRows);
  const visibilityByUrl = byUrl(visibilityRows);
  const counterByUrl = byUrl(counterRows);
  const plannerByUrl = byUrl(plannerRows);
  return drilldownRows.map((row) => {
    const url = normalizeUrl(row.url);
    const conversion = conversionByUrl.get(url) || {};
    const visibility = visibilityByUrl.get(url) || {};
    const counter = counterByUrl.get(url) || {};
    const planner = plannerByUrl.get(url) || {};

    const aiRiskScore = clamp(num(row.score || visibility.visibility_risk_score), 0, 400);
    const conversionPriority = clamp(num(conversion.priority_score), 0, 100);
    const competitorOnly = num(row.competitor_only_answers || visibility.competitor_only_answers);
    const zeroMention = num(row.zero_mention_queries || visibility.zero_mention_queries);
    const productLinks = num(conversion.product_links || row.product_links || visibility.product_links);
    const productTargets = num(conversion.product_entity_targets || row.product_entity_targets || visibility.product_entity_targets);
    const citability = num(row.ai_citability_score || conversion.ai_citability_score || visibility.ai_citability_score);
    const queryCount = num(row.benchmark_query_count || conversion.benchmark_query_count || visibility.benchmark_query_count);
    const issueFlags = splitList(row.issue_flags || conversion.missing_fixes || visibility.issue_flags);

    const aiOpportunity = clamp(Math.round((aiRiskScore / 400) * 35), 0, 35);
    const conversionOpportunity = clamp(Math.round(conversionPriority * 0.25), 0, 25);
    const competitorOpportunity = clamp(competitorOnly * 5 + zeroMention * 3, 0, 20);
    const productOpportunity = clamp(productTargets * 2 + Math.min(productLinks, 20) * 0.35, 0, 12);
    const structureOpportunity = clamp(issueFlags.length * 1.4 + (citability < 80 ? 4 : 0) + (queryCount ? 0 : 3), 0, 8);
    const opportunityScore = Math.round(aiOpportunity + conversionOpportunity + competitorOpportunity + productOpportunity + structureOpportunity);

    const quickAction = row.primary_action
      || conversion.recommended_action
      || visibility.primary_action
      || "Keep page stable, refresh facts, and retest after related edits.";
    const checkoutAction = row.checkout_action || conversion.checkout_action || visibility.checkout_action || "";
    const citationAction = row.citation_action || conversion.source_action || visibility.citation_action || "";
    const primaryCompetitor = counter.primary_competitor || splitList(row.competitors)[0]?.replace(/\s+\d+$/, "") || "";

    return {
      opportunity_score: opportunityScore,
      opportunity_band: opportunityBand(opportunityScore),
      edit_order: planner.edit_order || row.rank,
      batch: planner.batch || "",
      title: row.title,
      url,
      category: row.category || conversion.category || visibility.category || "unknown",
      conversion_tier: row.conversion_tier || conversion.conversion_tier || visibility.conversion_tier || "",
      ai_visibility_stage: row.ai_visibility_stage || visibility.ai_visibility_stage || "",
      page_status: row.page_status || visibility.page_status || "",
      lifecycle_bucket: row.lifecycle_bucket || visibility.lifecycle_bucket || "",
      citation_readiness_bucket: row.citation_readiness_bucket || visibility.citation_readiness_bucket || "",
      ai_risk_score: aiRiskScore,
      conversion_priority: conversionPriority,
      competitor_only_answers: competitorOnly,
      zero_mention_queries: zeroMention,
      clean_mentions: num(row.clean_mentions || visibility.clean_mentions),
      co_mentions: num(row.co_mentions || visibility.co_mentions),
      benchmark_query_count: queryCount,
      ai_citability_score: citability,
      product_links: productLinks,
      product_entity_targets: productTargets,
      primary_competitor: primaryCompetitor,
      competitor_set: counter.competitor_set || row.competitors || conversion.competitors || "",
      products_to_feature: row.products_to_feature || conversion.products_to_feature || visibility.products_to_feature || "",
      quick_action: firstSentence(quickAction, 260),
      checkout_action: firstSentence(checkoutAction, 260),
      citation_action: firstSentence(citationAction, 260),
      retest_wave: planner.retest_wave || "",
      retest_prompts: planner.retest_prompts || row.retest_prompts || conversion.retest_prompts || "",
      owner: ownerFor({ ...row, batch: planner.batch }),
    };
  }).sort((a, b) => b.opportunity_score - a.opportunity_score || num(a.edit_order) - num(b.edit_order));
}

function buildCategoryRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.category || "unknown";
    if (!groups.has(key)) {
      groups.set(key, {
        category: key,
        pages: 0,
        total_score: 0,
        a_pages: 0,
        b_pages: 0,
        competitor_only_answers: 0,
        zero_mention_queries: 0,
        product_entity_targets: 0,
        top_pages: [],
        top_competitors: new Map(),
      });
    }
    const group = groups.get(key);
    group.pages += 1;
    group.total_score += row.opportunity_score;
    if (row.opportunity_band.startsWith("A:")) group.a_pages += 1;
    if (row.opportunity_band.startsWith("B:")) group.b_pages += 1;
    group.competitor_only_answers += row.competitor_only_answers;
    group.zero_mention_queries += row.zero_mention_queries;
    group.product_entity_targets += row.product_entity_targets;
    group.top_pages.push(row.title);
    for (const item of splitList(row.competitor_set).slice(0, 8)) {
      const competitor = item.replace(/\s+\d+$/, "").trim();
      if (competitor) group.top_competitors.set(competitor, (group.top_competitors.get(competitor) || 0) + 1);
    }
  }
  return [...groups.values()].map((group) => ({
    category: group.category,
    pages: group.pages,
    avg_opportunity_score: Math.round(group.total_score / Math.max(group.pages, 1)),
    a_pages: group.a_pages,
    b_pages: group.b_pages,
    competitor_only_answers: group.competitor_only_answers,
    zero_mention_queries: group.zero_mention_queries,
    product_entity_targets: group.product_entity_targets,
    top_pages: group.top_pages.slice(0, 6).join("; "),
    top_competitors: [...group.top_competitors.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 6)
      .map(([name, count]) => `${name} ${count}`)
      .join("; "),
  })).sort((a, b) => b.avg_opportunity_score - a.avg_opportunity_score || b.a_pages - a.a_pages);
}

function buildBatchRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.batch || row.opportunity_band;
    if (!groups.has(key)) {
      groups.set(key, { batch: key, pages: 0, avg: 0, total: 0, a_pages: 0, top_pages: [] });
    }
    const group = groups.get(key);
    group.pages += 1;
    group.total += row.opportunity_score;
    if (row.opportunity_band.startsWith("A:")) group.a_pages += 1;
    group.top_pages.push(row.title);
  }
  return [...groups.values()].map((group) => ({
    batch: group.batch,
    pages: group.pages,
    avg_opportunity_score: Math.round(group.total / Math.max(group.pages, 1)),
    a_pages: group.a_pages,
    top_pages: group.top_pages.slice(0, 8).join("; "),
  })).sort((a, b) => b.avg_opportunity_score - a.avg_opportunity_score);
}

function chart(title, rows, valueKey, labelKey = "title", color = "#0f766e") {
  const chartRows = rows.slice(0, 12);
  const width = 920;
  const rowHeight = 36;
  const height = 72 + chartRows.length * rowHeight;
  const max = Math.max(1, ...chartRows.map((row) => num(row[valueKey])));
  const bars = chartRows.map((row, index) => {
    const y = 54 + index * rowHeight;
    const barWidth = Math.round((num(row[valueKey]) / max) * 470);
    return `<g>
      <text x="22" y="${y + 17}" font-size="13" font-weight="800" fill="#0f172a">${escapeHtml(firstSentence(row[labelKey], 40))}</text>
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

function renderHtml({ rows, categoryRows, batchRows }) {
  const aRows = rows.filter((row) => row.opportunity_band.startsWith("A:"));
  const bRows = rows.filter((row) => row.opportunity_band.startsWith("B:"));
  const totalCompetitorOnly = rows.reduce((sum, row) => sum + row.competitor_only_answers, 0);
  const totalZeroMention = rows.reduce((sum, row) => sum + row.zero_mention_queries, 0);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT Blog Page Opportunity Heatmap</title>
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
  <h1>iBOLT Blog Page Opportunity Heatmap</h1>
  <p>This combines all-blog AI risk, competitor-only answers, checkout/product opportunity, citation readiness, and retest sequencing into one page-level edit priority list.</p>
  <div class="note"><strong>Use this for execution:</strong> edit A-band pages first, then B-band pages inside the same category or batch. Citation outreach follows after survivor URL and product modules are clean.</div>
  <section class="cards">
    ${card("Pages scored", rows.length, "All pages from the current all-page drilldown.")}
    ${card("A-band pages", aRows.length, "Edit first because AI risk and business value overlap.")}
    ${card("B-band pages", bRows.length, "High-value refresh queue after A-band.")}
    ${card("Competitor-only answers", totalCompetitorOnly, "Page-mapped competitor-only pressure.")}
    ${card("Zero-mention queries", totalZeroMention, "Mapped prompts where iBOLT did not appear.")}
  </section>

  <section class="grid">
    <div class="chart">${chart("Top page opportunity scores", rows, "opportunity_score")}</div>
    <div class="chart">${chart("Category opportunity", categoryRows, "avg_opportunity_score", "category", "#2563eb")}</div>
  </section>

  <h2>First 20 Page Edits</h2>
  ${renderTable([
    { label: "Score", key: "opportunity_score" },
    { label: "Band", key: "opportunity_band" },
    { label: "Page", key: "title" },
    { label: "Category", key: "category" },
    { label: "Competitor", key: "primary_competitor" },
    { label: "Action", key: "quick_action" },
    { label: "Retest", key: "retest_wave" },
  ], rows.slice(0, 20))}

  <h2>Category Heatmap</h2>
  ${renderTable([
    { label: "Category", key: "category" },
    { label: "Pages", key: "pages" },
    { label: "Avg score", key: "avg_opportunity_score" },
    { label: "A pages", key: "a_pages" },
    { label: "Competitor-only", key: "competitor_only_answers" },
    { label: "Top competitors", key: "top_competitors" },
    { label: "Top pages", key: "top_pages" },
  ], categoryRows)}

  <h2>Batch Heatmap</h2>
  ${renderTable([
    { label: "Batch", key: "batch" },
    { label: "Pages", key: "pages" },
    { label: "Avg score", key: "avg_opportunity_score" },
    { label: "A pages", key: "a_pages" },
    { label: "Top pages", key: "top_pages" },
  ], batchRows)}
</main>
</body>
</html>`;
}

function renderMarkdown({ rows, categoryRows, batchRows }) {
  const aRows = rows.filter((row) => row.opportunity_band.startsWith("A:"));
  const bRows = rows.filter((row) => row.opportunity_band.startsWith("B:"));
  return `# iBOLT Blog Page Opportunity Heatmap

## Bottom Line

This heatmap combines all-blog AI risk, competitor-only answers, checkout/product opportunity, citation readiness, and retest sequencing.

- Pages scored: ${rows.length}
- A-band edit-first pages: ${aRows.length}
- B-band high-value refresh pages: ${bRows.length}
- Top category by average opportunity: ${categoryRows[0]?.category || "none"} (${categoryRows[0]?.avg_opportunity_score || 0})
- Top batch by average opportunity: ${batchRows[0]?.batch || "none"} (${batchRows[0]?.avg_opportunity_score || 0})

## First 15 Page Edits

${rows.slice(0, 15).map((row, index) => `${index + 1}. ${row.title}: ${row.opportunity_score} (${row.opportunity_band}), ${row.category}, counter ${row.primary_competitor || "category defaults"}.`).join("\n")}

## Category Priorities

${categoryRows.map((row) => `- ${row.category}: avg ${row.avg_opportunity_score}, ${row.a_pages} A-band pages, ${row.competitor_only_answers} competitor-only answers. Top competitors: ${row.top_competitors}`).join("\n")}
`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, REPORT_DIR);
  const drilldownRows = await readCsv(path.join(benchmarkDir, "all-page-ai-drilldown", "all-page-ai-drilldown.csv"));
  const conversionRows = await readCsv(path.join(benchmarkDir, "blog-conversion-opportunity-map", "page-conversion-priority.csv"));
  const visibilityRows = await readCsv(path.join(benchmarkDir, "blog-post-visibility-control-report", "blog-page-control-ledger.csv"));
  const counterRows = await readCsv(path.join(benchmarkDir, "competitive-share-of-answer", "competitor-page-counterplan.csv"));
  const plannerRows = await readCsv(path.join(benchmarkDir, "all-blog-edit-retest-planner", "all-blog-edit-retest-plan.csv"));
  const rows = buildRows({ drilldownRows, conversionRows, visibilityRows, counterRows, plannerRows });
  const categoryRows = buildCategoryRows(rows);
  const batchRows = buildBatchRows(rows);

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "page-opportunity-heatmap.csv"), csv([
    ["opportunity_score", "opportunity_band", "edit_order", "batch", "title", "url", "category", "conversion_tier", "ai_visibility_stage", "page_status", "lifecycle_bucket", "citation_readiness_bucket", "ai_risk_score", "conversion_priority", "competitor_only_answers", "zero_mention_queries", "clean_mentions", "co_mentions", "benchmark_query_count", "ai_citability_score", "product_links", "product_entity_targets", "primary_competitor", "competitor_set", "products_to_feature", "quick_action", "checkout_action", "citation_action", "retest_wave", "retest_prompts", "owner"],
    ...rows.map((row) => [
      row.opportunity_score,
      row.opportunity_band,
      row.edit_order,
      row.batch,
      row.title,
      row.url,
      row.category,
      row.conversion_tier,
      row.ai_visibility_stage,
      row.page_status,
      row.lifecycle_bucket,
      row.citation_readiness_bucket,
      row.ai_risk_score,
      row.conversion_priority,
      row.competitor_only_answers,
      row.zero_mention_queries,
      row.clean_mentions,
      row.co_mentions,
      row.benchmark_query_count,
      row.ai_citability_score,
      row.product_links,
      row.product_entity_targets,
      row.primary_competitor,
      row.competitor_set,
      row.products_to_feature,
      row.quick_action,
      row.checkout_action,
      row.citation_action,
      row.retest_wave,
      row.retest_prompts,
      row.owner,
    ]),
  ]));
  await writeFile(path.join(outDir, "category-opportunity-heatmap.csv"), csv([
    ["category", "pages", "avg_opportunity_score", "a_pages", "b_pages", "competitor_only_answers", "zero_mention_queries", "product_entity_targets", "top_pages", "top_competitors"],
    ...categoryRows.map((row) => [
      row.category,
      row.pages,
      row.avg_opportunity_score,
      row.a_pages,
      row.b_pages,
      row.competitor_only_answers,
      row.zero_mention_queries,
      row.product_entity_targets,
      row.top_pages,
      row.top_competitors,
    ]),
  ]));
  await writeFile(path.join(outDir, "batch-opportunity-heatmap.csv"), csv([
    ["batch", "pages", "avg_opportunity_score", "a_pages", "top_pages"],
    ...batchRows.map((row) => [row.batch, row.pages, row.avg_opportunity_score, row.a_pages, row.top_pages]),
  ]));
  await writeFile(path.join(outDir, "first-30-edit-queue.csv"), csv([
    ["rank", "opportunity_score", "title", "url", "category", "primary_competitor", "quick_action", "checkout_action", "citation_action", "retest_wave", "owner"],
    ...rows.slice(0, 30).map((row, index) => [
      index + 1,
      row.opportunity_score,
      row.title,
      row.url,
      row.category,
      row.primary_competitor,
      row.quick_action,
      row.checkout_action,
      row.citation_action,
      row.retest_wave,
      row.owner,
    ]),
  ]));
  await writeFile(path.join(outDir, "boss-page-heatmap-talking-points.md"), renderMarkdown({ rows, categoryRows, batchRows }));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown({ rows, categoryRows, batchRows }));
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml({ rows, categoryRows, batchRows }));
  await writeFile(path.join(outDir, "blog-page-opportunity-data.json"), JSON.stringify({
    summary: {
      pages: rows.length,
      aPages: rows.filter((row) => row.opportunity_band.startsWith("A:")).length,
      bPages: rows.filter((row) => row.opportunity_band.startsWith("B:")).length,
      topCategory: categoryRows[0]?.category || "",
      topBatch: batchRows[0]?.batch || "",
    },
    rows,
    categoryRows,
    batchRows,
  }, null, 2));

  console.log(`Wrote ${outDir}`);
  console.log(`Pages: ${rows.length}; A-band: ${rows.filter((row) => row.opportunity_band.startsWith("A:")).length}; top page: ${rows[0]?.title || "none"}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
