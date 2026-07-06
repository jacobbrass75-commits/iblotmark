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
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows) {
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
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some((value) => value !== "")) rows.push(row);
  }
  const [headers = [], ...records] = rows;
  return records.map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""])));
}

async function readCsvIfExists(filePath) {
  try {
    return parseCsv(await readFile(filePath, "utf8"));
  } catch {
    return [];
  }
}

async function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
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

function num(value) {
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\biBolt\b/g, "iBOLT")
    .replace(/\bIbolt\b/g, "iBOLT")
    .replace(/\bIBOLT\b/g, "iBOLT")
    .replace(/[–—]/g, "-")
    .replace(/budget\/value/gi, "price/value")
    .replace(/\s+/g, " ")
    .trim();
}

function splitList(value) {
  return String(value ?? "")
    .split(/[;|]/)
    .map((item) => normalizeText(item.trim()))
    .filter(Boolean)
    .filter((item) => !/^\+\d+\s+more$/i.test(item));
}

function unique(values) {
  return [...new Set(values.map(normalizeText).filter(Boolean))];
}

function barSvg({ title, subtitle, rows, width = 980, height = 430, color = "#2563eb" }) {
  const margin = { top: 78, right: 54, bottom: 36, left: 270 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(...rows.map((row) => num(row.value)), 1);
  const rowHeight = chartHeight / Math.max(rows.length, 1);
  const bars = rows.map((row, index) => {
    const y = margin.top + index * rowHeight + 6;
    const h = Math.max(13, rowHeight - 12);
    const w = Math.round((num(row.value) / maxValue) * chartWidth);
    return `
      <text x="${margin.left - 14}" y="${y + h / 2 + 5}" text-anchor="end" font-size="14" fill="#334155">${escapeHtml(row.name)}</text>
      <rect x="${margin.left}" y="${y}" width="${w}" height="${h}" rx="6" fill="${color}"></rect>
      <text x="${margin.left + w + 10}" y="${y + h / 2 + 5}" font-size="14" font-weight="800" fill="#0f172a">${escapeHtml(row.value)}</text>
    `;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <text x="28" y="36" font-size="25" font-weight="900" fill="#0f172a">${escapeHtml(title)}</text>
  <text x="28" y="62" font-size="14" fill="#64748b">${escapeHtml(subtitle)}</text>
  ${bars}
</svg>`;
}

function decisionForGap(row, portfolioRow) {
  const text = `${row.page_type} ${row.action} ${row.existing_topic_recommendation}`.toLowerCase();
  const canonicalRisk = num(portfolioRow?.canonical_review_pages) > 0 || /consolidate|merge|existing hub|existing-page|duplicate|refresh existing/i.test(text);
  const solutionHub = /solution guide|system|guide/i.test(row.page_type) && !canonicalRisk;
  if (canonicalRisk) return "Refresh or consolidate existing page first";
  if (solutionHub) return "Build canonical solution hub";
  return "Create net-new supporting content";
}

function stageForGap(row, decision) {
  const priority = num(row.priority);
  if (/Refresh|consolidate/i.test(decision) && priority >= 100) return "Week 1: refresh/consolidate before publishing";
  if (/canonical solution hub/i.test(decision)) return "Week 2: build canonical hub";
  if (priority >= 100) return "Week 2: write supporting page";
  return "Week 3: backlog supporting content";
}

function categoryMap(rows) {
  return new Map(rows.map((row) => [row.category || row.topic, row]));
}

function buildGapRows({ contentGaps, portfolioCategories, noMappedPrompts }) {
  const portfolioByCategory = categoryMap(portfolioCategories);
  const promptCountsByCategory = new Map();
  for (const prompt of noMappedPrompts) {
    const category = prompt.category || "unknown";
    promptCountsByCategory.set(category, (promptCountsByCategory.get(category) || 0) + 1);
  }
  return contentGaps.map((row, index) => {
    const category = row.category || "unknown";
    const portfolio = portfolioByCategory.get(category);
    const decision = decisionForGap(row, portfolio);
    const stage = stageForGap(row, decision);
    const prompts = splitList(row.prompts).slice(0, 10);
    return {
      rank: index + 1,
      priority: num(row.priority),
      category,
      title: normalizeText(row.title),
      slug: row.slug,
      primaryKeyword: normalizeText(row.primary_keyword),
      pageType: normalizeText(row.page_type),
      decision,
      stage,
      promptCount: num(row.prompt_count),
      providerRequestCount: num(row.provider_request_count),
      noMappedPromptCount: promptCountsByCategory.get(category) || 0,
      existingPages: num(portfolio?.live_pages),
      benchmarkPressurePages: num(portfolio?.benchmark_pressure_pages),
      canonicalReviewPages: num(portfolio?.canonical_review_pages),
      competitors: splitList(row.competitors).slice(0, 8),
      suggestedProducts: splitList(row.suggested_products).slice(0, 8),
      unlinkedProducts: num(row.unlinked_products),
      prompts,
      action: normalizeText(row.action),
      existingRecommendation: normalizeText(row.existing_topic_recommendation),
      faqSeeds: splitList(row.faq_seeds).slice(0, 6),
    };
  });
}

function buildPromptRows(noMappedPrompts, gapRows) {
  const gapByCategory = new Map();
  for (const gap of gapRows) {
    if (!gapByCategory.has(gap.category)) gapByCategory.set(gap.category, []);
    gapByCategory.get(gap.category).push(gap);
  }
  return noMappedPrompts.map((row, index) => {
    const category = row.category || "unknown";
    const related = (gapByCategory.get(category) || [])[0];
    return {
      rank: index + 1,
      prompt: normalizeText(row.prompt),
      category,
      source: normalizeText(row.source),
      priority: num(row.priority),
      batchId: row.batch_id,
      providers: normalizeText(row.providers),
      requestCount: num(row.request_count),
      recommendedContent: related?.title || "Create or map to a relevant source-ready page",
      decision: related?.decision || "Map prompt to existing or new page",
      stage: related?.stage || "Week 3: map prompt before live benchmark",
    };
  });
}

function buildProductRows(productGaps, gapRows) {
  const priorityByCategory = new Map();
  for (const gap of gapRows) {
    priorityByCategory.set(gap.category, Math.max(priorityByCategory.get(gap.category) || 0, gap.priority));
  }
  return productGaps
    .map((row) => {
      const topics = Array.isArray(row.topics) ? row.topics : splitList(row.topics);
      const title = normalizeText(row.title);
      let bestTopic = topics.sort((a, b) => (priorityByCategory.get(b) || 0) - (priorityByCategory.get(a) || 0))[0] || topics[0] || "unknown";
      if (topics.includes("amps/modular") && /\b(amps|vesa|adapter|plate|ball|socket)\b/i.test(title)) bestTopic = "amps/modular";
      if (topics.includes("streaming") && /\b(camera|gopro|1\/4|¼|product video|stream)\b/i.test(title)) bestTopic = "streaming";
      return {
        title,
        handle: row.handle,
        price: row.price,
        topics,
        bestTopic,
        topicPriority: priorityByCategory.get(bestTopic) || 0,
        reason: normalizeText(row.reason),
        recommendedMove: `Add to ${bestTopic} product module or internal-link block before generating more broad content.`,
      };
    })
    .sort((a, b) => b.topicPriority - a.topicPriority || a.title.localeCompare(b.title))
    .slice(0, 40);
}

function categorySummaryRows({ gapRows, promptRows, productRows, portfolioCategories }) {
  const map = new Map();
  const ensure = (category) => {
    if (!map.has(category)) {
      const portfolio = portfolioCategories.find((row) => row.category === category) || {};
      map.set(category, {
        category,
        gapCount: 0,
        totalPriority: 0,
        noMappedPrompts: 0,
        productGaps: 0,
        refreshFirst: 0,
        netNew: 0,
        canonicalHub: 0,
        existingPages: num(portfolio.live_pages),
        benchmarkPressurePages: num(portfolio.benchmark_pressure_pages),
        canonicalReviewPages: num(portfolio.canonical_review_pages),
        topMove: normalizeText(portfolio.portfolio_action || ""),
      });
    }
    return map.get(category);
  };
  for (const gap of gapRows) {
    const row = ensure(gap.category);
    row.gapCount += 1;
    row.totalPriority += gap.priority;
    if (/Refresh|consolidate/i.test(gap.decision)) row.refreshFirst += 1;
    if (/net-new/i.test(gap.decision)) row.netNew += 1;
    if (/canonical solution hub/i.test(gap.decision)) row.canonicalHub += 1;
  }
  for (const prompt of promptRows) ensure(prompt.category).noMappedPrompts += 1;
  for (const product of productRows) ensure(product.bestTopic).productGaps += 1;
  return [...map.values()].sort((a, b) => b.totalPriority - a.totalPriority || b.noMappedPrompts - a.noMappedPrompts);
}

function buildMarkdown({ summary, gapRows, categoryRows, promptRows, productRows }) {
  return `# Content Gap Decision Matrix

## What This Adds

This report separates content gaps into three different actions: refresh/consolidate an existing page first, build a canonical solution hub, or create net-new supporting content.

Current content gap read:

- Content briefs: ${summary.contentGapRows}
- No-mapped prompts: ${summary.noMappedPrompts}
- Product-linking gaps in queue: ${summary.productGapRows}
- Refresh/consolidate first: ${summary.refreshFirst}
- Canonical solution hubs: ${summary.canonicalHubs}
- Net-new supporting content: ${summary.netNew}

## First Content Decisions

${gapRows.slice(0, 12).map((row) => `- ${row.rank}. ${row.title} (${row.category}, priority ${row.priority}): ${row.decision}. ${row.stage}.`).join("\n")}

## Category Summary

${categoryRows.slice(0, 10).map((row) => `- ${row.category}: ${row.gapCount} content gaps, ${row.noMappedPrompts} no-mapped prompts, ${row.productGaps} product-linking gaps, ${row.existingPages} existing pages.`).join("\n")}

## No-Mapped Prompt Queue

${promptRows.slice(0, 14).map((row) => `- ${row.prompt} (${row.category}): map to "${row.recommendedContent}".`).join("\n")}

## Product Linking Queue

${productRows.slice(0, 14).map((row) => `- ${row.title} (${row.bestTopic}): ${row.recommendedMove}`).join("\n")}
`;
}

function buildHtml({ summary, gapRows, categoryRows, promptRows, productRows }) {
  const cards = [
    ["Content briefs", summary.contentGapRows, "content-gap rows"],
    ["No-mapped prompts", summary.noMappedPrompts, "expanded test prompts"],
    ["Product gaps", summary.productGapRows, "unlinked products"],
    ["Refresh first", summary.refreshFirst, "avoid duplicate content"],
    ["Canonical hubs", summary.canonicalHubs, "solution pages"],
    ["Net-new content", summary.netNew, "supporting posts"],
  ].map(([label, value, note]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");

  const gapTrs = gapRows.map((row) => `<tr><td>${row.rank}</td><td>${row.priority}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.title)}</td><td>${escapeHtml(row.primaryKeyword)}</td><td>${escapeHtml(row.decision)}</td><td>${escapeHtml(row.stage)}</td><td>${escapeHtml(row.competitors.join("; "))}</td><td>${escapeHtml(row.action)}</td></tr>`).join("");
  const categoryTrs = categoryRows.map((row) => `<tr><td>${escapeHtml(row.category)}</td><td>${row.totalPriority}</td><td>${row.gapCount}</td><td>${row.noMappedPrompts}</td><td>${row.productGaps}</td><td>${row.existingPages}</td><td>${row.benchmarkPressurePages}</td><td>${row.canonicalReviewPages}</td><td>${escapeHtml(row.topMove)}</td></tr>`).join("");
  const promptTrs = promptRows.map((row) => `<tr><td>${row.rank}</td><td>${row.priority}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.prompt)}</td><td>${escapeHtml(row.source)}</td><td>${escapeHtml(row.recommendedContent)}</td><td>${escapeHtml(row.decision)}</td><td>${escapeHtml(row.stage)}</td></tr>`).join("");
  const productTrs = productRows.map((row) => `<tr><td>${escapeHtml(row.title)}</td><td>${escapeHtml(row.handle)}</td><td>${escapeHtml(row.bestTopic)}</td><td>${row.topicPriority}</td><td>${escapeHtml(row.reason)}</td><td>${escapeHtml(row.recommendedMove)}</td></tr>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Content Gap Decision Matrix</title>
  <style>
    body{margin:0;background:#f8fafc;color:#0f172a;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1220px;margin:0 auto;padding:34px 24px 70px}
    h1{font-size:36px;margin:0 0 8px}
    h2{font-size:23px;margin:36px 0 12px}
    p,li{line-height:1.55;color:#334155}
    .lede{font-size:18px;max-width:960px}
    .cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:24px 0}
    .card{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:900}
    .value{font-size:32px;font-weight:900;margin-top:8px}
    .callout{background:#fff;border-left:6px solid #2563eb;border-top:1px solid #d7dee8;border-right:1px solid #d7dee8;border-bottom:1px solid #d7dee8;border-radius:12px;padding:16px 18px;margin:18px 0}
    img{max-width:100%;height:auto;background:#fff;border:1px solid #d7dee8;border-radius:12px;margin:12px 0}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden;margin:10px 0 28px}
    th,td{text-align:left;vertical-align:top;padding:11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    @media(max-width:900px){.cards,.grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
<main>
  <h1>Content Gap Decision Matrix</h1>
  <p class="lede">This answers the next content question: which weak test areas need new pages, which need existing pages refreshed, and which product gaps should be fixed before publishing more broad content.</p>
  <div class="cards">${cards}</div>
  <div class="callout"><strong>Rule:</strong> if a category already has duplicate/canonical pressure, refresh or consolidate the survivor page before creating another blog post.</div>
  <div class="grid">
    <img src="decision-mix.svg" alt="Decision mix"/>
    <img src="category-gap-priority.svg" alt="Category gap priority"/>
  </div>
  <img src="product-linking-priority.svg" alt="Product linking priority"/>

  <h2>Content Decisions</h2>
  <table><thead><tr><th>#</th><th>Priority</th><th>Category</th><th>Title</th><th>Keyword</th><th>Decision</th><th>Stage</th><th>Competitors</th><th>Action</th></tr></thead><tbody>${gapTrs}</tbody></table>

  <h2>Category Summary</h2>
  <table><thead><tr><th>Category</th><th>Priority</th><th>Gaps</th><th>No-mapped prompts</th><th>Product gaps</th><th>Existing pages</th><th>Benchmark pressure</th><th>Canonical review</th><th>Portfolio move</th></tr></thead><tbody>${categoryTrs}</tbody></table>

  <h2>No-Mapped Prompt Queue</h2>
  <table><thead><tr><th>#</th><th>Priority</th><th>Category</th><th>Prompt</th><th>Source</th><th>Recommended content</th><th>Decision</th><th>Stage</th></tr></thead><tbody>${promptTrs}</tbody></table>

  <h2>Product Linking Queue</h2>
  <table><thead><tr><th>Product</th><th>Handle</th><th>Topic</th><th>Topic priority</th><th>Reason</th><th>Recommended move</th></tr></thead><tbody>${productTrs}</tbody></table>
</main>
</body>
</html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, "content-gap-decision-matrix");
  await mkdir(outDir, { recursive: true });

  const contentGaps = await readCsvIfExists(path.join(benchmarkDir, "content-gap-briefs", "content-gap-briefs.csv"));
  const noMappedPrompts = await readCsvIfExists(path.join(benchmarkDir, "content-gap-briefs", "no-mapped-prompts.csv"));
  const portfolio = await readJsonIfExists(path.join(benchmarkDir, "blog-portfolio-map", "blog-portfolio-data.json"), { categoryRows: [] });
  const inventory = await readJsonIfExists(path.join(benchmarkDir, "blog-inventory-audit", "blog-inventory-audit-data.json"), { productGaps: [] });

  const gapRows = buildGapRows({
    contentGaps,
    portfolioCategories: portfolio.categoryRows || [],
    noMappedPrompts,
  });
  const promptRows = buildPromptRows(noMappedPrompts, gapRows);
  const productRows = buildProductRows(inventory.productGaps || [], gapRows);
  const categoryRows = categorySummaryRows({
    gapRows,
    promptRows,
    productRows,
    portfolioCategories: portfolio.categoryRows || [],
  });

  const summary = {
    benchmarkDir,
    contentGapRows: gapRows.length,
    noMappedPrompts: promptRows.length,
    productGapRows: productRows.length,
    refreshFirst: gapRows.filter((row) => /Refresh|consolidate/i.test(row.decision)).length,
    canonicalHubs: gapRows.filter((row) => /canonical solution hub/i.test(row.decision)).length,
    netNew: gapRows.filter((row) => /net-new/i.test(row.decision)).length,
    categoryRows: categoryRows.length,
    topCategories: categoryRows.slice(0, 8).map((row) => `${row.category} ${row.totalPriority}`),
  };

  const decisionRows = [
    { name: "Refresh/consolidate first", value: summary.refreshFirst },
    { name: "Canonical solution hub", value: summary.canonicalHubs },
    { name: "Net-new supporting content", value: summary.netNew },
  ];
  await writeFile(path.join(outDir, "decision-mix.svg"), barSvg({
    title: "Content Decision Mix",
    subtitle: "Most gaps should strengthen existing pages before creating duplicate posts.",
    rows: decisionRows,
    color: "#2563eb",
  }));
  await writeFile(path.join(outDir, "category-gap-priority.svg"), barSvg({
    title: "Gap Priority By Category",
    subtitle: "Priority combines content briefs, no-mapped prompts, and existing portfolio pressure.",
    rows: categoryRows.slice(0, 8).map((row) => ({ name: row.category, value: row.totalPriority })),
    color: "#7c3aed",
  }));
  await writeFile(path.join(outDir, "product-linking-priority.svg"), barSvg({
    title: "Product Linking Gaps By Topic",
    subtitle: "Underlinked products should feed product modules on source-ready pages.",
    rows: categoryRows.slice(0, 8).map((row) => ({ name: row.category, value: row.productGaps })),
    color: "#0f766e",
  }));

  await writeFile(path.join(outDir, "content-decision-matrix.csv"), toCsv([
    ["rank", "priority", "category", "title", "slug", "primary_keyword", "page_type", "decision", "stage", "prompt_count", "provider_request_count", "no_mapped_prompt_count", "existing_pages", "benchmark_pressure_pages", "canonical_review_pages", "competitors", "suggested_products", "unlinked_products", "prompts", "action", "existing_recommendation", "faq_seeds"],
    ...gapRows.map((row) => [row.rank, row.priority, row.category, row.title, row.slug, row.primaryKeyword, row.pageType, row.decision, row.stage, row.promptCount, row.providerRequestCount, row.noMappedPromptCount, row.existingPages, row.benchmarkPressurePages, row.canonicalReviewPages, row.competitors, row.suggestedProducts, row.unlinkedProducts, row.prompts, row.action, row.existingRecommendation, row.faqSeeds]),
  ]));
  await writeFile(path.join(outDir, "no-mapped-prompt-workqueue.csv"), toCsv([
    ["rank", "priority", "category", "prompt", "source", "batch_id", "providers", "request_count", "recommended_content", "decision", "stage"],
    ...promptRows.map((row) => [row.rank, row.priority, row.category, row.prompt, row.source, row.batchId, row.providers, row.requestCount, row.recommendedContent, row.decision, row.stage]),
  ]));
  await writeFile(path.join(outDir, "product-linking-gap-queue.csv"), toCsv([
    ["product", "handle", "price", "topics", "best_topic", "topic_priority", "reason", "recommended_move"],
    ...productRows.map((row) => [row.title, row.handle, row.price, row.topics, row.bestTopic, row.topicPriority, row.reason, row.recommendedMove]),
  ]));
  await writeFile(path.join(outDir, "category-content-gap-summary.csv"), toCsv([
    ["category", "total_priority", "gap_count", "no_mapped_prompts", "product_gaps", "refresh_first", "canonical_hubs", "net_new", "existing_pages", "benchmark_pressure_pages", "canonical_review_pages", "top_move"],
    ...categoryRows.map((row) => [row.category, row.totalPriority, row.gapCount, row.noMappedPrompts, row.productGaps, row.refreshFirst, row.canonicalHub, row.netNew, row.existingPages, row.benchmarkPressurePages, row.canonicalReviewPages, row.topMove]),
  ]));

  const data = {
    generatedAt: new Date().toISOString(),
    summary,
    gapRows,
    promptRows,
    productRows,
    categoryRows,
  };
  await writeFile(path.join(outDir, "content-gap-decision-data.json"), JSON.stringify(data, null, 2));
  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown({ summary, gapRows, categoryRows, promptRows, productRows }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({ summary, gapRows, categoryRows, promptRows, productRows }));

  console.log(`Wrote content gap decision matrix to ${outDir}`);
  console.log(`Content gaps: ${summary.contentGapRows}`);
  console.log(`No-mapped prompts: ${summary.noMappedPrompts}`);
  console.log(`Product gaps queued: ${summary.productGapRows}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
