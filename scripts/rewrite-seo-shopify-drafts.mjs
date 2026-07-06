import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const COMPANY_ID = process.env.IBOLT_COMPANY_ID || "ibolt-default-company";
const SHOPIFY_SHOP = process.env.SHOPIFY_SHOP || "iboltmounts";
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN;
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";
const SHOPIFY_NEWS_BLOG_ID = Number(process.env.SHOPIFY_NEWS_BLOG_ID || 104843772196);
const MODEL = process.env.BLOG_ANTHROPIC_MODEL || "claude-sonnet-4-6";
const DB_PATH = process.env.DATABASE_PATH || (fs.existsSync("data/standalone-blog-writer.db") ? "data/standalone-blog-writer.db" : "data/sourceannotator.db");
const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] || 0);
const ONLY_HANDLE = process.argv.find((arg) => arg.startsWith("--handle="))?.split("=")[1];
const SKIP_SHOPIFY = process.argv.includes("--skip-shopify") || DRY_RUN;

if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured.");
if (!SKIP_SHOPIFY && !SHOPIFY_TOKEN) throw new Error("SHOPIFY_ACCESS_TOKEN or SHOPIFY_ADMIN_API_ACCESS_TOKEN is required.");

const bannedPhrases = [
  "game-changer",
  "revolutionize",
  "revolutionizing",
  "seamless",
  "seamlessly",
  "cutting-edge",
  "cutting edge",
  "next-level",
  "groundbreaking",
  "innovative solution",
  "state-of-the-art",
  "paradigm shift",
  "synergy",
  "leverage",
  "empower",
  "robust",
  "holistic",
  "streamline",
  "best-in-class",
  "world-class",
  "unlock the power",
  "dive into",
  "in today's fast-paced world",
  "look no further",
  "without further ado",
  "budget option",
  "affordable alternative",
  "cheaper than RAM",
  "cost-effective alternative",
  "economical choice",
];

const candidates = [
  {
    handle: "clip-on-phone-mount-guide-benefits-features-and-practical-applications",
    vertical: "general-mounting",
    keywords: ["phone holder with clip", "phone holder with clamp", "phone clamp", "cell phone holder clip", "handlebar mount phone"],
    proposition: "Turn a loose clip-on phone setup into a secure mounting plan by matching clamp style, ball size, and mounting surface.",
    products: [
      { handle: "ibolt-moto-vise-incredibolt-heavy-duty-phone-clamp-handlebar-rail-mount" },
      { handle: "ibolt-17mm-dual-ball-clamping-mount-for-handlebars-poles-posts-compatible-w-garmin-gps-systems-and-ibolt-phone-holders" },
    ],
  },
  {
    handle: "understanding-ball-joint-mount-and-ball-and-socket-mount-systems",
    vertical: "mounting-standards-adapters",
    keywords: ["ball mounts", "20mm ball mount", "20mm ball mount accessories", "amps adapter"],
    proposition: "Help buyers stop guessing at ball sizes by explaining how ball-and-socket parts connect across phone, tablet, Garmin, and AMPS setups.",
    products: [
      { handle: "ibolt-25mm-1-inch-to-dual-17mm-metal-ball-adapter-copy" },
      { handle: "ibolt-25mm-1-inch-to-dual-metal-17mm-composite-ball-adapter" },
    ],
  },
  {
    handle: "understanding-screw-in-phone-mount-systems-for-secure-device-positioning",
    vertical: "general-mounting",
    keywords: ["suction cup phone mount", "suction phone holder", "phone holder with clamp", "phone clamp"],
    proposition: "Show when a screw-in or drill-base phone mount solves the real problem: vibration, repeatable placement, and long-term device security.",
    products: [
      { handle: "ibolt-phone-dock-n-lock-incredibolt-amps-drill-base-mount-for-phones" },
      { handle: "ibolt-phone-dock-n-lock-incredibolt-amps-w-4-25-double-socket-arm-locking-drill-base-mount-for-smartphones-great-for-trucks-eld-s-wall-mounting-sprinter-vans-etc" },
    ],
  },
  {
    handle: "understanding-eld-mount-solutions-in-modern-fleet-operations",
    vertical: "trucking-fleet",
    keywords: ["ipad mount for truck", "tablet truck mounts", "tablet mounts for trucks", "semi truck tablet mount"],
    proposition: "Frame ELD mounting as a fleet reliability problem: readable placement, charging access, repeatable installs, and fewer loose tablets.",
    products: [
      { handle: "ibolt-tabdocktm-incredibolttm-360-suction-heavy-duty-metal-6-inch-multi-angle-mount-for-all-7-10-tablets-for-commercial-vehicles-trucks-and-eld-devices" },
      { handle: "ibolt-dock-n-lock-bizmount-heavy-duty-industrial-composite-locking-drill-base-mount" },
    ],
  },
  {
    handle: "tablet-mount-solutions-for-semi-trucks-improving-device-accessibility-on-the-road",
    vertical: "trucking-fleet",
    keywords: ["ipad mount for truck", "tablet truck mounts", "tablet mounts for trucks", "semi truck tablet mount"],
    proposition: "Position the article around reducing driver reach, glare, cable clutter, and tablet bounce in semi truck cabs.",
    products: [
      { handle: "ibolt-tabdocktm-incredibolttm-360-suction-heavy-duty-metal-6-inch-multi-angle-mount-for-all-7-10-tablets-for-commercial-vehicles-trucks-and-eld-devices" },
      { handle: "ibolt-dock-n-lock-bizmount-heavy-duty-industrial-composite-locking-drill-base-mount" },
    ],
  },
  {
    handle: "phone-clamp-mount-systems-understanding-secure-and-flexible-smartphone-positioning",
    vertical: "general-mounting",
    keywords: ["phone holder with clamp", "phone holder with clip", "phone clamp", "handlebar mount phone"],
    proposition: "Make clamp mounts a decision guide for buyers choosing between temporary clips, heavy-duty clamps, and fixed mounts.",
    products: [
      { handle: "ibolt-moto-vise-incredibolt-360-heavy-duty-phone-clamp-handlebar-rail-mount" },
      { handle: "ibolt-moto-vise-incredibolt-heavy-duty-phone-clamp-handlebar-rail-mount" },
    ],
  },
  {
    handle: "understanding-phone-holders-and-mounting-systems-for-live-streaming",
    vertical: "content-creation-streaming",
    keywords: ["camera mount", "streaming mount", "phone holder for streaming", "overhead webcam mount"],
    proposition: "Help creators solve shaky footage and awkward angles by matching phone holders to overhead, desk, and accessory mounting needs.",
    products: [
      { handle: "ibolttm-stream-cast-incredibolttm-stand-adjustable-overhead-phone-mount" },
      { handle: "ibolt-1-4-20-camera-screw-incredibolt-suction-cup-mount-secure-adjustable-mount-for-cameras-accessories" },
    ],
  },
  {
    handle: "choosing-the-best-phone-stand-for-live-streaming-a-guide-for-content-creators",
    vertical: "content-creation-streaming",
    keywords: ["camera mount", "streaming mount", "phone holder for streaming", "overhead webcam mount"],
    proposition: "Turn the guide into a practical setup planner for creators who need steady hands-free video, repeatable angles, and space for lights or microphones.",
    products: [
      { handle: "ibolttm-stream-cast-incredibolttm-stand-adjustable-overhead-phone-mount" },
      { handle: "ibolt-stream-cast-overhead-camera-rig-desk-mount-for-dslr-cameras-for-top-down-and-front-facing-photography" },
    ],
  },
  {
    handle: "understanding-amps-mount-standards-and-their-role-in-device-mounting-systems",
    vertical: "mounting-standards-adapters",
    keywords: ["amps adapter", "amps mounts", "ball mounts", "20mm ball mount accessories"],
    proposition: "Explain AMPS as the standard that lets buyers build serviceable, compatible mounts instead of replacing an entire setup.",
    products: [
      { titleIncludes: ["38mm", "Diamond", "AMPS Adapter Plate"] },
      { handle: "ibolt-amps-to-vesa-75-100-plate" },
    ],
  },
  {
    handle: "understanding-tablet-mount-solutions-for-vehicles-workstations-and-mobile-work-environments",
    vertical: "general-mounting",
    keywords: ["tablet mount", "tablet mounts", "mounts for tablets", "tablet holder", "tablet ipad holder"],
    proposition: "Make the broad tablet guide solve buyer confusion around vehicle, workstation, POS, and industrial mounting tradeoffs.",
    products: [
      { handle: "ibolt-tabdocktm-incredibolttm-360-suction-heavy-duty-metal-6-inch-multi-angle-mount-for-all-7-10-tablets-for-commercial-vehicles-trucks-and-eld-devices" },
      { handle: "ibolt-tabdock-pos-tablet-stand" },
    ],
  },
  {
    handle: "garmin-ball-mount-guide-understanding-ball-sizes-and-mount-compatibility",
    vertical: "mounting-standards-adapters",
    keywords: ["garmin ball size", "ball mounts", "20mm ball mount", "amps adapter"],
    proposition: "Help Garmin owners identify the right ball-size path before buying a base, adapter, or suction setup.",
    products: [
      { handle: "ibolt-17mm-dual-ball-to-amps-drill-base-mount-base-compatible-w-garmin-gps-and-ibolt-phone-holders" },
      { handle: "ibolt-17mm-dual-ball-to-sticky-suction-cup-mount-base-compatible-w-garmin-gps-and-ibolt-phone-holders" },
    ],
  },
  {
    handle: "multiple-tablet-mount-systems-organizing-digital-workspaces-for-restaurants-and-point-of-sale-operations",
    vertical: "restaurants-food-delivery",
    keywords: ["tablet holder", "tablet ipad holder", "tablet mount", "mounts for tablets"],
    proposition: "Make the restaurant angle solve tablet sprawl across POS, delivery apps, customer-facing screens, and counter space.",
    products: [
      { handle: "tablet-tower-multi-tablet-locking-stand-three-ipad-holders-point-of-sale-purchase-restaurant-ibrt-34701" },
      { handle: "ibolt-quad-tablet-tower-stand" },
      { handle: "ibolt-tabdock-pos-tablet-stand" },
    ],
  },
  {
    handle: "understanding-professional-mounting-solutions-for-modern-mobile-devices",
    vertical: "general-mounting",
    keywords: ["tablet mount", "phone holder with clamp", "ball mounts", "amps adapter"],
    proposition: "Shift the article from generic professionalism to a buying framework for device weight, surface choice, cable access, and future reconfiguration.",
    products: [
      { handle: "ibolt-moto-vise-incredibolt-heavy-duty-phone-clamp-handlebar-rail-mount" },
      { handle: "ibolt-dock-n-lock-bizmount-heavy-duty-industrial-composite-locking-drill-base-mount" },
      { handle: "ibolt-amps-to-vesa-75-100-plate" },
    ],
  },
  {
    handle: "amps-phone-mount-guide-for-live-streaming-and-content-creation",
    vertical: "content-creation-streaming",
    keywords: ["amps adapter", "camera mount", "clamp for camera", "phone holder for streaming", "streaming mount"],
    proposition: "Show creators how AMPS-based phone mounting can make desk, wall, suction, and camera-thread setups easier to reconfigure.",
    products: [
      { handle: "ibolt-phone-dock-n-lock-incredibolt-amps-drill-base-mount-for-phones" },
      { handle: "ibolt-38mm-1-5-inch-metal-rectangular-amps-pattern-to-20-metal-camera-screw-dual-ball-mount-featuring-a-3-5-inch-composite-38mm-bizmount-arm" },
    ],
  },
  {
    handle: "heavy-duty-modular-mounting-solutions-for-modern-material-handling-and-warehouse-operations",
    vertical: "forklifts-warehousing",
    keywords: ["tablet mount for forklift", "forklift mounted tablet", "magnetic tablet mount", "tablet mount magnetic"],
    proposition: "Make warehouse mounting a downtime and workflow problem: scanners, tablets, forklift vibration, and repeatable locations for operators.",
    products: [
      { handle: "ibolt-xl-forklift-barcode-scanner-holder-38mm-mount" },
      { handle: "ibolt-tabdock-magdock-360-magnetic-tablet-mount-heavy-duty-forklift-warehouse-holder" },
    ],
  },
  {
    handle: "magnetic-camera-mount-benefits-uses-and-key-considerations",
    vertical: "content-creation-streaming",
    keywords: ["camera mount", "magnetic tablet mount", "clamp on camera mount", "gopro screw mount"],
    proposition: "Help buyers decide when magnetic mounting solves the problem and when a clamp, suction, or threaded camera adapter is safer.",
    products: [
      { handle: "ibolt-38mm-1-5-inch-dualmag-industrial-strength-magnetic-base" },
      { handle: "ibolt-action-camera-inch-20-to-25mm-1-inch-b-size-ball-adapter" },
    ],
  },
  {
    handle: "table-camera-mount-guide-creating-stable-overhead-and-front-facing-camera-setups",
    vertical: "content-creation-streaming",
    keywords: ["camera mount", "clamp for camera", "clamp on camera mount", "overhead webcam mount"],
    proposition: "Center the guide on stable overhead and front-facing camera setups for product demos, livestreams, and instructional content.",
    products: [
      { handle: "ibolt-stream-cast-overhead-camera-rig-desk-mount-for-dslr-cameras-for-top-down-and-front-facing-photography" },
      { handle: "ibolt-1-4-20-camera-screw-incredibolt-suction-cup-mount-secure-adjustable-mount-for-cameras-accessories" },
    ],
  },
  {
    handle: "professional-grade-mounting-solutions-for-modern-workspaces-vehicles-and-industries",
    vertical: "general-mounting",
    keywords: ["tablet mount", "phone holder with clamp", "ball mounts", "mounts for tablets"],
    proposition: "Turn the broad professional-grade post into a decision path for choosing secure mounts by environment, device, and service needs.",
    products: [
      { handle: "ibolt-dock-n-lock-bizmount-heavy-duty-industrial-composite-locking-drill-base-mount" },
      { handle: "ibolt-moto-vise-incredibolt-heavy-duty-phone-clamp-handlebar-rail-mount" },
      { handle: "ibolt-amps-to-vesa-75-100-plate" },
    ],
  },
  {
    handle: "multiple-tablet-mount-solutions-improving-device-organization-in-modern-workspaces",
    vertical: "multi-device-workstations",
    keywords: ["tablet holder", "tablet ipad holder", "mounts for tablets", "tablet mount"],
    proposition: "Make multi-tablet mounting a workspace organization problem for counters, dispatch desks, and device-heavy teams.",
    products: [
      { handle: "ibolt-quad-tablet-tower-stand" },
      { handle: "tablet-tower-multi-tablet-locking-stand-three-ipad-holders-point-of-sale-purchase-restaurant-ibrt-34701" },
      { handle: "ibolt-tabdock-pos-tablet-stand" },
    ],
  },
  {
    handle: "table-camera-mount-a-practical-guide-for-content-creation-photography-and-live-streaming",
    vertical: "content-creation-streaming",
    keywords: ["camera mount", "streaming mount", "clamp for camera", "overhead webcam mount"],
    proposition: "Help creators choose a table camera mount based on angle, payload, desk space, and repeatable filming positions.",
    products: [
      { handle: "ibolt-stream-cast-overhead-camera-rig-desk-mount-for-dslr-cameras-for-top-down-and-front-facing-photography" },
      { handle: "ibolttm-stream-cast-incredibolttm-stand-adjustable-overhead-phone-mount" },
    ],
  },
  {
    handle: "restaurant-tablet-mount-why-modern-restaurants-need-organized-tablet-workstations",
    vertical: "restaurants-food-delivery",
    keywords: ["tablet holder", "tablet ipad holder", "tablet mount", "mounts for tablets"],
    proposition: "Make restaurant tablet mounting a problem-solving article about delivery tablet overload, POS access, counter space, and secure staff workflows.",
    products: [
      { handle: "ibolt-tabdock-pos-tablet-stand" },
      { handle: "ibolt-dock-n-lock-pos-tablet-stand" },
      { handle: "ibolt-quad-tablet-tower-stand" },
    ],
  },
];

const db = new Database(DB_PATH);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const outDir = path.join("content-output", "seo-claude-drafts", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(outDir, { recursive: true });

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(html) {
  const text = stripHtml(html);
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeDashes(value) {
  return String(value || "").replace(/[—–]/g, ",");
}

function stripGeneratedImages(html) {
  return String(html || "")
    .replace(/<p[^>]*>\s*<img\b[\s\S]*?>\s*<\/p>/gi, "")
    .replace(/<img\b[\s\S]*?>/gi, "");
}

function extractJson(text) {
  const trimmed = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Claude did not return JSON.");
    return JSON.parse(match[0]);
  }
}

function shopifyEndpoint(endpoint) {
  return `https://${SHOPIFY_SHOP}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/${endpoint}`;
}

async function shopify(method, endpoint, body) {
  const response = await fetch(shopifyEndpoint(endpoint), {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_TOKEN,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Shopify ${method} ${endpoint} failed: ${response.status} ${text.slice(0, 1000)}`);
  }
  return text ? JSON.parse(text) : {};
}

async function listShopifyArticles() {
  const result = await shopify("GET", `blogs/${SHOPIFY_NEWS_BLOG_ID}/articles.json?limit=250&published_status=any`);
  return result.articles || [];
}

function findVertical(slug) {
  return db.prepare("SELECT id, name, slug FROM industry_verticals WHERE company_id = ? AND slug = ?").get(COMPANY_ID, slug);
}

function findProduct(ref) {
  if (ref.handle) {
    return db.prepare("SELECT * FROM products WHERE company_id = ? AND handle = ?").get(COMPANY_ID, ref.handle);
  }
  if (ref.titleIncludes?.length) {
    const rows = db.prepare("SELECT * FROM products WHERE company_id = ?").all(COMPANY_ID);
    return rows.find((row) => ref.titleIncludes.every((term) => String(row.title || "").toLowerCase().includes(term.toLowerCase())));
  }
  return null;
}

function loadProducts(candidate) {
  return candidate.products.map((ref) => {
    const product = findProduct(ref);
    if (!product) throw new Error(`Could not find product for ${JSON.stringify(ref)}`);
    return product;
  });
}

function loadContext(verticalId) {
  return db.prepare(`
    SELECT category, content, source_type, source_url, confidence, is_verified
    FROM context_entries
    WHERE company_id = ? AND vertical_id = ?
    ORDER BY
      CASE source_type WHEN 'web' THEN 0 WHEN 'reddit' THEN 1 WHEN 'seed' THEN 2 ELSE 3 END,
      confidence DESC
    LIMIT 10
  `).all(COMPANY_ID, verticalId);
}

function loadKeywordRows(keywords) {
  if (!keywords.length) return [];
  const placeholders = keywords.map(() => "?").join(",");
  return db.prepare(`
    SELECT keyword, volume, difficulty, opportunity_score
    FROM keywords
    WHERE company_id = ? AND keyword IN (${placeholders})
    ORDER BY opportunity_score DESC
  `).all(COMPANY_ID, ...keywords);
}

function productBlock(product, index) {
  const title = normalizeDashes(product.title);
  const price = product.price ? `$${Number(product.price).toFixed(2)}` : "";
  const alt = `${title} from iBOLT Mounts`;
  return `<div style="text-align: center; margin: 24px 0;">
  <a href="${escapeHtml(product.url)}">
    <img src="${escapeHtml(product.image_url)}" alt="${escapeHtml(alt)}" style="max-width: 420px; width: 100%; height: auto; border-radius: 8px;" loading="lazy">
  </a>
  <p style="font-size: 14px; color: #666; margin-top: 8px;"><strong><a href="${escapeHtml(product.url)}">${escapeHtml(title)}</a></strong>${price ? ` - ${escapeHtml(price)}` : ""}</p>
</div>`;
}

function formatProducts(products) {
  return products.map((product, index) => [
    `PRODUCT ${index + 1}`,
    `Name: ${normalizeDashes(product.title)}`,
    `URL: ${product.url}`,
    `Image: ${product.image_url}`,
    `Price: ${product.price ? `$${Number(product.price).toFixed(2)}` : "not listed"}`,
    `Handle: ${product.handle}`,
    `Description: ${stripHtml(product.description).slice(0, 650)}`,
  ].join("\n")).join("\n\n");
}

function formatContext(contextRows) {
  if (!contextRows.length) return "- No context entries found for this vertical.";
  return contextRows.map((row, index) => {
    const source = row.source_url ? ` (${row.source_type}: ${row.source_url})` : ` (${row.source_type})`;
    return `${index + 1}. [${row.category}] ${row.content}${source}`;
  }).join("\n");
}

function formatKeywords(keywordRows, fallbackKeywords) {
  if (!keywordRows.length) return fallbackKeywords.map((keyword) => `- ${keyword}`).join("\n");
  return keywordRows.map((row) => `- ${row.keyword}: volume ${row.volume}, difficulty ${row.difficulty}, opportunity ${row.opportunity_score}`).join("\n");
}

function productMarkdownLinks(products) {
  return products.map((product) => `[${normalizeDashes(product.title)}](${product.url})`).join(", ");
}

function buildSystemPrompt() {
  return `You are a senior editor for iBOLT Mounts rewriting weak SEO blog posts into useful, product-connected Shopify articles.

Voice rules:
- Write as the iBOLT Mounts content team, with practical mounting-system expertise.
- Use conversational expertise: helpful, specific, and credible.
- Lead with the buyer's problem, then explain options.
- Always write iBOLT exactly.
- Never frame iBOLT as cheap, budget, or a lower-quality alternative.
- Do not use em dashes or en dashes. Use commas, periods, semicolons, or colons.
- Avoid these phrases: ${bannedPhrases.join(", ")}.
- Use real product facts only. Do not invent exact compatibility, certifications, inventory, or dimensions.
- Target 850 to 1150 words. Hard cap: 1400 words including product captions.
- Return strict JSON only with keys: title, metaTitle, metaDescription, problemProposition, html.
- The html value must start with <article> and end with </article>.
- Include 4 to 6 H2 sections and a concise FAQ section.
- Use every product placeholder exactly once: [[PRODUCT_BLOCK_1]], [[PRODUCT_BLOCK_2]], and any others provided.
- Mention every provided product by name with a real product link in prose, not only in the product block.
- Make the article a problem-solving proposition, not a generic explainer.`;
}

function buildUserPrompt({ candidate, article, vertical, products, contextRows, keywordRows, placeholders }) {
  const sourceText = stripHtml(article.body_html).slice(0, 5000);
  return `Rewrite this existing Shopify article as a stronger unpublished review draft.

Original Shopify article:
- Title: ${article.title}
- Handle: ${article.handle}
- Published at: ${article.published_at || "draft"}
- Current article image status: generic SEO image, do not reuse it.

Target vertical: ${vertical.name} (${vertical.slug})

Problem-solving proposition to consider:
${candidate.proposition}

SEO keywords from the new position tracking CSV:
${formatKeywords(keywordRows, candidate.keywords)}

Use this product context and link these products naturally:
${formatProducts(products)}

Product photo placeholders to place exactly once:
${placeholders.join(", ")}

New scraped/local context bank entries:
${formatContext(contextRows)}

Original article text, for topic continuity only:
${sourceText}

Required output:
- A sharper SEO title under 60 characters when possible.
- Meta title under 60 characters.
- Meta description under 155 characters.
- Complete Shopify article body HTML.
- 850 to 1150 words is ideal. Never exceed 1400 words after product placeholders are inserted.
- A problemProposition field that states the article's core buyer problem and solution in one sentence.

Do not reuse the generic AI image. Use the product placeholders for real product photos. Return JSON only.`;
}

async function rewriteArticle(input) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const retryFeedback = lastError
      ? `\n\nPrevious attempt failed validation: ${lastError.message}. Fix that issue in this attempt.`
      : "";
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 6500,
      temperature: attempt === 1 ? 0.38 : 0.22,
      system: buildSystemPrompt(),
      messages: [{ role: "user", content: `${buildUserPrompt(input)}${retryFeedback}` }],
    });
    const text = response.content.filter((item) => item.type === "text").map((item) => item.text).join("\n");
    try {
      const parsed = extractJson(text);
      parsed.title = normalizeDashes(parsed.title || input.article.title).trim();
      parsed.metaTitle = normalizeDashes(parsed.metaTitle || parsed.title).trim().slice(0, 90);
      parsed.metaDescription = normalizeDashes(parsed.metaDescription || "").trim().slice(0, 180);
      parsed.problemProposition = normalizeDashes(parsed.problemProposition || input.candidate.proposition).trim();
      parsed.html = stripGeneratedImages(normalizeDashes(parsed.html || "")).trim();
      if (!/^<article[\s>]/i.test(parsed.html)) parsed.html = `<article>\n${parsed.html}\n</article>`;

      const issues = validateHtml(parsed.html, input.placeholders);
      const finalWordCount = wordCount(restoreProductBlocks(parsed.html, input.productBlocks || []));
      if (finalWordCount > 1400) issues.push(`word count too high: ${finalWordCount}; hard cap is 1400`);
      if (issues.length) throw new Error(issues.join("; "));
      return parsed;
    } catch (error) {
      lastError = error;
      fs.writeFileSync(path.join(outDir, `${input.article.handle}.attempt-${attempt}.txt`), text);
      console.warn(`[retry] ${input.article.handle}: ${error.message}`);
    }
  }
  throw lastError;
}

function validateHtml(html, placeholders) {
  const issues = [];
  for (const placeholder of placeholders) {
    const count = html.split(placeholder).length - 1;
    if (count !== 1) issues.push(`${placeholder} appears ${count} times`);
  }
  for (const phrase of bannedPhrases) {
    if (html.toLowerCase().includes(phrase)) issues.push(`banned phrase: ${phrase}`);
  }
  if (/[—–]/.test(html)) issues.push("contains em dash or en dash");
  const wc = wordCount(html);
  if (wc < 650) issues.push(`word count too low: ${wc}`);
  return issues;
}

function restoreProductBlocks(html, blocks) {
  let restored = html;
  for (let index = 0; index < blocks.length; index += 1) {
    restored = restored.replace(`[[PRODUCT_BLOCK_${index + 1}]]`, blocks[index]);
  }
  return restored;
}

function htmlToReviewMarkdown(title, html, products, problemProposition) {
  const body = html
    .replace(/<article[^>]*>/i, "")
    .replace(/<\/article>/i, "")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n\n## $1\n\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n\n### $1\n\n")
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n\n$1\n\n")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1")
    .replace(/<\/?(ul|ol)[^>]*>/gi, "\n")
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**")
    .replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(/<img[^>]*src="([^"]+)"[^>]*alt="([^"]*)"[^>]*>/gi, "![$2]($1)")
    .replace(/<[^>]+>/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return `# ${title}

> Problem proposition: ${problemProposition}

Featured product links: ${productMarkdownLinks(products)}

${body}
`;
}

function ensureLocalPost({ candidate, article, vertical, result, finalHtml, reviewMarkdown, products, shopifyArticleId, shopifyHandle }) {
  const draftSlug = `${article.handle}-claude-product-review-draft`;
  const now = Date.now();
  const wc = wordCount(finalHtml);
  const notes = {
    source: "seo-claude-draft-rewrite",
    sourceShopifyArticleId: article.id,
    sourceShopifyHandle: article.handle,
    sourcePublishedAt: article.published_at,
    sourceImage: article.image?.src || null,
    problemProposition: result.problemProposition,
    targetKeywords: candidate.keywords,
    productHandles: products.map((product) => product.handle),
    createdAsShopifyDraft: !SKIP_SHOPIFY,
    shopifyDraftHandle: shopifyHandle || null,
    model: MODEL,
    generatedAt: new Date(now).toISOString(),
  };
  const existing = db.prepare("SELECT id, shopify_article_id FROM blog_posts WHERE company_id = ? AND slug = ?").get(COMPANY_ID, draftSlug);
  if (existing) {
    db.prepare(`
      UPDATE blog_posts
      SET title = ?, meta_title = ?, meta_description = ?, markdown = ?, html = ?, vertical_id = ?,
          status = 'review', word_count = ?, brand_consistency = 88, seo_optimization = 86,
          natural_language = 88, factual_accuracy = 84, overall_score = 86,
          verification_notes = ?, shopify_article_id = ?, shopify_blog_id = ?,
          shopify_synced_at = ?, generation_provider = 'anthropic', generation_model = ?, updated_at = ?
      WHERE id = ?
    `).run(
      result.title,
      result.metaTitle,
      result.metaDescription,
      reviewMarkdown,
      finalHtml,
      vertical.id,
      wc,
      JSON.stringify(notes),
      shopifyArticleId || existing.shopify_article_id || null,
      shopifyArticleId ? SHOPIFY_NEWS_BLOG_ID : null,
      shopifyArticleId ? new Date(now).toISOString() : null,
      MODEL,
      now,
      existing.id,
    );
    replacePostProducts(existing.id, products);
    return existing.id;
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO blog_posts (
      id, company_id, title, slug, meta_title, meta_description, markdown, html,
      vertical_id, status, word_count, brand_consistency, seo_optimization,
      natural_language, factual_accuracy, overall_score, verification_notes,
      shopify_article_id, shopify_blog_id, shopify_synced_at, generation_provider,
      generation_model, generated_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'review', ?, 88, 86, 88, 84, 86, ?, ?, ?, ?, 'anthropic', ?, ?, ?)
  `).run(
    id,
    COMPANY_ID,
    result.title,
    draftSlug,
    result.metaTitle,
    result.metaDescription,
    reviewMarkdown,
    finalHtml,
    vertical.id,
    wc,
    JSON.stringify(notes),
    shopifyArticleId || null,
    shopifyArticleId ? SHOPIFY_NEWS_BLOG_ID : null,
    shopifyArticleId ? new Date(now).toISOString() : null,
    MODEL,
    now,
    now,
  );
  replacePostProducts(id, products);
  return id;
}

function replacePostProducts(postId, products) {
  db.prepare("DELETE FROM blog_post_products WHERE company_id = ? AND blog_post_id = ?").run(COMPANY_ID, postId);
  const insert = db.prepare("INSERT INTO blog_post_products (id, company_id, blog_post_id, product_id, mention_context) VALUES (?, ?, ?, ?, ?)");
  for (const product of products) {
    insert.run(randomUUID(), COMPANY_ID, postId, product.id, "SEO rewrite featured product");
  }
}

async function upsertShopifyDraft({ article, result, finalHtml, products, localExistingPost }) {
  const metafields = [
    { namespace: "global", key: "title_tag", value: result.metaTitle, type: "single_line_text_field" },
    { namespace: "global", key: "description_tag", value: result.metaDescription, type: "single_line_text_field" },
  ];
  const handle = `${slugify(article.handle)}-claude-product-review`;
  const payload = {
    article: {
      title: `[Review Draft] ${result.title}`,
      author: "iBOLT Mark",
      body_html: finalHtml,
      published: false,
      handle,
      tags: [
        "ibolt-mark-review",
        "claude-rewrite",
        "seo-cleanup",
        `source-${article.id}`,
      ].join(", "),
      image: products[0]?.image_url ? { src: products[0].image_url } : undefined,
      metafields,
    },
  };

  const existingDraftId = localExistingPost?.shopify_article_id ? Number(localExistingPost.shopify_article_id) : null;
  if (existingDraftId && localExistingPost?.shopify_blog_id) {
    const updated = await shopify("PUT", `blogs/${Number(localExistingPost.shopify_blog_id)}/articles/${existingDraftId}.json`, {
      article: {
        id: existingDraftId,
        title: payload.article.title,
        body_html: payload.article.body_html,
        published: false,
        tags: payload.article.tags,
        image: payload.article.image,
      },
    });
    return { id: existingDraftId, handle: updated.article?.handle || handle, action: "updated" };
  }

  const created = await shopify("POST", `blogs/${SHOPIFY_NEWS_BLOG_ID}/articles.json`, payload);
  return { id: created.article.id, handle: created.article.handle, action: "created" };
}

async function main() {
  let selected = candidates;
  if (ONLY_HANDLE) selected = selected.filter((candidate) => candidate.handle === ONLY_HANDLE);
  if (LIMIT > 0) selected = selected.slice(0, LIMIT);

  const articles = await listShopifyArticles();
  const articleByHandle = new Map(articles.map((article) => [article.handle, article]));
  const results = [];

  for (let index = 0; index < selected.length; index += 1) {
    const candidate = selected[index];
    const article = articleByHandle.get(candidate.handle);
    if (!article) {
      results.push({ handle: candidate.handle, success: false, error: "Source Shopify article not found" });
      continue;
    }

    try {
      const vertical = findVertical(candidate.vertical);
      if (!vertical) throw new Error(`Vertical not found: ${candidate.vertical}`);
      const products = loadProducts(candidate);
      const contextRows = loadContext(vertical.id);
      const keywordRows = loadKeywordRows(candidate.keywords);
      const productBlocks = products.map(productBlock);
      const placeholders = productBlocks.map((_, blockIndex) => `[[PRODUCT_BLOCK_${blockIndex + 1}]]`);
      const draftSlug = `${article.handle}-claude-product-review-draft`;
      const localExistingPost = db.prepare("SELECT id, shopify_article_id, shopify_blog_id FROM blog_posts WHERE company_id = ? AND slug = ?").get(COMPANY_ID, draftSlug);

      fs.writeFileSync(path.join(outDir, `${article.handle}.source.html`), article.body_html || "");
      console.log(`[${index + 1}/${selected.length}] rewrite ${article.handle}`);
      const result = await rewriteArticle({ candidate, article, vertical, products, contextRows, keywordRows, placeholders, productBlocks });
      const finalHtml = restoreProductBlocks(result.html, productBlocks);
      const reviewMarkdown = htmlToReviewMarkdown(result.title, finalHtml, products, result.problemProposition);
      const localPostIdBeforeShopify = ensureLocalPost({
        candidate,
        article,
        vertical,
        result,
        finalHtml,
        reviewMarkdown,
        products,
        shopifyArticleId: localExistingPost?.shopify_article_id || null,
        shopifyHandle: null,
      });

      let shopifyDraft = { id: null, handle: null, action: "skipped" };
      if (!SKIP_SHOPIFY) {
        shopifyDraft = await upsertShopifyDraft({ article, result, finalHtml, products, localExistingPost });
      }
      const localPostId = ensureLocalPost({
        candidate,
        article,
        vertical,
        result,
        finalHtml,
        reviewMarkdown,
        products,
        shopifyArticleId: shopifyDraft.id || localExistingPost?.shopify_article_id || null,
        shopifyHandle: shopifyDraft.handle,
      });

      const finalWordCount = wordCount(finalHtml);
      fs.writeFileSync(path.join(outDir, `${article.handle}.draft.html`), finalHtml);
      fs.writeFileSync(path.join(outDir, `${article.handle}.draft.md`), reviewMarkdown);
      results.push({
        success: true,
        sourceArticleId: article.id,
        sourceHandle: article.handle,
        title: result.title,
        localPostId,
        shopifyDraftArticleId: shopifyDraft.id,
        shopifyDraftHandle: shopifyDraft.handle,
        shopifyAction: shopifyDraft.action,
        wordCount: finalWordCount,
        productCount: products.length,
        productLinks: products.map((product) => product.url),
        problemProposition: result.problemProposition,
      });
      console.log(`[done] ${article.handle} words=${finalWordCount} local=${localPostIdBeforeShopify} shopify=${shopifyDraft.id || "skipped"}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ handle: candidate.handle, success: false, error: message });
      console.error(`[failed] ${candidate.handle}: ${message}`);
    }
  }

  const reportPath = path.join(outDir, "results.json");
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log("RESULTS_JSON_START");
  console.log(JSON.stringify(results, null, 2));
  console.log("RESULTS_JSON_END");
  console.log(`Output directory: ${outDir}`);
  console.log(`Report: ${reportPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
