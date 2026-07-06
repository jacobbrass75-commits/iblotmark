#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_BENCHMARK_DIR = "content-output/openrouter-ai-benchmark-2026-06-17-17-11-06";
const OUT_DIR_NAME = "shopify-blog-content-state-bridge";

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows, columns) {
  return [
    columns.map(csvEscape).join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")),
  ].join("\n") + "\n";
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        i++;
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
  if (!rows.length) return [];
  const headers = rows[0];
  return rows.slice(1).filter((values) => values.some(Boolean)).map((values) => Object.fromEntries(
    headers.map((header, index) => [header, values[index] || ""]),
  ));
}

async function readCsvIfExists(file) {
  try {
    return parseCsv(await readFile(file, "utf8"));
  } catch {
    return [];
  }
}

async function loadDotEnv(file = ".env") {
  try {
    const text = await readFile(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // Missing .env is fine; the report will mark Shopify API access as blocked.
  }
}

function normalizeShop(raw) {
  return String(raw || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/\.myshopify\.com$/i, "")
    .toLowerCase();
}

function normalizeUrl(raw) {
  if (!raw) return "";
  try {
    const url = new URL(raw, "https://iboltmounts.com");
    return `${url.origin}${url.pathname}`.replace(/\/$/, "").toLowerCase();
  } catch {
    return String(raw).trim().replace(/\/$/, "").toLowerCase();
  }
}

function monthOf(value) {
  return value ? String(value).slice(0, 7) : "draft";
}

function summarizeBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row) || "unknown";
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))).map(([key, count]) => ({ key, count }));
}

function inferCategory(text) {
  const value = String(text || "").toLowerCase();
  if (/truck|fleet|eld|semi|construction|work truck|delivery driver|doordash|uber eats|instacart/.test(value)) return "fleet";
  if (/restaurant|pos|tablet tower|food truck|delivery app|toast|square/.test(value)) return "restaurant";
  if (/forklift|warehouse|barcode|scanner|zebra|honeywell|symbol/.test(value)) return "warehouse";
  if (/fish finder|boat|kayak|marine|garmin|lowrance|humminbird|pontoon/.test(value)) return "fishing";
  if (/stream|creator|camera|overhead|desk mount|video/.test(value)) return "streaming";
  if (/amps|modular|ball mount|20mm|25mm|vesa|socket|mount configurator|build your own/.test(value)) return "amps/modular";
  if (/school|education|\bbus\b/.test(value)) return "education";
  if (/jeep|utv|overland|offroad|gopro/.test(value)) return "offroad";
  if (/farm|tractor|agriculture/.test(value)) return "agriculture";
  return "";
}

function intentPriority(row) {
  const text = `${row.title || ""} ${row.tags || ""}`.toLowerCase();
  let score = 0;
  if (/\bbest\b|comparison|guide|choosing|which|how to/.test(text)) score += 35;
  if (/forklift|warehouse|restaurant|pos|tablet|barcode|scanner|eld|fleet|delivery|fish finder|marine|amps|modular|stream/.test(text)) score += 35;
  if (/ibolt|mount|mounting/.test(text)) score += 15;
  if (/2026|2027/.test(text)) score += 5;
  return Math.min(score, 90);
}

function countMatches(value, pattern) {
  return (String(value || "").match(pattern) || []).length;
}

async function shopifyRest({ shop, token, version, endpoint }) {
  const response = await fetch(`https://${shop}.myshopify.com/admin/api/${version}/${endpoint}`, {
    headers: { "X-Shopify-Access-Token": token },
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function shopifyGraphql({ shop, token, version, query, variables }) {
  const response = await fetch(`https://${shop}.myshopify.com/admin/api/${version}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function parseNextPageInfo(linkHeader) {
  const match = String(linkHeader || "").match(/<[^>]*page_info=([^&>]+)[^>]*>; rel="next"/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function fetchShopifyInventory({ shop, token, version }) {
  const { response: blogResponse, data: blogData } = await shopifyRest({ shop, token, version, endpoint: "blogs.json?limit=50" });
  if (!blogResponse.ok) {
    return {
      ok: false,
      status: blogResponse.status,
      articles: [],
      blogs: [],
      error: blogData?.errors || blogData?.error || `Shopify blogs fetch failed with ${blogResponse.status}`,
    };
  }

  const blogs = blogData.blogs || [];
  const articles = [];
  for (const blog of blogs) {
    let pageInfo = null;
    do {
      const qs = pageInfo ? `page_info=${encodeURIComponent(pageInfo)}&limit=50` : "limit=50";
      const { response, data } = await shopifyRest({
        shop,
        token,
        version,
        endpoint: `blogs/${blog.id}/articles.json?${qs}`,
      });
      if (!response.ok) break;
      for (const article of data.articles || []) {
        const bodyHtml = article.body_html || "";
        articles.push({
          article_id: article.id,
          blog_id: blog.id,
          blog_title: blog.title,
          blog_handle: blog.handle,
          title: article.title,
          handle: article.handle,
          url: `https://iboltmounts.com/blogs/${blog.handle}/${article.handle}`,
          status: article.published_at ? "published" : "draft_or_unpublished",
          published_at: article.published_at || "",
          created_at: article.created_at || "",
          updated_at: article.updated_at || "",
          author: article.author || "",
          tags: article.tags || "",
          body_chars: bodyHtml.length,
          product_links: countMatches(bodyHtml, /iboltmounts\.com\/products\//gi),
          add_to_cart_links: countMatches(bodyHtml, /\/cart\/add|cart\/add\?/gi),
          image_count: countMatches(bodyHtml, /<img\b/gi),
        });
      }
      pageInfo = parseNextPageInfo(response.headers.get("link"));
    } while (pageInfo);
  }

  return { ok: true, status: blogResponse.status, blogs, articles };
}

async function fetchAnalyticsAccess({ shop, token, version }) {
  const scopesQuery = "query { currentAppInstallation { accessScopes { handle } } }";
  const scopesResult = await shopifyGraphql({ shop, token, version, query: scopesQuery });
  const scopes = (scopesResult.data?.data?.currentAppInstallation?.accessScopes || [])
    .map((scope) => scope.handle)
    .filter(Boolean)
    .sort();

  const shopifyqlQuery = `query($q:String!){
    shopifyqlQuery(query:$q){
      tableData { columns { name dataType displayName } rows }
      parseErrors
    }
  }`;
  const shopifyqlResult = await shopifyGraphql({
    shop,
    token,
    version,
    query: shopifyqlQuery,
    variables: { q: "FROM sales SHOW total_sales, orders SINCE -30d WITH TOTALS" },
  });
  const errors = (shopifyqlResult.data?.errors || []).map((error) => error.message).filter(Boolean);

  return {
    scopes_status: scopesResult.response.status,
    shopifyql_status: shopifyqlResult.response.status,
    scopes: scopes.join("; "),
    has_read_reports: scopes.includes("read_reports") ? "yes" : "no",
    has_read_analytics: scopes.includes("read_analytics") ? "yes" : "no",
    shopifyql_available: errors.length ? "no" : "yes",
    shopifyql_errors: errors.join(" | "),
  };
}

function buildJoinedRows({ articles, controlRows, actionRows }) {
  const controlByUrl = new Map(controlRows.map((row) => [normalizeUrl(row.url), row]));
  const actionByUrl = new Map(actionRows.map((row) => [normalizeUrl(row.url), row]));

  return articles.map((article) => {
    const key = normalizeUrl(article.url);
    const control = controlByUrl.get(key) || {};
    const action = actionByUrl.get(key) || {};
    const inferredCategory = inferCategory(`${article.title} ${article.tags}`);
    const visibilityRisk = Number(control.visibility_risk_score || 0);
    const actionPriority = Number(action.priority || 0);
    const titleIntentPriority = article.status !== "published" ? intentPriority(article) : 0;
    const competitorOnly = Number(control.competitor_only_answers || action.competitor_only_answers || 0);
    const zeroMentions = Number(control.zero_mention_queries || action.zero_mention_queries || 0);
    const priority = Math.max(visibilityRisk, actionPriority, titleIntentPriority, competitorOnly * 35 + zeroMentions * 25);
    return {
      ...article,
      category: control.category || action.category || inferredCategory,
      visibility_risk_score: control.visibility_risk_score || "",
      action_priority: action.priority || "",
      sprint: action.sprint || "",
      visibility_stage: control.ai_visibility_stage || action.visibility_stage || "",
      competitor_only_answers: control.competitor_only_answers || action.competitor_only_answers || "",
      zero_mention_queries: control.zero_mention_queries || action.zero_mention_queries || "",
      competitors: control.competitors || action.competitors || "",
      retest_prompts: control.retest_prompts || action.retest_prompts || "",
      recommended_action: control.primary_action || action.immediate_action || "",
      product_links: article.product_links,
      add_to_cart_links: article.add_to_cart_links,
      image_count: article.image_count,
      body_chars: article.body_chars,
      state_bridge_priority: priority,
      bridge_note: article.status === "published"
        ? "live content can support AI visibility once edited and retested"
        : titleIntentPriority >= 70
          ? "high-intent draft/unpublished page; publish, merge, or delete intentionally because AI cannot crawl or cite it now"
          : "draft/unpublished content cannot be crawled or cited until published",
    };
  }).sort((a, b) => b.state_bridge_priority - a.state_bridge_priority);
}

function renderHtml({ summary, analyticsAccess, byBlog, byMonth, joinedRows, draftQueue }) {
  const scopeText = analyticsAccess.scopes || "none detected";
  const blocked = analyticsAccess.shopifyql_available !== "yes";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Shopify Blog Content State Bridge</title>
  <style>
    body{font-family:Inter,Arial,sans-serif;margin:0;background:#f7f8fa;color:#121826}
    main{max-width:1180px;margin:0 auto;padding:32px}
    h1{font-size:34px;margin:0 0 8px}
    h2{margin-top:34px}
    .muted{color:#5f6b7a}
    .cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:22px 0}
    .card{background:#fff;border:1px solid #d9dee7;border-radius:8px;padding:16px}
    .num{font-size:30px;font-weight:800}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d9dee7;border-radius:8px;overflow:hidden}
    th,td{padding:10px;border-bottom:1px solid #edf0f5;text-align:left;vertical-align:top;font-size:13px}
    th{background:#eef2f7;font-size:12px;text-transform:uppercase;letter-spacing:.02em}
    tr:last-child td{border-bottom:0}
    .pill{display:inline-block;border-radius:999px;padding:3px 8px;font-size:12px;font-weight:700}
    .published{background:#ddf7e7;color:#10633b}
    .draft{background:#fff0d7;color:#815500}
    .blocked{background:#ffe2e2;color:#8a1d1d}
    .ok{background:#ddf7e7;color:#10633b}
    @media(max-width:900px){.cards{grid-template-columns:1fr 1fr}main{padding:20px}}
  </style>
</head>
<body>
<main>
  <h1>Shopify Blog Content State Bridge</h1>
  <p class="muted">This is not Shopify traffic analytics. It is the current Shopify article inventory joined to AI visibility work, plus a live analytics-access check.</p>
  <div class="cards">
    <div class="card"><div class="num">${summary.total}</div><div>Total Shopify articles</div></div>
    <div class="card"><div class="num">${summary.published}</div><div>Published articles</div></div>
    <div class="card"><div class="num">${summary.draftOrUnpublished}</div><div>Draft or unpublished</div></div>
    <div class="card"><div class="num">${analyticsAccess.shopifyql_available === "yes" ? "Ready" : "Blocked"}</div><div>ShopifyQL analytics</div></div>
  </div>
  <div class="cards">
    <div class="card"><div class="num">${summary.productLinks}</div><div>Product links in article bodies</div></div>
    <div class="card"><div class="num">${summary.addToCartLinks}</div><div>Add-to-cart links in article bodies</div></div>
    <div class="card"><div class="num">${summary.imageCount}</div><div>Embedded article images</div></div>
    <div class="card"><div class="num">${summary.articlesWithNoProductLinks}</div><div>Articles with no product links</div></div>
  </div>

  <h2>Analytics Access</h2>
  <table>
    <tr><th>Check</th><th>Result</th></tr>
    <tr><td>Current token scopes</td><td>${escapeHtml(scopeText)}</td></tr>
    <tr><td>Has read_reports</td><td><span class="pill ${analyticsAccess.has_read_reports === "yes" ? "ok" : "blocked"}">${analyticsAccess.has_read_reports}</span></td></tr>
    <tr><td>Has read_analytics</td><td><span class="pill ${analyticsAccess.has_read_analytics === "yes" ? "ok" : "blocked"}">${analyticsAccess.has_read_analytics}</span></td></tr>
    <tr><td>ShopifyQL query result</td><td><span class="pill ${blocked ? "blocked" : "ok"}">${analyticsAccess.shopifyql_available}</span>${blocked ? `<br>${escapeHtml(analyticsAccess.shopifyql_errors)}` : ""}</td></tr>
  </table>

  <h2>By Blog</h2>
  ${renderSmallTable(byBlog, ["blog", "total", "published", "draft_or_unpublished"])}

  <h2>Published Articles By Month</h2>
  ${renderSmallTable(byMonth, ["month", "published_articles"])}

  <h2>Draft or Unpublished Visibility Queue</h2>
  <p class="muted">These pages cannot contribute to AI citations or recommendations until they are live. Priority comes from existing competitor/visibility work where the URL is mapped.</p>
  ${renderDraftTable(draftQueue.slice(0, 30))}

  <h2>Highest Priority Shopify Article Rows</h2>
  ${renderDraftTable(joinedRows.slice(0, 35))}
</main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderSmallTable(rows, columns) {
  return `<table><thead><tr>${columns.map((column) => `<th>${escapeHtml(column.replace(/_/g, " "))}</th>`).join("")}</tr></thead><tbody>${
    rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(row[column] ?? "")}</td>`).join("")}</tr>`).join("")
  }</tbody></table>`;
}

function renderDraftTable(rows) {
  const columns = ["title", "status", "category", "state_bridge_priority", "product_links", "add_to_cart_links", "image_count", "competitor_only_answers", "zero_mention_queries", "competitors", "recommended_action"];
  return `<table><thead><tr>${columns.map((column) => `<th>${escapeHtml(column.replace(/_/g, " "))}</th>`).join("")}</tr></thead><tbody>${
    rows.map((row) => `<tr>${columns.map((column) => {
      if (column === "title") return `<td><a href="${escapeHtml(row.url)}">${escapeHtml(row.title)}</a><br><span class="muted">${escapeHtml(row.updated_at || row.published_at)}</span></td>`;
      if (column === "status") return `<td><span class="pill ${row.status === "published" ? "published" : "draft"}">${escapeHtml(row.status)}</span></td>`;
      return `<td>${escapeHtml(row[column] ?? "")}</td>`;
    }).join("")}</tr>`).join("")
  }</tbody></table>`;
}

function renderMarkdown({ summary, analyticsAccess, byBlog, byMonth, draftQueue }) {
  return `# Shopify Blog Content State Bridge

This is not Shopify traffic analytics. It is Shopify article inventory plus an analytics access check.

## Current State

- Total Shopify articles: ${summary.total}
- Published articles: ${summary.published}
- Draft or unpublished articles: ${summary.draftOrUnpublished}
- ShopifyQL analytics available: ${analyticsAccess.shopifyql_available}
- Current token scopes: ${analyticsAccess.scopes || "none detected"}
- Blocker: ${analyticsAccess.shopifyql_available === "yes" ? "none" : analyticsAccess.shopifyql_errors}
- Product links in article bodies: ${summary.productLinks}
- Add-to-cart links in article bodies: ${summary.addToCartLinks}
- Embedded article images: ${summary.imageCount}
- Articles with no product links: ${summary.articlesWithNoProductLinks}

## By Blog

${byBlog.map((row) => `- ${row.blog}: ${row.published}/${row.total} published, ${row.draft_or_unpublished} draft/unpublished`).join("\n")}

## Recent Published Months

${byMonth.slice(-12).map((row) => `- ${row.month}: ${row.published_articles}`).join("\n")}

## Top Draft/Unpublished Visibility Queue

${draftQueue.slice(0, 12).map((row, index) => `${index + 1}. ${row.title} (${row.category || "uncategorized"}): ${row.bridge_note}`).join("\n")}
`;
}

async function main() {
  const benchmarkDir = process.argv[2] || DEFAULT_BENCHMARK_DIR;
  const outDir = path.join(benchmarkDir, OUT_DIR_NAME);
  await mkdir(outDir, { recursive: true });
  await loadDotEnv();

  const shop = normalizeShop(process.env.SHOPIFY_SHOP);
  const token = process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN || "";
  const version = process.env.SHOPIFY_API_VERSION || "2026-04";

  if (!shop || !token) {
    const blocked = {
      total: 0,
      published: 0,
      draftOrUnpublished: 0,
      blocker: "SHOPIFY_SHOP and SHOPIFY_ACCESS_TOKEN/SHOPIFY_ADMIN_API_ACCESS_TOKEN are required.",
    };
    await writeFile(path.join(outDir, "REPORT.md"), `# Shopify Blog Content State Bridge\n\nBlocked: ${blocked.blocker}\n`);
    await writeFile(path.join(outDir, "shopify-content-state-summary.json"), JSON.stringify(blocked, null, 2));
    console.log(`[shopify-content-state] blocked: ${blocked.blocker}`);
    return;
  }

  const [inventory, analyticsAccess, controlRows, actionRows] = await Promise.all([
    fetchShopifyInventory({ shop, token, version }),
    fetchAnalyticsAccess({ shop, token, version }),
    readCsvIfExists(path.join(benchmarkDir, "blog-post-visibility-control-report", "blog-page-control-ledger.csv")),
    readCsvIfExists(path.join(benchmarkDir, "all-blog-action-control-sheet", "all-blog-action-control-sheet.csv")),
  ]);

  const articles = inventory.articles || [];
  const joinedRows = buildJoinedRows({ articles, controlRows, actionRows });
  const draftQueue = joinedRows
    .filter((row) => row.status !== "published")
    .sort((a, b) => b.state_bridge_priority - a.state_bridge_priority || String(b.updated_at).localeCompare(String(a.updated_at)));
  const summary = {
    shop,
    apiVersion: version,
    total: articles.length,
    published: articles.filter((row) => row.status === "published").length,
    draftOrUnpublished: articles.filter((row) => row.status !== "published").length,
    mappedToVisibilityRows: joinedRows.filter((row) => row.visibility_risk_score || row.action_priority).length,
    draftMappedToVisibilityRows: draftQueue.filter((row) => row.visibility_risk_score || row.action_priority).length,
    draftHighIntentRows: draftQueue.filter((row) => Number(row.state_bridge_priority || 0) >= 70).length,
    productLinks: articles.reduce((total, row) => total + Number(row.product_links || 0), 0),
    addToCartLinks: articles.reduce((total, row) => total + Number(row.add_to_cart_links || 0), 0),
    imageCount: articles.reduce((total, row) => total + Number(row.image_count || 0), 0),
    articlesWithNoProductLinks: articles.filter((row) => Number(row.product_links || 0) === 0).length,
    analyticsAccess,
  };

  const byBlog = Object.values(articles.reduce((acc, row) => {
    const key = row.blog_title;
    acc[key] ||= { blog: key, total: 0, published: 0, draft_or_unpublished: 0 };
    acc[key].total++;
    if (row.status === "published") acc[key].published++;
    else acc[key].draft_or_unpublished++;
    return acc;
  }, {})).sort((a, b) => b.total - a.total);

  const byMonth = summarizeBy(articles.filter((row) => row.status === "published"), (row) => monthOf(row.published_at))
    .map((row) => ({ month: row.key, published_articles: row.count }));

  await writeFile(path.join(outDir, "shopify-article-inventory.csv"), toCsv(articles, [
    "article_id", "blog_id", "blog_title", "blog_handle", "title", "handle", "url", "status", "published_at", "created_at", "updated_at", "author", "tags", "body_chars", "product_links", "add_to_cart_links", "image_count",
  ]));
  await writeFile(path.join(outDir, "shopify-visibility-state-bridge.csv"), toCsv(joinedRows, [
    "state_bridge_priority", "title", "url", "status", "blog_title", "category", "visibility_risk_score", "action_priority", "sprint", "visibility_stage", "product_links", "add_to_cart_links", "image_count", "body_chars", "competitor_only_answers", "zero_mention_queries", "competitors", "retest_prompts", "recommended_action", "bridge_note", "published_at", "updated_at",
  ]));
  await writeFile(path.join(outDir, "draft-unpublished-visibility-queue.csv"), toCsv(draftQueue, [
    "state_bridge_priority", "title", "url", "status", "blog_title", "category", "visibility_risk_score", "action_priority", "sprint", "product_links", "add_to_cart_links", "image_count", "body_chars", "competitor_only_answers", "zero_mention_queries", "competitors", "recommended_action", "bridge_note", "updated_at",
  ]));
  await writeFile(path.join(outDir, "shopify-content-state-summary.json"), JSON.stringify(summary, null, 2));
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml({ summary, analyticsAccess, byBlog, byMonth, joinedRows, draftQueue }));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown({ summary, analyticsAccess, byBlog, byMonth, draftQueue }));

  console.log(`[shopify-content-state] wrote ${outDir}`);
  console.log(`[shopify-content-state] articles=${summary.total} published=${summary.published} draft_or_unpublished=${summary.draftOrUnpublished} shopifyql=${analyticsAccess.shopifyql_available}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
