#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "competitor-action-deck");

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
  const match = String(value ?? "").replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function normalizeBrand(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (/^ram(\s+mounts?)?$/i.test(text)) return "RAM Mounts";
  if (/^mount[\s-]?it!?$/i.test(text)) return "Mount-It";
  if (/^cta(\s+digital)?$/i.test(text)) return "CTA Digital";
  if (/^proclip/i.test(text)) return "ProClip";
  if (/^iottie$/i.test(text)) return "iOttie";
  return text;
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function compact(value, length = 180) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 3).trim()}...` : text;
}

function first(...values) {
  return values.find((value) => String(value ?? "").trim()) || "";
}

function addBrand(map, brandName) {
  const brand = normalizeBrand(brandName);
  if (!brand) return null;
  if (!map.has(brand)) {
    map.set(brand, {
      brand,
      tier: "",
      role: "",
      pressureScore: 0,
      answerMentions: 0,
      answerSharePct: 0,
      lostAnswers: 0,
      replacementRows: 0,
      queryCount: 0,
      providerLossRows: 0,
      coMentions: 0,
      pageCount: 0,
      promptCount: 0,
      categories: [],
      providers: [],
      lostQueries: [],
      coMentionQueries: [],
      pageTargets: [],
      products: [],
      counterPositioning: "",
      comparisonCommand: "",
      onSiteAction: "",
      offSiteAsk: "",
      successMetric: "",
      sourceWhy: "",
      languagePatterns: "",
    });
  }
  return map.get(brand);
}

function mergeList(target, values) {
  target.push(...splitList(values));
}

function defaultCounter(brand) {
  const lower = brand.toLowerCase();
  if (lower.includes("ram")) return "Keep iBOLT in RAM consideration sets by emphasizing exact workflow fit, AMPS/ball compatibility, 300+ modular parts, and restaurant, fleet, warehouse, and marine use-case specificity.";
  if (lower.includes("arkon")) return "Show where iBOLT is stronger for commercial durability, locked installs, restaurant stations, and fleet repeatability.";
  if (lower.includes("iottie")) return "Separate consumer car accessories from commercial delivery, shared vehicle, and rugged work mounting.";
  if (lower.includes("proclip")) return "Compare vehicle-specific brackets against iBOLT's modular cross-vehicle fleet deployment and standard ball/AMPS compatibility.";
  if (lower.includes("cta") || lower.includes("bouncepad") || lower.includes("mount-it")) return "Frame iBOLT around multi-tablet restaurant operations, delivery app stations, locking holders, and modular POS setups.";
  if (lower.includes("humminbird") || lower.includes("garmin") || lower.includes("lowrance") || lower.includes("scotty") || lower.includes("yakattack")) return "Clarify that iBOLT belongs in the mounting hardware/accessory decision for marine electronics, rough water, rails, and device positioning.";
  return "Add a fair comparison block that names where iBOLT should be considered and ties the answer back to exact products, use cases, materials, compatibility, and install method.";
}

function defaultOnSiteAction(brand) {
  const lower = brand.toLowerCase();
  if (lower.includes("ram")) return "Add RAM comparison modules to high-pressure fleet, restaurant, warehouse, delivery, AMPS, and fishing pages.";
  if (lower.includes("arkon")) return "Add Arkon comparison blocks to fleet, delivery, restaurant tablet, and heavy-duty vehicle mount pages.";
  if (lower.includes("iottie")) return "Add consumer versus commercial delivery-phone-mount sections on delivery and shared-vehicle pages.";
  if (lower.includes("proclip")) return "Add vehicle-specific versus fleet-standardized mounting comparison to ELD, construction vehicle, and delivery van pages.";
  if (lower.includes("cta") || lower.includes("bouncepad") || lower.includes("mount-it")) return "Strengthen restaurant tablet and POS pages with security, multi-tablet, and delivery-station comparison sections.";
  if (lower.includes("humminbird") || lower.includes("garmin") || lower.includes("lowrance")) return "Create marine accessory language that separates fish finders from the mounts that position phones, tablets, and fish finder displays.";
  return "Add competitor-specific comparison language to mapped pages where this brand appears without iBOLT.";
}

function buildDeckRows(brandMap) {
  return [...brandMap.values()]
    .map((brand) => {
      const categories = unique(brand.categories);
      const providers = unique(brand.providers);
      const pages = unique(brand.pageTargets);
      const queries = unique(brand.lostQueries);
      const coQueries = unique(brand.coMentionQueries);
      const products = unique(brand.products);
      const pressure = Math.round(
        (brand.lostAnswers || brand.replacementRows || 0) * 8
        + brand.providerLossRows * 3
        + brand.replacementRows * 5
        + brand.queryCount * 4
        + brand.answerMentions
        + brand.pageCount
        + brand.promptCount
        - brand.coMentions * 2,
      );
      const tier = brand.tier || (pressure >= 400 ? "Tier 1: primary displacement" : pressure >= 140 ? "Tier 2: recurring default" : "Tier 3: watchlist");
      const firstAction = first(brand.onSiteAction, defaultOnSiteAction(brand.brand));
      return {
        brand: brand.brand,
        tier,
        role: brand.role || "Category default or neighboring answer brand",
        pressure,
        answerMentions: brand.answerMentions,
        answerSharePct: brand.answerSharePct,
        lostAnswers: Math.max(brand.lostAnswers, brand.replacementRows),
        replacementRows: brand.replacementRows,
        queryCount: brand.queryCount,
        providerLossRows: brand.providerLossRows,
        coMentions: brand.coMentions,
        pageCount: pages.length || brand.pageCount,
        promptCount: queries.length || brand.promptCount,
        categories,
        providers,
        pages,
        queries,
        coQueries,
        products,
        counterPositioning: first(brand.counterPositioning, defaultCounter(brand.brand)),
        comparisonCommand: first(brand.comparisonCommand, `Add a fair "${brand.brand} vs iBOLT" or "where iBOLT fits" section on mapped pages.`),
        onSiteAction: firstAction,
        offSiteAsk: first(brand.offSiteAsk, "External comparison citations, partner mentions, distributor pages, and neutral category pages where this brand is already recommended."),
        successMetric: first(brand.successMetric, `Reduce ${brand.brand} competitor-only rows and create at least one iBOLT co-mention win in the next comparable benchmark.`),
        languagePatterns: brand.languagePatterns,
        sourceWhy: brand.sourceWhy,
      };
    })
    .filter((row) => row.lostAnswers || row.replacementRows || row.queryCount || row.providerLossRows || row.coMentions || row.answerMentions)
    .sort((a, b) => b.pressure - a.pressure || b.lostAnswers - a.lostAnswers || a.brand.localeCompare(b.brand));
}

function barSvg({ title, rows, valueKey, color = "#b91c1c", width = 920 }) {
  const chartRows = rows.slice(0, 12);
  const rowHeight = 36;
  const height = 78 + chartRows.length * rowHeight;
  const max = Math.max(1, ...chartRows.map((row) => toNumber(row[valueKey])));
  const bars = chartRows.map((row, index) => {
    const y = 58 + index * rowHeight;
    const value = toNumber(row[valueKey]);
    const barWidth = Math.max(3, Math.round((value / max) * (width - 370)));
    return `<g>
      <text x="22" y="${y + 17}" font-size="13" font-weight="900" fill="#111827">${escapeHtml(compact(row.brand, 34))}</text>
      <rect x="280" y="${y}" width="${width - 370}" height="22" rx="11" fill="#e5e7eb"/>
      <rect x="280" y="${y}" width="${barWidth}" height="22" rx="11" fill="${color}"/>
      <text x="${width - 34}" y="${y + 16}" text-anchor="end" font-size="13" font-weight="900" fill="#111827">${escapeHtml(value)}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#ffffff"/>
    <text x="22" y="34" font-size="20" font-weight="900" fill="#111827">${escapeHtml(title)}</text>
    ${bars}
  </svg>`;
}

function table(headers, rows) {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table>${head}${body}</table>`;
}

function card(label, value, note) {
  return `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`;
}

function renderCompetitorCards(rows) {
  return rows.slice(0, 8).map((row) => `<article class="battlecard">
    <div class="eyebrow">${escapeHtml(row.tier)}</div>
    <h3>${escapeHtml(row.brand)}</h3>
    <p><strong>Why it matters:</strong> ${escapeHtml(row.role)}. ${escapeHtml(row.lostAnswers)} replacement rows, ${escapeHtml(row.coMentions)} co-mentions, ${escapeHtml(row.promptCount)} prompt targets.</p>
    <p><strong>Counter-positioning:</strong> ${escapeHtml(row.counterPositioning)}</p>
    <p><strong>First on-site action:</strong> ${escapeHtml(row.onSiteAction)}</p>
    <p><strong>Citation ask:</strong> ${escapeHtml(row.offSiteAsk)}</p>
  </article>`).join("");
}

function renderHtml({ rows, pageRows, promptRows, offsiteRows, kpiRows }) {
  const totalReplacement = rows.reduce((sum, row) => sum + toNumber(row.replacementRows || row.lostAnswers), 0);
  const totalProviderLoss = rows.reduce((sum, row) => sum + toNumber(row.providerLossRows), 0);
  const totalCoMentions = rows.reduce((sum, row) => sum + toNumber(row.coMentions), 0);
  const tierOne = rows.filter((row) => row.tier.includes("Tier 1")).length;
  const citation = kpiRows.find((row) => row.metric === "Citation rate") || {};
  const mention = kpiRows.find((row) => row.metric === "Mention rate") || {};
  const nonBranded = kpiRows.find((row) => row.metric === "Non-branded mention") || {};
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT Competitor and Citation Action Deck</title>
  <style>
    body{margin:0;background:#f6f8fb;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1220px;margin:0 auto;padding:34px 24px 68px}
    h1{font-size:38px;line-height:1.1;margin:0 0 8px;letter-spacing:0}
    h2{font-size:23px;margin:36px 0 12px}
    h3{font-size:18px;margin:0 0 8px}
    p,li{font-size:15px;line-height:1.56;color:#334155}
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
    .battlecards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
    .battlecard{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:16px}
    .eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:900;color:#64748b;margin-bottom:8px}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 22px}
    th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    @media(max-width:980px){.cards,.grid,.battlecards{grid-template-columns:1fr}h1{font-size:31px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT Competitor and Citation Action Deck</h1>
  <p>This turns the benchmark competitor evidence into a practical action list for page edits, prompts to retest, and off-site citation work.</p>

  <div class="note">
    <strong>Citation answer:</strong> yes, citation rate is necessary to grow, especially for Google AI Overviews, Perplexity-style answers, Gemini with search, voice assistants, and shopping experiences. But the sequence matters. The current benchmark shows citation is at ${escapeHtml(citation.current || "0%")}, while mention is ${escapeHtml(mention.current || "24%")} and non-branded mention is ${escapeHtml(nonBranded.current || "5%")}. That means iBOLT first needs more inclusion and top-3 recommendation wins, then citation/source authority can compound those wins.
  </div>

  <section class="cards">
    ${card("Competitors tracked", rows.length, "Brands that replace or sit beside iBOLT in the saved benchmark.")}
    ${card("Tier 1 competitors", tierOne, "Primary displacement brands that should get comparison modules first.")}
    ${card("Replacement rows", totalReplacement, "Rows where competitors replace or dominate the answer set.")}
    ${card("Provider loss rows", totalProviderLoss, "Prompt/provider combinations where a competitor appears without enough iBOLT signal.")}
    ${card("Co-mentions", totalCoMentions, "Existing footholds where iBOLT appears beside competitors and can be upgraded.")}
  </section>

  <div class="note warn">
    <strong>Visibility read:</strong> iBOLT is visible, but broad buyer prompts still default to RAM Mounts, Arkon, iOttie, ProClip, CTA Digital, and restaurant/tablet defaults. The most useful work now is competitor displacement recovery plus source-ready pages, not a generic backlink push.
  </div>

  <section class="grid">
    <div class="chart">${barSvg({ title: "Competitor replacement pressure", rows, valueKey: "lostAnswers", color: "#b91c1c" })}</div>
    <div class="chart">${barSvg({ title: "Provider loss rows by competitor", rows, valueKey: "providerLossRows", color: "#2563eb" })}</div>
  </section>

  <h2>Priority Battlecards</h2>
  <section class="battlecards">${renderCompetitorCards(rows)}</section>

  <h2>Action Deck</h2>
  ${table(
    ["Brand", "Tier", "Replacement rows", "Co-mentions", "Categories", "First on-site action", "Off-site citation ask", "Success metric"],
    rows.slice(0, 16).map((row) => [
      row.brand,
      row.tier,
      row.lostAnswers,
      row.coMentions,
      row.categories.slice(0, 7).join("; "),
      row.onSiteAction,
      row.offSiteAsk,
      row.successMetric,
    ]),
  )}

  <h2>Page Targets</h2>
  ${table(["Brand", "Page", "Action"], pageRows.slice(0, 40).map((row) => [row.brand, row.page, row.action]))}

  <h2>Prompt Targets</h2>
  ${table(["Brand", "Prompt", "Retest reason"], promptRows.slice(0, 45).map((row) => [row.brand, row.prompt, row.reason]))}

  <h2>Off-Site Citation Tasks</h2>
  ${table(["Brand", "Citation ask", "Why", "Success metric"], offsiteRows.slice(0, 20).map((row) => [row.brand, row.ask, row.why, row.successMetric]))}
</main>
</body>
</html>`;
}

function renderMarkdown({ rows, pageRows, promptRows, offsiteRows, kpiRows }) {
  const citation = kpiRows.find((row) => row.metric === "Citation rate") || {};
  const mention = kpiRows.find((row) => row.metric === "Mention rate") || {};
  const nonBranded = kpiRows.find((row) => row.metric === "Non-branded mention") || {};
  return `# iBOLT Competitor and Citation Action Deck

Citation rate should go up, especially for AI Overviews, Perplexity-style results, Gemini with search, voice assistants, and shopping experiences. The current benchmark has citation at ${citation.current || "0%"}, mention at ${mention.current || "24%"}, and non-branded mention at ${nonBranded.current || "5%"}. Sequence: win inclusion, improve top-3 recommendation, then push citation/source authority.

## Top Competitors

${rows.slice(0, 12).map((row) => `- ${row.brand}: ${row.lostAnswers} replacement rows, ${row.coMentions} co-mentions, action: ${row.onSiteAction}`).join("\n")}

## Page Targets

${pageRows.slice(0, 30).map((row) => `- ${row.brand}: ${row.page} -> ${row.action}`).join("\n")}

## Prompt Targets

${promptRows.slice(0, 30).map((row) => `- ${row.brand}: ${row.prompt}`).join("\n")}

## Off-Site Citation Tasks

${offsiteRows.slice(0, 16).map((row) => `- ${row.brand}: ${row.ask}`).join("\n")}
`;
}

async function main() {
  const brandMap = new Map();
  const battlecards = await readCsv("competitor-comparison-dossier/competitor-battlecards.csv");
  const counterplan = await readCsv("competitor-page-counterplan/competitor-counterplan.csv");
  const share = await readCsv("competitive-share-of-answer/competitor-share-scorecard.csv");
  const reviewSummary = await readCsv("answer-review-packet/answer-review-competitor-summary.csv");
  const queryMap = await readCsv("query-loss-recovery-matrix/competitor-query-map.csv");
  const sourceRows = await readCsv("source-authority-roadmap/competitor-source-opportunities.csv");
  const kpiRows = await readCsv("boss-ai-visibility-dashboard/boss-dashboard-summary.csv");

  for (const row of [...battlecards, ...counterplan]) {
    const brand = addBrand(brandMap, row.brand);
    if (!brand) continue;
    brand.tier ||= row.tier || "";
    brand.role ||= row.role || "";
    brand.pressureScore = Math.max(brand.pressureScore, toNumber(row.pressure_score));
    brand.answerMentions = Math.max(brand.answerMentions, toNumber(row.answer_mentions || row.total_answers));
    brand.lostAnswers = Math.max(brand.lostAnswers, toNumber(row.lost_answers));
    brand.coMentions = Math.max(brand.coMentions, toNumber(row.co_mentions));
    brand.pageCount = Math.max(brand.pageCount, toNumber(row.page_count));
    brand.promptCount = Math.max(brand.promptCount, toNumber(row.prompt_count));
    mergeList(brand.categories, row.categories);
    mergeList(brand.providers, row.providers);
    mergeList(brand.lostQueries, row.lost_queries);
    mergeList(brand.coMentionQueries, row.co_mention_queries);
    mergeList(brand.pageTargets, row.page_targets);
    mergeList(brand.products, row.products);
    brand.counterPositioning ||= row.counter_positioning || "";
    brand.comparisonCommand ||= row.comparison_command || "";
    brand.onSiteAction ||= row.on_site_action || "";
    brand.offSiteAsk ||= row.off_site_ask || "";
    brand.successMetric ||= row.success_metric || "";
  }

  for (const row of share) {
    const brand = addBrand(brandMap, row.brand);
    if (!brand) continue;
    brand.answerMentions = Math.max(brand.answerMentions, toNumber(row.answer_mentions));
    brand.answerSharePct = Math.max(brand.answerSharePct, toNumber(row.answer_share_pct));
    brand.replacementRows = Math.max(brand.replacementRows, toNumber(row.competitor_only_rows));
    brand.coMentions = Math.max(brand.coMentions, toNumber(row.co_mention_rows));
    mergeList(brand.categories, row.top_categories);
    mergeList(brand.providers, row.top_providers);
    mergeList(brand.lostQueries, row.lost_queries);
    mergeList(brand.coMentionQueries, row.co_mention_queries);
    mergeList(brand.pageTargets, row.mapped_pages);
    brand.counterPositioning ||= row.counter_positioning || "";
  }

  for (const row of reviewSummary) {
    const brand = addBrand(brandMap, row.competitor);
    if (!brand) continue;
    brand.replacementRows = Math.max(brand.replacementRows, toNumber(row.replacement_rows));
  }

  for (const row of queryMap) {
    const brand = addBrand(brandMap, row.competitor);
    if (!brand) continue;
    brand.queryCount = Math.max(brand.queryCount, toNumber(row.query_count));
    brand.providerLossRows = Math.max(brand.providerLossRows, toNumber(row.provider_loss_rows));
    mergeList(brand.categories, row.categories);
    mergeList(brand.pageTargets, row.pages);
    mergeList(brand.lostQueries, row.queries);
  }

  for (const row of sourceRows) {
    const brand = addBrand(brandMap, row.brand);
    if (!brand) continue;
    brand.lostAnswers = Math.max(brand.lostAnswers, toNumber(row.lost_answers));
    brand.coMentions = Math.max(brand.coMentions, toNumber(row.co_mentioned_wins));
    mergeList(brand.categories, row.categories);
    mergeList(brand.providers, row.providers);
    brand.languagePatterns ||= row.language_patterns || "";
    mergeList(brand.lostQueries, row.example_queries);
    brand.offSiteAsk ||= row.offsite_target || "";
    brand.sourceWhy ||= row.why || "";
    brand.successMetric ||= row.success_metric || "";
  }

  const rows = buildDeckRows(brandMap);
  const pageRows = rows.flatMap((row) => row.pages.map((page) => ({
    brand: row.brand,
    page,
    action: row.onSiteAction,
    counterPositioning: row.counterPositioning,
  })));
  const promptRows = rows.flatMap((row) => row.queries.map((prompt) => ({
    brand: row.brand,
    prompt,
    reason: row.successMetric,
  })));
  const offsiteRows = rows.map((row) => ({
    brand: row.brand,
    ask: row.offSiteAsk,
    why: row.sourceWhy || `${row.brand} appears in competitor-only or co-mention answer sets where iBOLT needs authority support.`,
    successMetric: row.successMetric,
  }));

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml({ rows, pageRows, promptRows, offsiteRows, kpiRows }));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown({ rows, pageRows, promptRows, offsiteRows, kpiRows }));
  await writeFile(path.join(outDir, "competitor-action-deck.csv"), csv([
    ["brand", "tier", "role", "pressure_score", "replacement_rows", "provider_loss_rows", "co_mentions", "page_count", "prompt_count", "categories", "providers", "counter_positioning", "on_site_action", "off_site_citation_ask", "success_metric"],
    ...rows.map((row) => [
      row.brand,
      row.tier,
      row.role,
      row.pressure,
      row.lostAnswers,
      row.providerLossRows,
      row.coMentions,
      row.pageCount,
      row.promptCount,
      row.categories.join("; "),
      row.providers.join("; "),
      row.counterPositioning,
      row.onSiteAction,
      row.offSiteAsk,
      row.successMetric,
    ]),
  ]));
  await writeFile(path.join(outDir, "competitor-page-actions.csv"), csv([
    ["brand", "page", "action", "counter_positioning"],
    ...pageRows.map((row) => [row.brand, row.page, row.action, row.counterPositioning]),
  ]));
  await writeFile(path.join(outDir, "competitor-prompt-actions.csv"), csv([
    ["brand", "prompt", "retest_reason"],
    ...promptRows.map((row) => [row.brand, row.prompt, row.reason]),
  ]));
  await writeFile(path.join(outDir, "competitor-offsite-actions.csv"), csv([
    ["brand", "citation_ask", "why", "success_metric"],
    ...offsiteRows.map((row) => [row.brand, row.ask, row.why, row.successMetric]),
  ]));

  console.log(`Wrote ${outDir}`);
  console.log(`Competitors: ${rows.length}`);
  console.log(`Page actions: ${pageRows.length}`);
  console.log(`Prompt actions: ${promptRows.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
