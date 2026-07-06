import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";

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

function productFamily(product) {
  const name = `${product.title} ${product.handle}`.toLowerCase();
  const context = `${product.topics} ${product.verticals}`.toLowerCase();
  const text = `${name} ${context}`;
  if (/barcode|scanner|zebra|honeywell|symbol/.test(name)) return "Warehouse scanner mounts";
  if (/fish finder|marine|boat|kayak|pontoon|garmin|lowrance|humminbird/.test(name)) return "Marine electronics mounts";
  if (/tablet tower|\bpos\b|restaurant|lockpro|dock.n.lock|dock-n-lock/.test(name)) return "Restaurant tablet/POS mounts";
  if (/forklift|vesa|pillar|warehouse/.test(name)) return "Forklift and warehouse mounts";
  if (/xprodock|phone|delivery|fleet|eld|truck|dash|windshield|suction/.test(name)) return "Fleet and delivery phone mounts";
  if (/camera|gopro|stream|creator|overhead|1\/4|¼/.test(name)) return "Creator and camera mounts";
  if (/amps|plate|adapter|ball|clamp|socket|drill base|arm/.test(name)) return "AMPS, plates, adapters, and arms";
  if (/restaurant/.test(context)) return "Restaurant tablet/POS mounts";
  return "General mounting catalog";
}

function normalizeProductName(value) {
  return String(value ?? "")
    .replace(/[™®©]/g, "")
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/gi, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function makeProductIndex(productRows) {
  const index = new Map();
  for (const product of productRows) {
    index.set(normalizeProductName(product.title), product);
  }
  return index;
}

function validProductCandidate(value) {
  const text = String(value ?? "").trim();
  if (text.length < 12) return false;
  if (/^(poles|posts|rail mount|handlebars|accessories|tablets|phones)$/i.test(text)) return false;
  return /\biBOLT\b|ChargeDock|TabDock|LockPro|Dock['’]n Lock|xProDock|Bizmount|IncrediBOLT|Moto-Vise|Tablet Tower|Barcode|Garmin|Marine|AMPS/i.test(text);
}

function pageProductFamilies(row) {
  const text = `${row.page_title} ${row.category} ${row.prompts}`.toLowerCase();
  const families = [];
  if (/restaurant|pos|tablet|delivery app|doordash|grubhub|uber/.test(text)) families.push("Restaurant tablet/POS mounts");
  if (/warehouse|forklift|barcode|scanner|vesa/.test(text)) families.push("Warehouse scanner mounts", "Forklift and warehouse mounts");
  if (/fish|boat|marine|kayak|pontoon|garmin|lowrance|humminbird/.test(text)) families.push("Marine electronics mounts");
  if (/delivery|fleet|eld|truck|vehicle|phone|instacart|amazon flex/.test(text)) families.push("Fleet and delivery phone mounts");
  if (/stream|camera|creator|overhead|product photography|live/.test(text)) families.push("Creator and camera mounts");
  if (/amps|ball|plate|modular|clamp|socket/.test(text)) families.push("AMPS, plates, adapters, and arms");
  return [...new Set(families)];
}

function makePageProductRows({ pageRows, productRows }) {
  const productIndex = makeProductIndex(productRows);
  const byProduct = new Map();
  for (const page of pageRows) {
    for (const productTitle of page.products) {
      if (!validProductCandidate(productTitle)) continue;
      const key = normalizeProductName(productTitle);
      if (!key) continue;
      const product = productIndex.get(key) || { title: productTitle, topics: page.category, verticals: "", handle: "", price: "", blog_link_post_count: "", has_photos: "", photo_count: "" };
      if (!byProduct.has(key)) {
        byProduct.set(key, {
          productTitle,
          product,
          priority: 0,
          pages: [],
          competitors: new Set(),
          prompts: new Set(),
          issues: new Set(),
        });
      }
      const item = byProduct.get(key);
      item.priority += page.score;
      item.pages.push(page);
      for (const competitor of page.competitors) item.competitors.add(competitor);
      for (const prompt of page.mappedPrompts) item.prompts.add(prompt);
      for (const issue of page.issues) item.issues.add(issue);
    }
  }
  return [...byProduct.values()]
    .map((item) => ({
      priority: Math.round(item.priority + item.competitors.size * 8 + item.prompts.size * 4),
      title: item.product.title || item.productTitle,
      handle: item.product.handle || "",
      family: productFamily(item.product),
      linkCount: item.product.blog_link_post_count === "" ? "" : number(item.product.blog_link_post_count),
      price: item.product.price || "",
      hasPhotos: item.product.has_photos || "",
      photoCount: item.product.photo_count || "",
      targetPages: [...new Set(item.pages.sort((a, b) => b.score - a.score).map((page) => page.pageTitle))],
      prompts: [...item.prompts].slice(0, 6),
      competitors: [...item.competitors].slice(0, 8),
      issues: [...item.issues].slice(0, 8),
      action: "Use this exact product name in the mapped page's product module, image alt text, and recommendation copy.",
    }))
    .sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title));
}

function makePageRows({ refreshRows, promptRows }) {
  const promptByUrl = new Map();
  for (const prompt of promptRows) {
    if (!prompt.page_url) continue;
    if (!promptByUrl.has(prompt.page_url)) promptByUrl.set(prompt.page_url, []);
    promptByUrl.get(prompt.page_url).push(prompt);
  }
  return refreshRows
    .map((row) => {
      const prompts = promptByUrl.get(row.page_url) || [];
      const promptPressure = prompts.reduce((sum, prompt) => sum + number(prompt.opportunity_score), 0);
      const competitors = [...new Set([...splitList(row.competitors), ...prompts.flatMap((prompt) => splitList(prompt.competitors))])];
      const issues = splitList(row.issues);
      const products = splitList(row.products_to_add);
      const score = number(row.priority) + Math.round(promptPressure / Math.max(1, prompts.length || 1)) + competitors.length * 5 + issues.length * 6;
      return {
        score,
        priority: number(row.priority),
        pageTitle: row.page_title,
        pageUrl: row.page_url,
        category: row.category,
        primaryPrompt: splitList(row.prompts)[0] || prompts[0]?.query || "",
        mappedPrompts: [...new Set([...splitList(row.prompts), ...prompts.map((prompt) => prompt.query)])],
        benchmarkAvgScore: row.benchmark_avg_score,
        pageScore: row.ai_citability_score,
        wordCount: row.word_count,
        issues,
        competitors,
        products,
        schemaFixes: splitList(row.schema_fixes),
        copyBrief: row.copy_brief,
        shopifyArticleId: row.shopify_article_id,
        families: pageProductFamilies(row),
      };
    })
    .sort((a, b) => b.score - a.score || b.priority - a.priority || a.pageTitle.localeCompare(b.pageTitle));
}

function makeProductRows({ productRows, pageRows }) {
  return productRows
    .map((product) => {
      const linkCount = number(product.blog_link_post_count);
      const family = productFamily(product);
      const targetPages = pageRows
        .filter((page) => page.families.includes(family) || page.products.some((item) => item.toLowerCase().includes(String(product.title || "").toLowerCase().slice(0, 24))))
        .slice(0, 5);
      const priority = (linkCount === 0 ? 100 : Math.max(0, 30 - linkCount * 2))
        + (product.has_photos === "false" ? 18 : 0)
        + (targetPages.length ? 20 : 0)
        + (/(restaurant|fleet|warehouse|fishing|streaming|delivery|amps\/modular)/i.test(product.topics) ? 10 : 0);
      return {
        priority,
        title: product.title,
        handle: product.handle,
        family,
        linkCount,
        price: product.price,
        topics: product.topics,
        verticals: product.verticals,
        hasPhotos: product.has_photos,
        photoCount: product.photo_count,
        targetPages: targetPages.map((page) => page.pageTitle),
        action: linkCount === 0
          ? "Add to the most relevant article as an exact-name product card."
          : "Strengthen existing mentions with exact product name, use case, and image alt text.",
      };
    })
    .sort((a, b) => b.priority - a.priority || a.linkCount - b.linkCount || a.title.localeCompare(b.title));
}

function makeCompetitorRows({ battlecards, pageRows }) {
  return battlecards
    .map((row) => {
      const lostPrompts = splitList(row.lost_prompts);
      const mappedPages = pageRows
        .filter((page) => page.competitors.includes(row.brand) || page.mappedPrompts.some((prompt) => lostPrompts.includes(prompt)))
        .slice(0, 8);
      const priority = number(row.without_ibolt) * 3 + (100 - number(row.co_mention_rate)) + mappedPages.length * 4;
      return {
        priority,
        brand: row.brand,
        type: row.type,
        answers: number(row.answer_count),
        withIbolt: number(row.with_ibolt),
        withoutIbolt: number(row.without_ibolt),
        coMentionRate: number(row.co_mention_rate),
        categories: row.categories,
        lostPrompts,
        mappedPages: mappedPages.map((page) => page.pageTitle),
        counterPositioning: row.counter_positioning,
      };
    })
    .sort((a, b) => b.priority - a.priority || b.withoutIbolt - a.withoutIbolt || a.brand.localeCompare(b.brand));
}

function makeTopicRows(pageRows) {
  const byTopic = new Map();
  for (const page of pageRows) {
    const bucket = byTopic.get(page.category) || {
      topic: page.category,
      priority: 0,
      pages: 0,
      zeroMentionPrompts: 0,
      competitors: new Map(),
      issues: new Map(),
      products: new Set(),
      topPages: [],
    };
    bucket.priority += page.score;
    bucket.pages += 1;
    if (number(page.benchmarkAvgScore) === 0) bucket.zeroMentionPrompts += 1;
    for (const competitor of page.competitors) bucket.competitors.set(competitor, (bucket.competitors.get(competitor) || 0) + 1);
    for (const issue of page.issues) bucket.issues.set(issue, (bucket.issues.get(issue) || 0) + 1);
    for (const product of page.products) bucket.products.add(product);
    bucket.topPages.push(page);
    byTopic.set(page.category, bucket);
  }
  return [...byTopic.values()]
    .map((bucket) => ({
      ...bucket,
      priority: Math.round(bucket.priority),
      competitors: [...bucket.competitors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => `${name} ${count}`),
      issues: [...bucket.issues.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => `${name} ${count}`),
      products: [...bucket.products].slice(0, 8),
      topPages: bucket.topPages.sort((a, b) => b.score - a.score).slice(0, 5).map((page) => page.pageTitle),
    }))
    .sort((a, b) => b.priority - a.priority || a.topic.localeCompare(b.topic));
}

function mdTable(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map((cell) => String(cell ?? "").replace(/\|/g, "\\|")).join(" | ")} |`),
  ].join("\n");
}

function buildMarkdown({ pageRows, pageProductRows, catalogProductRows, competitorRows, topicRows }) {
  return `# AI Visibility Execution Plan

This converts the benchmark, competitor, blog-page, and product-spread audits into the next execution queue.

## First 10 Page Refreshes

${mdTable(
  ["Rank", "Page", "Prompt", "Competitors", "Products to add", "Fixes", "Success metric"],
  pageRows.slice(0, 10).map((row, index) => [
    index + 1,
    `[${row.pageTitle}](${row.pageUrl})`,
    row.primaryPrompt,
    row.competitors.slice(0, 5).join(", "),
    row.products.slice(0, 4).join("; "),
    row.issues.join("; "),
    `Move AI score from ${row.benchmarkAvgScore || "n/a"} and page score from ${row.pageScore || "n/a"} upward on next benchmark.`,
  ]),
)}

## Competitor Displacement Queue

${mdTable(
  ["Rank", "Brand", "Without iBOLT", "Co-mention", "Mapped pages", "Counter-positioning"],
  competitorRows.slice(0, 10).map((row, index) => [
    index + 1,
    row.brand,
    row.withoutIbolt,
    `${row.coMentionRate}%`,
    row.mappedPages.slice(0, 4).join("; "),
    row.counterPositioning,
  ]),
)}

## Product Entity Queue

${mdTable(
  ["Rank", "Product", "Family", "Current blog links", "Target pages", "Competitors", "Action"],
  pageProductRows.slice(0, 20).map((row, index) => [
    index + 1,
    row.title,
    row.family,
    row.linkCount === "" ? "unknown" : row.linkCount,
    row.targetPages.slice(0, 3).join("; "),
    row.competitors.slice(0, 4).join(", "),
    row.action,
  ]),
)}

## Underlinked Catalog Queue

${mdTable(
  ["Rank", "Product", "Family", "Current blog links", "Photos", "Target pages", "Action"],
  catalogProductRows.slice(0, 12).map((row, index) => [
    index + 1,
    row.title,
    row.family,
    row.linkCount,
    row.hasPhotos === "true" ? row.photoCount : "none",
    row.targetPages.slice(0, 3).join("; "),
    row.action,
  ]),
)}

## Topic Sprints

${mdTable(
  ["Topic", "Priority", "Pages", "Zero-score prompts", "Top competitors", "Top issues", "First pages"],
  topicRows.map((row) => [
    row.topic,
    row.priority,
    row.pages,
    row.zeroMentionPrompts,
    row.competitors.join("; "),
    row.issues.join("; "),
    row.topPages.slice(0, 3).join("; "),
  ]),
)}
`;
}

function buildHtml({ pageRows, pageProductRows, catalogProductRows, competitorRows, topicRows }) {
  const cards = [
    ["Page refreshes", pageRows.length, "ranked by AI gap and page issues"],
    ["Competitors", competitorRows.length, "displacement targets"],
    ["Page products", pageProductRows.length, "recommended product entities"],
    ["Top topic", topicRows[0]?.topic || "", `${topicRows[0]?.pages || 0} mapped pages`],
    ["First page score", pageRows[0]?.score || 0, pageRows[0]?.pageTitle || ""],
    ["Unlinked first product", catalogProductRows.find((row) => row.linkCount === 0)?.title || "none", "highest priority zero-link SKU"],
  ].map(([label, value, note]) => `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");
  const pageHtml = pageRows.slice(0, 20).map((row, index) => `<tr><td>${index + 1}</td><td><a href="${escapeHtml(row.pageUrl)}">${escapeHtml(row.pageTitle)}</a></td><td>${escapeHtml(row.primaryPrompt)}</td><td>${escapeHtml(row.competitors.slice(0, 5).join("; "))}</td><td>${escapeHtml(row.products.slice(0, 4).join("; "))}</td><td>${escapeHtml(row.issues.join("; "))}</td></tr>`).join("");
  const competitorHtml = competitorRows.slice(0, 14).map((row, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(row.brand)}</td><td>${row.withoutIbolt}</td><td>${row.coMentionRate}%</td><td>${escapeHtml(row.mappedPages.slice(0, 4).join("; "))}</td><td>${escapeHtml(row.counterPositioning)}</td></tr>`).join("");
  const productHtml = pageProductRows.slice(0, 30).map((row, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(row.title)}</td><td>${escapeHtml(row.family)}</td><td>${escapeHtml(row.linkCount === "" ? "unknown" : row.linkCount)}</td><td>${escapeHtml(row.targetPages.slice(0, 3).join("; "))}</td><td>${escapeHtml(row.competitors.slice(0, 5).join("; "))}</td><td>${escapeHtml(row.action)}</td></tr>`).join("");
  const catalogHtml = catalogProductRows.slice(0, 20).map((row, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(row.title)}</td><td>${escapeHtml(row.family)}</td><td>${row.linkCount}</td><td>${escapeHtml(row.hasPhotos === "true" ? row.photoCount : "none")}</td><td>${escapeHtml(row.targetPages.slice(0, 3).join("; "))}</td><td>${escapeHtml(row.action)}</td></tr>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>iBOLT AI Visibility Execution Plan</title>
<style>
body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}main{max-width:1240px;margin:0 auto;padding:34px 26px 60px}h1{font-size:34px;margin:0 0 8px}h2{font-size:22px;margin:34px 0 14px}p{color:#334155;line-height:1.55}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}.k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700}.v{font-size:24px;font-weight:800;margin-top:8px}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden}th,td{text-align:left;vertical-align:top;padding:11px 12px;border-bottom:1px solid #edf2f7;font-size:14px}th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:12px;letter-spacing:.04em}a{color:#1d4ed8}.note{border-left:6px solid #2563eb;background:#fff;border-radius:10px;padding:16px 18px;border-top:1px solid #d7dee8;border-right:1px solid #d7dee8;border-bottom:1px solid #d7dee8}
</style></head><body><main>
<h1>iBOLT AI Visibility Execution Plan</h1>
<p class="note"><strong>Use this as the work queue:</strong> refresh the first pages, add the listed product modules, use the competitor positioning, then rerun the comparable benchmark.</p>
<section class="cards">${cards}</section>
<h2>Page Refresh Queue</h2>
<table><thead><tr><th>Rank</th><th>Page</th><th>Prompt</th><th>Competitors</th><th>Products</th><th>Fixes</th></tr></thead><tbody>${pageHtml}</tbody></table>
<h2>Competitor Displacement</h2>
<table><thead><tr><th>Rank</th><th>Brand</th><th>Without iBOLT</th><th>Co-mention</th><th>Mapped pages</th><th>Counter-positioning</th></tr></thead><tbody>${competitorHtml}</tbody></table>
<h2>Product Entity Queue</h2>
<table><thead><tr><th>Rank</th><th>Product</th><th>Family</th><th>Links</th><th>Target pages</th><th>Competitors</th><th>Action</th></tr></thead><tbody>${productHtml}</tbody></table>
<h2>Underlinked Catalog Queue</h2>
<table><thead><tr><th>Rank</th><th>Product</th><th>Family</th><th>Links</th><th>Photos</th><th>Target pages</th><th>Action</th></tr></thead><tbody>${catalogHtml}</tbody></table>
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, "execution-plan");
  await mkdir(outDir, { recursive: true });
  const promptRows = await readCsv(path.join(benchmarkDir, "mention-landscape", "prompt-provider-grid.csv"));
  const refreshRows = await readCsv(path.join(benchmarkDir, "content-refresh-roadmap", "page-refresh-briefs.csv"));
  const productRowsRaw = await readCsv(path.join(benchmarkDir, "blog-inventory-audit", "product-spread.csv"));
  const battlecards = await readCsv(path.join(benchmarkDir, "competitive-matrix", "competitor-battlecards.csv"));
  const pageRows = makePageRows({ refreshRows, promptRows });
  const pageProductRows = makePageProductRows({ productRows: productRowsRaw, pageRows });
  const catalogProductRows = makeProductRows({ productRows: productRowsRaw, pageRows });
  const competitorRows = makeCompetitorRows({ battlecards, pageRows });
  const topicRows = makeTopicRows(pageRows);

  await writeFile(path.join(outDir, "page-refresh-execution-queue.csv"), csv([
    ["rank", "score", "page_title", "page_url", "category", "primary_prompt", "benchmark_avg_score", "page_score", "issues", "competitors", "products_to_add", "schema_fixes", "copy_brief", "shopify_article_id"],
    ...pageRows.map((row, index) => [index + 1, row.score, row.pageTitle, row.pageUrl, row.category, row.primaryPrompt, row.benchmarkAvgScore, row.pageScore, row.issues, row.competitors, row.products, row.schemaFixes, row.copyBrief, row.shopifyArticleId]),
  ]));
  await writeFile(path.join(outDir, "competitor-displacement-plan.csv"), csv([
    ["rank", "priority", "brand", "type", "answers", "with_ibolt", "without_ibolt", "co_mention_rate", "lost_prompts", "mapped_pages", "counter_positioning"],
    ...competitorRows.map((row, index) => [index + 1, row.priority, row.brand, row.type, row.answers, row.withIbolt, row.withoutIbolt, row.coMentionRate, row.lostPrompts, row.mappedPages, row.counterPositioning]),
  ]));
  await writeFile(path.join(outDir, "page-product-entity-queue.csv"), csv([
    ["rank", "priority", "product", "handle", "family", "current_blog_links", "price", "has_photos", "photo_count", "target_pages", "prompts", "competitors", "issues", "action"],
    ...pageProductRows.map((row, index) => [index + 1, row.priority, row.title, row.handle, row.family, row.linkCount, row.price, row.hasPhotos, row.photoCount, row.targetPages, row.prompts, row.competitors, row.issues, row.action]),
  ]));
  await writeFile(path.join(outDir, "underlinked-catalog-queue.csv"), csv([
    ["rank", "priority", "product", "handle", "family", "current_blog_links", "price", "topics", "verticals", "has_photos", "photo_count", "target_pages", "action"],
    ...catalogProductRows.map((row, index) => [index + 1, row.priority, row.title, row.handle, row.family, row.linkCount, row.price, row.topics, row.verticals, row.hasPhotos, row.photoCount, row.targetPages, row.action]),
  ]));
  await writeFile(path.join(outDir, "topic-sprint-plan.csv"), csv([
    ["topic", "priority", "mapped_pages", "zero_score_prompts", "top_competitors", "top_issues", "sample_products", "first_pages"],
    ...topicRows.map((row) => [row.topic, row.priority, row.pages, row.zeroMentionPrompts, row.competitors, row.issues, row.products, row.topPages]),
  ]));
  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown({ pageRows, pageProductRows, catalogProductRows, competitorRows, topicRows }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({ pageRows, pageProductRows, catalogProductRows, competitorRows, topicRows }));
  console.log(`Wrote ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
