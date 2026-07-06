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
  if (!name) throw new Error(`No ${prefix} directory found in ${OUTPUT_ROOT}`);
  return path.join(process.cwd(), OUTPUT_ROOT, name);
}

function num(value) {
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function avg(values) {
  const clean = values.map(num).filter(Number.isFinite);
  return clean.length ? Math.round(clean.reduce((sum, value) => sum + value, 0) / clean.length) : 0;
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

function key(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function exactKey(value) {
  return String(value ?? "").toLowerCase().trim();
}

function addToCounter(map, name, count = 1) {
  if (!name) return;
  map.set(name, (map.get(name) || 0) + count);
}

function counterToText(map, limit = 6) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => `${name} ${count}`)
    .join("; ");
}

function stateLabel(state, noMapped) {
  if (noMapped) return "new content or solution page needed";
  if (state.includes("canonical_review_before_retest")) return "canonical review before retest";
  if (state.includes("refresh_then_retest")) return "refresh then retest";
  if (state.includes("mapped_page_not_in_top_refresh_queue")) return "mapped lower-priority retest";
  return state || "unclassified";
}

function barSvg(rows, { title, labelKey, valueKey, width = 900, height = 390, color = "#1d4ed8" }) {
  const chartRows = rows.slice(0, 14);
  const max = Math.max(1, ...chartRows.map((row) => num(row[valueKey])));
  const left = 190;
  const right = 48;
  const top = 58;
  const rowHeight = 24;
  const gap = 9;
  const innerWidth = width - left - right;
  const svgHeight = Math.max(height, top + chartRows.length * (rowHeight + gap) + 32);
  const bars = chartRows.map((row, index) => {
    const y = top + index * (rowHeight + gap);
    const barWidth = Math.round((num(row[valueKey]) / max) * innerWidth);
    return `<text x="16" y="${y + 17}" font-size="13" fill="#334155">${escapeHtml(row[labelKey])}</text>
<rect x="${left}" y="${y}" width="${barWidth}" height="${rowHeight}" fill="${color}" rx="4"/>
<text x="${left + barWidth + 8}" y="${y + 17}" font-size="13" fill="#111827" font-weight="700">${escapeHtml(row[valueKey])}</text>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${svgHeight}" viewBox="0 0 ${width} ${svgHeight}" role="img" aria-label="${escapeHtml(title)}">
<rect width="100%" height="100%" fill="#ffffff"/>
<text x="16" y="31" font-size="20" font-weight="800" fill="#0f172a">${escapeHtml(title)}</text>
${bars}
</svg>`;
}

function buildPromptLedger({ prompts, manifestRows, noMappedRows, gapRows, queryRows, backlogRows }) {
  const manifestByPrompt = new Map();
  for (const row of manifestRows) {
    const promptKey = exactKey(row.prompt);
    if (!manifestByPrompt.has(promptKey)) manifestByPrompt.set(promptKey, []);
    manifestByPrompt.get(promptKey).push(row);
  }
  const noMappedKeys = new Set(noMappedRows.map((row) => exactKey(row.prompt)));
  const gapByPrompt = new Map();
  for (const row of gapRows) {
    for (const prompt of splitList(row.prompts)) {
      gapByPrompt.set(exactKey(prompt), row);
    }
  }
  const queryByPrompt = new Map(queryRows.map((row) => [exactKey(row.query || row.prompt), row]));
  const backlogByPrompt = new Map();
  for (const row of backlogRows) {
    for (const prompt of splitList(row.prompts || row.item)) {
      const promptKey = exactKey(prompt);
      if (!backlogByPrompt.has(promptKey)) backlogByPrompt.set(promptKey, []);
      backlogByPrompt.get(promptKey).push(row);
    }
  }

  return prompts.map((prompt) => {
    const promptKey = exactKey(prompt.prompt);
    const requests = manifestByPrompt.get(promptKey) || [];
    const refreshStates = unique(requests.map((row) => row.refresh_state));
    const providers = unique(requests.map((row) => row.provider));
    const noMapped = noMappedKeys.has(promptKey);
    const gap = gapByPrompt.get(promptKey) || {};
    const query = queryByPrompt.get(promptKey) || {};
    const backlog = backlogByPrompt.get(promptKey) || [];
    const testState = stateLabel(refreshStates.join("; "), noMapped);
    const mappedPage = prompt.closest_post || query.page_title || backlog.find((row) => row.target_url)?.item || "";
    const recommendedAction =
      gap.action ||
      query.recommended_action ||
      backlog[0]?.next_action ||
      (testState === "mapped lower-priority retest" ? "Run after Sprint 1 and Sprint 2 page fixes to measure long-tail recall." : "Refresh mapped page before retest.");
    return {
      priority: num(prompt.priority),
      prompt: prompt.prompt,
      category: prompt.category,
      source: prompt.source,
      reason: prompt.reason,
      provider_request_count: requests.length,
      providers: providers.join("; "),
      batch_id: unique(requests.map((row) => row.batch_id)).join("; "),
      test_state: testState,
      mapped_page: mappedPage,
      no_mapped_prompt: noMapped ? "yes" : "no",
      content_gap_title: gap.title || "",
      content_gap_action: gap.action || "",
      competitor_context: query.competitors || gap.competitors || "",
      mention_rate_baseline: query.mention_rate || "",
      competitor_only_answers: query.competitor_only_answers || "",
      backlog_items: backlog.length,
      recommended_action: recommendedAction,
    };
  }).sort((a, b) => b.priority - a.priority || a.prompt.localeCompare(b.prompt));
}

function summarize(ledger, batchRows, keyAvailable) {
  const categoryRows = [...new Set(ledger.map((row) => row.category || "uncategorized"))].map((category) => {
    const rows = ledger.filter((row) => (row.category || "uncategorized") === category);
    const sources = new Map();
    const states = new Map();
    for (const row of rows) {
      addToCounter(sources, row.source);
      addToCounter(states, row.test_state);
    }
    return {
      category,
      prompts: rows.length,
      requests: rows.reduce((sum, row) => sum + num(row.provider_request_count), 0),
      avg_priority: avg(rows.map((row) => row.priority)),
      no_mapped_prompts: rows.filter((row) => row.no_mapped_prompt === "yes").length,
      refresh_then_retest: rows.filter((row) => row.test_state === "refresh then retest").length,
      canonical_review: rows.filter((row) => row.test_state === "canonical review before retest").length,
      mapped_lower_priority: rows.filter((row) => row.test_state === "mapped lower-priority retest").length,
      top_sources: counterToText(sources),
      state_mix: counterToText(states),
    };
  }).sort((a, b) => b.prompts - a.prompts || a.category.localeCompare(b.category));

  const stateRows = [...new Set(ledger.map((row) => row.test_state))].map((state) => {
    const rows = ledger.filter((row) => row.test_state === state);
    return {
      test_state: state,
      prompts: rows.length,
      requests: rows.reduce((sum, row) => sum + num(row.provider_request_count), 0),
      avg_priority: avg(rows.map((row) => row.priority)),
      categories: counterToText(rows.reduce((map, row) => (addToCounter(map, row.category), map), new Map())),
    };
  }).sort((a, b) => b.prompts - a.prompts || a.test_state.localeCompare(b.test_state));

  const sourceRows = [...new Set(ledger.map((row) => row.source || "unknown"))].map((source) => {
    const rows = ledger.filter((row) => (row.source || "unknown") === source);
    return {
      source,
      prompts: rows.length,
      requests: rows.reduce((sum, row) => sum + num(row.provider_request_count), 0),
      top_categories: counterToText(rows.reduce((map, row) => (addToCounter(map, row.category), map), new Map())),
    };
  }).sort((a, b) => b.prompts - a.prompts || a.source.localeCompare(b.source));

  return {
    generatedAt: new Date().toISOString(),
    promptCount: ledger.length,
    providerRequestCount: ledger.reduce((sum, row) => sum + num(row.provider_request_count), 0),
    providerCount: unique(ledger.flatMap((row) => splitList(row.providers))).length,
    batchCount: batchRows.length,
    keyAvailable,
    categoryRows,
    stateRows,
    sourceRows,
    noMappedPrompts: ledger.filter((row) => row.no_mapped_prompt === "yes").length,
    refreshThenRetestPrompts: ledger.filter((row) => row.test_state === "refresh then retest").length,
    canonicalReviewPrompts: ledger.filter((row) => row.test_state === "canonical review before retest").length,
    mappedLowerPriorityPrompts: ledger.filter((row) => row.test_state === "mapped lower-priority retest").length,
    topCategories: categoryRows.slice(0, 6).map((row) => row.category),
  };
}

function buildMarkdown({ summary, ledger, batchRows }) {
  return `# Expanded AI Benchmark Coverage Map

## Status

The expanded benchmark is ready as a dry run, but not live-executed. It contains ${summary.promptCount} prompts and ${summary.providerRequestCount} one-at-a-time provider requests across ${summary.providerCount} providers. OPENROUTER_API_KEY is ${summary.keyAvailable ? "available in this shell" : "not set in this shell"}.

## Coverage

- Categories covered: ${summary.categoryRows.length}.
- Run batches: ${summary.batchCount}.
- Refresh then retest prompts: ${summary.refreshThenRetestPrompts}.
- Canonical review before retest prompts: ${summary.canonicalReviewPrompts}.
- New content or solution page prompts: ${summary.noMappedPrompts}.
- Lower-priority mapped retest prompts: ${summary.mappedLowerPriorityPrompts}.

## Category Coverage

| Category | Prompts | Requests | Avg priority | No mapped | Refresh | Canonical | Lower-priority | State mix |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
${summary.categoryRows.map((row) => `| ${row.category} | ${row.prompts} | ${row.requests} | ${row.avg_priority} | ${row.no_mapped_prompts} | ${row.refresh_then_retest} | ${row.canonical_review} | ${row.mapped_lower_priority} | ${row.state_mix} |`).join("\n")}

## First 25 Prompts To Watch

| Priority | Prompt | Category | State | Mapped page | Competitors | Action |
| ---: | --- | --- | --- | --- | --- | --- |
${ledger.slice(0, 25).map((row) => `| ${row.priority} | ${row.prompt} | ${row.category} | ${row.test_state} | ${row.mapped_page} | ${row.competitor_context} | ${row.recommended_action} |`).join("\n")}

## Run Batches

| Batch | Prompts | Requests | Categories | Purpose |
| --- | ---: | ---: | --- | --- |
${batchRows.map((row) => `| ${row.batch_id} | ${row.prompt_count} | ${row.request_count} | ${row.categories} | ${row.purpose} |`).join("\n")}
`;
}

function buildHtml({ summary, ledger, categorySvg, stateSvg, sourceSvg }) {
  const cards = [
    ["Prompts", summary.promptCount, "Expanded dry-run prompt count"],
    ["Provider requests", summary.providerRequestCount, "One-at-a-time requests"],
    ["Providers", summary.providerCount, "ChatGPT, Gemini, Claude"],
    ["Batches", summary.batchCount, "Run groups"],
    ["Refresh prompts", summary.refreshThenRetestPrompts, "Mapped page work first"],
    ["Canonical prompts", summary.canonicalReviewPrompts, "Survivor decision first"],
    ["No mapped page", summary.noMappedPrompts, "Content/solution gaps"],
    ["Lower-priority mapped", summary.mappedLowerPriorityPrompts, "Long-tail retests"],
    ["API key", summary.keyAvailable ? "set" : "missing", "Live run gate"],
  ].map(([label, value, note]) => `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");
  const rows = ledger.slice(0, 40).map((row) => `<tr>
<td>${escapeHtml(row.priority)}</td><td>${escapeHtml(row.prompt)}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.source)}</td><td>${escapeHtml(row.test_state)}</td><td>${escapeHtml(row.batch_id)}</td><td>${escapeHtml(row.mapped_page)}</td><td>${escapeHtml(row.competitor_context)}</td><td>${escapeHtml(row.recommended_action)}</td>
</tr>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Expanded AI Benchmark Coverage Map</title>
<style>
body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}main{max-width:1240px;margin:0 auto;padding:34px 26px 60px}h1{font-size:34px;margin:0 0 8px}h2{font-size:22px;margin:34px 0 14px}p{color:#334155;line-height:1.55}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}.k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700}.v{font-size:30px;font-weight:800;margin-top:8px}.chart{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:12px;margin:14px 0;overflow:auto}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden}th,td{text-align:left;vertical-align:top;padding:9px 10px;border-bottom:1px solid #edf2f7;font-size:13px}th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}.note{border-left:6px solid ${summary.keyAvailable ? "#16a34a" : "#f97316"};background:#fff;border-radius:10px;padding:16px 18px;border-top:1px solid #d7dee8;border-right:1px solid #d7dee8;border-bottom:1px solid #d7dee8}
</style></head><body><main>
<h1>Expanded AI Benchmark Coverage Map</h1>
<p class="note"><strong>Status:</strong> This is a complete dry-run coverage map. The live run still needs <code>OPENROUTER_API_KEY</code> set in the shell.</p>
<section class="cards">${cards}</section>
<h2>Prompts By Category</h2><div class="chart">${categorySvg}</div>
<h2>Readiness State</h2><div class="chart">${stateSvg}</div>
<h2>Prompt Source Mix</h2><div class="chart">${sourceSvg}</div>
<h2>Top Prompt Ledger</h2>
<table><thead><tr><th>Priority</th><th>Prompt</th><th>Category</th><th>Source</th><th>State</th><th>Batch</th><th>Mapped page</th><th>Competitors</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table>
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const expandedDir = await latestDir(EXPANDED_PREFIX);
  const outDir = path.join(benchmarkDir, "expanded-test-coverage-map");
  await mkdir(outDir, { recursive: true });

  const prompts = await readCsv(path.join(expandedDir, "selected-prompts.csv"));
  const manifestRows = await readCsv(path.join(benchmarkDir, "expanded-benchmark-ops", "provider-request-manifest.csv"));
  const batchRows = await readCsv(path.join(benchmarkDir, "expanded-benchmark-ops", "benchmark-run-batches.csv"));
  const noMappedRows = await readCsv(path.join(benchmarkDir, "content-gap-briefs", "no-mapped-prompts.csv"));
  const gapRows = await readCsv(path.join(benchmarkDir, "content-gap-briefs", "content-gap-briefs.csv"));
  const queryRows = await readCsv(path.join(benchmarkDir, "competitor-displacement-map", "query-displacement-actions.csv"));
  const backlogRows = await readCsv(path.join(benchmarkDir, "visibility-execution-backlog", "integrated-execution-backlog.csv"));
  const ledger = buildPromptLedger({ prompts, manifestRows, noMappedRows, gapRows, queryRows, backlogRows });
  const summary = summarize(ledger, batchRows, Boolean(process.env.OPENROUTER_API_KEY));

  const categorySvg = barSvg(summary.categoryRows, { title: "Expanded prompts by category", labelKey: "category", valueKey: "prompts", color: "#1d4ed8" });
  const stateSvg = barSvg(summary.stateRows, { title: "Expanded prompts by readiness state", labelKey: "test_state", valueKey: "prompts", color: "#0f766e" });
  const sourceSvg = barSvg(summary.sourceRows, { title: "Expanded prompts by source", labelKey: "source", valueKey: "prompts", color: "#7c3aed" });

  await writeFile(path.join(outDir, "expanded-prompts-by-category.svg"), categorySvg);
  await writeFile(path.join(outDir, "expanded-prompts-by-state.svg"), stateSvg);
  await writeFile(path.join(outDir, "expanded-prompts-by-source.svg"), sourceSvg);
  await writeFile(path.join(outDir, "expanded-test-coverage-data.json"), JSON.stringify({ summary, ledger, batchRows }, null, 2));
  await writeFile(path.join(outDir, "expanded-prompt-coverage-ledger.csv"), csv([
    ["priority", "prompt", "category", "source", "reason", "provider_request_count", "providers", "batch_id", "test_state", "mapped_page", "no_mapped_prompt", "content_gap_title", "content_gap_action", "competitor_context", "mention_rate_baseline", "competitor_only_answers", "backlog_items", "recommended_action"],
    ...ledger.map((row) => [row.priority, row.prompt, row.category, row.source, row.reason, row.provider_request_count, row.providers, row.batch_id, row.test_state, row.mapped_page, row.no_mapped_prompt, row.content_gap_title, row.content_gap_action, row.competitor_context, row.mention_rate_baseline, row.competitor_only_answers, row.backlog_items, row.recommended_action]),
  ]));
  await writeFile(path.join(outDir, "expanded-category-coverage.csv"), csv([
    ["category", "prompts", "requests", "avg_priority", "no_mapped_prompts", "refresh_then_retest", "canonical_review", "mapped_lower_priority", "top_sources", "state_mix"],
    ...summary.categoryRows.map((row) => [row.category, row.prompts, row.requests, row.avg_priority, row.no_mapped_prompts, row.refresh_then_retest, row.canonical_review, row.mapped_lower_priority, row.top_sources, row.state_mix]),
  ]));
  await writeFile(path.join(outDir, "expanded-readiness-summary.csv"), csv([
    ["test_state", "prompts", "requests", "avg_priority", "categories"],
    ...summary.stateRows.map((row) => [row.test_state, row.prompts, row.requests, row.avg_priority, row.categories]),
  ]));
  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown({ summary, ledger, batchRows }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({ summary, ledger, categorySvg, stateSvg, sourceSvg }));

  console.log(`Wrote ${outDir}`);
  console.log(`Prompts: ${summary.promptCount}`);
  console.log(`Requests: ${summary.providerRequestCount}`);
  console.log(`Key available: ${summary.keyAvailable ? "yes" : "no"}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
