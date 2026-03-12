import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { getUserById, sanitizeUser } from "./authStorage";

export function registerAuthRoutes(app: Express): void {
  // GET /api/auth/me - Return current user profile
  app.get("/api/auth/me", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await getUserById(req.user!.userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      return res.json(sanitizeUser(user));
    } catch (error) {
      console.error("Get profile error:", error);
      return res.status(500).json({ message: "Failed to fetch profile" });
    }
  });

  // GET /api/auth/usage - Return token usage, storage usage, limits
  app.get("/api/auth/usage", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await getUserById(req.user!.userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const tokenPercent = user.tokenLimit > 0
        ? Math.round((user.tokensUsed / user.tokenLimit) * 100)
        : 0;
      const storagePercent = user.storageLimit > 0
        ? Math.round((user.storageUsed / user.storageLimit) * 100)
        : 0;

      return res.json({
        tokensUsed: user.tokensUsed,
        tokenLimit: user.tokenLimit,
        tokenPercent,
        storageUsed: user.storageUsed,
        storageLimit: user.storageLimit,
        storagePercent,
        tier: user.tier,
        billingCycleStart: user.billingCycleStart
          ? (user.billingCycleStart as any).toISOString?.() ?? user.billingCycleStart
          : null,
      });
    } catch (error) {
      console.error("Usage error:", error);
      return res.status(500).json({ message: "Failed to fetch usage" });
    }
  });
}
