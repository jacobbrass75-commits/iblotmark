import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
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
  if (!name) throw new Error(`No ${prefix} directory found in ${OUTPUT_ROOT}`);
  return path.join(process.cwd(), OUTPUT_ROOT, name);
}

function num(value) {
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function avg(values) {
  const clean = values.map(num).filter(Number.isFinite);
  return clean.length ? Math.round(clean.reduce((sum, value) => sum + value, 0) / clean.length) : 0;
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

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "category";
}

function includesCategory(value, category) {
  return splitList(value).some((item) => item.toLowerCase().startsWith(category.toLowerCase()));
}

function top(rows, key, count = 6) {
  return [...rows].sort((a, b) => num(b[key]) - num(a[key]) || String(a.title || a.item || a.prompt || "").localeCompare(String(b.title || b.item || b.prompt || ""))).slice(0, count);
}

function joinValues(rows, field, count = 8) {
  return unique(rows.flatMap((row) => splitList(row[field]))).slice(0, count).join("; ");
}

function listMarkdown(values) {
  const clean = unique(values).filter(Boolean);
  return clean.length ? clean.map((value) => `- ${value}`).join("\n") : "- Not mapped yet.";
}

function listHtml(values) {
  const clean = unique(values).filter(Boolean);
  return clean.length ? `<ul>${clean.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>` : "<p>Not mapped yet.</p>";
}

function barSvg(rows, { title, labelKey, valueKey, width = 900, height = 390, color = "#1d4ed8" }) {
  const chartRows = rows.slice(0, 14);
  const max = Math.max(1, ...chartRows.map((row) => num(row[valueKey])));
  const left = 180;
  const right = 48;
  const topOffset = 58;
  const rowHeight = 24;
  const gap = 9;
  const innerWidth = width - left - right;
  const svgHeight = Math.max(height, topOffset + chartRows.length * (rowHeight + gap) + 32);
  const bars = chartRows.map((row, index) => {
    const y = topOffset + index * (rowHeight + gap);
    const barWidth = Math.round((num(row[valueKey]) / max) * innerWidth);
    return `<text x="16" y="${y + 17}" font-size="13" fill="#334155">${escapeHtml(row[labelKey])}</text>
<rect x="${left}" y="${y}" width="${barWidth}" height="${rowHeight}" fill="${color}" rx="4"/>
<text x="${left + barWidth + 8}" y="${y + 17}" font-size="13" fill="#111827" font-weight="700">${escapeHtml(row[valueKey])}</text>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${svgHeight}" viewBox="0 0 ${width} ${svgHeight}" role="img" aria-label="${escapeHtml(title)}">
<rect width="100%" height="100%" fill="#ffffff"/>
<text x="16" y="31" font-size="20" font-weight="800" fill="#0f172a">${escapeHtml(title)}</text>
${bars}
</svg>`;
}

function buildPlaybooks({ expandedRows, lifecycleRows, topicRows, backlogRows, productFamilyRows, sourceRows, promptRows }) {
  const categories = unique([
    ...expandedRows.map((row) => row.category),
    ...lifecycleRows.map((row) => row.category),
    ...topicRows.map((row) => row.topic),
    ...sourceRows.map((row) => row.category),
    ...promptRows.map((row) => row.category),
  ]).sort();

  return categories.map((category) => {
    const expanded = expandedRows.find((row) => row.category === category) || {};
    const life = lifecycleRows.filter((row) => row.category === category);
    const topic = topicRows.find((row) => row.topic === category) || {};
    const backlog = backlogRows.filter((row) => row.category === category || includesCategory(row.category, category)).sort((a, b) => num(b.priority) - num(a.priority));
    const families = productFamilyRows.filter((row) => includesCategory(row.topics, category)).sort((a, b) => num(b.priority) - num(a.priority));
    const source = sourceRows.find((row) => row.category === category) || {};
    const prompts = promptRows.filter((row) => row.category === category).sort((a, b) => num(b.priority) - num(a.priority));
    const competitors = unique([
      ...splitList(topic.top_competitors).map((item) => item.replace(/\s+\d+$/, "")),
      ...life.flatMap((row) => splitList(row.competitors)),
      ...backlog.flatMap((row) => splitList(row.competitors)),
      ...splitList(source.top_competitors),
    ]).slice(0, 12);
    const pageRows = top(life, "priority", 8);
    const backlogRowsTop = top(backlog, "priority", 8);
    const familyRowsTop = top(families, "priority", 5);
    const promptRowsTop = top(prompts, "priority", 10);
    const priority = num(source.priority) + num(topic.priority) + num(expanded.prompts) * 4 + num(expanded.canonical_review) * 12 + num(expanded.refresh_then_retest) * 10 + num(expanded.no_mapped_prompts) * 8;
    const nextAction = source.next_action || backlogRowsTop[0]?.next_action || "Refresh mapped pages, add comparison/product modules, and retest the expanded prompts.";
    return {
      category,
      priority: Math.round(priority),
      expanded_prompts: num(expanded.prompts),
      expanded_requests: num(expanded.requests),
      no_mapped_prompts: num(expanded.no_mapped_prompts),
      refresh_then_retest: num(expanded.refresh_then_retest),
      canonical_review: num(expanded.canonical_review),
      mapped_lower_priority: num(expanded.mapped_lower_priority),
      live_pages: life.length,
      avg_page_score: avg(life.map((row) => row.ai_citability_score)),
      canonical_pages: life.filter((row) => row.lifecycle_bucket === "Canonical decision").length,
      legacy_pages: life.filter((row) => row.lifecycle_bucket === "Legacy rewrite").length,
      citation_cleanup_pages: life.filter((row) => row.lifecycle_bucket === "Citation/schema cleanup").length,
      competitor_only_answers: num(topic.competitor_only_answers || source.competitor_only_answers),
      zero_mention_queries: num(topic.zero_mention_queries || source.zero_mention_queries),
      top_competitors: competitors.join("; "),
      source_targets: source.source_targets || "",
      recommended_owner: source.recommended_owner || [...new Set(backlogRowsTop.map((row) => row.owner))].join("; "),
      next_action: nextAction,
      top_pages: pageRows,
      top_backlog: backlogRowsTop,
      product_families: familyRowsTop,
      top_prompts: promptRowsTop,
      top_sources: expanded.top_sources || "",
      state_mix: expanded.state_mix || "",
      brief_file: `${slugify(category)}.md`,
    };
  }).sort((a, b) => b.priority - a.priority || a.category.localeCompare(b.category));
}

function buildBriefMarkdown(playbook) {
  return `# ${playbook.category} AI Visibility Playbook

## Current State

- Priority score: ${playbook.priority}
- Expanded benchmark prompts: ${playbook.expanded_prompts}
- Expanded provider requests: ${playbook.expanded_requests}
- Refresh then retest prompts: ${playbook.refresh_then_retest}
- Canonical review prompts: ${playbook.canonical_review}
- New content or solution-page prompts: ${playbook.no_mapped_prompts}
- Live pages in this category: ${playbook.live_pages}
- Average page citability score: ${playbook.avg_page_score}/100
- Competitor-only answers: ${playbook.competitor_only_answers}
- Zero-mention queries: ${playbook.zero_mention_queries}

## Competitors AI Uses

${listMarkdown(splitList(playbook.top_competitors))}

## Source Authority Targets

${listMarkdown(splitList(playbook.source_targets))}

## Top Pages To Work

${listMarkdown(playbook.top_pages.map((row) => `${row.title} (${row.lifecycle_bucket}, score ${row.ai_citability_score}) - ${row.recommended_next_action}`))}

## Top Backlog Items

${listMarkdown(playbook.top_backlog.map((row) => `${row.lane}: ${row.item} - ${row.next_action}`))}

## Product Families To Add

${listMarkdown(playbook.product_families.map((row) => `${row.family}: ${row.action}`))}

## Prompts To Retest

${listMarkdown(playbook.top_prompts.map((row) => `${row.prompt} (${row.test_state})`))}

## Category Action

Owner: ${playbook.recommended_owner || "Jacob/app"}

${playbook.next_action}
`;
}

function buildReportMarkdown(playbooks) {
  return `# iBOLT Vertical AI Visibility Playbooks

These playbooks roll up AI mention gaps, competitor displacement, live blog state, product module gaps, off-site citation needs, and expanded benchmark coverage by category.

| Priority | Category | Prompts | Requests | Live pages | Canonical | Refresh | New content | Competitor-only | Top competitors | Brief |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
${playbooks.map((row) => `| ${row.priority} | ${row.category} | ${row.expanded_prompts} | ${row.expanded_requests} | ${row.live_pages} | ${row.canonical_review} | ${row.refresh_then_retest} | ${row.no_mapped_prompts} | ${row.competitor_only_answers} | ${row.top_competitors} | [brief](verticals/${row.brief_file}) |`).join("\n")}
`;
}

function buildReportHtml(playbooks, categorySvg, competitorSvg, refreshSvg) {
  const cards = [
    ["Categories", playbooks.length, "Vertical playbooks"],
    ["Expanded prompts", playbooks.reduce((sum, row) => sum + row.expanded_prompts, 0), "Across categories"],
    ["Provider requests", playbooks.reduce((sum, row) => sum + row.expanded_requests, 0), "Expanded dry run"],
    ["Live pages", playbooks.reduce((sum, row) => sum + row.live_pages, 0), "Category-tagged page rows"],
    ["Canonical prompts", playbooks.reduce((sum, row) => sum + row.canonical_review, 0), "Review before retest"],
    ["New content prompts", playbooks.reduce((sum, row) => sum + row.no_mapped_prompts, 0), "Solution/content gaps"],
  ].map(([label, value, note]) => `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");
  const rows = playbooks.map((row) => `<tr>
<td>${escapeHtml(row.priority)}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.expanded_prompts)}</td><td>${escapeHtml(row.expanded_requests)}</td><td>${escapeHtml(row.live_pages)}</td><td>${escapeHtml(row.canonical_review)}</td><td>${escapeHtml(row.refresh_then_retest)}</td><td>${escapeHtml(row.no_mapped_prompts)}</td><td>${escapeHtml(row.competitor_only_answers)}</td><td>${escapeHtml(row.top_competitors)}</td><td><a href="verticals/${escapeHtml(row.brief_file)}">brief</a></td>
</tr>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>iBOLT Vertical AI Visibility Playbooks</title>
<style>
body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}main{max-width:1240px;margin:0 auto;padding:34px 26px 60px}h1{font-size:34px;margin:0 0 8px}h2{font-size:22px;margin:34px 0 14px}p{color:#334155;line-height:1.55}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}.k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700}.v{font-size:30px;font-weight:800;margin-top:8px}.chart{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:12px;margin:14px 0;overflow:auto}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden}th,td{text-align:left;vertical-align:top;padding:9px 10px;border-bottom:1px solid #edf2f7;font-size:13px}th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}a{color:#1d4ed8}
</style></head><body><main>
<h1>iBOLT Vertical AI Visibility Playbooks</h1>
<p>Category-level playbooks for what to refresh, compare, cite, link, and retest.</p>
<section class="cards">${cards}</section>
<h2>Priority By Category</h2><div class="chart">${categorySvg}</div>
<h2>Competitor-only Pressure</h2><div class="chart">${competitorSvg}</div>
<h2>Refresh Prompts</h2><div class="chart">${refreshSvg}</div>
<h2>Category Index</h2>
<table><thead><tr><th>Priority</th><th>Category</th><th>Prompts</th><th>Requests</th><th>Pages</th><th>Canonical</th><th>Refresh</th><th>New content</th><th>Competitor-only</th><th>Competitors</th><th>Brief</th></tr></thead><tbody>${rows}</tbody></table>
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, "vertical-playbooks");
  const verticalDir = path.join(outDir, "verticals");
  await mkdir(verticalDir, { recursive: true });

  const expandedRows = await readCsv(path.join(benchmarkDir, "expanded-test-coverage-map", "expanded-category-coverage.csv"));
  const promptRows = await readCsv(path.join(benchmarkDir, "expanded-test-coverage-map", "expanded-prompt-coverage-ledger.csv"));
  const lifecycleRows = await readCsv(path.join(benchmarkDir, "blog-lifecycle-map", "page-lifecycle-ledger.csv"));
  const topicRows = await readCsv(path.join(benchmarkDir, "competitor-displacement-map", "topic-displacement-summary.csv"));
  const backlogRows = await readCsv(path.join(benchmarkDir, "visibility-execution-backlog", "integrated-execution-backlog.csv"));
  const productFamilyRows = await readCsv(path.join(benchmarkDir, "product-entity-coverage-plan", "product-family-coverage-summary.csv"));
  const sourceRows = await readCsv(path.join(benchmarkDir, "source-authority-roadmap", "topic-source-authority-priority.csv"));
  const sourceData = await readJsonIfExists(path.join(benchmarkDir, "source-authority-roadmap", "source-authority-data.json"), { summary: {} });

  const playbooks = buildPlaybooks({ expandedRows, lifecycleRows, topicRows, backlogRows, productFamilyRows, sourceRows, promptRows });
  for (const playbook of playbooks) {
    await writeFile(path.join(verticalDir, playbook.brief_file), buildBriefMarkdown(playbook));
  }

  const categorySvg = barSvg(playbooks, { title: "Category playbook priority", labelKey: "category", valueKey: "priority", color: "#1d4ed8" });
  const competitorSvg = barSvg(playbooks, { title: "Competitor-only answers by category", labelKey: "category", valueKey: "competitor_only_answers", color: "#dc2626" });
  const refreshSvg = barSvg(playbooks, { title: "Refresh-then-retest prompts by category", labelKey: "category", valueKey: "refresh_then_retest", color: "#0f766e" });

  const summary = {
    generatedAt: new Date().toISOString(),
    categories: playbooks.length,
    topCategories: playbooks.slice(0, 6).map((row) => row.category),
    expandedPrompts: playbooks.reduce((sum, row) => sum + row.expanded_prompts, 0),
    expandedRequests: playbooks.reduce((sum, row) => sum + row.expanded_requests, 0),
    livePages: sourceData.summary?.livePages || 142,
    totalCompetitorOnlyAnswers: sourceData.summary?.competitorOnlyAnswers || 68,
    totalCitationRate: sourceData.summary?.citationRate || 0,
  };

  await writeFile(path.join(outDir, "category-priority.svg"), categorySvg);
  await writeFile(path.join(outDir, "category-competitor-pressure.svg"), competitorSvg);
  await writeFile(path.join(outDir, "category-refresh-prompts.svg"), refreshSvg);
  await writeFile(path.join(outDir, "vertical-playbooks-data.json"), JSON.stringify({ summary, playbooks }, null, 2));
  await writeFile(path.join(outDir, "vertical-playbook-index.csv"), csv([
    ["priority", "category", "expanded_prompts", "expanded_requests", "live_pages", "avg_page_score", "canonical_prompts", "refresh_prompts", "new_content_prompts", "competitor_only_answers", "zero_mention_queries", "top_competitors", "source_targets", "recommended_owner", "next_action", "brief_file"],
    ...playbooks.map((row) => [row.priority, row.category, row.expanded_prompts, row.expanded_requests, row.live_pages, row.avg_page_score, row.canonical_review, row.refresh_then_retest, row.no_mapped_prompts, row.competitor_only_answers, row.zero_mention_queries, row.top_competitors, row.source_targets, row.recommended_owner, row.next_action, row.brief_file]),
  ]));
  await writeFile(path.join(outDir, "category-action-map.csv"), csv([
    ["category", "top_pages", "top_backlog_items", "product_families", "top_prompts", "next_action"],
    ...playbooks.map((row) => [
      row.category,
      row.top_pages.map((page) => `${page.title} (${page.lifecycle_bucket})`).join("; "),
      row.top_backlog.map((item) => `${item.lane}: ${item.item}`).join("; "),
      row.product_families.map((family) => family.family).join("; "),
      row.top_prompts.map((prompt) => prompt.prompt).join("; "),
      row.next_action,
    ]),
  ]));
  await writeFile(path.join(outDir, "REPORT.md"), buildReportMarkdown(playbooks));
  await writeFile(path.join(outDir, "REPORT.html"), buildReportHtml(playbooks, categorySvg, competitorSvg, refreshSvg));

  console.log(`Wrote ${outDir}`);
  console.log(`Categories: ${summary.categories}`);
  console.log(`Top categories: ${summary.topCategories.join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
