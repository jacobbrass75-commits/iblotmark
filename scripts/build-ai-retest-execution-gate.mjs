#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "retest-execution-gate");

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

function normalizeUrl(value) {
  return String(value ?? "")
    .trim()
    .replace(/^http:\/\//i, "https://")
    .replace(/\/+$/g, "")
    .toLowerCase();
}

function toNumber(value) {
  if (typeof value === "number") return value;
  const match = String(value ?? "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function short(value, length = 140) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniq(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row) || "unknown";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function countList(values) {
  const counts = new Map();
  for (const value of values.map((item) => String(item ?? "").trim()).filter(Boolean)) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function countSummary(values, limit = 8) {
  return countList(values)
    .slice(0, limit)
    .map(([value, count]) => `${value} ${count}`)
    .join("; ");
}

function manifestKey(row) {
  return [
    row.provider,
    row.prompt,
    normalizeUrl(row.page_url),
  ].join("|");
}

function batchFromWave(wave) {
  if (/^W1\b/i.test(wave)) return "R01";
  if (/^W2\b/i.test(wave)) return "R02";
  if (/^W3\b/i.test(wave)) return "R03";
  if (/^W4\b/i.test(wave)) return "R04";
  if (/^W5\b/i.test(wave)) return "R05";
  return "R00";
}

function statusForDecision(decision) {
  if (decision === "Consolidate first") return "blocked_by_survivor_merge";
  if (decision === "Rewrite or refresh") return "conditional_after_rewrite";
  if (decision === "Source cleanup first") return "conditional_after_source_cleanup";
  return "ready_after_mapped_edits";
}

function gateForDecision(decision) {
  if (decision === "Consolidate first") {
    return "Do not run yet. Confirm survivor URL, merge useful answer blocks and product modules, preserve benchmark prompts, then retest the survivor URL.";
  }
  if (decision === "Rewrite or refresh") {
    return "Run only after refreshed answer block, comparison language, product modules, FAQ/schema, and image alt proof are live.";
  }
  if (decision === "Source cleanup first") {
    return "Run only after schema, FAQ, quick answer, image alt text, product proof, and internal links are live.";
  }
  return "Run after mapped page edits are published.";
}

function commandForManifest(manifestPath) {
  return `AI_BENCHMARK_EXPANDED_LIMIT=0 \\\nAI_BENCHMARK_EXPANDED_MANIFEST=${manifestPath} \\\nnpx tsx scripts/run-expanded-openrouter-ai-benchmark.ts`;
}

function dryCommandForManifest(manifestPath) {
  return `AI_BENCHMARK_DRY_RUN=1 \\\nAI_BENCHMARK_EXPANDED_LIMIT=0 \\\nAI_BENCHMARK_EXPANDED_MANIFEST=${manifestPath} \\\nnpx tsx scripts/run-expanded-openrouter-ai-benchmark.ts`;
}

function barSvg({ title, rows, width = 920, rowHeight = 34, color = "#0f766e" }) {
  const chartRows = rows.slice(0, 12);
  const height = 78 + chartRows.length * rowHeight;
  const max = Math.max(1, ...chartRows.map((row) => row.value));
  const body = chartRows.map((row, index) => {
    const y = 58 + index * rowHeight;
    const barWidth = Math.round((row.value / max) * (width - 360));
    return `<g>
      <text x="22" y="${y + 17}" font-size="13" font-weight="800" fill="#111827">${escapeHtml(short(row.label, 40))}</text>
      <rect x="302" y="${y}" width="${width - 360}" height="21" rx="10" fill="#e5e7eb"/>
      <rect x="302" y="${y}" width="${barWidth}" height="21" rx="10" fill="${row.color || color}"/>
      <text x="${width - 24}" y="${y + 16}" font-size="13" font-weight="900" text-anchor="end" fill="#111827">${escapeHtml(row.value)}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#ffffff"/>
    <text x="22" y="34" font-size="20" font-weight="900" fill="#111827">${escapeHtml(title)}</text>
    ${body}
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

function link(url, label) {
  return url ? `<a href="${escapeHtml(url)}">${escapeHtml(label || url)}</a>` : "";
}

function renderHtml(data) {
  const gateRows = data.gateRows.map((row) => [
    row.decision,
    row.status,
    row.requests,
    row.pages,
    row.providers,
    row.waves,
    row.gate,
  ]);
  const unblockedRows = data.unblockedRows.map((row) => [
    row.retest_rank,
    row.status,
    row.provider,
    row.wave,
    row.category,
    row.prompt,
    link(row.page_url, row.closest_post),
    row.gate_before_running,
  ]);
  const commandRows = data.commandRows.map((row) => [
    row.name,
    row.status,
    row.requests,
    row.manifest,
    row.gate,
    row.command,
  ]);
  const blockedPageRows = data.blockedPageRows.slice(0, 18).map((row) => [
    row.rank,
    row.requests,
    link(row.page_url, row.page),
    row.providers,
    row.waves,
    short(row.prompts, 170),
    row.gate,
  ]);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT Retest Execution Gate</title>
  <style>
    body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1260px;margin:0 auto;padding:34px 24px 66px}
    h1{font-size:38px;line-height:1.1;margin:0 0 8px}
    h2{font-size:24px;margin:36px 0 12px}
    p,li{line-height:1.55;color:#334155;font-size:15px}
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
    a{color:#0f766e;overflow-wrap:anywhere}
    code,pre{background:#e2e8f0;border-radius:5px;padding:2px 5px}
    @media(max-width:980px){.cards,.grid{grid-template-columns:1fr}h1{font-size:31px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT Retest Execution Gate</h1>
  <p>This report separates what can be retested now from what must wait for survivor URL consolidation, source cleanup, or page refresh work.</p>

  <div class="note warn">
    <strong>Current gate:</strong> ${escapeHtml(data.summary.openrouter_key_present)} for secure <code>OPENROUTER_API_KEY</code> in this shell. No live provider run was executed by this report.
  </div>

  <section class="cards">
    ${card("Priority requests", data.summary.priority_requests, "Total rows in the priority retest map.")}
    ${card("Blocked", data.summary.blocked_requests, "Requests waiting for survivor URL consolidation.")}
    ${card("Conditional", data.summary.conditional_requests, "Requests that can run after refresh or source cleanup.")}
    ${card("Micro-run", data.summary.micro_run_requests, "Small gated manifest for the currently unblocked lane.")}
    ${card("Providers", data.summary.providers, "Provider families represented.")}
  </section>

  <section class="grid">
    <div class="chart"><img alt="Requests by gate status" src="requests-by-gate-status.svg"/></div>
    <div class="chart"><img alt="Unblocked requests by provider" src="unblocked-by-provider.svg"/></div>
  </section>

  <h2>Gate Summary</h2>
  ${renderTable(["Decision", "Status", "Requests", "Pages", "Providers", "Waves", "Gate"], gateRows)}

  <h2>Currently Smallest Safe Retest</h2>
  <p>These are the six rows not blocked by survivor URL decisions. They still require the listed page cleanup before live execution.</p>
  ${renderTable(["Rank", "Status", "Provider", "Wave", "Category", "Prompt", "Page", "Gate"], unblockedRows)}

  <h2>Run Commands</h2>
  <p>Use the dry-run command first. Do not run the full priority packet until the blocked consolidation rows are cleared.</p>
  ${renderTable(["Name", "Status", "Requests", "Manifest", "Gate", "Command"], commandRows)}

  <h2>Top Blocked Pages</h2>
  ${renderTable(["Rank", "Requests", "Page", "Providers", "Waves", "Prompts", "Gate"], blockedPageRows)}
</main>
</body>
</html>`;
}

function renderMarkdown(data) {
  return `# iBOLT Retest Execution Gate

## Summary

- Priority requests: ${data.summary.priority_requests}
- Blocked by survivor consolidation: ${data.summary.blocked_requests}
- Conditional after refresh/source cleanup: ${data.summary.conditional_requests}
- Smallest gated micro-run: ${data.summary.micro_run_requests}
- OPENROUTER_API_KEY present in this shell: ${data.summary.openrouter_key_present}

## Gate Summary

${data.gateRows.map((row) => `- ${row.decision}: ${row.requests} requests, ${row.status}. Gate: ${row.gate}`).join("\n")}

## Smallest Safe Retest

${data.unblockedRows.map((row) => `- ${row.provider}, ${row.wave}: ${row.prompt} -> ${row.closest_post}. Gate: ${row.gate_before_running}`).join("\n")}

## Generated Files

- unblocked-provider-manifest.csv
- unblocked-retest-queue.csv
- blocked-consolidation-retest-queue.csv
- gate-summary.csv
- run-command-gates.csv
- top-blocked-pages.csv
- retest-execution-gate-data.json
- requests-by-gate-status.svg
- unblocked-by-provider.svg
`;
}

async function main() {
  const retestRows = await readCsv("page-decision-retest-map/page-decision-retest-map.csv");
  const providerManifestRows = await readCsv("priority-retest-packet/priority-provider-request-manifest.csv");
  const commandRowsFromRunbook = await readCsv("next-benchmark-runbook/benchmark-run-commands.csv");

  const manifestByKey = new Map(providerManifestRows.map((row) => [manifestKey(row), row]));
  const enrichedRows = retestRows.map((row) => ({
    ...row,
    status: statusForDecision(row.decision),
    gate: gateForDecision(row.decision),
  }));
  const blockedRows = enrichedRows.filter((row) => row.status === "blocked_by_survivor_merge");
  const unblockedRows = enrichedRows.filter((row) => row.status !== "blocked_by_survivor_merge");
  const conditionalRows = unblockedRows;

  const unblockedManifestRows = unblockedRows.map((row) => {
    const matched = manifestByKey.get(manifestKey(row));
    if (matched) return matched;
    return {
      batch_id: batchFromWave(row.wave),
      provider: row.provider,
      prompt: row.prompt,
      category: row.category,
      source: "retest-execution-gate",
      priority: row.retest_score,
      closest_post: row.closest_post,
      page_url: row.page_url,
      prompt_type: row.prompt_type,
      refresh_state: row.decision,
      expected_metric: row.expected_metric,
    };
  });

  const gateRows = [...groupBy(enrichedRows, (row) => row.decision).entries()]
    .map(([decision, rows]) => ({
      decision,
      status: statusForDecision(decision),
      requests: rows.length,
      pages: uniq(rows.map((row) => row.page_url)).length,
      providers: countSummary(rows.map((row) => row.provider), 6),
      waves: countSummary(rows.map((row) => row.wave), 6),
      gate: gateForDecision(decision),
    }))
    .sort((a, b) => b.requests - a.requests);

  const blockedPageRows = [...groupBy(blockedRows, (row) => normalizeUrl(row.page_url)).entries()]
    .map(([, rows]) => ({
      rank: 0,
      requests: rows.length,
      page: rows[0]?.closest_post || "",
      page_url: rows[0]?.page_url || "",
      providers: countSummary(rows.map((row) => row.provider), 5),
      waves: countSummary(rows.map((row) => row.wave), 5),
      prompts: uniq(rows.map((row) => row.prompt)).join("; "),
      gate: rows[0]?.gate || "",
    }))
    .sort((a, b) => b.requests - a.requests || a.page.localeCompare(b.page));
  blockedPageRows.forEach((row, index) => {
    row.rank = index + 1;
  });

  const manifestPath = "content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/retest-execution-gate/unblocked-provider-manifest.csv";
  const commandRows = [
    {
      name: "Smallest conditional retest",
      status: "conditional_after_page_cleanup",
      requests: unblockedManifestRows.length,
      manifest: manifestPath,
      gate: "Run after the six source cleanup or refresh gates are live. This does not validate consolidation-heavy pages.",
      command: commandForManifest(manifestPath),
      dry_run: dryCommandForManifest(manifestPath),
    },
    ...commandRowsFromRunbook.map((row) => ({
      name: row.name,
      status: row.name === "All priority waves" ? "blocked_until_survivor_merge" : "partially_blocked",
      requests: row.requests,
      manifest: String(row.command || "").match(/AI_BENCHMARK_EXPANDED_MANIFEST=([^\\\n ]+)/)?.[1] || "",
      gate: row.name === "All priority waves"
        ? "Wait until survivor URL decisions clear the 198 consolidation-blocked requests."
        : "Use only after its rows are checked against the gate summary.",
      command: row.command,
      dry_run: row.dry_run,
    })),
  ];

  const summary = {
    generated_at: new Date().toISOString(),
    priority_requests: enrichedRows.length,
    blocked_requests: blockedRows.length,
    conditional_requests: conditionalRows.length,
    micro_run_requests: unblockedManifestRows.length,
    pages: uniq(enrichedRows.map((row) => row.page_url)).length,
    blocked_pages: uniq(blockedRows.map((row) => row.page_url)).length,
    conditional_pages: uniq(conditionalRows.map((row) => row.page_url)).length,
    providers: countSummary(enrichedRows.map((row) => row.provider), 8),
    waves: countSummary(enrichedRows.map((row) => row.wave), 8),
    openrouter_key_present: process.env.OPENROUTER_API_KEY ? "yes" : "no",
    live_run_status: process.env.OPENROUTER_API_KEY ? "ready_to_run_when_pages_are_live" : "waiting_for_secure_env_key",
  };

  const gateSvg = barSvg({
    title: "Requests by gate status",
    rows: [
      { label: "Blocked by survivor merge", value: blockedRows.length, color: "#ef4444" },
      { label: "Conditional after refresh/source cleanup", value: conditionalRows.length, color: "#f97316" },
    ],
  });
  const providerSvg = barSvg({
    title: "Unblocked conditional requests by provider",
    rows: countList(unblockedRows.map((row) => row.provider)).map(([label, value]) => ({ label, value, color: "#2563eb" })),
  });

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "unblocked-provider-manifest.csv"), csv([
    ["batch_id", "provider", "prompt", "category", "source", "priority", "closest_post", "page_url", "prompt_type", "refresh_state", "expected_metric"],
    ...unblockedManifestRows.map((row) => [
      row.batch_id,
      row.provider,
      row.prompt,
      row.category,
      row.source,
      row.priority,
      row.closest_post,
      row.page_url,
      row.prompt_type,
      row.refresh_state,
      row.expected_metric,
    ]),
  ]));
  await writeFile(path.join(outDir, "unblocked-retest-queue.csv"), csv([
    ["retest_rank", "status", "wave", "provider", "prompt", "category", "prompt_type", "page_url", "closest_post", "gate_before_running", "expected_metric"],
    ...unblockedRows.map((row) => [
      row.retest_rank,
      row.status,
      row.wave,
      row.provider,
      row.prompt,
      row.category,
      row.prompt_type,
      row.page_url,
      row.closest_post,
      row.gate_before_running || row.gate,
      row.expected_metric,
    ]),
  ]));
  await writeFile(path.join(outDir, "blocked-consolidation-retest-queue.csv"), csv([
    ["retest_rank", "wave", "provider", "prompt", "category", "prompt_type", "page_url", "closest_post", "survivor_gate", "expected_metric"],
    ...blockedRows.map((row) => [
      row.retest_rank,
      row.wave,
      row.provider,
      row.prompt,
      row.category,
      row.prompt_type,
      row.page_url,
      row.closest_post,
      row.gate_before_running || row.gate,
      row.expected_metric,
    ]),
  ]));
  await writeFile(path.join(outDir, "gate-summary.csv"), csv([
    ["decision", "status", "requests", "pages", "providers", "waves", "gate"],
    ...gateRows.map((row) => [row.decision, row.status, row.requests, row.pages, row.providers, row.waves, row.gate]),
  ]));
  await writeFile(path.join(outDir, "run-command-gates.csv"), csv([
    ["name", "status", "requests", "manifest", "gate", "command", "dry_run"],
    ...commandRows.map((row) => [row.name, row.status, row.requests, row.manifest, row.gate, row.command, row.dry_run]),
  ]));
  await writeFile(path.join(outDir, "top-blocked-pages.csv"), csv([
    ["rank", "requests", "page", "page_url", "providers", "waves", "prompts", "gate"],
    ...blockedPageRows.map((row) => [row.rank, row.requests, row.page, row.page_url, row.providers, row.waves, row.prompts, row.gate]),
  ]));
  await writeFile(path.join(outDir, "retest-execution-gate-data.json"), JSON.stringify({ summary, gateRows, unblockedRows, blockedPageRows, commandRows }, null, 2));
  await writeFile(path.join(outDir, "requests-by-gate-status.svg"), gateSvg);
  await writeFile(path.join(outDir, "unblocked-by-provider.svg"), providerSvg);
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml({ summary, gateRows, unblockedRows, blockedPageRows, commandRows }));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown({ summary, gateRows, unblockedRows, blockedPageRows, commandRows }));

  console.log(`Wrote ${outDir}`);
  console.log(`Priority requests: ${summary.priority_requests}`);
  console.log(`Blocked by survivor merge: ${summary.blocked_requests}`);
  console.log(`Conditional micro-run: ${summary.micro_run_requests}`);
  console.log(`OPENROUTER_API_KEY present: ${summary.openrouter_key_present}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
