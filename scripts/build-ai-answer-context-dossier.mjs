import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";

const COMPETITOR_BRANDS = [
  "RAM Mounts",
  "RAM",
  "Arkon",
  "iOttie",
  "ProClip",
  "Scosche",
  "Garmin",
  "Humminbird",
  "Lowrance",
  "Scotty",
  "YakAttack",
  "Mount-It",
  "Bouncepad",
  "CTA Digital",
  "Heckler",
  "Kensington",
  "Havis",
  "Zebra",
  "Tackform",
  "Belkin",
  "Peak Design",
  "Lamicall",
  "LISEN",
  "Square",
];

const LANGUAGE_PATTERNS = [
  ["rugged/durable", /\b(rugged|durable|heavy[- ]duty|tough|withstand|vibration|rough)\b/i],
  ["secure/locking", /\b(locking|secure|security|theft|shared vehicle|public|anti[- ]theft)\b/i],
  ["easy install", /\b(easy|quick|simple|tool[- ]free|no[- ]drill|installation|install)\b/i],
  ["adjustable/flexible", /\b(adjustable|flexible|articulating|angle|position|rotate|swivel)\b/i],
  ["compatibility", /\b(compatible|compatibility|universal|fits|MagSafe|AMPS|ball|adapter)\b/i],
  ["commercial/pro", /\b(commercial|professional|fleet|warehouse|restaurant|industrial|business)\b/i],
  ["budget/value", /\b(budget|affordable|value|price|cost|inexpensive)\b/i],
  ["stability/grip", /\b(stable|stability|grip|hold|suction|clamp|magnetic)\b/i],
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

async function latestDir(prefix) {
  const entries = await readdir(path.join(process.cwd(), OUTPUT_ROOT), { withFileTypes: true });
  const match = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  if (!match) throw new Error(`No ${prefix} directory found in ${OUTPUT_ROOT}`);
  return path.join(process.cwd(), OUTPUT_ROOT, match);
}

function num(value) {
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function stripMarkdown(value) {
  return String(value ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[#>*_~|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sentenceSnippet(text, needle, radius = 280) {
  const clean = stripMarkdown(text);
  const index = clean.toLowerCase().indexOf(String(needle ?? "").toLowerCase());
  if (index < 0) return "";
  const start = Math.max(0, index - radius);
  const end = Math.min(clean.length, index + String(needle).length + radius);
  return `${start > 0 ? "..." : ""}${clean.slice(start, end).trim()}${end < clean.length ? "..." : ""}`;
}

function patternTags(text) {
  return LANGUAGE_PATTERNS
    .filter(([, pattern]) => pattern.test(text))
    .map(([label]) => label);
}

function competitorList(row) {
  return [...new Set([
    ...splitList(row.raw_competitors),
    ...splitList(row.stored_competitors),
  ].map(normalizeCompetitor).filter(Boolean))];
}

function normalizeCompetitor(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (/^RAM$/i.test(text)) return "RAM Mounts";
  if (/^Mount-It!?$/i.test(text)) return "Mount-It";
  if (/^iBOLT$/i.test(text)) return "";
  return text;
}

function relevantCompetitors(text, row) {
  const fromRow = competitorList(row);
  const clean = stripMarkdown(text);
  const detected = COMPETITOR_BRANDS.filter((brand) => {
    if (brand === "RAM") return /\bRAM\b/.test(clean);
    return clean.toLowerCase().includes(brand.toLowerCase());
  }).map(normalizeCompetitor);
  return [...new Set([...fromRow, ...detected].map(normalizeCompetitor))].filter(Boolean);
}

function makeMentionRows(evidenceRows, answerTexts) {
  return evidenceRows
    .filter((row) => row.brand_mentioned === "true")
    .map((row) => {
      const text = answerTexts.get(row.answer_file) ?? "";
      const snippet = sentenceSnippet(text, "iBOLT") || row.brand_excerpt;
      const competitors = relevantCompetitors(text, row);
      return {
        provider: row.provider,
        query: row.query,
        category: row.category,
        coverageScore: num(row.coverage_score),
        topPickRank: row.top_pick_rank,
        coMentionedCompetitors: competitors.join("; "),
        productSignals: row.product_signals,
        catalogProducts: row.catalog_product_names,
        positioningSignals: row.positioning_signals,
        languagePatterns: patternTags(`${snippet} ${row.positioning_signals}`).join("; "),
        snippet,
        answerFile: row.answer_file,
      };
    })
    .sort((a, b) => b.coverageScore - a.coverageScore);
}

function makeLostRows(evidenceRows, answerTexts) {
  return evidenceRows
    .filter((row) => row.brand_mentioned !== "true")
    .map((row) => {
      const text = answerTexts.get(row.answer_file) ?? "";
      const competitors = relevantCompetitors(text, row);
      const firstCompetitor = competitors[0] || "competitor";
      return {
        provider: row.provider,
        query: row.query,
        category: row.category,
        coverageScore: num(row.coverage_score),
        competitors: competitors.join("; "),
        languagePatterns: patternTags(text).join("; "),
        competitorSnippet: sentenceSnippet(text, firstCompetitor),
        recommendedPageAngle: lostAngle(row.category, competitors),
        answerFile: row.answer_file,
      };
    })
    .sort((a, b) => a.coverageScore - b.coverageScore || a.query.localeCompare(b.query));
}

function lostAngle(category, competitors) {
  const first = competitors.slice(0, 3).join(", ") || "the default competitors";
  if (category === "fishing") {
    return `Clarify that iBOLT solves the mounting side of fish finder setups and compare placement, AMPS plates, rails, vibration, and Garmin/Humminbird/Lowrance compatibility against ${first}.`;
  }
  if (category === "delivery" || category === "fleet") {
    return `Separate iBOLT from consumer car mounts like ${first} by emphasizing commercial retention, shared vehicles, drill bases, AMPS compatibility, and daily driver workflows.`;
  }
  if (category === "restaurant" || category === "tablet") {
    return `Put iBOLT beside ${first} in restaurant tablet and POS comparison sections, then emphasize multi-tablet stations, locking holders, and delivery app workflows.`;
  }
  if (category === "warehouse") {
    return `Compare iBOLT against ${first} for forklift, barcode scanner, Zebra/Honeywell style device handling, vibration, and no-drill or secure warehouse installs.`;
  }
  return `Create a fair comparison section against ${first} and state the exact workflow where iBOLT is the specialist fit.`;
}

function makeCompetitorRows(lostRows, mentionRows) {
  const map = new Map();
  for (const row of lostRows) {
    for (const brand of splitList(row.competitors)) {
      const current = map.get(brand) ?? {
        brand,
        lostAnswers: 0,
        coMentionWins: 0,
        categories: new Map(),
        providers: new Map(),
        patterns: new Map(),
        exampleQueries: [],
        snippets: [],
      };
      current.lostAnswers += 1;
      current.categories.set(row.category, (current.categories.get(row.category) ?? 0) + 1);
      current.providers.set(row.provider, (current.providers.get(row.provider) ?? 0) + 1);
      for (const pattern of splitList(row.languagePatterns)) {
        current.patterns.set(pattern, (current.patterns.get(pattern) ?? 0) + 1);
      }
      if (current.exampleQueries.length < 6) current.exampleQueries.push(row.query);
      if (row.competitorSnippet && current.snippets.length < 3) current.snippets.push(row.competitorSnippet);
      map.set(brand, current);
    }
  }
  for (const row of mentionRows) {
    for (const brand of splitList(row.coMentionedCompetitors)) {
      const current = map.get(brand);
      if (current) current.coMentionWins += 1;
    }
  }
  return [...map.values()]
    .map((row) => ({
      ...row,
      categoriesText: formatCounts(row.categories),
      providersText: formatCounts(row.providers),
      patternsText: formatCounts(row.patterns),
      pressureScore: row.lostAnswers + Math.max(0, 8 - row.coMentionWins),
    }))
    .sort((a, b) => b.pressureScore - a.pressureScore || b.lostAnswers - a.lostAnswers);
}

function formatCounts(map) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => `${name} ${count}`)
    .join("; ");
}

function makeProviderRows(evidenceRows) {
  const map = new Map();
  for (const row of evidenceRows) {
    const key = `${row.provider}:${row.category}`;
    const current = map.get(key) ?? {
      provider: row.provider,
      category: row.category,
      answers: 0,
      mentions: 0,
      citations: 0,
      topPicks: 0,
      scoreTotal: 0,
      competitorOnly: 0,
    };
    current.answers += 1;
    current.mentions += row.brand_mentioned === "true" ? 1 : 0;
    current.citations += row.domain_cited === "true" ? 1 : 0;
    current.topPicks += row.top_pick_rank === "1" ? 1 : 0;
    current.scoreTotal += num(row.coverage_score);
    current.competitorOnly += row.brand_mentioned === "true" ? 0 : 1;
    map.set(key, current);
  }
  return [...map.values()]
    .map((row) => ({
      ...row,
      avgScore: Math.round(row.scoreTotal / row.answers),
      mentionRate: Math.round((row.mentions / row.answers) * 100),
      citationRate: Math.round((row.citations / row.answers) * 100),
      competitorOnlyRate: Math.round((row.competitorOnly / row.answers) * 100),
    }))
    .sort((a, b) => b.competitorOnlyRate - a.competitorOnlyRate || a.provider.localeCompare(b.provider));
}

function makeMarkdown({ mentionRows, lostRows, competitorRows, providerRows, benchmarkDir }) {
  const categoryLost = formatCounts(lostRows.reduce((map, row) => map.set(row.category, (map.get(row.category) ?? 0) + 1), new Map()));
  const patternLost = formatCounts(lostRows.reduce((map, row) => {
    for (const pattern of splitList(row.languagePatterns)) map.set(pattern, (map.get(pattern) ?? 0) + 1);
    return map;
  }, new Map()));
  const patternWon = formatCounts(mentionRows.reduce((map, row) => {
    for (const pattern of splitList(row.languagePatterns)) map.set(pattern, (map.get(pattern) ?? 0) + 1);
    return map;
  }, new Map()));

  return `# AI Answer Context Dossier

This report extracts the actual language patterns from saved AI benchmark answers. It answers how iBOLT is mentioned, who it appears next to, and what competitor language wins when iBOLT is absent.

## Summary

- iBOLT mention examples: ${mentionRows.length}
- Lost-answer examples: ${lostRows.length}
- Competitors/adjacent brands extracted from lost answers: ${competitorRows.length}
- Lost-answer categories: ${categoryLost}
- Winning iBOLT language patterns: ${patternWon || "none detected"}
- Competitor-winning language patterns: ${patternLost || "none detected"}

## How iBOLT Is Mentioned

| Score | Provider | Query | Category | Rank | Co-mentioned brands | Product signals | Language patterns |
| ---: | --- | --- | --- | --- | --- | --- | --- |
${mentionRows.slice(0, 16).map((row) => `| ${row.coverageScore} | ${row.provider} | ${row.query} | ${row.category} | ${row.topPickRank || ""} | ${row.coMentionedCompetitors} | ${row.productSignals || row.catalogProducts} | ${row.languagePatterns} |`).join("\n")}

## Where Competitors Win Instead

| Score | Provider | Query | Category | Competitors | Language patterns | Recommended page angle |
| ---: | --- | --- | --- | --- | --- | --- |
${lostRows.slice(0, 20).map((row) => `| ${row.coverageScore} | ${row.provider} | ${row.query} | ${row.category} | ${row.competitors} | ${row.languagePatterns} | ${row.recommendedPageAngle} |`).join("\n")}

## Competitor Context

| Pressure | Brand | Lost answers | Co-mentioned wins | Categories | Providers | Competitor language |
| ---: | --- | ---: | ---: | --- | --- | --- |
${competitorRows.slice(0, 18).map((row) => `| ${row.pressureScore} | ${row.brand} | ${row.lostAnswers} | ${row.coMentionWins} | ${row.categoriesText} | ${row.providersText} | ${row.patternsText} |`).join("\n")}

## Provider And Category Behavior

| Provider | Category | Answers | Mention rate | Citation rate | Competitor-only rate | Avg score |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
${providerRows.map((row) => `| ${row.provider} | ${row.category} | ${row.answers} | ${row.mentionRate}% | ${row.citationRate}% | ${row.competitorOnlyRate}% | ${row.avgScore} |`).join("\n")}

## What To Mirror In Page Refreshes

- Use exact workflow labels early: fleet, delivery drivers, shared vehicles, restaurant POS, forklift, warehouse, fish finder, kayak, small boat.
- Pair the iBOLT product name with a concrete mounting method: drill base, clamp, suction, AMPS plate, wall mount, locking holder, ball size.
- Name competitors where buyers and AI already expect them, then explain the tradeoff fairly.
- Avoid generic superiority claims. The winning angle is specialist fit, commercial use, security, modular compatibility, and exact workflow.
- Push exact product entities. Broad iBOLT mentions are not enough for product-level recommendation visibility.
- Treat "budget/value" as a warning, not a voice target. iBOLT should not be framed as cheap. Convert that buyer concern into durability, 2-year warranty, modular reuse, and right-fit product selection.

Source benchmark folder: ${benchmarkDir}
`;
}

function makeHtml({ mentionRows, lostRows, competitorRows, providerRows }) {
  const cards = [
    ["iBOLT mentions", mentionRows.length],
    ["Lost answers", lostRows.length],
    ["Competitor brands", competitorRows.length],
    ["Provider/category slices", providerRows.length],
  ].map(([label, value]) => `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div></div>`).join("");

  const mentionTable = mentionRows.slice(0, 16).map((row) => `<tr><td>${row.coverageScore}</td><td>${escapeHtml(row.provider)}</td><td>${escapeHtml(row.query)}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.coMentionedCompetitors)}</td><td>${escapeHtml(row.languagePatterns)}</td></tr>`).join("");
  const lostTable = lostRows.slice(0, 20).map((row) => `<tr><td>${row.coverageScore}</td><td>${escapeHtml(row.provider)}</td><td>${escapeHtml(row.query)}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.competitors)}</td><td>${escapeHtml(row.languagePatterns)}</td><td>${escapeHtml(row.recommendedPageAngle)}</td></tr>`).join("");
  const competitorTable = competitorRows.slice(0, 18).map((row) => `<tr><td>${row.pressureScore}</td><td>${escapeHtml(row.brand)}</td><td>${row.lostAnswers}</td><td>${row.coMentionWins}</td><td>${escapeHtml(row.categoriesText)}</td><td>${escapeHtml(row.patternsText)}</td></tr>`).join("");
  const providerTable = providerRows.map((row) => `<tr><td>${escapeHtml(row.provider)}</td><td>${escapeHtml(row.category)}</td><td>${row.answers}</td><td>${row.mentionRate}%</td><td>${row.citationRate}%</td><td>${row.competitorOnlyRate}%</td><td>${row.avgScore}</td></tr>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>iBOLT AI Answer Context Dossier</title>
<style>
body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}main{max-width:1240px;margin:0 auto;padding:34px 24px 70px}h1{font-size:34px;margin:0 0 8px}h2{font-size:22px;margin:32px 0 12px}p{color:#334155;line-height:1.55}.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid #d9e2ef;border-radius:12px;padding:16px}.k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700}.v{font-size:30px;font-weight:800;margin-top:8px}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d9e2ef;border-radius:12px;overflow:hidden;margin-bottom:22px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #edf2f7;padding:10px 11px;font-size:14px}th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:12px;letter-spacing:.04em}.note{background:#f0fdf4;border-left:6px solid #16a34a;border-radius:10px;padding:14px 16px}
</style></head><body><main>
<h1>iBOLT AI Answer Context Dossier</h1>
<p class="note">This report extracts the language patterns from saved model responses so page edits can mirror what AI systems already use when making recommendations. Treat budget/value as buyer intent, not iBOLT positioning.</p>
<section class="cards">${cards}</section>
<h2>How iBOLT Is Mentioned</h2><table><thead><tr><th>Score</th><th>Provider</th><th>Query</th><th>Category</th><th>Co-mentioned brands</th><th>Language</th></tr></thead><tbody>${mentionTable}</tbody></table>
<h2>Where Competitors Win Instead</h2><table><thead><tr><th>Score</th><th>Provider</th><th>Query</th><th>Category</th><th>Competitors</th><th>Language</th><th>Page angle</th></tr></thead><tbody>${lostTable}</tbody></table>
<h2>Competitor Context</h2><table><thead><tr><th>Pressure</th><th>Brand</th><th>Lost answers</th><th>Co-mentioned wins</th><th>Categories</th><th>Language</th></tr></thead><tbody>${competitorTable}</tbody></table>
<h2>Provider And Category Behavior</h2><table><thead><tr><th>Provider</th><th>Category</th><th>Answers</th><th>Mention</th><th>Citation</th><th>Competitor-only</th><th>Avg score</th></tr></thead><tbody>${providerTable}</tbody></table>
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const evidenceDir = path.join(benchmarkDir, "answer-evidence-pack");
  const outDir = path.join(benchmarkDir, "answer-context-dossier");
  await mkdir(outDir, { recursive: true });

  const evidenceRows = await readCsv(path.join(evidenceDir, "answer-evidence.csv"));
  const answerTexts = new Map();
  for (const row of evidenceRows) {
    const answerPath = path.join(evidenceDir, row.answer_file);
    if (!answerTexts.has(row.answer_file)) {
      try {
        answerTexts.set(row.answer_file, await readFile(answerPath, "utf8"));
      } catch {
        answerTexts.set(row.answer_file, "");
      }
    }
  }

  const mentionRows = makeMentionRows(evidenceRows, answerTexts);
  const lostRows = makeLostRows(evidenceRows, answerTexts);
  const competitorRows = makeCompetitorRows(lostRows, mentionRows);
  const providerRows = makeProviderRows(evidenceRows);

  await writeFile(path.join(outDir, "ibolt-mention-context.csv"), csv([
    ["provider", "query", "category", "coverage_score", "top_pick_rank", "co_mentioned_competitors", "product_signals", "catalog_products", "positioning_signals", "language_patterns", "snippet", "answer_file"],
    ...mentionRows.map((row) => [row.provider, row.query, row.category, row.coverageScore, row.topPickRank, row.coMentionedCompetitors, row.productSignals, row.catalogProducts, row.positioningSignals, row.languagePatterns, row.snippet, row.answerFile]),
  ]));
  await writeFile(path.join(outDir, "lost-answer-language.csv"), csv([
    ["provider", "query", "category", "coverage_score", "competitors", "language_patterns", "competitor_snippet", "recommended_page_angle", "answer_file"],
    ...lostRows.map((row) => [row.provider, row.query, row.category, row.coverageScore, row.competitors, row.languagePatterns, row.competitorSnippet, row.recommendedPageAngle, row.answerFile]),
  ]));
  await writeFile(path.join(outDir, "competitor-context-scorecard.csv"), csv([
    ["pressure_score", "brand", "lost_answers", "co_mentioned_wins", "categories", "providers", "language_patterns", "example_queries", "example_snippets"],
    ...competitorRows.map((row) => [row.pressureScore, row.brand, row.lostAnswers, row.coMentionWins, row.categoriesText, row.providersText, row.patternsText, row.exampleQueries, row.snippets]),
  ]));
  await writeFile(path.join(outDir, "provider-category-context.csv"), csv([
    ["provider", "category", "answers", "mentions", "mention_rate", "citations", "citation_rate", "competitor_only_rate", "avg_score"],
    ...providerRows.map((row) => [row.provider, row.category, row.answers, row.mentions, row.mentionRate, row.citations, row.citationRate, row.competitorOnlyRate, row.avgScore]),
  ]));
  await writeFile(path.join(outDir, "REPORT.md"), makeMarkdown({ mentionRows, lostRows, competitorRows, providerRows, benchmarkDir }));
  await writeFile(path.join(outDir, "REPORT.html"), makeHtml({ mentionRows, lostRows, competitorRows, providerRows }));

  console.log(`Wrote ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
