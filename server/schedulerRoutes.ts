// Scheduler API routes — control the autonomous blog engine

import { Router, type Request, type Response } from "express";
import { scheduler } from "./scheduler";

export function registerSchedulerRoutes(app: { use: (path: string, router: Router) => void }) {
  const router = Router();

  // GET /api/blog/scheduler/status — Get scheduler status and stats
  router.get("/status", async (_req: Request, res: Response) => {
    try {
      const status = await scheduler.getStatus();
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/blog/scheduler/start — Start the scheduler
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

  // POST /api/blog/scheduler/stop — Stop the scheduler
  router.post("/stop", async (_req: Request, res: Response) => {
    try {
      scheduler.stop();
      const status = await scheduler.getStatus();
      res.json({ message: "Scheduler stopped", ...status });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // PATCH /api/blog/scheduler/config — Update scheduler configuration
  router.patch("/config", async (req: Request, res: Response) => {
    try {
      scheduler.updateConfig(req.body);
      const status = await scheduler.getStatus();
      res.json({ message: "Config updated", ...status });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/blog/scheduler/trigger/research — Manually trigger research
  router.post("/trigger/research", async (_req: Request, res: Response) => {
    try {
      res.json({ message: "Research triggered", ...(await scheduler.triggerResearch()) });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/blog/scheduler/trigger/products — Manually trigger product sync
  router.post("/trigger/products", async (_req: Request, res: Response) => {
    try {
      res.json({ message: "Product sync triggered", ...(await scheduler.triggerProductSync()) });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/blog/scheduler/trigger/generate — Manually trigger auto-generation
  router.post("/trigger/generate", async (_req: Request, res: Response) => {
    try {
      res.json({ message: "Auto-generate triggered", ...(await scheduler.triggerAutoGenerate()) });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/blog/scheduler/trigger/photos — Manually trigger photo analysis
  router.post("/trigger/photos", async (_req: Request, res: Response) => {
    try {
      res.json({ message: "Photo injection triggered", ...(await scheduler.triggerPhotoAnalysis()) });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/blog/scheduler/trigger/chunks — Manually trigger chunk rebuild
  router.post("/trigger/chunks", async (_req: Request, res: Response) => {
    try {
      res.json({ message: "Chunk rebuild triggered", ...(await scheduler.triggerChunkRebuild()) });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.use("/api/blog/scheduler", router);
}
