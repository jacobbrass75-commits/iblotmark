import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestJson, startHttpServer } from "./helpers/http";

describe("company membership route integration", () => {
  let tempDir = "";
  let sqlite: { close: () => void } | null = null;
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "standalone-company-memberships-"));
    vi.resetModules();
    process.chdir(tempDir);
    process.env = {
      ...originalEnv,
      NODE_ENV: "production",
      IBOLT_BLOG_ALLOW_UNAUTHENTICATED: "false",
      BLOG_ALLOW_UNVALIDATED_COMPANY_SELECTION: "false",
      IBOLT_INTERNAL_AUTH_BYPASS: "false",
      BLOG_SEED_IBOLT_DEMO: "false",
      ENABLE_LEGACY_SCHOLARMARK: "false",
    };
  });

  afterEach(async () => {
    sqlite?.close();
    sqlite = null;
    process.chdir(originalCwd);
    process.env = originalEnv;
    vi.resetModules();
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createCompanyApp() {
    const express = (await import("express")).default;
    const { db, sqlite: importedSqlite } = await import("../../server/db");
    const {
      brandProfiles,
      companies,
      companyMemberships,
      users,
    } = await import("../../shared/schema");
    const { generateToken } = await import("../../server/auth");
    const { requireBlogAuth } = await import("../../server/auth");
    const { requireBlogCompanyAccess } = await import("../../server/companyContext");
    const { registerCompanyRoutes } = await import("../../server/companyRoutes");

    sqlite = importedSqlite;
    const app = express();
    app.use(express.json());
    app.use("/api/blog", requireBlogAuth);
    app.use("/api/blog", requireBlogCompanyAccess);
    registerCompanyRoutes(app);

    const now = new Date("2026-05-01T00:00:00.000Z");
    const userRows = [
      { id: "owner-user", email: "owner@example.com", tier: "max" },
      { id: "admin-user", email: "admin@example.com", tier: "pro" },
      { id: "viewer-user", email: "viewer@example.com", tier: "free" },
    ];
    for (const user of userRows) {
      await db.insert(users).values({
        id: user.id,
        email: user.email,
        username: user.email,
        password: "",
        tier: user.tier,
        tokensUsed: 0,
        tokenLimit: 50000,
        storageUsed: 0,
        storageLimit: 52428800,
        emailVerified: true,
        billingCycleStart: now,
        createdAt: now,
        updatedAt: now,
      } as any);
    }

    await db.insert(companies).values({
      id: "company-1",
      name: "Acme Commerce",
      slug: "acme-commerce",
      websiteUrl: "https://acme.example.com",
      primaryDomain: "acme.example.com",
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
    const [ownerMembership] = await db.insert(companyMemberships).values({
      id: "membership-owner",
      companyId: "company-1",
      userId: "owner-user",
      role: "owner",
      status: "active",
      createdAt: now,
    }).returning();

    return {
      db,
      companyMemberships,
      ownerMembership,
      tokens: {
        owner: generateToken({ id: "owner-user", email: "owner@example.com", tier: "max" }),
        admin: generateToken({ id: "admin-user", email: "admin@example.com", tier: "pro" }),
        viewer: generateToken({ id: "viewer-user", email: "viewer@example.com", tier: "free" }),
      },
      server: await startHttpServer(app),
    };
  }

  it("requires production-style company membership and enforces roles", async () => {
    const { server, tokens } = await createCompanyApp();
    const companyHeaders = {
      "x-company-id": "company-1",
      authorization: `Bearer ${tokens.owner}`,
    };

    try {
      const missingCompany = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/blog/company/context", {
        headers: { authorization: `Bearer ${tokens.owner}` },
      });
      expect(missingCompany.status).toBe(400);
      expect(missingCompany.body).toEqual({ error: "Company workspace must be selected for this request." });

      const addViewer = await requestJson<{ membership: { role: string; status: string; userId: string } }>(
        server.baseUrl,
        "/api/blog/company/memberships",
        {
          method: "POST",
          headers: companyHeaders,
          body: { email: "viewer@example.com", role: "viewer" },
        },
      );
      expect(addViewer.status).toBe(201);
      expect(addViewer.body?.membership).toMatchObject({
        userId: "viewer-user",
        role: "viewer",
        status: "active",
      });

      const viewerContext = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/blog/company/context", {
        headers: {
          "x-company-id": "company-1",
          authorization: `Bearer ${tokens.viewer}`,
        },
      });
      expect(viewerContext.status).toBe(200);

      const viewerListMembers = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/blog/company/memberships", {
        headers: {
          "x-company-id": "company-1",
          authorization: `Bearer ${tokens.viewer}`,
        },
      });
      expect(viewerListMembers.status).toBe(403);

      const viewerMutation = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/blog/company/profile", {
        method: "PUT",
        headers: {
          "x-company-id": "company-1",
          authorization: `Bearer ${tokens.viewer}`,
        },
        body: { company: { primaryMarket: "Manufacturing" } },
      });
      expect(viewerMutation.status).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("guards owner management and preserves at least one active owner", async () => {
    const { server, tokens, ownerMembership } = await createCompanyApp();

    try {
      const ownerHeaders = {
        "x-company-id": "company-1",
        authorization: `Bearer ${tokens.owner}`,
      };
      const addAdmin = await requestJson<{ membership: { id: string; role: string; userId: string } }>(
        server.baseUrl,
        "/api/blog/company/memberships",
        {
          method: "POST",
          headers: ownerHeaders,
          body: { email: "admin@example.com", role: "admin" },
        },
      );
      expect(addAdmin.status).toBe(201);
      expect(addAdmin.body?.membership).toMatchObject({ userId: "admin-user", role: "admin" });

      const adminGrantOwner = await requestJson<Record<string, unknown>>(server.baseUrl, "/api/blog/company/memberships", {
        method: "POST",
        headers: {
          "x-company-id": "company-1",
          authorization: `Bearer ${tokens.admin}`,
        },
        body: { email: "viewer@example.com", role: "owner" },
      });
      expect(adminGrantOwner.status).toBe(403);
      expect(adminGrantOwner.body).toEqual({ error: "Only owners can grant owner access." });

      const removeLastOwner = await requestJson<Record<string, unknown>>(
        server.baseUrl,
        `/api/blog/company/memberships/${ownerMembership.id}`,
        {
          method: "DELETE",
          headers: ownerHeaders,
        },
      );
      expect(removeLastOwner.status).toBe(400);
      expect(removeLastOwner.body).toEqual({ error: "A company must always keep at least one active owner." });
    } finally {
      await server.close();
    }
  });
});
