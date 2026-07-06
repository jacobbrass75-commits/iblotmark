import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";

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

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function latestDir(prefix) {
  const entries = await readdir(path.join(process.cwd(), OUTPUT_ROOT), { withFileTypes: true });
  const name = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  if (!name) throw new Error(`No ${prefix} directory found in ${OUTPUT_ROOT}`);
  return path.join(process.cwd(), OUTPUT_ROOT, name);
}

function num(value) {
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function average(values) {
  const clean = values.map(num).filter((value) => Number.isFinite(value));
  if (!clean.length) return 0;
  return Math.round(clean.reduce((sum, value) => sum + value, 0) / clean.length);
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .flatMap((part) => part.split("/"))
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function top(rows, key, count = 10) {
  return [...rows].sort((a, b) => num(b[key]) - num(a[key]) || String(a.page_title || a.query || a.brand).localeCompare(String(b.page_title || b.query || b.brand))).slice(0, count);
}

function classifyStage(row) {
  if (num(row.mention_rate) === 0) return "not mentioned";
  if (num(row.top_three_rate) === 0) return "mentioned, not top 3";
  return "top 3, not cited";
}

function actionFromRow({ row, triage, postAction }) {
  if (postAction?.duplicate_risk === "true" || triage?.action?.includes("duplicate") || triage?.action?.includes("canonical")) {
    return "Resolve canonical/duplicate risk before rewriting.";
  }
  if (num(row.mention_rate) === 0) {
    return "Add query-exact quick answer, named iBOLT product module, fair competitor tradeoff, FAQ schema, and image alt text.";
  }
  if (num(row.top_three_rate) === 0) {
    return "Strengthen recommendation language so iBOLT is presented as a top specialist option.";
  }
  return "Make the page citation-ready with visible answer blocks, FAQPage schema, Article/BlogPosting schema, and source-friendly product details.";
}

function priorityScore({ row, triage, postAction }) {
  let score = num(row.opportunity_score);
  score += num(row.competitor_only_answers) * 12;
  if (num(row.mention_rate) === 0) score += 30;
  if (num(row.top_three_rate) === 0) score += 12;
  if (triage?.action?.includes("priority")) score += 10;
  if (triage?.action?.includes("duplicate") || triage?.action?.includes("canonical")) score += 18;
  if (postAction?.duplicate_risk === "true") score += 18;
  score += Math.max(0, 85 - num(row.page_score));
  return score;
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

function barSvg({ title, rows, labelKey, valueKey, maxValue, color = "#1d4ed8" }) {
  const width = 940;
  const rowHeight = 34;
  const topOffset = 56;
  const height = topOffset + rows.length * rowHeight + 24;
  const labelWidth = 390;
  const barWidth = 390;
  const max = maxValue || Math.max(1, ...rows.map((row) => num(row[valueKey])));
  const bars = rows.map((row, index) => {
    const value = num(row[valueKey]);
    const y = topOffset + index * rowHeight;
    const w = Math.max(2, Math.round((value / max) * barWidth));
    return `<text x="22" y="${y + 16}" fill="#0f172a" font-size="13">${escapeHtml(row[labelKey]).slice(0, 58)}</text>
<rect x="${labelWidth}" y="${y}" width="${barWidth}" height="20" rx="4" fill="#e2e8f0"/>
<rect x="${labelWidth}" y="${y}" width="${w}" height="20" rx="4" fill="${color}"/>
<text x="${labelWidth + barWidth + 12}" y="${y + 15}" fill="#0f172a" font-size="13" font-weight="700">${escapeHtml(value)}</text>`;
  }).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="#ffffff"/>
<text x="22" y="34" fill="#0f172a" font-size="22" font-weight="800">${escapeHtml(title)}</text>
${bars}
</svg>`;
}

function buildQueryRows({ promptGrid, triageByUrl, productByUrl, retestByUrl, postActionByUrl }) {
  return promptGrid.map((row) => {
    const triage = triageByUrl.get(row.page_url) || {};
    const products = productByUrl.get(row.page_url) || {};
    const retest = retestByUrl.get(row.page_url) || {};
    const postAction = postActionByUrl.get(row.page_url) || {};
    const action = actionFromRow({ row, triage, postAction });
    const priority = priorityScore({ row, triage, postAction });

    return {
      priority,
      stage: classifyStage(row),
      query: row.query,
      category: row.category,
      opportunity_score: row.opportunity_score,
      avg_score: row.avg_score,
      mention_rate: row.mention_rate,
      top_three_rate: row.top_three_rate,
      competitor_only_answers: row.competitor_only_answers,
      competitors: row.competitors,
      provider_cells: row.provider_cells,
      page_title: row.page_title,
      page_url: row.page_url,
      page_score: row.page_score,
      triage_action: triage.action || "",
      triage_effort: triage.effort || "",
      triage_issues: triage.issues || row.structural_issues || "",
      structural_issues: row.structural_issues,
      duplicate_risk: postAction.duplicate_risk || "",
      products_to_add: products.products_to_add || "",
      product_module: products.product_module || "",
      current_product_links: products.current_product_links || postAction.product_link_count || "",
      weakest_providers: retest.weakest_providers || "",
      retest_action: retest.retest_action || `Rerun ${row.query} on ChatGPT, Claude, and Gemini.`,
      recommended_action: row.recommended_action,
      next_action: action,
    };
  }).sort((a, b) => b.priority - a.priority || a.query.localeCompare(b.query));
}

function buildPageRows(queryRows) {
  const grouped = groupBy(queryRows.filter((row) => row.page_url), (row) => row.page_url);
  return [...grouped.entries()].map(([pageUrl, rows]) => {
    const first = rows[0];
    const competitors = unique(rows.flatMap((row) => splitList(row.competitors)));
    const productModules = unique(rows.map((row) => row.product_module).filter(Boolean));
    const issues = unique(rows.flatMap((row) => splitList(row.triage_issues || row.structural_issues)));
    const retestPrompts = unique(rows.map((row) => row.query));
    const zeroMention = rows.filter((row) => num(row.mention_rate) === 0);
    const priority = Math.max(...rows.map((row) => num(row.priority))) + rows.length * 4 + zeroMention.length * 8;
    const duplicateRisk = rows.some((row) => row.duplicate_risk === "true") ? "yes" : "";

    return {
      priority,
      page_title: first.page_title,
      page_url: pageUrl,
      category: first.category,
      query_count: rows.length,
      zero_mention_queries: zeroMention.length,
      avg_opportunity: average(rows.map((row) => row.opportunity_score)),
      avg_page_score: average(rows.map((row) => row.page_score)),
      competitor_only_answers: rows.reduce((sum, row) => sum + num(row.competitor_only_answers), 0),
      competitors: competitors.slice(0, 12).join("; "),
      triage_action: first.triage_action,
      duplicate_risk: duplicateRisk,
      issues: issues.slice(0, 10).join("; "),
      product_module: productModules[0] || "",
      retest_prompts: retestPrompts.join("; "),
      next_action: duplicateRisk ? "Resolve canonical/duplicate risk, then merge strongest answer blocks into the surviving page." : first.next_action,
    };
  }).sort((a, b) => b.priority - a.priority || a.page_title.localeCompare(b.page_title));
}

function buildCompetitorRows(queryRows) {
  const rows = [];
  for (const row of queryRows) {
    for (const brand of splitList(row.competitors)) {
      rows.push({ brand, row });
    }
  }
  const grouped = groupBy(rows, ({ brand }) => brand);
  return [...grouped.entries()].map(([brand, items]) => {
    const querySet = unique(items.map(({ row }) => row.query));
    const pageSet = unique(items.map(({ row }) => row.page_title));
    const categories = unique(items.map(({ row }) => row.category));
    const pressure = items.reduce((sum, { row }) => sum + num(row.priority), 0);
    return {
      pressure,
      brand,
      query_count: querySet.length,
      page_count: pageSet.length,
      categories: categories.join("; "),
      top_queries: querySet.slice(0, 8).join("; "),
      mapped_pages: pageSet.slice(0, 8).join("; "),
    };
  }).sort((a, b) => b.pressure - a.pressure || a.brand.localeCompare(b.brand));
}

function rowsToCsv(records, headers) {
  return csv([
    headers,
    ...records.map((row) => headers.map((header) => row[header] ?? "")),
  ]);
}

function makeMarkdown({ master, queryRows, pageRows, competitorRows }) {
  const evidence = master.evidenceSummary;
  const stageCounts = [...groupBy(queryRows, (row) => row.stage).entries()]
    .map(([stage, rows]) => `${stage}: ${rows.length}`)
    .join(", ");
  const duplicatePages = pageRows.filter((row) => row.duplicate_risk === "yes").length;

  return `# iBOLT Query-To-Page AI Visibility Matrix

## What This Adds

This joins benchmark prompts to the live Shopify page that should fix each weak answer. It connects model performance, competitor pressure, page structure gaps, product modules, duplicate risk, and retest prompts in one matrix.

## Current State

- iBOLT mention rate: ${evidence.mentionCount}/${evidence.total} (${evidence.mentionRate}%).
- Non-branded mention rate: ${evidence.nonBrandedMentionCount}/${evidence.nonBranded} (${evidence.nonBrandedMentionRate}%).
- Target-domain citation rate: ${evidence.citationCount}/${evidence.total} (${evidence.citationRate}%).
- Query rows mapped: ${queryRows.length}.
- Live pages with mapped benchmark pressure: ${pageRows.length}.
- Pages with duplicate/canonical risk in this matrix: ${duplicatePages}.
- Query stage counts: ${stageCounts}.

## Highest-Priority Page Fixes

| Priority | Page | Queries | Zero-mention | Competitor-only | Competitors | Action |
| ---: | --- | ---: | ---: | ---: | --- | --- |
${top(pageRows, "priority", 12).map((row) => `| ${row.priority} | [${row.page_title}](${row.page_url}) | ${row.query_count} | ${row.zero_mention_queries} | ${row.competitor_only_answers} | ${row.competitors} | ${row.next_action} |`).join("\n")}

## Highest-Priority Queries

| Priority | Query | Stage | Page | Competitors | Next action |
| ---: | --- | --- | --- | --- | --- |
${top(queryRows, "priority", 15).map((row) => `| ${row.priority} | ${row.query} | ${row.stage} | [${row.page_title}](${row.page_url}) | ${row.competitors} | ${row.next_action} |`).join("\n")}

## Competitor Pressure By Page Map

| Pressure | Brand | Queries | Pages | Categories | Top queries |
| ---: | --- | ---: | ---: | --- | --- |
${top(competitorRows, "pressure", 12).map((row) => `| ${row.pressure} | ${row.brand} | ${row.query_count} | ${row.page_count} | ${row.categories} | ${row.top_queries} |`).join("\n")}

## How To Use This

1. Resolve duplicate/canonical-risk pages before rewriting so the edits land on the surviving URL.
2. For each top page, add the exact quick answer for the mapped prompt, then named iBOLT product modules.
3. Add fair comparison blocks against the competitors shown in the row.
4. Add FAQPage schema, Article/BlogPosting schema, image alt text, and clean product links.
5. Retest the prompts listed for the page on ChatGPT, Claude, and Gemini.
`;
}

function makeHtml({ master, queryRows, pageRows, competitorRows }) {
  const evidence = master.evidenceSummary;
  const cards = [
    ["Query rows", queryRows.length, "mapped to pages"],
    ["Mapped pages", pageRows.length, "with benchmark pressure"],
    ["Non-branded mention", `${evidence.nonBrandedMentionRate}%`, `${evidence.nonBrandedMentionCount}/${evidence.nonBranded}`],
    ["Citation rate", `${evidence.citationRate}%`, `${evidence.citationCount}/${evidence.total}`],
    ["Duplicate risk pages", pageRows.filter((row) => row.duplicate_risk === "yes").length, "resolve first"],
    ["Competitors mapped", competitorRows.length, "brands"],
  ].map(([label, value, note]) => `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");

  const pageTable = top(pageRows, "priority", 16).map((row) => `<tr><td>${escapeHtml(row.priority)}</td><td><a href="${escapeHtml(row.page_url)}">${escapeHtml(row.page_title)}</a></td><td>${escapeHtml(row.query_count)}</td><td>${escapeHtml(row.zero_mention_queries)}</td><td>${escapeHtml(row.competitor_only_answers)}</td><td>${escapeHtml(row.competitors)}</td><td>${escapeHtml(row.next_action)}</td></tr>`).join("");
  const queryTable = top(queryRows, "priority", 20).map((row) => `<tr><td>${escapeHtml(row.priority)}</td><td>${escapeHtml(row.query)}</td><td>${escapeHtml(row.stage)}</td><td><a href="${escapeHtml(row.page_url)}">${escapeHtml(row.page_title)}</a></td><td>${escapeHtml(row.competitors)}</td><td>${escapeHtml(row.next_action)}</td></tr>`).join("");
  const competitorTable = top(competitorRows, "pressure", 14).map((row) => `<tr><td>${escapeHtml(row.pressure)}</td><td>${escapeHtml(row.brand)}</td><td>${escapeHtml(row.query_count)}</td><td>${escapeHtml(row.page_count)}</td><td>${escapeHtml(row.categories)}</td><td>${escapeHtml(row.top_queries)}</td></tr>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>iBOLT Query-To-Page AI Visibility Matrix</title>
<style>
body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}main{max-width:1280px;margin:0 auto;padding:34px 24px 70px}h1{font-size:36px;margin:0 0 8px}h2{font-size:22px;margin:34px 0 12px}p,li{color:#334155;line-height:1.55}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid #d9e2ef;border-radius:12px;padding:16px}.k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700}.v{font-size:30px;font-weight:800;margin-top:8px}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d9e2ef;border-radius:12px;overflow:hidden;margin-bottom:22px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #edf2f7;padding:10px 11px;font-size:14px}th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:12px;letter-spacing:.04em}a{color:#1d4ed8}.charts{display:grid;grid-template-columns:1fr 1fr;gap:14px}.chart{background:#fff;border:1px solid #d9e2ef;border-radius:12px;padding:8px;overflow:auto}
</style></head><body><main>
<h1>iBOLT Query-To-Page AI Visibility Matrix</h1>
<p>This joins weak benchmark prompts to the live Shopify page that should fix each answer, including competitor pressure, page issues, product modules, duplicate risk, and retest prompts.</p>
<section class="cards">${cards}</section>
<section class="charts">
<div class="chart"><img src="top-page-pressure.svg" alt="Top page pressure"/></div>
<div class="chart"><img src="competitor-page-pressure.svg" alt="Competitor page pressure"/></div>
</section>
<h2>Highest-Priority Page Fixes</h2><table><thead><tr><th>Priority</th><th>Page</th><th>Queries</th><th>Zero mention</th><th>Competitor-only</th><th>Competitors</th><th>Action</th></tr></thead><tbody>${pageTable}</tbody></table>
<h2>Highest-Priority Queries</h2><table><thead><tr><th>Priority</th><th>Query</th><th>Stage</th><th>Page</th><th>Competitors</th><th>Next action</th></tr></thead><tbody>${queryTable}</tbody></table>
<h2>Competitor Pressure By Page Map</h2><table><thead><tr><th>Pressure</th><th>Brand</th><th>Queries</th><th>Pages</th><th>Categories</th><th>Top queries</th></tr></thead><tbody>${competitorTable}</tbody></table>
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, "query-page-matrix");
  await mkdir(outDir, { recursive: true });

  const master = await readJson(path.join(benchmarkDir, "master-dossier", "master-dossier-data.json"));
  const promptGrid = await readCsv(path.join(benchmarkDir, "mention-landscape", "prompt-provider-grid.csv"));
  const triageRows = await readCsv(path.join(benchmarkDir, "live-blog-triage", "all-live-blog-triage.csv"));
  const productRows = await readCsv(path.join(benchmarkDir, "page-refresh-playbook", "product-modules-by-page.csv"));
  const retestRows = await readCsv(path.join(benchmarkDir, "page-refresh-playbook", "retest-prompts-by-page.csv"));
  const postActionRows = await readCsv(path.join(benchmarkDir, "content-refresh-roadmap", "all-blog-post-action-map.csv"));

  const triageByUrl = new Map(triageRows.map((row) => [row.url, row]));
  const productByUrl = new Map(productRows.map((row) => [row.page_url, row]));
  const retestByUrl = new Map(retestRows.map((row) => [row.page_url, row]));
  const postActionByUrl = new Map(postActionRows.map((row) => [row.url, row]));

  const queryRows = buildQueryRows({ promptGrid, triageByUrl, productByUrl, retestByUrl, postActionByUrl });
  const pageRows = buildPageRows(queryRows);
  const competitorRows = buildCompetitorRows(queryRows);

  await writeFile(path.join(outDir, "all-query-page-matrix.csv"), rowsToCsv(queryRows, [
    "priority",
    "stage",
    "query",
    "category",
    "opportunity_score",
    "avg_score",
    "mention_rate",
    "top_three_rate",
    "competitor_only_answers",
    "competitors",
    "provider_cells",
    "page_title",
    "page_url",
    "page_score",
    "triage_action",
    "triage_effort",
    "triage_issues",
    "structural_issues",
    "duplicate_risk",
    "products_to_add",
    "product_module",
    "current_product_links",
    "weakest_providers",
    "retest_action",
    "recommended_action",
    "next_action",
  ]));
  await writeFile(path.join(outDir, "page-action-matrix.csv"), rowsToCsv(pageRows, [
    "priority",
    "page_title",
    "page_url",
    "category",
    "query_count",
    "zero_mention_queries",
    "avg_opportunity",
    "avg_page_score",
    "competitor_only_answers",
    "competitors",
    "triage_action",
    "duplicate_risk",
    "issues",
    "product_module",
    "retest_prompts",
    "next_action",
  ]));
  await writeFile(path.join(outDir, "competitor-page-map.csv"), rowsToCsv(competitorRows, [
    "pressure",
    "brand",
    "query_count",
    "page_count",
    "categories",
    "top_queries",
    "mapped_pages",
  ]));
  await writeFile(path.join(outDir, "query-page-matrix-data.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    benchmarkDir,
    queryRows: queryRows.length,
    pageRows: pageRows.length,
    competitorRows: competitorRows.length,
    duplicateRiskPages: pageRows.filter((row) => row.duplicate_risk === "yes").length,
    zeroMentionQueryRows: queryRows.filter((row) => row.stage === "not mentioned").length,
    topPages: top(pageRows, "priority", 12),
    topCompetitors: top(competitorRows, "pressure", 12),
  }, null, 2));

  await writeFile(path.join(outDir, "top-page-pressure.svg"), barSvg({
    title: "Top Page Pressure",
    rows: top(pageRows, "priority", 10),
    labelKey: "page_title",
    valueKey: "priority",
    color: "#2563eb",
  }));
  await writeFile(path.join(outDir, "competitor-page-pressure.svg"), barSvg({
    title: "Competitor Pressure Across Mapped Pages",
    rows: top(competitorRows, "pressure", 10),
    labelKey: "brand",
    valueKey: "pressure",
    color: "#7c3aed",
  }));

  await writeFile(path.join(outDir, "REPORT.md"), makeMarkdown({ master, queryRows, pageRows, competitorRows }));
  await writeFile(path.join(outDir, "REPORT.html"), makeHtml({ master, queryRows, pageRows, competitorRows }));

  console.log(`Wrote ${outDir}`);
  console.log(`Mapped ${queryRows.length} query rows to ${pageRows.length} pages and ${competitorRows.length} competitors.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
