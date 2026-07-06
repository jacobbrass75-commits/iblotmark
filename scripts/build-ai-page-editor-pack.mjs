import { mkdir, readdir, writeFile, readFile } from "node:fs/promises";
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
  const match = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  if (!match) throw new Error(`No ${prefix} directory found in ${OUTPUT_ROOT}`);
  return path.join(process.cwd(), OUTPUT_ROOT, match);
}

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 86);
}

function num(value) {
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitFaqs(value) {
  return String(value ?? "")
    .split(/\s+\|\s+|;/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanQuestion(question) {
  return String(question ?? "")
    .replace(/best iBOLT option for best /i, "best iBOLT option for ")
    .replace(/best iBOLT option for /i, "best iBOLT product for ")
    .replace(/best iBOLT product for (?:phone|tablet|barcode scanner|fish finder) mount for /i, "best iBOLT product for ")
    .replace(/\s+/g, " ")
    .trim();
}

function topCounts(values, limit = 8) {
  const counts = new Map();
  for (const value of values.flatMap(splitList)) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

function inferPrimaryPrompt(row) {
  return splitList(row.query_prompts)[0] || row.page_title || "target prompt";
}

function makeFaqAnswer(question, row) {
  const products = splitList(row.products_to_add).slice(0, 2);
  const competitors = splitList(row.competitors).slice(0, 3);
  if (/compare/i.test(question)) {
    return `Position iBOLT as the specialist for the exact workflow, then compare fairly against ${competitors.join(", ") || "the common alternatives"}. Mention modular AMPS compatibility, commercial durability, and when a locking, clamp, suction, drill-base, or wall mount makes the most sense.`;
  }
  if (/best iBOLT option/i.test(question)) {
    return `Lead with ${products.join(" and ") || "the most relevant iBOLT products"} for this use case. State the device type, mounting location, mounting method, and why that setup is a fit.`;
  }
  if (/drill base|clamp|suction|wall/i.test(question)) {
    return "Explain the mounting method decision in practical terms: drill bases for permanent high-vibration installs, clamps for poles or rails, suction for temporary smooth surfaces, wall mounts for fixed stations, and locking holders for shared or public devices.";
  }
  if (/compatible|AMPS|ball/i.test(question)) {
    return "State that iBOLT uses common AMPS patterns and industry-standard ball sizes where applicable, then name the relevant sizes or adapter family for the page.";
  }
  return "Answer in two concise sentences. Use one exact iBOLT product name and one concrete setup detail so the answer can stand alone in AI search results.";
}

function editScore(row) {
  const issues = splitList(row.issues);
  return num(row.priority) +
    Math.max(0, 25 - num(row.benchmark_avg_score)) +
    issues.length * 8 +
    (row.duplicate_risk === "yes" ? 20 : 0) +
    Math.max(0, 85 - num(row.page_score));
}

function relatedContentGaps(row, gapRows) {
  return gapRows
    .filter((gap) => gap.category === row.category || splitList(gap.prompts).some((prompt) => splitList(row.query_prompts).some((query) => prompt.toLowerCase().includes(query.toLowerCase()))))
    .sort((a, b) => num(b.priority) - num(a.priority))
    .slice(0, 3);
}

function makeBriefMarkdown(row, gapRows) {
  const score = editScore(row);
  const prompt = inferPrimaryPrompt(row);
  const products = splitList(row.products_to_add);
  const productModule = splitList(row.product_module).filter((item) => !/^\+\d+\s+more$/i.test(item));
  const faqs = splitFaqs(row.faq_seeds).map(cleanQuestion);
  const schema = splitList(row.schema_fixes);
  const competitors = splitList(row.competitors);
  const relatedGaps = relatedContentGaps(row, gapRows);

  return `# ${row.page_title}

## Edit Snapshot

- Priority score: ${score}
- URL: ${row.page_url}
- Shopify article ID: ${row.shopify_article_id || "unknown"}
- Category: ${row.category}
- Duplicate risk: ${row.duplicate_risk}
- Benchmark average score: ${row.benchmark_avg_score}
- Page citability score: ${row.page_score}/100
- Current product links: ${row.current_product_links}
- Weakest providers: ${row.weakest_providers}

## Do First

${row.duplicate_risk === "yes" ? "- Review canonical duplicates before rewriting. If another page targets the same intent, merge the best sections into the canonical page and redirect or de-prioritize the duplicate.\n" : ""}- Add a visible quick-answer block near the top of the post.
- Add or expand a fair competitor comparison section.
- Add FAQPage JSON-LD only if the FAQ answers are visible on the page.
- Add Article or BlogPosting JSON-LD if missing in the live audit.
- Add descriptive alt text for product and context images.

## Quick Answer Block

Use this as the first answer-oriented paragraph, then polish for the page:

> ${row.quick_answer_seed}

## Competitor Framing

Competitors/adjacent brands seen in AI answers: ${competitors.join(", ") || "none detected"}.

${row.competitor_angle}

Suggested section heading:

## How iBOLT Compares With ${competitors.slice(0, 3).join(", ") || "Common Alternatives"}

Keep this fair. Do not claim iBOLT is always better. State where iBOLT is the better fit: commercial workflows, modular AMPS/ball compatibility, locking/security, shared vehicles, delivery operations, restaurant tablet stations, warehouse/forklift installs, or exact device mounting.

## Product Module

Add these products as a visible module with product links, product images where available, and one-sentence use-case notes.

${products.map((product) => `- ${product}`).join("\n") || "- Add the most relevant iBOLT product module from the catalog."}

Short module version:

${productModule.map((product) => `- ${product}`).join("\n") || "- No short product module listed."}

## FAQ Block

${faqs.map((question) => `### ${question}\n\n${makeFaqAnswer(question, row)}`).join("\n\n") || "Add 4 to 6 visible FAQs that match the benchmark prompts and product questions."}

## Schema Checklist

${schema.map((item) => `- ${item}`).join("\n") || "- Validate Article or BlogPosting schema and FAQPage schema."}

## Benchmark Prompts To Retest

${splitList(row.query_prompts).map((item) => `- ${item}`).join("\n") || `- ${prompt}`}

Prompt evidence:

${splitList(row.prompt_evidence).map((item) => `- ${item}`).join("\n") || "- No prompt evidence provided."}

Retest instruction: ${row.retest_action}

## Related Future Content Gaps

Do not necessarily create these before the page refresh. Use them as internal-link targets or later hubs.

${relatedGaps.map((gap) => `- ${gap.title}: ${gap.action}`).join("\n") || "- No directly related future gap brief found."}
`;
}

function makeReportMarkdown({ briefs, issueCounts, competitorCounts, categoryCounts, benchmarkDir }) {
  return `# AI Page Editor Pack

This turns the AI visibility analysis into page-level editing briefs. It is meant for the next content pass, not for publishing automatically.

## Summary

- Editor briefs generated: ${briefs.length}
- Duplicate-risk briefs: ${briefs.filter((brief) => brief.duplicateRisk === "yes").length}
- Top issue types: ${issueCounts.map(([name, count]) => `${name} (${count})`).join(", ")}
- Top competitors to address: ${competitorCounts.map(([name, count]) => `${name} (${count})`).join(", ")}
- Categories represented: ${categoryCounts.map(([name, count]) => `${name} (${count})`).join(", ")}

## Edit Queue

| Score | Page | Category | Duplicate risk | Issues | Competitors | Brief |
| ---: | --- | --- | --- | --- | --- | --- |
${briefs.map((brief) => `| ${brief.score} | [${brief.title}](${brief.url}) | ${brief.category} | ${brief.duplicateRisk} | ${brief.issues} | ${brief.competitors} | [brief](briefs/${brief.fileName}) |`).join("\n")}

## How To Use

1. Start with duplicate-risk pages. Decide canonical page before rewriting.
2. Add visible quick-answer blocks and FAQ content before adding schema.
3. Put competitor names naturally in comparison sections so AI sees iBOLT in the same consideration set.
4. Add exact product titles, images, product URLs, and use-case notes.
5. Retest only the prompts listed in each brief after the edit is live.

Source benchmark folder: ${benchmarkDir}
`;
}

function makeReportHtml({ briefs, issueCounts, competitorCounts, categoryCounts }) {
  const cards = [
    ["Briefs", briefs.length],
    ["Duplicate risk", briefs.filter((brief) => brief.duplicateRisk === "yes").length],
    ["Issue types", issueCounts.length],
    ["Competitors", competitorCounts.length],
  ].map(([label, value]) => `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div></div>`).join("");

  const rows = briefs.map((brief) => `<tr><td>${brief.score}</td><td><a href="${escapeHtml(brief.url)}">${escapeHtml(brief.title)}</a></td><td>${escapeHtml(brief.category)}</td><td>${escapeHtml(brief.duplicateRisk)}</td><td>${escapeHtml(brief.issues)}</td><td>${escapeHtml(brief.competitors)}</td><td><a href="briefs/${escapeHtml(brief.fileName)}">brief</a></td></tr>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>iBOLT AI Page Editor Pack</title>
<style>
body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}main{max-width:1220px;margin:0 auto;padding:34px 24px 70px}h1{font-size:34px;margin:0 0 8px}h2{font-size:22px;margin:30px 0 12px}p{color:#334155;line-height:1.55}.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:20px 0}.card{background:#fff;border:1px solid #d9e2ef;border-radius:12px;padding:16px}.k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700}.v{font-size:30px;font-weight:800;margin-top:8px}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d9e2ef;border-radius:12px;overflow:hidden}th,td{padding:10px 11px;border-bottom:1px solid #edf2f7;text-align:left;vertical-align:top;font-size:14px}th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:12px;letter-spacing:.04em}a{color:#1d4ed8}.chips{display:flex;flex-wrap:wrap;gap:8px}.chip{background:#e0f2fe;border:1px solid #bae6fd;border-radius:999px;padding:6px 10px;font-size:13px}
</style></head><body><main>
<h1>iBOLT AI Page Editor Pack</h1>
<p>Page-level briefs for improving AI mentions, competitor adjacency, citation readiness, and product entity strength.</p>
<section class="cards">${cards}</section>
<h2>Top Issues</h2><div class="chips">${issueCounts.map(([name, count]) => `<span class="chip">${escapeHtml(name)}: ${count}</span>`).join("")}</div>
<h2>Top Competitors To Address</h2><div class="chips">${competitorCounts.map(([name, count]) => `<span class="chip">${escapeHtml(name)}: ${count}</span>`).join("")}</div>
<h2>Categories</h2><div class="chips">${categoryCounts.map(([name, count]) => `<span class="chip">${escapeHtml(name)}: ${count}</span>`).join("")}</div>
<h2>Edit Queue</h2>
<table><thead><tr><th>Score</th><th>Page</th><th>Category</th><th>Duplicate</th><th>Issues</th><th>Competitors</th><th>Brief</th></tr></thead><tbody>${rows}</tbody></table>
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, "page-editor-pack");
  const briefDir = path.join(outDir, "briefs");
  await mkdir(briefDir, { recursive: true });

  const pageRows = await readCsv(path.join(benchmarkDir, "page-refresh-playbook", "page-refresh-briefs.csv"));
  const gapRows = await readCsv(path.join(benchmarkDir, "content-gap-briefs", "content-gap-briefs.csv"));
  const sortedRows = pageRows
    .map((row) => ({ ...row, score: editScore(row) }))
    .sort((a, b) => b.score - a.score);

  const briefs = [];
  for (const row of sortedRows) {
    const fileName = `${String(row.rank || briefs.length + 1).padStart(2, "0")}-${slugify(row.page_title)}.md`;
    await writeFile(path.join(briefDir, fileName), makeBriefMarkdown(row, gapRows));
    briefs.push({
      score: row.score,
      title: row.page_title,
      url: row.page_url,
      category: row.category,
      duplicateRisk: row.duplicate_risk,
      issues: row.issues,
      competitors: row.competitors,
      fileName,
    });
  }

  const issueCounts = topCounts(sortedRows.map((row) => row.issues), 10);
  const competitorCounts = topCounts(sortedRows.map((row) => row.competitors), 12);
  const categoryCounts = topCounts(sortedRows.map((row) => row.category), 12);

  await writeFile(path.join(outDir, "editor-brief-index.csv"), csv([
    ["score", "title", "url", "category", "duplicate_risk", "issues", "competitors", "brief_file"],
    ...briefs.map((brief) => [brief.score, brief.title, brief.url, brief.category, brief.duplicateRisk, brief.issues, brief.competitors, `briefs/${brief.fileName}`]),
  ]));
  await writeFile(path.join(outDir, "REPORT.md"), makeReportMarkdown({ briefs, issueCounts, competitorCounts, categoryCounts, benchmarkDir }));
  await writeFile(path.join(outDir, "REPORT.html"), makeReportHtml({ briefs, issueCounts, competitorCounts, categoryCounts }));

  console.log(`Wrote ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
