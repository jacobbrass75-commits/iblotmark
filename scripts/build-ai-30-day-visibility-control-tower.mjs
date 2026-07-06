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

function csv(rows) {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function num(value) {
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(numerator, denominator) {
  return denominator ? Math.round((num(numerator) / num(denominator)) * 100) : 0;
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\biBolt\b/g, "iBOLT")
    .replace(/\bIbolt\b/g, "iBOLT")
    .replace(/\bIBOLT\b/g, "iBOLT")
    .replace(/[–—]/g, "-")
    .replace(/budget\/value/gi, "price/value")
    .replace(/budget positioning/gi, "price-led positioning")
    .replace(/\s+/g, " ")
    .trim();
}

function splitList(value) {
  if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean);
  return String(value ?? "")
    .split(";")
    .map((item) => normalizeText(item.trim()))
    .filter(Boolean)
    .filter((item) => !/^\+\d+\s+more$/i.test(item));
}

function normalizeUrl(value) {
  return String(value ?? "").replace(/\/+$/, "");
}

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "row";
}

function unique(values) {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
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

function barSvg({ title, subtitle, rows, width = 980, height = 420, color = "#1d4ed8" }) {
  const margin = { top: 78, right: 60, bottom: 36, left: 260 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(...rows.map((row) => num(row.value)), 1);
  const rowHeight = chartHeight / Math.max(rows.length, 1);
  const bars = rows.map((row, index) => {
    const y = margin.top + index * rowHeight + 6;
    const h = Math.max(13, rowHeight - 12);
    const w = Math.round((num(row.value) / maxValue) * chartWidth);
    return `
      <text x="${margin.left - 14}" y="${y + h / 2 + 5}" text-anchor="end" font-size="14" fill="#334155">${escapeHtml(row.name)}</text>
      <rect x="${margin.left}" y="${y}" width="${w}" height="${h}" rx="6" fill="${color}"></rect>
      <text x="${margin.left + w + 10}" y="${y + h / 2 + 5}" font-size="14" font-weight="800" fill="#0f172a">${escapeHtml(row.value)}</text>
    `;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <text x="28" y="36" font-size="25" font-weight="900" fill="#0f172a">${escapeHtml(title)}</text>
  <text x="28" y="62" font-size="14" fill="#64748b">${escapeHtml(subtitle)}</text>
  ${bars}
</svg>`;
}

function progressSvg({ summary, width = 980, height = 330 }) {
  const kpis = [
    { label: "Mention", current: summary.mentionRate, target: 35 },
    { label: "Non-branded", current: summary.nonBrandedMentionRate, target: 15 },
    { label: "Top-3", current: summary.topThreeRate, target: 25 },
    { label: "Citation", current: summary.citationRate, target: 8 },
  ];
  const cardWidth = (width - 64) / kpis.length;
  const cards = kpis.map((row, index) => {
    const x = 26 + index * cardWidth;
    const inner = cardWidth - 42;
    const progress = Math.min(1, row.target ? row.current / row.target : 0) * inner;
    const color = row.current >= row.target ? "#16a34a" : row.current > 0 ? "#f59e0b" : "#dc2626";
    return `
      <rect x="${x}" y="86" width="${cardWidth - 14}" height="168" rx="14" fill="#ffffff" stroke="#d7dee8"/>
      <text x="${x + 18}" y="120" font-size="13" font-weight="900" fill="#64748b">${escapeHtml(row.label)}</text>
      <text x="${x + 18}" y="165" font-size="38" font-weight="900" fill="#0f172a">${row.current}%</text>
      <text x="${x + 19}" y="194" font-size="14" fill="#475569">Target ${row.target}%</text>
      <rect x="${x + 18}" y="218" width="${inner}" height="12" rx="6" fill="#e2e8f0"/>
      <rect x="${x + 18}" y="218" width="${progress}" height="12" rx="6" fill="${color}"/>
    `;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#f8fafc"/>
  <text x="28" y="38" font-size="26" font-weight="900" fill="#0f172a">30-Day KPI Targets</text>
  <text x="28" y="64" font-size="14" fill="#64748b">These are retest targets after on-site edits and contractor citation work are live.</text>
  ${cards}
</svg>`;
}

function stageForPage(row, sprint1ByUrl) {
  const sprint = sprint1ByUrl.get(normalizeUrl(row.url));
  if (sprint?.ticket_type?.includes("canonical") || sprint?.lifecycle_bucket?.includes("Canonical")) {
    return "Week 1: confirm survivor URL before editing";
  }
  if (row.priority >= 80) return "Week 1: source-ready edit";
  if (row.priority >= 74) return "Week 2: source-ready edit";
  return "Week 3: support edit";
}

function pageWorkloadRows({ citationPages, sprintBriefs, editBriefs }) {
  const sprint1ByUrl = new Map(sprintBriefs.map((row) => [normalizeUrl(row.url), row]));
  const editByUrl = new Map(editBriefs.map((row) => [normalizeUrl(row.url), row]));
  return citationPages.map((row, index) => {
    const url = normalizeUrl(row.url);
    const sprint = sprint1ByUrl.get(url);
    const edit = editByUrl.get(url);
    const prompts = unique([...(row.retestPrompts || []), ...(sprint?.prompts || []), ...(edit?.retests || [])]).slice(0, 6);
    const products = unique([...(row.products || []), ...(sprint?.products || []), ...(edit?.products || [])]).slice(0, 6);
    const competitors = unique([...(row.competitors || []), ...(sprint?.competitors || []), ...(edit?.competitors || [])]).slice(0, 8);
    const fixes = unique([
      ...(sprint?.schemaChecklist || []),
      ...(edit?.schemaFixes || []),
      "Add a visible quick-answer block.",
      "Add a compact product module with exact product names and compatibility.",
      "Add a fair competitor comparison block.",
      "Retest mapped prompts after publish.",
    ]);
    return {
      rank: index + 1,
      stage: stageForPage(row, sprint1ByUrl),
      title: row.page,
      url,
      category: row.category,
      priority: row.priority,
      owner: "Jacob/app",
      canonicalNote: sprint?.canonicalNotes?.[0] || edit?.action || "No canonical blocker detected before edit.",
      prompts,
      competitors,
      products,
      fixes,
      successMetric: prompts.length
        ? `Retest ${prompts.slice(0, 3).join("; ")} and look for iBOLT mention by at least 2 providers.`
        : "Retest mapped prompts and verify source-ready rendering.",
    };
  });
}

function contractorRows(briefs) {
  return briefs.slice(0, 12).map((brief, index) => ({
    rank: index + 1,
    stage: brief.type === "topic" ? "Week 1: topic authority outreach" : "Week 2: competitor adjacency outreach",
    type: brief.type,
    title: brief.title,
    priority: brief.priority,
    category: brief.category,
    competitors: unique(brief.competitors || []).slice(0, 8),
    sourceTargets: unique(brief.sourceTargets || []).slice(0, 6),
    targetPages: (brief.targetPages || []).map((page) => page.title).slice(0, 4),
    retestPrompts: unique(brief.retestPrompts || []).slice(0, 6),
    successMetric: brief.successMetric,
  }));
}

function retestRows(rows) {
  return rows.slice(0, 18).map((row, index) => ({
    rank: index + 1,
    stage: index < 8 ? "Week 3: first retest" : "Week 4: second retest",
    query: row.query,
    category: row.category,
    baselineMentionRate: row.baselineMentionRate,
    competitorOnlyAnswers: row.competitorOnlyAnswers,
    mappedPage: row.mappedPage,
    action: row.action,
  }));
}

function buildMarkdown({ summary, pageRows, contractorRowsList, retestRowsList, competitorRows, categoryRows }) {
  return `# 30-Day AI Visibility Control Tower

## Current Position

iBOLT is present in AI answers, but the next sprint needs to move from awareness to sourced recommendation.

- Mention rate: ${summary.mentionRate}% (${summary.mentionCount}/${summary.totalAnswers})
- Non-branded mention rate: ${summary.nonBrandedMentionRate}% (${summary.nonBrandedMentionCount}/${summary.nonBrandedAnswers})
- Top-3 recommendation rate: ${summary.topThreeRate}% (${summary.topThreeCount}/${summary.totalAnswers})
- Citation rate: ${summary.citationRate}% (${summary.citationCount}/${summary.totalAnswers})
- Competitor replacement rows: ${summary.competitorOnlyRows}/${summary.totalAnswers}

## 30-Day Sequence

1. Week 1: choose survivor URLs for canonical clusters, then edit the highest-pressure pages.
2. Week 1-2: add quick answers, exact product modules, FAQ/Article/Product schema, image alt text, and fair competitor comparison sections.
3. Week 1-3: have the SEO contractor place iBOLT near the competitor set on relevant third-party pages.
4. Week 3-4: retest the mapped prompts one at a time on ChatGPT, Claude, and Gemini.

## First Page Edits

${pageRows.slice(0, 10).map((row) => `- ${row.rank}. ${row.title} (${row.category}, priority ${row.priority}): ${row.stage}`).join("\n")}

## Contractor Tasks

${contractorRowsList.slice(0, 8).map((row) => `- ${row.rank}. ${row.title} (${row.type}, priority ${row.priority}): ${row.stage}`).join("\n")}

## Retests

${retestRowsList.slice(0, 12).map((row) => `- ${row.query}: ${row.action}`).join("\n")}

## Main Competitor Pressure

${competitorRows.slice(0, 8).map((row) => `- ${row.brand}: ${row.replacements} replacement rows, ${row.coMentions} co-mentions`).join("\n")}

## Highest Citation Topics

${categoryRows.slice(0, 8).map((row) => `- ${row.category}: priority ${row.priority}, ${row.competitorOnlyAnswers} competitor-only answers, source targets: ${row.sourceTargets}`).join("\n")}
`;
}

function buildHtml({ summary, pageRows, contractorRowsList, retestRowsList, competitorRows, categoryRows }) {
  const cards = [
    ["Mention rate", `${summary.mentionRate}%`, `${summary.mentionCount}/${summary.totalAnswers}`],
    ["Non-branded", `${summary.nonBrandedMentionRate}%`, `${summary.nonBrandedMentionCount}/${summary.nonBrandedAnswers}`],
    ["Top-3", `${summary.topThreeRate}%`, `${summary.topThreeCount}/${summary.totalAnswers}`],
    ["Citation", `${summary.citationRate}%`, `${summary.citationCount}/${summary.totalAnswers}`],
    ["Competitor replacement", `${summary.competitorOnlyRate}%`, `${summary.competitorOnlyRows}/${summary.totalAnswers}`],
    ["Page edits", pageRows.length, "source-ready queue"],
    ["Contractor tasks", contractorRowsList.length, "authority queue"],
    ["Retests", retestRowsList.length, "prompt queue"],
  ].map(([label, value, note]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");

  const pageTrs = pageRows.map((row) => `<tr><td>${row.rank}</td><td>${escapeHtml(row.stage)}</td><td><a href="${escapeHtml(row.url)}">${escapeHtml(row.title)}</a></td><td>${escapeHtml(row.category)}</td><td>${row.priority}</td><td>${escapeHtml(row.competitors.join("; "))}</td><td>${escapeHtml(row.fixes.slice(0, 5).join("; "))}</td><td>${escapeHtml(row.successMetric)}</td></tr>`).join("");
  const contractorTrs = contractorRowsList.map((row) => `<tr><td>${row.rank}</td><td>${escapeHtml(row.stage)}</td><td>${escapeHtml(row.title)}</td><td>${escapeHtml(row.type)}</td><td>${row.priority}</td><td>${escapeHtml(row.competitors.join("; "))}</td><td>${escapeHtml(row.sourceTargets.join("; "))}</td><td>${escapeHtml(row.targetPages.join("; "))}</td><td>${escapeHtml(row.successMetric)}</td></tr>`).join("");
  const retestTrs = retestRowsList.map((row) => `<tr><td>${row.rank}</td><td>${escapeHtml(row.stage)}</td><td>${escapeHtml(row.query)}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.baselineMentionRate)}</td><td>${escapeHtml(row.competitorOnlyAnswers)}</td><td><a href="${escapeHtml(row.mappedPage)}">mapped page</a></td><td>${escapeHtml(row.action)}</td></tr>`).join("");
  const competitorTrs = competitorRows.map((row) => `<tr><td>${escapeHtml(row.brand)}</td><td>${row.replacements}</td><td>${row.coMentions}</td><td>${escapeHtml(row.categories.join("; "))}</td><td>${escapeHtml(row.counterPositioning)}</td></tr>`).join("");
  const categoryTrs = categoryRows.map((row) => `<tr><td>${escapeHtml(row.category)}</td><td>${row.priority}</td><td>${row.pages}</td><td>${row.competitorOnlyAnswers}</td><td>${escapeHtml(row.sourceTargets)}</td></tr>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>30-Day AI Visibility Control Tower</title>
  <style>
    body{margin:0;background:#f8fafc;color:#0f172a;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1220px;margin:0 auto;padding:34px 24px 70px}
    h1{font-size:36px;margin:0 0 8px}
    h2{font-size:23px;margin:36px 0 12px}
    p,li{color:#334155;line-height:1.55}
    a{color:#0f766e}
    .lede{font-size:18px;max-width:940px}
    .cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:24px 0}
    .card{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:900}
    .value{font-size:32px;font-weight:900;margin-top:8px}
    .callout{background:#fff;border-left:6px solid #0f766e;border-top:1px solid #d7dee8;border-right:1px solid #d7dee8;border-bottom:1px solid #d7dee8;border-radius:12px;padding:16px 18px;margin:18px 0}
    img{max-width:100%;height:auto;background:#fff;border:1px solid #d7dee8;border-radius:12px;margin:12px 0}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden;margin:10px 0 26px}
    th,td{text-align:left;vertical-align:top;padding:11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    @media(max-width:900px){.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
<main>
  <h1>30-Day AI Visibility Control Tower</h1>
  <p class="lede">This turns the benchmark into an operating plan: which iBOLT pages to edit first, which competitor/citation tasks to hand to the SEO contractor, and which prompts to retest after the work is live.</p>
  <div class="cards">${cards}</div>
  <div class="callout"><strong>Operating rule:</strong> do not chase citations before the page is source-ready. For each target, confirm the survivor URL, add answer-first and product/entity structure, then ask for external references, then retest.</div>
  <img src="kpi-targets.svg" alt="30-day KPI targets"/>
  <div class="grid">
    <img src="owner-workload.svg" alt="Owner workload"/>
    <img src="competitor-pressure.svg" alt="Competitor pressure"/>
  </div>

  <h2>Page Edit Sequence</h2>
  <table><thead><tr><th>#</th><th>Stage</th><th>Page</th><th>Category</th><th>Priority</th><th>Competitors</th><th>Fixes</th><th>Success metric</th></tr></thead><tbody>${pageTrs}</tbody></table>

  <h2>Contractor Citation Sequence</h2>
  <table><thead><tr><th>#</th><th>Stage</th><th>Task</th><th>Type</th><th>Priority</th><th>Competitors</th><th>Source targets</th><th>Target pages</th><th>Success metric</th></tr></thead><tbody>${contractorTrs}</tbody></table>

  <h2>Retest Sequence</h2>
  <table><thead><tr><th>#</th><th>Stage</th><th>Prompt</th><th>Category</th><th>Baseline mention</th><th>Competitor-only</th><th>Page</th><th>Action</th></tr></thead><tbody>${retestTrs}</tbody></table>

  <h2>Competitor Pressure</h2>
  <table><thead><tr><th>Competitor</th><th>Replacement rows</th><th>Co-mentions</th><th>Categories</th><th>Counter-positioning</th></tr></thead><tbody>${competitorTrs}</tbody></table>

  <h2>Citation Topic Priority</h2>
  <table><thead><tr><th>Category</th><th>Priority</th><th>Pages</th><th>Competitor-only answers</th><th>Source targets</th></tr></thead><tbody>${categoryTrs}</tbody></table>
</main>
</body>
</html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, "thirty-day-visibility-control-tower");
  await mkdir(outDir, { recursive: true });

  const citation = await readJsonIfExists(path.join(benchmarkDir, "citation-rate-visibility-dashboard", "citation-rate-visibility-data.json"), {
    summary: {},
    pageRows: [],
    retestRows: [],
    competitorRows: [],
    categoryRows: [],
  });
  const sprint = await readJsonIfExists(path.join(benchmarkDir, "sprint1-editor-pack", "sprint1-editor-pack-data.json"), { briefs: [], offsiteRows: [] });
  const editPacket = await readJsonIfExists(path.join(benchmarkDir, "edit-implementation-packet", "edit-implementation-data.json"), { briefs: [] });
  const contractor = await readJsonIfExists(path.join(benchmarkDir, "contractor-citation-packet", "contractor-citation-data.json"), { briefs: [] });
  const backlog = await readJsonIfExists(path.join(benchmarkDir, "visibility-execution-backlog", "visibility-execution-backlog-data.json"), { summary: {} });

  const pageRows = pageWorkloadRows({
    citationPages: citation.pageRows || [],
    sprintBriefs: sprint.briefs || [],
    editBriefs: editPacket.briefs || [],
  });
  const contractorRowsList = contractorRows(contractor.briefs || []);
  const retestRowsList = retestRows(citation.retestRows || []);
  const ownerWorkload = [
    { name: "Jacob/app page edits", value: pageRows.length },
    { name: "SEO contractor tasks", value: contractorRowsList.length },
    { name: "Retest prompts", value: retestRowsList.length },
    { name: "Backlog items", value: backlog.summary?.totalBacklogItems || 0 },
  ];

  await writeFile(path.join(outDir, "kpi-targets.svg"), progressSvg({ summary: citation.summary || {} }));
  await writeFile(path.join(outDir, "owner-workload.svg"), barSvg({
    title: "Owner Workload",
    subtitle: "Page edits, contractor outreach, and prompt retests are separate queues.",
    rows: ownerWorkload,
    color: "#0f766e",
  }));
  await writeFile(path.join(outDir, "competitor-pressure.svg"), barSvg({
    title: "Competitor Replacement Pressure",
    subtitle: "Rows where AI preferred or defaulted to another brand instead of iBOLT.",
    rows: (citation.competitorRows || []).slice(0, 8).map((row) => ({ name: row.brand, value: row.replacements })),
    color: "#dc2626",
  }));

  await writeFile(path.join(outDir, "page-edit-sequence.csv"), csv([
    ["rank", "stage", "title", "url", "category", "priority", "owner", "canonical_note", "prompts", "competitors", "products", "fixes", "success_metric"],
    ...pageRows.map((row) => [row.rank, row.stage, row.title, row.url, row.category, row.priority, row.owner, row.canonicalNote, row.prompts, row.competitors, row.products, row.fixes, row.successMetric]),
  ]));
  await writeFile(path.join(outDir, "contractor-citation-sequence.csv"), csv([
    ["rank", "stage", "type", "title", "priority", "category", "competitors", "source_targets", "target_pages", "retest_prompts", "success_metric"],
    ...contractorRowsList.map((row) => [row.rank, row.stage, row.type, row.title, row.priority, row.category, row.competitors, row.sourceTargets, row.targetPages, row.retestPrompts, row.successMetric]),
  ]));
  await writeFile(path.join(outDir, "prompt-retest-sequence.csv"), csv([
    ["rank", "stage", "query", "category", "baseline_mention_rate", "competitor_only_answers", "mapped_page", "action"],
    ...retestRowsList.map((row) => [row.rank, row.stage, row.query, row.category, row.baselineMentionRate, row.competitorOnlyAnswers, row.mappedPage, row.action]),
  ]));
  await writeFile(path.join(outDir, "kpi-targets.csv"), csv([
    ["kpi", "current", "target", "why"],
    ["Mention rate", citation.summary?.mentionRate || 0, 35, "Models include iBOLT at all."],
    ["Non-branded mention rate", citation.summary?.nonBrandedMentionRate || 0, 15, "New buyers ask generic recommendation prompts."],
    ["Top-3 recommendation rate", citation.summary?.topThreeRate || 0, 25, "Recommendation strength is closer to buying influence."],
    ["Citation rate", citation.summary?.citationRate || 0, 8, "AI search surfaces trust iboltmounts.com as a source."],
  ]));

  const data = {
    generatedAt: new Date().toISOString(),
    benchmarkDir,
    summary: {
      ...(citation.summary || {}),
      pageEditRows: pageRows.length,
      contractorRows: contractorRowsList.length,
      retestRows: retestRowsList.length,
      backlogItems: backlog.summary?.totalBacklogItems || 0,
    },
    pageRows,
    contractorRows: contractorRowsList,
    retestRows: retestRowsList,
    competitorRows: citation.competitorRows || [],
    categoryRows: citation.categoryRows || [],
  };
  await writeFile(path.join(outDir, "thirty-day-control-tower-data.json"), JSON.stringify(data, null, 2));
  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown({
    summary: citation.summary || {},
    pageRows,
    contractorRowsList,
    retestRowsList,
    competitorRows: citation.competitorRows || [],
    categoryRows: citation.categoryRows || [],
  }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({
    summary: citation.summary || {},
    pageRows,
    contractorRowsList,
    retestRowsList,
    competitorRows: citation.competitorRows || [],
    categoryRows: citation.categoryRows || [],
  }));

  console.log(`Wrote 30-day visibility control tower to ${outDir}`);
  console.log(`Page edits: ${pageRows.length}`);
  console.log(`Contractor tasks: ${contractorRowsList.length}`);
  console.log(`Retests: ${retestRowsList.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
