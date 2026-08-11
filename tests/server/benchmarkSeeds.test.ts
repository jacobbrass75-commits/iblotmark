import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("benchmark query seeds", () => {
  let tempDir = "";
  const originalCwd = process.cwd();
  const originalSeedSetting = process.env.BLOG_SEED_IBOLT_DEMO;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ibolt-benchmark-seeds-"));
    process.chdir(tempDir);
    process.env.BLOG_SEED_IBOLT_DEMO = "false";
    vi.resetModules();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (originalSeedSetting === undefined) delete process.env.BLOG_SEED_IBOLT_DEMO;
    else process.env.BLOG_SEED_IBOLT_DEMO = originalSeedSetting;
    vi.resetModules();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("is idempotent against the composite company/query unique index", async () => {
    const { sqlite } = await import("../../server/db");
    sqlite.prepare("INSERT INTO companies (id, name, slug) VALUES (?, ?, ?)").run(
      "ibolt-default-company",
      "iBOLT Mounts",
      "ibolt-mounts",
    );
    const { seedBenchmarkQueries } = await import("../../server/benchmarkSeeds");

    await expect(seedBenchmarkQueries()).resolves.toBe(12);
    await expect(seedBenchmarkQueries()).resolves.toBe(0);
    const row = sqlite.prepare(
      "SELECT COUNT(*) AS count FROM ai_benchmark_queries WHERE company_id = ?",
    ).get("ibolt-default-company") as { count: number };
    expect(row.count).toBe(12);

    sqlite.close();
  });
});
