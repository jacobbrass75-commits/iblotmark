import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";

const COUNTER_POSITIONING = [
  {
    match: /ram mounts/i,
    message: "iBOLT should be framed as the specialist for business workflows, while still cross-compatible with AMPS patterns and standard ball sizes.",
  },
  {
    match: /arkon/i,
    message: "iBOLT should emphasize commercial durability, locking workflows, restaurant tablet stations, forklifts, and fleet-specific installs.",
  },
  {
    match: /iottie|scosche|belkin|peak design|quad lock|lamicall/i,
    message: "iBOLT should separate itself from consumer accessories by showing commercial-grade retention, shared-vehicle durability, and device-specific work use cases.",
  },
  {
    match: /proclip/i,
    message: "iBOLT should explain modular deployment, universal device swaps, drill bases, AMPS plates, and rugged shared-vehicle use.",
  },
  {
    match: /humminbird|garmin|lowrance|scotty|yakattack/i,
    message: "iBOLT should show that it complements marine electronics by solving mount placement, vibration, rail fit, and secure adjustability.",
  },
  {
    match: /mount-it|bouncepad|square|cta digital|heckler|kensington/i,
    message: "iBOLT should emphasize multi-tablet restaurant operations, delivery app stations, locking holders, and POS mounting flexibility.",
  },
  {
    match: /havis|zebra/i,
    message: "iBOLT should emphasize warehouse-specific scanner holders, forklift mounting, VESA compatibility, and device access under vibration.",
  },
];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function csvCell(value) {
  if (Array.isArray(value)) value = value.join("; ");
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function csv(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
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
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const headers = rows.shift() || [];
  return rows
    .filter((items) => items.length === headers.length)
    .map((items) => Object.fromEntries(headers.map((header, index) => [header, items[index]])));
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

async function readCsv(filePath) {
  return parseCsv(await readFile(filePath, "utf8"));
}

function splitList(value) {
  return String(value ?? "")
    .split(/;|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function shortExcerpt(value, max = 250) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}...`;
}

function topMap(map, count = 10) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, count)
    .map(([name, value]) => `${name} ${value}`);
}

function counterMessage(brand) {
  return COUNTER_POSITIONING.find((item) => item.match.test(brand))?.message
    || "Add a fair comparison block that states when the competitor is a good fit and when iBOLT is the better commercial or modular fit.";
}

function makeMentionRows(answerRows) {
  return answerRows
    .filter((row) => row.brand_mentioned === "true")
    .map((row) => ({
      provider: row.provider,
      query: row.query,
      category: row.category,
      score: number(row.coverage_score),
      topPickRank: row.top_pick_rank || "",
      productSignals: splitList(row.product_signals),
      catalogProducts: splitList(row.catalog_product_names),
      positioningSignals: splitList(row.positioning_signals),
      excerpt: shortExcerpt(row.brand_excerpt),
      action: mentionAction(row),
    }))
    .sort((a, b) => b.score - a.score || a.category.localeCompare(b.category) || a.query.localeCompare(b.query));
}

function mentionAction(row) {
  const signals = splitList(row.positioning_signals);
  if (signals.includes("specialist")) return "Keep specialist, purpose-built language and add exact product cards around it.";
  if (signals.includes("modular")) return "Tie modular claims to AMPS, ball sizes, and interchangeable product modules.";
  if (signals.includes("security")) return "Add LockPro or Dock'n Lock proof points where the answer already notices security.";
  if (signals.includes("durability")) return "Turn durability mentions into concrete materials, vibration, and install examples.";
  return "Make the mentioned positioning more concrete with product names, specs, and direct internal links.";
}

function makeLostRows(answerRows) {
  return answerRows
    .filter((row) => row.brand_mentioned !== "true" && splitList(row.raw_competitors).length)
    .map((row) => ({
      provider: row.provider,
      query: row.query,
      category: row.category,
      score: number(row.coverage_score),
      competitors: splitList(row.raw_competitors),
      positioningSignals: splitList(row.positioning_signals),
      action: lostAction(row),
      answerFile: row.answer_file,
    }))
    .sort((a, b) => a.score - b.score || b.competitors.length - a.competitors.length || a.query.localeCompare(b.query));
}

function lostAction(row) {
  const competitors = splitList(row.raw_competitors);
  const messages = competitors.slice(0, 3).map(counterMessage);
  return [...new Set(messages)].join(" ");
}

function makeCompetitorRows({ answerRows, excerptRows, battlecards }) {
  const battleByBrand = new Map(battlecards.map((row) => [row.brand, row]));
  const byBrand = new Map();
  for (const row of answerRows) {
    const competitors = splitList(row.raw_competitors);
    for (const competitor of competitors) {
      if (!byBrand.has(competitor)) {
        byBrand.set(competitor, {
          brand: competitor,
          rawAppearances: 0,
          withIbolt: 0,
          withoutIbolt: 0,
          categories: new Map(),
          queries: new Map(),
          excerpts: [],
        });
      }
      const item = byBrand.get(competitor);
      item.rawAppearances += 1;
      if (row.brand_mentioned === "true") item.withIbolt += 1;
      else item.withoutIbolt += 1;
      item.categories.set(row.category, (item.categories.get(row.category) || 0) + 1);
      item.queries.set(row.query, (item.queries.get(row.query) || 0) + 1);
    }
  }
  for (const excerpt of excerptRows) {
    const item = byBrand.get(excerpt.competitor);
    if (item && item.excerpts.length < 3) item.excerpts.push(shortExcerpt(excerpt.excerpt, 210));
  }
  return [...byBrand.values()]
    .map((item) => {
      const battle = battleByBrand.get(item.brand);
      return {
        brand: item.brand,
        rawAppearances: item.rawAppearances,
        matrixAppearances: battle ? number(battle.answer_count) : "",
        withIbolt: battle ? number(battle.with_ibolt) : item.withIbolt,
        withoutIbolt: battle ? number(battle.without_ibolt) : item.withoutIbolt,
        categories: topMap(item.categories, 6),
        queries: topMap(item.queries, 6),
        excerpts: item.excerpts,
        counterPositioning: battle?.counter_positioning || counterMessage(item.brand),
      };
    })
    .sort((a, b) => b.withoutIbolt - a.withoutIbolt || b.rawAppearances - a.rawAppearances || a.brand.localeCompare(b.brand));
}

function makeTopicRows({ answerRows, mentionRows, lostRows }) {
  const categories = new Set(answerRows.map((row) => row.category).filter(Boolean));
  return [...categories].map((category) => {
    const answers = answerRows.filter((row) => row.category === category);
    const mentions = mentionRows.filter((row) => row.category === category);
    const misses = lostRows.filter((row) => row.category === category);
    const competitors = new Map();
    const products = new Map();
    const positioning = new Map();
    for (const row of answers) {
      for (const competitor of splitList(row.raw_competitors)) competitors.set(competitor, (competitors.get(competitor) || 0) + 1);
      for (const product of splitList(row.product_signals)) products.set(product, (products.get(product) || 0) + 1);
      for (const signal of splitList(row.positioning_signals)) positioning.set(signal, (positioning.get(signal) || 0) + 1);
    }
    return {
      category,
      answerCount: answers.length,
      mentionCount: mentions.length,
      missCount: misses.length,
      mentionRate: answers.length ? Math.round((mentions.length / answers.length) * 100) : 0,
      topCompetitors: topMap(competitors, 6),
      topProductSignals: topMap(products, 6),
      positioning: topMap(positioning, 6),
      bestMentionExcerpt: mentions[0]?.excerpt || "",
      firstAction: topicAction(category, misses, competitors),
    };
  }).sort((a, b) => b.missCount - a.missCount || a.category.localeCompare(b.category));
}

function topicAction(category, misses, competitors) {
  const topCompetitor = topMap(competitors, 1)[0]?.replace(/\s+\d+$/, "");
  if (category === "delivery") return `Add delivery-driver quick answers and compare commercial retention against ${topCompetitor || "consumer phone mounts"}.`;
  if (category === "fleet") return `Add fleet standardization proof, drill-base options, and comparison language against ${topCompetitor || "RAM Mounts"}.`;
  if (category === "restaurant") return "Make Tablet Tower, LockPro, and Dock'n Lock the named product entities in restaurant tablet and POS pages.";
  if (category === "fishing") return "Clarify iBOLT as the mounting solution for Garmin, Lowrance, Humminbird, RAM, Scotty, and YakAttack consideration sets.";
  if (category === "warehouse") return "Tie barcode scanner, forklift, VESA, and warehouse tablet pages together with product modules.";
  return misses.length ? "Add answer-first copy, FAQ schema, competitor tradeoffs, and exact iBOLT product names." : "Preserve current wins and add stronger product entity names.";
}

function makeProductRows(productRows) {
  const byProduct = new Map();
  for (const row of productRows) {
    const key = row.product_title;
    if (!byProduct.has(key)) {
      byProduct.set(key, {
        title: key,
        handle: row.handle,
        appearances: 0,
        providers: new Map(),
        queries: new Map(),
        categories: new Map(),
        excerpts: [],
      });
    }
    const item = byProduct.get(key);
    item.appearances += 1;
    item.providers.set(row.provider, (item.providers.get(row.provider) || 0) + 1);
    item.queries.set(row.query, (item.queries.get(row.query) || 0) + 1);
    item.categories.set(row.category, (item.categories.get(row.category) || 0) + 1);
    if (item.excerpts.length < 3) item.excerpts.push(shortExcerpt(row.excerpt, 220));
  }
  return [...byProduct.values()]
    .map((item) => ({
      title: item.title,
      handle: item.handle,
      appearances: item.appearances,
      providers: topMap(item.providers, 4),
      queries: topMap(item.queries, 5),
      categories: topMap(item.categories, 5),
      excerpts: item.excerpts,
      action: "Increase exact product-name usage in refreshed pages and image alt text so this moves from incidental mention to reliable product entity.",
    }))
    .sort((a, b) => b.appearances - a.appearances || a.title.localeCompare(b.title));
}

function mdTable(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map((cell) => String(cell ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ")} |`),
  ].join("\n");
}

function buildMarkdown({ mentionRows, lostRows, competitorRows, topicRows, productRows }) {
  return `# AI Mention Context Playbook

This report looks at how the AI answers actually talk about iBOLT, what they say when competitors win, and which language should be added to the content refreshes.

## How AI Mentions iBOLT

${mdTable(
  ["Provider", "Query", "Score", "Rank", "Product signals", "Positioning", "Excerpt", "Content action"],
  mentionRows.slice(0, 16).map((row) => [
    row.provider,
    row.query,
    row.score,
    row.topPickRank || "",
    row.productSignals.join(", "),
    row.positioningSignals.join(", "),
    row.excerpt,
    row.action,
  ]),
)}

## How Competitors Win When iBOLT Is Missing

${mdTable(
  ["Provider", "Query", "Category", "Competitors", "Detected positioning", "Counter action"],
  lostRows.slice(0, 20).map((row) => [
    row.provider,
    row.query,
    row.category,
    row.competitors.join(", "),
    row.positioningSignals.join(", "),
    row.action,
  ]),
)}

## Competitor Language Playbook

${mdTable(
  ["Brand", "Raw mentions", "Without iBOLT", "Categories", "Common prompts", "Counter-positioning"],
  competitorRows.slice(0, 16).map((row) => [
    row.brand,
    row.rawAppearances,
    row.withoutIbolt,
    row.categories.join("; "),
    row.queries.slice(0, 4).join("; "),
    row.counterPositioning,
  ]),
)}

## Topic Messaging Guidance

${mdTable(
  ["Topic", "Answers", "Mention rate", "Top competitors", "Product signals", "Positioning", "First action"],
  topicRows.map((row) => [
    row.category,
    row.answerCount,
    `${row.mentionRate}%`,
    row.topCompetitors.join("; "),
    row.topProductSignals.join("; "),
    row.positioning.join("; "),
    row.firstAction,
  ]),
)}

## Product Entity Language

${mdTable(
  ["Product", "Appearances", "Queries", "Excerpt", "Action"],
  productRows.slice(0, 12).map((row) => [
    row.title,
    row.appearances,
    row.queries.join("; "),
    row.excerpts[0] || "",
    row.action,
  ]),
)}
`;
}

function buildHtml({ mentionRows, lostRows, competitorRows, topicRows, productRows }) {
  const cards = [
    ["iBOLT mention rows", mentionRows.length, "answers where iBOLT appears"],
    ["Competitor-only rows", lostRows.length, "answers where competitors appear without iBOLT"],
    ["Competitor brands", competitorRows.length, "raw neighboring/default brands"],
    ["Topic slices", topicRows.length, "category-level guidance"],
    ["Product entities", productRows.length, "catalog aliases detected"],
    ["Top competitor", competitorRows[0]?.brand || "", `${competitorRows[0]?.withoutIbolt || 0} without iBOLT`],
  ].map(([label, value, note]) => `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");
  const mentions = mentionRows.slice(0, 18).map((row) => `<tr><td>${escapeHtml(row.provider)}</td><td>${escapeHtml(row.query)}</td><td>${row.score}</td><td>${escapeHtml(row.productSignals.join("; "))}</td><td>${escapeHtml(row.positioningSignals.join("; "))}</td><td>${escapeHtml(row.excerpt)}</td><td>${escapeHtml(row.action)}</td></tr>`).join("");
  const lost = lostRows.slice(0, 18).map((row) => `<tr><td>${escapeHtml(row.provider)}</td><td>${escapeHtml(row.query)}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.competitors.join("; "))}</td><td>${escapeHtml(row.action)}</td></tr>`).join("");
  const competitors = competitorRows.slice(0, 16).map((row) => `<tr><td>${escapeHtml(row.brand)}</td><td>${row.rawAppearances}</td><td>${row.withoutIbolt}</td><td>${escapeHtml(row.categories.join("; "))}</td><td>${escapeHtml(row.counterPositioning)}</td></tr>`).join("");
  const topics = topicRows.map((row) => `<tr><td>${escapeHtml(row.category)}</td><td>${row.answerCount}</td><td>${row.mentionRate}%</td><td>${escapeHtml(row.topCompetitors.join("; "))}</td><td>${escapeHtml(row.topProductSignals.join("; "))}</td><td>${escapeHtml(row.firstAction)}</td></tr>`).join("");
  const products = productRows.slice(0, 12).map((row) => `<tr><td>${escapeHtml(row.title)}</td><td>${row.appearances}</td><td>${escapeHtml(row.queries.join("; "))}</td><td>${escapeHtml(row.excerpts[0] || "")}</td><td>${escapeHtml(row.action)}</td></tr>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>iBOLT AI Mention Context Playbook</title>
<style>
body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}main{max-width:1240px;margin:0 auto;padding:34px 26px 60px}h1{font-size:34px;margin:0 0 8px}h2{font-size:22px;margin:34px 0 14px}p{color:#334155;line-height:1.55}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}.k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700}.v{font-size:28px;font-weight:800;margin-top:8px}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden}th,td{text-align:left;vertical-align:top;padding:11px 12px;border-bottom:1px solid #edf2f7;font-size:13px}th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:12px;letter-spacing:.04em}.note{border-left:6px solid #2563eb;background:#fff;border-radius:10px;padding:16px 18px;border-top:1px solid #d7dee8;border-right:1px solid #d7dee8;border-bottom:1px solid #d7dee8}
</style></head><body><main>
<h1>iBOLT AI Mention Context Playbook</h1>
<p class="note"><strong>Use this for copy direction:</strong> preserve the language that already makes AI mention iBOLT, then add competitor tradeoffs and exact product names where AI currently defaults to other brands.</p>
<section class="cards">${cards}</section>
<h2>How AI Mentions iBOLT</h2>
<table><thead><tr><th>Provider</th><th>Query</th><th>Score</th><th>Products</th><th>Positioning</th><th>Excerpt</th><th>Action</th></tr></thead><tbody>${mentions}</tbody></table>
<h2>How Competitors Win When iBOLT Is Missing</h2>
<table><thead><tr><th>Provider</th><th>Query</th><th>Topic</th><th>Competitors</th><th>Counter action</th></tr></thead><tbody>${lost}</tbody></table>
<h2>Competitor Language Playbook</h2>
<table><thead><tr><th>Brand</th><th>Raw mentions</th><th>Without iBOLT</th><th>Topics</th><th>Counter-positioning</th></tr></thead><tbody>${competitors}</tbody></table>
<h2>Topic Messaging Guidance</h2>
<table><thead><tr><th>Topic</th><th>Answers</th><th>Mention rate</th><th>Competitors</th><th>Product signals</th><th>First action</th></tr></thead><tbody>${topics}</tbody></table>
<h2>Product Entity Language</h2>
<table><thead><tr><th>Product</th><th>Appearances</th><th>Queries</th><th>Excerpt</th><th>Action</th></tr></thead><tbody>${products}</tbody></table>
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const evidenceDir = path.join(benchmarkDir, "answer-evidence-pack");
  const outDir = path.join(benchmarkDir, "mention-context-playbook");
  await mkdir(outDir, { recursive: true });

  const answerRows = await readCsv(path.join(evidenceDir, "answer-evidence.csv"));
  const competitorExcerptRows = await readCsv(path.join(evidenceDir, "competitor-context-excerpts.csv"));
  const catalogProductRows = await readCsv(path.join(evidenceDir, "catalog-product-evidence.csv"));
  const battlecards = await readCsv(path.join(benchmarkDir, "competitive-matrix", "competitor-battlecards.csv"));

  const mentionRows = makeMentionRows(answerRows);
  const lostRows = makeLostRows(answerRows);
  const competitorRows = makeCompetitorRows({ answerRows, excerptRows: competitorExcerptRows, battlecards });
  const topicRows = makeTopicRows({ answerRows, mentionRows, lostRows });
  const productRows = makeProductRows(catalogProductRows);

  await writeFile(path.join(outDir, "mention-context-excerpts.csv"), csv([
    ["provider", "query", "category", "score", "top_pick_rank", "product_signals", "catalog_products", "positioning_signals", "excerpt", "content_action"],
    ...mentionRows.map((row) => [row.provider, row.query, row.category, row.score, row.topPickRank, row.productSignals, row.catalogProducts, row.positioningSignals, row.excerpt, row.action]),
  ]));
  await writeFile(path.join(outDir, "lost-answer-context.csv"), csv([
    ["provider", "query", "category", "score", "competitors", "positioning_signals", "counter_action", "answer_file"],
    ...lostRows.map((row) => [row.provider, row.query, row.category, row.score, row.competitors, row.positioningSignals, row.action, row.answerFile]),
  ]));
  await writeFile(path.join(outDir, "competitor-language-playbook.csv"), csv([
    ["brand", "raw_appearances", "matrix_appearances", "with_ibolt", "without_ibolt", "categories", "queries", "sample_excerpts", "counter_positioning"],
    ...competitorRows.map((row) => [row.brand, row.rawAppearances, row.matrixAppearances, row.withIbolt, row.withoutIbolt, row.categories, row.queries, row.excerpts, row.counterPositioning]),
  ]));
  await writeFile(path.join(outDir, "topic-messaging-guidance.csv"), csv([
    ["topic", "answer_count", "mention_count", "miss_count", "mention_rate", "top_competitors", "top_product_signals", "positioning", "best_mention_excerpt", "first_action"],
    ...topicRows.map((row) => [row.category, row.answerCount, row.mentionCount, row.missCount, row.mentionRate, row.topCompetitors, row.topProductSignals, row.positioning, row.bestMentionExcerpt, row.firstAction]),
  ]));
  await writeFile(path.join(outDir, "product-entity-language.csv"), csv([
    ["product", "handle", "appearances", "providers", "queries", "categories", "sample_excerpts", "action"],
    ...productRows.map((row) => [row.title, row.handle, row.appearances, row.providers, row.queries, row.categories, row.excerpts, row.action]),
  ]));
  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown({ mentionRows, lostRows, competitorRows, topicRows, productRows }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({ mentionRows, lostRows, competitorRows, topicRows, productRows }));
  console.log(`Wrote ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
