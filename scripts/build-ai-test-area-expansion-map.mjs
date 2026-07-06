#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "test-area-expansion-map");

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

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniq(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function countBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row) || "unknown";
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function countText(entries, limit = 6) {
  return entries
    .slice(0, limit)
    .map(([label, count]) => `${label} ${count}`)
    .join("; ");
}

function promptPurpose(type) {
  const normalized = String(type || "").toLowerCase();
  if (normalized === "mapped") return "Proves whether existing high-priority buyer queries now include iBOLT.";
  if (normalized === "comparison") return "Tests competitor displacement and whether iBOLT is co-mentioned or preferred against named brands.";
  if (normalized === "product_entity") return "Tests whether models recognize exact iBOLT products instead of hallucinating or omitting product names.";
  if (normalized === "non_branded_best") return "Tests broad buyer discovery where the customer does not already know iBOLT.";
  if (normalized === "buyer_problem") return "Tests real use-case questions such as what mount to use for a job, vehicle, restaurant, or device.";
  if (normalized === "citation_probe") return "Tests whether AI systems can cite or source the target iBOLT category.";
  return "Tests expanded coverage for pages that were previously underrepresented.";
}

function businessQuestionForType(type) {
  const normalized = String(type || "").toLowerCase();
  if (normalized === "mapped") return "Do we show up for known target keywords?";
  if (normalized === "comparison") return "Do we show up beside or above competitors?";
  if (normalized === "product_entity") return "Do models understand our actual products?";
  if (normalized === "non_branded_best") return "Do generic buyers discover iBOLT?";
  if (normalized === "buyer_problem") return "Do use-case questions route to iBOLT pages?";
  if (normalized === "citation_probe") return "Can search-connected AI cite iBOLT as a source?";
  return "Are all live blog pages represented in tests?";
}

function successMetricForType(type) {
  const normalized = String(type || "").toLowerCase();
  if (normalized === "mapped") return "iBOLT mentioned and preferably top-3.";
  if (normalized === "comparison") return "iBOLT moves from absent or trailing to co-mentioned, specialist, or top-3.";
  if (normalized === "product_entity") return "Exact product is named with correct use case.";
  if (normalized === "non_branded_best") return "iBOLT appears in generic recommendation sets.";
  if (normalized === "buyer_problem") return "Answer recommends a relevant iBOLT product or category page.";
  if (normalized === "citation_probe") return "Target domain/source URL appears on search-connected AI.";
  return "Prompt produces a measurable mention, ranking, competitor, or citation signal.";
}

function categoryPriority({ requests, competitorOnly, zeroMention, priorityPages, promptGapPages }) {
  return requests + competitorOnly * 15 + zeroMention * 18 + priorityPages * 12 + promptGapPages * 10;
}

function short(value, length = 100) {
  const text = String(value ?? "");
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function barSvg({ title, rows, width = 920, rowHeight = 34, color = "#0f766e", maxValue }) {
  const chartRows = rows.filter((row) => Number.isFinite(row.value)).slice(0, 12);
  const height = 76 + chartRows.length * rowHeight;
  const max = maxValue || Math.max(1, ...chartRows.map((row) => row.value));
  const bars = chartRows.map((row, index) => {
    const y = 58 + index * rowHeight;
    const barWidth = Math.round((row.value / max) * (width - 350));
    return `<g>
      <text x="22" y="${y + 17}" font-size="13" font-weight="800" fill="#111827">${escapeHtml(short(row.label, 42))}</text>
      <rect x="292" y="${y}" width="${width - 350}" height="21" rx="10" fill="#e5e7eb"/>
      <rect x="292" y="${y}" width="${barWidth}" height="21" rx="10" fill="${row.color || color}"/>
      <text x="${width - 28}" y="${y + 16}" font-size="13" font-weight="900" text-anchor="end" fill="#111827">${escapeHtml(row.value)}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#ffffff"/>
    <text x="22" y="34" font-size="20" font-weight="900" fill="#111827">${escapeHtml(title)}</text>
    ${bars}
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
  <title>iBOLT AI Test Area Expansion Map</title>
  <style>
    body{margin:0;background:#f7f9fc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1240px;margin:0 auto;padding:34px 24px 66px}
    h1{font-size:38px;line-height:1.1;margin:0 0 8px;letter-spacing:0}
    h2{font-size:23px;margin:36px 0 12px}
    h3{font-size:17px;margin:18px 0 8px}
    p,li{line-height:1.55;color:#334155;font-size:15px}
    a{color:#0f766e;overflow-wrap:anywhere}
    code{background:#e2e8f0;border-radius:5px;padding:2px 5px}
    .note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #0f766e;border-radius:12px;padding:16px 18px;margin:20px 0}
    .warn{border-left-color:#f97316}
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
    @media(max-width:980px){.cards,.grid{grid-template-columns:1fr}h1{font-size:31px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT AI Test Area Expansion Map</h1>
  <p>This report explains what the expanded 1,449-request benchmark actually tests. It breaks coverage down by category, prompt type, provider, and business question so the retest is defensible instead of just large.</p>

  <div class="note">
    <strong>Current test posture:</strong> the manifest is broad enough to test all major blog/product areas, but the highest-risk categories remain fleet, restaurant, fishing, delivery, warehouse, and AMPS/modular because those combine large page inventories with competitor-only or canonical-cleanup pressure.
  </div>

  <section class="cards">
    ${card("Unique prompts", data.summary.prompts, "Rows in all-blog complete selected prompts.")}
    ${card("Provider requests", data.summary.requests, "Prompt/provider rows across ChatGPT, Claude, and Gemini.")}
    ${card("Categories", data.summary.categories, "Distinct test categories represented.")}
    ${card("Pages", data.summary.pages, "Unique target pages in the expanded manifest.")}
    ${card("Prompt types", data.summary.promptTypes, "Distinct test intents in the manifest.")}
  </section>

  <section class="grid">
    <div class="chart">${data.svgs.categoryRequests}</div>
    <div class="chart">${data.svgs.promptTypes}</div>
  </section>

  <h2>Category Test-Area Matrix</h2>
  <table>${data.tables.categories}</table>

  <h2>Business Questions Covered</h2>
  <table>${data.tables.businessQuestions}</table>

  <h2>Prompt Type Matrix</h2>
  <section class="grid">
    <div class="chart">${data.svgs.businessQuestions}</div>
    <div>${data.tables.promptTypes}</div>
  </section>

  <h2>Provider And Retest Balance</h2>
  <section class="grid">
    <div class="chart">${data.svgs.providers}</div>
    <div>${data.tables.retest}</div>
  </section>

  <h2>Coverage Gaps Closed</h2>
  <div class="note warn">
    The previous all-blog coverage report had six prompt-gap pages. The prompt-gap addendum added ${data.summary.gapPrompts} prompts and ${data.summary.gapRequests} provider requests, then merged them into the full ${data.summary.requests}-request manifest.
  </div>

  <h2>Files</h2>
  <ul>
    <li><a href="category-test-area-matrix.csv">category-test-area-matrix.csv</a></li>
    <li><a href="prompt-type-test-area-matrix.csv">prompt-type-test-area-matrix.csv</a></li>
    <li><a href="business-question-coverage.csv">business-question-coverage.csv</a></li>
    <li><a href="provider-test-balance.csv">provider-test-balance.csv</a></li>
  </ul>
</main>
</body>
</html>`;
}

function renderMarkdown(data) {
  return `# iBOLT AI Test Area Expansion Map

This report explains what the expanded benchmark tests.

## Summary

- Unique prompts: ${data.summary.prompts}
- Provider requests: ${data.summary.requests}
- Categories: ${data.summary.categories}
- Pages: ${data.summary.pages}
- Prompt types: ${data.summary.promptTypes}
- Gap prompts added: ${data.summary.gapPrompts}
- Gap provider requests added: ${data.summary.gapRequests}

## Highest-Risk Categories

${data.categoryRows.slice(0, 10).map((row) => `- ${row.category}: ${row.provider_requests} requests, ${row.prompts} prompts, ${row.live_pages} live pages, ${row.competitor_only_baseline} competitor-only baseline rows. Next: ${row.next_validation}`).join("\n")}

## Business Questions

${data.businessRows.map((row) => `- ${row.business_question}: ${row.prompts} prompts, ${row.provider_requests} requests. ${row.success_metric}`).join("\n")}
`;
}

async function main() {
  const selectedPrompts = await readCsv("all-blog-prompt-gap-addendum/all-blog-complete-selected-prompts.csv");
  const providerManifest = await readCsv("all-blog-prompt-gap-addendum/all-blog-complete-provider-manifest.csv");
  const gapPrompts = await readCsv("all-blog-prompt-gap-addendum/prompt-gap-selected-prompts.csv");
  const gapRequests = await readCsv("all-blog-prompt-gap-addendum/prompt-gap-provider-manifest.csv");
  const coverageCategory = await readCsv("all-blog-test-coverage-report/coverage-by-category.csv");
  const coverageState = await readCsv("all-blog-test-coverage-report/coverage-by-state.csv");
  const categoryWorkload = await readCsv("page-execution-control-board/category-workload.csv");
  const portfolio = await readCsv("blog-portfolio-map/topic-portfolio-scorecard.csv");
  const retest = await readCsv("query-loss-recovery-matrix/retest-wave-recovery-summary.csv");

  const manifestByCategory = groupBy(providerManifest, (row) => row.category || "unknown");
  const selectedByCategory = groupBy(selectedPrompts, (row) => row.category || "unknown");
  const workloadByCategory = new Map(categoryWorkload.map((row) => [row.category, row]));
  const coverageByCategory = new Map(coverageCategory.map((row) => [row.category, row]));
  const portfolioByCategory = new Map(portfolio.map((row) => [row.category, row]));

  const categoryRows = [...manifestByCategory.entries()].map(([category, requests]) => {
    const selected = selectedByCategory.get(category) || [];
    const workload = workloadByCategory.get(category) || {};
    const coverage = coverageByCategory.get(category) || {};
    const portfolioRow = portfolioByCategory.get(category) || {};
    const typeCounts = countBy(selected, (row) => row.prompt_type);
    const sourceCounts = countBy(selected, (row) => row.source);
    const expectedMetrics = uniq(selected.map((row) => row.expected_metric));
    const livePages = toNumber(coverage.pages || portfolioRow.live_pages || workload.pages);
    const competitorOnly = toNumber(coverage.competitor_only_baseline || workload.competitor_only_answers);
    const zeroMention = toNumber(workload.zero_mention_queries);
    const priorityPages = toNumber(coverage.priority_pages);
    const promptGapPages = toNumber(coverage.prompt_gap_pages);
    return {
      priority_score: categoryPriority({
        requests: requests.length,
        competitorOnly,
        zeroMention,
        priorityPages,
        promptGapPages,
      }),
      category,
      live_pages: livePages,
      prompts: selected.length,
      provider_requests: requests.length,
      priority_pages: priorityPages,
      expanded_pages: toNumber(coverage.expanded_pages),
      prompt_gap_pages_initial: promptGapPages,
      competitor_only_baseline: competitorOnly,
      zero_mention_queries: zeroMention,
      prompt_types: countText(typeCounts, 8),
      prompt_sources: countText(sourceCounts, 8),
      top_competitors: workload.top_competitors || portfolioRow.top_competitors || "",
      top_pages: workload.top_pages || coverage.top_gap_pages || "",
      business_questions: uniq(typeCounts.map(([type]) => businessQuestionForType(type))).join("; "),
      success_metrics: expectedMetrics.join("; "),
      next_validation: competitorOnly > 0
        ? "Run W1/W2 mention-recovery retests after page edits, then W3 citation probes."
        : "Run source-readiness and product/entity retests after schema cleanup.",
    };
  }).sort((a, b) => b.priority_score - a.priority_score || a.category.localeCompare(b.category));

  const typeRows = [...groupBy(selectedPrompts, (row) => row.prompt_type || "unknown").entries()].map(([type, prompts]) => {
    const requestRows = providerManifest.filter((row) => row.prompt_type === type);
    return {
      prompt_type: type,
      prompts: prompts.length,
      provider_requests: requestRows.length,
      categories: uniq(prompts.map((row) => row.category)).join("; "),
      pages: uniq(prompts.map((row) => row.page_url)).length,
      purpose: promptPurpose(type),
      business_question: businessQuestionForType(type),
      success_metric: successMetricForType(type),
      examples: prompts.slice(0, 6).map((row) => row.prompt).join("; "),
    };
  }).sort((a, b) => b.provider_requests - a.provider_requests || a.prompt_type.localeCompare(b.prompt_type));

  const businessRows = [...groupBy(typeRows, (row) => row.business_question).entries()].map(([question, rows]) => ({
    business_question: question,
    prompt_types: rows.map((row) => row.prompt_type).join("; "),
    prompts: rows.reduce((sum, row) => sum + row.prompts, 0),
    provider_requests: rows.reduce((sum, row) => sum + row.provider_requests, 0),
    categories: uniq(rows.flatMap((row) => splitList(row.categories))).join("; "),
    success_metric: uniq(rows.map((row) => row.success_metric)).join("; "),
  })).sort((a, b) => b.provider_requests - a.provider_requests || a.business_question.localeCompare(b.business_question));

  const providerRows = [...groupBy(providerManifest, (row) => row.provider || "unknown").entries()].map(([provider, rows]) => ({
    provider,
    requests: rows.length,
    prompts: uniq(rows.map((row) => row.prompt)).length,
    categories: uniq(rows.map((row) => row.category)).join("; "),
    prompt_types: countText(countBy(rows, (row) => row.prompt_type), 8),
  })).sort((a, b) => b.requests - a.requests || a.provider.localeCompare(b.provider));

  const coverageStateRows = coverageState.map((row) => ({
    state: row.coverage_state,
    pages: toNumber(row.pages),
    prompts: toNumber(row.prompts),
    requests: toNumber(row.requests),
    competitor_only_baseline: toNumber(row.competitor_only_baseline),
    example_pages: row.example_pages,
  }));

  const summary = {
    prompts: selectedPrompts.length,
    requests: providerManifest.length,
    categories: uniq(selectedPrompts.map((row) => row.category)).length,
    pages: uniq(selectedPrompts.map((row) => row.page_url)).length,
    promptTypes: uniq(selectedPrompts.map((row) => row.prompt_type)).length,
    gapPrompts: gapPrompts.length,
    gapRequests: gapRequests.length,
  };

  const tables = {
    categories: renderTable(
      ["Category", "Score", "Pages", "Prompts", "Requests", "Competitor-only", "Zero-mention", "Prompt types", "Business questions", "Next validation"],
      categoryRows.map((row) => [
        row.category,
        row.priority_score,
        row.live_pages,
        row.prompts,
        row.provider_requests,
        row.competitor_only_baseline,
        row.zero_mention_queries,
        row.prompt_types,
        row.business_questions,
        row.next_validation,
      ]),
    ),
    promptTypes: renderTable(
      ["Prompt type", "Prompts", "Requests", "Pages", "Purpose", "Success metric"],
      typeRows.map((row) => [
        row.prompt_type,
        row.prompts,
        row.provider_requests,
        row.pages,
        row.purpose,
        row.success_metric,
      ]),
    ),
    businessQuestions: renderTable(
      ["Business question", "Prompt types", "Prompts", "Requests", "Success metric"],
      businessRows.map((row) => [
        row.business_question,
        row.prompt_types,
        row.prompts,
        row.provider_requests,
        row.success_metric,
      ]),
    ),
    retest: renderTable(
      ["Wave", "Requests", "Queries", "Mapped loss queries", "Pages", "Categories", "Success metric"],
      retest.map((row) => [
        row.wave,
        row.requests,
        row.queries,
        row.mapped_loss_queries,
        row.pages,
        row.categories,
        row.success_metric,
      ]),
    ),
  };

  const svgs = {
    categoryRequests: barSvg({
      title: "Provider requests by category",
      rows: categoryRows.map((row) => ({ label: row.category, value: row.provider_requests, color: "#2563eb" })),
    }),
    promptTypes: barSvg({
      title: "Provider requests by prompt type",
      rows: typeRows.map((row) => ({ label: row.prompt_type, value: row.provider_requests, color: "#0f766e" })),
    }),
    businessQuestions: barSvg({
      title: "Business question coverage",
      rows: businessRows.map((row) => ({ label: row.business_question, value: row.provider_requests, color: "#f97316" })),
    }),
    providers: barSvg({
      title: "Provider balance",
      rows: providerRows.map((row) => ({ label: row.provider, value: row.requests, color: "#7c3aed" })),
      maxValue: Math.max(...providerRows.map((row) => row.requests), 1),
    }),
  };

  const data = {
    summary,
    categoryRows,
    typeRows,
    businessRows,
    providerRows,
    coverageStateRows,
    tables,
    svgs,
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml(data));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown(data));
  await writeFile(path.join(outDir, "category-test-area-matrix.csv"), csv([
    [
      "priority_score",
      "category",
      "live_pages",
      "prompts",
      "provider_requests",
      "priority_pages",
      "expanded_pages",
      "prompt_gap_pages_initial",
      "competitor_only_baseline",
      "zero_mention_queries",
      "prompt_types",
      "prompt_sources",
      "top_competitors",
      "top_pages",
      "business_questions",
      "success_metrics",
      "next_validation",
    ],
    ...categoryRows.map((row) => [
      row.priority_score,
      row.category,
      row.live_pages,
      row.prompts,
      row.provider_requests,
      row.priority_pages,
      row.expanded_pages,
      row.prompt_gap_pages_initial,
      row.competitor_only_baseline,
      row.zero_mention_queries,
      row.prompt_types,
      row.prompt_sources,
      row.top_competitors,
      row.top_pages,
      row.business_questions,
      row.success_metrics,
      row.next_validation,
    ]),
  ]));
  await writeFile(path.join(outDir, "prompt-type-test-area-matrix.csv"), csv([
    ["prompt_type", "prompts", "provider_requests", "categories", "pages", "purpose", "business_question", "success_metric", "examples"],
    ...typeRows.map((row) => [
      row.prompt_type,
      row.prompts,
      row.provider_requests,
      row.categories,
      row.pages,
      row.purpose,
      row.business_question,
      row.success_metric,
      row.examples,
    ]),
  ]));
  await writeFile(path.join(outDir, "business-question-coverage.csv"), csv([
    ["business_question", "prompt_types", "prompts", "provider_requests", "categories", "success_metric"],
    ...businessRows.map((row) => [
      row.business_question,
      row.prompt_types,
      row.prompts,
      row.provider_requests,
      row.categories,
      row.success_metric,
    ]),
  ]));
  await writeFile(path.join(outDir, "provider-test-balance.csv"), csv([
    ["provider", "requests", "prompts", "categories", "prompt_types"],
    ...providerRows.map((row) => [
      row.provider,
      row.requests,
      row.prompts,
      row.categories,
      row.prompt_types,
    ]),
  ]));
  await writeFile(path.join(outDir, "coverage-state-summary.csv"), csv([
    ["state", "pages", "prompts", "requests", "competitor_only_baseline", "example_pages"],
    ...coverageStateRows.map((row) => [
      row.state,
      row.pages,
      row.prompts,
      row.requests,
      row.competitor_only_baseline,
      row.example_pages,
    ]),
  ]));

  console.log(`Wrote ${path.join(outDir, "REPORT.html")}`);
  console.log(`Expanded test map: ${summary.prompts} prompts, ${summary.requests} provider requests, ${summary.categories} categories, ${summary.pages} pages`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
