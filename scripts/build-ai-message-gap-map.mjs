import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";

const THEMES = [
  {
    key: "commercial/pro",
    label: "Commercial/pro use",
    pageCopy:
      "Add a short commercial-use block that names the work setting, the device being mounted, and why iBOLT is purpose-built for that workflow.",
    schemaFix:
      "Use FAQPage or HowTo schema where the page explains business setup, installation, or selection steps.",
    proofPoints:
      "commercial fleets, restaurants, warehouses, delivery vehicles, 300+ modular parts, business-ready mounting kits",
  },
  {
    key: "rugged/durable",
    label: "Rugged durability",
    pageCopy:
      "Add material, vibration, heat, moisture, or jobsite stress proof before the first product recommendation.",
    schemaFix:
      "Add Product or ItemList-style product modules with material, warranty, and mounting-method fields visible on page.",
    proofPoints: "heavy-gauge steel, aluminum, powder coating, vibration-resistant placement, 2-year warranty",
  },
  {
    key: "stability/grip",
    label: "Stability and grip",
    pageCopy:
      "Answer how the mount stays stable during stops, vibration, rough water, forklift movement, or shared-vehicle use.",
    schemaFix:
      "Add FAQ questions that directly answer stability, vibration, clamp, drill-base, suction, and magnetic hold concerns.",
    proofPoints: "drill bases, clamps, locking holders, AMPS plates, ball sizes, rough-road or rough-water setup guidance",
  },
  {
    key: "compatibility",
    label: "Compatibility",
    pageCopy:
      "Add compatibility tables for device size, mounting pattern, vehicle/equipment type, AMPS pattern, and ball size.",
    schemaFix:
      "Use exact product titles, product handles, image alt text, and visible compatibility fields.",
    proofPoints: "17mm, 20mm, 25mm/B size, 38mm/C size, 57mm, AMPS, VESA, RAM-compatible components",
  },
  {
    key: "secure/locking",
    label: "Security and locking",
    pageCopy:
      "Add theft, shared-vehicle, customer-facing, restaurant counter, or fleet-control language where locking matters.",
    schemaFix:
      "Add FAQ and product modules for LockPro, Dock'n Lock, keyed holders, and shared-station use cases.",
    proofPoints: "LockPro, Dock'n Lock, keyed holders, drill-base installs, restaurant counters, shared delivery vehicles",
  },
  {
    key: "easy install",
    label: "Install clarity",
    pageCopy:
      "Add a simple mounting-method selector that compares clamp, drill base, suction, magnetic, wall, and console installs.",
    schemaFix:
      "Use HowTo schema only on pages with real setup steps and keep steps visible in the page body.",
    proofPoints: "clamp, drill base, suction, magnetic, wall mount, console mount, no-drill options",
  },
  {
    key: "adjustable/flexible",
    label: "Adjustability",
    pageCopy:
      "Explain how modular arms, ball sizes, plates, and holders can be combined or changed as the operation changes.",
    schemaFix:
      "Add internal links to AMPS/modular guide and product modules that show the exact holder, arm, and base relationship.",
    proofPoints: "300+ modular parts, interchangeable holders, ball mounts, AMPS plates, Mount Configurator",
  },
  {
    key: "budget/value",
    label: "Value without budget positioning",
    pageCopy:
      "Answer value intent without calling iBOLT cheap. Focus on getting the right kit, reducing wrong-part purchases, reuse, warranty, and quick shipping.",
    schemaFix:
      "Use offer/product data where available, but keep the page copy framed around fit and lifetime usefulness.",
    proofPoints: "right-fit kits, reusable modular parts, ships within 24 business hours, 2-year warranty",
    doNotSay: "Do not call iBOLT budget, cheap, affordable alternative, or cheaper than RAM.",
  },
];

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

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/^\+\d+\s+more$/i.test(item));
}

function normalizeBrand(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (/^ram$/i.test(text) || /^ram mounts$/i.test(text)) return "RAM Mounts";
  if (/^ibolt$/i.test(text) || /^i bolt$/i.test(text)) return "iBOLT";
  return text;
}

function addToCounter(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function setCounterMax(map, key, amount = 1) {
  if (!key) return;
  map.set(key, Math.max(map.get(key) || 0, amount));
}

function counterRows(map, total, label = "item") {
  return [...map.entries()]
    .map(([name, count]) => ({ [label]: name, count, rate: pct(count, total) }))
    .sort((a, b) => b.count - a.count || String(a[label]).localeCompare(String(b[label])));
}

function parseThemeCounts(value) {
  const counts = new Map();
  for (const item of splitList(value)) {
    const match = item.match(/^(.*)\s+(\d+)$/);
    if (match) addToCounter(counts, match[1].trim(), num(match[2]));
    else addToCounter(counts, item, 1);
  }
  return counts;
}

function themesFromRows(rows, field, totalOverride) {
  const counter = new Map();
  for (const row of rows) {
    for (const theme of splitList(row[field])) addToCounter(counter, theme);
  }
  return counterRows(counter, totalOverride ?? rows.length, "theme");
}

function firstItems(counter, count = 5) {
  return [...counter.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, count)
    .map(([name, value]) => `${name} ${value}`);
}

function rowsForTheme(rows, theme, field = "language_patterns") {
  return rows.filter((row) => splitList(row[field]).includes(theme.key));
}

function topCountersForRows(rows) {
  const competitors = new Map();
  const categories = new Map();
  const providers = new Map();
  const queries = new Map();
  for (const row of rows) {
    for (const brand of splitList(row.competitors).map(normalizeBrand)) {
      if (brand && brand !== "iBOLT") addToCounter(competitors, brand);
    }
    addToCounter(categories, row.category);
    addToCounter(providers, row.provider);
    addToCounter(queries, row.query);
  }
  return {
    competitors: firstItems(competitors, 6),
    categories: firstItems(categories, 6),
    providers: firstItems(providers, 4),
    queries: firstItems(queries, 6),
  };
}

function buildThemeRows({ iboltRows, lostRows, competitorContextRows }) {
  const competitorContextThemeCounts = new Map();
  for (const row of competitorContextRows) {
    for (const [theme, count] of parseThemeCounts(row.language_patterns)) {
      addToCounter(competitorContextThemeCounts, theme, count);
    }
  }

  return THEMES.map((theme) => {
    const iboltThemeRows = rowsForTheme(iboltRows, theme);
    const lostThemeRows = rowsForTheme(lostRows, theme);
    const lostContext = topCountersForRows(lostThemeRows);
    const competitorContextCount = competitorContextThemeCounts.get(theme.key) || 0;
    const iboltRate = pct(iboltThemeRows.length, iboltRows.length);
    const lostRate = pct(lostThemeRows.length, lostRows.length);
    const gapPoints = Math.max(0, lostRate - iboltRate);
    return {
      theme: theme.key,
      label: theme.label,
      iboltRows: iboltThemeRows.length,
      iboltRate,
      lostRows: lostThemeRows.length,
      lostRate,
      competitorContextCount,
      gapPoints,
      topCompetitors: lostContext.competitors,
      topCategories: lostContext.categories,
      topProviders: lostContext.providers,
      sampleQueries: lostContext.queries,
      pageCopy: theme.pageCopy,
      schemaFix: theme.schemaFix,
      proofPoints: theme.proofPoints,
      doNotSay: theme.doNotSay || "",
    };
  }).sort((a, b) => b.gapPoints - a.gapPoints || b.lostRows - a.lostRows);
}

function buildCompetitorRows({ lostRows, competitorContextRows, competitorLanguageRows }) {
  const stats = new Map();
  const ensure = (brand) => {
    const normalized = normalizeBrand(brand);
    if (!normalized || normalized === "iBOLT") return null;
    if (!stats.has(normalized)) {
      stats.set(normalized, {
        brand: normalized,
        lostRows: 0,
        coMentionRows: 0,
        rawAppearances: 0,
        pressureScore: 0,
        categories: new Map(),
        providers: new Map(),
        queries: new Map(),
        themes: new Map(),
        sample: "",
        counterPositioning: "",
      });
    }
    return stats.get(normalized);
  };

  for (const row of lostRows) {
    const brands = splitList(row.competitors).map(normalizeBrand).filter(Boolean);
    for (const brand of brands) {
      const entry = ensure(brand);
      if (!entry) continue;
      entry.lostRows += 1;
      addToCounter(entry.categories, row.category);
      addToCounter(entry.providers, row.provider);
      addToCounter(entry.queries, row.query);
      for (const theme of splitList(row.language_patterns)) addToCounter(entry.themes, theme);
      if (!entry.sample) entry.sample = row.competitor_snippet || "";
    }
  }

  for (const row of competitorContextRows) {
    const entry = ensure(row.brand);
    if (!entry) continue;
    entry.pressureScore = Math.max(entry.pressureScore, num(row.pressure_score));
    entry.coMentionRows = Math.max(entry.coMentionRows, num(row.co_mentioned_wins));
    if (!entry.sample) entry.sample = row.example_snippets || "";
    for (const [theme, count] of parseThemeCounts(row.language_patterns)) {
      setCounterMax(entry.themes, theme, count);
    }
  }

  for (const row of competitorLanguageRows) {
    const entry = ensure(row.brand);
    if (!entry) continue;
    entry.rawAppearances = Math.max(entry.rawAppearances, num(row.raw_appearances));
    entry.counterPositioning = row.counter_positioning || entry.counterPositioning;
  }

  return [...stats.values()]
    .map((entry) => ({
      brand: entry.brand,
      pressureScore: entry.pressureScore || entry.lostRows + entry.rawAppearances,
      lostRows: entry.lostRows,
      rawAppearances: entry.rawAppearances,
      coMentionRows: entry.coMentionRows,
      categories: firstItems(entry.categories, 7),
      providers: firstItems(entry.providers, 4),
      queries: firstItems(entry.queries, 8),
      themes: firstItems(entry.themes, 8),
      counterPositioning: entry.counterPositioning,
      sample: String(entry.sample || "").slice(0, 360),
    }))
    .sort((a, b) => b.pressureScore - a.pressureScore || b.lostRows - a.lostRows);
}

function buildQueryRows(lostRows) {
  const map = new Map();
  for (const row of lostRows) {
    const key = `${row.category}::${row.query}`;
    if (!map.has(key)) {
      map.set(key, {
        query: row.query,
        category: row.category,
        lostProviders: new Set(),
        competitors: new Map(),
        themes: new Map(),
        recommendedAngles: new Set(),
        avgCoverage: [],
      });
    }
    const entry = map.get(key);
    entry.lostProviders.add(row.provider);
    for (const brand of splitList(row.competitors).map(normalizeBrand)) addToCounter(entry.competitors, brand);
    for (const theme of splitList(row.language_patterns)) addToCounter(entry.themes, theme);
    if (row.recommended_page_angle) entry.recommendedAngles.add(row.recommended_page_angle);
    entry.avgCoverage.push(num(row.coverage_score));
  }

  return [...map.values()]
    .map((entry) => ({
      query: entry.query,
      category: entry.category,
      lostProviderCount: entry.lostProviders.size,
      lostProviders: [...entry.lostProviders].sort(),
      avgCoverage: Math.round(entry.avgCoverage.reduce((sum, value) => sum + value, 0) / Math.max(entry.avgCoverage.length, 1)),
      competitors: firstItems(entry.competitors, 8),
      themes: firstItems(entry.themes, 8),
      recommendedAngles: [...entry.recommendedAngles].slice(0, 3),
    }))
    .sort((a, b) => b.lostProviderCount - a.lostProviderCount || a.avgCoverage - b.avgCoverage);
}

function buildIboltMentionRows(iboltRows, mentionQualityRows) {
  const qualityByKey = new Map(
    mentionQualityRows.map((row) => [`${row.provider}::${row.query}`, row])
  );
  return iboltRows
    .map((row) => {
      const quality = qualityByKey.get(`${row.provider}::${row.query}`) || {};
      return {
        provider: row.provider,
        query: row.query,
        category: row.category,
        coverageScore: num(row.coverage_score),
        mentionQualityScore: num(quality.mention_quality_score),
        topPickRank: row.top_pick_rank || "",
        sentiment: quality.sentiment || "",
        coMentionedCompetitors: splitList(row.co_mentioned_competitors).map(normalizeBrand),
        productSignals: splitList(row.product_signals),
        catalogProducts: splitList(row.catalog_products || quality.catalog_matches),
        positioningSignals: splitList(row.positioning_signals || quality.positioning_tags),
        languagePatterns: splitList(row.language_patterns),
        action: quality.action || "Keep specialist, product-specific framing and make the answer source-ready.",
        snippet: String(row.snippet || quality.snippet || "").slice(0, 360),
      };
    })
    .sort((a, b) => b.mentionQualityScore - a.mentionQualityScore || b.coverageScore - a.coverageScore);
}

function buildCopyActionRows(themeRows, competitorRows) {
  const topCompetitors = competitorRows.slice(0, 8).map((row) => row.brand);
  return themeRows.map((row, index) => ({
    priority: index + 1,
    theme: row.label,
    gapPoints: row.gapPoints,
    iBOLTCurrentRate: `${row.iboltRate}%`,
    lostAnswerRate: `${row.lostRate}%`,
    mainCompetitors: row.topCompetitors.length ? row.topCompetitors : topCompetitors.slice(0, 5),
    affectedCategories: row.topCategories,
    pageCopy: row.pageCopy,
    schemaFix: row.schemaFix,
    proofPoints: row.proofPoints,
    offSiteAsk:
      "Ask SEO contractor for third-party references that use this language around iBOLT in buyer guides, industry roundups, partner pages, and comparison articles.",
    doNotSay: row.doNotSay,
  }));
}

function simpleBarSvg({ rows, labelKey, valueKey, title, width = 980, height = 430 }) {
  const margin = { top: 54, right: 28, bottom: 96, left: 52 };
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
    const label = String(row[labelKey] ?? "").slice(0, 22);
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

function buildMarkdown({ summary, themeRows, competitorRows, queryRows, copyActionRows }) {
  const topThemes = themeRows.slice(0, 5).map((row) => `${row.label} (${row.gapPoints} pt gap)`).join(", ");
  return `# AI Message Gap Map

This report analyzes the language inside the saved AI benchmark: how iBOLT is described when it appears, how competitors are described when iBOLT is missing, and what language should be added to iBOLT pages.

## Summary

- iBOLT mention context rows: ${summary.iboltMentionRows}
- Lost answer rows where iBOLT was absent: ${summary.lostAnswerRows}
- Competitor/default brands analyzed: ${summary.competitorRows}
- Query language rows: ${summary.queryRows}
- Message gap themes: ${summary.themeRows}
- Copy/schema action rows: ${summary.copyActionRows}
- Biggest message gaps: ${topThemes}

## What This Means

AI systems already understand iBOLT best when the prompt names iBOLT or asks direct comparisons. On broad buyer prompts, competitors are usually framed with practical decision language: commercial use, ruggedness, stability, compatibility, locking/security, and install clarity. iBOLT pages need those same decision signals, but with iBOLT's specialist positioning and exact product entities.

Brand safety: do not copy budget/cheap positioning from competitor answers. Answer value intent through right-fit kits, reusable modular parts, warranty, shipping speed, and fewer wrong-part purchases.

## Theme Gap Ranking

| Theme | iBOLT rate | Lost-answer rate | Gap | Top competitors | Affected categories | Page copy action |
| --- | ---: | ---: | ---: | --- | --- | --- |
${themeRows.map((row) => `| ${row.label} | ${row.iboltRate}% | ${row.lostRate}% | ${row.gapPoints} | ${row.topCompetitors.join("; ")} | ${row.topCategories.join("; ")} | ${row.pageCopy} |`).join("\n")}

## Competitor Language Pressure

| Brand | Pressure | Lost rows | Co-mentions | Categories | Dominant language | Counter-positioning |
| --- | ---: | ---: | ---: | --- | --- | --- |
${competitorRows.slice(0, 15).map((row) => `| ${row.brand} | ${row.pressureScore} | ${row.lostRows} | ${row.coMentionRows} | ${row.categories.join("; ")} | ${row.themes.join("; ")} | ${row.counterPositioning} |`).join("\n")}

## Highest-Risk Query Language

| Query | Category | Providers missing iBOLT | Competitors | Dominant language | Recommended angle |
| --- | --- | ---: | --- | --- | --- |
${queryRows.slice(0, 18).map((row) => `| ${row.query} | ${row.category} | ${row.lostProviderCount} | ${row.competitors.join("; ")} | ${row.themes.join("; ")} | ${row.recommendedAngles.join(" ")} |`).join("\n")}

## Copy And Schema Actions

| Priority | Theme | Gap | Page copy | Schema/entity fix | Proof points |
| ---: | --- | ---: | --- | --- | --- |
${copyActionRows.map((row) => `| ${row.priority} | ${row.theme} | ${row.gapPoints} | ${row.pageCopy} | ${row.schemaFix} | ${row.proofPoints} |`).join("\n")}
`;
}

function buildHtml({ summary, themeRows, competitorRows, queryRows, copyActionRows }) {
  const cards = [
    ["iBOLT mention rows", summary.iboltMentionRows, "AI context when iBOLT appears"],
    ["Lost answer rows", summary.lostAnswerRows, "AI language when iBOLT is absent"],
    ["Competitors", summary.competitorRows, "Brands/defaults compared"],
    ["Top theme gap", themeRows[0]?.label || "n/a", `${themeRows[0]?.gapPoints || 0} point gap`],
    ["Query rows", summary.queryRows, "Prompt-level language map"],
    ["Copy actions", summary.copyActionRows, "Reusable edit instructions"],
  ].map(([label, value, note]) => `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");
  const themeTable = themeRows.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${row.iboltRate}%</td><td>${row.lostRate}%</td><td>${row.gapPoints}</td><td>${escapeHtml(row.topCompetitors.join("; "))}</td><td>${escapeHtml(row.topCategories.join("; "))}</td><td>${escapeHtml(row.pageCopy)}</td></tr>`).join("");
  const competitorTable = competitorRows.slice(0, 15).map((row) => `<tr><td>${escapeHtml(row.brand)}</td><td>${row.pressureScore}</td><td>${row.lostRows}</td><td>${row.coMentionRows}</td><td>${escapeHtml(row.categories.join("; "))}</td><td>${escapeHtml(row.themes.join("; "))}</td><td>${escapeHtml(row.counterPositioning)}</td></tr>`).join("");
  const queryTable = queryRows.slice(0, 20).map((row) => `<tr><td>${escapeHtml(row.query)}</td><td>${escapeHtml(row.category)}</td><td>${row.lostProviderCount}</td><td>${escapeHtml(row.competitors.join("; "))}</td><td>${escapeHtml(row.themes.join("; "))}</td><td>${escapeHtml(row.recommendedAngles.join(" "))}</td></tr>`).join("");
  const actionTable = copyActionRows.map((row) => `<tr><td>${row.priority}</td><td>${escapeHtml(row.theme)}</td><td>${row.gapPoints}</td><td>${escapeHtml(row.pageCopy)}</td><td>${escapeHtml(row.schemaFix)}</td><td>${escapeHtml(row.proofPoints)}</td><td>${escapeHtml(row.doNotSay)}</td></tr>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>iBOLT AI Message Gap Map</title>
<style>
body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}main{max-width:1220px;margin:0 auto;padding:34px 26px 60px}h1{font-size:34px;margin:0 0 8px}h2{font-size:22px;margin:34px 0 14px}p{color:#334155;line-height:1.55}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}.k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700}.v{font-size:30px;font-weight:800;margin-top:8px}.chart{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:12px;margin:18px 0}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden}th,td{text-align:left;vertical-align:top;padding:11px 12px;border-bottom:1px solid #edf2f7;font-size:14px}th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:12px;letter-spacing:.04em}.note{border-left:6px solid #0f172a;background:#fff;border-radius:10px;padding:16px 18px;border-top:1px solid #d7dee8;border-right:1px solid #d7dee8;border-bottom:1px solid #d7dee8}
</style></head><body><main>
<h1>iBOLT AI Message Gap Map</h1>
<p class="note"><strong>Readout:</strong> iBOLT wins when AI sees it as a specialist. Competitors win broad prompts when the answer has clearer commercial, ruggedness, compatibility, security, stability, and install language. The fix is not generic SEO copy. It is answer-first product and proof language that puts iBOLT in the same consideration set.</p>
<section class="cards">${cards}</section>
<div class="chart"><img src="theme-gap.svg" alt="Theme gap chart" style="width:100%;height:auto"/></div>
<div class="chart"><img src="competitor-message-pressure.svg" alt="Competitor message pressure chart" style="width:100%;height:auto"/></div>
<h2>Theme Gap Ranking</h2>
<table><thead><tr><th>Theme</th><th>iBOLT rate</th><th>Lost-answer rate</th><th>Gap</th><th>Top competitors</th><th>Affected categories</th><th>Page copy action</th></tr></thead><tbody>${themeTable}</tbody></table>
<h2>Competitor Language Pressure</h2>
<table><thead><tr><th>Brand</th><th>Pressure</th><th>Lost rows</th><th>Co-mentions</th><th>Categories</th><th>Dominant language</th><th>Counter-positioning</th></tr></thead><tbody>${competitorTable}</tbody></table>
<h2>Highest-Risk Query Language</h2>
<table><thead><tr><th>Query</th><th>Category</th><th>Missing providers</th><th>Competitors</th><th>Dominant language</th><th>Recommended angle</th></tr></thead><tbody>${queryTable}</tbody></table>
<h2>Copy And Schema Actions</h2>
<table><thead><tr><th>Priority</th><th>Theme</th><th>Gap</th><th>Page copy</th><th>Schema/entity fix</th><th>Proof points</th><th>Do not say</th></tr></thead><tbody>${actionTable}</tbody></table>
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, "message-gap-map");
  await mkdir(outDir, { recursive: true });

  const iboltRows = await readCsv(path.join(benchmarkDir, "answer-context-dossier", "ibolt-mention-context.csv"));
  const lostRows = await readCsv(path.join(benchmarkDir, "answer-context-dossier", "lost-answer-language.csv"));
  const competitorContextRows = await readCsv(path.join(benchmarkDir, "answer-context-dossier", "competitor-context-scorecard.csv"));
  const competitorLanguageRows = await readCsv(path.join(benchmarkDir, "mention-context-playbook", "competitor-language-playbook.csv"));
  const mentionQualityRows = await readCsv(path.join(benchmarkDir, "mention-quality-audit", "mention-quality-rows.csv"));
  const master = await readJsonIfExists(path.join(benchmarkDir, "master-dossier", "master-dossier-data.json"), {});

  const themeRows = buildThemeRows({ iboltRows, lostRows, competitorContextRows });
  const competitorRows = buildCompetitorRows({ lostRows, competitorContextRows, competitorLanguageRows });
  const queryRows = buildQueryRows(lostRows);
  const iboltMentionRows = buildIboltMentionRows(iboltRows, mentionQualityRows);
  const copyActionRows = buildCopyActionRows(themeRows, competitorRows);
  const iboltThemeRows = themesFromRows(iboltRows, "language_patterns");
  const lostThemeRows = themesFromRows(lostRows, "language_patterns");

  const summary = {
    benchmarkDir,
    totalAnswers: master.evidenceSummary?.total || 0,
    iBOLTMentionRate: pct(master.evidenceSummary?.mentionCount || iboltRows.length, master.evidenceSummary?.total || 0),
    nonBrandedMentionRate: pct(master.evidenceSummary?.nonBrandedMentionCount || 0, master.evidenceSummary?.nonBranded || 0),
    citationRate: pct(master.evidenceSummary?.citationCount || 0, master.evidenceSummary?.total || 0),
    iboltMentionRows: iboltRows.length,
    lostAnswerRows: lostRows.length,
    competitorRows: competitorRows.length,
    queryRows: queryRows.length,
    themeRows: themeRows.length,
    copyActionRows: copyActionRows.length,
    topThemeGaps: themeRows.slice(0, 5).map((row) => `${row.label}: ${row.gapPoints} pts`),
    topCompetitors: competitorRows.slice(0, 8).map((row) => `${row.brand}: ${row.lostRows} lost rows`),
    brandSafety:
      "Do not reposition iBOLT as budget, cheap, affordable alternative, or cheaper than RAM. Use value language around right-fit kits, modular reuse, 24-business-hour shipping, and warranty.",
  };

  const data = {
    generatedAt: new Date().toISOString(),
    summary,
    themeRows,
    competitorRows,
    queryRows,
    iboltMentionRows,
    copyActionRows,
    iboltThemeRows,
    lostThemeRows,
  };

  await writeFile(path.join(outDir, "message-gap-data.json"), JSON.stringify(data, null, 2));
  await writeFile(path.join(outDir, "theme-gap-ranking.csv"), csv([
    ["theme", "label", "ibolt_rows", "ibolt_rate", "lost_rows", "lost_rate", "competitor_context_count", "gap_points", "top_competitors", "top_categories", "sample_queries", "page_copy", "schema_fix", "proof_points", "do_not_say"],
    ...themeRows.map((row) => [
      row.theme,
      row.label,
      row.iboltRows,
      row.iboltRate,
      row.lostRows,
      row.lostRate,
      row.competitorContextCount,
      row.gapPoints,
      row.topCompetitors,
      row.topCategories,
      row.sampleQueries,
      row.pageCopy,
      row.schemaFix,
      row.proofPoints,
      row.doNotSay,
    ]),
  ]));
  await writeFile(path.join(outDir, "competitor-message-pressure.csv"), csv([
    ["brand", "pressure_score", "lost_rows", "raw_appearances", "co_mention_rows", "categories", "providers", "queries", "themes", "counter_positioning", "sample"],
    ...competitorRows.map((row) => [
      row.brand,
      row.pressureScore,
      row.lostRows,
      row.rawAppearances,
      row.coMentionRows,
      row.categories,
      row.providers,
      row.queries,
      row.themes,
      row.counterPositioning,
      row.sample,
    ]),
  ]));
  await writeFile(path.join(outDir, "query-language-map.csv"), csv([
    ["query", "category", "lost_provider_count", "lost_providers", "avg_coverage", "competitors", "themes", "recommended_angles"],
    ...queryRows.map((row) => [
      row.query,
      row.category,
      row.lostProviderCount,
      row.lostProviders,
      row.avgCoverage,
      row.competitors,
      row.themes,
      row.recommendedAngles,
    ]),
  ]));
  await writeFile(path.join(outDir, "ibolt-mention-language.csv"), csv([
    ["provider", "query", "category", "coverage_score", "mention_quality_score", "top_pick_rank", "sentiment", "co_mentioned_competitors", "product_signals", "catalog_products", "positioning_signals", "language_patterns", "action", "snippet"],
    ...iboltMentionRows.map((row) => [
      row.provider,
      row.query,
      row.category,
      row.coverageScore,
      row.mentionQualityScore,
      row.topPickRank,
      row.sentiment,
      row.coMentionedCompetitors,
      row.productSignals,
      row.catalogProducts,
      row.positioningSignals,
      row.languagePatterns,
      row.action,
      row.snippet,
    ]),
  ]));
  await writeFile(path.join(outDir, "copy-blocks-to-add.csv"), csv([
    ["priority", "theme", "gap_points", "ibolt_current_rate", "lost_answer_rate", "main_competitors", "affected_categories", "page_copy", "schema_fix", "proof_points", "off_site_ask", "do_not_say"],
    ...copyActionRows.map((row) => [
      row.priority,
      row.theme,
      row.gapPoints,
      row.iBOLTCurrentRate,
      row.lostAnswerRate,
      row.mainCompetitors,
      row.affectedCategories,
      row.pageCopy,
      row.schemaFix,
      row.proofPoints,
      row.offSiteAsk,
      row.doNotSay,
    ]),
  ]));
  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown({ summary, themeRows, competitorRows, queryRows, copyActionRows }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({ summary, themeRows, competitorRows, queryRows, copyActionRows }));
  await writeFile(path.join(outDir, "theme-gap.svg"), simpleBarSvg({
    rows: themeRows,
    labelKey: "label",
    valueKey: "gapPoints",
    title: "Message Theme Gap: Competitor Language Rate Minus iBOLT Language Rate",
  }));
  await writeFile(path.join(outDir, "competitor-message-pressure.svg"), simpleBarSvg({
    rows: competitorRows.slice(0, 12),
    labelKey: "brand",
    valueKey: "pressureScore",
    title: "Competitor Message Pressure In Lost AI Answers",
  }));

  console.log(`Wrote ${outDir}`);
  console.log(`Top theme gaps: ${summary.topThemeGaps.join("; ")}`);
  console.log(`Top competitors: ${summary.topCompetitors.join("; ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
