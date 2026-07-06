#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "source-citation-closure-board");

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

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function compact(value, length = 180) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 3).trim()}...` : text;
}

function bool(value) {
  return String(value ?? "").toLowerCase() === "true";
}

function addPage(map, row) {
  const url = String(row.url ?? "").trim();
  if (!url) return null;
  if (!map.has(url)) {
    map.set(url, {
      url,
      title: row.title || row.page || "",
      category: row.category || "",
      sourceStatus: "",
      stage: "",
      readinessBucket: "",
      bodyScore: 0,
      opportunityScore: 0,
      aiCitabilityScore: 0,
      citationPriority: 0,
      benchmarkQueryCount: 0,
      zeroMentionQueries: 0,
      competitorOnlyAnswers: 0,
      cleanMentions: 0,
      coMentions: 0,
      providerRequestsReady: 0,
      issueCount: 0,
      topFix: "",
      issues: [],
      missingFlags: [],
      competitors: [],
      productsToFeature: [],
      sourceTargets: [],
      retestPrompts: [],
      appWorkAction: "",
      pageEditCommand: "",
      citationAction: "",
      contractorWhy: "",
      retestMetric: "",
      productNameRisk: 0,
      productNameAction: "",
      namesToSuppress: "",
      quickAnswerCommand: "",
      schemaCommand: "",
      comparisonCommand: "",
      ctaCommand: "",
      imageAltCommand: "",
      firstHourAction: "",
      citationNextAction: "",
      fromSourceReadyQueue: false,
    });
  }
  const page = map.get(url);
  page.title ||= row.title || row.page || "";
  page.category ||= row.category || "";
  return page;
}

function mergePage(page, row, source) {
  if (!page) return;
  page.sourceStatus ||= row.source_status || "";
  page.stage ||= row.stage || row.lane || row.visibility_stage || "";
  page.readinessBucket ||= row.readiness_bucket || row.citation_readiness_bucket || row.lane || "";
  page.bodyScore = Math.max(page.bodyScore, toNumber(row.body_score));
  page.opportunityScore = Math.max(page.opportunityScore, toNumber(row.opportunity_score));
  page.aiCitabilityScore = Math.max(page.aiCitabilityScore, toNumber(row.ai_citability_score));
  page.citationPriority = Math.max(page.citationPriority, toNumber(row.citation_priority));
  page.benchmarkQueryCount = Math.max(page.benchmarkQueryCount, toNumber(row.benchmark_query_count));
  page.zeroMentionQueries = Math.max(page.zeroMentionQueries, toNumber(row.zero_mention_queries));
  page.competitorOnlyAnswers = Math.max(page.competitorOnlyAnswers, toNumber(row.competitor_only_answers));
  page.cleanMentions = Math.max(page.cleanMentions, toNumber(row.clean_mentions));
  page.coMentions = Math.max(page.coMentions, toNumber(row.co_mentions));
  page.providerRequestsReady = Math.max(page.providerRequestsReady, toNumber(row.provider_requests_ready));
  page.issueCount = Math.max(page.issueCount, toNumber(row.issue_count));
  page.productNameRisk = Math.max(page.productNameRisk, toNumber(row.product_name_risk));
  page.topFix ||= row.top_fix || "";
  page.appWorkAction ||= row.app_work_action || row.primary_action || "";
  page.pageEditCommand ||= row.page_edit_command || row.immediate_action || row.first_hour_action || "";
  page.citationAction ||= row.citation_action || row.next_citation_action || "";
  page.citationNextAction ||= row.next_citation_action || "";
  page.contractorWhy ||= row.contractor_why || row.why || "";
  page.retestMetric ||= row.retest_metric || row.success_metric || "";
  page.productNameAction ||= row.product_name_action || "";
  page.namesToSuppress ||= row.names_to_suppress || "";
  page.quickAnswerCommand ||= row.quick_answer_command || "";
  page.schemaCommand ||= row.schema_command || "";
  page.comparisonCommand ||= row.comparison_command || "";
  page.ctaCommand ||= row.cta_command || "";
  page.imageAltCommand ||= row.image_alt_command || "";
  page.firstHourAction ||= row.first_hour_action || "";
  page.fromSourceReadyQueue ||= source === "sourceReady";
  page.issues.push(...splitList(row.issues));
  page.competitors.push(...splitList(row.competitors));
  page.productsToFeature.push(...splitList(row.products_to_feature || row.products));
  page.sourceTargets.push(...splitList(row.source_targets));
  page.retestPrompts.push(...splitList(row.retest_prompts));

  if (row.quick_answer_near_top && !bool(row.quick_answer_near_top)) page.missingFlags.push("missing early quick answer");
  if (row.has_faq_schema && !bool(row.has_faq_schema)) page.missingFlags.push("missing FAQPage schema");
  if (row.has_article_schema && !bool(row.has_article_schema)) page.missingFlags.push("missing Article schema");
  if (row.comparison_present && !bool(row.comparison_present)) page.missingFlags.push("missing comparison block");
  if (toNumber(row.missing_alt) > 0) page.missingFlags.push("missing image alt text");
  if (toNumber(row.add_to_cart_density) >= 8) page.missingFlags.push("too many cart CTAs");
  if (page.productNameRisk > 0) page.missingFlags.push("product-name cleanup");
  if (/canonical/i.test(row.page_status || row.stage || row.lane || "")) page.missingFlags.push("canonical/survivor decision");
}

function scorePage(page) {
  const sourceReadyBonus = page.fromSourceReadyQueue ? 40 : 0;
  const blockerPenalty = page.missingFlags.length * 5;
  return Math.round(
    page.citationPriority
    + page.aiCitabilityScore
    + page.zeroMentionQueries * 32
    + page.competitorOnlyAnswers * 24
    + page.providerRequestsReady
    + page.opportunityScore * 0.6
    + page.issueCount * 7
    + sourceReadyBonus
    + blockerPenalty,
  );
}

function laneFor(page) {
  const flags = unique(page.missingFlags);
  const stage = `${page.stage} ${page.readinessBucket}`.toLowerCase();
  if (flags.some((flag) => /canonical|survivor/i.test(flag)) || /canonical/.test(stage)) return "Canonical decision first";
  if (page.zeroMentionQueries > 0 || page.competitorOnlyAnswers > 0 || /mention first|mention recovery/.test(stage)) return "Mention recovery before citation";
  if (flags.length > 0) return "Source cleanup before outreach";
  if (page.fromSourceReadyQueue || page.aiCitabilityScore >= 90) return "Ready for citation outreach";
  return "Monitor and strengthen internal source signals";
}

function blockerSummary(page) {
  const blockers = unique([
    ...page.missingFlags,
    ...page.issues.filter((issue) => /quick|schema|comparison|alt|cart|CTA|canonical|product/i.test(issue)),
  ]);
  if (page.zeroMentionQueries > 0) blockers.push(`${page.zeroMentionQueries} zero-mention queries`);
  if (page.competitorOnlyAnswers > 0) blockers.push(`${page.competitorOnlyAnswers} competitor-only answers`);
  return unique(blockers).slice(0, 10);
}

function categoryRollup(rows) {
  const map = new Map();
  for (const row of rows) {
    const category = row.category || "uncategorized";
    if (!map.has(category)) {
      map.set(category, {
        category,
        pages: 0,
        ready: 0,
        sourceCleanup: 0,
        mentionFirst: 0,
        canonicalFirst: 0,
        competitorOnly: 0,
        zeroMention: 0,
        sourceTargets: [],
        topCompetitors: [],
      });
    }
    const item = map.get(category);
    item.pages += 1;
    if (row.lane === "Ready for citation outreach") item.ready += 1;
    if (row.lane === "Source cleanup before outreach") item.sourceCleanup += 1;
    if (row.lane === "Mention recovery before citation") item.mentionFirst += 1;
    if (row.lane === "Canonical decision first") item.canonicalFirst += 1;
    item.competitorOnly += row.competitorOnlyAnswers;
    item.zeroMention += row.zeroMentionQueries;
    item.sourceTargets.push(...row.sourceTargets);
    item.topCompetitors.push(...row.competitors);
  }
  return [...map.values()]
    .map((row) => ({
      ...row,
      sourceTargets: unique(row.sourceTargets).slice(0, 8),
      topCompetitors: unique(row.topCompetitors).slice(0, 8),
      pressureScore: row.competitorOnly * 14 + row.zeroMention * 20 + row.mentionFirst * 12 + row.ready * 5,
    }))
    .sort((a, b) => b.pressureScore - a.pressureScore || a.category.localeCompare(b.category));
}

function sourceTargetRows(rows) {
  const map = new Map();
  for (const row of rows) {
    for (const target of row.sourceTargets) {
      const key = `${row.category}::${target}`;
      if (!map.has(key)) {
        map.set(key, {
          category: row.category,
          sourceTarget: target,
          pages: [],
          competitors: [],
          zeroMention: 0,
          competitorOnly: 0,
        });
      }
      const item = map.get(key);
      item.pages.push(row.title);
      item.competitors.push(...row.competitors);
      item.zeroMention += row.zeroMentionQueries;
      item.competitorOnly += row.competitorOnlyAnswers;
    }
  }
  return [...map.values()]
    .map((row) => {
      const pageCount = unique(row.pages).length;
      return {
        ...row,
        pageCount,
        pages: unique(row.pages).slice(0, 8),
        competitors: unique(row.competitors).slice(0, 8),
        score: pageCount * 10 + row.zeroMention * 20 + row.competitorOnly * 12,
      };
    })
    .sort((a, b) => b.score - a.score || a.sourceTarget.localeCompare(b.sourceTarget));
}

function barSvg({ title, rows, labelKey, valueKey, color = "#0f766e", width = 900 }) {
  const chartRows = rows.slice(0, 12);
  const rowHeight = 36;
  const height = 78 + chartRows.length * rowHeight;
  const max = Math.max(1, ...chartRows.map((row) => toNumber(row[valueKey])));
  const bars = chartRows.map((row, index) => {
    const y = 58 + index * rowHeight;
    const value = toNumber(row[valueKey]);
    const barWidth = Math.max(3, Math.round((value / max) * (width - 370)));
    return `<g>
      <text x="22" y="${y + 17}" font-size="13" font-weight="900" fill="#111827">${escapeHtml(compact(row[labelKey], 34))}</text>
      <rect x="280" y="${y}" width="${width - 370}" height="22" rx="11" fill="#e5e7eb"/>
      <rect x="280" y="${y}" width="${barWidth}" height="22" rx="11" fill="${color}"/>
      <text x="${width - 34}" y="${y + 16}" text-anchor="end" font-size="13" font-weight="900" fill="#111827">${escapeHtml(value)}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#ffffff"/>
    <text x="22" y="34" font-size="20" font-weight="900" fill="#111827">${escapeHtml(title)}</text>
    ${bars}
  </svg>`;
}

function table(headers, rows) {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table>${head}${body}</table>`;
}

function card(label, value, note) {
  return `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`;
}

function renderHtml({ rows, rollup, targets }) {
  const ready = rows.filter((row) => row.lane === "Ready for citation outreach").length;
  const sourceCleanup = rows.filter((row) => row.lane === "Source cleanup before outreach").length;
  const mentionFirst = rows.filter((row) => row.lane === "Mention recovery before citation").length;
  const canonicalFirst = rows.filter((row) => row.lane === "Canonical decision first").length;
  const zeroMentions = rows.reduce((sum, row) => sum + row.zeroMentionQueries, 0);
  const competitorOnly = rows.reduce((sum, row) => sum + row.competitorOnlyAnswers, 0);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT Source and Citation Closure Board</title>
  <style>
    body{margin:0;background:#f6f8fb;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1220px;margin:0 auto;padding:34px 24px 68px}
    h1{font-size:38px;line-height:1.1;margin:0 0 8px;letter-spacing:0}
    h2{font-size:23px;margin:36px 0 12px}
    p,li{font-size:15px;line-height:1.56;color:#334155}
    a{color:#0f766e;overflow-wrap:anywhere}
    .note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #0f766e;border-radius:12px;padding:16px 18px;margin:20px 0}
    .warn{border-left-color:#f97316}
    .cards{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin:22px 0}
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
  <h1>iBOLT Source and Citation Closure Board</h1>
  <p>This board translates page-level benchmark evidence into source-readiness work: which pages need mention recovery, which need cleanup before outreach, and which URLs can be handed to SEO support for external citation work.</p>

  <div class="note">
    <strong>Read this as the citation-rate work order.</strong> Citation rate is still 0% in the saved benchmark, but most pages should not be sent straight to outreach. Pages with zero-mention or competitor-only losses need answer-first edits and exact product modules before the contractor asks outside sites to cite them.
  </div>

  <section class="cards">
    ${card("Pages scored", rows.length, "Union of citation, page-edit, body-inspection, and source-readiness queues.")}
    ${card("Ready now", ready, "Can be used for external citation outreach with light maintenance.")}
    ${card("Cleanup first", sourceCleanup, "Need source/schema/content cleanup before outreach.")}
    ${card("Mention first", mentionFirst, "Need inclusion and top-3 recovery before citation push.")}
    ${card("Canonical first", canonicalFirst, "Need survivor URL decision before edits or outreach.")}
    ${card("Competitor-only", competitorOnly, "Competitor-only answer pressure across scored pages.")}
  </section>

  <div class="note warn">
    <strong>Priority categories:</strong> fleet, restaurant, fishing, delivery, warehouse, and AMPS/modular should be sequenced first because they combine buyer intent, competitor defaults, and source targets the contractor can pursue.
  </div>

  <section class="grid">
    <div class="chart">${barSvg({ title: "Category citation closure pressure", rows: rollup, labelKey: "category", valueKey: "pressureScore", color: "#b91c1c" })}</div>
    <div class="chart">${barSvg({ title: "External source target pressure", rows: targets, labelKey: "sourceTarget", valueKey: "score", color: "#2563eb" })}</div>
  </section>

  <h2>Top Page Closure Queue</h2>
  ${table(
    ["Rank", "Lane", "Page", "Category", "Score", "Blockers", "On-site action", "External citation target", "Retest"],
    rows.slice(0, 40).map((row, index) => [
      index + 1,
      row.lane,
      row.title,
      row.category,
      row.score,
      row.blockers.join("; "),
      row.onSiteAction,
      row.sourceTargets.slice(0, 4).join("; "),
      row.retestPrompts.slice(0, 4).join("; "),
    ]),
  )}

  <h2>Pages Ready For Citation Outreach</h2>
  ${table(
    ["Page", "Category", "Source targets", "Contractor action", "Retest metric"],
    rows.filter((row) => row.lane === "Ready for citation outreach").slice(0, 30).map((row) => [
      row.title,
      row.category,
      row.sourceTargets.slice(0, 5).join("; "),
      row.citationAction,
      row.retestMetric,
    ]),
  )}

  <h2>Category Rollup</h2>
  ${table(
    ["Category", "Pages", "Ready", "Cleanup first", "Mention first", "Canonical first", "Zero mentions", "Competitor-only", "Source targets"],
    rollup.map((row) => [
      row.category,
      row.pages,
      row.ready,
      row.sourceCleanup,
      row.mentionFirst,
      row.canonicalFirst,
      row.zeroMention,
      row.competitorOnly,
      row.sourceTargets.join("; "),
    ]),
  )}

  <h2>Source Target Opportunities</h2>
  ${table(
    ["Category", "Source target", "Pages", "Competitors", "Score"],
    targets.slice(0, 40).map((row) => [
      row.category,
      row.sourceTarget,
      row.pages.join("; "),
      row.competitors.join("; "),
      row.score,
    ]),
  )}
</main>
</body>
</html>`;
}

function renderMarkdown({ rows, rollup, targets }) {
  return `# iBOLT Source and Citation Closure Board

Citation rate is still 0% in the saved benchmark. The immediate work is not generic outreach. Pages with zero-mention or competitor-only losses need answer-first edits, schema, product modules, and comparison cleanup before they are good citation targets.

## Page Lanes

- Ready for citation outreach: ${rows.filter((row) => row.lane === "Ready for citation outreach").length}
- Source cleanup before outreach: ${rows.filter((row) => row.lane === "Source cleanup before outreach").length}
- Mention recovery before citation: ${rows.filter((row) => row.lane === "Mention recovery before citation").length}
- Canonical decision first: ${rows.filter((row) => row.lane === "Canonical decision first").length}

## Top Pages

${rows.slice(0, 20).map((row, index) => `${index + 1}. ${row.title}: ${row.lane}. Blockers: ${row.blockers.join("; ")}`).join("\n")}

## Category Rollup

${rollup.map((row) => `- ${row.category}: ${row.pages} pages, ${row.ready} ready, ${row.mentionFirst} mention-first, ${row.competitorOnly} competitor-only pressure.`).join("\n")}

## Source Targets

${targets.slice(0, 20).map((row) => `- ${row.category}: ${row.sourceTarget}, pages: ${row.pages.join("; ")}`).join("\n")}
`;
}

async function main() {
  const pageMap = new Map();
  const datasets = [
    ["body", await readCsv("blog-body-inspection/blog-body-inspection.csv")],
    ["edit", await readCsv("page-edit-command-matrix/page-edit-command-matrix.csv")],
    ["control", await readCsv("all-blog-action-control-sheet/all-blog-action-control-sheet.csv")],
    ["citationQueue", await readCsv("citation-vs-mention-control-report/citation-vs-mention-page-queue.csv")],
    ["readiness", await readCsv("citation-readiness-map/page-citation-readiness.csv")],
    ["priority", await readCsv("citation-priority-model/page-citation-priority-model.csv")],
    ["bridge", await readCsv("visibility-citation-bridge/visibility-to-citation-page-queue.csv")],
    ["sourceReady", await readCsv("visibility-citation-bridge/citation-ready-source-queue.csv")],
  ];

  for (const [source, rows] of datasets) {
    for (const row of rows) {
      const page = addPage(pageMap, row);
      mergePage(page, row, source);
    }
  }

  const rows = [...pageMap.values()]
    .map((page) => {
      const blockers = blockerSummary(page);
      const lane = laneFor(page);
      const sourceTargets = unique(page.sourceTargets);
      const retestPrompts = unique(page.retestPrompts);
      const onSiteAction = page.pageEditCommand || page.appWorkAction || page.quickAnswerCommand || "Keep page stable, strengthen internal source signals, and preserve exact product links.";
      const citationAction = page.citationAction || page.citationNextAction || "After on-site cleanup, hand the exact URL and source-target category to SEO support for external citation work.";
      return {
        ...page,
        lane,
        blockers,
        sourceTargets,
        retestPrompts,
        competitors: unique(page.competitors),
        productsToFeature: unique(page.productsToFeature),
        issues: unique(page.issues),
        missingFlags: unique(page.missingFlags),
        onSiteAction,
        citationAction,
        score: scorePage(page),
      };
    })
    .filter((row) => row.title && row.url)
    .sort((a, b) => b.score - a.score || b.competitorOnlyAnswers - a.competitorOnlyAnswers || a.title.localeCompare(b.title));

  const rollup = categoryRollup(rows);
  const targets = sourceTargetRows(rows);
  const readyRows = rows.filter((row) => row.lane === "Ready for citation outreach");
  const mentionFirstRows = rows.filter((row) => row.lane === "Mention recovery before citation" || row.lane === "Canonical decision first");

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml({ rows, rollup, targets }));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown({ rows, rollup, targets }));
  await writeFile(path.join(outDir, "source-citation-closure-board.csv"), csv([
    ["rank", "score", "lane", "title", "url", "category", "blockers", "ai_citability_score", "citation_priority", "zero_mention_queries", "competitor_only_answers", "competitors", "source_targets", "on_site_action", "citation_action", "retest_prompts", "retest_metric"],
    ...rows.map((row, index) => [
      index + 1,
      row.score,
      row.lane,
      row.title,
      row.url,
      row.category,
      row.blockers.join("; "),
      row.aiCitabilityScore,
      row.citationPriority,
      row.zeroMentionQueries,
      row.competitorOnlyAnswers,
      row.competitors.join("; "),
      row.sourceTargets.join("; "),
      row.onSiteAction,
      row.citationAction,
      row.retestPrompts.join("; "),
      row.retestMetric,
    ]),
  ]));
  await writeFile(path.join(outDir, "citation-outreach-ready-pages.csv"), csv([
    ["title", "url", "category", "ai_citability_score", "source_targets", "citation_action", "retest_metric"],
    ...readyRows.map((row) => [
      row.title,
      row.url,
      row.category,
      row.aiCitabilityScore,
      row.sourceTargets.join("; "),
      row.citationAction,
      row.retestMetric,
    ]),
  ]));
  await writeFile(path.join(outDir, "mention-first-citation-blockers.csv"), csv([
    ["title", "url", "category", "lane", "blockers", "zero_mention_queries", "competitor_only_answers", "competitors", "on_site_action", "retest_prompts"],
    ...mentionFirstRows.map((row) => [
      row.title,
      row.url,
      row.category,
      row.lane,
      row.blockers.join("; "),
      row.zeroMentionQueries,
      row.competitorOnlyAnswers,
      row.competitors.join("; "),
      row.onSiteAction,
      row.retestPrompts.join("; "),
    ]),
  ]));
  await writeFile(path.join(outDir, "category-citation-closure-rollup.csv"), csv([
    ["category", "pages", "ready", "source_cleanup_first", "mention_first", "canonical_first", "zero_mention_queries", "competitor_only_answers", "source_targets", "top_competitors", "pressure_score"],
    ...rollup.map((row) => [
      row.category,
      row.pages,
      row.ready,
      row.sourceCleanup,
      row.mentionFirst,
      row.canonicalFirst,
      row.zeroMention,
      row.competitorOnly,
      row.sourceTargets.join("; "),
      row.topCompetitors.join("; "),
      row.pressureScore,
    ]),
  ]));
  await writeFile(path.join(outDir, "source-target-opportunities.csv"), csv([
    ["category", "source_target", "page_count", "pages", "competitors", "zero_mention_queries", "competitor_only_answers", "score"],
    ...targets.map((row) => [
      row.category,
      row.sourceTarget,
      row.pageCount,
      row.pages.join("; "),
      row.competitors.join("; "),
      row.zeroMention,
      row.competitorOnly,
      row.score,
    ]),
  ]));

  console.log(`Wrote ${outDir}`);
  console.log(`Pages scored: ${rows.length}`);
  console.log(`Ready for outreach: ${readyRows.length}`);
  console.log(`Mention/canonical first: ${mentionFirstRows.length}`);
  console.log(`Source targets: ${targets.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
