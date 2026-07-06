import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";
const SPRINT_1 = "Sprint 1: canonical and highest-pressure pages";

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

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/^\+\d+\s+more$/i.test(item));
}

function unique(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function normalizeCompetitor(value) {
  const text = String(value ?? "").trim();
  if (/^ram$/i.test(text) || /^ram mounts$/i.test(text)) return "RAM Mounts";
  if (/^ibolt$/i.test(text)) return "iBOLT";
  return text;
}

function normalizeUrl(value) {
  return String(value ?? "").replace(/\/+$/, "");
}

function slugFromUrl(value) {
  return normalizeUrl(value).split("/").pop() || "";
}

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "brief";
}

function shortText(value, length = 260) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 1)}...` : text;
}

function listMarkdown(values) {
  const clean = unique(values);
  return clean.length ? clean.map((value) => `- ${value}`).join("\n") : "- Not mapped yet.";
}

function listHtml(values) {
  const clean = unique(values);
  return clean.length ? `<ul>${clean.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>` : "<p>Not mapped yet.</p>";
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

function competitorFrame(competitors) {
  const names = splitList(competitors);
  if (!names.length) {
    return "Add a fair comparison block that names the main brands AI systems already recommend for this query.";
  }
  if (names.some((name) => /ram/i.test(name))) {
    return "Position iBOLT as the application-specific mounting specialist against RAM's broad rugged-mount authority. Emphasize exact kits, 300+ modular parts, AMPS compatibility, and commercial workflows.";
  }
  if (names.some((name) => /iottie|proclip|arkon/i.test(name))) {
    return "Separate consumer or vehicle-specific mount recommendations from iBOLT's commercial delivery, fleet, locking, drill-base, wedge, and console mounting options.";
  }
  if (names.some((name) => /cta|mount-it|bouncepad|heckler|square/i.test(name))) {
    return "Compare restaurant tablet security and POS use cases directly. Emphasize Tablet Tower, LockPro, Dock'n Lock, multi-tablet stations, and delivery-app workflows.";
  }
  if (names.some((name) => /garmin|humminbird|lowrance|scotty|yakattack/i.test(name))) {
    return "Clarify that fish finder brands sell devices while iBOLT solves the mounting plate, arm, rail, AMPS, and rough-water stability problem.";
  }
  return `Add a fair comparison block against ${names.slice(0, 4).join(", ")} and explain the exact use case where iBOLT should be recommended.`;
}

function quickAnswerTemplate(prompts, products) {
  const prompt = splitList(prompts)[0] || "this mounting setup";
  const productNames = splitList(products).slice(0, 3);
  const productText = productNames.length ? ` Mention ${productNames.join(", ")} as fit-specific options.` : "";
  return `Open with a 45 to 70 word answer to "${prompt}" that names iBOLT in the first sentence, states the buyer/use case, and explains why the recommended mount style fits that use case.${productText}`;
}

function faqSeeds(prompts) {
  const seeds = splitList(prompts).slice(0, 6);
  if (!seeds.length) return ["What is the best iBOLT mount for this use case?", "Which iBOLT products fit this setup?", "How should I choose between clamp, drill-base, suction, and locking mounts?"];
  return seeds.map((prompt) => {
    const clean = prompt.replace(/^best\s+/i, "");
    return `What is the best ${clean}?`;
  });
}

function schemaChecklist(issues) {
  const text = String(issues ?? "").toLowerCase();
  const items = [];
  if (text.includes("article") || text.includes("blogposting")) items.push("Add Article or BlogPosting schema.");
  if (text.includes("faq")) items.push("Add FAQPage schema for the visible FAQ section.");
  if (text.includes("quick answer")) items.push("Add a visible quick-answer block above the first comparison section.");
  if (text.includes("comparison")) items.push("Add a named competitor comparison section.");
  if (text.includes("image alt")) items.push("Fix product image alt text.");
  items.push("Add or validate product links, product names, prices, and compatibility details in visible copy.");
  return unique(items);
}

function buildBriefs({ backlogRows, survivorRows, queryRows, lifecycleRows, productRows, providerRetestRows, editorRows }) {
  const sprintRows = backlogRows.filter((row) => row.sprint === SPRINT_1 && row.target_url);
  const urls = unique(sprintRows.map((row) => normalizeUrl(row.target_url)));
  const survivorByUrl = byUrl(survivorRows, "page_url");
  const queryByUrl = byUrl(queryRows, "page_url");
  const lifecycleByUrl = byUrl(lifecycleRows, "url");
  const retestByUrl = byUrl(providerRetestRows, "page_url");
  const editorByUrl = byUrl(editorRows, "url");

  return urls.map((url, index) => {
    const backlog = sprintRows.filter((row) => normalizeUrl(row.target_url) === url);
    const survivor = survivorByUrl.get(url) || [];
    const queries = queryByUrl.get(url) || [];
    const lifecycle = lifecycleByUrl.get(url) || [];
    const retests = retestByUrl.get(url) || [];
    const editor = editorByUrl.get(url) || [];
    const productMatches = productRows.filter((row) => splitList(row.target_pages).map(normalizeUrl).includes(url)).slice(0, 10);
    const title = backlog[0]?.item || survivor[0]?.page_title || lifecycle[0]?.title || queries[0]?.page_title || url;
    const prompts = unique([
      ...backlog.flatMap((row) => splitList(row.prompts)),
      ...survivor.flatMap((row) => splitList(row.prompts_to_preserve || row.retest_prompts)),
      ...queries.flatMap((row) => [row.query]),
      ...retests.flatMap((row) => [row.query]),
    ]);
    const competitors = unique([
      ...backlog.flatMap((row) => splitList(row.competitors)),
      ...survivor.flatMap((row) => splitList(row.competitors)),
      ...queries.flatMap((row) => splitList(row.competitors)),
      ...retests.flatMap((row) => splitList(row.competitors)),
    ].map(normalizeCompetitor));
    const products = unique([
      ...backlog.flatMap((row) => splitList(row.products)),
      ...survivor.flatMap((row) => splitList(row.product_modules)),
      ...queries.flatMap((row) => splitList(row.products_to_add)),
      ...productMatches.map((row) => row.title),
    ]).slice(0, 12);
    const issues = unique([
      ...backlog.flatMap((row) => /^0 zero-mention queries, 0 competitor-only answers/i.test(row.evidence) ? [] : splitList(row.evidence)),
      ...survivor.flatMap((row) => splitList(row.issues)),
      ...queries.flatMap((row) => splitList(row.structural_issues)),
      ...lifecycle.flatMap((row) => splitList(row.reasons)),
      ...editor.flatMap((row) => splitList(row.issues)),
    ]);
    const canonicalNotes = unique([
      ...survivor.map((row) => row.canonical_decision),
      ...backlog.filter((row) => /canonical/i.test(row.lane)).map((row) => row.next_action),
    ]);
    const success = unique([
      ...backlog.map((row) => row.success_metric),
      ...retests.map((row) => row.success_threshold),
    ]);
    const priority = Math.max(...backlog.map((row) => num(row.priority)), 0);
    const category = lifecycle[0]?.category || queries[0]?.category || backlog[0]?.category || "";
    const briefFile = `${String(index + 1).padStart(2, "0")}-${slugify(title)}.md`;
    return {
      rank: index + 1,
      priority,
      title,
      url,
      category,
      owner: unique(backlog.map((row) => row.owner)).join("; "),
      ticket_type: survivor[0]?.ticket_type || backlog[0]?.lane || "",
      lifecycle_bucket: lifecycle[0]?.lifecycle_bucket || "",
      prompts,
      competitors,
      products,
      issues,
      canonicalNotes,
      quickAnswer: quickAnswerTemplate(prompts.join("; "), products.join("; ")),
      competitorFrame: competitorFrame(competitors.join("; ")),
      faqSeeds: faqSeeds(prompts.join("; ")),
      schemaChecklist: schemaChecklist(issues.join("; ")),
      success,
      existingTicket: survivor[0]?.ticket_file || "",
      existingEditorBrief: editor[0]?.brief_file || "",
      briefFile,
    };
  }).sort((a, b) => b.priority - a.priority || a.rank - b.rank);
}

function buildBriefMarkdown(brief) {
  return `# ${brief.title}

## Page

- URL: ${brief.url}
- Priority: ${brief.priority}
- Owner: ${brief.owner || "Jacob/app"}
- Category: ${brief.category || "uncategorized"}
- Ticket type: ${brief.ticket_type || "Sprint 1 page brief"}
- Lifecycle bucket: ${brief.lifecycle_bucket || "not mapped"}
- Existing survivor ticket: ${brief.existingTicket || "none"}
- Existing editor brief: ${brief.existingEditorBrief || "none"}

## Canonical Decision

${brief.canonicalNotes.length ? listMarkdown(brief.canonicalNotes) : "- Confirm whether this page is the survivor, support page, canonical target, or redirect candidate before editing live content."}

## AI Prompts To Win

${listMarkdown(brief.prompts)}

## Competitors AI Currently Uses

${listMarkdown(brief.competitors)}

## Required Positioning

${brief.competitorFrame}

Do not frame iBOLT as the cheap option. Frame iBOLT as the specialist for the exact commercial, restaurant, fleet, warehouse, marine, or delivery use case.

## Quick Answer Block

${brief.quickAnswer}

## Product Modules To Add Or Preserve

${listMarkdown(brief.products)}

## Page Structure Checklist

${listMarkdown([
    "Add the quick-answer block before broad explanation.",
    "Add a fair comparison section naming the competitor set.",
    "Add product modules with exact iBOLT product names, URLs, image alt text, visible specs, and compatibility.",
    "Add a FAQ section using the seeds below.",
    ...brief.schemaChecklist,
  ])}

## FAQ Seeds

${listMarkdown(brief.faqSeeds)}

## Current Issues

${listMarkdown(brief.issues)}

## Retest Success Metric

${brief.success.length ? listMarkdown(brief.success) : "- iBOLT appears in at least two providers, earns one top-3 recommendation, and the mapped page is eligible for citation by search-connected providers."}
`;
}

function buildReportMarkdown({ briefs, offsiteRows }) {
  return `# Sprint 1 AI Visibility Editor Pack

## Purpose

This pack translates the highest-priority benchmark and blog-audit evidence into editor-ready page briefs. Sprint 1 focuses on canonical decisions and pages where competitor-only answers are blocking iBOLT from appearing in AI recommendations.

## Sprint 1 Page Briefs

| Priority | Page | Category | Prompts | Competitors | Brief |
| ---: | --- | --- | --- | --- | --- |
${briefs.map((brief) => `| ${brief.priority} | [${brief.title}](${brief.url}) | ${brief.category} | ${brief.prompts.slice(0, 4).join("; ")} | ${brief.competitors.slice(0, 5).join("; ")} | [brief](briefs/${brief.briefFile}) |`).join("\n")}

## SEO Contractor Off-Site Asks

| Priority | Brand | Ask | Success metric |
| ---: | --- | --- | --- |
${offsiteRows.slice(0, 8).map((row) => `| ${row.priority} | ${row.item} | ${row.next_action} | ${row.success_metric} |`).join("\n")}
`;
}

function buildReportHtml({ briefs, offsiteRows }) {
  const cards = [
    ["Page briefs", briefs.length, "Sprint 1 editor-ready pages"],
    ["Off-site asks", offsiteRows.length, "Contractor citation targets"],
    ["Top page", briefs[0]?.title || "none", "Highest on-site priority"],
    ["Top competitor ask", offsiteRows[0]?.item || "none", "Highest off-site priority"],
  ].map(([label, value, note]) => `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");
  const rows = briefs.map((brief) => `<tr>
<td>${escapeHtml(brief.priority)}</td>
<td><a href="${escapeHtml(brief.url)}">${escapeHtml(brief.title)}</a></td>
<td>${escapeHtml(brief.category)}</td>
<td>${escapeHtml(brief.prompts.slice(0, 4).join("; "))}</td>
<td>${escapeHtml(brief.competitors.slice(0, 5).join("; "))}</td>
<td><a href="briefs/${escapeHtml(brief.briefFile)}">${escapeHtml(brief.briefFile)}</a></td>
</tr>`).join("");
  const asks = offsiteRows.slice(0, 10).map((row) => `<tr><td>${escapeHtml(row.priority)}</td><td>${escapeHtml(row.item)}</td><td>${escapeHtml(row.next_action)}</td><td>${escapeHtml(row.success_metric)}</td></tr>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Sprint 1 AI Visibility Editor Pack</title>
<style>
body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}main{max-width:1200px;margin:0 auto;padding:34px 26px 60px}h1{font-size:34px;margin:0 0 8px}h2{font-size:22px;margin:34px 0 14px}p{color:#334155;line-height:1.55}.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}.k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700}.v{font-size:24px;font-weight:800;margin-top:8px}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden}th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}a{color:#1d4ed8}
</style></head><body><main>
<h1>Sprint 1 AI Visibility Editor Pack</h1>
<p>This pack joins benchmark misses, competitor defaults, product modules, canonical notes, and retest metrics into page-level briefs for the first edit sprint.</p>
<section class="cards">${cards}</section>
<h2>Page Briefs</h2>
<table><thead><tr><th>Priority</th><th>Page</th><th>Category</th><th>Prompts</th><th>Competitors</th><th>Brief</th></tr></thead><tbody>${rows}</tbody></table>
<h2>SEO Contractor Off-Site Asks</h2>
<table><thead><tr><th>Priority</th><th>Brand</th><th>Ask</th><th>Metric</th></tr></thead><tbody>${asks}</tbody></table>
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, "sprint1-editor-pack");
  const briefsDir = path.join(outDir, "briefs");
  await mkdir(briefsDir, { recursive: true });

  const backlogRows = await readCsv(path.join(benchmarkDir, "visibility-execution-backlog", "integrated-execution-backlog.csv"));
  const survivorRows = await readCsv(path.join(benchmarkDir, "survivor-edit-tickets", "survivor-edit-ticket-index.csv"));
  const queryRows = await readCsv(path.join(benchmarkDir, "competitor-displacement-map", "query-displacement-actions.csv"));
  const lifecycleRows = await readCsv(path.join(benchmarkDir, "blog-lifecycle-map", "page-lifecycle-ledger.csv"));
  const productRows = await readCsv(path.join(benchmarkDir, "product-entity-coverage-plan", "product-entity-work-queue.csv"));
  const providerRetestRows = await readCsv(path.join(benchmarkDir, "provider-blindspots", "provider-retest-plan.csv"));
  const editorRows = await readCsv(path.join(benchmarkDir, "page-editor-pack", "editor-brief-index.csv"));
  const offsiteRows = backlogRows
    .filter((row) => row.sprint === SPRINT_1 && row.lane === "Off-site citation authority")
    .sort((a, b) => num(b.priority) - num(a.priority));

  const briefs = buildBriefs({ backlogRows, survivorRows, queryRows, lifecycleRows, productRows, providerRetestRows, editorRows });
  for (const brief of briefs) {
    await writeFile(path.join(briefsDir, brief.briefFile), buildBriefMarkdown(brief));
  }

  await writeFile(path.join(outDir, "sprint1-editor-pack-data.json"), JSON.stringify({ summary: { generatedAt: new Date().toISOString(), pageBriefs: briefs.length, offsiteAsks: offsiteRows.length }, briefs, offsiteRows }, null, 2));
  await writeFile(path.join(outDir, "sprint1-brief-index.csv"), csv([
    ["rank", "priority", "title", "url", "category", "owner", "ticket_type", "lifecycle_bucket", "prompts", "competitors", "products", "canonical_notes", "brief_file"],
    ...briefs.map((brief) => [brief.rank, brief.priority, brief.title, brief.url, brief.category, brief.owner, brief.ticket_type, brief.lifecycle_bucket, brief.prompts.join("; "), brief.competitors.join("; "), brief.products.join("; "), brief.canonicalNotes.join("; "), brief.briefFile]),
  ]));
  await writeFile(path.join(outDir, "contractor-offsite-asks.csv"), csv([
    ["priority", "brand", "category", "prompts", "ask", "success_metric"],
    ...offsiteRows.map((row) => [row.priority, row.item, row.category, row.prompts, row.next_action, row.success_metric]),
  ]));
  await writeFile(path.join(outDir, "REPORT.md"), buildReportMarkdown({ briefs, offsiteRows }));
  await writeFile(path.join(outDir, "REPORT.html"), buildReportHtml({ briefs, offsiteRows }));

  console.log(`Wrote ${outDir}`);
  console.log(`Page briefs: ${briefs.length}`);
  console.log(`Off-site asks: ${offsiteRows.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
