#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";
const REPORT_DIR = "product-name-truth-table";

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
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted && char === '"' && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => String(value ?? "").trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell.length || row.length) row.push(cell);
  if (row.length && row.some((value) => String(value ?? "").trim())) rows.push(row);
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

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function latestDir(prefix) {
  const root = path.join(process.cwd(), OUTPUT_ROOT);
  const entries = await readdir(root, { withFileTypes: true });
  const name = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  if (!name) throw new Error(`No ${prefix} directory found in ${OUTPUT_ROOT}.`);
  return path.join(root, name);
}

function num(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/^\+\d+\s+more$/i.test(item));
}

function unique(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[™®©]/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\bwith\b/g, "w")
    .replace(/\band\b/g, "&")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(?:ibolt|tm|for|all|the|a|an|mount|holder|stand)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value) {
  return new Set(normalize(value).split(" ").filter((token) => token.length > 2));
}

function similarity(left, right) {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return Math.round((intersection / union) * 100);
}

function productUrl(handle) {
  return handle ? `https://iboltmounts.com/products/${handle}` : "";
}

function short(value, length = 110) {
  const text = String(value ?? "");
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function addCounter(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function firstCounterItems(map, count = 6) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, count)
    .map(([label, value]) => `${label} ${value}`);
}

function top(rows, key, count = 10) {
  return [...rows].sort((a, b) => num(b[key]) - num(a[key]) || String(a.candidate || a.product).localeCompare(String(b.candidate || b.product))).slice(0, count);
}

function buildCatalog(products) {
  const byTitle = new Map();
  const byNormalized = new Map();
  for (const product of products) {
    byTitle.set(product.title, product);
    const aliases = unique([
      product.title,
      product.handle?.replaceAll("-", " "),
      String(product.title || "").replace(/[™®©]/g, ""),
      String(product.title || "").split(/\s+-\s+|\s+–\s+|\s+—\s+/)[0],
    ]);
    for (const alias of aliases) {
      const key = normalize(alias);
      if (key && !byNormalized.has(key)) byNormalized.set(key, product);
    }
  }
  return { byTitle, byNormalized };
}

function bestCatalogMatch(candidate, products) {
  const scored = products
    .map((product) => ({ product, score: similarity(candidate, product.title) }))
    .sort((a, b) => b.score - a.score || String(a.product.title).localeCompare(String(b.product.title)));
  return scored[0] || { product: null, score: 0 };
}

function buildQueryPageMap(pageRows) {
  const map = new Map();
  for (const row of pageRows) {
    const queries = unique([...splitList(row.retest_prompts), ...splitList(row.query_prompts)]);
    for (const query of queries) {
      const key = query.toLowerCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ title: row.title, url: row.url, category: row.category, rank: row.rank });
    }
  }
  return map;
}

function findPagesForCandidate({ row, queryPageMap, moduleRows, productWorkQueue }) {
  const pages = [];
  const queries = splitList(row.queries);
  for (const query of queries) {
    const mapped = queryPageMap.get(query.toLowerCase()) || [];
    for (const page of mapped) pages.push(page);
  }

  const candidateNorm = normalize(row.candidate);
  const matchedNorm = normalize(row.matched_title);
  for (const moduleRow of moduleRows) {
    const productNorm = normalize(moduleRow.product_name);
    const moduleMatchedNorm = normalize(moduleRow.matched_title);
    if (productNorm === candidateNorm || moduleMatchedNorm === matchedNorm || (matchedNorm && moduleMatchedNorm === matchedNorm)) {
      pages.push({ title: moduleRow.page_title, url: moduleRow.page_url, category: "", rank: "" });
    }
  }

  for (const work of productWorkQueue) {
    if (normalize(work.title) !== matchedNorm) continue;
    for (const target of splitList(work.target_pages)) {
      pages.push({ title: target, url: target.startsWith("http") ? target : "", category: work.high_risk_categories, rank: "" });
    }
  }

  const seen = new Set();
  return pages
    .filter((page) => page.title || page.url)
    .filter((page) => {
      const key = `${page.title}|${page.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

function classifyCandidate({ row, catalog, products }) {
  const score = num(row.best_match_score);
  const catalogProduct = catalog.byTitle.get(row.matched_title);
  const exact = catalog.byNormalized.get(normalize(row.candidate));
  const best = bestCatalogMatch(row.candidate, products);
  const bestTitle = catalogProduct?.title || best.product?.title || row.matched_title || "";
  const bestHandle = catalogProduct?.handle || best.product?.handle || "";
  const bestScore = catalogProduct ? Math.max(score, similarity(row.candidate, catalogProduct.title)) : Math.max(score, best.score);

  if (exact) {
    return {
      truth_status: "exact_catalog_name",
      confidence: 100,
      matched_title: exact.title,
      matched_handle: exact.handle,
      product_url: productUrl(exact.handle),
      action: "Preserve this exact Shopify product title in page copy, product cards, image alt text, and schema.",
    };
  }

  if (row.match_status === "matched" && bestScore >= 85 && bestTitle) {
    return {
      truth_status: "valid_alias_normalize_to_catalog_title",
      confidence: bestScore,
      matched_title: bestTitle,
      matched_handle: bestHandle,
      product_url: productUrl(bestHandle),
      action: `Use the exact Shopify title instead of the fuzzy AI name: ${bestTitle}.`,
    };
  }

  if (bestScore >= 55 && bestTitle) {
    return {
      truth_status: "manual_alias_review",
      confidence: bestScore,
      matched_title: bestTitle,
      matched_handle: bestHandle,
      product_url: productUrl(bestHandle),
      action: "Review whether this is an old product name, shorthand alias, or wrong product match before reinforcing it in copy.",
    };
  }

  return {
    truth_status: "hallucination_or_wrong_alias_risk",
    confidence: bestScore,
    matched_title: bestTitle,
    matched_handle: bestHandle,
    product_url: productUrl(bestHandle),
    action: "Do not reinforce this name as-is. Replace it with a verified Shopify title or omit it from product modules.",
  };
}

function buildTruthRows({ namingRows, productLanguageRows, products, moduleRows, pageRows, productWorkQueue }) {
  const catalog = buildCatalog(products);
  const queryPageMap = buildQueryPageMap(pageRows);
  const rows = [];

  for (const row of namingRows) {
    const truth = classifyCandidate({ row, catalog, products });
    const targetPages = findPagesForCandidate({ row: { ...row, matched_title: truth.matched_title }, queryPageMap, moduleRows, productWorkQueue });
    const categoryCount = splitList(row.categories).length;
    const providerCount = splitList(row.providers).length;
    const riskScore =
      num(row.appearances) * 12
      + providerCount * 5
      + categoryCount * 4
      + (truth.truth_status === "hallucination_or_wrong_alias_risk" ? 45 : truth.truth_status === "manual_alias_review" ? 25 : 8)
      + Math.max(0, 100 - truth.confidence) * 0.2;

    rows.push({
      candidate: row.candidate,
      source: "ai_candidate",
      appearances: num(row.appearances),
      truth_status: truth.truth_status,
      confidence: Math.round(truth.confidence),
      matched_title: truth.matched_title,
      matched_handle: truth.matched_handle,
      product_url: truth.product_url,
      providers: row.providers,
      categories: row.categories,
      queries: row.queries,
      target_pages: targetPages.map((page) => page.title || page.url).join("; "),
      target_urls: targetPages.map((page) => page.url).filter(Boolean).join("; "),
      risk_score: Math.round(riskScore),
      action: truth.action,
    });
  }

  for (const row of productLanguageRows) {
    if (rows.some((candidate) => normalize(candidate.candidate) === normalize(row.product))) continue;
    const exact = catalog.byTitle.get(row.product) || catalog.byNormalized.get(normalize(row.product));
    const truth = exact
      ? {
          truth_status: "exact_catalog_name",
          confidence: 100,
          matched_title: exact.title,
          matched_handle: exact.handle,
          product_url: productUrl(exact.handle),
          action: "Preserve and repeat this exact product title on pages where AI already recognizes it.",
        }
      : classifyCandidate({
          row: {
            candidate: row.product,
            matched_title: row.product,
            match_status: "review",
            best_match_score: 0,
          },
          catalog,
          products,
        });
    const targetPages = findPagesForCandidate({
      row: { candidate: row.product, matched_title: truth.matched_title, queries: row.queries },
      queryPageMap,
      moduleRows,
      productWorkQueue,
    });
    rows.push({
      candidate: row.product,
      source: "recognized_product_entity",
      appearances: num(row.appearances),
      truth_status: truth.truth_status,
      confidence: Math.round(truth.confidence),
      matched_title: truth.matched_title,
      matched_handle: truth.matched_handle,
      product_url: truth.product_url,
      providers: row.providers,
      categories: row.categories,
      queries: row.queries,
      target_pages: targetPages.map((page) => page.title || page.url).join("; "),
      target_urls: targetPages.map((page) => page.url).filter(Boolean).join("; "),
      risk_score: truth.truth_status === "exact_catalog_name" ? num(row.appearances) * 5 : num(row.appearances) * 12,
      action: truth.action,
    });
  }

  return rows.sort((a, b) => b.risk_score - a.risk_score || b.appearances - a.appearances || a.candidate.localeCompare(b.candidate));
}

function buildProviderRows(truthRows) {
  const map = new Map();
  for (const row of truthRows) {
    for (const providerPart of splitList(row.providers)) {
      const provider = providerPart.replace(/\s+\d+$/, "");
      if (!provider) continue;
      if (!map.has(provider)) {
        map.set(provider, {
          provider,
          candidates: 0,
          appearances: 0,
          exact_or_valid: 0,
          manual_review: 0,
          hallucination_risk: 0,
          top_candidates: [],
        });
      }
      const item = map.get(provider);
      item.candidates += 1;
      item.appearances += row.appearances;
      if (row.truth_status === "exact_catalog_name" || row.truth_status === "valid_alias_normalize_to_catalog_title") item.exact_or_valid += 1;
      if (row.truth_status === "manual_alias_review") item.manual_review += 1;
      if (row.truth_status === "hallucination_or_wrong_alias_risk") item.hallucination_risk += 1;
      item.top_candidates.push(`${row.candidate} -> ${row.truth_status}`);
    }
  }
  return [...map.values()]
    .map((row) => ({
      ...row,
      top_candidates: row.top_candidates.slice(0, 8).join("; "),
      risk_score: row.manual_review * 20 + row.hallucination_risk * 35 + row.appearances,
    }))
    .sort((a, b) => b.risk_score - a.risk_score);
}

function buildPageRows(truthRows) {
  const map = new Map();
  for (const row of truthRows) {
    const pages = splitList(row.target_pages);
    const urls = splitList(row.target_urls);
    pages.forEach((page, index) => {
      if (!map.has(page)) {
        map.set(page, {
          page,
          url: urls[index] || "",
          candidates: 0,
          valid_aliases: 0,
          manual_review: 0,
          hallucination_risk: 0,
          products_to_reinforce: new Set(),
          names_to_suppress: new Set(),
        });
      }
      const item = map.get(page);
      item.candidates += 1;
      if (row.truth_status === "exact_catalog_name" || row.truth_status === "valid_alias_normalize_to_catalog_title") {
        item.valid_aliases += 1;
        item.products_to_reinforce.add(row.matched_title);
      } else if (row.truth_status === "manual_alias_review") {
        item.manual_review += 1;
        item.products_to_reinforce.add(row.matched_title);
      } else {
        item.hallucination_risk += 1;
        item.names_to_suppress.add(row.candidate);
      }
    });
  }
  return [...map.values()]
    .map((row) => ({
      page: row.page,
      url: row.url,
      candidates: row.candidates,
      valid_aliases: row.valid_aliases,
      manual_review: row.manual_review,
      hallucination_risk: row.hallucination_risk,
      products_to_reinforce: [...row.products_to_reinforce].filter(Boolean).slice(0, 8).join("; "),
      names_to_suppress: [...row.names_to_suppress].slice(0, 8).join("; "),
      action:
        row.hallucination_risk > 0
          ? "Replace risky AI-visible names with verified Shopify titles before retesting product-entity prompts."
          : "Use exact matched titles in product cards, image alt text, FAQ answers, and schema.",
      priority: row.hallucination_risk * 40 + row.manual_review * 25 + row.valid_aliases * 8 + row.candidates,
    }))
    .sort((a, b) => b.priority - a.priority || a.page.localeCompare(b.page));
}

function buildCatalogReinforcementRows(truthRows, productWorkQueue) {
  const map = new Map();
  for (const row of truthRows) {
    if (!row.matched_title || !row.matched_handle) continue;
    if (!map.has(row.matched_title)) {
      const work = productWorkQueue.find((item) => normalize(item.title) === normalize(row.matched_title)) || {};
      map.set(row.matched_title, {
        product: row.matched_title,
        handle: row.matched_handle,
        product_url: row.product_url,
        appearances: 0,
        candidates: new Set(),
        statuses: new Map(),
        providers: new Map(),
        categories: new Map(),
        target_pages: new Set(),
        work_queue_priority: num(work.priority),
        work_queue_action: work.suggested_action || "",
      });
    }
    const item = map.get(row.matched_title);
    item.appearances += row.appearances;
    item.candidates.add(row.candidate);
    addCounter(item.statuses, row.truth_status);
    for (const provider of splitList(row.providers).map((part) => part.replace(/\s+\d+$/, ""))) addCounter(item.providers, provider);
    for (const category of splitList(row.categories).map((part) => part.replace(/\s+\d+$/, ""))) addCounter(item.categories, category);
    for (const page of splitList(row.target_pages)) item.target_pages.add(page);
  }

  return [...map.values()]
    .map((row) => ({
      priority: row.work_queue_priority + row.appearances * 8 + (row.statuses.get("hallucination_or_wrong_alias_risk") || 0) * 25 + (row.statuses.get("manual_alias_review") || 0) * 15,
      product: row.product,
      handle: row.handle,
      product_url: row.product_url,
      appearances: row.appearances,
      candidate_names: [...row.candidates].join("; "),
      status_mix: firstCounterItems(row.statuses, 5).join("; "),
      providers: firstCounterItems(row.providers, 5).join("; "),
      categories: firstCounterItems(row.categories, 5).join("; "),
      target_pages: [...row.target_pages].slice(0, 8).join("; "),
      action: row.work_queue_action || "Reinforce exact product title in relevant product modules, alt text, and schema.",
    }))
    .sort((a, b) => b.priority - a.priority);
}

function barSvg({ title, rows, labelKey, valueKey, color = "#0f766e", maxRows = 10 }) {
  const chartRows = rows.slice(0, maxRows);
  const width = 940;
  const rowHeight = 36;
  const height = 76 + chartRows.length * rowHeight;
  const max = Math.max(1, ...chartRows.map((row) => num(row[valueKey])));
  const bars = chartRows.map((row, index) => {
    const y = 58 + index * rowHeight;
    const barWidth = Math.max(2, Math.round((num(row[valueKey]) / max) * 520));
    return `<g>
      <text x="22" y="${y + 17}" fill="#111827" font-size="13" font-weight="800">${escapeHtml(short(row[labelKey], 42))}</text>
      <rect x="326" y="${y}" width="520" height="22" rx="11" fill="#e5e7eb"/>
      <rect x="326" y="${y}" width="${barWidth}" height="22" rx="11" fill="${color}"/>
      <text x="906" y="${y + 16}" fill="#111827" font-size="13" font-weight="900" text-anchor="end">${escapeHtml(row[valueKey])}</text>
    </g>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#ffffff"/>
    <text x="22" y="34" fill="#111827" font-size="20" font-weight="900">${escapeHtml(title)}</text>
    ${bars}
  </svg>`;
}

function table(rows, columns) {
  const head = columns.map(([label]) => `<th>${escapeHtml(label)}</th>`).join("");
  const body = rows.map((row) => `<tr>${columns.map(([, key]) => `<td>${escapeHtml(row[key])}</td>`).join("")}</tr>`).join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function markdownTable(rows, columns) {
  return [
    `| ${columns.map(([label]) => label).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${columns.map(([, key]) => String(row[key] ?? "").replaceAll("|", "\\|")).join(" | ")} |`),
  ].join("\n");
}

function buildMarkdown({ summary, truthRows, pageRows, catalogRows, providerRows }) {
  return `# Product Name Truth Table

## Bottom Line

AI systems are mentioning iBOLT products, but the product-name layer is still noisy. This report separates exact catalog names, valid aliases that should be normalized to Shopify titles, manual alias reviews, and hallucination or wrong-alias risks.

Current truth table: ${summary.candidates} AI-visible product candidates, ${summary.exactCatalogNames} exact catalog names, ${summary.validAliases} valid aliases, ${summary.manualReview} manual alias reviews, and ${summary.hallucinationRisk} hallucination or wrong-alias risks.

## Product Candidate Truth Table

${markdownTable(top(truthRows, "risk_score", 18), [
  ["Risk", "risk_score"],
  ["Candidate", "candidate"],
  ["Status", "truth_status"],
  ["Confidence", "confidence"],
  ["Catalog title", "matched_title"],
  ["Providers", "providers"],
  ["Queries", "queries"],
  ["Action", "action"],
])}

## Page Correction Map

${markdownTable(top(pageRows, "priority", 15), [
  ["Priority", "priority"],
  ["Page", "page"],
  ["Review", "manual_review"],
  ["Risk", "hallucination_risk"],
  ["Reinforce", "products_to_reinforce"],
  ["Suppress", "names_to_suppress"],
  ["Action", "action"],
])}

## Catalog Reinforcement Queue

${markdownTable(top(catalogRows, "priority", 12), [
  ["Priority", "priority"],
  ["Product", "product"],
  ["Appearances", "appearances"],
  ["Candidates", "candidate_names"],
  ["Categories", "categories"],
  ["Target pages", "target_pages"],
  ["Action", "action"],
])}

## Provider Risk

${markdownTable(providerRows, [
  ["Provider", "provider"],
  ["Candidates", "candidates"],
  ["Exact/valid", "exact_or_valid"],
  ["Review", "manual_review"],
  ["Risk", "hallucination_risk"],
  ["Top candidates", "top_candidates"],
])}
`;
}

function buildHtml({ summary, truthRows, pageRows, catalogRows, providerRows, charts }) {
  const cards = [
    ["Candidates", summary.candidates, "AI-visible product names"],
    ["Exact names", summary.exactCatalogNames, "already match catalog"],
    ["Valid aliases", summary.validAliases, "normalize to Shopify titles"],
    ["Manual review", summary.manualReview, "possible old names or shorthand"],
    ["Risk names", summary.hallucinationRisk, "suppress or replace"],
    ["Pages mapped", summary.pagesMapped, "pages needing correction"],
  ].map(([label, value, note]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Product Name Truth Table</title>
<style>
body{margin:0;background:#f6f8fb;color:#111827;font-family:Arial,Helvetica,sans-serif}main{max-width:1240px;margin:0 auto;padding:34px 24px 64px}h1{font-size:36px;margin:0 0 8px;letter-spacing:0}h2{font-size:23px;margin:34px 0 12px}p,li{line-height:1.55;color:#334155;font-size:15px}.note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #0f766e;border-radius:12px;padding:16px 18px;margin:20px 0}.warn{border-left-color:#f97316}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:16px}.label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:900}.value{font-size:30px;font-weight:900;margin:8px 0;color:#0f172a}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}.chart{background:#fff;border:1px solid #dbe3ef;border-radius:18px;padding:10px;overflow:auto}.chart svg{width:100%;height:auto;display:block}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 22px}th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}a{color:#0f766e;overflow-wrap:anywhere}@media(max-width:900px){.cards,.grid{grid-template-columns:1fr}h1{font-size:30px}}
</style></head><body><main>
<h1>Product Name Truth Table</h1>
<p>This report audits how AI systems name iBOLT products and maps each candidate to a verified Shopify title, manual review, or hallucination-risk correction.</p>
<div class="note"><strong>Why this matters:</strong> exact product names are the bridge from generic brand mentions to source-backed recommendations. Do not reinforce fuzzy AI names until they are normalized to a verified catalog title.</div>
<section class="cards">${cards}</section>
<section class="grid"><div class="chart">${charts.providers}</div><div class="chart">${charts.catalog}</div></section>
<h2>Product Candidate Truth Table</h2>
${table(top(truthRows, "risk_score", 22), [
  ["Risk", "risk_score"],
  ["Candidate", "candidate"],
  ["Status", "truth_status"],
  ["Confidence", "confidence"],
  ["Catalog title", "matched_title"],
  ["Providers", "providers"],
  ["Queries", "queries"],
  ["Action", "action"],
])}
<h2>Page Correction Map</h2>
${table(top(pageRows, "priority", 18), [
  ["Priority", "priority"],
  ["Page", "page"],
  ["Review", "manual_review"],
  ["Risk", "hallucination_risk"],
  ["Reinforce", "products_to_reinforce"],
  ["Suppress", "names_to_suppress"],
  ["Action", "action"],
])}
<h2>Catalog Reinforcement Queue</h2>
${table(top(catalogRows, "priority", 14), [
  ["Priority", "priority"],
  ["Product", "product"],
  ["Appearances", "appearances"],
  ["Candidates", "candidate_names"],
  ["Categories", "categories"],
  ["Target pages", "target_pages"],
  ["Action", "action"],
])}
<h2>Provider Risk</h2>
${table(providerRows, [
  ["Provider", "provider"],
  ["Candidates", "candidates"],
  ["Exact/valid", "exact_or_valid"],
  ["Review", "manual_review"],
  ["Risk", "hallucination_risk"],
  ["Top candidates", "top_candidates"],
])}
</main></body></html>`;
}

async function main() {
  const benchmarkDir = process.argv[2] ? path.resolve(process.argv[2]) : await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, REPORT_DIR);
  await mkdir(outDir, { recursive: true });

  const namingRows = await readCsv(path.join(benchmarkDir, "mention-language-command-deck", "product-entity-naming-audit.csv"));
  const productLanguageRows = await readCsv(path.join(benchmarkDir, "mention-language-command-deck", "product-entity-language.csv"));
  const products = await readCsv(path.join(benchmarkDir, "blog-inventory-audit", "product-spread.csv"));
  const moduleRows = await readCsv(path.join(benchmarkDir, "product-entity-coverage-plan", "module-product-match-audit.csv"));
  const pageRows = await readCsv(path.join(benchmarkDir, "page-edit-command-matrix", "page-edit-command-matrix.csv"));
  const productWorkQueue = await readCsv(path.join(benchmarkDir, "product-entity-coverage-plan", "product-entity-work-queue.csv"));
  const master = await readJson(path.join(benchmarkDir, "master-dossier", "master-dossier-data.json"), {});

  const truthRows = buildTruthRows({ namingRows, productLanguageRows, products, moduleRows, pageRows, productWorkQueue });
  const providerRows = buildProviderRows(truthRows);
  const pageCorrectionRows = buildPageRows(truthRows);
  const catalogRows = buildCatalogReinforcementRows(truthRows, productWorkQueue);
  const statusCounts = truthRows.reduce((map, row) => {
    addCounter(map, row.truth_status);
    return map;
  }, new Map());
  const summary = {
    generatedAt: new Date().toISOString(),
    benchmarkDir,
    candidates: truthRows.length,
    aiCandidateRows: namingRows.length,
    recognizedProductRows: productLanguageRows.length,
    exactCatalogNames: statusCounts.get("exact_catalog_name") || 0,
    validAliases: statusCounts.get("valid_alias_normalize_to_catalog_title") || 0,
    manualReview: statusCounts.get("manual_alias_review") || 0,
    hallucinationRisk: statusCounts.get("hallucination_or_wrong_alias_risk") || 0,
    pagesMapped: pageCorrectionRows.length,
    catalogProductsQueued: catalogRows.length,
    providerRows: providerRows.length,
    baselineCatalogAliasRows: master.mentionSummary?.catalogProductAliasAnswers || master.evidenceSummary?.catalogProductRows || 8,
    targetCatalogAliasRows: 20,
    highestRiskCandidates: top(truthRows, "risk_score", 8).map((row) => `${row.candidate} -> ${row.truth_status}`),
  };

  const charts = {
    providers: barSvg({ title: "Provider Product-Name Risk", rows: providerRows, labelKey: "provider", valueKey: "risk_score", color: "#dc2626" }),
    catalog: barSvg({ title: "Catalog Products To Reinforce", rows: catalogRows, labelKey: "product", valueKey: "priority", color: "#2563eb" }),
  };

  await writeFile(path.join(outDir, "provider-product-name-risk.svg"), charts.providers);
  await writeFile(path.join(outDir, "catalog-title-reinforcement.svg"), charts.catalog);
  await writeFile(path.join(outDir, "product-name-truth-data.json"), `${JSON.stringify({
    summary,
    truthRows,
    pageCorrectionRows,
    catalogRows,
    providerRows,
  }, null, 2)}\n`);
  await writeFile(path.join(outDir, "product-name-truth-table.csv"), csv([
    [
      "risk_score",
      "candidate",
      "source",
      "appearances",
      "truth_status",
      "confidence",
      "matched_title",
      "matched_handle",
      "product_url",
      "providers",
      "categories",
      "queries",
      "target_pages",
      "target_urls",
      "action",
    ],
    ...truthRows.map((row) => [
      row.risk_score,
      row.candidate,
      row.source,
      row.appearances,
      row.truth_status,
      row.confidence,
      row.matched_title,
      row.matched_handle,
      row.product_url,
      row.providers,
      row.categories,
      row.queries,
      row.target_pages,
      row.target_urls,
      row.action,
    ]),
  ]));
  await writeFile(path.join(outDir, "page-product-name-correction-map.csv"), csv([
    ["priority", "page", "url", "candidates", "valid_aliases", "manual_review", "hallucination_risk", "products_to_reinforce", "names_to_suppress", "action"],
    ...pageCorrectionRows.map((row) => [
      row.priority,
      row.page,
      row.url,
      row.candidates,
      row.valid_aliases,
      row.manual_review,
      row.hallucination_risk,
      row.products_to_reinforce,
      row.names_to_suppress,
      row.action,
    ]),
  ]));
  await writeFile(path.join(outDir, "catalog-title-reinforcement-queue.csv"), csv([
    ["priority", "product", "handle", "product_url", "appearances", "candidate_names", "status_mix", "providers", "categories", "target_pages", "action"],
    ...catalogRows.map((row) => [
      row.priority,
      row.product,
      row.handle,
      row.product_url,
      row.appearances,
      row.candidate_names,
      row.status_mix,
      row.providers,
      row.categories,
      row.target_pages,
      row.action,
    ]),
  ]));
  await writeFile(path.join(outDir, "provider-product-name-risk.csv"), csv([
    ["provider", "risk_score", "candidates", "appearances", "exact_or_valid", "manual_review", "hallucination_risk", "top_candidates"],
    ...providerRows.map((row) => [
      row.provider,
      row.risk_score,
      row.candidates,
      row.appearances,
      row.exact_or_valid,
      row.manual_review,
      row.hallucination_risk,
      row.top_candidates,
    ]),
  ]));
  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown({ summary, truthRows, pageRows: pageCorrectionRows, catalogRows, providerRows }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({ summary, truthRows, pageRows: pageCorrectionRows, catalogRows, providerRows, charts }));

  console.log(`Wrote ${path.relative(process.cwd(), outDir)}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
