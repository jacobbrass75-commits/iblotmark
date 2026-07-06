#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "category-provider-priority-report");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted && char === '"' && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => String(value).trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some((value) => String(value).trim())) rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows.shift();
  return rows.map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""])));
}

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

function num(value) {
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(numerator, denominator) {
  return denominator ? Math.round((numerator / denominator) * 100) : 0;
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function csv(rows) {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function short(value, length = 150) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 3).trim()}...` : text;
}

function splitList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value ?? "")
    .split(/[;|/]/)
    .map((item) => item.trim())
    .filter((item) => !/^none$/i.test(item))
    .filter(Boolean);
}

function addCount(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function topCounts(map, limit = 8) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => `${key} ${count}`);
}

function stripCountLabel(value) {
  return String(value ?? "").replace(/\s+\d+$/, "").trim();
}

function chooseMountCompetitor(value) {
  const preferred = [
    "RAM Mounts",
    "Arkon",
    "iOttie",
    "CTA Digital",
    "ProClip",
    "Mount-It",
    "Havis",
    "Tackform",
    "Square",
    "Bouncepad",
    "Heckler",
    "Kensington",
    "Scosche",
    "Peak Design",
    "Belkin",
    "YakAttack",
    "Scotty",
  ];
  const entities = splitList(value).map(stripCountLabel);
  return preferred.find((brand) => entities.some((entity) => entity.toLowerCase() === brand.toLowerCase())) || entities[0] || "RAM Mounts";
}

function avg(values) {
  const numbers = values.map(num).filter((value) => Number.isFinite(value));
  return numbers.length ? Math.round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length) : 0;
}

function issueCount(rows, issue) {
  return rows.filter((row) => String(row.issues || "").includes(issue)).length;
}

function providerCells(row) {
  const text = String(row.provider_cells || "");
  const providers = ["ChatGPT", "Gemini", "Claude"];
  return providers.map((provider, index) => {
    const start = text.indexOf(`${provider}:`);
    if (start === -1) return null;
    const nextStarts = providers
      .filter((candidate) => candidate !== provider)
      .map((candidate) => text.indexOf(`${candidate}:`, start + 1))
      .filter((value) => value > start);
    const end = nextStarts.length ? Math.min(...nextStarts) : text.length;
    return { provider, text: text.slice(start, end).replace(new RegExp(`^${provider}:\\s*`), "").trim() };
  }).filter(Boolean);
}

function providerStatus(cell) {
  if (/missed/i.test(cell.text)) return "missed";
  if (/mentioned/i.test(cell.text)) return "mentioned";
  return "unknown";
}

function providerCompetitors(cell) {
  const match = cell.text.match(/competitors\s+(.+)$/i);
  return match ? splitList(match[1]) : [];
}

function categoryMove(category, row) {
  const competitors = String(row.topCompetitors || row.top_competitors || "");
  const topCompetitor = chooseMountCompetitor(competitors);
  if (category === "restaurant") {
    return `Lead with multi-tablet restaurant workflow proof: Tablet Tower, LockPro, Dock'n Lock, delivery app stations, keyed security, and a fair ${topCompetitor} comparison.`;
  }
  if (category === "delivery") {
    return `Lead with commercial delivery phone mounting, shared-route durability, suction/drill-base choices, xProDock/Dock'n Lock names, and a fair ${topCompetitor} comparison.`;
  }
  if (category === "fleet") {
    return `Lead with fleet-standard install repeatability, ELD/tablet fit, AMPS plates, drill bases, charging, and a fair ${topCompetitor} comparison.`;
  }
  if (category === "warehouse") {
    return `Lead with forklift tablet and barcode scanner workflows, no-drill cage/pillar options, vibration resistance, Zebra/Honeywell context, and a fair ${topCompetitor} or Havis comparison.`;
  }
  if (category === "fishing") {
    return `Lead with marine electronics fit, Garmin/Lowrance/Humminbird context, rail/clamp/drill installs, 25mm/38mm ball options, and rough-water stability.`;
  }
  if (category === "amps/modular") {
    return "Lead with AMPS pattern clarity, ball-size compatibility, part-to-part modularity, configurator paths, and exact plate/base/arm examples.";
  }
  return "Add a concise answer-first block, named product module, fair comparison language, FAQ/article schema, and a retest prompt tied to the buyer query.";
}

function providerMove(provider) {
  if (provider === "Claude") {
    return "Add structured proof blocks: materials, compatibility, mount pattern, install style, ideal buyer, exact product names.";
  }
  if (provider === "Gemini") {
    return "Improve structured data and source corroboration: Organization, Article, FAQ, Product/Offer, and external category mentions.";
  }
  return "Add direct answer-first paragraphs and fair comparison blocks that place iBOLT beside the default competitor.";
}

function renderTable(headers, rows) {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header.label)}</th>`).join("")}</tr></thead>`;
  const body = rows.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header.key])}</td>`).join("")}</tr>`).join("");
  return `<table>${head}<tbody>${body}</tbody></table>`;
}

function barChart({ title, rows, valueKey, labelKey, color = "#0f766e" }) {
  const chartRows = rows.slice(0, 10);
  const width = 980;
  const rowHeight = 38;
  const height = 72 + chartRows.length * rowHeight;
  const max = Math.max(1, ...chartRows.map((row) => num(row[valueKey])));
  const bars = chartRows.map((row, index) => {
    const y = 52 + index * rowHeight;
    const barWidth = Math.round((num(row[valueKey]) / max) * 500);
    return `<g>
      <text x="22" y="${y + 17}" font-size="13" font-weight="800" fill="#0f172a">${escapeHtml(short(row[labelKey], 42))}</text>
      <rect x="350" y="${y}" width="500" height="23" rx="11" fill="#e5e7eb"/>
      <rect x="350" y="${y}" width="${barWidth}" height="23" rx="11" fill="${color}"/>
      <text x="930" y="${y + 16}" font-size="13" font-weight="900" text-anchor="end" fill="#0f172a">${escapeHtml(row[valueKey])}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#fff"/>
    <text x="22" y="34" font-size="21" font-weight="900" fill="#111827">${escapeHtml(title)}</text>
    ${bars}
  </svg>`;
}

function renderHtml({ summary, categoryRows, providerCategoryRows, topPageRows }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT Category Provider Priority Report</title>
  <style>
    body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1280px;margin:0 auto;padding:34px 24px 72px}
    h1{font-size:36px;margin:0 0 8px}
    h2{font-size:23px;margin:34px 0 12px}
    p,li{font-size:15px;line-height:1.55;color:#334155}
    .cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:20px 0}
    .card{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:15px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:900}
    .value{font-size:30px;font-weight:900;margin:8px 0;color:#0f172a}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
    .chart{background:#fff;border:1px solid #dbe3ef;border-radius:18px;padding:10px;overflow:auto}
    .chart svg{width:100%;height:auto;display:block}
    .note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #0f766e;border-radius:12px;padding:16px 18px;margin:18px 0}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 22px}
    th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    @media(max-width:980px){.cards,.grid{grid-template-columns:1fr}h1{font-size:30px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT Category Provider Priority Report</h1>
  <p>This rolls the benchmark, competitor, page-body, and citation-bridge artifacts into one category/provider work queue.</p>
  <div class="note"><strong>Read:</strong> The next gains come from category-specific page edits, not generic citation chasing. Delivery, restaurant, fleet, warehouse, and fishing each need different comparison language, product proof, schema cleanup, and provider retest prompts.</div>
  <section class="cards">
    <div class="card"><div class="label">Categories</div><div class="value">${escapeHtml(summary.categories)}</div><p>Categories with mapped query or page work.</p></div>
    <div class="card"><div class="label">Tracked queries</div><div class="value">${escapeHtml(summary.queries)}</div><p>Baseline query rows mapped to pages.</p></div>
    <div class="card"><div class="label">Page work orders</div><div class="value">${escapeHtml(summary.pages)}</div><p>All-blog edit command rows.</p></div>
    <div class="card"><div class="label">Provider misses</div><div class="value">${escapeHtml(summary.providerMisses)}</div><p>Provider/category cells where iBOLT was missed.</p></div>
  </section>
  <section class="grid">
    <div class="chart">${barChart({ title: "Priority by category", rows: categoryRows, valueKey: "priorityScore", labelKey: "category", color: "#0f766e" })}</div>
    <div class="chart">${barChart({ title: "Competitor-only answers by category", rows: categoryRows, valueKey: "competitorOnlyAnswers", labelKey: "category", color: "#dc2626" })}</div>
  </section>
  <h2>Category Priorities</h2>
  ${renderTable([
    { label: "Category", key: "category" },
    { label: "Priority", key: "priorityScore" },
    { label: "Queries", key: "queries" },
    { label: "Pages", key: "pages" },
    { label: "Comp-only", key: "competitorOnlyAnswers" },
    { label: "Mention", key: "mentionRate" },
    { label: "Top competitors", key: "topCompetitors" },
    { label: "Main move", key: "mainMove" },
  ], categoryRows)}
  <h2>Provider Category Fix Map</h2>
  ${renderTable([
    { label: "Provider", key: "provider" },
    { label: "Category", key: "category" },
    { label: "Misses", key: "misses" },
    { label: "Competitors", key: "topCompetitors" },
    { label: "Fix", key: "providerMove" },
    { label: "Retest", key: "retestMove" },
  ], providerCategoryRows.slice(0, 24))}
  <h2>Top Pages To Edit First</h2>
  ${renderTable([
    { label: "Rank", key: "rank" },
    { label: "Category", key: "category" },
    { label: "Priority", key: "priority" },
    { label: "Page", key: "title" },
    { label: "Competitors", key: "competitors" },
    { label: "First edit", key: "firstEdit" },
  ], topPageRows)}
</main>
</body>
</html>`;
}

function renderMarkdown({ summary, categoryRows, providerCategoryRows, topPageRows }) {
  return `# iBOLT Category Provider Priority Report

This rolls the benchmark, competitor, page-body, and citation-bridge artifacts into one category/provider work queue.

## Summary

- Categories: ${summary.categories}
- Tracked queries: ${summary.queries}
- Page work orders: ${summary.pages}
- Provider miss cells: ${summary.providerMisses}

## Category Priorities

${categoryRows.slice(0, 10).map((row, index) => `${index + 1}. ${row.category}: priority ${row.priorityScore}, ${row.competitorOnlyAnswers} competitor-only answers, mention rate ${row.mentionRate}%. ${row.mainMove}`).join("\n")}

## Provider Category Fixes

${providerCategoryRows.slice(0, 12).map((row, index) => `${index + 1}. ${row.provider} / ${row.category}: ${row.misses} misses. ${row.providerMove}`).join("\n")}

## Top Pages To Edit First

${topPageRows.slice(0, 12).map((row) => `- ${row.category}: ${row.title}. ${row.firstEdit}`).join("\n")}
`;
}

function buildCategoryRows({ queryRows, pageRows, citationRows }) {
  const categories = new Map();
  const ensure = (category) => {
    const key = category || "uncategorized";
    if (!categories.has(key)) {
      categories.set(key, {
        category: key,
        queryRows: [],
        pageRows: [],
        competitors: new Map(),
        providers: new Map(),
        citation: {},
      });
    }
    return categories.get(key);
  };

  for (const row of queryRows) {
    const group = ensure(row.category);
    group.queryRows.push(row);
    for (const competitor of splitList(row.competitors)) addCount(group.competitors, competitor);
  }
  for (const row of pageRows) {
    const group = ensure(row.category);
    group.pageRows.push(row);
    for (const competitor of splitList(row.competitors)) addCount(group.competitors, competitor);
  }
  for (const row of citationRows) {
    ensure(row.category).citation = row;
  }

  return [...categories.values()].map((group) => {
    const queries = group.queryRows.length;
    const pages = group.pageRows.length;
    const competitorOnlyAnswers = group.queryRows.reduce((sum, row) => sum + num(row.competitor_only_answers), 0);
    const avgMention = avg(group.queryRows.map((row) => row.mention_rate));
    const avgTopThree = avg(group.queryRows.map((row) => row.top_three_rate));
    const quickAnswerPages = issueCount(group.pageRows, "missing early quick answer");
    const schemaPages = group.pageRows.filter((row) => /schema/i.test(row.command_summary || row.issues || "")).length;
    const comparisonPages = issueCount(group.pageRows, "missing comparison/tradeoff language");
    const ctaPages = issueCount(group.pageRows, "too many cart CTAs");
    const priorityScore = Math.round(
      avg(group.pageRows.map((row) => row.priority))
      + competitorOnlyAnswers * 28
      + quickAnswerPages * 5
      + schemaPages * 4
      + comparisonPages * 6
      + ctaPages * 2
      + (100 - avgMention)
    );
    return {
      category: group.category,
      priorityScore,
      queries,
      pages,
      competitorOnlyAnswers,
      zeroMentionQueries: group.queryRows.filter((row) => num(row.mention_rate) === 0).length,
      mentionRate: avgMention,
      topThreeRate: avgTopThree,
      quickAnswerPages,
      schemaPages,
      comparisonPages,
      ctaPages,
      citationReadyPages: num(group.citation.citation_ready_pages),
      mentionFirstPages: num(group.citation.mention_first_pages),
      topCompetitors: topCounts(group.competitors, 8).join("; "),
      topPages: group.pageRows
        .slice()
        .sort((a, b) => num(b.priority) - num(a.priority))
        .slice(0, 6)
        .map((row) => row.title)
        .join("; "),
      mainMove: categoryMove(group.category, { topCompetitors: topCounts(group.competitors, 3).join("; ") }),
    };
  }).sort((a, b) => b.priorityScore - a.priorityScore);
}

function buildProviderCategoryRows(queryRows) {
  const map = new Map();
  for (const row of queryRows) {
    for (const cell of providerCells(row)) {
      const key = `${cell.provider}|||${row.category || "uncategorized"}`;
      if (!map.has(key)) {
        map.set(key, {
          provider: cell.provider,
          category: row.category || "uncategorized",
          total: 0,
          misses: 0,
          mentions: 0,
          competitors: new Map(),
          queries: [],
        });
      }
      const group = map.get(key);
      group.total += 1;
      if (providerStatus(cell) === "missed") group.misses += 1;
      if (providerStatus(cell) === "mentioned") group.mentions += 1;
      for (const competitor of providerCompetitors(cell)) addCount(group.competitors, competitor);
      group.queries.push(row.query);
    }
  }
  return [...map.values()]
    .map((group) => ({
      provider: group.provider,
      category: group.category,
      total: group.total,
      misses: group.misses,
      mentions: group.mentions,
      missRate: pct(group.misses, group.total),
      topCompetitors: topCounts(group.competitors, 6).join("; "),
      providerMove: providerMove(group.provider),
      retestMove: `Retest ${[...new Set(group.queries)].slice(0, 4).join("; ")} one prompt at a time on ${group.provider}.`,
      priorityScore: group.misses * 20 + group.total * 4 + group.competitors.size * 3,
    }))
    .sort((a, b) => b.priorityScore - a.priorityScore);
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const queryRows = await readCsv("query-page-matrix/all-query-page-matrix.csv");
  const pageRows = await readCsv("page-edit-command-matrix/page-edit-command-matrix.csv");
  const citationRows = await readCsv("visibility-citation-bridge/category-visibility-citation-bridge.csv");
  const coMention = await readJson("co-mention-network/co-mention-network-data.json", { summary: {} });
  const counterplan = await readJson("competitor-page-counterplan/competitor-page-counterplan-data.json", { summary: {} });

  const categoryRows = buildCategoryRows({ queryRows, pageRows, citationRows });
  const providerCategoryRows = buildProviderCategoryRows(queryRows);
  const topPageRows = pageRows.slice(0, 30).map((row) => ({
    rank: row.rank,
    category: row.category,
    priority: row.priority,
    title: row.title,
    url: row.url,
    competitors: row.competitors,
    firstEdit: short(row.first_hour_action || row.quick_answer_command || row.command_summary, 260),
  }));
  const summary = {
    categories: categoryRows.length,
    queries: queryRows.length,
    pages: pageRows.length,
    providerMisses: providerCategoryRows.reduce((sum, row) => sum + row.misses, 0),
    mentionRate: coMention.summary?.mentionRate || 0,
    nonBrandedMentionRate: coMention.summary?.nonBrandedMentionRate || 0,
    citationRate: coMention.summary?.sourceMentionSummary?.citationRate || 0,
    topCompetitor: counterplan.summary?.topBrand || "RAM Mounts",
    topCompetitorLostAnswers: counterplan.summary?.topBrandLostAnswers || 0,
  };

  await writeFile(path.join(outDir, "category-provider-priority.csv"), csv([
    ["rank", "category", "priority_score", "queries", "pages", "competitor_only_answers", "zero_mention_queries", "mention_rate", "top_three_rate", "quick_answer_pages", "schema_pages", "comparison_pages", "cta_pages", "mention_first_pages", "citation_ready_pages", "top_competitors", "top_pages", "main_move"],
    ...categoryRows.map((row, index) => [
      index + 1,
      row.category,
      row.priorityScore,
      row.queries,
      row.pages,
      row.competitorOnlyAnswers,
      row.zeroMentionQueries,
      row.mentionRate,
      row.topThreeRate,
      row.quickAnswerPages,
      row.schemaPages,
      row.comparisonPages,
      row.ctaPages,
      row.mentionFirstPages,
      row.citationReadyPages,
      row.topCompetitors,
      row.topPages,
      row.mainMove,
    ]),
  ]));
  await writeFile(path.join(outDir, "provider-category-fix-map.csv"), csv([
    ["rank", "provider", "category", "priority_score", "misses", "mentions", "miss_rate", "top_competitors", "provider_move", "retest_move"],
    ...providerCategoryRows.map((row, index) => [
      index + 1,
      row.provider,
      row.category,
      row.priorityScore,
      row.misses,
      row.mentions,
      row.missRate,
      row.topCompetitors,
      row.providerMove,
      row.retestMove,
    ]),
  ]));
  await writeFile(path.join(outDir, "top-page-edit-sequence.csv"), csv([
    ["rank", "category", "priority", "title", "url", "competitors", "first_edit"],
    ...topPageRows.map((row) => [row.rank, row.category, row.priority, row.title, row.url, row.competitors, row.firstEdit]),
  ]));
  await writeFile(path.join(outDir, "category-provider-priority-data.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    benchmarkDir,
    summary,
    categoryRows,
    providerCategoryRows,
    topPageRows,
  }, null, 2));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown({ summary, categoryRows, providerCategoryRows, topPageRows }));
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml({ summary, categoryRows, providerCategoryRows, topPageRows }));

  console.log(`Wrote ${outDir}`);
  console.log(`Categories: ${summary.categories}; provider misses: ${summary.providerMisses}; top category: ${categoryRows[0]?.category || "n/a"}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
