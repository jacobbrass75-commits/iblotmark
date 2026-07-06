import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";

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
  const name = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  if (!name) throw new Error(`No ${prefix} directory found in ${OUTPUT_ROOT}`);
  return path.join(process.cwd(), OUTPUT_ROOT, name);
}

function num(value) {
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(count, total) {
  return total ? Math.round((count / total) * 100) : 0;
}

function avg(values) {
  const clean = values.map(num).filter((value) => Number.isFinite(value));
  return clean.length ? Math.round(clean.reduce((sum, value) => sum + value, 0) / clean.length) : 0;
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

function normalizeUrl(value) {
  return String(value ?? "").replace(/\/+$/, "");
}

function slugFromUrl(value) {
  const normalized = normalizeUrl(value);
  return normalized.split("/").pop() || "";
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

function counter(rows, valuesFn) {
  const map = new Map();
  for (const row of rows) {
    for (const value of valuesFn(row)) {
      if (value) map.set(value, (map.get(value) || 0) + 1);
    }
  }
  return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function top(rows, key, count = 10) {
  return [...rows].sort((a, b) => num(b[key]) - num(a[key]) || String(a.title || a.category).localeCompare(String(b.title || b.category))).slice(0, count);
}

function buildTargetPageMap(productRows) {
  const map = new Map();
  for (const row of productRows) {
    for (const url of splitList(row.target_pages).map(normalizeUrl)) {
      if (!url) continue;
      if (!map.has(url)) map.set(url, []);
      map.get(url).push(row);
    }
  }
  return map;
}

function isCanonicalTicket(ticket) {
  if (!ticket) return false;
  const text = `${ticket.ticket_type || ""} ${ticket.survivor_review_flag || ""} ${ticket.canonical_decision || ""}`.toLowerCase();
  return text.includes("canonical") || text.includes("duplicate") || text.includes("redirect") || text.includes("confirm survivor");
}

function canonicalUrls(row) {
  return unique([
    row.page_url,
    row.candidate_url,
    row.url,
    row.source_url,
    row.survivor_url,
    row.redirect_from,
    row.redirect_to,
    row.recommended_survivor_url,
    row.benchmark_pressure_url,
    ...splitList(row.merge_from_urls),
  ]).map(normalizeUrl);
}

function actionBucket({ triage, queryPressure, productTargets, survivorTicket, canonicalRows }) {
  const action = String(triage.action || "").toLowerCase();
  const hasCanonicalWork = action.includes("duplicate") || action.includes("canonical") || isCanonicalTicket(survivorTicket) || canonicalRows.length;
  if (hasCanonicalWork) {
    return "canonical/consolidation review";
  }
  if (queryPressure || productTargets.length >= 3) return "benchmark-driven refresh";
  if (num(triage.ai_citability_score) < 70 || String(triage.issues || "").includes("quick answer") || String(triage.issues || "").includes("FAQ schema")) {
    return "citation-readiness refresh";
  }
  if (String(triage.issues || "").includes("image alt") || String(triage.issues || "").includes("Article/BlogPosting")) {
    return "schema/media cleanup";
  }
  return "monitor";
}

function priorityScore({ triage, queryPressure, productTargets, survivorTicket, canonicalRows, categoryPriority }) {
  let score = num(triage.priority);
  score += Math.max(0, 90 - num(triage.ai_citability_score));
  score += queryPressure ? num(queryPressure.priority) : 0;
  score += productTargets.length * 4;
  score += survivorTicket ? num(survivorTicket.priority) / (isCanonicalTicket(survivorTicket) ? 4 : 8) : 0;
  score += canonicalRows.length * 22;
  score += categoryPriority ? num(categoryPriority.priority_score) / 5 : 0;
  if (String(triage.has_quick_answer) === "false") score += 12;
  if (String(triage.has_faq_schema) === "false") score += 12;
  if (String(triage.has_comparison_signals) === "false") score += 8;
  if (num(triage.missing_alt) > 0) score += Math.min(18, num(triage.missing_alt));
  return Math.round(score);
}

function buildPageLedger({ triageRows, postRows, queryPageRows, productTargetMap, survivorRows, canonicalRows, categoryPriorityRows }) {
  const postByUrl = new Map(postRows.map((row) => [normalizeUrl(row.audit_url), row]));
  const postBySlug = new Map(postRows.map((row) => [row.slug, row]));
  const queryByUrl = new Map(queryPageRows.map((row) => [normalizeUrl(row.page_url), row]));
  const survivorByUrl = new Map(survivorRows.map((row) => [normalizeUrl(row.page_url), row]));
  const canonicalByUrl = new Map();
  for (const row of canonicalRows) {
    for (const url of canonicalUrls(row)) {
      if (!url) continue;
      if (!canonicalByUrl.has(url)) canonicalByUrl.set(url, []);
      canonicalByUrl.get(url).push(row);
    }
  }
  const categoryPriorityByCategory = new Map(categoryPriorityRows.map((row) => [row.category, row]));

  return triageRows.map((triage) => {
    const url = normalizeUrl(triage.url);
    const slug = triage.slug || slugFromUrl(url);
    const post = postByUrl.get(url) || postBySlug.get(slug) || {};
    const queryPressure = queryByUrl.get(url);
    const productTargets = productTargetMap.get(url) || [];
    const survivorTicket = survivorByUrl.get(url);
    const canonicalMatches = canonicalByUrl.get(url) || [];
    const categoryPriority = categoryPriorityByCategory.get(triage.category);
    const bucket = actionBucket({ triage, queryPressure, productTargets, survivorTicket, canonicalRows: canonicalMatches });
    const issues = unique([...splitList(triage.issues), ...splitList(post.issues)]);
    return {
      priority: priorityScore({ triage, queryPressure, productTargets, survivorTicket, canonicalRows: canonicalMatches, categoryPriority }),
      action_bucket: bucket,
      title: triage.title,
      url,
      slug,
      category: triage.category,
      live_status: triage.status,
      local_status: post.status || "",
      shopify_article_id: post.shopify_article_id || "",
      local_match: post.audit_match_type || "",
      ai_citability_score: triage.ai_citability_score,
      local_overall_score: post.overall_score || "",
      word_count: triage.word_count || post.word_count || "",
      product_links: triage.product_links || post.product_link_count || "",
      product_entity_targets: productTargets.length,
      benchmark_query_count: queryPressure?.query_count || "",
      zero_mention_queries: queryPressure?.zero_mention_queries || "",
      competitor_only_answers: queryPressure?.competitor_only_answers || "",
      competitors: unique([...splitList(triage.competitor_brands), ...splitList(post.competitors), ...splitList(queryPressure?.competitors)]).join("; "),
      missing_quick_answer: triage.has_quick_answer === "false" ? "yes" : "no",
      missing_faq_schema: triage.has_faq_schema === "false" ? "yes" : "no",
      missing_article_schema: triage.has_article_schema === "false" && triage.has_blogposting_schema === "false" ? "yes" : "no",
      missing_comparison: triage.has_comparison_signals === "false" ? "yes" : "no",
      missing_alt_count: triage.missing_alt,
      issues: issues.join("; "),
      canonical_or_survivor_ticket: survivorTicket?.ticket_file || canonicalMatches.map((row) => row.ticket_file || row.canonical_decision || row.type || "canonical review").join("; "),
      linked_prompts: unique([...splitList(post.linked_prompts), ...splitList(queryPressure?.retest_prompts)]).join("; "),
      next_step: triage.next_step || queryPressure?.next_action || "",
    };
  }).sort((a, b) => b.priority - a.priority);
}

function buildCategoryRows({ pageLedger, categoryPriorityRows }) {
  const priorityByCategory = new Map(categoryPriorityRows.map((row) => [row.category, row]));
  return [...groupBy(pageLedger, (row) => row.category || "unknown").entries()].map(([category, rows]) => {
    const categoryPriority = priorityByCategory.get(category) || {};
    const bucketCounts = counter(rows, (row) => [row.action_bucket]);
    const competitorCounts = counter(rows, (row) => splitList(row.competitors));
    const topIssues = counter(rows, (row) => splitList(row.issues));
    const benchmarkPages = rows.filter((row) => num(row.benchmark_query_count) > 0);
    const canonicalRows = rows.filter((row) => row.action_bucket === "canonical/consolidation review");
    const score = Math.round(
      num(categoryPriority.priority_score) +
      rows.length * 1.5 +
      rows.filter((row) => row.missing_quick_answer === "yes").length * 5 +
      rows.filter((row) => row.missing_faq_schema === "yes").length * 4 +
      benchmarkPages.length * 18 +
      canonicalRows.length * 12 +
      Math.max(0, 85 - avg(rows.map((row) => row.ai_citability_score)))
    );
    let portfolioAction = "monitor";
    if (canonicalRows.length >= 2) portfolioAction = "consolidate overlapping pages before more publishing";
    else if (benchmarkPages.length) portfolioAction = "refresh benchmark-pressure pages first";
    else if (rows.filter((row) => row.missing_quick_answer === "yes" || row.missing_faq_schema === "yes").length >= rows.length / 2) portfolioAction = "run citation-readiness schema pass";
    return {
      portfolio_priority: score,
      category,
      live_pages: rows.length,
      avg_citability_score: avg(rows.map((row) => row.ai_citability_score)),
      benchmark_pressure_pages: benchmarkPages.length,
      canonical_review_pages: canonicalRows.length,
      missing_quick_answer_pages: rows.filter((row) => row.missing_quick_answer === "yes").length,
      missing_faq_pages: rows.filter((row) => row.missing_faq_schema === "yes").length,
      missing_comparison_pages: rows.filter((row) => row.missing_comparison === "yes").length,
      product_entity_targets: rows.reduce((sum, row) => sum + num(row.product_entity_targets), 0),
      top_competitors: competitorCounts.slice(0, 8).map((item) => `${item.name} ${item.count}`).join("; "),
      top_issues: topIssues.slice(0, 8).map((item) => `${item.name} ${item.count}`).join("; "),
      action_mix: bucketCounts.map((item) => `${item.name} ${item.count}`).join("; "),
      benchmark_priority_score: categoryPriority.priority_score || "",
      portfolio_action: portfolioAction,
    };
  }).sort((a, b) => b.portfolio_priority - a.portfolio_priority);
}

function buildGapRows({ categoryRows, contentGapRows }) {
  const gapByCategory = new Map();
  for (const gap of contentGapRows) {
    const category = gap.category || gap.topic || "unknown";
    if (!gapByCategory.has(category)) gapByCategory.set(category, []);
    gapByCategory.get(category).push(gap);
  }
  return categoryRows.map((row) => {
    const gaps = gapByCategory.get(row.category) || [];
    const condition = [];
    if (num(row.benchmark_pressure_pages) > 0 && num(row.missing_quick_answer_pages) > 0) condition.push("benchmark pressure with missing quick answers");
    if (num(row.canonical_review_pages) > 1) condition.push("duplicate/canonical risk");
    if (num(row.product_entity_targets) > 10) condition.push("many product module opportunities");
    if (num(row.avg_citability_score) < 78) condition.push("below target citability");
    if (gaps.length) condition.push(`${gaps.length} future content-gap briefs`);
    return {
      category: row.category,
      portfolio_priority: row.portfolio_priority,
      condition: condition.join("; ") || "monitor",
      existing_pages: row.live_pages,
      avg_citability_score: row.avg_citability_score,
      benchmark_pressure_pages: row.benchmark_pressure_pages,
      content_gap_briefs: gaps.length,
      first_gap_titles: gaps.map((gap) => gap.title || gap.primaryKeyword || gap.query).filter(Boolean).slice(0, 5).join("; "),
      recommended_move: row.portfolio_action,
    };
  }).sort((a, b) => b.portfolio_priority - a.portfolio_priority);
}

function barSvg({ title, rows, labelKey, valueKey, maxValue, color = "#1d4ed8" }) {
  const width = 940;
  const rowHeight = 34;
  const topOffset = 56;
  const height = topOffset + rows.length * rowHeight + 24;
  const labelWidth = 360;
  const barWidth = 420;
  const max = maxValue || Math.max(1, ...rows.map((row) => num(row[valueKey])));
  const bars = rows.map((row, index) => {
    const value = num(row[valueKey]);
    const y = topOffset + index * rowHeight;
    const w = Math.max(2, Math.round((value / max) * barWidth));
    return `<text x="22" y="${y + 16}" fill="#0f172a" font-size="13">${escapeHtml(row[labelKey]).slice(0, 54)}</text>
<rect x="${labelWidth}" y="${y}" width="${barWidth}" height="20" rx="4" fill="#e2e8f0"/>
<rect x="${labelWidth}" y="${y}" width="${w}" height="20" rx="4" fill="${color}"/>
<text x="${labelWidth + barWidth + 12}" y="${y + 15}" fill="#0f172a" font-size="13" font-weight="700">${escapeHtml(value)}</text>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="#ffffff"/>
<text x="22" y="34" fill="#0f172a" font-size="22" font-weight="800">${escapeHtml(title)}</text>
${bars}
</svg>`;
}

function table(rows, columns) {
  const head = columns.map(([label]) => `<th>${escapeHtml(label)}</th>`).join("");
  const body = rows.map((row) => `<tr>${columns.map(([, key]) => `<td>${escapeHtml(row[key])}</td>`).join("")}</tr>`).join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function markdownTable(rows, columns) {
  return [
    `| ${columns.map(([label]) => label).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${columns.map(([, key]) => String(row[key] ?? "").replaceAll("|", "\\|")).join(" | ")} |`),
  ].join("\n");
}

function buildMarkdown({ summary, pageLedger, categoryRows, gapRows }) {
  return `# iBOLT Blog Portfolio Coverage Map

## Bottom Line

This report treats the live Shopify sitemap as the page universe, then joins local app inventory, benchmark pressure, product entity targets, and canonical risk. It covers ${summary.livePages} live pages, ${summary.localMatchedPages} matched local/app posts, ${summary.benchmarkPressurePages} pages with benchmark-query pressure, and ${summary.canonicalReviewPages} pages that need canonical or consolidation review.

The portfolio is not missing content volume. The larger issues are duplicate/canonical cleanup, citation-readiness, exact product modules, and competitor comparison framing on the pages that already map to buyer prompts.

## Portfolio KPIs

- Live pages audited: ${summary.livePages}.
- Average live citability score: ${summary.avgCitabilityScore}/100.
- Pages missing quick answers: ${summary.missingQuickAnswerPages}.
- Pages missing FAQ schema: ${summary.missingFaqPages}.
- Pages missing comparison signals: ${summary.missingComparisonPages}.
- Pages with benchmark pressure: ${summary.benchmarkPressurePages}.
- Pages with product entity targets: ${summary.productTargetPages}.
- Canonical/consolidation review pages: ${summary.canonicalReviewPages}.

## Topic Portfolio Priorities

${markdownTable(categoryRows.slice(0, 12), [
  ["Priority", "portfolio_priority"],
  ["Category", "category"],
  ["Pages", "live_pages"],
  ["Avg score", "avg_citability_score"],
  ["Benchmark pages", "benchmark_pressure_pages"],
  ["Canonical pages", "canonical_review_pages"],
  ["Top competitors", "top_competitors"],
  ["Move", "portfolio_action"],
])}

## First Pages To Work

${markdownTable(pageLedger.slice(0, 14), [
  ["Priority", "priority"],
  ["Action", "action_bucket"],
  ["Title", "title"],
  ["Category", "category"],
  ["Score", "ai_citability_score"],
  ["Benchmark queries", "benchmark_query_count"],
  ["Product targets", "product_entity_targets"],
  ["Issues", "issues"],
])}

## Coverage Gaps By Topic

${markdownTable(gapRows.slice(0, 12), [
  ["Priority", "portfolio_priority"],
  ["Category", "category"],
  ["Condition", "condition"],
  ["Existing pages", "existing_pages"],
  ["Gap briefs", "content_gap_briefs"],
  ["Recommended move", "recommended_move"],
])}
`;
}

function buildHtml({ summary, pageLedger, categoryRows, gapRows, charts }) {
  const cards = [
    ["Live pages", summary.livePages, "Shopify sitemap pages"],
    ["Avg score", `${summary.avgCitabilityScore}/100`, "AI citability"],
    ["Benchmark pages", summary.benchmarkPressurePages, "mapped to tested prompts"],
    ["Canonical review", summary.canonicalReviewPages, "pages to consolidate/review"],
    ["Missing FAQ", summary.missingFaqPages, "live pages"],
    ["Product targets", summary.productTargetPages, "pages with modules"],
  ].map(([label, value, note]) => `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>iBOLT Blog Portfolio Coverage Map</title>
<style>
body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}main{max-width:1240px;margin:0 auto;padding:34px 26px 60px}h1{font-size:34px;margin:0 0 8px}h2{font-size:22px;margin:34px 0 14px}p{color:#334155;line-height:1.55}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}.k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700}.v{font-size:30px;font-weight:800;margin-top:8px}.note{border-left:6px solid #ea580c;background:#fff;border-radius:10px;padding:16px 18px;border-top:1px solid #d7dee8;border-right:1px solid #d7dee8;border-bottom:1px solid #d7dee8}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden}th,td{text-align:left;vertical-align:top;padding:11px 12px;border-bottom:1px solid #edf2f7;font-size:14px}th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:12px;letter-spacing:.04em}.charts{display:grid;grid-template-columns:1fr;gap:18px}.chart{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:12px;overflow:auto}
</style></head><body><main>
<h1>iBOLT Blog Portfolio Coverage Map</h1>
<p class="note"><strong>Readout:</strong> The blog portfolio has enough raw volume. The next gains are from cleaning overlap, adding answer/schema structure, and concentrating product modules on benchmark-pressure pages.</p>
<section class="cards">${cards}</section>
<section class="charts"><div class="chart">${charts.categories}</div><div class="chart">${charts.pages}</div></section>
<h2>Topic Portfolio Priorities</h2>
${table(categoryRows.slice(0, 14), [
  ["Priority", "portfolio_priority"],
  ["Category", "category"],
  ["Pages", "live_pages"],
  ["Avg score", "avg_citability_score"],
  ["Benchmark pages", "benchmark_pressure_pages"],
  ["Canonical pages", "canonical_review_pages"],
  ["Top competitors", "top_competitors"],
  ["Top issues", "top_issues"],
  ["Move", "portfolio_action"],
])}
<h2>First Pages To Work</h2>
${table(pageLedger.slice(0, 18), [
  ["Priority", "priority"],
  ["Action", "action_bucket"],
  ["Title", "title"],
  ["Category", "category"],
  ["Score", "ai_citability_score"],
  ["Benchmark queries", "benchmark_query_count"],
  ["Product targets", "product_entity_targets"],
  ["Competitors", "competitors"],
  ["Issues", "issues"],
])}
<h2>Coverage Gaps By Topic</h2>
${table(gapRows.slice(0, 14), [
  ["Priority", "portfolio_priority"],
  ["Category", "category"],
  ["Condition", "condition"],
  ["Existing pages", "existing_pages"],
  ["Avg score", "avg_citability_score"],
  ["Gap briefs", "content_gap_briefs"],
  ["First gap titles", "first_gap_titles"],
  ["Recommended move", "recommended_move"],
])}
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, "blog-portfolio-map");
  await mkdir(outDir, { recursive: true });

  const triageRows = await readCsv(path.join(benchmarkDir, "live-blog-triage", "all-live-blog-triage.csv"));
  const postRows = await readCsv(path.join(benchmarkDir, "blog-inventory-audit", "post-inventory.csv"));
  const queryPageRows = await readCsv(path.join(benchmarkDir, "query-page-matrix", "page-action-matrix.csv"));
  const productRows = await readCsv(path.join(benchmarkDir, "product-entity-coverage-plan", "product-entity-work-queue.csv"));
  const survivorRows = await readCsv(path.join(benchmarkDir, "survivor-edit-tickets", "survivor-edit-ticket-index.csv"));
  const canonicalRows = await readCsv(path.join(benchmarkDir, "canonical-consolidation-plan", "canonical-consolidation-queue.csv"));
  const categoryPriorityRows = await readCsv(path.join(benchmarkDir, "visibility-scorecard", "category-priority-scorecard.csv"));
  const contentGapRows = await readCsv(path.join(benchmarkDir, "content-gap-briefs", "content-gap-briefs.csv"));

  const productTargetMap = buildTargetPageMap(productRows);
  const pageLedger = buildPageLedger({ triageRows, postRows, queryPageRows, productTargetMap, survivorRows, canonicalRows, categoryPriorityRows });
  const categoryRows = buildCategoryRows({ pageLedger, categoryPriorityRows });
  const gapRows = buildGapRows({ categoryRows, contentGapRows });
  const summary = {
    benchmarkDir,
    livePages: triageRows.length,
    localPosts: postRows.length,
    localMatchedPages: pageLedger.filter((row) => row.local_status).length,
    avgCitabilityScore: avg(pageLedger.map((row) => row.ai_citability_score)),
    missingQuickAnswerPages: pageLedger.filter((row) => row.missing_quick_answer === "yes").length,
    missingFaqPages: pageLedger.filter((row) => row.missing_faq_schema === "yes").length,
    missingComparisonPages: pageLedger.filter((row) => row.missing_comparison === "yes").length,
    benchmarkPressurePages: pageLedger.filter((row) => num(row.benchmark_query_count) > 0).length,
    productTargetPages: pageLedger.filter((row) => num(row.product_entity_targets) > 0).length,
    canonicalReviewPages: pageLedger.filter((row) => row.action_bucket === "canonical/consolidation review").length,
    categoryRows: categoryRows.length,
    gapRows: gapRows.length,
  };
  const charts = {
    categories: barSvg({ title: "Topic Portfolio Priority", rows: categoryRows.slice(0, 10), labelKey: "category", valueKey: "portfolio_priority", color: "#ea580c" }),
    pages: barSvg({ title: "First Pages To Work", rows: pageLedger.slice(0, 10), labelKey: "title", valueKey: "priority", color: "#2563eb" }),
  };

  await writeFile(path.join(outDir, "blog-page-portfolio-ledger.csv"), csv([
    ["priority", "action_bucket", "title", "url", "slug", "category", "live_status", "local_status", "shopify_article_id", "local_match", "ai_citability_score", "local_overall_score", "word_count", "product_links", "product_entity_targets", "benchmark_query_count", "zero_mention_queries", "competitor_only_answers", "competitors", "missing_quick_answer", "missing_faq_schema", "missing_article_schema", "missing_comparison", "missing_alt_count", "issues", "canonical_or_survivor_ticket", "linked_prompts", "next_step"],
    ...pageLedger.map((row) => [row.priority, row.action_bucket, row.title, row.url, row.slug, row.category, row.live_status, row.local_status, row.shopify_article_id, row.local_match, row.ai_citability_score, row.local_overall_score, row.word_count, row.product_links, row.product_entity_targets, row.benchmark_query_count, row.zero_mention_queries, row.competitor_only_answers, row.competitors, row.missing_quick_answer, row.missing_faq_schema, row.missing_article_schema, row.missing_comparison, row.missing_alt_count, row.issues, row.canonical_or_survivor_ticket, row.linked_prompts, row.next_step]),
  ]));
  await writeFile(path.join(outDir, "topic-portfolio-scorecard.csv"), csv([
    ["portfolio_priority", "category", "live_pages", "avg_citability_score", "benchmark_pressure_pages", "canonical_review_pages", "missing_quick_answer_pages", "missing_faq_pages", "missing_comparison_pages", "product_entity_targets", "top_competitors", "top_issues", "action_mix", "benchmark_priority_score", "portfolio_action"],
    ...categoryRows.map((row) => [row.portfolio_priority, row.category, row.live_pages, row.avg_citability_score, row.benchmark_pressure_pages, row.canonical_review_pages, row.missing_quick_answer_pages, row.missing_faq_pages, row.missing_comparison_pages, row.product_entity_targets, row.top_competitors, row.top_issues, row.action_mix, row.benchmark_priority_score, row.portfolio_action]),
  ]));
  await writeFile(path.join(outDir, "topic-coverage-gap-map.csv"), csv([
    ["portfolio_priority", "category", "condition", "existing_pages", "avg_citability_score", "benchmark_pressure_pages", "content_gap_briefs", "first_gap_titles", "recommended_move"],
    ...gapRows.map((row) => [row.portfolio_priority, row.category, row.condition, row.existing_pages, row.avg_citability_score, row.benchmark_pressure_pages, row.content_gap_briefs, row.first_gap_titles, row.recommended_move]),
  ]));
  await writeFile(path.join(outDir, "blog-portfolio-data.json"), `${JSON.stringify({ summary, pageLedger: pageLedger.slice(0, 120), categoryRows, gapRows }, null, 2)}\n`);
  await writeFile(path.join(outDir, "topic-portfolio-priority.svg"), charts.categories);
  await writeFile(path.join(outDir, "first-pages-to-work.svg"), charts.pages);
  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown({ summary, pageLedger, categoryRows, gapRows }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({ summary, pageLedger, categoryRows, gapRows, charts }));

  console.log(`Wrote ${outDir}`);
  console.log(`Portfolio pages: ${pageLedger.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
