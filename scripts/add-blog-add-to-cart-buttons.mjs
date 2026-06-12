import "dotenv/config";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const SHOPIFY_SHOP = process.env.SHOPIFY_SHOP || "iboltmounts";
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN;
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";
const STORE_ORIGIN = process.env.IBOLT_STORE_ORIGIN || "https://iboltmounts.com";
const DB_PATH = process.env.DATABASE_PATH || (fs.existsSync("data/standalone-blog-writer.db") ? "data/standalone-blog-writer.db" : "data/sourceannotator.db");

const APPLY = process.argv.includes("--apply");
const ARTICLE_FILTER = valueArg("--article");
const BLOG_FILTER = valueArg("--blog");
const LIMIT = numericArg("--limit");

const RETIRED_PRODUCT_HANDLE_REPLACEMENTS = {
  "ibolt-garmin-striker-4-fish-finder-incredibolt-clamp-handlebar-rail-mount": "ibolt-garmin-striker-4-fish-finder-incredibolt-360-clamp-handlebar-rail-mount",
  "ibolt-25mm-1-inch-composite-universal-marine-fish-finder-mounting-plate": "ibolt-25mm-1-inch-ball-composite-universal-marine-fish-finder-mounting-plate",
  "ibolt-lockpro-metal-locking-tablet-drill-base-mount": "ibolt-lockpro-metal-locking-tablet-drill-base-mount-ibbz-33779",
  "ibolt-tablet-tower-tabdock-pos-wall-mount-with-3-tablet-holders": "ibolt-tablet-tower-tabdock-point-of-purchase-pos-wall-mount-with-3-tablet-holders",
  "xprodock-bizmount-amps-smartphone-drill-base-mount": "xprodock-bizmount-amps-smartphone-drill-base-mount-ibbz-33931",
  "heavy-duty-smartphone-suction-cup-mount-xprodock-bizmount": "heavy-duty-smartphone-suction-cup-mount-xprodock-bizmount-ibbz-33785",
  "xprodock-bizmount-wedge-smartphone-seat-wedge-mount": "xprodock-bizmount-wedge-smartphone-seat-wedge-mount-ibbz-33930",
  "ibolt-moto-vise-xl-smartphone-holder-25mm-1-inch-ball": "ibolt-moto-vise-xl-smartphone-holder-25mm-1-inch-ball-ibpb-33893",
  "ibolt-phone-dock-n-lock-incredibolt-amps-w-4-25-double-socket-arm-locking-drill-base-mount-for-smartphones": "ibolt-phone-dock-n-lock-incredibolt-amps-w-4-25-double-socket-arm-locking-drill-base-mount-for-smartphones-great-for-trucks-eld-s-wall-mounting-sprinter-vans-etc",
  "ibolt-20mm-to-25mm-composite-ball-adapter": "ibolt-20mm-to-25mm-1-inch-aluminum-extension-ball-adapter-for-industry-standard-dual-ball-socket-mounting-arms",
  "ibolt-tabdock-bizmount-amps-heavy-duty-drill-base-tablet-mount-ibbz-33921": "tabdock-bizmount-amps-heavy-duty-drill-base-tablet-mount-ibbz-33921",
  "ibolt-dock-n-lock-bizmount\u2122-forklift-locking-tablet-mount": "ibolt-dock-n-lock-bizmount-forklift-locking-tablet-mount",
  "tabdock-bizmount-console-heavy-duty-cup-holder-mount": "tabdock-bizmount-console-heavy-duty-cup-holder-mount-ibbz-33784",
  "xprodock-bizmount-console-heavy-duty-phone-cup-holder-mount-xbz-33782": "xprodock-bizmount-console-heavy-duty-phone-cup-holder-mount",
  "ibolt-17mm-dual-ball-to-cup-holder-mount-base-compatible-w-garmin-gps-and-ibolt-phone-holders-15186": "ibolt-17mm-dual-ball-to-cup-holder-mount-base-compatible-w-garmin-gps-and-ibolt-phone-holders",
  "ibolt-clamp-base-for-4-hole-amps-mounts-14130": "ibolt-clamp-base-for-4-hole-amps-mounts",
  "ibolt\u212225mm-1-inch-ball-to-clamp-post-pole-handlebar-mount-22169": "ibolt-25mm-1-inch-ball-to-clamp-post-pole-handlebar-mount-base-adapter",
  "ibolt-20mm-adjustable-aluminum-ball-cup-holder-mount-14140": "ibolt-20mm-adjustable-aluminum-ball-cup-holder-mount",
  "ibolt-action-camera-inch-20-dual-bizmount-cup-holder-mount-22104": "ibolt-action-camera-inch-20-dual-bizmount-cup-holder-mount",
  "ibolt-action-camera-inch-20-bizmount-cup-holder-mount-22103": "ibolt-action-camera-inch-20-bizmount-cup-holder-mount",
  "ibolt-25mm-1-inch-metal-amps-adapter-plate": "25mm-1-inch-b-size-metal-amps-pattern-adapter-plate-ibpb-33890",
};

if (!SHOPIFY_TOKEN) {
  throw new Error("SHOPIFY_ACCESS_TOKEN or SHOPIFY_ADMIN_API_ACCESS_TOKEN is required.");
}

const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.join("content-output", "add-to-cart-cta", runStamp);
fs.mkdirSync(outputDir, { recursive: true });

function valueArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function numericArg(name) {
  const value = valueArg(name);
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return Math.floor(parsed);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function decodeHtmlAttribute(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function shopifyAdminUrl(endpoint) {
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  return `https://${SHOPIFY_SHOP}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/${endpoint}`;
}

async function shopifyFetch(method, endpoint, body) {
  const response = await fetch(shopifyAdminUrl(endpoint), {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_TOKEN,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Shopify ${method} ${endpoint} failed: ${response.status} ${text.slice(0, 800)}`);
  }

  return {
    data: text ? JSON.parse(text) : {},
    link: response.headers.get("link") || "",
  };
}

function nextPageUrl(linkHeader) {
  if (!linkHeader) return null;
  const match = linkHeader
    .split(",")
    .map((part) => part.trim())
    .find((part) => /rel="next"/.test(part))
    ?.match(/<([^>]+)>/);
  return match?.[1] || null;
}

async function paginate(endpoint, key) {
  const rows = [];
  let next = endpoint;
  while (next) {
    const { data, link } = await shopifyFetch("GET", next);
    rows.push(...(data[key] || []));
    next = nextPageUrl(link);
    await sleep(250);
  }
  return rows;
}

function productHandleFromHref(rawHref) {
  const href = decodeHtmlAttribute(rawHref).trim();
  if (!href || href.startsWith("#") || /^mailto:/i.test(href) || /^tel:/i.test(href)) return null;

  let url;
  try {
    if (href.startsWith("//")) {
      url = new URL(`https:${href}`);
    } else {
      url = new URL(href, STORE_ORIGIN);
    }
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  const storeHostname = new URL(STORE_ORIGIN).hostname.toLowerCase().replace(/^www\./, "");
  if (hostname !== storeHostname && hostname !== `${SHOPIFY_SHOP}.myshopify.com`) return null;

  const match = url.pathname.match(/^\/products\/([^/?#]+)\/?$/i);
  if (!match) return null;
  const handle = decodeURIComponent(match[1]).trim();
  return RETIRED_PRODUCT_HANDLE_REPLACEMENTS[handle] || handle;
}

function productHandlesInHtml(html) {
  const handles = [];
  const hrefPattern = /<a\b[^>]*\bhref=(["'])(.*?)\1[^>]*>/gi;
  let match;
  while ((match = hrefPattern.exec(html))) {
    const handle = productHandleFromHref(match[2]);
    if (handle) handles.push(handle);
  }
  return Array.from(new Set(handles));
}

function visibleProductHandlesInHtml(html, productMap) {
  return productHandlesInHtml(html).filter((handle) => productMap.has(handle));
}

function stripGeneratedCtas(html) {
  let next = html;
  const patterns = [
    /\s*<div\b[^>]*data-ibolt-add-to-cart-group=["'][^"']*["'][^>]*>[\s\S]*?<\/div>\s*/gi,
    /\s*<p\b[^>]*data-ibolt-add-to-cart-group=["'][^"']*["'][^>]*>[\s\S]*?<\/p>\s*/gi,
    /\s*<a\b[^>]*data-ibolt-add-to-cart=["'][^"']*["'][^>]*>[\s\S]*?<\/a>\s*/gi,
  ];
  for (const pattern of patterns) {
    next = next.replace(pattern, "\n");
  }
  return next;
}

function replaceRetiredProductLinks(html) {
  return String(html || "").replace(/(<a\b[^>]*\bhref=(["']))(.*?)(\2[^>]*>)/gi, (full, prefix, quote, rawHref, suffix) => {
    const href = decodeHtmlAttribute(rawHref).trim();
    let url;
    try {
      url = new URL(href.startsWith("//") ? `https:${href}` : href, STORE_ORIGIN);
    } catch {
      return full;
    }

    const match = url.pathname.match(/^\/products\/([^/?#]+)\/?$/i);
    if (!match) return full;
    const oldHandle = decodeURIComponent(match[1]).trim();
    const newHandle = RETIRED_PRODUCT_HANDLE_REPLACEMENTS[oldHandle];
    if (!newHandle) return full;
    return `${prefix}${STORE_ORIGIN}/products/${encodeURIComponent(newHandle)}${suffix}`;
  });
}

function buttonGroup(handles, productMap, compact = false) {
  const buttons = handles
    .map((handle) => productMap.get(handle))
    .filter(Boolean)
    .map((product) => {
      const label = compact ? "Add to Cart" : `Add ${escapeHtml(product.shortTitle)} to Cart`;
      const aria = `Add ${escapeHtml(product.title)} to cart`;
      return `<a data-ibolt-add-to-cart="${escapeHtml(product.handle)}" href="${STORE_ORIGIN}/cart/add?id=${product.variantId}&quantity=1" aria-label="${aria}" style="display:inline-block; padding:10px 16px; border-radius:4px; background:#111827; background-image:none; box-shadow:none; color:#ffffff; text-decoration:none; font-weight:700; font-size:14px; line-height:1.2;">${label}</a>`;
    });

  if (!buttons.length) return "";

  return `<div data-ibolt-add-to-cart-group="true" style="margin:10px 0 18px; display:flex; flex-wrap:wrap; gap:10px; align-items:center;">${buttons.join(" ")}</div>`;
}

function isInsideOpenImageProductDiv(html, offset) {
  const before = html.slice(Math.max(0, offset - 3000), offset);
  const lastOpenDiv = before.lastIndexOf("<div");
  const lastCloseDiv = before.lastIndexOf("</div>");
  if (lastOpenDiv === -1 || lastOpenDiv < lastCloseDiv) return false;

  const openDivContent = before.slice(lastOpenDiv);
  return /<img\b/i.test(openDivContent) && /\/products\//i.test(openDivContent);
}

function isInsideMultiProductTextBlock(html, offset, productMap) {
  const before = html.slice(0, offset);
  const lastParagraph = Math.max(before.lastIndexOf("<p"), before.lastIndexOf("<li"));
  const lastParagraphClose = Math.max(before.lastIndexOf("</p>"), before.lastIndexOf("</li>"));
  if (lastParagraph === -1 || lastParagraph < lastParagraphClose) return false;

  const after = html.slice(lastParagraph);
  const endMatch = after.match(/<\/(?:p|li)>/i);
  if (!endMatch?.index) return false;

  const block = after.slice(0, endMatch.index + endMatch[0].length);
  return visibleProductHandlesInHtml(block, productMap).length > 1;
}

function shortTitle(title) {
  const cleaned = String(title || "This Product")
    .replace(/\s+-\s+iBOLT Mounts$/i, "")
    .replace(/^iBOLT(?:™|&trade;)?\s*/i, "iBOLT ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= 34) return cleaned;
  return "This Product";
}

function articleBackupName(blog, article, suffix) {
  const safeTitle = String(article.title || article.id)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  return `${blog.id}-${article.id}-${safeTitle}.${suffix}.html`;
}

function insertCtas(html, productMap) {
  const originalProductHandles = visibleProductHandlesInHtml(html, productMap);
  if (!originalProductHandles.length) {
    return {
      html,
      changed: false,
      productHandles: [],
      insertedButtons: 0,
    };
  }

  let next = replaceRetiredProductLinks(stripGeneratedCtas(html));
  let insertedButtons = 0;

  next = next.replace(/<div\b[^>]*>[\s\S]*?<\/div>/gi, (block) => {
    if (!/<img\b/i.test(block)) return block;
    const handles = visibleProductHandlesInHtml(block, productMap);
    if (!handles.length) return block;
    insertedButtons += handles.length;
    return block.replace(/<\/div>\s*$/i, `${buttonGroup(handles, productMap, true)}\n</div>`);
  });

  next = next.replace(/<td\b[^>]*>[\s\S]*?<\/td>/gi, (block) => {
    if (/<img\b/i.test(block)) return block;
    const handles = visibleProductHandlesInHtml(block, productMap);
    if (!handles.length) return block;
    insertedButtons += handles.length;
    return block.replace(/<\/td>\s*$/i, `${buttonGroup(handles, productMap, true)}</td>`);
  });

  next = next.replace(/<(p|li)\b[^>]*>[\s\S]*?<\/\1>/gi, (block, _tag, offset, fullHtml) => {
    if (/<img\b/i.test(block) || /data-ibolt-add-to-cart/i.test(block)) return block;
    if (isInsideOpenImageProductDiv(fullHtml, offset)) return block;
    const handles = visibleProductHandlesInHtml(block, productMap);
    if (!handles.length) return block;
    if (handles.length > 1) return block;
    insertedButtons += handles.length;
    return `${block}\n${buttonGroup(handles, productMap, false)}`;
  });

  next = next.replace(/<a\b[^>]*\bhref=(["'])(.*?)\1[^>]*>[\s\S]*?<\/a>/gi, (anchor, _quote, rawHref, offset, fullHtml) => {
    if (/data-ibolt-add-to-cart/i.test(anchor) || /\/cart\/add/i.test(rawHref)) return anchor;
    const handle = productHandleFromHref(rawHref);
    if (!handle || !productMap.has(handle)) return anchor;
    if (isInsideMultiProductTextBlock(fullHtml, offset, productMap)) return anchor;
    if (hasNearbyCtaForHandle(fullHtml, offset, anchor.length, handle)) return anchor;
    insertedButtons += 1;
    return `${anchor}\n${buttonGroup([handle], productMap, true)}`;
  });

  const changed = next !== html;
  return {
    html: next,
    changed,
    productHandles: originalProductHandles,
    insertedButtons,
  };
}

async function fetchProductMap() {
  const products = [];
  let page = 1;

  while (true) {
    const url = `${STORE_ORIGIN}/products.json?limit=250&page=${page}`;
    const response = await fetch(url, {
      headers: { "User-Agent": "iBOLTBlogAddToCartUpdater/1.0" },
    });
    if (!response.ok) throw new Error(`Public products fetch failed on page ${page}: ${response.status}`);
    const data = await response.json();
    const pageProducts = data.products || [];
    products.push(...pageProducts);
    if (pageProducts.length < 250) break;
    page += 1;
    await sleep(150);
  }

  const productMap = new Map();
  for (const product of products) {
    const availableVariant = (product.variants || []).find((variant) => variant.available !== false && variant.id);
    const variant = availableVariant || (product.variants || []).find((item) => item.id);
    if (!product.handle || !variant?.id) continue;
    productMap.set(product.handle, {
      handle: product.handle,
      title: product.title || product.handle,
      shortTitle: shortTitle(product.title || product.handle),
      variantId: Number(variant.id),
      variantTitle: variant.title || "",
      available: variant.available !== false,
    });
  }
  return productMap;
}

async function fetchProductByHandle(handle) {
  const response = await fetch(`${STORE_ORIGIN}/products/${encodeURIComponent(handle)}.js`, {
    headers: { "User-Agent": "iBOLTBlogAddToCartUpdater/1.0" },
  });
  if (!response.ok) return null;

  const product = await response.json();
  const availableVariant = (product.variants || []).find((variant) => variant.available !== false && variant.id);
  const variant = availableVariant || (product.variants || []).find((item) => item.id);
  if (!product.handle || !variant?.id) return null;

  return {
    handle: product.handle,
    title: product.title || product.handle,
    shortTitle: shortTitle(product.title || product.handle),
    variantId: Number(variant.id),
    variantTitle: variant.title || "",
    available: variant.available !== false,
  };
}

async function enrichProductMapFromHandles(productMap, handles) {
  const missing = unique(handles).filter((handle) => !productMap.has(handle));
  const unresolved = [];

  for (const handle of missing) {
    const product = await fetchProductByHandle(handle);
    if (product) {
      productMap.set(handle, product);
    } else {
      unresolved.push(handle);
    }
    await sleep(100);
  }

  return unresolved;
}

function unique(values) {
  return Array.from(new Set(values));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasNearbyCtaForHandle(html, offset, anchorLength, handle) {
  const before = html.slice(Math.max(0, offset - 900), offset);
  const after = html.slice(offset + anchorLength, Math.min(html.length, offset + anchorLength + 1800));
  const pattern = new RegExp(`data-ibolt-add-to-cart=(["'])${escapeRegExp(handle)}\\1`, "i");
  return pattern.test(before) || pattern.test(after);
}

function updateLocalDb(results) {
  if (!APPLY || !fs.existsSync(DB_PATH)) return { attempted: false, updated: 0 };

  const db = new Database(DB_PATH);
  let updated = 0;
  try {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'blog_posts'").get();
    if (!table) return { attempted: true, updated: 0, skipped: "blog_posts table not found" };

    const stmt = db.prepare(`
      UPDATE blog_posts
      SET html = ?, updated_at = CURRENT_TIMESTAMP
      WHERE shopify_article_id = ? AND (shopify_blog_id = ? OR shopify_blog_id IS NULL)
    `);
    const tx = db.transaction((rows) => {
      for (const row of rows) {
        const result = stmt.run(row.afterHtml, String(row.articleId), row.blogId);
        updated += result.changes;
      }
    });
    tx(results.filter((result) => result.changed));
  } finally {
    db.close();
  }
  return { attempted: true, updated };
}

async function main() {
  const productMap = await fetchProductMap();
  const blogs = (await paginate("blogs.json?limit=250", "blogs"))
    .filter((blog) => !BLOG_FILTER || String(blog.id) === BLOG_FILTER || blog.handle === BLOG_FILTER);

  const results = [];
  const articleRecords = [];
  let considered = 0;

  for (const blog of blogs) {
    const articles = await paginate(
      `blogs/${blog.id}/articles.json?limit=250&fields=id,title,handle,body_html,published_at,updated_at`,
      "articles",
    );

    for (const article of articles) {
      if (ARTICLE_FILTER && String(article.id) !== ARTICLE_FILTER && article.handle !== ARTICLE_FILTER) continue;
      if (LIMIT && considered >= LIMIT) break;
      considered += 1;
      articleRecords.push({ blog, article });
    }

    if (LIMIT && considered >= LIMIT) break;
  }

  const linkedHandles = articleRecords.flatMap(({ article }) => productHandlesInHtml(replaceRetiredProductLinks(stripGeneratedCtas(article.body_html || ""))));
  const unresolvedProductHandles = await enrichProductMapFromHandles(productMap, linkedHandles);

  for (const { blog, article } of articleRecords) {
    const beforeHtml = article.body_html || "";
    const transformed = insertCtas(beforeHtml, productMap);
    const allArticleProductHandles = productHandlesInHtml(replaceRetiredProductLinks(stripGeneratedCtas(beforeHtml)));
    const unresolvedArticleProductHandles = unique(allArticleProductHandles).filter((handle) => !productMap.has(handle));
    const record = {
      blogId: blog.id,
      blogTitle: blog.title,
      blogHandle: blog.handle,
      articleId: article.id,
      articleTitle: article.title,
      articleHandle: article.handle,
      publicUrl: `${STORE_ORIGIN}/blogs/${blog.handle}/${article.handle}`,
      adminUrl: `https://admin.shopify.com/store/${SHOPIFY_SHOP}/articles/${article.id}`,
      productHandles: transformed.productHandles,
      unresolvedProductHandles: unresolvedArticleProductHandles,
      productLinkCount: allArticleProductHandles.length,
      insertedButtons: transformed.insertedButtons,
      changed: transformed.changed,
      beforeBytes: Buffer.byteLength(beforeHtml, "utf8"),
      afterBytes: Buffer.byteLength(transformed.html, "utf8"),
      afterHtml: transformed.html,
    };
    results.push(record);

    if (!transformed.productHandles.length || !transformed.changed) continue;

    fs.writeFileSync(path.join(outputDir, articleBackupName(blog, article, "before")), beforeHtml);
    fs.writeFileSync(path.join(outputDir, articleBackupName(blog, article, "after")), transformed.html);

    if (APPLY) {
      await shopifyFetch("PUT", `blogs/${blog.id}/articles/${article.id}.json`, {
        article: {
          id: article.id,
          body_html: transformed.html,
        },
      });
      await sleep(600);
    }
  }

  const changedRows = results.filter((result) => result.changed);
  const localDb = updateLocalDb(changedRows);
  const manifest = {
    mode: APPLY ? "apply" : "dry-run",
    generatedAt: new Date().toISOString(),
    shop: SHOPIFY_SHOP,
    storeOrigin: STORE_ORIGIN,
    outputDir: path.resolve(outputDir),
    articleFilter: ARTICLE_FILTER,
    blogFilter: BLOG_FILTER,
    limit: LIMIT,
    totals: {
      blogs: blogs.length,
      consideredArticles: considered,
      articlesWithProductLinks: results.filter((result) => result.productHandles.length > 0).length,
      changedArticles: changedRows.length,
      insertedButtons: changedRows.reduce((sum, row) => sum + row.insertedButtons, 0),
      unresolvedProductHandles: unresolvedProductHandles.length,
      localDbUpdatedRows: localDb.updated,
    },
    unresolvedProductHandles,
    articles: results.map(({ afterHtml, ...result }) => result),
  };

  fs.writeFileSync(path.join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest.totals, null, 2));
  console.log(`Manifest: ${path.resolve(outputDir, "manifest.json")}`);
  if (!APPLY) {
    console.log("Dry run only. Re-run with --apply to update Shopify.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
