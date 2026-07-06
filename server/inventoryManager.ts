import { randomUUID } from "crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  inventoryBins,
  inventoryCounts,
  products,
  type InventoryBin,
  type InventoryCount,
  type Product,
} from "@shared/schema";
import { db } from "./db";

export const DEFAULT_EMPTY_BIN_WEIGHT_OZ = 56;

export type RoundingMode = "nearest" | "floor" | "ceil";

export interface InventoryBinWithProduct extends InventoryBin {
  product: Product | null;
  lastCount: InventoryCount | null;
}

export interface InventoryCalculationResult {
  bin: InventoryBinWithProduct;
  totalWeightOz: number;
  emptyBinWeightOz: number;
  unitWeightOz: number;
  netWeightOz: number;
  rawQuantity: number;
  quantity: number;
  roundingMode: RoundingMode;
  count: InventoryCount | null;
}

interface CreateInventoryBinInput {
  productId?: string | null;
  productTitle?: string | null;
  sku?: string | null;
  binLabel?: string | null;
  qrCode?: string | null;
  unitWeightOz?: unknown;
  emptyBinWeightOz?: unknown;
  location?: string | null;
  notes?: string | null;
}

interface UpdateInventoryBinInput extends CreateInventoryBinInput {
  status?: string | null;
}

interface CalculateInventoryInput {
  binId?: string | null;
  code?: string | null;
  totalWeightOz?: unknown;
  totalWeightLb?: unknown;
  totalWeight?: unknown;
  weightUnit?: string | null;
  roundingMode?: string | null;
  save?: boolean;
  countedBy?: string | null;
  notes?: string | null;
}

function parsePositiveNumber(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return parsed;
}

function parseNonNegativeNumber(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be zero or greater.`);
  }
  return parsed;
}

function cleanOptionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanRequiredText(value: unknown, label: string): string {
  const cleaned = cleanOptionalText(value);
  if (!cleaned) throw new Error(`${label} is required.`);
  return cleaned;
}

function normalizeRoundingMode(value: unknown): RoundingMode {
  if (value === "floor" || value === "ceil" || value === "nearest") return value;
  return "nearest";
}

function roundQuantity(rawQuantity: number, mode: RoundingMode): number {
  if (mode === "floor") return Math.max(0, Math.floor(rawQuantity));
  if (mode === "ceil") return Math.max(0, Math.ceil(rawQuantity));
  return Math.max(0, Math.round(rawQuantity));
}

function codeSegment(value: string | null | undefined): string {
  const segment = (value || "BIN")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20);
  return segment || "BIN";
}

export function normalizeScannedInventoryCode(raw: unknown): string {
  const scanned = typeof raw === "string" ? raw.trim() : "";
  if (!scanned) return "";

  if (scanned.startsWith("IBOLTINV:")) {
    const payload = scanned.slice("IBOLTINV:".length).trim();
    if (payload.startsWith("{")) {
      try {
        const parsed = JSON.parse(payload) as Record<string, unknown>;
        const code = parsed.qrCode || parsed.code || parsed.bin || parsed.binId;
        if (typeof code === "string" && code.trim()) return code.trim();
      } catch {
        return payload;
      }
    }
    return payload;
  }

  try {
    const url = new URL(scanned);
    for (const key of ["bin", "code", "qr", "inventoryBin", "inventory_bin"]) {
      const value = url.searchParams.get(key);
      if (value?.trim()) return value.trim();
    }
  } catch {
    const queryStart = scanned.indexOf("?");
    if (queryStart >= 0) {
      const params = new URLSearchParams(scanned.slice(queryStart + 1));
      for (const key of ["bin", "code", "qr", "inventoryBin", "inventory_bin"]) {
        const value = params.get(key);
        if (value?.trim()) return value.trim();
      }
    }
  }

  return scanned;
}

async function findProduct(companyId: string, productId: string): Promise<Product> {
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.companyId, companyId), eq(products.id, productId)))
    .limit(1);
  if (!product) throw new Error("Product not found for this company.");
  return product;
}

async function qrCodeExists(companyId: string, qrCode: string, exceptId?: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: inventoryBins.id })
    .from(inventoryBins)
    .where(and(eq(inventoryBins.companyId, companyId), eq(inventoryBins.qrCode, qrCode)))
    .limit(1);
  return Boolean(existing && existing.id !== exceptId);
}

async function generateQrCode(companyId: string, seed: string | null | undefined): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = `IBOLT-${codeSegment(seed)}-${randomUUID().slice(0, 8).toUpperCase()}`;
    if (!(await qrCodeExists(companyId, candidate))) return candidate;
  }
  throw new Error("Could not generate a unique QR code. Try again.");
}

async function hydrateInventoryBins(companyId: string, bins: InventoryBin[]): Promise<InventoryBinWithProduct[]> {
  const productIds = Array.from(new Set(bins.map((bin) => bin.productId).filter((id): id is string => Boolean(id))));
  const productRows = productIds.length
    ? await db.select().from(products).where(and(eq(products.companyId, companyId), inArray(products.id, productIds)))
    : [];
  const productsById = new Map(productRows.map((product) => [product.id, product]));

  const binIds = bins.map((bin) => bin.id);
  const countRows = binIds.length
    ? await db
        .select()
        .from(inventoryCounts)
        .where(and(eq(inventoryCounts.companyId, companyId), inArray(inventoryCounts.binId, binIds)))
        .orderBy(desc(inventoryCounts.createdAt))
        .limit(1000)
    : [];
  const latestCountByBinId = new Map<string, InventoryCount>();
  for (const count of countRows) {
    if (!latestCountByBinId.has(count.binId)) latestCountByBinId.set(count.binId, count);
  }

  return bins.map((bin) => ({
    ...bin,
    product: bin.productId ? productsById.get(bin.productId) || null : null,
    lastCount: latestCountByBinId.get(bin.id) || null,
  }));
}

export async function listInventoryBins(
  companyId: string,
  options: { search?: string; includeArchived?: boolean } = {},
): Promise<InventoryBinWithProduct[]> {
  const rows = await db
    .select()
    .from(inventoryBins)
    .where(eq(inventoryBins.companyId, companyId))
    .orderBy(desc(inventoryBins.updatedAt));

  const search = options.search?.trim().toLowerCase();
  const filtered = rows.filter((bin) => {
    if (!options.includeArchived && bin.status === "archived") return false;
    if (!search) return true;
    return [
      bin.productTitle,
      bin.sku,
      bin.binLabel,
      bin.qrCode,
      bin.location,
    ].some((value) => value?.toLowerCase().includes(search));
  });

  return hydrateInventoryBins(companyId, filtered);
}

export async function getInventoryBin(companyId: string, id: string): Promise<InventoryBinWithProduct> {
  const [bin] = await db
    .select()
    .from(inventoryBins)
    .where(and(eq(inventoryBins.companyId, companyId), eq(inventoryBins.id, id)))
    .limit(1);
  if (!bin) throw new Error("Inventory bin not found.");
  const [hydrated] = await hydrateInventoryBins(companyId, [bin]);
  return hydrated;
}

export async function lookupInventoryBin(companyId: string, rawCode: string): Promise<InventoryBinWithProduct> {
  const code = normalizeScannedInventoryCode(rawCode);
  if (!code) throw new Error("Scan or enter a QR/bin code.");

  const [byQrCode] = await db
    .select()
    .from(inventoryBins)
    .where(and(eq(inventoryBins.companyId, companyId), eq(inventoryBins.qrCode, code)))
    .limit(1);

  const [byId] = byQrCode
    ? [byQrCode]
    : await db
        .select()
        .from(inventoryBins)
        .where(and(eq(inventoryBins.companyId, companyId), eq(inventoryBins.id, code)))
        .limit(1);

  if (byId) {
    const [hydrated] = await hydrateInventoryBins(companyId, [byId]);
    return hydrated;
  }

  const allBins = await db.select().from(inventoryBins).where(eq(inventoryBins.companyId, companyId));
  const bySku = allBins.find((bin) => bin.sku && bin.sku.toLowerCase() === code.toLowerCase());
  if (bySku) {
    const [hydrated] = await hydrateInventoryBins(companyId, [bySku]);
    return hydrated;
  }

  throw new Error(`No inventory bin found for scanned code "${code}".`);
}

export async function createInventoryBin(companyId: string, input: CreateInventoryBinInput): Promise<InventoryBinWithProduct> {
  const product = input.productId ? await findProduct(companyId, input.productId) : null;
  const productTitle = cleanOptionalText(input.productTitle) || product?.title;
  if (!productTitle) throw new Error("Choose a product or enter a product title.");

  const sku = cleanOptionalText(input.sku) || product?.sku || product?.handle || null;
  const unitWeightOz = parsePositiveNumber(input.unitWeightOz, "Individual part weight");
  const emptyBinWeightOz = input.emptyBinWeightOz === undefined || input.emptyBinWeightOz === null || input.emptyBinWeightOz === ""
    ? DEFAULT_EMPTY_BIN_WEIGHT_OZ
    : parseNonNegativeNumber(input.emptyBinWeightOz, "Empty bin weight");
  const binLabel = cleanOptionalText(input.binLabel) || `${sku || productTitle} bin`;
  const qrCode = cleanOptionalText(input.qrCode) || await generateQrCode(companyId, sku || productTitle);

  if (await qrCodeExists(companyId, qrCode)) {
    throw new Error("That QR/bin code already exists.");
  }

  const [created] = await db.insert(inventoryBins).values({
    companyId,
    productId: product?.id || null,
    sku,
    productTitle,
    binLabel,
    qrCode,
    unitWeightOz,
    emptyBinWeightOz,
    location: cleanOptionalText(input.location),
    notes: cleanOptionalText(input.notes),
  }).returning();

  const [hydrated] = await hydrateInventoryBins(companyId, [created]);
  return hydrated;
}

export async function updateInventoryBin(
  companyId: string,
  id: string,
  input: UpdateInventoryBinInput,
): Promise<InventoryBinWithProduct> {
  await getInventoryBin(companyId, id);
  const values: Partial<typeof inventoryBins.$inferInsert> = { updatedAt: new Date() };

  if (Object.prototype.hasOwnProperty.call(input, "productId")) {
    if (input.productId) {
      const product = await findProduct(companyId, input.productId);
      values.productId = product.id;
      if (!input.productTitle) values.productTitle = product.title;
      if (!input.sku) values.sku = product.sku || product.handle || null;
    } else {
      values.productId = null;
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, "productTitle")) {
    values.productTitle = cleanRequiredText(input.productTitle, "Product title");
  }
  if (Object.prototype.hasOwnProperty.call(input, "sku")) values.sku = cleanOptionalText(input.sku);
  if (Object.prototype.hasOwnProperty.call(input, "binLabel")) values.binLabel = cleanRequiredText(input.binLabel, "Bin label");
  if (Object.prototype.hasOwnProperty.call(input, "unitWeightOz")) {
    values.unitWeightOz = parsePositiveNumber(input.unitWeightOz, "Individual part weight");
  }
  if (Object.prototype.hasOwnProperty.call(input, "emptyBinWeightOz")) {
    values.emptyBinWeightOz = parseNonNegativeNumber(input.emptyBinWeightOz, "Empty bin weight");
  }
  if (Object.prototype.hasOwnProperty.call(input, "location")) values.location = cleanOptionalText(input.location);
  if (Object.prototype.hasOwnProperty.call(input, "notes")) values.notes = cleanOptionalText(input.notes);
  if (Object.prototype.hasOwnProperty.call(input, "status")) {
    values.status = input.status === "archived" ? "archived" : "active";
  }
  if (Object.prototype.hasOwnProperty.call(input, "qrCode")) {
    const qrCode = cleanRequiredText(input.qrCode, "QR/bin code");
    if (await qrCodeExists(companyId, qrCode, id)) throw new Error("That QR/bin code already exists.");
    values.qrCode = qrCode;
  }

  const [updated] = await db
    .update(inventoryBins)
    .set(values)
    .where(and(eq(inventoryBins.companyId, companyId), eq(inventoryBins.id, id)))
    .returning();

  const [hydrated] = await hydrateInventoryBins(companyId, [updated]);
  return hydrated;
}

export async function archiveInventoryBin(companyId: string, id: string): Promise<InventoryBinWithProduct> {
  return updateInventoryBin(companyId, id, { status: "archived" });
}

function parseTotalWeightOz(input: CalculateInventoryInput): number {
  if (input.totalWeightOz !== undefined && input.totalWeightOz !== null && input.totalWeightOz !== "") {
    return parsePositiveNumber(input.totalWeightOz, "Total bin weight");
  }
  if (input.totalWeightLb !== undefined && input.totalWeightLb !== null && input.totalWeightLb !== "") {
    return parsePositiveNumber(input.totalWeightLb, "Total bin weight") * 16;
  }
  const totalWeight = parsePositiveNumber(input.totalWeight, "Total bin weight");
  return input.weightUnit === "lb" ? totalWeight * 16 : totalWeight;
}

export async function calculateInventoryCount(
  companyId: string,
  input: CalculateInventoryInput,
): Promise<InventoryCalculationResult> {
  const bin = input.binId
    ? await getInventoryBin(companyId, input.binId)
    : await lookupInventoryBin(companyId, cleanRequiredText(input.code, "QR/bin code"));
  const totalWeightOz = parseTotalWeightOz(input);
  const emptyBinWeightOz = bin.emptyBinWeightOz;
  const unitWeightOz = bin.unitWeightOz;
  const netWeightOz = totalWeightOz - emptyBinWeightOz;
  if (netWeightOz < 0) {
    throw new Error("Total bin weight is lower than the empty bin weight. Check the scale value or tare weight.");
  }

  const rawQuantity = netWeightOz / unitWeightOz;
  const roundingMode = normalizeRoundingMode(input.roundingMode);
  const quantity = roundQuantity(rawQuantity, roundingMode);
  let count: InventoryCount | null = null;

  if (input.save) {
    const [created] = await db.insert(inventoryCounts).values({
      companyId,
      binId: bin.id,
      productId: bin.productId,
      sku: bin.sku,
      productTitle: bin.productTitle,
      totalWeightOz,
      emptyBinWeightOz,
      unitWeightOz,
      netWeightOz,
      rawQuantity,
      quantity,
      roundingMode,
      countedBy: cleanOptionalText(input.countedBy),
      notes: cleanOptionalText(input.notes),
    }).returning();
    count = created;

    await db
      .update(inventoryBins)
      .set({ lastQuantity: quantity, lastCountAt: new Date(), updatedAt: new Date() })
      .where(and(eq(inventoryBins.companyId, companyId), eq(inventoryBins.id, bin.id)));
  }

  return {
    bin: count ? await getInventoryBin(companyId, bin.id) : bin,
    totalWeightOz,
    emptyBinWeightOz,
    unitWeightOz,
    netWeightOz,
    rawQuantity,
    quantity,
    roundingMode,
    count,
  };
}

export async function listInventoryCounts(companyId: string, limit = 50): Promise<InventoryCount[]> {
  const safeLimit = Math.min(Math.max(Math.floor(limit) || 50, 1), 200);
  return db
    .select()
    .from(inventoryCounts)
    .where(eq(inventoryCounts.companyId, companyId))
    .orderBy(desc(inventoryCounts.createdAt))
    .limit(safeLimit);
}
