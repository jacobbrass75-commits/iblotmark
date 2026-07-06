import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";

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
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (cell.length || row.length) row.push(cell);
  if (row.length) rows.push(row);
  if (!rows.length) return [];
  const [headers, ...records] = rows;
  return records
    .filter((record) => record.some((value) => String(value ?? "").trim()))
    .map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""])));
}

async function readCsv(filePath) {
  try {
    return parseCsv(await readFile(filePath, "utf8"));
  } catch {
    return [];
  }
}

async function latestDir(prefix) {
  const entries = await readdir(path.join(process.cwd(), OUTPUT_ROOT), { withFileTypes: true });
  const match = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  if (!match) throw new Error(`No ${prefix} directory found in ${OUTPUT_ROOT}`);
  return path.join(process.cwd(), OUTPUT_ROOT, match);
}

function num(value) {
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .flatMap((part) => part.split("|"))
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeTitle(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\b20\d{2}\b/g, "")
    .replace(/\baeo refresh\b/g, "")
    .replace(/\bguide\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isExactDuplicatePair(row) {
  const canonical = normalizeTitle(row.canonical_title);
  const duplicate = normalizeTitle(row.duplicate_title);
  if (!canonical || !duplicate) return false;
  if (canonical === duplicate) return true;
  const duplicateUrl = String(row.duplicate_url || "");
  const canonicalUrl = String(row.canonical_url || "");
  if (duplicateUrl === `${canonicalUrl}-1`) return true;
  return num(row.duplicate_score) >= 98 && (canonical.includes(duplicate) || duplicate.includes(canonical));
}

function top(rows, key, count = 12) {
  return [...rows].sort((a, b) => num(b[key]) - num(a[key]) || String(a.recommended_survivor_title || "").localeCompare(String(b.recommended_survivor_title || ""))).slice(0, count);
}

class UnionFind {
  constructor() {
    this.parent = new Map();
  }

  find(value) {
    if (!this.parent.has(value)) this.parent.set(value, value);
    const parent = this.parent.get(value);
    if (parent === value) return value;
    const root = this.find(parent);
    this.parent.set(value, root);
    return root;
  }

  union(a, b) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootB, rootA);
  }
}

function titleFor(url, maps, fallback = "") {
  return maps.triageByUrl.get(url)?.title
    || maps.pageActionByUrl.get(url)?.page_title
    || maps.postActionByUrl.get(url)?.title
    || maps.productByUrl.get(url)?.page_title
    || fallback;
}

function pageScoreFor(url, maps, fallback = 0) {
  return num(maps.triageByUrl.get(url)?.ai_citability_score)
    || num(maps.pageActionByUrl.get(url)?.avg_page_score)
    || num(maps.postActionByUrl.get(url)?.ai_citability_score)
    || num(fallback);
}

function pressureFor(url, maps) {
  return num(maps.pageActionByUrl.get(url)?.priority);
}

function queryCountFor(url, maps) {
  return num(maps.pageActionByUrl.get(url)?.query_count);
}

function zeroMentionFor(url, maps) {
  return num(maps.pageActionByUrl.get(url)?.zero_mention_queries);
}

function competitorOnlyFor(url, maps) {
  return num(maps.pageActionByUrl.get(url)?.competitor_only_answers);
}

function bestMember(urls, maps, canonicalVotes) {
  return [...urls].sort((a, b) => {
    const aVote = canonicalVotes.get(a) ?? 0;
    const bVote = canonicalVotes.get(b) ?? 0;
    if (aVote !== bVote) return bVote - aVote;
    const aPressure = pressureFor(a, maps);
    const bPressure = pressureFor(b, maps);
    if (aPressure !== bPressure) return bPressure - aPressure;
    const aScore = pageScoreFor(a, maps);
    const bScore = pageScoreFor(b, maps);
    if (aScore !== bScore) return bScore - aScore;
    return a.localeCompare(b);
  })[0];
}

function buildClusterRows({ duplicateRows, maps }) {
  const uf = new UnionFind();
  const pairByUrl = new Map();
  const canonicalVotes = new Map();

  for (const row of duplicateRows) {
    const canonicalUrl = row.canonical_url;
    const duplicateUrl = row.duplicate_url;
    if (!canonicalUrl || !duplicateUrl) continue;
    uf.union(canonicalUrl, duplicateUrl);
    canonicalVotes.set(canonicalUrl, (canonicalVotes.get(canonicalUrl) ?? 0) + 1 + num(row.canonical_score) / 100);
    for (const url of [canonicalUrl, duplicateUrl]) {
      if (!pairByUrl.has(url)) pairByUrl.set(url, []);
      pairByUrl.get(url).push(row);
    }
  }

  const grouped = new Map();
  for (const row of duplicateRows) {
    for (const url of [row.canonical_url, row.duplicate_url]) {
      if (!url) continue;
      const root = uf.find(url);
      if (!grouped.has(root)) grouped.set(root, new Set());
      grouped.get(root).add(url);
    }
  }

  return [...grouped.values()].map((urlSet) => {
    const urls = [...urlSet];
    const survivorUrl = bestMember(urls, maps, canonicalVotes);
    const mergeFromUrls = urls.filter((url) => url !== survivorUrl);
    const rows = urls.flatMap((url) => pairByUrl.get(url) || []);
    const duplicateScore = Math.max(...rows.map((row) => num(row.duplicate_score)), 0);
    const benchmarkPressureUrl = [...urls].sort((a, b) => pressureFor(b, maps) - pressureFor(a, maps))[0];
    const benchmarkPressure = urls.reduce((sum, url) => sum + pressureFor(url, maps), 0);
    const queryCount = urls.reduce((sum, url) => sum + queryCountFor(url, maps), 0);
    const zeroMentionQueries = urls.reduce((sum, url) => sum + zeroMentionFor(url, maps), 0);
    const competitorOnly = urls.reduce((sum, url) => sum + competitorOnlyFor(url, maps), 0);
    const issues = unique(urls.flatMap((url) => splitList(maps.triageByUrl.get(url)?.issues || maps.pageActionByUrl.get(url)?.issues)));
    const competitors = unique(urls.flatMap((url) => splitList(maps.pageActionByUrl.get(url)?.competitors || maps.triageByUrl.get(url)?.competitor_brands)));
    const prompts = unique(urls.flatMap((url) => splitList(maps.pageActionByUrl.get(url)?.retest_prompts)));
    const productModules = unique(urls.map((url) => maps.pageActionByUrl.get(url)?.product_module || maps.productByUrl.get(url)?.product_module).filter(Boolean));
    const categories = unique(urls.map((url) => maps.triageByUrl.get(url)?.category || maps.pageActionByUrl.get(url)?.category || maps.postActionByUrl.get(url)?.topic).filter(Boolean));
    const scoreGap = Math.max(...urls.map((url) => pageScoreFor(url, maps)), 0) - Math.min(...urls.map((url) => pageScoreFor(url, maps)).filter((value) => value > 0), 0);
    const survivorNeedsConfirm = benchmarkPressureUrl && benchmarkPressureUrl !== survivorUrl && pressureFor(benchmarkPressureUrl, maps) > 0;
    const aeoRefreshInCluster = urls.some((url) => url.includes("aeo-refresh"));
    const priority = Math.round(duplicateScore + benchmarkPressure + zeroMentionQueries * 18 + competitorOnly * 12 + issues.length * 3 + (survivorNeedsConfirm ? 25 : 0));

    return {
      priority,
      duplicate_score: duplicateScore,
      category: categories.join("; "),
      recommended_survivor_title: titleFor(survivorUrl, maps, rows[0]?.canonical_title),
      recommended_survivor_url: survivorUrl,
      merge_from_titles: mergeFromUrls.map((url) => titleFor(url, maps, rows[0]?.duplicate_title)).join("; "),
      merge_from_urls: mergeFromUrls.join("; "),
      benchmark_pressure_url: benchmarkPressureUrl || "",
      benchmark_pressure_title: benchmarkPressureUrl ? titleFor(benchmarkPressureUrl, maps) : "",
      benchmark_pressure: benchmarkPressure,
      query_count: queryCount,
      zero_mention_queries: zeroMentionQueries,
      competitor_only_answers: competitorOnly,
      prompts_to_preserve: prompts.join("; "),
      competitors_to_cover: competitors.join("; "),
      product_modules_to_keep: productModules[0] || "",
      missing_structure: issues.join("; "),
      survivor_review_flag: survivorNeedsConfirm ? "confirm survivor, benchmark pressure is on another URL" : (aeoRefreshInCluster ? "confirm AEO refresh URL policy" : ""),
      redirect_action: `Merge useful unique content into ${survivorUrl}, then redirect or unpublish ${mergeFromUrls.join("; ")} if Shopify/admin policy allows.`,
      retest_action: prompts.length ? `After consolidation, rerun: ${prompts.join("; ")}.` : "After consolidation, rerun affected category prompts.",
      score_gap: scoreGap,
      cluster_size: urls.length,
    };
  }).sort((a, b) => b.priority - a.priority || a.recommended_survivor_title.localeCompare(b.recommended_survivor_title));
}

function buildPairReviewRows({ duplicateRows, maps }) {
  return duplicateRows.map((row) => {
    const urls = [row.canonical_url, row.duplicate_url].filter(Boolean);
    const canonicalVotes = new Map([[row.canonical_url, 1 + num(row.canonical_score) / 100]]);
    const survivorUrl = bestMember(urls, maps, canonicalVotes);
    const mergeFromUrls = urls.filter((url) => url !== survivorUrl);
    const benchmarkPressureUrl = [...urls].sort((a, b) => pressureFor(b, maps) - pressureFor(a, maps))[0];
    const benchmarkPressure = urls.reduce((sum, url) => sum + pressureFor(url, maps), 0);
    const queryCount = urls.reduce((sum, url) => sum + queryCountFor(url, maps), 0);
    const zeroMentionQueries = urls.reduce((sum, url) => sum + zeroMentionFor(url, maps), 0);
    const competitorOnly = urls.reduce((sum, url) => sum + competitorOnlyFor(url, maps), 0);
    const issues = unique(urls.flatMap((url) => splitList(maps.triageByUrl.get(url)?.issues || maps.pageActionByUrl.get(url)?.issues)));
    const competitors = unique(urls.flatMap((url) => splitList(maps.pageActionByUrl.get(url)?.competitors || maps.triageByUrl.get(url)?.competitor_brands)));
    const prompts = unique(urls.flatMap((url) => splitList(maps.pageActionByUrl.get(url)?.retest_prompts)));
    const productModules = unique(urls.map((url) => maps.pageActionByUrl.get(url)?.product_module || maps.productByUrl.get(url)?.product_module).filter(Boolean));
    const categories = unique(urls.map((url) => maps.triageByUrl.get(url)?.category || maps.pageActionByUrl.get(url)?.category || maps.postActionByUrl.get(url)?.topic || row.category).filter(Boolean));
    const survivorNeedsConfirm = benchmarkPressureUrl && benchmarkPressureUrl !== survivorUrl && pressureFor(benchmarkPressureUrl, maps) > 0;
    const priority = Math.round(num(row.duplicate_score) + benchmarkPressure + zeroMentionQueries * 18 + competitorOnly * 12 + issues.length * 3 + 35);

    return {
      priority,
      consolidation_type: "canonical family review",
      duplicate_score: row.duplicate_score,
      category: categories.join("; "),
      recommended_survivor_title: titleFor(survivorUrl, maps, row.canonical_title),
      recommended_survivor_url: survivorUrl,
      merge_from_titles: mergeFromUrls.map((url) => titleFor(url, maps, row.duplicate_title)).join("; "),
      merge_from_urls: mergeFromUrls.join("; "),
      benchmark_pressure_url: benchmarkPressureUrl || "",
      benchmark_pressure_title: benchmarkPressureUrl ? titleFor(benchmarkPressureUrl, maps) : "",
      benchmark_pressure: benchmarkPressure,
      query_count: queryCount,
      zero_mention_queries: zeroMentionQueries,
      competitor_only_answers: competitorOnly,
      prompts_to_preserve: prompts.join("; "),
      competitors_to_cover: competitors.join("; "),
      product_modules_to_keep: productModules[0] || "",
      missing_structure: issues.join("; "),
      survivor_review_flag: survivorNeedsConfirm ? "manual review, benchmark pressure is on another URL" : "manual review, topic family not exact duplicate",
      redirect_action: "Do not auto-redirect. Confirm whether this should be a hub/supporting-page relationship, content merge, canonical tag, internal link, or redirect.",
      retest_action: prompts.length ? `After the canonical decision, rerun: ${prompts.join("; ")}.` : "After the canonical decision, rerun affected category prompts.",
      score_gap: Math.abs(num(row.canonical_score) - num(row.duplicate_score_page)),
      cluster_size: urls.length,
    };
  });
}

function buildRedirectRows(clusterRows) {
  const rows = [];
  for (const cluster of clusterRows) {
    for (const url of splitList(cluster.merge_from_urls)) {
      rows.push({
        consolidation_type: cluster.consolidation_type,
        from_url: url,
        to_url: cluster.recommended_survivor_url,
        survivor_title: cluster.recommended_survivor_title,
        priority: cluster.priority,
        review_flag: cluster.survivor_review_flag,
        action: cluster.consolidation_type === "safe duplicate redirect"
          ? "301 redirect or unpublish duplicate after content merge, depending on Shopify/admin policy."
          : "Manual review before any redirect. Consider hub/supporting-page structure if both pages have distinct intent.",
      });
    }
  }
  return rows;
}

function rowsToCsv(records, headers) {
  return csv([
    headers,
    ...records.map((row) => headers.map((header) => row[header] ?? "")),
  ]);
}

function barSvg({ title, rows, labelKey, valueKey, maxValue, color = "#1d4ed8" }) {
  const width = 940;
  const rowHeight = 34;
  const topOffset = 56;
  const height = topOffset + rows.length * rowHeight + 24;
  const labelWidth = 390;
  const barWidth = 390;
  const max = maxValue || Math.max(1, ...rows.map((row) => num(row[valueKey])));
  const bars = rows.map((row, index) => {
    const value = num(row[valueKey]);
    const y = topOffset + index * rowHeight;
    const w = Math.max(2, Math.round((value / max) * barWidth));
    return `<text x="22" y="${y + 16}" fill="#0f172a" font-size="13">${escapeHtml(row[labelKey]).slice(0, 58)}</text>
<rect x="${labelWidth}" y="${y}" width="${barWidth}" height="20" rx="4" fill="#e2e8f0"/>
<rect x="${labelWidth}" y="${y}" width="${w}" height="20" rx="4" fill="${color}"/>
<text x="${labelWidth + barWidth + 12}" y="${y + 15}" fill="#0f172a" font-size="13" font-weight="700">${escapeHtml(value)}</text>`;
  }).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="#ffffff"/>
<text x="22" y="34" fill="#0f172a" font-size="22" font-weight="800">${escapeHtml(title)}</text>
${bars}
</svg>`;
}

function makeMarkdown({ clusterRows, redirectRows }) {
  const reviewCount = clusterRows.filter((row) => row.survivor_review_flag).length;
  const pressuredCount = clusterRows.filter((row) => num(row.benchmark_pressure) > 0).length;
  const exactCount = clusterRows.filter((row) => row.consolidation_type === "safe duplicate redirect").length;
  const familyCount = clusterRows.filter((row) => row.consolidation_type === "canonical family review").length;

  return `# iBOLT Canonical Consolidation Plan

## What This Adds

This turns duplicate and canonical-risk blog pages into an execution queue. It prioritizes duplicates by AI benchmark pressure, not title similarity alone, so we do not rewrite or redirect pages in a way that loses the URL currently mapped to weak AI answers.

## Summary

- Duplicate clusters: ${clusterRows.length}.
- Safe duplicate redirect clusters: ${exactCount}.
- Canonical family review rows: ${familyCount}.
- Redirect/unpublish candidates: ${redirectRows.length}.
- Clusters with benchmark query pressure: ${pressuredCount}.
- Clusters needing survivor confirmation: ${reviewCount}.

## Highest-Priority Consolidations

| Priority | Type | Survivor | Merge From | Benchmark Prompts | Competitors | Review Flag |
| ---: | --- | --- | --- | --- | --- | --- |
${top(clusterRows, "priority", 14).map((row) => `| ${row.priority} | ${row.consolidation_type} | [${row.recommended_survivor_title}](${row.recommended_survivor_url}) | ${row.merge_from_titles} | ${row.prompts_to_preserve} | ${row.competitors_to_cover} | ${row.survivor_review_flag} |`).join("\n")}

## Redirect Map

| Priority | Type | From | To | Review |
| ---: | --- | --- | --- | --- |
${top(redirectRows, "priority", 20).map((row) => `| ${row.priority} | ${row.consolidation_type} | ${row.from_url} | ${row.to_url} | ${row.review_flag} |`).join("\n")}

## Execution Rules

1. Confirm the survivor URL before editing when the review flag is present.
2. Merge the stronger answer blocks, product modules, FAQs, comparison sections, and images into the survivor page.
3. Preserve the prompts listed in the queue as exact quick-answer sections or FAQ questions where natural.
4. Redirect or unpublish duplicate URLs only after the survivor page contains the useful content.
5. Retest the listed prompts on ChatGPT, Claude, and Gemini after publishing the consolidated survivor.
`;
}

function makeHtml({ clusterRows, redirectRows }) {
  const reviewCount = clusterRows.filter((row) => row.survivor_review_flag).length;
  const pressuredCount = clusterRows.filter((row) => num(row.benchmark_pressure) > 0).length;
  const exactCount = clusterRows.filter((row) => row.consolidation_type === "safe duplicate redirect").length;
  const familyCount = clusterRows.filter((row) => row.consolidation_type === "canonical family review").length;
  const cards = [
    ["Duplicate clusters", clusterRows.length, "groups"],
    ["Safe redirects", exactCount, "exact duplicates"],
    ["Family reviews", familyCount, "manual decisions"],
    ["Redirect candidates", redirectRows.length, "URLs"],
    ["With benchmark pressure", pressuredCount, "clusters"],
    ["Need survivor review", reviewCount, "clusters"],
    ["Zero-mention prompts", clusterRows.reduce((sum, row) => sum + num(row.zero_mention_queries), 0), "inside duplicates"],
    ["Competitor-only answers", clusterRows.reduce((sum, row) => sum + num(row.competitor_only_answers), 0), "inside duplicates"],
  ].map(([label, value, note]) => `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");

  const tableRows = top(clusterRows, "priority", 16).map((row) => `<tr><td>${escapeHtml(row.priority)}</td><td>${escapeHtml(row.consolidation_type)}</td><td><a href="${escapeHtml(row.recommended_survivor_url)}">${escapeHtml(row.recommended_survivor_title)}</a></td><td>${escapeHtml(row.merge_from_titles)}</td><td>${escapeHtml(row.prompts_to_preserve)}</td><td>${escapeHtml(row.competitors_to_cover)}</td><td>${escapeHtml(row.product_modules_to_keep)}</td><td>${escapeHtml(row.survivor_review_flag)}</td></tr>`).join("");
  const redirectTable = top(redirectRows, "priority", 20).map((row) => `<tr><td>${escapeHtml(row.priority)}</td><td>${escapeHtml(row.consolidation_type)}</td><td>${escapeHtml(row.from_url)}</td><td>${escapeHtml(row.to_url)}</td><td>${escapeHtml(row.review_flag)}</td></tr>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>iBOLT Canonical Consolidation Plan</title>
<style>
body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}main{max-width:1280px;margin:0 auto;padding:34px 24px 70px}h1{font-size:36px;margin:0 0 8px}h2{font-size:22px;margin:34px 0 12px}p,li{color:#334155;line-height:1.55}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid #d9e2ef;border-radius:12px;padding:16px}.k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700}.v{font-size:30px;font-weight:800;margin-top:8px}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d9e2ef;border-radius:12px;overflow:hidden;margin-bottom:22px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #edf2f7;padding:10px 11px;font-size:14px}th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:12px;letter-spacing:.04em}a{color:#1d4ed8}.charts{display:grid;grid-template-columns:1fr 1fr;gap:14px}.chart{background:#fff;border:1px solid #d9e2ef;border-radius:12px;padding:8px;overflow:auto}
</style></head><body><main>
<h1>iBOLT Canonical Consolidation Plan</h1>
<p>This prioritizes duplicate/canonical-risk pages by AI benchmark pressure so cleanup protects visibility instead of accidentally spreading or losing it.</p>
<section class="cards">${cards}</section>
<section class="charts">
<div class="chart"><img src="canonical-priority.svg" alt="Canonical consolidation priority"/></div>
<div class="chart"><img src="canonical-pressure.svg" alt="Benchmark pressure in duplicate clusters"/></div>
</section>
<h2>Highest-Priority Consolidations</h2>
<table><thead><tr><th>Priority</th><th>Type</th><th>Survivor</th><th>Merge From</th><th>Prompts</th><th>Competitors</th><th>Products</th><th>Review</th></tr></thead><tbody>${tableRows}</tbody></table>
<h2>Redirect Map</h2>
<table><thead><tr><th>Priority</th><th>Type</th><th>From</th><th>To</th><th>Review</th></tr></thead><tbody>${redirectTable}</tbody></table>
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, "canonical-consolidation-plan");
  await mkdir(outDir, { recursive: true });

  const duplicateRows = await readCsv(path.join(benchmarkDir, "content-refresh-roadmap", "duplicate-consolidation-plan.csv"));
  const triageRows = await readCsv(path.join(benchmarkDir, "live-blog-triage", "all-live-blog-triage.csv"));
  const pageActionRows = await readCsv(path.join(benchmarkDir, "query-page-matrix", "page-action-matrix.csv"));
  const productRows = await readCsv(path.join(benchmarkDir, "page-refresh-playbook", "product-modules-by-page.csv"));
  const postActionRows = await readCsv(path.join(benchmarkDir, "content-refresh-roadmap", "all-blog-post-action-map.csv"));

  const maps = {
    triageByUrl: new Map(triageRows.map((row) => [row.url, row])),
    pageActionByUrl: new Map(pageActionRows.map((row) => [row.page_url, row])),
    productByUrl: new Map(productRows.map((row) => [row.page_url, row])),
    postActionByUrl: new Map(postActionRows.map((row) => [row.url, row])),
  };

  const exactDuplicateRows = duplicateRows.filter(isExactDuplicatePair);
  const familyReviewRows = duplicateRows.filter((row) => !isExactDuplicatePair(row));
  const clusterRows = [
    ...buildClusterRows({ duplicateRows: exactDuplicateRows, maps }).map((row) => ({
      ...row,
      consolidation_type: "safe duplicate redirect",
      survivor_review_flag: row.survivor_review_flag || (row.recommended_survivor_url.includes("aeo-refresh") ? "confirm AEO refresh URL policy" : ""),
    })),
    ...buildPairReviewRows({ duplicateRows: familyReviewRows, maps }),
  ].sort((a, b) => b.priority - a.priority || a.recommended_survivor_title.localeCompare(b.recommended_survivor_title));
  const redirectRows = buildRedirectRows(clusterRows);

  await writeFile(path.join(outDir, "canonical-consolidation-queue.csv"), rowsToCsv(clusterRows, [
    "priority",
    "consolidation_type",
    "duplicate_score",
    "category",
    "recommended_survivor_title",
    "recommended_survivor_url",
    "merge_from_titles",
    "merge_from_urls",
    "benchmark_pressure_url",
    "benchmark_pressure_title",
    "benchmark_pressure",
    "query_count",
    "zero_mention_queries",
    "competitor_only_answers",
    "prompts_to_preserve",
    "competitors_to_cover",
    "product_modules_to_keep",
    "missing_structure",
    "survivor_review_flag",
    "redirect_action",
    "retest_action",
    "score_gap",
    "cluster_size",
  ]));
  await writeFile(path.join(outDir, "redirect-map.csv"), rowsToCsv(redirectRows, [
    "priority",
    "consolidation_type",
    "from_url",
    "to_url",
    "survivor_title",
    "review_flag",
    "action",
  ]));
  await writeFile(path.join(outDir, "canonical-consolidation-data.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    benchmarkDir,
    duplicatePairs: duplicateRows.length,
    exactDuplicatePairs: exactDuplicateRows.length,
    familyReviewPairs: familyReviewRows.length,
    duplicateClusters: clusterRows.length,
    redirectCandidates: redirectRows.length,
    benchmarkPressuredClusters: clusterRows.filter((row) => num(row.benchmark_pressure) > 0).length,
    survivorReviewClusters: clusterRows.filter((row) => row.survivor_review_flag).length,
    topClusters: top(clusterRows, "priority", 12),
  }, null, 2));
  await writeFile(path.join(outDir, "canonical-priority.svg"), barSvg({
    title: "Canonical Consolidation Priority",
    rows: top(clusterRows, "priority", 10),
    labelKey: "recommended_survivor_title",
    valueKey: "priority",
    color: "#2563eb",
  }));
  await writeFile(path.join(outDir, "canonical-pressure.svg"), barSvg({
    title: "Benchmark Pressure In Duplicate Clusters",
    rows: top(clusterRows, "benchmark_pressure", 10),
    labelKey: "recommended_survivor_title",
    valueKey: "benchmark_pressure",
    color: "#dc2626",
  }));
  await writeFile(path.join(outDir, "REPORT.md"), makeMarkdown({ clusterRows, redirectRows }));
  await writeFile(path.join(outDir, "REPORT.html"), makeHtml({ clusterRows, redirectRows }));

  console.log(`Wrote ${outDir}`);
  console.log(`Planned ${clusterRows.length} duplicate clusters and ${redirectRows.length} redirect candidates.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
