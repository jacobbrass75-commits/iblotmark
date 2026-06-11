import "dotenv/config";

process.env.NODE_ENV = "production";

type CheckResult = {
  name: string;
  ok: boolean;
  detail?: string;
};

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "");
}

function configuredOrigins(): string[] {
  return Array.from(new Set([
    process.env.PUBLIC_BASE_URL,
    process.env.APP_BASE_URL,
    process.env.PUBLIC_APP_URL,
    ...(process.env.ALLOWED_ORIGINS || "").split(","),
  ]
    .map((origin) => normalizeOrigin(origin || ""))
    .filter(Boolean)));
}

function configuredShopifyScopes(): string[] {
  return (process.env.SHOPIFY_OAUTH_SCOPES || "")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function looksPlaceholder(value: string): boolean {
  return /replace-with|changeme|change-me|dummy|example\.com|your-app|placeholder/i.test(value);
}

async function main(): Promise<void> {
  const results: CheckResult[] = [];
  const runtime = await import("../server/runtimeConfig");

  try {
    runtime.validateProductionConfig();
    results.push({ name: "production config", ok: true });
  } catch (error) {
    results.push({ name: "production config", ok: false, detail: error instanceof Error ? error.message : String(error) });
  }

  const legacyEnabled = runtime.envEnabled("ENABLE_LEGACY_SCHOLARMARK") || runtime.envEnabled("VITE_ENABLE_LEGACY_SCHOLARMARK");
  results.push({
    name: "standalone legacy isolation",
    ok: !legacyEnabled,
    detail: legacyEnabled ? "ENABLE_LEGACY_SCHOLARMARK and VITE_ENABLE_LEGACY_SCHOLARMARK must be false for standalone production." : undefined,
  });

  const dbModule = await import("../server/db");

  try {
    dbModule.validateBlogTenantIntegrity();
    results.push({ name: "tenant integrity", ok: true });
  } catch (error) {
    results.push({ name: "tenant integrity", ok: false, detail: error instanceof Error ? error.message : String(error) });
  }

  const fkRows = dbModule.sqlite.pragma("foreign_key_check") as unknown[];
  results.push({
    name: "foreign key integrity",
    ok: fkRows.length === 0,
    detail: fkRows.length ? `${fkRows.length} foreign key violations` : undefined,
  });

  const publicOrigins = configuredOrigins();
  results.push({
    name: "public origin configured",
    ok: publicOrigins.length > 0,
    detail: publicOrigins.length ? publicOrigins.join(", ") : "Set PUBLIC_BASE_URL, APP_BASE_URL, or PUBLIC_APP_URL.",
  });

  const shopifyClientId = (process.env.SHOPIFY_CLIENT_ID || "").trim();
  const shopifyClientSecret = (process.env.SHOPIFY_CLIENT_SECRET || "").trim();
  results.push({
    name: "shopify oauth app configured",
    ok: Boolean(shopifyClientId && shopifyClientSecret && !looksPlaceholder(shopifyClientId) && !looksPlaceholder(shopifyClientSecret)),
    detail: shopifyClientId && shopifyClientSecret && !looksPlaceholder(shopifyClientId) && !looksPlaceholder(shopifyClientSecret)
      ? "SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET are present."
      : "Set real SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET so new companies can connect Shopify through OAuth.",
  });

  const hasGenerationProvider = Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);
  results.push({
    name: "blog generation provider configured",
    ok: hasGenerationProvider,
    detail: hasGenerationProvider
      ? "At least one of ANTHROPIC_API_KEY or OPENAI_API_KEY is present."
      : "Set ANTHROPIC_API_KEY or OPENAI_API_KEY before production launch.",
  });

  const shopifyScopes = configuredShopifyScopes();
  const requiredScopes = ["read_products", "read_content", "write_content"];
  const missingScopes = requiredScopes.filter((scope) => !shopifyScopes.includes(scope));
  results.push({
    name: "shopify oauth scopes",
    ok: missingScopes.length === 0,
    detail: missingScopes.length
      ? `Missing ${missingScopes.join(", ")} in SHOPIFY_OAUTH_SCOPES.`
      : shopifyScopes.join(", "),
  });

  const failed = results.filter((result) => !result.ok);
  for (const result of results) {
    const marker = result.ok ? "ok" : "fail";
    console.log(`[${marker}] ${result.name}${result.detail ? `: ${result.detail}` : ""}`);
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
