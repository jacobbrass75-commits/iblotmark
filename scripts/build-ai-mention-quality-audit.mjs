import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";

const PROVIDER_LABELS = {
  chatgpt: "ChatGPT",
  gemini_plain: "Gemini",
  claude: "Claude",
};

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

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function latestDir(prefix) {
  const entries = await readdir(path.join(process.cwd(), OUTPUT_ROOT), { withFileTypes: true });
  const name = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  if (!name) throw new Error(`No ${prefix} directory found in ${OUTPUT_ROOT}`);
  return path.join(process.cwd(), OUTPUT_ROOT, name);
}

function num(value) {
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(count, total) {
  return total ? Math.round((count / total) * 100) : 0;
}

function providerName(provider) {
  return PROVIDER_LABELS[provider] || provider;
}

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[™®©]/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\bwith\b/g, "w")
    .replace(/\band\b/g, "&")
    .replace(/\bibolt\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(?:tm|for|all|the|a|an|mount|mounts|phone|tablet)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value) {
  return new Set(normalize(value).split(" ").filter((token) => token.length > 2));
}

function productMatchScore(input, product) {
  const query = normalize(input);
  const title = normalize(product.title);
  if (!query || !title) return 0;
  if (query === title) return 1;
  if (title.includes(query) || query.includes(title)) return 0.92;
  const left = tokenSet(input);
  const right = tokenSet(product.title);
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  const jaccard = union ? intersection / union : 0;
  const overlap = intersection / Math.max(1, Math.min(left.size, right.size));
  return Math.max(jaccard, overlap * 0.78);
}

function bestProductMatch(candidate, products) {
  const [best] = products
    .map((product) => ({ product, score: productMatchScore(candidate, product) }))
    .sort((a, b) => b.score - a.score);
  return best || null;
}

function cleanCandidate(value) {
  return String(value ?? "")
    .replace(/^[\s*#\d.)-]+/, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+[-:|].*$/, "")
    .replace(/\s+\(.+?\).*$/, "")
    .trim()
    .replace(/[.,;:]+$/, "")
    .slice(0, 120)
    .trim();
}

function extractProductCandidates(rawResponse) {
  const text = String(rawResponse ?? "");
  const candidates = new Set();
  const linePatterns = [
    /\*\*([^*\n]{0,12}iBOLT[^*\n]{2,90})\*\*/gi,
    /(?:^|\n)\s*(?:#{2,4}\s*)?[\d.)-]*\s*([^:\n*]{0,12}iBOLT[^:\n*]{2,90})(?::|\n)/gi,
    /\b(iBOLT\s+[A-Z0-9][A-Za-z0-9™®'’&/(). -]{2,80}(?:Mount|Kit|Stand|Dock|Bizmount|BizMount|AMPS|Holder|Base|Clamp|Tower|Adapter|Plate|Arm|Pro|NFC|suction cup|dashboard mount|cup holder mount))/gi,
  ];

  for (const pattern of linePatterns) {
    for (const match of text.matchAll(pattern)) {
      const candidate = cleanCandidate(match[1]);
      if (candidate && /ibolt/i.test(candidate) && candidate.length >= 7) {
        candidates.add(candidate);
      }
    }
  }

  return [...candidates].filter((candidate) => {
    const lowered = candidate.toLowerCase();
    if (lowered.includes("website") || lowered.includes("offers several")) return false;
    if (/^ibolt\s+mounts?$/i.test(candidate)) return false;
    if (/^ibolt\s+phone\s+mounts?$/i.test(candidate)) return false;
    if (/^(top|specific)\s+ibolt\b/i.test(candidate)) return false;
    if (/\bibolt\s+and\s+ram\b/i.test(lowered)) return false;
    if (/\bfor\s+(doordash|uber eats|restaurant counters)\b/i.test(lowered)) return false;
    if (/\b(known for|offers a range|products typically|provides flexible|generally handle|requires most|choose ibolt|top picks|explicitly targets|offer excellent|are leading manufacturers|vs ram mount|vs ram for|and ram mount|for restaurant counters)\b/i.test(lowered)) {
      return false;
    }
    if (/\b(is|are|was|were|provides|offers|requires|targets|handle|handles)\b/i.test(lowered) && !/\b(?:dock|tabdock|xprodock|magdock|bizmount|spro|mini|cpro|nfc|amps|kit|holder|stand|base|adapter|plate|tower|lock)\b/i.test(lowered)) {
      return false;
    }
    if (lowered.split(/\s+/).length > 10 && !/[+()]/.test(candidate)) return false;
    return true;
  });
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

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function counter(rows, valuesFn) {
  const map = new Map();
  for (const row of rows) {
    for (const value of valuesFn(row)) {
      if (value) map.set(value, (map.get(value) || 0) + 1);
    }
  }
  return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function contextSnippet(rawResponse) {
  const text = String(rawResponse ?? "").replace(/\s+/g, " ").trim();
  const index = text.toLowerCase().indexOf("ibolt");
  if (index < 0) return "";
  return text.slice(Math.max(0, index - 120), Math.min(text.length, index + 360));
}

function mentionQualityScore({ result, matchedCandidates, unmatchedCandidates }) {
  let score = num(result.coverageScore);
  if (result.topPickRank && num(result.topPickRank) <= 3) score += 12;
  if (result.targetDomainCited) score += 20;
  if (matchedCandidates.length) score += 12;
  if (result.positioningTags?.includes("specialist")) score += 8;
  if (result.positioningTags?.includes("durable")) score += 4;
  if (result.positioningTags?.includes("modular")) score += 4;
  if (unmatchedCandidates.length) score -= Math.min(20, unmatchedCandidates.length * 5);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function actionForMention(row) {
  const actions = [];
  if (!row.catalog_matches) actions.push("add exact product names and links to source page");
  if (row.unmatched_product_names) actions.push("validate or correct AI-visible product naming");
  if (!row.target_domain_cited || row.target_domain_cited === "false") actions.push("make the page citable with visible specs and schema");
  if (!row.top_pick_rank) actions.push("strengthen recommendation framing");
  return unique(actions).join("; ");
}

function buildRows(summary, products) {
  const rows = [];
  const candidateRows = [];

  for (const query of summary.current?.querySummaries || []) {
    for (const result of query.results || []) {
      if (!result.targetBrandMentioned && !result.brandMentioned) continue;
      const candidates = extractProductCandidates(result.rawResponse);
      const candidateMatches = candidates.map((candidate) => {
        const match = bestProductMatch(candidate, products);
        const matched = match && match.score >= 0.58;
        return {
          candidate,
          matched,
          matchedTitle: matched ? match.product.title : match?.product.title || "",
          matchedHandle: matched ? match.product.handle : match?.product.handle || "",
          matchScore: match ? Math.round(match.score * 100) : 0,
        };
      });
      const matchedCandidates = candidateMatches.filter((item) => item.matched);
      const unmatchedCandidates = candidateMatches.filter((item) => !item.matched);
      const row = {
        provider: providerName(result.provider),
        provider_key: result.provider,
        query: query.query,
        category: query.category,
        coverage_score: result.coverageScore,
        mention_quality_score: mentionQualityScore({ result, matchedCandidates, unmatchedCandidates }),
        top_pick_rank: result.topPickRank || "",
        sentiment: result.sentiment || "",
        target_domain_cited: result.targetDomainCited ? "true" : "false",
        source_urls: (result.sourceUrls || []).join("; "),
        co_mentioned_competitors: (result.competitors || []).join("; "),
        positioning_tags: (result.positioningTags || []).join("; "),
        extracted_product_names: candidates.join("; "),
        catalog_matches: matchedCandidates.map((item) => item.matchedTitle).join("; "),
        unmatched_product_names: unmatchedCandidates.map((item) => item.candidate).join("; "),
        snippet: contextSnippet(result.rawResponse),
      };
      row.action = actionForMention(row);
      rows.push(row);

      for (const item of candidateMatches) {
        candidateRows.push({
          candidate: item.candidate,
          provider: row.provider,
          query: row.query,
          category: row.category,
          matched: item.matched ? "yes" : "review",
          matched_title: item.matchedTitle,
          matched_handle: item.matchedHandle,
          match_score: item.matchScore,
          coverage_score: result.coverageScore,
          top_pick_rank: result.topPickRank || "",
        });
      }
    }
  }

  return { rows, candidateRows };
}

function buildCandidateSummary(candidateRows) {
  return [...groupBy(candidateRows, (row) => row.candidate).entries()].map(([candidate, rows]) => {
    const best = [...rows].sort((a, b) => num(b.match_score) - num(a.match_score))[0] || {};
    const reviewRows = rows.filter((row) => row.matched !== "yes");
    return {
      candidate,
      appearances: rows.length,
      match_status: reviewRows.length ? "review" : "matched",
      best_match_score: best.match_score || 0,
      matched_title: best.matched_title || "",
      matched_handle: best.matched_handle || "",
      providers: counter(rows, (row) => [row.provider]).map((item) => `${item.name} ${item.count}`).join("; "),
      categories: counter(rows, (row) => [row.category]).map((item) => `${item.name} ${item.count}`).join("; "),
      queries: unique(rows.map((row) => row.query)).slice(0, 8).join("; "),
      action: reviewRows.length
        ? "Review whether this is a valid alias, old product name, or hallucinated product. Add exact source-page naming if valid."
        : "Use this exact product wording consistently in page modules, image alt text, and schema.",
    };
  }).sort((a, b) => (a.match_status === b.match_status ? num(b.appearances) - num(a.appearances) : a.match_status === "review" ? -1 : 1));
}

function buildPositioningRows(mentionRows) {
  const groups = groupBy(mentionRows, (row) => `${row.provider}|||${row.category}`);
  return [...groups.entries()].map(([key, rows]) => {
    const [provider, category] = key.split("|||");
    const tagCounts = counter(rows, (row) => splitList(row.positioning_tags));
    const competitorCounts = counter(rows, (row) => splitList(row.co_mentioned_competitors));
    const avgQuality = Math.round(rows.reduce((sum, row) => sum + num(row.mention_quality_score), 0) / Math.max(1, rows.length));
    return {
      provider,
      category,
      mention_rows: rows.length,
      avg_quality_score: avgQuality,
      top_positioning: tagCounts.slice(0, 8).map((item) => `${item.name} ${item.count}`).join("; "),
      co_mentioned_competitors: competitorCounts.slice(0, 6).map((item) => `${item.name} ${item.count}`).join("; "),
      catalog_match_rows: rows.filter((row) => row.catalog_matches).length,
      naming_review_rows: rows.filter((row) => row.unmatched_product_names).length,
    };
  }).sort((a, b) => b.mention_rows - a.mention_rows || b.avg_quality_score - a.avg_quality_score);
}

function top(rows, key, count = 10) {
  return [...rows].sort((a, b) => num(b[key]) - num(a[key]) || String(a.candidate || a.query).localeCompare(String(b.candidate || b.query))).slice(0, count);
}

function bottom(rows, key, count = 10) {
  return [...rows].sort((a, b) => num(a[key]) - num(b[key]) || String(a.query).localeCompare(String(b.query))).slice(0, count);
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

function table(rows, columns) {
  const head = columns.map(([label]) => `<th>${escapeHtml(label)}</th>`).join("");
  const body = rows.map((row) => `<tr>${columns.map(([, key]) => `<td>${escapeHtml(row[key])}</td>`).join("")}</tr>`).join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function markdownTable(rows, columns) {
  return [
    `| ${columns.map(([label]) => label).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${columns.map(([, key]) => String(row[key] ?? "").replaceAll("|", "\\|")).join(" | ")} |`),
  ].join("\n");
}

function buildMarkdown({ summary, mentionRows, candidateSummary, positioningRows }) {
  return `# iBOLT Mention Quality Audit

## Bottom Line

The benchmark has ${summary.mentionRows} iBOLT-mentioned answers. Those mentions are useful, but product-name quality is inconsistent: ${summary.catalogMatchedMentionRows} mention rows include a catalog product match, while ${summary.namingReviewRows} mention rows include at least one product name that needs review as an alias, old name, or hallucination risk.

This matters because AI visibility is not just "did it mention iBOLT?" The stronger target is: iBOLT is mentioned, ranked, described with specialist/commercial positioning, tied to real products, and cited to iboltmounts.com.

## Mention Quality Snapshot

- Average mention quality score: ${summary.avgMentionQuality}/100.
- Top-3 iBOLT recommendation rows: ${summary.topThreeRows}/${summary.mentionRows}.
- Cited iBOLT rows: ${summary.citedRows}/${summary.mentionRows}.
- Extracted product-name candidates: ${summary.productCandidateCount}.
- Product-name candidates needing review: ${summary.productCandidateReviewCount}.
- Candidate catalog match rate: ${summary.productCandidateMatchRate}%.

## Strongest Mentions

${markdownTable(top(mentionRows, "mention_quality_score", 8), [
  ["Score", "mention_quality_score"],
  ["Provider", "provider"],
  ["Query", "query"],
  ["Rank", "top_pick_rank"],
  ["Catalog matches", "catalog_matches"],
  ["Positioning", "positioning_tags"],
])}

## Weak Mention Rows To Clean Up

${markdownTable(bottom(mentionRows, "mention_quality_score", 8), [
  ["Score", "mention_quality_score"],
  ["Provider", "provider"],
  ["Query", "query"],
  ["Unmatched names", "unmatched_product_names"],
  ["Action", "action"],
])}

## Product Naming Review Queue

${markdownTable(candidateSummary.filter((row) => row.match_status === "review").slice(0, 12), [
  ["Candidate", "candidate"],
  ["Appearances", "appearances"],
  ["Best score", "best_match_score"],
  ["Best match", "matched_title"],
  ["Queries", "queries"],
  ["Action", "action"],
])}

## Positioning By Provider And Topic

${markdownTable(positioningRows.slice(0, 12), [
  ["Provider", "provider"],
  ["Category", "category"],
  ["Rows", "mention_rows"],
  ["Quality", "avg_quality_score"],
  ["Positioning", "top_positioning"],
  ["Competitors", "co_mentioned_competitors"],
])}
`;
}

function buildHtml({ summary, mentionRows, candidateSummary, positioningRows, charts }) {
  const cards = [
    ["Mention rows", summary.mentionRows, "answers that mention iBOLT"],
    ["Avg quality", `${summary.avgMentionQuality}/100`, "mention quality score"],
    ["Catalog matched", summary.catalogMatchedMentionRows, "mention rows"],
    ["Naming review", summary.namingReviewRows, "mention rows"],
    ["Cited rows", summary.citedRows, "target domain citations"],
    ["Product candidates", summary.productCandidateCount, `${summary.productCandidateMatchRate}% matched`],
  ].map(([label, value, note]) => `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>iBOLT Mention Quality Audit</title>
<style>
body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}main{max-width:1240px;margin:0 auto;padding:34px 26px 60px}h1{font-size:34px;margin:0 0 8px}h2{font-size:22px;margin:34px 0 14px}p{color:#334155;line-height:1.55}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}.k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700}.v{font-size:30px;font-weight:800;margin-top:8px}.note{border-left:6px solid #0f766e;background:#fff;border-radius:10px;padding:16px 18px;border-top:1px solid #d7dee8;border-right:1px solid #d7dee8;border-bottom:1px solid #d7dee8}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden}th,td{text-align:left;vertical-align:top;padding:11px 12px;border-bottom:1px solid #edf2f7;font-size:14px}th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:12px;letter-spacing:.04em}.charts{display:grid;grid-template-columns:1fr;gap:18px}.chart{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:12px;overflow:auto}
</style></head><body><main>
<h1>iBOLT Mention Quality Audit</h1>
<p class="note"><strong>Readout:</strong> A mention is only valuable if the model describes iBOLT accurately. The cleanup queue below shows where product naming should be made more exact on the source pages so AI systems repeat real catalog entities instead of fuzzy aliases.</p>
<section class="cards">${cards}</section>
<section class="charts"><div class="chart">${charts.candidates}</div><div class="chart">${charts.positioning}</div></section>
<h2>Strongest Mentions</h2>
${table(top(mentionRows, "mention_quality_score", 10), [
  ["Score", "mention_quality_score"],
  ["Provider", "provider"],
  ["Query", "query"],
  ["Rank", "top_pick_rank"],
  ["Catalog matches", "catalog_matches"],
  ["Positioning", "positioning_tags"],
  ["Action", "action"],
])}
<h2>Weak Mention Rows To Clean Up</h2>
${table(bottom(mentionRows, "mention_quality_score", 10), [
  ["Score", "mention_quality_score"],
  ["Provider", "provider"],
  ["Query", "query"],
  ["Unmatched names", "unmatched_product_names"],
  ["Snippet", "snippet"],
  ["Action", "action"],
])}
<h2>Product Naming Review Queue</h2>
${table(candidateSummary.filter((row) => row.match_status === "review").slice(0, 16), [
  ["Candidate", "candidate"],
  ["Appearances", "appearances"],
  ["Best score", "best_match_score"],
  ["Best match", "matched_title"],
  ["Providers", "providers"],
  ["Queries", "queries"],
  ["Action", "action"],
])}
<h2>Positioning By Provider And Topic</h2>
${table(positioningRows.slice(0, 14), [
  ["Provider", "provider"],
  ["Category", "category"],
  ["Rows", "mention_rows"],
  ["Quality", "avg_quality_score"],
  ["Positioning", "top_positioning"],
  ["Competitors", "co_mentioned_competitors"],
])}
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, "mention-quality-audit");
  await mkdir(outDir, { recursive: true });

  const summaryJson = await readJson(path.join(benchmarkDir, "summary.json"));
  const products = await readCsv(path.join(benchmarkDir, "blog-inventory-audit", "product-spread.csv"));
  const { rows: mentionRows, candidateRows } = buildRows(summaryJson, products);
  const candidateSummary = buildCandidateSummary(candidateRows);
  const positioningRows = buildPositioningRows(mentionRows);
  const catalogMatchedMentionRows = mentionRows.filter((row) => row.catalog_matches).length;
  const namingReviewRows = mentionRows.filter((row) => row.unmatched_product_names).length;
  const citedRows = mentionRows.filter((row) => row.target_domain_cited === "true").length;
  const topThreeRows = mentionRows.filter((row) => row.top_pick_rank && num(row.top_pick_rank) <= 3).length;
  const productCandidateReviewCount = candidateSummary.filter((row) => row.match_status === "review").length;
  const summary = {
    benchmarkDir,
    mentionRows: mentionRows.length,
    avgMentionQuality: Math.round(mentionRows.reduce((sum, row) => sum + num(row.mention_quality_score), 0) / Math.max(1, mentionRows.length)),
    topThreeRows,
    citedRows,
    catalogMatchedMentionRows,
    namingReviewRows,
    productCandidateCount: candidateSummary.length,
    productCandidateReviewCount,
    productCandidateMatchedCount: candidateSummary.length - productCandidateReviewCount,
    productCandidateMatchRate: pct(candidateSummary.length - productCandidateReviewCount, candidateSummary.length),
    positioningRows: positioningRows.length,
  };
  const charts = {
    candidates: barSvg({ title: "Product Name Candidates Needing Review", rows: candidateSummary.filter((row) => row.match_status === "review").slice(0, 10), labelKey: "candidate", valueKey: "appearances", color: "#0f766e" }),
    positioning: barSvg({ title: "Mention Quality By Provider And Topic", rows: positioningRows.slice(0, 10), labelKey: "category", valueKey: "avg_quality_score", maxValue: 100, color: "#2563eb" }),
  };

  await writeFile(path.join(outDir, "mention-quality-rows.csv"), csv([
    ["provider", "provider_key", "query", "category", "coverage_score", "mention_quality_score", "top_pick_rank", "sentiment", "target_domain_cited", "source_urls", "co_mentioned_competitors", "positioning_tags", "extracted_product_names", "catalog_matches", "unmatched_product_names", "snippet", "action"],
    ...mentionRows.map((row) => [row.provider, row.provider_key, row.query, row.category, row.coverage_score, row.mention_quality_score, row.top_pick_rank, row.sentiment, row.target_domain_cited, row.source_urls, row.co_mentioned_competitors, row.positioning_tags, row.extracted_product_names, row.catalog_matches, row.unmatched_product_names, row.snippet, row.action]),
  ]));
  await writeFile(path.join(outDir, "product-name-candidate-audit.csv"), csv([
    ["candidate", "appearances", "match_status", "best_match_score", "matched_title", "matched_handle", "providers", "categories", "queries", "action"],
    ...candidateSummary.map((row) => [row.candidate, row.appearances, row.match_status, row.best_match_score, row.matched_title, row.matched_handle, row.providers, row.categories, row.queries, row.action]),
  ]));
  await writeFile(path.join(outDir, "positioning-quality-scorecard.csv"), csv([
    ["provider", "category", "mention_rows", "avg_quality_score", "top_positioning", "co_mentioned_competitors", "catalog_match_rows", "naming_review_rows"],
    ...positioningRows.map((row) => [row.provider, row.category, row.mention_rows, row.avg_quality_score, row.top_positioning, row.co_mentioned_competitors, row.catalog_match_rows, row.naming_review_rows]),
  ]));
  await writeFile(path.join(outDir, "mention-quality-data.json"), `${JSON.stringify({ summary, mentionRows, candidateSummary, positioningRows }, null, 2)}\n`);
  await writeFile(path.join(outDir, "product-name-review.svg"), charts.candidates);
  await writeFile(path.join(outDir, "positioning-quality.svg"), charts.positioning);
  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown({ summary, mentionRows, candidateSummary, positioningRows }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({ summary, mentionRows, candidateSummary, positioningRows, charts }));

  console.log(`Wrote ${outDir}`);
  console.log(`Mention rows: ${mentionRows.length}`);
  console.log(`Product-name candidates needing review: ${productCandidateReviewCount}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
