import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("htmlRenderer", () => {
  let tempDir = "";
  const originalCwd = process.cwd();
  let sqliteHandle: { close: () => void } | null = null;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "iblotmark-renderer-"));
    vi.resetModules();
    sqliteHandle = null;
    process.chdir(tempDir);
  });

  afterEach(async () => {
    sqliteHandle?.close();
    sqliteHandle = null;
    process.chdir(originalCwd);
    vi.resetModules();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("renders markdown image syntax as a styled img tag", async () => {
    const { markdownToHtml } = await import("../../server/htmlRenderer");
    const { sqlite } = await import("../../server/db");
    sqliteHandle = sqlite;

    const html = markdownToHtml(
      "![Tablet mount](https://cdn.shopify.com/s/files/1/tablet-mount.jpg)"
    );

    expect(html).toContain(
      '<img src="https://cdn.shopify.com/s/files/1/tablet-mount.jpg" alt="Tablet mount" style="width:100%;max-width:800px;height:auto;margin:16px 0;border-radius:4px;" />'
    );
    expect(html).not.toContain("<a href=");
  });

  it("preserves raw img tags instead of escaping them", async () => {
    const { markdownToHtml } = await import("../../server/htmlRenderer");
    const { sqlite } = await import("../../server/db");
    sqliteHandle = sqlite;

    const html = markdownToHtml(
      '## Photo Section\n<img src="https://cdn.shopify.com/raw.jpg" alt="Raw photo" style="width:100%;max-width:800px;height:auto;margin:16px 0;border-radius:4px;" />'
    );

    expect(html).toContain("<h2>Photo Section</h2>");
    expect(html).toContain(
      '<img src="https://cdn.shopify.com/raw.jpg" alt="Raw photo" style="width:100%;max-width:800px;height:auto;margin:16px 0;border-radius:4px;" />'
    );
    expect(html).not.toContain("&lt;img");
  });
});
