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
  if (!name) throw new Error(`No ${prefix} directory found in ${OUTPUT_ROOT}.`);
  return path.join(process.cwd(), OUTPUT_ROOT, name);
}

function num(value) {
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeUrl(value) {
  return String(value ?? "").replace(/\/+$/, "").toLowerCase();
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/^\+\d+\s+more$/i.test(item));
}

function addToCounter(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function firstCounterItems(map, count = 6) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, count)
    .map(([name, value]) => `${name} ${value}`);
}

function indexByUrl(rows, fieldNames) {
  const map = new Map();
  for (const row of rows) {
    for (const field of fieldNames) {
      const url = normalizeUrl(row[field]);
      if (url && !map.has(url)) map.set(url, row);
    }
  }
  return map;
}

function bucketForPage({ lifecycle, portfolio, citation, conversion }) {
  const lifecycleBucket = lifecycle.lifecycle_bucket || "";
  const action = `${portfolio.action_bucket || ""} ${conversion.recommended_action || ""} ${citation.readiness_bucket || ""}`;
  const hasCanonical = /canonical|consolidation|survivor|duplicate/i.test(`${lifecycleBucket} ${action}`);
  const mentionFirst = /Mention first/i.test(citation.readiness_bucket || "");
  if (hasCanonical && mentionFirst) return "Survivor/canonical plus mention recovery";
  if (hasCanonical) return "Survivor/canonical decision";
  if (mentionFirst) return "AI mention recovery";
  if (/Citation-ready after page cleanup/i.test(citation.readiness_bucket || "")) return "Citation/schema cleanup";
  if (/Legacy rewrite/i.test(lifecycleBucket)) return "Legacy rewrite";
  if (/Protect|amplify/i.test(lifecycleBucket)) return "Protect and amplify";
  if (num(conversion.priority_score) >= 70) return "Conversion refresh";
  return "Monitor";
}

function issueFlags(portfolio, citation, conversion, lifecycle) {
  const issues = new Set();
  for (const value of [
    portfolio.issues,
    portfolio.missing_quick_answer === "yes" ? "quick answer" : "",
    portfolio.missing_faq_schema === "yes" ? "FAQ schema" : "",
    portfolio.missing_article_schema === "yes" ? "Article schema" : "",
    portfolio.missing_comparison === "yes" ? "comparison block" : "",
    num(portfolio.missing_alt_count) > 0 ? "image alt text" : "",
    citation.page_fixes,
    conversion.missing_fixes,
    lifecycle.reasons,
  ]) {
    for (const item of splitList(value)) {
      const clean = item.replace(/^missing\s+/i, "").trim();
      if (clean) issues.add(clean);
    }
  }
  return [...issues];
}

function riskScore(row) {
  const pressure = num(row.benchmark_query_count) * 10 + num(row.zero_mention_queries) * 15 + num(row.competitor_only_answers) * 11;
  const opportunity = num(row.conversion_priority_score) * 0.28 + num(row.citation_priority) * 0.22;
  const canonical = row.action_bucket === "Survivor/canonical decision" ? 18 : 0;
  const structure = row.issue_count * 4;
  const product = num(row.product_entity_targets) > 0 ? 8 : 0;
  return clamp(pressure + opportunity + canonical + structure + product, 0, 200);
}

function nextAction(row) {
  if (row.action_bucket === "Survivor/canonical plus mention recovery") {
    return "Pick the survivor URL first, then add query-exact answer blocks, exact iBOLT product modules, comparison sections, FAQ/schema, and retest mapped prompts.";
  }
  if (row.action_bucket === "Survivor/canonical decision") {
    return "Pick the survivor URL, merge useful sections, preserve mapped prompts, then refresh only the survivor page.";
  }
  if (row.action_bucket === "AI mention recovery") {
    return "Add query-exact quick answer, exact iBOLT product module, fair competitor comparison, FAQ/schema, and retest mapped prompts.";
  }
  if (row.action_bucket === "Citation/schema cleanup") {
    return "Add missing quick answer, FAQ or Article schema, image alt text, and hand the cleaned URL to the citation/outreach queue.";
  }
  if (row.action_bucket === "Conversion refresh") {
    return "Add restrained product cards with one clear View Product CTA per module, then retest buyer prompts.";
  }
  if (row.action_bucket === "Legacy rewrite") {
    return "Rewrite into answer-first format with current products, concise FAQs, and comparison language.";
  }
  if (row.action_bucket === "Protect and amplify") {
    return "Keep page stable, strengthen internal links, and use it as a supporting citation target.";
  }
  return "Monitor, keep internal links fresh, and revisit after expanded benchmark data lands.";
}

function buildSvgBarChart({ title, rows, labelField, valueField, outputPath, width = 1100, height = 560, color = "#0b5cab" }) {
  const margin = { top: 72, right: 45, bottom: 52, left: 340 };
  const chartRows = rows.slice(0, 12);
  const max = Math.max(...chartRows.map((row) => num(row[valueField])), 1);
  const rowHeight = 41;
  const actualHeight = Math.max(height, margin.top + chartRows.length * rowHeight + margin.bottom);
  const chartWidth = width - margin.left - margin.right;
  const bars = chartRows
    .map((row, index) => {
      const y = margin.top + index * rowHeight;
      const value = num(row[valueField]);
      const widthValue = Math.max(4, Math.round((value / max) * chartWidth));
      const label = String(row[labelField] || "").slice(0, 54);
      return `
      <text x="${margin.left - 16}" y="${y + 21}" text-anchor="end" font-size="14" fill="#172033">${escapeHtml(label)}</text>
      <rect x="${margin.left}" y="${y}" width="${widthValue}" height="25" rx="6" fill="${color}"/>
      <text x="${margin.left + widthValue + 9}" y="${y + 18}" font-size="14" fill="#172033">${escapeHtml(value)}</text>`;
    })
    .join("\n");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${actualHeight}" viewBox="0 0 ${width} ${actualHeight}">
  <rect width="100%" height="100%" fill="#f7f9fc"/>
  <text x="${margin.left}" y="38" font-size="24" font-weight="700" fill="#111827">${escapeHtml(title)}</text>
  <text x="${margin.left}" y="62" font-size="14" fill="#4b5563">Joined across lifecycle, citation readiness, conversion opportunity, product/entity, and benchmark pressure ledgers.</text>
  ${bars}
</svg>`;
  return writeFile(outputPath, svg);
}

function buildMarkdown({ summary, pageRows, actionRows, topicRows }) {
  const pageLines = pageRows
    .slice(0, 15)
    .map((row, index) => `${index + 1}. ${row.title} (${row.category}), ${row.action_bucket}, risk ${row.priority_score}.`)
    .join("\n");
  const actionLines = actionRows
    .map((row) => `- ${row.action_bucket}: ${row.pages} pages, avg risk ${row.avg_priority_score}, ${row.benchmark_pressure_pages} with benchmark pressure.`)
    .join("\n");
  const topicLines = topicRows
    .slice(0, 10)
    .map((row) => `- ${row.category}: ${row.pages} pages, ${row.competitor_only_answers} competitor-only answers, top actions ${row.top_actions}.`)
    .join("\n");

  return `# All Blog Post AI Visibility Dossier

## Summary

- Pages joined: ${summary.pages}
- Survivor/canonical decision pages: ${summary.canonicalDecisionPages}
- Survivor/canonical plus mention recovery pages: ${summary.canonicalMentionRecoveryPages}
- AI mention recovery pages: ${summary.mentionRecoveryPages}
- Citation/schema cleanup pages: ${summary.citationCleanupPages}
- Conversion refresh pages: ${summary.conversionRefreshPages}
- Legacy rewrite pages: ${summary.legacyRewritePages}
- Protect/amplify pages: ${summary.protectAmplifyPages}
- Pages with benchmark pressure: ${summary.benchmarkPressurePages}
- Pages with competitor-only answers: ${summary.competitorOnlyPages}
- Average page citability score: ${summary.avgCitabilityScore}
- Average priority score: ${summary.avgPriorityScore}
- Top competitor pressure: ${summary.topCompetitors.join(", ")}

## Highest Priority Pages

${pageLines}

## Action Buckets

${actionLines}

## Topic Dossier

${topicLines}

## Operating Rule

Do not update every page the same way. First resolve canonical/survivor pages, then recover AI mentions on benchmark-pressure pages, then clean schema/citation issues, then protect the pages already in decent shape.
`;
}

function buildHtml({ markdown, summary, pageRows, actionRows, topicRows }) {
  const pageHtml = pageRows
    .slice(0, 30)
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.priority_score)}</td>
        <td><a href="${escapeHtml(row.url)}">${escapeHtml(row.title)}</a></td>
        <td>${escapeHtml(row.category)}</td>
        <td>${escapeHtml(row.action_bucket)}</td>
        <td>${escapeHtml(row.benchmark_query_count)}</td>
        <td>${escapeHtml(row.competitor_only_answers)}</td>
        <td>${escapeHtml(row.next_action)}</td>
      </tr>`,
    )
    .join("\n");
  const actionHtml = actionRows
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.action_bucket)}</td>
        <td>${escapeHtml(row.pages)}</td>
        <td>${escapeHtml(row.avg_priority_score)}</td>
        <td>${escapeHtml(row.benchmark_pressure_pages)}</td>
        <td>${escapeHtml(row.top_categories)}</td>
      </tr>`,
    )
    .join("\n");
  const topicHtml = topicRows
    .slice(0, 12)
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.category)}</td>
        <td>${escapeHtml(row.pages)}</td>
        <td>${escapeHtml(row.avg_priority_score)}</td>
        <td>${escapeHtml(row.benchmark_pressure_pages)}</td>
        <td>${escapeHtml(row.competitor_only_answers)}</td>
        <td>${escapeHtml(row.top_actions)}</td>
      </tr>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>All Blog Post AI Visibility Dossier</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; color: #111827; background: #f6f8fb; }
    main { max-width: 1220px; margin: 0 auto; padding: 32px 20px 56px; }
    h1 { margin: 0 0 8px; font-size: 34px; }
    h2 { margin-top: 34px; font-size: 23px; }
    p, li { line-height: 1.55; color: #344054; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin: 22px 0; }
    .metric { background: #fff; border: 1px solid #d8e0eb; border-radius: 8px; padding: 16px; }
    .metric strong { display: block; font-size: 27px; color: #111827; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #d8e0eb; }
    th, td { border-bottom: 1px solid #e8eef6; padding: 10px 11px; text-align: left; vertical-align: top; font-size: 14px; }
    th { background: #eaf1fb; color: #344054; }
    a { color: #0b5cab; }
    img { max-width: 100%; background: #fff; border: 1px solid #d8e0eb; border-radius: 8px; margin: 10px 0 20px; }
    pre { white-space: pre-wrap; background: #fff; border: 1px solid #d8e0eb; padding: 16px; border-radius: 8px; }
  </style>
</head>
<body>
  <main>
    <h1>All Blog Post AI Visibility Dossier</h1>
    <p>One joined row per live blog page, combining lifecycle, benchmark pressure, citation readiness, conversion opportunity, product/entity signals, and competitor pressure.</p>
    <div class="grid">
      <div class="metric"><strong>${summary.pages}</strong><span>pages joined</span></div>
      <div class="metric"><strong>${summary.canonicalDecisionPages}</strong><span>canonical decisions</span></div>
      <div class="metric"><strong>${summary.canonicalMentionRecoveryPages}</strong><span>canonical plus mention recovery</span></div>
      <div class="metric"><strong>${summary.mentionRecoveryPages}</strong><span>mention recovery pages</span></div>
      <div class="metric"><strong>${summary.citationCleanupPages}</strong><span>citation/schema cleanup pages</span></div>
      <div class="metric"><strong>${summary.benchmarkPressurePages}</strong><span>benchmark-pressure pages</span></div>
      <div class="metric"><strong>${summary.avgCitabilityScore}</strong><span>avg citability score</span></div>
    </div>
    <h2>Charts</h2>
    <img src="top-post-priority.svg" alt="Top post priority">
    <img src="action-bucket-priority.svg" alt="Action bucket priority">
    <h2>Highest Priority Pages</h2>
    <table>
      <thead><tr><th>Priority</th><th>Page</th><th>Topic</th><th>Action</th><th>Prompts</th><th>Competitor Only</th><th>Next Action</th></tr></thead>
      <tbody>${pageHtml}</tbody>
    </table>
    <h2>Action Buckets</h2>
    <table>
      <thead><tr><th>Action</th><th>Pages</th><th>Avg Priority</th><th>Benchmark Pressure</th><th>Top Topics</th></tr></thead>
      <tbody>${actionHtml}</tbody>
    </table>
    <h2>Topic Dossier</h2>
    <table>
      <thead><tr><th>Topic</th><th>Pages</th><th>Avg Priority</th><th>Benchmark Pressure</th><th>Competitor Only</th><th>Top Actions</th></tr></thead>
      <tbody>${topicHtml}</tbody>
    </table>
    <h2>Markdown Summary</h2>
    <pre>${escapeHtml(markdown)}</pre>
  </main>
</body>
</html>`;
}

async function main() {
  const baseDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(baseDir, "all-blog-post-dossier");
  await mkdir(outDir, { recursive: true });

  const lifecycleRows = await readCsv(path.join(baseDir, "blog-lifecycle-map", "page-lifecycle-ledger.csv"));
  const portfolioRows = await readCsv(path.join(baseDir, "blog-portfolio-map", "blog-page-portfolio-ledger.csv"));
  const citationRows = await readCsv(path.join(baseDir, "citation-readiness-map", "page-citation-readiness.csv"));
  const conversionRows = await readCsv(path.join(baseDir, "blog-conversion-opportunity-map", "page-conversion-priority.csv"));
  const productRows = await readCsv(path.join(baseDir, "product-entity-coverage-plan", "product-entity-work-queue.csv"));
  const master = await readJsonIfExists(path.join(baseDir, "master-dossier", "master-dossier-data.json"), {});

  const portfolioByUrl = indexByUrl(portfolioRows, ["url", "page_url"]);
  const citationByUrl = indexByUrl(citationRows, ["url", "page_url"]);
  const conversionByUrl = indexByUrl(conversionRows, ["url", "page_url"]);
  const productRowsByUrl = new Map();
  for (const row of productRows) {
    for (const target of splitList(row.target_pages)) {
      const url = normalizeUrl(target);
      if (!url) continue;
      if (!productRowsByUrl.has(url)) productRowsByUrl.set(url, []);
      productRowsByUrl.get(url).push(row);
    }
  }

  const pageRows = lifecycleRows.map((lifecycle) => {
    const url = normalizeUrl(lifecycle.url);
    const portfolio = portfolioByUrl.get(url) || {};
    const citation = citationByUrl.get(url) || {};
    const conversion = conversionByUrl.get(url) || {};
    const productTargets = productRowsByUrl.get(url) || [];
    const issues = issueFlags(portfolio, citation, conversion, lifecycle);
    const actionBucket = bucketForPage({ lifecycle, portfolio, citation, conversion });
    const row = {
      title: lifecycle.title || portfolio.title || citation.page || conversion.title,
      url: lifecycle.url || portfolio.url || citation.url || conversion.url,
      category: lifecycle.category || portfolio.category || citation.category || conversion.category || "other",
      action_bucket: actionBucket,
      lifecycle_bucket: lifecycle.lifecycle_bucket,
      portfolio_action: portfolio.action_bucket,
      citation_readiness_bucket: citation.readiness_bucket,
      conversion_tier: conversion.conversion_tier,
      ai_citability_score: num(lifecycle.ai_citability_score || portfolio.ai_citability_score),
      word_count: num(lifecycle.word_count || portfolio.word_count),
      product_links: num(lifecycle.product_links || portfolio.product_links || conversion.product_links),
      product_entity_targets: num(lifecycle.product_entity_targets || portfolio.product_entity_targets || conversion.product_entity_targets),
      product_entity_queue_rows: productTargets.length,
      benchmark_query_count: num(lifecycle.benchmark_query_count || portfolio.benchmark_query_count || citation.benchmark_query_count || conversion.benchmark_query_count),
      zero_mention_queries: num(portfolio.zero_mention_queries || citation.zero_mention_queries || conversion.zero_mention_queries),
      competitor_only_answers: num(lifecycle.competitor_only_answers || portfolio.competitor_only_answers || citation.competitor_only_answers || conversion.competitor_only_answers),
      competitors: lifecycle.competitors || portfolio.competitors || citation.competitors || conversion.competitors,
      linked_prompts: lifecycle.linked_prompts || portfolio.linked_prompts || citation.retest_prompts || conversion.retest_prompts,
      citation_priority: num(citation.citation_priority),
      conversion_priority_score: num(conversion.priority_score),
      commercial_intent_score: num(conversion.commercial_intent_score || citation.commercial_intent_score),
      issue_count: issues.length,
      issue_flags: issues.join("; "),
      products_to_feature: citation.products_to_feature || conversion.products_to_feature,
      source_targets: citation.source_targets,
      canonical_or_survivor_ticket: lifecycle.canonical_or_survivor_ticket || portfolio.canonical_or_survivor_ticket,
      source_next_action: lifecycle.recommended_next_action || portfolio.next_step || citation.next_citation_action || conversion.checkout_action,
    };
    row.priority_score = riskScore(row);
    row.next_action = nextAction(row);
    return row;
  }).sort((a, b) => b.priority_score - a.priority_score || b.competitor_only_answers - a.competitor_only_answers || a.title.localeCompare(b.title));

  const actionMap = new Map();
  const topicMap = new Map();
  const competitorCounter = new Map();
  for (const row of pageRows) {
    if (!actionMap.has(row.action_bucket)) {
      actionMap.set(row.action_bucket, {
        action_bucket: row.action_bucket,
        pages: 0,
        priority_total: 0,
        avg_priority_score: 0,
        benchmark_pressure_pages: 0,
        competitor_only_answers: 0,
        categories: new Map(),
        top_pages: [],
      });
    }
    const action = actionMap.get(row.action_bucket);
    action.pages += 1;
    action.priority_total += row.priority_score;
    if (row.benchmark_query_count > 0 || row.competitor_only_answers > 0) action.benchmark_pressure_pages += 1;
    action.competitor_only_answers += row.competitor_only_answers;
    addToCounter(action.categories, row.category);
    action.top_pages.push(row.title);

    if (!topicMap.has(row.category)) {
      topicMap.set(row.category, {
        category: row.category,
        pages: 0,
        priority_total: 0,
        avg_priority_score: 0,
        benchmark_pressure_pages: 0,
        competitor_only_answers: 0,
        zero_mention_queries: 0,
        actions: new Map(),
        competitors: new Map(),
        top_pages: [],
      });
    }
    const topic = topicMap.get(row.category);
    topic.pages += 1;
    topic.priority_total += row.priority_score;
    if (row.benchmark_query_count > 0 || row.competitor_only_answers > 0) topic.benchmark_pressure_pages += 1;
    topic.competitor_only_answers += row.competitor_only_answers;
    topic.zero_mention_queries += row.zero_mention_queries;
    addToCounter(topic.actions, row.action_bucket);
    for (const competitor of splitList(row.competitors)) {
      addToCounter(topic.competitors, competitor);
      addToCounter(competitorCounter, competitor);
    }
    topic.top_pages.push(row.title);
  }

  const actionRows = [...actionMap.values()]
    .map((row) => ({
      ...row,
      avg_priority_score: clamp(row.priority_total / Math.max(1, row.pages), 0, 200),
      priority_total: Math.round(row.priority_total),
      top_categories: firstCounterItems(row.categories, 5).join("; "),
      top_pages: row.top_pages.slice(0, 6).join("; "),
    }))
    .sort((a, b) => b.priority_total - a.priority_total || b.pages - a.pages);

  const topicRows = [...topicMap.values()]
    .map((row) => ({
      ...row,
      avg_priority_score: clamp(row.priority_total / Math.max(1, row.pages), 0, 200),
      priority_total: Math.round(row.priority_total),
      top_actions: firstCounterItems(row.actions, 5).join("; "),
      top_competitors: firstCounterItems(row.competitors, 6).join("; "),
      top_pages: row.top_pages.slice(0, 6).join("; "),
    }))
    .sort((a, b) => b.priority_total - a.priority_total || b.competitor_only_answers - a.competitor_only_answers);

  const summary = {
    sourceBenchmarkDir: baseDir,
    pages: pageRows.length,
    canonicalDecisionPages: pageRows.filter((row) => row.action_bucket === "Survivor/canonical decision").length,
    canonicalMentionRecoveryPages: pageRows.filter((row) => row.action_bucket === "Survivor/canonical plus mention recovery").length,
    mentionRecoveryPages: pageRows.filter((row) => row.action_bucket === "AI mention recovery" || row.action_bucket === "Survivor/canonical plus mention recovery").length,
    citationCleanupPages: pageRows.filter((row) => row.action_bucket === "Citation/schema cleanup").length,
    conversionRefreshPages: pageRows.filter((row) => row.action_bucket === "Conversion refresh").length,
    legacyRewritePages: pageRows.filter((row) => row.action_bucket === "Legacy rewrite").length,
    protectAmplifyPages: pageRows.filter((row) => row.action_bucket === "Protect and amplify").length,
    monitorPages: pageRows.filter((row) => row.action_bucket === "Monitor").length,
    benchmarkPressurePages: pageRows.filter((row) => row.benchmark_query_count > 0 || row.competitor_only_answers > 0).length,
    competitorOnlyPages: pageRows.filter((row) => row.competitor_only_answers > 0).length,
    pagesWithProductEntityQueueRows: pageRows.filter((row) => row.product_entity_queue_rows > 0).length,
    avgCitabilityScore: clamp(pageRows.reduce((sum, row) => sum + row.ai_citability_score, 0) / Math.max(1, pageRows.length)),
    avgPriorityScore: clamp(pageRows.reduce((sum, row) => sum + row.priority_score, 0) / Math.max(1, pageRows.length), 0, 200),
    topCompetitors: firstCounterItems(competitorCounter, 8),
    baselineMentionRate: master.evidenceSummary ? `${master.evidenceSummary.mentionCount}/${master.evidenceSummary.total}` : "",
    baselineCitationRate: master.evidenceSummary ? `${master.evidenceSummary.citationCount}/${master.evidenceSummary.total}` : "",
  };

  const pageCsv = [
    [
      "priority_score",
      "title",
      "url",
      "category",
      "action_bucket",
      "lifecycle_bucket",
      "portfolio_action",
      "citation_readiness_bucket",
      "conversion_tier",
      "ai_citability_score",
      "word_count",
      "product_links",
      "product_entity_targets",
      "product_entity_queue_rows",
      "benchmark_query_count",
      "zero_mention_queries",
      "competitor_only_answers",
      "competitors",
      "linked_prompts",
      "citation_priority",
      "conversion_priority_score",
      "commercial_intent_score",
      "issue_count",
      "issue_flags",
      "products_to_feature",
      "source_targets",
      "canonical_or_survivor_ticket",
      "next_action",
      "source_next_action",
    ],
    ...pageRows.map((row) => [
      row.priority_score,
      row.title,
      row.url,
      row.category,
      row.action_bucket,
      row.lifecycle_bucket,
      row.portfolio_action,
      row.citation_readiness_bucket,
      row.conversion_tier,
      row.ai_citability_score,
      row.word_count,
      row.product_links,
      row.product_entity_targets,
      row.product_entity_queue_rows,
      row.benchmark_query_count,
      row.zero_mention_queries,
      row.competitor_only_answers,
      row.competitors,
      row.linked_prompts,
      row.citation_priority,
      row.conversion_priority_score,
      row.commercial_intent_score,
      row.issue_count,
      row.issue_flags,
      row.products_to_feature,
      row.source_targets,
      row.canonical_or_survivor_ticket,
      row.next_action,
      row.source_next_action,
    ]),
  ];

  const actionCsv = [
    ["action_bucket", "pages", "priority_total", "avg_priority_score", "benchmark_pressure_pages", "competitor_only_answers", "top_categories", "top_pages"],
    ...actionRows.map((row) => [
      row.action_bucket,
      row.pages,
      row.priority_total,
      row.avg_priority_score,
      row.benchmark_pressure_pages,
      row.competitor_only_answers,
      row.top_categories,
      row.top_pages,
    ]),
  ];

  const topicCsv = [
    [
      "category",
      "pages",
      "priority_total",
      "avg_priority_score",
      "benchmark_pressure_pages",
      "competitor_only_answers",
      "zero_mention_queries",
      "top_actions",
      "top_competitors",
      "top_pages",
    ],
    ...topicRows.map((row) => [
      row.category,
      row.pages,
      row.priority_total,
      row.avg_priority_score,
      row.benchmark_pressure_pages,
      row.competitor_only_answers,
      row.zero_mention_queries,
      row.top_actions,
      row.top_competitors,
      row.top_pages,
    ]),
  ];

  const markdown = buildMarkdown({ summary, pageRows, actionRows, topicRows });
  const html = buildHtml({ markdown, summary, pageRows, actionRows, topicRows });

  await writeFile(path.join(outDir, "all-blog-post-dossier-data.json"), JSON.stringify({ summary, pageRows, actionRows, topicRows }, null, 2));
  await writeFile(path.join(outDir, "all-blog-post-dossier.csv"), csv(pageCsv));
  await writeFile(path.join(outDir, "action-bucket-summary.csv"), csv(actionCsv));
  await writeFile(path.join(outDir, "topic-dossier-summary.csv"), csv(topicCsv));
  await writeFile(path.join(outDir, "REPORT.md"), markdown);
  await writeFile(path.join(outDir, "REPORT.html"), html);
  await buildSvgBarChart({
    title: "Highest Priority Blog Pages",
    rows: pageRows,
    labelField: "title",
    valueField: "priority_score",
    outputPath: path.join(outDir, "top-post-priority.svg"),
  });
  await buildSvgBarChart({
    title: "Priority By Action Bucket",
    rows: actionRows,
    labelField: "action_bucket",
    valueField: "priority_total",
    outputPath: path.join(outDir, "action-bucket-priority.svg"),
    color: "#19a974",
  });

  console.log(`Wrote ${path.relative(process.cwd(), outDir)}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
