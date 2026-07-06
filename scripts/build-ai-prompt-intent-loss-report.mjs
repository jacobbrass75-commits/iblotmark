#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "prompt-intent-loss-report");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted && char === '"' && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => String(value).trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some((value) => String(value).trim())) rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows.shift();
  return rows.map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""])));
}

async function readCsv(relativePath) {
  try {
    return parseCsv(await readFile(path.join(benchmarkDir, relativePath), "utf8"));
  } catch {
    return [];
  }
}

function num(value) {
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function avg(values) {
  const numbers = values.map(num).filter(Number.isFinite);
  return numbers.length ? Math.round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length) : 0;
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function csv(rows) {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function short(value, length = 140) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 3).trim()}...` : text;
}

function splitList(value) {
  return String(value ?? "")
    .split(/[;|/]/)
    .map((item) => item.trim())
    .filter((item) => item && !/^none$/i.test(item));
}

function addCount(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function topCounts(map, limit = 8) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => `${key} ${count}`);
}

function classifyIntent(prompt, promptType = "") {
  const text = String(prompt ?? "").toLowerCase();
  const type = String(promptType ?? "").toLowerCase();
  if (/citation|cited|source|which brands are cited/.test(text) || /citation/.test(type)) return "citation/source";
  if (/\bvs\b|versus|compare|comparison/.test(text) || /comparison/.test(type)) return "competitor comparison";
  if (/^is\s+ibolt|good for|compatible|product_entity/.test(text) || /product_entity/.test(type)) return "product recall";
  if (/how to|setup|set up|install|mount a|mounting guide/.test(text)) return "setup/how-to";
  if (/what .*should i use|which .*should i use|which .*mount/.test(text)) return "shopping advice";
  if (/^best|best .* mount|top /.test(text) || /mapped/.test(type)) return "best/recommendation";
  if (/ibolt|brand/.test(text)) return "brand/direct";
  return "category discovery";
}

function intentMove(intent) {
  if (intent === "best/recommendation") {
    return "Add answer-first blocks that directly name iBOLT, the best-fit product family, ideal buyer, and why it belongs in the recommendation set.";
  }
  if (intent === "competitor comparison") {
    return "Add fair comparison sections beside RAM, Arkon, iOttie, CTA Digital, ProClip, or Mount-It without budget framing.";
  }
  if (intent === "product recall") {
    return "Add exact product names, model/fit details, specs, product modules, and internal links from the relevant guide to the product page.";
  }
  if (intent === "citation/source") {
    return "After page edits, add FAQ/Article/Product schema, concise source-ready answer blocks, and off-site citations to the exact page.";
  }
  if (intent === "setup/how-to") {
    return "Add installation steps, mount pattern/ball-size clarity, compatibility notes, and HowTo-style structure where appropriate.";
  }
  if (intent === "shopping advice") {
    return "Add decision trees by use case, surface one primary recommendation, and keep product modules clear without repeated cart CTAs.";
  }
  if (intent === "brand/direct") {
    return "Make branded pages reinforce iBOLT's specialist position: 300+ modular parts, AMPS compatibility, industrial materials, and workflow-specific kits.";
  }
  return "Create clearer category answer blocks and map the prompt to the closest live page before retesting.";
}

function providerCells(row) {
  const text = String(row.provider_cells || "");
  return ["ChatGPT", "Gemini", "Claude"].map((provider) => {
    const start = text.indexOf(`${provider}:`);
    if (start === -1) return null;
    const next = ["ChatGPT", "Gemini", "Claude"]
      .filter((candidate) => candidate !== provider)
      .map((candidate) => text.indexOf(`${candidate}:`, start + 1))
      .filter((value) => value > start);
    const end = next.length ? Math.min(...next) : text.length;
    const cell = text.slice(start, end).replace(new RegExp(`^${provider}:\\s*`), "").trim();
    return { provider, missed: /missed/i.test(cell), text: cell };
  }).filter(Boolean);
}

function buildIntentRows({ baselineRows, selectedPrompts, providerManifest, priorityRequests }) {
  const intentMap = new Map();
  const ensure = (intent) => {
    if (!intentMap.has(intent)) {
      intentMap.set(intent, {
        intent,
        baseline: [],
        selected: [],
        providerRequests: [],
        priorityRequests: [],
        competitors: new Map(),
        categories: new Map(),
        pages: new Map(),
        providerMisses: new Map(),
      });
    }
    return intentMap.get(intent);
  };

  for (const row of baselineRows) {
    const intent = classifyIntent(row.query);
    const group = ensure(intent);
    group.baseline.push(row);
    addCount(group.categories, row.category);
    addCount(group.pages, row.page_title);
    for (const competitor of splitList(row.competitors)) addCount(group.competitors, competitor);
    for (const cell of providerCells(row)) {
      if (cell.missed) addCount(group.providerMisses, cell.provider);
    }
  }
  for (const row of selectedPrompts) {
    const intent = classifyIntent(row.prompt, row.prompt_type);
    const group = ensure(intent);
    group.selected.push(row);
    addCount(group.categories, row.category);
    addCount(group.pages, row.closest_post);
  }
  for (const row of providerManifest) {
    ensure(classifyIntent(row.prompt, row.prompt_type)).providerRequests.push(row);
  }
  for (const row of priorityRequests) {
    const group = ensure(classifyIntent(row.prompt, row.prompt_type));
    group.priorityRequests.push(row);
    for (const competitor of splitList(row.competitors)) addCount(group.competitors, competitor);
  }

  return [...intentMap.values()].map((group) => {
    const competitorOnly = group.baseline.reduce((sum, row) => sum + num(row.competitor_only_answers), 0);
    const avgMention = avg(group.baseline.map((row) => row.mention_rate));
    const avgTopThree = avg(group.baseline.map((row) => row.top_three_rate));
    const zeroMention = group.baseline.filter((row) => num(row.mention_rate) === 0).length;
    const priorityScore = Math.round(
      competitorOnly * 35
      + zeroMention * 20
      + group.priorityRequests.length * 2
      + group.providerMisses.size * 10
      + (group.baseline.length ? 100 - avgMention : 0)
    );
    return {
      intent: group.intent,
      priorityScore,
      baselineQueries: group.baseline.length,
      selectedPrompts: group.selected.length,
      providerRequests: group.providerRequests.length,
      priorityRequests: group.priorityRequests.length,
      competitorOnlyAnswers: competitorOnly,
      zeroMentionQueries: zeroMention,
      mentionRate: avgMention,
      topThreeRate: avgTopThree,
      topCategories: topCounts(group.categories, 8).join("; "),
      topCompetitors: topCounts(group.competitors, 8).join("; "),
      providerMisses: topCounts(group.providerMisses, 3).join("; "),
      topPages: topCounts(group.pages, 8).join("; "),
      mainMove: intentMove(group.intent),
      samplePrompts: [...new Set([
        ...group.baseline.map((row) => row.query),
        ...group.selected.map((row) => row.prompt),
      ])].slice(0, 8).join("; "),
    };
  }).sort((a, b) => b.priorityScore - a.priorityScore);
}

function buildIntentCategoryRows(baselineRows, selectedPrompts) {
  const map = new Map();
  const ensure = (intent, category) => {
    const key = `${intent}|||${category || "uncategorized"}`;
    if (!map.has(key)) {
      map.set(key, {
        intent,
        category: category || "uncategorized",
        baseline: [],
        selected: [],
        competitors: new Map(),
      });
    }
    return map.get(key);
  };
  for (const row of baselineRows) {
    const group = ensure(classifyIntent(row.query), row.category);
    group.baseline.push(row);
    for (const competitor of splitList(row.competitors)) addCount(group.competitors, competitor);
  }
  for (const row of selectedPrompts) {
    ensure(classifyIntent(row.prompt, row.prompt_type), row.category).selected.push(row);
  }
  return [...map.values()].map((group) => ({
    intent: group.intent,
    category: group.category,
    baselineQueries: group.baseline.length,
    selectedPrompts: group.selected.length,
    competitorOnlyAnswers: group.baseline.reduce((sum, row) => sum + num(row.competitor_only_answers), 0),
    mentionRate: avg(group.baseline.map((row) => row.mention_rate)),
    topCompetitors: topCounts(group.competitors, 6).join("; "),
    samplePrompt: group.baseline[0]?.query || group.selected[0]?.prompt || "",
  })).sort((a, b) => b.competitorOnlyAnswers - a.competitorOnlyAnswers || b.selectedPrompts - a.selectedPrompts);
}

function buildRetestRows(priorityRequests) {
  return priorityRequests.map((row) => ({
    rank: row.retest_rank,
    wave: row.wave,
    provider: row.provider,
    intent: classifyIntent(row.prompt, row.prompt_type),
    prompt: row.prompt,
    category: row.category,
    promptType: row.prompt_type,
    score: row.retest_score,
    page: row.closest_post,
    url: row.page_url,
    competitors: row.competitors,
    prerequisite: row.prerequisite,
    successMetric: row.success_metric,
  })).sort((a, b) => num(a.rank) - num(b.rank));
}

function renderTable(headers, rows) {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header.label)}</th>`).join("")}</tr></thead>`;
  const body = rows.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header.key])}</td>`).join("")}</tr>`).join("");
  return `<table>${head}<tbody>${body}</tbody></table>`;
}

function barChart({ title, rows, valueKey, labelKey, color = "#2563eb" }) {
  const chartRows = rows.slice(0, 10);
  const width = 980;
  const rowHeight = 38;
  const height = 72 + chartRows.length * rowHeight;
  const max = Math.max(1, ...chartRows.map((row) => num(row[valueKey])));
  const bars = chartRows.map((row, index) => {
    const y = 52 + index * rowHeight;
    const barWidth = Math.round((num(row[valueKey]) / max) * 500);
    return `<g>
      <text x="22" y="${y + 17}" font-size="13" font-weight="800" fill="#0f172a">${escapeHtml(short(row[labelKey], 42))}</text>
      <rect x="350" y="${y}" width="500" height="23" rx="11" fill="#e5e7eb"/>
      <rect x="350" y="${y}" width="${barWidth}" height="23" rx="11" fill="${color}"/>
      <text x="930" y="${y + 16}" font-size="13" font-weight="900" text-anchor="end" fill="#0f172a">${escapeHtml(row[valueKey])}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#fff"/>
    <text x="22" y="34" font-size="21" font-weight="900" fill="#111827">${escapeHtml(title)}</text>
    ${bars}
  </svg>`;
}

function renderHtml({ summary, intentRows, intentCategoryRows, retestRows }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT Prompt Intent Loss Report</title>
  <style>
    body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1280px;margin:0 auto;padding:34px 24px 72px}
    h1{font-size:36px;margin:0 0 8px}
    h2{font-size:23px;margin:34px 0 12px}
    p,li{font-size:15px;line-height:1.55;color:#334155}
    .cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:20px 0}
    .card{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:15px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:900}
    .value{font-size:30px;font-weight:900;margin:8px 0;color:#0f172a}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
    .chart{background:#fff;border:1px solid #dbe3ef;border-radius:18px;padding:10px;overflow:auto}
    .chart svg{width:100%;height:auto;display:block}
    .note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #2563eb;border-radius:12px;padding:16px 18px;margin:18px 0}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 22px}
    th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    @media(max-width:980px){.cards,.grid{grid-template-columns:1fr}h1{font-size:30px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT Prompt Intent Loss Report</h1>
  <p>This classifies the benchmark by buyer question type, so retests can run one small prompt at a time instead of treating all prompts the same.</p>
  <div class="note"><strong>Read:</strong> The biggest losses are broad recommendation prompts, then comparison and product-recall prompts. Citation/source prompts matter, but they should run after pages have answer-first copy, product modules, comparison proof, and schema.</div>
  <section class="cards">
    <div class="card"><div class="label">Intent types</div><div class="value">${escapeHtml(summary.intentTypes)}</div><p>Distinct prompt-intent groups.</p></div>
    <div class="card"><div class="label">Baseline queries</div><div class="value">${escapeHtml(summary.baselineQueries)}</div><p>Queries with measured AI outcomes.</p></div>
    <div class="card"><div class="label">Selected prompts</div><div class="value">${escapeHtml(summary.selectedPrompts)}</div><p>All-blog prompts ready for expanded retest.</p></div>
    <div class="card"><div class="label">Provider requests</div><div class="value">${escapeHtml(summary.providerRequests)}</div><p>One-at-a-time provider prompt rows.</p></div>
  </section>
  <section class="grid">
    <div class="chart">${barChart({ title: "Competitor-only answers by intent", rows: intentRows, valueKey: "competitorOnlyAnswers", labelKey: "intent", color: "#dc2626" })}</div>
    <div class="chart">${barChart({ title: "Provider requests by intent", rows: intentRows, valueKey: "providerRequests", labelKey: "intent", color: "#0f766e" })}</div>
  </section>
  <h2>Intent Loss Summary</h2>
  ${renderTable([
    { label: "Intent", key: "intent" },
    { label: "Priority", key: "priorityScore" },
    { label: "Baseline", key: "baselineQueries" },
    { label: "Selected", key: "selectedPrompts" },
    { label: "Provider reqs", key: "providerRequests" },
    { label: "Comp-only", key: "competitorOnlyAnswers" },
    { label: "Mention", key: "mentionRate" },
    { label: "Competitors", key: "topCompetitors" },
    { label: "Move", key: "mainMove" },
  ], intentRows)}
  <h2>Intent And Category Matrix</h2>
  ${renderTable([
    { label: "Intent", key: "intent" },
    { label: "Category", key: "category" },
    { label: "Baseline", key: "baselineQueries" },
    { label: "Selected", key: "selectedPrompts" },
    { label: "Comp-only", key: "competitorOnlyAnswers" },
    { label: "Mention", key: "mentionRate" },
    { label: "Competitors", key: "topCompetitors" },
    { label: "Sample", key: "samplePrompt" },
  ], intentCategoryRows.slice(0, 36))}
  <h2>Priority Retest Rows</h2>
  ${renderTable([
    { label: "Rank", key: "rank" },
    { label: "Wave", key: "wave" },
    { label: "Provider", key: "provider" },
    { label: "Intent", key: "intent" },
    { label: "Category", key: "category" },
    { label: "Prompt", key: "prompt" },
    { label: "Success metric", key: "successMetric" },
  ], retestRows.slice(0, 30))}
</main>
</body>
</html>`;
}

function renderMarkdown({ summary, intentRows, intentCategoryRows, retestRows }) {
  return `# iBOLT Prompt Intent Loss Report

This classifies the benchmark by buyer question type, so retests can run one small prompt at a time instead of treating all prompts the same.

## Summary

- Intent types: ${summary.intentTypes}
- Baseline queries: ${summary.baselineQueries}
- All-blog selected prompts: ${summary.selectedPrompts}
- Provider request rows: ${summary.providerRequests}
- Priority retest rows: ${summary.priorityRequests}

## Intent Loss Summary

${intentRows.map((row, index) => `${index + 1}. ${row.intent}: ${row.competitorOnlyAnswers} competitor-only answers, ${row.selectedPrompts} selected prompts, ${row.providerRequests} provider requests. ${row.mainMove}`).join("\n")}

## Highest Intent/Category Gaps

${intentCategoryRows.slice(0, 12).map((row, index) => `${index + 1}. ${row.intent} / ${row.category}: ${row.competitorOnlyAnswers} competitor-only answers, mention rate ${row.mentionRate}%. Sample: ${row.samplePrompt}`).join("\n")}

## First Retest Rows

${retestRows.slice(0, 12).map((row) => `- ${row.provider} / ${row.intent} / ${row.category}: ${row.prompt}`).join("\n")}
`;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const baselineRows = await readCsv("query-page-matrix/all-query-page-matrix.csv");
  const selectedPrompts = await readCsv("all-blog-prompt-gap-addendum/all-blog-complete-selected-prompts.csv");
  const providerManifest = await readCsv("all-blog-prompt-gap-addendum/all-blog-complete-provider-manifest.csv");
  const priorityRequests = await readCsv("priority-retest-packet/priority-retest-request-queue.csv");

  const intentRows = buildIntentRows({ baselineRows, selectedPrompts, providerManifest, priorityRequests });
  const intentCategoryRows = buildIntentCategoryRows(baselineRows, selectedPrompts);
  const retestRows = buildRetestRows(priorityRequests);
  const summary = {
    intentTypes: intentRows.length,
    baselineQueries: baselineRows.length,
    selectedPrompts: selectedPrompts.length,
    providerRequests: providerManifest.length,
    priorityRequests: priorityRequests.length,
    topIntent: intentRows[0]?.intent || "",
    topIntentCompetitorOnlyAnswers: intentRows[0]?.competitorOnlyAnswers || 0,
    topIntentProviderRequests: intentRows[0]?.providerRequests || 0,
  };

  await writeFile(path.join(outDir, "intent-loss-summary.csv"), csv([
    ["rank", "intent", "priority_score", "baseline_queries", "selected_prompts", "provider_requests", "priority_requests", "competitor_only_answers", "zero_mention_queries", "mention_rate", "top_three_rate", "top_categories", "top_competitors", "provider_misses", "top_pages", "main_move", "sample_prompts"],
    ...intentRows.map((row, index) => [
      index + 1,
      row.intent,
      row.priorityScore,
      row.baselineQueries,
      row.selectedPrompts,
      row.providerRequests,
      row.priorityRequests,
      row.competitorOnlyAnswers,
      row.zeroMentionQueries,
      row.mentionRate,
      row.topThreeRate,
      row.topCategories,
      row.topCompetitors,
      row.providerMisses,
      row.topPages,
      row.mainMove,
      row.samplePrompts,
    ]),
  ]));
  await writeFile(path.join(outDir, "intent-category-matrix.csv"), csv([
    ["intent", "category", "baseline_queries", "selected_prompts", "competitor_only_answers", "mention_rate", "top_competitors", "sample_prompt"],
    ...intentCategoryRows.map((row) => [
      row.intent,
      row.category,
      row.baselineQueries,
      row.selectedPrompts,
      row.competitorOnlyAnswers,
      row.mentionRate,
      row.topCompetitors,
      row.samplePrompt,
    ]),
  ]));
  await writeFile(path.join(outDir, "priority-intent-retest-queue.csv"), csv([
    ["rank", "wave", "provider", "intent", "prompt", "category", "prompt_type", "score", "page", "url", "competitors", "prerequisite", "success_metric"],
    ...retestRows.map((row) => [
      row.rank,
      row.wave,
      row.provider,
      row.intent,
      row.prompt,
      row.category,
      row.promptType,
      row.score,
      row.page,
      row.url,
      row.competitors,
      row.prerequisite,
      row.successMetric,
    ]),
  ]));
  await writeFile(path.join(outDir, "prompt-intent-loss-data.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    benchmarkDir,
    summary,
    intentRows,
    intentCategoryRows,
    retestRows,
  }, null, 2));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown({ summary, intentRows, intentCategoryRows, retestRows }));
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml({ summary, intentRows, intentCategoryRows, retestRows }));

  console.log(`Wrote ${outDir}`);
  console.log(`Intent types: ${summary.intentTypes}; top intent: ${summary.topIntent}; selected prompts: ${summary.selectedPrompts}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
