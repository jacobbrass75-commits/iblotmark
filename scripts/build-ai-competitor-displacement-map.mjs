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
  if (!name) throw new Error(`No ${prefix} directory found in ${OUTPUT_ROOT}`);
  return path.join(process.cwd(), OUTPUT_ROOT, name);
}

function num(value) {
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(count, total) {
  return total ? Math.round((Number(count || 0) / Number(total || 1)) * 100) : 0;
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/^\+\d+\s+more$/i.test(item));
}

function normalizeBrand(value) {
  const text = String(value ?? "").trim();
  if (/^ram$/i.test(text)) return "RAM Mounts";
  if (/^ram mounts$/i.test(text)) return "RAM Mounts";
  if (/^ibolt$/i.test(text)) return "iBOLT";
  return text;
}

function firstList(value, count = 6) {
  return splitList(value).slice(0, count).join("; ");
}

function asMap(rows, key, normalizer = (value) => value) {
  const map = new Map();
  for (const row of rows) {
    const value = normalizer(row[key]);
    if (value) map.set(value, row);
  }
  return map;
}

function addToCounter(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function competitorRole(brand) {
  const name = normalizeBrand(brand);
  if (name === "RAM Mounts") return "Broad rugged/default mount authority";
  if (name === "Arkon") return "Commercial vehicle and general tablet/phone default";
  if (name === "iOttie") return "Consumer/delivery phone mount default";
  if (name === "ProClip") return "Vehicle-specific fleet mount default";
  if (name === "CTA Digital") return "Restaurant/tablet security default";
  if (name === "Mount-It") return "Restaurant and light-commercial tablet stand default";
  if (name === "Bouncepad") return "Premium kiosk/tablet security default";
  if (name === "Humminbird") return "Fish finder device brand default";
  if (name === "Garmin") return "Marine electronics and fish finder default";
  if (name === "Lowrance") return "Marine electronics and fish finder default";
  if (name === "Scotty" || name === "YakAttack") return "Kayak and boat accessory default";
  if (name === "Havis" || name === "Zebra") return "Warehouse/forklift hardware default";
  return "Category default or neighboring answer brand";
}

function counterPositioning(brand) {
  const name = normalizeBrand(brand);
  if (name === "RAM Mounts") return "Frame iBOLT as the application specialist for fleet, restaurant, warehouse, delivery, and AMPS-based systems, with 300+ modular parts and faster path from problem to exact kit.";
  if (name === "Arkon") return "Compare against Arkon on commercial stability, locking options, AMPS compatibility, and purpose-built restaurant/fleet kits.";
  if (name === "iOttie") return "Separate consumer windshield/dashboard mounts from commercial delivery mounts with locking, drill-base, wedge, console, and fleet-friendly product choices.";
  if (name === "ProClip") return "Position iBOLT as more modular and cross-vehicle for fleets that need repeatable deployment instead of vehicle-specific brackets only.";
  if (name === "CTA Digital") return "Show iBOLT as a restaurant/POS specialist with Tablet Tower, Dock'n Lock, LockPro, and multi-tablet delivery-station options.";
  if (name === "Mount-It") return "Contrast light commercial tablet stands with iBOLT's locking, modular, and multi-tablet restaurant setups.";
  if (name === "Bouncepad") return "Compare premium single-device kiosk enclosures against iBOLT's multi-tablet and modular POS mounting system.";
  if (name === "Humminbird" || name === "Garmin" || name === "Lowrance") return "Clarify that fish finder brands sell devices while iBOLT solves the mounting, plate, arm, rail, and vibration problem around those devices.";
  if (name === "Scotty" || name === "YakAttack") return "Position iBOLT as a stronger modular fish-finder/phone/tablet mounting option where AMPS plates, arms, and device holders matter.";
  if (name === "Havis" || name === "Zebra") return "Show iBOLT's forklift tablet and barcode scanner mount fit around existing warehouse devices rather than competing with the devices themselves.";
  return "Create a fair comparison block that puts iBOLT in the same answer set and names the exact iBOLT use case where it should win.";
}

function onSiteAction(brand) {
  const name = normalizeBrand(brand);
  if (name === "RAM Mounts") return "Add RAM comparison modules to high-pressure fleet, restaurant, warehouse, delivery, AMPS, and fishing pages.";
  if (name === "Arkon") return "Add Arkon comparison blocks to fleet, delivery, restaurant tablet, and heavy-duty vehicle mount pages.";
  if (name === "iOttie") return "Add consumer vs commercial delivery-phone-mount sections on delivery and shared-vehicle pages.";
  if (name === "ProClip") return "Add vehicle-specific vs fleet-standardized mounting comparison to ELD, construction vehicle, and delivery van pages.";
  if (name === "CTA Digital" || name === "Mount-It" || name === "Bouncepad") return "Strengthen restaurant tablet/POS pages with security, multi-tablet, and delivery-station comparison sections.";
  if (name === "Humminbird" || name === "Garmin" || name === "Lowrance" || name === "Scotty" || name === "YakAttack") return "Build fish-finder mount pages around device-brand compatibility, AMPS plates, kayak/boat rails, and rough-water stability.";
  if (name === "Havis" || name === "Zebra") return "Strengthen forklift/barcode-scanner pages with warehouse device compatibility and scanner-holder use cases.";
  return "Add a competitor-specific comparison block to mapped pages where this brand appears without iBOLT.";
}

function offSiteAsk(brand) {
  const name = normalizeBrand(brand);
  if (name === "RAM Mounts") return "Pitch iBOLT for rugged-mount buyer guides and AMPS/fleet comparison mentions where RAM is already cited.";
  if (name === "Arkon" || name === "ProClip" || name === "iOttie") return "Secure delivery-driver, fleet, work-truck, and commercial phone-mount mentions that include iBOLT next to this brand.";
  if (name === "CTA Digital" || name === "Mount-It" || name === "Bouncepad") return "Target restaurant tech, POS hardware, food-truck, and kiosk/tablet-stand buyer guides.";
  if (name === "Humminbird" || name === "Garmin" || name === "Lowrance" || name === "Scotty" || name === "YakAttack") return "Target boating, kayak fishing, fish-finder setup, and marine accessory guides that can cite iBOLT as the mounting solution.";
  if (name === "Havis" || name === "Zebra") return "Target warehouse operations, forklift safety, barcode scanning, and rugged tablet deployment references.";
  return "Get third-party category mentions where this competitor already appears.";
}

function buildCompetitorRows({ evidence, battlecards, competitorPageRows, sourceRows, providerDefaults, contextRows }) {
  const battleByBrand = asMap(battlecards, "brand", normalizeBrand);
  const pageByBrand = asMap(competitorPageRows, "brand", normalizeBrand);
  const sourceByBrand = asMap(sourceRows, "brand", normalizeBrand);
  const contextByBrand = asMap(contextRows, "brand", normalizeBrand);
  const providerMisses = new Map();
  const providerNames = new Map();

  for (const row of providerDefaults) {
    const brand = normalizeBrand(row.competitor);
    const misses = providerMisses.get(brand) || new Set();
    for (const query of splitList(row.example_queries)) {
      misses.add(`${row.provider_key || row.provider}:${query}`);
    }
    if (!splitList(row.example_queries).length) {
      misses.add(`${row.provider_key || row.provider}:${row.missed_answer_count}:${row.categories}`);
    }
    providerMisses.set(brand, misses);
    const providers = providerNames.get(brand) || new Set();
    providers.add(row.provider);
    providerNames.set(brand, providers);
  }

  const rawCounts = new Map((evidence.competitorCounts || []).map((row) => [normalizeBrand(row.name), num(row.count)]));
  const brands = [...new Set([
    ...rawCounts.keys(),
    ...battleByBrand.keys(),
    ...pageByBrand.keys(),
    ...sourceByBrand.keys(),
    ...providerMisses.keys(),
  ])].filter((brand) => brand && brand !== "iBOLT");

  return brands.map((brand) => {
    const battle = battleByBrand.get(brand) || {};
    const page = pageByBrand.get(brand) || {};
    const source = sourceByBrand.get(brand) || {};
    const context = contextByBrand.get(brand) || {};
    const rawAnswerCount = rawCounts.get(brand) || num(battle.answer_count);
    const lostAnswers = num(source.lost_answers || context.lost_answers || battle.without_ibolt);
    const providerMissCount = providerMisses.get(brand)?.size || 0;
    const queryCount = num(page.query_count);
    const pageCount = num(page.page_count);
    const pressure =
      rawAnswerCount * 3 +
      lostAnswers * 4 +
      providerMissCount * 2 +
      queryCount * 18 +
      pageCount * 12 +
      num(source.priority) * 3;
    return {
      priority: Math.round(pressure),
      brand,
      role: competitorRole(brand),
      raw_answer_count: rawAnswerCount,
      lost_answers: lostAnswers,
      co_mentioned_wins: num(source.co_mentioned_wins || battle.with_ibolt),
      co_mention_rate: num(battle.co_mention_rate),
      provider_missed_answers: providerMissCount,
      provider_defaults: [...(providerNames.get(brand) || [])].sort().join("; "),
      query_count: queryCount,
      page_count: pageCount,
      categories: source.categories || battle.categories || page.categories || context.categories,
      language_patterns: source.language_patterns || context.language_patterns,
      example_queries: firstList(source.example_queries || page.top_queries || battle.lost_prompts || context.example_queries, 8),
      mapped_pages: firstList(page.mapped_pages || battle.pages_to_refresh, 8),
      counter_positioning: battle.counter_positioning || counterPositioning(brand),
      on_site_action: onSiteAction(brand),
      off_site_ask: source.offsite_target || offSiteAsk(brand),
      success_metric: source.success_metric || `Reduce ${brand} competitor-only rows and add iBOLT co-mentions in the next comparable benchmark.`,
    };
  }).sort((a, b) => b.priority - a.priority || a.brand.localeCompare(b.brand));
}

function buildQueryActions(queryRows) {
  return queryRows.map((row) => {
    const competitors = firstList(row.competitors, 8);
    const prompt = row.query || row.prompt;
    const duplicateRisk = row.duplicate_risk || "";
    let action = row.next_action || row.recommended_action || "";
    if (String(duplicateRisk).toLowerCase() === "yes") {
      action = `Resolve duplicate/canonical risk first, then ${action.charAt(0).toLowerCase()}${action.slice(1)}`;
    }
    return {
      priority: num(row.priority || row.opportunity_score),
      stage: row.stage || row.recommended_action || "benchmark opportunity",
      query: prompt,
      category: row.category,
      avg_score: num(row.avg_score || row.ai_score),
      mention_rate: num(row.mention_rate),
      top_three_rate: num(row.top_three_rate),
      competitor_only_answers: num(row.competitor_only_answers),
      competitors,
      page_title: row.page_title || row.closest_post,
      page_url: row.page_url,
      page_score: num(row.page_score),
      duplicate_risk: duplicateRisk,
      structural_issues: row.structural_issues || row.triage_issues || row.missing_structure,
      products_to_add: row.products_to_add || row.product_module || "",
      weakest_providers: row.weakest_providers || "",
      win_condition: `iBOLT appears in at least two providers, earns one top-3 recommendation, and ${competitors ? `is named beside ${competitors.split("; ").slice(0, 2).join(" and ")}` : "is included in the main answer set"}.`,
      recommended_action: action,
    };
  }).sort((a, b) => b.priority - a.priority || b.competitor_only_answers - a.competitor_only_answers);
}

function buildTopicRows(queryActions) {
  const map = new Map();
  for (const row of queryActions) {
    const key = row.category || "uncategorized";
    const current = map.get(key) || {
      topic: key,
      query_count: 0,
      priority: 0,
      competitor_only_answers: 0,
      zero_mention_queries: 0,
      competitors: new Map(),
      top_queries: [],
    };
    current.query_count += 1;
    current.priority += num(row.priority);
    current.competitor_only_answers += num(row.competitor_only_answers);
    if (num(row.mention_rate) === 0) current.zero_mention_queries += 1;
    for (const brand of splitList(row.competitors).map(normalizeBrand)) addToCounter(current.competitors, brand, 1);
    if (current.top_queries.length < 5) current.top_queries.push(row.query);
    map.set(key, current);
  }
  return [...map.values()].map((row) => ({
    topic: row.topic,
    query_count: row.query_count,
    priority: Math.round(row.priority),
    competitor_only_answers: row.competitor_only_answers,
    zero_mention_queries: row.zero_mention_queries,
    top_competitors: [...row.competitors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([brand, count]) => `${brand} ${count}`).join("; "),
    top_queries: row.top_queries.join("; "),
  })).sort((a, b) => b.priority - a.priority || a.topic.localeCompare(b.topic));
}

function barSvg(rows, { title, labelKey, valueKey, width = 900, height = 390, color = "#1d4ed8" }) {
  const chartRows = rows.slice(0, 12);
  const max = Math.max(1, ...chartRows.map((row) => num(row[valueKey])));
  const left = 200;
  const right = 48;
  const top = 58;
  const rowHeight = 24;
  const gap = 9;
  const innerWidth = width - left - right;
  const svgHeight = Math.max(height, top + chartRows.length * (rowHeight + gap) + 32);
  const bars = chartRows.map((row, index) => {
    const y = top + index * (rowHeight + gap);
    const barWidth = Math.round((num(row[valueKey]) / max) * innerWidth);
    return `<text x="16" y="${y + 17}" font-size="13" fill="#334155">${escapeHtml(row[labelKey])}</text>
<rect x="${left}" y="${y}" width="${barWidth}" height="${rowHeight}" fill="${color}" rx="4"/>
<text x="${left + barWidth + 8}" y="${y + 17}" font-size="13" fill="#111827" font-weight="700">${escapeHtml(row[valueKey])}</text>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${svgHeight}" viewBox="0 0 ${width} ${svgHeight}" role="img" aria-label="${escapeHtml(title)}">
<rect width="100%" height="100%" fill="#ffffff"/>
<text x="16" y="31" font-size="20" font-weight="800" fill="#0f172a">${escapeHtml(title)}</text>
${bars}
</svg>`;
}

function buildSummary({ evidence, competitorRows, queryActions, topicRows }) {
  const stats = evidence.stats || {};
  return {
    generatedAt: new Date().toISOString(),
    totalAnswers: stats.total || 0,
    mentionCount: stats.mentionCount || 0,
    mentionRate: stats.mentionRate || 0,
    nonBrandedMentionRate: stats.nonBrandedMentionRate || 0,
    citationRate: stats.citationRate || 0,
    competitorOnlyRows: stats.competitorOnlyRows || 0,
    coMentionRows: stats.coMentionRows || 0,
    competitorRows: competitorRows.length,
    queryActionRows: queryActions.length,
    zeroMentionQueries: queryActions.filter((row) => row.mention_rate === 0).length,
    topicRows: topicRows.length,
    topCompetitors: competitorRows.slice(0, 8).map((row) => row.brand),
    topTopics: topicRows.slice(0, 6).map((row) => row.topic),
  };
}

function buildMarkdown({ summary, competitorRows, queryActions, topicRows }) {
  return `# iBOLT Competitor Displacement Map

## Visibility Position

iBOLT is visible, but competitors still define most generic answer sets. The saved baseline has ${summary.mentionRate}% mention rate, ${summary.nonBrandedMentionRate}% non-branded mention rate, ${summary.citationRate}% citation rate, and ${summary.competitorOnlyRows} competitor-only rows.

The highest-pressure brands are ${summary.topCompetitors.join(", ")}. These are not all direct substitutes. Some are device brands, some are mount brands, and some are category defaults that AI systems use when they do not have enough iBOLT-specific source signals.

## What To Do

1. Put iBOLT in the same answer set as the competitor on the mapped page.
2. Add fair comparison sections, not attack copy.
3. Add exact iBOLT product modules and compatibility language.
4. Create third-party mentions where the competitor is already cited.
5. Retest the exact prompt and provider after each page batch.

## Competitor Scorecard

| Priority | Brand | Role in AI answers | Raw answers | Lost answers | Provider misses | Query count | Main action |
| ---: | --- | --- | ---: | ---: | ---: | ---: | --- |
${competitorRows.slice(0, 16).map((row) => `| ${row.priority} | ${row.brand} | ${row.role} | ${row.raw_answer_count} | ${row.lost_answers} | ${row.provider_missed_answers} | ${row.query_count} | ${row.on_site_action} |`).join("\n")}

## Top Query Actions

| Priority | Query | Category | Mention rate | Competitor-only | Competitors | Page | Action |
| ---: | --- | --- | ---: | ---: | --- | --- | --- |
${queryActions.slice(0, 20).map((row) => `| ${row.priority} | ${row.query} | ${row.category} | ${row.mention_rate}% | ${row.competitor_only_answers} | ${row.competitors} | [${row.page_title}](${row.page_url}) | ${row.recommended_action} |`).join("\n")}

## Topic Pressure

| Topic | Priority | Queries | Zero-mention queries | Competitor-only answers | Top competitors |
| --- | ---: | ---: | ---: | ---: | --- |
${topicRows.map((row) => `| ${row.topic} | ${row.priority} | ${row.query_count} | ${row.zero_mention_queries} | ${row.competitor_only_answers} | ${row.top_competitors} |`).join("\n")}
`;
}

function buildHtml({ summary, competitorRows, queryActions, topicRows, competitorSvg, topicSvg, querySvg }) {
  const cards = [
    ["Mention rate", `${summary.mentionRate}%`, `${summary.mentionCount}/${summary.totalAnswers} answers`],
    ["Non-branded mention", `${summary.nonBrandedMentionRate}%`, "Main growth gap"],
    ["Citation rate", `${summary.citationRate}%`, "Source-authority gap"],
    ["Competitor-only", summary.competitorOnlyRows, "Answers without iBOLT"],
    ["Competitor rows", summary.competitorRows, "Brands to displace or co-mention"],
    ["Zero-mention queries", summary.zeroMentionQueries, "Prompt-level misses"],
    ["Query actions", summary.queryActionRows, "Retestable work items"],
    ["Top competitor", summary.topCompetitors[0] || "none", "Highest pressure brand"],
    ["Top topic", summary.topTopics[0] || "none", "Highest pressure category"],
  ].map(([label, value, note]) => `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");

  const competitorTable = competitorRows.slice(0, 24).map((row) => `<tr>
<td>${escapeHtml(row.priority)}</td><td>${escapeHtml(row.brand)}</td><td>${escapeHtml(row.role)}</td>
<td>${escapeHtml(row.raw_answer_count)}</td><td>${escapeHtml(row.lost_answers)}</td><td>${escapeHtml(row.provider_missed_answers)}</td><td>${escapeHtml(row.query_count)}</td>
<td>${escapeHtml(row.categories)}</td><td>${escapeHtml(row.on_site_action)}</td><td>${escapeHtml(row.off_site_ask)}</td>
</tr>`).join("");

  const queryTable = queryActions.slice(0, 30).map((row) => `<tr>
<td>${escapeHtml(row.priority)}</td><td>${escapeHtml(row.query)}</td><td>${escapeHtml(row.category)}</td>
<td>${escapeHtml(row.mention_rate)}%</td><td>${escapeHtml(row.competitor_only_answers)}</td><td>${escapeHtml(row.competitors)}</td>
<td><a href="${escapeHtml(row.page_url)}">${escapeHtml(row.page_title)}</a></td><td>${escapeHtml(row.structural_issues)}</td><td>${escapeHtml(row.win_condition)}</td>
</tr>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>iBOLT Competitor Displacement Map</title>
<style>
body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}main{max-width:1240px;margin:0 auto;padding:34px 26px 60px}h1{font-size:34px;margin:0 0 8px}h2{font-size:22px;margin:34px 0 14px}p{color:#334155;line-height:1.55}.lede{font-size:17px;max-width:980px}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}.k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700}.v{font-size:30px;font-weight:800;margin-top:8px}.chart{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:12px;margin:14px 0;overflow:auto}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden}th,td{text-align:left;vertical-align:top;padding:9px 10px;border-bottom:1px solid #edf2f7;font-size:13px}th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}.note{border-left:6px solid #7c3aed;background:#fff;border-radius:10px;padding:16px 18px;border-top:1px solid #d7dee8;border-right:1px solid #d7dee8;border-bottom:1px solid #d7dee8}a{color:#1d4ed8}
</style></head><body><main>
<h1>iBOLT Competitor Displacement Map</h1>
<p class="lede">This report shows which brands AI systems use instead of iBOLT, where they appear, and which page or off-site citation action should move iBOLT into the same recommendation set.</p>
<section class="cards">${cards}</section>
<p class="note"><strong>Interpretation:</strong> competitors are not all direct substitutes. Device brands like Garmin or Humminbird usually mean iBOLT needs compatibility and mounting-solution content, while mount brands like RAM or Arkon need direct comparison and third-party authority work.</p>
<h2>Competitor Pressure</h2><div class="chart">${competitorSvg}</div>
<h2>Topic Pressure</h2><div class="chart">${topicSvg}</div>
<h2>Highest Priority Queries</h2><div class="chart">${querySvg}</div>
<h2>Competitor Scorecard</h2>
<table><thead><tr><th>Priority</th><th>Brand</th><th>AI role</th><th>Raw answers</th><th>Lost</th><th>Provider misses</th><th>Queries</th><th>Categories</th><th>On-site action</th><th>Off-site ask</th></tr></thead><tbody>${competitorTable}</tbody></table>
<h2>Query-Level Work Queue</h2>
<table><thead><tr><th>Priority</th><th>Query</th><th>Category</th><th>Mention</th><th>Competitor-only</th><th>Competitors</th><th>Mapped page</th><th>Issues</th><th>Win condition</th></tr></thead><tbody>${queryTable}</tbody></table>
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, "competitor-displacement-map");
  await mkdir(outDir, { recursive: true });

  const evidence = await readJsonIfExists(path.join(benchmarkDir, "answer-evidence-pack", "answer-evidence-data.json"), { stats: {}, competitorCounts: [] });
  const battlecards = await readCsv(path.join(benchmarkDir, "competitive-matrix", "competitor-battlecards.csv"));
  const competitorPageRows = await readCsv(path.join(benchmarkDir, "query-page-matrix", "competitor-page-map.csv"));
  const sourceRows = await readCsv(path.join(benchmarkDir, "source-authority-roadmap", "competitor-source-opportunities.csv"));
  const providerDefaults = await readCsv(path.join(benchmarkDir, "provider-blindspots", "provider-competitor-defaults.csv"));
  const contextRows = await readCsv(path.join(benchmarkDir, "answer-context-dossier", "competitor-context-scorecard.csv"));
  const queryRows = await readCsv(path.join(benchmarkDir, "query-page-matrix", "all-query-page-matrix.csv"));

  const competitorRows = buildCompetitorRows({ evidence, battlecards, competitorPageRows, sourceRows, providerDefaults, contextRows });
  const queryActions = buildQueryActions(queryRows);
  const topicRows = buildTopicRows(queryActions);
  const summary = buildSummary({ evidence, competitorRows, queryActions, topicRows });

  const competitorSvg = barSvg(competitorRows, { title: "Competitor displacement priority", labelKey: "brand", valueKey: "priority", color: "#dc2626" });
  const topicSvg = barSvg(topicRows, { title: "Topic pressure by competitor-only answers and mapped queries", labelKey: "topic", valueKey: "priority", color: "#7c3aed" });
  const querySvg = barSvg(queryActions.slice(0, 12), { title: "Highest-priority queries to retest after edits", labelKey: "query", valueKey: "priority", color: "#0f766e", height: 460 });

  await writeFile(path.join(outDir, "competitor-pressure.svg"), competitorSvg);
  await writeFile(path.join(outDir, "topic-pressure.svg"), topicSvg);
  await writeFile(path.join(outDir, "query-priority.svg"), querySvg);
  await writeFile(path.join(outDir, "competitor-displacement-data.json"), JSON.stringify({ summary, competitorRows, queryActions, topicRows }, null, 2));
  await writeFile(path.join(outDir, "competitor-displacement-scorecard.csv"), csv([
    ["priority", "brand", "role", "raw_answer_count", "lost_answers", "co_mentioned_wins", "co_mention_rate", "provider_missed_answers", "provider_defaults", "query_count", "page_count", "categories", "language_patterns", "example_queries", "mapped_pages", "counter_positioning", "on_site_action", "off_site_ask", "success_metric"],
    ...competitorRows.map((row) => [row.priority, row.brand, row.role, row.raw_answer_count, row.lost_answers, row.co_mentioned_wins, row.co_mention_rate, row.provider_missed_answers, row.provider_defaults, row.query_count, row.page_count, row.categories, row.language_patterns, row.example_queries, row.mapped_pages, row.counter_positioning, row.on_site_action, row.off_site_ask, row.success_metric]),
  ]));
  await writeFile(path.join(outDir, "query-displacement-actions.csv"), csv([
    ["priority", "stage", "query", "category", "avg_score", "mention_rate", "top_three_rate", "competitor_only_answers", "competitors", "page_title", "page_url", "page_score", "duplicate_risk", "structural_issues", "products_to_add", "weakest_providers", "win_condition", "recommended_action"],
    ...queryActions.map((row) => [row.priority, row.stage, row.query, row.category, row.avg_score, row.mention_rate, row.top_three_rate, row.competitor_only_answers, row.competitors, row.page_title, row.page_url, row.page_score, row.duplicate_risk, row.structural_issues, row.products_to_add, row.weakest_providers, row.win_condition, row.recommended_action]),
  ]));
  await writeFile(path.join(outDir, "topic-displacement-summary.csv"), csv([
    ["topic", "priority", "query_count", "zero_mention_queries", "competitor_only_answers", "top_competitors", "top_queries"],
    ...topicRows.map((row) => [row.topic, row.priority, row.query_count, row.zero_mention_queries, row.competitor_only_answers, row.top_competitors, row.top_queries]),
  ]));
  await writeFile(path.join(outDir, "contractor-offsite-asks.csv"), csv([
    ["priority", "brand", "categories", "example_queries", "off_site_ask", "success_metric"],
    ...competitorRows.map((row) => [row.priority, row.brand, row.categories, row.example_queries, row.off_site_ask, row.success_metric]),
  ]));
  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown({ summary, competitorRows, queryActions, topicRows }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({ summary, competitorRows, queryActions, topicRows, competitorSvg, topicSvg, querySvg }));

  console.log(`Wrote ${outDir}`);
  console.log(`Competitor rows: ${competitorRows.length}`);
  console.log(`Top competitor: ${summary.topCompetitors[0] || "none"}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
