import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";
const REPORT_DIR = "priority-retest-packet";

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
    .filter(Boolean);
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

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function promptKey(row) {
  return `${normalizeText(row.page_url)}|${normalizeText(row.prompt).toLowerCase()}|${normalizeText(row.provider)}`;
}

function requestScore({ request, workOrder }) {
  const typeWeights = {
    mapped: 42,
    comparison: 34,
    product_entity: 30,
    citation_probe: 28,
    non_branded_best: 26,
    buyer_problem: 22,
  };
  const providerWeights = {
    claude: 9,
    chatgpt: 7,
    gemini_plain: 6,
  };
  const pageRankBoost = Math.max(0, 28 - number(workOrder?.rank || 30));
  const sprintBoost = /Sprint 1/i.test(workOrder?.conversion_tier || "") ? 18 : /Sprint 2/i.test(workOrder?.conversion_tier || "") ? 8 : 0;
  const competitorBoost = number(workOrder?.competitor_only_answers) * 3;
  const zeroMentionBoost = number(workOrder?.zero_mention_queries) * 5;
  return (
    number(request.priority) +
    (typeWeights[request.prompt_type] || 10) +
    (providerWeights[request.provider] || 0) +
    pageRankBoost +
    sprintBoost +
    competitorBoost +
    zeroMentionBoost
  );
}

function waveFor({ request, workOrder }) {
  if (/Sprint 1/i.test(workOrder?.conversion_tier || "") && ["mapped", "comparison", "product_entity"].includes(request.prompt_type)) {
    return "W1 Sprint 1 edit validation";
  }
  if (number(workOrder?.rank) <= 20 && ["mapped", "comparison"].includes(request.prompt_type)) {
    return "W2 top-page mention recovery";
  }
  if (request.prompt_type === "citation_probe") {
    return "W3 citation probe";
  }
  if (request.prompt_type === "product_entity") {
    return "W4 product entity recognition";
  }
  if (["non_branded_best", "buyer_problem"].includes(request.prompt_type)) {
    return "W5 non-branded buyer coverage";
  }
  return "W6 long-tail monitor";
}

function prerequisiteFor({ request, workOrder }) {
  if (/canonical/i.test(workOrder?.execution_lane || "")) {
    return "Pick survivor URL and publish survivor edit before running.";
  }
  if (/citation_probe/i.test(request.prompt_type)) {
    return "Run after FAQ/schema, product module, and citation-source blocks are live.";
  }
  if (/product_entity/i.test(request.prompt_type)) {
    return "Run after exact product names, product cards, image alt text, and specs are live.";
  }
  return "Run after answer block, comparison block, product module, and FAQ/schema are live.";
}

function metricFor({ request, workOrder }) {
  if (request.prompt_type === "citation_probe") return "Target-domain citation or source-url row appears.";
  if (request.prompt_type === "product_entity") return "Exact iBOLT product/entity is named without hallucinated aliases.";
  if (number(workOrder?.competitor_only_answers) > 0) return "Competitor-only answer becomes iBOLT-included or top-3 iBOLT.";
  if (number(workOrder?.zero_mention_queries) > 0) return "Zero-mention prompt becomes iBOLT-mentioned.";
  return normalizeText(request.expected_metric || "iBOLT mention, top-3 recommendation, and competitor set movement.");
}

function selectRequests({ manifestRows, workOrders }) {
  const workByUrl = new Map(workOrders.map((row) => [row.url, row]));
  const enriched = manifestRows.map((request) => {
    const workOrder = workByUrl.get(request.page_url);
    const wave = waveFor({ request, workOrder });
    return {
      ...request,
      page_rank: number(workOrder?.rank || 999),
      page_execution_score: number(workOrder?.execution_score),
      conversion_tier: normalizeText(workOrder?.conversion_tier),
      execution_lane: normalizeText(workOrder?.execution_lane),
      owner_sequence: normalizeText(workOrder?.owner_sequence),
      competitors: normalizeText(workOrder?.competitors),
      products_to_feature: normalizeText(workOrder?.products_to_feature),
      wave,
      prerequisite: prerequisiteFor({ request, workOrder }),
      success_metric: metricFor({ request, workOrder }),
      retest_score: requestScore({ request, workOrder }),
    };
  }).filter((row) => row.page_url);

  const selected = [];
  const seen = new Set();
  const waveLimits = new Map([
    ["W1 Sprint 1 edit validation", 45],
    ["W2 top-page mention recovery", 66],
    ["W3 citation probe", 24],
    ["W4 product entity recognition", 33],
    ["W5 non-branded buyer coverage", 54],
  ]);

  for (const [wave, limit] of waveLimits.entries()) {
    const candidates = enriched
      .filter((row) => row.wave === wave)
      .sort((a, b) => b.retest_score - a.retest_score);
    const byPageType = new Map();
    for (const row of candidates) {
      const key = `${row.page_url}|${row.prompt_type}`;
      if (!byPageType.has(key)) byPageType.set(key, []);
      byPageType.get(key).push(row);
    }
    const waveSelected = [];
    for (const rows of byPageType.values()) {
      for (const row of rows.sort((a, b) => b.retest_score - a.retest_score).slice(0, 3)) {
        const key = promptKey(row);
        if (!seen.has(key)) {
          seen.add(key);
          waveSelected.push(row);
        }
      }
    }
    for (const row of waveSelected.sort((a, b) => b.retest_score - a.retest_score).slice(0, limit)) {
      selected.push(row);
    }
  }

  return selected
    .sort((a, b) => {
      const waveA = [...waveLimits.keys()].indexOf(a.wave);
      const waveB = [...waveLimits.keys()].indexOf(b.wave);
      return waveA - waveB || b.retest_score - a.retest_score;
    })
    .map((row, index) => ({ ...row, retest_rank: index + 1 }));
}

function buildBatches(selectedRows) {
  return [...groupBy(selectedRows, (row) => row.wave).entries()].map(([wave, rows], index) => {
    const providers = uniq(rows.map((row) => row.provider));
    const categories = [...groupBy(rows, (row) => row.category).entries()]
      .map(([category, categoryRows]) => `${category} ${categoryRows.length}`)
      .sort()
      .join("; ");
    const promptTypes = [...groupBy(rows, (row) => row.prompt_type).entries()]
      .map(([type, typeRows]) => `${type} ${typeRows.length}`)
      .sort()
      .join("; ");
    return {
      batch_id: `R${String(index + 1).padStart(2, "0")}`,
      wave,
      requests: rows.length,
      unique_prompts: uniq(rows.map((row) => row.prompt)).length,
      pages: uniq(rows.map((row) => row.page_url)).length,
      providers: providers.join("; "),
      categories,
      prompt_types: promptTypes,
      prerequisite: rows[0]?.prerequisite || "",
      success_metric: rows[0]?.success_metric || "",
    };
  });
}

function buildProviderRows(selectedRows) {
  return [...groupBy(selectedRows, (row) => row.provider).entries()].map(([provider, rows]) => ({
    provider,
    requests: rows.length,
    pages: uniq(rows.map((row) => row.page_url)).length,
    prompt_types: [...groupBy(rows, (row) => row.prompt_type).entries()].map(([type, typeRows]) => `${type} ${typeRows.length}`).join("; "),
    top_categories: [...groupBy(rows, (row) => row.category).entries()].map(([category, categoryRows]) => `${category} ${categoryRows.length}`).sort().join("; "),
  })).sort((a, b) => b.requests - a.requests);
}

function buildCategoryRows(selectedRows) {
  return [...groupBy(selectedRows, (row) => row.category || "uncategorized").entries()].map(([category, rows]) => ({
    category,
    requests: rows.length,
    pages: uniq(rows.map((row) => row.page_url)).length,
    waves: [...groupBy(rows, (row) => row.wave).entries()].map(([wave, waveRows]) => `${wave} ${waveRows.length}`).join("; "),
    providers: [...groupBy(rows, (row) => row.provider).entries()].map(([provider, providerRows]) => `${provider} ${providerRows.length}`).join("; "),
    top_pages: uniq(rows.sort((a, b) => a.page_rank - b.page_rank).map((row) => row.closest_post)).slice(0, 6).join("; "),
  })).sort((a, b) => b.requests - a.requests);
}

function barSvg({ title, subtitle, rows, width = 1040, height = 420, color = "#2563eb" }) {
  const margin = { top: 78, right: 70, bottom: 34, left: 300 };
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

function table(rows, columns) {
  const header = columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");
  const body = rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(row[column.key])}</td>`).join("")}</tr>`).join("");
  return `<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
}

function buildMarkdown({ summary, selectedRows, batchRows, providerRows, categoryRows, manifestPath }) {
  return `# Priority AI Retest Packet

## Purpose

This turns the full ${summary.fullProviderRequests}-request expanded benchmark into a smaller staged retest queue that can run after page edits.

## Summary

- Priority provider requests: ${summary.priorityProviderRequests}.
- Unique prompts: ${summary.uniquePrompts}.
- Pages covered: ${summary.pagesCovered}.
- Categories covered: ${summary.categoriesCovered}.
- Providers: ${summary.providers.join(", ")}.
- Runnable manifest: \`${manifestPath}\`.

## How To Run

\`\`\`bash
AI_BENCHMARK_EXPANDED_LIMIT=0 \\
AI_BENCHMARK_EXPANDED_MANIFEST=${manifestPath} \\
npx tsx scripts/run-expanded-openrouter-ai-benchmark.ts
\`\`\`

Use \`AI_BENCHMARK_DRY_RUN=1\` first. Do not put the API key in a file.

## Retest Waves

| Batch | Wave | Requests | Pages | Prompt types | Prerequisite |
| --- | --- | ---: | ---: | --- | --- |
${batchRows.map((row) => `| ${row.batch_id} | ${row.wave} | ${row.requests} | ${row.pages} | ${row.prompt_types} | ${row.prerequisite} |`).join("\n")}

## First Requests

| Rank | Wave | Provider | Prompt | Page | Category | Metric |
| ---: | --- | --- | --- | --- | --- | --- |
${selectedRows.slice(0, 30).map((row) => `| ${row.retest_rank} | ${row.wave} | ${row.provider} | ${row.prompt} | ${row.closest_post} | ${row.category} | ${row.success_metric} |`).join("\n")}

## Provider Balance

| Provider | Requests | Pages | Prompt types | Categories |
| --- | ---: | ---: | --- | --- |
${providerRows.map((row) => `| ${row.provider} | ${row.requests} | ${row.pages} | ${row.prompt_types} | ${row.top_categories} |`).join("\n")}

## Category Balance

| Category | Requests | Pages | Waves | Top pages |
| --- | ---: | ---: | --- | --- |
${categoryRows.map((row) => `| ${row.category} | ${row.requests} | ${row.pages} | ${row.waves} | ${row.top_pages} |`).join("\n")}
`;
}

function buildHtml({ summary, selectedRows, batchRows, providerRows, categoryRows, manifestPath }) {
  const cards = [
    ["Priority requests", summary.priorityProviderRequests, `${summary.uniquePrompts} unique prompts`],
    ["Pages covered", summary.pagesCovered, `${summary.categoriesCovered} categories`],
    ["Full backlog", summary.fullProviderRequests, "expanded requests"],
    ["Providers", summary.providers.length, summary.providers.join(", ")],
    ["First wave", batchRows[0]?.requests || 0, batchRows[0]?.wave || ""],
    ["Runnable manifest", "ready", manifestPath.split("/").slice(-2).join("/")],
  ].map(([label, value, note]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>iBOLT Priority AI Retest Packet</title>
<style>
body{margin:0;background:#f8fafc;color:#0f172a;font-family:Arial,Helvetica,sans-serif}main{max-width:1260px;margin:0 auto;padding:34px 26px 64px}h1{font-size:34px;margin:0 0 8px}h2{font-size:22px;margin:34px 0 14px}p{color:#334155;line-height:1.55}.note{background:#fff;border-left:6px solid #0f766e;border-top:1px solid #d7dee8;border-right:1px solid #d7dee8;border-bottom:1px solid #d7dee8;border-radius:10px;padding:16px 18px}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:20px 0}.card{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}.label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:800}.value{font-size:31px;font-weight:900;margin-top:8px}.chart{background:#fff;border:1px solid #d7dee8;border-radius:14px;margin:18px 0;padding:12px;overflow:auto}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden;margin:12px 0 24px}th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}code{background:#eef2f7;padding:2px 5px;border-radius:5px}
</style></head><body><main>
<h1>iBOLT Priority AI Retest Packet</h1>
<p class="note"><strong>Run this after edits.</strong> This packet reduces the full ${summary.fullProviderRequests}-request backlog into a staged ${summary.priorityProviderRequests}-request retest queue, preserving provider balance and the prompts most likely to prove mention recovery, product recognition, and citation readiness.</p>
<section class="cards">${cards}</section>
<h2>Charts</h2>
<div class="chart"><img src="requests-by-wave.svg" alt="Requests by wave"/></div>
<div class="chart"><img src="requests-by-category.svg" alt="Requests by category"/></div>
<div class="chart"><img src="requests-by-provider.svg" alt="Requests by provider"/></div>
<h2>Run Command</h2>
<p><code>AI_BENCHMARK_EXPANDED_LIMIT=0 AI_BENCHMARK_EXPANDED_MANIFEST=${escapeHtml(manifestPath)} npx tsx scripts/run-expanded-openrouter-ai-benchmark.ts</code></p>
<h2>Retest Waves</h2>
${table(batchRows, [
  { key: "batch_id", label: "Batch" },
  { key: "wave", label: "Wave" },
  { key: "requests", label: "Requests" },
  { key: "pages", label: "Pages" },
  { key: "prompt_types", label: "Prompt types" },
  { key: "prerequisite", label: "Prerequisite" },
])}
<h2>First Requests</h2>
${table(selectedRows.slice(0, 50), [
  { key: "retest_rank", label: "Rank" },
  { key: "wave", label: "Wave" },
  { key: "provider", label: "Provider" },
  { key: "prompt", label: "Prompt" },
  { key: "closest_post", label: "Page" },
  { key: "category", label: "Category" },
  { key: "success_metric", label: "Metric" },
])}
<h2>Provider Balance</h2>
${table(providerRows, [
  { key: "provider", label: "Provider" },
  { key: "requests", label: "Requests" },
  { key: "pages", label: "Pages" },
  { key: "prompt_types", label: "Prompt types" },
  { key: "top_categories", label: "Categories" },
])}
<h2>Category Balance</h2>
${table(categoryRows, [
  { key: "category", label: "Category" },
  { key: "requests", label: "Requests" },
  { key: "pages", label: "Pages" },
  { key: "waves", label: "Waves" },
  { key: "top_pages", label: "Top pages" },
])}
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, REPORT_DIR);
  await mkdir(outDir, { recursive: true });

  const manifestRows = await readCsv(path.join(benchmarkDir, "page-derived-expanded-benchmark-pack", "provider-request-manifest.csv"));
  const workOrders = await readCsv(path.join(benchmarkDir, "page-execution-control-board", "page-work-order-queue.csv"));
  const selectedRows = selectRequests({ manifestRows, workOrders });
  const batchRows = buildBatches(selectedRows);
  const providerRows = buildProviderRows(selectedRows);
  const categoryRows = buildCategoryRows(selectedRows);
  const pageExecutionData = await readJsonIfExists(path.join(benchmarkDir, "page-execution-control-board", "page-execution-control-data.json"), { summary: {} });
  const manifestPath = path.relative(process.cwd(), path.join(outDir, "priority-provider-request-manifest.csv"));

  const summary = {
    benchmarkDir,
    fullProviderRequests: manifestRows.length,
    priorityProviderRequests: selectedRows.length,
    uniquePrompts: uniq(selectedRows.map((row) => row.prompt)).length,
    pagesCovered: uniq(selectedRows.map((row) => row.page_url)).length,
    categoriesCovered: uniq(selectedRows.map((row) => row.category)).length,
    providers: uniq(selectedRows.map((row) => row.provider)),
    sourceWorkOrders: pageExecutionData.summary?.pages || workOrders.length,
  };

  await writeFile(path.join(outDir, "priority-provider-request-manifest.csv"), toCsv([
    ["batch_id", "provider", "prompt", "category", "source", "priority", "closest_post", "page_url", "prompt_type", "refresh_state", "expected_metric"],
    ...selectedRows.map((row) => [
      batchRows.find((batch) => batch.wave === row.wave)?.batch_id || row.batch_id,
      row.provider,
      row.prompt,
      row.category,
      row.source || "priority_retest_packet",
      row.retest_score,
      row.closest_post,
      row.page_url,
      row.prompt_type,
      row.refresh_state,
      row.success_metric,
    ]),
  ]));

  await writeFile(path.join(outDir, "priority-retest-request-queue.csv"), toCsv([
    [
      "retest_rank",
      "wave",
      "provider",
      "prompt",
      "category",
      "prompt_type",
      "retest_score",
      "page_rank",
      "page_execution_score",
      "conversion_tier",
      "execution_lane",
      "owner_sequence",
      "closest_post",
      "page_url",
      "competitors",
      "products_to_feature",
      "prerequisite",
      "success_metric",
    ],
    ...selectedRows.map((row) => [
      row.retest_rank,
      row.wave,
      row.provider,
      row.prompt,
      row.category,
      row.prompt_type,
      row.retest_score,
      row.page_rank,
      row.page_execution_score,
      row.conversion_tier,
      row.execution_lane,
      row.owner_sequence,
      row.closest_post,
      row.page_url,
      row.competitors,
      row.products_to_feature,
      row.prerequisite,
      row.success_metric,
    ]),
  ]));

  await writeFile(path.join(outDir, "retest-batches.csv"), toCsv([
    ["batch_id", "wave", "requests", "unique_prompts", "pages", "providers", "categories", "prompt_types", "prerequisite", "success_metric"],
    ...batchRows.map((row) => [row.batch_id, row.wave, row.requests, row.unique_prompts, row.pages, row.providers, row.categories, row.prompt_types, row.prerequisite, row.success_metric]),
  ]));

  await writeFile(path.join(outDir, "provider-balance.csv"), toCsv([
    ["provider", "requests", "pages", "prompt_types", "top_categories"],
    ...providerRows.map((row) => [row.provider, row.requests, row.pages, row.prompt_types, row.top_categories]),
  ]));

  await writeFile(path.join(outDir, "category-balance.csv"), toCsv([
    ["category", "requests", "pages", "waves", "providers", "top_pages"],
    ...categoryRows.map((row) => [row.category, row.requests, row.pages, row.waves, row.providers, row.top_pages]),
  ]));

  await writeFile(path.join(outDir, "priority-retest-data.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    summary,
    selectedRows,
    batchRows,
    providerRows,
    categoryRows,
  }, null, 2));

  await writeFile(path.join(outDir, "requests-by-wave.svg"), barSvg({
    title: "Priority Requests By Wave",
    subtitle: "Run in this order after page edits are live.",
    rows: batchRows.map((row) => ({ name: row.wave, value: row.requests })),
    color: "#0f766e",
  }));
  await writeFile(path.join(outDir, "requests-by-category.svg"), barSvg({
    title: "Priority Requests By Category",
    subtitle: "Balanced to prove restaurant, fleet, delivery, warehouse, fishing, and AMPS movement first.",
    rows: categoryRows.slice(0, 10).map((row) => ({ name: row.category, value: row.requests })),
    color: "#7c3aed",
  }));
  await writeFile(path.join(outDir, "requests-by-provider.svg"), barSvg({
    title: "Priority Requests By Provider",
    subtitle: "The packet keeps ChatGPT, Gemini, and Claude represented.",
    rows: providerRows.map((row) => ({ name: row.provider, value: row.requests })),
    color: "#2563eb",
    height: 300,
  }));

  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown({ summary, selectedRows, batchRows, providerRows, categoryRows, manifestPath }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({ summary, selectedRows, batchRows, providerRows, categoryRows, manifestPath }));

  console.log(`Wrote ${outDir}`);
  console.log(`Priority provider requests: ${summary.priorityProviderRequests}`);
  console.log(`Manifest: ${manifestPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
