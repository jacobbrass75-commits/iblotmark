import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";

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
  const name = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  if (!name) throw new Error(`No ${prefix} directory found in ${OUTPUT_ROOT}`);
  return path.join(process.cwd(), OUTPUT_ROOT, name);
}

function num(value) {
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(count, total) {
  if (!total) return 0;
  return Math.round((count / total) * 100);
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

function top(rows, key, count = 10) {
  return [...rows].sort((a, b) => num(b[key]) - num(a[key]) || String(a.title || a.family).localeCompare(String(b.title || b.family))).slice(0, count);
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
    .replace(/\b(?:ibolt|tm|for|all|the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value) {
  return new Set(normalize(value).split(" ").filter((token) => token.length > 2));
}

function jaccard(a, b) {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((token) => right.has(token)).length;
  return intersection / new Set([...left, ...right]).size;
}

function productUrl(handle) {
  return handle ? `https://iboltmounts.com/products/${handle}` : "";
}

function productMatchScore(input, product) {
  const query = normalize(input);
  const title = normalize(product.title);
  if (!query || !title) return 0;
  if (query === title) return 1;
  if (title.includes(query) || query.includes(title)) return 0.92;
  const productTokens = tokenSet(product.title);
  const queryTokens = tokenSet(input);
  const overlap = [...queryTokens].filter((token) => productTokens.has(token)).length;
  const overlapRatio = overlap / Math.max(1, Math.min(productTokens.size, queryTokens.size));
  return Math.max(jaccard(input, product.title), overlapRatio * 0.72);
}

function buildProductMatcher(products) {
  return (name) => {
    const scored = products
      .map((product) => ({ product, score: productMatchScore(name, product) }))
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    return best?.score >= 0.5 ? best : null;
  };
}

function categorizeProduct(product) {
  const text = `${product.title} ${product.verticals} ${product.topics}`.toLowerCase();
  const categories = [];
  const tests = [
    ["restaurant", /\b(restaurant|pos|tablet tower|lockpro|food truck|delivery app|toast|square)\b/],
    ["delivery", /\b(delivery|amazon flex|instacart|doordash|ubereats|driver)\b/],
    ["fleet", /\b(fleet|truck|vehicle|eld|van|dashboard|windshield|construction|work truck)\b/],
    ["warehouse", /\b(warehouse|forklift|barcode|scanner|material handling|vesa)\b/],
    ["fishing", /\b(fish finder|marine|boat|kayak|pontoon|garmin striker|lowrance|humminbird)\b/],
    ["tablet", /\b(tablet|tabdock|ipad|samsung tab)\b/],
    ["streaming", /\b(streaming|camera|gopro|1 4|20 camera|creator|action camera)\b/],
    ["amps/modular", /\b(amps|ball|adapter|plate|socket|drill base|clamp|bizmount|incredibolt)\b/],
  ];
  for (const [category, regex] of tests) {
    if (regex.test(text)) categories.push(category);
  }
  return unique([...splitList(product.topics), ...categories]);
}

function categoryPriorityFor(product, categoryRows) {
  const productCategories = categorizeProduct(product);
  const scores = categoryRows
    .filter((row) => productCategories.some((category) => category === row.category || category.includes(row.category) || row.category.includes(category)))
    .map((row) => num(row.priority_score));
  return scores.length ? Math.max(...scores) : 0;
}

function readinessMap(rows) {
  return Object.fromEntries(rows.map((row) => [row.metric, num(row.count)]));
}

function familyPriority(row, categoryRows) {
  const topicText = row.topics || "";
  const categoryBoost = categoryRows.reduce((score, category) => {
    return topicText.toLowerCase().includes(category.category.toLowerCase()) ? score + num(category.priority_score) : score;
  }, 0);
  return num(row.unlinked_products) * 3 + Math.round(categoryBoost / 8) + splitList(row.target_pages).length * 2;
}

function addToMapList(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function buildModuleAudit({ products, pageModules, queryRows, survivorTickets }) {
  const matchProduct = buildProductMatcher(products);
  const audit = [];
  const byHandle = new Map();

  const ingest = ({ source, pageTitle, pageUrl, priority, prompt, productsText, ticketFile, competitors }) => {
    for (const productName of splitList(productsText)) {
      const match = matchProduct(productName);
      const row = {
        source,
        priority,
        page_title: pageTitle,
        page_url: pageUrl,
        prompt,
        ticket_file: ticketFile,
        competitors,
        product_name: productName,
        matched: match ? "yes" : "no",
        matched_title: match?.product.title || "",
        matched_handle: match?.product.handle || "",
        match_score: match ? Math.round(match.score * 100) : 0,
      };
      audit.push(row);
      if (match?.product.handle) addToMapList(byHandle, match.product.handle, row);
    }
  };

  for (const row of pageModules) {
    ingest({
      source: "page-refresh-playbook",
      pageTitle: row.page_title,
      pageUrl: row.page_url,
      priority: 0,
      prompt: "",
      productsText: row.products_to_add || row.product_module,
      ticketFile: "",
      competitors: "",
    });
  }

  for (const row of queryRows) {
    ingest({
      source: "query-page-matrix",
      pageTitle: row.page_title,
      pageUrl: row.page_url,
      priority: num(row.priority),
      prompt: row.query,
      productsText: row.products_to_add,
      ticketFile: "",
      competitors: row.competitors,
    });
  }

  for (const row of survivorTickets) {
    ingest({
      source: "survivor-edit-tickets",
      pageTitle: row.page_title,
      pageUrl: row.page_url,
      priority: num(row.priority),
      prompt: row.prompts_to_preserve,
      productsText: row.product_modules,
      ticketFile: row.ticket_file,
      competitors: row.competitors,
    });
  }

  return { audit, byHandle };
}

function buildFamilyRows({ productLinkingPlan, categoryRows }) {
  return productLinkingPlan.map((row) => ({
    priority: familyPriority(row, categoryRows),
    family: row.family,
    unlinked_products: num(row.unlinked_products),
    topics: row.topics,
    sample_products: row.sample_products,
    target_pages: row.target_pages,
    action: row.action,
  })).sort((a, b) => b.priority - a.priority);
}

function buildProductQueue({ products, unlinked, moduleByHandle, familyRows, categoryRows }) {
  const unlinkedByHandle = new Map(unlinked.map((row) => [row.handle, row]));
  const familyByProduct = new Map();

  for (const family of familyRows) {
    for (const sample of splitList(family.sample_products)) {
      const matcher = buildProductMatcher(products);
      const match = matcher(sample);
      if (match?.product.handle) addToMapList(familyByProduct, match.product.handle, family);
    }
  }

  const rows = products.map((product) => {
    const linkedPosts = num(product.blog_link_post_count);
    const isUnlinked = linkedPosts === 0;
    const moduleRows = moduleByHandle.get(product.handle) || [];
    const families = familyByProduct.get(product.handle) || [];
    const categoryPriority = categoryPriorityFor(product, categoryRows);
    const familyPrioritySum = families.reduce((sum, family) => sum + num(family.priority), 0);
    const modulePriority = moduleRows.reduce((sum, row) => sum + num(row.priority), 0);
    const categories = categorizeProduct(product);
    const highRiskCategories = categories.filter((category) => categoryRows.some((row) => row.category === category && num(row.priority_score) >= 100));
    const reasons = [];

    let priority = Math.round(categoryPriority / 2);
    if (isUnlinked) {
      priority += 85;
      reasons.push("no detected blog links");
    } else if (linkedPosts <= 2) {
      priority += 25;
      reasons.push("thin internal linking");
    }
    if (moduleRows.length) {
      priority += 55 + Math.min(80, Math.round(modulePriority / 12));
      reasons.push("needed in benchmark-driven page modules");
    }
    if (families.length) {
      priority += 20 + Math.min(35, Math.round(familyPrioritySum / 20));
      reasons.push("belongs to high-unlinked product family");
    }
    if (highRiskCategories.length) {
      priority += 22;
      reasons.push(`high-risk benchmark topic: ${highRiskCategories.join(", ")}`);
    }
    if (String(product.has_photos) !== "true" || num(product.photo_count) === 0) {
      priority += 8;
      reasons.push("no detected blog photo-bank coverage");
    }

    const targetPages = unique(moduleRows.map((row) => row.page_url).filter(Boolean));
    const targetTickets = unique(moduleRows.map((row) => row.ticket_file).filter(Boolean));
    const prompts = unique(moduleRows.flatMap((row) => splitList(row.prompt)));
    const competitors = unique(moduleRows.flatMap((row) => splitList(row.competitors)));
    const action = moduleRows.length
      ? "Add or verify this product in the named page module with image, price, use case, and exact anchor text."
      : isUnlinked
        ? "Add contextual SKU-level links from the target family pages and write a short product entity block."
        : "Strengthen existing mentions with specs, compatibility, image alt text, and Product/Offer support.";

    return {
      priority,
      title: product.title,
      handle: product.handle,
      product_url: productUrl(product.handle),
      price: product.price,
      linked_posts: linkedPosts,
      verticals: product.verticals,
      topics: product.topics,
      inferred_categories: categories.join("; "),
      high_risk_categories: highRiskCategories.join("; "),
      module_page_count: targetPages.length,
      module_sources: unique(moduleRows.map((row) => row.source)).join("; "),
      target_pages: targetPages.join("; "),
      ticket_files: targetTickets.join("; "),
      prompts_to_support: prompts.join("; "),
      competitor_context: competitors.join("; "),
      families: unique(families.map((family) => family.family)).join("; "),
      reason: unique([unlinkedByHandle.get(product.handle)?.reason, ...reasons]).join("; "),
      suggested_action: action,
    };
  });

  return rows
    .filter((row) => row.priority > 80 || row.linked_posts === 0 || row.module_page_count > 0)
    .sort((a, b) => b.priority - a.priority);
}

function buildReadinessRows(summary) {
  const total = summary.total_products || 0;
  return [
    ["missing_sku", "Add SKU/model fields to product exports and Product schema.", summary.missing_sku || 0],
    ["missing_availability", "Add availability/stock state for Offer schema.", summary.missing_availability || 0],
    ["missing_specs", "Add dimensions, material, ball size, device fit, and mounting method specs.", summary.missing_specs || 0],
    ["missing_compatibility", "Add compatibility fields such as AMPS, 17mm, 20mm, 25mm, 38mm, VESA, device sizes.", summary.missing_compatibility || 0],
    ["missing_image", "Fix missing image records before using product cards in articles.", summary.missing_image || 0],
    ["without_vertical_mapping", "Map products into verticals so the pipeline selects them reliably.", summary.without_vertical_mapping || 0],
    ["unknown_product_handles_in_posts", "Resolve product handles already linked from posts but unknown to catalog.", summary.unknown_product_handles_in_posts || 0],
  ].map(([gap, action, count]) => ({
    gap,
    affected_products: count,
    affected_rate: pct(count, total),
    action,
  }));
}

function barSvg({ title, rows, labelKey, valueKey, maxValue, color = "#1d4ed8" }) {
  const width = 940;
  const rowHeight = 34;
  const topOffset = 56;
  const height = topOffset + rows.length * rowHeight + 24;
  const labelWidth = 390;
  const barWidth = 390;
  const max = maxValue || Math.max(1, ...rows.map((row) => num(row[valueKey])));
  const bars = rows.map((row, index) => {
    const value = num(row[valueKey]);
    const y = topOffset + index * rowHeight;
    const w = Math.max(2, Math.round((value / max) * barWidth));
    return `<text x="22" y="${y + 16}" fill="#0f172a" font-size="13">${escapeHtml(row[labelKey]).slice(0, 58)}</text>
<rect x="${labelWidth}" y="${y}" width="${barWidth}" height="20" rx="4" fill="#e2e8f0"/>
<rect x="${labelWidth}" y="${y}" width="${w}" height="20" rx="4" fill="${color}"/>
<text x="${labelWidth + barWidth + 12}" y="${y + 15}" fill="#0f172a" font-size="13" font-weight="700">${escapeHtml(value)}</text>`;
  }).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="#ffffff"/>
<text x="22" y="34" fill="#0f172a" font-size="22" font-weight="800">${escapeHtml(title)}</text>
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

function buildMarkdown({ summary, productQueue, familyRows, readinessRows, moduleAudit }) {
  const matched = moduleAudit.filter((row) => row.matched === "yes").length;
  const unmatched = moduleAudit.length - matched;
  return `# iBOLT Product Entity Coverage Plan

## Bottom Line

Yes, citation rate should be improved, but the practical fix is product-entity clarity. AI systems are more likely to cite pages when the page gives them a clean answer, named products, product images, specs, compatibility, schema, and a stable source URL. The current product audit shows ${summary.totalProducts} catalog products, ${summary.linkedProducts} linked from detected blog content, and ${summary.unlinkedProducts} unlinked.

The saved benchmark already proves iBOLT is being mentioned sometimes, but the site is weak at turning those mentions into source-backed recommendations. This report prioritizes the products and pages most likely to improve non-branded mentions, top-3 recommendation rate, and citation rate.

## Key Metrics

- Product catalog rows reviewed: ${summary.totalProducts}.
- Products linked from detected blog content: ${summary.linkedProducts} (${summary.linkedProductRate}%).
- Products with no detected blog links: ${summary.unlinkedProducts} (${summary.unlinkedProductRate}%).
- Benchmark/page module product references audited: ${moduleAudit.length}.
- Module product references matched to catalog products: ${matched}.
- Module product references needing manual matching: ${unmatched}.
- Product/entity work queue rows: ${productQueue.length}.
- Product families with unlinked inventory: ${familyRows.length}.

## First Product Entity Fixes

${markdownTable(top(productQueue, "priority", 12), [
  ["Priority", "priority"],
  ["Product", "title"],
  ["Links", "linked_posts"],
  ["Pages", "module_page_count"],
  ["Topics", "high_risk_categories"],
  ["Action", "suggested_action"],
])}

## Product Families To Cover

${markdownTable(top(familyRows, "priority", 8), [
  ["Priority", "priority"],
  ["Family", "family"],
  ["Unlinked", "unlinked_products"],
  ["Topics", "topics"],
  ["Action", "action"],
])}

## Product Data Gaps Blocking Citation Readiness

${markdownTable(readinessRows, [
  ["Gap", "gap"],
  ["Affected", "affected_products"],
  ["Rate", "affected_rate"],
  ["Action", "action"],
])}
`;
}

function buildHtml({ summary, productQueue, familyRows, readinessRows, moduleAudit, charts }) {
  const matched = moduleAudit.filter((row) => row.matched === "yes").length;
  const cards = [
    ["Catalog products", summary.totalProducts, "known Shopify products"],
    ["Linked products", `${summary.linkedProducts}/${summary.totalProducts}`, `${summary.linkedProductRate}% linked`],
    ["Unlinked products", `${summary.unlinkedProducts}/${summary.totalProducts}`, `${summary.unlinkedProductRate}% unlinked`],
    ["Module matches", `${matched}/${moduleAudit.length}`, "benchmark page modules"],
    ["Work queue", productQueue.length, "product/entity fixes"],
    ["Families", familyRows.length, "coverage groups"],
  ].map(([label, value, note]) => `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>iBOLT Product Entity Coverage Plan</title>
<style>
body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}main{max-width:1240px;margin:0 auto;padding:34px 26px 60px}h1{font-size:34px;margin:0 0 8px}h2{font-size:22px;margin:34px 0 14px}p{color:#334155;line-height:1.55}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}.k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700}.v{font-size:30px;font-weight:800;margin-top:8px}.note{border-left:6px solid #2563eb;background:#fff;border-radius:10px;padding:16px 18px;border-top:1px solid #d7dee8;border-right:1px solid #d7dee8;border-bottom:1px solid #d7dee8}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden}th,td{text-align:left;vertical-align:top;padding:11px 12px;border-bottom:1px solid #edf2f7;font-size:14px}th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:12px;letter-spacing:.04em}.charts{display:grid;grid-template-columns:1fr;gap:18px}.chart{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:12px;overflow:auto}
</style></head><body><main>
<h1>iBOLT Product Entity Coverage Plan</h1>
<p class="note"><strong>Why this matters:</strong> citation lift needs source-ready pages. That means clear answer blocks, named iBOLT products, exact use cases, specs, compatibility, images, and schema. Product entity coverage is the bridge between a generic AI answer and a source-backed recommendation.</p>
<section class="cards">${cards}</section>
<section class="charts"><div class="chart">${charts.products}</div><div class="chart">${charts.families}</div></section>
<h2>First Product Entity Fixes</h2>
${table(top(productQueue, "priority", 14), [
  ["Priority", "priority"],
  ["Product", "title"],
  ["Links", "linked_posts"],
  ["Module pages", "module_page_count"],
  ["High-risk topics", "high_risk_categories"],
  ["Target pages", "target_pages"],
  ["Action", "suggested_action"],
])}
<h2>Product Families To Cover</h2>
${table(top(familyRows, "priority", 10), [
  ["Priority", "priority"],
  ["Family", "family"],
  ["Unlinked", "unlinked_products"],
  ["Topics", "topics"],
  ["Target pages", "target_pages"],
  ["Action", "action"],
])}
<h2>Readiness Gaps</h2>
${table(readinessRows, [
  ["Gap", "gap"],
  ["Affected", "affected_products"],
  ["Rate", "affected_rate"],
  ["Action", "action"],
])}
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, "product-entity-coverage-plan");
  await mkdir(outDir, { recursive: true });

  const products = await readCsv(path.join(benchmarkDir, "blog-inventory-audit", "product-spread.csv"));
  const unlinked = await readCsv(path.join(benchmarkDir, "blog-inventory-audit", "unlinked-product-opportunities.csv"));
  const readiness = readinessMap(await readCsv(path.join(benchmarkDir, "blog-inventory-audit", "product-readiness-summary.csv")));
  const productLinkingPlan = await readCsv(path.join(benchmarkDir, "content-refresh-roadmap", "product-linking-plan.csv"));
  const pageModules = await readCsv(path.join(benchmarkDir, "page-refresh-playbook", "product-modules-by-page.csv"));
  const queryRows = await readCsv(path.join(benchmarkDir, "query-page-matrix", "all-query-page-matrix.csv"));
  const survivorTickets = await readCsv(path.join(benchmarkDir, "survivor-edit-tickets", "survivor-edit-ticket-index.csv"));
  const categoryRows = await readCsv(path.join(benchmarkDir, "visibility-scorecard", "category-priority-scorecard.csv"));

  const linkedProducts = products.filter((row) => num(row.blog_link_post_count) > 0).length;
  const unlinkedProducts = products.length - linkedProducts;
  const familyRows = buildFamilyRows({ productLinkingPlan, categoryRows });
  const { audit: moduleAudit, byHandle: moduleByHandle } = buildModuleAudit({ products, pageModules, queryRows, survivorTickets });
  const productQueue = buildProductQueue({ products, unlinked, moduleByHandle, familyRows, categoryRows });
  const readinessRows = buildReadinessRows(readiness);
  const summary = {
    benchmarkDir,
    totalProducts: products.length,
    linkedProducts,
    linkedProductRate: pct(linkedProducts, products.length),
    unlinkedProducts,
    unlinkedProductRate: pct(unlinkedProducts, products.length),
    workQueueRows: productQueue.length,
    familyRows: familyRows.length,
    moduleReferences: moduleAudit.length,
    moduleMatchedReferences: moduleAudit.filter((row) => row.matched === "yes").length,
    moduleUnmatchedReferences: moduleAudit.filter((row) => row.matched !== "yes").length,
    readiness,
  };

  const charts = {
    products: barSvg({ title: "Top Product Entity Fixes", rows: top(productQueue, "priority", 10), labelKey: "title", valueKey: "priority", color: "#2563eb" }),
    families: barSvg({ title: "Product Families With Unlinked Inventory", rows: top(familyRows, "priority", 8), labelKey: "family", valueKey: "unlinked_products", color: "#0f766e" }),
  };

  await writeFile(path.join(outDir, "product-entity-work-queue.csv"), csv([
    ["priority", "title", "handle", "product_url", "price", "linked_posts", "verticals", "topics", "inferred_categories", "high_risk_categories", "module_page_count", "module_sources", "target_pages", "ticket_files", "prompts_to_support", "competitor_context", "families", "reason", "suggested_action"],
    ...productQueue.map((row) => [row.priority, row.title, row.handle, row.product_url, row.price, row.linked_posts, row.verticals, row.topics, row.inferred_categories, row.high_risk_categories, row.module_page_count, row.module_sources, row.target_pages, row.ticket_files, row.prompts_to_support, row.competitor_context, row.families, row.reason, row.suggested_action]),
  ]));
  await writeFile(path.join(outDir, "module-product-match-audit.csv"), csv([
    ["source", "priority", "page_title", "page_url", "prompt", "ticket_file", "competitors", "product_name", "matched", "matched_title", "matched_handle", "match_score"],
    ...moduleAudit.map((row) => [row.source, row.priority, row.page_title, row.page_url, row.prompt, row.ticket_file, row.competitors, row.product_name, row.matched, row.matched_title, row.matched_handle, row.match_score]),
  ]));
  await writeFile(path.join(outDir, "product-family-coverage-summary.csv"), csv([
    ["priority", "family", "unlinked_products", "topics", "sample_products", "target_pages", "action"],
    ...familyRows.map((row) => [row.priority, row.family, row.unlinked_products, row.topics, row.sample_products, row.target_pages, row.action]),
  ]));
  await writeFile(path.join(outDir, "readiness-gaps.csv"), csv([
    ["gap", "affected_products", "affected_rate", "action"],
    ...readinessRows.map((row) => [row.gap, row.affected_products, row.affected_rate, row.action]),
  ]));
  await writeFile(path.join(outDir, "top-product-entity-fixes.svg"), charts.products);
  await writeFile(path.join(outDir, "product-family-coverage.svg"), charts.families);
  await writeFile(path.join(outDir, "product-entity-data.json"), `${JSON.stringify({ summary, productQueue: productQueue.slice(0, 100), familyRows, readinessRows, moduleAuditSummary: summary }, null, 2)}\n`);
  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown({ summary, productQueue, familyRows, readinessRows, moduleAudit }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({ summary, productQueue, familyRows, readinessRows, moduleAudit, charts }));

  console.log(`Wrote ${outDir}`);
  console.log(`Product/entity work queue: ${productQueue.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
