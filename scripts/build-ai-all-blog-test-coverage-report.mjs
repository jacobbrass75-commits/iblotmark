#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "all-blog-test-coverage-report");

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

function normalizeUrl(value) {
  return String(value ?? "").replace(/\/+$/, "");
}

function toNumber(value) {
  const match = String(value ?? "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniq(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function slugPhrase(title) {
  const text = String(title ?? "");
  if (/galaxy\s+a7\s+lite/i.test(text)) return "Samsung Galaxy A7 Lite tablet mount";
  if (/ELD/i.test(text) && /fleet compliance/i.test(text)) return "ELD tablet mount for fleet compliance";
  if (/Toast|Square|Delivery Apps/i.test(text)) return "restaurant tablet mount for Toast Square and delivery apps";
  if (/ProClip.*RAM|RAM.*ProClip/i.test(text)) return "delivery van phone mount";
  if (/Arkon/i.test(text) && /commercial vehicle/i.test(text)) return "commercial vehicle phone mount";
  if (/fish finder/i.test(text) && /value/i.test(text)) return "durable value fish finder mount";
  return text
    .replace(/\b20\d{2}\b/g, "")
    .replace(/iBOLT/gi, "")
    .replace(/\btop\s*5\b/gi, "")
    .replace(/\bvs\b/gi, " ")
    .replace(/[™®]/g, "")
    .replace(/[:|()?]/g, " ")
    .replace(/\b(best|guide|comparison|how|to|choose|right|setup|for|and|with|the|a|an|in)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 85);
}

function defaultCompetitor(category) {
  const key = String(category ?? "").toLowerCase();
  if (key.includes("restaurant")) return "Square";
  if (key.includes("fishing")) return "RAM Mounts";
  if (key.includes("fleet")) return "RAM Mounts";
  if (key.includes("delivery")) return "iOttie";
  if (key.includes("warehouse")) return "RAM Mounts";
  if (key.includes("streaming")) return "Arkon";
  return "RAM Mounts";
}

function categoryPromptLabel(category) {
  const key = String(category ?? "").toLowerCase();
  if (key.includes("amps")) return "AMPS mounting system";
  if (key.includes("restaurant")) return "restaurant tablet mount";
  if (key.includes("fishing")) return "fish finder mount";
  if (key.includes("fleet")) return "fleet mount";
  if (key.includes("delivery")) return "delivery driver phone mount";
  if (key.includes("warehouse")) return "forklift tablet mount";
  if (key.includes("streaming")) return "streaming phone mount";
  return `${category || "iBOLT"} mount`;
}

function pageUrlMap(rows, key = "page_url") {
  const map = new Map();
  for (const row of rows) {
    const url = normalizeUrl(row[key]);
    if (!url) continue;
    if (!map.has(url)) map.set(url, []);
    map.get(url).push(row);
  }
  return map;
}

function suggestedPrompts(page) {
  const titlePhrase = slugPhrase(page.title);
  const category = page.category || "mount";
  const product = splitList(page.products_to_feature)[0] || "";
  const listedCompetitor = splitList(page.competitors)
    .map((item) => item.replace(/\s+\d+$/g, "").trim())
    .find((item) => item && !/^garmin$/i.test(item));
  const competitor = listedCompetitor || defaultCompetitor(category);
  const base = titlePhrase || `${category} mount`;
  return uniq([
    `best ${base}`,
    `${competitor} vs iBOLT for ${base}`,
    product ? `is ${product} good for ${base}` : `what iBOLT ${categoryPromptLabel(category)} should I use for ${base}`,
    `which brands are cited for ${base}`,
  ]).slice(0, 4);
}

function coverageState({ priorityRequests, expandedPrompts, benchmarkQueries }) {
  if (priorityRequests > 0) return "priority_retest_ready";
  if (expandedPrompts >= 5) return "expanded_deep_ready";
  if (expandedPrompts > 0) return "expanded_light_ready";
  if (benchmarkQueries > 0) return "baseline_only_needs_expansion";
  return "prompt_gap";
}

function testDepth(expandedPrompts, priorityRequests) {
  if (priorityRequests > 0) return "priority";
  if (expandedPrompts >= 5) return "deep";
  if (expandedPrompts >= 3) return "standard";
  if (expandedPrompts > 0) return "light";
  return "missing";
}

function actionFor(state, page) {
  if (state === "priority_retest_ready") return "Run after the page edit is published, then compare answer role, mention, top-3, and citation movement.";
  if (state === "expanded_deep_ready") return "Keep in expanded manifest. Edit page issues first, then run when budget allows.";
  if (state === "expanded_light_ready") return "Add one competitor prompt, one product-entity prompt, and one citation probe before full retest.";
  if (state === "baseline_only_needs_expansion") return "Convert existing benchmark query into provider-specific expanded prompts.";
  return `Add prompts before the next benchmark: ${suggestedPrompts(page).join("; ")}.`;
}

function buildRows({ pages, expandedPrompts, expandedRequests, priorityRequests }) {
  const expandedByUrl = pageUrlMap(expandedPrompts);
  const expandedReqByUrl = pageUrlMap(expandedRequests);
  const priorityByUrl = pageUrlMap(priorityRequests);

  return pages.map((page) => {
    const url = normalizeUrl(page.url);
    const expanded = expandedByUrl.get(url) || [];
    const expandedReqs = expandedReqByUrl.get(url) || [];
    const priority = priorityByUrl.get(url) || [];
    const benchmarkQueries = toNumber(page.benchmark_query_count);
    const state = coverageState({
      priorityRequests: priority.length,
      expandedPrompts: expanded.length,
      benchmarkQueries,
    });
    return {
      rank: toNumber(page.rank),
      title: page.title,
      url,
      category: page.category,
      pageStatus: page.page_status,
      aiVisibilityStage: page.ai_visibility_stage,
      conversionTier: page.conversion_tier,
      coverageState: state,
      testDepth: testDepth(expanded.length, priority.length),
      benchmarkQueries,
      zeroMentionQueries: toNumber(page.zero_mention_queries),
      competitorOnlyAnswers: toNumber(page.competitor_only_answers),
      cleanMentions: toNumber(page.clean_mentions),
      coMentions: toNumber(page.co_mentions),
      expandedPrompts: expanded.length,
      expandedProviderRequests: expandedReqs.length,
      priorityProviderRequests: priority.length,
      expandedPromptTypes: uniq(expanded.map((row) => row.prompt_type)).join("; "),
      expandedPromptSources: uniq(expanded.map((row) => row.source)).join("; "),
      priorityWaves: uniq(priority.map((row) => row.wave)).join("; "),
      competitors: page.competitors,
      products: page.products_to_feature,
      issueFlags: page.issue_flags,
      suggestedPrompts: suggestedPrompts(page).join("; "),
      recommendedAction: actionFor(state, page),
    };
  }).sort((a, b) => {
    const stateOrder = {
      prompt_gap: 0,
      baseline_only_needs_expansion: 1,
      expanded_light_ready: 2,
      expanded_deep_ready: 3,
      priority_retest_ready: 4,
    };
    return stateOrder[a.coverageState] - stateOrder[b.coverageState]
      || b.competitorOnlyAnswers - a.competitorOnlyAnswers
      || a.rank - b.rank;
  });
}

function buildCategoryRows(rows) {
  const categories = uniq(rows.map((row) => row.category));
  return categories.map((category) => {
    const group = rows.filter((row) => row.category === category);
    return {
      category,
      pages: group.length,
      priorityPages: group.filter((row) => row.coverageState === "priority_retest_ready").length,
      expandedPages: group.filter((row) => row.expandedPrompts > 0).length,
      promptGapPages: group.filter((row) => row.coverageState === "prompt_gap").length,
      providerRequests: group.reduce((sum, row) => sum + row.expandedProviderRequests, 0),
      competitorOnlyAnswers: group.reduce((sum, row) => sum + row.competitorOnlyAnswers, 0),
      topGapPages: group.filter((row) => row.coverageState === "prompt_gap").slice(0, 4).map((row) => row.title).join("; "),
    };
  }).sort((a, b) => b.promptGapPages - a.promptGapPages || b.pages - a.pages);
}

function buildStateRows(rows) {
  const states = uniq(rows.map((row) => row.coverageState));
  return states.map((state) => {
    const group = rows.filter((row) => row.coverageState === state);
    return {
      state,
      pages: group.length,
      prompts: group.reduce((sum, row) => sum + row.expandedPrompts, 0),
      requests: group.reduce((sum, row) => sum + row.expandedProviderRequests + row.priorityProviderRequests, 0),
      competitorOnlyAnswers: group.reduce((sum, row) => sum + row.competitorOnlyAnswers, 0),
      examplePages: group.slice(0, 5).map((row) => row.title).join("; "),
    };
  }).sort((a, b) => b.pages - a.pages);
}

function renderTable(headers, rows) {
  return `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function renderHtml({ rows, categoryRows, stateRows }) {
  const pages = rows.length;
  const expandedPages = rows.filter((row) => row.expandedPrompts > 0).length;
  const priorityPages = rows.filter((row) => row.priorityProviderRequests > 0).length;
  const gapPages = rows.filter((row) => row.coverageState === "prompt_gap").length;
  const totalPrompts = rows.reduce((sum, row) => sum + row.expandedPrompts, 0);
  const totalRequests = rows.reduce((sum, row) => sum + row.expandedProviderRequests, 0);
  const cardRows = [
    ["Blog pages", pages, "Live blog pages classified in the all-page drilldown."],
    ["Expanded coverage", `${expandedPages}/${pages}`, `${totalPrompts} prompts and ${totalRequests} provider requests staged.`],
    ["Priority retest pages", priorityPages, "Pages in the current 204-request priority packet."],
    ["Prompt gaps", gapPages, "Pages with no page-level expanded prompts yet."],
  ];
  const cards = cardRows.map(([label, value, note]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");
  const gapRows = rows
    .filter((row) => row.coverageState === "prompt_gap" || row.coverageState === "expanded_light_ready")
    .slice(0, 30)
    .map((row) => [row.coverageState, row.category, row.title, row.url, row.expandedPrompts, row.suggestedPrompts, row.recommendedAction]);
  const topRows = rows
    .filter((row) => row.priorityProviderRequests > 0 || row.competitorOnlyAnswers > 0)
    .sort((a, b) => b.priorityProviderRequests - a.priorityProviderRequests || b.competitorOnlyAnswers - a.competitorOnlyAnswers)
    .slice(0, 25)
    .map((row) => [row.testDepth, row.category, row.title, row.expandedPrompts, row.expandedProviderRequests, row.priorityProviderRequests, row.competitors, row.recommendedAction]);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT All Blog Test Coverage Report</title>
  <style>
    body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1220px;margin:0 auto;padding:34px 24px 64px}
    h1{font-size:36px;margin:0 0 8px}
    h2{font-size:23px;margin:34px 0 12px}
    p,li{line-height:1.55;color:#334155;font-size:15px}
    .note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #0f766e;border-radius:12px;padding:16px 18px;margin:20px 0}
    .cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:22px 0}
    .card{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:16px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:800}
    .value{font-size:30px;font-weight:900;margin:8px 0;color:#0f172a}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 22px}
    th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    a{color:#0f766e;overflow-wrap:anywhere}
    @media(max-width:900px){.cards{grid-template-columns:1fr}h1{font-size:30px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT All Blog Test Coverage Report</h1>
  <p>Page-level view of which live blog posts are covered by the current benchmark, expanded prompt pack, and priority retest packet.</p>
  <div class="note"><strong>Coverage read:</strong> the expanded prompt pack already reaches most live blog pages. The remaining work is to close page-level prompt gaps, deepen light coverage, then run the live provider retest after priority page edits.</div>
  <section class="cards">${cards}</section>
  <h2>Coverage By State</h2>
  ${renderTable(["Coverage state", "Pages", "Prompts", "Requests", "Competitor-only baseline", "Example pages"], stateRows.map((row) => [row.state, row.pages, row.prompts, row.requests, row.competitorOnlyAnswers, row.examplePages]))}
  <h2>Coverage By Category</h2>
  ${renderTable(["Category", "Pages", "Priority pages", "Expanded pages", "Prompt gaps", "Provider requests", "Competitor-only baseline", "Top gap pages"], categoryRows.map((row) => [row.category, row.pages, row.priorityPages, row.expandedPages, row.promptGapPages, row.providerRequests, row.competitorOnlyAnswers, row.topGapPages]))}
  <h2>Pages Needing More Test Coverage</h2>
  ${renderTable(["State", "Category", "Page", "URL", "Expanded prompts", "Suggested prompts", "Action"], gapRows)}
  <h2>Highest-Pressure Covered Pages</h2>
  ${renderTable(["Depth", "Category", "Page", "Prompts", "Expanded requests", "Priority requests", "Competitors", "Action"], topRows)}
</main>
</body>
</html>`;
}

function renderMarkdown({ rows, categoryRows, stateRows }) {
  const pages = rows.length;
  const expandedPages = rows.filter((row) => row.expandedPrompts > 0).length;
  const priorityPages = rows.filter((row) => row.priorityProviderRequests > 0).length;
  const gapPages = rows.filter((row) => row.coverageState === "prompt_gap").length;
  return `# iBOLT All Blog Test Coverage Report

## Summary

- Blog pages classified: ${pages}
- Pages with expanded prompt coverage: ${expandedPages}/${pages}
- Pages in priority retest packet: ${priorityPages}
- Pages without page-level expanded prompts: ${gapPages}

## Coverage By State

| State | Pages | Prompts | Requests | Competitor-only baseline |
| --- | ---: | ---: | ---: | ---: |
${stateRows.map((row) => `| ${row.state} | ${row.pages} | ${row.prompts} | ${row.requests} | ${row.competitorOnlyAnswers} |`).join("\n")}

## Coverage By Category

| Category | Pages | Priority pages | Expanded pages | Prompt gaps | Provider requests |
| --- | ---: | ---: | ---: | ---: | ---: |
${categoryRows.map((row) => `| ${row.category} | ${row.pages} | ${row.priorityPages} | ${row.expandedPages} | ${row.promptGapPages} | ${row.providerRequests} |`).join("\n")}
`;
}

async function main() {
  const pages = await readCsv("all-page-ai-drilldown/all-page-ai-drilldown.csv");
  const expandedPrompts = await readCsv("page-derived-expanded-benchmark-pack/selected-prompts.csv");
  const expandedRequests = await readCsv("page-derived-expanded-benchmark-pack/provider-request-manifest.csv");
  const priorityRequests = await readCsv("priority-retest-packet/priority-retest-request-queue.csv");
  const rows = buildRows({ pages, expandedPrompts, expandedRequests, priorityRequests });
  const categoryRows = buildCategoryRows(rows);
  const stateRows = buildStateRows(rows);

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "all-blog-test-coverage-ledger.csv"), csv([
    ["rank", "title", "url", "category", "coverage_state", "test_depth", "benchmark_queries", "zero_mention_queries", "competitor_only_answers", "clean_mentions", "co_mentions", "expanded_prompts", "expanded_provider_requests", "priority_provider_requests", "expanded_prompt_types", "expanded_prompt_sources", "priority_waves", "competitors", "products", "issue_flags", "suggested_prompts", "recommended_action"],
    ...rows.map((row) => [row.rank, row.title, row.url, row.category, row.coverageState, row.testDepth, row.benchmarkQueries, row.zeroMentionQueries, row.competitorOnlyAnswers, row.cleanMentions, row.coMentions, row.expandedPrompts, row.expandedProviderRequests, row.priorityProviderRequests, row.expandedPromptTypes, row.expandedPromptSources, row.priorityWaves, row.competitors, row.products, row.issueFlags, row.suggestedPrompts, row.recommendedAction]),
  ]));
  await writeFile(path.join(outDir, "coverage-by-category.csv"), csv([
    ["category", "pages", "priority_pages", "expanded_pages", "prompt_gap_pages", "provider_requests", "competitor_only_baseline", "top_gap_pages"],
    ...categoryRows.map((row) => [row.category, row.pages, row.priorityPages, row.expandedPages, row.promptGapPages, row.providerRequests, row.competitorOnlyAnswers, row.topGapPages]),
  ]));
  await writeFile(path.join(outDir, "coverage-by-state.csv"), csv([
    ["coverage_state", "pages", "prompts", "requests", "competitor_only_baseline", "example_pages"],
    ...stateRows.map((row) => [row.state, row.pages, row.prompts, row.requests, row.competitorOnlyAnswers, row.examplePages]),
  ]));
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml({ rows, categoryRows, stateRows }));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown({ rows, categoryRows, stateRows }));

  console.log(`Wrote ${outDir}`);
  console.log(`Pages: ${rows.length}`);
  console.log(`Expanded pages: ${rows.filter((row) => row.expandedPrompts > 0).length}`);
  console.log(`Prompt gaps: ${rows.filter((row) => row.coverageState === "prompt_gap").length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
