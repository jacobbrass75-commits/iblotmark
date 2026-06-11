import type { Express, Request, Response } from "express";
import { randomBytes, randomUUID, createHash } from "crypto";
import { requireAuth } from "./auth";
import { getUserById, sanitizeUser } from "./authStorage";
import { db } from "./db";
import { apiKeys } from "@shared/schema";
import { and, eq, isNull } from "drizzle-orm";

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function createRawApiKey(): string {
  return `sk_sm_${randomBytes(32).toString("base64url")}`;
}

function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

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

  // POST /api/auth/api-keys - Create a long-lived API key for MCP/automation use
  app.post("/api/auth/api-keys", requireAuth, async (req: Request, res: Response) => {
    try {
      const rawKey = createRawApiKey();
      const keyPrefix = rawKey.slice(0, 14);
      const label = typeof req.body?.label === "string" ? req.body.label.trim() : null;
      const createdAt = nowSeconds();

      const [created] = await db.insert(apiKeys).values({
        id: randomUUID(),
        userId: req.user!.userId,
        label: label || null,
        keyHash: hashApiKey(rawKey),
        keyPrefix,
        createdAt,
      }).returning();

      return res.status(201).json({
        id: created.id,
        key: rawKey,
        prefix: keyPrefix,
        label: created.label,
        createdAt: created.createdAt,
      });
    } catch (error) {
      console.error("Create API key error:", error);
      return res.status(500).json({ message: "Failed to create API key" });
    }
  });

  // GET /api/auth/api-keys - List non-revoked API keys without exposing secrets
  app.get("/api/auth/api-keys", requireAuth, async (req: Request, res: Response) => {
    try {
      const rows = await db
        .select()
        .from(apiKeys)
        .where(and(eq(apiKeys.userId, req.user!.userId), isNull(apiKeys.revokedAt)));

      return res.json({
        keys: rows.map((row) => ({
          id: row.id,
          prefix: row.keyPrefix,
          label: row.label,
          lastUsedAt: row.lastUsedAt,
          createdAt: row.createdAt,
        })),
      });
    } catch (error) {
      console.error("List API keys error:", error);
      return res.status(500).json({ message: "Failed to list API keys" });
    }
  });

  // DELETE /api/auth/api-keys/:id - Revoke an API key owned by the current user
  app.delete("/api/auth/api-keys/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const revokedAt = nowSeconds();
      const [updated] = await db
        .update(apiKeys)
        .set({ revokedAt })
        .where(and(eq(apiKeys.id, req.params.id), eq(apiKeys.userId, req.user!.userId)))
        .returning();

      if (!updated) {
        return res.status(404).json({ message: "API key not found" });
      }

      return res.json({ success: true, revokedAt });
    } catch (error) {
      console.error("Revoke API key error:", error);
      return res.status(500).json({ message: "Failed to revoke API key" });
    }
  });
}
