import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("database bootstrap", () => {
  let tempDir = "";
  const originalCwd = process.cwd();

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scholarmark-db-"));
    vi.resetModules();
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    vi.resetModules();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates core and support tables with required indexes", async () => {
    const { sqlite } = await import("../../server/db");

    const tables = new Set(
      (sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>)
        .map((row) => row.name)
    );
    const indexes = new Set(
      (sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as Array<{ name: string }>)
        .map((row) => row.name)
    );
    const views = new Set(
      (sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'view'")
        .all() as Array<{ name: string }>)
        .map((row) => row.name)
    );

    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    for (const table of [
      "documents",
      "users",
      "projects",
      "project_documents",
      "web_clips",
      "conversations",
      "api_keys",
      "mcp_tokens",
      "analytics_tool_calls",
      "ocr_jobs",
    ]) {
      expect(tables.has(table)).toBe(true);
    }
    expect(indexes.has("idx_api_keys_key_hash")).toBe(true);
    expect(indexes.has("idx_ocr_jobs_status_created")).toBe(true);
    expect(indexes.has("idx_ocr_jobs_document_active")).toBe(true);
    expect(views.has("products")).toBe(true);

    const benchmarkQueryColumns = new Set(
      (sqlite.prepare("PRAGMA table_info(ai_benchmark_queries)").all() as Array<{ name: string }>).map((row) => row.name)
    );
    const benchmarkResultColumns = new Set(
      (sqlite.prepare("PRAGMA table_info(ai_benchmark_results)").all() as Array<{ name: string }>).map((row) => row.name)
    );
    expect(benchmarkQueryColumns.has("brand_angle")).toBe(true);
    expect(benchmarkQueryColumns.has("ibolt_angle")).toBe(true);
    expect(benchmarkResultColumns.has("target_brand_mentioned")).toBe(true);
    expect(benchmarkResultColumns.has("target_domain_cited")).toBe(true);
    expect(benchmarkResultColumns.has("ibolt_cited")).toBe(true);

    sqlite.close();
  });
});
