#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const OUTPUT_ROOT = path.join(ROOT, "content-output");
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";
const EXPANDED_PREFIX = "openrouter-expanded-ai-benchmark-";
const PROVIDERS = ["chatgpt", "gemini_plain", "claude"];
const BATCH_SIZE = 20;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function csv(rows) {
  return `${rows.map((row) => row.map(csvEscape).join(",")).join("\n")}\n`;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
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
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  if (!rows.length) return [];
  const [headers, ...records] = rows;
  return records
    .filter((record) => record.some((value) => String(value ?? "").length > 0))
    .map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""])));
}

async function readCsv(filePath) {
  return parseCsv(await readFile(filePath, "utf8"));
}

async function latestDir(prefix) {
  const entries = await readdir(OUTPUT_ROOT, { withFileTypes: true });
  const matches = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort();
  if (!matches.length) throw new Error(`No content-output directory found with prefix ${prefix}`);
  return path.join(OUTPUT_ROOT, matches.at(-1));
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function countBy(rows, keyFn) {
  const counts = new Map();
  for (const row of rows) {
    const key = keyFn(row) || "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function batchPurpose(prompts) {
  const sources = new Set(prompts.map((prompt) => prompt.source));
  const categories = new Set(prompts.map((prompt) => prompt.category));
  if (sources.has("current_visibility_gap")) return "Baseline the worst current zero-mention or low-score prompts.";
  if (sources.has("competitor_displacement") || sources.has("head_to_head_comparison")) return "Measure whether iBOLT enters competitor consideration sets.";
  if (sources.has("blog_inventory_title")) return "Check whether existing blog inventory is turning into model memory or recommendations.";
  if (sources.has("consumer_buyer_prompt")) return "Test realistic commercial buyer questions across normal consumer models.";
  if (categories.has("fishing")) return "Probe marine and fish-finder mounting gaps where iBOLT currently has weak AI recall.";
  return "Expand coverage across long-tail buyer prompts and vertical gaps.";
}

function makeBatches(prompts) {
  const sorted = [...prompts].sort((a, b) => num(b.priority) - num(a.priority) || a.category.localeCompare(b.category) || a.prompt.localeCompare(b.prompt));
  const batches = [];
  for (let index = 0; index < sorted.length; index += BATCH_SIZE) {
    const promptsInBatch = sorted.slice(index, index + BATCH_SIZE);
    const id = `B${String(batches.length + 1).padStart(2, "0")}`;
    batches.push({
      id,
      sequence: batches.length + 1,
      prompts: promptsInBatch,
      promptCount: promptsInBatch.length,
      requestCount: promptsInBatch.length * PROVIDERS.length,
      minPriority: Math.min(...promptsInBatch.map((prompt) => num(prompt.priority))),
      maxPriority: Math.max(...promptsInBatch.map((prompt) => num(prompt.priority))),
      categories: countBy(promptsInBatch, (prompt) => prompt.category).map(([key, value]) => `${key} ${value}`).join("; "),
      sources: countBy(promptsInBatch, (prompt) => prompt.source).map(([key, value]) => `${key} ${value}`).join("; "),
      purpose: batchPurpose(promptsInBatch),
    });
  }
  return batches;
}

function makePromptRows(prompts, pageBriefs, batches) {
  const pageByTitle = new Map(pageBriefs.map((row) => [normalize(row.page_title), row]));
  const batchByPrompt = new Map();
  for (const batch of batches) {
    for (const prompt of batch.prompts) batchByPrompt.set(prompt.prompt, batch.id);
  }
  return prompts.map((prompt) => {
    const page = pageByTitle.get(normalize(prompt.closest_post));
    const refreshState = page
      ? page.duplicate_risk === "yes"
        ? "canonical_review_before_retest"
        : "refresh_then_retest"
      : prompt.closest_post
        ? "mapped_page_not_in_top_refresh_queue"
        : "no_mapped_page";
    return {
      ...prompt,
      batchId: batchByPrompt.get(prompt.prompt) || "",
      providers: PROVIDERS.join("; "),
      requestCount: PROVIDERS.length,
      refreshState,
      pageScore: page?.page_score || "",
      productsToAdd: page?.product_module || page?.products_to_add || "",
      competitors: page?.competitors || "",
      schemaFixes: page?.schema_fixes || "",
      retestAction: page?.retest_action || `Run prompt on ${PROVIDERS.join(", ")}.`,
    };
  });
}

function makeProviderRows(promptRows) {
  return promptRows.flatMap((prompt) => PROVIDERS.map((provider) => ({
    batchId: prompt.batchId,
    provider,
    prompt: prompt.prompt,
    category: prompt.category,
    source: prompt.source,
    priority: prompt.priority,
    closestPost: prompt.closest_post,
    refreshState: prompt.refreshState,
    expectedMetric: provider === "gemini_plain" ? "non-search model recall" : "consumer-model recommendation behavior",
  })));
}

function makeCoverageRows(promptRows) {
  const categories = countBy(promptRows, (row) => row.category);
  return categories.map(([category, promptCount]) => {
    const rows = promptRows.filter((row) => row.category === category);
    const currentGaps = rows.filter((row) => row.source === "current_visibility_gap").length;
    const competitorPrompts = rows.filter((row) => row.source === "competitor_displacement" || row.source === "head_to_head_comparison").length;
    const mappedPages = new Set(rows.map((row) => row.closest_post).filter(Boolean)).size;
    const refreshBeforeRetest = rows.filter((row) => row.refreshState !== "mapped_page_not_in_top_refresh_queue" && row.refreshState !== "no_mapped_page").length;
    return {
      category,
      promptCount,
      requestCount: promptCount * PROVIDERS.length,
      currentGaps,
      competitorPrompts,
      mappedPages,
      refreshBeforeRetest,
      topSources: countBy(rows, (row) => row.source).slice(0, 4).map(([source, count]) => `${source} ${count}`).join("; "),
    };
  }).sort((a, b) => b.promptCount - a.promptCount || a.category.localeCompare(b.category));
}

function makeSourceRows(promptRows) {
  return countBy(promptRows, (row) => row.source).map(([source, promptCount]) => ({
    source,
    promptCount,
    requestCount: promptCount * PROVIDERS.length,
    topCategories: countBy(promptRows.filter((row) => row.source === source), (row) => row.category).slice(0, 6).map(([category, count]) => `${category} ${count}`).join("; "),
  }));
}

function makePostRetestRows(promptRows) {
  const byPost = new Map();
  for (const row of promptRows) {
    if (!row.closest_post) continue;
    const key = row.closest_post;
    const current = byPost.get(key) ?? {
      closestPost: key,
      prompts: [],
      categories: new Set(),
      sources: new Set(),
      refreshStates: new Set(),
      productsToAdd: row.productsToAdd,
      competitors: row.competitors,
      schemaFixes: row.schemaFixes,
    };
    current.prompts.push(row.prompt);
    current.categories.add(row.category);
    current.sources.add(row.source);
    current.refreshStates.add(row.refreshState);
    if (!current.productsToAdd && row.productsToAdd) current.productsToAdd = row.productsToAdd;
    if (!current.competitors && row.competitors) current.competitors = row.competitors;
    if (!current.schemaFixes && row.schemaFixes) current.schemaFixes = row.schemaFixes;
    byPost.set(key, current);
  }
  return [...byPost.values()].map((row) => ({
    closestPost: row.closestPost,
    promptCount: row.prompts.length,
    requestCount: row.prompts.length * PROVIDERS.length,
    categories: [...row.categories].join("; "),
    sources: [...row.sources].join("; "),
    refreshStates: [...row.refreshStates].join("; "),
    prompts: row.prompts.slice(0, 12).join("; "),
    productsToAdd: row.productsToAdd,
    competitors: row.competitors,
    schemaFixes: row.schemaFixes,
  })).sort((a, b) => b.promptCount - a.promptCount || a.closestPost.localeCompare(b.closestPost));
}

function buildMarkdown({ promptRows, providerRows, batches, coverageRows, sourceRows, postRows, benchmarkDir, expandedDir }) {
  const needsRefresh = promptRows.filter((row) => row.refreshState === "canonical_review_before_retest" || row.refreshState === "refresh_then_retest").length;
  const noMapped = promptRows.filter((row) => row.refreshState === "no_mapped_page").length;
  const topCoverage = coverageRows.slice(0, 12);
  const topPosts = postRows.slice(0, 15);
  return `# Expanded Benchmark Operations Report

This report prepares the remaining live benchmark without exposing or storing any API key. It turns the 207-prompt backlog into provider-level requests, run batches, category coverage, and post-refresh retest targets.

## Summary

- Expanded prompts: ${promptRows.length}
- Providers: ${PROVIDERS.join(", ")}
- Total one-at-a-time provider requests: ${providerRows.length}
- Batches at ${BATCH_SIZE} prompts each: ${batches.length}
- Prompts tied to refresh/canonical review work: ${needsRefresh}
- Prompts without a mapped post: ${noMapped}
- Source prompt file: ${path.join(benchmarkDir, "deep-dive", "expanded-benchmark-prompts.csv")}
- Dry-run folder: ${expandedDir}

## Run Batches

| Batch | Prompts | Requests | Priority range | Categories | Sources | Purpose |
| --- | --- | --- | --- | --- | --- | --- |
${batches.map((batch) => `| ${batch.id} | ${batch.promptCount} | ${batch.requestCount} | ${batch.minPriority}-${batch.maxPriority} | ${batch.categories} | ${batch.sources} | ${batch.purpose} |`).join("\n")}

## Category Coverage

| Category | Prompts | Requests | Current gaps | Competitor prompts | Mapped pages | Refresh before retest | Top sources |
| --- | --- | --- | --- | --- | --- | --- | --- |
${topCoverage.map((row) => `| ${row.category} | ${row.promptCount} | ${row.requestCount} | ${row.currentGaps} | ${row.competitorPrompts} | ${row.mappedPages} | ${row.refreshBeforeRetest} | ${row.topSources} |`).join("\n")}

## Source Mix

| Source | Prompts | Requests | Top categories |
| --- | --- | --- | --- |
${sourceRows.map((row) => `| ${row.source} | ${row.promptCount} | ${row.requestCount} | ${row.topCategories} |`).join("\n")}

## Post-Retest Targets

| Post | Prompts | Requests | Categories | Refresh state | Products / fixes |
| --- | --- | --- | --- | --- | --- |
${topPosts.map((row) => `| ${row.closestPost} | ${row.promptCount} | ${row.requestCount} | ${row.categories} | ${row.refreshStates} | ${row.productsToAdd || row.schemaFixes || "review mapped page"} |`).join("\n")}

## Execution Rule

Use the app's existing expanded benchmark runner only after setting \`OPENROUTER_API_KEY\` in the local shell. Keep \`AI_BENCHMARK_EXPANDED_LIMIT=0\` to run all 207 prompts, and keep the provider set to ChatGPT, Gemini plain, and Claude so the test reflects normal consumer-accessible model behavior.
`;
}

function buildHtml(markdown) {
  const lines = markdown.split("\n");
  const html = [];
  let inTable = false;
  for (const line of lines) {
    if (line.startsWith("# ")) {
      if (inTable) {
        html.push("</tbody></table>");
        inTable = false;
      }
      html.push(`<h1>${escapeHtml(line.slice(2))}</h1>`);
    } else if (line.startsWith("## ")) {
      if (inTable) {
        html.push("</tbody></table>");
        inTable = false;
      }
      html.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
    } else if (line.startsWith("| ")) {
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      if (cells.every((cell) => /^-+$/.test(cell.replaceAll(" ", "")))) continue;
      if (!inTable) {
        html.push("<table><tbody>");
        inTable = true;
      }
      const tag = html.at(-1) === "<table><tbody>" ? "th" : "td";
      html.push(`<tr>${cells.map((cell) => `<${tag}>${escapeHtml(cell)}</${tag}>`).join("")}</tr>`);
    } else if (line.trim()) {
      if (inTable) {
        html.push("</tbody></table>");
        inTable = false;
      }
      html.push(`<p>${escapeHtml(line)}</p>`);
    }
  }
  if (inTable) html.push("</tbody></table>");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Expanded Benchmark Operations Report</title>
<style>
body{font-family:Inter,Arial,sans-serif;margin:0;background:#f8fafc;color:#0f172a;line-height:1.5}
main{max-width:1240px;margin:0 auto;padding:36px 22px 72px}
h1{font-size:38px;line-height:1.08;margin:0 0 18px}
h2{font-size:24px;margin:34px 0 12px}
p{font-size:16px;color:#334155}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;margin:14px 0 26px;font-size:13px}
th,td{text-align:left;vertical-align:top;border-bottom:1px solid #e2e8f0;padding:9px 10px}
th{background:#e2e8f0;font-weight:700}
tr:nth-child(even) td{background:#f8fafc}
code{background:#e2e8f0;padding:2px 5px;border-radius:5px}
</style>
</head><body><main>${html.join("\n")}</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const expandedDir = await latestDir(EXPANDED_PREFIX);
  const outDir = path.join(benchmarkDir, "expanded-benchmark-ops");
  await mkdir(outDir, { recursive: true });

  const prompts = await readCsv(path.join(benchmarkDir, "deep-dive", "expanded-benchmark-prompts.csv"));
  const pageBriefs = await readCsv(path.join(benchmarkDir, "page-refresh-playbook", "page-refresh-briefs.csv"));
  const batches = makeBatches(prompts);
  const promptRows = makePromptRows(prompts, pageBriefs, batches);
  const providerRows = makeProviderRows(promptRows);
  const coverageRows = makeCoverageRows(promptRows);
  const sourceRows = makeSourceRows(promptRows);
  const postRows = makePostRetestRows(promptRows);

  await writeFile(path.join(outDir, "benchmark-run-batches.csv"), csv([
    ["batch_id", "sequence", "prompt_count", "request_count", "min_priority", "max_priority", "categories", "sources", "purpose"],
    ...batches.map((row) => [row.id, row.sequence, row.promptCount, row.requestCount, row.minPriority, row.maxPriority, row.categories, row.sources, row.purpose]),
  ]));
  await writeFile(path.join(outDir, "provider-request-manifest.csv"), csv([
    ["batch_id", "provider", "prompt", "category", "source", "priority", "closest_post", "refresh_state", "expected_metric"],
    ...providerRows.map((row) => [row.batchId, row.provider, row.prompt, row.category, row.source, row.priority, row.closestPost, row.refreshState, row.expectedMetric]),
  ]));
  await writeFile(path.join(outDir, "prompt-coverage-by-category.csv"), csv([
    ["category", "prompt_count", "request_count", "current_visibility_gap_prompts", "competitor_prompts", "mapped_pages", "refresh_before_retest_prompts", "top_sources"],
    ...coverageRows.map((row) => [row.category, row.promptCount, row.requestCount, row.currentGaps, row.competitorPrompts, row.mappedPages, row.refreshBeforeRetest, row.topSources]),
  ]));
  await writeFile(path.join(outDir, "prompt-coverage-by-source.csv"), csv([
    ["source", "prompt_count", "request_count", "top_categories"],
    ...sourceRows.map((row) => [row.source, row.promptCount, row.requestCount, row.topCategories]),
  ]));
  await writeFile(path.join(outDir, "post-refresh-retest-map.csv"), csv([
    ["closest_post", "prompt_count", "request_count", "categories", "sources", "refresh_states", "prompts", "products_to_add", "competitors", "schema_fixes"],
    ...postRows.map((row) => [row.closestPost, row.promptCount, row.requestCount, row.categories, row.sources, row.refreshStates, row.prompts, row.productsToAdd, row.competitors, row.schemaFixes]),
  ]));
  const markdown = buildMarkdown({ promptRows, providerRows, batches, coverageRows, sourceRows, postRows, benchmarkDir, expandedDir });
  await writeFile(path.join(outDir, "REPORT.md"), markdown);
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml(markdown));
  console.log(`Wrote ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
