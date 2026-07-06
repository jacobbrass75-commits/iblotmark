#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";
const REPORT_DIR = "next-benchmark-runbook";

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

async function readTextIfExists(filePath, fallback = "") {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return fallback;
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
    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  const nonEmpty = rows.filter((line) => line.some((cell) => String(cell).trim()));
  const [headers, ...body] = nonEmpty;
  if (!headers) return { headers: [], rows: [] };
  return {
    headers,
    rows: body.map((line) => Object.fromEntries(headers.map((header, index) => [header, line[index] ?? ""]))),
  };
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function csv(rows) {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toNumber(value) {
  if (typeof value === "number") return value;
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function uniqueCount(rows, key) {
  return new Set(rows.map((row) => row[key]).filter(Boolean)).size;
}

function countBy(rows, key) {
  const counts = new Map();
  for (const row of rows) {
    const value = row[key] || "unknown";
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, count]) => ({ label, count }));
}

function topList(rows, key, limit = 5) {
  return countBy(rows, key).slice(0, limit).map((row) => `${row.label} ${row.count}`).join("; ");
}

function short(value, length = 120) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function commandFor(manifestPath) {
  return [
    "AI_BENCHMARK_EXPANDED_LIMIT=0 \\",
    `AI_BENCHMARK_EXPANDED_MANIFEST=${manifestPath} \\`,
    "npx tsx scripts/run-expanded-openrouter-ai-benchmark.ts",
  ].join("\n");
}

function parseDryRunText(text) {
  const valueFor = (label) => {
    const match = new RegExp(`${label}:\\s*([^\\n]+)`).exec(text);
    return match?.[1]?.trim() || "";
  };
  return {
    selected_prompts: toNumber(valueFor("Selected prompts")),
    provider_requests: toNumber(valueFor("Provider requests")),
    providers: valueFor("Providers"),
    mode: valueFor("Provider manifest mode"),
    prompt_file: valueFor("Prompt file"),
    input_manifest_rows: toNumber(valueFor("Input manifest rows")),
  };
}

async function findDryRunProofs(manifestPaths) {
  const outputRoot = path.join(process.cwd(), OUTPUT_ROOT);
  const entries = await readdir(outputRoot, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("openrouter-expanded-ai-benchmark-"))
    .map((entry) => entry.name)
    .sort();
  const proofByManifest = new Map();
  for (const dir of dirs) {
    const dryRunPath = path.join(outputRoot, dir, "DRY_RUN.md");
    const text = await readTextIfExists(dryRunPath);
    if (!text) continue;
    const proof = parseDryRunText(text);
    if (!manifestPaths.has(proof.prompt_file)) continue;
    proofByManifest.set(proof.prompt_file, {
      ...proof,
      output_dir: path.relative(process.cwd(), path.join(outputRoot, dir)),
      dry_run_file: path.relative(process.cwd(), dryRunPath),
    });
  }
  return proofByManifest;
}

function dryRunCommandFor(manifestPath) {
  return [
    "AI_BENCHMARK_DRY_RUN=1 \\",
    "AI_BENCHMARK_EXPANDED_LIMIT=0 \\",
    `AI_BENCHMARK_EXPANDED_MANIFEST=${manifestPath} \\`,
    "npx tsx scripts/run-expanded-openrouter-ai-benchmark.ts",
  ].join("\n");
}

function barSvg({ title, subtitle, rows, labelKey = "label", valueKey = "count", width = 980, color = "#2563eb" }) {
  const chartRows = rows.slice(0, 12);
  const rowHeight = 36;
  const height = 84 + chartRows.length * rowHeight;
  const max = Math.max(1, ...chartRows.map((row) => toNumber(row[valueKey])));
  const body = chartRows.map((row, index) => {
    const y = 64 + index * rowHeight;
    const value = toNumber(row[valueKey]);
    const barWidth = Math.round((value / max) * (width - 390));
    return `<g>
      <text x="24" y="${y + 17}" font-size="13" font-weight="900" fill="#111827">${escapeHtml(short(row[labelKey], 42))}</text>
      <rect x="330" y="${y}" width="${width - 390}" height="22" rx="11" fill="#e5e7eb"/>
      <rect x="330" y="${y}" width="${barWidth}" height="22" rx="11" fill="${row.color || color}"/>
      <text x="${width - 28}" y="${y + 16}" text-anchor="end" font-size="13" font-weight="900" fill="#111827">${escapeHtml(value)}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#fff"/>
    <text x="24" y="32" font-size="22" font-weight="900" fill="#111827">${escapeHtml(title)}</text>
    <text x="24" y="53" font-size="13" fill="#64748b">${escapeHtml(subtitle)}</text>
    ${body}
  </svg>`;
}

function table(headers, rows, limit = 30) {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header.label)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.slice(0, limit).map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header.key])}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table>${head}${body}</table>`;
}

function renderHtml({ summary, waveRows, commandRows, dryRunRows, topPromptRows, providerRows, categoryRows }) {
  const cards = [
    ["Priority requests", summary.priority_requests, "Run first after page edits."],
    ["Priority prompts", summary.priority_prompts, "Unique small buyer questions."],
    ["Priority pages", summary.priority_pages, "Mapped live pages covered."],
    ["Waves", summary.waves, "Independent retest batches."],
    ["Full requests", summary.full_requests, "All-blog full manifest."],
    ["Key in shell", summary.key_available ? "Yes" : "No", "OPENROUTER_API_KEY"],
  ].map(([label, value, note]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT Next AI Benchmark Runbook</title>
  <style>
    body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1220px;margin:0 auto;padding:34px 24px 70px}
    h1{font-size:36px;margin:0 0 8px}
    h2{font-size:22px;margin:34px 0 12px}
    p,li{line-height:1.55;color:#334155;font-size:15px}
    code,pre{background:#eef2f7;border-radius:8px}
    pre{padding:14px;overflow:auto;border:1px solid #dbe3ef}
    .note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #2563eb;border-radius:12px;padding:16px 18px;margin:20px 0}
    .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:22px 0}
    .card{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:15px}
    .label{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:900}
    .value{font-size:27px;font-weight:900;margin:8px 0;color:#0f172a}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
    .chart{background:#fff;border:1px solid #dbe3ef;border-radius:18px;padding:10px;overflow:auto}
    .chart img{width:100%;height:auto;display:block}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 24px}
    th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    a{color:#2563eb;overflow-wrap:anywhere}
    @media(max-width:900px){.grid{grid-template-columns:1fr}h1{font-size:30px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT Next AI Benchmark Runbook</h1>
  <p>This is the operational runbook for the next provider test. It keeps the benchmark one small prompt at a time, grouped into waves so edits can be proved before the full all-blog run.</p>
  <div class="note"><strong>Status:</strong> ${summary.key_available ? "The API key is available in this shell." : "The API key is not available in this shell."} Run W1 first after the Sprint 1 page edits are live. Do not run the full 1,449-request manifest until W1 and W2 prove movement.</div>
  <section class="cards">${cards}</section>
  <section class="grid">
    <div class="chart"><img src="requests-by-wave.svg" alt="Requests by wave"/></div>
    <div class="chart"><img src="requests-by-category.svg" alt="Requests by category"/></div>
  </section>
  <h2>Run Order</h2>
  ${table([
    { label: "Batch", key: "batch_id" },
    { label: "Wave", key: "wave" },
    { label: "Requests", key: "requests" },
    { label: "Prompts", key: "unique_prompts" },
    { label: "Pages", key: "pages" },
    { label: "Manifest", key: "manifest" },
    { label: "Success Metric", key: "success_metric" },
  ], waveRows)}
  <h2>Commands</h2>
  ${table([
    { label: "Run", key: "name" },
    { label: "Requests", key: "requests" },
    { label: "Command", key: "command" },
    { label: "Dry Run", key: "dry_run" },
  ], commandRows)}
  <h2>Dry-Run Proof</h2>
  ${table([
    { label: "Batch", key: "batch_id" },
    { label: "Manifest", key: "manifest" },
    { label: "Prompts", key: "selected_prompts" },
    { label: "Requests", key: "provider_requests" },
    { label: "Output", key: "output_dir" },
    { label: "Status", key: "status" },
  ], dryRunRows)}
  <h2>Highest Priority Prompt Rows</h2>
  ${table([
    { label: "Batch", key: "batch_id" },
    { label: "Provider", key: "provider" },
    { label: "Prompt", key: "prompt" },
    { label: "Category", key: "category" },
    { label: "Page", key: "closest_post" },
    { label: "Expected Metric", key: "expected_metric" },
  ], topPromptRows, 20)}
  <h2>Provider And Category Balance</h2>
  <div class="grid">
    ${table([
      { label: "Provider", key: "provider" },
      { label: "Requests", key: "requests" },
      { label: "Pages", key: "pages" },
      { label: "Prompt Types", key: "prompt_types" },
    ], providerRows)}
    ${table([
      { label: "Category", key: "category" },
      { label: "Requests", key: "requests" },
      { label: "Pages", key: "pages" },
      { label: "Waves", key: "waves" },
    ], categoryRows)}
  </div>
  <h2>Output Checks After Each Run</h2>
  <ul>
    <li>Open the newest <code>content-output/openrouter-expanded-ai-benchmark-*/REPORT.md</code>.</li>
    <li>Check <code>results.csv</code> for <code>brand_mentioned</code>, <code>domain_cited</code>, <code>top_pick_rank</code>, <code>competitors</code>, and <code>mentioned_products</code>.</li>
    <li>Compare against the baseline: mention 24%, non-branded mention 5%, top-3 16%, citation 0%, competitor-only 73%.</li>
    <li>Rebuild the dashboard package after each live run.</li>
  </ul>
</main>
</body>
</html>`;
}

function renderMarkdown({ summary, waveRows, commandRows, dryRunRows, topPromptRows }) {
  return `# iBOLT Next AI Benchmark Runbook

## Status

- API key available in this shell: ${summary.key_available ? "yes" : "no"}
- Priority provider requests: ${summary.priority_requests}
- Priority unique prompts: ${summary.priority_prompts}
- Priority pages: ${summary.priority_pages}
- Full all-blog provider requests: ${summary.full_requests}
- Full all-blog unique prompts: ${summary.full_prompts}

Run W1 first after the Sprint 1 page edits are live. Run W2 after top-page mention recovery edits. Run W3 only after source cleanup, because it is the citation probe. Run W4 for product entity accuracy and W5 for broader non-branded buyer coverage.

## Wave Order

${waveRows.map((row) => `- ${row.batch_id} ${row.wave}: ${row.requests} requests, ${row.unique_prompts} prompts, ${row.pages} pages. Manifest: ${row.manifest}. Success: ${row.success_metric}`).join("\n")}

## Dry-Run Proof

${dryRunRows.map((row) => `- ${row.batch_id}: ${row.status}, ${row.selected_prompts} prompts, ${row.provider_requests} requests. Output: ${row.output_dir || "missing"}`).join("\n")}

## Commands

${commandRows.map((row) => `### ${row.name}

\`\`\`bash
${row.command}
\`\`\`

Dry run:

\`\`\`bash
${row.dry_run}
\`\`\`
`).join("\n")}

## Highest Priority Prompt Rows

${topPromptRows.slice(0, 20).map((row) => `- ${row.batch_id} / ${row.provider}: ${row.prompt} (${row.category}) -> ${row.expected_metric}`).join("\n")}
`;
}

async function main() {
  const benchmarkDir = process.argv[2] ? path.resolve(process.argv[2]) : await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, REPORT_DIR);
  await mkdir(outDir, { recursive: true });

  const priorityData = await readJsonIfExists(path.join(benchmarkDir, "priority-retest-packet", "priority-retest-data.json"), {});
  const priority = priorityData.summary || priorityData;
  const kpiData = await readJsonIfExists(path.join(benchmarkDir, "visibility-kpi-retest-ladder", "visibility-kpi-ladder-data.json"), {});
  const kpi = kpiData.summary || kpiData;
  const { headers: priorityHeaders, rows: priorityRows } = parseCsv(await readTextIfExists(path.join(benchmarkDir, "priority-retest-packet", "priority-provider-request-manifest.csv")));
  const { rows: sourceWaveRows } = parseCsv(await readTextIfExists(path.join(benchmarkDir, "priority-retest-packet", "retest-batches.csv")));
  const { rows: sourceProviderRows } = parseCsv(await readTextIfExists(path.join(benchmarkDir, "priority-retest-packet", "provider-balance.csv")));
  const { rows: sourceCategoryRows } = parseCsv(await readTextIfExists(path.join(benchmarkDir, "priority-retest-packet", "category-balance.csv")));
  const { rows: fullRows } = parseCsv(await readTextIfExists(path.join(benchmarkDir, "all-blog-prompt-gap-addendum", "all-blog-complete-provider-manifest.csv")));

  const priorityManifestRel = path.relative(process.cwd(), path.join(benchmarkDir, "priority-retest-packet", "priority-provider-request-manifest.csv"));
  const fullManifestRel = path.relative(process.cwd(), path.join(benchmarkDir, "all-blog-prompt-gap-addendum", "all-blog-complete-provider-manifest.csv"));

  const waveRows = sourceWaveRows.map((wave) => {
    const rows = priorityRows.filter((row) => row.batch_id === wave.batch_id);
    const waveManifestRel = path.relative(process.cwd(), path.join(outDir, `${wave.batch_id.toLowerCase()}-provider-manifest.csv`));
    return {
      ...wave,
      manifest: waveManifestRel,
      rows,
    };
  });

  for (const wave of waveRows) {
    await writeFile(path.join(outDir, `${wave.batch_id.toLowerCase()}-provider-manifest.csv`), csv([
      priorityHeaders,
      ...wave.rows.map((row) => priorityHeaders.map((header) => row[header] || "")),
    ]));
  }

  const waveManifestPaths = new Set(waveRows.map((wave) => wave.manifest));
  const dryRunProofs = await findDryRunProofs(waveManifestPaths);
  const dryRunRows = waveRows.map((wave) => {
    const proof = dryRunProofs.get(wave.manifest) || {};
    const selectedPrompts = toNumber(proof.selected_prompts);
    const providerRequests = toNumber(proof.provider_requests);
    const status = selectedPrompts === toNumber(wave.unique_prompts) && providerRequests === toNumber(wave.requests)
      ? "validated"
      : "missing_or_mismatch";
    return {
      batch_id: wave.batch_id,
      manifest: wave.manifest,
      expected_prompts: wave.unique_prompts,
      expected_requests: wave.requests,
      selected_prompts: selectedPrompts,
      provider_requests: providerRequests,
      providers: proof.providers || "",
      output_dir: proof.output_dir || "",
      dry_run_file: proof.dry_run_file || "",
      status,
    };
  });

  const commandRows = [
    ...waveRows.map((wave) => ({
      name: `${wave.batch_id} ${wave.wave}`,
      requests: wave.requests,
      command: commandFor(wave.manifest),
      dry_run: dryRunCommandFor(wave.manifest),
    })),
    {
      name: "All priority waves",
      requests: priorityRows.length,
      command: commandFor(priorityManifestRel),
      dry_run: dryRunCommandFor(priorityManifestRel),
    },
    {
      name: "Full all-blog manifest",
      requests: fullRows.length,
      command: commandFor(fullManifestRel),
      dry_run: dryRunCommandFor(fullManifestRel),
    },
  ];

  const topPromptRows = [...priorityRows]
    .sort((a, b) => toNumber(b.priority) - toNumber(a.priority) || a.prompt.localeCompare(b.prompt))
    .slice(0, 40)
    .map((row) => ({
      ...row,
      prompt: short(row.prompt, 92),
      closest_post: short(row.closest_post, 90),
      expected_metric: short(row.expected_metric, 100),
    }));

  const summary = {
    generated_at: new Date().toISOString(),
    benchmark_dir: benchmarkDir,
    key_available: Boolean(process.env.OPENROUTER_API_KEY),
    baseline_mention_rate: toNumber(kpi.mentionRate),
    baseline_non_branded_mention_rate: toNumber(kpi.nonBrandedMentionRate),
    baseline_top_three_rate: toNumber(kpi.topThreeRate),
    baseline_citation_rate: toNumber(kpi.citationRate),
    baseline_competitor_only_rate: toNumber(kpi.competitorOnlyRate),
    priority_requests: priorityRows.length || toNumber(priority.priorityProviderRequests),
    priority_prompts: uniqueCount(priorityRows, "prompt") || toNumber(priority.uniquePrompts),
    priority_pages: uniqueCount(priorityRows, "page_url") || toNumber(priority.pagesCovered),
    priority_categories: uniqueCount(priorityRows, "category") || toNumber(priority.categoriesCovered),
    providers: uniqueCount(priorityRows, "provider"),
    waves: waveRows.length,
    dry_run_validated_waves: dryRunRows.filter((row) => row.status === "validated").length,
    dry_run_validated_requests: dryRunRows
      .filter((row) => row.status === "validated")
      .reduce((sum, row) => sum + toNumber(row.provider_requests), 0),
    full_requests: fullRows.length || toNumber(kpi.fullProviderRequests),
    full_prompts: uniqueCount(fullRows, "prompt") || toNumber(kpi.fullPrompts),
    top_priority_category: topList(priorityRows, "category", 1),
    top_priority_provider: topList(priorityRows, "provider", 1),
  };

  await writeFile(path.join(outDir, "next-benchmark-runbook-data.json"), JSON.stringify({
    summary,
    waveRows: waveRows.map(({ rows, ...wave }) => wave),
    dryRunRows,
    commandRows,
    providerRows: sourceProviderRows,
    categoryRows: sourceCategoryRows,
    topPromptRows,
  }, null, 2));
  await writeFile(path.join(outDir, "benchmark-run-commands.csv"), csv([
    ["name", "requests", "command", "dry_run"],
    ...commandRows.map((row) => [row.name, row.requests, row.command, row.dry_run]),
  ]));
  await writeFile(path.join(outDir, "dry-run-proof.csv"), csv([
    ["batch_id", "manifest", "expected_prompts", "expected_requests", "selected_prompts", "provider_requests", "providers", "output_dir", "dry_run_file", "status"],
    ...dryRunRows.map((row) => [row.batch_id, row.manifest, row.expected_prompts, row.expected_requests, row.selected_prompts, row.provider_requests, row.providers, row.output_dir, row.dry_run_file, row.status]),
  ]));
  await writeFile(path.join(outDir, "requests-by-wave.svg"), barSvg({
    title: "Priority Requests By Wave",
    subtitle: "Run W1 first, then W2, W3 citation probe, W4 product entity, W5 non-branded coverage.",
    rows: waveRows,
    labelKey: "wave",
    valueKey: "requests",
  }));
  await writeFile(path.join(outDir, "requests-by-category.svg"), barSvg({
    title: "Priority Requests By Category",
    subtitle: "Category concentration in the next provider run.",
    rows: countBy(priorityRows, "category"),
    color: "#0f766e",
  }));
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml({
    summary,
    waveRows: waveRows.map(({ rows, ...wave }) => wave),
    commandRows,
    dryRunRows,
    topPromptRows,
    providerRows: sourceProviderRows,
    categoryRows: sourceCategoryRows,
  }));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown({
    summary,
    waveRows: waveRows.map(({ rows, ...wave }) => wave),
    commandRows,
    dryRunRows,
    topPromptRows,
  }));

  console.log(`Wrote ${outDir}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
