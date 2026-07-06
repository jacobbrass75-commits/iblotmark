import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";
const AUDIT_PREFIX = "live-blog-ai-citability-merged-";

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
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  if (cell.length || row.length) row.push(cell);
  if (row.length) rows.push(row);
  if (!rows.length) return [];
  const [headers, ...records] = rows;
  return records
    .filter((record) => record.some((value) => String(value ?? "").trim()))
    .map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""])));
}

async function readCsv(filePath) {
  try {
    return parseCsv(await readFile(filePath, "utf8"));
  } catch {
    return [];
  }
}

async function latestDir(prefix) {
  const entries = await readdir(path.join(process.cwd(), OUTPUT_ROOT), { withFileTypes: true });
  const match = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  if (!match) throw new Error(`No ${prefix} directory found in ${OUTPUT_ROOT}`);
  return path.join(process.cwd(), OUTPUT_ROOT, match);
}

function num(value) {
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function bool(value) {
  return value === true || String(value).toLowerCase() === "true";
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function countBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const value = row[key] || "unknown";
    map.set(value, (map.get(value) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function slugFromUrl(url) {
  return String(url ?? "").split("/").filter(Boolean).at(-1) ?? "";
}

function actionFor(row, duplicateRoles, editorUrls) {
  const score = num(row.aiCitabilityScore);
  const missingStructure = [
    !bool(row.hasQuickAnswer) && "quick answer",
    !bool(row.hasFaqSchema) && "FAQ schema",
    !bool(row.hasBlogPostingSchema) && !bool(row.hasArticleSchema) && "Article/BlogPosting schema",
    !bool(row.hasComparisonSignals) && "comparison signals",
  ].filter(Boolean);
  const missingAltRate = num(row.images) ? Math.round((num(row.missingAlt) / num(row.images)) * 100) : 0;

  if (duplicateRoles.get(row.url) === "duplicate") return "consolidate duplicate";
  if (duplicateRoles.get(row.url) === "canonical") return "canonical merge review";
  if (editorUrls.has(row.url)) return "priority refresh";
  if (score < 60) return "full refresh";
  if (missingStructure.length >= 3) return "structure refresh";
  if (!bool(row.hasFaqSchema) || !bool(row.hasQuickAnswer)) return "schema and answer refresh";
  if (missingAltRate >= 40) return "media alt refresh";
  return "keep and monitor";
}

function effortFor(action, row) {
  if (action === "consolidate duplicate" || action === "canonical merge review") return "high";
  if (action === "priority refresh" || action === "full refresh") return "medium";
  if (action === "structure refresh") return "medium";
  if (action === "schema and answer refresh" || action === "media alt refresh") return "low";
  if (num(row.aiCitabilityScore) >= 85) return "monitor";
  return "low";
}

function impactFor(action, row) {
  const score = num(row.aiCitabilityScore);
  if (action === "priority refresh" || action === "consolidate duplicate" || action === "canonical merge review") return "high";
  if (score < 65) return "high";
  if (!bool(row.hasQuickAnswer) || !bool(row.hasFaqSchema)) return "medium";
  return "low";
}

function issuesFor(row) {
  return [
    !bool(row.hasQuickAnswer) && "missing quick answer",
    !bool(row.hasFaqSchema) && "missing FAQ schema",
    !bool(row.hasBlogPostingSchema) && !bool(row.hasArticleSchema) && "missing Article/BlogPosting schema",
    !bool(row.hasComparisonSignals) && "missing comparison signals",
    num(row.missingAlt) > 0 && "missing image alt",
    num(row.productLinks) === 0 && "no product links",
    num(row.wordCount) < 700 && "thin content",
    num(row.wordCount) > 2800 && "possible overly long legacy content",
  ].filter(Boolean);
}

function nextStep(action, row) {
  if (action === "consolidate duplicate") return "Merge unique useful sections into the canonical page, then redirect or unpublish this duplicate if Shopify/admin policy allows.";
  if (action === "canonical merge review") return "Keep as canonical candidate, pull in useful duplicate content, then refresh structure and internal links.";
  if (action === "priority refresh") return "Use the page editor brief, then retest mapped ChatGPT, Claude, and Gemini prompts after the edit is live.";
  if (action === "full refresh") return "Rewrite page structure with a direct answer, headings, product module, comparison section, FAQ, and schema.";
  if (action === "structure refresh") return "Add a quick answer, FAQ schema, comparison section, and descriptive image alt text without changing the core page intent.";
  if (action === "schema and answer refresh") return "Add a visible quick-answer block and visible FAQ section, then add matching FAQPage JSON-LD.";
  if (action === "media alt refresh") return "Add descriptive alt text to product and use-case images, prioritizing exact product names and use cases.";
  return "Monitor, internally link from new hubs where relevant, and retest if benchmark prompts start mapping to this page.";
}

function pagePriority(row, action) {
  const issueCount = issuesFor(row).length;
  const actionWeight = {
    "priority refresh": 90,
    "canonical merge review": 88,
    "consolidate duplicate": 85,
    "full refresh": 78,
    "structure refresh": 66,
    "schema and answer refresh": 52,
    "media alt refresh": 35,
    "keep and monitor": 10,
  }[action] ?? 20;
  return Math.round(actionWeight + Math.max(0, 90 - num(row.aiCitabilityScore)) + issueCount * 5 + Math.min(20, num(row.iboltMentions)));
}

function buildRows(auditRows, duplicateRows, editorRows) {
  const duplicateRoles = new Map();
  for (const row of duplicateRows) {
    if (row.canonical_url) duplicateRoles.set(row.canonical_url, "canonical");
    if (row.duplicate_url) duplicateRoles.set(row.duplicate_url, "duplicate");
  }
  const editorUrls = new Set(editorRows.map((row) => row.url).filter(Boolean));
  return auditRows.map((row) => {
    const action = actionFor(row, duplicateRoles, editorUrls);
    const issues = issuesFor(row);
    return {
      priority: pagePriority(row, action),
      action,
      effort: effortFor(action, row),
      impact: impactFor(action, row),
      title: row.title,
      url: row.url,
      slug: slugFromUrl(row.url),
      category: row.category,
      status: row.status,
      score: num(row.aiCitabilityScore),
      wordCount: num(row.wordCount),
      productLinks: num(row.productLinks),
      images: num(row.images),
      missingAlt: num(row.missingAlt),
      iboltMentions: num(row.iboltMentions),
      competitorBrands: Array.isArray(row.competitorBrands) ? row.competitorBrands.join("; ") : splitList(row.competitorBrands).join("; "),
      hasQuickAnswer: bool(row.hasQuickAnswer),
      hasFaqSchema: bool(row.hasFaqSchema),
      hasArticleSchema: bool(row.hasArticleSchema),
      hasBlogPostingSchema: bool(row.hasBlogPostingSchema),
      hasComparisonSignals: bool(row.hasComparisonSignals),
      issues: issues.join("; "),
      nextStep: nextStep(action, row),
      source: row.source,
    };
  }).sort((a, b) => b.priority - a.priority || a.score - b.score);
}

function categoryRows(triageRows) {
  const byCategory = new Map();
  for (const row of triageRows) {
    const current = byCategory.get(row.category) ?? [];
    current.push(row);
    byCategory.set(row.category, current);
  }
  return [...byCategory.entries()].map(([category, rows]) => ({
    category,
    pages: rows.length,
    avgScore: Math.round(rows.reduce((sum, row) => sum + row.score, 0) / rows.length),
    priorityRefresh: rows.filter((row) => row.action === "priority refresh").length,
    canonicalMerge: rows.filter((row) => row.action === "canonical merge review").length,
    duplicateConsolidate: rows.filter((row) => row.action === "consolidate duplicate").length,
    fullRefresh: rows.filter((row) => row.action === "full refresh").length,
    schemaAnswer: rows.filter((row) => row.action === "schema and answer refresh").length,
    keep: rows.filter((row) => row.action === "keep and monitor").length,
    topIssues: topCounts(rows.flatMap((row) => splitList(row.issues)), 6).map(([name, count]) => `${name} ${count}`).join("; "),
  })).sort((a, b) => b.priorityRefresh - a.priorityRefresh || a.avgScore - b.avgScore);
}

function topCounts(values, limit = 10) {
  const map = new Map();
  for (const value of values.filter(Boolean)) {
    map.set(value, (map.get(value) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
}

function markdown({ triageRows, categories, auditDir, benchmarkDir }) {
  const actionCounts = countBy(triageRows, "action");
  const effortCounts = countBy(triageRows, "effort");
  const issueCounts = topCounts(triageRows.flatMap((row) => splitList(row.issues)), 12);
  const top = triageRows.slice(0, 30);
  return `# Live Blog Triage

This report classifies every live audited iBOLT blog page, not just the pages already mapped to benchmark prompts.

## Summary

- Live pages triaged: ${triageRows.length}
- Actions: ${actionCounts.map(([name, count]) => `${name} (${count})`).join(", ")}
- Effort: ${effortCounts.map(([name, count]) => `${name} (${count})`).join(", ")}
- Top issues: ${issueCounts.map(([name, count]) => `${name} (${count})`).join(", ")}

## Category Summary

| Category | Pages | Avg score | Priority refresh | Canonical merge | Duplicate consolidate | Full refresh | Schema/answer | Keep | Top issues |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
${categories.map((row) => `| ${row.category} | ${row.pages} | ${row.avgScore} | ${row.priorityRefresh} | ${row.canonicalMerge} | ${row.duplicateConsolidate} | ${row.fullRefresh} | ${row.schemaAnswer} | ${row.keep} | ${row.topIssues} |`).join("\n")}

## Top Triage Queue

| Priority | Action | Effort | Impact | Score | Page | Category | Issues | Next step |
| ---: | --- | --- | --- | ---: | --- | --- | --- | --- |
${top.map((row) => `| ${row.priority} | ${row.action} | ${row.effort} | ${row.impact} | ${row.score} | [${row.title}](${row.url}) | ${row.category} | ${row.issues} | ${row.nextStep} |`).join("\n")}

## Use This With

- Priority refresh pages: use the page editor pack.
- Canonical merge and duplicate consolidation pages: use duplicate consolidation plan first.
- Schema/answer pages: add visible FAQ and quick-answer content before adding JSON-LD.
- Media alt pages: add product/use-case specific alt text.

Source audit folder: ${auditDir}
Benchmark folder: ${benchmarkDir}
`;
}

function html({ triageRows, categories }) {
  const actionCounts = countBy(triageRows, "action");
  const issueCounts = topCounts(triageRows.flatMap((row) => splitList(row.issues)), 12);
  const cards = [
    ["Pages", triageRows.length],
    ["Priority refresh", triageRows.filter((row) => row.action === "priority refresh").length],
    ["Canonical review", triageRows.filter((row) => row.action === "canonical merge review").length],
    ["Duplicates", triageRows.filter((row) => row.action === "consolidate duplicate").length],
    ["Keep/monitor", triageRows.filter((row) => row.action === "keep and monitor").length],
  ].map(([label, value]) => `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div></div>`).join("");
  const categoryTable = categories.map((row) => `<tr><td>${escapeHtml(row.category)}</td><td>${row.pages}</td><td>${row.avgScore}</td><td>${row.priorityRefresh}</td><td>${row.canonicalMerge}</td><td>${row.duplicateConsolidate}</td><td>${row.fullRefresh}</td><td>${row.schemaAnswer}</td><td>${row.keep}</td><td>${escapeHtml(row.topIssues)}</td></tr>`).join("");
  const triageTable = triageRows.slice(0, 50).map((row) => `<tr><td>${row.priority}</td><td>${escapeHtml(row.action)}</td><td>${escapeHtml(row.effort)}</td><td>${escapeHtml(row.impact)}</td><td>${row.score}</td><td><a href="${escapeHtml(row.url)}">${escapeHtml(row.title)}</a></td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.issues)}</td></tr>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>iBOLT Live Blog Triage</title>
<style>
body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}main{max-width:1240px;margin:0 auto;padding:34px 24px 70px}h1{font-size:34px;margin:0 0 8px}h2{font-size:22px;margin:32px 0 12px}p{color:#334155;line-height:1.55}.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid #d9e2ef;border-radius:12px;padding:16px}.k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700}.v{font-size:30px;font-weight:800;margin-top:8px}.chips{display:flex;flex-wrap:wrap;gap:8px}.chip{background:#eef2ff;border:1px solid #c7d2fe;border-radius:999px;padding:6px 10px;font-size:13px}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d9e2ef;border-radius:12px;overflow:hidden;margin-bottom:22px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #edf2f7;padding:10px 11px;font-size:14px}th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:12px;letter-spacing:.04em}a{color:#1d4ed8}
</style></head><body><main>
<h1>iBOLT Live Blog Triage</h1>
<p>Every live audited blog page classified into an action lane for AI citation and visibility improvement.</p>
<section class="cards">${cards}</section>
<h2>Action Mix</h2><div class="chips">${actionCounts.map(([name, count]) => `<span class="chip">${escapeHtml(name)}: ${count}</span>`).join("")}</div>
<h2>Top Issues</h2><div class="chips">${issueCounts.map(([name, count]) => `<span class="chip">${escapeHtml(name)}: ${count}</span>`).join("")}</div>
<h2>Category Summary</h2><table><thead><tr><th>Category</th><th>Pages</th><th>Avg</th><th>Priority</th><th>Canonical</th><th>Duplicate</th><th>Full</th><th>Schema</th><th>Keep</th><th>Top issues</th></tr></thead><tbody>${categoryTable}</tbody></table>
<h2>Top Triage Queue</h2><table><thead><tr><th>Priority</th><th>Action</th><th>Effort</th><th>Impact</th><th>Score</th><th>Page</th><th>Category</th><th>Issues</th></tr></thead><tbody>${triageTable}</tbody></table>
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const auditDir = await latestDir(AUDIT_PREFIX);
  const outDir = path.join(benchmarkDir, "live-blog-triage");
  await mkdir(outDir, { recursive: true });

  const audit = JSON.parse(await readFile(path.join(auditDir, "live-blog-page-audit.merged.json"), "utf8"));
  const duplicateRows = await readCsv(path.join(benchmarkDir, "content-refresh-roadmap", "duplicate-consolidation-plan.csv"));
  const editorRows = await readCsv(path.join(benchmarkDir, "page-editor-pack", "editor-brief-index.csv"));
  const triageRows = buildRows(audit.rows, duplicateRows, editorRows);
  const categories = categoryRows(triageRows);

  await writeFile(path.join(outDir, "all-live-blog-triage.csv"), csv([
    ["priority", "action", "effort", "impact", "title", "url", "slug", "category", "status", "ai_citability_score", "word_count", "product_links", "images", "missing_alt", "ibolt_mentions", "competitor_brands", "has_quick_answer", "has_faq_schema", "has_article_schema", "has_blogposting_schema", "has_comparison_signals", "issues", "next_step", "source"],
    ...triageRows.map((row) => [row.priority, row.action, row.effort, row.impact, row.title, row.url, row.slug, row.category, row.status, row.score, row.wordCount, row.productLinks, row.images, row.missingAlt, row.iboltMentions, row.competitorBrands, row.hasQuickAnswer, row.hasFaqSchema, row.hasArticleSchema, row.hasBlogPostingSchema, row.hasComparisonSignals, row.issues, row.nextStep, row.source]),
  ]));
  await writeFile(path.join(outDir, "category-triage-summary.csv"), csv([
    ["category", "pages", "avg_score", "priority_refresh", "canonical_merge_review", "duplicate_consolidate", "full_refresh", "schema_answer_refresh", "keep_monitor", "top_issues"],
    ...categories.map((row) => [row.category, row.pages, row.avgScore, row.priorityRefresh, row.canonicalMerge, row.duplicateConsolidate, row.fullRefresh, row.schemaAnswer, row.keep, row.topIssues]),
  ]));
  await writeFile(path.join(outDir, "REPORT.md"), markdown({ triageRows, categories, auditDir, benchmarkDir }));
  await writeFile(path.join(outDir, "REPORT.html"), html({ triageRows, categories }));
  console.log(`Wrote ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
