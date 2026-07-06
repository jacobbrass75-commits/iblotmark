#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";
const EXPANDED_PREFIX = "openrouter-expanded-ai-benchmark-";
const REPORT_DIR = "post-run-comparison";

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

async function listDirs(prefix) {
  const entries = await readdir(path.join(process.cwd(), OUTPUT_ROOT), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => path.join(process.cwd(), OUTPUT_ROOT, entry.name))
    .sort();
}

async function readTextIfExists(filePath, fallback = "") {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return fallback;
  }
}

async function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
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
  if (!headers) return [];
  return body.map((line) => Object.fromEntries(headers.map((header, index) => [header, line[index] ?? ""])));
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

function isTrue(value) {
  return /^(true|yes|1)$/i.test(String(value ?? "").trim());
}

function pct(count, total) {
  return total ? Math.round((toNumber(count) / toNumber(total)) * 100) : 0;
}

function short(value, length = 120) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function parseRank(value) {
  const n = toNumber(value);
  return n > 0 ? n : null;
}

function listValue(value) {
  return String(value ?? "")
    .split(/;|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isBrandedQuery(query) {
  return /\bibolt\b/i.test(String(query ?? ""));
}

function resultMetrics(rows) {
  const total = rows.length;
  const nonBranded = rows.filter((row) => !isBrandedQuery(row.query));
  const mentionRows = rows.filter((row) => isTrue(row.brand_mentioned));
  const nonBrandedMentions = nonBranded.filter((row) => isTrue(row.brand_mentioned));
  const citations = rows.filter((row) => isTrue(row.domain_cited) || listValue(row.source_urls).some((url) => /iboltmounts\.com/i.test(url)));
  const topThree = rows.filter((row) => {
    const rank = parseRank(row.top_pick_rank);
    return rank !== null && rank <= 3;
  });
  const competitorOnly = rows.filter((row) => !isTrue(row.brand_mentioned) && listValue(row.competitors).length > 0);
  const productEntity = rows.filter((row) => listValue(row.mentioned_products).length > 0);
  return {
    answers: total,
    nonBrandedAnswers: nonBranded.length,
    mentions: mentionRows.length,
    mentionRate: pct(mentionRows.length, total),
    nonBrandedMentions: nonBrandedMentions.length,
    nonBrandedMentionRate: pct(nonBrandedMentions.length, nonBranded.length),
    citations: citations.length,
    citationRate: pct(citations.length, total),
    topThree: topThree.length,
    topThreeRate: pct(topThree.length, total),
    competitorOnly: competitorOnly.length,
    competitorOnlyRate: pct(competitorOnly.length, total),
    productEntityRows: productEntity.length,
    productEntityRate: pct(productEntity.length, total),
  };
}

function groupRows(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const value = row[key] || "unknown";
    if (!map.has(value)) map.set(value, []);
    map.get(value).push(row);
  }
  return [...map.entries()].map(([name, group]) => ({ name, rows: group, metrics: resultMetrics(group) }));
}

async function latestCompletedExpandedRun() {
  const dirs = await listDirs(EXPANDED_PREFIX);
  for (const dir of dirs.slice().reverse()) {
    const resultsPath = path.join(dir, "results.csv");
    const text = await readTextIfExists(resultsPath);
    if (!text) continue;
    const rows = parseCsv(text);
    if (!rows.length) continue;
    return { dir, resultsPath, rows };
  }
  return null;
}

async function latestDryRuns(limit = 8) {
  const dirs = await listDirs(EXPANDED_PREFIX);
  const rows = [];
  for (const dir of dirs.slice().reverse()) {
    const dryRunPath = path.join(dir, "DRY_RUN.md");
    const text = await readTextIfExists(dryRunPath);
    if (!text) continue;
    const metric = (label) => new RegExp(`${label}:\\s*([^\\n]+)`).exec(text)?.[1]?.trim() || "";
    rows.push({
      output_dir: path.relative(process.cwd(), dir),
      selected_prompts: metric("Selected prompts"),
      provider_requests: metric("Provider requests"),
      providers: metric("Providers"),
      prompt_file: metric("Prompt file"),
    });
    if (rows.length >= limit) break;
  }
  return rows;
}

function deltaRows({ baseline, current, targets }) {
  const rows = [
    {
      metric: "Mention rate",
      baseline: baseline.mentionRate,
      current: current?.mentionRate ?? "",
      target: targets.mentionRate,
      direction: "up",
      proof: current ? `${current.mentions}/${current.answers}` : "no live expanded run",
    },
    {
      metric: "Non-branded mention rate",
      baseline: baseline.nonBrandedMentionRate,
      current: current?.nonBrandedMentionRate ?? "",
      target: targets.nonBrandedMentionRate,
      direction: "up",
      proof: current ? `${current.nonBrandedMentions}/${current.nonBrandedAnswers}` : "no live expanded run",
    },
    {
      metric: "Top-3 recommendation rate",
      baseline: baseline.topThreeRate,
      current: current?.topThreeRate ?? "",
      target: targets.topThreeRate,
      direction: "up",
      proof: current ? `${current.topThree}/${current.answers}` : "no live expanded run",
    },
    {
      metric: "Citation rate",
      baseline: baseline.citationRate,
      current: current?.citationRate ?? "",
      target: targets.citationRate,
      direction: "up",
      proof: current ? `${current.citations}/${current.answers}` : "no live expanded run",
    },
    {
      metric: "Competitor-only answer rate",
      baseline: baseline.competitorOnlyRate,
      current: current?.competitorOnlyRate ?? "",
      target: targets.competitorOnlyRate,
      direction: "down",
      proof: current ? `${current.competitorOnly}/${current.answers}` : "no live expanded run",
    },
    {
      metric: "Product entity rows",
      baseline: baseline.productEntityRate,
      current: current?.productEntityRate ?? "",
      target: targets.productEntityRate,
      direction: "up",
      proof: current ? `${current.productEntityRows}/${current.answers}` : "no live expanded run",
    },
  ];
  return rows.map((row) => {
    const current = toNumber(row.current);
    const baselineValue = toNumber(row.baseline);
    const target = toNumber(row.target);
    let status = "pending_live_run";
    if (row.current !== "") {
      const targetHit = row.direction === "down" ? current <= target : current >= target;
      const improved = row.direction === "down" ? current < baselineValue : current > baselineValue;
      status = targetHit ? "target_hit" : improved ? "improved_not_target" : "not_improved";
    }
    return {
      ...row,
      delta: row.current === "" ? "" : current - baselineValue,
      status,
    };
  });
}

function barSvg({ title, subtitle, rows }) {
  const width = 980;
  const rowHeight = 42;
  const height = 84 + rows.length * rowHeight;
  const max = Math.max(1, ...rows.flatMap((row) => [toNumber(row.baseline), toNumber(row.current), toNumber(row.target)]));
  const body = rows.map((row, index) => {
    const y = 64 + index * rowHeight;
    const baseW = Math.round((toNumber(row.baseline) / max) * 430);
    const currentW = row.current === "" ? 0 : Math.round((toNumber(row.current) / max) * 430);
    const targetW = Math.round((toNumber(row.target) / max) * 430);
    return `<g>
      <text x="24" y="${y + 17}" font-size="13" font-weight="900" fill="#111827">${escapeHtml(short(row.metric, 36))}</text>
      <rect x="302" y="${y - 3}" width="430" height="9" rx="5" fill="#e5e7eb"/>
      <rect x="302" y="${y - 3}" width="${baseW}" height="9" rx="5" fill="#94a3b8"/>
      <rect x="302" y="${y + 10}" width="430" height="9" rx="5" fill="#e5e7eb"/>
      ${currentW ? `<rect x="302" y="${y + 10}" width="${currentW}" height="9" rx="5" fill="#0f766e"/>` : ""}
      <rect x="302" y="${y + 23}" width="${targetW}" height="5" rx="3" fill="#2563eb"/>
      <text x="758" y="${y + 16}" font-size="12" font-weight="900" fill="#111827">Base ${escapeHtml(row.baseline)}%</text>
      <text x="838" y="${y + 16}" font-size="12" font-weight="900" fill="#111827">Now ${escapeHtml(row.current === "" ? "n/a" : `${row.current}%`)}</text>
      <text x="920" y="${y + 16}" font-size="12" fill="#475569">Target ${escapeHtml(row.target)}%</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#fff"/>
    <text x="24" y="32" font-size="22" font-weight="900" fill="#111827">${escapeHtml(title)}</text>
    <text x="24" y="53" font-size="13" fill="#64748b">${escapeHtml(subtitle)}</text>
    ${body}
  </svg>`;
}

function table(headers, rows, limit = 40) {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header.label)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.slice(0, limit).map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header.key])}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table>${head}${body}</table>`;
}

function renderHtml({ summary, kpiRows, providerRows, categoryRows, gapRows, dryRunRows }) {
  const cards = [
    ["Status", summary.status, summary.status_note],
    ["Baseline mention", `${summary.baseline.mentionRate}%`, "Saved 93-answer benchmark."],
    ["Current mention", summary.current ? `${summary.current.mentionRate}%` : "n/a", summary.current ? `${summary.current.answers} live rows` : "No live expanded results."],
    ["Citation", summary.current ? `${summary.current.citationRate}%` : "n/a", "Target-domain citations."],
    ["Competitor-only", summary.current ? `${summary.current.competitorOnlyRate}%` : "n/a", "Lower is better."],
    ["Dry runs", dryRunRows.length, "Recent expanded dry-run outputs."],
  ].map(([label, value, note]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT Post-Run AI Benchmark Comparison</title>
  <style>
    body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1220px;margin:0 auto;padding:34px 24px 70px}
    h1{font-size:36px;margin:0 0 8px}
    h2{font-size:22px;margin:34px 0 12px}
    p,li{line-height:1.55;color:#334155;font-size:15px}
    .note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #0f766e;border-radius:12px;padding:16px 18px;margin:20px 0}
    .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:22px 0}
    .card{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:15px}
    .label{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:900}
    .value{font-size:27px;font-weight:900;margin:8px 0;color:#0f172a}
    .chart{background:#fff;border:1px solid #dbe3ef;border-radius:18px;padding:10px;overflow:auto}
    .chart img{width:100%;height:auto;display:block}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 24px}
    th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    a{color:#0f766e;overflow-wrap:anywhere}
  </style>
</head>
<body>
<main>
  <h1>iBOLT Post-Run AI Benchmark Comparison</h1>
  <p>This report compares the saved baseline against the newest completed expanded provider run. If no completed live run exists, it shows the live-run blocker and the latest dry-run proof.</p>
  <div class="note"><strong>Readout:</strong> ${escapeHtml(summary.status_note)}</div>
  <section class="cards">${cards}</section>
  <div class="chart"><img src="kpi-delta.svg" alt="KPI baseline versus current run"/></div>
  <h2>KPI Delta</h2>
  ${table([
    { label: "Metric", key: "metric" },
    { label: "Baseline", key: "baseline" },
    { label: "Current", key: "current" },
    { label: "Delta", key: "delta" },
    { label: "Target", key: "target" },
    { label: "Status", key: "status" },
    { label: "Proof", key: "proof" },
  ], kpiRows)}
  <h2>Provider Results</h2>
  ${providerRows.length ? table([
    { label: "Provider", key: "name" },
    { label: "Answers", key: "answers" },
    { label: "Mention", key: "mentionRate" },
    { label: "Top-3", key: "topThreeRate" },
    { label: "Citation", key: "citationRate" },
    { label: "Competitor-only", key: "competitorOnlyRate" },
  ], providerRows) : "<p>No completed live provider result rows found yet.</p>"}
  <h2>Category Results</h2>
  ${categoryRows.length ? table([
    { label: "Category", key: "name" },
    { label: "Answers", key: "answers" },
    { label: "Mention", key: "mentionRate" },
    { label: "Top-3", key: "topThreeRate" },
    { label: "Citation", key: "citationRate" },
    { label: "Competitor-only", key: "competitorOnlyRate" },
  ], categoryRows) : "<p>No completed live category rows found yet.</p>"}
  <h2>Remaining Gaps</h2>
  ${gapRows.length ? table([
    { label: "Provider", key: "provider" },
    { label: "Query", key: "query" },
    { label: "Category", key: "category" },
    { label: "Score", key: "coverage_score" },
    { label: "Competitors", key: "competitors" },
    { label: "Action", key: "action" },
  ], gapRows, 30) : "<p>No completed live gaps to inspect yet.</p>"}
  <h2>Recent Dry Runs</h2>
  ${table([
    { label: "Output", key: "output_dir" },
    { label: "Prompts", key: "selected_prompts" },
    { label: "Requests", key: "provider_requests" },
    { label: "Prompt file", key: "prompt_file" },
  ], dryRunRows, 8)}
</main>
</body>
</html>`;
}

function renderMarkdown({ summary, kpiRows, providerRows, categoryRows, gapRows, dryRunRows }) {
  return `# iBOLT Post-Run AI Benchmark Comparison

## Status

${summary.status_note}

## KPI Delta

${kpiRows.map((row) => `- ${row.metric}: baseline ${row.baseline}%, current ${row.current === "" ? "n/a" : `${row.current}%`}, target ${row.target}%, status ${row.status}.`).join("\n")}

## Provider Results

${providerRows.length ? providerRows.map((row) => `- ${row.name}: ${row.answers} answers, mention ${row.mentionRate}%, top-3 ${row.topThreeRate}%, citation ${row.citationRate}%, competitor-only ${row.competitorOnlyRate}%.`).join("\n") : "No completed live provider result rows found yet."}

## Category Results

${categoryRows.length ? categoryRows.map((row) => `- ${row.name}: ${row.answers} answers, mention ${row.mentionRate}%, top-3 ${row.topThreeRate}%, citation ${row.citationRate}%, competitor-only ${row.competitorOnlyRate}%.`).join("\n") : "No completed live category rows found yet."}

## Remaining Gaps

${gapRows.length ? gapRows.slice(0, 20).map((row) => `- ${row.provider} / ${row.query}: ${row.action}`).join("\n") : "No completed live gaps to inspect yet."}

## Recent Dry Runs

${dryRunRows.map((row) => `- ${row.output_dir}: ${row.selected_prompts} prompts, ${row.provider_requests} requests, manifest ${row.prompt_file}`).join("\n")}
`;
}

async function main() {
  const benchmarkDir = process.argv[2] ? path.resolve(process.argv[2]) : await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, REPORT_DIR);
  await mkdir(outDir, { recursive: true });

  const kpiData = await readJsonIfExists(path.join(benchmarkDir, "visibility-kpi-retest-ladder", "visibility-kpi-ladder-data.json"), {});
  const kpi = kpiData.summary || kpiData;
  const master = await readJsonIfExists(path.join(benchmarkDir, "master-dossier", "master-dossier-data.json"), {});
  const baseline = {
    answers: toNumber(master.evidenceSummary?.total) || 93,
    mentions: toNumber(master.evidenceSummary?.mentionCount) || 22,
    mentionRate: toNumber(kpi.mentionRate) || 24,
    nonBrandedAnswers: toNumber(master.evidenceSummary?.nonBranded) || 75,
    nonBrandedMentions: toNumber(master.evidenceSummary?.nonBrandedMentionCount) || 4,
    nonBrandedMentionRate: toNumber(kpi.nonBrandedMentionRate) || 5,
    topThree: toNumber(master.mentionSummary?.topThree) || 15,
    topThreeRate: toNumber(kpi.topThreeRate) || 16,
    citations: toNumber(master.evidenceSummary?.citationCount) || 0,
    citationRate: toNumber(kpi.citationRate),
    competitorOnly: toNumber(master.mentionSummary?.competitorOnlyAnswers) || 68,
    competitorOnlyRate: toNumber(kpi.competitorOnlyRate) || 73,
    productEntityRows: toNumber(master.mentionSummary?.productFamilySignalRows) || 30,
    productEntityRate: pct(toNumber(master.mentionSummary?.productFamilySignalRows) || 30, toNumber(master.evidenceSummary?.total) || 93),
  };
  const targets = {
    mentionRate: 35,
    nonBrandedMentionRate: 15,
    topThreeRate: 25,
    citationRate: 8,
    competitorOnlyRate: Math.max(0, baseline.competitorOnlyRate - toNumber(kpi.competitorOnlyReductionNeeded || 16)),
    productEntityRate: 45,
  };

  const completed = await latestCompletedExpandedRun();
  const current = completed ? resultMetrics(completed.rows) : null;
  const kpiRows = deltaRows({ baseline, current, targets });
  const providerRows = completed
    ? groupRows(completed.rows, "provider").map((row) => ({ name: row.name, ...row.metrics }))
    : [];
  const categoryRows = completed
    ? groupRows(completed.rows, "category").map((row) => ({ name: row.name, ...row.metrics })).sort((a, b) => b.answers - a.answers)
    : [];
  const gapRows = completed
    ? completed.rows
      .filter((row) => !isTrue(row.brand_mentioned) || !isTrue(row.domain_cited) || toNumber(row.coverage_score) < 70)
      .sort((a, b) => toNumber(a.coverage_score) - toNumber(b.coverage_score))
      .slice(0, 60)
      .map((row) => ({
        provider: row.provider,
        query: short(row.query, 90),
        category: row.category,
        coverage_score: row.coverage_score,
        competitors: short(row.competitors, 95),
        action: !isTrue(row.brand_mentioned)
          ? "Add/strengthen answer-first page language and comparison blocks."
          : !isTrue(row.domain_cited)
            ? "Move this to source/citation cleanup."
            : "Improve product entity accuracy and top-3 recommendation strength.",
      }))
    : [];
  const dryRunRows = await latestDryRuns(8);

  const summary = {
    generated_at: new Date().toISOString(),
    benchmark_dir: benchmarkDir,
    completed_expanded_run_dir: completed ? completed.dir : "",
    completed_results_csv: completed ? completed.resultsPath : "",
    status: completed ? "completed_run_found" : "waiting_for_live_run",
    status_note: completed
      ? `Compared baseline against ${path.relative(process.cwd(), completed.dir)} with ${current.answers} result rows.`
      : "No completed expanded live run with results.csv was found. The W1-W5 manifests are dry-run validated, but provider responses still need OPENROUTER_API_KEY.",
    baseline,
    current,
    targets,
  };

  await writeFile(path.join(outDir, "post-run-comparison-data.json"), JSON.stringify({
    summary,
    kpiRows,
    providerRows,
    categoryRows,
    gapRows,
    dryRunRows,
  }, null, 2));
  await writeFile(path.join(outDir, "post-run-kpi-delta.csv"), csv([
    ["metric", "baseline", "current", "delta", "target", "status", "proof"],
    ...kpiRows.map((row) => [row.metric, row.baseline, row.current, row.delta, row.target, row.status, row.proof]),
  ]));
  await writeFile(path.join(outDir, "post-run-provider-delta.csv"), csv([
    ["provider", "answers", "mention_rate", "non_branded_mention_rate", "top_three_rate", "citation_rate", "competitor_only_rate", "product_entity_rate"],
    ...providerRows.map((row) => [row.name, row.answers, row.mentionRate, row.nonBrandedMentionRate, row.topThreeRate, row.citationRate, row.competitorOnlyRate, row.productEntityRate]),
  ]));
  await writeFile(path.join(outDir, "post-run-category-delta.csv"), csv([
    ["category", "answers", "mention_rate", "non_branded_mention_rate", "top_three_rate", "citation_rate", "competitor_only_rate", "product_entity_rate"],
    ...categoryRows.map((row) => [row.name, row.answers, row.mentionRate, row.nonBrandedMentionRate, row.topThreeRate, row.citationRate, row.competitorOnlyRate, row.productEntityRate]),
  ]));
  await writeFile(path.join(outDir, "post-run-gap-rows.csv"), csv([
    ["provider", "query", "category", "coverage_score", "competitors", "action"],
    ...gapRows.map((row) => [row.provider, row.query, row.category, row.coverage_score, row.competitors, row.action]),
  ]));
  await writeFile(path.join(outDir, "kpi-delta.svg"), barSvg({
    title: "Post-Run KPI Delta",
    subtitle: "Baseline vs latest completed expanded provider run. Current is blank until results.csv exists.",
    rows: kpiRows,
  }));
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml({ summary, kpiRows, providerRows, categoryRows, gapRows, dryRunRows }));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown({ summary, kpiRows, providerRows, categoryRows, gapRows, dryRunRows }));

  console.log(`Wrote ${outDir}`);
  console.log(JSON.stringify({
    status: summary.status,
    completed_expanded_run_dir: summary.completed_expanded_run_dir,
    baseline: {
      mentionRate: baseline.mentionRate,
      nonBrandedMentionRate: baseline.nonBrandedMentionRate,
      topThreeRate: baseline.topThreeRate,
      citationRate: baseline.citationRate,
      competitorOnlyRate: baseline.competitorOnlyRate,
    },
    current: current ? {
      answers: current.answers,
      mentionRate: current.mentionRate,
      nonBrandedMentionRate: current.nonBrandedMentionRate,
      topThreeRate: current.topThreeRate,
      citationRate: current.citationRate,
      competitorOnlyRate: current.competitorOnlyRate,
    } : null,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
