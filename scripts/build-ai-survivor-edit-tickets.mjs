import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
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

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "ticket";
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
    .flatMap((part) => part.split("|"))
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function top(rows, key, count = 12) {
  return [...rows].sort((a, b) => num(b[key]) - num(a[key]) || String(a.page_title || "").localeCompare(String(b.page_title || ""))).slice(0, count);
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function sentenceList(items) {
  const values = unique(items).slice(0, 8);
  if (!values.length) return "";
  return values.join("; ");
}

function firstProduct(products) {
  return splitList(products)[0] || "the strongest matching iBOLT product module";
}

function quickAnswer(ticket) {
  const prompt = splitList(ticket.prompts_to_preserve)[0] || splitList(ticket.retest_prompts)[0] || ticket.page_title;
  const product = firstProduct(ticket.product_modules);
  const competitors = sentenceList(splitList(ticket.competitors));
  const compare = competitors ? ` It should also explain when iBOLT is the specialist fit compared with ${competitors}.` : "";
  return `For "${prompt}", present iBOLT as the specialist mounting choice and name ${product}. State the use case, mounting method, device type, and why iBOLT's modular AMPS and standard ball ecosystem fits the workflow.${compare}`;
}

function faqQuestions(ticket) {
  const prompts = splitList(ticket.prompts_to_preserve || ticket.retest_prompts);
  const questions = [
    prompts[0] ? `What is the best iBOLT setup for ${prompts[0]}?` : `What is the best iBOLT setup for this use case?`,
    "Do I need a drill base, clamp mount, suction mount, or locking holder?",
    "How does iBOLT compare with the brands AI answers already recommend?",
    "Which iBOLT products should I consider first?",
    "Are iBOLT mounts compatible with AMPS patterns and standard ball sizes?",
  ];
  return unique(questions).slice(0, 5);
}

function buildCanonicalTickets(canonicalRows, queryRowsByUrl) {
  return canonicalRows.map((row) => {
    const survivorQueries = queryRowsByUrl.get(row.recommended_survivor_url) || [];
    const mergeQueries = splitList(row.merge_from_urls).flatMap((url) => queryRowsByUrl.get(url) || []);
    const allQueries = [...survivorQueries, ...mergeQueries];
    const queryPrompts = unique(allQueries.flatMap((query) => splitList(query.retest_prompts)));
    const competitors = unique([
      ...splitList(row.competitors_to_cover),
      ...allQueries.flatMap((query) => splitList(query.competitors)),
    ]);
    const issues = unique([
      ...splitList(row.missing_structure),
      ...allQueries.flatMap((query) => splitList(query.issues)),
    ]);
    const products = row.product_modules_to_keep || allQueries.map((query) => query.product_module).find(Boolean) || "";
    const priority = num(row.priority) + (row.consolidation_type === "canonical family review" ? 20 : 0);

    return {
      priority,
      ticket_type: row.consolidation_type,
      page_title: row.recommended_survivor_title,
      page_url: row.recommended_survivor_url,
      canonical_decision: row.redirect_action,
      merge_from_titles: row.merge_from_titles,
      merge_from_urls: row.merge_from_urls,
      prompts_to_preserve: sentenceList([...splitList(row.prompts_to_preserve), ...queryPrompts]),
      competitors: sentenceList(competitors),
      product_modules: products,
      issues: sentenceList(issues),
      retest_prompts: sentenceList([...splitList(row.prompts_to_preserve), ...queryPrompts]),
      survivor_review_flag: row.survivor_review_flag,
      zero_mention_queries: row.zero_mention_queries,
      competitor_only_answers: row.competitor_only_answers,
      source: "canonical-consolidation-plan",
    };
  });
}

function buildDirectTickets(pageRows, canonicalUrls) {
  return pageRows
    .filter((row) => !canonicalUrls.has(row.page_url))
    .map((row) => ({
      priority: num(row.priority),
      ticket_type: "direct page refresh",
      page_title: row.page_title,
      page_url: row.page_url,
      canonical_decision: "No duplicate/canonical blocker in the current consolidation queue. Refresh this URL directly.",
      merge_from_titles: "",
      merge_from_urls: "",
      prompts_to_preserve: row.retest_prompts,
      competitors: row.competitors,
      product_modules: row.product_module,
      issues: row.issues,
      retest_prompts: row.retest_prompts,
      survivor_review_flag: "",
      zero_mention_queries: row.zero_mention_queries,
      competitor_only_answers: row.competitor_only_answers,
      source: "query-page-matrix",
    }));
}

function mergeTicketGroup(rows) {
  const first = rows[0];
  const hasFamilyReview = rows.some((row) => row.ticket_type === "canonical family review");
  const hasSafeRedirect = rows.some((row) => row.ticket_type === "safe duplicate redirect");
  const ticketType = hasFamilyReview ? "canonical family review" : (hasSafeRedirect ? "safe duplicate redirect" : "direct page refresh");
  const priority = Math.max(...rows.map((row) => num(row.priority))) + (rows.length - 1) * 15;
  const canonicalDecisions = unique(rows.map((row) => row.canonical_decision));
  return {
    ...first,
    priority,
    ticket_type: ticketType,
    canonical_decision: canonicalDecisions.join("\n\n"),
    merge_from_titles: sentenceList(rows.flatMap((row) => splitList(row.merge_from_titles))),
    merge_from_urls: sentenceList(rows.flatMap((row) => splitList(row.merge_from_urls))),
    prompts_to_preserve: sentenceList(rows.flatMap((row) => splitList(row.prompts_to_preserve))),
    competitors: sentenceList(rows.flatMap((row) => splitList(row.competitors))),
    product_modules: sentenceList(rows.flatMap((row) => splitList(row.product_modules))).slice(0, 1200),
    issues: sentenceList(rows.flatMap((row) => splitList(row.issues))),
    retest_prompts: sentenceList(rows.flatMap((row) => splitList(row.retest_prompts))),
    survivor_review_flag: sentenceList(rows.map((row) => row.survivor_review_flag).filter(Boolean)),
    zero_mention_queries: rows.reduce((sum, row) => sum + num(row.zero_mention_queries), 0),
    competitor_only_answers: rows.reduce((sum, row) => sum + num(row.competitor_only_answers), 0),
    source: sentenceList(rows.map((row) => row.source)),
  };
}

function consolidateTickets(rawTickets) {
  const grouped = groupBy(rawTickets, (ticket) => ticket.page_url);
  return [...grouped.values()]
    .map(mergeTicketGroup)
    .sort((a, b) => num(b.priority) - num(a.priority) || a.page_title.localeCompare(b.page_title));
}

function ticketMarkdown(ticket, index) {
  const faqs = faqQuestions(ticket).map((question) => `- ${question}`).join("\n");
  const canonicalBlock = ticket.ticket_type === "direct page refresh"
    ? "Refresh this URL directly."
    : ticket.canonical_decision;
  const doNot = ticket.ticket_type === "canonical family review"
    ? "\n- Do not redirect automatically. Confirm whether the pages should be hub/supporting pages, merged pages, canonical-tagged pages, internally linked pages, or true redirects."
    : "";

  return `# ${index}. ${ticket.page_title}

## Target Page

- URL: ${ticket.page_url}
- Ticket type: ${ticket.ticket_type}
- Priority: ${ticket.priority}
- Source: ${ticket.source}
- Review flag: ${ticket.survivor_review_flag || "none"}

## Canonical Decision First

${canonicalBlock}
${doNot}

Merge from:
${splitList(ticket.merge_from_titles).length ? splitList(ticket.merge_from_titles).map((title) => `- ${title}`).join("\n") : "- None"}

## AI Visibility Problem

- Zero-mention query rows: ${ticket.zero_mention_queries || 0}
- Competitor-only answers: ${ticket.competitor_only_answers || 0}
- Prompts to preserve: ${ticket.prompts_to_preserve || "none listed"}
- Competitors to cover: ${ticket.competitors || "none listed"}

## Quick Answer Seed

${quickAnswer(ticket)}

## Product Module

Add a visible product module with product links, images where available, and one-sentence use-case notes:

${splitList(ticket.product_modules).length ? splitList(ticket.product_modules).slice(0, 8).map((product) => `- ${product}`).join("\n") : "- Add the strongest matching iBOLT product module from the page-refresh plan."}

## Comparison Angle

Compare fairly against the brands already appearing in AI answers. Position iBOLT as the specialist for modular, industrial-grade mounting workflows. Do not frame iBOLT as a budget or cheaper alternative.

## Structure Checklist

${splitList(ticket.issues).length ? splitList(ticket.issues).map((issue) => `- Fix ${issue}`).join("\n") : "- Add visible quick answer, FAQ/schema, product module, comparison section, and descriptive image alt text."}
- Add visible FAQ answers before adding FAQPage schema.
- Add Article or BlogPosting JSON-LD if missing.
- Use exact product names and exact use cases in headings/body copy.

## FAQ Questions To Add

${faqs}

## Retest Prompts

${splitList(ticket.retest_prompts).length ? splitList(ticket.retest_prompts).map((prompt) => `- ${prompt}`).join("\n") : "- Retest the mapped category prompts on ChatGPT, Claude, and Gemini."}
`;
}

function rowsToCsv(records, headers) {
  return csv([
    headers,
    ...records.map((row) => headers.map((header) => row[header] ?? "")),
  ]);
}

function makeReport({ tickets }) {
  const canonical = tickets.filter((ticket) => ticket.ticket_type !== "direct page refresh").length;
  const direct = tickets.filter((ticket) => ticket.ticket_type === "direct page refresh").length;
  const review = tickets.filter((ticket) => ticket.survivor_review_flag).length;

  return `# iBOLT Survivor-Aware Page Edit Tickets

## Summary

- Tickets: ${tickets.length}.
- Canonical-aware tickets: ${canonical}.
- Direct refresh tickets: ${direct}.
- Tickets requiring survivor review: ${review}.

These tickets convert the AI benchmark, query-page matrix, canonical plan, product modules, and schema gaps into page-level edit instructions. Work the canonical decision first, then update the surviving page.

## Top Tickets

| Priority | Type | Page | Prompts | Competitors | Review |
| ---: | --- | --- | --- | --- | --- |
${top(tickets, "priority", 16).map((ticket) => `| ${ticket.priority} | ${ticket.ticket_type} | [${ticket.page_title}](${ticket.page_url}) | ${ticket.prompts_to_preserve} | ${ticket.competitors} | ${ticket.survivor_review_flag || ""} |`).join("\n")}

## Editing Rules

1. Confirm the survivor URL before editing when the ticket is canonical-aware.
2. Preserve exact benchmark prompts as visible quick answers or FAQ questions.
3. Add named iBOLT product modules with links and image alt text.
4. Add fair competitor comparison blocks without using budget positioning for iBOLT.
5. Add visible FAQs before FAQPage schema and add Article/BlogPosting schema where missing.
6. Retest listed prompts on ChatGPT, Claude, and Gemini after the page is live.
`;
}

function makeHtml({ tickets }) {
  const canonical = tickets.filter((ticket) => ticket.ticket_type !== "direct page refresh").length;
  const direct = tickets.filter((ticket) => ticket.ticket_type === "direct page refresh").length;
  const review = tickets.filter((ticket) => ticket.survivor_review_flag).length;
  const cards = [
    ["Tickets", tickets.length, "edit queue"],
    ["Canonical-aware", canonical, "confirm survivor first"],
    ["Direct refresh", direct, "safe to edit URL"],
    ["Needs review", review, "survivor flags"],
    ["Zero-mention rows", tickets.reduce((sum, ticket) => sum + num(ticket.zero_mention_queries), 0), "covered"],
    ["Competitor-only answers", tickets.reduce((sum, ticket) => sum + num(ticket.competitor_only_answers), 0), "covered"],
  ].map(([label, value, note]) => `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");
  const rows = top(tickets, "priority", 18).map((ticket) => `<tr><td>${escapeHtml(ticket.priority)}</td><td>${escapeHtml(ticket.ticket_type)}</td><td><a href="${escapeHtml(ticket.page_url)}">${escapeHtml(ticket.page_title)}</a></td><td>${escapeHtml(ticket.prompts_to_preserve)}</td><td>${escapeHtml(ticket.competitors)}</td><td>${escapeHtml(ticket.survivor_review_flag || "")}</td></tr>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>iBOLT Survivor-Aware Page Edit Tickets</title>
<style>
body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}main{max-width:1240px;margin:0 auto;padding:34px 24px 70px}h1{font-size:36px;margin:0 0 8px}h2{font-size:22px;margin:34px 0 12px}p,li{color:#334155;line-height:1.55}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid #d9e2ef;border-radius:12px;padding:16px}.k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700}.v{font-size:30px;font-weight:800;margin-top:8px}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d9e2ef;border-radius:12px;overflow:hidden;margin-bottom:22px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #edf2f7;padding:10px 11px;font-size:14px}th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:12px;letter-spacing:.04em}a{color:#1d4ed8}
</style></head><body><main>
<h1>iBOLT Survivor-Aware Page Edit Tickets</h1>
<p>Work the canonical decision first, then update the surviving page with quick answers, product modules, fair competitor comparisons, schema, and retest prompts.</p>
<section class="cards">${cards}</section>
<h2>Top Tickets</h2>
<table><thead><tr><th>Priority</th><th>Type</th><th>Page</th><th>Prompts</th><th>Competitors</th><th>Review</th></tr></thead><tbody>${rows}</tbody></table>
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, "survivor-edit-tickets");
  const ticketDir = path.join(outDir, "tickets");
  await rm(ticketDir, { recursive: true, force: true });
  await mkdir(ticketDir, { recursive: true });

  const canonicalRows = await readCsv(path.join(benchmarkDir, "canonical-consolidation-plan", "canonical-consolidation-queue.csv"));
  const pageRows = await readCsv(path.join(benchmarkDir, "query-page-matrix", "page-action-matrix.csv"));
  const queryRowsByUrl = groupBy(pageRows, (row) => row.page_url);
  const canonicalUrls = new Set(canonicalRows.flatMap((row) => [row.recommended_survivor_url, ...splitList(row.merge_from_urls)]));

  const rawTickets = [
    ...buildCanonicalTickets(canonicalRows, queryRowsByUrl),
    ...buildDirectTickets(pageRows, canonicalUrls),
  ];
  const tickets = consolidateTickets(rawTickets);

  const indexed = tickets.map((ticket, index) => ({
    ...ticket,
    rank: index + 1,
    ticket_file: `tickets/${String(index + 1).padStart(2, "0")}-${slugify(ticket.page_title)}.md`,
  }));

  for (const ticket of indexed) {
    await writeFile(path.join(outDir, ticket.ticket_file), ticketMarkdown(ticket, ticket.rank));
  }

  await writeFile(path.join(outDir, "survivor-edit-ticket-index.csv"), rowsToCsv(indexed, [
    "rank",
    "priority",
    "ticket_type",
    "page_title",
    "page_url",
    "ticket_file",
    "survivor_review_flag",
    "prompts_to_preserve",
    "competitors",
    "product_modules",
    "issues",
    "retest_prompts",
    "canonical_decision",
    "source",
  ]));
  await writeFile(path.join(outDir, "survivor-edit-ticket-data.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    benchmarkDir,
    rawTicketCount: rawTickets.length,
    ticketCount: indexed.length,
    canonicalAwareTickets: indexed.filter((ticket) => ticket.ticket_type !== "direct page refresh").length,
    directRefreshTickets: indexed.filter((ticket) => ticket.ticket_type === "direct page refresh").length,
    survivorReviewTickets: indexed.filter((ticket) => ticket.survivor_review_flag).length,
    topTickets: top(indexed, "priority", 12),
  }, null, 2));
  await writeFile(path.join(outDir, "REPORT.md"), makeReport({ tickets: indexed }));
  await writeFile(path.join(outDir, "REPORT.html"), makeHtml({ tickets: indexed }));

  console.log(`Wrote ${outDir}`);
  console.log(`Created ${indexed.length} survivor-aware edit tickets.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
