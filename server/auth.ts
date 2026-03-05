import type { Express, Request, Response, NextFunction } from "express";
import { clerkMiddleware, getAuth, clerkClient } from "@clerk/express";
import { createHash } from "crypto";
import { getOrCreateUser, getUserById } from "./authStorage";
import { sqlite } from "./db";

// Extend Express Request to include user property (same shape as before)
declare global {
  namespace Express {
    interface User {
      userId: string;
      email: string;
      tier: string;
    }
  }
}

// ── Tier hierarchy ──────────────────────────────────────────────────
const TIER_LEVELS: Record<string, number> = { free: 0, pro: 1, max: 2 };

const TIER_TOKEN_LIMITS: Record<string, number> = {
  free: 50_000,
  pro: 500_000,
  max: 2_000_000,
};

const TIER_STORAGE_LIMITS: Record<string, number> = {
  free: 52_428_800,       // 50 MB
  pro: 524_288_000,       // 500 MB
  max: 5_368_709_120,     // 5 GB
};

interface ApiKeyRow {
  id: string;
  user_id: string;
}

interface McpTokenRow {
  id: string;
  user_id: string;
  expires_at: number | null;
}

type ApiKeyAuthResult =
  | { status: "none" }
  | { status: "invalid" }
  | { status: "success"; user: Express.User };

const selectApiKeyByHash = sqlite.prepare(
  `SELECT id, user_id
   FROM api_keys
   WHERE key_hash = ?
     AND revoked_at IS NULL
   LIMIT 1`
);

const touchApiKeyLastUsed = sqlite.prepare(
  `UPDATE api_keys
   SET last_used_at = ?
   WHERE id = ?`
);

const selectMcpTokenByHash = sqlite.prepare(
  `SELECT id, user_id, expires_at
   FROM mcp_tokens
   WHERE key_hash = ?
     AND revoked_at IS NULL
   LIMIT 1`
);

const touchMcpTokenLastUsed = sqlite.prepare(
  `UPDATE mcp_tokens
   SET last_used_at = ?
   WHERE id = ?`
);

function getUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;

  const [scheme, token] = authHeader.split(/\s+/);
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }
  return token;
}

function shouldBypassClerk(req: Request): boolean {
  const token = extractBearerToken(req);
  if (!token) {
    return false;
  }

  return token.startsWith("sk_sm_") || token.startsWith("mcp_sm_");
}

async function resolveApiKeyUser(req: Request): Promise<ApiKeyAuthResult> {
  const token = extractBearerToken(req);
  if (!token) {
    return { status: "none" };
  }

  const keyHash = hashApiKey(token);
  const now = getUnixSeconds();

  if (token.startsWith("sk_sm_")) {
    const keyRow = selectApiKeyByHash.get(keyHash) as ApiKeyRow | undefined;
    if (!keyRow) {
      return { status: "invalid" };
    }

    const dbUser = await getUserById(keyRow.user_id);
    if (!dbUser) {
      return { status: "invalid" };
    }

    touchApiKeyLastUsed.run(now, keyRow.id);

    return {
      status: "success",
      user: {
        userId: dbUser.id,
        email: dbUser.email,
        tier: dbUser.tier,
      },
    };
  }

  if (token.startsWith("mcp_sm_")) {
    const tokenRow = selectMcpTokenByHash.get(keyHash) as McpTokenRow | undefined;
    if (!tokenRow) {
      return { status: "invalid" };
    }
    if (tokenRow.expires_at !== null && tokenRow.expires_at <= now) {
      return { status: "invalid" };
    }

    const dbUser = await getUserById(tokenRow.user_id);
    if (!dbUser) {
      return { status: "invalid" };
    }

    touchMcpTokenLastUsed.run(now, tokenRow.id);

    return {
      status: "success",
      user: {
        userId: dbUser.id,
        email: dbUser.email,
        tier: dbUser.tier,
      },
    };
  }

  return { status: "none" };
}

// ── Install Clerk middleware globally ────────────────────────────────
export function configureClerk(app: Express): void {
  const clerk = clerkMiddleware();
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (shouldBypassClerk(req)) {
      next();
      return;
    }
    clerk(req, res, next);
  });
}

// ── Resolve Clerk user → local DB user, set req.user ────────────────
async function resolveUser(req: Request): Promise<Express.User | null> {
  const auth = getAuth(req);
  if (!auth?.userId) return null;

  // Get Clerk user details for email + metadata
  const clerkUser = await clerkClient.users.getUser(auth.userId);
  const email = clerkUser.emailAddresses?.[0]?.emailAddress ?? "";
  // TODO: revert to "free" default when leaving testing phase
  const tier = (clerkUser.publicMetadata?.tier as string) || "max";

  // Ensure a local DB row exists (for usage tracking)
  await getOrCreateUser(auth.userId, email, tier);

  return { userId: auth.userId, email, tier };
}

// ── Middleware: requires a valid Clerk session ───────────────────────
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const apiKeyResult = await resolveApiKeyUser(req);
    if (apiKeyResult.status === "success") {
      req.user = apiKeyResult.user;
      next();
      return;
    }
    if (apiKeyResult.status === "invalid") {
      res.status(401).json({ message: "Invalid API key" });
      return;
    }

    const user = await resolveUser(req);
    if (!user) {
      res.status(401).json({ message: "Authentication required" });
      return;
    }
    req.user = user;
    next();
  } catch (err) {
    console.error("Auth error:", err);
    res.status(401).json({ message: "Authentication failed" });
  }
}

// ── Middleware: attaches user if present, doesn't reject ─────────────
export async function optionalAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await resolveUser(req);
    if (user) req.user = user;
  } catch {
    // silently ignore
  }
  next();
}

// ── Middleware: require minimum tier ─────────────────────────────────
export function requireTier(minTier: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userTier = req.user?.tier ?? "free";
    const userLevel = TIER_LEVELS[userTier] ?? 0;
    const requiredLevel = TIER_LEVELS[minTier] ?? 0;

    if (userLevel < requiredLevel) {
      res.status(403).json({
        message: `This feature requires the ${minTier} plan`,
        requiredTier: minTier,
        currentTier: userTier,
      });
      return;
    }
    next();
  };
}

// ── Middleware: check monthly token budget ───────────────────────────
export function checkTokenBudget(req: Request, res: Response, next: NextFunction): void {
  // Actual check happens in the AI call handlers where token counts are known.
  // This is a placeholder hook — usage is tracked via authStorage.incrementTokenUsage().
  next();
}

// ── Helper exports for route handlers ───────────────────────────────
export { TIER_LEVELS, TIER_TOKEN_LIMITS, TIER_STORAGE_LIMITS };
