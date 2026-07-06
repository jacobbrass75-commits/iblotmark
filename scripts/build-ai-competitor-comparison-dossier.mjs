#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";
const REPORT_DIR = "competitor-comparison-dossier";

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

async function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function stringifyCsvValue(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => stringifyCsvValue(item))
      .filter(Boolean)
      .join("; ");
  }
  if (value && typeof value === "object") {
    return String(
      value.title ||
        value.page ||
        value.page_title ||
        value.query ||
        value.prompt ||
        value.name ||
        value.url ||
        value.label ||
        JSON.stringify(value),
    );
  }
  return String(value ?? "");
}

function csvCell(value) {
  const text = stringifyCsvValue(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function csv(rows) {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toNumber(value) {
  if (typeof value === "number") return value;
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(numerator, denominator) {
  return denominator ? Math.round((Number(numerator || 0) / Number(denominator || 1)) * 100) : 0;
}

function splitList(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.flatMap((item) => splitList(item)))];
  }
  const text = value && typeof value === "object" ? stringifyCsvValue(value) : String(value ?? "");
  return text
    .split(/;|,/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/^\+\d+\s+more$/i.test(item));
}

function normalizeBrand(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  if (/^ram$/i.test(text) || /^ram mounts?$/i.test(text)) return "RAM Mounts";
  if (/^mount[\s-]?it!?$/i.test(text)) return "Mount-It";
  if (/^cta$/i.test(text) || /^cta digital$/i.test(text)) return "CTA Digital";
  if (/^iottie$/i.test(text)) return "iOttie";
  if (/^ibolt(?: mounts)?$/i.test(text) || /^i bolt$/i.test(text)) return "";
  return text.replace(/\s+\d+$/g, "");
}

function normalizeBrands(value) {
  return [...new Set(splitList(value).map(normalizeBrand).filter(Boolean))];
}

function short(value, length = 120) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function addCounter(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function topCounter(map, limit = 6) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, value]) => `${name} ${value}`)
    .join("; ");
}

function indexByBrand(rows, field = "brand") {
  const map = new Map();
  for (const row of rows || []) {
    const brand = normalizeBrand(row[field]);
    if (brand) map.set(brand, row);
  }
  return map;
}

function competitorRole(brand) {
  if (brand === "RAM Mounts") return "Broad rugged/default mount authority";
  if (brand === "Arkon") return "Commercial vehicle and general phone/tablet mount default";
  if (brand === "iOttie") return "Consumer and delivery phone mount default";
  if (brand === "ProClip") return "Vehicle-specific bracket and fleet mount default";
  if (brand === "CTA Digital" || brand === "Mount-It" || brand === "Bouncepad" || brand === "Heckler" || brand === "Kensington") return "Tablet, POS, kiosk, and retail stand competitor";
  if (brand === "Havis" || brand === "Zebra") return "Warehouse, rugged-device, and enterprise hardware adjacency";
  if (brand === "Garmin" || brand === "Humminbird" || brand === "Lowrance" || brand === "YakAttack" || brand === "Scotty") return "Fishing device or marine accessory adjacency";
  return "Adjacent mount or device brand";
}

function counterPositioning(brand, fallback = "") {
  if (fallback) return fallback;
  if (brand === "RAM Mounts") return "Do not compete as cheaper RAM. Put iBOLT beside RAM as the application-specific specialist for commercial workflows, AMPS/ball compatibility, and 300+ modular parts.";
  if (brand === "Arkon") return "Separate generic vehicle holders from iBOLT's commercial-duty bases, locking options, multi-device restaurant stations, and fleet repeatability.";
  if (brand === "iOttie") return "Separate consumer car convenience from delivery, fleet, shared-vehicle, charging, and rugged-duty use cases.";
  if (brand === "ProClip") return "Compare vehicle-specific brackets against iBOLT's modular, transferable, AMPS-compatible fleet deployment.";
  if (brand === "CTA Digital" || brand === "Mount-It" || brand === "Bouncepad" || brand === "Heckler" || brand === "Kensington") return "Anchor iBOLT around Tablet Tower, LockPro, Dock'n Lock, multi-tablet delivery stations, and keyed security.";
  if (brand === "Havis" || brand === "Zebra") return "Clarify that iBOLT solves mounting for forklifts, scanners, tablets, VESA displays, and no-drill warehouse installs.";
  if (brand === "Garmin" || brand === "Humminbird" || brand === "Lowrance" || brand === "YakAttack" || brand === "Scotty") return "Clarify that device brands need a mounting system, plate, arm, rail, and rough-water placement solution.";
  return "Add fair comparison copy that gives the exact iBOLT use case where iBOLT should be considered.";
}

function buildCompetitorRows({ counterplans, shareRows, environmentRows, snippetCompetitors, contractorBriefs, pageRows, familyRows }) {
  const shareByBrand = indexByBrand(shareRows);
  const envByBrand = indexByBrand(environmentRows, "competitor");
  const snippetByBrand = indexByBrand(snippetCompetitors);
  const contractorByBrand = new Map();
  for (const brief of contractorBriefs || []) {
    for (const brand of normalizeBrands(brief.competitors)) {
      if (!contractorByBrand.has(brand)) contractorByBrand.set(brand, []);
      contractorByBrand.get(brand).push(brief);
    }
  }

  const pageBrandMap = new Map();
  for (const page of pageRows || []) {
    for (const brand of normalizeBrands(`${page.competitors} ${page.primary_competitor || ""}`)) {
      if (!pageBrandMap.has(brand)) pageBrandMap.set(brand, []);
      pageBrandMap.get(brand).push(page);
    }
  }

  const familyBrandMap = new Map();
  for (const family of familyRows || []) {
    for (const brand of normalizeBrands(`${family.topics} ${family.target_pages}`)) {
      if (!familyBrandMap.has(brand)) familyBrandMap.set(brand, []);
      familyBrandMap.get(brand).push(family);
    }
  }

  return (counterplans || []).map((plan) => {
    const brand = normalizeBrand(plan.brand);
    const share = shareByBrand.get(brand) || {};
    const env = envByBrand.get(brand) || {};
    const snippet = snippetByBrand.get(brand) || {};
    const pages = pageBrandMap.get(brand) || [];
    const briefs = contractorByBrand.get(brand) || [];
    const families = familyBrandMap.get(brand) || [];
    const lostAnswers = Math.max(toNumber(plan.lostAnswers), toNumber(share.competitor_only_rows), toNumber(env.replacements), toNumber(snippet.replacementRows));
    const coMentions = Math.max(toNumber(plan.coMentions), toNumber(share.co_mention_rows), toNumber(env.co_mentions), toNumber(snippet.coMentionRows));
    const answerMentions = Math.max(toNumber(plan.totalAnswers), toNumber(share.answer_mentions), lostAnswers + coMentions);
    const pressureScore = Math.max(toNumber(plan.pressureScore), toNumber(env.pressure_score), lostAnswers * 10 + coMentions * 3 + pages.length * 5);
    const recoveryStage = lostAnswers >= 20 ? "Tier 1 displacement recovery" : lostAnswers >= 8 ? "Category battlecard" : coMentions >= 3 ? "Co-mention upgrade" : "Monitor and cite";
    const pageTargets = pages.slice(0, 8).map((page) => page.title || page.page_title).filter(Boolean).join("; ") || splitList(plan.pageTargets).slice(0, 8).join("; ");
    const promptTargets = splitList(plan.promptTargets || share.lost_queries || env.lost_queries).slice(0, 8).join("; ");
    const products = splitList(plan.products).slice(0, 10).join("; ");
    const familyContext = families.slice(0, 4).map((family) => family.family).join("; ");
    return {
      brand,
      tier: plan.tier || env.threat_tier || recoveryStage,
      role: plan.role || competitorRole(brand),
      recovery_stage: recoveryStage,
      pressure_score: pressureScore,
      answer_mentions: answerMentions,
      answer_share_pct: toNumber(share.answer_share_pct),
      lost_answers: lostAnswers,
      co_mentions: coMentions,
      co_mention_rate: pct(coMentions, Math.max(1, answerMentions)),
      replacement_to_comention_ratio: coMentions ? Math.round((lostAnswers / coMentions) * 10) / 10 : lostAnswers,
      page_count: Math.max(toNumber(plan.pageCount), pages.length),
      prompt_count: toNumber(plan.promptCount),
      categories: plan.categories || share.top_categories || env.categories || snippet.categories || "",
      providers: plan.providers || share.top_providers || env.providers || snippet.providers || "",
      lost_queries: promptTargets,
      co_mention_queries: splitList(plan.coMentionQueries || share.co_mention_queries || env.co_mention_queries).slice(0, 6).join("; "),
      page_targets: pageTargets,
      products,
      family_context: familyContext,
      on_site_action: plan.onSiteAction || plan.on_site_action || "",
      off_site_ask: plan.offSiteAsk || plan.off_site_ask || briefs[0]?.outreachAngle || "",
      counter_positioning: counterPositioning(brand, plan.counterPositioning || plan.counter_positioning || share.counter_positioning || env.counter_angle),
      comparison_command: plan.comparisonCommand || plan.comparison_command || "",
      success_metric: plan.successMetric || plan.success_metric || "Reduce competitor-only rows and create co-mention/top-3 iBOLT wins in the next comparable benchmark.",
    };
  }).sort((a, b) => b.pressure_score - a.pressure_score || a.brand.localeCompare(b.brand));
}

function buildProviderRows(shareProviderRows, environmentProviderRows) {
  const rows = [];
  for (const row of shareProviderRows || []) {
    rows.push({
      provider: row.provider,
      category: row.category,
      answers: toNumber(row.answers),
      ibolt_mentions: toNumber(row.ibolt_mentions),
      mention_rate: `${toNumber(row.mention_rate_pct)}%`,
      competitor_only_rows: toNumber(row.competitor_only_rows),
      competitor_only_rate: `${toNumber(row.competitor_only_rate_pct)}%`,
      citation_rate: `${toNumber(row.citation_rate_pct)}%`,
      top_competitors: row.top_competitors,
      action: "Use provider/category-specific page blocks and retest this exact pocket.",
      pressure_score: toNumber(row.competitor_only_rows) * 8 + (100 - toNumber(row.mention_rate_pct)),
    });
  }
  for (const row of environmentProviderRows || []) {
    if (rows.some((existing) => existing.provider === row.provider && existing.category === row.category)) continue;
    rows.push({
      provider: row.provider,
      category: row.category,
      answers: toNumber(row.answers),
      ibolt_mentions: toNumber(row.clean_ibolt) + toNumber(row.ibolt_co_mentioned) + toNumber(row.ibolt_leads_with_competitors) + toNumber(row.ibolt_trailing),
      mention_rate: row.mention_rate,
      competitor_only_rows: toNumber(row.competitor_replacements),
      competitor_only_rate: row.replacement_rate,
      citation_rate: "0%",
      top_competitors: row.top_competitors,
      action: row.action,
      pressure_score: toNumber(row.pressure_score),
    });
  }
  return rows.sort((a, b) => b.pressure_score - a.pressure_score || a.provider.localeCompare(b.provider));
}

function buildPageRows(sharePageRows, portfolioPageRows, competitorRows) {
  const topCompetitors = new Set(competitorRows.slice(0, 8).map((row) => row.brand));
  const byUrl = new Map();
  for (const row of portfolioPageRows || []) {
    byUrl.set(String(row.url || "").toLowerCase(), row);
  }
  return (sharePageRows || [])
    .filter((row) => normalizeBrands(row.competitor_set || row.primary_competitor).some((brand) => topCompetitors.has(brand)))
    .map((row) => {
      const portfolio = byUrl.get(String(row.url || "").toLowerCase()) || {};
      const brands = normalizeBrands(row.competitor_set || row.primary_competitor);
      return {
        priority: toNumber(row.edit_order) + toNumber(portfolio.spread_score),
        page: row.title,
        url: row.url,
        category: row.category,
        primary_competitor: normalizeBrand(row.primary_competitor) || brands[0] || "",
        competitor_set: brands.join("; "),
        counter_positioning: row.counter_positioning,
        products_to_feature: row.products_to_feature || portfolio.products_to_feature || "",
        retest_wave: row.retest_wave,
        retest_prompts: row.retest_prompts || portfolio.linked_prompts || "",
        portfolio_lane: portfolio.lane || "",
        next_action: portfolio.next_action || "Add fair competitor comparison, exact iBOLT product modules, and retest mapped prompts.",
      };
    })
    .sort((a, b) => b.priority - a.priority || a.page.localeCompare(b.page))
    .slice(0, 80);
}

function barSvg({ title, subtitle, rows, labelKey, valueKey, width = 940, rowHeight = 34, color = "#0f766e" }) {
  const chartRows = rows.slice(0, 12);
  const height = 82 + chartRows.length * rowHeight;
  const max = Math.max(1, ...chartRows.map((row) => toNumber(row[valueKey])));
  const body = chartRows.map((row, index) => {
    const y = 64 + index * rowHeight;
    const value = toNumber(row[valueKey]);
    const barWidth = Math.round((value / max) * (width - 370));
    return `<g>
      <text x="24" y="${y + 17}" font-size="13" font-weight="800" fill="#111827">${escapeHtml(short(row[labelKey], 38))}</text>
      <rect x="312" y="${y}" width="${width - 370}" height="21" rx="10" fill="#e5e7eb"/>
      <rect x="312" y="${y}" width="${barWidth}" height="21" rx="10" fill="${row.color || color}"/>
      <text x="${width - 32}" y="${y + 16}" text-anchor="end" font-size="13" font-weight="900" fill="#111827">${escapeHtml(value)}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#fff"/>
    <text x="24" y="32" font-size="21" font-weight="900" fill="#111827">${escapeHtml(title)}</text>
    <text x="24" y="53" font-size="13" fill="#64748b">${escapeHtml(subtitle)}</text>
    ${body}
  </svg>`;
}

function table(headers, rows, limit = 20) {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header.label)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.slice(0, limit).map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header.key])}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table>${head}${body}</table>`;
}

function card(label, value, note) {
  return `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`;
}

function renderHtml({ summary, competitorRows, providerRows, pageRows }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT Competitor Comparison Dossier</title>
  <style>
    body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1220px;margin:0 auto;padding:34px 24px 70px}
    h1{font-size:36px;margin:0 0 8px}
    h2{font-size:22px;margin:34px 0 12px}
    p,li{line-height:1.55;color:#334155;font-size:15px}
    .note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #0f766e;border-radius:12px;padding:16px 18px;margin:20px 0}
    .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:12px;margin:22px 0}
    .card{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:15px}
    .label{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:900}
    .value{font-size:28px;font-weight:900;margin:8px 0;color:#0f172a}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
    .chart{background:#fff;border:1px solid #dbe3ef;border-radius:18px;padding:10px;overflow:auto}
    .chart svg{width:100%;height:auto;display:block}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 24px}
    th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    a{color:#0f766e;overflow-wrap:anywhere}
    @media(max-width:900px){.cards,.grid{grid-template-columns:1fr}h1{font-size:30px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT Competitor Comparison Dossier</h1>
  <p>This report converts competitor mentions into battlecards: who is replacing iBOLT, where they win, how iBOLT should be positioned, which pages to edit, and what outside citation work should support the shift.</p>
  <div class="note"><strong>Readout:</strong> ${escapeHtml(summary.top_competitor)} is the main displacement threat with ${summary.top_competitor_lost_answers} brand-level replacement occurrences. Across the benchmark there were ${summary.unique_replacement_answer_rows} unique answer rows where competitors appeared without iBOLT. The strongest near-term move is not to say iBOLT is cheaper. It is to make iBOLT the exact-workflow specialist in the same consideration sets.</div>
  <section class="cards">
    ${card("Competitors tracked", summary.competitors, "Brands or adjacent entities found in answer rows.")}
    ${card("Tier 1 competitors", summary.tier1_competitors, "Primary displacement brands requiring battlecards.")}
    ${card("Unique replacement rows", summary.unique_replacement_answer_rows, "Answer rows where competitors appear without iBOLT.")}
    ${card("Brand replacement occurrences", summary.brand_replacement_occurrences, "Brand-level replacement counts. One answer can mention multiple competitors.")}
    ${card("Co-mentions", summary.co_mentions, "Answers where iBOLT appears beside competitors.")}
    ${card("Page targets", summary.page_targets, "Mapped page opportunities across competitor rows.")}
  </section>
  <section class="grid">
    <div class="chart"><img src="competitor-pressure.svg" alt="Competitor pressure"/></div>
    <div class="chart"><img src="provider-pressure.svg" alt="Provider category pressure"/></div>
  </section>
  <h2>Competitor Battlecards</h2>
  ${table([
    { label: "Brand", key: "brand" },
    { label: "Stage", key: "recovery_stage" },
    { label: "Role", key: "role" },
    { label: "Lost", key: "lost_answers" },
    { label: "Co-mentions", key: "co_mentions" },
    { label: "Categories", key: "categories" },
    { label: "Counter-positioning", key: "counter_positioning" },
  ], competitorRows, 14)}
  <h2>Page Targets By Competitor</h2>
  ${table([
    { label: "Priority", key: "priority" },
    { label: "Page", key: "page" },
    { label: "Category", key: "category" },
    { label: "Primary competitor", key: "primary_competitor" },
    { label: "Competitor set", key: "competitor_set" },
    { label: "Portfolio lane", key: "portfolio_lane" },
    { label: "Next action", key: "next_action" },
  ], pageRows, 24)}
  <h2>Provider And Category Pressure</h2>
  ${table([
    { label: "Provider", key: "provider" },
    { label: "Category", key: "category" },
    { label: "Answers", key: "answers" },
    { label: "Mention rate", key: "mention_rate" },
    { label: "Competitor-only", key: "competitor_only_rate" },
    { label: "Top competitors", key: "top_competitors" },
    { label: "Action", key: "action" },
  ], providerRows, 18)}
  <h2>Files</h2>
  <ul>
    <li><a href="competitor-comparison-data.json">competitor-comparison-data.json</a></li>
    <li><a href="competitor-battlecards.csv">competitor-battlecards.csv</a></li>
    <li><a href="competitor-page-targets.csv">competitor-page-targets.csv</a></li>
    <li><a href="provider-category-competitor-pressure.csv">provider-category-competitor-pressure.csv</a></li>
  </ul>
</main>
</body>
</html>`;
}

function renderMarkdown({ summary, competitorRows, providerRows, pageRows }) {
  return `# iBOLT Competitor Comparison Dossier

## Summary

- Competitors tracked: ${summary.competitors}
- Tier 1 competitors: ${summary.tier1_competitors}
- Unique competitor-replacement answer rows: ${summary.unique_replacement_answer_rows}
- Brand replacement occurrences: ${summary.brand_replacement_occurrences}
- Co-mentions: ${summary.co_mentions}
- Top competitor: ${summary.top_competitor}
- Top competitor brand replacement occurrences: ${summary.top_competitor_lost_answers}
- Page targets: ${summary.page_targets}
- Prompt targets: ${summary.prompt_targets}

## Competitor Battlecards

${competitorRows.slice(0, 12).map((row) => `- ${row.brand}: ${row.lost_answers} lost rows, ${row.co_mentions} co-mentions. Counter: ${row.counter_positioning}`).join("\n")}

## Provider/Category Pressure

${providerRows.slice(0, 12).map((row) => `- ${row.provider} / ${row.category}: ${row.competitor_only_rate} competitor-only, ${row.mention_rate} iBOLT mention. Top competitors: ${row.top_competitors || "none"}.`).join("\n")}

## First Page Targets

${pageRows.slice(0, 12).map((row) => `- ${row.page}: ${row.primary_competitor}. ${row.next_action}`).join("\n")}
`;
}

async function main() {
  const benchmarkDir = process.argv[2] ? path.resolve(process.argv[2]) : await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, REPORT_DIR);
  await mkdir(outDir, { recursive: true });

  const counterplan = await readJsonIfExists(path.join(benchmarkDir, "competitor-page-counterplan", "competitor-page-counterplan-data.json"), { summary: {}, counterplans: [] });
  const share = await readJsonIfExists(path.join(benchmarkDir, "competitive-share-of-answer", "competitive-share-data.json"), { summary: {}, shareRows: [], providerRows: [], pageRows: [] });
  const environment = await readJsonIfExists(path.join(benchmarkDir, "mention-environment-dossier", "mention-environment-data.json"), { summary: {}, competitorRows: [], providerCategoryRows: [] });
  const snippets = await readJsonIfExists(path.join(benchmarkDir, "answer-snippet-evidence-appendix", "answer-snippet-evidence-data.json"), { summary: {}, competitorRows: [] });
  const contractor = await readJsonIfExists(path.join(benchmarkDir, "contractor-citation-packet", "contractor-citation-data.json"), { summary: {}, briefs: [] });
  const portfolio = await readJsonIfExists(path.join(benchmarkDir, "portfolio-product-spread-analysis", "portfolio-product-spread-data.json"), { summary: {}, pageRows: [], familyRows: [] });

  const competitorRows = buildCompetitorRows({
    counterplans: counterplan.counterplans || [],
    shareRows: share.shareRows || [],
    environmentRows: environment.competitorRows || [],
    snippetCompetitors: snippets.competitorRows || [],
    contractorBriefs: contractor.briefs || [],
    pageRows: share.pageRows || [],
    familyRows: portfolio.familyRows || [],
  });
  const providerRows = buildProviderRows(share.providerRows || [], environment.providerCategoryRows || []);
  const pageRows = buildPageRows(share.pageRows || [], portfolio.pageRows || [], competitorRows);

  const uniqueReplacementAnswerRows = Math.max(
    toNumber(environment.summary?.replacements),
    toNumber(snippets.summary?.competitorReplacements),
    toNumber(share.summary?.competitorOnly),
    toNumber(share.competitorOnly),
  );
  const brandReplacementOccurrences = competitorRows.reduce((sum, row) => sum + row.lost_answers, 0);
  const citationRate = Math.max(
    toNumber(share.summary?.citationRate),
    toNumber(share.citationRate),
    toNumber(snippets.summary?.citationRate),
    toNumber(environment.summary?.citation_rate),
  );

  const summary = {
    generated_at: new Date().toISOString(),
    benchmark_dir: benchmarkDir,
    competitors: competitorRows.length,
    tier1_competitors: competitorRows.filter((row) => /Tier 1|primary|displacement/i.test(row.tier)).length,
    unique_replacement_answer_rows: uniqueReplacementAnswerRows,
    brand_replacement_occurrences: brandReplacementOccurrences,
    replacement_answers: brandReplacementOccurrences,
    co_mentions: competitorRows.reduce((sum, row) => sum + row.co_mentions, 0),
    top_competitor: competitorRows[0]?.brand || counterplan.summary?.topBrand || "",
    top_competitor_lost_answers: competitorRows[0]?.lost_answers || counterplan.summary?.topBrandLostAnswers || 0,
    top_provider_category: providerRows[0] ? `${providerRows[0].provider} / ${providerRows[0].category}` : "",
    page_targets: pageRows.length,
    prompt_targets: competitorRows.reduce((sum, row) => sum + Math.max(1, splitList(row.lost_queries).length), 0),
    citation_rate: citationRate,
    recommendation: "Use competitor battlecards on priority pages first, then ask the SEO contractor for neutral third-party mentions after source cleanup.",
  };

  await writeFile(path.join(outDir, "competitor-comparison-data.json"), JSON.stringify({ summary, competitorRows, providerRows, pageRows }, null, 2));
  await writeFile(path.join(outDir, "competitor-battlecards.csv"), csv([
    ["brand", "tier", "role", "recovery_stage", "pressure_score", "answer_mentions", "answer_share_pct", "lost_answers", "co_mentions", "co_mention_rate", "replacement_to_comention_ratio", "page_count", "prompt_count", "categories", "providers", "lost_queries", "co_mention_queries", "page_targets", "products", "family_context", "counter_positioning", "comparison_command", "on_site_action", "off_site_ask", "success_metric"],
    ...competitorRows.map((row) => [row.brand, row.tier, row.role, row.recovery_stage, row.pressure_score, row.answer_mentions, row.answer_share_pct, row.lost_answers, row.co_mentions, row.co_mention_rate, row.replacement_to_comention_ratio, row.page_count, row.prompt_count, row.categories, row.providers, row.lost_queries, row.co_mention_queries, row.page_targets, row.products, row.family_context, row.counter_positioning, row.comparison_command, row.on_site_action, row.off_site_ask, row.success_metric]),
  ]));
  await writeFile(path.join(outDir, "competitor-page-targets.csv"), csv([
    ["priority", "page", "url", "category", "primary_competitor", "competitor_set", "counter_positioning", "products_to_feature", "retest_wave", "retest_prompts", "portfolio_lane", "next_action"],
    ...pageRows.map((row) => [row.priority, row.page, row.url, row.category, row.primary_competitor, row.competitor_set, row.counter_positioning, row.products_to_feature, row.retest_wave, row.retest_prompts, row.portfolio_lane, row.next_action]),
  ]));
  await writeFile(path.join(outDir, "provider-category-competitor-pressure.csv"), csv([
    ["provider", "category", "answers", "ibolt_mentions", "mention_rate", "competitor_only_rows", "competitor_only_rate", "citation_rate", "top_competitors", "action", "pressure_score"],
    ...providerRows.map((row) => [row.provider, row.category, row.answers, row.ibolt_mentions, row.mention_rate, row.competitor_only_rows, row.competitor_only_rate, row.citation_rate, row.top_competitors, row.action, row.pressure_score]),
  ]));
  await writeFile(path.join(outDir, "competitor-pressure.svg"), barSvg({
    title: "Competitor Displacement Pressure",
    subtitle: "Higher pressure means more replacement answers and mapped page work.",
    rows: competitorRows,
    labelKey: "brand",
    valueKey: "pressure_score",
  }));
  await writeFile(path.join(outDir, "provider-pressure.svg"), barSvg({
    title: "Provider And Category Competitor Pressure",
    subtitle: "Where each provider/category pocket replaces iBOLT most often.",
    rows: providerRows,
    labelKey: "category",
    valueKey: "pressure_score",
    color: "#2563eb",
  }));
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml({ summary, competitorRows, providerRows, pageRows }));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown({ summary, competitorRows, providerRows, pageRows }));

  console.log(`Wrote ${outDir}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
