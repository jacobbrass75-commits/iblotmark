// Product feed audit service for checking hero SKU readiness before broad blog generation.

import { and, desc, eq } from "drizzle-orm";
import { db } from "./db";
import { productFeedAudits, products, type Product, type ProductFeedAudit } from "@shared/schema";
import { DEFAULT_COMPANY_ID } from "./companyDefaults";
import { getCompanyContext } from "./companyContext";
import { readResponseTextLimited, safeFetch } from "./safeFetch";

const SHOPIFY_BASE = "https://iboltmounts.com";

type AuditStatus = "ready" | "needs_review" | "blocked";
type ProductGapRisk = "low" | "medium" | "high";
type CheckStatus = "pass" | "warn" | "fail";

export type ProductFeedAuditCheck = {
  key: string;
  label: string;
  status: CheckStatus;
  score: number;
  maxScore: number;
  details: string;
};

type ShopifyVariant = {
  id?: number;
  sku?: string | null;
  available?: boolean;
  price?: number | string | null;
};

type ShopifyProductJs = {
  id?: number;
  title?: string;
  handle?: string;
  description?: string;
  vendor?: string;
  type?: string;
  product_type?: string;
  tags?: string[];
  available?: boolean;
  price?: number | string | null;
  featured_image?: string | null;
  images?: string[];
  variants?: ShopifyVariant[];
};

type LaneConfig = {
  lane: string;
  label: string;
  fallbackHandle: string;
  discoveryTerms: string[];
  requiredTitleTerms: string[];
  descriptionTopics: Array<{ key: string; label: string; terms: string[] }>;
};

export const DEFAULT_PRODUCT_FEED_AUDIT_LANES: LaneConfig[] = [
  {
    lane: "independent-gig-driver",
    label: "Independent gig driver",
    fallbackHandle: "ibolt-xprodock-nfc-bizmount-phone-holder-mount-heavy-duty-suction-cup-base-and-1-5m-usb-c-cable-ibbz-33969",
    discoveryTerms: ["delivery", "doordash", "ubereats", "driver", "phone", "suction", "charge", "usb"],
    requiredTitleTerms: ["phone", "dock", "mount", "holder", "suction", "charge"],
    descriptionTopics: [
      { key: "one_hand_use", label: "one-hand use", terms: ["one hand", "one-hand", "single hand", "quick release", "dock"] },
      { key: "case_compatibility", label: "case compatibility", terms: ["case", "width", "2.25", "3.8", "compatible"] },
      { key: "charging", label: "charging", terms: ["charging", "charger", "usb-c", "usb c", "cable", "power"] },
      { key: "mount_location", label: "mount location", terms: ["windshield", "dashboard", "dash", "suction", "vehicle"] },
      { key: "vibration", label: "vibration resistance", terms: ["vibration", "stable", "secure", "heavy duty", "industrial"] },
      { key: "heat", label: "heat/sun exposure", terms: ["heat", "temperature", "sun", "uv", "hot"] },
      { key: "cable_routing", label: "cable routing", terms: ["cable", "routing", "route", "usb", "charging"] },
      { key: "who_should_not_buy", label: "who should not buy", terms: ["not for", "not compatible", "should not", "does not fit", "limitations"] },
    ],
  },
  {
    lane: "delivery-van-shared-fleet",
    label: "Delivery van/shared fleet",
    fallbackHandle: "ibolt-phone-dock-n-lock-incredibolt-amps-w-4-25-double-socket-arm-locking-drill-base-mount-for-smartphones-great-for-trucks-eld-s-wall-mounting-sprinter-vans-etc",
    discoveryTerms: ["fleet", "van", "sprinter", "eld", "locking", "phone", "amps", "drill"],
    requiredTitleTerms: ["phone", "locking", "amps", "fleet", "truck", "van", "mount"],
    descriptionTopics: [
      { key: "one_hand_use", label: "one-hand use", terms: ["one hand", "one-hand", "dock", "lock", "quick"] },
      { key: "case_compatibility", label: "case compatibility", terms: ["case", "phone", "smartphone", "width", "fits"] },
      { key: "charging", label: "charging", terms: ["charging", "charger", "usb", "cable", "power"] },
      { key: "mount_location", label: "mount location", terms: ["sprinter", "van", "truck", "wall", "drill", "amps", "eld"] },
      { key: "vibration", label: "vibration resistance", terms: ["vibration", "heavy duty", "secure", "industrial", "locking"] },
      { key: "heat", label: "heat/sun exposure", terms: ["heat", "temperature", "sun", "uv", "hot"] },
      { key: "cable_routing", label: "cable routing", terms: ["cable", "routing", "route", "usb", "charging"] },
      { key: "who_should_not_buy", label: "who should not buy", terms: ["not for", "not compatible", "should not", "does not fit", "limitations"] },
    ],
  },
  {
    lane: "heavy-duty-vehicle-phone",
    label: "Heavy-duty vehicle phone",
    fallbackHandle: "ibolt-moto-vise-incredibolt-360-heavy-duty-phone-clamp-handlebar-rail-mount",
    discoveryTerms: ["heavy duty", "phone", "clamp", "rail", "handlebar", "vehicle", "incredibolt"],
    requiredTitleTerms: ["heavy", "duty", "phone", "clamp", "mount", "vehicle"],
    descriptionTopics: [
      { key: "one_hand_use", label: "one-hand use", terms: ["one hand", "one-hand", "quick", "adjustable"] },
      { key: "case_compatibility", label: "case compatibility", terms: ["case", "width", "phone", "fits", "compatible"] },
      { key: "charging", label: "charging", terms: ["charging", "charger", "usb", "cable", "power"] },
      { key: "mount_location", label: "mount location", terms: ["handlebar", "rail", "pole", "post", "clamp"] },
      { key: "vibration", label: "vibration resistance", terms: ["vibration", "heavy duty", "secure", "industrial", "incredibolt"] },
      { key: "heat", label: "heat/sun exposure", terms: ["heat", "temperature", "sun", "uv", "hot"] },
      { key: "cable_routing", label: "cable routing", terms: ["cable", "routing", "route", "usb", "charging"] },
      { key: "who_should_not_buy", label: "who should not buy", terms: ["not for", "not compatible", "should not", "does not fit", "limitations"] },
    ],
  },
  {
    lane: "thick-case-delivery-driver",
    label: "Thick-case delivery driver",
    fallbackHandle: "ibolt-miniproxl-holder-w-17mm-ball-joint-works-with-phones-2-25-in-58mm-to-3-8-in-97mm-wide-and-all-industry-standard-17mm-mounts",
    discoveryTerms: ["phone", "holder", "3.8", "97mm", "case", "miniproxl", "wide"],
    requiredTitleTerms: ["phone", "holder", "wide", "3.8", "97mm", "case"],
    descriptionTopics: [
      { key: "one_hand_use", label: "one-hand use", terms: ["one hand", "one-hand", "quick", "holder"] },
      { key: "case_compatibility", label: "case compatibility", terms: ["case", "3.8", "97mm", "wide", "width"] },
      { key: "charging", label: "charging", terms: ["charging", "charger", "usb", "cable", "power"] },
      { key: "mount_location", label: "mount location", terms: ["17mm", "ball", "mount", "dashboard", "windshield"] },
      { key: "vibration", label: "vibration resistance", terms: ["vibration", "secure", "heavy duty", "stable"] },
      { key: "heat", label: "heat/sun exposure", terms: ["heat", "temperature", "sun", "uv", "hot"] },
      { key: "cable_routing", label: "cable routing", terms: ["cable", "routing", "route", "usb", "charging"] },
      { key: "who_should_not_buy", label: "who should not buy", terms: ["not for", "not compatible", "should not", "does not fit", "limitations"] },
    ],
  },
];

function genericDescriptionTopics(): LaneConfig["descriptionTopics"] {
  return [
    { key: "use_case", label: "primary use case", terms: ["use", "works", "designed", "ideal", "built"] },
    { key: "fit_compatibility", label: "fit/compatibility", terms: ["fits", "compatible", "size", "dimensions", "works with"] },
    { key: "materials", label: "materials/construction", terms: ["material", "steel", "aluminum", "plastic", "durable", "finish"] },
    { key: "installation", label: "installation/setup", terms: ["install", "setup", "mount", "attach", "assembly"] },
    { key: "limits", label: "limitations/restrictions", terms: ["not for", "not compatible", "limit", "restriction", "warning"] },
  ];
}

async function getProductFeedAuditLanes(companyId: string): Promise<LaneConfig[]> {
  if (companyId === DEFAULT_COMPANY_ID) return DEFAULT_PRODUCT_FEED_AUDIT_LANES;

  const companyProducts = await db
    .select()
    .from(products)
    .where(eq(products.companyId, companyId))
    .limit(8);

  return companyProducts
    .filter((product) => product.handle)
    .slice(0, 4)
    .map((product) => {
      const terms = [
        product.title,
        product.productType,
        product.vendor,
        ...(Array.isArray(product.tags) ? product.tags : []),
      ].filter(Boolean).flatMap((value) => String(value).toLowerCase().split(/[^a-z0-9]+/)).filter((term) => term.length > 2);
      const uniqueTerms = Array.from(new Set(terms)).slice(0, 12);
      return {
        lane: `product-${product.handle}`,
        label: product.title,
        fallbackHandle: product.handle,
        discoveryTerms: uniqueTerms,
        requiredTitleTerms: uniqueTerms.slice(0, 6),
        descriptionTopics: genericDescriptionTopics(),
      };
    });
}

function resolveShopifyBase(companyId: string, productUrlPattern?: string | null): string | null {
  if (!productUrlPattern) return companyId === DEFAULT_COMPANY_ID ? SHOPIFY_BASE : null;
  try {
    const url = new URL(productUrlPattern.replace("{handle}", "sample"));
    return url.origin;
  } catch {
    return companyId === DEFAULT_COMPANY_ID ? SHOPIFY_BASE : null;
  }
}

function normalizeText(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function stripHtml(value: string | null | undefined): string {
  return (value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term.toLowerCase()));
}

function addCheck(
  checks: ProductFeedAuditCheck[],
  key: string,
  label: string,
  passed: boolean,
  maxScore: number,
  details: string,
  warnInsteadOfFail = false,
): void {
  checks.push({
    key,
    label,
    status: passed ? "pass" : warnInsteadOfFail ? "warn" : "fail",
    score: passed ? maxScore : warnInsteadOfFail ? Math.floor(maxScore / 2) : 0,
    maxScore,
    details,
  });
}

async function fetchShopifyProduct(handle: string, shopifyBase: string): Promise<ShopifyProductJs | null> {
  const response = await safeFetch(`${shopifyBase}/products/${encodeURIComponent(handle)}.js`, {
    headers: { "User-Agent": "StandaloneBlogWriter/1.0 product-feed-audit" },
    signal: AbortSignal.timeout(15000),
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Shopify product endpoint returned ${response.status} for ${handle}`);
  }

  return JSON.parse(await readResponseTextLimited(response, 1_000_000)) as ShopifyProductJs;
}

async function findLocalProductForLane(companyId: string, config: LaneConfig, explicitHandle?: string): Promise<Product | null> {
  const allProducts = await db.select().from(products).where(eq(products.companyId, companyId));

  if (explicitHandle) {
    const explicit = allProducts.find((product) => product.handle === explicitHandle);
    if (explicit) return explicit;
  }

  const fallback = allProducts.find((product) => product.handle === config.fallbackHandle);
  if (fallback) return fallback;

  const scored = allProducts
    .map((product) => {
      const text = normalizeText([
        product.title,
        product.handle,
        product.description,
        product.productType,
        product.vendor,
        ...(Array.isArray(product.tags) ? product.tags : []),
      ]);
      const score = config.discoveryTerms.reduce((total, term) => total + (text.includes(term) ? 1 : 0), 0);
      return { product, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.product || null;
}

function firstVariantWithSku(shopify: ShopifyProductJs | null): ShopifyVariant | undefined {
  return shopify?.variants?.find((variant) => Boolean(variant.sku)) || shopify?.variants?.[0];
}

function resolvePrice(local: Product | null, shopify: ShopifyProductJs | null): string | null {
  if (local?.price) return local.price;
  const rawPrice = firstVariantWithSku(shopify)?.price ?? shopify?.price;
  if (rawPrice === null || rawPrice === undefined || rawPrice === "") return null;
  if (typeof rawPrice === "number") return (rawPrice / 100).toFixed(2);
  return rawPrice;
}

function buildSnapshot(shopify: ShopifyProductJs | null): Record<string, unknown> | null {
  if (!shopify) return null;
  return {
    id: shopify.id,
    handle: shopify.handle,
    title: shopify.title,
    available: shopify.available,
    vendor: shopify.vendor,
    productType: shopify.type || shopify.product_type,
    price: shopify.price,
    imageCount: shopify.images?.length || (shopify.featured_image ? 1 : 0),
    variants: shopify.variants?.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      available: variant.available,
      price: variant.price,
    })),
    fetchedAt: new Date().toISOString(),
  };
}

function recommendationForCheck(check: ProductFeedAuditCheck): string | null {
  if (check.status === "pass") return null;

  const recommendations: Record<string, string> = {
    availability: "Confirm the hero SKU is published and in stock before using it as the primary blog CTA.",
    title_clarity: "Rewrite the product title or SEO title to include the lane's buyer language and use case.",
    price: "Add a visible product price so marketplace/feed systems and readers can evaluate the offer.",
    sku: "Add SKUs to variants so feed exports, support, and internal reporting can identify the exact product.",
    merchandising: "Fill vendor, brand, and product type fields consistently for Shopify feed readiness.",
    image_presence: "Add at least one clear product image; in-use photos are preferred for blog traffic.",
    schema_feed_readiness: "Prepare schema/feed fields: GTIN/MPN placeholder, product category, condition, availability, price, image, and canonical URL.",
    proof_reviews: "Add proof assets such as reviews, ratings, installation photos, or short customer-use notes.",
  };

  if (check.key.startsWith("description_")) {
    return `Expand product copy to cover ${check.label.replace("description: ", "")}.`;
  }

  return recommendations[check.key] || check.details;
}

function deriveStatus(score: number, checks: ProductFeedAuditCheck[]): AuditStatus {
  const hasAvailabilityFailure = checks.some((check) => check.key === "availability" && check.status === "fail");
  if (hasAvailabilityFailure || score < 45) return "blocked";
  if (score >= 75) return "ready";
  return "needs_review";
}

function deriveProductGapRisk(score: number, checks: ProductFeedAuditCheck[]): ProductGapRisk {
  const failedCoreChecks = checks.filter((check) =>
    ["availability", "title_clarity", "price", "sku", "image_presence"].includes(check.key) && check.status === "fail"
  ).length;
  if (score < 55 || failedCoreChecks >= 2) return "high";
  if (score < 75 || failedCoreChecks === 1) return "medium";
  return "low";
}

function evaluateProduct(config: LaneConfig, product: Product | null, handle: string, shopify: ShopifyProductJs | null, shopifyBase: string | null): {
  checks: ProductFeedAuditCheck[];
  score: number;
  status: AuditStatus;
  productGapRisk: ProductGapRisk;
  recommendations: string[];
} {
  const checks: ProductFeedAuditCheck[] = [];
  const variant = firstVariantWithSku(shopify);
  const title = shopify?.title || product?.title || "";
  const description = stripHtml(shopify?.description || product?.description || product?.catalogDescription);
  const productType = shopify?.type || shopify?.product_type || product?.productType || "";
  const vendor = shopify?.vendor || product?.vendor || "";
  const imageUrl = shopify?.featured_image || shopify?.images?.[0] || product?.imageUrl || "";
  const price = resolvePrice(product, shopify);
  const url = product?.url || (shopifyBase ? `${shopifyBase}/products/${handle}` : "");
  const text = normalizeText([title, handle, description, productType, vendor]);
  const available = shopify ? Boolean(shopify.available || shopify.variants?.some((item) => item.available)) : Boolean(product);

  addCheck(
    checks,
    "availability",
    "in stock/visible",
    available,
    12,
    shopify
      ? `Shopify .js availability is ${available ? "available" : "unavailable"}.`
      : product
        ? "No Shopify .js response was available; using local DB presence as a visibility fallback."
        : "No local product or public Shopify product was found.",
  );

  addCheck(
    checks,
    "title_clarity",
    "title clarity/use-case terms",
    hasAny(normalizeText([title, handle]), config.requiredTitleTerms),
    10,
    `Title/handle should include at least one lane term: ${config.requiredTitleTerms.join(", ")}.`,
    true,
  );

  addCheck(checks, "price", "price", Boolean(price), 8, price ? `Price found: ${price}.` : "No price found.", true);
  addCheck(checks, "sku", "SKU", Boolean(variant?.sku), 8, variant?.sku ? `Primary SKU: ${variant.sku}.` : "No variant SKU found.", true);
  addCheck(
    checks,
    "merchandising",
    "vendor/brand/product type",
    Boolean(vendor && productType),
    8,
    `Vendor: ${vendor || "missing"}; product type: ${productType || "missing"}.`,
    true,
  );
  addCheck(checks, "image_presence", "image presence", Boolean(imageUrl), 8, imageUrl ? "Product image found." : "No product image found.");

  for (const topic of config.descriptionTopics) {
    addCheck(
      checks,
      `description_${topic.key}`,
      `description: ${topic.label}`,
      hasAny(text, topic.terms),
      5,
      `Copy should address ${topic.label}; looked for: ${topic.terms.join(", ")}.`,
      true,
    );
  }

  addCheck(
    checks,
    "schema_feed_readiness",
    "schema/feed readiness placeholders",
    Boolean(url && title && price && imageUrl && (variant?.sku || product?.shopifyId)),
    8,
    "Checks canonical URL, title, price, image, and SKU/Shopify ID as feed-ready placeholders.",
    true,
  );

  addCheck(
    checks,
    "proof_reviews",
    "proof/reviews placeholder",
    hasAny(text, ["review", "reviews", "rating", "testimonial", "customer", "trusted"]),
    8,
    "Looks for review, rating, testimonial, customer, or trusted proof language.",
    true,
  );

  const earned = checks.reduce((total, check) => total + check.score, 0);
  const possible = checks.reduce((total, check) => total + check.maxScore, 0);
  const score = possible > 0 ? Math.round((earned / possible) * 100) : 0;
  const recommendations = checks
    .map(recommendationForCheck)
    .filter((recommendation): recommendation is string => Boolean(recommendation));

  return {
    checks,
    score,
    status: deriveStatus(score, checks),
    productGapRisk: deriveProductGapRisk(score, checks),
    recommendations: Array.from(new Set(recommendations)),
  };
}

export async function runProductFeedAudit(options: {
  companyId?: string;
  lane?: string;
  handle?: string;
} = {}): Promise<ProductFeedAudit[]> {
  const companyId = options.companyId || DEFAULT_COMPANY_ID;
  const companyContext = await getCompanyContext(companyId);
  const shopifyBase = resolveShopifyBase(companyId, companyContext.brandProfile.productUrlPattern);
  const lanes = await getProductFeedAuditLanes(companyId);
  const laneConfigs = options.lane
    ? lanes.filter((config) => config.lane === options.lane)
    : lanes;

  if (laneConfigs.length === 0) {
    throw new Error(options.lane ? `Unknown product feed audit lane: ${options.lane}` : "No products are available to audit for this company.");
  }

  const results: ProductFeedAudit[] = [];

  for (const config of laneConfigs) {
    const localProduct = await findLocalProductForLane(companyId, config, options.handle);
    const handle = options.handle || localProduct?.handle || config.fallbackHandle;
    let shopify: ShopifyProductJs | null = null;

    if (shopifyBase) {
      try {
        shopify = await fetchShopifyProduct(handle, shopifyBase);
      } catch (error) {
        console.warn(`[ProductFeedAudit] Shopify lookup failed for ${handle}:`, error);
      }
    }

    const evaluated = evaluateProduct(config, localProduct, handle, shopify, shopifyBase);
    const [audit] = await db.insert(productFeedAudits).values({
      companyId,
      lane: config.lane,
      laneLabel: config.label,
      heroProductId: localProduct?.id || null,
      heroProductHandle: handle,
      auditChecks: evaluated.checks,
      score: evaluated.score,
      status: evaluated.status,
      productGapRisk: evaluated.productGapRisk,
      recommendations: evaluated.recommendations,
      shopifySnapshot: buildSnapshot(shopify),
      updatedAt: new Date(),
    }).returning();

    results.push(audit);
  }

  return results;
}

export async function listProductFeedAudits(options: {
  companyId?: string;
  lane?: string;
  limit?: number;
} = {}): Promise<ProductFeedAudit[]> {
  const companyId = options.companyId || DEFAULT_COMPANY_ID;
  const limit = Math.min(Math.max(options.limit || 50, 1), 200);
  const baseQuery = db.select().from(productFeedAudits);

  if (options.lane) {
    return baseQuery
      .where(and(eq(productFeedAudits.companyId, companyId), eq(productFeedAudits.lane, options.lane)))
      .orderBy(desc(productFeedAudits.createdAt))
      .limit(limit);
  }

  return baseQuery.where(eq(productFeedAudits.companyId, companyId)).orderBy(desc(productFeedAudits.createdAt)).limit(limit);
}

export async function getLatestProductFeedAuditsByLane(companyId = DEFAULT_COMPANY_ID): Promise<Record<string, ProductFeedAudit | null>> {
  const latest: Record<string, ProductFeedAudit | null> = {};
  const lanes = await getProductFeedAuditLanes(companyId);

  for (const lane of lanes) {
    const [audit] = await db
      .select()
      .from(productFeedAudits)
      .where(and(eq(productFeedAudits.companyId, companyId), eq(productFeedAudits.lane, lane.lane)))
      .orderBy(desc(productFeedAudits.createdAt))
      .limit(1);
    latest[lane.lane] = audit || null;
  }

  return latest;
}

export async function listProductFeedAuditLanes(companyId = DEFAULT_COMPANY_ID): Promise<LaneConfig[]> {
  return getProductFeedAuditLanes(companyId);
}
