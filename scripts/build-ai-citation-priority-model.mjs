#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "citation-priority-model");

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
      if (row.some((value) => String(value ?? "").trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell.length || row.length) row.push(cell);
  if (row.length && row.some((value) => String(value ?? "").trim())) rows.push(row);
  if (!rows.length) return [];
  const [headers, ...records] = rows;
  return records
    .filter((record) => record.some((value) => String(value ?? "").trim()))
    .map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""])));
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
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/^\+\d+\s+more$/i.test(item));
}

function normalizeUrl(value) {
  return String(value ?? "")
    .trim()
    .replace(/^http:\/\//i, "https://")
    .replace(/\/$/, "");
}

function short(value, length = 120) {
  const text = String(value ?? "");
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function indexByUrl(rows, keys = ["url"]) {
  const map = new Map();
  for (const row of rows) {
    for (const key of keys) {
      const normalized = normalizeUrl(row[key]);
      if (normalized && !map.has(normalized)) map.set(normalized, row);
    }
  }
  return map;
}

function top(rows, key, count = 12) {
  return [...rows].sort((a, b) => num(b[key]) - num(a[key]) || String(a.title || a.category || a.brand).localeCompare(String(b.title || b.category || b.brand))).slice(0, count);
}

function bucketForPage(row) {
  if (num(row.zero_mention_queries) > 0 || num(row.competitor_only_answers) >= 2 || /mention first/i.test(row.readiness_bucket)) {
    return "Mention recovery first";
  }
  if (num(row.hallucination_risk) > 0 || /product/i.test(row.product_name_action || "")) {
    return "Product-name cleanup before citation";
  }
  if (/citation-ready after page cleanup|needs page structure/i.test(row.readiness_bucket || "")) {
    return "Source-ready cleanup before outreach";
  }
  if (/FAQ schema|quick answer|comparison block|image alt|Article/i.test(row.page_fixes || "")) {
    return "Source-ready cleanup before outreach";
  }
  if (/external citation|outreach/i.test(row.readiness_bucket || "")) {
    return "Citation outreach candidate";
  }
  return "Monitor and support";
}

function actionForBucket(bucket) {
  if (bucket === "Mention recovery first") {
    return "Edit page for inclusion first: direct answer, exact iBOLT products, comparison block, FAQ/schema, then retest mention and top-3 movement.";
  }
  if (bucket === "Product-name cleanup before citation") {
    return "Normalize AI-visible product names to verified Shopify titles before asking models to cite the page.";
  }
  if (bucket === "Source-ready cleanup before outreach") {
    return "Clean quick-answer, FAQ, Article schema, product links, image alt text, and internal links, then send the URL to citation outreach.";
  }
  if (bucket === "Citation outreach candidate") {
    return "After a light verification pass, hand this URL to contractor/source outreach and run citation probes.";
  }
  return "Monitor for movement, support with internal links and off-site mentions, and prioritize higher-pressure pages first.";
}

function renderTable(headers, rows) {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table>${head}${body}</table>`;
}

function barSvg({ title, rows, width = 900, color = "#0f766e", maxValue }) {
  const chartRows = rows.filter((row) => Number.isFinite(row.value)).slice(0, 12);
  const rowHeight = 34;
  const height = 72 + chartRows.length * rowHeight;
  const max = maxValue || Math.max(1, ...chartRows.map((row) => row.value));
  const bars = chartRows.map((row, index) => {
    const y = 54 + index * rowHeight;
    const barWidth = Math.round((row.value / max) * (width - 330));
    return `<g>
      <text x="22" y="${y + 17}" font-size="13" font-weight="700" fill="#111827">${escapeHtml(short(row.label, 38))}</text>
      <rect x="275" y="${y}" width="${width - 340}" height="21" rx="10" fill="#e5e7eb"/>
      <rect x="275" y="${y}" width="${barWidth}" height="21" rx="10" fill="${row.color || color}"/>
      <text x="${width - 28}" y="${y + 16}" font-size="13" font-weight="800" text-anchor="end" fill="#111827">${escapeHtml(row.display ?? row.value)}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#ffffff"/>
    <text x="22" y="34" font-size="20" font-weight="800" fill="#111827">${escapeHtml(title)}</text>
    ${bars}
  </svg>`;
}

function kpiSvg(rows) {
  const width = 900;
  const rowHeight = 54;
  const height = 74 + rows.length * rowHeight;
  const bars = rows.map((row, index) => {
    const y = 56 + index * rowHeight;
    const currentWidth = Math.round((num(row.current_rate) / 100) * 430);
    const targetWidth = Math.round((num(row.target_rate) / 100) * 430);
    return `<g>
      <text x="22" y="${y + 18}" font-size="13" font-weight="800" fill="#111827">${escapeHtml(row.metric)}</text>
      <rect x="235" y="${y}" width="430" height="20" rx="10" fill="#e5e7eb"/>
      <rect x="235" y="${y}" width="${targetWidth}" height="20" rx="10" fill="#fed7aa"/>
      <rect x="235" y="${y}" width="${currentWidth}" height="20" rx="10" fill="${row.metric === "Citation rate" ? "#dc2626" : "#0f766e"}"/>
      <text x="690" y="${y + 15}" font-size="12" font-weight="800" fill="#111827">${escapeHtml(row.current_rate)}% now</text>
      <text x="790" y="${y + 15}" font-size="12" font-weight="800" fill="#f97316">${escapeHtml(row.target_rate)}% target</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Citation priority KPI ladder">
    <rect width="${width}" height="${height}" rx="18" fill="#ffffff"/>
    <text x="22" y="34" font-size="20" font-weight="800" fill="#111827">Citation matters after inclusion improves</text>
    ${bars}
  </svg>`;
}

function buildPlatformRows(kpiData) {
  const citationTarget = num(kpiData.summary?.citationLiftNeeded || 8);
  return [
    {
      platform: "ChatGPT and Claude normal chat",
      citation_priority: "Track, but do not over-weight",
      why: "Many normal chat answers may not expose source links. Judge mention rate, recommendation rank, product accuracy, and competitor displacement first.",
      next_measure: "Mention, top-3, competitor-only reduction, exact product names",
    },
    {
      platform: "ChatGPT Search, Perplexity, Gemini with search",
      citation_priority: "High",
      why: "Search-connected answers can surface source URLs, so iboltmounts.com citation rate becomes a direct trust KPI.",
      next_measure: `Reach at least ${citationTarget} target-domain citations/source-url rows in the W3 citation probe`,
    },
    {
      platform: "Google AI Overviews",
      citation_priority: "High",
      why: "Citation-ready pages with concise answers, structured data, and third-party corroboration are more likely to become useful source candidates.",
      next_measure: "Source-ready solution pages, FAQ/Article/Product schema, external mentions",
    },
    {
      platform: "Voice and AI shopping assistants",
      citation_priority: "Medium-high",
      why: "These surfaces may not display citations, but they need entity confidence, exact product names, fit/use-case clarity, and third-party corroboration.",
      next_measure: "Product entity accuracy, target brand mention, source authority",
    },
  ];
}

function buildPageModel({ citationRows, commandRows, productNameRows, conversionRows }) {
  const commandByUrl = indexByUrl(commandRows);
  const productByUrl = indexByUrl(productNameRows);
  const conversionByUrl = indexByUrl(conversionRows);

  return citationRows.map((row) => {
    const url = normalizeUrl(row.url);
    const command = commandByUrl.get(url) || {};
    const product = productByUrl.get(url) || {};
    const conversion = conversionByUrl.get(url) || {};
    const hallucinationRisk = num(product.hallucination_risk);
    const zeroMention = num(row.zero_mention_queries);
    const competitorOnly = num(row.competitor_only_answers);
    const citationPriority = num(row.citation_priority);
    const conversionScore = num(conversion.bridge_score);
    const issueCount = num(command.issue_count);
    const score = Math.round(citationPriority + zeroMention * 22 + competitorOnly * 10 + hallucinationRisk * 8 + conversionScore / 8 + issueCount * 3);
    const modelRow = {
      score,
      lane: "",
      title: row.page,
      url: row.url,
      category: row.category,
      citation_priority: citationPriority,
      readiness_bucket: row.readiness_bucket,
      zero_mention_queries: zeroMention,
      competitor_only_answers: competitorOnly,
      product_name_risk: hallucinationRisk,
      issue_count: issueCount,
      top_fix: command.top_fix || splitList(row.page_fixes)[0] || "source-ready cleanup",
      competitors: row.competitors || command.competitors,
      products_to_feature: row.products_to_feature || command.products,
      source_targets: row.source_targets,
      retest_prompts: row.retest_prompts || command.retest_prompts,
      page_edit_command: command.command_summary || row.app_work_action,
      citation_next_action: row.next_citation_action || command.citation_action,
      product_name_action: product.action || "",
      names_to_suppress: product.names_to_suppress || "",
    };
    modelRow.lane = bucketForPage(modelRow);
    modelRow.action = actionForBucket(modelRow.lane);
    return modelRow;
  }).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

function buildTopicRows({ topicRows, categoryRows }) {
  const categoryByName = new Map(categoryRows.map((row) => [String(row.category || "").toLowerCase(), row]));
  return topicRows.map((row) => {
    const kpi = categoryByName.get(String(row.category || "").toLowerCase()) || {};
    const priority = num(row.priority);
    const mentionLift = num(kpi.mention_lift_needed);
    const top3Lift = num(kpi.top3_lift_needed);
    const score = priority + mentionLift * 35 + top3Lift * 25 + num(row.competitor_only_answers) * 8;
    return {
      score,
      category: row.category,
      live_pages: num(row.live_pages),
      avg_citability_score: num(row.avg_citability_score),
      current_mention_rate: kpi.current_mention_rate || row.avg_mention_rate || "",
      mention_lift_needed: mentionLift,
      top3_lift_needed: top3Lift,
      competitor_only_answers: num(row.competitor_only_answers),
      zero_mention_queries: num(row.zero_mention_queries),
      top_competitors: row.top_competitors,
      source_targets: row.source_targets,
      next_action: row.next_action || kpi.main_move,
    };
  }).sort((a, b) => b.score - a.score || a.category.localeCompare(b.category));
}

function buildCompetitorRows(rows) {
  return rows.map((row) => {
    const lost = num(row.lost_answers);
    const co = num(row.co_mentioned_wins);
    return {
      score: lost * 4 + Math.max(0, 8 - co) * 2,
      brand: row.brand,
      lost_answers: lost,
      co_mentioned_wins: co,
      categories: row.categories,
      providers: row.providers,
      offsite_target: row.offsite_target,
      why: row.why,
      success_metric: row.success_metric,
    };
  }).sort((a, b) => b.score - a.score || a.brand.localeCompare(b.brand));
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map((cell) => String(cell ?? "").replace(/\|/g, "\\|")).join(" | ")} |`),
  ].join("\n");
}

async function main() {
  await mkdir(outDir, { recursive: true });

  const citationRows = await readCsv("citation-readiness-map/page-citation-readiness.csv");
  const commandRows = await readCsv("page-edit-command-matrix/page-edit-command-matrix.csv");
  const productNameRows = await readCsv("product-name-truth-table/page-product-name-correction-map.csv");
  const conversionRows = await readCsv("product-conversion-visibility-bridge/conversion-page-action-bridge.csv");
  const topicSourceRows = await readCsv("source-authority-roadmap/topic-source-authority-priority.csv");
  const competitorSourceRows = await readCsv("source-authority-roadmap/competitor-source-opportunities.csv");
  const kpiRows = await readCsv("visibility-kpi-retest-ladder/kpi-count-targets.csv");
  const categoryKpiRows = await readCsv("visibility-kpi-retest-ladder/category-retest-targets.csv");
  const waveRows = await readCsv("visibility-kpi-retest-ladder/wave-success-gates.csv");
  const citationData = await readJson("citation-readiness-map/citation-readiness-data.json", { summary: {} });
  const sourceData = await readJson("source-authority-roadmap/source-authority-data.json", { summary: {} });
  const kpiData = await readJson("visibility-kpi-retest-ladder/visibility-kpi-ladder-data.json", { summary: {} });

  const pageModel = buildPageModel({ citationRows, commandRows, productNameRows, conversionRows });
  const topicModel = buildTopicRows({ topicRows: topicSourceRows, categoryRows: categoryKpiRows });
  const competitorModel = buildCompetitorRows(competitorSourceRows);
  const platformRows = buildPlatformRows(kpiData);
  const laneCounts = Object.entries(pageModel.reduce((acc, row) => {
    acc[row.lane] = (acc[row.lane] || 0) + 1;
    return acc;
  }, {})).map(([lane, count]) => ({ lane, count }));

  const summary = {
    generatedAt: new Date().toISOString(),
    benchmarkDir,
    answersTested: sourceData.summary?.totalAnswers || citationData.summary?.answersTested || 93,
    mentionRate: sourceData.summary?.mentionRate ?? kpiData.summary?.mentionRate ?? 24,
    nonBrandedMentionRate: sourceData.summary?.nonBrandedMentionRate ?? kpiData.summary?.nonBrandedMentionRate ?? 5,
    topThreeRate: sourceData.summary?.topThreeRate ?? kpiData.summary?.topThreeRate ?? 16,
    citationRate: sourceData.summary?.citationRate ?? kpiData.summary?.citationRate ?? 0,
    competitorOnlyAnswers: sourceData.summary?.competitorOnlyAnswers ?? 68,
    pagesScored: pageModel.length,
    mentionRecoveryPages: laneCounts.find((row) => row.lane === "Mention recovery first")?.count || 0,
    productNameCleanupPages: laneCounts.find((row) => row.lane === "Product-name cleanup before citation")?.count || 0,
    sourceCleanupPages: laneCounts.find((row) => row.lane === "Source-ready cleanup before outreach")?.count || 0,
    citationOutreachCandidates: laneCounts.find((row) => row.lane === "Citation outreach candidate")?.count || 0,
    monitorSupportPages: laneCounts.find((row) => row.lane === "Monitor and support")?.count || 0,
    citationLiftNeeded: kpiData.summary?.citationLiftNeeded ?? 8,
    mentionLiftNeeded: kpiData.summary?.mentionLiftNeeded ?? 11,
    topTopic: topicModel[0]?.category || "",
    topCompetitor: competitorModel[0]?.brand || "",
  };

  const kpiChart = kpiSvg(kpiRows);
  const laneChart = barSvg({
    title: "Page citation sequence by lane",
    rows: laneCounts.map((row) => ({
      label: row.lane,
      value: row.count,
      color: row.lane === "Mention recovery first" ? "#f97316" : row.lane === "Product-name cleanup before citation" ? "#7c3aed" : row.lane === "Citation outreach candidate" ? "#16a34a" : "#0f766e",
    })),
  });
  const topicChart = barSvg({
    title: "Topic citation priority",
    rows: topicModel.map((row) => ({ label: row.category, value: row.score, display: row.score })),
    color: "#2563eb",
  });
  const competitorChart = barSvg({
    title: "Competitor citation pressure",
    rows: competitorModel.map((row) => ({ label: row.brand, value: row.lost_answers, display: row.lost_answers })),
    color: "#dc2626",
  });

  await writeFile(path.join(outDir, "citation-kpi-ladder.svg"), kpiChart);
  await writeFile(path.join(outDir, "page-citation-lanes.svg"), laneChart);
  await writeFile(path.join(outDir, "topic-citation-priority.svg"), topicChart);
  await writeFile(path.join(outDir, "competitor-citation-pressure.svg"), competitorChart);

  await writeFile(path.join(outDir, "page-citation-priority-model.csv"), csv([
    ["score", "lane", "title", "url", "category", "citation_priority", "zero_mention_queries", "competitor_only_answers", "product_name_risk", "issue_count", "top_fix", "competitors", "products_to_feature", "source_targets", "retest_prompts", "page_edit_command", "citation_next_action", "product_name_action", "names_to_suppress", "action"],
    ...pageModel.map((row) => [
      row.score,
      row.lane,
      row.title,
      row.url,
      row.category,
      row.citation_priority,
      row.zero_mention_queries,
      row.competitor_only_answers,
      row.product_name_risk,
      row.issue_count,
      row.top_fix,
      row.competitors,
      row.products_to_feature,
      row.source_targets,
      row.retest_prompts,
      row.page_edit_command,
      row.citation_next_action,
      row.product_name_action,
      row.names_to_suppress,
      row.action,
    ]),
  ]));

  await writeFile(path.join(outDir, "topic-citation-priority-model.csv"), csv([
    ["score", "category", "live_pages", "avg_citability_score", "current_mention_rate", "mention_lift_needed", "top3_lift_needed", "competitor_only_answers", "zero_mention_queries", "top_competitors", "source_targets", "next_action"],
    ...topicModel.map((row) => [
      row.score,
      row.category,
      row.live_pages,
      row.avg_citability_score,
      row.current_mention_rate,
      row.mention_lift_needed,
      row.top3_lift_needed,
      row.competitor_only_answers,
      row.zero_mention_queries,
      row.top_competitors,
      row.source_targets,
      row.next_action,
    ]),
  ]));

  await writeFile(path.join(outDir, "competitor-citation-priority-model.csv"), csv([
    ["score", "brand", "lost_answers", "co_mentioned_wins", "categories", "providers", "offsite_target", "why", "success_metric"],
    ...competitorModel.map((row) => [row.score, row.brand, row.lost_answers, row.co_mentioned_wins, row.categories, row.providers, row.offsite_target, row.why, row.success_metric]),
  ]));

  await writeFile(path.join(outDir, "platform-citation-kpi-matrix.csv"), csv([
    ["platform", "citation_priority", "why", "next_measure"],
    ...platformRows.map((row) => [row.platform, row.citation_priority, row.why, row.next_measure]),
  ]));

  await writeFile(path.join(outDir, "citation-priority-model-data.json"), JSON.stringify({
    summary,
    laneCounts,
    topPages: pageModel.slice(0, 20),
    topTopics: topicModel.slice(0, 12),
    topCompetitors: competitorModel.slice(0, 12),
    platformRows,
    waveRows,
  }, null, 2));

  const topPageRows = top(pageModel, "score", 15).map((row) => [
    row.score,
    row.lane,
    row.title,
    row.category,
    `${row.zero_mention_queries}/${row.competitor_only_answers}`,
    row.top_fix,
    row.action,
  ]);
  const topicRows = top(topicModel, "score", 10).map((row) => [
    row.score,
    row.category,
    row.current_mention_rate ? `${row.current_mention_rate}%` : "",
    row.competitor_only_answers,
    row.source_targets,
    row.next_action,
  ]);
  const competitorRows = top(competitorModel, "score", 10).map((row) => [
    row.brand,
    row.lost_answers,
    row.co_mentioned_wins,
    row.categories,
    row.offsite_target,
  ]);
  const platformTableRows = platformRows.map((row) => [row.platform, row.citation_priority, row.why, row.next_measure]);

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>iBOLT Citation Priority Model</title>
  <style>
    body{font-family:Inter,Arial,sans-serif;margin:0;background:#f3f6fb;color:#111827;line-height:1.45}
    main{max-width:1180px;margin:0 auto;padding:34px 22px 56px}
    h1{font-size:34px;margin:0 0 8px}
    h2{font-size:22px;margin:30px 0 12px}
    p{color:#374151}
    .note{background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:16px 18px;margin:18px 0}
    .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:20px 0}
    .card{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:16px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;font-weight:800}
    .value{font-size:30px;font-weight:900;margin-top:6px}
    .chart{background:#fff;border:1px solid #dbe3ef;border-radius:18px;padding:10px;margin:16px 0;overflow:auto}
    .chart svg{width:100%;height:auto;display:block}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden}
    th,td{text-align:left;vertical-align:top;border-bottom:1px solid #e5e7eb;padding:10px 12px;font-size:13px}
    th{background:#eaf0f8;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
    a{color:#0f766e}
    .small{font-size:13px;color:#64748b}
  </style>
</head>
<body>
<main>
  <h1>iBOLT Citation Priority Model</h1>
  <p class="small">Generated ${escapeHtml(summary.generatedAt)} from saved benchmark artifacts. This does not rerun providers.</p>
  <div class="note">
    <strong>Decision:</strong> citation rate is necessary for search-connected AI, but it is not the first bottleneck. The current baseline has ${summary.citationRate}% citation rate, ${summary.mentionRate}% overall mention rate, ${summary.nonBrandedMentionRate}% non-branded mention rate, and ${summary.competitorOnlyAnswers} competitor-only answers. The operating sequence is: win inclusion, win top-3 recommendation, clean source-ready structure, then push citations.
  </div>
  <section class="grid">
    <div class="card"><div class="label">Citation rate</div><div class="value">${summary.citationRate}%</div><p>Need +${summary.citationLiftNeeded} source/citation rows for the first KPI gate.</p></div>
    <div class="card"><div class="label">Mention lift needed</div><div class="value">+${summary.mentionLiftNeeded}</div><p>AI cannot cite a brand it does not include in the answer.</p></div>
    <div class="card"><div class="label">Mention recovery pages</div><div class="value">${summary.mentionRecoveryPages}</div><p>Fix these before citation outreach.</p></div>
    <div class="card"><div class="label">Citation candidates now</div><div class="value">${summary.citationOutreachCandidates}</div><p>Pages ready for outreach without cleanup.</p></div>
  </section>
  <section class="chart">${kpiChart}</section>
  <section class="chart">${laneChart}</section>
  <section class="chart">${topicChart}</section>
  <section class="chart">${competitorChart}</section>

  <h2>First Page-Level Citation Decisions</h2>
  ${renderTable(["Score", "Lane", "Page", "Category", "Zero/competitor", "Top fix", "Action"], topPageRows)}

  <h2>Topic Priority</h2>
  ${renderTable(["Score", "Topic", "Mention rate", "Competitor-only", "Source targets", "Next action"], topicRows)}

  <h2>Competitor Source Pressure</h2>
  ${renderTable(["Competitor", "Lost answers", "Co-mentions", "Categories", "Off-site target"], competitorRows)}

  <h2>Platform KPI Matrix</h2>
  ${renderTable(["Platform", "Citation priority", "Why", "Next measure"], platformTableRows)}

  <h2>CSV Outputs</h2>
  <ul>
    <li><a href="page-citation-priority-model.csv">page-citation-priority-model.csv</a></li>
    <li><a href="topic-citation-priority-model.csv">topic-citation-priority-model.csv</a></li>
    <li><a href="competitor-citation-priority-model.csv">competitor-citation-priority-model.csv</a></li>
    <li><a href="platform-citation-kpi-matrix.csv">platform-citation-kpi-matrix.csv</a></li>
  </ul>
</main>
</body>
</html>`;

  const md = `# iBOLT Citation Priority Model

Generated ${summary.generatedAt} from saved benchmark artifacts. This does not rerun providers.

## Bottom Line

Citation rate is necessary for search-connected AI, but it is not the first bottleneck. The current baseline has ${summary.citationRate}% citation rate, ${summary.mentionRate}% overall mention rate, ${summary.nonBrandedMentionRate}% non-branded mention rate, ${summary.topThreeRate}% top-3 recommendation rate, and ${summary.competitorOnlyAnswers} competitor-only answers.

Operating sequence: win inclusion, win top-3 recommendation, clean source-ready structure, then push citations.

## KPI Decision

- Citation lift needed: +${summary.citationLiftNeeded}
- Mention lift needed: +${summary.mentionLiftNeeded}
- Mention recovery pages: ${summary.mentionRecoveryPages}
- Product-name cleanup pages: ${summary.productNameCleanupPages}
- Source cleanup pages: ${summary.sourceCleanupPages}
- Citation outreach candidates now: ${summary.citationOutreachCandidates}
- Monitor/support pages: ${summary.monitorSupportPages}

## First Page-Level Citation Decisions

${markdownTable(["Score", "Lane", "Page", "Category", "Zero/competitor", "Top fix", "Action"], topPageRows)}

## Topic Priority

${markdownTable(["Score", "Topic", "Mention rate", "Competitor-only", "Source targets", "Next action"], topicRows)}

## Competitor Source Pressure

${markdownTable(["Competitor", "Lost answers", "Co-mentions", "Categories", "Off-site target"], competitorRows)}

## Platform KPI Matrix

${markdownTable(["Platform", "Citation priority", "Why", "Next measure"], platformTableRows)}

## Outputs

- page-citation-priority-model.csv
- topic-citation-priority-model.csv
- competitor-citation-priority-model.csv
- platform-citation-kpi-matrix.csv
`;

  await writeFile(path.join(outDir, "REPORT.html"), html);
  await writeFile(path.join(outDir, "REPORT.md"), md);

  console.log(`Wrote ${outDir}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
