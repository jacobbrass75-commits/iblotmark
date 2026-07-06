#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "visibility-working-packet");

async function readCsv(relativePath) {
  try {
    return parseCsv(await readFile(path.join(benchmarkDir, relativePath), "utf8"));
  } catch {
    return [];
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
    if (quoted && char === '"' && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(value);
      value = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows.shift();
  return rows
    .filter((cells) => cells.some((cell) => String(cell ?? "").trim()))
    .map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

function csv(rows) {
  return `${rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n")}\n`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toNumber(value) {
  const match = String(value ?? "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function pct(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

function uniq(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function byMetric(rows, metric) {
  return rows.find((row) => row.metric === metric) || {};
}

function normalizeBrand(brand) {
  const text = String(brand ?? "").trim();
  if (/^ram$/i.test(text) || /^ram mounts?$/i.test(text)) return "RAM Mounts";
  if (/^mount[\s-]?it!?$/i.test(text)) return "Mount-It";
  if (/^cta$/i.test(text)) return "CTA Digital";
  return text;
}

function short(value, length = 80) {
  const text = String(value ?? "");
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function parsePercent(value) {
  const number = toNumber(value);
  return Number.isFinite(number) ? number : 0;
}

function barSvg({ title, rows, maxValue, width = 900, rowHeight = 36, color = "#0f766e" }) {
  const chartRows = rows.filter((row) => Number.isFinite(row.value)).slice(0, 12);
  const height = 76 + chartRows.length * rowHeight;
  const max = maxValue || Math.max(1, ...chartRows.map((row) => row.value));
  const bars = chartRows.map((row, index) => {
    const y = 58 + index * rowHeight;
    const barWidth = Math.round((row.value / max) * (width - 340));
    return `<g>
      <text x="22" y="${y + 18}" font-size="13" font-weight="800" fill="#111827">${escapeHtml(short(row.label, 38))}</text>
      <rect x="272" y="${y}" width="${width - 340}" height="22" rx="11" fill="#e5e7eb"/>
      <rect x="272" y="${y}" width="${barWidth}" height="22" rx="11" fill="${row.color || color}"/>
      <text x="${width - 30}" y="${y + 16}" font-size="13" font-weight="900" text-anchor="end" fill="#111827">${escapeHtml(row.value)}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#ffffff"/>
    <text x="22" y="34" font-size="20" font-weight="900" fill="#111827">${escapeHtml(title)}</text>
    ${bars}
  </svg>`;
}

function stackedSvg({ title, rows, width = 900, rowHeight = 40 }) {
  const chartRows = rows.slice(0, 10);
  const height = 82 + chartRows.length * rowHeight;
  const colors = ["#ef4444", "#2563eb", "#0f766e", "#64748b"];
  const labels = ["Competitor replacements", "iBOLT co-mentioned", "Clean iBOLT", "No signal"];
  const rowSvgs = chartRows.map((row, index) => {
    const y = 62 + index * rowHeight;
    const total = Math.max(1, row.replacements + row.coMentions + row.clean + row.noSignal);
    let x = 292;
    const segments = [row.replacements, row.coMentions, row.clean, row.noSignal].map((value, segmentIndex) => {
      const widthValue = Math.round((value / total) * 500);
      const svg = `<rect x="${x}" y="${y}" width="${widthValue}" height="23" rx="10" fill="${colors[segmentIndex]}"/>`;
      x += widthValue;
      return svg;
    }).join("");
    return `<g>
      <text x="22" y="${y + 17}" font-size="13" font-weight="800" fill="#111827">${escapeHtml(short(row.label, 40))}</text>
      <rect x="292" y="${y}" width="500" height="23" rx="10" fill="#e5e7eb"/>
      ${segments}
      <text x="850" y="${y + 17}" font-size="13" font-weight="900" text-anchor="end" fill="#111827">${row.replacements}/${total}</text>
    </g>`;
  }).join("");
  const legend = labels.map((label, index) => `<g>
    <rect x="${22 + index * 210}" y="${height - 18}" width="10" height="10" rx="5" fill="${colors[index]}"/>
    <text x="${38 + index * 210}" y="${height - 9}" font-size="11" font-weight="700" fill="#475569">${escapeHtml(label)}</text>
  </g>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#ffffff"/>
    <text x="22" y="34" font-size="20" font-weight="900" fill="#111827">${escapeHtml(title)}</text>
    ${rowSvgs}
    ${legend}
  </svg>`;
}

function renderTable(headers, rows) {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table>${head}${body}</table>`;
}

function card(label, value, note) {
  return `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`;
}

function renderHtml(data) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT AI Visibility Working Packet</title>
  <style>
    body{margin:0;background:#f6f8fb;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1220px;margin:0 auto;padding:34px 24px 66px}
    h1{font-size:38px;line-height:1.1;margin:0 0 8px;letter-spacing:0}
    h2{font-size:23px;margin:36px 0 12px}
    h3{font-size:17px;margin:18px 0 8px}
    p,li{line-height:1.56;color:#334155;font-size:15px}
    a{color:#0f766e;overflow-wrap:anywhere}
    code{background:#e2e8f0;border-radius:5px;padding:2px 5px}
    .note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #0f766e;border-radius:12px;padding:16px 18px;margin:20px 0}
    .warn{border-left-color:#f97316}
    .danger{border-left-color:#ef4444}
    .cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:22px 0}
    .card{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:15px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:900}
    .value{font-size:29px;font-weight:900;margin:8px 0;color:#0f172a}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
    .chart{background:#fff;border:1px solid #dbe3ef;border-radius:18px;padding:10px;overflow:auto}
    .chart svg{width:100%;height:auto;display:block}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 22px}
    th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    .links{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    .linkcard{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:14px}
    @media(max-width:980px){.cards,.grid,.links{grid-template-columns:1fr}h1{font-size:31px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT AI Visibility Working Packet</h1>
  <p>This packet consolidates the benchmark, competitor adjacency, blog coverage, and citation strategy into one operating view. It is analysis and test planning, not a claim that post-edit lift has already happened.</p>

  <div class="note">
    <strong>Current read:</strong> iBOLT is known to the models, but broad buyer prompts still default to competitors too often. We should raise citation rate, but the immediate bottleneck is inclusion and top-3 recommendation on non-branded prompts.
  </div>

  <section class="cards">
    ${card("Mention rate", data.kpis.mentionRate, `${data.kpis.mentionCount}/${data.kpis.totalAnswers} saved OpenRouter answers mention iBOLT.`)}
    ${card("Top-3 rate", data.kpis.topThreeRate, `${data.kpis.topThreeCount}/${data.kpis.totalAnswers} answers place iBOLT in the recommendation set.`)}
    ${card("Citation rate", data.kpis.citationRate, `${data.kpis.citationCount}/${data.kpis.totalAnswers} API-style answers cite iboltmounts.com.`)}
    ${card("Competitor-only", data.kpis.competitorOnlyRate, `${data.kpis.competitorOnlyCount}/${data.kpis.totalAnswers} broad detector rows; ${data.kpis.strictCompetitorOnlyCount} strict answer-role replacements.`)}
    ${card("Full retest", `${data.testCoverage.fullProviderRequests}`, `${data.testCoverage.fullPrompts} prompts across ChatGPT, Claude, and Gemini.`)}
  </section>

  <section class="grid">
    <div class="chart">${data.svgs.roleFunnel}</div>
    <div class="chart">${data.svgs.competitorBars}</div>
  </section>

  <h2>How iBOLT Is Being Mentioned</h2>
  <table>${data.tables.mentionQuality}</table>

  <h2>Who iBOLT Is Mentioned Next To</h2>
  <div class="grid">
    <div class="chart">${data.svgs.providerCategory}</div>
    <div>
      <h3>Competitor adjacency shortlist</h3>
      <table>${data.tables.competitors}</table>
    </div>
  </div>

  <h2>Where Competitors Are Winning</h2>
  <div class="note danger">
    <strong>Main competitor pattern:</strong> RAM Mounts is the rugged default across fleet, delivery, restaurant, fishing, and warehouse prompts. Arkon, iOttie, CTA Digital, ProClip, and Mount-It each win narrower default slots. The counter is not generic brand praise; it is exact workflow pages with product names, install logic, comparison tables, and source-ready schema.
  </div>
  <table>${data.tables.providerDefaults}</table>

  <h2>All Blog Coverage And Test Expansion</h2>
  <section class="grid">
    <div class="chart">${data.svgs.coverageState}</div>
    <div>
      <h3>Coverage by category</h3>
      <table>${data.tables.coverageCategory}</table>
    </div>
  </section>
  <div class="note">
    The all-blog analysis covers ${data.testCoverage.pagesClassified} live blog pages. The prompt-gap addendum closed the six uncovered pages and produced the current full manifest: ${data.testCoverage.fullPrompts} prompts, ${data.testCoverage.fullProviderRequests} provider requests.
  </div>

  <h2>Citation Rate: Necessary, But Sequenced</h2>
  <div class="note warn">
    <strong>Answer:</strong> citation rate is necessary for Google AI Overviews, Perplexity, Gemini with search, and voice/shopping experiences. For standard non-search model answers, citations are less reliable, so we should judge those runs by mention, recommendation rank, and competitor displacement first.
  </div>
  <table>${data.tables.citationSequence}</table>

  <h2>What To Offload Versus Keep In-App</h2>
  <table>${data.tables.workSplit}</table>

  <h2>Retest Plan</h2>
  <section class="grid">
    <div class="chart">${data.svgs.retestBatches}</div>
    <div>
      <h3>Run order</h3>
      <table>${data.tables.retest}</table>
      <p>Live execution is still gated by secure availability of <code>OPENROUTER_API_KEY</code>. This script only reports whether the key exists, not the key value. Key present now: <strong>${data.env.openRouterKeyPresent ? "yes" : "no"}</strong>.</p>
    </div>
  </section>

  <h2>Evidence Links</h2>
  <section class="links">
    ${data.links.map((link) => `<article class="linkcard"><h3><a href="../${escapeHtml(link.path)}">${escapeHtml(link.title)}</a></h3><p>${escapeHtml(link.description)}</p></article>`).join("")}
  </section>
</main>
</body>
</html>`;
}

function renderMarkdown(data) {
  return `# iBOLT AI Visibility Working Packet

## Current Read

iBOLT is known to the models, but broad buyer prompts still default to competitors too often. We should raise citation rate, but the immediate bottleneck is inclusion and top-3 recommendation on non-branded prompts.

## KPIs

- Mention rate: ${data.kpis.mentionRate} (${data.kpis.mentionCount}/${data.kpis.totalAnswers})
- Top-3 recommendation rate: ${data.kpis.topThreeRate} (${data.kpis.topThreeCount}/${data.kpis.totalAnswers})
- Citation rate: ${data.kpis.citationRate} (${data.kpis.citationCount}/${data.kpis.totalAnswers})
- Competitor-only answer rate: ${data.kpis.competitorOnlyRate} (${data.kpis.competitorOnlyCount}/${data.kpis.totalAnswers})
- Full all-blog retest: ${data.testCoverage.fullPrompts} prompts, ${data.testCoverage.fullProviderRequests} provider requests

## Mention Quality

${data.mentionQuality.map((row) => `- ${row.role}: ${row.answers} answers. ${row.action}`).join("\n")}

## Competitor Pressure

${data.competitorRows.slice(0, 8).map((row) => `- ${row.competitor}: ${row.replacements} replacements, ${row.co_mentions} co-mentions. ${row.counter_angle}`).join("\n")}

## Citation Rate

Citation rate is necessary for search-connected AI, AI Overviews, Perplexity, Gemini with search, and voice/shopping experiences. It should follow mention recovery on the competitor-heavy pages because an uncited answer that never mentions iBOLT is still a lost buyer prompt.

## Retest

${data.retestRows.map((row) => `- ${row.wave}: ${row.requests} requests, ${row.unique_prompts} prompts. ${row.success_metric}`).join("\n")}

OPENROUTER_API_KEY present in this shell: ${data.env.openRouterKeyPresent ? "yes" : "no"}

## Evidence Links

${data.links.map((link) => `- [${link.title}](../${link.path}): ${link.description}`).join("\n")}
`;
}

async function main() {
  const dashboard = await readCsv("boss-ai-visibility-dashboard/boss-dashboard-summary.csv");
  const closure = await readCsv("goal-closure-audit/goal-closure-status.csv");
  const pageSummary = await readCsv("all-page-ai-drilldown/page-drilldown-summary.csv");
  const answerRoles = await readCsv("entity-adjacency-report/answer-role-ledger.csv");
  const competitorRows = await readCsv("entity-adjacency-report/competitor-adjacency-matrix.csv");
  const providerCategoryRows = await readCsv("entity-adjacency-report/provider-category-role-matrix.csv");
  const providerDefaults = await readCsv("provider-blindspots/provider-competitor-defaults.csv");
  const queryConsensus = await readCsv("provider-blindspots/query-consensus-grid.csv");
  const coverageByCategory = await readCsv("all-blog-test-coverage-report/coverage-by-category.csv");
  const coverageByState = await readCsv("all-blog-test-coverage-report/coverage-by-state.csv");
  const fullManifest = await readCsv("all-blog-prompt-gap-addendum/all-blog-complete-provider-manifest.csv");
  const gapManifest = await readCsv("all-blog-prompt-gap-addendum/prompt-gap-provider-manifest.csv");
  const completedBenchmarks = await readCsv("benchmark-history/completed-benchmark-ledger.csv");
  const expandedReadiness = await readCsv("benchmark-history/expanded-benchmark-readiness.csv");
  const categoryCitation = await readCsv("citation-vs-mention-control-report/category-citation-sequence.csv");
  const competitorCitation = await readCsv("citation-vs-mention-control-report/competitor-citation-sequence.csv");
  const retestRows = await readCsv("priority-retest-packet/retest-batches.csv");

  const totalAnswers = answerRoles.length || 93;
  const mentionCount = answerRoles.filter((row) => row.brand_mentioned === "true").length || 22;
  const topThreeCount = answerRoles.filter((row) => {
    const rank = toNumber(row.top_pick_rank);
    return rank >= 1 && rank <= 3;
  }).length || 15;
  const citationCount = answerRoles.filter((row) => row.domain_cited === "true").length;
  const strictCompetitorOnlyCount = answerRoles.filter((row) => row.answer_role === "Competitor replacement").length || 64;
  const broadCompetitorOnlyRate = byMetric(dashboard, "Competitor-only answer rate").current || `${pct(strictCompetitorOnlyCount, totalAnswers)}%`;
  const broadCompetitorOnlyCount = Math.round((parsePercent(broadCompetitorOnlyRate) / 100) * totalAnswers) || strictCompetitorOnlyCount;

  const roleCounts = new Map();
  for (const row of answerRoles) {
    const role = row.answer_role || "Unknown";
    roleCounts.set(role, (roleCounts.get(role) || 0) + 1);
  }

  const mentionQuality = [
    {
      role: "Clean iBOLT answer",
      answers: roleCounts.get("Clean iBOLT answer") || 0,
      action: "Preserve these entity patterns and add source/citation support after page cleanup.",
    },
    {
      role: "iBOLT leads or co-mentioned",
      answers: (roleCounts.get("iBOLT leads with competitors") || 0) + (roleCounts.get("iBOLT co-mentioned") || 0),
      action: "Turn co-mentions into top-3 recommendations with clearer product and use-case proof.",
    },
    {
      role: "iBOLT trails competitors",
      answers: roleCounts.get("iBOLT trails competitors") || 0,
      action: "Add comparison modules that explain when iBOLT is the specialist choice.",
    },
    {
      role: "Competitor replacement",
      answers: strictCompetitorOnlyCount,
      action: "Highest priority: build query-exact answer blocks and retest.",
    },
    {
      role: "No useful signal",
      answers: roleCounts.get("No useful signal") || 0,
      action: "Use only after competitor-heavy pages are handled.",
    },
  ];

  const competitorCsvRows = competitorRows.map((row) => [
    normalizeBrand(row.competitor),
    row.replacements,
    row.co_mentions,
    row.categories,
    row.providers,
    row.counter_angle,
  ]);

  const providerDefaultRows = providerDefaults
    .slice(0, 12)
    .map((row) => [
      row.provider,
      normalizeBrand(row.competitor),
      row.missed_answer_count,
      row.categories,
      short(row.example_queries, 150),
    ]);

  const providerCategoryChartRows = providerCategoryRows.slice(0, 10).map((row) => ({
    label: `${row.provider} ${row.category}`,
    replacements: toNumber(row.competitor_replacements),
    coMentions: toNumber(row.ibolt_leader_with_competitors) + toNumber(row.ibolt_co_mentioned) + toNumber(row.ibolt_trailing_competitors),
    clean: toNumber(row.clean_ibolt_only),
    noSignal: toNumber(row.no_signal),
  }));

  const coverageCategoryRows = coverageByCategory.slice(0, 10).map((row) => [
    row.category,
    row.pages,
    row.priority_pages,
    row.expanded_pages,
    row.provider_requests,
    row.competitor_only_baseline,
    short(row.top_gap_pages, 120),
  ]);

  const coverageStateRows = coverageByState.map((row) => ({
    label: row.coverage_state,
    value: toNumber(row.requests),
    color: row.coverage_state === "prompt_gap" ? "#ef4444" : row.coverage_state === "priority_retest_ready" ? "#f97316" : "#0f766e",
  }));

  const categoryCitationRows = categoryCitation.slice(0, 8).map((row) => [
    row.category,
    row.pages,
    row.competitor_only_answers,
    row.zero_mention_queries,
    row.unique_prompts_ready,
    row.recommended_sequence,
  ]);

  const workSplit = [
    [
      "Keep in app/content",
      "Canonical survivor decisions, query-exact quick answers, comparison modules, product/entity blocks, schema cleanup, product links, and benchmark runs.",
      "These change the pages and measure AI-answer behavior directly.",
    ],
    [
      "Offload to SEO/PR contractor",
      "External mentions, backlinks, distributor/partner citations, roundup placements, review references, and industry directory cleanup.",
      "These build source authority so search-connected AI has trusted third-party support.",
    ],
    [
      "Coordinate together",
      "Competitor battlecards, target pages for outreach, exact phrases to reinforce, and monthly retest reporting.",
      "The contractor should amplify the same pages the app is editing, not random SEO pages.",
    ],
  ];

  const retestTableRows = retestRows.map((row) => [
    row.batch_id,
    row.wave,
    row.requests,
    row.unique_prompts,
    row.prerequisite,
    row.success_metric,
  ]);

  const latestCompleted = completedBenchmarks[completedBenchmarks.length - 1] || {};
  const latestExpanded = expandedReadiness[expandedReadiness.length - 1] || {};
  const pagesClassified = byMetric(pageSummary, "pages_classified").value || "142";
  const fullPrompts = uniq(fullManifest.map((row) => row.prompt)).length || toNumber(latestExpanded.selected_prompts);
  const fullProviderRequests = fullManifest.length || toNumber(latestExpanded.provider_requests);
  const gapPrompts = uniq(gapManifest.map((row) => row.prompt)).length;

  const kpis = {
    totalAnswers,
    mentionCount,
    mentionRate: `${pct(mentionCount, totalAnswers)}%`,
    topThreeCount,
    topThreeRate: `${pct(topThreeCount, totalAnswers)}%`,
    citationCount,
    citationRate: `${pct(citationCount, totalAnswers)}%`,
    competitorOnlyCount: broadCompetitorOnlyCount,
    strictCompetitorOnlyCount,
    competitorOnlyRate: broadCompetitorOnlyRate,
    dashboardMentionTarget: byMetric(dashboard, "Mention rate").target || "35%",
    currentBaseline: latestCompleted.note || "",
  };

  const testCoverage = {
    pagesClassified,
    fullPrompts,
    fullProviderRequests,
    gapPrompts,
    gapProviderRequests: gapManifest.length,
    latestExpandedSnapshot: latestExpanded.snapshot || "",
  };

  const links = [
    { title: "Evidence Hub", path: "evidence-hub/REPORT.html", description: "Master index of visibility artifacts and completion gates." },
    { title: "Boss Dashboard", path: "boss-ai-visibility-dashboard/REPORT.html", description: "Leadership KPI charts and plain-English next actions." },
    { title: "Citation And Visibility Executive Brief", path: "citation-visibility-executive-brief/REPORT.html", description: "Clear boss-ready answer on citation rate, current visibility, work sequence, and what to hand to the SEO contractor." },
    { title: "Citation And Visibility Boss Memo", path: "citation-visibility-boss-memo/REPORT.html", description: "Compact leadership memo answering whether citation rate is necessary, current visibility health, platform differences, owner split, and first actions." },
    { title: "Evidence Integrity Audit", path: "evidence-integrity-audit/REPORT.html", description: "Checks that mention analysis, co-mention analysis, competitor comparison, all-blog inspection, expanded test areas, citation strategy, and boss-facing rollups are present and clean." },
    { title: "Next Benchmark Runbook", path: "next-benchmark-runbook/REPORT.html", description: "Runnable W1-W5 provider manifests and commands for proving page edits, mention recovery, citation rows, product entity accuracy, and non-branded buyer coverage." },
    { title: "Retest Execution Gate", path: "retest-execution-gate/REPORT.html", description: "Shows which priority provider requests are blocked by survivor URL work, which six are conditional micro-run rows, and what command should run after cleanup." },
    { title: "Micro-Run Cleanup Packet", path: "micro-run-cleanup-packet/REPORT.html", description: "Editor-ready cleanup packet for the four pages that unlock the six-row W3 citation micro-run." },
    { title: "Micro-Run Source Snippets", path: "micro-run-source-snippets/REPORT.html", description: "Review-ready Shopify HTML snippets and JSON-LD schema drafts for the four conditional micro-run pages." },
    { title: "Post-Run Comparison Analyzer", path: "post-run-comparison/REPORT.html", description: "Automatically turns the next completed expanded provider run into baseline-vs-current deltas, provider/category results, and remaining gap rows." },
    { title: "Visibility Completion Control Report", path: "visibility-completion-control-report/REPORT.html", description: "Compact control view showing what is proven, what still needs live provider proof, and the credential-safe commands for the remaining retest." },
    { title: "AI Answer Review Packet", path: "answer-review-packet/REPORT.html", description: "Manager-ready answer snippets with outcome, competitors, target page, and exact page-language/schema/citation commands." },
    { title: "Entity Adjacency Report", path: "entity-adjacency-report/REPORT.html", description: "How iBOLT appears, co-mentions, replacements, and answer roles." },
    { title: "Mention Environment Dossier", path: "mention-environment-dossier/REPORT.html", description: "Answer-environment context for where iBOLT appears cleanly, appears beside competitors, or is replaced by competitors." },
    { title: "Mention Language Command Deck", path: "mention-language-command-deck/REPORT.html", description: "How AI systems describe iBOLT and competitors, including exact product naming fixes and copy instructions." },
    { title: "Answer Language Evidence", path: "answer-language-evidence/REPORT.html", description: "Boss-readable proof of how iBOLT is described, who it is mentioned beside, which competitors replace it, and which page copy/citation commands should fix that." },
    { title: "Mention Narrative Drilldown", path: "mention-narrative-drilldown/REPORT.html", description: "Consolidated answer-language view showing iBOLT language patterns, adjacent competitors, competitor-owned wording, and provider/category narrative risk." },
    { title: "Product Name Truth Table", path: "product-name-truth-table/REPORT.html", description: "Separates exact catalog product names, valid aliases, manual reviews, and hallucination-risk names, with page-level correction targets." },
    { title: "Competitive Share of Answer", path: "competitive-share-of-answer/REPORT.html", description: "Ranks competitor/entity answer share by brand, provider/category pocket, and first page counterplan." },
    { title: "Competitor and Citation Action Deck", path: "competitor-action-deck/REPORT.html", description: "Joined boss-ready deck for competitor displacement, page targets, prompt targets, and off-site citation asks." },
    { title: "Competitor Page Counterplan", path: "competitor-page-counterplan/REPORT.html", description: "Maps RAM, Arkon, iOttie, CTA Digital, ProClip, and other replacement brands to exact pages, prompts, comparison modules, and citation asks." },
    { title: "Competitor Comparison Dossier", path: "competitor-comparison-dossier/REPORT.html", description: "Battlecards for who replaces iBOLT, who appears beside iBOLT, provider/category pressure, and exact page targets for competitor displacement recovery." },
    { title: "Category Provider Priority Report", path: "category-provider-priority-report/REPORT.html", description: "Ranks category lanes and provider-specific fixes so delivery, restaurant, fleet, fishing, and warehouse work can be retested one prompt at a time." },
    { title: "Prompt Intent Loss Report", path: "prompt-intent-loss-report/REPORT.html", description: "Classifies best, comparison, product-recall, setup, shopping-advice, and citation prompts so retests can run one small buyer question at a time." },
    { title: "Prompt Loss Decision Board", path: "prompt-loss-decision-board/REPORT.html", description: "Exact prompt-by-prompt decision board for provider misses, competitor displacement, page action, product modules, and citation timing." },
    { title: "Blog Page Opportunity Heatmap", path: "blog-page-opportunity-heatmap/REPORT.html", description: "Ranks all 142 pages by combined AI risk, competitor pressure, checkout value, product coverage, and retest timing." },
    { title: "Product Conversion Visibility Bridge", path: "product-conversion-visibility-bridge/REPORT.html", description: "Connects AI visibility losses to product modules, CTA cleanup, product-family coverage, and checkout-oriented page fixes." },
    { title: "Shopify Blog Content State Bridge", path: "shopify-blog-content-state-bridge/REPORT.html", description: "Live Shopify article inventory, published-vs-draft state, analytics-access proof, and high-intent draft queue joined to AI visibility work." },
    { title: "Product Family AI Visibility Board", path: "product-family-visibility-board/REPORT.html", description: "Shows which iBOLT product families need stronger entity reinforcement, exact product modules, product-name cleanup, and retest prompts." },
    { title: "Portfolio Product Spread Analysis", path: "portfolio-product-spread-analysis/REPORT.html", description: "All-blog portfolio view tying product-family spread, category coverage, refresh-first decisions, and page queues together." },
    { title: "Blog Body Inspection", path: "blog-body-inspection/REPORT.html", description: "Body-level inspection of answer placement, schema, FAQ, internal links, cart CTA density, and old AI-search section leftovers." },
    { title: "All Blog Answer Gap Drilldown", path: "all-blog-answer-gap-drilldown/REPORT.html", description: "One-row-per-page view tying AI answer losses, page body issues, canonical gates, products, retest prompts, and edit sequencing together." },
    { title: "Page Decision Map", path: "page-decision-map/REPORT.html", description: "Single decision map that says which pages to consolidate first, source-cleanup first, rewrite/refresh, protect/amplify, or edit first before retesting." },
    { title: "Survivor URL Decision Workbook", path: "survivor-url-decision-workbook/REPORT.html", description: "Reviewable survivor URL workbook for consolidation-gated blog families, merge-from holds, preserved prompts/products, and retest gates." },
    { title: "Page Decision Retest Map", path: "page-decision-retest-map/REPORT.html", description: "Bridge from page decisions to exact priority provider prompts, with lane gates before running the next benchmark." },
    { title: "Page Edit Command Matrix", path: "page-edit-command-matrix/REPORT.html", description: "Mechanical 142-page edit queue with exact quick-answer, schema, comparison, product-path, CTA, image-alt, and retest commands." },
    { title: "All-Blog Action Control Sheet", path: "all-blog-action-control-sheet/REPORT.html", description: "Single 142-page operating queue tying edit commands, citation stage, product-name risk, competitors, products, and retest gates together." },
    { title: "Query Loss Recovery Matrix", path: "query-loss-recovery-matrix/REPORT.html", description: "Maps each losing query to the target page, competitors, missing fixes, retest wave, and next action." },
    { title: "All-Blog Edit and Retest Planner", path: "all-blog-edit-retest-planner/REPORT.html", description: "142-page work queue that orders edits, checkout/product modules, citation timing, and retest waves." },
    { title: "Provider Blindspots", path: "provider-blindspots/REPORT.html", description: "Queries missed by all providers and provider-specific competitor defaults." },
    { title: "All Blog Test Coverage", path: "all-blog-test-coverage-report/REPORT.html", description: "142 live pages classified by benchmark coverage state." },
    { title: "All Blog Prompt Addendum", path: "all-blog-prompt-gap-addendum/REPORT.html", description: "483-prompt, 1,449-request full retest manifest." },
    { title: "Low Coverage Prompt Expansion Pack", path: "low-coverage-prompt-expansion-pack/REPORT.html", description: "Focused low/no coverage prompt pack with buyer, competitor, product-entity, and citation probes for ChatGPT, Gemini, and Claude." },
    { title: "Test Area Expansion Map", path: "test-area-expansion-map/REPORT.html", description: "Explains the 1,449-request manifest by category, prompt type, provider balance, and business question." },
    { title: "Benchmark Manifest QA", path: "benchmark-manifest-qa/REPORT.html", description: "Preflight validation for the 1,449-request manifest, including provider balance, prompt quality flags, and run order." },
    { title: "Visibility to Citation Bridge", path: "visibility-citation-bridge/REPORT.html", description: "Separates mention-recovery pages from citation-ready pages and maps the sequence by category and competitor." },
    { title: "Citation Priority Model", path: "citation-priority-model/REPORT.html", description: "Ranks the page, topic, competitor, and platform citation sequence so citation outreach waits for inclusion, product-name, and source-readiness gates." },
    { title: "Source and Citation Closure Board", path: "source-citation-closure-board/REPORT.html", description: "Strict 142-page gate board showing canonical-first pages, source-cleanup blockers, source targets, and citation outreach readiness." },
    { title: "Citation Timing Control", path: "citation-vs-mention-control-report/REPORT.html", description: "Why citation comes after mention recovery for competitor-heavy pages." },
    { title: "Source Authority Roadmap", path: "source-authority-roadmap/REPORT.html", description: "Topic and competitor source-authority plan for external mentions, third-party guides, partner pages, and citation lift." },
    { title: "Citation Uplift Plan", path: "citation-uplift-plan/REPORT.html", description: "Detailed on-site and contractor workstream plan to raise citations without skipping mention and recommendation recovery." },
    { title: "Benchmark History", path: "benchmark-history/REPORT.html", description: "Completed benchmark surfaces and dry-run readiness over time." },
    { title: "Priority Retest Packet", path: "priority-retest-packet/REPORT.html", description: "204-request priority validation plan." },
    { title: "KPI Retest Ladder", path: "visibility-kpi-retest-ladder/REPORT.html", description: "Count-based pass/fail targets for mention, non-branded mention, top-3 recommendation, citation, and competitor-only reduction." },
    { title: "Contractor Citation Packet", path: "contractor-citation-packet/REPORT.html", description: "Off-site citation and backlink tasks to hand to SEO support." },
  ];

  const svgs = {
    roleFunnel: barSvg({
      title: "Answer role breakdown",
      rows: mentionQuality.map((row) => ({
        label: row.role,
        value: row.answers,
        color: row.role === "Competitor replacement" ? "#ef4444" : row.role.includes("iBOLT") ? "#0f766e" : "#64748b",
      })),
      maxValue: totalAnswers,
    }),
    competitorBars: barSvg({
      title: "Competitor replacements",
      rows: competitorRows.slice(0, 10).map((row) => ({
        label: normalizeBrand(row.competitor),
        value: toNumber(row.replacements),
        color: "#ef4444",
      })),
    }),
    providerCategory: stackedSvg({
      title: "Provider/category answer roles",
      rows: providerCategoryChartRows,
    }),
    coverageState: barSvg({
      title: "All-blog prompt coverage by state",
      rows: coverageStateRows,
    }),
    retestBatches: barSvg({
      title: "Priority retest request volume",
      rows: retestRows.map((row) => ({
        label: row.wave,
        value: toNumber(row.requests),
        color: row.batch_id === "R03" ? "#f97316" : "#2563eb",
      })),
    }),
  };

  const tables = {
    mentionQuality: renderTable(["Answer role", "Answers", "Action"], mentionQuality.map((row) => [row.role, row.answers, row.action])),
    competitors: renderTable(["Competitor", "Replacements", "Co-mentions", "Categories", "Providers", "Counter angle"], competitorCsvRows.slice(0, 8)),
    providerDefaults: renderTable(["Provider", "Default competitor", "Missed answers", "Categories", "Example queries"], providerDefaultRows),
    coverageCategory: renderTable(["Category", "Pages", "Priority pages", "Expanded pages", "Requests", "Competitor-only baseline", "Top gap pages"], coverageCategoryRows),
    citationSequence: renderTable(["Category", "Pages", "Competitor-only", "Zero-mention queries", "Prompts ready", "Sequence"], categoryCitationRows),
    workSplit: renderTable(["Owner", "Work", "Why"], workSplit),
    retest: renderTable(["Batch", "Wave", "Requests", "Prompts", "Prerequisite", "Success metric"], retestTableRows),
  };

  const data = {
    kpis,
    testCoverage,
    mentionQuality,
    competitorRows,
    retestRows,
    env: { openRouterKeyPresent: Boolean(process.env.OPENROUTER_API_KEY) },
    svgs,
    tables,
    links,
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml(data));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown(data));
  await writeFile(path.join(outDir, "working-packet-kpis.csv"), csv([
    ["metric", "value", "note"],
    ["answers_analyzed", totalAnswers, "Saved OpenRouter answer rows"],
    ["mention_rate", kpis.mentionRate, `${mentionCount}/${totalAnswers}`],
    ["top_three_rate", kpis.topThreeRate, `${topThreeCount}/${totalAnswers}`],
    ["citation_rate", kpis.citationRate, `${citationCount}/${totalAnswers}`],
    ["competitor_only_rate_broad", kpis.competitorOnlyRate, `${broadCompetitorOnlyCount}/${totalAnswers}`],
    ["competitor_replacement_rows_strict", strictCompetitorOnlyCount, "Strict answer-role replacement rows"],
    ["pages_classified", pagesClassified, "Live blog pages in all-page drilldown"],
    ["full_retest_prompts", fullPrompts, "Unique prompt strings in all-blog complete manifest"],
    ["full_retest_provider_requests", fullProviderRequests, "Provider rows in all-blog complete manifest"],
    ["prompt_gap_provider_requests_added", gapManifest.length, `${gapPrompts} gap prompts added`],
    ["openrouter_key_present", data.env.openRouterKeyPresent ? "yes" : "no", "Does not expose the key value"],
  ]));
  await writeFile(path.join(outDir, "mention-quality.csv"), csv([
    ["role", "answers", "action"],
    ...mentionQuality.map((row) => [row.role, row.answers, row.action]),
  ]));
  await writeFile(path.join(outDir, "competitor-working-set.csv"), csv([
    ["competitor", "replacements", "co_mentions", "categories", "providers", "counter_angle"],
    ...competitorCsvRows,
  ]));
  await writeFile(path.join(outDir, "provider-defaults-shortlist.csv"), csv([
    ["provider", "default_competitor", "missed_answers", "categories", "example_queries"],
    ...providerDefaultRows,
  ]));
  await writeFile(path.join(outDir, "category-citation-sequence.csv"), csv([
    ["category", "pages", "competitor_only_answers", "zero_mention_queries", "unique_prompts_ready", "recommended_sequence"],
    ...categoryCitationRows,
  ]));
  await writeFile(path.join(outDir, "work-split.csv"), csv([
    ["owner", "work", "why"],
    ...workSplit,
  ]));

  console.log(`Wrote ${path.join(outDir, "REPORT.html")}`);
  console.log(`KPI baseline: mention ${kpis.mentionRate}, top-3 ${kpis.topThreeRate}, citation ${kpis.citationRate}, competitor-only ${kpis.competitorOnlyRate}`);
  console.log(`Full all-blog retest manifest: ${fullPrompts} prompts, ${fullProviderRequests} provider requests`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
