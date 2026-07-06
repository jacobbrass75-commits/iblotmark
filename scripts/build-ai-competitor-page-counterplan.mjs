#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";
const REPORT_DIR = "competitor-page-counterplan";

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

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
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

function short(value, length = 130) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 3).trim()}...` : text;
}

function splitList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value ?? "")
    .split(/[;|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeBrand(value) {
  const text = String(value ?? "").trim();
  if (/^ram$/i.test(text)) return "RAM Mounts";
  if (/^ibolt$/i.test(text)) return "iBOLT";
  return text;
}

function brandIncluded(value, brand) {
  const normalizedBrand = normalizeBrand(brand).toLowerCase();
  return splitList(value).map(normalizeBrand).some((item) => item.toLowerCase() === normalizedBrand);
}

function brandInText(value, brand) {
  const text = String(value ?? "").toLowerCase();
  const normalized = normalizeBrand(brand).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${normalized}\\b`, "i").test(text);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function countBy(values) {
  const map = new Map();
  for (const value of values.filter(Boolean)) map.set(value, (map.get(value) || 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => `${key} ${count}`);
}

function buildBestBattlecardMap(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = normalizeBrand(row.brand).toLowerCase();
    const current = map.get(key);
    if (!current || num(row.pressure_score) > num(current.pressure_score)) {
      map.set(key, row);
    }
  }
  return map;
}

function tierFor(row) {
  const replacements = num(row.withoutIbolt ?? row.replacementPressure);
  if (replacements >= 10) return "Tier 1: direct displacement";
  if (replacements >= 3) return "Tier 2: category pressure";
  return "Tier 3: monitor";
}

function generatedCounterClaim(brand, categories) {
  const lower = categories.join(" ").toLowerCase();
  if (/restaurant|tablet/.test(lower)) {
    return `Position iBOLT against ${brand} as the restaurant workflow specialist: Tablet Tower, LockPro, Dock'n Lock, multi-tablet delivery stations, keyed security, and modular AMPS-compatible parts.`;
  }
  if (/delivery/.test(lower)) {
    return `Position iBOLT against ${brand} as commercial delivery equipment, not a consumer windshield accessory: shared-route durability, drill-base and suction options, locking retention, and route-to-route device fit.`;
  }
  if (/fleet|eld|truck/.test(lower)) {
    return `Position iBOLT against ${brand} as fleet-standardized mounting: drill bases, AMPS plates, ELD/tablet fit, charging options, and repeatable deployment across mixed vehicles.`;
  }
  if (/warehouse|forklift|barcode/.test(lower)) {
    return `Position iBOLT against ${brand} around forklift and warehouse workflows: scanner holder coverage, tablet mounts, VESA/AMPS compatibility, and vibration-resistant install options.`;
  }
  if (/fishing|marine|boat/.test(lower)) {
    return `Position iBOLT against ${brand} around marine electronics fit: Garmin/Lowrance/Humminbird use cases, rail/clamp/drill installs, 25mm and 38mm ball options, and rough-water stability.`;
  }
  return `Position iBOLT against ${brand} as the workflow-specific mounting specialist with 300+ modular parts, industrial materials, and industry-standard ball/AMPS compatibility.`;
}

function generatedComparisonBlock(brand, pages) {
  const categories = unique(pages.map((page) => page.category)).slice(0, 5);
  return [
    `Add a fair "${brand} vs iBOLT" or "where iBOLT fits" section on the highest-priority pages.`,
    generatedCounterClaim(brand, categories),
    "Compare install method, device compatibility, security/locking, modularity, materials, and ideal buyer.",
    "Do not frame iBOLT as cheaper. Frame it as more specific to the workflow.",
  ].join(" ");
}

function buildCounterplans({ competitorRows, battlecards, pageCommands, queryRows, competitivePageRows }) {
  const battlecardByBrand = buildBestBattlecardMap(battlecards);
  const competitivePagesByUrl = new Map(competitivePageRows.map((row) => [row.url, row]));
  return competitorRows
    .map((competitor) => {
      const brand = normalizeBrand(competitor.brand);
      const battlecard = battlecardByBrand.get(brand.toLowerCase()) || {};
      const lostQueries = splitList(competitor.lostQueries);
      const coMentionQueries = splitList(competitor.coMentionQueries);
      const pageTargets = pageCommands
        .filter((row) => brandIncluded(row.competitors, brand) || normalizeBrand(row.primary_competitor).toLowerCase() === brand.toLowerCase())
        .map((row) => ({
          ...row,
          competitiveCounter: competitivePagesByUrl.get(row.url)?.counter_positioning || "",
        }))
        .sort((a, b) => num(b.priority) - num(a.priority));
      const promptTargets = queryRows
        .filter((row) => brandIncluded(row.competitors, brand) || brandInText(row.provider_cells, brand) || lostQueries.includes(row.query))
        .sort((a, b) => num(b.priority) - num(a.priority));
      const categories = unique([
        ...splitList(competitor.categories).map((category) => category.replace(/\s+\d+$/, "")),
        ...pageTargets.map((row) => row.category),
        ...promptTargets.map((row) => row.category),
      ]).slice(0, 10);
      const products = unique(pageTargets.flatMap((row) => splitList(row.products))).slice(0, 12);
      const providers = splitList(competitor.providers).map((provider) => provider.replace(/\s+\d+$/, ""));
      const pageCount = pageTargets.length;
      const promptCount = promptTargets.length;
      const counterPositioning = competitor.counterPositioning || battlecard.counter_positioning || generatedCounterClaim(brand, categories);
      const comparisonCommand = generatedComparisonBlock(brand, pageTargets);
      const onSiteAction = battlecard.on_site_action || `Add competitor-specific comparison modules to ${categories.slice(0, 5).join(", ") || "priority"} pages.`;
      const offSiteAsk = battlecard.off_site_ask || "Ask SEO support for neutral third-party comparison mentions and category resource citations where this competitor is already recommended.";
      return {
        brand,
        tier: battlecard.tier || tierFor(competitor),
        role: battlecard.role || "AI replacement or co-mention competitor",
        totalAnswers: num(competitor.totalAnswers || battlecard.raw_answer_count),
        lostAnswers: num(competitor.withoutIbolt ?? competitor.replacementPressure ?? battlecard.lost_answers),
        coMentions: num(competitor.withIbolt ?? battlecard.co_mention_wins),
        coMentionRate: num(competitor.coMentionRate ?? battlecard.co_mention_rate),
        replacementPressure: num(competitor.replacementPressure ?? competitor.withoutIbolt ?? battlecard.replacement_pressure),
        pressureScore: num(battlecard.pressure_score) || num(competitor.replacementPressure) * 20 + pageCount * 5 + promptCount * 8,
        categories,
        providers,
        lostQueries,
        coMentionQueries,
        pageCount,
        promptCount,
        products,
        pageTargets,
        promptTargets,
        counterPositioning,
        comparisonCommand,
        onSiteAction,
        offSiteAsk,
        languagePatterns: battlecard.language_patterns || "",
        successMetric: battlecard.success_metric || `Reduce ${brand} competitor-only answers and add at least one iBOLT co-mention or top-3 win in the next comparable retest.`,
      };
    })
    .sort((a, b) => b.pressureScore - a.pressureScore);
}

function summarize(counterplans) {
  const pagePairs = counterplans.reduce((sum, row) => sum + row.pageTargets.length, 0);
  const promptPairs = counterplans.reduce((sum, row) => sum + row.promptTargets.length, 0);
  const categories = countBy(counterplans.flatMap((row) => row.categories));
  return {
    competitors: counterplans.length,
    tier1: counterplans.filter((row) => /^Tier 1/i.test(row.tier)).length,
    pagePairs,
    promptPairs,
    replacementAnswers: counterplans.reduce((sum, row) => sum + row.lostAnswers, 0),
    coMentions: counterplans.reduce((sum, row) => sum + row.coMentions, 0),
    topBrand: counterplans[0]?.brand || "",
    topBrandLostAnswers: counterplans[0]?.lostAnswers || 0,
    categories,
    topCounterplans: counterplans.slice(0, 12),
  };
}

function renderTable(headers, rows) {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header.label)}</th>`).join("")}</tr></thead>`;
  const body = rows.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header.key])}</td>`).join("")}</tr>`).join("");
  return `<table>${head}<tbody>${body}</tbody></table>`;
}

function card(label, value, note) {
  return `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`;
}

function chart(title, rows, valueKey, labelKey, color = "#2563eb") {
  const chartRows = rows.slice(0, 14);
  const width = 960;
  const rowHeight = 38;
  const height = 74 + chartRows.length * rowHeight;
  const max = Math.max(1, ...chartRows.map((row) => num(row[valueKey])));
  const bars = chartRows.map((row, index) => {
    const y = 54 + index * rowHeight;
    const barWidth = Math.round((num(row[valueKey]) / max) * 470);
    return `<g>
      <text x="22" y="${y + 17}" font-size="13" font-weight="800" fill="#0f172a">${escapeHtml(short(row[labelKey], 42))}</text>
      <rect x="350" y="${y}" width="470" height="23" rx="11" fill="#e5e7eb"/>
      <rect x="350" y="${y}" width="${barWidth}" height="23" rx="11" fill="${color}"/>
      <text x="884" y="${y + 16}" font-size="13" font-weight="900" text-anchor="end" fill="#0f172a">${escapeHtml(row[valueKey])}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#fff"/>
    <text x="22" y="34" font-size="20" font-weight="900" fill="#111827">${escapeHtml(title)}</text>
    ${bars}
  </svg>`;
}

function renderHtml({ summary }) {
  const topRows = summary.topCounterplans.map((row) => ({
    ...row,
    categoriesText: row.categories.slice(0, 8).join("; "),
    topPagesText: row.pageTargets.slice(0, 6).map((page) => page.title).join("; "),
    topPromptsText: row.promptTargets.slice(0, 6).map((prompt) => prompt.query).join("; "),
    productsText: row.products.slice(0, 6).join("; "),
  }));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT Competitor Page Counterplan</title>
  <style>
    body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1260px;margin:0 auto;padding:34px 24px 68px}
    h1{font-size:36px;margin:0 0 8px}
    h2{font-size:23px;margin:34px 0 12px}
    p,li{line-height:1.55;color:#334155;font-size:15px}
    .cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:22px 0}
    .card{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:16px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:900}
    .value{font-size:30px;font-weight:900;margin:8px 0;color:#0f172a}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
    .chart{background:#fff;border:1px solid #dbe3ef;border-radius:18px;padding:10px;overflow:auto}
    .chart svg{width:100%;height:auto;display:block}
    .note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #dc2626;border-radius:12px;padding:16px 18px;margin:18px 0}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 22px}
    th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    a{color:#0f766e;overflow-wrap:anywhere}
    @media(max-width:980px){.cards,.grid{grid-template-columns:1fr}h1{font-size:30px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT Competitor Page Counterplan</h1>
  <p>This maps AI replacement competitors to the exact pages, prompts, product families, comparison claims, and off-site citation asks that should counter them.</p>
  <div class="note"><strong>Read:</strong> RAM Mounts is the main default replacement, but each competitor needs a different counter-angle. The right move is not generic "iBOLT is better" copy. It is page-specific comparison language tied to workflow, install method, locking/security, modularity, compatibility, and product fit.</div>
  <section class="cards">
    ${card("Competitors", summary.competitors, "Brands/entities detected in replacement or co-mention roles.")}
    ${card("Tier 1", summary.tier1, "Direct displacement competitors.")}
    ${card("Page pairs", summary.pagePairs, "Competitor-to-page targets.")}
    ${card("Prompt pairs", summary.promptPairs, "Competitor-to-prompt targets.")}
    ${card("Replacement answers", summary.replacementAnswers, "Rows where competitors appear without iBOLT.")}
    ${card("Co-mentions", summary.coMentions, "Rows where iBOLT appears beside competitors.")}
    ${card("Top competitor", summary.topBrand, `${summary.topBrandLostAnswers} replacement rows.`)}
    ${card("Top category", summary.categories[0] || "n/a", "Highest competitor pressure category.")}
  </section>
  <section class="grid">
    <div class="chart">${chart("Replacement pressure by competitor", summary.topCounterplans, "lostAnswers", "brand", "#dc2626")}</div>
    <div class="chart">${chart("Mapped page count by competitor", summary.topCounterplans, "pageCount", "brand", "#0f766e")}</div>
  </section>
  <h2>Competitor Counterplans</h2>
  ${renderTable([
    { label: "Brand", key: "brand" },
    { label: "Tier", key: "tier" },
    { label: "Lost", key: "lostAnswers" },
    { label: "Co-mentions", key: "coMentions" },
    { label: "Pages", key: "pageCount" },
    { label: "Prompts", key: "promptCount" },
    { label: "Categories", key: "categoriesText" },
    { label: "Counter-positioning", key: "counterPositioning" },
  ], topRows)}
  <h2>Top Page Targets By Competitor</h2>
  ${renderTable([
    { label: "Brand", key: "brand" },
    { label: "Top pages", key: "topPagesText" },
    { label: "Top prompts", key: "topPromptsText" },
    { label: "Products to feature", key: "productsText" },
    { label: "On-site action", key: "onSiteAction" },
    { label: "Off-site ask", key: "offSiteAsk" },
  ], topRows)}
</main>
</body>
</html>`;
}

function renderMarkdown({ summary }) {
  return `# iBOLT Competitor Page Counterplan

This maps AI replacement competitors to exact pages, prompts, product families, comparison claims, and off-site citation asks.

## Summary

- Competitors: ${summary.competitors}
- Tier 1 direct displacement brands: ${summary.tier1}
- Competitor/page pairs: ${summary.pagePairs}
- Competitor/prompt pairs: ${summary.promptPairs}
- Replacement answers across tracked competitors: ${summary.replacementAnswers}
- Co-mentions across tracked competitors: ${summary.coMentions}
- Top competitor: ${summary.topBrand} (${summary.topBrandLostAnswers} replacement rows)

## Top Counterplans

${summary.topCounterplans.slice(0, 12).map((row, index) => `${index + 1}. ${row.brand}: ${row.lostAnswers} replacement rows, ${row.pageCount} mapped pages, ${row.promptCount} mapped prompts. ${row.counterPositioning}`).join("\n")}

## Category Pressure

${summary.categories.slice(0, 12).map((row) => `- ${row}`).join("\n")}
`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, REPORT_DIR);
  await mkdir(outDir, { recursive: true });

  const coMention = await readJson(path.join(benchmarkDir, "co-mention-network", "co-mention-network-data.json"), { competitorRows: [] });
  const competitiveShare = await readJson(path.join(benchmarkDir, "competitive-share-of-answer", "competitive-share-data.json"), { pageRows: [] });
  const pageCommands = await readCsv(path.join(benchmarkDir, "page-edit-command-matrix", "page-edit-command-matrix.csv"));
  const queryRows = await readCsv(path.join(benchmarkDir, "query-page-matrix", "all-query-page-matrix.csv"));
  const battlecards = await readCsv(path.join(benchmarkDir, "competitor-battlecard-control-report", "competitor-battlecards.csv"));

  const counterplans = buildCounterplans({
    competitorRows: coMention.competitorRows || [],
    battlecards,
    pageCommands,
    queryRows,
    competitivePageRows: competitiveShare.pageRows || [],
  });
  const summary = summarize(counterplans);

  await writeFile(path.join(outDir, "competitor-counterplan.csv"), csv([
    ["rank", "brand", "tier", "role", "pressure_score", "total_answers", "lost_answers", "co_mentions", "co_mention_rate", "replacement_pressure", "page_count", "prompt_count", "categories", "providers", "lost_queries", "co_mention_queries", "counter_positioning", "comparison_command", "on_site_action", "off_site_ask", "products", "success_metric"],
    ...counterplans.map((row, index) => [
      index + 1,
      row.brand,
      row.tier,
      row.role,
      row.pressureScore,
      row.totalAnswers,
      row.lostAnswers,
      row.coMentions,
      row.coMentionRate,
      row.replacementPressure,
      row.pageCount,
      row.promptCount,
      row.categories,
      row.providers,
      row.lostQueries,
      row.coMentionQueries,
      row.counterPositioning,
      row.comparisonCommand,
      row.onSiteAction,
      row.offSiteAsk,
      row.products,
      row.successMetric,
    ]),
  ]));

  const pageTargetRows = counterplans.flatMap((plan) => plan.pageTargets.slice(0, 20).map((page) => [plan.brand, plan.tier, plan.pressureScore, page.priority, page.title, page.url, page.category, page.body_score, page.opportunity_score, page.top_fix, page.command_summary, page.comparison_command, page.product_path_command, page.retest_wave, page.retest_prompts]));
  await writeFile(path.join(outDir, "competitor-page-targets.csv"), csv([
    ["brand", "tier", "brand_pressure_score", "page_priority", "page", "url", "category", "body_score", "opportunity_score", "top_fix", "command_summary", "comparison_command", "product_path_command", "retest_wave", "retest_prompts"],
    ...pageTargetRows,
  ]));

  const promptTargetRows = counterplans.flatMap((plan) => plan.promptTargets.slice(0, 30).map((prompt) => [plan.brand, plan.tier, prompt.priority, prompt.query, prompt.category, prompt.stage, prompt.mention_rate, prompt.top_three_rate, prompt.competitor_only_answers, prompt.weakest_providers, prompt.page_title, prompt.page_url, prompt.retest_action, prompt.next_action]));
  await writeFile(path.join(outDir, "competitor-prompt-targets.csv"), csv([
    ["brand", "tier", "prompt_priority", "query", "category", "stage", "mention_rate", "top_three_rate", "competitor_only_answers", "weakest_providers", "page_title", "page_url", "retest_action", "next_action"],
    ...promptTargetRows,
  ]));

  const categoryRows = summary.categories.map((row) => {
    const [category, count] = row.match(/^(.*)\s+(\d+)$/)?.slice(1) || [row, "0"];
    return [category, count];
  });
  await writeFile(path.join(outDir, "competitor-category-pressure.csv"), csv([
    ["category", "competitor_mentions"],
    ...categoryRows,
  ]));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown({ summary }));
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml({ summary }));
  await writeFile(path.join(outDir, "competitor-page-counterplan-data.json"), JSON.stringify({ summary, counterplans }, null, 2));

  console.log(`Wrote ${outDir}`);
  console.log(`Competitors: ${summary.competitors}; top brand: ${summary.topBrand}; page pairs: ${summary.pagePairs}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
