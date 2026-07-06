import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";
const EXPANDED_PREFIX = "openrouter-expanded-ai-benchmark-";

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
  if (!name) throw new Error(`No ${prefix} directory found in ${OUTPUT_ROOT}.`);
  return path.join(process.cwd(), OUTPUT_ROOT, name);
}

function num(value) {
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/^\+\d+\s+more$/i.test(item));
}

function categoryFromTopicItem(value) {
  return String(value ?? "")
    .replace(/\s+\d+$/, "")
    .trim()
    .toLowerCase();
}

function addToCounter(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function firstCounterItems(map, count = 6) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, count)
    .map(([name, value]) => `${name} ${value}`);
}

function indexBy(rows, field) {
  const map = new Map();
  for (const row of rows) {
    const key = String(row[field] ?? "").toLowerCase();
    if (key && !map.has(key)) map.set(key, row);
  }
  return map;
}

function coverageVerdict(row) {
  if (row.no_mapped_prompts > 0 && row.coverage_gap_score >= 70) return "Needs new solution pages before testing";
  if (row.coverage_gap_score >= 70) return "Under-tested high-priority area";
  if (row.coverage_gap_score >= 45) return "Add prompts after page cleanup";
  if (row.prompts >= 20 && row.coverage_gap_score <= 20) return "Well covered for next live run";
  return "Adequate, monitor after expanded run";
}

function recommendedTestAction(row) {
  if (row.verdict === "Needs new solution pages before testing") {
    return "Create or strengthen mapped solution pages, then add focused prompts for the buyer language in this area.";
  }
  if (row.verdict === "Under-tested high-priority area") {
    return "Add more one-at-a-time prompts across ChatGPT, Gemini, and Claude for this category before the next benchmark.";
  }
  if (row.verdict === "Add prompts after page cleanup") {
    return "Fix page structure first, then add prompt variants for the same category and competitors.";
  }
  if (row.verdict === "Well covered for next live run") {
    return "Keep the prompts stable so before/after comparisons are meaningful.";
  }
  return "Monitor with the expanded run, then add prompts only if the category underperforms.";
}

function familyKeywords(familyName) {
  const family = String(familyName || "").toLowerCase();
  if (family.includes("amps") || family.includes("adapter") || family.includes("balls")) {
    return ["amps", "adapter", "ball", "socket", "mounting plate", "vesa", "modular", "drill base"];
  }
  if (family.includes("creator") || family.includes("camera") || family.includes("streaming")) {
    return ["streaming", "camera", "overhead", "product photography", "live streaming", "table camera", "creator", "filming"];
  }
  if (family.includes("fleet") || family.includes("delivery") || family.includes("vehicle phone")) {
    return ["fleet", "eld", "truck", "delivery", "vehicle", "amazon flex", "construction", "driver"];
  }
  if (family.includes("forklift") || family.includes("warehouse")) {
    return ["forklift", "warehouse", "vesa", "scanner", "material handling", "pillar"];
  }
  if (family.includes("restaurant") || family.includes("tablet security")) {
    return ["restaurant", "pos", "tablet tower", "food truck", "delivery app", "locking tablet"];
  }
  if (family.includes("charging") || family.includes("magnetic")) {
    return ["charging", "charge", "magnetic", "magsafe", "dock", "nfc", "safemag"];
  }
  if (family.includes("barcode")) {
    return ["barcode", "scanner", "zebra", "honeywell", "symbol"];
  }
  if (family.includes("cycling") || family.includes("motorcycle") || family.includes("powersports")) {
    return ["cycling", "motorcycle", "bike", "bicycle", "handlebar", "powersports", "utv", "goPro"];
  }
  if (family.includes("marine") || family.includes("fish finder")) {
    return ["fish finder", "boat", "kayak", "marine", "garmin", "pontoon", "lowrance", "humminbird"];
  }
  if (family.includes("travel") || family.includes("headrest")) {
    return ["travel", "road trip", "headrest", "nintendo switch", "passenger"];
  }
  return String(familyName || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3);
}

function promptMatchesFamily(prompt, keywords) {
  const text = String(prompt || "").toLowerCase();
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

function buildSvgBarChart({ title, rows, labelField, valueField, outputPath, width = 1100, height = 560, color = "#0b5cab" }) {
  const margin = { top: 72, right: 45, bottom: 52, left: 290 };
  const chartRows = rows.slice(0, 12);
  const max = Math.max(...chartRows.map((row) => num(row[valueField])), 1);
  const rowHeight = 42;
  const actualHeight = Math.max(height, margin.top + chartRows.length * rowHeight + margin.bottom);
  const chartWidth = width - margin.left - margin.right;
  const bars = chartRows
    .map((row, index) => {
      const y = margin.top + index * rowHeight;
      const value = num(row[valueField]);
      const widthValue = Math.max(4, Math.round((value / max) * chartWidth));
      const label = String(row[labelField] || "").slice(0, 45);
      return `
      <text x="${margin.left - 16}" y="${y + 21}" text-anchor="end" font-size="14" fill="#172033">${escapeHtml(label)}</text>
      <rect x="${margin.left}" y="${y}" width="${widthValue}" height="25" rx="6" fill="${color}"/>
      <text x="${margin.left + widthValue + 9}" y="${y + 18}" font-size="14" fill="#172033">${escapeHtml(value)}</text>`;
    })
    .join("\n");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${actualHeight}" viewBox="0 0 ${width} ${actualHeight}">
  <rect width="100%" height="100%" fill="#f7f9fc"/>
  <text x="${margin.left}" y="38" font-size="24" font-weight="700" fill="#111827">${escapeHtml(title)}</text>
  <text x="${margin.left}" y="62" font-size="14" fill="#4b5563">Coverage gap compares prompt supply against page, product, and competitor demand.</text>
  ${bars}
</svg>`;
  return writeFile(outputPath, svg);
}

function buildMarkdown({ summary, categoryRows, familyRows, promptRows }) {
  const categoryLines = categoryRows
    .slice(0, 12)
    .map((row, index) => `${index + 1}. ${row.category}: ${row.verdict}, gap ${row.coverage_gap_score}, prompts ${row.prompts}, pages ${row.pages}.`)
    .join("\n");
  const familyLines = familyRows
    .slice(0, 10)
    .map((row) => `- ${row.family}: test coverage ${row.prompt_coverage}, unlinked products ${row.unlinked_products}, action: ${row.test_action}.`)
    .join("\n");
  const promptLines = promptRows
    .slice(0, 15)
    .map((row, index) => `${index + 1}. ${row.prompt} (${row.category}), ${row.test_state}, priority ${row.priority}.`)
    .join("\n");

  return `# AI Test Area Coverage Audit

## Summary

- Expanded prompts: ${summary.expandedPrompts}
- Provider requests: ${summary.providerRequests}
- Categories covered: ${summary.categories}
- High-gap categories: ${summary.highGapCategories}
- No-mapped prompt categories: ${summary.noMappedPromptCategories}
- Product families audited: ${summary.productFamilies}
- Product families with weak prompt coverage: ${summary.weakFamilyCoverage}
- Top under-tested categories: ${summary.topUnderTestedCategories.join(", ")}
- Top weak product families: ${summary.topWeakFamilies.join(", ")}

## Category Coverage

${categoryLines}

## Product Family Coverage

${familyLines}

## First Prompt Rows To Protect In The Next Run

${promptLines}

## Interpretation

The expanded benchmark is broad enough to run, but it is not evenly balanced against the site. Fleet, fishing, restaurant, delivery, and warehouse are high-pressure categories and should stay in the benchmark. AMPS/modular and streaming have many pages and product-family gaps, so they need more prompts if the goal is full product spread instead of only current competitor displacement.
`;
}

function buildHtml({ markdown, summary, categoryRows, familyRows, promptRows }) {
  const categoryHtml = categoryRows
    .slice(0, 16)
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.coverage_gap_score)}</td>
        <td>${escapeHtml(row.category)}</td>
        <td>${escapeHtml(row.verdict)}</td>
        <td>${escapeHtml(row.prompts)}</td>
        <td>${escapeHtml(row.pages)}</td>
        <td>${escapeHtml(row.competitor_only_answers)}</td>
        <td>${escapeHtml(row.recommended_action)}</td>
      </tr>`,
    )
    .join("\n");
  const familyHtml = familyRows
    .slice(0, 14)
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.family_gap_score)}</td>
        <td>${escapeHtml(row.family)}</td>
        <td>${escapeHtml(row.prompt_coverage)}</td>
        <td>${escapeHtml(row.unlinked_products)}</td>
        <td>${escapeHtml(row.topics)}</td>
        <td>${escapeHtml(row.test_action)}</td>
      </tr>`,
    )
    .join("\n");
  const promptHtml = promptRows
    .slice(0, 18)
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.priority)}</td>
        <td>${escapeHtml(row.prompt)}</td>
        <td>${escapeHtml(row.category)}</td>
        <td>${escapeHtml(row.test_state)}</td>
        <td>${escapeHtml(row.mapped_page)}</td>
        <td>${escapeHtml(row.recommended_action)}</td>
      </tr>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AI Test Area Coverage Audit</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; color: #111827; background: #f6f8fb; }
    main { max-width: 1220px; margin: 0 auto; padding: 32px 20px 56px; }
    h1 { margin: 0 0 8px; font-size: 34px; }
    h2 { margin-top: 34px; font-size: 23px; }
    p, li { line-height: 1.55; color: #344054; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin: 22px 0; }
    .metric { background: #fff; border: 1px solid #d8e0eb; border-radius: 8px; padding: 16px; }
    .metric strong { display: block; font-size: 27px; color: #111827; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #d8e0eb; }
    th, td { border-bottom: 1px solid #e8eef6; padding: 10px 11px; text-align: left; vertical-align: top; font-size: 14px; }
    th { background: #eaf1fb; color: #344054; }
    img { max-width: 100%; background: #fff; border: 1px solid #d8e0eb; border-radius: 8px; margin: 10px 0 20px; }
    pre { white-space: pre-wrap; background: #fff; border: 1px solid #d8e0eb; padding: 16px; border-radius: 8px; }
  </style>
</head>
<body>
  <main>
    <h1>AI Test Area Coverage Audit</h1>
    <p>This checks whether the expanded benchmark covers the same areas where the blog catalog, products, competitors, and citation gaps show demand.</p>
    <div class="grid">
      <div class="metric"><strong>${summary.expandedPrompts}</strong><span>expanded prompts</span></div>
      <div class="metric"><strong>${summary.providerRequests}</strong><span>provider requests</span></div>
      <div class="metric"><strong>${summary.highGapCategories}</strong><span>high-gap categories</span></div>
      <div class="metric"><strong>${summary.weakFamilyCoverage}</strong><span>weak product-family coverage</span></div>
    </div>
    <h2>Charts</h2>
    <img src="test-gap-by-category.svg" alt="Test gap by category">
    <img src="prompt-supply-by-category.svg" alt="Prompt supply by category">
    <h2>Category Coverage</h2>
    <table>
      <thead><tr><th>Gap</th><th>Category</th><th>Verdict</th><th>Prompts</th><th>Pages</th><th>Competitor Only</th><th>Action</th></tr></thead>
      <tbody>${categoryHtml}</tbody>
    </table>
    <h2>Product Family Coverage</h2>
    <table>
      <thead><tr><th>Gap</th><th>Family</th><th>Prompt Coverage</th><th>Unlinked Products</th><th>Topics</th><th>Action</th></tr></thead>
      <tbody>${familyHtml}</tbody>
    </table>
    <h2>Prompt Rows To Preserve</h2>
    <table>
      <thead><tr><th>Priority</th><th>Prompt</th><th>Category</th><th>State</th><th>Mapped Page</th><th>Action</th></tr></thead>
      <tbody>${promptHtml}</tbody>
    </table>
    <h2>Markdown Summary</h2>
    <pre>${escapeHtml(markdown)}</pre>
  </main>
</body>
</html>`;
}

async function main() {
  const baseDir = await latestDir(BENCHMARK_PREFIX);
  const expandedDir = await latestDir(EXPANDED_PREFIX);
  const outDir = path.join(baseDir, "test-area-coverage-audit");
  await mkdir(outDir, { recursive: true });

  const selectedPrompts = await readCsv(path.join(expandedDir, "selected-prompts.csv"));
  const providerManifest = await readCsv(path.join(baseDir, "expanded-benchmark-ops", "provider-request-manifest.csv"));
  const expandedCategoryRows = await readCsv(path.join(baseDir, "expanded-test-coverage-map", "expanded-category-coverage.csv"));
  const expandedPromptRows = await readCsv(path.join(baseDir, "expanded-test-coverage-map", "expanded-prompt-coverage-ledger.csv"));
  const topicDossierRows = await readCsv(path.join(baseDir, "all-blog-post-dossier", "topic-dossier-summary.csv"));
  const productFamilyRows = await readCsv(path.join(baseDir, "product-entity-coverage-plan", "product-family-coverage-summary.csv"));
  const verticalRows = await readCsv(path.join(baseDir, "vertical-playbooks", "category-action-map.csv"));

  const expandedByCategory = indexBy(expandedCategoryRows, "category");
  const topicByCategory = indexBy(topicDossierRows, "category");
  const verticalByCategory = indexBy(verticalRows, "category");
  const categories = new Set([
    ...expandedCategoryRows.map((row) => String(row.category || "").toLowerCase()).filter(Boolean),
    ...topicDossierRows.map((row) => String(row.category || "").toLowerCase()).filter(Boolean),
    ...selectedPrompts.map((row) => String(row.category || "").toLowerCase()).filter(Boolean),
  ]);

  const productFamilyCountersByCategory = new Map();
  for (const family of productFamilyRows) {
    for (const topic of splitList(family.topics)) {
      const category = categoryFromTopicItem(topic);
      if (!category) continue;
      if (!productFamilyCountersByCategory.has(category)) productFamilyCountersByCategory.set(category, { families: [], priority: 0, unlinked: 0 });
      const item = productFamilyCountersByCategory.get(category);
      item.families.push(family.family);
      item.priority += num(family.priority);
      item.unlinked += num(family.unlinked_products);
    }
  }

  const categoryRows = [...categories].map((category) => {
    const expanded = expandedByCategory.get(category) || {};
    const topic = topicByCategory.get(category) || {};
    const vertical = verticalByCategory.get(category) || {};
    const family = productFamilyCountersByCategory.get(category) || { families: [], priority: 0, unlinked: 0 };
    const prompts = num(expanded.prompts) || selectedPrompts.filter((row) => String(row.category || "").toLowerCase() === category).length;
    const requests = num(expanded.requests) || providerManifest.filter((row) => String(row.category || "").toLowerCase() === category).length;
    const pages = num(topic.pages);
    const competitorOnly = num(topic.competitor_only_answers);
    const zeroMention = num(topic.zero_mention_queries);
    const benchmarkPressurePages = num(topic.benchmark_pressure_pages);
    const productFamilyDemand = Math.min(80, family.priority / 8 + family.unlinked / 2);
    const demandScore = clamp(
      pages * 2 +
        benchmarkPressurePages * 11 +
        competitorOnly * 5 +
        zeroMention * 8 +
        productFamilyDemand +
        num(vertical.top_backlog_items ? 10 : 0),
      0,
      220,
    );
    const supplyScore = clamp(prompts * 5 + num(expanded.refresh_then_retest) * 3 + num(expanded.canonical_review) * 2 + num(expanded.mapped_lower_priority), 0, 180);
    const gap = clamp(demandScore - supplyScore + num(expanded.no_mapped_prompts) * 5, 0, 100);
    const row = {
      category,
      prompts,
      requests,
      pages,
      avg_prompt_priority: num(expanded.avg_priority),
      no_mapped_prompts: num(expanded.no_mapped_prompts),
      refresh_then_retest: num(expanded.refresh_then_retest),
      canonical_review: num(expanded.canonical_review),
      mapped_lower_priority: num(expanded.mapped_lower_priority),
      benchmark_pressure_pages: benchmarkPressurePages,
      competitor_only_answers: competitorOnly,
      zero_mention_queries: zeroMention,
      product_family_priority: Math.round(family.priority),
      unlinked_product_family_count: Math.round(family.unlinked),
      product_families: [...new Set(family.families)].slice(0, 8).join("; "),
      top_actions: topic.top_actions || "",
      top_competitors: topic.top_competitors || "",
      top_sources: expanded.top_sources || "",
      state_mix: expanded.state_mix || "",
      prompt_supply_score: supplyScore,
      demand_score: demandScore,
      coverage_gap_score: gap,
      vertical_next_action: vertical.next_action || "",
    };
    row.verdict = coverageVerdict(row);
    row.recommended_action = recommendedTestAction(row);
    return row;
  }).sort((a, b) => b.coverage_gap_score - a.coverage_gap_score || b.demand_score - a.demand_score);

  const categoryPromptCounts = new Map(categoryRows.map((row) => [row.category, row.prompts]));
  const familyRows = productFamilyRows
    .map((family) => {
      const keywords = familyKeywords(family.family);
      const directPromptCoverage = selectedPrompts.filter((promptRow) => promptMatchesFamily(promptRow.prompt, keywords)).length;
      const topicPromptCoverage = splitList(family.topics)
        .map(categoryFromTopicItem)
        .reduce((sum, topic) => sum + (categoryPromptCounts.get(topic) || 0), 0);
      const promptCoverage = directPromptCoverage;
      const gap = clamp(num(family.priority) / 2 + num(family.unlinked_products) * 3 - promptCoverage * 5, 0, 100);
      return {
        family: family.family,
        family_gap_score: gap,
        prompt_coverage: promptCoverage,
        topic_prompt_coverage: topicPromptCoverage,
        matching_keywords: keywords.join("; "),
        unlinked_products: num(family.unlinked_products),
        topics: family.topics,
        sample_products: family.sample_products,
        target_pages: family.target_pages,
        product_action: family.action,
        test_action: gap >= 60
          ? "Add product-family prompts and map them to exact product modules before the next expanded run."
          : "Keep existing category prompts, then retest after product modules are live.",
      };
    })
    .sort((a, b) => b.family_gap_score - a.family_gap_score || b.unlinked_products - a.unlinked_products);

  const promptRows = expandedPromptRows
    .map((row) => ({
      priority: num(row.priority),
      prompt: row.prompt,
      category: row.category,
      source: row.source,
      reason: row.reason,
      provider_request_count: num(row.provider_request_count),
      providers: row.providers,
      batch_id: row.batch_id,
      test_state: row.test_state,
      mapped_page: row.mapped_page,
      no_mapped_prompt: row.no_mapped_prompt,
      competitor_context: row.competitor_context,
      mention_rate_baseline: row.mention_rate_baseline,
      competitor_only_answers: row.competitor_only_answers,
      backlog_items: row.backlog_items,
      recommended_action: row.recommended_action,
    }))
    .sort((a, b) => b.priority - a.priority || num(b.competitor_only_answers) - num(a.competitor_only_answers));

  const categoryCsv = [
    [
      "coverage_gap_score",
      "category",
      "verdict",
      "prompts",
      "requests",
      "pages",
      "demand_score",
      "prompt_supply_score",
      "avg_prompt_priority",
      "no_mapped_prompts",
      "refresh_then_retest",
      "canonical_review",
      "mapped_lower_priority",
      "benchmark_pressure_pages",
      "competitor_only_answers",
      "zero_mention_queries",
      "product_family_priority",
      "unlinked_product_family_count",
      "product_families",
      "top_actions",
      "top_competitors",
      "top_sources",
      "state_mix",
      "recommended_action",
      "vertical_next_action",
    ],
    ...categoryRows.map((row) => [
      row.coverage_gap_score,
      row.category,
      row.verdict,
      row.prompts,
      row.requests,
      row.pages,
      row.demand_score,
      row.prompt_supply_score,
      row.avg_prompt_priority,
      row.no_mapped_prompts,
      row.refresh_then_retest,
      row.canonical_review,
      row.mapped_lower_priority,
      row.benchmark_pressure_pages,
      row.competitor_only_answers,
      row.zero_mention_queries,
      row.product_family_priority,
      row.unlinked_product_family_count,
      row.product_families,
      row.top_actions,
      row.top_competitors,
      row.top_sources,
      row.state_mix,
      row.recommended_action,
      row.vertical_next_action,
    ]),
  ];

  const familyCsv = [
    ["family_gap_score", "family", "prompt_coverage", "topic_prompt_coverage", "matching_keywords", "unlinked_products", "topics", "sample_products", "target_pages", "product_action", "test_action"],
    ...familyRows.map((row) => [
      row.family_gap_score,
      row.family,
      row.prompt_coverage,
      row.topic_prompt_coverage,
      row.matching_keywords,
      row.unlinked_products,
      row.topics,
      row.sample_products,
      row.target_pages,
      row.product_action,
      row.test_action,
    ]),
  ];

  const promptCsv = [
    [
      "priority",
      "prompt",
      "category",
      "source",
      "reason",
      "provider_request_count",
      "providers",
      "batch_id",
      "test_state",
      "mapped_page",
      "no_mapped_prompt",
      "competitor_context",
      "mention_rate_baseline",
      "competitor_only_answers",
      "backlog_items",
      "recommended_action",
    ],
    ...promptRows.map((row) => [
      row.priority,
      row.prompt,
      row.category,
      row.source,
      row.reason,
      row.provider_request_count,
      row.providers,
      row.batch_id,
      row.test_state,
      row.mapped_page,
      row.no_mapped_prompt,
      row.competitor_context,
      row.mention_rate_baseline,
      row.competitor_only_answers,
      row.backlog_items,
      row.recommended_action,
    ]),
  ];

  const summary = {
    sourceBenchmarkDir: baseDir,
    expandedPromptDir: expandedDir,
    expandedPrompts: selectedPrompts.length,
    providerRequests: providerManifest.length,
    categories: categoryRows.length,
    highGapCategories: categoryRows.filter((row) => row.coverage_gap_score >= 70).length,
    noMappedPromptCategories: categoryRows.filter((row) => row.no_mapped_prompts > 0).length,
    productFamilies: familyRows.length,
    weakFamilyCoverage: familyRows.filter((row) => row.family_gap_score >= 60).length,
    topUnderTestedCategories: categoryRows.slice(0, 8).map((row) => `${row.category} ${row.coverage_gap_score}`),
    topWeakFamilies: familyRows.slice(0, 8).map((row) => `${row.family} ${row.family_gap_score}`),
    protectedPromptRows: promptRows.length,
  };

  const markdown = buildMarkdown({ summary, categoryRows, familyRows, promptRows });
  const html = buildHtml({ markdown, summary, categoryRows, familyRows, promptRows });

  await writeFile(path.join(outDir, "test-area-coverage-data.json"), JSON.stringify({ summary, categoryRows, familyRows, promptRows }, null, 2));
  await writeFile(path.join(outDir, "category-test-coverage.csv"), csv(categoryCsv));
  await writeFile(path.join(outDir, "product-family-test-coverage.csv"), csv(familyCsv));
  await writeFile(path.join(outDir, "prompt-coverage-priority.csv"), csv(promptCsv));
  await writeFile(path.join(outDir, "REPORT.md"), markdown);
  await writeFile(path.join(outDir, "REPORT.html"), html);
  await buildSvgBarChart({
    title: "Test Coverage Gap By Category",
    rows: categoryRows,
    labelField: "category",
    valueField: "coverage_gap_score",
    outputPath: path.join(outDir, "test-gap-by-category.svg"),
  });
  await buildSvgBarChart({
    title: "Prompt Supply By Category",
    rows: [...categoryRows].sort((a, b) => b.prompts - a.prompts),
    labelField: "category",
    valueField: "prompts",
    outputPath: path.join(outDir, "prompt-supply-by-category.svg"),
    color: "#19a974",
  });

  console.log(`Wrote ${path.relative(process.cwd(), outDir)}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
