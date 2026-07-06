#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "answer-examples-report");

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
  return rows.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

function csv(rows) {
  return rows
    .map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\n") + "\n";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function compactText(value, limit = 360) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

function number(value) {
  const match = String(value ?? "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function parseBrandCount(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(.*?)(?::)?\s+(\d+)(?:\s.*)?$/);
  return {
    brand: match ? match[1].trim() : text,
    count: match ? Number(match[2]) : 0,
  };
}

function pickRows(rows, limit, sortKey = "coverage_score") {
  return [...rows]
    .sort((a, b) => number(b[sortKey]) - number(a[sortKey]))
    .slice(0, limit);
}

function renderCards(rows, type) {
  if (!rows.length) return "<p>No examples found.</p>";
  return rows.map((row) => {
    const competitors = row.competitors ? `<p><strong>Competitors in answer:</strong> ${escapeHtml(row.competitors)}</p>` : "";
    const products = row.catalog_products ? `<p><strong>Catalog products:</strong> ${escapeHtml(row.catalog_products)}</p>` : "";
    const rank = row.top_pick_rank ? `<span>Rank ${escapeHtml(row.top_pick_rank)}</span>` : "";
    const page = row.target_page || row.mapped_page || "";
    return `<article class="example ${type}">
      <div class="meta"><span>${escapeHtml(row.provider)}</span><span>${escapeHtml(row.category)}</span>${rank}</div>
      <h3>${escapeHtml(row.query)}</h3>
      <blockquote>${escapeHtml(compactText(row.snippet, 520))}</blockquote>
      ${competitors}
      ${products}
      <p><strong>What to do:</strong> ${escapeHtml(row.next_action || row.recommended_action || "Retest after page updates.")}</p>
      ${page ? `<p><a href="${escapeHtml(page)}">${escapeHtml(page)}</a></p>` : ""}
    </article>`;
  }).join("");
}

function renderTable(headers, rows) {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table>${head}${body}</table>`;
}

function renderHtml({
  summary,
  cleanRows,
  coMentionRows,
  replacementRows,
  providerRows,
  categoryRows,
  battlecardRows,
  competitorRows,
}) {
  const providerTable = renderTable(
    ["Provider", "Clean", "Co-mentions", "Competitor replacements", "No signal"],
    providerRows.map((row) => [row.provider, row.clean_ibolt_mentions, row.co_mentions, row.competitor_replacements, row.no_signal]),
  );
  const categoryTable = renderTable(
    ["Category", "Mention rate", "Top-3 rate", "Competitor-only", "Top competitors"],
    categoryRows.map((row) => [row.category, `${row.mention_rate}%`, `${row.top3_rate}%`, `${row.competitor_only_rate}%`, row.top_competitors]).slice(0, 8),
  );
  const battlecardTable = renderTable(
    ["Brand", "Role", "Lost answers", "Co-mentions", "Counter-positioning"],
    battlecardRows.map((row) => [row.brand, row.role, row.lost_answers, row.co_mention_wins, row.counter_positioning]).slice(0, 10),
  );
  const competitorTable = renderTable(
    ["Competitor", "Replacement rows"],
    competitorRows.map((row) => [row.brand, row.count]).slice(0, 10),
  );

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT AI Answer Examples</title>
  <style>
    body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1180px;margin:0 auto;padding:34px 24px 64px}
    h1{font-size:36px;margin:0 0 8px}
    h2{font-size:24px;margin:36px 0 14px}
    h3{font-size:17px;margin:8px 0 10px}
    p,li{font-size:15px;line-height:1.55;color:#334155}
    .note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #0f766e;border-radius:12px;padding:16px 18px;margin:20px 0}
    .cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:22px 0}
    .metric{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:16px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:800}
    .value{font-size:30px;font-weight:900;margin-top:8px;color:#0f172a}
    .examples{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
    .example{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:16px}
    .example.clean{border-left:6px solid #0f766e}.example.co{border-left:6px solid #2563eb}.example.replace{border-left:6px solid #b91c1c}
    .meta{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
    .meta span{font-size:12px;font-weight:800;background:#e2e8f0;color:#334155;border-radius:999px;padding:4px 8px}
    blockquote{margin:12px 0;padding:12px 14px;background:#f1f5f9;border-left:4px solid #94a3b8;color:#1e293b;line-height:1.5}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 24px}
    th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    a{color:#0f766e;overflow-wrap:anywhere}
    @media(max-width:900px){.cards,.examples{grid-template-columns:1fr}h1{font-size:30px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT AI Answer Examples</h1>
  <p>This report shows concrete saved AI-answer examples behind the benchmark rates: when iBOLT wins, when it appears beside competitors, and when competitors replace it.</p>
  <section class="cards">
    <div class="metric"><div class="label">Total answers</div><div class="value">${summary.totalAnswers}</div></div>
    <div class="metric"><div class="label">Clean iBOLT mentions</div><div class="value">${summary.cleanMentions}</div></div>
    <div class="metric"><div class="label">Co-mentions</div><div class="value">${summary.coMentions}</div></div>
    <div class="metric"><div class="label">Competitor replacements</div><div class="value">${summary.competitorReplacements}</div></div>
  </section>
  <div class="note"><strong>Readout:</strong> iBOLT's strongest current answers are direct iBOLT or comparison prompts. Broad buyer prompts still often default to RAM Mounts, Arkon, iOttie, CTA Digital, ProClip, Mount-It, Havis, and related category defaults. The content move is to put iBOLT in those same comparison sets with exact products, use-case proof, and source-ready schema.</div>

  <h2>Clean iBOLT Mentions</h2>
  <div class="examples">${renderCards(cleanRows, "clean")}</div>

  <h2>iBOLT Mentioned Next To Competitors</h2>
  <div class="examples">${renderCards(coMentionRows, "co")}</div>

  <h2>Competitor Replacements</h2>
  <div class="examples">${renderCards(replacementRows, "replace")}</div>

  <h2>Provider Behavior</h2>
  ${providerTable}

  <h2>Category Behavior</h2>
  ${categoryTable}

  <h2>Who We Compare Against</h2>
  ${competitorTable}

  <h2>Competitor Battlecards</h2>
  ${battlecardTable}

  <h2>What This Means</h2>
  <ul>
    <li><strong>Best current visibility:</strong> direct iBOLT prompts and direct comparison prompts.</li>
    <li><strong>Biggest gap:</strong> generic buyer prompts where the model recommends competitors and never names iBOLT.</li>
    <li><strong>Best on-site fix:</strong> query-exact answer blocks, fair comparison sections, exact iBOLT product cards, FAQ schema, and product proof near the top of priority pages.</li>
    <li><strong>Best off-site fix:</strong> get iBOLT mentioned on third-party pages in the same competitor/category context where RAM Mounts, Arkon, iOttie, ProClip, and CTA Digital already appear.</li>
  </ul>
</main>
</body>
</html>`;
}

function renderMarkdown({
  summary,
  cleanRows,
  coMentionRows,
  replacementRows,
  providerRows,
  categoryRows,
  battlecardRows,
  competitorRows,
}) {
  const formatExamples = (rows) => rows.map((row, index) => {
    const competitors = row.competitors ? ` Competitors: ${row.competitors}.` : "";
    return `${index + 1}. ${row.provider}, ${row.category}, "${row.query}".${competitors} Snippet: ${compactText(row.snippet, 240)} Next: ${row.next_action || row.recommended_action || "Retest after page updates."}`;
  }).join("\n");

  return `# iBOLT AI Answer Examples

## Summary

- Total answers: ${summary.totalAnswers}
- Clean iBOLT mentions: ${summary.cleanMentions}
- Co-mentions: ${summary.coMentions}
- Competitor replacements: ${summary.competitorReplacements}
- Citation rows: ${summary.citationRows}

## Clean iBOLT Mentions

${formatExamples(cleanRows)}

## iBOLT Mentioned Next To Competitors

${formatExamples(coMentionRows)}

## Competitor Replacements

${formatExamples(replacementRows)}

## Provider Behavior

${providerRows.map((row) => `- ${row.provider}: ${row.clean_ibolt_mentions} clean, ${row.co_mentions} co-mentions, ${row.competitor_replacements} competitor replacements.`).join("\n")}

## Category Behavior

${categoryRows.slice(0, 8).map((row) => `- ${row.category}: ${row.mention_rate}% mention, ${row.top3_rate}% top-3, ${row.competitor_only_rate}% competitor-only. Top competitors: ${row.top_competitors}`).join("\n")}

## Top Competitor Pressure

${competitorRows.slice(0, 10).map((row, index) => `${index + 1}. ${row.brand}: ${row.count}`).join("\n")}

## Battlecard Summary

${battlecardRows.slice(0, 8).map((row) => `- ${row.brand}: ${row.role}. Counter-positioning: ${row.counter_positioning}`).join("\n")}
`;
}

async function main() {
  const clean = await readCsv("answer-snippet-evidence-appendix/clean-mention-snippets.csv");
  const co = await readCsv("answer-snippet-evidence-appendix/co-mention-snippets.csv");
  const replacements = await readCsv("answer-snippet-evidence-appendix/competitor-replacement-snippets.csv");
  const providerRows = await readCsv("answer-evidence-viewer/provider-outcome-summary.csv");
  const categoryRows = await readCsv("answer-outcome-taxonomy/category-outcome-summary.csv");
  const battlecardRows = await readCsv("competitor-battlecard-control-report/competitor-battlecards.csv");
  const coMentionData = await readJson("co-mention-network/co-mention-network-data.json", { summary: {} });
  const snippetData = await readJson("answer-snippet-evidence-appendix/answer-snippet-evidence-data.json", { summary: {} });

  const summary = {
    totalAnswers: snippetData.summary?.totalAnswers || coMentionData.summary?.totalAnswers || 93,
    cleanMentions: snippetData.summary?.cleanMentions || coMentionData.summary?.cleanMentionRows || clean.length,
    coMentions: snippetData.summary?.coMentions || coMentionData.summary?.coMentionRows || co.length,
    competitorReplacements: snippetData.summary?.competitorReplacements || replacements.length,
    citationRows: snippetData.summary?.citationRows || 0,
  };
  const competitorRows = (coMentionData.summary?.topReplacementCompetitors || [])
    .map(parseBrandCount)
    .filter((row) => row.brand)
    .sort((a, b) => b.count - a.count);

  const cleanRows = pickRows(clean, 4);
  const coMentionRows = pickRows(co, 8);
  const replacementRows = pickRows(replacements, 10, "priority");

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml({
    summary,
    cleanRows,
    coMentionRows,
    replacementRows,
    providerRows,
    categoryRows,
    battlecardRows,
    competitorRows,
  }));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown({
    summary,
    cleanRows,
    coMentionRows,
    replacementRows,
    providerRows,
    categoryRows,
    battlecardRows,
    competitorRows,
  }));
  await writeFile(path.join(outDir, "selected-answer-examples.csv"), csv([
    ["type", "provider", "query", "category", "competitors", "snippet", "target_page", "next_action"],
    ...cleanRows.map((row) => ["clean_ibolt", row.provider, row.query, row.category, "", compactText(row.snippet, 520), row.target_page, row.next_action]),
    ...coMentionRows.map((row) => ["co_mention", row.provider, row.query, row.category, row.competitors, compactText(row.snippet, 520), row.target_page, row.next_action]),
    ...replacementRows.map((row) => ["competitor_replacement", row.provider, row.query, row.category, row.competitors, compactText(row.snippet, 520), row.mapped_page, row.next_action || row.recommended_action]),
  ]));
  await writeFile(path.join(outDir, "competitor-comparison-shortlist.csv"), csv([
    ["brand", "tier", "role", "lost_answers", "co_mention_wins", "mapped_page_count", "counter_positioning", "on_site_action", "off_site_ask"],
    ...battlecardRows.slice(0, 12).map((row) => [row.brand, row.tier, row.role, row.lost_answers, row.co_mention_wins, row.mapped_page_count, row.counter_positioning, row.on_site_action, row.off_site_ask]),
  ]));

  console.log(`Wrote ${outDir}`);
  console.log(`Clean mentions: ${summary.cleanMentions}`);
  console.log(`Co-mentions: ${summary.coMentions}`);
  console.log(`Competitor replacements: ${summary.competitorReplacements}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
