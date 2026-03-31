// Catalog import API routes

import { Router, type Request, type Response } from "express";
import multer from "multer";
import { importCatalog, getCatalogImports, getCatalogExtractions } from "./catalogImporter";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

export function registerCatalogRoutes(app: { use: (path: string, router: Router) => void }) {
  const router = Router();

  // POST /api/blog/catalog/import — Upload and import a PDF catalog
  router.post("/import", upload.single("file"), async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No PDF file uploaded" });

      // SSE for progress
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const sendEvent = (msg: string) => {
        res.write(`data: ${JSON.stringify({ message: msg })}\n\n`);
      };

      const result = await importCatalog(file.buffer, file.originalname, sendEvent);
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

  // POST /api/blog/catalog/import-file — Import from a local file path
  router.post("/import-file", async (req: Request, res: Response) => {
    try {
      const { filePath } = req.body;
      if (!filePath) return res.status(400).json({ error: "filePath is required" });

      const fs = await import("fs/promises");
      const path = await import("path");
      const buffer = await fs.readFile(filePath);
      const filename = path.basename(filePath);

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const sendEvent = (msg: string) => {
        res.write(`data: ${JSON.stringify({ message: msg })}\n\n`);
      };

      const result = await importCatalog(Buffer.from(buffer), filename, sendEvent);
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

  // GET /api/blog/catalog/imports — List all imports
  router.get("/imports", async (_req: Request, res: Response) => {
    try {
      res.json(await getCatalogImports());
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/blog/catalog/imports/:id/extractions — List extractions for an import
  router.get("/imports/:id/extractions", async (req: Request, res: Response) => {
    try {
      res.json(await getCatalogExtractions(req.params.id));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.use("/api/blog/catalog", router);
}
