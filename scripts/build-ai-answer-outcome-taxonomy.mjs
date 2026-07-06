import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function csv(rows) {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (cell.length || row.length) row.push(cell);
  if (row.length) rows.push(row);
  if (!rows.length) return [];
  const [headers, ...records] = rows;
  return records
    .filter((record) => record.some((value) => String(value ?? "").trim()))
    .map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""])));
}

async function readCsvIfExists(filePath) {
  try {
    return parseCsv(await readFile(filePath, "utf8"));
  } catch {
    return [];
  }
}

async function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function latestDir(prefix) {
  const entries = await readdir(path.join(process.cwd(), OUTPUT_ROOT), { withFileTypes: true });
  const name = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  if (!name) throw new Error(`No ${prefix} directory found in ${OUTPUT_ROOT}`);
  return path.join(process.cwd(), OUTPUT_ROOT, name);
}

function num(value) {
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function bool(value) {
  return String(value ?? "").toLowerCase() === "true";
}

function pct(count, total) {
  return total ? Math.round((num(count) / num(total)) * 100) : 0;
}

function avg(values) {
  const clean = values.map(num).filter((value) => Number.isFinite(value));
  return clean.length ? Math.round(clean.reduce((sum, value) => sum + value, 0) / clean.length) : 0;
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/^\+\d+\s+more$/i.test(item));
}

function unique(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function providerKey(provider) {
  const value = String(provider || "").toLowerCase().replace(/\s+/g, "_");
  if (value === "chatgpt") return "chatgpt";
  if (value === "gemini" || value === "gemini_plain" || value === "gemini-plain") return "gemini_plain";
  if (value === "claude") return "claude";
  return value;
}

function keyFor(provider, query) {
  return `${providerKey(provider)}:::${String(query || "").toLowerCase()}`;
}

function providerDisplay(provider) {
  const value = providerKey(provider);
  if (value === "chatgpt") return "ChatGPT";
  if (value === "gemini_plain") return "Gemini";
  if (value === "claude") return "Claude";
  return value || "unknown";
}

function outcomeBucket(row) {
  if (row.brandMentioned && row.topPickRank && row.topPickRank <= 3) return "iBOLT top-3";
  if (row.brandMentioned) return "iBOLT mentioned, not top-3";
  if (row.domainCited) return "cited iBOLT domain, no brand recommendation";
  if (row.competitors.length) return "competitor-only";
  return "no usable brand signal";
}

function outcomeStage(row) {
  if (row.outcome === "iBOLT top-3") return "win";
  if (row.outcome === "iBOLT mentioned, not top-3") return "weak mention";
  if (row.outcome === "cited iBOLT domain, no brand recommendation") return "source without recommendation";
  if (row.outcome === "competitor-only") return "lost to competitors";
  return "miss";
}

function actionFor(row) {
  if (row.outcome === "iBOLT top-3" && row.catalogProducts.length) return "Protect this query, add citations and keep product facts current.";
  if (row.outcome === "iBOLT top-3") return "Protect ranking, add exact catalog product names and source-ready schema.";
  if (row.outcome === "iBOLT mentioned, not top-3") return "Strengthen recommendation framing and make iBOLT the specialist top choice where justified.";
  if (row.outcome === "cited iBOLT domain, no brand recommendation") return "Convert citations into recommendations with clearer above-the-fold answer and product modules.";
  if (row.outcome === "competitor-only") return "Add competitor-adjacent comparison language and external authority around the mapped page.";
  return "Create or map a stronger answer page, then retest across providers.";
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

function counter(rows, valuesFn) {
  const map = new Map();
  for (const row of rows) {
    for (const value of valuesFn(row)) {
      if (!value) continue;
      map.set(value, (map.get(value) || 0) + 1);
    }
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function top(rows, key, count = 10) {
  return [...rows].sort((a, b) => num(b[key]) - num(a[key]) || String(a.query || a.category || a.provider).localeCompare(String(b.query || b.category || b.provider))).slice(0, count);
}

function buildLedger({ resultsRows, evidenceRows, mentionQualityRows, queryRows }) {
  const evidenceByKey = new Map(evidenceRows.map((row) => [keyFor(row.provider_key || row.provider, row.query), row]));
  const qualityByKey = new Map(mentionQualityRows.map((row) => [keyFor(row.provider_key || row.provider, row.query), row]));
  const queryByQuery = new Map(queryRows.map((row) => [String(row.query || "").toLowerCase(), row]));
  return resultsRows.map((result) => {
    const provider = result.provider;
    const query = result.query;
    const evidence = evidenceByKey.get(keyFor(provider, query)) || {};
    const quality = qualityByKey.get(keyFor(provider, query)) || {};
    const queryMeta = queryByQuery.get(String(query || "").toLowerCase()) || {};
    const brandMentioned = bool(result.brand_mentioned);
    const domainCited = bool(result.domain_cited);
    const competitors = unique([...splitList(result.competitors), ...splitList(evidence.raw_competitors), ...splitList(evidence.stored_competitors), ...splitList(quality.co_mentioned_competitors)]);
    const productSignals = splitList(evidence.product_signals);
    const catalogProducts = unique([...splitList(evidence.catalog_product_names), ...splitList(quality.catalog_matches)]);
    const extractedProducts = splitList(quality.extracted_product_names);
    const unmatchedProducts = splitList(quality.unmatched_product_names);
    const sourceUrlCount = num(evidence.source_url_count) || splitList(quality.source_urls).length;
    const row = {
      provider: providerDisplay(provider),
      provider_key: provider,
      query,
      category: result.category,
      priority: result.priority,
      status: result.status,
      model: result.model,
      coverage_score: num(result.coverage_score),
      brandMentioned,
      domainCited,
      topPickRank: num(result.top_pick_rank) || "",
      sentiment: result.sentiment || "",
      competitors,
      productSignals,
      catalogProducts,
      extractedProducts,
      unmatchedProducts,
      sourceUrlCount,
      mention_quality_score: quality.mention_quality_score || "",
      mapped_page: queryMeta.page_url || "",
      mapped_page_title: queryMeta.page_title || "",
      mapped_page_score: queryMeta.page_score || "",
      structural_issues: queryMeta.structural_issues || "",
      analysis_notes: result.analysis_notes || "",
    };
    row.outcome = outcomeBucket(row);
    row.stage = outcomeStage(row);
    row.action = actionFor(row);
    row.product_signal_count = row.productSignals.length;
    row.catalog_product_count = row.catalogProducts.length;
    row.unmatched_product_count = row.unmatchedProducts.length;
    row.competitor_count = row.competitors.length;
    return row;
  });
}

function summarizeGroup(label, rows) {
  const total = rows.length;
  const outcomeCounts = Object.fromEntries(counter(rows, (row) => [row.outcome]).map((item) => [item.name, item.count]));
  const competitorCounts = counter(rows, (row) => row.competitors);
  const productCounts = counter(rows, (row) => row.catalogProducts);
  return {
    label,
    answers: total,
    avg_score: avg(rows.map((row) => row.coverage_score)),
    ibolt_top3: outcomeCounts["iBOLT top-3"] || 0,
    weak_mentions: outcomeCounts["iBOLT mentioned, not top-3"] || 0,
    cited_no_brand: outcomeCounts["cited iBOLT domain, no brand recommendation"] || 0,
    competitor_only: outcomeCounts["competitor-only"] || 0,
    no_signal: outcomeCounts["no usable brand signal"] || 0,
    mention_rate: pct(rows.filter((row) => row.brandMentioned).length, total),
    top3_rate: pct(rows.filter((row) => row.outcome === "iBOLT top-3").length, total),
    citation_rate: pct(rows.filter((row) => row.domainCited).length, total),
    competitor_only_rate: pct(outcomeCounts["competitor-only"] || 0, total),
    catalog_product_rows: rows.filter((row) => row.catalogProducts.length).length,
    product_signal_rows: rows.filter((row) => row.productSignals.length).length,
    top_competitors: competitorCounts.slice(0, 8).map((item) => `${item.name} ${item.count}`).join("; "),
    top_catalog_products: productCounts.slice(0, 8).map((item) => `${item.name} ${item.count}`).join("; "),
  };
}

function buildOutcomeRows(ledger) {
  return counter(ledger, (row) => [row.outcome]).map((item) => {
    const rows = ledger.filter((row) => row.outcome === item.name);
    return {
      outcome: item.name,
      answers: item.count,
      rate: pct(item.count, ledger.length),
      avg_score: avg(rows.map((row) => row.coverage_score)),
      providers: counter(rows, (row) => [row.provider]).map((entry) => `${entry.name} ${entry.count}`).join("; "),
      categories: counter(rows, (row) => [row.category]).map((entry) => `${entry.name} ${entry.count}`).join("; "),
      top_competitors: counter(rows, (row) => row.competitors).slice(0, 8).map((entry) => `${entry.name} ${entry.count}`).join("; "),
      action: actionFor(rows[0]),
    };
  });
}

function buildProviderRows(ledger) {
  return [...groupBy(ledger, (row) => row.provider).entries()].map(([provider, rows]) => summarizeGroup(provider, rows)).sort((a, b) => b.answers - a.answers || a.label.localeCompare(b.label));
}

function buildCategoryRows(ledger) {
  return [...groupBy(ledger, (row) => row.category).entries()].map(([category, rows]) => summarizeGroup(category, rows)).sort((a, b) => b.competitor_only - a.competitor_only || a.label.localeCompare(b.label));
}

function buildQueryRows(ledger) {
  return [...groupBy(ledger, (row) => row.query).entries()].map(([query, rows]) => {
    const base = summarizeGroup(query, rows);
    const queryMeta = rows.find((row) => row.mapped_page) || rows[0] || {};
    const missedProviders = rows.filter((row) => !row.brandMentioned).map((row) => row.provider).join("; ");
    const pressure = base.competitor_only * 30 + base.no_signal * 15 + Math.max(0, 70 - base.avg_score) + (base.ibolt_top3 ? 0 : 25);
    return {
      priority: Math.round(pressure),
      query,
      category: queryMeta.category || "",
      answers: base.answers,
      avg_score: base.avg_score,
      ibolt_top3: base.ibolt_top3,
      weak_mentions: base.weak_mentions,
      competitor_only: base.competitor_only,
      no_signal: base.no_signal,
      mention_rate: base.mention_rate,
      top3_rate: base.top3_rate,
      citation_rate: base.citation_rate,
      missed_providers: missedProviders,
      top_competitors: base.top_competitors,
      mapped_page: queryMeta.mapped_page || "",
      mapped_page_score: queryMeta.mapped_page_score || "",
      structural_issues: queryMeta.structural_issues || "",
      next_action: base.ibolt_top3 ? "Protect and add citations/product facts." : "Refresh mapped page and retest this exact query across all providers.",
    };
  }).sort((a, b) => b.priority - a.priority || a.query.localeCompare(b.query));
}

function barSvg({ title, rows, labelKey, valueKey, color = "#2563eb", maxValue }) {
  const width = 960;
  const rowHeight = 38;
  const topOffset = 60;
  const height = topOffset + rows.length * rowHeight + 26;
  const labelWidth = 340;
  const barWidth = 420;
  const max = maxValue || Math.max(1, ...rows.map((row) => num(row[valueKey])));
  const bars = rows.map((row, index) => {
    const value = num(row[valueKey]);
    const y = topOffset + index * rowHeight;
    const w = Math.max(value ? 4 : 2, Math.round((value / max) * barWidth));
    return `<text x="22" y="${y + 16}" fill="#0f172a" font-size="13">${escapeHtml(row[labelKey]).slice(0, 52)}</text>
<rect x="${labelWidth}" y="${y}" width="${barWidth}" height="22" rx="4" fill="#e2e8f0"/>
<rect x="${labelWidth}" y="${y}" width="${w}" height="22" rx="4" fill="${color}"/>
<text x="${labelWidth + barWidth + 12}" y="${y + 16}" fill="#0f172a" font-size="13" font-weight="700">${escapeHtml(value)}</text>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="#ffffff"/>
<text x="22" y="38" fill="#0f172a" font-size="22" font-weight="800">${escapeHtml(title)}</text>
${bars}
</svg>`;
}

function stackedProviderSvg(providerRows) {
  const width = 980;
  const height = 260;
  const colors = {
    "iBOLT top-3": "#16a34a",
    "iBOLT mentioned, not top-3": "#0891b2",
    "cited iBOLT domain, no brand recommendation": "#7c3aed",
    "competitor-only": "#ea580c",
    "no usable brand signal": "#64748b",
  };
  const x = 210;
  const barWidth = 600;
  const rows = providerRows.map((row, index) => {
    const y = 68 + index * 54;
    const total = Math.max(1, num(row.answers));
    let cursor = x;
    const segments = [
      ["iBOLT top-3", row.ibolt_top3],
      ["iBOLT mentioned, not top-3", row.weak_mentions],
      ["cited iBOLT domain, no brand recommendation", row.cited_no_brand],
      ["competitor-only", row.competitor_only],
      ["no usable brand signal", row.no_signal],
    ].map(([label, value]) => {
      const w = Math.round((num(value) / total) * barWidth);
      const rect = `<rect x="${cursor}" y="${y}" width="${Math.max(value ? 3 : 0, w)}" height="26" fill="${colors[label]}"><title>${escapeHtml(label)}: ${value}</title></rect>`;
      cursor += w;
      return rect;
    }).join("");
    return `<text x="24" y="${y + 18}" fill="#0f172a" font-size="14" font-weight="700">${escapeHtml(row.label)}</text>
<rect x="${x}" y="${y}" width="${barWidth}" height="26" fill="#e2e8f0"/>
${segments}
<text x="${x + barWidth + 14}" y="${y + 18}" fill="#0f172a" font-size="13">${row.mention_rate}% mention, ${row.competitor_only_rate}% competitor-only</text>`;
  }).join("\n");
  const legend = Object.entries(colors).map(([label, color], index) => {
    const lx = 24 + (index % 3) * 300;
    const ly = 210 + Math.floor(index / 3) * 22;
    return `<rect x="${lx}" y="${ly}" width="12" height="12" fill="${color}"/><text x="${lx + 18}" y="${ly + 11}" fill="#475569" font-size="12">${escapeHtml(label)}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="#ffffff"/>
<text x="24" y="36" fill="#0f172a" font-size="22" font-weight="800">Provider Outcome Mix</text>
${rows}
${legend}
</svg>`;
}

function table(rows, columns) {
  const head = columns.map(([label]) => `<th>${escapeHtml(label)}</th>`).join("");
  const body = rows.map((row) => `<tr>${columns.map(([, key]) => `<td>${escapeHtml(row[key])}</td>`).join("")}</tr>`).join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function markdownTable(rows, columns) {
  return [
    `| ${columns.map(([label]) => label).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${columns.map(([, key]) => String(row[key] ?? "").replaceAll("|", "\\|")).join(" | ")} |`),
  ].join("\n");
}

function buildMarkdown({ summary, outcomeRows, providerRows, categoryRows, queryRows }) {
  return `# iBOLT AI Answer Outcome Taxonomy

## Bottom Line

The saved benchmark answers separate into ${outcomeRows.length} observed outcomes. iBOLT has ${summary.top3Rows} top-3 wins and ${summary.weakMentionRows} weaker mentions, but ${summary.competitorOnlyRows} answers are competitor-only and ${summary.noSignalRows} have no usable brand signal. This is why the next work should focus on competitor-adjacent answer blocks, exact product modules, and source authority rather than only publishing more general posts.

## Outcome Mix

${markdownTable(outcomeRows, [
  ["Outcome", "outcome"],
  ["Answers", "answers"],
  ["Rate", "rate"],
  ["Avg score", "avg_score"],
  ["Providers", "providers"],
  ["Categories", "categories"],
  ["Top competitors", "top_competitors"],
  ["Action", "action"],
])}

## Provider Outcome Mix

${markdownTable(providerRows, [
  ["Provider", "label"],
  ["Answers", "answers"],
  ["Mention rate", "mention_rate"],
  ["Top-3 rate", "top3_rate"],
  ["Competitor-only rate", "competitor_only_rate"],
  ["Top competitors", "top_competitors"],
  ["Catalog products", "top_catalog_products"],
])}

## Category Outcome Pressure

${markdownTable(categoryRows, [
  ["Category", "label"],
  ["Answers", "answers"],
  ["Avg score", "avg_score"],
  ["Top-3", "ibolt_top3"],
  ["Competitor-only", "competitor_only"],
  ["No signal", "no_signal"],
  ["Top competitors", "top_competitors"],
])}

## Query-Level Triage

${markdownTable(queryRows.slice(0, 18), [
  ["Priority", "priority"],
  ["Query", "query"],
  ["Category", "category"],
  ["Avg score", "avg_score"],
  ["Mention rate", "mention_rate"],
  ["Top-3", "ibolt_top3"],
  ["Competitor-only", "competitor_only"],
  ["Missed providers", "missed_providers"],
  ["Mapped page", "mapped_page"],
  ["Next action", "next_action"],
])}
`;
}

function buildHtml({ summary, outcomeRows, providerRows, categoryRows, queryRows, charts }) {
  const cards = [
    ["Answers", summary.totalAnswers, "saved benchmark rows"],
    ["Top-3 wins", summary.top3Rows, `${summary.top3Rate}%`],
    ["Weak mentions", summary.weakMentionRows, "not top-3"],
    ["Competitor-only", summary.competitorOnlyRows, `${summary.competitorOnlyRate}%`],
    ["No signal", summary.noSignalRows, `${summary.noSignalRate}%`],
    ["Catalog products", summary.catalogProductRows, "answer rows"],
  ].map(([label, value, note]) => `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>iBOLT AI Answer Outcome Taxonomy</title>
<style>
body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}main{max-width:1240px;margin:0 auto;padding:34px 26px 60px}h1{font-size:34px;margin:0 0 8px}h2{font-size:22px;margin:34px 0 14px}p{color:#334155;line-height:1.55}.note{border-left:6px solid #ea580c;background:#fff;border-radius:10px;padding:16px 18px;border-top:1px solid #d7dee8;border-right:1px solid #d7dee8;border-bottom:1px solid #d7dee8}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}.k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700}.v{font-size:30px;font-weight:800;margin-top:8px}.charts{display:grid;grid-template-columns:1fr;gap:16px}.chart{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:12px;overflow:auto}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden}th,td{text-align:left;vertical-align:top;padding:11px 12px;border-bottom:1px solid #edf2f7;font-size:14px}th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:12px;letter-spacing:.04em}
</style></head><body><main>
<h1>iBOLT AI Answer Outcome Taxonomy</h1>
<p class="note"><strong>Readout:</strong> The main problem is not only citation. Most non-winning answers either recommend competitors without iBOLT or have no usable brand signal. The content fixes should force iBOLT into the same recommendation set as the brands the models already know.</p>
<section class="cards">${cards}</section>
<section class="charts"><div class="chart">${charts.outcomes}</div><div class="chart">${charts.providers}</div><div class="chart">${charts.categories}</div></section>
<h2>Outcome Mix</h2>
${table(outcomeRows, [
  ["Outcome", "outcome"],
  ["Answers", "answers"],
  ["Rate", "rate"],
  ["Avg score", "avg_score"],
  ["Providers", "providers"],
  ["Categories", "categories"],
  ["Top competitors", "top_competitors"],
  ["Action", "action"],
])}
<h2>Provider Outcome Mix</h2>
${table(providerRows, [
  ["Provider", "label"],
  ["Answers", "answers"],
  ["Mention rate", "mention_rate"],
  ["Top-3 rate", "top3_rate"],
  ["Competitor-only rate", "competitor_only_rate"],
  ["Top competitors", "top_competitors"],
  ["Catalog products", "top_catalog_products"],
])}
<h2>Category Outcome Pressure</h2>
${table(categoryRows, [
  ["Category", "label"],
  ["Answers", "answers"],
  ["Avg score", "avg_score"],
  ["Top-3", "ibolt_top3"],
  ["Weak mentions", "weak_mentions"],
  ["Competitor-only", "competitor_only"],
  ["No signal", "no_signal"],
  ["Top competitors", "top_competitors"],
])}
<h2>Query-Level Triage</h2>
${table(queryRows.slice(0, 24), [
  ["Priority", "priority"],
  ["Query", "query"],
  ["Category", "category"],
  ["Avg score", "avg_score"],
  ["Mention rate", "mention_rate"],
  ["Top-3", "ibolt_top3"],
  ["Competitor-only", "competitor_only"],
  ["No signal", "no_signal"],
  ["Missed providers", "missed_providers"],
  ["Top competitors", "top_competitors"],
  ["Mapped page", "mapped_page"],
  ["Next action", "next_action"],
])}
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, "answer-outcome-taxonomy");
  await mkdir(outDir, { recursive: true });

  const resultsRows = await readCsvIfExists(path.join(benchmarkDir, "results.csv"));
  const evidenceRows = await readCsvIfExists(path.join(benchmarkDir, "answer-evidence-pack", "answer-evidence.csv"));
  const mentionQualityRows = await readCsvIfExists(path.join(benchmarkDir, "mention-quality-audit", "mention-quality-rows.csv"));
  const queryRowsRaw = await readCsvIfExists(path.join(benchmarkDir, "query-page-matrix", "all-query-page-matrix.csv"));
  const master = await readJsonIfExists(path.join(benchmarkDir, "master-dossier", "master-dossier-data.json"), { evidenceSummary: {}, mentionSummary: {} });

  const ledger = buildLedger({ resultsRows, evidenceRows, mentionQualityRows, queryRows: queryRowsRaw });
  const outcomeRows = buildOutcomeRows(ledger);
  const providerRows = buildProviderRows(ledger);
  const categoryRows = buildCategoryRows(ledger);
  const queryRows = buildQueryRows(ledger);
  const top3Rows = ledger.filter((row) => row.outcome === "iBOLT top-3").length;
  const weakMentionRows = ledger.filter((row) => row.outcome === "iBOLT mentioned, not top-3").length;
  const citedNoBrandRows = ledger.filter((row) => row.outcome === "cited iBOLT domain, no brand recommendation").length;
  const competitorOnlyRows = ledger.filter((row) => row.outcome === "competitor-only").length;
  const noSignalRows = ledger.filter((row) => row.outcome === "no usable brand signal").length;
  const catalogProductRows = ledger.filter((row) => row.catalogProducts.length).length;
  const productSignalRows = ledger.filter((row) => row.productSignals.length).length;
  const summary = {
    benchmarkDir,
    totalAnswers: ledger.length,
    totalQueries: new Set(ledger.map((row) => row.query)).size,
    providers: providerRows.length,
    top3Rows,
    top3Rate: pct(top3Rows, ledger.length),
    weakMentionRows,
    weakMentionRate: pct(weakMentionRows, ledger.length),
    citedNoBrandRows,
    citedNoBrandRate: pct(citedNoBrandRows, ledger.length),
    competitorOnlyRows,
    competitorOnlyRate: pct(competitorOnlyRows, ledger.length),
    noSignalRows,
    noSignalRate: pct(noSignalRows, ledger.length),
    catalogProductRows,
    catalogProductRate: pct(catalogProductRows, ledger.length),
    productSignalRows,
    productSignalRate: pct(productSignalRows, ledger.length),
    masterMentionRate: master.evidenceSummary?.mentionRate || pct(ledger.filter((row) => row.brandMentioned).length, ledger.length),
    masterCitationRate: master.evidenceSummary?.citationRate || pct(ledger.filter((row) => row.domainCited).length, ledger.length),
  };
  const charts = {
    outcomes: barSvg({ title: "Answer Outcome Mix", rows: outcomeRows, labelKey: "outcome", valueKey: "answers", color: "#ea580c" }),
    providers: stackedProviderSvg(providerRows),
    categories: barSvg({ title: "Competitor-Only Answers By Category", rows: categoryRows.slice(0, 10), labelKey: "label", valueKey: "competitor_only", color: "#dc2626" }),
  };

  await writeFile(path.join(outDir, "answer-outcome-ledger.csv"), csv([
    ["provider", "provider_key", "query", "category", "priority", "model", "coverage_score", "outcome", "stage", "brand_mentioned", "domain_cited", "top_pick_rank", "sentiment", "competitors", "product_signals", "catalog_products", "extracted_products", "unmatched_products", "source_url_count", "mention_quality_score", "mapped_page", "mapped_page_title", "mapped_page_score", "structural_issues", "action", "analysis_notes"],
    ...ledger.map((row) => [row.provider, row.provider_key, row.query, row.category, row.priority, row.model, row.coverage_score, row.outcome, row.stage, row.brandMentioned, row.domainCited, row.topPickRank, row.sentiment, row.competitors, row.productSignals, row.catalogProducts, row.extractedProducts, row.unmatchedProducts, row.sourceUrlCount, row.mention_quality_score, row.mapped_page, row.mapped_page_title, row.mapped_page_score, row.structural_issues, row.action, row.analysis_notes]),
  ]));
  await writeFile(path.join(outDir, "outcome-summary.csv"), csv([
    ["outcome", "answers", "rate", "avg_score", "providers", "categories", "top_competitors", "action"],
    ...outcomeRows.map((row) => [row.outcome, row.answers, row.rate, row.avg_score, row.providers, row.categories, row.top_competitors, row.action]),
  ]));
  await writeFile(path.join(outDir, "provider-outcome-summary.csv"), csv([
    ["provider", "answers", "avg_score", "ibolt_top3", "weak_mentions", "cited_no_brand", "competitor_only", "no_signal", "mention_rate", "top3_rate", "citation_rate", "competitor_only_rate", "catalog_product_rows", "product_signal_rows", "top_competitors", "top_catalog_products"],
    ...providerRows.map((row) => [row.label, row.answers, row.avg_score, row.ibolt_top3, row.weak_mentions, row.cited_no_brand, row.competitor_only, row.no_signal, row.mention_rate, row.top3_rate, row.citation_rate, row.competitor_only_rate, row.catalog_product_rows, row.product_signal_rows, row.top_competitors, row.top_catalog_products]),
  ]));
  await writeFile(path.join(outDir, "category-outcome-summary.csv"), csv([
    ["category", "answers", "avg_score", "ibolt_top3", "weak_mentions", "cited_no_brand", "competitor_only", "no_signal", "mention_rate", "top3_rate", "citation_rate", "competitor_only_rate", "catalog_product_rows", "product_signal_rows", "top_competitors", "top_catalog_products"],
    ...categoryRows.map((row) => [row.label, row.answers, row.avg_score, row.ibolt_top3, row.weak_mentions, row.cited_no_brand, row.competitor_only, row.no_signal, row.mention_rate, row.top3_rate, row.citation_rate, row.competitor_only_rate, row.catalog_product_rows, row.product_signal_rows, row.top_competitors, row.top_catalog_products]),
  ]));
  await writeFile(path.join(outDir, "query-outcome-triage.csv"), csv([
    ["priority", "query", "category", "answers", "avg_score", "ibolt_top3", "weak_mentions", "competitor_only", "no_signal", "mention_rate", "top3_rate", "citation_rate", "missed_providers", "top_competitors", "mapped_page", "mapped_page_score", "structural_issues", "next_action"],
    ...queryRows.map((row) => [row.priority, row.query, row.category, row.answers, row.avg_score, row.ibolt_top3, row.weak_mentions, row.competitor_only, row.no_signal, row.mention_rate, row.top3_rate, row.citation_rate, row.missed_providers, row.top_competitors, row.mapped_page, row.mapped_page_score, row.structural_issues, row.next_action]),
  ]));
  await writeFile(path.join(outDir, "answer-outcome-data.json"), `${JSON.stringify({ summary, outcomeRows, providerRows, categoryRows, queryRows: queryRows.slice(0, 100), ledger: ledger.slice(0, 140) }, null, 2)}\n`);
  await writeFile(path.join(outDir, "answer-outcome-mix.svg"), charts.outcomes);
  await writeFile(path.join(outDir, "provider-outcome-mix.svg"), charts.providers);
  await writeFile(path.join(outDir, "category-competitor-only.svg"), charts.categories);
  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown({ summary, outcomeRows, providerRows, categoryRows, queryRows }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({ summary, outcomeRows, providerRows, categoryRows, queryRows, charts }));

  console.log(`Wrote ${outDir}`);
  console.log(`Outcome rows: ${outcomeRows.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
