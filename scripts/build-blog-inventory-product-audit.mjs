import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const DB_PATH = process.env.DATABASE_PATH || "data/sourceannotator.db";
const COMPANY_ID = process.env.COMPANY_ID || "ibolt-default-company";
const AUDIT_PREFIX = "live-blog-ai-citability-merged-";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";

let sharpModulePromise = null;

const VERTICAL_TO_TOPIC = [
  [/fishing|boating|marine/i, "fishing"],
  [/restaurant|food|delivery/i, "restaurant"],
  [/trucking|fleet|eld/i, "fleet"],
  [/forklift|warehouse|material/i, "warehouse"],
  [/stream|creator|camera/i, "streaming"],
  [/general|mounting/i, "amps/modular"],
  [/education|school/i, "education"],
  [/agriculture|farm/i, "agriculture"],
  [/off-road|offroad|jeep|utv/i, "offroad"],
  [/road trip|travel/i, "travel"],
  [/cycling|bike/i, "cycling"],
  [/kitchen|home/i, "kitchen"],
];

const STOPWORDS = new Set([
  "the", "and", "for", "with", "your", "from", "that", "this", "into", "best", "guide",
  "mount", "mounts", "mounting", "ibolt", "using", "what", "when", "where", "which",
  "2026", "how", "why", "are", "you", "our", "pos",
]);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function csvCell(value) {
  if (Array.isArray(value)) value = value.join("; ");
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function csv(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function pct(numerator, denominator) {
  return denominator ? Math.round((numerator / denominator) * 100) : 0;
}

function sqliteJson(sql) {
  const output = execFileSync("sqlite3", ["-json", DB_PATH, sql], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 80 * 1024 * 1024,
  }).trim();
  return output ? JSON.parse(output) : [];
}

async function latestDir(prefix) {
  const entries = await readdir(path.join(process.cwd(), OUTPUT_ROOT), { withFileTypes: true });
  const name = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  if (!name) throw new Error(`No ${prefix} output directory found.`);
  return path.join(process.cwd(), OUTPUT_ROOT, name);
}

function normalizeSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/^blogs\/[^/]+\//, "")
    .replace(/^products\//, "");
}

function slugFromUrl(value) {
  try {
    return normalizeSlug(new URL(value).pathname);
  } catch {
    return normalizeSlug(value);
  }
}

function canonicalHandle(value) {
  return decodeURIComponent(String(value || ""))
    .replace(/&amp;/g, "&")
    .replace(/\.js$/i, "")
    .replace(/[),.;:'"\]]+$/g, "")
    .trim()
    .toLowerCase();
}

function productHandlesInText(text) {
  const handles = new Set();
  const patterns = [
    /https?:\/\/(?:www\.)?iboltmounts\.com\/products\/([^?#"'<>\s)]+)/gi,
    /(?:href|src)=["']\/products\/([^?#"'<>\s)]+)/gi,
    /\]\(https?:\/\/(?:www\.)?iboltmounts\.com\/products\/([^?#"'<>\s)]+)\)/gi,
    /\]\(\/products\/([^?#"'<>\s)]+)\)/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text || ""))) {
      const handle = canonicalHandle(match[1]);
      if (handle) handles.add(handle);
    }
  }
  return [...handles];
}

function topicForVertical(vertical) {
  for (const [pattern, topic] of VERTICAL_TO_TOPIC) {
    if (pattern.test(vertical || "")) return topic;
  }
  return "other";
}

function tokenize(value) {
  return compact(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

function overlapScore(a, b) {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (!aTokens.size || !bTokens.size) return 0;
  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token) || bTokens.has(`${token}s`) || (token.endsWith("s") && bTokens.has(token.slice(0, -1)))) {
      overlap += 1;
    }
  }
  return overlap / Math.sqrt(aTokens.size * bTokens.size);
}

function buildAuditIndexes(rows) {
  const bySlug = new Map();
  const byTitle = new Map();
  const searchable = [];
  for (const row of rows) {
    if (row.url) bySlug.set(slugFromUrl(row.url), row);
    if (row.title) byTitle.set(compact(row.title).toLowerCase(), row);
    if (row.title && row.status !== "failed") searchable.push(row);
  }
  return { bySlug, byTitle, searchable };
}

function matchAuditPost(indexes, post) {
  const exact = indexes.bySlug.get(normalizeSlug(post.slug))
    || indexes.byTitle.get(compact(post.title).toLowerCase())
    || null;
  if (exact && exact.status !== "failed") return { row: exact, matchType: "exact" };

  const fuzzy = indexes.searchable
    .map((row) => ({ row, score: Math.max(overlapScore(post.title, row.title), overlapScore(post.slug, slugFromUrl(row.url || ""))) }))
    .filter((item) => item.score >= 0.68)
    .sort((a, b) => b.score - a.score)[0];
  if (fuzzy) return { row: fuzzy.row, matchType: `fuzzy:${Math.round(fuzzy.score * 100)}` };
  return { row: exact, matchType: exact ? "blocked_or_failed" : "none" };
}

function structuralIssues(page) {
  if (!page || page.status === "failed") return ["No audited live page match"];
  const issues = [];
  if (!page.hasFaqSchema) issues.push("FAQ schema");
  if (!page.hasQuickAnswer) issues.push("quick answer");
  if (!page.hasComparisonSignals) issues.push("comparison block");
  if (!page.hasArticleSchema && !page.hasBlogPostingSchema) issues.push("Article/BlogPosting schema");
  if (!page.productLinks) issues.push("direct product links");
  if (Number(page.missingAlt || 0) > 0) issues.push("image alt text");
  return issues;
}

function svgShell(width, height, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
  <style>
    .bg{fill:#f8fafc}.panel{fill:#fff;stroke:#d7dee8;stroke-width:1}.title{font:700 24px Arial,sans-serif;fill:#111827}.subtitle{font:400 14px Arial,sans-serif;fill:#64748b}.label{font:700 13px Arial,sans-serif;fill:#111827}.small{font:400 12px Arial,sans-serif;fill:#475569}.value{font:700 13px Arial,sans-serif;fill:#0f172a}
  </style>
  <rect class="bg" width="${width}" height="${height}"/>
  ${body}
</svg>`;
}

function wrapText(value, maxChars) {
  const words = compact(value).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function barChart({ title, subtitle, rows, color = "#2563eb", maxValue }) {
  const width = 1160;
  const rowH = 46;
  const height = 128 + rows.length * rowH + 34;
  const left = 430;
  const top = 108;
  const barW = width - left - 146;
  const max = maxValue || Math.max(1, ...rows.map((row) => Number(row.value || 0)));
  const body = rows.map((row, index) => {
    const y = top + index * rowH;
    const value = Number(row.value || 0);
    const w = Math.max(value > 0 ? 4 : 0, Math.round((value / max) * barW));
    const labels = wrapText(row.label, 48).map((line, lineIndex) =>
      `<text class="${lineIndex === 0 ? "label" : "small"}" x="54" y="${y + 14 + lineIndex * 15}">${escapeHtml(line)}</text>`
    ).join("\n");
    return `
      ${labels}
      <rect x="${left}" y="${y}" width="${barW}" height="24" rx="8" fill="#e2e8f0"/>
      <rect x="${left}" y="${y}" width="${w}" height="24" rx="8" fill="${color}"/>
      <text class="value" x="${left + barW + 14}" y="${y + 17}">${escapeHtml(row.display ?? value)}</text>
      <text class="small" x="${left}" y="${y + 41}">${escapeHtml(row.note || "")}</text>
    `;
  }).join("\n");
  return svgShell(width, height, `
    <rect class="panel" x="28" y="24" width="${width - 56}" height="${height - 48}" rx="14"/>
    <text class="title" x="54" y="64">${escapeHtml(title)}</text>
    <text class="subtitle" x="54" y="88">${escapeHtml(subtitle)}</text>
    ${body}
  `);
}

async function writeSvgAndPng(outDir, filename, svg) {
  await writeFile(path.join(outDir, `${filename}.svg`), svg);
  try {
    sharpModulePromise ||= import("sharp");
    const sharp = (await sharpModulePromise).default;
    await sharp(Buffer.from(svg)).png().toFile(path.join(outDir, `${filename}.png`));
  } catch (error) {
    console.warn(`Could not render ${filename}.png: ${error.message}`);
  }
}

function duplicatePairs(rows) {
  const candidates = rows
    .filter((row) => row.title && row.status !== "failed")
    .map((row) => ({ ...row, key: `${row.title} ${slugFromUrl(row.url || "")}` }));
  const pairs = [];
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i];
      const b = candidates[j];
      const score = Math.max(overlapScore(a.title, b.title), overlapScore(slugFromUrl(a.url || ""), slugFromUrl(b.url || "")));
      if (score >= 0.72) {
        pairs.push({
          score: Math.round(score * 100),
          titleA: a.title,
          urlA: a.url,
          titleB: b.title,
          urlB: b.url,
          categoryA: a.category,
          categoryB: b.category,
        });
      }
    }
  }
  return pairs.sort((a, b) => b.score - a.score).slice(0, 80);
}

function buildHtml({ summary, postRows, productRows, duplicateRows, productGaps, charts }) {
  const cards = [
    ["Local posts", summary.localPosts, `${summary.shopifySynced} synced to Shopify`],
    ["Sitemap pages", summary.sitemapPages, `${summary.auditedPages} audited`],
    ["Matched posts", `${summary.matchedPosts}/${summary.localPosts}`, `${summary.unmatchedPosts} not matched to audit`],
    ["Products", summary.products, `${summary.linkedProducts} linked in posts`],
    ["Unlinked products", summary.unlinkedProducts, `${summary.unlinkedProductRate}% of catalog`],
    ["Duplicate pairs", summary.duplicatePairs, "possible topic overlap"],
  ].map(([label, value, note]) => `
    <div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div><div class="s">${escapeHtml(note)}</div></div>
  `).join("");
  const posts = postRows.slice(0, 30).map((row) => `
    <tr>
      <td>${row.refreshPriority}</td><td><b>${escapeHtml(row.title)}</b><br><span>${escapeHtml(row.vertical || "unmapped")}</span></td>
      <td>${row.overallScore ?? ""}</td><td>${row.aiCitabilityScore ?? ""}</td><td>${row.productLinkCount}</td>
      <td>${escapeHtml(row.linkedPrompts.slice(0, 3).join("; "))}</td><td>${escapeHtml(row.issues.slice(0, 5).join(", "))}</td>
    </tr>
  `).join("");
  const products = productRows.slice(0, 30).map((row) => `
    <tr>
      <td>${row.blogLinkPostCount}</td><td><b>${escapeHtml(row.title)}</b><br><span>${escapeHtml(row.handle)}</span></td>
      <td>${escapeHtml(row.verticals.join(", "))}</td><td>${escapeHtml(row.linkedPosts.slice(0, 4).join("; "))}</td>
    </tr>
  `).join("");
  const gaps = productGaps.slice(0, 30).map((row) => `
    <tr><td>${escapeHtml(row.title)}</td><td>${escapeHtml(row.handle)}</td><td>${escapeHtml(row.verticals.join(", "))}</td><td>${escapeHtml(row.reason)}</td></tr>
  `).join("");
  const duplicates = duplicateRows.slice(0, 24).map((row) => `
    <tr><td>${row.score}</td><td><a href="${escapeHtml(row.urlA)}">${escapeHtml(row.titleA)}</a></td><td><a href="${escapeHtml(row.urlB)}">${escapeHtml(row.titleB)}</a></td></tr>
  `).join("");
  return `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT Blog Inventory and Product Spread Audit</title>
  <style>
    :root{--ink:#111827;--muted:#64748b;--border:#d7dee8;--bg:#f8fafc;--panel:#fff}
    body{margin:0;background:var(--bg);font-family:Arial,Helvetica,sans-serif;color:var(--ink)}
    main{max-width:1260px;margin:0 auto;padding:34px 26px 64px}h1{font-size:34px;margin:0 0 10px}h2{font-size:22px;margin:34px 0 14px}p{font-size:16px;line-height:1.55;color:#334155;max-width:960px}
    .grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid var(--border);border-radius:12px;padding:16px}.k{font-size:12px;color:var(--muted);letter-spacing:.06em;text-transform:uppercase;font-weight:700}.v{font-size:30px;font-weight:800;margin-top:8px}.s,td span{font-size:13px;color:var(--muted)}
    .takeaway{background:#fff;border:1px solid var(--border);border-left:6px solid #2563eb;border-radius:10px;padding:16px 18px}
    figure{background:#fff;border:1px solid var(--border);border-radius:14px;margin:14px 0;padding:10px;overflow:auto}figure img{display:block;width:100%;height:auto}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:22px}th,td{text-align:left;vertical-align:top;padding:11px 12px;border-bottom:1px solid #edf2f7;font-size:14px}th{background:#f1f5f9;color:#475569;font-size:12px;letter-spacing:.04em;text-transform:uppercase}a{color:#0f3f91}
    @media(max-width:980px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media print{body{background:#fff}main{max-width:none;padding:18px}.grid{grid-template-columns:repeat(6,1fr)}figure,.card,table{break-inside:avoid}}
  </style>
</head><body><main>
  <h1>iBOLT Blog Inventory and Product Spread Audit</h1>
  <p class="takeaway"><strong>Readout:</strong> The blog system has a real content base, but product coverage and page matching are uneven. The top cleanup is to connect high-risk benchmark prompts to the right live pages, reduce overlapping pages, and spread product mentions beyond the same few marine and restaurant SKUs.</p>
  <section class="grid">${cards}</section>
  <h2>Charts</h2>
  ${charts.map((chart) => `<figure><img src="${chart}" alt="${chart}"/></figure>`).join("\n")}
  <h2>Highest Priority Post Refreshes</h2>
  <table><thead><tr><th>Priority</th><th>Post</th><th>Overall</th><th>AI page score</th><th>Products</th><th>Prompts</th><th>Fixes</th></tr></thead><tbody>${posts}</tbody></table>
  <h2>Most Used Products In Blog Content</h2>
  <table><thead><tr><th>Posts</th><th>Product</th><th>Verticals</th><th>Linked posts</th></tr></thead><tbody>${products}</tbody></table>
  <h2>Unlinked Product Opportunities</h2>
  <table><thead><tr><th>Product</th><th>Handle</th><th>Verticals</th><th>Reason</th></tr></thead><tbody>${gaps}</tbody></table>
  <h2>Possible Duplicate Or Cannibalized Pages</h2>
  <table><thead><tr><th>Similarity</th><th>Page A</th><th>Page B</th></tr></thead><tbody>${duplicates}</tbody></table>
</main></body></html>`;
}

async function main() {
  const auditDir = process.argv[2] ? path.resolve(process.argv[2]) : await latestDir(AUDIT_PREFIX);
  const benchmarkDir = process.argv[3] ? path.resolve(process.argv[3]) : await latestDir(BENCHMARK_PREFIX);
  const audit = JSON.parse(await readFile(path.join(auditDir, "live-blog-page-audit.merged.json"), "utf8"));
  const matrix = JSON.parse(await readFile(path.join(benchmarkDir, "competitive-matrix", "competitive-matrix-data.json"), "utf8"));
  const auditIndexes = buildAuditIndexes(audit.rows || []);

  const posts = sqliteJson(`
    SELECT bp.id, bp.title, bp.slug, bp.status, bp.word_count AS wordCount,
      bp.overall_score AS overallScore, bp.shopify_article_id AS shopifyArticleId,
      bp.shopify_blog_id AS shopifyBlogId, bp.html, bp.markdown,
      iv.name AS vertical
    FROM blog_posts bp
    LEFT JOIN industry_verticals iv ON iv.id = bp.vertical_id
    WHERE bp.company_id = '${COMPANY_ID.replace(/'/g, "''")}'
    ORDER BY bp.generated_at DESC
  `);
  const products = sqliteJson(`
    SELECT id, title, handle, product_type AS productType, price, url, has_photos AS hasPhotos, photo_count AS photoCount
    FROM ibolt_products
    WHERE company_id = '${COMPANY_ID.replace(/'/g, "''")}'
    ORDER BY title
  `);
  const blogProductRows = sqliteJson(`
    SELECT bpp.blog_post_id AS blogPostId, bpp.product_id AS productId, p.handle, p.title
    FROM blog_post_products bpp
    JOIN ibolt_products p ON p.id = bpp.product_id
    WHERE bpp.company_id = '${COMPANY_ID.replace(/'/g, "''")}'
      AND p.company_id = '${COMPANY_ID.replace(/'/g, "''")}'
  `);
  const productVerticalRows = sqliteJson(`
    SELECT p.id AS productId, p.handle, iv.name AS vertical
    FROM ibolt_products p
    JOIN product_verticals pv ON pv.product_id = p.id
    JOIN industry_verticals iv ON iv.id = pv.vertical_id
    WHERE p.company_id = '${COMPANY_ID.replace(/'/g, "''")}'
      AND pv.company_id = '${COMPANY_ID.replace(/'/g, "''")}'
  `);
  const productReadinessRows = sqliteJson(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN url IS NULL OR TRIM(url) = '' THEN 1 ELSE 0 END) AS missingUrl,
      SUM(CASE WHEN image_url IS NULL OR TRIM(image_url) = '' THEN 1 ELSE 0 END) AS missingImage,
      SUM(CASE WHEN price IS NULL OR TRIM(price) = '' THEN 1 ELSE 0 END) AS missingPrice,
      SUM(CASE WHEN sku IS NULL OR TRIM(sku) = '' THEN 1 ELSE 0 END) AS missingSku,
      SUM(CASE WHEN availability IS NULL OR TRIM(availability) = '' THEN 1 ELSE 0 END) AS missingAvailability,
      SUM(CASE WHEN specs IS NULL OR TRIM(specs) = '' THEN 1 ELSE 0 END) AS missingSpecs,
      SUM(CASE WHEN compatibility IS NULL OR TRIM(compatibility) = '' THEN 1 ELSE 0 END) AS missingCompatibility,
      SUM(CASE WHEN has_photos = 1 THEN 1 ELSE 0 END) AS hasPhotos
    FROM ibolt_products
    WHERE company_id = '${COMPANY_ID.replace(/'/g, "''")}'
  `);
  const duplicateSlugRows = sqliteJson(`
    SELECT slug, COUNT(*) AS count
    FROM blog_posts
    WHERE company_id = '${COMPANY_ID.replace(/'/g, "''")}'
    GROUP BY slug
    HAVING COUNT(*) > 1
    ORDER BY count DESC, slug
  `);

  const productByHandle = new Map(products.map((product) => [product.handle, product]));
  const relationHandlesByPost = new Map();
  for (const row of blogProductRows) {
    const list = relationHandlesByPost.get(row.blogPostId) || [];
    list.push(row.handle);
    relationHandlesByPost.set(row.blogPostId, list);
  }

  const verticalsByProduct = new Map();
  for (const row of productVerticalRows) {
    const list = verticalsByProduct.get(row.handle) || [];
    list.push(row.vertical);
    verticalsByProduct.set(row.handle, list);
  }

  const queryBySlug = new Map();
  const refreshBySlug = new Map();
  for (const row of matrix.queryMatrix || []) {
    if (!row.closestSlug) continue;
    const list = queryBySlug.get(row.closestSlug) || [];
    list.push(row);
    queryBySlug.set(row.closestSlug, list);
  }
  for (const row of matrix.pageQueue || []) {
    const slug = slugFromUrl(row.url || "");
    refreshBySlug.set(slug, row);
  }

  const postRows = posts.map((post) => {
    const parsedHandles = productHandlesInText(`${post.html || ""}\n${post.markdown || ""}`);
    const relationHandles = [...new Set(relationHandlesByPost.get(post.id) || [])];
    const productHandles = [...new Set([...parsedHandles, ...relationHandles])];
    const knownProductHandles = productHandles.filter((handle) => productByHandle.has(handle));
    const unknownProductHandles = productHandles.filter((handle) => !productByHandle.has(handle));
    const auditMatch = matchAuditPost(auditIndexes, post);
    const auditRow = auditMatch.row;
    const directQueries = queryBySlug.get(post.slug) || [];
    const refresh = refreshBySlug.get(slugFromUrl(auditRow?.url || "")) || refreshBySlug.get(normalizeSlug(post.slug));
    const linkedPrompts = [...new Set([
      ...directQueries.map((row) => row.prompt),
      ...(refresh?.prompts || []),
    ])];
    const competitors = [...new Set([
      ...directQueries.flatMap((row) => row.competitors || []),
      ...(refresh?.competitors || []),
    ])];
    const issues = structuralIssues(auditRow);
    const issuePenalty = issues.includes("No audited live page match") ? 35 : issues.length * 5;
    const refreshPriority = Math.min(100, Math.round((refresh?.refreshPriority || 0) * 0.7 + issuePenalty + Math.max(0, 4 - productHandles.length) * 3));
    return {
      id: post.id,
      title: post.title,
      slug: post.slug,
      status: post.status,
      vertical: post.vertical,
      topic: topicForVertical(post.vertical),
      wordCount: post.wordCount || 0,
      overallScore: post.overallScore,
      shopifyArticleId: post.shopifyArticleId,
      shopifyBlogId: post.shopifyBlogId,
      bodyProductHandles: parsedHandles,
      relationProductHandles: relationHandles,
      unknownProductHandles,
      productHandles,
      knownProductHandles,
      productLinkCount: knownProductHandles.length,
      auditUrl: auditRow?.url || "",
      auditStatus: auditRow?.status || "",
      auditSource: auditRow?.source || "",
      auditMatchType: auditMatch.matchType,
      aiCitabilityScore: auditRow?.aiCitabilityScore ?? "",
      issues,
      linkedPrompts,
      competitors,
      refreshPriority,
    };
  }).sort((a, b) => b.refreshPriority - a.refreshPriority || (Number(a.aiCitabilityScore || 100) - Number(b.aiCitabilityScore || 100)));

  const linkedPostTitlesByProduct = new Map();
  for (const post of postRows) {
    for (const handle of post.knownProductHandles) {
      const list = linkedPostTitlesByProduct.get(handle) || [];
      list.push(post.title);
      linkedPostTitlesByProduct.set(handle, list);
    }
  }
  const productRows = products.map((product) => {
    const linkedPosts = [...new Set(linkedPostTitlesByProduct.get(product.handle) || [])];
    const verticals = [...new Set(verticalsByProduct.get(product.handle) || [])];
    return {
      title: product.title,
      handle: product.handle,
      productType: product.productType || "",
      price: product.price || "",
      verticals,
      topics: [...new Set(verticals.map(topicForVertical))],
      blogLinkPostCount: linkedPosts.length,
      linkedPosts,
      hasPhotos: Boolean(product.hasPhotos),
      photoCount: product.photoCount || 0,
    };
  }).sort((a, b) => b.blogLinkPostCount - a.blogLinkPostCount || a.title.localeCompare(b.title));

  const highRiskTopics = new Set((matrix.topicMatrix || []).filter((row) => row.riskScore >= 58).map((row) => row.topic));
  const productGaps = productRows
    .filter((row) => row.blogLinkPostCount === 0 && row.topics.some((topic) => highRiskTopics.has(topic)))
    .map((row) => ({
      ...row,
      reason: `No detected blog links; maps to high-risk topic(s): ${row.topics.filter((topic) => highRiskTopics.has(topic)).join(", ")}`,
    }))
    .slice(0, 120);

  const duplicateRows = duplicatePairs(audit.rows || []);
  const matchedPosts = postRows.filter((row) => row.auditMatchType !== "none" && row.auditMatchType !== "blocked_or_failed").length;
  const linkedProducts = productRows.filter((row) => row.blogLinkPostCount > 0).length;
  const productReadiness = productReadinessRows[0] || {};
  const zeroDbTrackedPosts = postRows.filter((row) => row.relationProductHandles.length === 0).length;
  const zeroDetectedProductPosts = postRows.filter((row) => row.knownProductHandles.length === 0).length;
  const productsWithoutVerticals = productRows.filter((row) => row.verticals.length === 0).length;
  const unknownProductHandles = [...new Set(postRows.flatMap((row) => row.unknownProductHandles))].sort();
  const summary = {
    companyId: COMPANY_ID,
    localPosts: posts.length,
    shopifySynced: posts.filter((post) => post.shopifyArticleId).length,
    sitemapPages: audit.summary.total,
    auditedPages: audit.summary.ok,
    matchedPosts,
    unmatchedPosts: posts.length - matchedPosts,
    products: products.length,
    linkedProducts,
    unlinkedProducts: products.length - linkedProducts,
    unlinkedProductRate: pct(products.length - linkedProducts, products.length),
    duplicatePairs: duplicateRows.length,
    duplicateSlugs: duplicateSlugRows.length,
    avgPostProducts: Math.round((postRows.reduce((sum, row) => sum + row.productLinkCount, 0) / Math.max(1, postRows.length)) * 10) / 10,
    zeroDbTrackedPosts,
    zeroDetectedProductPosts,
    productsWithoutVerticals,
    unknownProductHandles: unknownProductHandles.length,
    productReadiness,
  };

  const topicRows = [...postRows.reduce((map, row) => {
    const key = row.topic;
    const bucket = map.get(key) || {
      topic: key,
      posts: 0,
      products: new Set(),
      avgScore: 0,
      scoreCount: 0,
      avgPageScore: 0,
      pageScoreCount: 0,
    };
    bucket.posts += 1;
    if (row.overallScore !== null && row.overallScore !== undefined && row.overallScore !== "") {
      bucket.avgScore += Number(row.overallScore);
      bucket.scoreCount += 1;
    }
    if (row.aiCitabilityScore !== "") {
      bucket.avgPageScore += Number(row.aiCitabilityScore);
      bucket.pageScoreCount += 1;
    }
    for (const handle of row.knownProductHandles) bucket.products.add(handle);
    map.set(key, bucket);
    return map;
  }, new Map()).values()].map((row) => ({
    topic: row.topic,
    posts: row.posts,
    uniqueProducts: row.products.size,
    avgOverallScore: row.scoreCount ? Math.round(row.avgScore / row.scoreCount) : "",
    avgPageScore: row.pageScoreCount ? Math.round(row.avgPageScore / row.pageScoreCount) : "",
  })).sort((a, b) => b.posts - a.posts);

  const outDir = path.join(benchmarkDir, "blog-inventory-audit");
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "blog-inventory-audit-data.json"), JSON.stringify({
    summary,
    postRows: postRows.map(({ html, markdown, ...row }) => row),
    productRows,
    topicRows,
    productGaps,
    duplicateRows,
    duplicateSlugRows,
    unknownProductHandles,
  }, null, 2));
  await writeFile(path.join(outDir, "post-inventory.csv"), csv([
    ["refresh_priority", "title", "slug", "vertical", "topic", "status", "shopify_article_id", "overall_score", "word_count", "product_link_count", "product_handles", "audit_url", "audit_match_type", "audit_status", "ai_citability_score", "issues", "linked_prompts", "competitors"],
    ...postRows.map((row) => [
      row.refreshPriority,
      row.title,
      row.slug,
      row.vertical,
      row.topic,
      row.status,
      row.shopifyArticleId,
      row.overallScore,
      row.wordCount,
      row.productLinkCount,
      row.knownProductHandles,
      row.auditUrl,
      row.auditMatchType,
      row.auditStatus,
      row.aiCitabilityScore,
      row.issues,
      row.linkedPrompts,
      row.competitors,
    ]),
  ]));
  await writeFile(path.join(outDir, "product-spread.csv"), csv([
    ["blog_link_post_count", "title", "handle", "product_type", "price", "verticals", "topics", "linked_posts", "has_photos", "photo_count"],
    ...productRows.map((row) => [
      row.blogLinkPostCount,
      row.title,
      row.handle,
      row.productType,
      row.price,
      row.verticals,
      row.topics,
      row.linkedPosts,
      row.hasPhotos,
      row.photoCount,
    ]),
  ]));
  await writeFile(path.join(outDir, "unlinked-product-opportunities.csv"), csv([
    ["title", "handle", "verticals", "topics", "reason"],
    ...productGaps.map((row) => [row.title, row.handle, row.verticals, row.topics, row.reason]),
  ]));
  await writeFile(path.join(outDir, "possible-duplicate-pages.csv"), csv([
    ["similarity", "title_a", "url_a", "title_b", "url_b", "category_a", "category_b"],
    ...duplicateRows.map((row) => [row.score, row.titleA, row.urlA, row.titleB, row.urlB, row.categoryA, row.categoryB]),
  ]));
  await writeFile(path.join(outDir, "topic-product-spread.csv"), csv([
    ["topic", "posts", "unique_products_linked", "avg_overall_score", "avg_page_score"],
    ...topicRows.map((row) => [row.topic, row.posts, row.uniqueProducts, row.avgOverallScore, row.avgPageScore]),
  ]));
  await writeFile(path.join(outDir, "product-readiness-summary.csv"), csv([
    ["metric", "count"],
    ["total_products", productReadiness.total || 0],
    ["missing_url", productReadiness.missingUrl || 0],
    ["missing_image", productReadiness.missingImage || 0],
    ["missing_price", productReadiness.missingPrice || 0],
    ["missing_sku", productReadiness.missingSku || 0],
    ["missing_availability", productReadiness.missingAvailability || 0],
    ["missing_specs", productReadiness.missingSpecs || 0],
    ["missing_compatibility", productReadiness.missingCompatibility || 0],
    ["has_photos_flag", productReadiness.hasPhotos || 0],
    ["without_vertical_mapping", productsWithoutVerticals],
    ["unknown_product_handles_in_posts", unknownProductHandles.length],
    ["duplicate_local_slugs", duplicateSlugRows.length],
  ]));

  await writeSvgAndPng(outDir, "topic-product-spread", barChart({
    title: "Blog Posts And Product Spread By Topic",
    subtitle: "Bar value is unique linked products; note shows post count.",
    rows: topicRows.map((row) => ({
      label: row.topic,
      value: row.uniqueProducts,
      note: `${row.posts} posts; avg page score ${row.avgPageScore || "n/a"}`,
    })),
    color: "#2563eb",
  }));
  await writeSvgAndPng(outDir, "top-linked-products", barChart({
    title: "Most Reused Products In Blog Posts",
    subtitle: "High reuse is fine for heroes, but product spread should broaden over time.",
    rows: productRows.slice(0, 16).map((row) => ({
      label: row.title,
      value: row.blogLinkPostCount,
      note: row.verticals.slice(0, 3).join(", "),
    })),
    color: "#16a34a",
  }));
  await writeSvgAndPng(outDir, "post-refresh-priorities", barChart({
    title: "Highest Priority Post Refreshes",
    subtitle: "Combines benchmark/page priority, missing structures, and product coverage.",
    rows: postRows.slice(0, 16).map((row) => ({
      label: row.title,
      value: row.refreshPriority,
      note: `${row.topic}; ${row.issues.slice(0, 2).join(", ")}`,
    })),
    color: "#7c3aed",
    maxValue: 100,
  }));
  await writeSvgAndPng(outDir, "inventory-match-status", barChart({
    title: "Inventory Match Status",
    subtitle: "Local blog posts matched against public sitemap/audit pages.",
    rows: [
      { label: "Matched to public/local audit", value: summary.matchedPosts, note: `${pct(summary.matchedPosts, summary.localPosts)}% of local posts` },
      { label: "Not matched to audit", value: summary.unmatchedPosts, note: "Needs URL/sitemap/admin verification" },
      { label: "Linked products", value: summary.linkedProducts, note: `${pct(summary.linkedProducts, summary.products)}% of catalog` },
      { label: "Unlinked products", value: summary.unlinkedProducts, note: `${summary.unlinkedProductRate}% of catalog` },
    ],
    color: "#f97316",
    maxValue: Math.max(summary.localPosts, summary.products),
  }));

  await writeFile(path.join(outDir, "REPORT.md"), `# iBOLT Blog Inventory And Product Spread Audit

## Summary

- Local published posts: ${summary.localPosts}
- Posts synced to Shopify: ${summary.shopifySynced}
- Public sitemap pages: ${summary.sitemapPages}
- Audited pages available: ${summary.auditedPages}
- Local posts matched to audit: ${summary.matchedPosts}/${summary.localPosts}
- Catalog products: ${summary.products}
- Products linked from at least one blog post: ${summary.linkedProducts}/${summary.products}
- Unlinked products: ${summary.unlinkedProducts} (${summary.unlinkedProductRate}%)
- Average detected products per local post: ${summary.avgPostProducts}
- Posts with zero DB-tracked product rows: ${summary.zeroDbTrackedPosts}
- Posts with zero detected catalog product links: ${summary.zeroDetectedProductPosts}
- Products without vertical mappings: ${summary.productsWithoutVerticals}
- Unknown product handles found in post bodies: ${summary.unknownProductHandles}
- Duplicate local slugs: ${summary.duplicateSlugs}
- Possible duplicate/cannibalized page pairs: ${summary.duplicatePairs}

## Main Takeaways

The blog system is large enough to support AI visibility work, but the product spread is concentrated. The audit detected ${summary.linkedProducts} linked products out of ${summary.products}, so future refreshes should intentionally cover more products rather than reusing the same hero SKUs. The local-to-live matching also needs cleanup because ${summary.unmatchedPosts} local posts did not match the public audit cleanly. Product data also needs cleanup: ${productReadiness.missingAvailability || 0} products are missing availability, ${productReadiness.missingSpecs || 0} are missing specs, and ${productReadiness.missingCompatibility || 0} are missing compatibility fields.

## Priority Files

- post-inventory.csv
- product-spread.csv
- unlinked-product-opportunities.csv
- possible-duplicate-pages.csv
- topic-product-spread.csv
- product-readiness-summary.csv
`);
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({
    summary,
    postRows,
    productRows,
    duplicateRows,
    productGaps,
    charts: [
      "post-refresh-priorities.svg",
      "topic-product-spread.svg",
      "top-linked-products.svg",
      "inventory-match-status.svg",
    ],
  }));

  console.log(path.relative(process.cwd(), outDir));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
