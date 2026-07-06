#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";
const REPORT_DIR = "product-conversion-visibility-bridge";

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
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted && char === '"' && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => String(value ?? "").trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell.length || row.length) row.push(cell);
  if (row.length && row.some((value) => String(value ?? "").trim())) rows.push(row);
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

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function latestDir(prefix) {
  const root = path.join(process.cwd(), OUTPUT_ROOT);
  const entries = await readdir(root, { withFileTypes: true });
  const name = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  if (!name) throw new Error(`No ${prefix} directory found in ${OUTPUT_ROOT}.`);
  return path.join(root, name);
}

function num(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/[%,$]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value, min = 0, max = 1000) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
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

function keyForUrl(value) {
  return String(value ?? "").replace(/\/+$/, "").toLowerCase();
}

function byUrl(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = keyForUrl(row.url || row.page_url || row.pageUrl);
    if (key && !map.has(key)) map.set(key, row);
  }
  return map;
}

function short(value, length = 120) {
  const text = String(value ?? "");
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function top(rows, key, count = 10) {
  return [...rows]
    .sort((a, b) => num(b[key]) - num(a[key]) || String(a.title || a.category || a.family).localeCompare(String(b.title || b.category || b.family)))
    .slice(0, count);
}

function addCounter(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function firstCounterItems(map, count = 5) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, count)
    .map(([label, value]) => `${label} ${value}`);
}

function hasCtaRisk(...values) {
  return values.some((value) => /too many cart|repeated cart|cta cleanup|reduce repeated cart|button clusters|add-to-cart buttons after every/i.test(String(value ?? "")));
}

function hasSchemaRisk(...values) {
  return values.some((value) => /faq schema|article\/blogposting schema|schema/i.test(String(value ?? "")));
}

function hasComparisonRisk(...values) {
  return values.some((value) => /comparison|competitor|tradeoff/i.test(String(value ?? "")));
}

function hasQuickAnswerRisk(...values) {
  return values.some((value) => /quick answer|answer-first|missing early quick/i.test(String(value ?? "")));
}

function buildPageBridge({ conversionRows, commandRows, bodyRows, promptIntentRows }) {
  const commandByUrl = byUrl(commandRows);
  const bodyByUrl = byUrl(bodyRows);
  const intentByPage = new Map();
  for (const row of promptIntentRows) {
    const key = keyForUrl(row.url);
    if (!key) continue;
    if (!intentByPage.has(key)) intentByPage.set(key, new Map());
    addCounter(intentByPage.get(key), row.intent || "unknown", 1);
  }

  return conversionRows
    .map((row) => {
      const key = keyForUrl(row.url);
      const command = commandByUrl.get(key) || {};
      const body = bodyByUrl.get(key) || {};
      const issueText = [
        row.missing_fixes,
        command.issues,
        command.command_summary,
        body.issues,
      ].join("; ");
      const ctaRisk =
        hasCtaRisk(issueText)
        || /too many inline product opportunities/i.test(row.cta_button_guidance || "")
        || num(body.cartLinks) >= 5
        || num(body.addToCartDensity) >= 5;
      const schemaRisk = hasSchemaRisk(issueText, command.schema_command) || body.hasFaqSchema === false || body.hasArticleSchema === false;
      const comparisonRisk = hasComparisonRisk(issueText, command.comparison_command);
      const quickAnswerRisk = hasQuickAnswerRisk(issueText, command.quick_answer_command) || body.quickAnswerNearTop === false;
      const productCount = splitList(row.products_to_feature || command.products || body.products).length;
      const intentCounter = intentByPage.get(key) || new Map();
      const score = clamp(
        num(row.priority_score)
          + num(row.ai_pressure_score) * 0.35
          + num(row.commercial_intent_score) * 0.2
          + num(row.product_depth_score) * 0.15
          + (ctaRisk ? 12 : 0)
          + (productCount ? 10 : 0)
          + num(row.competitor_only_answers) * 8,
        0,
        999,
      );
      const action =
        ctaRisk && num(row.ai_pressure_score) >= 80
          ? "Clean CTA density, add one product module, then retest inclusion"
          : num(row.competitor_only_answers) > 0
            ? "Add answer-first comparison and product proof before citation push"
            : schemaRisk
              ? "Make page source-ready with schema and stable product links"
              : "Protect product path and monitor after retest";

      return {
        bridge_score: score,
        page_priority_score: num(row.priority_score),
        conversion_tier: row.conversion_tier || command.sprint || "",
        title: row.title,
        url: row.url,
        category: row.category,
        commercial_intent_score: num(row.commercial_intent_score),
        ai_pressure_score: num(row.ai_pressure_score),
        product_depth_score: num(row.product_depth_score),
        conversion_readiness_score: num(row.conversion_readiness_score),
        citation_fix_score: num(row.citation_fix_score),
        zero_mention_queries: num(row.zero_mention_queries),
        competitor_only_answers: num(row.competitor_only_answers),
        competitors: row.competitors || command.competitors || "",
        products_to_feature: row.products_to_feature || command.products || "",
        retest_prompts: row.retest_prompts || command.retest_prompts || "",
        prompt_intents: firstCounterItems(intentCounter, 4).join("; "),
        cta_risk: ctaRisk ? "yes" : "no",
        schema_risk: schemaRisk ? "yes" : "no",
        comparison_risk: comparisonRisk ? "yes" : "no",
        quick_answer_risk: quickAnswerRisk ? "yes" : "no",
        cart_links: num(body.cartLinks),
        product_links: num(body.productLinks || row.product_links),
        product_module_action: command.product_path_command || row.checkout_action || "",
        cta_action: command.cta_command || row.cta_button_guidance || "",
        next_action: action,
      };
    })
    .sort((a, b) => b.bridge_score - a.bridge_score || b.page_priority_score - a.page_priority_score);
}

function buildCategoryBridge({ pageBridge, categoryRows, intentCategoryRows }) {
  const categoryMap = new Map();
  for (const row of pageBridge) {
    const category = row.category || "unknown";
    if (!categoryMap.has(category)) {
      categoryMap.set(category, {
        category,
        pages: 0,
        sprint_pages: 0,
        total_bridge_score: 0,
        avg_bridge_score: 0,
        ai_pressure_score: 0,
        competitor_only_answers: 0,
        zero_mention_queries: 0,
        cta_cleanup_pages: 0,
        schema_pages: 0,
        comparison_pages: 0,
        quick_answer_pages: 0,
        product_module_pages: 0,
        top_pages: [],
        competitors: new Map(),
        intents: new Map(),
      });
    }
    const categoryRow = categoryMap.get(category);
    categoryRow.pages += 1;
    if (/sprint/i.test(row.conversion_tier)) categoryRow.sprint_pages += 1;
    categoryRow.total_bridge_score += num(row.bridge_score);
    categoryRow.ai_pressure_score += num(row.ai_pressure_score);
    categoryRow.competitor_only_answers += num(row.competitor_only_answers);
    categoryRow.zero_mention_queries += num(row.zero_mention_queries);
    if (row.cta_risk === "yes") categoryRow.cta_cleanup_pages += 1;
    if (row.schema_risk === "yes") categoryRow.schema_pages += 1;
    if (row.comparison_risk === "yes") categoryRow.comparison_pages += 1;
    if (row.quick_answer_risk === "yes") categoryRow.quick_answer_pages += 1;
    if (row.products_to_feature) categoryRow.product_module_pages += 1;
    categoryRow.top_pages.push({ title: row.title, score: row.bridge_score });
    for (const competitor of splitList(row.competitors)) addCounter(categoryRow.competitors, competitor);
    for (const intent of splitList(row.prompt_intents).map((item) => item.replace(/\s+\d+$/, ""))) addCounter(categoryRow.intents, intent);
  }

  const providerByCategory = new Map(categoryRows.map((row) => [row.category, row]));
  for (const row of intentCategoryRows) {
    const category = row.category || "unknown";
    if (!categoryMap.has(category)) continue;
    addCounter(categoryMap.get(category).intents, row.intent, num(row.competitorOnlyAnswers || row.competitor_only_answers || 1) || 1);
  }

  return [...categoryMap.values()]
    .map((row) => {
      const provider = providerByCategory.get(row.category) || {};
      const mainMove = provider.mainMove || provider.main_move || "";
      return {
        category: row.category,
        bridge_priority: clamp(row.total_bridge_score + num(provider.priorityScore || provider.priority_score) * 1.2, 0, 9999),
        pages: row.pages,
        sprint_pages: row.sprint_pages,
        avg_bridge_score: clamp(row.total_bridge_score / Math.max(1, row.pages)),
        ai_pressure_score: clamp(row.ai_pressure_score / Math.max(1, row.pages)),
        competitor_only_answers: row.competitor_only_answers,
        zero_mention_queries: row.zero_mention_queries,
        cta_cleanup_pages: row.cta_cleanup_pages,
        schema_pages: row.schema_pages,
        comparison_pages: row.comparison_pages,
        quick_answer_pages: row.quick_answer_pages,
        product_module_pages: row.product_module_pages,
        provider_miss_score: num(provider.priorityScore || provider.priority_score),
        top_competitors: firstCounterItems(row.competitors, 5).join("; ") || provider.topCompetitors || provider.top_competitors || "",
        top_intents: firstCounterItems(row.intents, 4).join("; "),
        top_pages: row.top_pages
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map((item) => item.title)
          .join("; "),
        main_move: mainMove || "Pair answer-first copy with one clean product module and retest.",
      };
    })
    .sort((a, b) => b.bridge_priority - a.bridge_priority);
}

function buildFamilyBridge({ familyRows, productFamilyRows, pageBridge }) {
  const pageTextByCategory = new Map();
  for (const row of pageBridge) {
    if (!pageTextByCategory.has(row.category)) pageTextByCategory.set(row.category, []);
    pageTextByCategory.get(row.category).push(row);
  }

  const merged = new Map();
  for (const row of [...familyRows, ...productFamilyRows]) {
    const family = row.family;
    if (!family) continue;
    if (!merged.has(family)) {
      merged.set(family, {
        family,
        priority: 0,
        unlinked_products: 0,
        topics: new Set(),
        sample_products: new Set(),
        target_pages: new Set(),
        action: new Set(),
      });
    }
    const item = merged.get(family);
    item.priority = Math.max(item.priority, num(row.priority));
    item.unlinked_products = Math.max(item.unlinked_products, num(row.unlinked_products));
    for (const topic of splitList(row.topics)) item.topics.add(topic.replace(/\s+\d+$/, ""));
    for (const product of splitList(row.sample_products)) item.sample_products.add(product);
    for (const target of splitList(row.target_pages)) item.target_pages.add(target.replace(/\s+\d+$/, ""));
    if (row.action) item.action.add(row.action);
  }

  return [...merged.values()]
    .map((row) => {
      const matchingPages = [];
      for (const topic of row.topics) {
        for (const page of pageTextByCategory.get(topic) || []) matchingPages.push(page);
      }
      const topPages = unique([...matchingPages.sort((a, b) => b.bridge_score - a.bridge_score).map((page) => page.title), ...row.target_pages]).slice(0, 5);
      const ctaRiskPages = matchingPages.filter((page) => page.cta_risk === "yes").length;
      const competitorOnly = matchingPages.reduce((sum, page) => sum + num(page.competitor_only_answers), 0);
      const bridgePriority = clamp(row.priority + row.unlinked_products * 4 + competitorOnly * 10 + ctaRiskPages * 3, 0, 9999);
      return {
        bridge_priority: bridgePriority,
        family: row.family,
        unlinked_products: row.unlinked_products,
        topics: [...row.topics].join("; "),
        sample_products: [...row.sample_products].slice(0, 6).join("; "),
        target_pages: topPages.join("; "),
        cta_risk_pages: ctaRiskPages,
        competitor_only_answers: competitorOnly,
        action: [...row.action].slice(0, 2).join("; ") || "Add product modules to the pages where this family answers the buyer query.",
      };
    })
    .sort((a, b) => b.bridge_priority - a.bridge_priority);
}

function buildCheckoutQueue(pageBridge) {
  return pageBridge
    .filter((row) => row.cta_risk === "yes" || row.bridge_score >= 95 || row.competitor_only_answers > 0)
    .slice(0, 75)
    .map((row, index) => ({
      rank: index + 1,
      bridge_score: row.bridge_score,
      page: row.title,
      url: row.url,
      category: row.category,
      tier: row.conversion_tier,
      cta_risk: row.cta_risk,
      cart_links: row.cart_links,
      product_links: row.product_links,
      competitors: row.competitors,
      products_to_feature: row.products_to_feature,
      cta_action: row.cta_action,
      product_module_action: row.product_module_action,
      retest_prompts: row.retest_prompts,
    }));
}

function barSvg({ title, rows, labelKey, valueKey, color = "#0f766e", maxRows = 10 }) {
  const chartRows = rows.slice(0, maxRows);
  const width = 940;
  const rowHeight = 36;
  const height = 76 + chartRows.length * rowHeight;
  const max = Math.max(1, ...chartRows.map((row) => num(row[valueKey])));
  const bars = chartRows.map((row, index) => {
    const y = 58 + index * rowHeight;
    const barWidth = Math.max(2, Math.round((num(row[valueKey]) / max) * 520));
    return `<g>
      <text x="22" y="${y + 17}" fill="#111827" font-size="13" font-weight="800">${escapeHtml(short(row[labelKey], 42))}</text>
      <rect x="322" y="${y}" width="520" height="22" rx="11" fill="#e5e7eb"/>
      <rect x="322" y="${y}" width="${barWidth}" height="22" rx="11" fill="${color}"/>
      <text x="905" y="${y + 16}" fill="#111827" font-size="13" font-weight="900" text-anchor="end">${escapeHtml(row[valueKey])}</text>
    </g>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#ffffff"/>
    <text x="22" y="34" fill="#111827" font-size="20" font-weight="900">${escapeHtml(title)}</text>
    ${bars}
  </svg>`;
}

function table(rows, columns) {
  const head = columns.map(([label]) => `<th>${escapeHtml(label)}</th>`).join("");
  const body = rows.map((row) => `<tr>${columns.map(([, key]) => `<td>${escapeHtml(row[key])}</td>`).join("")}</tr>`).join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function markdownTable(rows, columns) {
  return [
    `| ${columns.map(([label]) => label).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${columns.map(([, key]) => String(row[key] ?? "").replaceAll("|", "\\|")).join(" | ")} |`),
  ].join("\n");
}

function buildMarkdown({ summary, pageBridge, categoryBridge, familyBridge, checkoutQueue }) {
  return `# Product Conversion Visibility Bridge

## Bottom Line

The benchmark problem is not only "can AI mention iBOLT?" It is whether high-intent AI answers land on pages that clearly name the right products and give the buyer a clean next step. This bridge connects AI losses, competitor pressure, product modules, and checkout CTA cleanup.

Current read: ${summary.competitorReplacementPages} pages have competitor-replacement pressure, ${summary.ctaRiskPages} pages need CTA-density cleanup, and ${summary.productModulePages} pages already have product-module opportunities. The first lift should come from answer-first copy plus cleaner product cards, not repeated add-to-cart button clusters.

## Key Metrics

- Pages bridged: ${summary.pagesBridged}
- Sprint 1 or Sprint 2 pages: ${summary.sprintPages}
- Competitor-replacement pressure pages: ${summary.competitorReplacementPages}
- CTA cleanup pages: ${summary.ctaRiskPages}
- Product module opportunity pages: ${summary.productModulePages}
- Quick-answer pages to fix: ${summary.quickAnswerPages}
- Schema/source pages to fix: ${summary.schemaPages}
- Top categories: ${summary.topCategories.join("; ")}
- Top product families: ${summary.topFamilies.join("; ")}

## First Pages To Fix

${markdownTable(top(pageBridge, "bridge_score", 12), [
  ["Score", "bridge_score"],
  ["Tier", "conversion_tier"],
  ["Page", "title"],
  ["Category", "category"],
  ["CTA risk", "cta_risk"],
  ["Competitors", "competitors"],
  ["Next action", "next_action"],
])}

## Category Bridge

${markdownTable(top(categoryBridge, "bridge_priority", 10), [
  ["Priority", "bridge_priority"],
  ["Category", "category"],
  ["Pages", "pages"],
  ["CTA pages", "cta_cleanup_pages"],
  ["Competitors", "top_competitors"],
  ["Intents", "top_intents"],
  ["Move", "main_move"],
])}

## Product Families

${markdownTable(top(familyBridge, "bridge_priority", 10), [
  ["Priority", "bridge_priority"],
  ["Family", "family"],
  ["Unlinked", "unlinked_products"],
  ["Topics", "topics"],
  ["Target pages", "target_pages"],
  ["Action", "action"],
])}

## Checkout Risk Queue

${markdownTable(checkoutQueue.slice(0, 15), [
  ["Rank", "rank"],
  ["Score", "bridge_score"],
  ["Page", "page"],
  ["Category", "category"],
  ["CTA risk", "cta_risk"],
  ["Products", "products_to_feature"],
  ["CTA action", "cta_action"],
])}
`;
}

function buildHtml({ summary, pageBridge, categoryBridge, familyBridge, checkoutQueue, charts }) {
  const cards = [
    ["Pages bridged", summary.pagesBridged, "blog pages with AI, product, and conversion signals"],
    ["Competitor pressure", summary.competitorReplacementPages, "pages tied to replacement answers"],
    ["CTA cleanup", summary.ctaRiskPages, "pages with repeated cart/button risk"],
    ["Product modules", summary.productModulePages, "pages with product-module opportunity"],
    ["Quick answers", summary.quickAnswerPages, "pages needing answer-first copy"],
    ["Schema/source", summary.schemaPages, "pages needing source-ready cleanup"],
  ].map(([label, value, note]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Product Conversion Visibility Bridge</title>
<style>
body{margin:0;background:#f6f8fb;color:#111827;font-family:Arial,Helvetica,sans-serif}main{max-width:1240px;margin:0 auto;padding:34px 24px 64px}h1{font-size:36px;margin:0 0 8px;letter-spacing:0}h2{font-size:23px;margin:34px 0 12px}p,li{line-height:1.55;color:#334155;font-size:15px}.note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #0f766e;border-radius:12px;padding:16px 18px;margin:20px 0}.warn{border-left-color:#f97316}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:16px}.label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:900}.value{font-size:30px;font-weight:900;margin:8px 0;color:#0f172a}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}.chart{background:#fff;border:1px solid #dbe3ef;border-radius:18px;padding:10px;overflow:auto}.chart svg{width:100%;height:auto;display:block}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 22px}th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}a{color:#0f766e;overflow-wrap:anywhere}@media(max-width:900px){.cards,.grid{grid-template-columns:1fr}h1{font-size:30px}}
</style></head><body><main>
<h1>Product Conversion Visibility Bridge</h1>
<p>This connects the AI visibility problem to product coverage and checkout behavior. It is meant to answer: if we win more AI mentions, which pages are ready to convert that attention into product clicks and carts?</p>
<div class="note"><strong>Bottom line:</strong> iBOLT should keep pushing citation rate, but the faster revenue path is answer-first copy plus clean product modules on high-intent pages. ${summary.ctaRiskPages} pages still need CTA-density cleanup, so product cards should use restrained View Product CTAs before adding more cart buttons.</div>
<section class="cards">${cards}</section>
<section class="grid"><div class="chart">${charts.categories}</div><div class="chart">${charts.families}</div></section>
<h2>First Pages To Fix</h2>
${table(top(pageBridge, "bridge_score", 14), [
  ["Score", "bridge_score"],
  ["Tier", "conversion_tier"],
  ["Page", "title"],
  ["Category", "category"],
  ["CTA risk", "cta_risk"],
  ["Products", "products_to_feature"],
  ["Next action", "next_action"],
])}
<h2>Category Bridge</h2>
${table(top(categoryBridge, "bridge_priority", 12), [
  ["Priority", "bridge_priority"],
  ["Category", "category"],
  ["Pages", "pages"],
  ["CTA pages", "cta_cleanup_pages"],
  ["Schema pages", "schema_pages"],
  ["Top competitors", "top_competitors"],
  ["Top intents", "top_intents"],
  ["Move", "main_move"],
])}
<h2>Product Family Bridge</h2>
${table(top(familyBridge, "bridge_priority", 10), [
  ["Priority", "bridge_priority"],
  ["Family", "family"],
  ["Unlinked", "unlinked_products"],
  ["Topics", "topics"],
  ["Target pages", "target_pages"],
  ["Action", "action"],
])}
<h2>Checkout Risk Queue</h2>
${table(checkoutQueue.slice(0, 20), [
  ["Rank", "rank"],
  ["Score", "bridge_score"],
  ["Page", "page"],
  ["Category", "category"],
  ["CTA risk", "cta_risk"],
  ["Products", "products_to_feature"],
  ["CTA action", "cta_action"],
])}
</main></body></html>`;
}

async function main() {
  const benchmarkDir = process.argv[2] ? path.resolve(process.argv[2]) : await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, REPORT_DIR);
  await mkdir(outDir, { recursive: true });

  const conversion = await readJson(path.join(benchmarkDir, "blog-conversion-opportunity-map", "blog-conversion-opportunity-data.json"), {});
  const productEntity = await readJson(path.join(benchmarkDir, "product-entity-coverage-plan", "product-entity-data.json"), {});
  const promptIntent = await readJson(path.join(benchmarkDir, "prompt-intent-loss-report", "prompt-intent-loss-data.json"), {});
  const categoryProvider = await readJson(path.join(benchmarkDir, "category-provider-priority-report", "category-provider-priority-data.json"), {});
  const pageCommandData = await readJson(path.join(benchmarkDir, "page-edit-command-matrix", "page-edit-command-data.json"), {});
  const bodyData = await readJson(path.join(benchmarkDir, "blog-body-inspection", "blog-body-inspection-data.json"), {});

  const commandRows = pageCommandData.rows?.length
    ? pageCommandData.rows
    : await readCsv(path.join(benchmarkDir, "page-edit-command-matrix", "page-edit-command-matrix.csv"));
  const bodyRows = bodyData.rows || [];
  const pageBridge = buildPageBridge({
    conversionRows: conversion.pageRows || [],
    commandRows,
    bodyRows,
    promptIntentRows: promptIntent.retestRows || [],
  });
  const categoryBridge = buildCategoryBridge({
    pageBridge,
    categoryRows: categoryProvider.categoryRows || [],
    intentCategoryRows: promptIntent.intentCategoryRows || [],
  });
  const familyBridge = buildFamilyBridge({
    familyRows: conversion.familyRows || [],
    productFamilyRows: productEntity.familyRows || [],
    pageBridge,
  });
  const checkoutQueue = buildCheckoutQueue(pageBridge);

  const categoryCounter = new Map();
  for (const row of categoryBridge) addCounter(categoryCounter, row.category, row.bridge_priority);
  const familyCounter = new Map();
  for (const row of familyBridge) addCounter(familyCounter, row.family, row.bridge_priority);

  const summary = {
    generatedAt: new Date().toISOString(),
    benchmarkDir,
    pagesBridged: pageBridge.length,
    sprintPages: pageBridge.filter((row) => /sprint/i.test(row.conversion_tier)).length,
    competitorReplacementPages: pageBridge.filter((row) => row.competitor_only_answers > 0).length,
    ctaRiskPages: pageBridge.filter((row) => row.cta_risk === "yes").length,
    productModulePages: pageBridge.filter((row) => row.products_to_feature).length,
    quickAnswerPages: pageBridge.filter((row) => row.quick_answer_risk === "yes").length,
    schemaPages: pageBridge.filter((row) => row.schema_risk === "yes").length,
    comparisonPages: pageBridge.filter((row) => row.comparison_risk === "yes").length,
    checkoutQueueRows: checkoutQueue.length,
    categoryRows: categoryBridge.length,
    familyRows: familyBridge.length,
    mentionRate: categoryProvider.summary?.mentionRate ?? 24,
    nonBrandedMentionRate: categoryProvider.summary?.nonBrandedMentionRate ?? 5,
    citationRate: categoryProvider.summary?.citationRate ?? 0,
    topCategories: firstCounterItems(categoryCounter, 6),
    topFamilies: firstCounterItems(familyCounter, 6),
    topPages: pageBridge.slice(0, 8).map((row) => `${row.title} ${row.bridge_score}`),
  };

  const charts = {
    categories: barSvg({ title: "AI To Checkout Priority By Category", rows: categoryBridge, labelKey: "category", valueKey: "bridge_priority", color: "#0f766e" }),
    families: barSvg({ title: "Product Family Visibility Bridge", rows: familyBridge, labelKey: "family", valueKey: "bridge_priority", color: "#2563eb" }),
  };

  await writeFile(path.join(outDir, "category-conversion-bridge.svg"), charts.categories);
  await writeFile(path.join(outDir, "product-family-visibility-bridge.svg"), charts.families);
  await writeFile(path.join(outDir, "product-conversion-visibility-data.json"), `${JSON.stringify({
    summary,
    pageBridge,
    categoryBridge,
    familyBridge,
    checkoutQueue,
  }, null, 2)}\n`);
  await writeFile(path.join(outDir, "conversion-page-action-bridge.csv"), csv([
    [
      "bridge_score",
      "page_priority_score",
      "conversion_tier",
      "title",
      "url",
      "category",
      "commercial_intent_score",
      "ai_pressure_score",
      "product_depth_score",
      "conversion_readiness_score",
      "citation_fix_score",
      "zero_mention_queries",
      "competitor_only_answers",
      "competitors",
      "products_to_feature",
      "retest_prompts",
      "prompt_intents",
      "cta_risk",
      "schema_risk",
      "comparison_risk",
      "quick_answer_risk",
      "cart_links",
      "product_links",
      "product_module_action",
      "cta_action",
      "next_action",
    ],
    ...pageBridge.map((row) => [
      row.bridge_score,
      row.page_priority_score,
      row.conversion_tier,
      row.title,
      row.url,
      row.category,
      row.commercial_intent_score,
      row.ai_pressure_score,
      row.product_depth_score,
      row.conversion_readiness_score,
      row.citation_fix_score,
      row.zero_mention_queries,
      row.competitor_only_answers,
      row.competitors,
      row.products_to_feature,
      row.retest_prompts,
      row.prompt_intents,
      row.cta_risk,
      row.schema_risk,
      row.comparison_risk,
      row.quick_answer_risk,
      row.cart_links,
      row.product_links,
      row.product_module_action,
      row.cta_action,
      row.next_action,
    ]),
  ]));
  await writeFile(path.join(outDir, "category-conversion-bridge.csv"), csv([
    [
      "bridge_priority",
      "category",
      "pages",
      "sprint_pages",
      "avg_bridge_score",
      "ai_pressure_score",
      "competitor_only_answers",
      "zero_mention_queries",
      "cta_cleanup_pages",
      "schema_pages",
      "comparison_pages",
      "quick_answer_pages",
      "product_module_pages",
      "provider_miss_score",
      "top_competitors",
      "top_intents",
      "top_pages",
      "main_move",
    ],
    ...categoryBridge.map((row) => [
      row.bridge_priority,
      row.category,
      row.pages,
      row.sprint_pages,
      row.avg_bridge_score,
      row.ai_pressure_score,
      row.competitor_only_answers,
      row.zero_mention_queries,
      row.cta_cleanup_pages,
      row.schema_pages,
      row.comparison_pages,
      row.quick_answer_pages,
      row.product_module_pages,
      row.provider_miss_score,
      row.top_competitors,
      row.top_intents,
      row.top_pages,
      row.main_move,
    ]),
  ]));
  await writeFile(path.join(outDir, "product-family-visibility-bridge.csv"), csv([
    ["bridge_priority", "family", "unlinked_products", "topics", "sample_products", "target_pages", "cta_risk_pages", "competitor_only_answers", "action"],
    ...familyBridge.map((row) => [
      row.bridge_priority,
      row.family,
      row.unlinked_products,
      row.topics,
      row.sample_products,
      row.target_pages,
      row.cta_risk_pages,
      row.competitor_only_answers,
      row.action,
    ]),
  ]));
  await writeFile(path.join(outDir, "checkout-risk-queue.csv"), csv([
    ["rank", "bridge_score", "page", "url", "category", "tier", "cta_risk", "cart_links", "product_links", "competitors", "products_to_feature", "cta_action", "product_module_action", "retest_prompts"],
    ...checkoutQueue.map((row) => [
      row.rank,
      row.bridge_score,
      row.page,
      row.url,
      row.category,
      row.tier,
      row.cta_risk,
      row.cart_links,
      row.product_links,
      row.competitors,
      row.products_to_feature,
      row.cta_action,
      row.product_module_action,
      row.retest_prompts,
    ]),
  ]));
  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown({ summary, pageBridge, categoryBridge, familyBridge, checkoutQueue }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({ summary, pageBridge, categoryBridge, familyBridge, checkoutQueue, charts }));

  console.log(`Wrote ${path.relative(process.cwd(), outDir)}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
