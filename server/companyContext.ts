import type { NextFunction, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import {
  brandProfiles,
  companies,
  companyIntegrations,
  companyMemberships,
  type BrandProfile,
  type Company,
  type CompanyIntegration,
} from "@shared/schema";
import { db } from "./db";
import { DEFAULT_COMPANY_ID } from "./companyDefaults";

export { DEFAULT_COMPANY_ID };

export const COMPANY_ROLES = ["owner", "admin", "editor", "reviewer", "viewer"] as const;

export interface CompanyContext {
  company: {
    id: string;
    name: string;
    websiteUrl: string;
    primaryDomain: string;
    primaryMarket?: string | null;
    ecommercePlatform?: string | null;
    logoUrl?: string | null;
  };
  brandProfile: {
    id: string;
    displayName: string;
    websiteUrl: string;
    blogUrl?: string | null;
    productUrlPattern?: string | null;
    shortDescription?: string | null;
    positioning?: string | null;
    audiencePersonas: string[];
    toneTraits: string[];
    bannedPhrases: string[];
    preferredCtas: string[];
    keyMessaging: string[];
    requiredTerms: string[];
    requiredClaims: string[];
    forbiddenClaims: string[];
    writingSamples: string[];
    targetWordCount: {
      min: number;
      max: number;
    };
  };
  integrations: {
    shopify?: ShopifyCompanyIntegration;
  };
  competitors: Array<{
    name: string;
    domains: string[];
  }>;
}

export interface ShopifyCompanyIntegration {
  id: string;
  shop: string;
  hasAccessToken: boolean;
  defaultBlogId?: number;
  blogTargets: Array<{
    id: number;
    name: string;
    handle: string;
  }>;
  productUrlPattern?: string | null;
  publicStoreUrl?: string | null;
}

export type CompanyRole = typeof COMPANY_ROLES[number];

const ROLE_LEVELS: Record<CompanyRole, number> = {
  viewer: 0,
  reviewer: 1,
  editor: 2,
  admin: 3,
  owner: 4,
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asCompetitors(value: unknown): Array<{ name: string; domains: string[] }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const candidate = item as { name?: unknown; domains?: unknown };
      if (typeof candidate.name !== "string") return null;
      return {
        name: candidate.name,
        domains: asStringArray(candidate.domains),
      };
    })
    .filter((item): item is { name: string; domains: string[] } => Boolean(item));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function mapShopifyIntegration(integration: CompanyIntegration): ShopifyCompanyIntegration | undefined {
  if (!["connected", "configured"].includes(integration.status)) return undefined;

  const config = asRecord(integration.config);
  const shop = typeof config.shop === "string" ? config.shop : undefined;
  if (!shop) return undefined;
  const encryptedAccessToken = typeof config.encryptedAccessToken === "string" && config.encryptedAccessToken.length > 0;

  const blogTargets = Array.isArray(config.blogTargets)
    ? config.blogTargets
        .map((target) => {
          if (!target || typeof target !== "object") return null;
          const item = target as { id?: unknown; name?: unknown; handle?: unknown };
          const id = toNumber(item.id);
          if (!id || typeof item.name !== "string" || typeof item.handle !== "string") return null;
          return { id, name: item.name, handle: item.handle };
        })
        .filter((target): target is { id: number; name: string; handle: string } => Boolean(target))
    : [];

  return {
    id: integration.id,
    shop,
    hasAccessToken: encryptedAccessToken,
    defaultBlogId: toNumber(config.defaultBlogId),
    blogTargets,
    productUrlPattern: typeof config.productUrlPattern === "string" ? config.productUrlPattern : null,
    publicStoreUrl: typeof config.publicStoreUrl === "string" ? config.publicStoreUrl : null,
  };
}

function toCompanyContext(
  company: Company,
  brandProfile: BrandProfile,
  integrations: CompanyIntegration[],
): CompanyContext {
  const shopifyConfig = integrations
    .filter((integration) => integration.type === "shopify")
    .map(mapShopifyIntegration)
    .find(Boolean);
  const websiteUrl = brandProfile.websiteUrl || company.websiteUrl || "";

  return {
    company: {
      id: company.id,
      name: company.name,
      websiteUrl,
      primaryDomain: company.primaryDomain || "",
      primaryMarket: company.primaryMarket,
      ecommercePlatform: company.ecommercePlatform,
      logoUrl: company.logoUrl,
    },
    brandProfile: {
      id: brandProfile.id,
      displayName: brandProfile.displayName,
      websiteUrl,
      blogUrl: brandProfile.blogUrl,
      productUrlPattern: brandProfile.productUrlPattern || shopifyConfig?.productUrlPattern || null,
      shortDescription: brandProfile.shortDescription,
      positioning: brandProfile.positioning,
      audiencePersonas: asStringArray(brandProfile.audiencePersonas),
      toneTraits: asStringArray(brandProfile.toneTraits),
      bannedPhrases: asStringArray(brandProfile.bannedPhrases),
      preferredCtas: asStringArray(brandProfile.preferredCtas),
      keyMessaging: asStringArray(brandProfile.keyMessaging),
      requiredTerms: asStringArray(brandProfile.requiredTerms),
      requiredClaims: asStringArray(brandProfile.requiredClaims),
      forbiddenClaims: asStringArray(brandProfile.forbiddenClaims),
      writingSamples: asStringArray(brandProfile.writingSamples),
      targetWordCount: {
        min: brandProfile.targetWordCountMin || 800,
        max: brandProfile.targetWordCountMax || 1400,
      },
    },
    integrations: {
      ...(shopifyConfig ? { shopify: shopifyConfig } : {}),
    },
    competitors: asCompetitors(brandProfile.competitors),
  };
}

export async function getCompanyContext(companyId = DEFAULT_COMPANY_ID): Promise<CompanyContext> {
  const [company] = await db
    .select()
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  if (!company) {
    throw new Error(`Company ${companyId} not found`);
  }

  const [defaultProfile] = await db
    .select()
    .from(brandProfiles)
    .where(and(eq(brandProfiles.companyId, company.id), eq(brandProfiles.isDefault, true)))
    .limit(1);

  const [firstProfile] = defaultProfile
    ? [defaultProfile]
    : await db
        .select()
        .from(brandProfiles)
        .where(eq(brandProfiles.companyId, company.id))
        .limit(1);

  if (!firstProfile) {
    throw new Error(`Company ${company.id} has no brand profile`);
  }

  const integrations = await db
    .select()
    .from(companyIntegrations)
    .where(eq(companyIntegrations.companyId, company.id));

  return toCompanyContext(company, firstProfile, integrations);
}

function getRequestedCompanyId(req: { header(name: string): string | undefined; query?: Record<string, unknown>; companyId?: string }): string {
  if (req.companyId) return req.companyId;

  return getExplicitCompanyIdFromRequest(req) || DEFAULT_COMPANY_ID;
}

function getExplicitCompanyIdFromRequest(req: { header(name: string): string | undefined; query?: Record<string, unknown>; companyId?: string }): string | null {
  if (req.companyId) return req.companyId;

  const headerCompanyId = req.header("x-company-id");
  if (headerCompanyId) return headerCompanyId;

  const queryCompanyId = req.query?.companyId;
  if (typeof queryCompanyId === "string" && queryCompanyId) return queryCompanyId;

  return null;
}

function allowUnvalidatedCompanySelection(): boolean {
  const explicit = process.env.BLOG_ALLOW_UNVALIDATED_COMPANY_SELECTION;
  if (["1", "true", "yes", "on"].includes((explicit || "").toLowerCase())) {
    return process.env.NODE_ENV === "development";
  }
  if (["0", "false", "no", "off"].includes((explicit || "").toLowerCase())) return false;
  return false;
}

export function getCompanyIdFromRequest(req: { header(name: string): string | undefined; query?: Record<string, unknown>; companyId?: string }): string {
  if (req.companyId) return req.companyId;
  if (!allowUnvalidatedCompanySelection()) {
    throw new Error("Company access has not been validated for this request.");
  }
  return getRequestedCompanyId(req);
}

export async function requireBlogCompanyAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (req.path === "/shopify/oauth/callback" || (req.path === "/company" && ["GET", "POST"].includes(req.method))) {
      next();
      return;
    }

    const explicitCompanyId = getExplicitCompanyIdFromRequest(req);
    if (!explicitCompanyId && !allowUnvalidatedCompanySelection()) {
      res.status(400).json({ error: "Company workspace must be selected for this request." });
      return;
    }

    const requestedCompanyId = explicitCompanyId || DEFAULT_COMPANY_ID;

    const [company] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.id, requestedCompanyId))
      .limit(1);

    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }

    if (allowUnvalidatedCompanySelection()) {
      req.companyId = requestedCompanyId;
      req.companyRole = "owner";
      next();
      return;
    }

    if (!req.user?.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const [membership] = await db
      .select({ id: companyMemberships.id, role: companyMemberships.role })
      .from(companyMemberships)
      .where(and(
        eq(companyMemberships.companyId, requestedCompanyId),
        eq(companyMemberships.userId, req.user.userId),
        eq(companyMemberships.status, "active"),
      ))
      .limit(1);

    if (!membership) {
      res.status(403).json({ error: "You do not have access to this company workspace" });
      return;
    }

    req.companyId = requestedCompanyId;
    req.companyRole = membership.role as CompanyRole;
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !companyRoleAtLeast(req.companyRole, "reviewer")) {
      res.status(403).json({ error: "Your company role does not allow changes in this workspace." });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function companyRoleAtLeast(role: string | undefined, minimum: CompanyRole): boolean {
  if (!role || !(role in ROLE_LEVELS)) return false;
  return ROLE_LEVELS[role as CompanyRole] >= ROLE_LEVELS[minimum];
}

export function isCompanyRole(value: unknown): value is CompanyRole {
  return typeof value === "string" && (COMPANY_ROLES as readonly string[]).includes(value);
}

export function requireBlogRole(minimum: CompanyRole) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (allowUnvalidatedCompanySelection()) {
      next();
      return;
    }
    if (!companyRoleAtLeast(req.companyRole, minimum)) {
      res.status(403).json({ error: `This action requires ${minimum} access or higher.` });
      return;
    }
    next();
  };
}

export function requireBlogMutationRole(minimum: CompanyRole) {
  const roleMiddleware = requireBlogRole(minimum);
  return (req: Request, res: Response, next: NextFunction): void => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      next();
      return;
    }
    roleMiddleware(req, res, next);
  };
}
