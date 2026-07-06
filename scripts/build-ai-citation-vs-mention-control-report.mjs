import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";
const REPORT_DIR = "citation-vs-mention-control-report";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(numerator, denominator) {
  return denominator ? Math.round((number(numerator) / number(denominator)) * 100) : 0;
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\biBolt\b/g, "iBOLT")
    .replace(/\bIbolt\b/g, "iBOLT")
    .replace(/\bIBOLT\b/g, "iBOLT")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function splitList(value) {
  return normalizeText(value)
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
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

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
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
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const headers = rows.shift() || [];
  return rows
    .filter((cells) => cells.some((value) => value !== ""))
    .map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

async function readCsv(filePath) {
  return parseCsv(await readFile(filePath, "utf8"));
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

function decisionLane(row) {
  const pageStatus = normalizeText(row.page_status);
  const lifecycle = normalizeText(row.lifecycle_bucket);
  const workstream = normalizeText(row.workstream);
  const readiness = normalizeText(row.citation_readiness_bucket);
  const issues = normalizeText(row.issue_flags);
  const competitorOnly = number(row.competitor_only_answers);
  const zeroMention = number(row.zero_mention_queries);
  const cleanMentions = number(row.clean_mentions);
  const coMentions = number(row.co_mentions);
  const citabilityScore = number(row.ai_citability_score);
  const canonicalFirst = /canonical/i.test(`${pageStatus} ${lifecycle} ${workstream}`);

  if (canonicalFirst && (competitorOnly > 0 || zeroMention > 0)) {
    return "Canonical plus mention recovery first";
  }
  if (competitorOnly > 0 || zeroMention > 0 || /Mention first/i.test(readiness)) {
    return "Mention recovery before citation";
  }
  if (/schema|quick answer|faq|product module|image alt|page structure/i.test(issues) || /cleanup|structure/i.test(readiness)) {
    return "Source-ready cleanup before citation";
  }
  if ((cleanMentions > 0 || coMentions > 0) && citabilityScore >= 80) {
    return "External citation push candidate";
  }
  return "Monitor and retest";
}

function citationTiming(lane) {
  if (lane === "External citation push candidate") return "Start citation outreach now";
  if (lane === "Source-ready cleanup before citation") return "Finish schema, quick-answer, FAQ, and product proof blocks first";
  if (lane === "Mention recovery before citation") return "Wait until retest shows iBOLT included or recommended";
  if (lane === "Canonical plus mention recovery first") return "Pick survivor URL, edit that page, then retest before outreach";
  return "Monitor until the page has a benchmark win or clear citation target";
}

function citationNecessity(row, summary) {
  const priority = number(row.control_priority_score);
  const competitorOnly = number(row.competitor_only_answers);
  const providerRequests = number(row.provider_requests);
  const category = normalizeText(row.category);
  const highCitationCategory = /restaurant|delivery|fleet|warehouse|fishing|amps|streaming/i.test(category);
  if (summary.citationRate === 0 && (priority >= 140 || competitorOnly >= 3 || providerRequests >= 9 || highCitationCategory)) {
    return "High";
  }
  if (priority >= 90 || highCitationCategory) return "Medium";
  return "Low";
}

function buildPageRows({ ledgerRows, citationRows, competitorActionRows, manifestRows, summary }) {
  const citationByUrl = new Map(citationRows.map((row) => [row.url, row]));
  const competitorByUrl = groupBy(competitorActionRows, (row) => row.url);
  const manifestByUrl = groupBy(manifestRows, (row) => row.page_url);

  return ledgerRows.map((row) => {
    const citation = citationByUrl.get(row.url) || {};
    const competitorActions = competitorByUrl.get(row.url) || [];
    const manifest = manifestByUrl.get(row.url) || [];
    const providers = uniq(manifest.map((item) => item.provider));
    const promptTypes = uniq(manifest.map((item) => item.prompt_type));
    const prompts = uniq([
      ...splitList(row.retest_prompts),
      ...manifest.map((item) => item.prompt),
    ]);
    const brands = uniq([
      ...splitList(row.competitors).map((item) => item.replace(/\s+\d+$/, "")),
      ...competitorActions.map((item) => item.brand),
    ]);
    const lane = decisionLane(row);
    const controlPriorityScore =
      number(row.priority_score) +
      Math.round(number(citation.citation_priority) / 4) +
      number(row.competitor_only_answers) * 12 +
      number(row.zero_mention_queries) * 10 +
      competitorActions.length * 2 +
      manifest.length;

    const output = {
      rank: number(row.rank),
      control_priority_score: controlPriorityScore,
      title: normalizeText(row.title),
      url: row.url,
      category: normalizeText(row.category || citation.category),
      lane,
      citation_necessity: "",
      citation_timing: citationTiming(lane),
      ai_visibility_stage: normalizeText(row.ai_visibility_stage),
      page_status: normalizeText(row.page_status),
      citation_readiness_bucket: normalizeText(row.citation_readiness_bucket || citation.readiness_bucket),
      ai_citability_score: number(row.ai_citability_score),
      benchmark_query_count: number(row.benchmark_query_count || citation.benchmark_query_count),
      zero_mention_queries: number(row.zero_mention_queries || citation.zero_mention_queries),
      competitor_only_answers: number(row.competitor_only_answers || citation.competitor_only_answers),
      clean_mentions: number(row.clean_mentions),
      co_mentions: number(row.co_mentions),
      provider_requests_ready: manifest.length,
      unique_retest_prompts: prompts.length,
      prompt_types: promptTypes.join("; "),
      providers: providers.join("; "),
      competitor_count: brands.length,
      competitors: brands.slice(0, 10).join("; "),
      products_to_feature: normalizeText(row.products_to_feature || citation.products_to_feature),
      source_targets: normalizeText(row.source_targets || citation.source_targets),
      primary_action: normalizeText(row.primary_action || citation.app_work_action),
      citation_action: normalizeText(row.citation_action || citation.next_citation_action),
      retest_prompts: prompts.slice(0, 12).join("; "),
    };
    output.citation_necessity = citationNecessity(output, summary);
    return output;
  }).sort((a, b) => b.control_priority_score - a.control_priority_score);
}

function buildCategoryRows(pageRows, manifestRows) {
  const pageByCategory = groupBy(pageRows, (row) => row.category || "uncategorized");
  const promptByCategory = groupBy(manifestRows, (row) => row.category || "uncategorized");
  return [...pageByCategory.entries()].map(([category, rows]) => {
    const prompts = promptByCategory.get(category) || [];
    const promptTypes = groupBy(prompts, (row) => row.prompt_type || "unknown");
    const laneCounts = groupBy(rows, (row) => row.lane);
    const topPages = rows.slice(0, 5).map((row) => row.title);
    const competitorOnly = rows.reduce((sum, row) => sum + number(row.competitor_only_answers), 0);
    const zeroMention = rows.reduce((sum, row) => sum + number(row.zero_mention_queries), 0);
    const highNecessity = rows.filter((row) => row.citation_necessity === "High").length;
    let recommendedSequence = "Source-ready cleanup, then external citations";
    if (laneCounts.get("Canonical plus mention recovery first")?.length) {
      recommendedSequence = "Resolve canonical survivor pages, edit, retest, then cite";
    } else if (competitorOnly || zeroMention) {
      recommendedSequence = "Mention recovery and comparison blocks first, then cite";
    }
    return {
      category,
      pages: rows.length,
      high_citation_necessity_pages: highNecessity,
      canonical_plus_mention_pages: laneCounts.get("Canonical plus mention recovery first")?.length || 0,
      mention_recovery_pages: laneCounts.get("Mention recovery before citation")?.length || 0,
      source_cleanup_pages: laneCounts.get("Source-ready cleanup before citation")?.length || 0,
      external_push_pages: laneCounts.get("External citation push candidate")?.length || 0,
      competitor_only_answers: competitorOnly,
      zero_mention_queries: zeroMention,
      unique_prompts_ready: uniq(prompts.map((row) => row.prompt)).length,
      provider_requests_ready: prompts.length,
      prompt_types: [...promptTypes.entries()].map(([type, typeRows]) => `${type} ${typeRows.length}`).join("; "),
      top_pages: topPages.join("; "),
      recommended_sequence: recommendedSequence,
    };
  }).sort((a, b) => b.high_citation_necessity_pages - a.high_citation_necessity_pages || b.provider_requests_ready - a.provider_requests_ready);
}

function buildCompetitorRows({ competitorRows, competitorActionRows }) {
  const actionByBrand = groupBy(competitorActionRows, (row) => row.brand);
  return competitorRows.map((row) => {
    const actions = actionByBrand.get(row.brand) || [];
    return {
      brand: normalizeText(row.brand),
      tier: actions.find((item) => item.tier)?.tier || "Tracked competitor",
      replacement_rows: number(row.replacement_rows),
      co_mentions: number(row.co_mentions),
      mapped_page_actions: actions.length,
      categories: normalizeText(row.categories),
      top_pages: uniq(actions.map((item) => item.title)).slice(0, 6).join("; "),
      counter_positioning: normalizeText(row.counter_positioning),
      citation_sequence: number(row.replacement_rows) > number(row.co_mentions)
        ? "Win inclusion beside this brand first, then pursue third-party citations"
        : "Protect co-mentions with source-ready pages and external citations",
    };
  }).sort((a, b) => b.replacement_rows - a.replacement_rows || b.mapped_page_actions - a.mapped_page_actions);
}

function buildTypeRows(manifestRows) {
  return [...groupBy(manifestRows, (row) => row.prompt_type || "unknown").entries()]
    .map(([type, rows]) => ({
      prompt_type: type,
      unique_prompts: uniq(rows.map((row) => row.prompt)).length,
      provider_requests: rows.length,
      pages_covered: uniq(rows.map((row) => row.page_url)).filter(Boolean).length,
      top_categories: [...groupBy(rows, (row) => row.category || "uncategorized").entries()]
        .map(([category, categoryRows]) => ({ category, count: categoryRows.length }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
        .map((row) => `${row.category} ${row.count}`)
        .join("; "),
    }))
    .sort((a, b) => b.provider_requests - a.provider_requests);
}

function barSvg({ title, subtitle, rows, width = 1040, height = 430, color = "#2563eb", suffix = "" }) {
  const margin = { top: 78, right: 76, bottom: 34, left: 310 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(...rows.map((row) => number(row.value)), 1);
  const rowHeight = chartHeight / Math.max(rows.length, 1);
  const body = rows.map((row, index) => {
    const y = margin.top + index * rowHeight + 6;
    const h = Math.max(13, rowHeight - 12);
    const w = Math.round((number(row.value) / maxValue) * chartWidth);
    return `
      <text x="${margin.left - 14}" y="${y + h / 2 + 5}" text-anchor="end" font-size="14" fill="#334155">${escapeHtml(row.name)}</text>
      <rect x="${margin.left}" y="${y}" width="${w}" height="${h}" rx="6" fill="${color}"></rect>
      <text x="${margin.left + w + 10}" y="${y + h / 2 + 5}" font-size="14" font-weight="800" fill="#0f172a">${escapeHtml(row.value)}${escapeHtml(suffix)}</text>
    `;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <text x="28" y="36" font-size="25" font-weight="900" fill="#0f172a">${escapeHtml(title)}</text>
  <text x="28" y="62" font-size="14" fill="#64748b">${escapeHtml(subtitle)}</text>
  ${body}
</svg>`;
}

function groupedLaneSvg({ rows, width = 1040, height = 420 }) {
  const laneColors = {
    "Canonical plus mention recovery first": "#7c3aed",
    "Mention recovery before citation": "#dc2626",
    "Source-ready cleanup before citation": "#f59e0b",
    "External citation push candidate": "#16a34a",
    "Monitor and retest": "#94a3b8",
  };
  const cardW = 190;
  const gap = 14;
  const left = 34;
  const top = 96;
  const max = Math.max(...rows.map((row) => number(row.count)), 1);
  const cards = rows.map((row, index) => {
    const x = left + index * (cardW + gap);
    const barHeight = Math.max(8, Math.round((number(row.count) / max) * 88));
    const color = laneColors[row.name] || "#2563eb";
    return `
      <rect x="${x}" y="${top}" width="${cardW}" height="230" rx="14" fill="#ffffff" stroke="#d7dee8"/>
      <rect x="${x + 16}" y="${top + 124 - barHeight}" width="${cardW - 32}" height="${barHeight}" rx="9" fill="${color}"/>
      <text x="${x + 16}" y="${top + 156}" font-size="34" font-weight="900" fill="#0f172a">${escapeHtml(row.count)}</text>
      <foreignObject x="${x + 16}" y="${top + 172}" width="${cardW - 32}" height="50">
        <div xmlns="http://www.w3.org/1999/xhtml" style="font:700 12px Arial;color:#334155;line-height:1.25">${escapeHtml(row.name)}</div>
      </foreignObject>
    `;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#f8fafc"/>
  <text x="28" y="38" font-size="26" font-weight="900" fill="#0f172a">Citation Timing Lanes</text>
  <text x="28" y="64" font-size="14" fill="#64748b">Most pages should not get citation outreach until canonical, mention, and schema fixes are done.</text>
  ${cards}
</svg>`;
}

function table(rows, columns) {
  const header = columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");
  const body = rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(row[column.key])}</td>`).join("")}</tr>`).join("");
  return `<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
}

function buildMarkdown({ summary, pageRows, categoryRows, competitorRows, typeRows }) {
  return `# Citation vs Mention Control Report

## Short Answer

Yes, citation rate needs to go up, but the current data says citation work is downstream from mention and recommendation work.

- Current mention rate: ${summary.mentionRate}% (${summary.mentionCount}/${summary.totalAnswers}).
- Current non-branded mention rate: ${summary.nonBrandedMentionRate}% (${summary.nonBrandedMentionCount}/${summary.nonBrandedAnswers}).
- Current top-3 recommendation rate: ${summary.topThreeRate}% (${summary.topThreeCount}/${summary.totalAnswers}).
- Current target-domain citation rate: ${summary.citationRate}% (${summary.citationCount}/${summary.totalAnswers}).
- Competitor replacement rows: ${summary.competitorOnlyRows}/${summary.totalAnswers}.
- Expanded test coverage ready: ${summary.expandedPrompts} prompts and ${summary.providerRequests} provider requests.

## What This Means

The immediate goal is not just to earn links. The immediate goal is to make iBOLT easier for AI systems to include, recommend, and cite. Off-site citation work is still necessary, especially for Google AI Overviews, Perplexity, Gemini with search, and ChatGPT search, but most priority pages first need on-site answer blocks, comparison context, product proof, and schema cleanup.

## Citation Timing Lanes

| Lane | Pages |
| --- | ---: |
${summary.laneRows.map((row) => `| ${row.name} | ${row.count} |`).join("\n")}

## Highest Priority Pages

| Page | Category | Lane | Citation need | Score | Competitors | Retest prompts |
| --- | --- | --- | --- | ---: | --- | --- |
${pageRows.slice(0, 16).map((row) => `| ${row.title} | ${row.category} | ${row.lane} | ${row.citation_necessity} | ${row.control_priority_score} | ${row.competitors} | ${row.retest_prompts} |`).join("\n")}

## Category Sequence

| Category | Pages | High citation need | Provider requests | Competitor-only answers | Sequence |
| --- | ---: | ---: | ---: | ---: | --- |
${categoryRows.map((row) => `| ${row.category} | ${row.pages} | ${row.high_citation_necessity_pages} | ${row.provider_requests_ready} | ${row.competitor_only_answers} | ${row.recommended_sequence} |`).join("\n")}

## Competitor Citation Strategy

| Competitor | Replacement rows | Co-mentions | Page actions | Sequence |
| --- | ---: | ---: | ---: | --- |
${competitorRows.slice(0, 12).map((row) => `| ${row.brand} | ${row.replacement_rows} | ${row.co_mentions} | ${row.mapped_page_actions} | ${row.citation_sequence} |`).join("\n")}

## Prompt Coverage Ready For Retesting

| Prompt type | Unique prompts | Provider requests | Pages covered | Top categories |
| --- | ---: | ---: | ---: | --- |
${typeRows.map((row) => `| ${row.prompt_type} | ${row.unique_prompts} | ${row.provider_requests} | ${row.pages_covered} | ${row.top_categories} |`).join("\n")}

## Practical Recommendation

1. Use the first page queue for on-site edits: canonical survivor, answer block, comparison section, product module, FAQ/schema.
2. Retest the exact mapped prompts one at a time across ChatGPT, Gemini, and Claude.
3. Start contractor citation outreach only after a page has a stable survivor URL and enough on-page source material to cite.
4. For RAM Mounts, Arkon, iOttie, ProClip, CTA Digital, and Mount-It, prioritize third-party pages that place iBOLT in the same consideration set, not generic backlink volume.
`;
}

function buildHtml({ summary, pageRows, categoryRows, competitorRows, typeRows }) {
  const cards = [
    ["Mention rate", `${summary.mentionRate}%`, `${summary.mentionCount}/${summary.totalAnswers}`],
    ["Non-branded mention", `${summary.nonBrandedMentionRate}%`, `${summary.nonBrandedMentionCount}/${summary.nonBrandedAnswers}`],
    ["Top-3 recommendation", `${summary.topThreeRate}%`, `${summary.topThreeCount}/${summary.totalAnswers}`],
    ["Citation rate", `${summary.citationRate}%`, `${summary.citationCount}/${summary.totalAnswers}`],
    ["High citation need pages", summary.highCitationNeedPages, "but mostly after page fixes"],
    ["Expanded retest requests", summary.providerRequests, `${summary.expandedPrompts} prompts`],
  ].map(([label, value, note]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>iBOLT Citation vs Mention Control Report</title>
<style>
body{margin:0;background:#f8fafc;color:#0f172a;font-family:Arial,Helvetica,sans-serif}main{max-width:1240px;margin:0 auto;padding:34px 26px 64px}h1{font-size:34px;margin:0 0 8px}h2{font-size:22px;margin:34px 0 14px}p{color:#334155;line-height:1.55}.note{background:#fff;border-left:6px solid #2563eb;border-top:1px solid #d7dee8;border-right:1px solid #d7dee8;border-bottom:1px solid #d7dee8;border-radius:10px;padding:16px 18px}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:20px 0}.card{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}.label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:800}.value{font-size:31px;font-weight:900;margin-top:8px}.chart{background:#fff;border:1px solid #d7dee8;border-radius:14px;margin:18px 0;padding:12px;overflow:auto}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden;margin:12px 0 24px}th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}code{background:#eef2f7;padding:2px 5px;border-radius:5px}
</style></head><body><main>
<h1>iBOLT Citation vs Mention Control Report</h1>
<p class="note"><strong>Read:</strong> Citation rate should be a KPI, but it is downstream from inclusion. The current citation rate is ${summary.citationRate}%, while non-branded mention is only ${summary.nonBrandedMentionRate}%. Most high-value pages should be edited and retested before off-site citation outreach.</p>
<section class="cards">${cards}</section>
<h2>Charts</h2>
<div class="chart"><img src="citation-timing-lanes.svg" alt="Citation timing lanes"/></div>
<div class="chart"><img src="highest-priority-citation-pages.svg" alt="Highest priority citation pages"/></div>
<div class="chart"><img src="category-citation-sequence.svg" alt="Category citation sequence"/></div>
<div class="chart"><img src="expanded-prompt-type-coverage.svg" alt="Expanded prompt type coverage"/></div>
<h2>Highest Priority Pages</h2>
${table(pageRows.slice(0, 24), [
  { key: "title", label: "Page" },
  { key: "category", label: "Category" },
  { key: "lane", label: "Lane" },
  { key: "citation_necessity", label: "Need" },
  { key: "control_priority_score", label: "Score" },
  { key: "competitors", label: "Competitors" },
  { key: "retest_prompts", label: "Retest prompts" },
])}
<h2>Category Sequence</h2>
${table(categoryRows, [
  { key: "category", label: "Category" },
  { key: "pages", label: "Pages" },
  { key: "high_citation_necessity_pages", label: "High need" },
  { key: "provider_requests_ready", label: "Requests" },
  { key: "competitor_only_answers", label: "Competitor-only" },
  { key: "recommended_sequence", label: "Sequence" },
])}
<h2>Competitor Strategy</h2>
${table(competitorRows.slice(0, 16), [
  { key: "brand", label: "Brand" },
  { key: "replacement_rows", label: "Replacements" },
  { key: "co_mentions", label: "Co-mentions" },
  { key: "mapped_page_actions", label: "Page actions" },
  { key: "citation_sequence", label: "Sequence" },
])}
<h2>Prompt Coverage Ready For Retesting</h2>
${table(typeRows, [
  { key: "prompt_type", label: "Prompt type" },
  { key: "unique_prompts", label: "Prompts" },
  { key: "provider_requests", label: "Requests" },
  { key: "pages_covered", label: "Pages" },
  { key: "top_categories", label: "Top categories" },
])}
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, REPORT_DIR);
  await mkdir(outDir, { recursive: true });

  const citationData = await readJson(path.join(benchmarkDir, "citation-rate-visibility-dashboard", "citation-rate-visibility-data.json"));
  const pageDerivedData = await readJson(path.join(benchmarkDir, "page-derived-expanded-benchmark-pack", "page-derived-expanded-benchmark-data.json"));
  const blogControlData = await readJson(path.join(benchmarkDir, "blog-post-visibility-control-report", "blog-post-visibility-control-data.json"));
  const citationRows = await readCsv(path.join(benchmarkDir, "citation-readiness-map", "page-citation-readiness.csv"));
  const ledgerRows = await readCsv(path.join(benchmarkDir, "blog-post-visibility-control-report", "blog-page-control-ledger.csv"));
  const competitorActionRows = await readCsv(path.join(benchmarkDir, "competitor-battlecard-control-report", "competitor-page-actions.csv"));
  const competitorRowsInput = await readCsv(path.join(benchmarkDir, "citation-rate-visibility-dashboard", "competitor-citation-targets.csv"));
  const manifestRows = await readCsv(path.join(benchmarkDir, "page-derived-expanded-benchmark-pack", "provider-request-manifest.csv"));

  const baseSummary = citationData.summary || {};
  const pageRows = buildPageRows({
    ledgerRows,
    citationRows,
    competitorActionRows,
    manifestRows,
    summary: baseSummary,
  });
  const categoryRows = buildCategoryRows(pageRows, manifestRows);
  const competitorRows = buildCompetitorRows({ competitorRows: competitorRowsInput, competitorActionRows });
  const typeRows = buildTypeRows(manifestRows);
  const laneRows = [...groupBy(pageRows, (row) => row.lane).entries()]
    .map(([name, rows]) => ({ name, count: rows.length }))
    .sort((a, b) => b.count - a.count);

  const summary = {
    benchmarkDir,
    totalAnswers: number(baseSummary.totalAnswers),
    mentionCount: number(baseSummary.mentionCount),
    mentionRate: number(baseSummary.mentionRate),
    nonBrandedAnswers: number(baseSummary.nonBrandedAnswers),
    nonBrandedMentionCount: number(baseSummary.nonBrandedMentionCount),
    nonBrandedMentionRate: number(baseSummary.nonBrandedMentionRate),
    topThreeCount: number(baseSummary.topThreeCount),
    topThreeRate: number(baseSummary.topThreeRate),
    citationCount: number(baseSummary.citationCount),
    citationRate: number(baseSummary.citationRate),
    competitorOnlyRows: number(baseSummary.competitorOnlyRows),
    livePages: pageRows.length,
    highCitationNeedPages: pageRows.filter((row) => row.citation_necessity === "High").length,
    citationNowCandidates: pageRows.filter((row) => row.lane === "External citation push candidate").length,
    mentionOrCanonicalFirstPages: pageRows.filter((row) => /Mention recovery|Canonical plus/.test(row.lane)).length,
    sourceCleanupPages: pageRows.filter((row) => row.lane === "Source-ready cleanup before citation").length,
    expandedPrompts: number(pageDerivedData.summary?.prompts || baseSummary.expandedPrompts),
    providerRequests: number(pageDerivedData.summary?.providerRequests || baseSummary.providerRequests),
    blogControlPages: number(blogControlData.summary?.pages),
    laneRows,
  };

  await writeFile(path.join(outDir, "citation-vs-mention-page-queue.csv"), toCsv([
    [
      "rank",
      "control_priority_score",
      "title",
      "url",
      "category",
      "lane",
      "citation_necessity",
      "citation_timing",
      "ai_visibility_stage",
      "page_status",
      "citation_readiness_bucket",
      "ai_citability_score",
      "benchmark_query_count",
      "zero_mention_queries",
      "competitor_only_answers",
      "clean_mentions",
      "co_mentions",
      "provider_requests_ready",
      "unique_retest_prompts",
      "prompt_types",
      "providers",
      "competitor_count",
      "competitors",
      "products_to_feature",
      "source_targets",
      "primary_action",
      "citation_action",
      "retest_prompts",
    ],
    ...pageRows.map((row) => [
      row.rank,
      row.control_priority_score,
      row.title,
      row.url,
      row.category,
      row.lane,
      row.citation_necessity,
      row.citation_timing,
      row.ai_visibility_stage,
      row.page_status,
      row.citation_readiness_bucket,
      row.ai_citability_score,
      row.benchmark_query_count,
      row.zero_mention_queries,
      row.competitor_only_answers,
      row.clean_mentions,
      row.co_mentions,
      row.provider_requests_ready,
      row.unique_retest_prompts,
      row.prompt_types,
      row.providers,
      row.competitor_count,
      row.competitors,
      row.products_to_feature,
      row.source_targets,
      row.primary_action,
      row.citation_action,
      row.retest_prompts,
    ]),
  ]));

  await writeFile(path.join(outDir, "category-citation-sequence.csv"), toCsv([
    [
      "category",
      "pages",
      "high_citation_necessity_pages",
      "canonical_plus_mention_pages",
      "mention_recovery_pages",
      "source_cleanup_pages",
      "external_push_pages",
      "competitor_only_answers",
      "zero_mention_queries",
      "unique_prompts_ready",
      "provider_requests_ready",
      "prompt_types",
      "top_pages",
      "recommended_sequence",
    ],
    ...categoryRows.map((row) => [
      row.category,
      row.pages,
      row.high_citation_necessity_pages,
      row.canonical_plus_mention_pages,
      row.mention_recovery_pages,
      row.source_cleanup_pages,
      row.external_push_pages,
      row.competitor_only_answers,
      row.zero_mention_queries,
      row.unique_prompts_ready,
      row.provider_requests_ready,
      row.prompt_types,
      row.top_pages,
      row.recommended_sequence,
    ]),
  ]));

  await writeFile(path.join(outDir, "competitor-citation-sequence.csv"), toCsv([
    ["brand", "tier", "replacement_rows", "co_mentions", "mapped_page_actions", "categories", "top_pages", "counter_positioning", "citation_sequence"],
    ...competitorRows.map((row) => [
      row.brand,
      row.tier,
      row.replacement_rows,
      row.co_mentions,
      row.mapped_page_actions,
      row.categories,
      row.top_pages,
      row.counter_positioning,
      row.citation_sequence,
    ]),
  ]));

  await writeFile(path.join(outDir, "expanded-prompt-type-coverage.csv"), toCsv([
    ["prompt_type", "unique_prompts", "provider_requests", "pages_covered", "top_categories"],
    ...typeRows.map((row) => [row.prompt_type, row.unique_prompts, row.provider_requests, row.pages_covered, row.top_categories]),
  ]));

  await writeFile(path.join(outDir, "citation-vs-mention-data.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    summary,
    pageRows,
    categoryRows,
    competitorRows,
    typeRows,
  }, null, 2));

  await writeFile(path.join(outDir, "citation-timing-lanes.svg"), groupedLaneSvg({ rows: laneRows }));
  await writeFile(path.join(outDir, "highest-priority-citation-pages.svg"), barSvg({
    title: "Highest Priority Pages",
    subtitle: "Combined score from current page risk, citation readiness, competitor pressure, and expanded retest coverage.",
    rows: pageRows.slice(0, 12).map((row) => ({ name: row.title.slice(0, 58), value: row.control_priority_score })),
    color: "#7c3aed",
  }));
  await writeFile(path.join(outDir, "category-citation-sequence.svg"), barSvg({
    title: "High Citation Need By Category",
    subtitle: "Categories where citation work matters, usually after mention recovery and source-ready cleanup.",
    rows: categoryRows.slice(0, 10).map((row) => ({ name: row.category, value: row.high_citation_necessity_pages })),
    color: "#0f766e",
  }));
  await writeFile(path.join(outDir, "expanded-prompt-type-coverage.svg"), barSvg({
    title: "Expanded Prompt Coverage Ready",
    subtitle: `${summary.expandedPrompts} prompts and ${summary.providerRequests} provider requests are staged for the next live benchmark.`,
    rows: typeRows.map((row) => ({ name: row.prompt_type, value: row.provider_requests })),
    color: "#2563eb",
  }));

  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown({ summary, pageRows, categoryRows, competitorRows, typeRows }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({ summary, pageRows, categoryRows, competitorRows, typeRows }));

  console.log(`Wrote ${outDir}`);
  console.log(`Pages ranked: ${pageRows.length}`);
  console.log(`High citation need pages: ${summary.highCitationNeedPages}`);
  console.log(`Expanded provider requests ready: ${summary.providerRequests}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
