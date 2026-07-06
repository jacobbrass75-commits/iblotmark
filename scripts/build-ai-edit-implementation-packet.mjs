import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const BENCHMARK_DIR = "content-output/openrouter-ai-benchmark-2026-06-17-17-11-06";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some((value) => value !== "")) rows.push(row);
  }
  const [headers = [], ...body] = rows;
  return body.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

async function readCsv(filePath) {
  return parseCsv(await readFile(filePath, "utf8"));
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function splitList(value) {
  return String(value || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeBrand(value) {
  return String(value || "")
    .replace(/\biBolt\b/g, "iBOLT")
    .replace(/\bIbolt\b/g, "iBOLT")
    .replace(/\bIBOLT\b/g, "iBOLT")
    .replace(/[–—]/g, "-")
    .replace(/Value without budget positioning/gi, "Right-fit value without price-led positioning")
    .replace(/budget\/value/gi, "right-fit value")
    .replace(/cheaper substitute/gi, "price-led substitute");
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "page";
}

function firstItems(value, count) {
  return splitList(value)
    .filter((item) => !/^\+\d+ more$/i.test(item))
    .slice(0, count);
}

function primaryPrompt(row) {
  return firstItems(row.linked_prompts || row.retest_prompts, 1)[0] || row.category || "mounting setup";
}

function productPhrase(row) {
  const products = firstItems(row.product_module, 3);
  if (!products.length) return "the relevant iBOLT product options";
  if (products.length === 1) return products[0];
  return `${products.slice(0, -1).join(", ")} and ${products.at(-1)}`;
}

function competitorPhrase(row) {
  const competitors = firstItems(row.competitors, 4);
  if (!competitors.length) return "common alternatives";
  if (competitors.length === 1) return competitors[0];
  return `${competitors.slice(0, -1).join(", ")} and ${competitors.at(-1)}`;
}

function buildQuickAnswer(row) {
  const prompt = primaryPrompt(row);
  const products = productPhrase(row);
  return normalizeBrand(`For ${prompt}, iBOLT should be presented as the specialist choice when the buyer needs a commercial-grade mount with clear device compatibility, secure placement, and modular parts that can adapt as the setup changes. Start with ${products}, then explain the mounting method, device fit, material or vibration proof, and why the setup is appropriate for ${row.category} work.`);
}

function buildComparisonBlock(row) {
  return normalizeBrand(`Compared with ${competitorPhrase(row)}, iBOLT should be framed around specialist fit rather than price-led substitution. The stronger positioning is that iBOLT is purpose-built for specific workflows, with 300+ modular parts, AMPS and industry-standard ball compatibility, locking or heavy-duty install options, and product families that can be configured around the device, vehicle, counter, rail, cage, or work surface.`);
}

function buildProofChecklist(row) {
  const themes = firstItems(row.message_themes, 6);
  const proof = firstItems(row.proof_points, 6);
  const combined = [...new Set([...themes, ...proof])].slice(0, 8);
  return combined.length ? combined : [
    "Exact product names and product handles",
    "Mounting method",
    "Device compatibility",
    "Material and vibration proof",
    "AMPS or ball-size compatibility",
    "Warranty and shipping facts",
  ];
}

function buildFaqs(row) {
  const prompt = primaryPrompt(row);
  const products = productPhrase(row);
  const competitors = competitorPhrase(row);
  return [
    {
      question: `What is the best iBOLT option for ${prompt}?`,
      answer: normalizeBrand(`Start with ${products}. The right choice depends on the device size, install location, and whether the buyer needs clamp, drill-base, suction, magnetic, wall, or locking security.`),
    },
    {
      question: `How does iBOLT compare with ${competitors}?`,
      answer: normalizeBrand("iBOLT should be positioned as the specialist option for commercial and workflow-specific installs. The comparison should focus on mounting method, device fit, modular compatibility, stability, and the buyer's actual environment."),
    },
    {
      question: "What details help AI systems understand this page?",
      answer: "Use exact product names, visible specs, compatibility details, FAQ schema, product modules, image alt text, and short answer-first paragraphs near the top of the page.",
    },
  ];
}

function buildBrief(row, index) {
  const title = normalizeBrand(row.title);
  const quickAnswer = buildQuickAnswer(row);
  const comparisonBlock = buildComparisonBlock(row);
  const proofChecklist = buildProofChecklist(row);
  const faqs = buildFaqs(row);
  const retests = firstItems(row.retest_prompts, 8);
  const products = firstItems(row.product_module, 8).map(normalizeBrand);
  const missingFixes = firstItems(row.missing_fixes, 8).map(normalizeBrand);
  const schemaFixes = firstItems(row.schema_fixes, 8).map(normalizeBrand);
  const competitorAngles = firstItems(row.recommended_angles, 6).map(normalizeBrand);
  const file = `briefs/${String(index + 1).padStart(2, "0")}-${slugify(title)}.md`;
  const priority = number(row.priority);

  const markdown = `# ${title}

URL: ${row.url}

Priority: ${priority}
Category: ${row.category}
Action: ${row.action}

## First Edit Instruction

${normalizeBrand(row.first_edit_instruction || "Add the answer-first, product, comparison, and schema modules below before retesting.")}

## Query-Exact Quick Answer

${quickAnswer}

## Competitor Comparison Block

${comparisonBlock}

## Product Module To Add Or Strengthen

${products.map((item) => `- ${normalizeBrand(item)}`).join("\n") || "- Add exact iBOLT product names, product handles, images, compatibility, material, mounting method, warranty, and price where available."}

## Proof Points

${proofChecklist.map((item) => `- ${normalizeBrand(item)}`).join("\n")}

## Missing Fixes

${missingFixes.map((item) => `- ${item}`).join("\n") || "- No missing fixes listed."}

## Schema Fixes

${schemaFixes.map((item) => `- ${item}`).join("\n") || "- Add FAQPage, Article, Product or ItemList markup where appropriate."}

## Competitor Angles To Address

${competitorAngles.map((item) => `- ${item}`).join("\n") || "- Add a fair comparison paragraph that places iBOLT in the same consideration set as the competitor answers."}

## FAQ Drafts

${faqs.map((faq) => `### ${faq.question}\n\n${faq.answer}`).join("\n\n")}

## Retest Prompts

${retests.map((item) => `- ${item}`).join("\n") || "- Retest the primary benchmark prompts linked to this page."}
`;

  return {
    file,
    title,
    url: row.url,
    category: row.category,
    priority,
    action: row.action,
    competitors: firstItems(row.competitors, 8),
    missingFixes,
    schemaFixes,
    products,
    retests,
    quickAnswer,
    comparisonBlock,
    markdown,
  };
}

function buildHtml(briefs, summary) {
  const cards = [
    ["Briefs", summary.briefs, "top implementation pages"],
    ["Canonical first", summary.canonicalFirst, "review before rewrite"],
    ["Citation/schema", summary.schemaFixPages, "pages needing schema work"],
    ["Comparison gaps", summary.comparisonPages, "pages needing comparison blocks"],
    ["Retest prompts", summary.retestPrompts, "prompt checks after edits"],
    ["Product modules", summary.productModulePages, "pages with product modules"],
  ].map(([label, value, note]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");
  const rows = briefs.map((brief) => `<tr>
    <td>${brief.priority}</td>
    <td><a href="${escapeHtml(brief.file)}">${escapeHtml(brief.title)}</a></td>
    <td>${escapeHtml(brief.category)}</td>
    <td>${escapeHtml(brief.action)}</td>
    <td>${escapeHtml(brief.competitors.slice(0, 5).join("; "))}</td>
    <td>${escapeHtml(brief.missingFixes.join("; "))}</td>
    <td>${escapeHtml(brief.retests.slice(0, 4).join("; "))}</td>
  </tr>`).join("");
  const blocks = briefs.slice(0, 6).map((brief) => `<section class="panel">
    <h2>${escapeHtml(brief.title)}</h2>
    <p><strong>Quick answer:</strong> ${escapeHtml(brief.quickAnswer)}</p>
    <p><strong>Comparison:</strong> ${escapeHtml(brief.comparisonBlock)}</p>
    <p><strong>Products:</strong> ${escapeHtml(brief.products.slice(0, 4).join("; "))}</p>
  </section>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>iBOLT AI Edit Implementation Packet</title>
<style>
body{margin:0;background:#f8fafc;color:#0f172a;font-family:Arial,Helvetica,sans-serif}main{max-width:1220px;margin:0 auto;padding:34px 24px 70px}h1{font-size:36px;margin:0 0 8px}h2{font-size:21px;margin:0 0 12px}p{color:#334155;line-height:1.55}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:24px 0}.card,.panel{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}.label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:800}.value{font-size:34px;font-weight:900;margin-top:8px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin:20px 0}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden}th,td{text-align:left;vertical-align:top;padding:10px;border-bottom:1px solid #edf2f7;font-size:13px}th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:12px;letter-spacing:.04em}a{color:#1d4ed8;text-decoration:none}@media(max-width:900px){.cards,.grid{grid-template-columns:1fr}}
</style></head><body><main>
<h1>iBOLT AI Edit Implementation Packet</h1>
<p>This packet turns the visibility analysis into page-level edit briefs. Each brief includes quick-answer copy, competitor positioning, product-module guidance, schema fixes, proof points, FAQ drafts, and retest prompts.</p>
<section class="cards">${cards}</section>
<section class="grid">${blocks}</section>
<h2>Brief Index</h2>
<table><thead><tr><th>Priority</th><th>Page</th><th>Category</th><th>Action</th><th>Competitors</th><th>Missing fixes</th><th>Retest prompts</th></tr></thead><tbody>${rows}</tbody></table>
</main></body></html>`;
}

async function main() {
  const benchmarkDir = path.join(process.cwd(), BENCHMARK_DIR);
  const outDir = path.join(benchmarkDir, "edit-implementation-packet");
  const briefsDir = path.join(outDir, "briefs");
  await mkdir(briefsDir, { recursive: true });

  const actions = await readCsv(path.join(benchmarkDir, "page-message-gap-map", "page-message-gap-actions.csv"));
  const topRows = actions
    .sort((a, b) => number(b.priority) - number(a.priority))
    .slice(0, 18);
  const briefs = topRows.map(buildBrief);

  for (const brief of briefs) {
    await writeFile(path.join(outDir, brief.file), brief.markdown);
  }

  const summary = {
    benchmarkDir,
    briefs: briefs.length,
    canonicalFirst: briefs.filter((brief) => /canonical/i.test(brief.action)).length,
    schemaFixPages: briefs.filter((brief) => brief.schemaFixes.length || brief.missingFixes.some((item) => /schema/i.test(item))).length,
    comparisonPages: briefs.filter((brief) => brief.missingFixes.some((item) => /comparison/i.test(item)) || brief.competitors.length).length,
    productModulePages: briefs.filter((brief) => brief.products.length).length,
    retestPrompts: briefs.reduce((sum, brief) => sum + brief.retests.length, 0),
    topPages: briefs.slice(0, 8).map((brief) => `${brief.title} ${brief.priority}`),
  };

  await writeFile(path.join(outDir, "edit-implementation-data.json"), JSON.stringify({ summary, briefs }, null, 2));
  await writeFile(path.join(outDir, "edit-brief-index.csv"), toCsv([
    ["priority", "title", "url", "category", "action", "brief_file", "competitors", "missing_fixes", "schema_fixes", "products", "retest_prompts"],
    ...briefs.map((brief) => [brief.priority, brief.title, brief.url, brief.category, brief.action, brief.file, brief.competitors, brief.missingFixes, brief.schemaFixes, brief.products, brief.retests]),
  ]));
  await writeFile(path.join(outDir, "REPORT.md"), `# iBOLT AI Edit Implementation Packet

Generated ${briefs.length} implementation briefs.

Top pages:

${briefs.slice(0, 10).map((brief) => `- [${brief.title}](${brief.file}), priority ${brief.priority}`).join("\n")}
`);
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml(briefs, summary));

  console.log(`Wrote ${outDir}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
