#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "evidence-hub");

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

function byMetric(rows, metric) {
  return rows.find((row) => row.metric === metric) || {};
}

function renderCard(label, value, note) {
  return `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`;
}

function renderReportLinks(reports) {
  return reports.map((report) => `<article class="report">
    <div>
      <h3><a href="../${escapeHtml(report.path)}">${escapeHtml(report.title)}</a></h3>
      <p>${escapeHtml(report.description)}</p>
    </div>
    <span>${escapeHtml(report.owner)}</span>
  </article>`).join("");
}

function renderTable(headers, rows) {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table>${head}${body}</table>`;
}

function renderHtml({ kpis, pageSummary, closureRows, retestRows, competitorRows, reports }) {
  const mention = byMetric(kpis, "Mention rate");
  const nonBranded = byMetric(kpis, "Non-branded mention");
  const top3 = byMetric(kpis, "Top-3 recommendation");
  const citation = byMetric(kpis, "Citation rate");
  const competitorOnly = byMetric(kpis, "Competitor-only answer rate");
  const closure = byMetric(kpis, "Closure verdict");
  const pageRows = Object.fromEntries(pageSummary.map((row) => [row.metric, row.value]));
  const priorityRows = retestRows.map((row) => [row.wave, row.requests, row.unique_prompts, row.success_metric]);
  const blockerRows = closureRows.map((row) => [row.requirement, row.status, row.remaining_gate]);
  const competitorTableRows = competitorRows.slice(0, 10).map((row) => [row.brand, row.tier, row.lost_answers, row.co_mention_wins, row.counter_positioning]);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT AI Visibility Evidence Hub</title>
  <style>
    body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1180px;margin:0 auto;padding:34px 24px 64px}
    h1{font-size:36px;margin:0 0 8px}
    h2{font-size:23px;margin:34px 0 12px}
    h3{font-size:18px;margin:0}
    p,li{line-height:1.55;color:#334155;font-size:15px}
    .note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #0f766e;border-radius:12px;padding:16px 18px;margin:20px 0}
    .warn{border-left-color:#f97316}
    .cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:22px 0}
    .card{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:16px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:800}
    .value{font-size:28px;font-weight:900;margin:8px 0;color:#0f172a}
    .reports{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    .report{display:flex;justify-content:space-between;gap:16px;background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:16px}
    .report span{height:max-content;white-space:nowrap;background:#e2e8f0;color:#334155;border-radius:999px;padding:5px 9px;font-size:12px;font-weight:800}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 22px}
    th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    a{color:#0f766e;overflow-wrap:anywhere}
    code{background:#e2e8f0;border-radius:5px;padding:2px 5px}
    @media(max-width:900px){.cards,.reports{grid-template-columns:1fr}h1{font-size:30px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT AI Visibility Evidence Hub</h1>
  <p>One entry point for the current AI visibility benchmark, competitor analysis, blog-page drilldown, and retest plan.</p>

  <div class="note">
    <strong>Current read:</strong> iBOLT is visible but under-included on broad buyer prompts. The next lift comes from getting iBOLT into more answers first, then pushing source citation with cleaner pages and outside authority.
  </div>

  <section class="cards">
    ${renderCard("Mention rate", mention.current || "24%", mention.note || "Models include iBOLT at all.")}
    ${renderCard("Non-branded mention", nonBranded.current || "5%", nonBranded.note || "Generic buyer prompts.")}
    ${renderCard("Top-3 recommendation", top3.current || "16%", top3.note || "Recommendation strength.")}
    ${renderCard("Citation rate", citation.current || "0%", citation.note || "Source trust.")}
    ${renderCard("Competitor-only", competitorOnly.current || "73%", competitorOnly.note || "Answers that recommend other brands without iBOLT.")}
  </section>

  <section class="cards">
    ${renderCard("Pages classified", pageRows.pages_classified || "142", "All live blog pages in the drilldown.")}
    ${renderCard("Competitor pages", pageRows.competitor_replacement_pages || "20", "Pages tied to competitor-only answers.")}
    ${renderCard("Canonical first", pageRows.canonical_first_pages || "40", "Pages needing survivor/canonical decisions before edits.")}
    ${renderCard("Source cleanup", pageRows.source_cleanup_pages || "117", "Pages needing cleanup before citation work.")}
    ${renderCard("Closure", closure.current || "not_complete", closure.note || "Live retest still required.")}
  </section>

  <div class="note warn">
    <strong>Remaining gate:</strong> the priority retest is staged but not live-run in this shell. Set <code>OPENROUTER_API_KEY</code> securely, run the 204-request priority packet, then rebuild the reports.
  </div>

  <h2>Start Here</h2>
  <section class="reports">${renderReportLinks(reports.slice(0, 8))}</section>

  <h2>Deep Dives</h2>
  <section class="reports">${renderReportLinks(reports.slice(8))}</section>

  <h2>Priority Retest Packet</h2>
  ${renderTable(["Wave", "Requests", "Prompts", "Success metric"], priorityRows)}

  <h2>Competitor Shortlist</h2>
  ${renderTable(["Brand", "Tier", "Lost answers", "Co-mentions", "Counter-positioning"], competitorTableRows)}

  <h2>Completion Gates</h2>
  ${renderTable(["Requirement", "Status", "Remaining gate"], blockerRows)}
</main>
</body>
</html>`;
}

function renderMarkdown({ kpis, pageSummary, closureRows, retestRows, reports }) {
  const get = (name) => byMetric(kpis, name).current || "";
  return `# iBOLT AI Visibility Evidence Hub

## Current KPIs

- Mention rate: ${get("Mention rate")}
- Non-branded mention: ${get("Non-branded mention")}
- Top-3 recommendation: ${get("Top-3 recommendation")}
- Citation rate: ${get("Citation rate")}
- Competitor-only answer rate: ${get("Competitor-only answer rate")}

## Page Coverage

${pageSummary.map((row) => `- ${row.metric}: ${row.value}`).join("\n")}

## Priority Retest

${retestRows.map((row) => `- ${row.wave}: ${row.requests} requests, ${row.unique_prompts} prompts. Success metric: ${row.success_metric}`).join("\n")}

## Key Reports

${reports.map((report) => `- [${report.title}](../${report.path}): ${report.description}`).join("\n")}

## Completion Gates

${closureRows.map((row) => `- ${row.requirement}: ${row.status}. Gate: ${row.remaining_gate}`).join("\n")}
`;
}

async function main() {
  const kpis = await readCsv("boss-ai-visibility-dashboard/boss-dashboard-summary.csv");
  const pageSummary = await readCsv("all-page-ai-drilldown/page-drilldown-summary.csv");
  const closureRows = await readCsv("goal-closure-audit/goal-closure-status.csv");
  const retestRows = await readCsv("priority-retest-packet/retest-batches.csv");
  const competitorRows = await readCsv("answer-examples-report/competitor-comparison-shortlist.csv");
  const reports = [
    { title: "Visibility Working Packet", path: "visibility-working-packet/REPORT.html", owner: "Boss", description: "Single operating packet for mentions, competitor adjacency, all-blog coverage, citation timing, work split, and retest sequencing." },
    { title: "Boss Dashboard", path: "boss-ai-visibility-dashboard/REPORT.html", owner: "Boss", description: "Charts and plain-English KPI story for Katie or leadership." },
    { title: "Citation And Visibility Executive Brief", path: "citation-visibility-executive-brief/REPORT.html", owner: "Boss", description: "Plain-English answer on whether citation rate matters, current visibility health, page-before-outreach sequence, and Jacob/app versus SEO contractor ownership." },
    { title: "Citation And Visibility Boss Memo", path: "citation-visibility-boss-memo/REPORT.html", owner: "Boss", description: "Compact leadership memo answering whether citation rate is necessary, current visibility health, platform differences, owner split, and first actions." },
    { title: "Source and Citation Closure Board", path: "source-citation-closure-board/REPORT.html", owner: "Citation", description: "Strict 142-page closure board that separates canonical-first, source-cleanup, mention-recovery, and citation-outreach lanes." },
    { title: "Source Authority Roadmap", path: "source-authority-roadmap/REPORT.html", owner: "Citation", description: "Topic and competitor source-authority plan for external mentions, third-party guides, partner pages, and citation lift after source cleanup." },
    { title: "Citation Uplift Plan", path: "citation-uplift-plan/REPORT.html", owner: "Citation", description: "Detailed on-site and contractor workstream plan to raise citations without skipping mention and recommendation recovery." },
    { title: "Evidence Integrity Audit", path: "evidence-integrity-audit/REPORT.html", owner: "Audit", description: "Verifies the benchmark packet covers mentions, co-mentions, competitor comparison, all-blog inspection, test expansion, citation strategy, and flags broken generated values." },
    { title: "Next Benchmark Runbook", path: "next-benchmark-runbook/REPORT.html", owner: "Benchmark", description: "Wave-by-wave provider runbook with W1-W5 manifests, commands, dry-run commands, baseline gates, and output checks for the next AI visibility retest." },
    { title: "Retest Execution Gate", path: "retest-execution-gate/REPORT.html", owner: "Benchmark", description: "Separates blocked, conditional, and runnable retest rows so the next provider run does not mix survivor-consolidation work with source-cleanup probes." },
    { title: "Micro-Run Cleanup Packet", path: "micro-run-cleanup-packet/REPORT.html", owner: "Execution", description: "Four-page editor packet that unlocks the six conditional citation-probe rows with quick answers, comparison blocks, product modules, schema, image alt, and CTA cleanup." },
    { title: "Micro-Run Source Snippets", path: "micro-run-source-snippets/REPORT.html", owner: "Execution", description: "Review-ready Shopify HTML and JSON-LD snippets for the four micro-run pages, including answer blocks, comparison copy, FAQ sections, schema drafts, and publishing gates." },
    { title: "Post-Run Comparison Analyzer", path: "post-run-comparison/REPORT.html", owner: "Benchmark", description: "Compares the saved baseline against the newest completed expanded provider run and reports KPI deltas, provider/category performance, and remaining gap rows." },
    { title: "Visibility Completion Control Report", path: "visibility-completion-control-report/REPORT.html", owner: "Audit", description: "Compact control view showing what is proven, what still needs live provider proof, and the credential-safe commands for the remaining retest." },
    { title: "Goal Audit", path: "goal-audit/REPORT.html", owner: "Audit", description: "Requirement-by-requirement proof of what is done and what remains." },
    { title: "AI Answer Examples", path: "answer-examples-report/REPORT.html", owner: "Evidence", description: "Concrete clean mention, co-mention, and competitor-replacement examples." },
    { title: "AI Answer Review Packet", path: "answer-review-packet/REPORT.html", owner: "Evidence", description: "Manager-ready answer snippets with outcome, competitors, target page, and exact page-language/schema/citation commands." },
    { title: "Entity Adjacency Report", path: "entity-adjacency-report/REPORT.html", owner: "Evidence", description: "Classifies every saved answer by iBOLT role, co-mentioned competitors, replacements, provider/category pressure, and counter-angles." },
    { title: "Mention Environment Dossier", path: "mention-environment-dossier/REPORT.html", owner: "Evidence", description: "Explains where iBOLT appears, who appears beside it, which brands replace it, provider/category pressure pockets, and the page countermove queue." },
    { title: "Mention Language Command Deck", path: "mention-language-command-deck/REPORT.html", owner: "Messaging", description: "Shows how AI systems describe iBOLT today, where product names drift, and what copy language should be reinforced by category." },
    { title: "Answer Language Evidence", path: "answer-language-evidence/REPORT.html", owner: "Messaging", description: "Boss-readable answer-language proof showing iBOLT mention quality, competitor replacement language, category copy commands, and page-level citation cleanup actions." },
    { title: "Mention Narrative Drilldown", path: "mention-narrative-drilldown/REPORT.html", owner: "Messaging", description: "Consolidates how AI describes iBOLT, who appears next to it, competitor-owned language, provider/category narrative risk, and example answer snippets." },
    { title: "Product Name Truth Table", path: "product-name-truth-table/REPORT.html", owner: "Messaging", description: "Separates exact catalog product names, valid aliases, manual reviews, and hallucination-risk names, with page-level correction targets." },
    { title: "Competitive Share of Answer", path: "competitive-share-of-answer/REPORT.html", owner: "Competitor", description: "Ranks competitor/entity answer share by brand, provider/category pocket, and first page counterplan." },
    { title: "Competitor and Citation Action Deck", path: "competitor-action-deck/REPORT.html", owner: "Competitor", description: "Boss-ready deck that joins competitor displacement, page targets, prompt targets, and off-site citation asks into one action list." },
    { title: "Competitor Page Counterplan", path: "competitor-page-counterplan/REPORT.html", owner: "Competitor", description: "Maps RAM, Arkon, iOttie, CTA Digital, ProClip, and other replacement brands to exact page edits, prompts, comparison claims, and citation asks." },
    { title: "Competitor Comparison Dossier", path: "competitor-comparison-dossier/REPORT.html", owner: "Competitor", description: "Boss-ready battlecards showing unique competitor-replacement answer rows, brand-level replacement occurrences, co-mentions, page targets, and provider/category pressure." },
    { title: "Category Provider Priority Report", path: "category-provider-priority-report/REPORT.html", owner: "Strategy", description: "Ranks category lanes and provider-specific fixes for delivery, restaurant, fleet, fishing, warehouse, and source/schema work." },
    { title: "Prompt Intent Loss Report", path: "prompt-intent-loss-report/REPORT.html", owner: "Benchmark", description: "Classifies buyer question types, measured losses, all-blog selected prompts, and one-at-a-time retest rows by prompt intent." },
    { title: "Prompt Loss Decision Board", path: "prompt-loss-decision-board/REPORT.html", owner: "Benchmark", description: "Joins exact prompt losses to provider misses, competitors, mapped pages, decision lanes, product modules, and citation timing." },
    { title: "Blog Page Opportunity Heatmap", path: "blog-page-opportunity-heatmap/REPORT.html", owner: "Execution", description: "Ranks all 142 pages by combined AI risk, competitor pressure, checkout value, product coverage, and retest timing." },
    { title: "Product Conversion Visibility Bridge", path: "product-conversion-visibility-bridge/REPORT.html", owner: "Revenue", description: "Connects AI visibility losses to product modules, CTA cleanup, product-family coverage, and checkout-oriented page fixes." },
    { title: "Shopify Blog Content State Bridge", path: "shopify-blog-content-state-bridge/REPORT.html", owner: "Revenue", description: "Live Shopify article inventory, published-vs-draft state, analytics-access proof, and high-intent draft queue joined to AI visibility work." },
    { title: "Portfolio Product Spread Analysis", path: "portfolio-product-spread-analysis/REPORT.html", owner: "Portfolio", description: "Connects all 142 blog pages, product-family spread, benchmark gaps, and refresh-vs-net-new decisions so content expansion does not outrun cleanup." },
    { title: "Product Family AI Visibility Board", path: "product-family-visibility-board/REPORT.html", owner: "Portfolio", description: "Joins product-family coverage, answer product signals, product-name risk, page module targets, and retest prompts." },
    { title: "Blog Body Inspection", path: "blog-body-inspection/REPORT.html", owner: "Execution", description: "Body-level inspection of answer placement, schema, FAQ, internal links, cart CTA density, and old AI-search section leftovers." },
    { title: "All Blog Answer Gap Drilldown", path: "all-blog-answer-gap-drilldown/REPORT.html", owner: "Execution", description: "One-row-per-page drilldown joining answer losses, body issues, page decisions, product-family pressure, retest prompts, and edit sequencing." },
    { title: "Page Decision Map", path: "page-decision-map/REPORT.html", owner: "Execution", description: "Collapses lifecycle, canonical, action, conversion, and language evidence into one decision map: consolidate first, source cleanup first, rewrite/refresh, protect/amplify, or edit first." },
    { title: "Survivor URL Decision Workbook", path: "survivor-url-decision-workbook/REPORT.html", owner: "Execution", description: "Turns consolidation evidence into survivor URL decisions, merge-from holds, prompts to preserve, product modules, and retest gates before the next provider run." },
    { title: "Page Decision Retest Map", path: "page-decision-retest-map/REPORT.html", owner: "Benchmark", description: "Joins page decisions to the 204-request priority provider retest queue, showing which prompts prove each lane after edits are live." },
    { title: "Page Edit Command Matrix", path: "page-edit-command-matrix/REPORT.html", owner: "Execution", description: "Mechanical 142-page edit queue with exact quick-answer, schema, comparison, product-path, CTA, image-alt, and retest commands." },
    { title: "All-Blog Action Control Sheet", path: "all-blog-action-control-sheet/REPORT.html", owner: "Execution", description: "Single 142-page operating sheet joining edit commands, citation stage, product-name risk, conversion pressure, competitor pressure, and retest gates." },
    { title: "Query Loss Recovery Matrix", path: "query-loss-recovery-matrix/REPORT.html", owner: "Editor", description: "Maps losing prompts to target pages, competitors, missing fixes, retest waves, and next actions." },
    { title: "All-Blog Edit and Retest Planner", path: "all-blog-edit-retest-planner/REPORT.html", owner: "Execution", description: "142-page work queue that orders edits, checkout/product modules, citation timing, and retest waves." },
    { title: "All Blog Page Drilldown", path: "all-page-ai-drilldown/REPORT.html", owner: "Editor", description: "142-page edit map with stage, issues, competitors, products, and retest prompts." },
    { title: "All Blog Test Coverage", path: "all-blog-test-coverage-report/REPORT.html", owner: "Benchmark", description: "Page-level map of which live blog posts have baseline, expanded, priority, or missing benchmark prompt coverage." },
    { title: "All Blog Prompt Gap Addendum", path: "all-blog-prompt-gap-addendum/REPORT.html", owner: "Benchmark", description: "Adds runnable prompts for the six uncovered live blog pages and produces a full 1,449-request all-blog provider manifest." },
    { title: "Low Coverage Prompt Expansion Pack", path: "low-coverage-prompt-expansion-pack/REPORT.html", owner: "Benchmark", description: "Focused 112-page prompt expansion pack with buyer, competitor, product-entity, and citation probes for low/no benchmark coverage pages." },
    { title: "Test Area Expansion Map", path: "test-area-expansion-map/REPORT.html", owner: "Benchmark", description: "Explains the full benchmark by category, prompt type, provider balance, business question, and gap closure." },
    { title: "Benchmark Manifest QA", path: "benchmark-manifest-qa/REPORT.html", owner: "Benchmark", description: "Preflight validation for the 1,449-request all-blog benchmark manifest, including exact provider balance and prompt-quality flags." },
    { title: "Benchmark History", path: "benchmark-history/REPORT.html", owner: "Benchmark", description: "Compares completed benchmark surfaces, live blog audit snapshots, and expanded dry-run readiness over time." },
    { title: "Priority Retest Packet", path: "priority-retest-packet/REPORT.html", owner: "Benchmark", description: "204 exact provider requests across 78 prompts, 21 pages, and 10 categories." },
    { title: "KPI Retest Ladder", path: "visibility-kpi-retest-ladder/REPORT.html", owner: "Benchmark", description: "Count-based pass/fail targets for mention, non-branded mention, top-3 recommendation, citation, and competitor-only reduction." },
    { title: "Citation Priority Model", path: "citation-priority-model/REPORT.html", owner: "Citation", description: "Boss-friendly scorecard that ranks page, topic, competitor, and platform citation priorities while keeping inclusion before citation outreach." },
    { title: "Visibility to Citation Bridge", path: "visibility-citation-bridge/REPORT.html", owner: "Citation", description: "Shows which pages need mention recovery before citation work and which pages can move into source/citation cleanup now." },
    { title: "Page Execution Board", path: "page-execution-control-board/REPORT.html", owner: "Editor", description: "142 work orders, Sprint 1 pages, product-family spread, and retest readiness." },
    { title: "Sprint 1 Edit Command Sheet", path: "sprint1-edit-command-sheet/REPORT.html", owner: "Editor", description: "Exact edit commands, copy blocks, product modules, schema fixes, citation timing, and retest checklist for the first three pages." },
    { title: "Competitor Battlecards", path: "competitor-battlecard-control-report/REPORT.html", owner: "Competitor", description: "RAM, Arkon, iOttie, ProClip, CTA Digital, and other displacement targets." },
    { title: "Citation Timing Control", path: "citation-vs-mention-control-report/REPORT.html", owner: "Citation", description: "Explains citation versus mention timing and why citation work follows page cleanup." },
    { title: "Citation Rate Dashboard", path: "citation-rate-visibility-dashboard/REPORT.html", owner: "Citation", description: "Citation-rate KPI, source-ready pages, provider rows, and workplan." },
    { title: "Contractor Citation Packet", path: "contractor-citation-packet/REPORT.html", owner: "Contractor", description: "Off-site citation tasks to hand to SEO/backlink support." },
    { title: "Message Gap Map", path: "message-gap-map/REPORT.html", owner: "Messaging", description: "Rugged durability, install clarity, stability, compatibility, and adjustability gaps." },
    { title: "Provider Strategy", path: "provider-strategy-report/REPORT.html", owner: "Benchmark", description: "ChatGPT, Claude, and Gemini behavior split and provider-specific fixes." },
    { title: "Vertical Playbooks", path: "vertical-playbooks/REPORT.html", owner: "Strategy", description: "Category playbooks for restaurant, delivery, fleet, fishing, warehouse, and more." },
    { title: "30-Day Control Tower", path: "thirty-day-visibility-control-tower/REPORT.html", owner: "Execution", description: "30-day sequencing across page edits, contractor tasks, and retests." },
  ];

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml({ kpis, pageSummary, closureRows, retestRows, competitorRows, reports }));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown({ kpis, pageSummary, closureRows, retestRows, reports }));
  await writeFile(path.join(outDir, "artifact-index.csv"), csv([
    ["title", "owner", "path", "description"],
    ...reports.map((report) => [report.title, report.owner, report.path, report.description]),
  ]));

  console.log(`Wrote ${outDir}`);
  console.log(`Reports indexed: ${reports.length}`);
  console.log(`Retest waves: ${retestRows.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
