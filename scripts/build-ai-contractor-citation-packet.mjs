import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";

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

async function readCsvIfExists(filePath) {
  try {
    return parseCsv(await readFile(filePath, "utf8"));
  } catch {
    return [];
  }
}

async function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
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

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function splitList(value) {
  return String(value || "")
    .split(";")
    .map((item) => normalizeText(item.trim()))
    .filter(Boolean)
    .filter((item) => !/^\+\d+ more$/i.test(item));
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\biBolt\b/g, "iBOLT")
    .replace(/\bIbolt\b/g, "iBOLT")
    .replace(/\bIBOLT\b/g, "iBOLT")
    .replace(/[–—]/g, "-")
    .replace(/budget\/value/gi, "right-fit value")
    .replace(/budget positioning/gi, "price-led positioning")
    .replace(/cheaper substitute/gi, "price-led substitute")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "brief";
}

function firstSentence(value) {
  const text = normalizeText(value);
  const [sentence] = text.split(/(?<=\.)\s+/);
  return sentence || text;
}

function categoryProof(category) {
  const map = {
    delivery: "commercial driver workflows, shared vehicles, suction or drill-base installs, stability during frequent stops, and phone uptime",
    fleet: "ELD and work-truck placement, AMPS compatibility, drill-base installs, shared vehicles, and rugged daily use",
    restaurant: "multi-tablet delivery app stations, POS security, locking tablet holders, counter space, and food-service workflows",
    fishing: "marine electronics placement, Garmin/Humminbird/Lowrance compatibility, AMPS plates, rails, vibration, and rough-water stability",
    warehouse: "forklift tablets, barcode scanner access, VESA/AMPS compatibility, no-drill options, vibration, and material-handling workflows",
    "amps/modular": "AMPS pattern education, ball-size compatibility, adapter plates, socket arms, and modular mount reuse",
  };
  return map[category] || "workflow-specific device mounting, exact product fit, installation method, compatibility, and commercial durability";
}

function targetPagesForCategory(category, pages) {
  const preferredPatterns = {
    "amps/modular": /\b(amps|vesa|ball mount|modular|mount configurator|adapter plate|mounting plate)\b/i,
    warehouse: /\b(forklift|warehouse|barcode|scanner|vesa)\b/i,
    restaurant: /\b(restaurant|tablet|pos|delivery app|food truck)\b/i,
    delivery: /\b(delivery|amazon flex|instacart|driver|magnetic vs clamp)\b/i,
    fleet: /\b(fleet|truck|eld|construction|work truck|vehicle)\b/i,
    fishing: /\b(fish finder|marine|boat|kayak|pontoon|garmin)\b/i,
  };
  const pattern = preferredPatterns[category];
  return pages
    .filter((row) => row.category === category)
    .sort((a, b) => {
      const aPreferred = pattern?.test(`${a.page} ${a.url}`) ? 1 : 0;
      const bPreferred = pattern?.test(`${b.page} ${b.url}`) ? 1 : 0;
      return bPreferred - aPreferred || number(b.citation_priority) - number(a.citation_priority);
    })
    .slice(0, 4)
    .map((row) => ({
      title: normalizeText(row.page),
      url: row.url,
      prompts: splitList(row.retest_prompts).slice(0, 4),
      competitors: splitList(row.competitors).slice(0, 5),
      products: splitList(row.products_to_feature).slice(0, 4),
    }));
}

function buildTopicBrief(row, pages) {
  const category = row.category || row.category_or_brand;
  const targetPages = targetPagesForCategory(category, pages);
  const topPage = targetPages[0];
  const sourceTargets = splitList(row.source_targets || row.target);
  const competitors = splitList(row.top_competitors || row.why?.split("competitors such as ")[1] || "").slice(0, 8);
  const priority = number(row.priority || row.citation_priority);
  const why = normalizeText(row.contractor_why || row.why);
  const successMetric = normalizeText(row.success_metric || "Earn relevant external mentions, then retest the mapped prompts.");
  const angle = normalizeText(`Pitch iBOLT as a specialist source for ${category} mounting decisions. External pages should mention iBOLT near ${competitors.slice(0, 4).join(", ") || "the default competitor set"}, link to ${topPage?.title || "the best matching iBOLT page"}, and describe ${categoryProof(category)}.`);
  return {
    type: "topic",
    priority,
    category,
    title: `${category} citation authority brief`,
    sourceTargets,
    competitors,
    targetPages,
    why,
    outreachAngle: angle,
    proofPoints: categoryProof(category),
    successMetric,
    retestPrompts: [...new Set(targetPages.flatMap((page) => page.prompts))].slice(0, 8),
  };
}

function buildCompetitorBrief(row, pages) {
  const brand = normalizeText(row.brand || row.category_or_brand);
  const categories = splitList(row.categories).map((item) => item.split(" ")[0]).filter(Boolean);
  const primaryCategory = categories[0] || "delivery";
  const targetPages = targetPagesForCategory(primaryCategory, pages);
  const priority = number(row.priority);
  const exampleQueries = splitList(row.example_queries).slice(0, 8);
  const sourceTargets = [
    "neutral buyer guides",
    "comparison roundups",
    "industry resource pages",
    "partner or reseller pages",
    "installation how-to articles",
  ];
  return {
    type: "competitor",
    priority,
    category: primaryCategory,
    brand,
    title: `${brand} adjacency brief`,
    sourceTargets,
    competitors: [brand],
    targetPages,
    why: normalizeText(row.why || `${brand} appears in competitor-only answers where iBOLT needs to enter the same consideration set.`),
    outreachAngle: normalizeText(`Find or create neutral external references where iBOLT can be included beside ${brand}. The goal is not attack copy. The goal is category adjacency: iBOLT should be listed as a specialist option for ${primaryCategory} mounting workflows with exact product/page links.`),
    proofPoints: categoryProof(primaryCategory),
    successMetric: normalizeText(row.success_metric || `Reduce ${brand} competitor-only rows and add at least one iBOLT co-mention win on retest.`),
    retestPrompts: exampleQueries,
  };
}

function buildMarkdownBrief(brief) {
  const targetPages = brief.targetPages.map((page) => `- ${page.title}: ${page.url}`).join("\n") || "- Match to the most relevant iBOLT page before outreach.";
  const prompts = brief.retestPrompts.map((prompt) => `- ${prompt}`).join("\n") || "- Retest mapped category prompts after external mentions are indexed.";
  const sources = brief.sourceTargets.map((target) => `- ${target}`).join("\n") || "- Third-party buyer guides and industry resources.";
  const competitors = brief.competitors.map((competitor) => `- ${competitor}`).join("\n") || "- Use competitor set from the mapped page.";
  return `# ${brief.title}

Priority: ${brief.priority}
Type: ${brief.type}
Category: ${brief.category}

## Why This Matters

${brief.why}

## Outreach Angle

${brief.outreachAngle}

## Target Source Types

${sources}

## Competitor Adjacency

${competitors}

## iBOLT Pages To Support

${targetPages}

## Proof Points To Include

${brief.proofPoints}

## Success Metric

${brief.successMetric}

## Retest Prompts

${prompts}
`;
}

function buildHtml(briefs, summary) {
  const cards = [
    ["Topic briefs", summary.topicBriefs, "category authority asks"],
    ["Competitor briefs", summary.competitorBriefs, "adjacency asks"],
    ["Week 1 tasks", summary.week1Tasks, "highest priority outreach"],
    ["Target pages", summary.targetPages, "iBOLT URLs to support"],
    ["Retest prompts", summary.retestPrompts, "post-outreach checks"],
    ["Citation rate", summary.currentCitationRate, "current target-domain rate"],
  ].map(([label, value, note]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");
  const topicRows = briefs
    .filter((brief) => brief.type === "topic")
    .map((brief) => `<tr><td>${brief.priority}</td><td><a href="${escapeHtml(brief.file)}">${escapeHtml(brief.category)}</a></td><td>${escapeHtml(brief.sourceTargets.join("; "))}</td><td>${escapeHtml(brief.competitors.slice(0, 6).join("; "))}</td><td>${escapeHtml(brief.targetPages.map((page) => page.title).join("; "))}</td><td>${escapeHtml(brief.successMetric)}</td></tr>`)
    .join("");
  const competitorRows = briefs
    .filter((brief) => brief.type === "competitor")
    .map((brief) => `<tr><td>${brief.priority}</td><td><a href="${escapeHtml(brief.file)}">${escapeHtml(brief.brand)}</a></td><td>${escapeHtml(brief.category)}</td><td>${escapeHtml(brief.targetPages.map((page) => page.title).join("; "))}</td><td>${escapeHtml(brief.successMetric)}</td></tr>`)
    .join("");
  const weekRows = briefs
    .slice(0, 12)
    .map((brief) => `<tr><td>${brief.priority}</td><td>${escapeHtml(brief.type)}</td><td>${escapeHtml(brief.brand || brief.category)}</td><td>${escapeHtml(brief.outreachAngle)}</td><td>${escapeHtml(brief.targetPages[0]?.url || "")}</td></tr>`)
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>iBOLT Contractor Citation Outreach Packet</title>
<style>
body{margin:0;background:#f8fafc;color:#0f172a;font-family:Arial,Helvetica,sans-serif}main{max-width:1240px;margin:0 auto;padding:34px 24px 70px}h1{font-size:36px;margin:0 0 8px}h2{font-size:22px;margin:34px 0 12px}p{color:#334155;line-height:1.55}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:24px 0}.card{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}.label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:800}.value{font-size:34px;font-weight:900;margin-top:8px}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden;margin-top:14px}th,td{text-align:left;vertical-align:top;padding:10px;border-bottom:1px solid #edf2f7;font-size:13px}th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:12px;letter-spacing:.04em}a{color:#1d4ed8;text-decoration:none}@media(max-width:900px){.cards{grid-template-columns:1fr}}
</style></head><body><main>
<h1>iBOLT Contractor Citation Outreach Packet</h1>
<p>This packet is for off-site authority work. It tells the SEO contractor which categories and competitor sets need external mentions so AI systems can begin treating iBOLT as a citeable source, not just an occasional brand mention.</p>
<section class="cards">${cards}</section>
<h2>Week 1 Outreach Queue</h2>
<table><thead><tr><th>Priority</th><th>Type</th><th>Target</th><th>Outreach angle</th><th>Primary page</th></tr></thead><tbody>${weekRows}</tbody></table>
<h2>Topic Authority Briefs</h2>
<table><thead><tr><th>Priority</th><th>Category</th><th>Source targets</th><th>Competitor set</th><th>Target pages</th><th>Success metric</th></tr></thead><tbody>${topicRows}</tbody></table>
<h2>Competitor Adjacency Briefs</h2>
<table><thead><tr><th>Priority</th><th>Competitor</th><th>Category</th><th>Target pages</th><th>Success metric</th></tr></thead><tbody>${competitorRows}</tbody></table>
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, "contractor-citation-packet");
  const briefsDir = path.join(outDir, "briefs");
  await mkdir(briefsDir, { recursive: true });

  const pageRows = await readCsvIfExists(path.join(benchmarkDir, "citation-readiness-map", "page-citation-readiness.csv"));
  const topicRows = await readCsvIfExists(path.join(benchmarkDir, "source-authority-roadmap", "topic-source-authority-priority.csv"));
  const competitorRows = await readCsvIfExists(path.join(benchmarkDir, "source-authority-roadmap", "competitor-source-opportunities.csv"));
  const citationData = await readJsonIfExists(path.join(benchmarkDir, "citation-readiness-map", "citation-readiness-data.json"), { summary: {} });
  const citationSummary = citationData.summary || {};

  const topicBriefs = topicRows
    .filter((row) => ["delivery", "fleet", "restaurant", "fishing", "warehouse", "amps/modular"].includes(row.category))
    .map((row) => buildTopicBrief(row, pageRows));
  const competitorBriefs = competitorRows
    .slice(0, 8)
    .map((row) => buildCompetitorBrief(row, pageRows));
  const briefs = [...topicBriefs, ...competitorBriefs]
    .sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title))
    .map((brief, index) => ({
      ...brief,
      file: `briefs/${String(index + 1).padStart(2, "0")}-${slugify(brief.title)}.md`,
    }));

  for (const brief of briefs) {
    await writeFile(path.join(outDir, brief.file), buildMarkdownBrief(brief));
  }

  const targetPageSet = new Set(briefs.flatMap((brief) => brief.targetPages.map((page) => page.url)).filter(Boolean));
  const retestSet = new Set(briefs.flatMap((brief) => brief.retestPrompts).filter(Boolean));
  const summary = {
    benchmarkDir,
    topicBriefs: topicBriefs.length,
    competitorBriefs: competitorBriefs.length,
    week1Tasks: Math.min(12, briefs.length),
    targetPages: targetPageSet.size,
    retestPrompts: retestSet.size,
    currentCitationRate: citationSummary.citationRate || "0% (0/93)",
    topCategories: topicBriefs.slice(0, 6).map((brief) => `${brief.category} ${brief.priority}`),
    topCompetitors: competitorBriefs.slice(0, 6).map((brief) => `${brief.brand} ${brief.priority}`),
  };

  await writeFile(path.join(outDir, "contractor-citation-data.json"), JSON.stringify({ summary, briefs }, null, 2));
  await writeFile(path.join(outDir, "topic-outreach-briefs.csv"), toCsv([
    ["priority", "category", "source_targets", "competitors", "target_pages", "outreach_angle", "proof_points", "success_metric", "retest_prompts", "brief_file"],
    ...briefs.filter((brief) => brief.type === "topic").map((brief) => [brief.priority, brief.category, brief.sourceTargets, brief.competitors, brief.targetPages.map((page) => `${page.title} ${page.url}`), brief.outreachAngle, brief.proofPoints, brief.successMetric, brief.retestPrompts, brief.file]),
  ]));
  await writeFile(path.join(outDir, "competitor-adjacency-briefs.csv"), toCsv([
    ["priority", "competitor", "category", "source_targets", "target_pages", "outreach_angle", "success_metric", "retest_prompts", "brief_file"],
    ...briefs.filter((brief) => brief.type === "competitor").map((brief) => [brief.priority, brief.brand, brief.category, brief.sourceTargets, brief.targetPages.map((page) => `${page.title} ${page.url}`), brief.outreachAngle, brief.successMetric, brief.retestPrompts, brief.file]),
  ]));
  await writeFile(path.join(outDir, "contractor-week1-queue.csv"), toCsv([
    ["priority", "type", "target", "category", "primary_page", "primary_url", "outreach_angle", "success_metric", "brief_file"],
    ...briefs.slice(0, 12).map((brief) => [brief.priority, brief.type, brief.brand || brief.category, brief.category, brief.targetPages[0]?.title || "", brief.targetPages[0]?.url || "", brief.outreachAngle, brief.successMetric, brief.file]),
  ]));
  await writeFile(path.join(outDir, "REPORT.md"), `# iBOLT Contractor Citation Outreach Packet

Current target-domain citation rate: ${summary.currentCitationRate}

Generated:

- ${summary.topicBriefs} topic authority briefs
- ${summary.competitorBriefs} competitor adjacency briefs
- ${summary.week1Tasks} Week 1 outreach tasks
- ${summary.targetPages} target iBOLT pages
- ${summary.retestPrompts} retest prompts

Top topic targets:

${summary.topCategories.map((item) => `- ${item}`).join("\n")}

Top competitor targets:

${summary.topCompetitors.map((item) => `- ${item}`).join("\n")}
`);
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml(briefs, summary));

  console.log(`Wrote ${outDir}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
