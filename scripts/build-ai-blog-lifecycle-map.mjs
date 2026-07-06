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

async function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
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
  return total ? Math.round((Number(count || 0) / Number(total || 1)) * 100) : 0;
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

function normalizeUrl(value) {
  return String(value ?? "").replace(/\/+$/, "");
}

function slugFromUrl(value) {
  return normalizeUrl(value).split("/").pop() || "";
}

function bucketLabel(bucket) {
  return ({
    protect_amplify: "Protect and amplify",
    benchmark_refresh: "Benchmark refresh",
    canonical_decision: "Canonical decision",
    citation_schema_cleanup: "Citation/schema cleanup",
    legacy_rewrite: "Legacy rewrite",
    retire_noindex_candidate: "Retire/noindex candidate",
  })[bucket] || bucket;
}

function lifecycleBucket({ portfolio, triage }) {
  const score = num(portfolio.ai_citability_score || triage.ai_citability_score);
  const productTargets = num(portfolio.product_entity_targets);
  const productLinks = num(portfolio.product_links || triage.product_links);
  const benchmarkQueries = num(portfolio.benchmark_query_count);
  const competitorOnly = num(portfolio.competitor_only_answers);
  const issues = `${portfolio.issues || ""}; ${triage.issues || ""}`.toLowerCase();
  const portfolioAction = String(portfolio.action_bucket || "").toLowerCase();
  const triageAction = String(triage.action || "").toLowerCase();
  const hasCanonicalTicket = Boolean(String(portfolio.canonical_or_survivor_ticket || "").trim());
  const hasCanonicalWork =
    portfolioAction.includes("canonical") ||
    portfolioAction.includes("consolidation") ||
    triageAction.includes("canonical") ||
    triageAction.includes("duplicate") ||
    hasCanonicalTicket;
  const hasBenchmarkPressure = benchmarkQueries > 0 || competitorOnly > 0;
  const missingStructure =
    String(portfolio.missing_quick_answer) === "true" ||
    String(portfolio.missing_faq_schema) === "true" ||
    String(portfolio.missing_article_schema) === "true" ||
    String(portfolio.missing_comparison) === "true" ||
    num(portfolio.missing_alt_count || triage.missing_alt) > 0 ||
    issues.includes("schema") ||
    issues.includes("quick answer") ||
    issues.includes("comparison");

  if (hasCanonicalWork) return "canonical_decision";
  if (score >= 80 && triageAction.includes("keep and monitor")) return "protect_amplify";
  if (score >= 90 && !hasBenchmarkPressure && productLinks > 0 && !String(portfolio.missing_faq_schema).includes("true")) {
    return "protect_amplify";
  }
  if (score <= 55 && !hasBenchmarkPressure && productTargets === 0 && productLinks <= 1) {
    return "retire_noindex_candidate";
  }
  if (hasBenchmarkPressure) return "benchmark_refresh";
  if (score < 68 || triageAction.includes("full refresh") || triageAction.includes("priority refresh")) {
    return "legacy_rewrite";
  }
  if (score >= 85 && !missingStructure) return "protect_amplify";
  return "citation_schema_cleanup";
}

function lifecycleReasons({ portfolio, triage, bucket }) {
  const reasons = [];
  const score = num(portfolio.ai_citability_score || triage.ai_citability_score);
  const benchmarkQueries = num(portfolio.benchmark_query_count);
  const competitorOnly = num(portfolio.competitor_only_answers);
  const productTargets = num(portfolio.product_entity_targets);
  const productLinks = num(portfolio.product_links || triage.product_links);
  if (score) reasons.push(`citability score ${score}`);
  if (benchmarkQueries) reasons.push(`${benchmarkQueries} benchmark query${benchmarkQueries === 1 ? "" : "ies"}`);
  if (competitorOnly) reasons.push(`${competitorOnly} competitor-only answer${competitorOnly === 1 ? "" : "s"}`);
  if (productTargets) reasons.push(`${productTargets} product/entity target${productTargets === 1 ? "" : "s"}`);
  if (productLinks) reasons.push(`${productLinks} detected product link${productLinks === 1 ? "" : "s"}`);
  if (String(portfolio.missing_quick_answer) === "true") reasons.push("missing quick answer");
  if (String(portfolio.missing_faq_schema) === "true") reasons.push("missing FAQ schema");
  if (String(portfolio.missing_comparison) === "true") reasons.push("missing comparison framing");
  if (String(portfolio.missing_article_schema) === "true") reasons.push("missing article schema");
  if (num(portfolio.missing_alt_count || triage.missing_alt)) reasons.push("missing image alt text");
  if (String(portfolio.canonical_or_survivor_ticket || "").trim()) reasons.push("survivor/canonical ticket exists");
  if (bucket === "retire_noindex_candidate") reasons.push("no benchmark pressure and little product evidence, needs traffic check before action");
  return reasons.join("; ");
}

function lifecycleNextAction({ portfolio, bucket }) {
  const linkedPrompts = splitList(portfolio.linked_prompts).slice(0, 3).join("; ");
  if (bucket === "canonical_decision") {
    return "Decide survivor, merge useful sections, keep benchmark prompts, then use canonical/internal links or redirects only after human review.";
  }
  if (bucket === "benchmark_refresh") {
    return `Refresh for the mapped AI prompts${linkedPrompts ? `: ${linkedPrompts}` : ""}. Add quick answer, fair competitor comparison, exact products, FAQs, and retest.`;
  }
  if (bucket === "protect_amplify") {
    return "Keep live, add internal links from related pages, add external citation targets, and monitor after each benchmark.";
  }
  if (bucket === "legacy_rewrite") {
    return "Rewrite into an answer-first guide with product modules, FAQ/schema, updated images, and internal links to solution pages.";
  }
  if (bucket === "retire_noindex_candidate") {
    return "Do not delete yet. Check Shopify analytics, backlinks, and revenue assists first, then consider noindex, merge, or redirect.";
  }
  return "Add citable quick-answer block, FAQ schema, Article/BlogPosting schema, comparison context, product cards, and image alt text.";
}

function lifecyclePriority({ portfolio, triage, bucket }) {
  let score = num(portfolio.priority || triage.priority);
  score += num(portfolio.benchmark_query_count) * 60;
  score += num(portfolio.competitor_only_answers) * 25;
  score += num(portfolio.product_entity_targets) * 8;
  score += Math.max(0, 90 - num(portfolio.ai_citability_score || triage.ai_citability_score));
  if (bucket === "canonical_decision") score += 80;
  if (bucket === "benchmark_refresh") score += 70;
  if (bucket === "retire_noindex_candidate") score -= 35;
  return Math.round(score);
}

function buildLedger({ portfolioRows, triageRows }) {
  const triageByUrl = new Map(triageRows.map((row) => [normalizeUrl(row.url), row]));
  const triageBySlug = new Map(triageRows.map((row) => [row.slug || slugFromUrl(row.url), row]));
  return portfolioRows.map((portfolio) => {
    const url = normalizeUrl(portfolio.url);
    const triage = triageByUrl.get(url) || triageBySlug.get(portfolio.slug || slugFromUrl(url)) || {};
    const bucket = lifecycleBucket({ portfolio, triage });
    return {
      lifecycle_bucket: bucketLabel(bucket),
      bucket_key: bucket,
      priority: lifecyclePriority({ portfolio, triage, bucket }),
      title: portfolio.title || triage.title,
      url,
      slug: portfolio.slug || triage.slug || slugFromUrl(url),
      category: portfolio.category || triage.category || "uncategorized",
      ai_citability_score: num(portfolio.ai_citability_score || triage.ai_citability_score),
      word_count: num(portfolio.word_count || triage.word_count),
      product_links: num(portfolio.product_links || triage.product_links),
      product_entity_targets: num(portfolio.product_entity_targets),
      benchmark_query_count: num(portfolio.benchmark_query_count),
      competitor_only_answers: num(portfolio.competitor_only_answers),
      local_status: portfolio.local_status,
      shopify_article_id: portfolio.shopify_article_id,
      portfolio_action: portfolio.action_bucket,
      live_triage_action: triage.action,
      canonical_or_survivor_ticket: portfolio.canonical_or_survivor_ticket,
      linked_prompts: portfolio.linked_prompts,
      competitors: portfolio.competitors,
      reasons: lifecycleReasons({ portfolio, triage, bucket }),
      recommended_next_action: lifecycleNextAction({ portfolio, bucket }),
    };
  }).sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title));
}

function summarizeLedger(ledger, sourceAuthoritySummary) {
  const byBucket = [...new Set(ledger.map((row) => row.lifecycle_bucket))]
    .map((bucket) => {
      const rows = ledger.filter((row) => row.lifecycle_bucket === bucket);
      return {
        lifecycle_bucket: bucket,
        pages: rows.length,
        avg_score: avg(rows.map((row) => row.ai_citability_score)),
        benchmark_pages: rows.filter((row) => row.benchmark_query_count > 0).length,
        competitor_only_answers: rows.reduce((sum, row) => sum + num(row.competitor_only_answers), 0),
        product_targets: rows.reduce((sum, row) => sum + num(row.product_entity_targets), 0),
      };
    })
    .sort((a, b) => b.pages - a.pages || a.lifecycle_bucket.localeCompare(b.lifecycle_bucket));

  const byTopic = [...new Set(ledger.map((row) => row.category || "uncategorized"))]
    .map((category) => {
      const rows = ledger.filter((row) => (row.category || "uncategorized") === category);
      return {
        category,
        pages: rows.length,
        priority: rows.reduce((sum, row) => sum + num(row.priority), 0),
        avg_score: avg(rows.map((row) => row.ai_citability_score)),
        benchmark_pages: rows.filter((row) => row.benchmark_query_count > 0).length,
        competitor_only_answers: rows.reduce((sum, row) => sum + num(row.competitor_only_answers), 0),
        canonical_pages: rows.filter((row) => row.bucket_key === "canonical_decision").length,
        legacy_pages: rows.filter((row) => row.bucket_key === "legacy_rewrite" || row.bucket_key === "retire_noindex_candidate").length,
      };
    })
    .sort((a, b) => b.priority - a.priority || a.category.localeCompare(b.category));

  return {
    generatedAt: new Date().toISOString(),
    pages: ledger.length,
    avgCitabilityScore: avg(ledger.map((row) => row.ai_citability_score)),
    mentionRate: sourceAuthoritySummary.mentionRate || 0,
    nonBrandedMentionRate: sourceAuthoritySummary.nonBrandedMentionRate || 0,
    citationRate: sourceAuthoritySummary.citationRate || 0,
    competitorOnlyAnswers: sourceAuthoritySummary.competitorOnlyAnswers || 0,
    protectAndAmplifyPages: ledger.filter((row) => row.bucket_key === "protect_amplify").length,
    benchmarkRefreshPages: ledger.filter((row) => row.bucket_key === "benchmark_refresh").length,
    canonicalDecisionPages: ledger.filter((row) => row.bucket_key === "canonical_decision").length,
    citationSchemaCleanupPages: ledger.filter((row) => row.bucket_key === "citation_schema_cleanup").length,
    legacyRewritePages: ledger.filter((row) => row.bucket_key === "legacy_rewrite").length,
    retireNoindexCandidatePages: ledger.filter((row) => row.bucket_key === "retire_noindex_candidate").length,
    pagesWithBenchmarkPressure: ledger.filter((row) => row.benchmark_query_count > 0 || row.competitor_only_answers > 0).length,
    pagesWithProductTargets: ledger.filter((row) => row.product_entity_targets > 0).length,
    bucketRows: byBucket,
    topicRows: byTopic,
  };
}

function barSvg(rows, { title, labelKey, valueKey, width = 880, height = 360, color = "#1d4ed8" }) {
  const chartRows = rows.slice(0, 12);
  const max = Math.max(1, ...chartRows.map((row) => num(row[valueKey])));
  const left = 220;
  const right = 40;
  const top = 56;
  const rowHeight = 24;
  const gap = 9;
  const innerWidth = width - left - right;
  const svgHeight = Math.max(height, top + chartRows.length * (rowHeight + gap) + 30);
  const bars = chartRows.map((row, index) => {
    const y = top + index * (rowHeight + gap);
    const barWidth = Math.round((num(row[valueKey]) / max) * innerWidth);
    return `<text x="16" y="${y + 17}" font-size="13" fill="#334155">${escapeHtml(row[labelKey])}</text>
<rect x="${left}" y="${y}" width="${barWidth}" height="${rowHeight}" fill="${color}" rx="4"/>
<text x="${left + barWidth + 8}" y="${y + 17}" font-size="13" fill="#111827" font-weight="700">${escapeHtml(row[valueKey])}</text>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${svgHeight}" viewBox="0 0 ${width} ${svgHeight}" role="img" aria-label="${escapeHtml(title)}">
<rect width="100%" height="100%" fill="#ffffff"/>
<text x="16" y="30" font-size="20" font-weight="800" fill="#0f172a">${escapeHtml(title)}</text>
${bars}
</svg>`;
}

function buildMarkdown({ summary, ledger }) {
  const top = ledger.slice(0, 15);
  return `# iBOLT Blog Lifecycle And Citation Readiness Map

## What This Says

Yes, citation rate should be a KPI, but it is not the only visibility KPI. The current saved OpenRouter benchmark shows ${summary.mentionRate}% mention rate, ${summary.nonBrandedMentionRate}% non-branded mention rate, and ${summary.citationRate}% target-domain citation rate. That means iBOLT is sometimes being named, but models are not yet consistently treating iboltmounts.com as a source.

The right operating model is two-track:

- Get mentioned and recommended more often in non-branded answers.
- Make the strongest pages citable enough that search-connected AI systems can quote or cite them.

## Page Lifecycle Summary

- Total live pages classified: ${summary.pages}.
- Protect and amplify: ${summary.protectAndAmplifyPages}.
- Benchmark refresh: ${summary.benchmarkRefreshPages}.
- Canonical decision needed: ${summary.canonicalDecisionPages}.
- Citation/schema cleanup: ${summary.citationSchemaCleanupPages}.
- Legacy rewrite: ${summary.legacyRewritePages}.
- Retire/noindex candidates: ${summary.retireNoindexCandidatePages}.
- Pages with benchmark pressure: ${summary.pagesWithBenchmarkPressure}.
- Pages with product/entity targets: ${summary.pagesWithProductTargets}.

Do not delete or noindex any page from this report alone. Retire/noindex rows are candidates that need Shopify analytics, backlink, revenue-assist, and internal-link checks first.

## First Pages To Work

| Priority | Lifecycle | Page | Score | Benchmark queries | Competitor-only answers | Next action |
| --- | --- | --- | ---: | ---: | ---: | --- |
${top.map((row) => `| ${row.priority} | ${row.lifecycle_bucket} | [${row.title}](${row.url}) | ${row.ai_citability_score} | ${row.benchmark_query_count} | ${row.competitor_only_answers} | ${row.recommended_next_action} |`).join("\n")}

## Contractor Split

Jacob and the app should handle page structure, schema, product modules, internal links, canonical decisions, and retesting. The SEO contractor should focus on third-party citations, buyer-guide inclusion, industry mentions, review/platform listings, comparison mentions, and backlinks pointing at the pages in the protect, benchmark refresh, and solution-page groups.
`;
}

function buildHtml({ summary, ledger, bucketSvg, topicSvg, prioritySvg }) {
  const cards = [
    ["Mention rate", `${summary.mentionRate}%`, "Current saved OpenRouter baseline"],
    ["Non-branded mention", `${summary.nonBrandedMentionRate}%`, "Main growth KPI"],
    ["Citation rate", `${summary.citationRate}%`, "Needs source-authority work"],
    ["Live pages", summary.pages, `${summary.avgCitabilityScore}/100 avg citability`],
    ["Benchmark refresh", summary.benchmarkRefreshPages, "Pages tied to AI prompt pressure"],
    ["Canonical decisions", summary.canonicalDecisionPages, "Avoid duplicate/cannibalization risk"],
    ["Citation cleanup", summary.citationSchemaCleanupPages, "Schema and source-readiness work"],
    ["Legacy rewrites", summary.legacyRewritePages, "Older pages needing answer-first rebuilds"],
    ["Noindex candidates", summary.retireNoindexCandidatePages, "Review traffic before action"],
  ].map(([label, value, note]) => `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");

  const rows = ledger.slice(0, 30).map((row) => `<tr>
<td>${escapeHtml(row.priority)}</td>
<td>${escapeHtml(row.lifecycle_bucket)}</td>
<td><a href="${escapeHtml(row.url)}">${escapeHtml(row.title)}</a><div class="sub">${escapeHtml(row.category)}</div></td>
<td>${escapeHtml(row.ai_citability_score)}</td>
<td>${escapeHtml(row.benchmark_query_count)}</td>
<td>${escapeHtml(row.competitor_only_answers)}</td>
<td>${escapeHtml(row.reasons)}</td>
<td>${escapeHtml(row.recommended_next_action)}</td>
</tr>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>iBOLT Blog Lifecycle And Citation Readiness Map</title>
<style>
body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}main{max-width:1220px;margin:0 auto;padding:34px 26px 60px}h1{font-size:34px;margin:0 0 8px}h2{font-size:22px;margin:34px 0 14px}p{color:#334155;line-height:1.55}.lede{font-size:17px;max-width:980px}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}.k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700}.v{font-size:30px;font-weight:800;margin-top:8px}.chart{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:12px;margin:14px 0;overflow:auto}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden}th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}.sub{color:#64748b;font-size:12px;margin-top:4px}.note{border-left:6px solid #0f766e;background:#fff;border-radius:10px;padding:16px 18px;border-top:1px solid #d7dee8;border-right:1px solid #d7dee8;border-bottom:1px solid #d7dee8}a{color:#1d4ed8}
</style></head><body><main>
<h1>iBOLT Blog Lifecycle And Citation Readiness Map</h1>
<p class="lede">Citation rate is necessary, but it is not the first metric to chase in isolation. The current saved benchmark shows ${summary.mentionRate}% mention rate, ${summary.nonBrandedMentionRate}% non-branded mention rate, and ${summary.citationRate}% citation rate. The immediate job is to get iBOLT into more non-branded answer sets, then make the strongest pages source-worthy enough to cite.</p>
<section class="cards">${cards}</section>
<p class="note"><strong>Important:</strong> retire/noindex rows are only candidates. Do not remove pages until Shopify traffic, backlink, revenue-assist, and internal-link data are checked.</p>
<h2>Lifecycle Mix</h2><div class="chart">${bucketSvg}</div>
<h2>Topic Pressure</h2><div class="chart">${topicSvg}</div>
<h2>First Pages To Work</h2><div class="chart">${prioritySvg}</div>
<h2>Top Page Actions</h2>
<table><thead><tr><th>Priority</th><th>Lifecycle</th><th>Page</th><th>Score</th><th>Queries</th><th>Competitor-only</th><th>Why</th><th>Next action</th></tr></thead><tbody>${rows}</tbody></table>
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, "blog-lifecycle-map");
  await mkdir(outDir, { recursive: true });

  const portfolioRows = await readCsv(path.join(benchmarkDir, "blog-portfolio-map", "blog-page-portfolio-ledger.csv"));
  const triageRows = await readCsv(path.join(benchmarkDir, "live-blog-triage", "all-live-blog-triage.csv"));
  const sourceAuthorityData = await readJsonIfExists(path.join(benchmarkDir, "source-authority-roadmap", "source-authority-data.json"), { summary: {} });
  const sourceAuthoritySummary = sourceAuthorityData.summary || {};
  const ledger = buildLedger({ portfolioRows, triageRows });
  const summary = summarizeLedger(ledger, sourceAuthoritySummary);

  const protectRows = ledger.filter((row) => row.bucket_key === "protect_amplify");
  const retireRows = ledger.filter((row) => row.bucket_key === "retire_noindex_candidate");
  const canonicalRows = ledger.filter((row) => row.bucket_key === "canonical_decision");
  const benchmarkRows = ledger.filter((row) => row.bucket_key === "benchmark_refresh");

  const bucketSvg = barSvg(summary.bucketRows, { title: "Pages by lifecycle bucket", labelKey: "lifecycle_bucket", valueKey: "pages", color: "#0f766e" });
  const topicSvg = barSvg(summary.topicRows, { title: "Topic priority by lifecycle and benchmark pressure", labelKey: "category", valueKey: "priority", color: "#7c3aed" });
  const prioritySvg = barSvg(ledger.slice(0, 12), { title: "First pages to work by priority score", labelKey: "title", valueKey: "priority", color: "#ea580c", height: 460 });

  await writeFile(path.join(outDir, "lifecycle-bucket-mix.svg"), bucketSvg);
  await writeFile(path.join(outDir, "topic-lifecycle-pressure.svg"), topicSvg);
  await writeFile(path.join(outDir, "first-pages-to-work.svg"), prioritySvg);
  await writeFile(path.join(outDir, "blog-lifecycle-data.json"), JSON.stringify({ summary, ledger }, null, 2));
  await writeFile(path.join(outDir, "page-lifecycle-ledger.csv"), csv([
    ["priority", "lifecycle_bucket", "title", "url", "category", "ai_citability_score", "word_count", "product_links", "product_entity_targets", "benchmark_query_count", "competitor_only_answers", "portfolio_action", "live_triage_action", "canonical_or_survivor_ticket", "linked_prompts", "competitors", "reasons", "recommended_next_action"],
    ...ledger.map((row) => [row.priority, row.lifecycle_bucket, row.title, row.url, row.category, row.ai_citability_score, row.word_count, row.product_links, row.product_entity_targets, row.benchmark_query_count, row.competitor_only_answers, row.portfolio_action, row.live_triage_action, row.canonical_or_survivor_ticket, row.linked_prompts, row.competitors, row.reasons, row.recommended_next_action]),
  ]));
  await writeFile(path.join(outDir, "lifecycle-bucket-summary.csv"), csv([
    ["lifecycle_bucket", "pages", "avg_score", "benchmark_pages", "competitor_only_answers", "product_targets"],
    ...summary.bucketRows.map((row) => [row.lifecycle_bucket, row.pages, row.avg_score, row.benchmark_pages, row.competitor_only_answers, row.product_targets]),
  ]));
  await writeFile(path.join(outDir, "protect-and-amplify-pages.csv"), csv([
    ["priority", "title", "url", "category", "ai_citability_score", "reasons", "recommended_next_action"],
    ...protectRows.map((row) => [row.priority, row.title, row.url, row.category, row.ai_citability_score, row.reasons, row.recommended_next_action]),
  ]));
  await writeFile(path.join(outDir, "retire-or-noindex-candidates.csv"), csv([
    ["priority", "title", "url", "category", "ai_citability_score", "word_count", "reasons", "recommended_next_action"],
    ...retireRows.map((row) => [row.priority, row.title, row.url, row.category, row.ai_citability_score, row.word_count, row.reasons, row.recommended_next_action]),
  ]));
  await writeFile(path.join(outDir, "canonical-consolidation-actions.csv"), csv([
    ["priority", "title", "url", "category", "ai_citability_score", "benchmark_query_count", "competitor_only_answers", "reasons", "recommended_next_action"],
    ...canonicalRows.map((row) => [row.priority, row.title, row.url, row.category, row.ai_citability_score, row.benchmark_query_count, row.competitor_only_answers, row.reasons, row.recommended_next_action]),
  ]));
  await writeFile(path.join(outDir, "benchmark-refresh-actions.csv"), csv([
    ["priority", "title", "url", "category", "ai_citability_score", "benchmark_query_count", "competitor_only_answers", "linked_prompts", "competitors", "recommended_next_action"],
    ...benchmarkRows.map((row) => [row.priority, row.title, row.url, row.category, row.ai_citability_score, row.benchmark_query_count, row.competitor_only_answers, row.linked_prompts, row.competitors, row.recommended_next_action]),
  ]));
  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown({ summary, ledger }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({ summary, ledger, bucketSvg, topicSvg, prioritySvg }));

  console.log(`Wrote ${outDir}`);
  console.log(`Pages classified: ${summary.pages}`);
  console.log(`Citation rate: ${summary.citationRate}%`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
