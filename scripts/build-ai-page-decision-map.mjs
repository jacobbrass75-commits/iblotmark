#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "page-decision-map");

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
  return String(value ?? "")
    .trim()
    .replace(/^http:\/\//i, "https://")
    .replace(/\/+$/g, "")
    .toLowerCase();
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function short(value, length = 150) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function indexByUrl(rows, urlKeys) {
  const map = new Map();
  for (const row of rows) {
    for (const key of urlKeys) {
      for (const url of splitList(row[key]).concat([row[key]])) {
        const normalized = normalizeUrl(url);
        if (!normalized || !/^https?:\/\//.test(normalized)) continue;
        if (!map.has(normalized)) map.set(normalized, []);
        map.get(normalized).push(row);
      }
    }
  }
  return map;
}

function singleByUrl(rows, key = "url") {
  const map = new Map();
  for (const row of rows) {
    const normalized = normalizeUrl(row[key]);
    if (normalized && !map.has(normalized)) map.set(normalized, row);
  }
  return map;
}

function decisionFor({ action, lifecycle, canonical, conversion }) {
  const bucket = lifecycle?.lifecycle_bucket || "";
  const citationLane = action?.citation_lane || "";
  const topFix = action?.top_fix || lifecycle?.recommended_next_action || "";
  const ctaRisk = conversion?.cta_risk || "";
  if (canonical || /canonical/i.test(bucket) || /canonical/i.test(citationLane)) {
    return {
      decision: "Consolidate first",
      owner: "Jacob/app, then human review",
      firstMove: canonical
        ? `Confirm survivor: ${canonical.recommended_survivor_title || "survivor URL"}. Preserve prompts: ${short(canonical.prompts_to_preserve, 180)}`
        : "Confirm survivor URL, merge useful sections, preserve benchmark prompts, then update canonical/internal links.",
      doNotDo: "Do not redirect, unpublish, or rewrite duplicate pages until the survivor page contains the useful answer blocks, products, FAQs, and benchmark prompts.",
    };
  }
  if (/protect/i.test(bucket)) {
    return {
      decision: "Protect and amplify",
      owner: "Jacob/app plus SEO contractor",
      firstMove: "Keep the page stable, add citation-ready proof, preserve exact product names, and use contractor support for external mentions after source cleanup.",
      doNotDo: "Do not over-edit a page that already has clean mention value. Avoid changing the query target unless analytics proves a better survivor.",
    };
  }
  if (/citation|source cleanup|schema/i.test(citationLane) || /citation|schema/i.test(bucket)) {
    return {
      decision: "Source cleanup first",
      owner: "Jacob/app",
      firstMove: action?.schema_command || "Add or verify Article/BlogPosting and FAQPage schema, product links, image alt text, and answer-first copy.",
      doNotDo: "Do not hand this to the SEO contractor for citations until quick answer, schema, product modules, and internal links are live.",
    };
  }
  if (/legacy rewrite/i.test(bucket)) {
    return {
      decision: "Rewrite or refresh",
      owner: "Jacob/app",
      firstMove: action?.quick_answer_command || "Rewrite the top of the page around a direct buyer answer, then rebuild product modules and FAQs.",
      doNotDo: "Do not generate a new overlapping blog until the existing page is refreshed or intentionally consolidated.",
    };
  }
  if (/too many cart|cart CTA|cta/i.test(topFix) || /yes/i.test(ctaRisk)) {
    return {
      decision: "CTA cleanup",
      owner: "Jacob/app",
      firstMove: conversion?.cta_action || action?.cta_command || "Reduce repeated cart CTAs and use one clean product module per decision section.",
      doNotDo: "Do not add repeated Add to Cart buttons after every product link. Prefer View Product in the article body.",
    };
  }
  return {
    decision: "Edit first",
    owner: action?.owner || "Jacob/app",
    firstMove: action?.immediate_action || action?.quick_answer_command || lifecycle?.recommended_next_action || "Add answer-first copy, product modules, comparison language, FAQ/schema, and retest prompts.",
    doNotDo: "Do not chase citations before the page has a clear answer, exact products, schema, and mapped retest prompts.",
  };
}

function explainWhy({ action, lifecycle, canonical, conversion, language }) {
  const parts = [];
  if (lifecycle?.lifecycle_bucket) parts.push(`lifecycle: ${lifecycle.lifecycle_bucket}`);
  if (action?.visibility_stage) parts.push(`visibility: ${action.visibility_stage}`);
  if (action?.competitor_only_answers) parts.push(`${action.competitor_only_answers} competitor-only answers`);
  if (action?.zero_mention_queries) parts.push(`${action.zero_mention_queries} zero-mention queries`);
  if (canonical) parts.push(`canonical pressure: ${canonical.consolidation_type}`);
  if (conversion?.cta_risk === "yes") parts.push("CTA risk");
  if (language?.primary_competitor) parts.push(`language counter: ${language.primary_competitor}`);
  return parts.join("; ");
}

function barSvg({ title, rows, width = 900, rowHeight = 34, color = "#0f766e" }) {
  const chartRows = rows.slice(0, 12);
  const height = 76 + chartRows.length * rowHeight;
  const max = Math.max(1, ...chartRows.map((row) => row.value));
  const body = chartRows.map((row, index) => {
    const y = 58 + index * rowHeight;
    const barWidth = Math.round((row.value / max) * (width - 350));
    return `<g>
      <text x="22" y="${y + 17}" font-size="13" font-weight="800" fill="#111827">${escapeHtml(short(row.label, 38))}</text>
      <rect x="292" y="${y}" width="${width - 350}" height="21" rx="10" fill="#e5e7eb"/>
      <rect x="292" y="${y}" width="${barWidth}" height="21" rx="10" fill="${row.color || color}"/>
      <text x="${width - 26}" y="${y + 16}" font-size="13" font-weight="900" text-anchor="end" fill="#111827">${escapeHtml(row.value)}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#ffffff"/>
    <text x="22" y="34" font-size="20" font-weight="900" fill="#111827">${escapeHtml(title)}</text>
    ${body}
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
  <title>iBOLT Blog Page Decision Map</title>
  <style>
    body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1240px;margin:0 auto;padding:34px 24px 66px}
    h1{font-size:38px;line-height:1.1;margin:0 0 8px}
    h2{font-size:24px;margin:36px 0 12px}
    p,li{line-height:1.55;color:#334155;font-size:15px}
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
    a{color:#0f766e;overflow-wrap:anywhere}
    @media(max-width:980px){.cards,.grid{grid-template-columns:1fr}h1{font-size:31px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT Blog Page Decision Map</h1>
  <p>This collapses the all-blog action sheet, lifecycle map, canonical queue, conversion bridge, and answer-language evidence into one working decision map. Use it to decide what to edit, consolidate, protect, or hold before retesting.</p>

  <div class="note">
    <strong>Operating rule:</strong> pages with canonical pressure come first because editing the wrong duplicate can split AI signals. Pages without canonical pressure can move into source cleanup, CTA cleanup, rewrite, or protect/amplify lanes.
  </div>

  <section class="cards">
    ${card("Pages mapped", data.summary.pages, "Unique URLs joined from the all-blog queue.")}
    ${card("Consolidate first", data.summary.consolidateFirst, "Survivor decision before edits.")}
    ${card("Source cleanup", data.summary.sourceCleanup, "Schema, citation, product proof, FAQ, image alt text.")}
    ${card("CTA risk flagged", data.summary.ctaRiskPages, "Repeated cart CTA risk across lanes.")}
    ${card("Protect/amplify", data.summary.protectAmplify, "Keep stable and add proof/citations.")}
  </section>

  <div class="grid">
    <div class="chart">${data.decisionSvg}</div>
    <div class="chart">${data.categorySvg}</div>
  </div>

  <h2>First 30 Decisions</h2>
  ${renderTable(["Priority", "Decision", "Page", "URL", "Category", "Why", "First move", "Do not do", "Retest prompts"], data.firstRows.map((row) => [row.priority, row.decision, row.title, row.url, row.category, row.why, row.first_move, row.do_not_do, row.retest_prompts]))}

  <h2>Consolidate Before Editing</h2>
  ${renderTable(["Priority", "Survivor", "Merge From", "Prompts To Preserve", "Review Flag"], data.consolidationRows.map((row) => [row.priority, row.recommended_survivor_title, row.merge_from_titles, row.prompts_to_preserve, row.survivor_review_flag]))}

  <h2>Decision Summary</h2>
  ${renderTable(["Decision", "Pages", "Avg Priority", "Top Categories"], data.bucketRows.map((row) => [row.decision, row.pages, row.avg_priority, row.top_categories]))}
</main>
</body>
</html>`;
}

function renderMarkdown(data) {
  return `# iBOLT Blog Page Decision Map

## Summary

- Pages mapped: ${data.summary.pages}
- Consolidate first: ${data.summary.consolidateFirst}
- Source cleanup: ${data.summary.sourceCleanup}
- CTA risk flagged: ${data.summary.ctaRiskPages}
- Protect and amplify: ${data.summary.protectAmplify}

## First 10 Decisions

${data.firstRows.slice(0, 10).map((row, index) => `${index + 1}. ${row.decision}: ${row.title}. First move: ${row.first_move}`).join("\n")}

## Files

- page-decision-map.csv
- first-30-page-decisions.csv
- decision-bucket-summary.csv
- consolidate-before-editing.csv
- decision-by-category.csv
`;
}

function summarizeBuckets(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.decision)) map.set(row.decision, []);
    map.get(row.decision).push(row);
  }
  return [...map.entries()]
    .map(([decision, items]) => {
      const categoryCounts = new Map();
      for (const item of items) categoryCounts.set(item.category, (categoryCounts.get(item.category) || 0) + 1);
      const topCategories = [...categoryCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 5)
        .map(([category, count]) => `${category} ${count}`)
        .join("; ");
      return {
        decision,
        pages: items.length,
        avg_priority: Math.round(items.reduce((sum, item) => sum + toNumber(item.priority), 0) / Math.max(1, items.length)),
        top_categories: topCategories,
      };
    })
    .sort((a, b) => b.pages - a.pages || a.decision.localeCompare(b.decision));
}

function summarizeCategories(rows) {
  const map = new Map();
  for (const row of rows) {
    const category = row.category || "unknown";
    if (!map.has(category)) map.set(category, []);
    map.get(category).push(row);
  }
  return [...map.entries()]
    .map(([category, items]) => ({
      category,
      pages: items.length,
      top_decision: summarizeBuckets(items)[0]?.decision || "",
      avg_priority: Math.round(items.reduce((sum, item) => sum + toNumber(item.priority), 0) / Math.max(1, items.length)),
      top_competitors: [...new Set(items.flatMap((item) => splitList(item.competitors)).filter(Boolean))].slice(0, 8).join("; "),
    }))
    .sort((a, b) => b.pages - a.pages || b.avg_priority - a.avg_priority);
}

async function main() {
  const actions = await readCsv("all-blog-action-control-sheet/all-blog-action-control-sheet.csv");
  const lifecycleRows = await readCsv("blog-lifecycle-map/page-lifecycle-ledger.csv");
  const canonicalRows = await readCsv("canonical-consolidation-plan/canonical-consolidation-queue.csv");
  const conversionRows = await readCsv("product-conversion-visibility-bridge/checkout-risk-queue.csv");
  const languageRows = await readCsv("answer-language-evidence/page-copy-citation-commands.csv");

  const lifecycleByUrl = singleByUrl(lifecycleRows);
  const conversionByUrl = singleByUrl(conversionRows);
  const languageByUrl = singleByUrl(languageRows);
  const canonicalByUrl = indexByUrl(canonicalRows, ["recommended_survivor_url", "merge_from_urls", "benchmark_pressure_url"]);
  const byUrl = new Map();

  for (const action of actions) {
    const normalized = normalizeUrl(action.url);
    if (!normalized) continue;
    byUrl.set(normalized, { action });
  }
  for (const lifecycle of lifecycleRows) {
    const normalized = normalizeUrl(lifecycle.url);
    if (!normalized) continue;
    byUrl.set(normalized, { ...(byUrl.get(normalized) || {}), lifecycle });
  }

  const rows = [...byUrl.entries()].map(([url, joined]) => {
    const action = joined.action || {};
    const lifecycle = joined.lifecycle || lifecycleByUrl.get(url) || {};
    const canonical = canonicalByUrl.get(url)?.[0] || null;
    const conversion = conversionByUrl.get(url) || {};
    const language = languageByUrl.get(url) || {};
    const decision = decisionFor({ action, lifecycle, canonical, conversion, language });
    const priority = Math.max(
      toNumber(action.priority),
      toNumber(lifecycle.priority),
      toNumber(canonical?.priority),
      toNumber(conversion.bridge_score),
      toNumber(language.rank),
    );
    return {
      priority,
      decision: decision.decision,
      owner: decision.owner,
      title: action.title || lifecycle.title || conversion.page || language.page || canonical?.recommended_survivor_title || "",
      url,
      category: action.category || lifecycle.category || conversion.category || language.category || canonical?.category || "",
      lifecycle_bucket: lifecycle.lifecycle_bucket || "",
      visibility_stage: action.visibility_stage || "",
      citation_lane: action.citation_lane || "",
      top_fix: action.top_fix || language.top_fix || "",
      primary_competitor: action.primary_competitor || language.primary_competitor || "",
      competitors: action.competitors || lifecycle.competitors || conversion.competitors || "",
      products_to_feature: action.products_to_feature || conversion.products_to_feature || "",
      retest_wave: action.retest_wave || "",
      retest_prompts: action.retest_prompts || lifecycle.linked_prompts || conversion.retest_prompts || "",
      why: explainWhy({ action, lifecycle, canonical, conversion, language }),
      first_move: decision.firstMove,
      do_not_do: decision.doNotDo,
      release_gate: action.release_gate || canonical?.survivor_review_flag || "Retest mapped prompts after changes are live.",
      success_metric: action.success_metric || "Move from competitor-only answer to iBOLT mention, then top-3 recommendation and citation.",
    };
  }).sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title));

  const bucketRows = summarizeBuckets(rows);
  const categoryRows = summarizeCategories(rows);
  const consolidationRows = canonicalRows.sort((a, b) => toNumber(b.priority) - toNumber(a.priority)).slice(0, 40);
  const firstRows = rows.slice(0, 30);
  const summary = {
    generated_at: new Date().toISOString(),
    benchmark_dir: benchmarkDir,
    pages: rows.length,
    consolidateFirst: rows.filter((row) => row.decision === "Consolidate first").length,
    sourceCleanup: rows.filter((row) => row.decision === "Source cleanup first").length,
    ctaCleanup: rows.filter((row) => row.decision === "CTA cleanup").length,
    protectAmplify: rows.filter((row) => row.decision === "Protect and amplify").length,
    rewriteRefresh: rows.filter((row) => row.decision === "Rewrite or refresh").length,
    editFirst: rows.filter((row) => row.decision === "Edit first").length,
    ctaRiskPages: rows.filter((row) => /CTA risk/i.test(row.why) || /cart CTA|add to cart/i.test(`${row.first_move} ${row.do_not_do}`)).length,
  };

  const decisionSvg = barSvg({
    title: "Page Decision Mix",
    rows: bucketRows.map((row) => ({ label: row.decision, value: row.pages })),
  });
  const categorySvg = barSvg({
    title: "Pages By Category",
    rows: categoryRows.map((row) => ({ label: row.category, value: row.pages })),
    color: "#2563eb",
  });

  const data = { summary, rows, firstRows, bucketRows, categoryRows, consolidationRows, decisionSvg, categorySvg };
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml(data));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown(data));
  await writeFile(path.join(outDir, "page-decision-map-data.json"), JSON.stringify(data, null, 2));
  await writeFile(path.join(outDir, "page-decision-map.csv"), csv([
    ["priority", "decision", "owner", "title", "url", "category", "lifecycle_bucket", "visibility_stage", "citation_lane", "top_fix", "primary_competitor", "competitors", "products_to_feature", "retest_wave", "retest_prompts", "why", "first_move", "do_not_do", "release_gate", "success_metric"],
    ...rows.map((row) => [row.priority, row.decision, row.owner, row.title, row.url, row.category, row.lifecycle_bucket, row.visibility_stage, row.citation_lane, row.top_fix, row.primary_competitor, row.competitors, row.products_to_feature, row.retest_wave, row.retest_prompts, row.why, row.first_move, row.do_not_do, row.release_gate, row.success_metric]),
  ]));
  await writeFile(path.join(outDir, "first-30-page-decisions.csv"), csv([
    ["priority", "decision", "title", "url", "category", "why", "first_move", "do_not_do", "retest_prompts"],
    ...firstRows.map((row) => [row.priority, row.decision, row.title, row.url, row.category, row.why, row.first_move, row.do_not_do, row.retest_prompts]),
  ]));
  await writeFile(path.join(outDir, "decision-bucket-summary.csv"), csv([
    ["decision", "pages", "avg_priority", "top_categories"],
    ...bucketRows.map((row) => [row.decision, row.pages, row.avg_priority, row.top_categories]),
  ]));
  await writeFile(path.join(outDir, "decision-by-category.csv"), csv([
    ["category", "pages", "top_decision", "avg_priority", "top_competitors"],
    ...categoryRows.map((row) => [row.category, row.pages, row.top_decision, row.avg_priority, row.top_competitors]),
  ]));
  await writeFile(path.join(outDir, "consolidate-before-editing.csv"), csv([
    ["priority", "consolidation_type", "recommended_survivor_title", "recommended_survivor_url", "merge_from_titles", "merge_from_urls", "prompts_to_preserve", "competitors_to_cover", "survivor_review_flag", "redirect_action", "retest_action"],
    ...consolidationRows.map((row) => [row.priority, row.consolidation_type, row.recommended_survivor_title, row.recommended_survivor_url, row.merge_from_titles, row.merge_from_urls, row.prompts_to_preserve, row.competitors_to_cover, row.survivor_review_flag, row.redirect_action, row.retest_action]),
  ]));
  await writeFile(path.join(outDir, "decision-mix.svg"), decisionSvg);
  await writeFile(path.join(outDir, "decision-by-category.svg"), categorySvg);

  console.log(`Wrote ${outDir}`);
  console.log(`Pages mapped: ${summary.pages}`);
  console.log(`Consolidate first: ${summary.consolidateFirst}`);
  console.log(`Source cleanup: ${summary.sourceCleanup}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
