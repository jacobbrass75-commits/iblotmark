import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";

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
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some(Boolean)) rows.push(row);
  }
  const [headers = [], ...body] = rows;
  return body.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

async function readCsv(filePath) {
  return parseCsv(await readFile(filePath, "utf8"));
}

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

function countInto(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function topMap(map, limit = 6) {
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function providerAdvice(provider, row) {
  const topCompetitor = row.topCompetitors[0]?.name || "RAM Mounts";
  const topCategory = row.topCategories[0]?.name || "delivery";
  if (provider === "ChatGPT") {
    return {
      diagnosis: "ChatGPT is the easiest model to move because it already includes more iBOLT co-mentions than the others, but it still defaults to competitor lists on broad buyer prompts.",
      pageMove: `Add query-exact quick answers and fair comparison blocks that put iBOLT directly beside ${topCompetitor}, especially on ${topCategory} pages.`,
      citationMove: "Make pages easier to cite with concise answer-first paragraphs, FAQ schema, product specs, and visible source sections.",
      retestMove: "Retest broad commercial prompts first, then direct comparison prompts.",
    };
  }
  if (provider === "Claude") {
    return {
      diagnosis: "Claude is the harshest replacement model in this benchmark. It often gives confident ranked lists without iBOLT unless the prompt is branded or very close to an existing iBOLT entity.",
      pageMove: `Strengthen exact product/entity naming and use-case proof. Claude needs clear reasons to rank iBOLT over ${topCompetitor}, not just category coverage.`,
      citationMove: "Give Claude structured proof blocks: materials, compatibility, mount pattern, install style, ideal buyer, and specific product names.",
      retestMove: "Retest after product entity modules are live, with one prompt per use case.",
    };
  }
  return {
    diagnosis: "Gemini behaves like a source and entity recognition test. It misses iBOLT often when the page does not clearly map the entity, category, and product source together.",
    pageMove: `Prioritize source-ready pages and clean schema for ${topCategory}, with explicit iBOLT product names near the category term and competitor context.`,
    citationMove: "Improve structured data and external corroboration. Gemini should benefit most from Organization, Article, FAQ, Product, and third-party citation work.",
    retestMove: "Retest search-style prompts after schema cleanup and external citation work.",
  };
}

function groupedBarSvg(providerRows) {
  const width = 940;
  const height = 390;
  const metrics = [
    ["cleanMentions", "Clean", "#16a34a"],
    ["coMentions", "Co-mentioned", "#84cc16"],
    ["competitorReplacements", "Replacement", "#dc2626"],
    ["noSignal", "No signal", "#94a3b8"],
  ];
  const maxValue = Math.max(...providerRows.flatMap((row) => metrics.map(([key]) => row[key] || 0)), 1);
  const groupWidth = 250;
  const barWidth = 34;
  const chartTop = 76;
  const chartBottom = 310;
  const chartHeight = chartBottom - chartTop;
  const groups = providerRows.map((row, providerIndex) => {
    const groupX = 110 + providerIndex * groupWidth;
    const bars = metrics.map(([key, label, color], metricIndex) => {
      const value = row[key] || 0;
      const h = Math.round((value / maxValue) * chartHeight);
      const x = groupX + metricIndex * (barWidth + 14);
      const y = chartBottom - h;
      return `
        <rect x="${x}" y="${y}" width="${barWidth}" height="${h}" rx="5" fill="${color}"/>
        <text x="${x + barWidth / 2}" y="${y - 8}" text-anchor="middle" font-size="12" font-weight="800" fill="#0f172a">${value}</text>
      `;
    }).join("");
    return `${bars}<text x="${groupX + 87}" y="348" text-anchor="middle" font-size="16" font-weight="900" fill="#0f172a">${escapeHtml(row.provider)}</text>`;
  }).join("");
  const legend = metrics.map(([, label, color], index) => {
    const x = 82 + index * 160;
    return `<rect x="${x}" y="364" width="12" height="12" rx="3" fill="${color}"/><text x="${x + 18}" y="375" font-size="12" fill="#475569">${escapeHtml(label)}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#fff"/>
  <text x="28" y="34" font-size="24" font-weight="900" fill="#0f172a">Provider Strategy Baseline</text>
  <text x="28" y="58" font-size="14" fill="#64748b">Answer outcomes by model, used to choose model-specific page edits.</text>
  <line x1="70" y1="${chartBottom}" x2="880" y2="${chartBottom}" stroke="#cbd5e1"/>
  ${groups}
  ${legend}
</svg>`;
}

function providerCompetitorSvg(providerRows) {
  const width = 940;
  const height = 420;
  const margin = { top: 78, right: 28, bottom: 44, left: 190 };
  const rowHeight = 92;
  const maxValue = Math.max(...providerRows.flatMap((row) => row.topCompetitors.map((item) => item.value)), 1);
  const rows = providerRows.map((row, providerIndex) => {
    const y = margin.top + providerIndex * rowHeight;
    let x = margin.left;
    const segments = row.topCompetitors.slice(0, 5).map((item, index) => {
      const w = Math.max(26, Math.round((item.value / maxValue) * 150));
      const color = ["#dc2626", "#ef4444", "#f97316", "#f59e0b", "#64748b"][index] || "#64748b";
      const segment = `<rect x="${x}" y="${y}" width="${w}" height="24" rx="5" fill="${color}"><title>${escapeHtml(item.name)}: ${item.value}</title></rect><text x="${x}" y="${y + 44}" font-size="11" fill="#475569">${escapeHtml(item.name)} ${item.value}</text>`;
      x += w + 18;
      return segment;
    }).join("");
    return `<text x="${margin.left - 16}" y="${y + 18}" text-anchor="end" font-size="16" font-weight="900" fill="#0f172a">${escapeHtml(row.provider)}</text>${segments}`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#fff"/>
  <text x="28" y="34" font-size="24" font-weight="900" fill="#0f172a">Provider Competitor Defaults</text>
  <text x="28" y="58" font-size="14" fill="#64748b">Top competitor names each model reaches for when iBOLT is missing or crowded.</text>
  ${rows}
</svg>`;
}

function buildMarkdown(providerRows) {
  return `# Provider-Specific AI Visibility Strategy

This report turns the answer-level benchmark into model-specific actions. ChatGPT, Gemini, and Claude should not be treated as one generic AI channel.

| Provider | Clean iBOLT | Co-mentioned | Competitor replacement | Top competitors | Priority move |
| --- | ---: | ---: | ---: | --- | --- |
${providerRows.map((row) => `| ${row.provider} | ${row.cleanMentions} | ${row.coMentions} | ${row.competitorReplacements} | ${row.topCompetitors.map((item) => `${item.name} ${item.value}`).join("; ")} | ${row.advice.pageMove} |`).join("\n")}

## Strategy By Provider

${providerRows.map((row) => `### ${row.provider}

- Diagnosis: ${row.advice.diagnosis}
- Page move: ${row.advice.pageMove}
- Citation/schema move: ${row.advice.citationMove}
- Retest move: ${row.advice.retestMove}
- Highest-pressure categories: ${row.topCategories.map((item) => `${item.name} ${item.value}`).join(", ")}
- Top mapped pages: ${row.topPages.map((item) => `${item.name} ${item.value}`).join(", ")}
`).join("\n")}
`;
}

function buildHtml(providerRows, topWorkQueue) {
  const cards = providerRows.map((row) => `<div class="card">
    <div class="label">${escapeHtml(row.provider)}</div>
    <div class="value">${row.competitorReplacements}</div>
    <p>competitor replacements, ${row.coMentions} co-mentions, ${row.cleanMentions} clean mentions</p>
  </div>`).join("");
  const providerPanels = providerRows.map((row) => `<section class="panel">
    <h2>${escapeHtml(row.provider)}</h2>
    <p><strong>Diagnosis:</strong> ${escapeHtml(row.advice.diagnosis)}</p>
    <p><strong>Page move:</strong> ${escapeHtml(row.advice.pageMove)}</p>
    <p><strong>Citation/schema move:</strong> ${escapeHtml(row.advice.citationMove)}</p>
    <p><strong>Retest move:</strong> ${escapeHtml(row.advice.retestMove)}</p>
    <p><strong>Top competitors:</strong> ${escapeHtml(row.topCompetitors.map((item) => `${item.name} ${item.value}`).join(", "))}</p>
    <p><strong>Highest-pressure categories:</strong> ${escapeHtml(row.topCategories.map((item) => `${item.name} ${item.value}`).join(", "))}</p>
  </section>`).join("");
  const queueRows = topWorkQueue.map((row) => `<tr><td>${escapeHtml(row.provider)}</td><td>${escapeHtml(row.query)}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.competitors)}</td><td>${escapeHtml(row.page_title)}</td><td>${escapeHtml(row.fix)}</td></tr>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>iBOLT Provider-Specific AI Strategy</title>
<style>
body{margin:0;background:#f8fafc;color:#0f172a;font-family:Arial,Helvetica,sans-serif}main{max-width:1180px;margin:0 auto;padding:34px 24px 70px}h1{font-size:36px;margin:0 0 8px}h2{font-size:22px;margin:0 0 12px}p{color:#334155;line-height:1.55}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:24px 0}.card,.panel{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}.label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:800}.value{font-size:36px;font-weight:900;margin-top:8px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}img{max-width:100%;height:auto;background:#fff;border:1px solid #d7dee8;border-radius:12px;margin:12px 0}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden;margin-top:14px}th,td{text-align:left;vertical-align:top;padding:10px;border-bottom:1px solid #edf2f7;font-size:13px}th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:12px;letter-spacing:.04em}@media(max-width:900px){.cards,.grid{grid-template-columns:1fr}}
</style></head><body><main>
<h1>Provider-Specific AI Visibility Strategy</h1>
<p>ChatGPT, Gemini, and Claude are not failing the same way. This report shows what to do by provider, based on the current answer-level benchmark.</p>
<section class="cards">${cards}</section>
<img src="provider-strategy-baseline.svg" alt="Provider strategy baseline"/>
<img src="provider-competitor-defaults.svg" alt="Provider competitor defaults"/>
<section class="grid">${providerPanels}</section>
<h2 style="margin-top:34px">Top Provider Work Queue</h2>
<table><thead><tr><th>Provider</th><th>Prompt</th><th>Category</th><th>Competitors</th><th>Mapped page</th><th>Fix</th></tr></thead><tbody>${queueRows}</tbody></table>
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, "provider-strategy-report");
  await mkdir(outDir, { recursive: true });

  const answerData = await readJsonIfExists(path.join(benchmarkDir, "answer-evidence-viewer", "answer-evidence-viewer-data.json"), { evidenceRows: [], providerRows: [] });
  const evidenceRows = answerData.evidenceRows || [];
  const workQueue = await readCsv(path.join(benchmarkDir, "provider-blindspots", "provider-blindspot-workqueue.csv"));

  const providerNames = ["ChatGPT", "Claude", "Gemini"];
  const providerRows = providerNames.map((provider) => {
    const rows = evidenceRows.filter((row) => row.provider === provider);
    const pressureRows = rows.filter((row) => row.outcome !== "clean iBOLT mention");
    const competitorMap = new Map();
    const categoryMap = new Map();
    const pageMap = new Map();
    for (const row of pressureRows) {
      const weight = Math.max(1, Math.round(number(row.priority) / 40));
      countInto(categoryMap, row.category, weight);
      countInto(pageMap, row.page_title, weight);
      for (const competitor of splitList(row.competitors)) countInto(competitorMap, competitor);
    }
    const base = {
      provider,
      totalAnswers: rows.length,
      cleanMentions: rows.filter((row) => row.outcome === "clean iBOLT mention").length,
      coMentions: rows.filter((row) => row.outcome === "co-mentioned").length,
      competitorReplacements: rows.filter((row) => row.outcome === "competitor replacement").length,
      noSignal: rows.filter((row) => row.outcome === "no usable brand signal").length,
      avgCoverageScore: Math.round(rows.reduce((sum, row) => sum + number(row.coverage_score), 0) / Math.max(rows.length, 1)),
      topCompetitors: topMap(competitorMap, 6),
      topCategories: topMap(categoryMap, 6),
      topPages: topMap(pageMap, 5),
    };
    return { ...base, advice: providerAdvice(provider, base) };
  });

  const topWorkQueue = workQueue
    .sort((a, b) => number(b.priority) - number(a.priority))
    .slice(0, 18);

  const summary = {
    benchmarkDir,
    providerCount: providerRows.length,
    totalAnswers: providerRows.reduce((sum, row) => sum + row.totalAnswers, 0),
    totalCompetitorReplacements: providerRows.reduce((sum, row) => sum + row.competitorReplacements, 0),
    totalCoMentions: providerRows.reduce((sum, row) => sum + row.coMentions, 0),
    totalCleanMentions: providerRows.reduce((sum, row) => sum + row.cleanMentions, 0),
    harshestProvider: providerRows.slice().sort((a, b) => b.competitorReplacements - a.competitorReplacements)[0]?.provider || "",
    mostRecoverableProvider: providerRows.slice().sort((a, b) => b.coMentions - a.coMentions)[0]?.provider || "",
    topWorkQueueRows: topWorkQueue.length,
  };

  await writeFile(path.join(outDir, "provider-strategy-data.json"), JSON.stringify({ summary, providerRows, topWorkQueue }, null, 2));
  await writeFile(path.join(outDir, "provider-strategy-summary.csv"), toCsv([
    ["provider", "total_answers", "clean_mentions", "co_mentions", "competitor_replacements", "no_signal", "avg_coverage_score", "top_competitors", "top_categories", "page_move", "citation_move", "retest_move"],
    ...providerRows.map((row) => [row.provider, row.totalAnswers, row.cleanMentions, row.coMentions, row.competitorReplacements, row.noSignal, row.avgCoverageScore, row.topCompetitors.map((item) => `${item.name} ${item.value}`), row.topCategories.map((item) => `${item.name} ${item.value}`), row.advice.pageMove, row.advice.citationMove, row.advice.retestMove]),
  ]));
  await writeFile(path.join(outDir, "provider-workqueue-top.csv"), toCsv([
    ["priority", "provider", "query", "category", "competitors", "page_title", "page_url", "fix"],
    ...topWorkQueue.map((row) => [row.priority, row.provider, row.query, row.category, row.competitors, row.page_title, row.page_url, row.fix]),
  ]));
  await writeFile(path.join(outDir, "provider-strategy-baseline.svg"), groupedBarSvg(providerRows));
  await writeFile(path.join(outDir, "provider-competitor-defaults.svg"), providerCompetitorSvg(providerRows));
  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown(providerRows));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml(providerRows, topWorkQueue));

  console.log(`Wrote ${outDir}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
