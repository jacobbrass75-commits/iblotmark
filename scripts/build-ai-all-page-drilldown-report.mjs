#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "all-page-ai-drilldown");

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

function compact(value, limit = 180) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

function num(value) {
  const match = String(value ?? "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function increment(map, key, amount = 1) {
  const cleanKey = key || "Unspecified";
  map.set(cleanKey, (map.get(cleanKey) || 0) + amount);
}

function topEntries(map, limit = 10) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, value]) => ({ label, value }));
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeIssue(issue) {
  const text = issue.replace(/\s+\d+$/, "").trim();
  const lower = text.toLowerCase();
  if (!text || lower.startsWith("citability score") || lower.includes("detected product links")) return "";
  if (lower.includes("product/entity targets") || lower.includes("benchmark query") || lower.includes("competitor-only answers")) return "";
  if (lower === "image alt text") return "image alt";
  if (lower === "faq schema") return "FAQ schema";
  if (lower === "article/blogposting schema") return "Article/BlogPosting schema";
  if (lower === "comparison signals") return "comparison block";
  return text;
}

function renderMetric(label, value, note) {
  return `<div class="metric"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`;
}

function renderCountTable(title, rows) {
  return `<section><h2>${escapeHtml(title)}</h2><table><thead><tr><th>Item</th><th>Count</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${escapeHtml(row.value)}</td></tr>`).join("")}</tbody></table></section>`;
}

function renderPageCard(row) {
  const prompts = splitList(row.retest_prompts || row.query_prompts || row.linked_prompts).slice(0, 5).join("; ");
  return `<article class="page-card">
    <div class="rank">#${escapeHtml(row.rank || "")}</div>
    <div>
      <h3><a href="${escapeHtml(row.url)}">${escapeHtml(row.title)}</a></h3>
      <p class="meta">${escapeHtml(row.category)} | ${escapeHtml(row.ai_visibility_stage)} | ${escapeHtml(row.workstream || row.action_bucket)} | Score ${escapeHtml(row.visibility_risk_score || row.priority_score)}</p>
      <p><strong>Competitors:</strong> ${escapeHtml(compact(row.competitors, 220) || "None detected")}</p>
      <p><strong>Issues:</strong> ${escapeHtml(compact(row.issue_flags, 260) || "No issue flags")}</p>
      <p><strong>First edit:</strong> ${escapeHtml(compact(row.primary_action || row.first_edit_instruction, 320))}</p>
      <p><strong>Products:</strong> ${escapeHtml(compact(row.products_to_feature, 260) || "No product module listed")}</p>
      <p><strong>Retest prompts:</strong> ${escapeHtml(compact(prompts, 260) || "No prompt listed")}</p>
      ${row.evidence_snippet ? `<blockquote>${escapeHtml(compact(row.evidence_snippet, 360))}</blockquote>` : ""}
    </div>
  </article>`;
}

function renderHtml({ rows, summary, stageRows, categoryRows, issueRows, workstreamRows, topPages, cleanupPages, canonicalPages, sprint1Pages }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT All Blog Page AI Drilldown</title>
  <style>
    body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1260px;margin:0 auto;padding:34px 24px 64px}
    h1{font-size:36px;margin:0 0 8px}
    h2{font-size:23px;margin:34px 0 12px}
    h3{font-size:18px;margin:0 0 8px}
    p,li{line-height:1.55;color:#334155;font-size:14px}
    .note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #0f766e;border-radius:12px;padding:16px 18px;margin:20px 0}
    .metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:22px 0}
    .metric{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:16px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:800}
    .value{font-size:30px;font-weight:900;margin:8px 0;color:#0f172a}
    .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:0 0 18px}
    th,td{text-align:left;vertical-align:top;padding:9px 10px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    .page-card{display:grid;grid-template-columns:52px 1fr;gap:14px;background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:16px;margin:12px 0}
    .rank{font-weight:900;font-size:20px;color:#0f766e}
    .meta{font-weight:800;color:#475569}
    blockquote{margin:10px 0 0;padding:11px 13px;background:#f1f5f9;border-left:4px solid #94a3b8;color:#1e293b}
    a{color:#0f766e;overflow-wrap:anywhere}
    details{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:14px;margin:12px 0}
    summary{font-weight:900;cursor:pointer}
    @media(max-width:900px){.metrics,.grid{grid-template-columns:1fr}h1{font-size:30px}.page-card{grid-template-columns:1fr}}
  </style>
</head>
<body>
<main>
  <h1>All Blog Page AI Drilldown</h1>
  <p>This report turns the full live blog audit into an editor-ready map. It covers every page in the blog control ledger, not just the benchmark winners and losers.</p>
  <div class="note"><strong>How to use this:</strong> start with Sprint 1 and canonical-decision pages, fix the survivor URL first, add answer-first comparison/product/schema blocks, then run the priority retest packet. Source/citation work comes after the page is stable.</div>
  <section class="metrics">
    ${renderMetric("Pages classified", rows.length, "Rows in the blog visibility control ledger.")}
    ${renderMetric("Competitor replacement pages", summary.competitorReplacementPages, "Pages tied to competitor-only answers.")}
    ${renderMetric("Canonical-first pages", summary.canonicalPages, "Pages where survivor/canonical decision comes before edits.")}
    ${renderMetric("Source cleanup pages", summary.sourceCleanupPages, "Pages needing structure/schema cleanup before citation work.")}
  </section>
  <section class="grid">
    ${renderCountTable("AI Visibility Stage", stageRows)}
    ${renderCountTable("Category Coverage", categoryRows)}
    ${renderCountTable("Workstreams", workstreamRows)}
    ${renderCountTable("Top Issue Flags", issueRows)}
  </section>

  <h2>Sprint 1 Pages</h2>
  ${sprint1Pages.map(renderPageCard).join("") || "<p>No Sprint 1 pages found.</p>"}

  <h2>Highest Priority Pages</h2>
  ${topPages.map(renderPageCard).join("")}

  <details open>
    <summary>Canonical or Survivor Decision Pages (${canonicalPages.length})</summary>
    ${canonicalPages.slice(0, 30).map(renderPageCard).join("")}
  </details>

  <details>
    <summary>Source Cleanup Pages (${cleanupPages.length})</summary>
    ${cleanupPages.slice(0, 60).map(renderPageCard).join("")}
  </details>

  <h2>All Pages</h2>
  <table>
    <thead><tr><th>Rank</th><th>Title</th><th>Category</th><th>Stage</th><th>Workstream</th><th>Competitor-only</th><th>Issues</th><th>Action</th></tr></thead>
    <tbody>
      ${rows.map((row) => `<tr><td>${escapeHtml(row.rank)}</td><td><a href="${escapeHtml(row.url)}">${escapeHtml(row.title)}</a></td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.ai_visibility_stage)}</td><td>${escapeHtml(row.workstream || row.action_bucket)}</td><td>${escapeHtml(row.competitor_only_answers)}</td><td>${escapeHtml(compact(row.issue_flags, 160))}</td><td>${escapeHtml(compact(row.primary_action || row.first_edit_instruction, 180))}</td></tr>`).join("")}
    </tbody>
  </table>
</main>
</body>
</html>`;
}

function renderMarkdown({ rows, summary, stageRows, categoryRows, issueRows, topPages, sprint1Pages }) {
  return `# All Blog Page AI Drilldown

## Summary

- Pages classified: ${rows.length}
- Competitor replacement pages: ${summary.competitorReplacementPages}
- Canonical-first pages: ${summary.canonicalPages}
- Source cleanup pages: ${summary.sourceCleanupPages}
- Sprint 1 pages: ${sprint1Pages.length}

## Visibility Stages

${stageRows.map((row) => `- ${row.label}: ${row.value}`).join("\n")}

## Top Categories

${categoryRows.map((row) => `- ${row.label}: ${row.value}`).join("\n")}

## Top Issue Flags

${issueRows.map((row) => `- ${row.label}: ${row.value}`).join("\n")}

## Sprint 1 Pages

${sprint1Pages.map((row) => `- ${row.title} (${row.category}): ${row.primary_action || row.first_edit_instruction}`).join("\n")}

## Highest Priority Pages

${topPages.map((row) => `- #${row.rank} ${row.title}: ${row.ai_visibility_stage}, competitors ${row.competitors || "none"}, action ${row.primary_action || row.first_edit_instruction}`).join("\n")}
`;
}

async function main() {
  const controlRows = await readCsv("blog-post-visibility-control-report/blog-page-control-ledger.csv");
  const dossierData = await readJson("all-blog-post-dossier/all-blog-post-dossier-data.json", { summary: {} });
  const executionData = await readJson("page-execution-control-board/page-execution-control-data.json", { summary: {} });
  const rows = [...controlRows].sort((a, b) => num(a.rank) - num(b.rank));
  const stageCounts = new Map();
  const categoryCounts = new Map();
  const workstreamCounts = new Map();
  const issueCounts = new Map();
  for (const row of rows) {
    increment(stageCounts, row.ai_visibility_stage);
    increment(categoryCounts, row.category);
    increment(workstreamCounts, row.workstream || row.action_bucket);
    const pageIssues = new Set();
    for (const issue of splitList(row.issue_flags)) {
      const cleanIssue = normalizeIssue(issue);
      if (cleanIssue) pageIssues.add(cleanIssue);
    }
    for (const cleanIssue of pageIssues) increment(issueCounts, cleanIssue);
  }

  const canonicalPages = rows.filter((row) => /canonical/i.test(`${row.page_status} ${row.lifecycle_bucket} ${row.workstream} ${row.action_bucket} ${row.canonical_or_survivor_ticket}`));
  const cleanupPages = rows.filter((row) => /Citation\/schema cleanup|Canonical\/survivor review/i.test(row.workstream));
  const sprint1Pages = rows.filter((row) => /sprint 1/i.test(row.conversion_tier)).slice(0, 12);
  const topPages = rows.slice(0, 18);
  const summary = {
    competitorReplacementPages: rows.filter((row) => /competitor replacement/i.test(row.ai_visibility_stage)).length,
    canonicalPages: canonicalPages.length,
    sourceCleanupPages: executionData.summary?.sourceCleanupPages || cleanupPages.length,
    dossierPages: dossierData.summary?.pages || 0,
    executionPages: executionData.summary?.pages || 0,
  };

  const reportRows = rows.map((row) => [
    row.rank,
    row.visibility_risk_score || row.priority_score,
    row.title,
    row.url,
    row.category,
    row.page_status,
    row.ai_visibility_stage,
    row.workstream || row.action_bucket,
    row.lifecycle_bucket,
    row.citation_readiness_bucket,
    row.conversion_tier,
    row.ai_citability_score,
    row.benchmark_query_count,
    row.zero_mention_queries,
    row.competitor_only_answers,
    row.clean_mentions,
    row.co_mentions,
    row.competitors,
    row.issue_flags,
    row.products_to_feature,
    row.primary_action || row.first_edit_instruction,
    row.citation_action,
    row.checkout_action,
    row.retest_prompts || row.query_prompts || row.linked_prompts,
    row.evidence_provider,
    row.evidence_query,
    row.evidence_outcome,
  ]);

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "all-page-ai-drilldown.csv"), csv([
    ["rank", "score", "title", "url", "category", "page_status", "ai_visibility_stage", "workstream", "lifecycle_bucket", "citation_readiness_bucket", "conversion_tier", "ai_citability_score", "benchmark_query_count", "zero_mention_queries", "competitor_only_answers", "clean_mentions", "co_mentions", "competitors", "issue_flags", "products_to_feature", "primary_action", "citation_action", "checkout_action", "retest_prompts", "evidence_provider", "evidence_query", "evidence_outcome"],
    ...reportRows,
  ]));
  const stageRows = topEntries(stageCounts, 12);
  const categoryRows = topEntries(categoryCounts, 12);
  const workstreamRows = topEntries(workstreamCounts, 12);
  const issueRows = topEntries(issueCounts, 12);
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml({
    rows,
    summary,
    stageRows,
    categoryRows,
    issueRows,
    workstreamRows,
    topPages,
    cleanupPages,
    canonicalPages,
    sprint1Pages,
  }));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown({
    rows,
    summary,
    stageRows,
    categoryRows,
    issueRows,
    topPages,
    sprint1Pages,
  }));
  await writeFile(path.join(outDir, "page-drilldown-summary.csv"), csv([
    ["metric", "value"],
    ["pages_classified", rows.length],
    ["competitor_replacement_pages", summary.competitorReplacementPages],
    ["canonical_first_pages", summary.canonicalPages],
    ["source_cleanup_pages", summary.sourceCleanupPages],
    ["dossier_pages", summary.dossierPages],
    ["execution_pages", summary.executionPages],
  ]));

  console.log(`Wrote ${outDir}`);
  console.log(`Pages classified: ${rows.length}`);
  console.log(`Competitor replacement pages: ${summary.competitorReplacementPages}`);
  console.log(`Canonical-first pages: ${summary.canonicalPages}`);
  console.log(`Source cleanup pages: ${summary.sourceCleanupPages}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
