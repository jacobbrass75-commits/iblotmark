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

function pct(numerator, denominator) {
  return denominator ? Math.round((num(numerator) / num(denominator)) * 100) : 0;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/^\+\d+\s+more$/i.test(item));
}

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(value) {
  return String(value ?? "").replace(/\/+$/, "").toLowerCase();
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

function rowByTitle(rows, titleFields) {
  const map = new Map();
  for (const row of rows) {
    for (const field of titleFields) {
      const key = normalize(row[field]);
      if (key && !map.has(key)) map.set(key, row);
    }
  }
  return map;
}

function rowByUrl(rows, fieldNames) {
  const map = new Map();
  for (const row of rows) {
    for (const field of fieldNames) {
      const key = normalizeUrl(row[field]);
      if (key && !map.has(key)) map.set(key, row);
    }
  }
  return map;
}

function issueList(row) {
  const issues = new Set();
  for (const source of [row.missing_fixes, row.issues, row.structural_issues, row.checkout_action]) {
    for (const item of splitList(source)) {
      const clean = item
        .toLowerCase()
        .replace(/^missing\s+/, "")
        .replace(/^add\s+/, "")
        .trim();
      if (/quick answer/.test(clean)) issues.add("quick answer");
      if (/faq/.test(clean)) issues.add("FAQ schema");
      if (/article|blogposting/.test(clean)) issues.add("Article schema");
      if (/comparison/.test(clean)) issues.add("comparison block");
      if (/image alt|alt text/.test(clean)) issues.add("image alt text");
      if (/product module|feature /.test(clean)) issues.add("product module");
    }
  }
  return [...issues];
}

function readinessBucket(row, issues) {
  const readiness = num(row.conversion_readiness_score);
  const hasPressure = num(row.zero_mention_queries) > 0 || num(row.competitor_only_answers) > 0 || num(row.benchmark_query_count) > 0;
  const hasMajorFixes = issues.includes("quick answer") || issues.includes("FAQ schema") || issues.includes("comparison block");
  if (hasPressure && hasMajorFixes) return "Mention first, then citation";
  if (hasMajorFixes) return "Citation-ready after page cleanup";
  if (readiness >= 75 && hasPressure) return "External citation push after retest";
  if (readiness >= 75) return "Monitor and support with off-site mentions";
  return "Needs page structure before citation work";
}

function citationPriority(row, issues) {
  const pressure = num(row.ai_pressure_score) || (num(row.benchmark_query_count) * 12 + num(row.zero_mention_queries) * 18 + num(row.competitor_only_answers) * 12);
  const commercial = num(row.commercial_intent_score);
  const citationFix = num(row.citation_fix_score) || issues.length * 12;
  const productDepth = num(row.product_depth_score);
  const canonicalPenalty = /canonical|duplicate/i.test(`${row.recommended_action || ""} ${row.action || ""}`) ? 8 : 0;
  return clamp(pressure * 0.35 + commercial * 0.22 + citationFix * 0.23 + productDepth * 0.16 - canonicalPenalty + 8);
}

function sourceTargetsForCategory(categoryRows, category) {
  const normalized = normalize(category);
  const row = categoryRows.find((item) => normalize(item.category) === normalized);
  return row?.source_targets || "";
}

function contractorWhyForCategory(categoryRows, category) {
  const normalized = normalize(category);
  const row = categoryRows.find((item) => normalize(item.category) === normalized);
  return row?.contractor_why || "";
}

function nextCitationAction(bucket, row, issues) {
  if (bucket === "Mention first, then citation") {
    return "Do the page edit first: quick answer, product module, comparison block, FAQ/schema, then ask for external citations to the survivor URL.";
  }
  if (bucket === "Citation-ready after page cleanup") {
    return `Clean up ${issues.join(", ")}, then hand the exact URL to the SEO contractor for third-party citations.`;
  }
  if (bucket === "External citation push after retest") {
    return "Retest the prompt set. If iBOLT is included, start external citations and source-link outreach for this exact page.";
  }
  return "Keep page stable, build internal links, and use off-site mentions only if the topic is in a high-priority category.";
}

function buildSvgBarChart({ title, rows, labelField, valueField, outputPath, width = 1100, height = 560, color = "#0b5cab" }) {
  const margin = { top: 70, right: 45, bottom: 50, left: 320 };
  const chartRows = rows.slice(0, 10);
  const max = Math.max(...chartRows.map((row) => num(row[valueField])), 1);
  const rowHeight = 43;
  const actualHeight = Math.max(height, margin.top + chartRows.length * rowHeight + margin.bottom);
  const chartWidth = width - margin.left - margin.right;
  const bars = chartRows
    .map((row, index) => {
      const y = margin.top + index * rowHeight;
      const value = num(row[valueField]);
      const barWidth = Math.max(4, Math.round((value / max) * chartWidth));
      const label = String(row[labelField] || "").slice(0, 52);
      return `
      <text x="${margin.left - 16}" y="${y + 22}" text-anchor="end" font-size="14" fill="#172033">${escapeHtml(label)}</text>
      <rect x="${margin.left}" y="${y}" width="${barWidth}" height="26" rx="6" fill="${color}"/>
      <text x="${margin.left + barWidth + 9}" y="${y + 19}" font-size="14" fill="#172033">${escapeHtml(value)}</text>`;
    })
    .join("\n");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${actualHeight}" viewBox="0 0 ${width} ${actualHeight}">
  <rect width="100%" height="100%" fill="#f7f9fc"/>
  <text x="${margin.left}" y="38" font-size="24" font-weight="700" fill="#111827">${escapeHtml(title)}</text>
  <text x="${margin.left}" y="62" font-size="14" fill="#4b5563">Higher priority means stronger combination of AI replacement pressure, buyer intent, and citation fixes.</text>
  ${bars}
</svg>`;
  return writeFile(outputPath, svg);
}

function buildMarkdown({ summary, pageRows, topicRows, contractorRows, competitorRows }) {
  const pageLines = pageRows
    .slice(0, 12)
    .map((row, index) => `${index + 1}. ${row.page} (${row.category}), ${row.readiness_bucket}, priority ${row.citation_priority}.`)
    .join("\n");
  const topicLines = topicRows
    .slice(0, 8)
    .map((row) => `- ${row.category}: ${row.pages} pages, ${row.citation_priority} priority, ${row.zero_mention_queries} zero-mention queries, ${row.competitor_only_answers} competitor-only answers.`)
    .join("\n");
  const contractorLines = contractorRows
    .slice(0, 10)
    .map((row) => `- ${row.category_or_brand}: ${row.target} Success metric: ${row.success_metric}`)
    .join("\n");
  const competitorLines = competitorRows
    .slice(0, 8)
    .map((row) => `- ${row.brand}: ${row.lost_answers} lost answers, categories ${row.categories}.`)
    .join("\n");

  return `# AI Citation Readiness Map

## Bottom Line

Citation rate should improve, but it is not the first isolated lever. Current citation rate is ${summary.citationRate} while non-branded mention rate is ${summary.nonBrandedMentionRate}. That means most pages need to win inclusion and recommendation first, then citation work becomes more effective.

## Summary

- Answers tested: ${summary.answersTested}
- iBOLT mentions: ${summary.mentionRate}
- Non-branded mentions: ${summary.nonBrandedMentionRate}
- Top-3 recommendations: ${summary.topThreeRate}
- Target-domain citations: ${summary.citationRate}
- Pages scored: ${summary.pagesScored}
- Mention-first pages: ${summary.mentionFirstPages}
- Citation-ready after cleanup pages: ${summary.cleanupThenCitationPages}
- External-citation-push pages: ${summary.externalCitationPushPages}
- Contractor off-site rows: ${summary.contractorRows}
- Competitor source rows: ${summary.competitorRows}

## First Page Queue

${pageLines}

## Topic Citation Priority

${topicLines}

## Contractor Off-Site Citation Targets

${contractorLines}

## Competitor Citation Pressure

${competitorLines}

## Operating Rule

Do not ask the contractor to build citations to weak or duplicate pages first. Pick the survivor URL, add the answer block, product module, comparison language, FAQ/schema, and image alt text, then send that exact URL for off-site citations.
`;
}

function buildHtml({ markdown, summary, pageRows, topicRows, contractorRows, competitorRows }) {
  const pageHtml = pageRows
    .slice(0, 20)
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.citation_priority)}</td>
        <td><a href="${escapeHtml(row.url)}">${escapeHtml(row.page)}</a></td>
        <td>${escapeHtml(row.category)}</td>
        <td>${escapeHtml(row.readiness_bucket)}</td>
        <td>${escapeHtml(row.page_fixes)}</td>
        <td>${escapeHtml(row.next_citation_action)}</td>
      </tr>`,
    )
    .join("\n");
  const topicHtml = topicRows
    .slice(0, 10)
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.citation_priority)}</td>
        <td>${escapeHtml(row.category)}</td>
        <td>${escapeHtml(row.pages)}</td>
        <td>${escapeHtml(row.zero_mention_queries)}</td>
        <td>${escapeHtml(row.competitor_only_answers)}</td>
        <td>${escapeHtml(row.source_targets)}</td>
      </tr>`,
    )
    .join("\n");
  const contractorHtml = contractorRows
    .slice(0, 10)
    .map((row) => `<li><strong>${escapeHtml(row.category_or_brand)}:</strong> ${escapeHtml(row.target)} <span>${escapeHtml(row.success_metric)}</span></li>`)
    .join("\n");
  const competitorHtml = competitorRows
    .slice(0, 10)
    .map((row) => `<li><strong>${escapeHtml(row.brand)}:</strong> ${escapeHtml(row.lost_answers)} lost answers, ${escapeHtml(row.categories)}</li>`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AI Citation Readiness Map</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f6f8fb; color: #111827; }
    main { max-width: 1180px; margin: 0 auto; padding: 32px 20px 56px; }
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
    li span { display: block; color: #667085; }
    pre { white-space: pre-wrap; background: #fff; border: 1px solid #d8e0eb; padding: 16px; border-radius: 8px; }
  </style>
</head>
<body>
  <main>
    <h1>AI Citation Readiness Map</h1>
    <p>This report turns the 0% citation-rate problem into a page queue and contractor handoff. It distinguishes pages that need inclusion work first from pages ready for off-site citation pushes after cleanup.</p>
    <div class="grid">
      <div class="metric"><strong>${summary.citationRate}</strong><span>target-domain citation rate</span></div>
      <div class="metric"><strong>${summary.nonBrandedMentionRate}</strong><span>non-branded mention rate</span></div>
      <div class="metric"><strong>${summary.mentionFirstPages}</strong><span>mention-first pages</span></div>
      <div class="metric"><strong>${summary.cleanupThenCitationPages}</strong><span>cleanup then citation pages</span></div>
    </div>
    <h2>Charts</h2>
    <img src="citation-priority-pages.svg" alt="Citation priority pages">
    <img src="citation-priority-topics.svg" alt="Citation priority topics">
    <h2>Page Queue</h2>
    <table>
      <thead><tr><th>Priority</th><th>Page</th><th>Topic</th><th>Bucket</th><th>Fixes</th><th>Next Action</th></tr></thead>
      <tbody>${pageHtml}</tbody>
    </table>
    <h2>Topic Priority</h2>
    <table>
      <thead><tr><th>Priority</th><th>Topic</th><th>Pages</th><th>Zero Mention</th><th>Competitor Only</th><th>External Source Targets</th></tr></thead>
      <tbody>${topicHtml}</tbody>
    </table>
    <h2>Contractor Off-Site Targets</h2>
    <ul>${contractorHtml}</ul>
    <h2>Competitor Source Pressure</h2>
    <ul>${competitorHtml}</ul>
    <h2>Markdown Summary</h2>
    <pre>${escapeHtml(markdown)}</pre>
  </main>
</body>
</html>`;
}

async function main() {
  const baseDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(baseDir, "citation-readiness-map");
  await mkdir(outDir, { recursive: true });

  const summaryJson = await readJsonIfExists(path.join(baseDir, "summary.json"), {});
  const master = await readJsonIfExists(path.join(baseDir, "master-dossier", "master-dossier-data.json"), {});
  const conversionRows = await readCsv(path.join(baseDir, "blog-conversion-opportunity-map", "page-conversion-priority.csv"));
  const pageMessageRows = await readCsv(path.join(baseDir, "page-message-gap-map", "page-message-gap-actions.csv"));
  const appWorkRows = await readCsv(path.join(baseDir, "citation-uplift-plan", "app-citation-workplan.csv"));
  const contractorRows = await readCsv(path.join(baseDir, "citation-uplift-plan", "contractor-citation-offload.csv"));
  const topicSourceRows = await readCsv(path.join(baseDir, "source-authority-roadmap", "topic-source-authority-priority.csv"));
  const competitorRows = await readCsv(path.join(baseDir, "source-authority-roadmap", "competitor-source-opportunities.csv"));
  const retestRows = await readCsv(path.join(baseDir, "citation-uplift-plan", "prompt-retest-queue.csv"));

  const appWorkByTitle = rowByTitle(appWorkRows, ["page_or_query"]);
  const messageByUrl = rowByUrl(pageMessageRows, ["url", "page_url"]);

  const pageRows = conversionRows.map((row) => {
    const appWork = appWorkByTitle.get(normalize(row.title)) || {};
    const message = messageByUrl.get(normalizeUrl(row.url)) || {};
    const merged = { ...message, ...row, ...appWork };
    const issues = issueList(merged);
    const bucket = readinessBucket(merged, issues);
    const priority = citationPriority(merged, issues);
    return {
      citation_priority: priority,
      page: row.title || appWork.page_or_query,
      url: row.url,
      category: row.category || message.category,
      readiness_bucket: bucket,
      page_fixes: issues.join("; ") || "light cleanup only",
      benchmark_query_count: num(row.benchmark_query_count),
      zero_mention_queries: num(row.zero_mention_queries),
      competitor_only_answers: num(row.competitor_only_answers),
      commercial_intent_score: num(row.commercial_intent_score),
      citation_fix_score: num(row.citation_fix_score),
      conversion_readiness_score: num(row.conversion_readiness_score),
      competitors: row.competitors || message.competitors,
      products_to_feature: row.products_to_feature,
      source_targets: sourceTargetsForCategory(topicSourceRows, row.category || message.category),
      contractor_why: contractorWhyForCategory(topicSourceRows, row.category || message.category),
      retest_prompts: row.retest_prompts,
      next_citation_action: nextCitationAction(bucket, merged, issues),
      app_work_action: appWork.action,
      retest_metric: appWork.retest_metric,
    };
  }).sort((a, b) => b.citation_priority - a.citation_priority || b.competitor_only_answers - a.competitor_only_answers);

  const topicMap = new Map();
  for (const row of pageRows) {
    const category = row.category || "other";
    if (!topicMap.has(category)) {
      topicMap.set(category, {
        category,
        pages: 0,
        citation_priority: 0,
        mention_first_pages: 0,
        cleanup_then_citation_pages: 0,
        external_push_pages: 0,
        zero_mention_queries: 0,
        competitor_only_answers: 0,
        source_targets: sourceTargetsForCategory(topicSourceRows, category),
        contractor_why: contractorWhyForCategory(topicSourceRows, category),
        top_competitors: new Map(),
        top_pages: [],
      });
    }
    const topic = topicMap.get(category);
    topic.pages += 1;
    topic.citation_priority += row.citation_priority;
    if (row.readiness_bucket === "Mention first, then citation") topic.mention_first_pages += 1;
    if (row.readiness_bucket === "Citation-ready after page cleanup") topic.cleanup_then_citation_pages += 1;
    if (row.readiness_bucket === "External citation push after retest") topic.external_push_pages += 1;
    topic.zero_mention_queries += row.zero_mention_queries;
    topic.competitor_only_answers += row.competitor_only_answers;
    for (const competitor of splitList(row.competitors)) addToCounter(topic.top_competitors, competitor);
    topic.top_pages.push(row.page);
  }

  const topicRows = [...topicMap.values()]
    .map((row) => ({
      ...row,
      citation_priority: Math.round(row.citation_priority),
      avg_citation_priority: clamp(row.citation_priority / Math.max(1, row.pages)),
      top_competitors: firstCounterItems(row.top_competitors, 6).join("; "),
      top_pages: row.top_pages.slice(0, 6).join("; "),
    }))
    .sort((a, b) => b.citation_priority - a.citation_priority || b.competitor_only_answers - a.competitor_only_answers);

  const searchRetestRows = retestRows.map((row, index) => ({
    rank: index + 1,
    query: row.query,
    category: row.category,
    opportunity: row.opportunity,
    baseline_mention_rate: row.baseline_mention_rate ?? row.mention_rate,
    competitors: row.competitors,
    recommended_action: row.recommended_action,
    mapped_page: row.mapped_page_url || row.mapped_page,
    citation_gate: "Retest after page fix. If iBOLT is mentioned or top-3, begin off-site citation push for the mapped page.",
  }));

  const evidence = master.evidenceSummary || {};
  const mentionSummary = master.mentionSummary || {};
  const providerSummaries = summaryJson.current?.providerSummaries || summaryJson.current?.run?.summary?.providerSummaries || [];
  const answersTested = num(evidence.total) || num(summaryJson.current?.run?.resultCount);
  const citationCount = num(evidence.citationCount);
  const mentionCount = num(evidence.mentionCount);
  const nonBrandedMentionCount = num(evidence.nonBrandedMentionCount);
  const nonBranded = num(evidence.nonBranded);
  const topThree = num(mentionSummary.topThree);
  const summary = {
    sourceBenchmarkDir: baseDir,
    answersTested,
    providerCount: providerSummaries.length,
    mentionRate: `${pct(mentionCount, answersTested)}% (${mentionCount}/${answersTested})`,
    nonBrandedMentionRate: `${pct(nonBrandedMentionCount, nonBranded)}% (${nonBrandedMentionCount}/${nonBranded})`,
    topThreeRate: `${pct(topThree, answersTested)}% (${topThree}/${answersTested})`,
    citationRate: `${pct(citationCount, answersTested)}% (${citationCount}/${answersTested})`,
    pagesScored: pageRows.length,
    mentionFirstPages: pageRows.filter((row) => row.readiness_bucket === "Mention first, then citation").length,
    cleanupThenCitationPages: pageRows.filter((row) => row.readiness_bucket === "Citation-ready after page cleanup").length,
    externalCitationPushPages: pageRows.filter((row) => row.readiness_bucket === "External citation push after retest").length,
    contractorRows: contractorRows.length,
    competitorRows: competitorRows.length,
    retestRows: searchRetestRows.length,
    topCitationPages: pageRows.slice(0, 10).map((row) => `${row.page} ${row.citation_priority}`),
    topCitationTopics: topicRows.slice(0, 6).map((row) => `${row.category} ${row.citation_priority}`),
    topCompetitorSourceTargets: competitorRows.slice(0, 6).map((row) => `${row.brand} ${row.lost_answers}`),
  };

  const pageCsv = [
    [
      "citation_priority",
      "page",
      "url",
      "category",
      "readiness_bucket",
      "page_fixes",
      "benchmark_query_count",
      "zero_mention_queries",
      "competitor_only_answers",
      "commercial_intent_score",
      "citation_fix_score",
      "conversion_readiness_score",
      "competitors",
      "products_to_feature",
      "source_targets",
      "contractor_why",
      "retest_prompts",
      "next_citation_action",
      "app_work_action",
      "retest_metric",
    ],
    ...pageRows.map((row) => [
      row.citation_priority,
      row.page,
      row.url,
      row.category,
      row.readiness_bucket,
      row.page_fixes,
      row.benchmark_query_count,
      row.zero_mention_queries,
      row.competitor_only_answers,
      row.commercial_intent_score,
      row.citation_fix_score,
      row.conversion_readiness_score,
      row.competitors,
      row.products_to_feature,
      row.source_targets,
      row.contractor_why,
      row.retest_prompts,
      row.next_citation_action,
      row.app_work_action,
      row.retest_metric,
    ]),
  ];

  const topicCsv = [
    [
      "citation_priority",
      "category",
      "pages",
      "avg_citation_priority",
      "mention_first_pages",
      "cleanup_then_citation_pages",
      "external_push_pages",
      "zero_mention_queries",
      "competitor_only_answers",
      "source_targets",
      "contractor_why",
      "top_competitors",
      "top_pages",
    ],
    ...topicRows.map((row) => [
      row.citation_priority,
      row.category,
      row.pages,
      row.avg_citation_priority,
      row.mention_first_pages,
      row.cleanup_then_citation_pages,
      row.external_push_pages,
      row.zero_mention_queries,
      row.competitor_only_answers,
      row.source_targets,
      row.contractor_why,
      row.top_competitors,
      row.top_pages,
    ]),
  ];

  const retestCsv = [
    ["rank", "opportunity", "query", "category", "baseline_mention_rate", "competitors", "recommended_action", "mapped_page", "citation_gate"],
    ...searchRetestRows.map((row) => [
      row.rank,
      row.opportunity,
      row.query,
      row.category,
      row.baseline_mention_rate,
      row.competitors,
      row.recommended_action,
      row.mapped_page,
      row.citation_gate,
    ]),
  ];

  const markdown = buildMarkdown({ summary, pageRows, topicRows, contractorRows, competitorRows });
  const html = buildHtml({ markdown, summary, pageRows, topicRows, contractorRows, competitorRows });

  await writeFile(path.join(outDir, "citation-readiness-data.json"), JSON.stringify({ summary, pageRows, topicRows, contractorRows, competitorRows, searchRetestRows }, null, 2));
  await writeFile(path.join(outDir, "page-citation-readiness.csv"), csv(pageCsv));
  await writeFile(path.join(outDir, "topic-citation-readiness.csv"), csv(topicCsv));
  await writeFile(path.join(outDir, "contractor-citation-handoff.csv"), csv([
    ["priority", "category_or_brand", "target", "why", "success_metric"],
    ...contractorRows.map((row) => [row.priority, row.category_or_brand, row.target, row.why, row.success_metric]),
  ]));
  await writeFile(path.join(outDir, "search-connected-retest-plan.csv"), csv(retestCsv));
  await writeFile(path.join(outDir, "REPORT.md"), markdown);
  await writeFile(path.join(outDir, "REPORT.html"), html);
  await buildSvgBarChart({
    title: "Citation Priority By Page",
    rows: pageRows,
    labelField: "page",
    valueField: "citation_priority",
    outputPath: path.join(outDir, "citation-priority-pages.svg"),
  });
  await buildSvgBarChart({
    title: "Citation Priority By Topic",
    rows: topicRows,
    labelField: "category",
    valueField: "citation_priority",
    outputPath: path.join(outDir, "citation-priority-topics.svg"),
    color: "#19a974",
  });

  console.log(`Wrote ${path.relative(process.cwd(), outDir)}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
