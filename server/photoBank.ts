// Photo Bank — Upload, store, and AI-analyze product photos
// Uses sharp for thumbnails, gpt-4o for vision analysis.

import { db } from "./db";
import { and, eq, isNull, or } from "drizzle-orm";
import {
  industryVerticals,
  productPhotos,
  products,
  type ProductPhoto,
} from "@shared/schema";
import sharp from "sharp";
import { existsSync, mkdirSync, readdirSync, realpathSync, statSync } from "fs";
import { extname, join, relative, resolve, sep } from "path";
import { createHash, randomUUID } from "crypto";
import OpenAI from "openai";
import { readFile } from "fs/promises";
import { cachedApiCall, openaiLimiter, TTL } from "./apiCache";
import { getCompanyContext } from "./companyContext";
import { DEFAULT_COMPANY_ID } from "./companyDefaults";
import { parseBrollLabel, type BrollLabel } from "./brollLabelContract";

const PHOTO_DIR = "./uploads/product-photos";
const THUMB_DIR = "./uploads/product-photos/thumbs";
const ASSET_STATUSES = new Set(["needs_review", "approved", "archived"]);
const RIGHTS_STATUSES = new Set(["unknown", "owned", "licensed", "restricted"]);
const PHOTO_SOURCE_TYPES = new Set(["upload", "directory", "shopify", "url", "manual"]);

// Ensure directories exist
if (!existsSync(PHOTO_DIR)) mkdirSync(PHOTO_DIR, { recursive: true });
if (!existsSync(THUMB_DIR)) mkdirSync(THUMB_DIR, { recursive: true });

function getOpenAI(): OpenAI {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// --- Upload ---

export interface PhotoUploadResult {
  photoId: string;
  filename: string;
  productId: string | null;
}

export interface PhotoMetadataUpdate {
  productId?: string | null;
  assetStatus?: "needs_review" | "approved" | "archived";
  rightsStatus?: "unknown" | "owned" | "licensed" | "restricted";
  usageRestrictions?: string | null;
  useCases?: string[] | string | null;
  altText?: string | null;
  caption?: string | null;
  notes?: string | null;
  sourceType?: "upload" | "directory" | "shopify" | "url" | "manual";
  sourceUrl?: string | null;
  angleType?: string | null;
  contextType?: string | null;
  settingDescription?: string | null;
  qualityScore?: number | null;
  isHero?: boolean;
  verticalRelevance?: string[] | string | null;
}

function normalizeStringArray(value: string[] | string | null | undefined): string[] | null {
  if (value === undefined) return null;
  if (value === null) return null;
  const raw = Array.isArray(value) ? value : value.split(",");
  const normalized = raw.map((item) => item.trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : null;
}

function assertKnownValue(value: string | undefined, allowed: Set<string>, fieldName: string): void {
  if (value !== undefined && !allowed.has(value)) {
    throw new Error(`${fieldName} must be one of: ${Array.from(allowed).join(", ")}`);
  }
}

function normalizeQualityScore(value: number | null | undefined): number | null | undefined {
  if (value === undefined || value === null) return value;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) {
    throw new Error("qualityScore must be a number from 0 to 1");
  }
  return numeric;
}

async function assertProductBelongsToCompany(productId: string, companyId: string): Promise<void> {
  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.companyId, companyId), eq(products.id, productId)))
    .limit(1);
  if (!product) throw new Error("Product not found for this company");
}

/**
 * Store a photo file and create a DB record.
 */
export async function storePhoto(
  fileBuffer: Buffer,
  originalFilename: string,
  mimeType: string,
  productId?: string,
  companyId = DEFAULT_COMPANY_ID,
  options: { sourceType?: string; sourceUrl?: string; preserveOriginalBytes?: boolean } = {},
): Promise<PhotoUploadResult> {
  const normalizedProductId = productId?.trim() || null;
  if (normalizedProductId) {
    await assertProductBelongsToCompany(normalizedProductId, companyId);
  }
  if (options.sourceType) {
    assertKnownValue(options.sourceType, PHOTO_SOURCE_TYPES, "sourceType");
  }

  const ext = extname(originalFilename).toLowerCase() || ".jpg";
  const uuid = randomUUID();
  const filename = `${uuid}${ext}`;
  const filePath = join(PHOTO_DIR, filename);
  const thumbFilename = `${uuid}_thumb.jpg`;
  const thumbPath = join(THUMB_DIR, thumbFilename);

  // Process with sharp — normalize and create thumbnail
  let imgBuffer = fileBuffer;
  let metadata: sharp.Metadata;

  try {
    const img = sharp(fileBuffer);
    metadata = await img.metadata();

    if (options.preserveOriginalBytes) {
      const fs = await import("fs/promises");
      await fs.writeFile(filePath, fileBuffer);
    } else {
      // Save original with normalized orientation for ordinary uploads.
      imgBuffer = await img.rotate().toBuffer();
      await sharp(imgBuffer).toFile(filePath);
    }

    // Create thumbnail (300px wide)
    await sharp(options.preserveOriginalBytes ? fileBuffer : imgBuffer)
      .rotate()
      .resize(300)
      .jpeg({ quality: 80 })
      .toFile(thumbPath);
  } catch {
    // If sharp fails (e.g., HEIC without support), just copy raw
    const fs = await import("fs/promises");
    await fs.writeFile(filePath, fileBuffer);
    metadata = { width: 0, height: 0 } as any;
  }

  const [photo] = await db.insert(productPhotos).values({
    companyId,
    productId: normalizedProductId,
    filename,
    originalFilename,
    mimeType,
    fileSize: fileBuffer.length,
    filePath,
    thumbnailPath: thumbPath,
    width: metadata?.width || null,
    height: metadata?.height || null,
    sourceType: options.sourceType || "upload",
    sourceUrl: options.sourceUrl || null,
  }).returning();

  // Update product photo count
  if (normalizedProductId) {
    await updateProductPhotoCount(normalizedProductId, companyId);
  }

  return { photoId: photo.id, filename, productId: normalizedProductId };
}

/**
 * Import all photos from a local directory. Skips videos.
 * Optionally auto-associates based on filename.
 */
export async function importFromDirectory(
  dirPath: string,
  onProgress?: (msg: string) => void,
  companyId = DEFAULT_COMPANY_ID,
): Promise<{ imported: number; skipped: number }> {
  const log = onProgress || ((msg: string) => console.log(`[PhotoBank] ${msg}`));
  const imageExts = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".tiff", ".bmp"]);
  const rootDir = resolve(dirPath);
  const rootReal = realpathSync(rootDir);

  let imported = 0;
  let skipped = 0;

  const processDir = async (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      log(`Cannot read directory: ${dir}`);
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      let resolvedFullPath: string;
      let stat;
      try {
        resolvedFullPath = realpathSync(fullPath);
        if (resolvedFullPath !== rootReal && !resolvedFullPath.startsWith(`${rootReal}${sep}`)) {
          skipped++;
          continue;
        }
        stat = statSync(resolvedFullPath);
      } catch { continue; }

      if (stat.isDirectory()) {
        await processDir(resolvedFullPath);
        continue;
      }

      const ext = extname(entry).toLowerCase();
      if (!imageExts.has(ext)) {
        skipped++;
        continue;
      }

      // Use the root-relative source path as identity. Camera filenames repeat
      // across shoots, so filename-only de-duplication loses distinct assets.
      const sourceRef = `directory:${relative(rootReal, resolvedFullPath)}`;
      const existing = await db.select().from(productPhotos)
        .where(and(
          eq(productPhotos.companyId, companyId),
          or(
            eq(productPhotos.sourceUrl, sourceRef),
            and(isNull(productPhotos.sourceUrl), eq(productPhotos.originalFilename, entry)),
          ),
        )).limit(1);
      if (existing.length > 0) {
        skipped++;
        continue;
      }

      try {
        const fs = await import("fs/promises");
        const buffer = await fs.readFile(resolvedFullPath);
        const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
        await storePhoto(buffer, entry, mime, undefined, companyId, {
          sourceType: "directory",
          sourceUrl: sourceRef,
          preserveOriginalBytes: true,
        });
        imported++;
        if (imported % 10 === 0) log(`Imported ${imported} photos...`);
      } catch (err: any) {
        log(`Failed to import ${entry}: ${err.message}`);
        skipped++;
      }
    }
  };

  await processDir(dirPath);
  log(`Done: ${imported} imported, ${skipped} skipped`);
  return { imported, skipped };
}

// --- AI Vision Analysis ---

export interface PhotoAnalysis {
  identifiedProduct: string;
  angleType: string;
  contextType: string;
  settingDescription: string;
  qualityScore: number;
  verticalRelevance: string[];
  isHeroCandidate: boolean;
}

/**
 * Analyze a single photo with gpt-4o vision.
 */
export async function analyzePhoto(photoId: string, companyId = DEFAULT_COMPANY_ID): Promise<PhotoAnalysis> {
  const [photo] = await db
    .select()
    .from(productPhotos)
    .where(and(eq(productPhotos.companyId, companyId), eq(productPhotos.id, photoId)))
    .limit(1);
  if (!photo) throw new Error("Photo not found");

  const openai = getOpenAI();
  const companyContext = await getCompanyContext(companyId);
  const verticalRows = await db
    .select({ slug: industryVerticals.slug, name: industryVerticals.name })
    .from(industryVerticals)
    .where(eq(industryVerticals.companyId, companyId));
  const verticalChoices = verticalRows.length > 0
    ? verticalRows.map((vertical) => `${vertical.slug} (${vertical.name})`).join(", ")
    : "none configured; return an empty array";

  // Read the image file
  const imageBuffer = await readFile(photo.filePath);
  const base64 = imageBuffer.toString("base64");
  const mediaType = photo.mimeType.startsWith("image/") ? photo.mimeType : "image/jpeg";

  const analysis = await cachedApiCall<PhotoAnalysis>(
    `openai:photo:${companyId}:${photoId}`,
    async () => {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: [
            {
              type: "text",
              text: `Analyze this product photo for ${companyContext.brandProfile.displayName}.

Brand/product context: ${companyContext.brandProfile.shortDescription || companyContext.brandProfile.positioning || companyContext.company.websiteUrl || "ecommerce products"}.

Return JSON only:
{
  "identifiedProduct": "best guess at product name based on what you see",
  "angleType": "front|back|side|top|detail|full|in-use",
  "contextType": "studio|in-use|lifestyle|packaging|technical",
  "settingDescription": "brief description of the setting (e.g., 'product in use on a workbench', 'white background studio shot')",
  "qualityScore": 0.0-1.0,
  "verticalRelevance": ["matching-vertical-slugs"],
  "isHeroCandidate": true/false
}

Vertical slugs to choose from: ${verticalChoices}`,
            },
            {
              type: "image_url",
              image_url: { url: `data:${mediaType};base64,${base64}` },
            },
          ],
        }],
      });

      const text = response.choices[0]?.message?.content || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Failed to parse vision analysis");
      return JSON.parse(jsonMatch[0]) as PhotoAnalysis;
    },
    { ttlMs: TTL.PHOTO_ANALYSIS, limiter: openaiLimiter },
  );

  // Update DB
  await db.update(productPhotos).set({
    angleType: analysis.angleType,
    contextType: analysis.contextType,
    settingDescription: analysis.settingDescription,
    qualityScore: analysis.qualityScore,
    isHero: analysis.isHeroCandidate,
    verticalRelevance: analysis.verticalRelevance,
    aiAnalysis: analysis as any,
    analyzedAt: new Date(),
    }).where(and(eq(productPhotos.companyId, companyId), eq(productPhotos.id, photoId)));

  return analysis;
}

/**
 * Apply a reviewed label produced by an external Codex/Luna vision task.
 * The file hash is verified before any metadata is written, so labels cannot
 * drift onto a same-named or reordered asset.
 */
export async function applyExternalBrollLabel(
  photoId: string,
  input: unknown,
  companyId = DEFAULT_COMPANY_ID,
): Promise<ProductPhoto> {
  const label: BrollLabel = parseBrollLabel(input);
  const photo = await getPhoto(photoId, companyId);
  if (!photo) throw new Error("Photo not found");

  const imageBuffer = await readFile(photo.filePath);
  const actualHash = createHash("sha256").update(imageBuffer).digest("hex");
  if (actualHash !== label.sha256) {
    throw new Error("B-roll label hash does not match the stored photo");
  }

  await db.update(productPhotos).set({
    angleType: label.angleType,
    contextType: label.contextType,
    settingDescription: label.scene,
    qualityScore: label.quality.score,
    isHero: label.cropSuitability.hero,
    verticalRelevance: label.verticals,
    useCases: label.useCases,
    altText: label.altText,
    caption: label.caption,
    notes: label.reviewFlags.length > 0 ? `AI review flags: ${label.reviewFlags.join("; ")}` : photo.notes,
    aiAnalysis: label,
    analyzedAt: new Date(),
  }).where(and(eq(productPhotos.companyId, companyId), eq(productPhotos.id, photoId)));

  const updated = await getPhoto(photoId, companyId);
  if (!updated) throw new Error("Photo not found after label update");
  return updated;
}

/**
 * Batch analyze unanalyzed photos.
 */
export async function batchAnalyzePhotos(
  limit = 20,
  onProgress?: (msg: string) => void,
  companyId = DEFAULT_COMPANY_ID,
): Promise<{ analyzed: number; failed: number }> {
  const log = onProgress || ((msg: string) => console.log(`[PhotoBank] ${msg}`));
  const unanalyzed = await db.select().from(productPhotos)
    .where(and(eq(productPhotos.companyId, companyId), isNull(productPhotos.analyzedAt)))
    .limit(limit);

  let analyzed = 0;
  let failed = 0;

  for (const photo of unanalyzed) {
    try {
      await analyzePhoto(photo.id, companyId);
      analyzed++;
      if (analyzed % 5 === 0) log(`Analyzed ${analyzed}/${unanalyzed.length}`);
    } catch (err: any) {
      log(`Failed to analyze ${photo.originalFilename}: ${err.message}`);
      failed++;
    }
  }

  log(`Done: ${analyzed} analyzed, ${failed} failed`);
  return { analyzed, failed };
}

/**
 * Auto-associate unassigned photos to products based on filename + AI analysis.
 */
export async function autoAssociatePhotos(companyId = DEFAULT_COMPANY_ID): Promise<{ associated: number }> {
  const unassigned = await db
    .select()
    .from(productPhotos)
    .where(and(eq(productPhotos.companyId, companyId), isNull(productPhotos.productId)));
  const allProducts = await db.select().from(products).where(eq(products.companyId, companyId));
  let associated = 0;

  for (const photo of unassigned) {
    // Try matching by filename (e.g., "048A7640 Nu Cupholder xProDock.jpg")
    const nameNoExt = photo.originalFilename.replace(/\.[^.]+$/, "").toLowerCase();
    let bestMatch: typeof allProducts[0] | null = null;
    let bestScore = 0;

    for (const product of allProducts) {
      const prodTitle = product.title.toLowerCase();
      // Check if product name words appear in filename
      const prodWords = prodTitle.split(/\s+/).filter((w) => w.length > 3);
      const matchingWords = prodWords.filter((w) => nameNoExt.includes(w));
      const score = prodWords.length > 0 ? matchingWords.length / prodWords.length : 0;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = product;
      }
    }

    // Also check AI-identified product name
    if (photo.aiAnalysis && typeof photo.aiAnalysis === "object") {
      const aiName = (photo.aiAnalysis as any).identifiedProduct?.toLowerCase() || "";
      for (const product of allProducts) {
        const prodTitle = product.title.toLowerCase();
        if (aiName.includes(prodTitle.slice(0, 20)) || prodTitle.includes(aiName.slice(0, 20))) {
          if (0.7 > bestScore) {
            bestScore = 0.7;
            bestMatch = product;
          }
        }
      }
    }

    if (bestMatch && bestScore >= 0.3) {
      await db
        .update(productPhotos)
        .set({ productId: bestMatch.id })
        .where(and(eq(productPhotos.companyId, companyId), eq(productPhotos.id, photo.id)));
      await updateProductPhotoCount(bestMatch.id, companyId);
      associated++;
    }
  }

  return { associated };
}

// --- Helpers ---

async function updateProductPhotoCount(productId: string, companyId = DEFAULT_COMPANY_ID): Promise<void> {
  const photos = await db
    .select()
    .from(productPhotos)
    .where(and(eq(productPhotos.companyId, companyId), eq(productPhotos.productId, productId)));
  await db.update(products).set({
    hasPhotos: photos.length > 0,
    photoCount: photos.length,
    updatedAt: new Date(),
  }).where(and(eq(products.companyId, companyId), eq(products.id, productId)));
}

// --- Queries ---

export async function getPhotos(productId?: string, companyId = DEFAULT_COMPANY_ID): Promise<ProductPhoto[]> {
  if (productId) {
    return db.select().from(productPhotos).where(and(eq(productPhotos.companyId, companyId), eq(productPhotos.productId, productId)));
  }
  return db.select().from(productPhotos).where(eq(productPhotos.companyId, companyId));
}

export async function getPhoto(id: string, companyId = DEFAULT_COMPANY_ID): Promise<ProductPhoto | undefined> {
  const [photo] = await db
    .select()
    .from(productPhotos)
    .where(and(eq(productPhotos.companyId, companyId), eq(productPhotos.id, id)))
    .limit(1);
  return photo;
}

export async function getPhotoStats(companyId = DEFAULT_COMPANY_ID): Promise<{
  total: number;
  analyzed: number;
  unanalyzed: number;
  unassigned: number;
  approved: number;
  needsReview: number;
  restricted: number;
}> {
  const all = await db.select().from(productPhotos).where(eq(productPhotos.companyId, companyId));
  return {
    total: all.length,
    analyzed: all.filter((p) => p.analyzedAt).length,
    unanalyzed: all.filter((p) => !p.analyzedAt).length,
    unassigned: all.filter((p) => !p.productId).length,
    approved: all.filter((p) => p.assetStatus === "approved").length,
    needsReview: all.filter((p) => p.assetStatus === "needs_review").length,
    restricted: all.filter((p) => p.rightsStatus === "restricted").length,
  };
}

export async function updatePhotoMetadata(
  id: string,
  updates: PhotoMetadataUpdate,
  companyId = DEFAULT_COMPANY_ID,
): Promise<ProductPhoto> {
  const [existing] = await db
    .select()
    .from(productPhotos)
    .where(and(eq(productPhotos.companyId, companyId), eq(productPhotos.id, id)))
    .limit(1);
  if (!existing) throw new Error("Photo not found");

  assertKnownValue(updates.assetStatus, ASSET_STATUSES, "assetStatus");
  assertKnownValue(updates.rightsStatus, RIGHTS_STATUSES, "rightsStatus");
  assertKnownValue(updates.sourceType, PHOTO_SOURCE_TYPES, "sourceType");

  const values: Partial<typeof productPhotos.$inferInsert> = {};

  if (Object.prototype.hasOwnProperty.call(updates, "productId")) {
    const nextProductId = updates.productId?.trim() || null;
    if (nextProductId) {
      await assertProductBelongsToCompany(nextProductId, companyId);
    }
    values.productId = nextProductId;
  }

  if (updates.assetStatus !== undefined) values.assetStatus = updates.assetStatus;
  if (updates.rightsStatus !== undefined) values.rightsStatus = updates.rightsStatus;
  if (updates.usageRestrictions !== undefined) values.usageRestrictions = updates.usageRestrictions?.trim() || null;
  if (updates.useCases !== undefined) values.useCases = normalizeStringArray(updates.useCases);
  if (updates.altText !== undefined) values.altText = updates.altText?.trim() || null;
  if (updates.caption !== undefined) values.caption = updates.caption?.trim() || null;
  if (updates.notes !== undefined) values.notes = updates.notes?.trim() || null;
  if (updates.sourceType !== undefined) values.sourceType = updates.sourceType;
  if (updates.sourceUrl !== undefined) values.sourceUrl = updates.sourceUrl?.trim() || null;
  if (updates.angleType !== undefined) values.angleType = updates.angleType?.trim() || null;
  if (updates.contextType !== undefined) values.contextType = updates.contextType?.trim() || null;
  if (updates.settingDescription !== undefined) values.settingDescription = updates.settingDescription?.trim() || null;
  if (updates.qualityScore !== undefined) values.qualityScore = normalizeQualityScore(updates.qualityScore);
  if (updates.isHero !== undefined) values.isHero = updates.isHero;
  if (updates.verticalRelevance !== undefined) values.verticalRelevance = normalizeStringArray(updates.verticalRelevance);

  if (Object.keys(values).length > 0) {
    await db
      .update(productPhotos)
      .set(values)
      .where(and(eq(productPhotos.companyId, companyId), eq(productPhotos.id, id)));
  }

  if (Object.prototype.hasOwnProperty.call(values, "productId") && values.productId !== existing.productId) {
    if (existing.productId) await updateProductPhotoCount(existing.productId, companyId);
    if (values.productId) await updateProductPhotoCount(values.productId, companyId);
  }

  const updated = await getPhoto(id, companyId);
  if (!updated) throw new Error("Photo not found after update");
  return updated;
}

export async function deletePhoto(id: string, companyId = DEFAULT_COMPANY_ID): Promise<void> {
  const [photo] = await db
    .select()
    .from(productPhotos)
    .where(and(eq(productPhotos.companyId, companyId), eq(productPhotos.id, id)))
    .limit(1);
  if (photo) {
    // Try to delete files
    const fs = await import("fs/promises");
    try { await fs.unlink(photo.filePath); } catch {}
    try { if (photo.thumbnailPath) await fs.unlink(photo.thumbnailPath); } catch {}
    await db.delete(productPhotos).where(and(eq(productPhotos.companyId, companyId), eq(productPhotos.id, id)));
    if (photo.productId) await updateProductPhotoCount(photo.productId, companyId);
  }
}
