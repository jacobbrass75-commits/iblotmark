#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "citation-visibility-boss-memo");

async function readJson(relativePath, fallback = {}) {
  try {
    return JSON.parse(await readFile(path.join(benchmarkDir, relativePath), "utf8"));
  } catch {
    return fallback;
  }
}

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

function pct(count, total) {
  return total ? Math.round((toNumber(count) / toNumber(total)) * 100) : 0;
}

function short(value, length = 62) {
  const text = String(value ?? "");
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function top(rows, key, count = 8) {
  return [...rows].sort((a, b) => toNumber(b[key]) - toNumber(a[key])).slice(0, count);
}

function table(headers, rows) {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table>${head}${body}</table>`;
}

function metric(label, value, note) {
  return `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`;
}

function barSvg({ title, rows, valueKey = "value", labelKey = "label", color = "#0f766e", width = 900 }) {
  const chartRows = rows.slice(0, 10);
  const rowHeight = 36;
  const height = 76 + chartRows.length * rowHeight;
  const max = Math.max(1, ...chartRows.map((row) => toNumber(row[valueKey])));
  const bars = chartRows.map((row, index) => {
    const y = 58 + index * rowHeight;
    const value = toNumber(row[valueKey]);
    const barWidth = Math.max(3, Math.round((value / max) * (width - 360)));
    return `<g>
      <text x="22" y="${y + 17}" font-size="13" font-weight="800" fill="#111827">${escapeHtml(short(row[labelKey], 38))}</text>
      <rect x="285" y="${y}" width="${width - 360}" height="22" rx="11" fill="#e5e7eb"/>
      <rect x="285" y="${y}" width="${barWidth}" height="22" rx="11" fill="${row.color || color}"/>
      <text x="${width - 34}" y="${y + 16}" text-anchor="end" font-size="13" font-weight="900" fill="#111827">${escapeHtml(value)}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#ffffff"/>
    <text x="22" y="34" font-size="20" font-weight="900" fill="#111827">${escapeHtml(title)}</text>
    ${bars}
  </svg>`;
}

function kpiSvg(summary) {
  const rows = [
    { label: "Mention rate", current: summary.mentionRate, target: 35, color: "#0f766e" },
    { label: "Non-branded mention", current: summary.nonBrandedMentionRate, target: 15, color: "#7c3aed" },
    { label: "Top-3 recommendation", current: summary.topThreeRate, target: 25, color: "#2563eb" },
    { label: "Citation rate", current: summary.citationRate, target: 8, color: "#f97316" },
  ];
  const width = 920;
  const rowHeight = 54;
  const height = 78 + rows.length * rowHeight;
  const bars = rows.map((row, index) => {
    const y = 58 + index * rowHeight;
    const currentWidth = Math.round((toNumber(row.current) / 100) * 430);
    const targetX = 270 + Math.round((toNumber(row.target) / 100) * 430);
    return `<g>
      <text x="22" y="${y + 18}" font-size="14" font-weight="900" fill="#111827">${escapeHtml(row.label)}</text>
      <rect x="270" y="${y}" width="430" height="24" rx="12" fill="#e5e7eb"/>
      <rect x="270" y="${y}" width="${currentWidth}" height="24" rx="12" fill="${row.color}"/>
      <line x1="${targetX}" x2="${targetX}" y1="${y - 5}" y2="${y + 31}" stroke="#111827" stroke-width="3"/>
      <text x="724" y="${y + 17}" font-size="13" font-weight="900" fill="#111827">${toNumber(row.current)}% now</text>
      <text x="824" y="${y + 17}" font-size="13" font-weight="900" fill="#f97316">${toNumber(row.target)}% target</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Current AI visibility KPIs versus target">
    <rect width="${width}" height="${height}" rx="18" fill="#ffffff"/>
    <text x="22" y="34" font-size="20" font-weight="900" fill="#111827">Current AI visibility versus next target</text>
    ${bars}
  </svg>`;
}

function sequenceSvg(summary) {
  const rows = [
    { label: "1. Get included", value: summary.mentionRate, target: 35, color: "#0f766e", note: `${summary.mentionCount}/${summary.totalAnswers}` },
    { label: "2. Get recommended", value: summary.topThreeRate, target: 25, color: "#2563eb", note: `${summary.topThreeCount}/${summary.totalAnswers}` },
    { label: "3. Get cited", value: summary.citationRate, target: 8, color: "#f97316", note: `${summary.citationCount}/${summary.totalAnswers}` },
    { label: "4. Reduce competitor-only", value: 100 - toNumber(summary.competitorOnlyRate), target: 45, color: "#7c3aed", note: `${summary.competitorOnlyRows} competitor-only` },
  ];
  const width = 920;
  const rowHeight = 54;
  const height = 84 + rows.length * rowHeight;
  const bars = rows.map((row, index) => {
    const y = 62 + index * rowHeight;
    const currentWidth = Math.round((toNumber(row.value) / 100) * 430);
    const targetX = 296 + Math.round((toNumber(row.target) / 100) * 430);
    return `<g>
      <text x="22" y="${y + 18}" font-size="14" font-weight="900" fill="#111827">${escapeHtml(row.label)}</text>
      <rect x="296" y="${y}" width="430" height="24" rx="12" fill="#e5e7eb"/>
      <rect x="296" y="${y}" width="${currentWidth}" height="24" rx="12" fill="${row.color}"/>
      <line x1="${targetX}" x2="${targetX}" y1="${y - 5}" y2="${y + 31}" stroke="#111827" stroke-width="3"/>
      <text x="750" y="${y + 17}" font-size="13" font-weight="900" fill="#111827">${escapeHtml(row.note)}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="AI visibility sequence">
    <rect width="${width}" height="${height}" rx="18" fill="#ffffff"/>
    <text x="22" y="34" font-size="20" font-weight="900" fill="#111827">Correct sequence: inclusion, recommendation, citation</text>
    ${bars}
  </svg>`;
}

function ownerSplitSvg(actions) {
  const buckets = [
    { label: "Jacob/app", value: actions.filter((row) => /^Jacob\/app$/i.test(row.owner)).length, color: "#0f766e" },
    { label: "SEO contractor", value: actions.filter((row) => /^SEO contractor$/i.test(row.owner)).length, color: "#2563eb" },
    { label: "Joint", value: actions.filter((row) => /Jacob\/app \+ SEO contractor/i.test(row.owner)).length, color: "#f97316" },
  ];
  return barSvg({ title: "Who owns the citation lift work", rows: buckets, color: "#0f766e" });
}

function renderHtml(data) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT Citation And Visibility Boss Memo</title>
  <style>
    body{margin:0;background:#f6f8fb;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1180px;margin:0 auto;padding:34px 24px 64px}
    h1{font-size:36px;line-height:1.1;margin:0 0 8px}
    h2{font-size:23px;margin:34px 0 12px}
    p,li{line-height:1.55;color:#334155;font-size:15px}
    a{color:#0f766e;overflow-wrap:anywhere}
    code{background:#e2e8f0;border-radius:5px;padding:2px 5px}
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
    @media(max-width:980px){.cards,.grid{grid-template-columns:1fr}h1{font-size:30px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT Citation And Visibility Boss Memo</h1>
  <p>This answers the citation-rate question with current benchmark evidence, owner split, and the next measurable move.</p>

  <div class="note">
    <strong>Answer for Katie:</strong> yes, citation rate is necessary for search-connected AI, but the first bottleneck is still visibility. iBOLT needs to be included and recommended more often before citation work can show full value.
  </div>

  <section class="cards">
    ${metric("Mention rate", `${data.summary.mentionRate}%`, `${data.summary.mentionCount}/${data.summary.totalAnswers} answers mention iBOLT.`)}
    ${metric("Non-branded mention", `${data.summary.nonBrandedMentionRate}%`, `${data.summary.nonBrandedMentionCount}/${data.summary.nonBrandedAnswers} generic buyer answers mention iBOLT.`)}
    ${metric("Top-3 rate", `${data.summary.topThreeRate}%`, `${data.summary.topThreeCount}/${data.summary.totalAnswers} answers recommend iBOLT in the set.`)}
    ${metric("Citation rate", `${data.summary.citationRate}%`, `${data.summary.citationCount}/${data.summary.totalAnswers} answers cite iboltmounts.com.`)}
    ${metric("Competitor-only", `${data.summary.competitorOnlyRate}%`, `${data.summary.competitorOnlyRows}/${data.summary.totalAnswers} answers recommend competitors without iBOLT.`)}
  </section>

  <section class="grid">
    <div class="chart">${data.svgs.kpis}</div>
    <div class="chart">${data.svgs.sequence}</div>
  </section>

  <h2>Why Citation Rate Matters</h2>
  <table>${data.tables.platforms}</table>

  <h2>Where We Are Weakest</h2>
  <section class="grid">
    <div class="chart">${data.svgs.topics}</div>
    <div class="chart">${data.svgs.competitors}</div>
  </section>

  <h2>Who Owns The Work</h2>
  <section class="grid">
    <div class="chart">${data.svgs.ownerSplit}</div>
    <div>${data.tables.ownerSplit}</div>
  </section>

  <h2>First Actions</h2>
  ${data.tables.actions}

  <h2>What To Tell The SEO Contractor</h2>
  ${data.tables.contractor}

  <h2>Evidence Links</h2>
  <ul>
    <li><a href="../source-authority-roadmap/REPORT.html">Source authority roadmap</a></li>
    <li><a href="../citation-uplift-plan/REPORT.html">Citation uplift plan</a></li>
    <li><a href="../citation-rate-visibility-dashboard/REPORT.html">Citation-rate dashboard</a></li>
    <li><a href="../boss-ai-visibility-dashboard/REPORT.html">Boss AI visibility dashboard</a></li>
    <li><a href="../visibility-working-packet/REPORT.html">Visibility working packet</a></li>
  </ul>
</main>
</body>
</html>`;
}

function renderMarkdown(data) {
  return `# iBOLT Citation And Visibility Boss Memo

## Short Answer

Yes, citation rate is necessary for search-connected AI, but the first bottleneck is still visibility. iBOLT needs to be included and recommended more often before citation work can show full value.

## Current Visibility

- Mention rate: ${data.summary.mentionRate}% (${data.summary.mentionCount}/${data.summary.totalAnswers})
- Non-branded mention: ${data.summary.nonBrandedMentionRate}% (${data.summary.nonBrandedMentionCount}/${data.summary.nonBrandedAnswers})
- Top-3 recommendation: ${data.summary.topThreeRate}% (${data.summary.topThreeCount}/${data.summary.totalAnswers})
- Citation rate: ${data.summary.citationRate}% (${data.summary.citationCount}/${data.summary.totalAnswers})
- Competitor-only answers: ${data.summary.competitorOnlyRate}% (${data.summary.competitorOnlyRows}/${data.summary.totalAnswers})

## Recommendation

1. Raise non-branded mention rate first.
2. Move iBOLT into top-3 recommendation sets.
3. Make source-ready pages easier to cite.
4. Have the SEO contractor build third-party mentions and links around the exact refreshed pages.

## First Topics

${data.topicRows.slice(0, 5).map((row) => `- ${row.category}: ${row.zero_mention_queries} zero-mention queries, ${row.competitor_only_answers} competitor-only answers. Source targets: ${row.source_targets}`).join("\n")}

## First Competitors

${data.competitorRows.slice(0, 8).map((row) => `- ${row.competitor || row.brand || row.name}: ${row.lost_answers || row.lost_answer_appearances || row.count || row.priority} pressure score. ${row.external_target || row.target || ""}`).join("\n")}

## Owner Split

${data.actionRows.slice(0, 8).map((row) => `- ${row.owner}: ${row.action} Success metric: ${row.success_metric}`).join("\n")}
`;
}

async function main() {
  const boss = await readJson("boss-visibility-scorecard/boss-scorecard-data.json", { summary: {}, topCompetitors: [] });
  const sourceAuthority = await readJson("source-authority-roadmap/source-authority-data.json", { summary: {}, topicRows: [], competitorRows: [] });
  const topicRows = await readCsv("source-authority-roadmap/topic-source-authority-priority.csv");
  const competitorRows = await readCsv("source-authority-roadmap/competitor-source-opportunities.csv");
  const actionRows = await readCsv("source-authority-roadmap/source-authority-action-plan.csv");
  const contractorRows = await readCsv("citation-uplift-plan/contractor-citation-offload.csv");
  const appRows = await readCsv("citation-uplift-plan/app-citation-workplan.csv");

  const summary = { ...sourceAuthority.summary, ...boss.summary };
  const platformRows = [
    ["Standard ChatGPT", "Mention and top-3 recommendation first", "Often answers without citations, so use it to measure inclusion, ranking, and competitor displacement."],
    ["Standard Claude", "Mention and product-entity accuracy first", "Claude was one of the harsher surfaces, so exact product names and answer-ready page language matter."],
    ["Standard Gemini", "Mention and product-entity accuracy first", "Plain Gemini may not cite, but it still exposes whether iBOLT is understood as a recommendation option."],
    ["Google AI Overviews and Gemini with search", "Citation rate is critical", "These experiences are more source-dependent, so FAQ schema, Article/Product schema, and source-ready solution pages matter."],
    ["Perplexity", "Citation rate is critical", "Perplexity-style answers visibly cite sources, so third-party corroboration and clean page structure should move this metric."],
    ["Voice and AI shopping assistants", "Entity trust plus citations", "These systems need clear brand, product, category, compatibility, and external authority signals."],
  ];

  const ownerRows = [
    ["Jacob/app", "Quick answers, comparison blocks, product modules, schema, internal links, product-name cleanup, retests.", "Makes iboltmounts.com a better source and improves inclusion."],
    ["SEO contractor", "Third-party buyer guides, comparison mentions, partner/reseller citations, industry backlinks.", "Gives AI systems external proof that iBOLT belongs beside competitor defaults."],
    ["Joint", "Competitor adjacency around RAM Mounts, Arkon, iOttie, CTA Digital, ProClip, restaurant, fleet, warehouse, fishing.", "Connects on-site claims to outside corroboration."],
  ];

  const svgs = {
    kpis: kpiSvg(summary),
    sequence: sequenceSvg(summary),
    topics: barSvg({ title: "Topic source authority priority", rows: top(topicRows, "priority", 8), labelKey: "category", valueKey: "priority", color: "#0f766e" }),
    competitors: barSvg({ title: "Competitor source pressure", rows: top(competitorRows, "priority", 8), labelKey: "competitor", valueKey: "priority", color: "#b91c1c" }),
    ownerSplit: ownerSplitSvg(actionRows),
  };

  const data = {
    summary,
    topicRows,
    competitorRows,
    actionRows,
    svgs,
    tables: {
      platforms: table(["AI surface", "What matters most", "Why"], platformRows),
      ownerSplit: table(["Owner", "Work", "Why"], ownerRows),
      actions: table(
        ["Priority", "Owner", "Workstream", "Target", "Action", "Success metric"],
        actionRows.slice(0, 8).map((row) => [row.priority, row.owner, row.workstream, row.target, row.action, row.success_metric]),
      ),
      contractor: table(
        ["Priority", "Category or brand", "Target", "Why", "Success metric"],
        contractorRows.slice(0, 10).map((row) => [row.priority, row.category_or_brand, row.target, row.why, row.success_metric]),
      ),
    },
  };

  const talkingPoints = [
    ["point", "detail"],
    ["Should we improve citation rate?", "Yes, but citation work should follow inclusion and top-3 recovery on competitor-heavy prompts."],
    ["Current visibility", `Mention ${summary.mentionRate}%, non-branded mention ${summary.nonBrandedMentionRate}%, top-3 ${summary.topThreeRate}%, citation ${summary.citationRate}%, competitor-only ${summary.competitorOnlyRate}%.`],
    ["Why citation matters", "Search-connected AI, Perplexity, Google AI Overviews, Gemini with search, voice assistants, and shopping experiences rely more heavily on source trust."],
    ["Why citation is not first", "A cited strategy cannot fix answers that never mention iBOLT. The first lift is getting iBOLT included and recommended."],
    ["What Jacob/app owns", "Source-ready pages: quick answers, exact product names, comparison blocks, FAQ schema, Article/Product schema, internal links, and retesting."],
    ["What SEO contractor owns", "External corroboration: third-party guides, comparison placements, backlinks, partner pages, and category mentions beside competitor defaults."],
  ];

  await mkdir(outDir, { recursive: true });
  await Promise.all(Object.entries(svgs).map(([name, svg]) => writeFile(path.join(outDir, `${name}.svg`), svg)));
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml(data));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown(data));
  await writeFile(path.join(outDir, "boss-talking-points.csv"), csv(talkingPoints));
  await writeFile(path.join(outDir, "citation-platform-priority.csv"), csv([
    ["ai_surface", "what_matters_most", "why"],
    ...platformRows,
  ]));
  await writeFile(path.join(outDir, "owner-split.csv"), csv([
    ["owner", "work", "why"],
    ...ownerRows,
  ]));
  await writeFile(path.join(outDir, "first-citation-actions.csv"), csv([
    ["priority", "owner", "workstream", "target", "action", "success_metric"],
    ...actionRows.slice(0, 12).map((row) => [row.priority, row.owner, row.workstream, row.target, row.action, row.success_metric]),
    ...appRows.slice(0, 8).map((row) => [row.priority, row.owner, "App page cleanup", row.page_or_query, row.action, row.retest_metric]),
  ]));

  console.log(`Wrote ${path.join(outDir, "REPORT.html")}`);
  console.log(`Citation answer: yes, but after mention and recommendation recovery.`);
  console.log(`Visibility: mention ${summary.mentionRate}%, non-branded ${summary.nonBrandedMentionRate}%, top-3 ${summary.topThreeRate}%, citation ${summary.citationRate}%, competitor-only ${summary.competitorOnlyRate}%.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
