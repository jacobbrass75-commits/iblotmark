// Product Scraper — Fetch and store products from a company's public Shopify API
// Uses the public /products.json endpoint (no auth needed).

import { db } from "./db";
import { and, eq } from "drizzle-orm";
import {
  products,
  productVerticals,
  industryVerticals,
  type Product,
  type IndustryVertical,
} from "@shared/schema";
import Anthropic from "@anthropic-ai/sdk";
import { cachedApiCall, shopifyLimiter, anthropicLimiter, TTL } from "./apiCache";
import { getCompanyContext } from "./companyContext";
import { DEFAULT_COMPANY_ID } from "./companyDefaults";
import { readResponseTextLimited, safeFetch } from "./safeFetch";

const DEFAULT_SHOPIFY_BASE = "https://iboltmounts.com";
const PRODUCTS_PER_PAGE = 250; // Shopify max

interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  body_html: string;
  product_type: string;
  vendor: string;
  tags: string[];
  images: Array<{ src: string }>;
  variants: Array<{ price: string; sku?: string; available?: boolean; title?: string; id?: number }>;
}

type ProductMapping = {
  productId: string;
  verticalSlug: string;
  relevance: number;
};

function originFromUrl(value?: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value.replace("{handle}", "placeholder")).origin;
  } catch {
    return null;
  }
}

function resolvePublicShopifyBase(companyContext: Awaited<ReturnType<typeof getCompanyContext>>): string {
  const configuredBase =
    companyContext.integrations.shopify?.publicStoreUrl ||
    originFromUrl(companyContext.integrations.shopify?.productUrlPattern) ||
    originFromUrl(companyContext.brandProfile.productUrlPattern);

  if (configuredBase) return configuredBase.replace(/\/$/, "");

  if (companyContext.company.id === DEFAULT_COMPANY_ID) {
    return (companyContext.company.websiteUrl || DEFAULT_SHOPIFY_BASE).replace(/\/$/, "");
  }

  if (companyContext.company.ecommercePlatform?.toLowerCase() === "shopify" && companyContext.company.websiteUrl) {
    return companyContext.company.websiteUrl.replace(/\/$/, "");
  }

  throw new Error("Configure a Shopify public store URL or product URL pattern before syncing products.");
}

function termsFromVertical(vertical: IndustryVertical): string[] {
  const source = [
    vertical.name,
    vertical.slug,
    vertical.description,
    ...(Array.isArray(vertical.terminology) ? vertical.terminology : []),
    ...(Array.isArray(vertical.painPoints) ? vertical.painPoints : []),
    ...(Array.isArray(vertical.useCases) ? vertical.useCases : []),
    ...(Array.isArray(vertical.compatibleDevices) ? vertical.compatibleDevices : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return Array.from(new Set(
    source
      .split(/[^a-z0-9]+/i)
      .map((term) => term.trim())
      .filter((term) => term.length >= 4),
  ));
}

function defaultVertical(verticals: IndustryVertical[]): IndustryVertical | undefined {
  return verticals.find((vertical) => /general|other|misc|all/i.test(`${vertical.slug} ${vertical.name}`)) || verticals[0];
}

const DETERMINISTIC_VERTICAL_RULES: Record<string, Array<{ terms: string[]; relevance: number }>> = {
  "fishing-boating": [
    { terms: ["fish", "fishing", "boat", "boating", "marine", "kayak", "rod holder", "depth finder", "chartplotter"], relevance: 0.9 },
  ],
  "forklifts-warehousing": [
    { terms: ["forklift", "warehouse", "barcode", "scanner", "pallet", "wms", "bizmount", "dock'n lock"], relevance: 0.92 },
  ],
  "trucking-fleet": [
    { terms: ["eld", "truck", "fleet", "semi", "commercial vehicle", "dash mount", "windshield", "suction"], relevance: 0.78 },
  ],
  "offroading-jeep": [
    { terms: ["jeep", "offroad", "off-road", "4x4", "atv", "utv", "trail"], relevance: 0.82 },
  ],
  "restaurants-food-delivery": [
    { terms: ["pos", "restaurant", "tablet tower", "toast", "square", "delivery", "doordash", "ubereats", "countertop"], relevance: 0.9 },
  ],
  "education-schools": [
    { terms: ["school", "education", "classroom", "teacher", "desk", "library"], relevance: 0.72 },
  ],
  "content-creation-streaming": [
    { terms: ["tripod", "camera", "stream", "streaming", "video", "creator", "selfie", "microphone"], relevance: 0.82 },
  ],
  "agriculture-farming": [
    { terms: ["tractor", "farm", "farming", "agriculture", "combine", "harvester"], relevance: 0.82 },
  ],
  "kitchen-home": [
    { terms: ["kitchen", "home", "counter", "desk", "wall mount", "cabinet"], relevance: 0.68 },
  ],
  "road-trips-travel": [
    { terms: ["car", "vehicle", "travel", "road trip", "cup holder", "windshield", "dashboard", "suction", "headrest"], relevance: 0.74 },
  ],
  "mountain-biking-cycling": [
    { terms: ["bike", "bicycle", "cycling", "mountain bike", "handlebar", "motorcycle"], relevance: 0.82 },
  ],
};

/**
 * Fetch all products from a public Shopify /products.json endpoint.
 * Paginates through all pages.
 */
async function fetchAllProducts(shopifyBase = DEFAULT_SHOPIFY_BASE): Promise<ShopifyProduct[]> {
  const allProducts: ShopifyProduct[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const url = `${shopifyBase}/products.json?limit=${PRODUCTS_PER_PAGE}&page=${page}`;
    console.log(`[Scraper] Fetching page ${page}: ${url}`);

    const data = await cachedApiCall<{ products: ShopifyProduct[] }>(
      `shopify:products:${shopifyBase}:page:${page}`,
      async () => {
        const response = await safeFetch(url, {
          headers: { "User-Agent": "StandaloneBlogWriter/1.0" },
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          throw new Error(`Shopify API returned ${response.status}: ${response.statusText}`);
        }
        return JSON.parse(await readResponseTextLimited(response, 5_000_000)) as { products: ShopifyProduct[] };
      },
      { ttlMs: TTL.SHOPIFY_PRODUCTS, limiter: shopifyLimiter },
    );

    const pageProducts = data.products || [];

    allProducts.push(...pageProducts);

    if (pageProducts.length < PRODUCTS_PER_PAGE) {
      hasMore = false;
    } else {
      page++;
    }
  }

  return allProducts;
}

/**
 * Strip HTML tags from Shopify product descriptions.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function productSearchText(product: Product): string {
  const tags = Array.isArray(product.tags) ? product.tags.join(" ") : "";
  return [
    product.title,
    product.handle,
    product.description,
    product.productType,
    tags,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function buildDeterministicMappings(
  allProducts: Product[],
  verticals: IndustryVertical[],
): ProductMapping[] {
  const mappings: ProductMapping[] = [];
  const verticalSlugs = new Set(verticals.map((vertical) => vertical.slug));
  const verticalTerms = verticals.map((vertical) => ({
    vertical,
    terms: termsFromVertical(vertical),
  }));
  const fallbackVertical = defaultVertical(verticals);

  for (const product of allProducts) {
    const text = productSearchText(product);
    const productMappings: ProductMapping[] = [];

    for (const [verticalSlug, rules] of Object.entries(DETERMINISTIC_VERTICAL_RULES)) {
      if (!verticalSlugs.has(verticalSlug)) continue;

      const bestRule = rules.find((rule) => rule.terms.some((term) => text.includes(term)));
      if (!bestRule) continue;

      productMappings.push({
        productId: product.id,
        verticalSlug,
        relevance: bestRule.relevance,
      });
    }

    for (const { vertical, terms } of verticalTerms) {
      const matches = terms.filter((term) => text.includes(term)).length;
      if (matches === 0) continue;
      productMappings.push({
        productId: product.id,
        verticalSlug: vertical.slug,
        relevance: Math.min(0.95, 0.55 + matches * 0.05),
      });
    }

    if (fallbackVertical) {
      productMappings.push({
        productId: product.id,
        verticalSlug: fallbackVertical.slug,
        relevance: productMappings.length > 0 ? 0.58 : 0.72,
      });
    }

    mappings.push(...productMappings);
  }

  return mappings;
}

async function insertMappings(
  mappings: ProductMapping[],
  verticals: IndustryVertical[],
  companyId = DEFAULT_COMPANY_ID,
): Promise<number> {
  const verticalBySlug = new Map(verticals.map((vertical) => [vertical.slug, vertical]));
  const existingRows = await db.select().from(productVerticals).where(eq(productVerticals.companyId, companyId));
  const existingKeys = new Set(existingRows.map((row) => `${row.productId}::${row.verticalId}`));
  let mapped = 0;

  for (const mapping of mappings) {
    const vertical = verticalBySlug.get(mapping.verticalSlug);
    if (!vertical) continue;

    const key = `${mapping.productId}::${vertical.id}`;
    if (existingKeys.has(key)) continue;

    await db.insert(productVerticals).values({
      companyId,
      productId: mapping.productId,
      verticalId: vertical.id,
      relevanceScore: mapping.relevance,
    });

    existingKeys.add(key);
    mapped++;
  }

  return mapped;
}

/**
 * Scrape products from the configured company Shopify store and store in database.
 * Returns count of new and updated products.
 */
export async function scrapeProducts(companyId = DEFAULT_COMPANY_ID): Promise<{ total: number; new_: number; updated: number }> {
  const companyContext = await getCompanyContext(companyId);
  const shopifyBase = resolvePublicShopifyBase(companyContext);
  const shopifyProducts = await fetchAllProducts(shopifyBase);
  console.log(`[Scraper] Fetched ${shopifyProducts.length} products from Shopify`);

  let newCount = 0;
  let updatedCount = 0;

  for (const sp of shopifyProducts) {
    const shopifyId = `${companyContext.company.id}:${sp.id}`;
    const existing = await db
      .select()
      .from(products)
      .where(and(eq(products.companyId, companyContext.company.id), eq(products.shopifyId, shopifyId)))
      .limit(1);

    const productData = {
      companyId: companyContext.company.id,
      shopifyId,
      title: sp.title,
      handle: sp.handle,
      description: stripHtml(sp.body_html || ""),
      productType: sp.product_type || null,
      vendor: sp.vendor || null,
      tags: sp.tags || [],
      imageUrl: sp.images?.[0]?.src || null,
      price: sp.variants?.[0]?.price || null,
      sku: sp.variants?.find((variant) => variant.sku)?.sku || null,
      url: companyContext.brandProfile.productUrlPattern
        ? companyContext.brandProfile.productUrlPattern.replace("{handle}", sp.handle)
        : `${shopifyBase}/products/${sp.handle}`,
      variants: sp.variants || [],
      availability: sp.variants?.some((variant) => variant.available) ? "available" : null,
      sourceType: "shopify_public",
      sourceUrl: `${shopifyBase}/products/${sp.handle}`,
      sourceData: { shopifyProduct: sp },
      sourceSyncedAt: new Date(),
      updatedAt: new Date(),
    };

    if (existing.length > 0) {
      await db.update(products).set(productData).where(eq(products.id, existing[0].id));
      updatedCount++;
    } else {
      await db.insert(products).values(productData);
      newCount++;
    }
  }

  console.log(`[Scraper] Stored ${newCount} new, ${updatedCount} updated products`);
  return { total: shopifyProducts.length, new_: newCount, updated: updatedCount };
}

/**
 * Use Claude to map products to industry verticals based on product titles,
 * descriptions, and tags.
 */
export async function mapProductsToVerticals(companyId = DEFAULT_COMPANY_ID): Promise<{ mapped: number }> {
  const allProducts = await db.select().from(products).where(eq(products.companyId, companyId));
  const verticals = await db.select().from(industryVerticals).where(eq(industryVerticals.companyId, companyId));

  if (allProducts.length === 0 || verticals.length === 0) {
    return { mapped: 0 };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    const mapped = await insertMappings(buildDeterministicMappings(allProducts, verticals), verticals, companyId);
    console.log(`[Scraper] Created ${mapped} deterministic product-vertical mappings`);
    return { mapped };
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Process in batches of 30
  let totalMapped = 0;
  const batchSize = 30;

  for (let i = 0; i < allProducts.length; i += batchSize) {
    const batch = allProducts.slice(i, i + batchSize);

    const productList = batch.map((p) =>
      `ID:${p.id} | "${p.title}" | Type: ${p.productType || "N/A"} | Tags: ${(p.tags as string[])?.join(", ") || "none"}`
    ).join("\n");

    const verticalList = verticals.map((v) => `"${v.slug}": ${v.name}`).join("\n");
    const fallbackSlug = defaultVertical(verticals)?.slug || "";

    await anthropicLimiter.acquire();
    const response = await client.messages.create({
      model: process.env.BLOG_ANTHROPIC_MODEL || "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [{
        role: "user",
        content: `Map each product to one or more industry verticals based on its title, type, and tags.

Verticals:
${verticalList}

Products:
${productList}

Return JSON array:
[
  { "productId": "...", "verticals": ["slug1", "slug2"], "relevance": [0.9, 0.7] }
]

Rules:
- A product can map to multiple verticals when it clearly fits more than one customer use case
- Relevance score 0.0-1.0 based on how well the product fits the vertical
- Only include verticals with relevance >= 0.5
- Every product should map to at least "${fallbackSlug}" if nothing else fits`,
      }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) continue;

    const mappings = JSON.parse(jsonMatch[0]) as Array<{
      productId: string;
      verticals: string[];
      relevance: number[];
    }>;

    for (const mapping of mappings) {
      for (let j = 0; j < mapping.verticals.length; j++) {
        const verticalSlug = mapping.verticals[j];
        const relevance = mapping.relevance[j] || 0.5;
        const vertical = verticals.find((v) => v.slug === verticalSlug);
        if (!vertical) continue;

        // Check if mapping already exists
        const existingMapping = await db.select().from(productVerticals)
          .where(and(eq(productVerticals.companyId, companyId), eq(productVerticals.productId, mapping.productId)))
          .limit(100);

        const alreadyMapped = existingMapping.some((pv) => pv.verticalId === vertical.id);
        if (alreadyMapped) continue;

        await db.insert(productVerticals).values({
          companyId,
          productId: mapping.productId,
          verticalId: vertical.id,
          relevanceScore: relevance,
        });
        totalMapped++;
      }
    }
  }

  console.log(`[Scraper] Created ${totalMapped} product-vertical mappings`);
  if (totalMapped === 0) {
    const deterministicMapped = await insertMappings(buildDeterministicMappings(allProducts, verticals), verticals, companyId);
    console.log(`[Scraper] AI mapping produced no new rows; created ${deterministicMapped} deterministic mappings`);
    return { mapped: deterministicMapped };
  }

  return { mapped: totalMapped };
}

/**
 * Get all products, optionally filtered by vertical.
 */
export async function getProducts(verticalId?: string, companyId = DEFAULT_COMPANY_ID): Promise<Product[]> {
  if (verticalId) {
    const pvRows = await db
      .select()
      .from(productVerticals)
      .where(and(eq(productVerticals.companyId, companyId), eq(productVerticals.verticalId, verticalId)));
    const productIds = pvRows.map((pv) => pv.productId);
    const allProducts = await db.select().from(products).where(eq(products.companyId, companyId));
    return allProducts.filter((p) => productIds.includes(p.id));
  }
  return db.select().from(products).where(eq(products.companyId, companyId));
}

/**
 * Get product count and last scrape time.
 */
export async function getProductStats(companyId = DEFAULT_COMPANY_ID): Promise<{ count: number; lastScraped: Date | null }> {
  const allProducts = await db.select().from(products).where(eq(products.companyId, companyId));
  const lastScraped = allProducts.length > 0
    ? new Date(Math.max(...allProducts.map((p) => new Date(p.sourceSyncedAt || p.scrapedAt).getTime())))
    : null;
  return { count: allProducts.length, lastScraped };
}
