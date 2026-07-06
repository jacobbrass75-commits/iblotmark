import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";
const DB_PATH = "data/sourceannotator.db";

let sharpModulePromise = null;

const PROVIDER_LABELS = {
  chatgpt: "ChatGPT",
  gemini_plain: "Gemini",
  claude: "Claude",
};

const COMPETITOR_ALIASES = [
  ["RAM Mounts", /\bRAM(?: Mounts)?\b/gi],
  ["Arkon", /\bArkon\b/gi],
  ["iOttie", /\biOttie\b/gi],
  ["ProClip", /\bProClip\b/gi],
  ["Humminbird", /\bHumminbird\b/gi],
  ["Scosche", /\bScosche\b/gi],
  ["Garmin", /\bGarmin\b/gi],
  ["Scotty", /\bScotty\b/gi],
  ["YakAttack", /\bYakAttack\b/gi],
  ["Lowrance", /\bLowrance\b/gi],
  ["Mount-It", /\bMount-It!?\b/gi],
  ["Bouncepad", /\bBouncepad\b/gi],
  ["Tackform", /\bTackform\b/gi],
  ["CTA Digital", /\bCTA Digital\b/gi],
  ["Havis", /\bHavis\b/gi],
  ["Zebra", /\bZebra\b/gi],
  ["Kensington", /\bKensington\b/gi],
  ["Heckler", /\bHeckler\b/gi],
  ["Square", /\bSquare\b/gi],
  ["Belkin", /\bBelkin\b/gi],
  ["Peak Design", /\bPeak Design\b/gi],
  ["Quad Lock", /\bQuad Lock\b/gi],
  ["Lamicall", /\bLamicall\b/gi],
];

const PRODUCT_SIGNALS = [
  ["Tablet Tower", /\bTablet Tower\b/gi],
  ["LockPro", /\bLockPro\b/gi],
  ["Dock'n Lock / Dock’n Lock", /\bDock['’]n Lock\b|\bDock-n-Lock\b/gi],
  ["xProDock", /\bxProDock\b/gi],
  ["Moto-Vise", /\bMoto[- ]Vise\b/gi],
  ["TabDock", /\bTabDock\b/gi],
  ["ChargeDock", /\bChargeDock\b/gi],
  ["SafeMag", /\bSafeMag\b/gi],
  ["IncrediBOLT", /\bIncrediBOLT\b/gi],
  ["BizMount", /\bBizMount\b/gi],
  ["XL Barcode Scanner", /\bXL Barcode Scanner\b|\bbarcode scanner holder\b/gi],
  ["AMPS", /\bAMPS\b/gi],
  ["VESA", /\bVESA\b/gi],
  ["Garmin Striker", /\bGarmin Striker\b/gi],
  ["Universal Marine Mounting Plate", /\bUniversal Marine\b|\bmarine.*mounting plate\b/gi],
  ["Mount Configurator", /\bMount Configurator\b/gi],
];

const POSITIONING_PATTERNS = [
  ["specialist", /\bpurpose-built\b|\bspecialist\b|\bspecialized\b|\bindustrial-grade\b|\bcommercial-grade\b/gi],
  ["durability", /\bheavy-duty\b|\brugged\b|\bvibration\b|\bdurable\b|\bcommercial\b/gi],
  ["modular", /\bmodular\b|\binterchangeable\b|\bAMPS\b|\bball size\b|\bcompatible\b/gi],
  ["budget/value", /\bbudget\b|\bvalue\b|\baffordable\b|\blow-cost\b|\bcheap\b/gi],
  ["security", /\blocking\b|\bsecure\b|\btheft\b|\bkeyed\b/gi],
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

function pct(numerator, denominator) {
  return denominator ? Math.round((numerator / denominator) * 100) : 0;
}

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "answer";
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return value.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean);
  }
}

function parseJsonObject(value) {
  if (!value || typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function normalizePhrase(value) {
  return String(value ?? "")
    .replace(/[™®©]/g, "")
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function addAlias(aliases, value, source) {
  const normalized = normalizePhrase(value);
  if (normalized.length < 10) return;
  if (!/[a-z]/.test(normalized)) return;
  const generic = new Set([
    "ibolt mounts",
    "phone mount",
    "tablet mount",
    "mounting system",
    "clamp mount",
    "drill base mount",
    "suction cup mount",
    "magnetic mount",
  ]);
  if (generic.has(normalized)) return;
  aliases.set(normalized, source);
}

function variantSkus(value) {
  const variants = parseJsonArray(value);
  const skus = [];
  for (const variant of variants) {
    if (variant && typeof variant === "object") {
      if (variant.sku) skus.push(String(variant.sku));
      if (variant.SKU) skus.push(String(variant.SKU));
    }
  }
  return skus;
}

function sourceDataSkus(value) {
  const source = parseJsonObject(value);
  const variants = source?.shopifyProduct?.variants || source?.variants || [];
  if (!Array.isArray(variants)) return [];
  return variants.map((variant) => variant?.sku || variant?.SKU).filter(Boolean).map(String);
}

function buildProductAliases(product) {
  const aliases = new Map();
  addAlias(aliases, product.title, "title");
  addAlias(aliases, String(product.title || "").replace(/\biBOLT\b/gi, ""), "title_without_brand");
  addAlias(aliases, String(product.title || "").replace(/[™®©]/g, "").split(/\s+-\s+|\s+–\s+|\s+—\s+/)[0], "title_head");
  addAlias(aliases, String(product.handle || "").replace(/-/g, " "), "handle");
  addAlias(aliases, product.sku, "sku");
  for (const sku of variantSkus(product.variants)) addAlias(aliases, sku, "variant_sku");
  for (const sku of sourceDataSkus(product.source_data)) addAlias(aliases, sku, "source_sku");
  return [...aliases.entries()].map(([alias, source]) => ({ alias, source }));
}

function contextAround(text, pattern, radius = 190) {
  if (!text) return "";
  pattern.lastIndex = 0;
  const match = pattern.exec(text);
  if (!match) return "";
  const start = Math.max(0, match.index - radius);
  const end = Math.min(text.length, match.index + match[0].length + radius);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function countPattern(text, pattern) {
  if (!text) return 0;
  pattern.lastIndex = 0;
  return [...text.matchAll(pattern)].length;
}

function detectList(text, patterns) {
  return patterns
    .map(([name, pattern]) => ({ name, count: countPattern(text, pattern), excerpt: contextAround(text, pattern) }))
    .filter((item) => item.count > 0);
}

function getCatalogProducts(db) {
  return db.prepare(`
    SELECT id, title, handle, sku, variants, source_data
    FROM ibolt_products
    WHERE title IS NOT NULL AND trim(title) != ''
    ORDER BY title ASC
  `).all();
}

function detectCatalogProducts(raw, normalizedRaw, catalogProducts) {
  const matches = [];
  const seen = new Set();
  for (const product of catalogProducts) {
    for (const alias of product.aliases) {
      if (!alias.alias || !normalizedRaw.includes(alias.alias)) continue;
      const key = `${product.id}:${alias.alias}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({
        id: product.id,
        title: product.title,
        handle: product.handle,
        alias: alias.alias,
        aliasSource: alias.source,
        excerpt: contextAround(raw, new RegExp(alias.alias.replace(/\s+/g, "[\\\\s\\W]+"), "i"), 190),
      });
    }
  }
  return matches;
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

function getRunIdFromSummary(summary) {
  return summary?.current?.run?.id || summary?.summary?.run?.id || summary?.run?.id;
}

function getRows(db, runId) {
  return db.prepare(`
    SELECT
      r.id,
      r.provider,
      r.model,
      r.prompt,
      r.raw_response AS rawResponse,
      r.status,
      r.error,
      r.brand_mentioned AS brandMentioned,
      r.target_brand_mentioned AS targetBrandMentioned,
      r.ibolt_cited AS domainCited,
      r.target_domain_cited AS targetDomainCited,
      r.top_pick_rank AS topPickRank,
      r.coverage_score AS coverageScore,
      r.sentiment,
      r.positioning,
      r.positioning_tags AS positioningTags,
      r.mentioned_products AS mentionedProducts,
      r.competitors,
      r.source_urls AS sourceUrls,
      r.analysis_notes AS analysisNotes,
      q.query,
      q.category,
      q.priority,
      q.benchmark_goal AS benchmarkGoal
    FROM ai_benchmark_results r
    JOIN ai_benchmark_queries q ON q.id = r.query_id
    WHERE r.run_id = ?
    ORDER BY q.priority DESC, q.query ASC, r.provider ASC
  `).all(runId);
}

function analyzeRow(row, catalogProducts) {
  const raw = row.rawResponse || "";
  const normalizedRaw = normalizePhrase(raw);
  const brandExcerpt = contextAround(raw, /\biBOLT\b|\biboltmounts\.com\b/gi, 230);
  const competitors = detectList(raw, COMPETITOR_ALIASES);
  const productSignals = detectList(raw, PRODUCT_SIGNALS);
  const catalogProductsMentioned = detectCatalogProducts(raw, normalizedRaw, catalogProducts);
  const positioningSignals = detectList(raw, POSITIONING_PATTERNS);
  const sourceUrls = parseJsonArray(row.sourceUrls);
  const storedCompetitors = parseJsonArray(row.competitors);
  const storedProducts = parseJsonArray(row.mentionedProducts);
  return {
    ...row,
    providerLabel: PROVIDER_LABELS[row.provider] || row.provider,
    brandMentioned: Boolean(row.brandMentioned),
    targetBrandMentioned: Boolean(row.targetBrandMentioned),
    domainCited: Boolean(row.domainCited),
    targetDomainCited: Boolean(row.targetDomainCited),
    topPickRank: row.topPickRank || null,
    coverageScore: Number(row.coverageScore || 0),
    rawLength: raw.length,
    storedCompetitors,
    storedProducts,
    sourceUrls,
    sourceUrlCount: sourceUrls.length,
    brandExcerpt,
    rawCompetitors: competitors,
    rawCompetitorNames: competitors.map((item) => item.name),
    catalogProductsMentioned,
    catalogProductNames: [...new Set(catalogProductsMentioned.map((item) => item.title))],
    catalogProductHandles: [...new Set(catalogProductsMentioned.map((item) => item.handle))],
    productSignals,
    productSignalNames: productSignals.map((item) => item.name),
    positioningSignals,
    positioningSignalNames: positioningSignals.map((item) => item.name),
  };
}

function countNames(rows, field) {
  const counts = new Map();
  for (const row of rows) {
    for (const name of row[field] ?? []) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function buildStats(rows) {
  const completed = rows.filter((row) => row.status === "completed");
  const nonBranded = completed.filter((row) => !/\bibolt\b/i.test(row.query));
  const withRaw = completed.filter((row) => row.rawLength > 0);
  return {
    total: completed.length,
    rawResponses: withRaw.length,
    mentionCount: completed.filter((row) => row.brandMentioned).length,
    mentionRate: pct(completed.filter((row) => row.brandMentioned).length, completed.length),
    nonBranded: nonBranded.length,
    nonBrandedMentionCount: nonBranded.filter((row) => row.brandMentioned).length,
    nonBrandedMentionRate: pct(nonBranded.filter((row) => row.brandMentioned).length, nonBranded.length),
    citationCount: completed.filter((row) => row.domainCited).length,
    citationRate: pct(completed.filter((row) => row.domainCited).length, completed.length),
    sourceUrlRows: completed.filter((row) => row.sourceUrlCount > 0).length,
    productSignalRows: completed.filter((row) => row.productSignals.length > 0).length,
    catalogProductRows: completed.filter((row) => row.catalogProductsMentioned.length > 0).length,
    storedProductRows: completed.filter((row) => row.storedProducts.length > 0).length,
    competitorOnlyRows: completed.filter((row) => !row.brandMentioned && row.rawCompetitors.length > 0).length,
    coMentionRows: completed.filter((row) => row.brandMentioned && row.rawCompetitors.length > 0).length,
  };
}

function svgShell(width, height, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
  <style>
    .bg{fill:#f8fafc}.panel{fill:#fff;stroke:#d7dee8;stroke-width:1}.title{font:700 24px Arial,sans-serif;fill:#111827}.subtitle{font:400 14px Arial,sans-serif;fill:#64748b}.label{font:700 13px Arial,sans-serif;fill:#111827}.small{font:400 12px Arial,sans-serif;fill:#475569}.value{font:700 13px Arial,sans-serif;fill:#0f172a}
  </style>
  <rect class="bg" width="${width}" height="${height}"/>
  ${body}
</svg>`;
}

function wrapText(value, maxChars) {
  const words = String(value ?? "").replace(/\s+/g, " ").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function barChart({ title, subtitle, rows, color = "#2563eb" }) {
  const width = 1160;
  const rowH = 48;
  const height = 128 + rows.length * rowH + 34;
  const left = 360;
  const top = 108;
  const barW = width - left - 140;
  const max = Math.max(1, ...rows.map((row) => Number(row.value || 0)));
  const body = rows.map((row, index) => {
    const y = top + index * rowH;
    const value = Number(row.value || 0);
    const w = Math.max(value > 0 ? 4 : 0, Math.round((value / max) * barW));
    const labels = wrapText(row.label, 40).map((line, lineIndex) =>
      `<text class="${lineIndex === 0 ? "label" : "small"}" x="54" y="${y + 14 + lineIndex * 15}">${escapeHtml(line)}</text>`
    ).join("\n");
    return `
      ${labels}
      <rect x="${left}" y="${y}" width="${barW}" height="24" rx="8" fill="#e2e8f0"/>
      <rect x="${left}" y="${y}" width="${w}" height="24" rx="8" fill="${color}"/>
      <text class="value" x="${left + barW + 14}" y="${y + 17}">${escapeHtml(row.display ?? value)}</text>
      <text class="small" x="${left}" y="${y + 41}">${escapeHtml(row.note || "")}</text>
    `;
  }).join("\n");
  return svgShell(width, height, `
    <rect class="panel" x="28" y="24" width="${width - 56}" height="${height - 48}" rx="14"/>
    <text class="title" x="54" y="64">${escapeHtml(title)}</text>
    <text class="subtitle" x="54" y="88">${escapeHtml(subtitle)}</text>
    ${body}
  `);
}

async function writeSvgAndPng(outDir, filename, svg) {
  await writeFile(path.join(outDir, `${filename}.svg`), svg);
  try {
    sharpModulePromise ||= import("sharp");
    const sharp = (await sharpModulePromise).default;
    await sharp(Buffer.from(svg)).png().toFile(path.join(outDir, `${filename}.png`));
  } catch (error) {
    console.warn(`Could not render ${filename}.png: ${error.message}`);
  }
}

function buildHtml({ stats, rows, competitorCounts, productCounts, catalogProductCounts, positioningCounts }) {
  const cards = [
    ["Raw answers", `${stats.rawResponses}/${stats.total}`, "full answer text available"],
    ["iBOLT mentions", `${stats.mentionCount}/${stats.total}`, `${stats.mentionRate}% overall`],
    ["Non-branded mentions", `${stats.nonBrandedMentionCount}/${stats.nonBranded}`, `${stats.nonBrandedMentionRate}% generic prompts`],
    ["Domain citations", `${stats.citationCount}/${stats.total}`, `${stats.citationRate}% target citation rate`],
    ["Product signal rows", `${stats.productSignalRows}/${stats.total}`, "manual family/name detection"],
    ["Catalog product rows", `${stats.catalogProductRows}/${stats.total}`, "actual product title/alias detection"],
    ["Exact stored products", `${stats.storedProductRows}/${stats.total}`, "strict product-title extraction"],
    ["Competitor-only rows", stats.competitorOnlyRows, "competitor named, iBOLT absent"],
    ["Co-mention rows", stats.coMentionRows, "iBOLT plus competitor"],
  ].map(([label, value, note]) => `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div><div class="s">${escapeHtml(note)}</div></div>`).join("");

  const mentionRows = rows
    .filter((row) => row.brandMentioned)
    .slice(0, 14)
    .map((row) => `<tr><td>${escapeHtml(row.providerLabel)}</td><td>${escapeHtml(row.query)}</td><td>${row.coverageScore}</td><td>${escapeHtml(row.productSignalNames.join(", "))}</td><td>${escapeHtml(row.catalogProductNames.join(", "))}</td><td>${escapeHtml(row.brandExcerpt)}</td></tr>`)
    .join("");
  const lostRows = rows
    .filter((row) => !row.brandMentioned && row.rawCompetitorNames.length)
    .slice(0, 18)
    .map((row) => `<tr><td>${escapeHtml(row.providerLabel)}</td><td>${escapeHtml(row.query)}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.rawCompetitorNames.slice(0, 6).join(", "))}</td><td>${escapeHtml(row.rawCompetitors[0]?.excerpt || "")}</td></tr>`)
    .join("");
  const sourceRows = rows
    .filter((row) => row.sourceUrlCount)
    .slice(0, 16)
    .map((row) => `<tr><td>${escapeHtml(row.providerLabel)}</td><td>${escapeHtml(row.query)}</td><td>${row.sourceUrlCount}</td><td>${escapeHtml(row.sourceUrls.slice(0, 4).join(", "))}</td></tr>`)
    .join("") || `<tr><td colspan="4">No source URLs were extracted for this OpenRouter consumer-model run.</td></tr>`;

  return `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT AI Answer Evidence Pack</title>
  <style>
    :root{--ink:#111827;--muted:#64748b;--border:#d7dee8;--bg:#f8fafc}
    body{margin:0;background:var(--bg);font-family:Arial,Helvetica,sans-serif;color:var(--ink)}
    main{max-width:1280px;margin:0 auto;padding:34px 26px 64px}h1{font-size:34px;margin:0 0 10px}h2{font-size:22px;margin:34px 0 14px}p{font-size:16px;line-height:1.55;color:#334155;max-width:1020px}.meta{font-size:14px;color:var(--muted)}
    .note{background:#fff;border:1px solid var(--border);border-left:6px solid #2563eb;border-radius:10px;padding:16px 18px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid var(--border);border-radius:12px;padding:16px}.k{font-size:12px;color:var(--muted);letter-spacing:.06em;text-transform:uppercase;font-weight:700}.v{font-size:28px;font-weight:800;margin-top:8px}.s{font-size:13px;color:var(--muted)}
    figure{background:#fff;border:1px solid var(--border);border-radius:14px;margin:14px 0;padding:10px;overflow:auto}figure img{display:block;width:100%;height:auto}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:22px}th,td{text-align:left;vertical-align:top;padding:11px 12px;border-bottom:1px solid #edf2f7;font-size:14px}th{background:#f1f5f9;color:#475569;font-size:12px;letter-spacing:.04em;text-transform:uppercase}a{color:#0f3f91}
    @media(max-width:980px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  </style>
</head><body><main>
  <div class="meta">Built from raw ai_benchmark_results.raw_response records in ${escapeHtml(DB_PATH)}</div>
  <h1>iBOLT AI Answer Evidence Pack</h1>
  <p class="note"><strong>What changed:</strong> this report uses the actual saved AI answer text. It can show how iBOLT is mentioned, which competitors appear in the same answer, which product names/families appear, and whether citations/source URLs were present.</p>
  <section class="grid">${cards}</section>
  <h2>Charts</h2>
  <figure><img src="catalog-product-counts.svg" alt="Catalog product counts"/></figure>
  <figure><img src="product-signal-counts.svg" alt="Product signal counts"/></figure>
  <figure><img src="raw-competitor-counts.svg" alt="Raw competitor counts"/></figure>
  <figure><img src="positioning-signal-counts.svg" alt="Positioning signal counts"/></figure>
  <h2>iBOLT Mention Excerpts</h2>
  <table><thead><tr><th>Provider</th><th>Query</th><th>Score</th><th>Product signals</th><th>Catalog products</th><th>Excerpt</th></tr></thead><tbody>${mentionRows}</tbody></table>
  <h2>Competitor-Only Excerpts</h2>
  <table><thead><tr><th>Provider</th><th>Query</th><th>Topic</th><th>Competitors</th><th>Example context</th></tr></thead><tbody>${lostRows}</tbody></table>
  <h2>Source URL Audit</h2>
  <table><thead><tr><th>Provider</th><th>Query</th><th>Source URLs</th><th>URLs</th></tr></thead><tbody>${sourceRows}</tbody></table>
  <h2>Top Raw Competitors</h2>
  <p>${escapeHtml(competitorCounts.slice(0, 10).map((row) => `${row.name} ${row.count}`).join("; "))}</p>
  <h2>Top Product Signals</h2>
  <p>${escapeHtml(productCounts.slice(0, 12).map((row) => `${row.name} ${row.count}`).join("; "))}</p>
  <h2>Top Catalog Product Matches</h2>
  <p>${escapeHtml(catalogProductCounts.slice(0, 12).map((row) => `${row.name} ${row.count}`).join("; "))}</p>
</main></body></html>`;
}

function buildMarkdown({ stats, competitorCounts, productCounts, catalogProductCounts, positioningCounts, rows }) {
  return `# iBOLT AI Answer Evidence Pack

## Scorecard

- Raw full answers available: ${stats.rawResponses}/${stats.total}
- iBOLT mentions: ${stats.mentionCount}/${stats.total} (${stats.mentionRate}%)
- Non-branded iBOLT mentions: ${stats.nonBrandedMentionCount}/${stats.nonBranded} (${stats.nonBrandedMentionRate}%)
- Target-domain citations: ${stats.citationCount}/${stats.total} (${stats.citationRate}%)
- Rows with any source URL: ${stats.sourceUrlRows}/${stats.total}
- Rows with manual product/family signal: ${stats.productSignalRows}/${stats.total}
- Rows with actual catalog product aliases: ${stats.catalogProductRows}/${stats.total}
- Rows with strict stored product mentions: ${stats.storedProductRows}/${stats.total}
- Competitor-only rows: ${stats.competitorOnlyRows}
- Co-mention rows: ${stats.coMentionRows}

## Raw Competitors In Answer Text

${competitorCounts.slice(0, 14).map((row) => `- ${row.name}: ${row.count}`).join("\n")}

## Product And Category Signals In Answer Text

${productCounts.slice(0, 14).map((row) => `- ${row.name}: ${row.count}`).join("\n")}

## Actual Catalog Product Alias Matches

${catalogProductCounts.slice(0, 14).map((row) => `- ${row.name}: ${row.count}`).join("\n") || "- None detected"}

## Positioning Signals

${positioningCounts.map((row) => `- ${row.name}: ${row.count}`).join("\n")}

## Example iBOLT Mention Contexts

${rows.filter((row) => row.brandMentioned).slice(0, 8).map((row) => `- ${row.providerLabel}, ${row.query}: "${row.brandExcerpt}"`).join("\n")}

## Caveat

This analyzes answer text from the saved benchmark run. It does not rerun providers. Manual product signals are broader than strict stored product-title extraction. Catalog alias matches are derived from local ibolt_products titles, handles, SKUs, and variant/source data.
`;
}

async function main() {
  const benchmarkDir = process.argv[2] ? path.resolve(process.argv[2]) : await latestDir(BENCHMARK_PREFIX);
  const summary = JSON.parse(await readFile(path.join(benchmarkDir, "summary.json"), "utf8"));
  const runId = process.env.AI_BENCHMARK_RUN_ID || getRunIdFromSummary(summary);
  if (!runId) throw new Error("Could not determine benchmark run ID from summary.json.");

  const outDir = path.join(benchmarkDir, "answer-evidence-pack");
  const answersDir = path.join(outDir, "answers");
  await mkdir(answersDir, { recursive: true });

  const db = new Database(path.join(process.cwd(), DB_PATH), { readonly: true });
  const catalogProducts = getCatalogProducts(db).map((product) => ({
    ...product,
    aliases: buildProductAliases(product),
  })).filter((product) => product.aliases.length > 0);
  const rows = getRows(db, runId).map((row) => analyzeRow(row, catalogProducts));
  db.close();
  if (!rows.length) throw new Error(`No benchmark results found for run ${runId}.`);

  const stats = buildStats(rows);
  const competitorCounts = countNames(rows, "rawCompetitorNames");
  const productCounts = countNames(rows, "productSignalNames");
  const catalogProductCounts = countNames(rows, "catalogProductNames");
  const positioningCounts = countNames(rows, "positioningSignalNames");

  for (const row of rows) {
    if (!row.rawResponse) continue;
    const file = `${slugify(row.query)}--${slugify(row.provider)}.md`;
    await writeFile(path.join(answersDir, file), [
      `# ${row.query}`,
      "",
      `Provider: ${row.providerLabel}`,
      `Model: ${row.model || ""}`,
      `Category: ${row.category}`,
      `Coverage score: ${row.coverageScore}`,
      `Brand mentioned: ${row.brandMentioned}`,
      `Target domain cited: ${row.domainCited}`,
      `Top pick rank: ${row.topPickRank || ""}`,
      `Competitors detected: ${row.rawCompetitorNames.join(", ")}`,
      `Product signals: ${row.productSignalNames.join(", ")}`,
      `Catalog product aliases: ${row.catalogProductNames.join(", ")}`,
      "",
      "## Raw Answer",
      "",
      row.rawResponse,
      "",
    ].join("\n"));
    row.answerFile = path.join("answers", file);
  }

  await writeFile(path.join(outDir, "answer-evidence.csv"), csv([
    ["provider", "query", "category", "coverage_score", "brand_mentioned", "domain_cited", "top_pick_rank", "raw_length", "raw_competitors", "stored_competitors", "product_signals", "catalog_product_names", "catalog_product_handles", "stored_products", "positioning_signals", "source_url_count", "brand_excerpt", "answer_file"],
    ...rows.map((row) => [row.providerLabel, row.query, row.category, row.coverageScore, row.brandMentioned, row.domainCited, row.topPickRank || "", row.rawLength, row.rawCompetitorNames, row.storedCompetitors, row.productSignalNames, row.catalogProductNames, row.catalogProductHandles, row.storedProducts, row.positioningSignalNames, row.sourceUrlCount, row.brandExcerpt, row.answerFile || ""]),
  ]));
  await writeFile(path.join(outDir, "competitor-context-excerpts.csv"), csv([
    ["competitor", "provider", "query", "category", "brand_mentioned", "coverage_score", "excerpt"],
    ...rows.flatMap((row) => row.rawCompetitors.map((competitor) => [competitor.name, row.providerLabel, row.query, row.category, row.brandMentioned, row.coverageScore, competitor.excerpt])),
  ]));
  await writeFile(path.join(outDir, "product-signal-matrix.csv"), csv([
    ["product_signal", "provider", "query", "category", "brand_mentioned", "coverage_score", "excerpt"],
    ...rows.flatMap((row) => row.productSignals.map((signal) => [signal.name, row.providerLabel, row.query, row.category, row.brandMentioned, row.coverageScore, signal.excerpt])),
  ]));
  await writeFile(path.join(outDir, "catalog-product-evidence.csv"), csv([
    ["product_title", "handle", "alias", "alias_source", "provider", "query", "category", "brand_mentioned", "coverage_score", "excerpt"],
    ...rows.flatMap((row) => row.catalogProductsMentioned.map((product) => [product.title, product.handle, product.alias, product.aliasSource, row.providerLabel, row.query, row.category, row.brandMentioned, row.coverageScore, product.excerpt])),
  ]));
  await writeFile(path.join(outDir, "citation-url-audit.csv"), csv([
    ["provider", "query", "category", "brand_mentioned", "domain_cited", "source_url_count", "source_urls"],
    ...rows.map((row) => [row.providerLabel, row.query, row.category, row.brandMentioned, row.domainCited, row.sourceUrlCount, row.sourceUrls]),
  ]));
  await writeFile(path.join(outDir, "answer-evidence-data.json"), JSON.stringify({
    runId,
    stats,
    competitorCounts,
    productCounts,
    catalogProductCounts,
    positioningCounts,
    rows,
  }, null, 2));

  await writeSvgAndPng(outDir, "catalog-product-counts", barChart({
    title: "Actual Catalog Product Matches in AI Answers",
    subtitle: "Derived from local product titles, handles, SKUs, and variant/source aliases.",
    rows: catalogProductCounts.slice(0, 14).map((row) => ({ label: row.name, value: row.count })),
    color: "#0891b2",
  }));
  await writeSvgAndPng(outDir, "product-signal-counts", barChart({
    title: "Product and Category Signals in AI Answers",
    subtitle: "Manual signal detection over raw answer text, broader than exact product-title extraction.",
    rows: productCounts.slice(0, 14).map((row) => ({ label: row.name, value: row.count })),
    color: "#16a34a",
  }));
  await writeSvgAndPng(outDir, "raw-competitor-counts", barChart({
    title: "Competitors Appearing in Raw Answer Text",
    subtitle: "Counts from full saved answers, including brands not included in normalized battlecards.",
    rows: competitorCounts.slice(0, 14).map((row) => ({ label: row.name, value: row.count })),
    color: "#dc2626",
  }));
  await writeSvgAndPng(outDir, "positioning-signal-counts", barChart({
    title: "How Answers Frame the Category",
    subtitle: "Signals found around durability, specialization, modularity, value, and security.",
    rows: positioningCounts.map((row) => ({ label: row.name, value: row.count })),
    color: "#2563eb",
  }));

  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown({ stats, competitorCounts, productCounts, catalogProductCounts, positioningCounts, rows }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({ stats, rows, competitorCounts, productCounts, catalogProductCounts, positioningCounts }));
  console.log(path.relative(process.cwd(), outDir));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
