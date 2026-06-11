import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("company context integration", () => {
  let tempDir = "";
  let sqlite: { close: () => void } | null = null;
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "standalone-company-context-"));
    vi.resetModules();
    process.chdir(tempDir);
    process.env = {
      ...originalEnv,
      NODE_ENV: "production",
      BLOG_SEED_IBOLT_DEMO: "false",
      DATABASE_PATH: "./data/standalone-blog-writer.db",
    };
  });

  afterEach(async () => {
    sqlite?.close();
    sqlite = null;
    process.chdir(originalCwd);
    process.env = { ...originalEnv };
    vi.resetModules();
    await rm(tempDir, { recursive: true, force: true });
  });

  async function seedCompany(config: Record<string, unknown>, accessTokenRef?: string | null) {
    const { db, sqlite: importedSqlite } = await import("../../server/db");
    const {
      brandProfiles,
      companies,
      companyIntegrations,
    } = await import("../../shared/schema");

    sqlite = importedSqlite;
    const now = new Date("2026-05-01T00:00:00.000Z");
    await db.insert(companies).values({
      id: "company-1",
      name: "Acme Commerce",
      slug: "acme-commerce",
      websiteUrl: "https://acme.example.com",
      primaryDomain: "acme.example.com",
      ecommercePlatform: "shopify",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(brandProfiles).values({
      id: "brand-1",
      companyId: "company-1",
      displayName: "Acme Commerce",
      websiteUrl: "https://acme.example.com",
      toneTraits: ["practical"],
      bannedPhrases: ["game-changer"],
      preferredCtas: ["Explore options"],
      requiredClaims: ["Verify product facts"],
      audiencePersonas: ["Operations manager"],
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(companyIntegrations).values({
      id: "integration-1",
      companyId: "company-1",
      type: "shopify",
      name: "Shopify",
      status: "connected",
      accessTokenRef,
      config,
      createdAt: now,
      updatedAt: now,
    });

    const { getCompanyContext } = await import("../../server/companyContext");
    return getCompanyContext("company-1");
  }

  it("does not treat legacy Shopify accessTokenRef values as usable credentials", async () => {
    const context = await seedCompany({
      shop: "mock-shop.myshopify.com",
      defaultBlogId: 111,
      blogTargets: [{ id: 111, name: "News", handle: "news" }],
      accessTokenRef: "legacy-token-ref-in-config",
    }, "legacy-token-ref");

    expect(context.integrations.shopify?.hasAccessToken).toBe(false);
    expect(context.integrations.shopify).not.toHaveProperty("accessTokenRef");
    expect(JSON.stringify(context)).not.toContain("legacy-token-ref");
    expect(JSON.stringify(context)).not.toContain("accessTokenRef");
  });

  it("reports token availability only from encrypted OAuth token material", async () => {
    const context = await seedCompany({
      shop: "mock-shop.myshopify.com",
      encryptedAccessToken: "v1:encrypted-token-material",
      defaultBlogId: 111,
      blogTargets: [{ id: 111, name: "News", handle: "news" }],
    });

    expect(context.integrations.shopify?.hasAccessToken).toBe(true);
    expect(context.integrations.shopify).not.toHaveProperty("accessTokenRef");
    expect(JSON.stringify(context)).not.toContain("encrypted-token-material");
    expect(JSON.stringify(context)).not.toContain("encryptedAccessToken");
  });
});
