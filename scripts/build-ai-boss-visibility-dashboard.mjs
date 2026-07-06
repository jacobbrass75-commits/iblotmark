#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "boss-ai-visibility-dashboard");

async function readJson(relativePath, fallback = {}) {
  try {
    return JSON.parse(await readFile(path.join(benchmarkDir, relativePath), "utf8"));
  } catch {
    return fallback;
  }
}

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
  return rows.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

function csv(rows) {
  return rows
    .map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\n") + "\n";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function parseCountLabel(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(.*?)(?::)?\s+(\d+)(?:\s.*)?$/);
  if (!match) return { label: text, value: 0 };
  return { label: match[1].trim(), value: Number(match[2]) };
}

function toNumber(value) {
  if (typeof value === "number") return value;
  const match = String(value ?? "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function truncate(value, length = 44) {
  const text = String(value ?? "");
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function barSvg({ title, rows, width = 860, rowHeight = 34, maxValue }) {
  const chartRows = rows.filter((row) => Number.isFinite(row.value)).slice(0, 10);
  const height = 74 + chartRows.length * rowHeight;
  const max = maxValue || Math.max(1, ...chartRows.map((row) => row.value));
  const bars = chartRows.map((row, index) => {
    const y = 56 + index * rowHeight;
    const barWidth = Math.round((row.value / max) * (width - 315));
    return `<g>
      <text x="22" y="${y + 18}" font-size="13" font-weight="700" fill="#111827">${escapeHtml(truncate(row.label, 36))}</text>
      <rect x="255" y="${y}" width="${width - 315}" height="21" rx="10" fill="#e5e7eb"/>
      <rect x="255" y="${y}" width="${barWidth}" height="21" rx="10" fill="${row.color || "#0f766e"}"/>
      <text x="${width - 44}" y="${y + 16}" font-size="13" font-weight="800" text-anchor="end" fill="#111827">${escapeHtml(row.value)}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#ffffff"/>
    <text x="22" y="34" font-size="20" font-weight="800" fill="#111827">${escapeHtml(title)}</text>
    ${bars}
  </svg>`;
}

function kpiSvg(kpis) {
  const width = 900;
  const rowHeight = 52;
  const height = 76 + kpis.length * rowHeight;
  const bars = kpis.map((row, index) => {
    const y = 58 + index * rowHeight;
    const currentWidth = Math.round((row.current / 100) * 430);
    const targetX = 255 + Math.round((row.target / 100) * 430);
    return `<g>
      <text x="22" y="${y + 19}" font-size="14" font-weight="800" fill="#111827">${escapeHtml(row.label)}</text>
      <rect x="255" y="${y}" width="430" height="24" rx="12" fill="#e5e7eb"/>
      <rect x="255" y="${y}" width="${currentWidth}" height="24" rx="12" fill="#0f766e"/>
      <line x1="${targetX}" x2="${targetX}" y1="${y - 5}" y2="${y + 30}" stroke="#f97316" stroke-width="3"/>
      <text x="708" y="${y + 17}" font-size="13" font-weight="800" fill="#111827">${row.current}% now</text>
      <text x="806" y="${y + 17}" font-size="13" font-weight="800" fill="#f97316">${row.target}% target</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Current AI visibility KPIs versus target">
    <rect width="${width}" height="${height}" rx="18" fill="#ffffff"/>
    <text x="22" y="34" font-size="20" font-weight="800" fill="#111827">Current AI visibility versus next target</text>
    ${bars}
  </svg>`;
}

function funnelSvg(summary) {
  const rows = [
    { label: "All tested AI answers", value: summary.totalAnswers || 93, color: "#334155" },
    { label: "iBOLT mentioned", value: summary.mentionCount || 0, color: "#0f766e" },
    { label: "iBOLT top-3 recommended", value: summary.topThreeCount || 0, color: "#2563eb" },
    { label: "iboltmounts.com cited", value: summary.citationCount || 0, color: "#f97316" },
    { label: "Non-branded answers mentioning iBOLT", value: summary.nonBrandedMentionCount || 0, color: "#7c3aed" },
  ];
  return barSvg({ title: "Visibility funnel from tested AI answers", rows, maxValue: summary.totalAnswers || 93 });
}

function metricCard(label, value, note) {
  return `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`;
}

function renderHtml({ summary, closure, svgs, tables }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT AI Visibility Boss Dashboard</title>
  <style>
    body{margin:0;background:#f5f7fb;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1180px;margin:0 auto;padding:34px 24px 60px}
    h1{font-size:36px;margin:0 0 8px;letter-spacing:0}
    h2{font-size:22px;margin:34px 0 12px}
    h3{font-size:17px;margin:18px 0 8px}
    p,li{line-height:1.55;color:#334155;font-size:15px}
    .note{background:#fff;border-left:6px solid #0f766e;border-radius:12px;padding:16px 18px;margin:20px 0;border-top:1px solid #dbe3ef;border-right:1px solid #dbe3ef;border-bottom:1px solid #dbe3ef}
    .warn{border-left-color:#f97316}
    .cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:22px 0}
    .card{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:16px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:800}
    .value{font-size:30px;font-weight:900;margin:8px 0;color:#0f172a}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
    .chart{background:#fff;border:1px solid #dbe3ef;border-radius:18px;padding:10px;overflow:auto}
    .chart svg{width:100%;height:auto;display:block}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden}
    th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    code{background:#e2e8f0;border-radius:5px;padding:2px 5px}
    a{color:#0f766e}
    @media(max-width:900px){.cards,.grid{grid-template-columns:1fr}h1{font-size:30px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT AI Visibility Dashboard</h1>
  <p>Generated from the saved OpenRouter benchmark, live blog audit, and page execution reports. This is a boss-facing readout, not a claim of post-edit lift.</p>

  <div class="note">
    <strong>Bottom line:</strong> iBOLT is visible, but not yet consistently recommended on broad buyer prompts. Citation rate should be improved, but first we need more answers to include iBOLT at all. The current target-domain citation rate is ${summary.citationRate || 0}%, while competitor-only answers are ${summary.competitorOnlyRate || 0}%.
  </div>

  <section class="cards">
    ${metricCard("Mention rate", `${summary.mentionRate}%`, `${summary.mentionCount}/${summary.totalAnswers} tested answers mention iBOLT.`)}
    ${metricCard("Non-branded mention", `${summary.nonBrandedMentionRate}%`, `${summary.nonBrandedMentionCount}/${summary.nonBrandedAnswers} generic buyer answers mention iBOLT.`)}
    ${metricCard("Top-3 recommendation", `${summary.topThreeRate}%`, `${summary.topThreeCount}/${summary.totalAnswers} answers put iBOLT in the recommendation set.`)}
    ${metricCard("Citation rate", `${summary.citationRate}%`, `${summary.citationCount}/${summary.totalAnswers} answers cite iboltmounts.com.`)}
  </section>

  <section class="grid">
    <div class="chart">${svgs.kpis}</div>
    <div class="chart">${svgs.funnel}</div>
  </section>

  <h2>Should We Push Citation Rate?</h2>
  <div class="note warn">
    <strong>Yes, but sequence it correctly.</strong> Citation rate matters because it proves AI systems trust iboltmounts.com as a source. But current data shows a larger first-order issue: broad prompts often recommend competitors without mentioning iBOLT. The practical sequence is: win inclusion, strengthen top-3 recommendation, then push citations with schema, source-ready pages, and third-party authority.
  </div>

  <section class="grid">
    <div class="chart">${svgs.competitors}</div>
    <div class="chart">${svgs.providers}</div>
  </section>

  <h2>What AI Is Missing</h2>
  <section class="grid">
    <div class="chart">${svgs.messageGaps}</div>
    <div class="chart">${svgs.pageWorkload}</div>
  </section>

  <h2>Next Benchmark Retest</h2>
  <section class="grid">
    <div class="chart">${svgs.retestWaves}</div>
    <div>
      <h3>Priority packet</h3>
      <table>${tables.retest}</table>
      <p>Closure audit verdict: <strong>${escapeHtml(closure.verdict || "missing")}</strong>. Remaining gate: ${escapeHtml(closure.blocker || "none")}.</p>
    </div>
  </section>

  <h2>Recommended Plan For Katie</h2>
  <table>${tables.actions}</table>

  <h2>Evidence Links</h2>
  <ul>
    <li><a href="../visibility-working-packet/REPORT.html">AI visibility working packet</a></li>
    <li><a href="../evidence-hub/REPORT.html">AI visibility evidence hub</a></li>
    <li><a href="../citation-visibility-executive-brief/REPORT.html">Citation and visibility executive brief</a></li>
    <li><a href="../citation-visibility-boss-memo/REPORT.html">Citation and visibility boss memo</a></li>
    <li><a href="../next-benchmark-runbook/REPORT.html">Next benchmark runbook</a></li>
    <li><a href="../retest-execution-gate/REPORT.html">Retest execution gate</a></li>
    <li><a href="../micro-run-cleanup-packet/REPORT.html">Micro-run cleanup packet</a></li>
    <li><a href="../micro-run-source-snippets/REPORT.html">Micro-run source snippets</a></li>
    <li><a href="../post-run-comparison/REPORT.html">Post-run comparison analyzer</a></li>
    <li><a href="../visibility-completion-control-report/REPORT.html">Visibility completion control report</a></li>
    <li><a href="../answer-examples-report/REPORT.html">AI answer examples</a></li>
    <li><a href="../answer-review-packet/REPORT.html">AI answer review packet</a></li>
    <li><a href="../entity-adjacency-report/REPORT.html">Entity adjacency report</a></li>
    <li><a href="../mention-environment-dossier/REPORT.html">Mention environment dossier</a></li>
    <li><a href="../mention-language-command-deck/REPORT.html">Mention language command deck</a></li>
    <li><a href="../mention-narrative-drilldown/REPORT.html">Mention narrative drilldown</a></li>
    <li><a href="../product-name-truth-table/REPORT.html">Product name truth table</a></li>
    <li><a href="../competitive-share-of-answer/REPORT.html">Competitive share of answer</a></li>
    <li><a href="../competitor-action-deck/REPORT.html">Competitor and citation action deck</a></li>
    <li><a href="../competitor-page-counterplan/REPORT.html">Competitor page counterplan</a></li>
    <li><a href="../competitor-comparison-dossier/REPORT.html">Competitor comparison dossier</a></li>
    <li><a href="../category-provider-priority-report/REPORT.html">Category/provider priority report</a></li>
    <li><a href="../prompt-intent-loss-report/REPORT.html">Prompt intent loss report</a></li>
    <li><a href="../prompt-loss-decision-board/REPORT.html">Prompt loss decision board</a></li>
    <li><a href="../blog-page-opportunity-heatmap/REPORT.html">Blog page opportunity heatmap</a></li>
    <li><a href="../product-conversion-visibility-bridge/REPORT.html">Product conversion visibility bridge</a></li>
    <li><a href="../shopify-blog-content-state-bridge/REPORT.html">Shopify blog content state bridge</a></li>
    <li><a href="../portfolio-product-spread-analysis/REPORT.html">Portfolio product spread analysis</a></li>
    <li><a href="../product-family-visibility-board/REPORT.html">Product family AI visibility board</a></li>
    <li><a href="../blog-body-inspection/REPORT.html">Blog body inspection</a></li>
    <li><a href="../all-blog-answer-gap-drilldown/REPORT.html">All blog answer gap drilldown</a></li>
    <li><a href="../survivor-url-decision-workbook/REPORT.html">Survivor URL decision workbook</a></li>
    <li><a href="../page-edit-command-matrix/REPORT.html">Page edit command matrix</a></li>
    <li><a href="../all-blog-action-control-sheet/REPORT.html">All-blog action control sheet</a></li>
    <li><a href="../query-loss-recovery-matrix/REPORT.html">Query loss recovery matrix</a></li>
    <li><a href="../all-blog-edit-retest-planner/REPORT.html">All-blog edit and retest planner</a></li>
    <li><a href="../all-page-ai-drilldown/REPORT.html">All blog page AI drilldown</a></li>
    <li><a href="../all-blog-test-coverage-report/REPORT.html">All blog test coverage report</a></li>
    <li><a href="../all-blog-prompt-gap-addendum/REPORT.html">All blog prompt gap addendum</a></li>
    <li><a href="../low-coverage-prompt-expansion-pack/REPORT.html">Low coverage prompt expansion pack</a></li>
    <li><a href="../test-area-expansion-map/REPORT.html">Test area expansion map</a></li>
    <li><a href="../benchmark-manifest-qa/REPORT.html">Benchmark manifest QA</a></li>
    <li><a href="../benchmark-history/REPORT.html">Benchmark history</a></li>
    <li><a href="../visibility-citation-bridge/REPORT.html">Visibility to citation bridge</a></li>
    <li><a href="../citation-priority-model/REPORT.html">Citation priority model</a></li>
    <li><a href="../source-citation-closure-board/REPORT.html">Source and citation closure board</a></li>
    <li><a href="../source-authority-roadmap/REPORT.html">Source authority roadmap</a></li>
    <li><a href="../citation-uplift-plan/REPORT.html">Citation uplift plan</a></li>
    <li><a href="../visibility-kpi-retest-ladder/REPORT.html">KPI retest ladder</a></li>
    <li><a href="../goal-audit/REPORT.html">Goal audit</a></li>
    <li><a href="../goal-closure-audit/REPORT.html">Goal closure audit</a></li>
    <li><a href="../citation-rate-visibility-dashboard/REPORT.html">Citation-rate dashboard</a></li>
    <li><a href="../competitor-battlecard-control-report/REPORT.html">Competitor battlecards</a></li>
    <li><a href="../page-execution-control-board/REPORT.html">Page execution board</a></li>
    <li><a href="../sprint1-edit-command-sheet/REPORT.html">Sprint 1 edit command sheet</a></li>
    <li><a href="../priority-retest-packet/REPORT.html">Priority retest packet</a></li>
  </ul>
</main>
</body>
</html>`;
}

function renderTable(headers, rows) {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `${head}${body}`;
}

function renderMarkdown({ summary, closure, competitors, providers, gaps, categoryRows, retestRows, actions }) {
  return `# iBOLT AI Visibility Dashboard

## Bottom Line

iBOLT is visible, but not yet consistently recommended on broad buyer prompts. Citation rate should be improved, but the current first priority is answer inclusion.

| KPI | Current | Target |
| --- | ---: | ---: |
${(summary.kpis || []).map((row) => `| ${row.label} | ${row.current}% | ${row.target}% |`).join("\n")}

## Citation Rate

Current target-domain citation rate is ${summary.citationRate || 0}% (${summary.citationCount || 0}/${summary.totalAnswers || 0}). This is necessary to improve for AI Overviews, Perplexity-style answers, Gemini with search, and commerce assistants. It is not the only bottleneck: non-branded mention rate is ${summary.nonBrandedMentionRate || 0}%.

## Competitor Pressure

${competitors.slice(0, 8).map((row, index) => `${index + 1}. ${row.label}: ${row.value}`).join("\n")}

## Provider Notes

${providers.map((row) => `- ${row.label}: ${row.value} competitor replacements`).join("\n")}

## Message Gaps To Fix

${gaps.slice(0, 6).map((row) => `- ${row.label}: ${row.value} gap points`).join("\n")}

## Page Workload

${categoryRows.slice(0, 8).map((row) => `- ${row.label}: ${row.value} provider retests ready`).join("\n")}

## Priority Retest

${retestRows.map((row) => `- ${row.wave}: ${row.requests} requests, ${row.unique_prompts} prompts`).join("\n")}

## Actions

${actions.map((row) => `- ${row.owner}: ${row.action} (${row.why})`).join("\n")}

Closure audit verdict: ${closure.verdict || "missing"}. Remaining gate: ${closure.blocker || "none"}.
`;
}

async function main() {
  const boss = await readJson("boss-visibility-scorecard/boss-scorecard-data.json", { summary: {} });
  const coMention = await readJson("co-mention-network/co-mention-network-data.json", { summary: {} });
  const providerStrategy = await readJson("provider-strategy-report/provider-strategy-data.json", {});
  const messageGap = await readJson("message-gap-map/message-gap-data.json", { summary: {}, themeRows: [] });
  const pageExecution = await readJson("page-execution-control-board/page-execution-control-data.json", { summary: {}, categoryRows: [] });
  const priority = await readJson("priority-retest-packet/priority-retest-data.json", { summary: {} });
  const closure = await readJson("goal-closure-audit/goal-closure-data.json", { verdict: "missing", blocker: "" });
  const postRun = await readJson("post-run-comparison/post-run-comparison-data.json", null);

  const providerRows = await readCsv("provider-strategy-report/provider-strategy-summary.csv");
  const retestRows = await readCsv("priority-retest-packet/retest-batches.csv");
  const actionRows = [
    {
      owner: "Jacob/app",
      action: "Refresh priority pages with answer-first comparison blocks, exact product names, and schema.",
      why: "Moves iBOLT from competitor-only answers into inclusion and top-3 recommendation.",
    },
    {
      owner: "Jacob/app",
      action: "Use the all-blog action control sheet as the single edit queue before retesting.",
      why: "It joins page commands, citation stage, product-name risk, competitor pressure, and retest prompts across all 142 pages.",
    },
    {
      owner: "Jacob/app",
      action: "Fix source-ready page structure before broad citation pushes.",
      why: "99 pages miss FAQ schema, 113 miss quick answers, and citation rate is 0%.",
    },
    {
      owner: "Jacob/app + SEO contractor",
      action: "Use the citation priority model to sequence mention recovery, source cleanup, product-name cleanup, and outreach.",
      why: "Citation rate matters, but the model keeps citation work behind inclusion and source-readiness gates.",
    },
    {
      owner: "Jacob/app",
      action: "Prioritize product cards and CTA cleanup on high-intent pages before adding more cart buttons.",
      why: "The product conversion bridge ties AI losses to product modules, CTA density, and checkout-ready page work.",
    },
    {
      owner: "Jacob/app",
      action: "Normalize AI-visible product names to verified Shopify titles before product-entity retests.",
      why: "The product-name truth table separates valid aliases from hallucination or wrong-alias risks.",
    },
    {
      owner: "SEO contractor",
      action: "Build third-party mentions around RAM, Arkon, iOttie, ProClip, restaurant, fleet, AMPS, warehouse, and fishing topics.",
      why: "AI systems need external corroboration before citing iboltmounts.com consistently.",
    },
    {
      owner: "Jacob/app",
      action: "Run the 204-request priority retest after edits are live, then run the 1,449-request all-blog manifest when ready.",
      why: "The priority run proves near-term movement. The full all-blog run proves coverage across every live blog page.",
    },
  ];

  const legacySummary = boss.summary || {};
  const summary = postRun?.summary?.current
    ? {
        ...legacySummary,
        totalAnswers: postRun.summary.current.answers,
        mentionCount: postRun.summary.current.mentions,
        mentionRate: postRun.summary.current.mentionRate,
        nonBrandedAnswers: postRun.summary.current.nonBrandedAnswers,
        nonBrandedMentionCount: postRun.summary.current.nonBrandedMentions,
        nonBrandedMentionRate: postRun.summary.current.nonBrandedMentionRate,
        topThreeCount: postRun.summary.current.topThree,
        topThreeRate: postRun.summary.current.topThreeRate,
        citationCount: postRun.summary.current.citations,
        citationRate: postRun.summary.current.citationRate,
        competitorOnlyRate: postRun.summary.current.competitorOnlyRate,
        kpis: (postRun.kpiRows || []).map((row) => ({
          label: row.metric,
          current: toNumber(row.current),
          target: toNumber(row.target),
          reason: `${row.status}; proof ${row.proof}`,
        })),
      }
    : legacySummary;
  const competitors = (coMention.summary?.topReplacementCompetitors || boss.topCompetitors || [])
    .map(parseCountLabel)
    .filter((row) => row.label)
    .slice(0, 8);
  const providers = providerRows.map((row) => ({
    label: row.provider,
    value: toNumber(row.competitor_replacements),
    note: row.retest_move,
  }));
  const gaps = (messageGap.themeRows || [])
    .map((row) => ({ label: row.label || row.theme, value: toNumber(row.gapPoints ?? row.gap_points) }))
    .sort((a, b) => b.value - a.value);
  const categoryRows = (pageExecution.categoryRows || [])
    .map((row) => ({ label: row.category, value: toNumber(row.provider_requests_ready) }))
    .sort((a, b) => b.value - a.value);
  const retestWaveRows = retestRows.map((row) => ({
    label: row.wave?.replace(/^W\d+\s*/, "") || row.batch_id,
    value: toNumber(row.requests),
  }));

  const svgs = {
    kpis: kpiSvg(summary.kpis || []),
    funnel: funnelSvg(summary),
    competitors: barSvg({ title: "Competitor replacement pressure", rows: competitors.map((row) => ({ ...row, color: "#b91c1c" })) }),
    providers: barSvg({ title: "Competitor replacements by provider", rows: providers.map((row) => ({ ...row, color: "#2563eb" })) }),
    messageGaps: barSvg({ title: "Language gaps AI answers reward", rows: gaps.map((row) => ({ ...row, color: "#7c3aed" })) }),
    pageWorkload: barSvg({ title: "Page categories queued for retest", rows: categoryRows.map((row) => ({ ...row, color: "#0f766e" })) }),
    retestWaves: barSvg({ title: "Priority retest waves", rows: retestWaveRows.map((row) => ({ ...row, color: "#f97316" })) }),
  };

  await mkdir(outDir, { recursive: true });
  await Promise.all(Object.entries(svgs).map(([name, svg]) => writeFile(path.join(outDir, `${name}.svg`), svg)));

  const retestTable = renderTable(
    ["Wave", "Requests", "Prompts", "Success metric"],
    retestRows.map((row) => [row.wave, row.requests, row.unique_prompts, row.success_metric]).slice(0, 5),
  );
  const actionsTable = renderTable(
    ["Owner", "Action", "Why"],
    actionRows.map((row) => [row.owner, row.action, row.why]),
  );

  await writeFile(path.join(outDir, "REPORT.html"), renderHtml({
    summary,
    closure,
    svgs,
    tables: { retest: retestTable, actions: actionsTable },
  }));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown({
    summary,
    closure,
    competitors,
    providers,
    gaps,
    categoryRows,
    retestRows,
    actions: actionRows,
  }));
  await writeFile(path.join(outDir, "boss-dashboard-summary.csv"), csv([
    ["metric", "current", "target", "note"],
    ...(summary.kpis || []).map((row) => [row.label, `${row.current}%`, `${row.target}%`, row.reason]),
    ["Competitor-only answer rate", `${summary.competitorOnlyRate}%`, "lower", "Shows how often AI answers recommend other brands without iBOLT."],
    ["Closure verdict", closure.verdict || "missing", "complete after live retest", closure.blocker || "none"],
  ]));
  await writeFile(path.join(outDir, "next-actions.csv"), csv([
    ["owner", "action", "why"],
    ...actionRows.map((row) => [row.owner, row.action, row.why]),
  ]));

  console.log(`Wrote ${outDir}`);
  console.log(`Dashboard: ${path.join(outDir, "REPORT.html")}`);
  console.log(`Citation rate: ${summary.citationRate || 0}%`);
  console.log(`Mention rate: ${summary.mentionRate || 0}%`);
  console.log(`Priority retest requests: ${priority.summary?.priorityProviderRequests || 0}`);
  console.log(`Harshest provider: ${providerStrategy.summary?.harshestProvider || providerStrategy.harshestProvider || "not available"}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
