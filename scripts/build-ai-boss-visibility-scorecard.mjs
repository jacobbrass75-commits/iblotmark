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

async function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function parseRankedItem(item) {
  const text = String(item || "").trim();
  const colon = text.match(/^(.+?):\s*(\d+)/);
  if (colon) return { name: colon[1].trim(), value: Number(colon[2]) };
  const trailingNumber = text.match(/^(.+?)\s+(\d+)$/);
  if (trailingNumber) return { name: trailingNumber[1].trim(), value: Number(trailingNumber[2]) };
  return { name: text, value: 0 };
}

function barSvg({ title, subtitle, rows, unit = "", width = 920, height = 420, color = "#1d4ed8" }) {
  const margin = { top: 72, right: 36, bottom: 36, left: 260 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(...rows.map((row) => Number(row.value || 0)), 1);
  const rowHeight = chartHeight / Math.max(rows.length, 1);
  const bars = rows.map((row, index) => {
    const y = margin.top + index * rowHeight + 6;
    const barHeight = Math.max(12, rowHeight - 12);
    const barWidth = Math.round((Number(row.value || 0) / maxValue) * chartWidth);
    const label = escapeHtml(row.name);
    const value = `${row.value}${unit}`;
    return `
      <text x="${margin.left - 14}" y="${y + barHeight / 2 + 5}" text-anchor="end" font-size="14" fill="#334155">${label}</text>
      <rect x="${margin.left}" y="${y}" width="${barWidth}" height="${barHeight}" rx="5" fill="${color}"></rect>
      <text x="${margin.left + barWidth + 10}" y="${y + barHeight / 2 + 5}" font-size="14" font-weight="700" fill="#0f172a">${escapeHtml(value)}</text>
    `;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <text x="28" y="34" font-size="24" font-weight="800" fill="#0f172a">${escapeHtml(title)}</text>
  <text x="28" y="58" font-size="14" fill="#64748b">${escapeHtml(subtitle)}</text>
  ${bars}
</svg>`;
}

function kpiSvg({ kpis, width = 920, height = 340 }) {
  const cardWidth = (width - 72) / kpis.length;
  const cards = kpis.map((kpi, index) => {
    const x = 24 + index * cardWidth;
    const target = Number(kpi.target || 0);
    const current = Number(kpi.current || 0);
    const pctWidth = Math.min(1, target ? current / target : 0) * (cardWidth - 42);
    const color = current >= target ? "#16a34a" : current >= target * 0.5 ? "#f59e0b" : "#dc2626";
    return `
      <rect x="${x}" y="86" width="${cardWidth - 12}" height="190" rx="14" fill="#ffffff" stroke="#d7dee8"/>
      <text x="${x + 20}" y="122" font-size="13" font-weight="800" fill="#64748b">${escapeHtml(kpi.label)}</text>
      <text x="${x + 20}" y="165" font-size="42" font-weight="900" fill="#0f172a">${current}%</text>
      <text x="${x + 22}" y="194" font-size="14" fill="#475569">Next target: ${target}%</text>
      <rect x="${x + 20}" y="224" width="${cardWidth - 42}" height="12" rx="6" fill="#e2e8f0"/>
      <rect x="${x + 20}" y="224" width="${pctWidth}" height="12" rx="6" fill="${color}"/>
      <text x="${x + 20}" y="255" font-size="12" fill="#64748b">${escapeHtml(kpi.note)}</text>
    `;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#f8fafc"/>
  <text x="24" y="36" font-size="26" font-weight="900" fill="#0f172a">AI Visibility KPI Scorecard</text>
  <text x="24" y="62" font-size="14" fill="#64748b">Current benchmark vs practical next targets. Targets are planning goals, not placement guarantees.</text>
  ${cards}
</svg>`;
}

function buildMarkdown({ summary, topCompetitors, topTopics, topPages, weakFamilies, actions }) {
  return `# iBOLT AI Visibility Executive Scorecard

## Current Read

iBOLT is visible, but not yet dominant in AI answers. The current benchmark shows a ${summary.mentionRate}% overall mention rate, ${summary.nonBrandedMentionRate}% non-branded mention rate, ${summary.topThreeRate}% top-3 recommendation rate, and ${summary.citationRate}% target-domain citation rate.

That means we should treat citation rate as a real KPI. Mentions show that models know iBOLT exists. Citations show whether AI search surfaces trust iboltmounts.com enough to use it as a source.

Use the citation priority model for the ranked page, topic, competitor, and platform sequence: ../citation-priority-model/REPORT.html
Use the citation and visibility executive brief for the boss-ready yes/no answer and ownership split: ../citation-visibility-executive-brief/REPORT.html
Use the next benchmark runbook for the exact W1-W5 provider retest manifests and commands: ../next-benchmark-runbook/REPORT.html
Use the post-run comparison analyzer after a live provider run to see KPI deltas: ../post-run-comparison/REPORT.html
Use the mention environment dossier to see who surrounds or replaces iBOLT in AI answers: ../mention-environment-dossier/REPORT.html
Use the competitor comparison dossier to see unique replacement rows, brand-level replacement occurrences, and page battlecards: ../competitor-comparison-dossier/REPORT.html
Use the portfolio product spread analysis to decide refresh vs new content and product-family coverage: ../portfolio-product-spread-analysis/REPORT.html

## KPI Targets

| KPI | Current | Next target | Why it matters |
| --- | ---: | ---: | --- |
${summary.kpis.map((kpi) => `| ${kpi.label} | ${kpi.current}% | ${kpi.target}% | ${kpi.reason} |`).join("\n")}

## Competitor Pressure

Top replacement competitors in AI answers:

${topCompetitors.map((row) => `- ${row.name}: ${row.value} lost or replacement rows`).join("\n")}

## Highest Opportunity Topics

${topTopics.map((row) => `- ${row.name}: ${row.value} priority points`).join("\n")}

## Pages To Work First

${topPages.map((row) => `- ${row}`).join("\n")}

## Weak Product-Family Coverage

${weakFamilies.map((row) => `- ${row.name}: ${row.value} gap score`).join("\n")}

## What To Offload

| Owner | Workstream | Why | Success metric |
| --- | --- | --- | --- |
${actions.map((row) => `| ${row.owner} | ${row.workstream} | ${row.why} | ${row.metric} |`).join("\n")}
`;
}

function buildHtml({ summary, topCompetitors, topTopics, topPages, weakFamilies, actions }) {
  const cards = [
    ["Mention rate", `${summary.mentionRate}%`, `${summary.mentionCount}/${summary.totalAnswers} total answers`],
    ["Non-branded mention", `${summary.nonBrandedMentionRate}%`, `${summary.nonBrandedMentionCount}/${summary.nonBrandedAnswers}`],
    ["Top-3 recommendation", `${summary.topThreeRate}%`, `${summary.topThreeCount}/${summary.totalAnswers}`],
    ["Citation rate", `${summary.citationRate}%`, `${summary.citationCount}/${summary.totalAnswers}`],
    ["Competitor-only", `${summary.competitorOnlyRate}%`, `${summary.competitorOnlyRows}/${summary.totalAnswers}`],
    ["Expanded test plan", summary.expandedPrompts, `${summary.providerRequests} provider requests`],
    ["Live pages audited", summary.livePages, `${summary.citationCleanupPages} citation cleanup`],
    ["High-gap categories", summary.highGapCategories, `${summary.weakFamilyCoverage} weak families`],
  ].map(([label, value, note]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");

  const actionRows = actions.map((row) => `<tr><td>${escapeHtml(row.owner)}</td><td>${escapeHtml(row.workstream)}</td><td>${escapeHtml(row.why)}</td><td>${escapeHtml(row.metric)}</td></tr>`).join("");
  const pageItems = topPages.map((page) => `<li>${escapeHtml(page)}</li>`).join("");
  const familyItems = weakFamilies.map((row) => `<li><strong>${escapeHtml(row.name)}</strong>, gap score ${escapeHtml(row.value)}</li>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT AI Visibility Executive Scorecard</title>
  <style>
    body{margin:0;background:#f8fafc;color:#0f172a;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1160px;margin:0 auto;padding:34px 24px 70px}
    a{color:#0f766e}
    h1{font-size:36px;margin:0 0 8px}
    h2{font-size:22px;margin:34px 0 12px}
    p,li{color:#334155;line-height:1.55}
    .lede{font-size:18px;max-width:920px}
    .cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:24px 0}
    .card{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:800}
    .value{font-size:32px;font-weight:900;margin-top:8px}
    .callout{background:#fff;border-left:6px solid #dc2626;border-top:1px solid #d7dee8;border-right:1px solid #d7dee8;border-bottom:1px solid #d7dee8;border-radius:12px;padding:16px 18px;margin:18px 0}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
    .panel{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:18px}
    img{max-width:100%;height:auto;background:#fff;border:1px solid #d7dee8;border-radius:12px;margin:12px 0}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden}
    th,td{text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid #edf2f7;font-size:14px}
    th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:12px;letter-spacing:.04em}
    @media(max-width:900px){.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.grid{grid-template-columns:1fr}}
  </style>
</head>
<body><main>
  <h1>iBOLT AI Visibility Executive Scorecard</h1>
  <p class="lede">iBOLT is showing up in AI answers, but the current problem is trust and dominance. AI models mention iBOLT in ${summary.mentionRate}% of tested answers, but cite iboltmounts.com in ${summary.citationRate}% of answers. The next work should push iBOLT from occasional mention to sourced recommendation.</p>
  <section class="cards">${cards}</section>
  <div class="callout"><strong>Recommendation:</strong> Yes, citation rate should become a tracked KPI. Mentions prove awareness. Citations prove AI systems are using iBOLT as a source, which is the path toward AI Overview, Perplexity, Gemini search, ChatGPT search, and voice-assistant visibility.</div>
  <div class="callout"><strong>Boss brief:</strong> <a href="../citation-visibility-executive-brief/REPORT.html">Open the citation and visibility executive brief</a> for the plain-English decision, page-before-outreach sequence, and Jacob/app versus SEO contractor split.</div>
  <div class="callout"><strong>Retest runbook:</strong> <a href="../next-benchmark-runbook/REPORT.html">Open the next benchmark runbook</a> for W1-W5 provider manifests, dry-run commands, live commands, and output checks.</div>
  <div class="callout"><strong>Post-run delta:</strong> <a href="../post-run-comparison/REPORT.html">Open the post-run comparison analyzer</a> after a live provider run to see whether mention, top-3, citation, competitor-only, and product-entity metrics improved.</div>
  <div class="callout"><strong>Ranked sequence:</strong> <a href="../citation-priority-model/REPORT.html">Open the citation priority model</a> to see which pages need mention recovery, source cleanup, product-name cleanup, or contractor citation outreach first.</div>
  <div class="callout"><strong>Mention environment:</strong> <a href="../mention-environment-dossier/REPORT.html">Open the mention environment dossier</a> to see who iBOLT appears beside, who replaces iBOLT, and which provider/category pockets need counter-positioning.</div>
  <div class="callout"><strong>Competitor comparison:</strong> <a href="../competitor-comparison-dossier/REPORT.html">Open the competitor comparison dossier</a> for replacement-row counts, co-mention opportunities, provider/category pressure, and exact page battlecards.</div>
  <div class="callout"><strong>Portfolio spread:</strong> <a href="../portfolio-product-spread-analysis/REPORT.html">Open the portfolio product spread analysis</a> to see which product families and page clusters need refresh, consolidation, or new canonical support.</div>

  <h2>Graphs</h2>
  <img src="visibility-kpis.svg" alt="AI visibility KPI scorecard"/>
  <div class="grid">
    <div><img src="competitor-pressure.svg" alt="Competitor pressure chart"/></div>
    <div><img src="topic-opportunity.svg" alt="Topic opportunity chart"/></div>
  </div>
  <img src="product-family-gaps.svg" alt="Product family coverage gaps"/>

  <h2>Pages To Work First</h2>
  <div class="panel"><ol>${pageItems}</ol></div>

  <h2>Weak Product-Family Coverage</h2>
  <div class="panel"><ul>${familyItems}</ul></div>

  <h2>Offload Plan</h2>
  <table><thead><tr><th>Owner</th><th>Workstream</th><th>Why</th><th>Success metric</th></tr></thead><tbody>${actionRows}</tbody></table>
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, "boss-visibility-scorecard");
  await mkdir(outDir, { recursive: true });

  const master = await readJsonIfExists(path.join(benchmarkDir, "master-dossier", "master-dossier-data.json"), { evidenceSummary: {}, mentionSummary: {} });
  const evidence = master.evidenceSummary || {};
  const mention = master.mentionSummary || {};
  const coMention = await readJsonIfExists(path.join(benchmarkDir, "co-mention-network", "co-mention-network-data.json"), { summary: {} });
  const coMentionSummary = coMention.summary || coMention;
  const citationReadiness = await readJsonIfExists(path.join(benchmarkDir, "citation-readiness-map", "citation-readiness-data.json"), { summary: {} });
  const citationSummary = citationReadiness.summary || {};
  const conversion = await readJsonIfExists(path.join(benchmarkDir, "blog-conversion-opportunity-map", "blog-conversion-opportunity-data.json"), { summary: {} });
  const conversionSummary = conversion.summary || {};
  const testCoverage = await readJsonIfExists(path.join(benchmarkDir, "test-area-coverage-audit", "test-area-coverage-data.json"), { summary: {} });
  const testSummary = testCoverage.summary || {};
  const allPosts = await readJsonIfExists(path.join(benchmarkDir, "all-blog-post-dossier", "all-blog-post-dossier-data.json"), { summary: {} });
  const allPostSummary = allPosts.summary || {};
  const messageGap = await readJsonIfExists(path.join(benchmarkDir, "message-gap-map", "message-gap-data.json"), { summary: {} });
  const messageSummary = messageGap.summary || {};
  const sourceAuthority = await readJsonIfExists(path.join(benchmarkDir, "source-authority-roadmap", "source-authority-data.json"), { summary: {} });
  const sourceSummary = sourceAuthority.summary || {};
  const productEntity = await readJsonIfExists(path.join(benchmarkDir, "product-entity-coverage-plan", "product-entity-data.json"), { summary: {} });
  const productSummary = productEntity.summary || {};

  const totalAnswers = evidence.total || coMentionSummary.totalAnswers || 93;
  const summary = {
    totalAnswers,
    mentionCount: evidence.mentionCount || coMentionSummary.mentionRows || 0,
    mentionRate: evidence.mentionRate || coMentionSummary.mentionRate || 0,
    nonBrandedAnswers: evidence.nonBranded || coMentionSummary.nonBrandedRows || 0,
    nonBrandedMentionCount: evidence.nonBrandedMentionCount || coMentionSummary.nonBrandedMentions || 0,
    nonBrandedMentionRate: evidence.nonBrandedMentionRate || coMentionSummary.nonBrandedMentionRate || 0,
    topThreeCount: mention.topThree || coMentionSummary.sourceMentionSummary?.topThree || 0,
    topThreeRate: pct(mention.topThree || coMentionSummary.sourceMentionSummary?.topThree || 0, totalAnswers),
    citationCount: evidence.citationCount || 0,
    citationRate: evidence.citationRate || 0,
    competitorOnlyRows: evidence.competitorOnlyRows || coMentionSummary.competitorOnlyRows || 0,
    competitorOnlyRate: pct(evidence.competitorOnlyRows || coMentionSummary.competitorOnlyRows || 0, totalAnswers),
    expandedPrompts: testSummary.expandedPrompts || 0,
    providerRequests: testSummary.providerRequests || 0,
    livePages: allPostSummary.pages || citationSummary.pagesScored || 0,
    citationCleanupPages: allPostSummary.citationCleanupPages || citationSummary.cleanupThenCitationPages || 0,
    highGapCategories: testSummary.highGapCategories || 0,
    weakFamilyCoverage: testSummary.weakFamilyCoverage || 0,
  };

  summary.kpis = [
    { label: "Mention rate", current: summary.mentionRate, target: 35, note: "Awareness", reason: "Shows whether models include iBOLT at all." },
    { label: "Non-branded mention", current: summary.nonBrandedMentionRate, target: 15, note: "Generic buyer prompts", reason: "This is where new customers ask for recommendations without naming iBOLT." },
    { label: "Top-3 recommendation", current: summary.topThreeRate, target: 25, note: "Recommendation strength", reason: "Moving from mentioned to recommended is the business goal." },
    { label: "Citation rate", current: summary.citationRate, target: 8, note: "Source trust", reason: "Citations show AI systems trust iboltmounts.com as a source." },
  ];

  const topCompetitors = (coMentionSummary.topReplacementCompetitors || []).slice(0, 8).map(parseRankedItem);
  const topTopics = (conversionSummary.topTopics || citationSummary.topCitationTopics || []).slice(0, 8).map(parseRankedItem);
  const topPages = (citationSummary.topCitationPages || conversionSummary.topPages || []).slice(0, 10);
  const weakFamilies = (testSummary.topWeakFamilies || []).slice(0, 8).map(parseRankedItem);
  const topMessageGaps = messageSummary.topThemeGaps || [];

  const actions = [
    {
      owner: "Jacob/app",
      workstream: "Add source-ready answer blocks and FAQ/schema to priority pages",
      why: `${citationSummary.cleanupThenCitationPages || summary.citationCleanupPages} pages need citation cleanup before search-connected retesting.`,
      metric: "Target-domain citation rate moves from 0% toward 5-8%.",
    },
    {
      owner: "Jacob/app",
      workstream: "Strengthen product entity modules",
      why: `${productSummary.workQueueRows || 0} product/entity work rows and ${productSummary.unlinkedProducts || 0} unlinked products create weak product recognition.`,
      metric: "Catalog product alias rows move from 8/93 to at least 20/93.",
    },
    {
      owner: "Jacob/app",
      workstream: "Add fair comparison blocks against RAM, Arkon, iOttie, ProClip, CTA Digital, and Mount-It",
      why: `AI currently replaces or co-mentions iBOLT with these brands. Top answer gaps are ${topMessageGaps.slice(0, 3).join(", ") || "rugged durability, install clarity, and stability"}.`,
      metric: "Competitor-only rows decrease and top-3 iBOLT recommendations increase.",
    },
    {
      owner: "SEO contractor",
      workstream: "Earn third-party citations and industry references",
      why: `${sourceSummary.competitorRows || 24} competitor-source rows show where AI already sees other brands as citeable.`,
      metric: "New external pages mention iBOLT next to target categories and competitor sets.",
    },
    {
      owner: "SEO contractor",
      workstream: "Support citation outreach for AMPS, fleet, restaurant, warehouse, fishing, and streaming topics",
      why: `Top citation topics are ${(citationSummary.topCitationTopics || []).slice(0, 5).join(", ") || "AMPS, fleet, restaurant, warehouse, and fishing"}.`,
      metric: "More third-party category pages include iBOLT and link to relevant solution/product pages.",
    },
    {
      owner: "Jacob/app",
      workstream: "Run expanded benchmark after page edits",
      why: `${summary.expandedPrompts} prompts and ${summary.providerRequests} provider requests are ready for the next measurement pass.`,
      metric: "Track mention, non-branded mention, top-3, citation, and competitor-only rates by provider.",
    },
  ];

  const data = { benchmarkDir, generatedAt: new Date().toISOString(), summary, topCompetitors, topTopics, topPages, weakFamilies, actions };

  await writeFile(path.join(outDir, "boss-scorecard-data.json"), JSON.stringify(data, null, 2));
  await writeFile(path.join(outDir, "kpi-summary.csv"), csv([
    ["kpi", "current_percent", "next_target_percent", "reason"],
    ...summary.kpis.map((kpi) => [kpi.label, kpi.current, kpi.target, kpi.reason]),
  ]));
  await writeFile(path.join(outDir, "boss-action-plan.csv"), csv([
    ["owner", "workstream", "why", "success_metric"],
    ...actions.map((row) => [row.owner, row.workstream, row.why, row.metric]),
  ]));
  await writeFile(path.join(outDir, "visibility-kpis.svg"), kpiSvg({ kpis: summary.kpis }));
  await writeFile(path.join(outDir, "competitor-pressure.svg"), barSvg({
    title: "Competitor Replacement Pressure",
    subtitle: "How often competitor brands replace or surround iBOLT in benchmark answers",
    rows: topCompetitors,
    color: "#dc2626",
  }));
  await writeFile(path.join(outDir, "topic-opportunity.svg"), barSvg({
    title: "Highest AI Visibility Topic Opportunities",
    subtitle: "Priority points from citation, conversion, competitor, and page-readiness analysis",
    rows: topTopics,
    color: "#2563eb",
  }));
  await writeFile(path.join(outDir, "product-family-gaps.svg"), barSvg({
    title: "Product-Family Coverage Gaps",
    subtitle: "Where prompt coverage and product modules need the most strengthening",
    rows: weakFamilies,
    color: "#7c3aed",
  }));
  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown({ summary, topCompetitors, topTopics, topPages, weakFamilies, actions }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({ summary, topCompetitors, topTopics, topPages, weakFamilies, actions }));

  console.log(`Wrote ${outDir}`);
  console.log(JSON.stringify({
    mentionRate: summary.mentionRate,
    nonBrandedMentionRate: summary.nonBrandedMentionRate,
    topThreeRate: summary.topThreeRate,
    citationRate: summary.citationRate,
    competitorOnlyRate: summary.competitorOnlyRate,
    expandedPrompts: summary.expandedPrompts,
    providerRequests: summary.providerRequests,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
