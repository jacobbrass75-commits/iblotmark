const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

const DEFAULT_JWT_SECRET = "dev-jwt-secret-change-in-production-64chars-long-string-placeholder!!";
const LOCAL_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i;
const PRIVATE_ORIGIN_PATTERN = /^https?:\/\/(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|89\.167\.10\.34)(\d+|\.\d+)*(:\d+)?$/i;

export function envEnabled(name: string): boolean {
  return TRUE_VALUES.has((process.env[name] || "").toLowerCase());
}

export function envDisabled(name: string): boolean {
  return FALSE_VALUES.has((process.env[name] || "").toLowerCase());
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function legacyScholarMarkEnabled(): boolean {
  return envEnabled("ENABLE_LEGACY_SCHOLARMARK") || envEnabled("VITE_ENABLE_LEGACY_SCHOLARMARK");
}

function configuredPublicOrigins(): string[] {
  return [
    process.env.PUBLIC_BASE_URL,
    process.env.APP_BASE_URL,
    process.env.PUBLIC_APP_URL,
    ...(process.env.ALLOWED_ORIGINS || "").split(","),
  ]
    .map((origin) => (origin || "").trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function validateProductionOrigin(origin: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return `${origin} is not a valid URL origin.`;
  }
  if (parsed.protocol !== "https:") {
    return `${origin} must use https in production.`;
  }
  const normalized = `${parsed.protocol}//${parsed.host}`;
  if (LOCAL_ORIGIN_PATTERN.test(normalized) || PRIVATE_ORIGIN_PATTERN.test(normalized)) {
    return `${origin} cannot be a local or private-network origin in production.`;
  }
  return null;
}

function isValidClerkPublishableKey(key: string): boolean {
  if (!key.startsWith("pk_live_")) return false;
  const parts = key.split("_");
  if (parts.length !== 3 || !parts[2]) return false;
  try {
    const decoded = Buffer.from(parts[2], "base64").toString("utf8");
    const withoutTrailing = decoded.endsWith("$") ? decoded.slice(0, -1) : "";
    return Boolean(withoutTrailing && withoutTrailing.includes(".") && !withoutTrailing.includes("$"));
  } catch {
    return false;
  }
}

function looksPlaceholder(value: string): boolean {
  return /replace-with|changeme|change-me|dummy|example\.com|your-app|placeholder/i.test(value);
}

export function validateProductionConfig(): void {
  if (!isProduction()) return;

  const errors: string[] = [];
  const jwtSecret = process.env.JWT_SECRET || "";
  const integrationKey = process.env.INTEGRATION_ENCRYPTION_KEY || "";
  const assetSigningSecret = process.env.PUBLIC_ASSET_SIGNING_SECRET || "";
  const clerkSecret = process.env.CLERK_SECRET_KEY || "";
  const clerkPublishable = process.env.CLERK_PUBLISHABLE_KEY || process.env.VITE_CLERK_PUBLISHABLE_KEY || "";
  const viteClerkPublishable = process.env.VITE_CLERK_PUBLISHABLE_KEY || "";

  if (!jwtSecret || jwtSecret === DEFAULT_JWT_SECRET || jwtSecret.length < 32 || looksPlaceholder(jwtSecret)) {
    errors.push("JWT_SECRET must be set to a non-default value of at least 32 characters.");
  }

  if (!integrationKey || integrationKey.length < 32 || looksPlaceholder(integrationKey)) {
    errors.push("INTEGRATION_ENCRYPTION_KEY must be set to a non-default value of at least 32 characters.");
  }

  if (!assetSigningSecret || assetSigningSecret.length < 32 || looksPlaceholder(assetSigningSecret)) {
    errors.push("PUBLIC_ASSET_SIGNING_SECRET must be set to a non-default value of at least 32 characters.");
  }

  if (!clerkSecret || !clerkPublishable || !viteClerkPublishable) {
    errors.push("Clerk production auth keys are required: CLERK_SECRET_KEY and VITE_CLERK_PUBLISHABLE_KEY.");
  } else {
    if (!clerkSecret.startsWith("sk_live_") || clerkSecret.length < 24 || looksPlaceholder(clerkSecret)) {
      errors.push("CLERK_SECRET_KEY must be a live Clerk secret key (sk_live_...) in production.");
    }
    if (!isValidClerkPublishableKey(viteClerkPublishable) || looksPlaceholder(viteClerkPublishable)) {
      errors.push("VITE_CLERK_PUBLISHABLE_KEY must be a valid live Clerk publishable key (pk_live_...) so the client can render Clerk sign-in.");
    }
  }

  if (!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY)) {
    errors.push("Set ANTHROPIC_API_KEY or OPENAI_API_KEY so the blog generation pipeline can run.");
  }

  if (!(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL)) {
    errors.push("PUBLIC_BASE_URL, APP_BASE_URL, or PUBLIC_APP_URL must be set so published asset URLs use this deployment.");
  }

  for (const origin of configuredPublicOrigins()) {
    const originError = validateProductionOrigin(origin);
    if (originError) errors.push(originError);
  }

  for (const unsafeFlag of [
    "IBOLT_BLOG_ALLOW_UNAUTHENTICATED",
    "BLOG_ALLOW_UNVALIDATED_COMPANY_SELECTION",
    "IBOLT_INTERNAL_AUTH_BYPASS",
    "VITE_INTERNAL_AUTH_BYPASS",
    "BLOG_ALLOW_UNSIGNED_PUBLIC_PHOTOS",
    "BLOG_SEED_IBOLT_DEMO",
    "ALLOW_IBOLT_DEMO_SCRIPTS",
    "ALLOW_CHROME_EXTENSION_ORIGINS",
  ]) {
    if (envEnabled(unsafeFlag)) {
      errors.push(`${unsafeFlag}=true is not allowed in production.`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Production configuration is unsafe:\n- ${errors.join("\n- ")}`);
  }
}
