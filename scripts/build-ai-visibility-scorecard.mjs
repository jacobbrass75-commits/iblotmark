import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";
const AUDIT_PREFIX = "live-blog-ai-citability-merged-";

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

function pct(numerator, denominator) {
  return denominator ? Math.round((num(numerator) / num(denominator)) * 100) : 0;
}

function avg(values) {
  const nums = values.map(num).filter((value) => Number.isFinite(value));
  return nums.length ? Math.round(nums.reduce((sum, value) => sum + value, 0) / nums.length) : 0;
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function topList(values, limit = 5) {
  const counts = new Map();
  for (const value of values.flatMap(splitList)) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => `${name} ${count}`)
    .join("; ");
}

function firstTarget(value) {
  const match = String(value ?? "").match(/\d+/);
  return match ? match[0] : "";
}

function svgBarChart({ title, rows, labelKey, valueKey, outOf = 100, color = "#1d4ed8" }) {
  const width = 940;
  const rowHeight = 34;
  const top = 58;
  const height = top + rows.length * rowHeight + 30;
  const labelWidth = 300;
  const barWidth = 520;
  const max = Math.max(outOf, ...rows.map((row) => num(row[valueKey])));
  const bars = rows.map((row, index) => {
    const y = top + index * rowHeight;
    const value = num(row[valueKey]);
    const w = Math.max(2, Math.round((value / max) * barWidth));
    return `<text x="24" y="${y + 18}" font-size="13" fill="#0f172a">${escapeHtml(row[labelKey]).slice(0, 42)}</text>
<rect x="${labelWidth}" y="${y}" width="${barWidth}" height="20" fill="#e2e8f0" rx="4"/>
<rect x="${labelWidth}" y="${y}" width="${w}" height="20" fill="${color}" rx="4"/>
<text x="${labelWidth + barWidth + 14}" y="${y + 15}" font-size="13" font-weight="700" fill="#0f172a">${escapeHtml(value)}</text>`;
  }).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="#ffffff"/>
<text x="24" y="34" font-size="22" font-weight="800" fill="#0f172a">${escapeHtml(title)}</text>
${bars}
</svg>`;
}

function makeKpis(master, liveSummary, targets) {
  const evidence = master.evidenceSummary;
  const mention = master.mentionSummary;
  const targetByMetric = new Map(targets.map((row) => [row.metric, row]));
  const target = (metric) => firstTarget(targetByMetric.get(metric)?.first_target);
  return [
    {
      metric: "All-prompt iBOLT mention rate",
      baseline: evidence.mentionRate,
      target: target("All-prompt iBOLT mention rate") || 35,
      gap: Math.max(0, (num(target("All-prompt iBOLT mention rate")) || 35) - evidence.mentionRate),
      unit: "%",
      evidence: `${evidence.mentionCount}/${evidence.total}`,
      owner: "Jacob/app",
      action: "Refresh high-opportunity pages with query-exact answer blocks and named product modules.",
    },
    {
      metric: "Non-branded iBOLT mention rate",
      baseline: evidence.nonBrandedMentionRate,
      target: target("Non-branded iBOLT mention rate") || 15,
      gap: Math.max(0, (num(target("Non-branded iBOLT mention rate")) || 15) - evidence.nonBrandedMentionRate),
      unit: "%",
      evidence: `${evidence.nonBrandedMentionCount}/${evidence.nonBranded}`,
      owner: "Jacob/app plus SEO contractor",
      action: "Add competitor-adjacent comparison language and earn third-party mentions.",
    },
    {
      metric: "Top-3 recommendation rate",
      baseline: mention.topThreeRate,
      target: target("Top-3 recommendation rate") || 25,
      gap: Math.max(0, (num(target("Top-3 recommendation rate")) || 25) - mention.topThreeRate),
      unit: "%",
      evidence: `${mention.topThree}/${mention.totalAnswers}`,
      owner: "Jacob/app",
      action: "Make pages state when iBOLT is the specialist choice versus broad alternatives.",
    },
    {
      metric: "Target-domain citation rate",
      baseline: evidence.citationRate,
      target: 5,
      gap: 5 - evidence.citationRate,
      unit: "%",
      evidence: `${evidence.citationCount}/${evidence.total}`,
      owner: "SEO contractor plus Jacob/app",
      action: "Pair schema and source-ready answer blocks with external citations to iBOLT pages.",
    },
    {
      metric: "Average live page citability score",
      baseline: liveSummary.avgScore,
      target: target("Average live page citability score") || 82,
      gap: Math.max(0, (num(target("Average live page citability score")) || 82) - liveSummary.avgScore),
      unit: "/100",
      evidence: `${liveSummary.ok}/${liveSummary.total} pages audited`,
      owner: "Jacob/app",
      action: "Batch-add FAQ schema, quick answers, Article schema, comparison blocks, and image alt text.",
    },
    {
      metric: "Actual catalog product entity rows",
      baseline: pct(evidence.catalogProductRows, evidence.total),
      target: 22,
      gap: Math.max(0, 22 - pct(evidence.catalogProductRows, evidence.total)),
      unit: "%",
      evidence: `${evidence.catalogProductRows}/${evidence.total}`,
      owner: "Jacob/app",
      action: "Use exact product titles, handles, image alt text, and compatibility notes in refreshed posts.",
    },
  ];
}

function makeCategoryRows(queryRows, providerRows, liveSummary) {
  const byCategory = new Map();
  for (const row of queryRows) {
    const category = row.category || "unknown";
    const current = byCategory.get(category) ?? [];
    current.push(row);
    byCategory.set(category, current);
  }

  const providerByCategory = new Map();
  for (const row of providerRows) {
    const current = providerByCategory.get(row.category) ?? [];
    current.push(row);
    providerByCategory.set(row.category, current);
  }

  const liveByCategory = new Map((liveSummary.categories ?? []).map((row) => [row.category, row]));
  return [...byCategory.entries()].map(([category, rows]) => {
    const provider = providerByCategory.get(category) ?? [];
    const live = liveByCategory.get(category) ?? {};
    const top = [...rows].sort((a, b) => num(b.opportunity_score) - num(a.opportunity_score))[0] ?? {};
    const priorityScore = Math.round(
      avg(rows.map((row) => row.opportunity_score)) +
      (100 - avg(rows.map((row) => row.mention_rate))) * 0.35 +
      avg(rows.map((row) => row.competitor_only_answers)) * 3 +
      Math.max(0, 82 - num(live.avgScore || 0)) * 0.4
    );
    return {
      category,
      priorityScore,
      prompts: rows.length,
      avgOpportunity: avg(rows.map((row) => row.opportunity_score)),
      avgAiScore: avg(rows.map((row) => row.ai_score)),
      avgMentionRate: avg(rows.map((row) => row.mention_rate)),
      competitorPressure: rows.reduce((sum, row) => sum + num(row.competitor_only_answers), 0),
      topCompetitors: topList(rows.map((row) => row.competitors), 7),
      weakestProviders: topList(rows.map((row) => row.weakest_providers), 3) || topList(provider.map((row) => row.provider), 3),
      avgLiveScore: num(live.avgScore) || avg(rows.map((row) => row.page_score)),
      topPrompt: top.prompt,
      action: top.recommended_action || "Refresh the closest page with answer-first sections and product modules.",
    };
  }).sort((a, b) => b.priorityScore - a.priorityScore);
}

function makePageRows(pageRows, queryRows) {
  const promptByUrl = new Map();
  for (const row of queryRows) {
    if (!row.page_url) continue;
    const current = promptByUrl.get(row.page_url) ?? [];
    current.push(row.prompt);
    promptByUrl.set(row.page_url, current);
  }

  return pageRows.map((row) => {
    const issues = splitList(row.issues);
    const evidencePrompts = splitList(row.query_prompts);
    const benchmarkPenalty = Math.max(0, 25 - num(row.benchmark_avg_score));
    const issueWeight = issues.length * 8;
    const duplicateWeight = row.duplicate_risk === "yes" ? 20 : 0;
    const pageScoreWeight = Math.max(0, 85 - num(row.page_score));
    const score = Math.round(num(row.priority) + benchmarkPenalty + issueWeight + duplicateWeight + pageScoreWeight);
    return {
      score,
      rank: row.rank,
      pageTitle: row.page_title,
      category: row.category,
      pageUrl: row.page_url,
      duplicateRisk: row.duplicate_risk,
      benchmarkAvgScore: row.benchmark_avg_score,
      pageScore: row.page_score,
      issues: row.issues,
      competitors: row.competitors,
      productsToAdd: row.products_to_add,
      promptCount: evidencePrompts.length || (promptByUrl.get(row.page_url)?.length ?? 0),
      quickAnswerSeed: row.quick_answer_seed,
      retestAction: row.retest_action,
    };
  }).sort((a, b) => b.score - a.score);
}

function makeCitationRows(citationRows) {
  return citationRows
    .map((row) => ({
      opportunity: num(row.opportunity),
      query: row.query,
      category: row.category,
      avgScore: row.avg_score,
      mentionRate: row.mention_rate,
      competitors: row.competitors,
      action: row.recommended_action,
    }))
    .sort((a, b) => b.opportunity - a.opportunity);
}

function makeCompetitorRows(rows) {
  return rows
    .map((row) => ({
      brand: row.brand,
      type: row.type || "competitor",
      answerCount: num(row.answer_count || row.answers),
      withoutIbolt: num(row.without_ibolt),
      coMentionRate: num(row.co_mention_rate),
      categories: row.categories,
      lostPrompts: row.lost_prompts,
      pagesToRefresh: row.pages_to_refresh,
      counterPositioning: row.counter_positioning,
      pressureScore: num(row.without_ibolt) + Math.max(0, 50 - num(row.co_mention_rate)),
    }))
    .sort((a, b) => b.pressureScore - a.pressureScore);
}

function makeMarkdown({ kpis, categoryRows, pageRows, citationRows, competitorRows, contentGapRows, master, liveSummary, benchmarkDir, auditDir }) {
  const evidence = master.evidenceSummary;
  const nextPages = pageRows.slice(0, 8);
  const nextCategories = categoryRows.slice(0, 8);
  const nextCompetitors = competitorRows.slice(0, 8);
  const nextGaps = contentGapRows.slice(0, 8);

  return `# AI Visibility Scorecard

This scorecard consolidates the saved AI benchmark, live blog audit, competitor matrix, citation strategy, and content gap brief data into one action view.

## Executive Read

- iBOLT is visible, but not dominant: ${evidence.mentionCount}/${evidence.total} answers mention iBOLT.
- The serious gap is non-branded discovery: ${evidence.nonBrandedMentionCount}/${evidence.nonBranded} non-branded answers mention iBOLT.
- Citation authority is currently the weakest KPI: ${evidence.citationCount}/${evidence.total} answers cite the target domain.
- Competitors are still owning broad buyer prompts: ${master.mentionSummary.competitorOnlyAnswers}/${master.mentionSummary.totalAnswers} answers are competitor-only.
- Page readiness is workable but incomplete: ${liveSummary.avgScore}/100 average citability across ${liveSummary.ok}/${liveSummary.total} live pages.

## KPI Scorecard

| KPI | Baseline | First target | Gap | Evidence | Owner | First action |
| --- | ---: | ---: | ---: | --- | --- | --- |
${kpis.map((row) => `| ${row.metric} | ${row.baseline}${row.unit} | ${row.target}${row.unit} | ${row.gap} pts | ${row.evidence} | ${row.owner} | ${row.action} |`).join("\n")}

## Highest Priority Areas

| Priority | Category | Prompts | Avg opportunity | Mention rate | Competitor pressure | Live score | Top prompt | Competitors |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
${nextCategories.map((row) => `| ${row.priorityScore} | ${row.category} | ${row.prompts} | ${row.avgOpportunity} | ${row.avgMentionRate}% | ${row.competitorPressure} | ${row.avgLiveScore} | ${row.topPrompt} | ${row.topCompetitors} |`).join("\n")}

## First Pages To Refresh

| Score | Page | Category | Benchmark score | Page score | Issues | Competitors | Retest |
| ---: | --- | --- | ---: | ---: | --- | --- | --- |
${nextPages.map((row) => `| ${row.score} | [${row.pageTitle}](${row.pageUrl}) | ${row.category} | ${row.benchmarkAvgScore} | ${row.pageScore} | ${row.issues} | ${row.competitors} | ${row.retestAction} |`).join("\n")}

## Citation Gaps

| Opportunity | Query | Category | Mention rate | Competitors | Action |
| ---: | --- | --- | ---: | --- | --- |
${citationRows.slice(0, 10).map((row) => `| ${row.opportunity} | ${row.query} | ${row.category} | ${row.mentionRate}% | ${row.competitors} | ${row.action} |`).join("\n")}

## Competitor Adjacency

| Pressure | Brand | Type | Answers | Without iBOLT | Co-mention rate | Counter-positioning |
| ---: | --- | --- | ---: | ---: | ---: | --- |
${nextCompetitors.map((row) => `| ${row.pressureScore} | ${row.brand} | ${row.type} | ${row.answerCount} | ${row.withoutIbolt} | ${row.coMentionRate}% | ${row.counterPositioning} |`).join("\n")}

## Net-New Content Gaps

These should come after canonical cleanup and first-wave refreshes, so we do not create more duplicate content.

| Priority | Title | Category | Prompts | Requests | Action |
| ---: | --- | --- | ---: | ---: | --- |
${nextGaps.map((row) => `| ${row.priority} | ${row.title} | ${row.category} | ${row.prompt_count} | ${row.provider_request_count} | ${row.action} |`).join("\n")}

## Source Evidence

- Benchmark folder: ${benchmarkDir}
- Live audit folder: ${auditDir}
- Citation and visibility executive brief: ../citation-visibility-executive-brief/REPORT.html
- Next benchmark runbook: ../next-benchmark-runbook/REPORT.html
- Post-run comparison analyzer: ../post-run-comparison/REPORT.html
- Mention environment dossier: ../mention-environment-dossier/REPORT.html
- Competitor comparison dossier: ../competitor-comparison-dossier/REPORT.html
- Portfolio product spread analysis: ../portfolio-product-spread-analysis/REPORT.html
- This report should be rerun after the expanded live benchmark finishes.
`;
}

function makeHtml({ kpis, categoryRows, pageRows, citationRows, competitorRows, contentGapRows, master, liveSummary, benchmarkDir }) {
  const evidence = master.evidenceSummary;
  const cardData = [
    ["Mention rate", `${evidence.mentionRate}%`, `${evidence.mentionCount}/${evidence.total}`],
    ["Non-branded", `${evidence.nonBrandedMentionRate}%`, `${evidence.nonBrandedMentionCount}/${evidence.nonBranded}`],
    ["Citation rate", `${evidence.citationRate}%`, `${evidence.citationCount}/${evidence.total}`],
    ["Competitor-only", `${master.mentionSummary.competitorOnlyRate}%`, `${master.mentionSummary.competitorOnlyAnswers}/${master.mentionSummary.totalAnswers}`],
    ["Live citability", `${liveSummary.avgScore}/100`, `${liveSummary.ok}/${liveSummary.total} pages`],
    ["Content gaps", contentGapRows.length, "clustered briefs"],
  ].map(([label, value, note]) => `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");

  const kpiRows = kpis.map((row) => `<tr><td>${escapeHtml(row.metric)}</td><td>${row.baseline}${escapeHtml(row.unit)}</td><td>${row.target}${escapeHtml(row.unit)}</td><td>${row.gap} pts</td><td>${escapeHtml(row.action)}</td></tr>`).join("");
  const categoryTable = categoryRows.slice(0, 10).map((row) => `<tr><td>${row.priorityScore}</td><td>${escapeHtml(row.category)}</td><td>${row.prompts}</td><td>${row.avgMentionRate}%</td><td>${row.competitorPressure}</td><td>${escapeHtml(row.topPrompt)}</td><td>${escapeHtml(row.topCompetitors)}</td></tr>`).join("");
  const pageTable = pageRows.slice(0, 10).map((row) => `<tr><td>${row.score}</td><td><a href="${escapeHtml(row.pageUrl)}">${escapeHtml(row.pageTitle)}</a></td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.issues)}</td><td>${escapeHtml(row.competitors)}</td></tr>`).join("");
  const competitorTable = competitorRows.slice(0, 10).map((row) => `<tr><td>${row.pressureScore}</td><td>${escapeHtml(row.brand)}</td><td>${escapeHtml(row.type)}</td><td>${row.answerCount}</td><td>${row.withoutIbolt}</td><td>${row.coMentionRate}%</td><td>${escapeHtml(row.counterPositioning)}</td></tr>`).join("");
  const citationTable = citationRows.slice(0, 10).map((row) => `<tr><td>${row.opportunity}</td><td>${escapeHtml(row.query)}</td><td>${escapeHtml(row.category)}</td><td>${row.mentionRate}%</td><td>${escapeHtml(row.competitors)}</td></tr>`).join("");
  const gapTable = contentGapRows.slice(0, 10).map((row) => `<tr><td>${escapeHtml(row.priority)}</td><td>${escapeHtml(row.title)}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.prompt_count)}</td><td>${escapeHtml(row.action)}</td></tr>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>iBOLT AI Visibility Scorecard</title>
<style>
body{margin:0;background:#f8fafc;color:#0f172a;font-family:Arial,Helvetica,sans-serif}main{max-width:1240px;margin:0 auto;padding:34px 24px 70px}h1{font-size:36px;margin:0 0 8px}h2{font-size:22px;margin:34px 0 12px}p{color:#334155;line-height:1.55}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid #d9e2ef;border-radius:12px;padding:16px}.k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700}.v{font-size:30px;font-weight:800;margin-top:8px}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d9e2ef;border-radius:12px;overflow:hidden;margin-bottom:20px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #edf2f7;padding:10px 11px;font-size:14px}th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:12px;letter-spacing:.04em}.charts{display:grid;grid-template-columns:1fr 1fr;gap:14px}.chart{background:#fff;border:1px solid #d9e2ef;border-radius:12px;padding:8px;overflow:auto}a{color:#1d4ed8}.note{background:#fff7ed;border-left:6px solid #f97316;border-radius:10px;padding:14px 16px;border-top:1px solid #fed7aa;border-right:1px solid #fed7aa;border-bottom:1px solid #fed7aa}
</style></head><body><main>
<h1>iBOLT AI Visibility Scorecard</h1>
<p class="note">This is the consolidated action view from the saved AI benchmark, live blog audit, competitor matrix, citation strategy, and content gap briefs. Rerun it after the expanded benchmark is executed.</p>
<section class="cards">${cardData}</section>
<h2>KPI Scorecard</h2><table><thead><tr><th>KPI</th><th>Baseline</th><th>Target</th><th>Gap</th><th>First action</th></tr></thead><tbody>${kpiRows}</tbody></table>
<section class="charts">
<div class="chart"><img src="kpi-gap.svg" alt="KPI gap chart"/></div>
<div class="chart"><img src="category-priority.svg" alt="Category priority chart"/></div>
<div class="chart"><img src="competitor-pressure.svg" alt="Competitor pressure chart"/></div>
<div class="chart"><img src="page-refresh-score.svg" alt="Page refresh score chart"/></div>
</section>
<h2>Highest Priority Areas</h2><table><thead><tr><th>Priority</th><th>Category</th><th>Prompts</th><th>Mention</th><th>Pressure</th><th>Top prompt</th><th>Competitors</th></tr></thead><tbody>${categoryTable}</tbody></table>
<h2>First Pages To Refresh</h2><table><thead><tr><th>Score</th><th>Page</th><th>Category</th><th>Issues</th><th>Competitors</th></tr></thead><tbody>${pageTable}</tbody></table>
<h2>Citation Gaps</h2><table><thead><tr><th>Opportunity</th><th>Query</th><th>Category</th><th>Mention</th><th>Competitors</th></tr></thead><tbody>${citationTable}</tbody></table>
<h2>Competitor Adjacency</h2><table><thead><tr><th>Pressure</th><th>Brand</th><th>Type</th><th>Answers</th><th>Without iBOLT</th><th>Co-mention</th><th>Counter-positioning</th></tr></thead><tbody>${competitorTable}</tbody></table>
<h2>Net-New Content Gaps</h2><table><thead><tr><th>Priority</th><th>Title</th><th>Category</th><th>Prompts</th><th>Action</th></tr></thead><tbody>${gapTable}</tbody></table>
<h2>Source Evidence</h2>
<p><a href="../citation-visibility-executive-brief/REPORT.html">Citation And Visibility Executive Brief</a> gives the boss-ready answer on citation rate, current visibility health, page-before-outreach sequence, and ownership split.</p>
<p><a href="../next-benchmark-runbook/REPORT.html">Next Benchmark Runbook</a> provides W1-W5 provider manifests, dry-run commands, live commands, and output checks for the next retest.</p>
<p><a href="../post-run-comparison/REPORT.html">Post-Run Comparison Analyzer</a> converts the newest completed expanded run into baseline-vs-current KPI deltas and provider/category gap rows.</p>
<p><a href="../mention-environment-dossier/REPORT.html">Mention Environment Dossier</a> shows who iBOLT appears beside, who replaces iBOLT, provider/category pressure pockets, and the page countermove queue.</p>
<p><a href="../competitor-comparison-dossier/REPORT.html">Competitor Comparison Dossier</a> shows unique replacement rows, brand-level replacement occurrences, co-mentions, provider/category pressure, and exact page battlecards.</p>
<p><a href="../portfolio-product-spread-analysis/REPORT.html">Portfolio Product Spread Analysis</a> shows all-blog page queues, product-family spread, category gaps, and refresh-vs-net-new content decisions.</p>
<p>Benchmark folder: <code>${escapeHtml(benchmarkDir)}</code></p>
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const auditDir = await latestDir(AUDIT_PREFIX);
  const outDir = path.join(benchmarkDir, "visibility-scorecard");
  await mkdir(outDir, { recursive: true });

  const master = await readJson(path.join(benchmarkDir, "master-dossier", "master-dossier-data.json"));
  const live = await readJson(path.join(auditDir, "live-blog-page-audit.merged.json"));
  const queryRows = await readCsv(path.join(benchmarkDir, "competitive-matrix", "query-opportunity-matrix.csv"));
  const providerRows = await readCsv(path.join(benchmarkDir, "mention-landscape", "provider-category-scorecard.csv"));
  const pageRefreshRows = await readCsv(path.join(benchmarkDir, "page-refresh-playbook", "page-refresh-briefs.csv"));
  const citationRows = await readCsv(path.join(benchmarkDir, "citation-strategy", "citation-query-gaps.csv"));
  const competitorRows = await readCsv(path.join(benchmarkDir, "competitive-matrix", "competitor-battlecards.csv"));
  const contentGapRows = await readCsv(path.join(benchmarkDir, "content-gap-briefs", "content-gap-briefs.csv"));
  const targetRows = await readCsv(path.join(benchmarkDir, "visibility-growth-dashboard", "kpi-targets.csv"));

  const kpis = makeKpis(master, live.summary, targetRows);
  const categoryScorecard = makeCategoryRows(queryRows, providerRows, live.summary);
  const pageScorecard = makePageRows(pageRefreshRows, queryRows);
  const citationScorecard = makeCitationRows(citationRows);
  const competitorScorecard = makeCompetitorRows(competitorRows);
  const contentGapScorecard = contentGapRows.sort((a, b) => num(b.priority) - num(a.priority));

  await writeFile(path.join(outDir, "visibility-kpi-scorecard.csv"), toCsv([
    ["metric", "baseline", "unit", "first_target", "gap_points", "evidence", "owner", "first_action"],
    ...kpis.map((row) => [row.metric, row.baseline, row.unit, row.target, row.gap, row.evidence, row.owner, row.action]),
  ]));
  await writeFile(path.join(outDir, "category-priority-scorecard.csv"), toCsv([
    ["priority_score", "category", "prompts", "avg_opportunity", "avg_ai_score", "avg_mention_rate", "competitor_pressure", "avg_live_score", "weakest_providers", "top_prompt", "top_competitors", "action"],
    ...categoryScorecard.map((row) => [row.priorityScore, row.category, row.prompts, row.avgOpportunity, row.avgAiScore, row.avgMentionRate, row.competitorPressure, row.avgLiveScore, row.weakestProviders, row.topPrompt, row.topCompetitors, row.action]),
  ]));
  await writeFile(path.join(outDir, "top-page-refresh-scorecard.csv"), toCsv([
    ["score", "rank", "page_title", "category", "page_url", "duplicate_risk", "benchmark_avg_score", "page_score", "issues", "competitors", "products_to_add", "prompt_count", "quick_answer_seed", "retest_action"],
    ...pageScorecard.map((row) => [row.score, row.rank, row.pageTitle, row.category, row.pageUrl, row.duplicateRisk, row.benchmarkAvgScore, row.pageScore, row.issues, row.competitors, row.productsToAdd, row.promptCount, row.quickAnswerSeed, row.retestAction]),
  ]));
  await writeFile(path.join(outDir, "citation-gap-scorecard.csv"), toCsv([
    ["opportunity", "query", "category", "avg_score", "mention_rate", "competitors", "action"],
    ...citationScorecard.map((row) => [row.opportunity, row.query, row.category, row.avgScore, row.mentionRate, row.competitors, row.action]),
  ]));
  await writeFile(path.join(outDir, "competitor-adjacency-scorecard.csv"), toCsv([
    ["pressure_score", "brand", "type", "answer_count", "without_ibolt", "co_mention_rate", "categories", "lost_prompts", "pages_to_refresh", "counter_positioning"],
    ...competitorScorecard.map((row) => [row.pressureScore, row.brand, row.type, row.answerCount, row.withoutIbolt, row.coMentionRate, row.categories, row.lostPrompts, row.pagesToRefresh, row.counterPositioning]),
  ]));

  await writeFile(path.join(outDir, "kpi-gap.svg"), svgBarChart({
    title: "KPI Gap To First Target",
    rows: kpis.map((row) => ({ label: row.metric, value: row.gap })),
    labelKey: "label",
    valueKey: "value",
    outOf: 40,
    color: "#dc2626",
  }));
  await writeFile(path.join(outDir, "category-priority.svg"), svgBarChart({
    title: "Category Priority Score",
    rows: categoryScorecard.slice(0, 10).map((row) => ({ label: row.category, value: row.priorityScore })),
    labelKey: "label",
    valueKey: "value",
    outOf: 160,
    color: "#2563eb",
  }));
  await writeFile(path.join(outDir, "competitor-pressure.svg"), svgBarChart({
    title: "Competitor Pressure",
    rows: competitorScorecard.slice(0, 10).map((row) => ({ label: row.brand, value: row.pressureScore })),
    labelKey: "label",
    valueKey: "value",
    outOf: 120,
    color: "#7c3aed",
  }));
  await writeFile(path.join(outDir, "page-refresh-score.svg"), svgBarChart({
    title: "First Pages To Refresh",
    rows: pageScorecard.slice(0, 10).map((row) => ({ label: row.pageTitle, value: row.score })),
    labelKey: "label",
    valueKey: "value",
    outOf: 420,
    color: "#059669",
  }));

  await writeFile(path.join(outDir, "REPORT.md"), makeMarkdown({
    kpis,
    categoryRows: categoryScorecard,
    pageRows: pageScorecard,
    citationRows: citationScorecard,
    competitorRows: competitorScorecard,
    contentGapRows: contentGapScorecard,
    master,
    liveSummary: live.summary,
    benchmarkDir,
    auditDir,
  }));
  await writeFile(path.join(outDir, "REPORT.html"), makeHtml({
    kpis,
    categoryRows: categoryScorecard,
    pageRows: pageScorecard,
    citationRows: citationScorecard,
    competitorRows: competitorScorecard,
    contentGapRows: contentGapScorecard,
    master,
    liveSummary: live.summary,
    benchmarkDir,
  }));

  console.log(`Wrote ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
