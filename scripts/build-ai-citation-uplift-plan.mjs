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

function writeCsv(rows) {
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
  return parseCsv(await readFile(filePath, "utf8"));
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

function pct(count, total) {
  if (!total) return 0;
  return Math.round((count / total) * 100);
}

function top(rows, key, count = 8) {
  return [...rows].sort((a, b) => num(b[key]) - num(a[key])).slice(0, count);
}

function countWhere(rows, predicate) {
  return rows.reduce((count, row) => count + (predicate(row) ? 1 : 0), 0);
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstSentence(text) {
  const cleaned = String(text ?? "").replace(/\s+/g, " ").trim();
  const match = cleaned.match(/^(.+?[.!?])\s/);
  return (match ? match[1] : cleaned).slice(0, 220);
}

function barSvg({ title, rows, labelKey, valueKey, maxValue, color = "#1d4ed8" }) {
  const width = 920;
  const rowHeight = 34;
  const topOffset = 56;
  const height = topOffset + rows.length * rowHeight + 24;
  const labelWidth = 350;
  const barWidth = 420;
  const max = maxValue || Math.max(1, ...rows.map((row) => num(row[valueKey])));
  const bars = rows.map((row, index) => {
    const value = num(row[valueKey]);
    const y = topOffset + index * rowHeight;
    const w = Math.max(2, Math.round((value / max) * barWidth));
    return `<text x="22" y="${y + 16}" fill="#0f172a" font-size="13">${escapeHtml(row[labelKey]).slice(0, 52)}</text>
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

function makeMarkdown({
  master,
  pageQueue,
  queryGaps,
  workstreams,
  competitors,
  topicGuidance,
  triageRows,
  retestRows,
  contractorRows,
  pageRows,
  benchmarkDir,
}) {
  const evidence = master.evidenceSummary;
  const mention = master.mentionSummary;
  const missingQuickAnswer = countWhere(triageRows, (row) => row.has_quick_answer === "false");
  const missingFaq = countWhere(triageRows, (row) => row.has_faq_schema === "false");
  const missingArticleSchema = countWhere(triageRows, (row) => row.has_article_schema === "false" && row.has_blogposting_schema === "false");
  const missingAlt = countWhere(triageRows, (row) => num(row.missing_alt) > 0);
  const missingComparison = countWhere(triageRows, (row) => row.has_comparison_signals === "false");

  return `# iBOLT Citation And Competitor Uplift Plan

## Bottom Line

Yes, citation rate should go up, but it is not an isolated SEO task. The current benchmark has ${evidence.citationCount}/${evidence.total} target-domain citations (${evidence.citationRate}%), while iBOLT is mentioned in only ${evidence.nonBrandedMentionCount}/${evidence.nonBranded} non-branded buyer answers (${evidence.nonBrandedMentionRate}%). The practical sequence is: get mentioned, get recommended, then get cited.

## Visibility Funnel

| Stage | Current | Rate | First target | What has to change |
| --- | ---: | ---: | ---: | --- |
| Total tested answers | ${evidence.total} | 100% | 100% | Keep the benchmark prompt set stable enough for before/after reads. |
| iBOLT mentioned | ${evidence.mentionCount} | ${evidence.mentionRate}% | 35% | Add query-exact answer blocks and named iBOLT product modules. |
| Non-branded iBOLT mentions | ${evidence.nonBrandedMentionCount} | ${evidence.nonBrandedMentionRate}% | 15% | Win buyer prompts where no one typed iBOLT. |
| Top-3 recommendations | ${mention.topThree} | ${mention.topThreeRate}% | 25% | Say when iBOLT is the specialist choice against broad alternatives. |
| Target-domain citations | ${evidence.citationCount} | ${evidence.citationRate}% | 5% | Make pages source-ready and earn external citation signals. |

## On-Site Citation Readiness Gaps

Across ${triageRows.length} live blog pages:

- ${missingQuickAnswer} pages are missing quick-answer blocks.
- ${missingFaq} pages are missing FAQ schema.
- ${missingArticleSchema} pages are missing Article/BlogPosting schema.
- ${missingAlt} pages have at least one image missing alt text.
- ${missingComparison} pages are missing comparison signals.

These are the main on-site reasons a page can rank or exist but still be weak as an AI answer source.

Brand-safety note: several competitor answers use budget/value language. Treat that as buyer intent to answer, not as iBOLT positioning to copy. iBOLT should stay framed as the specialist, modular, industrial-grade choice.

## First Pages To Refresh For Citation Lift

| Priority | Page | Category | Prompts | Competitors | Fixes |
| ---: | --- | --- | --- | --- | --- |
${top(pageQueue, "priority", 10).map((row) => `| ${row.priority} | [${row.title}](${row.url}) | ${row.category} | ${row.prompts} | ${row.competitors} | ${row.fixes} |`).join("\n")}

## First Queries To Retest

| Opportunity | Query | Category | Baseline iBOLT mention | Competitors | Action |
| ---: | --- | --- | ---: | --- | --- |
${top(queryGaps, "opportunity", 10).map((row) => `| ${row.opportunity} | ${row.query} | ${row.category} | ${row.mention_rate}% | ${row.competitors} | ${row.recommended_action} |`).join("\n")}

## Competitor Displacement Targets

| Pressure | Brand | Lost answers | Co-mentioned wins | Where they appear | What to write against |
| ---: | --- | ---: | ---: | --- | --- |
${top(competitors, "pressure_score", 10).map((row) => `| ${row.pressure_score} | ${row.brand} | ${row.lost_answers} | ${row.co_mentioned_wins} | ${row.categories} | ${row.language_patterns} |`).join("\n")}

## Topic Messaging

| Topic | Mention rate | Top competitors | First action |
| --- | ---: | --- | --- |
${topicGuidance.map((row) => `| ${row.topic} | ${row.mention_rate}% | ${row.top_competitors} | ${row.first_action} |`).join("\n")}

## Offload To SEO Contractor

The contractor should focus on external signals that the app cannot create inside Shopify.

| Priority | Category/brand | Target | Why | Success metric |
| ---: | --- | --- | --- | --- |
${contractorRows.map((row) => `| ${row.priority} | ${row.category_or_brand} | ${row.target} | ${row.why} | ${row.success_metric} |`).join("\n")}

## App Workstream

| Priority | Page/query | Owner | Action | Retest metric |
| ---: | --- | --- | --- | --- |
${pageRows.map((row) => `| ${row.priority} | ${row.page_or_query} | ${row.owner} | ${row.action} | ${row.retest_metric} |`).join("\n")}

## Workstreams

| Priority | Owner | Workstream | Action | Success metric |
| ---: | --- | --- | --- | --- |
${workstreams.map((row) => `| ${row.priority} | ${row.owner} | ${row.workstream} | ${row.action} | ${row.success_metric} |`).join("\n")}

## Source Reports

- Citation strategy: ${path.join(benchmarkDir, "citation-strategy", "REPORT.html")}
- Answer context dossier: ${path.join(benchmarkDir, "answer-context-dossier", "REPORT.html")}
- Live blog triage: ${path.join(benchmarkDir, "live-blog-triage", "REPORT.html")}
- Current-state brief: ${path.join(benchmarkDir, "current-state-brief", "REPORT.html")}
`;
}

function makeHtml({
  master,
  pageQueue,
  queryGaps,
  workstreams,
  competitors,
  topicGuidance,
  triageRows,
  contractorRows,
  pageRows,
  benchmarkDir,
}) {
  const evidence = master.evidenceSummary;
  const mention = master.mentionSummary;
  const missingQuickAnswer = countWhere(triageRows, (row) => row.has_quick_answer === "false");
  const missingFaq = countWhere(triageRows, (row) => row.has_faq_schema === "false");
  const missingArticleSchema = countWhere(triageRows, (row) => row.has_article_schema === "false" && row.has_blogposting_schema === "false");
  const missingAlt = countWhere(triageRows, (row) => num(row.missing_alt) > 0);
  const missingComparison = countWhere(triageRows, (row) => row.has_comparison_signals === "false");

  const cards = [
    ["iBOLT mention rate", `${evidence.mentionRate}%`, `${evidence.mentionCount}/${evidence.total}`],
    ["Non-branded mention rate", `${evidence.nonBrandedMentionRate}%`, `${evidence.nonBrandedMentionCount}/${evidence.nonBranded}`],
    ["Top-3 recommendation rate", `${mention.topThreeRate}%`, `${mention.topThree}/${mention.totalAnswers}`],
    ["Target citation rate", `${evidence.citationRate}%`, `${evidence.citationCount}/${evidence.total}`],
    ["Competitor-only answers", `${mention.competitorOnlyRate}%`, `${mention.competitorOnlyAnswers}/${mention.totalAnswers}`],
    ["Live pages audited", triageRows.length, "Shopify blog pages"],
  ].map(([label, value, note]) => `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");

  const gapRows = [
    ["Missing quick answers", missingQuickAnswer],
    ["Missing FAQ schema", missingFaq],
    ["Images missing alt text", missingAlt],
    ["Missing comparison signals", missingComparison],
    ["Missing Article/BlogPosting", missingArticleSchema],
  ].map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`).join("");

  const pageTable = top(pageQueue, "priority", 10).map((row) => `<tr><td>${escapeHtml(row.priority)}</td><td><a href="${escapeHtml(row.url)}">${escapeHtml(row.title)}</a></td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.prompts)}</td><td>${escapeHtml(row.competitors)}</td><td>${escapeHtml(row.fixes)}</td></tr>`).join("");
  const queryTable = top(queryGaps, "opportunity", 10).map((row) => `<tr><td>${escapeHtml(row.opportunity)}</td><td>${escapeHtml(row.query)}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.mention_rate)}%</td><td>${escapeHtml(row.competitors)}</td><td>${escapeHtml(row.recommended_action)}</td></tr>`).join("");
  const competitorTable = top(competitors, "pressure_score", 10).map((row) => `<tr><td>${escapeHtml(row.pressure_score)}</td><td>${escapeHtml(row.brand)}</td><td>${escapeHtml(row.lost_answers)}</td><td>${escapeHtml(row.co_mentioned_wins)}</td><td>${escapeHtml(row.categories)}</td><td>${escapeHtml(row.language_patterns)}</td></tr>`).join("");
  const topicTable = topicGuidance.map((row) => `<tr><td>${escapeHtml(row.topic)}</td><td>${escapeHtml(row.mention_rate)}%</td><td>${escapeHtml(row.top_competitors)}</td><td>${escapeHtml(row.first_action)}</td></tr>`).join("");
  const contractorTable = contractorRows.map((row) => `<tr><td>${escapeHtml(row.priority)}</td><td>${escapeHtml(row.category_or_brand)}</td><td>${escapeHtml(row.target)}</td><td>${escapeHtml(row.why)}</td><td>${escapeHtml(row.success_metric)}</td></tr>`).join("");
  const appTable = pageRows.map((row) => `<tr><td>${escapeHtml(row.priority)}</td><td>${escapeHtml(row.page_or_query)}</td><td>${escapeHtml(row.owner)}</td><td>${escapeHtml(row.action)}</td><td>${escapeHtml(row.retest_metric)}</td></tr>`).join("");
  const workstreamTable = workstreams.map((row) => `<tr><td>${escapeHtml(row.priority)}</td><td>${escapeHtml(row.owner)}</td><td>${escapeHtml(row.workstream)}</td><td>${escapeHtml(row.action)}</td><td>${escapeHtml(row.success_metric)}</td></tr>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>iBOLT Citation And Competitor Uplift Plan</title>
<style>
body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}main{max-width:1240px;margin:0 auto;padding:34px 24px 70px}h1{font-size:36px;margin:0 0 8px}h2{font-size:22px;margin:34px 0 12px}p,li{color:#334155;line-height:1.55}.note{background:#fff7ed;border:1px solid #fed7aa;border-left:6px solid #f97316;border-radius:10px;padding:14px 16px}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid #d9e2ef;border-radius:12px;padding:16px}.k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700}.v{font-size:30px;font-weight:800;margin-top:8px}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d9e2ef;border-radius:12px;overflow:hidden;margin-bottom:22px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #edf2f7;padding:10px 11px;font-size:14px}th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:12px;letter-spacing:.04em}a{color:#1d4ed8}.charts{display:grid;grid-template-columns:1fr 1fr;gap:14px}.chart{background:#fff;border:1px solid #d9e2ef;border-radius:12px;padding:8px;overflow:auto}
</style></head><body><main>
<h1>iBOLT Citation And Competitor Uplift Plan</h1>
<p class="note">Citation rate should rise, but it depends on upstream visibility. The first target is to move iBOLT from ${evidence.nonBrandedMentionRate}% to 15%+ non-branded mentions, then from ${evidence.citationRate}% to 5% target-domain citations.</p>
<section class="cards">${cards}</section>
<section class="charts">
<div class="chart"><img src="citation-funnel.svg" alt="Citation funnel"/></div>
<div class="chart"><img src="onsite-citation-gaps.svg" alt="On-site citation gaps"/></div>
</section>
<h2>On-Site Citation Readiness Gaps</h2><table><thead><tr><th>Gap</th><th>Pages</th></tr></thead><tbody>${gapRows}</tbody></table>
<p class="note"><strong>Brand-safety note:</strong> competitor answers often use budget/value language. Treat that as buyer intent, not iBOLT positioning. iBOLT should stay framed as the specialist, modular, industrial-grade choice.</p>
<h2>First Pages To Refresh For Citation Lift</h2><table><thead><tr><th>Priority</th><th>Page</th><th>Category</th><th>Prompts</th><th>Competitors</th><th>Fixes</th></tr></thead><tbody>${pageTable}</tbody></table>
<h2>First Queries To Retest</h2><table><thead><tr><th>Opportunity</th><th>Query</th><th>Category</th><th>Mention</th><th>Competitors</th><th>Action</th></tr></thead><tbody>${queryTable}</tbody></table>
<h2>Competitor Displacement Targets</h2><table><thead><tr><th>Pressure</th><th>Brand</th><th>Lost</th><th>Co-mentioned</th><th>Where</th><th>Language</th></tr></thead><tbody>${competitorTable}</tbody></table>
<h2>Topic Messaging</h2><table><thead><tr><th>Topic</th><th>Mention</th><th>Top competitors</th><th>First action</th></tr></thead><tbody>${topicTable}</tbody></table>
<h2>Offload To SEO Contractor</h2><table><thead><tr><th>Priority</th><th>Category/brand</th><th>Target</th><th>Why</th><th>Success metric</th></tr></thead><tbody>${contractorTable}</tbody></table>
<h2>App Workstream</h2><table><thead><tr><th>Priority</th><th>Page/query</th><th>Owner</th><th>Action</th><th>Retest metric</th></tr></thead><tbody>${appTable}</tbody></table>
<h2>Workstreams</h2><table><thead><tr><th>Priority</th><th>Owner</th><th>Workstream</th><th>Action</th><th>Success metric</th></tr></thead><tbody>${workstreamTable}</tbody></table>
<p>Benchmark folder: <code>${escapeHtml(benchmarkDir)}</code></p>
</main></body></html>`;
}

function buildContractorRows({ competitors, topicGuidance }) {
  const topicRows = top(topicGuidance, "miss_count", 5).map((row, index) => [
    index + 1,
    row.topic,
    "Third-party buyer guides, industry roundups, association/resource pages, and partner pages.",
    `${row.topic} answers still miss iBOLT ${row.miss_count} times and mention competitors such as ${row.top_competitors}.`,
    `At least 3 relevant external mentions linking to the best matching iBOLT page, then retest ${row.topic} prompts.`,
  ]);

  const competitorRows = top(competitors, "pressure_score", 5).map((row, index) => [
    topicRows.length + index + 1,
    row.brand,
    "External comparison citations and neutral category pages where this brand is already recommended.",
    `${row.brand} replaces or appears without iBOLT in ${row.lost_answers} answers.`,
    `Reduce ${row.brand} competitor-only rows and add at least one co-mention win in the next comparable benchmark.`,
  ]);

  return [["priority", "category_or_brand", "target", "why", "success_metric"], ...topicRows, ...competitorRows];
}

function buildAppRows({ pageQueue, queryGaps, topicGuidance }) {
  const pageRows = top(pageQueue, "priority", 8).map((row, index) => [
    index + 1,
    row.title,
    "Jacob/app",
    `Add quick answer, FAQ/schema, comparison block, product module, and image alt text for: ${row.prompts}.`,
    `Mapped query mention rate improves and page citability score moves above 82.`,
  ]);

  const queryRows = top(queryGaps, "opportunity", 6).map((row, index) => [
    pageRows.length + index + 1,
    row.query,
    "Jacob/app",
    `Make the target page answer this exact prompt and name the iBOLT product or product family before competitor discussion.`,
    `Prompt moves from ${row.mention_rate}% mention to at least one iBOLT mention across ChatGPT, Claude, or Gemini.`,
  ]);

  const topicRows = top(topicGuidance, "miss_count", 4).map((row, index) => [
    pageRows.length + queryRows.length + index + 1,
    row.topic,
    "Jacob/app",
    row.first_action,
    `${row.topic} mention rate improves from ${row.mention_rate}% on the next benchmark.`,
  ]);

  return [["priority", "page_or_query", "owner", "action", "retest_metric"], ...pageRows, ...queryRows, ...topicRows];
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, "citation-uplift-plan");
  await mkdir(outDir, { recursive: true });

  const master = await readJson(path.join(benchmarkDir, "master-dossier", "master-dossier-data.json"));
  const pageQueue = await readCsv(path.join(benchmarkDir, "citation-strategy", "citation-page-refresh-queue.csv"));
  const queryGaps = await readCsv(path.join(benchmarkDir, "citation-strategy", "citation-query-gaps.csv"));
  const workstreams = await readCsv(path.join(benchmarkDir, "citation-strategy", "citation-workstreams.csv"));
  const competitors = await readCsv(path.join(benchmarkDir, "answer-context-dossier", "competitor-context-scorecard.csv"));
  const topicGuidance = await readCsv(path.join(benchmarkDir, "mention-context-playbook", "topic-messaging-guidance.csv"));
  const triageRows = await readCsv(path.join(benchmarkDir, "live-blog-triage", "all-live-blog-triage.csv"));
  const lostRows = await readCsv(path.join(benchmarkDir, "answer-context-dossier", "lost-answer-language.csv"));

  const contractorTable = buildContractorRows({ competitors, topicGuidance });
  const appTable = buildAppRows({ pageQueue, queryGaps, topicGuidance });
  const contractorRows = contractorTable.slice(1).map(([priority, category_or_brand, target, why, success_metric]) => ({
    priority,
    category_or_brand,
    target,
    why,
    success_metric,
  }));
  const pageRows = appTable.slice(1).map(([priority, page_or_query, owner, action, retest_metric]) => ({
    priority,
    page_or_query,
    owner,
    action,
    retest_metric,
  }));
  const retestRows = top(queryGaps, "opportunity", 25).map((row) => [
    row.opportunity,
    row.query,
    row.category,
    row.mention_rate,
    row.competitors,
    row.recommended_action,
    pageQueue.find((page) => splitList(page.prompts).includes(row.query))?.url || "",
  ]);
  const competitorBriefRows = top(competitors, "pressure_score", 14).map((row) => [
    row.pressure_score,
    row.brand,
    row.lost_answers,
    row.co_mentioned_wins,
    row.categories,
    row.language_patterns,
    firstSentence(row.example_snippets),
  ]);

  const evidence = master.evidenceSummary;
  const mention = master.mentionSummary;
  const funnelRows = [
    { label: "Total answers", value: evidence.total },
    { label: "iBOLT mentions", value: evidence.mentionCount },
    { label: "Top-3 recommendations", value: mention.topThree },
    { label: "Target-domain citations", value: evidence.citationCount },
  ];
  const gapRows = [
    { label: "Missing quick answers", value: countWhere(triageRows, (row) => row.has_quick_answer === "false") },
    { label: "Missing FAQ schema", value: countWhere(triageRows, (row) => row.has_faq_schema === "false") },
    { label: "Images missing alt text", value: countWhere(triageRows, (row) => num(row.missing_alt) > 0) },
    { label: "Missing comparisons", value: countWhere(triageRows, (row) => row.has_comparison_signals === "false") },
    { label: "Missing Article/BlogPosting", value: countWhere(triageRows, (row) => row.has_article_schema === "false" && row.has_blogposting_schema === "false") },
  ];

  await writeFile(path.join(outDir, "citation-funnel.svg"), barSvg({
    title: "AI Visibility To Citation Funnel",
    rows: funnelRows,
    labelKey: "label",
    valueKey: "value",
    maxValue: evidence.total,
    color: "#2563eb",
  }));
  await writeFile(path.join(outDir, "onsite-citation-gaps.svg"), barSvg({
    title: "On-Site Citation Readiness Gaps",
    rows: gapRows,
    labelKey: "label",
    valueKey: "value",
    maxValue: triageRows.length,
    color: "#f97316",
  }));
  await writeFile(path.join(outDir, "competitor-pressure.svg"), barSvg({
    title: "Competitor Pressure In Lost Answers",
    rows: top(competitors, "pressure_score", 10).map((row) => ({ label: row.brand, value: row.pressure_score })),
    labelKey: "label",
    valueKey: "value",
    color: "#7c3aed",
  }));

  await writeFile(path.join(outDir, "contractor-citation-offload.csv"), writeCsv(contractorTable));
  await writeFile(path.join(outDir, "app-citation-workplan.csv"), writeCsv(appTable));
  await writeFile(path.join(outDir, "prompt-retest-queue.csv"), writeCsv([
    ["opportunity", "query", "category", "baseline_mention_rate", "competitors", "recommended_action", "mapped_page_url"],
    ...retestRows,
  ]));
  await writeFile(path.join(outDir, "competitor-displacement-briefs.csv"), writeCsv([
    ["pressure_score", "brand", "lost_answers", "co_mentioned_wins", "categories", "language_patterns", "example_snippet"],
    ...competitorBriefRows,
  ]));
  await writeFile(path.join(outDir, "citation-uplift-data.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    benchmarkDir,
    funnel: {
      totalAnswers: evidence.total,
      mentionCount: evidence.mentionCount,
      mentionRate: evidence.mentionRate,
      nonBrandedMentionCount: evidence.nonBrandedMentionCount,
      nonBrandedMentionRate: evidence.nonBrandedMentionRate,
      topThreeCount: mention.topThree,
      topThreeRate: mention.topThreeRate,
      citationCount: evidence.citationCount,
      citationRate: evidence.citationRate,
      competitorOnlyAnswers: mention.competitorOnlyAnswers,
      competitorOnlyRate: mention.competitorOnlyRate,
    },
    onsiteGaps: Object.fromEntries(gapRows.map((row) => [row.label, row.value])),
    pageQueueCount: pageQueue.length,
    queryGapCount: queryGaps.length,
    lostAnswerCount: lostRows.length,
    firstTargets: {
      nonBrandedMentionRate: 15,
      topThreeRecommendationRate: 25,
      citationRate: 5,
      livePageCitabilityScore: 82,
    },
    brandSafetyNote: "Do not copy budget/value positioning from competitor answers. Use it only as buyer intent context; keep iBOLT positioned as specialist, modular, and industrial-grade.",
  }, null, 2));

  const reportInput = {
    master,
    pageQueue,
    queryGaps,
    workstreams,
    competitors,
    topicGuidance,
    triageRows,
    retestRows,
    contractorRows,
    pageRows,
    benchmarkDir,
  };
  await writeFile(path.join(outDir, "REPORT.md"), makeMarkdown(reportInput));
  await writeFile(path.join(outDir, "REPORT.html"), makeHtml(reportInput));

  console.log(`Wrote ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
