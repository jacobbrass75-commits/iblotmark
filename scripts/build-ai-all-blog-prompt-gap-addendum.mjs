#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "all-blog-prompt-gap-addendum");
const providers = ["chatgpt", "gemini_plain", "claude"];

async function readCsv(relativePath) {
  try {
    return parseCsv(await readFile(path.join(benchmarkDir, relativePath), "utf8"));
  } catch {
    return [];
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted && char === '"' && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(value);
      value = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows.shift();
  return rows
    .filter((cells) => cells.some((cell) => String(cell ?? "").trim()))
    .map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

function csv(rows) {
  return `${rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n")}\n`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toNumber(value) {
  const match = String(value ?? "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function promptKey(prompt) {
  return String(prompt ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function requestKey(row) {
  return `${row.provider || ""}|${promptKey(row.prompt)}`;
}

function promptType(prompt) {
  const text = String(prompt ?? "").toLowerCase();
  if (text.includes(" vs ")) return "comparison";
  if (text.startsWith("is ")) return "product_entity";
  if (text.startsWith("which brands are cited")) return "citation_probe";
  if (text.startsWith("what ibolt")) return "buyer_problem";
  if (text.startsWith("best ")) return "non_branded_best";
  return "buyer_problem";
}

function expectedMetric(type) {
  if (type === "citation_probe") return "target-domain citation or source-url row appears";
  if (type === "product_entity") return "exact iBOLT product/entity is named without hallucinated aliases";
  if (type === "comparison") return "iBOLT moves from absent/trailing to co-mentioned or top-3";
  return "iBOLT appears in answer and earns top-3 or specialist recommendation";
}

function refreshState(type) {
  if (type === "citation_probe") return "source_probe_after_page_cleanup";
  if (type === "product_entity") return "product_entity_retest";
  return "new_prompt_gap_retest";
}

function priorityFor(row, index) {
  const citability = toNumber(String(row.issue_flags || "").match(/citability score\s+(\d+)/i)?.[1]);
  const rankPressure = Math.max(0, 30 - Math.floor(toNumber(row.rank) / 5));
  return Math.min(98, Math.max(82, citability || 84) + Math.min(8, rankPressure) - index);
}

function normalizePromptRow(row, prompt, index) {
  const type = promptType(prompt);
  return {
    prompt,
    category: row.category || "general",
    source: "all_blog_prompt_gap_addendum",
    priority: priorityFor(row, index),
    reason: `Prompt-gap addendum for uncovered live blog page: ${row.title}.`,
    closest_post: row.title,
    page_url: row.url,
    prompt_type: type,
    refresh_state: refreshState(type),
    expected_metric: expectedMetric(type),
  };
}

function dedupeRows(rows, keyFn) {
  const byKey = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing || toNumber(row.priority) > toNumber(existing.priority)) byKey.set(key, row);
  }
  return [...byKey.values()];
}

function buildAddendum(gapRows) {
  const selectedPrompts = [];
  const pagePromptRows = [];
  for (const [pageIndex, row] of gapRows.entries()) {
    const prompts = splitList(row.suggested_prompts);
    const batchId = `G${String(pageIndex + 1).padStart(2, "0")}`;
    for (const [promptIndex, prompt] of prompts.entries()) {
      const promptRow = normalizePromptRow(row, prompt, promptIndex);
      selectedPrompts.push(promptRow);
      pagePromptRows.push({ batch_id: batchId, ...promptRow });
    }
  }
  const providerRows = pagePromptRows.flatMap((row) =>
    providers.map((provider) => ({ batch_id: row.batch_id, provider, ...row })),
  );
  return {
    selectedPrompts: dedupeRows(selectedPrompts, (row) => promptKey(row.prompt)),
    providerRows: dedupeRows(providerRows, requestKey),
  };
}

function selectedCsvRows(rows) {
  return [
    ["prompt", "category", "source", "priority", "reason", "closest_post", "page_url", "prompt_type", "refresh_state", "expected_metric"],
    ...rows.map((row) => [row.prompt, row.category, row.source, row.priority, row.reason, row.closest_post || row.closestPost, row.page_url || row.pageUrl, row.prompt_type || row.promptType, row.refresh_state || row.refreshState, row.expected_metric || row.expectedMetric]),
  ];
}

function providerCsvRows(rows) {
  return [
    ["batch_id", "provider", "prompt", "category", "source", "priority", "closest_post", "page_url", "prompt_type", "refresh_state", "expected_metric"],
    ...rows.map((row) => [row.batch_id || row.batchId, row.provider, row.prompt, row.category, row.source, row.priority, row.reason, row.closest_post || row.closestPost, row.page_url || row.pageUrl, row.prompt_type || row.promptType, row.refresh_state || row.refreshState, row.expected_metric || row.expectedMetric].slice(0, 11)),
  ];
}

function providerRowsForCsv(rows) {
  return [
    ["batch_id", "provider", "prompt", "category", "source", "priority", "closest_post", "page_url", "prompt_type", "refresh_state", "expected_metric"],
    ...rows.map((row) => [row.batch_id || row.batchId, row.provider, row.prompt, row.category, row.source, row.priority, row.closest_post || row.closestPost, row.page_url || row.pageUrl, row.prompt_type || row.promptType, row.refresh_state || row.refreshState, row.expected_metric || row.expectedMetric]),
  ];
}

function renderTable(headers, rows) {
  return `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function renderHtml({ gapRows, selectedPrompts, providerRows, mergedPrompts, mergedProviderRows }) {
  const cards = [
    ["Gap pages closed", gapRows.length, "Previously uncovered live blog pages."],
    ["New prompts", selectedPrompts.length, "Prompt-gap addendum prompts."],
    ["New requests", providerRows.length, "Provider rows across ChatGPT, Gemini, and Claude."],
    ["Full manifest", mergedProviderRows.length, `${mergedPrompts.length} prompts after merge.`],
  ].map(([label, value, note]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");
  const gapTable = gapRows.map((row) => [row.category, row.title, row.url, row.suggested_prompts]);
  const promptTable = selectedPrompts.map((row) => [row.category, row.prompt_type, row.prompt, row.closest_post, row.expected_metric]);
  const command = `AI_BENCHMARK_EXPANDED_MANIFEST=${path.relative(process.cwd(), path.join(outDir, "all-blog-complete-provider-manifest.csv"))} AI_BENCHMARK_EXPANDED_LIMIT=0 npx tsx scripts/run-expanded-openrouter-ai-benchmark.ts`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT All Blog Prompt Gap Addendum</title>
  <style>
    body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1180px;margin:0 auto;padding:34px 24px 64px}
    h1{font-size:36px;margin:0 0 8px}
    h2{font-size:23px;margin:34px 0 12px}
    p,li{line-height:1.55;color:#334155;font-size:15px}
    .note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #0f766e;border-radius:12px;padding:16px 18px;margin:20px 0}
    .cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:22px 0}
    .card{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:16px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:800}
    .value{font-size:30px;font-weight:900;margin:8px 0;color:#0f172a}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 22px}
    th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    code{display:block;white-space:pre-wrap;background:#0f172a;color:#e5e7eb;border-radius:10px;padding:13px;margin-top:8px}
    a{color:#0f766e;overflow-wrap:anywhere}
    @media(max-width:900px){.cards{grid-template-columns:1fr}h1{font-size:30px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT All Blog Prompt Gap Addendum</h1>
  <p>This closes the six live-blog page prompt gaps by adding runnable provider-manifest rows for the next expanded benchmark.</p>
  <div class="note"><strong>Use this after page edits or as a full coverage benchmark:</strong><code>${escapeHtml(command)}</code></div>
  <section class="cards">${cards}</section>
  <h2>Pages Closed</h2>
  ${renderTable(["Category", "Page", "URL", "Added prompts"], gapTable)}
  <h2>New Addendum Prompts</h2>
  ${renderTable(["Category", "Type", "Prompt", "Page", "Expected metric"], promptTable)}
</main>
</body>
</html>`;
}

function renderMarkdown({ gapRows, selectedPrompts, providerRows, mergedPrompts, mergedProviderRows }) {
  const command = `AI_BENCHMARK_EXPANDED_MANIFEST=${path.relative(process.cwd(), path.join(outDir, "all-blog-complete-provider-manifest.csv"))} AI_BENCHMARK_EXPANDED_LIMIT=0 npx tsx scripts/run-expanded-openrouter-ai-benchmark.ts`;
  return `# iBOLT All Blog Prompt Gap Addendum

## Summary

- Gap pages closed: ${gapRows.length}
- New prompts: ${selectedPrompts.length}
- New provider requests: ${providerRows.length}
- Full merged prompts: ${mergedPrompts.length}
- Full merged provider requests: ${mergedProviderRows.length}

## Run Command

\`\`\`bash
${command}
\`\`\`

Set \`OPENROUTER_API_KEY\` securely in the shell before live execution. Add \`AI_BENCHMARK_DRY_RUN=1\` to preview only.

## Gap Pages

${gapRows.map((row) => `- ${row.title}: ${row.suggested_prompts}`).join("\n")}
`;
}

async function main() {
  const coverageRows = await readCsv("all-blog-test-coverage-report/all-blog-test-coverage-ledger.csv");
  const existingSelected = await readCsv("page-derived-expanded-benchmark-pack/selected-prompts.csv");
  const existingProvider = await readCsv("page-derived-expanded-benchmark-pack/provider-request-manifest.csv");
  const gapRows = coverageRows.filter((row) => row.coverage_state === "prompt_gap");
  const { selectedPrompts, providerRows } = buildAddendum(gapRows);
  const mergedPrompts = dedupeRows([...existingSelected, ...selectedPrompts], (row) => promptKey(row.prompt));
  const mergedProviderRows = dedupeRows([...existingProvider, ...providerRows], requestKey);

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "prompt-gap-selected-prompts.csv"), csv(selectedCsvRows(selectedPrompts)));
  await writeFile(path.join(outDir, "prompt-gap-provider-manifest.csv"), csv(providerRowsForCsv(providerRows)));
  await writeFile(path.join(outDir, "all-blog-complete-selected-prompts.csv"), csv(selectedCsvRows(mergedPrompts)));
  await writeFile(path.join(outDir, "all-blog-complete-provider-manifest.csv"), csv(providerRowsForCsv(mergedProviderRows)));
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml({ gapRows, selectedPrompts, providerRows, mergedPrompts, mergedProviderRows }));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown({ gapRows, selectedPrompts, providerRows, mergedPrompts, mergedProviderRows }));

  console.log(`Wrote ${outDir}`);
  console.log(`Gap pages closed: ${gapRows.length}`);
  console.log(`New prompts: ${selectedPrompts.length}`);
  console.log(`New provider requests: ${providerRows.length}`);
  console.log(`Merged provider requests: ${mergedProviderRows.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
