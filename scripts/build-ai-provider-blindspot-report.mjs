import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";

const PROVIDER_LABELS = {
  chatgpt: "ChatGPT",
  gemini_plain: "Gemini",
  claude: "Claude",
};

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

function pct(count, total) {
  if (!total) return 0;
  return Math.round((count / total) * 100);
}

function bool(value) {
  return String(value ?? "").toLowerCase() === "true";
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .flatMap((part) => part.split("/"))
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function providerName(provider) {
  return PROVIDER_LABELS[provider] || provider;
}

function top(rows, key, count = 10) {
  return [...rows].sort((a, b) => num(b[key]) - num(a[key]) || String(a.query || a.brand || a.category).localeCompare(String(b.query || b.brand || b.category))).slice(0, count);
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

function counter(rows, valuesFn) {
  const map = new Map();
  for (const row of rows) {
    for (const value of valuesFn(row)) {
      map.set(value, (map.get(value) || 0) + 1);
    }
  }
  return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function stage(row) {
  if (!bool(row.brand_mentioned)) return "not mentioned";
  if (!row.top_pick_rank) return "mentioned, no rank";
  if (num(row.top_pick_rank) > 3) return "mentioned, outside top 3";
  if (!bool(row.domain_cited)) return "top 3, not cited";
  return "cited";
}

function stagePriority(row) {
  const base = {
    "not mentioned": 100,
    "mentioned, no rank": 55,
    "mentioned, outside top 3": 45,
    "top 3, not cited": 25,
    cited: 0,
  }[stage(row)] || 0;
  return base + Math.max(0, 100 - num(row.coverage_score)) + num(row.priority || 0) / 3;
}

function fixFor({ result, matrix }) {
  const issues = splitList(matrix?.structural_issues || "");
  const fixes = [];
  if (!bool(result.brand_mentioned)) fixes.push("add query-exact quick answer that names iBOLT and 2-4 exact products");
  if (!result.top_pick_rank) fixes.push("add recommendation language that makes iBOLT a top specialist option");
  if (!bool(result.domain_cited)) fixes.push("make page source-ready with FAQ/Article/Product schema and visible specs");
  if (issues.some((issue) => /faq/i.test(issue))) fixes.push("add FAQ schema");
  if (issues.some((issue) => /comparison/i.test(issue))) fixes.push("add fair competitor comparison block");
  if (issues.some((issue) => /image alt/i.test(issue))) fixes.push("fix product image alt text");
  return unique(fixes).join("; ");
}

function buildProviderSummary(results) {
  return [...groupBy(results, (row) => row.provider).entries()].map(([provider, rows]) => {
    const mentionCount = rows.filter((row) => bool(row.brand_mentioned)).length;
    const citedCount = rows.filter((row) => bool(row.domain_cited)).length;
    const topThreeCount = rows.filter((row) => row.top_pick_rank && num(row.top_pick_rank) <= 3).length;
    const competitorOnly = rows.filter((row) => !bool(row.brand_mentioned) && splitList(row.competitors).length).length;
    return {
      provider: providerName(provider),
      provider_key: provider,
      results: rows.length,
      avg_score: Math.round(rows.reduce((sum, row) => sum + num(row.coverage_score), 0) / Math.max(1, rows.length)),
      mention_count: mentionCount,
      mention_rate: pct(mentionCount, rows.length),
      top_three_count: topThreeCount,
      top_three_rate: pct(topThreeCount, rows.length),
      citation_count: citedCount,
      citation_rate: pct(citedCount, rows.length),
      competitor_only_count: competitorOnly,
      competitor_only_rate: pct(competitorOnly, rows.length),
      top_competitors: counter(rows, (row) => splitList(row.competitors)).slice(0, 8).map((item) => `${item.name} ${item.count}`).join("; "),
    };
  }).sort((a, b) => a.provider.localeCompare(b.provider));
}

function buildConsensusRows(results, matrixByQuery) {
  return [...groupBy(results, (row) => row.query).entries()].map(([query, rows]) => {
    const matrix = matrixByQuery.get(query) || {};
    const missed = rows.filter((row) => !bool(row.brand_mentioned));
    const mentioned = rows.filter((row) => bool(row.brand_mentioned));
    const topThree = rows.filter((row) => row.top_pick_rank && num(row.top_pick_rank) <= 3);
    const competitors = unique(rows.flatMap((row) => splitList(row.competitors)));
    const providerCells = rows
      .sort((a, b) => providerName(a.provider).localeCompare(providerName(b.provider)))
      .map((row) => `${providerName(row.provider)}: ${stage(row)}, score ${row.coverage_score || 0}${splitList(row.competitors).length ? `, competitors ${splitList(row.competitors).slice(0, 3).join("/")}` : ""}`)
      .join("; ");
    const consensusStage = missed.length === rows.length
      ? "missed by all providers"
      : mentioned.length === rows.length && topThree.length === rows.length
        ? "top-3 across all providers"
        : missed.length >= 2
          ? "missed by 2 providers"
          : "mixed provider result";
    return {
      opportunity: Math.round(num(matrix.opportunity_score) + missed.length * 35 + (rows.length - topThree.length) * 10 + competitors.length * 3),
      consensus_stage: consensusStage,
      query,
      category: rows[0]?.category || matrix.category || "",
      missed_providers: missed.map((row) => providerName(row.provider)).join("; "),
      mentioned_providers: mentioned.map((row) => providerName(row.provider)).join("; "),
      top_three_providers: topThree.map((row) => providerName(row.provider)).join("; "),
      avg_score: Math.round(rows.reduce((sum, row) => sum + num(row.coverage_score), 0) / Math.max(1, rows.length)),
      competitors: competitors.join("; "),
      provider_cells: providerCells,
      page_title: matrix.page_title || "",
      page_url: matrix.page_url || "",
      page_score: matrix.page_score || "",
      structural_issues: matrix.structural_issues || "",
      retest_action: `Retest "${query}" on ChatGPT, Claude, and Gemini after page/product edits.`,
    };
  }).sort((a, b) => b.opportunity - a.opportunity);
}

function buildBlindspotRows(results, matrixByQuery) {
  return results.map((result) => {
    const matrix = matrixByQuery.get(result.query) || {};
    const rowStage = stage(result);
    return {
      priority: Math.round(stagePriority(result) + num(matrix.opportunity_score || 0) / 2),
      provider: providerName(result.provider),
      provider_key: result.provider,
      stage: rowStage,
      query: result.query,
      category: result.category,
      score: result.coverage_score,
      brand_mentioned: result.brand_mentioned,
      top_pick_rank: result.top_pick_rank,
      domain_cited: result.domain_cited,
      competitors: result.competitors,
      sentiment: result.sentiment,
      page_title: matrix.page_title || "",
      page_url: matrix.page_url || "",
      page_score: matrix.page_score || "",
      structural_issues: matrix.structural_issues || "",
      product_module: matrix.product_module || "",
      fix: fixFor({ result, matrix }),
      analysis_notes: result.analysis_notes,
    };
  }).filter((row) => row.stage !== "cited").sort((a, b) => b.priority - a.priority);
}

function buildCompetitorRows(results) {
  const providerGroups = groupBy(results, (row) => row.provider);
  const rows = [];
  for (const [provider, providerRows] of providerGroups) {
    const missedRows = providerRows.filter((row) => !bool(row.brand_mentioned));
    for (const item of counter(missedRows, (row) => splitList(row.competitors))) {
      const categoryCounts = counter(missedRows.filter((row) => splitList(row.competitors).includes(item.name)), (row) => [row.category]);
      const queries = missedRows
        .filter((row) => splitList(row.competitors).includes(item.name))
        .map((row) => row.query)
        .slice(0, 8);
      rows.push({
        provider: providerName(provider),
        provider_key: provider,
        competitor: item.name,
        missed_answer_count: item.count,
        categories: categoryCounts.map((entry) => `${entry.name} ${entry.count}`).join("; "),
        example_queries: queries.join("; "),
      });
    }
  }
  return rows.sort((a, b) => b.missed_answer_count - a.missed_answer_count || a.provider.localeCompare(b.provider));
}

function buildRetestRows(consensusRows, blindspotRows) {
  const byQuery = groupBy(blindspotRows, (row) => row.query);
  return top(consensusRows, "opportunity", 18).map((row, index) => {
    const blindspots = byQuery.get(row.query) || [];
    const providers = unique(blindspots.map((item) => item.provider));
    return {
      order: index + 1,
      query: row.query,
      category: row.category,
      providers_to_watch: providers.length ? providers.join("; ") : "ChatGPT; Claude; Gemini",
      baseline_stage: row.consensus_stage,
      competitors: row.competitors,
      page_title: row.page_title,
      page_url: row.page_url,
      required_edit: unique(blindspots.flatMap((item) => splitList(item.fix))).join("; "),
      success_threshold: "iBOLT mentioned by at least 2 providers, top-3 in at least 1 provider, and target page cited by at least 1 search-connected provider.",
    };
  });
}

function barSvg({ title, rows, labelKey, valueKey, maxValue, color = "#1d4ed8" }) {
  const width = 940;
  const rowHeight = 34;
  const topOffset = 56;
  const height = topOffset + rows.length * rowHeight + 24;
  const labelWidth = 370;
  const barWidth = 410;
  const max = maxValue || Math.max(1, ...rows.map((row) => num(row[valueKey])));
  const bars = rows.map((row, index) => {
    const value = num(row[valueKey]);
    const y = topOffset + index * rowHeight;
    const w = Math.max(2, Math.round((value / max) * barWidth));
    return `<text x="22" y="${y + 16}" fill="#0f172a" font-size="13">${escapeHtml(row[labelKey]).slice(0, 54)}</text>
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

function table(rows, columns) {
  const head = columns.map(([label]) => `<th>${escapeHtml(label)}</th>`).join("");
  const body = rows.map((row) => `<tr>${columns.map(([, key]) => `<td>${escapeHtml(row[key])}</td>`).join("")}</tr>`).join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function markdownTable(rows, columns) {
  return [
    `| ${columns.map(([label]) => label).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${columns.map(([, key]) => String(row[key] ?? "").replaceAll("|", "\\|")).join(" | ")} |`),
  ].join("\n");
}

function buildMarkdown({ summary, providerRows, consensusRows, competitorRows, blindspotRows, retestRows }) {
  return `# iBOLT Provider Blind Spot Report

## Bottom Line

The saved benchmark shows different failure modes by model. ChatGPT is the strongest on iBOLT mentions, but still cites iBOLT zero times. Claude and Gemini are weaker on non-branded buyer prompts, and Gemini is especially weak on top-3 recommendation placement.

Current saved run: ${summary.totalResults} answers, ${summary.mentionCount} iBOLT mentions (${summary.mentionRate}%), ${summary.topThreeCount} top-3 placements (${summary.topThreeRate}%), ${summary.citationCount} target-domain citations (${summary.citationRate}%), and ${summary.competitorOnlyCount} competitor-only answers.

## Provider Summary

${markdownTable(providerRows, [
  ["Provider", "provider"],
  ["Mention %", "mention_rate"],
  ["Top-3 %", "top_three_rate"],
  ["Citation %", "citation_rate"],
  ["Competitor-only %", "competitor_only_rate"],
  ["Top competitors", "top_competitors"],
])}

## Query Consensus Blind Spots

${markdownTable(top(consensusRows, "opportunity", 12), [
  ["Opportunity", "opportunity"],
  ["Stage", "consensus_stage"],
  ["Query", "query"],
  ["Category", "category"],
  ["Missed providers", "missed_providers"],
  ["Competitors", "competitors"],
])}

## Provider Competitor Defaults

${markdownTable(top(competitorRows, "missed_answer_count", 12), [
  ["Provider", "provider"],
  ["Competitor", "competitor"],
  ["Missed answers", "missed_answer_count"],
  ["Categories", "categories"],
])}

## First Retests After Edits

${markdownTable(retestRows.slice(0, 12), [
  ["Order", "order"],
  ["Query", "query"],
  ["Providers", "providers_to_watch"],
  ["Baseline", "baseline_stage"],
  ["Page", "page_title"],
  ["Required edit", "required_edit"],
])}
`;
}

function buildHtml({ summary, providerRows, consensusRows, competitorRows, blindspotRows, retestRows, charts }) {
  const cards = [
    ["Answers", summary.totalResults, "saved provider responses"],
    ["Mention rate", `${summary.mentionRate}%`, `${summary.mentionCount}/${summary.totalResults}`],
    ["Top-3 rate", `${summary.topThreeRate}%`, `${summary.topThreeCount}/${summary.totalResults}`],
    ["Citation rate", `${summary.citationRate}%`, `${summary.citationCount}/${summary.totalResults}`],
    ["Competitor-only", summary.competitorOnlyCount, "answers without iBOLT"],
    ["Blind-spot rows", blindspotRows.length, "provider/query fixes"],
  ].map(([label, value, note]) => `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>iBOLT Provider Blind Spot Report</title>
<style>
body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}main{max-width:1240px;margin:0 auto;padding:34px 26px 60px}h1{font-size:34px;margin:0 0 8px}h2{font-size:22px;margin:34px 0 14px}p{color:#334155;line-height:1.55}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}.k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700}.v{font-size:30px;font-weight:800;margin-top:8px}.note{border-left:6px solid #7c3aed;background:#fff;border-radius:10px;padding:16px 18px;border-top:1px solid #d7dee8;border-right:1px solid #d7dee8;border-bottom:1px solid #d7dee8}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden}th,td{text-align:left;vertical-align:top;padding:11px 12px;border-bottom:1px solid #edf2f7;font-size:14px}th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:12px;letter-spacing:.04em}.charts{display:grid;grid-template-columns:1fr;gap:18px}.chart{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:12px;overflow:auto}
</style></head><body><main>
<h1>iBOLT Provider Blind Spot Report</h1>
<p class="note"><strong>Readout:</strong> ChatGPT, Claude, and Gemini are not failing in exactly the same way. The fastest path is to fix query-level pages, then retest the same prompt one provider at a time and watch whether iBOLT moves from absent, to mentioned, to top-3, to cited.</p>
<section class="cards">${cards}</section>
<section class="charts"><div class="chart">${charts.provider}</div><div class="chart">${charts.competitor}</div></section>
<h2>Provider Summary</h2>
${table(providerRows, [
  ["Provider", "provider"],
  ["Mention %", "mention_rate"],
  ["Top-3 %", "top_three_rate"],
  ["Citation %", "citation_rate"],
  ["Competitor-only %", "competitor_only_rate"],
  ["Top competitors", "top_competitors"],
])}
<h2>Query Consensus Blind Spots</h2>
${table(top(consensusRows, "opportunity", 14), [
  ["Opportunity", "opportunity"],
  ["Stage", "consensus_stage"],
  ["Query", "query"],
  ["Category", "category"],
  ["Missed providers", "missed_providers"],
  ["Competitors", "competitors"],
  ["Page", "page_title"],
  ["Issues", "structural_issues"],
])}
<h2>Provider Competitor Defaults</h2>
${table(top(competitorRows, "missed_answer_count", 14), [
  ["Provider", "provider"],
  ["Competitor", "competitor"],
  ["Missed answers", "missed_answer_count"],
  ["Categories", "categories"],
  ["Example queries", "example_queries"],
])}
<h2>First Retests After Edits</h2>
${table(retestRows.slice(0, 14), [
  ["Order", "order"],
  ["Query", "query"],
  ["Providers", "providers_to_watch"],
  ["Baseline", "baseline_stage"],
  ["Page", "page_title"],
  ["Required edit", "required_edit"],
  ["Success threshold", "success_threshold"],
])}
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, "provider-blindspots");
  await mkdir(outDir, { recursive: true });

  const results = await readCsv(path.join(benchmarkDir, "results.csv"));
  const matrixRows = await readCsv(path.join(benchmarkDir, "query-page-matrix", "all-query-page-matrix.csv"));
  const matrixByQuery = new Map(matrixRows.map((row) => [row.query, row]));

  const providerRows = buildProviderSummary(results);
  const consensusRows = buildConsensusRows(results, matrixByQuery);
  const blindspotRows = buildBlindspotRows(results, matrixByQuery);
  const competitorRows = buildCompetitorRows(results);
  const retestRows = buildRetestRows(consensusRows, blindspotRows);
  const summary = {
    benchmarkDir,
    totalResults: results.length,
    mentionCount: results.filter((row) => bool(row.brand_mentioned)).length,
    mentionRate: pct(results.filter((row) => bool(row.brand_mentioned)).length, results.length),
    topThreeCount: results.filter((row) => row.top_pick_rank && num(row.top_pick_rank) <= 3).length,
    topThreeRate: pct(results.filter((row) => row.top_pick_rank && num(row.top_pick_rank) <= 3).length, results.length),
    citationCount: results.filter((row) => bool(row.domain_cited)).length,
    citationRate: pct(results.filter((row) => bool(row.domain_cited)).length, results.length),
    competitorOnlyCount: results.filter((row) => !bool(row.brand_mentioned) && splitList(row.competitors).length).length,
    providerRows: providerRows.length,
    consensusRows: consensusRows.length,
    blindspotRows: blindspotRows.length,
    competitorRows: competitorRows.length,
    retestRows: retestRows.length,
  };
  const charts = {
    provider: barSvg({ title: "Competitor-Only Rate By Provider", rows: providerRows, labelKey: "provider", valueKey: "competitor_only_rate", maxValue: 100, color: "#7c3aed" }),
    competitor: barSvg({ title: "Top Provider Competitor Defaults", rows: top(competitorRows, "missed_answer_count", 10), labelKey: "competitor", valueKey: "missed_answer_count", color: "#be123c" }),
  };

  await writeFile(path.join(outDir, "provider-summary.csv"), csv([
    ["provider", "provider_key", "results", "avg_score", "mention_count", "mention_rate", "top_three_count", "top_three_rate", "citation_count", "citation_rate", "competitor_only_count", "competitor_only_rate", "top_competitors"],
    ...providerRows.map((row) => [row.provider, row.provider_key, row.results, row.avg_score, row.mention_count, row.mention_rate, row.top_three_count, row.top_three_rate, row.citation_count, row.citation_rate, row.competitor_only_count, row.competitor_only_rate, row.top_competitors]),
  ]));
  await writeFile(path.join(outDir, "query-consensus-grid.csv"), csv([
    ["opportunity", "consensus_stage", "query", "category", "missed_providers", "mentioned_providers", "top_three_providers", "avg_score", "competitors", "provider_cells", "page_title", "page_url", "page_score", "structural_issues", "retest_action"],
    ...consensusRows.map((row) => [row.opportunity, row.consensus_stage, row.query, row.category, row.missed_providers, row.mentioned_providers, row.top_three_providers, row.avg_score, row.competitors, row.provider_cells, row.page_title, row.page_url, row.page_score, row.structural_issues, row.retest_action]),
  ]));
  await writeFile(path.join(outDir, "provider-blindspot-workqueue.csv"), csv([
    ["priority", "provider", "provider_key", "stage", "query", "category", "score", "brand_mentioned", "top_pick_rank", "domain_cited", "competitors", "sentiment", "page_title", "page_url", "page_score", "structural_issues", "product_module", "fix", "analysis_notes"],
    ...blindspotRows.map((row) => [row.priority, row.provider, row.provider_key, row.stage, row.query, row.category, row.score, row.brand_mentioned, row.top_pick_rank, row.domain_cited, row.competitors, row.sentiment, row.page_title, row.page_url, row.page_score, row.structural_issues, row.product_module, row.fix, row.analysis_notes]),
  ]));
  await writeFile(path.join(outDir, "provider-competitor-defaults.csv"), csv([
    ["provider", "provider_key", "competitor", "missed_answer_count", "categories", "example_queries"],
    ...competitorRows.map((row) => [row.provider, row.provider_key, row.competitor, row.missed_answer_count, row.categories, row.example_queries]),
  ]));
  await writeFile(path.join(outDir, "provider-retest-plan.csv"), csv([
    ["order", "query", "category", "providers_to_watch", "baseline_stage", "competitors", "page_title", "page_url", "required_edit", "success_threshold"],
    ...retestRows.map((row) => [row.order, row.query, row.category, row.providers_to_watch, row.baseline_stage, row.competitors, row.page_title, row.page_url, row.required_edit, row.success_threshold]),
  ]));
  await writeFile(path.join(outDir, "provider-competitor-defaults.svg"), charts.competitor);
  await writeFile(path.join(outDir, "provider-competitor-only-rate.svg"), charts.provider);
  await writeFile(path.join(outDir, "provider-blindspot-data.json"), `${JSON.stringify({ summary, providerRows, consensusRows, blindspotRows: blindspotRows.slice(0, 120), competitorRows, retestRows }, null, 2)}\n`);
  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown({ summary, providerRows, consensusRows, competitorRows, blindspotRows, retestRows }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({ summary, providerRows, consensusRows, competitorRows, blindspotRows, retestRows, charts }));

  console.log(`Wrote ${outDir}`);
  console.log(`Provider blind-spot rows: ${blindspotRows.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
