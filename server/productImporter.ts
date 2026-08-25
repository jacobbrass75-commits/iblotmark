import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { products, type Product } from "@shared/schema";
import { DEFAULT_COMPANY_ID } from "./companyDefaults";
import { getCompanyContext } from "./companyContext";
import { readResponseTextLimited, safeFetch } from "./safeFetch";

type ProductSourceType = "manual" | "csv" | "product_url" | "shopify_public" | "shopify_admin" | "catalog_pdf" | "inventory_weight_sheet";

export interface ProductInput {
  title: string;
  handle?: string | null;
  description?: string | null;
  productType?: string | null;
  vendor?: string | null;
  sku?: string | null;
  tags?: string[];
  imageUrl?: string | null;
  price?: string | null;
  url?: string | null;
  specs?: Record<string, unknown> | null;
  compatibility?: string[];
  claims?: string[];
  disclaimers?: string[];
  variants?: Array<Record<string, unknown>>;
  availability?: string | null;
  sourceType?: ProductSourceType;
  sourceUrl?: string | null;
  sourceData?: Record<string, unknown> | null;
}

export interface ProductImportResult {
  total: number;
  new_: number;
  updated: number;
  skipped: number;
  errors: string[];
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 180) || "product";
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(value: string): string {
  return decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
}

function normalizeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function splitList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value !== "string") return [];
  return value.split(/[|;,]+/).map((item) => item.trim()).filter(Boolean);
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function parseCSV(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(current.trim());
      current = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i++;
      row.push(current.trim());
      current = "";
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      continue;
    }
    current += char;
  }

  row.push(current.trim());
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  if (rows.length < 2) return [];

  const headers = rows[0].map((header) => header.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
  return rows.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = cells[index]?.trim() || "";
    });
    return record;
  });
}

function pick(row: Record<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    if (row[key]?.trim()) return row[key].trim();
  }
  return null;
}

function csvRowToProduct(row: Record<string, string>): ProductInput | null {
  const title = pick(row, ["title", "name", "product_title", "product_name"]);
  if (!title) return null;

  const url = normalizeUrl(pick(row, ["url", "product_url", "canonical_url", "link"]));
  return {
    title,
    handle: pick(row, ["handle", "slug"]),
    description: pick(row, ["description", "body", "body_html", "summary"]),
    productType: pick(row, ["product_type", "type", "category", "collection"]),
    vendor: pick(row, ["vendor", "brand", "manufacturer"]),
    sku: pick(row, ["sku", "mpn", "model", "model_number"]),
    tags: splitList(pick(row, ["tags", "tag_list", "keywords"])),
    imageUrl: normalizeUrl(pick(row, ["image_url", "image", "featured_image", "photo_url"])),
    price: pick(row, ["price", "amount", "variant_price"]),
    url,
    specs: parseJsonObject(pick(row, ["specs", "specifications", "attributes"])),
    compatibility: splitList(pick(row, ["compatibility", "compatible_devices", "fits"])),
    claims: splitList(pick(row, ["claims", "key_claims"])),
    disclaimers: splitList(pick(row, ["disclaimers", "restrictions", "warnings"])),
    availability: pick(row, ["availability", "inventory", "status"]),
    sourceType: "csv",
    sourceUrl: url,
    sourceData: { importedColumns: row },
  };
}

async function findExistingProduct(companyId: string, input: ProductInput): Promise<Product | undefined> {
  if (input.sourceUrl) {
    const [bySource] = await db
      .select()
      .from(products)
      .where(and(eq(products.companyId, companyId), eq(products.sourceUrl, input.sourceUrl)))
      .limit(1);
    if (bySource) return bySource;
  }

  if (input.url) {
    const [byUrl] = await db
      .select()
      .from(products)
      .where(and(eq(products.companyId, companyId), eq(products.url, input.url)))
      .limit(1);
    if (byUrl) return byUrl;
  }

  const handle = input.handle || slugify(input.title);
  const [byHandle] = await db
    .select()
    .from(products)
    .where(and(eq(products.companyId, companyId), eq(products.handle, handle)))
    .limit(1);
  return byHandle;
}

export async function upsertProduct(companyId: string, input: ProductInput): Promise<{ product: Product; created: boolean }> {
  const title = input.title.trim();
  if (!title) throw new Error("Product title is required.");
  const handle = input.handle?.trim() || slugify(title);
  const now = new Date();
  const existing = await findExistingProduct(companyId, { ...input, title, handle });
  const values = {
    companyId,
    title,
    handle,
    description: input.description || null,
    productType: input.productType || null,
    vendor: input.vendor || null,
    sku: input.sku || null,
    tags: input.tags || [],
    imageUrl: input.imageUrl || null,
    price: input.price || null,
    url: input.url || null,
    specs: input.specs || null,
    compatibility: input.compatibility || [],
    claims: input.claims || [],
    disclaimers: input.disclaimers || [],
    variants: input.variants || [],
    availability: input.availability || null,
    sourceType: input.sourceType || "manual",
    sourceUrl: input.sourceUrl || input.url || null,
    sourceData: input.sourceData || null,
    sourceSyncedAt: now,
    updatedAt: now,
  };

  if (existing) {
    const [product] = await db
      .update(products)
      .set(values)
      .where(and(eq(products.companyId, companyId), eq(products.id, existing.id)))
      .returning();
    return { product, created: false };
  }

  const [product] = await db.insert(products).values(values).returning();
  return { product, created: true };
}

export async function importProductsFromCSV(
  csvText: string,
  _filename: string,
  companyId = DEFAULT_COMPANY_ID,
): Promise<ProductImportResult> {
  const rows = parseCSV(csvText);
  const result: ProductImportResult = { total: rows.length, new_: 0, updated: 0, skipped: 0, errors: [] };

  for (let index = 0; index < rows.length; index++) {
    const input = csvRowToProduct(rows[index]);
    if (!input) {
      result.skipped++;
      result.errors.push(`Row ${index + 2}: missing title/name`);
      continue;
    }
    try {
      const { created } = await upsertProduct(companyId, input);
      if (created) result.new_++;
      else result.updated++;
    } catch (error) {
      result.skipped++;
      result.errors.push(`Row ${index + 2}: ${error instanceof Error ? error.message : "import failed"}`);
    }
  }

  return result;
}

function extractMeta(html: string, names: string[]): string | null {
  for (const name of names) {
    const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i");
    const reversePattern = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["'][^>]*>`, "i");
    const match = html.match(pattern) || html.match(reversePattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return null;
}

function extractJsonLdProducts(html: string): Record<string, unknown>[] {
  const matches = Array.from(html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi));
  const productsFound: Record<string, unknown>[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const item = value as Record<string, unknown>;
    const type = item["@type"];
    const types = Array.isArray(type) ? type : [type];
    if (types.some((candidate) => typeof candidate === "string" && candidate.toLowerCase() === "product")) {
      productsFound.push(item);
    }
    if (Array.isArray(item["@graph"])) item["@graph"].forEach(visit);
  };

  for (const match of matches) {
    try {
      visit(JSON.parse(match[1]));
    } catch {
      // Ignore invalid JSON-LD blocks.
    }
  }
  return productsFound;
}

function jsonLdOfferValue(product: Record<string, unknown>, key: string): string | null {
  const offer = product.offers;
  const offers = Array.isArray(offer) ? offer : offer ? [offer] : [];
  for (const item of offers) {
    if (item && typeof item === "object") {
      const value = (item as Record<string, unknown>)[key];
      const picked = firstString(value);
      if (picked) return picked;
    }
  }
  return null;
}

export async function importProductFromUrl(
  sourceUrl: string,
  companyId = DEFAULT_COMPANY_ID,
): Promise<{ product: Product; created: boolean }> {
  const normalizedUrl = normalizeUrl(sourceUrl);
  if (!normalizedUrl) throw new Error("A valid product URL is required.");

  const response = await safeFetch(normalizedUrl, {
    headers: { "User-Agent": "StandaloneBlogWriter/1.0 product-import" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Product URL returned ${response.status}`);
  const html = await readResponseTextLimited(response, 2_000_000);
  const jsonLdProduct = extractJsonLdProducts(html)[0] || {};
  const companyContext = await getCompanyContext(companyId);
  const parsedUrl = new URL(normalizedUrl);

  const title = firstString(
    jsonLdProduct.name,
    extractMeta(html, ["og:title", "twitter:title"]),
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1],
  );
  if (!title) throw new Error("Could not identify a product title on that URL.");

  const rawDescription = firstString(jsonLdProduct.description, extractMeta(html, ["description", "og:description", "twitter:description"]));
  const imageValue = Array.isArray(jsonLdProduct.image) ? jsonLdProduct.image[0] : jsonLdProduct.image;
  const imageUrl = normalizeUrl(firstString(imageValue, extractMeta(html, ["og:image", "twitter:image"])));
  const price = firstString(jsonLdOfferValue(jsonLdProduct, "price"), extractMeta(html, ["product:price:amount"]));
  const availability = firstString(jsonLdOfferValue(jsonLdProduct, "availability"));
  const sku = firstString(jsonLdProduct.sku, jsonLdProduct.mpn);
  const brand = jsonLdProduct.brand && typeof jsonLdProduct.brand === "object"
    ? firstString((jsonLdProduct.brand as Record<string, unknown>).name)
    : firstString(jsonLdProduct.brand, companyContext.brandProfile.displayName);

  return upsertProduct(companyId, {
    title: stripHtml(title),
    handle: slugify(parsedUrl.pathname.split("/").filter(Boolean).pop() || title),
    description: rawDescription ? stripHtml(rawDescription) : null,
    productType: firstString(jsonLdProduct.category),
    vendor: brand,
    sku,
    tags: [],
    imageUrl,
    price,
    url: normalizedUrl,
    availability,
    sourceType: "product_url",
    sourceUrl: normalizedUrl,
    sourceData: {
      importedFrom: normalizedUrl,
      jsonLdProduct,
    },
  });
}
