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

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(numerator, denominator) {
  return denominator ? Math.round((Number(numerator || 0) / Number(denominator || 1)) * 100) : 0;
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\biBolt\b/g, "iBOLT")
    .replace(/\bIbolt\b/g, "iBOLT")
    .replace(/\bIBOLT\b/g, "iBOLT")
    .replace(/[–—]/g, "-")
    .replace(/budget\/value/gi, "price/value")
    .replace(/budget positioning/gi, "price-led positioning")
    .replace(/cheaper substitute/gi, "price-led substitute")
    .replace(/\s+/g, " ")
    .trim();
}

function splitList(value) {
  return String(value || "")
    .split(";")
    .map((item) => normalizeText(item.trim()))
    .filter(Boolean)
    .filter((item) => !/^\+\d+ more$/i.test(item));
}

function parseRanked(value) {
  const text = normalizeText(value);
  const match = text.match(/^(.+?)[:\s]+(\d+)$/);
  if (!match) return { name: text, value: 0 };
  return { name: match[1].trim(), value: number(match[2]) };
}

function issueCount(issueRows, issue) {
  return number((issueRows || []).find((row) => row.issue === issue)?.count);
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

function barSvg({ title, subtitle, rows, width = 980, height = 430, color = "#0f766e", valueSuffix = "" }) {
  const margin = { top: 78, right: 56, bottom: 36, left: 280 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(...rows.map((row) => number(row.value)), 1);
  const rowHeight = chartHeight / Math.max(rows.length, 1);
  const bars = rows.map((row, index) => {
    const y = margin.top + index * rowHeight + 6;
    const barHeight = Math.max(14, rowHeight - 12);
    const barWidth = Math.round((number(row.value) / maxValue) * chartWidth);
    return `
      <text x="${margin.left - 14}" y="${y + barHeight / 2 + 5}" text-anchor="end" font-size="14" fill="#334155">${escapeHtml(row.name)}</text>
      <rect x="${margin.left}" y="${y}" width="${barWidth}" height="${barHeight}" rx="6" fill="${color}"></rect>
      <text x="${margin.left + barWidth + 10}" y="${y + barHeight / 2 + 5}" font-size="14" font-weight="800" fill="#0f172a">${escapeHtml(row.value)}${escapeHtml(valueSuffix)}</text>
    `;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <text x="28" y="36" font-size="25" font-weight="900" fill="#0f172a">${escapeHtml(title)}</text>
  <text x="28" y="62" font-size="14" fill="#64748b">${escapeHtml(subtitle)}</text>
  ${bars}
</svg>`;
}

function kpiFunnelSvg({ rows, width = 980, height = 360 }) {
  const left = 42;
  const top = 92;
  const gap = 12;
  const cardWidth = (width - left * 2 - gap * (rows.length - 1)) / rows.length;
  const maxValue = Math.max(...rows.map((row) => number(row.value)), 1);
  const cards = rows.map((row, index) => {
    const x = left + index * (cardWidth + gap);
    const barHeight = Math.max(8, Math.round((number(row.value) / maxValue) * 70));
    const color = row.value === 0 ? "#dc2626" : index >= 3 ? "#f59e0b" : "#2563eb";
    return `
      <rect x="${x}" y="${top}" width="${cardWidth}" height="190" rx="14" fill="#ffffff" stroke="#d7dee8"/>
      <text x="${x + 16}" y="${top + 32}" font-size="12" font-weight="900" fill="#64748b">${escapeHtml(row.label)}</text>
      <text x="${x + 16}" y="${top + 78}" font-size="36" font-weight="900" fill="#0f172a">${escapeHtml(row.rate)}%</text>
      <text x="${x + 17}" y="${top + 107}" font-size="14" fill="#475569">${escapeHtml(row.value)}/${escapeHtml(row.denominator)}</text>
      <rect x="${x + 16}" y="${top + 146}" width="${cardWidth - 32}" height="74" rx="9" fill="#f1f5f9"/>
      <rect x="${x + 16}" y="${top + 220 - barHeight}" width="${cardWidth - 32}" height="${barHeight}" rx="9" fill="${color}"/>
      <text x="${x + 16}" y="${top + 256}" font-size="11" fill="#64748b">${escapeHtml(row.note)}</text>
    `;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#f8fafc"/>
  <text x="28" y="38" font-size="26" font-weight="900" fill="#0f172a">Mention To Citation Funnel</text>
  <text x="28" y="64" font-size="14" fill="#64748b">Citation rate is downstream from awareness, recommendation, and source trust.</text>
  ${cards}
</svg>`;
}

function groupedCompetitorSvg({ rows, width = 980, height = 440 }) {
  const margin = { top: 78, right: 70, bottom: 48, left: 200 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(...rows.flatMap((row) => [number(row.replacements), number(row.coMentions)]), 1);
  const rowHeight = chartHeight / Math.max(rows.length, 1);
  const bars = rows.map((row, index) => {
    const y = margin.top + index * rowHeight + 6;
    const h = Math.max(10, (rowHeight - 16) / 2);
    const replacementWidth = Math.round((number(row.replacements) / maxValue) * chartWidth);
    const coWidth = Math.round((number(row.coMentions) / maxValue) * chartWidth);
    return `
      <text x="${margin.left - 14}" y="${y + h + 4}" text-anchor="end" font-size="14" fill="#334155">${escapeHtml(row.brand)}</text>
      <rect x="${margin.left}" y="${y}" width="${replacementWidth}" height="${h}" rx="5" fill="#dc2626"></rect>
      <rect x="${margin.left}" y="${y + h + 5}" width="${coWidth}" height="${h}" rx="5" fill="#2563eb"></rect>
      <text x="${margin.left + replacementWidth + 8}" y="${y + h - 2}" font-size="12" font-weight="800" fill="#0f172a">${escapeHtml(row.replacements)}</text>
      <text x="${margin.left + coWidth + 8}" y="${y + h * 2 + 3}" font-size="12" font-weight="800" fill="#0f172a">${escapeHtml(row.coMentions)}</text>
    `;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <text x="28" y="36" font-size="25" font-weight="900" fill="#0f172a">Competitor Replacement vs Co-Mention</text>
  <text x="28" y="62" font-size="14" fill="#64748b">Red means AI answered with the competitor and not iBOLT. Blue means iBOLT appeared beside that competitor.</text>
  <rect x="${width - 286}" y="30" width="13" height="13" rx="3" fill="#dc2626"/><text x="${width - 267}" y="41" font-size="12" fill="#475569">replacement pressure</text>
  <rect x="${width - 136}" y="30" width="13" height="13" rx="3" fill="#2563eb"/><text x="${width - 117}" y="41" font-size="12" fill="#475569">co-mentions</text>
  ${bars}
</svg>`;
}

function providerOutcomeSvg({ rows, width = 980, height = 340 }) {
  const margin = { top: 78, right: 50, bottom: 46, left: 140 };
  const chartWidth = width - margin.left - margin.right;
  const rowHeight = 62;
  const colors = {
    clean: "#16a34a",
    co: "#2563eb",
    replacement: "#dc2626",
    none: "#94a3b8",
  };
  const bars = rows.map((row, index) => {
    const y = margin.top + index * rowHeight;
    let x = margin.left;
    const total = Math.max(number(row.total), 1);
    const segments = [
      ["clean", number(row.cleanMentions), "clean"],
      ["co", number(row.coMentions), "co-mentioned"],
      ["replacement", number(row.competitorReplacements), "competitor replacement"],
      ["none", number(row.noSignal), "no signal"],
    ];
    const segmentSvg = segments.map(([key, value, label]) => {
      const w = Math.round((value / total) * chartWidth);
      const text = value && w > 35 ? `<text x="${x + 8}" y="${y + 28}" font-size="12" font-weight="800" fill="#ffffff">${value}</text>` : "";
      const out = `<rect x="${x}" y="${y + 8}" width="${w}" height="32" rx="5" fill="${colors[key]}"><title>${escapeHtml(label)}: ${value}</title></rect>${text}`;
      x += w;
      return out;
    }).join("");
    return `
      <text x="${margin.left - 14}" y="${y + 30}" text-anchor="end" font-size="15" font-weight="800" fill="#334155">${escapeHtml(row.provider)}</text>
      ${segmentSvg}
    `;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <text x="28" y="36" font-size="25" font-weight="900" fill="#0f172a">Provider Outcome Split</text>
  <text x="28" y="62" font-size="14" fill="#64748b">Claude is currently the harshest replacement provider. ChatGPT has the most recoverable co-mentions.</text>
  <rect x="500" y="30" width="12" height="12" rx="3" fill="${colors.clean}"/><text x="518" y="40" font-size="12" fill="#475569">clean</text>
  <rect x="570" y="30" width="12" height="12" rx="3" fill="${colors.co}"/><text x="588" y="40" font-size="12" fill="#475569">co-mentioned</text>
  <rect x="692" y="30" width="12" height="12" rx="3" fill="${colors.replacement}"/><text x="710" y="40" font-size="12" fill="#475569">replacement</text>
  <rect x="820" y="30" width="12" height="12" rx="3" fill="${colors.none}"/><text x="838" y="40" font-size="12" fill="#475569">no signal</text>
  ${bars}
</svg>`;
}

function topProviderRows(providerRows = []) {
  return providerRows.map((row) => ({
    provider: row.provider,
    total: number(row.totalAnswers ?? row.total),
    cleanMentions: number(row.cleanMentions ?? row["clean iBOLT mention"]),
    coMentions: number(row.coMentions ?? row["co-mentioned"]),
    competitorReplacements: number(row.competitorReplacements ?? row["competitor replacement"]),
    noSignal: number(row.noSignal ?? row["no usable brand signal"]),
    action: normalizeText(row.advice?.pageMove || row.advice?.citationMove || ""),
  }));
}

function buildMarkdown({ summary, funnelRows, providerRows, competitorRows, categoryRows, pageRows, retestRows, contractorSummary, workplanRows, bodyIssueRows, bodyTopRows }) {
  return `# iBOLT Citation Rate And AI Visibility Dashboard

## Short Answer

Yes, citation rate should be tracked. It is not the only KPI, because normal non-search ChatGPT and Claude answers may not cite sources. But for Google AI Overviews, Perplexity, Gemini with search, ChatGPT search, and shopping assistants, citation rate is the clearest sign that AI systems trust iboltmounts.com as a source.

Current baseline:

- Overall mention rate: ${summary.mentionRate}% (${summary.mentionCount}/${summary.totalAnswers})
- Non-branded mention rate: ${summary.nonBrandedMentionRate}% (${summary.nonBrandedMentionCount}/${summary.nonBrandedAnswers})
- Top-3 recommendation rate: ${summary.topThreeRate}% (${summary.topThreeCount}/${summary.totalAnswers})
- Target-domain citation rate: ${summary.citationRate}% (${summary.citationCount}/${summary.totalAnswers})
- Competitor replacement rows: ${summary.competitorOnlyRows}/${summary.totalAnswers}
- Live blog pages audited: ${summary.livePages}
- Body-scored blog pages: ${summary.bodyPages}, average body score ${summary.bodyAvgScore}

## On-Site Citation Blockers From Body Inspection

The body inspection now covers ${summary.bodyPages} pages with ${summary.bodyFailed} failed rows. The biggest blockers to citation readiness are:

| Body issue | Pages |
| --- | ---: |
${bodyIssueRows.map((row) => `| ${row.issue} | ${row.count} |`).join("\n")}

First pages to clean up from the combined body/opportunity queue:

${bodyTopRows.map((row) => `- ${row.title} (${row.category}, body ${row.bodyScore}, opportunity ${row.opportunityScore}): ${row.topFix}`).join("\n")}

## Visibility Funnel

${funnelRows.map((row) => `- ${row.label}: ${row.rate}% (${row.value}/${row.denominator})`).join("\n")}

## Provider Read

| Provider | Clean mentions | Co-mentions | Competitor replacements | No signal | Immediate move |
| --- | ---: | ---: | ---: | ---: | --- |
${providerRows.map((row) => `| ${row.provider} | ${row.cleanMentions} | ${row.coMentions} | ${row.competitorReplacements} | ${row.noSignal} | ${row.action || "Use mapped page refreshes and retest one prompt at a time."} |`).join("\n")}

## Who iBOLT Is Mentioned Next To Or Replaced By

| Competitor | Replacement rows | Co-mentions with iBOLT | Main categories | Counter-positioning |
| --- | ---: | ---: | --- | --- |
${competitorRows.map((row) => `| ${row.brand} | ${row.replacements} | ${row.coMentions} | ${row.categories.join("; ")} | ${row.counterPositioning} |`).join("\n")}

## Citation Topics To Push First

| Category | Priority | Pages | Competitor-only answers | Source targets |
| --- | ---: | ---: | ---: | --- |
${categoryRows.map((row) => `| ${row.category} | ${row.priority} | ${row.pages} | ${row.competitorOnlyAnswers} | ${row.sourceTargets} |`).join("\n")}

## Pages To Make Source-Ready First

${pageRows.map((row) => `- ${row.page} (${row.category}, priority ${row.priority}): ${row.action}`).join("\n")}

## Retest Queue

${retestRows.map((row) => `- ${row.query}: ${row.action}`).join("\n")}

## Citation Priority Model

- [Citation priority model](../citation-priority-model/REPORT.html): ranked page, topic, competitor, and platform sequence for deciding when citation work should happen.

## SEO Contractor Handoff

The contractor packet currently has ${contractorSummary.topicBriefs || 0} topic briefs, ${contractorSummary.competitorBriefs || 0} competitor adjacency briefs, ${contractorSummary.week1Tasks || 0} Week 1 outreach tasks, ${contractorSummary.targetPages || 0} target pages, and ${contractorSummary.retestPrompts || 0} retest prompts.

## Workplan

| Owner | Workstream | Why | Success metric |
| --- | --- | --- | --- |
${workplanRows.map((row) => `| ${row.owner} | ${row.workstream} | ${row.why} | ${row.successMetric} |`).join("\n")}
`;
}

function buildHtml({ summary, providerRows, competitorRows, categoryRows, pageRows, retestRows, contractorSummary, workplanRows, bodyIssueRows, bodyTopRows }) {
  const cards = [
    ["Mention rate", `${summary.mentionRate}%`, `${summary.mentionCount}/${summary.totalAnswers} answers mention iBOLT`],
    ["Non-branded mention", `${summary.nonBrandedMentionRate}%`, `${summary.nonBrandedMentionCount}/${summary.nonBrandedAnswers} buyer prompts`],
    ["Top-3 recommendation", `${summary.topThreeRate}%`, `${summary.topThreeCount}/${summary.totalAnswers} answer rows`],
    ["Citation rate", `${summary.citationRate}%`, `${summary.citationCount}/${summary.totalAnswers} cited iboltmounts.com`],
    ["Competitor replacement", `${summary.competitorOnlyRate}%`, `${summary.competitorOnlyRows}/${summary.totalAnswers} rows`],
    ["Live pages audited", summary.livePages, `${summary.citationCleanupPages} need citation/schema cleanup`],
    ["Body pages scored", summary.bodyPages, `${summary.bodyAvgScore} average body score`],
    ["Missing quick answer", summary.bodyMissingQuickAnswer, "pages need answer-first openings"],
    ["Contractor tasks", contractorSummary.week1Tasks || 0, `${contractorSummary.competitorBriefs || 0} competitor briefs`],
    ["Expanded retest plan", summary.expandedPrompts || 0, `${summary.providerRequests || 0} provider requests`],
  ].map(([label, value, note]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");

  const competitorRowsHtml = competitorRows.map((row) => `<tr><td>${escapeHtml(row.brand)}</td><td>${row.replacements}</td><td>${row.coMentions}</td><td>${escapeHtml(row.categories.join("; "))}</td><td>${escapeHtml(row.counterPositioning)}</td></tr>`).join("");
  const providerRowsHtml = providerRows.map((row) => `<tr><td>${escapeHtml(row.provider)}</td><td>${row.cleanMentions}</td><td>${row.coMentions}</td><td>${row.competitorReplacements}</td><td>${row.noSignal}</td><td>${escapeHtml(row.action || "Use mapped page refreshes and retest one prompt at a time.")}</td></tr>`).join("");
  const categoryRowsHtml = categoryRows.map((row) => `<tr><td>${escapeHtml(row.category)}</td><td>${row.priority}</td><td>${row.pages}</td><td>${row.competitorOnlyAnswers}</td><td>${escapeHtml(row.sourceTargets)}</td></tr>`).join("");
  const pageRowsHtml = pageRows.map((row) => `<tr><td><a href="${escapeHtml(row.url)}">${escapeHtml(row.page)}</a></td><td>${escapeHtml(row.category)}</td><td>${row.priority}</td><td>${escapeHtml(row.competitors.join("; "))}</td><td>${escapeHtml(row.action)}</td></tr>`).join("");
  const retestRowsHtml = retestRows.map((row) => `<tr><td>${escapeHtml(row.query)}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.baselineMentionRate)}</td><td>${escapeHtml(row.competitorOnlyAnswers)}</td><td><a href="${escapeHtml(row.mappedPage)}">mapped page</a></td><td>${escapeHtml(row.action)}</td></tr>`).join("");
  const workplanRowsHtml = workplanRows.map((row) => `<tr><td>${escapeHtml(row.owner)}</td><td>${escapeHtml(row.workstream)}</td><td>${escapeHtml(row.why)}</td><td>${escapeHtml(row.successMetric)}</td></tr>`).join("");
  const bodyIssueRowsHtml = bodyIssueRows.map((row) => `<tr><td>${escapeHtml(row.issue)}</td><td>${row.count}</td></tr>`).join("");
  const bodyTopRowsHtml = bodyTopRows.map((row) => `<tr><td><a href="${escapeHtml(row.url)}">${escapeHtml(row.title)}</a></td><td>${escapeHtml(row.category)}</td><td>${row.bodyScore}</td><td>${row.opportunityScore}</td><td>${escapeHtml(row.topFix)}</td></tr>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT Citation Rate And AI Visibility Dashboard</title>
  <style>
    :root{color-scheme:light;--ink:#0f172a;--muted:#475569;--line:#d7dee8;--soft:#f8fafc}
    body{margin:0;background:var(--soft);color:var(--ink);font-family:Arial,Helvetica,sans-serif}
    main{max-width:1180px;margin:0 auto;padding:34px 24px 70px}
    h1{font-size:36px;line-height:1.08;margin:0 0 10px}
    h2{font-size:23px;margin:36px 0 12px}
    p,li{line-height:1.55;color:#334155}
    a{color:#0f766e}
    .lede{font-size:18px;max-width:940px}
    .cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:24px 0}
    .card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:900}
    .value{font-size:32px;font-weight:900;margin:8px 0 2px}
    .callout{background:#fff;border-left:6px solid #0f766e;border-top:1px solid var(--line);border-right:1px solid var(--line);border-bottom:1px solid var(--line);border-radius:12px;padding:16px 18px;margin:18px 0}
    .warning{border-left-color:#dc2626}
    img{max-width:100%;height:auto;background:#fff;border:1px solid var(--line);border-radius:12px;margin:12px 0}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden;margin:10px 0 24px}
    th,td{text-align:left;vertical-align:top;padding:11px;border-bottom:1px solid #edf2f7;font-size:14px}
    th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:12px;letter-spacing:.04em}
    @media(max-width:920px){.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT Citation Rate And AI Visibility Dashboard</h1>
  <p class="lede">iBOLT has AI visibility, but the current benchmark shows a trust gap. The brand is mentioned in ${summary.mentionRate}% of tested answers and appears as a top-3 recommendation in ${summary.topThreeRate}%, but iboltmounts.com is cited in ${summary.citationRate}%. That makes citation rate a necessary KPI for AI search surfaces, while mention rate and top-3 rate remain the faster leading indicators.</p>
  <div class="cards">${cards}</div>
  <div class="callout"><strong>Decision:</strong> Track citation rate, but do not optimize only for citations. First make iBOLT unavoidable in category answers, then make the pages source-ready, then use contractor-led off-site mentions to give search-connected AI systems corroborating sources.</div>
  <div class="callout warning"><strong>Current risk:</strong> ${summary.competitorOnlyRows}/${summary.totalAnswers} tested answers still replace iBOLT with competitors. The highest-pressure brands are ${competitorRows.slice(0, 6).map((row) => row.brand).join(", ")}.</div>

  <h2>On-Site Citation Blockers</h2>
  <p>The body inspection now scores ${summary.bodyPages} pages with ${summary.bodyFailed} failed rows. Before external citation work can compound, the priority pages need answer-first openings, FAQ/schema cleanup, comparison blocks, and cleaner product paths.</p>
  <div class="grid">
    <table><thead><tr><th>Body issue</th><th>Pages</th></tr></thead><tbody>${bodyIssueRowsHtml}</tbody></table>
    <table><thead><tr><th>Page</th><th>Category</th><th>Body</th><th>Opportunity</th><th>Top fix</th></tr></thead><tbody>${bodyTopRowsHtml}</tbody></table>
  </div>

  <h2>Funnel And Provider View</h2>
  <img src="citation-funnel.svg" alt="Mention to citation funnel"/>
  <img src="provider-outcomes.svg" alt="Provider outcome split"/>

  <h2>Competitor And Topic Pressure</h2>
  <div class="grid">
    <div><img src="competitor-replacement-vs-co-mention.svg" alt="Competitor replacement versus co-mention"/></div>
    <div><img src="category-citation-priority.svg" alt="Category citation priority"/></div>
  </div>

  <h2>Provider Read</h2>
  <table><thead><tr><th>Provider</th><th>Clean</th><th>Co-mentioned</th><th>Replacement</th><th>No signal</th><th>Immediate move</th></tr></thead><tbody>${providerRowsHtml}</tbody></table>

  <h2>Who iBOLT Is Mentioned Next To Or Replaced By</h2>
  <table><thead><tr><th>Competitor</th><th>Replacement rows</th><th>Co-mentions</th><th>Main categories</th><th>Counter-positioning</th></tr></thead><tbody>${competitorRowsHtml}</tbody></table>

  <h2>Citation Topics To Push First</h2>
  <table><thead><tr><th>Category</th><th>Priority</th><th>Pages</th><th>Competitor-only answers</th><th>Source targets</th></tr></thead><tbody>${categoryRowsHtml}</tbody></table>

  <h2>Pages To Make Source-Ready First</h2>
  <table><thead><tr><th>Page</th><th>Category</th><th>Priority</th><th>Competitors</th><th>Action</th></tr></thead><tbody>${pageRowsHtml}</tbody></table>

  <h2>Retest Queue</h2>
  <table><thead><tr><th>Prompt</th><th>Category</th><th>Baseline mention</th><th>Competitor-only</th><th>Mapped page</th><th>Retest action</th></tr></thead><tbody>${retestRowsHtml}</tbody></table>

  <h2>Citation Priority Model</h2>
  <div class="callout"><strong>Next operating artifact:</strong> <a href="../citation-priority-model/REPORT.html">Open the citation priority model</a> for the ranked page, topic, competitor, and platform sequence. It keeps citation outreach behind the inclusion, product-name, and source-readiness gates.</div>

  <h2>Workplan</h2>
  <table><thead><tr><th>Owner</th><th>Workstream</th><th>Why</th><th>Success metric</th></tr></thead><tbody>${workplanRowsHtml}</tbody></table>
</main>
</body>
</html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outputDir = path.join(benchmarkDir, "citation-rate-visibility-dashboard");
  await mkdir(outputDir, { recursive: true });

  const boss = await readJsonIfExists(path.join(benchmarkDir, "boss-visibility-scorecard", "boss-scorecard-data.json"), { summary: {} });
  const coMention = await readJsonIfExists(path.join(benchmarkDir, "co-mention-network", "co-mention-network-data.json"), { summary: {}, competitorRows: [] });
  const answerEvidence = await readJsonIfExists(path.join(benchmarkDir, "answer-evidence-viewer", "answer-evidence-viewer-data.json"), { providerRows: [] });
  const providerStrategy = await readJsonIfExists(path.join(benchmarkDir, "provider-strategy-report", "provider-strategy-data.json"), { providerRows: [] });
  const citationReadiness = await readJsonIfExists(path.join(benchmarkDir, "citation-readiness-map", "citation-readiness-data.json"), { pageRows: [], topicRows: [] });
  const sourceAuthority = await readJsonIfExists(path.join(benchmarkDir, "source-authority-roadmap", "source-authority-data.json"), { summary: {}, topicRows: [], actionRows: [], retestRows: [] });
  const contractor = await readJsonIfExists(path.join(benchmarkDir, "contractor-citation-packet", "contractor-citation-data.json"), { summary: {} });
  const testCoverage = await readJsonIfExists(path.join(benchmarkDir, "test-area-coverage-audit", "test-area-coverage-data.json"), { summary: {} });
  const bodyInspection = await readJsonIfExists(path.join(benchmarkDir, "blog-body-inspection", "blog-body-inspection-data.json"), { summary: {} });
  const bodySummary = bodyInspection.summary || {};
  const bodyIssueRows = (bodySummary.issueRows || []).slice(0, 10);

  const summary = {
    ...boss.summary,
    competitorOnlyRate: pct(boss.summary.competitorOnlyRows, boss.summary.totalAnswers),
    livePages: boss.summary.livePages,
    citationCleanupPages: boss.summary.citationCleanupPages,
    expandedPrompts: testCoverage.summary.expandedPrompts || boss.summary.expandedPrompts,
    providerRequests: testCoverage.summary.providerRequests || boss.summary.providerRequests,
    bodyPages: bodySummary.pages || 0,
    bodyFetched: bodySummary.fetched || 0,
    bodyFailed: bodySummary.failed || 0,
    bodyAvgScore: bodySummary.avgBodyScore || 0,
    bodyMissingQuickAnswer: bodySummary.missingQuickAnswer || issueCount(bodyIssueRows, "missing early quick answer"),
    bodyMissingFaqSchema: issueCount(bodySummary.issueRows, "missing FAQPage schema"),
    bodyMissingArticleSchema: issueCount(bodySummary.issueRows, "missing Article/BlogPosting schema"),
    bodyRepeatedCartCtas: bodySummary.repeatedCartCtas || issueCount(bodySummary.issueRows, "too many cart CTAs"),
    bodyWeakInternalLinks: bodySummary.weakInternalLinks || issueCount(bodySummary.issueRows, "weak internal blog links"),
    bodyComparisonGap: issueCount(bodySummary.issueRows, "missing comparison/tradeoff language"),
    bodyMissingImageAlt: issueCount(bodySummary.issueRows, "missing image alt text"),
  };

  const funnelRows = [
    {
      label: "Any iBOLT mention",
      value: summary.mentionCount,
      denominator: summary.totalAnswers,
      rate: summary.mentionRate,
      note: "awareness",
    },
    {
      label: "Non-branded mention",
      value: summary.nonBrandedMentionCount,
      denominator: summary.nonBrandedAnswers,
      rate: summary.nonBrandedMentionRate,
      note: "new buyer prompts",
    },
    {
      label: "Top-3 recommendation",
      value: summary.topThreeCount,
      denominator: summary.totalAnswers,
      rate: summary.topThreeRate,
      note: "recommendation",
    },
    {
      label: "Clean mention",
      value: coMention.summary.cleanMentionRows || 0,
      denominator: summary.totalAnswers,
      rate: pct(coMention.summary.cleanMentionRows || 0, summary.totalAnswers),
      note: "not dependent on competitors",
    },
    {
      label: "Domain citation",
      value: summary.citationCount,
      denominator: summary.totalAnswers,
      rate: summary.citationRate,
      note: "source trust",
    },
  ];

  const strategyByProvider = new Map((providerStrategy.providerRows || []).map((row) => [row.provider, row]));
  const providerRows = topProviderRows(answerEvidence.providerRows || []).map((row) => {
    const strategy = strategyByProvider.get(row.provider);
    return {
      ...row,
      action: normalizeText(strategy?.advice?.citationMove || strategy?.advice?.pageMove || row.action),
    };
  });

  const competitorRows = (coMention.competitorRows || [])
    .slice()
    .sort((a, b) => number(b.replacementPressure) - number(a.replacementPressure))
    .slice(0, 10)
    .map((row) => ({
      brand: normalizeText(row.brand),
      replacements: number(row.replacementPressure ?? row.withoutIbolt),
      coMentions: number(row.withIbolt),
      coMentionRate: number(row.coMentionRate),
      categories: (row.categories || []).map(normalizeText).slice(0, 6),
      counterPositioning: normalizeText(row.counterPositioning),
    }));

  const categoryRows = (sourceAuthority.topicRows?.length ? sourceAuthority.topicRows : citationReadiness.topicRows || [])
    .slice()
    .sort((a, b) => number(b.priority ?? b.citation_priority) - number(a.priority ?? a.citation_priority))
    .slice(0, 8)
    .map((row) => ({
      category: normalizeText(row.category),
      priority: number(row.priority ?? row.citation_priority),
      pages: number(row.live_pages ?? row.pages),
      competitorOnlyAnswers: number(row.competitor_only_answers),
      sourceTargets: normalizeText(row.source_targets),
      contractorWhy: normalizeText(row.contractor_why),
    }));

  const pageRows = (citationReadiness.pageRows || [])
    .slice()
    .sort((a, b) => number(b.citation_priority) - number(a.citation_priority))
    .slice(0, 14)
    .map((row) => ({
      page: normalizeText(row.page),
      url: row.url,
      category: normalizeText(row.category),
      priority: number(row.citation_priority),
      competitors: splitList(row.competitors).slice(0, 7),
      products: splitList(row.products_to_feature).slice(0, 5),
      action: normalizeText(row.next_citation_action || row.app_work_action),
      retestPrompts: splitList(row.retest_prompts),
    }));

  const retestRows = (sourceAuthority.retestRows || [])
    .slice(0, 16)
    .map((row) => ({
      priority: number(row.priority),
      query: normalizeText(row.query),
      category: normalizeText(row.category),
      baselineMentionRate: normalizeText(row.baseline_mention_rate),
      competitorOnlyAnswers: normalizeText(row.competitor_only_answers),
      mappedPage: row.mapped_page,
      action: normalizeText(row.retest_action),
    }));

  const bodyTopRows = (bodySummary.topCombinedProblems || [])
    .slice(0, 12)
    .map((row) => ({
      title: normalizeText(row.title),
      url: row.url,
      category: normalizeText(row.category),
      bodyScore: number(row.bodyScore),
      opportunityScore: number(row.opportunityScore),
      topFix: normalizeText(row.topFix),
    }));

  const workplanRows = [
    {
      owner: "Jacob/app",
      workstream: "Mention-rate foundation",
      why: `Only ${summary.nonBrandedMentionCount}/${summary.nonBrandedAnswers} non-branded answers mention iBOLT.`,
      successMetric: "Move non-branded mention rate from 5% toward 15% on comparable retest prompts.",
    },
    {
      owner: "Jacob/app",
      workstream: "Source-ready page cleanup",
      why: `${summary.bodyMissingQuickAnswer}/${summary.bodyPages} pages lack answer-first openings, ${summary.bodyMissingFaqSchema} lack FAQPage schema, and ${summary.bodyComparisonGap} need comparison/tradeoff language.`,
      successMetric: "Quick-answer blocks, FAQ schema, Article schema, comparison blocks, and clean product paths present on priority pages.",
    },
    {
      owner: "Jacob/app",
      workstream: "Competitor comparison blocks",
      why: `${summary.competitorOnlyRows}/${summary.totalAnswers} answers still replace iBOLT with competitors.`,
      successMetric: "Competitor-only rows decline and top-3 iBOLT recommendations rise.",
    },
    {
      owner: "SEO contractor",
      workstream: "External citation authority",
      why: `Target-domain citation rate is ${summary.citationRate}% while AI systems cite or recommend competitors in the same categories.`,
      successMetric: "Reach 3% to 5% citation rate first, then push toward the 8% planning target.",
    },
    {
      owner: "SEO contractor",
      workstream: "Competitor adjacency mentions",
      why: `${competitorRows.slice(0, 6).map((row) => row.brand).join(", ")} are the main replacement set.`,
      successMetric: "Earn third-party mentions that place iBOLT beside those brands in neutral category resources.",
    },
    {
      owner: "Jacob/app + SEO contractor",
      workstream: "Retest loop",
      why: `${retestRows.length} priority retest prompts are mapped to pages and competitor pressure.`,
      successMetric: "Rerun one prompt at a time after on-site edits and external mentions are live.",
    },
  ];

  const competitorTargetRows = competitorRows.map((row) => [
    "competitor",
    row.brand,
    row.replacements,
    row.coMentions,
    row.categories.join("; "),
    row.counterPositioning,
  ]);

  const citationWorkRows = [
    ["owner", "workstream", "why", "success_metric"],
    ...workplanRows.map((row) => [row.owner, row.workstream, row.why, row.successMetric]),
  ];

  const providerPlanRows = [
    ["provider", "clean_mentions", "co_mentions", "competitor_replacements", "no_signal", "immediate_move"],
    ...providerRows.map((row) => [row.provider, row.cleanMentions, row.coMentions, row.competitorReplacements, row.noSignal, row.action]),
  ];

  await writeFile(path.join(outputDir, "citation-funnel.svg"), kpiFunnelSvg({ rows: funnelRows }));
  await writeFile(path.join(outputDir, "provider-outcomes.svg"), providerOutcomeSvg({ rows: providerRows }));
  await writeFile(path.join(outputDir, "competitor-replacement-vs-co-mention.svg"), groupedCompetitorSvg({ rows: competitorRows }));
  await writeFile(path.join(outputDir, "category-citation-priority.svg"), barSvg({
    title: "Citation Priority By Category",
    subtitle: "Priority combines page readiness, benchmark pressure, and competitor displacement.",
    rows: categoryRows.map((row) => ({ name: row.category, value: row.priority })),
    color: "#7c3aed",
  }));

  await writeFile(path.join(outputDir, "citation-workplan.csv"), toCsv(citationWorkRows));
  await writeFile(path.join(outputDir, "competitor-citation-targets.csv"), toCsv([
    ["type", "brand", "replacement_rows", "co_mentions", "categories", "counter_positioning"],
    ...competitorTargetRows,
  ]));
  await writeFile(path.join(outputDir, "provider-retention-plan.csv"), toCsv(providerPlanRows));
  await writeFile(path.join(outputDir, "source-ready-page-queue.csv"), toCsv([
    ["priority", "category", "page", "url", "competitors", "products_to_feature", "action", "retest_prompts"],
    ...pageRows.map((row) => [row.priority, row.category, row.page, row.url, row.competitors, row.products, row.action, row.retestPrompts]),
  ]));
  await writeFile(path.join(outputDir, "body-citation-blockers.csv"), toCsv([
    ["issue", "pages"],
    ...bodyIssueRows.map((row) => [row.issue, row.count]),
  ]));
  await writeFile(path.join(outputDir, "body-citation-first-fix-pages.csv"), toCsv([
    ["rank", "body_score", "opportunity_score", "category", "title", "url", "top_fix"],
    ...bodyTopRows.map((row, index) => [index + 1, row.bodyScore, row.opportunityScore, row.category, row.title, row.url, row.topFix]),
  ]));

  const data = {
    generatedAt: new Date().toISOString(),
    benchmarkDir,
    summary,
    contractorSummary: contractor.summary || {},
    funnelRows,
    providerRows,
    competitorRows,
    categoryRows,
    pageRows,
    retestRows,
    workplanRows,
    bodyIssueRows,
    bodyTopRows,
  };
  await writeFile(path.join(outputDir, "citation-rate-visibility-data.json"), JSON.stringify(data, null, 2));
  await writeFile(path.join(outputDir, "REPORT.md"), buildMarkdown({
    summary,
    funnelRows,
    providerRows,
    competitorRows,
    categoryRows,
    pageRows,
    retestRows,
    contractorSummary: contractor.summary || {},
    workplanRows,
    bodyIssueRows,
    bodyTopRows,
  }));
  await writeFile(path.join(outputDir, "REPORT.html"), buildHtml({
    summary,
    providerRows,
    competitorRows,
    categoryRows,
    pageRows,
    retestRows,
    contractorSummary: contractor.summary || {},
    workplanRows,
    bodyIssueRows,
    bodyTopRows,
  }));

  console.log(`Wrote citation-rate visibility dashboard to ${outputDir}`);
  console.log(`Citation rate: ${summary.citationRate}% (${summary.citationCount}/${summary.totalAnswers})`);
  console.log(`Competitor replacement rows: ${summary.competitorOnlyRows}/${summary.totalAnswers}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
