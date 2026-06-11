import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateProductionConfig } from "../../server/runtimeConfig";

const LIVE_CLERK_PUBLISHABLE_KEY = `pk_live_${Buffer.from("prod.example.net$").toString("base64")}`;
const LIVE_CLERK_SECRET_KEY = ["sk", "live", "prodsecretkeyforpreflight123456789"].join("_");

describe("production security configuration", () => {
  let tempDir = "";
  let sqlite: { close: () => void } | null = null;
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "standalone-production-security-"));
    process.chdir(tempDir);
    vi.resetModules();
    setProductionEnv();
  });

  afterEach(async () => {
    sqlite?.close();
    sqlite = null;
    process.chdir(originalCwd);
    process.env = { ...originalEnv };
    vi.resetModules();
    await rm(tempDir, { recursive: true, force: true });
  });

  function setProductionEnv(overrides: Record<string, string | undefined> = {}): void {
    process.env = {
      ...originalEnv,
      NODE_ENV: "production",
      JWT_SECRET: "prod-test-jwt-secret-abcdefghijklmnopqrstuvwxyz123456",
      INTEGRATION_ENCRYPTION_KEY: "prod-test-integration-key-abcdefghijklmnopqrstuvwxyz123456",
      PUBLIC_ASSET_SIGNING_SECRET: "prod-test-asset-key-abcdefghijklmnopqrstuvwxyz123456",
      PUBLIC_BASE_URL: "https://prod.example.net",
      APP_BASE_URL: "",
      PUBLIC_APP_URL: "",
      ALLOWED_ORIGINS: "",
      CLERK_SECRET_KEY: LIVE_CLERK_SECRET_KEY,
      CLERK_PUBLISHABLE_KEY: LIVE_CLERK_PUBLISHABLE_KEY,
      VITE_CLERK_PUBLISHABLE_KEY: LIVE_CLERK_PUBLISHABLE_KEY,
      ANTHROPIC_API_KEY: "sk-ant-test-production-security",
      OPENAI_API_KEY: "",
      IBOLT_BLOG_ALLOW_UNAUTHENTICATED: "false",
      BLOG_ALLOW_UNVALIDATED_COMPANY_SELECTION: "false",
      IBOLT_INTERNAL_AUTH_BYPASS: "false",
      VITE_INTERNAL_AUTH_BYPASS: "false",
      BLOG_ALLOW_UNSIGNED_PUBLIC_PHOTOS: "false",
      BLOG_SEED_IBOLT_DEMO: "false",
      ALLOW_IBOLT_DEMO_SCRIPTS: "false",
      ALLOW_CHROME_EXTENSION_ORIGINS: "false",
      ENABLE_LEGACY_SCHOLARMARK: "false",
      VITE_ENABLE_LEGACY_SCHOLARMARK: "false",
      ...overrides,
    };
  }

  it("accepts a complete standalone production environment", () => {
    expect(() => validateProductionConfig()).not.toThrow();
  });

  it("rejects production auth without the Vite Clerk publishable key", () => {
    setProductionEnv({ VITE_CLERK_PUBLISHABLE_KEY: "" });

    expect(() => validateProductionConfig()).toThrow(/VITE_CLERK_PUBLISHABLE_KEY/);
  });

  it("rejects unsafe bypass flags in production", () => {
    for (const flag of [
      "IBOLT_BLOG_ALLOW_UNAUTHENTICATED",
      "BLOG_ALLOW_UNVALIDATED_COMPANY_SELECTION",
      "IBOLT_INTERNAL_AUTH_BYPASS",
      "VITE_INTERNAL_AUTH_BYPASS",
      "BLOG_ALLOW_UNSIGNED_PUBLIC_PHOTOS",
      "ALLOW_IBOLT_DEMO_SCRIPTS",
    ]) {
      setProductionEnv({ [flag]: "true" });

      expect(() => validateProductionConfig(), flag).toThrow(new RegExp(`${flag}=true`));
    }
  });

  it("rejects production startup without a blog generation provider", () => {
    setProductionEnv({ ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "" });

    expect(() => validateProductionConfig()).toThrow(/ANTHROPIC_API_KEY or OPENAI_API_KEY/);
  });

  it("keeps unauthenticated blog access dev-only", async () => {
    setProductionEnv({ IBOLT_BLOG_ALLOW_UNAUTHENTICATED: "true" });
    const { allowUnauthenticatedBlogAccess } = await import("../../server/auth");
    const { sqlite: importedSqlite } = await import("../../server/db");
    sqlite = importedSqlite;

    expect(allowUnauthenticatedBlogAccess()).toBe(false);

    process.env.NODE_ENV = "development";
    expect(allowUnauthenticatedBlogAccess()).toBe(true);

    process.env.IBOLT_BLOG_ALLOW_UNAUTHENTICATED = "";
    expect(allowUnauthenticatedBlogAccess()).toBe(false);
  });
});
