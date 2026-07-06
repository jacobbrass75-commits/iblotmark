import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_OUTPUT = "benchmark-output";
const OPENROUTER_PREFIX = "openrouter-ai-benchmark-";
const EXPANDED_PREFIX = "openrouter-expanded-ai-benchmark-";
const LIVE_AUDIT_PREFIX = "live-blog-ai-citability-merged-";

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

async function readCsvIfExists(filePath) {
  try {
    return parseCsv(await readFile(filePath, "utf8"));
  } catch {
    return [];
  }
}

async function readJsonIfExists(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function readJsonlIfExists(filePath) {
  try {
    const text = await readFile(filePath, "utf8");
    return text.trim().split(/\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function listDirs(prefix) {
  const root = path.join(process.cwd(), OUTPUT_ROOT);
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => path.join(root, entry.name))
    .sort();
}

async function latestDir(prefix) {
  const dirs = await listDirs(prefix);
  const dir = dirs.at(-1);
  if (!dir) throw new Error(`No ${prefix} directory found in ${OUTPUT_ROOT}`);
  return dir;
}

function num(value) {
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(count, total) {
  return total ? Math.round((num(count) / num(total)) * 100) : 0;
}

function avg(values) {
  const clean = values.map(num).filter((value) => Number.isFinite(value));
  return clean.length ? Math.round(clean.reduce((sum, value) => sum + value, 0) / clean.length) : 0;
}

function providerSummaries(summary) {
  return summary?.current?.run?.summary?.providerSummaries || [];
}

function runSummaryFromJson({ label, kind, filePath, summary, comparable }) {
  const current = summary.current?.run || {};
  const providers = providerSummaries(summary);
  const completed = providers.reduce((sum, row) => sum + num(row.completedCount), 0) || current.resultCount || current.queryCount || 0;
  const queryCount = current.queryCount || providers.reduce((max, row) => Math.max(max, num(row.queriesEvaluated)), 0);
  return {
    date: label,
    kind,
    source_file: filePath,
    provider_surface: current.providers?.join("; ") || providers.map((row) => row.provider).join("; "),
    query_count: queryCount,
    result_count: current.resultCount || completed,
    completed_results: completed,
    avg_score: avg(providers.map((row) => row.avgScore)),
    mention_rate: avg(providers.map((row) => row.mentionRate)),
    citation_rate: avg(providers.map((row) => row.citationRate)),
    top_three_rate: avg(providers.map((row) => row.topThreeRate)),
    comparison_available: summary.previous ? "yes" : "no",
    previous_avg_score: summary.previous ? avg((summary.previous.run?.summary?.providerSummaries || []).map((row) => row.avgScore)) : "",
    comparable,
    note: kind === "OpenRouter API" ? "Comparable across ChatGPT, Claude, and Gemini API-style consumer models; citation rate is weak because these runs did not use search-connected source retrieval." : "Older app benchmark. Citation definitions differ from OpenRouter run, so use directionally.",
  };
}

function manualGoogleRows(rows, filePath) {
  if (!rows.length) return [];
  const total = rows.length;
  const mentions = rows.filter((row) => row.brandMentioned).length;
  const citations = rows.filter((row) => row.iboltCited).length;
  const topCompetitors = new Map();
  for (const row of rows) {
    for (const competitor of row.competitors || []) {
      topCompetitors.set(competitor, (topCompetitors.get(competitor) || 0) + 1);
    }
  }
  return [{
    date: "2026-05-22",
    kind: "Manual Google AI Mode",
    source_file: filePath,
    provider_surface: "google_ai_mode_browser",
    query_count: total,
    result_count: total,
    completed_results: total,
    avg_score: "",
    mention_rate: pct(mentions, total),
    citation_rate: pct(citations, total),
    top_three_rate: "",
    comparison_available: "no",
    previous_avg_score: "",
    comparable: "search-connected only",
    note: `Manual browser capture. iBOLT mentioned ${mentions}/${total} and cited ${citations}/${total}. Top competitors: ${[...topCompetitors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => `${name} ${count}`).join("; ")}.`,
  }];
}

function manualGoogleCategoryRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const category = row.category || "unknown";
    if (!map.has(category)) map.set(category, { category, total: 0, mentions: 0, citations: 0, competitors: new Map() });
    const current = map.get(category);
    current.total += 1;
    if (row.brandMentioned) current.mentions += 1;
    if (row.iboltCited) current.citations += 1;
    for (const competitor of row.competitors || []) {
      current.competitors.set(competitor, (current.competitors.get(competitor) || 0) + 1);
    }
  }
  return [...map.values()].map((row) => ({
    category: row.category,
    queries: row.total,
    mention_rate: pct(row.mentions, row.total),
    citation_rate: pct(row.citations, row.total),
    top_competitors: [...row.competitors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => `${name} ${count}`).join("; "),
  })).sort((a, b) => b.queries - a.queries || a.category.localeCompare(b.category));
}

function auditRow(dir, audit) {
  const summary = audit.summary || {};
  return {
    snapshot: path.basename(dir).replace(LIVE_AUDIT_PREFIX, ""),
    source_dir: dir,
    total_pages: summary.total || 0,
    ok_pages: summary.ok || 0,
    failed_pages: summary.failed || 0,
    avg_score: summary.avgScore || 0,
    public_fetched: summary.publicFetched || 0,
    local_fallback: summary.localFallback || 0,
    missing_faq_schema: summary.missingFaqSchema || 0,
    missing_article_schema: summary.missingArticleSchema || 0,
    missing_quick_answer: summary.noQuickAnswer || 0,
    missing_comparison_signals: summary.noComparisonSignals || 0,
  };
}

function expandedRow(dir, prompts, manifestRows) {
  const categories = new Map();
  const sources = new Map();
  for (const row of prompts) {
    categories.set(row.category || "unknown", (categories.get(row.category || "unknown") || 0) + 1);
    sources.set(row.source || "unknown", (sources.get(row.source || "unknown") || 0) + 1);
  }
  return {
    snapshot: path.basename(dir).replace(EXPANDED_PREFIX, ""),
    source_dir: dir,
    selected_prompts: prompts.length,
    provider_requests: manifestRows.length || prompts.length * 3,
    status: "dry run only",
    top_categories: [...categories.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => `${name} ${count}`).join("; "),
    prompt_sources: [...sources.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => `${name} ${count}`).join("; "),
  };
}

function barSvg({ title, rows, labelKey, valueKey, color = "#2563eb", maxValue }) {
  const width = 980;
  const rowHeight = 42;
  const topOffset = 62;
  const height = topOffset + rows.length * rowHeight + 26;
  const labelWidth = 350;
  const barWidth = 450;
  const max = maxValue || Math.max(1, ...rows.map((row) => num(row[valueKey])));
  const bars = rows.map((row, index) => {
    const value = num(row[valueKey]);
    const y = topOffset + index * rowHeight;
    const w = Math.max(value ? 4 : 2, Math.round((value / max) * barWidth));
    return `<text x="22" y="${y + 16}" fill="#0f172a" font-size="13">${escapeHtml(row[labelKey]).slice(0, 52)}</text>
<rect x="${labelWidth}" y="${y}" width="${barWidth}" height="22" rx="4" fill="#e2e8f0"/>
<rect x="${labelWidth}" y="${y}" width="${w}" height="22" rx="4" fill="${color}"/>
<text x="${labelWidth + barWidth + 12}" y="${y + 16}" fill="#0f172a" font-size="13" font-weight="700">${escapeHtml(value)}</text>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="#ffffff"/>
<text x="22" y="38" fill="#0f172a" font-size="22" font-weight="800">${escapeHtml(title)}</text>
${bars}
</svg>`;
}

function lineSvg({ title, rows, valueKey, color = "#ea580c" }) {
  const width = 980;
  const height = 330;
  const left = 72;
  const top = 64;
  const chartW = 820;
  const chartH = 190;
  const max = Math.max(100, ...rows.map((row) => num(row[valueKey])));
  const points = rows.map((row, index) => {
    const x = left + (rows.length <= 1 ? chartW / 2 : (index / (rows.length - 1)) * chartW);
    const y = top + chartH - (num(row[valueKey]) / max) * chartH;
    return { x, y, row };
  });
  const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
  const labels = points.map((point, index) => `<circle cx="${point.x}" cy="${point.y}" r="5" fill="${color}"/>
<text x="${point.x}" y="${top + chartH + 26}" fill="#475569" font-size="11" text-anchor="middle">${index + 1}</text>
<text x="${point.x}" y="${point.y - 10}" fill="#0f172a" font-size="12" font-weight="700" text-anchor="middle">${escapeHtml(point.row[valueKey])}</text>`).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="#ffffff"/>
<text x="24" y="38" fill="#0f172a" font-size="22" font-weight="800">${escapeHtml(title)}</text>
<line x1="${left}" y1="${top + chartH}" x2="${left + chartW}" y2="${top + chartH}" stroke="#cbd5e1"/>
<line x1="${left}" y1="${top}" x2="${left}" y2="${top + chartH}" stroke="#cbd5e1"/>
<polyline points="${polyline}" fill="none" stroke="${color}" stroke-width="4"/>
${labels}
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

function buildMarkdown({ summary, runRows, manualCategoryRows, auditRows, expandedRows }) {
  return `# iBOLT AI Benchmark History And Readiness

## Bottom Line

The completed benchmark history has mixed surfaces, so it should not be read as a clean trendline. The most comparable current baseline is the June 17 OpenRouter run: ${summary.latestResultCount} saved answers across ${summary.latestQueryCount} queries and ${summary.latestProviders} providers, with ${summary.latestMentionRate}% mention rate, ${summary.latestTopThreeRate}% top-3 rate, and ${summary.latestCitationRate}% target-domain citation rate.

Search-connected/manual captures show iBOLT can be cited when Google AI Mode finds the right iBOLT pages. API-style consumer model runs still miss iBOLT heavily on generic buyer prompts. That means the next benchmark should keep the provider/query set stable and distinguish search-connected results from non-search consumer model results.

## Completed Run Ledger

${markdownTable(runRows, [
  ["Date", "date"],
  ["Kind", "kind"],
  ["Surface", "provider_surface"],
  ["Queries", "query_count"],
  ["Results", "result_count"],
  ["Mention", "mention_rate"],
  ["Citation", "citation_rate"],
  ["Top-3", "top_three_rate"],
  ["Comparable", "comparable"],
])}

## Manual Google AI Mode Category Readout

${markdownTable(manualCategoryRows, [
  ["Category", "category"],
  ["Queries", "queries"],
  ["Mention rate", "mention_rate"],
  ["Citation rate", "citation_rate"],
  ["Top competitors", "top_competitors"],
])}

## Live Blog Audit Timeline

${markdownTable(auditRows, [
  ["Snapshot", "snapshot"],
  ["Pages", "total_pages"],
  ["OK", "ok_pages"],
  ["Failed", "failed_pages"],
  ["Avg score", "avg_score"],
  ["Public", "public_fetched"],
  ["Fallback", "local_fallback"],
  ["Missing FAQ", "missing_faq_schema"],
  ["Missing quick answer", "missing_quick_answer"],
  ["Missing comparison", "missing_comparison_signals"],
])}

## Expanded Benchmark Readiness

${markdownTable(expandedRows, [
  ["Snapshot", "snapshot"],
  ["Prompts", "selected_prompts"],
  ["Provider requests", "provider_requests"],
  ["Status", "status"],
  ["Top categories", "top_categories"],
  ["Prompt sources", "prompt_sources"],
])}

## Interpretation

- Use the June 17 OpenRouter run as the stable baseline for ChatGPT, Claude, and Gemini API-style consumer models.
- Use the May 22 Google AI Mode manual capture as proof that search-connected AI can cite iBOLT when the right pages are retrievable.
- Do not blend the 70% Claude citation rate from June 11 with the June 17 OpenRouter citation rate as a direct trend. The source behavior and benchmark surface are different.
- The latest expanded benchmark is ready as a ${summary.latestExpandedPrompts}-prompt, ${summary.latestExpandedProviderRequests}-request run, but it has not executed live because the OpenRouter key is not present in this shell.
`;
}

function buildHtml({ summary, runRows, manualCategoryRows, auditRows, expandedRows, charts }) {
  const cards = [
    ["Completed run rows", summary.completedRunRows, "including manual Google AI Mode"],
    ["Latest result count", summary.latestResultCount, `${summary.latestQueryCount} queries`],
    ["Latest mention", `${summary.latestMentionRate}%`, "OpenRouter baseline"],
    ["Latest citation", `${summary.latestCitationRate}%`, "OpenRouter baseline"],
    ["Live audit snapshots", summary.liveAuditSnapshots, `${summary.latestLiveAuditAvgScore}/100 latest avg`],
    ["Expanded prompts", summary.latestExpandedPrompts, "dry-run backlog"],
  ].map(([label, value, note]) => `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>iBOLT AI Benchmark History</title>
<style>
body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}main{max-width:1240px;margin:0 auto;padding:34px 26px 60px}h1{font-size:34px;margin:0 0 8px}h2{font-size:22px;margin:34px 0 14px}p{color:#334155;line-height:1.55}.note{border-left:6px solid #2563eb;background:#fff;border-radius:10px;padding:16px 18px;border-top:1px solid #d7dee8;border-right:1px solid #d7dee8;border-bottom:1px solid #d7dee8}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}.k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700}.v{font-size:30px;font-weight:800;margin-top:8px}.charts{display:grid;grid-template-columns:1fr;gap:16px}.chart{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:12px;overflow:auto}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden}th,td{text-align:left;vertical-align:top;padding:11px 12px;border-bottom:1px solid #edf2f7;font-size:14px}th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:12px;letter-spacing:.04em}
</style></head><body><main>
<h1>iBOLT AI Benchmark History And Readiness</h1>
<p class="note"><strong>Readout:</strong> The benchmark history is useful, but the surfaces differ. The June 17 OpenRouter run is the clean current baseline. Google AI Mode manual captures prove source-connected AI can cite iBOLT, while API-style consumer models still miss iBOLT on generic buyer prompts.</p>
<section class="cards">${cards}</section>
<section class="charts"><div class="chart">${charts.runMentions}</div><div class="chart">${charts.liveAudit}</div><div class="chart">${charts.expanded}</div></section>
<h2>Completed Run Ledger</h2>
${table(runRows, [
  ["Date", "date"],
  ["Kind", "kind"],
  ["Surface", "provider_surface"],
  ["Queries", "query_count"],
  ["Results", "result_count"],
  ["Mention", "mention_rate"],
  ["Citation", "citation_rate"],
  ["Top-3", "top_three_rate"],
  ["Comparable", "comparable"],
  ["Note", "note"],
])}
<h2>Manual Google AI Mode Category Readout</h2>
${table(manualCategoryRows, [
  ["Category", "category"],
  ["Queries", "queries"],
  ["Mention rate", "mention_rate"],
  ["Citation rate", "citation_rate"],
  ["Top competitors", "top_competitors"],
])}
<h2>Live Blog Audit Timeline</h2>
${table(auditRows, [
  ["Snapshot", "snapshot"],
  ["Pages", "total_pages"],
  ["OK", "ok_pages"],
  ["Failed", "failed_pages"],
  ["Avg score", "avg_score"],
  ["Public fetched", "public_fetched"],
  ["Fallback", "local_fallback"],
  ["Missing FAQ", "missing_faq_schema"],
  ["Missing quick answer", "missing_quick_answer"],
  ["Missing comparison", "missing_comparison_signals"],
])}
<h2>Expanded Benchmark Readiness</h2>
${table(expandedRows, [
  ["Snapshot", "snapshot"],
  ["Prompts", "selected_prompts"],
  ["Provider requests", "provider_requests"],
  ["Status", "status"],
  ["Top categories", "top_categories"],
  ["Prompt sources", "prompt_sources"],
])}
</main></body></html>`;
}

async function main() {
  const latestBenchmarkDir = await latestDir(OPENROUTER_PREFIX);
  const outDir = path.join(latestBenchmarkDir, "benchmark-history");
  await mkdir(outDir, { recursive: true });

  const runRows = [];
  const june11Path = path.join(process.cwd(), OUTPUT_ROOT, "ai-benchmark-2026-06-11-12-35-36", "summary.json");
  const june11 = await readJsonIfExists(june11Path);
  if (june11) runRows.push(runSummaryFromJson({ label: "2026-06-11", kind: "App benchmark", filePath: june11Path, summary: june11, comparable: "single-provider historical" }));
  const latestPath = path.join(latestBenchmarkDir, "summary.json");
  const latest = await readJsonIfExists(latestPath);
  if (latest) {
    const latestRunRow = runSummaryFromJson({ label: "2026-06-17", kind: "OpenRouter API", filePath: latestPath, summary: latest, comparable: "current baseline" });
    const master = await readJsonIfExists(path.join(latestBenchmarkDir, "master-dossier", "master-dossier-data.json"), {});
    const evidence = master.evidenceSummary || {};
    const mention = master.mentionSummary || {};
    if (evidence.total) {
      latestRunRow.result_count = evidence.total;
      latestRunRow.completed_results = evidence.total;
      latestRunRow.mention_rate = pct(evidence.mentionCount, evidence.total);
      latestRunRow.citation_rate = pct(evidence.citationCount, evidence.total);
      latestRunRow.top_three_rate = pct(mention.topThree, evidence.total);
    }
    runRows.push(latestRunRow);
  }

  const googlePath = path.join(process.cwd(), BENCHMARK_OUTPUT, "manual-google-ai-mode-2026-05-22.jsonl");
  const googleRows = await readJsonlIfExists(googlePath);
  runRows.unshift(...manualGoogleRows(googleRows, googlePath));
  const manualCategoryRows = manualGoogleCategoryRows(googleRows);

  const auditRows = [];
  for (const dir of await listDirs(LIVE_AUDIT_PREFIX)) {
    const audit = await readJsonIfExists(path.join(dir, "live-blog-page-audit.merged.json"));
    if (audit) auditRows.push(auditRow(dir, audit));
  }

  const expandedRows = [];
  for (const dir of await listDirs(EXPANDED_PREFIX)) {
    const prompts = await readCsvIfExists(path.join(dir, "selected-prompts.csv"));
    const manifestRows = await readCsvIfExists(path.join(dir, "provider-request-manifest.csv"));
    if (prompts.length) expandedRows.push(expandedRow(dir, prompts, manifestRows));
  }

  const latestRun = runRows.find((row) => row.kind === "OpenRouter API") || {};
  const latestAudit = auditRows.at(-1) || {};
  const latestExpanded = expandedRows.at(-1) || {};
  const summary = {
    benchmarkDir: latestBenchmarkDir,
    completedRunRows: runRows.length,
    manualGoogleRows: googleRows.length,
    manualGoogleMentionRate: runRows.find((row) => row.kind === "Manual Google AI Mode")?.mention_rate || 0,
    manualGoogleCitationRate: runRows.find((row) => row.kind === "Manual Google AI Mode")?.citation_rate || 0,
    latestProviders: latestRun.provider_surface || "",
    latestQueryCount: latestRun.query_count || 0,
    latestResultCount: latestRun.result_count || 0,
    latestMentionRate: latestRun.mention_rate || 0,
    latestCitationRate: latestRun.citation_rate || 0,
    latestTopThreeRate: latestRun.top_three_rate || 0,
    liveAuditSnapshots: auditRows.length,
    latestLiveAuditAvgScore: latestAudit.avg_score || 0,
    latestLiveAuditPages: latestAudit.total_pages || 0,
    latestExpandedPrompts: latestExpanded.selected_prompts || 0,
    latestExpandedProviderRequests: latestExpanded.provider_requests || 0,
  };

  const charts = {
    runMentions: barSvg({ title: "Mention Rate By Completed Benchmark Surface", rows: runRows, labelKey: "kind", valueKey: "mention_rate", color: "#2563eb", maxValue: 100 }),
    liveAudit: lineSvg({ title: "Live Blog Avg Citability Score Over Audit Snapshots", rows: auditRows, valueKey: "avg_score", color: "#ea580c" }),
    expanded: barSvg({ title: "Expanded Benchmark Dry-Run Prompt Counts", rows: expandedRows, labelKey: "snapshot", valueKey: "selected_prompts", color: "#7c3aed" }),
  };

  await writeFile(path.join(outDir, "completed-benchmark-ledger.csv"), csv([
    ["date", "kind", "source_file", "provider_surface", "query_count", "result_count", "completed_results", "avg_score", "mention_rate", "citation_rate", "top_three_rate", "comparison_available", "previous_avg_score", "comparable", "note"],
    ...runRows.map((row) => [row.date, row.kind, row.source_file, row.provider_surface, row.query_count, row.result_count, row.completed_results, row.avg_score, row.mention_rate, row.citation_rate, row.top_three_rate, row.comparison_available, row.previous_avg_score, row.comparable, row.note]),
  ]));
  await writeFile(path.join(outDir, "manual-google-ai-mode-category-ledger.csv"), csv([
    ["category", "queries", "mention_rate", "citation_rate", "top_competitors"],
    ...manualCategoryRows.map((row) => [row.category, row.queries, row.mention_rate, row.citation_rate, row.top_competitors]),
  ]));
  await writeFile(path.join(outDir, "live-blog-audit-timeline.csv"), csv([
    ["snapshot", "source_dir", "total_pages", "ok_pages", "failed_pages", "avg_score", "public_fetched", "local_fallback", "missing_faq_schema", "missing_article_schema", "missing_quick_answer", "missing_comparison_signals"],
    ...auditRows.map((row) => [row.snapshot, row.source_dir, row.total_pages, row.ok_pages, row.failed_pages, row.avg_score, row.public_fetched, row.local_fallback, row.missing_faq_schema, row.missing_article_schema, row.missing_quick_answer, row.missing_comparison_signals]),
  ]));
  await writeFile(path.join(outDir, "expanded-benchmark-readiness.csv"), csv([
    ["snapshot", "source_dir", "selected_prompts", "provider_requests", "status", "top_categories", "prompt_sources"],
    ...expandedRows.map((row) => [row.snapshot, row.source_dir, row.selected_prompts, row.provider_requests, row.status, row.top_categories, row.prompt_sources]),
  ]));
  await writeFile(path.join(outDir, "benchmark-history-data.json"), `${JSON.stringify({ summary, runRows, manualCategoryRows, auditRows, expandedRows }, null, 2)}\n`);
  await writeFile(path.join(outDir, "benchmark-mention-rate.svg"), charts.runMentions);
  await writeFile(path.join(outDir, "live-audit-score-timeline.svg"), charts.liveAudit);
  await writeFile(path.join(outDir, "expanded-prompt-readiness.svg"), charts.expanded);
  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown({ summary, runRows, manualCategoryRows, auditRows, expandedRows }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({ summary, runRows, manualCategoryRows, auditRows, expandedRows, charts }));

  console.log(`Wrote ${outDir}`);
  console.log(`Completed run rows: ${runRows.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
