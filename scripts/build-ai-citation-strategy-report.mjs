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

function pct(numerator, denominator) {
  return denominator ? Math.round((Number(numerator || 0) / denominator) * 100) : 0;
}

function csvCell(value) {
  if (Array.isArray(value)) value = value.join("; ");
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function csv(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
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
  const left = 420;
  const top = 108;
  const barW = width - left - 146;
  const max = maxValue || Math.max(1, ...rows.map((row) => Number(row.value || 0)));
  const body = rows.map((row, index) => {
    const y = top + index * rowH;
    const value = Number(row.value || 0);
    const w = Math.max(value > 0 ? 4 : 0, Math.round((value / max) * barW));
    const labels = wrapText(row.label, 47).map((line, lineIndex) =>
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

function funnelChart(stats) {
  const width = 1080;
  const height = 520;
  const x = 370;
  const maxW = 570;
  const steps = [
    ["AI answers tested", stats.total, stats.total, "#0f172a"],
    ["iBOLT mentioned", stats.mentionCount, stats.total, "#16a34a"],
    ["Non-branded iBOLT mentions", stats.nonBrandedMentionCount, stats.nonBranded, "#0891b2"],
    ["iBOLT top-3 recommendations", stats.topThreeCount, stats.total, "#f97316"],
    ["iboltmounts.com citations", stats.citationCount, stats.total, "#dc2626"],
  ];
  const max = stats.total || 1;
  const body = steps.map(([label, count, denominator, color], index) => {
    const y = 112 + index * 70;
    const w = Math.max(count ? 28 : 18, Math.round((count / max) * maxW));
    const textInside = w > 110;
    return `
      <text class="label" x="70" y="${y + 28}">${escapeHtml(label)}</text>
      <rect x="${x}" y="${y}" width="${w}" height="42" rx="12" fill="${count ? color : "#fee2e2"}" stroke="${count ? "none" : color}"/>
      <text class="${textInside ? "white" : "value"}" x="${textInside ? x + w / 2 : x + w + 14}" y="${y + 27}" text-anchor="${textInside ? "middle" : "start"}">${count} (${pct(count, denominator)}%)</text>
    `;
  }).join("\n");
  return svgShell(width, height, `
    <rect class="panel" x="34" y="24" width="${width - 68}" height="${height - 48}" rx="14"/>
    <text class="title" x="70" y="64">Visibility And Citation Funnel</text>
    <text class="subtitle" x="70" y="88">Citations are the smallest current layer, while generic recommendation visibility is the larger problem.</text>
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

function normalizeStats(mentionStats, evidenceStats, matrixStats) {
  return {
    total: evidenceStats.total ?? mentionStats.totalAnswers ?? matrixStats.total ?? 0,
    mentionCount: evidenceStats.mentionCount ?? mentionStats.mentions ?? matrixStats.mentions ?? 0,
    nonBranded: evidenceStats.nonBranded ?? mentionStats.nonBrandedAnswers ?? matrixStats.nonBranded ?? 0,
    nonBrandedMentionCount: evidenceStats.nonBrandedMentionCount ?? mentionStats.nonBrandedMentions ?? matrixStats.nonBrandedMentions ?? 0,
    topThreeCount: mentionStats.topThree ?? matrixStats.topThree ?? 0,
    citationCount: evidenceStats.citationCount ?? mentionStats.citations ?? matrixStats.citations ?? 0,
    sourceUrlRows: evidenceStats.sourceUrlRows ?? 0,
    competitorOnlyRows: evidenceStats.competitorOnlyRows ?? mentionStats.competitorOnlyAnswers ?? 0,
    coMentionRows: evidenceStats.coMentionRows ?? mentionStats.coMentionAnswers ?? 0,
    productSignalRows: evidenceStats.productSignalRows ?? 0,
    catalogProductRows: evidenceStats.catalogProductRows ?? 0,
  };
}

function makeCitationWorkstreams({ liveAudit, blogAudit, matrix, mention, evidence }) {
  const topCompetitors = (evidence.competitorCounts || []).slice(0, 8);
  const topQueries = (matrix.queryMatrix || []).slice(0, 10);
  const topRefreshes = (matrix.pageQueue || []).slice(0, 12);
  const topLiveGaps = [...(liveAudit.rows || [])]
    .filter((row) => row.status === "ok")
    .sort((a, b) => Number(a.aiCitabilityScore || 0) - Number(b.aiCitabilityScore || 0))
    .slice(0, 20);
  const topicRisks = (mention.topicRows || matrix.topicMatrix || []).slice(0, 10);
  const refreshBriefs = [];
  for (const row of topRefreshes) {
    refreshBriefs.push({
      priority: row.refreshPriority,
      title: row.title,
      url: row.url,
      category: row.category,
      pageScore: row.pageScore,
      prompts: row.prompts || [],
      competitors: row.competitors || [],
      fixes: row.issues || [],
    });
  }
  return {
    workstreams: [
      {
        owner: "Jacob/app",
        priority: 1,
        workstream: "Raise non-branded recommendation rate",
        why: `${topQueries.filter((row) => Number(row.mentionRate || 0) === 0).length} of the top ${topQueries.length} gap queries have zero iBOLT mention rate.`,
        action: "Refresh the mapped pages with query-exact answer blocks, explicit recommended iBOLT products, and competitor tradeoff sections.",
        successMetric: "Non-branded iBOLT mention rate moves from 5% to 15%+ on the next comparable benchmark.",
      },
      {
        owner: "Jacob/app",
        priority: 2,
        workstream: "Make pages citable",
        why: `${liveAudit.summary.missingFaqSchema} audited blog pages are missing FAQ schema, ${liveAudit.summary.noQuickAnswer} are missing quick answers, and ${liveAudit.summary.noComparisonSignals} lack comparison signals.`,
        action: "Batch-add FAQPage schema, short answer blocks, Article/BlogPosting schema, descriptive image alt text, and cleaner answer-first sections.",
        successMetric: `Average live page citability score moves from ${liveAudit.summary.avgScore} to 82+.`,
      },
      {
        owner: "SEO contractor",
        priority: 3,
        workstream: "Earn external citations and mentions",
        why: `The benchmark saw ${evidence.stats.citationCount || 0} target-domain citations and ${evidence.stats.sourceUrlRows || 0} source-url rows, so on-site content is not being cited yet by the tested consumer models.`,
        action: "Pitch/list iBOLT on industry sites, comparison pages, buyer guides, fleet/warehouse/restaurant resources, and product-review articles that AI search systems may cite.",
        successMetric: "Target-domain citation rate reaches 3% to 5% first, then 10%+ in search-connected benchmarks.",
      },
      {
        owner: "Jacob/app + SEO contractor",
        priority: 4,
        workstream: "Displace RAM, Arkon, iOttie, ProClip, and marine defaults",
        why: `${topCompetitors.slice(0, 5).map((row) => `${row.name}: ${row.count}`).join("; ")} appearances in raw answer text.`,
        action: "Use fair comparison blocks on matching pages and have SEO contractor secure third-party mentions that compare iBOLT in those categories.",
        successMetric: "Competitor-only rows drop from 68 to below 50 on comparable prompts.",
      },
      {
        owner: "Jacob/app",
        priority: 5,
        workstream: "Fix product entity signals",
        why: `${blogAudit.summary.unlinkedProducts}/${blogAudit.summary.products} products are not linked from detected blog content. Actual catalog product aliases appeared in ${evidence.stats.catalogProductRows || 0}/${evidence.stats.total} answers, while strict stored product mentions were ${evidence.stats.storedProductRows}/93.`,
        action: "Use exact product titles in product modules, backfill product relationships, and rotate underlinked product families into relevant posts.",
        successMetric: "Manual product/family signal rows move from 30/93 to 45/93 and catalog product alias rows move from 8/93 to 20/93.",
      },
    ],
    topCompetitors,
    topQueries,
    topRefreshes: refreshBriefs,
    lowCitabilityPages: topLiveGaps,
    topicRisks,
  };
}

function buildMarkdown({ stats, liveAudit, blogAudit, actionPack, expandedPromptCount }) {
  const topCompetitors = actionPack.topCompetitors.slice(0, 8)
    .map((row) => `- ${row.name}: ${row.count} raw answer appearances`)
    .join("\n");
  const workstreams = actionPack.workstreams
    .map((row) => `| ${row.priority} | ${row.owner} | ${row.workstream} | ${row.action} | ${row.successMetric} |`)
    .join("\n");
  const topPages = actionPack.topRefreshes.slice(0, 10)
    .map((row) => `| ${row.priority ?? ""} | ${row.title} | ${row.category} | ${row.pageScore ?? "n/a"} | ${(row.fixes || []).slice(0, 4).join("; ")} |`)
    .join("\n");
  const topQueries = actionPack.topQueries.slice(0, 10)
    .map((row) => `| ${row.opportunityScore ?? ""} | ${row.prompt} | ${row.category} | ${row.averageScore ?? ""} | ${row.mentionRate ?? ""}% | ${(row.competitors || []).slice(0, 4).join("; ")} |`)
    .join("\n");

  return `# iBOLT AI Citation And Visibility Strategy

## Short Answer

Yes, citation rate is worth improving, but it should not be the only KPI. The current bigger problem is that iBOLT is often not recommended at all on generic buyer prompts. Citation work matters most for search-connected AI surfaces such as Perplexity, Google AI Overviews, Gemini with search, ChatGPT search, and shopping assistants. Normal consumer-model answers may not expose citations even when they use remembered brand knowledge.

## Current Scorecard

- AI answers tested: ${stats.total}
- iBOLT mentions: ${stats.mentionCount}/${stats.total} (${pct(stats.mentionCount, stats.total)}%)
- Non-branded iBOLT mentions: ${stats.nonBrandedMentionCount}/${stats.nonBranded} (${pct(stats.nonBrandedMentionCount, stats.nonBranded)}%)
- Top-3 recommendation rate: ${stats.topThreeCount}/${stats.total} (${pct(stats.topThreeCount, stats.total)}%)
- Target-domain citations: ${stats.citationCount}/${stats.total} (${pct(stats.citationCount, stats.total)}%)
- Rows with source URLs: ${stats.sourceUrlRows}
- Competitor-only rows: ${stats.competitorOnlyRows}
- Co-mention rows: ${stats.coMentionRows}
- Manual product/family signal rows: ${stats.productSignalRows}/${stats.total}
- Actual catalog product alias rows: ${stats.catalogProductRows}/${stats.total}

## Why Citation Rate Is Currently Low

- ${liveAudit.summary.missingFaqSchema} audited blog pages are missing FAQ schema.
- ${liveAudit.summary.noQuickAnswer} audited blog pages do not have a concise quick-answer block near the top.
- ${liveAudit.summary.noComparisonSignals} audited blog pages lack competitor/comparison signals.
- ${liveAudit.summary.missingArticleSchema} audited blog pages are missing Article schema.
- ${blogAudit.summary.unlinkedProducts}/${blogAudit.summary.products} catalog products are not linked from detected blog content.
- Actual catalog product aliases appear in only ${stats.catalogProductRows}/${stats.total} saved AI answers.
- ${blogAudit.summary.duplicatePairs} possible duplicate/cannibalized page pairs dilute clear canonical answers.

## Who iBOLT Is Mentioned Next To Or Replaced By

${topCompetitors}

## Workstreams

| Priority | Owner | Workstream | Action | Success metric |
| --- | --- | --- | --- | --- |
${workstreams}

## Highest Query Gaps

| Opportunity | Query | Category | Avg score | Mention rate | Competitors |
| --- | --- | --- | --- | --- | --- |
${topQueries}

## First Pages To Refresh

| Priority | Page | Category | Page score | Fixes |
| --- | --- | --- | --- | --- |
${topPages}

## What To Offload To SEO Contractor

- External citation growth: third-party comparison articles, industry buyer guides, partner/reseller pages, fleet/warehouse/restaurant resource mentions, and reputable backlinks.
- Traditional SEO reinforcement: backlinks to the refreshed solution pages, not only the homepage.
- Brand entity consistency: make sure external listings consistently use "iBOLT Mounts", iboltmounts.com, product categories, and specialty claims.
- Competitor-adjacent mentions: get iBOLT included on pages that already discuss RAM Mounts, Arkon, iOttie, ProClip, Humminbird, Garmin, Lowrance, and Mount-It.

## What To Keep In The App Workstream

- Benchmark prompts and reporting.
- Blog refreshes and new solution pages.
- Schema output, FAQ blocks, product modules, image alt text, internal links, and Shopify publishing.
- Product catalog cleanup and post-to-product mapping.
- Measuring before/after movement in mention rate, top-3 rate, citation rate, and competitor-only rows.

## Next Benchmark Gate

Run the expanded ${expandedPromptCount}-prompt benchmark after OPENROUTER_API_KEY is available in the local shell. The next run should compare the same providers plus search-connected models where available, and it should preserve raw answer text and source URLs.
`;
}

function buildHtml({ stats, liveAudit, blogAudit, actionPack }) {
  const cards = [
    ["AI answers", stats.total, "saved benchmark run"],
    ["Mention rate", `${pct(stats.mentionCount, stats.total)}%`, `${stats.mentionCount}/${stats.total} answers`],
    ["Non-branded mention", `${pct(stats.nonBrandedMentionCount, stats.nonBranded)}%`, `${stats.nonBrandedMentionCount}/${stats.nonBranded} answers`],
    ["Top-3 rate", `${pct(stats.topThreeCount, stats.total)}%`, `${stats.topThreeCount}/${stats.total} answers`],
    ["Citation rate", `${pct(stats.citationCount, stats.total)}%`, `${stats.citationCount}/${stats.total} answers`],
    ["Catalog product rows", `${stats.catalogProductRows}/${stats.total}`, "actual product alias matches"],
    ["Live page score", liveAudit.summary.avgScore, "average AI citability score"],
    ["Missing FAQ schema", liveAudit.summary.missingFaqSchema, "audited pages"],
    ["Unlinked products", `${blogAudit.summary.unlinkedProducts}/${blogAudit.summary.products}`, `${blogAudit.summary.unlinkedProductRate}% of catalog`],
  ].map(([label, value, note]) => `
    <div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div><div class="s">${escapeHtml(note)}</div></div>
  `).join("");

  const workstreamRows = actionPack.workstreams.map((row) => `
    <tr><td>${row.priority}</td><td>${escapeHtml(row.owner)}</td><td><b>${escapeHtml(row.workstream)}</b><br><span>${escapeHtml(row.why)}</span></td><td>${escapeHtml(row.action)}</td><td>${escapeHtml(row.successMetric)}</td></tr>
  `).join("");
  const competitorRows = actionPack.topCompetitors.slice(0, 12).map((row) => `
    <tr><td>${escapeHtml(row.name)}</td><td>${row.count}</td></tr>
  `).join("");
  const queryRows = actionPack.topQueries.slice(0, 12).map((row) => `
    <tr><td>${row.opportunityScore ?? ""}</td><td>${escapeHtml(row.prompt)}</td><td>${escapeHtml(row.category)}</td><td>${row.averageScore ?? ""}</td><td>${row.mentionRate ?? ""}%</td><td>${escapeHtml((row.competitors || []).slice(0, 4).join(", "))}</td></tr>
  `).join("");
  const pageRows = actionPack.topRefreshes.slice(0, 12).map((row) => `
    <tr><td>${row.priority ?? ""}</td><td><a href="${escapeHtml(row.url)}">${escapeHtml(row.title)}</a></td><td>${escapeHtml(row.category)}</td><td>${row.pageScore ?? "n/a"}</td><td>${escapeHtml((row.fixes || []).slice(0, 4).join(", "))}</td></tr>
  `).join("");

  return `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT AI Citation And Visibility Strategy</title>
  <style>
    body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,sans-serif;line-height:1.45}
    main{max-width:1180px;margin:0 auto;padding:36px 24px 60px}
    h1{font-size:36px;line-height:1.05;margin:0 0 10px}
    h2{font-size:24px;margin:34px 0 12px}
    p{max-width:920px;color:#334155}
    .hero{background:#fff;border:1px solid #d7dee8;border-radius:14px;padding:28px;margin-bottom:24px}
    .cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:20px 0}
    .card{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}
    .k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b}.v{font-size:30px;font-weight:800;margin-top:6px}.s{font-size:13px;color:#64748b}
    .callout{background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:18px;margin:18px 0;color:#7c2d12}
    img{width:100%;height:auto;border:1px solid #d7dee8;border-radius:12px;background:#fff;margin:10px 0 18px}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden;margin:12px 0 24px}
    th,td{font-size:13px;text-align:left;vertical-align:top;padding:11px 12px;border-bottom:1px solid #e5e7eb}
    th{background:#f1f5f9;color:#334155}
    td span{color:#64748b}
    a{color:#0f766e}
    @media(max-width:820px){.cards{grid-template-columns:repeat(2,minmax(0,1fr))}h1{font-size:30px}}
  </style>
</head><body><main>
  <section class="hero">
    <h1>iBOLT AI Citation And Visibility Strategy</h1>
    <p><b>Bottom line:</b> yes, citation rate should go up, but the immediate priority is broader non-branded recommendation visibility. The current run shows iBOLT is known when named, while generic buyer prompts still default to competitors.</p>
    <div class="cards">${cards}</div>
    <div class="callout">Citation rate is most important on search-connected AI surfaces. For normal consumer-model answers, we should also track mention rate, top-3 recommendation rate, product/family signal rate, and competitor-only rows.</div>
  </section>

  <h2>Graphs</h2>
  <img src="visibility-citation-funnel.png" alt="Visibility and citation funnel"/>
  <img src="citation-readiness-gaps.png" alt="Citation readiness gaps"/>
  <img src="competitor-pressure.png" alt="Competitors appearing in raw answer text"/>
  <img src="first-pages-to-refresh.png" alt="First pages to refresh"/>

  <h2>Workstreams</h2>
  <table><thead><tr><th>Priority</th><th>Owner</th><th>Workstream</th><th>Action</th><th>Success Metric</th></tr></thead><tbody>${workstreamRows}</tbody></table>

  <h2>Competitor Pressure</h2>
  <table><thead><tr><th>Brand</th><th>Raw Answer Appearances</th></tr></thead><tbody>${competitorRows}</tbody></table>

  <h2>Highest Query Gaps</h2>
  <table><thead><tr><th>Opportunity</th><th>Query</th><th>Category</th><th>Avg Score</th><th>Mention Rate</th><th>Competitors</th></tr></thead><tbody>${queryRows}</tbody></table>

  <h2>First Pages To Refresh</h2>
  <table><thead><tr><th>Priority</th><th>Page</th><th>Category</th><th>Page Score</th><th>Fixes</th></tr></thead><tbody>${pageRows}</tbody></table>
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const auditDir = await latestDir(AUDIT_PREFIX);
  const outDir = path.join(benchmarkDir, "citation-strategy");
  await mkdir(outDir, { recursive: true });

  const evidence = await readJson(path.join(benchmarkDir, "answer-evidence-pack", "answer-evidence-data.json"));
  const mention = await readJson(path.join(benchmarkDir, "mention-landscape", "mention-landscape-data.json"));
  const matrix = await readJson(path.join(benchmarkDir, "competitive-matrix", "competitive-matrix-data.json"));
  const roadmap = await readJson(path.join(benchmarkDir, "content-refresh-roadmap", "content-refresh-roadmap-data.json"));
  const blogAudit = await readJson(path.join(benchmarkDir, "blog-inventory-audit", "blog-inventory-audit-data.json"));
  const liveAudit = await readJson(path.join(auditDir, "live-blog-page-audit.merged.json"));
  const expandedPrompts = await readJson(path.join(benchmarkDir, "deep-dive", "expanded-benchmark-prompts.json")).catch(() => []);
  const expandedPromptCount = expandedPrompts.length || 0;

  const stats = normalizeStats(mention.stats || {}, evidence.stats || {}, matrix.stats || {});
  const actionPack = makeCitationWorkstreams({ liveAudit, blogAudit, matrix, mention, evidence });
  const payload = { benchmarkDir, auditDir, expandedPromptCount, stats, liveSummary: liveAudit.summary, blogSummary: blogAudit.summary, actionPack };

  await writeFile(path.join(outDir, "citation-strategy-data.json"), JSON.stringify(payload, null, 2));
  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown({ stats, liveAudit, blogAudit, actionPack, expandedPromptCount }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({ stats, liveAudit, blogAudit, actionPack }));

  await writeFile(path.join(outDir, "citation-workstreams.csv"), csv([
    ["priority", "owner", "workstream", "why", "action", "success_metric"],
    ...actionPack.workstreams.map((row) => [row.priority, row.owner, row.workstream, row.why, row.action, row.successMetric]),
  ]));
  await writeFile(path.join(outDir, "citation-page-refresh-queue.csv"), csv([
    ["priority", "title", "url", "category", "page_score", "prompts", "competitors", "fixes"],
    ...actionPack.topRefreshes.map((row) => [
      row.priority,
      row.title,
      row.url,
      row.category,
      row.pageScore,
      row.prompts,
      row.competitors,
      row.fixes,
    ]),
  ]));
  await writeFile(path.join(outDir, "citation-query-gaps.csv"), csv([
    ["opportunity", "query", "category", "avg_score", "mention_rate", "competitors", "recommended_action"],
    ...actionPack.topQueries.map((row) => [
      row.opportunityScore,
      row.prompt,
      row.category,
      row.averageScore,
      row.mentionRate,
      row.competitors,
      row.recommendedAction,
    ]),
  ]));
  await writeFile(path.join(outDir, "contractor-offload.csv"), csv([
    ["owner", "task", "details", "metric"],
    ["SEO contractor", "External citation growth", "Third-party comparison articles, industry buyer guides, partner/reseller pages, fleet/warehouse/restaurant resource mentions, and reputable backlinks.", "Target-domain citation rate"],
    ["SEO contractor", "Traditional SEO reinforcement", "Build backlinks to refreshed solution pages and category guides, not only the homepage.", "Ranking and referral authority for target pages"],
    ["SEO contractor", "Brand entity consistency", "Keep iBOLT Mounts, iboltmounts.com, specialty categories, and product names consistent across external listings.", "Entity consistency in AI answers"],
    ["SEO contractor", "Competitor-adjacent mentions", "Prioritize pages that already discuss RAM Mounts, Arkon, iOttie, ProClip, Humminbird, Garmin, Lowrance, Mount-It.", "Co-mention rate and competitor-only reduction"],
    ["Jacob/app", "On-site AI answer structure", "Quick answers, FAQ schema, comparison blocks, product modules, alt text, internal links, Shopify publishing.", "Mention rate, top-3 rate, citability score"],
    ["Jacob/app", "Benchmarking and reporting", "Run comparable prompt sets by provider and track raw answer text, source URLs, products, competitors, and recommendations.", "Trendable benchmark report"],
  ]));

  await writeSvgAndPng(outDir, "visibility-citation-funnel", funnelChart(stats));
  await writeSvgAndPng(outDir, "citation-readiness-gaps", barChart({
    title: "Citation Readiness Gaps On Live Blog Pages",
    subtitle: "The largest technical/content gaps that make pages less quotable by AI search systems.",
    color: "#dc2626",
    rows: [
      { label: "Missing FAQ schema", value: liveAudit.summary.missingFaqSchema, display: `${liveAudit.summary.missingFaqSchema} pages` },
      { label: "Missing quick answer", value: liveAudit.summary.noQuickAnswer, display: `${liveAudit.summary.noQuickAnswer} pages` },
      { label: "Missing comparison signals", value: liveAudit.summary.noComparisonSignals, display: `${liveAudit.summary.noComparisonSignals} pages` },
      { label: "Failed public/local audit fetch", value: liveAudit.summary.failed, display: `${liveAudit.summary.failed} pages` },
      { label: "Missing Article schema", value: liveAudit.summary.missingArticleSchema, display: `${liveAudit.summary.missingArticleSchema} pages` },
      { label: "Possible duplicate/cannibalized pairs", value: blogAudit.summary.duplicatePairs, display: `${blogAudit.summary.duplicatePairs} pairs` },
    ],
  }));
  await writeSvgAndPng(outDir, "competitor-pressure", barChart({
    title: "Competitor Pressure In AI Answers",
    subtitle: "Raw answer text counts across the saved benchmark run.",
    color: "#f97316",
    rows: actionPack.topCompetitors.slice(0, 12).map((row) => ({ label: row.name, value: row.count })),
  }));
  await writeSvgAndPng(outDir, "first-pages-to-refresh", barChart({
    title: "First Pages To Refresh",
    subtitle: "Priority combines benchmark gaps, competitor pressure, and page structure issues.",
    color: "#16a34a",
    rows: actionPack.topRefreshes.slice(0, 12).map((row) => ({
      label: row.title,
      value: row.priority,
      note: `${row.category} | score ${row.pageScore ?? "n/a"}`,
    })),
  }));

  console.log(`Wrote ${outDir}`);
  console.log(`Report: ${path.join(outDir, "REPORT.html")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
