import type { Express as ExpressApp, Request, Response } from "express";
import { createServer, type Server } from "http";
import { readdir, stat } from "fs/promises";
import { join } from "path";
import multer from "multer";
import { PDFParse } from "pdf-parse";
import { storage } from "./storage";
import { db } from "./db";
import { extractTextFromTxt } from "./chunker";
import {
  getEmbedding,
  analyzeChunkForIntent,
  generateDocumentSummary,
  searchDocument,
  findHighlightPosition,
  cosineSimilarity,
  PIPELINE_CONFIG,
  getMaxChunksForLevel,
  type ThoroughnessLevel,
} from "./openai";
// V2 Pipeline - improved annotation system
import {
  processChunksWithPipelineV2,
  chunkTextV2,
  clearDocumentContextCacheV2,
  PIPELINE_V2_CONFIG,
} from "./pipelineV2";
import { registerProjectRoutes } from "./projectRoutes";
import { registerChatRoutes } from "./chatRoutes";
import { registerWritingRoutes } from "./writingRoutes";
import { registerHumanizerRoutes } from "./humanizerRoutes";
import { registerExtensionRoutes } from "./extensionRoutes";
import { registerWebClipRoutes } from "./webClipRoutes";
import { registerAnalyticsRoutes } from "./analyticsRoutes";
import type { AnnotationCategory, InsertAnnotation } from "@shared/schema";
import {
  createZipFromImageUploads,
  SUPPORTED_VISION_OCR_MODELS,
  type VisionOcrModel,
} from "./ocrProcessor";
import {
  enqueueImageBundleOcrJob,
  enqueueImageOcrJob,
  enqueuePdfOcrJob,
  initializeOcrQueue,
} from "./ocrQueue";
import {
  getDocumentSourcePath,
  hasDocumentSource,
  inferDocumentSourceMimeType,
  saveDocumentSource,
} from "./sourceFiles";
import { annotations, documents, projectAnnotations, projects } from "@shared/schema";
import { sql } from "drizzle-orm";
import { requireAuth } from "./auth";

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
  ".heic",
  ".heif",
]);

const IMAGE_MIME_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);
const MAX_COMBINED_UPLOAD_FILES = Number.isFinite(Number(process.env.MAX_COMBINED_UPLOAD_FILES))
  ? Math.max(1, Math.floor(Number(process.env.MAX_COMBINED_UPLOAD_FILES)))
  : 25;
const DATABASE_PATH = join(process.cwd(), "data", "sourceannotator.db");
const SOURCE_UPLOADS_PATH = join(process.cwd(), "data", "uploads");

function getFileExtension(filename: string): string {
  const extStart = filename.lastIndexOf(".");
  if (extStart < 0) return "";
  return filename.slice(extStart).toLowerCase();
}

function isImageFile(mimeType: string, extension: string): boolean {
  return mimeType.startsWith("image/") || IMAGE_MIME_TYPES.has(mimeType) || IMAGE_EXTENSIONS.has(extension);
}

async function getFileSizeBytes(path: string): Promise<number> {
  try {
    const metadata = await stat(path);
    return metadata.size;
  } catch {
    return 0;
  }
}

async function getDirectorySizeBytes(path: string): Promise<number> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    let total = 0;

    for (const entry of entries) {
      const entryPath = join(path, entry.name);
      if (entry.isDirectory()) {
        total += await getDirectorySizeBytes(entryPath);
      } else if (entry.isFile()) {
        total += await getFileSizeBytes(entryPath);
      }
    }

    return total;
  } catch {
    return 0;
  }
}

// Detect garbled text from failed PDF extraction.
// Requires multiple heuristics to agree before rejecting — previous thresholds
// were too aggressive and rejected legitimate PDFs with technical content.
function isGarbledText(text: string): boolean {
  if (!text || text.length < 100) return false;

  // Sample the first 2000 characters for analysis
  const sample = text.slice(0, 2000);

  // Count normal words (sequences of 3+ alphabetic characters)
  const words = sample.match(/[a-zA-Z]{3,}/g) || [];

  // Count special/unusual character patterns
  const brackets = sample.match(/[\[\]{}\\|^~`@#$%&*+=<>]/g) || [];

  // Calculate ratios
  const wordChars = words.join("").length;
  const totalChars = sample.replace(/\s/g, "").length;
  const wordRatio = totalChars > 0 ? wordChars / totalChars : 0;
  const bracketRatio = totalChars > 0 ? brackets.length / totalChars : 0;
  const avgWordLen = words.length > 0 ? wordChars / words.length : 0;

  // Require at least two signals to flag as garbled (reduces false positives):
  // - Very low word ratio (<25% — relaxed from 40%)
  // - High bracket/symbol density (>15% — relaxed from 10%)
  // - Fragmented characters (avg word < 3 with enough samples)
  let signals = 0;
  if (wordRatio < 0.25) signals += 1;
  if (bracketRatio > 0.15) signals += 1;
  if (words.length > 10 && avgWordLen < 3) signals += 1;

  return signals >= 2;
}

// Detect parser output that contains mostly page footer markers such as
// "-- 1 of 16 -- -- 2 of 16 --" with little to no real document content.
function isLikelyPageMarkerOnlyText(text: string): boolean {
  if (!text || text.length < 80) return false;

  const pageMarkerMatches =
    text.match(/(?:--\s*)?\d+\s+of\s+\d+(?:\s*--)?/gi) || [];
  if (pageMarkerMatches.length < 3) return false;

  const pageMarkerChars = pageMarkerMatches.reduce((total, marker) => total + marker.length, 0);
  const markerRatio = pageMarkerChars / Math.max(1, text.length);

  const words = text.match(/[a-zA-Z]{3,}/g) || [];
  const uniqueWordCount = new Set(words.map((word) => word.toLowerCase())).size;

  return markerRatio >= 0.4 && uniqueWordCount <= 8;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const ext = getFileExtension(file.originalname);
    const isPdf = file.mimetype === "application/pdf" || ext === ".pdf";
    const isTxt = file.mimetype === "text/plain" || ext === ".txt";
    const isImage = isImageFile(file.mimetype, ext);

    if (isPdf || isTxt || isImage) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF, TXT, and image files (including HEIC/HEIF) are allowed"));
    }
  },
});

export async function registerRoutes(
  httpServer: Server,
  app: ExpressApp
): Promise<Server> {
  await initializeOcrQueue();

  app.get("/api/system/status", async (_req: Request, res: Response) => {
    try {
      const [projectCountRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(projects);
      const [documentCountRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(documents);
      const [annotationCountRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(annotations);
      const [projectAnnotationCountRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(projectAnnotations);

      const documentMeta = await storage.getAllDocumentMeta();
      const statusBreakdown = {
        ready: 0,
        processing: 0,
        error: 0,
        other: 0,
      };

      for (const doc of documentMeta) {
        if (doc.status === "ready") {
          statusBreakdown.ready += 1;
        } else if (doc.status === "processing") {
          statusBreakdown.processing += 1;
        } else if (doc.status === "error") {
          statusBreakdown.error += 1;
        } else {
          statusBreakdown.other += 1;
        }
      }

      const dbBytes = await getFileSizeBytes(DATABASE_PATH);
      const sourceFilesBytes = await getDirectorySizeBytes(SOURCE_UPLOADS_PATH);
      const heapUsage = process.memoryUsage();

      return res.json({
        counts: {
          projects: projectCountRow?.count ?? 0,
          documents: documentCountRow?.count ?? 0,
          annotations: (annotationCountRow?.count ?? 0) + (projectAnnotationCountRow?.count ?? 0),
        },
        storage: {
          databaseBytes: dbBytes,
          sourceFilesBytes,
          totalBytes: dbBytes + sourceFilesBytes,
        },
        system: {
          uptimeSeconds: Math.floor(process.uptime()),
          nodeVersion: process.version,
          platform: `${process.platform}/${process.arch}`,
          heapUsedBytes: heapUsage.heapUsed,
          heapTotalBytes: Math.max(heapUsage.heapTotal, 1),
        },
        documentsByStatus: statusBreakdown,
        capturedAt: Date.now(),
      });
    } catch (error) {
      console.error("Error fetching system status:", error);
      return res.status(500).json({ message: "Failed to fetch system status" });
    }
  });

  // Upload document
  app.post("/api/upload", requireAuth, upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const file = req.file;
      const requestedOcrMode = ((req.body.ocrMode as string) || "standard").toLowerCase();
      const ocrMode =
        requestedOcrMode === "vision-batch"
          ? "vision_batch"
          : ["standard", "advanced", "vision", "vision_batch"].includes(requestedOcrMode)
          ? requestedOcrMode
          : "standard";
      const requestedOcrModel = ((req.body.ocrModel as string) || "").toLowerCase();
      const ocrModel: VisionOcrModel = SUPPORTED_VISION_OCR_MODELS.includes(
        requestedOcrModel as VisionOcrModel
      )
        ? (requestedOcrModel as VisionOcrModel)
        : "gpt-4o";
      const fileExtension = getFileExtension(file.originalname);
      const isPdf = file.mimetype === "application/pdf" || fileExtension === ".pdf";
      const isTxt = file.mimetype === "text/plain" || fileExtension === ".txt";
      const isImage = isImageFile(file.mimetype, fileExtension);

      if (!isPdf && !isTxt && !isImage) {
        return res.status(400).json({
          message: "Unsupported file type. Please upload a PDF, TXT, or image file (including HEIC/HEIF).",
        });
      }

      const queueStandardPdfFallback = async (
        reasonCode: "standard_parse_failed" | "standard_garbled_text" | "standard_empty_text",
        reasonMessage: string
      ) => {
        console.warn(
          `[upload] Standard PDF extraction fallback (${reasonCode}) for ${file.originalname}: ${reasonMessage}`
        );

        const doc = await storage.createDocument({
          filename: file.originalname,
          fullText: "",
          userId: req.user!.userId,
        } as any);
        await saveDocumentSource(doc.id, file.originalname, file.buffer);
        await storage.updateDocument(doc.id, { status: "processing" });
        await enqueuePdfOcrJob({
          documentId: doc.id,
          sourceFilename: file.originalname,
          // Vision batch is more robust than PaddleOCR for parser-failure fallbacks
          // and avoids recurring quality drops on scanned/complex PDFs.
          ocrMode: "vision_batch",
          ocrModel,
        });

        const updatedDoc = await storage.getDocument(doc.id);
        return res.status(202).json(updatedDoc);
      };

      // For TXT files and standard PDF mode, use synchronous processing
      if (isTxt || (isPdf && ocrMode === "standard")) {
        let fullText: string;

        if (isPdf) {
          if (file.buffer.length === 0) {
            return res.status(400).json({
              message:
                "The uploaded PDF is empty (0 bytes). If it came from cloud storage, download it locally first and try again.",
              code: "standard_empty_upload",
            });
          }

          // Use pdf-parse to extract text from PDF. Wrap in try/finally to ensure
          // the parser is always destroyed even if extraction fails.
          let parser: InstanceType<typeof PDFParse> | null = null;
          try {
            parser = new PDFParse({ data: file.buffer });
            const textResult = await parser.getText();
            fullText = textResult.text;
          } catch (pdfError) {
            const parseErrorMessage = pdfError instanceof Error ? pdfError.message : String(pdfError);
            console.error("Standard PDF parse failed for", file.originalname, pdfError);
            if (/size is zero bytes/i.test(parseErrorMessage)) {
              return res.status(400).json({
                message:
                  "The uploaded PDF is empty (0 bytes). If it came from cloud storage, download it locally first and try again.",
                code: "standard_empty_upload",
              });
            }
            return await queueStandardPdfFallback("standard_parse_failed", parseErrorMessage);
          } finally {
            try { await parser?.destroy(); } catch { /* ignore cleanup errors */ }
          }
          // Clean up whitespace
          fullText = fullText!.replace(/\s+/g, " ").trim();

          if (isLikelyPageMarkerOnlyText(fullText)) {
            return await queueStandardPdfFallback(
              "standard_empty_text",
              "Standard extraction returned mostly page marker footer text"
            );
          }

          // Check if extracted text appears garbled (common with scanned PDFs or custom fonts)
          if (isGarbledText(fullText)) {
            return await queueStandardPdfFallback(
              "standard_garbled_text",
              "Standard extraction produced garbled text"
            );
          }
        } else {
          fullText = extractTextFromTxt(file.buffer.toString("utf-8"));
        }

        if (!fullText || fullText.length < 10) {
          if (isPdf) {
            return await queueStandardPdfFallback(
              "standard_empty_text",
              "Standard extraction produced no usable text"
            );
          }
          return res.status(400).json({
            message: "Could not extract any text from this file. If it is a scanned PDF, try Advanced OCR or Vision OCR mode.",
            code: "standard_empty_text",
          });
        }

        // Create document
        const doc = await storage.createDocument({
          filename: file.originalname,
          fullText,
          userId: req.user!.userId,
        } as any);
        await saveDocumentSource(doc.id, file.originalname, file.buffer);

        // Chunk the text using V2 chunking (with noise filtering and larger chunks)
        const chunks = chunkTextV2(fullText);

        // Store chunks (don't generate embeddings yet - do it during analysis)
        for (const chunk of chunks) {
          await storage.createChunk({
            documentId: doc.id,
            text: chunk.text,
            startPosition: chunk.originalStartPosition,
            endPosition: chunk.originalStartPosition + chunk.text.length,
          });
        }

        // Update document with chunk count
        await storage.updateDocument(doc.id, { chunkCount: chunks.length });

        // Generate summary in background
        generateDocumentSummary(fullText).then(async (summaryData) => {
          await storage.updateDocument(doc.id, {
            summary: summaryData.summary,
            mainArguments: summaryData.mainArguments,
            keyConcepts: summaryData.keyConcepts,
          });
        });

        const updatedDoc = await storage.getDocument(doc.id);
        return res.json(updatedDoc);
      }

      if (isPdf) {
        // OCR modes for PDFs: queue durable background OCR against persisted source.
        const doc = await storage.createDocument({
          filename: file.originalname,
          fullText: "",
          userId: req.user!.userId,
        } as any);
        await saveDocumentSource(doc.id, file.originalname, file.buffer);
        await storage.updateDocument(doc.id, { status: "processing" });
        await enqueuePdfOcrJob({
          documentId: doc.id,
          sourceFilename: file.originalname,
          ocrMode: ocrMode as "advanced" | "vision" | "vision_batch",
          ocrModel,
        });

        const updatedDoc = await storage.getDocument(doc.id);
        return res.status(202).json(updatedDoc);
      }

      if (isImage) {
        // Image OCR runs as a durable queued job.
        const doc = await storage.createDocument({
          filename: file.originalname,
          fullText: "",
          userId: req.user!.userId,
        } as any);
        await saveDocumentSource(doc.id, file.originalname, file.buffer);
        await storage.updateDocument(doc.id, { status: "processing" });
        const imageOcrMode = ocrMode === "vision_batch" ? "vision_batch" : "vision";
        await enqueueImageOcrJob({
          documentId: doc.id,
          sourceFilename: file.originalname,
          ocrMode: imageOcrMode,
          ocrModel,
        });

        const updatedDoc = await storage.getDocument(doc.id);
        return res.status(202).json(updatedDoc);
      }

      return res.status(400).json({ message: "Unsupported OCR mode for this file type" });
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({ message: error instanceof Error ? error.message : "Upload failed" });
    }
  });

  // Upload multiple images as a single combined document (preserves upload order).
  app.post("/api/upload-group", requireAuth, upload.array("files", 100), async (req: Request, res: Response) => {
    try {
      const files = (req.files as Express.Multer.File[] | undefined) || [];
      if (!files.length) {
        return res.status(400).json({ message: "No files uploaded" });
      }
      if (files.length > MAX_COMBINED_UPLOAD_FILES) {
        return res.status(400).json({
          message:
            `Too many images in one combined upload (${files.length}). ` +
            `Limit is ${MAX_COMBINED_UPLOAD_FILES}. Split into smaller batches for reliability.`,
        });
      }

      const requestedOcrMode = ((req.body.ocrMode as string) || "standard").toLowerCase();
      const ocrMode =
        requestedOcrMode === "vision-batch"
          ? "vision_batch"
          : ["standard", "vision", "vision_batch"].includes(requestedOcrMode)
          ? requestedOcrMode
          : "standard";
      const requestedOcrModel = ((req.body.ocrModel as string) || "").toLowerCase();
      const ocrModel: VisionOcrModel = SUPPORTED_VISION_OCR_MODELS.includes(
        requestedOcrModel as VisionOcrModel
      )
        ? (requestedOcrModel as VisionOcrModel)
        : "gpt-4o";

      const supportedCombinedExtensions = new Set([".png", ".jpg", ".jpeg", ".heic", ".heif"]);
      for (const file of files) {
        const ext = getFileExtension(file.originalname);
        const image = isImageFile(file.mimetype, ext);
        if (!image) {
          return res.status(400).json({
            message: "Combined uploads currently support images only.",
          });
        }
        if (!supportedCombinedExtensions.has(ext)) {
          return res.status(400).json({
            message:
              `Unsupported image format for combined upload: ${file.originalname}. Please convert to PNG/JPG or upload separately.`,
          });
        }
      }

      const primaryName = files[0].originalname || "image-upload";
      const baseName = primaryName.replace(/\.[^/.]+$/, "");
      const combinedFilename = `${baseName} (${files.length} images).zip`;

      const doc = await storage.createDocument({
        filename: combinedFilename,
        fullText: "",
        userId: req.user!.userId,
      } as any);
      await storage.updateDocument(doc.id, { status: "processing" });
      const combinedZipBuffer = await createZipFromImageUploads(
        files.map((file) => ({ buffer: file.buffer, originalFilename: file.originalname }))
      );
      await saveDocumentSource(doc.id, combinedFilename, combinedZipBuffer);

      const combinedOcrMode = ocrMode === "vision" ? "vision" : "vision_batch";
      await enqueueImageBundleOcrJob({
        documentId: doc.id,
        sourceFilename: combinedFilename,
        ocrMode: combinedOcrMode,
        ocrModel,
      });

      const updatedDoc = await storage.getDocument(doc.id);
      return res.status(202).json(updatedDoc);
    } catch (error) {
      console.error("Upload-group error:", error);
      res.status(500).json({ message: error instanceof Error ? error.message : "Upload failed" });
    }
  });

  // Get document processing status (for polling)
  app.get("/api/documents/:id/status", requireAuth, async (req: Request, res: Response) => {
    try {
      const doc = await storage.getDocument(req.params.id);
      if (!doc) {
        return res.status(404).json({ message: "Document not found" });
      }
      if ((doc as any).userId && (doc as any).userId !== req.user!.userId) {
        return res.status(403).json({ message: "Access denied" });
      }
      res.json({
        id: doc.id,
        status: doc.status,
        processingError: doc.processingError,
        filename: doc.filename,
        chunkCount: doc.chunkCount,
      });
    } catch (error) {
      console.error("Error fetching document status:", error);
      res.status(500).json({ message: "Failed to fetch document status" });
    }
  });

  // Get all documents
  app.get("/api/documents", requireAuth, async (req: Request, res: Response) => {
    try {
      const docs = await storage.getAllDocuments(req.user!.userId);
      res.json(docs);
    } catch (error) {
      console.error("Error fetching documents:", error);
      res.status(500).json({ message: "Failed to fetch documents" });
    }
  });

  // Get lightweight document metadata list (avoids returning fullText for every document)
  app.get("/api/documents/meta", requireAuth, async (req: Request, res: Response) => {
    try {
      const docs = await storage.getAllDocumentMeta(req.user!.userId);
      res.json(docs);
    } catch (error) {
      console.error("Error fetching document metadata:", error);
      res.status(500).json({ message: "Failed to fetch document metadata" });
    }
  });

  // Get single document
  app.get("/api/documents/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const doc = await storage.getDocument(req.params.id);
      if (!doc) {
        return res.status(404).json({ message: "Document not found" });
      }
      if ((doc as any).userId && (doc as any).userId !== req.user!.userId) {
        return res.status(403).json({ message: "Access denied" });
      }
      res.json(doc);
    } catch (error) {
      console.error("Error fetching document:", error);
      res.status(500).json({ message: "Failed to fetch document" });
    }
  });

  // Get original source metadata for a document
  app.get("/api/documents/:id/source-meta", requireAuth, async (req: Request, res: Response) => {
    try {
      const doc = await storage.getDocument(req.params.id);
      if (!doc) {
        return res.status(404).json({ message: "Document not found" });
      }

      const available = await hasDocumentSource(doc.id, doc.filename);
      res.json({
        documentId: doc.id,
        filename: doc.filename,
        available,
        mimeType: inferDocumentSourceMimeType(doc.filename),
        sourceUrl: available ? `/api/documents/${doc.id}/source` : null,
      });
    } catch (error) {
      console.error("Error fetching source metadata:", error);
      res.status(500).json({ message: "Failed to fetch source metadata" });
    }
  });

  // Stream original uploaded source file for side-by-side reference
  app.get("/api/documents/:id/source", requireAuth, async (req: Request, res: Response) => {
    try {
      const doc = await storage.getDocument(req.params.id);
      if (!doc) {
        return res.status(404).json({ message: "Document not found" });
      }

      const available = await hasDocumentSource(doc.id, doc.filename);
      if (!available) {
        return res.status(404).json({ message: "Original source file is not available for this document" });
      }

      const sourcePath = getDocumentSourcePath(doc.id, doc.filename);
      const mimeType = inferDocumentSourceMimeType(doc.filename);
      const safeFilename = doc.filename.replace(/"/g, "");
      const dispositionType = mimeType === "application/zip" ? "attachment" : "inline";

      res.setHeader("Content-Type", mimeType);
      res.setHeader("Content-Disposition", `${dispositionType}; filename="${safeFilename}"`);
      res.sendFile(sourcePath, (error) => {
        if (error && !res.headersSent) {
          res.status(500).json({ message: "Failed to stream source file" });
        }
      });
    } catch (error) {
      console.error("Error streaming source document:", error);
      res.status(500).json({ message: "Failed to stream source document" });
    }
  });

  // Set intent and trigger AI analysis
  app.post("/api/documents/:id/set-intent", requireAuth, async (req: Request, res: Response) => {
    try {
      const { intent, thoroughness = 'standard' } = req.body;
      if (!intent || typeof intent !== "string") {
        return res.status(400).json({ message: "Intent is required" });
      }

      // Validate thoroughness level
      const validLevels: ThoroughnessLevel[] = ['quick', 'standard', 'thorough', 'exhaustive'];
      const level: ThoroughnessLevel = validLevels.includes(thoroughness) ? thoroughness : 'standard';

      const doc = await storage.getDocument(req.params.id);
      if (!doc) {
        return res.status(404).json({ message: "Document not found" });
      }

      if (doc.status === "processing") {
        return res.status(409).json({ message: "Document is still processing. Please wait until processing completes." });
      }
      if (doc.status === "error") {
        return res.status(409).json({ message: "Document processing failed. Please re-upload the document." });
      }

      // Update document with intent
      await storage.updateDocument(doc.id, { userIntent: intent });

      // Get chunks
      const chunks = await storage.getChunksForDocument(doc.id);
      if (chunks.length === 0) {
        return res.status(400).json({ message: "No text chunks found for analysis" });
      }

      // Generate intent embedding
      const intentEmbedding = await getEmbedding(intent);

      // Generate embeddings for chunks if not already done
      const chunksWithEmbeddings = await Promise.all(
        chunks.map(async (chunk) => {
          if (!chunk.embedding) {
            const embedding = await getEmbedding(chunk.text);
            await storage.updateChunkEmbedding(chunk.id, embedding);
            return { ...chunk, embedding };
          }
          return chunk;
        })
      );

      // Calculate similarity and rank chunks
      const rankedChunks = chunksWithEmbeddings
        .map((chunk) => ({
          chunk,
          similarity: cosineSimilarity(chunk.embedding!, intentEmbedding),
        }))
        .sort((a, b) => b.similarity - a.similarity);

      // Filter to top relevant chunks based on thoroughness level
      const maxChunks = getMaxChunksForLevel(level);
      const minSimilarity = level === 'exhaustive' ? 0.1 : 0.3;

      const topChunks = rankedChunks
        .filter(({ similarity }) => similarity >= minSimilarity)
        .slice(0, maxChunks)
        .map(({ chunk }) => ({
          text: chunk.text,
          startPosition: chunk.startPosition,
          id: chunk.id,
        }));

      if (topChunks.length === 0) {
        return res.json([]);
      }

      // Get existing non-AI annotations to avoid duplicates
      const existingAnnotations = await storage.getAnnotationsForDocument(doc.id);
      const userAnnotations = existingAnnotations
        .filter((a) => !a.isAiGenerated)
        .map((a) => ({
          startPosition: a.startPosition,
          endPosition: a.endPosition,
          confidenceScore: a.confidenceScore,
        }));

      // Delete existing AI annotations before generating new ones
      for (const ann of existingAnnotations.filter(a => a.isAiGenerated)) {
        await storage.deleteAnnotation(ann.id);
      }

      // Process chunks through the V2 three-phase pipeline (improved)
      const pipelineAnnotations = await processChunksWithPipelineV2(
        topChunks,
        intent,
        doc.id,
        doc.fullText,
        userAnnotations
      );

      // Clear document context cache
      clearDocumentContextCacheV2(doc.id);

      // Create new annotations from pipeline results
      for (const ann of pipelineAnnotations) {
        await storage.createAnnotation({
          documentId: doc.id,
          startPosition: ann.absoluteStart,
          endPosition: ann.absoluteEnd,
          highlightedText: ann.highlightText,
          category: ann.category,
          note: ann.note,
          isAiGenerated: true,
          confidenceScore: ann.confidence,
        });
      }

      const finalAnnotations = await storage.getAnnotationsForDocument(doc.id);
      res.json(finalAnnotations);
    } catch (error) {
      console.error("Analysis error:", error);
      res.status(500).json({ message: error instanceof Error ? error.message : "Analysis failed" });
    }
  });

  // Get annotations for document
  app.get("/api/documents/:id/annotations", requireAuth, async (req: Request, res: Response) => {
    try {
      const annotations = await storage.getAnnotationsForDocument(req.params.id);
      res.json(annotations);
    } catch (error) {
      console.error("Error fetching annotations:", error);
      res.status(500).json({ message: "Failed to fetch annotations" });
    }
  });

  // Add manual annotation
  app.post("/api/documents/:id/annotate", requireAuth, async (req: Request, res: Response) => {
    try {
      const { startPosition, endPosition, highlightedText, category, note, isAiGenerated } = req.body;

      if (
        typeof startPosition !== "number" ||
        typeof endPosition !== "number" ||
        !highlightedText ||
        !category ||
        !note
      ) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const doc = await storage.getDocument(req.params.id);
      if (!doc) {
        return res.status(404).json({ message: "Document not found" });
      }

      const annotation = await storage.createAnnotation({
        documentId: doc.id,
        startPosition,
        endPosition,
        highlightedText,
        category: category as AnnotationCategory,
        note,
        isAiGenerated: isAiGenerated || false,
      });

      res.json(annotation);
    } catch (error) {
      console.error("Error creating annotation:", error);
      res.status(500).json({ message: "Failed to create annotation" });
    }
  });

  // Update annotation
  app.put("/api/annotations/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { note, category } = req.body;

      if (!note || !category) {
        return res.status(400).json({ message: "Note and category are required" });
      }

      const annotation = await storage.updateAnnotation(
        req.params.id,
        note,
        category as AnnotationCategory
      );

      if (!annotation) {
        return res.status(404).json({ message: "Annotation not found" });
      }

      res.json(annotation);
    } catch (error) {
      console.error("Error updating annotation:", error);
      res.status(500).json({ message: "Failed to update annotation" });
    }
  });

  // Delete annotation
  app.delete("/api/annotations/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      await storage.deleteAnnotation(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting annotation:", error);
      res.status(500).json({ message: "Failed to delete annotation" });
    }
  });

  // Search document
  app.post("/api/documents/:id/search", requireAuth, async (req: Request, res: Response) => {
    try {
      const { query } = req.body;

      if (!query || typeof query !== "string") {
        return res.status(400).json({ message: "Query is required" });
      }

      const doc = await storage.getDocument(req.params.id);
      if (!doc) {
        return res.status(404).json({ message: "Document not found" });
      }

      // Get chunks with embeddings
      const chunks = await storage.getChunksForDocument(doc.id);
      
      // Generate query embedding
      const queryEmbedding = await getEmbedding(query);

      // Rank chunks by similarity
      const rankedChunks = chunks
        .filter((c) => c.embedding)
        .map((chunk) => ({
          text: chunk.text,
          startPosition: chunk.startPosition,
          endPosition: chunk.endPosition,
          similarity: cosineSimilarity(chunk.embedding!, queryEmbedding),
        }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 5);

      if (rankedChunks.length === 0) {
        return res.json([]);
      }

      // Use LLM to find relevant quotes
      const results = await searchDocument(
        query,
        doc.userIntent || "",
        rankedChunks
      );

      res.json(results);
    } catch (error) {
      console.error("Search error:", error);
      res.status(500).json({ message: error instanceof Error ? error.message : "Search failed" });
    }
  });

  // Get document summary
  app.get("/api/documents/:id/summary", requireAuth, async (req: Request, res: Response) => {
    try {
      const doc = await storage.getDocument(req.params.id);
      if (!doc) {
        return res.status(404).json({ message: "Document not found" });
      }

      res.json({
        summary: doc.summary,
        mainArguments: doc.mainArguments,
        keyConcepts: doc.keyConcepts,
      });
    } catch (error) {
      console.error("Error fetching summary:", error);
      res.status(500).json({ message: "Failed to fetch summary" });
    }
  });

  // Register project routes
  registerProjectRoutes(app);
  registerWebClipRoutes(app);

  // Register chat routes
  registerChatRoutes(app);

  // Register analytics routes (admin-only)
  registerAnalyticsRoutes(app);

  // Register writing pipeline routes
  registerWritingRoutes(app);

  // Register humanizer routes
  registerHumanizerRoutes(app);

  // Register extension routes (Chrome extension API)
  registerExtensionRoutes(app);

  // Register A/B test routes
  // registerABTestRoutes(app); // TODO: Not implemented yet

  return httpServer;
}
