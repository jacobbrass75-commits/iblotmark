// Photo Bank — Upload, store, and AI-analyze product photos
// Uses sharp for thumbnails, gpt-4o for vision analysis.

import { db } from "./db";
import { eq, isNull } from "drizzle-orm";
import {
  productPhotos,
  products,
  type ProductPhoto,
  type InsertProductPhoto,
} from "@shared/schema";
import sharp from "sharp";
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync } from "fs";
import { join, basename, extname } from "path";
import { randomUUID } from "crypto";
import OpenAI from "openai";
import { readFile } from "fs/promises";
import { cachedApiCall, openaiLimiter, TTL } from "./apiCache";

const PHOTO_DIR = "./uploads/product-photos";
const THUMB_DIR = "./uploads/product-photos/thumbs";

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

/**
 * Store a photo file and create a DB record.
 */
export async function storePhoto(
  fileBuffer: Buffer,
  originalFilename: string,
  mimeType: string,
  productId?: string,
): Promise<PhotoUploadResult> {
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

    // Save original (normalized orientation)
    imgBuffer = await img.rotate().toBuffer();
    await sharp(imgBuffer).toFile(filePath);

    // Create thumbnail (300px wide)
    await sharp(imgBuffer).resize(300).jpeg({ quality: 80 }).toFile(thumbPath);
  } catch {
    // If sharp fails (e.g., HEIC without support), just copy raw
    const fs = await import("fs/promises");
    await fs.writeFile(filePath, fileBuffer);
    metadata = { width: 0, height: 0 } as any;
  }

  const [photo] = await db.insert(productPhotos).values({
    productId: productId || null,
    filename,
    originalFilename,
    mimeType,
    fileSize: fileBuffer.length,
    filePath,
    thumbnailPath: thumbPath,
    width: metadata?.width || null,
    height: metadata?.height || null,
  }).returning();

  // Update product photo count
  if (productId) {
    await updateProductPhotoCount(productId);
  }

  return { photoId: photo.id, filename, productId: productId || null };
}

/**
 * Import all photos from a local directory. Skips videos.
 * Optionally auto-associates based on filename.
 */
export async function importFromDirectory(
  dirPath: string,
  onProgress?: (msg: string) => void,
): Promise<{ imported: number; skipped: number }> {
  const log = onProgress || ((msg: string) => console.log(`[PhotoBank] ${msg}`));
  const imageExts = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".tiff", ".bmp"]);

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
      let stat;
      try { stat = statSync(fullPath); } catch { continue; }

      if (stat.isDirectory()) {
        await processDir(fullPath);
        continue;
      }

      const ext = extname(entry).toLowerCase();
      if (!imageExts.has(ext)) {
        skipped++;
        continue;
      }

      // Check if already imported (by original filename)
      const existing = await db.select().from(productPhotos)
        .where(eq(productPhotos.originalFilename, entry)).limit(1);
      if (existing.length > 0) {
        skipped++;
        continue;
      }

      try {
        const fs = await import("fs/promises");
        const buffer = await fs.readFile(fullPath);
        const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
        await storePhoto(buffer, entry, mime);
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
export async function analyzePhoto(photoId: string): Promise<PhotoAnalysis> {
  const [photo] = await db.select().from(productPhotos).where(eq(productPhotos.id, photoId)).limit(1);
  if (!photo) throw new Error("Photo not found");

  const openai = getOpenAI();

  // Read the image file
  const imageBuffer = await readFile(photo.filePath);
  const base64 = imageBuffer.toString("base64");
  const mediaType = photo.mimeType.startsWith("image/") ? photo.mimeType : "image/jpeg";

  const analysis = await cachedApiCall<PhotoAnalysis>(
    `openai:photo:${photoId}`,
    async () => {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: [
            {
              type: "text",
              text: `Analyze this product photo for iBolt Mounts (device mounting solutions company).

Return JSON only:
{
  "identifiedProduct": "best guess at product name based on what you see",
  "angleType": "front|back|side|top|detail|full|in-use",
  "contextType": "studio|in-use|lifestyle|packaging|technical",
  "settingDescription": "brief description of the setting (e.g., 'mounted on truck dashboard', 'white background studio shot')",
  "qualityScore": 0.0-1.0,
  "verticalRelevance": ["matching-vertical-slugs"],
  "isHeroCandidate": true/false
}

Vertical slugs to choose from: fishing-boating, forklifts-warehousing, trucking-fleet, offroading-jeep, restaurants-food-delivery, education-schools, content-creation-streaming, agriculture-farming, kitchen-home, road-trips-travel, mountain-biking-cycling, general-mounting`,
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
  }).where(eq(productPhotos.id, photoId));

  return analysis;
}

/**
 * Batch analyze unanalyzed photos.
 */
export async function batchAnalyzePhotos(
  limit = 20,
  onProgress?: (msg: string) => void,
): Promise<{ analyzed: number; failed: number }> {
  const log = onProgress || ((msg: string) => console.log(`[PhotoBank] ${msg}`));
  const unanalyzed = await db.select().from(productPhotos)
    .where(isNull(productPhotos.analyzedAt))
    .limit(limit);

  let analyzed = 0;
  let failed = 0;

  for (const photo of unanalyzed) {
    try {
      await analyzePhoto(photo.id);
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
export async function autoAssociatePhotos(): Promise<{ associated: number }> {
  const unassigned = await db.select().from(productPhotos).where(isNull(productPhotos.productId));
  const allProducts = await db.select().from(products);
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
      await db.update(productPhotos).set({ productId: bestMatch.id }).where(eq(productPhotos.id, photo.id));
      await updateProductPhotoCount(bestMatch.id);
      associated++;
    }
  }

  return { associated };
}

// --- Helpers ---

async function updateProductPhotoCount(productId: string): Promise<void> {
  const photos = await db.select().from(productPhotos).where(eq(productPhotos.productId, productId));
  await db.update(products).set({
    hasPhotos: photos.length > 0,
    photoCount: photos.length,
    updatedAt: new Date(),
  }).where(eq(products.id, productId));
}

// --- Queries ---

export async function getPhotos(productId?: string): Promise<ProductPhoto[]> {
  if (productId) {
    return db.select().from(productPhotos).where(eq(productPhotos.productId, productId));
  }
  return db.select().from(productPhotos);
}

export async function getPhoto(id: string): Promise<ProductPhoto | undefined> {
  const [photo] = await db.select().from(productPhotos).where(eq(productPhotos.id, id)).limit(1);
  return photo;
}

export async function getPhotoStats(): Promise<{ total: number; analyzed: number; unanalyzed: number; unassigned: number }> {
  const all = await db.select().from(productPhotos);
  return {
    total: all.length,
    analyzed: all.filter((p) => p.analyzedAt).length,
    unanalyzed: all.filter((p) => !p.analyzedAt).length,
    unassigned: all.filter((p) => !p.productId).length,
  };
}

export async function deletePhoto(id: string): Promise<void> {
  const [photo] = await db.select().from(productPhotos).where(eq(productPhotos.id, id)).limit(1);
  if (photo) {
    // Try to delete files
    const fs = await import("fs/promises");
    try { await fs.unlink(photo.filePath); } catch {}
    try { if (photo.thumbnailPath) await fs.unlink(photo.thumbnailPath); } catch {}
    await db.delete(productPhotos).where(eq(productPhotos.id, id));
    if (photo.productId) await updateProductPhotoCount(photo.productId);
  }
}
