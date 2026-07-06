import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const BENCHMARK_DIR = "content-output/openrouter-ai-benchmark-2026-06-17-17-11-06";

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
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    if (row.some((value) => value !== "")) rows.push(row);
  }

  const [headers = [], ...body] = rows;
  return body.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

async function readCsv(filePath) {
  return parseCsv(await readFile(filePath, "utf8"));
}

function bool(value) {
  return String(value || "").toLowerCase() === "true";
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function splitList(value) {
  return String(value || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function key(provider, query) {
  return `${String(provider || "").toLowerCase()}::${String(query || "").toLowerCase()}`;
}

function queryKey(query) {
  return String(query || "").toLowerCase();
}

function providerLabel(provider) {
  const normalized = String(provider || "").toLowerCase();
  if (normalized.includes("chatgpt")) return "ChatGPT";
  if (normalized.includes("gemini")) return "Gemini";
  if (normalized.includes("claude")) return "Claude";
  return provider || "Unknown";
}

function classify(row) {
  const brandMentioned = bool(row.brand_mentioned);
  const competitors = splitList(row.raw_competitors || row.stored_competitors);
  if (brandMentioned && competitors.length) return "co-mentioned";
  if (brandMentioned) return "clean iBOLT mention";
  if (competitors.length) return "competitor replacement";
  return "no usable brand signal";
}

function actionForOutcome(outcome, mapped) {
  if (outcome === "clean iBOLT mention") return "Protect and amplify. Add citations, product proof, and source links so the answer can cite iBOLT.";
  if (outcome === "co-mentioned") return "Move iBOLT from comparison-set mention to specialist recommendation with clearer tradeoff copy.";
  if (outcome === "competitor replacement") return mapped?.recommended_action || "Add comparison, quick-answer, FAQ/schema, and product entity blocks for this prompt.";
  return "Create or strengthen a mapped page before retesting this prompt.";
}

function truncate(value, length = 360) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= length) return text;
  return `${text.slice(0, length - 3)}...`;
}

function ranked(map, limit = 10) {
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function barSvg({ title, subtitle, rows, width = 920, height = 420, color = "#2563eb" }) {
  const margin = { top: 72, right: 44, bottom: 34, left: 250 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(...rows.map((row) => row.value), 1);
  const rowHeight = chartHeight / Math.max(rows.length, 1);
  const bars = rows.map((row, index) => {
    const y = margin.top + index * rowHeight + 6;
    const height = Math.max(12, rowHeight - 12);
    const barWidth = Math.round((row.value / maxValue) * chartWidth);
    return `
      <text x="${margin.left - 12}" y="${y + height / 2 + 5}" text-anchor="end" font-size="14" fill="#334155">${escapeHtml(row.name)}</text>
      <rect x="${margin.left}" y="${y}" width="${barWidth}" height="${height}" rx="5" fill="${color}"/>
      <text x="${margin.left + barWidth + 10}" y="${y + height / 2 + 5}" font-size="14" font-weight="800" fill="#0f172a">${row.value}</text>
    `;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#fff"/>
  <text x="28" y="34" font-size="24" font-weight="900" fill="#0f172a">${escapeHtml(title)}</text>
  <text x="28" y="58" font-size="14" fill="#64748b">${escapeHtml(subtitle)}</text>
  ${bars}
</svg>`;
}

function stackedProviderSvg(providerRows) {
  const width = 920;
  const height = 340;
  const outcomes = [
    ["clean iBOLT mention", "#16a34a"],
    ["co-mentioned", "#84cc16"],
    ["competitor replacement", "#dc2626"],
    ["no usable brand signal", "#94a3b8"],
  ];
  const maxTotal = Math.max(...providerRows.map((row) => row.total), 1);
  const barWidth = 620;
  const rows = providerRows.map((row, index) => {
    const y = 92 + index * 72;
    let x = 230;
    const segments = outcomes.map(([outcome, color]) => {
      const value = row[outcome] || 0;
      const widthForValue = Math.round((value / maxTotal) * barWidth);
      const segment = `<rect x="${x}" y="${y}" width="${widthForValue}" height="30" rx="4" fill="${color}"><title>${escapeHtml(outcome)}: ${value}</title></rect>`;
      x += widthForValue;
      return segment;
    }).join("");
    return `
      <text x="205" y="${y + 21}" text-anchor="end" font-size="16" font-weight="800" fill="#0f172a">${escapeHtml(row.provider)}</text>
      ${segments}
      <text x="870" y="${y + 21}" font-size="14" fill="#475569">${row.total} answers</text>
    `;
  }).join("");
  const legend = outcomes.map(([outcome, color], index) => {
    const x = 28 + index * 205;
    return `<rect x="${x}" y="292" width="14" height="14" rx="3" fill="${color}"/><text x="${x + 20}" y="304" font-size="12" fill="#475569">${escapeHtml(outcome)}</text>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#fff"/>
  <text x="28" y="34" font-size="24" font-weight="900" fill="#0f172a">Provider Outcome Mix</text>
  <text x="28" y="58" font-size="14" fill="#64748b">How each model handles iBOLT across the current benchmark.</text>
  ${rows}
  ${legend}
</svg>`;
}

function buildHtml({ summary, providerRows, topCompetitors, topLosses, evidenceRows }) {
  const cards = [
    ["Answers reviewed", summary.totalAnswers, "one row per provider and prompt"],
    ["Clean iBOLT mentions", summary.cleanMentions, "iBOLT without competitor crowding"],
    ["Co-mentions", summary.coMentions, "iBOLT appears with competitors"],
    ["Competitor replacements", summary.competitorReplacements, "competitors recommended instead"],
    ["No-signal answers", summary.noSignal, "no strong brand evidence"],
    ["Mapped pages", summary.mappedPages, "answers joined to page actions"],
  ].map(([label, value, note]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");

  const lossItems = topLosses.map((row) => `<li><strong>${escapeHtml(row.query)}</strong>, ${escapeHtml(row.provider)}, ${escapeHtml(row.category)}, competitors: ${escapeHtml(row.competitors || "none")}</li>`).join("");
  const competitorItems = topCompetitors.map((row) => `<li><strong>${escapeHtml(row.name)}</strong>, ${row.value} answer rows</li>`).join("");
  const providerTable = providerRows.map((row) => `<tr><td>${escapeHtml(row.provider)}</td><td>${row.total}</td><td>${row["clean iBOLT mention"] || 0}</td><td>${row["co-mentioned"] || 0}</td><td>${row["competitor replacement"] || 0}</td><td>${row["no usable brand signal"] || 0}</td></tr>`).join("");
  const tableRows = evidenceRows.slice(0, 60).map((row) => `<tr>
    <td>${escapeHtml(row.provider)}</td>
    <td>${escapeHtml(row.category)}</td>
    <td>${escapeHtml(row.query)}</td>
    <td>${escapeHtml(row.outcome)}</td>
    <td>${escapeHtml(row.competitors)}</td>
    <td>${escapeHtml(row.page_title)}</td>
    <td>${escapeHtml(row.next_action)}</td>
    <td>${escapeHtml(row.snippet)}</td>
  </tr>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT AI Answer Evidence Viewer</title>
  <style>
    body{margin:0;background:#f8fafc;color:#0f172a;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1240px;margin:0 auto;padding:34px 24px 70px}
    h1{font-size:36px;margin:0 0 8px}
    h2{font-size:22px;margin:34px 0 12px}
    p,li{color:#334155;line-height:1.55}
    .cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:24px 0}
    .card{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:800}
    .value{font-size:32px;font-weight:900;margin-top:8px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
    .panel{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:18px}
    img{max-width:100%;height:auto;background:#fff;border:1px solid #d7dee8;border-radius:12px;margin:12px 0}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden}
    th,td{text-align:left;vertical-align:top;padding:10px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:12px;letter-spacing:.04em}
    @media(max-width:900px){.cards,.grid{grid-template-columns:1fr}}
  </style>
</head>
<body><main>
  <h1>iBOLT AI Answer Evidence Viewer</h1>
  <p>This report drills into the actual prompt/provider rows behind the AI visibility benchmark. Use it to see how iBOLT is mentioned, who surrounds or replaces iBOLT, and which page action each answer should drive.</p>
  <section class="cards">${cards}</section>
  <img src="provider-outcome-mix.svg" alt="Provider outcome mix"/>
  <div class="grid">
    <div class="panel"><h2>Top Replacement Competitors</h2><ul>${competitorItems}</ul></div>
    <div class="panel"><h2>Highest Priority Losses</h2><ol>${lossItems}</ol></div>
  </div>
  <h2>Charts</h2>
  <img src="competitor-replacements.svg" alt="Competitor replacement chart"/>
  <h2>Provider Summary</h2>
  <table><thead><tr><th>Provider</th><th>Total</th><th>Clean iBOLT</th><th>Co-mentioned</th><th>Competitor replacement</th><th>No signal</th></tr></thead><tbody>${providerTable}</tbody></table>
  <h2>Answer Evidence Ledger, Top 60 Priority Rows</h2>
  <table><thead><tr><th>Provider</th><th>Category</th><th>Prompt</th><th>Outcome</th><th>Competitors</th><th>Mapped page</th><th>Next action</th><th>Snippet</th></tr></thead><tbody>${tableRows}</tbody></table>
</main></body></html>`;
}

async function main() {
  const benchmarkDir = path.join(process.cwd(), BENCHMARK_DIR);
  const outDir = path.join(benchmarkDir, "answer-evidence-viewer");
  await mkdir(outDir, { recursive: true });

  const answerRows = await readCsv(path.join(benchmarkDir, "answer-evidence-pack", "answer-evidence.csv"));
  const lostRows = await readCsv(path.join(benchmarkDir, "answer-context-dossier", "lost-answer-language.csv"));
  const queryPageRows = await readCsv(path.join(benchmarkDir, "query-page-matrix", "all-query-page-matrix.csv"));

  const lostByAnswer = new Map(lostRows.map((row) => [key(row.provider, row.query), row]));
  const pageByQuery = new Map(queryPageRows.map((row) => [queryKey(row.query), row]));

  const evidenceRows = answerRows.map((row) => {
    const outcome = classify(row);
    const provider = providerLabel(row.provider);
    const competitors = splitList(row.raw_competitors || row.stored_competitors).join("; ");
    const mapped = pageByQuery.get(queryKey(row.query));
    const lost = lostByAnswer.get(key(provider, row.query));
    const snippet = row.brand_excerpt || lost?.competitor_snippet || "";
    const priority = (
      (outcome === "competitor replacement" ? 70 : 0) +
      (outcome === "co-mentioned" ? 35 : 0) +
      (outcome === "no usable brand signal" ? 45 : 0) +
      Math.max(0, 70 - number(row.coverage_score)) +
      (number(mapped?.opportunity_score) || 0)
    );
    return {
      provider,
      query: row.query,
      category: row.category,
      coverage_score: number(row.coverage_score),
      top_pick_rank: row.top_pick_rank,
      outcome,
      competitors,
      product_signals: row.product_signals,
      catalog_products: row.catalog_product_names,
      positioning_signals: row.positioning_signals,
      source_url_count: row.source_url_count,
      page_title: mapped?.page_title || "",
      page_url: mapped?.page_url || "",
      triage_action: mapped?.triage_action || "",
      recommended_action: mapped?.recommended_action || "",
      next_action: actionForOutcome(outcome, mapped),
      snippet: truncate(snippet),
      answer_file: row.answer_file,
      priority,
    };
  }).sort((a, b) => b.priority - a.priority || a.query.localeCompare(b.query));

  const outcomes = new Map();
  const providerMap = new Map();
  const competitorMap = new Map();
  let mappedPages = 0;

  for (const row of evidenceRows) {
    outcomes.set(row.outcome, (outcomes.get(row.outcome) || 0) + 1);
    if (row.page_url) mappedPages += 1;
    if (!providerMap.has(row.provider)) {
      providerMap.set(row.provider, { provider: row.provider, total: 0 });
    }
    const providerRow = providerMap.get(row.provider);
    providerRow.total += 1;
    providerRow[row.outcome] = (providerRow[row.outcome] || 0) + 1;
    for (const competitor of splitList(row.competitors)) {
      competitorMap.set(competitor, (competitorMap.get(competitor) || 0) + 1);
    }
  }

  const summary = {
    benchmarkDir,
    totalAnswers: evidenceRows.length,
    cleanMentions: outcomes.get("clean iBOLT mention") || 0,
    coMentions: outcomes.get("co-mentioned") || 0,
    competitorReplacements: outcomes.get("competitor replacement") || 0,
    noSignal: outcomes.get("no usable brand signal") || 0,
    mappedPages,
    mentionRows: (outcomes.get("clean iBOLT mention") || 0) + (outcomes.get("co-mentioned") || 0),
    priorityRows: evidenceRows.filter((row) => row.priority >= 120).length,
  };

  const providerRows = [...providerMap.values()].sort((a, b) => a.provider.localeCompare(b.provider));
  const topCompetitors = ranked(competitorMap, 12);
  const topLosses = evidenceRows
    .filter((row) => row.outcome === "competitor replacement" || row.outcome === "no usable brand signal")
    .slice(0, 12);

  await writeFile(path.join(outDir, "answer-evidence-viewer-data.json"), JSON.stringify({ summary, providerRows, topCompetitors, topLosses, evidenceRows }, null, 2));
  await writeFile(path.join(outDir, "answer-evidence-ledger.csv"), toCsv([
    ["priority", "provider", "category", "query", "coverage_score", "top_pick_rank", "outcome", "competitors", "product_signals", "catalog_products", "positioning_signals", "source_url_count", "page_title", "page_url", "triage_action", "recommended_action", "next_action", "snippet", "answer_file"],
    ...evidenceRows.map((row) => [row.priority, row.provider, row.category, row.query, row.coverage_score, row.top_pick_rank, row.outcome, row.competitors, row.product_signals, row.catalog_products, row.positioning_signals, row.source_url_count, row.page_title, row.page_url, row.triage_action, row.recommended_action, row.next_action, row.snippet, row.answer_file]),
  ]));
  await writeFile(path.join(outDir, "provider-outcome-summary.csv"), toCsv([
    ["provider", "total", "clean_ibolt_mentions", "co_mentions", "competitor_replacements", "no_signal"],
    ...providerRows.map((row) => [row.provider, row.total, row["clean iBOLT mention"] || 0, row["co-mentioned"] || 0, row["competitor replacement"] || 0, row["no usable brand signal"] || 0]),
  ]));
  await writeFile(path.join(outDir, "competitor-replacement-summary.csv"), toCsv([
    ["competitor", "answer_rows"],
    ...topCompetitors.map((row) => [row.name, row.value]),
  ]));
  await writeFile(path.join(outDir, "provider-outcome-mix.svg"), stackedProviderSvg(providerRows));
  await writeFile(path.join(outDir, "competitor-replacements.svg"), barSvg({
    title: "Competitors Appearing In Replacement Or Co-Mention Answers",
    subtitle: "Counted from answer-level competitor detections across ChatGPT, Gemini, and Claude.",
    rows: topCompetitors.slice(0, 10),
    color: "#dc2626",
  }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({ summary, providerRows, topCompetitors, topLosses, evidenceRows }));

  console.log(`Wrote ${outDir}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
