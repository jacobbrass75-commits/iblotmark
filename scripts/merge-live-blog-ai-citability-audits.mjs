import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const SOURCE_PREFIX = "live-blog-ai-citability-20";
const MERGED_PREFIX = "live-blog-ai-citability-merged-";

function stamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

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

function mdTable(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map((cell) => String(cell ?? "").replace(/\|/g, "\\|")).join(" | ")} |`),
  ].join("\n");
}

function normalizeSource(row) {
  if (row.source) return row.source;
  if (row.status === "ok") return "public";
  return row.status || "unknown";
}

function quality(row) {
  if (!row || row.status === "failed") return 0;
  const source = normalizeSource(row);
  const sourceRank = source === "public" ? 3 : source === "local_db_fallback" ? 2 : 1;
  return sourceRank * 1000 + Number(row.aiCitabilityScore || 0);
}

function summarize(rows) {
  const okRows = rows.filter((row) => row.status !== "failed");
  const avgScore = Math.round(okRows.reduce((sum, row) => sum + Number(row.aiCitabilityScore || 0), 0) / Math.max(1, okRows.length));
  const byCategory = new Map();
  for (const row of okRows) {
    const category = row.category || "unknown";
    const bucket = byCategory.get(category) || { category, count: 0, avgScore: 0 };
    bucket.count += 1;
    bucket.avgScore += Number(row.aiCitabilityScore || 0);
    byCategory.set(category, bucket);
  }
  const categories = [...byCategory.values()]
    .map((bucket) => ({ ...bucket, avgScore: Math.round(bucket.avgScore / Math.max(1, bucket.count)) }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));

  return {
    total: rows.length,
    ok: okRows.length,
    failed: rows.length - okRows.length,
    publicFetched: okRows.filter((row) => normalizeSource(row) === "public").length,
    localFallback: okRows.filter((row) => normalizeSource(row) === "local_db_fallback").length,
    avgScore,
    missingFaqSchema: okRows.filter((row) => !row.hasFaqSchema).length,
    missingArticleSchema: okRows.filter((row) => !row.hasArticleSchema && !row.hasBlogPostingSchema).length,
    noProductLinks: okRows.filter((row) => Number(row.productLinks || 0) === 0).length,
    noQuickAnswer: okRows.filter((row) => !row.hasQuickAnswer).length,
    noComparisonSignals: okRows.filter((row) => !row.hasComparisonSignals).length,
    categories,
    lowest: [...okRows].sort((a, b) => Number(a.aiCitabilityScore || 0) - Number(b.aiCitabilityScore || 0)).slice(0, 25),
    unavailable: rows.filter((row) => row.status === "failed"),
  };
}

function barChart({ title, subtitle, rows, color = "#2563eb", width = 1160 }) {
  const rowH = 44;
  const height = 128 + rows.length * rowH + 34;
  const left = 470;
  const barW = width - left - 125;
  const top = 108;
  const max = Math.max(1, ...rows.map((row) => Number(row.value || 0)));
  const bars = rows.map((row, index) => {
    const y = top + index * rowH;
    const w = Math.max(Number(row.value || 0) > 0 ? 4 : 0, Math.round((Number(row.value || 0) / max) * barW));
    return `
      <text class="label" x="52" y="${y + 15}">${escapeHtml(row.label)}</text>
      <text class="small" x="52" y="${y + 33}">${escapeHtml(row.note || "")}</text>
      <rect x="${left}" y="${y}" width="${barW}" height="24" rx="8" fill="#e2e8f0"/>
      <rect x="${left}" y="${y}" width="${w}" height="24" rx="8" fill="${color}"/>
      <text class="value" x="${left + barW + 14}" y="${y + 17}">${escapeHtml(row.display ?? row.value)}</text>
    `;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    .bg{fill:#f8fafc}.panel{fill:#fff;stroke:#d7dee8;stroke-width:1}.title{font:700 24px Arial,sans-serif;fill:#111827}.subtitle{font:400 14px Arial,sans-serif;fill:#64748b}.label{font:700 13px Arial,sans-serif;fill:#111827}.small{font:400 12px Arial,sans-serif;fill:#475569}.value{font:700 13px Arial,sans-serif;fill:#0f172a}
  </style>
  <rect class="bg" width="${width}" height="${height}"/>
  <rect class="panel" x="28" y="24" width="${width - 56}" height="${height - 48}" rx="14"/>
  <text class="title" x="52" y="64">${escapeHtml(title)}</text>
  <text class="subtitle" x="52" y="87">${escapeHtml(subtitle)}</text>
  ${bars}
</svg>`;
}

function buildMarkdown(summary, sourceDirs) {
  const unavailableSection = summary.unavailable.length
    ? `These URLs are in the live sitemap but returned only failed automated fetches in the available audit runs, mostly Shopify verification or rate-limit responses. They should be spot-checked in-browser or re-crawled slowly before treating them as content-quality failures.

${mdTable(
  ["URL", "Last error"],
  summary.unavailable.slice(0, 40).map((row) => [`[${row.url}](${row.url})`, String(row.error || "").slice(0, 120)]),
)}`
    : "No sitemap URLs remain unavailable after the merged crawl and slow retry.";

  return `# Merged Live Blog AI-Citability Audit

This report merges ${sourceDirs.length} crawl attempts and keeps the best available row for each sitemap URL. Public HTML rows are preferred over local DB fallbacks; failed rows are retained only when no successful audit exists for that URL.

## Summary

- Pages in sitemap: ${summary.total}
- Pages successfully audited: ${summary.ok}/${summary.total}
- Public HTML fetches used: ${summary.publicFetched}
- Local DB fallbacks used: ${summary.localFallback}
- Still unavailable after merged crawls: ${summary.failed}
- Average AI-citability score: ${summary.avgScore}/100

## Most Common Issues

${mdTable(
  ["Issue", "Pages affected"],
  [
    ["No FAQ schema", summary.missingFaqSchema],
    ["No Article/BlogPosting schema", summary.missingArticleSchema],
    ["No direct product links", summary.noProductLinks],
    ["No quick-answer block", summary.noQuickAnswer],
    ["No comparison/tradeoff signals", summary.noComparisonSignals],
  ],
)}

## Topic Inventory

${mdTable(
  ["Topic", "Pages", "Avg AI-citability score"],
  summary.categories.map((row) => [row.category, row.count, row.avgScore]),
)}

## Lowest-Scoring Audited Pages

${mdTable(
  ["Score", "Title", "Topic", "Source", "Top fix"],
  summary.lowest.slice(0, 20).map((row) => [
    row.aiCitabilityScore,
    `[${row.title || row.url}](${row.url})`,
    row.category,
    normalizeSource(row),
    row.recommendedFixes?.[0] || "Monitor",
  ]),
)}

## Still Unavailable

${unavailableSection}
`;
}

function buildHtml(summary) {
  const cards = [
    ["Sitemap URLs", summary.total],
    ["Audited", `${summary.ok}/${summary.total}`],
    ["Avg score", `${summary.avgScore}`],
    ["Public rows", summary.publicFetched],
    ["DB fallback", summary.localFallback],
    ["Unavailable", summary.failed],
    ["Missing FAQ schema", summary.missingFaqSchema],
    ["Missing quick answer", summary.noQuickAnswer],
    ["Missing comparison", summary.noComparisonSignals],
  ].map(([label, value]) => `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div></div>`).join("");
  const lowRows = summary.lowest.slice(0, 25).map((row) => `
    <tr>
      <td>${escapeHtml(row.aiCitabilityScore)}</td>
      <td><a href="${escapeHtml(row.url)}">${escapeHtml(row.title || row.url)}</a></td>
      <td>${escapeHtml(row.category)}</td>
      <td>${escapeHtml(normalizeSource(row))}</td>
      <td>${escapeHtml(row.recommendedFixes?.[0] || "Monitor")}</td>
    </tr>`).join("");
  const failedRows = summary.unavailable.slice(0, 40).map((row) => `
    <tr>
      <td><a href="${escapeHtml(row.url)}">${escapeHtml(row.url)}</a></td>
      <td>${escapeHtml(String(row.error || "").slice(0, 180))}</td>
    </tr>`).join("");
  const unavailableHtml = summary.unavailable.length
    ? `<table><thead><tr><th>URL</th><th>Last automated fetch error</th></tr></thead><tbody>${failedRows}</tbody></table>`
    : `<p class="note"><strong>No unavailable pages remain.</strong> The merged crawl and slow retry covered every URL in the blog sitemap.</p>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Merged Live Blog AI-Citability Audit</title>
<style>
body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}main{max-width:1220px;margin:0 auto;padding:34px 26px 60px}h1{font-size:34px;margin:0 0 8px}h2{font-size:22px;margin:34px 0 14px}p{color:#334155;line-height:1.55}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}.k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700}.v{font-size:30px;font-weight:800;margin-top:8px}figure{background:#fff;border:1px solid #d7dee8;border-radius:14px;margin:14px 0;padding:10px;overflow:auto}figure img{display:block;width:100%;height:auto}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden}th,td{text-align:left;vertical-align:top;padding:11px 12px;border-bottom:1px solid #edf2f7;font-size:14px}th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:12px;letter-spacing:.04em}a{color:#1d4ed8}.note{border-left:6px solid #2563eb;background:#fff;border-radius:10px;padding:16px 18px;border-top:1px solid #d7dee8;border-right:1px solid #d7dee8;border-bottom:1px solid #d7dee8}
</style></head><body><main>
<h1>Merged Live Blog AI-Citability Audit</h1>
<p class="note"><strong>Readout:</strong> This unioned audit separates real content issues from crawl availability. The audited pages still need FAQ schema, quick-answer blocks, and comparison language to improve AI citation and recommendation odds.</p>
<section class="cards">${cards}</section>
<h2>Charts</h2>
<figure><img src="lowest-pages.svg" alt="Lowest-scoring audited pages"/></figure>
<figure><img src="topic-scores.svg" alt="Topic scores"/></figure>
<h2>Lowest-Scoring Audited Pages</h2>
<table><thead><tr><th>Score</th><th>Title</th><th>Topic</th><th>Source</th><th>Top fix</th></tr></thead><tbody>${lowRows}</tbody></table>
<h2>Still Unavailable</h2>
${unavailableHtml}
</main></body></html>`;
}

async function loadSourceDirs() {
  const entries = await readdir(path.join(process.cwd(), OUTPUT_ROOT), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(SOURCE_PREFIX) && !entry.name.startsWith(MERGED_PREFIX))
    .map((entry) => path.join(process.cwd(), OUTPUT_ROOT, entry.name))
    .sort();
}

async function main() {
  const sourceDirs = await loadSourceDirs();
  if (!sourceDirs.length) throw new Error(`No ${SOURCE_PREFIX} audit directories found.`);

  const historyRows = [];
  const byUrl = new Map();
  for (const sourceDir of sourceDirs) {
    const filePath = path.join(sourceDir, "live-blog-page-audit.json");
    let data;
    try {
      data = JSON.parse(await readFile(filePath, "utf8"));
    } catch {
      continue;
    }
    for (const row of data.rows || []) {
      const normalized = { ...row, source: normalizeSource(row), auditDir: path.basename(sourceDir) };
      const url = normalized.url;
      if (!url) continue;
      historyRows.push(normalized);
      const previous = byUrl.get(url);
      if (!previous || quality(normalized) > quality(previous)) {
        byUrl.set(url, normalized);
      }
    }
  }

  const rows = [...byUrl.values()].sort((a, b) => a.url.localeCompare(b.url));
  const summary = summarize(rows);
  const outputDir = path.join(process.cwd(), OUTPUT_ROOT, `${MERGED_PREFIX}${stamp()}`);
  await mkdir(outputDir, { recursive: true });

  await writeFile(path.join(outputDir, "live-blog-page-audit.merged.json"), JSON.stringify({ summary, rows, sourceDirs: sourceDirs.map((dir) => path.basename(dir)) }, null, 2));
  await writeFile(path.join(outputDir, "live-blog-page-audit.merged.csv"), csv([
    [
      "score", "url", "title", "category", "status", "source", "audit_dir", "word_count", "product_links",
      "collection_links", "has_quick_answer", "has_faq_schema", "has_article_schema", "has_comparison_signals",
      "images", "missing_alt", "ibolt_mentions", "competitor_brands", "top_fixes", "error",
    ],
    ...rows.map((row) => [
      row.aiCitabilityScore,
      row.url,
      row.title,
      row.category,
      row.status,
      normalizeSource(row),
      row.auditDir,
      row.wordCount,
      row.productLinks,
      row.collectionLinks,
      row.hasQuickAnswer,
      row.hasFaqSchema,
      row.hasArticleSchema || row.hasBlogPostingSchema,
      row.hasComparisonSignals,
      row.images,
      row.missingAlt,
      row.iboltMentions,
      row.competitorBrands || [],
      row.recommendedFixes || [],
      row.error || row.publicFetchError || "",
    ]),
  ]));
  await writeFile(path.join(outputDir, "unavailable-live-pages.csv"), csv([
    ["url", "last_error"],
    ...summary.unavailable.map((row) => [row.url, row.error || row.publicFetchError || ""]),
  ]));
  await writeFile(
    path.join(outputDir, "unavailable-live-pages.txt"),
    summary.unavailable.map((row) => row.url).join("\n") + (summary.unavailable.length ? "\n" : ""),
  );
  await writeFile(path.join(outputDir, "live-blog-audit-run-history.csv"), csv([
    ["url", "audit_dir", "status", "source", "score", "title", "error"],
    ...historyRows.map((row) => [row.url, row.auditDir, row.status, normalizeSource(row), row.aiCitabilityScore, row.title, row.error || row.publicFetchError || ""]),
  ]));
  await writeFile(path.join(outputDir, "REPORT.md"), buildMarkdown(summary, sourceDirs));
  await writeFile(path.join(outputDir, "REPORT.html"), buildHtml(summary));
  await writeFile(path.join(outputDir, "lowest-pages.svg"), barChart({
    title: "Lowest AI-Citability Scores",
    subtitle: "Merged audit, best successful row per URL.",
    color: "#dc2626",
    rows: summary.lowest.slice(0, 16).map((row) => ({
      label: row.title || row.url,
      note: `${row.category || "unknown"} | ${normalizeSource(row)}`,
      value: 100 - Number(row.aiCitabilityScore || 0),
      display: row.aiCitabilityScore,
    })),
  }));
  await writeFile(path.join(outputDir, "topic-scores.svg"), barChart({
    title: "Audited Blog Topic Inventory",
    subtitle: "Bar length is page count; labels show average AI-citability score.",
    color: "#16a34a",
    rows: summary.categories.map((row) => ({
      label: row.category,
      note: `${row.count} audited pages`,
      value: row.count,
      display: row.avgScore,
    })),
  }));

  console.log(outputDir);
  console.log(`Audited ${summary.ok}/${summary.total}; unavailable ${summary.failed}; avg ${summary.avgScore}/100.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
