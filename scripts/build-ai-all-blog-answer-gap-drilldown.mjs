#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "all-blog-answer-gap-drilldown");

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
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const match = String(value ?? "").replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function bool(value) {
  return String(value ?? "").toLowerCase() === "true";
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function compact(value, length = 170) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 3).trim()}...` : text;
}

function keyUrl(value) {
  return String(value ?? "").trim().replace(/\/$/, "");
}

function keyTitle(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function first(...values) {
  return values.find((value) => String(value ?? "").trim()) || "";
}

function mergeList(target, value) {
  target.push(...splitList(value));
}

function addPage(pageMap, row) {
  const url = keyUrl(row.url || row.page_url);
  const title = row.title || row.page || row.closest_post || "";
  const key = url || `title:${keyTitle(title)}`;
  if (!key) return null;
  if (!pageMap.has(key)) {
    pageMap.set(key, {
      title,
      url,
      category: row.category || "",
      score: 0,
      bodyScore: 0,
      opportunityScore: 0,
      pageDecisionPriority: 0,
      promptPressureScore: 0,
      productFamilyPriority: 0,
      narrativeRiskScore: 0,
      wordCount: 0,
      issueCount: 0,
      missingAlt: 0,
      addToCartDensity: 0,
      productLinks: 0,
      productLinkDensity: 0,
      quickAnswerNearTop: "",
      faqPresent: "",
      hasFaqSchema: "",
      hasArticleSchema: "",
      comparisonPresent: "",
      productModuleLikely: "",
      aiVisibilityStage: "",
      visibilityStage: "",
      lifecycleBucket: "",
      citationLane: "",
      citationReadiness: "",
      conversionTier: "",
      pageStatus: "",
      workstream: "",
      benchmarkQueryCount: 0,
      zeroMentionQueries: 0,
      competitorOnlyAnswers: 0,
      cleanMentions: 0,
      coMentions: 0,
      primaryCompetitor: "",
      competitors: [],
      losingQueries: [],
      retestPrompts: [],
      missedProviders: [],
      productsToFeature: [],
      productFamilies: [],
      productFamilyActions: [],
      issues: [],
      issueFlags: [],
      topFix: "",
      immediateAction: "",
      primaryAction: "",
      firstMove: "",
      quickAnswerCommand: "",
      schemaCommand: "",
      comparisonCommand: "",
      productPathCommand: "",
      ctaCommand: "",
      citationAction: "",
      languageInstruction: "",
      releaseGate: "",
      successMetric: "",
      providerNarrativeRisks: [],
    });
  }
  const page = pageMap.get(key);
  page.title ||= title;
  page.url ||= url;
  page.category ||= row.category || "";
  return page;
}

function getPage(pageMap, row) {
  const url = keyUrl(row.url || row.page_url || row.page);
  if (url && pageMap.has(url)) return pageMap.get(url);
  const title = keyTitle(row.title || row.page || row.closest_post || "");
  if (!title) return null;
  for (const page of pageMap.values()) {
    if (keyTitle(page.title) === title) return page;
  }
  return null;
}

function mergeBody(page, row) {
  page.bodyScore = Math.max(page.bodyScore, toNumber(row.body_score));
  page.opportunityScore = Math.max(page.opportunityScore, toNumber(row.opportunity_score));
  page.wordCount = Math.max(page.wordCount, toNumber(row.word_count));
  page.productLinks = Math.max(page.productLinks, toNumber(row.product_links));
  page.productLinkDensity = Math.max(page.productLinkDensity, toNumber(row.product_link_density));
  page.addToCartDensity = Math.max(page.addToCartDensity, toNumber(row.add_to_cart_density));
  page.missingAlt = Math.max(page.missingAlt, toNumber(row.missing_alt));
  page.quickAnswerNearTop ||= row.quick_answer_near_top || "";
  page.faqPresent ||= row.faq_present || "";
  page.hasFaqSchema ||= row.has_faq_schema || "";
  page.hasArticleSchema ||= row.has_article_schema || "";
  page.comparisonPresent ||= row.comparison_present || "";
  page.productModuleLikely ||= row.product_module_likely || "";
  page.primaryCompetitor ||= row.primary_competitor || "";
  page.topFix ||= row.top_fix || "";
  mergeList(page.issues, row.issues);
  mergeList(page.issueFlags, row.issues);
}

function mergeControl(page, row) {
  page.pageDecisionPriority = Math.max(page.pageDecisionPriority, toNumber(row.priority));
  page.bodyScore = Math.max(page.bodyScore, toNumber(row.body_score));
  page.opportunityScore = Math.max(page.opportunityScore, toNumber(row.opportunity_score));
  page.issueCount = Math.max(page.issueCount, toNumber(row.issue_count));
  page.zeroMentionQueries = Math.max(page.zeroMentionQueries, toNumber(row.zero_mention_queries));
  page.competitorOnlyAnswers = Math.max(page.competitorOnlyAnswers, toNumber(row.competitor_only_answers));
  page.primaryCompetitor ||= row.primary_competitor || "";
  page.citationLane ||= row.citation_lane || "";
  page.visibilityStage ||= row.visibility_stage || "";
  page.aiVisibilityStage ||= row.visibility_stage || "";
  page.lifecycleBucket ||= row.lifecycle_bucket || "";
  page.workstream ||= row.batch || "";
  page.conversionTier ||= row.sprint || "";
  page.topFix ||= row.top_fix || "";
  page.immediateAction ||= row.immediate_action || "";
  page.quickAnswerCommand ||= row.quick_answer_command || "";
  page.schemaCommand ||= row.schema_command || "";
  page.comparisonCommand ||= row.comparison_command || "";
  page.productPathCommand ||= row.product_path_command || "";
  page.ctaCommand ||= row.cta_command || "";
  page.citationAction ||= row.citation_action || "";
  page.languageInstruction ||= row.language_instruction || "";
  page.releaseGate ||= row.release_gate || "";
  page.successMetric ||= row.success_metric || "";
  mergeList(page.competitors, row.competitors);
  mergeList(page.losingQueries, row.losing_queries);
  mergeList(page.missedProviders, row.missed_providers);
  mergeList(page.retestPrompts, row.retest_prompts);
  mergeList(page.productsToFeature, row.products_to_feature);
}

function mergeDrilldown(page, row) {
  page.score = Math.max(page.score, toNumber(row.score));
  page.pageStatus ||= row.page_status || "";
  page.aiVisibilityStage ||= row.ai_visibility_stage || "";
  page.workstream ||= row.workstream || "";
  page.lifecycleBucket ||= row.lifecycle_bucket || "";
  page.citationReadiness ||= row.citation_readiness_bucket || "";
  page.conversionTier ||= row.conversion_tier || "";
  page.benchmarkQueryCount = Math.max(page.benchmarkQueryCount, toNumber(row.benchmark_query_count));
  page.zeroMentionQueries = Math.max(page.zeroMentionQueries, toNumber(row.zero_mention_queries));
  page.competitorOnlyAnswers = Math.max(page.competitorOnlyAnswers, toNumber(row.competitor_only_answers));
  page.cleanMentions = Math.max(page.cleanMentions, toNumber(row.clean_mentions));
  page.coMentions = Math.max(page.coMentions, toNumber(row.co_mentions));
  page.primaryAction ||= row.primary_action || "";
  page.citationAction ||= row.citation_action || "";
  page.ctaCommand ||= row.checkout_action || page.ctaCommand;
  mergeList(page.issueFlags, row.issue_flags);
  mergeList(page.productsToFeature, row.products_to_feature);
  mergeList(page.retestPrompts, row.retest_prompts);
}

function mergeDecision(page, row) {
  page.pageDecisionPriority = Math.max(page.pageDecisionPriority, toNumber(row.priority));
  page.pageStatus ||= row.decision || "";
  page.lifecycleBucket ||= row.lifecycle_bucket || "";
  page.visibilityStage ||= row.visibility_stage || "";
  page.citationLane ||= row.citation_lane || "";
  page.topFix ||= row.top_fix || "";
  page.primaryCompetitor ||= row.primary_competitor || "";
  page.firstMove ||= row.first_move || "";
  page.releaseGate ||= row.release_gate || "";
  page.successMetric ||= row.success_metric || "";
  mergeList(page.competitors, row.competitors);
  mergeList(page.productsToFeature, row.products_to_feature);
  mergeList(page.retestPrompts, row.retest_prompts);
}

function mergePromptPage(page, row) {
  page.promptPressureScore = Math.max(page.promptPressureScore, toNumber(row.total_score));
  page.benchmarkQueryCount = Math.max(page.benchmarkQueryCount, toNumber(row.prompt_count));
  page.firstMove ||= row.first_action || "";
  mergeList(page.retestPrompts, row.example_prompts);
}

function mergeProductFamily(page, row) {
  page.productFamilyPriority = Math.max(page.productFamilyPriority, toNumber(row.priority));
  if (row.family) page.productFamilies.push(row.family);
  if (row.action) page.productFamilyActions.push(row.action);
}

function issuePenalty(page) {
  let score = 0;
  if (String(page.quickAnswerNearTop).toLowerCase() === "false") score += 35;
  if (String(page.hasFaqSchema).toLowerCase() === "false") score += 22;
  if (String(page.hasArticleSchema).toLowerCase() === "false") score += 18;
  if (String(page.comparisonPresent).toLowerCase() === "false") score += 18;
  if (page.missingAlt > 0) score += Math.min(24, page.missingAlt * 2);
  if (page.addToCartDensity >= 8) score += 22;
  if (page.wordCount > 2400) score += 10;
  return score;
}

function inferLane(page) {
  const text = [
    page.pageStatus,
    page.lifecycleBucket,
    page.aiVisibilityStage,
    page.visibilityStage,
    page.citationLane,
    page.issueFlags.join(" "),
  ].join(" ").toLowerCase();
  if (/canonical|survivor|consolidate/.test(text) && (page.competitorOnlyAnswers || page.zeroMentionQueries)) return "Canonical first, then mention recovery";
  if (/canonical|survivor|consolidate/.test(text)) return "Canonical or survivor first";
  if (page.competitorOnlyAnswers || page.zeroMentionQueries || /competitor replacement/.test(text)) return "Mention recovery refresh";
  if (/source cleanup|citation/.test(text)) return "Source cleanup before citation";
  if (page.benchmarkQueryCount <= 0) return "Needs benchmark coverage";
  return "Protect and monitor";
}

function inferFirstAction(page) {
  const lane = inferLane(page);
  if (page.firstMove) return page.firstMove;
  if (page.immediateAction) return page.immediateAction;
  if (lane.includes("Canonical")) return "Choose the survivor URL, merge useful answer blocks and product modules, then update internal/canonical links.";
  if (lane.includes("Mention")) return "Add answer-first block, exact product module, fair competitor comparison, FAQ/schema, then retest mapped prompts.";
  if (lane.includes("Source")) return "Clean source-ready answer structure, schema, image alt text, and citation targets before outreach.";
  if (lane.includes("benchmark")) return "Create or assign benchmark prompts for this page before claiming coverage.";
  return "Preserve current page while monitoring benchmark coverage and product/citation signals.";
}

function buildRows(pageMap, providerNarrativeRows) {
  const narrativeByCategory = new Map();
  for (const row of providerNarrativeRows) {
    const category = row.category || "unknown";
    if (!narrativeByCategory.has(category)) narrativeByCategory.set(category, []);
    narrativeByCategory.get(category).push(row);
  }
  return [...pageMap.values()].map((page) => {
    const narrative = narrativeByCategory.get(page.category) || [];
    const narrativeRiskScore = narrative.reduce((sum, row) => sum + toNumber(row.replacement_rate), 0);
    page.narrativeRiskScore = narrativeRiskScore;
    page.providerNarrativeRisks = narrative
      .slice()
      .sort((a, b) => toNumber(b.replacement_rate) - toNumber(a.replacement_rate))
      .slice(0, 4)
      .map((row) => `${row.provider} ${row.replacement_rate}% replacement`);
    const lane = inferLane(page);
    const totalScore = Math.round(
      page.score
      + page.pageDecisionPriority
      + page.promptPressureScore * 0.08
      + page.productFamilyPriority * 0.04
      + page.narrativeRiskScore * 0.35
      + page.competitorOnlyAnswers * 40
      + page.zeroMentionQueries * 50
      + page.benchmarkQueryCount * 4
      + issuePenalty(page),
    );
    return {
      ...page,
      totalScore,
      lane,
      firstAction: inferFirstAction(page),
      competitors: unique(page.competitors),
      losingQueries: unique(page.losingQueries),
      retestPrompts: unique(page.retestPrompts),
      missedProviders: unique(page.missedProviders),
      productsToFeature: unique(page.productsToFeature),
      productFamilies: unique(page.productFamilies),
      productFamilyActions: unique(page.productFamilyActions),
      issues: unique(page.issues),
      issueFlags: unique(page.issueFlags),
      providerNarrativeRisks: unique(page.providerNarrativeRisks),
    };
  }).sort((a, b) => b.totalScore - a.totalScore || a.title.localeCompare(b.title));
}

function groupCategory(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = row.category || "unknown";
    if (!map.has(key)) {
      map.set(key, {
        category: key,
        pages: 0,
        score: 0,
        competitorOnlyAnswers: 0,
        zeroMentionQueries: 0,
        benchmarkQueryCount: 0,
        canonicalFirst: 0,
        mentionRecovery: 0,
        noCoverage: 0,
        topCompetitors: [],
        topPages: [],
      });
    }
    const item = map.get(key);
    item.pages += 1;
    item.score += row.totalScore;
    item.competitorOnlyAnswers += row.competitorOnlyAnswers;
    item.zeroMentionQueries += row.zeroMentionQueries;
    item.benchmarkQueryCount += row.benchmarkQueryCount;
    if (/canonical/i.test(row.lane)) item.canonicalFirst += 1;
    if (/mention/i.test(row.lane)) item.mentionRecovery += 1;
    if (/benchmark/.test(row.lane)) item.noCoverage += 1;
    item.topCompetitors.push(...row.competitors);
    item.topPages.push(row.title);
  }
  return [...map.values()].map((item) => ({
    ...item,
    topCompetitors: topNamed(item.topCompetitors, 8),
    topPages: unique(item.topPages).slice(0, 8),
  })).sort((a, b) => b.score - a.score || a.category.localeCompare(b.category));
}

function topNamed(values, limit = 8) {
  const counts = new Map();
  for (const value of values) {
    const text = String(value ?? "").replace(/\s+\d+$/, "").trim();
    if (!text) continue;
    counts.set(text, (counts.get(text) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => `${name} ${count}`);
}

function barSvg({ title, rows, valueKey = "value", labelKey = "label", color = "#0f766e", width = 920 }) {
  const chartRows = rows.slice(0, 12);
  const rowHeight = 36;
  const height = 78 + chartRows.length * rowHeight;
  const max = Math.max(1, ...chartRows.map((row) => toNumber(row[valueKey])));
  const bars = chartRows.map((row, index) => {
    const y = 58 + index * rowHeight;
    const value = toNumber(row[valueKey]);
    const barWidth = Math.max(3, Math.round((value / max) * (width - 390)));
    return `<g>
      <text x="20" y="${y + 17}" font-size="13" font-weight="900" fill="#111827">${escapeHtml(compact(row[labelKey], 38))}</text>
      <rect x="310" y="${y}" width="${width - 390}" height="22" rx="11" fill="#e5e7eb"/>
      <rect x="310" y="${y}" width="${barWidth}" height="22" rx="11" fill="${color}"/>
      <text x="${width - 58}" y="${y + 17}" font-size="13" font-weight="900" text-anchor="end" fill="#111827">${escapeHtml(value)}</text>
    </g>`;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="14" fill="#fff"/>
    <text x="20" y="32" font-size="19" font-weight="900" fill="#111827">${escapeHtml(title)}</text>
    ${bars}
  </svg>`;
}

function renderTable(headers, rows) {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table>${head}${body}</table>`;
}

function renderHtml({ pageRows, categoryRows, noCoverageRows }) {
  const topPages = pageRows.slice(0, 35).map((row) => [
    row.totalScore,
    row.title,
    row.category,
    row.lane,
    row.competitorOnlyAnswers,
    row.zeroMentionQueries,
    row.primaryCompetitor || row.competitors.slice(0, 3).join("; "),
    row.topFix,
    row.firstAction,
  ]);
  const categoryTable = categoryRows.map((row) => [
    row.category,
    row.pages,
    row.score,
    row.competitorOnlyAnswers,
    row.zeroMentionQueries,
    row.canonicalFirst,
    row.mentionRecovery,
    row.topCompetitors.join("; "),
  ]);
  const noCoverageTable = noCoverageRows.slice(0, 40).map((row) => [
    row.title,
    row.category,
    row.bodyScore,
    row.opportunityScore,
    row.issueFlags.slice(0, 6).join("; "),
    row.firstAction,
  ]);
  const issueRows = pageRows.slice(0, 45).map((row) => [
    row.title,
    row.category,
    row.wordCount,
    row.quickAnswerNearTop,
    row.hasFaqSchema,
    row.hasArticleSchema,
    row.comparisonPresent,
    row.missingAlt,
    row.addToCartDensity,
    row.issueFlags.slice(0, 6).join("; "),
  ]);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>All Blog Answer Gap Drilldown</title>
  <style>
    body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1240px;margin:0 auto;padding:34px 24px 70px}
    h1{font-size:36px;margin:0 0 8px}
    h2{font-size:24px;margin:34px 0 12px}
    p,li{font-size:15px;line-height:1.55;color:#334155}
    .note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #0f766e;border-radius:12px;padding:16px 18px;margin:18px 0}
    .cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:20px 0}
    .card{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:16px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:900}
    .value{font-size:28px;font-weight:900;margin:8px 0;color:#0f172a}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    svg{width:100%;height:auto;border:1px solid #dbe3ef;border-radius:14px}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 22px}
    th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    a{color:#0f766e;overflow-wrap:anywhere}
    code{background:#e2e8f0;border-radius:5px;padding:2px 5px}
    @media(max-width:900px){.cards,.grid{grid-template-columns:1fr}h1{font-size:30px}}
  </style>
</head>
<body>
<main>
  <h1>All Blog Answer Gap Drilldown</h1>
  <p>One row per live blog/page, joining AI answer losses, body inspection, page decision gates, product-family pressure, and retest prompts.</p>
  <div class="note"><strong>Use this report for edit sequencing:</strong> canonical-first pages should not be rewritten blindly. Pick the survivor, merge the useful answer blocks, add product modules and schema, then retest the exact prompts attached to that page.</div>

  <section class="cards">
    <div class="card"><div class="label">Pages scored</div><div class="value">${pageRows.length}</div><p>Blog/page rows in the combined drilldown.</p></div>
    <div class="card"><div class="label">Canonical first</div><div class="value">${pageRows.filter((row) => /canonical/i.test(row.lane)).length}</div><p>Pages that need survivor decisions before broad edits.</p></div>
    <div class="card"><div class="label">Mention recovery</div><div class="value">${pageRows.filter((row) => /mention/i.test(row.lane)).length}</div><p>Pages tied to zero-mention or competitor-only prompts.</p></div>
    <div class="card"><div class="label">No benchmark coverage</div><div class="value">${noCoverageRows.length}</div><p>Pages needing prompts before claims can be verified.</p></div>
    <div class="card"><div class="label">Competitor-only rows</div><div class="value">${pageRows.reduce((sum, row) => sum + row.competitorOnlyAnswers, 0)}</div><p>Answer losses tied back to mapped pages.</p></div>
  </section>

  <section class="grid">
    ${barSvg({ title: "Top Blog Answer Gaps", rows: pageRows.map((row) => ({ label: row.title, value: row.totalScore })), color: "#b91c1c" })}
    ${barSvg({ title: "Category Blog Pressure", rows: categoryRows.map((row) => ({ label: row.category, value: row.score })), color: "#1d4ed8" })}
  </section>

  <h2>Top Page Fix Queue</h2>
  ${renderTable(["Score", "Page", "Category", "Lane", "Competitor-only", "Zero-mention", "Primary competitor", "Top fix", "First action"], topPages)}

  <h2>Category Rollup</h2>
  ${renderTable(["Category", "Pages", "Score", "Competitor-only", "Zero-mention", "Canonical first", "Mention recovery", "Top competitors"], categoryTable)}

  <h2>Body And Schema Issues</h2>
  ${renderTable(["Page", "Category", "Words", "Quick answer", "FAQ schema", "Article schema", "Comparison", "Missing alt", "Cart density", "Issue flags"], issueRows)}

  <h2>No Or Low Benchmark Coverage</h2>
  ${renderTable(["Page", "Category", "Body score", "Opportunity", "Issues", "First action"], noCoverageTable)}
</main>
</body>
</html>`;
}

function renderMarkdown({ pageRows, categoryRows, noCoverageRows }) {
  return `# All Blog Answer Gap Drilldown

## Summary

- Pages scored: ${pageRows.length}
- Canonical-first pages: ${pageRows.filter((row) => /canonical/i.test(row.lane)).length}
- Mention-recovery pages: ${pageRows.filter((row) => /mention/i.test(row.lane)).length}
- No or low benchmark coverage pages: ${noCoverageRows.length}
- Competitor-only answer rows tied to pages: ${pageRows.reduce((sum, row) => sum + row.competitorOnlyAnswers, 0)}

## Top Page Gaps

${pageRows.slice(0, 20).map((row) => `- ${row.title}: ${row.lane}. Score ${row.totalScore}. First action: ${row.firstAction}`).join("\n")}

## Category Pressure

${categoryRows.map((row) => `- ${row.category}: ${row.pages} pages, score ${row.score}, ${row.competitorOnlyAnswers} competitor-only rows.`).join("\n")}
`;
}

async function main() {
  const pageMap = new Map();
  const allPageRows = await readCsv("all-page-ai-drilldown/all-page-ai-drilldown.csv");
  const bodyRows = await readCsv("blog-body-inspection/blog-body-inspection.csv");
  const controlRows = await readCsv("all-blog-action-control-sheet/all-blog-action-control-sheet.csv");
  const decisionRows = await readCsv("page-decision-map/page-decision-map.csv");
  const promptPageRows = await readCsv("prompt-loss-decision-board/prompt-page-actions.csv");
  const productFamilyPageRows = await readCsv("product-family-visibility-board/product-family-page-action-map.csv");
  const narrativeRows = await readCsv("mention-narrative-drilldown/provider-category-narrative.csv");

  for (const row of allPageRows) {
    const page = addPage(pageMap, row);
    if (page) mergeDrilldown(page, row);
  }
  for (const row of bodyRows) {
    const page = getPage(pageMap, row) || addPage(pageMap, row);
    if (page) mergeBody(page, row);
  }
  for (const row of controlRows) {
    const page = getPage(pageMap, row) || addPage(pageMap, row);
    if (page) mergeControl(page, row);
  }
  for (const row of decisionRows) {
    const page = getPage(pageMap, row) || addPage(pageMap, row);
    if (page) mergeDecision(page, row);
  }
  for (const row of promptPageRows) {
    const page = getPage(pageMap, row);
    if (page) mergePromptPage(page, row);
  }
  for (const row of productFamilyPageRows) {
    const page = getPage(pageMap, row) || [...pageMap.values()].find((candidate) => keyTitle(candidate.title) === keyTitle(row.page));
    if (page) mergeProductFamily(page, row);
  }

  const pageRows = buildRows(pageMap, narrativeRows);
  const categoryRows = groupCategory(pageRows);
  const noCoverageRows = pageRows
    .filter((row) => row.benchmarkQueryCount <= 0)
    .sort((a, b) => b.opportunityScore - a.opportunityScore || b.bodyScore - a.bodyScore || a.title.localeCompare(b.title));

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml({ pageRows, categoryRows, noCoverageRows }));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown({ pageRows, categoryRows, noCoverageRows }));
  await writeFile(path.join(outDir, "all-blog-answer-gap-drilldown.csv"), csv([
    [
      "rank",
      "total_score",
      "title",
      "url",
      "category",
      "lane",
      "body_score",
      "opportunity_score",
      "word_count",
      "benchmark_query_count",
      "zero_mention_queries",
      "competitor_only_answers",
      "clean_mentions",
      "co_mentions",
      "primary_competitor",
      "competitors",
      "top_fix",
      "quick_answer_near_top",
      "has_faq_schema",
      "has_article_schema",
      "comparison_present",
      "missing_alt",
      "add_to_cart_density",
      "product_families",
      "products_to_feature",
      "retest_prompts",
      "first_action",
      "release_gate",
      "success_metric",
    ],
    ...pageRows.map((row, index) => [
      index + 1,
      row.totalScore,
      row.title,
      row.url,
      row.category,
      row.lane,
      row.bodyScore,
      row.opportunityScore,
      row.wordCount,
      row.benchmarkQueryCount,
      row.zeroMentionQueries,
      row.competitorOnlyAnswers,
      row.cleanMentions,
      row.coMentions,
      row.primaryCompetitor,
      row.competitors.join("; "),
      row.topFix,
      row.quickAnswerNearTop,
      row.hasFaqSchema,
      row.hasArticleSchema,
      row.comparisonPresent,
      row.missingAlt,
      row.addToCartDensity,
      row.productFamilies.join("; "),
      row.productsToFeature.join("; "),
      row.retestPrompts.join("; "),
      row.firstAction,
      row.releaseGate,
      row.successMetric,
    ]),
  ]));
  await writeFile(path.join(outDir, "category-blog-risk-rollup.csv"), csv([
    ["category", "pages", "score", "competitor_only_answers", "zero_mention_queries", "benchmark_query_count", "canonical_first_pages", "mention_recovery_pages", "no_coverage_pages", "top_competitors", "top_pages"],
    ...categoryRows.map((row) => [
      row.category,
      row.pages,
      row.score,
      row.competitorOnlyAnswers,
      row.zeroMentionQueries,
      row.benchmarkQueryCount,
      row.canonicalFirst,
      row.mentionRecovery,
      row.noCoverage,
      row.topCompetitors.join("; "),
      row.topPages.join("; "),
    ]),
  ]));
  await writeFile(path.join(outDir, "all-blog-edit-priority-queue.csv"), csv([
    ["rank", "title", "url", "category", "lane", "score", "top_fix", "first_action", "retest_prompts", "products_to_feature"],
    ...pageRows.slice(0, 80).map((row, index) => [
      index + 1,
      row.title,
      row.url,
      row.category,
      row.lane,
      row.totalScore,
      row.topFix,
      row.firstAction,
      row.retestPrompts.slice(0, 10).join("; "),
      row.productsToFeature.slice(0, 8).join("; "),
    ]),
  ]));
  await writeFile(path.join(outDir, "low-coverage-blog-pages.csv"), csv([
    ["title", "url", "category", "body_score", "opportunity_score", "issues", "first_action"],
    ...noCoverageRows.map((row) => [
      row.title,
      row.url,
      row.category,
      row.bodyScore,
      row.opportunityScore,
      row.issueFlags.join("; "),
      row.firstAction,
    ]),
  ]));

  console.log(`Wrote ${outDir}`);
  console.log(`Pages scored: ${pageRows.length}`);
  console.log(`Canonical-first pages: ${pageRows.filter((row) => /canonical/i.test(row.lane)).length}`);
  console.log(`No/low coverage pages: ${noCoverageRows.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
