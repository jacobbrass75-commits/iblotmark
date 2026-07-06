#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "all-blog-edit-retest-planner");

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
  if (typeof value === "number") return value;
  const match = String(value ?? "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function normalizeUrl(value) {
  return String(value ?? "").replace(/\/$/, "").trim();
}

function short(value, length = 110) {
  const text = String(value ?? "");
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row) || "unknown";
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

function countList(rows, key, limit = 8) {
  const counts = new Map();
  for (const row of rows) {
    for (const item of splitList(row[key])) {
      counts.set(item, (counts.get(item) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([item, count]) => `${item} ${count}`)
    .join("; ");
}

function renderTable(headers, rows) {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table>${head}${body}</table>`;
}

function card(label, value, note) {
  return `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`;
}

function barSvg({ title, rows, width = 900, rowHeight = 34, maxValue, color = "#0f766e" }) {
  const chartRows = rows.filter((row) => Number.isFinite(row.value)).slice(0, 12);
  const height = 76 + chartRows.length * rowHeight;
  const max = maxValue || Math.max(1, ...chartRows.map((row) => row.value));
  const bars = chartRows.map((row, index) => {
    const y = 58 + index * rowHeight;
    const barWidth = Math.round((row.value / max) * (width - 350));
    return `<g>
      <text x="22" y="${y + 17}" font-size="13" font-weight="800" fill="#111827">${escapeHtml(short(row.label, 40))}</text>
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

function findByUrl(rows, url) {
  const normalized = normalizeUrl(url);
  return rows.find((row) => normalizeUrl(row.url || row.page_url) === normalized) || {};
}

function batchFor({ work, conversion, bridge, duplicate }) {
  const lane = `${work.execution_lane || ""} ${bridge.stage || ""} ${work.lifecycle_bucket || ""} ${conversion.recommended_action || ""}`;
  if (work.conversion_tier === "Sprint 1" || conversion.conversion_tier === "Sprint 1") {
    return "B01 Sprint 1 mention and checkout recovery";
  }
  if (/Canonical plus mention|Mention recovery first/i.test(lane) && toNumber(work.competitor_only_answers) > 0) {
    return "B02 Competitor mention recovery";
  }
  if (duplicate) {
    return "B03 Canonical consolidation";
  }
  if (/Citation\/source push now|Source-ready cleanup|source-ready/i.test(lane)) {
    return "B04 Citation and source cleanup";
  }
  if (toNumber(work.product_entity_targets) || toNumber(conversion.product_entity_targets)) {
    return "B05 Product entity strengthening";
  }
  return "B06 Monitor and maintain";
}

function retestWaveFor(batch, work, bridge) {
  if (batch.startsWith("B01")) return "R01 W1 Sprint 1 edit validation";
  if (batch.startsWith("B02")) return "R02 W2 top-page mention recovery";
  if (batch.startsWith("B04")) return "R03 W3 citation probe";
  if (toNumber(work.product_entity_targets) > 0 || /product/i.test(bridge.retest_metric || "")) return "R04 W4 product entity recognition";
  return "Full 1,449-request manifest after batch completion";
}

function batchObjective(batch) {
  if (batch.startsWith("B01")) return "Fix the highest commercial pages first, then run the 27-request W1 retest.";
  if (batch.startsWith("B02")) return "Recover iBOLT inclusion against competitor-only answers before citation outreach.";
  if (batch.startsWith("B03")) return "Pick survivor URLs, merge useful content, and avoid splitting entity signals.";
  if (batch.startsWith("B04")) return "Make source-ready pages easier to cite with schema, specs, and external mentions.";
  if (batch.startsWith("B05")) return "Strengthen exact product names, product modules, alt text, and schema.";
  return "Keep stable pages linked and ready for later full-manifest validation.";
}

function renderHtml(data) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT All-Blog Edit and Retest Planner</title>
  <style>
    body{margin:0;background:#f7f9fc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1240px;margin:0 auto;padding:34px 24px 66px}
    h1{font-size:38px;line-height:1.1;margin:0 0 8px;letter-spacing:0}
    h2{font-size:23px;margin:36px 0 12px}
    h3{font-size:17px;margin:18px 0 8px}
    p,li{line-height:1.55;color:#334155;font-size:15px}
    a{color:#0f766e;overflow-wrap:anywhere}
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
  <h1>iBOLT All-Blog Edit and Retest Planner</h1>
  <p>This converts the 142-page audit into ordered work batches. It joins AI visibility pressure, checkout/product opportunity, canonical risk, citation timing, language guidance, and retest waves.</p>

  <div class="note">
    <strong>Use this as the execution queue:</strong> edit B01 first, run the W1 retest, then move through B02 mention recovery before B04 citation outreach. This prevents us from chasing citations on pages where AI systems still omit iBOLT.
  </div>

  <section class="cards">
    ${card("Pages planned", data.summary.pages, "All live blog/page rows in the work order queue.")}
    ${card("B01 pages", data.summary.b01Pages, "Highest commercial pages tied to W1 retest.")}
    ${card("Mention-first", data.summary.mentionFirstPages, "Pages that need iBOLT inclusion before citation work.")}
    ${card("Citation-ready", data.summary.citationReadyPages, "Pages suitable for source/schema/citation cleanup.")}
    ${card("Duplicate pairs", data.summary.duplicatePairs, "Canonical merge or redirect decisions to protect entity signals.")}
  </section>

  <section class="grid">
    <div class="chart">${data.svgs.batchCounts}</div>
    <div class="chart">${data.svgs.categoryPriority}</div>
  </section>

  <h2>First 20 Work Orders</h2>
  ${data.tables.firstTwenty}

  <h2>Batch Summary</h2>
  ${data.tables.batchSummary}

  <h2>Category Summary</h2>
  ${data.tables.categorySummary}

  <h2>Retest Sequence</h2>
  ${data.tables.retestSummary}

  <h2>Files</h2>
  <ul>
    <li><a href="all-blog-edit-retest-plan.csv">all-blog-edit-retest-plan.csv</a></li>
    <li><a href="first-20-command-sheet.csv">first-20-command-sheet.csv</a></li>
    <li><a href="batch-summary.csv">batch-summary.csv</a></li>
    <li><a href="category-edit-summary.csv">category-edit-summary.csv</a></li>
    <li><a href="retest-sequence.csv">retest-sequence.csv</a></li>
    <li><a href="boss-edit-retest-talking-points.md">boss-edit-retest-talking-points.md</a></li>
  </ul>
</main>
</body>
</html>`;
}

function renderMarkdown(data) {
  return `# iBOLT All-Blog Edit and Retest Planner

## Bottom Line

The 142-page audit is now ordered into edit and retest batches.

- Pages planned: ${data.summary.pages}
- B01 Sprint 1 pages: ${data.summary.b01Pages}
- Mention-first pages: ${data.summary.mentionFirstPages}
- Citation-ready pages: ${data.summary.citationReadyPages}
- Duplicate/canonical pairs: ${data.summary.duplicatePairs}

## First 10 Pages

${data.planRows.slice(0, 10).map((row) => `${row.edit_order}. ${row.title}: ${row.batch}, ${row.category}, retest ${row.retest_wave}.`).join("\n")}
`;
}

function bossTalkingPoints(data) {
  return `# Boss Talking Points: All-Blog Edit and Retest Plan

The AI visibility analysis now covers all 142 live blog/page rows and turns them into a work queue.

Recommended sequence:

1. B01: Edit the Sprint 1 pages first because they combine high commercial intent with AI competitor losses.
2. Retest W1 with the 27-request packet.
3. B02: Fix competitor mention recovery pages before citation outreach.
4. B03: Resolve canonical duplicates so AI systems do not split entity signals across multiple similar pages.
5. B04: Start citation/source cleanup only after pages are source-ready and iBOLT is included in answers.

The top page categories by priority are ${data.categorySummary.slice(0, 5).map((row) => row.category).join(", ")}.

The first edit pages are ${data.planRows.slice(0, 5).map((row) => row.title).join("; ")}.
`;
}

async function main() {
  const workRows = await readCsv("page-execution-control-board/page-work-order-queue.csv");
  const conversionRows = await readCsv("blog-conversion-opportunity-map/page-conversion-priority.csv");
  const bridgeRows = await readCsv("visibility-citation-bridge/visibility-to-citation-page-queue.csv");
  const languageRows = await readCsv("mention-language-command-deck/lost-language-countercopy.csv");
  const duplicateRows = await readCsv("content-refresh-roadmap/duplicate-consolidation-plan.csv");
  const retestRows = await readCsv("priority-retest-packet/retest-batches.csv");

  const duplicateUrls = new Map();
  for (const row of duplicateRows) {
    for (const key of ["canonical_url", "duplicate_url"]) {
      if (!row[key]) continue;
      duplicateUrls.set(normalizeUrl(row[key]), row);
    }
  }
  const languageByCategory = new Map(languageRows.map((row) => [row.category, row]));

  const planRows = workRows.map((work) => {
    const conversion = findByUrl(conversionRows, work.url);
    const bridge = findByUrl(bridgeRows, work.url);
    const duplicate = duplicateUrls.get(normalizeUrl(work.url));
    const language = languageByCategory.get(work.category) || {};
    const batch = batchFor({ work, conversion, bridge, duplicate });
    const conversionScore = toNumber(conversion.priority_score);
    const executionScore = toNumber(work.execution_score);
    const bridgeScore = toNumber(bridge.bridge_score);
    const composite = executionScore + conversionScore * 4 + bridgeScore + toNumber(work.competitor_only_answers) * 12 + toNumber(work.zero_mention_queries) * 20;
    const retestWave = retestWaveFor(batch, work, bridge);
    const issueSet = [
      ...splitList(work.message_themes),
      ...splitList(conversion.missing_fixes),
      duplicate ? "canonical duplicate risk" : "",
      bridge.stage || "",
    ].filter(Boolean).slice(0, 8).join("; ");
    const firstHour = [
      duplicate ? "Confirm survivor URL and merge duplicate signals." : "",
      work.first_edit_instruction || conversion.checkout_action || bridge.app_work_action || "Add answer-first copy and product proof.",
      language.copy_instruction || "",
    ].filter(Boolean).join(" ");
    return {
      edit_order: 0,
      composite_score: composite,
      execution_score: executionScore,
      conversion_score: conversionScore,
      bridge_score: bridgeScore,
      batch,
      batch_objective: batchObjective(batch),
      retest_wave: retestWave,
      title: work.title,
      url: work.url,
      category: work.category,
      conversion_tier: work.conversion_tier || conversion.conversion_tier,
      stage: bridge.stage || work.ai_visibility_stage,
      lifecycle_bucket: work.lifecycle_bucket,
      zero_mention_queries: toNumber(work.zero_mention_queries),
      competitor_only_answers: toNumber(work.competitor_only_answers),
      clean_mentions: toNumber(work.clean_mentions),
      co_mentions: toNumber(work.co_mentions),
      provider_requests_ready: toNumber(work.provider_requests_ready),
      product_links: toNumber(work.product_links),
      product_entity_targets: toNumber(work.product_entity_targets),
      competitors: work.competitors || conversion.competitors,
      products_to_feature: work.products_to_feature || conversion.products_to_feature,
      issue_set: issueSet,
      first_hour_action: firstHour,
      checkout_action: conversion.checkout_action || work.checkout_action,
      cta_guidance: work.cta_button_guidance || conversion.cta_button_guidance,
      citation_action: bridge.next_citation_action || work.source_or_citation_action || conversion.source_action,
      language_instruction: language.copy_instruction,
      retest_prompts: work.retest_prompts || conversion.retest_prompts || bridge.retest_prompts,
      expected_visibility_metric: work.expected_visibility_metric || bridge.retest_metric,
      expected_checkout_metric: work.expected_checkout_metric || "Track product-card clicks and assisted checkout.",
    };
  }).sort((a, b) => {
    const batchOrder = a.batch.localeCompare(b.batch);
    if (batchOrder !== 0) return batchOrder;
    return b.composite_score - a.composite_score;
  }).map((row, index) => ({ ...row, edit_order: index + 1 }));

  const batchSummary = [...groupBy(planRows, (row) => row.batch).entries()].map(([batch, rows]) => ({
    batch,
    pages: rows.length,
    objective: batchObjective(batch),
    top_categories: countBy(rows, (row) => row.category).slice(0, 6).map(([category, count]) => `${category} ${count}`).join("; "),
    competitor_only_answers: rows.reduce((sum, row) => sum + row.competitor_only_answers, 0),
    zero_mention_queries: rows.reduce((sum, row) => sum + row.zero_mention_queries, 0),
    provider_requests_ready: rows.reduce((sum, row) => sum + row.provider_requests_ready, 0),
    top_pages: rows.slice(0, 5).map((row) => row.title).join("; "),
    retest_wave: countBy(rows, (row) => row.retest_wave).slice(0, 3).map(([wave, count]) => `${wave} ${count}`).join("; "),
  }));

  const categorySummary = [...groupBy(planRows, (row) => row.category).entries()].map(([category, rows]) => ({
    category,
    pages: rows.length,
    b01_pages: rows.filter((row) => row.batch.startsWith("B01")).length,
    mention_first_pages: rows.filter((row) => /mention/i.test(row.stage) || row.batch.startsWith("B02")).length,
    citation_ready_pages: rows.filter((row) => row.batch.startsWith("B04")).length,
    competitor_only_answers: rows.reduce((sum, row) => sum + row.competitor_only_answers, 0),
    zero_mention_queries: rows.reduce((sum, row) => sum + row.zero_mention_queries, 0),
    provider_requests_ready: rows.reduce((sum, row) => sum + row.provider_requests_ready, 0),
    top_competitors: countList(rows, "competitors", 8),
    top_pages: rows.slice(0, 5).map((row) => row.title).join("; "),
  })).sort((a, b) => b.competitor_only_answers - a.competitor_only_answers || b.provider_requests_ready - a.provider_requests_ready);

  const retestSummary = retestRows.map((row) => {
    const matchingPages = planRows.filter((plan) => plan.retest_wave.startsWith(row.batch_id)).length;
    return {
      batch_id: row.batch_id,
      wave: row.wave,
      requests: toNumber(row.requests),
      prompts: toNumber(row.unique_prompts),
      planned_pages: matchingPages || toNumber(row.pages),
      prerequisite: row.prerequisite,
      success_metric: row.success_metric,
    };
  });

  const summary = {
    pages: planRows.length,
    b01Pages: planRows.filter((row) => row.batch.startsWith("B01")).length,
    mentionFirstPages: planRows.filter((row) => row.batch.startsWith("B01") || row.batch.startsWith("B02")).length,
    citationReadyPages: planRows.filter((row) => row.batch.startsWith("B04")).length,
    duplicatePairs: duplicateRows.length,
  };

  const tables = {
    firstTwenty: renderTable(
      ["Order", "Batch", "Page", "Category", "Score", "AI loss", "First action", "Retest"],
      planRows.slice(0, 20).map((row) => [
        row.edit_order,
        row.batch,
        row.title,
        row.category,
        row.composite_score,
        `${row.zero_mention_queries} zero / ${row.competitor_only_answers} competitor-only`,
        short(row.first_hour_action, 170),
        row.retest_wave,
      ]),
    ),
    batchSummary: renderTable(
      ["Batch", "Pages", "Objective", "Top categories", "Competitor-only", "Zero mentions", "Provider requests", "Retest"],
      batchSummary.map((row) => [
        row.batch,
        row.pages,
        row.objective,
        row.top_categories,
        row.competitor_only_answers,
        row.zero_mention_queries,
        row.provider_requests_ready,
        row.retest_wave,
      ]),
    ),
    categorySummary: renderTable(
      ["Category", "Pages", "B01", "Mention-first", "Citation-ready", "Competitor-only", "Zero mentions", "Requests", "Top competitors"],
      categorySummary.map((row) => [
        row.category,
        row.pages,
        row.b01_pages,
        row.mention_first_pages,
        row.citation_ready_pages,
        row.competitor_only_answers,
        row.zero_mention_queries,
        row.provider_requests_ready,
        short(row.top_competitors, 120),
      ]),
    ),
    retestSummary: renderTable(
      ["Batch", "Wave", "Requests", "Prompts", "Planned pages", "Prerequisite", "Success metric"],
      retestSummary.map((row) => [
        row.batch_id,
        row.wave,
        row.requests,
        row.prompts,
        row.planned_pages,
        row.prerequisite,
        row.success_metric,
      ]),
    ),
  };

  const svgs = {
    batchCounts: barSvg({
      title: "Planned pages by batch",
      rows: batchSummary.map((row) => ({ label: row.batch.replace(/^B\d+\s+/, ""), value: row.pages, color: "#2563eb" })),
      color: "#2563eb",
    }),
    categoryPriority: barSvg({
      title: "Competitor-only answers by category",
      rows: categorySummary.map((row) => ({ label: row.category, value: row.competitor_only_answers, color: "#ef4444" })),
      color: "#ef4444",
    }),
  };

  const data = { summary, planRows, batchSummary, categorySummary, retestSummary, tables, svgs };

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml(data));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown(data));
  await writeFile(path.join(outDir, "boss-edit-retest-talking-points.md"), bossTalkingPoints(data));
  await writeFile(path.join(outDir, "all-blog-edit-retest-plan.csv"), csv([
    ["edit_order", "composite_score", "batch", "batch_objective", "retest_wave", "title", "url", "category", "conversion_tier", "stage", "lifecycle_bucket", "zero_mention_queries", "competitor_only_answers", "clean_mentions", "co_mentions", "provider_requests_ready", "product_links", "product_entity_targets", "competitors", "products_to_feature", "issue_set", "first_hour_action", "checkout_action", "cta_guidance", "citation_action", "language_instruction", "retest_prompts", "expected_visibility_metric", "expected_checkout_metric"],
    ...planRows.map((row) => [
      row.edit_order,
      row.composite_score,
      row.batch,
      row.batch_objective,
      row.retest_wave,
      row.title,
      row.url,
      row.category,
      row.conversion_tier,
      row.stage,
      row.lifecycle_bucket,
      row.zero_mention_queries,
      row.competitor_only_answers,
      row.clean_mentions,
      row.co_mentions,
      row.provider_requests_ready,
      row.product_links,
      row.product_entity_targets,
      row.competitors,
      row.products_to_feature,
      row.issue_set,
      row.first_hour_action,
      row.checkout_action,
      row.cta_guidance,
      row.citation_action,
      row.language_instruction,
      row.retest_prompts,
      row.expected_visibility_metric,
      row.expected_checkout_metric,
    ]),
  ]));
  await writeFile(path.join(outDir, "first-20-command-sheet.csv"), csv([
    ["edit_order", "batch", "title", "url", "category", "first_hour_action", "products_to_feature", "competitors", "cta_guidance", "citation_action", "retest_wave", "retest_prompts"],
    ...planRows.slice(0, 20).map((row) => [
      row.edit_order,
      row.batch,
      row.title,
      row.url,
      row.category,
      row.first_hour_action,
      row.products_to_feature,
      row.competitors,
      row.cta_guidance,
      row.citation_action,
      row.retest_wave,
      row.retest_prompts,
    ]),
  ]));
  await writeFile(path.join(outDir, "batch-summary.csv"), csv([
    ["batch", "pages", "objective", "top_categories", "competitor_only_answers", "zero_mention_queries", "provider_requests_ready", "top_pages", "retest_wave"],
    ...batchSummary.map((row) => [
      row.batch,
      row.pages,
      row.objective,
      row.top_categories,
      row.competitor_only_answers,
      row.zero_mention_queries,
      row.provider_requests_ready,
      row.top_pages,
      row.retest_wave,
    ]),
  ]));
  await writeFile(path.join(outDir, "category-edit-summary.csv"), csv([
    ["category", "pages", "b01_pages", "mention_first_pages", "citation_ready_pages", "competitor_only_answers", "zero_mention_queries", "provider_requests_ready", "top_competitors", "top_pages"],
    ...categorySummary.map((row) => [
      row.category,
      row.pages,
      row.b01_pages,
      row.mention_first_pages,
      row.citation_ready_pages,
      row.competitor_only_answers,
      row.zero_mention_queries,
      row.provider_requests_ready,
      row.top_competitors,
      row.top_pages,
    ]),
  ]));
  await writeFile(path.join(outDir, "retest-sequence.csv"), csv([
    ["batch_id", "wave", "requests", "prompts", "planned_pages", "prerequisite", "success_metric"],
    ...retestSummary.map((row) => [
      row.batch_id,
      row.wave,
      row.requests,
      row.prompts,
      row.planned_pages,
      row.prerequisite,
      row.success_metric,
    ]),
  ]));

  console.log(`Wrote ${path.join(outDir, "REPORT.html")}`);
  console.log(`Pages planned: ${summary.pages}; B01 pages: ${summary.b01Pages}; mention-first: ${summary.mentionFirstPages}; citation-ready: ${summary.citationReadyPages}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
