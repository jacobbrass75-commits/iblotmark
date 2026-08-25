// Product Scraper — Fetch and store products from a company's public Shopify API
// Uses the public /products.json endpoint (no auth needed).

import { db } from "./db";
import { and, eq } from "drizzle-orm";
import {
  companyIntegrations,
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
import { decryptSecret } from "./integrationSecrets";

const DEFAULT_SHOPIFY_BASE = "https://iboltmounts.com";
const PRODUCTS_PER_PAGE = 250; // Shopify max

interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  body_html?: string;
  product_type?: string;
  vendor?: string;
  tags?: string[] | string;
  images?: Array<{ src?: string }>;
  variants?: ShopifyVariant[];
}

interface ShopifyVariant {
  id?: number;
  title?: string;
  sku?: string;
  price?: string;
  available?: boolean;
  inventory_item_id?: number;
  inventory_quantity?: number;
  inventory_management?: string | null;
}

interface ShopifyInventoryLevel {
  inventory_item_id: number;
  location_id: number;
  available: number | null;
  updated_at?: string;
}

type ProductMapping = {
  productId: string;
  verticalSlug: string;
  relevance: number;
};

export interface ProductSyncResult {
  total: number;
  new_: number;
  updated: number;
  source: "shopify_admin" | "shopify_public";
  inventorySynced: boolean;
  inventoryTrackedItems: number;
  inventoryLevels: number;
  inventoryError?: string;
}

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

function normalizeShop(value?: string | null): string | null {
  if (!value) return null;
  const host = value.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  if (!host) return null;
  const shop = host.replace(/\.myshopify\.com$/i, "");
  return /^[a-z0-9][a-z0-9-]*$/.test(shop) ? shop : null;
}

function configuredShop(companyContext: Awaited<ReturnType<typeof getCompanyContext>>): string | null {
  return normalizeShop(companyContext.integrations.shopify?.shop)
    || normalizeShop(process.env.SHOPIFY_SHOP)
    || (companyContext.company.id === DEFAULT_COMPANY_ID ? normalizeShop(DEFAULT_SHOPIFY_BASE) : null);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function getStoredShopifyAccessToken(
  companyContext: Awaited<ReturnType<typeof getCompanyContext>>,
): Promise<string> {
  const integrationId = companyContext.integrations.shopify?.id;
  if (!integrationId) return "";

  const [integration] = await db
    .select({ config: companyIntegrations.config })
    .from(companyIntegrations)
    .where(and(
      eq(companyIntegrations.companyId, companyContext.company.id),
      eq(companyIntegrations.id, integrationId),
      eq(companyIntegrations.type, "shopify"),
    ))
    .limit(1);

  const encryptedAccessToken = asRecord(integration?.config).encryptedAccessToken;
  if (typeof encryptedAccessToken !== "string" || !encryptedAccessToken) return "";
  return decryptSecret(encryptedAccessToken);
}

async function getReadOnlyShopifyAdminAuth(
  companyContext: Awaited<ReturnType<typeof getCompanyContext>>,
): Promise<{ shop: string; token: string }> {
  const shop = configuredShop(companyContext);
  if (!shop) {
    throw new Error("Shopify shop is not configured for this company.");
  }

  const storedToken = await getStoredShopifyAccessToken(companyContext);
  if (storedToken) return { shop, token: storedToken };

  const envToken = process.env.SHOPIFY_ACCESS_TOKEN?.trim();
  const envShop = normalizeShop(process.env.SHOPIFY_SHOP);
  if (envToken && (!envShop || envShop === shop)) {
    return { shop, token: envToken };
  }

  throw new Error("Shopify Admin API access token is not configured. Add a read-only token with read_products and read_inventory scopes.");
}

function parseNextPageInfo(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const next = linkHeader
    .split(",")
    .map((part) => part.trim())
    .find((part) => /rel="?next"?/i.test(part));
  const match = next?.match(/<([^>]+)>/);
  if (!match?.[1]) return null;
  try {
    return new URL(match[1]).searchParams.get("page_info");
  } catch {
    return null;
  }
}

async function shopifyAdminGet<T>(
  shop: string,
  token: string,
  endpoint: string,
): Promise<{ data: T; response: Response }> {
  await shopifyLimiter.acquire();
  const response = await safeFetch(`https://${shop}.myshopify.com/admin/api/${process.env.SHOPIFY_API_VERSION || "2026-04"}/${endpoint}`, {
    headers: {
      Accept: "application/json",
      "X-Shopify-Access-Token": token,
    },
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    const body = await readResponseTextLimited(response, 2000).catch(() => "");
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Shopify Admin API denied ${endpoint}. Confirm the token has read_products and read_inventory access. (${response.status})`);
    }
    throw new Error(`Shopify Admin API ${endpoint} failed with status ${response.status}: ${body || response.statusText}`);
  }

  return {
    data: JSON.parse(await readResponseTextLimited(response, 5_000_000)) as T,
    response,
  };
}

async function fetchAdminProducts(
  shop: string,
  token: string,
): Promise<ShopifyProduct[]> {
  const allProducts: ShopifyProduct[] = [];
  let pageInfo: string | null = null;

  do {
    const params = new URLSearchParams({
      limit: String(PRODUCTS_PER_PAGE),
      fields: "id,title,handle,body_html,product_type,vendor,tags,images,variants",
    });
    if (pageInfo) params.set("page_info", pageInfo);

    const { data, response } = await shopifyAdminGet<{ products: ShopifyProduct[] }>(
      shop,
      token,
      `products.json?${params.toString()}`,
    );
    allProducts.push(...(data.products || []));
    pageInfo = parseNextPageInfo(response.headers.get("link"));
  } while (pageInfo);

  return allProducts;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function fetchInventoryLevels(
  shop: string,
  token: string,
  inventoryItemIds: number[],
): Promise<Map<number, ShopifyInventoryLevel[]>> {
  const levelsByItemId = new Map<number, ShopifyInventoryLevel[]>();
  const uniqueIds = Array.from(new Set(inventoryItemIds.filter((id) => Number.isFinite(id) && id > 0)));

  for (const ids of chunk(uniqueIds, 50)) {
    const params = new URLSearchParams({ inventory_item_ids: ids.join(",") });
    const { data } = await shopifyAdminGet<{ inventory_levels: ShopifyInventoryLevel[] }>(
      shop,
      token,
      `inventory_levels.json?${params.toString()}`,
    );
    for (const level of data.inventory_levels || []) {
      const list = levelsByItemId.get(level.inventory_item_id) || [];
      list.push(level);
      levelsByItemId.set(level.inventory_item_id, list);
    }
  }

  return levelsByItemId;
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

function normalizeTags(tags: ShopifyProduct["tags"]): string[] {
  if (Array.isArray(tags)) return tags.map((tag) => String(tag).trim()).filter(Boolean);
  if (typeof tags === "string") {
    return tags.split(",").map((tag) => tag.trim()).filter(Boolean);
  }
  return [];
}

function variantInventoryAvailable(
  variant: ShopifyVariant,
  levels: ShopifyInventoryLevel[],
): number | null {
  if (levels.length > 0) {
    const quantities = levels
      .map((level) => level.available)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    return quantities.length > 0 ? quantities.reduce((sum, value) => sum + value, 0) : null;
  }

  return typeof variant.inventory_quantity === "number" && Number.isFinite(variant.inventory_quantity)
    ? variant.inventory_quantity
    : null;
}

function enrichVariantsWithInventory(
  variants: ShopifyVariant[],
  levelsByItemId: Map<number, ShopifyInventoryLevel[]>,
): Array<Record<string, unknown>> {
  return variants.map((variant) => {
    const inventoryItemId = variant.inventory_item_id;
    const levels = inventoryItemId ? levelsByItemId.get(inventoryItemId) || [] : [];
    return {
      ...variant,
      inventoryAvailable: variantInventoryAvailable(variant, levels),
      inventoryLevels: levels.map((level) => ({
        inventoryItemId: level.inventory_item_id,
        locationId: level.location_id,
        available: level.available,
        updatedAt: level.updated_at || null,
      })),
    };
  });
}

function summarizeShopifyInventory(
  variants: ShopifyVariant[],
  levelsByItemId: Map<number, ShopifyInventoryLevel[]>,
  syncedAt: Date,
): Record<string, unknown> {
  let totalAvailable = 0;
  let hasQuantity = false;
  const byLocation = new Map<number, { locationId: number; available: number | null; updatedAt: string | null }>();
  const inventoryItemIds = new Set<number>();

  for (const variant of variants) {
    const inventoryItemId = variant.inventory_item_id;
    const levels = inventoryItemId ? levelsByItemId.get(inventoryItemId) || [] : [];
    if (inventoryItemId) inventoryItemIds.add(inventoryItemId);

    const variantAvailable = variantInventoryAvailable(variant, levels);
    if (typeof variantAvailable === "number") {
      totalAvailable += variantAvailable;
      hasQuantity = true;
    }

    for (const level of levels) {
      const existing = byLocation.get(level.location_id);
      const nextAvailable = typeof level.available === "number"
        ? (existing?.available || 0) + level.available
        : existing?.available ?? null;
      byLocation.set(level.location_id, {
        locationId: level.location_id,
        available: nextAvailable,
        updatedAt: level.updated_at || existing?.updatedAt || null,
      });
    }
  }

  return {
    totalAvailable: hasQuantity ? totalAvailable : null,
    tracked: hasQuantity,
    variantCount: variants.length,
    inventoryItemCount: inventoryItemIds.size,
    locationCount: byLocation.size,
    syncedAt: syncedAt.toISOString(),
    byLocation: Array.from(byLocation.values()).sort((left, right) => left.locationId - right.locationId),
  };
}

async function storeShopifyProducts(
  companyContext: Awaited<ReturnType<typeof getCompanyContext>>,
  shopifyProducts: ShopifyProduct[],
  options: {
    source: "shopify_admin" | "shopify_public";
    shopifyBase: string;
    levelsByItemId?: Map<number, ShopifyInventoryLevel[]>;
    inventoryError?: string;
  },
): Promise<ProductSyncResult> {
  console.log(`[Scraper] Fetched ${shopifyProducts.length} products from Shopify (${options.source})`);

  let newCount = 0;
  let updatedCount = 0;
  const now = new Date();
  let inventoryLevels = 0;
  const inventoryItemIds = new Set<number>();

  for (const sp of shopifyProducts) {
    const shopifyId = `${companyContext.company.id}:${sp.id}`;
    const existing = await db
      .select()
      .from(products)
      .where(and(eq(products.companyId, companyContext.company.id), eq(products.shopifyId, shopifyId)))
      .limit(1);

    const variants = sp.variants || [];
    for (const variant of variants) {
      if (variant.inventory_item_id) inventoryItemIds.add(variant.inventory_item_id);
    }

    const levelsByItemId = options.levelsByItemId || new Map<number, ShopifyInventoryLevel[]>();
    const enrichedVariants = enrichVariantsWithInventory(variants, levelsByItemId);
    const shopifyInventory = options.source === "shopify_admin"
      ? summarizeShopifyInventory(variants, levelsByItemId, now)
      : null;
    inventoryLevels += enrichedVariants.reduce((sum, variant) => {
      const levels = Array.isArray(variant.inventoryLevels) ? variant.inventoryLevels.length : 0;
      return sum + levels;
    }, 0);

    const totalAvailable = typeof shopifyInventory?.totalAvailable === "number"
      ? shopifyInventory.totalAvailable
      : null;

    const productData = {
      companyId: companyContext.company.id,
      shopifyId,
      title: sp.title,
      handle: sp.handle,
      description: stripHtml(sp.body_html || ""),
      productType: sp.product_type || null,
      vendor: sp.vendor || null,
      tags: normalizeTags(sp.tags),
      imageUrl: sp.images?.find((image) => image.src)?.src || null,
      price: variants.find((variant) => variant.price)?.price || null,
      sku: variants.find((variant) => variant.sku)?.sku || null,
      url: companyContext.brandProfile.productUrlPattern
        ? companyContext.brandProfile.productUrlPattern.replace("{handle}", sp.handle)
        : `${options.shopifyBase}/products/${sp.handle}`,
      variants: enrichedVariants,
      availability: totalAvailable === null
        ? variants.some((variant) => variant.available) ? "available" : null
        : totalAvailable > 0 ? "available" : "out_of_stock",
      sourceType: options.source,
      sourceUrl: `${options.shopifyBase}/products/${sp.handle}`,
      sourceData: {
        shopifyProduct: sp,
        ...(shopifyInventory ? { shopifyInventory } : {}),
        ...(options.inventoryError ? { shopifyInventoryError: options.inventoryError } : {}),
      },
      sourceSyncedAt: now,
      scrapedAt: now,
      updatedAt: now,
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
  return {
    total: shopifyProducts.length,
    new_: newCount,
    updated: updatedCount,
    source: options.source,
    inventorySynced: options.source === "shopify_admin" && !options.inventoryError,
    inventoryTrackedItems: inventoryItemIds.size,
    inventoryLevels,
    ...(options.inventoryError ? { inventoryError: options.inventoryError } : {}),
  };
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
export async function scrapeProducts(companyId = DEFAULT_COMPANY_ID): Promise<ProductSyncResult> {
  const companyContext = await getCompanyContext(companyId);
  const shopifyBase = resolvePublicShopifyBase(companyContext);

  try {
    return await syncShopifyInventory(companyContext.company.id);
  } catch (error) {
    const inventoryError = error instanceof Error ? error.message : "Shopify Admin inventory sync failed.";
    console.warn(`[Scraper] Shopify Admin sync unavailable; falling back to public catalog: ${inventoryError}`);
    const shopifyProducts = await fetchAllProducts(shopifyBase);
    return storeShopifyProducts(companyContext, shopifyProducts, {
      source: "shopify_public",
      shopifyBase,
      inventoryError,
    });
  }
}

export async function syncShopifyInventory(companyId = DEFAULT_COMPANY_ID): Promise<ProductSyncResult> {
  const companyContext = await getCompanyContext(companyId);
  const shopifyBase = resolvePublicShopifyBase(companyContext);
  const { shop, token } = await getReadOnlyShopifyAdminAuth(companyContext);
  const shopifyProducts = await fetchAdminProducts(shop, token);
  const inventoryItemIds = shopifyProducts.flatMap((product) =>
    (product.variants || [])
      .map((variant) => variant.inventory_item_id)
      .filter((id): id is number => typeof id === "number" && Number.isFinite(id)),
  );

  let levelsByItemId = new Map<number, ShopifyInventoryLevel[]>();
  let inventoryError: string | undefined;
  try {
    levelsByItemId = await fetchInventoryLevels(shop, token, inventoryItemIds);
  } catch (error) {
    inventoryError = error instanceof Error ? error.message : "Shopify inventory levels could not be fetched.";
    console.warn(`[Scraper] Shopify inventory levels unavailable: ${inventoryError}`);
  }

  return storeShopifyProducts(companyContext, shopifyProducts, {
    source: "shopify_admin",
    shopifyBase,
    levelsByItemId,
    inventoryError,
  });
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
      model: "claude-sonnet-4-20250514",
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
    ? new Date(Math.max(...allProducts.map((p) => new Date(p.scrapedAt).getTime())))
    : null;
  return { count: allProducts.length, lastScraped };
}
