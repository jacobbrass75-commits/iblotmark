import "dotenv/config";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const SHOP = (process.env.SHOPIFY_SHOP || "iboltmounts").replace(/\.myshopify\.com$/i, "");
const TOKEN =
  process.env.SHOPIFY_ACCESS_TOKEN ||
  process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN ||
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ||
  "";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";
const AUTHOR = process.argv.find((arg) => arg.startsWith("--author="))?.split("=")[1] || "Katie Hobbs";
const LIMIT = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] || "0");
const ONLY_HANDLE = process.argv.find((arg) => arg.startsWith("--handle="))?.split("=")[1] || "";
const APPLY = process.argv.includes("--apply");
const OUTPUT_DIR =
  process.env.PRODUCT_LINK_OUTPUT_DIR ||
  path.join("content-output", "kattie-hobs-rewrite-2026-07-06", "product-links-photos");
const DB_PATH = process.env.DATABASE_PATH || "data/standalone-blog-writer.db";
const PUBLIC_SHOP = process.env.SHOPIFY_PUBLIC_DOMAIN || "https://iboltmounts.com";

const START_MARKER = "<!-- ibolt-product-links-start -->";
const END_MARKER = "<!-- ibolt-product-links-end -->";

if (!TOKEN) throw new Error("SHOPIFY_ACCESS_TOKEN is required.");

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.mkdirSync(path.join(OUTPUT_DIR, "backups"), { recursive: true });
const db = fs.existsSync(DB_PATH) ? new Database(DB_PATH) : null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function shopifyREST(method, endpoint, body) {
  const url = /^https?:\/\//i.test(endpoint)
    ? endpoint
    : `https://${SHOP}.myshopify.com/admin/api/${API_VERSION}/${endpoint}`;
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": TOKEN,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Shopify ${method} ${endpoint} failed: ${response.status} ${text.slice(0, 1000)}`);
  return { data: text ? JSON.parse(text) : {}, link: response.headers.get("link") || "" };
}

function nextPageUrl(linkHeader) {
  if (!linkHeader) return null;
  const part = linkHeader
    .split(",")
    .map((item) => item.trim())
    .find((item) => /rel="next"/.test(item));
  return part?.match(/<([^>]+)>/)?.[1] || null;
}

async function paginate(endpoint, key) {
  const rows = [];
  let next = endpoint;
  while (next) {
    const { data, link } = await shopifyREST("GET", next);
    rows.push(...(data[key] || []));
    next = nextPageUrl(link);
    await sleep(150);
  }
  return rows;
}

async function fetchPublicProducts() {
  const products = [];
  for (let page = 1; page <= 20; page += 1) {
    const response = await fetch(`${PUBLIC_SHOP}/products.json?limit=250&page=${page}`);
    const text = await response.text();
    if (!response.ok) throw new Error(`Public products fetch failed: ${response.status} ${text.slice(0, 500)}`);
    const data = JSON.parse(text);
    const batch = data.products || [];
    products.push(...batch);
    if (batch.length < 250) break;
    await sleep(150);
  }

  const seen = new Set();
  return products
    .map((product) => {
      const image = product.image?.src || product.images?.[0]?.src || "";
      const handle = String(product.handle || "").trim();
      return {
        id: product.id,
        title: String(product.title || "").trim(),
        handle,
        url: `${PUBLIC_SHOP}/products/${handle}`,
        image,
        body: stripHtml(product.body_html || ""),
        productType: String(product.product_type || "").trim(),
        tags: String(product.tags || "").trim(),
        variants: (product.variants || []).map((variant) => String(variant.title || "")).join(" "),
      };
    })
    .filter((product) => {
      if (!product.title || !product.handle || !product.image) return false;
      if (seen.has(product.handle)) return false;
      seen.add(product.handle);
      if (/^cpb-order-/i.test(product.handle)) return false;
      if (/build your own mount/i.test(product.title) && /^cpb-order-/i.test(product.handle)) return false;
      if (/gift card/i.test(product.title)) return false;
      return true;
    });
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function htmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value) {
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "your",
    "you",
    "are",
    "how",
    "what",
    "why",
    "best",
    "top",
    "guide",
    "mount",
    "mounts",
    "mounting",
    "ibolt",
  ]);
  return new Set(normalize(value).split(" ").filter((word) => word.length > 2 && !stop.has(word)));
}

function extractProductHandles(html) {
  const handles = new Set();
  const regex = /href=["'](?:https?:\/\/(?:www\.)?iboltmounts\.com)?\/products\/([^"'?#/]+)[^"']*["']/gi;
  let match;
  while ((match = regex.exec(html || ""))) handles.add(match[1]);
  return [...handles];
}

function productText(product) {
  return `${product.title} ${product.handle} ${product.productType} ${product.tags} ${product.variants} ${product.body}`;
}

function inferTopics(title, handle, html) {
  const text = normalize(`${title} ${handle}`);
  const topics = [];
  const push = (name, patterns) => {
    if (patterns.some((pattern) => pattern.test(text))) topics.push(name);
  };

  push("marine", [/fish/, /boat/, /marine/, /kayak/, /pontoon/, /garmin/]);
  push("forklift", [/forklift/, /warehouse/, /scanner/, /material handling/, /pillar/]);
  push("fleet", [/truck/, /semi/, /fleet/, /eld/, /driver/, /road trip/, /vehicle/, /car/]);
  push("restaurant", [/restaurant/, /\bpos\b/, /delivery app/, /kitchen/, /tablet tower/]);
  push("creator", [/stream/, /camera/, /youtube/, /creator/, /unboxing/, /livestream/, /overhead/]);
  push("education", [/school/, /student/, /classroom/, /paperless/, /back to school/]);
  push("farm", [/farm/, /farmer/, /tractor/, /agriculture/]);
  push("outdoor", [/bike/, /mountain bike/, /jeep/, /off road/, /outdoor/, /recreation/, /wrangler/]);
  push("amps", [/amps/, /ball joint/, /ball and socket/, /garmin ball/, /screw in/]);
  push("locking", [/lock/, /locking/, /safe/, /security/]);
  push("phone", [/phone/, /smartphone/, /iphone/, /clip on/, /clamp/]);
  push("tablet", [/tablet/, /ipad/, /galaxy a7/, /samsung galaxy/]);
  if (!topics.length) topics.push("general");
  return topics;
}

const topicBoosts = {
  marine: [/fish/, /finder/, /boat/, /marine/, /kayak/, /rail/, /garmin/, /amps/],
  forklift: [/forklift/, /warehouse/, /scanner/, /pillar/, /heavy duty/, /tablet/, /clamp/],
  fleet: [/truck/, /fleet/, /eld/, /semi/, /vehicle/, /car/, /dashboard/, /drill/, /tablet/, /phone/],
  restaurant: [/restaurant/, /tablet tower/, /tower/, /\bpos\b/, /delivery/, /kitchen/, /counter/, /stand/],
  creator: [/stream/, /creator/, /camera/, /action camera/, /overhead/, /phone/, /stand/, /amps/],
  education: [/school/, /student/, /tablet/, /ipad/, /stand/, /wall/, /desk/, /lock/],
  farm: [/farm/, /tractor/, /tablet/, /heavy duty/, /clamp/, /vehicle/],
  outdoor: [/bike/, /bicycle/, /jeep/, /wrangler/, /off road/, /outdoor/, /camera/, /phone/, /handlebar/],
  amps: [/amps/, /ball/, /socket/, /garmin/, /adapter/, /plate/, /screw/],
  locking: [/lock/, /locking/, /security/, /tablet/, /enclosure/],
  phone: [/phone/, /smartphone/, /iphone/, /holder/, /clamp/, /clip/],
  tablet: [/tablet/, /ipad/, /galaxy/, /holder/, /stand/, /cradle/],
  general: [/tablet/, /phone/, /holder/, /mount/, /amps/, /heavy duty/],
};

const topicMatchPatterns = {
  marine: [/fish/, /finder/, /marine/, /garmin/, /boat/, /rail/],
  forklift: [/forklift/, /warehouse/, /scanner/, /pillar/, /material handling/],
  fleet: [/truck/, /fleet/, /eld/, /semi/, /vehicle/, /dashboard/, /windshield/, /seat rail/, /seatrail/, /drill base/],
  restaurant: [/restaurant/, /\bpos\b/, /point of sale/, /tablet tower/, /delivery/, /counter/],
  creator: [/stream/, /creator/, /camera/, /overhead/, /tripod/, /phone stand/],
  education: [/tablet stand/, /wall mount/, /desk/, /student/, /school/, /lockpro/, /locking tablet/, /comfortibolt/],
  farm: [/tractor/, /farm/, /vehicle/, /heavy duty/, /seat rail/, /seatrail/, /clamp/],
  outdoor: [/bike/, /bicycle/, /jeep/, /wrangler/, /off road/, /handlebar/, /rail/, /action camera/, /suction/],
  amps: [/amps/, /ball/, /adapter/, /plate/, /socket/, /garmin/, /drill base/],
  locking: [/lock/, /locking/, /dock n lock/, /dock’n lock/, /security/],
  phone: [/phone/, /smartphone/, /iphone/, /spro/, /minipro/, /moto vise/, /xprodock/],
  tablet: [/tablet/, /ipad/, /galaxy/, /tabdock/, /lockpro/],
  general: [/tablet/, /phone/, /holder/, /mount/, /amps/, /heavy duty/],
};

const verticalTopics = new Set(["marine", "forklift", "fleet", "restaurant", "creator", "education", "farm", "outdoor"]);

function productMatchesArticleTopics(article, product) {
  const topics = inferTopics(article.title, article.handle, article.body_html);
  const primaryTopics = topics.filter((topic) => verticalTopics.has(topic));
  const allowedTopics = primaryTopics.length ? primaryTopics : topics;
  const productNorm = normalize(`${product.title} ${product.handle} ${product.productType} ${product.tags} ${product.variants}`);

  const unrelatedVerticals = {
    marine: /fish|marine|garmin striker/,
    forklift: /forklift|warehouse|barcode scanner|pillar mount/,
    restaurant: /restaurant|pos|point of sale|point of purchase|tablet tower|multi tablet/,
    creator: /stream|creator|camera|overhead|tripod/,
  };
  for (const [topic, pattern] of Object.entries(unrelatedVerticals)) {
    if (!allowedTopics.includes(topic) && pattern.test(productNorm)) return false;
  }

  return allowedTopics.some((topic) => (topicMatchPatterns[topic] || []).some((pattern) => pattern.test(productNorm)));
}

function scoreProductForArticle(article, product) {
  const articleTokens = tokenSet(`${article.title} ${article.handle} ${stripHtml(article.body_html).slice(0, 1800)}`);
  const productTokens = tokenSet(productText(product));
  let score = 0;
  for (const token of articleTokens) {
    if (productTokens.has(token)) score += 6;
  }

  const productNorm = normalize(productText(product));
  for (const topic of inferTopics(article.title, article.handle, article.body_html)) {
    for (const pattern of topicBoosts[topic] || []) {
      if (pattern.test(productNorm)) score += 20;
    }
  }

  const titleNorm = normalize(product.title);
  const bodyNorm = normalize(stripHtml(article.body_html));
  if (titleNorm.length > 8 && bodyNorm.includes(titleNorm)) score += 60;
  if (/tablet|ipad|galaxy/.test(normalize(article.title)) && /tablet|ipad|galaxy/.test(productNorm)) score += 25;
  if (/phone|smartphone|iphone/.test(normalize(article.title)) && /phone|smartphone|iphone/.test(productNorm)) score += 25;
  if (/camera|stream|creator|youtube/.test(normalize(article.title)) && /camera|stream|creator|overhead|phone/.test(productNorm)) score += 25;
  if (/garmin|fish finder|amps/.test(normalize(article.title)) && /garmin|fish|amps|ball/.test(productNorm)) score += 30;
  if (/mount|adapter|part|replacement|spare/i.test(product.title) && score < 30) score -= 8;
  return score;
}

function chooseProducts(article, productsByHandle, products) {
  const existing = extractProductHandles(article.body_html)
    .map((handle) => productsByHandle.get(handle))
    .filter(Boolean)
    .slice(0, 4);

  const scored = products
    .map((product) => ({ product, score: scoreProductForArticle(article, product) }))
    .filter((row) => row.score > 0 && productMatchesArticleTopics(article, row.product))
    .sort((a, b) => b.score - a.score)
    .map((row) => row.product);

  const chosen = [];
  for (const product of [...existing, ...scored]) {
    if (!chosen.some((item) => item.handle === product.handle)) chosen.push(product);
    if (chosen.length >= 4) break;
  }

  if (!chosen.length) {
    for (const product of scored.slice(0, 4)) {
      if (!chosen.some((item) => item.handle === product.handle)) chosen.push(product);
    }
  }
  return chosen.slice(0, Math.min(4, Math.max(2, chosen.length)));
}

function relevanceSentence(article, product) {
  const topics = inferTopics(article.title, article.handle, article.body_html);
  if (topics.includes("marine")) return "Useful for keeping electronics positioned on boats and around marine work areas.";
  if (topics.includes("forklift")) return "Built for work environments where tablets and handheld devices need a stable mounting point.";
  if (topics.includes("fleet")) return "A practical option for cab, fleet, and mobile work setups where visibility and reach matter.";
  if (topics.includes("restaurant")) return "Helpful for organizing tablets used for orders, delivery apps, and point-of-sale workflows.";
  if (topics.includes("creator")) return "A good fit for phone and camera setups used in recording, streaming, and overhead shots.";
  if (topics.includes("education")) return "Useful for keeping tablets positioned for study, classroom, and shared-device setups.";
  if (topics.includes("farm")) return "Designed for mobile equipment setups where vibration and daily use are part of the job.";
  if (topics.includes("outdoor")) return "A relevant choice for outdoor, vehicle, and activity-based mounting needs.";
  if (topics.includes("locking")) return "Designed for applications where device security and a fixed position are important.";
  return "A related iBOLT option that matches the mounting needs covered in this article.";
}

function renderProductSection(article, products) {
  const cards = products
    .map(
      (product) => `
      <article style="border: 1px solid #e5e7eb; border-radius: 6px; padding: 14px; background: #fff;">
        <a href="${htmlEscape(product.url)}" style="display: block; text-decoration: none;">
          <img src="${htmlEscape(product.image)}" alt="${htmlEscape(product.title)}" loading="lazy" style="display: block; width: 100%; height: auto; border-radius: 6px; margin: 0 0 10px;">
        </a>
        <h3 style="font-size: 1rem; line-height: 1.35; margin: 0 0 8px;">
          <a href="${htmlEscape(product.url)}" style="color: inherit; text-decoration: underline;">${htmlEscape(product.title)}</a>
        </h3>
        <p style="font-size: 0.95rem; line-height: 1.55; margin: 0; color: #4b5563;">${htmlEscape(relevanceSentence(article, product))}</p>
      </article>`
    )
    .join("\n");

  return `${START_MARKER}
<section class="ibolt-product-links" style="margin: 32px 0;">
  <h2 style="margin: 0 0 16px;">Related iBOLT Mounting Options</h2>
  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px;">
${cards}
  </div>
</section>
${END_MARKER}`;
}

function removeExistingProductSection(html) {
  const pattern = new RegExp(`${escapeRegExp(START_MARKER)}[\\s\\S]*?${escapeRegExp(END_MARKER)}\\s*`, "gi");
  return String(html || "").replace(pattern, "");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function insertProductSection(html, section) {
  let cleaned = removeExistingProductSection(html).trim();
  const faqMatch = cleaned.match(/<h2[^>]*>\s*(?:frequently asked questions|faq)\s*<\/h2>/i);
  if (faqMatch?.index !== undefined) {
    return `${cleaned.slice(0, faqMatch.index).trim()}\n\n${section}\n\n${cleaned.slice(faqMatch.index).trim()}`;
  }

  const closingArticle = cleaned.match(/<\/article>\s*$/i);
  if (closingArticle?.index !== undefined) {
    return `${cleaned.slice(0, closingArticle.index).trim()}\n\n${section}\n\n${cleaned.slice(closingArticle.index).trim()}`;
  }
  return `${cleaned}\n\n${section}`;
}

function countProductLinks(html) {
  const matches = String(html || "").match(/href=["'][^"']*\/products\//gi);
  return matches ? matches.length : 0;
}

function countProductImagesInSection(html) {
  const start = String(html || "").indexOf(START_MARKER);
  const end = String(html || "").indexOf(END_MARKER);
  if (start < 0 || end < start) return 0;
  const section = html.slice(start, end);
  return (section.match(/<img\b/gi) || []).length;
}

async function main() {
  const products = await fetchPublicProducts();
  const productsByHandle = new Map(products.map((product) => [product.handle, product]));
  fs.writeFileSync(path.join(OUTPUT_DIR, "product-catalog.json"), JSON.stringify({ fetchedAt: new Date().toISOString(), count: products.length, products }, null, 2));

  const blogs = await paginate("blogs.json?limit=250", "blogs");
  const articles = [];
  for (const blog of blogs) {
    const rows = await paginate(`blogs/${blog.id}/articles.json?limit=250`, "articles");
    for (const article of rows) {
      if (String(article.author || "").trim().toLowerCase() !== AUTHOR.toLowerCase()) continue;
      if (ONLY_HANDLE && article.handle !== ONLY_HANDLE) continue;
      articles.push({ ...article, blog_id: blog.id });
    }
  }
  const selectedArticles = LIMIT > 0 ? articles.slice(0, LIMIT) : articles;

  const report = {
    generatedAt: new Date().toISOString(),
    mode: APPLY ? "apply" : "dry-run",
    author: AUTHOR,
    productCatalogCount: products.length,
    selectedArticleCount: selectedArticles.length,
    applied: 0,
    rows: [],
  };

  const dbUpdate = db?.prepare(
    "UPDATE blog_posts SET html = ?, updated_at = ?, shopify_synced_at = ? WHERE shopify_article_id = ?"
  );

  for (const article of selectedArticles) {
    const chosenProducts = chooseProducts(article, productsByHandle, products);
    if (!chosenProducts.length) throw new Error(`No product candidates found for ${article.handle}`);
    const beforeHtml = article.body_html || "";
    const section = renderProductSection(article, chosenProducts);
    const afterHtml = insertProductSection(beforeHtml, section);
    const beforeProductLinks = countProductLinks(beforeHtml);
    const afterProductLinks = countProductLinks(afterHtml);
    const productImageCards = countProductImagesInSection(afterHtml);
    const published = Boolean(article.published_at);

    const backupPath = path.join(OUTPUT_DIR, "backups", `${article.id}-${article.handle}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(article, null, 2));

    const row = {
      articleId: article.id,
      blogId: article.blog_id,
      title: article.title,
      handle: article.handle,
      published,
      beforeProductLinks,
      afterProductLinks,
      productImageCards,
      products: chosenProducts.map((product) => ({
        title: product.title,
        handle: product.handle,
        url: product.url,
        image: product.image,
      })),
      backupPath,
    };

    if (APPLY) {
      await shopifyREST("PUT", `blogs/${article.blog_id}/articles/${article.id}.json`, {
        article: {
          id: article.id,
          body_html: afterHtml,
        },
      });
      report.applied += 1;
      if (dbUpdate) {
        const now = new Date().toISOString();
        dbUpdate.run(afterHtml, Date.now(), now, Number(article.id));
      }
      await sleep(250);
    }

    report.rows.push(row);
    console.log(`${APPLY ? "updated" : "planned"}: ${article.handle} -> ${chosenProducts.map((product) => product.handle).join(", ")}`);
  }

  const reportPath = path.join(OUTPUT_DIR, APPLY ? "apply-report.json" : "dry-run-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ reportPath, ...report, rows: undefined }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    db?.close();
  });
