#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "low-coverage-prompt-expansion-pack");
const providers = ["chatgpt", "gemini_plain", "claude"];

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
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const match = String(value ?? "").replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function compact(value, length = 170) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 3).trim()}...` : text;
}

function keyUrl(value) {
  return String(value ?? "").trim().replace(/\/$/, "");
}

function cleanTitle(title) {
  return String(title ?? "")
    .replace(/\biBOLT\b/gi, "")
    .replace(/\b2026\b/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\bcomplete guide\b/gi, "")
    .replace(/\bcomparison\b/gi, "")
    .replace(/\bguide\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/[:|]+$/g, "")
    .trim();
}

function seedPhrase(row) {
  const preserved = String(row.first_action ?? "").match(/preserve prompts:\s*([^.;]+)/i)?.[1];
  if (preserved) return preserved.trim();
  return "";
}

function categoryPhrase(row) {
  const seeded = seedPhrase(row);
  if (seeded) return seeded;
  const category = row.category;
  const cleaned = cleanTitle(row.title).toLowerCase();
  if (/restaurant|pos|tablet tower|delivery apps|toast|square/.test(cleaned)) return "restaurant tablet mount";
  if (/delivery|doordash|uber|instacart|amazon flex|van/.test(cleaned)) return "delivery driver phone mount";
  if (/fleet|eld|truck|semi|construction|work truck|commercial vehicle|field service/.test(cleaned)) return "fleet phone mount";
  if (/fish finder|marine|boat|kayak|pontoon|rough water/.test(cleaned)) return "fish finder mount";
  if (/forklift|warehouse|barcode|scanner|vesa|honeywell|zebra/.test(cleaned)) return "forklift tablet mount";
  if (/stream|camera|creator|overhead|youtube|product photography/.test(cleaned)) return "phone stand for streaming";
  if (/amps|ball|adapter|plate|magnetic|clamp|headrest|samsung|nintendo/.test(cleaned)) return "AMPS mounting system";
  const categoryMap = {
    restaurant: "restaurant tablet mount",
    delivery: "delivery driver phone mount",
    fleet: "fleet phone mount",
    fishing: "fish finder mount",
    warehouse: "forklift tablet mount",
    streaming: "phone stand for streaming",
    "amps/modular": "AMPS mounting system",
  };
  return categoryMap[category] || cleaned || "device mount";
}

function competitorFor(category) {
  const map = {
    restaurant: "RAM Mounts",
    delivery: "iOttie",
    fleet: "RAM Mounts",
    fishing: "RAM Mounts",
    warehouse: "RAM Mounts",
    streaming: "Arkon",
    "amps/modular": "RAM Mounts",
  };
  return map[category] || "RAM Mounts";
}

function productIntentFor(category) {
  const map = {
    restaurant: "what iBOLT restaurant tablet mount should I use",
    delivery: "what iBOLT phone mount should a delivery driver use",
    fleet: "what iBOLT fleet mount should I use",
    fishing: "what iBOLT fish finder mount should I use",
    warehouse: "what iBOLT forklift tablet mount should I use",
    streaming: "what iBOLT phone stand should I use for streaming",
    "amps/modular": "what iBOLT AMPS mounting system should I use",
  };
  return map[category] || "what iBOLT mount should I use";
}

function generatedPrompts(row) {
  const phrase = categoryPhrase(row);
  const plainPhrase = phrase.replace(/^best\s+/i, "").trim();
  const bestPrompt = /^best\s+/i.test(phrase) ? phrase : `best ${phrase}`;
  const competitor = competitorFor(row.category);
  return [
    { prompt: bestPrompt, type: "buyer_best", expected: "iBOLT mention and top-three recovery" },
    { prompt: `${competitor} vs iBOLT for ${plainPhrase}`, type: "competitor_comparison", expected: "iBOLT fair-comparison inclusion" },
    { prompt: `${productIntentFor(row.category)} for ${plainPhrase}`, type: "product_entity", expected: "correct iBOLT product/entity recall" },
    { prompt: `which brands are cited for ${plainPhrase}`, type: "citation_probe", expected: "target-domain citation opportunity after source cleanup" },
  ];
}

function promptType(prompt) {
  const text = prompt.toLowerCase();
  if (/cited|citation|source|sources/.test(text)) return "citation_probe";
  if (/\bvs\b|versus|compare/.test(text)) return "competitor_comparison";
  if (/what ibolt|is ibolt|which ibolt/.test(text)) return "product_entity";
  if (/best|top|recommended/.test(text)) return "buyer_best";
  return "buyer_problem";
}

function expectedMetric(type) {
  if (type === "citation_probe") return "target-domain citation opportunity after source cleanup";
  if (type === "competitor_comparison") return "iBOLT fair-comparison inclusion";
  if (type === "product_entity") return "correct iBOLT product/entity recall";
  return "iBOLT mention and top-three recovery";
}

function runGate(row) {
  const issues = `${row.issues ?? ""} ${row.first_action ?? ""}`.toLowerCase();
  if (/survivor|canonical/.test(issues)) return "Run after survivor URL decision and page merge.";
  if (/missing early quick answer|faqpage|article\/blogposting|comparison/.test(issues)) return "Run after quick answer, comparison block, product module, and schema cleanup.";
  return "Runnable after page has visible answer block and product links.";
}

function priorityFor(row, index) {
  return Math.max(1, Math.round(100 - index * 0.4 + toNumber(row.opportunity_score) * 0.7 + toNumber(row.body_score) * 0.2));
}

function promptRowsForPage(row, coverageRow, index) {
  const suggested = splitList(coverageRow?.suggested_prompts);
  const suggestedLooksAwkward = suggested.some((prompt) => /\bbest why\b|\bfor why\b|\bcited for why\b/i.test(prompt));
  const promptObjects = suggested.length && !suggestedLooksAwkward
    ? suggested.map((prompt) => ({ prompt, type: promptType(prompt), expected: expectedMetric(promptType(prompt)), source: "coverage-ledger-suggested" }))
    : generatedPrompts(row).map((prompt) => ({ ...prompt, source: seedPhrase(row) ? "preserved-prompt-seed" : "generated-from-page-title" }));
  return unique(promptObjects.map((item) => item.prompt)).slice(0, 4).map((prompt) => {
    const type = promptType(prompt);
    return {
      pageTitle: row.title,
      pageUrl: row.url,
      category: row.category,
      bodyScore: toNumber(row.body_score),
      opportunityScore: toNumber(row.opportunity_score),
      priority: priorityFor(row, index),
      prompt,
      promptType: type,
      expectedMetric: expectedMetric(type),
      runGate: runGate(row),
      source: promptObjects.find((item) => item.prompt === prompt)?.source || "generated-from-page-title",
      issues: row.issues,
      firstAction: row.first_action,
    };
  });
}

function buildProviderRows(pagePromptRows) {
  const rows = [];
  for (const row of pagePromptRows) {
    for (const provider of providers) {
      rows.push({
        ...row,
        provider,
        batch: batchFor(row),
      });
    }
  }
  return rows;
}

function batchFor(row) {
  if (/citation/.test(row.promptType)) return "LC04 citation probes after cleanup";
  if (/competitor/.test(row.promptType)) return "LC02 competitor comparisons";
  if (/product/.test(row.promptType)) return "LC03 product entity recall";
  return "LC01 buyer best prompts";
}

function groupCategory(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = row.category || "unknown";
    const item = map.get(key) || { category: key, pages: new Set(), prompts: 0, providerRows: 0, avgOpportunity: 0, promptTypes: new Map(), gates: new Map() };
    item.pages.add(row.pageUrl || row.pageTitle);
    item.prompts += 1;
    item.providerRows += providers.length;
    item.avgOpportunity += row.opportunityScore;
    item.promptTypes.set(row.promptType, (item.promptTypes.get(row.promptType) || 0) + 1);
    item.gates.set(row.runGate, (item.gates.get(row.runGate) || 0) + 1);
    map.set(key, item);
  }
  return [...map.values()].map((item) => ({
    category: item.category,
    pages: item.pages.size,
    prompts: item.prompts,
    providerRows: item.providerRows,
    avgOpportunity: item.prompts ? Math.round(item.avgOpportunity / item.prompts) : 0,
    promptTypes: [...item.promptTypes.entries()].sort((a, b) => b[1] - a[1]).map(([type, count]) => `${type} ${count}`),
    gates: [...item.gates.entries()].sort((a, b) => b[1] - a[1]).map(([gate, count]) => `${gate} ${count}`),
  })).sort((a, b) => b.providerRows - a.providerRows || a.category.localeCompare(b.category));
}

function barSvg({ title, rows, valueKey = "value", labelKey = "label", color = "#0f766e", width = 920 }) {
  const chartRows = rows.slice(0, 12);
  const rowHeight = 36;
  const height = 78 + chartRows.length * rowHeight;
  const max = Math.max(1, ...chartRows.map((row) => toNumber(row[valueKey])));
  const bars = chartRows.map((row, index) => {
    const y = 58 + index * rowHeight;
    const value = toNumber(row[valueKey]);
    const barWidth = Math.max(3, Math.round((value / max) * (width - 390)));
    return `<g>
      <text x="20" y="${y + 17}" font-size="13" font-weight="900" fill="#111827">${escapeHtml(compact(row[labelKey], 38))}</text>
      <rect x="310" y="${y}" width="${width - 390}" height="22" rx="11" fill="#e5e7eb"/>
      <rect x="310" y="${y}" width="${barWidth}" height="22" rx="11" fill="${color}"/>
      <text x="${width - 58}" y="${y + 17}" font-size="13" font-weight="900" text-anchor="end" fill="#111827">${escapeHtml(value)}</text>
    </g>`;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="14" fill="#fff"/>
    <text x="20" y="32" font-size="19" font-weight="900" fill="#111827">${escapeHtml(title)}</text>
    ${bars}
  </svg>`;
}

function renderTable(headers, rows) {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table>${head}${body}</table>`;
}

function renderHtml({ lowCoverageRows, pagePromptRows, providerRows, categoryRows }) {
  const pageTable = lowCoverageRows.slice(0, 40).map((row) => [
    row.title,
    row.category,
    row.body_score,
    row.opportunity_score,
    compact(row.issues, 120),
    compact(row.first_action, 160),
  ]);
  const promptTable = pagePromptRows.slice(0, 80).map((row) => [
    row.priority,
    row.pageTitle,
    row.category,
    row.promptType,
    row.prompt,
    row.runGate,
    row.expectedMetric,
  ]);
  const categoryTable = categoryRows.map((row) => [
    row.category,
    row.pages,
    row.prompts,
    row.providerRows,
    row.avgOpportunity,
    row.promptTypes.join("; "),
    row.gates.join("; "),
  ]);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Low Coverage Prompt Expansion Pack</title>
  <style>
    body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1240px;margin:0 auto;padding:34px 24px 70px}
    h1{font-size:36px;margin:0 0 8px}
    h2{font-size:24px;margin:34px 0 12px}
    p,li{font-size:15px;line-height:1.55;color:#334155}
    .note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #0f766e;border-radius:12px;padding:16px 18px;margin:18px 0}
    .cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:20px 0}
    .card{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:16px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:900}
    .value{font-size:28px;font-weight:900;margin:8px 0;color:#0f172a}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    svg{width:100%;height:auto;border:1px solid #dbe3ef;border-radius:14px}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 22px}
    th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    @media(max-width:900px){.cards,.grid{grid-template-columns:1fr}h1{font-size:30px}}
  </style>
</head>
<body>
<main>
  <h1>Low Coverage Prompt Expansion Pack</h1>
  <p>Focused provider manifest for the pages that still have no or low benchmark coverage. Prompts are small, buyer-style questions, not one giant prompt.</p>
  <div class="note"><strong>Run gate:</strong> this pack is ready for controlled live runs after the listed page cleanup gates. Use the provider manifest to test ChatGPT, Gemini, and Claude one prompt at a time.</div>

  <section class="cards">
    <div class="card"><div class="label">Pages</div><div class="value">${lowCoverageRows.length}</div><p>Low/no benchmark coverage pages.</p></div>
    <div class="card"><div class="label">Prompts</div><div class="value">${pagePromptRows.length}</div><p>Unique page-level buyer questions.</p></div>
    <div class="card"><div class="label">Provider rows</div><div class="value">${providerRows.length}</div><p>ChatGPT, Gemini, and Claude requests.</p></div>
    <div class="card"><div class="label">Providers</div><div class="value">3</div><p>Normal accessible consumer models.</p></div>
  </section>

  <section class="grid">
    ${barSvg({ title: "Prompt Requests By Category", rows: categoryRows.map((row) => ({ label: row.category, value: row.providerRows })), color: "#1d4ed8" })}
    ${barSvg({ title: "Top Page Opportunities", rows: lowCoverageRows.map((row) => ({ label: row.title, value: toNumber(row.opportunity_score) })), color: "#b91c1c" })}
  </section>

  <h2>Category Rollup</h2>
  ${renderTable(["Category", "Pages", "Prompts", "Provider rows", "Avg opportunity", "Prompt types", "Run gates"], categoryTable)}

  <h2>Prompt Expansion Queue</h2>
  ${renderTable(["Priority", "Page", "Category", "Prompt type", "Prompt", "Run gate", "Expected metric"], promptTable)}

  <h2>Low Coverage Pages</h2>
  ${renderTable(["Page", "Category", "Body score", "Opportunity", "Issues", "First action"], pageTable)}
</main>
</body>
</html>`;
}

function renderMarkdown({ lowCoverageRows, pagePromptRows, providerRows, categoryRows }) {
  return `# Low Coverage Prompt Expansion Pack

## Summary

- Low/no benchmark coverage pages: ${lowCoverageRows.length}
- Unique page-level prompts: ${pagePromptRows.length}
- Provider rows: ${providerRows.length}
- Providers: ChatGPT, Gemini, Claude

## Category Rollup

${categoryRows.map((row) => `- ${row.category}: ${row.pages} pages, ${row.prompts} prompts, ${row.providerRows} provider rows.`).join("\n")}

## Top Prompt Queue

${pagePromptRows.slice(0, 30).map((row) => `- ${row.prompt} (${row.category}, ${row.promptType}). Gate: ${row.runGate}`).join("\n")}
`;
}

async function main() {
  const lowCoverageRows = await readCsv("all-blog-answer-gap-drilldown/low-coverage-blog-pages.csv");
  const coverageRows = await readCsv("all-blog-test-coverage-report/all-blog-test-coverage-ledger.csv");
  const coverageByUrl = new Map(coverageRows.map((row) => [keyUrl(row.url), row]));

  const pagePromptRows = [];
  lowCoverageRows.forEach((row, index) => {
    const coverageRow = coverageByUrl.get(keyUrl(row.url));
    pagePromptRows.push(...promptRowsForPage(row, coverageRow, index));
  });
  const providerRows = buildProviderRows(pagePromptRows);
  const categoryRows = groupCategory(pagePromptRows);

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml({ lowCoverageRows, pagePromptRows, providerRows, categoryRows }));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown({ lowCoverageRows, pagePromptRows, providerRows, categoryRows }));
  await writeFile(path.join(outDir, "low-coverage-prompt-pages.csv"), csv([
    ["title", "url", "category", "body_score", "opportunity_score", "issues", "first_action"],
    ...lowCoverageRows.map((row) => [row.title, row.url, row.category, row.body_score, row.opportunity_score, row.issues, row.first_action]),
  ]));
  await writeFile(path.join(outDir, "low-coverage-page-prompts.csv"), csv([
    ["priority", "page_title", "page_url", "category", "prompt", "prompt_type", "expected_metric", "run_gate", "source", "issues", "first_action"],
    ...pagePromptRows.map((row) => [
      row.priority,
      row.pageTitle,
      row.pageUrl,
      row.category,
      row.prompt,
      row.promptType,
      row.expectedMetric,
      row.runGate,
      row.source,
      row.issues,
      row.firstAction,
    ]),
  ]));
  await writeFile(path.join(outDir, "low-coverage-provider-manifest.csv"), csv([
    ["batch", "provider", "priority", "prompt", "category", "page_title", "page_url", "prompt_type", "expected_metric", "run_gate", "source"],
    ...providerRows.map((row) => [
      row.batch,
      row.provider,
      row.priority,
      row.prompt,
      row.category,
      row.pageTitle,
      row.pageUrl,
      row.promptType,
      row.expectedMetric,
      row.runGate,
      row.source,
    ]),
  ]));
  await writeFile(path.join(outDir, "low-coverage-category-rollup.csv"), csv([
    ["category", "pages", "prompts", "provider_rows", "avg_opportunity", "prompt_types", "run_gates"],
    ...categoryRows.map((row) => [
      row.category,
      row.pages,
      row.prompts,
      row.providerRows,
      row.avgOpportunity,
      row.promptTypes.join("; "),
      row.gates.join("; "),
    ]),
  ]));

  console.log(`Wrote ${outDir}`);
  console.log(`Low/no coverage pages: ${lowCoverageRows.length}`);
  console.log(`Prompts: ${pagePromptRows.length}`);
  console.log(`Provider rows: ${providerRows.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
