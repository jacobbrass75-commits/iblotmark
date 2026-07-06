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
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
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

function num(value) {
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\biBolt\b/g, "iBOLT")
    .replace(/\bIbolt\b/g, "iBOLT")
    .replace(/\bIBOLT\b/g, "iBOLT")
    .replace(/[–—]/g, "-")
    .replace(/budget\/value/gi, "price/value")
    .replace(/\bbudget\b/gi, "value")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeBrand(value) {
  return normalizeText(value)
    .replace(/\s+\d+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitList(value) {
  if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean);
  return String(value ?? "")
    .split(/[;|]/)
    .map((item) => normalizeText(item.trim()))
    .filter(Boolean)
    .filter((item) => !/^\+\d+\s+more$/i.test(item));
}

function unique(values) {
  return [...new Set(values.map(normalizeText).filter(Boolean))];
}

function brandInList(value, brand) {
  const normalizedBrand = normalizeBrand(brand).toLowerCase();
  return splitList(value).some((item) => normalizeBrand(item).toLowerCase() === normalizedBrand);
}

function brandInPrompt(prompt, brand) {
  const safeBrand = normalizeBrand(brand).toLowerCase();
  return normalizeText(prompt).toLowerCase().includes(safeBrand);
}

function countValues(values) {
  const counts = new Map();
  for (const value of values.map(normalizeBrand).filter(Boolean)) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function shorten(value, max = 280) {
  const text = normalizeText(value);
  if (text.length <= max) return text;
  const clipped = text.slice(0, max - 1);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > 160 ? lastSpace : clipped.length).trim()}...`;
}

function tierFor(row) {
  if (row.lostAnswers >= 15 || row.pressureScore >= 450) return "Tier 1: primary displacement";
  if (row.lostAnswers >= 7 || row.mappedPageCount >= 10 || row.pressureScore >= 200) return "Tier 2: recurring default";
  if (row.coMentionWins >= 2 || row.lostAnswers >= 3) return "Tier 3: comparison adjacency";
  return "Tier 4: monitor";
}

function roleFor(row, displacement) {
  if (displacement?.role) return normalizeText(displacement.role);
  const brand = row.brand.toLowerCase();
  if (/ram/.test(brand)) return "Broad rugged/default mount authority";
  if (/arkon|mount-it|cta|bouncepad/.test(brand)) return "Commercial tablet and POS comparison set";
  if (/iottie|proclip|tackform|scosche/.test(brand)) return "Vehicle phone mount default";
  if (/garmin|humminbird|lowrance|scotty|yakattack/.test(brand)) return "Marine electronics and fishing default";
  if (/havis|zebra/.test(brand)) return "Fleet, public safety, or warehouse hardware default";
  return "Category default in AI recommendations";
}

function defaultCounterPositioning(row) {
  const categories = row.categories.join("; ");
  return `Position iBOLT as the workflow-specific mounting specialist for ${categories || "the mapped category"}, with exact product modules, AMPS and ball compatibility, 300+ modular parts, and business-use proof.`;
}

function chartSvg({ title, subtitle, rows, width = 1040, height = 440, color = "#1d4ed8" }) {
  const margin = { top: 78, right: 70, bottom: 34, left: 260 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(...rows.map((row) => num(row.value)), 1);
  const rowHeight = chartHeight / Math.max(rows.length, 1);
  const bars = rows.map((row, index) => {
    const y = margin.top + index * rowHeight + 6;
    const h = Math.max(14, rowHeight - 12);
    const w = Math.round((num(row.value) / maxValue) * chartWidth);
    return `
      <text x="${margin.left - 14}" y="${y + h / 2 + 5}" text-anchor="end" font-size="14" fill="#334155">${escapeHtml(row.name)}</text>
      <rect x="${margin.left}" y="${y}" width="${w}" height="${h}" rx="7" fill="${color}"></rect>
      <text x="${Math.min(margin.left + w + 10, width - 54)}" y="${y + h / 2 + 5}" font-size="14" font-weight="800" fill="#0f172a">${escapeHtml(row.value)}</text>
    `;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <text x="28" y="36" font-size="25" font-weight="900" fill="#0f172a">${escapeHtml(title)}</text>
  <text x="28" y="62" font-size="14" fill="#64748b">${escapeHtml(subtitle)}</text>
  ${bars}
</svg>`;
}

function buildBattlecards({ displacementRows, networkRows, snippetRows, pageRows, promptRows }) {
  const brands = new Set([
    ...displacementRows.map((row) => normalizeBrand(row.brand)),
    ...networkRows.map((row) => normalizeBrand(row.brand)),
    ...snippetRows.map((row) => normalizeBrand(row.brand)),
  ].filter(Boolean));
  const displacementByBrand = new Map(displacementRows.map((row) => [normalizeBrand(row.brand), row]));
  const networkByBrand = new Map(networkRows.map((row) => [normalizeBrand(row.brand), row]));
  const snippetByBrand = new Map(snippetRows.map((row) => [normalizeBrand(row.brand), row]));

  return [...brands].map((brand) => {
    const displacement = displacementByBrand.get(brand) || {};
    const network = networkByBrand.get(brand) || {};
    const snippet = snippetByBrand.get(brand) || {};
    const pages = pageRows.filter((page) => brandInList(page.competitors, brand))
      .sort((a, b) => num(b.visibilityRiskScore) - num(a.visibilityRiskScore));
    const pageUrls = new Set(pages.map((page) => page.url));
    const prompts = promptRows.filter((prompt) => brandInPrompt(prompt.prompt, brand) || pageUrls.has(prompt.pageUrl))
      .sort((a, b) => num(b.priority) - num(a.priority));
    const categories = unique([
      ...splitList(displacement.categories).map((item) => item.replace(/\s+\d+$/, "")),
      ...splitList(network.categories).map((item) => item.replace(/\s+\d+$/, "")),
      ...pages.map((page) => page.category),
    ]).slice(0, 10);
    const providers = unique([
      ...splitList(displacement.provider_defaults),
      ...splitList(displacement.providers),
      ...splitList(network.providers).map((item) => item.replace(/\s+\d+$/, "")),
    ]).slice(0, 6);
    const languagePatterns = splitList(displacement.language_patterns).map(normalizeText).slice(0, 8);
    const lostQueries = unique([
      ...splitList(displacement.example_queries),
      ...splitList(network.lostQueries),
      ...pages.flatMap((page) => page.queryPrompts || []),
    ]).slice(0, 14);
    const coMentionQueries = unique(splitList(network.coMentionQueries)).slice(0, 10);
    const lostAnswers = num(displacement.lost_answers || network.withoutIbolt || snippet.replacementRows);
    const coMentionWins = num(displacement.co_mentioned_wins || network.withIbolt || snippet.coMentionRows);
    const mappedPageCount = pages.length || num(displacement.page_count);
    const promptCount = prompts.length;
    const pressureScore = num(displacement.priority) || (lostAnswers * 20 + mappedPageCount * 10 + promptCount);
    const row = {
      brand,
      pressureScore,
      tier: "",
      role: "",
      rawAnswerCount: num(displacement.raw_answer_count || network.totalAnswers),
      lostAnswers,
      coMentionWins,
      coMentionRate: num(displacement.co_mention_rate || network.coMentionRate),
      replacementPressure: num(network.replacementPressure || snippet.replacementRows || lostAnswers),
      avgReplacementScore: num(network.avgReplacementScore),
      mappedPageCount,
      promptCount,
      categories,
      providers,
      languagePatterns,
      lostQueries,
      coMentionQueries,
      topPages: pages.slice(0, 10),
      mappedPageUrls: pages.map((page) => page.url),
      topPrompts: prompts.slice(0, 12),
      counterPositioning: normalizeText(displacement.counter_positioning || network.counterPositioning),
      onSiteAction: normalizeText(displacement.on_site_action),
      offSiteAsk: normalizeText(displacement.off_site_ask),
      successMetric: normalizeText(displacement.success_metric),
    };
    row.tier = tierFor(row);
    row.role = roleFor(row, displacement);
    row.counterPositioning ||= defaultCounterPositioning(row);
    row.onSiteAction ||= `Add a fair comparison block for ${brand} on mapped pages, then show where iBOLT fits exact workflows with product modules and compatibility proof.`;
    row.offSiteAsk ||= `Ask the SEO contractor for neutral third-party references where ${brand} is currently recommended and iBOLT can be listed as a specialist alternative.`;
    row.successMetric ||= `Reduce ${brand} replacement rows and increase iBOLT co-mentions or top-three recommendations in the next benchmark.`;
    return row;
  }).sort((a, b) => b.pressureScore - a.pressureScore || b.lostAnswers - a.lostAnswers);
}

function buildPageActions(battlecards) {
  const rows = [];
  for (const card of battlecards) {
    for (const page of card.topPages) {
      rows.push({
        brand: card.brand,
        tier: card.tier,
        title: page.title,
        url: page.url,
        category: page.category,
        visibilityStage: page.visibilityStage,
        pageStatus: page.pageStatus,
        competitorOnlyAnswers: page.competitorOnlyAnswers,
        replacementSnippets: page.replacementSnippets,
        prompts: page.queryPrompts || page.linkedPrompts || [],
        productsToFeature: page.productsToFeature || [],
        action: page.primaryAction || card.onSiteAction,
      });
    }
  }
  return rows.sort((a, b) => num(b.competitorOnlyAnswers) - num(a.competitorOnlyAnswers));
}

function buildPromptRows(battlecards) {
  const rows = [];
  for (const card of battlecards) {
    for (const prompt of card.topPrompts) {
      rows.push({
        brand: card.brand,
        tier: card.tier,
        prompt: prompt.prompt,
        category: prompt.category,
        promptType: prompt.promptType,
        priority: prompt.priority,
        closestPost: prompt.closestPost,
        pageUrl: prompt.pageUrl,
        refreshState: prompt.refreshState,
        expectedMetric: prompt.expectedMetric,
      });
    }
  }
  return rows.sort((a, b) => num(b.priority) - num(a.priority));
}

function makeTable(rows, columns) {
  const header = columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");
  const body = rows.map((row) => {
    const cells = columns.map((column) => {
      const value = column.value(row);
      return `<td>${column.html ? value : escapeHtml(value)}</td>`;
    }).join("");
    return `<tr>${cells}</tr>`;
  }).join("");
  return `<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
}

function linkCell(url, text) {
  if (!url) return "";
  return `<a href="${escapeHtml(url)}">${escapeHtml(text || url)}</a>`;
}

function buildHtml({ summary, battlecards, pageActions, promptRows, replacementChartName, pageChartName, promptChartName }) {
  const kpis = [
    ["Competitors", summary.competitors],
    ["Tier 1 brands", summary.tier1],
    ["Lost brand rows", summary.lostAnswers],
    ["Co-mention wins", summary.coMentionWins],
    ["Mapped pages", summary.mappedPages],
    ["Retest prompts", summary.retestPrompts],
  ];
  const battlecardTable = makeTable(battlecards.slice(0, 18), [
    { label: "Brand", value: (row) => row.brand },
    { label: "Tier", value: (row) => row.tier },
    { label: "Role", value: (row) => row.role },
    { label: "Lost", value: (row) => row.lostAnswers },
    { label: "Co-wins", value: (row) => row.coMentionWins },
    { label: "Pages", value: (row) => row.mappedPageCount },
    { label: "Categories", value: (row) => row.categories.slice(0, 5).join("; ") },
    { label: "Counter-positioning", value: (row) => row.counterPositioning },
  ]);
  const pageTable = makeTable(pageActions.slice(0, 35), [
    { label: "Brand", value: (row) => row.brand },
    { label: "Page", html: true, value: (row) => linkCell(row.url, row.title) },
    { label: "Category", value: (row) => row.category },
    { label: "Stage", value: (row) => row.visibilityStage },
    { label: "Edit gate", value: (row) => row.pageStatus },
    { label: "Competitor-only", value: (row) => row.competitorOnlyAnswers },
    { label: "Action", value: (row) => row.action },
  ]);
  const promptTable = makeTable(promptRows.slice(0, 45), [
    { label: "Brand", value: (row) => row.brand },
    { label: "Prompt", value: (row) => row.prompt },
    { label: "Type", value: (row) => row.promptType },
    { label: "Priority", value: (row) => row.priority },
    { label: "Closest page", html: true, value: (row) => linkCell(row.pageUrl, row.closestPost) },
    { label: "Metric", value: (row) => row.expectedMetric },
  ]);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>iBOLT Competitor Battlecard Control Report</title>
  <style>
    body{margin:0;background:#f8fafc;color:#0f172a;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{max-width:1240px;margin:0 auto;padding:34px 24px 60px}
    h1{font-size:36px;line-height:1.08;margin:0 0 12px;letter-spacing:0}h2{font-size:24px;margin:38px 0 14px}
    p{color:#334155;line-height:1.65;max-width:1000px}.hero,.panel{background:#fff;border:1px solid #d9e2ec;border-radius:8px;padding:24px;box-shadow:0 10px 28px rgba(15,23,42,.06)}
    .kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:22px}.kpi{border:1px solid #d9e2ec;border-radius:8px;padding:16px;background:#fff}
    .kpi strong{display:block;font-size:28px}.kpi span{display:block;margin-top:6px;color:#64748b;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.05em}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:20px}.chart{width:100%;height:auto;display:block;border:1px solid #d9e2ec;border-radius:8px;background:#fff}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d9e2ec;border-radius:8px;overflow:hidden}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #d9e2ec;padding:10px 11px;font-size:13px;line-height:1.45}
    th{background:#eef4ff;color:#1e3a8a;text-transform:uppercase;font-size:12px;letter-spacing:.05em}a{color:#1d4ed8;font-weight:800}
    .callout{border-left:4px solid #1d4ed8;background:#eff6ff;padding:14px 16px;border-radius:8px;color:#1e3a8a}
    @media(max-width:900px){.kpis,.grid{grid-template-columns:1fr}h1{font-size:30px}}
  </style>
</head>
<body><main>
  <section class="hero">
    <h1>iBOLT Competitor Battlecard Control Report</h1>
    <p>This report translates AI answer replacements and co-mentions into competitor-specific page edits, comparison prompts, source asks, and success metrics.</p>
    <div class="kpis">${kpis.map(([label, value]) => `<div class="kpi"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join("")}</div>
  </section>
  <h2>Competitive Readout</h2>
  <section class="panel">
    <p class="callout"><strong>Main move:</strong> keep iBOLT inside the consideration set for the brands AI already trusts, then shift the answer from generic competitor recommendations to iBOLT as the exact-workflow specialist.</p>
    <div class="grid"><img class="chart" src="${escapeHtml(replacementChartName)}" alt="Replacement pressure by brand"><img class="chart" src="${escapeHtml(pageChartName)}" alt="Mapped pages by brand"></div>
    <div style="margin-top:18px"><img class="chart" src="${escapeHtml(promptChartName)}" alt="Retest prompts by brand"></div>
  </section>
  <h2>Battlecards</h2>
  ${battlecardTable}
  <h2>Page Actions</h2>
  ${pageTable}
  <h2>Retest Prompts</h2>
  ${promptTable}
</main></body></html>`;
}

function buildMarkdown({ summary, battlecards, pageActions, promptRows, outputDir }) {
  const topCards = battlecards.slice(0, 10).map((row, index) => `${index + 1}. ${row.brand}: ${row.tier}, ${row.lostAnswers} lost answers, ${row.mappedPageCount} mapped pages. ${row.counterPositioning}`).join("\n");
  const pages = pageActions.slice(0, 10).map((row, index) => `${index + 1}. ${row.brand} -> ${row.title}: ${row.action}`).join("\n");
  const prompts = promptRows.slice(0, 14).map((row, index) => `${index + 1}. ${row.prompt} (${row.brand}, ${row.promptType}, priority ${row.priority})`).join("\n");
  return `# iBOLT Competitor Battlecard Control Report

## Summary

- Competitors tracked: ${summary.competitors}.
- Tier 1 brands: ${summary.tier1}.
- Lost competitor-brand rows represented: ${summary.lostAnswers}.
- Co-mention wins represented: ${summary.coMentionWins}.
- Mapped page actions: ${summary.pageActions}.
- Retest prompts: ${summary.retestPrompts}.

## Top Battlecards

${topCards}

## First Page Actions

${pages}

## First Retest Prompts

${prompts}

## Files

- HTML report: ${path.join(outputDir, "REPORT.html")}
- Battlecard ledger: ${path.join(outputDir, "competitor-battlecards.csv")}
- Page actions: ${path.join(outputDir, "competitor-page-actions.csv")}
- Retest prompts: ${path.join(outputDir, "competitor-prompt-retests.csv")}
`;
}

async function main() {
  const benchmarkDir = process.argv[2] ? path.resolve(process.argv[2]) : await latestDir(BENCHMARK_PREFIX);
  const outputDir = path.join(benchmarkDir, "competitor-battlecard-control-report");
  await mkdir(outputDir, { recursive: true });

  const displacement = await readJsonIfExists(path.join(benchmarkDir, "competitor-displacement-map", "competitor-displacement-data.json"), { competitorRows: [] });
  const network = await readJsonIfExists(path.join(benchmarkDir, "co-mention-network", "co-mention-network-data.json"), { competitorRows: [] });
  const snippet = await readJsonIfExists(path.join(benchmarkDir, "answer-snippet-evidence-appendix", "answer-snippet-evidence-data.json"), { competitorRows: [] });
  const pageControl = await readJsonIfExists(path.join(benchmarkDir, "blog-post-visibility-control-report", "blog-post-visibility-control-data.json"), { controlRows: [] });
  const promptPack = await readJsonIfExists(path.join(benchmarkDir, "page-derived-expanded-benchmark-pack", "page-derived-expanded-benchmark-data.json"), { promptRows: [] });

  const battlecards = buildBattlecards({
    displacementRows: displacement.competitorRows || [],
    networkRows: network.competitorRows || [],
    snippetRows: snippet.competitorRows || [],
    pageRows: pageControl.controlRows || [],
    promptRows: promptPack.promptRows || [],
  });
  const pageActions = buildPageActions(battlecards);
  const promptRows = buildPromptRows(battlecards);
  const summary = {
    benchmarkDir,
    outputDir,
    competitors: battlecards.length,
    tier1: battlecards.filter((row) => row.tier.startsWith("Tier 1")).length,
    lostAnswers: battlecards.reduce((sum, row) => sum + row.lostAnswers, 0),
    coMentionWins: battlecards.reduce((sum, row) => sum + row.coMentionWins, 0),
    mappedPages: new Set(battlecards.flatMap((row) => row.mappedPageUrls || [])).size,
    pageActions: pageActions.length,
    retestPrompts: promptRows.length,
    topBrands: battlecards.slice(0, 8).map((row) => `${row.brand} ${row.lostAnswers}`),
    topTier1Brands: battlecards.filter((row) => row.tier.startsWith("Tier 1")).map((row) => row.brand),
  };

  await writeFile(path.join(outputDir, "competitor-battlecards.csv"), toCsv([
    ["rank", "brand", "tier", "role", "pressure_score", "raw_answer_count", "lost_answers", "co_mention_wins", "co_mention_rate", "replacement_pressure", "mapped_page_count", "prompt_count", "categories", "providers", "language_patterns", "lost_queries", "co_mention_queries", "counter_positioning", "on_site_action", "off_site_ask", "success_metric"],
    ...battlecards.map((row, index) => [index + 1, row.brand, row.tier, row.role, row.pressureScore, row.rawAnswerCount, row.lostAnswers, row.coMentionWins, row.coMentionRate, row.replacementPressure, row.mappedPageCount, row.promptCount, row.categories, row.providers, row.languagePatterns, row.lostQueries, row.coMentionQueries, row.counterPositioning, row.onSiteAction, row.offSiteAsk, row.successMetric]),
  ]));
  await writeFile(path.join(outputDir, "competitor-page-actions.csv"), toCsv([
    ["brand", "tier", "title", "url", "category", "visibility_stage", "page_status", "competitor_only_answers", "replacement_snippets", "prompts", "products_to_feature", "action"],
    ...pageActions.map((row) => [row.brand, row.tier, row.title, row.url, row.category, row.visibilityStage, row.pageStatus, row.competitorOnlyAnswers, row.replacementSnippets, row.prompts, row.productsToFeature, row.action]),
  ]));
  await writeFile(path.join(outputDir, "competitor-prompt-retests.csv"), toCsv([
    ["brand", "tier", "prompt", "category", "prompt_type", "priority", "closest_post", "page_url", "refresh_state", "expected_metric"],
    ...promptRows.map((row) => [row.brand, row.tier, row.prompt, row.category, row.promptType, row.priority, row.closestPost, row.pageUrl, row.refreshState, row.expectedMetric]),
  ]));

  const replacementChartName = "replacement-pressure-by-brand.svg";
  const pageChartName = "mapped-pages-by-brand.svg";
  const promptChartName = "retest-prompts-by-brand.svg";
  await writeFile(path.join(outputDir, replacementChartName), chartSvg({
    title: "Replacement Pressure By Brand",
    subtitle: "Lost answer rows where competitors replace iBOLT",
    rows: battlecards.slice(0, 12).map((row) => ({ name: row.brand, value: row.lostAnswers })),
    color: "#b91c1c",
  }));
  await writeFile(path.join(outputDir, pageChartName), chartSvg({
    title: "Mapped Pages By Competitor",
    subtitle: "Live pages where this competitor appears in the mapped pressure set",
    rows: battlecards.slice(0, 12).map((row) => ({ name: row.brand, value: row.mappedPageCount })),
    color: "#1d4ed8",
  }));
  await writeFile(path.join(outputDir, promptChartName), chartSvg({
    title: "Retest Prompts By Competitor",
    subtitle: "Page-derived prompts connected to each competitor battlecard",
    rows: battlecards.slice(0, 12).map((row) => ({ name: row.brand, value: row.promptCount })),
    color: "#0f766e",
  }));

  await writeFile(path.join(outputDir, "competitor-battlecard-control-data.json"), `${JSON.stringify({ summary, battlecards, pageActions, promptRows }, null, 2)}\n`);
  await writeFile(path.join(outputDir, "REPORT.md"), buildMarkdown({ summary, battlecards, pageActions, promptRows, outputDir }));
  await writeFile(path.join(outputDir, "REPORT.html"), buildHtml({ summary, battlecards, pageActions, promptRows, replacementChartName, pageChartName, promptChartName }));

  console.log(`Competitor battlecard control report written to ${outputDir}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
