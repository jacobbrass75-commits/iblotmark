import { describe, expect, it } from "vitest";
import {
  isSensitiveResponsePath,
  redactSensitiveValues,
  summarizeApiResponseForLog,
} from "../../server/responseLogRedaction";

describe("API response log redaction", () => {
  it("does not summarize API response bodies in production", () => {
    const summary = summarizeApiResponseForLog(
      "/api/blog/company/context",
      { ok: true, token: "shpat_should_not_log" },
      { isProduction: true },
    );

    expect(summary).toBeNull();
  });

  it("skips sensitive API paths in development logs", () => {
    for (const path of [
      "/api/auth/api-keys",
      "/api/blog/company/integrations/shopify",
      "/api/blog/shopify/oauth/start",
    ]) {
      expect(isSensitiveResponsePath(path)).toBe(true);
      expect(summarizeApiResponseForLog(path, { secret: "dont-log" }, { isProduction: false })).toBeNull();
    }
  });

  it("redacts nested secrets while preserving safe values", () => {
    const body = {
      ok: true,
      name: "Setup checklist",
      key: "products",
      token: "shpat_mock_token",
      secret: "super-secret",
      password: "password-value",
      authorization: "Bearer abc123",
      nested: {
        encryptedAccessToken: "v1:encrypted-token",
        apiKey: "sk_test_api_key",
        safeValue: "visible",
      },
    };

    const redacted = redactSensitiveValues(body) as Record<string, unknown>;
    const serialized = JSON.stringify(redacted);

    expect(redacted.name).toBe("Setup checklist");
    expect(redacted.key).toBe("products");
    expect(serialized).toContain("visible");
    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toContain("shpat_mock_token");
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("password-value");
    expect(serialized).not.toContain("Bearer abc123");
    expect(serialized).not.toContain("v1:encrypted-token");
    expect(serialized).not.toContain("sk_test_api_key");
  });

  it("summarizes safe development responses after redaction", () => {
    const summary = summarizeApiResponseForLog(
      "/api/blog/setup/status",
      {
        items: [{ key: "products", status: "ready" }],
        encryptedAccessToken: "v1:encrypted-token",
      },
      { isProduction: false },
    );

    expect(summary).toContain("\"key\":\"products\"");
    expect(summary).toContain("\"status\":\"ready\"");
    expect(summary).toContain("[redacted]");
    expect(summary).not.toContain("encrypted-token");
  });
});
