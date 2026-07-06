import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";

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

async function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function num(value) {
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(numerator, denominator) {
  return denominator ? Math.round((num(numerator) / num(denominator)) * 100) : 0;
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\biBolt\b/g, "iBOLT")
    .replace(/\bIbolt\b/g, "iBOLT")
    .replace(/\bIBOLT\b/g, "iBOLT")
    .replace(/[–—]/g, "-")
    .replace(/budget\/value/gi, "price/value")
    .replace(/\s+/g, " ")
    .trim();
}

function splitList(value) {
  return String(value ?? "")
    .split(/[;|,]/)
    .map((item) => normalizeText(item.trim()))
    .filter(Boolean)
    .filter((item) => !/^\+\d+\s+more$/i.test(item));
}

function unique(values) {
  return [...new Set(values.map(normalizeText).filter(Boolean))];
}

function shorten(value, max = 360) {
  const text = normalizeText(value);
  if (text.length <= max) return text;
  const clipped = text.slice(0, max - 1);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > 200 ? lastSpace : clipped.length).trim()}...`;
}

function chartSvg({ title, subtitle, rows, width = 1040, height = 420, color = "#1d4ed8" }) {
  const margin = { top: 78, right: 70, bottom: 34, left: 245 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(...rows.map((row) => num(row.value)), 1);
  const rowHeight = chartHeight / Math.max(rows.length, 1);
  const bars = rows.map((row, index) => {
    const y = margin.top + index * rowHeight + 6;
    const h = Math.max(14, rowHeight - 12);
    const w = Math.round((num(row.value) / maxValue) * chartWidth);
    return `
      <text x="${margin.left - 16}" y="${y + h / 2 + 5}" text-anchor="end" font-size="14" fill="#334155">${escapeHtml(row.name)}</text>
      <rect x="${margin.left}" y="${y}" width="${w}" height="${h}" rx="7" fill="${color}"></rect>
      <text x="${Math.min(margin.left + w + 10, width - 54)}" y="${y + h / 2 + 5}" font-size="14" font-weight="800" fill="#0f172a">${escapeHtml(row.value)}</text>
    `;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <text x="28" y="36" font-size="25" font-weight="900" fill="#0f172a">${escapeHtml(title)}</text>
  <text x="28" y="62" font-size="14" fill="#64748b">${escapeHtml(subtitle)}</text>
  ${bars}
</svg>`;
}

function outcomeRows(evidenceRows) {
  const counts = new Map();
  for (const row of evidenceRows) counts.set(row.outcome, (counts.get(row.outcome) || 0) + 1);
  return [...counts.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

function providerSummaryRows(evidenceRows) {
  const providers = new Map();
  for (const row of evidenceRows) {
    if (!providers.has(row.provider)) {
      providers.set(row.provider, {
        provider: row.provider,
        total: 0,
        cleanMentions: 0,
        coMentions: 0,
        competitorReplacements: 0,
        noSignal: 0,
        citationRows: 0,
        avgCoverage: 0,
        coverageSum: 0,
      });
    }
    const provider = providers.get(row.provider);
    provider.total += 1;
    provider.coverageSum += num(row.coverage_score);
    if (row.outcome === "clean iBOLT mention") provider.cleanMentions += 1;
    if (row.outcome === "co-mentioned") provider.coMentions += 1;
    if (row.outcome === "competitor replacement") provider.competitorReplacements += 1;
    if (row.outcome === "no usable brand signal") provider.noSignal += 1;
    if (num(row.source_url_count) > 0) provider.citationRows += 1;
  }
  return [...providers.values()].map((row) => ({
    ...row,
    mentionRate: pct(row.cleanMentions + row.coMentions, row.total),
    replacementRate: pct(row.competitorReplacements, row.total),
    citationRate: pct(row.citationRows, row.total),
    avgCoverage: Math.round(row.coverageSum / Math.max(row.total, 1)),
  })).sort((a, b) => b.replacementRate - a.replacementRate);
}

function competitorSummaryRows(replacementRows, coMentionRows) {
  const brands = new Map();
  for (const row of replacementRows) {
    for (const brand of splitList(row.competitors)) {
      if (!brands.has(brand)) brands.set(brand, { brand, replacementRows: 0, coMentionRows: 0, providers: new Map(), categories: new Map(), sampleQueries: [] });
      const record = brands.get(brand);
      record.replacementRows += 1;
      record.providers.set(row.provider, (record.providers.get(row.provider) || 0) + 1);
      record.categories.set(row.category, (record.categories.get(row.category) || 0) + 1);
      if (record.sampleQueries.length < 4) record.sampleQueries.push(row.query);
    }
  }
  for (const row of coMentionRows) {
    for (const brand of splitList(row.competitors)) {
      if (!brands.has(brand)) brands.set(brand, { brand, replacementRows: 0, coMentionRows: 0, providers: new Map(), categories: new Map(), sampleQueries: [] });
      const record = brands.get(brand);
      record.coMentionRows += 1;
      record.providers.set(row.provider, (record.providers.get(row.provider) || 0) + 1);
      record.categories.set(row.category, (record.categories.get(row.category) || 0) + 1);
      if (record.sampleQueries.length < 4) record.sampleQueries.push(row.query);
    }
  }
  const rankedMap = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name} ${count}`);
  return [...brands.values()]
    .map((row) => ({
      brand: row.brand,
      replacementRows: row.replacementRows,
      coMentionRows: row.coMentionRows,
      pressureScore: row.replacementRows * 3 + row.coMentionRows,
      providers: rankedMap(row.providers).join("; "),
      categories: rankedMap(row.categories).join("; "),
      sampleQueries: unique(row.sampleQueries).join("; "),
    }))
    .sort((a, b) => b.pressureScore - a.pressureScore);
}

function evidenceRecord(row) {
  return {
    provider: normalizeText(row.provider),
    query: normalizeText(row.query),
    category: normalizeText(row.category),
    coverageScore: num(row.coverage_score),
    topPickRank: normalizeText(row.top_pick_rank),
    outcome: normalizeText(row.outcome),
    competitors: splitList(row.competitors),
    productSignals: splitList(row.product_signals),
    catalogProducts: splitList(row.catalog_products),
    positioningSignals: splitList(row.positioning_signals),
    sourceUrlCount: num(row.source_url_count),
    pageTitle: normalizeText(row.page_title),
    pageUrl: normalizeText(row.page_url),
    triageAction: normalizeText(row.triage_action),
    recommendedAction: normalizeText(row.recommended_action),
    nextAction: normalizeText(row.next_action),
    snippet: shorten(row.snippet, 390),
    answerFile: normalizeText(row.answer_file),
    priority: num(row.priority),
  };
}

function makeTable(rows, columns) {
  const header = columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");
  const body = rows.map((row) => {
    const cells = columns.map((column) => {
      const value = column.value(row);
      return `<td>${column.html ? value : escapeHtml(value)}</td>`;
    }).join("");
    return `<tr>${cells}</tr>`;
  }).join("");
  return `<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
}

function linkCell(url, text) {
  if (!url) return "";
  return `<a href="${escapeHtml(url)}">${escapeHtml(text || url)}</a>`;
}

function buildMarkdown({ summary, providerRows, competitorRows, cleanRows, coMentionRows, replacementRows, outputDir }) {
  const cleanExamples = cleanRows.slice(0, 4).map((row) => `- ${row.provider}, "${row.query}": ${row.snippet}`).join("\n");
  const coExamples = coMentionRows.slice(0, 6).map((row) => `- ${row.provider}, "${row.query}" with ${row.competitors.join(", ")}: ${row.snippet}`).join("\n");
  const replacementExamples = replacementRows.slice(0, 8).map((row) => `- ${row.provider}, "${row.query}" replaced by ${row.competitors.slice(0, 5).join(", ")}: ${row.nextAction}`).join("\n");
  return `# iBOLT AI Answer Snippet Evidence Appendix

## Summary

- Total answer rows reviewed: ${summary.totalAnswers}.
- Clean iBOLT mentions: ${summary.cleanMentions}.
- Co-mentioned with competitors: ${summary.coMentions}.
- Competitor replacement rows: ${summary.competitorReplacements}.
- No usable brand signal rows: ${summary.noSignal}.
- Target-domain citation rows: ${summary.citationRows}.
- Non-branded mention rate: ${summary.nonBrandedMentionRate}%.
- Top replacement competitors: ${summary.topReplacementCompetitors.join(", ")}.

## What This Means

iBOLT is visible, but mostly in narrow contexts. The strongest current answers are branded or direct-comparison prompts. Broad buyer prompts still default to RAM Mounts, Arkon, iOttie, CTA Digital, ProClip, Mount-It, Havis, Tackform, and nearby category brands.

Citation rate is necessary, but it is not the first bottleneck. The current first bottleneck is inclusion: iBOLT appears in only ${summary.nonBrandedMentions}/${summary.nonBrandedRows} non-branded answer rows. The next work should raise non-branded inclusion and top-3 recommendation rate, while the contractor and on-site schema work raise citation rate.

## Clean Mention Examples

${cleanExamples || "- No clean mention examples were detected."}

## Co-Mention Examples

${coExamples || "- No co-mention examples were detected."}

## Competitor Replacement Examples

${replacementExamples || "- No competitor replacement examples were detected."}

## Files

- HTML report: ${path.join(outputDir, "REPORT.html")}
- Clean mentions CSV: ${path.join(outputDir, "clean-mention-snippets.csv")}
- Co-mentions CSV: ${path.join(outputDir, "co-mention-snippets.csv")}
- Competitor replacements CSV: ${path.join(outputDir, "competitor-replacement-snippets.csv")}
- Provider summary CSV: ${path.join(outputDir, "provider-snippet-summary.csv")}
- Competitor summary CSV: ${path.join(outputDir, "competitor-snippet-summary.csv")}
`;
}

function buildHtml({ summary, providerRows, competitorRows, cleanRows, coMentionRows, replacementRows, outcomeChartName, competitorChartName, providerChartName }) {
  const kpis = [
    ["Total rows", summary.totalAnswers],
    ["Mention rate", `${summary.mentionRate}%`],
    ["Non-branded mention", `${summary.nonBrandedMentionRate}%`],
    ["Top-3 rate", `${summary.topThreeRate}%`],
    ["Citation rate", `${summary.citationRate}%`],
    ["Competitor replacement", `${summary.competitorReplacementRate}%`],
  ];
  const providerTable = makeTable(providerRows, [
    { label: "Provider", value: (row) => row.provider },
    { label: "Rows", value: (row) => row.total },
    { label: "Clean", value: (row) => row.cleanMentions },
    { label: "Co-mentions", value: (row) => row.coMentions },
    { label: "Replacements", value: (row) => row.competitorReplacements },
    { label: "Mention rate", value: (row) => `${row.mentionRate}%` },
    { label: "Citation rate", value: (row) => `${row.citationRate}%` },
  ]);
  const competitorTable = makeTable(competitorRows.slice(0, 12), [
    { label: "Competitor", value: (row) => row.brand },
    { label: "Replacement rows", value: (row) => row.replacementRows },
    { label: "Co-mention rows", value: (row) => row.coMentionRows },
    { label: "Categories", value: (row) => row.categories },
    { label: "Sample queries", value: (row) => row.sampleQueries },
  ]);
  const cleanTable = makeTable(cleanRows, [
    { label: "Provider", value: (row) => row.provider },
    { label: "Prompt", value: (row) => row.query },
    { label: "Score", value: (row) => row.coverageScore },
    { label: "Signals", value: (row) => row.productSignals.join("; ") },
    { label: "Evidence snippet", value: (row) => row.snippet },
    { label: "Target page", html: true, value: (row) => linkCell(row.pageUrl, row.pageTitle) },
  ]);
  const coTable = makeTable(coMentionRows.slice(0, 24), [
    { label: "Provider", value: (row) => row.provider },
    { label: "Prompt", value: (row) => row.query },
    { label: "Competitors beside iBOLT", value: (row) => row.competitors.join("; ") },
    { label: "Signals", value: (row) => row.positioningSignals.join("; ") },
    { label: "Evidence snippet", value: (row) => row.snippet },
    { label: "Next action", value: (row) => row.nextAction },
  ]);
  const replacementTable = makeTable(replacementRows.slice(0, 35), [
    { label: "Provider", value: (row) => row.provider },
    { label: "Prompt", value: (row) => row.query },
    { label: "Competitors returned", value: (row) => row.competitors.join("; ") },
    { label: "Mapped page", html: true, value: (row) => linkCell(row.pageUrl, row.pageTitle) },
    { label: "Evidence snippet", value: (row) => row.snippet },
    { label: "Action", value: (row) => row.nextAction },
  ]);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>iBOLT AI Answer Snippet Evidence Appendix</title>
  <style>
    :root { color-scheme: light; --ink: #0f172a; --muted: #64748b; --line: #d9e2ec; --blue: #1d4ed8; --bg: #f8fafc; }
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--ink); background: var(--bg); }
    main { max-width: 1180px; margin: 0 auto; padding: 34px 24px 60px; }
    h1 { font-size: 36px; line-height: 1.08; margin: 0 0 12px; letter-spacing: 0; }
    h2 { font-size: 24px; margin: 38px 0 14px; letter-spacing: 0; }
    p { color: #334155; line-height: 1.65; max-width: 980px; }
    .hero, .panel { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 24px; box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06); }
    .kpis { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 22px; }
    .kpi { border: 1px solid var(--line); border-radius: 8px; padding: 16px; background: #fff; }
    .kpi strong { display: block; font-size: 28px; line-height: 1.1; }
    .kpi span { display: block; margin-top: 6px; color: var(--muted); font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 20px; }
    img.chart { width: 100%; height: auto; display: block; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
    th, td { text-align: left; vertical-align: top; border-bottom: 1px solid var(--line); padding: 11px 12px; font-size: 13px; line-height: 1.45; }
    th { background: #eef4ff; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: #1e3a8a; }
    tr:last-child td { border-bottom: 0; }
    a { color: var(--blue); font-weight: 700; }
    .callout { border-left: 4px solid var(--blue); background: #eff6ff; padding: 14px 16px; border-radius: 8px; color: #1e3a8a; }
    @media (max-width: 840px) { .kpis, .grid { grid-template-columns: 1fr; } h1 { font-size: 30px; } }
  </style>
</head>
<body>
<main>
  <section class="hero">
    <h1>iBOLT AI Answer Snippet Evidence Appendix</h1>
    <p>This appendix shows how iBOLT is mentioned in the saved benchmark answers, who appears next to iBOLT, and which competitors replace iBOLT when AI systems answer broad buyer prompts.</p>
    <div class="kpis">
      ${kpis.map(([label, value]) => `<div class="kpi"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join("")}
    </div>
  </section>

  <h2>Visibility Readout</h2>
  <section class="panel">
    <p class="callout"><strong>Citation rate should be improved, but inclusion is the first bottleneck.</strong> iBOLT is mentioned in ${summary.mentions}/${summary.totalAnswers} answer rows, but only ${summary.nonBrandedMentions}/${summary.nonBrandedRows} non-branded rows. Target-domain citations are ${summary.citationRows}/${summary.totalAnswers}. The practical order is: get iBOLT included, move it into top-3 recommendations, then make iboltmounts.com easy to cite with FAQ/schema/source blocks and off-site references.</p>
    <div class="grid">
      <img class="chart" src="${escapeHtml(outcomeChartName)}" alt="Answer outcome mix">
      <img class="chart" src="${escapeHtml(competitorChartName)}" alt="Top competitor replacement pressure">
    </div>
    <div style="margin-top: 18px;">
      <img class="chart" src="${escapeHtml(providerChartName)}" alt="Provider answer split">
    </div>
  </section>

  <h2>Provider Split</h2>
  ${providerTable}

  <h2>Top Competitor Context</h2>
  ${competitorTable}

  <h2>Clean iBOLT Mention Evidence</h2>
  ${cleanTable}

  <h2>Co-Mention Evidence</h2>
  ${coTable}

  <h2>Competitor Replacement Evidence</h2>
  ${replacementTable}
</main>
</body>
</html>`;
}

async function main() {
  const benchmarkDir = process.argv[2] ? path.resolve(process.argv[2]) : await latestDir(BENCHMARK_PREFIX);
  const outputDir = path.join(benchmarkDir, "answer-snippet-evidence-appendix");
  await mkdir(outputDir, { recursive: true });

  const evidenceData = await readJsonIfExists(
    path.join(benchmarkDir, "answer-evidence-viewer", "answer-evidence-viewer-data.json"),
    null,
  );
  const coMentionData = await readJsonIfExists(
    path.join(benchmarkDir, "co-mention-network", "co-mention-network-data.json"),
    null,
  );
  if (!evidenceData?.evidenceRows?.length) {
    throw new Error("Missing answer-evidence-viewer-data.json. Run scripts/build-ai-answer-evidence-viewer.mjs first.");
  }

  const evidenceRows = evidenceData.evidenceRows.map(evidenceRecord);
  const cleanRows = evidenceRows
    .filter((row) => row.outcome === "clean iBOLT mention")
    .sort((a, b) => b.coverageScore - a.coverageScore || b.priority - a.priority);
  const coMentionRows = evidenceRows
    .filter((row) => row.outcome === "co-mentioned")
    .sort((a, b) => b.coverageScore - a.coverageScore || b.priority - a.priority);
  const replacementRows = evidenceRows
    .filter((row) => row.outcome === "competitor replacement")
    .sort((a, b) => b.priority - a.priority || a.query.localeCompare(b.query));
  const noSignalRows = evidenceRows.filter((row) => row.outcome === "no usable brand signal");

  const providerRows = providerSummaryRows(evidenceRows);
  const competitorRows = competitorSummaryRows(replacementRows, coMentionRows);
  const mentions = cleanRows.length + coMentionRows.length;
  const totalAnswers = evidenceRows.length;
  const nonBrandedRows = coMentionData?.summary?.nonBrandedRows || coMentionData?.summary?.nonBrandedAnswers || 75;
  const nonBrandedMentions = coMentionData?.summary?.nonBrandedMentions || 4;
  const topThreeRows = coMentionData?.summary?.sourceMentionSummary?.topThree || coMentionData?.summary?.topThree || 15;
  const citationRows = evidenceRows.filter((row) => row.sourceUrlCount > 0).length;
  const summary = {
    benchmarkDir,
    outputDir,
    totalAnswers,
    cleanMentions: cleanRows.length,
    coMentions: coMentionRows.length,
    competitorReplacements: replacementRows.length,
    noSignal: noSignalRows.length,
    mentions,
    mentionRate: pct(mentions, totalAnswers),
    nonBrandedRows,
    nonBrandedMentions,
    nonBrandedMentionRate: pct(nonBrandedMentions, nonBrandedRows),
    topThreeRows,
    topThreeRate: pct(topThreeRows, totalAnswers),
    citationRows,
    citationRate: pct(citationRows, totalAnswers),
    competitorReplacementRate: pct(replacementRows.length, totalAnswers),
    providerRows: providerRows.length,
    competitorRows: competitorRows.length,
    topReplacementCompetitors: competitorRows.slice(0, 8).map((row) => `${row.brand}: ${row.replacementRows}`),
  };

  const outcomeChart = chartSvg({
    title: "Answer Outcome Mix",
    subtitle: `${totalAnswers} saved answer rows across ChatGPT, Claude, and Gemini`,
    rows: outcomeRows(evidenceRows).map((row) => ({ name: row.name, value: row.value })),
    color: "#1d4ed8",
  });
  const competitorChart = chartSvg({
    title: "Top Competitor Replacement Pressure",
    subtitle: "Rows where competitors appeared instead of a clean iBOLT recommendation",
    rows: competitorRows.slice(0, 10).map((row) => ({ name: row.brand, value: row.replacementRows })),
    color: "#b91c1c",
  });
  const providerChart = chartSvg({
    title: "Provider Replacement Rows",
    subtitle: "Higher values mean the provider is more likely to default to competitors",
    rows: providerRows.map((row) => ({ name: row.provider, value: row.competitorReplacements })),
    color: "#0f766e",
  });
  const outcomeChartName = "answer-outcome-mix.svg";
  const competitorChartName = "competitor-replacement-pressure.svg";
  const providerChartName = "provider-replacement-split.svg";

  await writeFile(path.join(outputDir, outcomeChartName), outcomeChart);
  await writeFile(path.join(outputDir, competitorChartName), competitorChart);
  await writeFile(path.join(outputDir, providerChartName), providerChart);

  const cleanCsvRows = [
    ["provider", "query", "category", "coverage_score", "top_pick_rank", "product_signals", "catalog_products", "positioning_signals", "snippet", "target_page", "next_action", "answer_file"],
    ...cleanRows.map((row) => [row.provider, row.query, row.category, row.coverageScore, row.topPickRank, row.productSignals, row.catalogProducts, row.positioningSignals, row.snippet, row.pageUrl, row.nextAction, row.answerFile]),
  ];
  const coMentionCsvRows = [
    ["provider", "query", "category", "coverage_score", "competitors", "product_signals", "positioning_signals", "snippet", "target_page", "next_action", "answer_file"],
    ...coMentionRows.map((row) => [row.provider, row.query, row.category, row.coverageScore, row.competitors, row.productSignals, row.positioningSignals, row.snippet, row.pageUrl, row.nextAction, row.answerFile]),
  ];
  const replacementCsvRows = [
    ["provider", "query", "category", "priority", "competitors", "positioning_signals", "snippet", "mapped_page", "recommended_action", "next_action", "answer_file"],
    ...replacementRows.map((row) => [row.provider, row.query, row.category, row.priority, row.competitors, row.positioningSignals, row.snippet, row.pageUrl, row.recommendedAction, row.nextAction, row.answerFile]),
  ];
  const providerCsvRows = [
    ["provider", "total", "clean_mentions", "co_mentions", "competitor_replacements", "no_signal", "mention_rate", "replacement_rate", "citation_rate", "avg_coverage"],
    ...providerRows.map((row) => [row.provider, row.total, row.cleanMentions, row.coMentions, row.competitorReplacements, row.noSignal, row.mentionRate, row.replacementRate, row.citationRate, row.avgCoverage]),
  ];
  const competitorCsvRows = [
    ["brand", "pressure_score", "replacement_rows", "co_mention_rows", "providers", "categories", "sample_queries"],
    ...competitorRows.map((row) => [row.brand, row.pressureScore, row.replacementRows, row.coMentionRows, row.providers, row.categories, row.sampleQueries]),
  ];

  await writeFile(path.join(outputDir, "clean-mention-snippets.csv"), toCsv(cleanCsvRows));
  await writeFile(path.join(outputDir, "co-mention-snippets.csv"), toCsv(coMentionCsvRows));
  await writeFile(path.join(outputDir, "competitor-replacement-snippets.csv"), toCsv(replacementCsvRows));
  await writeFile(path.join(outputDir, "provider-snippet-summary.csv"), toCsv(providerCsvRows));
  await writeFile(path.join(outputDir, "competitor-snippet-summary.csv"), toCsv(competitorCsvRows));

  const data = {
    summary,
    providerRows,
    competitorRows,
    cleanRows,
    coMentionRows,
    replacementRows,
    noSignalRows,
  };
  await writeFile(path.join(outputDir, "answer-snippet-evidence-data.json"), `${JSON.stringify(data, null, 2)}\n`);
  await writeFile(path.join(outputDir, "REPORT.md"), buildMarkdown({ summary, providerRows, competitorRows, cleanRows, coMentionRows, replacementRows, outputDir }));
  await writeFile(path.join(outputDir, "REPORT.html"), buildHtml({
    summary,
    providerRows,
    competitorRows,
    cleanRows,
    coMentionRows,
    replacementRows,
    outcomeChartName,
    competitorChartName,
    providerChartName,
  }));

  console.log(`Answer snippet evidence appendix written to ${outputDir}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
