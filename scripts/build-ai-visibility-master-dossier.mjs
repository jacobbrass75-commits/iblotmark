import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";
const AUDIT_PREFIX = "live-blog-ai-citability-merged-";

let sharpModulePromise = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function csvCell(value) {
  if (Array.isArray(value)) value = value.join("; ");
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function csv(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function pct(numerator, denominator) {
  return denominator ? Math.round((Number(numerator || 0) / Number(denominator || 1)) * 100) : 0;
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

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function rel(fromDir, toFile) {
  return path.relative(fromDir, toFile).replaceAll(path.sep, "/");
}

function top(values, count = 10) {
  return (values || []).slice(0, count);
}

function firstNonEmpty(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "") ?? "";
}

function svgShell(width, height, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
  <style>
    .bg{fill:#f8fafc}.panel{fill:#fff;stroke:#d7dee8;stroke-width:1}.title{font:700 24px Arial,sans-serif;fill:#111827}.subtitle{font:400 14px Arial,sans-serif;fill:#64748b}.label{font:700 13px Arial,sans-serif;fill:#111827}.small{font:400 12px Arial,sans-serif;fill:#475569}.value{font:700 13px Arial,sans-serif;fill:#0f172a}.white{font:700 13px Arial,sans-serif;fill:#fff}
  </style>
  <rect class="bg" width="${width}" height="${height}"/>
  ${body}
</svg>`;
}

function wrapText(value, maxChars) {
  const words = String(value ?? "").replace(/\s+/g, " ").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function barChart({ title, subtitle, rows, color = "#2563eb", maxValue }) {
  const width = 1160;
  const rowH = 48;
  const height = 128 + rows.length * rowH + 34;
  const left = 430;
  const topY = 108;
  const barW = width - left - 150;
  const max = maxValue || Math.max(1, ...rows.map((row) => Number(row.value || 0)));
  const body = rows.map((row, index) => {
    const y = topY + index * rowH;
    const value = Number(row.value || 0);
    const w = Math.max(value > 0 ? 4 : 0, Math.round((value / max) * barW));
    const labels = wrapText(row.label, 48).map((line, lineIndex) =>
      `<text class="${lineIndex === 0 ? "label" : "small"}" x="54" y="${y + 14 + lineIndex * 15}">${escapeHtml(line)}</text>`,
    ).join("\n");
    return `
      ${labels}
      <rect x="${left}" y="${y}" width="${barW}" height="24" rx="8" fill="#e2e8f0"/>
      <rect x="${left}" y="${y}" width="${w}" height="24" rx="8" fill="${color}"/>
      <text class="value" x="${left + barW + 14}" y="${y + 17}">${escapeHtml(row.display ?? value)}</text>
      <text class="small" x="${left}" y="${y + 42}">${escapeHtml(row.note || "")}</text>
    `;
  }).join("\n");
  return svgShell(width, height, `
    <rect class="panel" x="28" y="24" width="${width - 56}" height="${height - 48}" rx="14"/>
    <text class="title" x="54" y="64">${escapeHtml(title)}</text>
    <text class="subtitle" x="54" y="88">${escapeHtml(subtitle)}</text>
    ${body}
  `);
}

async function writeSvgAndPng(outDir, filename, svg) {
  await writeFile(path.join(outDir, `${filename}.svg`), svg);
  try {
    sharpModulePromise ||= import("sharp");
    const sharp = (await sharpModulePromise).default;
    await sharp(Buffer.from(svg)).png().toFile(path.join(outDir, `${filename}.png`));
  } catch (error) {
    console.warn(`Could not render ${filename}.png: ${error.message}`);
  }
}

function makeRequirementRows({ benchmarkDir, auditDir, evidence, mention, matrix, roadmap, blogAudit, liveAudit, expandedPromptCount }) {
  return [
    {
      requirement: "How iBOLT is getting mentioned",
      status: "Covered",
      evidence: `${evidence.stats.mentionCount}/${evidence.stats.total} total mentions, ${evidence.stats.nonBrandedMentionCount}/${evidence.stats.nonBranded} non-branded mentions, ${evidence.stats.productSignalRows}/${evidence.stats.total} product/family signals, and ${evidence.stats.catalogProductRows || 0}/${evidence.stats.total} actual catalog product alias rows.`,
      strongestFiles: [
        path.join(benchmarkDir, "answer-evidence-pack", "answer-evidence.csv"),
        path.join(benchmarkDir, "answer-evidence-pack", "competitor-context-excerpts.csv"),
        path.join(benchmarkDir, "answer-evidence-pack", "answers"),
      ],
      nextAction: "Use answer excerpts to preserve the phrases AI already associates with iBOLT, then strengthen missing product names.",
    },
    {
      requirement: "Who iBOLT is mentioned next to",
      status: "Covered",
      evidence: `Co-mention and raw answer text show RAM Mounts, Arkon, iOttie, CTA Digital, ProClip, Humminbird, Mount-It, and Scosche as the main neighboring/default brands.`,
      strongestFiles: [
        path.join(benchmarkDir, "mention-landscape", "competitor-co-mentions.csv"),
        path.join(benchmarkDir, "answer-evidence-pack", "competitor-context-excerpts.csv"),
        path.join(benchmarkDir, "answer-evidence-pack", "raw-competitor-counts.png"),
      ],
      nextAction: "Use competitor-adjacent comparison blocks and external mentions to make iBOLT appear in the same consideration sets.",
    },
    {
      requirement: "How iBOLT compares to competitors",
      status: "Covered",
      evidence: `${top(matrix.battlecards, 6).map((row) => `${row.brand}: ${row.withoutIbolt} without iBOLT`).join("; ")}.`,
      strongestFiles: [
        path.join(benchmarkDir, "competitive-matrix", "competitor-battlecards.csv"),
        path.join(benchmarkDir, "competitive-matrix", "query-opportunity-matrix.csv"),
        path.join(benchmarkDir, "competitive-matrix", "REPORT.html"),
      ],
      nextAction: "Refresh pages with fair tradeoff language around specialist modular systems, secure mounts, and commercial use cases.",
    },
    {
      requirement: "Test more areas",
      status: "Partially covered, credential-limited",
      evidence: `Current completed run covers ${mention.stats.totalAnswers} answers across ${mention.promptGrid.length} query groups and ${mention.providerCategoryRows.length} provider/category slices. Expanded ${expandedPromptCount}-prompt backlog exists but local shell lacks OPENROUTER_API_KEY.`,
      strongestFiles: [
        path.join(benchmarkDir, "deep-dive", "expanded-benchmark-prompts.csv"),
        path.join(benchmarkDir, "mention-landscape", "provider-category-scorecard.csv"),
        path.join(benchmarkDir, "results.csv"),
      ],
      nextAction: "Set OPENROUTER_API_KEY in the local shell and run the expanded one-at-a-time benchmark.",
    },
    {
      requirement: "Look at all blog posts and dig in",
      status: "Covered",
      evidence: `${blogAudit.summary.localPosts} local posts, ${blogAudit.summary.shopifySynced} Shopify-synced posts, ${liveAudit.summary.ok}/${liveAudit.summary.total} live sitemap pages successfully audited, ${liveAudit.summary.failed} unavailable after merged crawls, and ${roadmap.allPostMap.length} all-post action rows audited.`,
      strongestFiles: [
        path.join(benchmarkDir, "blog-inventory-audit", "post-inventory.csv"),
        path.join(benchmarkDir, "content-refresh-roadmap", "all-blog-post-action-map.csv"),
        path.join(auditDir, "live-blog-page-audit.merged.csv"),
      ],
      nextAction: "Execute the page refresh queue, duplicate consolidation plan, and product-linking plan in priority order.",
    },
    {
      requirement: "Decide whether citation rate matters",
      status: "Covered",
      evidence: `${evidence.stats.citationCount}/${evidence.stats.total} target-domain citations and ${evidence.stats.sourceUrlRows} rows with source URLs. Citation work is necessary for search-connected AI surfaces, while mention/recommendation rate is the first bottleneck.`,
      strongestFiles: [
        path.join(benchmarkDir, "citation-strategy", "REPORT.html"),
        path.join(benchmarkDir, "citation-strategy", "contractor-offload.csv"),
        path.join(benchmarkDir, "answer-evidence-pack", "citation-url-audit.csv"),
      ],
      nextAction: "Offload external citation growth to the SEO contractor while the app handles schema/content refreshes.",
    },
  ].map((row) => ({
    ...row,
    strongestFiles: row.strongestFiles.map((filePath) => filePath.startsWith(process.cwd()) ? filePath : path.resolve(filePath)),
  }));
}

function makeMasterActions({ citation, roadmap, mention, matrix, liveAudit }) {
  const actions = [];
  let priority = 1;
  for (const row of citation.actionPack.workstreams || []) {
    actions.push({
      priority: priority++,
      owner: row.owner,
      action: row.workstream,
      evidence: row.why,
      metric: row.successMetric,
      source: "citation-strategy",
    });
  }
  for (const row of top(roadmap.refreshBriefs, 10)) {
    actions.push({
      priority: priority++,
      owner: "Jacob/app",
      action: `Refresh page: ${row.pageTitle}`,
      evidence: `${row.prompts.join("; ")} | issues: ${row.issues.join("; ")}`,
      metric: `Improve page citability score from ${row.aiCitabilityScore} and benchmark avg score from ${row.benchmarkAvgScore}.`,
      source: "content-refresh-roadmap",
    });
  }
  for (const row of top(mention.lostRows, 10)) {
    actions.push({
      priority: priority++,
      owner: "Jacob/app",
      action: `Fix lost answer: ${row.query}`,
      evidence: `${row.provider} did not surface iBOLT; competitors: ${row.competitors.join("; ")}`,
      metric: "Move prompt from zero mention to at least co-mention/top-3 consideration.",
      source: "mention-landscape",
    });
  }
  for (const row of top(matrix.battlecards, 8)) {
    actions.push({
      priority: priority++,
      owner: "Jacob/app + SEO contractor",
      action: `Displace/co-mention against ${row.brand}`,
      evidence: `${row.answerCount} answers, ${row.withoutIbolt} without iBOLT, ${row.withIbolt} with iBOLT.`,
      metric: `Reduce ${row.brand} without-iBOLT appearances and increase co-mention rate above ${row.coMentionRate}%.`,
      source: "competitive-matrix",
    });
  }
  for (const row of top(liveAudit.summary.lowest, 8)) {
    actions.push({
      priority: priority++,
      owner: "Jacob/app",
      action: `Repair low citability page: ${row.title}`,
      evidence: `Score ${row.aiCitabilityScore}, category ${row.category}.`,
      metric: "Bring page citability score above 80.",
      source: "live-citability-audit",
    });
  }
  return actions;
}

function makeExecutiveScorecard({ evidence, mention, blogAudit, liveAudit }) {
  return [
    ["AI answers tested", evidence.stats.total, "Saved benchmark run"],
    ["iBOLT mention rate", `${evidence.stats.mentionCount}/${evidence.stats.total} (${pct(evidence.stats.mentionCount, evidence.stats.total)}%)`, "All prompts"],
    ["Non-branded mention rate", `${evidence.stats.nonBrandedMentionCount}/${evidence.stats.nonBranded} (${pct(evidence.stats.nonBrandedMentionCount, evidence.stats.nonBranded)}%)`, "Generic buyer prompts"],
    ["Top-3 recommendation rate", `${mention.stats.topThree}/${mention.stats.totalAnswers} (${pct(mention.stats.topThree, mention.stats.totalAnswers)}%)`, "Recommendation quality"],
    ["Target-domain citation rate", `${evidence.stats.citationCount}/${evidence.stats.total} (${pct(evidence.stats.citationCount, evidence.stats.total)}%)`, "Citation quality"],
    ["Competitor-only rows", evidence.stats.competitorOnlyRows, "Answers that mention competitors without iBOLT"],
    ["Co-mention rows", evidence.stats.coMentionRows, "Answers where iBOLT appears alongside competitors"],
    ["Product/family signal rows", `${evidence.stats.productSignalRows}/${evidence.stats.total}`, "TabDock, BizMount, AMPS, xProDock, etc."],
    ["Catalog product alias rows", `${evidence.stats.catalogProductRows || 0}/${evidence.stats.total}`, "Actual local product title/handle/SKU aliases"],
    ["Blog posts analyzed", blogAudit.summary.localPosts, "Local published posts"],
    ["Shopify-synced posts", blogAudit.summary.shopifySynced, "Local synced count"],
    ["Live sitemap pages audited", `${liveAudit.summary.ok}/${liveAudit.summary.total}`, `${liveAudit.summary.failed} unavailable after merged crawls`],
    ["Average page citability score", liveAudit.summary.avgScore, "Out of 100"],
    ["Catalog products linked", `${blogAudit.summary.linkedProducts}/${blogAudit.summary.products}`, `${blogAudit.summary.unlinkedProductRate}% unlinked`],
    ["Duplicate/cannibalized pairs", blogAudit.summary.duplicatePairs, "Potential canonical cleanup"],
  ];
}

function buildMarkdown({ scorecard, requirementRows, masterActions, evidence, mention, matrix, roadmap, blogAudit, liveAudit, benchmarkDir, auditDir, expandedPromptCount }) {
  const scoreRows = scorecard.map(([metric, value, note]) => `| ${metric} | ${value} | ${note} |`).join("\n");
  const reqRows = requirementRows.map((row) => `| ${row.requirement} | ${row.status} | ${row.evidence} | ${row.nextAction} |`).join("\n");
  const actionRows = top(masterActions, 25).map((row) => `| ${row.priority} | ${row.owner} | ${row.action} | ${row.metric} | ${row.source} |`).join("\n");
  const competitorRows = top(evidence.competitorCounts, 12).map((row) => `| ${row.name} | ${row.count} |`).join("\n");
  const productRows = top(evidence.productCounts, 10).map((row) => `| ${row.name} | ${row.count} |`).join("\n");
  const catalogProductRows = top(evidence.catalogProductCounts, 10).map((row) => `| ${row.name} | ${row.count} |`).join("\n");
  const topicRows = top(roadmap.verticalRows, 12).map((row) => `| ${row.topic} | ${row.priority} | ${firstNonEmpty(row.benchmarkRisk, "n/a")} | ${firstNonEmpty(row.localPosts, "n/a")} | ${firstNonEmpty(row.unlinkedProducts, "n/a")} | ${row.recommendation} |`).join("\n");
  const refreshRows = top(roadmap.refreshBriefs, 12).map((row) => `| ${row.priority} | ${row.pageTitle} | ${row.category} | ${row.issues.join("; ")} | ${row.productsToAdd.slice(0, 4).join("; ")} |`).join("\n");

  return `# iBOLT AI Visibility Master Dossier

## What This Proves

This combines the saved benchmark answers, raw answer text, competitor co-mentions, live blog page audit, product spread audit, and all-post refresh roadmap into one evidence package. It answers the core questions: how iBOLT is mentioned, who appears next to or instead of iBOLT, how competitors compare, which additional areas need testing, and what every blog post/page needs next.

## Executive Scorecard

| Metric | Value | Note |
| --- | --- | --- |
${scoreRows}

## Requirement Coverage

| Requirement | Status | Evidence | Next action |
| --- | --- | --- | --- |
${reqRows}

## How iBOLT Is Mentioned

- Positioning signals: ${evidence.positioningCounts.map((row) => `${row.name} ${row.count}`).join(", ")}.
- Product/category signals: ${evidence.productCounts.map((row) => `${row.name} ${row.count}`).join(", ")}.
- Actual catalog product matches: ${(evidence.catalogProductCounts || []).map((row) => `${row.name} ${row.count}`).join(", ") || "none"}.
- The answers mostly frame the category around durability, security, modularity, value, and specialization. That is useful because iBOLT should lean into specialist/commercial positioning, not a cheaper-alternative frame.

## Who iBOLT Is Mentioned Next To Or Replaced By

| Competitor | Raw answer appearances |
| --- | --- |
${competitorRows}

## Product And Category Signals

| Signal | Raw answer appearances |
| --- | --- |
${productRows}

## Actual Catalog Product Alias Matches

| Catalog product | Raw answer appearances |
| --- | --- |
${catalogProductRows || "| None detected | 0 |"}

## Where The Site Is Weak For Citations

- Missing FAQ schema: ${liveAudit.summary.missingFaqSchema} pages.
- Missing quick-answer blocks: ${liveAudit.summary.noQuickAnswer} pages.
- Missing comparison signals: ${liveAudit.summary.noComparisonSignals} pages.
- Missing Article schema: ${liveAudit.summary.missingArticleSchema} pages.
- Possible duplicate/cannibalized pairs: ${blogAudit.summary.duplicatePairs}.
- Unlinked catalog products: ${blogAudit.summary.unlinkedProducts}/${blogAudit.summary.products}.

## Master Action Queue

| Priority | Owner | Action | Metric | Source |
| --- | --- | --- | --- | --- |
${actionRows}

## Vertical/Product Expansion

| Topic | Priority | Benchmark risk | Local posts | Unlinked products | Recommendation |
| --- | --- | --- | --- | --- | --- |
${topicRows}

## First Page Refreshes

| Priority | Page | Category | Fixes | Products to add |
| --- | --- | --- | --- | --- |
${refreshRows}

## Critical Files

- Master dossier folder: ${path.join(benchmarkDir, "master-dossier")}
- Raw answer evidence: ${path.join(benchmarkDir, "answer-evidence-pack", "REPORT.html")}
- Mention landscape: ${path.join(benchmarkDir, "mention-landscape", "REPORT.html")}
- Competitive matrix: ${path.join(benchmarkDir, "competitive-matrix", "REPORT.html")}
- Blog inventory audit: ${path.join(benchmarkDir, "blog-inventory-audit", "REPORT.html")}
- Content refresh roadmap: ${path.join(benchmarkDir, "content-refresh-roadmap", "REPORT.html")}
- Citation strategy: ${path.join(benchmarkDir, "citation-strategy", "REPORT.html")}
- Live citability audit: ${path.join(auditDir, "REPORT.html")}

## Remaining Limitation

The expanded ${expandedPromptCount}-prompt benchmark is ready as a prompt backlog, but the current local shell does not expose OPENROUTER_API_KEY. Until that key is set in the local environment, this dossier is based on the completed saved 93-answer benchmark plus the full blog/page audits.
`;
}

function tableRows(rows, columns) {
  return rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(typeof column === "function" ? column(row) : row[column])}</td>`).join("")}</tr>`).join("");
}

function buildHtml({ scorecard, requirementRows, masterActions, evidence, roadmap, liveAudit, blogAudit, benchmarkDir, auditDir, outDir, expandedPromptCount }) {
  const cards = scorecard.slice(0, 8).map(([metric, value, note]) => `
    <div class="card"><div class="k">${escapeHtml(metric)}</div><div class="v">${escapeHtml(value)}</div><div class="s">${escapeHtml(note)}</div></div>
  `).join("");
  const reqRows = requirementRows.map((row) => `
    <tr><td><b>${escapeHtml(row.requirement)}</b></td><td>${escapeHtml(row.status)}</td><td>${escapeHtml(row.evidence)}</td><td>${escapeHtml(row.nextAction)}</td></tr>
  `).join("");
  const actionRows = top(masterActions, 25).map((row) => `
    <tr><td>${row.priority}</td><td>${escapeHtml(row.owner)}</td><td><b>${escapeHtml(row.action)}</b><br><span>${escapeHtml(row.evidence)}</span></td><td>${escapeHtml(row.metric)}</td><td>${escapeHtml(row.source)}</td></tr>
  `).join("");
  const refreshRows = top(roadmap.refreshBriefs, 12).map((row) => `
    <tr><td>${row.priority}</td><td><a href="${escapeHtml(row.pageUrl)}">${escapeHtml(row.pageTitle)}</a></td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.issues.join(", "))}</td><td>${escapeHtml(row.productsToAdd.slice(0, 4).join(", "))}</td></tr>
  `).join("");
  const criticalLinks = [
    ["Raw answer evidence", path.join(benchmarkDir, "answer-evidence-pack", "REPORT.html")],
    ["Mention landscape", path.join(benchmarkDir, "mention-landscape", "REPORT.html")],
    ["Competitive matrix", path.join(benchmarkDir, "competitive-matrix", "REPORT.html")],
    ["Blog inventory audit", path.join(benchmarkDir, "blog-inventory-audit", "REPORT.html")],
    ["Content refresh roadmap", path.join(benchmarkDir, "content-refresh-roadmap", "REPORT.html")],
    ["Citation strategy", path.join(benchmarkDir, "citation-strategy", "REPORT.html")],
    ["Live citability audit", path.join(auditDir, "REPORT.html")],
  ].map(([label, filePath]) => `<li><a href="${escapeHtml(rel(outDir, filePath))}">${escapeHtml(label)}</a></li>`).join("");

  return `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT AI Visibility Master Dossier</title>
  <style>
    body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,sans-serif;line-height:1.45}
    main{max-width:1220px;margin:0 auto;padding:36px 24px 60px}
    h1{font-size:38px;line-height:1.05;margin:0 0 10px}
    h2{font-size:24px;margin:34px 0 12px}
    p{max-width:940px;color:#334155}
    .hero{background:#fff;border:1px solid #d7dee8;border-radius:14px;padding:28px;margin-bottom:24px}
    .cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:20px 0}
    .card{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}
    .k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b}.v{font-size:28px;font-weight:800;margin-top:6px}.s{font-size:13px;color:#64748b}
    .callout{background:#ecfeff;border:1px solid #a5f3fc;border-radius:12px;padding:18px;margin:18px 0;color:#164e63}
    img{width:100%;height:auto;border:1px solid #d7dee8;border-radius:12px;background:#fff;margin:10px 0 18px}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden;margin:12px 0 24px}
    th,td{font-size:13px;text-align:left;vertical-align:top;padding:11px 12px;border-bottom:1px solid #e5e7eb}
    th{background:#f1f5f9;color:#334155}
    td span{color:#64748b}
    a{color:#0f766e}
    ul{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:18px 24px}
    @media(max-width:860px){.cards{grid-template-columns:repeat(2,minmax(0,1fr))}h1{font-size:30px}}
  </style>
</head><body><main>
  <section class="hero">
    <h1>iBOLT AI Visibility Master Dossier</h1>
    <p>This is the consolidated package for AI visibility, competitor displacement, citations, and blog/post readiness. It combines raw answer text, competitor co-mentions, benchmark gaps, live page citability, product spread, and all-post refresh priorities.</p>
    <div class="cards">${cards}</div>
    <div class="callout">Main read: iBOLT is visible when named, but generic buyer prompts still default to competitors. The path is page refreshes plus external citation growth, then an expanded benchmark rerun.</div>
  </section>

  <h2>Master Dashboard</h2>
  <img src="master-scorecard.png" alt="Master AI visibility scorecard"/>
  <img src="requirement-coverage.png" alt="Requirement coverage"/>
  <img src="top-workstreams.png" alt="Top workstreams"/>

  <h2>Requirement Coverage</h2>
  <table><thead><tr><th>Requirement</th><th>Status</th><th>Evidence</th><th>Next Action</th></tr></thead><tbody>${reqRows}</tbody></table>

  <h2>Competitors And Product Signals</h2>
  <table><thead><tr><th>Competitor</th><th>Raw Answer Appearances</th></tr></thead><tbody>${tableRows(top(evidence.competitorCounts, 12), ["name", "count"])}</tbody></table>
  <table><thead><tr><th>Product/Category Signal</th><th>Raw Answer Appearances</th></tr></thead><tbody>${tableRows(top(evidence.productCounts, 10), ["name", "count"])}</tbody></table>
  <table><thead><tr><th>Actual Catalog Product Alias</th><th>Raw Answer Appearances</th></tr></thead><tbody>${tableRows(top(evidence.catalogProductCounts || [], 10), ["name", "count"]) || "<tr><td>None detected</td><td>0</td></tr>"}</tbody></table>

  <h2>Master Action Queue</h2>
  <table><thead><tr><th>Priority</th><th>Owner</th><th>Action</th><th>Metric</th><th>Source</th></tr></thead><tbody>${actionRows}</tbody></table>

  <h2>First Page Refreshes</h2>
  <table><thead><tr><th>Priority</th><th>Page</th><th>Category</th><th>Fixes</th><th>Products To Add</th></tr></thead><tbody>${refreshRows}</tbody></table>

  <h2>Critical Links</h2>
  <ul>${criticalLinks}</ul>

  <p><b>Remaining limitation:</b> the expanded ${expandedPromptCount}-prompt benchmark is ready, but the local shell does not expose OPENROUTER_API_KEY.</p>
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const auditDir = await latestDir(AUDIT_PREFIX);
  const outDir = path.join(benchmarkDir, "master-dossier");
  await mkdir(outDir, { recursive: true });

  const evidence = await readJson(path.join(benchmarkDir, "answer-evidence-pack", "answer-evidence-data.json"));
  const mention = await readJson(path.join(benchmarkDir, "mention-landscape", "mention-landscape-data.json"));
  const matrix = await readJson(path.join(benchmarkDir, "competitive-matrix", "competitive-matrix-data.json"));
  const roadmap = await readJson(path.join(benchmarkDir, "content-refresh-roadmap", "content-refresh-roadmap-data.json"));
  const blogAudit = await readJson(path.join(benchmarkDir, "blog-inventory-audit", "blog-inventory-audit-data.json"));
  const liveAudit = await readJson(path.join(auditDir, "live-blog-page-audit.merged.json"));
  const citation = await readJson(path.join(benchmarkDir, "citation-strategy", "citation-strategy-data.json"));
  const expandedPrompts = await readJson(path.join(benchmarkDir, "deep-dive", "expanded-benchmark-prompts.json")).catch(() => []);
  const expandedPromptCount = expandedPrompts.length || 0;

  const requirementRows = makeRequirementRows({ benchmarkDir, auditDir, evidence, mention, matrix, roadmap, blogAudit, liveAudit, expandedPromptCount });
  const masterActions = makeMasterActions({ citation, roadmap, mention, matrix, liveAudit });
  const scorecard = makeExecutiveScorecard({ evidence, mention, blogAudit, liveAudit });
  const payload = { benchmarkDir, auditDir, expandedPromptCount, scorecard, requirementRows, masterActions, evidenceSummary: evidence.stats, mentionSummary: mention.stats, blogSummary: blogAudit.summary, liveSummary: liveAudit.summary };

  await writeFile(path.join(outDir, "master-dossier-data.json"), JSON.stringify(payload, null, 2));
  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown({ scorecard, requirementRows, masterActions, evidence, mention, matrix, roadmap, blogAudit, liveAudit, benchmarkDir, auditDir, expandedPromptCount }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({ scorecard, requirementRows, masterActions, evidence, roadmap, liveAudit, blogAudit, benchmarkDir, auditDir, outDir, expandedPromptCount }));
  await writeFile(path.join(outDir, "requirement-evidence-map.csv"), csv([
    ["requirement", "status", "evidence", "strongest_files", "next_action"],
    ...requirementRows.map((row) => [row.requirement, row.status, row.evidence, row.strongestFiles, row.nextAction]),
  ]));
  await writeFile(path.join(outDir, "master-action-queue.csv"), csv([
    ["priority", "owner", "action", "evidence", "metric", "source"],
    ...masterActions.map((row) => [row.priority, row.owner, row.action, row.evidence, row.metric, row.source]),
  ]));
  await writeFile(path.join(outDir, "executive-scorecard.csv"), csv([
    ["metric", "value", "note"],
    ...scorecard,
  ]));

  await writeSvgAndPng(outDir, "master-scorecard", barChart({
    title: "Master AI Visibility Scorecard",
    subtitle: "Current benchmark and content-readiness signals.",
    color: "#2563eb",
    rows: [
      { label: "iBOLT mentions", value: evidence.stats.mentionCount, display: `${evidence.stats.mentionCount}/${evidence.stats.total}` },
      { label: "Non-branded mentions", value: evidence.stats.nonBrandedMentionCount, display: `${evidence.stats.nonBrandedMentionCount}/${evidence.stats.nonBranded}` },
      { label: "Top-3 recommendations", value: mention.stats.topThree, display: `${mention.stats.topThree}/${mention.stats.totalAnswers}` },
      { label: "Target-domain citations", value: evidence.stats.citationCount, display: `${evidence.stats.citationCount}/${evidence.stats.total}` },
      { label: "Co-mention rows", value: evidence.stats.coMentionRows, display: String(evidence.stats.coMentionRows) },
      { label: "Product/family signal rows", value: evidence.stats.productSignalRows, display: `${evidence.stats.productSignalRows}/${evidence.stats.total}` },
      { label: "Catalog product alias rows", value: evidence.stats.catalogProductRows || 0, display: `${evidence.stats.catalogProductRows || 0}/${evidence.stats.total}` },
      { label: "Live audited pages", value: liveAudit.summary.ok, display: `${liveAudit.summary.ok}/${liveAudit.summary.total}` },
      { label: "Linked catalog products", value: blogAudit.summary.linkedProducts, display: `${blogAudit.summary.linkedProducts}/${blogAudit.summary.products}` },
    ],
    maxValue: Math.max(evidence.stats.total, liveAudit.summary.total, blogAudit.summary.products),
  }));
  await writeSvgAndPng(outDir, "requirement-coverage", barChart({
    title: "Requirement Coverage",
    subtitle: "How much of the requested analysis is currently proven by artifacts.",
    color: "#16a34a",
    rows: requirementRows.map((row) => ({
      label: row.requirement,
      value: row.status.startsWith("Covered") ? 100 : 65,
      display: row.status.startsWith("Partially") ? "Partial, key needed" : row.status,
    })),
    maxValue: 100,
  }));
  await writeSvgAndPng(outDir, "top-workstreams", barChart({
    title: "Top Workstreams",
    subtitle: "Highest leverage next moves from the consolidated action queue.",
    color: "#f97316",
    rows: top(masterActions, 12).map((row) => ({
      label: row.action,
      value: 100 - row.priority,
      display: `#${row.priority}`,
      note: row.owner,
    })),
    maxValue: 100,
  }));

  console.log(`Wrote ${outDir}`);
  console.log(`Report: ${path.join(outDir, "REPORT.html")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
