import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_OUTPUT_ROOT = "content-output";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pct(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

function titleCaseProvider(provider) {
  if (provider === "chatgpt") return "ChatGPT";
  if (provider === "gemini_plain") return "Gemini";
  if (provider === "claude") return "Claude";
  return provider;
}

function shortLabel(text, max = 58) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trim()}...`;
}

function wrapText(text, maxChars) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
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

function svgShell(width, height, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
  <style>
    .bg{fill:#f8fafc}.panel{fill:#fff;stroke:#d7dee8;stroke-width:1}.axis{stroke:#94a3b8;stroke-width:1}.grid{stroke:#e2e8f0;stroke-width:1}.title{font:700 24px Arial, sans-serif;fill:#111827}.subtitle{font:400 14px Arial, sans-serif;fill:#64748b}.label{font:700 13px Arial, sans-serif;fill:#111827}.small{font:400 12px Arial, sans-serif;fill:#475569}.value{font:700 13px Arial, sans-serif;fill:#0f172a}.white{font:700 13px Arial, sans-serif;fill:#fff}
  </style>
  <rect class="bg" width="${width}" height="${height}" rx="0"/>
  ${body}
</svg>`;
}

function groupedProviderChart(providerSummaries) {
  const width = 980;
  const height = 560;
  const chart = { x: 90, y: 104, w: 820, h: 320 };
  const metrics = [
    { key: "avgScore", label: "Avg score", color: "#2563eb" },
    { key: "mentionRate", label: "Mention", color: "#16a34a" },
    { key: "topThreeRate", label: "Top 3", color: "#f97316" },
    { key: "citationRate", label: "Citation", color: "#dc2626" },
  ];
  const groups = providerSummaries.map((provider) => ({
    name: titleCaseProvider(provider.provider),
    avgScore: provider.avgScore,
    mentionRate: provider.mentionRate,
    topThreeRate: provider.topThreeRate,
    citationRate: provider.citationRate,
  }));

  const grid = [0, 25, 50, 75, 100].map((tick) => {
    const y = chart.y + chart.h - (tick / 100) * chart.h;
    return `<line class="grid" x1="${chart.x}" y1="${y}" x2="${chart.x + chart.w}" y2="${y}"/><text class="small" x="${chart.x - 14}" y="${y + 4}" text-anchor="end">${tick}</text>`;
  }).join("\n");

  const groupWidth = chart.w / groups.length;
  const barW = 34;
  const bars = groups.map((group, groupIndex) => {
    const startX = chart.x + groupIndex * groupWidth + (groupWidth - metrics.length * barW - 18) / 2;
    const barParts = metrics.map((metric, metricIndex) => {
      const value = Math.max(0, Math.min(100, Number(group[metric.key] || 0)));
      const h = (value / 100) * chart.h;
      const x = startX + metricIndex * (barW + 6);
      const y = chart.y + chart.h - h;
      return `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="5" fill="${metric.color}"/><text class="value" x="${x + barW / 2}" y="${y - 7}" text-anchor="middle">${value}</text>`;
    }).join("\n");
    const labelX = chart.x + groupIndex * groupWidth + groupWidth / 2;
    return `${barParts}<text class="label" x="${labelX}" y="${chart.y + chart.h + 38}" text-anchor="middle">${group.name}</text>`;
  }).join("\n");

  const legend = metrics.map((metric, index) => {
    const x = 142 + index * 178;
    return `<rect x="${x}" y="486" width="16" height="16" rx="4" fill="${metric.color}"/><text class="small" x="${x + 24}" y="499">${metric.label}</text>`;
  }).join("\n");

  return svgShell(width, height, `
    <rect class="panel" x="36" y="28" width="908" height="500" rx="14"/>
    <text class="title" x="70" y="68">AI Visibility by Provider</text>
    <text class="subtitle" x="70" y="91">Scores are out of 100. Citations are the biggest current weakness.</text>
    ${grid}
    <line class="axis" x1="${chart.x}" y1="${chart.y + chart.h}" x2="${chart.x + chart.w}" y2="${chart.y + chart.h}"/>
    <line class="axis" x1="${chart.x}" y1="${chart.y}" x2="${chart.x}" y2="${chart.y + chart.h}"/>
    ${bars}
    ${legend}
  `);
}

function horizontalBarChart({ title, subtitle, rows, valueKey = "value", labelKey = "label", noteKey = "note", color = "#2563eb" }) {
  const width = 1100;
  const rowH = 43;
  const height = 128 + rows.length * rowH + 38;
  const left = 420;
  const barW = 560;
  const top = 108;
  const body = rows.map((row, index) => {
    const y = top + index * rowH;
    const value = Math.max(0, Math.min(100, Number(row[valueKey] || 0)));
    const w = (value / 100) * barW;
    const labelLines = wrapText(row[labelKey], 46);
    const labels = labelLines.map((line, lineIndex) =>
      `<text class="${lineIndex === 0 ? "label" : "small"}" x="56" y="${y + 15 + lineIndex * 15}">${escapeHtml(line)}</text>`
    ).join("\n");
    return `
      ${labels}
      <rect x="${left}" y="${y}" width="${barW}" height="24" rx="8" fill="#e2e8f0"/>
      <rect x="${left}" y="${y}" width="${w}" height="24" rx="8" fill="${color}"/>
      <text class="value" x="${left + barW + 14}" y="${y + 17}">${value}</text>
      <text class="small" x="${left}" y="${y + 39}">${escapeHtml(row[noteKey] || "")}</text>
    `;
  }).join("\n");

  return svgShell(width, height, `
    <rect class="panel" x="28" y="24" width="${width - 56}" height="${height - 48}" rx="14"/>
    <text class="title" x="56" y="65">${escapeHtml(title)}</text>
    <text class="subtitle" x="56" y="88">${escapeHtml(subtitle)}</text>
    ${body}
  `);
}

function funnelChart(stats) {
  const width = 980;
  const height = 520;
  const barX = 330;
  const maxBarW = 520;
  const steps = [
    { label: "AI answers tested", count: stats.total, color: "#0f172a" },
    { label: "Mentioned iBOLT", count: stats.mentions, color: "#16a34a" },
    { label: "Ranked iBOLT in top 3", count: stats.topThree, color: "#f97316" },
    { label: "Cited iboltmounts.com", count: stats.citations, color: "#dc2626" },
  ];
  const max = stats.total || 1;
  const body = steps.map((step, index) => {
    const y = 116 + index * 82;
    const ratio = step.count / max;
    const w = Math.round(maxBarW * ratio);
    const visibleW = Math.max(step.count === 0 ? 18 : 42, w);
    const x = barX;
    const textInside = visibleW >= 86;
    const textX = textInside ? x + visibleW / 2 : x + visibleW + 14;
    const textClass = textInside ? "white" : "value";
    return `
      <rect x="${x}" y="${y}" width="${visibleW}" height="46" rx="12" fill="${step.count === 0 ? "#fee2e2" : step.color}" stroke="${step.count === 0 ? step.color : "none"}"/>
      <text class="${textClass}" x="${textX}" y="${y + 29}" text-anchor="${textInside ? "middle" : "start"}">${step.count} (${pct(step.count, stats.total)}%)</text>
      <text class="label" x="70" y="${y + 30}">${escapeHtml(step.label)}</text>
    `;
  }).join("\n");

  return svgShell(width, height, `
    <rect class="panel" x="36" y="28" width="908" height="458" rx="14"/>
    <text class="title" x="70" y="68">AI Answer Funnel</text>
    <text class="subtitle" x="70" y="91">The task is moving from mentions to citations and recommended placements.</text>
    ${body}
  `);
}

function contentPlanChart(contentPlan) {
  const rows = contentPlan.slice(0, 8).map((item) => ({
    label: item.primaryKeyword,
    value: item.gapScore,
    note: shortLabel((item.supportingProducts || []).slice(0, 2).join("; "), 86),
  }));
  return horizontalBarChart({
    title: "Highest-Priority Content Opportunities",
    subtitle: "Gap score combines weak AI visibility with available product support.",
    rows,
    color: "#7c3aed",
  });
}

function buildStats(current) {
  const results = current.querySummaries.flatMap((query) => query.results.map((result) => ({
    ...result,
    query: query.query,
    category: query.category,
    averageScore: query.averageScore,
    averageMentionRate: query.averageMentionRate,
    priority: query.priority,
  })));
  const completed = results.filter((result) => result.status === "completed");
  const mentions = completed.filter((result) => result.brandMentioned || result.targetBrandMentioned).length;
  const citations = completed.filter((result) => result.iboltCited || result.targetDomainCited).length;
  const topThree = completed.filter((result) => Number(result.topPickRank) >= 1 && Number(result.topPickRank) <= 3).length;
  return { results, completed, total: completed.length, mentions, citations, topThree };
}

function buildCategoryRows(querySummaries) {
  const byCategory = new Map();
  for (const query of querySummaries) {
    const bucket = byCategory.get(query.category) || { category: query.category, count: 0, score: 0, noMention: 0 };
    bucket.count += 1;
    bucket.score += query.averageScore;
    if (!query.averageMentionRate) bucket.noMention += 1;
    byCategory.set(query.category, bucket);
  }
  return [...byCategory.values()]
    .map((bucket) => ({
      label: bucket.category,
      value: Math.round(100 - bucket.score / bucket.count),
      note: `${bucket.count} prompts, ${bucket.noMention} with no iBOLT mention`,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
}

function buildPromptGapRows(querySummaries) {
  return [...querySummaries]
    .sort((a, b) => a.averageScore - b.averageScore || b.priority - a.priority)
    .slice(0, 12)
    .map((query) => ({
      label: query.query,
      value: Math.round(100 - query.averageScore),
      note: `${query.category}; mention rate ${query.averageMentionRate}%`,
    }));
}

function buildMarkdown({ current, stats, outDirName, contentPlan }) {
  const providers = current.providerSummaries
    .map((provider) => `- ${titleCaseProvider(provider.provider)}: avg score ${provider.avgScore}, mention ${provider.mentionRate}%, top-3 ${provider.topThreeRate}%, citation ${provider.citationRate}%`)
    .join("\n");
  const gapRows = buildPromptGapRows(current.querySummaries).slice(0, 8)
    .map((row, index) => `${index + 1}. ${row.label} - gap ${row.value}/100 (${row.note})`)
    .join("\n");
  const planRows = contentPlan.slice(0, 6)
    .map((item, index) => `${index + 1}. ${item.title} - target: ${item.primaryKeyword}`)
    .join("\n");

  return `# iBOLT AI Visibility Benchmark Boss Brief

Source run: ${current.run.id}
Output folder: ${outDirName}

## Executive Takeaway

We tested ${current.querySummaries.length} buyer-style prompts across ChatGPT, Gemini, and Claude as separate one-at-a-time requests (${stats.total} completed AI answers). iBOLT is appearing in some branded or near-branded questions, but broad buyer-intent prompts are still weak. The biggest issue is citations: ${stats.citations}/${stats.total} answers cited iboltmounts.com.

## Scorecard

- Total AI answers tested: ${stats.total}
- iBOLT mentioned: ${stats.mentions}/${stats.total} (${pct(stats.mentions, stats.total)}%)
- iBOLT ranked in top 3: ${stats.topThree}/${stats.total} (${pct(stats.topThree, stats.total)}%)
- iboltmounts.com cited: ${stats.citations}/${stats.total} (${pct(stats.citations, stats.total)}%)

## Provider Summary

${providers}

## Should We Improve Citation Rate?

Yes, but we should interpret it correctly. Normal chat models often answer without citations, so 0% citation rate is not surprising in this exact OpenRouter run. It is still important because search-grounded AI products, Google AI Overviews, Perplexity, and shopping assistants are more likely to trust and cite pages that are structured, specific, and externally corroborated. The practical goal is to create pages that are easy for AI systems to quote: clear solution pages, concise FAQs, product schema, comparison tables, and strong internal links to the exact product pages.

## Biggest Gaps To Act On

${gapRows}

## Recommended Content Push

${planRows}

## Files

- boss-brief.html
- provider-performance.svg
- ai-answer-funnel.svg
- category-opportunity.svg
- prompt-gaps.svg
- content-priorities.svg
`;
}

function buildHtml({ current, stats, contentPlan }) {
  const providerCards = current.providerSummaries.map((provider) => `
    <div class="card">
      <div class="kicker">${titleCaseProvider(provider.provider)}</div>
      <div class="metric">${provider.avgScore}</div>
      <div class="sub">avg score / 100</div>
      <div class="line"><span>Mentions</span><b>${provider.mentionRate}%</b></div>
      <div class="line"><span>Top 3</span><b>${provider.topThreeRate}%</b></div>
      <div class="line"><span>Citations</span><b>${provider.citationRate}%</b></div>
    </div>
  `).join("");
  const nextActions = contentPlan.slice(0, 6).map((item) => `
    <tr>
      <td>${escapeHtml(item.primaryKeyword)}</td>
      <td>${escapeHtml(item.title)}</td>
      <td>${escapeHtml((item.supportingProducts || []).slice(0, 3).join("; "))}</td>
      <td>${item.gapScore}</td>
    </tr>
  `).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT AI Visibility Boss Brief</title>
  <style>
    :root{color-scheme:light;--ink:#111827;--muted:#64748b;--border:#d7dee8;--panel:#fff;--bg:#f8fafc;--blue:#2563eb;--green:#16a34a;--orange:#f97316;--red:#dc2626}
    body{margin:0;background:var(--bg);font-family:Arial,Helvetica,sans-serif;color:var(--ink)}
    main{max-width:1180px;margin:0 auto;padding:36px 28px 60px}
    header{padding:18px 0 28px;border-bottom:1px solid var(--border);margin-bottom:26px}
    h1{font-size:34px;line-height:1.08;margin:0 0 10px}
    h2{font-size:22px;margin:34px 0 14px}
    p{font-size:16px;line-height:1.55;color:#334155;max-width:900px}
    .meta{color:var(--muted);font-size:14px}
    .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:24px 0}
    .card{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:18px;box-shadow:0 1px 2px rgba(15,23,42,.04)}
    .kicker{text-transform:uppercase;letter-spacing:.06em;font-size:12px;color:var(--muted);font-weight:700}
    .metric{font-size:34px;font-weight:800;margin-top:8px}
    .sub{font-size:13px;color:var(--muted);margin-bottom:14px}
    .line{display:flex;justify-content:space-between;border-top:1px solid #eef2f7;padding-top:8px;margin-top:8px;font-size:14px}
    .charts{display:grid;grid-template-columns:1fr;gap:18px}
    figure{margin:0;background:#fff;border:1px solid var(--border);border-radius:14px;padding:10px;overflow:auto}
    figure img{display:block;width:100%;height:auto}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--border);border-radius:12px;overflow:hidden}
    th,td{text-align:left;padding:12px 14px;border-bottom:1px solid #eef2f7;vertical-align:top;font-size:14px}
    th{background:#f1f5f9;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#475569}
    .takeaway{background:#fff;border-left:6px solid var(--blue);border-radius:10px;padding:16px 18px;border-top:1px solid var(--border);border-right:1px solid var(--border);border-bottom:1px solid var(--border)}
    @media print{body{background:#fff}main{max-width:none;padding:18px}.grid{grid-template-columns:repeat(4,1fr)}figure,.card,table{break-inside:avoid;box-shadow:none}}
  </style>
</head>
<body>
  <main>
    <header>
      <div class="meta">Run ID: ${escapeHtml(current.run.id)} | ${current.querySummaries.length} prompts | ${stats.total} completed AI answers | separate one-at-a-time requests</div>
      <h1>iBOLT AI Visibility Benchmark</h1>
      <p class="takeaway"><strong>Bottom line:</strong> iBOLT is visible in some branded and near-branded prompts, but broad buyer-intent prompts still have low recommendation coverage. The biggest near-term opportunity is building AI-citable pages that earn domain citations, because this run produced ${stats.citations}/${stats.total} citations to iboltmounts.com.</p>
    </header>

    <section class="grid">
      <div class="card"><div class="kicker">Answers tested</div><div class="metric">${stats.total}</div><div class="sub">ChatGPT, Gemini, Claude</div></div>
      <div class="card"><div class="kicker">Mention rate</div><div class="metric">${pct(stats.mentions, stats.total)}%</div><div class="sub">${stats.mentions}/${stats.total} answers mentioned iBOLT</div></div>
      <div class="card"><div class="kicker">Top-3 rate</div><div class="metric">${pct(stats.topThree, stats.total)}%</div><div class="sub">${stats.topThree}/${stats.total} ranked iBOLT top 3</div></div>
      <div class="card"><div class="kicker">Citation rate</div><div class="metric">${pct(stats.citations, stats.total)}%</div><div class="sub">${stats.citations}/${stats.total} cited iboltmounts.com</div></div>
    </section>

    <section class="grid">
      ${providerCards}
    </section>

    <h2>Charts</h2>
    <section class="charts">
      <figure><img src="provider-performance.svg" alt="AI visibility by provider"/></figure>
      <figure><img src="ai-answer-funnel.svg" alt="AI answer funnel"/></figure>
      <figure><img src="category-opportunity.svg" alt="Opportunity by category"/></figure>
      <figure><img src="prompt-gaps.svg" alt="Biggest prompt gaps"/></figure>
      <figure><img src="content-priorities.svg" alt="Content priorities"/></figure>
    </section>

    <h2>How To Read Citation Rate</h2>
    <p>Yes, citation rate matters, but this benchmark used normal consumer-style chat answers, and those models often respond without citations. A 0% citation rate means iBOLT is not yet being used as a cited source in these answers. The fix is not just more blog volume. We need citable solution pages, concise FAQs, product and organization schema, comparison tables, and stronger external mentions so search-grounded AI systems can confidently reference iboltmounts.com.</p>

    <h2>Recommended Content Push</h2>
    <table>
      <thead><tr><th>Target query</th><th>Recommended page/post</th><th>Products to support</th><th>Gap</th></tr></thead>
      <tbody>${nextActions}</tbody>
    </table>
  </main>
</body>
</html>`;
}

async function findLatestBenchmarkDir() {
  const outputRoot = path.join(process.cwd(), DEFAULT_OUTPUT_ROOT);
  const entries = await readdir(outputRoot, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("openrouter-ai-benchmark-"))
    .map((entry) => entry.name)
    .sort();
  if (!dirs.length) throw new Error("No OpenRouter benchmark output directory found.");
  return path.join(outputRoot, dirs[dirs.length - 1]);
}

async function main() {
  const benchmarkDir = process.argv[2] ? path.resolve(process.argv[2]) : await findLatestBenchmarkDir();
  const summaryPath = path.join(benchmarkDir, "summary.json");
  const data = JSON.parse(await readFile(summaryPath, "utf8"));
  const current = data.current;
  const contentPlan = data.contentPlan || [];
  const stats = buildStats(current);
  const outDir = path.join(benchmarkDir, "boss-brief");
  await mkdir(outDir, { recursive: true });

  await writeFile(path.join(outDir, "provider-performance.svg"), groupedProviderChart(current.providerSummaries));
  await writeFile(path.join(outDir, "ai-answer-funnel.svg"), funnelChart(stats));
  await writeFile(path.join(outDir, "category-opportunity.svg"), horizontalBarChart({
    title: "Opportunity by Category",
    subtitle: "Higher bars mean lower current AI visibility and more room to win.",
    rows: buildCategoryRows(current.querySummaries),
    color: "#0891b2",
  }));
  await writeFile(path.join(outDir, "prompt-gaps.svg"), horizontalBarChart({
    title: "Biggest Prompt Gaps",
    subtitle: "Prompts with the weakest average score across ChatGPT, Gemini, and Claude.",
    rows: buildPromptGapRows(current.querySummaries),
    color: "#dc2626",
  }));
  await writeFile(path.join(outDir, "content-priorities.svg"), contentPlanChart(contentPlan));
  await writeFile(path.join(outDir, "boss-brief.html"), buildHtml({ current, stats, contentPlan }));
  await writeFile(path.join(outDir, "boss-brief.md"), buildMarkdown({
    current,
    stats,
    outDirName: path.relative(process.cwd(), outDir),
    contentPlan,
  }));

  console.log(outDir);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
