import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function hasArg(name) {
  return process.argv.includes(`--${name}`);
}

function csvCell(value) {
  if (Array.isArray(value)) value = value.join("; ");
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows, headers) {
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))].join("\n") + "\n";
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
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
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const headers = rows.shift() ?? [];
  return rows
    .filter((cells) => cells.some((value) => String(value ?? "").trim()))
    .map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

async function readCsv(filePath, fallback = []) {
  try {
    return parseCsv(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function latestDir(prefix) {
  const entries = await readdir(path.join(process.cwd(), OUTPUT_ROOT), { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort();
  return names.at(-1) ? path.join(process.cwd(), OUTPUT_ROOT, names.at(-1)) : "";
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value) {
  return normalize(value).replace(/\s+/g, "-").slice(0, 90);
}

function number(value) {
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function buyerIntentScore(query) {
  const text = normalize(query);
  let score = 0;
  if (/\bbest\b|\bwhich\b|\bwhat\b|\bhow\b/.test(text)) score += 18;
  if (/\bmount\b|\bholder\b|\bstand\b|\bplate\b|\bsystem\b|\bclamp\b|\bscanner\b|\bfish finder\b|\btablet\b|\bphone\b/.test(text)) score += 20;
  if (/\bfor\b|\bvs\b|\bcompare\b|\bcompatib|\bsetup\b|\binstall\b/.test(text)) score += 14;
  if (/\btruck\b|\bforklift\b|\bwarehouse\b|\brestaurant\b|\bdelivery\b|\bfleet\b|\bboat\b|\bkayak\b|\bstreaming\b|\bconstruction\b|\bpos\b|\beld\b/.test(text)) score += 18;
  return score;
}

function categoryFromText(value) {
  const text = normalize(value);
  if (/restaurant|pos|doordash|uber eats|grubhub|food truck|multi tablet/.test(text)) return "restaurant";
  if (/forklift|warehouse|barcode|scanner|zebra|honeywell|symbol/.test(text)) return "warehouse";
  if (/fish|boat|marine|kayak|pontoon|garmin|lowrance|humminbird|scotty|yakattack/.test(text)) return "fishing";
  if (/delivery|instacart|amazon flex|gig/.test(text)) return "delivery";
  if (/fleet|eld|semi|truck|construction|work truck|field service|vehicle/.test(text)) return "fleet";
  if (/amps|vesa|adapter|ball|socket|plate|modular/.test(text)) return "amps/modular";
  if (/stream|camera|creator|overhead|livestream|youtube|product photography/.test(text)) return "streaming";
  if (/school|bus|education|student/.test(text)) return "education";
  if (/tractor|farm|agriculture/.test(text)) return "agriculture";
  if (/jeep|offroad|utv|overland/.test(text)) return "offroad";
  return "general";
}

function findExistingPage(query, inventoryRows) {
  const q = normalize(query);
  if (!q) return null;
  const qTokens = new Set(q.split(" ").filter((token) => token.length > 2));
  let best = null;
  for (const article of inventoryRows) {
    const title = normalize(article.title);
    const url = article.live_url;
    if (!title) continue;
    let overlap = 0;
    for (const token of title.split(" ")) {
      if (qTokens.has(token)) overlap += 1;
    }
    const ratio = overlap / Math.max(1, qTokens.size);
    const exactBonus = title.includes(q) || q.includes(title) ? 0.5 : 0;
    const score = ratio + exactBonus;
    if (!best || score > best.score) best = { title: article.title, url, score };
  }
  return best && best.score >= 0.42 ? best : null;
}

function addCandidate(map, row) {
  const key = slug(row.query);
  if (!key) return;
  const current = map.get(key);
  if (!current) {
    map.set(key, {
      query: row.query,
      category: row.category || categoryFromText(row.query),
      source_types: new Set([row.source_type].filter(Boolean)),
      supporting_sources: new Set([row.supporting_source].filter(Boolean)),
      competitors: new Set(splitList(row.competitors)),
      existing_page_title: row.existing_page_title || "",
      existing_page_url: row.existing_page_url || "",
      recommended_action: row.recommended_action || "",
      reason: row.reason || "",
      score: number(row.score),
    });
    return;
  }
  current.score = Math.max(current.score, number(row.score));
  if (!current.category || current.category === "general") current.category = row.category || categoryFromText(row.query);
  if (!current.existing_page_url && row.existing_page_url) {
    current.existing_page_title = row.existing_page_title || "";
    current.existing_page_url = row.existing_page_url || "";
  }
  if (row.recommended_action && row.recommended_action.length > current.recommended_action.length) current.recommended_action = row.recommended_action;
  if (row.reason && row.reason.length > current.reason.length) current.reason = row.reason;
  if (row.source_type) current.source_types.add(row.source_type);
  if (row.supporting_source) current.supporting_sources.add(row.supporting_source);
  for (const competitor of splitList(row.competitors)) current.competitors.add(competitor);
}

function actionForCandidate(query, existingPage) {
  if (existingPage) return "refresh_existing_page";
  const text = normalize(query);
  if (/which brands are cited|cited for|vs|compare/.test(text)) return "comparison_or_source_page";
  if (/how to|setup|install/.test(text)) return "how_to_or_install_guide";
  if (/best|which|what/.test(text)) return "new_gap_driven_blog_or_solution_section";
  return "content_brief";
}

function buildCandidates({ benchmarkRows, actionRows, buyerQuestionRows, subjectRows, inventoryRows }) {
  const candidates = new Map();

  for (const row of benchmarkRows) {
    const query = row.query;
    if (!query) continue;
    const coverage = number(row.coverage_score);
    const absent = String(row.brand_mentioned).toLowerCase() === "false";
    const noCitation = String(row.domain_cited).toLowerCase() === "false";
    if (!absent && coverage > 25 && !noCitation) continue;
    const existing = findExistingPage(query, inventoryRows);
    const score = 45 + buyerIntentScore(query) + Math.max(0, 30 - coverage) + (absent ? 25 : 0) + (noCitation ? 8 : 0) + (existing ? 8 : 18);
    addCandidate(candidates, {
      query,
      category: row.category || categoryFromText(query),
      source_type: "ai_benchmark_gap",
      supporting_source: `provider=${row.provider}; model=${row.model}; score=${row.coverage_score}`,
      competitors: row.competitors,
      existing_page_title: existing?.title || "",
      existing_page_url: existing?.url || "",
      recommended_action: actionForCandidate(query, existing),
      reason: absent ? "AI answer did not mention iBOLT." : "AI answer is weak or does not cite iboltmounts.com.",
      score,
    });
  }

  for (const row of actionRows) {
    const losingQueries = splitList(row.losing_queries);
    const prompts = splitList(row.retest_prompts);
    for (const query of [...losingQueries, ...prompts]) {
      const existing = row.url ? { title: row.title, url: row.url } : findExistingPage(query, inventoryRows);
      const score = 35 + buyerIntentScore(query) + Math.min(35, number(row.priority) / 40) + (row.sprint === "Sprint 1" ? 18 : 0);
      addCandidate(candidates, {
        query,
        category: row.category || categoryFromText(query),
        source_type: "all_blog_action_queue",
        supporting_source: `page=${row.title}; rank=${row.rank}; sprint=${row.sprint}`,
        competitors: row.competitors,
        existing_page_title: existing?.title || "",
        existing_page_url: existing?.url || "",
        recommended_action: "refresh_existing_page",
        reason: row.top_fix || "Query appears in retest or losing-query queue.",
        score,
      });
    }
  }

  for (const row of buyerQuestionRows) {
    const content = String(row.content || "");
    const match = content.match(/(?:question|Question):\s*(.+)$/i);
    const query = (match?.[1] || content).replace(/[.?]\s*$/, "");
    if (!query) continue;
    const existing = findExistingPage(query, inventoryRows);
    addCandidate(candidates, {
      query,
      category: categoryFromText(`${row.vertical_name} ${query}`),
      source_type: "context_bank_buyer_question",
      supporting_source: row.source_url || row.vertical_slug,
      competitors: "",
      existing_page_title: existing?.title || "",
      existing_page_url: existing?.url || "",
      recommended_action: actionForCandidate(query, existing),
      reason: "Source-backed buyer question from the enriched context bank.",
      score: 42 + buyerIntentScore(query) + (existing ? 4 : 16),
    });
  }

  for (const row of subjectRows) {
    const count = number(row.count);
    const published = number(row.published);
    if (published > 3 && count > 5) continue;
    const subject = String(row.subject || "").replace(/-/g, " ");
    if (!subject) continue;
    const query = `best ${subject} mounting solution`;
    const existing = findExistingPage(query, inventoryRows);
    addCandidate(candidates, {
      query,
      category: categoryFromText(subject),
      source_type: "thin_vertical_coverage",
      supporting_source: `subject=${row.subject}; published=${published}; total=${count}`,
      competitors: "",
      existing_page_title: existing?.title || "",
      existing_page_url: existing?.url || "",
      recommended_action: existing ? "refresh_existing_page" : "new_gap_driven_blog_or_solution_section",
      reason: "Live blog coverage is thin relative to newer vertical map.",
      score: 58 + Math.max(0, 4 - published) * 8 + buyerIntentScore(query),
    });
  }

  return [...candidates.values()]
    .map((candidate) => ({
      ...candidate,
      source_types: [...candidate.source_types].join("; "),
      supporting_sources: [...candidate.supporting_sources].slice(0, 5).join("; "),
      competitors: [...candidate.competitors].join("; "),
      score: Math.round(candidate.score),
    }))
    .sort((a, b) => b.score - a.score || a.query.localeCompare(b.query));
}

function buildTopRefreshRows(actionRows, inventoryRows) {
  const inventoryByUrl = new Map(inventoryRows.map((row) => [row.live_url, row]));
  return actionRows
    .map((row) => {
      const inventory = inventoryByUrl.get(row.url) || {};
      const priority = number(row.priority);
      const productLinks = number(inventory.product_links);
      const addToCartLinks = number(inventory.add_to_cart_links);
      const imageCount = number(inventory.image_count);
      const currentStructurePenalty = (productLinks === 0 ? 20 : 0) + (imageCount === 0 ? 12 : 0) + (addToCartLinks > 6 ? 8 : 0);
      const baseline_score = priority + currentStructurePenalty;
      return {
        rank: row.rank,
        baseline_score: Math.round(baseline_score),
        priority,
        title: row.title,
        url: row.url,
        category: row.category,
        sprint: row.sprint,
        top_fix: row.top_fix,
        losing_queries: row.losing_queries,
        competitors: row.competitors,
        products_to_feature: row.products_to_feature,
        immediate_action: row.immediate_action,
        release_gate: row.release_gate,
        article_id: inventory.article_id || "",
        published_at: inventory.published_at || "",
        updated_at: inventory.updated_at || "",
        product_links: inventory.product_links || "",
        add_to_cart_links: inventory.add_to_cart_links || "",
        image_count: inventory.image_count || "",
        body_chars: inventory.body_chars || "",
        analytics_sessions: "",
        analytics_add_to_cart: "",
        analytics_checkouts: "",
        analytics_revenue: "",
        analytics_note: "Not available unless Shopify report export/API read_reports/GSC/GA4 data is supplied.",
      };
    })
    .sort((a, b) => b.baseline_score - a.baseline_score || number(a.rank) - number(b.rank))
    .slice(0, 10);
}

function buildBaselineRows(refreshRows) {
  const capturedAt = new Date().toISOString();
  return refreshRows.map((row) => ({
    captured_at: capturedAt,
    page_title: row.title,
    page_url: row.url,
    article_id: row.article_id,
    category: row.category,
    published_at: row.published_at,
    updated_at: row.updated_at,
    product_links: row.product_links,
    add_to_cart_links: row.add_to_cart_links,
    image_count: row.image_count,
    body_chars: row.body_chars,
    benchmark_priority: row.priority,
    top_fix: row.top_fix,
    losing_queries: row.losing_queries,
    analytics_sessions: row.analytics_sessions,
    analytics_add_to_cart: row.analytics_add_to_cart,
    analytics_checkouts: row.analytics_checkouts,
    analytics_revenue: row.analytics_revenue,
    measurement_status: row.analytics_note,
  }));
}

function markdownTable(rows, headers) {
  const visible = rows.map((row) => headers.map((header) => String(row[header] ?? "")));
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...visible.map((cells) => `| ${cells.map((cell) => cell.replace(/\|/g, "\\|")).join(" | ")} |`),
  ].join("\n");
}

async function main() {
  const benchmarkDir = argValue("benchmark-dir") || (await latestDir("openrouter-expanded-ai-benchmark-")) || (await latestDir("openrouter-ai-benchmark-"));
  const actionDir = argValue("action-dir") || path.join(process.cwd(), OUTPUT_ROOT, "openrouter-ai-benchmark-2026-06-17-17-11-06", "all-blog-action-control-sheet");
  const shopifyDir = argValue("shopify-dir") || (await latestDir("shopify-blog-inventory-refresh-"));
  const contextDir = argValue("context-dir") || (await latestDir("category-bank-enrichment-"));
  const subjectDir = argValue("subject-dir") || (await latestDir("blog-topic-subject-audit-"));
  const outDir =
    argValue("out-dir") ||
    path.join(process.cwd(), OUTPUT_ROOT, `unanswered-question-scanner-${new Date().toISOString().slice(0, 10)}`);

  if (!benchmarkDir) throw new Error("No benchmark directory found.");
  if (!shopifyDir) throw new Error("No Shopify inventory directory found.");

  await mkdir(outDir, { recursive: true });

  const benchmarkRows = await readCsv(path.join(benchmarkDir, "results.csv"));
  const actionRows = await readCsv(path.join(actionDir, "all-blog-action-control-sheet.csv"));
  const inventoryRows = await readCsv(path.join(shopifyDir, "shopify-blog-article-inventory.csv"));
  const buyerQuestionRows = await readCsv(path.join(contextDir, "buyer-questions.csv"));
  const subjectRows = await readCsv(path.join(subjectDir, "subject-counts.csv"));

  const candidates = buildCandidates({ benchmarkRows, actionRows, buyerQuestionRows, subjectRows, inventoryRows });
  const topRefreshRows = buildTopRefreshRows(actionRows, inventoryRows);
  const baselineRows = buildBaselineRows(topRefreshRows);

  const inputs = {
    generatedAt: new Date().toISOString(),
    benchmarkDir,
    actionDir,
    shopifyDir,
    contextDir,
    subjectDir,
    benchmarkRows: benchmarkRows.length,
    actionRows: actionRows.length,
    inventoryRows: inventoryRows.length,
    buyerQuestionRows: buyerQuestionRows.length,
    subjectRows: subjectRows.length,
    analyticsStatus: hasArg("analytics-csv")
      ? "external analytics CSV path supplied, but this first version records structural baseline only"
      : "analytics not supplied; Shopify API/UI access required for sessions, add-to-cart, checkout, and revenue",
  };

  await writeFile(path.join(outDir, "inputs-manifest.json"), JSON.stringify(inputs, null, 2));
  await writeFile(path.join(outDir, "unanswered-question-candidates.json"), JSON.stringify(candidates, null, 2));
  await writeFile(
    path.join(outDir, "unanswered-question-candidates.csv"),
    toCsv(candidates, [
      "score",
      "query",
      "category",
      "recommended_action",
      "existing_page_title",
      "existing_page_url",
      "source_types",
      "competitors",
      "reason",
      "supporting_sources",
    ]),
  );
  await writeFile(path.join(outDir, "top-10-refresh-candidates.json"), JSON.stringify(topRefreshRows, null, 2));
  await writeFile(
    path.join(outDir, "top-10-refresh-candidates.csv"),
    toCsv(topRefreshRows, [
      "rank",
      "baseline_score",
      "priority",
      "title",
      "url",
      "category",
      "sprint",
      "top_fix",
      "losing_queries",
      "competitors",
      "products_to_feature",
      "immediate_action",
      "article_id",
      "published_at",
      "updated_at",
      "product_links",
      "add_to_cart_links",
      "image_count",
      "body_chars",
      "analytics_note",
    ]),
  );
  await writeFile(path.join(outDir, "baseline-performance-snapshot.json"), JSON.stringify(baselineRows, null, 2));
  await writeFile(
    path.join(outDir, "baseline-performance-snapshot.csv"),
    toCsv(baselineRows, [
      "captured_at",
      "page_title",
      "page_url",
      "article_id",
      "category",
      "published_at",
      "updated_at",
      "product_links",
      "add_to_cart_links",
      "image_count",
      "body_chars",
      "benchmark_priority",
      "top_fix",
      "losing_queries",
      "analytics_sessions",
      "analytics_add_to_cart",
      "analytics_checkouts",
      "analytics_revenue",
      "measurement_status",
    ]),
  );

  const report = `# iBOLT Unanswered Question Scanner

Generated: ${inputs.generatedAt}

## What This Does

This scanner turns benchmark misses, page refresh queues, enriched buyer questions, and thin vertical coverage into a repeatable content backlog. It also records a safe baseline for the top refresh pages so later edits can be compared against the current state.

## Inputs

- Benchmark rows: ${inputs.benchmarkRows}
- Blog action rows: ${inputs.actionRows}
- Shopify inventory rows: ${inputs.inventoryRows}
- Buyer-question rows: ${inputs.buyerQuestionRows}
- Subject coverage rows: ${inputs.subjectRows}
- Analytics status: ${inputs.analyticsStatus}

## Top 10 Pages To Refresh First

${markdownTable(topRefreshRows.slice(0, 10), ["rank", "title", "category", "top_fix", "losing_queries"])}

## Top 15 Unanswered Or Weakly Answered Questions

${markdownTable(candidates.slice(0, 15), ["score", "query", "category", "recommended_action", "existing_page_title"])}

## A/B Baseline Note

The baseline files in this folder intentionally preserve the current article IDs, URLs, product-link counts, add-to-cart link counts, image counts, body size, benchmark priority, and known AI query gaps before edits. Traffic, add-to-cart, checkout, and revenue fields are left blank unless a Shopify/GSC/GA4 export is supplied, because the current Shopify content token does not expose report analytics.

## Output Files

- unanswered-question-candidates.csv
- unanswered-question-candidates.json
- top-10-refresh-candidates.csv
- top-10-refresh-candidates.json
- baseline-performance-snapshot.csv
- baseline-performance-snapshot.json
- inputs-manifest.json
`;

  await writeFile(path.join(outDir, "REPORT.md"), report);
  await writeFile(path.join(outDir, "REPORT.html"), `<pre>${htmlEscape(report)}</pre>`);

  console.log(`Wrote scanner output to ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
