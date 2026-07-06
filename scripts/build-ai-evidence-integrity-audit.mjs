#!/usr/bin/env node
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outputDir = path.join(benchmarkDir, "evidence-integrity-audit");
const outputRoot = path.dirname(benchmarkDir);

const brokenPatterns = [
  { label: "[object Object]", regex: /\[object Object\]/g },
  { label: "undefined", regex: /\bundefined\b/g },
  { label: "NaN", regex: /\bNaN\b/g },
  { label: "Infinity", regex: /\bInfinity\b/g },
  { label: "undefined percent", regex: /undefined%/g },
  { label: "null percent", regex: /null%/g },
];

const goalCoverage = [
  {
    area: "How iBOLT is mentioned",
    report: "answer-language-evidence/REPORT.html",
    expected: ["answer-language-evidence/ibolt-mention-examples.csv", "mention-quality-audit/mention-quality-rows.csv"],
    proves: "Shows mention quality, product-name drift, budget/value risk, snippets, and per-row action commands.",
  },
  {
    area: "Mention narrative drilldown",
    report: "mention-narrative-drilldown/REPORT.html",
    expected: ["mention-narrative-drilldown/ibolt-language-patterns.csv", "mention-narrative-drilldown/competitor-language-ownership.csv", "mention-narrative-drilldown/provider-category-narrative.csv"],
    proves: "Consolidates how AI describes iBOLT, adjacent competitors, competitor-owned language, provider/category narrative risk, and example answer snippets.",
  },
  {
    area: "Answer review examples",
    report: "answer-review-packet/REPORT.html",
    expected: ["answer-review-packet/answer-review-examples.csv", "answer-review-packet/answer-review-provider-summary.csv", "answer-review-packet/answer-review-competitor-summary.csv"],
    proves: "Packages concrete answer snippets with outcome, competitors, target page, and page-language/schema/citation commands for human review.",
  },
  {
    area: "Who iBOLT is mentioned next to",
    report: "entity-adjacency-report/REPORT.html",
    expected: ["co-mention-network/competitor-network.csv", "mention-landscape/competitor-co-mentions.csv"],
    proves: "Maps clean mentions, co-mentions, answer roles, and competitor adjacency.",
  },
  {
    area: "How iBOLT compares to competitors",
    report: "competitor-comparison-dossier/REPORT.html",
    expected: ["competitor-comparison-dossier/competitor-battlecards.csv", "competitive-share-of-answer/competitor-share-scorecard.csv"],
    proves: "Ranks competitor displacement, co-mentions, pressure pockets, counter-positioning, page targets, and success metrics.",
  },
  {
    area: "Competitor action deck",
    report: "competitor-action-deck/REPORT.html",
    expected: ["competitor-action-deck/competitor-action-deck.csv", "competitor-action-deck/competitor-page-actions.csv", "competitor-action-deck/competitor-offsite-actions.csv"],
    proves: "Turns competitor replacement and co-mention pressure into ranked page, prompt, and off-site citation actions.",
  },
  {
    area: "Competitor page counterplan",
    report: "competitor-page-counterplan/REPORT.html",
    expected: ["competitor-page-counterplan/competitor-page-targets.csv", "competitor-page-counterplan/competitor-prompt-targets.csv"],
    proves: "Maps replacement brands to exact page edits, prompts, comparison sections, and retest targets.",
  },
  {
    area: "All blog post inspection",
    report: "blog-body-inspection/REPORT.html",
    expected: ["blog-body-inspection/blog-body-inspection.csv", "all-blog-action-control-sheet/all-blog-action-control-sheet.csv"],
    proves: "Inspects live or locally fetched blog bodies for quick answers, schema, FAQs, CTAs, image alt text, and old AEO leftovers.",
  },
  {
    area: "All blog answer gap drilldown",
    report: "all-blog-answer-gap-drilldown/REPORT.html",
    expected: ["all-blog-answer-gap-drilldown/all-blog-answer-gap-drilldown.csv", "all-blog-answer-gap-drilldown/category-blog-risk-rollup.csv", "all-blog-answer-gap-drilldown/low-coverage-blog-pages.csv"],
    proves: "Joins all blog pages to answer losses, page body issues, canonical gates, product-family pressure, retest prompts, and edit sequencing.",
  },
  {
    area: "All blog page prioritization",
    report: "all-blog-action-control-sheet/REPORT.html",
    expected: ["page-decision-map/page-decision-map.csv", "page-edit-command-matrix/page-edit-command-matrix.csv", "all-blog-edit-retest-planner/all-blog-edit-retest-plan.csv"],
    proves: "Turns all blog/page evidence into an ordered edit queue with language, schema, citation, product, CTA, and retest commands.",
  },
  {
    area: "Product family visibility",
    report: "product-family-visibility-board/REPORT.html",
    expected: ["product-family-visibility-board/product-family-ai-visibility-board.csv", "product-family-visibility-board/product-family-page-action-map.csv", "product-family-visibility-board/product-family-prompt-map.csv"],
    proves: "Maps AI visibility losses to iBOLT product-family entity gaps, exact product modules, product-name risks, page actions, and retest prompts.",
  },
  {
    area: "Shopify blog content state",
    report: "shopify-blog-content-state-bridge/REPORT.html",
    expected: ["shopify-blog-content-state-bridge/shopify-article-inventory.csv", "shopify-blog-content-state-bridge/draft-unpublished-visibility-queue.csv", "shopify-blog-content-state-bridge/shopify-content-state-summary.json"],
    proves: "Fetches live Shopify article inventory, separates published versus draft/unpublished posts, tests ShopifyQL analytics access, and identifies high-intent draft pages that cannot be crawled or cited until published.",
  },
  {
    area: "Survivor URL decisions",
    report: "survivor-url-decision-workbook/REPORT.html",
    expected: ["survivor-url-decision-workbook/survivor-decision-workbook.csv", "survivor-url-decision-workbook/survivor-url-decision-data.json"],
    proves: "Maps consolidation-gated retest requests to survivor URL decisions, merge-from hold lists, preserved prompts, product modules, and release gates.",
  },
  {
    area: "Blog test coverage",
    report: "all-blog-test-coverage-report/REPORT.html",
    expected: ["all-blog-test-coverage-report/all-blog-test-coverage-ledger.csv", "all-blog-prompt-gap-addendum/all-blog-complete-provider-manifest.csv"],
    proves: "Shows which live blog posts have baseline/expanded/priority prompt coverage and adds prompt rows for uncovered pages.",
  },
  {
    area: "Low coverage prompt expansion",
    report: "low-coverage-prompt-expansion-pack/REPORT.html",
    expected: ["low-coverage-prompt-expansion-pack/low-coverage-page-prompts.csv", "low-coverage-prompt-expansion-pack/low-coverage-provider-manifest.csv", "low-coverage-prompt-expansion-pack/low-coverage-category-rollup.csv"],
    proves: "Creates focused one-question-at-a-time provider prompts for low/no benchmark coverage pages across buyer, competitor, product-entity, and citation-probe intents.",
  },
  {
    area: "Expanded test areas",
    report: "test-area-expansion-map/REPORT.html",
    expected: ["test-area-expansion-map/category-test-area-matrix.csv", "benchmark-manifest-qa/manifest-qa-summary.csv"],
    proves: "Confirms broader category/provider/prompt coverage for all-blog retesting.",
  },
  {
    area: "Priority retest readiness",
    report: "next-benchmark-runbook/REPORT.html",
    expected: ["page-decision-retest-map/page-decision-retest-map.csv", "next-benchmark-runbook/benchmark-run-commands.csv", "next-benchmark-runbook/dry-run-proof.csv"],
    proves: "Provides W1-W5 run commands and dry-run proof for the next provider retest.",
  },
  {
    area: "Prompt loss decision board",
    report: "prompt-loss-decision-board/REPORT.html",
    expected: ["prompt-loss-decision-board/prompt-loss-decision-board.csv", "prompt-loss-decision-board/prompt-page-actions.csv", "prompt-loss-decision-board/prompt-provider-actions.csv"],
    proves: "Maps exact losing buyer prompts to provider misses, competitor displacement, target pages, content actions, product modules, and citation timing.",
  },
  {
    area: "Completion control",
    report: "visibility-completion-control-report/REPORT.html",
    expected: ["visibility-completion-control-report/completion-control-matrix.csv", "visibility-completion-control-report/remaining-proof-gates.csv", "visibility-completion-control-report/credential-safe-run-commands.csv"],
    proves: "Makes the remaining live-provider proof gate explicit and prevents claiming post-edit lift before a completed retest exists.",
  },
  {
    area: "Retest execution gates",
    report: "retest-execution-gate/REPORT.html",
    expected: ["retest-execution-gate/gate-summary.csv", "retest-execution-gate/unblocked-provider-manifest.csv", "retest-execution-gate/blocked-consolidation-retest-queue.csv"],
    proves: "Separates blocked survivor-consolidation requests from conditional micro-run rows and provides gated run commands.",
  },
  {
    area: "Micro-run cleanup readiness",
    report: "micro-run-cleanup-packet/REPORT.html",
    expected: ["micro-run-cleanup-packet/micro-run-page-cleanup.csv", "micro-run-cleanup-packet/micro-run-editor-checklist.csv", "micro-run-cleanup-packet/micro-run-run-commands.csv"],
    proves: "Turns the six conditional citation-probe rows into four page-level cleanup tickets and editor checklists before the micro-run.",
  },
  {
    area: "Micro-run source snippets",
    report: "micro-run-source-snippets/REPORT.html",
    expected: ["micro-run-source-snippets/source-ready-snippets.csv", "micro-run-source-snippets/schema-snippet-index.csv", "micro-run-source-snippets/source-snippet-data.json"],
    proves: "Provides review-ready Shopify HTML snippets, FAQ copy, comparison blocks, and JSON-LD schema drafts for the four micro-run pages.",
  },
  {
    area: "Citation strategy",
    report: "citation-visibility-executive-brief/REPORT.html",
    expected: ["citation-vs-mention-control-report/citation-vs-mention-page-queue.csv", "source-authority-roadmap/source-authority-action-plan.csv"],
    proves: "Separates mention recovery, source cleanup, and off-site citation work so citation rate can rise after page cleanup.",
  },
  {
    area: "Citation boss memo",
    report: "citation-visibility-boss-memo/REPORT.html",
    expected: ["citation-visibility-boss-memo/boss-talking-points.csv", "citation-visibility-boss-memo/citation-platform-priority.csv", "citation-visibility-boss-memo/first-citation-actions.csv"],
    proves: "Gives leadership a compact answer on whether citation rate is necessary, how current visibility is performing, owner split, platform priority, and first actions.",
  },
  {
    area: "Source and citation closure board",
    report: "source-citation-closure-board/REPORT.html",
    expected: ["source-citation-closure-board/source-citation-closure-board.csv", "source-citation-closure-board/category-citation-closure-rollup.csv", "source-citation-closure-board/source-target-opportunities.csv"],
    proves: "Converts page, body, citation, and source-readiness evidence into strict canonical-first, source-cleanup, mention-recovery, and citation-outreach lanes.",
  },
  {
    area: "Boss-facing rollup",
    report: "boss-ai-visibility-dashboard/REPORT.html",
    expected: ["boss-ai-visibility-dashboard/boss-dashboard-summary.csv", "evidence-hub/artifact-index.csv"],
    proves: "Gives leadership the KPI story, links to supporting artifacts, and keeps the analysis navigable.",
  },
];

async function exists(relativePath) {
  try {
    await stat(path.join(benchmarkDir, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(filePath));
    } else {
      files.push(filePath);
    }
  }
  return files;
}

async function readCsv(relativePath) {
  try {
    return parseCsv(await readFile(path.join(benchmarkDir, relativePath), "utf8"));
  } catch {
    return [];
  }
}

async function readJson(relativePath) {
  try {
    return JSON.parse(await readFile(path.join(benchmarkDir, relativePath), "utf8"));
  } catch {
    return {};
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
  if (typeof value === "number") return value;
  const match = String(value ?? "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function byMetric(rows, metric) {
  return rows.find((row) => row.metric === metric) || {};
}

function renderTable(headers, rows) {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table>${head}${body}</table>`;
}

function card(label, value, note) {
  return `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`;
}

async function findCompletedExpandedRuns() {
  let entries = [];
  try {
    entries = await readdir(outputRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const runs = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("openrouter-expanded-ai-benchmark-")) continue;
    const runDir = path.join(outputRoot, entry.name);
    const resultPath = path.join(runDir, "results.csv");
    try {
      const rows = parseCsv(await readFile(resultPath, "utf8"));
      runs.push({ name: entry.name, path: runDir, rows: rows.length });
    } catch {
      runs.push({ name: entry.name, path: runDir, rows: 0 });
    }
  }
  return runs.sort((a, b) => a.name.localeCompare(b.name));
}

async function main() {
  const files = await walk(benchmarkDir);
  const reportHtml = files.filter((file) => path.basename(file) === "REPORT.html");
  const reportMd = files.filter((file) => path.basename(file) === "REPORT.md");
  const csvFiles = files.filter((file) => file.endsWith(".csv"));
  const jsonFiles = files.filter((file) => file.endsWith(".json"));
  const svgFiles = files.filter((file) => file.endsWith(".svg"));

  const scannedFiles = files.filter((file) => {
    if (!/\.(md|csv|json)$/i.test(file)) return false;
    const relativeToAuditOutput = path.relative(outputDir, file);
    return relativeToAuditOutput.startsWith("..") || path.isAbsolute(relativeToAuditOutput);
  });
  const brokenRows = [];
  for (const file of scannedFiles) {
    const text = await readFile(file, "utf8");
    for (const pattern of brokenPatterns) {
      const matches = text.match(pattern.regex);
      if (matches?.length) {
        brokenRows.push({
          file: path.relative(benchmarkDir, file),
          issue: pattern.label,
          count: matches.length,
        });
      }
    }
  }

  const coverageRows = [];
  for (const item of goalCoverage) {
    const reportExists = await exists(item.report);
    const expectedStatuses = [];
    for (const relativePath of item.expected) {
      expectedStatuses.push({ path: relativePath, exists: await exists(relativePath) });
    }
    const missing = expectedStatuses.filter((row) => !row.exists).map((row) => row.path);
    coverageRows.push({
      area: item.area,
      status: reportExists && missing.length === 0 ? "covered" : reportExists ? "partial" : "missing",
      report: item.report,
      missing: missing.join("; "),
      proves: item.proves,
    });
  }

  const bossSummary = await readCsv("boss-ai-visibility-dashboard/boss-dashboard-summary.csv");
  const answerLanguage = await readJson("answer-language-evidence/answer-language-evidence-data.json");
  const runbook = await readJson("next-benchmark-runbook/next-benchmark-runbook-data.json");
  const postRun = await readJson("post-run-comparison/post-run-comparison-data.json");
  const expandedRuns = await findCompletedExpandedRuns();
  const completedExpandedRuns = expandedRuns.filter((run) => run.rows > 0);

  const summary = {
    generated_at: new Date().toISOString(),
    benchmark_dir: benchmarkDir,
    report_html_count: reportHtml.length,
    report_md_count: reportMd.length,
    csv_count: csvFiles.length,
    json_count: jsonFiles.length,
    svg_count: svgFiles.length,
    broken_issue_count: brokenRows.reduce((sum, row) => sum + row.count, 0),
    broken_file_count: new Set(brokenRows.map((row) => row.file)).size,
    covered_goal_areas: coverageRows.filter((row) => row.status === "covered").length,
    partial_goal_areas: coverageRows.filter((row) => row.status === "partial").length,
    missing_goal_areas: coverageRows.filter((row) => row.status === "missing").length,
    mention_rate: byMetric(bossSummary, "Mention rate").current || `${answerLanguage.summary?.mentionRate || 0}%`,
    non_branded_mention_rate: byMetric(bossSummary, "Non-branded mention").current || "",
    top_three_rate: byMetric(bossSummary, "Top-3 recommendation").current || "",
    citation_rate: byMetric(bossSummary, "Citation rate").current || `${answerLanguage.summary?.citationRate || 0}%`,
    competitor_only_rate: byMetric(bossSummary, "Competitor-only answer rate").current || "",
    priority_requests: runbook.summary?.priority_requests || runbook.priority_requests || 0,
    priority_prompts: runbook.summary?.priority_prompts || runbook.priority_prompts || 0,
    dry_run_validated_waves: runbook.summary?.dry_run_validated_waves || runbook.dry_run_validated_waves || 0,
    completed_expanded_runs: completedExpandedRuns.length,
    post_run_status: postRun.summary?.status || postRun.status || "unknown",
  };

  const status = summary.broken_issue_count === 0 && summary.missing_goal_areas === 0
    ? "evidence_packet_clean_pending_live_retest"
    : "evidence_packet_needs_cleanup";

  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "evidence-integrity-summary.csv"), csv([
    ["metric", "value"],
    ...Object.entries({ ...summary, status }).map(([key, value]) => [key, value]),
  ]));
  await writeFile(path.join(outputDir, "goal-coverage-matrix.csv"), csv([
    ["area", "status", "report", "missing", "proves"],
    ...coverageRows.map((row) => [row.area, row.status, row.report, row.missing, row.proves]),
  ]));
  await writeFile(path.join(outputDir, "artifact-quality-issues.csv"), csv([
    ["file", "issue", "count"],
    ...brokenRows.map((row) => [row.file, row.issue, row.count]),
  ]));
  await writeFile(path.join(outputDir, "expanded-run-status.csv"), csv([
    ["run", "results_rows", "path"],
    ...expandedRuns.map((row) => [row.name, row.rows, row.path]),
  ]));

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT AI Evidence Integrity Audit</title>
  <style>
    body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1180px;margin:0 auto;padding:34px 24px 64px}
    h1{font-size:36px;margin:0 0 8px}
    h2{font-size:23px;margin:34px 0 12px}
    p,li{line-height:1.55;color:#334155;font-size:15px}
    .note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #0f766e;border-radius:12px;padding:16px 18px;margin:20px 0}
    .warn{border-left-color:#f97316}
    .cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:22px 0}
    .card{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:16px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:800}
    .value{font-size:28px;font-weight:900;margin:8px 0;color:#0f172a}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 22px}
    th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    a{color:#0f766e;overflow-wrap:anywhere}
    code{background:#e2e8f0;border-radius:5px;padding:2px 5px}
    @media(max-width:900px){.cards{grid-template-columns:1fr}h1{font-size:30px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT AI Evidence Integrity Audit</h1>
  <p>This audit checks whether the benchmark packet actually supports the active goal: mentions, co-mentions, competitor comparison, broader test coverage, all-blog inspection, and remaining retest gates.</p>

  <div class="note ${status === "evidence_packet_clean_pending_live_retest" ? "" : "warn"}">
    <strong>Status:</strong> ${escapeHtml(status)}. The evidence packet is ${summary.broken_issue_count === 0 ? "free of scanned broken generated values" : "showing generated-value issues"} across scanned Markdown, CSV, and JSON files. Live lift is still unproven until a completed expanded provider run is available.
  </div>

  <section class="cards">
    ${card("HTML reports", summary.report_html_count, "Generated report entry points.")}
    ${card("CSV files", summary.csv_count, "Machine-readable analysis sheets.")}
    ${card("Goal areas covered", `${summary.covered_goal_areas}/${goalCoverage.length}`, "Coverage areas tied to the user objective.")}
    ${card("Broken markers", summary.broken_issue_count, "Scanned generated-value issues.")}
    ${card("Completed live retests", summary.completed_expanded_runs, "Expanded runs with results.csv rows.")}
  </section>

  <section class="cards">
    ${card("Mention rate", summary.mention_rate, "Current baseline.")}
    ${card("Non-branded mention", summary.non_branded_mention_rate, "Generic buyer prompts.")}
    ${card("Top-3 rate", summary.top_three_rate, "Recommendation strength.")}
    ${card("Citation rate", summary.citation_rate, "Target-domain source trust.")}
    ${card("Competitor-only", summary.competitor_only_rate, "Answers without iBOLT.")}
  </section>

  <div class="note warn">
    <strong>Remaining gate:</strong> the next benchmark runbook has ${escapeHtml(summary.priority_requests)} priority requests across ${escapeHtml(summary.priority_prompts)} prompts, with ${escapeHtml(summary.dry_run_validated_waves)} dry-run-validated waves. The post-run comparison status is <code>${escapeHtml(summary.post_run_status)}</code>.
  </div>

  <h2>Goal Coverage Matrix</h2>
  ${renderTable(["Area", "Status", "Report", "Missing", "What It Proves"], coverageRows.map((row) => [row.area, row.status, row.report, row.missing || "", row.proves]))}

  <h2>Artifact Quality Issues</h2>
  ${brokenRows.length ? renderTable(["File", "Issue", "Count"], brokenRows.map((row) => [row.file, row.issue, row.count])) : "<p>No scanned broken generated-value markers found in Markdown, CSV, or JSON files.</p>"}

  <h2>Expanded Run Status</h2>
  ${renderTable(["Run", "Results Rows", "Path"], expandedRuns.map((row) => [row.name, row.rows, row.path]))}
</main>
</body>
</html>`;

  const markdown = `# iBOLT AI Evidence Integrity Audit

Status: ${status}

## Summary

- HTML reports: ${summary.report_html_count}
- CSV files: ${summary.csv_count}
- JSON files: ${summary.json_count}
- SVG files: ${summary.svg_count}
- Goal areas covered: ${summary.covered_goal_areas}/${goalCoverage.length}
- Broken generated-value markers: ${summary.broken_issue_count}
- Completed expanded live retests: ${summary.completed_expanded_runs}
- Post-run comparison status: ${summary.post_run_status}

## Current KPIs

- Mention rate: ${summary.mention_rate}
- Non-branded mention rate: ${summary.non_branded_mention_rate}
- Top-3 recommendation rate: ${summary.top_three_rate}
- Citation rate: ${summary.citation_rate}
- Competitor-only answer rate: ${summary.competitor_only_rate}

## Goal Coverage

${coverageRows.map((row) => `- ${row.area}: ${row.status}. Report: ${row.report}. Missing: ${row.missing || "none"}`).join("\n")}

## Quality Issues

${brokenRows.length ? brokenRows.map((row) => `- ${row.file}: ${row.issue} (${row.count})`).join("\n") : "No scanned broken generated-value markers found."}
`;

  await writeFile(path.join(outputDir, "REPORT.html"), html);
  await writeFile(path.join(outputDir, "REPORT.md"), markdown);
  await writeFile(path.join(outputDir, "evidence-integrity-data.json"), JSON.stringify({ summary: { ...summary, status }, coverageRows, brokenRows, expandedRuns }, null, 2));

  console.log(`Wrote ${outputDir}`);
  console.log(`Status: ${status}`);
  console.log(`Goal areas covered: ${summary.covered_goal_areas}/${goalCoverage.length}`);
  console.log(`Broken markers: ${summary.broken_issue_count}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
