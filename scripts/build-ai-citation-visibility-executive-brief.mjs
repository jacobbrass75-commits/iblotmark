#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";
const REPORT_DIR = "citation-visibility-executive-brief";

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

async function readTextIfExists(filePath, fallback = "") {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return fallback;
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  const [headers, ...body] = rows.filter((line) => line.some((cell) => String(cell).trim()));
  if (!headers) return [];
  return body.map((line) => Object.fromEntries(headers.map((header, index) => [header, line[index] ?? ""])));
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function csv(rows) {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toNumber(value) {
  if (typeof value === "number") return value;
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function short(value, length = 120) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function kpiSvg(kpis) {
  const width = 980;
  const rowHeight = 54;
  const height = 92 + kpis.length * rowHeight;
  const max = Math.max(1, ...kpis.map((row) => toNumber(row.current)));
  const rows = kpis.map((row, index) => {
    const y = 68 + index * rowHeight;
    const current = toNumber(row.current);
    const target = toNumber(row.target);
    const currentWidth = Math.round((current / max) * 430);
    const targetWidth = target ? Math.round((target / max) * 430) : 0;
    const good = row.direction === "down" ? "#dc2626" : "#0f766e";
    return `<g>
      <text x="26" y="${y + 17}" font-size="14" font-weight="900" fill="#111827">${escapeHtml(row.label)}</text>
      <rect x="302" y="${y - 1}" width="430" height="18" rx="9" fill="#e5e7eb"/>
      ${targetWidth ? `<rect x="302" y="${y - 1}" width="${targetWidth}" height="18" rx="9" fill="#bfdbfe"/>` : ""}
      <rect x="302" y="${y - 1}" width="${currentWidth}" height="18" rx="9" fill="${good}"/>
      <text x="755" y="${y + 13}" font-size="13" font-weight="900" fill="#111827">Now ${escapeHtml(row.current)}${row.unit}</text>
      <text x="860" y="${y + 13}" font-size="13" fill="#475569">Target ${escapeHtml(row.target)}${row.target === "lower" ? "" : row.unit}</text>
      <text x="302" y="${y + 36}" font-size="12" fill="#64748b">${escapeHtml(row.note)}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="AI visibility KPI baseline">
    <rect width="${width}" height="${height}" rx="18" fill="#fff"/>
    <text x="26" y="34" font-size="24" font-weight="900" fill="#111827">AI Visibility KPI Baseline</text>
    <text x="26" y="56" font-size="13" fill="#64748b">Citation matters, but inclusion and recommendation must move first.</text>
    ${rows}
  </svg>`;
}

function sequenceSvg(rows) {
  const width = 980;
  const height = 330;
  const colors = ["#0f766e", "#2563eb", "#7c3aed", "#f97316", "#334155"];
  const cells = rows.map((row, index) => {
    const x = 24 + index * 188;
    return `<g>
      <rect x="${x}" y="82" width="170" height="196" rx="16" fill="#fff" stroke="#dbe3ef"/>
      <circle cx="${x + 28}" cy="110" r="16" fill="${colors[index] || "#0f766e"}"/>
      <text x="${x + 28}" y="116" text-anchor="middle" font-size="15" font-weight="900" fill="#fff">${index + 1}</text>
      <text x="${x + 16}" y="148" font-size="15" font-weight="900" fill="#111827">${escapeHtml(row.phase)}</text>
      <text x="${x + 16}" y="173" font-size="12" font-weight="800" fill="#475569">${escapeHtml(row.owner)}</text>
      <foreignObject x="${x + 16}" y="186" width="138" height="72">
        <div xmlns="http://www.w3.org/1999/xhtml" style="font:12px Arial;color:#475569;line-height:1.35">${escapeHtml(row.action)}</div>
      </foreignObject>
      <foreignObject x="${x + 16}" y="244" width="138" height="28">
        <div xmlns="http://www.w3.org/1999/xhtml" style="font:bold 11px Arial;color:#111827;line-height:1.25">${escapeHtml(row.success_metric)}</div>
      </foreignObject>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="AI visibility work sequence">
    <rect width="${width}" height="${height}" rx="18" fill="#f8fafc"/>
    <text x="24" y="36" font-size="24" font-weight="900" fill="#111827">Recommended Work Sequence</text>
    <text x="24" y="58" font-size="13" fill="#64748b">Do not start with backlinks alone. First make iBOLT easier for AI systems to include and cite.</text>
    ${cells}
  </svg>`;
}

function table(headers, rows, limit = 20) {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header.label)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.slice(0, limit).map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header.key])}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table>${head}${body}</table>`;
}

function renderHtml({ summary, kpiRows, sequenceRows, ownerRows, pageRows, topicRows, competitorRows, platformRows }) {
  const cards = [
    ["Verdict", "Track citations", "Needed for AI search, but not the first bottleneck."],
    ["Citation rate", `${summary.citationRate}%`, "Current target-domain citation rate."],
    ["Mention rate", `${summary.mentionRate}%`, "Models know iBOLT exists, but not consistently."],
    ["Non-branded", `${summary.nonBrandedMentionRate}%`, "The broad buyer-prompt problem."],
    ["Replacement rows", summary.uniqueReplacementRows, "Competitor-only answer rows."],
    ["Priority retest", summary.priorityRequests, "Requests ready after edits."],
  ].map(([label, value, note]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT Citation And Visibility Executive Brief</title>
  <style>
    body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1220px;margin:0 auto;padding:34px 24px 70px}
    h1{font-size:36px;margin:0 0 8px}
    h2{font-size:22px;margin:34px 0 12px}
    p,li{line-height:1.55;color:#334155;font-size:15px}
    .note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #0f766e;border-radius:12px;padding:16px 18px;margin:20px 0}
    .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:22px 0}
    .card{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:15px}
    .label{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:900}
    .value{font-size:27px;font-weight:900;margin:8px 0;color:#0f172a}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
    .chart{background:#fff;border:1px solid #dbe3ef;border-radius:18px;padding:10px;overflow:auto}
    .chart img{width:100%;height:auto;display:block}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 24px}
    th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    a{color:#0f766e;overflow-wrap:anywhere}
    @media(max-width:900px){.grid{grid-template-columns:1fr}h1{font-size:30px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT Citation And Visibility Executive Brief</h1>
  <p>This answers the practical question: should citation rate go up, how is visibility doing, and what should happen before the SEO contractor pushes links and mentions.</p>
  <div class="note"><strong>Decision:</strong> Yes, citation rate should be a KPI for Google AI Overviews, Perplexity, Gemini with search, ChatGPT search, and shopping assistants. But the current bottleneck is inclusion. iBOLT is mentioned in ${summary.mentionRate}% of answers, only ${summary.nonBrandedMentionRate}% of non-branded answers, and cited in ${summary.citationRate}% of answers. The first move is page cleanup and competitor displacement recovery, then citation outreach.</div>
  <section class="cards">${cards}</section>
  <section class="grid">
    <div class="chart"><img src="visibility-kpi-baseline.svg" alt="Visibility KPI baseline"/></div>
    <div class="chart"><img src="citation-work-sequence.svg" alt="Citation work sequence"/></div>
  </section>
  <h2>What To Do First</h2>
  ${table([
    { label: "Phase", key: "phase" },
    { label: "Owner", key: "owner" },
    { label: "Action", key: "action" },
    { label: "Evidence", key: "evidence" },
    { label: "Success metric", key: "success_metric" },
  ], sequenceRows)}
  <h2>What To Offload</h2>
  ${table([
    { label: "Owner", key: "owner" },
    { label: "Workstream", key: "workstream" },
    { label: "Do", key: "do" },
    { label: "Do not offload", key: "do_not" },
  ], ownerRows)}
  <h2>First Pages Before Citation Outreach</h2>
  ${table([
    { label: "Score", key: "score" },
    { label: "Lane", key: "lane" },
    { label: "Page", key: "title" },
    { label: "Category", key: "category" },
    { label: "Top fix", key: "top_fix" },
    { label: "Next action", key: "action" },
  ], pageRows, 12)}
  <h2>Citation Topics And Competitors</h2>
  <div class="grid">
    ${table([
      { label: "Topic", key: "category" },
      { label: "Mention", key: "current_mention_rate" },
      { label: "Competitor-only", key: "competitor_only_answers" },
      { label: "Source targets", key: "source_targets" },
    ], topicRows, 8)}
    ${table([
      { label: "Competitor", key: "brand" },
      { label: "Lost", key: "lost_answers" },
      { label: "Co-mentions", key: "co_mentioned_wins" },
      { label: "Off-site target", key: "offsite_target" },
    ], competitorRows, 8)}
  </div>
  <h2>Platform Reading</h2>
  ${table([
    { label: "Platform", key: "platform" },
    { label: "Priority", key: "citation_priority" },
    { label: "Why", key: "why" },
    { label: "Next measure", key: "next_measure" },
  ], platformRows, 8)}
  <h2>Source Reports</h2>
  <ul>
    <li><a href="../citation-priority-model/REPORT.html">Citation priority model</a></li>
    <li><a href="../visibility-citation-bridge/REPORT.html">Visibility to citation bridge</a></li>
    <li><a href="../competitor-comparison-dossier/REPORT.html">Competitor comparison dossier</a></li>
    <li><a href="../all-blog-action-control-sheet/REPORT.html">All-blog action control sheet</a></li>
    <li><a href="../priority-retest-packet/REPORT.html">Priority retest packet</a></li>
  </ul>
</main>
</body>
</html>`;
}

function renderMarkdown({ summary, sequenceRows, ownerRows, pageRows, topicRows, competitorRows, platformRows }) {
  return `# iBOLT Citation And Visibility Executive Brief

## Decision

Yes, citation rate should be a KPI, especially for Google AI Overviews, Perplexity, Gemini with search, ChatGPT search, and shopping assistants. It is not the first bottleneck. The first bottleneck is inclusion.

- Overall mention rate: ${summary.mentionRate}%
- Non-branded mention rate: ${summary.nonBrandedMentionRate}%
- Top-3 recommendation rate: ${summary.topThreeRate}%
- Target-domain citation rate: ${summary.citationRate}%
- Unique competitor-replacement answer rows: ${summary.uniqueReplacementRows}
- Brand replacement occurrences: ${summary.brandReplacementOccurrences}
- Priority retest packet: ${summary.priorityRequests} provider requests
- Full all-blog retest: ${summary.fullProviderRequests} provider requests

## Sequence

${sequenceRows.map((row) => `- ${row.phase}: ${row.owner}. ${row.action} Success metric: ${row.success_metric}`).join("\n")}

## Work Split

${ownerRows.map((row) => `- ${row.owner}: ${row.workstream}. Do: ${row.do} Do not offload: ${row.do_not}`).join("\n")}

## First Pages Before Citation Outreach

${pageRows.slice(0, 12).map((row) => `- ${row.title}: ${row.category}, ${row.top_fix}. ${row.action}`).join("\n")}

## Topics To Support With External Mentions

${topicRows.slice(0, 8).map((row) => `- ${row.category}: mention ${row.current_mention_rate}%, competitor-only ${row.competitor_only_answers}. Source targets: ${row.source_targets}`).join("\n")}

## Competitor Citation Context

${competitorRows.slice(0, 8).map((row) => `- ${row.brand}: ${row.lost_answers} lost answers, ${row.co_mentioned_wins} co-mentions. ${row.offsite_target}`).join("\n")}

## Platform Reading

${platformRows.map((row) => `- ${row.platform}: ${row.citation_priority}. Measure: ${row.next_measure}`).join("\n")}
`;
}

async function main() {
  const benchmarkDir = process.argv[2] ? path.resolve(process.argv[2]) : await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, REPORT_DIR);
  await mkdir(outDir, { recursive: true });

  const kpiData = await readJsonIfExists(path.join(benchmarkDir, "visibility-kpi-retest-ladder", "visibility-kpi-ladder-data.json"), {});
  const kpi = kpiData.summary || kpiData;
  const citationData = await readJsonIfExists(path.join(benchmarkDir, "citation-priority-model", "citation-priority-model-data.json"), {});
  const citation = citationData.summary || citationData;
  const competitor = (await readJsonIfExists(path.join(benchmarkDir, "competitor-comparison-dossier", "competitor-comparison-data.json"), { summary: {} })).summary || {};
  const priorityRetestData = await readJsonIfExists(path.join(benchmarkDir, "priority-retest-packet", "priority-retest-data.json"), {});
  const priorityRetest = priorityRetestData.summary || priorityRetestData;
  const actionControlData = await readJsonIfExists(path.join(benchmarkDir, "all-blog-action-control-sheet", "all-blog-action-control-data.json"), {});
  const actionControl = actionControlData.summary || actionControlData;
  const portfolio = (await readJsonIfExists(path.join(benchmarkDir, "portfolio-product-spread-analysis", "portfolio-product-spread-data.json"), { summary: {} })).summary || {};

  const pageRows = parseCsv(await readTextIfExists(path.join(benchmarkDir, "citation-priority-model", "page-citation-priority-model.csv")))
    .slice(0, 18)
    .map((row) => ({
      ...row,
      title: short(row.title, 90),
      action: short(row.action || row.citation_next_action, 130),
    }));
  const topicRows = parseCsv(await readTextIfExists(path.join(benchmarkDir, "citation-priority-model", "topic-citation-priority-model.csv")))
    .slice(0, 10)
    .map((row) => ({ ...row, source_targets: short(row.source_targets, 125) }));
  const competitorRows = parseCsv(await readTextIfExists(path.join(benchmarkDir, "citation-priority-model", "competitor-citation-priority-model.csv")))
    .slice(0, 10)
    .map((row) => ({ ...row, offsite_target: short(row.offsite_target, 120) }));
  const platformRows = parseCsv(await readTextIfExists(path.join(benchmarkDir, "citation-priority-model", "platform-citation-kpi-matrix.csv")));

  const summary = {
    generated_at: new Date().toISOString(),
    benchmark_dir: benchmarkDir,
    mentionRate: toNumber(kpi.mentionRate || citation.mentionRate),
    nonBrandedMentionRate: toNumber(kpi.nonBrandedMentionRate || citation.nonBrandedMentionRate),
    topThreeRate: toNumber(kpi.topThreeRate || citation.topThreeRate),
    citationRate: toNumber(kpi.citationRate || citation.citationRate),
    competitorOnlyRate: toNumber(kpi.competitorOnlyRate),
    uniqueReplacementRows: toNumber(competitor.unique_replacement_answer_rows || citation.competitorOnlyAnswers),
    brandReplacementOccurrences: toNumber(competitor.brand_replacement_occurrences),
    mentionRecoveryPages: toNumber(citation.mentionRecoveryPages || actionControl.mentionRecoveryPages),
    sourceCleanupPages: toNumber(citation.sourceCleanupPages || actionControl.sourceCleanupPages),
    quickAnswerPages: toNumber(actionControl.quickAnswerPages),
    schemaPages: toNumber(actionControl.schemaPages),
    comparisonPages: toNumber(actionControl.comparisonPages),
    ctaCleanupPages: toNumber(actionControl.ctaCleanupPages),
    citationOutreachCandidates: toNumber(citation.citationOutreachCandidates || actionControl.citationOutreachCandidates),
    citationLiftNeeded: toNumber(kpi.citationLiftNeeded || citation.citationLiftNeeded),
    mentionLiftNeeded: toNumber(kpi.mentionLiftNeeded || citation.mentionLiftNeeded),
    topThreeLiftNeeded: toNumber(kpi.topThreeLiftNeeded),
    competitorOnlyReductionNeeded: toNumber(kpi.competitorOnlyReductionNeeded),
    priorityRequests: toNumber(priorityRetest.priorityProviderRequests || kpi.priorityRequests),
    priorityPrompts: toNumber(priorityRetest.uniquePrompts || kpi.priorityPrompts),
    fullProviderRequests: toNumber(kpi.fullProviderRequests || priorityRetest.fullProviderRequests),
    fullPrompts: toNumber(kpi.fullPrompts),
    portfolioPages: toNumber(portfolio.pages),
    topFamily: portfolio.top_family || "",
    topCategory: portfolio.top_category || citation.topTopic || "",
  };

  const kpiRows = [
    { label: "Mention rate", current: summary.mentionRate, target: 35, unit: "%", direction: "up", note: "Do models include iBOLT at all?" },
    { label: "Non-branded mention", current: summary.nonBrandedMentionRate, target: 15, unit: "%", direction: "up", note: "Do broad buyer prompts include iBOLT?" },
    { label: "Top-3 recommendation", current: summary.topThreeRate, target: 25, unit: "%", direction: "up", note: "Is iBOLT recommended, not just named?" },
    { label: "Citation rate", current: summary.citationRate, target: 8, unit: "%", direction: "up", note: "Do search-connected systems cite iboltmounts.com?" },
    { label: "Competitor-only answers", current: summary.competitorOnlyRate, target: "lower", unit: "%", direction: "down", note: "How often competitors appear without iBOLT." },
  ];

  const sequenceRows = [
    {
      phase: "Inclusion recovery",
      owner: "Jacob/app",
      action: "Edit priority pages with query-exact quick answers, exact product modules, fair competitor tradeoff blocks, and FAQ/Article schema.",
      evidence: `${summary.mentionRecoveryPages} mention-recovery pages, ${summary.uniqueReplacementRows} unique competitor-replacement rows.`,
      success_metric: `+${summary.mentionLiftNeeded} mentions, +8 non-branded mentions, ${summary.competitorOnlyReductionNeeded} fewer competitor-only rows.`,
    },
    {
      phase: "Recommendation lift",
      owner: "Jacob/app",
      action: "Make iBOLT the workflow specialist beside RAM, Arkon, iOttie, ProClip, CTA Digital, and Mount-It.",
      evidence: `${competitor.tier1_competitors || 0} Tier 1 competitors, ${competitor.page_targets || 0} mapped page targets.`,
      success_metric: `+${summary.topThreeLiftNeeded} top-3 recommendations.`,
    },
    {
      phase: "Source cleanup",
      owner: "Jacob/app",
      action: "Fix quick answers, schema, product-name accuracy, image alt text, internal links, and CTA density before asking outside sites to cite the pages.",
      evidence: `${summary.sourceCleanupPages} source-cleanup pages, ${summary.quickAnswerPages} quick-answer edits, ${summary.schemaPages} schema edits.`,
      success_metric: "Priority pages become source-ready and stable enough for outreach.",
    },
    {
      phase: "Citation outreach",
      owner: "SEO contractor",
      action: "Earn neutral third-party mentions and links on category pages, industry resources, comparison pages, and partner/reseller pages.",
      evidence: `${summary.citationOutreachCandidates} pages should skip cleanup and go straight to outreach right now.`,
      success_metric: `+${summary.citationLiftNeeded} target-domain citations or source-url rows after cleanup.`,
    },
    {
      phase: "Retest",
      owner: "Jacob/app",
      action: "Run the priority packet first, then the full all-blog manifest after first-wave edits are live.",
      evidence: `${summary.priorityRequests} priority provider requests, ${summary.fullProviderRequests} full all-blog provider requests.`,
      success_metric: "Track mention, non-branded mention, top-3, citation, and competitor-only rates by provider.",
    },
  ];

  const ownerRows = [
    {
      owner: "Jacob/app",
      workstream: "On-site page and product truth",
      do: "Quick-answer blocks, schema, product-card modules, verified Shopify product names, comparison language, CTA cleanup, retesting.",
      do_not: "Do not offload product claims, Shopify publishing decisions, schema implementation, or final page QA.",
    },
    {
      owner: "SEO contractor",
      workstream: "Off-site corroboration",
      do: "Find and earn category mentions, competitor-adjacent citations, industry resource links, list placements, and partner/reseller references.",
      do_not: "Do not rewrite iBOLT positioning as cheaper than RAM or create unsupported product claims.",
    },
    {
      owner: "Shared",
      workstream: "AEO/GEO reporting",
      do: "Use the same prompt sets and retest windows so backlink work can be tied to actual AI answer movement.",
      do_not: "Do not judge success from domain authority alone. Track AI mention, citation, top-3, and competitor-only movement.",
    },
  ];

  await writeFile(path.join(outDir, "citation-visibility-executive-data.json"), JSON.stringify({
    summary,
    kpiRows,
    sequenceRows,
    ownerRows,
    pageRows,
    topicRows,
    competitorRows,
    platformRows,
  }, null, 2));
  await writeFile(path.join(outDir, "citation-visibility-work-sequence.csv"), csv([
    ["phase", "owner", "action", "evidence", "success_metric"],
    ...sequenceRows.map((row) => [row.phase, row.owner, row.action, row.evidence, row.success_metric]),
  ]));
  await writeFile(path.join(outDir, "citation-visibility-owner-split.csv"), csv([
    ["owner", "workstream", "do", "do_not"],
    ...ownerRows.map((row) => [row.owner, row.workstream, row.do, row.do_not]),
  ]));
  await writeFile(path.join(outDir, "first-pages-before-citation.csv"), csv([
    ["score", "lane", "title", "url", "category", "top_fix", "action"],
    ...pageRows.map((row) => [row.score, row.lane, row.title, row.url, row.category, row.top_fix, row.action]),
  ]));
  await writeFile(path.join(outDir, "visibility-kpi-baseline.svg"), kpiSvg(kpiRows));
  await writeFile(path.join(outDir, "citation-work-sequence.svg"), sequenceSvg(sequenceRows));
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml({ summary, kpiRows, sequenceRows, ownerRows, pageRows, topicRows, competitorRows, platformRows }));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown({ summary, sequenceRows, ownerRows, pageRows, topicRows, competitorRows, platformRows }));

  console.log(`Wrote ${outDir}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
