// Keyword management API routes
// CSV import, clustering, and keyword/cluster queries.

import { Router, type Request, type Response } from "express";
import multer from "multer";
import { importKeywordCSV, clusterKeywords, getKeywords, getClusters, getImports } from "./keywordManager";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export function registerKeywordRoutes(app: { use: (path: string, router: Router) => void }) {
  const router = Router();

  // POST /api/blog/keywords/import — Upload and import a keyword CSV
  router.post("/import", upload.single("file"), async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: "No CSV file uploaded" });
      }

      const csvText = file.buffer.toString("utf-8");
      const result = await importKeywordCSV(csvText, file.originalname);

      res.json({
        message: `Imported ${result.new_} new keywords (${result.duplicates} duplicates updated)`,
        ...result,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/blog/keywords/import-file — Import from a local file path
  router.post("/import-file", async (req: Request, res: Response) => {
    try {
      const { filePath } = req.body;
      if (!filePath) {
        return res.status(400).json({ error: "filePath is required" });
      }

      const fs = await import("fs/promises");
      const path = await import("path");
      const csvText = await fs.readFile(filePath, "utf-8");
      const filename = path.basename(filePath);
      const result = await importKeywordCSV(csvText, filename);

      res.json({
        message: `Imported ${result.new_} new keywords (${result.duplicates} duplicates updated)`,
        ...result,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/blog/keywords/cluster — Run AI clustering on unclustered keywords
  router.post("/cluster", async (_req: Request, res: Response) => {
    try {
      const result = await clusterKeywords();
      res.json({
        message: `Created ${result.clusters} clusters, assigned ${result.keywordsAssigned} keywords`,
        ...result,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/blog/keywords — List all keywords
  router.get("/", async (req: Request, res: Response) => {
    try {
      const status = req.query.status as string | undefined;
      const kws = await getKeywords(status);
      res.json(kws);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/blog/keywords/clusters — List all clusters with keywords
  router.get("/clusters", async (_req: Request, res: Response) => {
    try {
      const clusters = await getClusters();
      res.json(clusters);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/blog/keywords/imports — List import history
  router.get("/imports", async (_req: Request, res: Response) => {
    try {
      const imports = await getImports();
      res.json(imports);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.use("/api/blog/keywords", router);
}
