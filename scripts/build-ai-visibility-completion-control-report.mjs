#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "visibility-completion-control-report");

async function readCsv(relativePath) {
  try {
    return parseCsv(await readFile(path.join(benchmarkDir, relativePath), "utf8"));
  } catch {
    return [];
  }
}

async function readJson(relativePath, fallback = {}) {
  try {
    return JSON.parse(await readFile(path.join(benchmarkDir, relativePath), "utf8"));
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

function toNumber(value) {
  if (typeof value === "number") return value;
  const match = String(value ?? "").replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function byMetric(rows, metric) {
  return rows.find((row) => row.metric === metric) || {};
}

function statusBucket(status) {
  const text = String(status ?? "").toLowerCase();
  if (text.includes("not_live") || text.includes("blocked") || text.includes("ready_for_live")) return "needs live proof";
  if (text.includes("weak")) return "proven weak";
  if (text.includes("proven")) return "proven";
  return text || "unknown";
}

function table(headers, rows) {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table>${head}${body}</table>`;
}

function card(label, value, note) {
  return `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`;
}

function barSvg({ title, rows, width = 900 }) {
  const chartRows = rows.slice(0, 10);
  const rowHeight = 38;
  const height = 78 + chartRows.length * rowHeight;
  const max = Math.max(1, ...chartRows.map((row) => toNumber(row.value)));
  const bars = chartRows.map((row, index) => {
    const y = 58 + index * rowHeight;
    const barWidth = Math.max(4, Math.round((toNumber(row.value) / max) * (width - 370)));
    return `<g>
      <text x="22" y="${y + 18}" font-size="13" font-weight="900" fill="#111827">${escapeHtml(row.label)}</text>
      <rect x="300" y="${y}" width="${width - 370}" height="23" rx="11" fill="#e5e7eb"/>
      <rect x="300" y="${y}" width="${barWidth}" height="23" rx="11" fill="${row.color || "#0f766e"}"/>
      <text x="${width - 34}" y="${y + 17}" text-anchor="end" font-size="13" font-weight="900" fill="#111827">${escapeHtml(row.value)}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#ffffff"/>
    <text x="22" y="34" font-size="20" font-weight="900" fill="#111827">${escapeHtml(title)}</text>
    ${bars}
  </svg>`;
}

function renderHtml(data) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT Visibility Completion Control Report</title>
  <style>
    body{margin:0;background:#f6f8fb;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1180px;margin:0 auto;padding:34px 24px 64px}
    h1{font-size:36px;line-height:1.1;margin:0 0 8px}
    h2{font-size:23px;margin:34px 0 12px}
    p,li{line-height:1.55;color:#334155;font-size:15px}
    a{color:#0f766e;overflow-wrap:anywhere}
    code,pre{background:#e2e8f0;border-radius:5px}
    pre{padding:12px;overflow:auto}
    .note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #0f766e;border-radius:12px;padding:16px 18px;margin:20px 0}
    .warn{border-left-color:#f97316}
    .cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:22px 0}
    .card{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:15px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:900}
    .value{font-size:28px;font-weight:900;margin:8px 0;color:#0f172a}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
    .chart{background:#fff;border:1px solid #dbe3ef;border-radius:18px;padding:10px;overflow:auto}
    .chart svg{width:100%;height:auto;display:block}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 22px}
    th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    @media(max-width:980px){.cards,.grid{grid-template-columns:1fr}h1{font-size:30px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT Visibility Completion Control Report</h1>
  <p>This is the compact control view for the active goal: what is already proven, what is still unproven, and what command unlocks the remaining provider evidence.</p>

  <div class="note warn">
    <strong>Current decision:</strong> do not claim post-edit visibility lift yet. Baseline analysis is proven, all-blog inspection is proven, and competitor mapping is proven. Expanded live testing is still not run because secure OpenRouter credentials are not available in this shell.
  </div>

  <section class="cards">
    ${card("Completion verdict", data.verdict, data.blocker)}
    ${card("Proven rows", data.provenCount, "Requirement rows with current evidence.")}
    ${card("Needs live proof", data.needsLiveProofCount, "Requirement rows gated by provider execution.")}
    ${card("OpenRouter key", data.keyAvailable ? "present" : "missing", "Only checked as env presence, no secret value read.")}
    ${card("Integrity audit", data.integrityStatus, `${data.integrityCovered}/${data.integrityTotal} areas, ${data.brokenMarkers} broken markers.`)}
  </section>

  <section class="grid">
    <div class="chart">${data.statusSvg}</div>
    <div class="chart">${data.runSvg}</div>
  </section>

  <h2>Requirement Control Matrix</h2>
  ${data.requirementTable}

  <h2>Remaining Proof Gates</h2>
  ${data.gateTable}

  <h2>Credential-Safe Run Commands</h2>
  <p>Use a secure shell env var only. Do not commit or paste the key into a file.</p>
  <pre>${escapeHtml(data.priorityCommand)}</pre>
  <pre>${escapeHtml(data.fullCommand)}</pre>

  <h2>Evidence Links</h2>
  <ul>
    <li><a href="../goal-closure-audit/REPORT.html">Goal closure audit</a></li>
    <li><a href="../evidence-integrity-audit/REPORT.html">Evidence integrity audit</a></li>
    <li><a href="../priority-retest-packet/REPORT.html">Priority retest packet</a></li>
    <li><a href="../next-benchmark-runbook/REPORT.html">Next benchmark runbook</a></li>
    <li><a href="../post-run-comparison/REPORT.html">Post-run comparison analyzer</a></li>
  </ul>
</main>
</body>
</html>`;
}

function renderMarkdown(data) {
  return `# iBOLT Visibility Completion Control Report

## Current Decision

Do not claim post-edit visibility lift yet. Baseline analysis is proven, all-blog inspection is proven, and competitor mapping is proven. Expanded live testing is still not run because secure OpenRouter credentials are not available in this shell.

## Status

- Completion verdict: ${data.verdict}
- Blocker: ${data.blocker}
- Proven rows: ${data.provenCount}
- Needs live proof: ${data.needsLiveProofCount}
- OpenRouter key present: ${data.keyAvailable ? "yes" : "no"}
- Integrity audit: ${data.integrityCovered}/${data.integrityTotal}, broken markers ${data.brokenMarkers}
- Priority run: ${data.priorityRequests} requests, ${data.priorityPrompts} prompts
- Full run: ${data.fullRequests} requests, ${data.fullPrompts} prompts

## Remaining Proof Gates

${data.gateRows.map((row) => `- ${row.requirement}: ${row.remaining_gate}`).join("\n")}

## Priority Command

\`\`\`bash
${data.priorityCommand}
\`\`\`

## Full Command

\`\`\`bash
${data.fullCommand}
\`\`\`
`;
}

async function main() {
  const closureRows = await readCsv("goal-closure-audit/goal-closure-status.csv");
  const closure = await readJson("goal-closure-audit/goal-closure-data.json", {});
  const integrityRows = await readCsv("evidence-integrity-audit/evidence-integrity-summary.csv");
  const priority = await readJson("priority-retest-packet/priority-retest-data.json", { summary: {} });
  const allBlogManifest = await readCsv("all-blog-prompt-gap-addendum/all-blog-complete-provider-manifest.csv");
  const allBlogPrompts = await readCsv("all-blog-prompt-gap-addendum/all-blog-complete-selected-prompts.csv");
  const keyAvailable = Boolean(process.env.OPENROUTER_API_KEY);

  const summary = priority.summary || {};
  const integrityCovered = toNumber(byMetric(integrityRows, "covered_goal_areas").value);
  const integrityTotal = integrityCovered + toNumber(byMetric(integrityRows, "partial_goal_areas").value) + toNumber(byMetric(integrityRows, "missing_goal_areas").value);
  const brokenMarkers = toNumber(byMetric(integrityRows, "broken_issue_count").value);
  const integrityStatus = byMetric(integrityRows, "status").value || "unknown";
  const gateRows = closureRows.filter((row) => !/^proven$/i.test(String(row.status ?? "")));
  const provenCount = closureRows.filter((row) => /^proven|proven_as_weak$/i.test(String(row.status ?? ""))).length;
  const needsLiveProofCount = gateRows.length;
  const statusCounts = new Map();
  for (const row of closureRows) {
    const bucket = statusBucket(row.status);
    statusCounts.set(bucket, (statusCounts.get(bucket) || 0) + 1);
  }

  const priorityCommand = [
    'export OPENROUTER_API_KEY="..."',
    "AI_BENCHMARK_EXPANDED_LIMIT=0 \\",
    "AI_BENCHMARK_EXPANDED_MANIFEST=content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/priority-retest-packet/priority-provider-request-manifest.csv \\",
    "npx tsx scripts/run-expanded-openrouter-ai-benchmark.ts",
  ].join("\n");
  const fullCommand = [
    'export OPENROUTER_API_KEY="..."',
    "AI_BENCHMARK_EXPANDED_LIMIT=0 \\",
    "AI_BENCHMARK_EXPANDED_MANIFEST=content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/all-blog-prompt-gap-addendum/all-blog-complete-provider-manifest.csv \\",
    "npx tsx scripts/run-expanded-openrouter-ai-benchmark.ts",
  ].join("\n");

  const statusSvg = barSvg({
    title: "Requirement status",
    rows: [...statusCounts.entries()].map(([label, value]) => ({
      label,
      value,
      color: label === "needs live proof" ? "#f97316" : label === "proven weak" ? "#7c3aed" : "#0f766e",
    })),
  });
  const runSvg = barSvg({
    title: "Provider requests staged",
    rows: [
      { label: "Priority packet", value: summary.priorityProviderRequests || 0, color: "#2563eb" },
      { label: "Full all-blog manifest", value: allBlogManifest.length, color: "#0f766e" },
    ],
  });

  const data = {
    verdict: closure.verdict || "not_complete",
    blocker: closure.blocker || (keyAvailable ? "Live retest prepared but not run." : "OPENROUTER_API_KEY is not set in the local shell."),
    keyAvailable,
    provenCount,
    needsLiveProofCount,
    integrityCovered,
    integrityTotal,
    integrityStatus,
    brokenMarkers,
    priorityRequests: summary.priorityProviderRequests || 0,
    priorityPrompts: summary.uniquePrompts || 0,
    fullRequests: allBlogManifest.length,
    fullPrompts: allBlogPrompts.length,
    gateRows,
    priorityCommand,
    fullCommand,
    statusSvg,
    runSvg,
    requirementTable: table(
      ["Requirement", "Status", "Remaining gate"],
      closureRows.map((row) => [row.requirement, row.status, row.remaining_gate]),
    ),
    gateTable: table(
      ["Requirement", "Status", "Remaining proof"],
      gateRows.map((row) => [row.requirement, row.status, row.remaining_gate]),
    ),
  };

  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(outDir, "status.svg"), statusSvg),
    writeFile(path.join(outDir, "run-requests.svg"), runSvg),
    writeFile(path.join(outDir, "REPORT.html"), renderHtml(data)),
    writeFile(path.join(outDir, "REPORT.md"), renderMarkdown(data)),
    writeFile(path.join(outDir, "completion-control-matrix.csv"), csv([
      ["requirement", "status", "bucket", "remaining_gate"],
      ...closureRows.map((row) => [row.requirement, row.status, statusBucket(row.status), row.remaining_gate]),
    ])),
    writeFile(path.join(outDir, "remaining-proof-gates.csv"), csv([
      ["requirement", "status", "remaining_gate"],
      ...gateRows.map((row) => [row.requirement, row.status, row.remaining_gate]),
    ])),
    writeFile(path.join(outDir, "credential-safe-run-commands.csv"), csv([
      ["run", "provider_requests", "prompts", "command"],
      ["priority", data.priorityRequests, data.priorityPrompts, priorityCommand],
      ["full_all_blog", data.fullRequests, data.fullPrompts, fullCommand],
    ])),
  ]);

  console.log(`Wrote ${path.join(outDir, "REPORT.html")}`);
  console.log(`Verdict: ${data.verdict}`);
  console.log(`Needs live proof: ${needsLiveProofCount}`);
  console.log(`OpenRouter key present: ${keyAvailable ? "yes" : "no"}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
