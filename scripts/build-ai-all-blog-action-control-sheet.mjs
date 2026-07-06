#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "all-blog-action-control-sheet");

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

async function readCsv(relativePath) {
  try {
    return parseCsv(await readFile(path.join(benchmarkDir, relativePath), "utf8"));
  } catch {
    return [];
  }
}

async function readJson(relativePath, fallback = {}) {
  try {
    return JSON.parse(await readFile(path.join(benchmarkDir, relativePath), "utf8"));
  } catch {
    return fallback;
  }
}

function num(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeUrl(value) {
  return String(value ?? "")
    .trim()
    .replace(/^http:\/\//i, "https://")
    .replace(/\/$/, "");
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/^\+\d+\s+more$/i.test(item));
}

function unique(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function short(value, length = 120) {
  const text = String(value ?? "");
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function indexByUrl(rows, keys = ["url"]) {
  const map = new Map();
  for (const row of rows) {
    for (const key of keys) {
      const normalized = normalizeUrl(row[key]);
      if (normalized && !map.has(normalized)) map.set(normalized, row);
    }
  }
  return map;
}

function groupByUrl(rows, keys = ["url"]) {
  const map = new Map();
  for (const row of rows) {
    const key = normalizeUrl(keys.map((field) => row[field]).find(Boolean));
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function addCounter(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function topCounter(counter, count = 6) {
  return [...counter.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, count)
    .map(([label, value]) => `${label} ${value}`);
}

function ownerFor(row) {
  if (/outreach|contractor|off-site/i.test(`${row.citation_lane} ${row.citation_action}`)) return "Jacob/app first, SEO contractor after cleanup";
  if (num(row.product_name_risk) > 0) return "Jacob/app";
  if (/schema|quick|comparison|CTA|product/i.test(row.command_summary || "")) return "Jacob/app";
  return "Jacob/app";
}

function releaseGate(row) {
  if (/Mention recovery first/i.test(row.citation_lane)) return "Retest W1/W2 only after quick answer, comparison block, product module, and schema are live.";
  if (/Product-name cleanup/i.test(row.citation_lane)) return "Retest product-entity prompts only after risky aliases are replaced with verified Shopify titles.";
  if (/Source-ready cleanup/i.test(row.citation_lane)) return "Send to citation/outreach only after source-ready cleanup is complete.";
  return "Monitor, support with internal links, and include in full all-blog retest.";
}

function firstNonEmpty(...values) {
  return values.find((value) => String(value ?? "").trim()) || "";
}

function buildActionRows({ commandRows, citationRows, productRows, conversionRows, drillRows, lossRows }) {
  const citationByUrl = indexByUrl(citationRows);
  const productByUrl = indexByUrl(productRows);
  const conversionByUrl = indexByUrl(conversionRows);
  const drillByUrl = indexByUrl(drillRows);
  const lossByUrl = groupByUrl(lossRows, ["page_url"]);

  return commandRows.map((command) => {
    const url = normalizeUrl(command.url);
    const citation = citationByUrl.get(url) || {};
    const product = productByUrl.get(url) || {};
    const conversion = conversionByUrl.get(url) || {};
    const drill = drillByUrl.get(url) || {};
    const losses = (lossByUrl.get(url) || []).sort((a, b) => num(b.severity) - num(a.severity)).slice(0, 4);
    const lossSeverity = losses.reduce((sum, row) => sum + num(row.severity), 0);
    const productRisk = num(product.hallucination_risk || citation.product_name_risk);
    const competitorOnly = num(command.competitor_only_answers || citation.competitor_only_answers || drill.competitor_only_answers);
    const zeroMention = num(command.zero_mention_queries || citation.zero_mention_queries || drill.zero_mention_queries);
    const issueCount = num(command.issue_count);
    const priority = Math.round(
      num(command.priority) +
      num(citation.score) * 0.7 +
      num(conversion.bridge_score) * 0.35 +
      productRisk * 18 +
      lossSeverity / 10 +
      competitorOnly * 10 +
      zeroMention * 18
    );
    const row = {
      priority,
      rank: 0,
      sprint: command.sprint || conversion.conversion_tier || drill.conversion_tier || "",
      batch: command.batch || "",
      retest_wave: command.retest_wave || "",
      citation_lane: citation.lane || drill.citation_readiness_bucket || "",
      visibility_stage: drill.ai_visibility_stage || "",
      title: command.title || citation.title || drill.title,
      url: command.url || citation.url || drill.url,
      category: command.category || citation.category || drill.category,
      body_score: num(command.body_score),
      opportunity_score: num(command.opportunity_score),
      issue_count: issueCount,
      top_fix: command.top_fix || citation.top_fix || "",
      zero_mention_queries: zeroMention,
      competitor_only_answers: competitorOnly,
      primary_competitor: command.primary_competitor || splitList(citation.competitors)[0] || "",
      competitors: firstNonEmpty(command.competitors, citation.competitors, drill.competitors),
      losing_queries: unique(losses.map((loss) => loss.query)).slice(0, 4),
      missed_providers: unique(losses.flatMap((loss) => splitList(loss.missed_providers))).slice(0, 4),
      retest_prompts: firstNonEmpty(command.retest_prompts, citation.retest_prompts, drill.retest_prompts),
      products_to_feature: firstNonEmpty(product.products_to_reinforce, command.products, citation.products_to_feature, conversion.products_to_feature),
      product_name_risk: productRisk,
      names_to_suppress: product.names_to_suppress || citation.names_to_suppress || "",
      product_name_action: product.action || citation.product_name_action || "",
      quick_answer_command: command.quick_answer_command,
      schema_command: command.schema_command,
      comparison_command: command.comparison_command,
      product_path_command: command.product_path_command || conversion.product_module_action,
      cta_command: command.cta_command || conversion.cta_action,
      citation_action: firstNonEmpty(citation.action, command.citation_action, citation.citation_next_action),
      first_hour_action: command.first_hour_action,
      language_instruction: command.language_instruction,
      success_metric: losses[0]?.success_metric || citation.retest_metric || "Mapped prompt improves from competitor-only/no-signal to iBOLT-included or top-3.",
      command_summary: command.command_summary,
    };
    row.owner = ownerFor(row);
    row.release_gate = releaseGate(row);
    row.immediate_action = firstNonEmpty(row.first_hour_action, row.quick_answer_command, row.command_summary, row.citation_action);
    return row;
  }).sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title)).map((row, index) => ({ ...row, rank: index + 1 }));
}

function buildCategoryRows(rows) {
  const byCategory = new Map();
  for (const row of rows) {
    const key = row.category || "other";
    if (!byCategory.has(key)) {
      byCategory.set(key, {
        category: key,
        pages: 0,
        priority: 0,
        mention_recovery_pages: 0,
        product_name_risk_pages: 0,
        source_cleanup_pages: 0,
        competitor_only_answers: 0,
        zero_mention_queries: 0,
        topCompetitors: new Map(),
        topFixes: new Map(),
        firstPages: [],
      });
    }
    const group = byCategory.get(key);
    group.pages += 1;
    group.priority += num(row.priority);
    group.competitor_only_answers += num(row.competitor_only_answers);
    group.zero_mention_queries += num(row.zero_mention_queries);
    if (/Mention recovery/i.test(row.citation_lane)) group.mention_recovery_pages += 1;
    if (num(row.product_name_risk) > 0) group.product_name_risk_pages += 1;
    if (/Source-ready cleanup/i.test(row.citation_lane)) group.source_cleanup_pages += 1;
    for (const competitor of splitList(row.competitors)) addCounter(group.topCompetitors, competitor);
    addCounter(group.topFixes, row.top_fix);
    if (group.firstPages.length < 5) group.firstPages.push(row.title);
  }
  return [...byCategory.values()]
    .map((row) => ({
      ...row,
      avg_priority: Math.round(row.priority / Math.max(1, row.pages)),
      top_competitors: topCounter(row.topCompetitors),
      top_fixes: topCounter(row.topFixes),
      first_pages: row.firstPages,
    }))
    .sort((a, b) => b.priority - a.priority || a.category.localeCompare(b.category));
}

function buildSprintRows(rows) {
  const bySprint = new Map();
  for (const row of rows) {
    const key = row.sprint || "Unassigned";
    if (!bySprint.has(key)) {
      bySprint.set(key, {
        sprint: key,
        pages: 0,
        priority: 0,
        competitor_only_answers: 0,
        product_name_risk_pages: 0,
        source_cleanup_pages: 0,
        categories: new Map(),
        topPages: [],
      });
    }
    const group = bySprint.get(key);
    group.pages += 1;
    group.priority += row.priority;
    group.competitor_only_answers += num(row.competitor_only_answers);
    if (num(row.product_name_risk) > 0) group.product_name_risk_pages += 1;
    if (/Source-ready cleanup/i.test(row.citation_lane)) group.source_cleanup_pages += 1;
    addCounter(group.categories, row.category);
    if (group.topPages.length < 8) group.topPages.push(row.title);
  }
  return [...bySprint.values()]
    .map((row) => ({
      ...row,
      avg_priority: Math.round(row.priority / Math.max(1, row.pages)),
      categories: topCounter(row.categories),
    }))
    .sort((a, b) => {
      const sprintOrder = /Sprint 1/i.test(a.sprint) ? -1 : /Sprint 1/i.test(b.sprint) ? 1 : 0;
      return sprintOrder || b.priority - a.priority || a.sprint.localeCompare(b.sprint);
    });
}

function renderTable(headers, rows) {
  return `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map((cell) => String(cell ?? "").replace(/\|/g, "\\|")).join(" | ")} |`),
  ].join("\n");
}

function barSvg({ title, rows, width = 900, color = "#0f766e" }) {
  const chartRows = rows.slice(0, 12);
  const rowHeight = 34;
  const height = 72 + chartRows.length * rowHeight;
  const max = Math.max(1, ...chartRows.map((row) => row.value));
  const bars = chartRows.map((row, index) => {
    const y = 54 + index * rowHeight;
    const barWidth = Math.round((row.value / max) * (width - 330));
    return `<g>
      <text x="22" y="${y + 17}" font-size="13" font-weight="700" fill="#111827">${escapeHtml(short(row.label, 38))}</text>
      <rect x="275" y="${y}" width="${width - 340}" height="21" rx="10" fill="#e5e7eb"/>
      <rect x="275" y="${y}" width="${barWidth}" height="21" rx="10" fill="${row.color || color}"/>
      <text x="${width - 28}" y="${y + 16}" font-size="13" font-weight="800" text-anchor="end" fill="#111827">${escapeHtml(row.display ?? row.value)}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#ffffff"/>
    <text x="22" y="34" font-size="20" font-weight="800" fill="#111827">${escapeHtml(title)}</text>
    ${bars}
  </svg>`;
}

async function main() {
  await mkdir(outDir, { recursive: true });

  const commandRows = await readCsv("page-edit-command-matrix/page-edit-command-matrix.csv");
  const citationRows = await readCsv("citation-priority-model/page-citation-priority-model.csv");
  const productRows = await readCsv("product-name-truth-table/page-product-name-correction-map.csv");
  const conversionRows = await readCsv("product-conversion-visibility-bridge/conversion-page-action-bridge.csv");
  const drillRows = await readCsv("all-page-ai-drilldown/all-page-ai-drilldown.csv");
  const lossRows = await readCsv("query-loss-recovery-matrix/query-loss-recovery-matrix.csv");
  const kpiData = await readJson("visibility-kpi-retest-ladder/visibility-kpi-ladder-data.json", { summary: {} });
  const citationModel = await readJson("citation-priority-model/citation-priority-model-data.json", { summary: {} });

  const rows = buildActionRows({ commandRows, citationRows, productRows, conversionRows, drillRows, lossRows });
  const categoryRows = buildCategoryRows(rows);
  const sprintRows = buildSprintRows(rows);
  const first30 = rows.slice(0, 30);

  const summary = {
    generatedAt: new Date().toISOString(),
    benchmarkDir,
    pages: rows.length,
    sprint1Pages: rows.filter((row) => /Sprint 1/i.test(row.sprint)).length,
    sprint2Pages: rows.filter((row) => /Sprint 2/i.test(row.sprint)).length,
    mentionRecoveryPages: rows.filter((row) => /Mention recovery/i.test(row.citation_lane)).length,
    sourceCleanupPages: rows.filter((row) => /Source-ready cleanup/i.test(row.citation_lane)).length,
    productNameRiskPages: rows.filter((row) => num(row.product_name_risk) > 0).length,
    competitorOnlyAnswers: rows.reduce((sum, row) => sum + num(row.competitor_only_answers), 0),
    quickAnswerPages: rows.filter((row) => /quick answer/i.test(row.command_summary || row.quick_answer_command || "")).length,
    schemaPages: rows.filter((row) => /schema/i.test(row.command_summary || row.schema_command || "")).length,
    comparisonPages: rows.filter((row) => /comparison/i.test(row.command_summary || row.comparison_command || "")).length,
    ctaCleanupPages: rows.filter((row) => /CTA|cart/i.test(row.command_summary || row.cta_command || "")).length,
    citationLiftNeeded: kpiData.summary?.citationLiftNeeded || 0,
    mentionLiftNeeded: kpiData.summary?.mentionLiftNeeded || 0,
    citationOutreachCandidates: citationModel.summary?.citationOutreachCandidates || 0,
  };

  const categoryChart = barSvg({
    title: "All-blog action priority by category",
    rows: categoryRows.map((row) => ({ label: row.category, value: row.priority })),
    color: "#2563eb",
  });
  const sprintChart = barSvg({
    title: "Action priority by sprint",
    rows: sprintRows.map((row) => ({ label: row.sprint, value: row.priority })),
    color: "#0f766e",
  });
  await writeFile(path.join(outDir, "category-action-priority.svg"), categoryChart);
  await writeFile(path.join(outDir, "sprint-action-priority.svg"), sprintChart);

  await writeFile(path.join(outDir, "all-blog-action-control-sheet.csv"), csv([
    ["rank", "priority", "sprint", "batch", "retest_wave", "citation_lane", "visibility_stage", "title", "url", "category", "body_score", "opportunity_score", "issue_count", "top_fix", "zero_mention_queries", "competitor_only_answers", "primary_competitor", "competitors", "losing_queries", "missed_providers", "retest_prompts", "products_to_feature", "product_name_risk", "names_to_suppress", "immediate_action", "quick_answer_command", "schema_command", "comparison_command", "product_path_command", "cta_command", "citation_action", "language_instruction", "owner", "release_gate", "success_metric"],
    ...rows.map((row) => [
      row.rank,
      row.priority,
      row.sprint,
      row.batch,
      row.retest_wave,
      row.citation_lane,
      row.visibility_stage,
      row.title,
      row.url,
      row.category,
      row.body_score,
      row.opportunity_score,
      row.issue_count,
      row.top_fix,
      row.zero_mention_queries,
      row.competitor_only_answers,
      row.primary_competitor,
      row.competitors,
      row.losing_queries,
      row.missed_providers,
      row.retest_prompts,
      row.products_to_feature,
      row.product_name_risk,
      row.names_to_suppress,
      row.immediate_action,
      row.quick_answer_command,
      row.schema_command,
      row.comparison_command,
      row.product_path_command,
      row.cta_command,
      row.citation_action,
      row.language_instruction,
      row.owner,
      row.release_gate,
      row.success_metric,
    ]),
  ]));

  await writeFile(path.join(outDir, "first-30-action-control-sheet.csv"), csv([
    ["rank", "priority", "title", "category", "sprint", "citation_lane", "top_fix", "competitors", "losing_queries", "products_to_feature", "immediate_action", "release_gate"],
    ...first30.map((row) => [row.rank, row.priority, row.title, row.category, row.sprint, row.citation_lane, row.top_fix, row.competitors, row.losing_queries, row.products_to_feature, row.immediate_action, row.release_gate]),
  ]));

  await writeFile(path.join(outDir, "category-action-rollup.csv"), csv([
    ["category", "pages", "total_priority", "avg_priority", "mention_recovery_pages", "product_name_risk_pages", "source_cleanup_pages", "competitor_only_answers", "zero_mention_queries", "top_competitors", "top_fixes", "first_pages"],
    ...categoryRows.map((row) => [row.category, row.pages, row.priority, row.avg_priority, row.mention_recovery_pages, row.product_name_risk_pages, row.source_cleanup_pages, row.competitor_only_answers, row.zero_mention_queries, row.top_competitors, row.top_fixes, row.first_pages]),
  ]));

  await writeFile(path.join(outDir, "sprint-action-rollup.csv"), csv([
    ["sprint", "pages", "total_priority", "avg_priority", "competitor_only_answers", "product_name_risk_pages", "source_cleanup_pages", "categories", "top_pages"],
    ...sprintRows.map((row) => [row.sprint, row.pages, row.priority, row.avg_priority, row.competitor_only_answers, row.product_name_risk_pages, row.source_cleanup_pages, row.categories, row.topPages]),
  ]));

  await writeFile(path.join(outDir, "all-blog-action-control-data.json"), JSON.stringify({ summary, first30, categoryRows, sprintRows }, null, 2));

  const firstRows = first30.slice(0, 15).map((row) => [
    row.rank,
    row.priority,
    row.title,
    row.category,
    row.sprint,
    row.top_fix,
    short(row.immediate_action, 160),
    short(row.release_gate, 120),
  ]);
  const categoryTableRows = categoryRows.slice(0, 10).map((row) => [
    row.category,
    row.pages,
    row.avg_priority,
    row.mention_recovery_pages,
    row.product_name_risk_pages,
    row.source_cleanup_pages,
    row.top_competitors.join("; "),
  ]);
  const sprintTableRows = sprintRows.map((row) => [
    row.sprint,
    row.pages,
    row.avg_priority,
    row.competitor_only_answers,
    row.product_name_risk_pages,
    row.source_cleanup_pages,
    row.topPages.slice(0, 5).join("; "),
  ]);

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>iBOLT All-Blog Action Control Sheet</title>
  <style>
    body{font-family:Inter,Arial,sans-serif;margin:0;background:#f3f6fb;color:#111827;line-height:1.45}
    main{max-width:1180px;margin:0 auto;padding:34px 22px 56px}
    h1{font-size:34px;margin:0 0 8px}
    h2{font-size:22px;margin:30px 0 12px}
    p{color:#374151}
    a{color:#0f766e}
    .note{background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:16px 18px;margin:18px 0}
    .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:20px 0}
    .card{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:16px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;font-weight:800}
    .value{font-size:30px;font-weight:900;margin-top:6px}
    .chart{background:#fff;border:1px solid #dbe3ef;border-radius:18px;padding:10px;margin:16px 0;overflow:auto}
    .chart svg{width:100%;height:auto;display:block}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden}
    th,td{text-align:left;vertical-align:top;border-bottom:1px solid #e5e7eb;padding:10px 12px;font-size:13px}
    th{background:#eaf0f8;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
    .small{font-size:13px;color:#64748b}
  </style>
</head>
<body>
<main>
  <h1>iBOLT All-Blog Action Control Sheet</h1>
  <p class="small">Generated ${escapeHtml(summary.generatedAt)} from saved benchmark artifacts. This is an execution queue, not a live provider retest.</p>
  <div class="note"><strong>Purpose:</strong> this joins the 142-page command matrix, citation priority model, product-name risk table, conversion bridge, query-loss matrix, and page drilldown into one page-level operating sheet.</div>
  <section class="grid">
    <div class="card"><div class="label">Pages queued</div><div class="value">${summary.pages}</div><p>Every audited blog page has an action row.</p></div>
    <div class="card"><div class="label">Mention recovery</div><div class="value">${summary.mentionRecoveryPages}</div><p>Pages that need iBOLT inclusion before citation work.</p></div>
    <div class="card"><div class="label">Product-name risk</div><div class="value">${summary.productNameRiskPages}</div><p>Pages with risky AI-visible product aliases to fix.</p></div>
    <div class="card"><div class="label">Citation outreach now</div><div class="value">${summary.citationOutreachCandidates}</div><p>Pages ready for outreach before cleanup.</p></div>
  </section>
  <section class="chart">${categoryChart}</section>
  <section class="chart">${sprintChart}</section>

  <h2>First 15 Actions</h2>
  ${renderTable(["Rank", "Priority", "Page", "Category", "Sprint", "Top fix", "Immediate action", "Release gate"], firstRows)}

  <h2>Category Rollup</h2>
  ${renderTable(["Category", "Pages", "Avg priority", "Mention recovery", "Product risk", "Source cleanup", "Top competitors"], categoryTableRows)}

  <h2>Sprint Rollup</h2>
  ${renderTable(["Sprint", "Pages", "Avg priority", "Competitor-only", "Product risk", "Source cleanup", "Top pages"], sprintTableRows)}

  <h2>Files</h2>
  <ul>
    <li><a href="all-blog-action-control-sheet.csv">all-blog-action-control-sheet.csv</a></li>
    <li><a href="first-30-action-control-sheet.csv">first-30-action-control-sheet.csv</a></li>
    <li><a href="category-action-rollup.csv">category-action-rollup.csv</a></li>
    <li><a href="sprint-action-rollup.csv">sprint-action-rollup.csv</a></li>
  </ul>
</main>
</body>
</html>`;

  const md = `# iBOLT All-Blog Action Control Sheet

Generated ${summary.generatedAt} from saved benchmark artifacts. This is an execution queue, not a live provider retest.

## Bottom Line

This joins the 142-page command matrix, citation priority model, product-name risk table, conversion bridge, query-loss matrix, and page drilldown into one page-level operating sheet.

## Summary

- Pages queued: ${summary.pages}
- Sprint 1 pages: ${summary.sprint1Pages}
- Sprint 2 pages: ${summary.sprint2Pages}
- Mention recovery pages: ${summary.mentionRecoveryPages}
- Source cleanup pages: ${summary.sourceCleanupPages}
- Product-name risk pages: ${summary.productNameRiskPages}
- Citation outreach candidates now: ${summary.citationOutreachCandidates}
- Quick-answer pages: ${summary.quickAnswerPages}
- Schema pages: ${summary.schemaPages}
- Comparison pages: ${summary.comparisonPages}
- CTA cleanup pages: ${summary.ctaCleanupPages}
- KPI lift gates: +${summary.mentionLiftNeeded} mentions and +${summary.citationLiftNeeded} citations.

## First 15 Actions

${markdownTable(["Rank", "Priority", "Page", "Category", "Sprint", "Top fix", "Immediate action", "Release gate"], firstRows)}

## Category Rollup

${markdownTable(["Category", "Pages", "Avg priority", "Mention recovery", "Product risk", "Source cleanup", "Top competitors"], categoryTableRows)}

## Sprint Rollup

${markdownTable(["Sprint", "Pages", "Avg priority", "Competitor-only", "Product risk", "Source cleanup", "Top pages"], sprintTableRows)}

## Outputs

- all-blog-action-control-sheet.csv
- first-30-action-control-sheet.csv
- category-action-rollup.csv
- sprint-action-rollup.csv
`;

  await writeFile(path.join(outDir, "REPORT.html"), html);
  await writeFile(path.join(outDir, "REPORT.md"), md);

  console.log(`Wrote ${outDir}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
