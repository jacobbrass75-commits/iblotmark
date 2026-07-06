#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "page-decision-retest-map");

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

function countValues(rows, key) {
  const counts = new Map();
  for (const row of rows) {
    const value = row[key] || "unknown";
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function summarizeList(rows, key, limit = 8) {
  return countValues(rows, key)
    .slice(0, limit)
    .map(([value, count]) => `${value} ${count}`)
    .join("; ");
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

function readinessForDecision(decision) {
  if (decision === "Consolidate first") return "Not ready until survivor URL is confirmed and merged";
  if (decision === "Source cleanup first") return "Ready after schema, FAQ, quick answer, image alt, and product proof are live";
  if (decision === "Rewrite or refresh") return "Ready after refreshed answer block, product modules, comparison language, and FAQ/schema are live";
  if (decision === "Protect and amplify") return "Ready after preservation check and citation/source proof are live";
  if (decision === "CTA cleanup") return "Ready after repeated cart CTAs are reduced and product modules are stable";
  return "Ready after mapped page edits are live";
}

function actionGate(row) {
  const decision = row.decision || "";
  if (decision === "Consolidate first") {
    return "Confirm survivor, merge answer blocks and products, preserve prompts, then retest this URL or the survivor URL.";
  }
  if (decision === "Source cleanup first") {
    return "Add answer-first copy, FAQPage or Article schema, exact product modules, image alt text, and internal links before retest.";
  }
  if (decision === "Rewrite or refresh") {
    return "Refresh the page around the buyer query, then verify product names, comparison blocks, FAQ/schema, and CTA density before retest.";
  }
  if (decision === "Protect and amplify") {
    return "Keep page stable, add source-ready proof, then retest for citation and stronger top-3 positioning.";
  }
  return row.first_move || "Complete mapped edit commands before retest.";
}

function barSvg({ title, rows, width = 900, rowHeight = 34, color = "#0f766e" }) {
  const chartRows = rows.slice(0, 12);
  const height = 76 + chartRows.length * rowHeight;
  const max = Math.max(1, ...chartRows.map((row) => row.value));
  const body = chartRows.map((row, index) => {
    const y = 58 + index * rowHeight;
    const barWidth = Math.round((row.value / max) * (width - 350));
    return `<g>
      <text x="22" y="${y + 17}" font-size="13" font-weight="800" fill="#111827">${escapeHtml(short(row.label, 38))}</text>
      <rect x="292" y="${y}" width="${width - 350}" height="21" rx="10" fill="#e5e7eb"/>
      <rect x="292" y="${y}" width="${barWidth}" height="21" rx="10" fill="${row.color || color}"/>
      <text x="${width - 26}" y="${y + 16}" font-size="13" font-weight="900" text-anchor="end" fill="#111827">${escapeHtml(row.value)}</text>
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

function renderHtml(data) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT Page Decision Retest Map</title>
  <style>
    body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1240px;margin:0 auto;padding:34px 24px 66px}
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
    @media(max-width:980px){.cards,.grid{grid-template-columns:1fr}h1{font-size:31px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT Page Decision Retest Map</h1>
  <p>This joins the page decision map to the priority provider retest queue. It shows which exact prompts prove each decision lane worked after edits are live.</p>

  <div class="note warn">
    <strong>Important:</strong> this is a retest plan, not proof of lift. Pages in the consolidate lane are not ready for provider retesting until the survivor URL is confirmed, merged, and live.
  </div>

  <section class="cards">
    ${card("Priority requests", data.summary.priorityRequests, "Provider requests in the priority packet.")}
    ${card("Matched to decisions", data.summary.matchedRequests, "Requests linked to page decision rows.")}
    ${card("Pages with retests", data.summary.pagesWithRetests, "Unique URLs in the priority retest packet.")}
    ${card("Providers", data.summary.providers, "Provider families in the queue.")}
    ${card("Waves", data.summary.waves, "Retest waves represented.")}
  </section>

  <div class="grid">
    <div class="chart">${data.decisionSvg}</div>
    <div class="chart">${data.waveSvg}</div>
  </div>

  <h2>Decision Lane Retest Gates</h2>
  ${renderTable(["Decision", "Requests", "Pages", "Providers", "Waves", "Readiness", "Success Metric"], data.decisionRows.map((row) => [row.decision, row.requests, row.pages, row.providers, row.waves, row.readiness, row.success_metric]))}

  <h2>First 40 Page Retest Rows</h2>
  ${renderTable(["Rank", "Decision", "Wave", "Provider", "Prompt", "Page", "Gate Before Running", "Expected Metric"], data.firstRows.map((row) => [row.retest_rank, row.decision, row.wave, row.provider, row.prompt, row.closest_post, row.gate_before_running, row.expected_metric]))}

  <h2>Page-Level Retest Summary</h2>
  ${renderTable(["Page", "Decision", "Requests", "Providers", "Waves", "Prompts", "Gate"], data.pageRows.slice(0, 40).map((row) => [row.page, row.decision, row.requests, row.providers, row.waves, row.prompts, row.gate_before_running]))}
</main>
</body>
</html>`;
}

function renderMarkdown(data) {
  return `# iBOLT Page Decision Retest Map

This joins the page decision map to the priority provider retest queue.

## Summary

- Priority requests: ${data.summary.priorityRequests}
- Matched to page decisions: ${data.summary.matchedRequests}
- Pages with retests: ${data.summary.pagesWithRetests}
- Providers: ${data.summary.providers}
- Waves: ${data.summary.waves}

## Decision Lane Gates

${data.decisionRows.map((row) => `- ${row.decision}: ${row.requests} requests, ${row.pages} pages. Gate: ${row.readiness}`).join("\n")}
`;
}

async function main() {
  const decisionRows = await readCsv("page-decision-map/page-decision-map.csv");
  const requestRows = await readCsv("priority-retest-packet/priority-retest-request-queue.csv");
  const decisionByUrl = new Map(decisionRows.map((row) => [normalizeUrl(row.url), row]));

  const joinedRows = requestRows.map((request) => {
    const decision = decisionByUrl.get(normalizeUrl(request.page_url)) || {};
    return {
      retest_rank: request.retest_rank,
      wave: request.wave,
      provider: request.provider,
      prompt: request.prompt,
      category: request.category,
      prompt_type: request.prompt_type,
      retest_score: request.retest_score,
      page_url: request.page_url,
      closest_post: request.closest_post,
      decision: decision.decision || "No mapped decision",
      page_priority: decision.priority || "",
      owner: decision.owner || request.owner_sequence,
      category_decision: decision.category || request.category,
      why: decision.why || "",
      first_move: decision.first_move || request.prerequisite,
      gate_before_running: decision.decision ? actionGate(decision) : request.prerequisite,
      readiness: readinessForDecision(decision.decision || ""),
      competitors: request.competitors || decision.competitors || "",
      products_to_feature: request.products_to_feature || decision.products_to_feature || "",
      expected_metric: request.success_metric || decision.success_metric || "",
      matched: decision.decision ? "yes" : "no",
    };
  });

  const pageRows = [...groupBy(joinedRows, (row) => normalizeUrl(row.page_url)).entries()]
    .map(([, rows]) => {
      const first = rows[0] || {};
      const prompts = [...new Set(rows.map((row) => row.prompt).filter(Boolean))].slice(0, 8).join("; ");
      return {
        page: first.closest_post,
        url: first.page_url,
        decision: first.decision,
        requests: rows.length,
        providers: summarizeList(rows, "provider"),
        waves: summarizeList(rows, "wave"),
        prompts,
        gate_before_running: first.gate_before_running,
        expected_metric: first.expected_metric,
        priority: Math.max(...rows.map((row) => toNumber(row.retest_score))),
      };
    })
    .sort((a, b) => b.priority - a.priority || b.requests - a.requests || a.page.localeCompare(b.page));

  const decisionRowsSummary = [...groupBy(joinedRows, (row) => row.decision).entries()]
    .map(([decision, rows]) => ({
      decision,
      requests: rows.length,
      pages: new Set(rows.map((row) => normalizeUrl(row.page_url))).size,
      providers: summarizeList(rows, "provider"),
      waves: summarizeList(rows, "wave"),
      readiness: readinessForDecision(decision),
      success_metric: [...new Set(rows.map((row) => row.expected_metric).filter(Boolean))].slice(0, 3).join("; "),
    }))
    .sort((a, b) => b.requests - a.requests || a.decision.localeCompare(b.decision));

  const waveRows = [...groupBy(joinedRows, (row) => row.wave).entries()]
    .map(([wave, rows]) => ({
      wave,
      requests: rows.length,
      pages: new Set(rows.map((row) => normalizeUrl(row.page_url))).size,
      decisions: summarizeList(rows, "decision"),
      providers: summarizeList(rows, "provider"),
    }))
    .sort((a, b) => String(a.wave).localeCompare(String(b.wave)));

  const providerRows = [...groupBy(joinedRows, (row) => row.provider).entries()]
    .map(([provider, rows]) => ({
      provider,
      requests: rows.length,
      pages: new Set(rows.map((row) => normalizeUrl(row.page_url))).size,
      decisions: summarizeList(rows, "decision"),
      waves: summarizeList(rows, "wave"),
    }))
    .sort((a, b) => b.requests - a.requests || a.provider.localeCompare(b.provider));

  const summary = {
    generated_at: new Date().toISOString(),
    benchmark_dir: benchmarkDir,
    priorityRequests: joinedRows.length,
    matchedRequests: joinedRows.filter((row) => row.matched === "yes").length,
    pagesWithRetests: pageRows.length,
    providers: new Set(joinedRows.map((row) => row.provider)).size,
    waves: new Set(joinedRows.map((row) => row.wave)).size,
    consolidateRequests: joinedRows.filter((row) => row.decision === "Consolidate first").length,
    sourceCleanupRequests: joinedRows.filter((row) => row.decision === "Source cleanup first").length,
    rewriteRequests: joinedRows.filter((row) => row.decision === "Rewrite or refresh").length,
    protectRequests: joinedRows.filter((row) => row.decision === "Protect and amplify").length,
  };

  const data = {
    summary,
    firstRows: joinedRows.slice(0, 40),
    pageRows,
    decisionRows: decisionRowsSummary,
    waveRows,
    providerRows,
    decisionSvg: barSvg({
      title: "Priority Requests By Decision Lane",
      rows: decisionRowsSummary.map((row) => ({ label: row.decision, value: row.requests })),
    }),
    waveSvg: barSvg({
      title: "Priority Requests By Wave",
      rows: waveRows.map((row) => ({ label: row.wave, value: row.requests })),
      color: "#2563eb",
    }),
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml(data));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown(data));
  await writeFile(path.join(outDir, "page-decision-retest-data.json"), JSON.stringify(data, null, 2));
  await writeFile(path.join(outDir, "page-decision-retest-map.csv"), csv([
    ["retest_rank", "wave", "provider", "prompt", "category", "prompt_type", "retest_score", "page_url", "closest_post", "decision", "page_priority", "owner", "why", "first_move", "gate_before_running", "readiness", "competitors", "products_to_feature", "expected_metric", "matched"],
    ...joinedRows.map((row) => [row.retest_rank, row.wave, row.provider, row.prompt, row.category, row.prompt_type, row.retest_score, row.page_url, row.closest_post, row.decision, row.page_priority, row.owner, row.why, row.first_move, row.gate_before_running, row.readiness, row.competitors, row.products_to_feature, row.expected_metric, row.matched]),
  ]));
  await writeFile(path.join(outDir, "decision-lane-retest-gates.csv"), csv([
    ["decision", "requests", "pages", "providers", "waves", "readiness", "success_metric"],
    ...decisionRowsSummary.map((row) => [row.decision, row.requests, row.pages, row.providers, row.waves, row.readiness, row.success_metric]),
  ]));
  await writeFile(path.join(outDir, "page-level-retest-summary.csv"), csv([
    ["page", "url", "decision", "requests", "providers", "waves", "prompts", "gate_before_running", "expected_metric"],
    ...pageRows.map((row) => [row.page, row.url, row.decision, row.requests, row.providers, row.waves, row.prompts, row.gate_before_running, row.expected_metric]),
  ]));
  await writeFile(path.join(outDir, "wave-retest-decision-summary.csv"), csv([
    ["wave", "requests", "pages", "decisions", "providers"],
    ...waveRows.map((row) => [row.wave, row.requests, row.pages, row.decisions, row.providers]),
  ]));
  await writeFile(path.join(outDir, "provider-retest-decision-summary.csv"), csv([
    ["provider", "requests", "pages", "decisions", "waves"],
    ...providerRows.map((row) => [row.provider, row.requests, row.pages, row.decisions, row.waves]),
  ]));
  await writeFile(path.join(outDir, "decision-retest-requests.svg"), data.decisionSvg);
  await writeFile(path.join(outDir, "wave-retest-requests.svg"), data.waveSvg);

  console.log(`Wrote ${outDir}`);
  console.log(`Priority requests: ${summary.priorityRequests}`);
  console.log(`Matched requests: ${summary.matchedRequests}`);
  console.log(`Pages with retests: ${summary.pagesWithRetests}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
