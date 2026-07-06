#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "answer-language-evidence");

async function readText(relativePath) {
  try {
    return await readFile(path.join(benchmarkDir, relativePath), "utf8");
  } catch {
    return "";
  }
}

async function readJson(relativePath) {
  try {
    return JSON.parse(await readFile(path.join(benchmarkDir, relativePath), "utf8"));
  } catch {
    return {};
  }
}

async function readCsv(relativePath) {
  const text = await readText(relativePath);
  return text ? parseCsv(text) : [];
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted && char === '"' && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(value);
      value = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows.shift();
  return rows
    .filter((cells) => cells.some((cell) => String(cell ?? "").trim()))
    .map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

function csv(rows) {
  return `${rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n")}\n`;
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
  const match = String(value ?? "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function pct(value, total) {
  return total ? Math.round((value / total) * 100) : 0;
}

function short(value, length = 140) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row) || "unknown";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function countFromFields(rows, fields) {
  const counts = new Map();
  for (const row of rows) {
    for (const field of fields) {
      for (const item of splitList(row[field])) {
        counts.set(item, (counts.get(item) || 0) + 1);
      }
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function countBrands(rows, field) {
  const counts = new Map();
  for (const row of rows) {
    for (const item of splitList(row[field])) {
      counts.set(item, (counts.get(item) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function topList(items, limit = 8) {
  return items
    .slice(0, limit)
    .map(([item, count]) => `${item} ${count}`)
    .join("; ");
}

function tierForCompetitor(row) {
  const appearances = toNumber(row.appearances);
  const withoutIbolt = toNumber(row.without_ibolt);
  if (withoutIbolt >= 50 || appearances >= 50) return "Tier 1 default";
  if (withoutIbolt >= 12 || appearances >= 15) return "Tier 2 recurring";
  if (withoutIbolt >= 6 || appearances >= 8) return "Tier 3 pocket";
  return "Tier 4 monitor";
}

function actionForMention(row) {
  const actions = [];
  if (/budget|value|cheap|affordable/i.test(`${row.positioning_tags} ${row.sentiment} ${row.snippet}`)) {
    actions.push("remove budget/value framing");
  }
  if (row.unmatched_product_names) actions.push("correct product names");
  if (String(row.target_domain_cited).toLowerCase() !== "true") actions.push("add citable proof and schema");
  if (!row.top_pick_rank || toNumber(row.top_pick_rank) > 3) actions.push("strengthen recommendation framing");
  return actions.length ? actions.join("; ") : "preserve language and add citation support";
}

function categoryLanguageCommand(category, competitors, patterns) {
  const categoryCopy = {
    restaurant: "purpose-built restaurant tablet stations, Tablet Tower, LockPro, Dock'n Lock, multi-tablet delivery app workflows, keyed security, and AMPS-compatible parts",
    delivery: "commercial delivery phone mounting, shared-vehicle retention, locked drill-base options, suction or console setups, and exact xProDock and Dock'n Lock product names",
    fleet: "fleet-standardized phone and ELD mounting, drill bases, AMPS compatibility, shared-vehicle durability, and device changes across routes and trucks",
    fishing: "fish finder mounting plates, marine electronics placement, rail and handlebar mounting, vibration control, and Garmin, Lowrance, and Humminbird compatibility",
    warehouse: "forklift tablet mounts, barcode scanner holders, no-drill cage or pillar setups, vibration resistance, and Zebra and Honeywell workflow language",
    tablet: "commercial tablet mounting by use case, not generic tablet stands, with locking, drill-base, clamp, wall, suction, and AMPS options",
    "amps/modular": "AMPS pattern plates, 17mm, 20mm, 25mm/B size, 38mm/C size, 57mm, interchangeable arms, adapters, and Mount Configurator language",
    streaming: "phone and camera mounting for live streaming, overhead angles, table clamp setups, stable positioning, and creator workstations",
  };
  const base = categoryCopy[category] || "iBOLT as the exact-workflow specialist with industrial-grade mounting, modular compatibility, and product-specific proof";
  const avoidBudget = /budget|value|cheap|affordable/i.test(patterns) ? " Avoid budget or cheap framing." : "";
  const competitorText = competitors ? ` Counter ${competitors} with exact use-case proof.` : "";
  return `Add answer-first copy that names iBOLT and says: ${base}.${competitorText}${avoidBudget}`;
}

function barSvg({ title, rows, width = 920, rowHeight = 34, color = "#0f766e", maxValue }) {
  const chartRows = rows.filter((row) => Number.isFinite(row.value)).slice(0, 14);
  const height = 76 + chartRows.length * rowHeight;
  const max = maxValue || Math.max(1, ...chartRows.map((row) => row.value));
  const bars = chartRows.map((row, index) => {
    const y = 58 + index * rowHeight;
    const fullWidth = width - 370;
    const barWidth = Math.max(2, Math.round((row.value / max) * fullWidth));
    return `<g>
      <text x="22" y="${y + 17}" font-size="13" font-weight="800" fill="#111827">${escapeHtml(short(row.label, 42))}</text>
      <rect x="316" y="${y}" width="${fullWidth}" height="21" rx="10" fill="#e5e7eb"/>
      <rect x="316" y="${y}" width="${barWidth}" height="21" rx="10" fill="${row.color || color}"/>
      <text x="${width - 24}" y="${y + 16}" font-size="13" font-weight="900" text-anchor="end" fill="#111827">${escapeHtml(row.value)}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#ffffff"/>
    <text x="22" y="34" font-size="20" font-weight="900" fill="#111827">${escapeHtml(title)}</text>
    ${bars}
  </svg>`;
}

function renderTable(headers, rows) {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table>${head}${body}</table>`;
}

function card(label, value, note) {
  return `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`;
}

function renderHtml(data) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT AI Answer Language Evidence</title>
  <style>
    body{margin:0;background:#f7f9fc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1240px;margin:0 auto;padding:34px 24px 68px}
    h1{font-size:38px;line-height:1.1;margin:0 0 8px;letter-spacing:0}
    h2{font-size:24px;margin:36px 0 12px}
    h3{font-size:17px;margin:18px 0 8px}
    p,li{line-height:1.55;color:#334155;font-size:15px}
    a{color:#0f766e;overflow-wrap:anywhere}
    code{background:#e2e8f0;border-radius:5px;padding:2px 5px}
    .note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #0f766e;border-radius:12px;padding:16px 18px;margin:20px 0}
    .warn{border-left-color:#f97316}
    .cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:22px 0}
    .card{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:15px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:900}
    .value{font-size:29px;font-weight:900;margin:8px 0;color:#0f172a}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
    .chart{background:#fff;border:1px solid #dbe3ef;border-radius:18px;padding:10px;overflow:auto}
    .chart svg{width:100%;height:auto;display:block}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 22px}
    th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    @media(max-width:980px){.cards,.grid{grid-template-columns:1fr}h1{font-size:31px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT AI Answer Language Evidence</h1>
  <p>This report turns saved AI answers into a boss-readable explanation of how iBOLT is described, which competitor language is beating it, and which copy/schema/citation actions should move visibility.</p>

  <div class="note">
    <strong>Readout:</strong> iBOLT gets useful durability and specialist language when it appears, but broad prompts still default to RAM Mounts, Arkon, iOttie, CTA Digital, ProClip, marine electronics brands, and restaurant kiosk brands. The main language fixes are exact product names, source-ready proof, and removing any budget/value framing.
  </div>

  <section class="cards">
    ${card("Answers analyzed", data.summary.totalAnswers, "Saved AI answers in the baseline evidence set.")}
    ${card("iBOLT mentions", `${data.summary.mentions} (${data.summary.mentionRate}%)`, "Any answer where iBOLT appears.")}
    ${card("Clean mentions", data.summary.cleanMentions, "iBOLT appears without competitor co-mention pressure.")}
    ${card("Competitor replacements", data.summary.competitorReplacements, "Answers where competitors show up without iBOLT.")}
    ${card("Citation rate", `${data.summary.citationRate}%`, "No answer cited the iBOLT domain in this baseline.")}
  </section>

  <section class="cards">
    ${card("Avg mention quality", data.summary.avgMentionQuality, "Quality score across iBOLT mention rows.")}
    ${card("Naming review rows", data.summary.namingReviewRows, "Rows where AI used non-exact or risky product naming.")}
    ${card("Budget risk rows", data.summary.budgetRiskRows, "Rows using budget, value, cheap, or similar framing.")}
    ${card("Co-mentions", data.summary.coMentions, "iBOLT mentioned beside competitors.")}
    ${card("Priority page commands", data.summary.pageCommands, "Page-level copy/schema/citation commands generated below.")}
  </section>

  <div class="grid">
    <div class="chart">${data.languageHealthSvg}</div>
    <div class="chart">${data.competitorPressureSvg}</div>
  </div>

  <h2>How AI Mentions iBOLT</h2>
  <p>These are the iBOLT answer rows most worth acting on. Strong rows should be supported with citation-ready specs and schema. Weak rows need product-name correction, less budget/value language, or stronger recommendation framing.</p>
  ${renderTable(["Provider", "Query", "Category", "Quality", "Rank", "Co-mentioned", "Language", "Products", "Action", "Evidence"], data.iboltMentionExamples.map((row) => [row.provider, row.query, row.category, row.quality, row.rank, row.coMentioned, row.language, row.products, row.action, row.evidence]))}

  <h2>Who iBOLT Is Mentioned Next To</h2>
  <p>Competitors with high <code>without_iBOLT</code> are replacing iBOLT in answers. Competitors with high <code>with_iBOLT</code> are comparison-adjacent and should be used in fair comparison sections.</p>
  ${renderTable(["Brand", "Tier", "Appearances", "With iBOLT", "Without iBOLT", "Categories", "Common Queries", "Counter-positioning"], data.competitorBattlecards.map((row) => [row.brand, row.tier, row.appearances, row.withIbolt, row.withoutIbolt, row.categories, row.queries, row.counter]))}

  <h2>Lost Answer Language By Category</h2>
  <p>This shows the language AI is already using when it does not include iBOLT. Use these terms in shopper-facing quick answers, comparison tables, FAQ/schema, product modules, and alt text.</p>
  ${renderTable(["Category", "Lost Rows", "Competitors", "Language Patterns", "Top Queries", "Copy Command"], data.categoryLanguageRows.map((row) => [row.category, row.lostRows, row.competitors, row.patterns, row.queries, row.command]))}

  <h2>Page Copy And Citation Commands</h2>
  <p>Use this as the first execution sheet for language cleanup. It connects competitor pressure to exact on-page actions and keeps citation work after source cleanup.</p>
  ${renderTable(["Rank", "Sprint", "Page", "Category", "Primary Competitor", "Top Fix", "Language Command", "Schema Command", "Citation Action"], data.pageCopyCommands.map((row) => [row.rank, row.sprint, row.page, row.category, row.competitor, row.topFix, row.languageCommand, row.schemaCommand, row.citationAction]))}
</main>
</body>
</html>`;
}

function renderMarkdown(data) {
  return `# iBOLT AI Answer Language Evidence

## Readout

iBOLT gets useful durability and specialist language when it appears, but broad prompts still default to competitors. The main language fixes are exact product names, source-ready proof, and removing budget/value framing.

## Scorecard

- Answers analyzed: ${data.summary.totalAnswers}
- iBOLT mentions: ${data.summary.mentions} (${data.summary.mentionRate}%)
- Clean mentions: ${data.summary.cleanMentions}
- Co-mentions: ${data.summary.coMentions}
- Competitor replacements: ${data.summary.competitorReplacements}
- Citation rate: ${data.summary.citationRate}%
- Average mention quality: ${data.summary.avgMentionQuality}
- Naming review rows: ${data.summary.namingReviewRows}
- Budget/value risk rows: ${data.summary.budgetRiskRows}

## Top Competitor Pressure

${data.competitorBattlecards.slice(0, 10).map((row, index) => `${index + 1}. ${row.brand}: ${row.appearances} appearances, ${row.withoutIbolt} without iBOLT. Counter: ${row.counter}`).join("\n")}

## Category Commands

${data.categoryLanguageRows.map((row) => `- ${row.category}: ${row.command}`).join("\n")}

## Key Outputs

- ai-answer-language-summary.csv
- ibolt-mention-examples.csv
- competitor-language-battlecards.csv
- lost-answer-language-by-category.csv
- page-copy-citation-commands.csv
- ibolt-language-health.svg
- competitor-language-pressure.svg
`;
}

async function main() {
  const snippetData = await readJson("answer-snippet-evidence-appendix/answer-snippet-evidence-data.json");
  const snippetSummary = snippetData.summary || {};
  const mentionScoreRows = await readCsv("mention-language-command-deck/mention-language-scorecard.csv");
  const mentionRows = await readCsv("mention-quality-audit/mention-quality-rows.csv");
  const competitorRows = await readCsv("mention-language-command-deck/competitor-language-counters.csv");
  const lostRows = await readCsv("answer-context-dossier/lost-answer-language.csv");
  const pageRows = await readCsv("page-edit-command-matrix/page-edit-command-matrix.csv");

  const totalMentionRows = mentionScoreRows.reduce((sum, row) => sum + toNumber(row.mention_rows), 0) || mentionRows.length || toNumber(snippetSummary.mentions);
  const weightedQuality = mentionScoreRows.reduce((sum, row) => sum + toNumber(row.avg_quality) * toNumber(row.mention_rows), 0);
  const avgMentionQuality = totalMentionRows ? Math.round(weightedQuality / totalMentionRows) : 0;
  const namingReviewRows = mentionScoreRows.reduce((sum, row) => sum + toNumber(row.naming_review_rows), 0);
  const budgetRiskRows = mentionScoreRows.reduce((sum, row) => sum + toNumber(row.budget_risk_rows), 0);
  const topPickRows = mentionScoreRows.reduce((sum, row) => sum + toNumber(row.top_pick_rows), 0);
  const domainCitedRows = mentionScoreRows.reduce((sum, row) => sum + toNumber(row.domain_cited_rows), 0);

  const summary = {
    generated_at: new Date().toISOString(),
    benchmark_dir: benchmarkDir,
    totalAnswers: toNumber(snippetSummary.totalAnswers) || 0,
    mentions: toNumber(snippetSummary.mentions) || totalMentionRows,
    mentionRate: toNumber(snippetSummary.mentionRate),
    cleanMentions: toNumber(snippetSummary.cleanMentions),
    coMentions: toNumber(snippetSummary.coMentions),
    competitorReplacements: toNumber(snippetSummary.competitorReplacements),
    competitorReplacementRate: toNumber(snippetSummary.competitorReplacementRate),
    citationRate: toNumber(snippetSummary.citationRate),
    avgMentionQuality,
    namingReviewRows,
    budgetRiskRows,
    topPickRows,
    domainCitedRows,
    lostRows: lostRows.length,
    pageCommands: pageRows.length,
  };

  const iboltMentionExamples = mentionRows
    .map((row) => ({
      provider: row.provider,
      query: row.query,
      category: row.category,
      quality: row.mention_quality_score,
      rank: row.top_pick_rank || "",
      coMentioned: row.co_mentioned_competitors || "",
      language: row.positioning_tags || row.sentiment || "",
      products: short(row.extracted_product_names || row.catalog_matches, 180),
      action: actionForMention(row),
      evidence: short(row.snippet, 220),
      sortScore:
        (row.unmatched_product_names ? 40 : 0) +
        (/budget|value|cheap|affordable/i.test(`${row.positioning_tags} ${row.snippet}`) ? 35 : 0) +
        (String(row.target_domain_cited).toLowerCase() === "true" ? 0 : 20) +
        Math.max(0, 100 - toNumber(row.mention_quality_score)),
    }))
    .sort((a, b) => b.sortScore - a.sortScore || a.provider.localeCompare(b.provider))
    .slice(0, 24);

  const totalCompetitorAppearances = competitorRows.reduce((sum, row) => sum + toNumber(row.appearances), 0);
  const competitorBattlecards = competitorRows
    .map((row) => ({
      brand: row.brand,
      tier: tierForCompetitor(row),
      appearances: toNumber(row.appearances),
      withIbolt: toNumber(row.with_ibolt),
      withoutIbolt: toNumber(row.without_ibolt),
      share: pct(toNumber(row.appearances), totalCompetitorAppearances),
      categories: row.categories,
      queries: short(row.queries, 220),
      counter: row.counter_positioning,
    }))
    .sort((a, b) => b.withoutIbolt - a.withoutIbolt || b.appearances - a.appearances)
    .slice(0, 30);

  const categoryLanguageRows = [...groupBy(lostRows, (row) => row.category).entries()]
    .map(([category, rows]) => {
      const competitors = topList(countBrands(rows, "competitors"), 8);
      const patterns = topList(countFromFields(rows, ["language_patterns"]), 10);
      const queries = [...new Set(rows.map((row) => row.query).filter(Boolean))].slice(0, 8).join("; ");
      return {
        category,
        lostRows: rows.length,
        competitors,
        patterns,
        queries,
        command: categoryLanguageCommand(category, competitors, patterns),
      };
    })
    .sort((a, b) => b.lostRows - a.lostRows || a.category.localeCompare(b.category));

  const pageCopyCommands = pageRows
    .slice()
    .sort((a, b) => toNumber(b.priority) - toNumber(a.priority) || toNumber(a.rank) - toNumber(b.rank))
    .slice(0, 36)
    .map((row) => ({
      rank: row.rank,
      sprint: row.sprint,
      page: row.title,
      url: row.url,
      category: row.category,
      competitor: row.primary_competitor,
      topFix: row.top_fix,
      languageCommand: row.language_instruction || row.quick_answer_command,
      schemaCommand: row.schema_command,
      citationAction: row.citation_action,
    }));

  const languageHealthRows = [
    { label: "iBOLT mentions", value: summary.mentions, color: "#0f766e" },
    { label: "Clean mentions", value: summary.cleanMentions, color: "#15803d" },
    { label: "Co-mentions", value: summary.coMentions, color: "#2563eb" },
    { label: "Top-pick rows", value: summary.topPickRows, color: "#7c3aed" },
    { label: "Naming review rows", value: summary.namingReviewRows, color: "#f97316" },
    { label: "Budget risk rows", value: summary.budgetRiskRows, color: "#dc2626" },
    { label: "Domain cited rows", value: summary.domainCitedRows, color: "#64748b" },
  ];
  const competitorPressureRows = competitorBattlecards.slice(0, 12).map((row) => ({
    label: row.brand,
    value: row.withoutIbolt,
    color: row.tier.startsWith("Tier 1") ? "#dc2626" : row.tier.startsWith("Tier 2") ? "#f97316" : "#2563eb",
  }));

  const data = {
    summary,
    iboltMentionExamples,
    competitorBattlecards,
    categoryLanguageRows,
    pageCopyCommands,
    languageHealthSvg: barSvg({ title: "iBOLT Language Health", rows: languageHealthRows }),
    competitorPressureSvg: barSvg({ title: "Competitor Replacements Without iBOLT", rows: competitorPressureRows, color: "#dc2626" }),
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml(data));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown(data));
  await writeFile(path.join(outDir, "answer-language-evidence-data.json"), JSON.stringify(data, null, 2));
  await writeFile(path.join(outDir, "ai-answer-language-summary.csv"), csv([
    ["metric", "value"],
    ...Object.entries(summary).map(([key, value]) => [key, value]),
  ]));
  await writeFile(path.join(outDir, "ibolt-mention-examples.csv"), csv([
    ["provider", "query", "category", "quality", "rank", "co_mentioned", "language", "products", "action", "evidence"],
    ...iboltMentionExamples.map((row) => [row.provider, row.query, row.category, row.quality, row.rank, row.coMentioned, row.language, row.products, row.action, row.evidence]),
  ]));
  await writeFile(path.join(outDir, "competitor-language-battlecards.csv"), csv([
    ["brand", "tier", "appearances", "with_ibolt", "without_ibolt", "share_pct", "categories", "common_queries", "counter_positioning"],
    ...competitorBattlecards.map((row) => [row.brand, row.tier, row.appearances, row.withIbolt, row.withoutIbolt, row.share, row.categories, row.queries, row.counter]),
  ]));
  await writeFile(path.join(outDir, "lost-answer-language-by-category.csv"), csv([
    ["category", "lost_rows", "competitors", "language_patterns", "top_queries", "copy_command"],
    ...categoryLanguageRows.map((row) => [row.category, row.lostRows, row.competitors, row.patterns, row.queries, row.command]),
  ]));
  await writeFile(path.join(outDir, "page-copy-citation-commands.csv"), csv([
    ["rank", "sprint", "page", "url", "category", "primary_competitor", "top_fix", "language_command", "schema_command", "citation_action"],
    ...pageCopyCommands.map((row) => [row.rank, row.sprint, row.page, row.url, row.category, row.competitor, row.topFix, row.languageCommand, row.schemaCommand, row.citationAction]),
  ]));
  await writeFile(path.join(outDir, "ibolt-language-health.svg"), data.languageHealthSvg);
  await writeFile(path.join(outDir, "competitor-language-pressure.svg"), data.competitorPressureSvg);

  console.log(`Wrote ${outDir}`);
  console.log(`Mentions: ${summary.mentions} (${summary.mentionRate}%)`);
  console.log(`Competitor replacements: ${summary.competitorReplacements}`);
  console.log(`Citation rate: ${summary.citationRate}%`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
