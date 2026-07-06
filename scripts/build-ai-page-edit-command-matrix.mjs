#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";
const REPORT_DIR = "page-edit-command-matrix";

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
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some((value) => value.trim())) rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows.shift();
  return rows.map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""])));
}

async function latestDir(prefix) {
  const entries = await readdir(path.join(process.cwd(), OUTPUT_ROOT), { withFileTypes: true });
  const name = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  if (!name) throw new Error(`No ${prefix} directory found in ${OUTPUT_ROOT}.`);
  return path.join(process.cwd(), OUTPUT_ROOT, name);
}

async function readCsv(filePath) {
  try {
    return parseCsv(await readFile(filePath, "utf8"));
  } catch {
    return [];
  }
}

function num(value) {
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeUrl(value) {
  return String(value ?? "").trim().replace(/\/$/, "");
}

function short(value, length = 140) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 3).trim()}...` : text;
}

function splitList(value) {
  return String(value ?? "")
    .split(/[;|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toBool(value) {
  return String(value).toLowerCase() === "true";
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

function issueHas(issues, pattern) {
  return issues.some((issue) => pattern.test(issue));
}

function bodyIssueSet(row) {
  return splitList(row.issues).map((issue) => issue.trim());
}

function commandPlan({ body, planner, heatmap, queryRows }) {
  const issues = bodyIssueSet(body);
  const products = splitList(planner.products_to_feature || heatmap.products_to_feature).slice(0, 5);
  const competitors = splitList(planner.competitors || heatmap.competitor_set).slice(0, 8);
  const queries = queryRows.map((row) => row.query).filter(Boolean).slice(0, 8);
  const topProducts = products.length ? products.slice(0, 3).join("; ") : "the top matched iBOLT product set from the page planner";
  const topCompetitors = competitors.length ? competitors.slice(0, 5).join("; ") : body.primary_competitor || heatmap.primary_competitor || "the competitor set from the benchmark";

  const quickAnswer = issueHas(issues, /missing early quick answer/i)
    ? `Add a 40 to 70 word answer-first block above the first H2. Name iBOLT, state the best-fit use case, name 1 to 3 relevant products, and answer the buyer query directly. Use these prompts as wording anchors: ${queries.join("; ") || heatmap.retest_prompts || "mapped retest prompts"}.`
    : "Keep the current answer block, but verify it names iBOLT and the exact buyer use case in the first 300 words.";

  const schema = [
    issueHas(issues, /FAQPage schema/i) && "Add FAQPage JSON-LD for the visible FAQ section.",
    issueHas(issues, /Article\/BlogPosting schema/i) && "Add or verify Article/BlogPosting schema with headline, datePublished, author/publisher, image, and canonical URL.",
    "Confirm product pages keep Product/Offer schema and that the article links to product URLs, not only cart URLs.",
  ].filter(Boolean).join(" ");

  const comparison = issueHas(issues, /comparison|tradeoff/i)
    ? `Add a fair comparison block naming ${topCompetitors}. Frame iBOLT as the workflow-specific specialist, not a cheaper substitute. Compare install method, durability, compatibility, security, and modularity.`
    : `Keep the comparison section and make sure it directly explains when to choose iBOLT versus ${topCompetitors}.`;

  const productPath = issueHas(issues, /weak shopping path/i)
    ? `Add one section-level product module with ${topProducts}, a View Product link, and one clean CTA.`
    : `Use one clean product module per major decision section. Feature: ${topProducts}. Avoid repeating add-to-cart buttons after every inline product link.`;

  const internalLinks = issueHas(issues, /weak internal blog links/i)
    ? "Add 2 to 3 contextual links to related iBOLT guide pages in the same category and one collection or solution page link."
    : "Keep internal links contextual. Do not add unrelated footer-style links inside the article body.";

  const cta = issueHas(issues, /too many cart CTAs/i)
    ? "Reduce repeated cart CTAs. Use View Product as the primary button in article body and reserve Add to Cart for one lower product module if needed."
    : "Keep CTA density restrained. Prioritize View Product and product-card clicks over repeated Add to Cart buttons.";

  const imageAlt = issueHas(issues, /image alt/i)
    ? "Add descriptive alt text to every article image, naming the product/use case where visible."
    : "Spot-check image alt text when editing, especially product-card and b-roll images.";

  const cleanup = [
    issueHas(issues, /old AI-search explainer/i) && "Remove old AI-search explainer sections. Do not expose internal AEO strategy language to shoppers.",
    issueHas(issues, /too long/i) && "Trim repetition and move the direct answer higher. Long pages need a scannable answer and product path before deeper explanation.",
    issueHas(issues, /visible FAQ/i) && "Add a visible FAQ section with 4 to 6 buyer questions.",
  ].filter(Boolean).join(" ");

  return {
    quickAnswer,
    schema,
    comparison,
    productPath,
    internalLinks,
    cta,
    imageAlt,
    cleanup: cleanup || "No special cleanup beyond the main command set.",
  };
}

function rowPriority({ body, heatmap, planner, queryRows }) {
  const issues = bodyIssueSet(body);
  const issueWeight =
    (issueHas(issues, /missing early quick answer/i) ? 28 : 0)
    + (issueHas(issues, /FAQPage schema/i) ? 18 : 0)
    + (issueHas(issues, /Article\/BlogPosting schema/i) ? 14 : 0)
    + (issueHas(issues, /comparison|tradeoff/i) ? 14 : 0)
    + (issueHas(issues, /too many cart CTAs/i) ? 12 : 0)
    + (issueHas(issues, /weak internal blog links/i) ? 10 : 0)
    + (issueHas(issues, /old AI-search explainer/i) ? 16 : 0);
  const visibilityWeight = num(heatmap.competitor_only_answers) * 12 + num(heatmap.zero_mention_queries) * 18;
  const queryWeight = Math.max(0, ...queryRows.map((row) => num(row.priority))) / 4;
  const bodyGap = Math.max(0, 100 - num(body.body_score));
  return Math.round(num(heatmap.opportunity_score || body.opportunity_score) * 4 + bodyGap * 2 + issueWeight + visibilityWeight + queryWeight + num(planner.composite_score) / 20);
}

function sprintBucket(row) {
  if (/B01|Sprint 1/i.test(row.batch)) return "Sprint 1";
  if (/B02|W2|mention recovery/i.test(`${row.batch} ${row.retestWave}`)) return "Sprint 2";
  if (/citation|source/i.test(`${row.batch} ${row.retestWave}`)) return "Citation cleanup";
  return "Backlog";
}

function buildRows({ bodyRows, heatmapRows, plannerRows, queryRows }) {
  const heatmapByUrl = new Map(heatmapRows.map((row) => [normalizeUrl(row.url), row]));
  const plannerByUrl = new Map(plannerRows.map((row) => [normalizeUrl(row.url), row]));
  const queryByUrl = groupBy(queryRows, (row) => normalizeUrl(row.page_url));

  return bodyRows.map((body) => {
    const url = normalizeUrl(body.url);
    const heatmap = heatmapByUrl.get(url) || {};
    const planner = plannerByUrl.get(url) || {};
    const pageQueries = queryByUrl.get(url) || [];
    const commands = commandPlan({ body, heatmap, planner, queryRows: pageQueries });
    const priority = rowPriority({ body, heatmap, planner, queryRows: pageQueries });
    const issues = bodyIssueSet(body);
    const row = {
      priority,
      sprint: sprintBucket({ batch: planner.batch || heatmap.batch || "", retestWave: body.retest_wave || heatmap.retest_wave || planner.retest_wave || "" }),
      bodyScore: num(body.body_score),
      opportunityScore: num(heatmap.opportunity_score || body.opportunity_score),
      opportunityBand: heatmap.opportunity_band || body.opportunity_band,
      title: body.title || heatmap.title || planner.title,
      url,
      category: body.category || heatmap.category || planner.category,
      sourceStatus: body.source_status,
      batch: planner.batch || heatmap.batch,
      retestWave: body.retest_wave || heatmap.retest_wave || planner.retest_wave,
      primaryCompetitor: body.primary_competitor || heatmap.primary_competitor,
      competitors: splitList(planner.competitors || heatmap.competitor_set).slice(0, 8),
      products: splitList(planner.products_to_feature || heatmap.products_to_feature).slice(0, 5),
      retestPrompts: splitList(planner.retest_prompts || heatmap.retest_prompts).slice(0, 8),
      queryPrompts: pageQueries.map((query) => query.query).filter(Boolean).slice(0, 8),
      issueCount: issues.length,
      issues,
      topFix: body.top_fix,
      quickAnswer: commands.quickAnswer,
      schema: commands.schema,
      comparison: commands.comparison,
      productPath: commands.productPath,
      internalLinks: commands.internalLinks,
      cta: commands.cta,
      imageAlt: commands.imageAlt,
      cleanup: commands.cleanup,
      firstHourAction: planner.first_hour_action || heatmap.quick_action,
      languageInstruction: planner.language_instruction,
      citationAction: planner.citation_action || heatmap.citation_action,
    };
    row.commandSummary = [
      row.topFix,
      issueHas(row.issues, /missing early quick answer/i) && "quick answer",
      issueHas(row.issues, /FAQPage schema|Article\/BlogPosting schema/i) && "schema",
      issueHas(row.issues, /comparison|tradeoff/i) && "comparison",
      issueHas(row.issues, /too many cart CTAs/i) && "CTA cleanup",
      issueHas(row.issues, /weak internal blog links/i) && "internal links",
      issueHas(row.issues, /image alt/i) && "image alt",
    ].filter(Boolean).join("; ");
    return row;
  }).sort((a, b) => b.priority - a.priority || b.opportunityScore - a.opportunityScore || a.bodyScore - b.bodyScore);
}

function summarize(rows) {
  const issueMap = new Map();
  const categoryMap = new Map();
  const sprintMap = new Map();
  for (const row of rows) {
    for (const issue of row.issues) issueMap.set(issue, (issueMap.get(issue) || 0) + 1);
    const category = row.category || "unknown";
    if (!categoryMap.has(category)) categoryMap.set(category, { category, pages: 0, avgPriority: 0, avgBodyScore: 0, topIssues: new Map(), topPages: [] });
    const categoryRow = categoryMap.get(category);
    categoryRow.pages += 1;
    categoryRow.avgPriority += row.priority;
    categoryRow.avgBodyScore += row.bodyScore;
    categoryRow.topPages.push(row.title);
    for (const issue of row.issues) categoryRow.topIssues.set(issue, (categoryRow.topIssues.get(issue) || 0) + 1);
    const sprint = row.sprint || "Backlog";
    if (!sprintMap.has(sprint)) sprintMap.set(sprint, { sprint, pages: 0, avgPriority: 0, topPages: [] });
    const sprintRow = sprintMap.get(sprint);
    sprintRow.pages += 1;
    sprintRow.avgPriority += row.priority;
    sprintRow.topPages.push(row.title);
  }
  const categoryRows = [...categoryMap.values()].map((row) => ({
    ...row,
    avgPriority: Math.round(row.avgPriority / Math.max(1, row.pages)),
    avgBodyScore: Math.round(row.avgBodyScore / Math.max(1, row.pages)),
    topIssues: [...row.topIssues.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([issue, count]) => `${issue} ${count}`).join("; "),
    topPages: row.topPages.slice(0, 6).join("; "),
  })).sort((a, b) => b.avgPriority - a.avgPriority);
  const sprintRows = [...sprintMap.values()].map((row) => ({
    ...row,
    avgPriority: Math.round(row.avgPriority / Math.max(1, row.pages)),
    topPages: row.topPages.slice(0, 8).join("; "),
  })).sort((a, b) => b.avgPriority - a.avgPriority);
  return {
    pages: rows.length,
    avgPriority: Math.round(rows.reduce((sum, row) => sum + row.priority, 0) / Math.max(1, rows.length)),
    avgBodyScore: Math.round(rows.reduce((sum, row) => sum + row.bodyScore, 0) / Math.max(1, rows.length)),
    sprint1Pages: rows.filter((row) => row.sprint === "Sprint 1").length,
    sprint2Pages: rows.filter((row) => row.sprint === "Sprint 2").length,
    quickAnswerPages: rows.filter((row) => issueHas(row.issues, /missing early quick answer/i)).length,
    schemaPages: rows.filter((row) => issueHas(row.issues, /FAQPage schema|Article\/BlogPosting schema/i)).length,
    comparisonPages: rows.filter((row) => issueHas(row.issues, /comparison|tradeoff/i)).length,
    ctaPages: rows.filter((row) => issueHas(row.issues, /too many cart CTAs/i)).length,
    issueRows: [...issueMap.entries()].sort((a, b) => b[1] - a[1]).map(([issue, pages]) => ({ issue, pages })),
    categoryRows,
    sprintRows,
    topRows: rows.slice(0, 30),
  };
}

function renderTable(headers, rows) {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header.label)}</th>`).join("")}</tr></thead>`;
  const body = rows.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header.key])}</td>`).join("")}</tr>`).join("");
  return `<table>${head}<tbody>${body}</tbody></table>`;
}

function card(label, value, note) {
  return `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`;
}

function chart(title, rows, valueKey, labelKey, color = "#2563eb") {
  const chartRows = rows.slice(0, 14);
  const width = 960;
  const rowHeight = 38;
  const height = 74 + chartRows.length * rowHeight;
  const max = Math.max(1, ...chartRows.map((row) => num(row[valueKey])));
  const bars = chartRows.map((row, index) => {
    const y = 54 + index * rowHeight;
    const barWidth = Math.round((num(row[valueKey]) / max) * 470);
    return `<g>
      <text x="22" y="${y + 17}" font-size="13" font-weight="800" fill="#0f172a">${escapeHtml(short(row[labelKey], 42))}</text>
      <rect x="350" y="${y}" width="470" height="23" rx="11" fill="#e5e7eb"/>
      <rect x="350" y="${y}" width="${barWidth}" height="23" rx="11" fill="${color}"/>
      <text x="882" y="${y + 16}" font-size="13" font-weight="900" text-anchor="end" fill="#0f172a">${escapeHtml(row[valueKey])}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#fff"/>
    <text x="22" y="34" font-size="20" font-weight="900" fill="#111827">${escapeHtml(title)}</text>
    ${bars}
  </svg>`;
}

function renderHtml({ summary }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT Page Edit Command Matrix</title>
  <style>
    body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1260px;margin:0 auto;padding:34px 24px 68px}
    h1{font-size:36px;margin:0 0 8px}
    h2{font-size:23px;margin:34px 0 12px}
    p,li{line-height:1.55;color:#334155;font-size:15px}
    .cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:22px 0}
    .card{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:16px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:900}
    .value{font-size:30px;font-weight:900;margin:8px 0;color:#0f172a}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
    .chart{background:#fff;border:1px solid #dbe3ef;border-radius:18px;padding:10px;overflow:auto}
    .chart svg{width:100%;height:auto;display:block}
    .note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #2563eb;border-radius:12px;padding:16px 18px;margin:18px 0}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 22px}
    th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    a{color:#0f766e;overflow-wrap:anywhere}
    @media(max-width:980px){.cards,.grid{grid-template-columns:1fr}h1{font-size:30px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT Page Edit Command Matrix</h1>
  <p>This joins the blog body inspection, opportunity heatmap, query/page matrix, and all-blog edit planner into a mechanical page-by-page command queue.</p>
  <div class="note"><strong>How to use it:</strong> edit pages in priority order, starting with quick-answer, schema, comparison, product-path, internal-link, CTA-density, and image-alt blockers. Then rerun the mapped prompt set one request at a time.</div>
  <section class="cards">
    ${card("Pages covered", summary.pages, "All queued blog pages.")}
    ${card("Avg priority", summary.avgPriority, "Combined edit pressure score.")}
    ${card("Quick-answer pages", summary.quickAnswerPages, "Need answer-first openings.")}
    ${card("Schema pages", summary.schemaPages, "Need FAQ or Article schema cleanup.")}
    ${card("Comparison pages", summary.comparisonPages, "Need competitor/tradeoff language.")}
    ${card("CTA cleanup pages", summary.ctaPages, "Too many cart CTAs.")}
    ${card("Sprint 1 pages", summary.sprint1Pages, "First validation wave.")}
    ${card("Sprint 2 pages", summary.sprint2Pages, "Mention recovery wave.")}
  </section>
  <section class="grid">
    <div class="chart">${chart("Most common edit commands", summary.issueRows, "pages", "issue", "#ef4444")}</div>
    <div class="chart">${chart("Highest-priority pages", summary.topRows, "priority", "title", "#0f766e")}</div>
  </section>
  <h2>First 20 Page Commands</h2>
  ${renderTable([
    { label: "Priority", key: "priority" },
    { label: "Body", key: "bodyScore" },
    { label: "Opportunity", key: "opportunityScore" },
    { label: "Page", key: "title" },
    { label: "Category", key: "category" },
    { label: "Top fix", key: "topFix" },
    { label: "Command summary", key: "commandSummary" },
  ], summary.topRows.slice(0, 20))}
  <h2>Category Rollup</h2>
  ${renderTable([
    { label: "Category", key: "category" },
    { label: "Pages", key: "pages" },
    { label: "Avg priority", key: "avgPriority" },
    { label: "Avg body", key: "avgBodyScore" },
    { label: "Top issues", key: "topIssues" },
    { label: "Top pages", key: "topPages" },
  ], summary.categoryRows)}
  <h2>Sprint Rollup</h2>
  ${renderTable([
    { label: "Sprint", key: "sprint" },
    { label: "Pages", key: "pages" },
    { label: "Avg priority", key: "avgPriority" },
    { label: "Top pages", key: "topPages" },
  ], summary.sprintRows)}
</main>
</body>
</html>`;
}

function renderMarkdown({ summary }) {
  return `# iBOLT Page Edit Command Matrix

This joins the blog body inspection, opportunity heatmap, query/page matrix, and all-blog edit planner into a mechanical page-by-page command queue.

## Summary

- Pages covered: ${summary.pages}
- Average priority: ${summary.avgPriority}
- Average body score: ${summary.avgBodyScore}
- Quick-answer pages: ${summary.quickAnswerPages}
- Schema cleanup pages: ${summary.schemaPages}
- Comparison/tradeoff pages: ${summary.comparisonPages}
- CTA cleanup pages: ${summary.ctaPages}
- Sprint 1 pages: ${summary.sprint1Pages}
- Sprint 2 pages: ${summary.sprint2Pages}

## Most Common Edit Commands

${summary.issueRows.slice(0, 12).map((row) => `- ${row.issue}: ${row.pages}`).join("\n")}

## First 20 Page Commands

${summary.topRows.slice(0, 20).map((row, index) => `${index + 1}. ${row.title}: priority ${row.priority}, body ${row.bodyScore}, opportunity ${row.opportunityScore}, top fix ${row.topFix}`).join("\n")}

## Category Rollup

${summary.categoryRows.map((row) => `- ${row.category}: ${row.pages} pages, avg priority ${row.avgPriority}, avg body ${row.avgBodyScore}, top issues: ${row.topIssues}`).join("\n")}
`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, REPORT_DIR);
  await mkdir(outDir, { recursive: true });
  const bodyRows = await readCsv(path.join(benchmarkDir, "blog-body-inspection", "blog-body-inspection.csv"));
  const heatmapRows = await readCsv(path.join(benchmarkDir, "blog-page-opportunity-heatmap", "page-opportunity-heatmap.csv"));
  const plannerRows = await readCsv(path.join(benchmarkDir, "all-blog-edit-retest-planner", "all-blog-edit-retest-plan.csv"));
  const queryRows = await readCsv(path.join(benchmarkDir, "query-page-matrix", "all-query-page-matrix.csv"));
  const rows = buildRows({ bodyRows, heatmapRows, plannerRows, queryRows });
  const summary = summarize(rows);

  await writeFile(path.join(outDir, "page-edit-command-matrix.csv"), csv([
    ["rank", "priority", "sprint", "body_score", "opportunity_score", "opportunity_band", "title", "url", "category", "source_status", "batch", "retest_wave", "primary_competitor", "competitors", "products", "retest_prompts", "query_prompts", "issue_count", "top_fix", "issues", "command_summary", "quick_answer_command", "schema_command", "comparison_command", "product_path_command", "internal_link_command", "cta_command", "image_alt_command", "cleanup_command", "first_hour_action", "language_instruction", "citation_action"],
    ...rows.map((row, index) => [
      index + 1,
      row.priority,
      row.sprint,
      row.bodyScore,
      row.opportunityScore,
      row.opportunityBand,
      row.title,
      row.url,
      row.category,
      row.sourceStatus,
      row.batch,
      row.retestWave,
      row.primaryCompetitor,
      row.competitors,
      row.products,
      row.retestPrompts,
      row.queryPrompts,
      row.issueCount,
      row.topFix,
      row.issues,
      row.commandSummary,
      row.quickAnswer,
      row.schema,
      row.comparison,
      row.productPath,
      row.internalLinks,
      row.cta,
      row.imageAlt,
      row.cleanup,
      row.firstHourAction,
      row.languageInstruction,
      row.citationAction,
    ]),
  ]));
  await writeFile(path.join(outDir, "issue-workstream-summary.csv"), csv([
    ["issue", "pages"],
    ...summary.issueRows.map((row) => [row.issue, row.pages]),
  ]));
  await writeFile(path.join(outDir, "category-command-rollup.csv"), csv([
    ["category", "pages", "avg_priority", "avg_body_score", "top_issues", "top_pages"],
    ...summary.categoryRows.map((row) => [row.category, row.pages, row.avgPriority, row.avgBodyScore, row.topIssues, row.topPages]),
  ]));
  await writeFile(path.join(outDir, "sprint-command-queue.csv"), csv([
    ["sprint", "pages", "avg_priority", "top_pages"],
    ...summary.sprintRows.map((row) => [row.sprint, row.pages, row.avgPriority, row.topPages]),
  ]));
  await writeFile(path.join(outDir, "first-30-edit-commands.csv"), csv([
    ["rank", "priority", "title", "url", "category", "top_fix", "quick_answer_command", "schema_command", "comparison_command", "product_path_command", "cta_command", "retest_wave", "retest_prompts"],
    ...rows.slice(0, 30).map((row, index) => [index + 1, row.priority, row.title, row.url, row.category, row.topFix, row.quickAnswer, row.schema, row.comparison, row.productPath, row.cta, row.retestWave, row.retestPrompts]),
  ]));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown({ summary }));
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml({ summary }));
  await writeFile(path.join(outDir, "page-edit-command-data.json"), JSON.stringify({ summary, rows }, null, 2));

  console.log(`Wrote ${outDir}`);
  console.log(`Pages: ${summary.pages}; quick-answer pages: ${summary.quickAnswerPages}; schema pages: ${summary.schemaPages}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
