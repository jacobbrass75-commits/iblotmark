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
  const match = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  if (!match) throw new Error(`No ${prefix} directory found in ${OUTPUT_ROOT}`);
  return path.join(process.cwd(), OUTPUT_ROOT, match);
}

function num(value) {
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function countBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const value = row[key] || "unknown";
    map.set(value, (map.get(value) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function top(rows, key, count = 8) {
  return [...rows].sort((a, b) => num(b[key]) - num(a[key])).slice(0, count);
}

function barSvg({ title, rows, labelKey, valueKey, maxValue, color = "#1d4ed8" }) {
  const width = 920;
  const rowHeight = 34;
  const topOffset = 56;
  const height = topOffset + rows.length * rowHeight + 24;
  const labelWidth = 330;
  const barWidth = 460;
  const max = maxValue || Math.max(1, ...rows.map((row) => num(row[valueKey])));
  const bars = rows.map((row, index) => {
    const value = num(row[valueKey]);
    const y = topOffset + index * rowHeight;
    const w = Math.max(2, Math.round((value / max) * barWidth));
    return `<text x="22" y="${y + 16}" fill="#0f172a" font-size="13">${escapeHtml(row[labelKey]).slice(0, 48)}</text>
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

function makeMarkdown({ master, kpis, competitors, categoryRows, triageRows, pageRows, citationRows, gapRows, benchmarkDir }) {
  const evidence = master.evidenceSummary;
  const mention = master.mentionSummary;
  const triageActions = countBy(triageRows, "action");
  const firstPages = top(pageRows, "score", 8);
  const firstCompetitors = top(competitors, "pressure_score", 8);
  const firstGaps = top(gapRows, "priority", 6);
  const firstCitation = top(citationRows, "opportunity", 8);

  return `# iBOLT AI Visibility Current-State Brief

## Executive Read

iBOLT is showing up in AI answers, but not consistently enough on non-branded buyer prompts, and not yet as a cited source. The current priority is not simply publishing more blogs. The higher-leverage path is to refresh the pages AI already maps to, consolidate duplicate content, add answer-first structure, and build fair comparison language against the brands that AI already recommends.

## Current Visibility

- iBOLT mention rate: ${evidence.mentionCount}/${evidence.total} (${evidence.mentionRate}%).
- Non-branded iBOLT mention rate: ${evidence.nonBrandedMentionCount}/${evidence.nonBranded} (${evidence.nonBrandedMentionRate}%).
- Top-3 recommendation rate: ${mention.topThree}/${mention.totalAnswers} (${mention.topThreeRate}%).
- Target-domain citation rate: ${evidence.citationCount}/${evidence.total} (${evidence.citationRate}%).
- Competitor-only answers: ${mention.competitorOnlyAnswers}/${mention.totalAnswers} (${mention.competitorOnlyRate}%).
- Catalog product entity rows: ${evidence.catalogProductRows}/${evidence.total}.

## KPI Gaps

| KPI | Baseline | First target | Gap | First action |
| --- | ---: | ---: | ---: | --- |
${kpis.map((row) => `| ${row.metric} | ${row.baseline}${row.unit} | ${row.first_target}${row.unit} | ${row.gap_points} pts | ${row.first_action} |`).join("\n")}

## Who iBOLT Is Mentioned Next To Or Replaced By

| Pressure | Brand | Lost answers | Co-mentioned wins | Categories | Language patterns |
| ---: | --- | ---: | ---: | --- | --- |
${firstCompetitors.map((row) => `| ${row.pressure_score} | ${row.brand} | ${row.lost_answers} | ${row.co_mentioned_wins} | ${row.categories} | ${row.language_patterns} |`).join("\n")}

## Blog System Health

- Live pages triaged: ${triageRows.length}.
- Action lanes: ${triageActions.map(([name, count]) => `${name} (${count})`).join(", ")}.
- Biggest structure gaps: quick-answer blocks, FAQ schema, image alt text, comparison signals, Article/BlogPosting schema.
- Product spread remains thin: 187 catalog products are still unlinked from detected blog content.

| Category | Pages | Avg score | Priority refresh | Canonical merge | Duplicate consolidate | Full refresh | Schema/answer |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${categoryRows.map((row) => `| ${row.category} | ${row.pages} | ${row.avg_score} | ${row.priority_refresh} | ${row.canonical_merge_review} | ${row.duplicate_consolidate} | ${row.full_refresh} | ${row.schema_answer_refresh} |`).join("\n")}

## First Pages To Work On

| Score | Page | Action | Category | Issues |
| ---: | --- | --- | --- | --- |
${firstPages.map((row) => `| ${row.score} | [${row.title}](${row.url}) | ${row.action} | ${row.category} | ${row.issues} |`).join("\n")}

## Citation Gaps To Fix

These are the prompts where iBOLT needs source-ready page structure plus external references.

| Opportunity | Query | Category | Mention rate | Competitors |
| ---: | --- | --- | ---: | --- |
${firstCitation.map((row) => `| ${row.opportunity} | ${row.query} | ${row.category} | ${row.mention_rate}% | ${row.competitors} |`).join("\n")}

## Net-New Content Comes After Cleanup

Build these as clustered hubs or comparison sections after duplicate cleanup and first-wave refreshes.

| Priority | Brief | Category | Prompts | Action |
| ---: | --- | --- | ---: | --- |
${firstGaps.map((row) => `| ${row.priority} | ${row.title} | ${row.category} | ${row.prompt_count} | ${row.action} |`).join("\n")}

## 30-Day Action Plan

1. Week 1: Resolve duplicate/canonical pages and refresh the top 6 editor-brief pages.
2. Week 2: Add quick-answer blocks, visible FAQs, FAQPage schema, and Article/BlogPosting schema to the highest-impact pages.
3. Week 3: Add fair comparison sections against RAM Mounts, Arkon, iOttie, ProClip, Mount-It, Garmin, Humminbird, Scotty, Lowrance, and YakAttack.
4. Week 4: Retest the mapped prompts on ChatGPT, Claude, and Gemini, then update the scorecard and boss brief.

## What To Offload

- SEO contractor: third-party mentions, backlinks, partner references, external comparison citations, schema validation checks, and PR-style entity mentions.
- Jacob/app: page refreshes, product modules, internal links, Shopify-ready structure, FAQ/schema generation, and benchmark retesting.
- Katie/marketing: approve competitor comparison tone, canonical page decisions, and any claims language before publishing.

## Source Reports

- Visibility scorecard: ${path.join(benchmarkDir, "visibility-scorecard", "REPORT.html")}
- Answer context dossier: ${path.join(benchmarkDir, "answer-context-dossier", "REPORT.html")}
- Live blog triage: ${path.join(benchmarkDir, "live-blog-triage", "REPORT.html")}
- Page editor pack: ${path.join(benchmarkDir, "page-editor-pack", "REPORT.html")}
- Goal audit: ${path.join(benchmarkDir, "goal-audit", "REPORT.html")}
`;
}

function makeHtml({ master, kpis, competitors, categoryRows, triageRows, pageRows, citationRows, gapRows, benchmarkDir }) {
  const evidence = master.evidenceSummary;
  const mention = master.mentionSummary;
  const cards = [
    ["Mention rate", `${evidence.mentionRate}%`, `${evidence.mentionCount}/${evidence.total}`],
    ["Non-branded", `${evidence.nonBrandedMentionRate}%`, `${evidence.nonBrandedMentionCount}/${evidence.nonBranded}`],
    ["Top-3 rate", `${mention.topThreeRate}%`, `${mention.topThree}/${mention.totalAnswers}`],
    ["Citation rate", `${evidence.citationRate}%`, `${evidence.citationCount}/${evidence.total}`],
    ["Live pages", triageRows.length, "triaged"],
    ["Competitor-only", `${mention.competitorOnlyRate}%`, `${mention.competitorOnlyAnswers}/${mention.totalAnswers}`],
  ].map(([label, value, note]) => `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");

  const kpiRows = kpis.map((row) => `<tr><td>${escapeHtml(row.metric)}</td><td>${escapeHtml(row.baseline)}${escapeHtml(row.unit)}</td><td>${escapeHtml(row.first_target)}${escapeHtml(row.unit)}</td><td>${escapeHtml(row.gap_points)} pts</td><td>${escapeHtml(row.first_action)}</td></tr>`).join("");
  const compRows = top(competitors, "pressure_score", 8).map((row) => `<tr><td>${escapeHtml(row.pressure_score)}</td><td>${escapeHtml(row.brand)}</td><td>${escapeHtml(row.lost_answers)}</td><td>${escapeHtml(row.co_mentioned_wins)}</td><td>${escapeHtml(row.categories)}</td></tr>`).join("");
  const categoryTable = categoryRows.map((row) => `<tr><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.pages)}</td><td>${escapeHtml(row.avg_score)}</td><td>${escapeHtml(row.priority_refresh)}</td><td>${escapeHtml(row.canonical_merge_review)}</td><td>${escapeHtml(row.duplicate_consolidate)}</td><td>${escapeHtml(row.full_refresh)}</td><td>${escapeHtml(row.schema_answer_refresh)}</td></tr>`).join("");
  const pageTable = top(pageRows, "score", 8).map((row) => `<tr><td>${escapeHtml(row.score)}</td><td><a href="${escapeHtml(row.url)}">${escapeHtml(row.title)}</a></td><td>${escapeHtml(row.action)}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.issues)}</td></tr>`).join("");
  const citationTable = top(citationRows, "opportunity", 8).map((row) => `<tr><td>${escapeHtml(row.opportunity)}</td><td>${escapeHtml(row.query)}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.mention_rate)}%</td><td>${escapeHtml(row.competitors)}</td></tr>`).join("");
  const gapTable = top(gapRows, "priority", 6).map((row) => `<tr><td>${escapeHtml(row.priority)}</td><td>${escapeHtml(row.title)}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.prompt_count)}</td><td>${escapeHtml(row.action)}</td></tr>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>iBOLT AI Visibility Current-State Brief</title>
<style>
body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}main{max-width:1240px;margin:0 auto;padding:34px 24px 70px}h1{font-size:36px;margin:0 0 8px}h2{font-size:22px;margin:34px 0 12px}p,li{color:#334155;line-height:1.55}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid #d9e2ef;border-radius:12px;padding:16px}.k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700}.v{font-size:30px;font-weight:800;margin-top:8px}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d9e2ef;border-radius:12px;overflow:hidden;margin-bottom:22px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #edf2f7;padding:10px 11px;font-size:14px}th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:12px;letter-spacing:.04em}a{color:#1d4ed8}.note{background:#fff7ed;border-left:6px solid #f97316;border-radius:10px;padding:14px 16px;border-top:1px solid #fed7aa;border-right:1px solid #fed7aa;border-bottom:1px solid #fed7aa}.charts{display:grid;grid-template-columns:1fr 1fr;gap:14px}.chart{background:#fff;border:1px solid #d9e2ef;border-radius:12px;padding:8px;overflow:auto}
</style></head><body><main>
<h1>iBOLT AI Visibility Current-State Brief</h1>
<p class="note">iBOLT is visible in AI answers, but it is not yet consistently recommended on non-branded prompts and is not being cited as a source. The practical next step is page cleanup, comparison positioning, schema, and external citation work.</p>
<section class="cards">${cards}</section>
<section class="charts">
<div class="chart"><img src="brief-kpi-gap.svg" alt="KPI gap chart"/></div>
<div class="chart"><img src="brief-competitor-pressure.svg" alt="Competitor pressure chart"/></div>
</section>
<h2>KPI Gaps</h2><table><thead><tr><th>KPI</th><th>Baseline</th><th>Target</th><th>Gap</th><th>First action</th></tr></thead><tbody>${kpiRows}</tbody></table>
<h2>Competitor Context</h2><table><thead><tr><th>Pressure</th><th>Brand</th><th>Lost answers</th><th>Co-mentioned wins</th><th>Categories</th></tr></thead><tbody>${compRows}</tbody></table>
<h2>Blog System Health</h2><table><thead><tr><th>Category</th><th>Pages</th><th>Avg</th><th>Priority</th><th>Canonical</th><th>Duplicate</th><th>Full</th><th>Schema</th></tr></thead><tbody>${categoryTable}</tbody></table>
<h2>First Pages To Work On</h2><table><thead><tr><th>Score</th><th>Page</th><th>Action</th><th>Category</th><th>Issues</th></tr></thead><tbody>${pageTable}</tbody></table>
<h2>Citation Gaps</h2><table><thead><tr><th>Opportunity</th><th>Query</th><th>Category</th><th>Mention</th><th>Competitors</th></tr></thead><tbody>${citationTable}</tbody></table>
<h2>Net-New Content After Cleanup</h2><table><thead><tr><th>Priority</th><th>Brief</th><th>Category</th><th>Prompts</th><th>Action</th></tr></thead><tbody>${gapTable}</tbody></table>
<h2>30-Day Action Plan</h2>
<ol><li>Resolve duplicate and canonical pages, then refresh the top editor-brief pages.</li><li>Add quick-answer blocks, visible FAQs, FAQPage schema, Article/BlogPosting schema, and product alt text.</li><li>Add fair comparison sections against the brands AI already recommends.</li><li>Retest mapped prompts on ChatGPT, Claude, and Gemini, then update the scorecard.</li></ol>
<h2>Offload Plan</h2>
<ul><li><strong>SEO contractor:</strong> third-party mentions, backlinks, external citations, partner references, schema validation checks.</li><li><strong>Jacob/app:</strong> Shopify page refreshes, product modules, internal linking, schema generation, benchmark retesting.</li><li><strong>Katie/marketing:</strong> approve competitor comparison tone, canonical decisions, and claims language.</li></ul>
<p>Benchmark folder: <code>${escapeHtml(benchmarkDir)}</code></p>
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, "current-state-brief");
  await mkdir(outDir, { recursive: true });

  const master = await readJson(path.join(benchmarkDir, "master-dossier", "master-dossier-data.json"));
  const kpis = await readCsv(path.join(benchmarkDir, "visibility-scorecard", "visibility-kpi-scorecard.csv"));
  const competitors = await readCsv(path.join(benchmarkDir, "answer-context-dossier", "competitor-context-scorecard.csv"));
  const categoryRows = await readCsv(path.join(benchmarkDir, "live-blog-triage", "category-triage-summary.csv"));
  const triageRows = await readCsv(path.join(benchmarkDir, "live-blog-triage", "all-live-blog-triage.csv"));
  const pageRows = await readCsv(path.join(benchmarkDir, "page-editor-pack", "editor-brief-index.csv"));
  const citationRows = await readCsv(path.join(benchmarkDir, "citation-strategy", "citation-query-gaps.csv"));
  const gapRows = await readCsv(path.join(benchmarkDir, "content-gap-briefs", "content-gap-briefs.csv"));
  const triageByUrl = new Map(triageRows.map((row) => [row.url, row]));
  const enrichedPageRows = pageRows.map((row) => {
    const triage = triageByUrl.get(row.url);
    return {
      ...row,
      action: triage?.action || (row.duplicate_risk === "yes" ? "canonical merge review" : "editor refresh"),
    };
  });

  await writeFile(path.join(outDir, "brief-kpi-gap.svg"), barSvg({
    title: "Gap To First KPI Target",
    rows: kpis.map((row) => ({ label: row.metric, value: row.gap_points })),
    labelKey: "label",
    valueKey: "value",
    maxValue: 20,
    color: "#dc2626",
  }));
  await writeFile(path.join(outDir, "brief-competitor-pressure.svg"), barSvg({
    title: "Competitor Pressure",
    rows: top(competitors, "pressure_score", 10).map((row) => ({ label: row.brand, value: row.pressure_score })),
    labelKey: "label",
    valueKey: "value",
    color: "#7c3aed",
  }));
  await writeFile(path.join(outDir, "brief-source-links.csv"), csv([
    ["artifact", "path"],
    ["visibility scorecard", path.join(benchmarkDir, "visibility-scorecard", "REPORT.html")],
    ["answer context dossier", path.join(benchmarkDir, "answer-context-dossier", "REPORT.html")],
    ["live blog triage", path.join(benchmarkDir, "live-blog-triage", "REPORT.html")],
    ["page editor pack", path.join(benchmarkDir, "page-editor-pack", "REPORT.html")],
    ["goal audit", path.join(benchmarkDir, "goal-audit", "REPORT.html")],
  ]));
  await writeFile(path.join(outDir, "REPORT.md"), makeMarkdown({
    master,
    kpis,
    competitors,
    categoryRows,
    triageRows,
    pageRows: enrichedPageRows,
    citationRows,
    gapRows,
    benchmarkDir,
  }));
  await writeFile(path.join(outDir, "REPORT.html"), makeHtml({
    master,
    kpis,
    competitors,
    categoryRows,
    triageRows,
    pageRows: enrichedPageRows,
    citationRows,
    gapRows,
    benchmarkDir,
  }));
  console.log(`Wrote ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
