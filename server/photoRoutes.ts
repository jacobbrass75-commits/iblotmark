// Photo bank API routes

import { Router, type Request, type Response } from "express";
import multer from "multer";
import { existsSync } from "fs";
import {
  storePhoto,
  importFromDirectory,
  analyzePhoto,
  batchAnalyzePhotos,
  autoAssociatePhotos,
  getPhotos,
  getPhoto,
  getPhotoStats,
  updatePhotoMetadata,
  deletePhoto,
} from "./photoBank";
import { getCompanyIdFromRequest, requireBlogMutationRole } from "./companyContext";
import { resolveAllowedLocalImportDirectory } from "./localImportGuards";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function directoryImportsAllowed(): boolean {
  const explicit = process.env.BLOG_ALLOW_LOCAL_PHOTO_IMPORTS || "";
  if (["1", "true", "yes", "on"].includes(explicit.toLowerCase())) return true;
  return process.env.NODE_ENV !== "production";
}

export function registerPhotoRoutes(app: { use: (path: string, router: Router) => void }) {
  const router = Router();
  router.use(requireBlogMutationRole("editor"));

  // POST /api/blog/photos/upload — Upload photos (multipart, multiple files)
  router.post("/upload", upload.array("files", 50), async (req: Request, res: Response) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) return res.status(400).json({ error: "No files uploaded" });
      const productId = req.body.productId || undefined;

      const results = [];
      const companyId = getCompanyIdFromRequest(req);
      for (const file of files) {
        const result = await storePhoto(file.buffer, file.originalname, file.mimetype, productId, companyId);
        results.push(result);
      }

      res.json({ message: `Uploaded ${results.length} photos`, results });
    } catch (error: any) {
      const status = /not found|must be one of/i.test(error.message) ? 400 : 500;
      res.status(status).json({ error: error.message });
    }
  });

  // POST /api/blog/photos/import-directory — Import all photos from a local directory
  router.post("/import-directory", async (req: Request, res: Response) => {
    try {
      if (!directoryImportsAllowed()) {
        return res.status(403).json({ error: "Local directory imports are disabled in this environment" });
      }

      const { dirPath } = req.body;
      if (!dirPath) return res.status(400).json({ error: "dirPath is required" });
      const resolvedDir = await resolveAllowedLocalImportDirectory(dirPath);

      // SSE for progress
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const sendEvent = (msg: string) => {
        res.write(`data: ${JSON.stringify({ message: msg })}\n\n`);
      };

      const result = await importFromDirectory(resolvedDir, sendEvent, getCompanyIdFromRequest(req));
      res.write(`event: completed\ndata: ${JSON.stringify(result)}\n\n`);
      res.end();
    } catch (error: any) {
      if (!res.headersSent) {
        const status = /dirPath|import directory/i.test(error.message) ? 400 : 500;
        res.status(status).json({ error: error.message });
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
      }
    }
  });

  // POST /api/blog/photos/:id/analyze — Analyze a single photo with AI vision
  router.post("/:id/analyze", async (req: Request, res: Response) => {
    try {
      const analysis = await analyzePhoto(req.params.id, getCompanyIdFromRequest(req));
      res.json(analysis);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/blog/photos/batch-analyze — Analyze unanalyzed photos
  router.post("/batch-analyze", async (req: Request, res: Response) => {
    try {
      const limit = req.body.limit || 20;

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const sendEvent = (msg: string) => {
        res.write(`data: ${JSON.stringify({ message: msg })}\n\n`);
      };

      const result = await batchAnalyzePhotos(limit, sendEvent, getCompanyIdFromRequest(req));
      res.write(`event: completed\ndata: ${JSON.stringify(result)}\n\n`);
      res.end();
    } catch (error: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
      }
    }
  });

  // POST /api/blog/photos/auto-associate — AI matches unassigned photos to products
  router.post("/auto-associate", async (req: Request, res: Response) => {
    try {
      const result = await autoAssociatePhotos(getCompanyIdFromRequest(req));
      res.json({ message: `Associated ${result.associated} photos`, ...result });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/blog/photos — List all photos
  router.get("/", async (req: Request, res: Response) => {
    try {
      const productId = req.query.productId as string | undefined;
      res.json(await getPhotos(productId, getCompanyIdFromRequest(req)));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/blog/photos/stats — Photo stats
  router.get("/stats", async (req: Request, res: Response) => {
    try {
      res.json(await getPhotoStats(getCompanyIdFromRequest(req)));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // PATCH /api/blog/photos/:id — Update reusable asset metadata
  router.patch("/:id", async (req: Request, res: Response) => {
    try {
      const photo = await updatePhotoMetadata(req.params.id, req.body || {}, getCompanyIdFromRequest(req));
      res.json(photo);
    } catch (error: any) {
      const status = /not found/i.test(error.message) ? 404 : 400;
      res.status(status).json({ error: error.message });
    }
  });

  // GET /api/blog/photos/:id — Single photo details
  router.get("/:id", async (req: Request, res: Response) => {
    try {
      const photo = await getPhoto(req.params.id, getCompanyIdFromRequest(req));
      if (!photo) return res.status(404).json({ error: "Photo not found" });
      res.json(photo);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/blog/photos/serve/:id — Serve the actual image file
  router.get("/serve/:id", async (req: Request, res: Response) => {
    try {
      const photo = await getPhoto(req.params.id, getCompanyIdFromRequest(req));
      if (!photo) return res.status(404).json({ error: "Photo not found" });
      res.sendFile(photo.filePath, { root: process.cwd() });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/blog/photos/thumb/:id — Serve thumbnail
  router.get("/thumb/:id", async (req: Request, res: Response) => {
    try {
      const photo = await getPhoto(req.params.id, getCompanyIdFromRequest(req));
      if (!photo) return res.status(404).json({ error: "Thumbnail not found" });
      const filePath = photo.thumbnailPath && existsSync(photo.thumbnailPath)
        ? photo.thumbnailPath
        : photo.filePath;
      res.sendFile(filePath, { root: process.cwd() });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /api/blog/photos/:id — Delete a photo
  router.delete("/:id", async (req: Request, res: Response) => {
    try {
      await deletePhoto(req.params.id, getCompanyIdFromRequest(req));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.use("/api/blog/photos", router);
}
