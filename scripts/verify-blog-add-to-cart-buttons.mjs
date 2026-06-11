import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const SHOPIFY_SHOP = process.env.SHOPIFY_SHOP || "iboltmounts";
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN;
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";
const STORE_ORIGIN = process.env.IBOLT_STORE_ORIGIN || "https://iboltmounts.com";

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
const outputDir = path.join("content-output", "add-to-cart-cta", `verification-${runStamp}`);
fs.mkdirSync(outputDir, { recursive: true });

function decodeHtmlAttribute(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
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

function shopifyAdminUrl(endpoint) {
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  return `https://${SHOPIFY_SHOP}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/${endpoint}`;
}

async function shopifyFetch(endpoint) {
  const response = await fetch(shopifyAdminUrl(endpoint), {
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_TOKEN,
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Shopify GET ${endpoint} failed: ${response.status} ${text.slice(0, 800)}`);
  }
  return {
    data: text ? JSON.parse(text) : {},
    link: response.headers.get("link") || "",
  };
}

async function paginate(endpoint, key) {
  const rows = [];
  let next = endpoint;
  while (next) {
    const { data, link } = await shopifyFetch(next);
    rows.push(...(data[key] || []));
    next = nextPageUrl(link);
  }
  return rows;
}

function stripGeneratedCtas(html) {
  return String(html || "")
    .replace(/\s*<div\b[^>]*data-ibolt-add-to-cart-group=["'][^"']*["'][^>]*>[\s\S]*?<\/div>\s*/gi, "\n")
    .replace(/\s*<p\b[^>]*data-ibolt-add-to-cart-group=["'][^"']*["'][^>]*>[\s\S]*?<\/p>\s*/gi, "\n")
    .replace(/\s*<a\b[^>]*data-ibolt-add-to-cart=["'][^"']*["'][^>]*>[\s\S]*?<\/a>\s*/gi, "\n");
}

function productHandleFromHref(rawHref) {
  const href = decodeHtmlAttribute(rawHref).trim();
  if (!href || href.startsWith("#")) return null;

  let url;
  try {
    url = new URL(href.startsWith("//") ? `https:${href}` : href, STORE_ORIGIN);
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

function productLinks(html) {
  const links = [];
  const hrefPattern = /<a\b[^>]*\bhref=(["'])(.*?)\1[^>]*>/gi;
  let match;
  while ((match = hrefPattern.exec(html))) {
    const handle = productHandleFromHref(match[2]);
    if (handle) {
      links.push({
        handle,
        start: match.index,
        end: hrefPattern.lastIndex,
        anchor: match[0],
      });
    }
  }
  return links;
}

function ctaHandles(html) {
  const handles = [];
  const pattern = /data-ibolt-add-to-cart=(["'])(.*?)\1/gi;
  let match;
  while ((match = pattern.exec(html))) {
    handles.push(decodeHtmlAttribute(match[2]).trim());
  }
  return handles.filter(Boolean);
}

function matchingCtaCount(html, handle) {
  return ctaHandles(html).filter((item) => item === handle).length;
}

function smallestContainingBlock(html, index) {
  const blocks = [];
  const blockPattern = /<(p|li|td|div)\b[^>]*>[\s\S]*?<\/\1>/gi;
  let match;
  while ((match = blockPattern.exec(html))) {
    const start = match.index;
    const end = blockPattern.lastIndex;
    if (start <= index && index < end) {
      blocks.push({ start, end, html: match[0] });
    }
  }
  blocks.sort((a, b) => (a.end - a.start) - (b.end - b.start));
  return blocks[0] || null;
}

function containingTextBlock(html, index) {
  const before = html.slice(0, index);
  const lastParagraph = Math.max(before.lastIndexOf("<p"), before.lastIndexOf("<li"));
  const lastParagraphClose = Math.max(before.lastIndexOf("</p>"), before.lastIndexOf("</li>"));
  if (lastParagraph === -1 || lastParagraph < lastParagraphClose) return null;

  const after = html.slice(lastParagraph);
  const endMatch = after.match(/<\/(?:p|li)>/i);
  if (!endMatch?.index) return null;

  return after.slice(0, endMatch.index + endMatch[0].length);
}

function isMultiProductInlineLink(html, link) {
  const block = containingTextBlock(html, link.start);
  if (!block) return false;
  return unique(productLinks(stripGeneratedCtas(block)).map((item) => item.handle)).length > 1;
}

function unique(values) {
  return Array.from(new Set(values));
}

function verifyArticle(article, blog) {
  const html = article.body_html || "";
  const linksWithoutCtas = productLinks(stripGeneratedCtas(html));
  const liveProductLinks = productLinks(html).filter((link) => !/data-ibolt-add-to-cart/i.test(link.anchor));
  const articleCtas = ctaHandles(html);
  const failures = [];

  for (const link of liveProductLinks) {
    if (isMultiProductInlineLink(html, link)) continue;

    const block = smallestContainingBlock(html, link.start);
    const region = block
      ? html.slice(block.start, Math.min(html.length, block.end + 5000))
      : html.slice(link.end, link.end + 5000);
    const count = matchingCtaCount(region, link.handle);
    if (count === 0) {
      failures.push({
        handle: link.handle,
        reason: "missing nearby matching Add to Cart CTA",
        ctaCount: count,
        snippet: region.replace(/\s+/g, " ").slice(0, 600),
      });
    }
  }

  const expectedArticleHandles = new Set(linksWithoutCtas.map((link) => link.handle));
  for (const handle of articleCtas) {
    if (!expectedArticleHandles.has(handle)) {
      failures.push({
        handle,
        reason: "Add to Cart CTA handle does not match a product link in the article",
      });
    }
  }

  return {
    blogId: blog.id,
    blogHandle: blog.handle,
    articleId: article.id,
    articleTitle: article.title,
    articleHandle: article.handle,
    publicUrl: `${STORE_ORIGIN}/blogs/${blog.handle}/${article.handle}`,
    productLinkCount: linksWithoutCtas.length,
    addToCartCount: articleCtas.length,
    productHandles: unique(linksWithoutCtas.map((link) => link.handle)),
    failures,
  };
}

async function main() {
  const blogs = await paginate("blogs.json?limit=250", "blogs");
  const articles = [];
  for (const blog of blogs) {
    const rows = await paginate(
      `blogs/${blog.id}/articles.json?limit=250&fields=id,title,handle,body_html,published_at,updated_at`,
      "articles",
    );
    articles.push(...rows.map((article) => ({ blog, article })));
  }

  const results = articles
    .map(({ blog, article }) => verifyArticle(article, blog))
    .filter((result) => result.productLinkCount > 0 || result.addToCartCount > 0);

  const failures = results.flatMap((result) =>
    result.failures.map((failure) => ({
      blogId: result.blogId,
      articleId: result.articleId,
      articleTitle: result.articleTitle,
      publicUrl: result.publicUrl,
      ...failure,
    })),
  );

  const manifest = {
    generatedAt: new Date().toISOString(),
    shop: SHOPIFY_SHOP,
    storeOrigin: STORE_ORIGIN,
    outputDir: path.resolve(outputDir),
    totals: {
      blogs: blogs.length,
      articlesChecked: articles.length,
      articlesWithProductLinks: results.filter((result) => result.productLinkCount > 0).length,
      productLinks: results.reduce((sum, result) => sum + result.productLinkCount, 0),
      addToCartButtons: results.reduce((sum, result) => sum + result.addToCartCount, 0),
      articlesWithFailures: results.filter((result) => result.failures.length > 0).length,
      failures: failures.length,
    },
    failures,
    articles: results,
  };

  fs.writeFileSync(path.join(outputDir, "verification.json"), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest.totals, null, 2));
  console.log(`Verification: ${path.resolve(outputDir, "verification.json")}`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
