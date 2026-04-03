// Cache management API routes
// Exposes cache status and invalidation endpoints.

import { Router, type Request, type Response } from "express";
import { getSystemStatus, cache } from "./apiCache";

export function registerCacheRoutes(app: { use: (path: string, router: Router) => void }) {
  const router = Router();

  // GET /api/cache/status — Returns cache stats + rate limiter status
  router.get("/status", (_req: Request, res: Response) => {
    try {
      const status = getSystemStatus();
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/cache/invalidate — Invalidate cache entries matching a pattern
  router.post("/invalidate", (req: Request, res: Response) => {
    try {
      const { pattern } = req.body;
      if (!pattern || typeof pattern !== "string") {
        return res.status(400).json({ error: "pattern is required (string)" });
      }
      const invalidated = cache.invalidate(pattern);
      res.json({ pattern, invalidated });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.use("/api/cache", router);
}
