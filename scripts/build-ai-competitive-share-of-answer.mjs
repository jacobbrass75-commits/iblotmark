#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";
const REPORT_DIR = "competitive-share-of-answer";

const BRAND_ALIASES = new Map([
  ["ram", "RAM Mounts"],
  ["ram mounts", "RAM Mounts"],
  ["mount-it!", "Mount-It"],
  ["mount-it", "Mount-It"],
  ["cta digital", "CTA Digital"],
  ["iottie", "iOttie"],
  ["proclip", "ProClip"],
  ["yakattack", "YakAttack"],
  ["quad lock", "Quad Lock"],
  ["peak design", "Peak Design"],
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
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted && char === '"' && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some((value) => value.trim())) rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows.shift();
  return rows.map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""])));
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

async function readCsv(filePath) {
  try {
    return parseCsv(await readFile(filePath, "utf8"));
  } catch {
    return [];
  }
}

function num(value) {
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(numerator, denominator) {
  return denominator ? Math.round((num(numerator) / denominator) * 100) : 0;
}

function splitList(value) {
  return String(value ?? "")
    .split(/[;,|]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/^\+\d+\s+more$/i.test(item));
}

function normalizeBrand(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  if (/^ibolt(?: mounts)?$/i.test(text)) return "";
  const lower = text.toLowerCase();
  return BRAND_ALIASES.get(lower) || text;
}

function splitBrands(value) {
  return [...new Set(splitList(value).map(normalizeBrand).filter(Boolean))];
}

function increment(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function counterText(map, limit = 6) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, value]) => `${key} ${value}`)
    .join("; ");
}

function short(value, length = 92) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 3).trim()}...` : text;
}

function outcomeState(row) {
  const brandMentioned = row.brand_mentioned === "true";
  const competitors = splitBrands(row.competitors);
  if (brandMentioned && competitors.length) return "co-mentioned";
  if (brandMentioned) return "clean-iBOLT";
  if (competitors.length) return "competitor-only";
  return "no-signal";
}

function counterPositioning(brand) {
  if (brand === "RAM Mounts") return "Make iBOLT the workflow specialist beside RAM: AMPS/ball compatibility, 300+ modular parts, and exact restaurant, fleet, warehouse, delivery, and marine use cases.";
  if (brand === "Arkon") return "Contrast generic commercial mounts with iBOLT locking installs, Tablet Tower, forklift workflows, drill bases, and fleet repeatability.";
  if (brand === "iOttie" || brand === "Belkin" || brand === "Scosche") return "Separate consumer car accessories from commercial delivery, shared-vehicle, and fleet phone mounting.";
  if (brand === "ProClip") return "Compare vehicle-specific fit against iBOLT modular deployment across trucks, vans, and changing devices.";
  if (brand === "CTA Digital" || brand === "Mount-It" || brand === "Bouncepad" || brand === "Heckler") return "Own restaurant operations: multi-tablet delivery stations, keyed holders, LockPro, Dock'n Lock, and Tablet Tower.";
  if (brand === "Garmin" || brand === "Humminbird" || brand === "Lowrance") return "Clarify that these are electronics brands while iBOLT provides the mounting plate, arm, rail, and vibration-control system around them.";
  if (brand === "Scotty" || brand === "YakAttack") return "Place iBOLT in marine accessory sets around AMPS plates, modular arms, and secure kayak or boat mounting.";
  if (brand === "Havis" || brand === "Zebra") return "Tie iBOLT into warehouse and forklift device workflows rather than competing with rugged devices or scanning systems directly.";
  return "Add fair comparison language that names where iBOLT should be considered against this brand.";
}

function buildCompetitorShareRows(answers, plannerRows) {
  const totalAnswers = answers.length;
  const map = new Map();
  const ensure = (brand) => {
    if (!map.has(brand)) {
      map.set(brand, {
        brand,
        answerMentions: 0,
        competitorOnlyRows: 0,
        coMentionRows: 0,
        topThreeCoMentions: 0,
        categories: new Map(),
        providers: new Map(),
        lostQueries: new Map(),
        coMentionQueries: new Map(),
        mappedPages: new Map(),
      });
    }
    return map.get(brand);
  };

  for (const row of answers) {
    const state = outcomeState(row);
    const brands = splitBrands(row.competitors);
    for (const brand of brands) {
      const item = ensure(brand);
      item.answerMentions += 1;
      increment(item.categories, row.category || "unknown");
      increment(item.providers, row.provider || row.provider_key || "unknown");
      if (state === "competitor-only") {
        item.competitorOnlyRows += 1;
        increment(item.lostQueries, row.query);
        increment(item.mappedPages, row.mapped_page_title || row.mapped_page || "");
      }
      if (state === "co-mentioned") {
        item.coMentionRows += 1;
        increment(item.coMentionQueries, row.query);
        if (num(row.top_pick_rank) && num(row.top_pick_rank) <= 3) item.topThreeCoMentions += 1;
      }
    }
  }

  for (const planner of plannerRows) {
    for (const brand of splitBrands(planner.competitors)) {
      const item = ensure(brand);
      increment(item.mappedPages, planner.title || planner.url || "");
    }
  }

  return [...map.values()]
    .map((row) => {
      const recoverability = row.coMentionRows
        ? "Protect and expand co-mentions"
        : row.competitorOnlyRows >= 10
          ? "High-priority displacement"
          : row.competitorOnlyRows >= 3
            ? "Targeted comparison cleanup"
            : "Monitor";
      return {
        brand: row.brand,
        answer_mentions: row.answerMentions,
        answer_share_pct: pct(row.answerMentions, totalAnswers),
        competitor_only_rows: row.competitorOnlyRows,
        competitor_only_share_pct: pct(row.competitorOnlyRows, totalAnswers),
        co_mention_rows: row.coMentionRows,
        co_mention_rate_with_brand_pct: pct(row.coMentionRows, Math.max(row.answerMentions, 1)),
        top_three_co_mentions: row.topThreeCoMentions,
        top_categories: counterText(row.categories, 7),
        top_providers: counterText(row.providers, 5),
        lost_queries: counterText(row.lostQueries, 8),
        co_mention_queries: counterText(row.coMentionQueries, 8),
        mapped_pages: counterText(row.mappedPages, 8),
        recoverability,
        counter_positioning: counterPositioning(row.brand),
      };
    })
    .sort((a, b) => b.competitor_only_rows - a.competitor_only_rows || b.answer_mentions - a.answer_mentions || a.brand.localeCompare(b.brand));
}

function buildProviderCategoryRows(answers) {
  const groups = new Map();
  const ensure = (provider, category) => {
    const key = `${provider}::${category}`;
    if (!groups.has(key)) {
      groups.set(key, {
        provider,
        category,
        answers: 0,
        iboltMentions: 0,
        topThree: 0,
        competitorOnly: 0,
        citations: 0,
        competitors: new Map(),
        coMentions: new Map(),
      });
    }
    return groups.get(key);
  };

  for (const row of answers) {
    const provider = row.provider || row.provider_key || "unknown";
    const category = row.category || "unknown";
    const group = ensure(provider, category);
    const brands = splitBrands(row.competitors);
    const brandMentioned = row.brand_mentioned === "true";
    group.answers += 1;
    if (brandMentioned) group.iboltMentions += 1;
    if (row.domain_cited === "true") group.citations += 1;
    if (num(row.top_pick_rank) && num(row.top_pick_rank) <= 3) group.topThree += 1;
    if (!brandMentioned && brands.length) group.competitorOnly += 1;
    for (const brand of brands) {
      increment(group.competitors, brand);
      if (brandMentioned) increment(group.coMentions, brand);
    }
  }

  return [...groups.values()]
    .map((row) => ({
      provider: row.provider,
      category: row.category,
      answers: row.answers,
      ibolt_mentions: row.iboltMentions,
      mention_rate_pct: pct(row.iboltMentions, row.answers),
      top_three_rows: row.topThree,
      top_three_rate_pct: pct(row.topThree, row.answers),
      competitor_only_rows: row.competitorOnly,
      competitor_only_rate_pct: pct(row.competitorOnly, row.answers),
      citation_rows: row.citations,
      citation_rate_pct: pct(row.citations, row.answers),
      top_competitors: counterText(row.competitors, 7),
      co_mentioned_competitors: counterText(row.coMentions, 7),
    }))
    .sort((a, b) => b.competitor_only_rate_pct - a.competitor_only_rate_pct || b.answers - a.answers || a.provider.localeCompare(b.provider));
}

function buildPageCounterRows(plannerRows, shareRows) {
  const brandRank = new Map(shareRows.map((row, index) => [row.brand, index + 1]));
  return plannerRows
    .map((page) => {
      const brands = splitBrands(page.competitors)
        .sort((a, b) => (brandRank.get(a) || 999) - (brandRank.get(b) || 999));
      const primary = brands[0] || "";
      return {
        edit_order: page.edit_order,
        batch: page.batch,
        title: page.title,
        url: page.url,
        category: page.category,
        primary_competitor: primary,
        competitor_set: brands.slice(0, 8).join("; "),
        counter_positioning: counterPositioning(primary),
        products_to_feature: page.products_to_feature,
        retest_wave: page.retest_wave,
        retest_prompts: page.retest_prompts,
      };
    })
    .filter((row) => row.primary_competitor)
    .sort((a, b) => num(a.edit_order) - num(b.edit_order));
}

function renderBarChart(title, rows, valueKey, labelKey = "brand", color = "#0f766e") {
  const chartRows = rows.slice(0, 12);
  const width = 920;
  const rowHeight = 36;
  const height = 74 + chartRows.length * rowHeight;
  const max = Math.max(1, ...chartRows.map((row) => num(row[valueKey])));
  const bars = chartRows.map((row, index) => {
    const y = 54 + index * rowHeight;
    const barWidth = Math.round((num(row[valueKey]) / max) * 500);
    return `<g>
      <text x="22" y="${y + 17}" font-size="13" font-weight="800" fill="#0f172a">${escapeHtml(short(row[labelKey], 35))}</text>
      <rect x="278" y="${y}" width="500" height="22" rx="11" fill="#e5e7eb"/>
      <rect x="278" y="${y}" width="${barWidth}" height="22" rx="11" fill="${color}"/>
      <text x="860" y="${y + 16}" font-size="13" font-weight="900" text-anchor="end" fill="#0f172a">${escapeHtml(row[valueKey])}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#fff"/>
    <text x="22" y="34" font-size="20" font-weight="900" fill="#111827">${escapeHtml(title)}</text>
    ${bars}
  </svg>`;
}

function renderTable(headers, rows) {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header.label)}</th>`).join("")}</tr></thead>`;
  const body = rows.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header.key])}</td>`).join("")}</tr>`).join("");
  return `<table>${head}<tbody>${body}</tbody></table>`;
}

function card(label, value, note) {
  return `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`;
}

function renderHtml({ summary, shareRows, providerRows, pageRows }) {
  const topCompetitors = shareRows.slice(0, 10);
  const providerWorst = providerRows.slice(0, 12);
  const firstPages = pageRows.slice(0, 12);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT Competitive Share of Answer</title>
  <style>
    body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1220px;margin:0 auto;padding:34px 24px 64px}
    h1{font-size:36px;margin:0 0 8px;letter-spacing:0}
    h2{font-size:23px;margin:34px 0 12px}
    p,li{line-height:1.55;color:#334155;font-size:15px}
    .note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #0f766e;border-radius:12px;padding:16px 18px;margin:20px 0}
    .warn{border-left-color:#f97316}
    .cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:22px 0}
    .card{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:16px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:900}
    .value{font-size:28px;font-weight:900;margin:8px 0;color:#0f172a}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
    .chart{background:#fff;border:1px solid #dbe3ef;border-radius:18px;padding:10px;overflow:auto}
    .chart svg{width:100%;height:auto;display:block}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 22px}
    th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    a{color:#0f766e;overflow-wrap:anywhere}
    @media(max-width:960px){.cards,.grid{grid-template-columns:1fr}h1{font-size:30px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT Competitive Share of Answer</h1>
  <p>This report translates the saved AI benchmark into the brands that own answer space around iBOLT, where iBOLT is co-mentioned, and which pages should counter each competitor first.</p>

  <div class="note warn">
    <strong>Read this as competitive visibility, not traffic attribution.</strong> A competitor can appear in more rows than the number of answers because one AI answer can mention several brands.
  </div>

  <section class="cards">
    ${card("Answers analyzed", summary.answers, "Saved ChatGPT, Gemini, and Claude benchmark rows.")}
    ${card("Brands detected", summary.brands, "Normalized competitor/entity brands in answers and page plans.")}
    ${card("iBOLT mention rate", `${summary.iboltMentionRate}%`, `${summary.iboltMentions}/${summary.answers} answers mention iBOLT.`)}
    ${card("Competitor-only", `${summary.competitorOnlyRate}%`, `${summary.competitorOnly}/${summary.answers} answers recommend competitors without iBOLT.`)}
    ${card("Citation rate", `${summary.citationRate}%`, `${summary.citations}/${summary.answers} answers cite iboltmounts.com.`)}
  </section>

  <section class="grid">
    <div class="chart">${renderBarChart("Competitor-only answer pressure", topCompetitors, "competitor_only_rows", "brand", "#ef4444")}</div>
    <div class="chart">${renderBarChart("Co-mentions with iBOLT", [...shareRows].sort((a, b) => b.co_mention_rows - a.co_mention_rows), "co_mention_rows", "brand", "#2563eb")}</div>
  </section>

  <h2>Competitor Scorecard</h2>
  ${renderTable([
    { label: "Brand", key: "brand" },
    { label: "Answer share", key: "answer_share_pct" },
    { label: "Competitor-only rows", key: "competitor_only_rows" },
    { label: "Co-mentions", key: "co_mention_rows" },
    { label: "Top categories", key: "top_categories" },
    { label: "Counter-positioning", key: "counter_positioning" },
  ], topCompetitors)}

  <h2>Provider and Category Pressure</h2>
  ${renderTable([
    { label: "Provider", key: "provider" },
    { label: "Category", key: "category" },
    { label: "Answers", key: "answers" },
    { label: "iBOLT mention rate", key: "mention_rate_pct" },
    { label: "Competitor-only rate", key: "competitor_only_rate_pct" },
    { label: "Top competitors", key: "top_competitors" },
  ], providerWorst)}

  <h2>First Page Counterplan</h2>
  ${renderTable([
    { label: "Order", key: "edit_order" },
    { label: "Batch", key: "batch" },
    { label: "Page", key: "title" },
    { label: "Primary competitor", key: "primary_competitor" },
    { label: "Counter-positioning", key: "counter_positioning" },
    { label: "Retest", key: "retest_wave" },
  ], firstPages)}
</main>
</body>
</html>`;
}

function renderMarkdown({ summary, shareRows, providerRows, pageRows }) {
  return `# iBOLT Competitive Share of Answer

## Bottom Line

iBOLT is not just competing with one brand in AI answers. RAM Mounts is the broad default, while Arkon, ProClip, iOttie, CTA Digital, Mount-It, Havis, Zebra, Garmin, Humminbird, Lowrance, Scotty, and YakAttack pressure specific categories.

- Answers analyzed: ${summary.answers}
- iBOLT mention rate: ${summary.iboltMentions}/${summary.answers} (${summary.iboltMentionRate}%)
- Competitor-only rows: ${summary.competitorOnly}/${summary.answers} (${summary.competitorOnlyRate}%)
- Citation rows: ${summary.citations}/${summary.answers} (${summary.citationRate}%)
- Brands detected: ${summary.brands}

## Top Competitor Pressure

${shareRows.slice(0, 12).map((row, index) => `${index + 1}. ${row.brand}: ${row.competitor_only_rows} competitor-only rows, ${row.co_mention_rows} co-mentions. Counter: ${row.counter_positioning}`).join("\n")}

## Worst Provider/Category Pockets

${providerRows.slice(0, 12).map((row) => `- ${row.provider} / ${row.category}: ${row.competitor_only_rate_pct}% competitor-only, top competitors: ${row.top_competitors}`).join("\n")}

## First Page Counterplan

${pageRows.slice(0, 12).map((row) => `- ${row.edit_order}. ${row.title}: counter ${row.primary_competitor}; ${row.counter_positioning}`).join("\n")}
`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, REPORT_DIR);
  const answers = await readCsv(path.join(benchmarkDir, "answer-outcome-taxonomy", "answer-outcome-ledger.csv"));
  const plannerRows = await readCsv(path.join(benchmarkDir, "all-blog-edit-retest-planner", "all-blog-edit-retest-plan.csv"));
  const shareRows = buildCompetitorShareRows(answers, plannerRows);
  const providerRows = buildProviderCategoryRows(answers);
  const pageRows = buildPageCounterRows(plannerRows, shareRows);
  const iboltMentions = answers.filter((row) => row.brand_mentioned === "true").length;
  const citations = answers.filter((row) => row.domain_cited === "true").length;
  const competitorOnly = answers.filter((row) => outcomeState(row) === "competitor-only").length;
  const summary = {
    answers: answers.length,
    brands: shareRows.length,
    iboltMentions,
    iboltMentionRate: pct(iboltMentions, answers.length),
    citations,
    citationRate: pct(citations, answers.length),
    competitorOnly,
    competitorOnlyRate: pct(competitorOnly, answers.length),
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "competitor-share-scorecard.csv"), csv([
    ["brand", "answer_mentions", "answer_share_pct", "competitor_only_rows", "competitor_only_share_pct", "co_mention_rows", "co_mention_rate_with_brand_pct", "top_three_co_mentions", "top_categories", "top_providers", "lost_queries", "co_mention_queries", "mapped_pages", "recoverability", "counter_positioning"],
    ...shareRows.map((row) => [
      row.brand,
      row.answer_mentions,
      row.answer_share_pct,
      row.competitor_only_rows,
      row.competitor_only_share_pct,
      row.co_mention_rows,
      row.co_mention_rate_with_brand_pct,
      row.top_three_co_mentions,
      row.top_categories,
      row.top_providers,
      row.lost_queries,
      row.co_mention_queries,
      row.mapped_pages,
      row.recoverability,
      row.counter_positioning,
    ]),
  ]));
  await writeFile(path.join(outDir, "provider-category-share.csv"), csv([
    ["provider", "category", "answers", "ibolt_mentions", "mention_rate_pct", "top_three_rows", "top_three_rate_pct", "competitor_only_rows", "competitor_only_rate_pct", "citation_rows", "citation_rate_pct", "top_competitors", "co_mentioned_competitors"],
    ...providerRows.map((row) => [
      row.provider,
      row.category,
      row.answers,
      row.ibolt_mentions,
      row.mention_rate_pct,
      row.top_three_rows,
      row.top_three_rate_pct,
      row.competitor_only_rows,
      row.competitor_only_rate_pct,
      row.citation_rows,
      row.citation_rate_pct,
      row.top_competitors,
      row.co_mentioned_competitors,
    ]),
  ]));
  await writeFile(path.join(outDir, "competitor-page-counterplan.csv"), csv([
    ["edit_order", "batch", "title", "url", "category", "primary_competitor", "competitor_set", "counter_positioning", "products_to_feature", "retest_wave", "retest_prompts"],
    ...pageRows.map((row) => [
      row.edit_order,
      row.batch,
      row.title,
      row.url,
      row.category,
      row.primary_competitor,
      row.competitor_set,
      row.counter_positioning,
      row.products_to_feature,
      row.retest_wave,
      row.retest_prompts,
    ]),
  ]));
  await writeFile(path.join(outDir, "boss-competitive-talking-points.md"), renderMarkdown({ summary, shareRows, providerRows, pageRows }));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown({ summary, shareRows, providerRows, pageRows }));
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml({ summary, shareRows, providerRows, pageRows }));
  await writeFile(path.join(outDir, "competitive-share-data.json"), JSON.stringify({ summary, shareRows, providerRows, pageRows }, null, 2));

  console.log(`Wrote ${outDir}`);
  console.log(`Brands: ${summary.brands}; competitor-only rows: ${summary.competitorOnly}; top competitor: ${shareRows[0]?.brand || "none"}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
