#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "mention-language-command-deck");

const preferredLanguage = {
  restaurant: "purpose-built restaurant tablet stations, Tablet Tower, LockPro, Dock'n Lock, multi-tablet delivery app workflows, keyed security, AMPS-compatible parts",
  delivery: "commercial delivery phone mounting, shared-vehicle retention, locked drill-base options, suction or console setups, xProDock and Dock'n Lock product names",
  fleet: "fleet-standardized phone and ELD mounting, drill bases, AMPS compatibility, shared-vehicle durability, device changes across routes and trucks",
  fishing: "fish finder mounting plates, marine electronics placement, rail and handlebar mounting, vibration control, Garmin, Lowrance, and Humminbird compatibility",
  warehouse: "forklift tablet mounts, barcode scanner holders, no-drill cage or pillar setups, vibration resistance, Zebra and Honeywell workflow language",
  tablet: "commercial tablet mounting by use case, not generic tablet stands, with locking, drill-base, clamp, wall, suction, and AMPS options",
  comparison: "iBOLT as the exact-workflow specialist beside RAM Mounts, Arkon, ProClip, and iOttie, with modular compatibility rather than generic accessory positioning",
  "amps/modular": "AMPS pattern, 17mm, 20mm, 25mm/B size, 38mm/C size, 57mm, interchangeable arms, plates, adapters, and Mount Configurator language",
  streaming: "phone and camera mounting for live streaming, overhead angles, table clamp setups, stable positioning, and creator workstations",
  agriculture: "tractor, cab, UTV, and field-equipment mounting, vibration control, device visibility, and rugged seasonal work",
  education: "tablet mounting for classrooms, carts, accessibility, charging, security, and repeated shared-device use",
  offroad: "Jeep, UTV, trail, and overlanding mounting with vibration control, camera/phone retention, and modular ball compatibility",
};

async function readCsv(relativePath) {
  try {
    return parseCsv(await readFile(path.join(benchmarkDir, relativePath), "utf8"));
  } catch {
    return [];
  }
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
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

function short(value, length = 92) {
  const text = String(value ?? "");
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

function countList(rows, key, limit = 10) {
  const counts = new Map();
  for (const row of rows) {
    for (const item of splitList(row[key])) {
      counts.set(item, (counts.get(item) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([item, count]) => `${item} ${count}`)
    .join("; ");
}

function countValues(rows, key, limit = 10) {
  const counts = new Map();
  for (const row of rows) {
    const value = String(row[key] ?? "").trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([item, count]) => `${item} ${count}`)
    .join("; ");
}

function hasBudgetLanguage(value) {
  return /budget|cheap|affordable|price\/value|value/i.test(String(value ?? ""));
}

function languageInstruction(category, patterns = "") {
  const base = preferredLanguage[category] || preferredLanguage.comparison;
  const avoid = hasBudgetLanguage(patterns)
    ? "Avoid budget or cheap framing. Use durability, fit, exact workflow, warranty, and modularity instead."
    : "Keep the copy specific and proof-led rather than generic.";
  return `Add answer-first copy that names iBOLT and says: ${base}. ${avoid}`;
}

function renderTable(headers, rows) {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table>${head}${body}</table>`;
}

function card(label, value, note) {
  return `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`;
}

function barSvg({ title, rows, width = 900, rowHeight = 34, maxValue, color = "#0f766e" }) {
  const chartRows = rows.filter((row) => Number.isFinite(row.value)).slice(0, 12);
  const height = 76 + chartRows.length * rowHeight;
  const max = maxValue || Math.max(1, ...chartRows.map((row) => row.value));
  const bars = chartRows.map((row, index) => {
    const y = 58 + index * rowHeight;
    const barWidth = Math.round((row.value / max) * (width - 350));
    return `<g>
      <text x="22" y="${y + 17}" font-size="13" font-weight="800" fill="#111827">${escapeHtml(short(row.label, 40))}</text>
      <rect x="292" y="${y}" width="${width - 350}" height="21" rx="10" fill="#e5e7eb"/>
      <rect x="292" y="${y}" width="${barWidth}" height="21" rx="10" fill="${row.color || color}"/>
      <text x="${width - 28}" y="${y + 16}" font-size="13" font-weight="900" text-anchor="end" fill="#111827">${escapeHtml(row.value)}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#ffffff"/>
    <text x="22" y="34" font-size="20" font-weight="900" fill="#111827">${escapeHtml(title)}</text>
    ${bars}
  </svg>`;
}

function renderHtml(data) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT Mention Language Command Deck</title>
  <style>
    body{margin:0;background:#f7f9fc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1240px;margin:0 auto;padding:34px 24px 66px}
    h1{font-size:38px;line-height:1.1;margin:0 0 8px;letter-spacing:0}
    h2{font-size:23px;margin:36px 0 12px}
    h3{font-size:17px;margin:18px 0 8px}
    p,li{line-height:1.55;color:#334155;font-size:15px}
    a{color:#0f766e;overflow-wrap:anywhere}
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
  <h1>iBOLT Mention Language Command Deck</h1>
  <p>This turns saved AI-answer language into a practical copy and entity guidance sheet. It shows how models describe iBOLT now, where competitor language is winning, and which terms should be reinforced or corrected.</p>

  <div class="note">
    <strong>Language diagnosis:</strong> when iBOLT appears, models usually understand durability, specialist use, modularity, and security. The weaknesses are inconsistent exact product names, weak citation/source signals, and occasional budget/value framing that should be replaced with commercial-fit proof.
  </div>

  <section class="cards">
    ${card("Mention rows", data.summary.mentionRows, "Saved answer rows where iBOLT is mentioned.")}
    ${card("Avg quality", data.summary.avgMentionQuality, "Average mention-quality score across mentioned rows.")}
    ${card("Naming review", data.summary.namingReviewRows, "Rows with unmatched or questionable product names.")}
    ${card("Budget risk", data.summary.budgetRiskRows, "Rows using budget/value framing around iBOLT or competitors.")}
    ${card("Lost rows", data.summary.lostRows, "Saved rows where competitors replaced iBOLT.")}
  </section>

  <section class="grid">
    <div class="chart">${data.svgs.categoryMentions}</div>
    <div class="chart">${data.svgs.lostCategories}</div>
  </section>

  <h2>How iBOLT Is Mentioned</h2>
  ${data.tables.mentionScorecard}

  <h2>Lost Answer Language To Counter</h2>
  ${data.tables.lostCountercopy}

  <h2>Product Entity Naming Risks</h2>
  <div class="note warn">
    <strong>Important:</strong> exact product names need to appear consistently in page copy, image alt text, product cards, FAQ answers, and schema. The models are already inventing or shortening product names when the source pages are not explicit enough.
  </div>
  ${data.tables.productNaming}

  <h2>Provider-Specific Language Fixes</h2>
  ${data.tables.providerFixes}

  <h2>Files</h2>
  <ul>
    <li><a href="mention-language-scorecard.csv">mention-language-scorecard.csv</a></li>
    <li><a href="lost-language-countercopy.csv">lost-language-countercopy.csv</a></li>
    <li><a href="product-entity-naming-audit.csv">product-entity-naming-audit.csv</a></li>
    <li><a href="provider-language-fixes.csv">provider-language-fixes.csv</a></li>
    <li><a href="boss-language-talking-points.md">boss-language-talking-points.md</a></li>
  </ul>
</main>
</body>
</html>`;
}

function renderMarkdown(data) {
  return `# iBOLT Mention Language Command Deck

## Bottom Line

When iBOLT is mentioned, AI systems usually describe it with the right broad concepts: durability, specialist use, modular mounting, and security. The weak spots are exact product naming, weak citation/source support, and occasional budget/value framing.

- Mention rows: ${data.summary.mentionRows}
- Average mention quality: ${data.summary.avgMentionQuality}
- Naming review rows: ${data.summary.namingReviewRows}
- Budget/value language risk rows: ${data.summary.budgetRiskRows}
- Lost competitor rows analyzed: ${data.summary.lostRows}

## Highest Priority Language Fixes

${data.lostCountercopy.slice(0, 8).map((row, index) => `${index + 1}. ${row.category}: counter ${row.top_competitors} with ${row.copy_instruction}`).join("\n")}

## Product Naming Fix

${data.productNaming.slice(0, 8).map((row, index) => `${index + 1}. ${row.candidate}: ${row.action}`).join("\n")}
`;
}

function bossTalk(data) {
  return `# Boss Talking Points: How AI Describes iBOLT

AI systems do understand some parts of iBOLT. When iBOLT is mentioned, the strongest language is around durability, specialist use cases, modular mounting, and security. That is good.

The weak spots are:

1. Exact product names are inconsistent. Some answers invent or shorten iBOLT product names, so product cards, image alt text, FAQ answers, and schema need cleaner exact naming.
2. Some answers frame the category around budget/value language. We should avoid making iBOLT sound like the cheaper alternative and instead use commercial durability, exact fit, warranty, AMPS compatibility, and workflow-specific proof.
3. Competitors are winning with simple, repeatable terms: rugged, easy install, secure, compatible, commercial/pro, and stable. iBOLT pages need to answer those same criteria directly while naming the exact iBOLT product.

Current analysis covers ${data.summary.mentionRows} iBOLT mention rows and ${data.summary.lostRows} competitor-replacement rows.
`;
}

async function main() {
  const mentionRows = await readCsv("mention-quality-audit/mention-quality-rows.csv");
  const topicGuidanceRows = await readCsv("mention-context-playbook/topic-messaging-guidance.csv");
  const productLanguageRows = await readCsv("mention-context-playbook/product-entity-language.csv");
  const productCandidateRows = await readCsv("mention-quality-audit/product-name-candidate-audit.csv");
  const lostRows = await readCsv("answer-context-dossier/lost-answer-language.csv");
  const providerRows = await readCsv("answer-context-dossier/provider-category-context.csv");
  const competitorLanguageRows = await readCsv("mention-context-playbook/competitor-language-playbook.csv");

  const mentionScorecard = [...groupBy(mentionRows, (row) => `${row.provider}|${row.category}`).entries()]
    .map(([key, rows]) => {
      const [provider, category] = key.split("|");
      const avgQuality = rows.length
        ? Math.round(rows.reduce((sum, row) => sum + toNumber(row.mention_quality_score), 0) / rows.length)
        : 0;
      const topPickRows = rows.filter((row) => toNumber(row.top_pick_rank) === 1).length;
      const domainCitedRows = rows.filter((row) => row.target_domain_cited === "true").length;
      const namingReviewRows = rows.filter((row) => String(row.unmatched_product_names || "").trim()).length;
      const budgetRiskRows = rows.filter((row) => hasBudgetLanguage(`${row.positioning_tags}; ${row.snippet}`)).length;
      const productSignals = countList(rows, "extracted_product_names", 8) || countList(rows, "catalog_matches", 8);
      const positioning = countList(rows, "positioning_tags", 8);
      const action = [
        namingReviewRows ? "correct exact product naming" : "preserve exact product names",
        budgetRiskRows ? "remove budget/value framing" : "reinforce specialist proof",
        domainCitedRows ? "protect citation path" : "add source-ready proof and schema",
      ].join("; ");
      return {
        provider,
        category,
        mention_rows: rows.length,
        avg_quality: avgQuality,
        top_pick_rows: topPickRows,
        domain_cited_rows: domainCitedRows,
        naming_review_rows: namingReviewRows,
        budget_risk_rows: budgetRiskRows,
        positioning,
        product_signals: productSignals,
        action,
      };
    })
    .sort((a, b) => b.mention_rows - a.mention_rows || b.avg_quality - a.avg_quality);

  const lostCountercopy = [...groupBy(lostRows, (row) => row.category).entries()]
    .map(([category, rows]) => {
      const topCompetitors = countList(rows, "competitors", 8);
      const topLanguage = countList(rows, "language_patterns", 8);
      const exampleQueries = countValues(rows, "query", 8);
      const targetAngle = rows.find((row) => row.recommended_page_angle)?.recommended_page_angle || languageInstruction(category, topLanguage);
      return {
        category,
        lost_rows: rows.length,
        top_competitors: topCompetitors,
        top_language: topLanguage,
        example_queries: exampleQueries,
        copy_instruction: languageInstruction(category, topLanguage),
        target_page_angle: targetAngle,
      };
    })
    .sort((a, b) => b.lost_rows - a.lost_rows);

  const productNaming = productCandidateRows.map((row) => ({
    candidate: row.candidate,
    appearances: toNumber(row.appearances),
    match_status: row.match_status,
    best_match_score: toNumber(row.best_match_score),
    matched_title: row.matched_title,
    providers: row.providers,
    categories: row.categories,
    queries: row.queries,
    action: row.match_status === "matched"
      ? `Use the matched Shopify title consistently: ${row.matched_title}. Add this exact title to page modules, image alt text, and schema.`
      : row.action,
  })).sort((a, b) => b.appearances - a.appearances || a.best_match_score - b.best_match_score);

  const productEntityLanguage = productLanguageRows.map((row) => ({
    product: row.product,
    appearances: toNumber(row.appearances),
    providers: row.providers,
    queries: row.queries,
    categories: row.categories,
    action: row.action,
  })).sort((a, b) => b.appearances - a.appearances);

  const providerFixes = providerRows
    .map((row) => {
      const topic = topicGuidanceRows.find((topicRow) => topicRow.topic === row.category) || {};
      return {
        provider: row.provider,
        category: row.category,
        answers: toNumber(row.answers),
        mentions: toNumber(row.mentions),
        mention_rate: toNumber(row.mention_rate),
        competitor_only_rate: toNumber(row.competitor_only_rate),
        avg_score: toNumber(row.avg_score),
        first_action: topic.first_action || languageInstruction(row.category),
      };
    })
    .sort((a, b) => b.competitor_only_rate - a.competitor_only_rate || a.mention_rate - b.mention_rate);

  const competitorLanguage = competitorLanguageRows.map((row) => ({
    brand: row.brand,
    appearances: toNumber(row.raw_appearances),
    with_ibolt: toNumber(row.with_ibolt),
    without_ibolt: toNumber(row.without_ibolt),
    categories: row.categories,
    queries: row.queries,
    counter_positioning: row.counter_positioning,
  })).sort((a, b) => b.without_ibolt - a.without_ibolt);

  const avgMentionQuality = mentionRows.length
    ? Math.round(mentionRows.reduce((sum, row) => sum + toNumber(row.mention_quality_score), 0) / mentionRows.length)
    : 0;
  const namingReviewRows = mentionRows.filter((row) => String(row.unmatched_product_names || "").trim()).length;
  const budgetRiskRows = mentionRows.filter((row) => hasBudgetLanguage(`${row.positioning_tags}; ${row.snippet}`)).length;

  const summary = {
    mentionRows: mentionRows.length,
    avgMentionQuality,
    namingReviewRows,
    budgetRiskRows,
    lostRows: lostRows.length,
    productNamingCandidates: productNaming.length,
  };

  const tables = {
    mentionScorecard: renderTable(
      ["Provider", "Category", "Rows", "Avg quality", "Top-pick", "Cited", "Naming review", "Budget risk", "Positioning", "Product signals", "Action"],
      mentionScorecard.map((row) => [
        row.provider,
        row.category,
        row.mention_rows,
        row.avg_quality,
        row.top_pick_rows,
        row.domain_cited_rows,
        row.naming_review_rows,
        row.budget_risk_rows,
        short(row.positioning, 110),
        short(row.product_signals, 110),
        row.action,
      ]),
    ),
    lostCountercopy: renderTable(
      ["Category", "Lost rows", "Top competitors", "Winning language", "Example queries", "Copy instruction"],
      lostCountercopy.map((row) => [
        row.category,
        row.lost_rows,
        short(row.top_competitors, 110),
        short(row.top_language, 110),
        short(row.example_queries, 110),
        row.copy_instruction,
      ]),
    ),
    productNaming: renderTable(
      ["Candidate", "Appearances", "Status", "Best match", "Providers", "Categories", "Action"],
      productNaming.slice(0, 20).map((row) => [
        row.candidate,
        row.appearances,
        row.match_status,
        short(row.matched_title, 90),
        row.providers,
        row.categories,
        row.action,
      ]),
    ),
    providerFixes: renderTable(
      ["Provider", "Category", "Answers", "Mentions", "Mention rate", "Competitor-only", "Avg score", "First action"],
      providerFixes.slice(0, 24).map((row) => [
        row.provider,
        row.category,
        row.answers,
        row.mentions,
        `${row.mention_rate}%`,
        `${row.competitor_only_rate}%`,
        row.avg_score,
        short(row.first_action, 150),
      ]),
    ),
  };

  const categoryMentionRows = [...groupBy(mentionRows, (row) => row.category).entries()]
    .map(([category, rows]) => ({ label: category, value: rows.length, color: "#0f766e" }))
    .sort((a, b) => b.value - a.value);
  const lostCategoryRows = [...groupBy(lostRows, (row) => row.category).entries()]
    .map(([category, rows]) => ({ label: category, value: rows.length, color: "#ef4444" }))
    .sort((a, b) => b.value - a.value);

  const svgs = {
    categoryMentions: barSvg({ title: "iBOLT mention rows by category", rows: categoryMentionRows }),
    lostCategories: barSvg({ title: "Competitor replacement rows by category", rows: lostCategoryRows, color: "#ef4444" }),
  };

  const data = {
    summary,
    mentionScorecard,
    lostCountercopy,
    productNaming,
    productEntityLanguage,
    competitorLanguage,
    providerFixes,
    tables,
    svgs,
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml(data));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown(data));
  await writeFile(path.join(outDir, "boss-language-talking-points.md"), bossTalk(data));
  await writeFile(path.join(outDir, "mention-language-scorecard.csv"), csv([
    ["provider", "category", "mention_rows", "avg_quality", "top_pick_rows", "domain_cited_rows", "naming_review_rows", "budget_risk_rows", "positioning", "product_signals", "action"],
    ...mentionScorecard.map((row) => [
      row.provider,
      row.category,
      row.mention_rows,
      row.avg_quality,
      row.top_pick_rows,
      row.domain_cited_rows,
      row.naming_review_rows,
      row.budget_risk_rows,
      row.positioning,
      row.product_signals,
      row.action,
    ]),
  ]));
  await writeFile(path.join(outDir, "lost-language-countercopy.csv"), csv([
    ["category", "lost_rows", "top_competitors", "top_language", "example_queries", "copy_instruction", "target_page_angle"],
    ...lostCountercopy.map((row) => [
      row.category,
      row.lost_rows,
      row.top_competitors,
      row.top_language,
      row.example_queries,
      row.copy_instruction,
      row.target_page_angle,
    ]),
  ]));
  await writeFile(path.join(outDir, "product-entity-naming-audit.csv"), csv([
    ["candidate", "appearances", "match_status", "best_match_score", "matched_title", "providers", "categories", "queries", "action"],
    ...productNaming.map((row) => [
      row.candidate,
      row.appearances,
      row.match_status,
      row.best_match_score,
      row.matched_title,
      row.providers,
      row.categories,
      row.queries,
      row.action,
    ]),
  ]));
  await writeFile(path.join(outDir, "provider-language-fixes.csv"), csv([
    ["provider", "category", "answers", "mentions", "mention_rate", "competitor_only_rate", "avg_score", "first_action"],
    ...providerFixes.map((row) => [
      row.provider,
      row.category,
      row.answers,
      row.mentions,
      row.mention_rate,
      row.competitor_only_rate,
      row.avg_score,
      row.first_action,
    ]),
  ]));
  await writeFile(path.join(outDir, "competitor-language-counters.csv"), csv([
    ["brand", "appearances", "with_ibolt", "without_ibolt", "categories", "queries", "counter_positioning"],
    ...competitorLanguage.map((row) => [
      row.brand,
      row.appearances,
      row.with_ibolt,
      row.without_ibolt,
      row.categories,
      row.queries,
      row.counter_positioning,
    ]),
  ]));
  await writeFile(path.join(outDir, "product-entity-language.csv"), csv([
    ["product", "appearances", "providers", "queries", "categories", "action"],
    ...productEntityLanguage.map((row) => [
      row.product,
      row.appearances,
      row.providers,
      row.queries,
      row.categories,
      row.action,
    ]),
  ]));

  console.log(`Wrote ${path.join(outDir, "REPORT.html")}`);
  console.log(`Mention rows: ${summary.mentionRows}; avg quality: ${summary.avgMentionQuality}; naming review rows: ${summary.namingReviewRows}; lost rows: ${summary.lostRows}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
