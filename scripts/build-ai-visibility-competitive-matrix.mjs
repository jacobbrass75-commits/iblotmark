import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";
const AUDIT_PREFIX = "live-blog-ai-citability-merged-";
let sharpModulePromise = null;

const COMPETITOR_POSITIONING = [
  {
    match: /ram mounts/i,
    angle: "Position iBOLT as the specialist for exact business workflows, with modular parts that remain cross-compatible with industry-standard balls and AMPS patterns.",
  },
  {
    match: /arkon/i,
    angle: "Position iBOLT around commercial durability, locked tablet workflows, restaurant stations, forklift mounts, and fleet-specific fit.",
  },
  {
    match: /iottie|scosche|belkin|quad lock|peak design|lisen|lamicall|ugreen/i,
    angle: "Position iBOLT as commercial-grade equipment rather than consumer phone accessories.",
  },
  {
    match: /proclip/i,
    angle: "Position iBOLT around modular fleet deployment, universal device changes, drill bases, AMPS plates, and rugged shared-vehicle use.",
  },
  {
    match: /mount-it|bouncepad|square/i,
    angle: "Position iBOLT around multi-tablet restaurant operations, delivery app stations, locking holders, and modular POS mounting.",
  },
  {
    match: /garmin|lowrance|humminbird|hummingbird|yakattack|scotty|railblaza/i,
    angle: "Clarify that iBOLT complements fish finders and marine electronics by solving the mounting, vibration, and placement problem.",
  },
  {
    match: /tackform/i,
    angle: "Position iBOLT around fleet and warehouse-specific SKUs, barcode scanner support, locking workflows, and exact vertical pages.",
  },
];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
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

function slugFromUrl(url) {
  const pathname = new URL(url).pathname;
  return pathname.split("/").filter(Boolean).pop() || "";
}

function normalizeSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "")
    .replace(/^blogs\/news\//, "");
}

function tokenize(value) {
  return compact(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((token) => token.length > 2 && !new Set(["the", "and", "for", "with", "how", "best", "guide"]).has(token));
}

function overlapScore(a, b) {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (!aTokens.size || !bTokens.size) return 0;
  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token) || bTokens.has(`${token}s`) || (token.endsWith("s") && bTokens.has(token.slice(0, -1)))) {
      intersection += 1;
    }
  }
  return intersection / Math.sqrt(aTokens.size * bTokens.size);
}

function providerLabel(provider) {
  if (provider === "chatgpt") return "ChatGPT";
  if (provider === "gemini_plain") return "Gemini";
  if (provider === "claude") return "Claude";
  return provider;
}

function short(value, max = 76) {
  const text = compact(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}...`;
}

function latestDir(prefix) {
  return readdir(path.join(process.cwd(), OUTPUT_ROOT), { withFileTypes: true })
    .then((entries) => entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
      .map((entry) => entry.name)
      .sort()
      .at(-1))
    .then((name) => {
      if (!name) throw new Error(`No ${prefix} directory found in ${OUTPUT_ROOT}.`);
      return path.join(process.cwd(), OUTPUT_ROOT, name);
    });
}

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function svgShell(width, height, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
  <style>
    .bg{fill:#f8fafc}.panel{fill:#fff;stroke:#d7dee8;stroke-width:1}.title{font:700 24px Arial,sans-serif;fill:#111827}.subtitle{font:400 14px Arial,sans-serif;fill:#64748b}.label{font:700 13px Arial,sans-serif;fill:#111827}.small{font:400 12px Arial,sans-serif;fill:#475569}.value{font:700 13px Arial,sans-serif;fill:#0f172a}.grid{stroke:#e2e8f0;stroke-width:1}
  </style>
  <rect class="bg" width="${width}" height="${height}"/>
  ${body}
</svg>`;
}

function wrapText(text, maxChars) {
  const words = compact(text).split(/\s+/).filter(Boolean);
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

function barChart({ title, subtitle, rows, valueKey = "value", labelKey = "label", noteKey = "note", color = "#2563eb", maxValue }) {
  const width = 1160;
  const rowH = 46;
  const height = 130 + rows.length * rowH + 34;
  const left = 430;
  const top = 108;
  const barW = width - left - 146;
  const max = maxValue || Math.max(1, ...rows.map((row) => Number(row[valueKey] || 0)));
  const body = rows.map((row, index) => {
    const y = top + index * rowH;
    const value = Number(row[valueKey] || 0);
    const w = Math.max(value > 0 ? 4 : 0, Math.round((value / max) * barW));
    const labelLines = wrapText(row[labelKey], 48);
    const labels = labelLines.map((line, lineIndex) =>
      `<text class="${lineIndex === 0 ? "label" : "small"}" x="54" y="${y + 14 + lineIndex * 15}">${escapeHtml(line)}</text>`
    ).join("\n");
    return `
      ${labels}
      <rect x="${left}" y="${y}" width="${barW}" height="24" rx="8" fill="#e2e8f0"/>
      <rect x="${left}" y="${y}" width="${w}" height="24" rx="8" fill="${color}"/>
      <text class="value" x="${left + barW + 14}" y="${y + 17}">${escapeHtml(row.display ?? value)}</text>
      <text class="small" x="${left}" y="${y + 41}">${escapeHtml(row[noteKey] || "")}</text>
    `;
  }).join("\n");
  return svgShell(width, height, `
    <rect class="panel" x="28" y="24" width="${width - 56}" height="${height - 48}" rx="14"/>
    <text class="title" x="54" y="64">${escapeHtml(title)}</text>
    <text class="subtitle" x="54" y="88">${escapeHtml(subtitle)}</text>
    ${body}
  `);
}

function remediationChart(issueCounts, auditedPages) {
  const rows = [
    { label: "FAQ schema missing", value: issueCounts.missingFaqSchema, note: `${pct(issueCounts.missingFaqSchema, auditedPages)}% of audited pages` },
    { label: "Quick answer missing", value: issueCounts.noQuickAnswer, note: `${pct(issueCounts.noQuickAnswer, auditedPages)}% of audited pages` },
    { label: "Comparison/tradeoff missing", value: issueCounts.noComparisonSignals, note: `${pct(issueCounts.noComparisonSignals, auditedPages)}% of audited pages` },
    { label: "Article/BlogPosting schema missing", value: issueCounts.missingArticleSchema, note: `${pct(issueCounts.missingArticleSchema, auditedPages)}% of audited pages` },
    { label: "Direct product links missing", value: issueCounts.noProductLinks, note: `${pct(issueCounts.noProductLinks, auditedPages)}% of audited pages` },
  ];
  return barChart({
    title: "AI-Citation Remediation Backlog",
    subtitle: "Structural fixes detected across the live blog audit.",
    rows,
    color: "#f97316",
    maxValue: auditedPages,
  });
}

async function writeSvgAndPng(outDir, filename, svg) {
  const svgPath = path.join(outDir, `${filename}.svg`);
  await writeFile(svgPath, svg);
  try {
    sharpModulePromise ||= import("sharp");
    const sharp = (await sharpModulePromise).default;
    await sharp(Buffer.from(svg)).png().toFile(path.join(outDir, `${filename}.png`));
  } catch (error) {
    console.warn(`Could not render ${filename}.png: ${error.message}`);
  }
}

function getPositioningAngle(brand) {
  return COMPETITOR_POSITIONING.find((item) => item.match.test(brand))?.angle
    || "Create explicit comparison copy that explains where iBOLT is the better fit and where the other brand may still be appropriate.";
}

function resultStats(current) {
  const results = current.querySummaries.flatMap((query) => query.results.map((result) => ({ query, result })));
  const completed = results.filter(({ result }) => result.status === "completed");
  const mentions = completed.filter(({ result }) => result.brandMentioned || result.targetBrandMentioned).length;
  const citations = completed.filter(({ result }) => result.iboltCited || result.targetDomainCited).length;
  const topThree = completed.filter(({ result }) => Number(result.topPickRank) >= 1 && Number(result.topPickRank) <= 3).length;
  const nonBranded = completed.filter(({ query }) => !/\bibolt\b/i.test(query.query));
  const nonBrandedMentions = nonBranded.filter(({ result }) => result.brandMentioned || result.targetBrandMentioned).length;
  return {
    total: completed.length,
    mentions,
    citations,
    topThree,
    nonBranded: nonBranded.length,
    nonBrandedMentions,
  };
}

function competitorsForQuery(deep, queryText) {
  const competitors = new Set();
  for (const row of deep.competitorOnlyAnswers || []) {
    if (row.query === queryText) {
      for (const competitor of row.competitors || []) competitors.add(competitor);
    }
  }
  const action = (deep.recommendedActions || []).find((row) => row.prompt === queryText);
  for (const competitor of action?.competitors || []) competitors.add(competitor);
  return [...competitors];
}

function structuralIssues(page) {
  if (!page || page.status === "failed") return ["No audited live page match"];
  const issues = [];
  if (!page.hasFaqSchema) issues.push("FAQ schema");
  if (!page.hasQuickAnswer) issues.push("quick answer");
  if (!page.hasComparisonSignals) issues.push("comparison block");
  if (!page.hasArticleSchema && !page.hasBlogPostingSchema) issues.push("Article/BlogPosting schema");
  if (!page.productLinks) issues.push("direct product links");
  if (Number(page.missingAlt || 0) > 0) issues.push("image alt text");
  if (page.metaDescription && (page.metaDescription.length < 90 || page.metaDescription.length > 170)) issues.push("meta description");
  return issues;
}

function buildAuditIndexes(auditRows) {
  const bySlug = new Map();
  const byTitle = new Map();
  const searchable = [];
  for (const row of auditRows) {
    if (row.url) bySlug.set(normalizeSlug(slugFromUrl(row.url)), row);
    if (row.title) byTitle.set(compact(row.title).toLowerCase(), row);
    if (row.title && row.status !== "failed") searchable.push(row);
  }
  return { bySlug, byTitle, searchable };
}

function matchAuditPage(indexes, bestPost) {
  if (!bestPost) return null;
  const slug = normalizeSlug(bestPost.slug);
  const exact = indexes.bySlug.get(slug)
    || indexes.bySlug.get(`${slug}-1`)
    || indexes.byTitle.get(compact(bestPost.title).toLowerCase())
    || null;
  if (exact && exact.status !== "failed") return exact;

  const fuzzy = indexes.searchable
    .map((row) => ({ row, score: Math.max(overlapScore(bestPost.title, row.title), overlapScore(slug, slugFromUrl(row.url || ""))) }))
    .filter((item) => item.score >= 0.62)
    .sort((a, b) => b.score - a.score)[0];
  return fuzzy?.row || exact;
}

function buildQueryMatrix(summary, deep, auditIndexes) {
  return [...(deep.queryContentMap || [])].map((row) => {
    const querySummary = summary.current.querySummaries.find((query) => query.query === row.query);
    const page = matchAuditPage(auditIndexes, row.bestPost);
    const competitors = competitorsForQuery(deep, row.query);
    const competitorOnlyCount = (deep.competitorOnlyAnswers || []).filter((answer) => answer.query === row.query).length;
    const pageScore = page?.aiCitabilityScore ?? null;
    const aiGap = 100 - Number(row.averageScore || 0);
    const mentionGap = 100 - Number(row.averageMentionRate || 0);
    const pageGap = pageScore === null ? 45 : 100 - pageScore;
    const coveragePenalty = row.contentCoverage === "strong" ? 8 : row.contentCoverage === "partial" ? 18 : 30;
    const opportunityScore = Math.min(100, Math.round(
      aiGap * 0.36 + mentionGap * 0.24 + pageGap * 0.24 + competitorOnlyCount * 5 + coveragePenalty
    ));
    return {
      prompt: row.query,
      category: row.category,
      averageScore: row.averageScore,
      mentionRate: row.averageMentionRate,
      weakestProviders: row.weakestProviders || [],
      contentCoverage: row.contentCoverage,
      closestPost: row.bestPost?.title || "",
      closestSlug: row.bestPost?.slug || "",
      closestScore: row.bestPost ? Math.round(row.bestPost.score * 100) : 0,
      pageUrl: page?.url || "",
      pageScore,
      pageSource: page?.source || "",
      structuralIssues: structuralIssues(page),
      competitors,
      competitorOnlyCount,
      opportunityScore,
      priority: querySummary?.priority ?? 0,
      recommendedAction: (deep.recommendedActions || []).find((action) => action.prompt === row.query)?.action || "Refresh or expand matching page",
    };
  }).sort((a, b) => b.opportunityScore - a.opportunityScore || a.averageScore - b.averageScore);
}

function buildCompetitorBattlecards(deep, queryMatrix) {
  return (deep.competitorRows || []).map((row) => {
    const relatedQueries = queryMatrix.filter((query) => query.competitors.includes(row.brand));
    const lostPrompts = (deep.competitorOnlyAnswers || [])
      .filter((answer) => (answer.competitors || []).includes(row.brand))
      .map((answer) => answer.query);
    const uniqueLostPrompts = [...new Set(lostPrompts)].slice(0, 8);
    const pages = [...new Set(relatedQueries.map((query) => query.closestPost).filter(Boolean))].slice(0, 6);
    return {
      brand: row.brand,
      type: row.type,
      answerCount: row.answerCount,
      withIbolt: row.coMentionWithIbolt,
      withoutIbolt: row.competitorOnly,
      coMentionRate: pct(row.coMentionWithIbolt, row.answerCount),
      categories: row.categories,
      providers: row.providers,
      lostPrompts: uniqueLostPrompts,
      pagesToRefresh: pages,
      positioningAngle: getPositioningAngle(row.brand),
    };
  }).sort((a, b) => b.withoutIbolt - a.withoutIbolt || b.answerCount - a.answerCount);
}

function buildTopicMatrix(queryMatrix, auditSummary, deep) {
  const topics = new Map();
  for (const query of queryMatrix) {
    const bucket = topics.get(query.category) || {
      topic: query.category,
      promptCount: 0,
      zeroMentionPrompts: 0,
      scoreTotal: 0,
      mentionTotal: 0,
      competitorOnly: 0,
      competitors: new Map(),
    };
    bucket.promptCount += 1;
    bucket.scoreTotal += Number(query.averageScore || 0);
    bucket.mentionTotal += Number(query.mentionRate || 0);
    if (!Number(query.mentionRate || 0)) bucket.zeroMentionPrompts += 1;
    bucket.competitorOnly += query.competitorOnlyCount;
    for (const competitor of query.competitors) {
      bucket.competitors.set(competitor, (bucket.competitors.get(competitor) || 0) + 1);
    }
    topics.set(query.category, bucket);
  }

  for (const answer of deep.competitorOnlyAnswers || []) {
    const bucket = topics.get(answer.category);
    if (!bucket) continue;
    for (const competitor of answer.competitors || []) {
      bucket.competitors.set(competitor, (bucket.competitors.get(competitor) || 0) + 1);
    }
  }

  const auditByCategory = new Map((auditSummary.categories || []).map((row) => [row.category, row]));
  return [...topics.values()].map((bucket) => {
    const audit = auditByCategory.get(bucket.topic);
    const avgScore = Math.round(bucket.scoreTotal / bucket.promptCount);
    const avgMention = Math.round(bucket.mentionTotal / bucket.promptCount);
    const pageScore = audit?.avgScore ?? null;
    const topCompetitors = [...bucket.competitors.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([brand]) => brand);
    const riskScore = Math.min(100, Math.round((100 - avgScore) * 0.35 + (100 - avgMention) * 0.25 + (pageScore === null ? 30 : 100 - pageScore) * 0.25 + bucket.zeroMentionPrompts * 4));
    return {
      topic: bucket.topic,
      promptCount: bucket.promptCount,
      zeroMentionPrompts: bucket.zeroMentionPrompts,
      avgAiScore: avgScore,
      avgMention,
      competitorOnly: bucket.competitorOnly,
      auditedPages: audit?.count ?? 0,
      avgPageScore: pageScore,
      riskScore,
      topCompetitors,
    };
  }).sort((a, b) => b.riskScore - a.riskScore);
}

function buildPageQueue(queryMatrix, auditRows) {
  const bySlug = new Map();
  for (const query of queryMatrix) {
    if (!query.pageUrl) continue;
    const slug = normalizeSlug(slugFromUrl(query.pageUrl));
    const bucket = bySlug.get(slug) || {
      url: query.pageUrl,
      title: query.closestPost,
      category: query.category,
      pageScore: query.pageScore,
      source: query.pageSource,
      prompts: [],
      competitors: new Set(),
      issues: query.structuralIssues,
      maxOpportunity: 0,
    };
    bucket.prompts.push(query.prompt);
    for (const competitor of query.competitors) bucket.competitors.add(competitor);
    bucket.maxOpportunity = Math.max(bucket.maxOpportunity, query.opportunityScore);
    bySlug.set(slug, bucket);
  }

  for (const row of auditRows.filter((item) => item.status !== "failed")) {
    const slug = normalizeSlug(slugFromUrl(row.url));
    if (bySlug.has(slug)) continue;
    const issues = structuralIssues(row);
    if (Number(row.aiCitabilityScore || 0) >= 68 && issues.length < 4) continue;
    bySlug.set(slug, {
      url: row.url,
      title: row.title,
      category: row.category,
      pageScore: row.aiCitabilityScore,
      source: row.source,
      prompts: [],
      competitors: new Set(row.competitorBrands || []),
      issues,
      maxOpportunity: 0,
    });
  }

  return [...bySlug.values()].map((page) => ({
    ...page,
    competitors: [...page.competitors],
    refreshPriority: Math.min(100, Math.round(page.maxOpportunity * 0.65 + (100 - Number(page.pageScore || 50)) * 0.35 + Math.min(12, page.issues.length * 2))),
  })).sort((a, b) => b.refreshPriority - a.refreshPriority || Number(a.pageScore || 100) - Number(b.pageScore || 100));
}

function buildMarkdown({ summary, deep, audit, stats, queryMatrix, battlecards, topicMatrix, pageQueue }) {
  const topCompetitors = battlecards.slice(0, 10).map((row) =>
    `| ${row.brand} | ${row.answerCount} | ${row.withIbolt} | ${row.withoutIbolt} | ${row.coMentionRate}% | ${row.lostPrompts.slice(0, 2).join("; ")} |`
  ).join("\n");
  const topQueries = queryMatrix.slice(0, 16).map((row) =>
    `| ${row.opportunityScore} | ${row.prompt} | ${row.category} | ${row.averageScore} | ${row.mentionRate}% | ${row.pageScore ?? "n/a"} | ${row.competitors.slice(0, 4).join(", ")} | ${row.structuralIssues.slice(0, 3).join(", ")} |`
  ).join("\n");
  const topics = topicMatrix.map((row) =>
    `| ${row.topic} | ${row.riskScore} | ${row.promptCount} | ${row.zeroMentionPrompts} | ${row.avgAiScore} | ${row.avgMention}% | ${row.auditedPages} | ${row.avgPageScore ?? "n/a"} | ${row.topCompetitors.slice(0, 4).join(", ")} |`
  ).join("\n");
  const pages = pageQueue.slice(0, 24).map((row) =>
    `| ${row.refreshPriority} | [${row.title}](${row.url}) | ${row.category} | ${row.pageScore ?? "n/a"} | ${row.prompts.slice(0, 2).join("; ")} | ${row.issues.slice(0, 4).join(", ")} |`
  ).join("\n");
  return `# iBOLT Competitive AI Visibility Matrix

Source benchmark: ${summary.current.run.id}
Source audit pages: ${audit.summary.ok}/${audit.summary.total}

## Executive Readout

- Current consumer-model benchmark: ${stats.mentions}/${stats.total} answers mentioned iBOLT (${pct(stats.mentions, stats.total)}%).
- Non-branded visibility is the real weakness: ${stats.nonBrandedMentions}/${stats.nonBranded} non-branded answers mentioned iBOLT (${pct(stats.nonBrandedMentions, stats.nonBranded)}%).
- Top-3 recommendation rate: ${stats.topThree}/${stats.total} (${pct(stats.topThree, stats.total)}%).
- Citation rate in this benchmark: ${stats.citations}/${stats.total} (${pct(stats.citations, stats.total)}%).
- Competitors or adjacent brands appeared without iBOLT in ${stats.rawCompetitorOnly} raw detector rows (${deep.competitorOnlyAnswers.length} normalized matrix rows).
- Live blog/page AI-citability score: ${audit.summary.avgScore}/100 average across ${audit.summary.ok} audited pages.

## What This Means

iBOLT has enough content to compete in many topics, but the content is not consistently packaged in a way AI systems choose as an answer source. The near-term goal is not just new blog volume. It is raising the citation readiness of the pages that already match high-intent prompts.

## Competitor Battlecards

| Competitor | AI answers | With iBOLT | Without iBOLT | Co-mention rate | Example lost prompts |
| --- | ---: | ---: | ---: | ---: | --- |
${topCompetitors}

## Query Opportunity Matrix

| Opportunity | Prompt | Topic | AI score | Mention | Page score | Competitors | Missing structure |
| ---: | --- | --- | ---: | ---: | ---: | --- | --- |
${topQueries}

## Topic Risk Matrix

| Topic | Risk | Prompts | Zero-mention prompts | Avg AI score | Avg mention | Audited pages | Avg page score | Top competitors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
${topics}

## Page Refresh Queue

| Priority | Page | Topic | Page score | Linked prompts | Fixes |
| ---: | --- | --- | ---: | --- | --- |
${pages}

## Practical Recommendation

1. Refresh the high-opportunity pages first, especially delivery, fleet, fishing, restaurant, warehouse, and AMPS/modular pages where competitors appear without iBOLT.
2. Add a 40-60 word quick answer block near the top of each target page.
3. Add FAQ schema where FAQ copy already exists, then add new FAQ copy where it does not.
4. Add comparison/tradeoff blocks that name the brands AI already recommends: RAM Mounts, Arkon, iOttie, ProClip, Mount-It, and marine brands.
5. Add BlogPosting/Article schema to generated posts and validate Product/Offer schema on linked product pages.
`;
}

function buildHtml({ stats, audit, queryMatrix, battlecards, topicMatrix, pageQueue }) {
  const cards = [
    ["AI answers", stats.total, "ChatGPT, Gemini, Claude"],
    ["Mention rate", `${pct(stats.mentions, stats.total)}%`, `${stats.mentions}/${stats.total} answers`],
    ["Non-branded mention", `${pct(stats.nonBrandedMentions, stats.nonBranded)}%`, `${stats.nonBrandedMentions}/${stats.nonBranded} answers`],
    ["Top-3 rate", `${pct(stats.topThree, stats.total)}%`, `${stats.topThree}/${stats.total} answers`],
    ["Citation rate", `${pct(stats.citations, stats.total)}%`, `${stats.citations}/${stats.total} answers`],
    ["Competitor-only", stats.rawCompetitorOnly, `${stats.matrixCompetitorOnly} normalized matrix rows`],
    ["Page readiness", `${audit.summary.avgScore}/100`, `${audit.summary.ok} audited pages`],
  ].map(([label, value, note]) => `
    <div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div><div class="s">${escapeHtml(note)}</div></div>
  `).join("");
  const competitors = battlecards.slice(0, 14).map((row) => `
    <tr>
      <td><b>${escapeHtml(row.brand)}</b><br><span>${escapeHtml(row.type)}</span></td>
      <td>${row.answerCount}</td><td>${row.withIbolt}</td><td>${row.withoutIbolt}</td><td>${row.coMentionRate}%</td>
      <td>${escapeHtml(row.lostPrompts.slice(0, 4).join("; "))}</td>
      <td>${escapeHtml(row.positioningAngle)}</td>
    </tr>
  `).join("");
  const queries = queryMatrix.slice(0, 24).map((row) => `
    <tr>
      <td>${row.opportunityScore}</td><td><b>${escapeHtml(row.prompt)}</b><br><span>${escapeHtml(row.category)}</span></td>
      <td>${row.averageScore}</td><td>${row.mentionRate}%</td><td>${escapeHtml(row.contentCoverage)}</td>
      <td>${row.pageScore ?? "n/a"}</td><td>${escapeHtml(row.competitors.slice(0, 5).join(", "))}</td>
      <td>${escapeHtml(row.structuralIssues.slice(0, 4).join(", "))}</td>
    </tr>
  `).join("");
  const topics = topicMatrix.map((row) => `
    <tr>
      <td><b>${escapeHtml(row.topic)}</b></td><td>${row.riskScore}</td><td>${row.promptCount}</td><td>${row.zeroMentionPrompts}</td>
      <td>${row.avgAiScore}</td><td>${row.avgMention}%</td><td>${row.auditedPages}</td><td>${row.avgPageScore ?? "n/a"}</td>
      <td>${escapeHtml(row.topCompetitors.slice(0, 5).join(", "))}</td>
    </tr>
  `).join("");
  const pages = pageQueue.slice(0, 30).map((row) => `
    <tr>
      <td>${row.refreshPriority}</td><td><a href="${escapeHtml(row.url)}">${escapeHtml(row.title)}</a><br><span>${escapeHtml(row.source)}</span></td>
      <td>${escapeHtml(row.category)}</td><td>${row.pageScore ?? "n/a"}</td>
      <td>${escapeHtml(row.prompts.slice(0, 3).join("; "))}</td>
      <td>${escapeHtml(row.competitors.slice(0, 5).join(", "))}</td>
      <td>${escapeHtml(row.issues.slice(0, 5).join(", "))}</td>
    </tr>
  `).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT Competitive AI Visibility Matrix</title>
  <style>
    :root{color-scheme:light;--ink:#111827;--muted:#64748b;--border:#d7dee8;--bg:#f8fafc;--panel:#fff;--blue:#2563eb}
    body{margin:0;background:var(--bg);font-family:Arial,Helvetica,sans-serif;color:var(--ink)}
    main{max-width:1260px;margin:0 auto;padding:34px 26px 64px}
    h1{font-size:34px;line-height:1.08;margin:0 0 10px}h2{font-size:22px;margin:34px 0 14px}
    p{font-size:16px;line-height:1.55;color:#334155;max-width:960px}.meta{font-size:14px;color:var(--muted)}
    .takeaway{background:#fff;border:1px solid var(--border);border-left:6px solid var(--blue);border-radius:10px;padding:16px 18px}
    .grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin:22px 0}
    .card{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:16px}.k{font-size:12px;color:var(--muted);letter-spacing:.06em;text-transform:uppercase;font-weight:700}.v{font-size:30px;font-weight:800;margin-top:8px}.s{font-size:13px;color:var(--muted);margin-top:4px}
    figure{background:#fff;border:1px solid var(--border);border-radius:14px;margin:14px 0;padding:10px;overflow:auto}figure img{display:block;width:100%;height:auto}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:22px}
    th,td{font-size:14px;text-align:left;vertical-align:top;padding:11px 12px;border-bottom:1px solid #edf2f7}th{background:#f1f5f9;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#475569}td span{color:#64748b;font-size:12px}a{color:#0f3f91}
    @media(max-width:980px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media print{body{background:#fff}main{max-width:none;padding:18px}.grid{grid-template-columns:repeat(6,1fr)}figure,.card,table{break-inside:avoid}}
  </style>
</head>
<body><main>
  <div class="meta">Generated from OpenRouter benchmark and merged live blog audit</div>
  <h1>iBOLT Competitive AI Visibility Matrix</h1>
  <p class="takeaway"><strong>Bottom line:</strong> iBOLT has enough content to compete, but AI systems still choose RAM, Arkon, iOttie, ProClip, Mount-It, and marine brands too often. The fastest path is refreshing existing high-intent pages with quick answers, FAQ schema, comparison blocks, and clearer product-specific citations.</p>
  <section class="grid">${cards}</section>
  <h2>Charts</h2>
  <figure><img src="competitor-displacement.svg" alt="Competitor displacement chart"/></figure>
  <figure><img src="query-opportunity.svg" alt="Query opportunity chart"/></figure>
  <figure><img src="topic-risk.svg" alt="Topic risk chart"/></figure>
  <figure><img src="remediation-backlog.svg" alt="Remediation backlog chart"/></figure>
  <h2>Competitor Battlecards</h2>
  <table><thead><tr><th>Brand</th><th>Answers</th><th>With iBOLT</th><th>Without iBOLT</th><th>Co-mention</th><th>Lost prompts</th><th>Counter-positioning</th></tr></thead><tbody>${competitors}</tbody></table>
  <h2>Query Opportunity Matrix</h2>
  <table><thead><tr><th>Opp.</th><th>Prompt</th><th>AI score</th><th>Mention</th><th>Coverage</th><th>Page score</th><th>Competitors</th><th>Missing structure</th></tr></thead><tbody>${queries}</tbody></table>
  <h2>Topic Risk Matrix</h2>
  <table><thead><tr><th>Topic</th><th>Risk</th><th>Prompts</th><th>Zero mention</th><th>AI score</th><th>Mention</th><th>Pages</th><th>Page score</th><th>Top competitors</th></tr></thead><tbody>${topics}</tbody></table>
  <h2>Page Refresh Queue</h2>
  <table><thead><tr><th>Priority</th><th>Page</th><th>Topic</th><th>Score</th><th>Linked prompts</th><th>Competitors</th><th>Fixes</th></tr></thead><tbody>${pages}</tbody></table>
</main></body></html>`;
}

async function main() {
  const benchmarkDir = process.argv[2] ? path.resolve(process.argv[2]) : await latestDir(BENCHMARK_PREFIX);
  const auditDir = process.argv[3] ? path.resolve(process.argv[3]) : await latestDir(AUDIT_PREFIX);
  const summary = JSON.parse(await readFile(path.join(benchmarkDir, "summary.json"), "utf8"));
  const deep = JSON.parse(await readFile(path.join(benchmarkDir, "deep-dive", "deep-visibility-data.json"), "utf8"));
  const answerEvidence = await readOptionalJson(path.join(benchmarkDir, "answer-evidence-pack", "answer-evidence-data.json"));
  const audit = JSON.parse(await readFile(path.join(auditDir, "live-blog-page-audit.merged.json"), "utf8"));
  const auditIndexes = buildAuditIndexes(audit.rows || []);
  const stats = {
    ...resultStats(summary.current),
    rawCompetitorOnly: answerEvidence?.stats?.competitorOnlyRows ?? deep.competitorOnlyAnswers.length,
    matrixCompetitorOnly: deep.competitorOnlyAnswers.length,
  };
  const queryMatrix = buildQueryMatrix(summary, deep, auditIndexes);
  const battlecards = buildCompetitorBattlecards(deep, queryMatrix);
  const topicMatrix = buildTopicMatrix(queryMatrix, audit.summary, deep);
  const pageQueue = buildPageQueue(queryMatrix, audit.rows || []);
  const outDir = path.join(benchmarkDir, "competitive-matrix");
  await mkdir(outDir, { recursive: true });

  await writeFile(path.join(outDir, "query-opportunity-matrix.csv"), csv([
    ["opportunity_score", "prompt", "category", "ai_score", "mention_rate", "content_coverage", "closest_post", "closest_slug", "closest_match_score", "page_url", "page_score", "page_source", "competitor_only_answers", "competitors", "missing_structure", "weakest_providers", "recommended_action"],
    ...queryMatrix.map((row) => [
      row.opportunityScore,
      row.prompt,
      row.category,
      row.averageScore,
      row.mentionRate,
      row.contentCoverage,
      row.closestPost,
      row.closestSlug,
      row.closestScore,
      row.pageUrl,
      row.pageScore ?? "",
      row.pageSource,
      row.competitorOnlyCount,
      row.competitors,
      row.structuralIssues,
      row.weakestProviders.map(providerLabel),
      row.recommendedAction,
    ]),
  ]));

  await writeFile(path.join(outDir, "competitor-battlecards.csv"), csv([
    ["brand", "type", "answer_count", "with_ibolt", "without_ibolt", "co_mention_rate", "providers", "categories", "lost_prompts", "pages_to_refresh", "counter_positioning"],
    ...battlecards.map((row) => [
      row.brand,
      row.type,
      row.answerCount,
      row.withIbolt,
      row.withoutIbolt,
      row.coMentionRate,
      row.providers,
      row.categories,
      row.lostPrompts,
      row.pagesToRefresh,
      row.positioningAngle,
    ]),
  ]));

  await writeFile(path.join(outDir, "topic-risk-matrix.csv"), csv([
    ["topic", "risk_score", "prompt_count", "zero_mention_prompts", "avg_ai_score", "avg_mention_rate", "competitor_only_answers", "audited_pages", "avg_page_score", "top_competitors"],
    ...topicMatrix.map((row) => [
      row.topic,
      row.riskScore,
      row.promptCount,
      row.zeroMentionPrompts,
      row.avgAiScore,
      row.avgMention,
      row.competitorOnly,
      row.auditedPages,
      row.avgPageScore ?? "",
      row.topCompetitors,
    ]),
  ]));

  await writeFile(path.join(outDir, "page-refresh-queue.csv"), csv([
    ["refresh_priority", "title", "url", "category", "page_score", "source", "linked_prompts", "competitors", "fixes"],
    ...pageQueue.map((row) => [
      row.refreshPriority,
      row.title,
      row.url,
      row.category,
      row.pageScore ?? "",
      row.source,
      row.prompts,
      row.competitors,
      row.issues,
    ]),
  ]));

  await writeFile(path.join(outDir, "competitive-matrix-data.json"), JSON.stringify({
    benchmarkDir,
    auditDir,
    stats,
    queryMatrix,
    battlecards,
    topicMatrix,
    pageQueue,
  }, null, 2));

  await writeSvgAndPng(outDir, "competitor-displacement", barChart({
    title: "Competitors Appearing Without iBOLT",
    subtitle: "Answer count where the brand appeared and iBOLT did not.",
    rows: battlecards.slice(0, 14).map((row) => ({
      label: row.brand,
      value: row.withoutIbolt,
      note: `${row.type}; co-mention ${row.coMentionRate}%`,
    })),
    color: "#dc2626",
  }));
  await writeSvgAndPng(outDir, "query-opportunity", barChart({
    title: "Highest Query Opportunities",
    subtitle: "Combines AI score gap, mention gap, competitor pressure, and matching page readiness.",
    rows: queryMatrix.slice(0, 16).map((row) => ({
      label: row.prompt,
      value: row.opportunityScore,
      note: `${row.category}; ${row.competitors.slice(0, 3).join(", ") || "no competitor detected"}`,
    })),
    color: "#7c3aed",
    maxValue: 100,
  }));
  await writeSvgAndPng(outDir, "topic-risk", barChart({
    title: "Topic Risk And Opportunity",
    subtitle: "Higher bars mean lower AI visibility, weaker mention rate, and/or weaker page readiness.",
    rows: topicMatrix.map((row) => ({
      label: row.topic,
      value: row.riskScore,
      note: `${row.zeroMentionPrompts}/${row.promptCount} prompts at 0% mention; page score ${row.avgPageScore ?? "n/a"}`,
    })),
    color: "#0891b2",
    maxValue: 100,
  }));
  await writeSvgAndPng(outDir, "remediation-backlog", remediationChart(audit.summary, audit.summary.ok));
  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown({ summary, deep, audit, stats, queryMatrix, battlecards, topicMatrix, pageQueue }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({ stats, audit, queryMatrix, battlecards, topicMatrix, pageQueue }));

  console.log(path.relative(process.cwd(), outDir));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
