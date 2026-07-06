import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";

const THEME_LABELS = new Map([
  ["rugged/durable", "Rugged durability"],
  ["easy install", "Install clarity"],
  ["stability/grip", "Stability and grip"],
  ["compatibility", "Compatibility"],
  ["adjustable/flexible", "Adjustability"],
  ["commercial/pro", "Commercial/pro use"],
  ["budget/value", "Value without budget positioning"],
  ["secure/locking", "Security and locking"],
]);

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

function normalizeQuery(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTheme(value) {
  const text = String(value ?? "").replace(/\s+\d+$/, "").trim();
  return THEME_LABELS.get(text.toLowerCase()) || text;
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

function plainCounterNames(map, count = 6) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, count)
    .map(([name]) => name);
}

function rowByUrl(rows, field = "url") {
  const map = new Map();
  for (const row of rows) {
    const url = normalizeUrl(row[field] || row.page_url || row.url);
    if (url) map.set(url, row);
  }
  return map;
}

function buildQueryMaps(queryRows) {
  const byQuery = new Map();
  const byCategoryQuery = new Map();
  for (const row of queryRows) {
    const query = normalizeQuery(row.query);
    const categoryQuery = `${String(row.category || "").toLowerCase()}::${query}`;
    if (query) byQuery.set(query, row);
    if (query) byCategoryQuery.set(categoryQuery, row);
  }
  return { byQuery, byCategoryQuery };
}

function queryLanguageForPrompt(prompt, category, maps) {
  const normalized = normalizeQuery(prompt);
  return maps.byCategoryQuery.get(`${String(category || "").toLowerCase()}::${normalized}`) || maps.byQuery.get(normalized);
}

function parseThemeRows(value) {
  return splitList(value).map(normalizeTheme).filter(Boolean);
}

function buildCategoryDefaults(copyRows, lifecycleSummary) {
  const categoryThemes = new Map();
  for (const row of copyRows) {
    for (const categoryItem of splitList(row.affected_categories)) {
      const match = categoryItem.match(/^(.*)\s+(\d+)$/);
      const category = (match ? match[1] : categoryItem).trim();
      const count = match ? num(match[2]) : 1;
      if (!categoryThemes.has(category)) categoryThemes.set(category, new Map());
      addToCounter(categoryThemes.get(category), row.theme, count + Math.max(0, num(row.gap_points) / 10));
    }
  }

  const topicRows = lifecycleSummary.topicRows || [];
  for (const topic of topicRows) {
    if (!categoryThemes.has(topic.category)) categoryThemes.set(topic.category, new Map());
    if (num(topic.benchmark_pages) > 0 || num(topic.competitor_only_answers) > 0) {
      addToCounter(categoryThemes.get(topic.category), "Rugged durability", 3);
      addToCounter(categoryThemes.get(topic.category), "Install clarity", 3);
      addToCounter(categoryThemes.get(topic.category), "Stability and grip", 2);
      addToCounter(categoryThemes.get(topic.category), "Compatibility", 2);
    }
  }
  return categoryThemes;
}

function actionForPage({ portfolio, lifecycle, pageAction, matchedQueryRows }) {
  const lifecycleBucket = lifecycle.lifecycle_bucket || "";
  const duplicateRisk = String(pageAction.duplicate_risk || portfolio.action_bucket || "").toLowerCase().includes("yes") ||
    lifecycleBucket.toLowerCase().includes("canonical") ||
    String(portfolio.canonical_or_survivor_ticket || lifecycle.canonical_or_survivor_ticket || "").trim();
  const benchmarkPressure = num(portfolio.benchmark_query_count || lifecycle.benchmark_query_count || pageAction.query_count) > 0 ||
    num(portfolio.competitor_only_answers || lifecycle.competitor_only_answers || pageAction.competitor_only_answers) > 0 ||
    matchedQueryRows.length > 0;
  const score = num(portfolio.ai_citability_score || lifecycle.ai_citability_score || pageAction.avg_page_score);

  if (duplicateRisk) return "Canonical review before edit";
  if (benchmarkPressure) return "AI visibility refresh";
  if (score < 68 || lifecycleBucket === "Legacy rewrite") return "Legacy answer-first rewrite";
  if (String(portfolio.missing_quick_answer) === "yes" || String(portfolio.missing_faq_schema) === "yes" || String(portfolio.missing_article_schema) === "yes") {
    return "Citation/schema cleanup";
  }
  return "Protect and amplify";
}

function firstEditInstruction({ action, themes, pageAction, portfolio, lifecycle }) {
  const promptText = splitList(pageAction.retest_prompts || portfolio.linked_prompts || lifecycle.linked_prompts).slice(0, 3).join("; ");
  const themeText = themes.slice(0, 4).join(", ");
  if (action === "Canonical review before edit") {
    return `Choose the survivor page first, then merge answer blocks for ${promptText || "mapped buyer prompts"} with ${themeText || "message-gap"} proof points.`;
  }
  if (action === "AI visibility refresh") {
    return `Add a query-exact quick answer, product module, comparison section, FAQ schema, and ${themeText || "message-gap"} proof points for ${promptText || "the mapped prompts"}.`;
  }
  if (action === "Legacy answer-first rewrite") {
    return `Rewrite into an answer-first guide with current products, FAQ schema, comparison language, and ${themeText || "category"} proof points.`;
  }
  if (action === "Citation/schema cleanup") {
    return `Add quick answer, FAQPage or Article schema, image alt text, and ${themeText || "category"} proof points without changing the page target.`;
  }
  return `Keep the page live, add internal links and external citation targets, and preserve ${themeText || "existing"} strengths.`;
}

function buildPageRows({ portfolioRows, lifecycleRows, pageActionRows, refreshBriefRows, queryRows, copyRows, lifecycleSummary }) {
  const lifecycleByUrl = rowByUrl(lifecycleRows);
  const pageActionByUrl = rowByUrl(pageActionRows, "page_url");
  const refreshByUrl = rowByUrl(refreshBriefRows, "page_url");
  const queryMaps = buildQueryMaps(queryRows);
  const copyByTheme = new Map(copyRows.map((row) => [row.theme, row]));
  const categoryDefaults = buildCategoryDefaults(copyRows, lifecycleSummary);

  return portfolioRows.map((portfolio) => {
    const url = normalizeUrl(portfolio.url);
    const lifecycle = lifecycleByUrl.get(url) || {};
    const pageAction = pageActionByUrl.get(url) || {};
    const refresh = refreshByUrl.get(url) || {};
    const category = portfolio.category || lifecycle.category || pageAction.category || refresh.category || "";
    const prompts = [
      ...splitList(portfolio.linked_prompts),
      ...splitList(lifecycle.linked_prompts),
      ...splitList(pageAction.retest_prompts),
      ...splitList(refresh.query_prompts),
    ];
    const uniquePrompts = [...new Set(prompts.map((prompt) => prompt.trim()).filter(Boolean))];
    const matchedQueryRows = uniquePrompts
      .map((prompt) => queryLanguageForPrompt(prompt, category, queryMaps))
      .filter(Boolean);

    const themeCounter = new Map();
    const competitorCounter = new Map();
    const providerCounter = new Map();
    const angleSet = new Set();
    for (const queryRow of matchedQueryRows) {
      for (const theme of parseThemeRows(queryRow.themes)) addToCounter(themeCounter, theme, 10);
      for (const competitor of splitList(queryRow.competitors).map(normalizeTheme)) addToCounter(competitorCounter, competitor, 1);
      for (const provider of splitList(queryRow.lost_providers)) addToCounter(providerCounter, provider, 1);
      for (const angle of splitList(queryRow.recommended_angles)) angleSet.add(angle);
    }
    for (const competitor of splitList(portfolio.competitors || lifecycle.competitors || pageAction.competitors)) {
      addToCounter(competitorCounter, normalizeTheme(competitor), 1);
    }
    const defaultThemes = categoryDefaults.get(category) || new Map();
    for (const [theme, value] of defaultThemes) addToCounter(themeCounter, theme, value);

    const themes = plainCounterNames(themeCounter, 6);
    const action = actionForPage({ portfolio, lifecycle, pageAction, matchedQueryRows });
    const fixes = [];
    if (String(portfolio.missing_quick_answer) === "yes" || String(pageAction.issues || "").toLowerCase().includes("quick answer")) fixes.push("quick answer");
    if (String(portfolio.missing_faq_schema) === "yes" || String(pageAction.issues || "").toLowerCase().includes("faq")) fixes.push("FAQ schema");
    if (String(portfolio.missing_article_schema) === "yes") fixes.push("Article/BlogPosting schema");
    if (String(portfolio.missing_comparison) === "yes" || String(pageAction.issues || "").toLowerCase().includes("comparison")) fixes.push("comparison block");
    if (num(portfolio.missing_alt_count) > 0 || String(pageAction.issues || "").toLowerCase().includes("image alt")) fixes.push("image alt text");

    const themeActions = themes
      .map((theme) => copyByTheme.get(theme))
      .filter(Boolean)
      .slice(0, 4);
    const schemaFixes = [...new Set(themeActions.map((row) => row.schema_fix).filter(Boolean))];
    const pageCopyBlocks = [...new Set(themeActions.map((row) => row.page_copy).filter(Boolean))];
    const proofPoints = [...new Set(themeActions.map((row) => row.proof_points).filter(Boolean))];
    const competitorOnlyAnswers = num(portfolio.competitor_only_answers || lifecycle.competitor_only_answers || pageAction.competitor_only_answers);
    const benchmarkQueryCount = num(portfolio.benchmark_query_count || lifecycle.benchmark_query_count || pageAction.query_count);
    const zeroMentionQueries = num(portfolio.zero_mention_queries || pageAction.zero_mention_queries);
    const citability = num(portfolio.ai_citability_score || lifecycle.ai_citability_score || pageAction.avg_page_score);
    const priority =
      competitorOnlyAnswers * 45 +
      zeroMentionQueries * 55 +
      benchmarkQueryCount * 35 +
      matchedQueryRows.length * 30 +
      Math.max(0, 85 - citability) * 2 +
      fixes.length * 12 +
      (action === "Canonical review before edit" ? 40 : 0);

    return {
      priority: Math.round(priority),
      action,
      title: portfolio.title || lifecycle.title || pageAction.page_title || "",
      url,
      slug: portfolio.slug || url.split("/").pop() || "",
      category,
      lifecycleBucket: lifecycle.lifecycle_bucket || "",
      citabilityScore: citability,
      wordCount: num(portfolio.word_count || lifecycle.word_count),
      productLinks: num(portfolio.product_links || lifecycle.product_links),
      productEntityTargets: num(portfolio.product_entity_targets || lifecycle.product_entity_targets),
      benchmarkQueryCount,
      zeroMentionQueries,
      competitorOnlyAnswers,
      competitors: plainCounterNames(competitorCounter, 10),
      missingFixes: fixes,
      messageThemes: themes,
      lostProviders: plainCounterNames(providerCounter, 4),
      linkedPrompts: uniquePrompts,
      pageCopyBlocks,
      schemaFixes,
      proofPoints,
      recommendedAngles: [...angleSet].slice(0, 3),
      productModule: pageAction.product_module || refresh.product_module || "",
      canonicalTicket: portfolio.canonical_or_survivor_ticket || lifecycle.canonical_or_survivor_ticket || "",
      firstEditInstruction: firstEditInstruction({ action, themes, pageAction, portfolio, lifecycle }),
      retestPrompts: splitList(pageAction.retest_prompts || refresh.query_prompts || portfolio.linked_prompts || lifecycle.linked_prompts),
    };
  }).sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title));
}

function buildTopicRows(pageRows) {
  const groups = new Map();
  for (const row of pageRows) {
    if (!groups.has(row.category)) {
      groups.set(row.category, {
        category: row.category,
        pages: 0,
        priority: 0,
        scores: [],
        benchmarkPages: 0,
        canonicalPages: 0,
        competitorOnlyAnswers: 0,
        themeCounter: new Map(),
        competitorCounter: new Map(),
        actionCounter: new Map(),
      });
    }
    const group = groups.get(row.category);
    group.pages += 1;
    group.priority += row.priority;
    group.scores.push(row.citabilityScore);
    if (row.benchmarkQueryCount || row.competitorOnlyAnswers) group.benchmarkPages += 1;
    if (row.action === "Canonical review before edit") group.canonicalPages += 1;
    group.competitorOnlyAnswers += row.competitorOnlyAnswers;
    for (const theme of row.messageThemes) addToCounter(group.themeCounter, theme);
    for (const competitor of row.competitors) addToCounter(group.competitorCounter, competitor);
    addToCounter(group.actionCounter, row.action);
  }

  return [...groups.values()]
    .map((group) => ({
      category: group.category,
      pages: group.pages,
      priority: Math.round(group.priority),
      avgCitabilityScore: avg(group.scores),
      benchmarkPages: group.benchmarkPages,
      canonicalPages: group.canonicalPages,
      competitorOnlyAnswers: group.competitorOnlyAnswers,
      topMessageThemes: firstCounterItems(group.themeCounter, 6),
      topCompetitors: firstCounterItems(group.competitorCounter, 6),
      actions: firstCounterItems(group.actionCounter, 6),
      firstAction: categoryFirstAction(group),
    }))
    .sort((a, b) => b.priority - a.priority || a.category.localeCompare(b.category));
}

function categoryFirstAction(group) {
  const themes = plainCounterNames(group.themeCounter, 4).join(", ");
  if (group.canonicalPages > 0) {
    return `Resolve ${group.canonicalPages} canonical/survivor decisions, then refresh pages with ${themes || "message-gap"} blocks.`;
  }
  if (group.benchmarkPages > 0) {
    return `Refresh benchmark-pressure pages with ${themes || "query-exact"} blocks and retest mapped prompts.`;
  }
  return `Apply schema cleanup and ${themes || "category"} proof points to improve citation readiness.`;
}

function buildSprintRows(pageRows) {
  const sprint1 = pageRows
    .filter((row) => row.priority > 0 && (row.benchmarkQueryCount || row.competitorOnlyAnswers || row.zeroMentionQueries))
    .slice(0, 18)
    .map((row, index) => ({ sprint: "Sprint 1", order: index + 1, ...row }));
  const used = new Set(sprint1.map((row) => row.url));
  const sprint2 = pageRows
    .filter((row) => !used.has(row.url) && row.priority > 0 && row.action !== "Protect and amplify")
    .slice(0, 40)
    .map((row, index) => ({ sprint: "Sprint 2", order: index + 1, ...row }));
  const used2 = new Set([...used, ...sprint2.map((row) => row.url)]);
  const sprint3 = pageRows
    .filter((row) => !used2.has(row.url))
    .slice(0, 40)
    .map((row, index) => ({ sprint: "Sprint 3", order: index + 1, ...row }));
  return [...sprint1, ...sprint2, ...sprint3];
}

function simpleBarSvg({ rows, labelKey, valueKey, title, width = 980, height = 430 }) {
  const margin = { top: 54, right: 28, bottom: 108, left: 58 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const max = Math.max(1, ...rows.map((row) => num(row[valueKey])));
  const barWidth = chartWidth / Math.max(rows.length, 1);
  const bars = rows.map((row, index) => {
    const value = num(row[valueKey]);
    const barHeight = Math.round((value / max) * chartHeight);
    const x = margin.left + index * barWidth + 8;
    const y = margin.top + chartHeight - barHeight;
    const w = Math.max(12, barWidth - 16);
    const label = String(row[labelKey] ?? "").slice(0, 26);
    return `<rect x="${x}" y="${y}" width="${w}" height="${barHeight}" rx="5" fill="#0f172a"/>
<text x="${x + w / 2}" y="${y - 8}" text-anchor="middle" font-size="13" font-weight="700" fill="#0f172a">${escapeHtml(value)}</text>
<text x="${x + w / 2}" y="${margin.top + chartHeight + 18}" text-anchor="end" transform="rotate(-38 ${x + w / 2} ${margin.top + chartHeight + 18})" font-size="12" fill="#334155">${escapeHtml(label)}</text>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
<rect width="${width}" height="${height}" fill="#f8fafc"/>
<text x="${margin.left}" y="32" font-size="22" font-weight="800" fill="#111827">${escapeHtml(title)}</text>
<line x1="${margin.left}" y1="${margin.top + chartHeight}" x2="${width - margin.right}" y2="${margin.top + chartHeight}" stroke="#cbd5e1"/>
${bars}
</svg>`;
}

function buildMarkdown({ summary, topicRows, pageRows, sprintRows }) {
  return `# Blog Page Message Gap Map

This report joins the AI message-gap analysis to every live blog page. It answers: which pages should carry which buyer-decision language, which pages need canonical review before edits, and which pages should be refreshed first for AI visibility.

## Summary

- Live pages mapped: ${summary.pages}
- Benchmark-pressure pages: ${summary.benchmarkPressurePages}
- Canonical-review pages: ${summary.canonicalReviewPages}
- Pages needing AI visibility refresh: ${summary.aiVisibilityRefreshPages}
- Pages needing citation/schema cleanup: ${summary.citationCleanupPages}
- Legacy rewrite pages: ${summary.legacyRewritePages}
- Protect/amplify pages: ${summary.protectAmplifyPages}
- Top page themes: ${summary.topMessageThemes.join(", ")}
- Top competitor pressures: ${summary.topCompetitors.join(", ")}

## Topic Priority

| Category | Priority | Pages | Benchmark pages | Canonical pages | Competitor-only answers | Top message themes | First action |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
${topicRows.map((row) => `| ${row.category} | ${row.priority} | ${row.pages} | ${row.benchmarkPages} | ${row.canonicalPages} | ${row.competitorOnlyAnswers} | ${row.topMessageThemes.join("; ")} | ${row.firstAction} |`).join("\n")}

## First Pages To Touch

| Priority | Action | Page | Category | Prompts | Themes | Competitors | First edit |
| ---: | --- | --- | --- | --- | --- | --- | --- |
${pageRows.slice(0, 25).map((row) => `| ${row.priority} | ${row.action} | [${row.title}](${row.url}) | ${row.category} | ${row.linkedPrompts.slice(0, 3).join("; ")} | ${row.messageThemes.slice(0, 5).join("; ")} | ${row.competitors.slice(0, 6).join("; ")} | ${row.firstEditInstruction} |`).join("\n")}

## Sprint Queue

| Sprint | Order | Action | Page | Themes | Retest prompts |
| --- | ---: | --- | --- | --- | --- |
${sprintRows.slice(0, 36).map((row) => `| ${row.sprint} | ${row.order} | ${row.action} | [${row.title}](${row.url}) | ${row.messageThemes.slice(0, 4).join("; ")} | ${row.retestPrompts.slice(0, 4).join("; ")} |`).join("\n")}

## Brand-Safe Rule

When the benchmark says competitors win on budget/value language, do not reposition iBOLT as cheap. Use right-fit kits, reusable modular components, 24-business-hour shipping, fewer wrong parts, and warranty value instead.
`;
}

function buildHtml({ summary, topicRows, pageRows, sprintRows }) {
  const cards = [
    ["Live pages", summary.pages, "all mapped"],
    ["Benchmark pressure", summary.benchmarkPressurePages, "pages tied to AI prompts"],
    ["Canonical first", summary.canonicalReviewPages, "review before edits"],
    ["AI refresh", summary.aiVisibilityRefreshPages, "visibility edits"],
    ["Schema cleanup", summary.citationCleanupPages, "citation readiness"],
    ["Top theme", summary.topMessageThemes[0] || "n/a", "message gap"],
  ].map(([label, value, note]) => `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");
  const topicTable = topicRows.map((row) => `<tr><td>${escapeHtml(row.category)}</td><td>${row.priority}</td><td>${row.pages}</td><td>${row.benchmarkPages}</td><td>${row.canonicalPages}</td><td>${row.competitorOnlyAnswers}</td><td>${escapeHtml(row.topMessageThemes.join("; "))}</td><td>${escapeHtml(row.topCompetitors.join("; "))}</td><td>${escapeHtml(row.firstAction)}</td></tr>`).join("");
  const pageTable = pageRows.slice(0, 45).map((row) => `<tr><td>${row.priority}</td><td>${escapeHtml(row.action)}</td><td><a href="${escapeHtml(row.url)}">${escapeHtml(row.title)}</a></td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.linkedPrompts.slice(0, 4).join("; "))}</td><td>${escapeHtml(row.messageThemes.slice(0, 5).join("; "))}</td><td>${escapeHtml(row.competitors.slice(0, 7).join("; "))}</td><td>${escapeHtml(row.missingFixes.join("; "))}</td><td>${escapeHtml(row.firstEditInstruction)}</td></tr>`).join("");
  const sprintTable = sprintRows.slice(0, 54).map((row) => `<tr><td>${escapeHtml(row.sprint)}</td><td>${row.order}</td><td>${escapeHtml(row.action)}</td><td><a href="${escapeHtml(row.url)}">${escapeHtml(row.title)}</a></td><td>${escapeHtml(row.messageThemes.slice(0, 4).join("; "))}</td><td>${escapeHtml(row.retestPrompts.slice(0, 4).join("; "))}</td></tr>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>iBOLT Blog Page Message Gap Map</title>
<style>
body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}main{max-width:1260px;margin:0 auto;padding:34px 26px 60px}h1{font-size:34px;margin:0 0 8px}h2{font-size:22px;margin:34px 0 14px}p{color:#334155;line-height:1.55}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}.k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700}.v{font-size:30px;font-weight:800;margin-top:8px}.chart{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:12px;margin:18px 0}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden}th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}a{color:#0f172a;font-weight:700}.note{border-left:6px solid #0f172a;background:#fff;border-radius:10px;padding:16px 18px;border-top:1px solid #d7dee8;border-right:1px solid #d7dee8;border-bottom:1px solid #d7dee8}
</style></head><body><main>
<h1>iBOLT Blog Page Message Gap Map</h1>
<p class="note"><strong>Purpose:</strong> This joins the AI answer language gaps to all live blog pages, so page edits target the exact proof points that competitors are currently getting credit for.</p>
<section class="cards">${cards}</section>
<div class="chart"><img src="topic-message-priority.svg" alt="Topic message priority chart" style="width:100%;height:auto"/></div>
<div class="chart"><img src="page-message-priority.svg" alt="Page message priority chart" style="width:100%;height:auto"/></div>
<h2>Topic Priority</h2>
<table><thead><tr><th>Category</th><th>Priority</th><th>Pages</th><th>Benchmark pages</th><th>Canonical pages</th><th>Competitor-only</th><th>Message themes</th><th>Competitors</th><th>First action</th></tr></thead><tbody>${topicTable}</tbody></table>
<h2>First Pages To Touch</h2>
<table><thead><tr><th>Priority</th><th>Action</th><th>Page</th><th>Category</th><th>Prompts</th><th>Themes</th><th>Competitors</th><th>Missing fixes</th><th>First edit</th></tr></thead><tbody>${pageTable}</tbody></table>
<h2>Sprint Queue</h2>
<table><thead><tr><th>Sprint</th><th>Order</th><th>Action</th><th>Page</th><th>Themes</th><th>Retest prompts</th></tr></thead><tbody>${sprintTable}</tbody></table>
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, "page-message-gap-map");
  await mkdir(outDir, { recursive: true });

  const portfolioRows = await readCsv(path.join(benchmarkDir, "blog-portfolio-map", "blog-page-portfolio-ledger.csv"));
  const lifecycleRows = await readCsv(path.join(benchmarkDir, "blog-lifecycle-map", "page-lifecycle-ledger.csv"));
  const pageActionRows = await readCsv(path.join(benchmarkDir, "query-page-matrix", "page-action-matrix.csv"));
  const refreshBriefRows = await readCsv(path.join(benchmarkDir, "page-refresh-playbook", "page-refresh-briefs.csv"));
  const queryRows = await readCsv(path.join(benchmarkDir, "message-gap-map", "query-language-map.csv"));
  const copyRows = await readCsv(path.join(benchmarkDir, "message-gap-map", "copy-blocks-to-add.csv"));
  const lifecycleData = await readJsonIfExists(path.join(benchmarkDir, "blog-lifecycle-map", "blog-lifecycle-data.json"), { summary: {} });
  const messageGapData = await readJsonIfExists(path.join(benchmarkDir, "message-gap-map", "message-gap-data.json"), { summary: {} });

  const pageRows = buildPageRows({
    portfolioRows,
    lifecycleRows,
    pageActionRows,
    refreshBriefRows,
    queryRows,
    copyRows,
    lifecycleSummary: lifecycleData.summary || {},
  });
  const topicRows = buildTopicRows(pageRows);
  const sprintRows = buildSprintRows(pageRows);

  const actionCounter = new Map();
  const themeCounter = new Map();
  const competitorCounter = new Map();
  for (const row of pageRows) {
    addToCounter(actionCounter, row.action);
    for (const theme of row.messageThemes) addToCounter(themeCounter, theme);
    for (const competitor of row.competitors) addToCounter(competitorCounter, competitor);
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    benchmarkDir,
    pages: pageRows.length,
    benchmarkPressurePages: pageRows.filter((row) => row.benchmarkQueryCount || row.competitorOnlyAnswers || row.zeroMentionQueries).length,
    canonicalReviewPages: pageRows.filter((row) => row.action === "Canonical review before edit").length,
    aiVisibilityRefreshPages: pageRows.filter((row) => row.action === "AI visibility refresh").length,
    citationCleanupPages: pageRows.filter((row) => row.action === "Citation/schema cleanup").length,
    legacyRewritePages: pageRows.filter((row) => row.action === "Legacy answer-first rewrite").length,
    protectAmplifyPages: pageRows.filter((row) => row.action === "Protect and amplify").length,
    avgCitabilityScore: avg(pageRows.map((row) => row.citabilityScore)),
    topMessageThemes: firstCounterItems(themeCounter, 8),
    topCompetitors: firstCounterItems(competitorCounter, 10),
    actionRows: firstCounterItems(actionCounter, 8),
    sourceMessageGapSummary: messageGapData.summary || {},
  };

  await writeFile(path.join(outDir, "page-message-gap-data.json"), JSON.stringify({ summary, topicRows, pageRows, sprintRows }, null, 2));
  await writeFile(path.join(outDir, "page-message-gap-actions.csv"), csv([
    ["priority", "action", "title", "url", "category", "lifecycle_bucket", "citability_score", "word_count", "product_links", "product_entity_targets", "benchmark_query_count", "zero_mention_queries", "competitor_only_answers", "competitors", "missing_fixes", "message_themes", "lost_providers", "linked_prompts", "page_copy_blocks", "schema_fixes", "proof_points", "recommended_angles", "product_module", "canonical_ticket", "first_edit_instruction", "retest_prompts"],
    ...pageRows.map((row) => [
      row.priority,
      row.action,
      row.title,
      row.url,
      row.category,
      row.lifecycleBucket,
      row.citabilityScore,
      row.wordCount,
      row.productLinks,
      row.productEntityTargets,
      row.benchmarkQueryCount,
      row.zeroMentionQueries,
      row.competitorOnlyAnswers,
      row.competitors,
      row.missingFixes,
      row.messageThemes,
      row.lostProviders,
      row.linkedPrompts,
      row.pageCopyBlocks,
      row.schemaFixes,
      row.proofPoints,
      row.recommendedAngles,
      row.productModule,
      row.canonicalTicket,
      row.firstEditInstruction,
      row.retestPrompts,
    ]),
  ]));
  await writeFile(path.join(outDir, "topic-message-gap-summary.csv"), csv([
    ["category", "priority", "pages", "avg_citability_score", "benchmark_pages", "canonical_pages", "competitor_only_answers", "top_message_themes", "top_competitors", "actions", "first_action"],
    ...topicRows.map((row) => [
      row.category,
      row.priority,
      row.pages,
      row.avgCitabilityScore,
      row.benchmarkPages,
      row.canonicalPages,
      row.competitorOnlyAnswers,
      row.topMessageThemes,
      row.topCompetitors,
      row.actions,
      row.firstAction,
    ]),
  ]));
  await writeFile(path.join(outDir, "sprint-page-edit-queue.csv"), csv([
    ["sprint", "order", "priority", "action", "title", "url", "category", "message_themes", "competitors", "first_edit_instruction", "retest_prompts"],
    ...sprintRows.map((row) => [
      row.sprint,
      row.order,
      row.priority,
      row.action,
      row.title,
      row.url,
      row.category,
      row.messageThemes,
      row.competitors,
      row.firstEditInstruction,
      row.retestPrompts,
    ]),
  ]));
  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown({ summary, topicRows, pageRows, sprintRows }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({ summary, topicRows, pageRows, sprintRows }));
  await writeFile(path.join(outDir, "topic-message-priority.svg"), simpleBarSvg({
    rows: topicRows.slice(0, 10),
    labelKey: "category",
    valueKey: "priority",
    title: "Topic Priority After Applying Message Gaps",
  }));
  await writeFile(path.join(outDir, "page-message-priority.svg"), simpleBarSvg({
    rows: pageRows.slice(0, 12),
    labelKey: "title",
    valueKey: "priority",
    title: "First Pages To Touch For AI Message Gaps",
    height: 500,
  }));

  console.log(`Wrote ${outDir}`);
  console.log(`Mapped ${summary.pages} pages. Top themes: ${summary.topMessageThemes.slice(0, 5).join("; ")}`);
  console.log(`First pages: ${pageRows.slice(0, 5).map((row) => row.title).join(" | ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
