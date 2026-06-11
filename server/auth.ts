import type { Express, Request, Response, NextFunction } from "express";
import { clerkMiddleware, getAuth, clerkClient } from "@clerk/express";
import { createHash } from "crypto";
import jwt from "jsonwebtoken";
import type { User } from "@shared/schema";
import { getOrCreateUser, getUserById } from "./authStorage";
import { sqlite } from "./db";
import {
  TIER_LEVELS,
  TIER_STORAGE_LIMITS,
  TIER_TOKEN_LIMITS,
  normalizeUserTier,
} from "./authTiers";
import { DEFAULT_COMPANY_ID } from "./companyDefaults";

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

const JWT_SECRET = process.env.JWT_SECRET || "dev-jwt-secret-change-in-production-64chars-long-string-placeholder!!";
const JWT_EXPIRY = "7d";

interface ApiKeyRow {
  id: string;
  user_id: string;
}

interface McpTokenRow {
  id: string;
  user_id: string;
  expires_at: number | null;
}

export interface JwtPayload {
  userId: string;
  email: string;
  tier: string;
  iat: number;
  exp: number;
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

export function generateToken(user: Pick<User, "id" | "email" | "tier"> | Express.User): string {
  const userId = "id" in user ? user.id : user.userId;
  const email = user.email;
  const tier = user.tier;

  return jwt.sign({ userId, email, tier }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

function isStructuredJwt(token: string): boolean {
  return token.split(".").length === 3;
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

function isEnvEnabled(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value || "").toLowerCase());
}

function isEnvDisabled(value: string | undefined): boolean {
  return ["0", "false", "no", "off"].includes((value || "").toLowerCase());
}

function isLocalRuntime(): boolean {
  return process.env.NODE_ENV === "development";
}

function hasClerkKey(): boolean {
  return Boolean(process.env.CLERK_PUBLISHABLE_KEY || process.env.VITE_CLERK_PUBLISHABLE_KEY);
}

export function allowUnauthenticatedBlogAccess(): boolean {
  const explicit = process.env.IBOLT_BLOG_ALLOW_UNAUTHENTICATED;
  if (isEnvEnabled(explicit)) return isLocalRuntime();
  if (isEnvDisabled(explicit)) return false;
  return false;
}

function allowLocalInternalAuth(): boolean {
  if (isEnvEnabled(process.env.IBOLT_INTERNAL_AUTH_BYPASS)) return isLocalRuntime();
  if (isEnvDisabled(process.env.IBOLT_INTERNAL_AUTH_BYPASS)) return false;
  return isLocalRuntime() && !hasClerkKey();
}

async function getLocalInternalUser(): Promise<Express.User> {
  const user = await getOrCreateUser("local", "admin@iboltmounts.com", "max");
  ensureLocalDefaultCompanyMembership(user.id);
  return {
    userId: user.id,
    email: user.email,
    tier: user.tier,
  };
}

function ensureLocalDefaultCompanyMembership(userId: string): void {
  try {
    sqlite.prepare(`
      INSERT OR IGNORE INTO company_memberships (id, company_id, user_id, role, status, created_at)
      SELECT ?, ?, ?, 'owner', 'active', ?
      WHERE EXISTS (SELECT 1 FROM companies WHERE id = ?)
    `).run("local-default-company-owner", DEFAULT_COMPANY_ID, userId, Date.now(), DEFAULT_COMPANY_ID);
  } catch {
    // Local-only convenience. If the demo company is disabled, first-run setup still works.
  }
}

function shouldBypassClerk(req: Request): boolean {
  if (req.path.startsWith("/api/blog") && allowUnauthenticatedBlogAccess()) {
    return true;
  }

  const token = extractBearerToken(req);
  if (!token) {
    return false;
  }

  if (token.startsWith("sk_sm_") || token.startsWith("mcp_sm_")) {
    return true;
  }

  return isStructuredJwt(token) && verifyToken(token) !== null;
}

export async function requireBlogAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.path === "/shopify/oauth/callback") {
    next();
    return;
  }
  if (allowUnauthenticatedBlogAccess()) {
    next();
    return;
  }
  await requireAuth(req, res, next);
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

async function resolveJwtUser(req: Request): Promise<Express.User | null> {
  const token = extractBearerToken(req);
  if (!token || token.startsWith("sk_sm_") || token.startsWith("mcp_sm_") || !isStructuredJwt(token)) {
    return null;
  }

  const payload = verifyToken(token);
  if (!payload) {
    return null;
  }

  const dbUser = await getUserById(payload.userId);
  if (!dbUser) {
    return null;
  }

  return {
    userId: dbUser.id,
    email: dbUser.email,
    tier: dbUser.tier,
  };
}

// ── Install Clerk middleware globally ────────────────────────────────
export function configureClerk(app: Express): void {
  // Skip Clerk entirely if no publishable key — this is an internal tool
  if (!hasClerkKey()) {
    console.log("[auth] No Clerk key found — running without auth");
    app.use((_req: Request, _res: Response, next: NextFunction) => next());
    return;
  }

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
  if (!hasClerkKey()) return null;

  const auth = getAuth(req);
  if (!auth?.userId) return null;

  // Get Clerk user details for email + metadata
  const clerkUser = await clerkClient.users.getUser(auth.userId);
  const email = clerkUser.emailAddresses?.[0]?.emailAddress ?? "";
  const tier = normalizeUserTier(clerkUser.publicMetadata?.tier);

  // Ensure a local DB row exists (for usage tracking)
  await getOrCreateUser(auth.userId, email, tier);

  return { userId: auth.userId, email, tier };
}

// ── Middleware: requires a valid Clerk session, API key, or legacy JWT ───────
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

    const jwtUser = await resolveJwtUser(req);
    if (jwtUser) {
      req.user = jwtUser;
      next();
      return;
    }

    if (allowLocalInternalAuth()) {
      req.user = await getLocalInternalUser();
      next();
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
    const apiKeyResult = await resolveApiKeyUser(req);
    if (apiKeyResult.status === "success") {
      req.user = apiKeyResult.user;
      next();
      return;
    }

    const jwtUser = await resolveJwtUser(req);
    if (jwtUser) {
      req.user = jwtUser;
      next();
      return;
    }

    if (allowLocalInternalAuth()) {
      req.user = await getLocalInternalUser();
      next();
      return;
    }

    const user = await resolveUser(req);
    if (user) {
      req.user = user;
    }
  } catch {
    // silently ignore
  }
  next();
}

// ── Middleware: require minimum tier ─────────────────────────────────
export function requireTier(minTier: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userTier = normalizeUserTier(req.user?.tier);
    const requiredTier = normalizeUserTier(minTier);
    const userLevel = TIER_LEVELS[userTier];
    const requiredLevel = TIER_LEVELS[requiredTier];

    if (userLevel < requiredLevel) {
      res.status(403).json({
        message: `This feature requires the ${requiredTier} plan`,
        requiredTier,
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
export { TIER_LEVELS, TIER_TOKEN_LIMITS, TIER_STORAGE_LIMITS, normalizeUserTier };
