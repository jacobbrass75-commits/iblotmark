#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "answer-review-packet");

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

function toNumber(value) {
  if (typeof value === "number") return value;
  const match = String(value ?? "").replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function normalize(value) {
  return String(value ?? "")
    .replace(/\biBolt\b/g, "iBOLT")
    .replace(/\bIbolt\b/g, "iBOLT")
    .replace(/\bIBOLT\b/g, "iBOLT")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value, length = 470) {
  const text = normalize(value);
  return text.length > length ? `${text.slice(0, length - 3).trim()}...` : text;
}

function splitList(value) {
  return normalize(value)
    .split(/[;,|]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/^\+\d+\s+more$/i.test(item));
}

function unique(values) {
  return [...new Set(values.map(normalize).filter(Boolean))];
}

function outcomeBucket(row) {
  const text = normalize(row.outcome).toLowerCase();
  if (text.includes("clean")) return "clean_iBOLT";
  if (text.includes("competitor")) return "competitor_replacement";
  if (text.includes("co")) return "co_mention";
  return "no_signal";
}

function groupCount(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function topBy(rows, key, count = 8) {
  return [...rows].sort((a, b) => toNumber(b[key]) - toNumber(a[key])).slice(0, count);
}

function barSvg({ title, rows, color = "#0f766e", width = 900 }) {
  const chartRows = rows.slice(0, 10);
  const rowHeight = 36;
  const height = 76 + chartRows.length * rowHeight;
  const max = Math.max(1, ...chartRows.map((row) => toNumber(row.value)));
  const bars = chartRows.map((row, index) => {
    const y = 58 + index * rowHeight;
    const barWidth = Math.max(3, Math.round((toNumber(row.value) / max) * (width - 360)));
    return `<g>
      <text x="22" y="${y + 17}" font-size="13" font-weight="900" fill="#111827">${escapeHtml(row.label.slice(0, 38))}</text>
      <rect x="285" y="${y}" width="${width - 360}" height="22" rx="11" fill="#e5e7eb"/>
      <rect x="285" y="${y}" width="${barWidth}" height="22" rx="11" fill="${row.color || color}"/>
      <text x="${width - 34}" y="${y + 16}" text-anchor="end" font-size="13" font-weight="900" fill="#111827">${escapeHtml(row.value)}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#ffffff"/>
    <text x="22" y="34" font-size="20" font-weight="900" fill="#111827">${escapeHtml(title)}</text>
    ${bars}
  </svg>`;
}

function card(label, value, note) {
  return `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`;
}

function table(headers, rows) {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table>${head}${body}</table>`;
}

function renderExamples(rows) {
  return rows.map((row) => `<article class="example ${row.bucket}">
    <div class="meta"><span>${escapeHtml(row.bucket.replace("_", " "))}</span><span>${escapeHtml(row.provider)}</span><span>${escapeHtml(row.category)}</span></div>
    <h3>${escapeHtml(row.query)}</h3>
    <blockquote>${escapeHtml(row.snippet)}</blockquote>
    ${row.competitors ? `<p><strong>Competitors:</strong> ${escapeHtml(row.competitors)}</p>` : ""}
    ${row.product_signals ? `<p><strong>Product signals:</strong> ${escapeHtml(row.product_signals)}</p>` : ""}
    <p><strong>Target page:</strong> <a href="${escapeHtml(row.page_url)}">${escapeHtml(row.page_title || row.page_url)}</a></p>
    <p><strong>Page language command:</strong> ${escapeHtml(row.language_command || row.next_action)}</p>
    <p><strong>Schema/citation action:</strong> ${escapeHtml(row.schema_command || row.citation_action || row.triage_action)}</p>
  </article>`).join("");
}

function renderHtml(data) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT AI Answer Review Packet</title>
  <style>
    body{margin:0;background:#f6f8fb;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1180px;margin:0 auto;padding:34px 24px 64px}
    h1{font-size:36px;line-height:1.1;margin:0 0 8px}
    h2{font-size:23px;margin:34px 0 12px}
    h3{font-size:17px;margin:8px 0 10px}
    p,li{line-height:1.55;color:#334155;font-size:15px}
    a{color:#0f766e;overflow-wrap:anywhere}
    .note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #0f766e;border-radius:12px;padding:16px 18px;margin:20px 0}
    .cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:22px 0}
    .card{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:15px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:900}
    .value{font-size:29px;font-weight:900;margin:8px 0;color:#0f172a}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
    .chart{background:#fff;border:1px solid #dbe3ef;border-radius:18px;padding:10px;overflow:auto}
    .chart svg{width:100%;height:auto;display:block}
    .examples{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    .example{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:16px}
    .example.clean_iBOLT{border-left:6px solid #0f766e}
    .example.co_mention{border-left:6px solid #2563eb}
    .example.competitor_replacement{border-left:6px solid #b91c1c}
    .meta{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
    .meta span{font-size:12px;font-weight:800;background:#e2e8f0;color:#334155;border-radius:999px;padding:4px 8px}
    blockquote{margin:12px 0;padding:12px 14px;background:#f1f5f9;border-left:4px solid #94a3b8;color:#1e293b;line-height:1.5}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 22px}
    th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    @media(max-width:980px){.cards,.grid,.examples{grid-template-columns:1fr}h1{font-size:30px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT AI Answer Review Packet</h1>
  <p>Concrete saved AI-answer snippets, grouped by outcome, with target page commands. Use this when explaining how iBOLT appears, who appears beside it, and where competitors replace it.</p>

  <section class="cards">
    ${card("Review examples", data.reviewRows.length, "Curated snippets with action commands.")}
    ${card("Clean mentions", data.cleanCount, "iBOLT appears without competitor crowding.")}
    ${card("Co-mentions", data.coMentionCount, "iBOLT appears beside competitors.")}
    ${card("Replacements", data.replacementCount, "Competitors appear without iBOLT.")}
  </section>

  <div class="note">
    <strong>Readout:</strong> iBOLT's best current answer examples come from direct iBOLT prompts. The highest-value work is turning competitor replacement answers into iBOLT-included answers, then top-3 recommendations.
  </div>

  <section class="grid">
    <div class="chart">${data.outcomeSvg}</div>
    <div class="chart">${data.competitorSvg}</div>
  </section>

  <h2>Review Examples</h2>
  <div class="examples">${renderExamples(data.reviewRows)}</div>

  <h2>Provider Outcome Summary</h2>
  ${data.providerTable}

  <h2>Competitor Replacement Shortlist</h2>
  ${data.competitorTable}

  <h2>Page Command Coverage</h2>
  ${data.pageTable}
</main>
</body>
</html>`;
}

function renderMarkdown(data) {
  return `# iBOLT AI Answer Review Packet

Concrete saved AI-answer snippets, grouped by outcome, with target page commands.

## Summary

- Review examples: ${data.reviewRows.length}
- Clean iBOLT mentions: ${data.cleanCount}
- Co-mentions: ${data.coMentionCount}
- Competitor replacements: ${data.replacementCount}

## Examples

${data.reviewRows.map((row) => `- ${row.bucket} | ${row.provider} | ${row.query} | competitors: ${row.competitors || "none"} | action: ${row.language_command || row.next_action}`).join("\n")}
`;
}

async function main() {
  const evidenceRows = await readCsv("answer-evidence-viewer/answer-evidence-ledger.csv");
  const pageCommands = await readCsv("answer-language-evidence/page-copy-citation-commands.csv");
  const commandsByUrl = new Map(pageCommands.map((row) => [normalize(row.url), row]));

  const enrichedRows = evidenceRows.map((row) => {
    const command = commandsByUrl.get(normalize(row.page_url)) || {};
    const bucket = outcomeBucket(row);
    return {
      bucket,
      priority: toNumber(row.priority),
      provider: normalize(row.provider),
      category: normalize(row.category),
      query: normalize(row.query),
      outcome: normalize(row.outcome),
      competitors: unique(splitList(row.competitors)).join("; "),
      product_signals: unique(splitList(row.product_signals)).join("; "),
      catalog_products: unique(splitList(row.catalog_products)).join("; "),
      positioning_signals: unique(splitList(row.positioning_signals)).join("; "),
      coverage_score: toNumber(row.coverage_score),
      page_title: normalize(row.page_title),
      page_url: normalize(row.page_url),
      triage_action: normalize(row.triage_action),
      recommended_action: normalize(row.recommended_action),
      next_action: normalize(row.next_action),
      snippet: compact(row.snippet, 520),
      answer_file: normalize(row.answer_file),
      language_command: normalize(command.language_command),
      schema_command: normalize(command.schema_command),
      citation_action: normalize(command.citation_action),
      primary_competitor: normalize(command.primary_competitor),
      top_fix: normalize(command.top_fix),
    };
  });

  const cleanRows = enrichedRows.filter((row) => row.bucket === "clean_iBOLT");
  const coRows = enrichedRows.filter((row) => row.bucket === "co_mention");
  const replacementRows = enrichedRows.filter((row) => row.bucket === "competitor_replacement");
  const reviewRows = [
    ...topBy(cleanRows, "coverage_score", 4),
    ...topBy(coRows, "coverage_score", 6),
    ...topBy(replacementRows, "priority", 10),
  ];

  const outcomeCounts = groupCount(enrichedRows, (row) => row.bucket).map((row) => ({
    ...row,
    color: row.label === "competitor_replacement" ? "#b91c1c" : row.label === "co_mention" ? "#2563eb" : "#0f766e",
  }));
  const competitorCounts = groupCount(
    replacementRows.flatMap((row) => splitList(row.competitors).map((competitor) => ({ competitor }))),
    (row) => row.competitor,
  );
  const providerRows = ["ChatGPT", "Claude", "Gemini"].map((provider) => {
    const rows = enrichedRows.filter((row) => row.provider === provider);
    return {
      provider,
      clean: rows.filter((row) => row.bucket === "clean_iBOLT").length,
      co: rows.filter((row) => row.bucket === "co_mention").length,
      replacement: rows.filter((row) => row.bucket === "competitor_replacement").length,
      noSignal: rows.filter((row) => row.bucket === "no_signal").length,
    };
  });
  const pageRows = groupCount(reviewRows, (row) => row.page_title || row.page_url);

  const data = {
    reviewRows,
    cleanCount: cleanRows.length,
    coMentionCount: coRows.length,
    replacementCount: replacementRows.length,
    outcomeSvg: barSvg({ title: "Answer outcomes", rows: outcomeCounts }),
    competitorSvg: barSvg({ title: "Competitors replacing iBOLT", rows: competitorCounts, color: "#b91c1c" }),
    providerTable: table(
      ["Provider", "Clean", "Co-mentioned", "Competitor replacement", "No signal"],
      providerRows.map((row) => [row.provider, row.clean, row.co, row.replacement, row.noSignal]),
    ),
    competitorTable: table(
      ["Competitor", "Replacement rows"],
      competitorCounts.slice(0, 12).map((row) => [row.label, row.value]),
    ),
    pageTable: table(
      ["Target page", "Examples in packet"],
      pageRows.slice(0, 12).map((row) => [row.label, row.value]),
    ),
  };

  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(outDir, "REPORT.html"), renderHtml(data)),
    writeFile(path.join(outDir, "REPORT.md"), renderMarkdown(data)),
    writeFile(path.join(outDir, "outcome-summary.svg"), data.outcomeSvg),
    writeFile(path.join(outDir, "competitor-summary.svg"), data.competitorSvg),
    writeFile(path.join(outDir, "answer-review-examples.csv"), csv([
      ["bucket", "priority", "provider", "category", "query", "competitors", "product_signals", "catalog_products", "coverage_score", "page_title", "page_url", "snippet", "language_command", "schema_command", "citation_action", "next_action", "answer_file"],
      ...reviewRows.map((row) => [row.bucket, row.priority, row.provider, row.category, row.query, row.competitors, row.product_signals, row.catalog_products, row.coverage_score, row.page_title, row.page_url, row.snippet, row.language_command, row.schema_command, row.citation_action, row.next_action, row.answer_file]),
    ])),
    writeFile(path.join(outDir, "answer-review-provider-summary.csv"), csv([
      ["provider", "clean_mentions", "co_mentions", "competitor_replacements", "no_signal"],
      ...providerRows.map((row) => [row.provider, row.clean, row.co, row.replacement, row.noSignal]),
    ])),
    writeFile(path.join(outDir, "answer-review-competitor-summary.csv"), csv([
      ["competitor", "replacement_rows"],
      ...competitorCounts.map((row) => [row.label, row.value]),
    ])),
  ]);

  console.log(`Wrote ${path.join(outDir, "REPORT.html")}`);
  console.log(`Review examples: ${reviewRows.length}`);
  console.log(`Clean/co/replacement: ${cleanRows.length}/${coRows.length}/${replacementRows.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
