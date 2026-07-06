#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";
const REPORT_DIR = "visibility-kpi-retest-ladder";

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
      if (row.some((value) => String(value ?? "").trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell.length || row.length) row.push(cell);
  if (row.length && row.some((value) => String(value ?? "").trim())) rows.push(row);
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

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function latestDir(prefix) {
  const root = path.join(process.cwd(), OUTPUT_ROOT);
  const entries = await readdir(root, { withFileTypes: true });
  const name = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  if (!name) throw new Error(`No ${prefix} directory found in ${OUTPUT_ROOT}.`);
  return path.join(root, name);
}

function num(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const match = String(value ?? "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function targetCount(rate, total) {
  return Math.ceil((num(rate) / 100) * total);
}

function byMetric(rows, metric) {
  return rows.find((row) => row.metric === metric) || {};
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function short(value, length = 115) {
  const text = String(value ?? "");
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function top(rows, key, count = 10) {
  return [...rows].sort((a, b) => num(b[key]) - num(a[key]) || String(a.category || a.intent || a.wave).localeCompare(String(b.category || b.intent || b.wave))).slice(0, count);
}

function buildKpiRows({ master, dashboard }) {
  const evidence = master.evidenceSummary || {};
  const mentionTarget = num(byMetric(dashboard, "Mention rate").target || 35);
  const nonBrandedTarget = num(byMetric(dashboard, "Non-branded mention").target || 15);
  const topThreeTarget = num(byMetric(dashboard, "Top-3 recommendation").target || 25);
  const citationTarget = num(byMetric(dashboard, "Citation rate").target || 8);
  const competitorTarget = 55;
  const total = num(evidence.total) || 93;
  const nonBrandedTotal = num(evidence.nonBranded) || 75;

  return [
    {
      metric: "Mention rate",
      current_rate: pct(num(evidence.mentionCount), total),
      current_count: num(evidence.mentionCount),
      denominator: total,
      target_rate: mentionTarget,
      target_count: targetCount(mentionTarget, total),
      lift_needed: Math.max(0, targetCount(mentionTarget, total) - num(evidence.mentionCount)),
      why_it_matters: "Baseline inclusion. AI cannot cite or recommend iBOLT if it does not mention iBOLT first.",
    },
    {
      metric: "Non-branded mention",
      current_rate: pct(num(evidence.nonBrandedMentionCount), nonBrandedTotal),
      current_count: num(evidence.nonBrandedMentionCount),
      denominator: nonBrandedTotal,
      target_rate: nonBrandedTarget,
      target_count: targetCount(nonBrandedTarget, nonBrandedTotal),
      lift_needed: Math.max(0, targetCount(nonBrandedTarget, nonBrandedTotal) - num(evidence.nonBrandedMentionCount)),
      why_it_matters: "New-customer visibility. These are buyer questions that do not already name iBOLT.",
    },
    {
      metric: "Top-3 recommendation",
      current_rate: pct(num(master.mentionSummary?.topThree), total),
      current_count: num(master.mentionSummary?.topThree),
      denominator: total,
      target_rate: topThreeTarget,
      target_count: targetCount(topThreeTarget, total),
      lift_needed: Math.max(0, targetCount(topThreeTarget, total) - num(master.mentionSummary?.topThree)),
      why_it_matters: "Recommendation strength. Mentioned at the bottom is weaker than included in the recommendation set.",
    },
    {
      metric: "Citation rate",
      current_rate: pct(num(evidence.citationCount), total),
      current_count: num(evidence.citationCount),
      denominator: total,
      target_rate: citationTarget,
      target_count: targetCount(citationTarget, total),
      lift_needed: Math.max(0, targetCount(citationTarget, total) - num(evidence.citationCount)),
      why_it_matters: "Source trust for search-connected AI, AI Overviews, Perplexity, Gemini with search, and shopping assistants.",
    },
    {
      metric: "Competitor-only answer rate",
      current_rate: pct(num(master.mentionSummary?.competitorOnlyAnswers || evidence.competitorOnlyRows), total),
      current_count: num(master.mentionSummary?.competitorOnlyAnswers || evidence.competitorOnlyRows),
      denominator: total,
      target_rate: competitorTarget,
      target_count: targetCount(competitorTarget, total),
      lift_needed: Math.max(0, num(master.mentionSummary?.competitorOnlyAnswers || evidence.competitorOnlyRows) - targetCount(competitorTarget, total)),
      why_it_matters: "Displacement. This should go down as mention and top-3 rates rise.",
    },
  ];
}

function buildWaveRows(batchRows) {
  return batchRows.map((row) => {
    const requests = num(row.requests);
    const metric = String(row.success_metric || "");
    const isCitation = /citation|source-url/i.test(metric);
    const isProduct = /product|entity|alias/i.test(metric);
    const requiredMentions = isCitation || isProduct ? "" : Math.ceil(requests * 0.35);
    const requiredTop3 = isCitation || isProduct ? "" : Math.ceil(requests * 0.25);
    const maxCompetitorOnly = isCitation || isProduct ? "" : Math.floor(requests * 0.55);
    const requiredCitations = isCitation ? Math.max(2, Math.ceil(requests * 0.1)) : "";
    const requiredExactProducts = isProduct ? Math.ceil(requests * 0.35) : "";
    return {
      batch_id: row.batch_id,
      wave: row.wave,
      requests,
      unique_prompts: num(row.unique_prompts),
      pages: num(row.pages),
      providers: row.providers,
      categories: row.categories,
      prerequisite: row.prerequisite,
      success_metric: row.success_metric,
      required_mentions: requiredMentions,
      required_top3: requiredTop3,
      max_competitor_only: maxCompetitorOnly,
      required_citations: requiredCitations,
      required_exact_products: requiredExactProducts,
      pass_gate:
        isCitation
          ? `At least ${requiredCitations} target-domain citations or source-url rows.`
          : isProduct
            ? `At least ${requiredExactProducts} exact iBOLT product/entity mentions without hallucinated aliases.`
            : `At least ${requiredMentions} iBOLT-included answers, at least ${requiredTop3} top-3 answers, and no more than ${maxCompetitorOnly} competitor-only answers.`,
    };
  });
}

function buildCategoryRows(categoryRows) {
  return categoryRows.map((row) => {
    const answerEstimate = Math.max(3, num(row.queries) * 3);
    const currentMentionCount = Math.round((num(row.mentionRate) / 100) * answerEstimate);
    const currentTop3Count = Math.round((num(row.topThreeRate) / 100) * answerEstimate);
    const mentionTarget = targetCount(35, answerEstimate);
    const top3Target = targetCount(25, answerEstimate);
    return {
      category: row.category,
      priority_score: num(row.priorityScore),
      baseline_queries: num(row.queries),
      answer_estimate: answerEstimate,
      current_mention_rate: num(row.mentionRate),
      current_mention_count: currentMentionCount,
      target_mention_count: mentionTarget,
      mention_lift_needed: Math.max(0, mentionTarget - currentMentionCount),
      current_top3_rate: num(row.topThreeRate),
      current_top3_count: currentTop3Count,
      target_top3_count: top3Target,
      top3_lift_needed: Math.max(0, top3Target - currentTop3Count),
      competitor_only_answers: num(row.competitorOnlyAnswers),
      zero_mention_queries: num(row.zeroMentionQueries),
      top_competitors: row.topCompetitors,
      main_move: row.mainMove,
      top_pages: row.topPages,
    };
  }).sort((a, b) => b.priority_score - a.priority_score);
}

function buildIntentRows(intentRows) {
  return intentRows.map((row) => {
    const answerEstimate = Math.max(3, num(row.baselineQueries) * 3);
    const currentMentionCount = Math.round((num(row.mentionRate) / 100) * answerEstimate);
    const currentTop3Count = Math.round((num(row.topThreeRate) / 100) * answerEstimate);
    const mentionTarget = targetCount(35, answerEstimate);
    const top3Target = targetCount(25, answerEstimate);
    return {
      intent: row.intent,
      priority_score: num(row.priorityScore),
      baseline_queries: num(row.baselineQueries),
      selected_prompts: num(row.selectedPrompts),
      provider_requests: num(row.providerRequests),
      priority_requests: num(row.priorityRequests),
      competitor_only_answers: num(row.competitorOnlyAnswers),
      zero_mention_queries: num(row.zeroMentionQueries),
      current_mention_rate: num(row.mentionRate),
      mention_lift_needed: Math.max(0, mentionTarget - currentMentionCount),
      top3_lift_needed: Math.max(0, top3Target - currentTop3Count),
      top_categories: row.topCategories,
      top_competitors: row.topCompetitors,
      main_move: row.mainMove,
    };
  }).sort((a, b) => b.priority_score - a.priority_score);
}

function barSvg({ title, rows, labelKey, valueKey, color = "#0f766e", maxRows = 10 }) {
  const chartRows = rows.slice(0, maxRows);
  const width = 940;
  const rowHeight = 36;
  const height = 76 + chartRows.length * rowHeight;
  const max = Math.max(1, ...chartRows.map((row) => num(row[valueKey])));
  const body = chartRows.map((row, index) => {
    const y = 58 + index * rowHeight;
    const barWidth = Math.max(2, Math.round((num(row[valueKey]) / max) * 520));
    return `<g>
      <text x="22" y="${y + 17}" fill="#111827" font-size="13" font-weight="800">${escapeHtml(short(row[labelKey], 42))}</text>
      <rect x="326" y="${y}" width="520" height="22" rx="11" fill="#e5e7eb"/>
      <rect x="326" y="${y}" width="${barWidth}" height="22" rx="11" fill="${color}"/>
      <text x="906" y="${y + 16}" fill="#111827" font-size="13" font-weight="900" text-anchor="end">${escapeHtml(row[valueKey])}</text>
    </g>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#ffffff"/>
    <text x="22" y="34" fill="#111827" font-size="20" font-weight="900">${escapeHtml(title)}</text>
    ${body}
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

function buildMarkdown({ summary, kpiRows, waveRows, categoryRows, intentRows }) {
  return `# AI Visibility KPI Retest Ladder

## Bottom Line

The next benchmark needs hard pass/fail counts. Current baseline is ${summary.mentionRate}% mention, ${summary.nonBrandedMentionRate}% non-branded mention, ${summary.topThreeRate}% top-3, ${summary.citationRate}% citation, and ${summary.competitorOnlyRate}% competitor-only. The next target is not abstract: iBOLT needs ${summary.mentionLiftNeeded} additional mentions, ${summary.topThreeLiftNeeded} additional top-3 recommendations, ${summary.nonBrandedLiftNeeded} additional non-branded mentions, and ${summary.citationLiftNeeded} citations on the saved 93-answer baseline.

Live retest is not run yet because OPENROUTER_API_KEY is ${summary.keyAvailable ? "present" : "missing"} in this shell.

## KPI Count Targets

${markdownTable(kpiRows, [
  ["Metric", "metric"],
  ["Current", "current_count"],
  ["Denom", "denominator"],
  ["Current %", "current_rate"],
  ["Target %", "target_rate"],
  ["Target count", "target_count"],
  ["Lift needed", "lift_needed"],
  ["Why", "why_it_matters"],
])}

## Retest Wave Gates

${markdownTable(waveRows, [
  ["Batch", "batch_id"],
  ["Wave", "wave"],
  ["Requests", "requests"],
  ["Prompts", "unique_prompts"],
  ["Pages", "pages"],
  ["Pass gate", "pass_gate"],
])}

## Category Targets

${markdownTable(top(categoryRows, "priority_score", 10), [
  ["Category", "category"],
  ["Priority", "priority_score"],
  ["Queries", "baseline_queries"],
  ["Mention lift", "mention_lift_needed"],
  ["Top-3 lift", "top3_lift_needed"],
  ["Competitors", "top_competitors"],
  ["Move", "main_move"],
])}

## Intent Targets

${markdownTable(top(intentRows, "priority_score", 8), [
  ["Intent", "intent"],
  ["Priority", "priority_score"],
  ["Baseline queries", "baseline_queries"],
  ["Priority requests", "priority_requests"],
  ["Mention lift", "mention_lift_needed"],
  ["Top-3 lift", "top3_lift_needed"],
  ["Move", "main_move"],
])}
`;
}

function buildHtml({ summary, kpiRows, waveRows, categoryRows, intentRows, charts }) {
  const cards = [
    ["Mention lift", `+${summary.mentionLiftNeeded}`, "additional mentions needed on 93-answer baseline"],
    ["Non-branded lift", `+${summary.nonBrandedLiftNeeded}`, "additional generic-buyer mentions needed"],
    ["Top-3 lift", `+${summary.topThreeLiftNeeded}`, "additional recommendation-set answers needed"],
    ["Citation lift", `+${summary.citationLiftNeeded}`, "target-domain citations needed"],
    ["Priority retest", summary.priorityRequests, "requests across ChatGPT, Claude, Gemini"],
    ["Full all-blog", summary.fullProviderRequests, "provider requests staged"],
  ].map(([label, value, note]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>AI Visibility KPI Retest Ladder</title>
<style>
body{margin:0;background:#f6f8fb;color:#111827;font-family:Arial,Helvetica,sans-serif}main{max-width:1240px;margin:0 auto;padding:34px 24px 64px}h1{font-size:36px;margin:0 0 8px;letter-spacing:0}h2{font-size:23px;margin:34px 0 12px}p,li{line-height:1.55;color:#334155;font-size:15px}.note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #0f766e;border-radius:12px;padding:16px 18px;margin:20px 0}.warn{border-left-color:#f97316}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:16px}.label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:900}.value{font-size:30px;font-weight:900;margin:8px 0;color:#0f172a}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}.chart{background:#fff;border:1px solid #dbe3ef;border-radius:18px;padding:10px;overflow:auto}.chart svg{width:100%;height:auto;display:block}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 22px}th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}@media(max-width:900px){.cards,.grid{grid-template-columns:1fr}h1{font-size:30px}}
</style></head><body><main>
<h1>AI Visibility KPI Retest Ladder</h1>
<p>This report turns the benchmark into count-based gates. It defines what a successful retest must show after page edits, so we do not confuse activity with measurable lift.</p>
<div class="note"><strong>Current baseline:</strong> ${summary.mentionRate}% mention, ${summary.nonBrandedMentionRate}% non-branded mention, ${summary.topThreeRate}% top-3, ${summary.citationRate}% citation, ${summary.competitorOnlyRate}% competitor-only. OPENROUTER_API_KEY is ${summary.keyAvailable ? "present" : "missing"} in this shell.</div>
<section class="cards">${cards}</section>
<section class="grid"><div class="chart">${charts.categories}</div><div class="chart">${charts.intents}</div></section>
<h2>KPI Count Targets</h2>
${table(kpiRows, [
  ["Metric", "metric"],
  ["Current", "current_count"],
  ["Denominator", "denominator"],
  ["Current %", "current_rate"],
  ["Target %", "target_rate"],
  ["Target count", "target_count"],
  ["Lift needed", "lift_needed"],
  ["Why", "why_it_matters"],
])}
<h2>Retest Wave Gates</h2>
${table(waveRows, [
  ["Batch", "batch_id"],
  ["Wave", "wave"],
  ["Requests", "requests"],
  ["Prompts", "unique_prompts"],
  ["Pages", "pages"],
  ["Pass gate", "pass_gate"],
])}
<h2>Category Targets</h2>
${table(top(categoryRows, "priority_score", 12), [
  ["Category", "category"],
  ["Priority", "priority_score"],
  ["Queries", "baseline_queries"],
  ["Mention lift", "mention_lift_needed"],
  ["Top-3 lift", "top3_lift_needed"],
  ["Competitors", "top_competitors"],
  ["Move", "main_move"],
])}
<h2>Intent Targets</h2>
${table(intentRows, [
  ["Intent", "intent"],
  ["Priority", "priority_score"],
  ["Baseline queries", "baseline_queries"],
  ["Priority requests", "priority_requests"],
  ["Mention lift", "mention_lift_needed"],
  ["Top-3 lift", "top3_lift_needed"],
  ["Move", "main_move"],
])}
</main></body></html>`;
}

async function main() {
  const benchmarkDir = process.argv[2] ? path.resolve(process.argv[2]) : await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, REPORT_DIR);
  await mkdir(outDir, { recursive: true });

  const master = await readJson(path.join(benchmarkDir, "master-dossier", "master-dossier-data.json"), {});
  const dashboard = await readCsv(path.join(benchmarkDir, "boss-ai-visibility-dashboard", "boss-dashboard-summary.csv"));
  const priority = await readJson(path.join(benchmarkDir, "priority-retest-packet", "priority-retest-data.json"), { summary: {}, batchRows: [] });
  const allBlogManifest = await readCsv(path.join(benchmarkDir, "all-blog-prompt-gap-addendum", "all-blog-complete-provider-manifest.csv"));
  const allBlogPrompts = new Set(allBlogManifest.map((row) => row.prompt).filter(Boolean));
  const categoryProvider = await readJson(path.join(benchmarkDir, "category-provider-priority-report", "category-provider-priority-data.json"), { categoryRows: [] });
  const promptIntent = await readJson(path.join(benchmarkDir, "prompt-intent-loss-report", "prompt-intent-loss-data.json"), { intentRows: [] });

  const kpiRows = buildKpiRows({ master, dashboard });
  const waveRows = buildWaveRows(priority.batchRows || []);
  const categoryRows = buildCategoryRows(categoryProvider.categoryRows || []);
  const intentRows = buildIntentRows(promptIntent.intentRows || []);
  const byName = Object.fromEntries(kpiRows.map((row) => [row.metric, row]));
  const summary = {
    generatedAt: new Date().toISOString(),
    benchmarkDir,
    keyAvailable: Boolean(process.env.OPENROUTER_API_KEY),
    mentionRate: byName["Mention rate"].current_rate,
    nonBrandedMentionRate: byName["Non-branded mention"].current_rate,
    topThreeRate: byName["Top-3 recommendation"].current_rate,
    citationRate: byName["Citation rate"].current_rate,
    competitorOnlyRate: byName["Competitor-only answer rate"].current_rate,
    mentionLiftNeeded: byName["Mention rate"].lift_needed,
    nonBrandedLiftNeeded: byName["Non-branded mention"].lift_needed,
    topThreeLiftNeeded: byName["Top-3 recommendation"].lift_needed,
    citationLiftNeeded: byName["Citation rate"].lift_needed,
    competitorOnlyReductionNeeded: byName["Competitor-only answer rate"].lift_needed,
    priorityRequests: priority.summary?.priorityProviderRequests || 0,
    priorityPrompts: priority.summary?.uniquePrompts || 0,
    fullProviderRequests: allBlogManifest.length || priority.summary?.fullProviderRequests || 0,
    fullPrompts: allBlogPrompts.size || 0,
    waves: waveRows.length,
    categories: categoryRows.length,
    intents: intentRows.length,
  };

  const charts = {
    categories: barSvg({ title: "Mention Lift Needed By Category", rows: categoryRows, labelKey: "category", valueKey: "mention_lift_needed", color: "#0f766e" }),
    intents: barSvg({ title: "Intent Priority Score", rows: intentRows, labelKey: "intent", valueKey: "priority_score", color: "#2563eb" }),
  };

  await writeFile(path.join(outDir, "category-mention-lift.svg"), charts.categories);
  await writeFile(path.join(outDir, "intent-priority-score.svg"), charts.intents);
  await writeFile(path.join(outDir, "visibility-kpi-ladder-data.json"), `${JSON.stringify({
    summary,
    kpiRows,
    waveRows,
    categoryRows,
    intentRows,
  }, null, 2)}\n`);
  await writeFile(path.join(outDir, "kpi-count-targets.csv"), csv([
    ["metric", "current_rate", "current_count", "denominator", "target_rate", "target_count", "lift_needed", "why_it_matters"],
    ...kpiRows.map((row) => [row.metric, row.current_rate, row.current_count, row.denominator, row.target_rate, row.target_count, row.lift_needed, row.why_it_matters]),
  ]));
  await writeFile(path.join(outDir, "wave-success-gates.csv"), csv([
    ["batch_id", "wave", "requests", "unique_prompts", "pages", "providers", "categories", "prerequisite", "success_metric", "required_mentions", "required_top3", "max_competitor_only", "required_citations", "required_exact_products", "pass_gate"],
    ...waveRows.map((row) => [row.batch_id, row.wave, row.requests, row.unique_prompts, row.pages, row.providers, row.categories, row.prerequisite, row.success_metric, row.required_mentions, row.required_top3, row.max_competitor_only, row.required_citations, row.required_exact_products, row.pass_gate]),
  ]));
  await writeFile(path.join(outDir, "category-retest-targets.csv"), csv([
    ["category", "priority_score", "baseline_queries", "answer_estimate", "current_mention_rate", "current_mention_count", "target_mention_count", "mention_lift_needed", "current_top3_rate", "current_top3_count", "target_top3_count", "top3_lift_needed", "competitor_only_answers", "zero_mention_queries", "top_competitors", "main_move", "top_pages"],
    ...categoryRows.map((row) => [row.category, row.priority_score, row.baseline_queries, row.answer_estimate, row.current_mention_rate, row.current_mention_count, row.target_mention_count, row.mention_lift_needed, row.current_top3_rate, row.current_top3_count, row.target_top3_count, row.top3_lift_needed, row.competitor_only_answers, row.zero_mention_queries, row.top_competitors, row.main_move, row.top_pages]),
  ]));
  await writeFile(path.join(outDir, "intent-retest-targets.csv"), csv([
    ["intent", "priority_score", "baseline_queries", "selected_prompts", "provider_requests", "priority_requests", "competitor_only_answers", "zero_mention_queries", "current_mention_rate", "mention_lift_needed", "top3_lift_needed", "top_categories", "top_competitors", "main_move"],
    ...intentRows.map((row) => [row.intent, row.priority_score, row.baseline_queries, row.selected_prompts, row.provider_requests, row.priority_requests, row.competitor_only_answers, row.zero_mention_queries, row.current_mention_rate, row.mention_lift_needed, row.top3_lift_needed, row.top_categories, row.top_competitors, row.main_move]),
  ]));
  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown({ summary, kpiRows, waveRows, categoryRows, intentRows }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({ summary, kpiRows, waveRows, categoryRows, intentRows, charts }));

  console.log(`Wrote ${path.relative(process.cwd(), outDir)}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
