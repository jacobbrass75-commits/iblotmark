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

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/^\+\d+\s+more$/i.test(item));
}

function firstList(value, count = 5) {
  return splitList(value).slice(0, count).join("; ");
}

function normalizeUrl(value) {
  return String(value ?? "").replace(/\/+$/, "");
}

function shortText(value, length = 220) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function barSvg(rows, { title, labelKey, valueKey, width = 900, height = 390, color = "#1d4ed8" }) {
  const chartRows = rows.slice(0, 12);
  const max = Math.max(1, ...chartRows.map((row) => num(row[valueKey])));
  const left = 220;
  const right = 48;
  const top = 58;
  const rowHeight = 24;
  const gap = 9;
  const innerWidth = width - left - right;
  const svgHeight = Math.max(height, top + chartRows.length * (rowHeight + gap) + 32);
  const bars = chartRows.map((row, index) => {
    const y = top + index * (rowHeight + gap);
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

function sprintFor(row) {
  if (row.lane.includes("Canonical") || row.priority >= 900) return "Sprint 1: canonical and highest-pressure pages";
  if (row.lane.includes("Benchmark") || row.lane.includes("Citation/schema") || row.lane.includes("Product entity")) {
    return "Sprint 2: page refresh and product-entity lift";
  }
  if (row.lane.includes("Off-site") || row.lane.includes("New content") || row.lane.includes("Retest")) {
    return "Sprint 3: authority, net-new coverage, and retest";
  }
  return "Sprint 2: page refresh and product-entity lift";
}

function addRow(rows, row) {
  rows.push({
    priority: Math.round(num(row.priority)),
    lane: row.lane,
    sprint: "",
    owner: row.owner,
    item: row.item,
    target_url: normalizeUrl(row.target_url),
    category: row.category || "",
    competitors: row.competitors || "",
    prompts: row.prompts || "",
    products: row.products || "",
    evidence: shortText(row.evidence),
    next_action: shortText(row.next_action, 260),
    success_metric: shortText(row.success_metric, 240),
    source: row.source,
  });
}

function buildBacklog({
  survivorRows,
  queryRows,
  lifecycleRows,
  productRows,
  contentGapRows,
  offsiteRows,
  sourceActionRows,
  providerRetestRows,
}) {
  const rows = [];
  const lifecycleByUrl = new Map(lifecycleRows.map((row) => [normalizeUrl(row.url), row]));

  for (const row of survivorRows) {
    const url = normalizeUrl(row.page_url);
    const life = lifecycleByUrl.get(url) || {};
    addRow(rows, {
      priority: num(row.priority) + 500,
      lane: row.ticket_type?.includes("canonical") ? "Canonical/page survivor decision" : "Benchmark page refresh",
      owner: "Jacob/app",
      item: row.page_title,
      target_url: url,
      category: life.category || "",
      competitors: row.competitors,
      prompts: row.prompts_to_preserve || row.retest_prompts,
      products: row.product_modules,
      evidence: `${row.zero_mention_queries || 0} zero-mention queries, ${row.competitor_only_answers || 0} competitor-only answers, lifecycle ${life.lifecycle_bucket || "unknown"}.`,
      next_action: row.canonical_decision || row.issues || "Execute survivor edit ticket.",
      success_metric: `After edits, retest: ${firstList(row.retest_prompts || row.prompts_to_preserve, 4)}.`,
      source: "survivor-edit-tickets",
    });
  }

  for (const row of queryRows) {
    addRow(rows, {
      priority: num(row.priority) + (num(row.mention_rate) === 0 ? 350 : 180) + num(row.competitor_only_answers) * 30,
      lane: "Benchmark query refresh",
      owner: "Jacob/app",
      item: row.query,
      target_url: row.page_url,
      category: row.category,
      competitors: row.competitors,
      prompts: row.query,
      products: row.products_to_add,
      evidence: `${row.mention_rate}% mention rate, ${row.competitor_only_answers} competitor-only answers, weakest providers ${row.weakest_providers}.`,
      next_action: row.recommended_action,
      success_metric: row.win_condition,
      source: "competitor-displacement-map",
    });
  }

  for (const row of lifecycleRows) {
    const bucket = String(row.lifecycle_bucket || "");
    if (bucket === "Protect and amplify") {
      addRow(rows, {
        priority: num(row.priority) + 110,
        lane: "Protect and amplify",
        owner: "Jacob/app + SEO contractor",
        item: row.title,
        target_url: row.url,
        category: row.category,
        competitors: row.competitors,
        prompts: row.linked_prompts,
        evidence: row.reasons,
        next_action: "Keep this page live, add internal links, fix minor schema/media issues, and use it as an external-citation target.",
        success_metric: "Preserve citability score while increasing internal links and third-party references.",
        source: "blog-lifecycle-map",
      });
    } else if (bucket === "Citation/schema cleanup" || bucket === "Legacy rewrite") {
      addRow(rows, {
        priority: num(row.priority) + (bucket === "Legacy rewrite" ? 80 : 40),
        lane: bucket === "Legacy rewrite" ? "Legacy answer-first rewrite" : "Citation/schema cleanup",
        owner: "Jacob/app",
        item: row.title,
        target_url: row.url,
        category: row.category,
        competitors: row.competitors,
        prompts: row.linked_prompts,
        evidence: row.reasons,
        next_action: row.recommended_next_action,
        success_metric: "Page has quick answer, FAQ schema, Article/BlogPosting schema, comparison context, product cards, and image alt text.",
        source: "blog-lifecycle-map",
      });
    }
  }

  for (const row of productRows.slice(0, 80)) {
    addRow(rows, {
      priority: num(row.priority) + 220,
      lane: "Product entity module",
      owner: "Jacob/app",
      item: row.title,
      target_url: firstList(row.target_pages, 1),
      category: row.inferred_categories || row.verticals,
      competitors: row.competitor_context,
      prompts: row.prompts_to_support,
      products: row.title,
      evidence: row.reason,
      next_action: row.suggested_action,
      success_metric: "Exact product name appears in mapped page module with specs, image, URL, price, compatibility, and prompt-specific use case.",
      source: "product-entity-coverage-plan",
    });
  }

  for (const row of contentGapRows) {
    addRow(rows, {
      priority: num(row.priority) + 180,
      lane: "New content/solution page",
      owner: "Jacob/app",
      item: row.title,
      target_url: row.slug ? `https://iboltmounts.com/blogs/news/${row.slug}` : "",
      category: row.category,
      competitors: row.competitors,
      prompts: row.prompts,
      products: row.suggested_products,
      evidence: `${row.prompt_count} prompts, ${row.provider_request_count} provider requests, source ${row.sources}.`,
      next_action: row.action,
      success_metric: "Published or drafted answer-first page covers the unmapped prompts and joins the retest queue.",
      source: "content-gap-briefs",
    });
  }

  for (const row of offsiteRows) {
    addRow(rows, {
      priority: num(row.priority) + 160,
      lane: "Off-site citation authority",
      owner: "SEO contractor",
      item: row.brand,
      target_url: "",
      category: row.categories,
      competitors: row.brand,
      prompts: row.example_queries,
      evidence: `Competitor displacement pressure for ${row.brand}.`,
      next_action: row.off_site_ask,
      success_metric: row.success_metric,
      source: "competitor-displacement-map",
    });
  }

  for (const row of sourceActionRows) {
    addRow(rows, {
      priority: 170 - num(row.priority),
      lane: "Strategic workstream",
      owner: row.owner,
      item: row.workstream,
      target_url: "",
      category: row.target,
      evidence: row.why,
      next_action: row.action,
      success_metric: row.success_metric,
      source: "source-authority-roadmap",
    });
  }

  for (const row of providerRetestRows) {
    addRow(rows, {
      priority: 250 - num(row.order),
      lane: "Retest checklist",
      owner: "Jacob/app",
      item: row.query,
      target_url: row.page_url,
      category: row.category,
      competitors: row.competitors,
      prompts: row.query,
      evidence: `${row.baseline_stage}; watch ${row.providers_to_watch}.`,
      next_action: row.required_edit,
      success_metric: row.success_threshold,
      source: "provider-blindspots",
    });
  }

  const deduped = [];
  const seen = new Set();
  for (const row of rows.sort((a, b) => b.priority - a.priority || a.item.localeCompare(b.item))) {
    const key = `${row.lane}:${row.item}:${row.target_url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    row.sprint = sprintFor(row);
    deduped.push(row);
  }
  return deduped;
}

function summarize(backlog, sourceSummaries) {
  const laneRows = [...new Set(backlog.map((row) => row.lane))].map((lane) => {
    const rows = backlog.filter((row) => row.lane === lane);
    return {
      lane,
      items: rows.length,
      avg_priority: Math.round(rows.reduce((sum, row) => sum + num(row.priority), 0) / Math.max(1, rows.length)),
      owners: [...new Set(rows.map((row) => row.owner))].join("; "),
    };
  }).sort((a, b) => b.items - a.items || b.avg_priority - a.avg_priority);

  const sprintRows = [...new Set(backlog.map((row) => row.sprint))].map((sprint) => {
    const rows = backlog.filter((row) => row.sprint === sprint);
    return {
      sprint,
      items: rows.length,
      top_items: rows.slice(0, 8).map((row) => row.item).join("; "),
      owners: [...new Set(rows.map((row) => row.owner))].join("; "),
    };
  });

  const ownerRows = [...new Set(backlog.map((row) => row.owner))].map((owner) => {
    const rows = backlog.filter((row) => row.owner === owner);
    return {
      owner,
      items: rows.length,
      lanes: [...new Set(rows.map((row) => row.lane))].join("; "),
      top_items: rows.slice(0, 10).map((row) => row.item).join("; "),
    };
  }).sort((a, b) => b.items - a.items || a.owner.localeCompare(b.owner));

  return {
    generatedAt: new Date().toISOString(),
    totalBacklogItems: backlog.length,
    sprintRows,
    laneRows,
    ownerRows,
    currentMentionRate: sourceSummaries.competitor?.mentionRate || 0,
    currentNonBrandedMentionRate: sourceSummaries.competitor?.nonBrandedMentionRate || 0,
    currentCitationRate: sourceSummaries.competitor?.citationRate || 0,
    competitorOnlyRows: sourceSummaries.competitor?.competitorOnlyRows || 0,
    livePages: sourceSummaries.lifecycle?.pages || 0,
    canonicalDecisionPages: sourceSummaries.lifecycle?.canonicalDecisionPages || 0,
    productEntityRows: sourceSummaries.product?.workQueueRows || 0,
    unlinkedProducts: sourceSummaries.product?.unlinkedProducts || 0,
  };
}

function buildMarkdown({ summary, backlog }) {
  const top = backlog.slice(0, 20);
  return `# iBOLT AI Visibility Execution Backlog

## Current State

- Mention rate: ${summary.currentMentionRate}%.
- Non-branded mention rate: ${summary.currentNonBrandedMentionRate}%.
- Citation rate: ${summary.currentCitationRate}%.
- Competitor-only rows: ${summary.competitorOnlyRows}.
- Live pages reviewed: ${summary.livePages}.
- Canonical-decision pages: ${summary.canonicalDecisionPages}.
- Product/entity queue rows: ${summary.productEntityRows}.
- Unlinked products: ${summary.unlinkedProducts}.

## What This Backlog Does

This combines competitor displacement, provider blind spots, all-blog lifecycle review, survivor/canonical tickets, product entity coverage, content gaps, source-authority asks, and retest requirements into one ordered execution queue.

## Sprint Plan

| Sprint | Items | Owners | Top items |
| --- | ---: | --- | --- |
${summary.sprintRows.map((row) => `| ${row.sprint} | ${row.items} | ${row.owners} | ${row.top_items} |`).join("\n")}

## Top 20 Actions

| Priority | Lane | Owner | Item | Category | Evidence | Next action | Success metric |
| ---: | --- | --- | --- | --- | --- | --- | --- |
${top.map((row) => `| ${row.priority} | ${row.lane} | ${row.owner} | ${row.target_url ? `[${row.item}](${row.target_url})` : row.item} | ${row.category} | ${row.evidence} | ${row.next_action} | ${row.success_metric} |`).join("\n")}
`;
}

function buildHtml({ summary, backlog, laneSvg, sprintSvg, ownerSvg }) {
  const cards = [
    ["Backlog items", summary.totalBacklogItems, "Integrated queue"],
    ["Mention rate", `${summary.currentMentionRate}%`, "Current saved baseline"],
    ["Non-branded mention", `${summary.currentNonBrandedMentionRate}%`, "Main growth KPI"],
    ["Citation rate", `${summary.currentCitationRate}%`, "Source authority KPI"],
    ["Competitor-only rows", summary.competitorOnlyRows, "Answers to displace"],
    ["Canonical decisions", summary.canonicalDecisionPages, "Before broad edits"],
    ["Product entity rows", summary.productEntityRows, "Catalog/module work"],
    ["Unlinked products", summary.unlinkedProducts, "Catalog spread gap"],
    ["Live pages", summary.livePages, "Reviewed in lifecycle map"],
  ].map(([label, value, note]) => `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");

  const topRows = backlog.slice(0, 40).map((row) => `<tr>
<td>${escapeHtml(row.priority)}</td><td>${escapeHtml(row.sprint)}</td><td>${escapeHtml(row.lane)}</td><td>${escapeHtml(row.owner)}</td>
<td>${row.target_url ? `<a href="${escapeHtml(row.target_url)}">${escapeHtml(row.item)}</a>` : escapeHtml(row.item)}</td>
<td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.competitors)}</td><td>${escapeHtml(row.evidence)}</td><td>${escapeHtml(row.next_action)}</td>
</tr>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>iBOLT AI Visibility Execution Backlog</title>
<style>
body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}main{max-width:1240px;margin:0 auto;padding:34px 26px 60px}h1{font-size:34px;margin:0 0 8px}h2{font-size:22px;margin:34px 0 14px}p{color:#334155;line-height:1.55}.lede{font-size:17px;max-width:980px}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}.k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700}.v{font-size:30px;font-weight:800;margin-top:8px}.chart{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:12px;margin:14px 0;overflow:auto}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden}th,td{text-align:left;vertical-align:top;padding:9px 10px;border-bottom:1px solid #edf2f7;font-size:13px}th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}.note{border-left:6px solid #0f766e;background:#fff;border-radius:10px;padding:16px 18px;border-top:1px solid #d7dee8;border-right:1px solid #d7dee8;border-bottom:1px solid #d7dee8}a{color:#1d4ed8}
</style></head><body><main>
<h1>iBOLT AI Visibility Execution Backlog</h1>
<p class="lede">This is the ordered work queue that connects benchmark misses to specific page, product, competitor, off-site citation, and retest actions.</p>
<section class="cards">${cards}</section>
<p class="note"><strong>Order of operations:</strong> resolve canonical/survivor pages first, then refresh high-pressure query pages, then add product entity modules, source-ready schema, off-site citations, net-new coverage, and retests.</p>
<h2>Backlog by Lane</h2><div class="chart">${laneSvg}</div>
<h2>Sprint Buckets</h2><div class="chart">${sprintSvg}</div>
<h2>Owner Handoff</h2><div class="chart">${ownerSvg}</div>
<h2>Top Actions</h2>
<table><thead><tr><th>Priority</th><th>Sprint</th><th>Lane</th><th>Owner</th><th>Item</th><th>Category</th><th>Competitors</th><th>Evidence</th><th>Next action</th></tr></thead><tbody>${topRows}</tbody></table>
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, "visibility-execution-backlog");
  await mkdir(outDir, { recursive: true });

  const survivorRows = await readCsv(path.join(benchmarkDir, "survivor-edit-tickets", "survivor-edit-ticket-index.csv"));
  const queryRows = await readCsv(path.join(benchmarkDir, "competitor-displacement-map", "query-displacement-actions.csv"));
  const lifecycleRows = await readCsv(path.join(benchmarkDir, "blog-lifecycle-map", "page-lifecycle-ledger.csv"));
  const productRows = await readCsv(path.join(benchmarkDir, "product-entity-coverage-plan", "product-entity-work-queue.csv"));
  const contentGapRows = await readCsv(path.join(benchmarkDir, "content-gap-briefs", "content-gap-briefs.csv"));
  const offsiteRows = await readCsv(path.join(benchmarkDir, "competitor-displacement-map", "contractor-offsite-asks.csv"));
  const sourceActionRows = await readCsv(path.join(benchmarkDir, "source-authority-roadmap", "source-authority-action-plan.csv"));
  const providerRetestRows = await readCsv(path.join(benchmarkDir, "provider-blindspots", "provider-retest-plan.csv"));
  const competitorData = await readJsonIfExists(path.join(benchmarkDir, "competitor-displacement-map", "competitor-displacement-data.json"), { summary: {} });
  const lifecycleData = await readJsonIfExists(path.join(benchmarkDir, "blog-lifecycle-map", "blog-lifecycle-data.json"), { summary: {} });
  const productData = await readJsonIfExists(path.join(benchmarkDir, "product-entity-coverage-plan", "product-entity-data.json"), { summary: {} });

  const backlog = buildBacklog({
    survivorRows,
    queryRows,
    lifecycleRows,
    productRows,
    contentGapRows,
    offsiteRows,
    sourceActionRows,
    providerRetestRows,
  });
  const summary = summarize(backlog, {
    competitor: competitorData.summary || {},
    lifecycle: lifecycleData.summary || {},
    product: productData.summary || {},
  });

  const laneSvg = barSvg(summary.laneRows, { title: "Execution backlog by work lane", labelKey: "lane", valueKey: "items", color: "#1d4ed8" });
  const sprintSvg = barSvg(summary.sprintRows, { title: "Execution backlog by sprint bucket", labelKey: "sprint", valueKey: "items", color: "#7c3aed" });
  const ownerSvg = barSvg(summary.ownerRows, { title: "Execution backlog by owner", labelKey: "owner", valueKey: "items", color: "#0f766e" });

  await writeFile(path.join(outDir, "backlog-by-lane.svg"), laneSvg);
  await writeFile(path.join(outDir, "backlog-by-sprint.svg"), sprintSvg);
  await writeFile(path.join(outDir, "backlog-by-owner.svg"), ownerSvg);
  await writeFile(path.join(outDir, "visibility-execution-backlog-data.json"), JSON.stringify({ summary, backlog }, null, 2));
  await writeFile(path.join(outDir, "integrated-execution-backlog.csv"), csv([
    ["priority", "sprint", "lane", "owner", "item", "target_url", "category", "competitors", "prompts", "products", "evidence", "next_action", "success_metric", "source"],
    ...backlog.map((row) => [row.priority, row.sprint, row.lane, row.owner, row.item, row.target_url, row.category, row.competitors, row.prompts, row.products, row.evidence, row.next_action, row.success_metric, row.source]),
  ]));
  await writeFile(path.join(outDir, "sprint-plan.csv"), csv([
    ["sprint", "items", "owners", "top_items"],
    ...summary.sprintRows.map((row) => [row.sprint, row.items, row.owners, row.top_items]),
  ]));
  await writeFile(path.join(outDir, "owner-handoff.csv"), csv([
    ["owner", "items", "lanes", "top_items"],
    ...summary.ownerRows.map((row) => [row.owner, row.items, row.lanes, row.top_items]),
  ]));
  await writeFile(path.join(outDir, "retest-checklist.csv"), csv([
    ["priority", "query", "target_url", "category", "competitors", "success_metric"],
    ...backlog.filter((row) => row.lane.includes("Retest") || row.prompts).slice(0, 80).map((row) => [row.priority, row.prompts || row.item, row.target_url, row.category, row.competitors, row.success_metric]),
  ]));
  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown({ summary, backlog }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({ summary, backlog, laneSvg, sprintSvg, ownerSvg }));

  console.log(`Wrote ${outDir}`);
  console.log(`Backlog items: ${summary.totalBacklogItems}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
