#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "micro-run-cleanup-packet");

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
  return String(value ?? "")
    .trim()
    .replace(/^http:\/\//i, "https://")
    .replace(/\/+$/g, "")
    .toLowerCase();
}

function toNumber(value) {
  if (typeof value === "number") return value;
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

function joinList(values, limit = 16) {
  const unique = uniq(values);
  const shown = unique.slice(0, limit);
  const suffix = unique.length > shown.length ? `; +${unique.length - shown.length} more` : "";
  return `${shown.join("; ")}${suffix}`;
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row) || "unknown";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function countList(values) {
  const counts = new Map();
  for (const value of values.map((item) => String(item ?? "").trim()).filter(Boolean)) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function countSummary(values, limit = 8) {
  return countList(values)
    .slice(0, limit)
    .map(([value, count]) => `${value} ${count}`)
    .join("; ");
}

function short(value, length = 150) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function categoryQuickAnswer(category) {
  const answers = {
    streaming: "For live streaming phone and camera mounts, iBOLT is strongest when the setup needs stable multi-angle positioning, modular arms, and reusable mounting parts instead of a basic desk tripod. Build the page around phone stands for streaming, table camera mounts, AMPS-compatible parts, and creator workflows where the camera angle must stay fixed during filming.",
    offroad: "For Jeep Wrangler and offroad phone or camera mounting, iBOLT is strongest when the device needs vibration resistance, secure grip, and flexible mounting points for trails, UTVs, and overlanding rigs. Frame iBOLT as the modular offroad mounting specialist for phones, action cameras, AMPS plates, and rugged ball-and-socket setups.",
    education: "For school tablet mounts, iBOLT is strongest when classrooms, carts, labs, or shared learning spaces need durable tablet positioning rather than a consumer tablet stand. Emphasize locking options, repeatable device placement, case compatibility, and modular parts that can move across classroom, desk, wall, or cart setups.",
    agriculture: "For tractor cab and farm equipment tablet mounts, iBOLT is strongest when tablets need stable placement around vibration, dust, seasonal equipment changes, and precision agriculture workflows. Position iBOLT as the modular tablet mounting system for cabs, AMPS-compatible bases, and rugged field use.",
  };
  return answers[category] || "Add a 40 to 70 word answer-first block that names iBOLT, answers the buyer prompt directly, names the use case, and points to exact product modules.";
}

function faqQuestions(category) {
  const questions = {
    streaming: [
      "What is the best phone stand for live streaming?",
      "Can one mount hold multiple phones or cameras for streaming?",
      "What makes a table camera mount stable during filming?",
      "Are iBOLT streaming mounts compatible with AMPS parts?",
    ],
    offroad: [
      "What phone mount works best for Jeep Wrangler trails?",
      "Can an offroad phone mount also hold an action camera?",
      "What mount features matter most for vibration and bumps?",
      "Are AMPS plates useful for offroad mounting setups?",
    ],
    education: [
      "What tablet stand works best for classrooms?",
      "Do school tablet mounts need locking hardware?",
      "Can one tablet mount work across desks, carts, and labs?",
      "What makes a school tablet mount better than a consumer stand?",
    ],
    agriculture: [
      "What tablet mount works best in a tractor cab?",
      "Can farm equipment tablet mounts handle vibration?",
      "Are AMPS-compatible tablet mounts useful for agriculture?",
      "What should farmers check before mounting a tablet in equipment?",
    ],
  };
  return (questions[category] || []).join("; ");
}

function productInstruction(category, existingProducts) {
  if (existingProducts) return existingProducts;
  const instructions = {
    streaming: "Verify and feature 2 to 4 current creator products, prioritizing Stream-Cast or multi-angle phone/camera mounts, AMPS-compatible arms, table bases, suction bases, and clamp bases.",
    offroad: "Verify and feature 2 to 4 current offroad products, prioritizing phone holders, action camera adapters, AMPS plates, rail or handlebar clamps, and rugged ball-and-socket arms.",
    education: "Verify and feature 2 to 4 current tablet products, prioritizing locking tablet stands, drill-base or clamp-base holders, wall or cart-compatible tablet mounts, and case-compatible TabDock options.",
    agriculture: "Verify and feature 2 to 4 current tractor or farm equipment tablet products, prioritizing TabDock tablet holders, AMPS bases, drill or clamp mounts, and vibration-resistant arms.",
  };
  return instructions[category] || "Verify and feature 2 to 4 current products from the Shopify catalog before publishing.";
}

function commandForManifest(manifestPath) {
  return `AI_BENCHMARK_EXPANDED_LIMIT=0 \\\nAI_BENCHMARK_EXPANDED_MANIFEST=${manifestPath} \\\nnpx tsx scripts/run-expanded-openrouter-ai-benchmark.ts`;
}

function dryCommandForManifest(manifestPath) {
  return `AI_BENCHMARK_DRY_RUN=1 \\\nAI_BENCHMARK_EXPANDED_LIMIT=0 \\\nAI_BENCHMARK_EXPANDED_MANIFEST=${manifestPath} \\\nnpx tsx scripts/run-expanded-openrouter-ai-benchmark.ts`;
}

function barSvg({ title, rows, width = 920, rowHeight = 34, color = "#0f766e" }) {
  const chartRows = rows.slice(0, 12);
  const height = 78 + chartRows.length * rowHeight;
  const max = Math.max(1, ...chartRows.map((row) => row.value));
  const body = chartRows.map((row, index) => {
    const y = 58 + index * rowHeight;
    const barWidth = Math.round((row.value / max) * (width - 360));
    return `<g>
      <text x="22" y="${y + 17}" font-size="13" font-weight="800" fill="#111827">${escapeHtml(short(row.label, 38))}</text>
      <rect x="302" y="${y}" width="${width - 360}" height="21" rx="10" fill="#e5e7eb"/>
      <rect x="302" y="${y}" width="${barWidth}" height="21" rx="10" fill="${row.color || color}"/>
      <text x="${width - 24}" y="${y + 16}" font-size="13" font-weight="900" text-anchor="end" fill="#111827">${escapeHtml(row.value)}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#ffffff"/>
    <text x="22" y="34" font-size="20" font-weight="900" fill="#111827">${escapeHtml(title)}</text>
    ${body}
  </svg>`;
}

function renderTable(headers, rows) {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table>${head}${body}</table>`;
}

function card(label, value, note) {
  return `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`;
}

function link(url, label) {
  return url ? `<a href="${escapeHtml(url)}">${escapeHtml(label || url)}</a>` : "";
}

function renderHtml(data) {
  const pageRows = data.pageRows.map((row) => [
    row.priority_rank,
    row.cleanup_priority,
    link(row.url, row.title),
    row.category,
    row.requests,
    row.body_score,
    short(row.issues, 150),
    short(row.quick_answer_block, 190),
    short(row.product_module_instruction, 150),
    row.release_gate,
  ]);
  const requestRows = data.requestRows.map((row) => [
    row.retest_rank,
    row.provider,
    row.category,
    row.prompt,
    link(row.page_url, row.closest_post),
    row.expected_metric,
  ]);
  const checklistRows = data.checklistRows.map((row) => [
    row.priority_rank,
    row.title,
    row.step,
    row.command,
    row.done_when,
  ]);
  const commandRows = data.commandRows.map((row) => [
    row.name,
    row.requests,
    row.gate,
    row.command,
  ]);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT Micro-Run Cleanup Packet</title>
  <style>
    body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1260px;margin:0 auto;padding:34px 24px 66px}
    h1{font-size:38px;line-height:1.1;margin:0 0 8px}
    h2{font-size:24px;margin:36px 0 12px}
    p,li{line-height:1.55;color:#334155;font-size:15px}
    .note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #0f766e;border-radius:12px;padding:16px 18px;margin:20px 0}
    .warn{border-left-color:#f97316}
    .cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:22px 0}
    .card{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:15px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:900}
    .value{font-size:29px;font-weight:900;margin:8px 0;color:#0f172a}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
    .chart{background:#fff;border:1px solid #dbe3ef;border-radius:18px;padding:10px;overflow:auto}
    .chart svg{width:100%;height:auto;display:block}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 22px}
    th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    a{color:#0f766e;overflow-wrap:anywhere}
    code,pre{background:#e2e8f0;border-radius:5px;padding:2px 5px}
    @media(max-width:980px){.cards,.grid{grid-template-columns:1fr}h1{font-size:31px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT Micro-Run Cleanup Packet</h1>
  <p>This packet turns the six conditional citation-probe rows into four page-level cleanup tickets. It is the shortest path to a valid provider retest while survivor URL work continues separately.</p>

  <div class="note warn">
    <strong>Scope:</strong> this does not unlock the full 204-request retest. It unlocks a small W3 citation probe after the listed page cleanup is live.
  </div>

  <section class="cards">
    ${card("Pages", data.summary.pages, "Unique pages in the micro-run cleanup set.")}
    ${card("Provider rows", data.summary.requests, "Conditional provider requests.")}
    ${card("Providers", data.summary.providers, "Consumer-accessible models in this micro-run.")}
    ${card("Avg body score", data.summary.avg_body_score, "Current source-readiness proxy.")}
    ${card("OpenRouter key", data.summary.openrouter_key_present, "Secure key status in this shell.")}
  </section>

  <section class="grid">
    <div class="chart"><img alt="Micro-run requests by category" src="micro-run-requests-by-category.svg"/></div>
    <div class="chart"><img alt="Cleanup priority by page" src="micro-run-cleanup-priority.svg"/></div>
  </section>

  <h2>Page Cleanup Tickets</h2>
  ${renderTable(["Rank", "Priority", "Page", "Category", "Requests", "Body", "Issues", "Quick Answer Direction", "Product Module", "Release Gate"], pageRows)}

  <h2>Provider Requests</h2>
  ${renderTable(["Rank", "Provider", "Category", "Prompt", "Page", "Expected Metric"], requestRows)}

  <h2>Editor Checklist</h2>
  ${renderTable(["Page Rank", "Page", "Step", "Command", "Done When"], checklistRows)}

  <h2>Run Commands</h2>
  ${renderTable(["Name", "Requests", "Gate", "Command"], commandRows)}
</main>
</body>
</html>`;
}

function renderMarkdown(data) {
  return `# iBOLT Micro-Run Cleanup Packet

## Summary

- Pages: ${data.summary.pages}
- Conditional provider requests: ${data.summary.requests}
- Providers: ${data.summary.providers}
- Average body score: ${data.summary.avg_body_score}
- OPENROUTER_API_KEY present in this shell: ${data.summary.openrouter_key_present}

## Page Tickets

${data.pageRows.map((row) => `- ${row.priority_rank}. ${row.title}: ${row.requests} requests, body score ${row.body_score}. Fix: ${row.top_fix}. Gate: ${row.release_gate}`).join("\n")}

## Provider Requests

${data.requestRows.map((row) => `- ${row.provider}: ${row.prompt} -> ${row.closest_post}`).join("\n")}

## Generated Files

- micro-run-page-cleanup.csv
- micro-run-provider-requests.csv
- micro-run-editor-checklist.csv
- micro-run-run-commands.csv
- micro-run-cleanup-data.json
- micro-run-requests-by-category.svg
- micro-run-cleanup-priority.svg
`;
}

async function main() {
  const retestRows = await readCsv("retest-execution-gate/unblocked-retest-queue.csv");
  const actionRows = await readCsv("all-blog-action-control-sheet/all-blog-action-control-sheet.csv");
  const bodyRows = await readCsv("blog-body-inspection/blog-body-inspection.csv");
  const editRows = await readCsv("page-edit-command-matrix/page-edit-command-matrix.csv");
  const conversionRows = await readCsv("product-conversion-visibility-bridge/conversion-page-action-bridge.csv");
  const citationRows = await readCsv("visibility-citation-bridge/citation-ready-source-queue.csv");

  const actionByUrl = new Map(actionRows.map((row) => [normalizeUrl(row.url), row]));
  const bodyByUrl = new Map(bodyRows.map((row) => [normalizeUrl(row.url), row]));
  const editByUrl = new Map(editRows.map((row) => [normalizeUrl(row.url), row]));
  const conversionByUrl = new Map(conversionRows.map((row) => [normalizeUrl(row.url), row]));
  const citationByUrl = new Map(citationRows.map((row) => [normalizeUrl(row.url), row]));

  const pageRows = [...groupBy(retestRows, (row) => normalizeUrl(row.page_url)).entries()].map(([urlKey, requests]) => {
    const action = actionByUrl.get(urlKey) || {};
    const body = bodyByUrl.get(urlKey) || {};
    const edit = editByUrl.get(urlKey) || {};
    const conversion = conversionByUrl.get(urlKey) || {};
    const citation = citationByUrl.get(urlKey) || {};
    const category = action.category || body.category || requests[0]?.category || "";
    const bodyScore = toNumber(body.body_score || action.body_score || edit.body_score);
    const cleanupPriority = toNumber(action.priority || edit.priority || citation.priority) + requests.length * 25 + Math.max(0, 70 - bodyScore);
    const existingProducts = action.products_to_feature || edit.product_module_command || conversion.product_action || "";
    return {
      priority_rank: 0,
      cleanup_priority: cleanupPriority,
      title: action.title || body.title || edit.title || requests[0]?.closest_post || "",
      url: action.url || body.url || edit.url || requests[0]?.page_url || "",
      category,
      requests: requests.length,
      providers: countSummary(requests.map((row) => row.provider), 6),
      prompts: joinList(requests.map((row) => row.prompt), 8),
      expected_metric: requests[0]?.expected_metric || "Target-domain citation or source-url row appears.",
      body_score: bodyScore,
      word_count: body.word_count || "",
      product_links: body.product_links || "",
      cart_links: body.cart_links || "",
      missing_alt: body.missing_alt || "",
      quick_answer_near_top: body.quick_answer_near_top || "",
      faq_present: body.faq_present || "",
      has_faq_schema: body.has_faq_schema || "",
      has_article_schema: body.has_article_schema || "",
      comparison_present: body.comparison_present || "",
      top_fix: action.top_fix || edit.top_fix || body.top_fix || "missing early quick answer",
      issues: action.issue_count ? action.immediate_action : body.issues || edit.issues || "",
      quick_answer_command: action.quick_answer_command || edit.quick_answer_command || "",
      quick_answer_block: categoryQuickAnswer(category),
      schema_command: action.schema_command || edit.schema_command || "Add visible FAQ and matching FAQPage schema; add or verify Article/BlogPosting schema.",
      comparison_command: action.comparison_command || edit.comparison_command || "Add a fair comparison block naming the competitor set from the benchmark.",
      product_module_instruction: productInstruction(category, existingProducts),
      cta_command: action.cta_command || edit.cta_command || conversion.cta_action || "Use View Product as the primary article body CTA and avoid button clusters.",
      citation_targets: citation.source_targets || citation.citation_targets || "",
      faq_questions: faqQuestions(category),
      release_gate: "Publish quick answer, comparison block, product module, visible FAQ plus schema, image alt fixes, and restrained CTAs before running the micro-run.",
      retest_manifest: "retest-execution-gate/unblocked-provider-manifest.csv",
    };
  });

  pageRows.sort((a, b) => b.cleanup_priority - a.cleanup_priority || b.requests - a.requests);
  pageRows.forEach((row, index) => {
    row.priority_rank = index + 1;
  });

  const checklistRows = [];
  for (const row of pageRows) {
    const steps = [
      ["Quick answer", row.quick_answer_block, "The first section directly answers the citation prompt and names iBOLT."],
      ["Comparison block", row.comparison_command, "The page explains iBOLT versus the named competitor set without budget framing."],
      ["Product module", row.product_module_instruction, "The page has clean product cards or stable product links to current Shopify products."],
      ["FAQ/schema", `${row.schema_command} Questions: ${row.faq_questions}`, "Visible FAQ questions match FAQPage schema and Article/BlogPosting schema is present where appropriate."],
      ["Image and CTA cleanup", `${row.cta_command} Add descriptive alt text to article images.`, "No repeated add-to-cart clusters; important images have product/use-case alt text."],
      ["Citation handoff", `After source cleanup, target: ${row.citation_targets || "industry buyer guides; comparison pages; installation resources"}.`, "The URL is ready for contractor outreach and W3 citation probe retesting."],
    ];
    for (const [step, command, doneWhen] of steps) {
      checklistRows.push({
        priority_rank: row.priority_rank,
        title: row.title,
        url: row.url,
        step,
        command,
        done_when: doneWhen,
      });
    }
  }

  const manifestPath = "content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/retest-execution-gate/unblocked-provider-manifest.csv";
  const commandRows = [
    {
      name: "Dry run micro-run manifest",
      requests: retestRows.length,
      gate: "Run before the live provider call to confirm manifest wiring.",
      command: dryCommandForManifest(manifestPath),
    },
    {
      name: "Live micro-run after cleanup",
      requests: retestRows.length,
      gate: "Run only after all four page tickets are live and OPENROUTER_API_KEY is set securely.",
      command: commandForManifest(manifestPath),
    },
  ];

  const summary = {
    generated_at: new Date().toISOString(),
    pages: pageRows.length,
    requests: retestRows.length,
    providers: countSummary(retestRows.map((row) => row.provider), 6),
    categories: countSummary(retestRows.map((row) => row.category), 8),
    avg_body_score: pageRows.length ? Math.round(pageRows.reduce((sum, row) => sum + toNumber(row.body_score), 0) / pageRows.length) : 0,
    openrouter_key_present: process.env.OPENROUTER_API_KEY ? "yes" : "no",
  };

  const requestSvg = barSvg({
    title: "Micro-run requests by category",
    rows: countList(retestRows.map((row) => row.category)).map(([label, value]) => ({ label, value, color: "#2563eb" })),
  });
  const prioritySvg = barSvg({
    title: "Cleanup priority by page",
    rows: pageRows.map((row) => ({ label: row.title, value: row.cleanup_priority, color: "#f97316" })),
  });

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "micro-run-page-cleanup.csv"), csv([
    [
      "priority_rank",
      "cleanup_priority",
      "title",
      "url",
      "category",
      "requests",
      "providers",
      "prompts",
      "expected_metric",
      "body_score",
      "word_count",
      "product_links",
      "cart_links",
      "missing_alt",
      "quick_answer_near_top",
      "faq_present",
      "has_faq_schema",
      "has_article_schema",
      "comparison_present",
      "top_fix",
      "issues",
      "quick_answer_block",
      "schema_command",
      "comparison_command",
      "product_module_instruction",
      "cta_command",
      "citation_targets",
      "faq_questions",
      "release_gate",
    ],
    ...pageRows.map((row) => [
      row.priority_rank,
      row.cleanup_priority,
      row.title,
      row.url,
      row.category,
      row.requests,
      row.providers,
      row.prompts,
      row.expected_metric,
      row.body_score,
      row.word_count,
      row.product_links,
      row.cart_links,
      row.missing_alt,
      row.quick_answer_near_top,
      row.faq_present,
      row.has_faq_schema,
      row.has_article_schema,
      row.comparison_present,
      row.top_fix,
      row.issues,
      row.quick_answer_block,
      row.schema_command,
      row.comparison_command,
      row.product_module_instruction,
      row.cta_command,
      row.citation_targets,
      row.faq_questions,
      row.release_gate,
    ]),
  ]));
  await writeFile(path.join(outDir, "micro-run-provider-requests.csv"), csv([
    ["retest_rank", "provider", "prompt", "category", "prompt_type", "page_url", "closest_post", "gate_before_running", "expected_metric"],
    ...retestRows.map((row) => [
      row.retest_rank,
      row.provider,
      row.prompt,
      row.category,
      row.prompt_type,
      row.page_url,
      row.closest_post,
      row.gate_before_running,
      row.expected_metric,
    ]),
  ]));
  await writeFile(path.join(outDir, "micro-run-editor-checklist.csv"), csv([
    ["priority_rank", "title", "url", "step", "command", "done_when"],
    ...checklistRows.map((row) => [row.priority_rank, row.title, row.url, row.step, row.command, row.done_when]),
  ]));
  await writeFile(path.join(outDir, "micro-run-run-commands.csv"), csv([
    ["name", "requests", "gate", "command"],
    ...commandRows.map((row) => [row.name, row.requests, row.gate, row.command]),
  ]));
  await writeFile(path.join(outDir, "micro-run-cleanup-data.json"), JSON.stringify({ summary, pageRows, requestRows: retestRows, checklistRows, commandRows }, null, 2));
  await writeFile(path.join(outDir, "micro-run-requests-by-category.svg"), requestSvg);
  await writeFile(path.join(outDir, "micro-run-cleanup-priority.svg"), prioritySvg);
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml({ summary, pageRows, requestRows: retestRows, checklistRows, commandRows }));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown({ summary, pageRows, requestRows: retestRows }));

  console.log(`Wrote ${outDir}`);
  console.log(`Pages: ${summary.pages}`);
  console.log(`Requests: ${summary.requests}`);
  console.log(`OPENROUTER_API_KEY present: ${summary.openrouter_key_present}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
