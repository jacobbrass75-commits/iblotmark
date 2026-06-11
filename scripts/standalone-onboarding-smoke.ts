import "dotenv/config";

process.env.NODE_ENV = "development";
process.env.IBOLT_BLOG_ALLOW_UNAUTHENTICATED = "false";
process.env.IBOLT_INTERNAL_AUTH_BYPASS = "true";
process.env.BLOG_ALLOW_UNVALIDATED_COMPANY_SELECTION = "true";
process.env.BLOG_SEED_IBOLT_DEMO = "false";
process.env.ENABLE_LEGACY_SCHOLARMARK = "false";

import type { Server } from "http";

type JsonRecord = Record<string, unknown>;

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function getSetupItem(setupStatus: JsonRecord, key: string): JsonRecord {
  const items = setupStatus.items;
  assertCondition(Array.isArray(items), "Setup status response is missing items.");
  const item = items.find((candidate) => candidate && typeof candidate === "object" && (candidate as JsonRecord).key === key);
  assertCondition(item && typeof item === "object", `Setup status is missing ${key}.`);
  return item as JsonRecord;
}

function assertSetupComplete(setupStatus: JsonRecord, key: string, expected: boolean): void {
  const item = getSetupItem(setupStatus, key);
  assertCondition(item.complete === expected, `Expected setup item ${key} to be ${expected ? "complete" : "incomplete"}.`);
}

async function readJson(response: Response): Promise<JsonRecord> {
  const text = await response.text();
  let body: JsonRecord;
  try {
    body = text ? JSON.parse(text) as JsonRecord : {};
  } catch {
    throw new Error(`Expected JSON response from ${response.url}, got ${text.slice(0, 300)}`);
  }

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} from ${response.url}: ${JSON.stringify(body)}`);
  }

  return body;
}

async function api(baseUrl: string, path: string, init: RequestInit = {}): Promise<JsonRecord> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  return readJson(response);
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function cleanupCompany(companyId: string): Promise<void> {
  const { eq } = await import("drizzle-orm");
  const { db } = await import("../server/db");
  const schema = await import("../shared/schema");

  const companyScopedTables = [
    schema.blogPostPhotos,
    schema.blogPostProducts,
    schema.aiBenchmarkResults,
    schema.productCatalogExtractions,
    schema.productVerticals,
    schema.contextEntries,
    schema.researchJobs,
    schema.pipelineContextChunks,
    schema.productFeedAudits,
    schema.productPhotos,
    schema.blogPosts,
    schema.keywords,
    schema.aiBenchmarkRuns,
    schema.aiBenchmarkQueries,
    schema.generationBatches,
    schema.keywordClusters,
    schema.keywordImports,
    schema.productCatalogImports,
    schema.products,
    schema.industryVerticals,
    schema.companyJobRuns,
    schema.companyJobLocks,
    schema.companyUsageEvents,
    schema.companySettings,
    schema.companyIntegrations,
    schema.brandProfiles,
    schema.companyMemberships,
  ];

  for (const table of companyScopedTables) {
    await db.delete(table).where(eq(table.companyId, companyId));
  }

  await db.delete(schema.companies).where(eq(schema.companies.id, companyId));
}

async function closeDatabase(): Promise<void> {
  const { sqlite } = await import("../server/db");
  try {
    sqlite.close();
  } catch {
    // The smoke process owns its database handle; ignore repeated-close cleanup.
  }
}

async function main(): Promise<void> {
  const express = (await import("express")).default;
  const { createServer } = await import("http");
  const { registerRoutes } = await import("../server/routes");
  const { randomUUID } = await import("crypto");

  const app = express();
  app.use(express.json({
    verify: (req, _res, buffer) => {
      req.rawBody = buffer;
    },
  }));
  app.use(express.urlencoded({ extended: false }));

  const server = createServer(app);
  let companyId: string | null = null;

  try {
    await registerRoutes(server, app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address();
    assertCondition(address && typeof address === "object", "Smoke server did not expose a TCP address.");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const suffix = randomUUID().slice(0, 8);
    const companyName = `Smoke Brand ${suffix}`;
    const websiteUrl = `https://smoke-${suffix}.example.com`;

    const createdContext = await api(baseUrl, "/api/blog/company", {
      method: "POST",
      body: JSON.stringify({
        name: companyName,
        websiteUrl,
        primaryMarket: "Smoke Testing",
        ecommercePlatform: "shopify",
      }),
    });
    companyId = (createdContext.company as JsonRecord | undefined)?.id as string | undefined || null;
    assertCondition(companyId, "Company creation did not return company.id.");
    assertCondition((createdContext.company as JsonRecord).name === companyName, "Company creation returned the wrong company.");
    console.log(`[ok] created disposable company ${companyId}`);

    const companyHeaders = { "x-company-id": companyId };
    const initialSetup = await api(baseUrl, "/api/blog/company/setup-status", { headers: companyHeaders });
    assertSetupComplete(initialSetup, "company", true);
    assertSetupComplete(initialSetup, "brand", false);
    assertSetupComplete(initialSetup, "products", false);
    assertSetupComplete(initialSetup, "photos", false);
    assertSetupComplete(initialSetup, "keywords", false);
    assertSetupComplete(initialSetup, "shopify", false);
    assertSetupComplete(initialSetup, "first-post", false);
    console.log("[ok] initial setup status starts with only the workspace complete");

    const verticals = await api(baseUrl, "/api/blog/context/verticals", { headers: companyHeaders }) as unknown;
    assertCondition(Array.isArray(verticals), "Vertical list response is missing verticals.");
    assertCondition(verticals.length >= 1, "Company creation did not seed a starter vertical.");
    assertCondition(
      verticals.every((vertical) => vertical && typeof vertical === "object" && (vertical as JsonRecord).companyId === companyId),
      "Starter vertical query leaked another company.",
    );
    console.log("[ok] starter vertical is scoped to the new company");

    const updatedContext = await api(baseUrl, "/api/blog/company/profile", {
      method: "PUT",
      headers: companyHeaders,
      body: JSON.stringify({
        company: {
          name: companyName,
          websiteUrl,
          primaryMarket: "Vehicle accessory ecommerce",
          ecommercePlatform: "shopify",
        },
        brandProfile: {
          displayName: companyName,
          websiteUrl,
          productUrlPattern: `${websiteUrl}/products/{handle}`,
          shortDescription: "A smoke-test ecommerce brand for validating standalone onboarding.",
          positioning: "Reliable mounted accessories for field teams that need durable gear.",
          audiencePersonas: ["Fleet operations manager", "Installation technician"],
          toneTraits: ["practical", "plainspoken", "credible"],
          bannedPhrases: ["game-changer"],
          preferredCtas: ["Explore compatible options"],
          requiredClaims: ["Verify product fit before publishing recommendations."],
          forbiddenClaims: ["Guaranteed compliance for every vehicle."],
          competitors: [{ name: "Example Competitor", domains: ["competitor.example.com"] }],
          writingSamples: ["Write with direct advice, concrete specs, and restrained product recommendations."],
          targetWordCountMin: 900,
          targetWordCountMax: 1200,
        },
      }),
    });
    assertCondition((updatedContext.brandProfile as JsonRecord).displayName === companyName, "Profile update did not return the updated brand profile.");
    const brandSetup = await api(baseUrl, "/api/blog/company/setup-status", { headers: companyHeaders });
    assertSetupComplete(brandSetup, "brand", true);
    console.log("[ok] brand profile completes after guidance is added");

    const product = await api(baseUrl, "/api/blog/products", {
      method: "POST",
      headers: companyHeaders,
      body: JSON.stringify({
        title: `${companyName} Field Mount`,
        handle: `smoke-field-mount-${suffix}`,
        description: "Durable test product used only for onboarding smoke coverage.",
        productType: "Mount",
        vendor: companyName,
        sku: `SMOKE-${suffix.toUpperCase()}`,
        price: "49.99",
        url: `${websiteUrl}/products/smoke-field-mount-${suffix}`,
        tags: ["smoke", "manual"],
        specs: { material: "aluminum", pattern: "AMPS" },
        compatibility: ["tablet", "phone"],
        claims: ["Designed for repeatable installation checks."],
        disclaimers: ["Smoke-test product only."],
        availability: "in_stock",
      }),
    });
    assertCondition(product.companyId === companyId, "Manual product was not scoped to the smoke company.");
    const productSetup = await api(baseUrl, "/api/blog/company/setup-status", { headers: companyHeaders });
    assertSetupComplete(productSetup, "products", true);
    console.log("[ok] manual product creation completes catalog setup");

    const configuredShopifyContext = await api(baseUrl, "/api/blog/company/integrations/shopify", {
      method: "PUT",
      headers: companyHeaders,
      body: JSON.stringify({
        shopify: {
          shop: `smoke-shop-${suffix}`,
          defaultBlogId: 123456,
          productUrlPattern: `https://smoke-shop-${suffix}.myshopify.com/products/{handle}`,
          publicStoreUrl: `https://smoke-shop-${suffix}.myshopify.com`,
          blogTargets: [{ id: 123456, name: "News", handle: "news" }],
        },
      }),
    });
    assertCondition(
      ((configuredShopifyContext.integrations as JsonRecord).shopify as JsonRecord).hasAccessToken === false,
      "Manual Shopify settings should not count as a token-backed connection.",
    );
    const missingTokenSetup = await api(baseUrl, "/api/blog/company/setup-status", { headers: companyHeaders });
    assertSetupComplete(missingTokenSetup, "shopify", false);
    console.log("[ok] manual Shopify settings do not complete publishing setup without OAuth token material");

    const { and, eq } = await import("drizzle-orm");
    const { db } = await import("../server/db");
    const { companyIntegrations } = await import("../shared/schema");
    const { encryptSecret } = await import("../server/integrationSecrets");
    const [integration] = await db
      .select()
      .from(companyIntegrations)
      .where(and(eq(companyIntegrations.companyId, companyId), eq(companyIntegrations.type, "shopify")))
      .limit(1);
    assertCondition(integration, "Shopify integration row was not created.");
    await db
      .update(companyIntegrations)
      .set({
        status: "connected",
        config: {
          ...((integration.config || {}) as JsonRecord),
          encryptedAccessToken: encryptSecret("shpat_smoke_local_only"),
        },
        updatedAt: new Date(),
      })
      .where(eq(companyIntegrations.id, integration.id));

    const shopifyContext = await api(baseUrl, "/api/blog/company/context", { headers: companyHeaders });
    const shopify = (shopifyContext.integrations as JsonRecord).shopify as JsonRecord;
    assertCondition(shopify?.hasAccessToken === true, "Shopify integration did not resolve hasAccessToken.");
    assertCondition(shopify.defaultBlogId === 123456, "Shopify integration did not persist defaultBlogId.");
    const shopifySetup = await api(baseUrl, "/api/blog/company/setup-status", { headers: companyHeaders });
    assertSetupComplete(shopifySetup, "shopify", true);
    console.log("[ok] Shopify integration completes publishing setup without storing a raw token");

    const finalContext = await api(baseUrl, "/api/blog/company/context", { headers: companyHeaders });
    assertCondition((finalContext.company as JsonRecord).id === companyId, "CompanyContext returned the wrong company.");
    assertCondition((finalContext.brandProfile as JsonRecord).productUrlPattern === `${websiteUrl}/products/{handle}`, "CompanyContext returned the wrong product URL pattern.");
    assertCondition(!("accessTokenRef" in (((finalContext.integrations as JsonRecord).shopify as JsonRecord) || {})), "CompanyContext should not expose Shopify token references.");
    console.log("[ok] CompanyContext reflects company, brand, product URL, and Shopify settings");

    await api(baseUrl, "/api/blog/company/integrations/shopify", {
      method: "DELETE",
      headers: companyHeaders,
    });
    const disconnectedContext = await api(baseUrl, "/api/blog/company/context", { headers: companyHeaders });
    assertCondition(
      !((disconnectedContext.integrations as JsonRecord).shopify),
      "Disconnected Shopify integration should not appear in CompanyContext.",
    );
    const disconnectedSetup = await api(baseUrl, "/api/blog/company/setup-status", { headers: companyHeaders });
    assertSetupComplete(disconnectedSetup, "shopify", false);
    console.log("[ok] disconnected Shopify integration no longer counts as ready");
  } finally {
    await closeServer(server);
    if (companyId) {
      await cleanupCompany(companyId);
      console.log(`[ok] cleaned up disposable company ${companyId}`);
    }
    await closeDatabase();
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
