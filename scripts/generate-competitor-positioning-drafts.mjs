import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MODEL = process.env.BLOG_ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
const SHOPIFY_SHOP = process.env.SHOPIFY_SHOP || "iboltmounts";
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN;
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";
const DB_PATH = process.env.DATABASE_PATH || (fs.existsSync("data/standalone-blog-writer.db") ? "data/standalone-blog-writer.db" : "data/sourceannotator.db");
const SHOPIFY_NEWS_BLOG_ID = 104843772196;
const DRY_RUN = process.argv.includes("--dry-run");
const ALLOW_IBOLT_DEMO_SCRIPT = process.env.ALLOW_IBOLT_DEMO_SCRIPTS === "true" || process.argv.includes("--ibolt-demo");

if (!ALLOW_IBOLT_DEMO_SCRIPT) {
  throw new Error("This legacy iBolt demo script is not part of standalone production. Pass --ibolt-demo or set ALLOW_IBOLT_DEMO_SCRIPTS=true to run it intentionally.");
}

const bannedPhrases = [
  "utilize",
  "leverage",
  "streamline",
  "robust",
  "game-changer",
  "revolutionize",
  "seamless",
  "cutting-edge",
  "next-level",
  "groundbreaking",
  "innovative solution",
  "state-of-the-art",
  "paradigm shift",
  "synergy",
  "empower",
  "holistic",
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
  "portable",
];

const competitorFacts = {
  ram: {
    name: "RAM Mounts",
    sources: [
      "https://rammount.com/collections/tablet-mounts-holders",
      "https://rammount.com/products/ram-vb-168-ro1-tab-sm",
      "https://rammount.com/products/ram-hol-tab-lgu",
    ],
    facts: [
      "RAM has a very broad tablet mount catalog, including Tab-Tite, Tab-Lock, X-Grip, GDS docks, no-drill vehicle bases, and many device-specific holders.",
      "RAM's truck No-Drill Tab-Tite kit uses a vehicle base, telescoping pole, double swing arm, round plate, and Tab-Tite holder, and can cost several hundred dollars as a complete kit.",
      "RAM is strong when the buyer wants a very large ecosystem, vehicle-specific bases, device-specific holders, and lifetime-warranty components.",
      "RAM's breadth can create selection complexity for warehouse teams that need a simpler standard across forklifts, scanners, tablets, and AMPS accessories.",
    ],
  },
  arkon: {
    name: "Arkon",
    sources: [
      "https://arkon.com/products/flbk256tab5-forklift-pillar-locking-tablet-mount",
      "https://arkon.com/products/fltab106-forklift-tablet-holder-mount",
      "https://arkon.com/products/tab506amps-locking-tablet-mount",
    ],
    facts: [
      "Arkon offers forklift tablet products such as LockVise locking front guard mounts, Slim-Grip forklift tablet mounts, multi-angle locking tablet arms, and SteadyMag magnetic systems.",
      "Arkon is strong for buyers who want ready-made tablet holders with clear forklift and warehouse product pages.",
      "Arkon's LockVise and Slim-Grip pages emphasize locking holders, forklift pillars, pallet jacks, factories, warehouses, AMPS patterns, and tablet size ranges.",
      "Arkon can be a good fit for one-off tablet holder purchases, while iBOLT should be positioned around broader operational systems, modularity, LockPro, AMPS compatibility, and repeatable deployment.",
    ],
  },
  tackform: {
    name: "Tackform",
    sources: [
      "https://www.tackform.com/collections/eld-tablet-mounts-for-truck",
      "https://www.tackform.com/products/amps-drill-base-mount-10-5-length-tablet-holder-26-series",
      "https://www.tackform.com/products/eld-compliant-tablet-mount-by-tackform-enterprise-series-commercial-holder-for-ipad-galaxy-tab-lg-g-pad-aluminum-key-lock-cradle-for-7-to-10-screen-sizes-and-amps-mounting-base",
    ],
    facts: [
      "Tackform has a strong semi-truck and ELD catalog with dashboard drill bases, grab-handle mounts, floor bolt and seat rail mounts, windshield mounts, cup holder options, 20mm, 25.4mm, and 26mm ball systems, and AMPS-compatible products.",
      "Tackform's ELD pages emphasize truck drivers, ELD compliance, dashboard positioning, 7 to 18.4 inch tablet ranges on some holders, metal and composite holder choices, and same or next business day shipping.",
      "Tackform is strong for individual truckers and semi-truck-specific shopping paths with many mount-location filters.",
      "iBOLT should be positioned for fleets that want standardized AMPS mounting, locking choices, shift-change security, and a catalog that connects trucks, vans, warehouses, and fixed workstations.",
    ],
  },
};

const specs = [
  {
    slug: "ibolt-vs-ram-mounts-warehouse-forklift-guide",
    type: "competitor",
    title: "iBOLT vs RAM Mounts: Warehouse and Forklift Guide",
    metaTitle: "iBOLT vs RAM Mounts for Forklifts",
    metaDescription: "Compare iBOLT and RAM Mounts for warehouse tablets, forklift displays, AMPS compatibility, locking, and fleet standardization.",
    verticalSlug: "forklifts-warehousing",
    competitorKey: "ram",
    targetWords: "1200 to 1800",
    angle: "forklift and warehouse teams choosing between a broad mounting ecosystem and a purpose-built operational standard.",
    productHandles: [
      "ibolt-lockprotm-incredibolttm-360-pillar-mount-heavy-duty-forklift-tablet-mount-for-warehouse-vehicles-and-7-10-inch-tablets",
      "ibolt-tabdock-incredibolt-360-forklift-tablet-mount",
      "ibolt-tabdock-bizmount-pillar-mount-heavy-duty-forklift-tablet-mount-for-warehouse-vehicles-and-7-10-inch-tablets",
      "ibolt-amps-monitor-pillar-mount-with-57mm-2-25-inch-ball-joint",
    ],
  },
  {
    slug: "ibolt-vs-arkon-business-tablet-mount-guide",
    type: "competitor",
    title: "iBOLT vs Arkon: Business Tablet Mount Guide",
    metaTitle: "iBOLT vs Arkon Tablet Mounts",
    metaDescription: "Compare iBOLT and Arkon for business tablet mounting, locking holders, forklift use, AMPS parts, and repeatable deployments.",
    verticalSlug: "general-mounting",
    competitorKey: "arkon",
    targetWords: "1200 to 1800",
    angle: "operations buyers comparing a ready-made holder catalog against a modular system for warehouses, POS counters, carts, and shared workstations.",
    productHandles: [
      "ibolt-dock-n-lock-incredibolt-360-amps",
      "ibolt-quad-tablet-tower-stand",
      "ibolt-clamp-base-for-4-hole-amps-mounts",
      "ibolt-tabdock-bizmount-pillar-mount-heavy-duty-forklift-tablet-mount-for-warehouse-vehicles-and-7-10-inch-tablets",
    ],
  },
  {
    slug: "ibolt-vs-tackform-eld-trucking-buyer-guide",
    type: "competitor",
    title: "iBOLT vs Tackform: ELD and Trucking Buyer Guide",
    metaTitle: "iBOLT vs Tackform for ELD Mounts",
    metaDescription: "Compare iBOLT and Tackform for ELD tablet mounts, truck dashboards, AMPS drill bases, locking holders, and fleet installs.",
    verticalSlug: "trucking-fleet",
    competitorKey: "tackform",
    targetWords: "1200 to 1800",
    angle: "fleet and driver buyers choosing between semi-truck-focused mount menus and standardized AMPS-ready fleet deployment.",
    productHandles: [
      "ibolt-lockpro-flexpro-heavy-duty-locking-tablet-seat-rail-mount",
      "ibolt-dock-n-lock-incredibolt-360-amps",
      "tabdock-fixedpro-360-heavy-duty-metal-drill-base-tablet-mount-ibbz-33768",
      "tabdock-bizmount-console-heavy-duty-cup-holder-mount-ibbz-33784",
    ],
  },
  {
    slug: "smart-forklift-tablet-mount-choice-for-warehouses",
    type: "positioning",
    title: "The Smart Forklift Tablet Mount Choice for Warehouses",
    metaTitle: "Smart Forklift Tablet Mount Choice",
    metaDescription: "Choose a forklift tablet mount around shift security, vibration, AMPS compatibility, device access, and fleet maintenance.",
    verticalSlug: "forklifts-warehousing",
    targetWords: "1000 to 1500",
    angle: "warehouse teams that have thought past the first install and care about shift-change security, vibration, AMPS compatibility, and fleet-scale replacement cost.",
    productHandles: [
      "ibolt-lockprotm-incredibolttm-360-pillar-mount-heavy-duty-forklift-tablet-mount-for-warehouse-vehicles-and-7-10-inch-tablets",
      "ibolt-dock-n-lock-bizmount-forklift-locking-tablet-mount",
      "heavy-duty-metal-forklift-pillar-bracket-amps-pattern-ibfl-34500",
      "ibolt-barcode-scanner-holder-1-inch-25-mm-ball-amps-pattern-ibfl-34502",
    ],
  },
  {
    slug: "smart-eld-tablet-mount-choice-for-truck-fleets",
    type: "positioning",
    title: "The Smart ELD Tablet Mount Choice for Truck Fleets",
    metaTitle: "Smart ELD Tablet Mount Choice",
    metaDescription: "Pick an ELD tablet mount based on driver visibility, cable routing, locking, AMPS parts, and fleet standardization.",
    verticalSlug: "trucking-fleet",
    targetWords: "1000 to 1500",
    angle: "truck fleets that care about driver visibility, ELD compliance, install repeatability, AMPS compatibility, cable routing, and shared-vehicle security.",
    productHandles: [
      "ibolt-lockpro-flexpro-heavy-duty-locking-tablet-seat-rail-mount",
      "ibolt-dock-n-lock-incredibolt-360-amps",
      "tabdock-fixedpro-360-heavy-duty-metal-drill-base-tablet-mount-ibbz-33768",
      "ibolt-phone-dock-n-lock-incredibolt-amps-w-4-25-double-socket-arm-locking-drill-base-mount-for-smartphones-great-for-trucks-eld-s-wall-mounting-sprinter-vans-etc",
    ],
  },
];

if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured.");
if (!DRY_RUN && !SHOPIFY_TOKEN) throw new Error("SHOPIFY_ACCESS_TOKEN or SHOPIFY_ADMIN_API_ACCESS_TOKEN is required.");

const db = new Database(DB_PATH);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const outputDir = path.join("content-output", "competitor-positioning-drafts", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(outputDir, { recursive: true });

function getVertical(slug) {
  return db.prepare("SELECT * FROM industry_verticals WHERE slug = ?").get(slug);
}

function getContext(verticalId) {
  if (!verticalId) return [];
  return db.prepare(`
    SELECT category, content
    FROM context_entries
    WHERE vertical_id = ?
    ORDER BY category, confidence DESC
    LIMIT 30
  `).all(verticalId);
}

function getProducts(handles) {
  const stmt = db.prepare(`
    SELECT id, title, handle, description, product_type, vendor, tags, image_url, price, url
    FROM ibolt_products
    WHERE handle = ?
  `);
  return handles.map((handle) => stmt.get(handle)).filter(Boolean);
}

function productCard(product) {
  const url = product.url || `https://iboltmounts.com/products/${product.handle}`;
  const imageUrl = product.image_url || "";
  const price = product.price ? `$${product.price}` : "See current price";
  if (!imageUrl) return "";
  return `<div style="text-align: center; margin: 20px 0;">
  <a href="${url}">
    <img src="${imageUrl}" alt="${escapeHtml(product.title)} for commercial mounting setup" style="max-width: 400px; width: 100%; height: auto; border-radius: 8px;" loading="lazy">
  </a>
  <p style="font-size: 14px; color: #666; margin-top: 8px;"><strong>${escapeHtml(product.title)}</strong> - ${escapeHtml(price)}</p>
</div>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(html) {
  const text = stripHtml(html);
  return text ? text.split(/\s+/).length : 0;
}

function countOccurrences(text, needle) {
  return String(text).split(needle).length - 1;
}

function extractJson(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON object returned: ${text.slice(0, 300)}`);
  return JSON.parse(match[0]);
}

function normalizeHtml(html) {
  return String(html || "")
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/[—–]/g, ",")
    .trim();
}

function validateHtml(html, expectedCards) {
  const issues = [];
  if (!/^<article[\s>]/i.test(html)) issues.push("missing opening article tag");
  if (!/<\/article>\s*$/i.test(html)) issues.push("missing closing article tag");
  for (let index = 0; index < expectedCards; index += 1) {
    const count = countOccurrences(html, `[[PRODUCT_CARD_${index + 1}]]`);
    if (count !== 1) issues.push(`PRODUCT_CARD_${index + 1} appears ${count} times`);
  }
  for (const phrase of bannedPhrases) {
    if (html.toLowerCase().includes(phrase.toLowerCase())) {
      issues.push(`banned phrase: ${phrase}`);
    }
  }
  if (/[—–]/.test(html)) issues.push("contains em dash or en dash");
  return issues;
}

function restoreProductCards(html, cards) {
  return cards.reduce(
    (current, card, index) => current.replace(`[[PRODUCT_CARD_${index + 1}]]`, card),
    html,
  );
}

function productPrompt(products) {
  return products.map((p, index) => {
    return `Product card ${index + 1}: [[PRODUCT_CARD_${index + 1}]]
Title: ${p.title}
URL: ${p.url || `https://iboltmounts.com/products/${p.handle}`}
Price: ${p.price || "unknown"}
Type: ${p.product_type || "mounting product"}
Tags: ${p.tags || ""}
Description excerpt: ${stripHtml(p.description).slice(0, 500)}`;
  }).join("\n\n");
}

function contextPrompt(vertical, entries) {
  const parts = [];
  if (vertical) {
    parts.push(`Vertical: ${vertical.name} (${vertical.slug})`);
    parts.push(`Description: ${vertical.description || ""}`);
    parts.push(`Terminology: ${vertical.terminology || ""}`);
    parts.push(`Pain points: ${vertical.pain_points || ""}`);
    parts.push(`Use cases: ${vertical.use_cases || ""}`);
    parts.push(`Regulations: ${vertical.regulations || ""}`);
    parts.push(`Compatible devices: ${vertical.compatible_devices || ""}`);
  }
  for (const entry of entries) {
    parts.push(`${entry.category}: ${entry.content}`);
  }
  return parts.filter(Boolean).join("\n");
}

function buildWriterSystem() {
  return `You are the iBOLT Mounts senior content editor.

Write Shopify-ready HTML that reads like a practical buyer guide from a mounting systems specialist.

Brand voice:
- Conversational expertise, education-first, specific, practical.
- iBOLT is the specialist for business, warehouse, fleet, vehicle, and industrial mounting.
- Never frame iBOLT as cheap, budget, or merely an alternative.
- Use iBOLT exactly.
- Mention real operational criteria: vibration over a full shift, shift-change security, lockability, AMPS patterns, VESA patterns, ball size compatibility, cable routing, charging access, driver/operator visibility, fleet maintenance, and repeatable installs.
- Be honest about competitor strengths.
- Do not use these words or phrases: ${bannedPhrases.join(", ")}.
- Do not use em dashes or en dashes.

Output rules:
- Return one JSON object only with keys: title, metaTitle, metaDescription, slug, html.
- html must start with <article> and end with </article>.
- Include each provided [[PRODUCT_CARD_N]] placeholder exactly once.
- Use product links naturally in the prose.
- Use H2 headings. Use a side-by-side comparison table for competitor posts.
- Include a FAQ section.
- Do not include markdown fences or commentary.`;
}

function buildWriterPrompt(spec, vertical, contextEntries, products) {
  const competitor = spec.competitorKey ? competitorFacts[spec.competitorKey] : null;
  const postTypeRules = spec.type === "competitor"
    ? `Post type: competitor comparison.
Write an "iBOLT vs. ${competitor.name}" buyer's guide.
Open with the buyer's real operational problem, not the product.
Build the comparison around use-case fit, not raw specs.
Acknowledge ${competitor.name}'s genuine strengths honestly.
Close with a specific recommendation by buyer type.
Target length: ${spec.targetWords} words.
Competitor data from the app/context:
${competitor.facts.map((fact) => `- ${fact}`).join("\n")}
Competitor source URLs for internal factual grounding, do not turn this into a citation essay:
${competitor.sources.map((source) => `- ${source}`).join("\n")}`
    : `Post type: smart option positioning.
Core argument: this is the mount choice for teams that have actually thought through the operational problem, including shift-change security, fleet-scale cost, vibration over an 8-hour shift, AMPS compatibility, and locking mechanisms.
Do not use the word "portable".
Do not frame iBOLT as a budget option.
Frame iBOLT as purpose-built and fleet-ready.
Target length: ${spec.targetWords} words.`;

  return `Generate this blog post.

Required title: ${spec.title}
Required slug: ${spec.slug}
Required meta title: ${spec.metaTitle}
Required meta description: ${spec.metaDescription}
Angle: ${spec.angle}

${postTypeRules}

iBOLT product catalog data to use:
${productPrompt(products)}

Vertical and context bank data:
${contextPrompt(vertical, contextEntries)}

Make sure every sentence earns its place. Avoid vague claims. Return JSON only.`;
}

function buildVerifierSystem() {
  return `You are the iBOLT blog verifier. Score the post from 0 to 100.

Check brand voice, SEO, natural language, factual accuracy, operational specificity, competitor fairness, and whether every product claim is supported by provided data.

Return JSON only:
{
  "brandConsistency": 0,
  "seoOptimization": 0,
  "naturalLanguage": 0,
  "factualAccuracy": 0,
  "operationalSpecificity": 0,
  "competitorFairness": 0,
  "overallScore": 0,
  "passesQualityGate": true,
  "issues": [],
  "suggestions": []
}`;
}

async function generateText(system, user, maxTokens, temperature = 0.35) {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    temperature,
    system,
    messages: [{ role: "user", content: user }],
  });
  return response.content.filter((item) => item.type === "text").map((item) => item.text).join("\n").trim();
}

async function writePost(spec, revisionContext = "") {
  const vertical = getVertical(spec.verticalSlug);
  const contextEntries = getContext(vertical?.id);
  const products = getProducts(spec.productHandles);
  const cards = products.map(productCard).filter(Boolean).slice(0, 3);
  const prompt = buildWriterPrompt({ ...spec, productHandles: spec.productHandles.slice(0, cards.length) }, vertical, contextEntries, products.slice(0, cards.length));
  let validationContext = revisionContext;
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const text = await generateText(
      buildWriterSystem(),
      validationContext ? `${prompt}\n\nRevision requirement:\n${validationContext}` : prompt,
      9000,
      validationContext ? 0.25 : 0.42,
    );
    const parsed = extractJson(text);
    parsed.html = normalizeHtml(parsed.html);
    const issues = validateHtml(parsed.html, cards.length);
    if (issues.length === 0) {
      parsed.html = restoreProductCards(parsed.html, cards);
      parsed.wordCount = wordCount(parsed.html);
      parsed.products = products.slice(0, cards.length);
      return parsed;
    }

    lastError = new Error(`HTML validation failed: ${issues.join("; ")}`);
    validationContext = [
      revisionContext,
      `Fix these validation issues exactly: ${issues.join("; ")}.`,
      "Keep the same required slug, product placeholders, and JSON-only response format.",
    ].filter(Boolean).join("\n");
  }

  throw lastError;
}

async function verifyPost(spec, generated) {
  const text = await generateText(
    buildVerifierSystem(),
    `Spec:
${JSON.stringify({ title: spec.title, type: spec.type, targetWords: spec.targetWords, angle: spec.angle }, null, 2)}

HTML:
${generated.html}`,
    2500,
    0.1,
  );
  const result = extractJson(text);
  const localIssues = [];
  if (generated.wordCount < 900) localIssues.push(`word count low: ${generated.wordCount}`);
  if (spec.type === "competitor" && generated.wordCount < 1150) localIssues.push(`competitor post below requested range: ${generated.wordCount}`);
  for (const phrase of bannedPhrases) {
    if (generated.html.toLowerCase().includes(phrase.toLowerCase())) localIssues.push(`banned phrase: ${phrase}`);
  }
  if (/[—–]/.test(generated.html)) localIssues.push("contains em dash or en dash");
  if (localIssues.length > 0) {
    result.issues = [...(result.issues || []), ...localIssues];
    result.overallScore = Math.min(Number(result.overallScore || 0), 69);
    result.passesQualityGate = false;
  }
  return result;
}

async function shopify(method, endpoint, body) {
  const response = await fetch(
    `https://${SHOPIFY_SHOP}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/${endpoint}`,
    {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_TOKEN,
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  if (!response.ok) throw new Error(`Shopify ${method} ${endpoint} failed: ${response.status} ${await response.text()}`);
  return response.status === 204 ? {} : response.json();
}

async function saveShopifyDraft(post) {
  const metafields = [];
  if (post.metaTitle) {
    metafields.push({ namespace: "global", key: "title_tag", value: post.metaTitle, type: "single_line_text_field" });
  }
  if (post.metaDescription) {
    metafields.push({ namespace: "global", key: "description_tag", value: post.metaDescription, type: "single_line_text_field" });
  }

  if (post.shopifyArticleId) {
    const result = await shopify("PUT", `blogs/${SHOPIFY_NEWS_BLOG_ID}/articles/${Number(post.shopifyArticleId)}.json`, {
      article: {
        id: Number(post.shopifyArticleId),
        title: post.title,
        body_html: post.html,
        tags: post.tags,
        published: false,
      },
    });
    return result.article;
  }

  const result = await shopify("POST", `blogs/${SHOPIFY_NEWS_BLOG_ID}/articles.json`, {
    article: {
      title: post.title,
      body_html: post.html,
      tags: post.tags,
      published: false,
      handle: post.slug,
      ...(metafields.length ? { metafields } : {}),
    },
  });
  return result.article;
}

function existingPost(slug) {
  return db.prepare("SELECT * FROM blog_posts WHERE slug = ?").get(slug);
}

const insertPost = db.prepare(`
  INSERT INTO blog_posts (
    id, title, slug, meta_title, meta_description, markdown, html, cluster_id, vertical_id,
    status, word_count, brand_consistency, seo_optimization, natural_language, factual_accuracy,
    overall_score, verification_notes, generated_at, updated_at, shopify_article_id, shopify_blog_id, shopify_synced_at
  ) VALUES (
    @id, @title, @slug, @meta_title, @meta_description, @markdown, @html, @cluster_id, @vertical_id,
    @status, @word_count, @brand_consistency, @seo_optimization, @natural_language, @factual_accuracy,
    @overall_score, @verification_notes, @generated_at, @updated_at, @shopify_article_id, @shopify_blog_id, @shopify_synced_at
  )
`);

const updatePost = db.prepare(`
  UPDATE blog_posts SET
    title = @title,
    meta_title = @meta_title,
    meta_description = @meta_description,
    html = @html,
    status = @status,
    word_count = @word_count,
    brand_consistency = @brand_consistency,
    seo_optimization = @seo_optimization,
    natural_language = @natural_language,
    factual_accuracy = @factual_accuracy,
    overall_score = @overall_score,
    verification_notes = @verification_notes,
    updated_at = @updated_at,
    shopify_article_id = @shopify_article_id,
    shopify_blog_id = @shopify_blog_id,
    shopify_synced_at = @shopify_synced_at
  WHERE id = @id
`);

function saveLocal(spec, generated, verification, article) {
  const vertical = getVertical(spec.verticalSlug);
  const existing = existingPost(spec.slug);
  const now = Date.now();
  const syncedAt = new Date().toISOString();
  const row = {
    id: existing?.id || randomUUID(),
    title: generated.title || spec.title,
    slug: spec.slug,
    meta_title: generated.metaTitle || spec.metaTitle,
    meta_description: generated.metaDescription || spec.metaDescription,
    markdown: null,
    html: generated.html,
    cluster_id: null,
    vertical_id: vertical?.id || null,
    status: "approved",
    word_count: generated.wordCount,
    brand_consistency: Number(verification.brandConsistency || 0),
    seo_optimization: Number(verification.seoOptimization || 0),
    natural_language: Number(verification.naturalLanguage || 0),
    factual_accuracy: Number(verification.factualAccuracy || 0),
    overall_score: Number(verification.overallScore || 0),
    verification_notes: JSON.stringify({
      ...verification,
      postType: spec.type,
      generatedWithClaudeAt: syncedAt,
      model: MODEL,
      shopifyState: "draft",
      competitorSources: spec.competitorKey ? competitorFacts[spec.competitorKey].sources : [],
    }),
    generated_at: existing?.generated_at || now,
    updated_at: now,
    shopify_article_id: article?.id || existing?.shopify_article_id || null,
    shopify_blog_id: SHOPIFY_NEWS_BLOG_ID,
    shopify_synced_at: article ? syncedAt : existing?.shopify_synced_at || null,
  };
  if (existing) updatePost.run(row);
  else insertPost.run(row);
  return row;
}

const results = [];
for (const spec of specs) {
  console.log(`[generate] ${spec.slug}`);
  let generated;
  let verification;
  let failed = false;
  let error = null;

  try {
    generated = await writePost(spec);
    verification = await verifyPost(spec, generated);
    if (!verification.passesQualityGate || Number(verification.overallScore || 0) <= 70) {
      console.log(`[retry] ${spec.slug} score=${verification.overallScore}`);
      generated = await writePost(spec, `The verifier scored the first draft ${verification.overallScore}/100. Fix these issues: ${(verification.issues || []).join("; ")}. Suggestions: ${(verification.suggestions || []).join("; ")}. Keep the same product placeholders.`);
      verification = await verifyPost(spec, generated);
    }

    if (!verification.passesQualityGate || Number(verification.overallScore || 0) <= 70) {
      failed = true;
      error = `quality gate failed: ${verification.overallScore}`;
      console.error(`[manual-review] ${spec.slug} ${error}`);
    }
  } catch (err) {
    failed = true;
    error = err instanceof Error ? err.message : String(err);
    console.error(`[failed] ${spec.slug}: ${error}`);
  }

  let article = null;
  let local = null;
  if (!failed && generated && verification) {
    fs.writeFileSync(path.join(outputDir, `${spec.slug}.html`), generated.html);
    fs.writeFileSync(path.join(outputDir, `${spec.slug}.verification.json`), JSON.stringify(verification, null, 2));
    if (!DRY_RUN) {
      const existing = existingPost(spec.slug);
      article = await saveShopifyDraft({
        title: generated.title || spec.title,
        slug: spec.slug,
        metaTitle: generated.metaTitle || spec.metaTitle,
        metaDescription: generated.metaDescription || spec.metaDescription,
        html: generated.html,
        tags: ["ibolt-blog", "shopify-draft", spec.type, spec.verticalSlug, spec.slug].join(", "),
        shopifyArticleId: existing?.shopify_article_id,
      });
      local = saveLocal(spec, generated, verification, article);
    }
  }

  results.push({
    slug: spec.slug,
    title: generated?.title || spec.title,
    success: !failed,
    error,
    score: verification?.overallScore || null,
    wordCount: generated?.wordCount || null,
    localId: local?.id || null,
    shopifyArticleId: article?.id || null,
    shopifyAdminUrl: article?.id ? `https://admin.shopify.com/store/${SHOPIFY_SHOP}/articles/${article.id}` : null,
    draftPublicUrl: `https://iboltmounts.com/blogs/news/${spec.slug}`,
  });
  console.log(`[result] ${spec.slug} success=${!failed} score=${verification?.overallScore || "n/a"} words=${generated?.wordCount || "n/a"}`);
}

console.log("RESULTS_JSON_START");
console.log(JSON.stringify(results, null, 2));
console.log("RESULTS_JSON_END");
console.log(`Output directory: ${outputDir}`);
