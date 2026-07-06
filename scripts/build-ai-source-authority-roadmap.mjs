import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";

const SOURCE_TARGETS = {
  fishing: [
    "boating buyer guides",
    "kayak and pontoon fishing resources",
    "marine electronics installation articles",
    "Garmin, Lowrance, and Humminbird accessory roundups",
  ],
  restaurant: [
    "restaurant operations blogs",
    "food truck equipment guides",
    "POS hardware comparison articles",
    "delivery app operations resources",
  ],
  delivery: [
    "gig-driver gear lists",
    "fleet operations blogs",
    "delivery vehicle setup guides",
    "commercial driver equipment roundups",
  ],
  fleet: [
    "fleet safety and ELD resources",
    "truck equipment buyer guides",
    "commercial vehicle installation articles",
    "work-truck accessory roundups",
  ],
  warehouse: [
    "material handling publications",
    "forklift safety resources",
    "warehouse scanning workflow guides",
    "Zebra and Honeywell accessory roundups",
  ],
  "amps/modular": [
    "AMPS pattern explainers",
    "mounting hardware glossaries",
    "installer how-to pages",
    "RAM-compatible accessory comparisons",
  ],
  streaming: [
    "creator gear lists",
    "phone filming setup guides",
    "livestreaming equipment roundups",
    "table camera mount tutorials",
  ],
  tablet: [
    "tablet stand buyer guides",
    "commercial tablet kiosk comparisons",
    "POS hardware resources",
    "rugged tablet mounting guides",
  ],
};

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

async function readCsvIfExists(filePath) {
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
  return total ? Math.round((num(count) / num(total)) * 100) : 0;
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

function top(rows, key, count = 10) {
  return [...rows].sort((a, b) => num(b[key]) - num(a[key]) || String(a.category || a.brand || a.query).localeCompare(String(b.category || b.brand || b.query))).slice(0, count);
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
      if (!value) continue;
      map.set(value, (map.get(value) || 0) + 1);
    }
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function sourceTargetsFor(category) {
  return SOURCE_TARGETS[category] || [
    "industry buyer guides",
    "third-party comparison pages",
    "partner and reseller pages",
    "installation and troubleshooting resources",
  ];
}

function buildTopicRows({ portfolioRows, queryRows, contractorRows }) {
  const queryByCategory = groupBy(queryRows, (row) => row.category || "unknown");
  const contractorByTarget = new Map(contractorRows.map((row) => [String(row.category_or_brand || "").toLowerCase(), row]));
  return portfolioRows.map((portfolio) => {
    const category = portfolio.category || "unknown";
    const queries = queryByCategory.get(category) || [];
    const zeroMentionQueries = queries.filter((row) => num(row.mention_rate) === 0);
    const competitorOnlyAnswers = queries.reduce((sum, row) => sum + num(row.competitor_only_answers), 0);
    const avgMentionRate = queries.length ? Math.round(queries.reduce((sum, row) => sum + num(row.mention_rate), 0) / queries.length) : 0;
    const topCompetitors = unique([
      ...splitList(portfolio.top_competitors).map((item) => item.replace(/\s+\d+$/, "")),
      ...queries.flatMap((row) => splitList(row.competitors)),
    ]).slice(0, 8);
    const contractor = contractorByTarget.get(category);
    const priority = Math.round(
      num(portfolio.benchmark_pressure_pages) * 32 +
      zeroMentionQueries.length * 28 +
      competitorOnlyAnswers * 14 +
      num(portfolio.product_entity_targets) * 2 +
      Math.max(0, 82 - num(portfolio.avg_citability_score)) * 3 +
      num(portfolio.canonical_review_pages) * 8,
    );
    return {
      priority,
      category,
      live_pages: portfolio.live_pages,
      avg_citability_score: portfolio.avg_citability_score,
      benchmark_pressure_pages: portfolio.benchmark_pressure_pages,
      zero_mention_queries: zeroMentionQueries.length,
      competitor_only_answers: competitorOnlyAnswers,
      avg_mention_rate: avgMentionRate,
      canonical_review_pages: portfolio.canonical_review_pages,
      product_entity_targets: portfolio.product_entity_targets,
      top_competitors: topCompetitors.join("; "),
      source_targets: sourceTargetsFor(category).join("; "),
      contractor_why: contractor?.why || `${category} has ${zeroMentionQueries.length} zero-mention benchmark queries and ${competitorOnlyAnswers} competitor-only answers.`,
      recommended_owner: num(portfolio.benchmark_pressure_pages) > 0 || zeroMentionQueries.length > 0 ? "Jacob/app + SEO contractor" : "Jacob/app",
      next_action: zeroMentionQueries.length || competitorOnlyAnswers
        ? "Refresh mapped pages, then earn third-party references that name iBOLT next to the competitor set."
        : "Run citation-readiness cleanup and monitor in the expanded benchmark.",
    };
  }).sort((a, b) => b.priority - a.priority);
}

function buildCompetitorRows({ competitorRows, contractorRows }) {
  const contractorByTarget = new Map(contractorRows.map((row) => [String(row.category_or_brand || "").toLowerCase(), row]));
  return competitorRows.map((row) => {
    const brand = row.brand || row.name || "";
    const contractor = contractorByTarget.get(brand.toLowerCase());
    const priority = num(row.pressure_score) || num(row.lost_answers) * 3 + num(row.co_mentioned_wins);
    return {
      priority,
      brand,
      lost_answers: row.lost_answers,
      co_mentioned_wins: row.co_mentioned_wins,
      categories: row.categories,
      providers: row.providers,
      language_patterns: row.language_patterns,
      example_queries: row.example_queries,
      offsite_target: contractor?.target || "External comparison citations and neutral category pages where this brand is already recommended.",
      why: contractor?.why || `${brand} appears in competitor-only answers where iBOLT needs to be in the same consideration set.`,
      success_metric: contractor?.success_metric || `Reduce ${brand} competitor-only rows and create at least one co-mention win.`,
    };
  }).sort((a, b) => b.priority - a.priority);
}

function buildActionRows({ topicRows, competitorRows, pageRows, queryRows, providerRows, master }) {
  const evidence = master.evidenceSummary || {};
  const mention = master.mentionSummary || {};
  const topTopics = top(topicRows, "priority", 8);
  const topCompetitors = top(competitorRows, "priority", 8);
  const topPages = top(pageRows, "priority", 12);
  const topQueries = top(queryRows, "priority", 12);
  const actions = [
    {
      priority: 1,
      owner: "Jacob/app",
      workstream: "Mention-rate foundation",
      target: "Non-branded buyer prompts",
      action: "Add exact prompt answers, named iBOLT product modules, comparison sections, FAQ schema, Article schema, and stronger internal links on mapped pages.",
      why: `Only ${evidence.nonBrandedMentionCount || 0}/${evidence.nonBranded || 0} non-branded answers mention iBOLT.`,
      success_metric: "Move non-branded mention rate from 5% to at least 15% on a comparable retest.",
    },
    {
      priority: 2,
      owner: "SEO contractor",
      workstream: "External citation authority",
      target: topTopics.slice(0, 5).map((row) => row.category).join("; "),
      action: "Place iBOLT on third-party buyer guides, comparison pages, industry resource pages, partner/reseller pages, and installation how-to articles that can be cited by AI search.",
      why: `Target-domain citation rate is ${evidence.citationCount || 0}/${evidence.total || 0}, while competitor-only rows are ${mention.competitorOnlyAnswers || evidence.competitorOnlyRows || 0}.`,
      success_metric: "Reach 3% to 5% citation rate first, then 10%+ after repeated external mentions index.",
    },
    {
      priority: 3,
      owner: "Jacob/app + SEO contractor",
      workstream: "Competitor adjacency",
      target: topCompetitors.slice(0, 5).map((row) => row.brand).join("; "),
      action: "Write fair comparison blocks on iBOLT pages and secure external pages where iBOLT is mentioned in the same lists as the competitor defaults.",
      why: `${topCompetitors.slice(0, 5).map((row) => `${row.brand} ${row.lost_answers}`).join("; ")} lost-answer appearances.`,
      success_metric: "Lower competitor-only answers from 68 to below 50 and raise co-mentions above 25.",
    },
    {
      priority: 4,
      owner: "Jacob/app",
      workstream: "Product entity clarity",
      target: "Catalog product modules",
      action: "Use exact Shopify product titles, SKUs when available, application fit, compatible device families, product URLs, and image alt text on priority posts.",
      why: "Only 8/93 answers include catalog product aliases, and 187 catalog products are unlinked from detected blog content.",
      success_metric: "Move catalog alias rows from 8/93 to 20/93 and product signal rows from 30/93 to 45/93.",
    },
    {
      priority: 5,
      owner: "Jacob/app",
      workstream: "Provider-specific retesting",
      target: providerRows.map((row) => `${row.provider}: ${row.mention_rate}% mention`).join("; "),
      action: "Retest the same prompts after each content batch, keeping provider/model/prompt constant where possible.",
      why: "ChatGPT is currently stronger than Claude and Gemini, while all three show 0% citation rate.",
      success_metric: "Track mention, top-3, citation, and competitor-only movement by provider after every batch.",
    },
  ];

  for (const [index, row] of topPages.slice(0, 8).entries()) {
    actions.push({
      priority: 10 + index,
      owner: "Jacob/app",
      workstream: "Page refresh",
      target: row.title,
      action: row.next_step || "Refresh with quick answer, FAQ schema, comparison block, product module, and image alt text.",
      why: `${row.category} page with priority ${row.priority}, ${row.benchmark_query_count || 0} benchmark queries, and ${row.product_entity_targets || 0} product targets.`,
      success_metric: `Mapped prompts mention iBOLT and page citability moves above 82.`,
    });
  }

  for (const [index, row] of topQueries.slice(0, 8).entries()) {
    actions.push({
      priority: 30 + index,
      owner: "SEO contractor",
      workstream: "External query authority",
      target: row.query,
      action: `Earn third-party references for the mapped page: ${row.page_url || "mapped iBOLT page"}.`,
      why: `${row.query} has ${row.mention_rate || 0}% iBOLT mention rate and competitors ${row.competitors || "unknown"}.`,
      success_metric: "At least one tested provider mentions iBOLT for this prompt on the next benchmark.",
    });
  }

  return actions.sort((a, b) => num(a.priority) - num(b.priority));
}

function buildRetestRows({ queryRows, providerRetestRows }) {
  const providerByQuery = new Map(providerRetestRows.map((row) => [String(row.query || row.prompt || "").toLowerCase(), row]));
  return top(queryRows, "priority", 20).map((row, index) => {
    const provider = providerByQuery.get(String(row.query || "").toLowerCase()) || {};
    return {
      priority: index + 1,
      query: row.query,
      category: row.category,
      baseline_mention_rate: row.mention_rate,
      baseline_top_three_rate: row.top_three_rate,
      competitor_only_answers: row.competitor_only_answers,
      weakest_providers: row.weakest_providers || provider.provider || "",
      mapped_page: row.page_url,
      retest_action: row.retest_action || provider.retest_action || "Rerun on ChatGPT, Claude, and Gemini after page and external-source work.",
    };
  });
}

function barSvg({ title, rows, labelKey, valueKey, color = "#2563eb", maxValue }) {
  const width = 980;
  const rowHeight = 38;
  const topOffset = 60;
  const height = topOffset + rows.length * rowHeight + 28;
  const labelWidth = 360;
  const barWidth = 450;
  const max = maxValue || Math.max(1, ...rows.map((row) => num(row[valueKey])));
  const bars = rows.map((row, index) => {
    const value = num(row[valueKey]);
    const y = topOffset + index * rowHeight;
    const w = Math.max(2, Math.round((value / max) * barWidth));
    return `<text x="22" y="${y + 17}" fill="#0f172a" font-size="13">${escapeHtml(row[labelKey]).slice(0, 54)}</text>
<rect x="${labelWidth}" y="${y}" width="${barWidth}" height="22" rx="4" fill="#e2e8f0"/>
<rect x="${labelWidth}" y="${y}" width="${w}" height="22" rx="4" fill="${color}"/>
<text x="${labelWidth + barWidth + 12}" y="${y + 16}" fill="#0f172a" font-size="13" font-weight="700">${escapeHtml(value)}</text>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="#ffffff"/>
<text x="22" y="36" fill="#0f172a" font-size="22" font-weight="800">${escapeHtml(title)}</text>
${bars}
</svg>`;
}

function funnelSvg(master) {
  const evidence = master.evidenceSummary || {};
  const mention = master.mentionSummary || {};
  const rows = [
    { label: "Tested answers", count: evidence.total || 0, denominator: evidence.total || 0, color: "#0f172a" },
    { label: "iBOLT mentioned", count: evidence.mentionCount || 0, denominator: evidence.total || 0, color: "#16a34a" },
    { label: "Non-branded mentions", count: evidence.nonBrandedMentionCount || 0, denominator: evidence.nonBranded || 0, color: "#0891b2" },
    { label: "Top-3 recommendations", count: mention.topThree || 0, denominator: evidence.total || 0, color: "#ea580c" },
    { label: "Target-domain citations", count: evidence.citationCount || 0, denominator: evidence.total || 0, color: "#dc2626" },
  ];
  const width = 980;
  const height = 330;
  const labelWidth = 260;
  const barWidth = 540;
  const max = Math.max(1, evidence.total || 0);
  const bars = rows.map((row, index) => {
    const y = 70 + index * 48;
    const w = Math.max(row.count ? 6 : 2, Math.round((row.count / max) * barWidth));
    return `<text x="24" y="${y + 19}" fill="#0f172a" font-size="14" font-weight="700">${escapeHtml(row.label)}</text>
<rect x="${labelWidth}" y="${y}" width="${barWidth}" height="26" rx="6" fill="#e2e8f0"/>
<rect x="${labelWidth}" y="${y}" width="${w}" height="26" rx="6" fill="${row.color}"/>
<text x="${labelWidth + barWidth + 14}" y="${y + 19}" fill="#0f172a" font-size="14" font-weight="800">${row.count} (${pct(row.count, row.denominator)}%)</text>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="#ffffff"/>
<text x="24" y="38" fill="#0f172a" font-size="22" font-weight="800">Visibility To Citation Funnel</text>
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

function buildMarkdown({ summary, topicRows, competitorRows, actionRows, retestRows }) {
  return `# iBOLT Source Authority Roadmap

## Bottom Line

Citation rate is worth improving, but the saved benchmark shows the sequence clearly: iBOLT first needs stronger non-branded mentions, then more top-3 recommendations, then source citations. Current target-domain citation rate is ${summary.citationRate}% (${summary.citationCount}/${summary.totalAnswers}), while non-branded mention rate is ${summary.nonBrandedMentionRate}% (${summary.nonBrandedMentions}/${summary.nonBrandedAnswers}).

The practical split is:

- Jacob/app owns answer-ready pages, product entity modules, schema, internal links, and retesting.
- The SEO contractor owns external source authority: industry mentions, third-party comparison pages, partner/reseller pages, buyer guides, and backlinks to the exact refreshed solution pages.

## KPI Snapshot

- Overall mention rate: ${summary.mentionRate}%.
- Non-branded mention rate: ${summary.nonBrandedMentionRate}%.
- Top-3 recommendation rate: ${summary.topThreeRate}%.
- Citation rate: ${summary.citationRate}%.
- Competitor-only answers: ${summary.competitorOnlyAnswers}.
- Live pages audited: ${summary.livePages}.
- Pages with benchmark pressure: ${summary.benchmarkPressurePages}.
- Product/entity work queue rows: ${summary.productEntityWorkQueueRows}.

## Topic Source Authority Priority

${markdownTable(topicRows.slice(0, 12), [
  ["Priority", "priority"],
  ["Topic", "category"],
  ["Zero-mention queries", "zero_mention_queries"],
  ["Competitor-only answers", "competitor_only_answers"],
  ["Benchmark pages", "benchmark_pressure_pages"],
  ["Top competitors", "top_competitors"],
  ["External source targets", "source_targets"],
])}

## Competitor Source Pressure

${markdownTable(competitorRows.slice(0, 12), [
  ["Priority", "priority"],
  ["Competitor", "brand"],
  ["Lost answers", "lost_answers"],
  ["Co-mentioned wins", "co_mentioned_wins"],
  ["Categories", "categories"],
  ["External target", "offsite_target"],
])}

## Action Plan

${markdownTable(actionRows.slice(0, 22), [
  ["Priority", "priority"],
  ["Owner", "owner"],
  ["Workstream", "workstream"],
  ["Target", "target"],
  ["Action", "action"],
  ["Success metric", "success_metric"],
])}

## Retest Queue

${markdownTable(retestRows.slice(0, 18), [
  ["Priority", "priority"],
  ["Query", "query"],
  ["Category", "category"],
  ["Mention rate", "baseline_mention_rate"],
  ["Competitor-only", "competitor_only_answers"],
  ["Weakest providers", "weakest_providers"],
  ["Mapped page", "mapped_page"],
])}
`;
}

function buildHtml({ summary, topicRows, competitorRows, actionRows, retestRows, charts }) {
  const cards = [
    ["Mention rate", `${summary.mentionRate}%`, `${summary.mentions}/${summary.totalAnswers}`],
    ["Non-branded", `${summary.nonBrandedMentionRate}%`, `${summary.nonBrandedMentions}/${summary.nonBrandedAnswers}`],
    ["Top-3 rate", `${summary.topThreeRate}%`, `${summary.topThreeCount}/${summary.totalAnswers}`],
    ["Citation rate", `${summary.citationRate}%`, `${summary.citationCount}/${summary.totalAnswers}`],
    ["Competitor-only", summary.competitorOnlyAnswers, "answers"],
    ["Benchmark pages", summary.benchmarkPressurePages, "live pages"],
  ].map(([label, value, note]) => `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>iBOLT Source Authority Roadmap</title>
<style>
body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}main{max-width:1240px;margin:0 auto;padding:34px 26px 60px}h1{font-size:34px;margin:0 0 8px}h2{font-size:22px;margin:34px 0 14px}p{color:#334155;line-height:1.55}.note{border-left:6px solid #dc2626;background:#fff;border-radius:10px;padding:16px 18px;border-top:1px solid #d7dee8;border-right:1px solid #d7dee8;border-bottom:1px solid #d7dee8}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}.k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700}.v{font-size:30px;font-weight:800;margin-top:8px}.charts{display:grid;grid-template-columns:1fr;gap:16px}.chart{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:12px;overflow:auto}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden}th,td{text-align:left;vertical-align:top;padding:11px 12px;border-bottom:1px solid #edf2f7;font-size:14px}th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:12px;letter-spacing:.04em}
</style></head><body><main>
<h1>iBOLT Source Authority Roadmap</h1>
<p class="note"><strong>Readout:</strong> Citation rate is currently ${summary.citationRate}%. The fastest path is not only more blogs. It is page-level answer structure plus external source authority where iBOLT is named beside the brands AI already trusts.</p>
<section class="cards">${cards}</section>
<section class="charts"><div class="chart">${charts.funnel}</div><div class="chart">${charts.topics}</div><div class="chart">${charts.competitors}</div></section>
<h2>Topic Source Authority Priority</h2>
${table(topicRows.slice(0, 14), [
  ["Priority", "priority"],
  ["Topic", "category"],
  ["Zero mentions", "zero_mention_queries"],
  ["Competitor-only", "competitor_only_answers"],
  ["Benchmark pages", "benchmark_pressure_pages"],
  ["Top competitors", "top_competitors"],
  ["External source targets", "source_targets"],
  ["Owner", "recommended_owner"],
])}
<h2>Competitor Source Pressure</h2>
${table(competitorRows.slice(0, 14), [
  ["Priority", "priority"],
  ["Competitor", "brand"],
  ["Lost answers", "lost_answers"],
  ["Co-mentioned", "co_mentioned_wins"],
  ["Categories", "categories"],
  ["External target", "offsite_target"],
  ["Success metric", "success_metric"],
])}
<h2>Action Plan</h2>
${table(actionRows.slice(0, 24), [
  ["Priority", "priority"],
  ["Owner", "owner"],
  ["Workstream", "workstream"],
  ["Target", "target"],
  ["Action", "action"],
  ["Why", "why"],
  ["Success metric", "success_metric"],
])}
<h2>Retest Queue</h2>
${table(retestRows.slice(0, 20), [
  ["Priority", "priority"],
  ["Query", "query"],
  ["Category", "category"],
  ["Mention rate", "baseline_mention_rate"],
  ["Top-3 rate", "baseline_top_three_rate"],
  ["Competitor-only", "competitor_only_answers"],
  ["Weakest providers", "weakest_providers"],
  ["Mapped page", "mapped_page"],
])}
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, "source-authority-roadmap");
  await mkdir(outDir, { recursive: true });

  const master = await readJsonIfExists(path.join(benchmarkDir, "master-dossier", "master-dossier-data.json"), {});
  const providerData = await readJsonIfExists(path.join(benchmarkDir, "provider-blindspots", "provider-blindspot-data.json"), { providerRows: [], retestRows: [] });
  const productData = await readJsonIfExists(path.join(benchmarkDir, "product-entity-coverage-plan", "product-entity-data.json"), { summary: {} });
  const portfolioData = await readJsonIfExists(path.join(benchmarkDir, "blog-portfolio-map", "blog-portfolio-data.json"), { summary: {}, categoryRows: [], pageLedger: [] });
  const portfolioRows = await readCsvIfExists(path.join(benchmarkDir, "blog-portfolio-map", "topic-portfolio-scorecard.csv"));
  const queryRows = await readCsvIfExists(path.join(benchmarkDir, "query-page-matrix", "all-query-page-matrix.csv"));
  const competitorRowsRaw = await readCsvIfExists(path.join(benchmarkDir, "answer-context-dossier", "competitor-context-scorecard.csv"));
  const contractorRows = await readCsvIfExists(path.join(benchmarkDir, "citation-uplift-plan", "contractor-citation-offload.csv"));
  const pageRows = await readCsvIfExists(path.join(benchmarkDir, "blog-portfolio-map", "blog-page-portfolio-ledger.csv"));
  const providerRetestRows = await readCsvIfExists(path.join(benchmarkDir, "provider-blindspots", "provider-retest-plan.csv"));

  const evidence = master.evidenceSummary || {};
  const mention = master.mentionSummary || {};
  const topicRows = buildTopicRows({ portfolioRows, queryRows, contractorRows });
  const competitorRows = buildCompetitorRows({ competitorRows: competitorRowsRaw, contractorRows });
  const actionRows = buildActionRows({
    topicRows,
    competitorRows,
    pageRows,
    queryRows,
    providerRows: providerData.providerRows || [],
    master,
  });
  const retestRows = buildRetestRows({ queryRows, providerRetestRows });
  const summary = {
    benchmarkDir,
    totalAnswers: evidence.total || providerData.summary?.totalResults || 0,
    mentions: evidence.mentionCount || providerData.summary?.mentionCount || 0,
    mentionRate: evidence.mentionRate || providerData.summary?.mentionRate || 0,
    nonBrandedAnswers: evidence.nonBranded || 0,
    nonBrandedMentions: evidence.nonBrandedMentionCount || 0,
    nonBrandedMentionRate: evidence.nonBrandedMentionRate || pct(evidence.nonBrandedMentionCount || 0, evidence.nonBranded || 0),
    topThreeCount: mention.topThree || providerData.summary?.topThreeCount || 0,
    topThreeRate: mention.topThreeRate || providerData.summary?.topThreeRate || 0,
    citationCount: evidence.citationCount || providerData.summary?.citationCount || 0,
    citationRate: evidence.citationRate || providerData.summary?.citationRate || 0,
    competitorOnlyAnswers: mention.competitorOnlyAnswers || evidence.competitorOnlyRows || providerData.summary?.competitorOnlyCount || 0,
    coMentionAnswers: mention.coMentionAnswers || evidence.coMentionRows || 0,
    livePages: portfolioData.summary?.livePages || pageRows.length,
    benchmarkPressurePages: portfolioData.summary?.benchmarkPressurePages || 0,
    productTargetPages: portfolioData.summary?.productTargetPages || 0,
    productEntityWorkQueueRows: productData.summary?.workQueueRows || 0,
    unlinkedProducts: productData.summary?.unlinkedProducts || 0,
    topicRows: topicRows.length,
    competitorRows: competitorRows.length,
    actionRows: actionRows.length,
    retestRows: retestRows.length,
  };

  const charts = {
    funnel: funnelSvg(master),
    topics: barSvg({ title: "Topic Source Authority Priority", rows: topicRows.slice(0, 10), labelKey: "category", valueKey: "priority", color: "#ea580c" }),
    competitors: barSvg({ title: "Competitor Source Pressure", rows: competitorRows.slice(0, 10), labelKey: "brand", valueKey: "priority", color: "#7c3aed" }),
  };

  await writeFile(path.join(outDir, "topic-source-authority-priority.csv"), csv([
    ["priority", "category", "live_pages", "avg_citability_score", "benchmark_pressure_pages", "zero_mention_queries", "competitor_only_answers", "avg_mention_rate", "canonical_review_pages", "product_entity_targets", "top_competitors", "source_targets", "contractor_why", "recommended_owner", "next_action"],
    ...topicRows.map((row) => [row.priority, row.category, row.live_pages, row.avg_citability_score, row.benchmark_pressure_pages, row.zero_mention_queries, row.competitor_only_answers, row.avg_mention_rate, row.canonical_review_pages, row.product_entity_targets, row.top_competitors, row.source_targets, row.contractor_why, row.recommended_owner, row.next_action]),
  ]));
  await writeFile(path.join(outDir, "competitor-source-opportunities.csv"), csv([
    ["priority", "brand", "lost_answers", "co_mentioned_wins", "categories", "providers", "language_patterns", "example_queries", "offsite_target", "why", "success_metric"],
    ...competitorRows.map((row) => [row.priority, row.brand, row.lost_answers, row.co_mentioned_wins, row.categories, row.providers, row.language_patterns, row.example_queries, row.offsite_target, row.why, row.success_metric]),
  ]));
  await writeFile(path.join(outDir, "source-authority-action-plan.csv"), csv([
    ["priority", "owner", "workstream", "target", "action", "why", "success_metric"],
    ...actionRows.map((row) => [row.priority, row.owner, row.workstream, row.target, row.action, row.why, row.success_metric]),
  ]));
  await writeFile(path.join(outDir, "source-authority-retest-queue.csv"), csv([
    ["priority", "query", "category", "baseline_mention_rate", "baseline_top_three_rate", "competitor_only_answers", "weakest_providers", "mapped_page", "retest_action"],
    ...retestRows.map((row) => [row.priority, row.query, row.category, row.baseline_mention_rate, row.baseline_top_three_rate, row.competitor_only_answers, row.weakest_providers, row.mapped_page, row.retest_action]),
  ]));
  await writeFile(path.join(outDir, "source-authority-data.json"), `${JSON.stringify({ summary, topicRows, competitorRows, actionRows, retestRows }, null, 2)}\n`);
  await writeFile(path.join(outDir, "visibility-citation-funnel.svg"), charts.funnel);
  await writeFile(path.join(outDir, "topic-source-authority-priority.svg"), charts.topics);
  await writeFile(path.join(outDir, "competitor-source-pressure.svg"), charts.competitors);
  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown({ summary, topicRows, competitorRows, actionRows, retestRows }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({ summary, topicRows, competitorRows, actionRows, retestRows, charts }));

  console.log(`Wrote ${outDir}`);
  console.log(`Citation rate: ${summary.citationRate}%`);
  console.log(`Action rows: ${actionRows.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
