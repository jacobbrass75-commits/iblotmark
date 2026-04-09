// Scheduler API routes â€” control the autonomous blog engine

import { Router, type Request, type Response } from "express";
import { scheduler } from "./scheduler";

export function registerSchedulerRoutes(app: { use: (path: string, router: Router) => void }) {
  const router = Router();

  router.get("/status", async (_req: Request, res: Response) => {
    try {
      const status = await scheduler.getStatus();
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/start", async (req: Request, res: Response) => {
    try {
      const config = req.body || {};
      scheduler.updateConfig({ ...config, enabled: true });
      const status = await scheduler.getStatus();
      res.json({ message: "Scheduler started", ...status });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/stop", async (_req: Request, res: Response) => {
    try {
      scheduler.stop();
      const status = await scheduler.getStatus();
      res.json({ message: "Scheduler stopped", ...status });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch("/config", async (req: Request, res: Response) => {
    try {
      scheduler.updateConfig(req.body);
      const status = await scheduler.getStatus();
      res.json({ message: "Config updated", ...status });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/trigger/research", async (_req: Request, res: Response) => {
    try {
      res.json({ message: "Research triggered", ...(await scheduler.triggerResearch()) });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/trigger/products", async (_req: Request, res: Response) => {
    try {
      res.json({ message: "Product sync triggered", ...(await scheduler.triggerProductSync()) });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/trigger/generate", async (_req: Request, res: Response) => {
    try {
      res.json({ message: "Auto-generate triggered", ...(await scheduler.triggerAutoGenerate()) });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/trigger/excerpts", async (req: Request, res: Response) => {
    try {
      const { postId } = req.body || {};
      res.json({ message: "Excerpt generation triggered", ...(await scheduler.triggerExcerptGeneration(postId)) });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/trigger/photos", async (req: Request, res: Response) => {
    try {
      const { postId } = req.body || {};
      res.json({ message: "Photo injection triggered", ...(await scheduler.triggerPhotoAnalysis(postId)) });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/trigger/full_publish", async (req: Request, res: Response) => {
    try {
      const { postId } = req.body || {};
      if (!postId) {
        return res.status(400).json({ error: "postId is required" });
      }
      res.json({ message: "Full publish triggered", ...(await scheduler.triggerFullPublish(postId)) });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/trigger/chunks", async (_req: Request, res: Response) => {
    try {
      res.json({ message: "Chunk rebuild triggered", ...(await scheduler.triggerChunkRebuild()) });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.use("/api/blog/scheduler", router);
}
