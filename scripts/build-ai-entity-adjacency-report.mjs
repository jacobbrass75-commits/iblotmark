#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "entity-adjacency-report");

const knownCompetitors = [
  "RAM Mounts",
  "ProClip",
  "Arkon",
  "iOttie",
  "CTA Digital",
  "Mount-It",
  "Bouncepad",
  "Havis",
  "Tackform",
  "Square",
  "Heckler",
  "Kensington",
  "Garmin",
  "Humminbird",
  "Lowrance",
  "YakAttack",
  "Scotty",
  "Peak Design",
  "Scosche",
  "Zebra",
  "Lamicall",
  "Belkin",
  "LISEN",
];

async function readCsv(relativePath) {
  try {
    return parseCsv(await readFile(path.join(benchmarkDir, relativePath), "utf8"));
  } catch {
    return [];
  }
}

async function readMaybe(relativePath) {
  try {
    return await readFile(path.join(benchmarkDir, relativePath), "utf8");
  } catch {
    return "";
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

function pct(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

function toNumber(value) {
  const match = String(value ?? "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeProvider(value) {
  const key = String(value ?? "").toLowerCase();
  if (key.includes("claude")) return "Claude";
  if (key.includes("gemini")) return "Gemini";
  if (key.includes("chatgpt") || key.includes("openai")) return "ChatGPT";
  return value || "Unknown";
}

function normalizeCompetitor(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (/^ram$/i.test(text) || /^ram mounts?$/i.test(text)) return "RAM Mounts";
  if (/^mount[\s-]?it!?$/i.test(text)) return "Mount-It";
  if (/^cta$/i.test(text) || /^cta digital$/i.test(text)) return "CTA Digital";
  if (/^peak design$/i.test(text)) return "Peak Design";
  if (/^ibolt$/i.test(text) || /^i bolt$/i.test(text)) return "iBOLT";
  return text.replace(/\s+\d+$/g, "");
}

function uniq(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function rawAnswer(markdown) {
  const parts = String(markdown ?? "").split(/## Raw Answer/i);
  return (parts[1] || markdown || "").trim();
}

function answerPath(row) {
  const file = row.answer_file || "";
  if (!file) return "";
  if (file.startsWith("answer-evidence-pack/")) return file;
  if (file.startsWith("answers/")) return `answer-evidence-pack/${file}`;
  return file;
}

function brandRegex(brand) {
  if (brand === "RAM Mounts") return /\bRAM(?:\s+Mounts?)?\b/i;
  if (brand === "iBOLT") return /\bi\s?BOLT\b/i;
  return new RegExp(`\\b${escapeRegExp(brand).replaceAll("\\ ", "\\s+")}\\b`, "i");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findRank(text, brand) {
  const regex = brandRegex(brand);
  const lines = String(text ?? "").split(/\n+/);
  for (const line of lines) {
    const match = line.match(/^\s*(\d{1,2})[.)]\s+/);
    if (match && regex.test(line)) return Number(match[1]);
  }
  const compact = lines.join("\n");
  for (let rank = 1; rank <= 12; rank += 1) {
    const pattern = new RegExp(`(?:^|\\n)\\s*${rank}[.)]\\s+[^\\n]{0,120}${regex.source}`, "i");
    if (pattern.test(compact)) return rank;
  }
  return null;
}

function firstMentionSnippet(text, brands) {
  const source = String(text ?? "").replace(/\s+/g, " ").trim();
  let bestIndex = -1;
  let bestBrand = "";
  for (const brand of brands) {
    const match = source.match(brandRegex(brand));
    if (match && (bestIndex === -1 || match.index < bestIndex)) {
      bestIndex = match.index;
      bestBrand = brand;
    }
  }
  if (bestIndex === -1) return "";
  const start = Math.max(0, bestIndex - 170);
  const end = Math.min(source.length, bestIndex + 320);
  return `${start > 0 ? "..." : ""}${source.slice(start, end)}${end < source.length ? "..." : ""}`.trim();
}

function detectCompetitors(row, text) {
  const fromRow = splitList(row.competitors).map(normalizeCompetitor);
  const fromText = knownCompetitors.filter((brand) => brandRegex(brand).test(text));
  return uniq([...fromRow, ...fromText].filter((brand) => brand && brand !== "iBOLT"));
}

function roleFor({ brandMentioned, competitors, iboltRank, competitorRanks }) {
  if (!brandMentioned && competitors.length) return "competitor_replacement";
  if (!brandMentioned) return "no_signal";
  if (!competitors.length) return "clean_ibolt_only";
  const bestCompetitorRank = Math.min(...competitorRanks.filter((rank) => Number.isFinite(rank)));
  if (Number.isFinite(bestCompetitorRank) && Number.isFinite(iboltRank) && iboltRank > bestCompetitorRank) {
    return "ibolt_trailing_competitors";
  }
  if (Number.isFinite(iboltRank) && iboltRank === 1) return "ibolt_leader_with_competitors";
  return "ibolt_co_mentioned";
}

function roleLabel(role) {
  return {
    clean_ibolt_only: "Clean iBOLT answer",
    ibolt_leader_with_competitors: "iBOLT leads with competitors",
    ibolt_co_mentioned: "iBOLT co-mentioned",
    ibolt_trailing_competitors: "iBOLT trails competitors",
    competitor_replacement: "Competitor replacement",
    no_signal: "No useful signal",
  }[role] || role;
}

function roleScore(role) {
  return {
    clean_ibolt_only: 5,
    ibolt_leader_with_competitors: 4,
    ibolt_co_mentioned: 3,
    ibolt_trailing_competitors: 2,
    no_signal: 1,
    competitor_replacement: 0,
  }[role] ?? 0;
}

function recommendationFromRole(role) {
  if (role === "competitor_replacement") return "Build answer-first page blocks that name iBOLT beside the replacement brands and explain the exact buyer use case where iBOLT belongs.";
  if (role === "ibolt_trailing_competitors") return "Add direct comparison copy so iBOLT is not an afterthought behind RAM, Arkon, ProClip, iOttie, or other defaults.";
  if (role === "ibolt_co_mentioned") return "Strengthen iBOLT's specialist reason-to-rank with product modules, proof points, and FAQs.";
  if (role === "ibolt_leader_with_competitors") return "Preserve the winning phrasing and add citation-ready source structure.";
  if (role === "clean_ibolt_only") return "Preserve entity phrasing and push citations after page cleanup.";
  return "Map the prompt to the closest live page and add explicit product/category language.";
}

function competitorAngle(brand) {
  if (brand === "RAM Mounts") return "RAM wins as the broad rugged default. Counter with iBOLT's application-specific kits, AMPS compatibility, and commercial workflows.";
  if (brand === "Arkon") return "Arkon wins in generic vehicle and phone-holder lists. Counter with iBOLT's commercial-duty bases, locking choices, and exact install methods.";
  if (brand === "iOttie") return "iOttie wins as a consumer car-phone default. Counter with delivery, fleet, charging, and shared-vehicle use cases.";
  if (brand === "ProClip") return "ProClip wins custom-fit vehicle language. Counter with iBOLT's modular AMPS path, drill-base options, and fleet transferability.";
  if (brand === "CTA Digital" || brand === "Bouncepad" || brand === "Mount-It" || brand === "Heckler") return "This brand appears in tablet/POS contexts. Counter with Tablet Tower, LockPro, Dock'n Lock, and multi-tablet restaurant workflows.";
  if (brand === "Havis" || brand === "Zebra") return "This brand appears in warehouse and rugged-enterprise contexts. Counter with forklift, scanner, tablet, and no-drill mounting specifics.";
  if (brand === "Garmin" || brand === "Humminbird" || brand === "Lowrance" || brand === "YakAttack" || brand === "Scotty") return "This brand appears in fishing contexts. Clarify that iBOLT solves the mounting system, plate, arm, rail, and rough-water placement problem.";
  return "Name this brand in fair comparison copy and give the exact iBOLT use case where iBOLT should be recommended.";
}

function groupCounts(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function renderTable(headers, rows) {
  return `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function renderBars(title, rows, valueKey) {
  const max = Math.max(1, ...rows.map((row) => row[valueKey]));
  return `<section class="bars"><h3>${escapeHtml(title)}</h3>${rows.slice(0, 12).map((row) => {
    const width = Math.round((row[valueKey] / max) * 100);
    return `<div class="bar-row"><span>${escapeHtml(row.label)}</span><div class="track"><div class="fill" style="width:${width}%"></div></div><strong>${escapeHtml(row[valueKey])}</strong></div>`;
  }).join("")}</section>`;
}

async function buildRows(results, mentionRows, lostRows) {
  const mentionByKey = new Map(mentionRows.map((row) => [`${normalizeProvider(row.provider)}||${row.query}`, row]));
  const lostByKey = new Map(lostRows.map((row) => [`${normalizeProvider(row.provider)}||${row.query}`, row]));
  const rows = [];
  for (const result of results) {
    const provider = normalizeProvider(result.provider);
    const answer = rawAnswer(await readMaybe(answerPath(result)));
    const competitors = detectCompetitors(result, answer);
    const competitorRanks = competitors.map((brand) => findRank(answer, brand)).filter((rank) => rank !== null);
    const iboltRank = findRank(answer, "iBOLT") ?? (result.top_pick_rank ? toNumber(result.top_pick_rank) : null);
    const brandMentioned = String(result.brand_mentioned).toLowerCase() === "true" || brandRegex("iBOLT").test(answer);
    const role = roleFor({ brandMentioned, competitors, iboltRank, competitorRanks });
    const key = `${provider}||${result.query}`;
    const mention = mentionByKey.get(key) || {};
    const lost = lostByKey.get(key) || {};
    rows.push({
      provider,
      query: result.query,
      category: result.category,
      coverageScore: toNumber(result.coverage_score),
      brandMentioned,
      domainCited: String(result.domain_cited).toLowerCase() === "true",
      topPickRank: iboltRank || "",
      role,
      roleLabel: roleLabel(role),
      roleScore: roleScore(role),
      competitors,
      coMentioned: brandMentioned ? competitors : [],
      replacements: brandMentioned ? [] : competitors,
      outrankingCompetitors: competitors.filter((brand) => {
        const rank = findRank(answer, brand);
        return brandMentioned && Number.isFinite(rank) && Number.isFinite(iboltRank) && rank < iboltRank;
      }),
      positioningSignals: splitList(mention.positioning_signals),
      languagePatterns: splitList(mention.language_patterns || lost.language_patterns),
      productSignals: splitList(mention.product_signals || result.mentioned_products),
      snippet: firstMentionSnippet(answer, brandMentioned ? ["iBOLT", ...competitors] : competitors),
      recommendation: recommendationFromRole(role),
      answerFile: answerPath(result),
    });
  }
  return rows;
}

function buildCompetitorRows(rows) {
  const competitors = uniq(rows.flatMap((row) => row.competitors));
  return competitors.map((brand) => {
    const co = rows.filter((row) => row.brandMentioned && row.competitors.includes(brand));
    const replacement = rows.filter((row) => !row.brandMentioned && row.competitors.includes(brand));
    const outranks = rows.filter((row) => row.outrankingCompetitors.includes(brand));
    return {
      label: brand,
      coMentions: co.length,
      replacements: replacement.length,
      outranks: outranks.length,
      categories: uniq(rows.filter((row) => row.competitors.includes(brand)).map((row) => row.category)).join("; "),
      providers: uniq(rows.filter((row) => row.competitors.includes(brand)).map((row) => row.provider)).join("; "),
      angle: competitorAngle(brand),
    };
  }).sort((a, b) => (b.replacements + b.outranks * 2 + b.coMentions) - (a.replacements + a.outranks * 2 + a.coMentions));
}

function buildProviderCategoryRows(rows) {
  const groups = groupCounts(rows, (row) => `${row.provider}||${row.category}`);
  return [...groups.entries()].map(([key, group]) => {
    const [provider, category] = key.split("||");
    return {
      provider,
      category,
      answers: group.length,
      clean: group.filter((row) => row.role === "clean_ibolt_only").length,
      leader: group.filter((row) => row.role === "ibolt_leader_with_competitors").length,
      coMention: group.filter((row) => row.role === "ibolt_co_mentioned").length,
      trailing: group.filter((row) => row.role === "ibolt_trailing_competitors").length,
      replacement: group.filter((row) => row.role === "competitor_replacement").length,
      noSignal: group.filter((row) => row.role === "no_signal").length,
      avgRoleScore: Math.round(group.reduce((sum, row) => sum + row.roleScore, 0) / group.length),
      topCompetitors: topCompetitors(group).slice(0, 5).map((row) => `${row.brand} ${row.count}`).join("; "),
    };
  }).sort((a, b) => b.replacement - a.replacement || a.provider.localeCompare(b.provider));
}

function topCompetitors(rows) {
  const counts = new Map();
  for (const brand of rows.flatMap((row) => row.competitors)) {
    counts.set(brand, (counts.get(brand) || 0) + 1);
  }
  return [...counts.entries()].map(([brand, count]) => ({ brand, count })).sort((a, b) => b.count - a.count || a.brand.localeCompare(b.brand));
}

function renderHtml({ rows, competitorRows, providerCategoryRows }) {
  const total = rows.length;
  const mention = rows.filter((row) => row.brandMentioned).length;
  const replacement = rows.filter((row) => row.role === "competitor_replacement").length;
  const trailing = rows.filter((row) => row.role === "ibolt_trailing_competitors").length;
  const cleanOrLeader = rows.filter((row) => row.role === "clean_ibolt_only" || row.role === "ibolt_leader_with_competitors").length;
  const roleRows = [...groupCounts(rows, (row) => row.roleLabel).entries()]
    .map(([label, group]) => ({ label, count: group.length }))
    .sort((a, b) => b.count - a.count);
  const providerRows = [...groupCounts(rows, (row) => row.provider).entries()]
    .map(([label, group]) => ({ label, count: group.filter((row) => row.role === "competitor_replacement").length }))
    .sort((a, b) => b.count - a.count);
  const sampleRows = rows
    .filter((row) => row.role === "ibolt_trailing_competitors" || row.role === "competitor_replacement" || row.role === "ibolt_leader_with_competitors")
    .sort((a, b) => a.roleScore - b.roleScore || b.competitors.length - a.competitors.length)
    .slice(0, 18)
    .map((row) => [row.provider, row.category, row.query, row.roleLabel, row.competitors.slice(0, 5).join("; "), row.snippet.slice(0, 320), row.recommendation]);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT AI Entity Adjacency Report</title>
  <style>
    body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1220px;margin:0 auto;padding:34px 24px 64px}
    h1{font-size:36px;margin:0 0 8px}
    h2{font-size:23px;margin:34px 0 12px}
    h3{font-size:17px;margin:0 0 12px}
    p,li{line-height:1.55;color:#334155;font-size:15px}
    .note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #0f766e;border-radius:12px;padding:16px 18px;margin:20px 0}
    .cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:22px 0}
    .card,.bars{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:16px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:800}
    .value{font-size:30px;font-weight:900;margin:8px 0;color:#0f172a}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    .bar-row{display:grid;grid-template-columns:190px 1fr 42px;gap:10px;align-items:center;margin:9px 0;font-size:13px}
    .track{height:16px;background:#e5e7eb;border-radius:999px;overflow:hidden}
    .fill{height:16px;background:#0f766e;border-radius:999px}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 22px}
    th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    a{color:#0f766e;overflow-wrap:anywhere}
    @media(max-width:900px){.cards,.grid{grid-template-columns:1fr}.bar-row{grid-template-columns:1fr}h1{font-size:30px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT AI Entity Adjacency Report</h1>
  <p>This report classifies each saved AI answer by iBOLT's role: clean recommendation, leader with competitors, co-mention, trailing mention, competitor replacement, or no useful signal.</p>
  <div class="note"><strong>What this adds:</strong> the benchmark already showed mention rate. This digs into answer position and adjacency, which tells us whether iBOLT is being recommended, merely included, or displaced by competitor defaults.</div>
  <section class="cards">
    <div class="card"><div class="label">Answers analyzed</div><div class="value">${total}</div><p>Saved OpenRouter answer files.</p></div>
    <div class="card"><div class="label">Mention rate</div><div class="value">${pct(mention, total)}%</div><p>${mention}/${total} answers mention iBOLT.</p></div>
    <div class="card"><div class="label">Clean or leading</div><div class="value">${cleanOrLeader}</div><p>iBOLT appears as the clean answer or top-ranked with competitors.</p></div>
    <div class="card"><div class="label">Replacement pressure</div><div class="value">${replacement}</div><p>Competitor answers without iBOLT.</p></div>
  </section>
  <section class="grid">
    ${renderBars("Answer roles", roleRows, "count")}
    ${renderBars("Competitor replacements by provider", providerRows, "count")}
  </section>
  <h2>Competitor Adjacency</h2>
  ${renderTable(["Competitor", "Co-mentions", "Replacements", "Outranks iBOLT", "Categories", "Providers", "Counter angle"], competitorRows.slice(0, 14).map((row) => [row.label, row.coMentions, row.replacements, row.outranks, row.categories, row.providers, row.angle]))}
  <h2>Provider And Category Matrix</h2>
  ${renderTable(["Provider", "Category", "Answers", "Clean", "Leader", "Co-mention", "Trailing", "Replacement", "No signal", "Top competitors"], providerCategoryRows.map((row) => [row.provider, row.category, row.answers, row.clean, row.leader, row.coMention, row.trailing, row.replacement, row.noSignal, row.topCompetitors]))}
  <h2>Answer Evidence Samples</h2>
  ${renderTable(["Provider", "Category", "Query", "Role", "Competitors", "Snippet", "Action"], sampleRows)}
</main>
</body>
</html>`;
}

function renderMarkdown({ rows, competitorRows, providerCategoryRows }) {
  const total = rows.length;
  const mention = rows.filter((row) => row.brandMentioned).length;
  const replacement = rows.filter((row) => row.role === "competitor_replacement").length;
  const trailing = rows.filter((row) => row.role === "ibolt_trailing_competitors").length;
  const cleanOrLeader = rows.filter((row) => row.role === "clean_ibolt_only" || row.role === "ibolt_leader_with_competitors").length;
  return `# iBOLT AI Entity Adjacency Report

## Summary

- Answers analyzed: ${total}
- iBOLT mention rate: ${pct(mention, total)}% (${mention}/${total})
- Clean or leading iBOLT answers: ${cleanOrLeader}
- iBOLT trailing competitors: ${trailing}
- Competitor replacements: ${replacement}

## Top Competitor Adjacency

| Competitor | Co-mentions | Replacements | Outranks iBOLT | Counter angle |
| --- | ---: | ---: | ---: | --- |
${competitorRows.slice(0, 14).map((row) => `| ${row.label} | ${row.coMentions} | ${row.replacements} | ${row.outranks} | ${row.angle} |`).join("\n")}

## Provider And Category Matrix

| Provider | Category | Answers | Clean | Leader | Co-mention | Trailing | Replacement | No signal | Top competitors |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
${providerCategoryRows.map((row) => `| ${row.provider} | ${row.category} | ${row.answers} | ${row.clean} | ${row.leader} | ${row.coMention} | ${row.trailing} | ${row.replacement} | ${row.noSignal} | ${row.topCompetitors} |`).join("\n")}
`;
}

async function main() {
  const results = await readCsv("results.csv");
  const mentionRows = await readCsv("answer-context-dossier/ibolt-mention-context.csv");
  const lostRows = await readCsv("answer-context-dossier/lost-answer-language.csv");
  const rows = await buildRows(results, mentionRows, lostRows);
  const competitorRows = buildCompetitorRows(rows);
  const providerCategoryRows = buildProviderCategoryRows(rows);

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "answer-role-ledger.csv"), csv([
    ["provider", "query", "category", "coverage_score", "brand_mentioned", "domain_cited", "top_pick_rank", "answer_role", "competitors", "co_mentioned_competitors", "replacement_competitors", "outranking_competitors", "positioning_signals", "language_patterns", "product_signals", "snippet", "recommendation", "answer_file"],
    ...rows.map((row) => [row.provider, row.query, row.category, row.coverageScore, row.brandMentioned, row.domainCited, row.topPickRank, row.roleLabel, row.competitors.join("; "), row.coMentioned.join("; "), row.replacements.join("; "), row.outrankingCompetitors.join("; "), row.positioningSignals.join("; "), row.languagePatterns.join("; "), row.productSignals.join("; "), row.snippet, row.recommendation, row.answerFile]),
  ]));
  await writeFile(path.join(outDir, "competitor-adjacency-matrix.csv"), csv([
    ["competitor", "co_mentions", "replacements", "outranks_ibolt", "categories", "providers", "counter_angle"],
    ...competitorRows.map((row) => [row.label, row.coMentions, row.replacements, row.outranks, row.categories, row.providers, row.angle]),
  ]));
  await writeFile(path.join(outDir, "provider-category-role-matrix.csv"), csv([
    ["provider", "category", "answers", "clean_ibolt_only", "ibolt_leader_with_competitors", "ibolt_co_mentioned", "ibolt_trailing_competitors", "competitor_replacements", "no_signal", "avg_role_score", "top_competitors"],
    ...providerCategoryRows.map((row) => [row.provider, row.category, row.answers, row.clean, row.leader, row.coMention, row.trailing, row.replacement, row.noSignal, row.avgRoleScore, row.topCompetitors]),
  ]));
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml({ rows, competitorRows, providerCategoryRows }));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown({ rows, competitorRows, providerCategoryRows }));

  console.log(`Wrote ${outDir}`);
  console.log(`Answers analyzed: ${rows.length}`);
  console.log(`Competitor replacements: ${rows.filter((row) => row.role === "competitor_replacement").length}`);
  console.log(`Competitors tracked: ${competitorRows.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
