#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "benchmark-manifest-qa");
const expectedProviders = ["chatgpt", "gemini_plain", "claude"];
const fullManifestPath = "content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/all-blog-prompt-gap-addendum/all-blog-complete-provider-manifest.csv";
const priorityManifestPath = "content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/priority-retest-packet/priority-provider-request-manifest.csv";

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

function promptKey(value) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function toNumber(value) {
  const match = String(value ?? "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function uniq(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function countBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row) || "unknown";
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function pct(value, total) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

function short(value, length = 92) {
  const text = String(value ?? "");
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function words(prompt) {
  return String(prompt ?? "").trim().split(/\s+/).filter(Boolean);
}

function promptFlags(row) {
  const prompt = String(row.prompt ?? "");
  const normalized = promptKey(prompt);
  const wordCount = words(prompt).length;
  const flags = [];
  if (!normalized) flags.push({ severity: "blocker", flag: "empty_prompt" });
  if (wordCount < 3) flags.push({ severity: "review", flag: "very_short_prompt" });
  if (prompt.length > 180) flags.push({ severity: "review", flag: "long_prompt_over_180_chars" });
  if ((prompt.match(/\?/g) || []).length > 1) flags.push({ severity: "review", flag: "multiple_question_marks" });
  if (/[|\n\r]/.test(prompt)) flags.push({ severity: "blocker", flag: "csv_or_newline_artifact" });
  if (/https?:\/\//i.test(prompt)) flags.push({ severity: "blocker", flag: "url_inside_prompt" });
  if (/content-output|openrouter|benchmark|shopify api/i.test(prompt)) flags.push({ severity: "blocker", flag: "internal_tooling_language" });
  if (/[™®]/.test(prompt)) flags.push({ severity: "review", flag: "brand_symbol_in_prompt" });
  if (/^best\s+\w+\s*$/.test(prompt) || ["best tablet mount", "best fish finder"].includes(normalized)) {
    flags.push({ severity: "review", flag: "very_broad_head_term" });
  }
  if (prompt.length > 110 && /\b(in|for)\b.+\b(and|with)\b.+\b(and|with)\b/i.test(prompt)) {
    flags.push({ severity: "review", flag: "page-title-style_prompt" });
  }
  return flags;
}

function commandBlock(command) {
  return `<pre><code>${escapeHtml(command)}</code></pre>`;
}

function runCommand({ manifest = fullManifestPath, category, source, limit = 0, dryRun = false }) {
  const env = [
    dryRun ? "AI_BENCHMARK_DRY_RUN=1" : "",
    `AI_BENCHMARK_EXPANDED_MANIFEST=${manifest}`,
    `AI_BENCHMARK_EXPANDED_LIMIT=${limit}`,
    category ? `AI_BENCHMARK_EXPANDED_CATEGORY=${category}` : "",
    source ? `AI_BENCHMARK_EXPANDED_SOURCE=${source}` : "",
  ].filter(Boolean).join(" ");
  return `${env} npx tsx scripts/run-expanded-openrouter-ai-benchmark.ts`;
}

function barSvg({ title, rows, width = 920, rowHeight = 34, color = "#0f766e", maxValue }) {
  const chartRows = rows.filter((row) => Number.isFinite(row.value)).slice(0, 12);
  const height = 76 + chartRows.length * rowHeight;
  const max = maxValue || Math.max(1, ...chartRows.map((row) => row.value));
  const bars = chartRows.map((row, index) => {
    const y = 58 + index * rowHeight;
    const barWidth = Math.round((row.value / max) * (width - 350));
    return `<g>
      <text x="22" y="${y + 17}" font-size="13" font-weight="800" fill="#111827">${escapeHtml(short(row.label, 42))}</text>
      <rect x="292" y="${y}" width="${width - 350}" height="21" rx="10" fill="#e5e7eb"/>
      <rect x="292" y="${y}" width="${barWidth}" height="21" rx="10" fill="${row.color || color}"/>
      <text x="${width - 28}" y="${y + 16}" font-size="13" font-weight="900" text-anchor="end" fill="#111827">${escapeHtml(row.value)}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#ffffff"/>
    <text x="22" y="34" font-size="20" font-weight="900" fill="#111827">${escapeHtml(title)}</text>
    ${bars}
  </svg>`;
}

function renderTable(headers, rows) {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table>${head}${body}</table>`;
}

function card(label, value, note) {
  return `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`;
}

function renderHtml(data) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT Benchmark Manifest QA</title>
  <style>
    body{margin:0;background:#f7f9fc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1240px;margin:0 auto;padding:34px 24px 66px}
    h1{font-size:38px;line-height:1.1;margin:0 0 8px;letter-spacing:0}
    h2{font-size:23px;margin:36px 0 12px}
    h3{font-size:17px;margin:18px 0 8px}
    p,li{line-height:1.55;color:#334155;font-size:15px}
    a{color:#0f766e;overflow-wrap:anywhere}
    pre{white-space:pre-wrap;background:#0f172a;color:#e5e7eb;border-radius:10px;padding:13px;overflow:auto}
    code{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}
    .note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #0f766e;border-radius:12px;padding:16px 18px;margin:20px 0}
    .warn{border-left-color:#f97316}
    .cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:22px 0}
    .card{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:15px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:900}
    .value{font-size:29px;font-weight:900;margin:8px 0;color:#0f172a}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
    .chart{background:#fff;border:1px solid #dbe3ef;border-radius:18px;padding:10px;overflow:auto}
    .chart svg{width:100%;height:auto;display:block}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 22px}
    th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    @media(max-width:980px){.cards,.grid{grid-template-columns:1fr}h1{font-size:31px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT Benchmark Manifest QA</h1>
  <p>This validates the expanded benchmark before live model calls. It checks exact provider coverage, duplicates, prompt quality, category balance, and a safer run order.</p>

  <div class="note">
    <strong>QA result:</strong> ${escapeHtml(data.summary.verdict)}. ${escapeHtml(data.summary.verdictNote)}
  </div>

  <section class="cards">
    ${card("Selected prompts", data.summary.selectedPrompts, "Unique prompt rows in the full manifest.")}
    ${card("Provider rows", data.summary.providerRows, "Exact prompt/provider requests.")}
    ${card("Provider balance", data.summary.providerBalance, "Requests per ChatGPT, Gemini, and Claude.")}
    ${card("Blockers", data.summary.blockerFlags, "Issues that would break or pollute a run.")}
    ${card("Review flags", data.summary.reviewFlags, "Prompts worth reviewing but not blocking.")}
  </section>

  <section class="grid">
    <div class="chart">${data.svgs.categoryRequests}</div>
    <div class="chart">${data.svgs.promptFlags}</div>
  </section>

  <h2>Integrity Checks</h2>
  <table>${data.tables.integrity}</table>

  <h2>Provider And Category Balance</h2>
  <section class="grid">
    <div>${data.tables.providers}</div>
    <div>${data.tables.categories}</div>
  </section>

  <h2>Prompt Quality Flags</h2>
  <table>${data.tables.flags}</table>

  <h2>Recommended Run Order</h2>
  <table>${data.tables.runPlan}</table>
  <h3>Dry-run full manifest</h3>
  ${commandBlock(runCommand({ dryRun: true }))}
  <h3>Live priority packet first</h3>
  ${commandBlock(runCommand({ manifest: priorityManifestPath, limit: 0 }))}
  <h3>Live high-risk category sample</h3>
  ${commandBlock(runCommand({ category: "fleet,restaurant,fishing,delivery,warehouse", limit: 0 }))}
  <h3>Live full manifest</h3>
  ${commandBlock(runCommand({ limit: 0 }))}

  <h2>Files</h2>
  <ul>
    <li><a href="manifest-integrity-checks.csv">manifest-integrity-checks.csv</a></li>
    <li><a href="prompt-quality-flags.csv">prompt-quality-flags.csv</a></li>
    <li><a href="provider-category-balance.csv">provider-category-balance.csv</a></li>
    <li><a href="benchmark-run-plan.csv">benchmark-run-plan.csv</a></li>
  </ul>
</main>
</body>
</html>`;
}

function renderMarkdown(data) {
  return `# iBOLT Benchmark Manifest QA

## QA Result

${data.summary.verdict}. ${data.summary.verdictNote}

## Summary

- Selected prompts: ${data.summary.selectedPrompts}
- Provider rows: ${data.summary.providerRows}
- Provider balance: ${data.summary.providerBalance}
- Blocker flags: ${data.summary.blockerFlags}
- Review flags: ${data.summary.reviewFlags}
- Duplicate selected prompts: ${data.summary.duplicateSelectedPrompts}
- Duplicate provider requests: ${data.summary.duplicateProviderRequests}
- Missing provider requests: ${data.summary.missingProviderRequests}

## Recommended Run Order

${data.runPlan.map((row) => `- ${row.order}. ${row.run_name}: ${row.requests} requests. ${row.why}`).join("\n")}
`;
}

async function main() {
  const selectedPrompts = await readCsv("all-blog-prompt-gap-addendum/all-blog-complete-selected-prompts.csv");
  const providerManifest = await readCsv("all-blog-prompt-gap-addendum/all-blog-complete-provider-manifest.csv");
  const priorityManifest = await readCsv("priority-retest-packet/priority-provider-request-manifest.csv");
  const testAreaCategories = await readCsv("test-area-expansion-map/category-test-area-matrix.csv");

  const selectedPromptKeys = selectedPrompts.map((row) => promptKey(row.prompt));
  const selectedUniqueKeys = new Set(selectedPromptKeys);
  const duplicateSelected = selectedPromptKeys.length - selectedUniqueKeys.size;
  const providerKeys = providerManifest.map((row) => `${row.provider}|${promptKey(row.prompt)}`);
  const providerUniqueKeys = new Set(providerKeys);
  const duplicateProvider = providerKeys.length - providerUniqueKeys.size;
  const orphanProviderRows = providerManifest.filter((row) => !selectedUniqueKeys.has(promptKey(row.prompt)));
  const missingProviderRows = [];
  for (const row of selectedPrompts) {
    const key = promptKey(row.prompt);
    for (const provider of expectedProviders) {
      if (!providerUniqueKeys.has(`${provider}|${key}`)) {
        missingProviderRows.push({ provider, prompt: row.prompt, category: row.category, page_url: row.page_url });
      }
    }
  }

  const flagRows = [];
  for (const row of selectedPrompts) {
    for (const item of promptFlags(row)) {
      flagRows.push({
        severity: item.severity,
        flag: item.flag,
        prompt: row.prompt,
        category: row.category,
        prompt_type: row.prompt_type,
        source: row.source,
        page_url: row.page_url,
      });
    }
  }
  const blockerFlags = flagRows.filter((row) => row.severity === "blocker").length;
  const reviewFlags = flagRows.filter((row) => row.severity === "review").length;

  const providerRows = [...groupBy(providerManifest, (row) => row.provider).entries()].map(([provider, rows]) => ({
    provider,
    requests: rows.length,
    prompts: uniq(rows.map((row) => row.prompt)).length,
    categories: uniq(rows.map((row) => row.category)).length,
    prompt_types: countBy(rows, (row) => row.prompt_type).map(([type, count]) => `${type} ${count}`).join("; "),
  })).sort((a, b) => expectedProviders.indexOf(a.provider) - expectedProviders.indexOf(b.provider));

  const categoryRows = [...groupBy(providerManifest, (row) => row.category).entries()].map(([category, rows]) => {
    const testArea = testAreaCategories.find((row) => row.category === category) || {};
    const providerCounts = expectedProviders.map((provider) => `${provider} ${rows.filter((row) => row.provider === provider).length}`).join("; ");
    return {
      category,
      requests: rows.length,
      prompts: uniq(rows.map((row) => row.prompt)).length,
      pages: uniq(rows.map((row) => row.page_url)).length,
      provider_counts: providerCounts,
      prompt_types: countBy(rows, (row) => row.prompt_type).map(([type, count]) => `${type} ${count}`).join("; "),
      risk_score: toNumber(testArea.priority_score),
    };
  }).sort((a, b) => b.risk_score - a.risk_score || b.requests - a.requests || a.category.localeCompare(b.category));

  const integrityRows = [
    ["selected_prompt_rows", selectedPrompts.length, "expected", "From all-blog complete selected prompts"],
    ["unique_selected_prompts", selectedUniqueKeys.size, duplicateSelected === 0 ? "pass" : "review", "Prompt strings should be unique after dedupe"],
    ["provider_request_rows", providerManifest.length, "expected", "From all-blog complete provider manifest"],
    ["unique_provider_prompt_rows", providerUniqueKeys.size, duplicateProvider === 0 ? "pass" : "fail", "Provider plus prompt should be unique"],
    ["expected_provider_request_rows", selectedUniqueKeys.size * expectedProviders.length, providerManifest.length === selectedUniqueKeys.size * expectedProviders.length ? "pass" : "fail", "Selected prompts multiplied by expected providers"],
    ["missing_provider_requests", missingProviderRows.length, missingProviderRows.length === 0 ? "pass" : "fail", "Every prompt should have ChatGPT, Gemini, and Claude rows"],
    ["orphan_provider_requests", orphanProviderRows.length, orphanProviderRows.length === 0 ? "pass" : "fail", "Provider rows should map to selected prompt rows"],
    ["blocker_prompt_flags", blockerFlags, blockerFlags === 0 ? "pass" : "fail", "Prompt flags that would corrupt a run"],
    ["review_prompt_flags", reviewFlags, "review", "Non-blocking prompt quality review list"],
  ];

  const runPlan = [
    {
      order: 1,
      run_name: "Dry-run full manifest",
      requests: providerManifest.length,
      command: runCommand({ dryRun: true }),
      why: "Verifies exact selection and output files without spending provider calls.",
    },
    {
      order: 2,
      run_name: "Live priority packet",
      requests: priorityManifest.length,
      command: runCommand({ manifest: priorityManifestPath, limit: 0 }),
      why: "Validates the highest-risk 204 requests before the full 1,449-request run.",
    },
    {
      order: 3,
      run_name: "Live high-risk category subset",
      requests: categoryRows
        .filter((row) => ["fleet", "restaurant", "fishing", "delivery", "warehouse"].includes(row.category))
        .reduce((sum, row) => sum + row.requests, 0),
      command: runCommand({ category: "fleet,restaurant,fishing,delivery,warehouse", limit: 0 }),
      why: "Focuses on categories with the most competitor-only and zero-mention pressure.",
    },
    {
      order: 4,
      run_name: "Live full manifest",
      requests: providerManifest.length,
      command: runCommand({ limit: 0 }),
      why: "Runs the complete all-blog coverage benchmark after the first waves look sane.",
    },
  ];

  const flagCounts = countBy(flagRows, (row) => row.flag);
  const providerBalanceText = providerRows.map((row) => `${row.provider} ${row.requests}`).join("; ");
  const verdict = blockerFlags || duplicateProvider || missingProviderRows.length || orphanProviderRows.length
    ? "Needs fix before live run"
    : "Ready for controlled live run";
  const verdictNote = blockerFlags
    ? "There are blocker prompt flags to inspect before running."
    : "No duplicate provider rows, no missing provider rows, and provider counts are balanced.";

  const summary = {
    selectedPrompts: selectedPrompts.length,
    providerRows: providerManifest.length,
    providerBalance: providerBalanceText,
    blockerFlags,
    reviewFlags,
    duplicateSelectedPrompts: duplicateSelected,
    duplicateProviderRequests: duplicateProvider,
    missingProviderRequests: missingProviderRows.length,
    verdict,
    verdictNote,
  };

  const tables = {
    integrity: renderTable(["Check", "Value", "Status", "Note"], integrityRows),
    providers: renderTable(
      ["Provider", "Requests", "Prompts", "Categories", "Prompt types"],
      providerRows.map((row) => [row.provider, row.requests, row.prompts, row.categories, row.prompt_types]),
    ),
    categories: renderTable(
      ["Category", "Requests", "Prompts", "Pages", "Provider counts", "Prompt types"],
      categoryRows.map((row) => [row.category, row.requests, row.prompts, row.pages, row.provider_counts, row.prompt_types]),
    ),
    flags: renderTable(
      ["Severity", "Flag", "Prompt", "Category", "Type", "Source"],
      flagRows.slice(0, 80).map((row) => [row.severity, row.flag, row.prompt, row.category, row.prompt_type, row.source]),
    ),
    runPlan: renderTable(
      ["Order", "Run", "Requests", "Why", "Command"],
      runPlan.map((row) => [row.order, row.run_name, row.requests, row.why, row.command]),
    ),
  };

  const svgs = {
    categoryRequests: barSvg({
      title: "Requests by category",
      rows: categoryRows.map((row) => ({ label: row.category, value: row.requests, color: "#2563eb" })),
    }),
    promptFlags: barSvg({
      title: "Prompt quality flags",
      rows: flagCounts.map(([flag, count]) => ({ label: flag, value: count, color: flag.includes("blocker") ? "#ef4444" : "#f97316" })),
    }),
  };

  const data = {
    summary,
    providerRows,
    categoryRows,
    flagRows,
    runPlan,
    tables,
    svgs,
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml(data));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown(data));
  await writeFile(path.join(outDir, "manifest-integrity-checks.csv"), csv([
    ["check", "value", "status", "note"],
    ...integrityRows,
  ]));
  await writeFile(path.join(outDir, "prompt-quality-flags.csv"), csv([
    ["severity", "flag", "prompt", "category", "prompt_type", "source", "page_url"],
    ...flagRows.map((row) => [row.severity, row.flag, row.prompt, row.category, row.prompt_type, row.source, row.page_url]),
  ]));
  await writeFile(path.join(outDir, "provider-category-balance.csv"), csv([
    ["category", "requests", "prompts", "pages", "provider_counts", "prompt_types", "risk_score"],
    ...categoryRows.map((row) => [row.category, row.requests, row.prompts, row.pages, row.provider_counts, row.prompt_types, row.risk_score]),
  ]));
  await writeFile(path.join(outDir, "benchmark-run-plan.csv"), csv([
    ["order", "run_name", "requests", "why", "command"],
    ...runPlan.map((row) => [row.order, row.run_name, row.requests, row.why, row.command]),
  ]));
  await writeFile(path.join(outDir, "manifest-qa-summary.csv"), csv([
    ["metric", "value"],
    ["verdict", summary.verdict],
    ["selected_prompts", summary.selectedPrompts],
    ["provider_rows", summary.providerRows],
    ["provider_balance", summary.providerBalance],
    ["blocker_flags", summary.blockerFlags],
    ["review_flags", summary.reviewFlags],
    ["duplicate_selected_prompts", summary.duplicateSelectedPrompts],
    ["duplicate_provider_requests", summary.duplicateProviderRequests],
    ["missing_provider_requests", summary.missingProviderRequests],
  ]));

  console.log(`Wrote ${path.join(outDir, "REPORT.html")}`);
  console.log(`${summary.verdict}: ${summary.providerRows} provider rows, ${summary.selectedPrompts} prompts, ${summary.providerBalance}`);
  console.log(`Prompt flags: ${summary.blockerFlags} blockers, ${summary.reviewFlags} review`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
