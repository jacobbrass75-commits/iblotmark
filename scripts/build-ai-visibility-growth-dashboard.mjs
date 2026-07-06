#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const OUTPUT_ROOT = path.join(ROOT, "content-output");
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";
const LIVE_AUDIT_PREFIX = "live-blog-ai-citability-merged-";

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

  if (rows.length === 0) return [];
  const [headers, ...records] = rows;
  return records
    .filter((record) => record.some((value) => value.length > 0))
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
  if (matches.length === 0) {
    throw new Error(`No content-output directory found for prefix ${prefix}`);
  }
  return path.join(OUTPUT_ROOT, matches.at(-1));
}

function bool(value) {
  return ["true", "1", "yes", "y"].includes(String(value ?? "").trim().toLowerCase());
}

function num(value) {
  const parsed = Number(String(value ?? "").replace("%", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function percent(part, total, digits = 0) {
  if (!total) return "0%";
  return `${((part / total) * 100).toFixed(digits)}%`;
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstSentence(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= 180) return text;
  return `${text.slice(0, 177).trim()}...`;
}

function makeKpis(answerRows, liveRows) {
  const total = answerRows.length;
  const brandedRows = answerRows.filter((row) => /ibolt/i.test(row.query));
  const nonBrandedRows = answerRows.filter((row) => !/ibolt/i.test(row.query));
  const mentions = answerRows.filter((row) => bool(row.brand_mentioned)).length;
  const nonBrandedMentions = nonBrandedRows.filter((row) => bool(row.brand_mentioned)).length;
  const top3 = answerRows.filter((row) => {
    const rank = num(row.top_pick_rank);
    return rank >= 1 && rank <= 3;
  }).length;
  const citations = answerRows.filter((row) => bool(row.domain_cited)).length;
  const sourceUrlRows = answerRows.filter((row) => num(row.source_url_count) > 0).length;
  const competitorOnly = answerRows.filter((row) => !bool(row.brand_mentioned) && splitList(row.raw_competitors).length > 0).length;
  const coMention = answerRows.filter((row) => bool(row.brand_mentioned) && splitList(row.raw_competitors).length > 0).length;
  const productSignals = answerRows.filter((row) => splitList(row.product_signals).length > 0).length;
  const catalogSignals = answerRows.filter((row) => splitList(row.catalog_product_names).length > 0).length;
  const avgLiveScore = liveRows.length
    ? Math.round(liveRows.reduce((sum, row) => sum + num(row.score), 0) / liveRows.length)
    : 0;

  return {
    total,
    brandedTotal: brandedRows.length,
    nonBrandedTotal: nonBrandedRows.length,
    mentions,
    nonBrandedMentions,
    top3,
    citations,
    sourceUrlRows,
    competitorOnly,
    coMention,
    productSignals,
    catalogSignals,
    livePages: liveRows.length,
    avgLiveScore,
  };
}

function makeKpiTargetRows(kpis) {
  return [
    {
      metric: "All-prompt iBOLT mention rate",
      baseline: percent(kpis.mentions, kpis.total),
      baseline_count: `${kpis.mentions}/${kpis.total}`,
      first_target: "35%",
      strong_target: "45%",
      why_it_matters: "Shows whether AI systems know iBOLT belongs in the category at all.",
      owner: "Jacob/app",
      first_action: "Refresh high-opportunity pages with query-exact answer blocks and named product entities.",
    },
    {
      metric: "Non-branded iBOLT mention rate",
      baseline: percent(kpis.nonBrandedMentions, kpis.nonBrandedTotal),
      baseline_count: `${kpis.nonBrandedMentions}/${kpis.nonBrandedTotal}`,
      first_target: "15%",
      strong_target: "25%",
      why_it_matters: "This is the main AEO/GEO KPI because buyers usually do not ask for iBOLT by name.",
      owner: "Jacob/app + SEO contractor",
      first_action: "Build competitor-adjacent solution pages and earn third-party mentions in the same consideration sets.",
    },
    {
      metric: "Top-3 recommendation rate",
      baseline: percent(kpis.top3, kpis.total),
      baseline_count: `${kpis.top3}/${kpis.total}`,
      first_target: "25%",
      strong_target: "35%",
      why_it_matters: "Mentions are weaker if iBOLT is buried below RAM, Arkon, iOttie, or CTA Digital.",
      owner: "Jacob/app",
      first_action: "Use fair comparison blocks that name when iBOLT is the specialist choice.",
    },
    {
      metric: "Target-domain citation rate",
      baseline: percent(kpis.citations, kpis.total),
      baseline_count: `${kpis.citations}/${kpis.total}`,
      first_target: "3-5%",
      strong_target: "10%+",
      why_it_matters: "Necessary for search-connected AI surfaces such as AI Overviews, Perplexity, and Gemini with search.",
      owner: "SEO contractor + Jacob/app",
      first_action: "Add schema/FAQ/quick answers, then get external industry pages to cite iBOLT pages.",
    },
    {
      metric: "Average live page citability score",
      baseline: `${kpis.avgLiveScore}/100`,
      baseline_count: `${kpis.livePages} pages`,
      first_target: "82/100",
      strong_target: "88/100",
      why_it_matters: "Measures whether pages are structured like AI-citable answer sources.",
      owner: "Jacob/app",
      first_action: "Batch-add quick answer blocks, FAQ schema, Article schema, image alt text, and comparison sections.",
    },
    {
      metric: "Actual catalog product entity rows",
      baseline: percent(kpis.catalogSignals, kpis.total),
      baseline_count: `${kpis.catalogSignals}/${kpis.total}`,
      first_target: "20/93 rows",
      strong_target: "35/93 rows",
      why_it_matters: "AI answers need exact iBOLT product names, not just generic mounting terms.",
      owner: "Jacob/app",
      first_action: "Use exact product titles, handles, and image alt text in refreshed posts and product modules.",
    },
  ];
}

function makeTopicRows(topicRows, citationGapRows) {
  const citationByCategory = new Map();
  for (const row of citationGapRows) {
    const category = row.category || "uncategorized";
    const current = citationByCategory.get(category) ?? { gaps: 0, opportunity: 0, queries: [] };
    current.gaps += 1;
    current.opportunity += num(row.opportunity);
    if (current.queries.length < 4) current.queries.push(row.query);
    citationByCategory.set(category, current);
  }

  return topicRows.map((row) => {
    const gaps = citationByCategory.get(row.topic) ?? { gaps: 0, opportunity: 0, queries: [] };
    const answerCount = num(row.answer_count);
    const mentionRate = num(row.mention_rate);
    const pressure = splitList(row.top_competitors).reduce((sum, item) => {
      const match = item.match(/(.+)\s+(\d+)$/);
      return sum + (match ? Number(match[2]) : 0);
    }, 0);
    const priority = Math.round((100 - mentionRate) * 0.55 + pressure * 0.35 + gaps.gaps * 3);
    return {
      topic: row.topic,
      answerCount,
      mentionRate,
      missCount: num(row.miss_count),
      competitorPressure: pressure,
      citationGapQueries: gaps.gaps,
      topCompetitors: row.top_competitors,
      topProductSignals: row.top_product_signals,
      firstAction: row.first_action,
      nextQueries: gaps.queries.join("; "),
      priority,
    };
  }).sort((a, b) => b.priority - a.priority);
}

function makeCitationActionRows(liveRows) {
  const issueRows = [
    {
      issue: "No quick-answer block",
      pages: liveRows.filter((row) => !bool(row.has_quick_answer)).length,
      impact: "High",
      fix: "Add a 40-70 word direct answer immediately below the intro or first H2.",
      success_check: "The page answers the target buyer question before long narrative copy.",
    },
    {
      issue: "No FAQ schema",
      pages: liveRows.filter((row) => !bool(row.has_faq_schema)).length,
      impact: "High",
      fix: "Add visible FAQ plus FAQPage JSON-LD with 4-6 real buyer questions.",
      success_check: "FAQ schema validates and matches visible page content.",
    },
    {
      issue: "No comparison/tradeoff signals",
      pages: liveRows.filter((row) => !bool(row.has_comparison_signals)).length,
      impact: "High",
      fix: "Add fair comparison blocks for RAM Mounts, Arkon, iOttie, CTA Digital, ProClip, or topic-specific competitors.",
      success_check: "The page states when each option fits and when iBOLT is the specialist choice.",
    },
    {
      issue: "No Article/BlogPosting schema",
      pages: liveRows.filter((row) => !bool(row.has_article_schema)).length,
      impact: "Medium",
      fix: "Add Article or BlogPosting JSON-LD with headline, date, author, image, and publisher.",
      success_check: "Rich Results or schema validation recognizes the article entity.",
    },
    {
      issue: "Images missing alt text",
      pages: liveRows.filter((row) => num(row.missing_alt) > 0).length,
      impact: "Medium",
      fix: "Use descriptive alt text with exact product name, use case, and mounting context.",
      success_check: "No article images have blank or generic alt text.",
    },
  ];

  return issueRows.sort((a, b) => b.pages - a.pages);
}

function makePageRefreshRows(liveRows) {
  return liveRows
    .map((row) => {
      const fixes = splitList(row.top_fixes);
      const urgency = Math.round((100 - num(row.score)) + fixes.length * 8 + (bool(row.has_quick_answer) ? 0 : 10) + (bool(row.has_faq_schema) ? 0 : 10));
      return {
        title: row.title,
        url: row.url,
        topic: row.category,
        score: num(row.score),
        source: row.source,
        productLinks: num(row.product_links),
        iboltMentions: num(row.ibolt_mentions),
        competitors: row.competitor_brands,
        fixes: row.top_fixes,
        urgency,
      };
    })
    .sort((a, b) => b.urgency - a.urgency)
    .slice(0, 30);
}

function makeCompetitorRows(competitorRows) {
  return competitorRows
    .map((row) => {
      const withoutIbolt = num(row.without_ibolt);
      const withIbolt = num(row.with_ibolt);
      const risk = withoutIbolt * 2 + num(row.raw_appearances) - withIbolt;
      return {
        brand: row.brand,
        rawAppearances: num(row.raw_appearances),
        withIbolt,
        withoutIbolt,
        categories: row.categories,
        queries: row.queries,
        counterPositioning: row.counter_positioning,
        risk,
      };
    })
    .sort((a, b) => b.risk - a.risk);
}

function barChartSvg({ title, rows, labelKey, valueKey, maxValue, color = "#0f172a", suffix = "" }) {
  const width = 980;
  const rowHeight = 34;
  const margin = { top: 48, right: 80, bottom: 30, left: 240 };
  const height = margin.top + rows.length * rowHeight + margin.bottom;
  const max = maxValue || Math.max(1, ...rows.map((row) => num(row[valueKey])));
  const chartWidth = width - margin.left - margin.right;
  const bars = rows.map((row, index) => {
    const value = num(row[valueKey]);
    const y = margin.top + index * rowHeight;
    const barWidth = Math.max(2, (value / max) * chartWidth);
    return `<text x="${margin.left - 12}" y="${y + 19}" text-anchor="end" font-size="13" fill="#334155">${escapeHtml(row[labelKey])}</text>
<rect x="${margin.left}" y="${y + 5}" width="${barWidth.toFixed(1)}" height="20" rx="4" fill="${color}"></rect>
<text x="${margin.left + barWidth + 8}" y="${y + 19}" font-size="13" fill="#0f172a">${escapeHtml(value)}${suffix}</text>`;
  }).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="${width}" height="${height}" fill="#ffffff"></rect>
<text x="24" y="30" font-size="22" font-weight="700" fill="#0f172a">${escapeHtml(title)}</text>
${bars}
</svg>`;
}

function funnelSvg(kpis) {
  const rows = [
    { label: "AI answers tested", value: kpis.total },
    { label: "iBOLT mentioned", value: kpis.mentions },
    { label: "Top-3 recommendation", value: kpis.top3 },
    { label: "Target-domain citation", value: kpis.citations },
  ];
  return barChartSvg({ title: "AI Visibility Funnel", rows, labelKey: "label", valueKey: "value", maxValue: kpis.total, color: "#111827" });
}

function buildMarkdown({ kpis, kpiRows, topicRows, citationRows, competitorRows, pageRows, benchmarkDir, liveDir }) {
  const topTopics = topicRows.slice(0, 8);
  const topCompetitors = competitorRows.slice(0, 10);
  const topPages = pageRows.slice(0, 12);

  return `# AI Visibility Growth Dashboard

This report answers the practical KPI question: citation rate matters, but it is not the only score to chase. The current first bottleneck is non-branded recommendation visibility. Citation work becomes critical when the answer surface has web search, sources, or shopping results.

## Baseline

- AI answers tested: ${kpis.total}
- iBOLT mention rate: ${kpis.mentions}/${kpis.total} (${percent(kpis.mentions, kpis.total)})
- Non-branded iBOLT mention rate: ${kpis.nonBrandedMentions}/${kpis.nonBrandedTotal} (${percent(kpis.nonBrandedMentions, kpis.nonBrandedTotal)})
- Top-3 recommendation rate: ${kpis.top3}/${kpis.total} (${percent(kpis.top3, kpis.total)})
- Target-domain citation rate: ${kpis.citations}/${kpis.total} (${percent(kpis.citations, kpis.total)})
- Rows with any source URLs: ${kpis.sourceUrlRows}/${kpis.total}
- Competitor-only rows: ${kpis.competitorOnly}
- Co-mention rows: ${kpis.coMention}
- Product/family signal rows: ${kpis.productSignals}/${kpis.total}
- Actual catalog product entity rows: ${kpis.catalogSignals}/${kpis.total}
- Live pages audited: ${kpis.livePages}
- Average live page citability score: ${kpis.avgLiveScore}/100

## KPI Targets

| Metric | Baseline | First target | Strong target | Owner | First action |
| --- | --- | --- | --- | --- | --- |
${kpiRows.map((row) => `| ${row.metric} | ${row.baseline_count} (${row.baseline}) | ${row.first_target} | ${row.strong_target} | ${row.owner} | ${row.first_action} |`).join("\n")}

## Topic Priorities

| Priority | Topic | Answers | Mention rate | Competitor pressure | Citation gap queries | First action |
| --- | --- | --- | --- | --- | --- | --- |
${topTopics.map((row) => `| ${row.priority} | ${row.topic} | ${row.answerCount} | ${row.mentionRate}% | ${row.competitorPressure} | ${row.citationGapQueries} | ${row.firstAction} |`).join("\n")}

## Citation Rate Work

| Issue | Pages affected | Impact | Fix | Success check |
| --- | --- | --- | --- | --- |
${citationRows.map((row) => `| ${row.issue} | ${row.pages} | ${row.impact} | ${row.fix} | ${row.success_check} |`).join("\n")}

## Competitor Adjacency

| Competitor | Raw appearances | With iBOLT | Without iBOLT | Main categories | Counter-positioning |
| --- | --- | --- | --- | --- | --- |
${topCompetitors.map((row) => `| ${row.brand} | ${row.rawAppearances} | ${row.withIbolt} | ${row.withoutIbolt} | ${row.categories} | ${row.counterPositioning} |`).join("\n")}

## First Pages To Refresh

| Urgency | Score | Topic | Page | Competitors detected | Fixes |
| --- | --- | --- | --- | --- | --- |
${topPages.map((row) => `| ${row.urgency} | ${row.score} | ${row.topic} | [${row.title}](${row.url}) | ${row.competitors || "none"} | ${row.fixes} |`).join("\n")}

## How To Read This

- For ChatGPT, Claude, and Gemini without browsing, the best metric is non-branded mention rate plus top-3 recommendation rate.
- For Google AI Overviews, Perplexity, Gemini with search, ChatGPT search, and shopping assistants, citation rate becomes a key metric because the answer can expose source URLs.
- The site has enough page coverage to work from, but pages need answer-first structure, schema, and stronger product/entity language.
- External mentions still matter. The contractor should focus on credible third-party references and comparison placements while the app refreshes pages.

## Source Evidence

- Benchmark directory: ${benchmarkDir}
- Live blog audit directory: ${liveDir}
- Citation priority model: ${benchmarkDir}/citation-priority-model/REPORT.html
`;
}

function buildHtml(markdown) {
  const lines = markdown.split("\n");
  let inTable = false;
  const html = [];
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
    } else if (line.startsWith("- ")) {
      if (inTable) {
        html.push("</tbody></table>");
        inTable = false;
      }
      html.push(`<p>${escapeHtml(line)}</p>`);
    } else if (line.startsWith("| ")) {
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      if (cells.every((cell) => /^-+$/.test(cell.replaceAll(" ", "")))) continue;
      if (!inTable) {
        html.push("<table><tbody>");
        inTable = true;
      }
      const isHeader = html.at(-1) === "<table><tbody>";
      const tag = isHeader ? "th" : "td";
      html.push(`<tr>${cells.map((cell) => `<${tag}>${escapeHtml(cell)}</${tag}>`).join("")}</tr>`);
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
<title>AI Visibility Growth Dashboard</title>
<style>
body{font-family:Inter,Arial,sans-serif;margin:0;background:#f8fafc;color:#0f172a;line-height:1.5}
main{max-width:1180px;margin:0 auto;padding:36px 22px 72px}
h1{font-size:38px;line-height:1.08;margin:0 0 18px}
h2{font-size:24px;margin:34px 0 12px}
p{font-size:16px;color:#334155}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;margin:14px 0 26px;font-size:14px}
th,td{text-align:left;vertical-align:top;border-bottom:1px solid #e2e8f0;padding:10px 12px}
th{background:#e2e8f0;font-weight:700}
tr:nth-child(even) td{background:#f8fafc}
.charts{display:grid;grid-template-columns:1fr;gap:20px;margin:24px 0}
.chart{background:#fff;border:1px solid #e2e8f0;padding:16px;overflow:auto}
.source{font-size:13px;color:#64748b}
</style>
</head>
<body><main>
${html.join("\n")}
<section class="charts">
<div class="chart"><img src="visibility-funnel.svg" alt="AI visibility funnel"></div>
<div class="chart"><img src="topic-priorities.svg" alt="Topic priorities by score"></div>
<div class="chart"><img src="competitor-pressure.svg" alt="Competitor pressure"></div>
</section>
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const liveDir = await latestDir(LIVE_AUDIT_PREFIX);
  const outDir = path.join(benchmarkDir, "visibility-growth-dashboard");
  await mkdir(outDir, { recursive: true });

  const answerRows = await readCsv(path.join(benchmarkDir, "answer-evidence-pack", "answer-evidence.csv"));
  const topicGuidanceRows = await readCsv(path.join(benchmarkDir, "mention-context-playbook", "topic-messaging-guidance.csv"));
  const competitorLanguageRows = await readCsv(path.join(benchmarkDir, "mention-context-playbook", "competitor-language-playbook.csv"));
  const citationGapRows = await readCsv(path.join(benchmarkDir, "citation-strategy", "citation-query-gaps.csv"));
  const liveRows = await readCsv(path.join(liveDir, "live-blog-page-audit.merged.csv"));

  const kpis = makeKpis(answerRows, liveRows);
  const kpiRows = makeKpiTargetRows(kpis);
  const topicRows = makeTopicRows(topicGuidanceRows, citationGapRows);
  const citationRows = makeCitationActionRows(liveRows);
  const competitorRows = makeCompetitorRows(competitorLanguageRows);
  const pageRows = makePageRefreshRows(liveRows);

  await writeFile(path.join(outDir, "kpi-targets.csv"), csv([
    ["metric", "baseline", "baseline_count", "first_target", "strong_target", "why_it_matters", "owner", "first_action"],
    ...kpiRows.map((row) => [row.metric, row.baseline, row.baseline_count, row.first_target, row.strong_target, row.why_it_matters, row.owner, row.first_action]),
  ]));
  await writeFile(path.join(outDir, "topic-visibility-priorities.csv"), csv([
    ["priority", "topic", "answers", "mention_rate", "miss_count", "competitor_pressure", "citation_gap_queries", "top_competitors", "top_product_signals", "next_queries", "first_action"],
    ...topicRows.map((row) => [row.priority, row.topic, row.answerCount, row.mentionRate, row.missCount, row.competitorPressure, row.citationGapQueries, row.topCompetitors, row.topProductSignals, row.nextQueries, row.firstAction]),
  ]));
  await writeFile(path.join(outDir, "citation-rate-action-plan.csv"), csv([
    ["issue", "pages_affected", "impact", "fix", "success_check"],
    ...citationRows.map((row) => [row.issue, row.pages, row.impact, row.fix, row.success_check]),
  ]));
  await writeFile(path.join(outDir, "competitor-adjacency-summary.csv"), csv([
    ["risk", "brand", "raw_appearances", "with_ibolt", "without_ibolt", "categories", "queries", "counter_positioning"],
    ...competitorRows.map((row) => [row.risk, row.brand, row.rawAppearances, row.withIbolt, row.withoutIbolt, row.categories, row.queries, row.counterPositioning]),
  ]));
  await writeFile(path.join(outDir, "first-pages-to-refresh.csv"), csv([
    ["urgency", "score", "topic", "title", "url", "source", "product_links", "ibolt_mentions", "competitors", "fixes"],
    ...pageRows.map((row) => [row.urgency, row.score, row.topic, row.title, row.url, row.source, row.productLinks, row.iboltMentions, row.competitors, row.fixes]),
  ]));

  const markdown = buildMarkdown({ kpis, kpiRows, topicRows, citationRows, competitorRows, pageRows, benchmarkDir, liveDir });
  await writeFile(path.join(outDir, "REPORT.md"), markdown);
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml(markdown));
  await writeFile(path.join(outDir, "visibility-funnel.svg"), funnelSvg(kpis));
  await writeFile(path.join(outDir, "topic-priorities.svg"), barChartSvg({
    title: "Topic Priority Score",
    rows: topicRows.slice(0, 8),
    labelKey: "topic",
    valueKey: "priority",
    color: "#1d4ed8",
  }));
  await writeFile(path.join(outDir, "competitor-pressure.svg"), barChartSvg({
    title: "Competitors Winning Without iBOLT",
    rows: competitorRows.slice(0, 10).map((row) => ({ brand: row.brand, value: row.withoutIbolt })),
    labelKey: "brand",
    valueKey: "value",
    color: "#991b1b",
  }));

  console.log(`Wrote ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
