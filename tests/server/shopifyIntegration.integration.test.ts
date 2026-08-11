import { createHmac } from "crypto";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestJson, startHttpServer } from "./helpers/http";

describe("Shopify OAuth and publish integration", () => {
  let tempDir = "";
  let sqlite: { close: () => void } | null = null;
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "standalone-shopify-integration-"));
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
      JWT_SECRET: "test-jwt-secret-for-shopify-integration-tests-123456",
      INTEGRATION_ENCRYPTION_KEY: "test-integration-secret-for-shopify-integration-tests",
      SHOPIFY_CLIENT_ID: "test-client-id",
      SHOPIFY_CLIENT_SECRET: "test-client-secret",
      SHOPIFY_OAUTH_SCOPES: "read_products,read_content,write_content",
      SHOPIFY_API_VERSION: "2026-04",
      APP_BASE_URL: "",
      PUBLIC_BASE_URL: "",
      PUBLIC_APP_URL: "",
      CLERK_SECRET_KEY: "",
      CLERK_PUBLISHABLE_KEY: "",
      VITE_CLERK_PUBLISHABLE_KEY: "",
    };
  });

  afterEach(async () => {
    sqlite?.close();
    sqlite = null;
    process.chdir(originalCwd);
    process.env = originalEnv;
    vi.unstubAllGlobals();
    vi.resetModules();
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createShopifyApp() {
    const express = (await import("express")).default;
    const { db, sqlite: importedSqlite } = await import("../../server/db");
    const {
      blogPosts,
      brandProfiles,
      companies,
      companyIntegrations,
      companyMemberships,
      companyUsageEvents,
      users,
    } = await import("../../shared/schema");
    const { generateToken } = await import("../../server/auth");
    const { requireBlogAuth } = await import("../../server/auth");
    const { requireBlogCompanyAccess } = await import("../../server/companyContext");
    const { registerShopifyRoutes } = await import("../../server/shopifyRoutes");

    sqlite = importedSqlite;
    const app = express();
    app.use(express.json());
    app.use("/api/blog", requireBlogAuth);
    app.use("/api/blog", requireBlogCompanyAccess);
    registerShopifyRoutes(app);

    const now = new Date("2026-05-01T00:00:00.000Z");
    await db.insert(users).values({
      id: "owner-user",
      email: "owner@example.com",
      username: "owner@example.com",
      password: "",
      tier: "max",
      tokensUsed: 0,
      tokenLimit: 50000,
      storageUsed: 0,
      storageLimit: 52428800,
      emailVerified: true,
      billingCycleStart: now,
      createdAt: now,
      updatedAt: now,
    } as any);
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
    await db.insert(companyMemberships).values({
      id: "membership-owner",
      companyId: "company-1",
      userId: "owner-user",
      role: "owner",
      status: "active",
      createdAt: now,
    });

    return {
      db,
      blogPosts,
      companyIntegrations,
      companyUsageEvents,
      token: generateToken({ id: "owner-user", email: "owner@example.com", tier: "max" }),
      server: await startHttpServer(app),
    };
  }

  function decodeStatePayload(state: string): Record<string, unknown> {
    const [payload] = state.split(".");
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  }

  function signCallbackQuery(query: Record<string, string>): string {
    const message = Object.entries(query)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("&");
    return createHmac("sha256", process.env.SHOPIFY_CLIENT_SECRET || "").update(message).digest("hex");
  }

  it("connects Shopify through signed OAuth and syncs new posts as Shopify drafts", async () => {
    const {
      db,
      blogPosts,
      companyIntegrations,
      companyUsageEvents,
      server,
      token,
    } = await createShopifyApp();
    const headers = {
      "x-company-id": "company-1",
      authorization: `Bearer ${token}`,
    };

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      if (url.startsWith(server.baseUrl)) {
        return originalFetch(input, init);
      }
      if (url === "https://mock-shop.myshopify.com/admin/oauth/access_token") {
        expect(init?.method).toBe("POST");
        return Promise.resolve(Response.json({
          access_token: "shpat_mock_access_token",
          scope: "read_products,read_content,write_content",
        }));
      }
      if (url === "https://mock-shop.myshopify.com/admin/api/2026-04/blogs.json?limit=50") {
        expect((init?.headers as Record<string, string>)?.["X-Shopify-Access-Token"]).toBe("shpat_mock_access_token");
        return Promise.resolve(Response.json({
          blogs: [{ id: 111, title: "News", handle: "news" }],
        }));
      }
      if (url === "https://mock-shop.myshopify.com/admin/api/2026-04/blogs/111/articles.json") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body || "{}"));
        expect(body.article).toMatchObject({
          title: "How to Choose a Mount",
          published: false,
        });
        expect(body.article.body_html).toContain("Secure mounting keeps commercial devices stable");
        expect(body.article.body_html).not.toContain("Stale HTML");
        return Promise.resolve(Response.json({
          article: { id: 222, title: body.article.title, published: false },
        }));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const start = await requestJson<{ installUrl: string; redirectUri: string; scopes: string[] }>(
        server.baseUrl,
        "/api/blog/shopify/oauth/start",
        {
          method: "POST",
          headers,
          body: { shop: "https://mock-shop.myshopify.com/admin", returnPath: "https://evil.example/steal" },
        },
      );
      expect(start.status).toBe(200);
      expect(start.body?.redirectUri).toBe(`${server.baseUrl}/api/blog/shopify/oauth/callback`);
      expect(start.body?.scopes).toEqual(["read_products", "read_content", "write_content"]);

      const installUrl = new URL(start.body?.installUrl || "");
      expect(installUrl.origin).toBe("https://mock-shop.myshopify.com");
      expect(installUrl.searchParams.get("client_id")).toBe("test-client-id");
      expect(installUrl.searchParams.get("redirect_uri")).toBe(`${server.baseUrl}/api/blog/shopify/oauth/callback`);
      const state = installUrl.searchParams.get("state") || "";
      expect(decodeStatePayload(state)).toMatchObject({
        companyId: "company-1",
        userId: "owner-user",
        shop: "mock-shop",
        returnPath: "/blog/settings",
      });

      const callbackQuery = {
        code: "mock-code",
        shop: "mock-shop.myshopify.com",
        state,
        timestamp: "1770000000",
      };
      const callbackParams = new URLSearchParams({
        ...callbackQuery,
        hmac: signCallbackQuery(callbackQuery),
      });
      const callback = await fetch(
        `${server.baseUrl}/api/blog/shopify/oauth/callback?${callbackParams.toString()}`,
        { redirect: "manual" },
      );
      expect(callback.status).toBe(302);
      const location = new URL(callback.headers.get("location") || "");
      expect(location.origin).toBe(server.baseUrl);
      expect(location.pathname).toBe("/blog/settings");
      expect(location.searchParams.get("shopify")).toBe("connected");
      expect(location.searchParams.get("companyId")).toBe("company-1");

      const [integration] = await db.select().from(companyIntegrations);
      expect(integration).toMatchObject({
        companyId: "company-1",
        type: "shopify",
        name: "Shopify",
        status: "connected",
        accessTokenRef: null,
      });
      expect(integration.config).toMatchObject({
        shop: "mock-shop",
        defaultBlogId: 111,
        productUrlPattern: "https://mock-shop.myshopify.com/products/{handle}",
        scopes: ["read_products", "read_content", "write_content"],
        blogTargets: [{ id: 111, name: "News", handle: "news" }],
      });
      expect(JSON.stringify(integration.config)).not.toContain("shpat_mock_access_token");
      expect((integration.config as Record<string, unknown>).encryptedAccessToken).toEqual(expect.any(String));

      const [usageEvent] = await db.select().from(companyUsageEvents);
      expect(usageEvent).toMatchObject({
        companyId: "company-1",
        userId: "owner-user",
        eventType: "integration.shopify.oauth_connected",
      });

      const { getCompanyContext } = await import("../../server/companyContext");
      const { decryptSecret } = await import("../../server/integrationSecrets");
      const context = await getCompanyContext("company-1");
      expect(context.integrations.shopify).toMatchObject({
        shop: "mock-shop",
        hasAccessToken: true,
        defaultBlogId: 111,
        blogTargets: [{ id: 111, name: "News", handle: "news" }],
      });
      const encryptedAccessToken = (integration.config as Record<string, unknown>).encryptedAccessToken;
      expect(encryptedAccessToken).toEqual(expect.stringMatching(/^v1:/));
      expect(decryptSecret(String(encryptedAccessToken))).toBe("shpat_mock_access_token");

      const approvedMarkdown = `## Choosing a secure mounting point\n\n${Array.from(
        { length: 80 },
        () => "Secure mounting keeps commercial devices stable during routine daily work.",
      ).join(" ")}\n\n## Checking device fit\n\nConfirm the holder matches the device before installation.\n\n## Planning maintenance\n\nInspect fasteners regularly and replace worn parts.`;

      await db.insert(blogPosts).values({
        id: "post-1",
        companyId: "company-1",
        title: "How to Choose a Mount",
        slug: "how-to-choose-a-mount",
        markdown: approvedMarkdown,
        html: "<p>Stale HTML that must not be published</p>",
        metaTitle: "Choose a Mount",
        metaDescription: "Practical mounting guidance.",
        status: "approved",
        wordCount: 746,
        overallScore: 86,
        generatedAt: new Date("2026-05-02T00:00:00.000Z"),
        updatedAt: new Date("2026-05-02T00:00:00.000Z"),
      });

      const publish = await requestJson<{
        success: boolean;
        action: string;
        shopifyArticleId: number;
        shopifyBlogId: number;
      }>(server.baseUrl, "/api/blog/shopify/posts/post-1/publish", {
        method: "POST",
        headers,
        body: {},
      });
      expect(publish.status).toBe(200);
      expect(publish.body).toMatchObject({
        success: true,
        action: "created",
        shopifyArticleId: 222,
        shopifyBlogId: 111,
      });

      const [post] = await db.select().from(blogPosts);
      expect(post).toMatchObject({
        id: "post-1",
        companyId: "company-1",
        status: "approved",
        shopifyArticleId: 222,
        shopifyBlogId: 111,
      });
      expect(post.shopifySyncedAt).toEqual(expect.any(String));
      expect(fetchMock).toHaveBeenCalledWith(
        "https://mock-shop.myshopify.com/admin/api/2026-04/blogs/111/articles.json",
        expect.objectContaining({ method: "POST" }),
      );
    } finally {
      await server.close();
    }
  });

  it("redirects Shopify OAuth failures with a generic browser-safe error code", async () => {
    const { server, token } = await createShopifyApp();
    const headers = {
      "x-company-id": "company-1",
      authorization: `Bearer ${token}`,
    };

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      if (url.startsWith(server.baseUrl)) {
        return originalFetch(input, init);
      }
      if (url === "https://mock-shop.myshopify.com/admin/oauth/access_token") {
        return Promise.resolve(new Response("provider leaked shpat_should_not_reach_browser", { status: 401 }));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const start = await requestJson<{ installUrl: string }>(
        server.baseUrl,
        "/api/blog/shopify/oauth/start",
        {
          method: "POST",
          headers,
          body: { shop: "mock-shop.myshopify.com" },
        },
      );
      expect(start.status).toBe(200);

      const state = new URL(start.body?.installUrl || "").searchParams.get("state") || "";
      const callbackQuery = {
        code: "bad-code",
        shop: "mock-shop.myshopify.com",
        state,
        timestamp: "1770000000",
      };
      const callbackParams = new URLSearchParams({
        ...callbackQuery,
        hmac: signCallbackQuery(callbackQuery),
      });
      const callback = await fetch(
        `${server.baseUrl}/api/blog/shopify/oauth/callback?${callbackParams.toString()}`,
        { redirect: "manual" },
      );

      expect(callback.status).toBe(302);
      const location = callback.headers.get("location") || "";
      expect(location).toContain("shopify_error=oauth_failed");
      expect(location).not.toContain("shpat_should_not_reach_browser");
      expect(location).not.toContain("provider%20leaked");
    } finally {
      await server.close();
    }
  });
});
