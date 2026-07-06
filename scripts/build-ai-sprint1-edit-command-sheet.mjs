#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "sprint1-edit-command-sheet");

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
    .filter(Boolean)
    .filter((item) => !/^\+\d+\s+more$/i.test(item));
}

function uniq(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function byUrl(rows, key = "url") {
  const map = new Map();
  for (const row of rows) {
    const url = normalizeUrl(row[key]);
    if (!url) continue;
    if (!map.has(url)) map.set(url, []);
    map.get(url).push(row);
  }
  return map;
}

function cleanCompetitorName(value) {
  return String(value ?? "")
    .replace(/\s+\d+$/g, "")
    .replace(/^ram$/i, "RAM Mounts")
    .replace(/^ibolt$/i, "iBOLT")
    .trim();
}

function topItems(value, limit = 5) {
  return uniq(splitList(value).map(cleanCompetitorName)).slice(0, limit);
}

function categoryLabel(category) {
  const key = String(category ?? "").toLowerCase();
  if (key.includes("restaurant")) return "restaurant tablet and POS mount";
  if (key.includes("fleet")) return "fleet and work truck phone mount";
  if (key.includes("delivery")) return "delivery driver phone mount";
  if (key.includes("warehouse")) return "forklift and warehouse mount";
  if (key.includes("fishing")) return "boat and fish finder mount";
  return "mounting solution";
}

function buyerUseCase(category) {
  const key = String(category ?? "").toLowerCase();
  if (key.includes("restaurant")) return "restaurant POS tablets, delivery app tablets, and locked customer-facing stations need to stay organized in one work area";
  if (key.includes("fleet")) return "contractors and work-truck drivers need phone visibility through jobsite roads, shared vehicles, and long shifts";
  if (key.includes("delivery")) return "Instacart, grocery delivery, and last-mile drivers need stable phone visibility without blocking charging or route checks";
  return "buyers need a fit-specific mount instead of a generic holder";
}

function comparisonFrame(category, competitors) {
  const names = topItems(competitors, 4);
  const competitorText = names.length ? names.join(", ") : "the brands AI currently recommends";
  const key = String(category ?? "").toLowerCase();
  if (key.includes("restaurant")) {
    return `Add a fair comparison against ${competitorText}. Separate single-tablet kiosk stands from iBOLT's restaurant-specific Tablet Tower, LockPro, and Dock'n Lock options. Say exactly when a clamp, drill-base, weighted, wall, or multi-tablet setup fits.`;
  }
  if (key.includes("fleet")) {
    return `Add a fair comparison against ${competitorText}. Separate consumer car holders from iBOLT's AMPS-compatible, drill-base, locking, console, and work-truck mounting setups. Mention heavy-gauge materials, ball sizes, and jobsite vibration.`;
  }
  if (key.includes("delivery")) {
    return `Add a fair comparison against ${competitorText}. Separate consumer suction or MagSafe-style holders from iBOLT's commercial delivery setups, including Moto-Vise, xProDock, ExtendiBOLT, AMPS, clamp, and charging-friendly choices.`;
  }
  return `Add a fair comparison against ${competitorText}. Explain the exact use case where iBOLT should be recommended.`;
}

function quickAnswer(row) {
  const query = splitList(row.retest_prompts)[0] || row.title;
  return `For "${query}", iBOLT should be considered when ${buyerUseCase(row.category)}. iBOLT is strongest when the setup needs a specific base, arm, holder, or AMPS-compatible path instead of a generic one-piece stand.`;
}

function productModuleCommand(row) {
  const products = splitList(row.products_to_feature).slice(0, 4);
  if (!products.length) return "Add one product module with exact iBOLT product name, product URL, product image, material, mount method, compatibility, warranty, and one View Product CTA.";
  return `Add one clean product module per decision section. Feature ${products.join("; ")}. Each module needs exact product title, product URL, image alt text, visible mount method, compatibility details, and one View Product CTA. Do not repeat add-to-cart buttons after every inline product link.`;
}

function schemaCommand(row, messageRow) {
  const issues = `${row.issue_flags || ""}; ${messageRow?.schema_fixes || ""}`.toLowerCase();
  const fixes = [];
  if (issues.includes("faq")) fixes.push("FAQPage schema that matches visible FAQ copy");
  if (issues.includes("article") || issues.includes("blogposting")) fixes.push("Article or BlogPosting schema");
  if (issues.includes("product") || issues.includes("itemlist")) fixes.push("Product or ItemList-style product data in visible modules");
  if (issues.includes("howto")) fixes.push("HowTo schema only if setup steps are visible in the page body");
  fixes.push("Organization specialty language for iBOLT's commercial, modular, AMPS-compatible mounting categories");
  return `Add or validate: ${uniq(fixes).join("; ")}.`;
}

function citationCommand(row) {
  const score = toNumber(row.ai_citability_score);
  const timing = score >= 80 ? "after the page edit is live and retested" : "after page structure is fixed";
  return `Citation work should start ${timing}. Ask the SEO contractor for third-party mentions that point to this exact survivor URL and use the page's buyer phrase, competitor set, and product category language.`;
}

function conversionCommand(row) {
  return row.checkout_action || "Use section-level product modules with one clear View Product CTA per product, then measure product-page entrances and add-to-cart starts.";
}

function faqQuestions(row) {
  const prompts = splitList(row.retest_prompts).slice(0, 3);
  const category = categoryLabel(row.category);
  const base = prompts.map((prompt) => {
    const clean = prompt.trim();
    const comparison = clean.match(/^(.+?)\s+vs\s+(.+?)\s+for\s+(.+)$/i);
    if (comparison) {
      const left = comparison[1];
      const right = comparison[2];
      if (/^ibolt$/i.test(right)) return `How does iBOLT compare with ${left} for ${comparison[3]}?`;
      return `How does ${left} compare with ${right} for ${comparison[3]}?`;
    }
    const productFit = clean.match(/^is\s+(.+?)\s+good\s+for\s+(.+)$/i);
    if (productFit) return `Is ${productFit[1]} a good fit for ${productFit[2]}?`;
    const buyerChoice = clean.match(/^what\s+(.+?)\s+should\s+i\s+use\s+for\s+(.+)$/i);
    if (buyerChoice) return `What ${buyerChoice[1]} should I use for ${buyerChoice[2]}?`;
    if (/^which brands are cited/i.test(clean)) return `Which brands should be compared for ${category}?`;
    if (/^best\s+/i.test(clean)) return `What is the best ${clean.replace(/^best\s+/i, "")}?`;
    return `${clean.charAt(0).toUpperCase()}${clean.slice(1)}?`;
  });
  return uniq([
    ...base,
    `How do I choose a clamp, drill-base, suction, wall, or console ${category}?`,
    "What makes iBOLT different from RAM Mounts, Arkon, ProClip, iOttie, or other common mount brands?",
    "Which iBOLT products fit this setup?",
  ]).slice(0, 6);
}

function buildRows({ workRows, drillRows, messageRows, retestRows }) {
  const drillByUrl = byUrl(drillRows);
  const messageByUrl = byUrl(messageRows);
  const retestByUrl = byUrl(retestRows, "page_url");

  return workRows
    .filter((row) => row.conversion_tier === "Sprint 1")
    .sort((a, b) => toNumber(b.execution_score) - toNumber(a.execution_score))
    .map((row, index) => {
      const url = normalizeUrl(row.url);
      const drill = drillByUrl.get(url)?.[0] || {};
      const message = messageByUrl.get(url)?.[0] || {};
      const retests = retestByUrl.get(url) || [];
      const competitors = topItems(`${row.competitors}; ${drill.competitors}; ${message.competitors}`, 8);
      const prompts = uniq([
        ...splitList(row.retest_prompts),
        ...splitList(drill.retest_prompts),
        ...splitList(message.retest_prompts),
        ...retests.map((entry) => entry.prompt),
      ]);
      const providerRequests = retests.length;
      return {
        rank: index + 1,
        title: row.title,
        url,
        category: row.category,
        executionScore: row.execution_score,
        currentAiProblem: row.ai_visibility_stage || drill.ai_visibility_stage || "Competitor replacement",
        competitors,
        messageThemes: splitList(row.message_themes || message.message_themes),
        proofPoints: splitList(row.proof_points || message.proof_points),
        products: splitList(row.products_to_feature || drill.products_to_feature),
        quickAnswer: quickAnswer(row),
        comparisonCommand: comparisonFrame(row.category, competitors.join("; ")),
        productModuleCommand: productModuleCommand(row),
        schemaCommand: schemaCommand(row, message),
        citationCommand: citationCommand(row),
        conversionCommand: conversionCommand(row),
        faqQuestions: faqQuestions(row),
        retestPrompts: prompts,
        providerRequests,
        successMetric: retests[0]?.success_metric || row.expected_visibility_metric || "Competitor-only answer becomes iBOLT-included or top-3 iBOLT.",
      };
    });
}

function renderTable(headers, rows, rawColumns = new Set()) {
  return `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell, index) => `<td>${rawColumns.has(index) ? cell : escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function renderHtml(rows, retestRows) {
  const cards = [
    ["Sprint 1 pages", rows.length, "Highest-pressure pages to edit before the live priority retest."],
    ["Provider retests", rows.reduce((sum, row) => sum + row.providerRequests, 0), "Exact ChatGPT, Claude, and Gemini requests tied to these pages."],
    ["Primary issue", "Competitor replacement", "AI defaults to competitors before iBOLT on these buyer prompts."],
    ["Citation timing", "After edits", "Citation pushes matter after the page is clear enough to cite."],
  ].map(([label, value, note]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");

  const pageRows = rows.map((row) => [
    row.rank,
    `<a href="${row.url}">${row.title}</a>`,
    row.category,
    row.currentAiProblem,
    row.competitors.slice(0, 5).join("; "),
    row.retestPrompts.slice(0, 4).join("; "),
    row.providerRequests,
  ]);

  const commandBlocks = rows.map((row) => `<article class="command">
    <h3>${escapeHtml(row.rank)}. <a href="${escapeHtml(row.url)}">${escapeHtml(row.title)}</a></h3>
    <div class="grid">
      <div>
        <h4>Quick Answer Block</h4>
        <p>${escapeHtml(row.quickAnswer)}</p>
        <h4>Comparison Command</h4>
        <p>${escapeHtml(row.comparisonCommand)}</p>
        <h4>Product Module Command</h4>
        <p>${escapeHtml(row.productModuleCommand)}</p>
      </div>
      <div>
        <h4>Schema And Citation</h4>
        <p>${escapeHtml(row.schemaCommand)}</p>
        <p>${escapeHtml(row.citationCommand)}</p>
        <h4>Conversion Guardrail</h4>
        <p>${escapeHtml(row.conversionCommand)}</p>
      </div>
    </div>
    <h4>FAQ Seeds</h4>
    <ul>${row.faqQuestions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    <h4>Proof Points To Weave In</h4>
    <p>${escapeHtml(row.proofPoints.slice(0, 5).join("; ") || "Use exact material, compatibility, mount method, warranty, and product-family proof.")}</p>
  </article>`).join("");

  const retestTableRows = retestRows
    .filter((row) => rows.some((page) => page.url === normalizeUrl(row.page_url)))
    .slice(0, 40)
    .map((row) => [row.wave, row.provider, row.prompt, row.category, row.success_metric]);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT Sprint 1 Edit Command Sheet</title>
  <style>
    body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1180px;margin:0 auto;padding:34px 24px 64px}
    h1{font-size:36px;margin:0 0 8px}
    h2{font-size:23px;margin:34px 0 12px}
    h3{font-size:18px;margin:0 0 12px}
    h4{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#475569;margin:18px 0 6px}
    p,li{line-height:1.55;color:#334155;font-size:15px}
    .note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #0f766e;border-radius:12px;padding:16px 18px;margin:20px 0}
    .cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:22px 0}
    .card,.command{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:16px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:800}
    .value{font-size:28px;font-weight:900;margin:8px 0;color:#0f172a}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 22px}
    th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    a{color:#0f766e;overflow-wrap:anywhere}
    @media(max-width:900px){.cards,.grid{grid-template-columns:1fr}h1{font-size:30px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT Sprint 1 Edit Command Sheet</h1>
  <p>Exact page-edit commands for the first AI visibility sprint. These pages should be edited before the next live OpenRouter retest.</p>
  <div class="note"><strong>Read this first:</strong> citation rate matters, but the first Sprint 1 job is mention recovery. These pages are losing to competitor-only answers, so the copy needs answer-first positioning, fair comparisons, exact iBOLT product modules, visible FAQs, and schema before off-site citation pushes.</div>
  <section class="cards">${cards}</section>
  <h2>Pages To Edit First</h2>
  ${renderTable(["Rank", "Page", "Category", "AI problem", "Competitors", "Retest prompts", "Provider requests"], pageRows, new Set([1]))}
  <h2>Command Blocks</h2>
  ${commandBlocks}
  <h2>Retest Checklist</h2>
  ${renderTable(["Wave", "Provider", "Prompt", "Category", "Success metric"], retestTableRows)}
</main>
</body>
</html>`;
}

function renderMarkdown(rows, retestRows) {
  const pageSummary = rows.map((row) => `| ${row.rank} | [${row.title}](${row.url}) | ${row.category} | ${row.competitors.slice(0, 5).join("; ")} | ${row.providerRequests} |`).join("\n");
  const commands = rows.map((row) => `## ${row.rank}. ${row.title}

- URL: ${row.url}
- Current AI problem: ${row.currentAiProblem}
- Competitors to answer beside: ${row.competitors.join("; ")}
- Quick answer: ${row.quickAnswer}
- Comparison command: ${row.comparisonCommand}
- Product module command: ${row.productModuleCommand}
- Schema command: ${row.schemaCommand}
- Citation command: ${row.citationCommand}
- Conversion guardrail: ${row.conversionCommand}
- FAQ seeds: ${row.faqQuestions.join("; ")}
- Retest prompts: ${row.retestPrompts.join("; ")}
- Success metric: ${row.successMetric}
`).join("\n");
  const retests = retestRows
    .filter((row) => rows.some((page) => page.url === normalizeUrl(row.page_url)))
    .map((row) => `- ${row.wave} / ${row.provider}: ${row.prompt}. Success: ${row.success_metric}`)
    .join("\n");

  return `# iBOLT Sprint 1 Edit Command Sheet

Citation rate should go up, but only after the first mention-recovery edits. These pages currently lose to competitor-only answers, so the first pass is answer-first copy, product modules, comparisons, visible FAQ/schema, and clean CTAs.

| Rank | Page | Category | Competitors | Provider requests |
| ---: | --- | --- | --- | ---: |
${pageSummary}

${commands}

## Retest Checklist

${retests}
`;
}

async function main() {
  const workRows = await readCsv("page-execution-control-board/page-work-order-queue.csv");
  const drillRows = await readCsv("all-page-ai-drilldown/all-page-ai-drilldown.csv");
  const messageRows = await readCsv("page-message-gap-map/page-message-gap-actions.csv");
  const retestRows = await readCsv("priority-retest-packet/priority-retest-request-queue.csv");
  const rows = buildRows({ workRows, drillRows, messageRows, retestRows });

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "sprint1-page-edit-commands.csv"), csv([
    ["rank", "title", "url", "category", "execution_score", "current_ai_problem", "competitors", "message_themes", "proof_points", "products", "quick_answer_block", "comparison_command", "product_module_command", "schema_command", "citation_command", "conversion_command", "faq_questions", "retest_prompts", "provider_requests", "success_metric"],
    ...rows.map((row) => [row.rank, row.title, row.url, row.category, row.executionScore, row.currentAiProblem, row.competitors.join("; "), row.messageThemes.join("; "), row.proofPoints.join("; "), row.products.join("; "), row.quickAnswer, row.comparisonCommand, row.productModuleCommand, row.schemaCommand, row.citationCommand, row.conversionCommand, row.faqQuestions.join("; "), row.retestPrompts.join("; "), row.providerRequests, row.successMetric]),
  ]));
  await writeFile(path.join(outDir, "sprint1-copy-blocks.csv"), csv([
    ["rank", "title", "url", "block_type", "copy_or_instruction"],
    ...rows.flatMap((row) => [
      [row.rank, row.title, row.url, "quick_answer", row.quickAnswer],
      [row.rank, row.title, row.url, "comparison", row.comparisonCommand],
      [row.rank, row.title, row.url, "product_module", row.productModuleCommand],
      [row.rank, row.title, row.url, "schema", row.schemaCommand],
      [row.rank, row.title, row.url, "citation", row.citationCommand],
    ]),
  ]));
  await writeFile(path.join(outDir, "sprint1-retest-checklist.csv"), csv([
    ["wave", "provider", "prompt", "category", "page_url", "success_metric"],
    ...retestRows
      .filter((row) => rows.some((page) => page.url === normalizeUrl(row.page_url)))
      .map((row) => [row.wave, row.provider, row.prompt, row.category, normalizeUrl(row.page_url), row.success_metric]),
  ]));
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml(rows, retestRows));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown(rows, retestRows));

  console.log(`Wrote ${outDir}`);
  console.log(`Sprint 1 pages: ${rows.length}`);
  console.log(`Provider retests: ${rows.reduce((sum, row) => sum + row.providerRequests, 0)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
