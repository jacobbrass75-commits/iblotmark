// Scheduler API routes — control the autonomous blog engine

import { Router, type Request, type Response } from "express";
import { getConfiguredScheduler, normalizeSchedulerConfig, persistSchedulerConfig } from "./scheduler";
import { getCompanyIdFromRequest, requireBlogRole } from "./companyContext";
import { clearExpiredSchedulerLocks, listSchedulerJobRuns } from "./schedulerJobStore";

export function registerSchedulerRoutes(app: { use: (path: string, router: Router) => void }) {
  const router = Router();

  // GET /api/blog/scheduler/status — Get scheduler status and stats
  router.get("/status", async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      const status = await (await getConfiguredScheduler(companyId)).getStatus(companyId);
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/runs", async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      const limit = req.query.limit ? Number(req.query.limit) : 25;
      res.json({ runs: listSchedulerJobRuns(companyId, limit) });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/blog/scheduler/start — Start the scheduler
  router.post("/start", requireBlogRole("admin"), async (req: Request, res: Response) => {
    try {
      const config = req.body || {};
      const companyId = getCompanyIdFromRequest(req);
      const scheduler = await getConfiguredScheduler(companyId);
      const nextConfig = normalizeSchedulerConfig({ ...scheduler.getConfig(), ...config, enabled: true }, scheduler.getConfig());
      await persistSchedulerConfig(companyId, nextConfig);
      scheduler.replaceConfig(nextConfig, companyId);
      const status = await scheduler.getStatus(companyId);
      res.json({ message: "Scheduler started", ...status });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/blog/scheduler/stop — Stop the scheduler
  router.post("/stop", requireBlogRole("admin"), async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      const scheduler = await getConfiguredScheduler(companyId);
      const nextConfig = normalizeSchedulerConfig({ ...scheduler.getConfig(), enabled: false }, scheduler.getConfig());
      await persistSchedulerConfig(companyId, nextConfig);
      scheduler.replaceConfig(nextConfig, companyId);
      const status = await scheduler.getStatus(companyId);
      res.json({ message: "Scheduler stopped", ...status });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // PATCH /api/blog/scheduler/config — Update scheduler configuration
  router.patch("/config", requireBlogRole("admin"), async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      const scheduler = await getConfiguredScheduler(companyId);
      const nextConfig = normalizeSchedulerConfig({ ...scheduler.getConfig(), ...(req.body || {}) }, scheduler.getConfig());
      await persistSchedulerConfig(companyId, nextConfig);
      scheduler.replaceConfig(nextConfig, companyId);
      const status = await scheduler.getStatus(companyId);
      res.json({ message: "Config updated", ...status });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/blog/scheduler/trigger/research — Manually trigger research
  router.post("/trigger/research", requireBlogRole("admin"), async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      res.json({ message: "Research triggered", ...(await (await getConfiguredScheduler(companyId)).triggerResearch(companyId)) });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/blog/scheduler/trigger/products — Manually trigger product sync
  router.post("/trigger/products", requireBlogRole("admin"), async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      res.json({ message: "Product sync triggered", ...(await (await getConfiguredScheduler(companyId)).triggerProductSync(companyId)) });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/blog/scheduler/trigger/generate — Manually trigger auto-generation
  router.post("/trigger/generate", requireBlogRole("admin"), async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      res.json({ message: "Auto-generate triggered", ...(await (await getConfiguredScheduler(companyId)).triggerAutoGenerate(companyId)) });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/blog/scheduler/trigger/photos — Manually trigger photo analysis
  router.post("/trigger/photos", requireBlogRole("admin"), async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      res.json({ message: "Photo analysis triggered", ...(await (await getConfiguredScheduler(companyId)).triggerPhotoAnalysis(companyId)) });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/blog/scheduler/trigger/chunks — Manually trigger chunk rebuild
  router.post("/trigger/chunks", requireBlogRole("admin"), async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      res.json({ message: "Chunk rebuild triggered", ...(await (await getConfiguredScheduler(companyId)).triggerChunkRebuild(companyId)) });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/blog/scheduler/trigger/benchmark — Manually trigger AI benchmark
  router.post("/trigger/benchmark", requireBlogRole("admin"), async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      res.json({ message: "AI benchmark triggered", ...(await (await getConfiguredScheduler(companyId)).triggerBenchmark(companyId)) });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/locks/cleanup", requireBlogRole("admin"), async (req: Request, res: Response) => {
    try {
      res.json({ removed: clearExpiredSchedulerLocks(getCompanyIdFromRequest(req)) });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.use("/api/blog/scheduler", router);
}
