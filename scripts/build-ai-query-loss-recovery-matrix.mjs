#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "query-loss-recovery-matrix");

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
    .flatMap((part) => part.split("/"))
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/^\+\d+ more$/i.test(item));
}

function splitSemicolonList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/^\+\d+ more$/i.test(item));
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

function normalizeBrand(value) {
  const text = String(value ?? "").trim();
  if (/^ram$/i.test(text) || /^ram mounts?$/i.test(text)) return "RAM Mounts";
  if (/^mount[\s-]?it!?$/i.test(text)) return "Mount-It";
  if (/^cta$/i.test(text)) return "CTA Digital";
  return text;
}

function short(value, length = 120) {
  const text = String(value ?? "");
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function lookupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const value = row[key];
    if (value && !map.has(value)) map.set(value, row);
  }
  return map;
}

function lookupManyBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const value = row[key];
    if (!value) continue;
    if (!map.has(value)) map.set(value, []);
    map.get(value).push(row);
  }
  return map;
}

function barSvg({ title, rows, width = 920, rowHeight = 36, color = "#0f766e", maxValue }) {
  const chartRows = rows.filter((row) => Number.isFinite(row.value)).slice(0, 12);
  const height = 76 + chartRows.length * rowHeight;
  const max = maxValue || Math.max(1, ...chartRows.map((row) => row.value));
  const bars = chartRows.map((row, index) => {
    const y = 58 + index * rowHeight;
    const barWidth = Math.round((row.value / max) * (width - 360));
    return `<g>
      <text x="22" y="${y + 18}" font-size="13" font-weight="800" fill="#111827">${escapeHtml(short(row.label, 42))}</text>
      <rect x="300" y="${y}" width="${width - 360}" height="22" rx="11" fill="#e5e7eb"/>
      <rect x="300" y="${y}" width="${barWidth}" height="22" rx="11" fill="${row.color || color}"/>
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

function severityFor(row) {
  const missedCount = splitList(row.missed_providers).length;
  const competitorCount = splitList(row.competitors).length;
  const zeroScore = toNumber(row.avg_score) <= 10;
  return toNumber(row.opportunity) + missedCount * 30 + competitorCount * 4 + (zeroScore ? 35 : 0);
}

function nextAction({ query, page, message, retestRows, blindspotRows }) {
  if (/canonical/i.test(page.lifecycle_bucket || "") || /canonical/i.test(page.execution_lane || "")) {
    return "Pick the survivor URL, then merge the query-answer block, comparison block, product module, and FAQ/schema before retest.";
  }
  const issues = splitList(query.structural_issues);
  if (issues.some((issue) => /quick answer/i.test(issue))) {
    return "Add a 40 to 70 word answer block near the top that names iBOLT and exact product choices.";
  }
  if (issues.some((issue) => /comparison/i.test(issue))) {
    return "Add a fair comparison table against the listed competitors and make iBOLT the specialist for the exact workflow.";
  }
  if (issues.some((issue) => /faq|schema/i.test(issue)) || /schema/i.test(message.schema_fixes || "")) {
    return "Add visible FAQ/product/entity fields and matching schema before citation probes.";
  }
  if (retestRows.length || blindspotRows.length) {
    return "Retest this query after page cleanup and compare mention, rank, competitor-only, and citation fields.";
  }
  return "Monitor and keep the page in the expanded benchmark.";
}

function renderHtml(data) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT Query Loss Recovery Matrix</title>
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
  <h1>iBOLT Query Loss Recovery Matrix</h1>
  <p>This is the tactical bridge between the AI benchmark and page edits. It maps each losing query to the page, competitor set, missing page elements, retest wave, and next action.</p>

  <div class="note">
    <strong>How to use it:</strong> start with the highest severity rows, edit the mapped survivor page, then run the matching retest wave. The goal is to move rows from competitor-only to iBOLT-mentioned, then top-3, then cited.
  </div>

  <section class="cards">
    ${card("Queries mapped", data.summary.queryCount, "Baseline query consensus rows with page mapping.")}
    ${card("Provider loss rows", data.summary.providerLossRows, "Provider-specific missed or weak answer rows.")}
    ${card("Pages affected", data.summary.pageCount, "Unique mapped pages needing recovery work.")}
    ${card("Competitors", data.summary.competitorCount, "Unique competitor brands in losing answer sets.")}
    ${card("Retest rows", data.summary.retestRows, "Priority provider requests available to validate edits.")}
  </section>

  <section class="grid">
    <div class="chart">${data.svgs.topQueries}</div>
    <div class="chart">${data.svgs.topCompetitors}</div>
  </section>

  <h2>Highest Priority Query Losses</h2>
  <table>${data.tables.queryMatrix}</table>

  <h2>Page Recovery Queue</h2>
  <section class="grid">
    <div class="chart">${data.svgs.topPages}</div>
    <div>${data.tables.pageSummary}</div>
  </section>

  <h2>Competitor Query Map</h2>
  <table>${data.tables.competitors}</table>

  <h2>Retest Wave Coverage</h2>
  <section class="grid">
    <div class="chart">${data.svgs.retestWaves}</div>
    <div>${data.tables.retest}</div>
  </section>

  <h2>Files</h2>
  <ul>
    <li><a href="query-loss-recovery-matrix.csv">query-loss-recovery-matrix.csv</a></li>
    <li><a href="page-loss-summary.csv">page-loss-summary.csv</a></li>
    <li><a href="competitor-query-map.csv">competitor-query-map.csv</a></li>
    <li><a href="retest-wave-recovery-summary.csv">retest-wave-recovery-summary.csv</a></li>
  </ul>
</main>
</body>
</html>`;
}

function renderMarkdown(data) {
  return `# iBOLT Query Loss Recovery Matrix

This maps each losing AI query to the page, competitor set, missing page elements, retest wave, and next action.

## Summary

- Queries mapped: ${data.summary.queryCount}
- Provider loss rows: ${data.summary.providerLossRows}
- Pages affected: ${data.summary.pageCount}
- Competitors: ${data.summary.competitorCount}
- Priority retest rows: ${data.summary.retestRows}

## Highest Priority Queries

${data.queryRows.slice(0, 12).map((row) => `- ${row.query}: ${row.loss_stage}; competitors ${row.competitors}; page ${row.page_title}; next action: ${row.next_action}`).join("\n")}

## Top Pages

${data.pageRows.slice(0, 10).map((row) => `- ${row.title}: ${row.loss_queries} losing queries, ${row.provider_loss_rows} provider loss rows, ${row.competitors}.`).join("\n")}

## Retest

${data.retestSummary.map((row) => `- ${row.wave}: ${row.requests} requests, ${row.queries} mapped queries, ${row.pages} pages.`).join("\n")}
`;
}

async function main() {
  const consensusRows = await readCsv("provider-blindspots/query-consensus-grid.csv");
  const blindspotRows = await readCsv("provider-blindspots/provider-blindspot-workqueue.csv");
  const pageWorkRows = await readCsv("page-execution-control-board/page-work-order-queue.csv");
  const messageRows = await readCsv("page-message-gap-map/page-message-gap-actions.csv");
  const priorityRetestRows = await readCsv("priority-retest-packet/priority-retest-request-queue.csv");
  const productRows = await readCsv("product-entity-coverage-plan/product-entity-work-queue.csv");

  const pageByUrl = lookupBy(pageWorkRows, "url");
  const messageByUrl = lookupBy(messageRows, "url");
  const blindspotsByQuery = lookupManyBy(blindspotRows, "query");
  const retestsByPrompt = lookupManyBy(priorityRetestRows, "prompt");
  const productTargetsByPage = new Map();
  for (const product of productRows) {
    for (const pageUrl of splitSemicolonList(product.target_pages)) {
      if (!productTargetsByPage.has(pageUrl)) productTargetsByPage.set(pageUrl, []);
      productTargetsByPage.get(pageUrl).push(product.title);
    }
  }

  const queryRows = consensusRows.map((query) => {
    const page = pageByUrl.get(query.page_url) || {};
    const message = messageByUrl.get(query.page_url) || {};
    const blindspots = blindspotsByQuery.get(query.query) || [];
    const retests = retestsByPrompt.get(query.query) || [];
    const products = uniq([
      ...splitSemicolonList(page.products_to_feature).slice(0, 5),
      ...splitSemicolonList(message.product_module).slice(0, 5),
      ...(productTargetsByPage.get(query.page_url) || []).slice(0, 5),
    ]).slice(0, 6);
    const retestWaves = uniq(retests.map((row) => row.wave));
    const missedProviders = splitList(query.missed_providers);
    const competitors = uniq([
      ...splitList(query.competitors).map(normalizeBrand),
      ...blindspots.flatMap((row) => splitList(row.competitors).map(normalizeBrand)),
    ]);
    const owner = page.owner_sequence || retests[0]?.owner_sequence || "Jacob/app first, then SEO contractor";
    const action = nextAction({ query, page, message, retestRows: retests, blindspotRows: blindspots });
    return {
      severity: severityFor(query),
      query: query.query,
      category: query.category,
      loss_stage: query.consensus_stage,
      missed_providers: missedProviders.join("; "),
      provider_loss_rows: blindspots.length,
      competitors: competitors.join("; "),
      page_title: query.page_title,
      page_url: query.page_url,
      page_rank: page.rank || "",
      page_execution_score: page.execution_score || "",
      lifecycle_bucket: page.lifecycle_bucket || "",
      structural_issues: query.structural_issues,
      message_themes: page.message_themes || message.message_themes || "",
      proof_points: short(page.proof_points || message.proof_points || "", 220),
      products_to_feature: products.join("; "),
      retest_waves: retestWaves.join("; "),
      retest_requests: retests.length,
      owner_sequence: owner,
      success_metric: uniq(retests.map((row) => row.success_metric)).join("; ") || page.expected_visibility_metric || query.retest_action,
      next_action: action,
    };
  }).sort((a, b) => b.severity - a.severity || a.query.localeCompare(b.query));

  const pageRows = [...groupBy(queryRows, (row) => row.page_url).entries()].map(([url, rows]) => {
    const page = pageByUrl.get(url) || {};
    const competitors = uniq(rows.flatMap((row) => splitList(row.competitors).map(normalizeBrand)));
    const products = uniq(rows.flatMap((row) => splitList(row.products_to_feature)));
    const retestWaves = uniq(rows.flatMap((row) => splitList(row.retest_waves)));
    return {
      score: Math.round(rows.reduce((sum, row) => sum + toNumber(row.severity), 0)),
      title: page.title || rows[0]?.page_title || "",
      url,
      category: page.category || rows[0]?.category || "",
      loss_queries: rows.length,
      provider_loss_rows: rows.reduce((sum, row) => sum + toNumber(row.provider_loss_rows), 0),
      competitors: competitors.slice(0, 10).join("; "),
      products_to_feature: products.slice(0, 8).join("; "),
      retest_waves: retestWaves.join("; "),
      execution_lane: page.execution_lane || "",
      first_edit_instruction: page.first_edit_instruction || rows[0]?.next_action || "",
      source_or_citation_action: page.source_or_citation_action || "",
    };
  }).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

  const competitorMap = new Map();
  for (const row of queryRows) {
    for (const competitor of splitList(row.competitors).map(normalizeBrand)) {
      if (!competitorMap.has(competitor)) {
        competitorMap.set(competitor, {
          competitor,
          query_count: 0,
          provider_loss_rows: 0,
          categories: [],
          pages: [],
          queries: [],
          retest_waves: [],
        });
      }
      const item = competitorMap.get(competitor);
      item.query_count += 1;
      item.provider_loss_rows += toNumber(row.provider_loss_rows);
      item.categories.push(row.category);
      item.pages.push(row.page_title);
      item.queries.push(row.query);
      item.retest_waves.push(row.retest_waves);
    }
  }
  const competitorRows = [...competitorMap.values()].map((row) => ({
    competitor: row.competitor,
    query_count: row.query_count,
    provider_loss_rows: row.provider_loss_rows,
    categories: uniq(row.categories).join("; "),
    pages: uniq(row.pages).slice(0, 8).join("; "),
    queries: uniq(row.queries).slice(0, 12).join("; "),
    retest_waves: uniq(row.retest_waves.flatMap(splitList)).join("; "),
  })).sort((a, b) => b.provider_loss_rows - a.provider_loss_rows || b.query_count - a.query_count || a.competitor.localeCompare(b.competitor));

  const retestSummary = [...groupBy(priorityRetestRows, (row) => row.wave).entries()].map(([wave, rows]) => {
    const mappedQueries = rows.filter((row) => consensusRows.some((query) => query.query === row.prompt));
    return {
      wave,
      requests: rows.length,
      queries: uniq(rows.map((row) => row.prompt)).length,
      mapped_loss_queries: uniq(mappedQueries.map((row) => row.prompt)).length,
      pages: uniq(rows.map((row) => row.page_url)).length,
      categories: uniq(rows.map((row) => row.category)).join("; "),
      success_metric: uniq(rows.map((row) => row.success_metric)).join("; "),
    };
  }).sort((a, b) => a.wave.localeCompare(b.wave));

  const summary = {
    queryCount: queryRows.length,
    providerLossRows: blindspotRows.length,
    pageCount: pageRows.length,
    competitorCount: competitorRows.length,
    retestRows: priorityRetestRows.length,
  };

  const tables = {
    queryMatrix: renderTable(
      ["Severity", "Query", "Stage", "Missed providers", "Competitors", "Target page", "Issues", "Retest", "Next action"],
      queryRows.slice(0, 18).map((row) => [
        row.severity,
        row.query,
        row.loss_stage,
        row.missed_providers,
        row.competitors,
        row.page_title,
        row.structural_issues,
        `${row.retest_waves || "expanded"} (${row.retest_requests})`,
        row.next_action,
      ]),
    ),
    pageSummary: renderTable(
      ["Page", "Category", "Loss queries", "Provider losses", "Competitors", "Retest waves", "First edit"],
      pageRows.slice(0, 10).map((row) => [
        row.title,
        row.category,
        row.loss_queries,
        row.provider_loss_rows,
        row.competitors,
        row.retest_waves,
        row.first_edit_instruction,
      ]),
    ),
    competitors: renderTable(
      ["Competitor", "Queries", "Provider losses", "Categories", "Pages", "Queries"],
      competitorRows.slice(0, 12).map((row) => [
        row.competitor,
        row.query_count,
        row.provider_loss_rows,
        row.categories,
        row.pages,
        row.queries,
      ]),
    ),
    retest: renderTable(
      ["Wave", "Requests", "Queries", "Mapped loss queries", "Pages", "Categories", "Success metric"],
      retestSummary.map((row) => [
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
    topQueries: barSvg({
      title: "Highest severity query losses",
      rows: queryRows.slice(0, 10).map((row) => ({ label: row.query, value: row.severity, color: "#ef4444" })),
    }),
    topCompetitors: barSvg({
      title: "Competitor pressure by provider loss rows",
      rows: competitorRows.slice(0, 10).map((row) => ({ label: row.competitor, value: row.provider_loss_rows, color: "#f97316" })),
    }),
    topPages: barSvg({
      title: "Pages with most query recovery work",
      rows: pageRows.slice(0, 10).map((row) => ({ label: row.title, value: row.provider_loss_rows, color: "#2563eb" })),
    }),
    retestWaves: barSvg({
      title: "Priority retest waves",
      rows: retestSummary.map((row) => ({ label: row.wave, value: row.requests, color: "#0f766e" })),
    }),
  };

  const data = {
    summary,
    queryRows,
    pageRows,
    competitorRows,
    retestSummary,
    tables,
    svgs,
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml(data));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown(data));
  await writeFile(path.join(outDir, "query-loss-recovery-matrix.csv"), csv([
    [
      "severity",
      "query",
      "category",
      "loss_stage",
      "missed_providers",
      "provider_loss_rows",
      "competitors",
      "page_title",
      "page_url",
      "page_rank",
      "page_execution_score",
      "lifecycle_bucket",
      "structural_issues",
      "message_themes",
      "proof_points",
      "products_to_feature",
      "retest_waves",
      "retest_requests",
      "owner_sequence",
      "success_metric",
      "next_action",
    ],
    ...queryRows.map((row) => [
      row.severity,
      row.query,
      row.category,
      row.loss_stage,
      row.missed_providers,
      row.provider_loss_rows,
      row.competitors,
      row.page_title,
      row.page_url,
      row.page_rank,
      row.page_execution_score,
      row.lifecycle_bucket,
      row.structural_issues,
      row.message_themes,
      row.proof_points,
      row.products_to_feature,
      row.retest_waves,
      row.retest_requests,
      row.owner_sequence,
      row.success_metric,
      row.next_action,
    ]),
  ]));
  await writeFile(path.join(outDir, "page-loss-summary.csv"), csv([
    [
      "score",
      "title",
      "url",
      "category",
      "loss_queries",
      "provider_loss_rows",
      "competitors",
      "products_to_feature",
      "retest_waves",
      "execution_lane",
      "first_edit_instruction",
      "source_or_citation_action",
    ],
    ...pageRows.map((row) => [
      row.score,
      row.title,
      row.url,
      row.category,
      row.loss_queries,
      row.provider_loss_rows,
      row.competitors,
      row.products_to_feature,
      row.retest_waves,
      row.execution_lane,
      row.first_edit_instruction,
      row.source_or_citation_action,
    ]),
  ]));
  await writeFile(path.join(outDir, "competitor-query-map.csv"), csv([
    ["competitor", "query_count", "provider_loss_rows", "categories", "pages", "queries", "retest_waves"],
    ...competitorRows.map((row) => [
      row.competitor,
      row.query_count,
      row.provider_loss_rows,
      row.categories,
      row.pages,
      row.queries,
      row.retest_waves,
    ]),
  ]));
  await writeFile(path.join(outDir, "retest-wave-recovery-summary.csv"), csv([
    ["wave", "requests", "queries", "mapped_loss_queries", "pages", "categories", "success_metric"],
    ...retestSummary.map((row) => [
      row.wave,
      row.requests,
      row.queries,
      row.mapped_loss_queries,
      row.pages,
      row.categories,
      row.success_metric,
    ]),
  ]));

  console.log(`Wrote ${path.join(outDir, "REPORT.html")}`);
  console.log(`Mapped ${summary.queryCount} queries across ${summary.pageCount} pages and ${summary.competitorCount} competitors`);
  console.log(`Priority retest rows available: ${summary.retestRows}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
