import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("shopifyPublisher", () => {
  let tempDir = "";
  const originalCwd = process.cwd();
  const originalFetch = global.fetch;
  const originalEnv = {
    SHOPIFY_CLIENT_ID: process.env.SHOPIFY_CLIENT_ID,
    SHOPIFY_CLIENT_SECRET: process.env.SHOPIFY_CLIENT_SECRET,
    SHOPIFY_SHOP: process.env.SHOPIFY_SHOP,
  };
  let sqliteHandle: { close: () => void } | null = null;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "iblotmark-shopify-"));
    vi.resetModules();
    vi.restoreAllMocks();
    sqliteHandle = null;
    process.chdir(tempDir);
    process.env.SHOPIFY_CLIENT_ID = "test-client";
    process.env.SHOPIFY_CLIENT_SECRET = "test-secret";
    process.env.SHOPIFY_SHOP = "iboltmounts";
  });

  afterEach(async () => {
    sqliteHandle?.close();
    sqliteHandle = null;
    global.fetch = originalFetch;
    process.env.SHOPIFY_CLIENT_ID = originalEnv.SHOPIFY_CLIENT_ID;
    process.env.SHOPIFY_CLIENT_SECRET = originalEnv.SHOPIFY_CLIENT_SECRET;
    process.env.SHOPIFY_SHOP = originalEnv.SHOPIFY_SHOP;
    process.chdir(originalCwd);
    vi.resetModules();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("maps excerpt to Shopify summary_html when creating an article", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "token", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ article: { id: 123 } }),
      });

    global.fetch = fetchMock as typeof fetch;

    const { publishBlogPost } = await import("../../server/shopifyPublisher");
    const { sqlite } = await import("../../server/db");
    sqliteHandle = sqlite;

    await publishBlogPost({
      title: "Photo-ready post",
      bodyHtml: "<p>Body</p>",
      excerpt: "Short summary for the blog index.",
      metaTitle: "Tablet Mount Guide",
      metaDescription: "Find the right iBOLT tablet mount for work and travel.",
      blogId: 104843772196,
    });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(requestBody.article.summary_html).toBe(
      "<p>Short summary for the blog index.</p>"
    );
    expect(requestBody.article.metafields).toEqual([
      {
        namespace: "seo",
        key: "title",
        value: "Tablet Mount Guide",
        type: "single_line_text_field",
      },
      {
        namespace: "seo",
        key: "description",
        value: "Find the right iBOLT tablet mount for work and travel.",
        type: "single_line_text_field",
      },
    ]);
  });
});
