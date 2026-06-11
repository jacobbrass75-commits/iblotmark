import { Router, type Request, type Response } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  blogPosts,
  brandProfiles,
  companies,
  companyIntegrations,
  companyMemberships,
  companySettings,
  companyUsageEvents,
  contextEntries,
  industryVerticals,
  keywordImports,
  productPhotos,
  products,
  users,
} from "@shared/schema";
import { db } from "./db";
import {
  companyRoleAtLeast,
  getCompanyContext,
  getCompanyIdFromRequest,
  isCompanyRole,
  requireBlogRole,
  type CompanyRole,
} from "./companyContext";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/https?:\/\//, "")
    .replace(/www\./, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "company";
}

async function makeUniqueSlug(base: string): Promise<string> {
  let slug = slugify(base);
  let suffix = 2;

  while (true) {
    const existing = await db.select({ id: companies.id }).from(companies).where(eq(companies.slug, slug)).limit(1);
    if (!existing.length) return slug;
    slug = `${slugify(base)}-${suffix}`;
    suffix++;
  }
}

function normalizeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed.replace(/\/$/, "") : `https://${trimmed.replace(/\/$/, "")}`;
}

function domainFromUrl(value: unknown): string | null {
  const normalized = normalizeUrl(value);
  if (!normalized) return null;
  try {
    return new URL(normalized).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function asCompetitors(value: unknown): Array<{ name: string; domains: string[] }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const candidate = item as Record<string, unknown>;
      const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
      if (!name) return null;
      return {
        name,
        domains: asStringArray(candidate.domains),
      };
    })
    .filter((item): item is { name: string; domains: string[] } => Boolean(item));
}

function optionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalNumber(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function buildBrandProfilePayload(input: Record<string, unknown>, companyId: string, displayFallback: string) {
  const min = optionalNumber(input.targetWordCountMin);
  const max = optionalNumber(input.targetWordCountMax);

  return {
    companyId,
    displayName: optionalString(input.displayName) || displayFallback,
    websiteUrl: normalizeUrl(input.websiteUrl),
    blogUrl: normalizeUrl(input.blogUrl),
    productUrlPattern: optionalString(input.productUrlPattern) || null,
    shortDescription: optionalString(input.shortDescription) || null,
    positioning: optionalString(input.positioning) || null,
    audiencePersonas: asStringArray(input.audiencePersonas),
    toneTraits: asStringArray(input.toneTraits),
    bannedPhrases: asStringArray(input.bannedPhrases),
    preferredCtas: asStringArray(input.preferredCtas),
    keyMessaging: asStringArray(input.keyMessaging),
    requiredTerms: asStringArray(input.requiredTerms),
    requiredClaims: asStringArray(input.requiredClaims),
    forbiddenClaims: asStringArray(input.forbiddenClaims),
    competitors: asCompetitors(input.competitors),
    writingSamples: asStringArray(input.writingSamples),
    targetWordCountMin: min ?? 800,
    targetWordCountMax: max ?? 1400,
    isDefault: true,
    updatedAt: new Date(),
  };
}

function normalizeShop(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (!trimmed) return null;
  return trimmed.replace(/\.myshopify\.com$/i, "");
}

function parseBlogTargets(value: unknown): Array<{ id: number; name: string; handle: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const candidate = item as Record<string, unknown>;
      const id = Number(candidate.id);
      const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
      const handle = typeof candidate.handle === "string" ? candidate.handle.trim() : "";
      if (!Number.isFinite(id) || !name || !handle) return null;
      return { id, name, handle };
    })
    .filter((item): item is { id: number; name: string; handle: string } => Boolean(item));
}

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function brandProfileIsReady(context: Awaited<ReturnType<typeof getCompanyContext>>): boolean {
  const profile = context.brandProfile;
  const hasVoiceRules = profile.toneTraits.length > 0 && profile.preferredCtas.length > 0;
  const hasClaimRules = profile.bannedPhrases.length > 0 || profile.requiredClaims.length > 0 || profile.forbiddenClaims.length > 0;
  const hasMarketContext = context.competitors.length > 0 || profile.writingSamples.length > 0 || profile.audiencePersonas.length > 0;

  return Boolean(
    hasText(profile.displayName)
      && hasText(profile.websiteUrl)
      && (hasText(profile.positioning) || hasText(profile.shortDescription))
      && hasVoiceRules
      && hasClaimRules
      && hasMarketContext,
  );
}

async function countRows(table: any, companyId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(table)
    .where(eq(table.companyId, companyId));
  return row?.count || 0;
}

async function countUsablePhotos(companyId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(productPhotos)
    .where(and(
      eq(productPhotos.companyId, companyId),
      eq(productPhotos.assetStatus, "approved"),
      sql`${productPhotos.rightsStatus} in ('owned', 'licensed')`,
    ));
  return row?.count || 0;
}

async function seedStarterVertical(companyId: string, companyName: string, primaryMarket?: string | null): Promise<void> {
  const market = primaryMarket?.trim() || "General Content";
  const slug = slugify(market) || "general-content";
  const [vertical] = await db
    .insert(industryVerticals)
    .values({
      companyId,
      name: market,
      slug,
      description: `Starter content vertical for ${companyName}. Replace or expand this with the company's real markets, buyers, and product use cases during onboarding.`,
      terminology: [],
      painPoints: [],
      useCases: [],
      regulations: [],
      seasonalRelevance: "",
      compatibleDevices: [],
      updatedAt: new Date(),
    })
    .returning()
    .catch(async () => {
      const [existing] = await db
        .select()
        .from(industryVerticals)
        .where(and(eq(industryVerticals.companyId, companyId), eq(industryVerticals.slug, slug)))
        .limit(1);
      return existing ? [existing] : [];
    });

  if (!vertical) return;

  await db.insert(contextEntries).values({
    companyId,
    verticalId: vertical.id,
    category: "setup_note",
    content: "This is a neutral starter vertical. Add verified customer language, use cases, buyer questions, constraints, and product facts before relying on generated content.",
    sourceType: "seed",
    confidence: 1,
    isVerified: true,
  }).catch(() => undefined);
}

function allowFullCompanyList(): boolean {
  const explicit = process.env.BLOG_ALLOW_UNVALIDATED_COMPANY_SELECTION;
  if (["1", "true", "yes", "on"].includes((explicit || "").toLowerCase())) return process.env.NODE_ENV === "development";
  if (["0", "false", "no", "off"].includes((explicit || "").toLowerCase())) return false;
  return false;
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized) ? normalized : null;
}

async function countActiveOwners(companyId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(companyMemberships)
    .where(and(
      eq(companyMemberships.companyId, companyId),
      eq(companyMemberships.role, "owner"),
      eq(companyMemberships.status, "active"),
    ));
  return row?.count || 0;
}

async function getMembershipById(companyId: string, membershipId: string) {
  const [membership] = await db
    .select()
    .from(companyMemberships)
    .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.id, membershipId)))
    .limit(1);
  return membership || null;
}

function canManageRole(actorRole: string | undefined, targetRole: CompanyRole): boolean {
  if (!companyRoleAtLeast(actorRole, "admin")) return false;
  return targetRole !== "owner" || actorRole === "owner";
}

async function assertNotLastOwnerChange(companyId: string, membership: { id: string; role: string; status: string }): Promise<string | null> {
  if (membership.role !== "owner" || membership.status !== "active") return null;
  const ownerCount = await countActiveOwners(companyId);
  return ownerCount <= 1 ? "A company must always keep at least one active owner." : null;
}

export function registerCompanyRoutes(app: { use: (path: string, router: Router) => void }) {
  const router = Router();

  router.get("/", async (_req: Request, res: Response) => {
    try {
      if (_req.user?.userId && !allowFullCompanyList()) {
        const memberships = await db
          .select({ companyId: companyMemberships.companyId })
          .from(companyMemberships)
          .where(and(eq(companyMemberships.userId, _req.user.userId), eq(companyMemberships.status, "active")));
        const ids = memberships.map((membership) => membership.companyId);
        if (ids.length === 0) return res.json([]);
        const rows = await db.select().from(companies).where(inArray(companies.id, ids)).orderBy(desc(companies.updatedAt));
        return res.json(rows);
      }

      const rows = await db.select().from(companies).orderBy(desc(companies.updatedAt));
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/", async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) {
        return res.status(400).json({ error: "Company name is required" });
      }

      const websiteUrl = normalizeUrl(body.websiteUrl);
      const slug = await makeUniqueSlug(typeof body.slug === "string" && body.slug.trim() ? body.slug : name);
      const [company] = await db.insert(companies).values({
        name,
        slug,
        websiteUrl,
        primaryDomain: domainFromUrl(websiteUrl),
        logoUrl: optionalString(body.logoUrl) || null,
        primaryMarket: optionalString(body.primaryMarket) || null,
        ecommercePlatform: optionalString(body.ecommercePlatform) || null,
        status: "active",
        updatedAt: new Date(),
      }).returning();

      const brandInput = body.brandProfile && typeof body.brandProfile === "object"
        ? body.brandProfile as Record<string, unknown>
        : body;
      await db.insert(brandProfiles).values({
        ...buildBrandProfilePayload(
          {
            displayName: brandInput.displayName || name,
            websiteUrl: brandInput.websiteUrl || websiteUrl,
            productUrlPattern: brandInput.productUrlPattern || (websiteUrl ? `${websiteUrl}/products/{handle}` : null),
            ...brandInput,
          },
          company.id,
          name,
        ),
        createdAt: new Date(),
      });

      await db.insert(companySettings).values({
        companyId: company.id,
        settings: {
          reviewPolicy: {
            minimumOverallScore: 70,
            requireHumanApproval: true,
            publishDefault: "draft",
          },
          storageLimits: {
            maxPhotoBytes: 5_368_709_120,
          },
        },
        updatedAt: new Date(),
      });

      await seedStarterVertical(company.id, company.name, company.primaryMarket);

      if (req.user?.userId) {
        await db.insert(companyMemberships).values({
          companyId: company.id,
          userId: req.user.userId,
          role: "owner",
          status: "active",
        }).catch(() => undefined);
      }

      await db.insert(companyUsageEvents).values({
        companyId: company.id,
        userId: req.user?.userId || null,
        eventType: "company.created",
        metadata: { source: "setup" },
      });

      res.status(201).json(await getCompanyContext(company.id));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/context", async (req: Request, res: Response) => {
    try {
      const context = await getCompanyContext(getCompanyIdFromRequest(req));
      res.json(context);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/memberships", requireBlogRole("admin"), async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      const rows = await db
        .select({
          id: companyMemberships.id,
          companyId: companyMemberships.companyId,
          userId: companyMemberships.userId,
          role: companyMemberships.role,
          status: companyMemberships.status,
          createdAt: companyMemberships.createdAt,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
        })
        .from(companyMemberships)
        .leftJoin(users, eq(companyMemberships.userId, users.id))
        .where(eq(companyMemberships.companyId, companyId))
        .orderBy(desc(companyMemberships.createdAt));
      res.json({ memberships: rows });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/memberships", requireBlogRole("admin"), async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      const role = req.body?.role ?? "viewer";
      if (!isCompanyRole(role)) {
        return res.status(400).json({ error: "role must be one of owner, admin, editor, reviewer, viewer." });
      }
      if (!canManageRole(req.companyRole, role)) {
        return res.status(403).json({ error: "Only owners can grant owner access." });
      }

      const userId = typeof req.body?.userId === "string" && req.body.userId.trim() ? req.body.userId.trim() : null;
      const email = normalizeEmail(req.body?.email);
      let user: { id: string; email: string } | null = null;

      if (userId) {
        const [row] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
        user = row || null;
      } else if (email) {
        const [row] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, email)).limit(1);
        user = row || null;
      }

      if (!user) {
        return res.status(404).json({ error: "User must sign in once before they can be added to a company workspace." });
      }

      const [existing] = await db
        .select()
        .from(companyMemberships)
        .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.userId, user.id)))
        .limit(1);

      let membership;
      if (existing) {
        [membership] = await db
          .update(companyMemberships)
          .set({ role, status: "active" })
          .where(eq(companyMemberships.id, existing.id))
          .returning();
      } else {
        [membership] = await db
          .insert(companyMemberships)
          .values({
            companyId,
            userId: user.id,
            role,
            status: "active",
          })
          .returning();
      }

      await db.insert(companyUsageEvents).values({
        companyId,
        userId: req.user?.userId || null,
        eventType: existing ? "company.membership.updated" : "company.membership.created",
        metadata: { targetUserId: user.id, targetEmail: user.email, role },
      });

      res.status(existing ? 200 : 201).json({ membership });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch("/memberships/:id", requireBlogRole("admin"), async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      const membership = await getMembershipById(companyId, req.params.id);
      if (!membership) return res.status(404).json({ error: "Membership not found." });

      const updates: Partial<typeof companyMemberships.$inferInsert> = {};
      if (req.body?.role !== undefined) {
        if (!isCompanyRole(req.body.role)) {
          return res.status(400).json({ error: "role must be one of owner, admin, editor, reviewer, viewer." });
        }
        if (!canManageRole(req.companyRole, req.body.role)) {
          return res.status(403).json({ error: "Only owners can grant owner access." });
        }
        if (membership.role === "owner" && req.body.role !== "owner" && req.companyRole !== "owner") {
          return res.status(403).json({ error: "Only owners can change owner memberships." });
        }
        if (membership.role === "owner" && req.body.role !== "owner") {
          const lastOwnerError = await assertNotLastOwnerChange(companyId, membership);
          if (lastOwnerError) return res.status(400).json({ error: lastOwnerError });
        }
        updates.role = req.body.role;
      }
      if (req.body?.status !== undefined) {
        const status = typeof req.body.status === "string" ? req.body.status.trim() : "";
        if (!["active", "inactive"].includes(status)) {
          return res.status(400).json({ error: "status must be active or inactive." });
        }
        if (status !== "active") {
          const lastOwnerError = await assertNotLastOwnerChange(companyId, membership);
          if (lastOwnerError) return res.status(400).json({ error: lastOwnerError });
        }
        updates.status = status;
      }
      if (!Object.keys(updates).length) {
        return res.status(400).json({ error: "role or status is required." });
      }

      const [updated] = await db.update(companyMemberships).set(updates).where(eq(companyMemberships.id, membership.id)).returning();
      await db.insert(companyUsageEvents).values({
        companyId,
        userId: req.user?.userId || null,
        eventType: "company.membership.updated",
        metadata: { targetUserId: updated.userId, role: updated.role, status: updated.status },
      });
      res.json({ membership: updated });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete("/memberships/:id", requireBlogRole("admin"), async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      const membership = await getMembershipById(companyId, req.params.id);
      if (!membership) return res.status(404).json({ error: "Membership not found." });
      if (membership.role === "owner") {
        const lastOwnerError = await assertNotLastOwnerChange(companyId, membership);
        if (lastOwnerError) return res.status(400).json({ error: lastOwnerError });
        if (req.companyRole !== "owner") {
          return res.status(403).json({ error: "Only owners can remove owner memberships." });
        }
      }

      const [updated] = await db
        .update(companyMemberships)
        .set({ status: "inactive" })
        .where(eq(companyMemberships.id, membership.id))
        .returning();
      await db.insert(companyUsageEvents).values({
        companyId,
        userId: req.user?.userId || null,
        eventType: "company.membership.removed",
        metadata: { targetUserId: updated.userId, role: updated.role },
      });
      res.json({ membership: updated });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.put("/profile", requireBlogRole("admin"), async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      const body = req.body || {};
      const companyInput = body.company && typeof body.company === "object"
        ? body.company as Record<string, unknown>
        : body;
      const brandInput = body.brandProfile && typeof body.brandProfile === "object"
        ? body.brandProfile as Record<string, unknown>
        : body;

      const companyPayload: Partial<typeof companies.$inferInsert> = { updatedAt: new Date() };
      if (companyInput.name !== undefined) {
        const name = optionalString(companyInput.name);
        if (!name) return res.status(400).json({ error: "Company name is required" });
        companyPayload.name = name;
      }
      if (companyInput.websiteUrl !== undefined) {
        const websiteUrl = normalizeUrl(companyInput.websiteUrl);
        companyPayload.websiteUrl = websiteUrl;
        companyPayload.primaryDomain = domainFromUrl(websiteUrl);
      }
      if (companyInput.logoUrl !== undefined) companyPayload.logoUrl = optionalString(companyInput.logoUrl) || null;
      if (companyInput.primaryMarket !== undefined) companyPayload.primaryMarket = optionalString(companyInput.primaryMarket) || null;
      if (companyInput.ecommercePlatform !== undefined) companyPayload.ecommercePlatform = optionalString(companyInput.ecommercePlatform) || null;

      await db.update(companies).set(companyPayload).where(eq(companies.id, companyId));

      const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const [profile] = await db
        .select()
        .from(brandProfiles)
        .where(and(eq(brandProfiles.companyId, companyId), eq(brandProfiles.isDefault, true)))
        .limit(1);

      const brandPayload = buildBrandProfilePayload(brandInput, companyId, company.name);
      if (profile) {
        await db.update(brandProfiles).set(brandPayload).where(eq(brandProfiles.id, profile.id));
      } else {
        await db.insert(brandProfiles).values({
          ...brandPayload,
          createdAt: new Date(),
        });
      }

      await db.insert(companyUsageEvents).values({
        companyId,
        userId: req.user?.userId || null,
        eventType: "company.profile.updated",
        metadata: { source: "setup" },
      });

      res.json(await getCompanyContext(companyId));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.put("/integrations/shopify", requireBlogRole("admin"), async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      const input = req.body?.shopify && typeof req.body.shopify === "object"
        ? req.body.shopify as Record<string, unknown>
        : req.body || {};
      const shop = normalizeShop(input.shop || input.storeUrl);
      if (!shop) return res.status(400).json({ error: "Shopify shop is required" });

      const defaultBlogId = optionalNumber(input.defaultBlogId);
      const productUrlPattern = optionalString(input.productUrlPattern) || `https://${shop}.myshopify.com/products/{handle}`;
      const accessTokenRef = optionalString(input.accessTokenRef);
      if (accessTokenRef) {
        return res.status(400).json({
          error: "Manual Shopify access token refs are not accepted through the company API. Connect Shopify with OAuth.",
        });
      }

      const [existing] = await db
        .select()
        .from(companyIntegrations)
        .where(and(eq(companyIntegrations.companyId, companyId), eq(companyIntegrations.type, "shopify")))
        .limit(1);
      const previousConfig = asRecord(existing?.config);
      const blogTargets = input.blogTargets === undefined
        ? parseBlogTargets(previousConfig.blogTargets)
        : parseBlogTargets(input.blogTargets);

      const config = {
        ...previousConfig,
        shop,
        defaultBlogId: defaultBlogId ?? null,
        blogTargets,
        productUrlPattern,
        publicStoreUrl: normalizeUrl(input.publicStoreUrl) || `https://${shop}.myshopify.com`,
      };

      const payload = {
        companyId,
        type: "shopify",
        name: optionalString(input.name) || "Shopify",
        status: optionalString(input.status) || "configured",
        accessTokenRef: null,
        config,
        updatedAt: new Date(),
      };

      if (existing) {
        await db.update(companyIntegrations).set(payload).where(eq(companyIntegrations.id, existing.id));
      } else {
        await db.insert(companyIntegrations).values({
          ...payload,
          createdAt: new Date(),
        });
      }

      await db.insert(companyUsageEvents).values({
        companyId,
        userId: req.user?.userId || null,
        eventType: "integration.shopify.configured",
        metadata: { shop, hasAccessTokenRef: false },
      });

      res.json(await getCompanyContext(companyId));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete("/integrations/shopify", requireBlogRole("admin"), async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      const [existing] = await db
        .select({ config: companyIntegrations.config })
        .from(companyIntegrations)
        .where(and(eq(companyIntegrations.companyId, companyId), eq(companyIntegrations.type, "shopify")))
        .limit(1);
      const config: Record<string, unknown> = { ...asRecord(existing?.config), disconnectedAt: new Date().toISOString() };
      delete config.encryptedAccessToken;

      await db
        .update(companyIntegrations)
        .set({
          status: "disconnected",
          accessTokenRef: null,
          config,
          updatedAt: new Date(),
        })
        .where(and(eq(companyIntegrations.companyId, companyId), eq(companyIntegrations.type, "shopify")));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/setup-status", async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      const context = await getCompanyContext(companyId);
      const [integrationCount, productCount, usablePhotoCount, keywordImportCount, postCount] =
        await Promise.all([
          countRows(companyIntegrations, companyId),
          countRows(products, companyId),
          countUsablePhotos(companyId),
          countRows(keywordImports, companyId),
          countRows(blogPosts, companyId),
        ]);

      const items = [
        {
          key: "company",
          label: "Company workspace",
          complete: Boolean(context.company.name && context.company.websiteUrl),
        },
        {
          key: "brand",
          label: "Brand profile",
          complete: brandProfileIsReady(context),
        },
        {
          key: "products",
          label: "Product catalog",
          complete: productCount > 0,
        },
        {
          key: "photos",
          label: "Photo bank",
          complete: usablePhotoCount > 0,
        },
        {
          key: "keywords",
          label: "Keyword source",
          complete: keywordImportCount > 0,
        },
        {
          key: "shopify",
          label: "Shopify publishing",
          complete: integrationCount > 0 && Boolean(context.integrations.shopify?.hasAccessToken),
        },
        {
          key: "first-post",
          label: "First generated post",
          complete: postCount > 0,
        },
      ];

      res.json({
        company: context.company,
        items,
        completed: items.filter((item) => item.complete).length,
        total: items.length,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.use("/api/blog/company", router);
}
