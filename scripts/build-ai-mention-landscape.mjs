import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";
const AUDIT_PREFIX = "live-blog-ai-citability-merged-";

let sharpModulePromise = null;

const PROVIDER_LABELS = {
  chatgpt: "ChatGPT",
  gemini_plain: "Gemini",
  claude: "Claude",
};

const BRAND_ALIASES = new Map([
  ["ram", "RAM Mounts"],
  ["ram mounts", "RAM Mounts"],
  ["mount-it!", "Mount-It"],
  ["mount-it", "Mount-It"],
  ["iottie", "iOttie"],
  ["proclip", "ProClip"],
  ["arkon", "Arkon"],
  ["bouncepad", "Bouncepad"],
  ["square", "Square"],
  ["tackform", "Tackform"],
  ["zebra", "Zebra"],
  ["havis", "Havis"],
  ["kensington", "Kensington"],
  ["cta digital", "CTA Digital"],
  ["heckler", "Heckler"],
  ["scosche", "Scosche"],
  ["belkin", "Belkin"],
  ["quad lock", "Quad Lock"],
  ["peak design", "Peak Design"],
  ["lamicall", "Lamicall"],
  ["yakattack", "YakAttack"],
  ["scotty", "Scotty"],
  ["garmin", "Garmin"],
  ["lowrance", "Lowrance"],
  ["humminbird", "Humminbird"],
  ["tackform", "Tackform"],
]);

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

function avg(values) {
  const nums = values.map(Number).filter((value) => Number.isFinite(value));
  return nums.length ? Math.round(nums.reduce((sum, value) => sum + value, 0) / nums.length) : 0;
}

function csvCell(value) {
  if (Array.isArray(value)) value = value.join("; ");
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function csv(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
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
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const headers = rows.shift() ?? [];
  return rows
    .filter((items) => items.length === headers.length)
    .map((items) => Object.fromEntries(headers.map((header, index) => [header, items[index]])));
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

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function normalizeBrand(brand) {
  const cleaned = String(brand ?? "").trim().replace(/\s+/g, " ");
  if (!cleaned) return "";
  return BRAND_ALIASES.get(cleaned.toLowerCase()) ?? cleaned;
}

function splitCompetitors(value) {
  return [...new Set(String(value ?? "")
    .split(/;|,/)
    .map(normalizeBrand)
    .filter(Boolean)
    .filter((brand) => !/^ibolt$/i.test(brand) && !/^ibolt mounts$/i.test(brand)))];
}

function rowKey(...parts) {
  return parts.map((part) => String(part ?? "")).join("||");
}

function toResult(row) {
  const competitors = splitCompetitors(row.competitors);
  const brandMentioned = row.brand_mentioned === "true";
  const topPickRank = Number(row.top_pick_rank || 0) || null;
  return {
    provider: row.provider,
    providerLabel: PROVIDER_LABELS[row.provider] ?? row.provider,
    query: row.query,
    category: row.category || "unknown",
    priority: Number(row.priority || 0),
    status: row.status,
    model: row.model,
    score: Number(row.coverage_score || 0),
    brandMentioned,
    domainCited: row.domain_cited === "true",
    topPickRank,
    topThree: Boolean(topPickRank && topPickRank <= 3),
    sentiment: row.sentiment || "",
    competitors,
    mentionedProducts: String(row.mentioned_products || "").split(/;|,/).map((item) => item.trim()).filter(Boolean),
    analysisNotes: row.analysis_notes || "",
  };
}

function summarizeGroup(rows) {
  const completed = rows.filter((row) => row.status === "completed");
  const mentions = completed.filter((row) => row.brandMentioned).length;
  const citations = completed.filter((row) => row.domainCited).length;
  const topThree = completed.filter((row) => row.topThree).length;
  const competitorOnly = completed.filter((row) => !row.brandMentioned && row.competitors.length).length;
  return {
    resultCount: rows.length,
    completedCount: completed.length,
    mentionCount: mentions,
    mentionRate: pct(mentions, completed.length),
    citationCount: citations,
    citationRate: pct(citations, completed.length),
    topThreeCount: topThree,
    topThreeRate: pct(topThree, completed.length),
    competitorOnlyCount: competitorOnly,
    competitorOnlyRate: pct(competitorOnly, completed.length),
    avgScore: avg(completed.map((row) => row.score)),
  };
}

function buildProviderCategoryRows(results) {
  const groups = new Map();
  for (const row of results) {
    const key = rowKey(row.provider, row.category);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key, rows]) => {
    const [provider, category] = key.split("||");
    const summary = summarizeGroup(rows);
    const topCompetitors = countBrands(rows.flatMap((row) => row.competitors)).slice(0, 6);
    return {
      provider,
      providerLabel: PROVIDER_LABELS[provider] ?? provider,
      category,
      ...summary,
      topCompetitors: topCompetitors.map((row) => `${row.brand} ${row.count}`),
    };
  }).sort((a, b) => a.providerLabel.localeCompare(b.providerLabel) || b.competitorOnlyRate - a.competitorOnlyRate || a.category.localeCompare(b.category));
}

function countBrands(brands) {
  const counts = new Map();
  for (const brand of brands.map(normalizeBrand).filter(Boolean)) {
    counts.set(brand, (counts.get(brand) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([brand, count]) => ({ brand, count }))
    .sort((a, b) => b.count - a.count || a.brand.localeCompare(b.brand));
}

function buildCoMentionRows(results) {
  const byBrand = new Map();
  for (const row of results) {
    for (const brand of row.competitors) {
      if (!byBrand.has(brand)) {
        byBrand.set(brand, {
          brand,
          answerCount: 0,
          withIbolt: 0,
          withoutIbolt: 0,
          providers: new Map(),
          categories: new Map(),
          lostPrompts: new Map(),
          coPrompts: new Map(),
          scores: [],
        });
      }
      const item = byBrand.get(brand);
      item.answerCount += 1;
      item.scores.push(row.score);
      item.providers.set(row.providerLabel, (item.providers.get(row.providerLabel) ?? 0) + 1);
      item.categories.set(row.category, (item.categories.get(row.category) ?? 0) + 1);
      if (row.brandMentioned) {
        item.withIbolt += 1;
        item.coPrompts.set(row.query, (item.coPrompts.get(row.query) ?? 0) + 1);
      } else {
        item.withoutIbolt += 1;
        item.lostPrompts.set(row.query, (item.lostPrompts.get(row.query) ?? 0) + 1);
      }
    }
  }
  return [...byBrand.values()].map((item) => ({
    brand: item.brand,
    answerCount: item.answerCount,
    withIbolt: item.withIbolt,
    withoutIbolt: item.withoutIbolt,
    coMentionRate: pct(item.withIbolt, item.answerCount),
    avgIboltScoreWhenPresent: avg(results
      .filter((row) => row.brandMentioned && row.competitors.includes(item.brand))
      .map((row) => row.score)),
    providers: topMap(item.providers, 4).map(([name, count]) => `${name} ${count}`),
    categories: topMap(item.categories, 6).map(([name, count]) => `${name} ${count}`),
    lostPrompts: topMap(item.lostPrompts, 8).map(([name]) => name),
    coPrompts: topMap(item.coPrompts, 8).map(([name]) => name),
  })).sort((a, b) => b.withoutIbolt - a.withoutIbolt || b.answerCount - a.answerCount || a.brand.localeCompare(b.brand));
}

function buildMatrixCoMentionRows(battlecards) {
  return battlecards.map((row) => ({
    brand: row.brand,
    answerCount: Number(row.answerCount || 0),
    withIbolt: Number(row.withIbolt || 0),
    withoutIbolt: Number(row.withoutIbolt || 0),
    coMentionRate: Number(row.coMentionRate || 0),
    avgIboltScoreWhenPresent: "",
    providers: String(row.providers || "").split(";").map((item) => item.trim()).filter(Boolean),
    categories: String(row.categories || "").split(";").map((item) => item.trim()).filter(Boolean),
    lostPrompts: row.lostPrompts ?? [],
    coPrompts: [],
    positioningAngle: row.positioningAngle ?? "",
    source: "competitive-matrix",
  })).sort((a, b) => b.withoutIbolt - a.withoutIbolt || b.answerCount - a.answerCount || a.brand.localeCompare(b.brand));
}

function buildRawOnlyBrandRows(rawRows, matrixRows) {
  const matrixBrands = new Map(matrixRows.map((row) => [row.brand, row]));
  return rawRows
    .map((row) => {
      const matrix = matrixBrands.get(row.brand);
      return {
        ...row,
        matrixAnswerCount: matrix?.answerCount ?? 0,
        matrixWithIbolt: matrix?.withIbolt ?? 0,
        matrixWithoutIbolt: matrix?.withoutIbolt ?? 0,
        difference: row.answerCount - (matrix?.answerCount ?? 0),
      };
    })
    .filter((row) => row.difference !== 0 || !matrixBrands.has(row.brand))
    .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || b.answerCount - a.answerCount);
}

function topMap(map, limit) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

function buildPromptGrid(results, queryMatrix) {
  const queryMeta = new Map(queryMatrix.map((row) => [row.prompt, row]));
  const byQuery = new Map();
  for (const row of results) {
    if (!byQuery.has(row.query)) byQuery.set(row.query, []);
    byQuery.get(row.query).push(row);
  }
  return [...byQuery.entries()].map(([query, rows]) => {
    const summary = summarizeGroup(rows);
    const meta = queryMeta.get(query) ?? {};
    const providerCells = Object.keys(PROVIDER_LABELS).map((provider) => {
      const result = rows.find((row) => row.provider === provider);
      if (!result) return `${PROVIDER_LABELS[provider]}: n/a`;
      const status = result.brandMentioned ? `mentioned ${result.score}` : `missed ${result.score}`;
      const rank = result.topPickRank ? `rank ${result.topPickRank}` : "no rank";
      const competitors = result.competitors.slice(0, 4).join("/") || "none";
      return `${PROVIDER_LABELS[provider]}: ${status}, ${rank}, competitors ${competitors}`;
    });
    const allCompetitors = countBrands(rows.flatMap((row) => row.competitors)).map((row) => row.brand);
    return {
      query,
      category: rows[0]?.category ?? meta.category ?? "",
      priority: rows[0]?.priority ?? meta.priority ?? "",
      avgScore: summary.avgScore,
      mentionRate: summary.mentionRate,
      topThreeRate: summary.topThreeRate,
      competitorOnlyCount: summary.competitorOnlyCount,
      competitors: allCompetitors.slice(0, 8),
      providerCells,
      pageUrl: meta.pageUrl ?? "",
      pageTitle: meta.closestPost ?? "",
      pageScore: meta.pageScore ?? "",
      structuralIssues: meta.structuralIssues ?? [],
      opportunityScore: meta.opportunityScore ?? "",
      recommendedAction: meta.recommendedAction ?? "",
    };
  }).sort((a, b) => (Number(b.opportunityScore || 0) - Number(a.opportunityScore || 0)) || a.query.localeCompare(b.query));
}

function buildLostAnswerRows(results, queryMatrix) {
  const queryMeta = new Map(queryMatrix.map((row) => [row.prompt, row]));
  return results
    .filter((row) => row.status === "completed" && !row.brandMentioned && row.competitors.length)
    .map((row) => {
      const meta = queryMeta.get(row.query) ?? {};
      return {
        provider: row.providerLabel,
        query: row.query,
        category: row.category,
        score: row.score,
        competitors: row.competitors,
        pageTitle: meta.closestPost ?? "",
        pageUrl: meta.pageUrl ?? "",
        pageScore: meta.pageScore ?? "",
        structuralIssues: meta.structuralIssues ?? [],
        fix: buildFixLabel(row, meta),
        notes: row.analysisNotes,
      };
    })
    .sort((a, b) => b.competitors.length - a.competitors.length || a.score - b.score || a.query.localeCompare(b.query));
}

function buildFixLabel(row, meta) {
  const issues = new Set(meta.structuralIssues ?? []);
  const parts = [];
  if (issues.has("quick answer")) parts.push("add query-exact quick answer");
  if (issues.has("FAQ schema")) parts.push("add FAQ schema");
  if (issues.has("comparison block")) parts.push("add competitor comparison");
  if (!parts.length) parts.push("strengthen product recommendation and citations");
  if (row.competitors.length) parts.push(`counter ${row.competitors.slice(0, 3).join(", ")}`);
  return parts.join("; ");
}

function buildTopicRows(results, matrixTopicRows, blogTopicRows) {
  const byCategory = new Map();
  for (const row of results) {
    if (!byCategory.has(row.category)) byCategory.set(row.category, []);
    byCategory.get(row.category).push(row);
  }
  const matrixByTopic = new Map(matrixTopicRows.map((row) => [row.topic, row]));
  const blogByTopic = new Map(blogTopicRows.map((row) => [row.topic, row]));
  return [...byCategory.entries()].map(([category, rows]) => {
    const summary = summarizeGroup(rows);
    const matrix = matrixByTopic.get(category) ?? {};
    const blog = blogByTopic.get(category) ?? {};
    return {
      topic: category,
      resultCount: rows.length,
      mentionRate: summary.mentionRate,
      competitorOnlyRate: summary.competitorOnlyRate,
      avgScore: summary.avgScore,
      zeroMentionPrompts: matrix.zeroMentionPrompts ?? "",
      riskScore: matrix.riskScore ?? "",
      auditedPages: matrix.auditedPages ?? "",
      avgPageScore: matrix.avgPageScore ?? "",
      localPosts: blog.posts ?? "",
      uniqueProducts: blog.uniqueProducts ?? "",
      topCompetitors: countBrands(rows.flatMap((row) => row.competitors)).slice(0, 7).map((item) => `${item.brand} ${item.count}`),
    };
  }).sort((a, b) => Number(b.riskScore || 0) - Number(a.riskScore || 0) || b.competitorOnlyRate - a.competitorOnlyRate);
}

function buildPageActionRows(promptGrid, pageQueue, liveAuditRows) {
  const auditByUrl = new Map(liveAuditRows.map((row) => [row.url, row]));
  const grouped = new Map();
  for (const row of promptGrid) {
    if (!row.pageUrl) continue;
    if (!grouped.has(row.pageUrl)) {
      grouped.set(row.pageUrl, {
        pageUrl: row.pageUrl,
        pageTitle: row.pageTitle,
        category: row.category,
        prompts: [],
        opportunityScore: 0,
        avgPromptScoreValues: [],
        competitors: new Set(),
        structuralIssues: new Set(),
      });
    }
    const item = grouped.get(row.pageUrl);
    item.prompts.push(row.query);
    item.opportunityScore = Math.max(item.opportunityScore, Number(row.opportunityScore || 0));
    item.avgPromptScoreValues.push(Number(row.avgScore || 0));
    for (const brand of row.competitors) item.competitors.add(brand);
    for (const issue of row.structuralIssues) item.structuralIssues.add(issue);
  }
  const queueByUrl = new Map(pageQueue.map((row) => [row.url, row]));
  return [...grouped.values()].map((item) => {
    const audit = auditByUrl.get(item.pageUrl) ?? {};
    const queue = queueByUrl.get(item.pageUrl) ?? {};
    const pageScore = Number(audit.aiCitabilityScore ?? queue.pageScore ?? 0);
    const priority = Math.round(item.opportunityScore + Math.max(0, 85 - pageScore) + Math.min(12, item.prompts.length * 2));
    return {
      priority,
      pageTitle: item.pageTitle || audit.title || queue.title || "",
      pageUrl: item.pageUrl,
      category: item.category,
      promptCount: item.prompts.length,
      prompts: item.prompts.slice(0, 8),
      avgPromptScore: avg(item.avgPromptScoreValues),
      pageScore,
      competitors: [...item.competitors].slice(0, 8),
      structuralIssues: [...item.structuralIssues],
      concreteEdit: buildPageEdit([...item.structuralIssues], [...item.competitors]),
    };
  }).sort((a, b) => b.priority - a.priority || a.pageTitle.localeCompare(b.pageTitle));
}

function buildPageEdit(issues, competitors) {
  const pieces = [];
  if (issues.includes("quick answer")) pieces.push("open with a 2 to 4 sentence answer block");
  if (issues.includes("FAQ schema")) pieces.push("add FAQ section plus JSON-LD FAQPage schema");
  if (issues.includes("comparison block")) pieces.push("add direct comparison/tradeoff section");
  if (issues.includes("image alt text")) pieces.push("fix product image alt text");
  if (competitors.length) pieces.push(`name and differentiate from ${competitors.slice(0, 4).join(", ")}`);
  return pieces.join("; ") || "tighten product recommendation block and internal citations";
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

function stackedCompetitorChart(rows) {
  const width = 1160;
  const rowH = 50;
  const height = 128 + rows.length * rowH + 34;
  const left = 300;
  const top = 108;
  const barW = width - left - 152;
  const max = Math.max(1, ...rows.map((row) => row.answerCount));
  const body = rows.map((row, index) => {
    const y = top + index * rowH;
    const withW = Math.round((row.withIbolt / max) * barW);
    const withoutW = Math.round((row.withoutIbolt / max) * barW);
    const labels = wrapText(row.brand, 32).map((line, lineIndex) =>
      `<text class="${lineIndex === 0 ? "label" : "small"}" x="54" y="${y + 15 + lineIndex * 15}">${escapeHtml(line)}</text>`
    ).join("\n");
    return `
      ${labels}
      <rect x="${left}" y="${y}" width="${barW}" height="26" rx="8" fill="#e2e8f0"/>
      <rect x="${left}" y="${y}" width="${Math.max(withW, row.withIbolt ? 4 : 0)}" height="26" rx="8" fill="#16a34a"/>
      <rect x="${left + withW}" y="${y}" width="${Math.max(withoutW, row.withoutIbolt ? 4 : 0)}" height="26" rx="8" fill="#dc2626"/>
      <text class="value" x="${left + barW + 14}" y="${y + 18}">${row.withIbolt} with / ${row.withoutIbolt} without</text>
      <text class="small" x="${left}" y="${y + 43}">${escapeHtml(row.categories.join("; "))}</text>
    `;
  }).join("\n");
  return svgShell(width, height, `
    <rect class="panel" x="28" y="24" width="${width - 56}" height="${height - 48}" rx="14"/>
    <text class="title" x="54" y="64">Competitors Mentioned With iBOLT vs Instead of iBOLT</text>
    <text class="subtitle" x="54" y="88">Green means co-mentioned with iBOLT. Red means competitor appeared and iBOLT did not.</text>
    ${body}
  `);
}

function providerChart(providerRows) {
  const rows = Object.keys(PROVIDER_LABELS).map((provider) => {
    const providerGroup = providerRows.filter((row) => row.provider === provider);
    return {
      provider: PROVIDER_LABELS[provider],
      resultCount: providerGroup.reduce((sum, row) => sum + row.completedCount, 0),
      mentions: providerGroup.reduce((sum, row) => sum + row.mentionCount, 0),
      topThree: providerGroup.reduce((sum, row) => sum + row.topThreeCount, 0),
      competitorOnly: providerGroup.reduce((sum, row) => sum + row.competitorOnlyCount, 0),
      avgScore: avg(providerGroup.flatMap((row) => Array(row.completedCount).fill(row.avgScore))),
    };
  });
  const width = 1120;
  const height = 390;
  const max = Math.max(1, ...rows.flatMap((row) => [row.mentions, row.topThree, row.competitorOnly]));
  const groups = rows.map((row, index) => {
    const x = 135 + index * 330;
    const bars = [
      ["Mentions", row.mentions, "#16a34a", 0],
      ["Top 3", row.topThree, "#2563eb", 74],
      ["Comp only", row.competitorOnly, "#dc2626", 148],
    ].map(([label, value, color, offset]) => {
      const h = Math.round((value / max) * 160);
      return `
        <rect x="${x + offset}" y="${250 - h}" width="38" height="${h}" rx="8" fill="${color}"/>
        <text class="value" x="${x + offset + 19}" y="${242 - h}" text-anchor="middle">${value}</text>
        <text class="small" x="${x + offset + 19}" y="276" text-anchor="middle">${escapeHtml(label)}</text>
      `;
    }).join("\n");
    return `
      ${bars}
      <text class="label" x="${x + 93}" y="322" text-anchor="middle">${escapeHtml(row.provider)}</text>
      <text class="small" x="${x + 93}" y="342" text-anchor="middle">avg score ${row.avgScore}; n=${row.resultCount}</text>
    `;
  }).join("\n");
  return svgShell(width, height, `
    <rect class="panel" x="28" y="24" width="${width - 56}" height="${height - 48}" rx="14"/>
    <text class="title" x="54" y="64">Provider Behavior</text>
    <text class="subtitle" x="54" y="88">Shows whether each consumer model mentions iBOLT, ranks it, or recommends competitors without it.</text>
    ${groups}
  `);
}

function topicRiskChart(topicRows) {
  const width = 1220;
  const rowH = 46;
  const height = 130 + topicRows.length * rowH + 34;
  const left = 250;
  const top = 108;
  const barW = width - left - 250;
  const body = topicRows.map((row, index) => {
    const y = top + index * rowH;
    const mentionW = Math.round((row.mentionRate / 100) * barW);
    const lostW = Math.round((row.competitorOnlyRate / 100) * barW);
    return `
      <text class="label" x="54" y="${y + 17}">${escapeHtml(row.topic)}</text>
      <rect x="${left}" y="${y}" width="${barW}" height="24" rx="8" fill="#e2e8f0"/>
      <rect x="${left}" y="${y}" width="${Math.max(mentionW, row.mentionRate ? 4 : 0)}" height="24" rx="8" fill="#16a34a"/>
      <rect x="${left + mentionW}" y="${y}" width="${Math.max(lostW, row.competitorOnlyRate ? 4 : 0)}" height="24" rx="8" fill="#dc2626" opacity=".82"/>
      <text class="value" x="${left + barW + 14}" y="${y + 17}">${row.mentionRate}% / ${row.competitorOnlyRate}%</text>
      <text class="small" x="${left}" y="${y + 41}">risk ${escapeHtml(row.riskScore || "n/a")}; posts ${escapeHtml(row.localPosts || "n/a")}; products ${escapeHtml(row.uniqueProducts || "n/a")}</text>
    `;
  }).join("\n");
  return svgShell(width, height, `
    <rect class="panel" x="28" y="24" width="${width - 56}" height="${height - 48}" rx="14"/>
    <text class="title" x="54" y="64">Topic Risk and Content Coverage</text>
    <text class="subtitle" x="54" y="88">Green is iBOLT mention rate. Red is competitor-only answer rate. Inventory counts come from local blog/product audit.</text>
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

function buildHtml({ stats, providerCategoryRows, coMentionRows, rawOnlyRows, promptGrid, lostRows, topicRows, pageActions }) {
  const cards = [
    ["AI answers tested", stats.totalAnswers, "31 prompts across 3 providers"],
    ["iBOLT mentions", `${stats.mentions}/${stats.totalAnswers}`, `${stats.mentionRate}% overall`],
    ["Non-branded mentions", `${stats.nonBrandedMentions}/${stats.nonBrandedAnswers}`, `${stats.nonBrandedMentionRate}% on generic prompts`],
    ["Competitor-only answers", stats.competitorOnlyAnswers, "raw answer detector count"],
    ["Co-mentioned answers", stats.coMentionAnswers, "iBOLT plus at least one competitor"],
    ["Citation rate", `${stats.citations}/${stats.totalAnswers}`, `${stats.citationRate}% in this run`],
    ["Top-3 iBOLT picks", `${stats.topThree}/${stats.totalAnswers}`, `${stats.topThreeRate}%`],
    ["Catalog product aliases", stats.catalogProductAliasAnswers, "actual local product aliases"],
  ].map(([label, value, note]) => `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div><div class="s">${escapeHtml(note)}</div></div>`).join("");

  const topCompetitorRows = coMentionRows.slice(0, 12).map((row) => `
    <tr><td><b>${escapeHtml(row.brand)}</b></td><td>${row.answerCount}</td><td>${row.withIbolt}</td><td>${row.withoutIbolt}</td><td>${row.coMentionRate}%</td><td>${escapeHtml(row.categories.join("; "))}</td><td>${escapeHtml(row.lostPrompts.slice(0, 4).join("; "))}</td></tr>
  `).join("");
  const rawOnlyHtml = rawOnlyRows.slice(0, 10).map((row) => `
    <tr><td>${escapeHtml(row.brand)}</td><td>${row.answerCount}</td><td>${row.matrixAnswerCount}</td><td>${row.difference}</td><td>${row.withIbolt}</td><td>${row.withoutIbolt}</td><td>${escapeHtml(row.categories.join("; "))}</td></tr>
  `).join("");
  const providerRows = providerCategoryRows
    .filter((row) => row.completedCount)
    .slice(0, 30)
    .map((row) => `<tr><td>${escapeHtml(row.providerLabel)}</td><td>${escapeHtml(row.category)}</td><td>${row.avgScore}</td><td>${row.mentionRate}%</td><td>${row.topThreeRate}%</td><td>${row.competitorOnlyRate}%</td><td>${escapeHtml(row.topCompetitors.join("; "))}</td></tr>`)
    .join("");
  const promptRows = promptGrid.slice(0, 18).map((row) => `
    <tr><td>${escapeHtml(row.query)}</td><td>${escapeHtml(row.category)}</td><td>${row.opportunityScore}</td><td>${row.avgScore}</td><td>${row.mentionRate}%</td><td>${escapeHtml(row.competitors.join("; "))}</td><td><a href="${escapeHtml(row.pageUrl)}">${escapeHtml(row.pageTitle)}</a></td><td>${escapeHtml(row.structuralIssues.join("; "))}</td></tr>
  `).join("");
  const pageRows = pageActions.slice(0, 15).map((row) => `
    <tr><td>${row.priority}</td><td><a href="${escapeHtml(row.pageUrl)}">${escapeHtml(row.pageTitle)}</a></td><td>${escapeHtml(row.category)}</td><td>${row.promptCount}</td><td>${row.pageScore}</td><td>${escapeHtml(row.prompts.slice(0, 3).join("; "))}</td><td>${escapeHtml(row.concreteEdit)}</td></tr>
  `).join("");
  const topicRowsHtml = topicRows.map((row) => `
    <tr><td>${escapeHtml(row.topic)}</td><td>${row.riskScore}</td><td>${row.avgScore}</td><td>${row.mentionRate}%</td><td>${row.competitorOnlyRate}%</td><td>${escapeHtml(row.localPosts)}</td><td>${escapeHtml(row.uniqueProducts)}</td><td>${escapeHtml(row.topCompetitors.join("; "))}</td></tr>
  `).join("");
  const lostRowsHtml = lostRows.slice(0, 20).map((row) => `
    <tr><td>${escapeHtml(row.provider)}</td><td>${escapeHtml(row.query)}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.competitors.join("; "))}</td><td>${escapeHtml(row.fix)}</td></tr>
  `).join("");

  return `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT AI Mention Landscape</title>
  <style>
    :root{--ink:#111827;--muted:#64748b;--border:#d7dee8;--bg:#f8fafc;--panel:#fff}
    body{margin:0;background:var(--bg);font-family:Arial,Helvetica,sans-serif;color:var(--ink)}
    main{max-width:1280px;margin:0 auto;padding:34px 26px 64px}h1{font-size:34px;margin:0 0 10px}h2{font-size:22px;margin:34px 0 14px}p{font-size:16px;line-height:1.55;color:#334155;max-width:1020px}.meta{font-size:14px;color:var(--muted)}
    .note{background:#fff;border:1px solid var(--border);border-left:6px solid #2563eb;border-radius:10px;padding:16px 18px}
    .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid var(--border);border-radius:12px;padding:16px}.k{font-size:12px;color:var(--muted);letter-spacing:.06em;text-transform:uppercase;font-weight:700}.v{font-size:30px;font-weight:800;margin-top:8px}.s{font-size:13px;color:var(--muted)}
    figure{background:#fff;border:1px solid var(--border);border-radius:14px;margin:14px 0;padding:10px;overflow:auto}figure img{display:block;width:100%;height:auto}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:22px}th,td{text-align:left;vertical-align:top;padding:11px 12px;border-bottom:1px solid #edf2f7;font-size:14px}th{background:#f1f5f9;color:#475569;font-size:12px;letter-spacing:.04em;text-transform:uppercase}a{color:#0f3f91}
    @media(max-width:980px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media print{body{background:#fff}main{max-width:none;padding:18px}.grid{grid-template-columns:repeat(4,1fr)}figure,.card,table{break-inside:avoid}}
  </style>
</head><body><main>
  <div class="meta">Generated from OpenRouter benchmark results, competitive matrix, live page audit, and local blog inventory</div>
  <h1>iBOLT AI Mention Landscape</h1>
  <p class="note"><strong>Read this as directional AI visibility evidence.</strong> This benchmark stores provider scores, brand detection, rank, citations, competitors, and analysis notes. It does not store full answer text, so this report measures mention/co-mention/displacement patterns rather than quoting entire AI answers.</p>
  <section class="grid">${cards}</section>
  <h2>Charts</h2>
  <figure><img src="competitor-co-mentions.svg" alt="Competitor co-mention chart"/></figure>
  <figure><img src="provider-behavior.svg" alt="Provider behavior chart"/></figure>
  <figure><img src="topic-risk-coverage.svg" alt="Topic risk coverage chart"/></figure>
  <h2>Competitor Landscape</h2>
  <table><thead><tr><th>Brand</th><th>Answers</th><th>With iBOLT</th><th>Without iBOLT</th><th>Co-mention</th><th>Categories</th><th>Lost prompts</th></tr></thead><tbody>${topCompetitorRows}</tbody></table>
  <h2>Raw Detector Differences</h2>
  <p>These brands/counts come from raw result rows and explain where the raw extraction differs from the normalized competitive matrix. Use them for diagnosis, not as the main scorecard.</p>
  <table><thead><tr><th>Brand</th><th>Raw answers</th><th>Matrix answers</th><th>Diff</th><th>Raw with iBOLT</th><th>Raw without iBOLT</th><th>Raw categories</th></tr></thead><tbody>${rawOnlyHtml}</tbody></table>
  <h2>Provider and Category Scorecard</h2>
  <table><thead><tr><th>Provider</th><th>Category</th><th>Avg score</th><th>Mention</th><th>Top 3</th><th>Competitor-only</th><th>Top competitors</th></tr></thead><tbody>${providerRows}</tbody></table>
  <h2>Topic Risk</h2>
  <table><thead><tr><th>Topic</th><th>Risk</th><th>Avg score</th><th>Mention</th><th>Competitor-only</th><th>Posts</th><th>Products</th><th>Top competitors</th></tr></thead><tbody>${topicRowsHtml}</tbody></table>
  <h2>Highest Query Gaps</h2>
  <table><thead><tr><th>Prompt</th><th>Topic</th><th>Opp.</th><th>AI score</th><th>Mention</th><th>Competitors</th><th>Mapped page</th><th>Missing structure</th></tr></thead><tbody>${promptRows}</tbody></table>
  <h2>Lost Answer Patterns</h2>
  <table><thead><tr><th>Provider</th><th>Prompt</th><th>Topic</th><th>Competitors named</th><th>Recommended fix</th></tr></thead><tbody>${lostRowsHtml}</tbody></table>
  <h2>Page Edit Queue</h2>
  <table><thead><tr><th>Priority</th><th>Page</th><th>Topic</th><th>Prompts</th><th>Page score</th><th>Mapped prompts</th><th>Concrete edit</th></tr></thead><tbody>${pageRows}</tbody></table>
</main></body></html>`;
}

function buildMarkdown({ stats, coMentionRows, rawOnlyRows, providerCategoryRows, promptGrid, pageActions, topicRows }) {
  return `# iBOLT AI Mention Landscape

## Current Visibility

- AI answers tested: ${stats.totalAnswers}
- iBOLT mentions: ${stats.mentions}/${stats.totalAnswers} (${stats.mentionRate}%)
- Non-branded iBOLT mentions: ${stats.nonBrandedMentions}/${stats.nonBrandedAnswers} (${stats.nonBrandedMentionRate}%)
- Top-3 recommendation rate: ${stats.topThree}/${stats.totalAnswers} (${stats.topThreeRate}%)
- Citation rate: ${stats.citations}/${stats.totalAnswers} (${stats.citationRate}%)
- Manual product/family signal rows: ${stats.manualProductSignalAnswers}/${stats.totalAnswers}
- Catalog product alias rows: ${stats.catalogProductAliasAnswers}/${stats.totalAnswers}
- Structured product mention rows: ${stats.structuredProductMentionAnswers}/${stats.totalAnswers}
- Competitor-only answers: ${stats.competitorOnlyAnswers} raw detector rows; ${stats.matrixCompetitorOnlyAnswers} normalized matrix rows; ${stats.structuredCompetitorOnlyAnswers} structured result rows.
- Co-mentioned answers: ${stats.coMentionAnswers}

## Main Read

iBOLT is visible when the prompt names the brand, but generic buyer prompts still default to competitors. The strongest next move is to refresh existing high-intent pages with query-exact quick answers, FAQ schema, comparison blocks, and product recommendation proof.

## Brands Mentioned Next To Or Instead Of iBOLT

${coMentionRows.slice(0, 12).map((row) => `- ${row.brand}: ${row.answerCount} answers; ${row.withIbolt} with iBOLT; ${row.withoutIbolt} without iBOLT; co-mention rate ${row.coMentionRate}%.`).join("\n")}

## Raw Detector Differences

${rawOnlyRows.slice(0, 8).map((row) => `- ${row.brand}: raw ${row.answerCount}, matrix ${row.matrixAnswerCount}, diff ${row.difference}.`).join("\n")}

## Provider Patterns

${Object.keys(PROVIDER_LABELS).map((provider) => {
  const rows = providerCategoryRows.filter((row) => row.provider === provider);
  const all = {
    completed: rows.reduce((sum, row) => sum + row.completedCount, 0),
    mentions: rows.reduce((sum, row) => sum + row.mentionCount, 0),
    topThree: rows.reduce((sum, row) => sum + row.topThreeCount, 0),
    competitorOnly: rows.reduce((sum, row) => sum + row.competitorOnlyCount, 0),
    avgScore: avg(rows.flatMap((row) => Array(row.completedCount).fill(row.avgScore))),
  };
  return `- ${PROVIDER_LABELS[provider]}: ${pct(all.mentions, all.completed)}% mention rate, ${pct(all.topThree, all.completed)}% top-3 rate, ${pct(all.competitorOnly, all.completed)}% competitor-only rate, avg score ${all.avgScore}.`;
}).join("\n")}

## Highest Query Gaps

${promptGrid.slice(0, 12).map((row) => `- ${row.query}: opportunity ${row.opportunityScore}, avg score ${row.avgScore}, mention ${row.mentionRate}%, competitors ${row.competitors.slice(0, 5).join(", ")}, mapped page ${row.pageTitle}.`).join("\n")}

## Highest Page Edits

${pageActions.slice(0, 10).map((row) => `- ${row.pageTitle}: priority ${row.priority}, page score ${row.pageScore}, prompts ${row.prompts.slice(0, 3).join("; ")}, edit: ${row.concreteEdit}.`).join("\n")}

## Topic Risk

${topicRows.map((row) => `- ${row.topic}: risk ${row.riskScore || "n/a"}, mention ${row.mentionRate}%, competitor-only ${row.competitorOnlyRate}%, local posts ${row.localPosts || "n/a"}, unique products ${row.uniqueProducts || "n/a"}.`).join("\n")}

## Caveat

The benchmark artifact does not store full model responses. It stores provider, prompt, score, brand detection, citations, rank, competitors, products, and analysis notes. This report can measure brand inclusion and displacement, but not exact wording of every AI answer. The main competitor table uses normalized competitive-matrix battlecards; raw detector differences are shown separately.
`;
}

async function main() {
  const benchmarkDir = process.argv[2] ? path.resolve(process.argv[2]) : await latestDir(BENCHMARK_PREFIX);
  const auditDir = process.argv[3] ? path.resolve(process.argv[3]) : await latestDir(AUDIT_PREFIX);
  const outDir = path.join(benchmarkDir, "mention-landscape");
  await mkdir(outDir, { recursive: true });

  const resultsCsv = await readFile(path.join(benchmarkDir, "results.csv"), "utf8");
  const results = parseCsv(resultsCsv).map(toResult);
  const matrix = JSON.parse(await readFile(path.join(benchmarkDir, "competitive-matrix", "competitive-matrix-data.json"), "utf8"));
  const answerEvidence = await readOptionalJson(path.join(benchmarkDir, "answer-evidence-pack", "answer-evidence-data.json"));
  let deepDive = null;
  try {
    deepDive = JSON.parse(await readFile(path.join(benchmarkDir, "deep-dive", "deep-visibility-data.json"), "utf8"));
  } catch {
    deepDive = null;
  }
  const blogAudit = JSON.parse(await readFile(path.join(benchmarkDir, "blog-inventory-audit", "blog-inventory-audit-data.json"), "utf8"));
  const liveAudit = JSON.parse(await readFile(path.join(auditDir, "live-blog-page-audit.merged.json"), "utf8"));
  const completed = results.filter((row) => row.status === "completed");
  const nonBranded = completed.filter((row) => !/\bibolt\b/i.test(row.query));
  const structuredCompetitorOnlyAnswers = completed.filter((row) => !row.brandMentioned && row.competitors.length).length;
  const structuredCoMentionAnswers = completed.filter((row) => row.brandMentioned && row.competitors.length).length;
  const matrixCompetitorOnlyAnswers = deepDive?.competitorOnlyAnswers?.length ?? structuredCompetitorOnlyAnswers;
  const competitorOnlyAnswers = answerEvidence?.stats?.competitorOnlyRows ?? matrixCompetitorOnlyAnswers;
  const coMentionAnswers = answerEvidence?.stats?.coMentionRows ?? structuredCoMentionAnswers;
  const structuredProductMentionAnswers = completed.filter((row) => row.mentionedProducts.length).length;
  const manualProductSignalAnswers = answerEvidence?.stats?.productSignalRows ?? structuredProductMentionAnswers;
  const catalogProductAliasAnswers = answerEvidence?.stats?.catalogProductRows ?? 0;
  const stats = {
    totalAnswers: completed.length,
    mentions: completed.filter((row) => row.brandMentioned).length,
    mentionRate: pct(completed.filter((row) => row.brandMentioned).length, completed.length),
    nonBrandedAnswers: nonBranded.length,
    nonBrandedMentions: nonBranded.filter((row) => row.brandMentioned).length,
    nonBrandedMentionRate: pct(nonBranded.filter((row) => row.brandMentioned).length, nonBranded.length),
    citations: completed.filter((row) => row.domainCited).length,
    citationRate: pct(completed.filter((row) => row.domainCited).length, completed.length),
    topThree: completed.filter((row) => row.topThree).length,
    topThreeRate: pct(completed.filter((row) => row.topThree).length, completed.length),
    competitorOnlyAnswers,
    competitorOnlyRate: pct(competitorOnlyAnswers, completed.length),
    structuredCompetitorOnlyAnswers,
    matrixCompetitorOnlyAnswers,
    coMentionAnswers,
    structuredCoMentionAnswers,
    structuredProductMentionAnswers,
    manualProductSignalAnswers,
    catalogProductAliasAnswers,
    avgScore: avg(completed.map((row) => row.score)),
  };
  const providerCategoryRows = buildProviderCategoryRows(results);
  const rawCoMentionRows = buildCoMentionRows(results);
  const coMentionRows = buildMatrixCoMentionRows(matrix.battlecards);
  const rawOnlyRows = buildRawOnlyBrandRows(rawCoMentionRows, coMentionRows);
  const promptGrid = buildPromptGrid(results, matrix.queryMatrix);
  const lostRows = buildLostAnswerRows(results, matrix.queryMatrix);
  const topicRows = buildTopicRows(results, matrix.topicMatrix, blogAudit.topicRows);
  const pageActions = buildPageActionRows(promptGrid, matrix.pageQueue, liveAudit.rows ?? liveAudit.pages ?? []);

  await writeFile(path.join(outDir, "provider-category-scorecard.csv"), csv([
    ["provider", "category", "results", "avg_score", "mention_rate", "top_three_rate", "citation_rate", "competitor_only_rate", "top_competitors"],
    ...providerCategoryRows.map((row) => [row.providerLabel, row.category, row.completedCount, row.avgScore, row.mentionRate, row.topThreeRate, row.citationRate, row.competitorOnlyRate, row.topCompetitors]),
  ]));
  await writeFile(path.join(outDir, "competitor-co-mentions.csv"), csv([
    ["brand", "answers", "with_ibolt", "without_ibolt", "co_mention_rate", "providers", "categories", "lost_prompts", "counter_positioning"],
    ...coMentionRows.map((row) => [row.brand, row.answerCount, row.withIbolt, row.withoutIbolt, row.coMentionRate, row.providers, row.categories, row.lostPrompts, row.positioningAngle]),
  ]));
  await writeFile(path.join(outDir, "raw-detector-differences.csv"), csv([
    ["brand", "raw_answers", "matrix_answers", "difference", "raw_with_ibolt", "raw_without_ibolt", "raw_providers", "raw_categories"],
    ...rawOnlyRows.map((row) => [row.brand, row.answerCount, row.matrixAnswerCount, row.difference, row.withIbolt, row.withoutIbolt, row.providers, row.categories]),
  ]));
  await writeFile(path.join(outDir, "prompt-provider-grid.csv"), csv([
    ["opportunity_score", "query", "category", "avg_score", "mention_rate", "top_three_rate", "competitor_only_answers", "competitors", "provider_cells", "page_title", "page_url", "page_score", "structural_issues", "recommended_action"],
    ...promptGrid.map((row) => [row.opportunityScore, row.query, row.category, row.avgScore, row.mentionRate, row.topThreeRate, row.competitorOnlyCount, row.competitors, row.providerCells, row.pageTitle, row.pageUrl, row.pageScore, row.structuralIssues, row.recommendedAction]),
  ]));
  await writeFile(path.join(outDir, "lost-answer-patterns.csv"), csv([
    ["provider", "query", "category", "score", "competitors", "page_title", "page_url", "page_score", "structural_issues", "fix", "analysis_notes"],
    ...lostRows.map((row) => [row.provider, row.query, row.category, row.score, row.competitors, row.pageTitle, row.pageUrl, row.pageScore, row.structuralIssues, row.fix, row.notes]),
  ]));
  await writeFile(path.join(outDir, "topic-risk-coverage.csv"), csv([
    ["topic", "risk_score", "results", "avg_score", "mention_rate", "competitor_only_rate", "zero_mention_prompts", "audited_pages", "avg_page_score", "local_posts", "unique_products", "top_competitors"],
    ...topicRows.map((row) => [row.topic, row.riskScore, row.resultCount, row.avgScore, row.mentionRate, row.competitorOnlyRate, row.zeroMentionPrompts, row.auditedPages, row.avgPageScore, row.localPosts, row.uniqueProducts, row.topCompetitors]),
  ]));
  await writeFile(path.join(outDir, "page-edit-queue.csv"), csv([
    ["priority", "page_title", "page_url", "category", "prompt_count", "avg_prompt_score", "page_score", "competitors", "structural_issues", "mapped_prompts", "concrete_edit"],
    ...pageActions.map((row) => [row.priority, row.pageTitle, row.pageUrl, row.category, row.promptCount, row.avgPromptScore, row.pageScore, row.competitors, row.structuralIssues, row.prompts, row.concreteEdit]),
  ]));
  await writeFile(path.join(outDir, "mention-landscape-data.json"), JSON.stringify({
    benchmarkDir,
    auditDir,
    stats,
    providerCategoryRows,
    coMentionRows,
    rawCoMentionRows,
    rawOnlyRows,
    promptGrid,
    lostRows,
    topicRows,
    pageActions,
    caveat: "Headline competitor and product-entity counts use the raw answer evidence pack when available. Provider/category rows still use structured result fields, and the main competitor table uses normalized competitive-matrix battlecards.",
  }, null, 2));

  await writeSvgAndPng(outDir, "competitor-co-mentions", stackedCompetitorChart(coMentionRows.slice(0, 14)));
  await writeSvgAndPng(outDir, "provider-behavior", providerChart(providerCategoryRows));
  await writeSvgAndPng(outDir, "topic-risk-coverage", topicRiskChart(topicRows));
  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown({ stats, coMentionRows, rawOnlyRows, providerCategoryRows, promptGrid, pageActions, topicRows }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({ stats, providerCategoryRows, coMentionRows, rawOnlyRows, promptGrid, lostRows, topicRows, pageActions }));
  console.log(path.relative(process.cwd(), outDir));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
