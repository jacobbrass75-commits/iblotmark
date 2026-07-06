#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "visibility-citation-bridge");

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
  const match = String(value ?? "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function pct(value, total) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

function short(value, length = 88) {
  const text = String(value ?? "");
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function byMetric(rows, metric) {
  return rows.find((row) => row.metric === metric) || {};
}

function normalizeUrl(value) {
  return String(value ?? "").replace(/\/$/, "").trim();
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row) || "unknown";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function countByList(rows, key, limit = 8) {
  const counts = new Map();
  for (const row of rows) {
    for (const item of splitList(row[key])) {
      counts.set(item, (counts.get(item) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([item, count]) => `${item} ${count}`)
    .join("; ");
}

function renderTable(headers, rows) {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table>${head}${body}</table>`;
}

function card(label, value, note) {
  return `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`;
}

function barSvg({ title, rows, width = 900, rowHeight = 34, maxValue, color = "#0f766e" }) {
  const chartRows = rows.filter((row) => Number.isFinite(row.value)).slice(0, 12);
  const height = 76 + chartRows.length * rowHeight;
  const max = maxValue || Math.max(1, ...chartRows.map((row) => row.value));
  const bars = chartRows.map((row, index) => {
    const y = 58 + index * rowHeight;
    const barWidth = Math.round((row.value / max) * (width - 350));
    return `<g>
      <text x="22" y="${y + 17}" font-size="13" font-weight="800" fill="#111827">${escapeHtml(short(row.label, 40))}</text>
      <rect x="292" y="${y}" width="${width - 350}" height="21" rx="10" fill="#e5e7eb"/>
      <rect x="292" y="${y}" width="${barWidth}" height="21" rx="10" fill="${row.color || color}"/>
      <text x="${width - 28}" y="${y + 16}" font-size="13" font-weight="900" text-anchor="end" fill="#111827">${escapeHtml(row.value)}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#ffffff"/>
    <text x="22" y="34" font-size="20" font-weight="900" fill="#111827">${escapeHtml(title)}</text>
    ${bars}
  </svg>`;
}

function renderHtml(data) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT Visibility to Citation Bridge</title>
  <style>
    body{margin:0;background:#f7f9fc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1240px;margin:0 auto;padding:34px 24px 66px}
    h1{font-size:38px;line-height:1.1;margin:0 0 8px;letter-spacing:0}
    h2{font-size:23px;margin:36px 0 12px}
    h3{font-size:17px;margin:18px 0 8px}
    p,li{line-height:1.55;color:#334155;font-size:15px}
    a{color:#0f766e;overflow-wrap:anywhere}
    code{background:#e2e8f0;border-radius:5px;padding:2px 5px}
    .note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #0f766e;border-radius:12px;padding:16px 18px;margin:20px 0}
    .warn{border-left-color:#f97316}
    .danger{border-left-color:#ef4444}
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
    @media(max-width:980px){.cards,.grid{grid-template-columns:1fr}h1{font-size:31px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT Visibility to Citation Bridge</h1>
  <p>This report connects the current AI-answer baseline to the exact page sequence for raising citation rate. It separates pages that need inclusion first from pages ready for source/citation work.</p>

  <div class="note">
    <strong>Operating rule:</strong> do not chase citations on pages where iBOLT is absent from the answer. First recover mention and top-3 recommendation, then use schema, concise answer blocks, and third-party mentions to lift citations.
  </div>

  <section class="cards">
    ${card("Mention rate", data.kpis.mentionRate, `${data.kpis.mentionNote}`)}
    ${card("Top-3 rate", data.kpis.topThreeRate, `${data.kpis.topThreeNote}`)}
    ${card("Citation rate", data.kpis.citationRate, `${data.kpis.citationNote}`)}
    ${card("Mention-first pages", data.summary.mentionFirstPages, "Pages where competitor-only or zero-mention pressure comes before outreach.")}
    ${card("Citation-ready pages", data.summary.citationReadyPages, "Pages that can accept source cleanup and external citation work now.")}
  </section>

  <section class="grid">
    <div class="chart">${data.svgs.categoryBridge}</div>
    <div class="chart">${data.svgs.competitorPressure}</div>
  </section>

  <h2>What This Means</h2>
  <div class="note warn">
    <strong>Yes, raise citation rate.</strong> The target should move from 0% toward 8% first. But the fastest path is not generic backlink work. It is page-level citation readiness after iBOLT is present in the answer set, especially restaurant, fishing, delivery, fleet, and warehouse.
  </div>

  <h2>Mention Recovery First</h2>
  <p>These pages still lose too many answers to competitors. Edit them before asking the SEO contractor for source placements.</p>
  ${data.tables.mentionFirst}

  <h2>Citation-Ready Source Queue</h2>
  <p>These pages have lower competitor-only pressure or stronger existing mention signals. Use schema cleanup, concise source-ready blocks, and targeted third-party citations.</p>
  ${data.tables.citationReady}

  <h2>Category Bridge</h2>
  ${data.tables.categoryBridge}

  <h2>Competitor Citation Bridge</h2>
  ${data.tables.competitorBridge}

  <h2>Files</h2>
  <ul>
    <li><a href="visibility-to-citation-page-queue.csv">visibility-to-citation-page-queue.csv</a></li>
    <li><a href="citation-ready-source-queue.csv">citation-ready-source-queue.csv</a></li>
    <li><a href="category-visibility-citation-bridge.csv">category-visibility-citation-bridge.csv</a></li>
    <li><a href="competitor-citation-bridge.csv">competitor-citation-bridge.csv</a></li>
    <li><a href="boss-talk-track.md">boss-talk-track.md</a></li>
  </ul>
</main>
</body>
</html>`;
}

function renderMarkdown(data) {
  return `# iBOLT Visibility to Citation Bridge

## Bottom Line

Citation rate should be improved, but not before mention recovery on competitor-heavy pages. The current baseline is:

- Mention rate: ${data.kpis.mentionRate}
- Top-3 recommendation rate: ${data.kpis.topThreeRate}
- Citation rate: ${data.kpis.citationRate}
- Mention-first pages: ${data.summary.mentionFirstPages}
- Citation-ready pages: ${data.summary.citationReadyPages}

## Sequence

1. Recover iBOLT inclusion and top-3 placement on competitor-heavy pages.
2. Clean up source-ready page structure: quick answer, product/spec block, FAQ schema, Article schema, Product/Offer references where possible.
3. Ask the SEO contractor to build third-party references to the cleaned survivor URLs.
4. Retest W1/W2 for mention lift, then W3 for citation lift.

## Top Mention-First Pages

${data.mentionFirst.slice(0, 10).map((row, index) => `${index + 1}. ${row.title}: ${row.category}, score ${row.bridge_score}, ${row.zero_mention_queries} zero-mention queries, ${row.competitor_only_answers} competitor-only answers.`).join("\n")}

## Top Citation-Ready Pages

${data.citationReady.slice(0, 10).map((row, index) => `${index + 1}. ${row.title}: ${row.category}, score ${row.bridge_score}, action: ${row.next_citation_action || row.citation_action}`).join("\n")}
`;
}

function talkTrack(data) {
  return `# Boss Talk Track: Citation Rate and AI Visibility

We should raise citation rate, but the current benchmark says we need to fix inclusion first. iBOLT is mentioned in ${data.kpis.mentionRate} of saved answers and cited in ${data.kpis.citationRate}. The citation number is weak, but the bigger leak is that broad buyer prompts still recommend competitors without iBOLT too often.

The practical plan is:

1. Edit the highest-loss pages so iBOLT appears in the answer set.
2. Add concise answer blocks, fair competitor comparison blocks, product/spec proof, FAQ schema, and source-ready page structure.
3. Send cleaned survivor URLs to the SEO contractor for external citations and industry mentions.
4. Retest the priority packet first, then the full 1,449-request manifest.

The top mention-recovery categories are ${data.categoryBridge.slice(0, 5).map((row) => row.category).join(", ")}.

The top competitor pressure still comes from ${data.competitorBridge.slice(0, 5).map((row) => row.brand).join(", ")}.

The benchmark manifest is ready, but the live retest still needs a securely set OPENROUTER_API_KEY in the shell.
`;
}

async function main() {
  const summaryRows = await readCsv("boss-ai-visibility-dashboard/boss-dashboard-summary.csv");
  const pageRows = await readCsv("all-page-ai-drilldown/all-page-ai-drilldown.csv");
  const citationRows = await readCsv("citation-readiness-map/page-citation-readiness.csv");
  const categoryRows = await readCsv("test-area-expansion-map/category-test-area-matrix.csv");
  const competitorRows = await readCsv("entity-adjacency-report/competitor-adjacency-matrix.csv");
  const competitorSequenceRows = await readCsv("citation-vs-mention-control-report/competitor-citation-sequence.csv");
  const providerRows = await readCsv("provider-strategy-report/provider-strategy-summary.csv");

  const citationByUrl = new Map(citationRows.map((row) => [normalizeUrl(row.url), row]));
  const pageQueue = pageRows.map((row) => {
    const citation = citationByUrl.get(normalizeUrl(row.url)) || {};
    const zeroMention = toNumber(row.zero_mention_queries || citation.zero_mention_queries);
    const competitorOnly = toNumber(row.competitor_only_answers || citation.competitor_only_answers);
    const cleanMentions = toNumber(row.clean_mentions);
    const coMentions = toNumber(row.co_mentions);
    const providerRequests = toNumber(citation.provider_requests_ready || row.provider_requests_ready);
    const citability = toNumber(row.ai_citability_score || citation.ai_citability_score);
    const commercialIntent = toNumber(citation.commercial_intent_score);
    const conversionReadiness = toNumber(citation.conversion_readiness_score);
    const mentionGapScore = zeroMention * 52 + competitorOnly * 18 + Math.max(0, 6 - cleanMentions - coMentions) * 12;
    const citationScore = citability + commercialIntent + conversionReadiness + providerRequests;
    const bridgeScore = mentionGapScore + Math.round(citationScore / 4);
    const stage = zeroMention || competitorOnly >= 2 || /mention first/i.test(row.citation_readiness_bucket || citation.readiness_bucket)
      ? "Mention recovery first"
      : "Citation/source push now";
    const nextCitationAction = citation.next_citation_action || row.citation_action || "";
    return {
      bridge_score: bridgeScore,
      stage,
      title: row.title || citation.page,
      url: row.url || citation.url,
      category: row.category || citation.category,
      zero_mention_queries: zeroMention,
      competitor_only_answers: competitorOnly,
      clean_mentions: cleanMentions,
      co_mentions: coMentions,
      ai_citability_score: citability,
      benchmark_query_count: toNumber(row.benchmark_query_count || citation.benchmark_query_count),
      competitors: row.competitors || citation.competitors,
      products_to_feature: row.products_to_feature || citation.products_to_feature,
      app_work_action: citation.app_work_action || row.primary_action,
      next_citation_action: nextCitationAction,
      source_targets: citation.source_targets,
      retest_prompts: row.retest_prompts || citation.retest_prompts,
      retest_metric: citation.retest_metric || "Target-domain citation or iBOLT top-3 movement.",
    };
  }).sort((a, b) => b.bridge_score - a.bridge_score || b.competitor_only_answers - a.competitor_only_answers);

  const mentionFirst = pageQueue.filter((row) => row.stage === "Mention recovery first");
  const citationReady = pageQueue
    .filter((row) => row.stage === "Citation/source push now")
    .sort((a, b) => b.ai_citability_score - a.ai_citability_score || b.bridge_score - a.bridge_score);

  const categoryBridge = categoryRows.map((row) => {
    const pages = pageQueue.filter((page) => page.category === row.category);
    const mentionFirstPages = pages.filter((page) => page.stage === "Mention recovery first").length;
    const citationReadyPages = pages.filter((page) => page.stage === "Citation/source push now").length;
    const avgCitability = pages.length
      ? Math.round(pages.reduce((sum, page) => sum + page.ai_citability_score, 0) / pages.length)
      : 0;
    const providerStrategy = providerRows
      .map((provider) => `${provider.provider}: ${provider.citation_move}`)
      .slice(0, 3)
      .join(" ");
    return {
      priority_score: toNumber(row.priority_score),
      category: row.category,
      live_pages: toNumber(row.live_pages),
      prompts: toNumber(row.prompts),
      provider_requests: toNumber(row.provider_requests),
      competitor_only_baseline: toNumber(row.competitor_only_baseline),
      zero_mention_queries: toNumber(row.zero_mention_queries),
      mention_first_pages: mentionFirstPages,
      citation_ready_pages: citationReadyPages,
      avg_citability: avgCitability,
      top_competitors: row.top_competitors,
      next_validation: row.next_validation,
      provider_citation_move: providerStrategy,
    };
  }).sort((a, b) => b.priority_score - a.priority_score || b.competitor_only_baseline - a.competitor_only_baseline);

  const sequenceByBrand = new Map(competitorSequenceRows.map((row) => [row.brand, row]));
  const competitorBridge = competitorRows.map((row) => {
    const sequence = sequenceByBrand.get(row.competitor) || {};
    const relatedPages = pageQueue.filter((page) => splitList(page.competitors).some((item) => item.includes(row.competitor)));
    return {
      brand: row.competitor,
      co_mentions: toNumber(row.co_mentions),
      replacements: toNumber(row.replacements),
      mapped_page_actions: toNumber(sequence.mapped_page_actions || relatedPages.length),
      top_categories: row.categories,
      providers: row.providers,
      top_pages: sequence.top_pages || relatedPages.slice(0, 5).map((page) => page.title).join("; "),
      counter_angle: row.counter_angle,
      citation_sequence: sequence.citation_sequence || "Win inclusion beside this brand first, then pursue third-party citations.",
    };
  }).sort((a, b) => b.replacements - a.replacements || b.mapped_page_actions - a.mapped_page_actions);

  const kpis = {
    mentionRate: byMetric(summaryRows, "Mention rate").current || "24%",
    mentionNote: byMetric(summaryRows, "Mention rate").note || "Shows whether models include iBOLT at all.",
    topThreeRate: byMetric(summaryRows, "Top-3 recommendation").current || "16%",
    topThreeNote: byMetric(summaryRows, "Top-3 recommendation").note || "Moving from mentioned to recommended is the business goal.",
    citationRate: byMetric(summaryRows, "Citation rate").current || "0%",
    citationNote: byMetric(summaryRows, "Citation rate").note || "Citations show AI systems trust iboltmounts.com as a source.",
  };

  const summary = {
    totalPages: pageQueue.length,
    mentionFirstPages: mentionFirst.length,
    citationReadyPages: citationReady.length,
    categoryCount: categoryBridge.length,
    competitorCount: competitorBridge.length,
  };

  const tables = {
    mentionFirst: renderTable(
      ["Score", "Page", "Category", "Zero mentions", "Competitor-only", "Competitors", "App action", "Citation action"],
      mentionFirst.slice(0, 18).map((row) => [
        row.bridge_score,
        row.title,
        row.category,
        row.zero_mention_queries,
        row.competitor_only_answers,
        short(row.competitors, 110),
        short(row.app_work_action, 140),
        short(row.next_citation_action, 140),
      ]),
    ),
    citationReady: renderTable(
      ["Score", "Page", "Category", "Citability", "Clean", "Co-mentions", "Source targets", "Retest metric"],
      citationReady.slice(0, 18).map((row) => [
        row.bridge_score,
        row.title,
        row.category,
        row.ai_citability_score,
        row.clean_mentions,
        row.co_mentions,
        short(row.source_targets, 120),
        short(row.retest_metric, 120),
      ]),
    ),
    categoryBridge: renderTable(
      ["Category", "Score", "Prompts", "Requests", "Competitor-only", "Zero mentions", "Mention-first pages", "Citation-ready pages", "Top competitors"],
      categoryBridge.map((row) => [
        row.category,
        row.priority_score,
        row.prompts,
        row.provider_requests,
        row.competitor_only_baseline,
        row.zero_mention_queries,
        row.mention_first_pages,
        row.citation_ready_pages,
        short(row.top_competitors, 120),
      ]),
    ),
    competitorBridge: renderTable(
      ["Brand", "Replacements", "Co-mentions", "Mapped actions", "Categories", "Counter angle", "Citation sequence"],
      competitorBridge.slice(0, 12).map((row) => [
        row.brand,
        row.replacements,
        row.co_mentions,
        row.mapped_page_actions,
        short(row.top_categories, 80),
        short(row.counter_angle, 120),
        row.citation_sequence,
      ]),
    ),
  };

  const svgs = {
    categoryBridge: barSvg({
      title: "Categories by competitor-only baseline",
      rows: categoryBridge.map((row) => ({ label: row.category, value: row.competitor_only_baseline, color: "#ef4444" })),
      color: "#ef4444",
    }),
    competitorPressure: barSvg({
      title: "Competitor replacement pressure",
      rows: competitorBridge.map((row) => ({ label: row.brand, value: row.replacements, color: "#2563eb" })),
      color: "#2563eb",
    }),
  };

  const data = {
    kpis,
    summary,
    mentionFirst,
    citationReady,
    categoryBridge,
    competitorBridge,
    tables,
    svgs,
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml(data));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown(data));
  await writeFile(path.join(outDir, "boss-talk-track.md"), talkTrack(data));
  await writeFile(path.join(outDir, "visibility-to-citation-page-queue.csv"), csv([
    ["bridge_score", "stage", "title", "url", "category", "zero_mention_queries", "competitor_only_answers", "clean_mentions", "co_mentions", "ai_citability_score", "benchmark_query_count", "competitors", "products_to_feature", "app_work_action", "next_citation_action", "source_targets", "retest_prompts", "retest_metric"],
    ...pageQueue.map((row) => [
      row.bridge_score,
      row.stage,
      row.title,
      row.url,
      row.category,
      row.zero_mention_queries,
      row.competitor_only_answers,
      row.clean_mentions,
      row.co_mentions,
      row.ai_citability_score,
      row.benchmark_query_count,
      row.competitors,
      row.products_to_feature,
      row.app_work_action,
      row.next_citation_action,
      row.source_targets,
      row.retest_prompts,
      row.retest_metric,
    ]),
  ]));
  await writeFile(path.join(outDir, "citation-ready-source-queue.csv"), csv([
    ["bridge_score", "title", "url", "category", "ai_citability_score", "source_targets", "next_citation_action", "retest_metric"],
    ...citationReady.map((row) => [
      row.bridge_score,
      row.title,
      row.url,
      row.category,
      row.ai_citability_score,
      row.source_targets,
      row.next_citation_action,
      row.retest_metric,
    ]),
  ]));
  await writeFile(path.join(outDir, "category-visibility-citation-bridge.csv"), csv([
    ["priority_score", "category", "live_pages", "prompts", "provider_requests", "competitor_only_baseline", "zero_mention_queries", "mention_first_pages", "citation_ready_pages", "avg_citability", "top_competitors", "next_validation", "provider_citation_move"],
    ...categoryBridge.map((row) => [
      row.priority_score,
      row.category,
      row.live_pages,
      row.prompts,
      row.provider_requests,
      row.competitor_only_baseline,
      row.zero_mention_queries,
      row.mention_first_pages,
      row.citation_ready_pages,
      row.avg_citability,
      row.top_competitors,
      row.next_validation,
      row.provider_citation_move,
    ]),
  ]));
  await writeFile(path.join(outDir, "competitor-citation-bridge.csv"), csv([
    ["brand", "replacements", "co_mentions", "mapped_page_actions", "top_categories", "providers", "top_pages", "counter_angle", "citation_sequence"],
    ...competitorBridge.map((row) => [
      row.brand,
      row.replacements,
      row.co_mentions,
      row.mapped_page_actions,
      row.top_categories,
      row.providers,
      row.top_pages,
      row.counter_angle,
      row.citation_sequence,
    ]),
  ]));

  console.log(`Wrote ${path.join(outDir, "REPORT.html")}`);
  console.log(`Mention-first pages: ${summary.mentionFirstPages}; citation-ready pages: ${summary.citationReadyPages}; categories: ${summary.categoryCount}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
