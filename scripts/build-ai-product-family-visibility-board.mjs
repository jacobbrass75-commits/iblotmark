#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "product-family-visibility-board");

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
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const match = String(value ?? "").replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
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

function compact(value, length = 170) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 3).trim()}...` : text;
}

function normalize(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function familyKey(value) {
  return String(value ?? "").trim();
}

function addFamily(map, familyName) {
  const family = familyKey(familyName);
  if (!family) return null;
  if (!map.has(family)) {
    map.set(family, {
      family,
      lane: "",
      priority: 0,
      bridgePriority: 0,
      familyGapScore: 0,
      promptCoverage: 0,
      topicPromptCoverage: 0,
      unlinkedProducts: 0,
      competitorOnlyAnswers: 0,
      ctaRiskPages: 0,
      topics: [],
      keywords: [],
      sampleProducts: [],
      targetPages: [],
      action: "",
      testAction: "",
      answerRows: 0,
      cleanRows: 0,
      coMentionRows: 0,
      replacementRows: 0,
      answerProductSignalRows: 0,
      catalogProductRows: 0,
      productNameRiskRows: 0,
      riskyNames: [],
      pageActionRows: [],
      promptRows: [],
      competitors: [],
    });
  }
  return map.get(family);
}

function mergeList(target, value) {
  target.push(...splitList(value));
}

function familyKeywords(family) {
  const explicit = splitList(family.keywords.join("; "));
  if (explicit.length) {
    return unique(explicit.map(normalize).filter((keyword) => keyword.length >= 4)).slice(0, 60);
  }
  const text = normalize([
    family.family,
    family.topics.join(" "),
    family.sampleProducts.join(" "),
    explicit.join(" "),
  ].join(" "));
  const tokens = text
    .split(/\s+/)
    .filter((token) => token.length >= 4)
    .filter((token) => !["ibolt", "with", "mount", "mounts", "heavy", "duty", "compatible", "industry", "standard", "great"].includes(token));
  return unique([...explicit.map(normalize), ...tokens]).slice(0, 60);
}

function rowMatchesFamily(rowText, keywords) {
  const text = normalize(rowText);
  return keywords.some((keyword) => keyword.length >= 4 && text.includes(keyword));
}

function inferFamilyAction(family) {
  const lower = family.family.toLowerCase();
  if (lower.includes("amps")) return "Build AMPS entity modules: plate, ball size, socket arm, drill base, clamp base, and compatibility language on high-risk pages.";
  if (lower.includes("streaming") || lower.includes("creator")) return "Add creator rig modules for overhead, table camera, product photography, and live streaming prompts.";
  if (lower.includes("fleet") || lower.includes("vehicle")) return "Add exact commercial phone and ELD mount modules to delivery, work truck, Amazon Flex, and fleet pages.";
  if (lower.includes("restaurant")) return "Add Tablet Tower, LockPro, Dock'n Lock, wall mount, clamp mount, and keyed-security decision tables.";
  if (lower.includes("forklift") || lower.includes("warehouse")) return "Add forklift pillar, VESA, scanner holder, vibration, Zebra/Honeywell, and no-drill install modules.";
  if (lower.includes("marine") || lower.includes("fish")) return "Add fish finder and marine electronics modules naming Garmin, Lowrance, Humminbird, rails, plates, and rough-water positioning.";
  if (lower.includes("charging") || lower.includes("magnetic")) return "Add charging, MagSafe/Qi, NFC, dualMag, and phone-uptime modules on delivery and fleet pages.";
  return family.action || "Add exact product modules with verified titles, images, prices, use cases, and retest prompts.";
}

function buildRows(familyMap) {
  return [...familyMap.values()].map((family) => {
    const keywords = familyKeywords(family);
    const signalGap = Math.max(0, family.promptCoverage - family.answerProductSignalRows);
    const score = Math.round(
      family.priority
      + family.bridgePriority
      + family.familyGapScore
      + family.unlinkedProducts * 12
      + family.competitorOnlyAnswers * 10
      + family.productNameRiskRows * 18
      + signalGap * 6
      + family.ctaRiskPages * 3,
    );
    let lane = family.lane || "Product linking sprint";
    if (family.productNameRiskRows >= 5) lane = "Product-name cleanup first";
    if (/amps|creator|streaming/i.test(family.family) && family.unlinkedProducts >= 20) lane = family.lane || "Core entity reinforcement";
    return {
      ...family,
      lane,
      score,
      keywords,
      topics: unique(family.topics),
      sampleProducts: unique(family.sampleProducts),
      targetPages: unique(family.targetPages),
      pageActionRows: family.pageActionRows,
      promptRows: unique(family.promptRows),
      competitors: unique(family.competitors),
      riskyNames: unique(family.riskyNames),
      action: family.action || inferFamilyAction(family),
      testAction: family.testAction || "Retest mapped product-family prompts after exact product modules are live.",
    };
  }).filter((family) => family.family).sort((a, b) => b.score - a.score || a.family.localeCompare(b.family));
}

function barSvg({ title, rows, valueKey, color = "#0f766e", width = 900 }) {
  const chartRows = rows.slice(0, 12);
  const rowHeight = 36;
  const height = 78 + chartRows.length * rowHeight;
  const max = Math.max(1, ...chartRows.map((row) => toNumber(row[valueKey])));
  const bars = chartRows.map((row, index) => {
    const y = 58 + index * rowHeight;
    const value = toNumber(row[valueKey]);
    const barWidth = Math.max(3, Math.round((value / max) * (width - 370)));
    return `<g>
      <text x="22" y="${y + 17}" font-size="13" font-weight="900" fill="#111827">${escapeHtml(compact(row.family, 34))}</text>
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

function renderHtml({ rows, pageRows, promptRows, riskRows }) {
  const totalUnlinked = rows.reduce((sum, row) => sum + row.unlinkedProducts, 0);
  const totalCompetitorOnly = rows.reduce((sum, row) => sum + row.competitorOnlyAnswers, 0);
  const totalRisk = rows.reduce((sum, row) => sum + row.productNameRiskRows, 0);
  const signalRows = rows.reduce((sum, row) => sum + row.answerProductSignalRows, 0);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT Product Family AI Visibility Board</title>
  <style>
    body{margin:0;background:#f6f8fb;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1220px;margin:0 auto;padding:34px 24px 68px}
    h1{font-size:38px;line-height:1.1;margin:0 0 8px;letter-spacing:0}
    h2{font-size:23px;margin:36px 0 12px}
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
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 22px}
    th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    @media(max-width:980px){.cards,.grid{grid-template-columns:1fr}h1{font-size:31px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT Product Family AI Visibility Board</h1>
  <p>This board connects AI visibility losses to exact iBOLT product families, page modules, risky product names, and retest prompts.</p>

  <div class="note">
    <strong>Current read:</strong> AI answers are not just missing the iBOLT brand. They are also weak on exact product-family entities. The biggest gaps are AMPS/adapters, creator and camera mounts, vehicle phone mounts, restaurant tablet security, charging docks, forklift/warehouse, and marine/fish-finder mounts.
  </div>

  <section class="cards">
    ${card("Families scored", rows.length, "Product families joined from product coverage, conversion bridge, page queues, and answer evidence.")}
    ${card("Unlinked products", totalUnlinked, "Catalog products that need stronger blog modules or internal links.")}
    ${card("Competitor-only rows", totalCompetitorOnly, "Family-level benchmark pressure tied to competitor answers.")}
    ${card("Product signal rows", signalRows, "Saved AI answers with matching product-family signal.")}
    ${card("Name-risk rows", totalRisk, "AI-visible risky aliases that need suppression or exact-title replacement.")}
  </section>

  <div class="note warn">
    <strong>Execution rule:</strong> do not add vague product cards. Use exact Shopify titles, URLs, images, price, use case, compatibility, and one restrained View Product CTA per module. Product-name cleanup should happen before retesting product-entity prompts.
  </div>

  <section class="grid">
    <div class="chart">${barSvg({ title: "Product-family AI gap score", rows, valueKey: "score", color: "#b91c1c" })}</div>
    <div class="chart">${barSvg({ title: "Unlinked products by family", rows, valueKey: "unlinkedProducts", color: "#2563eb" })}</div>
  </section>

  <h2>Family Priority Board</h2>
  ${table(
    ["Rank", "Family", "Lane", "Score", "Unlinked", "Competitor-only", "Answer product signals", "Name risk", "Action"],
    rows.map((row, index) => [
      index + 1,
      row.family,
      row.lane,
      row.score,
      row.unlinkedProducts,
      row.competitorOnlyAnswers,
      row.answerProductSignalRows,
      row.productNameRiskRows,
      row.action,
    ]),
  )}

  <h2>Page Module Targets</h2>
  ${table(
    ["Family", "Page", "Priority", "Products", "Competitors", "Action"],
    pageRows.slice(0, 60).map((row) => [
      row.family,
      row.page,
      row.priority,
      row.products,
      row.competitors,
      row.action,
    ]),
  )}

  <h2>Prompt Retest Map</h2>
  ${table(
    ["Family", "Prompt", "Reason"],
    promptRows.slice(0, 70).map((row) => [row.family, row.prompt, row.reason]),
  )}

  <h2>Product Name Risk</h2>
  ${table(
    ["Family", "Risky name", "Matched title", "Providers", "Action"],
    riskRows.slice(0, 40).map((row) => [row.family, row.candidate, row.matchedTitle, row.providers, row.action]),
  )}
</main>
</body>
</html>`;
}

function renderMarkdown({ rows, pageRows, riskRows }) {
  return `# iBOLT Product Family AI Visibility Board

AI answers are weak on exact iBOLT product-family entities, not only the brand name. The first product-family priorities are:

${rows.slice(0, 12).map((row, index) => `${index + 1}. ${row.family}: score ${row.score}, ${row.unlinkedProducts} unlinked products, ${row.competitorOnlyAnswers} competitor-only rows. Action: ${row.action}`).join("\n")}

## Page Module Targets

${pageRows.slice(0, 25).map((row) => `- ${row.family}: ${row.page}. ${row.action}`).join("\n")}

## Product Name Risks

${riskRows.slice(0, 20).map((row) => `- ${row.family}: suppress or replace "${row.candidate}" with "${row.matchedTitle}".`).join("\n")}
`;
}

async function main() {
  const familyMap = new Map();
  const familyCoverage = await readCsv("product-entity-coverage-plan/product-family-coverage-summary.csv");
  const conversionBridge = await readCsv("product-conversion-visibility-bridge/product-family-visibility-bridge.csv");
  const spreadPriority = await readCsv("portfolio-product-spread-analysis/product-family-spread-priority.csv");
  const workQueue = await readCsv("product-entity-coverage-plan/product-entity-work-queue.csv");
  const answerRows = await readCsv("answer-evidence-viewer/answer-evidence-ledger.csv");
  const riskRowsRaw = await readCsv("product-name-truth-table/product-name-truth-table.csv");

  for (const row of familyCoverage) {
    const family = addFamily(familyMap, row.family);
    if (!family) continue;
    family.priority = Math.max(family.priority, toNumber(row.priority));
    family.unlinkedProducts = Math.max(family.unlinkedProducts, toNumber(row.unlinked_products));
    mergeList(family.topics, row.topics);
    mergeList(family.sampleProducts, row.sample_products);
    mergeList(family.targetPages, row.target_pages);
    family.action ||= row.action || "";
  }

  for (const row of conversionBridge) {
    const family = addFamily(familyMap, row.family);
    if (!family) continue;
    family.bridgePriority = Math.max(family.bridgePriority, toNumber(row.bridge_priority));
    family.unlinkedProducts = Math.max(family.unlinkedProducts, toNumber(row.unlinked_products));
    family.ctaRiskPages = Math.max(family.ctaRiskPages, toNumber(row.cta_risk_pages));
    family.competitorOnlyAnswers = Math.max(family.competitorOnlyAnswers, toNumber(row.competitor_only_answers));
    mergeList(family.topics, row.topics);
    mergeList(family.sampleProducts, row.sample_products);
    mergeList(family.targetPages, row.target_pages);
    family.action ||= row.action || "";
  }

  for (const row of spreadPriority) {
    const family = addFamily(familyMap, row.family);
    if (!family) continue;
    family.priority = Math.max(family.priority, toNumber(row.priority));
    family.familyGapScore = Math.max(family.familyGapScore, toNumber(row.family_gap_score));
    family.promptCoverage = Math.max(family.promptCoverage, toNumber(row.prompt_coverage));
    family.topicPromptCoverage = Math.max(family.topicPromptCoverage, toNumber(row.topic_prompt_coverage));
    family.unlinkedProducts = Math.max(family.unlinkedProducts, toNumber(row.unlinked_products));
    family.competitorOnlyAnswers = Math.max(family.competitorOnlyAnswers, toNumber(row.competitor_only_answers));
    family.lane ||= row.lane || "";
    mergeList(family.keywords, row.matching_keywords);
    mergeList(family.topics, row.topics);
    mergeList(family.sampleProducts, row.sample_products);
    mergeList(family.targetPages, row.target_pages);
    family.action ||= row.product_action || "";
    family.testAction ||= row.test_action || "";
  }

  const familyList = [...familyMap.values()];
  const keywordMap = new Map(familyList.map((family) => [family.family, familyKeywords(family)]));

  for (const answer of answerRows) {
    const rowText = [
      answer.category,
      answer.query,
      answer.product_signals,
      answer.catalog_products,
      answer.page_title,
      answer.snippet,
    ].join(" ");
    for (const family of familyList) {
      const keywords = keywordMap.get(family.family) || [];
      if (!rowMatchesFamily(rowText, keywords)) continue;
      family.answerRows += 1;
      if (/clean/i.test(answer.outcome)) family.cleanRows += 1;
      if (/co/i.test(answer.outcome)) family.coMentionRows += 1;
      if (/competitor/i.test(answer.outcome)) family.replacementRows += 1;
      if (answer.product_signals) family.answerProductSignalRows += 1;
      if (answer.catalog_products) family.catalogProductRows += 1;
      mergeList(family.competitors, answer.competitors);
      mergeList(family.promptRows, answer.query);
    }
  }

  for (const item of workQueue) {
    const familyNames = splitList(item.families);
    for (const familyName of familyNames) {
      const family = addFamily(familyMap, familyName);
      if (!family) continue;
      family.pageActionRows.push({
        family: family.family,
        priority: toNumber(item.priority),
        page: splitList(item.target_pages)[0] || item.target_pages || "",
        products: item.title || "",
        competitors: item.competitor_context || "",
        action: item.suggested_action || "",
        prompts: item.prompts_to_support || "",
      });
      mergeList(family.promptRows, item.prompts_to_support);
      mergeList(family.competitors, item.competitor_context);
    }
  }

  for (const risk of riskRowsRaw) {
    const riskText = [
      risk.candidate,
      risk.matched_title,
      risk.categories,
      risk.queries,
      risk.target_pages,
      risk.product_url,
    ].join(" ");
    for (const family of familyList) {
      const keywords = keywordMap.get(family.family) || [];
      if (!rowMatchesFamily(riskText, keywords)) continue;
      family.productNameRiskRows += 1;
      family.riskyNames.push(risk.candidate);
      break;
    }
  }

  const rows = buildRows(familyMap);
  const familyByName = new Map(rows.map((row) => [row.family, row]));

  const pageRows = rows.flatMap((family) => {
    const existing = family.pageActionRows.map((row) => ({ ...row, family: family.family }));
    const targetFallback = family.targetPages.slice(0, 8).map((page) => ({
      family: family.family,
      priority: family.score,
      page,
      products: family.sampleProducts.slice(0, 4).join("; "),
      competitors: family.competitors.slice(0, 8).join("; "),
      action: family.action,
      prompts: family.promptRows.slice(0, 6).join("; "),
    }));
    return [...existing, ...targetFallback];
  }).sort((a, b) => toNumber(b.priority) - toNumber(a.priority));

  const promptRows = rows.flatMap((family) => family.promptRows.slice(0, 18).map((prompt) => ({
    family: family.family,
    prompt,
    reason: family.testAction,
  })));

  const riskRows = [];
  for (const risk of riskRowsRaw) {
    const family = rows.find((row) => row.riskyNames.includes(risk.candidate)) || familyByName.get(splitList(risk.families)[0]);
    if (!family) continue;
    riskRows.push({
      family: family.family,
      candidate: risk.candidate,
      matchedTitle: risk.matched_title,
      providers: risk.providers,
      action: risk.action,
    });
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml({ rows, pageRows, promptRows, riskRows }));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown({ rows, pageRows, riskRows }));
  await writeFile(path.join(outDir, "product-family-ai-visibility-board.csv"), csv([
    ["rank", "score", "family", "lane", "unlinked_products", "competitor_only_answers", "prompt_coverage", "answer_rows", "answer_product_signal_rows", "catalog_product_rows", "product_name_risk_rows", "topics", "sample_products", "target_pages", "competitors", "action", "test_action"],
    ...rows.map((row, index) => [
      index + 1,
      row.score,
      row.family,
      row.lane,
      row.unlinkedProducts,
      row.competitorOnlyAnswers,
      row.promptCoverage,
      row.answerRows,
      row.answerProductSignalRows,
      row.catalogProductRows,
      row.productNameRiskRows,
      row.topics.join("; "),
      row.sampleProducts.slice(0, 8).join("; "),
      row.targetPages.slice(0, 10).join("; "),
      row.competitors.slice(0, 10).join("; "),
      row.action,
      row.testAction,
    ]),
  ]));
  await writeFile(path.join(outDir, "product-family-page-action-map.csv"), csv([
    ["family", "priority", "page", "products", "competitors", "action", "prompts"],
    ...pageRows.map((row) => [row.family, row.priority, row.page, row.products, row.competitors, row.action, row.prompts]),
  ]));
  await writeFile(path.join(outDir, "product-family-prompt-map.csv"), csv([
    ["family", "prompt", "reason"],
    ...promptRows.map((row) => [row.family, row.prompt, row.reason]),
  ]));
  await writeFile(path.join(outDir, "product-family-name-risk-map.csv"), csv([
    ["family", "candidate", "matched_title", "providers", "action"],
    ...riskRows.map((row) => [row.family, row.candidate, row.matchedTitle, row.providers, row.action]),
  ]));

  console.log(`Wrote ${outDir}`);
  console.log(`Families scored: ${rows.length}`);
  console.log(`Page actions: ${pageRows.length}`);
  console.log(`Prompt rows: ${promptRows.length}`);
  console.log(`Name-risk rows: ${riskRows.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
