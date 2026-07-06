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
  return denominator ? Math.round((numerator / denominator) * 100) : 0;
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
  const rowH = 46;
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
      `<text class="${lineIndex === 0 ? "label" : "small"}" x="54" y="${y + 14 + lineIndex * 15}">${escapeHtml(line)}</text>`
    ).join("\n");
    return `
      ${labels}
      <rect x="${left}" y="${y}" width="${barW}" height="24" rx="8" fill="#e2e8f0"/>
      <rect x="${left}" y="${y}" width="${w}" height="24" rx="8" fill="${color}"/>
      <text class="value" x="${left + barW + 14}" y="${y + 17}">${escapeHtml(row.display ?? value)}</text>
      <text class="small" x="${left}" y="${y + 41}">${escapeHtml(row.note || "")}</text>
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
    ["AI answers tested", stats.total, "#0f172a"],
    ["iBOLT mentioned", stats.mentions, "#16a34a"],
    ["Non-branded iBOLT mentions", stats.nonBrandedMentions, "#0891b2"],
    ["iBOLT top-3 recommendations", stats.topThree, "#f97316"],
    ["iboltmounts.com citations", stats.citations, "#dc2626"],
  ];
  const max = stats.total || 1;
  const body = steps.map(([label, count, color], index) => {
    const y = 112 + index * 70;
    const w = Math.max(count ? 28 : 18, Math.round((count / max) * maxW));
    const textInside = w > 96;
    return `
      <text class="label" x="70" y="${y + 28}">${escapeHtml(label)}</text>
      <rect x="${x}" y="${y}" width="${w}" height="42" rx="12" fill="${count ? color : "#fee2e2"}" stroke="${count ? "none" : color}"/>
      <text class="${textInside ? "white" : "value"}" x="${textInside ? x + w / 2 : x + w + 14}" y="${y + 27}" text-anchor="${textInside ? "middle" : "start"}">${count} (${pct(count, stats.total)}%)</text>
    `;
  }).join("\n");
  return svgShell(width, height, `
    <rect class="panel" x="34" y="24" width="${width - 68}" height="${height - 48}" rx="14"/>
    <text class="title" x="70" y="64">AI Visibility Funnel</text>
    <text class="subtitle" x="70" y="88">Current consumer-model benchmark shows the drop-off from broad testing to citations.</text>
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

function buildWorkstreams({ matrix, blogAudit, liveAudit, expandedPromptCount }) {
  const topQueries = matrix.queryMatrix.slice(0, 8);
  const topPages = matrix.pageQueue.slice(0, 10);
  const topCompetitors = matrix.battlecards.slice(0, 6);
  const weakTopics = matrix.topicMatrix.slice(0, 5);
  return [
    {
      workstream: "Refresh high-intent pages for AI answers",
      priority: 1,
      evidence: `${topQueries.length} top query gaps, led by ${topQueries.slice(0, 3).map((row) => row.prompt).join("; ")}`,
      action: "Add query-exact quick answers, FAQ schema, product-specific comparison blocks, and clearer recommended product sections.",
      files: "query-opportunity-matrix.csv; page-refresh-queue.csv",
    },
    {
      workstream: "Build competitor displacement sections",
      priority: 2,
      evidence: `${topCompetitors[0].brand} appears without iBOLT ${topCompetitors[0].withoutIbolt} times; top six competitors account for ${topCompetitors.reduce((sum, row) => sum + row.withoutIbolt, 0)} competitor-only answer appearances.`,
      action: "Add honest comparison/tradeoff blocks against RAM, Arkon, iOttie, ProClip, Mount-It, and marine brands on matching pages.",
      files: "competitor-battlecards.csv",
    },
    {
      workstream: "Fix schema and citation structure at scale",
      priority: 3,
      evidence: `${liveAudit.summary.missingFaqSchema}/${liveAudit.summary.ok} audited pages missing FAQ schema; ${liveAudit.summary.noQuickAnswer} missing quick answers; ${liveAudit.summary.noComparisonSignals} missing comparison signals.`,
      action: "Patch generated HTML/template output and refresh existing pages in batches.",
      files: "live-blog-page-audit.merged.csv",
    },
    {
      workstream: "Clean blog inventory and product spread",
      priority: 4,
      evidence: `${blogAudit.summary.unlinkedProducts}/${blogAudit.summary.products} catalog products are not linked from detected blog content; ${blogAudit.summary.zeroDbTrackedPosts} posts have zero DB-tracked product rows.`,
      action: "Use product-spread.csv to rotate underused products into relevant posts and backfill blog_post_products rows.",
      files: "product-spread.csv; unlinked-product-opportunities.csv",
    },
    {
      workstream: "Resolve matching, duplicate, and vertical mapping issues",
      priority: 5,
      evidence: `${blogAudit.summary.unmatchedPosts} local posts did not match public audit cleanly; ${blogAudit.summary.duplicatePairs} possible duplicate/cannibalized pairs; ${blogAudit.summary.duplicateSlugs} duplicate local slug.`,
      action: "Verify Shopify handles, assign missing verticals, merge/redirect overlapping pages, and update local slug/article mappings.",
      files: "post-inventory.csv; possible-duplicate-pages.csv",
    },
    {
      workstream: "Run expanded benchmark once credentials are available",
      priority: 6,
      evidence: `Expanded benchmark backlog already contains ${expandedPromptCount} one-at-a-time prompts, but no benchmark key is available in the current process.`,
      action: "Set OPENROUTER_API_KEY in the environment and run scripts/run-expanded-openrouter-ai-benchmark.ts.",
      files: "expanded-benchmark-prompts.csv",
    },
  ];
}

function buildHtml({ stats, liveAudit, blogAudit, matrix, workstreams }) {
  const cards = [
    ["AI answers", stats.total, "consumer-model benchmark"],
    ["Mention rate", `${pct(stats.mentions, stats.total)}%`, `${stats.mentions}/${stats.total} answers`],
    ["Non-branded mention", `${pct(stats.nonBrandedMentions, stats.nonBranded)}%`, `${stats.nonBrandedMentions}/${stats.nonBranded} answers`],
    ["Top-3 rate", `${pct(stats.topThree, stats.total)}%`, `${stats.topThree}/${stats.total} answers`],
    ["Citation rate", `${pct(stats.citations, stats.total)}%`, `${stats.citations}/${stats.total} answers`],
    ["Blog pages audited", liveAudit.summary.ok, `${liveAudit.summary.avgScore}/100 avg score`],
    ["Local posts", blogAudit.summary.localPosts, `${blogAudit.summary.matchedPosts} matched to audit`],
    ["Products linked", `${blogAudit.summary.linkedProducts}/${blogAudit.summary.products}`, `${blogAudit.summary.unlinkedProductRate}% unlinked`],
  ].map(([label, value, note]) => `
    <div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div><div class="s">${escapeHtml(note)}</div></div>
  `).join("");
  const workstreamRows = workstreams.map((row) => `
    <tr><td>${row.priority}</td><td><b>${escapeHtml(row.workstream)}</b><br><span>${escapeHtml(row.evidence)}</span></td><td>${escapeHtml(row.action)}</td><td>${escapeHtml(row.files)}</td></tr>
  `).join("");
  const queryRows = matrix.queryMatrix.slice(0, 12).map((row) => `
    <tr><td>${row.opportunityScore}</td><td>${escapeHtml(row.prompt)}</td><td>${escapeHtml(row.category)}</td><td>${row.averageScore}</td><td>${row.mentionRate}%</td><td>${row.pageScore ?? "n/a"}</td><td>${escapeHtml(row.competitors.slice(0, 4).join(", "))}</td></tr>
  `).join("");
  const pageRows = matrix.pageQueue.slice(0, 12).map((row) => `
    <tr><td>${row.refreshPriority}</td><td><a href="${escapeHtml(row.url)}">${escapeHtml(row.title)}</a></td><td>${escapeHtml(row.category)}</td><td>${row.pageScore ?? "n/a"}</td><td>${escapeHtml(row.issues.slice(0, 4).join(", "))}</td></tr>
  `).join("");
  return `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT AI Visibility Executive Rollup</title>
  <style>
    :root{--ink:#111827;--muted:#64748b;--border:#d7dee8;--bg:#f8fafc;--panel:#fff}
    body{margin:0;background:var(--bg);font-family:Arial,Helvetica,sans-serif;color:var(--ink)}
    main{max-width:1260px;margin:0 auto;padding:34px 26px 64px}h1{font-size:34px;margin:0 0 10px}h2{font-size:22px;margin:34px 0 14px}p{font-size:16px;line-height:1.55;color:#334155;max-width:980px}.meta{font-size:14px;color:var(--muted)}
    .takeaway{background:#fff;border:1px solid var(--border);border-left:6px solid #2563eb;border-radius:10px;padding:16px 18px}
    .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid var(--border);border-radius:12px;padding:16px}.k{font-size:12px;color:var(--muted);letter-spacing:.06em;text-transform:uppercase;font-weight:700}.v{font-size:30px;font-weight:800;margin-top:8px}.s,td span{font-size:13px;color:var(--muted)}
    figure{background:#fff;border:1px solid var(--border);border-radius:14px;margin:14px 0;padding:10px;overflow:auto}figure img{display:block;width:100%;height:auto}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:22px}th,td{text-align:left;vertical-align:top;padding:11px 12px;border-bottom:1px solid #edf2f7;font-size:14px}th{background:#f1f5f9;color:#475569;font-size:12px;letter-spacing:.04em;text-transform:uppercase}a{color:#0f3f91}
    @media(max-width:980px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media print{body{background:#fff}main{max-width:none;padding:18px}.grid{grid-template-columns:repeat(4,1fr)}figure,.card,table{break-inside:avoid}}
  </style>
</head><body><main>
  <div class="meta">Generated from benchmark, competitor matrix, live page audit, and blog/product inventory audit</div>
  <h1>iBOLT AI Visibility Executive Rollup</h1>
  <p class="takeaway"><strong>Decision:</strong> the next work should focus on making existing high-intent pages citable and competitor-aware. iBOLT already has a meaningful content base, but broad buyer prompts still mention competitors without iBOLT, and most audited pages are missing FAQ schema or quick-answer blocks.</p>
  <section class="grid">${cards}</section>
  <h2>Charts</h2>
  <figure><img src="visibility-funnel.svg" alt="Visibility funnel"/></figure>
  <figure><img src="workstream-priority.svg" alt="Workstream priority"/></figure>
  <figure><img src="competitor-gap.svg" alt="Competitor gap"/></figure>
  <figure><img src="site-readiness-gap.svg" alt="Site readiness gap"/></figure>
  <h2>Priority Workstreams</h2>
  <table><thead><tr><th>Priority</th><th>Workstream</th><th>Action</th><th>Evidence files</th></tr></thead><tbody>${workstreamRows}</tbody></table>
  <h2>Top Query Gaps</h2>
  <table><thead><tr><th>Opp.</th><th>Prompt</th><th>Topic</th><th>AI score</th><th>Mention</th><th>Page score</th><th>Competitors</th></tr></thead><tbody>${queryRows}</tbody></table>
  <h2>Top Page Refreshes</h2>
  <table><thead><tr><th>Priority</th><th>Page</th><th>Topic</th><th>Score</th><th>Fixes</th></tr></thead><tbody>${pageRows}</tbody></table>
</main></body></html>`;
}

function buildMarkdown({ stats, liveAudit, blogAudit, matrix, workstreams }) {
  const workstreamLines = workstreams.map((row) =>
    `| ${row.priority} | ${row.workstream} | ${row.evidence} | ${row.action} |`
  ).join("\n");
  return `# iBOLT AI Visibility Executive Rollup

## Scorecard

- AI answers tested: ${stats.total}
- iBOLT mentions: ${stats.mentions}/${stats.total} (${pct(stats.mentions, stats.total)}%)
- Non-branded mentions: ${stats.nonBrandedMentions}/${stats.nonBranded} (${pct(stats.nonBrandedMentions, stats.nonBranded)}%)
- Top-3 recommendation rate: ${stats.topThree}/${stats.total} (${pct(stats.topThree, stats.total)}%)
- Citation rate: ${stats.citations}/${stats.total} (${pct(stats.citations, stats.total)}%)
- Audited blog pages: ${liveAudit.summary.ok}/${liveAudit.summary.total}
- Average AI-citability page score: ${liveAudit.summary.avgScore}/100
- Local blog posts: ${blogAudit.summary.localPosts}
- Products linked from blogs: ${blogAudit.summary.linkedProducts}/${blogAudit.summary.products}
- Unlinked products: ${blogAudit.summary.unlinkedProducts} (${blogAudit.summary.unlinkedProductRate}%)

## Recommendation

The next work should focus on existing high-intent pages, not just new blog volume. Add quick answers, FAQ schema, comparison/tradeoff blocks, and better product-specific citation structure to the pages already mapped to buyer prompts. Then broaden product coverage and clean duplicated or unmapped posts.

## Priority Workstreams

| Priority | Workstream | Evidence | Action |
| ---: | --- | --- | --- |
${workstreamLines}

## Top Competitor Gap

${matrix.battlecards.slice(0, 8).map((row) => `- ${row.brand}: ${row.withoutIbolt} answers mention them without iBOLT; co-mention rate ${row.coMentionRate}%.`).join("\n")}

## Top Query Gaps

${matrix.queryMatrix.slice(0, 10).map((row) => `- ${row.prompt}: opportunity ${row.opportunityScore}, AI score ${row.averageScore}, mention ${row.mentionRate}%, competitors ${row.competitors.slice(0, 4).join(", ")}.`).join("\n")}
`;
}

async function main() {
  const benchmarkDir = process.argv[2] ? path.resolve(process.argv[2]) : await latestDir(BENCHMARK_PREFIX);
  const auditDir = process.argv[3] ? path.resolve(process.argv[3]) : await latestDir(AUDIT_PREFIX);
  const matrix = JSON.parse(await readFile(path.join(benchmarkDir, "competitive-matrix", "competitive-matrix-data.json"), "utf8"));
  const blogAudit = JSON.parse(await readFile(path.join(benchmarkDir, "blog-inventory-audit", "blog-inventory-audit-data.json"), "utf8"));
  const liveAudit = JSON.parse(await readFile(path.join(auditDir, "live-blog-page-audit.merged.json"), "utf8"));
  const expandedPrompts = JSON.parse(await readFile(path.join(benchmarkDir, "deep-dive", "expanded-benchmark-prompts.json"), "utf8"));
  const expandedPromptCount = expandedPrompts.length;
  const stats = matrix.stats;
  const workstreams = buildWorkstreams({ matrix, blogAudit, liveAudit, expandedPromptCount });
  const outDir = path.join(benchmarkDir, "executive-rollup");
  await mkdir(outDir, { recursive: true });

  await writeFile(path.join(outDir, "workstreams.csv"), csv([
    ["priority", "workstream", "evidence", "action", "files"],
    ...workstreams.map((row) => [row.priority, row.workstream, row.evidence, row.action, row.files]),
  ]));
  await writeFile(path.join(outDir, "executive-rollup-data.json"), JSON.stringify({
    stats,
    expandedPromptCount,
    liveAuditSummary: liveAudit.summary,
    blogAuditSummary: blogAudit.summary,
    workstreams,
    topCompetitors: matrix.battlecards.slice(0, 10),
    topQueries: matrix.queryMatrix.slice(0, 16),
    topPages: matrix.pageQueue.slice(0, 16),
  }, null, 2));

  await writeSvgAndPng(outDir, "visibility-funnel", funnelChart(stats));
  await writeSvgAndPng(outDir, "workstream-priority", barChart({
    title: "Priority Workstreams",
    subtitle: "Score is inverse priority, only for visual ordering.",
    rows: workstreams.map((row) => ({
      label: row.workstream,
      value: 110 - row.priority * 12,
      note: row.evidence,
      display: `P${row.priority}`,
    })),
    color: "#7c3aed",
    maxValue: 100,
  }));
  await writeSvgAndPng(outDir, "competitor-gap", barChart({
    title: "Competitor Displacement Gap",
    subtitle: "Answers where competitor appeared and iBOLT did not.",
    rows: matrix.battlecards.slice(0, 12).map((row) => ({
      label: row.brand,
      value: row.withoutIbolt,
      note: `${row.type}; co-mention ${row.coMentionRate}%`,
    })),
    color: "#dc2626",
  }));
  await writeSvgAndPng(outDir, "site-readiness-gap", barChart({
    title: "Site Readiness Gaps",
    subtitle: "Structural and inventory issues blocking better AI citation readiness.",
    rows: [
      { label: "Missing FAQ schema", value: liveAudit.summary.missingFaqSchema, note: `${pct(liveAudit.summary.missingFaqSchema, liveAudit.summary.ok)}% of audited pages` },
      { label: "Missing quick-answer block", value: liveAudit.summary.noQuickAnswer, note: `${pct(liveAudit.summary.noQuickAnswer, liveAudit.summary.ok)}% of audited pages` },
      { label: "Missing comparison/tradeoff signals", value: liveAudit.summary.noComparisonSignals, note: `${pct(liveAudit.summary.noComparisonSignals, liveAudit.summary.ok)}% of audited pages` },
      { label: "Unlinked catalog products", value: blogAudit.summary.unlinkedProducts, note: `${blogAudit.summary.unlinkedProductRate}% of catalog products` },
      { label: "Posts not matched to audit", value: blogAudit.summary.unmatchedPosts, note: "Needs URL/sitemap/admin verification" },
    ],
    color: "#f97316",
    maxValue: Math.max(blogAudit.summary.unlinkedProducts, liveAudit.summary.ok),
  }));

  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown({ stats, liveAudit, blogAudit, matrix, workstreams }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({ stats, liveAudit, blogAudit, matrix, workstreams }));
  console.log(path.relative(process.cwd(), outDir));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
