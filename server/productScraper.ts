// Product Scraper — Fetch and store products from iboltmounts.com Shopify API
// Uses the public /products.json endpoint (no auth needed).

import { db } from "./db";
import { eq } from "drizzle-orm";
import {
  products,
  productVerticals,
  industryVerticals,
  type Product,
  type IndustryVertical,
} from "@shared/schema";
import Anthropic from "@anthropic-ai/sdk";
import { cachedApiCall, shopifyLimiter, anthropicLimiter, TTL } from "./apiCache";

const SHOPIFY_BASE = "https://iboltmounts.com";
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
  variants: Array<{ price: string }>;
}

/**
 * Fetch all products from iboltmounts.com/products.json
 * Paginates through all pages.
 */
async function fetchAllProducts(): Promise<ShopifyProduct[]> {
  const allProducts: ShopifyProduct[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const url = `${SHOPIFY_BASE}/products.json?limit=${PRODUCTS_PER_PAGE}&page=${page}`;
    console.log(`[Scraper] Fetching page ${page}: ${url}`);

    const data = await cachedApiCall<{ products: ShopifyProduct[] }>(
      `shopify:products:page:${page}`,
      async () => {
        const response = await fetch(url, {
          headers: { "User-Agent": "iBoltBlogGenerator/1.0" },
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          throw new Error(`Shopify API returned ${response.status}: ${response.statusText}`);
        }
        return response.json() as Promise<{ products: ShopifyProduct[] }>;
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

/**
 * Scrape products from iboltmounts.com and store in database.
 * Returns count of new and updated products.
 */
export async function scrapeProducts(): Promise<{ total: number; new_: number; updated: number }> {
  const shopifyProducts = await fetchAllProducts();
  console.log(`[Scraper] Fetched ${shopifyProducts.length} products from Shopify`);

  let newCount = 0;
  let updatedCount = 0;

  for (const sp of shopifyProducts) {
    const shopifyId = String(sp.id);
    const existing = await db.select().from(products).where(eq(products.shopifyId, shopifyId)).limit(1);

    const productData = {
      shopifyId,
      title: sp.title,
      handle: sp.handle,
      description: stripHtml(sp.body_html || ""),
      productType: sp.product_type || null,
      vendor: sp.vendor || null,
      tags: sp.tags || [],
      imageUrl: sp.images?.[0]?.src || null,
      price: sp.variants?.[0]?.price || null,
      url: `${SHOPIFY_BASE}/products/${sp.handle}`,
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
export async function mapProductsToVerticals(): Promise<{ mapped: number }> {
  const allProducts = await db.select().from(products);
  const verticals = await db.select().from(industryVerticals);

  if (allProducts.length === 0 || verticals.length === 0) {
    return { mapped: 0 };
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
- A product can map to multiple verticals (e.g., a suction cup mount fits road-trips-travel AND general-mounting)
- Relevance score 0.0-1.0 based on how well the product fits the vertical
- Only include verticals with relevance >= 0.5
- Every product should map to at least "general-mounting" if nothing else fits`,
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
          .where(eq(productVerticals.productId, mapping.productId))
          .limit(100);

        const alreadyMapped = existingMapping.some((pv) => pv.verticalId === vertical.id);
        if (alreadyMapped) continue;

        await db.insert(productVerticals).values({
          productId: mapping.productId,
          verticalId: vertical.id,
          relevanceScore: relevance,
        });
        totalMapped++;
      }
    }
  }

  console.log(`[Scraper] Created ${totalMapped} product-vertical mappings`);
  return { mapped: totalMapped };
}

/**
 * Get all products, optionally filtered by vertical.
 */
export async function getProducts(verticalId?: string): Promise<Product[]> {
  if (verticalId) {
    const pvRows = await db.select().from(productVerticals).where(eq(productVerticals.verticalId, verticalId));
    const productIds = pvRows.map((pv) => pv.productId);
    const allProducts = await db.select().from(products);
    return allProducts.filter((p) => productIds.includes(p.id));
  }
  return db.select().from(products);
}

/**
 * Get product count and last scrape time.
 */
export async function getProductStats(): Promise<{ count: number; lastScraped: Date | null }> {
  const allProducts = await db.select().from(products);
  const lastScraped = allProducts.length > 0
    ? new Date(Math.max(...allProducts.map((p) => new Date(p.scrapedAt).getTime())))
    : null;
  return { count: allProducts.length, lastScraped };
}
