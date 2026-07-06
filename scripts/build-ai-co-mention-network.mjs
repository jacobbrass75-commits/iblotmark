import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";

const PROVIDER_LABELS = {
  chatgpt: "ChatGPT",
  gemini_plain: "Gemini",
  claude: "Claude",
};

const BRAND_ALIASES = new Map([
  ["ram", "RAM Mounts"],
  ["ram mounts", "RAM Mounts"],
  ["mount-it!", "Mount-It"],
  ["mount-it", "Mount-It"],
  ["iottie", "iOttie"],
  ["proclip", "ProClip"],
  ["cta digital", "CTA Digital"],
  ["quad lock", "Quad Lock"],
  ["peak design", "Peak Design"],
  ["yakattack", "YakAttack"],
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

function pct(count, total) {
  return total ? Math.round((Number(count || 0) / Number(total || 1)) * 100) : 0;
}

function avg(values) {
  const clean = values.map(num).filter((value) => Number.isFinite(value));
  return clean.length ? Math.round(clean.reduce((sum, value) => sum + value, 0) / clean.length) : 0;
}

function normalizeBrand(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  const lower = text.toLowerCase();
  if (/^ibolt(?: mounts)?$/i.test(text)) return "";
  return BRAND_ALIASES.get(lower) || text;
}

function splitList(value) {
  return String(value ?? "")
    .split(/;|,/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/^\+\d+\s+more$/i.test(item));
}

function splitCompetitors(value) {
  return [...new Set(splitList(value).map(normalizeBrand).filter(Boolean))];
}

function addToCounter(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function counterItems(map, count = 6) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, count)
    .map(([name, value]) => `${name} ${value}`);
}

function counterNames(map, count = 6) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, count)
    .map(([name]) => name);
}

function toResult(row) {
  const brandMentioned = row.brand_mentioned === "true";
  const competitors = splitCompetitors(row.competitors);
  const topPickRank = num(row.top_pick_rank) || null;
  return {
    provider: row.provider,
    providerLabel: PROVIDER_LABELS[row.provider] || row.provider,
    query: row.query,
    category: row.category || "unknown",
    priority: num(row.priority),
    model: row.model,
    coverageScore: num(row.coverage_score),
    brandMentioned,
    domainCited: row.domain_cited === "true",
    topPickRank,
    topThree: Boolean(topPickRank && topPickRank <= 3),
    sentiment: row.sentiment || "",
    competitors,
    analysisNotes: row.analysis_notes || "",
  };
}

function answerState(row) {
  if (row.brandMentioned && row.competitors.length) return "iBOLT co-mentioned";
  if (row.brandMentioned) return "iBOLT clean mention";
  if (row.competitors.length) return "competitor-only";
  return "no brand signal";
}

function pairKey(row) {
  return `${row.category}::${row.query}`;
}

function counterPositioning(brand) {
  if (brand === "RAM Mounts") return "Keep iBOLT in RAM consideration sets, but frame iBOLT as the exact-workflow specialist with AMPS/ball compatibility and 300+ modular parts.";
  if (brand === "Arkon") return "Show where iBOLT is stronger for commercial durability, locked installs, restaurant stations, and fleet repeatability.";
  if (brand === "iOttie" || brand === "Scosche" || brand === "Belkin") return "Separate consumer car accessories from commercial delivery and shared-vehicle mounting.";
  if (brand === "ProClip") return "Compare vehicle-specific brackets against iBOLT's modular cross-vehicle fleet deployment.";
  if (brand === "CTA Digital" || brand === "Mount-It" || brand === "Bouncepad") return "Frame iBOLT around multi-tablet restaurant operations, delivery app stations, locking holders, and modular POS setups.";
  if (brand === "Garmin" || brand === "Humminbird" || brand === "Lowrance") return "Clarify that these are device brands, while iBOLT solves mounting, plate, arm, rail, and vibration needs around those devices.";
  if (brand === "Scotty" || brand === "YakAttack") return "Place iBOLT beside marine/kayak accessories for AMPS plates, modular arms, and stronger phone/tablet/fish-finder mounting.";
  if (brand === "Havis" || brand === "Zebra") return "Tie iBOLT into warehouse/forklift device mounting rather than competing with scanning or rugged-device brands directly.";
  return "Add a fair comparison block that names where iBOLT should be considered against this brand.";
}

function buildCompetitorRows(results) {
  const map = new Map();
  const ensure = (brand) => {
    if (!map.has(brand)) {
      map.set(brand, {
        brand,
        totalAnswers: 0,
        withIbolt: 0,
        withoutIbolt: 0,
        topThreeWithIbolt: 0,
        categories: new Map(),
        providers: new Map(),
        lostQueries: new Map(),
        coMentionQueries: new Map(),
        cleanReplacementQueries: new Map(),
        coMentionScores: [],
        replacementScores: [],
      });
    }
    return map.get(brand);
  };

  for (const row of results) {
    for (const brand of row.competitors) {
      const entry = ensure(brand);
      entry.totalAnswers += 1;
      addToCounter(entry.categories, row.category);
      addToCounter(entry.providers, row.providerLabel);
      if (row.brandMentioned) {
        entry.withIbolt += 1;
        if (row.topThree) entry.topThreeWithIbolt += 1;
        addToCounter(entry.coMentionQueries, row.query);
        entry.coMentionScores.push(row.coverageScore);
      } else {
        entry.withoutIbolt += 1;
        addToCounter(entry.lostQueries, row.query);
        addToCounter(entry.cleanReplacementQueries, `${row.category}: ${row.query}`);
        entry.replacementScores.push(row.coverageScore);
      }
    }
  }

  return [...map.values()]
    .map((entry) => ({
      brand: entry.brand,
      totalAnswers: entry.totalAnswers,
      withIbolt: entry.withIbolt,
      withoutIbolt: entry.withoutIbolt,
      coMentionRate: pct(entry.withIbolt, entry.totalAnswers),
      replacementPressure: entry.withoutIbolt,
      topThreeWithIbolt: entry.topThreeWithIbolt,
      avgCoMentionScore: avg(entry.coMentionScores),
      avgReplacementScore: avg(entry.replacementScores),
      categories: counterItems(entry.categories, 8),
      providers: counterItems(entry.providers, 4),
      lostQueries: counterNames(entry.lostQueries, 8),
      coMentionQueries: counterNames(entry.coMentionQueries, 8),
      counterPositioning: counterPositioning(entry.brand),
    }))
    .sort((a, b) => b.withoutIbolt - a.withoutIbolt || b.totalAnswers - a.totalAnswers || a.brand.localeCompare(b.brand));
}

function buildProviderCategoryRows(results) {
  const groups = new Map();
  for (const row of results) {
    const key = `${row.providerLabel}::${row.category}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key, rows]) => {
    const [provider, category] = key.split("::");
    const competitors = new Map();
    const coMentionBrands = new Map();
    const replacementBrands = new Map();
    for (const row of rows) {
      for (const brand of row.competitors) {
        addToCounter(competitors, brand);
        if (row.brandMentioned) addToCounter(coMentionBrands, brand);
        else addToCounter(replacementBrands, brand);
      }
    }
    const mentions = rows.filter((row) => row.brandMentioned).length;
    const coMentions = rows.filter((row) => row.brandMentioned && row.competitors.length).length;
    const cleanMentions = rows.filter((row) => row.brandMentioned && !row.competitors.length).length;
    const competitorOnly = rows.filter((row) => !row.brandMentioned && row.competitors.length).length;
    return {
      provider,
      category,
      answers: rows.length,
      mentions,
      mentionRate: pct(mentions, rows.length),
      cleanMentions,
      coMentions,
      coMentionRate: pct(coMentions, rows.length),
      competitorOnly,
      competitorOnlyRate: pct(competitorOnly, rows.length),
      avgScore: avg(rows.map((row) => row.coverageScore)),
      coMentionBrands: counterItems(coMentionBrands, 6),
      replacementBrands: counterItems(replacementBrands, 6),
      allCompetitors: counterItems(competitors, 6),
    };
  }).sort((a, b) => b.competitorOnlyRate - a.competitorOnlyRate || a.provider.localeCompare(b.provider) || a.category.localeCompare(b.category));
}

function buildQueryRows(results) {
  const groups = new Map();
  for (const row of results) {
    const key = pairKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  return [...groups.entries()].map(([key, rows]) => {
    const [category, query] = key.split("::");
    const competitors = new Map();
    const providers = new Map();
    const states = new Map();
    const coMentionBrands = new Map();
    const replacementBrands = new Map();
    for (const row of rows) {
      addToCounter(providers, row.providerLabel);
      addToCounter(states, answerState(row));
      for (const brand of row.competitors) {
        addToCounter(competitors, brand);
        if (row.brandMentioned) addToCounter(coMentionBrands, brand);
        else addToCounter(replacementBrands, brand);
      }
    }
    const mentions = rows.filter((row) => row.brandMentioned).length;
    const competitorOnly = rows.filter((row) => !row.brandMentioned && row.competitors.length).length;
    const coMentions = rows.filter((row) => row.brandMentioned && row.competitors.length).length;
    let outcome = "No brand signal";
    if (mentions === rows.length && coMentions === 0) outcome = "Clean iBOLT win";
    else if (mentions === rows.length) outcome = "iBOLT included with competitors";
    else if (mentions > 0 && competitorOnly > 0) outcome = "Mixed provider split";
    else if (competitorOnly > 0) outcome = "Competitor replacement";
    return {
      query,
      category,
      answers: rows.length,
      outcome,
      mentionRate: pct(mentions, rows.length),
      coMentionRows: coMentions,
      competitorOnlyRows: competitorOnly,
      avgScore: avg(rows.map((row) => row.coverageScore)),
      providers: counterItems(providers, 4),
      states: counterItems(states, 4),
      coMentionBrands: counterItems(coMentionBrands, 6),
      replacementBrands: counterItems(replacementBrands, 8),
      competitors: counterItems(competitors, 8),
    };
  }).sort((a, b) => {
    const pressureA = a.competitorOnlyRows * 30 + (100 - a.mentionRate);
    const pressureB = b.competitorOnlyRows * 30 + (100 - b.mentionRate);
    return pressureB - pressureA || a.query.localeCompare(b.query);
  });
}

function buildMentionRows(mentionRows, qualityRows) {
  const qualityByKey = new Map(qualityRows.map((row) => [`${row.provider}::${row.query}`, row]));
  return mentionRows.map((row) => {
    const quality = qualityByKey.get(`${row.provider}::${row.query}`) || {};
    const competitors = splitCompetitors(row.co_mentioned_competitors || quality.co_mentioned_competitors);
    return {
      provider: row.provider,
      query: row.query,
      category: row.category,
      coverageScore: num(row.coverage_score),
      mentionQualityScore: num(quality.mention_quality_score),
      topPickRank: row.top_pick_rank || quality.top_pick_rank || "",
      coMentionedCompetitors: competitors,
      productSignals: splitList(row.product_signals),
      catalogProducts: splitList(row.catalog_products || quality.catalog_matches),
      positioningSignals: splitList(row.positioning_signals || quality.positioning_tags),
      snippet: String(row.snippet || quality.snippet || "").slice(0, 420),
    };
  }).sort((a, b) => b.mentionQualityScore - a.mentionQualityScore || b.coverageScore - a.coverageScore);
}

function buildSummary(results, competitorRows, queryRows, master) {
  const mentions = results.filter((row) => row.brandMentioned);
  const coMentions = results.filter((row) => row.brandMentioned && row.competitors.length);
  const cleanMentions = results.filter((row) => row.brandMentioned && !row.competitors.length);
  const competitorOnly = results.filter((row) => !row.brandMentioned && row.competitors.length);
  const noSignal = results.filter((row) => !row.brandMentioned && !row.competitors.length);
  const nonBrandedResults = results.filter((row) => !/^ibolt|^iBolt/i.test(row.query));
  const nonBrandedMentions = nonBrandedResults.filter((row) => row.brandMentioned);
  const replacementQueries = queryRows.filter((row) => row.outcome === "Competitor replacement").length;
  const mixedQueries = queryRows.filter((row) => row.outcome === "Mixed provider split").length;
  const cleanWinQueries = queryRows.filter((row) => row.outcome === "Clean iBOLT win").length;
  const includedWithCompetitorsQueries = queryRows.filter((row) => row.outcome === "iBOLT included with competitors").length;

  return {
    totalAnswers: results.length,
    mentionRows: mentions.length,
    mentionRate: pct(mentions.length, results.length),
    nonBrandedRows: nonBrandedResults.length,
    nonBrandedMentions: nonBrandedMentions.length,
    nonBrandedMentionRate: pct(nonBrandedMentions.length, nonBrandedResults.length),
    cleanMentionRows: cleanMentions.length,
    coMentionRows: coMentions.length,
    coMentionShareOfMentions: pct(coMentions.length, mentions.length),
    competitorOnlyRows: competitorOnly.length,
    competitorOnlyRate: pct(competitorOnly.length, results.length),
    rawDetectorCompetitorOnlyRows: master.mentionSummary?.competitorOnlyAnswers || competitorOnly.length,
    structuredCompetitorOnlyRows: master.mentionSummary?.structuredCompetitorOnlyAnswers || competitorOnly.length,
    noSignalRows: noSignal.length,
    queryRows: queryRows.length,
    cleanWinQueries,
    includedWithCompetitorsQueries,
    mixedQueries,
    replacementQueries,
    competitorRows: competitorRows.length,
    topCoMentionCompetitors: competitorRows
      .filter((row) => row.withIbolt > 0)
      .sort((a, b) => b.withIbolt - a.withIbolt || b.totalAnswers - a.totalAnswers)
      .slice(0, 8)
      .map((row) => `${row.brand}: ${row.withIbolt}`),
    topReplacementCompetitors: competitorRows
      .slice(0, 8)
      .map((row) => `${row.brand}: ${row.withoutIbolt}`),
    sourceMentionSummary: master.mentionSummary || {},
  };
}

function barSvg({ rows, labelKey, valueKey, title, width = 980, height = 430 }) {
  const margin = { top: 54, right: 28, bottom: 106, left: 56 };
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
    const label = String(row[labelKey] ?? "").slice(0, 24);
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

function networkSvg(competitorRows, width = 980, height = 620) {
  const rows = competitorRows.slice(0, 14);
  const cx = 190;
  const cy = height / 2;
  const radius = 70;
  const maxReplacement = Math.max(1, ...rows.map((row) => row.withoutIbolt));
  const maxCo = Math.max(1, ...rows.map((row) => row.withIbolt));
  const nodes = rows.map((row, index) => {
    const angle = (-85 + index * (170 / Math.max(rows.length - 1, 1))) * (Math.PI / 180);
    const x = 590 + Math.cos(angle) * 260;
    const y = cy + Math.sin(angle) * 235;
    const nodeR = 18 + Math.round((row.withoutIbolt / maxReplacement) * 22);
    const stroke = row.withIbolt > 0 ? "#16a34a" : "#f97316";
    const coWidth = 1 + Math.round((row.withIbolt / maxCo) * 8);
    const missWidth = 1 + Math.round((row.withoutIbolt / maxReplacement) * 8);
    return `<line x1="${cx + radius}" y1="${cy}" x2="${x - nodeR}" y2="${y}" stroke="#f97316" stroke-width="${missWidth}" opacity=".33"/>
<line x1="${cx + radius}" y1="${cy + 10}" x2="${x - nodeR}" y2="${y + 8}" stroke="#16a34a" stroke-width="${coWidth}" opacity=".55"/>
<circle cx="${x}" cy="${y}" r="${nodeR}" fill="#fff" stroke="${stroke}" stroke-width="4"/>
<text x="${x}" y="${y - 2}" text-anchor="middle" font-size="12" font-weight="800" fill="#111827">${escapeHtml(row.brand.slice(0, 14))}</text>
<text x="${x}" y="${y + 13}" text-anchor="middle" font-size="11" fill="#475569">miss ${row.withoutIbolt}, co ${row.withIbolt}</text>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="iBOLT co-mention network">
<rect width="${width}" height="${height}" fill="#f8fafc"/>
<text x="40" y="36" font-size="22" font-weight="800" fill="#111827">iBOLT Co-Mention And Replacement Network</text>
<text x="40" y="60" font-size="13" fill="#475569">Orange links are competitor-only replacement pressure. Green links are co-mentions with iBOLT.</text>
<circle cx="${cx}" cy="${cy}" r="${radius}" fill="#0f172a"/>
<text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="22" font-weight="900" fill="#fff">iBOLT</text>
<text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="12" fill="#cbd5e1">target brand</text>
${nodes}
</svg>`;
}

function buildMarkdown({ summary, competitorRows, providerCategoryRows, queryRows, mentionRows }) {
  return `# AI Co-Mention Network

This report shows who iBOLT is mentioned next to, who replaces iBOLT when it is absent, and where the strongest provider/category gaps are.

## Summary

- Total tested answers: ${summary.totalAnswers}
- iBOLT mentions: ${summary.mentionRows} (${summary.mentionRate}%)
- Clean iBOLT mentions: ${summary.cleanMentionRows}
- iBOLT co-mentions with competitors: ${summary.coMentionRows} (${summary.coMentionShareOfMentions}% of iBOLT mentions)
- Competitor-only replacements: ${summary.competitorOnlyRows} strict structured rows (${summary.competitorOnlyRate}%), ${summary.rawDetectorCompetitorOnlyRows} raw detector rows
- No-brand-signal answers: ${summary.noSignalRows}
- Query outcomes: ${summary.cleanWinQueries} clean iBOLT wins, ${summary.includedWithCompetitorsQueries} iBOLT-included comparison sets, ${summary.mixedQueries} mixed provider splits, ${summary.replacementQueries} competitor replacement queries
- Top co-mentioned competitors: ${summary.topCoMentionCompetitors.join(", ")}
- Top replacement competitors: ${summary.topReplacementCompetitors.join(", ")}

## Competitor Network

| Brand | Total | With iBOLT | Without iBOLT | Co-mention rate | Categories | Providers | Counter-positioning |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- |
${competitorRows.slice(0, 18).map((row) => `| ${row.brand} | ${row.totalAnswers} | ${row.withIbolt} | ${row.withoutIbolt} | ${row.coMentionRate}% | ${row.categories.join("; ")} | ${row.providers.join("; ")} | ${row.counterPositioning} |`).join("\n")}

## Provider And Category Pattern

| Provider | Category | Mentions | Co-mentions | Competitor-only | Top co-mentions | Top replacements |
| --- | --- | ---: | ---: | ---: | --- | --- |
${providerCategoryRows.slice(0, 24).map((row) => `| ${row.provider} | ${row.category} | ${row.mentions}/${row.answers} (${row.mentionRate}%) | ${row.coMentions} | ${row.competitorOnly} (${row.competitorOnlyRate}%) | ${row.coMentionBrands.join("; ")} | ${row.replacementBrands.join("; ")} |`).join("\n")}

## Query Outcomes

| Query | Category | Outcome | Mention rate | Competitor-only | Co-mentioned brands | Replacement brands |
| --- | --- | --- | ---: | ---: | --- | --- |
${queryRows.slice(0, 28).map((row) => `| ${row.query} | ${row.category} | ${row.outcome} | ${row.mentionRate}% | ${row.competitorOnlyRows} | ${row.coMentionBrands.join("; ")} | ${row.replacementBrands.join("; ")} |`).join("\n")}

## Strong iBOLT Mentions

| Provider | Query | Category | Quality | Rank | Co-mentioned competitors | Product signals |
| --- | --- | --- | ---: | --- | --- | --- |
${mentionRows.slice(0, 14).map((row) => `| ${row.provider} | ${row.query} | ${row.category} | ${row.mentionQualityScore || row.coverageScore} | ${row.topPickRank || ""} | ${row.coMentionedCompetitors.join("; ")} | ${row.productSignals.join("; ")} |`).join("\n")}

## How To Use This

The priority is not to avoid competitor names. The priority is to force iBOLT into the same consideration set on broad buyer prompts, then make the page explain when iBOLT is the specialist choice. Co-mentions are useful when they turn into top-3 recommendations and citations. Competitor-only answers are the displacement targets.
`;
}

function buildHtml({ summary, competitorRows, providerCategoryRows, queryRows, mentionRows }) {
  const cards = [
    ["iBOLT mentions", `${summary.mentionRows}/${summary.totalAnswers}`, `${summary.mentionRate}%`],
    ["Clean mentions", summary.cleanMentionRows, "iBOLT without competitors"],
    ["Co-mentions", summary.coMentionRows, `${summary.coMentionShareOfMentions}% of mentions`],
    ["Competitor-only", summary.competitorOnlyRows, `${summary.rawDetectorCompetitorOnlyRows} raw detector rows`],
    ["Replacement queries", summary.replacementQueries, "all providers missed iBOLT"],
    ["Top replacement", summary.topReplacementCompetitors[0] || "n/a", "highest pressure"],
  ].map(([label, value, note]) => `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");
  const competitorTable = competitorRows.slice(0, 18).map((row) => `<tr><td>${escapeHtml(row.brand)}</td><td>${row.totalAnswers}</td><td>${row.withIbolt}</td><td>${row.withoutIbolt}</td><td>${row.coMentionRate}%</td><td>${escapeHtml(row.categories.join("; "))}</td><td>${escapeHtml(row.providers.join("; "))}</td><td>${escapeHtml(row.counterPositioning)}</td></tr>`).join("");
  const providerTable = providerCategoryRows.slice(0, 28).map((row) => `<tr><td>${escapeHtml(row.provider)}</td><td>${escapeHtml(row.category)}</td><td>${row.mentions}/${row.answers} (${row.mentionRate}%)</td><td>${row.coMentions}</td><td>${row.competitorOnly} (${row.competitorOnlyRate}%)</td><td>${escapeHtml(row.coMentionBrands.join("; "))}</td><td>${escapeHtml(row.replacementBrands.join("; "))}</td></tr>`).join("");
  const queryTable = queryRows.slice(0, 34).map((row) => `<tr><td>${escapeHtml(row.query)}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.outcome)}</td><td>${row.mentionRate}%</td><td>${row.competitorOnlyRows}</td><td>${escapeHtml(row.coMentionBrands.join("; "))}</td><td>${escapeHtml(row.replacementBrands.join("; "))}</td></tr>`).join("");
  const mentionTable = mentionRows.slice(0, 16).map((row) => `<tr><td>${escapeHtml(row.provider)}</td><td>${escapeHtml(row.query)}</td><td>${escapeHtml(row.category)}</td><td>${row.mentionQualityScore || row.coverageScore}</td><td>${escapeHtml(row.topPickRank)}</td><td>${escapeHtml(row.coMentionedCompetitors.join("; "))}</td><td>${escapeHtml(row.productSignals.join("; "))}</td></tr>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>iBOLT AI Co-Mention Network</title>
<style>
body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}main{max-width:1260px;margin:0 auto;padding:34px 26px 60px}h1{font-size:34px;margin:0 0 8px}h2{font-size:22px;margin:34px 0 14px}p{color:#334155;line-height:1.55}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}.k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700}.v{font-size:30px;font-weight:800;margin-top:8px}.chart{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:12px;margin:18px 0}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden}th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}.note{border-left:6px solid #0f172a;background:#fff;border-radius:10px;padding:16px 18px;border-top:1px solid #d7dee8;border-right:1px solid #d7dee8;border-bottom:1px solid #d7dee8}
</style></head><body><main>
<h1>iBOLT AI Co-Mention Network</h1>
<p class="note"><strong>Readout:</strong> Co-mentions are not automatically bad. They show where AI already sees iBOLT in the category. Competitor-only answers show where iBOLT is being replaced and where page edits or third-party references should focus.</p>
<section class="cards">${cards}</section>
<div class="chart"><img src="co-mention-network.svg" alt="iBOLT co-mention network" style="width:100%;height:auto"/></div>
<div class="chart"><img src="replacement-pressure.svg" alt="Replacement pressure chart" style="width:100%;height:auto"/></div>
<div class="chart"><img src="co-mention-counts.svg" alt="Co-mention chart" style="width:100%;height:auto"/></div>
<h2>Competitor Network</h2>
<table><thead><tr><th>Brand</th><th>Total</th><th>With iBOLT</th><th>Without iBOLT</th><th>Co-mention rate</th><th>Categories</th><th>Providers</th><th>Counter-positioning</th></tr></thead><tbody>${competitorTable}</tbody></table>
<h2>Provider And Category Pattern</h2>
<table><thead><tr><th>Provider</th><th>Category</th><th>Mentions</th><th>Co-mentions</th><th>Competitor-only</th><th>Top co-mentions</th><th>Top replacements</th></tr></thead><tbody>${providerTable}</tbody></table>
<h2>Query Outcomes</h2>
<table><thead><tr><th>Query</th><th>Category</th><th>Outcome</th><th>Mention rate</th><th>Competitor-only</th><th>Co-mentioned brands</th><th>Replacement brands</th></tr></thead><tbody>${queryTable}</tbody></table>
<h2>Strong iBOLT Mentions</h2>
<table><thead><tr><th>Provider</th><th>Query</th><th>Category</th><th>Quality</th><th>Rank</th><th>Co-mentioned competitors</th><th>Product signals</th></tr></thead><tbody>${mentionTable}</tbody></table>
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, "co-mention-network");
  await mkdir(outDir, { recursive: true });

  const rawResults = await readCsv(path.join(benchmarkDir, "results.csv"));
  const mentionContextRows = await readCsv(path.join(benchmarkDir, "answer-context-dossier", "ibolt-mention-context.csv"));
  const mentionQualityRows = await readCsv(path.join(benchmarkDir, "mention-quality-audit", "mention-quality-rows.csv"));
  const master = await readJsonIfExists(path.join(benchmarkDir, "master-dossier", "master-dossier-data.json"), {});
  const results = rawResults.filter((row) => row.status === "completed").map(toResult);
  const competitorRows = buildCompetitorRows(results);
  const providerCategoryRows = buildProviderCategoryRows(results);
  const queryRows = buildQueryRows(results);
  const mentionRows = buildMentionRows(mentionContextRows, mentionQualityRows);
  const summary = buildSummary(results, competitorRows, queryRows, master);

  await writeFile(path.join(outDir, "co-mention-network-data.json"), JSON.stringify({ summary, competitorRows, providerCategoryRows, queryRows, mentionRows }, null, 2));
  await writeFile(path.join(outDir, "competitor-network.csv"), csv([
    ["brand", "total_answers", "with_ibolt", "without_ibolt", "co_mention_rate", "replacement_pressure", "top_three_with_ibolt", "avg_co_mention_score", "avg_replacement_score", "categories", "providers", "lost_queries", "co_mention_queries", "counter_positioning"],
    ...competitorRows.map((row) => [
      row.brand,
      row.totalAnswers,
      row.withIbolt,
      row.withoutIbolt,
      row.coMentionRate,
      row.replacementPressure,
      row.topThreeWithIbolt,
      row.avgCoMentionScore,
      row.avgReplacementScore,
      row.categories,
      row.providers,
      row.lostQueries,
      row.coMentionQueries,
      row.counterPositioning,
    ]),
  ]));
  await writeFile(path.join(outDir, "provider-category-network.csv"), csv([
    ["provider", "category", "answers", "mentions", "mention_rate", "clean_mentions", "co_mentions", "co_mention_rate", "competitor_only", "competitor_only_rate", "avg_score", "co_mention_brands", "replacement_brands", "all_competitors"],
    ...providerCategoryRows.map((row) => [
      row.provider,
      row.category,
      row.answers,
      row.mentions,
      row.mentionRate,
      row.cleanMentions,
      row.coMentions,
      row.coMentionRate,
      row.competitorOnly,
      row.competitorOnlyRate,
      row.avgScore,
      row.coMentionBrands,
      row.replacementBrands,
      row.allCompetitors,
    ]),
  ]));
  await writeFile(path.join(outDir, "query-co-mention-ledger.csv"), csv([
    ["query", "category", "answers", "outcome", "mention_rate", "co_mention_rows", "competitor_only_rows", "avg_score", "providers", "states", "co_mention_brands", "replacement_brands", "competitors"],
    ...queryRows.map((row) => [
      row.query,
      row.category,
      row.answers,
      row.outcome,
      row.mentionRate,
      row.coMentionRows,
      row.competitorOnlyRows,
      row.avgScore,
      row.providers,
      row.states,
      row.coMentionBrands,
      row.replacementBrands,
      row.competitors,
    ]),
  ]));
  await writeFile(path.join(outDir, "ibolt-mention-strength.csv"), csv([
    ["provider", "query", "category", "coverage_score", "mention_quality_score", "top_pick_rank", "co_mentioned_competitors", "product_signals", "catalog_products", "positioning_signals", "snippet"],
    ...mentionRows.map((row) => [
      row.provider,
      row.query,
      row.category,
      row.coverageScore,
      row.mentionQualityScore,
      row.topPickRank,
      row.coMentionedCompetitors,
      row.productSignals,
      row.catalogProducts,
      row.positioningSignals,
      row.snippet,
    ]),
  ]));
  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown({ summary, competitorRows, providerCategoryRows, queryRows, mentionRows }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({ summary, competitorRows, providerCategoryRows, queryRows, mentionRows }));
  await writeFile(path.join(outDir, "co-mention-network.svg"), networkSvg(competitorRows));
  await writeFile(path.join(outDir, "replacement-pressure.svg"), barSvg({
    rows: competitorRows.slice(0, 12),
    labelKey: "brand",
    valueKey: "withoutIbolt",
    title: "Competitor-Only Replacement Pressure",
  }));
  await writeFile(path.join(outDir, "co-mention-counts.svg"), barSvg({
    rows: competitorRows.filter((row) => row.withIbolt > 0).sort((a, b) => b.withIbolt - a.withIbolt).slice(0, 12),
    labelKey: "brand",
    valueKey: "withIbolt",
    title: "Competitors Mentioned Alongside iBOLT",
  }));

  console.log(`Wrote ${outDir}`);
  console.log(`Mentions ${summary.mentionRows}/${summary.totalAnswers}; co-mentions ${summary.coMentionRows}; competitor-only ${summary.competitorOnlyRows}`);
  console.log(`Top replacements: ${summary.topReplacementCompetitors.join("; ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
