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

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some((value) => value !== "")) rows.push(row);
  }
  const [headers = [], ...records] = rows;
  return records.map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""])));
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

async function readCsvIfExists(filePath) {
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

function round(value) {
  return Math.round(num(value));
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

function normalizeUrl(value) {
  return normalizeText(value).replace(/\/+$/, "");
}

function splitList(value) {
  return String(value ?? "")
    .split(/[;|]/)
    .map((item) => normalizeText(item.trim()))
    .filter(Boolean)
    .filter((item) => !/^\+\d+\s+more$/i.test(item));
}

function shorten(value, max = 320) {
  const text = normalizeText(value);
  if (text.length <= max) return text;
  const clipped = text.slice(0, max - 1);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > 180 ? lastSpace : clipped.length).trim()}...`;
}

function countValues(values) {
  const counts = new Map();
  for (const value of values.map(normalizeText).filter(Boolean)) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
}

function firstNonEmpty(...values) {
  return values.map(normalizeText).find(Boolean) || "";
}

function byUrl(rows, urlField = "url") {
  const map = new Map();
  for (const row of rows) {
    const key = normalizeUrl(row[urlField]);
    if (key) map.set(key, row);
  }
  return map;
}

function groupByUrl(rows, urlField) {
  const map = new Map();
  for (const row of rows) {
    const key = normalizeUrl(row[urlField]);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function statusFor(row, evidence) {
  const competitorOnly = num(row.competitor_only_answers);
  const zeroMentions = num(row.zero_mention_queries);
  if (/canonical/i.test(row.lifecycle_bucket) || /canonical/i.test(row.action_bucket)) return "Canonical decision before edit";
  if (competitorOnly > 0 || evidence.replacements > 0) return "Competitor replacement risk";
  if (zeroMentions > 0) return "Not included for mapped prompts";
  if (/mention first/i.test(row.citation_readiness_bucket)) return "Mention recovery before citation";
  if (/cleanup/i.test(row.citation_readiness_bucket) || /schema/i.test(row.lifecycle_bucket)) return "Citation/schema cleanup";
  if (/protect/i.test(row.lifecycle_bucket) || /protect/i.test(row.action_bucket)) return "Protect and amplify";
  return "Monitor";
}

function visibilityStageFor(row, evidence) {
  const competitorOnly = num(row.competitor_only_answers);
  const zeroMentions = num(row.zero_mention_queries);
  if (evidence.replacements > 0 || competitorOnly > 0) return "Competitor replacement";
  if (zeroMentions > 0 || evidence.noSignal > 0) return "Zero mention";
  if (evidence.co > 0) return "Co-mentioned with competitors";
  if (evidence.clean > 0) return "Clean iBOLT mention";
  if (/mention first/i.test(row.citation_readiness_bucket)) return "Mention recovery needed";
  if (/citation|schema|cleanup/i.test(`${row.citation_readiness_bucket} ${row.lifecycle_bucket}`)) return "Citation cleanup only";
  return "No benchmark pressure";
}

function workstreamFor(row, status, evidence, visibilityStage) {
  if (/Canonical/i.test(status) && /Competitor replacement|Zero mention|Mention recovery/i.test(visibilityStage)) {
    return "Canonical plus mention recovery";
  }
  if (/Canonical/i.test(status)) return "Canonical/survivor review";
  if (/Competitor replacement|Zero mention|Mention recovery|Co-mentioned/i.test(visibilityStage)) return "Mention recovery";
  if (num(row.product_entity_queue_rows) > 0 || splitList(row.products_to_feature).length > 0) return "Product/entity modules";
  if (/citation|schema/i.test(status)) return "Citation/schema cleanup";
  if (evidence.clean + evidence.co > 0) return "Protect and amplify";
  return "Monitor";
}

function chartSvg({ title, subtitle, rows, width = 1060, height = 440, color = "#1d4ed8" }) {
  const margin = { top: 78, right: 70, bottom: 34, left: 300 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(...rows.map((row) => num(row.value)), 1);
  const rowHeight = chartHeight / Math.max(rows.length, 1);
  const bars = rows.map((row, index) => {
    const y = margin.top + index * rowHeight + 6;
    const h = Math.max(14, rowHeight - 12);
    const w = Math.round((num(row.value) / maxValue) * chartWidth);
    return `
      <text x="${margin.left - 14}" y="${y + h / 2 + 5}" text-anchor="end" font-size="14" fill="#334155">${escapeHtml(row.name)}</text>
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

function aggregateEvidence(snippetData) {
  const rows = [
    ...(snippetData.cleanRows || []).map((row) => ({ ...row, normalizedOutcome: "clean" })),
    ...(snippetData.coMentionRows || []).map((row) => ({ ...row, normalizedOutcome: "co" })),
    ...(snippetData.replacementRows || []).map((row) => ({ ...row, normalizedOutcome: "replacement" })),
    ...(snippetData.noSignalRows || []).map((row) => ({ ...row, normalizedOutcome: "no-signal" })),
  ];
  const grouped = groupByUrl(rows, "pageUrl");
  const out = new Map();
  for (const [url, pageRows] of grouped.entries()) {
    const clean = pageRows.filter((row) => row.normalizedOutcome === "clean");
    const co = pageRows.filter((row) => row.normalizedOutcome === "co");
    const replacement = pageRows.filter((row) => row.normalizedOutcome === "replacement");
    const noSignal = pageRows.filter((row) => row.normalizedOutcome === "no-signal");
    const competitors = countValues(replacement.flatMap((row) => row.competitors || []));
    const highestPriority = [...replacement, ...co, ...clean, ...noSignal].sort((a, b) => num(b.priority) - num(a.priority))[0] || {};
    out.set(url, {
      clean: clean.length,
      co: co.length,
      replacements: replacement.length,
      noSignal: noSignal.length,
      competitors: competitors.slice(0, 8).map((item) => `${item.name} ${item.count}`),
      topEvidence: highestPriority,
      rows: pageRows,
    });
  }
  return out;
}

function buildControlRows({ dossierRows, citationRows, conversionRows, lifecycleRows, queryRows, evidenceByUrl }) {
  const citationByUrl = byUrl(citationRows, "url");
  const conversionByUrl = byUrl(conversionRows, "url");
  const lifecycleByUrl = byUrl(lifecycleRows, "url");
  const queryByUrl = groupByUrl(queryRows, "page_url");
  return dossierRows.map((row) => {
    const url = normalizeUrl(row.url);
    const citation = citationByUrl.get(url) || {};
    const conversion = conversionByUrl.get(url) || {};
    const lifecycle = lifecycleByUrl.get(url) || {};
    const queries = queryByUrl.get(url) || [];
    const evidence = evidenceByUrl.get(url) || { clean: 0, co: 0, replacements: 0, noSignal: 0, competitors: [], topEvidence: {}, rows: [] };
    const status = statusFor(row, evidence);
    const visibilityStage = visibilityStageFor(row, evidence);
    const workstream = workstreamFor(row, status, evidence, visibilityStage);
    const queryPrompts = queries.map((query) => normalizeText(query.query)).filter(Boolean).slice(0, 8);
    const weakestProviders = queries.flatMap((query) => splitList(query.weakest_providers)).slice(0, 8);
    const topCompetitors = countValues([
      ...splitList(row.competitors),
      ...splitList(citation.competitors),
      ...splitList(conversion.competitors),
      ...evidence.competitors.map((item) => item.replace(/\s+\d+$/, "")),
    ]).slice(0, 8).map((item) => `${item.name} ${item.count}`);
    const primaryAction = firstNonEmpty(
      row.next_action,
      conversion.recommended_action,
      lifecycle.recommended_next_action,
      citation.app_work_action,
    );
    return {
      title: normalizeText(row.title),
      url,
      category: normalizeText(row.category),
      pageStatus: status,
      visibilityStage,
      workstream,
      actionBucket: normalizeText(row.action_bucket),
      lifecycleBucket: firstNonEmpty(row.lifecycle_bucket, lifecycle.lifecycle_bucket),
      citationReadinessBucket: firstNonEmpty(row.citation_readiness_bucket, citation.readiness_bucket),
      conversionTier: firstNonEmpty(row.conversion_tier, conversion.conversion_tier),
      priorityScore: num(row.priority_score),
      visibilityRiskScore: num(row.priority_score) + num(row.competitor_only_answers) * 8 + num(row.zero_mention_queries) * 10 + evidence.replacements * 9,
      aiCitabilityScore: num(row.ai_citability_score),
      wordCount: num(row.word_count),
      productLinks: num(row.product_links),
      productEntityTargets: num(row.product_entity_targets),
      productEntityQueueRows: num(row.product_entity_queue_rows),
      benchmarkQueryCount: num(row.benchmark_query_count),
      zeroMentionQueries: num(row.zero_mention_queries),
      competitorOnlyAnswers: num(row.competitor_only_answers),
      cleanMentions: evidence.clean,
      coMentions: evidence.co,
      replacementSnippets: evidence.replacements,
      noSignalRows: evidence.noSignal,
      competitors: topCompetitors,
      linkedPrompts: splitList(row.linked_prompts),
      queryPrompts,
      weakestProviders,
      issueCount: num(row.issue_count),
      issueFlags: splitList(row.issue_flags),
      productsToFeature: splitList(firstNonEmpty(row.products_to_feature, citation.products_to_feature, conversion.products_to_feature)).slice(0, 8),
      sourceTargets: splitList(firstNonEmpty(row.source_targets, citation.source_targets)).slice(0, 8),
      canonicalOrSurvivorTicket: normalizeText(row.canonical_or_survivor_ticket),
      primaryAction,
      citationAction: firstNonEmpty(citation.next_citation_action, row.source_next_action),
      checkoutAction: normalizeText(conversion.checkout_action),
      ctaButtonGuidance: normalizeText(conversion.cta_button_guidance),
      retestPrompts: splitList(firstNonEmpty(citation.retest_prompts, conversion.retest_prompts, queryPrompts.join("; "))).slice(0, 8),
      evidenceProvider: normalizeText(evidence.topEvidence.provider),
      evidenceQuery: normalizeText(evidence.topEvidence.query),
      evidenceOutcome: normalizeText(evidence.topEvidence.outcome || evidence.topEvidence.normalizedOutcome),
      evidenceSnippet: shorten(evidence.topEvidence.snippet || ""),
      evidenceAnswerFile: normalizeText(evidence.topEvidence.answerFile),
    };
  }).sort((a, b) => b.visibilityRiskScore - a.visibilityRiskScore || b.priorityScore - a.priorityScore);
}

function buildTopicRows(controlRows) {
  const groups = new Map();
  for (const row of controlRows) {
    if (!groups.has(row.category)) {
      groups.set(row.category, {
        category: row.category,
        pages: 0,
        benchmarkPages: 0,
        zeroMentionQueries: 0,
        competitorOnlyAnswers: 0,
        cleanMentions: 0,
        coMentions: 0,
        replacementSnippets: 0,
        prioritySum: 0,
        citabilitySum: 0,
        competitors: [],
        workstreams: [],
        visibilityStages: [],
        topPages: [],
      });
    }
    const group = groups.get(row.category);
    group.pages += 1;
    group.benchmarkPages += row.benchmarkQueryCount > 0 ? 1 : 0;
    group.zeroMentionQueries += row.zeroMentionQueries;
    group.competitorOnlyAnswers += row.competitorOnlyAnswers;
    group.cleanMentions += row.cleanMentions;
    group.coMentions += row.coMentions;
    group.replacementSnippets += row.replacementSnippets;
    group.prioritySum += row.priorityScore;
    group.citabilitySum += row.aiCitabilityScore;
    group.competitors.push(...row.competitors.map((item) => item.replace(/\s+\d+$/, "")));
    group.workstreams.push(row.workstream);
    group.visibilityStages.push(row.visibilityStage);
    group.topPages.push(row);
  }
  return [...groups.values()].map((group) => {
    const topPages = group.topPages.sort((a, b) => b.visibilityRiskScore - a.visibilityRiskScore).slice(0, 5);
    return {
      category: group.category,
      pages: group.pages,
      benchmarkPages: group.benchmarkPages,
      zeroMentionQueries: group.zeroMentionQueries,
      competitorOnlyAnswers: group.competitorOnlyAnswers,
      cleanMentions: group.cleanMentions,
      coMentions: group.coMentions,
      replacementSnippets: group.replacementSnippets,
      avgPriority: round(group.prioritySum / Math.max(group.pages, 1)),
      avgCitability: round(group.citabilitySum / Math.max(group.pages, 1)),
      topCompetitors: countValues(group.competitors).slice(0, 8).map((item) => `${item.name} ${item.count}`),
      topWorkstreams: countValues(group.workstreams).slice(0, 4).map((item) => `${item.name} ${item.count}`),
      topVisibilityStages: countValues(group.visibilityStages).slice(0, 4).map((item) => `${item.name} ${item.count}`),
      topPages: topPages.map((row) => row.title),
    };
  }).sort((a, b) => b.competitorOnlyAnswers - a.competitorOnlyAnswers || b.zeroMentionQueries - a.zeroMentionQueries);
}

function buildEvidenceRows(controlRows) {
  return controlRows
    .filter((row) => row.evidenceSnippet)
    .map((row) => ({
      title: row.title,
      url: row.url,
      category: row.category,
      provider: row.evidenceProvider,
      query: row.evidenceQuery,
      outcome: row.evidenceOutcome,
      competitors: row.competitors,
      snippet: row.evidenceSnippet,
      nextAction: row.primaryAction,
      answerFile: row.evidenceAnswerFile,
    }));
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

function buildMarkdown({ summary, topicRows, controlRows, evidenceRows, outputDir }) {
  const topPages = controlRows.slice(0, 12).map((row, index) => (
    `${index + 1}. ${row.title} (${row.category}) - ${row.visibilityStage}; edit gate: ${row.pageStatus}; ${row.competitorOnlyAnswers} competitor-only answers; action: ${row.primaryAction}`
  )).join("\n");
  const topics = topicRows.slice(0, 10).map((row) => (
    `- ${row.category}: ${row.pages} pages, ${row.competitorOnlyAnswers} competitor-only answers, ${row.zeroMentionQueries} zero-mention queries, top competitors ${row.topCompetitors.slice(0, 5).join(", ")}`
  )).join("\n");
  const snippets = evidenceRows.slice(0, 8).map((row) => (
    `- ${row.provider}, "${row.query}" -> ${row.outcome} on ${row.title}: ${row.snippet}`
  )).join("\n");
  return `# iBOLT Blog Post Visibility Control Report

## Summary

- Live blog pages reviewed: ${summary.pages}.
- Pages with benchmark pressure: ${summary.benchmarkPressurePages}.
- Pages with competitor-only mapped answers: ${summary.competitorOnlyPages}.
- Competitor-only answer/page mappings: ${summary.competitorOnlyAnswers}.
- Zero-mention mapped queries: ${summary.zeroMentionQueries}.
- Pages needing citation/schema cleanup: ${summary.citationCleanupPages}.
- Pages needing canonical/survivor decision before heavy editing: ${summary.canonicalDecisionPages}.
- Pages in competitor replacement stage: ${summary.competitorReplacementStagePages}.
- Pages in zero-mention stage: ${summary.zeroMentionStagePages}.
- Pages in co-mentioned stage: ${summary.coMentionStagePages}.
- Pages in clean mention stage: ${summary.cleanMentionStagePages}.
- Pages with product/entity queue rows: ${summary.productEntityPages}.

## Highest Priority Pages

${topPages}

## Topic Pressure

${topics}

## Evidence Examples

${snippets || "- No answer snippets mapped to page URLs."}

## Files

- HTML report: ${path.join(outputDir, "REPORT.html")}
- Page control ledger: ${path.join(outputDir, "blog-page-control-ledger.csv")}
- Topic summary: ${path.join(outputDir, "topic-page-control-summary.csv")}
- Evidence snippets: ${path.join(outputDir, "page-evidence-snippets.csv")}
`;
}

function buildHtml({ summary, topicRows, controlRows, evidenceRows, priorityChartName, topicChartName, workstreamChartName }) {
  const kpis = [
    ["Pages reviewed", summary.pages],
    ["Benchmark pages", summary.benchmarkPressurePages],
    ["Competitor-only pages", summary.competitorOnlyPages],
    ["Zero-mention queries", summary.zeroMentionQueries],
    ["Replacement-stage pages", summary.competitorReplacementStagePages],
    ["Canonical first pages", summary.canonicalDecisionPages],
  ];
  const pageTable = makeTable(controlRows.slice(0, 35), [
    { label: "Page", html: true, value: (row) => linkCell(row.url, row.title) },
    { label: "Category", value: (row) => row.category },
    { label: "Status", value: (row) => row.pageStatus },
    { label: "AI Stage", value: (row) => row.visibilityStage },
    { label: "Workstream", value: (row) => row.workstream },
    { label: "Risk", value: (row) => row.visibilityRiskScore },
    { label: "Competitor-only", value: (row) => row.competitorOnlyAnswers },
    { label: "Competitors", value: (row) => row.competitors.slice(0, 5).join("; ") },
    { label: "Action", value: (row) => row.primaryAction },
  ]);
  const topicTable = makeTable(topicRows, [
    { label: "Category", value: (row) => row.category },
    { label: "Pages", value: (row) => row.pages },
    { label: "Benchmark pages", value: (row) => row.benchmarkPages },
    { label: "Competitor-only", value: (row) => row.competitorOnlyAnswers },
    { label: "Zero mentions", value: (row) => row.zeroMentionQueries },
    { label: "Avg citability", value: (row) => row.avgCitability },
    { label: "Top competitors", value: (row) => row.topCompetitors.slice(0, 6).join("; ") },
    { label: "AI stages", value: (row) => row.topVisibilityStages.slice(0, 4).join("; ") },
  ]);
  const evidenceTable = makeTable(evidenceRows.slice(0, 30), [
    { label: "Page", html: true, value: (row) => linkCell(row.url, row.title) },
    { label: "Provider", value: (row) => row.provider },
    { label: "Prompt", value: (row) => row.query },
    { label: "Outcome", value: (row) => row.outcome },
    { label: "Competitors", value: (row) => row.competitors.slice(0, 5).join("; ") },
    { label: "Snippet", value: (row) => row.snippet },
  ]);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>iBOLT Blog Post Visibility Control Report</title>
  <style>
    :root { color-scheme: light; --ink:#0f172a; --muted:#64748b; --line:#d9e2ec; --blue:#1d4ed8; --bg:#f8fafc; }
    body { margin:0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:var(--bg); color:var(--ink); }
    main { max-width:1240px; margin:0 auto; padding:34px 24px 60px; }
    h1 { font-size:36px; line-height:1.08; margin:0 0 12px; letter-spacing:0; }
    h2 { font-size:24px; margin:38px 0 14px; letter-spacing:0; }
    p { color:#334155; line-height:1.65; max-width:1000px; }
    .hero, .panel { background:#fff; border:1px solid var(--line); border-radius:8px; padding:24px; box-shadow:0 10px 28px rgba(15,23,42,.06); }
    .kpis { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin-top:22px; }
    .kpi { border:1px solid var(--line); border-radius:8px; padding:16px; background:#fff; }
    .kpi strong { display:block; font-size:28px; line-height:1.1; }
    .kpi span { display:block; margin-top:6px; color:var(--muted); font-size:13px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; }
    .grid { display:grid; grid-template-columns:1fr 1fr; gap:18px; margin-top:20px; }
    img.chart { width:100%; height:auto; display:block; border:1px solid var(--line); border-radius:8px; background:#fff; }
    table { width:100%; border-collapse:collapse; background:#fff; border:1px solid var(--line); border-radius:8px; overflow:hidden; }
    th,td { text-align:left; vertical-align:top; border-bottom:1px solid var(--line); padding:11px 12px; font-size:13px; line-height:1.45; }
    th { background:#eef4ff; color:#1e3a8a; font-size:12px; text-transform:uppercase; letter-spacing:.05em; }
    tr:last-child td { border-bottom:0; }
    a { color:var(--blue); font-weight:800; }
    .callout { border-left:4px solid var(--blue); background:#eff6ff; padding:14px 16px; border-radius:8px; color:#1e3a8a; }
    @media (max-width:900px){ .kpis,.grid{grid-template-columns:1fr} h1{font-size:30px} }
  </style>
</head>
<body>
<main>
  <section class="hero">
    <h1>iBOLT Blog Post Visibility Control Report</h1>
    <p>This report uses every live blog page as the spine, then joins benchmark pressure, competitor replacement evidence, citation readiness, lifecycle status, conversion opportunity, and product/entity gaps.</p>
    <div class="kpis">
      ${kpis.map(([label, value]) => `<div class="kpi"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join("")}
    </div>
  </section>
  <h2>Operating Readout</h2>
  <section class="panel">
    <p class="callout"><strong>What this adds:</strong> the benchmark is no longer just a prompt report. It is now mapped back to the blog inventory, so the edit queue can be managed page by page.</p>
    <div class="grid">
      <img class="chart" src="${escapeHtml(priorityChartName)}" alt="Highest priority pages">
      <img class="chart" src="${escapeHtml(topicChartName)}" alt="Topic pressure by competitor-only answers">
    </div>
    <div style="margin-top:18px;">
      <img class="chart" src="${escapeHtml(workstreamChartName)}" alt="Workstream page counts">
    </div>
  </section>
  <h2>Highest Priority Pages</h2>
  ${pageTable}
  <h2>Topic Pressure</h2>
  ${topicTable}
  <h2>Mapped Answer Evidence</h2>
  ${evidenceTable}
</main>
</body>
</html>`;
}

async function main() {
  const benchmarkDir = process.argv[2] ? path.resolve(process.argv[2]) : await latestDir(BENCHMARK_PREFIX);
  const outputDir = path.join(benchmarkDir, "blog-post-visibility-control-report");
  await mkdir(outputDir, { recursive: true });

  const dossier = await readJsonIfExists(path.join(benchmarkDir, "all-blog-post-dossier", "all-blog-post-dossier-data.json"), null);
  const citation = await readJsonIfExists(path.join(benchmarkDir, "citation-readiness-map", "citation-readiness-data.json"), { pageRows: [] });
  const conversion = await readJsonIfExists(path.join(benchmarkDir, "blog-conversion-opportunity-map", "blog-conversion-opportunity-data.json"), { pageRows: [] });
  const lifecycle = await readJsonIfExists(path.join(benchmarkDir, "blog-lifecycle-map", "blog-lifecycle-data.json"), { ledger: [] });
  const snippetData = await readJsonIfExists(path.join(benchmarkDir, "answer-snippet-evidence-appendix", "answer-snippet-evidence-data.json"), {});
  const queryRows = await readCsvIfExists(path.join(benchmarkDir, "query-page-matrix", "all-query-page-matrix.csv"));
  if (!dossier?.pageRows?.length) {
    throw new Error("Missing all-blog-post-dossier-data.json. Run scripts/build-ai-all-blog-post-dossier.mjs first.");
  }

  const evidenceByUrl = aggregateEvidence(snippetData);
  const controlRows = buildControlRows({
    dossierRows: dossier.pageRows,
    citationRows: citation.pageRows || [],
    conversionRows: conversion.pageRows || [],
    lifecycleRows: lifecycle.ledger || [],
    queryRows,
    evidenceByUrl,
  });
  const topicRows = buildTopicRows(controlRows);
  const evidenceRows = buildEvidenceRows(controlRows);
  const workstreamRows = countValues(controlRows.map((row) => row.workstream));
  const summary = {
    benchmarkDir,
    outputDir,
    pages: controlRows.length,
    benchmarkPressurePages: controlRows.filter((row) => row.benchmarkQueryCount > 0).length,
    competitorOnlyPages: controlRows.filter((row) => row.competitorOnlyAnswers > 0 || row.replacementSnippets > 0).length,
    competitorOnlyAnswers: controlRows.reduce((sum, row) => sum + row.competitorOnlyAnswers, 0),
    zeroMentionQueries: controlRows.reduce((sum, row) => sum + row.zeroMentionQueries, 0),
    citationCleanupPages: controlRows.filter((row) => /citation|schema|cleanup/i.test(`${row.citationReadinessBucket} ${row.lifecycleBucket}`)).length,
    canonicalDecisionPages: controlRows.filter((row) => /canonical/i.test(`${row.pageStatus} ${row.lifecycleBucket} ${row.actionBucket}`)).length,
    competitorReplacementStagePages: controlRows.filter((row) => row.visibilityStage === "Competitor replacement").length,
    zeroMentionStagePages: controlRows.filter((row) => row.visibilityStage === "Zero mention").length,
    coMentionStagePages: controlRows.filter((row) => row.visibilityStage === "Co-mentioned with competitors").length,
    cleanMentionStagePages: controlRows.filter((row) => row.visibilityStage === "Clean iBOLT mention").length,
    productEntityPages: controlRows.filter((row) => row.productEntityQueueRows > 0 || row.productsToFeature.length > 0).length,
    cleanMentionPages: controlRows.filter((row) => row.cleanMentions > 0).length,
    coMentionPages: controlRows.filter((row) => row.coMentions > 0).length,
    replacementSnippetPages: controlRows.filter((row) => row.replacementSnippets > 0).length,
    topPages: controlRows.slice(0, 10).map((row) => `${row.title} ${row.visibilityRiskScore}`),
    topTopics: topicRows.slice(0, 8).map((row) => `${row.category} ${row.competitorOnlyAnswers}`),
    topWorkstreams: workstreamRows.slice(0, 8).map((row) => `${row.name} ${row.count}`),
  };

  const priorityChartName = "highest-priority-pages.svg";
  const topicChartName = "topic-competitor-pressure.svg";
  const workstreamChartName = "workstream-page-counts.svg";
  await writeFile(path.join(outputDir, priorityChartName), chartSvg({
    title: "Highest Priority Blog Pages",
    subtitle: "Visibility risk combines existing page priority, zero mentions, competitor-only answers, and snippet evidence",
    rows: controlRows.slice(0, 10).map((row) => ({ name: row.title, value: row.visibilityRiskScore })),
    color: "#b91c1c",
    height: 520,
  }));
  await writeFile(path.join(outputDir, topicChartName), chartSvg({
    title: "Topic Pressure By Competitor-Only Answers",
    subtitle: "Shows where AI answers most often replace iBOLT with competitors",
    rows: topicRows.slice(0, 10).map((row) => ({ name: row.category, value: row.competitorOnlyAnswers })),
    color: "#1d4ed8",
  }));
  await writeFile(path.join(outputDir, workstreamChartName), chartSvg({
    title: "Page Count By Workstream",
    subtitle: "How to split the blog backlog before editing everything at once",
    rows: workstreamRows.map((row) => ({ name: row.name, value: row.count })),
    color: "#0f766e",
  }));

  await writeFile(path.join(outputDir, "blog-page-control-ledger.csv"), toCsv([
    ["rank", "visibility_risk_score", "priority_score", "title", "url", "category", "page_status", "ai_visibility_stage", "workstream", "action_bucket", "lifecycle_bucket", "citation_readiness_bucket", "conversion_tier", "ai_citability_score", "word_count", "product_links", "product_entity_targets", "product_entity_queue_rows", "benchmark_query_count", "zero_mention_queries", "competitor_only_answers", "clean_mentions", "co_mentions", "replacement_snippets", "competitors", "linked_prompts", "query_prompts", "weakest_providers", "issue_count", "issue_flags", "products_to_feature", "source_targets", "canonical_or_survivor_ticket", "primary_action", "citation_action", "checkout_action", "cta_button_guidance", "retest_prompts", "evidence_provider", "evidence_query", "evidence_outcome", "evidence_snippet", "evidence_answer_file"],
    ...controlRows.map((row, index) => [index + 1, row.visibilityRiskScore, row.priorityScore, row.title, row.url, row.category, row.pageStatus, row.visibilityStage, row.workstream, row.actionBucket, row.lifecycleBucket, row.citationReadinessBucket, row.conversionTier, row.aiCitabilityScore, row.wordCount, row.productLinks, row.productEntityTargets, row.productEntityQueueRows, row.benchmarkQueryCount, row.zeroMentionQueries, row.competitorOnlyAnswers, row.cleanMentions, row.coMentions, row.replacementSnippets, row.competitors, row.linkedPrompts, row.queryPrompts, row.weakestProviders, row.issueCount, row.issueFlags, row.productsToFeature, row.sourceTargets, row.canonicalOrSurvivorTicket, row.primaryAction, row.citationAction, row.checkoutAction, row.ctaButtonGuidance, row.retestPrompts, row.evidenceProvider, row.evidenceQuery, row.evidenceOutcome, row.evidenceSnippet, row.evidenceAnswerFile]),
  ]));
  await writeFile(path.join(outputDir, "topic-page-control-summary.csv"), toCsv([
    ["category", "pages", "benchmark_pages", "zero_mention_queries", "competitor_only_answers", "clean_mentions", "co_mentions", "replacement_snippets", "avg_priority", "avg_citability", "top_competitors", "top_workstreams", "top_visibility_stages", "top_pages"],
    ...topicRows.map((row) => [row.category, row.pages, row.benchmarkPages, row.zeroMentionQueries, row.competitorOnlyAnswers, row.cleanMentions, row.coMentions, row.replacementSnippets, row.avgPriority, row.avgCitability, row.topCompetitors, row.topWorkstreams, row.topVisibilityStages, row.topPages]),
  ]));
  await writeFile(path.join(outputDir, "page-evidence-snippets.csv"), toCsv([
    ["title", "url", "category", "provider", "query", "outcome", "competitors", "snippet", "next_action", "answer_file"],
    ...evidenceRows.map((row) => [row.title, row.url, row.category, row.provider, row.query, row.outcome, row.competitors, row.snippet, row.nextAction, row.answerFile]),
  ]));

  await writeFile(path.join(outputDir, "blog-post-visibility-control-data.json"), `${JSON.stringify({ summary, controlRows, topicRows, evidenceRows }, null, 2)}\n`);
  await writeFile(path.join(outputDir, "REPORT.md"), buildMarkdown({ summary, topicRows, controlRows, evidenceRows, outputDir }));
  await writeFile(path.join(outputDir, "REPORT.html"), buildHtml({ summary, topicRows, controlRows, evidenceRows, priorityChartName, topicChartName, workstreamChartName }));

  console.log(`Blog post visibility control report written to ${outputDir}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
