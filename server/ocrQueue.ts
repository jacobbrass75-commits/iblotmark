import { randomUUID } from "crypto";
import { readFile } from "fs/promises";
import {
  extractImageUploadsFromZip,
  processImageGroupWithVisionOcr,
  processImageWithVisionOcr,
  processWithPaddleOcr,
  processWithVisionOcr,
  saveTempUpload,
  SUPPORTED_VISION_OCR_MODELS,
  type VisionOcrModel,
} from "./ocrProcessor";
import { getDocumentSourcePath } from "./sourceFiles";
import { sqlite } from "./db";
import { storage } from "./storage";

type OcrJobType = "pdf" | "image" | "image_bundle";
type OcrJobStatus = "queued" | "running" | "completed" | "failed";
type PdfOcrMode = "advanced" | "vision" | "vision_batch";
type ImageOcrMode = "vision" | "vision_batch";

interface OcrJobPayload {
  sourceFilename: string;
  ocrMode: PdfOcrMode | ImageOcrMode;
  ocrModel?: VisionOcrModel;
}

interface OcrJobRow {
  id: string;
  document_id: string;
  job_type: OcrJobType;
  status: OcrJobStatus;
  payload: string;
  attempt_count: number;
  max_attempts: number;
}

interface OcrPageResultRow {
  page_number: number;
  text: string;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

const OCR_JOB_MAX_ATTEMPTS = parsePositiveInt(process.env.OCR_JOB_MAX_ATTEMPTS, 3);

let workerInitialized = false;
let workerRunning = false;

const selectNextQueuedJob = sqlite.prepare(
  `SELECT id, document_id, job_type, status, payload, attempt_count, max_attempts
   FROM ocr_jobs
   WHERE status = 'queued'
   ORDER BY created_at ASC
   LIMIT 1`
);

const markJobRunning = sqlite.prepare(
  `UPDATE ocr_jobs
   SET status = 'running',
       attempt_count = attempt_count + 1,
       started_at = ?,
       updated_at = ?
   WHERE id = ? AND status = 'queued'`
);

const markJobCompleted = sqlite.prepare(
  `UPDATE ocr_jobs
   SET status = 'completed',
       updated_at = ?,
       finished_at = ?
   WHERE id = ?`
);

const markJobQueued = sqlite.prepare(
  `UPDATE ocr_jobs
   SET status = 'queued',
       updated_at = ?,
       last_error = ?
   WHERE id = ?`
);

const markJobFailed = sqlite.prepare(
  `UPDATE ocr_jobs
   SET status = 'failed',
       updated_at = ?,
       finished_at = ?,
       last_error = ?
   WHERE id = ?`
);

const selectJobPageResults = sqlite.prepare(
  `SELECT page_number, text
   FROM ocr_page_results
   WHERE job_id = ?
   ORDER BY page_number ASC`
);

const updateJobPageResult = sqlite.prepare(
  `UPDATE ocr_page_results
   SET text = ?,
       updated_at = ?
   WHERE job_id = ?
     AND page_number = ?`
);

const insertJobPageResult = sqlite.prepare(
  `INSERT INTO ocr_page_results (
     id,
     job_id,
     document_id,
     page_number,
     text,
     created_at,
     updated_at
   ) VALUES (?, ?, ?, ?, ?, ?, ?)`
);

const deleteJobPageResults = sqlite.prepare(
  `DELETE FROM ocr_page_results WHERE job_id = ?`
);

function getUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function normalizeVisionModel(model: string | undefined): VisionOcrModel {
  const normalized = (model || "").toLowerCase();
  if (SUPPORTED_VISION_OCR_MODELS.includes(normalized as VisionOcrModel)) {
    return normalized as VisionOcrModel;
  }
  return "gpt-4o";
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "Background OCR processing failed.";
}

function loadPageCheckpoints(jobId: string): string[] {
  const rows = selectJobPageResults.all(jobId) as OcrPageResultRow[];
  const pageTexts: string[] = [];
  for (const row of rows) {
    if (!Number.isFinite(row.page_number) || row.page_number < 1) continue;
    pageTexts[row.page_number - 1] = row.text ?? "";
  }
  return pageTexts;
}

function persistPageCheckpoint(
  jobId: string,
  documentId: string,
  pageNumber: number,
  text: string
): void {
  if (!Number.isFinite(pageNumber) || pageNumber < 1) return;
  const now = getUnixSeconds();
  const normalizedPageNumber = Math.floor(pageNumber);
  const updated = updateJobPageResult.run(
    text,
    now,
    jobId,
    normalizedPageNumber
  );
  if (updated.changes > 0) return;

  insertJobPageResult.run(
    randomUUID(),
    jobId,
    documentId,
    normalizedPageNumber,
    text,
    now,
    now
  );
}

function validatePayload(jobType: OcrJobType, payload: unknown): OcrJobPayload {
  const candidate = payload as Partial<OcrJobPayload> | undefined;
  if (!candidate || typeof candidate.sourceFilename !== "string" || !candidate.sourceFilename.trim()) {
    throw new Error("Missing source filename in OCR job payload.");
  }

  const mode = candidate.ocrMode;
  if (jobType === "pdf") {
    if (mode !== "advanced" && mode !== "vision" && mode !== "vision_batch") {
      throw new Error(`Unsupported PDF OCR mode in job payload: ${String(mode)}`);
    }
  } else if (mode !== "vision" && mode !== "vision_batch") {
    throw new Error(`Unsupported image OCR mode in job payload: ${String(mode)}`);
  }

  return {
    sourceFilename: candidate.sourceFilename,
    ocrMode: mode,
    ocrModel: normalizeVisionModel(candidate.ocrModel),
  };
}

function claimNextQueuedJob(): OcrJobRow | null {
  const row = selectNextQueuedJob.get() as OcrJobRow | undefined;
  if (!row) return null;

  const now = getUnixSeconds();
  const result = markJobRunning.run(now, now, row.id);
  if (result.changes === 0) {
    return null;
  }

  return {
    ...row,
    status: "running",
    attempt_count: row.attempt_count + 1,
  };
}

async function runJob(job: OcrJobRow): Promise<void> {
  const parsedPayload = JSON.parse(job.payload) as unknown;
  const payload = validatePayload(job.job_type, parsedPayload);
  const checkpointedPageTexts = loadPageCheckpoints(job.id);

  const sourcePath = getDocumentSourcePath(job.document_id, payload.sourceFilename);
  const sourceBuffer = await readFile(sourcePath);

  await storage.updateDocument(job.document_id, {
    status: "processing",
    processingError: null,
  });

  if (job.job_type === "image_bundle") {
    const uploads = await extractImageUploadsFromZip(sourceBuffer);
    await processImageGroupWithVisionOcr(
      job.document_id,
      uploads,
      payload.sourceFilename,
      {
        batchMode: payload.ocrMode === "vision_batch",
        model: normalizeVisionModel(payload.ocrModel),
        existingPageTexts: checkpointedPageTexts,
        onPageProcessed: async (pageNumber, text) => {
          persistPageCheckpoint(job.id, job.document_id, pageNumber, text);
        },
        skipSourceSave: true,
      }
    );
  } else {
    const tempSourcePath = await saveTempUpload(sourceBuffer, payload.sourceFilename);
    if (job.job_type === "pdf") {
      if (payload.ocrMode === "advanced") {
        await processWithPaddleOcr(job.document_id, tempSourcePath);
      } else {
        await processWithVisionOcr(job.document_id, tempSourcePath, {
          batchMode: payload.ocrMode === "vision_batch",
          model: normalizeVisionModel(payload.ocrModel),
          existingPageTexts: checkpointedPageTexts,
          onPageProcessed: async (pageNumber, text) => {
            persistPageCheckpoint(job.id, job.document_id, pageNumber, text);
          },
        });
      }
    } else {
      await processImageWithVisionOcr(job.document_id, tempSourcePath, payload.sourceFilename, {
        batchMode: payload.ocrMode === "vision_batch",
        model: normalizeVisionModel(payload.ocrModel),
        existingPageTexts: checkpointedPageTexts,
        onPageProcessed: async (pageNumber, text) => {
          persistPageCheckpoint(job.id, job.document_id, pageNumber, text);
        },
      });
    }
  }

  const updatedDoc = await storage.getDocument(job.document_id);
  if (!updatedDoc) {
    throw new Error("Document no longer exists.");
  }
  if (updatedDoc.status !== "ready") {
    throw new Error(updatedDoc.processingError || "OCR processing did not finish successfully.");
  }
}

async function processQueue(): Promise<void> {
  if (workerRunning) return;
  workerRunning = true;

  try {
    while (true) {
      const job = claimNextQueuedJob();
      if (!job) break;

      try {
        await runJob(job);
        const now = getUnixSeconds();
        markJobCompleted.run(now, now, job.id);
        deleteJobPageResults.run(job.id);
      } catch (error) {
        const message = toErrorMessage(error);
        const now = getUnixSeconds();
        const shouldRetry = job.attempt_count < job.max_attempts;

        if (shouldRetry) {
          markJobQueued.run(now, message, job.id);
          await storage.updateDocument(job.document_id, {
            status: "processing",
            processingError: null,
          });
          continue;
        }

        markJobFailed.run(now, now, message, job.id);
        await storage.updateDocument(job.document_id, {
          status: "error",
          processingError: message,
        });
      }
    }
  } finally {
    workerRunning = false;
  }
}

function triggerQueueProcessing(): void {
  void processQueue();
}

async function recoverQueueStateOnStartup(): Promise<void> {
  const now = getUnixSeconds();

  // Any job that was running during a crash/restart should be retried.
  sqlite
    .prepare(
      `UPDATE ocr_jobs
       SET status = 'queued',
           updated_at = ?
       WHERE status = 'running'`
    )
    .run(now);

  // If a document is stuck in processing without an active queue job, mark it as failed.
  const orphanedDocs = sqlite
    .prepare(
      `SELECT d.id AS id
       FROM documents d
       LEFT JOIN ocr_jobs j
         ON j.document_id = d.id
        AND j.status IN ('queued', 'running')
       WHERE d.status = 'processing'
         AND j.id IS NULL`
    )
    .all() as Array<{ id: string }>;

  for (const row of orphanedDocs) {
    await storage.updateDocument(row.id, {
      status: "error",
      processingError: "Processing job could not be resumed after restart. Please re-upload.",
    });
  }
}

interface EnqueueOcrJobInput {
  documentId: string;
  sourceFilename: string;
  ocrMode: PdfOcrMode | ImageOcrMode;
  ocrModel?: VisionOcrModel;
  maxAttempts?: number;
}

function enqueueJob(jobType: OcrJobType, input: EnqueueOcrJobInput): void {
  const now = getUnixSeconds();
  const maxAttempts = Math.max(1, input.maxAttempts ?? OCR_JOB_MAX_ATTEMPTS);
  const payload: OcrJobPayload = {
    sourceFilename: input.sourceFilename,
    ocrMode: input.ocrMode,
    ocrModel: normalizeVisionModel(input.ocrModel),
  };

  try {
    sqlite
      .prepare(
        `INSERT INTO ocr_jobs (
           id,
           document_id,
           job_type,
           status,
           payload,
           max_attempts,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        input.documentId,
        jobType,
        JSON.stringify(payload),
        maxAttempts,
        now,
        now
      );
  } catch (error) {
    const message = toErrorMessage(error);
    if (message.includes("idx_ocr_jobs_document_active")) {
      throw new Error("An OCR job is already running for this document.");
    }
    throw error;
  }

  triggerQueueProcessing();
}

export async function initializeOcrQueue(): Promise<void> {
  if (workerInitialized) return;
  workerInitialized = true;
  await recoverQueueStateOnStartup();
  triggerQueueProcessing();
}

export async function enqueuePdfOcrJob(input: {
  documentId: string;
  sourceFilename: string;
  ocrMode: PdfOcrMode;
  ocrModel?: VisionOcrModel;
  maxAttempts?: number;
}): Promise<void> {
  enqueueJob("pdf", input);
}

export async function enqueueImageOcrJob(input: {
  documentId: string;
  sourceFilename: string;
  ocrMode: ImageOcrMode;
  ocrModel?: VisionOcrModel;
  maxAttempts?: number;
}): Promise<void> {
  enqueueJob("image", input);
}

export async function enqueueImageBundleOcrJob(input: {
  documentId: string;
  sourceFilename: string;
  ocrMode: ImageOcrMode;
  ocrModel?: VisionOcrModel;
  maxAttempts?: number;
}): Promise<void> {
  enqueueJob("image_bundle", input);
}
