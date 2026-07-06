#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "prompt-loss-decision-board");

async function readCsv(relativePath) {
  try {
    return parseCsv(await readFile(path.join(benchmarkDir, relativePath), "utf8"));
  } catch {
    return [];
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted && char === '"' && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(value);
      value = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows.shift();
  return rows
    .filter((cells) => cells.some((cell) => String(cell ?? "").trim()))
    .map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

function csv(rows) {
  return `${rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n")}\n`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const match = String(value ?? "").replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
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

function compact(value, length = 170) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 3).trim()}...` : text;
}

function promptKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function first(...values) {
  return values.find((value) => String(value ?? "").trim()) || "";
}

function addPrompt(map, query) {
  const key = promptKey(query);
  if (!key) return null;
  if (!map.has(key)) {
    map.set(key, {
      query: String(query ?? "").trim(),
      category: "",
      promptType: "",
      intent: "",
      score: 0,
      severity: "",
      lossStage: "",
      missedProviders: [],
      providerLossRows: 0,
      answerRows: 0,
      avgScore: 0,
      iboltTop3: 0,
      weakMentions: 0,
      competitorOnly: 0,
      noSignal: 0,
      mentionRate: 0,
      top3Rate: 0,
      citationRate: 0,
      competitors: [],
      productSignals: [],
      catalogProducts: [],
      productsToFeature: [],
      mappedPage: "",
      mappedPageTitle: "",
      mappedPageScore: 0,
      pageDecision: "",
      pagePriority: 0,
      lifecycleBucket: "",
      structuralIssues: [],
      triageIssues: [],
      messageThemes: [],
      proofPoints: [],
      retestWaves: [],
      retestRequests: 0,
      ownerSequence: "",
      successMetric: "",
      nextAction: "",
      recommendedAction: "",
      triageAction: "",
      weakestProviders: [],
      providerRows: [],
      snippets: [],
      sourceUrlCount: 0,
      productFamilySignals: [],
      productFamilyActions: [],
    });
  }
  return map.get(key);
}

function mergeLists(target, value) {
  target.push(...splitList(value));
}

function normalizeProvider(provider) {
  const text = String(provider ?? "").trim();
  if (/chatgpt|openai/i.test(text)) return "ChatGPT";
  if (/gemini|google/i.test(text)) return "Gemini";
  if (/claude|anthropic/i.test(text)) return "Claude";
  return text;
}

function outcomeIsLoss(row) {
  const text = `${row.outcome ?? ""} ${row.triage_action ?? ""} ${row.recommended_action ?? ""}`.toLowerCase();
  return /competitor|no signal|missing|loss|lost|weak|gap/.test(text);
}

function inferLane(prompt) {
  const allText = [
    prompt.query,
    prompt.promptType,
    prompt.intent,
    prompt.lossStage,
    prompt.pageDecision,
    prompt.lifecycleBucket,
    prompt.triageAction,
    prompt.recommendedAction,
    prompt.nextAction,
    prompt.structuralIssues.join(" "),
    prompt.competitors.join(" "),
  ].join(" ").toLowerCase();

  const canonicalFirst = /canonical|survivor|merge|duplicate/.test(allText);
  const citationIntent = /citation|cited|source|sources/.test(allText);
  const competitorLoss = prompt.competitorOnly > 0 || prompt.noSignal > 0 || prompt.mentionRate <= 0;
  const comparisonNeeded = /competitor| vs |comparison|compare|versus/.test(allText);

  if (canonicalFirst && competitorLoss) return "Canonical first, then mention recovery";
  if (canonicalFirst && citationIntent) return "Canonical first, then source cleanup";
  if (canonicalFirst) return "Canonical or survivor first";
  if (citationIntent && prompt.mentionRate > 0) return "Source cleanup and citation probe";
  if (competitorLoss && comparisonNeeded) return "Comparison block and mention recovery";
  if (competitorLoss) return "Mention recovery refresh";
  if (prompt.productsToFeature.length || prompt.catalogProducts.length || prompt.productSignals.length) return "Exact product module";
  if (!prompt.mappedPage && !prompt.mappedPageTitle) return "Net-new content or solution page";
  return "Refresh existing page";
}

function inferAction(prompt) {
  const lane = inferLane(prompt);
  const page = prompt.mappedPage || prompt.mappedPageTitle || "the mapped page";
  if (lane === "Canonical first, then mention recovery") return "Pick the survivor URL first, then add the quick answer, comparison block, exact product module, FAQ/schema, and retest the same prompt for iBOLT inclusion.";
  if (lane === "Canonical first, then source cleanup") return "Pick the survivor URL first, then clean source-ready answer structure and schema before any citation probe.";
  if (lane === "Canonical or survivor first") return "Pick the survivor URL, merge or hold duplicates, then retest only the survivor page prompts.";
  if (lane === "Source cleanup and citation probe") return "Add a concise source-ready answer block, FAQPage and Article schema, clean product citations, and run a small provider citation probe.";
  if (lane === "Comparison block and mention recovery") {
    const competitors = unique(prompt.competitors).slice(0, 4).join(", ");
    return `Add a fair comparison block on ${page}${competitors ? ` against ${competitors}` : ""}, then retest for iBOLT inclusion and top-three placement.`;
  }
  if (lane === "Exact product module") {
    const products = unique([...prompt.productsToFeature, ...prompt.catalogProducts, ...prompt.productSignals]).slice(0, 4).join(", ");
    return `Add an exact product module${products ? ` featuring ${products}` : ""}, including use case, install method, image, price, and product link.`;
  }
  if (lane === "Net-new content or solution page") return "Create a dedicated solution page or blog post because the prompt has no reliable mapped answer asset.";
  if (lane === "Mention recovery refresh") return `Refresh ${page} with a top quick answer, product fit language, competitor context, FAQ schema, and exact retest prompt.`;
  return `Refresh ${page} with the missing structural fixes, then retest this exact prompt across ChatGPT, Gemini, and Claude.`;
}

function scorePrompt(prompt) {
  const missedProviderCount = unique([...prompt.missedProviders, ...prompt.weakestProviders]).length;
  const competitorCount = unique(prompt.competitors).length;
  const zeroCitation = prompt.citationRate <= 0 ? 10 : 0;
  const highSeverity = /critical|high|p0|p1/i.test(prompt.severity) ? 35 : toNumber(prompt.severity);
  const mappedPageBonus = prompt.mappedPage || prompt.mappedPageTitle ? 8 : 20;
  return Math.round(
    prompt.score
    + highSeverity
    + prompt.providerLossRows * 18
    + prompt.competitorOnly * 22
    + prompt.noSignal * 12
    + prompt.weakMentions * 8
    + missedProviderCount * 14
    + competitorCount * 4
    + prompt.pagePriority * 0.8
    + prompt.mappedPageScore * 0.25
    + prompt.retestRequests * 3
    + zeroCitation
    + mappedPageBonus,
  );
}

function buildRows(promptMap) {
  return [...promptMap.values()]
    .map((prompt) => {
      const missedProviders = unique([...prompt.missedProviders.map(normalizeProvider), ...prompt.weakestProviders.map(normalizeProvider)]);
      const competitors = unique(prompt.competitors);
      const products = unique([...prompt.productsToFeature, ...prompt.catalogProducts, ...prompt.productSignals]);
      const lane = inferLane(prompt);
      const decisionScore = scorePrompt(prompt);
      return {
        ...prompt,
        missedProviders,
        competitors,
        products,
        lane,
        decisionScore,
        action: inferAction(prompt),
        structuralIssues: unique(prompt.structuralIssues),
        triageIssues: unique(prompt.triageIssues),
        retestWaves: unique(prompt.retestWaves),
        productFamilySignals: unique(prompt.productFamilySignals),
        productFamilyActions: unique(prompt.productFamilyActions),
        providerRows: prompt.providerRows,
        snippets: prompt.snippets.slice(0, 4),
      };
    })
    .filter((prompt) => prompt.query)
    .sort((a, b) => b.decisionScore - a.decisionScore || a.query.localeCompare(b.query));
}

function barSvg({ title, rows, valueKey, labelKey = "query", color = "#0f766e", width = 920 }) {
  const chartRows = rows.slice(0, 12);
  const rowHeight = 38;
  const height = 78 + chartRows.length * rowHeight;
  const max = Math.max(1, ...chartRows.map((row) => toNumber(row[valueKey])));
  const bars = chartRows.map((row, index) => {
    const y = 58 + index * rowHeight;
    const value = toNumber(row[valueKey]);
    const barWidth = Math.max(3, Math.round((value / max) * (width - 390)));
    return `<g>
      <text x="20" y="${y + 17}" font-size="13" font-weight="900" fill="#111827">${escapeHtml(compact(row[labelKey], 38))}</text>
      <rect x="310" y="${y}" width="${width - 390}" height="23" rx="11" fill="#e5e7eb"/>
      <rect x="310" y="${y}" width="${barWidth}" height="23" rx="11" fill="${color}"/>
      <text x="${width - 60}" y="${y + 17}" font-size="13" font-weight="900" text-anchor="end" fill="#111827">${escapeHtml(value)}</text>
    </g>`;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="14" fill="#fff"/>
    <text x="20" y="32" font-size="19" font-weight="900" fill="#111827">${escapeHtml(title)}</text>
    ${bars}
  </svg>`;
}

function groupSummary(rows, key, valueKey = "decisionScore") {
  const map = new Map();
  for (const row of rows) {
    const label = row[key] || "Unclassified";
    const current = map.get(label) || { label, prompts: 0, value: 0, competitorOnly: 0, noSignal: 0, citationZero: 0 };
    current.prompts += 1;
    current.value += toNumber(row[valueKey]);
    current.competitorOnly += toNumber(row.competitorOnly);
    current.noSignal += toNumber(row.noSignal);
    if (toNumber(row.citationRate) <= 0) current.citationZero += 1;
    map.set(label, current);
  }
  return [...map.values()].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function providerSummary(rows) {
  const map = new Map();
  for (const row of rows) {
    for (const provider of row.missedProviders.length ? row.missedProviders : ["Unspecified"]) {
      const current = map.get(provider) || { provider, missed_prompts: 0, competitor_only: 0, no_signal: 0, prompt_score: 0, top_queries: [] };
      current.missed_prompts += 1;
      current.competitor_only += toNumber(row.competitorOnly);
      current.no_signal += toNumber(row.noSignal);
      current.prompt_score += toNumber(row.decisionScore);
      current.top_queries.push(row.query);
      map.set(provider, current);
    }
  }
  return [...map.values()].sort((a, b) => b.prompt_score - a.prompt_score || a.provider.localeCompare(b.provider));
}

function renderTable(headers, rows) {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table>${head}${body}</table>`;
}

function renderHtml({ promptRows, laneRows, categoryRows, providerRows, pageRows, contentRows }) {
  const totalPrompts = promptRows.length;
  const citationZero = promptRows.filter((row) => toNumber(row.citationRate) <= 0).length;
  const mentionRecovery = promptRows.filter((row) => /mention recovery|comparison/i.test(row.lane)).length;
  const sourceReady = promptRows.filter((row) => /citation probe/i.test(row.lane)).length;
  const topPrompts = promptRows.slice(0, 30).map((row) => [
    row.decisionScore,
    row.query,
    row.category,
    row.lane,
    row.missedProviders.join("; "),
    row.competitors.slice(0, 5).join("; "),
    row.mappedPage || row.mappedPageTitle,
    row.action,
  ]);
  const laneTable = laneRows.map((row) => [row.label, row.prompts, row.value, row.competitorOnly, row.noSignal, row.citationZero]);
  const categoryTable = categoryRows.slice(0, 16).map((row) => [row.label, row.prompts, row.value, row.competitorOnly, row.noSignal, row.citationZero]);
  const providerTable = providerRows.map((row) => [
    row.provider,
    row.missed_prompts,
    row.competitor_only,
    row.no_signal,
    row.prompt_score,
    unique(row.top_queries).slice(0, 8).join("; "),
  ]);
  const pageTable = pageRows.slice(0, 30).map((row) => [row.page, row.prompt_count, row.total_score, row.lanes.join("; "), row.prompts.slice(0, 5).join("; "), row.first_action]);
  const contentTable = contentRows.slice(0, 30).map((row) => [row.lane, row.category, row.query, row.products, row.competitors, row.action]);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Prompt Loss Decision Board</title>
  <style>
    body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1220px;margin:0 auto;padding:34px 24px 70px}
    h1{font-size:36px;margin:0 0 8px}
    h2{font-size:24px;margin:34px 0 12px}
    p,li{font-size:15px;line-height:1.55;color:#334155}
    .note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #0f766e;border-radius:12px;padding:16px 18px;margin:18px 0}
    .cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:20px 0}
    .card{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:16px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:900}
    .value{font-size:29px;font-weight:900;margin:8px 0;color:#0f172a}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    svg{width:100%;height:auto;border:1px solid #dbe3ef;border-radius:14px}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 22px}
    th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    a{color:#0f766e;overflow-wrap:anywhere}
    code{background:#e2e8f0;border-radius:5px;padding:2px 5px}
    @media(max-width:900px){.cards,.grid{grid-template-columns:1fr}h1{font-size:30px}}
  </style>
</head>
<body>
<main>
  <h1>Prompt Loss Decision Board</h1>
  <p>Exact buyer prompts joined across the intent-loss queue, query outcome triage, answer evidence, page decisions, product-family gaps, and retest maps.</p>
  <div class="note"><strong>How to use this:</strong> prompts in mention-recovery lanes should be fixed before citation outreach. Citation probes are useful only after the mapped page gives a clean, quotable answer and iBOLT is already appearing in the answer set.</div>

  <section class="cards">
    <div class="card"><div class="label">Prompts classified</div><div class="value">${totalPrompts}</div><p>Unique prompt strings with benchmark or retest evidence.</p></div>
    <div class="card"><div class="label">Need mention recovery</div><div class="value">${mentionRecovery}</div><p>Competitor-only, no-signal, or comparison-loss prompts.</p></div>
    <div class="card"><div class="label">Citation-zero prompts</div><div class="value">${citationZero}</div><p>Prompts where saved evidence shows no source citations yet.</p></div>
    <div class="card"><div class="label">Citation probe lane</div><div class="value">${sourceReady}</div><p>Prompts that can move toward source cleanup and citation testing.</p></div>
  </section>

  <section class="grid">
    ${barSvg({ title: "Top Prompt Losses", rows: promptRows, valueKey: "decisionScore", color: "#b91c1c" })}
    ${barSvg({ title: "Category Prompt Pressure", rows: categoryRows, valueKey: "value", labelKey: "label", color: "#1d4ed8" })}
  </section>

  <h2>Decision Lanes</h2>
  ${renderTable(["Lane", "Prompts", "Score", "Competitor-only", "No signal", "Zero citation"], laneTable)}

  <h2>Top Prompt Decisions</h2>
  ${renderTable(["Score", "Prompt", "Category", "Lane", "Missed providers", "Competitors", "Mapped page", "Action"], topPrompts)}

  <h2>Provider Misses</h2>
  ${renderTable(["Provider", "Missed prompts", "Competitor-only rows", "No-signal rows", "Prompt score", "Example prompts"], providerTable)}

  <h2>Page Actions</h2>
  ${renderTable(["Page", "Prompts", "Score", "Lanes", "Example prompts", "First action"], pageTable)}

  <h2>Content Actions</h2>
  ${renderTable(["Lane", "Category", "Prompt", "Products", "Competitors", "Action"], contentTable)}
</main>
</body>
</html>`;
}

function renderMarkdown({ promptRows, laneRows, providerRows }) {
  return `# Prompt Loss Decision Board

Exact prompt-level decision sheet for iBOLT AI visibility.

## Summary

- Prompts classified: ${promptRows.length}
- Mention-recovery prompts: ${promptRows.filter((row) => /mention recovery|comparison/i.test(row.lane)).length}
- Citation-zero prompts: ${promptRows.filter((row) => toNumber(row.citationRate) <= 0).length}
- Citation-probe prompts: ${promptRows.filter((row) => /citation probe/i.test(row.lane)).length}

## Top Prompt Losses

${promptRows.slice(0, 20).map((row) => `- ${row.query}: ${row.lane}. Action: ${row.action}`).join("\n")}

## Decision Lanes

${laneRows.map((row) => `- ${row.label}: ${row.prompts} prompts, score ${row.value}`).join("\n")}

## Provider Misses

${providerRows.map((row) => `- ${row.provider}: ${row.missed_prompts} missed prompts, score ${row.prompt_score}`).join("\n")}
`;
}

async function main() {
  const promptMap = new Map();
  const intentRows = await readCsv("query-loss-recovery-matrix/query-loss-recovery-matrix.csv");
  const priorityIntentRows = await readCsv("prompt-intent-loss-report/priority-intent-retest-queue.csv");
  const outcomeRows = await readCsv("answer-outcome-taxonomy/query-outcome-triage.csv");
  const answerRows = await readCsv("answer-evidence-viewer/answer-evidence-ledger.csv");
  const retestRows = await readCsv("page-decision-retest-map/page-decision-retest-map.csv");
  const queryPageRows = await readCsv("query-page-matrix/all-query-page-matrix.csv");
  const familyPromptRows = await readCsv("product-family-visibility-board/product-family-prompt-map.csv");

  for (const row of [...intentRows, ...priorityIntentRows]) {
    const prompt = addPrompt(promptMap, row.query || row.prompt);
    if (!prompt) continue;
    prompt.category ||= row.category || "";
    prompt.severity ||= row.severity || "";
    prompt.lossStage ||= row.loss_stage || "";
    prompt.providerLossRows = Math.max(prompt.providerLossRows, toNumber(row.provider_loss_rows));
    mergeLists(prompt.missedProviders, row.missed_providers);
    mergeLists(prompt.competitors, row.competitors);
    prompt.mappedPageTitle ||= row.page_title || row.page || "";
    prompt.mappedPage ||= row.page_url || row.url || "";
    prompt.mappedPageScore = Math.max(prompt.mappedPageScore, toNumber(row.page_execution_score || row.page_score));
    prompt.lifecycleBucket ||= row.lifecycle_bucket || "";
    mergeLists(prompt.structuralIssues, row.structural_issues);
    mergeLists(prompt.messageThemes, row.message_themes);
    mergeLists(prompt.proofPoints, row.proof_points);
    mergeLists(prompt.productsToFeature, row.products_to_feature);
    mergeLists(prompt.retestWaves, row.retest_waves);
    prompt.retestRequests = Math.max(prompt.retestRequests, toNumber(row.retest_requests));
    prompt.ownerSequence ||= row.owner_sequence || "";
    prompt.successMetric ||= row.success_metric || "";
    prompt.nextAction ||= row.next_action || "";
    prompt.score = Math.max(prompt.score, toNumber(row.score || row.opportunity_score));
    prompt.promptType ||= row.prompt_type || "";
    prompt.intent ||= row.intent || "";
  }

  for (const row of outcomeRows) {
    const prompt = addPrompt(promptMap, row.query);
    if (!prompt) continue;
    prompt.category ||= row.category || "";
    prompt.answerRows = Math.max(prompt.answerRows, toNumber(row.answers));
    prompt.avgScore = Math.max(prompt.avgScore, toNumber(row.avg_score));
    prompt.iboltTop3 = Math.max(prompt.iboltTop3, toNumber(row.ibolt_top3));
    prompt.weakMentions = Math.max(prompt.weakMentions, toNumber(row.weak_mentions));
    prompt.competitorOnly = Math.max(prompt.competitorOnly, toNumber(row.competitor_only));
    prompt.noSignal = Math.max(prompt.noSignal, toNumber(row.no_signal));
    prompt.mentionRate = Math.max(prompt.mentionRate, toNumber(row.mention_rate));
    prompt.top3Rate = Math.max(prompt.top3Rate, toNumber(row.top3_rate));
    prompt.citationRate = Math.max(prompt.citationRate, toNumber(row.citation_rate));
    mergeLists(prompt.missedProviders, row.missed_providers);
    mergeLists(prompt.competitors, row.top_competitors);
    prompt.mappedPage ||= row.mapped_page || "";
    prompt.mappedPageScore = Math.max(prompt.mappedPageScore, toNumber(row.mapped_page_score));
    mergeLists(prompt.structuralIssues, row.structural_issues);
    prompt.nextAction ||= row.next_action || "";
  }

  for (const row of answerRows) {
    const prompt = addPrompt(promptMap, row.query);
    if (!prompt) continue;
    prompt.category ||= row.category || "";
    prompt.answerRows += 1;
    prompt.avgScore = Math.max(prompt.avgScore, toNumber(row.coverage_score));
    mergeLists(prompt.competitors, row.competitors);
    mergeLists(prompt.productSignals, row.product_signals);
    mergeLists(prompt.catalogProducts, row.catalog_products);
    prompt.sourceUrlCount += toNumber(row.source_url_count);
    prompt.mappedPageTitle ||= row.page_title || "";
    prompt.mappedPage ||= row.page_url || "";
    prompt.triageAction ||= row.triage_action || "";
    prompt.recommendedAction ||= row.recommended_action || "";
    prompt.nextAction ||= row.next_action || "";
    if (outcomeIsLoss(row)) prompt.missedProviders.push(normalizeProvider(row.provider));
    if (/competitor/i.test(row.outcome || "")) prompt.competitorOnly += 1;
    if (/no signal/i.test(row.outcome || "")) prompt.noSignal += 1;
    if (/weak/i.test(row.outcome || "")) prompt.weakMentions += 1;
    prompt.providerRows.push(`${normalizeProvider(row.provider)}: ${row.outcome || "unknown"}`);
    if (row.snippet) prompt.snippets.push(row.snippet);
  }

  for (const row of retestRows) {
    const prompt = addPrompt(promptMap, row.prompt);
    if (!prompt) continue;
    prompt.category ||= row.category || "";
    prompt.promptType ||= row.prompt_type || "";
    prompt.score = Math.max(prompt.score, toNumber(row.retest_score || row.score));
    prompt.mappedPage ||= row.page_url || "";
    prompt.mappedPageTitle ||= row.closest_post || "";
    prompt.pageDecision ||= row.decision || "";
    prompt.pagePriority = Math.max(prompt.pagePriority, toNumber(row.page_priority));
    prompt.ownerSequence ||= row.owner || "";
    prompt.successMetric ||= row.expected_metric || row.success_metric || "";
    prompt.nextAction ||= row.first_move || row.next_action || "";
    mergeLists(prompt.competitors, row.competitors);
    mergeLists(prompt.productsToFeature, row.products_to_feature);
    if (row.provider) prompt.missedProviders.push(normalizeProvider(row.provider));
    if (row.wave) prompt.retestWaves.push(row.wave);
  }

  for (const row of queryPageRows) {
    const prompt = addPrompt(promptMap, row.query || row.prompt);
    if (!prompt) continue;
    prompt.category ||= row.category || "";
    prompt.score = Math.max(prompt.score, toNumber(row.opportunity_score || row.priority));
    prompt.avgScore = Math.max(prompt.avgScore, toNumber(row.avg_score));
    prompt.mentionRate = Math.max(prompt.mentionRate, toNumber(row.mention_rate));
    prompt.top3Rate = Math.max(prompt.top3Rate, toNumber(row.top_three_rate));
    prompt.competitorOnly = Math.max(prompt.competitorOnly, toNumber(row.competitor_only_answers));
    mergeLists(prompt.competitors, row.competitors);
    prompt.mappedPageTitle ||= row.page_title || "";
    prompt.mappedPage ||= row.page_url || "";
    prompt.mappedPageScore = Math.max(prompt.mappedPageScore, toNumber(row.page_score));
    prompt.triageAction ||= row.triage_action || "";
    mergeLists(prompt.triageIssues, row.triage_issues);
    mergeLists(prompt.structuralIssues, row.structural_issues);
    mergeLists(prompt.productsToFeature, row.products_to_add || row.product_module);
    mergeLists(prompt.weakestProviders, row.weakest_providers);
    prompt.recommendedAction ||= row.recommended_action || "";
    prompt.nextAction ||= row.next_action || row.retest_action || "";
  }

  for (const row of familyPromptRows) {
    const prompt = addPrompt(promptMap, row.prompt || row.query);
    if (!prompt) continue;
    if (row.family) prompt.productFamilySignals.push(row.family);
    mergeLists(prompt.productsToFeature, row.products || row.products_to_feature || row.sample_products);
    mergeLists(prompt.competitors, row.competitors);
    if (row.action || row.test_action) prompt.productFamilyActions.push(row.action || row.test_action);
    prompt.score = Math.max(prompt.score, toNumber(row.score || row.priority));
  }

  const promptRows = buildRows(promptMap);
  const laneRows = groupSummary(promptRows, "lane");
  const categoryRows = groupSummary(promptRows, "category");
  const providerRows = providerSummary(promptRows);

  const pageMap = new Map();
  for (const row of promptRows) {
    const page = row.mappedPage || row.mappedPageTitle || "No mapped page";
    const current = pageMap.get(page) || { page, prompt_count: 0, total_score: 0, lanes: [], prompts: [], first_action: "" };
    current.prompt_count += 1;
    current.total_score += row.decisionScore;
    current.lanes.push(row.lane);
    current.prompts.push(row.query);
    current.first_action ||= row.action;
    pageMap.set(page, current);
  }
  const pageRows = [...pageMap.values()].map((row) => ({
    ...row,
    lanes: unique(row.lanes),
    prompts: unique(row.prompts),
  })).sort((a, b) => b.total_score - a.total_score || a.page.localeCompare(b.page));

  const contentRows = promptRows.map((row) => ({
    lane: row.lane,
    category: row.category,
    query: row.query,
    products: row.products.slice(0, 5).join("; "),
    competitors: row.competitors.slice(0, 5).join("; "),
    action: row.action,
  }));

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml({ promptRows, laneRows, categoryRows, providerRows, pageRows, contentRows }));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown({ promptRows, laneRows, providerRows }));
  await writeFile(path.join(outDir, "prompt-loss-decision-board.csv"), csv([
    [
      "decision_score",
      "query",
      "category",
      "lane",
      "missed_providers",
      "answer_rows",
      "competitor_only",
      "no_signal",
      "mention_rate",
      "top3_rate",
      "citation_rate",
      "competitors",
      "products",
      "mapped_page",
      "mapped_page_title",
      "mapped_page_score",
      "page_decision",
      "structural_issues",
      "retest_waves",
      "success_metric",
      "action",
    ],
    ...promptRows.map((row) => [
      row.decisionScore,
      row.query,
      row.category,
      row.lane,
      row.missedProviders.join("; "),
      row.answerRows,
      row.competitorOnly,
      row.noSignal,
      row.mentionRate,
      row.top3Rate,
      row.citationRate,
      row.competitors.join("; "),
      row.products.join("; "),
      row.mappedPage,
      row.mappedPageTitle,
      row.mappedPageScore,
      row.pageDecision,
      row.structuralIssues.join("; "),
      row.retestWaves.join("; "),
      row.successMetric,
      row.action,
    ]),
  ]));
  await writeFile(path.join(outDir, "prompt-page-actions.csv"), csv([
    ["page", "prompt_count", "total_score", "lanes", "example_prompts", "first_action"],
    ...pageRows.map((row) => [row.page, row.prompt_count, row.total_score, row.lanes.join("; "), row.prompts.slice(0, 8).join("; "), row.first_action]),
  ]));
  await writeFile(path.join(outDir, "prompt-provider-actions.csv"), csv([
    ["provider", "missed_prompts", "competitor_only", "no_signal", "prompt_score", "example_prompts"],
    ...providerRows.map((row) => [row.provider, row.missed_prompts, row.competitor_only, row.no_signal, row.prompt_score, unique(row.top_queries).slice(0, 12).join("; ")]),
  ]));
  await writeFile(path.join(outDir, "prompt-content-actions.csv"), csv([
    ["lane", "category", "query", "products", "competitors", "action"],
    ...contentRows.map((row) => [row.lane, row.category, row.query, row.products, row.competitors, row.action]),
  ]));

  console.log(`Wrote ${outDir}`);
  console.log(`Prompts classified: ${promptRows.length}`);
  console.log(`Mention-recovery prompts: ${promptRows.filter((row) => /mention recovery|comparison/i.test(row.lane)).length}`);
  console.log(`Citation-probe prompts: ${promptRows.filter((row) => /citation probe/i.test(row.lane)).length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
