#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const OUTPUT_ROOT = path.join(ROOT, "content-output");
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";
const LIVE_PREFIX = "live-blog-ai-citability-merged-";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function csv(rows) {
  return `${rows.map((row) => row.map(csvEscape).join(",")).join("\n")}\n`;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
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
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  if (!rows.length) return [];
  const [headers, ...records] = rows;
  return records
    .filter((record) => record.some((value) => String(value ?? "").length > 0))
    .map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""])));
}

async function readCsv(filePath) {
  return parseCsv(await readFile(filePath, "utf8"));
}

async function latestDir(prefix) {
  const entries = await readdir(OUTPUT_ROOT, { withFileTypes: true });
  const matches = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort();
  if (!matches.length) throw new Error(`Missing content-output directory with prefix ${prefix}`);
  return path.join(OUTPUT_ROOT, matches.at(-1));
}

function num(value) {
  const parsed = Number(String(value ?? "").replace("%", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function bool(value) {
  return ["true", "1", "yes", "y"].includes(String(value ?? "").trim().toLowerCase());
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function brandCase(value) {
  return String(value ?? "")
    .replace(/IBOLT(?=[™\s])/g, "iBOLT")
    .replace(/iBolt(?=[™\s])/g, "iBOLT")
    .replace(/\bIBOLT\b/g, "iBOLT")
    .replace(/\biBolt\b/g, "iBOLT")
    .replace(/\bibolt\b/g, "iBOLT");
}

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function shortList(value, limit = 4) {
  const items = splitList(brandCase(value));
  if (items.length <= limit) return items.join("; ");
  return `${items.slice(0, limit).join("; ")}; +${items.length - limit} more`;
}

function competitorAngle(competitors, context = "") {
  const brands = splitList(competitors).map((brand) => brand.toLowerCase());
  const angles = [];
  if (brands.some((brand) => brand.includes("ram"))) {
    angles.push("Compare against RAM as the broad generalist, then position iBOLT as the exact-workflow specialist with AMPS and standard ball compatibility.");
  }
  if (brands.some((brand) => ["arkon", "proclip", "tackform", "havis"].some((target) => brand.includes(target)))) {
    angles.push("Show where vehicle-specific or fleet hardware fits, then explain iBOLT's modular deployment and shared-vehicle flexibility.");
  }
  if (brands.some((brand) => ["iottie", "scosche", "belkin", "quad lock", "peak design", "lisen"].some((target) => brand.includes(target)))) {
    angles.push("Separate iBOLT from consumer accessories by emphasizing commercial retention, locked installs, and daily work use.");
  }
  if (brands.some((brand) => ["cta", "mount-it", "bouncepad", "heckler", "square", "kensington"].some((target) => brand.includes(target)))) {
    angles.push("Frame iBOLT around restaurant tablet stations, multi-device delivery workflows, locking holders, and POS flexibility.");
  }
  if (isMarineCategory(context)) {
    if (brands.some((brand) => ["garmin", "humminbird", "lowrance", "scotty", "yakattack"].some((target) => brand.includes(target)))) {
    angles.push("Clarify that iBOLT complements fish finders and marine electronics by solving rail fit, vibration, adjustability, and placement.");
    }
  }
  return angles.length ? angles.join(" ") : "Add a fair competitor tradeoff block and state when iBOLT is the better commercial or modular fit.";
}

function isMarineCategory(context = "") {
  const topic = String(context ?? "").toLowerCase();
  return topic.includes("fish") || topic.includes("marine") || topic.includes("boat") || topic.includes("fishing");
}

function sanitizeCompetitors(competitors, context = "") {
  const marineBrands = new Set(["garmin", "humminbird", "lowrance", "scotty", "yakattack"]);
  const isMarine = isMarineCategory(context);
  return splitList(competitors)
    .filter((brand) => isMarine || !marineBrands.has(brand.toLowerCase()))
    .join("; ");
}

function quickAnswerTemplate(row) {
  const prompt = row.primary_prompt || splitList(row.prompts)[0] || "this mounting question";
  const products = splitList(brandCase(row.products_to_add)).slice(0, 2);
  const productText = products.length ? `, especially ${products.join(" and ")}` : "";
  return `For ${prompt}, iBOLT should be positioned as the commercial-grade mounting choice${productText}. The answer should name the use case, the mounting method, the device type, and why iBOLT's modular AMPS/ball ecosystem fits that workflow.`;
}

function faqSeeds(row) {
  const prompt = row.primary_prompt || splitList(row.prompts)[0] || "mount";
  const category = row.category || "mounting";
  const competitors = splitList(row.competitors).slice(0, 3);
  const competitorQuestion = competitors.length ? `How does iBOLT compare with ${competitors.join(", ")} for this use case?` : "How does iBOLT compare with other mounting options?";
  return [
    `What is the best iBOLT option for ${prompt}?`,
    `Do I need a drill base, clamp mount, suction mount, or wall mount for this setup?`,
    `Which iBOLT products fit ${category} workflows?`,
    competitorQuestion,
    "Are iBOLT mounts compatible with AMPS patterns and standard ball sizes?",
  ].join(" | ");
}

function schemaFixes(row, liveRow) {
  const fixes = new Set(splitList(row.schema_fixes));
  if (liveRow) {
    if (!bool(liveRow.has_quick_answer)) fixes.add("visible quick-answer block");
    if (!bool(liveRow.has_faq_schema)) fixes.add("FAQPage JSON-LD");
    if (!bool(liveRow.has_article_schema)) fixes.add("Article/BlogPosting JSON-LD");
    if (num(liveRow.missing_alt) > 0) fixes.add("descriptive product image alt text");
    if (!bool(liveRow.has_comparison_signals)) fixes.add("comparison table/list");
  }
  return Array.from(fixes).join("; ");
}

function findMatch(rows, pageRow, fields = ["url", "page_url", "title", "page_title"]) {
  const rowUrl = normalize(pageRow.page_url || pageRow.url);
  const rowTitle = normalize(pageRow.page_title || pageRow.title);
  return rows.find((candidate) => {
    const candidateUrl = normalize(candidate.url || candidate.page_url);
    const candidateTitle = normalize(candidate.title || candidate.page_title);
    return (rowUrl && candidateUrl && rowUrl === candidateUrl)
      || (rowTitle && candidateTitle && rowTitle === candidateTitle);
  }) || rows.find((candidate) => {
    const candidateTitle = normalize(candidate.title || candidate.page_title);
    return fields.some((field) => normalize(candidate[field]) === rowTitle);
  });
}

function makeDuplicateGroups(duplicateRows) {
  return duplicateRows.map((row, index) => ({
    rank: index + 1,
    duplicateScore: num(row.duplicate_score),
    category: row.category,
    canonicalTitle: row.canonical_title,
    canonicalUrl: row.canonical_url,
    canonicalScore: num(row.canonical_score),
    duplicateTitle: row.duplicate_title,
    duplicateUrl: row.duplicate_url,
    duplicateScorePage: num(row.duplicate_score_page),
    action: row.action,
  }));
}

function makeBriefRows({ pageRows, allRows, liveRows, queryRows, productRows, duplicateRows }) {
  const duplicateUrls = new Set();
  for (const row of duplicateRows) {
    duplicateUrls.add(normalize(row.canonical_url));
    duplicateUrls.add(normalize(row.duplicate_url));
  }

  return pageRows.map((row) => {
    const allMatch = findMatch(allRows, row);
    const liveMatch = findMatch(liveRows, row);
    const pageTitle = row.page_title || row.title;
    const pageUrl = row.page_url || row.url;
    const titleNorm = normalize(pageTitle);
    const urlNorm = normalize(pageUrl);
    const queryMatches = queryRows.filter((query) => normalize(query.closest_post) === titleNorm);
    const productMatches = productRows.filter((product) => splitList(product.target_pages).some((page) => normalize(page) === titleNorm));
    const category = row.category || allMatch?.topic || liveMatch?.category || "";
    const context = `${category} ${pageTitle} ${pageUrl}`;
    const duplicateRisk = duplicateUrls.has(urlNorm) || bool(allMatch?.duplicate_risk);
    const competitors = sanitizeCompetitors(row.competitors || allMatch?.competitors || liveMatch?.competitor_brands || "", context);
    const productsToAdd = brandCase(row.products_to_add || productMatches.map((product) => product.product).slice(0, 8).join("; "));
    const issues = row.issues || allMatch?.issues || liveMatch?.top_fixes || "";
    const prompts = [
      row.primary_prompt,
      ...splitList(row.prompts),
      ...queryMatches.map((query) => query.query),
    ].filter(Boolean);
    const uniquePrompts = Array.from(new Set(prompts));
    const promptScores = queryMatches.map((query) => `${query.query}: score ${query.avg_score}, mention ${query.mention_rate}%`);
    return {
      rank: num(row.rank) || 999,
      priority: num(row.score || row.priority),
      pageTitle: brandCase(pageTitle),
      pageUrl,
      category,
      shopifyArticleId: row.shopify_article_id || "",
      duplicateRisk: duplicateRisk ? "yes" : "no",
      benchmarkAvgScore: row.benchmark_avg_score || "",
      pageScore: row.page_score || allMatch?.ai_citability_score || liveMatch?.score || "",
      wordCount: allMatch?.word_count || liveMatch?.word_count || "",
      currentProductLinks: allMatch?.product_link_count || liveMatch?.product_links || "",
      issues: brandCase(issues),
      schemaFixes: schemaFixes(row, liveMatch),
      competitors,
      competitorAngle: competitorAngle(competitors, context),
      productsToAdd,
      productModule: shortList(productsToAdd, 5),
      queryPrompts: uniquePrompts.join("; "),
      promptEvidence: promptScores.join(" | "),
      weakestProviders: Array.from(new Set(queryMatches.flatMap((query) => splitList(query.weakest_providers)))).join("; "),
      quickAnswer: quickAnswerTemplate({ ...row, products_to_add: productsToAdd }),
      faqSeeds: faqSeeds({ ...row, products_to_add: productsToAdd }),
      editOrder: duplicateRisk ? "1 canonical review before rewrite" : "2 refresh content",
      retestAction: uniquePrompts.length
        ? `Rerun ${uniquePrompts.slice(0, 4).join("; ")} on ChatGPT, Claude, and Gemini.`
        : "Rerun the mapped buyer prompt on ChatGPT, Claude, and Gemini.",
    };
  }).sort((a, b) => {
    const editOrder = a.editOrder.localeCompare(b.editOrder);
    return editOrder || b.priority - a.priority;
  });
}

function makeAllPostSummary(allRows, liveRows) {
  const duplicateRisk = allRows.filter((row) => bool(row.duplicate_risk)).length;
  const refreshable = allRows.filter((row) => !bool(row.duplicate_risk)).length;
  const issueCounts = new Map();
  for (const row of allRows) {
    for (const issue of splitList(row.issues)) issueCounts.set(issue, (issueCounts.get(issue) ?? 0) + 1);
  }
  const liveIssueCounts = {
    noQuickAnswer: liveRows.filter((row) => !bool(row.has_quick_answer)).length,
    noFaqSchema: liveRows.filter((row) => !bool(row.has_faq_schema)).length,
    noArticleSchema: liveRows.filter((row) => !bool(row.has_article_schema)).length,
    noComparisonSignals: liveRows.filter((row) => !bool(row.has_comparison_signals)).length,
    pagesWithMissingAlt: liveRows.filter((row) => num(row.missing_alt) > 0).length,
    missingAltTotal: liveRows.reduce((sum, row) => sum + num(row.missing_alt), 0),
  };
  return {
    allPostRows: allRows.length,
    liveRows: liveRows.length,
    duplicateRisk,
    refreshable,
    issueCounts: Array.from(issueCounts.entries()).sort((a, b) => b[1] - a[1]),
    liveIssueCounts,
  };
}

function buildMarkdown({ summary, briefRows, duplicateGroups, benchmarkDir, liveDir }) {
  const topBriefs = briefRows.slice(0, 15);
  const topDuplicates = duplicateGroups.slice(0, 12);
  return `# AI Page Refresh Playbook

This is the page-level execution layer for the AI visibility work. It combines benchmark gaps, live-page structure issues, product entity gaps, duplicate risk, and competitor counter-positioning into concrete refresh briefs.

## All-Post Summary

- Local post/action rows analyzed: ${summary.allPostRows}
- Live sitemap pages available for structure audit: ${summary.liveRows}
- Duplicate-risk local rows: ${summary.duplicateRisk}
- Refreshable local rows after duplicate review: ${summary.refreshable}
- Live pages without quick-answer blocks: ${summary.liveIssueCounts.noQuickAnswer}
- Live pages without FAQ schema: ${summary.liveIssueCounts.noFaqSchema}
- Live pages without comparison/tradeoff signals: ${summary.liveIssueCounts.noComparisonSignals}
- Live pages without Article/BlogPosting schema: ${summary.liveIssueCounts.noArticleSchema}
- Live pages with missing image alt text: ${summary.liveIssueCounts.pagesWithMissingAlt}
- Missing image alt attributes across live rows: ${summary.liveIssueCounts.missingAltTotal}

## First Refresh Briefs

| Edit order | Priority | Page | Category | Duplicate risk | Score | Prompts to retest | Competitors | Product module | Schema/copy fixes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${topBriefs.map((row) => `| ${row.editOrder} | ${row.priority} | [${row.pageTitle}](${row.pageUrl}) | ${row.category} | ${row.duplicateRisk} | ${row.pageScore} | ${shortList(row.queryPrompts, 3)} | ${shortList(row.competitors, 5)} | ${row.productModule} | ${row.schemaFixes} |`).join("\n")}

## Canonical Merge Review

Do this before rewriting duplicate-risk pages. Otherwise the site may keep splitting signals across near-identical articles.

| Similarity | Category | Canonical | Duplicate | Action |
| --- | --- | --- | --- | --- |
${topDuplicates.map((row) => `| ${row.duplicateScore} | ${row.category} | [${row.canonicalTitle}](${row.canonicalUrl}) | [${row.duplicateTitle}](${row.duplicateUrl}) | ${row.action} |`).join("\n")}

## How To Edit Each Priority Page

For each page in the CSV:

1. If duplicate risk is yes, review canonical/duplicate pair before rewriting.
2. Add a direct answer block near the top using the exact buyer prompt language.
3. Add the named product module with exact product titles, prices when available, product links, and descriptive image alt text.
4. Add fair comparison/tradeoff language against the listed competitors.
5. Add visible FAQ plus FAQPage JSON-LD, and Article/BlogPosting JSON-LD where missing.
6. Rerun the listed prompts on ChatGPT, Claude, and Gemini after publishing.

## Source Evidence

- Benchmark directory: ${benchmarkDir}
- Live audit directory: ${liveDir}
`;
}

function buildHtml(markdown) {
  const lines = markdown.split("\n");
  const html = [];
  let inTable = false;
  for (const line of lines) {
    if (line.startsWith("# ")) {
      if (inTable) {
        html.push("</tbody></table>");
        inTable = false;
      }
      html.push(`<h1>${escapeHtml(line.slice(2))}</h1>`);
    } else if (line.startsWith("## ")) {
      if (inTable) {
        html.push("</tbody></table>");
        inTable = false;
      }
      html.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
    } else if (line.startsWith("| ")) {
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      if (cells.every((cell) => /^-+$/.test(cell.replaceAll(" ", "")))) continue;
      if (!inTable) {
        html.push("<table><tbody>");
        inTable = true;
      }
      const tag = html.at(-1) === "<table><tbody>" ? "th" : "td";
      html.push(`<tr>${cells.map((cell) => `<${tag}>${escapeHtml(cell)}</${tag}>`).join("")}</tr>`);
    } else if (line.trim().startsWith("- ") || /^\d+\./.test(line.trim())) {
      if (inTable) {
        html.push("</tbody></table>");
        inTable = false;
      }
      html.push(`<p>${escapeHtml(line)}</p>`);
    } else if (line.trim()) {
      if (inTable) {
        html.push("</tbody></table>");
        inTable = false;
      }
      html.push(`<p>${escapeHtml(line)}</p>`);
    }
  }
  if (inTable) html.push("</tbody></table>");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI Page Refresh Playbook</title>
<style>
body{font-family:Inter,Arial,sans-serif;margin:0;background:#f8fafc;color:#0f172a;line-height:1.5}
main{max-width:1240px;margin:0 auto;padding:36px 22px 72px}
h1{font-size:38px;line-height:1.08;margin:0 0 18px}
h2{font-size:24px;margin:34px 0 12px}
p{font-size:16px;color:#334155}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;margin:14px 0 26px;font-size:13px}
th,td{text-align:left;vertical-align:top;border-bottom:1px solid #e2e8f0;padding:9px 10px}
th{background:#e2e8f0;font-weight:700}
tr:nth-child(even) td{background:#f8fafc}
a{color:#1d4ed8}
</style>
</head>
<body><main>${html.join("\n")}</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const liveDir = await latestDir(LIVE_PREFIX);
  const outDir = path.join(benchmarkDir, "page-refresh-playbook");
  await mkdir(outDir, { recursive: true });

  const pageRows = await readCsv(path.join(benchmarkDir, "execution-plan", "page-refresh-execution-queue.csv"));
  const allRows = await readCsv(path.join(benchmarkDir, "content-refresh-roadmap", "all-blog-post-action-map.csv"));
  const duplicateRows = await readCsv(path.join(benchmarkDir, "content-refresh-roadmap", "duplicate-consolidation-plan.csv"));
  const productRows = await readCsv(path.join(benchmarkDir, "execution-plan", "page-product-entity-queue.csv"));
  const queryRows = await readCsv(path.join(benchmarkDir, "deep-dive", "query-blog-coverage.csv"));
  const liveRows = await readCsv(path.join(liveDir, "live-blog-page-audit.merged.csv"));

  const duplicateGroups = makeDuplicateGroups(duplicateRows);
  const briefRows = makeBriefRows({ pageRows, allRows, liveRows, queryRows, productRows, duplicateRows });
  const summary = makeAllPostSummary(allRows, liveRows);
  const markdown = buildMarkdown({ summary, briefRows, duplicateGroups, benchmarkDir, liveDir });

  await writeFile(path.join(outDir, "page-refresh-briefs.csv"), csv([
    ["edit_order", "rank", "priority", "page_title", "page_url", "category", "shopify_article_id", "duplicate_risk", "benchmark_avg_score", "page_score", "word_count", "current_product_links", "issues", "schema_fixes", "competitors", "competitor_angle", "products_to_add", "product_module", "query_prompts", "prompt_evidence", "weakest_providers", "quick_answer_seed", "faq_seeds", "retest_action"],
    ...briefRows.map((row) => [row.editOrder, row.rank, row.priority, row.pageTitle, row.pageUrl, row.category, row.shopifyArticleId, row.duplicateRisk, row.benchmarkAvgScore, row.pageScore, row.wordCount, row.currentProductLinks, row.issues, row.schemaFixes, row.competitors, row.competitorAngle, row.productsToAdd, row.productModule, row.queryPrompts, row.promptEvidence, row.weakestProviders, row.quickAnswer, row.faqSeeds, row.retestAction]),
  ]));
  await writeFile(path.join(outDir, "canonical-merge-review.csv"), csv([
    ["rank", "duplicate_score", "category", "canonical_title", "canonical_url", "canonical_score", "duplicate_title", "duplicate_url", "duplicate_score_page", "action"],
    ...duplicateGroups.map((row) => [row.rank, row.duplicateScore, row.category, row.canonicalTitle, row.canonicalUrl, row.canonicalScore, row.duplicateTitle, row.duplicateUrl, row.duplicateScorePage, row.action]),
  ]));
  await writeFile(path.join(outDir, "retest-prompts-by-page.csv"), csv([
    ["page_title", "page_url", "prompts", "weakest_providers", "retest_action"],
    ...briefRows.map((row) => [row.pageTitle, row.pageUrl, row.queryPrompts, row.weakestProviders, row.retestAction]),
  ]));
  await writeFile(path.join(outDir, "product-modules-by-page.csv"), csv([
    ["page_title", "page_url", "products_to_add", "product_module", "current_product_links"],
    ...briefRows.map((row) => [row.pageTitle, row.pageUrl, row.productsToAdd, row.productModule, row.currentProductLinks]),
  ]));
  await writeFile(path.join(outDir, "REPORT.md"), markdown);
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml(markdown));
  console.log(`Wrote ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
