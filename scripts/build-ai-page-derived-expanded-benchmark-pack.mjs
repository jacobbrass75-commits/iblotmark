import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";
const PROVIDERS = ["chatgpt", "gemini_plain", "claude"];

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

async function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
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
    .replace(/budget/gi, "value")
    .replace(/\s+/g, " ")
    .trim();
}

function splitList(value) {
  if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean);
  return String(value ?? "")
    .split(/[;|]/)
    .map((item) => normalizeText(item.trim()))
    .filter(Boolean)
    .filter((item) => !/^\+\d+\s+more$/i.test(item));
}

function slug(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqueKey(prompt) {
  return normalizeText(prompt).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function titleToUseCase(title) {
  let text = normalizeText(title)
    .replace(/\b20\d{2}\b/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\biBOLT\b/gi, "")
    .replace(/\bmounts?\b/gi, "mount")
    .replace(/\bhow to\b/gi, "")
    .replace(/\bbest\b/gi, "")
    .replace(/\bguide\b/gi, "")
    .replace(/\bcomparison\b/gi, "")
    .replace(/\bcompared\b/gi, "")
    .replace(/\bchoosing?\b/gi, "")
    .replace(/[?:,]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!/\bmount\b/.test(text)) text = `${text} mount`;
  return text.replace(/\s+/g, " ").trim();
}

function categoryUseCase(category) {
  const map = {
    restaurant: "restaurant tablet and POS mount",
    delivery: "delivery driver phone mount",
    fishing: "fish finder and boat phone mount",
    fleet: "fleet and ELD vehicle mount",
    warehouse: "forklift tablet and barcode scanner mount",
    streaming: "live streaming phone and camera mount",
    "amps/modular": "AMPS mounting plate and modular mounting system",
    education: "school tablet mount",
    offroad: "offroad phone and camera mount",
    agriculture: "tractor and farm equipment tablet mount",
    travel: "road trip phone and tablet mount",
  };
  return map[category] || `${category} device mount`;
}

function promptRowsForPage(row) {
  const category = normalizeText(row.category);
  const useCase = titleToUseCase(row.title) || categoryUseCase(category);
  const categoryCase = categoryUseCase(category);
  const competitors = splitList(row.competitors).map((item) => item.replace(/\s+\d+$/, "")).filter(Boolean);
  const competitor = competitors.find((item) => !/garmin|humminbird|lowrance|square/i.test(item)) || competitors[0] || "RAM Mounts";
  const products = splitList(row.productsToFeature).filter((item) => !/^\d+$/.test(item));
  const prompts = [];
  const basePriority = Math.max(45, Math.min(100, Math.round(num(row.visibilityRiskScore) / 4)));
  const existingPrompts = [...splitList(row.linkedPrompts), ...splitList(row.queryPrompts), ...splitList(row.retestPrompts)]
    .map((prompt) => normalizeText(prompt).replace(/\bbudget\b/gi, "value"))
    .filter(Boolean);

  for (const prompt of existingPrompts.slice(0, 4)) {
    prompts.push({
      prompt,
      category,
      source: "mapped_existing_prompt",
      priority: Math.min(100, basePriority + 12),
      reason: `Mapped prompt already tied to ${row.title}; current stage is ${row.visibilityStage}.`,
      closestPost: row.title,
      pageUrl: row.url,
      promptType: "mapped",
      refreshState: /canonical/i.test(row.pageStatus) ? "canonical_review_then_retest" : "refresh_then_retest",
      expectedMetric: "mapped-query mention and top-three recovery",
    });
  }

  prompts.push(
    {
      prompt: `best ${useCase}`,
      category,
      source: "page_title_nonbranded",
      priority: basePriority,
      reason: `Non-branded buyer prompt derived from live page title and ${row.visibilityStage} stage.`,
      closestPost: row.title,
      pageUrl: row.url,
      promptType: "non_branded_best",
      refreshState: /competitor replacement/i.test(row.visibilityStage) ? "refresh_then_retest" : "coverage_retest",
      expectedMetric: "non-branded inclusion",
    },
    {
      prompt: `what ${categoryCase} should I use for ${useCase}`,
      category,
      source: "buyer_problem_prompt",
      priority: Math.max(45, basePriority - 4),
      reason: `Conversational buyer prompt for AI assistant and voice-assistant behavior.`,
      closestPost: row.title,
      pageUrl: row.url,
      promptType: "buyer_problem",
      refreshState: "coverage_retest",
      expectedMetric: "assistant recommendation inclusion",
    },
    {
      prompt: `${competitor} vs iBOLT for ${useCase}`,
      category,
      source: "competitor_comparison_prompt",
      priority: Math.min(100, basePriority + 10),
      reason: `Comparison prompt based on competitor set detected for this page.`,
      closestPost: row.title,
      pageUrl: row.url,
      promptType: "comparison",
      refreshState: /canonical/i.test(row.pageStatus) ? "canonical_review_then_retest" : "comparison_refresh_then_retest",
      expectedMetric: "co-mention to top-three movement",
    },
  );

  if (products[0]) {
    prompts.push({
      prompt: `is ${products[0]} good for ${useCase}`,
      category,
      source: "product_entity_prompt",
      priority: Math.min(100, basePriority + 6),
      reason: `Product-specific recall prompt tied to a product module target on the page.`,
      closestPost: row.title,
      pageUrl: row.url,
      promptType: "product_entity",
      refreshState: "product_entity_retest",
      expectedMetric: "catalog product recall",
    });
  }

  if (/citation|schema|cleanup/i.test(`${row.pageStatus} ${row.citationReadinessBucket}`)) {
    prompts.push({
      prompt: `which brands are cited for ${categoryCase}`,
      category,
      source: "citation_probe_prompt",
      priority: Math.max(45, basePriority - 8),
      reason: `Citation/source probe for page currently marked ${row.citationReadinessBucket}.`,
      closestPost: row.title,
      pageUrl: row.url,
      promptType: "citation_probe",
      refreshState: "citation_cleanup_then_retest",
      expectedMetric: "target-domain citation and source recall",
    });
  }

  return prompts;
}

function dedupePrompts(rows) {
  const seen = new Map();
  for (const row of rows) {
    const key = uniqueKey(row.prompt);
    if (!key) continue;
    const existing = seen.get(key);
    if (!existing || num(row.priority) > num(existing.priority)) seen.set(key, row);
  }
  return [...seen.values()].sort((a, b) => num(b.priority) - num(a.priority) || a.prompt.localeCompare(b.prompt));
}

function batchId(index) {
  return `P${String(Math.floor(index / 18) + 1).padStart(2, "0")}`;
}

function chartSvg({ title, subtitle, rows, width = 1040, height = 430, color = "#1d4ed8" }) {
  const margin = { top: 78, right: 70, bottom: 34, left: 260 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(...rows.map((row) => num(row.value)), 1);
  const rowHeight = chartHeight / Math.max(rows.length, 1);
  const bars = rows.map((row, index) => {
    const y = margin.top + index * rowHeight + 6;
    const h = Math.max(14, rowHeight - 12);
    const w = Math.round((num(row.value) / maxValue) * chartWidth);
    return `
      <text x="${margin.left - 14}" y="${y + h / 2 + 5}" text-anchor="end" font-size="14" fill="#334155">${escapeHtml(row.name)}</text>
      <rect x="${margin.left}" y="${y}" width="${w}" height="${h}" rx="7" fill="${color}"></rect>
      <text x="${Math.min(margin.left + w + 10, width - 54)}" y="${y + h / 2 + 5}" font-size="14" font-weight="800" fill="#0f172a">${escapeHtml(row.value)}</text>
    `;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <text x="28" y="36" font-size="25" font-weight="900" fill="#0f172a">${escapeHtml(title)}</text>
  <text x="28" y="62" font-size="14" fill="#64748b">${escapeHtml(subtitle)}</text>
  ${bars}
</svg>`;
}

function countBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const value = normalizeText(row[key] || "unknown");
    map.set(value, (map.get(value) || 0) + 1);
  }
  return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

function buildHtml({ summary, promptRows, categoryRows, typeRows, categoryChartName, typeChartName }) {
  const kpis = [
    ["Prompt rows", summary.prompts],
    ["Provider requests", summary.providerRequests],
    ["Pages covered", summary.pagesCovered],
    ["Categories", summary.categories],
    ["Comparison prompts", summary.comparisonPrompts],
    ["Product prompts", summary.productPrompts],
  ];
  const promptTable = promptRows.slice(0, 55).map((row, index) => `<tr>
    <td>${index + 1}</td>
    <td>${escapeHtml(row.prompt)}</td>
    <td>${escapeHtml(row.category)}</td>
    <td>${escapeHtml(row.promptType)}</td>
    <td>${escapeHtml(row.priority)}</td>
    <td><a href="${escapeHtml(row.pageUrl)}">${escapeHtml(row.closestPost)}</a></td>
    <td>${escapeHtml(row.expectedMetric)}</td>
  </tr>`).join("");
  const categoryTable = categoryRows.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.value)}</td></tr>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>iBOLT Page-Derived Expanded Benchmark Pack</title>
  <style>
    body{margin:0;background:#f8fafc;color:#0f172a;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{max-width:1200px;margin:0 auto;padding:34px 24px 60px}
    h1{font-size:36px;line-height:1.08;margin:0 0 12px;letter-spacing:0}h2{font-size:24px;margin:36px 0 14px}
    p{color:#334155;line-height:1.65;max-width:980px}.hero,.panel{background:#fff;border:1px solid #d9e2ec;border-radius:8px;padding:24px;box-shadow:0 10px 28px rgba(15,23,42,.06)}
    .kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:22px}.kpi{border:1px solid #d9e2ec;border-radius:8px;padding:16px;background:#fff}
    .kpi strong{display:block;font-size:28px}.kpi span{display:block;margin-top:6px;color:#64748b;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.05em}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:20px}.chart{width:100%;height:auto;display:block;border:1px solid #d9e2ec;border-radius:8px;background:#fff}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d9e2ec;border-radius:8px;overflow:hidden}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #d9e2ec;padding:10px 11px;font-size:13px;line-height:1.45}
    th{background:#eef4ff;color:#1e3a8a;text-transform:uppercase;font-size:12px;letter-spacing:.05em}a{color:#1d4ed8;font-weight:800}
    @media(max-width:850px){.kpis,.grid{grid-template-columns:1fr}h1{font-size:30px}}
  </style>
</head>
<body><main>
  <section class="hero">
    <h1>iBOLT Page-Derived Expanded Benchmark Pack</h1>
    <p>This dry-run pack expands benchmark coverage from the live blog inventory. It creates one-at-a-time prompts for non-branded buyer discovery, competitor comparisons, product entity recall, voice-assistant style questions, and citation probes.</p>
    <div class="kpis">${kpis.map(([label, value]) => `<div class="kpi"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join("")}</div>
  </section>
  <h2>Coverage</h2>
  <section class="panel"><div class="grid"><img class="chart" src="${escapeHtml(categoryChartName)}" alt="Prompt count by category"><img class="chart" src="${escapeHtml(typeChartName)}" alt="Prompt count by prompt type"></div></section>
  <h2>Top Prompts To Run</h2>
  <table><thead><tr><th>#</th><th>Prompt</th><th>Category</th><th>Type</th><th>Priority</th><th>Closest page</th><th>Metric</th></tr></thead><tbody>${promptTable}</tbody></table>
  <h2>Category Counts</h2>
  <table><thead><tr><th>Category</th><th>Prompts</th></tr></thead><tbody>${categoryTable}</tbody></table>
</main></body></html>`;
}

function buildMarkdown({ summary, promptRows, categoryRows, typeRows, outputDir }) {
  const topPrompts = promptRows.slice(0, 20).map((row, index) => `${index + 1}. ${row.prompt} (${row.category}, ${row.promptType}, priority ${row.priority})`).join("\n");
  const categories = categoryRows.map((row) => `- ${row.name}: ${row.value}`).join("\n");
  const types = typeRows.map((row) => `- ${row.name}: ${row.value}`).join("\n");
  return `# iBOLT Page-Derived Expanded Benchmark Pack

## Summary

- Prompt rows: ${summary.prompts}.
- Provider requests: ${summary.providerRequests}.
- Pages covered: ${summary.pagesCovered}.
- Categories covered: ${summary.categories}.
- Comparison prompts: ${summary.comparisonPrompts}.
- Product-entity prompts: ${summary.productPrompts}.
- Citation-probe prompts: ${summary.citationProbePrompts}.

## Category Coverage

${categories}

## Prompt Type Coverage

${types}

## Top Prompts

${topPrompts}

## Files

- HTML report: ${path.join(outputDir, "REPORT.html")}
- Selected prompts: ${path.join(outputDir, "selected-prompts.csv")}
- Provider request manifest: ${path.join(outputDir, "provider-request-manifest.csv")}
- Category coverage: ${path.join(outputDir, "prompt-coverage-by-category.csv")}
- Type coverage: ${path.join(outputDir, "prompt-coverage-by-type.csv")}
`;
}

async function main() {
  const benchmarkDir = process.argv[2] ? path.resolve(process.argv[2]) : await latestDir(BENCHMARK_PREFIX);
  const outputDir = path.join(benchmarkDir, "page-derived-expanded-benchmark-pack");
  await mkdir(outputDir, { recursive: true });

  const controlData = await readJsonIfExists(path.join(benchmarkDir, "blog-post-visibility-control-report", "blog-post-visibility-control-data.json"), null);
  if (!controlData?.controlRows?.length) {
    throw new Error("Missing blog-post-visibility-control-data.json. Run scripts/build-ai-blog-post-visibility-control-report.mjs first.");
  }

  const eligiblePages = controlData.controlRows
    .filter((row) => row.visibilityStage !== "No benchmark pressure" || row.priorityScore >= 70 || row.productEntityQueueRows > 0)
    .sort((a, b) => num(b.visibilityRiskScore) - num(a.visibilityRiskScore));
  const promptRows = dedupePrompts(eligiblePages.flatMap(promptRowsForPage));
  const manifestRows = [];
  promptRows.forEach((row, index) => {
    for (const provider of PROVIDERS) {
      manifestRows.push({
        batchId: batchId(index),
        provider,
        ...row,
      });
    }
  });

  const categoryRows = countBy(promptRows, "category");
  const typeRows = countBy(promptRows, "promptType");
  const pagesCovered = new Set(promptRows.map((row) => row.pageUrl)).size;
  const summary = {
    benchmarkDir,
    outputDir,
    prompts: promptRows.length,
    providerRequests: manifestRows.length,
    pagesCovered,
    sourcePages: controlData.controlRows.length,
    categories: categoryRows.length,
    comparisonPrompts: promptRows.filter((row) => row.promptType === "comparison").length,
    productPrompts: promptRows.filter((row) => row.promptType === "product_entity").length,
    citationProbePrompts: promptRows.filter((row) => row.promptType === "citation_probe").length,
    buyerProblemPrompts: promptRows.filter((row) => row.promptType === "buyer_problem").length,
    nonBrandedBestPrompts: promptRows.filter((row) => row.promptType === "non_branded_best").length,
    topCategories: categoryRows.slice(0, 8).map((row) => `${row.name} ${row.value}`),
    topTypes: typeRows.map((row) => `${row.name} ${row.value}`),
  };

  await writeFile(path.join(outputDir, "selected-prompts.csv"), toCsv([
    ["prompt", "category", "source", "priority", "reason", "closest_post", "page_url", "prompt_type", "refresh_state", "expected_metric"],
    ...promptRows.map((row) => [row.prompt, row.category, row.source, row.priority, row.reason, row.closestPost, row.pageUrl, row.promptType, row.refreshState, row.expectedMetric]),
  ]));
  await writeFile(path.join(outputDir, "provider-request-manifest.csv"), toCsv([
    ["batch_id", "provider", "prompt", "category", "source", "priority", "closest_post", "page_url", "prompt_type", "refresh_state", "expected_metric"],
    ...manifestRows.map((row) => [row.batchId, row.provider, row.prompt, row.category, row.source, row.priority, row.closestPost, row.pageUrl, row.promptType, row.refreshState, row.expectedMetric]),
  ]));
  await writeFile(path.join(outputDir, "prompt-coverage-by-category.csv"), toCsv([
    ["category", "prompt_count"],
    ...categoryRows.map((row) => [row.name, row.value]),
  ]));
  await writeFile(path.join(outputDir, "prompt-coverage-by-type.csv"), toCsv([
    ["prompt_type", "prompt_count"],
    ...typeRows.map((row) => [row.name, row.value]),
  ]));

  const categoryChartName = "prompt-coverage-by-category.svg";
  const typeChartName = "prompt-coverage-by-type.svg";
  await writeFile(path.join(outputDir, categoryChartName), chartSvg({
    title: "Prompt Coverage By Category",
    subtitle: `${summary.prompts} page-derived prompts from ${summary.pagesCovered} live pages`,
    rows: categoryRows.slice(0, 12).map((row) => ({ name: row.name, value: row.value })),
    color: "#1d4ed8",
  }));
  await writeFile(path.join(outputDir, typeChartName), chartSvg({
    title: "Prompt Coverage By Type",
    subtitle: "The expanded run tests buyer discovery, comparison, product recall, and citation behavior",
    rows: typeRows.map((row) => ({ name: row.name, value: row.value })),
    color: "#0f766e",
  }));

  await writeFile(path.join(outputDir, "page-derived-expanded-benchmark-data.json"), `${JSON.stringify({ summary, promptRows, manifestRows, categoryRows, typeRows }, null, 2)}\n`);
  await writeFile(path.join(outputDir, "REPORT.md"), buildMarkdown({ summary, promptRows, categoryRows, typeRows, outputDir }));
  await writeFile(path.join(outputDir, "REPORT.html"), buildHtml({ summary, promptRows, categoryRows, typeRows, categoryChartName, typeChartName }));
  await writeFile(path.join(outputDir, "DRY_RUN.md"), `# Dry Run Only

This pack does not call OpenRouter or any live model. It expands the prompt backlog from the live blog page inventory.

To run this as a live benchmark later, set \`OPENROUTER_API_KEY\` in the local shell and adapt \`scripts/run-expanded-openrouter-ai-benchmark.ts\` to read:

\`${path.join(outputDir, "provider-request-manifest.csv")}\`

Keep requests one-at-a-time per provider and prompt.
`);

  console.log(`Page-derived expanded benchmark pack written to ${outputDir}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
